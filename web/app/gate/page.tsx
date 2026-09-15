"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { Star } from "@/components/landing/Playground";
import Scanner from "@/components/admin/Scanner";
import { api } from "@/lib/types";

// Dedicated gate keeper entrance. Opens the scanner and nothing else.
export default function GatePage() {
  const [state, setState] = useState<"checking" | "signed-in" | "signed-out">("checking");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("Gate keeper");

  useEffect(() => {
    let alive = true;
    api<{ staff: { name: string; role: string } }>("/api/auth")
      .then((r) => {
        if (!alive) return;
        setName(r.staff.name);
        setState("signed-in");
      })
      .catch(() => {
        if (alive) setState("signed-out");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ staff: { name: string } }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({ accessKey: key }),
      });
      setName(r.staff.name);
      setState("signed-in");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking")
    return (
      <main className="auth-page">
        <p className="loading-line">Opening the gate…</p>
      </main>
    );

  if (state === "signed-out")
    return (
      <main className="auth-page">
        <section className="auth-card gate-card">
          <div className="auth-card-mark">
            <Star size={18} />
            Gate keepers only
          </div>
          <h1>Welcome to the gate.</h1>
          <p>Enter your gate key to open the scanner.</p>
          <form onSubmit={submit} className="auth-form-fields">
            <label className="field">
              <span>Gate key</span>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Gate access key"
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? "Signing in…" : "Open scanner"}
              <Icon name="arrow" size={16} />
            </button>
          </form>
          <p className="security-note">
            <Icon name="shield" size={15} />
            This page can only verify passes and check guests in.
          </p>
          <Link href="/" className="staff-link">
            Back to the celebration
          </Link>
        </section>
      </main>
    );

  return (
    <main className="gate-page">
      <header className="gate-bar">
        <Link href="/" className="workspace-brand" aria-label="Annual home">
          <Star size={28} />
          <span>
            <span className="workspace-wordmark">
              annual<em>.</em>
            </span>
            <small>Gate check-in</small>
          </span>
        </Link>
        <div className="button-row">
          <span className="badge success">
            <Icon name="shield" size={12} /> {name}
          </span>
          <button
            className="button small"
            onClick={async () => {
              await api("/api/auth", { method: "DELETE" }).catch(() => {});
              setState("signed-out");
              setKey("");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="gate-body">
        <Scanner onCheckIn={async () => {}} />
      </div>
    </main>
  );
}
