/**
 * 文字だけの行の「テキスト ⇄ タイトル（太字）」切り替えボタン（納品書・請求書の編集画面）
 *   bold: true の行はタイトル行。プレビュー・PDF で太字になる
 */
export default function TitleToggle({ bold, onToggle, disabled }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`shrink-0 rounded border px-1.5 h-6 text-[10px] leading-none disabled:opacity-50 ${bold ? "border-slate-700 bg-slate-800 text-white font-bold" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}
      title={bold ? "タイトル行（太字）です。押すとふつうのテキスト行にします" : "テキスト行です。押すとタイトル行（太字）にします"}
      aria-pressed={!!bold}
      data-testid="title-toggle"
    >
      {bold ? "タイトル" : "テキスト"}
    </button>
  );
}
