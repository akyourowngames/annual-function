export type StudentIdentity = {
  admissionNumber: string;
  name: string;
  className: string;
};

export function normalizeIdentityText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeClassName(value: string): string {
  return normalizeIdentityText(value)
    .replace(/^CLASS\s+/, "")
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:IST|1ST|1)(?=\s)/, "1")
    .replace(/^([2-9]|1[0-2])(?:ND|RD|TH)(?=\s)/, "$1");
}

export function identityMatches(
  student: { studentId: string; name: string; className: string | null },
  input: StudentIdentity,
): boolean {
  return Boolean(
    input.admissionNumber.trim() && input.name.trim() && input.className.trim() &&
    student.studentId === input.admissionNumber.trim() &&
    normalizeIdentityText(student.name) === normalizeIdentityText(input.name) &&
    normalizeClassName(student.className || "") === normalizeClassName(input.className),
  );
}

/** The model may extract details, but it may not invent or correct them. */
export function identityWasSupplied(input: StudentIdentity, userMessages: string[]): boolean {
  return Object.values(input).every(value => {
    if (typeof value !== "string" || !value.trim()) return false;
    const escaped = normalizeIdentityText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u");
    return userMessages.some(message => pattern.test(normalizeIdentityText(message)));
  });
}

/** Explicit labels support recovery without sending identity details to an AI. */
export function parseRecoveryMessage(message: string): StudentIdentity | null {
  const values: Record<string, string> = {};
  for (const part of message.split(/[\n;,]+/)) {
    const match = part.trim().match(/^(admission\s*(?:number|no\.?|#)|full\s+name|name|class)\s*:\s*(.+)$/i);
    if (!match) continue;
    const key = /^admission/i.test(match[1]) ? "admissionNumber" : /name/i.test(match[1]) ? "name" : "className";
    if (values[key]) return null;
    values[key] = match[2].trim();
  }
  return values.admissionNumber && values.name && values.className
    ? values as StudentIdentity
    : null;
}
