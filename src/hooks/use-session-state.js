import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// 一覧の検索・絞り込み・並び順を、このタブのあいだ覚えておく（詳細を開いて戻ってきても残る）
//   sessionStorage に JSON で入れる。タブを閉じると消える。使えないとき（プライベートなど）は、ふつうの useState と同じ。
// ============================================================================
const PREFIX = "cvapps:list:";

function read(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * useState と同じ使い方。key ごとに、このタブのあいだ値を覚える。
 * @param {string} key  一覧ごとに別の名前（例: "estimates.search"）
 * @param {*} initial  覚えた値が無いときの初期値（関数でもよい）
 */
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => read(key, typeof initial === "function" ? initial() : initial));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try { window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* 覚えられなくても動く */ }
  }, [key, value]);
  const set = useCallback((v) => setValue(v), []);
  return [value, set];
}
