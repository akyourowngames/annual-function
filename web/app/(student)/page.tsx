"use client";

import { useCallback, useState } from "react";
import QrCard from "@/components/invitation/QrCard";

type Guest = {
  id: string;
  name: string;
  relationship: string | null;
  status: string;
};

type InvitationData = {
  invitation: {
    code: string;
    status: string;
    guestLimit: number;
    qrToken: string;
  };
  studentName: string;
  registered: number;
  remaining: number;
  checkIns: number;
  guests: Guest[];
};

const RELATIONSHIPS = [
  "Father",
  "Mother",
  "Sibling",
  "Grandparent",
  "Relative",
  "Friend",
  "Guardian",
  "Other",
] as const;

export default function StudentHome() {
  const [codeInput, setCodeInput] = useState("");
  const [data, setData] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [guestName, setGuestName] = useState("");
  const [relationship, setRelationship] = useState<string>(RELATIONSHIPS[0]);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeIsError, setNoticeIsError] = useState(false);

  const loadInvitation = useCallback(async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invitations?code=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Lookup failed");
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleView(e: React.FormEvent) {
    e.preventDefault();
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setCodeInput(code);
    setNotice(null);
    await loadInvitation(code);
  }

  function handleBack() {
    setData(null);
    setCodeInput("");
    setError(null);
    setNotice(null);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const name = guestName.trim();
    if (!name) return;
    setRegistering(true);
    setNotice(null);
    try {
      const res = await fetch("/api/guests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: data.invitation.code,
          name,
          relationship,
        }),
      });
      const json = await res.json();
      if (res.status === 201) {
        setGuestName("");
        setNoticeIsError(false);
        setNotice(
          `"${json.guest.name}" registered. ${json.remaining} seat(s) remaining.`,
        );
        await loadInvitation(data.invitation.code);
      } else {
        setNoticeIsError(true);
        setNotice(json.error ?? "Registration failed");
      }
    } catch {
      setNoticeIsError(true);
      setNotice("Registration failed. Please try again.");
    } finally {
      setRegistering(false);
    }
  }

  // ---------- Landing ----------
  if (!data) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <h1 className="text-center text-lg font-bold tracking-[0.25em] text-zinc-900">
            ANNUAL FUNCTION 2026
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-600">
            Your digital invitation portal
          </p>

          <form onSubmit={handleView} className="mt-8">
            <label
              htmlFor="invitation-code"
              className="block text-sm font-medium text-zinc-700"
            >
              Invitation Code
            </label>
            <input
              id="invitation-code"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="ANL-0234QM"
              autoComplete="off"
              autoCapitalize="characters"
              className="mt-2 w-full rounded-lg border border-zinc-300 px-4 py-3 text-center font-mono text-lg tracking-widest uppercase outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            />

            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || codeInput.trim().length === 0}
              className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Looking up…" : "View Invitation"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-400">
            The code is on the invitation shared by your school.
          </p>
        </div>
      </main>
    );
  }

  // ---------- Dashboard ----------
  const { invitation } = data;
  const limitReached = data.remaining <= 0;
  const inactive = invitation.status !== "active";

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
        >
          ← Back
        </button>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            inactive ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          }`}
        >
          {invitation.status}
        </span>
      </div>

      <h1 className="mt-4 text-2xl font-bold text-zinc-900">
        Welcome, {data.studentName}
      </h1>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Invitation
          </p>
          <p className="mt-1 truncate font-mono text-sm font-semibold text-zinc-900">
            {invitation.code}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Guests
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">
            {data.registered} / {invitation.guestLimit}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-center">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Check-ins
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">
            {data.checkIns}
          </p>
        </div>
      </div>

      {/* QR invitation card */}
      <div className="mt-5">
        <QrCard
          studentName={data.studentName}
          code={invitation.code}
          guestCount={data.registered}
          qrToken={invitation.qrToken}
        />
      </div>

      {/* Registered guests */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">Registered Guests</h2>
        {data.guests.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-center text-sm text-zinc-500">
            No guests registered yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
            {data.guests.map((g) => (
              <li key={g.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900">{g.name}</p>
                  {g.relationship && (
                    <p className="text-xs text-zinc-500">{g.relationship}</p>
                  )}
                </div>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600">
                  {g.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Registration */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">Add a guest</h2>

        {notice && (
          <p
            className={`mt-2 rounded-lg px-4 py-2 text-sm ${
              noticeIsError
                ? "bg-red-50 text-red-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {notice}
          </p>
        )}

        {inactive ? (
          <p className="mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            This invitation is not active — registration is closed.
          </p>
        ) : limitReached ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
            Guest limit reached ({data.registered} / {invitation.guestLimit}).
            Need more seats? Raise a support ticket with your class teacher.
          </p>
        ) : (
          <form
            onSubmit={handleRegister}
            className="mt-2 rounded-xl border border-zinc-200 bg-white p-4"
          >
            <label
              htmlFor="guest-name"
              className="block text-sm font-medium text-zinc-700"
            >
              Name
            </label>
            <input
              id="guest-name"
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Full name"
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            />

            <label
              htmlFor="guest-relationship"
              className="mt-4 block text-sm font-medium text-zinc-700"
            >
              Relationship
            </label>
            <select
              id="guest-relationship"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={registering || guestName.trim().length === 0}
              className="mt-4 w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {registering ? "Registering…" : "+ Register Guest"}
            </button>
          </form>
        )}
      </section>

      <p className="mt-8 pb-4 text-center text-xs text-zinc-400">
        Annual Function 2026 · Entry via Gate 1 with this QR
      </p>
    </main>
  );
}
