# mcp — the assistant's window into the school function

This folder lets the **Ankita** assistant look at the event and make a few safe
changes, by talking to a small program that starts when Ankita needs it.

**The one rule:** this program never writes to the database. It reads for
reports, and for anything that changes, it signs in as its own school account
and asks the website to do it. So the guest limit still lives in the database
transaction, a family can't be checked in twice, and every change is written
into the activity log with the right name. Same rule as the older Backstage
assistant in `../agent/`: *the AI proposes, the website disposes*.

## What it can do

**Look (runs on its own, no permission needed):**

| Tool | Answers |
|---|---|
| `event_overview` | How many families, guests, and how many are inside. |
| `who_did_what` | The activity log — who did what, when, which family. |
| `recent_checkins` | The last people let in at the gate. |
| `unchecked_families` | Families who have not arrived yet. |
| `attendance_by_class` | Headcount per class. |
| `rsvp_report` | Who said yes, and the expected headcount. |
| `open_tickets` | Support messages not yet resolved. |
| `recent_announcements` | Did the message actually go out. |
| `guest_limit_preview` | What a limit change WOULD do, without doing it. |
| `site_status` | Whether the website that carries out changes is awake. |

**Change (asks once, then acts):**

| Tool | Changes |
|---|---|
| `check_in_family` | Marks a family as arrived. |
| `set_guest_limit` | One family's guest limit. |
| `set_guest_limit_bulk` | A class, or everyone, **in one request**. |
| `set_gallery` | Shows or hides the public photo gallery. |

**Change — always asks, in full (these reach real people):**

| Tool | Changes |
|---|---|
| `send_announcement` | Sends one message to a class or everyone. |
| `reply_to_ticket` | Answers a family's support message. |

### Why bulk exists

Changing 468 families one at a time is 468 requests. If one fails halfway, the
school is left with half the children on one limit and half on another. The
website can do the whole set in a single transaction, so the tool does too.
Families already holding more guests than the new limit are **skipped and named**,
never quietly lowered.

## Setting it up

1. **Make Ankita's own account.** In Supabase, add a user with an email and a
   password, and set its role to `staff` — the same way team accounts are made.
   This is what makes the log say *ankita* instead of *the admin*.

2. **Write the settings file.** Copy `env.example` to `.env.local` and fill it
   in. It must stay on this machine only; it holds a password.

3. **Install.** From this folder:

   ```bash
   npm install
   ```

4. **Turn on the cleanup of the old log** (once):

   ```bash
   cd ../web
   node scripts/migrate.mjs drizzle/migrations/0013_audit_log_retention.sql
   ```

5. **Connect Ankita.** Do not use `/mcp add`: it splits on spaces, and this
   folder's path contains "3D Objects", so the command would break. Instead run
   this once from this folder — it prints the exact entry, with the approval
   stamp Ankita needs:

   ```bash
   npm run print-config
   ```

   Paste the printed object into `~/.copilot-chat-cli/mcp.json`, inside the
   `"servers"` list. If that file does not exist, create it as:

   ```json
   { "version": 1, "servers": [ PASTE_HERE ] }
   ```

   Ankita only starts a server whose command matches an approval stamp. The
   printed entry already carries one, so it starts on the next reload. If you
   edit the path by hand afterwards, the stamp no longer matches and Ankita
   will silently skip it — run the command again instead.

   Restart Ankita, then ask: *"how are we doing today?"* If she answers with
   real numbers, it is connected.

## Settings

| Name | What it is | Default |
|---|---|---|
| `DATABASE_URL` | The event database. Needed for reports. | none |
| `NEXTJS_BASE_URL` | Where the website lives, for changes. | `http://127.0.0.1:3000` |
| `ANKITA_EMAIL` | Ankita's school account email. | none |
| `ANKITA_PASSWORD` | That account's password. | none |

## The one thing that will stop changes

Reports read the database directly, so they always work. Changes need the
**website running with its database**, because the website is what enforces the
rules.

If a change fails, ask for `site_status` first — it says which of three things
is wrong:

| It says | What to do |
|---|---|
| Nothing listening | `cd web && npm run build` once, then `npm start` |
| Running, no database | Give the site the same `DATABASE_URL` |
| Running with database | Try the change again |

Do not point `NEXTJS_BASE_URL` at a site whose database is not configured: it
will answer, but every change will fail.

## Checking it works

```bash
npm test
```

31 checks, all offline: the handshake, the tool list, the honesty labels, the
login/retry plumbing, the shutdown race, and that the printed config carries a
valid approval stamp. One is skipped unless a database is configured: the
"does a real query survive shutdown" case, which is worth running once with a
real `DATABASE_URL`.

## What is still rough

- `NEXTJS_BASE_URL` defaults to your own computer. To use the deployed site,
  set it to the live address.
- The password is a file on your laptop. If other people use this laptop, this
  needs a different plan.
- Reports can only see the last **90 days**, because older activity is deleted
  each night.
