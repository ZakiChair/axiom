/**
 * Couche « NIVEAUX DE LIQUIDATION RÉELS » (Hyperliquid) — prix de liquidation des positions
 * OUVERTES observées sur un ÉCHANTILLON d'adresses du leaderboard (pool daemon d'environ
 * 1 500 adresses : plus gros comptes + plus gros volumes de la semaine), servis par le daemon
 * `axiomd` (`GET /hl/liqlevels/:coin`, cache 5 min côté daemon, capability `hl`). Juste après
 * le démarrage du daemon, son premier scan (≈ 4 à 5 min) est signalé « en construction » (503) :
 * la couche reste « chargement » et relance toutes les ~30 s. Un amont en panne répond au
 * contraire le 503 « pool indisponible » → état « erreur » (jamais « chargement » sans fin).
 *
 * ⚠️ HONNÊTETÉ DE LA SOURCE (garde-fou BUILD-CONTRACT) : ces niveaux sont RÉELS — ce sont de
 * vraies positions, pas un modèle — mais NON EXHAUSTIFS : c'est un échantillon du leaderboard,
 * PAS tout le carnet, et le seul Hyperliquid. À NE JAMAIS présenter comme « toutes » les liquidations à
 * venir. Distincts des deux autres couches : la heatmap RÉELLE peint des liquidations DÉJÀ
 * EXÉCUTÉES (chart/liquidationHeat.ts), les niveaux ESTIMÉS sont un MODÈLE de levier sur l'OI
 * (chart/liquidationEstimates.ts).
 *
 * Ce module tient le CLIENT (mapping + décision d'état, PURS et testés) et le STORE + son
 * singleton de rafraîchissement ; le RENDU (barres horizontales au bord droit + heatmap
 * des instantanés historiques) est assuré par `LiquidationHeatController`
 * (chart/liquidationHeat.ts), comme pour les niveaux ESTIMÉS.
 *
 * À l'ACTIVATION de la couche, le front pose aussi le drapeau KV `hl/heat` du daemon
 * (UNE fois par activation, best-effort) : c'est lui qui enclenche la collecte d'
 * instantanés historiques (`hlLiqHeat.ts` côté daemon, heatmap LIQHL côté chart).
 * Aucune écriture au passage à OFF — la collecte reste un choix daemon persistant,
 * pilotable depuis la fenêtre LIQ (« Collecte daemon »).
 *
 * DEUX SOURCES (extension du 25 septembre, `deciderModeHl`) : sur Vercel, et en local quand le
 * daemon n'annonce pas `hl`, la couche passe en mode NAVIGATEUR — le même scan (code partagé
 * shared/hyperliquidScan.ts) tourne dans la page, chargé PARESSEUSEMENT
 * (data/hyperliquidLiqNavigateur.ts, hors chunk d'entrée) ; pool réduit servi par la fonction
 * Vercel `/hlpool`, sinon leaderboard direct. Le mode DAEMON ci-dessous est inchangé ; le store
 * dit la source (`source`) et la progression du premier scan navigateur (`progression`), que
 * la légende affiche. L'historique (heatmap HL) reste réservé au daemon. En local, le repli
 * n'est PAS définitif : le daemon est re-sondé toutes les 60 s (`SONDE_RETOUR_DAEMON_MS`) et,
 * dès qu'il annonce de nouveau `hl` (redémarrage, lancement tardif), la couche lui revient et
 * le scan de la page s'arrête — jamais deux scans durables sur la même IP.
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { hlLiqLevelsGet, daemonSupporteHl, detectDaemon, kvPut } from "./daemon";
import { basePerp } from "./symbol";
import { IS_VERCEL } from "../lib/deployment";
import { marketStore } from "../store/market";
import { pousserToast } from "../store/toasts";

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

/**
 * Le daemon répond-il « instantané en construction » ? (503 `{ enConstruction: true }`,
 * corps relayé BRUT par `hlLiqLevelsGet`/`hlPositionsGet` : premier scan du pool après le
 * boot, sans aucun cache). DISTINCT d'un échec : la couche reste « chargement » et relance
 * tôt. À tester AVANT `mapperReponseHl`, qui rejette ce corps (→ « erreur »). PURE, partagée
 * avec la fenêtre WHALES (onglet Positions HL).
 */
export function estEnConstructionHl(brut: unknown): boolean {
  return typeof brut === "object" && brut !== null && (brut as { enConstruction?: unknown }).enConstruction === true;
}

/**
 * État affiché de la couche (une seule raison à la fois, cf. légende du contrôleur).
 * `chargement` est posé par `sync()` au lancement d'un fetch (activation ou changement
 * de coin) et remplacé par l'état décidé à la réponse — sinon la légende affichait
 * « aucun niveau pour ce symbole » pendant toute la requête, ce qui est faux. Il reste
 * posé tant que le daemon répond « en construction » (`estEnConstructionHl`).
 */
export type EtatHl = "ok" | "sans-daemon" | "vide" | "erreur" | "chargement";

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

/** Qui produit les niveaux : le daemon `axiomd`, ou le scan direct de la page. */
export type SourceHl = "daemon" | "navigateur";

/** Avancement du PREMIER scan navigateur (adresses tentées / taille du pool). */
export interface ProgressionHl {
  faites: number;
  total: number;
}

/**
 * Mode de la couche : Vercel → navigateur (aucun daemon joignable) ; local → daemon s'il
 * annonce la capability `hl`, sinon navigateur (repli, re-sondé : `SONDE_RETOUR_DAEMON_MS`).
 * En local, la capability n'est connue qu'APRÈS la sonde de `hlLiqLevelsGet` : le mode daemon
 * est tenté d'abord. PURE.
 */
export function deciderModeHl(isVercel: boolean, capabilityHl: boolean): SourceHl {
  return isVercel || !capabilityHl ? "navigateur" : "daemon";
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
  /** Source des niveaux (légende « LIQ HL RÉELS (navigateur) »). */
  source: SourceHl;
  /** Premier scan navigateur en cours (null : daemon, pool en chargement, ou scan fini). */
  progression: ProgressionHl | null;
  basculer: () => void;
  /** Force l'état ON/OFF (idempotent). */
  setActif: (actif: boolean) => void;
}

/** État « aucune donnée » — état initial ET remise à zéro au OFF / changement de symbole. */
const VIDE = {
  etat: "vide" as EtatHl,
  niveaux: [] as NiveauHl[],
  ts: 0,
  adressesScannees: 0,
  source: "daemon" as SourceHl,
  progression: null as ProgressionHl | null,
};

export const hlLiqStore: StoreApi<HlLiqState> = createStore<HlLiqState>((set, get) => ({
  actif: false,
  ...VIDE,
  basculer: () => set({ actif: !get().actif }),
  setActif: (actif) => set({ actif }),
}));

// ─────────────────────────── Singleton de fetch (4 min + changement de symbole) ───────────────────────────

/** Rafraîchissement tant que la couche est active (le daemon cache déjà 5 min). */
export const REFRESH_MS = 4 * 60 * 1000;
/**
 * Re-sonde du daemon pendant un repli navigateur LOCAL : dès qu'il annonce de nouveau `hl`
 * (redémarré, ou lancé après la page), la couche lui revient et le scan de la page s'arrête —
 * sinon deux scans à 750 poids/min se partageraient l'IP (quota 1 200). 60 s = fraîcheur de
 * `detectDaemon`, déjà re-sondé toutes les 60 s par data/daemon.ts : aucune requête en plus.
 */
export const SONDE_RETOUR_DAEMON_MS = 60_000;
/**
 * Relance tant que le daemon répond « en construction » : son premier scan du pool
 * (~1 500 adresses) dure ≈ 4 min (≈ 4,5 si le leaderboard est retéléchargé) ; aligné sur
 * l'en-tête Retry-After (30 s) du daemon.
 */
export const RELANCE_CONSTRUCTION_MS = 30_000;

let coinActif: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
/** Relance courte armée par une réponse « en construction » (une seule à la fois). */
let relanceTimer: ReturnType<typeof setTimeout> | null = null;

function annulerRelance(): void {
  if (relanceTimer !== null) {
    clearTimeout(relanceTimer);
    relanceTimer = null;
  }
}
/** Le drapeau KV `hl/heat` (collecte d'instantanés historiques) n'est posé qu'UNE fois
 *  par activation de la couche — jamais au OFF (cf. en-tête). */
let drapeauHeatPose = false;

/**
 * Pose le drapeau de collecte heatmap HL côté daemon, best-effort et UNE fois par
 * activation. Lu APRÈS un fetch : `hlLiqLevelsGet` a sondé /health, la capability `hl`
 * est alors à jour même si elle était inconnue à la bascule.
 */
function assurerDrapeauHeat(): void {
  if (drapeauHeatPose || !daemonSupporteHl()) return;
  drapeauHeatPose = true;
  void kvPut("hl", "heat", { actif: true, majTs: Date.now() });
}

/** Interroge le daemon (best-effort) et publie si le coin n'a pas changé entre-temps. */
async function rafraichir(coin: string): Promise<void> {
  const brut = await hlLiqLevelsGet(coin);
  assurerDrapeauHeat();
  if (estEnConstructionHl(brut)) {
    if (coinActif !== coin) return;
    // Premier scan du daemon en cours : « chargement » (pas « erreur », pas « vide »),
    // niveaux purgés (rien de neuf à montrer) et relance dans ~30 s plutôt que 4 min.
    hlLiqStore.setState({ ...VIDE, etat: "chargement" });
    annulerRelance();
    relanceTimer = setTimeout(() => {
      relanceTimer = null;
      if (coinActif === coin) void rafraichir(coin);
    }, RELANCE_CONSTRUCTION_MS);
    return;
  }
  // Lu APRÈS l'appel : `hlLiqLevelsGet` a sondé /health, la capability est donc à jour.
  // Daemon absent (ou sans `hl`) : repli sur le scan navigateur au lieu de « sans-daemon ».
  if (brut === null && deciderModeHl(IS_VERCEL, daemonSupporteHl()) === "navigateur") {
    if (coinActif === coin) passerEnNavigateur(coin);
    return;
  }
  const reponse = brut === null ? null : mapperReponseHl(brut);
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
  const coin = actif ? basePerp(marketStore.getState().symbol, marketStore.getState().exchange) : null;

  if (!actif) arreterNavigateur();
  else if (modeNavigateur) {
    scannerNav?.definirCoin(coin); // un instantané couvre tous les coins : aucun scan relancé
    return;
  } else if (IS_VERCEL) {
    passerEnNavigateur(coin);
    return;
  }
  if (!actif || coin === null) {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    annulerRelance();
    coinActif = null;
    drapeauHeatPose = false; // la prochaine activation re-posera le drapeau si besoin
    hlLiqStore.setState(VIDE);
    return;
  }
  if (coinActif !== coin) {
    coinActif = coin;
    annulerRelance(); // la relance « en construction » visait l'ancien coin
    // État « chargement » plutôt que VIDE (« vide » = aucun niveau, un mensonge pendant
    // le fetch — à froid le daemon attend jusqu'à 15 s avant de répondre « en
    // construction ») ; on purge quand même les niveaux de l'ancien coin pour ne pas
    // les afficher sous le nouveau symbole.
    hlLiqStore.setState({ ...VIDE, etat: "chargement" });
    void rafraichir(coin);
    if (refreshTimer === null) {
      refreshTimer = setInterval(() => {
        if (coinActif !== null) void rafraichir(coinActif);
      }, REFRESH_MS);
    }
  }
}

// ─────────────────────────── Mode navigateur (chunk paresseux) ───────────────────────────

/**
 * La couche active est servie par le scanner navigateur : jusqu'au prochain OFF sur Vercel ;
 * en local, jusqu'au retour du daemon (`sondeRetourTimer`) ou au prochain OFF.
 */
let modeNavigateur = false;
let scannerNav: import("./hyperliquidLiqNavigateur").ScannerNavigateurHl | null = null;
let chargementNav = false;
let sondeRetourTimer: ReturnType<typeof setInterval> | null = null;

/** Repli LOCAL : le daemon annonce-t-il de nouveau `hl` ? Si oui, la couche lui revient. */
async function sonderRetourDaemon(): Promise<void> {
  if (!modeNavigateur || !(await detectDaemon("hl")) || !modeNavigateur) return; // OFF pendant la sonde
  arreterNavigateur();
  sync(); // voie daemon : « chargement » (source « daemon »), fetch, refresh 4 min, drapeau hl/heat
}

/** Coupe le mode daemon (minuteurs) et confie la couche au scanner navigateur. */
function passerEnNavigateur(coin: string | null): void {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  annulerRelance();
  coinActif = null;
  modeNavigateur = true;
  if (!IS_VERCEL && sondeRetourTimer === null) {
    sondeRetourTimer = setInterval(() => void sonderRetourDaemon(), SONDE_RETOUR_DAEMON_MS);
  }
  hlLiqStore.setState({ ...VIDE, etat: "chargement", source: "navigateur" });
  if (scannerNav !== null) {
    scannerNav.demarrer(coin);
    return;
  }
  if (chargementNav) return;
  chargementNav = true;
  import("./hyperliquidLiqNavigateur").then(
    (m) => {
      chargementNav = false;
      scannerNav = m.scannerNavigateurHl((p) => {
        if (modeNavigateur) hlLiqStore.setState({ ...p, source: "navigateur" });
      });
      if (modeNavigateur) scannerNav.demarrer(basePerp(marketStore.getState().symbol, marketStore.getState().exchange));
    },
    () => {
      chargementNav = false; // chunk introuvable (déploiement remplacé) : erreur, pas d'attente sans fin
      if (modeNavigateur) hlLiqStore.setState({ ...VIDE, etat: "erreur", source: "navigateur" });
    },
  );
}

function arreterNavigateur(): void {
  modeNavigateur = false;
  if (sondeRetourTimer !== null) {
    clearInterval(sondeRetourTimer);
    sondeRetourTimer = null;
  }
  scannerNav?.arreter();
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

const LIBELLE_COMMANDE =
  "Niveaux de liquidation RÉELS Hyperliquid (top adresses) — activer / désactiver";
const APERCU_COMMANDE =
  "Superpose les prix de liquidation RÉELS des top positions Hyperliquid (daemon axiomd, sinon scan direct depuis le navigateur)";
const APERCU_VERCEL =
  "Superpose les prix de liquidation RÉELS d'un échantillon de ~1 500 adresses du leaderboard Hyperliquid, scannées depuis le navigateur (≈ 4 min, barres dès les premières adresses) ; historique réservé au daemon";
const TOAST_VERCEL =
  "LIQHL — scan direct depuis le navigateur : échantillon de ~1 500 adresses Hyperliquid, ≈ 4 min ; historique réservé au daemon";

export function presentationCommandeLiqHl(isVercel: boolean): { libelle: string; apercu: string } {
  return { libelle: LIBELLE_COMMANDE, apercu: isVercel ? APERCU_VERCEL : APERCU_COMMANDE };
}

/** Bascule la couche ; sur Vercel, l'ACTIVATION annonce le scan navigateur (durée, échantillon). */
export function executerCommandeLiqHl(
  isVercel: boolean,
  basculer: () => void,
  notifier: (message: string) => void,
  estActif: () => boolean,
): void {
  basculer();
  if (isVercel && estActif()) notifier(TOAST_VERCEL);
}

const presentationCommande = presentationCommandeLiqHl(IS_VERCEL);

export const commandes: Commande[] = [
  {
    id: "action:liqhl",
    mnemonique: "LIQHL",
    libelle: presentationCommande.libelle,
    categorie: "action",
    motsCles: ["liquidations", "reels", "hyperliquid", "hl", "liqhl", "niveaux", "leaderboard", "positions", "daemon", "navigateur"],
    apercu: presentationCommande.apercu,
    action: () =>
      executerCommandeLiqHl(
        IS_VERCEL,
        () => hlLiqStore.getState().basculer(),
        pousserToast,
        () => hlLiqStore.getState().actif,
      ),
  },
];

demarrerHyperliquidLiq();
