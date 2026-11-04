// Daily 2 am IST photo clean-up. Deletes only storage FILES returned by photo_cleanup_due
// (expired AND (delete-after-download off OR in a downloaded backup)); records are never deleted.
// Caller must send header x-cron-secret = LOVABLE_CRON_SECRET.
import { createFileRoute } from "@tanstack/react-router";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/photo-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.LOVABLE_CRON_SECRET ?? "";
        const given = request.headers.get("x-cron-secret") ?? "";
        if (!secret || !safeEqual(given, secret)) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.rpc("photo_cleanup_plan" as never);
        const { data, error } = await supabaseAdmin.rpc("photo_cleanup_due" as never, { p_limit: 500 } as never);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        const due = (data ?? []) as { id: string; bucket: string; path: string }[];
        const done: string[] = [];
        const errors: { path: string; error: string }[] = [];
        for (let i = 0; i < due.length; i += 100) {
          const chunk = due.slice(i, i + 100);
          const { error: rmErr } = await supabaseAdmin.storage.from("operations").remove(chunk.map((d) => d.path));
          if (rmErr) chunk.forEach((d) => errors.push({ path: d.path, error: rmErr.message }));
          else done.push(...chunk.map((d) => d.id));
        }
        const { data: n } = await supabaseAdmin.rpc("photo_cleanup_done" as never, { p_ids: done, p_errors: errors } as never);
        return Response.json({ due: due.length, deleted: n ?? 0, errors: errors.length });
      },
    },
  },
});
