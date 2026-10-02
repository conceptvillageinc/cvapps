// 通帳のページの画像（写真・スキャン）から入出金明細を読み取る
import { db } from "@/api/db";

export const PASSBOOK_SCHEMA = {
  type: "object",
  properties: {
    bank_name: { type: "string", description: "通帳に書かれている銀行名。読めなければ空" },
    account_label: { type: "string", description: "支店名・口座種別・口座番号など、通帳に書かれていれば（例「本店営業部 普通 1234567」）。無ければ空" },
    lines: {
      type: "array",
      description: "通帳の行を上から順にすべて。繰越（繰越残高）の行も残高が分かるので含める",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "取引日を YYYY-MM-DD で。通帳の日付は「8-09-30」「R8.9.30」のように令和の年が先に来ることが多い（令和 8 年＝2026 年）。「26-09-30」なら 2026-09-30。年が省略された行は直前の行の年を使う" },
          description: { type: "string", description: "摘要・取引内容・振込人名義（半角カナはそのまま）。無ければ空" },
          amount_out: { type: "number", description: "お支払金額（出金）。無ければ 0" },
          amount_in: { type: "number", description: "お預り金額（入金）。無ければ 0" },
          balance: { type: "number", description: "その行の差引残高。読めなければ 0" },
          kind: { type: "string", enum: ["transaction", "carryover", "unclear"], description: "transaction=通常の取引、carryover=繰越の行、unclear=数字が読み取りにくい行" },
        },
      },
    },
    notes: { type: "string", description: "読みにくい箇所や、ページが途中で切れているなど確認してほしいことがあれば 1〜2 行。無ければ空" },
  },
};

export const PASSBOOK_PROMPT = `添付した画像は銀行の通帳のページです。印字されている行を上から順に、1 行ずつ読み取って JSON で返してください。

【読み取りの決まり】
- 列は通常「日付｜摘要（取引内容・振込人名義）｜お支払金額（出金）｜お預り金額（入金）｜差引残高」の順です。通帳によって列名が違っても、この役割に当てはめてください。
- 日付は YYYY-MM-DD にします。通帳は「8-09-30」「R8.9.30」のように令和の年で印字されることが多く、令和 8 年は 2026 年、令和 7 年は 2025 年です。「26-09-30」のように西暦下 2 桁の場合もあります。年が省略された行は直前の行の年を使ってください。
- 金額はカンマや「*」「¥」を除いた数値にします。出金と入金は別の列なので、どちらに印字されているかで分けてください。
- 「繰越」「繰越残高」の行は kind を carryover にし、残高だけ入れてください。
- 数字が薄い・かすれて読めない行は kind を unclear にし、読める範囲で入れてください。推測で数字を作らないでください。
- 残高の列は、前の行の残高 ± 入出金 と合うはずです。合わない場合は読み間違いの可能性があるので、その行を unclear にしてください。
- 複数ページの画像があるときは、ページの順に続けて読んでください。`;

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : "");
const num = (v) => { const n = Number(String(v ?? "").replace(/[,¥￥*\s]/g, "")); return Number.isFinite(n) ? Math.round(n) : 0; };

/** 画像（複数可）を保管して読み取る。返り値 { bank_name, account_label, lines, notes } */
export async function readPassbook(files) {
  const paths = [];
  for (const f of files) {
    const { file_url } = await db.integrations.Core.UploadFile({ file: f });
    paths.push(file_url);
  }
  const res = await db.integrations.Core.InvokeLLM({ prompt: PASSBOOK_PROMPT, file_urls: paths, response_json_schema: PASSBOOK_SCHEMA });
  const lines = (Array.isArray(res?.lines) ? res.lines : []).map((l, i) => ({
    id: i,
    transaction_date: isoDate(l?.date),
    payee_raw: String(l?.description || "").trim(),
    amount_out: Math.abs(num(l?.amount_out)),
    amount_in: Math.abs(num(l?.amount_in)),
    balance: num(l?.balance),
    kind: ["transaction", "carryover", "unclear"].includes(l?.kind) ? l.kind : "transaction",
    include: l?.kind !== "carryover",
  }));
  // 残高のつながりを確かめる（前の行の残高 + 入金 − 出金 = この行の残高）
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]; const cur = lines[i];
    if (prev.balance && cur.balance) cur.balance_ok = prev.balance + cur.amount_in - cur.amount_out === cur.balance;
  }
  return { bank_name: String(res?.bank_name || ""), account_label: String(res?.account_label || ""), lines, notes: String(res?.notes || "") };
}
