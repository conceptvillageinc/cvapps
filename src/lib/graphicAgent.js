// ============================================================================
// グラフィックの価格を調べる AI（画面とサーバーの両方で使う）
//   拡張機能が開いたグラフィックのページを読み（要素に番号を振ったもの＋本文）、AI が次の 1 手を決める。
//   決まりごと:
//     - グラフィック（www.graphic.jp）の中だけを見る
//     - ログイン・会員登録・カート・注文・入稿・お問い合わせの送信はしない（ここで止める）
//     - 1 品目あたりの手数に上限を設け、操作の間は数秒あける（拡張機能の側）
// ============================================================================

export const GRAPHIC_ORIGIN = "https://www.graphic.jp";
export const GRAPHIC_START_URL = "https://www.graphic.jp/";
export const MAX_STEPS = 30;

/** 押してはいけないもの（言葉で止める） */
export const FORBIDDEN_RE = /カート|注文|購入|ログイン|ログアウト|会員登録|新規登録|入稿|お支払|決済|申し?込|送信する|確定する|お問い?合わせ|退会|パスワード/;

export const isGraphicUrl = (u) => {
  try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === "www.graphic.jp" || x.hostname === "graphic.jp"); } catch { return false; }
};

export const AGENT_STEP_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["goto", "click", "select", "type", "submit", "scroll", "back", "done", "fail"], description: "次の操作" },
    element_id: { type: "string", description: "操作する要素の番号（click / select / type / submit）。それ以外は空" },
    value: { type: "string", description: "select なら選ぶ選択肢の value、type なら入れる文字。それ以外は空" },
    url: { type: "string", description: "goto のときだけ。https://www.graphic.jp/ で始まる URL" },
    reason: { type: "string", description: "この操作をする理由（日本語で 1 文）" },
    result: {
      type: "object",
      description: "done のときだけ入れる。それ以外は 0 と空文字",
      properties: {
        price_ex_tax: { type: "number", description: "指定の数量の価格（税抜・円・送料別）" },
        price_inc_tax: { type: "number", description: "同じ価格の税込（ページにあれば）" },
        quantity: { type: "number", description: "その価格の数量" },
        product: { type: "string", description: "グラフィックの商品名" },
        condition: { type: "string", description: "価格の条件（サイズ・用紙・色数・加工・数量・納期（営業日））を短く" },
        differences: { type: "string", description: "依頼の仕様と違うところ（近い規格で見た・数量が表に無い など）。無ければ空" },
      },
    },
  },
  required: ["action", "reason"],
};

export function agentSystemPrompt() {
  return `あなたは印刷会社の見積担当のアシスタントです。ネット印刷「グラフィック」（https://www.graphic.jp/）のサイトをブラウザで操作して、指定の印刷物の価格を調べます。
毎回、いま開いているページの中身（番号付きの操作できる要素と本文）が渡されるので、次の 1 手だけを JSON で返してください。

【進め方】
- トップページの商品メニューや商品一覧から、印刷物に合う商品のページへ進みます。サイト内検索があれば使ってかまいません。
- 商品ページでは、サイズ・用紙・色数・加工・部数（数量）・納期などの選択肢を、依頼の仕様に合わせて選びます。選ぶと価格表や合計金額が更新されます。
- 価格が分かったら action=done にし、result に税抜の価格（送料は含めない）と条件を入れます。ページに税込しか無ければ税込を price_inc_tax に入れ、price_ex_tax は 0 にします。
- 納期は、依頼の納期に間に合う中で一番安いもの。納期の指定が無ければ、通常（標準）の納期にします。
- 依頼とまったく同じ規格が無いときは、いちばん近い規格で価格を出し、違いを differences に書きます（例: 規格外サイズなので A3 で見た）。
- 数量が価格表に無いときは、表にある一番近い数量の価格を出し、differences に書きます。
- 何度か試しても合う商品が見つからない、ページが読めないときは action=fail にして理由を書きます。

【ページの見方】
- 【価格表（表）】に、ページの表が「セル | セル | …」の行で入っています。ネット印刷の価格表は、行が部数（数量）、列が納期（営業日）のことが多いです。見出しの行と、依頼の数量の行が交わるところの金額を読みます。
- 選択肢を選んでも【価格表】や本文の金額が変わらないときは、「価格を表示」「料金を見る」「再計算」のようなボタンが無いか、ページの下の方（scroll）に表が無いかを確かめます。
- [メニュー] と付いた要素は、ヘッダー・フッターのメニューです。商品ページに着いたら、メニューではなく本文の要素を使います。
- 同じページに 3 回以上来ている、または同じ選択を 2 回以上しているときは、やり方を変えます（別の商品ページ・別の選択肢・表の中の近い条件の金額を読む）。近い条件の金額が読めているなら、それで done にして違いを differences に書くほうが、何も分からないよりよいです。

【してはいけないこと】
- ログイン・会員登録・カートに入れる・注文・入稿・データ送信・お問い合わせなど、サイトに何かを申し込む操作は絶対にしません（価格を見るだけです）。
- グラフィック（www.graphic.jp）以外のサイトへは移動しません。
- 同じ操作を何度も繰り返さないでください。履歴を見て、うまくいかなかった操作は別の方法に変えます。`;
}

const clip = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n)}…` : String(s || ""));

/** スナップショットを AI に渡す文字にする（長いページは本文と要素の数をしぼる） */
export function snapshotText(snap, { maxElements = 360, maxText = 10000 } = {}) {
  const els = (snap?.elements || []).slice(0, maxElements).map((e) => {
    const parts = [`[${e.id}]${e.nav ? "[メニュー]" : ""} ${e.tag}${e.type ? `(${e.type})` : ""}${e.disabled ? "(選べない)" : ""}`];
    if (e.label) parts.push(`label="${clip(e.label, 40)}"`);
    if (e.text) parts.push(`"${clip(e.text, 60)}"`);
    if (e.href) parts.push(`→ ${clip(e.href, 80)}`);
    if (e.value) parts.push(`value="${clip(e.value, 30)}"`);
    if (e.checked) parts.push("✓選択中");
    if (e.options?.length) parts.push(`選択肢: ${e.options.slice(0, 40).map((o) => `${o.selected ? "★" : ""}${clip(o.text, 24)}(${clip(o.value, 20)})`).join(" / ")}`);
    return parts.join(" ");
  });
  const tables = (snap?.tables || []).slice(0, 6).map((t, i) => `表${i + 1}${t.title ? `「${clip(t.title, 40)}」` : ""}\n${t.rows.slice(0, 30).map((r) => clip(r, 260)).join("\n")}`).join("\n\n");
  return `URL: ${snap?.url || ""}
タイトル: ${snap?.title || ""}

【操作できる要素】（番号で指定。本文の要素が先、[メニュー] は後ろ）
${els.join("\n")}

【価格表（表）】
${tables || "（表はありません）"}

【ページの本文】（ヘッダー・メニューを除く）
${clip(snap?.text, maxText)}`;
}

export function agentStepPrompt({ item, snapshot, history, step }) {
  const spec = [
    `品目: ${item.name || ""}`,
    `印刷物種別: ${item.print_type || "（未設定）"}`,
    `サイズ: ${item.size || "（未定）"}`,
    `用紙: ${item.paper || "（未定）"}`,
    `色数: ${item.colors || "（未定）"}`,
    `加工: ${item.finishing || "なし"}`,
    `数量: ${item.quantity || "（未定）"}${item.unit || ""}`,
    `納期: ${item.due || "（指定なし）"}`,
    item.notes ? `補足: ${item.notes}` : "",
  ].filter(Boolean).join("\n");
  // 同じページ・同じ操作の繰り返しを数えて知らせる
  const visits = new Map();
  for (const h of history || []) if (h.page) visits.set(h.page, (visits.get(h.page) || 0) + 1);
  const here = (() => { try { const u = new URL(snapshot?.url || ""); return u.pathname + u.search; } catch { return ""; } })();
  const loopNote = (visits.get(here) || 0) >= 3 ? `\n※ このページでの操作は ${visits.get(here)} 回目です。同じことを繰り返さず、やり方を変えてください。` : "";
  const hist = (history || []).slice(-15).map((h, i) => `${i + 1}. ${h.action}${h.target ? ` 「${clip(h.target, 30)}」` : ""}${h.value ? ` = ${clip(h.value, 30)}` : ""}${h.url ? ` ${h.url}` : ""} → ${h.outcome || "ok"}`).join("\n");
  return `【調べる印刷物】
${spec}

【これまでの操作】（${step} 手目 / 上限 ${MAX_STEPS} 手）
${hist || "（まだ何もしていません）"}${loopNote}

【いまのページ】
${snapshotText(snapshot)}

次の 1 手を JSON で返してください。`;
}

/**
 * AI の操作を確かめる（してはいけない操作・グラフィック以外への移動・無い要素を止める）。
 * 止めたときは action=blocked と理由を返し、呼び出し側は履歴に残して次の手を聞き直す。
 */
export function guardAction(a, snapshot) {
  const out = { action: a?.action || "fail", element_id: String(a?.element_id ?? ""), value: String(a?.value ?? ""), url: String(a?.url ?? ""), reason: String(a?.reason ?? ""), result: a?.result || null };
  const el = (snapshot?.elements || []).find((e) => String(e.id) === out.element_id);
  if (["click", "select", "type", "submit"].includes(out.action)) {
    if (!el) return { ...out, action: "blocked", reason: `要素 ${out.element_id} がページにありません` };
    const words = [el.text, el.label, el.value, el.href].filter(Boolean).join(" ");
    // ボタン・リンクだけ言葉で止める（ラジオボタンの「入稿翌日発送」のような納期の選択肢は選べるように）
    const isButtonLike = el.tag === "a" || el.tag === "button" || ["submit", "button", "image"].includes(el.type) || el.role === "button";
    if (FORBIDDEN_RE.test(words) && isButtonLike && out.action !== "select") return { ...out, action: "blocked", reason: `「${clip(words, 30)}」は申し込み・ログインなどの操作なので押しません` };
    if (el.href && !isGraphicUrl(new URL(el.href, GRAPHIC_ORIGIN).toString())) return { ...out, action: "blocked", reason: "グラフィック以外のサイトへのリンクです" };
  }
  if (out.action === "goto" && !isGraphicUrl(out.url)) return { ...out, action: "blocked", reason: "グラフィック以外の URL には移動しません" };
  return out;
}

/** done の結果 → 一覧の行に入れる値 */
export function resultToRow(result, pageUrl) {
  const ex = Number(result?.price_ex_tax) || 0;
  const inc = Number(result?.price_inc_tax) || 0;
  const cost = ex > 0 ? Math.round(ex) : inc > 0 ? Math.floor(inc / 1.1) : 0;
  const note = [result?.product, result?.condition, result?.differences ? `※${result.differences}` : "", ex === 0 && inc > 0 ? "※税込から税抜に直した" : ""].filter(Boolean).join("　");
  return { cost_total: cost || "", price_url: pageUrl || "", price_note: note, vendor: "グラフィック", needs_check: !!result?.differences || !cost };
}
