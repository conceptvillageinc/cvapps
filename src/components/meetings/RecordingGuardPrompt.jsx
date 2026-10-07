import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, AlertTriangle } from "lucide-react";
import { fmtClock } from "@/lib/meetings";

/**
 * 録音の止め忘れの確認（どの画面にいても前面に出す）。
 *   無音が続いたとき・録音時間の上限に達したときに出し、応答が無ければ自動で録音を終える。
 * @param {{ reason: 'silence'|'limit', deadline: number, silentMin: number, limitLabel: string }} p.guard
 */
export default function RecordingGuardPrompt({ guard, title, elapsed, onContinue, onFinish }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil((guard.deadline - now) / 1000));
  const silence = guard.reason === "silence";

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="rec-guard-title" data-testid="recording-guard">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-red-600 text-white px-5 py-3 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
          <Mic className="w-4 h-4" />
          <span className="text-sm font-semibold">レコーディング中</span>
          <span className="ml-auto text-sm tabular-nums">{fmtClock(elapsed)}</span>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p id="rec-guard-title" className="text-lg font-bold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-600" /> 録音を続けますか？</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {silence
              ? <>{guard.silentMin} 分以上、音を拾えていません。打ち合わせが終わっていて、録音の止め忘れかもしれません。</>
              : <>録音時間が上限の {guard.limitLabel}に達しました。</>}
            {title ? <><br />議事録「{title}」</> : null}
          </p>
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
            応答が無ければ、あと <b className="tabular-nums text-base">{fmtClock(left)}</b> で録音を自動で終えます
            {silence && <span className="block text-[11px] mt-0.5">無音になってからの部分は保存しないので、文字起こしの時間と利用料もかかりません</span>}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Button className="flex-1 h-11 bg-red-600 hover:bg-red-700 gap-1.5" onClick={onFinish}><Square className="w-4 h-4" /> 録音を終える</Button>
            <Button variant="outline" className="flex-1 h-11 gap-1.5" onClick={onContinue}><Mic className="w-4 h-4" /> {silence ? "録音を続ける" : "1 時間延ばして続ける"}</Button>
          </div>
          {silence && <p className="text-[11px] text-muted-foreground">話し声を拾うと、この確認は自動で閉じて録音を続けます</p>}
        </div>
      </div>
    </div>
  );
}
