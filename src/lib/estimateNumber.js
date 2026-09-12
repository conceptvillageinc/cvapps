// 見積番号の採番ロジック
// 形式: CV-YYMM-連番（例: CV-2607-001）。月が変わると連番は1にリセットされる。
// 同時作成などで万一番号が重複した場合は、自動でサフィックス（-b, -c...）を付けて回避する。

function padSeq(n) {
  return String(n).padStart(3, "0");
}

export async function generateEstimateNumber(base44) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `CV-${yy}${mm}-`;

  // 直近の見積を取得し、同月内の連番の最大値を調べる
  const all = await base44.entities.Estimate.list("-created_date", 500);
  const usedNumbers = new Set(all.map(e => e.estimate_number).filter(Boolean));

  const thisMonthSeqs = all
    .map(e => e.estimate_number)
    .filter(n => n && n.startsWith(prefix))
    .map(n => {
      const match = n.slice(prefix.length).match(/^(\d{3})/);
      return match ? parseInt(match[1], 10) : 0;
    });

  let seq = thisMonthSeqs.length > 0 ? Math.max(...thisMonthSeqs) + 1 : 1;
  let candidate = `${prefix}${padSeq(seq)}`;

  // 念のための重複チェック（同時作成などのレアケース対策）
  const suffixes = ["b", "c", "d", "e", "f", "g", "h"];
  let suffixIdx = 0;
  while (usedNumbers.has(candidate)) {
    if (suffixIdx < suffixes.length) {
      candidate = `${prefix}${padSeq(seq)}-${suffixes[suffixIdx]}`;
      suffixIdx++;
    } else {
      seq++;
      candidate = `${prefix}${padSeq(seq)}`;
      suffixIdx = 0;
    }
  }

  return candidate;
}
