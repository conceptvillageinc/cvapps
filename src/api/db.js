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
  Invitation: 'invitations',
  Project: 'projects',
  RecurringProjectTemplate: 'recurring_project_templates',
  DeliveryNote: 'delivery_notes',
  Invoice: 'invoices',
  BankTransaction: 'bank_transactions',
  FiscalTarget: 'fiscal_targets',
};

// 書き込みを許可するカラム。
// ここに無いキーは無視される。画面側が送ってくる Base44 の名残
// （freee_status / created_date / id など）を安全に捨てるための仕組み。
const WRITABLE_COLUMNS = {
  // 招待の作成はサーバー側（/api/invite）が行う。画面からは取り消し（削除）だけ。
  invitations: ['email', 'role'],
  fiscal_targets: [
    'fiscal_year', 'sales', 'purchase', 'gross_jump', 'gross_must',
    'actual_purchase', 'actual_other_cost', 'notes',
  ],
  bank_transactions: [
    'bank', 'account_label', 'transaction_date', 'amount_in', 'amount_out', 'payee_raw',
    'payee_normalized', 'balance', 'source_hash', 'match_status', 'invoice_id', 'matched_by',
    'memo', 'imported_by',
  ],
  delivery_notes: [
    'delivery_number', 'project_id', 'estimate_id', 'client_id', 'client_name', 'client_honorific',
    'client_postal_code', 'client_address', 'title', 'delivery_date', 'line_items',
    'subtotal', 'tax', 'total', 'tax_breakdown', 'notes', 'status', 'invoice_id',
    'person_in_charge', 'created_by',
  ],
  invoices: [
    'invoice_number', 'project_id', 'client_id', 'client_name', 'client_honorific',
    'client_postal_code', 'client_address', 'title', 'invoice_date', 'due_date', 'line_items',
    'subtotal', 'tax', 'total', 'tax_breakdown', 'notes', 'status', 'sent_at', 'paid_at',
    'paid_amount', 'delivery_method', 'person_in_charge', 'created_by',
  ],
  recurring_project_templates: [
    'client_id', 'client_name', 'name', 'deal_probability', 'phase',
    'expected_revenue', 'expected_cost', 'other_cost',
    'start_month', 'end_month', 'is_active', 'notes', 'created_by',
  ],
  projects: [
    'project_number', 'client_id', 'client_name', 'name', 'deal_probability', 'phase',
    'status', 'expected_revenue', 'expected_cost', 'other_cost',
    'confirmed_revenue', 'confirmed_cost', 'registered_at', 'due_date',
    'payment_due_date', 'vendor_payment_date', 'is_recurring', 'notes', 'created_by',
  ],
  estimates: [
    'estimate_number', 'project_id', 'client_name', 'print_specs', 'client_honorific', 'person_in_charge',
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
    'invoice_delivery_method', 'invoice_delivery_notes', 'has_recurring_billing', 'bank_payee_names',
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
    'subject', 'body', 'status', 'sent_at', 'spec_label', 'document_type', 'document_id',
  ],
  system_settings: ['setting_key', 'setting_value', 'description'],
  faq_items: ['question', 'answer', 'sort_order'],
  users: ['full_name', 'role', 'department'],
};

// 日付系カラムは空文字を渡すと Postgres がエラーになるため null に寄せる
const DATE_COLUMNS = new Set([
  'estimate_date', 'desired_delivery_date', 'last_updated',
  'approved_date', 'sent_at',
  'registered_at', 'due_date', 'payment_due_date', 'vendor_payment_date',
  'start_month', 'end_month', 'delivery_date', 'invoice_date', 'due_date', 'paid_at', 'transaction_date',
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
        // NULL の比較は eq では一致しない（SQL の NULL = NULL は真にならない）。
        // 「未対応のものだけ」のような絞り込みには is を使う必要がある。
        query = value === null
          ? query.is(toColumn(field), null)
          : query.eq(toColumn(field), value);
      }
      const parsed = parseSort(sort);
      if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending });
      if (limit) query = query.limit(limit);
      return decorateAll(unwrap(await query));
    },

    /**
     * 期間で絞り込む（from ≦ column ≦ to）。会計期ごとの一覧など、
     * 全件を取ると多すぎる表に使う。from / to は省略可。
     */
    async between(column, from, to, sort, conditions = {}) {
      let query = supabase.from(table).select('*');
      if (from) query = query.gte(toColumn(column), from);
      if (to) query = query.lte(toColumn(column), to);
      for (const [field, value] of Object.entries(conditions)) {
        query = value === null ? query.is(toColumn(field), null) : query.eq(toColumn(field), value);
      }
      const parsed = parseSort(sort);
      if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending });
      return decorateAll(unwrap(await query.limit(5000)));
    },

    /** 指定した列が配列のいずれかに一致する行 */
    async whereIn(column, values, sort) {
      if (!values || values.length === 0) return [];
      let query = supabase.from(table).select('*').in(toColumn(column), values);
      const parsed = parseSort(sort);
      if (parsed) query = query.order(parsed.column, { ascending: parsed.ascending });
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

    /** 複数行をまとめて作成する（取込用） */
    async createMany(rows) {
      if (!rows || rows.length === 0) return [];
      const query = supabase.from(table).insert(rows.map((r) => sanitize(table, r))).select();
      return decorateAll(unwrap(await query));
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
      err.email = user.email;
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
// ファイル保管・AI呼び出し
// ============================================================================

const UPLOAD_BUCKET = 'uploads';

/** ログイン中のアクセストークン。サーバー側はこれで呼び出し元を確認する。 */
async function accessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const err = new Error('ログインの有効期限が切れました。再度ログインしてください');
    err.status = 401;
    throw err;
  }
  return session.access_token;
}

/** /api/* の Vercel Function を呼ぶ。 */
async function callFunction(name, payload) {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `サーバー処理に失敗しました (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ファイル名に日本語や記号が入っていても壊れないよう、保存名は機械的に付ける。
// 元のファイル名は拡張子だけ引き継ぐ。
function storagePath(file) {
  const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || ['.bin'])[0].toLowerCase();
  return `${crypto.randomUUID()}${ext}`;
}

const integrations = {
  Core: {
    /**
     * Supabase Storage の非公開バケットへ保存する。
     * 返す file_url はバケット内のパス。公開URLではない（URLが漏れても読めない）。
     * サーバー側の /api/llm がこのパスを受け取り、service_role で実体を読む。
     */
    async UploadFile({ file }) {
      const path = storagePath(file);
      const { error } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });

      if (error) throw new Error(`ファイルの保存に失敗しました: ${error.message}`);

      return { file_url: path, file_path: path };
    },

    /** Claude API 呼び出し。APIキーはサーバー側にあり、ブラウザには出ない。 */
    async InvokeLLM({ prompt, file_urls, response_json_schema }) {
      const result = await callFunction('llm', {
        prompt,
        file_urls: file_urls || [],
        response_json_schema,
      });
      // スキーマ無しの場合は { text } が返る。画面側は文字列も受け取れる作りなので合わせる。
      return response_json_schema ? result : result.text;
    },
  },
};

// Base44 のサーバー関数名 → Vercel Function のパス
const FUNCTION_ROUTES = {
  fetchPriceFromUrl: 'fetch-price',
  sendEstimateEmail: 'send-estimate-email',
  sendDocumentEmail: 'send-document-email',
};

const functions = {
  /**
   * Base44 の functions.invoke 互換。
   * 呼び出し側が res.data を見る作りなので、返り値は { data } で包む。
   */
  async invoke(name, payload) {
    const route = FUNCTION_ROUTES[name];
    if (!route) {
      throw new Error(`${name} は未移行です（Phase 4-C で対応予定）`);
    }
    return { data: await callFunction(route, payload) };
  },
};

const users = {
  /** 管理者がメンバーを招待する。権限の確認はサーバー側で行う。 */
  async inviteUser(email, role = 'user') {
    return callFunction('invite', { email, role });
  },
};

// 未移行の機能。呼ばれた時点でどこで実装するかが分かるように明示的に失敗させる。
function notYetMigrated(what, phase) {
  return () => {
    throw new Error(`${what} は未移行です（Phase ${phase} で対応予定）`);
  };
}

// ----------------------------------------------------------------------------
// ストレージと帳票PDF
// ----------------------------------------------------------------------------
const storage = {
  /** 非公開バケットのファイルを一時的に表示するための署名付きURL（1時間） */
  async signedUrl(path, expiresIn = 3600) {
    if (!path) return null;
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw new Error(`ファイルのURLを取得できませんでした: ${error.message}`);
    return data.signedUrl;
  },
};

const documents = {
  /**
   * 納品書・請求書のPDFをサーバーで生成して受け取る。
   * @param {'delivery'|'invoice'} type
   * @returns {Promise<Blob>}
   */
  async pdf(type, id) {
    const res = await fetch('/api/document-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ type, id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `PDFの生成に失敗しました (${res.status})`);
    }
    return res.blob();
  },
};

export const db = { entities, auth, integrations, functions, users, storage, documents };
