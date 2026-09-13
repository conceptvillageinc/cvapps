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
import { Plus, Pencil, Trash2, Building2, Loader2, Globe, Mail } from "lucide-react";
import { toast } from "sonner";
import { PRINT_TYPES } from "@/lib/constants";

export default function VendorManagement() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: "", vendor_type: "email", print_types: [], email: "",
    phone: "", website_url: "", contact_person: "", notes: "",
  });

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => db.entities.PrintVendor.list("name"),
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editing
      ? db.entities.PrintVendor.update(editing.id, data)
      : db.entities.PrintVendor.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      setDialogOpen(false);
      setEditing(null);
      resetForm();
      toast.success(editing ? "更新しました" : "追加しました");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => db.entities.PrintVendor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("削除しました");
    },
  });

  const resetForm = () => setForm({
    name: "", vendor_type: "email", print_types: [], email: "",
    phone: "", website_url: "", contact_person: "", notes: "",
  });

  const openEdit = (vendor) => {
    setEditing(vendor);
    setForm({ ...vendor });
    setDialogOpen(true);
  };

  const openNew = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const togglePrintType = (type) => {
    const current = form.print_types || [];
    setForm({
      ...form,
      print_types: current.includes(type)
        ? current.filter(t => t !== type)
        : [...current, type],
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6" /> 印刷所情報
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">見積依頼先の印刷会社を管理</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> 新規追加
        </Button>
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
                  <TableHead className="text-xs">会社名</TableHead>
                  <TableHead className="text-xs">種別</TableHead>
                  <TableHead className="text-xs">対応印刷物</TableHead>
                  <TableHead className="text-xs">連絡先</TableHead>
                  <TableHead className="text-xs">担当者</TableHead>
                  <TableHead className="text-xs w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] gap-1">
                        {v.vendor_type === "email" ? <Mail className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                        {v.vendor_type === "email" ? "メール" : "Web"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(v.print_types || []).map(t => (
                          <Badge key={t} variant="secondary" className="text-[9px]">{t}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {v.email || v.phone || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{v.contact_person || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(v)} className="text-muted-foreground hover:text-foreground">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteMutation.mutate(v.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "印刷会社を編集" : "印刷会社を追加"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">会社名 *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">依頼方法</Label>
              <Select value={form.vendor_type} onValueChange={v => setForm({ ...form, vendor_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">メール依頼</SelectItem>
                  <SelectItem value="web">Web（ネット印刷）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">対応印刷物種別</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRINT_TYPES.map(t => (
                  <Badge
                    key={t}
                    variant={(form.print_types || []).includes(t) ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                    onClick={() => togglePrintType(t)}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">メール</Label>
                <Input value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">電話</Label>
                <Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">WebサイトURL</Label>
              <Input value={form.website_url || ""} onChange={e => setForm({ ...form, website_url: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">担当者名</Label>
              <Input value={form.contact_person || ""} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
            </div>
            <Button
              className="w-full"
              onClick={() => saveMutation.mutate(form)}
              disabled={!form.name || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editing ? "更新" : "追加"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
