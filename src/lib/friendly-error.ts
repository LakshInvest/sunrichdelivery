// Turns raw gate/trip database messages into plain words in the user's language.
const MAP: [RegExp, string][] = [
  [/loading not finished/i, "err.loading_not_done"],
  [/trip is not loaded/i, "err.loading_not_done"],
  [/already gated out/i, "err.already_gated_out"],
  [/gate pass not found/i, "err.gate_not_found"],
  [/cannot leave the gate/i, "err.cannot_leave"],
  [/gate out not done/i, "err.gate_out_not_done"],
  [/trip already started/i, "err.trip_already_started"],
];

export function friendlyKey(raw: string): string | null {
  for (const [re, key] of MAP) if (re.test(raw)) return key;
  return null;
}

export function friendlyError(raw: string, t: (k: string) => string): string {
  const key = friendlyKey(raw);
  return key ? t(key) : raw;
}
