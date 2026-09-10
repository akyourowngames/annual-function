"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { api, type InvitationData } from "@/lib/types";
export default function GuestManager({
  data,
  refresh,
}: {
  data: InvitationData;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function register(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/guests", {
        method: "POST",
        body: JSON.stringify({
          code: data.invitation.code,
          name: values.get("name"),
          relationship: values.get("relationship"),
        }),
      });
      await refresh();
      form.reset();
      setNotice("Guest registered. Your invitation is up to date.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/guests", {
        method: "DELETE",
        body: JSON.stringify({ code: data.invitation.code, guestId: id }),
      });
      await refresh();
      setNotice("Guest removed. The seat is available again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove guest.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Your guest list</h2>
            <p>Good company makes a great evening.</p>
          </div>
          <span className="badge purple">
            {data.registered} / {data.invitation.guestLimit} seats
          </span>
        </div>
        <div className="progress-track">
          <span
            style={{
              width: `${data.invitation.guestLimit ? (data.registered / data.invitation.guestLimit) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="caption">
          {data.remaining} seats available · {data.checkIns} checked in
        </p>
        {notice && (
          <p role="status" className="notice success">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {data.guests.length ? (
          <ul className="guest-list">
            {data.guests.map((g) => (
              <li key={g.id}>
                <span className="avatar">
                  {g.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{g.name}</strong>
                  <small>{g.relationship || "Guest"}</small>
                </div>
                <span
                  className={`badge ${g.status === "checked_in" ? "success" : ""}`}
                >
                  {g.status === "checked_in" ? "Checked in" : "Registered"}
                </span>
                {g.status !== "checked_in" && (
                  <button
                    disabled={busy || data.invitation.status !== "active"}
                    className="icon-button"
                    aria-label={`Remove ${g.name}`}
                    onClick={() => remove(g.id)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <Icon name="users" size={32} />
            <h3>Who’s joining you?</h3>
            <p>Add your family and friends to reserve their seats.</p>
          </div>
        )}
        <p className="security-note">
          <Icon name="shield" size={14} />
          Guests already checked in cannot be removed.
        </p>
      </section>
      <section className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
        <div className="section-heading">
          <h2>Add a guest</h2>
          <Icon name="plus" />
        </div>
        {data.invitation.status !== "active" ? (
          <p className="notice error">
            This invitation is inactive. Contact the event team through Support.
          </p>
        ) : data.remaining <= 0 ? (
          <div className="empty-state">
            <Icon name="check" size={28} />
            <h3>Your guest list is full</h3>
            <p>
              All {data.invitation.guestLimit} seats are reserved. Request a
              limit review through Support if needed.
            </p>
          </div>
        ) : (
          <form onSubmit={register}>
            <label className="field">
              <span>Full name</span>
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Guest’s full name"
                autoComplete="name"
              />
            </label>
            <label className="field">
              <span>Relationship</span>
              <select name="relationship">
                {[
                  "Parent",
                  "Sibling",
                  "Grandparent",
                  "Guardian",
                  "Relative",
                  "Friend",
                  "Other",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <button className="button primary full" disabled={busy}>
              <Icon name="plus" size={16} />
              {busy ? "Registering…" : "Register guest"}
            </button>
            <p className="security-note">
              Each guest uses one seat on your invitation.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
