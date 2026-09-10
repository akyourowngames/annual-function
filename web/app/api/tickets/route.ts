import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createTicket, listTickets, studentForCode } from "@/lib/db/queries";
import { getDb } from "@/lib/db";
import { supportTickets } from "@/lib/db/schema";
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
    const status = text(b.status, "Status", 30);
    if (!["pending", "in_progress", "resolved"].includes(status))
      throw new HttpError("Choose a valid ticket status.");
    const [ticket] = await getDb()
      .update(supportTickets)
      .set({ status, resolvedAt: status === "resolved" ? new Date() : null })
      .where(eq(supportTickets.id, uuid(b.id)))
      .returning();
    if (!ticket) throw new HttpError("Ticket not found.", 404);
    return NextResponse.json({ ticket });
  } catch (e) {
    return fail(e);
  }
}
