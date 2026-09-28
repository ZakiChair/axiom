import { useSyncExternalStore } from "react";

/** Une seule frontière pour le shell, les menus et la grille. Le paysage tactile
 * reste utilisable sans appliquer la mise en page téléphone à un petit desktop. */
export const MOBILE_LAYOUT_QUERY = "(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)";

export function mobileLayoutSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

export function subscribeMobileLayout(notify: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export function useMobileLayout(): boolean {
  return useSyncExternalStore(subscribeMobileLayout, mobileLayoutSnapshot, () => false);
}
