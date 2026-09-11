"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/types";
import Icon from "@/components/ui/Icon";
import type { HelpAction } from "@/lib/server/helpdesk";
type Message = {
  role: "user" | "assistant";
  text: string;
  source?: string;
  recoveredCode?: string;
};
export default function Helpdesk({
  code,
  onAction,
  onRecover,
}: {
  code?: string;
  onAction?: () => Promise<void>;
  onRecover?: (code: string) => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([
      {
        role: "assistant",
        text: "Hi! I’m your event helpdesk. Ask me about the venue, timings, dress code, parking, or your invitation. How can I help?",
        source: "Event helpdesk",
      },
    ]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<HelpAction | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [identity, setIdentity] = useState({ admissionNumber: "", name: "", className: "" });
  async function findInvitation(e: React.FormEvent) {
    e.preventDefault();
    await send("Find my invitation", identity);
  }
  async function openRecovered(value: string) {
    setBusy(true);
    setError("");
    try { await onRecover?.(value); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not open your invitation."); }
    finally { setBusy(false); }
  }
  async function confirmAction() {
    if (!pending || !code) return;
    setBusy(true);
    setError("");
    try {
      await api(
        pending.kind === "register_guest" ? "/api/guests" : "/api/tickets",
        { method: "POST", body: JSON.stringify({ code, ...pending }) },
      );
      const completed =
        pending.kind === "register_guest"
          ? `${pending.name} is registered. Your guest list is updated.`
          : "Your support request has been sent. You can track it in Support.";
      setPending(null);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: completed,
          source: "Confirmed by the event system",
        },
      ]);
      await onAction?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);
  async function send(text: string, recovery?: typeof identity) {
    if (!text.trim() || busy) return;
    const history = [...messages, { role: "user" as const, text: text.trim() }];
    setMessages(history);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        reply: string;
        source: string;
        action: HelpAction | null;
        recoveredCode?: string;
        recoveryRequired?: boolean;
      }>("/api/agent", {
        method: "POST",
        signal: AbortSignal.timeout(65000),
        body: JSON.stringify({
          message: text,
          code,
          recovery,
          history: messages
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", text: r.reply, source: r.source, recoveredCode: r.recoveredCode },
      ]);
      setPending(r.action);
      if (r.recoveryRequired) setShowRecovery(true);
      if (r.recoveredCode) {
        setShowRecovery(false);
        setIdentity({ admissionNumber: "", name: "", className: "" });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Helpdesk is unavailable. Please try again.",
      );
      setInput(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dashboard-grid">
      <section className="panel chat-panel">
        <div className="section-heading">
          <h2>
            <Icon name="sparkle" className="inline" /> Event helpdesk
          </h2>
          <span className="badge purple">Here to help</span>
        </div>
        <div
          className="chat-messages"
          role="log"
          aria-live="polite"
          aria-label="Helpdesk conversation"
        >
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              <small>
                {m.role === "user" ? "You" : m.source || "Event helpdesk"}
              </small>
              {m.text}
              {m.recoveredCode && onRecover && (
                <div className="space-top">
                  <button className="button primary small" disabled={busy} onClick={() => openRecovered(m.recoveredCode!)}>
                    Open my invitation <Icon name="arrow" size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <p className="caption" role="status">
              Looking into that…
            </p>
          )}
          <div ref={end} />
        </div>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {pending && (
          <div className="notice">
            <strong>
              {pending.kind === "register_guest"
                ? `Register ${pending.name}?`
                : "Send this support request?"}
            </strong>
            <p className="caption">
              {pending.kind === "register_guest"
                ? pending.relationship
                : pending.description}
            </p>
            <div className="button-row space-top">
              <button
                className="button primary small"
                disabled={busy}
                onClick={confirmAction}
              >
                Confirm{" "}
                {pending.kind === "register_guest" ? "registration" : "request"}
              </button>
              <button
                className="button small"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {!code && (
          <div className="space-top">
            <button className="button small" disabled={busy} aria-expanded={showRecovery} onClick={() => setShowRecovery(!showRecovery)}>
              <Icon name="ticket" size={15} /> {showRecovery ? "Close lookup" : "Find my invitation"}
            </button>
            {showRecovery && (
              <form onSubmit={findInvitation} className="space-top">
                <p className="caption">Enter all three details as recorded by your school. Include any starting zeros in your admission number.</p>
                <div className="form-grid space-top">
                  <label className="field"><span>Admission number</span><input type="text" autoComplete="off" required maxLength={100} value={identity.admissionNumber} onChange={(e) => setIdentity({ ...identity, admissionNumber: e.target.value })} /></label>
                  <label className="field"><span>Full name</span><input autoComplete="off" required maxLength={100} value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} /></label>
                  <label className="field"><span>Class</span><input autoComplete="off" placeholder="e.g. TULIP 1 or 2ND LILY" required maxLength={100} value={identity.className} onChange={(e) => setIdentity({ ...identity, className: e.target.value })} /></label>
                </div>
                <button className="button primary small" disabled={busy}>Verify my details</button>
              </form>
            )}
          </div>
        )}
        <div className="suggestions">
          {[
            "What time does it start?",
            "Where can we park?",
            "How many guests can I bring?",
          ].map((s) => (
            <button key={s} disabled={busy} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="input-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <label className="field">
            <span className="sr-only">Your question</span>
            <input
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about the event…"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !input.trim()}
            aria-label="Send question"
          >
            <Icon name="arrow" />
          </button>
        </form>
      </section>
      <aside className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
        <Icon name="shield" />
        <h2 className="space-top">Answers you can trust</h2>
        <p className="caption" style={{ marginTop: 12, lineHeight: 1.9 }}>
          Answers use information published by your school. Your invitation’s
          guest limit and registration details always come from the event
          system.
        </p>
        <ul className="info-list space-top">
          <li>
            <Icon name="calendar" />
            <div>
              <strong>Plan your evening</strong>
              <p>Timings, venue, parking and dress code.</p>
            </div>
          </li>
          <li>
            <Icon name="ticket" />
            <div>
              <strong>Your invitation</strong>
              <p>
                {code
                  ? "Your invitation is connected to this conversation."
                  : "Use Find my invitation with your admission number, full name, and class to get your code."}
              </p>
            </div>
          </li>
          <li>
            <Icon name="help" />
            <div>
              <strong>Need a person?</strong>
              <p>
                Send a request from Support. The event team can review
                invitation details and special requests.
              </p>
            </div>
          </li>
        </ul>
      </aside>
    </div>
  );
}
