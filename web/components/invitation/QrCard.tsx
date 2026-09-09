"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The printable invitation card with entry QR.
 * The QR encodes ONLY the opaque qr_token — never personal data.
 */
export default function QrCard({
  studentName,
  code,
  guestCount,
  qrToken,
}: {
  studentName: string;
  code: string;
  guestCount: number;
  qrToken: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(qrToken, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrToken]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm print:border-zinc-400">
      <h2 className="text-xs font-semibold tracking-[0.25em] text-zinc-500">
        ANNUAL FUNCTION 2026
      </h2>
      <p className="mt-3 text-xl font-semibold text-zinc-900">{studentName}</p>
      <p className="mt-1 text-sm text-zinc-600">
        Invitation:{" "}
        <span className="font-mono font-semibold text-zinc-900">{code}</span>
      </p>
      <p className="text-sm text-zinc-600">Guests: {guestCount}</p>

      <div className="mt-5 flex justify-center">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={`Entry QR code for invitation ${code}`}
            className="h-56 w-56 rounded-xl border border-zinc-200"
          />
        ) : (
          <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
            Generating QR…
          </div>
        )}
      </div>

      <p className="mt-5 text-sm font-medium text-zinc-700">
        Present this QR code at entry.
      </p>
    </section>
  );
}
