/**
 * Couche « NIVEAUX ESTIMÉS » (P6) — approximation des prix de liquidation dérivée de l'Open
 * Interest, DISTINCTE des liquidations RÉELLES peintes par la heatmap (liquidationHeat.ts).
 *
 * MODÈLE (assumé grossier) : chaque HAUSSE d'OI entre deux points consécutifs de l'historique
 * ouvre `ΔOI` USD de positions au `close` de la bougie contenante ; ce notionnel est réparti
 * 50/50 long/short et uniformément sur `LEVIERS` — soit `ΔOI/8` par (côté × levier). Le prix de
 * liquidation approximé vaut `entry×(1−1/L)` (longs) et `entry×(1+1/L)` (shorts). Un niveau dont
 * le prix a déjà été TRAVERSÉ par une bougie ULTÉRIEURE à son ouverture (long : `low ≤ niveau` ;
 * short : `high ≥ niveau`) est considéré CONSOMMÉ et retiré.
 *
 * ⚠️ GARDE-FOU BUILD-CONTRACT (anti-recommandation heatmap propriétaire CoinGlass) : ces niveaux
 * NE sont PAS des liquidations observées. Ils ignorent la marge de maintenance, le levier réel,
 * la répartition effective des positions… C'est une APPROXIMATION — TOUJOURS étiquetée « EST. »
 * / « ESTIMÉS » à l'écran. Ne jamais la présenter comme la « vraie » heatmap de liquidations.
 *
 * `calculerNiveauxEstimes` est PURE et testée. Le store, la commande LIQEST et le fetch OI
 * (au toggle ON + rafraîchissement 15 min) vivent aussi ici ; le RENDU (couche indépendante,
 * lignes orange pointillées) est assuré par `LiquidationHeatController` (liquidationHeat.ts).
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Candle } from "@axiom/types";
import type { Commande } from "../commands/registry";
import { candleContenant } from "./liquidationMarkers";
import { fetchOpenInterestHistoryBatch } from "../data/coinalyze";
import { marketStore } from "../store/market";

/** Un niveau de liquidation ESTIMÉ (approximation — étiquetage « EST. » obligatoire). */
export interface NiveauEstime {
  price: number;
  side: "long" | "short";
  levier: number;
  /** Notionnel USD attribué à ce niveau = ΔOI / (2 × nb de leviers). */
  poidsUsd: number;
}

/**
 * Un niveau estimé déjà CONSOMMÉ (traversé par une bougie ultérieure à son ouverture). Même
 * forme qu'un `NiveauEstime`, plus `tsConsommation` = `time` de la PREMIÈRE bougie traversante.
 * Sert à tracer la trace grisée éphémère (fade sur ~10 bougies) des niveaux récemment purgés.
 */
export interface NiveauConsomme extends NiveauEstime {
  /** `time` de la première bougie qui a traversé le niveau (long : `low ≤ prix` ; short : `high ≥ prix`). */
  tsConsommation: number;
}

/** Résultat DÉTAILLÉ du modèle : niveaux encore actifs + niveaux consommés (avec leur horodatage). */
export interface NiveauxEstimesDetail {
  actifs: NiveauEstime[];
  consommes: NiveauConsomme[];
}

/** Leviers modélisés (ΔOI réparti uniformément entre eux, et 50/50 long/short). */
export const LEVIERS = [10, 25, 50, 100] as const;

// ─────────────────────────── Fonction PURE (testée) ───────────────────────────

/**
 * `time` de la PREMIÈRE bougie ULTÉRIEURE à `apresTime` qui traverse `niveau` du bon côté
 * (long : `low ≤ niveau` ; short : `high ≥ niveau`), ou `undefined` si aucune. Les bougies étant
 * chronologiques, la première rencontrée en itération est la plus ancienne traversante. PURE (locale).
 */
function premiereTraversee(
  candles: Candle[],
  apresTime: number,
  niveau: number,
  side: "long" | "short",
): number | undefined {
  for (const c of candles) {
    if (c.time <= apresTime) continue; // strictement ultérieure à l'ouverture du niveau
    if (side === "long" ? c.low <= niveau : c.high >= niveau) return c.time;
  }
  return undefined;
}

/**
 * Variante DÉTAILLÉE (source de vérité, PURE et testée) : renvoie les niveaux encore ACTIFS
 * ET les niveaux CONSOMMÉS (avec `tsConsommation` = `time` de la première bougie traversante).
 * Chaque hausse d'OI ouvre `ΔOI` au close de la bougie contenante, réparti 50/50 long/short et
 * uniformément sur `leviers` (poids = ΔOI/(2×nb leviers)) ; un niveau traversé par une bougie
 * ultérieure part dans `consommes`, sinon dans `actifs`. Baisse/égalité d'OI → aucun niveau.
 *
 * `leviers` est OPTIONNEL (défaut = `LEVIERS`, tous cochés) : l'utilisateur peut restreindre le
 * modèle à un sous-ensemble via la fenêtre LIQ (cf. `liqEstStore.leviers`). Liste vide → rien
 * (garde anti-division-par-zéro).
 */
export function calculerNiveauxEstimesDetail(
  oiHist: { time: number; oiUsd: number }[],
  candles: Candle[],
  leviers: readonly number[] = LEVIERS,
): NiveauxEstimesDetail {
  const actifs: NiveauEstime[] = [];
  const consommes: NiveauConsomme[] = [];
  if (oiHist.length < 2 || candles.length === 0 || leviers.length === 0) return { actifs, consommes };

  const poidsParNiveau = (delta: number): number => delta / (2 * leviers.length);

  for (let i = 1; i < oiHist.length; i++) {
    const prev = oiHist[i - 1];
    const cur = oiHist[i];
    if (prev === undefined || cur === undefined) continue;
    const delta = cur.oiUsd - prev.oiUsd;
    if (!(delta > 0)) continue; // baisse ou égalité → aucun niveau

    const bougie = candleContenant(candles, cur.time);
    if (bougie === undefined) continue;
    const entry = bougie.close;
    if (!(entry > 0)) continue;

    const poids = poidsParNiveau(delta);
    for (const L of leviers) {
      const niveauLong = entry * (1 - 1 / L);
      const niveauShort = entry * (1 + 1 / L);
      const tsLong = premiereTraversee(candles, bougie.time, niveauLong, "long");
      if (tsLong === undefined) {
        actifs.push({ price: niveauLong, side: "long", levier: L, poidsUsd: poids });
      } else {
        consommes.push({ price: niveauLong, side: "long", levier: L, poidsUsd: poids, tsConsommation: tsLong });
      }
      const tsShort = premiereTraversee(candles, bougie.time, niveauShort, "short");
      if (tsShort === undefined) {
        actifs.push({ price: niveauShort, side: "short", levier: L, poidsUsd: poids });
      } else {
        consommes.push({ price: niveauShort, side: "short", levier: L, poidsUsd: poids, tsConsommation: tsShort });
      }
    }
  }
  return { actifs, consommes };
}

/**
 * Calcule les niveaux de liquidation ESTIMÉS encore ACTIFS depuis l'historique d'OI et les
 * bougies — WRAPPER de `calculerNiveauxEstimesDetail` (renvoie son `.actifs`, comportement
 * historique inchangé). Les niveaux consommés sont écartés silencieusement (cf. la variante
 * détaillée pour les récupérer). PURE.
 */
export function calculerNiveauxEstimes(
  oiHist: { time: number; oiUsd: number }[],
  candles: Candle[],
  leviers: readonly number[] = LEVIERS,
): NiveauEstime[] {
  return calculerNiveauxEstimesDetail(oiHist, candles, leviers).actifs;
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

export interface LiqEstState {
  actif: boolean;
  /** Leviers cochés du modèle (sous-ensemble NON VIDE de `LEVIERS`) — persisté (store/persist.ts). */
  leviers: number[];
  basculer: () => void;
  /** Force l'état ON/OFF (idempotent) — hydratation persistée (cf. store/persist.ts). */
  setActif: (actif: boolean) => void;
  /** Coche/décoche un levier. GARDE : ne jamais vider (le dernier coché reste, no-op). */
  basculerLevier: (L: number) => void;
  /** Force la liste des leviers (filtrée/réordonnée sur `LEVIERS`) — hydratation persistée. */
  setLeviers: (leviers: number[]) => void;
}

export const liqEstStore: StoreApi<LiqEstState> = createStore<LiqEstState>((set, get) => ({
  actif: false,
  leviers: [...LEVIERS],
  basculer: () => set({ actif: !get().actif }),
  setActif: (actif) => set({ actif }),
  basculerLevier: (L) => {
    const coche = get().leviers.includes(L);
    // Reconstruit en ORDRE CANONIQUE (ordre de LEVIERS) : L bascule, les autres gardent leur état.
    const next = LEVIERS.filter((x) => (x === L ? !coche : get().leviers.includes(x)));
    if (next.length === 0) return; // garde : le dernier levier coché n'est pas décochable
    set({ leviers: next });
  },
  setLeviers: (leviers) => {
    const next = LEVIERS.filter((x) => leviers.includes(x));
    if (next.length === 0) return; // liste vide/invalide ignorée (garde : jamais vide)
    set({ leviers: next });
  },
}));

// ─────────────────────────── Store de l'historique OI (données, hors React) ───────────────────────────

/** Historique OI courant (source du recalcul des niveaux au rendu). */
export interface OiHistState {
  hist: { time: number; oiUsd: number }[];
  /** Symbole auquel `hist` se rapporte (null quand la couche est inactive). */
  symbol: string | null;
  /** Compteur de révision (bumpé à chaque mise à jour) — le contrôleur compare `rev`. */
  rev: number;
}

export const oiHistStore: StoreApi<OiHistState> = createStore<OiHistState>(() => ({
  hist: [],
  symbol: null,
  rev: 0,
}));

// ─────────────────────────── Singleton de fetch OI (au toggle + refresh 15 min) ───────────────────────────

/** Fenêtre d'historique OI demandée à Coinalyze (72 h, bucket horaire). */
const WINDOW_MS = 72 * 60 * 60 * 1000;
/** Rafraîchissement de l'OI tant que la couche est active. */
const REFRESH_MS = 15 * 60 * 1000;
/** Période Coinalyze (bucket) de l'historique OI. */
const OI_PERIOD = "1hour";

let symboleActif: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Récupère l'OI (best-effort) et publie dans le store si le symbole n'a pas changé entre-temps. */
async function rafraichirOi(symbol: string): Promise<void> {
  let map: Map<string, { time: number; oiUsd: number }[]>;
  try {
    map = await fetchOpenInterestHistoryBatch([symbol], OI_PERIOD, Date.now() - WINDOW_MS);
  } catch {
    return; // échec réseau : on garde l'état précédent (best-effort)
  }
  if (symboleActif !== symbol) return; // symbole/état changé pendant l'attente → jeté
  const hist = map.get(symbol) ?? [];
  oiHistStore.setState((s) => ({ hist, symbol, rev: s.rev + 1 }));
}

/** Aligne le fetch OI sur l'état (bascule + symbole) : fetch au ON, refresh 15 min, reset au OFF. */
function sync(): void {
  const actif = liqEstStore.getState().actif;
  const symbol = marketStore.getState().symbol;

  if (!actif) {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (symboleActif !== null) {
      symboleActif = null;
      oiHistStore.setState((s) => ({ hist: [], symbol: null, rev: s.rev + 1 }));
    }
    return;
  }
  if (symboleActif !== symbol) {
    symboleActif = symbol;
    // Vide l'historique le temps du fetch (évite d'afficher les niveaux de l'ancien symbole).
    oiHistStore.setState((s) => ({ hist: [], symbol, rev: s.rev + 1 }));
    void rafraichirOi(symbol);
    if (refreshTimer === null) {
      refreshTimer = setInterval(() => {
        if (symboleActif !== null) void rafraichirOi(symboleActif);
      }, REFRESH_MS);
    }
  }
}

let controllerStarted = false;
export function demarrerLiquidationEstimates(): void {
  if (controllerStarted) return;
  controllerStarted = true;

  let prevSymbol = marketStore.getState().symbol;
  marketStore.subscribe(() => {
    const symbol = marketStore.getState().symbol;
    if (symbol !== prevSymbol) {
      prevSymbol = symbol;
      sync();
    }
  });

  let prevActif = liqEstStore.getState().actif;
  liqEstStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      sync();
    }
  });
}

// ─────────────────────────── Commande de palette ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "action:liqest",
    mnemonique: "LIQEST",
    libelle: "Niveaux de liquidation ESTIMÉS (modèle levier) — activer / désactiver",
    categorie: "action",
    motsCles: ["liquidations", "estimes", "estimation", "liqest", "levier", "oi", "open interest", "niveaux", "approximation"],
    apercu: "Superpose des niveaux de liquidation ESTIMÉS depuis l'OI (approximation étiquetée EST.)",
    action: () => liqEstStore.getState().basculer(),
  },
];

demarrerLiquidationEstimates();
