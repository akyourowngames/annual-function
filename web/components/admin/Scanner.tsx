"use client";
import { useEffect, useRef, useState } from "react";
import { api, type GuestInfo, type InvitationData } from "@/lib/types";
import Icon from "@/components/ui/Icon";
type ScanResult = {
  valid: boolean;
  invitationCode: string;
  status: string;
  guestLimit: number;
  checkIns: number;
  guests: GuestInfo[];
  studentName: string;
};
type Detector = {
  detect: (source: HTMLVideoElement) => Promise<
    {
      rawValue: string;
    }[]
  >;
};
export default function Scanner({
  onCheckIn,
}: {
  onCheckIn: () => Promise<void>;
}) {
  const [input, setInput] = useState(""),
    [token, setToken] = useState(""),
    [result, setResult] = useState<ScanResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true);
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    setCamera(false);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function verify(value: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      let qr = value.trim();
      if (qr.toUpperCase().startsWith("ANL-")) {
        const inv = await api<InvitationData>(
          `/api/invitations?code=${encodeURIComponent(qr.toUpperCase())}`,
        );
        qr = inv.invitation.qrToken;
      }
      const r = await api<ScanResult>(
        `/api/check-in?qrToken=${encodeURIComponent(qr)}`,
      );
      setToken(qr);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify invitation.");
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setError("");
    const DetectorClass = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => Detector;
      }
    ).BarcodeDetector;
    if (!DetectorClass) {
      setError(
        "Camera scanning is not supported by this browser. Use the invitation code or a USB QR scanner below.",
      );
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setCamera(true);
      const detector = new DetectorClass({ formats: ["qr_code"] });
      const scan = async () => {
        if (!alive.current || !stream.current) return;
        if (video.current) {
          if (video.current.srcObject !== media) {
            video.current.srcObject = media;
            await video.current.play();
          }
          if (video.current.readyState >= 2) {
            try {
              const codes = await detector.detect(video.current);
              if (codes[0]) {
                stop();
                setInput(codes[0].rawValue);
                await verify(codes[0].rawValue);
                return;
              }
            } catch {
              stop();
              setError(
                "Camera scanning failed. Enter the invitation code below.",
              );
              return;
            }
          }
        }
        timer.current = setTimeout(() => {
          void scan();
        }, 250);
      };
      void scan();
    } catch {
      stop();
      setError(
        "Camera access is unavailable. Allow camera permission or enter the invitation code below.",
      );
    }
  }
  async function checkIn(guestId: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/check-in", {
        method: "POST",
        body: JSON.stringify({ qrToken: token, guestId }),
      });
      const r = await api<ScanResult>(
        `/api/check-in?qrToken=${encodeURIComponent(token)}`,
      );
      setResult(r);
      setNotice("Guest checked in. Welcome to the evening!");
      await onCheckIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="section-heading">
          <h2>Welcome them in</h2>
          <Icon name="scan" />
        </div>
        <div className="scan-preview">
          {camera ? (
            <video ref={video} className="scan-video" playsInline muted />
          ) : (
            <div className="empty-state">
              <Icon name="scan" size={46} />
              <p>Scan an invitation to verify registered guests.</p>
            </div>
          )}
        </div>
        <button className="button full" onClick={camera ? stop : start}>
          {camera ? "Stop camera" : "Open camera scanner"}
        </button>
        <form
          className="space-top"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(input);
          }}
        >
          <label className="field">
            <span>Invitation code or QR token</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={100}
              placeholder="Scan or enter ANL-…"
              autoComplete="off"
            />
          </label>
          <button
            className="button primary full"
            disabled={busy || !input.trim()}
          >
            {busy ? "Verifying…" : "Verify invitation"}
            <Icon name="arrow" size={16} />
          </button>
        </form>
        <p className="security-note">
          <Icon name="shield" size={14} />
          Verification does not check anyone in automatically.
        </p>
      </section>
      <section className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
        <h2>Entry details</h2>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="notice success">
            {notice}
          </p>
        )}
        {result ? (
          <>
            <div className="section-heading space-top">
              <h3>{result.studentName}</h3>
              <span className={`badge ${result.valid ? "success" : "warning"}`}>
                {result.status}
              </span>
            </div>
            <p className="caption">
              {result.invitationCode} · {result.checkIns} checked in
            </p>
            {!result.valid && (
              <p className="notice error">
                This invitation is inactive. Entry is not allowed.
              </p>
            )}
            <ul className="guest-list">
              {result.guests.map((g) => (
                <li key={g.id}>
                  <span className="avatar">
                    {g.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{g.name}</strong>
                    <small>{g.relationship}</small>
                  </div>
                  <div style={{ marginLeft: "auto" }}>
                    {g.status === "checked_in" ? (
                      <span className="badge success">
                        <Icon name="check" size={12} />
                        Checked in
                      </span>
                    ) : (
                      <button
                        className="button primary small"
                        disabled={busy || !result.valid}
                        onClick={() => checkIn(g.id)}
                      >
                        Check in
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!result.guests.length && (
              <p className="notice">
                No guests registered. Ask the family to register their guests
                first.
              </p>
            )}
          </>
        ) : (
          <div className="empty-state">
            <Icon name="ticket" size={32} />
            <h3>Ready when they are</h3>
            <p>
              Verify a pass to see the guest list and check people in
              individually.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
