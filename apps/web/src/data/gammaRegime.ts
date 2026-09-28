/**
 * Verdict gamma BTC pour REGIME/BRIEF : indice réel + forwards par échéance.
 * Trois hypothèses de signe partagent les mêmes contrats valides. Le verdict principal
 * mesure la distance au zéro du profil en spot (41 points à ±15 %), comme OMON/le chart.
 * Cache 10 min borné par la première expiration, requêtes simultanées coalescées.
 * Une chaîne vide/inexploitable ou un échec donne null, jamais un faux régime neutre.
 */
import { fetchDeribitOptionChain } from "./deribit";
import { spotDeChaine, limiteChaineOptions } from "./chaineOptionsCache";
import {
  comparerHypothesesGammaCrypto,
  profilGexSpot,
  verdictGamma,
  type CryptoOptionInput,
  type ScenarioGamma,
  type VerdictGamma,
} from "./gexDex";

/** Point de chaîne minimal pour le verdict : inputs GEX + spot porté par l'instrument. */
export type PointChaineGamma = CryptoOptionInput & {
  /** Forward propre à l’échéance, distinct de l’index spot. */
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
 * GEX par strike toutes échéances → profil en spot → verdict. Renvoie null si aucun
 * index exploitable ou aucune option valide.
 */
export function verdictGammaDepuisChaine(
  chaine: readonly PointChaineGamma[],
  nowMs: number,
): VerdictGammaBtc | null {
  const spot = spotDeChaine(chaine);
  if (!Number.isFinite(spot)) return null;
  const scenarios = comparerHypothesesGammaCrypto([...chaine], spot, nowMs);
  const convention = scenarios.find((s) => s.hypothese === "convention");
  if (!convention) return null;
  const spots = Array.from({ length: 41 }, (_, i) => spot * (0.85 + 0.3 * i / 40));
  const flipProfil = profilGexSpot([...chaine], spots, nowMs).flipReel;
  const sommeAbs = convention.points.reduce((somme, p) => somme + Math.abs(p.gex), 0);
  return {
    verdict: verdictGamma(convention.gexNet, spot, flipProfil, sommeAbs),
    gexNetUsd: convention.gexNet,
    spot,
    scenarios,
    sensibleAuxHypotheses: new Set(scenarios.map((s) => s.verdict.regime)).size > 1,
  };
}

export interface VerdictGammaBtcCharge extends VerdictGammaBtc {
  /** Réception réelle de la chaîne ; une lecture du cache conserve cette date. */
  recupereLe: number;
}

let cache: { t: number; fin: number; data: VerdictGammaBtcCharge } | null = null;
let enVol: Promise<VerdictGammaBtcCharge | null> | null = null;

/** Vide le cache (tests). */
export function _viderCacheGammaRegime(): void {
  cache = null;
  enVol = null;
}

/**
 * Verdict gamma BTC courant sous trois hypothèses : chaîne Deribit → verdicts.
 * Succès mémoïsé jusqu’au TTL ou à la première expiration ; échec → null (jamais caché, jamais d'exception propagée).
 */
export function chargerVerdictGammaBtc(nowMs: number): Promise<VerdictGammaBtcCharge | null> {
  if (cache !== null && nowMs >= cache.t && nowMs < cache.fin) return Promise.resolve(cache.data);
  if (enVol !== null) return enVol;
  enVol = fetchDeribitOptionChain("BTC").then((chaine) => {
    const recupereLe = Date.now();
    const heureCalcul = Math.max(nowMs, recupereLe);
    const res = verdictGammaDepuisChaine(chaine, heureCalcul);
    if (res === null) return null;
    const data = { ...res, recupereLe };
    cache = { t: recupereLe, fin: limiteChaineOptions({ chaine, recupereLe }), data };
    return data;
  }).catch(() => null).finally(() => { enVol = null; });
  return enVol;
}
