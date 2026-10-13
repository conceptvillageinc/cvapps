import { requireMember, requirePost, adminClient } from './_lib/guard.js';
import { getAccessToken } from './_lib/gmail.js';
import { partiesOf, keyDatesOf, clientTasks, memberShortName, scheduleTitle } from '../src/lib/schedule.js';
import { buildScheduleGrid } from '../src/lib/scheduleSheet.js';
import { expandCompanyHolidays } from '../src/lib/jpHolidays.js';

// ============================================================================
// POST /api/export-schedule-sheet  { project_id, share_with_client?: boolean }
//
// 案件の工程表を Google スプレッドシート「工程管理表」に書き出す（見本の工程表と同じガントの形）。
// クライアント向けなので「工程表に出す」工程だけ。社内メモ・見込み／実績時間は出さない。
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

const hexRgb = (hex) => {
  const n = parseInt(String(hex || '#ffffff').replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};

async function gapi(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google API エラー (${res.status})`);
  return data;
}

/** マス目（buildScheduleGrid）→ Sheets の batchUpdate */
export function gridRequests(sheetId, grid) {
  const rowCount = Math.max(grid.cells.length + 20, 100);
  const columnCount = Math.max(grid.widths.length, 26);
  const cellData = (c) => {
    const fmt = { verticalAlignment: 'MIDDLE', textFormat: { bold: !!c.bold, fontSize: c.size || 10, ...(c.fg ? { foregroundColor: hexRgb(c.fg) } : {}) } };
    if (c.bg) fmt.backgroundColor = hexRgb(c.bg);
    if (c.align) fmt.horizontalAlignment = c.align;
    return { userEnteredValue: { stringValue: String(c.v ?? '') }, userEnteredFormat: fmt };
  };
  const requests = [
    { updateSheetProperties: { properties: { sheetId, title: '工程管理表', gridProperties: { rowCount, columnCount, frozenRowCount: 0, frozenColumnCount: 0 } }, fields: 'title,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } },
    { unmergeCells: { range: { sheetId } } },
    { updateCells: { range: { sheetId }, fields: '*' } },
    { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: grid.cells.map((r) => ({ values: r.map(cellData) })), fields: 'userEnteredValue,userEnteredFormat' } },
    ...grid.merges.map((m) => ({ mergeCells: { range: { sheetId, startRowIndex: m.r0, endRowIndex: m.r1, startColumnIndex: m.c0, endColumnIndex: m.c1 }, mergeType: 'MERGE_ALL' } })),
    ...grid.widths.map((w, i) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: grid.cells.length }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: grid.frozenRows, frozenColumnCount: grid.frozenCols } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  ];
  return requests;
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
    const { data: users } = await admin.from('users').select('id, full_name, short_name');
    const { data: holidayRow } = await admin.from('system_settings').select('setting_value').eq('setting_key', 'company_holidays').maybeSingle();
    let holidayLines = [];
    try { holidayLines = holidayRow ? JSON.parse(holidayRow.setting_value) : []; } catch { holidayLines = []; }

    const byId = new Map((users || []).map((u) => [u.id, u]));
    const shown = clientTasks(tasks || [], (id) => memberShortName(byId.get(id)));
    const grid = buildScheduleGrid({
      title: scheduleTitle(project),
      tasks: shown,
      parties: partiesOf(project),
      keyDates: keyDatesOf(project),
      holidays: expandCompanyHolidays(Array.isArray(holidayLines) ? holidayLines : []),
      updated: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    });

    const token = await getAccessToken(user.email, SCOPES);
    const sheetTitle = `工程表_${project.project_number}_${project.client_name}`;

    let sheetId = project.schedule_sheet_id;
    let sheetUrl = project.schedule_sheet_url;
    let tabId = null;

    if (sheetId) {
      // 既存シートを確認。消されていれば作り直す
      try {
        const meta = await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId,sheets.properties(sheetId,title)`);
        const tabs = meta.sheets || [];
        tabId = (tabs.find((t) => t.properties.title === '工程管理表') || tabs[0])?.properties.sheetId ?? null;
      } catch {
        sheetId = null;
      }
    }
    if (!sheetId) {
      const created = await gapi(token, 'https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        body: JSON.stringify({ properties: { title: sheetTitle, locale: 'ja_JP' }, sheets: [{ properties: { title: '工程管理表' } }] }),
      });
      sheetId = created.spreadsheetId;
      sheetUrl = created.spreadsheetUrl;
      tabId = created.sheets?.[0]?.properties?.sheetId ?? 0;
    }

    // 内容と体裁を丸ごと書き換える（アプリ側が正）
    await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: gridRequests(tabId ?? 0, grid) }),
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
    res.status(200).json({ sheet_id: sheetId, sheet_url: sheetUrl, rows: shown.length, shared_with: sharedWith });
  } catch (err) {
    console.error('[api/export-schedule-sheet]', err);
    res.status(500).json({ error: err.message || 'スプレッドシートへの出力に失敗しました' });
  }
}
