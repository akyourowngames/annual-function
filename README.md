# ✨ annual.

> **A sky full of stories.**
> The school annual function — but every family gets a golden ticket, every
> guest is counted, every gate scan takes a second, and a friendly AI answers
> the questions so teachers don't have to.

One system, three doors:

| Door | Who walks in | What they find |
|---|---|---|
| **`/`** | Everyone | The public celebration page — paper theatre, chief guests, programme, a three-star hunt 🌟 |
| **`/portal`** | Families | Their private invitation, QR pass, guest registration, AI helpdesk, support desk |
| **`/admin`** | The event team | Every student (all 467 of them), invitations, guest lists, gate check-in scanner, support requests, bulk guest-limit editing |

**Live:** https://annual-five.vercel.app

There is a fourth door, and it never leaves the organizers' laptop:
**Backstage**, a private voice assistant over the same database — *who hasn't
arrived, set the limit for 5TH DAISY to six, add Sumita as a parent.* It answers
from the live roster in under a second and changes nothing until it has read the
change back. Design and reasoning: [`docs/backstage.md`](docs/backstage.md).

---

## 🎪 What it does

- **Real roster, not demo data.** 467 students from the school workbook, each
  with a unique invitation code (`ANL-…`) and a QR pass. Admission numbers keep
  their leading zeros.
- **Find my invitation.** A student types their admission number, full name and
  class — all three must match school records — and the chat hands back their
  code. The AI can *relay* it, never *invent* it. Attempt limits stop guessing.
- **Guest limits are law.** Enforced in the database inside a transaction. No
  AI, browser, or double-click race can sneak a 5th guest past a limit of 4.
- **Gate check-in.** Staff scan the QR; the system knows who's already inside.
  Disabled passes bounce at the door.
- **Mass editing for the office.** Select all students (or search a class and
  select those), set one guest limit, apply once. Students who'd be broken by
  the change are skipped and reported, never silently damaged.
- **A landing page that plays.** Scroll reveals, confetti, optional sounds, a
  paper-theatre stage, programme and FAQ accordions — all editable from the
  staff workspace without touching code.

## 🚀 Run it locally

```bash
cd web
npm ci
cp .env.example .env.local   # fill in DATABASE_URL + Supabase keys
npm run dev                  # → http://localhost:3000
```

Need the database tables? `0000_melted_veda.sql` creates them from scratch,
and `node scripts/migrate-product.mjs` + `node scripts/migrate-landing.mjs`
add the knowledge base and landing content to an existing one. Both are
idempotent. The full playbook lives in
[`docs/running-the-product.md`](docs/running-the-product.md).

**Staff sign-in** uses either a Supabase account with the right role or an
`ADMIN_ACCESS_KEY` (the "Access key" tab at `/admin`). No key ships with the
repo — set a long, random one yourself.

## 🧰 The toolbox

| Command | What it does |
|---|---|
| `npm run dev` | Local server with Turbopack |
| `npm run test:e2e` | 30 product checks: capacity races, entry, QR, PDF, staff UI… |
| `npm run seed` | Event settings only — students come from the real roster |
| `npm run studio` | Drizzle Studio over the live database |
| `node scripts/import-students.mjs` | Import the roster: `--dry-run` → `--apply` → `--verify` |
| `python scripts/test_student_roster.py` | Workbook extraction checks |
| `node --test scripts/identity-test.mjs` | Identity-matching & recovery checks |
| `cd agent && pytest tests -q` | Backstage: routing, templates, audiences, hearing |

## 🗺️ How it's wired

```text
        families 🎟️                    staff 🎛️
       /portal + chat                 /admin
            │                           │
            ▼                           ▼
        Next.js API routes  ──  business rules live HERE
            │                           │
   ┌────────┴────────┐                  │
   ▼                 ▼                  ▼
Supabase        OpenAI helpdesk    qrcode → PDF passes
PostgreSQL      (proposes only —
 + Drizzle       humans confirm)
```

Rules of the house:

1. The **AI proposes, the system disposes.** A guest is registered when the
   family confirms and the database says yes — never because a model felt
   confident.
2. **QR codes carry an opaque token**, never names or admission numbers.
3. **One student, one invitation.** Codes are unique, regenerable, and
   revocable.
4. **A code is not an identity.** Family data needs the invitation code *and* a
   6-digit OTP sent to a contact the school has verified. See
   [`docs/security/04-family-verification.md`](docs/security/04-family-verification.md).
5. **Admissions are atomic.** A guest can only be checked in once, enforced by a
   transaction lock and a database unique index.

## 🔐 Security

The full assessment, threat model, findings and verification architecture live in
[`docs/security/`](docs/security/):

- [`01-attack-surface.md`](docs/security/01-attack-surface.md)
- [`02-threat-model.md`](docs/security/02-threat-model.md)
- [`03-findings.md`](docs/security/03-findings.md)
- [`04-family-verification.md`](docs/security/04-family-verification.md)
- [`05-final-report.md`](docs/security/05-final-report.md)

Before deploying the verification flow, apply
`web/drizzle/migrations/0004_family_verification.sql` and set
`FAMILY_SESSION_SECRET` / `FAMILY_OTP_SECRET` (see `web/.env.example`).

## 📁 The map

```text
annual-function/
├── web/     ← the whole product (Next.js, TypeScript, Tailwind, Drizzle)
│   ├── app/          / · /portal · /admin · /api
│   ├── components/   portal, admin, landing, invitation UI
│   ├── lib/          db schema, server rules, invitation identity
│   ├── scripts/      import, migration, and test runners
│   └── docs link →   ../docs/running-the-product.md
└── agent/   ← Backstage: the organizers' voice assistant (Python/FastAPI)
               27 tools over the live roster, Whisper in, Edge TTS out
               → ../docs/backstage.md
```

## 🎟️ The story so far

- [x] Invitations, QR passes, guest registration with hard limits
- [x] Staff workspace + admin powers + bulk guest-limit editing
- [x] AI helpdesk with verified invitation recovery
- [x] Real roster import: 467 students, 12 classes, zero demo data
- [x] Playful landing page, editable by staff
- [x] Telegram agent live; WhatsApp webhook built (awaiting Meta templates)
- [x] Semantic knowledge base: staff PDF/doc upload + NVIDIA embeddings on pgvector
- [x] RSVP & expected headcount, announcements/reminders, bulk pass delivery
- [x] Live attendance wall with per-gate and per-class counts
- [x] Real Everest Public School profile (logo, contact, leaders, Principal's note)
- [x] Smarter escalation: staff summary + a one-tap reply drafted for every request
- [x] Candid event album: families send photos to the bot, staff review in the workspace
- [x] Public `/gallery` page staff can publish or hide, showing approved photos only
- [x] Gate keeper role: a scanner-only key for the door team
- [x] Backstage: the organizers' voice assistant — answers from the live roster in
      under a second, and changes data only after it reads the change back
- [x] Voice notes on every chat: Whisper turns a family's recording into the same
      conversation, with a `Heard: "…"` echo so a mis-hearing is visible

---

Made with confetti for the people who turn little dreams into a very big evening. 🌟

