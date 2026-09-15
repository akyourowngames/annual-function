import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, sameOrigin, text } from "@/lib/server/http";
import { parseAudience } from "@/lib/server/channels";
import { deliverInvitations, recipientsForAudience } from "@/lib/server/delivery";

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
