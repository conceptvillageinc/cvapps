import { NavLink } from "react-router-dom";
import { Tag, Printer } from "lucide-react";

const TABS = [
  { to: "/price-master", label: "価格マスタ", icon: Tag },
  { to: "/print-types", label: "印刷種別マスタ（大カテゴリ）", icon: Printer },
];

/** 価格マスタと印刷種別マスタを 1 つのメニューにまとめ、画面の上のタブで切り替える */
export default function PriceMasterTabs() {
  return (
    <nav className="flex gap-1 border-b" aria-label="価格・印刷種別マスタ" data-testid="price-master-tabs">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => `-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${isActive ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <Icon className="w-4 h-4" /> {label}
        </NavLink>
      ))}
    </nav>
  );
}
