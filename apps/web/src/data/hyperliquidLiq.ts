/**
 * Couche « NIVEAUX DE LIQUIDATION RÉELS » (Hyperliquid) — prix de liquidation des positions
 * OUVERTES observées sur les top adresses du leaderboard, servis par le daemon `axiomd`
 * (`GET /hl/liqlevels/:coin`, cache 5 min côté daemon, capability `hl`).
 *
 * ⚠️ HONNÊTETÉ DE LA SOURCE (garde-fou BUILD-CONTRACT) : ces niveaux sont RÉELS — ce sont de
 * vraies positions, pas un modèle — mais NON EXHAUSTIFS : c'est le TOP du leaderboard, PAS tout
 * le carnet, et le seul Hyperliquid. À NE JAMAIS présenter comme « toutes » les liquidations à
 * venir. Distincts des deux autres couches : la heatmap RÉELLE peint des liquidations DÉJÀ
 * EXÉCUTÉES (chart/liquidationHeat.ts), les niveaux ESTIMÉS sont un MODÈLE de levier sur l'OI
 * (chart/liquidationEstimates.ts).
 *
 * Ce module tient le CLIENT (mapping + décision d'état, PURS et testés) et le STORE + son
 * singleton de rafraîchissement ; le RENDU (barres horizontales au bord droit) est assuré par
 * `LiquidationHeatController` (chart/liquidationHeat.ts), comme pour les niveaux ESTIMÉS.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { hlLiqLevelsGet, daemonSupporteHl } from "./daemon";
import { basePerp } from "./symbol";
import { marketStore } from "../store/market";

/** Un niveau de liquidation RÉEL : position ouverte d'une adresse du leaderboard. */
export interface NiveauHl {
  /** Prix de liquidation de la position. */
  px: number;
  /** Sens de la position (un LONG est liquidé SOUS le prix, un SHORT AU-DESSUS). */
  side: "long" | "short";
  /** Notionnel USD de la position. */
  valueUsd: number;
  entryPx: number;
  lev: number;
  addr: string;
}

/** Charge utile de `GET /hl/liqlevels/:coin` (contrat apps/daemon). */
export interface ReponseHlLiq {
  ts: number;
  coin: string;
  /** Nombre d'adresses effectivement scannées (affiché en légende — mesure la couverture). */
  adressesScannees: number;
  niveaux: NiveauHl[];
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/** Un niveau brut est-il exploitable ? (le daemon relaie l'API telle quelle). PURE (locale). */
function niveauValide(brut: unknown): brut is NiveauHl {
  if (!brut || typeof brut !== "object") return false;
  const n = brut as Record<string, unknown>;
  return (
    typeof n.px === "number" &&
    Number.isFinite(n.px) &&
    (n.side === "long" || n.side === "short") &&
    typeof n.valueUsd === "number" &&
    Number.isFinite(n.valueUsd)
  );
}

/**
 * Valide et normalise la réponse du daemon. Les niveaux INEXPLOITABLES (prix non fini, side
 * inconnu, montant non numérique) sont écartés UN À UN — un enregistrement bancal ne doit pas
 * rendre muette toute la couche. Renvoie `null` si l'enveloppe elle-même n'est pas conforme
 * (pas d'objet, `niveaux` absent/non tableau, `coin`/`ts` de mauvais type). PURE.
 */
export function mapperReponseHl(brut: unknown): ReponseHlLiq | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (!Array.isArray(o.niveaux)) return null;
  if (typeof o.coin !== "string" || typeof o.ts !== "number") return null;
  const adresses = typeof o.adressesScannees === "number" ? o.adressesScannees : 0;
  const niveaux: NiveauHl[] = [];
  for (const n of o.niveaux) {
    if (!niveauValide(n)) continue;
    niveaux.push({
      px: n.px,
      side: n.side,
      valueUsd: n.valueUsd,
      entryPx: typeof n.entryPx === "number" ? n.entryPx : 0,
      lev: typeof n.lev === "number" ? n.lev : 0,
      addr: typeof n.addr === "string" ? n.addr : "",
    });
  }
  return { ts: o.ts, coin: o.coin, adressesScannees: adresses, niveaux };
}

/** État affiché de la couche (une seule raison à la fois, cf. légende du contrôleur). */
export type EtatHl = "ok" | "sans-daemon" | "vide" | "erreur";

/**
 * État à afficher : la capability prime (sans daemon, aucune réponse ne peut être vraie —
 * précédent REPLAY), puis l'échec réseau/forme (`erreur` douce), puis l'absence de niveau
 * (`vide` : coin hors leaderboard). PURE.
 */
export function deciderEtatHl(capabilityHl: boolean, reponse: ReponseHlLiq | null): EtatHl {
  if (!capabilityHl) return "sans-daemon";
  if (reponse === null) return "erreur";
  return reponse.niveaux.length === 0 ? "vide" : "ok";
}

// ─────────────────────────── Store vanilla (bascule + données) ───────────────────────────

export interface HlLiqState {
  actif: boolean;
  etat: EtatHl;
  niveaux: NiveauHl[];
  /** Horodatage de la réponse daemon (0 tant que rien n'a été reçu). */
  ts: number;
  /**
   * Adresses scannées par le daemon — ÉCART ASSUMÉ à la forme demandée `{actif, etat, niveaux,
   * ts}` : la légende affiche « N adresses · M positions », et N ne se déduit d'aucun autre champ.
   */
  adressesScannees: number;
  basculer: () => void;
  /** Force l'état ON/OFF (idempotent). */
  setActif: (actif: boolean) => void;
}

/** État « aucune donnée » — état initial ET remise à zéro au OFF / changement de symbole. */
const VIDE = { etat: "vide" as EtatHl, niveaux: [] as NiveauHl[], ts: 0, adressesScannees: 0 };

export const hlLiqStore: StoreApi<HlLiqState> = createStore<HlLiqState>((set, get) => ({
  actif: false,
  ...VIDE,
  basculer: () => set({ actif: !get().actif }),
  setActif: (actif) => set({ actif }),
}));

// ─────────────────────────── Singleton de fetch (4 min + changement de symbole) ───────────────────────────

/** Rafraîchissement tant que la couche est active (le daemon cache déjà 5 min). */
const REFRESH_MS = 4 * 60 * 1000;

let coinActif: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Interroge le daemon (best-effort) et publie si le coin n'a pas changé entre-temps. */
async function rafraichir(coin: string): Promise<void> {
  const brut = await hlLiqLevelsGet(coin);
  const reponse = brut === null ? null : mapperReponseHl(brut);
  // Lu APRÈS l'appel : `hlLiqLevelsGet` a sondé /health, la capability est donc à jour.
  const etat = deciderEtatHl(daemonSupporteHl(), reponse);
  if (coinActif !== coin) return; // symbole/état changé pendant l'attente → jeté
  hlLiqStore.setState({
    etat,
    niveaux: reponse?.niveaux ?? [],
    ts: reponse?.ts ?? 0,
    adressesScannees: reponse?.adressesScannees ?? 0,
  });
}

/**
 * Aligne le fetch sur l'état (bascule + symbole) : fetch au ON, refresh 4 min, reset au OFF.
 * Le coin est la BASE du symbole du chart (`basePerp` — Hyperliquid indexe par actif, « BTC »,
 * pas par paire) ; une base inextricable (symbole synthétique) reste sur l'état « vide », le
 * seul des quatre qui décrive honnêtement « rien à montrer pour ce symbole » sans accuser à
 * tort le daemon ni inventer une erreur.
 */
function sync(): void {
  const actif = hlLiqStore.getState().actif;
  const coin = actif ? basePerp(marketStore.getState().symbol) : null;

  if (!actif || coin === null) {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    coinActif = null;
    hlLiqStore.setState(VIDE);
    return;
  }
  if (coinActif !== coin) {
    coinActif = coin;
    hlLiqStore.setState(VIDE); // évite d'afficher les niveaux de l'ancien coin pendant le fetch
    void rafraichir(coin);
    if (refreshTimer === null) {
      refreshTimer = setInterval(() => {
        if (coinActif !== null) void rafraichir(coinActif);
      }, REFRESH_MS);
    }
  }
}

let controllerStarted = false;
export function demarrerHyperliquidLiq(): void {
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

  // GARDE anti-boucle : l'état du store change à CHAQUE fetch (niveaux/etat/ts) — ne
  // re-synchroniser que sur la bascule `actif`, comme le fait liquidationEstimates.
  let prevActif = hlLiqStore.getState().actif;
  hlLiqStore.subscribe((s) => {
    if (s.actif !== prevActif) {
      prevActif = s.actif;
      sync();
    }
  });
}

// ─────────────────────────── Commande de palette ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "action:liqhl",
    mnemonique: "LIQHL",
    libelle: "Niveaux de liquidation RÉELS Hyperliquid (top adresses) — activer / désactiver",
    categorie: "action",
    motsCles: ["liquidations", "reels", "hyperliquid", "hl", "liqhl", "niveaux", "leaderboard", "positions", "daemon"],
    apercu: "Superpose les prix de liquidation RÉELS des top positions Hyperliquid (nécessite le daemon)",
    action: () => hlLiqStore.getState().basculer(),
  },
];

demarrerHyperliquidLiq();
