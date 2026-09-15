export type EventInfo = {
  landingContent?: import("@/lib/landing").LandingContent | null;
  eventName: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string | null;
  dressCode: string | null;
  parkingInfo: string | null;
  entryInfo: string | null;
};
export type GuestInfo = {
  id: string;
  name: string;
  relationship: string | null;
  status: string;
};
export type InvitationData = {
  invitation: {
    code: string;
    status: string;
    guestLimit: number;
    qrToken: string;
  };
  studentName: string;
  registered: number;
  remaining: number;
  checkIns: number;
  guests: GuestInfo[];
  rsvp?: {
    status: string;
    guests: number | null;
    note: string | null;
  } | null;
};
export type TicketInfo = {
  id: string;
  category: string | null;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  student?: {
    studentId: string;
    name: string;
  };
};
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: isForm
      ? { ...init?.headers }
      : { "Content-Type": "application/json", ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(isForm ? 60000 : 25000),
  });
  const data = await res.json().catch(() => ({
    error: "The server could not complete this request. Please try again.",
  }));
  if (!res.ok)
    throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}
export function formatDate(date: string | null | undefined, short = false) {
  if (!date) return "Date to be announced";
  return new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: short ? "short" : "long",
    year: "numeric",
  });
}
