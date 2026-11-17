import { useEffect, useState } from "react";
import logoWhite from "@/assets/sunrich-logo-white.png.asset.json";

/** Full-screen launch like the customer LaunchScreen. /launch-delivery.webp covers the gradient once supplied. */
export function LaunchScreen() {
  const [photo, setPhoto] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setPhoto(true);
    img.src = "/launch-delivery.webp";
  }, []);
  return (
    <div className="launch-screen" role="status" aria-label="Sunrich Delivery" data-testid="launch-screen">
      {photo && <div className="launch-photo" />}
      <div className="launch-shade" />
      {!photo && (
        <svg className="launch-wave" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden>
          <path fill="currentColor" fillOpacity="0.18" d="M0,192L60,186.7C120,181,240,171,360,181.3C480,192,600,224,720,218.7C840,213,960,171,1080,154.7C1200,139,1320,149,1380,154.7L1440,160L1440,320L0,320Z" />
          <path fill="currentColor" fillOpacity="0.28" d="M0,256L80,240C160,224,320,192,480,197.3C640,203,800,245,960,250.7C1120,256,1280,224,1360,208L1440,192L1440,320L0,320Z" />
        </svg>
      )}
      <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+12vh)] flex flex-col items-center gap-1.5 drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
        <img src={logoWhite.url} alt="Sunrich" className="h-14 w-auto max-w-[240px] object-contain" />
        <span className="launch-gold font-display text-sm font-extrabold tracking-[0.3em]">DELIVERY</span>
        <span className="mt-2 font-deva text-base font-semibold tracking-wide">शुद्ध पियो, खूब जियो</span>
      </div>
      <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+10vh)] flex justify-center"><span className="app-loader-ring" /></div>
    </div>
  );
}

/** Keeps the launch screen up until sign-in state is known (and at least briefly, to avoid a flash). */
export function useLaunchGate(ready: boolean, minMs = 700) {
  const [min, setMin] = useState(false);
  useEffect(() => { const id = setTimeout(() => setMin(true), minMs); return () => clearTimeout(id); }, [minMs]);
  return !(ready && min);
}
