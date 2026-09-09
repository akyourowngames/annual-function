import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// students
//   │
//   ▼
// invitations
//   │
//   ├── guests
//   │
//   └── check_ins
//
// students
//   │
//   ▼
// support_tickets

export const students = pgTable("students", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: text("student_id").notNull().unique(),
  name: text("name").notNull(),
  className: text("class_name"),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id),
  guestLimit: integer("guest_limit").notNull().default(4),
  status: text("status").notNull().default("active"),
  qrPayload: text("qr_payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guests = pgTable("guests", {
  id: uuid("id").defaultRandom().primaryKey(),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => invitations.id),
  name: text("name").notNull(),
  relation: text("relation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const checkIns = pgTable("check_ins", {
  id: uuid("id").defaultRandom().primaryKey(),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => invitations.id),
  guestCount: integer("guest_count").notNull().default(0),
  checkedInAt: timestamp("checked_in_at").defaultNow().notNull(),
});

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: uuid("student_id").references(() => students.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
