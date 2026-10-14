import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PartyChips } from "./ScheduleTimeline";

/**
 * 担当の区分（複数可）と、CV のメンバーを選ぶ（リストの担当の欄・タイムラインの担当の欄）。
 * children を渡すと、それを押すと開く（タイムラインではアイコン）。
 */
export default function PartyPicker({ task, parties, users, memberName, onChange, children, align = "start" }) {
  const keys = task.parties || [];
  const members = task.member_ids || [];
  const toggle = (k) => onChange({ parties: keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k] });
  const toggleMember = (id) => onChange({ member_ids: members.includes(id) ? members.filter((x) => x !== id) : [...members, id] });
  return (
    <Popover>
      <PopoverTrigger asChild>
        {children || <button className="w-full min-h-7 rounded border border-transparent px-1 py-0.5 hover:border-slate-200 text-left hover:bg-muted/40" data-testid="party-picker"><PartyChips task={task} parties={parties} memberName={memberName} alwaysMembers /></button>}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2 text-xs" align={align}>
        <p className="font-semibold">担当（複数選べます）</p>
        {parties.map((p) => (
          <label key={p.key} className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={keys.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
            <span className="w-3 h-3 rounded-full" style={{ background: p.color }} />{p.label}
          </label>
        ))}
        {keys.filter((k) => !parties.some((p) => p.key === k)).map((k) => (
          <label key={k} className="flex items-center gap-2 cursor-pointer text-muted-foreground"><Checkbox checked onCheckedChange={() => toggle(k)} />{k.replace(/^other:/, "")}（以前の値）</label>
        ))}
        <div className="border-t pt-2 space-y-1.5">
          <p className="font-semibold">CV の担当メンバー</p>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 cursor-pointer"><Checkbox checked={members.includes(u.id)} onCheckedChange={() => toggleMember(u.id)} />{u.full_name || u.email}</label>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1 border-t"><Checkbox checked={!!task.show_members} onCheckedChange={(v) => onChange({ show_members: !!v })} />クライアント向けにもメンバー名を出す</label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

