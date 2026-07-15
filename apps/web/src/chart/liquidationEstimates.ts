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

/** Leviers modélisés (ΔOI réparti uniformément entre eux, et 50/50 long/short). */
export const LEVIERS = [10, 25, 50, 100] as const;

// ─────────────────────────── Fonction PURE (testée) ───────────────────────────

/**
 * Vrai si une bougie ULTÉRIEURE à `apresTime` traverse `niveau` du bon côté
 * (long : `low ≤ niveau` ; short : `high ≥ niveau`). PURE (locale).
 */
function niveauTraverse(candles: Candle[], apresTime: number, niveau: number, side: "long" | "short"): boolean {
  for (const c of candles) {
    if (c.time <= apresTime) continue; // strictement ultérieure à l'ouverture du niveau
    if (side === "long" ? c.low <= niveau : c.high >= niveau) return true;
  }
  return false;
}

/**
 * Calcule les niveaux de liquidation ESTIMÉS depuis l'historique d'OI et les bougies.
 * Chaque hausse d'OI ouvre `ΔOI` au close de la bougie contenante, réparti 50/50 long/short
 * et uniformément sur `LEVIERS` (poids = ΔOI/8) ; les niveaux déjà traversés par une bougie
 * ultérieure sont retirés (consommés). Baisse/égalité d'OI → aucun niveau. PURE.
 */
export function calculerNiveauxEstimes(
  oiHist: { time: number; oiUsd: number }[],
  candles: Candle[],
): NiveauEstime[] {
  const out: NiveauEstime[] = [];
  if (oiHist.length < 2 || candles.length === 0) return out;

  const poidsParNiveau = (delta: number): number => delta / (2 * LEVIERS.length);

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
    for (const L of LEVIERS) {
      const niveauLong = entry * (1 - 1 / L);
      const niveauShort = entry * (1 + 1 / L);
      if (!niveauTraverse(candles, bougie.time, niveauLong, "long")) {
        out.push({ price: niveauLong, side: "long", levier: L, poidsUsd: poids });
      }
      if (!niveauTraverse(candles, bougie.time, niveauShort, "short")) {
        out.push({ price: niveauShort, side: "short", levier: L, poidsUsd: poids });
      }
    }
  }
  return out;
}

// ─────────────────────────── Bascule (store vanilla local) ───────────────────────────

export interface LiqEstState {
  actif: boolean;
  basculer: () => void;
  /** Force l'état ON/OFF (idempotent) — hydratation persistée (cf. store/persist.ts). */
  setActif: (actif: boolean) => void;
}

export const liqEstStore: StoreApi<LiqEstState> = createStore<LiqEstState>((set, get) => ({
  actif: false,
  basculer: () => set({ actif: !get().actif }),
  setActif: (actif) => set({ actif }),
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
