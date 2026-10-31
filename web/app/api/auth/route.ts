import { NextResponse } from "next/server";
import {
  accessKeySession,
  clearSession,
  equal,
  requireSession,
  setSession,
  supabaseAuth,
} from "@/lib/server/auth";
import { roleLabel, type Role } from "@/lib/server/roles";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { clientKey, enforceRateLimits } from "@/lib/server/rate-limit";
import { audit } from "@/lib/server/audit";

// Secondary, in-process limiter used only when the shared database limiter is
// unavailable. The database limiter is authoritative and works across
// serverless instances.
const memoryAttempts = new Map<string, { count: number; until: number }>();

async function limitSignIn(ip: string) {
  try {
    await enforceRateLimits([
      { key: `staff:login:ip:${ip}`, limit: 10, windowSeconds: 900 },
    ]);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw e;
    // Fail open for availability of staff sign-in, but keep the local counter.
    console.error(
      "staff sign-in limiter unavailable",
      e instanceof Error ? e.name : "unknown",
    );
    const now = Date.now();
    if (memoryAttempts.size > 10000)
      for (const [k, v] of memoryAttempts)
        if (v.until < now) memoryAttempts.delete(k);
    const attempt = memoryAttempts.get(ip);
    if (attempt && attempt.until > now && attempt.count >= 10)
      throw new HttpError(
        "Too many sign-in attempts. Please try again in 15 minutes.",
        429,
      );
    memoryAttempts.set(ip, {
      count: attempt && attempt.until > now ? attempt.count + 1 : 1,
      until: attempt && attempt.until > now ? attempt.until : now + 900_000,
    });
  }
}

export async function GET() {
  try {
    return NextResponse.json({ staff: await requireSession() });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const ip = clientKey(request);
    await limitSignIn(ip);
    const b = await body(request);
    if (b.accessKey) {
      const key = text(b.accessKey, "Access key", 500);
      const adminKey = process.env.ADMIN_ACCESS_KEY;
      const gateKey = process.env.GATE_ACCESS_KEY;
      let role: Role | null = null;
      if (adminKey && equal(key, adminKey)) role = "admin";
      else if (gateKey && equal(key, gateKey)) role = "gate";
      if (!role) {
        await audit({
          actorType: "anonymous",
          action: "staff.login_failed",
          ip,
          detail: { method: "access_key" },
        });
        throw new HttpError(
          "The access key is incorrect or has not been configured.",
          401,
        );
      }
      await setSession(accessKeySession(role), 4 * 3600);
      memoryAttempts.delete(ip);
      await audit({
        actorType: role === "admin" ? "admin" : "gate",
        actorId: `access-key-${role}`,
        action: "staff.login",
        ip,
        detail: { method: "access_key", role },
      });
      return NextResponse.json({
        staff: { id: `access-key-${role}`, name: roleLabel(role), role },
      });
    }
    const { data, error } = await supabaseAuth().auth.signInWithPassword({
      email: text(b.email, "Email"),
      password: text(b.password, "Password", 500),
    });
    const supabaseRole = data.user?.app_metadata?.role;
    if (
      error ||
      !data.session ||
      !["admin", "staff", "gate"].includes(supabaseRole)
    ) {
      await audit({
        actorType: "anonymous",
        action: "staff.login_failed",
        ip,
        detail: { method: "supabase" },
      });
      throw new HttpError(
        "Sign-in failed. Use an account authorized by your school.",
        401,
      );
    }
    await setSession(data.session.access_token, data.session.expires_in);
    memoryAttempts.delete(ip);
    await audit({
      actorType:
        supabaseRole === "admin"
          ? "admin"
          : supabaseRole === "gate"
            ? "gate"
            : "staff",
      actorId: data.user.id,
      action: "staff.login",
      ip,
      detail: { method: "supabase", role: supabaseRole },
    });
    return NextResponse.json({
      staff: {
        id: data.user.id,
        name: data.user.email,
        role: supabaseRole,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await clearSession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
