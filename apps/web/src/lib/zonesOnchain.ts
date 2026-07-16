/**
 * Zones interprétées des métriques de cycle on-chain (seuils canoniques
 * Glassnode/bitcoin-data, documentés dans la NoteSource de CHAIN).
 * Pur — les valeurs viennent des aux bitcoin-data déjà câblés.
 */
import type { TonBadge } from "../components/ui";

export interface ZoneOnchain {
  libelle: string;
  ton: TonBadge;
}

/** MVRV Z-Score : < 0 froid · 0..3 neutre · 3..7 chaud · ≥ 7 surchauffe. */
export function zoneMvrvZ(v: number): ZoneOnchain | null {
  if (!Number.isFinite(v)) return null;
  if (v < 0) return { libelle: "froid", ton: "up" };
  if (v < 3) return { libelle: "neutre", ton: "neutre" };
  if (v < 7) return { libelle: "chaud", ton: "warn" };
  return { libelle: "surchauffe", ton: "down" };
}

/** SOPR : pivot 1 — < 1 ventes à perte (capitulation), ≥ 1 ventes en profit. */
export function zoneSopr(v: number): ZoneOnchain | null {
  if (!Number.isFinite(v)) return null;
  return v < 1 ? { libelle: "capitulation", ton: "down" } : { libelle: "profit", ton: "neutre" };
}

/** NUPL : < 0 capitulation · 0..0.25 espoir · 0.25..0.5 optimisme · 0.5..0.75 croyance · ≥ 0.75 euphorie. */
export function zoneNupl(v: number): ZoneOnchain | null {
  if (!Number.isFinite(v)) return null;
  if (v < 0) return { libelle: "capitulation", ton: "down" };
  if (v < 0.25) return { libelle: "espoir", ton: "neutre" };
  if (v < 0.5) return { libelle: "optimisme", ton: "neutre" };
  if (v < 0.75) return { libelle: "croyance", ton: "warn" };
  return { libelle: "euphorie", ton: "down" };
}

/** Routeur par id BG_METRIQUES (« mvrv » = MVRV Z-Score) ; ids sans zone → null. */
export function zonePourMetrique(id: string, v: number | null | undefined): ZoneOnchain | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (id === "mvrv") return zoneMvrvZ(v);
  if (id === "sopr") return zoneSopr(v);
  if (id === "nupl") return zoneNupl(v);
  return null;
}
