// Server functions for Google Maps: the browser key at runtime, and the road
// route through the trip's stops (Routes API) with the exact Google error.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MapsConfig = { key: string | null };

export const getGoogleMapsKey = createServerFn({ method: "GET" }).handler(async (): Promise<MapsConfig> => {
  const key = process.env["GOOGLE_MAPS_API_KEY"] ?? null;
  return { key: key && key.trim() ? key.trim() : null };
});

type Pt = { lat: number; lng: number };
export type RouteResult = { polyline: string | null; error: string | null };

const okPt = (p: unknown): p is Pt =>
  !!p && typeof (p as Pt).lat === "number" && typeof (p as Pt).lng === "number" &&
  Math.abs((p as Pt).lat) <= 90 && Math.abs((p as Pt).lng) <= 180;

export const getTripRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { points: Pt[] }) => {
    if (!Array.isArray(d?.points) || d.points.length < 2 || d.points.length > 27 || !d.points.every(okPt)) {
      throw new Error("bad_points");
    }
    return { points: d.points.map((p) => ({ lat: p.lat, lng: p.lng })) };
  })
  .handler(async ({ data }): Promise<RouteResult> => {
    const key = process.env["GOOGLE_MAPS_API_KEY"]?.trim();
    if (!key) return { polyline: null, error: "GOOGLE_MAPS_API_KEY is not set" };
    const wp = (p: Pt) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    const pts = data.points;
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
        // The key may be restricted to the app's web address.
        Referer: "https://delivery.sunrich.in/",
      },
      body: JSON.stringify({
        origin: wp(pts[0] as Pt),
        destination: wp(pts[pts.length - 1] as Pt),
        intermediates: pts.slice(1, -1).map(wp),
        travelMode: "DRIVE",
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Google Routes failed [${res.status}]: ${text}`);
      return { polyline: null, error: `Google Routes ${res.status}: ${text.slice(0, 600)}` };
    }
    try {
      const j = JSON.parse(text) as { routes?: { polyline?: { encodedPolyline?: string } }[] };
      const line = j.routes?.[0]?.polyline?.encodedPolyline ?? null;
      return line ? { polyline: line, error: null } : { polyline: null, error: "Google Routes: no route found" };
    } catch {
      return { polyline: null, error: "Google Routes: unreadable reply" };
    }
  });
