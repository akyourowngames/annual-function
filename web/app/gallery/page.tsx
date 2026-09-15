"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import "../landing.css";
import Icon from "@/components/ui/Icon";
import { Star } from "@/components/landing/Playground";
import { api } from "@/lib/types";

type Photo = { id: string; caption: string | null; createdAt: string; url: string };
type Payload = { enabled: boolean; photos: Photo[] };

export default function GalleryPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [active, setActive] = useState<Photo | null>(null);
  const [school, setSchool] = useState("Everest Public School");

  useEffect(() => {
    let alive = true;
    api<Payload>("/api/gallery")
      .then((r) => {
        if (alive) setData(r);
      })
      .catch(() => {
        if (alive) setData({ enabled: false, photos: [] });
      });
    api<{ event: { landingContent?: { schoolName?: string } } | null }>("/api/event")
      .then((r) => {
        if (alive && r.event?.landingContent?.schoolName)
          setSchool(r.event.landingContent.schoolName);
      })
      .catch(() => {});
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

  return (
    <main className="gallery-site">
      <header className="gallery-nav">
        <Link href="/" className="play-brand" aria-label={`${school} home`}>
          <span className="brand-bloom">
            <Star size={26} />
          </span>
          <span>
            annual<span className="brand-period">.</span>
            <small>{school}</small>
          </span>
        </Link>
        <Link className="button small" href="/">
          Back to the celebration
          <Icon name="arrow" size={14} />
        </Link>
      </header>

      <section className="gallery-hero">
        <span className="section-kicker">
          <span className="dash" />
          The Annual Function album
        </span>
        <h1>
          Little moments.
          <br />
          <span>Big memories.</span>
        </h1>
        <p>
          Photographs shared by our families — the candid ones the stage never
          saw.
        </p>
      </section>

      {data === null ? (
        <p className="gallery-note">Loading the album…</p>
      ) : !data.enabled ? (
        <div className="gallery-empty">
          <Icon name="camera" size={40} />
          <h2>The album isn&rsquo;t open yet</h2>
          <p>
            The school publishes it after the evening. Please check back when it
            goes live.
          </p>
        </div>
      ) : data.photos.length === 0 ? (
        <div className="gallery-empty">
          <Icon name="camera" size={40} />
          <h2>No photos yet</h2>
          <p>
            Families can send their favourite shots to the school&rsquo;s WhatsApp
            or Telegram and they&rsquo;ll appear here.
          </p>
        </div>
      ) : (
        <>
          <p className="gallery-count">
            {data.photos.length}{" "}
            {data.photos.length === 1 ? "photo" : "photos"} shared
          </p>
          <div className="gallery-masonry">
            {data.photos.map((p) => (
              <button
                className="gallery-item"
                key={p.id}
                onClick={() => setActive(p)}
                aria-label={p.caption || "Open photo"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || "Event photo"} loading="lazy" />
                {p.caption && <span className="gallery-caption">{p.caption}</span>}
              </button>
            ))}
          </div>
        </>
      )}

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

      <footer className="gallery-foot">With heart, from {school}.</footer>
    </main>
  );
}
