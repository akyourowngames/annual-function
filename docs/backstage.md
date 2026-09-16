# Backstage — how the organizers' assistant is built

Backstage is the voice assistant the event team talks to while the function is
running: *who hasn't arrived, how many are coming, set the limit for 5TH DAISY
to six, add Sumita as a parent.* This document explains how it is put together
and, more usefully, **why** each piece is the way it is. The operational README
is [`../agent/README.md`](../agent/README.md); this is the design behind it.

## Why there are two assistants

The product talks to two very different people, and they get different machines.

| | Families | Organizers |
|---|---|---|
| Where | Telegram, WhatsApp | A page on the organizers' own machine |
| Answers from | The helpdesk, RAG over school documents | Live SQL over the roster |
| Can change data | Their own guests, RSVP | Anything, after confirming |
| Built in | Next.js (`web/lib/server/telegram`, `.../whatsapp`) | Python + FastAPI (`agent/`) |

They are separate because a family asking "when is the function" should never
share a process, a key, or a failure mode with a tool that can move 400 guest
limits. The family bot is a guarded, narrow reader. Backstage is a broad,
confirming operator.

The one rule both live by: **the AI proposes, the system disposes.** No model
ever writes to the database. It asks an API that enforces the rules, or it asks
a human first, or both.

## The shape of it

```text
   organizer 🎙️
      │  voice or typing
      ▼
  static/index.html ──────────────► /api/transcribe ──► Groq Whisper
   records audio, plays MP3          (raw body, no form)      │
      ▲                                                      │ transcript
      │                                                      ▼
      │                                            run_turn() ── fast path ──► router.INTENTS
      │                                                │                          │
      │                                                │                    one tool, no model
      │                                                │                          │
      │                                           model path                      │
      │                                                │                          │
      │                                     llm.chain() ── Groq → NIM → Kilo     │
      │                                                │                          │
      │  /api/speak ◄── Edge TTS                       ▼                          ▼
      └──────────────  MP3                      tools.execute(name, args) ◄────────┘
                                                     │
                                        ┌────────────┴────────────┐
                                        ▼                         ▼
                                   db.py (read)            actions.py (write)
                                   read-only pool          → Next.js API with
                                   + TTL cache               ADMIN_ACCESS_KEY
```

## What happens on one question

`run_turn()` in `agent/main.py` is the whole lifecycle, and the order is the
point.

1. **An awaiting confirmation is dealt with first.** If the session holds a
   pending action, "yes" executes it, "no" cancels it, and anything else drops it
   — a new instruction always supersedes an old proposal.
2. **The fast path gets first refusal** (`agent/assistant/router.py`). A
   declarative table of eleven patterns maps a question to one tool. *"Who hasn't
   arrived yet"* is a database query and a sentence, with no model call at all —
   around 800 ms, and it works when every provider is down.
3. **Otherwise the model runs the show**, with all 27 tools available and up to
   three rounds of tool calls, several of them in parallel.

### The fast path is a router, not a script

`INTENTS` decides *which tool to run*. It never decides what the answer says.
The wording belongs to the model, which is handed the fetched data and asked to
phrase it. The templates underneath are a fallback for when no model is
reachable — mechanical on purpose, and clearly labelled as such in the code.

That split is what keeps the answers from sounding canned while keeping the
common questions instant.

## The tools

27 tools, in two kinds. The split is enforced by naming and by habit: nothing
that writes is ever called directly.

**13 readers** — `event_overview`, `briefing`, `what_needs_attention`,
`find_family`, `list_guests`, `checkin_status`, `unchecked_families`,
`rsvp_report`, `class_breakdown`, `open_tickets`, `album_status`,
`reachability`, `search_knowledge`.

**14 proposers** — announcements, ticket replies, the public gallery, check-in,
guest limits, sending invitations, creating a student, regenerating a pass,
enabling/disabling a pass, adding, removing and renaming a guest, checking in by
name, resending a pass.

A proposer does not act. It stores an intent on the session and returns the exact
sentence to read back:

```
organizer: change the parent on Harsh Gupta's invitation from Rahul to Sumita
Backstage: Rename Rahul to Sumita as parent on HARSH GUPTA's invitation
           (ANL-WZMCJN6FH2NQ38U6). Is that okay?
```

Only "yes" runs it, through `_execute_pending`, which calls `actions.py`, which
calls the Next.js API. The API then enforces the real rules — the guest limit
lives in a database transaction, not in a prompt.

## Audiences come from the roster, never from a list in the code

`agent/assistant/audience.py` exists because "send this to 3RD LOTUS" and "send
this to everyone" must not depend on anyone having typed the class names into
source code.

- *all*, *everyone*, *sab*, *sabhi* → the whole roster.
- Anything else is matched against whatever is in `students.class`, folded for
  case, spacing and punctuation, so "5th daisy" finds `5TH DAISY`.
- No match, or two possible classes → **it asks, and reads out the real class
  list.** A mis-heard voice command must never move the wrong 200 students.

The same principle runs through the whole agent: `identity.py` reads the school
name, event, venue and dates from the database, so nothing about the school
lives in a string literal. Change it in the staff workspace and the assistant
follows.

## Hearing and speaking

**Hearing** is `stt.py` — the page records with `MediaRecorder` and posts the
clip to `/api/transcribe`; Groq's Whisper turns it into words with the same key
as the brain. The page used to use the browser's own speech recognition, which
exists only in Chrome and Edge, uploads elsewhere, and gives up without saying
why. Whisper takes the browser's own webm/ogg/mp4 as it comes, so there is
nothing to convert and no audio library on the page. Language is left to
Whisper, because the roster mixes English and Hindi in one sentence.

Hands-free watches loudness rather than the recogniser: the clip ends about a
second after you stop talking, and a clip with no speech in it is thrown away
instead of being uploaded to be hallucinated over. The mic never opens while the
assistant is speaking.

**Speaking** is `tts.py` — Edge TTS neural voices, free and keyless, streamed as
MP3 so playback starts before the sentence has finished being generated.

The family bots get their own Whisper path and, deliberately, **their own Groq
key** (`GROQ_VOICE_API_KEY`): a busy function hall must not exhaust the
organizers' quota.

## When a model misbehaves

Answers are not taken on trust.

- **Truncation is visible.** `llm.complete` reports `finish_reason`, so a
  response cut off mid-sentence is asked again with more room rather than being
  read to the organizer half-finished.
- **Wording is checked before it is spoken.** A phrasing that is too short, too
  long, all digits, or that leaks reasoning ("we must", "the user") is rejected
  and the template is used instead.
- **The chain falls through.** Groq `openai/gpt-oss-20b` → `gpt-oss-120b` →
  NVIDIA NIM → free Kilo models. Phrasing deliberately excludes NIM, whose
  reasoning models are slow and sometimes think out loud.
- **Zero is an answer, not noise.** Zeros are pruned from the data before
  phrasing, but when *everything* is zero the payload says so explicitly, so
  "how many have arrived" gets "nobody has arrived yet" rather than "there is
  nothing to report".

## Running it

```bash
cd agent
python serve.py            # NOT `uvicorn main:app` — see below
```

`serve.py` is not decoration: psycopg's async connections cannot run on
Windows' default Proactor event loop, and `config.py` sets the selector policy
before any loop exists. `uvicorn main:app` bypasses that and hangs on Windows.

On the organizers' laptop it listens on `127.0.0.1` by default. Put it on
`0.0.0.0` to reach it from a phone on the venue Wi-Fi — the microphone then
needs HTTPS, because browsers block it on a plain `http://` LAN origin.

## Testing

```bash
cd agent && pytest tests -q      # routing, templates, audiences, hearing
```

25 tests, all offline. They cover the things that are easy to get wrong and
expensive to get wrong in a hall: class-name matching that must fail safe,
templates that must be grammatical with any numbers, and the refusal paths in
the hearing module.

The rest was verified against the live roster — real questions, real SQL, real
Groq calls — because that is the only way to know whether an answer *sounds*
right.

## What is deliberately not done

- **Sessions are in-memory.** One organizer, one session, no persistence — this
  is a live backstage tool, and conversation state is not data.
- **The agent's database access is read-only.** Every write goes through the
  Next.js API, which owns the rules.
- **No action without confirmation.** There is no "just do it" mode, by design.
- **The family's pass is not editable beyond guests.** Parents are stored as
  guests with a relationship, which is why the assistant renames one rather than
  inventing a separate parent record.
