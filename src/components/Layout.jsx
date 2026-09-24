import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  LayoutDashboard, FileText, Plus, History, Settings, Users,
  LogOut, Menu, X, Building2, ChevronDown, UserSquare, Tag, HelpCircle, FolderKanban, Truck, Receipt, Landmark, FileSpreadsheet, BarChart3, CalendarClock, Palette, UserCircle
} from "lucide-react";
import { useState } from "react";
import { db } from "@/api/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { path: "/", label: "ダッシュボード", icon: LayoutDashboard },
  { path: "/projects", label: "案件一覧", icon: FolderKanban },
  { path: "/estimates/new", label: "新規見積作成", icon: Plus },
  { path: "/estimates", label: "見積一覧", icon: FileText },
  { path: "/history", label: "提出見積履歴", icon: History },
  { path: "/delivery-notes", label: "納品書", icon: Truck },
  { path: "/invoices", label: "請求書", icon: Receipt },
  { path: "/payments", label: "入金確認", icon: Landmark },
  { path: "/accounting-export", label: "会計データ出力", icon: FileSpreadsheet },
  { path: "/sales-report", label: "売上粗利管理表", icon: BarChart3 },
  { path: "/cashflow", label: "入出金予定表", icon: CalendarClock },
];

const adminItems = [
  { path: "/clients", label: "クライアント一覧", icon: UserSquare },
  { path: "/vendors", label: "印刷所情報", icon: Building2 },
  { path: "/price-master", label: "価格マスタ", icon: Tag },
  { path: "/design-fee-master", label: "デザイン費マスタ", icon: Palette },
  { path: "/settings", label: "システム設定", icon: Settings },
  { path: "/users", label: "ユーザー管理", icon: Users },
];

const faqItem = { path: "/faq", label: "Q&A", icon: HelpCircle };

export default function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = user?.role === "admin";

  const handleLogout = () => {
    db.auth.logout("/login");
  };

  const NavLink = ({ item, onClick }) => {
    const isActive = location.pathname === item.path ||
      (item.path !== "/" && location.pathname.startsWith(item.path));
    return (
      <Link
        to={item.path}
        onClick={onClick}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
        }`}
      >
        <item.icon className="w-4.5 h-4.5 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar flex flex-col transform transition-transform duration-300 lg:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-sidebar-border">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <FileText className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <div>
              <span className="text-sm font-bold text-sidebar-foreground tracking-tight">CV見積管理</span>
              <span className="block text-[10px] text-sidebar-foreground/50">Concept Village</span>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-sidebar-foreground/50 hover:text-sidebar-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="px-3 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider mb-2">
            メイン
          </p>
          {navItems.map(item => (
            <NavLink key={item.path} item={item} onClick={() => setSidebarOpen(false)} />
          ))}

          {isAdmin && (
            <>
              <div className="my-4 border-t border-sidebar-border" />
              <p className="px-3 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider mb-2">
                管理
              </p>
              {adminItems.map(item => (
                <NavLink key={item.path} item={item} onClick={() => setSidebarOpen(false)} />
              ))}
            </>
          )}

          <div className="my-4 border-t border-sidebar-border" />
          <NavLink item={faqItem} onClick={() => setSidebarOpen(false)} />
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors">
                <div className="w-8 h-8 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-xs font-bold text-sidebar-primary">
                  {user?.full_name?.[0] || "U"}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.full_name || "ユーザー"}</p>
                  <p className="text-[10px] text-sidebar-foreground/50">
                    {isAdmin ? "管理者" : "メンバー"}
                    <span className="ml-1.5 opacity-60" title="いま表示されているビルド">
                      build {__BUILD_ID__}
                    </span>
                  </p>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-sidebar-foreground/40" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link to="/profile" className="cursor-pointer">
                  <UserCircle className="w-4 h-4 mr-2" />
                  自分の設定（名乗り・署名）
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-card border-b border-border flex items-center px-4 lg:px-6 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden mr-3 text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
