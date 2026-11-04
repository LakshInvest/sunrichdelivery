// Photo backup ZIP for Command Center: folders Type/Date/Trip-or-Customer + index.csv.
// Permission is checked by photo_backup_index / mark_photos_downloaded (finance or settings view).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type IndexRow = {
  id: string; path: string; folder: string; file_name: string; taken_on: string; photo_type: string;
  trip_no: string | null; customer_name: string | null; order_no: string | null; amount: number | null; taken_by_name: string | null;
};

const csv = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const buildPhotoBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { zipSync, strToU8 } = await import("fflate");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await context.supabase.rpc("photo_backup_index" as never, { p_ids: data.ids } as never);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as IndexRow[];
    const files: Record<string, Uint8Array> = {};
    const lines = ["date,type,trip,customer,order,amount,who,file name"];
    const got: string[] = [];
    for (const r of list) {
      const { data: blob } = await supabaseAdmin.storage.from("operations").download(r.path);
      if (!blob) continue;
      const name = `${r.folder}/${r.file_name}`;
      files[name] = new Uint8Array(await blob.arrayBuffer());
      lines.push([r.taken_on, r.photo_type, r.trip_no, r.customer_name, r.order_no, r.amount, r.taken_by_name, name].map(csv).join(","));
      got.push(r.id);
    }
    if (!got.length) throw new Error("No photo files found");
    files["index.csv"] = strToU8(lines.join("\n"));
    const zip = zipSync(files, { level: 0 });
    const zipPath = `backups/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.zip`;
    const up = await supabaseAdmin.storage.from("operations").upload(zipPath, zip, { contentType: "application/zip" });
    if (up.error) throw new Error(up.error.message);
    const { data: backupId, error: mErr } = await context.supabase.rpc("mark_photos_downloaded" as never, { p_ids: got, p_zip_path: zipPath } as never);
    if (mErr) throw new Error(mErr.message);
    const { data: signed } = await supabaseAdmin.storage.from("operations").createSignedUrl(zipPath, 60 * 60);
    return { backupId: backupId as unknown as string, zipPath, url: signed?.signedUrl ?? null, count: got.length, skipped: list.length - got.length };
  });
