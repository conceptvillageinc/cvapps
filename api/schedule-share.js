import crypto from 'node:crypto';
import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { partiesOf, keyDatesOf, clientTasks, memberShortName, scheduleTitle } from '../src/lib/schedule.js';

// ============================================================================
// POST /api/schedule-share
//   { action: 'view', token, password? }          … ログイン不要。クライアント向けの工程表を返す
//   { action: 'configure', project_id, enabled?, password?, clear_password?, expires_at? }  … 社内メンバーのみ
//   { action: 'regenerate', project_id }          … 社内メンバーのみ。URL を作り直す（前の URL は開けなくなる）
//
// 共有リンクは推測できない URL（/s/<token>）。通常は URL だけで開け、設定でパスワード・期限を付けられる。
// 返すのは「工程表に出す」工程だけで、社内メモ・見込み／実績時間・金額などは返さない。
// ============================================================================

const newToken = () => crypto.randomBytes(18).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(pw || ''), Buffer.from(saltHex, 'hex'), want.length);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const todayJst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

/** 社内の画面に返す共有の設定（パスワードそのものは返さない） */
const publicShare = (s) => (s ? { id: s.id, project_id: s.project_id, token: s.token, enabled: s.enabled, has_password: !!s.password_hash, expires_at: s.expires_at, updated_at: s.updated_at } : null);

async function view(req, res, body) {
  const token = String(body.token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) { res.status(404).json({ error: 'not_found' }); return; }
  const admin = adminClient();
  const { data: share } = await admin.from('schedule_shares').select('*').eq('token', token).maybeSingle();
  if (!share || !share.enabled) { res.status(404).json({ error: 'not_found' }); return; }
  if (share.expires_at && share.expires_at < todayJst()) { res.status(410).json({ error: 'expired' }); return; }
  if (share.password_hash) {
    if (!body.password) { res.status(401).json({ error: 'needs_password' }); return; }
    if (!checkPassword(body.password, share.password_hash)) {
      await new Promise((r) => setTimeout(r, 800)); // 総当たりを遅くする
      res.status(401).json({ error: 'wrong_password' });
      return;
    }
  }
  const { data: project } = await admin.from('projects').select('id, name, client_name, schedule_settings').eq('id', share.project_id).maybeSingle();
  if (!project) { res.status(404).json({ error: 'not_found' }); return; }
  const { data: tasks } = await admin.from('project_tasks').select('*').eq('project_id', project.id).order('sort_order').order('created_at');
  const { data: users } = await admin.from('users').select('id, full_name, short_name, avatar_url');
  const { data: holidayRow } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'company_holidays').maybeSingle();
  let holidays = [];
  try { holidays = holidayRow ? JSON.parse(holidayRow.setting_value) : []; } catch { holidays = []; }
  const byId = new Map((users || []).map((u) => [u.id, u]));
  const updated = [...(tasks || []).map((t) => t.updated_at), share.updated_at].filter(Boolean).sort().pop();

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).json({
    title: scheduleTitle(project),
    client_name: project.client_name || '',
    key_dates: keyDatesOf(project),
    parties: partiesOf(project),
    tasks: clientTasks(tasks || [], (id) => memberShortName(byId.get(id)), (id) => byId.get(id)?.avatar_url || ''),
    company_holiday_lines: Array.isArray(holidays) ? holidays.map(String) : [],
    updated_at: updated || null,
  });
}

async function configure(req, res, body, user, { regenerate = false } = {}) {
  const projectId = body.project_id;
  if (!projectId) { res.status(400).json({ error: 'project_id を指定してください' }); return; }
  const admin = adminClient();
  const { data: project } = await admin.from('projects').select('id').eq('id', projectId).maybeSingle();
  if (!project) { res.status(404).json({ error: '案件が見つかりません' }); return; }
  const { data: cur } = await admin.from('schedule_shares').select('*').eq('project_id', projectId).maybeSingle();

  const patch = {};
  if (!cur || regenerate) patch.token = newToken();
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.clear_password) patch.password_hash = null;
  else if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 4 || body.password.length > 64) { res.status(400).json({ error: 'パスワードは 4〜64 文字にしてください' }); return; }
    patch.password_hash = hashPassword(body.password);
  }
  if ('expires_at' in body) {
    const v = body.expires_at || null;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { res.status(400).json({ error: '期限の日付が正しくありません' }); return; }
    patch.expires_at = v;
  }

  let saved;
  if (cur) {
    const { data, error } = await admin.from('schedule_shares').update(patch).eq('id', cur.id).select('*').single();
    if (error) throw error;
    saved = data;
  } else {
    const { data, error } = await admin.from('schedule_shares').insert({ project_id: projectId, enabled: true, created_by: user.email, ...patch }).select('*').single();
    if (error) throw error;
    saved = data;
  }
  res.status(200).json({ share: publicShare(saved) });
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const body = req.body || {};
  try {
    if (body.action === 'view') { await view(req, res, body); return; }
    const user = await requireMember(req, res);
    if (!user) return;
    if (body.action === 'get') {
      const { data } = await adminClient().from('schedule_shares').select('*').eq('project_id', body.project_id).maybeSingle();
      res.status(200).json({ share: publicShare(data) });
      return;
    }
    if (body.action === 'configure') { await configure(req, res, body, user); return; }
    if (body.action === 'regenerate') { await configure(req, res, body, user, { regenerate: true }); return; }
    res.status(400).json({ error: '不明な操作です' });
  } catch (err) {
    console.error('[api/schedule-share]', err);
    res.status(500).json({ error: err.message || '共有リンクの処理に失敗しました' });
  }
}
