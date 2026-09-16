import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { parseAudience } from "@/lib/server/channels";
import { deliverInvitations, deliverToCodes, recipientsForAudience } from "@/lib/server/delivery";

export const maxDuration = 60;

// Reachability preview for an audience (no messages sent).
export async function GET(request: NextRequest) {
  try {
    await requireStaff(true);
    const audience = parseAudience(request.nextUrl.searchParams.get("audience") ?? "all");
    const { reachable, matched, unreachable } = await recipientsForAudience(audience);
    return NextResponse.json({ reachable: reachable.length, matched, unreachable });
  } catch (e) {
    return fail(e);
  }
}

// Bulk-send personalized invitation passes. Batched: the admin UI calls this
// repeatedly and stops when `remaining` reaches 0.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    // Specific families (a one-off resend from the workspace or the assistant).
    if (Array.isArray(b.codes)) {
      const codes = b.codes.map((c) => text(c, "Invitation code", 64).toUpperCase());
      if (!codes.length) throw new HttpError("Choose at least one student.");
      if (codes.length > 50) throw new HttpError("Send to at most 50 families at a time.");
      return NextResponse.json({ result: await deliverToCodes(codes) });
    }
    const audience = parseAudience(text(b.audience ?? "all", "Audience", 120));
    const result = await deliverInvitations({
      audience,
      resend: b.resend === true,
    });
    return NextResponse.json({ result });
  } catch (e) {
    return fail(e);
  }
}
