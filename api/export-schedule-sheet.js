import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';

// ============================================================================
// POST /api/export-schedule-sheet  { project_id, share_with_client?: boolean }
//
// 案件の工程を Google スプレッドシート「工程管理表」に書き出す。
// 操作した本人のアカウントとして作成（本人のマイドライブに入る）し、
// 2回目以降は同じシートの内容を書き換える。share_with_client を付けると、
// クライアント一覧のメールアドレスに閲覧権限を付けて共有する。
//
// 必要なスコープ（Workspace の「ドメイン全体の委任」に追加）:
//   https://www.googleapis.com/auth/spreadsheets
//   https://www.googleapis.com/auth/drive.file
// ============================================================================

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const STATUS_LABEL = { todo: '未着手', doing: '進行中', done: '完了', hold: '保留' };

async function gapi(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google API エラー (${res.status})`);
  return data;
}

function buildRows(project, tasks, company) {
  const header = ['工程', '担当', '開始日', '終了日', '状態', '備考'];
  const body = tasks.map((t) => [t.name, t.owner || '', t.start_date || '', t.end_date || '', STATUS_LABEL[t.status] || t.status, t.notes || '']);
  const title = [
    [`工程管理表　${project.client_name} / ${project.name}`],
    [`案件番号: ${project.project_number}　更新: ${new Date().toISOString().slice(0, 10)}　${company?.name || ''}`],
    [],
  ];
  return [...title, header, ...body];
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const user = await requireMember(req, res);
  if (!user) return;

  const { project_id: projectId, share_with_client: share } = req.body || {};
  if (!projectId) { res.status(400).json({ error: 'project_id を指定してください' }); return; }

  try {
    const admin = adminClient();
    const { data: project } = await admin.from('projects').select('*').eq('id', projectId).maybeSingle();
    if (!project) { res.status(404).json({ error: '案件が見つかりません' }); return; }
    const { data: tasks } = await admin.from('project_tasks').select('*').eq('project_id', projectId).order('sort_order').order('created_at');
    const { data: settingRow } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'company_info').maybeSingle();
    let company = {};
    try { company = settingRow ? JSON.parse(settingRow.setting_value) : {}; } catch { company = {}; }

    const token = await getAccessToken(user.email, SCOPES);
    const values = buildRows(project, tasks || [], company);
    const sheetTitle = `工程管理表_${project.project_number}_${project.client_name}`;

    let sheetId = project.schedule_sheet_id;
    let sheetUrl = project.schedule_sheet_url;

    if (sheetId) {
      // 既存シートを確認。消されていれば作り直す
      try {
        await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId`);
      } catch {
        sheetId = null;
      }
    }
    if (!sheetId) {
      const created = await gapi(token, 'https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        body: JSON.stringify({ properties: { title: sheetTitle, locale: 'ja_JP' }, sheets: [{ properties: { title: '工程管理表', gridProperties: { frozenRowCount: 4 } } }] }),
      });
      sheetId = created.spreadsheetId;
      sheetUrl = created.spreadsheetUrl;
    }

    // 内容を丸ごと書き換える
    await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('工程管理表!A1:Z1000')}:clear`, { method: 'POST', body: '{}' });
    await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent('工程管理表!A1')}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: JSON.stringify({ range: '工程管理表!A1', majorDimension: 'ROWS', values }),
    });
    // 見出しの体裁（太字・列幅）
    await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat' } },
          { repeatCell: { range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 260 }, fields: 'pixelSize' } },
          { updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } },
        ],
      }),
    });

    // クライアントへ閲覧共有（クライアント一覧のメールアドレス。画面からは指定できない）
    let sharedWith = null;
    if (share) {
      let client = null;
      if (project.client_id) ({ data: client } = await admin.from('clients').select('email, name').eq('id', project.client_id).maybeSingle());
      if (!client) ({ data: client } = await admin.from('clients').select('email, name').eq('name', project.client_name).order('created_at').limit(1).maybeSingle());
      if (!client?.email) {
        res.status(400).json({ error: `「${project.client_name}」のメールアドレスがクライアント一覧に未登録のため共有できません（シートの出力は完了しています）`, sheet_url: sheetUrl });
        await admin.from('projects').update({ schedule_sheet_id: sheetId, schedule_sheet_url: sheetUrl }).eq('id', projectId);
        return;
      }
      await gapi(token, `https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=true`, {
        method: 'POST',
        body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: client.email }),
      });
      sharedWith = client.email;
    }

    await admin.from('projects').update({ schedule_sheet_id: sheetId, schedule_sheet_url: sheetUrl }).eq('id', projectId);
    res.status(200).json({ sheet_id: sheetId, sheet_url: sheetUrl, rows: (tasks || []).length, shared_with: sharedWith });
  } catch (err) {
    console.error('[api/export-schedule-sheet]', err);
    res.status(500).json({ error: err.message || 'スプレッドシートへの出力に失敗しました' });
  }
}
