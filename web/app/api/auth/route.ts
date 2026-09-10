import { NextResponse } from "next/server";
import {
  accessKeySession,
  clearSession,
  equal,
  requireStaff,
  setSession,
  supabaseAuth,
} from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
const attempts = new Map<
  string,
  {
    count: number;
    until: number;
  }
>();
export async function GET() {
  try {
    return NextResponse.json({ staff: await requireStaff() });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
    const now = Date.now();
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const attempt = attempts.get(ip);
    if (attempt && attempt.until > now && attempt.count >= 10)
      throw new HttpError(
        "Too many sign-in attempts. Please try again in 15 minutes.",
        429,
      );
    attempts.set(ip, {
      count: attempt && attempt.until > now ? attempt.count + 1 : 1,
      until: attempt && attempt.until > now ? attempt.until : now + 900000,
    });
    const b = await body(request);
    if (b.accessKey) {
      const key = text(b.accessKey, "Access key", 500);
      if (
        !process.env.ADMIN_ACCESS_KEY ||
        !equal(key, process.env.ADMIN_ACCESS_KEY)
      )
        throw new HttpError(
          "The staff access key is incorrect or has not been configured.",
          401,
        );
      await setSession(accessKeySession(), 8 * 3600);
      attempts.delete(ip);
      return NextResponse.json({
        staff: {
          id: "access-key-admin",
          name: "Event administrator",
          role: "admin",
        },
      });
    }
    const { data, error } = await supabaseAuth().auth.signInWithPassword({
      email: text(b.email, "Email"),
      password: text(b.password, "Password", 500),
    });
    if (
      error ||
      !data.session ||
      !["admin", "staff"].includes(data.user?.app_metadata?.role)
    )
      throw new HttpError(
        "Sign-in failed. Use an account authorized by your school.",
        401,
      );
    await setSession(data.session.access_token, data.session.expires_in);
    attempts.delete(ip);
    return NextResponse.json({
      staff: {
        id: data.user.id,
        name: data.user.email,
        role: data.user.app_metadata.role,
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
