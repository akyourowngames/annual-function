# AGENTS.md — how to talk to me

## Who I am

I am **12 years old** (class 4th level reading). **I am not a coder.**
I do not know what "bucket", "anchor", "idempotent", "fail-closed",
"blast radius", "surface", "bypass", "vector", or "mitigation" means.

## Rule 1 — Use simple words. Always.

Write like you are explaining to a smart kid, not to an engineer.

- **Short sentences.** One idea per sentence.
- **Small words.** If a short word works, use the short word.
- **No jargon.** Never use a technical word unless you explain it in the same
  breath, in plain words.
- **Say what it means for me.** Not "the endpoint returns 401" but
  "the app says no, and nothing opens."

### Words to avoid, and what to say instead

| Do not say | Say instead |
|---|---|
| endpoint / route / handler | the page, or "when the app asks for…" |
| authentication | proving who you are |
| authorization | what you are allowed to do |
| IDOR | one family peeking at another family's stuff |
| bearer token | a pass that works for whoever holds it |
| rate limit | "only N tries per person" |
| bucket | a counter, or "one of the rules" |
| fail-closed | "if unsure, say no" |
| idempotent | "safe to run twice" |
| mitigation | the fix |
| attack vector | the way in |
| RLS | "the database lock" |
| migration | "the database change script" |

## Rule 2 — Explain like this

Use this shape for any explanation:

1. **What it is** — one sentence.
2. **A real-life example** — shop, door, lock, key, sweets, school bag.
   This is the most important part.
3. **What it means for me** — do I need to do something, yes or no?
4. **If yes** — the exact steps, numbered, copy-paste ready.

## Rule 3 — Never make me repeat myself

If I ask "what do you mean", that is **my** signal that you failed, not mine.

- When I say "simpler", rewrite the *same* answer simpler. Do not add new
  technical content.
- If I ask the same thing twice, answer it again plainly. Do not say
  "as I mentioned".
- Do not tell me to read code or docs to understand. Read them for me and
  tell me the answer.

## Rule 4 — Be honest, plainly

- If something is not done, say **"not done"** — do not describe it as
  "partially complete".
- If you did not test something, say **"I did not test this"**.
- If you are guessing, say **"I am guessing"**.
- Never use a fancy word to make a small thing sound big.

## Rule 5 — Tell me what to do, not what you did

At the end of any work, give me:

- **What I must do** (numbered steps I can follow)
- **What is still broken** (plain list)
- **What you were not able to check**

Skip the long list of files you changed unless I ask.

## Rule 6 — Write it in the changelog. Every time.

The folder `docs/changelog/` holds one file per day, named `YYYY-MM-DD.md`.

- **One day = one file.** Not one file per turn. If I already worked today,
  **add to the bottom** of today's file. Never make a second file for the same
  day.
- Make the file at the **end of the turn**, after the work is done.
- Write it for me, not for a coder: say what was wrong, what it means for me,
  and what changed. Use the same simple words as Rule 1.
- Include what is **still not done**.
- If a day already has a file, read it first, then add a new numbered section.

This way, one day is one page I can read, instead of 100 little files.

## Rule 7 — Never hardcode an answer. Let the AI think.

This is the rule I broke and it must not happen again.

**Never** write code that matches words in a question and returns a fixed reply.
That is not an assistant, it is a list of if-statements in a costume.

Forbidden, every time:

- `if (/venue/i.test(msg)) return "The venue is X"` — **no.**
- A list of patterns mapped to canned sentences — **no.**
- Deciding the reply with regex, then dressing it up as AI — **no.**
- Faking an answer because the model is slow or missing — **no.**

The right shape, and the only one:

1. **A guidance prompt** — one system prompt that tells the model who it is,
   how to behave, what to answer from, and what never to invent. Written once.
2. **Tools** — small functions that fetch real data (`get_invitation`,
   `search_event_information`, `list_my_guests`). The model decides when to call
   them and which ones.
3. **The model writes the words.** Every reply, in every language, for every
   question.

If something is slow, fix the cause — a smaller prompt, a faster model, a
shorter timeout, fetch-on-demand instead of pre-loading. **Do not replace the
model with a lookup table.** Speed is not a reason to fake intelligence.

If the model is genuinely unavailable, say so **plainly** and show the school's
own published text. Never pretend a regex is an answer.

See `C:\Users\anime\3D Objects\copilot-chat\AGENTS.md` — that is the standard:
"no hardcoded values, ever", and `src/core/agent.mjs` shows the correct shape,
`buildSystemPrompt()` plus tools.

## Rule 8 — No magic numbers. Name them.

A number with no name is a decision nobody can find later.

- **Hoist it.** Timeouts, token limits, character caps, item counts and cache
  windows go in `web/lib/server/llm-tuning.ts` (for the assistant) or a named
  constant beside the code that uses it.
- **Say the unit and the why.** `perAttemptMs()` not `8000`; the comment explains
  that a healthy model answers in 1–2 s so 8 s means "give up and try the next".
- **Make it overridable** from the environment when an operator might reasonably
  want to change it without a deploy.
- **Check the diff** before finishing: every literal you added must justify why
  it is not a constant. `0`, `1`, and `-1` for indexing are fine; `8000` is not.

## Rule 9 — Verify by running it, and say how sure you are.

- **Nothing is done until it is executed.** Typecheck and "it looks right" are
  not verification. Run the test and a live round trip of the path you changed.
- **Measure, do not guess.** When something is slow or broken, get numbers
  first. Say which numbers came from a real run and which are estimates.
- **Reproduce before fixing.** Show the failing behaviour, fix it, then re-run
  the same thing and show the before and after.
- **New behaviour gets a test**, and the test must fail without the fix.
- **End every report with `Confidence: X/100`** and a short +/- ledger, each
  line tied to a concrete fact: `+live round trip measured`, `−production build
  not run`. Never inflate it to please me; say what would earn the next +5.
- If a test fails because your change was wrong, that is the test working. Fix
  the code, not the assertion — unless the assertion itself was the mistake, and
  then say so plainly.

## Rule 10 — Keep the whole thing working.

- **Read a file before editing it.** Never guess at existing code.
- **Do not break the suite.** Run the tests the change touches. A test that was
  already failing gets reported, not ignored.
- **No scope creep.** Fix what was asked. Adjacent problems go in the changelog
  as findings, not silently into the diff.
- **Say what you did not do.** Unrun builds, untested paths, and skipped checks
  are part of the report, not a footnote you leave out.

---

# About this project (plain words)

**What it is:** a website for a school function. Families get a ticket with a
QR code. They show the QR at the gate to come in.

**Three doors:**
- `/` — the fun public page. Anyone can look.
- `/portal` — for one family. Private. Needs the invitation code + a 6-digit
  code sent to their phone.
- `/admin` — for the school team. Also `/gate` for the door staff.

**Two big ideas to remember:**
1. **The invitation code alone is not enough.** Printed codes get shared. So we
   also send a 6-digit code to the family's phone. Both are needed.
2. **The code only goes to a phone the school has checked.** That is why staff
   must add each family's number in `/admin` → **Verify a family** before that
   family can open their ticket.

**Where things live:**
- `web/` — the whole website
- `web/docs` link → `docs/` — notes for humans
- `docs/security/RUN-THIS-SQL.md` — **the database steps I still have to run**
- `agent/` — the voice helper (not needed for the website to work)

**Checks before saying "done":**
- `cd web && npx tsc --noEmit`
- `cd web && npm run lint`
- `cd web && npm test` (or the list in `.github/workflows/ci.yml`)
- `cd web && npm run build`
