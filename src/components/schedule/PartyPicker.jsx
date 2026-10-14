import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PartyChips } from "./ScheduleTimeline";

/**
 * 担当の区分（複数可）と、CV のメンバーを選ぶ（リストの担当の欄・タイムラインの担当の欄）。
 * children を渡すと、それを押すと開く（タイムラインではアイコン）。
 */
/** チェックの行。四角だけでなく、名前を含めた行のどこを押しても切り替わる */
export function CheckRow({ checked, onToggle, disabled = false, title, className = "", children }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!checked} disabled={disabled} title={title} onClick={onToggle}
      className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-blue-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${className}`}>
      <Checkbox checked={!!checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
      {children}
    </button>
  );
}

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
      <PopoverContent className="w-64 p-3 space-y-1.5 text-xs" align={align}>
        <p className="font-semibold">担当（複数選べます）</p>
        {parties.map((p) => (
          <CheckRow key={p.key} checked={keys.includes(p.key)} onToggle={() => toggle(p.key)}>
            <span className="w-3 h-3 shrink-0 rounded-full" style={{ background: p.color }} />{p.label}
          </CheckRow>
        ))}
        {keys.filter((k) => !parties.some((p) => p.key === k)).map((k) => (
          <CheckRow key={k} checked onToggle={() => toggle(k)} className="text-muted-foreground">{k.replace(/^other:/, "")}（以前の値）</CheckRow>
        ))}
        <div className="border-t pt-2 space-y-1.5">
          <p className="font-semibold">CV の担当メンバー</p>
          <div className="max-h-36 overflow-y-auto">
            {users.map((u) => (
              <CheckRow key={u.id} checked={members.includes(u.id)} onToggle={() => toggleMember(u.id)}>{u.full_name || u.email}</CheckRow>
            ))}
          </div>
          <div className="border-t pt-1"><CheckRow checked={!!task.show_members} onToggle={() => onChange({ show_members: !task.show_members })}>クライアント向けにもメンバー名を出す</CheckRow></div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

