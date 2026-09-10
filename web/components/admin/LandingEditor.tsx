"use client";
import { useEffect, useState } from "react";
import {
  DEMO_LANDING,
  type LandingContent,
  type ProgrammeItem,
} from "@/lib/landing";
import { api, type EventInfo } from "@/lib/types";
import Icon from "@/components/ui/Icon";
export default function LandingEditor() {
  const [content, setContent] = useState<LandingContent>(DEMO_LANDING),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<{ event: EventInfo | null }>("/api/event")
      .then((r) => {
        if (alive && r.event?.landingContent)
          setContent(r.event.landingContent);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  function guest(index: number, key: string, value: string) {
    setContent((c) => ({
      ...c,
      guests: c.guests.map((g, i) =>
        i === index ? { ...g, [key]: value } : g,
      ),
    }));
  }
  function moment(index: number, key: string, value: string) {
    setContent((c) => ({
      ...c,
      programme: c.programme.map((p, i) =>
        i === index ? { ...p, [key]: value } : p,
      ),
    }));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/landing", {
        method: "PUT",
        body: JSON.stringify(content),
      });
      setNotice(
        "Landing page published. Your school, guests, and programme are now updated.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not publish the landing page.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel space-top">
      <div className="section-heading">
        <div>
          <h2>Public landing page</h2>
          <p>
            Replace the demo content when your guest lineup and programme are
            ready.
          </p>
        </div>
        <a className="button small" href="/" target="_blank" rel="noreferrer">
          Preview page
          <Icon name="arrow" size={14} />
        </a>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={save}>
        <div className="form-grid">
          <label className="field">
            <span>School name</span>
            <input
              value={content.schoolName}
              onChange={(e) =>
                setContent((c) => ({ ...c, schoolName: e.target.value }))
              }
              required
              maxLength={150}
            />
          </label>
          <label className="field">
            <span>Event theme / headline</span>
            <input
              value={content.theme}
              onChange={(e) =>
                setContent((c) => ({ ...c, theme: e.target.value }))
              }
              required
              maxLength={100}
            />
          </label>
          <label className="field wide">
            <span>Introduction</span>
            <textarea
              value={content.introduction}
              onChange={(e) =>
                setContent((c) => ({ ...c, introduction: e.target.value }))
              }
              required
              maxLength={600}
            />
          </label>
          <label className="field wide">
            <span>Contact & accessibility information</span>
            <textarea
              value={content.contact}
              onChange={(e) =>
                setContent((c) => ({ ...c, contact: e.target.value }))
              }
              required
              maxLength={1000}
            />
          </label>
        </div>
        <div className="section-heading space-top">
          <h3>Chief guests & school leaders</h3>
          <button
            className="button small"
            type="button"
            disabled={content.guests.length >= 6}
            onClick={() =>
              setContent((c) => ({
                ...c,
                guests: [
                  ...c.guests,
                  { name: "", title: "", role: "Guest of honour", note: "" },
                ],
              }))
            }
          >
            <Icon name="plus" size={14} />
            Add guest
          </button>
        </div>
        {content.guests.map((g, i) => (
          <div className="support-ticket space-top" key={i}>
            <div className="section-heading">
              <strong className="caption">Guest {i + 1}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove guest ${i + 1}`}
                disabled={content.guests.length <= 1}
                onClick={() =>
                  setContent((c) => ({
                    ...c,
                    guests: c.guests.filter((_, n) => n !== i),
                  }))
                }
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div className="form-grid">
              {[
                { key: "name", label: "Name", max: 100 },
                { key: "title", label: "Title", max: 150 },
                { key: "role", label: "Role at the event", max: 70 },
                { key: "note", label: "Introduction", max: 500 },
              ].map((f) => (
                <label className="field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    value={g[f.key as keyof typeof g]}
                    onChange={(e) => guest(i, f.key, e.target.value)}
                    required
                    maxLength={f.max}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="section-heading space-top">
          <h3>The evening’s programme</h3>
          <button
            type="button"
            className="button small"
            disabled={content.programme.length >= 15}
            onClick={() =>
              setContent((c) => ({
                ...c,
                programme: [
                  ...c.programme,
                  { time: "", title: "", description: "", kind: "celebration" },
                ],
              }))
            }
          >
            <Icon name="plus" size={14} />
            Add moment
          </button>
        </div>
        {content.programme.map((p, i) => (
          <div className="support-ticket space-top" key={i}>
            <div className="section-heading">
              <strong className="caption">Moment {i + 1}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove moment ${i + 1}`}
                disabled={content.programme.length <= 1}
                onClick={() =>
                  setContent((c) => ({
                    ...c,
                    programme: c.programme.filter((_, n) => n !== i),
                  }))
                }
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Time</span>
                <input
                  value={p.time}
                  onChange={(e) => moment(i, "time", e.target.value)}
                  required
                  maxLength={30}
                />
              </label>
              <label className="field">
                <span>Category</span>
                <select
                  value={p.kind}
                  onChange={(e) =>
                    moment(i, "kind", e.target.value as ProgrammeItem["kind"])
                  }
                >
                  {["welcome", "dance", "theatre", "music", "celebration"].map(
                    (k) => (
                      <option key={k}>{k}</option>
                    ),
                  )}
                </select>
              </label>
              <label className="field wide">
                <span>Title</span>
                <input
                  value={p.title}
                  onChange={(e) => moment(i, "title", e.target.value)}
                  required
                  maxLength={150}
                />
              </label>
              <label className="field wide">
                <span>Description</span>
                <textarea
                  value={p.description}
                  onChange={(e) => moment(i, "description", e.target.value)}
                  required
                  maxLength={800}
                />
              </label>
            </div>
          </div>
        ))}
        <label className="flex items-center gap-3 text-xs text-muted my-6">
          <input
            type="checkbox"
            checked={content.isDemo}
            onChange={(e) =>
              setContent((c) => ({ ...c, isDemo: e.target.checked }))
            }
          />
          Show demo content labels until details are confirmed
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Publishing…" : "Publish landing page"}
          <Icon name="arrow" size={15} />
        </button>
      </form>
    </section>
  );
}
