import { requireMember, adminClient } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';
import { runBackup } from './_lib/backup.js';

// ============================================================================
// /api/backup
//   GET  … Vercel cron（毎週 日曜 19:00 UTC = 月曜 4:00 JST）。Authorization: Bearer CRON_SECRET
//   POST … システム設定の「今すぐバックアップを作る」（管理者だけ）
//
// 全テーブルの ZIP と Storage のファイルを Google ドライブへ置く（api/_lib/backup.js）。
// 環境変数:
//   BACKUP_DRIVE_FOLDER_ID … 保存先フォルダの ID（ドライブの URL の folders/ の後ろ）
//   BACKUP_DRIVE_OWNER     … そのフォルダの持ち主（既定 info@concept-village.co.jp）。
//                            Workspace のドメイン全体の委任に https://www.googleapis.com/auth/drive が必要
// 結果は system_settings の backup_last に残し、システム設定の画面に出す。
// ============================================================================

const SCOPE = 'https://www.googleapis.com/auth/drive';
const DEFAULT_FOLDER = '13qGrN50sYWjl-O35hH2hcQs9ikyrEm-7';
const DEFAULT_OWNER = 'info@concept-village.co.jp';

async function saveResult(admin, summary, trigger) {
  const value = JSON.stringify({ ...summary, trigger });
  const { data: row } = await admin.from('system_settings').select('id').eq('setting_key', 'backup_last').maybeSingle();
  if (row) await admin.from('system_settings').update({ setting_value: value }).eq('id', row.id);
  else await admin.from('system_settings').insert({ setting_key: 'backup_last', setting_value: value, description: '最後のバックアップの結果（自動）' });
}

export default async function handler(req, res) {
  let trigger;
  if (req.method === 'GET') {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(500).json({ error: 'CRON_SECRET が未設定です' }); return; }
    if (req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: 'unauthorized' }); return; }
    trigger = 'cron';
  } else if (req.method === 'POST') {
    const user = await requireMember(req, res);
    if (!user) return;
    if (user.role !== 'admin') { res.status(403).json({ error: 'バックアップは管理者だけが実行できます' }); return; }
    trigger = `manual:${user.email}`;
  } else {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'GET か POST のみ' });
    return;
  }

  const admin = adminClient();
  const folderId = process.env.BACKUP_DRIVE_FOLDER_ID || DEFAULT_FOLDER;
  const owner = process.env.BACKUP_DRIVE_OWNER || DEFAULT_OWNER;
  try {
    const token = await getAccessToken(owner, SCOPE);
    const summary = await runBackup({ admin, token, folderId });
    await saveResult(admin, summary, trigger);
    res.status(200).json(summary);
  } catch (err) {
    console.error('[api/backup]', err);
    const summary = { at: new Date().toISOString(), failed: true, errors: [err.message || String(err)] };
    try { await saveResult(admin, summary, trigger); } catch { /* 記録できなくても結果は返す */ }
    res.status(500).json({ error: err.message || 'バックアップに失敗しました', ...summary });
  }
}
