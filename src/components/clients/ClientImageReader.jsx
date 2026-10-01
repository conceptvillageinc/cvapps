import { useRef, useState } from "react";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ImagePlus, Loader2, ClipboardPaste } from "lucide-react";

// クライアント情報を画像（メール署名のスクショ・名刺・会社概要ページ）から読み取る
const SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string", description: "会社名・団体名（法人格を含めて正式表記。個人なら氏名）" },
    company_name_kana: { type: "string", description: "会社名のフリガナ（全角カタカナ。画像に無ければ読みを推定。法人格は『カブシキガイシャ』のように含める）" },
    contact_person: { type: "string", description: "担当者の氏名（姓と名の間に全角スペース）。会社概要など個人名が無ければ空" },
    contact_person_kana: { type: "string", description: "担当者名のフリガナ（全角カタカナ）。画像に無ければ読みを推定。担当者が無ければ空" },
    department: { type: "string", description: "部署・役職。無ければ空" },
    email: { type: "string", description: "メールアドレス。無ければ空" },
    phone: { type: "string", description: "電話番号（ハイフン区切り）。携帯と固定の両方あれば固定を優先。無ければ空" },
    mobile: { type: "string", description: "携帯番号（固定電話と別にあれば）。無ければ空" },
    fax: { type: "string", description: "FAX 番号。無ければ空" },
    postal_code: { type: "string", description: "郵便番号（数字 7 桁、ハイフン無し）。無ければ空" },
    address: { type: "string", description: "住所（郵便番号を除く。都道府県から建物名まで）。無ければ空" },
    website: { type: "string", description: "Web サイトの URL。無ければ空" },
    notes: { type: "string", description: "その他、登録に役立つ情報（事業内容・設立・代表者名など）。1〜2 行。無ければ空" },
  },
  required: ["company_name", "company_name_kana", "contact_person", "contact_person_kana", "department", "email", "phone", "mobile", "fax", "postal_code", "address", "website", "notes"],
};

const PROMPT = `添付した画像（メールの署名のスクリーンショット、名刺、Web サイトの会社概要ページなど）から、取引先として登録する情報を読み取ってください。
- 画像に書かれている内容だけを使い、無い項目は空文字にする（住所や電話を推測で作らない）。フリガナだけは読みを推定してよい。
- 名刺や署名に複数の会社・住所がある場合は、本社または名刺の主体の 1 件にまとめる。
- 郵便番号は数字 7 桁、電話・FAX はハイフン区切り、メールと URL はそのまま。
- 株式会社コンセプト・ヴィレッジ（自社）の情報が写り込んでいても対象にしない。`;

const MAX_FILES = 3;

/** 読み取った結果をクライアント登録フォームの形にする */
export function toClientForm(r) {
  const extra = [
    r.department ? `部署・役職: ${r.department}` : "",
    r.mobile ? `携帯: ${r.mobile}` : "",
    r.fax ? `FAX: ${r.fax}` : "",
    r.website ? `URL: ${r.website}` : "",
    r.notes || "",
  ].filter(Boolean).join("\n");
  return {
    name: r.company_name || "",
    name_kana: r.company_name_kana || "",
    contact_person: r.contact_person || "",
    contact_person_kana: r.contact_person_kana || "",
    email: r.email || "",
    phone: r.phone || r.mobile || "",
    postal_code: String(r.postal_code || "").replace(/\D/g, ""),
    address: r.address || "",
    notes: extra,
  };
}

/**
 * 画像を選ぶ／貼り付けると読み取り、onResult(フォームの値) を返す。
 */
export default function ClientImageReader({ onResult, disabled }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const read = async (files) => {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf").slice(0, MAX_FILES);
    if (list.length === 0) { toast.error("画像または PDF を選んでください"); return; }
    setBusy(true);
    try {
      const paths = [];
      for (const f of list) {
        const { file_url } = await db.integrations.Core.UploadFile({ file: f });
        paths.push(file_url);
      }
      const res = await db.integrations.Core.InvokeLLM({ prompt: PROMPT, file_urls: paths, response_json_schema: SCHEMA });
      if (!res || !res.company_name) { toast.error("会社名を読み取れませんでした。別の画像で試してください"); return; }
      onResult(toClientForm(res));
      toast.success("読み取りました。内容を確認してから保存してください");
    } catch (e) {
      toast.error("読み取れませんでした: " + (e?.message || e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) files.push(new File([await it.getType(type)], `clipboard.${type.split("/")[1] || "png"}`, { type }));
      }
      if (files.length === 0) { toast.error("クリップボードに画像がありません（スクリーンショットをコピーしてから押してください）"); return; }
      await read(files);
    } catch {
      toast.error("クリップボードを読めませんでした。ブラウザの許可を確認するか、ファイルを選んでください");
    }
  };

  return (
    <div
      className={`rounded-lg border border-dashed p-3 text-xs space-y-2 transition-colors ${over ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy && !disabled) read(e.dataTransfer.files); }}
      onPaste={(e) => { const files = Array.from(e.clipboardData?.files || []); if (files.length) { e.preventDefault(); read(files); } }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">画像から読み取る</span>
        <span className="text-muted-foreground">メール署名のスクショ・名刺・会社概要ページ（最大 {MAX_FILES} 枚）</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={busy || disabled} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} 画像を選ぶ
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={busy || disabled} onClick={pasteFromClipboard}>
          <ClipboardPaste className="w-3.5 h-3.5" /> クリップボードから貼り付け
        </Button>
        <span className="text-[11px] text-muted-foreground">ここにドロップや Ctrl+V でも読み取れます</span>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => read(e.target.files)} />
      </div>
      {busy && <p className="text-[11px] text-muted-foreground">読み取り中…（10 秒ほどかかります）</p>}
    </div>
  );
}
