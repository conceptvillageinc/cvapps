import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
import { shareText, copyShareText } from "@/lib/shareText";

/**
 * CV メンバーに共有する用:「▼納品書_クライアント名_件名」とこの帳票の URL をコピーする（見積の「CV 共有用のタイトルと URL をコピー」と同じ形）
 *   path: アプリの中のパス（例: /delivery-notes/<id>）
 */
export default function CopyShareLinkButton({ kind, clientName, title, path }) {
  const copy = () => copyShareText(shareText(kind, clientName, title, `${window.location.origin}${path}`));
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={copy}
      title={`「▼${kind}_クライアント名_件名」とこの${kind}の URL をコピー（CV メンバーへの共有・Asana やチャットに貼る用）`}
      data-testid="copy-share-link"
    >
      <Link2 className="w-3.5 h-3.5" /> リンクをコピー
    </Button>
  );
}
