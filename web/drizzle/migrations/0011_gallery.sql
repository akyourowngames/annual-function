-- Public photo gallery switch. Off by default: staff publish it deliberately,
-- and only approved photos are ever shown.
alter table event_settings add column if not exists gallery_enabled boolean not null default false;
