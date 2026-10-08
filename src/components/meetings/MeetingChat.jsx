import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/api/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Paperclip, Send, X, FileText, Image as ImageIcon, Sheet, FilePlus2, Copy, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { QUICK_PROMPTS, BASIS_KIND, CHAT_ACCEPT, CHAT_MAX_FILES, draftAmount, draftCost, draftTotals, draftGroups } from "@/lib/meetingChat";

// ============================================================================
// 議事録の「AI に依頼」
//   議事録の内容・文字起こし・添付資料・このクライアントの社内見積と過去の見積・価格マスタを読んで、
//   依頼に答える（何でも相談できる）。見積の依頼のときだけ、回答に「見積のたたき台」の表が付き、
//   スプレッドシート・アプリの新規見積・両方に出力できる。
//   やり取りは議事録ごとに保存され、全員が見られる（誰の依頼かを表示）。
// ============================================================================

const EMPTY = [];
const yen = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "−" : ""}¥${Math.abs(v).toLocaleString()}`; };
const unitYen = (n) => `¥${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const isImage = (a) => /^image\//.test(a.type || "") || /\.(png|jpe?g|gif|webp)$/i.test(a.name || a.path || "");
const initial = (name) => String(name || "?").trim().slice(0, 1);

/** 回答の本文（見出し「## 」・箇条書き「- 」・強調 **…** だけを解釈する） */
function RichText({ text }) {
  const inline = (s, k) => String(s).split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part));
  const blocks = [];
  let list = null;
  String(text || "").split(/\r?\n/).forEach((line, i) => {
    const li = /^\s*(?:[-・*]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) { if (!list) { list = []; blocks.push({ type: "ul", items: list }); } list.push(li[1]); return; }
    list = null;
    if (/^#{1,4}\s+/.test(line)) blocks.push({ type: "h", text: line.replace(/^#+\s+/, ""), i });
    else if (line.trim() === "") blocks.push({ type: "sp", i });
    else blocks.push({ type: "p", text: line, i });
  });
  return (
    <div className="text-[13px] leading-relaxed space-y-1">
      {blocks.map((b, i) => {
        if (b.type === "h") return <p key={i} className="font-bold text-[13px] pt-1">{inline(b.text, i)}</p>;
        if (b.type === "ul") return <ul key={i} className="list-disc pl-5 space-y-0.5">{b.items.map((t, j) => <li key={j}>{inline(t, `${i}-${j}`)}</li>)}</ul>;
        if (b.type === "sp") return <div key={i} className="h-1" />;
        return <p key={i}>{inline(b.text, i)}</p>;
      })}
    </div>
  );
}

function FileChip({ a, onRemove }) {
  const open = async () => {
    try { const u = await db.storage.signedUrl(a.path); if (u) window.open(u, "_blank", "noopener"); } catch (e) { toast.error(e.message); }
  };
  return (
    <span className="inline-flex items-center gap-1 h-6 max-w-[220px] pl-1.5 pr-1 rounded border bg-background text-[11px]">
      {isImage(a) ? <ImageIcon className="w-3 h-3 shrink-0 text-muted-foreground" /> : <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />}
      <button type="button" onClick={open} className="truncate hover:underline" title={`${a.name} を開く`}>{a.name}</button>
      {onRemove && <button type="button" onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`${a.name} を外す`}><X className="w-3 h-3" /></button>}
    </span>
  );
}

/** 見積のたたき台（表・合計・出力ボタン） */
function DraftCard({ msg, meetingId, onSheet }) {
  const d = msg.draft;
  const t = draftTotals(d.items);
  const [busy, setBusy] = useState("");
  const openEstimate = () => window.open(`/estimates/new?meeting=${meetingId}&chat=${msg.id}`, "_blank", "noopener");
  const toSheet = async () => {
    const { data } = await db.functions.invoke("meetingChat", { action: "sheet", message_id: msg.id });
    onSheet?.();
    return data.sheet_url;
  };
  const run = async (kind) => {
    setBusy(kind);
    // 新しいタブはクリックの直後に開く（待ってから開くとポップアップとして止められる）
    const tab = kind === "both" || kind === "sheet" ? window.open("about:blank", "_blank") : null;
    try {
      if (kind === "estimate") { openEstimate(); return; }
      const url = await toSheet();
      if (tab) tab.location.href = url;
      toast.success("スプレッドシートに出力しました（あなたのマイドライブ）");
      if (kind === "both") openEstimate();
    } catch (e) {
      tab?.close();
      toast.error("出力できませんでした: " + e.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-md border border-teal-200 bg-white overflow-hidden" data-testid="chat-draft">
      <div className="px-3 py-2 bg-teal-50/70 border-b border-teal-200 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs font-bold text-teal-900">見積のたたき台{d.title ? `「${d.title}」` : ""}</p>
        <span className="text-[11px] text-teal-900/80">{d.items.length} 行</span>
        {t.checks > 0 && <span className="text-[11px] text-red-700 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> 要確認 {t.checks} 行</span>}
        <span className="ml-auto text-xs font-bold tabular-nums">小計 {yen(t.subtotal)}<span className="font-normal text-muted-foreground">（税込 {yen(t.total)}）</span></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead className="text-[10.5px] text-muted-foreground bg-muted/30">
            <tr>
              <th className="text-left font-medium px-2 py-1 min-w-[200px]">品名・仕様</th>
              <th className="text-right font-medium px-2 py-1 whitespace-nowrap">数量</th>
              <th className="text-right font-medium px-2 py-1 whitespace-nowrap">単価</th>
              <th className="text-right font-medium px-2 py-1 whitespace-nowrap">金額</th>
              <th className="text-right font-medium px-2 py-1 whitespace-nowrap">原価</th>
              <th className="text-left font-medium px-2 py-1">根拠</th>
            </tr>
          </thead>
          <tbody>
            {draftGroups(d.items).map((g) => (
              <FragmentGroup key={g.group} g={g} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t bg-muted/20 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums">
        <span>小計（税別） <b>{yen(t.subtotal)}</b></span>
        <span>消費税 {yen(t.tax)}</span>
        <span>合計（税込） <b>{yen(t.total)}</b></span>
        {t.cost > 0 && <span className="text-muted-foreground">原価 {yen(t.cost)}・粗利 {yen(t.gross)}{t.margin != null ? `（${(t.margin * 100).toFixed(1)}%）` : ""}</span>}
      </div>
      {d.notes && (
        <div className="px-3 py-2 border-t text-[11px]">
          <p className="font-semibold text-muted-foreground mb-0.5">前提・確認事項</p>
          <ul className="list-disc pl-4 space-y-0.5">{d.notes.split(/\r?\n/).filter(Boolean).map((l, i) => <li key={i}>{l.replace(/^[-・]\s*/, "")}</li>)}</ul>
        </div>
      )}
      <div className="px-3 py-2.5 border-t flex flex-wrap items-center gap-2" data-testid="chat-draft-actions">
        <span className="text-[11px] font-semibold text-muted-foreground mr-1">出力先</span>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => run("sheet")} disabled={!!busy}>
          {busy === "sheet" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5 text-emerald-700" />} ① スプレッドシート
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => run("estimate")} disabled={!!busy}>
          <FilePlus2 className="w-3.5 h-3.5 text-teal-700" /> ② アプリの新規見積
        </Button>
        <Button size="sm" className="h-8 text-xs gap-1.5 bg-teal-700 hover:bg-teal-800" onClick={() => run("both")} disabled={!!busy}>
          {busy === "both" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} ③ 両方に出力
        </Button>
        {msg.sheet_url && (
          <a href={msg.sheet_url} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 ml-auto">出力したスプレッドシートを開く <ExternalLink className="w-3 h-3" /></a>
        )}
        <p className="w-full text-[10.5px] text-muted-foreground">② は新しいタブで新規見積を開き、左の「引き継ぐ明細」で行を選び直せます。要確認の行は、作成後に「印刷費・仕入の価格確認」でも確かめられます</p>
      </div>
    </div>
  );
}

function FragmentGroup({ g }) {
  return (
    <>
      <tr className="bg-muted/10"><td colSpan={6} className="px-2 pt-2 pb-0.5 text-[10.5px] font-semibold text-muted-foreground">{g.group || "（区分なし）"}</td></tr>
      {g.items.map((it) => {
        const b = BASIS_KIND[it.basis_kind] || BASIS_KIND.guess;
        return (
          <tr key={it.key} className={`border-t align-top ${it.needs_check ? "bg-red-50/40" : ""}`} data-testid="chat-draft-row">
            <td className="px-2 py-1.5"><div className="font-medium">{it.name}</div>{it.spec && <div className="text-[10.5px] text-muted-foreground">{it.spec}</div>}</td>
            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{Number(it.quantity).toLocaleString()}{it.unit}</td>
            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{unitYen(it.unit_price)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold">{yen(draftAmount(it))}</td>
            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">{draftCost(it) ? yen(draftCost(it)) : "—"}</td>
            <td className="px-2 py-1.5 min-w-[220px]">
              <span className={`inline-block mr-1 px-1.5 rounded border text-[10px] ${b.cls}`}>{it.needs_check && it.basis_kind !== "guess" ? `${b.label}・要確認` : it.basis_kind === "guess" ? "推測・要確認" : b.label}</span>
              <span className="text-[10.5px] text-muted-foreground">{it.basis}</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * @param {object} p
 * @param {object} p.meeting
 * @param {object[]} p.references   議事録の「参考資料」（summary.attachments）。ここから選んで添付できる
 */
// 回答を作っている依頼: 回答がまだ無く、依頼から 6 分以内（サーバーの上限は 5 分）
const PENDING_MS = 6 * 60 * 1000;
const createdMs = (m) => new Date(m.created_at || m.created_date || 0).getTime();
const repliedIds = (messages) => new Set(messages.filter((m) => m.role === "assistant" && m.reply_to).map((m) => m.reply_to));
function pendingIds(messages, now) {
  const replied = repliedIds(messages);
  return messages.filter((m) => m.role === "user" && !replied.has(m.id) && now - createdMs(m) < PENDING_MS).map((m) => m.id);
}
function expiredIds(messages, now) {
  const replied = repliedIds(messages);
  return messages.filter((m) => m.role === "user" && !replied.has(m.id) && now - createdMs(m) >= PENDING_MS && now - createdMs(m) < 24 * 3600 * 1000).map((m) => m.id);
}

function Thinking() {
  return (
    <div className="mt-2 flex gap-2 items-center text-xs text-teal-800" data-testid="chat-thinking">
      <span className="w-6 h-6 shrink-0 rounded-full bg-teal-700 text-white flex items-center justify-center"><Loader2 className="w-3 h-3 animate-spin" /></span>
      AI が議事録と資料を読んで回答を作っています…（資料が多いと 1〜2 分かかります。この画面を離れても・ブラウザを閉じても続き、届くと自動で表示されます）
    </div>
  );
}

export default function MeetingChat({ meeting, references = EMPTY }) {
  const meetingId = meeting.id;
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]); // [{ path, name, type, size, uploaded }]
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(null); // 送信中の依頼（画面に先に出す）
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const { data: messages = EMPTY, isLoading } = useQuery({
    queryKey: ["meetingChat", meetingId],
    queryFn: () => db.entities.MeetingChatMessage.filter({ meeting_id: meetingId }, "created_at"),
    // 回答を作っている依頼があるあいだは 3 秒ごとに読み直す（回答はサーバーの裏で作るので、画面を離れても続く）
    refetchInterval: (q) => (pendingIds(q.state.data || EMPTY, Date.now()).length > 0 ? 3000 : false),
    staleTime: 0,
  });
  // 回答待ちの依頼が時間切れになったかを見直すため、待っているあいだは 15 秒ごとに描き直す
  const [now, setNow] = useState(() => Date.now());
  const pending = new Set(pendingIds(messages, now));
  const expired = new Set(expiredIds(messages, now));
  const waiting = pending.size > 0;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [waiting]);
  useEffect(() => { setNow(Date.now()); }, [messages]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["meetingChat", meetingId] });
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages.length, sending]);

  const addFiles = async (list) => {
    const picked = Array.from(list || []).filter(Boolean);
    if (picked.length === 0) return;
    if (files.length + picked.length > CHAT_MAX_FILES) { toast.error(`添付は ${CHAT_MAX_FILES} 件までです`); return; }
    setUploading((n) => n + picked.length);
    for (const f of picked) {
      try {
        if (f.size > 20 * 1024 * 1024) throw new Error("20MB を超えています");
        const ext = (f.name.match(/\.[a-zA-Z0-9]+$/) || [f.type === "image/png" ? ".png" : ".bin"])[0].toLowerCase();
        const path = `meetings/${meetingId}/chat/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
        await db.integrations.Core.UploadFile({ file: f, path });
        const name = f.name && f.name !== "image.png" ? f.name : `スクリーンショット${ext}`;
        setFiles((cur) => [...cur, { path, name, type: f.type || "", size: f.size, uploaded: true }]);
      } catch (e) {
        toast.error(`${f.name || "ファイル"} を添付できませんでした: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const toggleRef = (a) => setFiles((cur) => (cur.some((x) => x.path === a.path) ? cur.filter((x) => x.path !== a.path) : cur.length >= CHAT_MAX_FILES ? (toast.error(`添付は ${CHAT_MAX_FILES} 件までです`), cur) : [...cur, { path: a.path, name: a.caption ? `${a.caption}（${a.name}）` : a.name, type: a.type, size: a.size }]));
  const removeFile = (f) => { setFiles((cur) => cur.filter((x) => x.path !== f.path)); if (f.uploaded) db.storage.remove([f.path]).catch(() => {}); };

  const send = async () => {
    const body = text.trim();
    if (!body && files.length === 0) return;
    const req = { content: body, attachments: files.map(({ path, name, type, size }) => ({ path, name, type, size })) };
    setSending(req);
    setText("");
    setFiles([]);
    try {
      // 依頼を保存したらすぐ戻る（回答はサーバーが作り続け、届いたら一覧に出る）
      await db.functions.invoke("meetingChat", { action: "send", meeting_id: meetingId, message: body, attachments: req.attachments });
      await refresh();
    } catch (e) {
      toast.error("回答を作れませんでした: " + e.message);
      setText(body);
      setFiles(files);
    } finally {
      setSending(null);
    }
  };

  const copy = async (s) => { try { await navigator.clipboard.writeText(s); toast.success("回答をコピーしました"); } catch { toast.error("コピーできませんでした"); } };

  return (
    <Card className="border-teal-200" data-testid="meeting-chat">
      <CardContent className="pt-4 space-y-3">
        <div>
          <p className="text-sm font-bold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-teal-700" /> AI に依頼</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">この議事録・文字起こし・添付資料に加えて、{meeting.client_name && meeting.client_name !== "CV自社" ? `${meeting.client_name} の` : "このクライアントの"}社内見積と過去の見積、価格マスタ・デザイン費マスタを読んで答えます。やり取りは全員が見られます</p>
        </div>

        {/* やり取り */}
        <div ref={listRef} className="max-h-[640px] overflow-y-auto space-y-3 pr-1" data-testid="meeting-chat-list">
          {isLoading && <p className="text-xs text-muted-foreground text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline" /></p>}
          {!isLoading && messages.length === 0 && !sending && (
            <p className="text-xs text-muted-foreground text-center py-5 rounded-md bg-muted/20">まだ依頼はありません。下の欄に依頼を書くか、よく使う依頼のボタンを押してください</p>
          )}
          {messages.map((m) => (m.role === "user" ? (
            <div key={m.id} className="flex gap-2" data-testid="chat-user">
              <span className="w-7 h-7 shrink-0 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center" aria-hidden>{initial(m.author_name)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">{m.author_name || "（不明）"}</span>　{when(m.created_at || m.created_date)}</p>
                <div className="mt-0.5 rounded-md bg-muted/40 px-3 py-2 text-[13px] whitespace-pre-wrap">{m.content}</div>
                {(m.attachments || []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.attachments.map((a) => <FileChip key={a.path} a={a} />)}</div>}
                {pending.has(m.id) && <Thinking />}
                {expired.has(m.id) && <p className="mt-1.5 text-[11px] text-amber-800">回答が届きませんでした（時間切れ）。お手数ですが、もう一度依頼してください</p>}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2" data-testid="chat-assistant">
              <span className="w-7 h-7 shrink-0 rounded-full bg-teal-700 text-white flex items-center justify-center" aria-hidden><Sparkles className="w-3.5 h-3.5" /></span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                  <span><span className="font-semibold text-teal-800">AI（Claude）</span>　{m.author_name ? `${m.author_name} の依頼への回答` : ""}　{when(m.created_at || m.created_date)}</span>
                  <button type="button" onClick={() => copy(m.content)} className="ml-auto inline-flex items-center gap-0.5 hover:text-foreground"><Copy className="w-3 h-3" /> コピー</button>
                </p>
                <div className={`rounded-md border px-3 py-2 ${m.draft?.error ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-white"}`}><RichText text={m.content} /></div>
                {m.draft?.items?.length > 0 && <DraftCard msg={m} meetingId={meetingId} onSheet={refresh} />}
              </div>
            </div>
          )))}
          {sending && (
            <>
              <div className="flex gap-2 opacity-80">
                <span className="w-7 h-7 shrink-0 rounded-full bg-slate-700 text-white text-xs font-bold flex items-center justify-center" aria-hidden>…</span>
                <div className="min-w-0 flex-1">
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-[13px] whitespace-pre-wrap">{sending.content}</div>
                  {sending.attachments.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{sending.attachments.map((a) => <FileChip key={a.path} a={a} />)}</div>}
                </div>
              </div>
              <div className="flex gap-2 items-center text-xs text-teal-800" data-testid="chat-sending">
                <span className="w-7 h-7 shrink-0 rounded-full bg-teal-700 text-white flex items-center justify-center"><Loader2 className="w-3.5 h-3.5 animate-spin" /></span>
                依頼を送っています…
              </div>
            </>
          )}
        </div>

        {/* 入力欄 */}
        <div
          onPaste={(e) => { const fs = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer?.files); }}
          className={`rounded-md border p-2 space-y-2 ${over ? "border-teal-500 bg-teal-50/50" : "border-teal-200"}`}
          data-testid="meeting-chat-composer"
        >
          <div className="flex flex-wrap gap-1">
            {QUICK_PROMPTS.map((q) => (
              <button key={q.label} type="button" onClick={() => setText((cur) => (cur.trim() ? `${cur.trim()}\n${q.text}` : q.text))} className="h-6 px-2 rounded-full border border-teal-200 text-[11px] text-teal-800 hover:bg-teal-50" disabled={!!sending}>{q.label}</button>
            ))}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
            rows={3}
            placeholder={"例）議事録の内容と添付の企画資料をあわせて、見積のベースを作ってください。\nGoogle ドキュメント・スライドの URL を書くと、その資料も読みます"}
            className="text-[13px] resize-y"
            disabled={!!sending}
            aria-label="AI への依頼"
          />
          {files.length > 0 && <div className="flex flex-wrap gap-1">{files.map((f) => <FileChip key={f.path} a={f} onRemove={() => removeFile(f)} />)}</div>}
          {references.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">参考資料から添付:</span>
              {references.map((a) => {
                const on = files.some((x) => x.path === a.path);
                return (
                  <button key={a.path} type="button" onClick={() => toggleRef(a)} className={`h-6 px-2 rounded border inline-flex items-center gap-1 max-w-[200px] ${on ? "border-teal-600 bg-teal-50 text-teal-900" : "bg-background hover:bg-muted/40"}`} disabled={!!sending} aria-pressed={on}>
                    <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[9px] ${on ? "bg-teal-700 border-teal-700 text-white" : ""}`}>{on ? "✓" : ""}</span>
                    <span className="truncate">{a.caption || a.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={inputRef} type="file" multiple accept={CHAT_ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => inputRef.current?.click()} disabled={uploading > 0 || !!sending}>
              {uploading > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />} {uploading > 0 ? `添付中…（${uploading}）` : "ファイルを添付"}
            </Button>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">PDF・画像・Word・Excel・PowerPoint・テキスト（{CHAT_MAX_FILES} 件・計 20MB まで）。ドラッグ＆ドロップ、Ctrl+V でスクショも可</span>
            <Button type="button" size="sm" className="h-8 ml-auto text-xs gap-1.5 bg-teal-700 hover:bg-teal-800" onClick={send} disabled={!!sending || uploading > 0 || (!text.trim() && files.length === 0)}>
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 依頼する
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-right -mt-1">Ctrl+Enter（⌘+Enter）でも送れます</p>
        </div>
      </CardContent>
    </Card>
  );
}
