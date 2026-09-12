import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
/**
 * Database diagram (v1):
 *
 * ```text
 * students
 *     │
 *     ├───────────────┐
 *     ▼               ▼
 * invitations    support_tickets
 *     │
 *     ▼
 *   guests
 *     │
 *     ▼
 *  check_ins
 *
 * event_settings  ← official event info (never hardcoded in the agent)
 * ```
 *
 * Rules enforced here:
 * - student_id is unique (one admission number → one student)
 * - invitation_code is unique (one code → one invitation)
 * - one student → one invitation (unique on invitations.student_id)
 * - guest_limit >= 0 (CHECK constraint)
 * - guest-limit enforcement on registration lives in backend logic
 *   (see ./queries.ts), never trusted to the AI
 * - QR carries only the opaque qr_token, never personal data
 */
export const students = pgTable("students", {
  id: uuid("id").defaultRandom().primaryKey(),
  // School admission number, stored as text to preserve leading zeros.
  studentId: text("student_id").notNull().unique(),
  name: text("name").notNull(),
  className: text("class"),
  phone: text("phone"),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // One student → one invitation (v1). Unique by rule.
    studentId: uuid("student_id")
      .notNull()
      .unique()
      .references(() => students.id),
    // Human-readable code, e.g. "ANL-8F29K". Unique by rule.
    invitationCode: text("invitation_code").notNull().unique(),
    // Opaque token encoded in the QR. No personal data inside.
    qrToken: text("qr_token").notNull().unique(),
    guestLimit: integer("guest_limit").notNull().default(4),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("invitations_guest_limit_non_negative", sql`${t.guestLimit} >= 0`),
  ],
);
export const guests = pgTable("guests", {
  id: uuid("id").defaultRandom().primaryKey(),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => invitations.id),
  name: text("name").notNull(),
  relationship: text("relationship"),
  status: text("status").notNull().default("registered"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const checkIns = pgTable("check_ins", {
  id: uuid("id").defaultRandom().primaryKey(),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => invitations.id),
  // Nullable: staff may check in at invitation level without a per-guest row.
  guestId: uuid("guest_id").references(() => guests.id),
  checkedInAt: timestamp("checked_in_at").defaultNow().notNull(),
  checkedInBy: text("checked_in_by"),
});
export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: uuid("student_id").references(() => students.id),
  category: text("category"),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});
export const eventSettings = pgTable("event_settings", {
  landingContent:
    jsonb("landing_content").$type<import("@/lib/landing").LandingContent>(),
  id: uuid("id").defaultRandom().primaryKey(),
  eventName: text("event_name").notNull(),
  eventDate: date("event_date"),
  startTime: text("start_time"),
  venue: text("venue"),
  dressCode: text("dress_code"),
  parkingInfo: text("parking_info"),
  entryInfo: text("entry_info"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Student = typeof students.$inferSelect;
export const eventDocuments = pgTable("event_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type NewStudent = typeof students.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type Guest = typeof guests.$inferSelect;
export type NewGuest = typeof guests.$inferInsert;
export type CheckIn = typeof checkIns.$inferSelect;
export type NewCheckIn = typeof checkIns.$inferInsert;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
export type EventSettings = typeof eventSettings.$inferSelect;
export type NewEventSettings = typeof eventSettings.$inferInsert;
export const invitationLookupLimits = pgTable("invitation_lookup_limits", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(1),
});
export const whatsappSessions = pgTable("whatsapp_sessions", {
  waId: text("wa_id").primaryKey(),
  step: text("step").notNull().default("idle"),
  payload: jsonb("payload").notNull().default({}),
  invitationCode: text("invitation_code"),
  attempts: integer("attempts").notNull().default(0),
  lastUserMsgAt: timestamp("last_user_msg_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WhatsappSession = typeof whatsappSessions.$inferSelect;
export type NewWhatsappSession = typeof whatsappSessions.$inferInsert;
