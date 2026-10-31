// Server function: hands the Google Maps JS key to the browser at runtime.
// The key is a server-only secret (GOOGLE_MAPS_API_KEY), never a VITE_ variable.
import { createServerFn } from "@tanstack/react-start";

export type MapsConfig = { key: string | null };

export const getGoogleMapsKey = createServerFn({ method: "GET" }).handler(async (): Promise<MapsConfig> => {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? null;
  return { key: key && key.trim() ? key.trim() : null };
});
