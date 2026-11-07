/**
 * Rotation contre BTC — nuage RS-Ratio / RS-Momentum en z-scores (calcul PUR client).
 *
 * POURQUOI : répondre à « quels alts prennent le leadership contre BTC, lesquels
 * s'essoufflent ? » en un coup d'œil, sur une coupe transversale (watchlist ou top N
 * figé au chargement) — onglet « Rotation » de CORR (chantier du 2026-11-07, SUG-6
 * volet 3). C'est une APPROXIMATION OUVERTE inspirée des graphes de rotation relative :
 * ce n'est PAS le RRG® (méthode JdK non publiée, marque déposée) ; aucune prétention
 * d'équivalence. Lecture DESCRIPTIVE : aucune étude figée (≥ 40 alts jamais vues, univers
 * daté) n'a validé un pouvoir prédictif des quadrants.
 *
 * Méthode (t = jour UTC d'un calendrier CONTIGU, du premier au dernier jour commun avec
 * BTC ; un jour sans clôture commune vaut NaN, il n'est JAMAIS enjambé) :
 *   l[t]          = ln(X[t] / BTC[t])                      (log du ratio X÷BTC)
 *   RS-Ratio[t]   = z-score de l sur les FENETRE_Z dernières observations [t-W+1 .. t]
 *                   (où se tient le ratio par rapport à sa moyenne de 52 semaines,
 *                   normalisé — même définition que l'indicateur spreadZScore)
 *   m[t]          = l[t] − l[t-K]                         (variation du ratio sur K jours)
 *   RS-Momentum[t]= z-score de m sur les FENETRE_Z dernières observations
 * z-score : écart à la moyenne de la fenêtre / écart-type POPULATION (convention de
 * spreadZScore). Fenêtre contenant une valeur non finie ⇒ null (pas de fenêtre à trous) :
 * « 14 jours » et « 52 semaines » sont des durées CALENDAIRES exactes. Un trou (clôture
 * manquante d'un côté) dans les PAS + FENETRE derniers jours rend le point non placé, avec
 * la date du trou (revue du 2026-11-07 : l'alignement sur jours communs l'enjambait).
 * Fenêtre constante (écart-type ≈ 0) ⇒ 0 : la valeur EST la moyenne — c'est ce qui place
 * un actif = BTC × c exactement au centre (critère de construction, testé).
 *
 * Quadrants (signe des deux coordonnées) : meneur (+,+), en affaiblissement (+,−),
 * en retard (−,−), en amélioration (−,+). Traîne : les LONGUEUR_TRAINE dernières
 * clôtures journalières (chaque point calculé sur SA propre fenêtre passée).
 *
 * CAUSALITÉ : le point du jour t ne lit que des clôtures ≤ t ; la bougie du jour UTC
 * courant (partielle) est écartée (`exclureJourCourant`, `nowMs` injecté). Ajouter des
 * jours ne modifie aucun point passé (testé par préfixe). Aucune donnée absente n'est
 * remplacée par 0 : un actif sans historique suffisant est listé « non placé » avec sa
 * raison, jamais posé au centre.
 *
 * PIÈGES assumés (affichés par l'UI) : RS ≈ bêta (quand BTC monte, un alt à β > 1 « mène »
 * mécaniquement) ; z-scores glissants et momentum = dérivée du ratio font tourner la
 * traîne même sur du bruit ; univers du jour appliqué au passé (biais du survivant) ;
 * une seule place (Binance spot USDT pour l'univers top N).
 *
 * UNIVERS (revue du 2026-11-07) : seules les paires crypto COTÉES EN DOLLAR entrent dans la
 * coupe (règle de ratio.ts : USD et stablecoins USD, perps comptés en USD). ETHBTC ÷
 * BTCUSDT donnerait ETH/BTC², une paire en EUR mélangerait deux devises : elles sont
 * écartées avec leur raison (`classerUniversTransversal`). BTC est reconnu par sa BASE
 * (BTCUSDT, BTCUSD, BTC-PERP…) : jamais compté comme un alt. Un même actif coté deux fois
 * (ETHUSDT et ETH-PERP) n'est compté qu'une fois.
 */
import type { ExchangeId } from "@axiom/types";
import {
  alignerSeriesJours,
  bucketJour,
  debutJour,
  exclureJourCourant,
  type SerieCloture,
} from "./corr";
import { basePerp, COTATIONS_USD, splitSymbol } from "./symbol";

// ─────────────────────────── Paramètres (figés, documentés) ───────────────────────────

/** Symbole de référence du ratio (Binance spot, comme les réfs des indicateurs statistiques). */
export const REFERENCE_ROTATION = "BTCUSDT";

/** Fenêtre des z-scores : 52 semaines d'observations communes. */
export const FENETRE_Z_ROTATION = 364;

/** Pas du momentum : variation du log-ratio sur 14 jours. */
export const PAS_MOMENTUM_ROTATION = 14;

/** Longueur de la traîne (dernières clôtures journalières). */
export const LONGUEUR_TRAINE = 8;

/** Observations communes minimales pour placer le point du jour (RS-Momentum défini). */
export const OBS_MIN_POINT = PAS_MOMENTUM_ROTATION + FENETRE_Z_ROTATION;

/** Observations communes pour une traîne complète. */
export const OBS_TRAINE_COMPLETE = OBS_MIN_POINT + LONGUEUR_TRAINE - 1;

/** Écart-type en deçà duquel une fenêtre est tenue pour constante (z = 0). */
const EPS_ECART_TYPE = 1e-12;

// ─────────────────────────── Quadrants ───────────────────────────

/** Quadrant d'un point du nuage (« neutre » = exactement sur un axe). */
export type QuadrantRotation = "meneur" | "affaiblissement" | "retard" | "amelioration" | "neutre";

/** Libellés français des quadrants (UI, tables, infobulles). */
export const LIBELLES_QUADRANT: Record<QuadrantRotation, string> = {
  meneur: "Meneur",
  affaiblissement: "En affaiblissement",
  retard: "En retard",
  amelioration: "En amélioration",
  neutre: "Neutre (sur un axe)",
};

/** Quadrant d'après le signe des coordonnées (x = RS-Ratio, y = RS-Momentum). PURE. */
export function quadrantRotation(x: number, y: number): QuadrantRotation {
  if (x === 0 || y === 0) return "neutre";
  if (x > 0) return y > 0 ? "meneur" : "affaiblissement";
  return y > 0 ? "amelioration" : "retard";
}

// ─────────────────────────── z-score glissant (pur) ───────────────────────────

/**
 * z-score glissant sur les `fenetre` dernières valeurs [t-fenetre+1 .. t] : null tant que la
 * fenêtre est incomplète ou si elle contient une valeur non finie ; 0 si la fenêtre est
 * constante (écart-type ≤ 1e-12). Écart-type POPULATION. Fonction PURE.
 */
export function zGlissant(valeurs: readonly number[], fenetre: number): (number | null)[] {
  const n = valeurs.length;
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  if (fenetre < 2) return out;
  for (let t = fenetre - 1; t < n; t++) {
    let somme = 0;
    let complet = true;
    for (let k = t - fenetre + 1; k <= t; k++) {
      const v = valeurs[k];
      if (v === undefined || !Number.isFinite(v)) {
        complet = false;
        break;
      }
      somme += v;
    }
    if (!complet) continue;
    const moyenne = somme / fenetre;
    let carres = 0;
    for (let k = t - fenetre + 1; k <= t; k++) {
      const d = (valeurs[k] as number) - moyenne;
      carres += d * d;
    }
    const ecart = Math.sqrt(carres / fenetre);
    const courant = valeurs[t] as number;
    out[t] = ecart <= EPS_ECART_TYPE ? 0 : (courant - moyenne) / ecart;
  }
  return out;
}

// ─────────────────────────── Séries de rotation d'un actif (pur) ───────────────────────────

/** Séries RS-Ratio / RS-Momentum d'un actif sur un calendrier contigu de jours UTC. */
export interface SeriesRotation {
  /**
   * Calendrier CONTIGU de numéros de jour UTC (cf. `bucketJour`), du premier au dernier jour
   * commun avec la référence : un jour sans clôture commune y figure (valeurs null).
   */
  jours: number[];
  rsRatio: (number | null)[];
  rsMomentum: (number | null)[];
  /** Jours du calendrier où les DEUX clôtures existent (couverture réelle). */
  nCommuns: number;
  /** log(X÷réf) par jour du calendrier, NaN sur un trou (sert à dater un trou). */
  logRatio: number[];
}

/**
 * Calcule RS-Ratio et RS-Momentum d'un actif contre la référence, sur des séries DÉJÀ
 * privées de la bougie du jour courant. Calendrier contigu : un jour manquant d'un côté
 * vaut NaN et invalide toute fenêtre qui le contient (zGlissant), au lieu d'être enjambé —
 * le momentum couvre exactement PAS jours, la fenêtre exactement FENETRE jours. PURE.
 */
export function calculerSeriesRotation(actif: SerieCloture[], ref: SerieCloture[]): SeriesRotation {
  const { jours: communs, a, b } = alignerSeriesJours(actif, ref);
  const premier = communs[0];
  const dernier = communs[communs.length - 1];
  if (premier === undefined || dernier === undefined) {
    return { jours: [], rsRatio: [], rsMomentum: [], nCommuns: 0, logRatio: [] };
  }
  // Les jours communs sont un sous-ensemble des ~400 bougies de la référence : le
  // calendrier contigu reste de cette taille.
  const T = dernier - premier + 1;
  const jours = Array.from({ length: T }, (_, k) => premier + k);
  const logRatio = new Array<number>(T).fill(NaN);
  let nCommuns = 0;
  communs.forEach((j, i) => {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || !(x > 0) || !(y > 0)) return;
    logRatio[j - premier] = Math.log(x / y);
    nCommuns += 1;
  });
  // NaN propagé : la variation sur PAS jours n'existe que si les DEUX bornes existent.
  const momentum = logRatio.map((v, t) =>
    t < PAS_MOMENTUM_ROTATION ? NaN : v - (logRatio[t - PAS_MOMENTUM_ROTATION] as number),
  );
  // Les PAS_MOMENTUM premières valeurs de `momentum` sont NaN (pas de borne passée) : la
  // première fenêtre complète de RS-Momentum finit donc à l'index PAS + FENETRE − 1.
  return {
    jours,
    rsRatio: zGlissant(logRatio, FENETRE_Z_ROTATION),
    rsMomentum: zGlissant(momentum, FENETRE_Z_ROTATION),
    nCommuns,
    logRatio,
  };
}

/** Ratio X÷référence daté (graphe du clic), sur des séries privées du jour courant. PURE. */
export function serieRatio(actif: SerieCloture[], ref: SerieCloture[]): { jours: number[]; ratio: number[] } {
  const { jours, a, b } = alignerSeriesJours(actif, ref);
  const outJours: number[] = [];
  const ratio: number[] = [];
  a.forEach((x, i) => {
    const y = b[i];
    const j = jours[i];
    if (y === undefined || j === undefined || !(x > 0) || !(y > 0)) return;
    outJours.push(j);
    ratio.push(x / y);
  });
  return { jours: outJours, ratio };
}

// ─────────────────────────── Nuage de la coupe transversale (pur) ───────────────────────────

/** Un point de traîne (jour UTC + coordonnées). */
export interface PointTraine {
  jour: number;
  x: number;
  y: number;
}

/** Un actif placé dans le nuage (coordonnées du DERNIER jour clos commun avec BTC). */
export interface PointRotation {
  symbole: string;
  x: number;
  y: number;
  quadrant: QuadrantRotation;
  /** Numéro de jour UTC du point courant. */
  jour: number;
  /** Traîne chronologique (le dernier élément est le point courant), ≤ LONGUEUR_TRAINE. */
  traine: PointTraine[];
  /** Jours de clôture communs avec la référence (couverture de l'historique chargé). */
  nObs: number;
}

/** Actif de l'univers NON placé, avec sa raison explicite (jamais posé au centre). */
export interface NonPlace {
  symbole: string;
  raison: string;
}

/** Résultat du nuage sur un univers. */
export interface ResultatRotation {
  points: PointRotation[];
  nonPlaces: NonPlace[];
  /** Série de référence chargée et non vide. */
  refDisponible: boolean;
  /** Dernier jour clos de la référence (numéro UTC), null si indisponible. */
  dernierJour: number | null;
}

// ─────────────────────────── Univers de la coupe (pur) ───────────────────────────

/**
 * Base CANONIQUE et cotation d'une paire crypto, selon la source (même découpage que
 * ratio.ts) : perps (Hyperliquid, suffixe -PERP) cotés en USD (réglés en USDC, comptés
 * pour 1 USD) ; tiret Coinbase toléré ; alias Kraken XBT → BTC. null si non découpable
 * (cotation inconnue). PURE.
 */
export function decouperPaireCrypto(symbole: string, source: ExchangeId): { base: string; quote: string } | null {
  const s = symbole.trim().toUpperCase();
  if (source === "hyperliquid" || s.endsWith("-PERP")) {
    const base = basePerp(s, source);
    return base === null ? null : { base, quote: "USD" };
  }
  try {
    const { base, quote } = splitSymbol(s.includes("/") ? s : s.replace("-", "/"), source);
    return { base: base === "XBT" ? "BTC" : base, quote };
  } catch {
    return null;
  }
}

/** Classement d'une paire crypto pour la coupe transversale contre BTCUSDT. */
export type ClassePaire =
  | { type: "alt"; base: string }
  | { type: "reference" }
  | { type: "exclu"; raison: string };

/**
 * Classe une paire crypto : « reference » (base BTC cotée en dollar, spot ou perp), « alt »
 * (autre base cotée en dollar) ou « exclu » avec la raison (cotation non USD ou inconnue :
 * le ratio X÷BTCUSDT serait faux). Règle de ratio.ts (COTATIONS_USD). PURE.
 */
export function classerPaireTransversale(symbole: string, source: ExchangeId): ClassePaire {
  const paire = decouperPaireCrypto(symbole, source);
  if (paire === null) return { type: "exclu", raison: "cotation non reconnue : ratio contre BTC non calculable" };
  if (!COTATIONS_USD.includes(paire.quote)) {
    return {
      type: "exclu",
      raison:
        paire.quote === "BTC"
          ? "cotation BTC (non USD) : la diviser par BTCUSDT donnerait X/BTC²"
          : `cotation ${paire.quote} (non USD) : la diviser par BTCUSDT mélangerait deux devises`,
    };
  }
  return paire.base === "BTC" ? { type: "reference" } : { type: "alt", base: paire.base };
}

/** Univers de coupe transversale classé (Rotation et Régime). */
export interface UniversClasse {
  /** Alts retenus : paires crypto cotées en dollar, un symbole par actif, hors BTC. */
  alts: string[];
  /** Paires de base BTC cotées en dollar (BTCUSDT, BTCUSD, BTC-PERP…) : la référence. */
  references: string[];
  /** Séries hors crypto (Twelve Data, synthétiques) : écartées. */
  horsCrypto: string[];
  /** Paires crypto écartées avec leur raison (cotation non USD ou inconnue, même actif). */
  exclus: NonPlace[];
}

/**
 * Classe un univers brut (watchlist ou top N) pour la coupe transversale : symboles
 * normalisés (majuscules) et dédoublonnés, ordre d'entrée conservé. `sourceDe` donne la
 * source de chaque symbole (découpage propre à la place, perps). Un même actif sous deux
 * cotations (ETHUSDT et ETH-PERP) n'est compté qu'une fois : le premier rencontré. PURE.
 */
export function classerUniversTransversal(
  symboles: readonly string[],
  sourceDe: (symbole: string) => ExchangeId,
): UniversClasse {
  const out: UniversClasse = { alts: [], references: [], horsCrypto: [], exclus: [] };
  const vus = new Set<string>();
  const premierParBase = new Map<string, string>();
  for (const brut of symboles) {
    const symbole = brut.trim().toUpperCase();
    if (symbole.length === 0 || vus.has(symbole)) continue;
    vus.add(symbole);
    const source = sourceDe(symbole);
    if (source === "twelvedata" || source === "synthetic") {
      out.horsCrypto.push(symbole);
      continue;
    }
    const classe = classerPaireTransversale(symbole, source);
    if (classe.type === "exclu") {
      out.exclus.push({ symbole, raison: classe.raison });
    } else if (classe.type === "reference") {
      out.references.push(symbole);
    } else {
      const premier = premierParBase.get(classe.base);
      if (premier === undefined) {
        premierParBase.set(classe.base, symbole);
        out.alts.push(symbole);
      } else {
        out.exclus.push({ symbole, raison: `même actif que ${premier} (base ${classe.base}) : compté une fois` });
      }
    }
  }
  return out;
}

/** Date ISO « AAAA-MM-JJ » d'un numéro de jour UTC (raisons lisibles, sans fuseau local). */
function dateIsoJour(jour: number): string {
  return new Date(debutJour(jour)).toISOString().slice(0, 10);
}

/**
 * Nuage RS-Ratio / RS-Momentum d'un univers contre la référence. `nowMs` sert UNIQUEMENT à
 * écarter la bougie du jour UTC courant (jamais de Date.now() ici). Un actif est placé si
 * son RS-Momentum est défini au DERNIER jour clos de la référence ; sinon il est listé
 * « non placé » avec la raison (référence ou cotation non USD, série indisponible,
 * historique insuffisant, données en retard sur BTC, trou daté dans la fenêtre). Les
 * `symboles` sont normalement les alts de `classerUniversTransversal` ; la garde de
 * cotation est rejouée ici (découpage Binance, la place de la référence) pour qu'aucun
 * appelant ne puisse placer ETHBTC ou BTC-PERP. Ordre d'entrée conservé. Fonction PURE.
 */
export function calculerRotation(
  series: ReadonlyMap<string, SerieCloture[]>,
  symboles: readonly string[],
  ref: SerieCloture[],
  nowMs: number,
): ResultatRotation {
  const refClose = exclureJourCourant(ref, nowMs);
  const dernierRef = refClose[refClose.length - 1];
  if (dernierRef === undefined) {
    return {
      points: [],
      nonPlaces: symboles.map((symbole) => ({ symbole, raison: "référence BTC indisponible" })),
      refDisponible: false,
      dernierJour: null,
    };
  }
  const dernierJour = bucketJour(dernierRef.time);
  const points: PointRotation[] = [];
  const nonPlaces: NonPlace[] = [];
  for (const symbole of symboles) {
    const classe = classerPaireTransversale(symbole, "binance");
    if (classe.type !== "alt") {
      nonPlaces.push({
        symbole,
        raison: classe.type === "reference" ? "référence du ratio (base BTC : X÷BTC ≈ constant)" : classe.raison,
      });
      continue;
    }
    const brute = series.get(symbole) ?? [];
    if (brute.length === 0) {
      nonPlaces.push({ symbole, raison: "série indisponible (paire non listée, source en panne ou quota)" });
      continue;
    }
    const s = calculerSeriesRotation(exclureJourCourant(brute, nowMs), refClose);
    const n = s.jours.length; // longueur du calendrier contigu
    const dernier = n - 1;
    if (s.nCommuns < OBS_MIN_POINT) {
      nonPlaces.push({
        symbole,
        raison: `historique insuffisant : ${s.nCommuns} jours communs avec BTC (${OBS_MIN_POINT} requis)`,
      });
      continue;
    }
    if (s.jours[dernier] !== dernierJour) {
      nonPlaces.push({ symbole, raison: "données en retard sur BTC (dernière clôture commune antérieure)" });
      continue;
    }
    const x = s.rsRatio[dernier];
    const y = s.rsMomentum[dernier];
    if (x === null || x === undefined || y === null || y === undefined) {
      // Seule cause possible ici (≥ OBS_MIN_POINT jours communs, dernier jour présent) : un
      // jour sans clôture commune dans les OBS_MIN_POINT derniers jours du calendrier.
      let trou: number | null = null;
      for (let t = dernier; t >= Math.max(0, n - OBS_MIN_POINT); t--) {
        if (!Number.isFinite(s.logRatio[t] as number)) {
          trou = s.jours[t] ?? null;
          break;
        }
      }
      nonPlaces.push({
        symbole,
        raison: `clôture manquante${trou === null ? "" : ` le ${dateIsoJour(trou)}`} dans les ${OBS_MIN_POINT} derniers jours (52 semaines + momentum ${PAS_MOMENTUM_ROTATION} j) : z-scores non calculables`,
      });
      continue;
    }
    const traine: PointTraine[] = [];
    for (let t = Math.max(0, n - LONGUEUR_TRAINE); t < n; t++) {
      const tx = s.rsRatio[t];
      const ty = s.rsMomentum[t];
      const jour = s.jours[t];
      if (tx === null || tx === undefined || ty === null || ty === undefined || jour === undefined) continue;
      traine.push({ jour, x: tx, y: ty });
    }
    points.push({ symbole, x, y, quadrant: quadrantRotation(x, y), jour: dernierJour, traine, nObs: s.nCommuns });
  }
  return { points, nonPlaces, refDisponible: true, dernierJour };
}

/** Effectif par quadrant (résumé de l'en-tête de l'onglet). PURE. */
export function compterQuadrants(points: readonly PointRotation[]): Record<QuadrantRotation, number> {
  const out: Record<QuadrantRotation, number> = {
    meneur: 0,
    affaiblissement: 0,
    retard: 0,
    amelioration: 0,
    neutre: 0,
  };
  for (const p of points) out[p.quadrant] += 1;
  return out;
}
