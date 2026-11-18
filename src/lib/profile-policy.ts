export function validStaffName(name: string): boolean {
  return (name.trim().match(/\p{L}/gu)?.length ?? 0) >= 2;
}

export function staffInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase();
}