import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "@/api/db";
import { Loader2 } from "lucide-react";

/**
 * 短いURL: /e/CV-2609-011 → その見積番号の見積詳細へ。
 * Asana やチャットに貼るためのリンク用（見積書の「リンクをコピー」が出す形）。
 */
export default function EstimateShortLink() {
  const { number } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await db.entities.Estimate.filter({ estimate_number: decodeURIComponent(number || "") });
        if (!alive) return;
        if (rows.length === 0) { setError(`見積番号 ${number} が見つかりません`); return; }
        navigate(`/estimates/${rows[0].id}`, { replace: true });
      } catch (err) {
        if (alive) setError(err.message || "見積を開けませんでした");
      }
    })();
    return () => { alive = false; };
  }, [number, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-sm text-muted-foreground">
        <p>{error}</p>
        <button className="text-primary hover:underline text-xs" onClick={() => navigate("/estimates")}>見積一覧へ</button>
      </div>
    );
  }
  return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
}
