import { NextResponse, type NextRequest } from "next/server";
import { createTicket, listTickets } from "@/lib/db/queries";

/** GET /api/tickets — all tickets, or ?studentId=10234 for one student. */
export async function GET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get("studentId")?.trim();
  try {
    const rows = await listTickets(studentId || undefined);
    return NextResponse.json({
      tickets: rows.map((r) => ({
        id: r.ticket.id,
        category: r.ticket.category,
        description: r.ticket.description,
        status: r.ticket.status,
        createdAt: r.ticket.createdAt,
        resolvedAt: r.ticket.resolvedAt,
        student: { studentId: r.student.studentId, name: r.student.name },
      })),
    });
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}

/** POST /api/tickets — student files a support ticket by roll ID. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!studentId || !description) {
    return NextResponse.json(
      { error: "studentId and description are required" },
      { status: 400 },
    );
  }

  try {
    const result = await createTicket({
      studentId,
      category: typeof body.category === "string" ? body.category.trim() : undefined,
      description,
    });
    return NextResponse.json({ ticket: result.ticket }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Creation failed";
    const status = message === "Student not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

