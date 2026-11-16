export const DELIVERY_ROLES = [
  { code: "DRIVER", to: "/driver", key: "home.driverCard" },
  { code: "LOADER", to: "/loader", key: "home.loaderCard" },
  { code: "SECURITY", to: "/security", key: "home.securityCard" },
] as const;
export type DeliveryRole = (typeof DELIVERY_ROLES)[number];

export function availableRoles(codes: string[]) {
  return DELIVERY_ROLES.filter((role) => codes.includes(role.code));
}
export function preferredRole(codes: string[], saved: string | null, chooser = false) {
  if (chooser) return undefined;
  const roles = availableRoles(codes);
  return roles.length === 1 ? roles[0] : roles.find((role) => role.code === saved);
}
const roleKey = (userId: string) => `sunrich.delivery.role.${userId}`;
export function readLastRole(userId: string) {
  try { return localStorage.getItem(roleKey(userId)); } catch { return null; }
}
export function rememberRole(userId: string, code: string) {
  try { localStorage.setItem(roleKey(userId), code); } catch { /* Per-session navigation still works. */ }
}
export function formatStaffMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, "");
  const national = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return national.length === 10 ? `+91 ${national.slice(0, 5)} ${national.slice(5)}` : mobile;
}