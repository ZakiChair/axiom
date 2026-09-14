/**
 * Trésoreries d'entreprises BTC — CoinGecko `companies/public_treasury/bitcoin` (CORS `*`,
 * appel direct, clé Demo personnelle optionnelle).
 *
 * Données DÉCLARATIVES compilées par CoinGecko : avoirs et coût d'entrée publiés par les
 * sociétés cotées, SANS horodatage (déclarations jusqu'à J-14 constatées pour Strategy). Le
 * coût est un coût moyen historique, pas un seuil de liquidation. Le prix de comparaison par
 * défaut est le prix implicite CoinGecko du même instantané (valeur ÷ avoirs).
 *
 * Coût unitaire = entrée ÷ avoirs, retenu dans [1 000 ; 200 000] $/BTC (écarte les coûts nuls
 * et les valeurs aberrantes) ; coût pondéré = Σ entrées ÷ Σ avoirs des sociétés à coût connu.
 *
 * Un seul appel, cache 6 h (clé `cg:tresoreries:btc`), un téléchargement en vol partagé,
 * cache périmé resservi sur échec (429, 5xx, réseau, réponse illisible), null sinon.
 * Contrat lu par le couloir chart (ligne « Coût Strategy ») : `chargerTresoreriesBtc`,
 * `resumerTresoreries`, `strategy.coutMoyenUsd`, `coutPondereUsd`.
 */
import { CG_BASE, resolveDemoKey, withDemoKey } from "../marketOverview";
import { ecrireCache, estFrais, lireCache } from "./cache";
import type { ResultatFrais } from "./mempool";

export const URL_TRESORERIES_BTC = `${CG_BASE}/companies/public_treasury/bitcoin`;
export const TRESORERIES_TTL_MS = 6 * 60 * 60 * 1000;
export const COUT_MIN_USD = 1_000;
export const COUT_MAX_USD = 200_000;
export const SYMBOLE_STRATEGY = "MSTR.US";
const CLE_CACHE = "cg:tresoreries:btc";
/** Délai maximal du téléchargement partagé (aucun appelant ne peut l'annuler seul). */
const DELAI_MS = 15_000;

export interface SocieteTresorerie {
  nom: string;
  symbole: string;
  avoirsBtc: number;
  /** Coût d'entrée total ; null si non publié ou coût unitaire hors [1 000 ; 200 000] $. */
  coutTotalUsd: number | null;
}

export interface TresoreriesBtc {
  totalBtc: number;
  valeurUsd: number | null;
  societes: SocieteTresorerie[];
}

export interface PalierSensibilite {
  baissePct: 10 | 20 | 30;
  prixUsd: number;
  societes: number;
  btc: number;
}

export interface ResumeTresoreries {
  totalBtc: number;
  nbSocietes: number;
  /** Prix de comparaison : spot fourni, sinon prix implicite CoinGecko (valeur ÷ avoirs). */
  spotImpliciteUsd: number | null;
  strategy: {
    avoirsBtc: number;
    coutMoyenUsd: number | null;
    /** Écart du prix de comparaison au coût moyen (%). */
    ecartSpotPct: number | null;
    /** Variation du prix qui amène Strategy à son coût moyen (%, négative tant qu'elle est au-dessus). */
    seuilSousCoutPct: number | null;
  } | null;
  coutPondereUsd: number | null;
  /** Part des BTC détenus par les sociétés à coût connu (%). */
  couvertureCoutPct: number | null;
  nbAvecCout: number;
  /** Sociétés dont le coût dépasse le prix de comparaison ; null sans prix ou sans coût connu. */
  sousCout: { societes: number; btc: number } | null;
  sensibilite: PalierSensibilite[];
}

const fini = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parse tolérant : sociétés à avoirs finis > 0 ; coût nul/aberrant → coutTotalUsd null. PURE. */
export function parseTresoreriesBtc(json: unknown): TresoreriesBtc | null {
  const o = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (!Array.isArray(o["companies"])) return null;
  const societes: SocieteTresorerie[] = [];
  for (const brut of o["companies"] as unknown[]) {
    const c = (brut ?? {}) as Record<string, unknown>;
    const avoirsBtc = fini(c["total_holdings"]);
    if (avoirsBtc === null || avoirsBtc <= 0) continue;
    const entree = fini(c["total_entry_value_usd"]);
    const unitaire = entree === null ? null : entree / avoirsBtc;
    societes.push({
      nom: typeof c["name"] === "string" ? c["name"] : "?",
      symbole: typeof c["symbol"] === "string" ? c["symbol"] : "",
      avoirsBtc,
      coutTotalUsd: unitaire !== null && unitaire >= COUT_MIN_USD && unitaire <= COUT_MAX_USD ? entree : null,
    });
  }
  if (societes.length === 0) return null;
  const total = fini(o["total_holdings"]);
  const valeur = fini(o["total_value_usd"]);
  return {
    totalBtc: total !== null && total > 0 ? total : societes.reduce((s, c) => s + c.avoirsBtc, 0),
    valeurUsd: valeur !== null && valeur > 0 ? valeur : null,
    societes,
  };
}

/** Coût unitaire = entry / avoirs dans [1 000 ; 200 000] $, coût pondéré Σentry/Σavoirs, sensibilité −10/−20/−30 % du spot. PURE. */
export function resumerTresoreries(t: TresoreriesBtc, spotUsd?: number | null): ResumeTresoreries {
  const spot = spotUsd != null && Number.isFinite(spotUsd) && spotUsd > 0 ? spotUsd
    : t.valeurUsd !== null && t.totalBtc > 0 ? t.valeurUsd / t.totalBtc : null;
  const avecCout = t.societes.filter((s): s is SocieteTresorerie & { coutTotalUsd: number } => s.coutTotalUsd !== null);
  const btcAvecCout = avecCout.reduce((s, c) => s + c.avoirsBtc, 0);
  const sous = (prixUsd: number) => {
    const touchees = avecCout.filter((c) => c.coutTotalUsd / c.avoirsBtc > prixUsd);
    return { societes: touchees.length, btc: touchees.reduce((s, c) => s + c.avoirsBtc, 0) };
  };
  const mstr = t.societes.find((s) => s.symbole === SYMBOLE_STRATEGY);
  const coutStrategy = mstr?.coutTotalUsd != null ? mstr.coutTotalUsd / mstr.avoirsBtc : null;
  const calculable = spot !== null && avecCout.length > 0;
  return {
    totalBtc: t.totalBtc,
    nbSocietes: t.societes.length,
    spotImpliciteUsd: spot,
    strategy: mstr === undefined ? null : {
      avoirsBtc: mstr.avoirsBtc,
      coutMoyenUsd: coutStrategy,
      ecartSpotPct: coutStrategy !== null && spot !== null ? (spot / coutStrategy - 1) * 100 : null,
      seuilSousCoutPct: coutStrategy !== null && spot !== null ? (coutStrategy / spot - 1) * 100 : null,
    },
    coutPondereUsd: avecCout.length > 0 ? avecCout.reduce((s, c) => s + c.coutTotalUsd, 0) / btcAvecCout : null,
    couvertureCoutPct: avecCout.length > 0 ? (btcAvecCout / t.totalBtc) * 100 : null,
    nbAvecCout: avecCout.length,
    sousCout: calculable ? sous(spot) : null,
    sensibilite: calculable
      ? ([10, 20, 30] as const).map((baissePct) => {
        const prixUsd = spot * (1 - baissePct / 100);
        return { baissePct, prixUsd, ...sous(prixUsd) };
      })
      : [],
  };
}

/** Régime d'accès de l'appel : clé Demo personnelle présente ou public. */
export function accesTresoreries(): "cle" | "public" {
  return resolveDemoKey() ? "cle" : "public";
}

let enCours: Promise<ResultatFrais<TresoreriesBtc> | null> | null = null;

async function telecharger(): Promise<ResultatFrais<TresoreriesBtc> | null> {
  const cache = await lireCache<TresoreriesBtc>(CLE_CACHE);
  if (cache !== null && estFrais(cache, TRESORERIES_TTL_MS)) {
    return { donnee: cache.donnee, ts: cache.ts, perime: false };
  }
  try {
    const res = await fetch(withDemoKey(URL_TRESORERIES_BTC), { signal: AbortSignal.timeout(DELAI_MS) });
    if (!res.ok) throw new Error(`CoinGecko trésoreries ${res.status}`);
    const donnee = parseTresoreriesBtc((await res.json()) as unknown);
    if (donnee === null) throw new Error("CoinGecko trésoreries illisibles");
    await ecrireCache(CLE_CACHE, donnee);
    return { donnee, ts: Date.now(), perime: false };
  } catch {
    return cache !== null ? { donnee: cache.donnee, ts: cache.ts, perime: true } : null;
  }
}

/**
 * Un appel, cache 6 h (clé `cg:tresoreries:btc`), coalescence en vol, périmé resservi, null sinon.
 * `signal` n'abandonne que l'attente de cet appelant (rejet AbortError) : le téléchargement
 * partagé continue pour les autres, borné par son délai.
 */
export async function chargerTresoreriesBtc(signal?: AbortSignal): Promise<ResultatFrais<TresoreriesBtc> | null> {
  enCours ??= telecharger().finally(() => {
    enCours = null;
  });
  const resultat = await enCours;
  if (signal?.aborted) throw new DOMException("Chargement des trésoreries abandonné", "AbortError");
  return resultat;
}
