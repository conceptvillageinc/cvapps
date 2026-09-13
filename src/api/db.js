import { supabase } from '@/lib/supabase';

// ============================================================================
// データアクセスのアダプタ層
//
// Base44 SDK と同じ形（entities.X.list / filter / create / update / delete）を
// 保ったまま、中身を Supabase に差し替えるための層。
// 画面側のコードは呼び出し方を変えずに済む。
//
// Base44 との差異をここで吸収している:
//   * created_date / updated_date  →  created_at / updated_at
//   * Base44 固有・廃止したフィールド（freee_* など）は書き込み時に捨てる
//   * 各テーブルの書き込み可能カラムを明示的に許可リストで管理する
// ============================================================================

// エンティティ名 → テーブル名
const TABLES = {
  Estimate: 'estimates',
  Client: 'clients',
  PrintVendor: 'print_vendors',
  PriceMaster: 'price_masters',
  EmailLog: 'email_logs',
  SystemSettings: 'system_settings',
  FaqItem: 'faq_items',
  User: 'users',
};

// 書き込みを許可するカラム。
// ここに無いキーは無視される。画面側が送ってくる Base44 の名残
// （freee_status / created_date / id など）を安全に捨てるための仕組み。
const WRITABLE_COLUMNS = {
  estimates: [
    'estimate_number', 'client_name', 'client_honorific', 'person_in_charge',
    'estimate_title', 'estimate_date', 'validity_period_months', 'schema_version',
    'line_items', 'print_type', 'size', 'usage', 'paper_type', 'quantities',
    'color_count', 'desired_delivery_date', 'additional_notes', 'status',
    'deal_probability', 'phase', 'lost_reason', 'is_final_submitted',
    'project_group_id', 'parent_estimate_id', 'revision_label', 'total_amount',
    'reviewer_id', 'reviewer_name', 'approved_date', 'review_comments',
    'approval_checklist',
    // 旧方式（schema_version = 1）のみ使用
    'vendor_prices', 'selected_vendor', 'cost_price', 'selling_price',
    'gross_profit', 'markup_rate', 'proofreading_fee', 'other_fees',
    'design_fees', 'design_fee_total',
  ],
  clients: [
    'name', 'name_kana', 'contact_person', 'contact_person_kana',
    'email', 'phone', 'postal_code', 'address', 'notes', 'quote_count',
  ],
  print_vendors: [
    'name', 'vendor_type', 'print_types', 'email', 'phone',
    'website_url', 'contact_person', 'notes',
  ],
  price_masters: [
    'category', 'paper_type_group', 'vendor_name', 'spec_summary',
    'price_grid', 'last_updated', 'screenshot_url', 'source_url', 'notes',
  ],
  email_logs: [
    'estimate_id', 'recipient_company', 'recipient_email',
    'subject', 'body', 'status', 'sent_at',
  ],
  system_settings: ['setting_key', 'setting_value', 'description'],
  faq_items: ['question', 'answer', 'sort_order'],
  users: ['full_name', 'role', 'department'],
};

// 日付系カラムは空文字を渡すと Postgres がエラーになるため null に寄せる
const DATE_COLUMNS = new Set([
  'estimate_date', 'desired_delivery_date', 'last_updated',
  'approved_date', 'sent_at',
]);

// Base44 の並び替え指定（"-created_date" / "name"）を Supabase の形に変換
function parseSort(sort) {
  if (!sort) return null;
  const ascending = !sort.startsWith('-');
  const field = ascending ? sort : sort.slice(1);
  return { column: toColumn(field), ascending };
}

function toColumn(field) {
  if (field === 'created_date') return 'created_at';
  if (field === 'updated_date') return 'updated_at';
  return field;
}

// 画面側は created_date / updated_date を参照するため、読み出し時に別名を足す
function decorate(row) {
  if (!row) return row;
  return { ...row, created_date: row.created_at, updated_date: row.updated_at };
}

function decorateAll(rows) {
  return (rows || []).map(decorate);
}

// 書き込み用に、許可カラムだけを取り出して整える
function sanitize(table, data) {
  const allowed = WRITABLE_COLUMNS[table];
  const out = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    let value = data[key];
    if (DATE_COLUMNS.has(key) && (value === '' || value === undefined)) value = null;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function unwrap({ data, error }) {
  if (error) {
    const err = new Error(error.message || 'データベース操作に失敗しました');
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}

function createEntity(entityName) {
  const table = TABLES[entityName];

  return {
    /**
     * @param {string} [sort]  例: "-created_date", "name"
     * @param {number} [limit]
     */
    async list(sort, limit) {
      let query = supabase.from(table).select('*');
      const parsed = parseSort(sort);
      if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending });
      if (limit) query = query.limit(limit);
      return decorateAll(unwrap(await query));
    },

    /**
     * @param {Object} conditions  例: { project_group_id: "CV-2607-001" }
     */
    async filter(conditions = {}, sort, limit) {
      let query = supabase.from(table).select('*');
      for (const [field, value] of Object.entries(conditions)) {
        query = query.eq(toColumn(field), value);
      }
      const parsed = parseSort(sort);
      if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending });
      if (limit) query = query.limit(limit);
      return decorateAll(unwrap(await query));
    },

    async get(id) {
      const query = supabase.from(table).select('*').eq('id', id).single();
      return decorate(unwrap(await query));
    },

    async create(data) {
      const query = supabase.from(table).insert(sanitize(table, data)).select().single();
      return decorate(unwrap(await query));
    },

    async update(id, data) {
      const query = supabase.from(table).update(sanitize(table, data)).eq('id', id).select().single();
      return decorate(unwrap(await query));
    },

    async delete(id) {
      unwrap(await supabase.from(table).delete().eq('id', id));
      return { id };
    },
  };
}

const entities = Object.fromEntries(
  Object.keys(TABLES).map((name) => [name, createEntity(name)])
);

// ============================================================================
// 認証
//
// Phase 3 で AuthContext ごと整理する予定。ここでは Base44 SDK と同じ形の
// 最小限のラッパーだけを用意し、データ層の動作確認ができる状態にしている。
// ============================================================================
const auth = {
  /** ログイン中のユーザー（プロフィールを含む）。未ログインなら 401 相当で throw */
  async me() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }

    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      // 認証は通ったが public.users に行がない = このアプリの利用者として未登録
      const err = new Error('User not registered for this app');
      err.status = 403;
      throw err;
    }

    return {
      ...profile,
      id: user.id,
      email: user.email,
      full_name: profile.full_name || user.user_metadata?.full_name || user.email,
    };
  },

  async loginWithProvider(provider = 'google', redirectTo = '/') {
    return unwrap(await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: new URL(redirectTo, window.location.origin).toString(),
        // 社内ドメインのアカウント選択を促す
        queryParams: { hd: 'concept-village.co.jp', prompt: 'select_account' },
      },
    }));
  },

  async logout(redirectTo = '/login') {
    await supabase.auth.signOut();
    window.location.href = redirectTo;
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  },
};

// ============================================================================
// 未移行の機能
// 呼ばれた時点で「どのフェーズで実装するか」が分かるように明示的に失敗させる。
// ============================================================================
function notYetMigrated(what, phase) {
  return () => {
    throw new Error(`${what} は未移行です（Phase ${phase} で Vercel Functions へ移植予定）`);
  };
}

const integrations = {
  Core: {
    InvokeLLM: notYetMigrated('AI呼び出し（InvokeLLM）', 4),
    UploadFile: notYetMigrated('ファイルアップロード（UploadFile）', 4),
  },
};

const functions = {
  invoke: notYetMigrated('サーバー関数の呼び出し', 4),
};

const users = {
  inviteUser: notYetMigrated('メンバー招待', 3),
};

export const db = { entities, auth, integrations, functions, users };
