"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";
import Icon from "@/components/ui/Icon";
import { formatDate, type EventInfo } from "@/lib/types";
export default function QrCard({
  studentName,
  code,
  guestCount,
  qrToken,
  event,
  active = true,
}: {
  studentName: string;
  code: string;
  guestCount: number;
  qrToken: string;
  event?: EventInfo | null;
  active?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(qrToken, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1b1325", light: "#ffffff" },
    })
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [qrToken]);
  return (
    <>
      <section className="pass">
        <header className="pass-header">
          <strong>{event?.eventName || "Annual Function 2026"}</strong>
          <span className={`badge ${active ? "success" : "warning"}`}>
            {active ? "Entry pass" : "Inactive"}
          </span>
        </header>
        <div className="pass-body">
          <Icon name="sparkle" size={32} className="mx-auto mb-4" />
          <h2>{studentName}</h2>
          <p>You and your guests are warmly invited.</p>
          <div className="qr-frame">
            {!active ? (
              <span>Contact the event team to reactivate this pass.</span>
            ) : url ? (
              <Image
                src={url}
                width={480}
                height={480}
                unoptimized
                alt={`Entry QR for ${code}`}
              />
            ) : (
              <span>
                {error
                  ? "QR unavailable. Please refresh."
                  : "Preparing your QR…"}
              </span>
            )}
          </div>
          <strong className="pass-code">{code}</strong>
          <p>
            {guestCount} registered {guestCount === 1 ? "guest" : "guests"}
          </p>
          <p>
            {formatDate(event?.eventDate)}
            {event?.startTime ? ` · ${event.startTime}` : ""}
            <br />
            {event?.venue}
          </p>
        </div>
        <footer className="pass-footer">
          {event?.entryInfo ||
            "Present this invitation QR at the event entrance."}
        </footer>
      </section>
      <div className="button-row pass-actions">
        <button
          className="button primary"
          disabled={!url || !active}
          onClick={() => window.print()}
        >
          <Icon name="download" size={16} />
          Print / save PDF
        </button>
        {url && active && (
          <a className="button" href={url} download={`invitation-${code}.png`}>
            <Icon name="scan" size={16} />
            Download QR
          </a>
        )}
      </div>
      <p className="caption no-print" style={{ marginTop: 10 }}>
        Choose “Save as PDF” in the print dialog to keep a copy.
      </p>
    </>
  );
}
