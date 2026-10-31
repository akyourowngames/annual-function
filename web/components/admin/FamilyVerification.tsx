"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";

// Approve the contact that will receive a family's verification code.
//
// An OTP is only a possession factor when it goes to a destination the school
// itself verified. A messaging endpoint learned from a chat identity match is
// not — anyone who knows a student's admission number, name and class can claim
// it. This panel is how staff make that judgement for the families in their
// charge, and how they replace a lost or compromised contact afterwards.
export default function FamilyVerification() {
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "telegram">("whatsapp");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<{
    verified: boolean;
    contact: { channel: string; destination: string; verifiedAt: string } | null;
  } | null>(null);

  // Look up the current state so staff can see whether this family can already
  // self-verify, without guessing or re-approving blindly.
  async function lookUp(value: string) {
    const clean = value.trim().toUpperCase();
    if (!clean) return;
    setError("");
    try {
      setStatus(
        await api(`/api/family/contact?code=${encodeURIComponent(clean)}`),
      );
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Could not check this code.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{
        contact: { channel: string; destination: string } | null;
      }>("/api/family/contact", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          channel,
          address: address.trim(),
        }),
      });
      setNotice(
        r.contact
          ? `Verified. Verification codes will go to ${r.contact.destination}.`
          : "Saved.",
      );
      setAddress("");
      await lookUp(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this contact.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/family/contact", {
        method: "DELETE",
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      setNotice("Verified contact removed. This family cannot self-verify until a new contact is approved.");
      await lookUp(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="section-heading">
          <h2>Verify a family&apos;s contact</h2>
          <Icon name="shield" />
        </div>
        <p className="caption">
          Add the WhatsApp number or Telegram chat your school has confirmed
          belongs to this family. It is the only destination that can receive a
          verification code, so a family member is the only person who can open
          the invitation, see the guest list, or download the QR pass.
        </p>
        <form onSubmit={submit} className="space-top">
          <div className="form-grid">
            <label className="field">
              <span>Invitation code</span>
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setStatus(null);
                }}
                onBlur={(e) => void lookUp(e.target.value)}
                required
                maxLength={64}
                autoComplete="off"
                placeholder="ANL-…"
              />
            </label>
            <label className="field">
              <span>Channel</span>
              <select
                value={channel}
                onChange={(e) =>
                  setChannel(e.target.value === "telegram" ? "telegram" : "whatsapp")
                }
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
              </select>
            </label>
            <label className="field">
              <span>
                {channel === "whatsapp"
                  ? "WhatsApp number (with country code)"
                  : "Telegram chat ID"}
              </span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                maxLength={200}
                autoComplete="off"
                placeholder={channel === "whatsapp" ? "+91…" : "123456789"}
              />
            </label>
          </div>
          <div className="button-row space-top">
            <button className="button primary" disabled={busy || !code.trim()}>
              {busy ? "Saving…" : "Approve this contact"}
              <Icon name="arrow" size={15} />
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy || !code.trim()}
              onClick={remove}
            >
              Remove contact
            </button>
          </div>
        </form>
        {status && (
          <p
            className={`notice ${status.verified ? "success" : ""} space-top`}
            role="status"
          >
            {status.verified && status.contact ? (
              <>
                <strong>Verified contact on file:</strong>{" "}
                {status.contact.channel === "telegram" ? "Telegram" : "WhatsApp"}{" "}
                {status.contact.destination}. This family can open its invitation.
              </>
            ) : (
              <>
                <strong>No verified contact.</strong> This family cannot
                self-verify or receive a QR pass until one is approved below.
              </>
            )}
          </p>
        )}
        {error && (
          <p className="notice error space-top" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice success space-top" role="status">
            {notice}
          </p>
        )}
      </section>
      <section className="panel" style={{ marginTop: 0, alignSelf: "start" }}>
        <h2>What this protects</h2>
        <ul className="info-list">
          <li>
            <Icon name="ticket" />
            <div>
              <strong>The guest list and QR pass</strong>
              <p>
                Both stay hidden until someone proves control of the verified
                contact.
              </p>
            </div>
          </li>
          <li>
            <Icon name="shield" />
            <div>
              <strong>An invitation code is not enough</strong>
              <p>
                Printed codes get shared. Knowing one no longer opens a
                family&apos;s details.
              </p>
            </div>
          </li>
          <li>
            <Icon name="users" />
            <div>
              <strong>Recovery without guesswork</strong>
              <p>
                If a family loses access, approve a new contact here instead of
                loosening the rules.
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
