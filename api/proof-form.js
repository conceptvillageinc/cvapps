import { requirePost, adminClient } from './_lib/guard.js';
import { validateAnswers, resultOf } from '../src/lib/proofForms.js';

// ============================================================================
// POST /api/proof-form（ログイン不要。クライアントが校了フォームを開いて回答する）
//   { action: 'view', token }                 … 受付中のフォームの表示に要る項目だけを返す
//   { action: 'submit', token, answers }      … 答えを確かめて保存し、作った人の受信トレイに知らせる
//
// フォームの URL は推測できない token（/f/<token>）。フォームの作成・停止・回答の閲覧は、
// 社内の画面から（RLS で CV のメンバーだけ）。ここでは金額・社内メモなどは返さない。
// ============================================================================

const MAX_RESPONSES = 30; // 1 つのフォームに受け付ける回答の数（いたずら対策）

async function formByToken(token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ''))) return null;
  const { data } = await adminClient().from('proof_forms').select('*').eq('token', token).maybeSingle();
  return data || null;
}

const publicForm = (f) => ({
  title: f.title,
  description: f.description || '',
  client_name: f.client_name || '',
  project_name: f.project_name || '',
  items: (Array.isArray(f.items) ? f.items : []).map((it) => ({ name: it.name || '', quantity: it.quantity ?? null, unit: it.unit || '' })),
  questions: Array.isArray(f.questions) ? f.questions : [],
  enabled: !!f.enabled,
});

async function view(req, res, body) {
  const form = await formByToken(body.token);
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).json({ form: publicForm(form) });
}

async function submit(req, res, body) {
  const form = await formByToken(body.token);
  if (!form) { res.status(404).json({ error: 'not_found' }); return; }
  if (!form.enabled) { res.status(410).json({ error: 'closed' }); return; }
  const admin = adminClient();
  const { count } = await admin.from('proof_form_responses').select('id', { count: 'exact', head: true }).eq('form_id', form.id);
  if ((count || 0) >= MAX_RESPONSES) { res.status(429).json({ error: 'too_many' }); return; }

  const questions = Array.isArray(form.questions) ? form.questions : [];
  const { ok, errors, clean } = validateAnswers(questions, body.answers || {});
  if (!ok) { res.status(400).json({ error: 'invalid', errors }); return; }
  const result = resultOf(questions, clean);
  const textOf = (id) => (typeof clean[id] === 'string' ? clean[id] : '');
  const { data: saved, error } = await admin.from('proof_form_responses').insert({
    form_id: form.id,
    answers: clean,
    result,
    company_name: textOf('company') || null,
    person_name: textOf('person') || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
  }).select('id').single();
  if (error) throw error;

  // 作った人の受信トレイに知らせる（失敗しても回答は受け付ける）
  if (form.created_by) {
    const who = [textOf('company'), textOf('person')].filter(Boolean).join(' ');
    await admin.from('notifications').insert({
      user_id: form.created_by,
      kind: 'proof_form',
      title: `${form.project_name || form.title}（${result === 'approved' ? '校了' : result === 'revise' ? '修正希望' : '回答'}）`,
      body: `${who ? `${who} 様から` : ''}校了フォームに回答がありました${textOf('note') ? `\n${textOf('note').slice(0, 200)}` : ''}`,
      link: `/proof-forms?form=${form.id}`,
    }).then(() => null, (e) => console.warn('[api/proof-form] notify', e));
  }
  res.status(200).json({ ok: true, id: saved.id, result, confirm_message: form.confirm_message || '' });
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const body = req.body || {};
  try {
    if (body.action === 'view') { await view(req, res, body); return; }
    if (body.action === 'submit') { await submit(req, res, body); return; }
    res.status(400).json({ error: '不明な操作です' });
  } catch (err) {
    console.error('[api/proof-form]', err);
    res.status(500).json({ error: '送信できませんでした。時間をおいてもう一度お試しください' });
  }
}
