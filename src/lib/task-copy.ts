import type { Lang } from "@/lib/l10n";
const labels = {
  continue: ["Continue", "आगे", "पुढे"],
  allGiven: ["All given ✅", "सब दिया ✅", "सर्व दिले ✅"],
  verify: ["Verify", "जाँचें", "तपासा"],
  noOtp: ["No OTP", "OTP नहीं है", "OTP नाही"],
  received: ["Received ✅", "मिल गया ✅", "मिळाले ✅"],
  notReceived: ["Not received", "नहीं मिला", "मिळाले नाही"],
  bank: ["Bank transfer", "बैंक", "बँक"],
  stops: ["All stops", "सभी स्टॉप", "सर्व थांबे"],
  loading: ["Loading in progress", "लोडिंग चल रही है", "लोडिंग सुरू आहे"],
  diesel: ["Diesel", "डीज़ल", "डिझेल"], toll: ["Toll", "टोल", "टोल"], puncture: ["Puncture", "पंक्चर", "पंक्चर"], food: ["Food", "खाना", "जेवण"], parking: ["Parking", "पार्किंग", "पार्किंग"], other: ["Other", "अन्य", "इतर"],
  pendingCash: ["Payment pending", "पैसे लेना बाकी है", "पैसे घ्यायचे आहेत"],
  wrongOtp: ["Wrong code. Try again.", "गलत OTP। फिर से डालें।", "चुकीचा OTP. पुन्हा टाका."],
} as const;
export type TaskLabel = keyof typeof labels;
export function taskCopy(lang: Lang, key: TaskLabel) { return labels[key][lang === "hi" ? 1 : lang === "mr" ? 2 : 0]; }
