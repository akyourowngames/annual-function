import { NextResponse } from "next/server";
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function fail(e: unknown) {
  if (e instanceof HttpError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  const message = e instanceof Error ? e.message : "";
  if (/not found|Invalid QR/.test(message))
    return NextResponse.json({ error: message }, { status: 404 });
  if (
    /Guest limit|not active|already checked|does not belong|Cannot|registered guest/.test(
      message,
    )
  )
    return NextResponse.json({ error: message }, { status: 409 });
  console.error(
    "Request failed",
    e instanceof Error ? e.name : "Unknown error",
  );
  return NextResponse.json(
    {
      error: "The event service is temporarily unavailable. Please try again.",
    },
    { status: 503 },
  );
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b;
  } catch {
    throw new HttpError("Please provide a valid request.");
  }
}
export function text(
  value: unknown,
  label: string,
  max = 200,
  required = true,
) {
  if (typeof value !== "string" || !value.trim()) {
    if (!required) return "";
    throw new HttpError(`${label} is required.`);
  }
  if (value.trim().length > max)
    throw new HttpError(`${label} must be ${max} characters or fewer.`);
  return value.trim();
}
export function integer(value: unknown, label: string, max = 100) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new HttpError(`${label} must be a whole number from 0 to ${max}.`);
  return value;
}
export function uuid(value: unknown) {
  const id = text(value, "ID", 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new HttpError("Invalid ID.");
  return id;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize request.url behind a proxy; Host is browser-visible.
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError("This request is not allowed.", 403);
    }
    const host = request.headers.get("host") || new URL(request.url).host;
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.host !== host)
      throw new HttpError("This request is not allowed.", 403);
  }
}
