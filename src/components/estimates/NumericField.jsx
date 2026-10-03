import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";

// 数値入力欄：入力中はローカルの文字列として保持し、フォーカスを外した時（blur）や
// Enterキーで確定させる。毎回のキー入力で即座にNumber化すると、入力途中の空文字・
// 小数点のみの状態などが0に丸められてしまい、正しく入力できなくなるための対策。
export default function NumericField({ value, onCommit, className, placeholder, onEnter, ...rest }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));

  useEffect(() => {
    setText(value === null || value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const num = parseFloat(text);
    if (!isNaN(num)) {
      onCommit(num);
    } else {
      setText(value === null || value === undefined ? "" : String(value));
    }
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          // Enter で確定したら次の欄へ（明細の表では 名称 → 数量 → 単位 → 単価 → 次の行）
          onEnter?.(e);
        }
      }}
      className={className}
      {...rest}
    />
  );
}
