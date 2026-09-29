import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { transcribeAudio, isGeminiConfigured } from './_lib/gemini.js';
import { claude, MODEL, normalizeSchema, textOf } from './_lib/claude.js';

// ============================================================================
// POST /api/meeting-process  { meeting_id }
//
// 議事録の処理を進める。1 回の呼び出しで時間の許す範囲だけ進め、続きがあれば
// { done: false } を返す。画面は done になるまで繰り返し呼ぶ（閉じても、次に
// 開いたときに続きから再開できる）。
//
//   1. transcribing  録音の断片（meeting_segments）またはアップロード音声を
//                    Gemini で文字起こし（断片ごと。時刻は結合時に補正）
//   2. summarizing   文字起こしから議事録（概要・決定事項・ToDo・保留・補足）と
//                    「確認すべき項目」の判定を Claude で作る。分析指標を計算
//   3. draft         完了（人が直して確定する）
// ============================================================================

const TIME_BUDGET_MS = 240 * 1000; // maxDuration 300 秒に対する安全側

function summarySchema() {
  return {
    type: 'object',
    properties: {
      overview: { type: 'string', description: '打ち合わせの概要（3〜5 行。何の打ち合わせで、何が主に話され、どう着地したか）' },
      decisions: { type: 'array', items: { type: 'string' }, description: '決定した事項（検討中のものは入れない）' },
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            owner: { type: 'string', description: '担当（発言から分かれば。分からなければ空）' },
            due: { type: 'string', description: '期限（YYYY-MM-DD か「来週」など発言どおり。無ければ空）' },
            side: { type: 'string', description: 'cv（自社）/ client（先方）/ unknown' },
          },
          required: ['text', 'owner', 'due', 'side'],
        },
      },
      open_items: { type: 'array', items: { type: 'string' }, description: '保留・次回までの確認事項' },
      notes: { type: 'string', description: '補足メモ。見積・印刷に関わる数字（部数・サイズ・納期・予算・用紙）は必ずここに拾う' },
      checkpoints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            status: { type: 'string', description: 'confirmed / unconfirmed / n_a' },
            evidence: { type: 'string', description: '根拠の発言（短く引用）。無ければ空' },
          },
          required: ['key', 'status', 'evidence'],
        },
      },
      speakers: {
        type: 'array',
        description: '話者の仮名と推定される実名・立場（分かる範囲）',
        items: { type: 'object', properties: { label: { type: 'string' }, guess: { type: 'string' } }, required: ['label', 'guess'] },
      },
    },
    required: ['overview', 'decisions', 'todos', 'open_items', 'notes', 'checkpoints', 'speakers'],
  };
}

function typeLabel(types, key) {
  return (types || []).find((t) => t.key === key)?.label || key;
}

async function loadTypes(admin) {
  const { data } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'meeting_types').maybeSingle();
  try { return data ? JSON.parse(data.setting_value) : []; } catch { return []; }
}

async function transcribeStep(admin, meeting, deadline) {
  // 録音の断片
  const { data: segs } = await admin.from('meeting_segments').select('*').eq('meeting_id', meeting.id).order('seq');
  const segments = segs || [];
  const known = Array.isArray(meeting.participants) ? meeting.participants.filter(Boolean) : [];

  // 同じ断片を何度も途中で打ち切られていないかを見る。
  // 関数が実行時間の上限で強制終了されると catch に来ないので、状態が「処理中」のまま止まる。
  // それを「同じ断片の開始が 2 回続けて記録されている」ことで検知して、エラーにして知らせる。
  const prog = meeting.progress || {};
  const beginAttempt = async (seq, finished, total) => {
    const attempt = prog.current_seq === seq ? (Number(prog.attempt) || 0) + 1 : 1;
    if (attempt > 2) {
      throw new Error(`録音の断片 ${seq + 1} の文字起こしが 2 回続けて時間内に終わりませんでした。1 回の処理が長すぎる可能性があります（Vercel の関数の実行時間上限。Hobby プランは 60 秒）`);
    }
    Object.assign(prog, { phase: 'transcribing', finished, total, current_seq: seq, attempt, started_at: new Date().toISOString() });
    await admin.from('meetings').update({ progress: prog }).eq('id', meeting.id);
  };

  if (segments.length === 0 && meeting.audio_path) {
    // アップロード音声 1 本
    await beginAttempt(-1, 0, 1);
    const { data: file, error } = await admin.storage.from('uploads').download(meeting.audio_path);
    if (error || !file) throw new Error('音声ファイルを読み込めませんでした');
    const bytes = await file.arrayBuffer();
    const mime = file.type || guessMime(meeting.audio_path);
    const t = await transcribeAudio(bytes, mime, { knownSpeakers: known, hint: meeting.title });
    return { transcript: t, done: true, total: 1, finished: 1 };
  }

  let finished = segments.filter((s) => s.transcribed_at).length;
  for (const seg of segments) {
    if (seg.transcribed_at) continue;
    if (Date.now() > deadline) break;
    await beginAttempt(seg.seq, finished, segments.length);
    const { data: file, error } = await admin.storage.from('uploads').download(seg.storage_path);
    if (error || !file) throw new Error(`録音の断片 ${seg.seq + 1} を読み込めませんでした`);
    const bytes = await file.arrayBuffer();
    const mime = seg.mime_type || file.type || guessMime(seg.storage_path);
    let t;
    try {
      t = await transcribeAudio(bytes, mime, { knownSpeakers: known, hint: `${meeting.title}（${seg.seq + 1}/${segments.length} 番目の断片）` });
    } catch (err) {
      if (err.code !== 'TRANSCRIPT_EMPTY') throw err;
      // 2 回試しても中身が返らない断片は、そこだけ穴を空けて先に進める（議事録全体を止めない）。
      // 音声は保存期間内なら残っているので、あとから聞き直せる。
      console.error(`[api/meeting-process] 断片 ${seg.seq + 1} を飛ばします: ${err.message}`);
      const sec = Number(seg.duration_sec) || 0;
      t = [{ start: 0, end: sec, speaker: 'システム', text: `（${seg.seq + 1} 本目の断片（約 ${Math.round(sec / 60)} 分、${(seg.size / 1024 / 1024).toFixed(1)}MB）は文字起こしできませんでした: ${err.message}）` }];
    }
    await admin.from('meeting_segments').update({ transcript: t, transcribed_at: new Date().toISOString() }).eq('id', seg.id);
    finished += 1;
    delete prog.current_seq; delete prog.attempt; delete prog.started_at;
    Object.assign(prog, { phase: 'transcribing', finished, total: segments.length });
    await admin.from('meetings').update({ progress: prog }).eq('id', meeting.id);
  }
  if (finished < segments.length) return { transcript: null, done: false, total: segments.length, finished };

  // 結合（断片の長さぶん時刻をずらす。長さが無ければ最後の発話の終了秒を使う）
  const { data: fresh } = await admin.from('meeting_segments').select('*').eq('meeting_id', meeting.id).order('seq');
  let offset = 0;
  const merged = [];
  for (const seg of fresh || []) {
    const list = Array.isArray(seg.transcript) ? seg.transcript : [];
    for (const s of list) merged.push({ ...s, start: Math.round((s.start + offset) * 10) / 10, end: Math.round((s.end + offset) * 10) / 10 });
    const last = list.length ? Math.max(...list.map((s) => s.end || 0)) : 0;
    offset += Number(seg.duration_sec) || last || 0;
  }
  return { transcript: merged, done: true, total: segments.length, finished, duration: offset };
}

function guessMime(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  return { webm: 'audio/webm', mp4: 'audio/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' }[ext] || 'audio/mp4';
}

async function summarizeStep(admin, meeting, transcript) {
  const types = await loadTypes(admin);
  // 紐づけた案件（社内の打ち合わせでクライアント案件を扱うときの文脈に使う）
  let project = null;
  if (meeting.project_id) {
    const { data } = await admin.from('projects').select('project_number, name, client_name, phase, due_date').eq('id', meeting.project_id).maybeSingle();
    project = data || null;
  }
  const { data: checks } = await admin.from('meeting_checklists').select('key, label').eq('meeting_type', meeting.meeting_type).eq('is_active', true).order('sort_order');
  const checklist = checks || [];
  const known = Array.isArray(meeting.participants) ? meeting.participants.filter(Boolean) : [];
  const lines = transcript.map((s) => `[${fmtSec(s.start)}] ${s.speaker}: ${s.text}`).join('\n');

  const prompt = `以下は、株式会社コンセプト・ヴィレッジ（デザイン・印刷の制作会社。自社）とクライアントの打ち合わせの文字起こしです。
日本語のビジネス議事録を JSON で作ってください。

打ち合わせの種類: ${typeLabel(types, meeting.meeting_type)}
件名: ${meeting.title || '（未入力）'}
日付: ${meeting.held_at || '（未入力）'}
クライアント: ${meeting.client_name === 'CV自社' ? '（社内の打ち合わせ。クライアントは同席していない）' : meeting.client_name || '（未入力）'}
${project ? `対象の案件: ${project.project_number} ${project.name}（クライアント: ${project.client_name || '—'}${project.phase ? `・${project.phase}` : ''}${project.due_date ? `・完了予定 ${project.due_date}` : ''}）` : ''}
出席者: ${known.length ? known.join('、') : '（未入力）'}

書き方:
- 話し言葉を整えつつ、固有名詞・金額・日付・数量・サイズ・用紙などの具体的な情報はそのまま残す。
- 「決定事項」と「検討中・保留」を混ぜない。決まっていないものは open_items に入れる。
- ToDo は担当・期限が発言に出ていればそのまま入れ、出ていなければ空にする（推測で埋めない）。side は自社（cv）か先方（client）か。
- 見積・印刷に関わる数字（部数・サイズ・納期・予算・用紙・色数）は notes に必ず拾う。
- checkpoints は、下の「確認すべき項目」のそれぞれについて、文字起こしの中で確認できたか判定する。
  confirmed = 話題に出て内容が決まった／確認できた、unconfirmed = 話題に出ていない、または出たが決まっていない、n_a = この打ち合わせでは扱う必要がない。
  evidence には根拠になる発言を短く引用する。
- speakers は、話者の仮名（話者A など）ごとに、発言内容から推定できる実名・立場を書く（分からなければ空）。

確認すべき項目（key: 表示名）:
${checklist.length ? checklist.map((c) => `- ${c.key}: ${c.label}`).join('\n') : '（なし）'}

文字起こし:
${lines}`;

  const message = await claude().messages.create({
    model: MODEL,
    max_tokens: 12000,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    output_config: { format: { type: 'json_schema', schema: normalizeSchema(summarySchema()) } },
  });
  if (message.stop_reason === 'refusal') throw new Error('AI が議事録の作成を控えました。内容を確認してください');
  const out = JSON.parse(textOf(message));

  const byKey = Object.fromEntries((out.checkpoints || []).map((c) => [c.key, c]));
  const checkpoints = checklist.map((c) => ({
    key: c.key,
    label: c.label,
    status: ['confirmed', 'unconfirmed', 'n_a'].includes(byKey[c.key]?.status) ? byKey[c.key].status : 'unconfirmed',
    evidence: byKey[c.key]?.evidence || '',
  }));
  const summary = {
    overview: out.overview || '',
    decisions: out.decisions || [],
    todos: (out.todos || []).map((t) => ({ text: t.text, owner: t.owner || '', due: t.due || '', side: t.side || 'unknown', done: false })),
    open_items: [
      ...(out.open_items || []),
      // 未確認の項目は「次回までの確認事項」に入れる
      ...checkpoints.filter((c) => c.status === 'unconfirmed').map((c) => `【未確認】${c.label}`),
    ],
    notes: out.notes || '',
    speakers: out.speakers || [],
  };
  return { summary, checkpoints };
}

function fmtSec(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** 将来の分析用の指標（v1 では保存だけ） */
function analyze(transcript, summary, checkpoints, durationSec) {
  const bySpeaker = {};
  let questions = 0;
  for (const s of transcript) {
    const len = (s.end || 0) - (s.start || 0);
    bySpeaker[s.speaker] = (bySpeaker[s.speaker] || 0) + Math.max(0, len);
    if (/[?？]|ですか|ますか|でしょうか/.test(s.text)) questions += 1;
  }
  const total = Object.values(bySpeaker).reduce((a, b) => a + b, 0) || 1;
  return {
    duration_sec: durationSec || Math.max(0, ...transcript.map((s) => s.end || 0)),
    utterances: transcript.length,
    speakers: Object.keys(bySpeaker).length,
    talk_ratio: Object.fromEntries(Object.entries(bySpeaker).map(([k, v]) => [k, Math.round((v / total) * 100)])),
    question_count: questions,
    decision_count: (summary.decisions || []).length,
    todo_count: (summary.todos || []).length,
    unassigned_todos: (summary.todos || []).filter((t) => !t.owner).length,
    open_item_count: (summary.open_items || []).length,
    checkpoints_total: checkpoints.length,
    checkpoints_unconfirmed: checkpoints.filter((c) => c.status === 'unconfirmed').length,
  };
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;
  const { meeting_id: id } = req.body || {};
  if (!id) { res.status(400).json({ error: 'meeting_id を指定してください' }); return; }
  if (!isGeminiConfigured()) { res.status(503).json({ error: '文字起こしが設定されていません（Vercel の GEMINI_API_KEY）' }); return; }

  const admin = adminClient();
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  const { data: meeting, error } = await admin.from('meetings').select('*').eq('id', id).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!meeting) { res.status(404).json({ error: '議事録が見つかりません' }); return; }
  if (meeting.status === 'draft' || meeting.status === 'finalized') { res.status(200).json({ done: true, status: meeting.status }); return; }

  try {
    let transcript = Array.isArray(meeting.transcript_raw) ? meeting.transcript_raw : null;
    let duration = Number(meeting.audio_duration_sec) || 0;

    if (!transcript) {
      if (meeting.status !== 'transcribing') await admin.from('meetings').update({ status: 'transcribing', error_message: null }).eq('id', id);
      const r = await transcribeStep(admin, { ...meeting, status: 'transcribing' }, deadline);
      if (!r.done) {
        res.status(200).json({ done: false, status: 'transcribing', progress: { phase: 'transcribing', finished: r.finished, total: r.total } });
        return;
      }
      transcript = r.transcript;
      duration = duration || r.duration || 0;
      await admin.from('meetings').update({
        transcript_raw: transcript, transcript, audio_duration_sec: duration || null,
        status: 'summarizing', progress: { phase: 'summarizing' },
      }).eq('id', id);
    } else if (meeting.status !== 'summarizing') {
      await admin.from('meetings').update({ status: 'summarizing', progress: { phase: 'summarizing' }, error_message: null }).eq('id', id);
    }

    if (Date.now() > deadline - 60_000) {
      // 要約は次の呼び出しで（時間切れを避ける）
      res.status(200).json({ done: false, status: 'summarizing', progress: { phase: 'summarizing' } });
      return;
    }

    {
      const p = meeting.progress || {};
      const attempt = p.phase === 'summarizing' ? (Number(p.attempt) || 0) + 1 : 1;
      if (attempt > 2) throw new Error('議事録の作成が 2 回続けて時間内に終わりませんでした。「処理をやり直す」でもう一度試すか、文字起こしが長すぎないか確認してください');
      await admin.from('meetings').update({ progress: { phase: 'summarizing', attempt, started_at: new Date().toISOString() } }).eq('id', id);
    }
    const { summary, checkpoints } = await summarizeStep(admin, meeting, transcript);
    const analysis = analyze(transcript, summary, checkpoints, duration);
    const retentionDays = await loadRetentionDays(admin);
    const retentionUntil = new Date(Date.now() + retentionDays * 86400_000).toISOString().slice(0, 10);
    await admin.from('meetings').update({
      summary, checkpoints, analysis, status: 'draft', progress: { phase: 'done' }, error_message: null,
      retention_until: meeting.retention_until || retentionUntil,
    }).eq('id', id);
    res.status(200).json({ done: true, status: 'draft' });
  } catch (err) {
    console.error('[api/meeting-process]', err);
    await admin.from('meetings').update({ status: 'error', error_message: String(err.message || err).slice(0, 500) }).eq('id', id);
    res.status(500).json({ error: err.message || '処理に失敗しました' });
  }
}

async function loadRetentionDays(admin) {
  const { data } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'meeting_audio_retention_days').maybeSingle();
  const n = Number(data?.setting_value);
  return n > 0 ? n : 30;
}
