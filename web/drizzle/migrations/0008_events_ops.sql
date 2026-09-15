-- Event-ops foundation: RSVP, per-gate check-in, reachable contacts, outbound
-- message log, and announcements/reminders. All additive + idempotent.

-- RSVP / expected headcount.
alter table invitations add column if not exists rsvp_status text not null default 'pending';
alter table invitations add column if not exists rsvp_guests integer;
alter table invitations add column if not exists rsvp_note text;
alter table invitations add column if not exists rsvp_at timestamptz;

-- Which gate recorded an entry (for the live dashboard).
alter table check_ins add column if not exists gate text;

-- A family's reachable messaging endpoints (we only learn these when they
-- message the bot and verify their invitation).
create table if not exists invitation_contacts (
  invitation_code text primary key references invitations(invitation_code) on delete cascade,
  channel text not null,
  address text not null,
  opted_in_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every outbound message we attempt, for delivery reports + retries.
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  ref_id uuid,
  invitation_code text,
  channel text not null,
  address text not null,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists deliveries_kind_idx on deliveries (kind, created_at desc);
create index if not exists deliveries_code_idx on deliveries (invitation_code, created_at desc);
create index if not exists deliveries_announcement_idx on deliveries (ref_id);

-- Announcements + scheduled reminders.
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text,
  body text not null,
  audience text not null default 'all',
  status text not null default 'draft',
  send_at timestamptz,
  is_reminder boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists announcements_due_idx on announcements (status, send_at);
