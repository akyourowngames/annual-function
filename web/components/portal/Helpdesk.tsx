"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/types";
import Icon from "@/components/ui/Icon";
import type { HelpAction } from "@/lib/server/helpdesk";
type Message = {
  role: "user" | "assistant";
  text: string;
  source?: string;
};
export default function Helpdesk({
  code,
  onAction,
}: {
  code?: string;
  onAction?: () => Promise<void>;
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
  async function send(text: string) {
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
      }>("/api/agent", {
        method: "POST",
        signal: AbortSignal.timeout(65000),
        body: JSON.stringify({
          message: text,
          code,
          history: messages
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", text: r.reply, source: r.source },
      ]);
      setPending(r.action);
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
                  : "Open your invitation to ask about your guest allowance."}
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
