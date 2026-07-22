/// <reference types="astro/client" />

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
    danjipyoTrack: (event: string, params?: Record<string, unknown>) => boolean;
  }
}

export {};
