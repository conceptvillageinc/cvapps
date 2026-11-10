import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// 一覧の検索・絞り込み・並び順を覚えておく（詳細を開いて戻ってきても残る）
//   このタブのあいだは sessionStorage に JSON で入れる（タブを閉じると消える）。
//   一覧の行は詳細を新しいタブで開くので、新しいタブには sessionStorage が引き継がれない。
//   そこで最後に使った値を localStorage にも控えておき、まだ値の無いタブ（詳細から「←」で一覧に戻ったときなど）は
//   その控えを使う。控えは KEEP_MS（12 時間）まで。古い控えは使わない（翌日に開いたら最初の状態）。
//   使えないとき（プライベートなど）は、ふつうの useState と同じ。
// ============================================================================
const PREFIX = "cvapps:list:";
const SHARED_PREFIX = "cvapps:listShared:";
const KEEP_MS = 12 * 60 * 60 * 1000;

function read(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
  } catch { /* 読めなければ控えを見る */ }
  try {
    const shared = window.localStorage.getItem(SHARED_PREFIX + key);
    if (shared !== null) {
      const { v, t } = JSON.parse(shared);
      if (Date.now() - Number(t) < KEEP_MS) return v;
    }
  } catch { /* 控えも読めなければ初期値 */ }
  return fallback;
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
    try { window.localStorage.setItem(SHARED_PREFIX + key, JSON.stringify({ v: value, t: Date.now() })); } catch { /* 同上 */ }
  }, [key, value]);
  const set = useCallback((v) => setValue(v), []);
  return [value, set];
}
