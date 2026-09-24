// ============================================================================
// 印刷所への見積依頼の進み具合（仕様 → 送信 → 返答 → 取り込み）
//
// 判断の材料:
//   仕様       estimate.print_specs
//   送信       email_logs（status = sent）
//   返答       手動の「返答あり」（replied_at）または Gmail で検知した返信（reply_detected_at）
//   取り込み   見積明細に source_type = vendor_quote で、その会社名（source_ref）の行がある
// ============================================================================

/** 会社ごとの状態 */
export const VENDOR_STATE = {
  not_sent: { key: "not_sent", label: "未送信", cls: "bg-muted text-muted-foreground" },
  waiting: { key: "waiting", label: "返答待ち", cls: "bg-blue-100 text-blue-700" },
  replied: { key: "replied", label: "返答あり", cls: "bg-amber-100 text-amber-800" },
  imported: { key: "imported", label: "取り込み済み", cls: "bg-emerald-100 text-emerald-700" },
  failed: { key: "failed", label: "送信失敗", cls: "bg-red-100 text-red-700" },
};

const latest = (logs) => [...logs].sort((a, b) => String(b.sent_at || b.created_date || "").localeCompare(String(a.sent_at || a.created_date || "")))[0] || null;

/**
 * @param {object} estimate
 * @param {Array} emailLogs   この見積の email_logs
 * @param {string[]} vendorNames  対象の会社名（送信済みの会社 ＋ 選択中の送信先）
 */
export function vendorRequestStatus(estimate, allLogs = [], vendorNames = []) {
  // クライアントへの見積書送付（document_type あり）は印刷所への依頼ではないので除く
  const emailLogs = (allLogs || []).filter((l) => !l.document_type);
  const items = (estimate.line_items || []).filter((li) => li.row_type !== "text" && li.row_type !== "subtotal");
  const importedVendors = new Set(items.filter((li) => li.source_type === "vendor_quote" && li.source_ref).map((li) => li.source_ref));
  const names = [...new Set([...emailLogs.map((l) => l.recipient_company), ...vendorNames].filter(Boolean))];

  const vendors = names.map((name) => {
    const logs = emailLogs.filter((l) => l.recipient_company === name);
    const sentLogs = logs.filter((l) => l.status === "sent");
    const last = latest(sentLogs) || latest(logs);
    const manual = sentLogs.find((l) => l.replied_at) || logs.find((l) => l.replied_at);
    const auto = sentLogs.find((l) => l.reply_detected_at);
    const imported = importedVendors.has(name);
    let state;
    if (imported) state = VENDOR_STATE.imported;
    else if (manual || auto) state = VENDOR_STATE.replied;
    else if (sentLogs.length > 0) state = VENDOR_STATE.waiting;
    else if (logs.some((l) => l.status === "failed")) state = VENDOR_STATE.failed;
    else state = VENDOR_STATE.not_sent;
    return {
      name,
      state,
      sentCount: sentLogs.length,
      lastSentAt: last?.sent_at || null,
      lastLog: last,
      manualReply: manual ? { at: manual.replied_at, by: manual.replied_by, note: manual.reply_note } : null,
      autoReply: auto ? { at: auto.reply_detected_at, from: auto.reply_from, snippet: auto.reply_snippet } : null,
      checkedAt: sentLogs.map((l) => l.reply_checked_at).filter(Boolean).sort().pop() || null,
      imported,
    };
  });

  const specs = estimate.print_specs || [];
  const sent = vendors.filter((v) => v.sentCount > 0).length;
  const replied = vendors.filter((v) => v.state.key === "replied" || v.state.key === "imported").length;
  const imported = vendors.filter((v) => v.imported).length;
  // 今どの段階か: 1 仕様 / 2 送信 / 3 返答の取り込み / 4 完了
  const step = specs.length === 0 ? 1 : sent === 0 ? 2 : imported === 0 ? 3 : 4;
  return { vendors, specs: specs.length, sent, replied, imported, total: vendors.length, step };
}
