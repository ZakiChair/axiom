/**
 * Verdict gamma BTC sous conventions de signe pour le régime composite et BRIEF.
 *
 * Câblage du verdict OMON v2.6 (data/gexDex.ts) hors de la fenêtre options : la chaîne
 * Deribit BTC complète (1 appel agrégé, throttle géré par data/deribit.ts) est agrégée
 * en GEX par strike TOUTES échéances, puis résumée en verdict (long/short gamma) via la
 * même mécanique pure que OptionsWindow — spot pris sur la chaîne (premier `underlying`
 * fini > 0, définition identique à `spotChaine`).
 *
 * Cache module TTL 10 min (patron memo de data/referentiels.ts : SUCCÈS seulement, un
 * échec renvoie null sans être caché — retenté au tick suivant, jamais bloquant). Avec le
 * poller REGIME à 15 min, cela garantit au plus 1 appel Deribit par cycle. La santé de la
 * source est déjà signalée par fetchDeribitOptionChain (id « deribit ») — rien à ajouter.
 *
 * La composition chaîne→verdict est PURE et testée (gammaRegime.test.ts) ; seul le
 * fetch reste impur.
 */
import { fetchDeribitOptionChain } from "./deribit";
import {
  comparerHypothesesGammaCrypto,
  type CryptoOptionInput,
  type ScenarioGamma,
  type VerdictGamma,
} from "./gexDex";

/** Point de chaîne minimal pour le verdict : inputs GEX + spot porté par l'instrument. */
export type PointChaineGamma = CryptoOptionInput & {
  /** Prix du sous-jacent (index) au moment du résumé — porte le spot de la chaîne. */
  underlying: number;
};

/** Verdict gamma BTC résumé sous hypothèse pour REGIME/BRIEF. */
export interface VerdictGammaBtc {
  verdict: VerdictGamma;
  /** GEX net toutes échéances (USD par 1 % de mouvement du spot). */
  gexNetUsd: number;
  /** Spot de la chaîne (même définition que `spotChaine` d'OptionsWindow). */
  spot: number;
  /** Trois conventions calculées sur la même chaîne, le même spot et le même nowMs. */
  scenarios: ScenarioGamma[];
  /** Vrai dès que les conventions ne donnent pas toutes le même verdict. */
  sensibleAuxHypotheses: boolean;
}

/**
 * Composition chaîne→verdict. Fonction PURE (nowMs injecté) : spot de la chaîne →
 * GEX par strike toutes échéances → gamma flip → verdict. Renvoie null si aucun
 * spot exploitable (chaîne vide ou `underlying` jamais fini > 0).
 */
export function verdictGammaDepuisChaine(
  chaine: readonly PointChaineGamma[],
  nowMs: number,
): VerdictGammaBtc | null {
  const spot = chaine.map((p) => p.underlying).find((v) => Number.isFinite(v) && v > 0) ?? NaN;
  if (!Number.isFinite(spot)) return null;
  const scenarios = comparerHypothesesGammaCrypto([...chaine], spot, nowMs);
  const convention = scenarios.find((s) => s.hypothese === "convention");
  if (!convention) return null;
  return {
    verdict: convention.verdict,
    gexNetUsd: convention.gexNet,
    spot,
    scenarios,
    sensibleAuxHypotheses: new Set(scenarios.map((s) => s.verdict.regime)).size > 1,
  };
}

/** TTL du cache (10 min) : < poll REGIME 15 min → au plus 1 appel Deribit par cycle. */
const TTL_MS = 600_000;

let cache: { t: number; data: VerdictGammaBtc } | null = null;

/** Vide le cache (tests). */
export function _viderCacheGammaRegime(): void {
  cache = null;
}

/**
 * Verdict gamma BTC courant sous trois hypothèses : chaîne Deribit → verdicts.
 * Succès mémoïsé TTL_MS ; échec → null (jamais caché, jamais d'exception propagée).
 */
export async function chargerVerdictGammaBtc(nowMs: number): Promise<VerdictGammaBtc | null> {
  if (cache !== null && nowMs - cache.t < TTL_MS) return cache.data;
  try {
    const chaine = await fetchDeribitOptionChain("BTC");
    const res = verdictGammaDepuisChaine(chaine, nowMs);
    if (res === null) return null;
    cache = { t: nowMs, data: res };
    return res;
  } catch {
    return null;
  }
}
