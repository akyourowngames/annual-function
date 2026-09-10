"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
export type NavItem = {
  id: string;
  label: string;
  icon: string;
  badge?: string;
};
export default function AppShell({
  children,
  active,
  onNavigate,
  items,
  admin = false,
  name,
  onLogout,
}: {
  children: React.ReactNode;
  active: string;
  onNavigate: (id: string) => void;
  items: NavItem[];
  admin?: boolean;
  name?: string;
  onLogout?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="min-h-dvh bg-[#050505] text-zinc-100">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {open && (
        <button
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.06] bg-[#080808] transition-[width,transform] duration-200 ${collapsed ? "lg:w-[76px]" : "lg:w-[224px]"} w-[250px] ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex h-[80px] shrink-0 items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="Annual home"
          >
            <span className="relative grid h-6 w-6 rotate-45 place-items-center rounded-[5px] border border-white/65">
              <span className="h-2 w-2 rounded-[1px] bg-white" />
            </span>
            <span
              className={`text-[17px] font-bold tracking-[-.8px] ${collapsed ? "lg:hidden" : ""}`}
            >
              ANNUAL
              <span className="ml-1.5 font-normal text-zinc-600">/26</span>
            </span>
          </Link>
          <button
            className="icon-button lg:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div
          className={`mx-4 mb-7 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 ${collapsed ? "lg:mx-3 lg:px-1" : ""}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-zinc-400">
              <Icon name="calendar" size={16} />
            </div>
            <div className={collapsed ? "lg:hidden" : ""}>
              <p className="text-[11px] font-medium text-zinc-200">
                Annual Function
              </p>
              <p className="mt-0.5 text-[9px] text-zinc-500">
                {admin ? "Event management" : "Your personal event space"}
              </p>
            </div>
          </div>
        </div>
        <p
          className={`mb-3 px-6 text-[9px] font-medium tracking-[.12em] text-zinc-500 ${collapsed ? "lg:invisible" : ""}`}
        >
          {admin ? "WORKSPACE" : "YOUR EVENT"}
        </p>
        <nav className="space-y-1 px-3" aria-label="Main navigation">
          {items.map((item) => (
            <button
              key={item.id}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => {
                onNavigate(item.id);
                setOpen(false);
              }}
              className={`relative flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 text-left text-[12px] transition-colors ${active === item.id ? "bg-white/[0.07] text-white" : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-200"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
            >
              <Icon name={item.icon} size={17} />
              <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
              {item.badge && (
                <span
                  className={`ml-auto rounded border border-blue-400/15 bg-blue-400/[0.06] px-1.5 py-0.5 text-[8px] text-blue-300 ${collapsed ? "lg:hidden" : ""}`}
                >
                  {item.badge}
                </span>
              )}
              {active === item.id && (
                <span className="absolute -left-3 h-4 w-[2px] rounded-r bg-white" />
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-10">
          <div
            className={`mx-4 mb-5 rounded-xl border border-white/[0.06] bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.05),transparent)] p-4 ${collapsed ? "lg:hidden" : ""}`}
          >
            <div className="mb-3 flex items-center gap-2 text-zinc-300">
              <Icon name="sparkle" size={15} />
              <strong className="text-[11px] font-medium">
                A little help goes a long way.
              </strong>
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {admin
                ? "Help families get ready for the evening."
                : "Questions about your evening? Start here."}
            </p>
            <button
              className="mt-4 flex w-full items-center justify-between text-[10px] text-zinc-300 transition hover:text-white"
              onClick={() => {
                onNavigate(admin ? "tickets" : "helpdesk");
                setOpen(false);
              }}
            >
              {admin ? "Open support requests" : "Ask the helpdesk"}
              <Icon name="arrow" size={13} />
            </button>
          </div>
          <Link
            href={admin ? "/portal" : "/admin"}
            className={`mx-3 mb-3 flex items-center gap-3 rounded-lg px-3 py-2 text-[11px] text-zinc-500 transition hover:bg-white/[0.03] hover:text-zinc-200 ${collapsed ? "lg:justify-center" : ""}`}
            title={admin ? "Student portal" : "Staff workspace"}
          >
            <Icon name={admin ? "ticket" : "shield"} size={16} />
            <span className={collapsed ? "lg:hidden" : ""}>
              {admin ? "Student portal" : "Staff workspace"}
            </span>
          </Link>
          <div className="flex min-h-[76px] items-center gap-2.5 border-t border-white/[0.06] px-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-[10px] font-semibold text-zinc-400">
              {name ? name.slice(0, 2).toUpperCase() : admin ? "ST" : "AF"}
            </span>
            <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
              <p className="truncate text-[10px] font-medium text-zinc-300">
                {name || (admin ? "Event team" : "Student & parent")}
              </p>
              <p className="text-[9px] text-zinc-600">
                {admin
                  ? "Staff workspace"
                  : name
                    ? "Invitation connected"
                    : "Welcome to your evening"}
              </p>
            </div>
            {onLogout && (
              <button
                className={`icon-button ${collapsed ? "lg:hidden" : ""}`}
                onClick={onLogout}
                aria-label="Sign out"
              >
                <Icon name="logout" size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div
        className={`workspace-frame min-h-dvh transition-[margin] duration-200 ${collapsed ? "lg:ml-[76px]" : "lg:ml-[224px]"}`}
      >
        <header className="no-print sticky top-0 z-30 flex h-[72px] items-center justify-between gap-4 border-b border-white/[0.06] bg-[#080808]/85 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-5">
            <button
              className="icon-button hidden lg:flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Icon name="menu" size={17} />
            </button>
            <button
              className="icon-button lg:hidden"
              aria-label="Open navigation"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Icon name="menu" size={18} />
            </button>
            <span className="hidden text-[10px] text-zinc-600 sm:inline">
              {admin ? "Staff workspace" : "Student portal"}
            </span>
            <span className="hidden h-3 w-px bg-white/10 sm:block" />
            <strong className="text-[11px] font-medium text-zinc-300">
              {items.find((i) => i.id === active)?.label}
            </strong>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 text-[9px] text-zinc-500 sm:flex">
              <span
                className={`h-1 w-1 rounded-full ${name ? "bg-emerald-400" : "bg-zinc-500"}`}
              />
              {name ? "Invitation connected" : "Annual Function 2026"}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-[9px] text-zinc-400">
              {admin ? "ST" : "26"}
            </span>
          </div>
        </header>
        <main
          id="main-content"
          className="main-content mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-9"
        >
          {children}
        </main>
        <footer className="no-print mx-5 flex items-center justify-between gap-4 border-t border-white/[0.05] py-5 text-[9px] text-zinc-600 sm:mx-8 lg:mx-10">
          <span>One school. A thousand memories.</span>
          <span>Annual Function / 2026</span>
        </footer>
      </div>
    </div>
  );
}
