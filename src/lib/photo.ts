// Compress a camera image and upload it to the private `operations` bucket.
// Returns the storage path stored in DB columns (photo_url columns hold paths).
import { supabase } from "@/integrations/supabase/client";

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function compressToJpeg(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const dataUrl = await fileToDataUrl(file);
  const img = document.createElement("img");
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
}

/** Upload a captured photo; returns the bucket path like `team/<uid>/<ts>.jpg`. */
export async function uploadPhoto(file: File, userId: string, kind: string): Promise<string> {
  const blob = await compressToJpeg(file);
  const path = `team/${userId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from("operations")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

/** Short-lived URL for displaying a private-bucket photo path. */
export async function photoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  const { data } = await supabase.storage.from("operations").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Upload a data URL (e.g. signature canvas) to the operations bucket. */
export async function uploadDataUrl(dataUrl: string, userId: string, kind: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const path = `team/${userId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const { error } = await supabase.storage.from("operations").upload(path, blob, { contentType: "image/png" });
  if (error) throw error;
  return path;
}
