"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "./Icon";
import { Star, usePlayground } from "@/components/landing/Playground";
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
  const { canvas, burst } = usePlayground();
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const hidden = collapsed ? "lg:hidden" : "";
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <canvas
        ref={canvas}
        className="workspace-confetti no-print"
        aria-hidden="true"
      />
      {open && (
        <button
          className="fixed inset-0 z-40 bg-ink/80 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        className={`workspace-sidebar no-print fixed inset-y-0 left-0 z-50 flex flex-col overflow-y-auto border-r transition-[width,transform] duration-200 ${collapsed ? "lg:w-[76px]" : "lg:w-[236px]"} w-[260px] ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex h-[92px] shrink-0 items-center justify-between px-6">
          <Link href="/" className="workspace-brand" aria-label="Annual home">
            <Star size={29} />
            <span className={hidden}>
              <span className="workspace-wordmark">
                annual<em>.</em>
              </span>
              <small>A sky full of stories</small>
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
          className={`sidebar-event mx-4 mb-6 p-3 ${collapsed ? "lg:mx-3 lg:px-1" : ""}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="sidebar-event-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <Icon name={admin ? "star" : "ticket"} size={17} />
            </div>
            <div className={hidden}>
              <p className="text-[11px] font-medium text-paper">
                {admin ? "Behind the magic" : "Your little corner"}
              </p>
              <p className="mt-0.5 text-[9px] text-muted">
                {admin
                  ? "The event team’s workspace"
                  : "Your invitation & favourite people"}
              </p>
            </div>
          </div>
        </div>
        <p
          className={`sidebar-label mb-3 px-6 ${collapsed ? "lg:invisible" : ""}`}
        >
          {admin ? "Make the evening happen" : "Make yourself at home"}
        </p>
        <nav className="space-y-1.5 px-3" aria-label="Main navigation">
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
              className={`workspace-nav relative flex w-full items-center gap-3 px-3 text-left text-[12px] ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
            >
              <Icon name={item.icon} size={17} />
              <span className={hidden}>{item.label}</span>
              {item.badge && (
                <span
                  className={`nav-badge ml-auto rounded-full px-2 py-0.5 text-[9px] ${hidden}`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-9">
          <div className={`sidebar-postcard mx-4 mb-5 p-4 ${hidden}`}>
            <div className="mb-2.5 flex items-center gap-2 text-paper">
              <Star size={19} />
              <strong className="text-[11px] font-medium">
                A little help. A lot of heart.
              </strong>
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              {admin
                ? "Help every family feel part of the evening."
                : "Big questions or little worries? We’re here."}
            </p>
            <button
              className="mt-4 flex w-full items-center justify-between text-[10px] text-mint"
              onClick={() => {
                onNavigate(admin ? "tickets" : "helpdesk");
                setOpen(false);
              }}
            >
              {admin ? "Open support requests" : "Ask the helpdesk"}
              <Icon name="arrow" size={13} />
            </button>
          </div>
          {(admin
            ? [
                { href: "/portal", icon: "ticket", label: "Student portal" },
                { href: "/gate", icon: "scan", label: "Gate check-in" },
              ]
            : [
                { href: "/gallery", icon: "camera", label: "Photo album" },
                { href: "/admin", icon: "shield", label: "Staff workspace" },
                { href: "/gate", icon: "scan", label: "Gate check-in" },
              ]
          ).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`mx-3 mb-1.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] text-muted transition hover:bg-lilac/5 hover:text-paper ${collapsed ? "lg:justify-center" : ""}`}
              title={link.label}
            >
              <Icon name={link.icon} size={16} />
              <span className={hidden}>{link.label}</span>
            </Link>
          ))}
          <div className="workspace-user flex min-h-[76px] items-center gap-2.5 px-4">
            <span className="workspace-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
              {name ? name.slice(0, 2).toUpperCase() : admin ? "ST" : "AF"}
            </span>
            <div className={`min-w-0 flex-1 ${hidden}`}>
              <p className="truncate text-[10px] font-medium text-paper">
                {name || (admin ? "Event team" : "Student & parent")}
              </p>
              <p className="text-[9px] text-muted">
                {admin
                  ? "Staff workspace"
                  : name
                    ? "Invitation connected"
                    : "Welcome to your evening"}
              </p>
            </div>
            {onLogout && (
              <button
                className={`icon-button ${hidden}`}
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
        className={`workspace-frame min-h-dvh transition-[margin] duration-200 ${collapsed ? "lg:ml-[76px]" : "lg:ml-[236px]"}`}
      >
        <header className="workspace-topbar no-print sticky top-0 z-30 flex h-[76px] items-center justify-between gap-3 border-b px-5 backdrop-blur-xl sm:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
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
              aria-controls="workspace-navigation"
              onClick={() => setOpen(true)}
            >
              <Icon name="menu" size={18} />
            </button>
            <span className="hidden text-[10px] text-muted sm:inline">
              {admin ? "Staff workspace" : "Student portal"}
            </span>
            <Star size={9} className="hidden text-lilac sm:block" />
            <strong className="truncate text-[11px] font-medium text-paper">
              {items.find((i) => i.id === active)?.label}
            </strong>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="workspace-status hidden items-center gap-2 rounded-full px-3 py-1.5 text-[9px] sm:flex">
              <span className="h-1 w-1 rounded-full bg-mint" />
              {admin
                ? "Backstage access"
                : name
                  ? "Invitation connected"
                  : "A little wonder awaits"}
            </span>
            <button
              className="celebrate-button"
              aria-label="A little celebration"
              title="A little celebration"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                burst(r.left + r.width / 2, r.bottom);
              }}
            >
              <Star size={21} />
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className="main-content mx-auto w-full max-w-[1400px] px-5 py-8 sm:px-8 lg:px-10 lg:py-9"
        >
          <div className="workspace-scene" key={active}>
            {children}
          </div>
        </main>
        <footer className="workspace-footer no-print mx-5 flex items-center justify-between gap-4 border-t py-5 text-[9px] sm:mx-8 lg:mx-10">
          <span className="flex items-center gap-2">
            <Star size={12} />
            Little moments. Big memories.
          </span>
          <Link href="/" className="hover:text-lilac">
            Back to the celebration
          </Link>
        </footer>
      </div>
    </div>
  );
}
