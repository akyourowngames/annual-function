# Running Annual

The application lives in `web/` and uses Next.js, Tailwind CSS, Drizzle, and PostgreSQL. The public celebration page is `/`, family invitations are at `/portal`, and the staff workspace is `/admin`.

## Local setup

Use Node.js 20.9 or newer. In `web/`, run `npm ci`, copy `.env.example` to `.env.local`, and fill the values from your existing services. Keep server credentials out of public environment variables.

For an existing database with the original schema, apply the additive updates:

```sh
node scripts/migrate-product.mjs
node scripts/migrate-landing.mjs
npm run dev
```

For a new database, apply `drizzle/migrations/0000_melted_veda.sql` first. The two scripts above are idempotent and preserve existing event and invitation records. They are explicit operational migrations; the original Drizzle journal currently tracks only the initial schema.

The normal preview is http://localhost:3000. If another development server is using that build directory, `node scripts/preview-server.mjs` starts an isolated preview at http://127.0.0.1:3100.

## Staff access

Staff sign in with Supabase email/password accounts whose `app_metadata.role` is `admin`, `staff` or `gate` (set by a trusted administrator — user-editable metadata never grants access). Alternatively configure long, random `ADMIN_ACCESS_KEY` and `GATE_ACCESS_KEY` values for key login. No default keys ship with the repo.

- **admin** — everything: invitations, guests, check-in, tickets, outreach, album, plus publishing official information, the landing page and the public gallery.
- **staff** — day-to-day operations: invitations, guests, gate check-in, ticket replies, announcements/reminders and album moderation.
- **gate** — gate keepers: the QR scanner only. They sign in at **`/gate`** (or the staff login) with the gate key, get a single scanner screen, can verify a pass and check guests in (`/api/check-in`); every other staff endpoint answers 403.

Sessions are HttpOnly cookies that carry the role. Publishing official event information, editing the landing page, changing guest allowances and publishing the public gallery require the administrator role.

## Editing the landing page

Open **Staff workspace → Event & knowledge → Public landing page**. Edit the school name, headline, introduction, contact and accessibility guidance, chief guests, and programme. Publish to save these details in the existing event settings row. Clear **Show demo content labels** only after the details are confirmed.

The page publishes Everest Public School's details — name, logo, contact, social links, leaders and the Principal's note — all editable from the workspace (`scripts/apply-school-profile.mjs` applies the evergreen defaults). Date, start time, venue, parking, dress code and entry instructions come from **Official event information**. The paper-theatre artwork is a local asset in `web/public/landing/`, and the school logo/principal photo live in `web/public/eps/`.

The landing page includes scroll reveals, a three-star hunt, confetti, optional sounds, a calendar download, programme and FAQ accordions, and a mobile invitation dock. Sounds start off. Reduced-motion preferences disable movement while retaining content and actions.

Student and staff screens share the same palette and display font. Shared Tailwind colour tokens live in `web/app/globals.css`; workspace cards, login layout, navigation, ticket treatment, and motion live in `web/app/workspace.css`. The header's star button triggers a small celebration. Navigation changes use a brief entrance, while data updates keep operational controls steady. Theatre images are served directly to avoid relying on Vercel's paid image optimizer.

## Invitations and helpdesk

Families use the private invitation code supplied by the school. A roll number alone does not unlock tickets or invitations. Each guest is registered against the invitation's allowance; school staff control changes to that allowance. The pass offers a QR image download and the browser's Print / Save as PDF flow.

The AI helpdesk uses `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. It retrieves published school information and invitation-scoped data. Guest and ticket actions are proposals that require the family's confirmation. If the model is unavailable, the UI identifies its official-information fallback. Published knowledge currently uses PostgreSQL full-text retrieval.

The server disables named prepared statements for compatibility with the Supabase transaction pooler. This is required for transactions to commit reliably; see [Supabase's connection guidance](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL).

## Verification

```sh
npm run lint
npm run build
node scripts/landing-check.mjs http://127.0.0.1:3100
npm run test:e2e
```

Browser checks use Playwright with Microsoft Edge installed on Windows. Landing checks need a running preview and the current demo event fixture (19 December 2026, 5:00 PM). The product test starts an isolated preview on port 3101, creates unique `QA-...` records, and removes only records allocated by that run in its cleanup block. It checks private access, capacity races, entry, support, QR rendering, PDF output, and staff navigation. Screenshots and test PDFs are written to ignored `web/artifacts/`.

The older `scripts/e2e-test.mjs` is not the npm test entry point; it predates isolated QA records and should not be run against a school database.

## Event operations (RSVP, outreach, live view)

- **RSVP & headcount** — families confirm attendance from the portal ("Will you join us?") or via the chat agent (`set_rsvp`). The admin **Live event** view shows response rate, expected guests and per-class headcount.
- **Reach families** (Staff workspace → Reach families) — bulk-send each family their PDF pass, and compose announcements/reminders with a live Telegram/WhatsApp preview, audience targeting (everyone / a class / not replied / attending) and scheduling.
- **Live event** — a self-refreshing wall: expected vs arrived, per-gate and per-class counts, hourly arrival trend and a recent-arrivals ticker.

Delivery needs a family's messaging endpoint, captured automatically the first time they verify their invitation in chat (`invitation_contacts`). Families who have never messaged the bot are reported as *not reachable* — that is a Telegram/WhatsApp platform rule, not a limitation of this system; share the bot link to bring them in.

Scheduled announcements are drained by `GET /api/cron`, authorized by either `CRON_SECRET` (Vercel Cron, defined in `web/vercel.json`) or an admin session. The Live dashboard also triggers it on every poll, so reminders fire on time during the event window even on plans with daily-only crons.

## Event album (family photos)

Professional photographers miss the candid moments. Families can send their own photos to the bot; each one is stored in a **private Supabase Storage bucket** (`ALBUM_BUCKET`, default `album`) and recorded in `photos` with status `pending`. Staff review them in **Staff workspace → Album** — approve, hide or delete (deleting removes the stored file too). Photos are never public: the workspace renders them through short-lived signed URLs, and nothing is shown anywhere else until a human approves it.

Requires `SUPABASE_SERVICE_ROLE_KEY` (server-only) in the environment; the bucket is created automatically on first upload. Telegram photos are live today (compressed, well inside the 20 MB bot download limit) — the bot accepts `message.photo` and image `message.document`, stores the photo, and replies with a confirmation. Non-image documents and other media are acknowledged and ignored. WhatsApp image ingest uses the same path but stays dark until the Meta phone number and token are configured.

## Public photo gallery (`/gallery`)

`/gallery` is a standalone public page — no login, linked from the landing footer. It renders only when staff publish it (**Staff workspace → Gallery → Publish gallery**, stored as `event_settings.gallery_enabled`, off by default). Even then it shows **approved photos only**, served as short-lived signed URLs from the private bucket; pending and hidden photos are never exposed. Unpublishing takes the page dark within a refresh (visitors see "the album isn't open yet"). Moderating (approve/hide/delete) requires staff; publishing requires an administrator. Families also get the same album as a **Photo album** tab in the student portal (same rules, portal styling).

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR: lint, `tsc --noEmit`, the unit suite, and a production build (placeholder env — no database needed). A `smoke` job runs `scripts/smoke.mjs` against the deployed app when the `SMOKE_URL` repository secret is set, and skips otherwise. Run it locally with `SMOKE_URL=https://annual-five.vercel.app node scripts/smoke.mjs`.

## Remaining integrations

Vector embeddings, hosted PDF storage, and scheduled reminders are not connected. The Python agent directory is an earlier scaffold; the working helpdesk runs in the Next.js API. WhatsApp and Telegram webhooks are implemented and deployed (see below); no messages are sent automatically during development.

## Messaging agent and its model

Both webhooks share one brain (`lib/server/helpdesk.ts`) reached through `lib/server/llm-client.ts`, which speaks OpenAI-compatible Chat Completions. It defaults to the **Kilo AI Gateway** with a fast free model, so it works with no code change and no paid key:

```env
LLM_BASE_URL=https://api.kilo.ai/api/gateway
LLM_API_KEY=<kilo api key>
LLM_MODEL=nex-agi/nex-n2.5-mini:free
```

Swap providers (OpenAI, OpenRouter, Groq, ...) by changing those three. If the primary model errors, times out, or returns empty, `chatCompletion` automatically fails over through `LLM_MODEL_FALLBACKS` (built-in free defaults if unset), so a model going dark never silences the bot. The Telegram bot is agent-first: any message goes to the model with tools (`get_invitation`, `list_my_guests`, `check_ticket_status`, `search_event_information`, `escalate_to_staff`, `register_guest`, `create_ticket`, `recover_invitation`); only `menu`/`help`/`start` shows the canned menu, and `1` starts invitation verification. `escalate_to_staff` logs a ticket for the event team immediately when the model cannot answer. When the model proposes `create_ticket`, the chat asks the family to confirm (`yes`/`no`) before anything is written. Replies are converted per channel by `lib/server/markdown.ts`: the model's Markdown becomes Telegram HTML (`parse_mode=HTML`, with a plain-text retry if Telegram rejects the entities) and WhatsApp markup (`*bold*`, `•` bullets), so families see real bold and lists instead of literal `**`. The agent also has a creator note: asked who built it, it credits EPS student Krish. If `LLM_API_KEY` is unset, the agent degrades to the labelled `official_information` fallback.

## Knowledge base (staff document upload -> RAG)

Staff upload documents from **Staff workspace → Event & knowledge → Upload a document**. Accepted types: **PDF**, **Word** (`.docx`, `.doc`), **HTML** (`.html`/`.htm`), **RTF**, and text-like files (`.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.log`). Anything else is rejected with the accepted list. The server extracts text per type (`unpdf` for PDF, `mammoth` for `.docx`, `word-extractor` for `.doc`, inline cleaning for HTML/RTF, UTF-8 decode for the rest), splits it into overlapping chunks, and stores them in `knowledge_sources` / `knowledge_chunks`. The agent's `search_event_information` / retrieval answers from those chunks.

Retrieval is hybrid and self-degrading: pgvector cosine search when an embeddings model is configured, then full-text (OR of the question's keywords), then a keyword `ILIKE` fallback. A natural-language question like "where is the backup generator?" matches on any keyword rather than requiring every word.

Vectors are **live via NVIDIA NIM** (OpenAI-compatible, free with an `nvapi-` key):

```env
LLM_EMBED_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_EMBED_MODEL=nvidia/nemotron-3-embed-1b   # 2048-dim
LLM_EMBED_API_KEY=nvapi-...
LLM_EMBED_DIM=2048
LLM_EMBED_INPUT_TYPE=1                          # send query/passage hints
```

Uploads are embedded as passages and questions as queries. The column is `halfvec(2048)` (float16) with an **HNSW index** (`halfvec_cosine_ops`) — pgvector's `vector` HNSW caps at 2000 dimensions, but `halfvec` supports up to 4000, so 2048-dim ANN search works. Migration `0007_knowledge_halfvec_hnsw.sql` sets this up. If `LLM_EMBED_MODEL` is unset, retrieval degrades to lexical automatically. Keep the key in Vercel secrets, never in the repo.

## WhatsApp agent (v1)

Webhook: `GET/POST https://<vercel-app>/api/whatsapp/webhook`, subscribe to `messages`.

1. Meta app → WhatsApp Business Account → phone number (test number first, production later).
2. Permanent access token → Vercel env `WHATSAPP_TOKEN`; plus `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any random string you invent), `WHATSAPP_APP_SECRET` (from Meta app settings).
**Production must always set WHATSAPP_APP_SECRET — when unset, the webhook skips signature verification (local dev only).**
3. Webhook: set URL + verify token, subscribe to `messages`. Confirm the GET challenge test in `scripts/whatsapp-e2e.mjs` passes against the deployed URL.
4. Get two utility templates approved before launch: `invitation_ready` (code + link) and `faq_followup` (reopens >24h chats). No marketing templates in v1.
5. Sandbox test with 2–3 real phones: Hi → 1 → admission + name + class → PDF + QR in chat → 2 FAQs (English + Hinglish).
6. LLM is wired by default to the Kilo AI Gateway (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; set `LLM_EMBED_MODEL` when embeddings arrive). No key = portal-style `official_information` fallback, same as `GET /api/agent`.
