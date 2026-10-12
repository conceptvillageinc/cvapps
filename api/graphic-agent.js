import { requireMember, requirePost } from './_lib/guard.js';
import { claude, normalizeSchema, textOf, aiError } from './_lib/claude.js';
import { AGENT_STEP_SCHEMA, agentSystemPrompt, agentStepPrompt, guardAction } from '../src/lib/graphicAgent.js';

// ============================================================================
// POST /api/graphic-agent  グラフィックの価格を調べる AI の「次の 1 手」
//
//   { item, snapshot: { url, title, text, elements }, history: [...], step }
//     → { action: goto|click|select|type|submit|scroll|back|done|fail, element_id, value, url, result, reason }
//
// ブラウザの操作そのものは、社員の Chrome に入れた「CV AX KIT アシスタント」（拡張機能）が行う。
// このサーバーはグラフィックに一切アクセスしない（ページの中身は拡張機能が読んで送ってくる）。
// 1 手ごとに呼ぶので速さを優先し、effort は low。
// ============================================================================

const AGENT_MODEL = 'claude-opus-5-5';

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  try {
    const { item, snapshot, history = [], step = 0 } = req.body || {};
    if (!item || !snapshot) { res.status(400).json({ error: 'item と snapshot が必要です' }); return; }
    const message = await claude().beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: normalizeSchema(AGENT_STEP_SCHEMA) } },
      system: agentSystemPrompt(),
      messages: [{ role: 'user', content: agentStepPrompt({ item, snapshot, history, step }) }],
    });
    if (message.stop_reason === 'refusal') { res.status(200).json({ action: 'fail', reason: 'AI が回答を控えました' }); return; }
    let out;
    try { out = JSON.parse(textOf(message)); } catch { res.status(502).json({ error: 'AI の回答を読み取れませんでした' }); return; }
    res.status(200).json(guardAction(out, snapshot));
  } catch (err) {
    console.error('[api/graphic-agent]', err);
    const e = aiError(err);
    res.status(e.status).json({ error: e.message, fatal: e.fatal });
  }
}
