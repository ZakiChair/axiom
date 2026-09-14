/**
 * Flux nets des exchanges — Coin Metrics Community (sans clé, CORS ouvert, appel direct).
 *
 * Flux net quotidien = FlowInExNtv − FlowOutExNtv (natif) et FlowInExUSD − FlowOutExUSD
 * (USD), sur les adresses labellisées exchanges PAR COIN METRICS : labels incomplets, périmètre
 * révisable, et statut « flash » (valeurs récentes révisables) sur tout l'historique BTC.
 *
 * La RÉSERVE BTC des exchanges (SplyExNtv) n'est volontairement PAS publiée : depuis avril
 * 2026 le stock labellisé s'écarte systématiquement des flux cumulés (+200 k BTC sur 90 j),
 * signe d'ajouts de labels que les flux n'intègrent pas.
 *
 * Fonctions PURES (testées) + chargeur BTC dédié : fenêtre 800 j (le z du Σ30 sur 730 j
 * exige 759 jours consécutifs), cache 6 h de la série DÉRIVÉE seule, un seul téléchargement
 * partagé entre la vue commune des flux de capitaux et le groupe Exchanges de CHAIN.
 */
import { ecrireCache, estFrais, lireCache } from "./cache";
import { chargerLignesCoinMetrics, CM_TTL_MS, parseCoinMetrics, type PointMetrique } from "./coinmetrics";
import { healthStore } from "../../store/health";

const JOUR_MS = 86_400_000;
export const FENETRE_FLUX_JOURS = 800;
export const Z_FENETRE_JOURS = 30;
export const Z_HISTORIQUE_JOURS = 730;
const METRIQUES_BTC = ["FlowInExNtv", "FlowOutExNtv", "FlowInExUSD", "FlowOutExUSD"] as const;
const CLE_CACHE = "cm:btc:flux-exchanges";
/** Délai maximal du téléchargement partagé (aucun consommateur ne peut l'annuler seul). */
const DELAI_MS = 15_000;

/** Flux net quotidien = entrées − sorties, joint par date exacte (00:00 UTC). PURE. */
export function fluxNetQuotidien(entrees: readonly PointMetrique[], sorties: readonly PointMetrique[]): PointMetrique[] {
  const parJour = new Map(sorties.map((p) => [p.time, p.value]));
  const net: PointMetrique[] = [];
  for (const p of entrees) {
    const sortie = parJour.get(p.time);
    if (sortie !== undefined) net.push({ time: p.time, value: p.value - sortie });
  }
  return net.sort((a, b) => a.time - b.time);
}

/** Les `n` derniers points s'ils forment des jours consécutifs, sinon null. */
function derniersJoursConsecutifs(points: readonly PointMetrique[], n: number): readonly PointMetrique[] | null {
  if (n < 1 || points.length < n) return null;
  const fin = points.slice(-n);
  for (let i = 1; i < fin.length; i += 1) if (fin[i]!.time - fin[i - 1]!.time !== JOUR_MS) return null;
  return fin;
}

/** Somme des `jours` derniers points consécutifs finissant au dernier point ; null si un jour manque. PURE. */
export function sommeJours(points: readonly PointMetrique[], jours: number): number | null {
  const fin = derniersJoursConsecutifs(points, jours);
  return fin === null ? null : fin.reduce((s, p) => s + p.value, 0);
}

/**
 * z du Σ`fenetre` courant contre les `historique` Σ glissants (courant inclus), écart-type
 * population ; null si historique incomplet, trou ou écart-type nul. PURE.
 */
export function zScoreSommeGlissante(
  points: readonly PointMetrique[],
  fenetre = Z_FENETRE_JOURS,
  historique = Z_HISTORIQUE_JOURS,
): number | null {
  const fin = derniersJoursConsecutifs(points, fenetre + historique - 1);
  if (fin === null) return null;
  const sommes: number[] = [];
  for (let debut = 0; debut < historique; debut += 1) {
    let s = 0;
    for (let i = debut; i < debut + fenetre; i += 1) s += fin[i]!.value;
    sommes.push(s);
  }
  const moyenne = sommes.reduce((a, b) => a + b, 0) / historique;
  const ecartType = Math.sqrt(sommes.reduce((a, s) => a + (s - moyenne) ** 2, 0) / historique);
  if (!(ecartType > 0)) return null;
  const z = (sommes.at(-1)! - moyenne) / ecartType;
  return Number.isFinite(z) ? z : null;
}

/** Dernier `<metrique>-status` non nul des lignes brutes Coin Metrics (« flash », « reviewed ») ou null. PURE. */
export function dernierStatutCm(lignes: readonly unknown[], metrique: string): string | null {
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const statut = (lignes[i] as Record<string, unknown> | null)?.[`${metrique}-status`];
    if (typeof statut === "string") return statut;
  }
  return null;
}

export interface ResumeFluxNet {
  j1: number | null;
  j7: number | null;
  j30: number | null;
  usdJ1: number | null;
  usdJ7: number | null;
  usdJ30: number | null;
  z30: number | null;
  observeLe: number | null;
}

/**
 * Résumé 1/7/30 j (natif et USD) + z du Σ30 sur 730 j d'une série de flux net quotidien.
 * Les sommes USD ne sont calculées que si la série USD finit le même jour que la native. PURE.
 */
export function resumerFluxNet(net: readonly PointMetrique[], netUsd: readonly PointMetrique[] = []): ResumeFluxNet {
  const observeLe = net.at(-1)?.time ?? null;
  const usdAligne = observeLe !== null && netUsd.at(-1)?.time === observeLe;
  const usd = (jours: number) => (usdAligne ? sommeJours(netUsd, jours) : null);
  return {
    j1: sommeJours(net, 1),
    j7: sommeJours(net, 7),
    j30: sommeJours(net, 30),
    usdJ1: usd(1),
    usdJ7: usd(7),
    usdJ30: usd(30),
    z30: zScoreSommeGlissante(net),
    observeLe,
  };
}

interface FluxExchangesCache {
  points: PointMetrique[];
  pointsUsd: PointMetrique[];
  flash: boolean;
}

/** Même forme que `StablecoinsFluxCharge` (source de la vue commune) + USD et statut flash. */
export interface FluxExchangesCharge extends FluxExchangesCache {
  recupereLe: number;
  disponible: boolean;
  perime: boolean;
  repli?: boolean;
  raison?: string;
}

export interface OptionsFluxExchanges {
  now?: () => number;
}

let enCours: Promise<FluxExchangesCharge> | null = null;

async function telecharger(now: () => number): Promise<FluxExchangesCharge> {
  const cache = await lireCache<FluxExchangesCache>(CLE_CACHE);
  if (cache !== null && estFrais(cache, CM_TTL_MS)) {
    return { ...cache.donnee, recupereLe: cache.ts, disponible: true, perime: false };
  }
  try {
    const debut = new Date(now() - FENETRE_FLUX_JOURS * JOUR_MS).toISOString().slice(0, 10);
    const lignes = await chargerLignesCoinMetrics(METRIQUES_BTC, AbortSignal.timeout(DELAI_MS), { asset: "btc", debut });
    const series = parseCoinMetrics({ data: lignes }, "btc", METRIQUES_BTC);
    const points = fluxNetQuotidien(series["FlowInExNtv"]?.points ?? [], series["FlowOutExNtv"]?.points ?? []);
    if (points.length === 0) throw new Error("Coin Metrics flux exchanges vide");
    const donnee: FluxExchangesCache = {
      points,
      pointsUsd: fluxNetQuotidien(series["FlowInExUSD"]?.points ?? [], series["FlowOutExUSD"]?.points ?? []),
      flash: dernierStatutCm(lignes, "FlowInExNtv") === "flash" || dernierStatutCm(lignes, "FlowOutExNtv") === "flash",
    };
    await ecrireCache(CLE_CACHE, donnee);
    healthStore.getState().setEtat("coinmetrics", "polling", { dernierMessageTs: Date.now() });
    return { ...donnee, recupereLe: now(), disponible: true, perime: false };
  } catch (erreur) {
    const raison = erreur instanceof Error ? erreur.message : "source injoignable";
    healthStore.getState().marquerErreur("coinmetrics", raison);
    return cache !== null
      ? { ...cache.donnee, recupereLe: cache.ts, disponible: true, perime: true, repli: true, raison: `Cache périmé · ${raison}` }
      : { points: [], pointsUsd: [], flash: false, recupereLe: now(), disponible: false, perime: false, raison };
  }
}

/**
 * Flux nets BTC des exchanges (800 j), cache 6 h, dégradation gracieuse sans exception.
 * Un seul téléchargement en vol est partagé par tous les consommateurs ; il n'est borné que
 * par son délai, pour qu'un panneau qui se ferme n'annule pas la collecte d'un autre.
 */
export function chargerFluxExchangesBtc(options: OptionsFluxExchanges = {}): Promise<FluxExchangesCharge> {
  enCours ??= telecharger(options.now ?? Date.now).finally(() => {
    enCours = null;
  });
  return enCours;
}
