// ============================================================================
// AI チャットが CVアプリの情報を読むための道具（読むだけ。書き換えはしない）
//   どれも「質問した人の権限」の Supabase クライアント（RLS が効く）で読む。
//   その人が画面で見られない情報（支払い先まとめ・売上粗利管理表のメモなど）は、ここでも読めない。
// ============================================================================
import { buildSalesReport } from '../../src/lib/salesReport.js';
import { fiscalYearOf } from '../../src/lib/fiscal.js';

const PROGRESS = { pending: '未着手', open: '着手中', completed: '納品済', lost: '失注', cancelled: '失注' };
const SUBMISSION = { unsubmitted: '未提出', submitted: '提出済', lost: '失注' };
const DOC_STATUS = { draft: '下書き', issued: '発行済', sent: '送付済', paid: '入金済', cancelled: '取消' };
const n = (v) => Math.round(Number(v) || 0);
const like = (s) => `%${String(s).replace(/[%_,()]/g, ' ').trim()}%`;
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const str = { type: 'string' };

/** Claude に渡す道具の定義 */
export const TOOLS = [
  {
    name: 'search_projects',
    description: '案件一覧を検索する。キーワード（案件番号・クライアント名・案件名・メモ）、進捗、登録日・完了予定日の範囲で絞り込める。金額は税抜。',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        keyword: { ...str, description: '案件番号・クライアント名・案件名・メモに含まれる言葉。空なら絞り込まない' },
        progress: { type: 'array', items: { type: 'string', enum: ['未着手', '着手中', '納品済', '失注'] }, description: '進捗で絞り込む。空ならすべて' },
        date_field: { type: 'string', enum: ['registered_at', 'due_date', 'payment_due_date'], description: '日付の絞り込みに使う日（登録日・完了予定日・入金予定日）' },
        date_from: { ...str, description: 'YYYY-MM-DD。空なら指定なし' },
        date_to: { ...str, description: 'YYYY-MM-DD。空なら指定なし' },
        limit: { type: 'integer', description: '最大件数（1〜100）' },
      },
      required: ['keyword', 'progress', 'date_field', 'date_from', 'date_to', 'limit'],
    },
  },
  {
    name: 'get_project',
    description: '案件 1 件の詳細（見込み・実績・日程・ネクストアクション・メモ）と、その案件の見積・納品書・請求書・発注書の一覧を読む。',
    input_schema: { type: 'object', additionalProperties: false, properties: { project_number: { ...str, description: '案件番号（例 P-2611-009）' } }, required: ['project_number'] },
  },
  {
    name: 'search_estimates',
    description: '見積を検索する（見積番号・クライアント名・件名）。金額は税抜の合計。',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: { keyword: { ...str, description: '見積番号・クライアント名・件名に含まれる言葉' }, limit: { type: 'integer', description: '最大件数（1〜50）' } },
      required: ['keyword', 'limit'],
    },
  },
  {
    name: 'get_estimate',
    description: '見積 1 件の明細（品名・数量・単位・単価・金額）と合計、提出の状態、案件を読む。',
    input_schema: { type: 'object', additionalProperties: false, properties: { estimate_number: { ...str, description: '見積番号（例 CV-2611-027）' } }, required: ['estimate_number'] },
  },
  {
    name: 'search_documents',
    description: '納品書・請求書・発注書・領収書を検索する（クライアント名・件名・番号、日付の範囲）。金額は税抜の小計と税込の合計。',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['invoice', 'delivery_note', 'partner_order', 'receipt'], description: '請求書・納品書・発注書・領収書' },
        keyword: { ...str, description: 'クライアント名（発注書は発注先）・件名・番号に含まれる言葉。空なら絞り込まない' },
        date_from: { ...str, description: 'YYYY-MM-DD（請求日・納品日・発注日・発行日）。空なら指定なし' },
        date_to: { ...str, description: 'YYYY-MM-DD。空なら指定なし' },
        limit: { type: 'integer', description: '最大件数（1〜100）' },
      },
      required: ['kind', 'keyword', 'date_from', 'date_to', 'limit'],
    },
  },
  {
    name: 'get_client',
    description: 'クライアント 1 社の登録情報（担当者・連絡先・請求書の送付方法）と、最近の案件を読む。',
    input_schema: { type: 'object', additionalProperties: false, properties: { name: { ...str, description: 'クライアント名（一部でもよい）' } }, required: ['name'] },
  },
  {
    name: 'sales_report',
    description: '売上粗利管理表（目標・着地見込・実績を月ごと）を読む。着地見込は案件ベース（進捗が着手中・納品済で受注確度 A・要注意（A）・A（定期売上）の案件と有効な定期売上）。実績は請求書（売上）と支払い先まとめ等（仕入）。金額は税抜。',
    input_schema: { type: 'object', additionalProperties: false, properties: { fiscal_year: { type: 'integer', description: '期首の年（例 2026 は 2026/10〜2027/09）。0 なら今期' } }, required: ['fiscal_year'] },
  },
  {
    name: 'sales_report_memo',
    description: '売上粗利管理表のメモ（着地見込のみ・実績のみ・シミュレーション）を読む。見られる人が限られている。',
    input_schema: { type: 'object', additionalProperties: false, properties: { fiscal_year: { type: 'integer', description: '期首の年。0 なら今期' } }, required: ['fiscal_year'] },
  },
].map((t) => ({ ...t, strict: true }));

/** 道具を使ったことを画面に出すときの言葉 */
export function toolLabel(name, input = {}) {
  switch (name) {
    case 'search_projects': return `案件一覧を検索${input.keyword ? `（${input.keyword}）` : ''}`;
    case 'get_project': return `案件 ${input.project_number} を確認`;
    case 'search_estimates': return `見積を検索${input.keyword ? `（${input.keyword}）` : ''}`;
    case 'get_estimate': return `見積 ${input.estimate_number} を確認`;
    case 'search_documents': return `${{ invoice: '請求書', delivery_note: '納品書', partner_order: '発注書', receipt: '領収書' }[input.kind] || '書類'}を検索${input.keyword ? `（${input.keyword}）` : ''}`;
    case 'get_client': return `クライアント「${input.name}」を確認`;
    case 'sales_report': return '売上粗利管理表を確認';
    case 'sales_report_memo': return '売上粗利管理表のメモを確認';
    default: return name;
  }
}

const settingValue = (rows, key) => (rows || []).find((r) => r.setting_key === key)?.setting_value;

/** 道具を実行する。db は質問した人の権限のクライアント */
export async function runTool(db, name, input = {}) {
  const limit = (v, max) => Math.max(1, Math.min(max, Number(v) || 20));
  switch (name) {
    case 'search_projects': {
      let q = db.from('projects').select('project_number, client_name, name, status, deal_probability, expected_revenue, expected_cost, other_cost, confirmed_revenue, confirmed_cost, registered_at, due_date, payment_due_date, next_action, is_recurring')
        .order('registered_at', { ascending: false }).limit(limit(input.limit, 100));
      if (input.keyword) { const k = like(input.keyword); q = q.or(`project_number.ilike.${k},client_name.ilike.${k},name.ilike.${k},notes.ilike.${k}`); }
      const keys = Object.entries(PROGRESS).filter(([, v]) => (input.progress || []).includes(v)).map(([k]) => k);
      if (keys.length) q = q.in('status', keys);
      const f = ['registered_at', 'due_date', 'payment_due_date'].includes(input.date_field) ? input.date_field : 'registered_at';
      if (input.date_from) q = q.gte(f, input.date_from);
      if (input.date_to) q = q.lte(f, input.date_to);
      const { data, error } = await q;
      if (error) throw error;
      return { count: data.length, projects: data.map((p) => ({
        案件番号: p.project_number, クライアント: p.client_name, 案件名: p.name, 進捗: PROGRESS[p.status] || p.status, 受注確度: p.deal_probability,
        受注見込: n(p.expected_revenue), 発注見込: n(p.expected_cost) + n(p.other_cost), 粗利見込: n(p.expected_revenue) - n(p.expected_cost) - n(p.other_cost),
        受注合計_実績: n(p.confirmed_revenue), 発注合計_実績: n(p.confirmed_cost), 登録日: p.registered_at, 完了予定日: p.due_date, 入金予定日: p.payment_due_date,
        ネクストアクション: p.next_action || '', 定期売上: !!p.is_recurring,
      })) };
    }
    case 'get_project': {
      const { data: p, error } = await db.from('projects').select('*').eq('project_number', String(input.project_number || '').trim()).maybeSingle();
      if (error) throw error;
      if (!p) return { error: `案件 ${input.project_number} は見つかりませんでした（または見る権限がありません）` };
      const [est, dn, inv, po] = await Promise.all([
        db.from('estimates').select('estimate_number, estimate_title, total_amount, submission_status, is_final_submitted, estimate_date').eq('project_id', p.id).order('created_at'),
        db.from('delivery_notes').select('delivery_number, title, delivery_date, subtotal, total, status').eq('project_id', p.id).order('delivery_date'),
        db.from('invoices').select('invoice_number, title, invoice_date, due_date, subtotal, total, status').eq('project_id', p.id).order('invoice_date'),
        db.from('partner_orders').select('po_number, partner_name, title, order_date, subtotal, total, status').eq('project_id', p.id).order('order_date'),
      ]);
      return {
        案件番号: p.project_number, クライアント: p.client_name, 案件名: p.name, 進捗: PROGRESS[p.status] || p.status, 受注確度: p.deal_probability,
        受注見込: n(p.expected_revenue), 発注見込: n(p.expected_cost), その他費用: n(p.other_cost), 粗利見込: n(p.expected_revenue) - n(p.expected_cost) - n(p.other_cost),
        受注合計_実績: n(p.confirmed_revenue), 発注合計_実績: n(p.confirmed_cost), 登録日: p.registered_at, 完了予定日: p.due_date, 入金予定日: p.payment_due_date,
        ネクストアクション: p.next_action || '', 案件メモ: p.notes || '', 定期売上: !!p.is_recurring,
        見積: (est.data || []).map((e) => ({ 番号: e.estimate_number, 件名: e.estimate_title, 合計_税抜: n(e.total_amount), 提出: SUBMISSION[e.submission_status] || (e.is_final_submitted ? '提出済' : '未提出'), 見積日: e.estimate_date })),
        納品書: (dn.data || []).map((d) => ({ 番号: d.delivery_number, 件名: d.title, 納品日: d.delivery_date, 小計_税抜: n(d.subtotal), 状態: DOC_STATUS[d.status] || d.status })),
        請求書: (inv.data || []).map((d) => ({ 番号: d.invoice_number, 件名: d.title, 請求日: d.invoice_date, 期日: d.due_date, 小計_税抜: n(d.subtotal), 合計_税込: n(d.total), 状態: DOC_STATUS[d.status] || d.status })),
        発注書: (po.data || []).map((d) => ({ 番号: d.po_number, 発注先: d.partner_name, 件名: d.title, 発注日: d.order_date, 小計_税抜: n(d.subtotal), 状態: DOC_STATUS[d.status] || d.status })),
      };
    }
    case 'search_estimates': {
      let q = db.from('estimates').select('estimate_number, client_name, estimate_title, total_amount, submission_status, is_final_submitted, estimate_date, project_id')
        .order('created_at', { ascending: false }).limit(limit(input.limit, 50));
      if (input.keyword) { const k = like(input.keyword); q = q.or(`estimate_number.ilike.${k},client_name.ilike.${k},estimate_title.ilike.${k}`); }
      const { data, error } = await q;
      if (error) throw error;
      return { count: data.length, estimates: data.map((e) => ({ 番号: e.estimate_number, クライアント: e.client_name, 件名: e.estimate_title, 合計_税抜: n(e.total_amount), 提出: SUBMISSION[e.submission_status] || (e.is_final_submitted ? '提出済' : '未提出'), 見積日: e.estimate_date })) };
    }
    case 'get_estimate': {
      const { data: e, error } = await db.from('estimates').select('estimate_number, client_name, estimate_title, estimate_date, total_amount, tax_inclusive, submission_status, is_final_submitted, line_items, additional_notes, project_id').eq('estimate_number', String(input.estimate_number || '').trim()).maybeSingle();
      if (error) throw error;
      if (!e) return { error: `見積 ${input.estimate_number} は見つかりませんでした（または見る権限がありません）` };
      let project = null;
      if (e.project_id) { const { data: p } = await db.from('projects').select('project_number, name').eq('id', e.project_id).maybeSingle(); project = p; }
      const items = (e.line_items || []).filter((li) => li && li.row_type !== 'subtotal').slice(0, 120).map((li) => (li.row_type === 'text'
        ? { 見出し: li.text || '' }
        : { 品名: li.name || '', 数量: li.quantity ?? '', 単位: li.unit || '', 単価: li.unit_price ?? '', 金額: li.amount ?? (Number(li.quantity) * Number(li.unit_price) || ''), ...(li.internal ? { 社内用: true } : {}) }));
      return { 番号: e.estimate_number, クライアント: e.client_name, 件名: e.estimate_title, 見積日: e.estimate_date, 合計: n(e.total_amount), 税込表示: !!e.tax_inclusive, 提出: SUBMISSION[e.submission_status] || (e.is_final_submitted ? '提出済' : '未提出'), 案件: project ? `${project.project_number} ${project.name}` : '', 備考: e.additional_notes || '', 明細: items };
    }
    case 'search_documents': {
      const def = {
        invoice: { table: 'invoices', no: 'invoice_number', date: 'invoice_date', who: 'client_name', cols: 'invoice_number, client_name, title, invoice_date, due_date, subtotal, total, status' },
        delivery_note: { table: 'delivery_notes', no: 'delivery_number', date: 'delivery_date', who: 'client_name', cols: 'delivery_number, client_name, title, delivery_date, subtotal, total, status' },
        partner_order: { table: 'partner_orders', no: 'po_number', date: 'order_date', who: 'partner_name', cols: 'po_number, partner_name, title, order_date, due_date, subtotal, total, status' },
        receipt: { table: 'receipts', no: 'receipt_number', date: 'issue_date', who: 'client_name', cols: 'receipt_number, client_name, title, issue_date, subtotal, total, status' },
      }[input.kind];
      if (!def) return { error: '書類の種類が分かりません' };
      let q = db.from(def.table).select(def.cols).order(def.date, { ascending: false }).limit(limit(input.limit, 100));
      if (input.keyword) { const k = like(input.keyword); q = q.or(`${def.no}.ilike.${k},${def.who}.ilike.${k},title.ilike.${k}`); }
      if (input.date_from) q = q.gte(def.date, input.date_from);
      if (input.date_to) q = q.lte(def.date, input.date_to);
      const { data, error } = await q;
      if (error) throw error;
      const sum = data.filter((d) => d.status !== 'cancelled').reduce((a, d) => a + n(d.subtotal), 0);
      return { count: data.length, 小計の合計_税抜_取消を除く: sum, documents: data.map((d) => ({ 番号: d[def.no], 相手: d[def.who], 件名: d.title, 日付: d[def.date], ...(d.due_date ? { 期日: d.due_date } : {}), 小計_税抜: n(d.subtotal), 合計_税込: n(d.total), 状態: DOC_STATUS[d.status] || d.status })) };
    }
    case 'get_client': {
      const { data: list, error } = await db.from('clients').select('id, name, name_kana, contact_person, email, phone, address, invoice_delivery_method, invoice_delivery_notes, notes').ilike('name', like(input.name || '')).limit(5);
      if (error) throw error;
      if (!list.length) return { error: `「${input.name}」に当てはまるクライアントは見つかりませんでした` };
      const c = list[0];
      const { data: projects } = await db.from('projects').select('project_number, name, status, expected_revenue, registered_at').eq('client_name', c.name).order('registered_at', { ascending: false }).limit(15);
      return {
        クライアント: c.name, フリガナ: c.name_kana || '', 担当者: c.contact_person || '', メール: c.email || '', 電話: c.phone || '', 住所: c.address || '',
        請求書の送付方法: c.invoice_delivery_method || '', 送付の補足: c.invoice_delivery_notes || '', メモ: c.notes || '',
        ほかの候補: list.slice(1).map((x) => x.name), 最近の案件: (projects || []).map((p) => ({ 案件番号: p.project_number, 案件名: p.name, 進捗: PROGRESS[p.status] || p.status, 受注見込: n(p.expected_revenue), 登録日: p.registered_at })),
      };
    }
    case 'sales_report': {
      const { data: settings } = await db.from('system_settings').select('setting_key, setting_value');
      const startMonth = Number(settingValue(settings, 'fiscal_year_start_month')) || 10;
      const fy = Number(input.fiscal_year) > 2000 ? Number(input.fiscal_year) : fiscalYearOf(today(), startMonth);
      const [projects, invoices, targets, templates, payables, cards] = await Promise.all([
        db.from('projects').select('*').limit(5000),
        db.from('invoices').select('id, project_id, invoice_date, subtotal, total, status, line_items').limit(10000),
        db.from('fiscal_targets').select('*').eq('fiscal_year', fy).maybeSingle(),
        db.from('recurring_project_templates').select('id, is_active'),
        db.rpc('payables_cv_monthly'),
        db.rpc('card_cv_monthly'),
      ]);
      const report = buildSalesReport({
        fiscalYear: fy, startMonth, projects: projects.data || [], invoices: invoices.data || [], bankTxs: [],
        payables: payables.data || [], cardCharges: cards.data || [], recurringTemplates: templates.data || [],
        payablesMonthMode: settingValue(settings, 'payables_month_mode') || 'prev', targets: targets.data || null,
        marginTarget: Number(settingValue(settings, 'gross_margin_target')) || 0.8,
      });
      const row = (r) => ({
        月: r.key, 目標_売上: n(r.target.sales), 目標_粗利: n(r.target.gross), 必達粗利: n(r.target.gross_must),
        着地見込_売上: n(r.forecast.sales), 着地見込_発注: n(r.forecast.cost), 着地見込_粗利: n(r.forecast.gross), 着地見込_うち定期売上: n(r.forecast.recurring),
        実績_売上: n(r.actual.sales), 実績_仕入: n(r.actual.purchase), 実績_その他原価: n(r.actual.other_cost), 実績_粗利: n(r.actual.gross),
      });
      const a = report.annual;
      return {
        期: `${fy}年度（${report.from}〜${report.to}）`, 注意: '着地見込と実績は別の数字（足さない）。実績の仕入は支払い先まとめ・カード明細から（銀行明細はここでは読んでいない）。シミュレーションの書き換えは含まない',
        年計: { 目標_売上: n(a.target.sales), 目標_粗利: n(a.target.gross), 必達粗利: n(a.target.gross_must), 着地見込_売上: n(a.forecast.sales), 着地見込_粗利: n(a.forecast.gross), 実績_売上: n(a.actual.sales), 実績_粗利: n(a.actual.gross) },
        月ごと: report.rows.map(row),
      };
    }
    case 'sales_report_memo': {
      const { data: settings } = await db.from('system_settings').select('setting_key, setting_value');
      const startMonth = Number(settingValue(settings, 'fiscal_year_start_month')) || 10;
      const fy = Number(input.fiscal_year) > 2000 ? Number(input.fiscal_year) : fiscalYearOf(today(), startMonth);
      const { data, error } = await db.from('sales_report_memos').select('mode, body, updated_by, updated_at').eq('fiscal_year', fy);
      if (error || !data?.length) return { error: 'この期のメモは無いか、メモを見る権限がありません（売上粗利管理表のメモは限られた人だけが見られます）' };
      const label = { forecast: '着地見込のみ', actual: '実績のみ', simulation: 'シミュレーション' };
      return { 期: `${fy}年度`, メモ: data.map((m) => ({ 表示: label[m.mode] || m.mode, 本文: m.body, 更新: `${m.updated_at} ${m.updated_by || ''}` })) };
    }
    default:
      return { error: `知らない道具です: ${name}` };
  }
}
