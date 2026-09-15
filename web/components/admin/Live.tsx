"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";

type Live = {
  attendance: {
    invitations: number;
    checkedInInvitations: number;
    totalEntries: number;
    registeredGuests: number;
    byGate: { gate: string | null; n: number }[];
    byClass: { className: string | null; entries: number }[];
    trend: { bucket: string; n: number }[];
    recent: {
      id: string;
      at: string;
      gate: string | null;
      guestName: string | null;
      code: string;
      studentName: string;
    }[];
  };
  rsvp: {
    invitations: number;
    attending: number;
    declined: number;
    pending: number;
    expectedGuests: number;
    responseRate: number;
    byClass: { className: string; total: number; attending: number; expected: number }[];
  };
};

function Bar({ value, max, tone = "mint" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ background: "rgba(0,0,0,.08)", borderRadius: 999, height: 10, overflow: "hidden" }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 999,
          background: tone === "mint" ? "#3fb27f" : tone === "butter" ? "#e6b422" : "#8b7bd8",
          transition: "width .4s ease",
        }}
      />
    </div>
  );
}

export default function Live() {
  const [data, setData] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<Live>("/api/admin/live")
      .then((r) => {
        if (!alive) return;
        setData(r);
        setUpdatedAt(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load live data.");
      });
    // Drain any due scheduled reminders while the dashboard is open.
    api("/api/cron").catch(() => {});
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setTick((v) => v + 1), 5000);
    return () => clearInterval(t);
  }, [auto]);

  if (!data)
    return <p className="loading-line">{error || "Loading live view…"}</p>;

  const a = data.attendance;
  const r = data.rsvp;
  const expected = r.expectedGuests || a.registeredGuests;
  const arrived = a.totalEntries;
  const remaining = Math.max(0, expected - arrived);
  const maxTrend = Math.max(1, ...a.trend.map((t) => t.n));
  const maxClass = Math.max(1, ...r.byClass.map((c) => c.expected));

  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div
        className="table-tools"
        style={{ alignItems: "center" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: auto ? "#3fb27f" : "#c9c9c9",
              boxShadow: auto ? "0 0 0 4px rgba(63,178,127,.18)" : "none",
            }}
          />
          <strong>{auto ? "Live" : "Paused"}</strong>
          <span className="caption">updated {updatedAt}</span>
        </div>
        <div className="button-row">
          <button className="button small" onClick={() => setAuto((v) => !v)}>
            {auto ? "Pause" : "Resume"}
          </button>
          <button className="button small primary" onClick={() => setTick((v) => v + 1)}>
            <Icon name="pulse" size={15} /> Refresh
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <section className="stat">
          <div className="stat-top">Expected guests<Icon name="users" size={16} /></div>
          <strong>{expected.toLocaleString()}</strong>
          <small>From RSVP headcount</small>
        </section>
        <section className="stat">
          <div className="stat-top">Arrived<Icon name="scan" size={16} /></div>
          <strong>{arrived.toLocaleString()}</strong>
          <small>{a.checkedInInvitations} families in</small>
        </section>
        <section className="stat">
          <div className="stat-top">Still to arrive<Icon name="clock" size={16} /></div>
          <strong>{remaining.toLocaleString()}</strong>
          <small>Against expected headcount</small>
        </section>
        <section className="stat">
          <div className="stat-top">RSVP replies<Icon name="check" size={16} /></div>
          <strong>{r.responseRate}%</strong>
          <small>
            {r.attending} attending · {r.declined} declined · {r.pending} waiting
          </small>
        </section>
      </div>

      <div className="dashboard-grid space-top">
        <section className="panel" style={{ marginTop: 0 }}>
          <div className="section-heading">
            <div>
              <h2>Arrivals</h2>
              <p>{arrived} of {expected} expected guests scanned in</p>
            </div>
            <Icon name="pulse" />
          </div>
          <Bar value={arrived} max={Math.max(1, expected)} />
          <div className="button-row space-top" style={{ flexWrap: "wrap" }}>
            {a.byGate.map((g) => (
              <span key={g.gate ?? "default"} className="badge">
                {(g.gate || "Gate").toString()} · {g.n}
              </span>
            ))}
            {!a.byGate.length && <span className="caption">No scans yet.</span>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90, marginTop: 18 }}>
            {a.trend.map((t) => (
              <div key={t.bucket} style={{ flex: 1, textAlign: "center" }}>
                <div
                  style={{
                    height: `${Math.max(6, (t.n / maxTrend) * 74)}px`,
                    background: "#8b7bd8",
                    borderRadius: "6px 6px 0 0",
                  }}
                  title={`${t.n} entries`}
                />
                <small style={{ fontSize: 10 }}>{t.bucket.slice(0, 2)}</small>
              </div>
            ))}
            {!a.trend.length && <span className="caption">The arrival trend appears here.</span>}
          </div>
        </section>

        <section className="panel" style={{ marginTop: 0 }}>
          <div className="section-heading">
            <div>
              <h2>Recent arrivals</h2>
              <p>The latest guests through the gate</p>
            </div>
            <Icon name="scan" />
          </div>
          {a.recent.length ? (
            <ul className="guest-list">
              {a.recent.map((e) => (
                <li key={e.id}>
                  <span className="avatar">
                    <Icon name="check" size={16} />
                  </span>
                  <div>
                    <strong>{e.guestName || e.studentName}</strong>
                    <small>
                      {e.studentName} · {e.code}
                      {e.gate ? ` · ${e.gate}` : ""}
                    </small>
                  </div>
                  <span className="badge success">
                    {new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <Icon name="scan" size={30} />
              <p>Arrivals will appear here the moment the gates open.</p>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Headcount by class</h2>
            <p>Expected guests vs who has arrived</p>
          </div>
          <Icon name="users" />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Families</th>
                <th>Attending</th>
                <th>Expected guests</th>
                <th style={{ width: "34%" }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {r.byClass.map((c) => (
                <tr key={c.className}>
                  <td>
                    <strong>{c.className}</strong>
                  </td>
                  <td>{c.total}</td>
                  <td>{c.attending}</td>
                  <td>{c.expected}</td>
                  <td>
                    <Bar value={c.expected} max={maxClass} tone="lilac" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!r.byClass.length && (
            <div className="empty-state">
              <p>Class breakdown appears once families RSVP.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
