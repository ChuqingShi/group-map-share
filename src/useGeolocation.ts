// Wraps navigator.geolocation.watchPosition. With `?sim` in the URL it walks a
// fake position around instead, for testing on desktop or in headless browsers.
import { useEffect, useState } from 'react';

export interface Fix {
  lat: number;
  lng: number;
  acc: number | null;
}

export type GeoError = 'denied' | 'unavailable' | 'insecure' | 'unsupported' | null;

function simStart(): Fix | null {
  const sim = new URLSearchParams(location.search).get('sim');
  if (sim === null) return null;
  const [lat, lng] = sim.split(',').map(Number);
  // Default: Santa Monica beach, which shows ocean, sand, parks and town together.
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, acc: 5 };
  return { lat: 34.0094 + (Math.random() - 0.5) * 0.006, lng: -118.4965 + (Math.random() - 0.5) * 0.006, acc: 5 };
}

export function useGeolocation(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<GeoError>(null);

  useEffect(() => {
    if (!enabled) {
      setFix(null);
      return;
    }
    setError(null);

    const sim = simStart();
    if (sim) {
      let { lat, lng } = sim;
      let heading = Math.random() * Math.PI * 2;
      setFix({ ...sim });
      const id = setInterval(() => {
        heading += (Math.random() - 0.5) * 0.8;
        lat += Math.cos(heading) * 0.00006;
        lng += Math.sin(heading) * 0.00007;
        setFix({ lat, lng, acc: 5 });
      }, 1500);
      return () => clearInterval(id);
    }

    if (!window.isSecureContext) {
      setError('insecure');
      return;
    }
    if (!('geolocation' in navigator)) {
      setError('unsupported');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null });
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, error };
}
