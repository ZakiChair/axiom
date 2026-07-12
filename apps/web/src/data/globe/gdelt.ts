/**
 * Événements géopolitiques GDELT — servis par le DAEMON (routes /globe/evenements
 * et /globe/evenements/zone, cf. apps/daemon/src/globe.ts) : l'amont GDELT est
 * http-only + zip, intraitable depuis le navigateur. Sans daemon, la couche
 * dégrade en silence (null → note « daemon hors ligne » dans la fenêtre).
 * Pattern du repo : parse PUR testé / chargerXxx réseau non testé, jamais d'exception.
 */
import { detectDaemon, urlDaemon } from "../daemon";
import type { CategorieEvenement, CelluleEvenements, EtatEvenements, EvenementDetail } from "./types";

/** Cadence de poll de la fenêtre (alignée sur la publication GDELT 15 min). */
export const INTERVALLE_POLL_EVENEMENTS_MS = 15 * 60_000;

const CATEGORIES: ReadonlySet<string> = new Set(["materiel", "coercition", "protestation"]);

function estNombre(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Une url n'est retenue que si absolue http(s) (défense en profondeur XSS, cf. revue T5). */
function urlSure(v: unknown): string | null {
  return typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://")) ? v : null;
}

function parseCellule(brut: unknown): CelluleEvenements | null {
  if (typeof brut !== "object" || brut === null) return null;
  const c = brut as Record<string, unknown>;
  if (!estNombre(c.lat) || !estNombre(c.lon) || !estNombre(c.n) || !estNombre(c.intensite) || !estNombre(c.mentions) || !estNombre(c.dernierMs)) return null;
  if (typeof c.categorie !== "string" || !CATEGORIES.has(c.categorie)) return null;
  return { lat: c.lat, lon: c.lon, categorie: c.categorie as CategorieEvenement, n: c.n, intensite: c.intensite, mentions: c.mentions, dernierMs: c.dernierMs };
}

/** Parse défensif de la réponse /globe/evenements. */
export function parseEvenements(json: unknown): EtatEvenements | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.cellules)) return null;
  const majA = estNombre(r.majA) ? r.majA : null;
  let couverture: EtatEvenements["couverture"] = null;
  if (typeof r.couverture === "object" && r.couverture !== null) {
    const c = r.couverture as Record<string, unknown>;
    if (estNombre(c.deMs) && estNombre(c.aMs)) couverture = { deMs: c.deMs, aMs: c.aMs };
  }
  const cellules: CelluleEvenements[] = [];
  for (const brut of r.cellules) {
    const cellule = parseCellule(brut);
    if (cellule !== null) cellules.push(cellule);
  }
  return { cellules, majA, couverture };
}

/** Parse défensif de la réponse /globe/evenements/zone. */
export function parseZone(json: unknown): EvenementDetail[] | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.evenements)) return null;
  const evenements: EvenementDetail[] = [];
  for (const brut of r.evenements) {
    if (typeof brut !== "object" || brut === null) continue;
    const e = brut as Record<string, unknown>;
    if (!estNombre(e.dateMs) || typeof e.categorie !== "string" || !CATEGORIES.has(e.categorie)) continue;
    evenements.push({
      dateMs: e.dateMs,
      categorie: e.categorie as CategorieEvenement,
      codeCameo: typeof e.codeCameo === "string" ? e.codeCameo : "",
      goldstein: estNombre(e.goldstein) ? e.goldstein : 0,
      mentions: estNombre(e.mentions) ? e.mentions : 0,
      acteur1: typeof e.acteur1 === "string" ? e.acteur1 : null,
      acteur2: typeof e.acteur2 === "string" ? e.acteur2 : null,
      url: urlSure(e.url),
    });
  }
  return evenements;
}

/** Charge la fenêtre agrégée. null = daemon absent/en échec (dégradation silencieuse). */
export async function chargerEvenements(signal?: AbortSignal): Promise<EtatEvenements | null> {
  if (!(await detectDaemon())) return null;
  try {
    const res = await fetch(urlDaemon("/globe/evenements?fenetreH=24"), { signal });
    if (!res.ok) return null;
    return parseEvenements((await res.json()) as unknown);
  } catch {
    return null;
  }
}

/** Charge le détail d'une cellule (clic). null = daemon absent/en échec. */
export async function chargerZoneEvenements(lat: number, lon: number, signal?: AbortSignal): Promise<EvenementDetail[] | null> {
  if (!(await detectDaemon())) return null;
  try {
    const res = await fetch(urlDaemon(`/globe/evenements/zone?lat=${lat}&lon=${lon}&fenetreH=24`), { signal });
    if (!res.ok) return null;
    return parseZone((await res.json()) as unknown);
  } catch {
    return null;
  }
}
