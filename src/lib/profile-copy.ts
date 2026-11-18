import type { Lang } from "@/lib/l10n";

const copy = {
  en: { camera: "Take with camera", gallery: "Choose from gallery", remove: "Remove photo", confirm: "Remove photo?", name: "Change name", label: "Name", short: "Enter at least 2 letters", failed: "Could not save. Please try again.", photoFailed: "Could not open the photo. Please try again." },
  hi: { camera: "कैमरा से लें", gallery: "गैलरी से चुनें", remove: "फ़ोटो हटाएँ", confirm: "फ़ोटो हटाएँ?", name: "नाम बदलें", label: "नाम", short: "कम से कम 2 अक्षर लिखें", failed: "सेव नहीं हुआ। फिर कोशिश करें।", photoFailed: "फ़ोटो नहीं खुली। फिर कोशिश करें।" },
  mr: { camera: "कॅमेऱ्याने घ्या", gallery: "गॅलरीतून निवडा", remove: "फोटो काढा", confirm: "फोटो काढायचा?", name: "नाव बदला", label: "नाव", short: "किमान 2 अक्षरे लिहा", failed: "सेव्ह झाले नाही. पुन्हा प्रयत्न करा.", photoFailed: "फोटो उघडला नाही. पुन्हा प्रयत्न करा." },
};

export function profileCopy(lang: Lang) { return copy[lang]; }