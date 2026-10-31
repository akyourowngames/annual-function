"use client";
import { useCallback, useEffect, useState } from "react";
import Overview from "@/components/portal/Overview";
import Rsvp from "@/components/portal/Rsvp";
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
    [stage, setStage] = useState<"code" | "otp">("code"),
    [otp, setOtp] = useState(""),
    [otpMessage, setOtpMessage] = useState(""),
    [destination, setDestination] = useState(""),
    [checkingSession, setCheckingSession] = useState(true),
    [loading, setLoading] = useState(false),
    [resendIn, setResendIn] = useState(0),
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
  // Resume an existing verified session (cookie is HttpOnly; the server decides).
  useEffect(() => {
    let alive = true;
    api<{ verified: boolean; code?: string }>("/api/family/session")
      .then(async (r) => {
        if (!alive || !r.verified || !r.code) return;
        try {
          await load(r.code);
          setCode(r.code);
        } catch {
          /* expired or revoked — fall back to verification */
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setCheckingSession(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);
  // Count the resend cooldown down once per second so the family sees why the
  // button is disabled instead of silently retyping their code.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);
  async function beginVerify(value: string) {
    setLoading(true);
    setError("");
    setOtpMessage("");
    const normalized = value.trim().toUpperCase();
    setCode(normalized);
    try {
      const r = await api<{
        nextStep: "enter_otp" | "contact_teacher";
        message: string;
        destination?: string;
        retryAfterSeconds?: number;
      }>("/api/family/verify/start", {
        method: "POST",
        body: JSON.stringify({ code: normalized }),
      });
      setOtpMessage(r.message);
      if (r.nextStep === "enter_otp") {
        setDestination(r.destination || "");
        setResendIn(r.retryAfterSeconds ?? 0);
        setStage("otp");
      } else {
        setStage("code");
        setResendIn(0);
        setError(r.message);
      }
    } catch (e) {
      setStage("code");
      setResendIn(0);
      setError(
        e instanceof Error ? e.message : "Could not start verification.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    await beginVerify(code);
  }
  async function confirmOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await api<{ invitation: InvitationData }>(
        "/api/family/verify/confirm",
        {
          method: "POST",
          body: JSON.stringify({ code, otp }),
        },
      );
      setData(r.invitation);
      setStage("code");
      setOtp("");
      setOtpMessage("");
      setDestination("");
      setResendIn(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }
  async function logout() {
    await api("/api/family/session", { method: "DELETE" }).catch(() => undefined);
    setData(null);
    setCode("");
    setOtp("");
    setStage("code");
    setError("");
    setResendIn(0);
    setView("overview");
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
      {stage === "otp" ? (
        <>
          <h3>Check your verified contact.</h3>
          <p>
            {otpMessage}
            {destination ? (
              <>
                {" "}
                Sent to <strong>{destination}</strong>.
              </>
            ) : null}
          </p>
          <form onSubmit={confirmOtp}>
            <div className="input-row">
              <label className="field">
                <span>6-digit verification code</span>
                <input
                  className="code-input"
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
              <button
                className="button primary"
                disabled={loading || otp.length !== 6}
              >
                {loading ? "Verifying…" : "Verify"}
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
            Never share this code. The school will never ask you for it.
          </p>
          {resendIn > 0 ? (
            <p className="caption">
              You can request a new code in {resendIn}s.
            </p>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="text-button"
              disabled={loading || resendIn > 0}
              onClick={() => void beginVerify(code)}
            >
              {resendIn > 0 ? "Resend available shortly" : "Resend the code"}
              <Icon name="arrow" size={15} />
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setStage("code");
                setOtp("");
                setError("");
                setOtpMessage("");
                setResendIn(0);
              }}
            >
              Use a different code
              <Icon name="arrow" size={15} />
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>Your evening starts here.</h3>
          <p>
            Enter the invitation code shared by your school. To protect your
            family, we send a 6-digit verification code to your registered
            WhatsApp or Telegram contact before showing your pass or guest list.
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
              <button
                className="button primary"
                disabled={loading || !code.trim()}
              >
                {loading ? "Checking…" : "Continue"}
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
            Your code alone does not reveal your guest list or QR pass.
          </p>
          <button className="text-button" onClick={() => setView("helpdesk")}>
            Need your code? Find my invitation <Icon name="arrow" size={15} />
          </button>
        </>
      )}
      {checkingSession && (
        <p className="caption">Checking for an existing verified session…</p>
      )}
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
      onLogout={data ? logout : undefined}
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
        <>
          <Overview
            event={event}
            data={data}
            invitation={data ? unlocked : lookup}
            onNavigate={setView}
          />
          {data && (
            <Rsvp
              code={data.invitation.code}
              guestLimit={data.invitation.guestLimit}
              registered={data.registered}
              rsvp={data.rsvp}
              onDone={refresh}
            />
          )}
        </>
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
            setView("invitation");
            await beginVerify(value);
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
