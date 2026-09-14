/**
 * Mineurs BTC — Hash Ribbons et hashprice (section « Mineurs » de CHAIN).
 *
 * - Hash Ribbons : moyennes mobiles simples courte (30 j) et longue (60 j) du hashrate
 *   daily (mempool.space, déjà chargé par CHAIN). Courte SOUS la longue = capitulation
 *   des mineurs ; croisement haussier récent (≤ 30 j) = reprise ; sinon expansion.
 * - Hashprice : revenus quotidiens des mineurs en USD (blockchain.info, subvention +
 *   frais, valorisés au prix du jour) rapportés au hashrate moyen du même jour UTC,
 *   exprimés en USD par PH/s et par jour. Les jours absents d'une des deux séries sont
 *   ignorés (le jour courant de mempool.space est une moyenne PARTIELLE).
 *
 * blockchain.info se lit EN DIRECT (`cors=true`, comme `blockchainNvt.ts`) ; cache 6 h
 * et dégradation gracieuse calquées sur `fetchHashrate`.
 * Calculs PURS testés dans `mineurs.test.ts`.
 */
import { latestPointByUtcDay, parseBlockchainChart, utcDay } from "./blockchainNvt";
import { ecrireCache, estFrais, lireCache } from "./cache";
import type { PointMetrique, SerieMetrique } from "./coinmetrics";
import type { ResultatFrais } from "./mempool";

const BASE = "https://api.blockchain.info/charts/miners-revenue";
/** TTL revenus mineurs : 6 h (série daily). */
export const BC_TTL_REVENUS_MS = 6 * 60 * 60 * 1000;
/** Fenêtres des rubans (jours) — définition Capriole. */
export const RIBBONS_COURTE = 30;
export const RIBBONS_LONGUE = 60;
/** Une reprise reste « récente » pendant 30 jours après le croisement haussier. */
const REPRISE_RECENTE_MS = 30 * 86_400_000;

export type EtatRibbons = "capitulation" | "reprise" | "expansion";

export interface HashRibbons {
  courte: PointMetrique[];
  longue: PointMetrique[];
  /** null si la série est trop courte pour la fenêtre longue. */
  etat: EtatRibbons | null;
  /** Dernier croisement des deux rubans, null s'il n'y en a jamais eu. */
  croisement: { time: number; sens: "haussier" | "baissier" } | null;
}

/** Moyenne mobile simple, un point par fin de fenêtre. PURE. */
export function moyenneMobile(points: readonly PointMetrique[], fenetre: number): PointMetrique[] {
  const out: PointMetrique[] = [];
  if (fenetre <= 0 || points.length < fenetre) return out;
  let somme = 0;
  for (let i = 0; i < points.length; i += 1) {
    somme += points[i]!.value;
    if (i >= fenetre) somme -= points[i - fenetre]!.value;
    if (i >= fenetre - 1) out.push({ time: points[i]!.time, value: somme / fenetre });
  }
  return out;
}

/** Rubans de hashrate et état courant. PURE. */
export function calculerHashRibbons(
  hashrate: readonly PointMetrique[],
  courteJours = RIBBONS_COURTE,
  longueJours = RIBBONS_LONGUE,
): HashRibbons {
  const courte = moyenneMobile(hashrate, courteJours);
  const longue = moyenneMobile(hashrate, longueJours);
  if (longue.length === 0) return { courte: [], longue: [], etat: null, croisement: null };

  // Les deux rubans partagent les horodatages de la série ; on aligne sur la longue.
  const courteParTemps = new Map(courte.map((p) => [p.time, p.value]));
  let croisement: HashRibbons["croisement"] = null;
  let sousPrecedent: boolean | null = null;
  for (const p of longue) {
    const c = courteParTemps.get(p.time);
    if (c === undefined) continue;
    const sous = c < p.value;
    if (sousPrecedent !== null && sous !== sousPrecedent) {
      croisement = { time: p.time, sens: sous ? "baissier" : "haussier" };
    }
    sousPrecedent = sous;
  }

  const dernier = longue[longue.length - 1]!;
  let etat: EtatRibbons;
  if (sousPrecedent === true) etat = "capitulation";
  else if (croisement?.sens === "haussier" && dernier.time - croisement.time <= REPRISE_RECENTE_MS) etat = "reprise";
  else etat = "expansion";
  return { courte, longue, etat, croisement };
}

/** Hashprice en USD par PH/s et par jour, jointure par jour UTC. PURE. */
export function calculerHashprice(
  revenusUsd: readonly PointMetrique[],
  hashrateHs: readonly PointMetrique[],
): SerieMetrique {
  const revenusParJour = latestPointByUtcDay(revenusUsd);
  const hashrateParJour = latestPointByUtcDay(hashrateHs);
  const points: PointMetrique[] = [];
  for (const [jour, revenu] of revenusParJour) {
    const hr = hashrateParJour.get(jour);
    if (hr === undefined || hr.value <= 0) continue;
    const value = revenu.value / (hr.value / 1e15);
    if (Number.isFinite(value)) points.push({ time: utcDay(jour), value });
  }
  points.sort((a, b) => a.time - b.time);
  return { points, dernier: points.length > 0 ? points[points.length - 1] : undefined };
}

/** Revenus quotidiens des mineurs en USD, 1 an (cache 6 h, dégradation gracieuse). */
export async function fetchRevenusMineurs(
  signal?: AbortSignal,
): Promise<ResultatFrais<PointMetrique[]> | null> {
  const cle = "bc:miners-revenue";
  const cache = await lireCache<PointMetrique[]>(cle);
  if (estFrais(cache, BC_TTL_REVENUS_MS) && cache !== null) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }
  try {
    const query = new URLSearchParams({ timespan: "1year", format: "json", sampled: "false", cors: "true" });
    const res = await fetch(`${BASE}?${query.toString()}`, { signal });
    if (!res.ok) throw new Error(`blockchain.info miners-revenue ${res.status}`);
    const points = parseBlockchainChart((await res.json()) as unknown);
    if (points.length === 0) throw new Error("blockchain.info miners-revenue vide");
    await ecrireCache(cle, points);
    return { donnee: points, ts: Date.now(), perime: false };
  } catch {
    if (cache !== null) return { donnee: cache.donnee, ts: cache.ts, perime: true };
    return null;
  }
}
