"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";

type Photo = { id: string; caption: string | null; url: string };
type Payload = { enabled: boolean; photos: Photo[] };

// Family-facing view of the event album. Same rules as /gallery: only shows
// what the school has published and approved.
export default function Gallery() {
  const [data, setData] = useState<Payload | null>(null);
  const [active, setActive] = useState<Photo | null>(null);

  useEffect(() => {
    let alive = true;
    api<Payload>("/api/gallery")
      .then((r) => {
        if (alive) setData(r);
      })
      .catch(() => {
        if (alive) setData({ enabled: false, photos: [] });
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (!data) return <p className="loading-line">Opening the album…</p>;

  if (!data.enabled)
    return (
      <section className="panel">
        <div className="empty-state">
          <Icon name="camera" size={34} />
          <h3>The album isn&rsquo;t open yet</h3>
          <p>
            The school publishes it after the evening. Check back soon, or send
            your own photos to the school&rsquo;s WhatsApp or Telegram.
          </p>
        </div>
      </section>
    );

  if (!data.photos.length)
    return (
      <section className="panel">
        <div className="empty-state">
          <Icon name="camera" size={34} />
          <h3>No photos yet</h3>
          <p>
            Be the first — send your favourite shots to the school&rsquo;s
            WhatsApp or Telegram and they&rsquo;ll appear here.
          </p>
        </div>
      </section>
    );

  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>The Annual Function album</h2>
            <p>
              {data.photos.length}{" "}
              {data.photos.length === 1 ? "photo" : "photos"} shared by our
              families.
            </p>
          </div>
          <Icon name="camera" />
        </div>
        <div className="album-grid space-top">
          {data.photos.map((p) => (
            <figure className="album-tile" key={p.id}>
              <button
                className="album-open"
                onClick={() => setActive(p)}
                aria-label={p.caption || "Open photo"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || "Event photo"} loading="lazy" />
              </button>
              {p.caption && <figcaption>{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
      </section>
      {active && (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
        >
          <figure onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.url} alt={active.caption || "Event photo"} />
            <figcaption>
              <span>{active.caption || "Annual Function"}</span>
              <a
                className="button small"
                href={active.url}
                download
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="download" size={14} /> Download
              </a>
              <button
                className="icon-button"
                aria-label="Close photo"
                onClick={() => setActive(null)}
              >
                <Icon name="close" size={16} />
              </button>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
