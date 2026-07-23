/**
 * EXPY — modèle de trade journalisé et statistiques d'expectancy (calcul PUR client).
 *
 * Brique fondatrice de l'axe « journal » : un trade est saisi manuellement (entrée,
 * stop initial, taille, sortie optionnelle). Tout est ramené en R (multiple de risque)
 * pour rendre comparables des trades de tailles/prix différents.
 *
 * Conventions ARRÊTÉES ici (l'interface est figée, consommée par le store et la fenêtre —
 * on documente au lieu de choisir en silence) :
 *  - risque initial = |entree − stopInitial| × taille ;
 *  - R = (sortie − entree) × taille × signe(direction) / risque, avec signe(long)=+1,
 *    signe(short)=−1. La taille se simplifie (numérateur et risque la portent tous deux),
 *    ce qui rend le R indépendant de la taille — c'est voulu ;
 *  - R null si le trade est ouvert (sortie ou fermeTs null), si le risque est 0, ou si une
 *    entrée est non finie : JAMAIS de NaN/Infinity en sortie ;
 *  - gagnant = R > 0, perdant = R < 0, breakeven = R = 0 (ni l'un ni l'autre : exclu du
 *    winRate et des moyennes gain/perte, mais compté dans n et l'expectancy) ;
 *  - moyPerte est SIGNÉE (moyenne des R perdants, donc ≤ 0) ;
 *  - profitFactor = ΣR+ / |ΣR−|, null si aucun perdant (ΣR− = 0) ;
 *  - les agrégats (statsExpy, equityR, repartition) ne portent que sur les trades FERMÉS
 *    à R non null.
 */

/** Un trade journalisé manuellement. `sortie`/`fermeTs` null tant que le trade est ouvert. */
export interface TradeJournal {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entree: number;
  stopInitial: number;
  taille: number;
  sortie: number | null;
  ouvertTs: number;
  fermeTs: number | null;
  note?: string;
  tags: string[];
}

/**
 * Multiple de risque (R) d'un trade. Renvoie null si le trade est ouvert (sortie ou
 * fermeTs null), si le risque initial est ≤ 0 (stop = entrée), ou si une valeur est non
 * finie — garantit qu'on ne renvoie jamais NaN/Infinity. Fonction PURE.
 */
export function rMultiple(t: TradeJournal): number | null {
  if (t.sortie === null || t.fermeTs === null) return null;
  if (!Number.isFinite(t.entree) || !Number.isFinite(t.stopInitial)) return null;
  if (!Number.isFinite(t.taille) || !Number.isFinite(t.sortie)) return null;
  const risque = Math.abs(t.entree - t.stopInitial) * t.taille;
  if (!(risque > 0)) return null;
  const signe = t.direction === "short" ? -1 : 1;
  return ((t.sortie - t.entree) * t.taille * signe) / risque;
}

/** R des trades FERMÉS (R non null), dans l'ordre du tableau d'entrée. Utilitaire interne. */
function rFermes(trades: readonly TradeJournal[]): number[] {
  const out: number[] = [];
  for (const t of trades) {
    const r = rMultiple(t);
    if (r !== null) out.push(r);
  }
  return out;
}

/** Statistiques d'expectancy sur les trades fermés (toutes en R). null quand indéfini. */
export interface StatsExpy {
  n: number;
  expectancy: number | null;
  winRate: number | null;
  profitFactor: number | null;
  moyGain: number | null;
  moyPerte: number | null;
  meilleurR: number | null;
  pireR: number | null;
}

/**
 * Agrège les statistiques d'expectancy sur les trades FERMÉS à R non null (les ouverts
 * sont ignorés). Voir les conventions en tête de fichier. Fonction PURE.
 */
export function statsExpy(trades: readonly TradeJournal[]): StatsExpy {
  const rs = rFermes(trades);
  const n = rs.length;
  if (n === 0) {
    return {
      n: 0,
      expectancy: null,
      winRate: null,
      profitFactor: null,
      moyGain: null,
      moyPerte: null,
      meilleurR: null,
      pireR: null,
    };
  }
  const gains = rs.filter((r) => r > 0);
  const pertes = rs.filter((r) => r < 0);
  const sommeR = rs.reduce((a, b) => a + b, 0);
  const sommeGains = gains.reduce((a, b) => a + b, 0);
  const sommePertes = pertes.reduce((a, b) => a + b, 0); // ≤ 0
  return {
    n,
    expectancy: sommeR / n,
    winRate: gains.length / n,
    profitFactor: sommePertes < 0 ? sommeGains / Math.abs(sommePertes) : null,
    moyGain: gains.length > 0 ? sommeGains / gains.length : null,
    moyPerte: pertes.length > 0 ? sommePertes / pertes.length : null,
    meilleurR: Math.max(...rs),
    pireR: Math.min(...rs),
  };
}

/**
 * Courbe d'équité cumulée en R : un point par trade fermé, trié par fermeTs ascendant,
 * `cumR` = somme des R jusqu'au trade inclus. Les trades ouverts sont exclus. Fonction PURE.
 */
export function equityR(trades: readonly TradeJournal[]): { ts: number; cumR: number }[] {
  const fermes: { ts: number; r: number }[] = [];
  for (const t of trades) {
    const r = rMultiple(t);
    if (r !== null && t.fermeTs !== null) fermes.push({ ts: t.fermeTs, r });
  }
  fermes.sort((a, b) => a.ts - b.ts);
  const out: { ts: number; cumR: number }[] = [];
  let cum = 0;
  for (const f of fermes) {
    cum += f.r;
    out.push({ ts: f.ts, cumR: cum });
  }
  return out;
}

/** Grille des bornes de l'histogramme des R (intervalles internes + extrêmes ouverts). */
export const BUCKETS_R: readonly number[] = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5];

/** Formate un nombre avec le signe moins typographique (U+2212), cohérent avec les extrêmes. */
function fmtBorne(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `${n}`;
}

/**
 * Histogramme des R des trades fermés : buckets internes bornés par BUCKETS_R plus deux
 * extrêmes OUVERTS (« < −3 », « > 5 »). Chaque bucket interne est [borne_i, borne_{i+1})
 * (borne basse incluse) ; la borne haute maximale (5) est rattrapée par le dernier
 * intervalle interne. Tous les buckets sont renvoyés, même vides. Fonction PURE.
 */
export function histogrammeR(trades: readonly TradeJournal[]): { label: string; n: number }[] {
  const bornes = BUCKETS_R;
  const premiere = bornes[0];
  const derniere = bornes[bornes.length - 1];
  if (premiere === undefined || derniere === undefined) return [];

  // Construction des labels : « < −3 », intervalles internes, « > 5 ».
  const buckets: { label: string; n: number }[] = [{ label: `< ${fmtBorne(premiere)}`, n: 0 }];
  for (let i = 0; i < bornes.length - 1; i++) {
    const lo = bornes[i];
    const hi = bornes[i + 1];
    if (lo === undefined || hi === undefined) continue;
    buckets.push({ label: `[${fmtBorne(lo)}, ${fmtBorne(hi)})`, n: 0 });
  }
  buckets.push({ label: `> ${fmtBorne(derniere)}`, n: 0 });

  const sousExtreme = buckets[0];
  const surExtreme = buckets[buckets.length - 1];
  if (sousExtreme === undefined || surExtreme === undefined) return buckets;

  for (const r of rFermes(trades)) {
    if (r < premiere) {
      sousExtreme.n += 1;
    } else if (r > derniere) {
      surExtreme.n += 1;
    } else {
      // premiere ≤ r ≤ derniere : plus grand i tel que bornes[i] ≤ r, borné au dernier intervalle.
      let i = 0;
      while (i + 1 < bornes.length) {
        const suiv = bornes[i + 1];
        if (suiv === undefined || suiv > r) break;
        i += 1;
      }
      const idx = Math.min(i, bornes.length - 2); // rattrape r = derniere borne (5) dans [3,5)
      const cible = buckets[idx + 1]; // +1 : décalage du bucket extrême « < … » en tête
      if (cible !== undefined) cible.n += 1;
    }
  }
  return buckets;
}

/**
 * Répartition des R fermés par symbole ou par tag. Un trade multi-tags compte dans CHAQUE
 * tag (sommeR et n dupliqués par tag). Trié par sommeR décroissant. Fonction PURE.
 */
export function repartition(
  trades: readonly TradeJournal[],
  par: "symbol" | "tag"
): { cle: string; n: number; sommeR: number }[] {
  const agg = new Map<string, { n: number; sommeR: number }>();
  const ajoute = (cle: string, r: number) => {
    const cour = agg.get(cle) ?? { n: 0, sommeR: 0 };
    cour.n += 1;
    cour.sommeR += r;
    agg.set(cle, cour);
  };
  for (const t of trades) {
    const r = rMultiple(t);
    if (r === null) continue;
    if (par === "symbol") {
      ajoute(t.symbol, r);
    } else {
      for (const tag of t.tags) ajoute(tag, r);
    }
  }
  return [...agg.entries()]
    .map(([cle, v]) => ({ cle, n: v.n, sommeR: v.sommeR }))
    .sort((a, b) => b.sommeR - a.sommeR);
}
