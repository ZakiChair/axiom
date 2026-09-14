/**
 * Mouvement attendu par échéance (fonction PURE) — tableau de la vue Term IV d'OMON.
 *
 * POURQUOI : l'IV ATM seule ne dit pas « de combien de dollars » le marché des options paie le
 * mouvement d'ici chaque échéance. Deux lectures complémentaires, par échéance :
 *   - straddle ATM = mark call + mark put au strike le plus proche du FORWARD de l'échéance,
 *     converti en USD × forward (marks Deribit en unités de base : correction du vérificateur,
 *     l'index biaise la conversion des échéances lointaines) ; F ± straddle ≈ ±0,8σ ;
 *   - EM IV (1σ) = F × IV_ATM/100 × √T, T en années (base 365 j).
 *
 * LIMITES : mesure risque-neutre (surestime en moyenne l'amplitude réalisée) ; marks = prix
 * modèle Deribit, pas des transactions ; échéances < 2 j bruitées (expiration 08:00 UTC, strikes
 * espacés). L'ATM est ancré sur le forward de chaque échéance, contrairement à `termStructureIv`
 * (spot commun) : les IV ATM peuvent différer légèrement entre la courbe et ce tableau.
 *
 * ZÉRO fetch : consomme la `chain` déjà pollée par OMON ; `nowMs` injecté par l'appelant.
 * Module PARESSEUX : importé seulement par OptionsWindow (jamais depuis un module d'entrée).
 */
import type { OptionPoint } from "./deribit";

/** Base 365 j (convention du dépôt, cf. skew.ts). */
const MS_PAR_AN = 365 * 24 * 60 * 60 * 1000;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
/** En deçà, l'échéance est signalée bruitée. */
export const SEUIL_BRUIT_JOURS = 2;

export interface PointMouvementAttendu {
  expiryMs: number;
  /** Jours restants jusqu'à l'échéance (fractionnaires). */
  joursRestants: number;
  /** Échéance à moins de SEUIL_BRUIT_JOURS : lecture bruitée. */
  bruitee: boolean;
  /** underlying_price de l'échéance (forward), PAS l'index. */
  forward: number;
  /** argmin |K − forward| (strike réel, pas d'interpolation). */
  strikeAtm: number;
  /** IV mark (%) au strikeAtm : moyenne call/put, sinon le côté fini et positif ; null sinon. */
  ivAtm: number | null;
  /** mark_call + mark_put au strikeAtm (unités de base) ; null si un côté manque. */
  straddleBase: number | null;
  /** 100 × straddleBase (= straddle_USD / F). */
  straddlePct: number | null;
  /** straddleBase × forward. */
  straddleUsd: number | null;
  /** forward − straddleUsd. */
  borneBasse: number | null;
  /** forward + straddleUsd. */
  borneHaute: number | null;
  /** ivAtm × √T (1σ, %). */
  emIvPct: number | null;
  /** forward × ivAtm/100 × √T (1σ, USD). */
  emIvUsd: number | null;
}

/** Un point par échéance future disposant d'un forward, triés par échéance croissante. */
export function mouvementsAttendus(chain: readonly OptionPoint[], nowMs: number): PointMouvementAttendu[] {
  const parEcheance = new Map<number, OptionPoint[]>();
  for (const p of chain) {
    if (p.expiryMs <= nowMs) continue;
    const arr = parEcheance.get(p.expiryMs);
    if (arr) arr.push(p);
    else parEcheance.set(p.expiryMs, [p]);
  }
  const echeances = [...parEcheance.keys()].sort((a, b) => a - b);

  const out: PointMouvementAttendu[] = [];
  for (const exp of echeances) {
    const points = parEcheance.get(exp) ?? [];
    const forward = points.map((p) => p.underlying).find((u) => Number.isFinite(u) && u > 0);
    if (forward === undefined) continue;

    let strikeAtm = NaN;
    let ecartMin = Infinity;
    for (const p of points) {
      const ecart = Math.abs(p.strike - forward);
      if (ecart < ecartMin) {
        ecartMin = ecart;
        strikeAtm = p.strike;
      }
    }
    if (!Number.isFinite(strikeAtm)) continue;

    let ivCall = NaN;
    let ivPut = NaN;
    let markCall = NaN;
    let markPut = NaN;
    for (const p of points) {
      if (p.strike !== strikeAtm) continue;
      const iv = Number.isFinite(p.markIv) && p.markIv > 0 ? p.markIv : NaN;
      if (p.type === "call") {
        ivCall = iv;
        markCall = p.markPrice;
      } else {
        ivPut = iv;
        markPut = p.markPrice;
      }
    }
    const ivs = [ivCall, ivPut].filter(Number.isFinite);
    const ivAtm = ivs.length === 0 ? null : ivs.reduce((s, v) => s + v, 0) / ivs.length;

    const straddleBase = Number.isFinite(markCall) && Number.isFinite(markPut) ? markCall + markPut : null;
    const straddleUsd = straddleBase === null ? null : straddleBase * forward;

    const t = (exp - nowMs) / MS_PAR_AN;
    const emIvPct = ivAtm === null ? null : ivAtm * Math.sqrt(t);
    const joursRestants = (exp - nowMs) / MS_PAR_JOUR;

    out.push({
      expiryMs: exp,
      joursRestants,
      bruitee: joursRestants < SEUIL_BRUIT_JOURS,
      forward,
      strikeAtm,
      ivAtm,
      straddleBase,
      straddlePct: straddleBase === null ? null : 100 * straddleBase,
      straddleUsd,
      borneBasse: straddleUsd === null ? null : forward - straddleUsd,
      borneHaute: straddleUsd === null ? null : forward + straddleUsd,
      emIvPct,
      emIvUsd: emIvPct === null ? null : (forward * emIvPct) / 100,
    });
  }
  return out;
}
