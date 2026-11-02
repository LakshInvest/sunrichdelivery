// Trip stop map on Google Maps: numbered markers coloured by stop status, the
// driver's current position and the route line between stops. Loads the Maps JS
// API lazily with the server-minted key; renders nothing until mounted.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/l10n";
import { getGoogleMapsKey, getTripRoute } from "@/lib/maps.functions";
import { getCoords } from "@/components/team/driver-parts";
import { openExternal, haptic } from "@/lib/native";
import { Navigation, Loader } from "lucide-react";

type MapStop = {
  id: string;
  seq: number;
  status: string;
  lat: number | null;
  lng: number | null;
  label: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#E0A526",
  arrived: "#F59E0B",
  delivered: "#16A34A",
  partial: "#16A34A",
  failed: "#EF4444",
};

const LATUR = { lat: 18.402252, lng: 76.584212 }; // Ganj Golai, Latur

/** Decode a Google encoded polyline. */
function decodePolyline(str: string): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

let loadPromise: Promise<void> | null = null;

function loadMaps(key: string): Promise<void> {
  if (typeof google !== "undefined" && (google as { maps?: unknown }).maps) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker&v=weekly`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loadPromise = null;
      reject(new Error("maps_load_failed"));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

declare const google: {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => GoogleMap;
    Marker: new (opts: Record<string, unknown>) => GoogleMarker;
    Polyline: new (opts: Record<string, unknown>) => unknown;
    InfoWindow: new (opts?: Record<string, unknown>) => { setContent: (html: string) => void; open: (map: GoogleMap, marker?: unknown) => void };
    SymbolPath: { CIRCLE: symbol };
  };
};

type GoogleMap = {
  setCenter: (pos: { lat: number; lng: number }) => void;
  setZoom: (z: number) => void;
  fitBounds: (b: unknown) => void;
};

type GoogleMarker = { addListener?: (event: string, handler: () => void) => void };

export function StopMap({ stops, origin = null }: { stops: MapStop[]; origin?: { lat: number; lng: number } | null }) {
  const { t } = useLang();
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<GoogleMap | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const watch = useRef<number | null>(null);

  const nextStop = stops.find((s) => s.status !== "delivered" && s.status !== "failed" && s.lat && s.lng) ?? null;

  const draw = useCallback(
    (mapObj: GoogleMap) => {
      const pts = stops
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({ s, pos: { lat: s.lat as number, lng: s.lng as number } }));
      const ext: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null = pts.length
        ? pts.reduce(
            (a, { pos }) => ({
              minLat: Math.min(a.minLat, pos.lat),
              maxLat: Math.max(a.maxLat, pos.lat),
              minLng: Math.min(a.minLng, pos.lng),
              maxLng: Math.max(a.maxLng, pos.lng),
            }),
            { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 },
          )
        : null;
      for (const { s, pos } of pts) {
        const color = STATUS_COLORS[s.status] ?? "#0D3278";
        const marker = new google.maps.Marker({
          position: pos,
          map: mapObj,
          title: `${s.seq}. ${s.label}`,
          label: { text: String(s.seq), color: "#FFFFFF", fontSize: "12px", fontWeight: "700" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#FFFFFF",
            strokeWeight: 2,
            scale: 14,
          },
        });
        const iw = new google.maps.InfoWindow({ content: `<div style="font-family:Inter,sans-serif;font-size:13px;font-weight:600">${s.seq}. ${s.label}</div>` });
        marker.addListener?.("click", () => iw.open(mapObj, marker));
      }
      // Plant first, then every stop in order.
      const path = [...(origin ? [origin] : []), ...pts.map(({ pos }) => pos)];
      if (origin) {
        new google.maps.Marker({
          position: origin,
          map: mapObj,
          title: "Plant",
          label: { text: "P", color: "#FFFFFF", fontSize: "12px", fontWeight: "700" },
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#0D3278", fillOpacity: 1, strokeColor: "#FFFFFF", strokeWeight: 2, scale: 14 },
        });
      }
      if (path.length > 1) {
        const line = (p: { lat: number; lng: number }[], dashed: boolean) =>
          new google.maps.Polyline({
            path: p,
            map: mapObj,
            strokeColor: "#E0A526",
            strokeOpacity: dashed ? 0.7 : 0.95,
            strokeWeight: dashed ? 3 : 5,
          });
        void getTripRoute({ data: { points: path.slice(0, 27) } })
          .then((r) => {
            if (r.polyline) line(decodePolyline(r.polyline), false);
            else {
              console.error("[map] road route unavailable, drawing straight lines:", r.error);
              line(path, true);
            }
          })
          .catch((e: unknown) => {
            console.error("[map] route request failed:", e);
            line(path, true);
          });
      }
      if (ext) {
        const CORNER = 0.004;
        mapObj.fitBounds({
          south: ext.minLat - CORNER,
          west: ext.minLng - CORNER,
          north: ext.maxLat + CORNER,
          east: ext.maxLng + CORNER,
        });
      } else {
        mapObj.setCenter(LATUR);
        mapObj.setZoom(14);
      }
    },
    [stops, origin],
  );

  // Load the API once and draw.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { key } = await getGoogleMapsKey();
        if (!key) {
          setState("error");
          return;
        }
        await loadMaps(key);
        if (!alive || !holder.current) return;
        if (!map.current) {
          map.current = new google.maps.Map(holder.current, {
            zoom: 13,
            center: LATUR,
            clickableIcons: false,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "greedy",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        }
        draw(map.current);
        setState("ready");
        // Google renders its own error overlay (bad/restricted key, billing):
        // detect it a beat after load and fall back to the friendly card.
        const check = () => {
          if (!alive || !holder.current) return;
          if (holder.current.querySelector(".gm-err-container, .gm-err-content")) setState("error");
        };
        for (const ms of [1500, 4000, 10000]) setTimeout(check, ms);
        (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
          if (alive) setState("error");
        };
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [draw]);

  // Follow the driver's position while the screen is open.
  useEffect(() => {
    if (state !== "ready") return;
    const tick = async () => {
      const c = await getCoords();
      if (c) setMe({ lat: c.latitude, lng: c.longitude });
    };
    void tick();
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      watch.current = navigator.geolocation.watchPosition(
        (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 15000 },
      );
    }
    return () => {
      if (watch.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watch.current);
    };
  }, [state]);

  // Current-position dot (redrawn on change).
  useEffect(() => {
    if (!map.current || !me) return;
    new google.maps.Marker({
      position: me,
      map: map.current,
      zIndex: 999,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#0D3278",
        fillOpacity: 1,
        strokeColor: "#FFFFFF",
        strokeWeight: 3,
        scale: 9,
      },
    });
  }, [me]);

  const navigate = () => {
    if (!nextStop) return;
    void haptic("light");
    void openExternal(
      `https://www.google.com/maps/dir/?api=1&destination=${nextStop.lat},${nextStop.lng}&travelmode=driving&dir_action=navigate`,
    );
  };

  // The map holder stays mounted even on error: removing the element Google
  // has attached to makes its internal IntersectionObserver throw.
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div ref={holder} className="h-56 w-full bg-muted" style={{ display: state === "ready" ? "block" : "none" }} />
      {state === "error" && (
        <div className="p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("dr.mapUnavailable")}</p>
        </div>
      )}
      {state === "loading" && (
        <div className="grid h-56 place-items-center gap-2 bg-muted">
          <Loader className="h-6 w-6 animate-pulse text-muted-foreground" />
        </div>
      )}
      {nextStop && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground">{t("dr.nextStop")}</p>
            <p className="truncate font-display text-sm font-bold text-foreground">
              {nextStop.seq}. {nextStop.label}
            </p>
          </div>
          <button
            onClick={navigate}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-soft active:opacity-80"
          >
            <Navigation className="h-4 w-4" /> {t("dr.navigate")}
          </button>
        </div>
      )}
    </div>
  );
}
