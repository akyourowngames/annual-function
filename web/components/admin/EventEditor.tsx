"use client";
import { useEffect, useState } from "react";
import { api, type EventInfo } from "@/lib/types";
import Icon from "@/components/ui/Icon";
import LandingEditor from "./LandingEditor";
type Document = {
  id: string;
  title: string;
  content: string;
};
export default function EventEditor() {
  const [event, setEvent] = useState<EventInfo | null>(null),
    [docs, setDocs] = useState<Document[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{
      event: EventInfo | null;
    }>("/api/event")
      .then((r) =>
        setEvent(
          r.event || {
            eventName: "Annual Function 2026",
            eventDate: null,
            startTime: null,
            venue: null,
            dressCode: null,
            parkingInfo: null,
            entryInfo: null,
          },
        ),
      )
      .catch((e) => setError(e.message));
    api<{
      documents: Document[];
    }>("/api/knowledge")
      .then((r) => setDocs(r.documents))
      .catch((e) => setError(e.message));
  }, []);
  async function saveEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        event: EventInfo;
      }>("/api/event", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      setEvent(r.event);
      setNotice(
        "Event information published. Families and the helpdesk will see these details.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save event.");
    } finally {
      setBusy(false);
    }
  }
  async function addDoc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        document: Document;
      }>("/api/knowledge", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      setDocs((d) => [r.document, ...d]);
      form.reset();
      setNotice("Knowledge article published.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish article.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
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
      <div className="dashboard-grid">
        <section className="panel">
          <h2>Official event information</h2>
          <p className="caption" style={{ margin: "7px 0 22px" }}>
            Published details power the student portal and helpdesk.
          </p>
          {event ? (
            <form onSubmit={saveEvent}>
              <div className="form-grid">
                {[
                  { key: "eventName", label: "Event name", type: "text" },
                  { key: "eventDate", label: "Event date", type: "date" },
                  { key: "startTime", label: "Start time", type: "text" },
                  { key: "venue", label: "Venue", type: "text" },
                  { key: "dressCode", label: "Dress code", type: "text" },
                ].map((f) => (
                  <label
                    className={`field ${f.key === "eventName" || f.key === "venue" || f.key === "dressCode" ? "wide" : ""}`}
                    key={f.key}
                  >
                    <span>{f.label}</span>
                    <input
                      name={f.key}
                      type={f.type}
                      defaultValue={String(
                        event[f.key as keyof EventInfo] || "",
                      )}
                      required={f.key === "eventName"}
                      maxLength={f.key === "dressCode" ? 1000 : 500}
                    />
                  </label>
                ))}
                <label className="field wide">
                  <span>Parking information</span>
                  <textarea
                    name="parkingInfo"
                    defaultValue={event.parkingInfo || ""}
                    maxLength={2000}
                  />
                </label>
                <label className="field wide">
                  <span>Entry instructions</span>
                  <textarea
                    name="entryInfo"
                    defaultValue={event.entryInfo || ""}
                    maxLength={2000}
                  />
                </label>
              </div>
              <button className="button primary" disabled={busy}>
                Publish event details
              </button>
            </form>
          ) : (
            <p className="loading-line">Loading event details…</p>
          )}
        </section>
        <section className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
          <div className="section-heading">
            <h2>Helpdesk knowledge</h2>
            <Icon name="sparkle" />
          </div>
          <p className="caption" style={{ marginBottom: 20 }}>
            Add official FAQs, schedules, accessibility guidance, or
            announcements. Publish only information families may see.
          </p>
          <form onSubmit={addDoc}>
            <label className="field">
              <span>Article title</span>
              <input
                name="title"
                required
                maxLength={200}
                placeholder="e.g. Evening programme"
              />
            </label>
            <label className="field">
              <span>Official information</span>
              <textarea
                name="content"
                required
                maxLength={20000}
                placeholder="Paste the approved information here…"
              />
            </label>
            <button className="button primary full" disabled={busy}>
              Publish article
            </button>
          </form>
          <div className="ticket-list">
            {docs.map((d) => (
              <article className="support-ticket" key={d.id}>
                <header>
                  <strong>{d.title}</strong>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${d.title}`}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/knowledge", {
                          method: "DELETE",
                          body: JSON.stringify({ id: d.id }),
                        });
                        setDocs((old) => old.filter((x) => x.id !== d.id));
                        setNotice("Article removed from the helpdesk.");
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not remove article.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </header>
                <p className="caption">
                  {d.content.slice(0, 180)}
                  {d.content.length > 180 ? "…" : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
      <LandingEditor />
    </>
  );
}
