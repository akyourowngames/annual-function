"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";

type Photo = {
  id: string;
  status: string;
  caption: string | null;
  channel: string;
  invitationCode: string | null;
  byteSize: number | null;
  createdAt: string;
  url: string | null;
};
type Payload = {
  photos: Photo[];
  counts: { pending: number; approved: number; hidden: number };
  total: number;
  galleryEnabled: boolean;
};

export default function Album({ canPublish }: { canPublish: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>("/api/album"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the album.");
    }
  }, []);
  useEffect(() => {
    let alive = true;
    api<Payload>("/api/album")
      .then((r) => {
        if (!alive) return;
        setData(r);
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the album.");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function setStatus(id: string, status: string) {
    setBusy(true);
    try {
      await api("/api/album", { method: "PATCH", body: JSON.stringify({ id, status }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the photo.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await api("/api/album", { method: "DELETE", body: JSON.stringify({ id }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the photo.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleGallery() {
    if (!data) return;
    setBusy(true);
    try {
      await api("/api/album", {
        method: "PATCH",
        body: JSON.stringify({ galleryEnabled: !data.galleryEnabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the gallery.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="loading-line">{error || "Loading album…"}</p>;
  const shown = data.photos.filter((p) => filter === "all" || p.status === filter);

  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="section-heading">
          <div>
            <h2>Public gallery</h2>
            <p>
              A page anyone can open at <strong>/gallery</strong>. Only approved
              photos ever appear there.
            </p>
          </div>
          <Icon name="camera" />
        </div>
        <div className="button-row" style={{ marginTop: 14 }}>
          <span className={`badge ${data.galleryEnabled ? "success" : "warning"}`}>
            {data.galleryEnabled ? "Published" : "Private"}
          </span>
          <a className="button small" href="/gallery" target="_blank" rel="noreferrer">
            Open /gallery <Icon name="arrow" size={14} />
          </a>
          {canPublish && (
            <button
              className={`button small ${data.galleryEnabled ? "" : "primary"}`}
              disabled={busy}
              onClick={toggleGallery}
            >
              {data.galleryEnabled ? "Unpublish gallery" : "Publish gallery"}
            </button>
          )}
        </div>
        {!canPublish && (
          <p className="caption space-top">
            Only administrators can publish or hide the public gallery.
          </p>
        )}
      </section>
      <div className="stats-grid">
        {[
          { label: "Photos", value: data.total, detail: "Shared by families" },
          { label: "Pending", value: data.counts.pending, detail: "Waiting for review" },
          { label: "Approved", value: data.counts.approved, detail: "Cleared for the album" },
          { label: "Hidden", value: data.counts.hidden, detail: "Kept out of the album" },
        ].map((s) => (
          <section className="stat" key={s.label}>
            <div className="stat-top">
              {s.label}
              <Icon name="camera" size={16} />
            </div>
            <strong>{s.value}</strong>
            <small>{s.detail}</small>
          </section>
        ))}
      </div>
      <div className="button-row" style={{ margin: "18px 0" }}>
        {["all", "pending", "approved", "hidden"].map((f) => (
          <button
            key={f}
            className={`button small ${filter === f ? "primary" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="album-grid">
          {shown.map((p) => (
            <figure className="album-tile" key={p.id}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || "Event photo"} loading="lazy" />
                </a>
              ) : (
                <div className="album-missing">Preview unavailable</div>
              )}
              <span className={`album-badge ${p.status}`}>{p.status}</span>
              <figcaption>
                {p.caption || `${p.invitationCode || "Unverified family"} · ${p.channel}`}
              </figcaption>
              <div className="album-actions">
                {p.status !== "approved" && (
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() => setStatus(p.id, "approved")}
                  >
                    <Icon name="check" size={14} /> Approve
                  </button>
                )}
                {p.status !== "hidden" && (
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() => setStatus(p.id, "hidden")}
                  >
                    Hide
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Delete photo"
                  disabled={busy}
                  onClick={() => remove(p.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </figure>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="camera" size={30} />
          <p>
            No photos here yet. When a family sends a photo to the bot it lands
            in this album for review.
          </p>
        </div>
      )}
    </>
  );
}
