import { adminClient } from './_lib/guard.js';

// ============================================================================
// GET /api/meetings-cleanup  （Vercel cron: 毎日 18:00 UTC = 翌 3:00 JST）
//
// 保存期限（retention_until）を過ぎた議事録の音声だけを削除する。
// 文字起こしと議事録は残す。
// ============================================================================

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(500).json({ error: 'CRON_SECRET が未設定です' }); return; }
  if (req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: 'unauthorized' }); return; }

  const admin = adminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: expired, error } = await admin
    .from('meetings')
    .select('id, audio_path')
    .lte('retention_until', today)
    .is('audio_deleted_at', null)
    .in('status', ['draft', 'finalized', 'error']);
  if (error) { res.status(500).json({ error: error.message }); return; }

  let deleted = 0;
  for (const m of expired || []) {
    const paths = [];
    if (m.audio_path) paths.push(m.audio_path);
    const { data: segs } = await admin.from('meeting_segments').select('id, storage_path').eq('meeting_id', m.id);
    for (const s of segs || []) if (s.storage_path) paths.push(s.storage_path);
    if (paths.length > 0) await admin.storage.from('uploads').remove(paths);
    await admin.from('meeting_segments').update({ storage_path: '' }).eq('meeting_id', m.id);
    await admin.from('meetings').update({ audio_path: null, audio_deleted_at: new Date().toISOString() }).eq('id', m.id);
    deleted += 1;
  }
  res.status(200).json({ checked: (expired || []).length, deleted });
}
