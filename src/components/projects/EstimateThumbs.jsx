import DocThumbs, { THUMB_COUNT } from "@/components/projects/DocThumbs";

// 案件の画面の「見積」の欄の見積書プレビュー（中身は DocThumbs。納品書・請求書の欄と同じもの）
export { THUMB_COUNT };
export default function EstimateThumbs({ estimates, all = false }) {
  return <DocThumbs kind="estimate" docs={estimates} all={all} />;
}
