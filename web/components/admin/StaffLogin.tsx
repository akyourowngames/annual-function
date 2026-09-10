"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";
export default function StaffLogin({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState("account"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link href="/" className="brand">
          <Icon name="sparkle" size={32} />
          <span>
            annual<span className="brand-dot">.</span>
          </span>
        </Link>
        <h1>Behind the scenes.</h1>
        <p>Welcome to your staff workspace. Sign in to manage the evening.</p>
        <div className="auth-tabs">
          <button
            className={`button ${mode === "account" ? "primary" : ""}`}
            onClick={() => setMode("account")}
          >
            Staff account
          </button>
          <button
            className={`button ${mode === "key" ? "primary" : ""}`}
            onClick={() => setMode("key")}
          >
            Access key
          </button>
        </div>
        <form onSubmit={submit} key={mode}>
          {mode === "account" ? (
            <>
              <label className="field">
                <span>School email</span>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="username"
                  placeholder="you@school.edu"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  required
                  autoComplete="current-password"
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span>Staff access key</span>
              <input
                type="password"
                name="accessKey"
                required
                autoComplete="current-password"
                placeholder="Enter your administrator key"
              />
            </label>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Signing in…" : "Open staff workspace"}
            <Icon name="arrow" size={16} />
          </button>
        </form>
        <p className="security-note">
          <Icon name="shield" size={15} />
          For authorized school and event staff.
        </p>
        <Link href="/portal" className="staff-link">
          Return to the student portal
        </Link>
      </section>
    </main>
  );
}
