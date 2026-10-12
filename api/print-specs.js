import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';
import { parseTabName, isMarkYellow } from './_lib/costSheet.js';
import { specSheetRows } from '../src/lib/printSpecList.js';

// ============================================================================
// POST /api/print-specs  印刷仕様の一覧（価格調べ）の出力
//
//   { action: 'tabs', spreadsheet_id }
//       原価計算表のタブの一覧（名前・入稿済か）
//   { action: 'new_tab', spreadsheet_id, title }
//       テンプレート（システム設定 cost_sheet_template_url のタブ。無ければ同じファイルの「テンプレ」「原本」のタブ）を
//       写して新しいタブを作る。いちばん左に置く。
//   { action: 'write', spreadsheet_id, sheet_id, rows: [{ group, date, author, name, memo, cost_unit, qty, unit, markup, vendor, url }] }
//       「【パッケージ1.3掛】印刷費」（group=package）／「【パッケージ以外の制作物】」（group=other）の見出しの下の
//       空いている行に書く。書くのは入力欄（記入日時・記入者・項目・備考・金額・単価・数量・仕入先・URL。単位と掛け率は空のときだけ）。
//       計算式の列（仕入計・売価・粗利など）は触らない。空いている行が足りなければ、空いている行（無ければ最後の行）を写して足す。
//   { action: 'export', list, rules, author }
//       社内見積と同じ並びで、新しいスプレッドシート（依頼した人のマイドライブ）に書き出す。
//
// Google には、ログインしている人として（ドメイン全体の委任）アクセスする。
// ============================================================================

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'].join(' ');
const END_RE = /見積り?作成注意事項|注意事項チェック/;
const COLS = 'ABCDEFGHIJKLMNOPQRST';
const ci = (letter) => COLS.indexOf(letter);
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const quoteTab = (t) => `'${String(t).replace(/'/g, "''")}'`;

async function gapi(token, url, options = {}) {
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || `Google API エラー (${r.status})`;
    throw new Error(r.status === 403 || r.status === 404 ? `スプレッドシートを開けませんでした。ログイン中のアカウントで編集できるか確認してください（${msg}）` : msg);
  }
  return data;
}

async function sheetMeta(token, id) {
  return gapi(token, `${SHEETS}/${id}?fields=properties.title,spreadsheetUrl,sheets.properties(sheetId,title,index,hidden,gridProperties.rowCount)`);
}

/** URL「…/spreadsheets/d/<id>/edit#gid=<gid>」→ { id, gid } */
function parseSheetUrl(u) {
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(String(u || ''))?.[1];
  const gid = /[#&?]gid=(\d+)/.exec(String(u || ''))?.[1];
  return id ? { id, gid: gid !== undefined ? Number(gid) : null } : null;
}

async function tabs(token, body) {
  const meta = await sheetMeta(token, body.spreadsheet_id);
  return {
    file_title: meta.properties?.title || '',
    url: meta.spreadsheetUrl,
    tabs: (meta.sheets || []).map((s) => s.properties).filter((p) => !p.hidden).sort((a, b) => a.index - b.index)
      .map((p) => ({ sheet_id: p.sheetId, title: p.title, index: p.index, ...parseTabName(p.title) })),
  };
}

async function newTab(token, body, admin) {
  const id = body.spreadsheet_id;
  const title = str(body.title).slice(0, 90);
  if (!title) throw new Error('タブの名前を入れてください');
  const meta = await sheetMeta(token, id);
  if ((meta.sheets || []).some((s) => s.properties.title === title)) throw new Error(`「${title}」というタブはもうあります`);

  // テンプレート: システム設定の URL → 同じファイルの「テンプレ」「原本」のタブ
  const { data: setting } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'cost_sheet_template_url').maybeSingle();
  const tpl = parseSheetUrl(setting?.setting_value);
  let newId;
  if (tpl) {
    let gid = tpl.gid;
    if (gid === null) gid = (await sheetMeta(token, tpl.id)).sheets?.[0]?.properties?.sheetId ?? 0;
    const copied = await gapi(token, `${SHEETS}/${tpl.id}/sheets/${gid}:copyTo`, { method: 'POST', body: JSON.stringify({ destinationSpreadsheetId: id }) });
    newId = copied.sheetId;
  } else {
    const local = (meta.sheets || []).map((s) => s.properties).find((p) => /テンプレ|原本|ひな形|雛形/.test(p.title));
    if (!local) throw new Error('新しいタブの元にするテンプレートが登録されていません。システム設定の「社内見積の取り込み」で、原価計算表のテンプレートのタブの URL を登録してください');
    const r = await gapi(token, `${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ duplicateSheet: { sourceSheetId: local.sheetId, insertSheetIndex: 0, newSheetName: title } }] }) });
    newId = r.replies?.[0]?.duplicateSheet?.properties?.sheetId;
    return { sheet_id: newId, title, url: `${meta.spreadsheetUrl}#gid=${newId}` };
  }
  await gapi(token, `${SHEETS}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: newId, title, index: 0 }, fields: 'title,index' } }] }),
  });
  return { sheet_id: newId, title, url: `${meta.spreadsheetUrl}#gid=${newId}` };
}

/** タブの行を読んで、印刷費の見出しの範囲と空いている行を探す */
export function findGroups(values) {
  const rows = values || [];
  const heads = [];
  let end = rows.length;
  for (let i = 7; i < rows.length; i++) { // 8 行目から
    const b = str(rows[i]?.[ci('B')]);
    if (!b) continue;
    if (END_RE.test(b)) { end = i; break; }
    if (/^【/.test(b) || /^コンセプト設計費$/.test(b)) heads.push({ title: b, start: i });
  }
  const groups = heads.map((h, k) => ({ ...h, end: (heads[k + 1]?.start ?? end) - 1 })); // end は含む（0 始まり）
  const kindOf = (t) => (/^【\s*パッケージ以外/.test(t) ? 'other' : /^【\s*パッケージ/.test(t) && /印刷/.test(t) ? 'package' : null);
  const out = {};
  for (const g of groups) {
    const kind = kindOf(g.title);
    if (!kind || out[kind]) continue;
    const isEmpty = (i) => {
      const r = rows[i] || [];
      // 記入者の欄は、空のときプルダウンの「記入者」が入っていることがある
      return !/^【/.test(str(r[ci('B')])) && ['D', 'F', 'G'].every((c) => str(r[ci(c)]) === '') && /^(記入者)?$/.test(str(r[ci('E')])) && (str(r[ci('H')]) === '' || Number(r[ci('H')]) === 0);
    };
    const empty = [];
    for (let i = g.start + 1; i <= g.end; i++) if (isEmpty(i)) empty.push(i);
    out[kind] = { ...g, empty };
  }
  return out;
}

async function write(token, body) {
  const id = body.spreadsheet_id;
  const rows = Array.isArray(body.rows) ? body.rows.filter((r) => str(r.name)) : [];
  if (rows.length === 0) throw new Error('書き込む行がありません');
  const meta = await sheetMeta(token, id);
  const tab = (meta.sheets || []).map((s) => s.properties).find((p) => p.sheetId === Number(body.sheet_id));
  if (!tab) throw new Error('タブが見つかりません（名前を変えたか、消した可能性があります）');
  const range = `${quoteTab(tab.title)}!A1:T${tab.gridProperties?.rowCount || 400}`;
  const read = async () => (await gapi(token, `${SHEETS}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`)).values || [];

  let values = await read();
  let groups = findGroups(values);
  const missing = ['package', 'other'].filter((k) => rows.some((r) => r.group === k) && !groups[k]);
  if (missing.length) throw new Error(`このタブに印刷費の見出し（${missing.map((k) => (k === 'package' ? '【パッケージ1.3掛】印刷費' : '【パッケージ以外の制作物】')).join('・')}）が見つかりません。原価計算表のテンプレートのタブか確認してください`);

  // 空いている行が足りない区分は、行を足す（下の区分から足すと、上の区分の行番号がずれない）
  for (const kind of ['other', 'package']) {
    const need = rows.filter((r) => r.group === kind).length - (groups[kind]?.empty.length || 0);
    if (!groups[kind] || need <= 0) continue;
    const g = groups[kind];
    const src = g.empty.length ? g.empty[g.empty.length - 1] : g.end; // 写す元: 空いている行（無ければ最後の行）
    const at = g.end; // 最後の行の上に入れる（区分の結合セルの中に入る）
    const srcAfter = src >= at ? src + need : src;
    const requests = [
      { insertDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: at, endIndex: at + need }, inheritFromBefore: true } },
      { copyPaste: { source: { sheetId: tab.sheetId, startRowIndex: srcAfter, endRowIndex: srcAfter + 1, startColumnIndex: 2, endColumnIndex: 20 }, destination: { sheetId: tab.sheetId, startRowIndex: at, endRowIndex: at + need, startColumnIndex: 2, endColumnIndex: 20 }, pasteType: 'PASTE_NORMAL' } },
    ];
    await gapi(token, `${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    // 埋まった行を写したときは、計算式でない値（NO.・入力済みの値・最終納品の印）と入稿の黄色を消す
    if (!g.empty.length) {
      const srcRow = values[g.end] || [];
      const clear = [];
      for (const c of 'CDEFGHIKMNOPQRST') {
        const v = srcRow[ci(c)];
        if (v !== undefined && v !== '' && !String(v).startsWith('=')) clear.push(`${quoteTab(tab.title)}!${c}${at + 1}:${c}${at + need}`);
      }
      if (clear.length) await gapi(token, `${SHEETS}/${id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: clear }) });
      const fmt = await gapi(token, `${SHEETS}/${id}?ranges=${encodeURIComponent(`${quoteTab(tab.title)}!C${at + 1}:G${at + 1}`)}&fields=sheets.data.rowData.values.effectiveFormat.backgroundColor`);
      const bgs = fmt.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
      const hex = (c) => [c?.red, c?.green, c?.blue].map((x) => Math.round((x ?? 1) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
      if (bgs.some((v) => isMarkYellow(hex(v.effectiveFormat?.backgroundColor)))) {
        await gapi(token, `${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: tab.sheetId, startRowIndex: at, endRowIndex: at + need, startColumnIndex: 2, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } }, fields: 'userEnteredFormat.backgroundColor' } }] }) });
      }
    }
    values = await read();
    groups = findGroups(values);
  }

  // 入力欄だけに書く
  const data = [];
  const written = [];
  const used = { package: 0, other: 0 };
  for (const r of rows) {
    const g = groups[r.group];
    const i = g.empty[used[r.group]++];
    const n = i + 1; // シートの行番号
    const cur = values[i] || [];
    data.push({ range: `${quoteTab(tab.title)}!D${n}:I${n}`, values: [[r.date ?? '', r.author ?? '', r.name ?? '', r.memo ?? '', r.cost_unit ?? '', r.qty ?? '']] });
    if (str(cur[ci('J')]) === '' && r.unit) data.push({ range: `${quoteTab(tab.title)}!J${n}`, values: [[r.unit]] });
    if (str(cur[ci('L')]) === '' && r.markup) data.push({ range: `${quoteTab(tab.title)}!L${n}`, values: [[r.markup]] });
    if (r.vendor || r.url) data.push({ range: `${quoteTab(tab.title)}!R${n}:S${n}`, values: [[r.vendor ?? '', r.url ?? '']] });
    written.push({ row: n, name: r.name, group: r.group });
  }
  await gapi(token, `${SHEETS}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  const first = Math.min(...written.map((w) => w.row));
  return { tab: tab.title, written, url: `${meta.spreadsheetUrl}#gid=${tab.sheetId}&range=F${first}` };
}

async function exportSheet(token, body) {
  const list = body.list || {};
  if (!Array.isArray(list.items) || list.items.length === 0) throw new Error('書き出す行がありません');
  const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const values = specSheetRows(list, body.rules, { author: str(body.author), date });
  const created = await gapi(token, SHEETS, {
    method: 'POST',
    body: JSON.stringify({ properties: { title: `印刷仕様の一覧_${list.client_name || ''}_${list.title || ''}_${date}`, locale: 'ja_JP' }, sheets: [{ properties: { title: '印刷仕様', gridProperties: { frozenRowCount: 4 } } }] }),
  });
  const gid = created.sheets?.[0]?.properties?.sheetId ?? 0;
  await gapi(token, `${SHEETS}/${created.spreadsheetId}/values/${encodeURIComponent('印刷仕様!A1')}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ range: '印刷仕様!A1', majorDimension: 'ROWS', values }) });
  await gapi(token, `${SHEETS}/${created.spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat' } },
      { repeatCell: { range: { sheetId: gid, startRowIndex: 3, endRowIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.99, green: 0.9, blue: 0.8 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
      { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
    ] }),
  });
  return { url: created.spreadsheetUrl };
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  try {
    const body = req.body || {};
    const action = body.action;
    if (['tabs', 'new_tab', 'write'].includes(action) && !/^[a-zA-Z0-9_-]{20,}$/.test(String(body.spreadsheet_id || ''))) {
      res.status(400).json({ error: 'スプレッドシートの指定が正しくありません' });
      return;
    }
    const token = await getAccessToken(user.email, SCOPES);
    let out;
    if (action === 'tabs') out = await tabs(token, body);
    else if (action === 'new_tab') out = await newTab(token, body, adminClient());
    else if (action === 'write') out = await write(token, body);
    else if (action === 'export') out = await exportSheet(token, body);
    else { res.status(400).json({ error: `不明な操作です: ${action}` }); return; }
    res.status(200).json(out);
  } catch (err) {
    console.error('[api/print-specs]', err);
    res.status(500).json({ error: err.message || '出力に失敗しました' });
  }
}
