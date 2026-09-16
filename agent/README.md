# 🎙️ Backstage — the event team's voice assistant

A private assistant for the people running the annual function. Speak (or type)
a question, get a short spoken answer from **real event data** — invitations,
guests, RSVPs, gate arrivals, support requests, the photo album — and, when you
confirm out loud, let it **act**: send an announcement, reply to a request,
publish the gallery, check a family in.

```bash
cd annual-function/agent
python -m venv .venv && .venv\Scripts\activate      # or: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                                # then fill it in
python serve.py                                     # http://127.0.0.1:8000
```

> Use `python serve.py`, not `uvicorn main:app`. On Windows uvicorn's CLI
> installs a Proactor event loop, which psycopg's async connections refuse.

Open <http://localhost:8000>, paste your `ASSISTANT_KEY`, and talk. The mic
button is hold-to-talk; there is a text box underneath for noisy halls.

## Why it feels instant

Two paths, chosen per question:

| Path | What it does | Latency |
| --- | --- | --- |
| **Fast path** | Matches the question to a tool, runs it, then has the model word the answer in one sentence | **~0.5s** |
| **Tool loop** | Full model reasoning with tool calling — for drafts, open questions and actions | ~1.2–2.5s |

The fast path matters because most questions are lookups. Routing is a small
declarative table (it only chooses *which* tool to run); the **wording is the
model's**, so answers change with the data and read naturally. If no model is
reachable it falls back to plain templates so the assistant still answers.

Measured on this build (Groq `openai/gpt-oss-20b`):

```
"Give me the brief."            ~600 ms after warm-up
"How many can we reach?"        ~500 ms
"Find Ayaansh Rai."             ~500 ms
"Draft an announcement…"        ~2.1 s (model + confirmation)
"yes" (execute the action)      ~1.4 s (API call)
```

Startup warms the database pool, the cache, the model connection **and** the
staff session, so the first question is not the slow one.

## Models

Groq is primary (LPU hardware, free tier, no card — `console.groq.com/keys`),
NIM second (your existing key), the Kilo gateway last. Swap any of them with
environment variables; the code never hardcodes a provider.

Groq's open models are reasoning models, so we send `reasoning_effort: low` —
that removed both the latency and a nasty failure mode where the model narrated
its own thinking into the answer.

## Tools

Reads hit Postgres directly through one small pool:

`event_overview` · `briefing` · `what_needs_attention` · `find_family` ·
`list_guests` · `checkin_status` · `rsvp_report` · `class_breakdown` ·
`open_tickets` · `album_status` · `reachability` · `search_knowledge`

Actions only ever **propose**; the app performs them after you say yes:

`propose_announcement` · `propose_ticket_reply` · `propose_gallery` ·
`propose_check_in`

Confirmed actions call the Next.js APIs with the staff session, so every
business rule and validation still lives in one place.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | The same Supabase Postgres the app uses |
| `NEXTJS_BASE_URL` | Where the app lives (actions call its APIs) |
| `ADMIN_ACCESS_KEY` | Staff access key — enables confirmed actions |
| `ASSISTANT_KEY` | What organizers type on the page. Change it |
| `GROQ_API_KEY` / `GROQ_MODEL` | Primary brain (`openai/gpt-oss-20b`) |
| `GROQ_REASONING_EFFORT` | `low` by default; `""` to disable |
| `NVIDIA_API_KEY` / `NIM_MODEL` | Second brain |
| `FALLBACK_API_KEY` / `FALLBACK_MODELS` | Kilo gateway, last resort |
| `PHRASE_MODE` | `model` (natural) or `template` (instant, offline) |

## Checks

```bash
python smoke.py                      # every read tool against the real database
python ask.py "give me the brief"    # one turn through the full pipeline
pytest tests -q                      # routing, templates, identity
```

## Notes

- **Microphone needs a secure context.** `localhost` works out of the box. For
  phones on the venue Wi-Fi, put it behind HTTPS (a `cloudflared`/`ngrok` tunnel
  is the quickest path) — browsers block the mic on plain `http://` LAN origins.
- **STT/TTS come from the browser** (Web Speech API + `speechSynthesis`), so the
  server stays free of audio dependencies. Groq also offers Whisper for
  transcription and Orpheus for speech on its free tier — a good upgrade if you
  later want server-side voice.
- The database access here is read-only. Everything that writes goes through the
  app's APIs.
