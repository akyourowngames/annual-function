"use client";
import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { api } from "@/lib/types";

// One-tap reply for a support request: edit the AI's suggested reply, send it
// straight to the family's chat, or copy it for another channel.
export default function TicketReply({
  id,
  suggested,
  onDone,
}: {
  id: string;
  suggested: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-top">
      <label className="field">
        <span>Suggested reply — edit before sending</span>
        <textarea
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          className="button small primary"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            setNote("");
            try {
              await api("/api/tickets", {
                method: "PATCH",
                body: JSON.stringify({ id, action: "reply", message: text }),
              });
              setNote("Reply sent to the family and the request is resolved.");
              onDone();
            } catch (e) {
              setNote(e instanceof Error ? e.message : "Could not send the reply.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="chat" size={15} /> Send reply
        </button>
        <button
          className="button small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setNote("Copy failed — select the text and copy manually.");
            }
          }}
        >
          <Icon name="mail" size={15} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {note && <p className="caption">{note}</p>}
    </div>
  );
}
