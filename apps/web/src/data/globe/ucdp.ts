/**
 * Conflits armés confirmés UCDP (Candidate GED, ~1 mois de retard) — servis par
 * le daemon (/globe/conflits-ucdp, instantané 24 h + stale). Donnée mensuelle :
 * un mémo module suffit, un seul fetch par session. Sans daemon → null.
 */
import { detectDaemon, urlDaemon } from "../daemon";
import type { EtatConflitsUcdp, ZoneConflitUcdp } from "./types";

let memo: EtatConflitsUcdp | null = null;

function estNombre(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Parse défensif de la réponse /globe/conflits-ucdp. */
export function parseConflitsUcdp(json: unknown): EtatConflitsUcdp | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (!estNombre(r.majA) || typeof r.fichier !== "string" || !Array.isArray(r.zones)) return null;
  const zones: ZoneConflitUcdp[] = [];
  for (const brut of r.zones) {
    if (typeof brut !== "object" || brut === null) continue;
    const z = brut as Record<string, unknown>;
    if (!estNombre(z.lat) || !estNombre(z.lon) || !estNombre(z.morts) || !estNombre(z.n) || !estNombre(z.dernierMs)) continue;
    zones.push({
      lat: z.lat, lon: z.lon, morts: z.morts, n: z.n,
      sideA: typeof z.sideA === "string" ? z.sideA : null,
      sideB: typeof z.sideB === "string" ? z.sideB : null,
      dernierMs: z.dernierMs,
    });
  }
  return { zones, majA: r.majA, fichier: r.fichier };
}

/**
 * Invalide le mémo session (ex. après redémarrage daemon, ou forcer re-fetch
 * à chaque ouverture de fenêtre).
 */
export function invaliderMemoUcdp(): void {
  memo = null;
}

/**
 * Charge les zones UCDP. Mémo session après succès.
 * null = daemon absent / échec / réponse non-JSON (daemon périmé servant le SPA).
 */
export async function chargerConflitsUcdp(signal?: AbortSignal): Promise<EtatConflitsUcdp | null> {
  if (memo !== null) return memo;
  if (!(await detectDaemon("globe"))) return null;
  try {
    const res = await fetch(urlDaemon("/globe/conflits-ucdp"), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    // Daemon trop vieux : /globe/* tombe dans le repli SPA → HTML 200.
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return null;
    const etat = parseConflitsUcdp((await res.json()) as unknown);
    if (etat !== null) memo = etat;
    return etat;
  } catch {
    return null;
  }
}
