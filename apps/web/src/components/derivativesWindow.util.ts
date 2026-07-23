/**
 * Utilitaires PURS de la fenêtre « Produits dérivés » (DES) : construction du modèle
 * d'affichage de l'Open Interest futures BTC ventilé par exchange. Séparés du composant
 * pour rester testables hors navigateur.
 *
 * Deux pièges amont (flaggés par la couche data) traités ici :
 *  1. `openInterestFutures` est un TOTAL de synthèse dans `parExchange`, PAS un exchange :
 *     EXCLU des barres ET du dénominateur des parts.
 *  2. Les jours récents peuvent être vides (aucun exchange exploitable) : on remonte au
 *     DERNIER jour non vide et on affiche sa date.
 */
import type { JourOiFutures } from "../data/onchain/bgeometrics";

/** Champ de synthèse à exclure : total agrégé, pas une plateforme. */
const CHAMP_SYNTHESE = "openInterestFutures";

/** Une ligne du classement : exchange, notionnel USD, part (0..1), Δ vs J-7 (ou null). */
export interface RangExchange {
  exchange: string;
  usd: number;
  part: number;
  deltaJ7: number | null;
}

/** Modèle d'affichage complet de la section OI par exchange. */
export interface ModeleOiExchange {
  date: string;
  total: number;
  rangs: RangExchange[];
}

/** Ventilation d'un jour SANS le champ de synthèse (les seuls vrais exchanges). */
function exchangesReels(jour: JourOiFutures): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ex, v] of Object.entries(jour.parExchange)) {
    if (ex === CHAMP_SYNTHESE) continue;
    out[ex] = v;
  }
  return out;
}

/**
 * Construit le modèle d'affichage : sélectionne le DERNIER jour non vide (après exclusion
 * de la synthèse), classe les exchanges par notionnel décroissant, calcule la part de
 * chacun (dénominateur = total SANS synthèse) et le Δ vs le jour situé 7 séances plus tôt
 * (même position −7 dans `jours` ; exchange absent ce jour-là → null). Renvoie `null` si
 * aucun jour n'a de données exploitables. PURE.
 */
export function construireModeleOiExchange(jours: JourOiFutures[]): ModeleOiExchange | null {
  // Dernier jour non vide (post-exclusion) : on remonte depuis la fin.
  let idx = -1;
  let reels: Record<string, number> = {};
  for (let i = jours.length - 1; i >= 0; i--) {
    const r = exchangesReels(jours[i]!);
    if (Object.keys(r).length > 0) {
      idx = i;
      reels = r;
      break;
    }
  }
  if (idx === -1) return null;

  const total = Object.values(reels).reduce((s, v) => s + v, 0);
  // Référence J-7 : 7 positions plus tôt dans la liste (séances, week-ends inclus si
  // présents en amont). Absente si l'historique ne remonte pas assez loin.
  const ref = idx - 7 >= 0 ? exchangesReels(jours[idx - 7]!) : null;

  const rangs: RangExchange[] = Object.entries(reels)
    .sort((a, b) => b[1] - a[1])
    .map(([exchange, usd]) => ({
      exchange,
      usd,
      part: total > 0 ? usd / total : 0,
      deltaJ7: ref !== null && ref[exchange] !== undefined ? usd - ref[exchange]! : null,
    }));

  return { date: jours[idx]!.d, total, rangs };
}
