// ============================================================================
// 見積 1 件の読み込み（react-query のキー ["estimate", id] の形をそろえる）
//   見積の画面・納品書の作成・見積の複製・発注書が同じキーを使う。画面ごとに
//   別の形（配列と 1 件）で持つとキャッシュが混ざり、見積から納品書を作ったときに
//   明細やクライアント名が空になっていた。ここで「配列で持って先頭を使う」に統一する。
// ============================================================================
import { db } from "@/api/db";

/** 保存中の見積（id → 保存の Promise）。読み込みは保存が終わるのを待ってから（保存前の古い内容を読まないため） */
const pendingSaves = new Map();
export function trackEstimateSave(id, promise) {
  pendingSaves.set(id, promise);
  const done = () => { if (pendingSaves.get(id) === promise) pendingSaves.delete(id); };
  promise.then(done, done);
  return promise;
}

/**
 * useQuery に渡す設定。
 * @param {string|null} id
 * @param {{ fresh?: boolean }} [opt]  fresh: 開くたびに読み直す（ほかの帳票に写すとき。直したばかりの内容を写すため）
 */
export function estimateQuery(id, { fresh = false } = {}) {
  return {
    queryKey: ["estimate", id],
    queryFn: async () => {
      try { await pendingSaves.get(id); } catch { /* 保存の失敗は保存側で知らせる */ }
      return db.entities.Estimate.filter({ id });
    },
    select: (d) => (Array.isArray(d) ? d[0] : d) || null,
    enabled: !!id,
    ...(fresh ? { staleTime: 0 } : {}),
  };
}
