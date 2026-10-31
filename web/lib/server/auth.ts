import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
import { canCheckIn, canManage, isAdmin, type Role } from "./roles";
export type Staff = {
  id: string;
  role: Role;
  name: string;
};
const COOKIE = "annual_staff";
export function supabaseAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new HttpError(
      "Staff sign-in is not configured. Contact the system administrator.",
      503,
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function signature(value: string) {
  return createHmac("sha256", process.env.ADMIN_ACCESS_KEY || "")
    .update(value)
    .digest("base64url");
}
export function accessKeySession(
  role: Role = "admin",
  ttlMs = 4 * 60 * 60 * 1000,
) {
  const payload = Buffer.from(
    JSON.stringify({ role, exp: Date.now() + ttlMs }),
  ).toString("base64url");
  return `key.${payload}.${signature(payload)}`;
}
export async function setSession(value: string, maxAge = 3600) {
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
}
export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
async function resolveStaff(): Promise<Staff> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token)
    throw new HttpError("Sign in to the staff workspace to continue.", 401);
  if (token.startsWith("key.")) {
    const [, payload, sig] = token.split(".");
    if (
      !process.env.ADMIN_ACCESS_KEY ||
      !payload ||
      !sig ||
      !equal(signature(payload), sig)
    )
      throw new HttpError(
        "Your session has expired. Please sign in again.",
        401,
      );
    let parsed: { role?: unknown; exp?: number };
    try {
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (!parsed.exp || parsed.exp < Date.now()) throw new Error();
    } catch {
      throw new HttpError(
        "Your session has expired. Please sign in again.",
        401,
      );
    }
    // Tokens issued before roles existed default to administrator.
    const role: Role = parsed.role === "gate" ? "gate" : "admin";
    return {
      id: `access-key-${role}`,
      role,
      name: role === "gate" ? "Gate keeper" : "Event administrator",
    };
  }
  const { data, error } = await supabaseAuth().auth.getUser(token);
  const role = data.user?.app_metadata?.role;
  if (
    error ||
    !data.user ||
    !["admin", "staff", "gate"].includes(role)
  )
    throw new HttpError("An authorized staff account is required.", 401);
  return { id: data.user.id, role, name: data.user.email || "Event team" };
}
/** Any signed-in account (staff, admin or gate keeper) — used to read the session. */
export async function requireSession(): Promise<Staff> {
  return resolveStaff();
}
/** Staff/admin only — gate keepers are refused. */
export async function requireStaff(adminOnly = false): Promise<Staff> {
  const staff = await resolveStaff();
  if (adminOnly && !isAdmin(staff.role))
    throw new HttpError("Administrator access is required.", 403);
  if (!adminOnly && !canManage(staff.role))
    throw new HttpError(
      "Your account can only scan passes at the gate.",
      403,
    );
  return staff;
}
/** Anything that may work the gate scanner, including gate keepers. */
export async function requireCheckIn(): Promise<Staff> {
  const staff = await resolveStaff();
  if (!canCheckIn(staff.role))
    throw new HttpError("A staff or gate account is required.", 403);
  return staff;
}
