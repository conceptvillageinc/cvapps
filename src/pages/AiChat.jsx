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
import { Bot, Plus, Send, Loader2, Paperclip, X, Users, FileText, Copy, ClipboardPaste, Trash2, PanelRightOpen, PanelRightClose, Database, AlertTriangle, LogOut, Pencil, Check, Globe, ExternalLink } from "lucide-react";

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
  const { data: messages = [] } = useQuery({
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

  return (
    <div className="-m-4 lg:-m-6 flex h-[calc(100dvh-3.5rem)] lg:h-[100dvh] min-h-0 bg-background" data-testid="ai-chat">
      {/* チャットの一覧 */}
      <aside className={`${id ? "hidden md:flex" : "flex"} w-full md:w-64 shrink-0 flex-col border-r bg-muted/30`}>
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
            <ChatHeader chat={chat} myRole={myRole} canWrite={canWrite} users={users} onMembers={() => setMembersOpen(true)} draftOpen={draftOpen} onToggleDraft={toggleDraft}
              onDeleted={() => { qc.invalidateQueries({ queryKey: ["aiChats"] }); navigate("/ai-chat"); }} />
            <MessageList messages={messages} canWrite={canWrite} meId={user?.id}
              onToDraft={(text) => { if (!draftOpen) toggleDraft(); setTimeout(() => draftRef.current?.insert(text), 50); }} />
            <Composer chatId={chat.id} canWrite={canWrite} me={{ id: user?.id, name: myName }} optimisticRef={optimisticRef}
              onSent={() => { qc.invalidateQueries({ queryKey: ["aiChatMessages", chat.id] }); qc.invalidateQueries({ queryKey: ["aiChats"] }); }} />
          </section>
          {draftOpen && <DraftPanel ref={draftRef} chat={chat} canWrite={canWrite} myName={myName} onClose={toggleDraft} />}
          <MembersDialog open={membersOpen} onOpenChange={setMembersOpen} chat={chat} myRole={myRole} users={users} meId={user?.id}
            onLeft={() => { qc.invalidateQueries({ queryKey: ["aiChats"] }); navigate("/ai-chat"); }} />
        </>
      )}
    </div>
  );
}

function ChatHeader({ chat, myRole, canWrite, users, onMembers, draftOpen, onToggleDraft, onDeleted }) {
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
        {draftOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}下書き
      </Button>
      {myRole === "owner" && <button type="button" onClick={remove} className="text-muted-foreground hover:text-destructive" title="チャットを削除" aria-label="チャットを削除"><Trash2 className="h-4 w-4" /></button>}
    </div>
  );
}

function MessageList({ messages, canWrite, meId, onToDraft }) {
  const endRef = useRef(null);
  const lastKey = `${messages.length}:${messages[messages.length - 1]?.status}:${messages[messages.length - 1]?.content?.length}`;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastKey]);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast.success("コピーしました"); } catch { toast.error("コピーできませんでした"); } };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6" data-testid="ai-chat-messages">
      {messages.length === 0 && (
        <div className="mx-auto max-w-xl space-y-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">何でも聞いてください</p>
          <p>例：「MOMIJIさんの最近の案件と請求の状況をまとめて」「この PDF を読んで提案書の構成を作って」</p>
        </div>
      )}
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((m) => (m.role === "user" ? (
          <div key={m.id} className={`flex ${m.author_id === meId ? "justify-end" : "justify-start"}`} data-testid="ai-msg-user">
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${m.author_id === meId ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              <p className={`text-[10px] ${m.author_id === meId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{m.author_name}・{fmt(m.created_at)}</p>
              <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              {(m.used_data || []).some((u) => u.kind === "web_on") && (
                <span className={`mt-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${m.author_id === meId ? "bg-white/20" : "bg-background border"}`}><Globe className="h-3 w-3" />Web 検索あり</span>
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
              <p className="text-[10px] text-muted-foreground">Claude・{fmt(m.updated_at || m.created_at)}</p>
              {m.status === "pending" ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{m.content || "考えています…"}</p>
              ) : m.status === "error" ? (
                <p className="flex items-start gap-1.5 whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{m.content}</p>
              ) : (
                <MiniMarkdown text={m.content} />
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
      { id: `${tmp}-q`, chat_id: chatId, role: "user", author_id: me.id, author_name: me.name, content: t, attachments: sent, status: "done", used_data: web ? [{ kind: "web_on" }] : [], created_at: at },
      { id: `${tmp}-a`, chat_id: chatId, role: "assistant", content: "", status: "pending", created_at: at },
    ];
    const dropTemps = () => {
      optimisticRef.current = optimisticRef.current.filter((m) => !m.id.startsWith(tmp));
      qc.setQueryData(key, (cur) => (cur || []).filter((m) => !String(m.id).startsWith(tmp)));
    };
    setText(""); setFiles([]);
    optimisticRef.current = [...optimisticRef.current, ...temps];
    qc.setQueryData(key, (cur) => [...(cur || []), ...temps]);
    try {
      await db.functions.invoke("aiChat", { action: "send", chat_id: chatId, message: t, attachments: sent, web });
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
        <div className="flex items-center gap-2 px-2 pb-2">
          <input ref={inputRef} type="file" multiple className="hidden" accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt,.txt" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted" disabled={uploading > 0}>
            {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}添付
          </button>
          <button type="button" onClick={() => setWeb((v) => !v)} aria-pressed={web} data-testid="ai-chat-web"
            title={web ? "Web 検索：オン（押すとオフ）" : "Web 検索：オフ（押すとオン。Web も調べて、参照したページを出します）"}
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs ${web ? "border-sky-300 bg-sky-100 text-sky-800" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
            <Globe className="h-3.5 w-3.5" />Web 検索{web ? "：オン" : ""}
          </button>
          <span className="hidden min-w-0 truncate lg:inline text-[10px] text-muted-foreground">{web ? "Web も調べて、参照したページを出します" : `PDF・画像・Excel・Word など（1 回 ${MAX_FILES} 個・${MAX_MB}MB まで）`}</span>
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
const DraftPanel = forwardRef(function DraftPanel({ chat, canWrite, myName, onClose }, ref) {
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
    <aside className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-[38%] lg:max-w-[560px] lg:shrink-0 lg:border-l lg:bg-muted/20" data-testid="ai-chat-draft">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">下書き</span>
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
