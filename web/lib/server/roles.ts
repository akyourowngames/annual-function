// Role model. Pure + dependency-free so it unit-tests under plain `node --test`.
//   admin — everything, including publishing the public gallery
//   staff — day-to-day event operations
//   gate  — gate keepers: scan passes and check guests in, nothing else
export type Role = "admin" | "staff" | "gate";

export function parseRole(value: unknown): Role | null {
  return value === "admin" || value === "staff" || value === "gate" ? value : null;
}
export function canManage(role: Role): boolean {
  return role === "admin" || role === "staff";
}
export function canCheckIn(role: Role): boolean {
  return role === "admin" || role === "staff" || role === "gate";
}
export function isAdmin(role: Role): boolean {
  return role === "admin";
}
export function roleLabel(role: Role): string {
  return role === "admin" ? "Event administrator" : role === "staff" ? "Event team" : "Gate keeper";
}
