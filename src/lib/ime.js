// 日本語入力の変換中の Enter（変換の確定）かどうか。
// 確定の Enter で「追加」「次の欄へ」「確定」などを動かすと、変換途中の文字で追加されたり、
// 確定した文字が次の欄に入ったりするので、Enter の処理はこれが true のときは何もしない。
export const isImeEnter = (e) => !!(e?.nativeEvent?.isComposing || e?.isComposing || e?.keyCode === 229);
