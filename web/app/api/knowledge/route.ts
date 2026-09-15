import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventDocuments, knowledgeSources } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, sameOrigin, text, uuid } from "@/lib/server/http";
export async function GET() {
  try {
    await requireStaff(true);
    const db = getDb();
    return NextResponse.json({
      documents: await db
        .select()
        .from(eventDocuments)
        .orderBy(desc(eventDocuments.createdAt)),
      sources: await db
        .select()
        .from(knowledgeSources)
        .orderBy(desc(knowledgeSources.createdAt)),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    const [document] = await getDb()
      .insert(eventDocuments)
      .values({
        title: text(b.title, "Article title", 200),
        content: text(b.content, "Article content", 20000),
      })
      .returning();
    return NextResponse.json({ document }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    const id = uuid(b.id);
    const db = getDb();
    if (b.kind === "source") {
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, id));
    } else {
      await db.delete(eventDocuments).where(eq(eventDocuments.id, id));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
