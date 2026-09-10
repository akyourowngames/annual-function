"use client";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/ui/AppShell";
import Icon from "@/components/ui/Icon";
import { Star } from "@/components/landing/Playground";
import StaffLogin from "@/components/admin/StaffLogin";
import Scanner from "@/components/admin/Scanner";
import EventEditor from "@/components/admin/EventEditor";
import { api, formatDate, type TicketInfo } from "@/lib/types";
type Invitation = {
  id: string;
  code: string;
  name: string;
  studentId: string;
  className: string | null;
  guestLimit: number;
  registered: number;
  checkIns: number;
  status: string;
};
type Dashboard = {
  staff: {
    name: string;
    role: string;
  };
  stats: {
    invitations: number;
    guests: number;
    checkIns: number;
    openTickets: number;
  };
  invitations: Invitation[];
  guests: {
    id: string;
    name: string;
    relationship: string | null;
    status: string;
    code: string;
    studentName: string;
  }[];
  tickets: TicketInfo[];
  entries: {
    id: string;
    at: string;
    guestName: string | null;
    code: string;
    studentName: string;
  }[];
};
const NAV = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "invitations", label: "Invitations", icon: "ticket" },
  { id: "guests", label: "Guests", icon: "users" },
  { id: "checkin", label: "Gate check-in", icon: "scan" },
  { id: "tickets", label: "Support requests", icon: "help" },
  { id: "settings", label: "Event & knowledge", icon: "settings" },
];
export default function AdminHome() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [data, setData] = useState<Dashboard | null>(null),
    [view, setView] = useState("overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [create, setCreate] = useState(false),
    [edit, setEdit] = useState<Invitation | null>(null),
    [ticketFilter, setTicketFilter] = useState("all");
  const refresh = useCallback(async () => {
    const r = await api<Dashboard>("/api/admin");
    setData(r);
  }, []);
  useEffect(() => {
    let alive = true;
    api("/api/auth")
      .then(() => {
        if (alive) setAuthenticated(true);
      })
      .catch(() => {
        if (alive) setAuthenticated(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    let alive = true;
    api<Dashboard>("/api/admin")
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [authenticated, refresh]);
  async function action(
    path: string,
    method: string,
    body: unknown,
    message: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api(path, { method, body: JSON.stringify(body) });
      await refresh();
      setNotice(message);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function createInvitation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await action(
      "/api/invitations",
      "POST",
      {
        studentId: f.get("studentId"),
        name: f.get("name"),
        className: f.get("className"),
        guestLimit: Number(f.get("guestLimit")),
      },
      "Student invitation is ready. Share the private code with their family.",
    );
    if (r) setCreate(false);
  }
  function exportCsv() {
    if (!data) return;
    const rows = [
      [
        "Student ID",
        "Name",
        "Class",
        "Invitation",
        "Guest limit",
        "Registered",
        "Checked in",
        "Status",
      ],
      ...data.invitations.map((i) => [
        i.studentId,
        i.name,
        i.className || "",
        i.code,
        i.guestLimit,
        i.registered,
        i.checkIns,
        i.status,
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value);
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "annual-function-invitations.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (authenticated === null)
    return (
      <main className="auth-page">
        <p className="loading-line">Opening staff workspace…</p>
      </main>
    );
  if (!authenticated)
    return <StaffLogin onLogin={() => setAuthenticated(true)} />;
  const isAdmin = data?.staff.role === "admin";
  const filtered =
    data?.invitations.filter((i) =>
      `${i.name} ${i.studentId} ${i.className} ${i.code}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const invitationTable = (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Invitation</th>
            <th>Guests</th>
            <th>Entry</th>
            <th>Status</th>
            {isAdmin && <th>Manage</th>}
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, view === "overview" ? 6 : undefined).map((i) => (
            <tr key={i.id}>
              <td>
                <strong>{i.name}</strong>
                <small>
                  {i.studentId} {i.className ? `/ ${i.className}` : ""}
                </small>
              </td>
              <td>{i.code}</td>
              <td>
                {i.registered} / {i.guestLimit}
              </td>
              <td>{i.checkIns} checked in</td>
              <td>
                <span
                  className={`badge ${i.status === "active" ? "success" : "warning"}`}
                >
                  {i.status}
                </span>
              </td>
              {isAdmin && (
                <td>
                  <button className="button small" onClick={() => setEdit(i)}>
                    Manage
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!filtered.length && (
        <div className="empty-state">
          <Icon name="ticket" size={28} />
          <p>
            {search
              ? "No invitations match your search."
              : "Create the first student invitation to get started."}
          </p>
        </div>
      )}
    </div>
  );
  return (
    <AppShell
      active={view}
      items={NAV.filter((i) => i.id !== "settings" || isAdmin)}
      onNavigate={(id) => {
        setView(id);
        setSearch("");
        setNotice("");
        setError("");
      }}
      admin
      name={data?.staff.name}
      onLogout={async () => {
        try {
          await api("/api/auth", { method: "DELETE" });
          setAuthenticated(false);
          setData(null);
        } catch {
          setError("Could not sign out. Please try again.");
        }
      }}
    >
      <div className="page-heading">
        <div>
          <h1>
            {view === "overview"
              ? "Every detail. One place."
              : view === "invitations"
                ? "Everyone’s on the list."
                : view === "guests"
                  ? "The people joining us."
                  : view === "checkin"
                    ? "A warm welcome starts here."
                    : view === "tickets"
                      ? "A helping hand."
                      : "Set the scene."}
          </h1>
          <p>
            {view === "overview"
              ? "Your event at a glance. Let’s make it a memorable one."
              : NAV.find((n) => n.id === view)?.label}
          </p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setError("");
            void refresh().catch((e) => setError(e.message));
          }}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p className="loading-line">Loading event data…</p>
      ) : (
        <>
          {view === "overview" && (
            <>
              <div className="backstage-banner">
                <div>
                  <Star className="paper-star" size={29} />
                  <div>
                    <strong>You make the magic happen.</strong>
                    <p>
                      A little planning here. A whole lot of happy memories out
                      there.
                    </p>
                  </div>
                </div>
                <span className="backstage-stamp">
                  with a little extra heart.
                </span>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "Invitations",
                    value: data.stats.invitations,
                    icon: "ticket",
                    detail: "Personal passes created",
                  },
                  {
                    label: "Registered guests",
                    value: data.stats.guests,
                    icon: "users",
                    detail: "Seats reserved for the evening",
                  },
                  {
                    label: "Checked in",
                    value: data.stats.checkIns,
                    icon: "scan",
                    detail: "Guests welcomed at the gate",
                  },
                  {
                    label: "Open requests",
                    value: data.stats.openTickets,
                    icon: "help",
                    detail: "Waiting for a helping hand",
                  },
                ].map((s) => (
                  <section className="stat" key={s.label}>
                    <div className="stat-top">
                      {s.label}
                      <Icon name={s.icon} size={18} />
                    </div>
                    <strong>{s.value.toLocaleString()}</strong>
                    <small>{s.detail}</small>
                  </section>
                ))}
              </div>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Recent invitations</h2>
                    <p>A place for every family.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setView("invitations")}
                  >
                    View all
                    <Icon name="arrow" size={15} />
                  </button>
                </div>
                {invitationTable}
              </section>
              <div className="dashboard-grid space-top">
                <section className="panel">
                  <div className="section-heading">
                    <h2>Recent arrivals</h2>
                    <Icon name="scan" />
                  </div>
                  {data.entries.length ? (
                    <ul className="guest-list">
                      {data.entries.slice(0, 5).map((e) => (
                        <li key={e.id}>
                          <span className="avatar">
                            <Icon name="check" size={16} />
                          </span>
                          <div>
                            <strong>{e.guestName || e.studentName}</strong>
                            <small>{e.studentName}</small>
                          </div>
                          <span className="badge success">
                            {new Date(e.at).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-state">
                      <Icon name="scan" size={30} />
                      <p>Arrivals will appear here as guests check in.</p>
                      <button
                        className="button"
                        onClick={() => setView("checkin")}
                      >
                        Open gate check-in
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel" style={{ marginTop: 0 }}>
                  <div className="section-heading">
                    <h2>Needs your attention</h2>
                    <span className="badge warning">
                      {data.stats.openTickets} open
                    </span>
                  </div>
                  {data.tickets
                    .filter((t) => t.status !== "resolved")
                    .slice(0, 3)
                    .map((t) => (
                      <article
                        className="support-ticket"
                        key={t.id}
                        style={{ marginTop: 10 }}
                      >
                        <header>
                          <strong>
                            {t.student?.name || "Support request"}
                          </strong>
                          <span className="badge warning">
                            {t.status.replaceAll("_", " ")}
                          </span>
                        </header>
                        <p>{t.description}</p>
                      </article>
                    ))}
                  {!data.stats.openTickets && (
                    <div className="empty-state">
                      <Icon name="check" size={30} />
                      <p>No open requests. You’re all caught up.</p>
                    </div>
                  )}
                  <button
                    className="text-button space-top"
                    onClick={() => setView("tickets")}
                  >
                    Manage requests
                    <Icon name="arrow" size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "invitations" && (
            <>
              <div className="table-tools">
                <label className="search-box">
                  <Icon name="search" size={18} />
                  <input
                    className="search-input"
                    aria-label="Search invitations"
                    placeholder="Search student, class or invitation…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button className="button" onClick={exportCsv}>
                    <Icon name="download" size={16} />
                    Export CSV
                  </button>
                  {isAdmin && (
                    <button
                      className="button primary"
                      onClick={() => setCreate(!create)}
                    >
                      <Icon name={create ? "close" : "plus"} size={16} />
                      {create ? "Close form" : "Add student"}
                    </button>
                  )}
                </div>
              </div>
              {create && (
                <section className="panel" style={{ marginBottom: 20 }}>
                  <h2>Create a student invitation</h2>
                  <form onSubmit={createInvitation} className="space-top">
                    <div className="form-grid">
                      <label className="field">
                        <span>Student ID</span>
                        <input name="studentId" required maxLength={100} />
                      </label>
                      <label className="field">
                        <span>Full name</span>
                        <input name="name" required maxLength={100} />
                      </label>
                      <label className="field">
                        <span>Class</span>
                        <input
                          name="className"
                          maxLength={100}
                          placeholder="e.g. 10-A"
                        />
                      </label>
                      <label className="field">
                        <span>Guest limit</span>
                        <input
                          name="guestLimit"
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={4}
                          required
                        />
                      </label>
                    </div>
                    <button className="button primary" disabled={busy}>
                      Create invitation
                    </button>
                  </form>
                </section>
              )}
              <section className="panel">{invitationTable}</section>
            </>
          )}
          {edit && (
            <section className="panel space-top">
              <div className="section-heading">
                <h2>Manage {edit.name}’s invitation</h2>
                <button
                  className="icon-button"
                  aria-label="Close invitation editor"
                  onClick={() => setEdit(null)}
                >
                  <Icon name="close" />
                </button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (
                    await action(
                      "/api/admin",
                      "PATCH",
                      {
                        code: edit.code,
                        guestLimit: Number(f.get("guestLimit")),
                        status: f.get("status"),
                      },
                      "Invitation updated.",
                    )
                  )
                    setEdit(null);
                }}
              >
                <div className="form-grid">
                  <label className="field">
                    <span>Guest limit</span>
                    <input
                      type="number"
                      name="guestLimit"
                      defaultValue={edit.guestLimit}
                      min={edit.registered}
                      max={100}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select name="status" defaultValue={edit.status}>
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                </div>
                <button className="button primary" disabled={busy}>
                  Save changes
                </button>
              </form>
              <div className="space-top">
                <p className="caption">
                  Replace a lost or shared pass. Its existing code and QR will
                  stop working.
                </p>
                <button
                  className="button danger small space-top"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await action(
                        "/api/admin",
                        "PATCH",
                        { code: edit.code, regenerate: true },
                        "New invitation generated. Share the new code from the invitation list.",
                      )
                    )
                      setEdit(null);
                  }}
                >
                  Replace invitation code & QR
                </button>
              </div>
            </section>
          )}
          {view === "guests" && (
            <section className="panel">
              <div className="table-tools">
                <h2>{data.guests.length} registered guests</h2>
                <input
                  className="search-input"
                  style={{ maxWidth: 300 }}
                  aria-label="Search guests"
                  placeholder="Search guests or students…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Guest</th>
                      <th>Student</th>
                      <th>Invitation</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.guests
                      .filter((g) =>
                        `${g.name} ${g.studentName}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((g) => (
                        <tr key={g.id}>
                          <td>
                            <strong>{g.name}</strong>
                            <small>{g.relationship}</small>
                          </td>
                          <td>{g.studentName}</td>
                          <td>{g.code}</td>
                          <td>
                            <span
                              className={`badge ${g.status === "checked_in" ? "success" : ""}`}
                            >
                              {g.status.replaceAll("_", " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!data.guests.length && (
                  <div className="empty-state">
                    <p>Guest registrations will appear here.</p>
                  </div>
                )}
              </div>
            </section>
          )}
          {view === "checkin" && <Scanner onCheckIn={refresh} />}
          {view === "tickets" && (
            <section className="panel">
              <div className="table-tools">
                <h2>Support requests</h2>
                <div className="button-row">
                  {["all", "pending", "in_progress", "resolved"].map((s) => (
                    <button
                      key={s}
                      className={`button small ${ticketFilter === s ? "primary" : ""}`}
                      onClick={() => setTicketFilter(s)}
                    >
                      {s.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ticket-list">
                {data.tickets
                  .filter(
                    (t) => ticketFilter === "all" || t.status === ticketFilter,
                  )
                  .map((t) => (
                    <article className="support-ticket" key={t.id}>
                      <header>
                        <div>
                          <strong>{t.category || "General request"}</strong>
                          <p className="caption">
                            {t.student?.name} · #{t.id.slice(0, 8)}
                          </p>
                        </div>
                        <span
                          className={`badge ${t.status === "resolved" ? "success" : "warning"}`}
                        >
                          {t.status.replaceAll("_", " ")}
                        </span>
                      </header>
                      <p>{t.description}</p>
                      <footer>
                        <span>{formatDate(t.createdAt, true)}</span>
                        <div className="button-row">
                          {t.status !== "in_progress" &&
                            t.status !== "resolved" && (
                              <button
                                className="button small"
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    "/api/tickets",
                                    "PATCH",
                                    { id: t.id, status: "in_progress" },
                                    "Request marked in progress.",
                                  )
                                }
                              >
                                Start review
                              </button>
                            )}
                          <button
                            className="button small"
                            disabled={busy}
                            onClick={() =>
                              action(
                                "/api/tickets",
                                "PATCH",
                                {
                                  id: t.id,
                                  status:
                                    t.status === "resolved"
                                      ? "pending"
                                      : "resolved",
                                },
                                "Request status updated.",
                              )
                            }
                          >
                            {t.status === "resolved"
                              ? "Reopen"
                              : "Mark resolved"}
                          </button>
                        </div>
                      </footer>
                    </article>
                  ))}
              </div>
              {!data.tickets.filter(
                (t) => ticketFilter === "all" || t.status === ticketFilter,
              ).length && (
                <div className="empty-state">
                  <Icon name="check" size={30} />
                  <p>No requests in this view.</p>
                </div>
              )}
            </section>
          )}
          {view === "settings" && isAdmin && <EventEditor />}
        </>
      )}
    </AppShell>
  );
}
