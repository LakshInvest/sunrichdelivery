// Compress a camera image and upload it to the private `operations` bucket.
// Returns the storage path stored in DB columns (photo_url columns hold paths).
import { supabase } from "@/integrations/supabase/client";
import { isNetworkError, isOffline, queuePhoto, queuedPhotoData } from "@/lib/offline";

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b); });
}

/** Upload, or keep the photo locally under its final path when offline. */
async function uploadOrQueue(path: string, blob: Blob, type: string): Promise<string> {
  if (isOffline()) { queuePhoto(path, await blobToDataUrl(blob), type); return path; }
  try {
    const { error } = await supabase.storage.from("operations").upload(path, blob, { contentType: type, upsert: true });
    if (error) { if (isNetworkError(error)) { queuePhoto(path, await blobToDataUrl(blob), type); return path; } throw error; }
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    queuePhoto(path, await blobToDataUrl(blob), type);
  }
  return path;
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Max 1280 px JPEG, quality stepped down until the file is about 200 KB or less. */
export async function compressToJpeg(file: File, maxDim = 1280, targetBytes = 200 * 1024): Promise<Blob> {
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
  const encode = (q: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", q),
    );
  let blob = await encode(0.8);
  for (const q of [0.7, 0.6, 0.5, 0.42]) {
    if (blob.size <= targetBytes) break;
    blob = await encode(q);
  }
  // Very busy pictures: shrink the size a little until it fits.
  for (let i = 0; i < 4 && blob.size > targetBytes; i++) {
    const w = Math.round(canvas.width * 0.8), h = Math.round(canvas.height * 0.8);
    const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
    tmp.getContext("2d")!.drawImage(canvas, 0, 0, w, h);
    canvas.width = w; canvas.height = h; ctx.drawImage(tmp, 0, 0);
    blob = await encode(0.6);
  }
  return blob;
}

/** Upload a captured photo; returns the bucket path like `team/<uid>/<ts>.jpg`. */
export async function uploadPhoto(file: File, userId: string, kind: string): Promise<string> {
  const blob = await compressToJpeg(file);
  const path = `team/${userId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  return uploadOrQueue(path, blob, "image/jpeg");
}

/** Short-lived URL for displaying a private-bucket photo path. */
export async function photoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  const local = queuedPhotoData(path);
  if (local) return local;
  const { data } = await supabase.storage.from("operations").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** Upload a data URL (e.g. signature canvas) to the operations bucket. */
export async function uploadDataUrl(dataUrl: string, userId: string, kind: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const path = `team/${userId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  return uploadOrQueue(path, blob, "image/png");
}
