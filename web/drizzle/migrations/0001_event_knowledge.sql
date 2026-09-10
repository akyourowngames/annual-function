CREATE TABLE IF NOT EXISTS event_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_documents_search ON event_documents USING gin (to_tsvector('english', title || ' ' || content));
CREATE INDEX IF NOT EXISTS guests_invitation_idx ON guests(invitation_id);
CREATE INDEX IF NOT EXISTS check_ins_invitation_idx ON check_ins(invitation_id);
CREATE INDEX IF NOT EXISTS check_ins_guest_idx ON check_ins(guest_id);
CREATE INDEX IF NOT EXISTS tickets_student_idx ON support_tickets(student_id);
ALTER TABLE event_documents ENABLE ROW LEVEL SECURITY;
