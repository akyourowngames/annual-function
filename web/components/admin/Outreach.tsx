"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";
import { toTelegramHtml } from "@/lib/server/markdown";

type Ann = {
  id: string;
  title: string | null;
  body: string;
  audience: string;
  status: string;
  sendAt: string | null;
  sentAt: string | null;
  sent: number;
  failed: number;
};
type Counts = { reachable: number; matched: number; unreachable: number };

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Preview WhatsApp's *bold* rendering safely (input is escaped first).
function whatsappPreview(input: string) {
  return escapeHtml(input.replace(/\*\*([^*\n]+?)\*\*/g, "*$1*"))
    .replace(/\*([^*\n]+?)\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br/>");
}

function audienceOptions(classes: string[]) {
  return [
    { value: "all", label: "Everyone" },
    { value: "rsvp:none", label: "Families who haven't replied" },
    { value: "attending", label: "Families attending" },
    ...classes.map((c) => ({ value: `class:${c}`, label: `Class ${c}` })),
  ];
}

export default function Outreach({ classes }: { classes: string[] }) {
  const [tab, setTab] = useState<"invites" | "announce">("invites");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // --- invitations ---
  const [audience, setAudience] = useState("all");
  const [resend, setResend] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [reachTick, setReachTick] = useState(0);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0 });

  // --- announcements ---
  const [anns, setAnns] = useState<Ann[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [annAudience, setAnnAudience] = useState("all");
  const [sendAt, setSendAt] = useState("");
  const [preview, setPreview] = useState<"telegram" | "whatsapp">("telegram");
  const [busy, setBusy] = useState(false);

  const loadCounts = useCallback(async (a: string) => {
    try {
      setCounts(await api<Counts>(`/api/admin/deliver?audience=${encodeURIComponent(a)}`));
    } catch (e) {
      setCounts(null);
      setError(e instanceof Error ? e.message : "Could not check reach.");
    }
  }, []);
  const loadAnns = useCallback(async () => {
    try {
      const r = await api<{ announcements: Ann[] }>("/api/announcements");
      setAnns(r.announcements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load announcements.");
    }
  }, []);
  useEffect(() => {
    if (tab !== "invites") return;
    let alive = true;
    api<Counts>(`/api/admin/deliver?audience=${encodeURIComponent(audience)}`)
      .then((r) => {
        if (alive) setCounts(r);
      })
      .catch((e) => {
        if (!alive) return;
        setCounts(null);
        setError(e instanceof Error ? e.message : "Could not check reach.");
      });
    return () => {
      alive = false;
    };
  }, [tab, audience, reachTick]);
  // Keep the reachability count live while the tab is open.
  useEffect(() => {
    if (tab !== "invites") return;
    const t = setInterval(() => setReachTick((v) => v + 1), 15000);
    return () => clearInterval(t);
  }, [tab]);
  useEffect(() => {
    if (tab !== "announce") return;
    let alive = true;
    api<{ announcements: Ann[] }>("/api/announcements")
      .then((r) => {
        if (alive) setAnns(r.announcements);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load announcements.");
      });
    return () => {
      alive = false;
    };
  }, [tab]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  async function sendInvites() {
    setSending(true);
    setError("");
    setNotice("");
    setProgress({ sent: 0, failed: 0 });
    let sent = 0;
    let failed = 0;
    try {
      for (let i = 0; i < 60; i++) {
        const r = await api<{
          result: { sent: number; failed: number; remaining: number; unreachable: number };
        }>("/api/admin/deliver", {
          method: "POST",
          body: JSON.stringify({ audience, resend }),
        });
        sent += r.result.sent;
        failed += r.result.failed;
        setProgress({ sent, failed });
        if (r.result.remaining <= 0) break;
      }
      setNotice(`Invitations delivered. Sent ${sent}, failed ${failed}.`);
      await loadCounts(audience);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send invitations.");
    } finally {
      setSending(false);
    }
  }

  async function saveAnnounce(action: "draft" | "send" | "schedule") {
    if (!body.trim()) {
      setError("Write a message first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api<{ announcement: Ann; result?: { remaining: number } }>(
        "/api/announcements",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            body,
            audience: annAudience,
            action,
            sendAt: action === "schedule" ? sendAt : undefined,
          }),
        },
      );
      // Drain the rest of a "send now" in batches.
      if (action === "send" && created.result && created.result.remaining > 0) {
        for (let i = 0; i < 60; i++) {
          const r = await api<{ result: { remaining: number } }>("/api/announcements", {
            method: "PATCH",
            body: JSON.stringify({ id: created.announcement.id, action: "send-batch" }),
          });
          if (r.result.remaining <= 0) break;
        }
      }
      setTitle("");
      setBody("");
      setSendAt("");
      setNotice(
        action === "draft"
          ? "Saved as a draft."
          : action === "schedule"
            ? "Scheduled. It will go out automatically."
            : "Announcement sent.",
      );
      await loadAnns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the announcement.");
    } finally {
      setBusy(false);
    }
  }

  const classOptions = audienceOptions(classes);
  const quickTime = (h: number, dayOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  };

  return (
    <>
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
      <div className="button-row" style={{ marginBottom: 16 }}>
        <button
          className={`button small ${tab === "invites" ? "primary" : ""}`}
          onClick={() => setTab("invites")}
        >
          <Icon name="ticket" size={15} /> Send invitations
        </button>
        <button
          className={`button small ${tab === "announce" ? "primary" : ""}`}
          onClick={() => setTab("announce")}
        >
          <Icon name="megaphone" size={15} /> Announcements &amp; reminders
        </button>
      </div>

      {tab === "invites" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Send personalized passes</h2>
              <p>
                Deliver each family their PDF invitation and QR straight to chat.
                Families appear here once they message the bot and verify.
              </p>
            </div>
            <Icon name="ticket" />
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Who should receive their pass?</span>
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                {classOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Re-send to families who already received one?</span>
              <select value={resend ? "yes" : "no"} onChange={(e) => setResend(e.target.value === "yes")}>
                <option value="no">No — only those still waiting</option>
                <option value="yes">Yes — send again to everyone</option>
              </select>
            </label>
          </div>
          <div className="stats-grid" style={{ marginTop: 8 }}>
            <section className="stat">
              <div className="stat-top">Reachable now<Icon name="chat" size={16} /></div>
              <strong>{counts?.reachable ?? "—"}</strong>
              <small>Families with a chat connection</small>
            </section>
            <section className="stat">
              <div className="stat-top">In this audience<Icon name="users" size={16} /></div>
              <strong>{counts?.matched ?? "—"}</strong>
              <small>{counts?.unreachable ?? 0} not reachable yet</small>
            </section>
            <section className="stat">
              <div className="stat-top">Delivered this run<Icon name="check" size={16} /></div>
              <strong>{progress.sent}</strong>
              <small>{progress.failed} failed</small>
            </section>
          </div>
          <div className="button-row space-top">
            <button className="button primary" disabled={sending || !counts?.reachable} onClick={sendInvites}>
              {sending ? `Sending… ${progress.sent}` : `Send passes to ${counts?.reachable ?? 0} families`}
            </button>
            <button className="button" disabled={sending} onClick={() => setReachTick((v) => v + 1)}>
              Recheck
            </button>
          </div>
          <p className="caption space-top">
            Only families who have messaged the bot can receive chat messages —
            that&rsquo;s a platform rule, not a limitation of this system. To
            reach the rest, share the bot link on the class groups.
          </p>
        </section>
      )}

      {tab === "announce" && (
        <div className="dashboard-grid">
          <section className="panel" style={{ marginTop: 0 }}>
            <div className="section-heading">
              <div>
                <h2>New announcement</h2>
                <p>Write once — it renders correctly on Telegram and WhatsApp.</p>
              </div>
              <Icon name="megaphone" />
            </div>
            <label className="field">
              <span>Title (optional, internal)</span>
              <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gates open at 5 PM" />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea
                value={body}
                maxLength={2000}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Namaste! Gates open at 5:00 PM. Please carry your QR pass."
              />
              <small className="caption">{body.length}/2000 · use **bold** for emphasis and start list lines with a dash</small>
            </label>
            <label className="field">
              <span>Audience</span>
              <select value={annAudience} onChange={(e) => setAnnAudience(e.target.value)}>
                {classOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>Preview</span>
              <div className="button-row" style={{ marginBottom: 8 }}>
                <button className={`button small ${preview === "telegram" ? "primary" : ""}`} onClick={() => setPreview("telegram")}>
                  Telegram
                </button>
                <button className={`button small ${preview === "whatsapp" ? "primary" : ""}`} onClick={() => setPreview("whatsapp")}>
                  WhatsApp
                </button>
              </div>
              <div
                style={{
                  background: preview === "telegram" ? "#eef6ff" : "#eafaf0",
                  border: "1px solid rgba(0,0,0,.08)",
                  borderRadius: 14,
                  padding: "12px 14px",
                  minHeight: 54,
                  fontSize: 15,
                  lineHeight: 1.5,
                }}
                dangerouslySetInnerHTML={{
                  __html: preview === "telegram" ? toTelegramHtml(body) : whatsappPreview(body),
                }}
              />
            </div>
            <label className="field">
              <span>Schedule</span>
              <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
            </label>
            <div className="button-row" style={{ flexWrap: "wrap" }}>
              <button className="button small" onClick={() => setSendAt(quickTime(20))}>
                Tonight 8 PM
              </button>
              <button className="button small" onClick={() => setSendAt(quickTime(9, 1))}>
                Tomorrow 9 AM
              </button>
              <button className="button small" onClick={() => setSendAt(quickTime(17, 1))}>
                Tomorrow 5 PM
              </button>
            </div>
            <div className="button-row space-top">
              <button className="button primary" disabled={busy} onClick={() => saveAnnounce("send")}>
                <Icon name="megaphone" size={15} /> Send now
              </button>
              <button className="button" disabled={busy || !sendAt} onClick={() => saveAnnounce("schedule")}>
                <Icon name="clock" size={15} /> Schedule
              </button>
              <button className="button" disabled={busy} onClick={() => saveAnnounce("draft")}>
                Save draft
              </button>
            </div>
          </section>

          <section className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
            <div className="section-heading">
              <h2>History</h2>
              <Icon name="clock" />
            </div>
            {anns.length === 0 && <p className="caption">Nothing sent yet.</p>}
            <div className="ticket-list">
              {anns.map((a) => (
                <article className="support-ticket" key={a.id}>
                  <header>
                    <div>
                      <strong>{a.title || a.body.slice(0, 40)}</strong>
                      <p className="caption">
                        {a.audience} · {a.status}
                        {a.sendAt && a.status === "scheduled"
                          ? ` · for ${new Date(a.sendAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`
                          : ""}
                      </p>
                    </div>
                    <span className={`badge ${a.status === "sent" ? "success" : a.status === "scheduled" ? "" : "warning"}`}>
                      {a.status}
                    </span>
                  </header>
                  <p>{a.body.slice(0, 160)}</p>
                  <footer>
                    <span>
                      {a.sent} sent{a.failed ? ` · ${a.failed} failed` : ""}
                    </span>
                    <div className="button-row">
                      {a.status !== "sent" && (
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              for (let i = 0; i < 60; i++) {
                                const r = await api<{ result: { remaining: number } }>("/api/announcements", {
                                  method: "PATCH",
                                  body: JSON.stringify({ id: a.id, action: "send-batch" }),
                                });
                                if (r.result.remaining <= 0) break;
                              }
                              await loadAnns();
                              setNotice("Announcement sent.");
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Could not send.");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Send now
                        </button>
                      )}
                      {(a.status === "draft" || a.status === "scheduled") && (
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api("/api/announcements", {
                                method: "PATCH",
                                body: JSON.stringify({ id: a.id, action: "cancel" }),
                              });
                              await loadAnns();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Could not cancel.");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label="Delete announcement"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await api("/api/announcements", {
                              method: "DELETE",
                              body: JSON.stringify({ id: a.id }),
                            });
                            await loadAnns();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Could not delete.");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
