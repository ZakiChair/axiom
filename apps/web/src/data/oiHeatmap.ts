/**
 * Heatmap OI strike × échéance (fonctions PURES) — 3e vue d'OMON.
 *
 * POURQUOI : la vue smile et la vue GEX/DEX ne montrent qu'UNE échéance à la fois. La heatmap
 * donne la carte complète des positions options : où est l'open interest (et les murs de gamma)
 * par strike ET par échéance, avec le max pain de chaque colonne.
 *
 * MODÈLE : généralisation multi-échéances des agrégations déjà en place —
 *   - fusion OI calls/puts par strike : même logique qu'`agregerParStrike` (OptionsWindow) ;
 *   - max pain par échéance : `computeMaxPain` (deribit.ts) sur l'agrégation COMPLÈTE ;
 *   - gamma par cellule : `computeCryptoGexDex` (gexDex.ts, Black-Scholes) — mêmes conventions.
 *
 * ZÉRO fetch : consomme la `chain` (`OptionPoint[]`) déjà pollée 60 s par OMON. `nowMs` est
 * injecté par l'appelant (convention du dépôt — jamais `Date.now()` dans la logique testée).
 */
import { computeMaxPain, type OptionPoint, type StrikeOi } from "./deribit";
import { computeCryptoGexDex } from "./gexDex";

/** Une cellule de la grille : open interest fusionné et gamma exposure à (échéance, strike). */
export interface CelluleOi {
  expiryMs: number;
  strike: number;
  callOi: number;
  putOi: number;
  oiTotal: number;
  /** Gamma exposure SIGNÉ du strike (murs de gamma) — l'intensité utilise |gex|. */
  gex: number;
  /** Volume 24h fusionné call+put du strike (NaN traité comme 0 à la somme). */
  volume24h: number;
}

/** Grille complète strike × échéance + repères dérivés (max pain, maxima pour l'échelle). */
export interface GrilleOi {
  /** Échéances futures triées croissant. */
  echeances: number[];
  /** Strikes à OI non nul, triés croissant (union sur toutes les échéances). */
  strikes: number[];
  /** Cellules à OI non nul uniquement. */
  cellules: CelluleOi[];
  /** Max pain par échéance (strike de valeur intrinsèque minimale versée). */
  maxPainParEcheance: Map<number, number>;
  /** Plus grand `oiTotal` observé (échelle d'intensité métrique OI). */
  oiMax: number;
  /** Plus grand |gex| observé (échelle d'intensité métrique GEX). */
  gexAbsMax: number;
  /** Plus grand `volume24h` de cellule observé (échelle d'intensité métrique Volume). */
  volumeMax: number;
}

/**
 * Construit la grille OI/GEX strike × échéance depuis la chaîne complète. Fonction PURE.
 * Regroupe par `expiryMs` (échéances futures uniquement, `nowMs` injecté), puis par strike.
 * Le max pain de chaque échéance est calculé sur l'agrégation COMPLÈTE (les strikes à OI nul
 * restent des candidats de règlement légitimes) ; les cellules, elles, n'exposent que les
 * strikes à OI non nul.
 */
export function construireGrilleOi(chain: OptionPoint[], spot: number, nowMs: number): GrilleOi {
  // Regroupement par échéance future (généralisation d'echeancesDispo, nowMs injecté).
  const parEcheance = new Map<number, OptionPoint[]>();
  for (const p of chain) {
    if (p.expiryMs <= nowMs) continue;
    const arr = parEcheance.get(p.expiryMs);
    if (arr) arr.push(p);
    else parEcheance.set(p.expiryMs, [p]);
  }
  const echeances = [...parEcheance.keys()].sort((a, b) => a - b);

  const cellules: CelluleOi[] = [];
  const maxPainParEcheance = new Map<number, number>();
  const strikesSet = new Set<number>();

  for (const exp of echeances) {
    const points = parEcheance.get(exp) ?? [];

    // Agrégation OI par strike (calls/puts). Les strikes à OI nul sont CONSERVÉS ici : ce sont
    // des candidats de règlement légitimes pour le max pain (cf. agregerParStrike du modèle).
    const parStrike = new Map<number, StrikeOi>();
    // Volume 24h fusionné call+put par strike (NaN traité comme 0 à la somme).
    const volumeParStrike = new Map<number, number>();
    for (const p of points) {
      const cur = parStrike.get(p.strike) ?? { strike: p.strike, callOi: 0, putOi: 0 };
      const oi = Number.isFinite(p.openInterest) ? p.openInterest : 0;
      if (p.type === "call") cur.callOi += oi;
      else cur.putOi += oi;
      parStrike.set(p.strike, cur);

      const vol = Number.isFinite(p.volume24h) ? p.volume24h : 0;
      volumeParStrike.set(p.strike, (volumeParStrike.get(p.strike) ?? 0) + vol);
    }

    // Max pain sur l'agrégation complète (strikes à OI nul inclus comme candidats).
    const mp = computeMaxPain([...parStrike.values()]);
    if (mp !== null) maxPainParEcheance.set(exp, mp);

    // GEX signé par strike de l'échéance (mêmes conventions que computeCryptoGexDex).
    const gexParStrike = new Map<number, number>();
    for (const g of computeCryptoGexDex(points, spot, nowMs)) gexParStrike.set(g.strike, g.gex);

    // Cellules : uniquement les strikes à OI non nul.
    for (const niv of parStrike.values()) {
      const oiTotal = niv.callOi + niv.putOi;
      if (oiTotal <= 0) continue;
      cellules.push({
        expiryMs: exp,
        strike: niv.strike,
        callOi: niv.callOi,
        putOi: niv.putOi,
        oiTotal,
        gex: gexParStrike.get(niv.strike) ?? 0,
        volume24h: volumeParStrike.get(niv.strike) ?? 0,
      });
      strikesSet.add(niv.strike);
    }
  }

  const strikes = [...strikesSet].sort((a, b) => a - b);
  let oiMax = 0;
  let gexAbsMax = 0;
  let volumeMax = 0;
  for (const c of cellules) {
    if (c.oiTotal > oiMax) oiMax = c.oiTotal;
    const ag = Math.abs(c.gex);
    if (ag > gexAbsMax) gexAbsMax = ag;
    if (c.volume24h > volumeMax) volumeMax = c.volume24h;
  }

  return { echeances, strikes, cellules, maxPainParEcheance, oiMax, gexAbsMax, volumeMax };
}

/**
 * Strikes à afficher : ceux dans ±40 % du spot, plafonnés à `maxLignes` (les plus proches du
 * spot). Si aucun strike n'est dans la bande (chaîne excentrée), repli sur les `maxLignes` plus
 * proches du spot. Résultat trié croissant. Fonction PURE.
 */
export function bandeStrikes(strikes: number[], spot: number, maxLignes = 40): number[] {
  const finis = strikes.filter((s) => Number.isFinite(s));
  const dansBande = finis.filter((s) => s >= spot * 0.6 && s <= spot * 1.4);
  const base = dansBande.length > 0 ? dansBande : finis;
  return [...base]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, maxLignes)
    .sort((a, b) => a - b);
}

/**
 * Intensité [0, 1] d'une cellule sur échelle LOG (les petites tailles restent visibles sans que
 * les murs écrasent tout) : log1p(v) / log1p(vMax). Renvoie 0 si `vMax <= 0`. Fonction PURE ;
 * l'appelant passe des valeurs positives (OI, ou |gex|). 0 → 0, vMax → 1, monotone.
 */
export function intensiteCellule(v: number, vMax: number): number {
  if (!(vMax > 0)) return 0;
  return Math.log1p(v) / Math.log1p(vMax);
}
