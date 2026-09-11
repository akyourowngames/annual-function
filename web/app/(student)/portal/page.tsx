"use client";
import { useCallback, useEffect, useState } from "react";
import Overview from "@/components/portal/Overview";
import AppShell from "@/components/ui/AppShell";
import Icon from "@/components/ui/Icon";
import QrCard from "@/components/invitation/QrCard";
import GuestManager from "@/components/portal/GuestManager";
import Helpdesk from "@/components/portal/Helpdesk";
import Support from "@/components/portal/Support";
import {
  api,
  formatDate,
  type EventInfo,
  type InvitationData,
} from "@/lib/types";
const NAV = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "invitation", label: "My invitation", icon: "ticket" },
  { id: "guests", label: "My guests", icon: "users" },
  { id: "event", label: "Event details", icon: "calendar" },
  { id: "helpdesk", label: "AI helpdesk", icon: "sparkle", badge: "Ask" },
  { id: "support", label: "Support", icon: "help" },
];
export default function StudentHome() {
  const [view, setView] = useState("overview"),
    [event, setEvent] = useState<EventInfo | null>(null),
    [eventError, setEventError] = useState(""),
    [data, setData] = useState<InvitationData | null>(null),
    [code, setCode] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<{
      event: EventInfo | null;
    }>("/api/event")
      .then((r) => {
        if (alive) setEvent(r.event);
      })
      .catch(() => {
        if (alive)
          setEventError(
            "Event details are temporarily unavailable. Please refresh to try again.",
          );
      });
    return () => {
      alive = false;
    };
  }, []);
  const load = useCallback(async (value: string) => {
    const result = await api<InvitationData>(
      `/api/invitations?code=${encodeURIComponent(value)}`,
    );
    setData(result);
  }, []);
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await load(code.trim().toUpperCase());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not find your invitation.",
      );
    } finally {
      setLoading(false);
    }
  }
  const refresh = useCallback(async () => {
    if (data) await load(data.invitation.code);
  }, [data, load]);
  const details = [
    {
      icon: "calendar",
      title: "Date & time",
      text: event
        ? `${formatDate(event.eventDate)} · ${event.startTime || "Time to be announced"}`
        : "Event details loading…",
    },
    {
      icon: "pin",
      title: "The venue",
      text: event?.venue || "Venue to be announced",
    },
    {
      icon: "sparkle",
      title: "Dress for the occasion",
      text: event?.dressCode || "Dress code to be announced",
    },
    {
      icon: "pin",
      title: "Parking made easy",
      text: event?.parkingInfo || "Parking details to be announced",
    },
    {
      icon: "scan",
      title: "A smooth arrival",
      text: event?.entryInfo || "Entry instructions to be announced",
    },
    {
      icon: "users",
      title: "Bring your favourite people",
      text: data
        ? `Your invitation includes ${data.invitation.guestLimit} guest seats. Register each guest before arrival.`
        : "Open your invitation to see your guest allowance and register your guests.",
    },
  ];
  const lookup = (
    <section className="panel invitation-panel">
      <div className="invitation-top">
        <span>
          <Icon name="ticket" size={19} />
          Your personal invitation
        </span>
        <span className="badge purple">Private access</span>
      </div>
      <h3>Your evening starts here.</h3>
      <p>
        Enter the invitation code shared by your school to unlock your pass and
        register your guests.
      </p>
      <form onSubmit={unlock}>
        <div className="input-row">
          <label className="field">
            <span>Invitation code</span>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ANL-…"
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              required
            />
          </label>
          <button className="button primary" disabled={loading || !code.trim()}>
            {loading ? "Opening…" : "Open invitation"}
            <Icon name="arrow" size={15} />
          </button>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </form>
      <p className="security-note">
        <Icon name="shield" size={13} />
        Keep your code private. It gives access to your invitation.
      </p>
      <button className="text-button" onClick={() => setView("helpdesk")}>
        Need your code? Find my invitation <Icon name="arrow" size={15} />
      </button>
    </section>
  );
  const unlocked = (
    <section className="panel invitation-panel">
      <div className="invitation-top">
        <span>
          <Icon name="ticket" />
          Your personal invitation
        </span>
        <span
          className={`badge ${data?.invitation.status === "active" ? "success" : "warning"}`}
        >
          {data?.invitation.status}
        </span>
      </div>
      <h3>{data?.studentName}, you’re on the list.</h3>
      <p>
        {data?.registered} guests registered · {data?.remaining} seats available
      </p>
      <div className="button-row">
        <button
          className="button primary"
          onClick={() => setView("invitation")}
        >
          View my pass
          <Icon name="arrow" size={16} />
        </button>
        <button className="button" onClick={() => setView("guests")}>
          <Icon name="users" size={16} />
          Manage guests
        </button>
      </div>
      <p className="security-note">
        <Icon name="shield" size={13} />
        Your QR pass is ready for the evening.
      </p>
    </section>
  );
  return (
    <AppShell
      active={view}
      onNavigate={setView}
      items={NAV}
      name={data?.studentName}
      onLogout={
        data
          ? () => {
              setData(null);
              setCode("");
              setError("");
              setView("overview");
            }
          : undefined
      }
    >
      <div className="page-heading">
        <div>
          <h1>
            {view === "overview"
              ? data
                ? `Welcome, ${data.studentName.split(" ")[0]}.`
                : "Your event, in focus."
              : view === "invitation"
                ? "Your invitation."
                : view === "guests"
                  ? "Better, together."
                  : view === "event"
                    ? "All the little details."
                    : view === "helpdesk"
                      ? "A little help, anytime."
                      : "We’re here for you."}
          </h1>
          <p>
            {view === "overview"
              ? "Your invitation, your guests, and everything you need for the big day."
              : NAV.find((n) => n.id === view)?.label === "My guests"
                ? "Reserve a place for the people who matter most."
                : "Everything you need for Annual Function 2026, in one place."}
          </p>
        </div>
        <span className="date-chip">
          <Icon name="calendar" size={15} />
          {event ? formatDate(event.eventDate, true) : "Annual Function 2026"}
        </span>
      </div>
      {eventError && (
        <p className="notice error no-print" role="alert">
          {eventError}
        </p>
      )}
      {view === "overview" && (
        <Overview
          event={event}
          data={data}
          invitation={data ? unlocked : lookup}
          onNavigate={setView}
        />
      )}
      {view === "invitation" &&
        (data ? (
          <div className="dashboard-grid print-layout">
            <div>
              <QrCard
                studentName={data.studentName}
                code={data.invitation.code}
                guestCount={data.registered}
                qrToken={data.invitation.qrToken}
                event={event}
                active={data.invitation.status === "active"}
              />
            </div>
            <div className="no-print">
              <section className="panel">
                <h2>You’re almost ready</h2>
                <ul className="info-list">
                  <li>
                    <Icon name="users" />
                    <div>
                      <strong>
                        {data.registered} of {data.invitation.guestLimit} guests
                        registered
                      </strong>
                      <p>Add everyone joining you before you arrive.</p>
                    </div>
                  </li>
                  <li>
                    <Icon name="scan" />
                    <div>
                      <strong>Your pass at the gate</strong>
                      <p>Show this QR on your phone or bring a printed copy.</p>
                    </div>
                  </li>
                  <li>
                    <Icon name="shield" />
                    <div>
                      <strong>Keep your pass safe</strong>
                      <p>
                        Your pass is personal. Share it only with guests on your
                        invitation.
                      </p>
                    </div>
                  </li>
                </ul>
                <button
                  className="button full"
                  onClick={() => setView("guests")}
                >
                  Manage my guests
                  <Icon name="arrow" size={16} />
                </button>
              </section>
            </div>
          </div>
        ) : (
          lookup
        ))}
      {view === "guests" &&
        (data ? <GuestManager data={data} refresh={refresh} /> : lookup)}
      {view === "event" && (
        <>
          <div className="event-detail-grid">
            {details.map((d) => (
              <section className="panel" key={d.title}>
                <Icon name={d.icon} size={25} />
                <h3>{d.title}</h3>
                <p>{d.text}</p>
              </section>
            ))}
          </div>
          <p className="security-note">
            <Icon name="shield" size={14} />
            Official event information published by your school.
          </p>
        </>
      )}
      {view === "helpdesk" && (
        <Helpdesk
          key={data?.invitation.code || "public"}
          code={data?.invitation.code}
          onAction={refresh}
          onRecover={async (value) => {
            await load(value);
            setCode(value);
            setView("invitation");
          }}
        />
      )}
      {view === "support" &&
        (data ? (
          <Support code={data.invitation.code} />
        ) : (
          <>
            <p className="notice">
              Open your invitation to send a request and view your support
              history. If you haven’t received a code, contact your class
              teacher.
            </p>
            {lookup}
          </>
        ))}
    </AppShell>
  );
}
