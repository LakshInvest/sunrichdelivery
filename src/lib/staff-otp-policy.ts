export type OtpRowState = {
  attempts: number;
  max_attempts: number;
  locked_until: string | null;
  consumed_at?: string | null;
  created_at?: string;
};

export function otpRetrySeconds(row: OtpRowState | null, now: number): number {
  if (!row) return 0;
  const cooldown = row.created_at ? new Date(row.created_at).getTime() + 30_000 : 0;
  const lock = !row.consumed_at && row.locked_until ? new Date(row.locked_until).getTime() : 0;
  return Math.max(0, Math.ceil((Math.max(cooldown, lock) - now) / 1000));
}

export function otpExhausted(row: OtpRowState): boolean {
  return row.attempts >= row.max_attempts;
}

export function loginErrorKey(step: "otp" | "pin", code: string): string {
  if (step === "otp") {
    if (code === "locked" || code === "otp_locked") return "err.otp_locked";
    if (code === "expired") return "err.otp_expired";
    if (code === "resend_wait") return "err.otp_wait";
    // PIN-only failures must never leak into the code step.
    if (code === "wrong_pin" || code === "locked_use_otp" || code === "device_not_trusted") return "err.otp_mismatch";
  } else if (code === "locked" || code === "locked_use_otp") return "err.pin_locked";
  return `err.${code}`;
}