/**
 * Flux ETF spot BTC/ETH/SOL — SoSoValue (openapi.sosovalue.com).
 *
 * Remplace l'ancien module DefiLlama (mort : tous les endpoints `/overview/etfs`
 * renvoient 404/500, vérifié 2026-07-02). SoSoValue couvre BTC + ETH + SOL avec un
 * seul provider (ETF spot Solana actifs depuis approbation SEC 10/2025).
 *
 * ⚠️ Endpoint RÉEL confirmé par curl direct le 2026-07-08 (la doc gitbook n'a pas pu
 * être lue automatiquement) :
 *   POST https://openapi.sosovalue.com/openapi/v2/etf/currentEtfDataMetrics
 *   Headers : x-soso-api-key: <clé>, Content-Type: application/json
 *   Body    : { "type": "us-btc-spot" | "us-eth-spot" | "us-sol-spot" }
 *   → GET sur ce chemin renvoie 405 Method Not Allowed ; POST obligatoire.
 *   Réponse : { code, msg, traceId, data: { dailyNetInflow:{value,lastUpdateDate,status},
 *     …, list: [ { ticker, institute, dailyNetInflow:{value,lastUpdateDate,status}, … } ] } }
 *   (`historicalInflowChart` existe aussi — historique multi-jours — mais
 *   `currentEtfDataMetrics` suffit pour le flux du jour par émetteur voulu ici.)
 * CORS ouvert, mais on route via le proxy /sosoapi (Vite en dev, daemon en prod) pour
 * bénéficier de la clé de REPLI lue dans apps/web/.env (SOSOVALUE_API_KEY) : la clé
 * personnelle des Réglages, si saisie, est envoyée en en-tête et reste PRIORITAIRE
 * (le proxy n'écrase jamais un x-soso-api-key déjà présent). Sans clé nulle part,
 * l'amont répond 401 → raison explicite affichée dans le panneau.
 * Plan Demo/Beta gratuit, 20 req/min : sosovalue.com/developer.
 */
import { healthStore } from "../../store/health";
import { IS_VERCEL } from "../../lib/deployment";
import { ecrireCache, estFrais, lireCache } from "./cache";
import { nombreOnchain } from "./cohorts";

export type ActifEtf = "btc" | "eth" | "sol";

export interface AnalyseJourEtf {
  observeLe: number | null;
  ageJours: number | null;
  raison?: string;
}

/** Validation calendaire UTC commune aux lectures ETF du régime et de CHAIN. */
export function analyserJourEtf(jour: string | null | undefined, now: number): AnalyseJourEtf {
  if (jour === null || jour === undefined) return { observeLe: null, ageJours: null, raison: "Date de séance absente." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return { observeLe: null, ageJours: null, raison: "Date de séance invalide." };
  const observeLe = Date.parse(`${jour}T00:00:00.000Z`);
  if (!Number.isFinite(observeLe) || new Date(observeLe).toISOString().slice(0, 10) !== jour) {
    return { observeLe: null, ageJours: null, raison: "Date de séance invalide." };
  }
  if (observeLe > now) return { observeLe: null, ageJours: null, raison: "Date de séance future rejetée." };
  return { observeLe, ageJours: Math.floor((now - observeLe) / 86_400_000) };
}

const BASE = "/sosoapi/openapi/v2/etf/currentEtfDataMetrics";
export const ETF_TTL_MS = 6 * 60 * 60 * 1000;
/** Identifiant dans le panneau « Santé sources » (même registre que coinmetrics/mempool). */
const SOURCE_SANTE = "sosovalue";
/**
 * Raison renvoyée sur 401/403 — exportée pour que l'UI ne propose le CTA « clé
 * SoSoValue ⚙ » QUE sur un échec effectivement lié à la clé (pas sur un 5xx/réseau).
 */
export const RAISON_CLE_SOSOVALUE =
  "Clé SoSoValue absente ou invalide (Réglages ⚙).";

export function sosoUnusableWithoutKey(isVercel: boolean, cle: string | null): boolean {
  return isVercel && (cle?.trim().length ?? 0) === 0;
}

/**
 * Convention des champs optionnels (par fonds et globaux) :
 *  - les FRACTIONS SoSoValue sont exposées ×100 — un champ `…Pct` est directement un
 *    pourcentage (`fee` 0,0025 → `fraisPct` 0,25) ;
 *  - un champ absent de la réponse ou non publié (`status "3"`) n'est PAS posé : clé omise,
 *    jamais `undefined` ni 0 (un 0 reçu avec `status "1"` est un vrai zéro et est conservé) ;
 *  - les entrées de cache antérieures à ces champs n'en portent aucun — l'affichage doit
 *    tolérer leur absence. `emetteur`, `flux`, `total` et le tri sont inchangés.
 */
export interface FluxEmetteur {
  emetteur: string;
  flux: number;
  /** Encours du fonds en USD (`netAssets`). */
  encoursUsd?: number;
  /**
   * Part de la CAPITALISATION de l'actif détenue par ce fonds, en % (`netAssetsPercentage`
   * ×100 : IBIT 0,03907 → 3,91 % de la capitalisation BTC). Ce n'est PAS sa part de
   * l'encours des ETF : la somme des fonds vaut `partCapitalisationTotalePct` (≈ 6,3 %).
   */
  partCapitalisationPct?: number;
  /** Cumul des flux nets depuis le lancement, en USD (`cumNetInflow`). */
  cumulUsd?: number;
  /** Volume échangé du jour en USD (`dailyValueTraded`). */
  volumeUsd?: number;
  /** Prime (+) ou décote (−) sur la valeur liquidative, en % (`discountPremiumRate` ×100). */
  primeDecotePct?: number;
  /** Frais annuels en % (`fee` ×100). */
  fraisPct?: number;
}

export interface EtfResultat {
  disponible: boolean;
  raison?: string;
  jour?: string;
  parEmetteur?: FluxEmetteur[];
  total?: number;
  /** Acquisition de cette valeur ; inchangée lors d'une relecture cache. */
  recupereLe?: number | null;
  sourceEffective?: string;
  /** Encours total des fonds en USD (`totalNetAssets`). */
  encoursTotalUsd?: number;
  /** Part de la capitalisation de l'actif détenue par l'ensemble des fonds, en % (×100). */
  partCapitalisationTotalePct?: number;
  /** Avoirs totaux en unités de l'actif — BTC, ETH ou SOL (`totalTokenHoldings`). */
  avoirsTotal?: number;
  /** Volume échangé du jour, tous fonds, en USD (`dailyTotalValueTraded`). */
  volumeTotalUsd?: number;
  /** Cumul des flux nets depuis le lancement, tous fonds, en USD (`cumNetInflow`). */
  cumulTotalUsd?: number;
}

/** Lit un champ `{ value }` SoSoValue (chaîne décimale) en nombre fini, sinon `undefined`. */
function lireValeur(champ: unknown): number | undefined {
  if (champ === null || typeof champ !== "object") return undefined;
  const { value, status } = champ as { value?: unknown; status?: unknown };
  if (status === "3" || status === 3) return undefined;
  return nombreOnchain(value) ?? undefined;
}

/** Fraction SoSoValue (0,0025) → pourcentage (0,25) ; l'absence est conservée. */
const enPct = (v: number | undefined): number | undefined => (v === undefined ? undefined : v * 100);

/** Ne garde que les champs lus : une clé absente ou non publiée n'est jamais posée (ni `undefined`, ni 0). */
function champsPresents<K extends string>(champs: Record<K, number | undefined>): Partial<Record<K, number>> {
  const presents: Partial<Record<K, number>> = {};
  for (const cle of Object.keys(champs) as K[]) {
    const v = champs[cle];
    if (v !== undefined) presents[cle] = v;
  }
  return presents;
}

/** Champs d'un fonds (`data.list[]`) et globaux (`data`) tels que reçus — chacun `{ value, lastUpdateDate, status }`. */
interface ChampsFonds {
  ticker?: unknown;
  dailyNetInflow?: unknown;
  netAssets?: unknown;
  netAssetsPercentage?: unknown;
  cumNetInflow?: unknown;
  dailyValueTraded?: unknown;
  discountPremiumRate?: unknown;
  fee?: unknown;
}
interface ChampsGlobaux {
  list?: unknown;
  dailyNetInflow?: unknown;
  totalNetAssets?: unknown;
  totalNetAssetsPercentage?: unknown;
  totalTokenHoldings?: unknown;
  dailyTotalValueTraded?: unknown;
  cumNetInflow?: unknown;
}

/** Parse une réponse SoSoValue `currentEtfDataMetrics` en flux par émetteur. PURE, défensive. */
export function parseEtfFlows(json: unknown): EtfResultat {
  const indisponible: EtfResultat = { disponible: false, raison: "Réponse SoSoValue non reconnue." };
  if (json === null || typeof json !== "object") return indisponible;

  const data = (json as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return indisponible;
  const { list, dailyNetInflow, ...globaux } = data as ChampsGlobaux;
  if (!Array.isArray(list) || list.length === 0) return indisponible;

  const parEmetteur: FluxEmetteur[] = [];
  for (const brut of list) {
    if (!brut || typeof brut !== "object") continue;
    const it = brut as ChampsFonds;
    const emetteur = typeof it.ticker === "string" ? it.ticker : undefined;
    const flux = lireValeur(it.dailyNetInflow);
    if (emetteur === undefined || flux === undefined) continue;
    parEmetteur.push({
      emetteur,
      flux,
      ...champsPresents({
        encoursUsd: lireValeur(it.netAssets),
        partCapitalisationPct: enPct(lireValeur(it.netAssetsPercentage)),
        cumulUsd: lireValeur(it.cumNetInflow),
        volumeUsd: lireValeur(it.dailyValueTraded),
        primeDecotePct: enPct(lireValeur(it.discountPremiumRate)),
        fraisPct: enPct(lireValeur(it.fee)),
      }),
    });
  }
  if (parEmetteur.length === 0) return indisponible;

  // Tri par |flux du jour| décroissant : les émetteurs qui bougent le plus (entrées OU
  // sorties) remontent en tête — la dispersion est le signal. Départage par ticker (ordre
  // stable et déterministe sous noUncheckedIndexedAccess, tests reproductibles).
  parEmetteur.sort((a, b) => {
    const diff = Math.abs(b.flux) - Math.abs(a.flux);
    return diff !== 0 ? diff : a.emetteur.localeCompare(b.emetteur);
  });

  const jourGlobal =
    dailyNetInflow !== null && typeof dailyNetInflow === "object"
      ? (dailyNetInflow as { lastUpdateDate?: unknown }).lastUpdateDate
      : undefined;

  return {
    disponible: true,
    jour: typeof jourGlobal === "string" ? jourGlobal : undefined,
    parEmetteur,
    total: parEmetteur.reduce((s, e) => s + e.flux, 0),
    ...champsPresents({
      encoursTotalUsd: lireValeur(globaux.totalNetAssets),
      partCapitalisationTotalePct: enPct(lireValeur(globaux.totalNetAssetsPercentage)),
      avoirsTotal: lireValeur(globaux.totalTokenHoldings),
      volumeTotalUsd: lireValeur(globaux.dailyTotalValueTraded),
      cumulTotalUsd: lireValeur(globaux.cumNetInflow),
    }),
  };
}

/**
 * Récupère les flux ETF pour un actif, avec cache 6 h et dégradation gracieuse.
 * La clé des Réglages est envoyée en en-tête si présente. En local, le proxy peut injecter
 * SOSOVALUE_API_KEY ; sur Vercel, l'absence de clé personnelle est rejetée sans appel réseau.
 */
export async function fetchEtfFlows(
  actif: ActifEtf,
  cle: string | null,
  signal?: AbortSignal,
): Promise<EtfResultat> {
  if (sosoUnusableWithoutKey(IS_VERCEL, cle)) {
    return { disponible: false, raison: RAISON_CLE_SOSOVALUE };
  }
  const cacheCle = `etf:${actif}`;
  const cache = await lireCache<EtfResultat>(cacheCle);
  if (estFrais(cache, ETF_TTL_MS) && cache !== null) {
    return { ...cache.donnee, recupereLe: cache.donnee.recupereLe ?? cache.ts, sourceEffective: "cache SoSoValue" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cle !== null) headers["x-soso-api-key"] = cle;

  let resultat: EtfResultat;
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: `us-${actif}-spot` }),
      signal,
    });
    if (res.ok) {
      resultat = { ...parseEtfFlows((await res.json()) as unknown), recupereLe: Date.now(), sourceEffective: "SoSoValue" };
    } else if (res.status === 401 || res.status === 403) {
      resultat = { disponible: false, raison: RAISON_CLE_SOSOVALUE, recupereLe: Date.now(), sourceEffective: "SoSoValue" };
    } else {
      resultat = { disponible: false, raison: `SoSoValue indisponible (HTTP ${res.status}).`, recupereLe: Date.now(), sourceEffective: "SoSoValue" };
    }
  } catch {
    resultat = { disponible: false, raison: "SoSoValue injoignable.", recupereLe: null, sourceEffective: "SoSoValue" };
  }
  // Ne jamais mettre en cache un échec (429/HTTP/réseau) : un rate-limit transitoire
  // ne doit pas geler la donnée à "indisponible" pendant tout le TTL de 6 h.
  if (resultat.disponible) await ecrireCache(cacheCle, resultat);
  return resultat;
}

/**
 * Rapporte la santé « sosovalue » pour UN cycle de chargement (les 3 actifs).
 * Une seule écriture par cycle — les 3 fetch parallèles écrivaient chacun le même id,
 * et l'état final dépendait de l'ordre d'achèvement (dernier écrivain gagne). Règle :
 * au moins un actif disponible → « polling » ; tous en échec → erreur (1re raison).
 */
export function rapporterSanteEtf(resultats: readonly EtfResultat[]): void {
  if (resultats.length === 0) return;
  const disponible = resultats.some((r) => r.disponible);
  if (disponible) {
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: Date.now() });
  } else {
    healthStore.getState().marquerErreur(SOURCE_SANTE, resultats[0]?.raison ?? "échec");
  }
}
