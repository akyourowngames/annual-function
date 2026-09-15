"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Icon from "@/components/ui/Icon";
import { Star } from "@/components/landing/Playground";
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
      <div className="auth-layout">
        <section className="auth-story" aria-label="Welcome to the event team">
          <Link href="/" className="workspace-brand" aria-label="Annual home">
            <Star size={31} />
            <span>
              <span className="workspace-wordmark">
                annual<em>.</em>
              </span>
              <small>A sky full of stories</small>
            </span>
          </Link>
          <h2>A little backstage magic.</h2>
          <p>
            For the people who turn little dreams into a very big evening. Your
            place behind the curtain.
          </p>
          <Image
            src="/landing/paper-theatre.png"
            width={1254}
            height={1254}
            alt=""
            className="auth-theatre"
            unoptimized
          />
          <span className="auth-story-note">
            Every great show
            <br />
            starts with you.
          </span>
        </section>
        <div>
          <section className="auth-card">
            <div className="auth-card-mark">
              <Star size={18} />A pass for the people behind it all
            </div>
            <h1>Behind the scenes.</h1>
            <p>
              Welcome to your staff workspace. Sign in to manage the evening.
            </p>
            <div className="auth-tabs">
              <button
                className={`button ${mode === "account" ? "primary" : ""}`}
                aria-pressed={mode === "account"}
                onClick={() => setMode("account")}
              >
                Staff account
              </button>
              <button
                className={`button ${mode === "key" ? "primary" : ""}`}
                aria-pressed={mode === "key"}
                onClick={() => setMode("key")}
              >
                Access key
              </button>
            </div>
            <form onSubmit={submit} key={mode} className="auth-form-fields">
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
                  <span>Access key</span>
                  <input
                    type="password"
                    name="accessKey"
                    required
                    autoComplete="current-password"
                    placeholder="Staff or gate keeper key"
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
              For authorized school and event staff. A gate keeper key opens the
              scanner only.
            </p>
            <Link href="/portal" className="staff-link">
              Return to the student portal
            </Link>
          </section>
          <p className="auth-footer-note">
            <Icon name="heart" size={13} />
            Made for the people who make it happen.
          </p>
        </div>
      </div>
    </main>
  );
}
