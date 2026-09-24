import crypto from 'node:crypto';

// ============================================================================
// 会社の Google Workspace からメールを送る
//
// サービスアカウントに「ドメイン全体の委任」を設定し、社内のメールボックス
// になりすまして送信する。差出人は【操作した本人】のアドレスにする。
// 送信控えが本人の Gmail「送信済み」に残り、印刷会社からの返信も本人に届く。
// GMAIL_ALWAYS_CC を設定すると、全送信の控えをそのアドレスにCCする。
//
// 外部の配信サービスを使わない理由:
//   * 追加費用がない（契約済みの Workspace の範囲内）
//   * DNS（SPF/DKIM）の設定が要らない。既存のメール運用に影響しない
//   * 送信済みメールが Gmail の「送信済み」に残り、返信も通常どおり届く
//     （印刷会社への見積依頼では、これが noreply@ より重要）
//
// googleapis パッケージは重いので使わず、Node 標準の crypto で
// JWT を署名してアクセストークンを取る。
// ============================================================================

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * 環境変数に貼られた値から、秘密鍵の本体を取り出す。
 *
 * JSONファイルからコピーすると、前後の二重引用符・カンマ・キー名まで
 * 一緒に入りやすい。前後を削る方式だと取りこぼすため、
 * 「-----BEGIN ... PRIVATE KEY-----」から「-----END ... PRIVATE KEY-----」
 * までを探して切り出す。余分が何であっても落ちる。
 */
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/;

function normalizePrivateKey(raw) {
  // \n 表記を実際の改行に戻してから本体を探す
  const text = (raw || '').replace(/\\n/g, '\n');
  const match = text.match(PEM_BLOCK);
  if (!match) return '';

  const block = match[0];
  const header = block.slice(0, block.indexOf('-----', 5) + 5);
  const footer = block.slice(block.lastIndexOf('-----BEGIN') === 0 ? block.indexOf('-----END') : 0)
    .match(/-----END [A-Z ]*PRIVATE KEY-----/)[0];

  // 貼り付けの過程で改行が失われることがある。base64 部分を64文字ごとに
  // 折り返して組み立て直す。PEM は改行が無いと OpenSSL が読めない。
  const base64 = block
    .slice(header.length, block.length - footer.length)
    .replace(/[^A-Za-z0-9+/=]/g, '');

  const wrapped = base64.replace(/(.{64})/g, '$1\n').replace(/\n$/, '');

  return `${header}\n${wrapped}\n${footer}\n`;
}

/**
 * 鍵が読めないときに、原因の見当をつけるための情報。
 * 鍵そのものは出さず、形だけを報告する。
 */
function describeKeyProblem(raw) {
  const value = raw || '';
  if (!value.trim()) return '値が空です';

  const facts = [`長さ${value.length}文字`];
  facts.push(value.includes('BEGIN') ? 'BEGIN あり' : '**BEGIN が無い**');
  facts.push(value.includes('END') ? 'END あり' : '**END が無い**');
  facts.push(value.includes('PRIVATE KEY') ? 'PRIVATE KEY あり' : '**PRIVATE KEY の文字が無い**');
  facts.push(value.includes('\\n') ? '\\n 表記あり' : value.includes('\n') ? '改行あり' : '**改行が無い**');

  return facts.join(' / ');
}

/**
 * サービスアカウントのアドレスを取り出す。
 * 秘密鍵と同様、JSONから値をコピーする過程で引用符やキー名が混ざりやすい。
 * JSON全体を貼られた場合は client_email の値を拾う。
 */
function normalizeClientEmail(raw) {
  const text = (raw || '').trim();

  // 「xxx@yyy.iam.gserviceaccount.com」の形をどこからでも拾う
  const match = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com/);
  return match ? match[0] : text.replace(/^["']|["',]+$/g, '');
}

function config() {
  const clientEmail = normalizeClientEmail(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const privateKey = normalizePrivateKey(rawKey);

  // 「未設定」と「設定はされているが鍵として読めない」は原因も対処も違う。
  // 混同すると、値を入れているのに「未設定です」と出て堂々巡りになる。
  const missing = [
    !clientEmail && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !rawKey && 'GOOGLE_PRIVATE_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `メール送信の設定が未完了です（未設定: ${missing.join(' / ')}）。` +
      'Vercel の環境変数を確認してください（VITE_ は付けないこと）。'
    );
  }

  if (!clientEmail.endsWith('.iam.gserviceaccount.com')) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL がサービスアカウントのアドレスになっていません。' +
      'JSONファイルの client_email の値（末尾が .iam.gserviceaccount.com）を設定してください。' +
      `（いま設定されている値: 「${clientEmail}」）`
    );
  }

  if (!privateKey) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY から秘密鍵を読み取れません。' +
      'JSONファイルの private_key の値を「-----BEGIN PRIVATE KEY-----」から ' +
      '「-----END PRIVATE KEY-----」まで貼り付けてください。' +
      `（いま設定されている値: ${describeKeyProblem(process.env.GOOGLE_PRIVATE_KEY)}）`
    );
  }

  return {
    clientEmail,
    privateKey,
    // 送信者が特定できない場合の差出人（通常は使わない）
    fallbackSender: process.env.GMAIL_SENDER || '',
    // 送信控えを残すアドレス。未設定ならCCしない。
    alwaysCc: process.env.GMAIL_ALWAYS_CC || '',
  };
}

/** メール送信が設定済みか。未設定でも画面を壊さないための判定に使う。 */
export function isMailConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
  );
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** サービスアカウントの鍵で署名したJWTを、アクセストークンに交換する。 */
/**
 * @param {string} impersonate  なりすます本人のアドレス
 * @param {string} [scope]      既定は Gmail 送信。Sheets 出力などは呼び出し側が指定する
 */
export async function getAccessToken(impersonate, scope = SCOPE) {
  const { clientEmail, privateKey } = config();
  const now = Math.floor(Date.now() / 1000);

  const claims = {
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    // 委任により、この人のメールボックスから送る。
    // 呼び出し側がリクエストの中身から決めてはいけない値で、必ず
    // サーバーで検証済みのログイン情報（user.email）を渡すこと。
    sub: impersonate,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;

  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  } catch (err) {
    // OpenSSL の DECODER エラーは原因が読み取れないので、対処を書いて返す
    throw new Error(
      '秘密鍵を読み込めませんでした。GOOGLE_PRIVATE_KEY の貼り付けを確認してください' +
      `（前後の二重引用符やカンマが混ざっていないか）。詳細: ${err.message}`
    );
  }

  const jwt = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // よくある原因を切り分けやすいメッセージにする
    const hint = data.error === 'invalid_client'
      ? `（サービスアカウント「${clientEmail}」が見つかりません。` +
        'GOOGLE_SERVICE_ACCOUNT_EMAIL の値が正しいか、そのサービスアカウントが' +
        '削除されていないかを確認してください）'
      : data.error === 'unauthorized_client'
      ? `（Google Workspace 管理コンソールで「ドメイン全体の委任」にスコープ ${scope} が登録されていない可能性があります）`
      : data.error === 'invalid_grant'
        ? `（${impersonate} が Google Workspace のユーザーとして存在しないか、Gmail が有効になっていない可能性があります）`
        : '';
    throw new Error(`メール送信の認証に失敗しました: ${data.error_description || data.error || res.status}${hint}`);
  }

  return data.access_token;
}

/** 日本語を含むヘッダーを RFC 2047 で符号化する。 */
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

const wrap76 = (b64) => b64.replace(/(.{76})/g, '$1\r\n');

/**
 * MIME を組み立てる。添付（attachments: [{ filename, content: Buffer, contentType }]）
 * がある場合は multipart/mixed にする。
 */
function buildMime({ to, cc, from, subject, body, replyTo, attachments = [] }) {
  const common = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  // 本文は日本語が入るので base64 にする。76文字ごとに折り返す。
  const encodedBody = wrap76(Buffer.from(body, 'utf8').toString('base64'));

  if (attachments.length === 0) {
    const headers = [...common, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
    return `${headers.join('\r\n')}\r\n\r\n${encodedBody}`;
  }

  const boundary = `----=_Part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`,
    ...attachments.map((a) => {
      // 日本語のファイル名は RFC 2231 / 2047 の両方で付ける（受信側の互換性のため）
      const encodedName = encodeURIComponent(a.filename);
      return `--${boundary}\r\n` +
        `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${encodeHeader(a.filename)}"\r\n` +
        `Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"; filename*=UTF-8''${encodedName}\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n${wrap76(a.content.toString('base64'))}`;
    }),
    `--${boundary}--`,
  ];
  const headers = [...common, `Content-Type: multipart/mixed; boundary="${boundary}"`];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

/**
 * メールを1通送る。
 *
 * 差出人（sendAs）は「ログイン中の本人のアドレス」を渡す。送信控えは本人の
 * Gmail の「送信済み」に残り、返信も本人に直接届く。
 *
 * 重要: sendAs はリクエストの中身から決めてはいけない。必ずサーバーで
 * 検証済みのログイン情報（requireMember が返す user.email）を渡すこと。
 * 画面から指定できる作りにすると、社内の別の人になりすましてメールを
 * 出せてしまう。
 */
export async function sendMail({ sendAs, to, subject, body, replyTo, fromName, cc, attachments }) {
  const { fallbackSender, alwaysCc } = config();

  const sender = sendAs || fallbackSender;
  if (!sender) {
    throw new Error('差出人が決まりません（GMAIL_SENDER が未設定です）');
  }

  // 送信控えのアドレス。差出人自身が入っていても意味がないので除く。
  const ccList = [...new Set([cc, alwaysCc].filter(Boolean))]
    .filter(addr => addr.toLowerCase() !== sender.toLowerCase());

  const token = await getAccessToken(sender);
  const from = fromName ? `${encodeHeader(fromName)} <${sender}>` : sender;

  const raw = base64url(buildMime({
    to,
    cc: ccList.join(', '),
    from,
    subject,
    body,
    replyTo,
    attachments,
  }));

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    },
  );

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`メールを送信できませんでした: ${data.error?.message || res.status}`);
  }

  return { id: data.id, threadId: data.threadId, from: sender, cc: ccList };
}

const SCOPE_READ = 'https://www.googleapis.com/auth/gmail.readonly';

/**
 * 送信メールのスレッドを本人の Gmail から読み、相手（差出人以外）からの返信を返す。
 * ドメイン全体の委任に gmail.readonly のスコープが必要（docs/gmail-setup.md）。
 *
 * @param {string} owner     スレッドを持つ本人のアドレス（＝送信者）。必ずサーバーで検証済みの値を渡す
 * @param {string} threadId  Gmail のスレッドID
 * @returns {Promise<Array<{id:string, from:string, date:string, snippet:string}>>}
 */
export async function findReplies(owner, threadId) {
  const token = await getAccessToken(owner, SCOPE_READ);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner)}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || String(res.status);
    if (res.status === 403 || res.status === 401) {
      throw new Error(`受信の確認に必要な権限がありません（gmail.readonly のスコープを委任してください）: ${msg}`);
    }
    if (res.status === 404) return [];
    throw new Error(`受信を確認できませんでした: ${msg}`);
  }
  const me = owner.toLowerCase();
  const out = [];
  for (const m of data.messages || []) {
    const headers = Object.fromEntries((m.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
    const from = headers.from || '';
    const addr = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
    if (!addr || addr === me) continue;
    // 自分の送信メール（SENT ラベル）は返信ではない
    if ((m.labelIds || []).includes('SENT')) continue;
    out.push({
      id: m.id,
      from,
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : (headers.date || ''),
      snippet: m.snippet || '',
    });
  }
  return out;
}
