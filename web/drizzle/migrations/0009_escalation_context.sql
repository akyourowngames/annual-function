-- Smarter escalation: staff-facing summary + a ready-to-send reply, the origin
-- of the ticket, and the family's invitation code for one-tap replies.
alter table support_tickets add column if not exists ai_summary text;
alter table support_tickets add column if not exists suggested_reply text;
alter table support_tickets add column if not exists source text not null default 'manual';
alter table support_tickets add column if not exists invitation_code text;
