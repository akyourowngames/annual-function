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

Staff can sign in using Supabase email/password accounts with `app_metadata.role` set to `admin` or `staff` by a trusted administrator. User-editable metadata does not grant access. Administrators may alternatively configure a long, random `ADMIN_ACCESS_KEY` for the access-key login. No default password or access key is shipped.

Staff sessions use HttpOnly cookies. Publishing official event information, editing the landing page, managing invitations and changing guest allowances require the administrator role. Gate check-in and ticket handling require an authorized staff session.

## Editing the landing page

Open **Staff workspace → Event & knowledge → Public landing page**. Edit the school name, headline, introduction, contact and accessibility guidance, chief guests, and programme. Publish to save these details in the existing event settings row. Clear **Show demo content labels** only after the details are confirmed.

Until edited, the page uses Oakfield Public School and an explicitly labelled demo guest lineup and programme. Date, start time, venue, parking, dress code and entry instructions come from **Official event information**. The paper-theatre artwork is a local asset in `web/public/landing/`.

The landing page includes scroll reveals, a three-star hunt, confetti, optional sounds, a calendar download, programme and FAQ accordions, and a mobile invitation dock. Sounds start off. Reduced-motion preferences disable movement while retaining content and actions.

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

## Remaining integrations

WhatsApp/Telegram delivery, vector embeddings, hosted PDF storage, and deployment are not connected by this implementation. The Python agent directory is an earlier scaffold; the working helpdesk runs in the Next.js API. No messages are sent automatically during development.
