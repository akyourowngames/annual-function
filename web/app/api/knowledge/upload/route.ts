import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/server/auth";
import { fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { ingestFile } from "@/lib/server/knowledge";
import { ACCEPTED_EXTENSIONS, detectKind } from "@/lib/server/file-types";

// Extraction (PDF/Word) is CPU-bound; give the function room.
export const maxDuration = 60;
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError("Choose a file to upload.");
    if (file.size > MAX_BYTES) throw new HttpError("That file is larger than 15 MB.");
    if (!detectKind(file.name, file.type))
      throw new HttpError(
        `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      );
    const fallbackTitle =
      file.name.replace(/\.[A-Za-z0-9]+$/, "").trim() || "Untitled document";
    const title = text(form.get("title"), "Title", 300, false) || fallbackTitle;
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const result = await ingestFile({
        title,
        filename: file.name,
        mime: file.type,
        buffer,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (e) {
      console.error("knowledge ingest failed", e);
      throw new HttpError(
        "We couldn’t read any text from that file. If it is a scanned PDF or an image, upload a text-based version.",
        422,
      );
    }
  } catch (e) {
    return fail(e);
  }
}
