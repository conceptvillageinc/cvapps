import { db } from "@/api/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Plus, Loader2, Shield, User, MailPlus, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { Checkbox } from "@/components/ui/checkbox";

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviteExternal, setInviteExternal] = useState(false); // 社外のアドレスとして特別に招待する（管理者のみ）
  const isCompanyEmail = /@concept-village\.co\.jp$/i.test(inviteEmail.trim());
  const [inviting, setInviting] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => db.entities.User.list("full_name"),
  });

  // 招待済みだが、まだ一度もログインしていない人
  const { data: invitations = [] } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => db.entities.Invitation.filter({ accepted_at: null }, "-created_at"),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }) => db.entities.User.update(id, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("権限を変更しました");
    },
  });

  const updateHoursMutation = useMutation({
    mutationFn: ({ id, daily_hours }) => db.entities.User.update(id, { daily_hours }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); toast.success("1 日の稼働時間を変えました"); },
    onError: (e) => toast.error("変えられませんでした: " + (e?.message || "")),
  });

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const result = await db.users.inviteUser(inviteEmail, inviteRole, { external: inviteExternal && !isCompanyEmail });
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      if (result?.mail?.sent) {
        toast.success(`${inviteEmail} に招待メールを送信しました`);
      } else {
        // 招待の登録自体は成功している。メールだけ届いていない状態を隠さない。
        toast.warning(
          `${inviteEmail} を招待しましたが、メールを送信できませんでした（${result?.mail?.reason || "理由不明"}）。本人にアプリのURLをお知らせください`,
          { duration: 10000 },
        );
      }
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("user");
      setInviteExternal(false);
    } catch (err) {
      toast.error("招待に失敗しました: " + err.message);
    } finally {
      setInviting(false);
    }
  };

  const cancelInvitation = async (invitation) => {
    try {
      await db.entities.Invitation.delete(invitation.id);
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success(`${invitation.email} の招待を取り消しました`);
    } catch (err) {
      toast.error("取り消しに失敗しました: " + err.message);
    }
  };

  const copyAppUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      toast.success("アプリのURLをコピーしました");
    } catch {
      toast.error("コピーできませんでした");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6" /> ユーザー管理
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">メンバーの追加・権限管理</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> メンバー招待
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">名前</TableHead>
                  <TableHead className="text-xs">メール</TableHead>
                  <TableHead className="text-xs">権限</TableHead>
                  <TableHead className="text-xs" title="ワークロードで、この時間を超えた日を薄い赤にします">1 日の稼働時間</TableHead>
                  <TableHead className="text-xs w-32">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1 text-[10px]">
                        {u.role === "admin" ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {u.role === "admin" ? "管理者" : u.role === "guest" ? "ゲスト（タスクだけ）" : "メンバー"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isAdmin || u.id === currentUser?.id ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <input type="number" min="0" max="24" step="0.5" defaultValue={u.daily_hours ?? 8} key={`dh-${u.id}-${u.daily_hours}`} data-testid="daily-hours"
                            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 24 && v !== Number(u.daily_hours ?? 8)) updateHoursMutation.mutate({ id: u.id, daily_hours: v }); }}
                            className="h-7 w-16 rounded border px-1.5 text-right" />時間
                        </span>
                      ) : <span className="text-xs text-muted-foreground">{u.daily_hours ?? 8} 時間</span>}
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select
                          value={u.role || "user"}
                          onValueChange={role => updateRoleMutation.mutate({ id: u.id, role })}
                        >
                          <SelectTrigger className="h-7 text-xs w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">管理者</SelectItem>
                            <SelectItem value="user">メンバー</SelectItem>
                            <SelectItem value="guest">ゲスト</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 招待中（まだログインしていない人） */}
      {invitations.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <MailPlus className="w-4 h-4" /> 招待中（未ログイン）
              </p>
              <Button variant="ghost" size="sm" onClick={copyAppUrl} className="gap-1.5 text-xs h-7">
                <Copy className="w-3.5 h-3.5" /> アプリのURLをコピー
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              招待メールに記載したURLを開き、会社のGoogleアカウントでログインした時点で
              利用開始になります。メールが届かない場合は、下のボタンでURLをコピーして
              直接お知らせください。
            </p>
            <div className="space-y-1.5">
              {invitations.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-sm">
                  <span className="font-medium">{inv.email}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {inv.role === "admin" ? "管理者" : inv.role === "guest" ? "ゲスト" : "メンバー"}
                  </Badge>
                  {inv.external && <Badge className="text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-100">社外（特別招待）</Badge>}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 text-xs gap-1 text-destructive hover:text-destructive"
                      onClick={() => cancelInvitation(inv)}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 取り消す
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>メンバー招待</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">メールアドレス</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="example@concept-village.co.jp"
              />
              <p className="text-[11px] text-muted-foreground">
                ふだんは @concept-village.co.jp のアドレスを招待します
              </p>
            </div>
            {isAdmin && (
              <label className={`flex items-start gap-2 rounded-md border p-2.5 text-xs cursor-pointer ${inviteExternal ? "border-amber-300 bg-amber-50" : ""}`} data-testid="invite-external">
                <Checkbox checked={inviteExternal} onCheckedChange={(v) => setInviteExternal(!!v)} className="mt-0.5" />
                <span>
                  <span className="font-medium">社外のアドレスとして特別に招待する（管理者のみ）</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    Gmail など会社以外のアドレスでも、このアドレスだけログインできるようにします。招待された方は、ログイン画面の「社外の方はこちら」から、そのアドレスの Google アカウントでログインします。
                    社内の情報（見積・案件・クライアントなど）をすべて見られるようになるので、招待する相手に間違いがないか確かめてください
                  </span>
                </span>
              </label>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">権限</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">管理者</SelectItem>
                  <SelectItem value="user">メンバー</SelectItem>
                  <SelectItem value="guest">ゲスト（社外の方。担当のタスクと、その案件だけ見られます）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isCompanyEmail && inviteEmail.includes("@") && !inviteExternal && (
              <p className="text-[11px] text-amber-700">会社以外のアドレスです。招待するには上の「社外のアドレスとして特別に招待する」を選んでください</p>
            )}
            <Button className="w-full gap-1.5" onClick={handleInvite} disabled={!inviteEmail || inviting || (!isCompanyEmail && !inviteExternal)} data-testid="invite-submit">
              {inviting && <Loader2 className="w-4 h-4 animate-spin" />}
              招待する
            </Button>
            <p className="text-[11px] text-muted-foreground">
              会社のメールアドレスから招待メールが届きます。
              返信先は招待したご本人（あなた）になります。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
