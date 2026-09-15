"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";

type RsvpState = { status: string; guests: number | null; note?: string | null } | null | undefined;

export default function Rsvp({
  code,
  guestLimit,
  registered,
  rsvp,
  onDone,
}: {
  code: string;
  guestLimit: number;
  registered: number;
  rsvp?: RsvpState;
  onDone: () => void;
}) {
  const startGuests = rsvp?.guests ?? Math.min(guestLimit, Math.max(registered, 1));
  const [guests, setGuests] = useState(startGuests);
  const [note, setNote] = useState(rsvp?.note ?? "");
  const [editing, setEditing] = useState(rsvp?.status !== "attending" && rsvp?.status !== "declined");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const decided = !editing && (rsvp?.status === "attending" || rsvp?.status === "declined");

  async function submit(status: "attending" | "declined") {
    setBusy(true);
    setError("");
    try {
      await api("/api/rsvp", {
        method: "POST",
        body: JSON.stringify({
          code,
          status,
          guests: status === "attending" ? guests : undefined,
          note: status === "attending" ? note || undefined : undefined,
        }),
      });
      setEditing(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="section-heading">
        <div>
          <h2>Will you join us?</h2>
          <p>Let the school plan seating and refreshments perfectly.</p>
        </div>
        <Icon name="calendar" />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {decided ? (
        <div
          className="rsvp-summary"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className={`badge ${rsvp?.status === "attending" ? "success" : "warning"}`}>
              {rsvp?.status === "attending" ? "Attending" : "Not attending"}
            </span>
            <strong>
              {rsvp?.status === "attending"
                ? `Confirmed — ${rsvp?.guests ?? 0} ${(rsvp?.guests ?? 0) === 1 ? "guest" : "guests"}`
                : "We'll miss you this year."}
            </strong>
          </div>
          <button className="button small" disabled={busy} onClick={() => setEditing(true)}>
            Change response
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <button
              className="button primary full"
              disabled={busy}
              onClick={() => submit("attending")}
            >
              <Icon name="check" size={16} /> Yes, we&rsquo;re coming
            </button>
            <button
              className="button full"
              disabled={busy}
              onClick={() => submit("declined")}
            >
              <Icon name="close" size={16} /> Sorry, we can&rsquo;t
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>How many are coming? (max {guestLimit})</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  className="button small"
                  aria-label="One fewer guest"
                  disabled={busy || guests <= 0}
                  onClick={() => setGuests((g) => Math.max(0, g - 1))}
                >
                  −
                </button>
                <strong style={{ minWidth: 28, textAlign: "center", fontSize: 20 }}>
                  {guests}
                </strong>
                <button
                  type="button"
                  className="button small"
                  aria-label="One more guest"
                  disabled={busy || guests >= guestLimit}
                  onClick={() => setGuests((g) => Math.min(guestLimit, g + 1))}
                >
                  +
                </button>
              </div>
            </label>
            <label className="field">
              <span>Anything we should know? (optional)</span>
              <input
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. wheelchair access, nut allergy"
              />
            </label>
          </div>
          <button
            className="button primary space-top"
            disabled={busy}
            onClick={() => submit("attending")}
          >
            Confirm my headcount ({guests})
          </button>
          <p className="caption space-top">
            You can change this any time before the event. Registered guests:{" "}
            {registered}.
          </p>
        </>
      )}
    </section>
  );
}
