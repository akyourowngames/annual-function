import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
export type Staff = {
  id: string;
  role: "admin" | "staff";
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
export function accessKeySession() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 }),
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
export async function requireStaff(adminOnly = false): Promise<Staff> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token)
    throw new HttpError("Sign in to the staff workspace to continue.", 401);
  let staff: Staff;
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
    try {
      if (
        JSON.parse(Buffer.from(payload, "base64url").toString()).exp <
        Date.now()
      )
        throw new Error();
    } catch {
      throw new HttpError(
        "Your session has expired. Please sign in again.",
        401,
      );
    }
    staff = {
      id: "access-key-admin",
      role: "admin",
      name: "Event administrator",
    };
  } else {
    const { data, error } = await supabaseAuth().auth.getUser(token);
    const role = data.user?.app_metadata?.role;
    if (error || !data.user || !["admin", "staff"].includes(role))
      throw new HttpError("An authorized staff account is required.", 401);
    staff = { id: data.user.id, role, name: data.user.email || "Event team" };
  }
  if (adminOnly && staff.role !== "admin")
    throw new HttpError("Administrator access is required.", 403);
  return staff;
}
