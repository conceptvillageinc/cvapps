import crypto from 'node:crypto';

// ============================================================================
// 会社の Google Workspace からメールを送る
//
// サービスアカウントに「ドメイン全体の委任」を設定し、社内のメールボックス
// （例: info@concept-village.co.jp）になりすまして送信する。
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

function config() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Vercel の環境変数では改行を \n と書くため、実際の改行に戻す
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const sender = process.env.GMAIL_SENDER;

  const missing = [
    !clientEmail && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !privateKey && 'GOOGLE_PRIVATE_KEY',
    !sender && 'GMAIL_SENDER',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `メール送信の設定が未完了です（未設定: ${missing.join(' / ')}）。` +
      'Vercel の環境変数を確認してください（VITE_ は付けないこと）。'
    );
  }

  return { clientEmail, privateKey, sender };
}

/** メール送信が設定済みか。未設定でも画面を壊さないための判定に使う。 */
export function isMailConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GMAIL_SENDER
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
async function getAccessToken() {
  const { clientEmail, privateKey, sender } = config();
  const now = Math.floor(Date.now() / 1000);

  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    // 委任により、この人が送ったことにする
    sub: sender,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey);
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
    const hint = data.error === 'unauthorized_client'
      ? '（Google Workspace 管理コンソールで「ドメイン全体の委任」が未設定の可能性があります）'
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

function buildMime({ to, from, subject, body, replyTo }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);

  // 本文は日本語が入るので base64 にする。76文字ごとに折り返す。
  const encoded = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}

/**
 * メールを1通送る。
 * 差出人は GMAIL_SENDER 固定。呼び出し側が任意の差出人を指定できると、
 * 会社のドメインを騙ったメールを出せてしまうため。
 */
export async function sendMail({ to, subject, body, replyTo, fromName }) {
  const { sender } = config();
  const token = await getAccessToken();

  const from = fromName ? `${encodeHeader(fromName)} <${sender}>` : sender;
  const raw = base64url(buildMime({ to, from, subject, body, replyTo }));

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

  return { id: data.id, from: sender };
}
