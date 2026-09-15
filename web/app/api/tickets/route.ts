import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  createTicket,
  listTickets,
  setTicketStatus,
  studentForCode,
  ticketWithContact,
} from "@/lib/db/queries";
import { getDb } from "@/lib/db";
import { supportTickets } from "@/lib/db/schema";
import { sendTextTo } from "@/lib/server/delivery";
import type { Channel } from "@/lib/server/channels";
import { requireStaff } from "@/lib/server/auth";
import {
  body,
  fail,
  HttpError,
  sameOrigin,
  text,
  uuid,
} from "@/lib/server/http";
export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    let studentId: string | undefined;
    if (code)
      studentId = (
        await studentForCode(text(code, "Invitation code", 64).toUpperCase())
      ).studentId;
    else await requireStaff();
    const rows = await listTickets(studentId);
    return NextResponse.json({
      tickets: rows.map((r) => ({
        ...r.ticket,
        student: { studentId: r.student.studentId, name: r.student.name },
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    if (!b.code)
      throw new HttpError(
        "Open your invitation before sending a request.",
        401,
      );
    const student = await studentForCode(
      text(b.code, "Invitation code", 64).toUpperCase(),
    );
    const result = await createTicket({
      studentId: student.studentId,
      category: text(b.category, "Category", 100, false) || "Other",
      description: text(b.description, "Request", 2000),
    });
    return NextResponse.json({ ticket: result.ticket }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff();
    const b = await body(request);
    // One-tap reply: send the (editable) suggested reply to the family's chat.
    if (b.action === "reply") {
      const id = uuid(b.id);
      const reply = text(b.message, "Reply", 2000);
      const found = await ticketWithContact(id);
      if (!found) throw new HttpError("Ticket not found.", 404);
      if (!found.contact)
        throw new HttpError(
          "This family has no chat connection yet — copy the reply and send it another way.",
          409,
        );
      try {
        await sendTextTo(found.contact.channel as Channel, found.contact.address, reply);
      } catch {
        throw new HttpError(
          "Could not deliver the reply to their chat. Copy it and send it manually.",
          502,
        );
      }
      const [ticket] = await getDb()
        .update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date(), suggestedReply: reply })
        .where(eq(supportTickets.id, id))
        .returning();
      return NextResponse.json({ ticket, delivered: true });
    }
    const status = text(b.status, "Status", 30);
    if (!["pending", "in_progress", "resolved"].includes(status))
      throw new HttpError("Choose a valid ticket status.");
    const ticket = await setTicketStatus(uuid(b.id), status);
    if (!ticket) throw new HttpError("Ticket not found.", 404);
    return NextResponse.json({ ticket });
  } catch (e) {
    return fail(e);
  }
}
