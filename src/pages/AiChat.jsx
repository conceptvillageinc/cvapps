import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { db } from "@/api/db";
import { useAuth } from "@/lib/AuthContext";
import { isImeEnter } from "@/lib/ime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import MiniMarkdown from "@/components/aiChat/MiniMarkdown";
import { Bot, Plus, Send, Loader2, Paperclip, X, Users, FileText, Copy, ClipboardPaste, Trash2, PanelRightOpen, PanelRightClose, Database, AlertTriangle, LogOut, Pencil, Check, Globe, ExternalLink, Presentation, Download, NotebookText, ChevronDown, ChevronUp, Palette, Maximize2 } from "lucide-react";

// ============================================================================
// AI チャット（Claude）
//   ・左: 自分のチャットと、招待されたチャットの一覧（新しく話した順）
//   ・中: 会話。質問すると Claude が答える（回答は裏で作られ、届くまで読み直す）
//         CVアプリの情報（案件・見積・書類・クライアント・売上粗利管理表）は、質問した人の権限で Claude が読む
//   ・右: 「下書き」欄。メンバー全員が一緒に直せる（同時に直したときは、あとから保存した人に知らせる）
//   ・メンバー: 作った人（owner）が招待・外す。招待した人はみな「共同編集」（editor：質問も下書きの直しもできる）
//   データは ai_chats / ai_chat_members / ai_chat_messages（SQL 0064。読み書きの決まりはデータベース側）
// ============================================================================

const ROLE_LABEL = { owner: "作成者", editor: "共同編集" };
const MAX_FILES = 5;
const MAX_MB = 20;
// 回答の中の引用番号（[1](URL)）を、コピー・下書き用に「［1］」と、末尾の参照ページの一覧に変える
const plainAnswer = (m) => {
  const sources = (m.used_data || []).filter((u) => u.kind === "source");
  const body = String(m.content || "").replace(/\[(\d+)\]\(https?:\/\/[^)\s]+\)/g, "［$1］");
  return sources.length ? `${body}\n\n参照したページ：\n${sources.map((x, i) => `［${i + 1}］${x.title} ${x.url}`).join("\n")}` : body;
};
const EFFORT_LABEL = { low: "速さ優先", medium: "標準", high: "じっくり" };
const notesOf = (m) => (m?.used_data || []).find((u) => u.kind === "notes")?.text || "";
const designOf = (m) => (m?.used_data || []).find((u) => u.kind === "design" && u.boards?.length) || null;
const NOTE_COLOR = { yellow: "bg-yellow-100 border-yellow-300", orange: "bg-orange-100 border-orange-300", green: "bg-emerald-100 border-emerald-300", blue: "bg-sky-100 border-sky-300", pink: "bg-pink-100 border-pink-300", gray: "bg-slate-100 border-slate-300" };
const deckOf = (m) => (m?.used_data || []).find((u) => u.kind === "deck") || null;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function AiChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const myName = user?.full_name || user?.email || "";

  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => db.entities.User.list("full_name") });
  const { data: chats = [], isLoading: chatsLoading } = useQuery({
    queryKey: ["aiChats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_chats").select("*, ai_chat_members(user_id, role)").order("last_message_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 8000,
  });
  const chat = chats.find((c) => c.id === id) || null;
  const myRole = chat?.ai_chat_members?.find((m) => m.user_id === user?.id)?.role || (chat?.owner_id === user?.id ? "owner" : null);
  const canWrite = myRole === "owner" || myRole === "editor";

  const optimisticRef = useRef([]);
  const { data: messages = [], isSuccess: messagesLoaded } = useQuery({
    queryKey: ["aiChatMessages", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_chat_messages").select("*").eq("chat_id", id).order("created_at");
      if (error) throw error;
      // 送信中の質問（サーバーの返事を待っているもの）は、読み直しても消えないよう後ろに付けておく
      const sending = optimisticRef.current.filter((m) => m.chat_id === id);
      return [...(data || []), ...sending];
    },
    // 回答を待っているあいだは 1.5 秒ごと、ほかのときも 5 秒ごとに読み直す（ほかのメンバーの書き込みも出る）
    refetchInterval: (q) => ((q.state.data || []).some((m) => m.status === "pending") ? 1500 : 5000),
  });

  const createChat = async () => {
    const { data, error } = await supabase.from("ai_chats").insert({ title: "新しいチャット", owner_id: user.id }).select().single();
    if (error) { toast.error("チャットを作れませんでした: " + error.message); return; }
    await qc.invalidateQueries({ queryKey: ["aiChats"] });
    navigate(`/ai-chat/${data.id}`);
  };

  // 下書きは、PC の幅では右に並べて出す（開け閉めを覚える）。スマホでは押したときだけ全画面で出す
  const wide = () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches;
  const [draftOpen, setDraftOpen] = useState(() => { if (!wide()) return false; try { return localStorage.getItem("cvapps:aiChatDraftOpen") !== "0"; } catch { return true; } });
  const toggleDraft = () => setDraftOpen((v) => { if (wide()) { try { localStorage.setItem("cvapps:aiChatDraftOpen", v ? "0" : "1"); } catch { /* 覚えられなくても動く */ } } return !v; });
  const [membersOpen, setMembersOpen] = useState(false);
  const draftRef = useRef(null);
  // 右の欄は「下書き」と「スライド」（作った資料のプレビュー）を切り替える
  const [side, setSide] = useState("draft");
  const [deckId, setDeckId] = useState(null);
  const decks = useMemo(() => messages.filter((m) => m.role === "assistant" && m.status === "done" && deckOf(m)).map((m) => ({ messageId: m.id, at: m.updated_at || m.created_at, ...deckOf(m) })), [messages]);
  const openDeck = (mid) => { setDeckId(mid); setSide("slides"); if (!draftOpen) toggleDraft(); };
  // デザイン（作りかけも含む。作っている途中のボードも見られる）
  const [designId, setDesignId] = useState(null);
  const designs = useMemo(() => messages.filter((m) => m.role === "assistant" && designOf(m)).map((m) => ({ messageId: m.id, at: m.updated_at || m.created_at, pending: m.status === "pending", ...designOf(m) })), [messages]);
  const openDesign = (mid) => { setDesignId(mid); setSide("design"); if (!draftOpen) toggleDraft(); };
  const lastDesignRef = useRef({ chat: null, id: null });
  useEffect(() => {
    if (!messagesLoaded) return;
    const last = designs.filter((d) => !d.pending).pop()?.messageId || null;
    const prev = lastDesignRef.current;
    if (prev.chat === id && last && last !== prev.id) openDesign(last);
    lastDesignRef.current = { chat: id, id: last };
  }, [designs, id, messagesLoaded]);
  // デザイン作成が時間切れで止まったら、質問した本人の画面から続きを頼む（同じ印には 1 回だけ）
  const continuedRef = useRef(new Set());
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant" || m.status !== "pending" || m.author_id !== user?.id) continue;
      const mark = (m.used_data || []).find((u) => u.kind === "continue");
      if (!mark || continuedRef.current.has(mark.token)) continue;
      continuedRef.current.add(mark.token);
      db.functions.invoke("aiChat", { action: "continue", message_id: m.id }).catch(() => continuedRef.current.delete(mark.token));
    }
  }, [messages, user?.id]);
  // 新しい資料ができたら、右の欄にプレビューを開く（チャットを開いたときにすでにある資料では開かない）
  const lastDeckRef = useRef({ chat: null, id: null });
  useEffect(() => {
    if (!messagesLoaded) return;
    const last = decks[decks.length - 1]?.messageId || null;
    const prev = lastDeckRef.current;
    if (prev.chat === id && last && last !== prev.id) openDeck(last);
    lastDeckRef.current = { chat: id, id: last };
  }, [decks, id, messagesLoaded]);
  useEffect(() => { setSide("draft"); setDeckId(null); setDesignId(null); }, [id]);
  const panelTabs = decks.length > 0 || designs.length > 0 ? (
    <div className="flex rounded-md border bg-background p-0.5 text-xs" data-testid="ai-side-tabs">
      {[["draft", "下書き"], ...(decks.length ? [["slides", `スライド（${decks.length}）`]] : []), ...(designs.length ? [["design", `デザイン（${designs.length}）`]] : [])].map(([k, label]) => (
        <button key={k} type="button" onClick={() => setSide(k)} className={`rounded px-2 py-0.5 ${side === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
      ))}
    </div>
  ) : null;
  const showSlides = draftOpen && side === "slides" && decks.length > 0;
  const showDesign = draftOpen && side === "design" && designs.length > 0;

  return (
    <div className="-m-4 lg:-m-6 flex h-[calc(100dvh-3.5rem)] lg:h-[100dvh] min-h-0 bg-background" data-testid="ai-chat">
      {/* チャットの一覧 */}
      {/* スライドのプレビューを開いているあいだは、広い画面（1536px 以上）でだけ一覧を出す（会話の幅を確保する） */}
      <aside className={`${id ? (showSlides || showDesign ? "hidden 2xl:flex" : "hidden md:flex") : "flex"} w-full md:w-64 shrink-0 flex-col border-r bg-muted/30`}>
        <div className="flex items-center gap-2 border-b px-3 py-3">
          <Bot className="h-5 w-5 text-primary" />
          <span className="whitespace-nowrap text-sm font-bold">AIチャット</span>
          <Button size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={createChat} data-testid="ai-chat-new"><Plus className="h-3.5 w-3.5" />新しいチャット</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-0.5">
          {chatsLoading && <p className="px-2 py-3 text-xs text-muted-foreground">読み込み中…</p>}
          {!chatsLoading && chats.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">まだチャットがありません。「新しいチャット」から始めてください</p>}
          {chats.map((c) => {
            const members = c.ai_chat_members || [];
            const mineOwner = c.owner_id === user?.id;
            return (
              <button key={c.id} type="button" onClick={() => navigate(`/ai-chat/${c.id}`)}
                className={`w-full rounded-md px-2.5 py-2 text-left hover:bg-muted ${c.id === id ? "bg-background shadow-sm" : ""}`} data-testid="ai-chat-item">
                <span className="block truncate text-[13px] font-medium">{c.title}</span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {fmt(c.last_message_at)}
                  {members.length > 1 && <span className="inline-flex items-center gap-0.5"><Users className="h-3 w-3" />{members.length}人</span>}
                  {!mineOwner && <span className="rounded bg-sky-100 px-1 text-sky-800">共有</span>}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* 会話 */}
      {!id ? (
        <div className="hidden md:flex flex-1 items-center justify-center text-sm text-muted-foreground">左の一覧からチャットを選ぶか、「新しいチャット」を押してください</div>
      ) : !chat ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{chatsLoading ? "読み込み中…" : "このチャットは見つかりません（メンバーではないか、削除されました）"}</div>
      ) : (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <ChatHeader chat={chat} myRole={myRole} canWrite={canWrite} users={users} onMembers={() => setMembersOpen(true)} draftOpen={draftOpen} onToggleDraft={toggleDraft} hasDecks={decks.length > 0 || designs.length > 0}
              onDeleted={() => { qc.invalidateQueries({ queryKey: ["aiChats"] }); navigate("/ai-chat"); }} />
            <MessageList messages={messages} canWrite={canWrite} meId={user?.id} onOpenDeck={openDeck} onOpenDesign={openDesign}
              onToDraft={(text) => { if (!draftOpen) toggleDraft(); setTimeout(() => draftRef.current?.insert(text), 50); }} />
            <Composer chatId={chat.id} canWrite={canWrite} me={{ id: user?.id, name: myName }} optimisticRef={optimisticRef}
              onSent={() => { qc.invalidateQueries({ queryKey: ["aiChatMessages", chat.id] }); qc.invalidateQueries({ queryKey: ["aiChats"] }); }} />
          </section>
          {/* 下書きは、スライドを見ているあいだも書きかけが消えないよう、隠すだけにする */}
          {draftOpen && <DraftPanel ref={draftRef} chat={chat} canWrite={canWrite} myName={myName} onClose={toggleDraft} tabs={panelTabs} hidden={showSlides || showDesign} />}
          {showSlides && <SlidesPanel decks={decks} deckId={deckId} onPick={setDeckId} tabs={panelTabs} onClose={toggleDraft} />}
          {showDesign && <DesignPanel designs={designs} designId={designId} onPick={setDesignId} tabs={panelTabs} onClose={toggleDraft} />}
          <MembersDialog open={membersOpen} onOpenChange={setMembersOpen} chat={chat} myRole={myRole} users={users} meId={user?.id}
            onLeft={() => { qc.invalidateQueries({ queryKey: ["aiChats"] }); navigate("/ai-chat"); }} />
        </>
      )}
    </div>
  );
}

function ChatHeader({ chat, myRole, canWrite, users, onMembers, draftOpen, onToggleDraft, onDeleted, hasDecks = false }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title);
  useEffect(() => { if (!editing) setTitle(chat.title); }, [chat.title, editing]);
  const members = chat.ai_chat_members || [];
  const nameOf = (uid) => { const u = users.find((x) => x.id === uid); return u ? (u.full_name || u.email) : "（不明）"; };
  const saveTitle = async () => {
    setEditing(false);
    const t = title.trim();
    if (!t || t === chat.title) { setTitle(chat.title); return; }
    const { error } = await supabase.from("ai_chats").update({ title: t }).eq("id", chat.id);
    if (error) toast.error("名前を変えられませんでした: " + error.message);
    qc.invalidateQueries({ queryKey: ["aiChats"] });
  };
  const remove = async () => {
    if (!window.confirm(`チャット「${chat.title}」を削除しますか？メンバー全員の画面から消えます（元に戻せません）`)) return;
    const { error } = await supabase.from("ai_chats").delete().eq("id", chat.id);
    if (error) { toast.error("削除できませんでした: " + error.message); return; }
    onDeleted();
  };
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <button type="button" className="md:hidden text-xs text-primary" onClick={() => navigate("/ai-chat")}>← 一覧</button>
      {editing ? (
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter" && !isImeEnter(e)) e.currentTarget.blur(); if (e.key === "Escape") { setTitle(chat.title); setEditing(false); } }}
          className="h-8 min-w-0 flex-1 rounded-md border px-2 text-sm font-semibold" />
      ) : (
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={chat.title}>
          {chat.title}
          {canWrite && <button type="button" onClick={() => setEditing(true)} className="ml-1.5 align-middle text-muted-foreground hover:text-primary" aria-label="名前を変える"><Pencil className="inline h-3.5 w-3.5" /></button>}
        </h1>
      )}
      <button type="button" onClick={onMembers} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted" data-testid="ai-chat-members-open" title={members.map((m) => `${nameOf(m.user_id)}（${ROLE_LABEL[m.role]}）`).join("\n")}>
        <span className="flex -space-x-1.5">
          {members.slice(0, 4).map((m) => <span key={m.user_id} className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-primary/15 text-[9px] font-bold text-primary">{nameOf(m.user_id).slice(0, 1)}</span>)}
        </span>
        <Users className="h-3.5 w-3.5" /><span className="hidden sm:inline">メンバー</span>（{members.length}）
      </button>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onToggleDraft} data-testid="ai-chat-draft-toggle">
        {draftOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}{hasDecks ? "下書き・スライド" : "下書き"}
      </Button>
      {myRole === "owner" && <button type="button" onClick={remove} className="text-muted-foreground hover:text-destructive" title="チャットを削除" aria-label="チャットを削除"><Trash2 className="h-4 w-4" /></button>}
    </div>
  );
}

function MessageList({ messages, canWrite, meId, onToDraft, onOpenDeck, onOpenDesign }) {
  const endRef = useRef(null);
  const [openNotes, setOpenNotes] = useState(() => new Set()); // 資料メモを開いている回答
  const toggleNotes = (mid) => setOpenNotes((cur) => { const n = new Set(cur); n.has(mid) ? n.delete(mid) : n.add(mid); return n; });
  const lastKey = `${messages.length}:${messages[messages.length - 1]?.status}:${messages[messages.length - 1]?.content?.length}`;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastKey]);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast.success("コピーしました"); } catch { toast.error("コピーできませんでした"); } };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6" data-testid="ai-chat-messages">
      {messages.length === 0 && (
        <div className="mx-auto max-w-xl space-y-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">何でも聞いてください</p>
          <p>例：「〇〇さん（クライアント名）の最近の案件と請求の状況をまとめて」「この PDF を読んで提案書の構成を作って」</p>
        </div>
      )}
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((m) => (m.role === "user" ? (
          <div key={m.id} className={`flex ${m.author_id === meId ? "justify-end" : "justify-start"}`} data-testid="ai-msg-user">
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${m.author_id === meId ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              <p className={`text-[10px] ${m.author_id === meId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{m.author_name}・{fmt(m.created_at)}</p>
              <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              {(m.used_data || []).some((u) => u.kind === "web_on") && (
                <span className={`mt-1 mr-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${m.author_id === meId ? "bg-white/20" : "bg-background border"}`}><Globe className="h-3 w-3" />Web 検索あり</span>
              )}
              {(m.used_data || []).some((u) => u.kind === "slides_on") && (
                <span className={`mt-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${m.author_id === meId ? "bg-white/20" : "bg-background border"}`}><Presentation className="h-3 w-3" />スライド作成</span>
              )}
              {(m.used_data || []).some((u) => u.kind === "design_on") && (
                <span className={`mt-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${m.author_id === meId ? "bg-white/20" : "bg-background border"}`}><Palette className="h-3 w-3" />デザイン作成</span>
              )}
              {(m.attachments || []).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">{m.attachments.map((f) => <AttachmentChip key={f.path} f={f} light={m.author_id === meId} />)}</div>
              )}
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-2.5" data-testid="ai-msg-assistant">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700"><Bot className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-[10px] text-muted-foreground">Claude・{fmt(m.updated_at || m.created_at)}{EFFORT_LABEL[m.usage?.effort] && <span data-testid="ai-msg-effort">・{EFFORT_LABEL[m.usage.effort]}</span>}</p>
              {m.status === "pending" ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{m.content || "考えています…"}</p>
              ) : m.status === "error" ? (
                <p className="flex items-start gap-1.5 whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{m.content}</p>
              ) : (
                <MiniMarkdown text={m.content} />
              )}
              {designOf(m) && (
                <button type="button" onClick={() => onOpenDesign(m.id)} className="flex w-full max-w-md items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5 text-left hover:bg-muted" data-testid="ai-msg-design">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pink-100 text-pink-700"><Palette className="h-4.5 w-4.5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{designOf(m).title}</span>
                    <span className="block text-[11px] text-muted-foreground">デザイン・{designOf(m).boards.length} 枚{m.status === "pending" ? "（作成中）" : ""}・押すと右に表示</span>
                  </span>
                </button>
              )}
              {deckOf(m) && (
                <button type="button" onClick={() => onOpenDeck(m.id)} className="flex w-full max-w-md items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2.5 text-left hover:bg-muted" data-testid="ai-msg-deck">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700"><Presentation className="h-4.5 w-4.5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{deckOf(m).title}</span>
                    <span className="block text-[11px] text-muted-foreground">PowerPoint{deckOf(m).pages?.length ? `・${deckOf(m).pages.length} ページ` : ""}・押すと右にプレビュー</span>
                  </span>
                </button>
              )}
              {(() => {
                const sources = (m.used_data || []).filter((u) => u.kind === "source");
                return sources.length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-2" data-testid="ai-msg-sources">
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><Globe className="h-3.5 w-3.5" />参照したページ</p>
                    <ol className="grid gap-1 sm:grid-cols-2">
                      {sources.map((x, k) => (
                        <li key={x.url}>
                          <a href={x.url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 rounded-md bg-background px-2 py-1.5 text-xs hover:bg-muted">
                            <span className="mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-bold text-primary">{k + 1}</span>
                            <span className="min-w-0">
                              <span className="line-clamp-2 font-medium text-foreground">{x.title}</span>
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">{hostOf(x.url)}<ExternalLink className="h-2.5 w-2.5" /></span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })()}
              {(m.used_data || []).some((u) => !u.kind) && (
                <p className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground"><Database className="h-3 w-3" />確認した情報：{m.used_data.filter((u) => !u.kind).map((u, k) => <span key={k} className="rounded bg-muted px-1.5 py-0.5">{u.label}</span>)}</p>
              )}
              {m.status === "done" && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <button type="button" onClick={() => copy(plainAnswer(m))} className="inline-flex items-center gap-1 hover:text-foreground"><Copy className="h-3 w-3" />コピー</button>
                  {canWrite && <button type="button" onClick={() => onToDraft(plainAnswer(m))} className="inline-flex items-center gap-1 hover:text-foreground" data-testid="ai-msg-to-draft"><ClipboardPaste className="h-3 w-3" />下書きに入れる</button>}
                  {notesOf(m) && (
                    <button type="button" onClick={() => toggleNotes(m.id)} className={`inline-flex items-center gap-1 hover:text-foreground ${openNotes.has(m.id) ? "text-amber-700" : ""}`} data-testid="ai-msg-notes-toggle" aria-expanded={openNotes.has(m.id)}>
                      <NotebookText className="h-3 w-3" />資料メモを見る{openNotes.has(m.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              )}
              {notesOf(m) && openNotes.has(m.id) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3" data-testid="ai-msg-notes">
                  <div className="mb-1.5 flex items-start gap-2">
                    <p className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-amber-900"><NotebookText className="h-3.5 w-3.5" />資料メモ</p>
                    <p className="text-[10px] text-amber-800/80">Claude が読んだ資料の要点です。このチャットの次の回答から、これをもとに答えます</p>
                    <button type="button" onClick={() => copy(notesOf(m))} className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-amber-900/70 hover:text-amber-900"><Copy className="h-3 w-3" />コピー</button>
                  </div>
                  <div className="text-[13px]"><MiniMarkdown text={notesOf(m)} /></div>
                </div>
              )}
            </div>
          </div>
        )))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function AttachmentChip({ f, light, onRemove }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let alive = true; if (f.path && !onRemove) db.storage.signedUrl(f.path).then((u) => alive && setUrl(u)).catch(() => {}); return () => { alive = false; }; }, [f.path, onRemove]);
  const cls = `inline-flex max-w-[220px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${light ? "bg-white/20" : "bg-background border"}`;
  const body = <><FileText className="h-3 w-3 shrink-0" /><span className="truncate">{f.name}</span></>;
  return onRemove
    ? <span className={cls}>{body}<button type="button" onClick={onRemove} aria-label={`${f.name} を外す`}><X className="h-3 w-3" /></button></span>
    : <a href={url || "#"} target="_blank" rel="noreferrer" className={`${cls} hover:underline`}>{body}</a>;
}

function Composer({ chatId, canWrite, me, optimisticRef, onSent }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [web, setWeb] = useState(false); // 「Web 検索」（オンのときだけ Web も調べる。料金がかかるので、ふだんはオフ）
  const [slides, setSlides] = useState(false); // 「スライド作成」（オンのときだけ PowerPoint を作る。数分かかる）
  const [design, setDesign] = useState(false); // 「デザイン作成」（オンのときだけ、商品画像・バナーなどのボードを作る。スライド作成とはどちらか 1 つ）
  const [effort, setEffort] = useState("medium"); // 速さ優先（low）／標準（medium）／じっくり（high）。送るたびに選べる
  const inputRef = useRef(null);
  const addFiles = async (list) => {
    const picked = Array.from(list || []).filter(Boolean);
    if (files.length + picked.length > MAX_FILES) { toast.error(`添付は 1 回に ${MAX_FILES} 個までです`); return; }
    for (const f of picked) {
      if (f.size > MAX_MB * 1024 * 1024) { toast.error(`${f.name} は ${MAX_MB}MB を超えています`); continue; }
      setUploading((n) => n + 1);
      try {
        const ext = (f.name.match(/\.[a-zA-Z0-9]+$/) || [".bin"])[0].toLowerCase();
        const path = `ai-chats/${chatId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
        await db.integrations.Core.UploadFile({ file: f, path });
        setFiles((cur) => [...cur, { path, name: f.name, type: f.type || "", size: f.size }]);
      } catch (e) {
        toast.error(`${f.name} を添付できませんでした: ${e.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const send = async () => {
    const t = text.trim();
    if ((!t && !files.length) || sending || uploading) return;
    setSending(true);
    // 押したらすぐ、入力欄を空にして、質問と「考えています…」を出す（サーバーの返事は待たない）
    const sent = files;
    const key = ["aiChatMessages", chatId];
    const at = new Date().toISOString();
    const tmp = `sending-${Date.now()}`;
    const temps = [
      { id: `${tmp}-q`, chat_id: chatId, role: "user", author_id: me.id, author_name: me.name, content: t, attachments: sent, status: "done", used_data: [...(web ? [{ kind: "web_on" }] : []), ...(slides ? [{ kind: "slides_on" }] : []), ...(design ? [{ kind: "design_on" }] : [])], created_at: at },
      { id: `${tmp}-a`, chat_id: chatId, role: "assistant", content: slides ? "スライドを作っています（数分かかります）…" : design ? "デザインを作っています（数分かかります）…" : "", status: "pending", usage: { effort }, created_at: at },
    ];
    const dropTemps = () => {
      optimisticRef.current = optimisticRef.current.filter((m) => !m.id.startsWith(tmp));
      qc.setQueryData(key, (cur) => (cur || []).filter((m) => !String(m.id).startsWith(tmp)));
    };
    setText(""); setFiles([]);
    optimisticRef.current = [...optimisticRef.current, ...temps];
    qc.setQueryData(key, (cur) => [...(cur || []), ...temps]);
    try {
      await db.functions.invoke("aiChat", { action: "send", chat_id: chatId, message: t, attachments: sent, web, slides, design, effort });
      optimisticRef.current = optimisticRef.current.filter((m) => !m.id.startsWith(tmp));
      onSent();
    } catch (e) {
      dropTemps();
      // 送れなかったときは、書いた文と添付を入力欄に戻す
      setText((cur) => (cur.trim() ? cur : t)); setFiles((cur) => (cur.length ? cur : sent));
      toast.error("送れませんでした: " + (e?.message || "不明なエラー"));
    } finally {
      setSending(false);
    }
  };
  if (!canWrite) return <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">このチャットには書き込めません</p>;
  return (
    <div className="border-t px-3 py-3 md:px-6" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer?.files); }}>
      <div className="mx-auto max-w-3xl rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-primary/30">
        {files.length > 0 && <div className="flex flex-wrap gap-1 px-3 pt-2">{files.map((f) => <AttachmentChip key={f.path} f={f} onRemove={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))} />)}</div>}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(8, Math.max(2, text.split("\n").length))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isImeEnter(e)) { e.preventDefault(); send(); } }}
          onPaste={(e) => { const fs = Array.from(e.clipboardData?.items || []).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
          placeholder="質問を入力（Enter で送信・Shift+Enter で改行）。資料はドラッグ＆ドロップ・貼り付けでも添付できます"
          className="block w-full resize-none rounded-xl bg-transparent px-3 py-2.5 text-sm outline-none" data-testid="ai-chat-input" />
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          <input ref={inputRef} type="file" multiple className="hidden" accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt,.txt" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted" disabled={uploading > 0}>
            {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}添付
          </button>
          <button type="button" onClick={() => setWeb((v) => !v)} aria-pressed={web} data-testid="ai-chat-web"
            title={web ? "Web 検索：オン（押すとオフ）" : "Web 検索：オフ（押すとオン。Web も調べて、参照したページを出します）"}
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${web ? "border-sky-300 bg-sky-100 text-sky-800" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
            <Globe className="h-3.5 w-3.5" />Web 検索{web ? "：オン" : ""}
          </button>
          <button type="button" onClick={() => { setSlides((v) => !v); setDesign(false); }} aria-pressed={slides} data-testid="ai-chat-slides-toggle"
            title={slides ? "スライド作成：オン（押すとオフ）" : "スライド作成：オフ（押すとオン。PowerPoint を作って右にプレビューを出します。数分かかります）"}
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${slides ? "border-orange-300 bg-orange-100 text-orange-800" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
            <Presentation className="h-3.5 w-3.5" />スライド作成{slides ? "：オン" : ""}
          </button>
          <button type="button" onClick={() => { setDesign((v) => !v); setSlides(false); }} aria-pressed={design} data-testid="ai-chat-design-toggle"
            title={design ? "デザイン作成：オン（押すとオフ）" : "デザイン作成：オフ（押すとオン。商品画像・バナー・チラシなどのデザインを作って右に表示します。数分かかります）"}
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${design ? "border-pink-300 bg-pink-100 text-pink-800" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
            <Palette className="h-3.5 w-3.5" />デザイン作成{design ? "：オン" : ""}
          </button>
          <select value={effort} onChange={(e) => setEffort(e.target.value)} data-testid="ai-chat-effort" aria-label="考える深さ"
            title="速さ優先：すぐ答える／標準：ふだんはこれ／じっくり：時間と料金は増えるが、よく考えて答える"
            className={`h-7 shrink-0 rounded-md border bg-background px-1.5 text-xs ${effort === "medium" ? "text-muted-foreground" : "border-violet-300 text-violet-800"}`}>
            {Object.entries(EFFORT_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <Button size="sm" className="ml-auto h-8 shrink-0 gap-1" onClick={send} disabled={sending || uploading > 0 || (!text.trim() && !files.length)} data-testid="ai-chat-send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}送信
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 下書き（共同で直す）。入力が落ち着いたら保存（版 draft_version で、ほかの人の保存と重ならないか確かめる）
// ---------------------------------------------------------------------------
const DraftPanel = forwardRef(function DraftPanel({ chat, canWrite, myName, onClose, tabs = null, hidden = false }, ref) {
  const qc = useQueryClient();
  const [text, setText] = useState(chat.draft_text || "");
  const [baseVersion, setBaseVersion] = useState(chat.draft_version || 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null); // ほかの人が先に保存した内容 { text, version, by }
  const timer = useRef(null);
  const textRef = useRef(text);
  textRef.current = text;

  // ほかの人の保存を取り込む（自分が書きかけでないとき）
  useEffect(() => {
    if ((chat.draft_version || 0) > baseVersion) {
      if (!dirty) { setText(chat.draft_text || ""); setBaseVersion(chat.draft_version || 0); }
      else setConflict({ text: chat.draft_text || "", version: chat.draft_version || 0, by: chat.draft_updated_by });
    }
  }, [chat.draft_version]);

  const save = async (value, version) => {
    setSaving(true);
    const { data, error } = await supabase.from("ai_chats")
      .update({ draft_text: value, draft_version: version + 1, draft_updated_by: myName, draft_updated_at: new Date().toISOString() })
      .eq("id", chat.id).eq("draft_version", version).select("draft_version, draft_text, draft_updated_by");
    setSaving(false);
    if (error) { toast.error("下書きを保存できませんでした: " + error.message); return; }
    if (!data?.length) {
      // ほかの人が先に保存した
      const { data: latest } = await supabase.from("ai_chats").select("draft_text, draft_version, draft_updated_by").eq("id", chat.id).maybeSingle();
      if (latest) setConflict({ text: latest.draft_text || "", version: latest.draft_version || 0, by: latest.draft_updated_by });
      return;
    }
    setBaseVersion(data[0].draft_version);
    if (textRef.current === value) setDirty(false);
    qc.invalidateQueries({ queryKey: ["aiChats"] });
  };
  const onChange = (v) => {
    setText(v); setDirty(true);
    clearTimeout(timer.current);
    if (!conflict) timer.current = setTimeout(() => save(v, baseVersion), 1200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useImperativeHandle(ref, () => ({
    insert: (add) => {
      if (!canWrite) return;
      const cur = textRef.current;
      const next = cur.trim() ? (window.confirm("下書きに中身があります。下に付け足しますか？（キャンセルで入れ替え）") ? `${cur.replace(/\s+$/, "")}\n\n${add}` : add) : add;
      onChange(next);
      toast.success("下書きに入れました");
    },
  }));
  const takeTheirs = () => { setText(conflict.text); setBaseVersion(conflict.version); setDirty(false); setConflict(null); };
  const keepMine = () => { const v = conflict.version; setConflict(null); save(textRef.current, v); };

  return (
    <aside className={`${hidden ? "hidden" : "flex"} fixed inset-0 z-40 flex-col bg-background lg:static lg:z-auto lg:w-[38%] lg:max-w-[560px] lg:shrink-0 lg:border-l lg:bg-muted/20`} data-testid="ai-chat-draft">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {tabs || <><FileText className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">下書き</span></>}
        <span className="text-[10px] text-muted-foreground">
          {saving ? "保存中…" : dirty ? "入力中…" : chat.draft_updated_at ? <span className="inline-flex items-center gap-0.5"><Check className="h-3 w-3 text-emerald-600" />{fmt(chat.draft_updated_at)} {chat.draft_updated_by}</span> : "メンバーと一緒に直せます"}
        </span>
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="下書きを閉じる"><X className="h-4 w-4" /></button>
      </div>
      {conflict && (
        <div className="space-y-1.5 border-b bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <p>{conflict.by || "ほかのメンバー"} さんが下書きを先に保存しました。</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={takeTheirs}>最新の下書きを読み込む</Button>
            <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={keepMine}>自分の内容で上書きする</Button>
          </div>
        </div>
      )}
      <textarea value={text} onChange={(e) => onChange(e.target.value)} readOnly={!canWrite}
        placeholder={canWrite ? "提案書やメール文などを、メンバーと一緒に書ける欄です。\n\n・Claude の回答した内容の文末に表示される「下書きに入れる」ボタンを押すと、その回答の文章がここに入ります。\n・ここに直接書き込むこともできます。\n・チャットで「下書きを直して」と頼むと、Claude がここの文章を読んで、直した文章を回答します。" : "（このチャットの下書きは直せません）"}
        className="min-h-0 flex-1 resize-none bg-background px-4 py-3 text-sm leading-relaxed outline-none" data-testid="ai-chat-draft-text" />
    </aside>
  );
});

// ---------------------------------------------------------------------------
// スライド（作った PowerPoint のプレビュー）。ページの画像を縦に並べ、今のページ番号を出す。
//   ダウンロード（.pptx）・Google ドライブに保存（本人の Drive に Google スライドとして）
// ---------------------------------------------------------------------------
function SlidesPanel({ decks, deckId, onPick, tabs, onClose }) {
  const deck = decks.find((d) => d.messageId === deckId) || decks[decks.length - 1];
  const { data: urls, isLoading } = useQuery({
    queryKey: ["aiDeckUrls", deck.messageId, deck.pptx?.path],
    queryFn: async () => {
      const [pages, pptx, pdf] = await Promise.all([
        Promise.all((deck.pages || []).map((p) => db.storage.signedUrl(p, 3600).catch(() => null))),
        deck.pptx?.path ? db.storage.signedUrl(deck.pptx.path, 3600).catch(() => null) : null,
        deck.pdf?.path ? db.storage.signedUrl(deck.pdf.path, 3600).catch(() => null) : null,
      ]);
      return { pages, pptx, pdf };
    },
    staleTime: 50 * 60 * 1000,
  });
  const scrollRef = useRef(null);
  const [page, setPage] = useState(1);
  const total = (deck.pages || []).length;
  useEffect(() => { setPage(1); scrollRef.current?.scrollTo(0, 0); }, [deck.messageId]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const imgs = [...el.querySelectorAll("[data-page]")];
    const top = el.scrollTop + el.clientHeight / 3; // 画面の上 3 分の 1 にあるページを「今のページ」とする
    let cur = 1;
    for (const img of imgs) if (img.offsetTop <= top) cur = Number(img.dataset.page);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) cur = imgs.length || cur; // いちばん下まで来たら最後のページ
    setPage(cur);
  };
  const [saving, setSaving] = useState(false);
  const saveToDrive = async () => {
    const w = window.open("", "_blank"); // 待っているあいだにポップアップが止められないよう、先に開いておく
    setSaving(true);
    try {
      const { data } = await db.functions.invoke("aiChat", { action: "save_to_drive", message_id: deck.messageId });
      if (!data?.url) throw new Error(data?.error || "保存先が分かりませんでした");
      if (w) w.location.href = data.url; else window.open(data.url, "_blank");
      toast.success("Google ドライブに保存しました（Google スライドで開きます）");
    } catch (e) {
      w?.close();
      toast.error("Google ドライブに保存できませんでした: " + (e?.message || "不明なエラー"));
    } finally {
      setSaving(false);
    }
  };
  const downloadHref = urls?.pptx ? `${urls.pptx}${urls.pptx.includes("?") ? "&" : "?"}download=${encodeURIComponent(deck.pptx?.name || "資料.pptx")}` : null;

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-[48%] lg:max-w-[820px] lg:shrink-0 lg:border-l lg:bg-muted/20" data-testid="ai-chat-slides">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {tabs}
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="閉じる"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={deck.title}>{deck.title}<span className="ml-1.5 text-xs font-normal text-muted-foreground">・PPTX</span></p>
          {decks.length > 1 && (
            <select value={deck.messageId} onChange={(e) => onPick(e.target.value)} className="mt-0.5 h-6 rounded border bg-background px-1 text-[11px]" data-testid="ai-deck-version">
              {decks.map((d, i) => <option key={d.messageId} value={d.messageId}>第 {i + 1} 版（{fmt(d.at)}）{i === decks.length - 1 ? "・最新" : ""}</option>)}
            </select>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={saveToDrive} disabled={saving} data-testid="ai-deck-drive" title="自分の Google ドライブに Google スライドとして保存して開きます">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GoogleDriveMark />}Google ドライブに保存
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" asChild disabled={!downloadHref}>
          <a href={downloadHref || undefined} download={deck.pptx?.name || true} data-testid="ai-deck-download"><Download className="h-3.5 w-3.5" />ダウンロード</a>
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {total > 0 && <span className="pointer-events-none absolute right-4 top-3 z-10 rounded-md bg-slate-700/80 px-2.5 py-1 text-xs text-white" data-testid="ai-deck-page">{page} / {total} ページ</span>}
        <div ref={scrollRef} onScroll={onScroll} className="h-full space-y-3 overflow-y-auto p-3">
          {isLoading && <p className="flex items-center gap-1.5 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />プレビューを読み込んでいます…</p>}
          {!isLoading && total > 0 && urls?.pages.map((u, i) => (
            <img key={i} data-page={i + 1} src={u || undefined} alt={`${i + 1} ページ`} className="w-full rounded-md border bg-white shadow-sm" loading="lazy" />
          ))}
          {!isLoading && total === 0 && urls?.pdf && <iframe title="プレビュー" src={urls.pdf} className="h-full min-h-[70vh] w-full rounded-md border bg-white" />}
          {!isLoading && total === 0 && !urls?.pdf && <p className="p-4 text-sm text-muted-foreground">プレビューを作れませんでした。「ダウンロード」で PowerPoint を開いてください。</p>}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// デザイン（ボードを並べたキャンバス）。ボードは scripts を動かさない iframe で表示する。
//   ボードを押すと大きく表示。PNG で書き出し（1 枚・全部を ZIP）はサーバーのブラウザで作る
// ---------------------------------------------------------------------------
/** ボードの HTML を、表示用の 1 枚のページにする（asset:ID を画像の URL に置き換える） */
function boardSrcDoc(board, assetUrls) {
  const html = String(board.html || "").replace(/asset:([A-Za-z0-9_-]+)/g, (m, aid) => assetUrls[aid] || m);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}body{width:${board.width}px;height:${board.height}px;overflow:hidden;font-family:'Noto Sans JP',sans-serif}</style></head><body>${html}</body></html>`;
}

/** ボード 1 枚を、横幅 width に縮めて表示する */
function BoardView({ board, assetUrls, width }) {
  const scale = width / board.width;
  return (
    <div className="relative overflow-hidden bg-white" style={{ width, height: Math.round(board.height * scale) }}>
      <iframe title={board.title} sandbox="" srcDoc={boardSrcDoc(board, assetUrls)} scrolling="no" tabIndex={-1}
        style={{ width: board.width, height: board.height, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }} />
    </div>
  );
}

function DesignPanel({ designs, designId, onPick, tabs, onClose }) {
  const design = designs.find((d) => d.messageId === designId) || designs.filter((d) => !d.pending).pop() || designs[designs.length - 1];
  const { data: assetUrls = {} } = useQuery({
    queryKey: ["aiDesignAssets", design.messageId, (design.assets || []).map((a) => a.path).join(",")],
    queryFn: async () => Object.fromEntries(await Promise.all((design.assets || []).map(async (a) => [a.id, await db.storage.signedUrl(a.path, 3600).catch(() => "")]))),
    staleTime: 50 * 60 * 1000,
  });
  const boxRef = useRef(null);
  const [boxW, setBoxW] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const cols = boxW >= 640 ? 2 : 1;
  const cardW = Math.floor((boxW - 24 - (cols - 1) * 16) / cols);
  const [zoom, setZoom] = useState(null); // 大きく表示しているボード
  const [busy, setBusy] = useState(null);
  // 書き出し: png（画像）／pdf（ベクター。Illustrator で文字・図形を直せる）。boardId が無ければ全部を ZIP
  const exportFile = async (format, boardId = null) => {
    setBusy(`${format}:${boardId || "all"}`);
    try {
      const { data } = await db.functions.invoke("aiChat", { action: "render_design", message_id: design.messageId, format, ...(boardId ? { board_id: boardId } : {}) });
      if (!data?.url) throw new Error(data?.error || "書き出せませんでした");
      const a = document.createElement("a");
      a.href = data.url; a.download = data.name || ""; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      toast.error(`${format.toUpperCase()} を書き出せませんでした: ` + (e?.message || "不明なエラー"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-[52%] lg:max-w-[900px] lg:shrink-0 lg:border-l lg:bg-muted/20" data-testid="ai-chat-design">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {tabs}
        <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="閉じる"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={design.title}>{design.title}<span className="ml-1.5 text-xs font-normal text-muted-foreground">・{design.boards.length} 枚{design.pending ? "（作成中）" : ""}</span></p>
          {designs.length > 1 && (
            <select value={design.messageId} onChange={(e) => onPick(e.target.value)} className="mt-0.5 h-6 rounded border bg-background px-1 text-[11px]" data-testid="ai-design-version">
              {designs.map((d, i) => <option key={d.messageId} value={d.messageId}>第 {i + 1} 版（{fmt(d.at)}）{d.pending ? "・作成中" : i === designs.length - 1 ? "・最新" : ""}</option>)}
            </select>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => exportFile("png")} disabled={!!busy || design.pending} data-testid="ai-design-export-all" title="全部のボードを PNG（画像）にして ZIP でダウンロード">
          {busy === "png:all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}PNG（全部・ZIP）
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => exportFile("pdf")} disabled={!!busy || design.pending} data-testid="ai-design-export-pdf" title="全部のボードを PDF（ベクター）にして ZIP でダウンロード。Illustrator で開くと、文字や図形を 1 つずつ直せます">
          {busy === "pdf:all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}PDF・Illustrator 用（全部・ZIP）
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => exportFile("svg")} disabled={!!busy || design.pending} data-testid="ai-design-export-svg" title="全部のボードを SVG にして ZIP でダウンロード。Figma に読み込むと、文字や図形を 1 つずつ直せます">
          {busy === "svg:all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}SVG・Figma 用（全部・ZIP）
        </Button>
      </div>
      <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {(design.notes || []).length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2" data-testid="ai-design-notes">
            {design.notes.map((n, i) => <p key={i} className={`whitespace-pre-wrap rounded-md border p-2.5 text-[12px] leading-relaxed text-slate-800 shadow-sm ${NOTE_COLOR[n.color] || NOTE_COLOR.yellow}`}>{n.text}</p>)}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          {design.boards.map((b) => (
            <figure key={b.id} className="m-0" style={{ width: cardW }} data-testid="ai-design-board">
              <figcaption className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={b.title}>{b.title}</span>
                <span>{b.width}×{b.height}</span>
                {["png", "pdf", "svg"].map((f) => (
                  <button key={f} type="button" onClick={() => exportFile(f, b.id)} disabled={!!busy || design.pending} className="inline-flex items-center gap-0.5 hover:text-foreground" title={`この 1 枚を ${{ pdf: "PDF（ベクター・Illustrator 用）", svg: "SVG（Figma 用）", png: "PNG（画像）" }[f]} でダウンロード`}>
                    {busy === `${f}:${b.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}{f.toUpperCase()}
                  </button>
                ))}
              </figcaption>
              <button type="button" onClick={() => setZoom(b)} className="block rounded-md border shadow-sm hover:ring-2 hover:ring-primary/40" aria-label={`${b.title} を大きく表示`}>
                <BoardView board={b} assetUrls={assetUrls} width={cardW - 2} />
              </button>
            </figure>
          ))}
        </div>
      </div>
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-[min(96vw,1100px)]">
          {zoom && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base"><Maximize2 className="h-4 w-4" />{zoom.title}<span className="text-xs font-normal text-muted-foreground">{zoom.width}×{zoom.height}</span></DialogTitle>
                <DialogDescription className="text-xs">直したいところは、チャットで「{zoom.title} の見出しをもっと大きく」のように頼んでください</DialogDescription>
              </DialogHeader>
              <div className="flex justify-center overflow-auto">
                <BoardView board={zoom} assetUrls={assetUrls} width={Math.min(zoom.width, 1000, Math.round(window.innerHeight * 0.7 * zoom.width / zoom.height))} />
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => exportFile("png", zoom.id)} disabled={!!busy || design.pending}>{busy === `png:${zoom.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}PNG でダウンロード</Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => exportFile("pdf", zoom.id)} disabled={!!busy || design.pending}>{busy === `pdf:${zoom.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}PDF（Illustrator 用）でダウンロード</Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => exportFile("svg", zoom.id)} disabled={!!busy || design.pending}>{busy === `svg:${zoom.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}SVG（Figma 用）でダウンロード</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </aside>
  );
}

/** Google ドライブの印（4 色の三角） */
function GoogleDriveMark() {
  return (
    <svg viewBox="0 0 87.3 78" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

function MembersDialog({ open, onOpenChange, chat, myRole, users, meId, onLeft }) {
  const qc = useQueryClient();
  const [addId, setAddId] = useState("");
  const members = chat.ai_chat_members || [];
  const isOwner = myRole === "owner";
  const nameOf = (uid) => { const u = users.find((x) => x.id === uid); return u ? (u.full_name || u.email) : "（不明）"; };
  const candidates = useMemo(() => users.filter((u) => u.role !== "guest" && !members.some((m) => m.user_id === u.id)), [users, members]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["aiChats"] });
  const add = async () => {
    if (!addId) return;
    const { error } = await supabase.from("ai_chat_members").insert({ chat_id: chat.id, user_id: addId, role: "editor" });
    if (error) { toast.error("招待できませんでした: " + error.message); return; }
    toast.success(`${nameOf(addId)} さんを招待しました`); setAddId(""); refresh();
  };
  const remove = async (uid) => {
    const self = uid === meId;
    if (!window.confirm(self ? "このチャットから抜けますか？" : `${nameOf(uid)} さんをこのチャットから外しますか？`)) return;
    const { error } = await supabase.from("ai_chat_members").delete().eq("chat_id", chat.id).eq("user_id", uid);
    if (error) { toast.error("外せませんでした: " + error.message); return; }
    if (self) { onOpenChange(false); onLeft(); } else refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">メンバー</DialogTitle>
          <DialogDescription className="text-xs">招待した人は「共同編集」のメンバーとして、このチャットで質問したり、下書きを一緒に直したりできます。Claude が読む CVアプリの情報は、質問した人の権限の範囲です</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border" data-testid="ai-chat-members">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{nameOf(m.user_id).slice(0, 1)}</span>
              <span className="min-w-0 flex-1 truncate">{nameOf(m.user_id)}{m.user_id === meId && <span className="ml-1 text-[10px] text-muted-foreground">（あなた）</span>}</span>
              <span className="text-xs text-muted-foreground">{ROLE_LABEL[m.role] || ROLE_LABEL.editor}</span>
              {m.role !== "owner" && (isOwner || m.user_id === meId) && (
                <button type="button" onClick={() => remove(m.user_id)} className="text-muted-foreground hover:text-destructive" title={m.user_id === meId ? "抜ける" : "外す"} aria-label={m.user_id === meId ? "抜ける" : "外す"}>
                  {m.user_id === meId ? <LogOut className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
        {isOwner ? (
          <div className="flex items-center gap-2">
            <select value={addId} onChange={(e) => setAddId(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" data-testid="ai-chat-invite-user">
              <option value="">招待する人を選ぶ</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
            <Button size="sm" className="h-8" onClick={add} disabled={!addId} data-testid="ai-chat-invite">招待</Button>
          </div>
        ) : <p className="text-[11px] text-muted-foreground">招待・メンバーを外すのは、チャットを作った人ができます</p>}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>閉じる</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
