/**
 * @axiom/indicators — strategy/stratBollingerReversion.test.ts
 *
 * Fixture en V profond ({length: 3, mult: 1}) PROUVÉE par recomposition : `sma`
 * et `stdev` sont importés directement du module (mêmes cœurs que la def) pour
 * recalculer bandes et état attendu en JS. `recompose()` MIROITE délibérément
 * la machine à états de la def (même algorithme, seuls `sma`/`stdev` sont la
 * source commune) — les vraies dents anti-tautologie sont ailleurs : les
 * assertions de franchissement ci-dessous recalculent la cassure/le retour
 * directement depuis `closes`/`m`/`sd` bruts (indépendamment de tout état), et
 * les `toEqual` finaux pinnent marqueurs/labels/`prixEntree` en valeurs
 * concrètes. La fixture n'est validée qu'a posteriori : on vérifie que le
 * close CASSE la bande basse (excursion) puis REVIENT dedans (recroisement),
 * comme l'exige la stratégie — garde anti-tautologie sur les comptes ET sur le
 * franchissement réel à l'index de chaque entrée.
 *
 * closes = [100, 98, 96, 80, 92, 100, 105, 108]  (n=8)
 *   i=3 : close=80 < bandeBasse(i=3)=83.28 → excursion sous la bande.
 *   i=4 : close=92, close[3]=80 < bandeBasse(i=3) ET close[4]=92 ≥ bandeBasse(i=4)=82.53
 *         → RECROISEMENT → ENTRÉE LONG @ 92.
 *   i=5 : close=100 ≥ moyenne(i=5)=90.67 → SORTIE LONG @ 100 (retour à la moyenne).
 *   i∈[6,7] : etat=0, pas de nouvelle excursion → rien.
 */
import { describe, expect, it } from "vitest";
import type { Candle } from "@axiom/types";
import { computeIndicator } from "../engine";
import { sma, stdev } from "../utils";
import { stratBollingerReversion } from "./stratBollingerReversion";

/** Bougies plates (open=high=low=close) : seul le close pilote les bandes. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: close, high: close, low: close, close, volume: 1,
  }));
}

const closes = [100, 98, 96, 80, 92, 100, 105, 108];
const candles = candlesFromCloses(closes);
const PARAMS = { length: 3, mult: 1 };

/**
 * Recompose la machine à états EXACTEMENT comme décrit dans la stratégie (mais
 * écrite indépendamment ici, avec `sma`/`stdev` importés comme seule source
 * commune) : sert d'oracle indépendant pour valider position/entrées/sorties.
 */
function recompose(values: number[], length: number, mult: number) {
  const m = sma(values, length);
  const sd = stdev(values, length);
  const n = values.length;
  const out: Array<1 | 0 | -1 | undefined> = new Array(n).fill(undefined);
  let etat: 1 | 0 | -1 = 0;
  for (let i = 0; i < n; i++) {
    const moy = m[i];
    const s = sd[i];
    const c = values[i];
    if (moy === undefined || s === undefined || c === undefined) continue;
    const bas = moy - mult * s;
    const haut = moy + mult * s;
    const cPrev = values[i - 1];
    const mPrev = m[i - 1];
    const sPrev = sd[i - 1];
    if (etat === 1 && c >= moy) etat = 0;
    else if (etat === -1 && c <= moy) etat = 0;
    else if (etat === 0 && cPrev !== undefined && mPrev !== undefined && sPrev !== undefined) {
      if (cPrev < mPrev - mult * sPrev && c >= bas) etat = 1;
      else if (cPrev > mPrev + mult * sPrev && c <= haut) etat = -1;
    }
    out[i] = etat;
  }
  return { m, sd, out };
}

describe("stratBollingerReversion", () => {
  it("contrat : strategy/overlay, inputs propres + lignesTrades en dernier", () => {
    expect(stratBollingerReversion.category).toBe("strategy");
    expect(stratBollingerReversion.pane).toBe("overlay");
    expect(stratBollingerReversion.inputs.map((i) => i.key)).toEqual([
      "length", "mult", "lignesTrades",
    ]);
  });

  it("V profond : cassure de bande basse puis recroisement → long, sortie à la moyenne (recomposé)", () => {
    const r = computeIndicator(stratBollingerReversion, candles, PARAMS);
    const { m, sd, out } = recompose(closes, PARAMS.length, PARAMS.mult);

    // Garde anti-tautologie : la fixture doit réellement produire une entrée
    // et une sortie (compte figé, lu sur cette fixture).
    const marqueurs = r.annotations?.marqueurs ?? [];
    const labels = r.annotations?.labels ?? [];
    expect(marqueurs.length).toBe(1);
    expect(labels.length).toBe(1);

    // État effectif recomposé (fill-forward des undefined intermédiaires — même
    // sémantique que la fabrique defStrategie).
    const effectif: Array<1 | 0 | -1 | undefined> = [];
    let courant: 1 | 0 | -1 | undefined;
    for (const e of out) {
      if (e !== undefined) courant = e;
      effectif.push(courant);
    }

    // Chaque entrée coïncide avec un VRAI recroisement (pas seulement une
    // transition d'état à cet index) : la bougie précédente était hors bande,
    // la bougie courante y est revenue — testé sur les prix bruts, indépendant
    // de la machine à états recomposée ci-dessus.
    for (const mq of marqueurs) {
      const prev = effectif[mq.idx - 1];
      const cur = effectif[mq.idx];
      expect(prev).toBe(0);
      expect(cur).not.toBe(0);
      expect(mq.forme).toBe(cur === 1 ? "triangleHaut" : "triangleBas");
      expect(mq.couleur).toBe(cur === 1 ? "--up" : "--down");

      const mPrev = m[mq.idx - 1];
      const sPrev = sd[mq.idx - 1];
      const mCur = m[mq.idx];
      const sCur = sd[mq.idx];
      const cPrev = closes[mq.idx - 1];
      const cCur = closes[mq.idx];
      expect(mPrev).not.toBeUndefined();
      expect(sPrev).not.toBeUndefined();
      expect(mCur).not.toBeUndefined();
      expect(sCur).not.toBeUndefined();
      if (cur === 1) {
        expect(cPrev as number).toBeLessThan((mPrev as number) - PARAMS.mult * (sPrev as number));
        expect(cCur as number).toBeGreaterThanOrEqual((mCur as number) - PARAMS.mult * (sCur as number));
      } else {
        expect(cPrev as number).toBeGreaterThan((mPrev as number) + PARAMS.mult * (sPrev as number));
        expect(cCur as number).toBeLessThanOrEqual((mCur as number) + PARAMS.mult * (sCur as number));
      }
    }

    // La sortie retourne bien à la moyenne, dans le sens attendu (long sort
    // quand close ≥ SMA), et le PnL affiché correspond au calcul indépendant.
    for (const lb of labels) {
      const prev = effectif[lb.idx - 1];
      expect(prev).not.toBe(0);
      expect(lb.position).toBe(prev === 1 ? "dessus" : "dessous");
      const entreeIdx = marqueurs.find((mq) => mq.idx < lb.idx)?.idx;
      expect(entreeIdx).not.toBeUndefined();
      const prixEntree = closes[entreeIdx as number] as number;
      const prixSortie = closes[lb.idx] as number;
      const pnl = ((prixSortie - prixEntree) / prixEntree) * 100 * (prev as number);
      const signe = pnl >= 0 ? "+" : "";
      expect(lb.texte).toBe(`${signe}${pnl.toFixed(2)} %`);
    }

    // Fixture pinnée à l'index près : entrée long @ i=4 (close=92), sortie @ i=5
    // (close=100), +8.70 % — dérivé indépendamment ci-dessus, réaffirmé ici en
    // valeurs concrètes.
    expect(marqueurs).toEqual([
      { idx: 4, valeur: 92, forme: "triangleHaut", couleur: "--up", cible: "prix",
        info: "Entrée long 92.00 — retour au-dessus de la bande basse (3, 1σ)" },
    ]);
    expect(labels).toEqual([
      { idx: 5, valeur: 100, texte: "+8.70 %", couleur: "--up", cible: "prix", position: "dessus",
        info: "Sortie long 100.00 (+8.70 %) — retour à la moyenne" },
    ]);
    expect(r.series["prixEntree"]).toEqual([
      undefined, undefined, undefined, undefined, 92, 92, undefined, undefined,
    ]);
  });
});
