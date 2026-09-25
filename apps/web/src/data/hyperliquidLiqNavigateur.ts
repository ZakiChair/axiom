/**
 * Scanner NAVIGATEUR de la couche LIQHL — niveaux de liquidation RÉELS Hyperliquid sans le
 * daemon `axiomd` (extension du 25 septembre, décision du propriétaire « le déploiement n'est
 * toujours pas ok » : la couche doit vivre sur Vercel). Utilisé sur Vercel, et en local quand
 * le daemon n'annonce pas la capability `hl` (repli). Le mode daemon ne passe JAMAIS ici.
 *
 * MODULE PARESSEUX : chargé uniquement par `import()` depuis data/hyperliquidLiq.ts (chunk
 * d'entrée) au passage en mode navigateur — ni ce code ni shared/hyperliquidScan.ts ne pèsent
 * sur le budget initial. Il n'importe que des TYPES de hyperliquidLiq.ts (aucun cycle).
 *
 * MÊMES RÈGLES QUE LE DAEMON (shared/hyperliquidScan.ts) :
 *  - Pool (~1 500 adresses : top 500 accountValue + volume hebdomadaire), par ordre :
 *    1. mémoire puis stockage local (`axiom:hl:pool:v1`, mêmes paramètres, < 6 h —
 *       `poolEstFrais`) ; tout accès au stockage est protégé (navigation privée, quota) ;
 *    2. `GET /hlpool` même origine (fonction Vercel `api/hlpool.ts`, CDN 6 h, ≈ 65 Ko). En
 *       local (Vite, `vite preview`, daemon) ce chemin tombe sur le repli SPA : du HTML en
 *       200, rejeté par le contrôle du content-type et de la forme → échec rapide ;
 *    3. REPLI direct : le leaderboard (≈ 39 Mo, ≈ 33 s sur la liaison du poste) téléchargé et
 *       réduit dans le navigateur — légende « chargement du pool d'adresses… » ;
 *    4. amont en échec : pool stocké PÉRIMÉ (ou d'autres paramètres) plutôt que rien.
 *  - Scan : `construireInstantane` partagé, même cadence (750 poids/min : sur Vercel le
 *    navigateur est seul sur son IP ; en local sans daemon aussi), même arrêt sur 429, même
 *    rejeu/abandon. UN instantané couvre tous les coins : changer de symbole republie depuis
 *    lui, sans nouveau scan.
 *  - Premier scan : progression publiée tous les 5 lots (≈ 3 s) — les barres apparaissent
 *    dès les premières adresses, la légende dit « scan N/T adresses ». Les rescans (toutes les
 *    5 min tant que la couche est active, comptées depuis le DÉBUT du scan précédent) sont
 *    SILENCIEUX : l'instantané complet reste affiché jusqu'à son remplaçant.
 *  - Onglet caché : pause avant chaque lot (reprise au retour, sans rafale). Un rescan échu
 *    pendant l'absence attend le retour AVANT d'être horodaté (sinon instantané antidaté de
 *    toute l'absence et 2e scan enchaîné aussitôt). Une pause AU MILIEU d'un scan garde le ts
 *    de son début (datation prudente) : si le scan a duré plus de 5 min, le suivant part
 *    aussitôt — toujours à 750 poids/min, et il rafraîchit ce qui a été lu avant la pause.
 *    Couche OFF : arrêt propre (AbortController : plus aucun lot, pool en cours de
 *    téléchargement coupé). Un seul scan à la fois. Échec total : « erreur », réessai 2 min
 *    plus tard.
 *
 * LIMITES ASSUMÉES : l'historique (heatmap HL, collecteur `hlLiqHeat`) reste réservé au
 * daemon ; deux fenêtres visibles côte à côte scannent chacune (même IP → un 429 peut tronquer
 * un scan : la légende affiche alors le nombre RÉEL d'adresses). ⚠️ HONNÊTETÉ : échantillon
 * du leaderboard, jamais « toutes » les liquidations.
 */
import {
  construireInstantane,
  HORLOGE_REELLE,
  N_VALEUR_POOL,
  poolEstFrais,
  TAILLE_POOL,
  telechargerPool,
  TIMEOUT_LEADERBOARD_MS,
  validerPoolHl,
  type HorlogeScan,
  type InstantaneHL,
  type OptionsScan,
  type PoolHL,
} from "../../../../shared/hyperliquidScan";
import type { EtatHl, NiveauHl, ProgressionHl } from "./hyperliquidLiq";

/** Clé du pool dans le stockage local (hors liste de sauvegarde : recalculable). */
export const CLE_POOL_HL = "axiom:hl:pool:v1";
/** Pool réduit servi par la fonction Vercel (même origine). */
export const URL_HLPOOL = "/hlpool";
/** Délai de `/hlpool` : au-delà du maxDuration (60 s) de la fonction, pour un CDN à froid. */
export const TIMEOUT_HLPOOL_MS = 65_000;
/** Période des scans tant que la couche est active (même TTL que l'instantané du daemon). */
export const PERIODE_SCAN_MS = 5 * 60_000;
/** Réessai après un échec total (même repli que le daemon : 2 min). */
export const DELAI_REESSAI_ECHEC_MS = 2 * 60_000;

/** Ce que le scanner publie dans `hlLiqStore` (le mode d'entrée y ajoute `source`). */
export interface PublicationHlNavigateur {
  etat: EtatHl;
  niveaux: NiveauHl[];
  ts: number;
  adressesScannees: number;
  progression: ProgressionHl | null;
}

/** Étape en cours du cycle (null = aucune : instantané complet affiché, ou rien lancé). */
export type PhaseNavigateur = "pool" | "scan" | "erreur" | null;

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/** Pool du stockage local : JSON absent, corrompu ou non conforme → null. PURE. */
export function lirePoolStocke(brut: string | null): PoolHL | null {
  if (brut === null) return null;
  try {
    return validerPoolHl(JSON.parse(brut));
  } catch {
    return null;
  }
}

/**
 * Publication de la couche pour `coin`. Un instantané COMPLET prime (rescan silencieux, un
 * échec ultérieur ne l'efface pas) ; sinon l'échec total → « erreur » ; sinon, pendant le
 * scan, les niveaux PARTIELS du coin et la progression (« chargement » tant que ce coin n'a
 * aucun niveau : « aucun niveau » n'est vrai qu'à la fin) ; sinon « chargement » sans
 * progression (pool en cours). Coin inextricable → « vide » (comme en mode daemon). PURE.
 */
export function publicationNavigateur(e: {
  complet: InstantaneHL | null;
  partiel: InstantaneHL | null;
  phase: PhaseNavigateur;
  progression: ProgressionHl | null;
  coin: string | null;
}): PublicationHlNavigateur {
  if (e.coin === null) return { etat: "vide", niveaux: [], ts: 0, adressesScannees: 0, progression: null };
  if (e.complet !== null) {
    const niveaux = e.complet.parCoin.get(e.coin) ?? [];
    return {
      etat: niveaux.length > 0 ? "ok" : "vide",
      niveaux,
      ts: e.complet.ts,
      adressesScannees: e.complet.adressesScannees,
      progression: null,
    };
  }
  if (e.phase === "erreur") return { etat: "erreur", niveaux: [], ts: 0, adressesScannees: 0, progression: null };
  if (e.phase === "scan" && e.progression !== null) {
    const niveaux = e.partiel?.parCoin.get(e.coin) ?? [];
    return {
      etat: niveaux.length > 0 ? "ok" : "chargement",
      niveaux,
      ts: e.partiel?.ts ?? 0,
      adressesScannees: e.partiel?.adressesScannees ?? 0,
      progression: e.progression,
    };
  }
  return { etat: "chargement", niveaux: [], ts: 0, adressesScannees: 0, progression: null };
}

/**
 * Délai avant le prochain cycle : PERIODE_SCAN_MS après l'horodatage (début) du dernier
 * instantané complet, et au moins DELAI_REESSAI_ECHEC_MS après le dernier échec total ;
 * 0 sans l'un ni l'autre. PURE.
 */
export function delaiProchainCycle(dernierCompletTs: number | null, dernierEchecTs: number | null, now: number): number {
  let delai = 0;
  if (dernierCompletTs !== null) delai = Math.max(delai, dernierCompletTs + PERIODE_SCAN_MS - now);
  if (dernierEchecTs !== null) delai = Math.max(delai, dernierEchecTs + DELAI_REESSAI_ECHEC_MS - now);
  return delai;
}

// ─────────────────────────── Scanner (dépendances injectées) ───────────────────────────

type StockageHl = Pick<Storage, "getItem" | "setItem">;

export interface DependancesScannerHl {
  fetchImpl: typeof fetch;
  /** Stockage local ; appelé à chaque accès (peut jeter ou rendre null : protégé). */
  stockage: () => StockageHl | null;
  visibilite: { cachee(): boolean; surChangement(fn: () => void): () => void };
  /** Horloge des cycles et des délais réseau ; `now` date pools et instantanés. */
  horloge: HorlogeScan;
  publier: (p: PublicationHlNavigateur) => void;
  journal: (ligne: string) => void;
  /** Tests : cadence et pas de progression du scan. */
  optionsScan?: Pick<OptionsScan, "horloge" | "intervalleLotMs" | "lotsParProgression">;
}

export interface ScannerNavigateurHl {
  /** Active la couche pour `coin` : republie l'état courant, lance ou programme un cycle. */
  demarrer(coin: string | null): void;
  /** Change le coin publié — AUCUN nouveau scan (l'instantané couvre tous les coins). */
  definirCoin(coin: string | null): void;
  /** Couche OFF : interrompt le cycle en cours, coupe le minuteur, ne publie plus rien. */
  arreter(): void;
  /** Promesse du cycle en cours (résolue sans cycle) — tests et vérifications. */
  attendreCycle(): Promise<void>;
}

export function creerScannerNavigateurHl(deps: DependancesScannerHl): ScannerNavigateurHl {
  const { fetchImpl, horloge, visibilite } = deps;
  let actif = false;
  let coin: string | null = null;
  /** Dernier instantané COMPLET (survit à OFF/ON : un re-démarrage < 5 min le republie). */
  let complet: InstantaneHL | null = null;
  let partiel: InstantaneHL | null = null;
  let phase: PhaseNavigateur = null;
  let progression: ProgressionHl | null = null;
  let dernierEchecTs: number | null = null;
  let poolMemoire: PoolHL | null = null;
  let cycle: Promise<void> | null = null;
  let ctrlCourant: AbortController | null = null;
  let minuteur: unknown = null;

  const publierCourant = (): void => {
    if (actif) deps.publier(publicationNavigateur({ complet, partiel, phase, progression, coin }));
  };

  const lireStockage = (): PoolHL | null => {
    try {
      return lirePoolStocke(deps.stockage()?.getItem(CLE_POOL_HL) ?? null);
    } catch {
      return null;
    }
  };
  const retenir = (pool: PoolHL): PoolHL => {
    poolMemoire = pool;
    try {
      deps.stockage()?.setItem(CLE_POOL_HL, JSON.stringify(pool));
    } catch {
      // stockage plein ou bloqué : le pool reste en mémoire pour la session
    }
    return pool;
  };

  /** Exécute `tache` sous `signal` + un délai (horloge injectée) ; null sur tout échec. */
  const essayer = async <T>(signal: AbortSignal, ms: number, tache: (s: AbortSignal) => Promise<T | null>): Promise<T | null> => {
    const ctrl = new AbortController();
    const relayer = (): void => ctrl.abort();
    signal.addEventListener("abort", relayer, { once: true });
    const id = horloge.setTimeout(() => ctrl.abort(), ms);
    try {
      return await tache(ctrl.signal);
    } catch {
      return null;
    } finally {
      horloge.clearTimeout(id);
      signal.removeEventListener("abort", relayer);
    }
  };

  /** `GET /hlpool` : JSON conforme aux paramètres courants, sinon null (HTML du repli SPA…). */
  const lirePoolServi = async (signal: AbortSignal): Promise<PoolHL | null> => {
    const res = await fetchImpl(URL_HLPOOL, { headers: { accept: "application/json" }, signal });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const pool = validerPoolHl(await res.json());
    return pool !== null && pool.nValeur === N_VALEUR_POOL && pool.tailleCible === TAILLE_POOL ? pool : null;
  };

  const obtenirPool = async (signal: AbortSignal): Promise<PoolHL | null> => {
    const now = horloge.now();
    if (poolMemoire !== null && poolEstFrais(poolMemoire, now)) return poolMemoire;
    const stocke = lireStockage();
    if (stocke !== null && poolEstFrais(stocke, now)) {
      poolMemoire = stocke;
      return stocke;
    }
    const servi = await essayer(signal, TIMEOUT_HLPOOL_MS, lirePoolServi);
    if (signal.aborted) return null;
    if (servi !== null) return retenir(servi);
    const direct = await essayer(signal, TIMEOUT_LEADERBOARD_MS, async (s) => ({
      adresses: await telechargerPool(fetchImpl, { signal: s }),
      ts: now,
      nValeur: N_VALEUR_POOL,
      tailleCible: TAILLE_POOL,
    }));
    if (signal.aborted) return null;
    if (direct !== null) return retenir(direct);
    return poolMemoire ?? stocke; // amont en échec : pool PÉRIMÉ plutôt que rien
  };

  /** Pause avant un lot tant que l'onglet est caché ; libérée au retour ou à l'arrêt. */
  const attendreVisible = (signal: AbortSignal): Promise<void> => {
    if (!visibilite.cachee() || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let desabonner: () => void = () => {};
      const fin = (): void => {
        desabonner();
        signal.removeEventListener("abort", fin);
        resolve();
      };
      desabonner = visibilite.surChangement(() => {
        if (!visibilite.cachee()) fin();
      });
      signal.addEventListener("abort", fin, { once: true });
    });
  };

  const echec = (): void => {
    dernierEchecTs = horloge.now();
    phase = "erreur";
    partiel = null;
    progression = null;
    publierCourant();
  };

  const executerCycle = async (signal: AbortSignal): Promise<void> => {
    try {
      if (complet === null) {
        phase = "pool";
        partiel = null;
        progression = null;
        publierCourant();
      }
      const pool = await obtenirPool(signal);
      if (signal.aborted) return;
      if (pool === null) return echec();
      if (complet === null) {
        phase = "scan";
        progression = { faites: 0, total: pool.adresses.length };
        publierCourant();
      }
      // Onglet caché (rescan échu pendant l'absence) : on attend le RETOUR AVANT d'horodater.
      // Pris avant la pause, `debut` antidaterait l'instantané de toute l'absence, et
      // `delaiProchainCycle` (5 min après ce ts) relancerait aussitôt un 2e scan complet.
      await attendreVisible(signal);
      if (signal.aborted) return;
      const debut = horloge.now();
      const inst = await construireInstantane(pool.adresses, fetchImpl, debut, {
        ...deps.optionsScan,
        signal,
        journal: deps.journal,
        avantLot: () => attendreVisible(signal),
        onProgression: (p, faites, total) => {
          if (signal.aborted || complet !== null) return; // rescan : silencieux
          partiel = p;
          progression = { faites, total };
          publierCourant();
        },
      });
      if (signal.aborted) return;
      if (inst.adressesScannees === 0) return echec();
      complet = inst;
      dernierEchecTs = null;
      phase = null;
      partiel = null;
      progression = null;
      publierCourant();
    } catch {
      if (!signal.aborted) echec();
    }
  };

  const annulerMinuteur = (): void => {
    if (minuteur !== null) {
      horloge.clearTimeout(minuteur);
      minuteur = null;
    }
  };

  /** Lance un cycle si la couche est active et qu'aucun n'est en cours (un seul à la fois). */
  const lancerCycle = (): void => {
    if (!actif || cycle !== null) return;
    annulerMinuteur();
    const ctrl = new AbortController();
    ctrlCourant = ctrl;
    const p: Promise<void> = executerCycle(ctrl.signal).finally(() => {
      if (cycle === p) cycle = null;
      if (ctrlCourant === ctrl) ctrlCourant = null;
      programmer(); // prochain scan (ou relance immédiate après un OFF/ON pendant ce cycle)
    });
    cycle = p;
  };

  function programmer(): void {
    if (!actif || cycle !== null) return;
    annulerMinuteur();
    const delai = delaiProchainCycle(complet?.ts ?? null, dernierEchecTs, horloge.now());
    if (delai <= 0) {
      lancerCycle();
      return;
    }
    minuteur = horloge.setTimeout(() => {
      minuteur = null;
      lancerCycle();
    }, delai);
  }

  return {
    demarrer(c) {
      coin = c;
      if (actif) {
        publierCourant();
        return;
      }
      actif = true;
      publierCourant();
      programmer();
    },
    definirCoin(c) {
      coin = c;
      publierCourant();
    },
    arreter() {
      actif = false;
      ctrlCourant?.abort();
      annulerMinuteur();
      partiel = null;
      progression = null;
      if (phase !== "erreur") phase = null;
    },
    attendreCycle: () => cycle ?? Promise.resolve(),
  };
}

// ─────────────────────────── Singleton de l'application ───────────────────────────

/** Stockage local du navigateur ; son simple accès peut jeter (navigation privée, sandbox). */
function stockageLocal(): StockageHl | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const VISIBILITE_DOCUMENT: DependancesScannerHl["visibilite"] = {
  cachee: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  surChangement: (fn) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  },
};

let singleton: ScannerNavigateurHl | null = null;

/**
 * Scanner unique de la page (le premier `publier` fourni est retenu : data/hyperliquidLiq.ts
 * est le seul appelant). `fetch` est enveloppé : appelé comme méthode d'un objet de
 * dépendances, le fetch natif jetterait « Illegal invocation ».
 */
export function scannerNavigateurHl(publier: (p: PublicationHlNavigateur) => void): ScannerNavigateurHl {
  singleton ??= creerScannerNavigateurHl({
    fetchImpl: ((entree: RequestInfo | URL, init?: RequestInit) => fetch(entree, init)) as typeof fetch,
    stockage: stockageLocal,
    visibilite: VISIBILITE_DOCUMENT,
    horloge: HORLOGE_REELLE,
    publier,
    journal: (ligne) => console.info(`[AXIOM] LIQHL navigateur — ${ligne}`),
  });
  return singleton;
}
