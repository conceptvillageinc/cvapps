// freee販売エクスポートの取込スクリプト共通部（見積・納品書用）
// CSV の読み込み、顧客名の運用タグの除去、クライアントマスタとの突合、SQL リテラル
import fs from 'node:fs';

/** RFC4180: 引用符内の改行・カンマ・"" に対応 */
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function readCsvRecords(path, required = []) {
  const raw = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
  const [header, ...lines] = parseCsv(raw);
  for (const col of required) {
    if (!header.includes(col)) { console.error(`CSVに「${col}」列がありません: ${path}`); process.exit(1); }
  }
  return lines.map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ''])));
}

export const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
export const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
export const num = (v) => Math.round(Number(String(v ?? '').replace(/,/g, '')) || 0);

/** 顧客名から【…】タグと「請求書送付先確認中」のような前置きを外す（案件取込と同じ規則） */
const TAG_RE = /【[^】]*】/g;
export function splitTags(name) {
  const tags = ((name || '').match(TAG_RE) || []).join('');
  let rest = (name || '').replace(TAG_RE, '').trim();
  const m = rest.match(/^((?:請求[^\s]*?(?:確認中|要確認))|(?:※[^！!]*[！!]+))/);
  if (m) rest = rest.slice(m[1].length).trim();
  return { tags, name: rest };
}

const CORP = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|学校法人|医療法人|特定非営利活動法人|NPO法人|\(株\)|\(有\)|（株）|（有）|㈱|㈲)/g;
export function normalizeName(name) {
  return (name || '').normalize('NFKC').replace(CORP, '').replace(/[\s　]+/g, '').replace(/[［\[].*?[］\]]/g, '').toLowerCase();
}

/** クライアントマスタ（[{name}]）と突合する。戻り値 { name, how: 'exact'|'partial'|'new'|'blank' } */
export function makeClientResolver(clientsJsonPath) {
  let master = [];
  if (clientsJsonPath) {
    const parsed = JSON.parse(fs.readFileSync(clientsJsonPath, 'utf8'));
    master = [...new Map((Array.isArray(parsed) ? parsed : parsed.entities).map((c) => [c.name, c])).values()];
  }
  const byNorm = new Map();
  for (const c of master) { const k = normalizeName(c.name); if (k && !byNorm.has(k)) byNorm.set(k, c.name); }
  return (freeeName) => {
    const { name } = splitTags(freeeName);
    if (!name) return { name: '（顧客名なし）', how: 'blank' };
    if (master.length === 0) return { name, how: 'exact' };
    if (master.some((c) => c.name === name)) return { name, how: 'exact' };
    const norm = normalizeName(name);
    if (byNorm.has(norm)) return { name: byNorm.get(norm), how: 'exact' };
    if (norm.length >= 4) {
      const wider = [...byNorm.entries()].filter(([k]) => k.includes(norm)).map(([, n]) => n);
      if (wider.length === 1) return { name: wider[0], how: 'partial' };
    }
    return { name, how: 'new' };
  };
}

/** 案件名「顧客名／件名」の顧客名部分を外す（案件取込と同じ規則） */
export function stripClientPrefix(title, clientName) {
  let n = splitTags(title).name;
  if (clientName) {
    for (const sep of ['／', '/', '　', ' ', '_', '＿']) {
      if (n.startsWith(clientName + sep)) return n.slice(clientName.length + sep.length).trim();
    }
    const m = n.match(/^(.+?)[／/]\s*(.+)$/);
    if (m && normalizeName(m[1]) === normalizeName(clientName)) return m[2].trim();
  }
  return n;
}

/** 生成した SQL をチャンクに分けて書く（Supabase の SQL Editor は約1MBまで） */
export function writeSqlChunks({ outPath, rows, chunkSize, header, fn, line }) {
  const chunks = chunkSize > 0 ? Array.from({ length: Math.ceil(rows.length / chunkSize) }, (_, i) => rows.slice(i * chunkSize, (i + 1) * chunkSize)) : [rows];
  const written = [];
  chunks.forEach((chunk, idx) => {
    const lines = [
      ...header(idx + 1, chunks.length),
      'begin;', '', fn, '',
      ...chunk.map(line),
      '', 'commit;',
    ];
    const file = chunks.length > 1 ? outPath.replace(/\.sql$/, '') + `_${idx + 1}.sql` : outPath;
    fs.writeFileSync(file, lines.join('\n') + '\n');
    written.push(file);
  });
  return written;
}
