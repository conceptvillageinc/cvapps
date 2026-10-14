import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

/**
 * 押したボタンのすぐ横に出る確認（画面の上に出るブラウザの確認の代わり）。
 * children がボタン。「消す」を押すと onConfirm を呼ぶ。
 */
export default function ConfirmPopover({ children, message, confirmLabel = "消す", onConfirm, align = "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} side="bottom" className="w-64 p-3" data-testid="confirm-popover">
        <p className="text-sm leading-relaxed break-words">{message}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" className="h-8 hover:bg-slate-100 hover:text-foreground" onClick={() => setOpen(false)}>やめる</Button>
          <Button size="sm" variant="destructive" className="h-8" autoFocus onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
