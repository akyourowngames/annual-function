"use client";
import { useEffect, useState } from "react";
import { api, type TicketInfo, formatDate } from "@/lib/types";
import Icon from "@/components/ui/Icon";
export default function Support({ code }: { code: string }) {
  const [tickets, setTickets] = useState<TicketInfo[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api<{
      tickets: TicketInfo[];
    }>(`/api/tickets?code=${encodeURIComponent(code)}`)
      .then((r) => {
        if (alive) setTickets(r.tickets);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        ticket: TicketInfo;
      }>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          code,
          category: values.get("category"),
          description: values.get("description"),
        }),
      });
      setTickets((t) => [r.ticket, ...t]);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send request.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="section-heading">
          <h2>Your requests</h2>
          <span className="badge">{tickets.length}</span>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="loading-line">Loading your requests…</p>
        ) : tickets.length ? (
          <div className="ticket-list">
            {tickets.map((t) => (
              <article className="support-ticket" key={t.id}>
                <header>
                  <strong>{t.category || "General request"}</strong>
                  <span
                    className={`badge ${t.status === "resolved" ? "success" : "warning"}`}
                  >
                    {t.status.replaceAll("_", " ")}
                  </span>
                </header>
                <p>{t.description}</p>
                <footer>
                  <span>#{t.id.slice(0, 8)}</span>
                  <time>{formatDate(t.createdAt, true)}</time>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Icon name="help" size={32} />
            <h3>All clear here</h3>
            <p>
              Requests you send to the event team will appear here. You can come
              back to check their status.
            </p>
          </div>
        )}
      </section>
      <section className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
        <h2>Let’s sort it out</h2>
        <p className="caption" style={{ margin: "8px 0 22px" }}>
          Tell the event team what you need help with.
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>What’s this about?</span>
            <select name="category">
              {[
                "Invitation details",
                "Guest limit",
                "Guest registration",
                "QR / entry",
                "Accessibility",
                "Other",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Your request</span>
            <textarea
              name="description"
              required
              minLength={5}
              maxLength={2000}
              placeholder="Include any details that will help the team resolve your request."
            />
          </label>
          <button className="button primary full" disabled={busy}>
            <Icon name="mail" size={16} />
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
      </section>
    </div>
  );
}
