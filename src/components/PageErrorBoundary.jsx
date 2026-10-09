import { Component } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * 画面の描画中にエラーが起きたとき、真っ白にせずにメッセージを出す。
 *   resetKey（ページの URL）が変われば元に戻す（サイドバーから別の画面に移れる）。
 */
export default class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("画面の表示でエラー:", error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl mx-auto mt-16 rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900 space-y-3" role="alert">
        <p className="flex items-center gap-2 font-medium"><AlertTriangle className="w-5 h-5" /> この画面を表示できませんでした</p>
        <p className="text-sm">入力中の内容は保存されていない場合があります。再読み込みしても直らないときは、下のエラー内容を管理者に伝えてください。</p>
        <pre className="text-xs whitespace-pre-wrap break-all rounded bg-white/70 border border-amber-200 p-2">{String(this.state.error?.message || this.state.error)}</pre>
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>再読み込み</Button>
      </div>
    );
  }
}
