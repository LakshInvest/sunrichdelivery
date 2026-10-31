// Trip stop map on Google Maps: numbered markers coloured by stop status, the
// driver's current position and the route line between stops. Loads the Maps JS
// API lazily with the server-minted key; renders nothing until mounted.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/l10n";
import { getGoogleMapsKey } from "@/lib/maps.functions";
import { getCoords } from "@/components/team/driver-parts";
import { openExternal, haptic } from "@/lib/native";
import { Navigation, LoaderPin } from "lucide-react";

type MapStop = {
  id: string;
  seq: number;
  status: string;
  lat: number | null;
  lng: number | null;
  label: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#0AAAED",
  arrived: "#F59E0B",
  delivered: "#16A34A",
  partial: "#16A34A",
  failed: "#EF4444",
};

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
    Marker: new (opts: Record<string, unknown>) => unknown;
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

export function StopMap({ stops, tripId }: { stops: MapStop[]; tripId: string }) {
  const { t, lang } = useLang();
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
      const bounds: (typeof google.maps) | null = null;
      void bounds;
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
      if (pts.length > 1) {
        new google.maps.Polyline({
          path: pts.map(({ pos }) => pos),
          map: mapObj,
          strokeColor: "#0AAAED",
          strokeOpacity: 0.9,
          strokeWeight: 3,
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
      } else if (me) {
        mapObj.setCenter(me);
        mapObj.setZoom(14);
      }
    },
    [stops, me],
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
            center: { lat: 19.076, lng: 72.8777 },
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
      if (c) setMe(c);
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

  if (state === "error") {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
        <p className="text-sm text-muted-foreground">{t("dr.mapUnavailable")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div ref={holder} className="h-56 w-full bg-muted" style={{ display: state === "ready" ? "block" : "none" }} />
      {state !== "ready" && (
        <div className="grid h-56 place-items-center gap-2 bg-muted">
          <LoaderPin className="h-6 w-6 animate-pulse text-muted-foreground" />
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
      <span className="sr-only">{lang}</span>
    </div>
  );
}
