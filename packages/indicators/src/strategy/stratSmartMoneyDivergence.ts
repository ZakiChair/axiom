/**
 * @axiom/indicators — strategy/stratSmartMoneyDivergence.ts
 *
 * Stratégie « Divergence Smart Money vs Retail » (non validé) :
 * Suit l'orientation des Top Traders (positions notionnelles des gros portefeuilles)
 * lorsqu'ils prennent le contrepied de la foule (comptes retail).
 *
 * Règle :
 *  - Long si le Spread (NPI Top - NPI Retail) dépasse +seuilSpread % (smart money plus long que la foule).
 *  - Short si le Spread plonge sous -seuilSpread % (smart money plus short que la foule).
 *  - Flat dès que le spread se résorbe sous 5 %.
 */

import { defStrategie, type EtatStrategie } from "../utils-fabrique-strategie";

export const stratSmartMoneyDivergence = defStrategie({
  id: "stratSmartMoneyDivergence",
  name: "Divergence Smart Money vs Retail",
  validation: "non-valide",
  aux: ["lsAccount", "lsTopTrader"],
  inputsStrategie: [
    { key: "seuilSpread", name: "Seuil Spread %", type: "number", default: 25, min: 10, max: 80 },
  ],
  position: (candles, params, ctx) => {
    const lsAccount = ctx.aux?.lsAccount;
    const lsTopTrader = ctx.aux?.lsTopTrader;
    const seuilSpread = Number(params.seuilSpread ?? 25);
    const n = candles.length;
    const out: Array<EtatStrategie | undefined> = new Array(n).fill(undefined);

    if (!lsAccount || !lsTopTrader) return out;

    let etat: EtatStrategie = 0;
    for (let i = 0; i < n; i++) {
      const rf = lsAccount[i];
      const rt = lsTopTrader[i];

      if (
        rf === undefined ||
        rt === undefined ||
        !Number.isFinite(rf) ||
        !Number.isFinite(rt) ||
        rf <= 0 ||
        rt <= 0
      ) {
        out[i] = etat;
        continue;
      }

      const npiRetail = ((rf - 1) / (rf + 1)) * 100;
      const npiTop = ((rt - 1) / (rt + 1)) * 100;
      const spread = npiTop - npiRetail;

      if (spread > seuilSpread) {
        etat = 1;
      } else if (spread < -seuilSpread) {
        etat = -1;
      } else if (Math.abs(spread) < 5) {
        etat = 0;
      }

      out[i] = etat;
    }

    return out;
  },
  libelles: (params) => ({
    long: `Spread Smart - Retail > +${params.seuilSpread}% (Top traders longs contre foule)`,
    short: `Spread Smart - Retail < -${params.seuilSpread}% (Top traders shorts contre foule)`,
    sortie: `Résorption du spread (|Spread| < 5%)`,
  }),
});
