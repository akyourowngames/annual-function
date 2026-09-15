-- Family-contributed photos for the event album. Files live in the private
-- Supabase Storage bucket; this table tracks the metadata + moderation state.
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  invitation_code text,
  channel text not null,
  address text,
  storage_path text not null,
  mime text,
  byte_size integer,
  caption text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists photos_created_idx on photos (created_at desc);
create index if not exists photos_code_idx on photos (invitation_code);
create index if not exists photos_status_idx on photos (status, created_at desc);
