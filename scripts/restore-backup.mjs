#!/usr/bin/env node
// ============================================================================
// バックアップの ZIP から、新しい Supabase プロジェクトへ表の中身を戻す。
//
//   使い方:
//     SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//       node scripts/restore-backup.mjs cvapp-db-2026-10-06.zip
//
//   前提: 新しいプロジェクトに supabase/migrations を 0001 から順にすべて実行してあること。
//   ユーザー（users）は認証の ID と結びついているので、新しいプロジェクトでは
//   ログインし直して招待し直す。元のユーザーを指していた列（created_by など）は空にして入れる。
//   同じ id の行があれば上書きする（何度実行しても同じ結果）。
// ============================================================================
import fs from 'node:fs';
import JSZip from 'jszip';
import { TABLES } from '../api/_lib/backup.js';

const [,, zipPath] = process.argv;
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!zipPath || !URL_ || !KEY) {
  console.error('使い方: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-backup.mjs <backup.zip>');
  process.exit(1);
}
const USER_COLS = ['created_by', 'imported_by', 'invited_by', 'reviewer_id', 'review_requested_to_id', 'accepted_by'];

const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
for (const table of TABLES) {
  if (table === 'users') { console.log('users: 飛ばします（新しいプロジェクトで招待し直してください）'); continue; }
  const entry = zip.file(`tables/${table}.json`);
  if (!entry) { console.log(`${table}: ZIP に無いので飛ばします`); continue; }
  const rows = JSON.parse(await entry.async('string'));
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => { const o = { ...r }; for (const c of USER_COLS) if (c in o) o[c] = null; return o; });
    const res = await fetch(`${URL_}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) { console.error(`${table}: ${res.status} ${await res.text()}`); process.exit(2); }
    done += chunk.length;
  }
  console.log(`${table}: ${done} 行`);
}
console.log('完了。Storage のファイルは、ドライブの files/ フォルダから uploads バケットへ戻してください（名前の __ を / に戻す）。');
