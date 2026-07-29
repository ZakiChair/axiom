/**
 * Store CAP — capitalisation totale reconstruite et dominances. Zustand VANILLA.
 *
 * TROIS RESPONSABILITÉS :
 *   1. BACKFILL — 365 jours d'historique reconstruits une seule fois, par somme des
 *      100 premières capitalisations recalibrée sur `/global` (cf. data/mcap.ts pour
 *      les mesures qui justifient ce choix). Séquentiel, cadencé, interruptible, avec
 *      curseur persisté : fermer l'onglet en cours de route ne perd rien.
 *   2. PROLONGEMENT — une fois l'historique bâti, DEUX appels (`/coins/markets` +
 *      `/global`) suffisent à ajouter ou corriger le point du jour. On ne re-télécharge
 *      jamais les 100 séries.
 *   3. SOURCE UNIQUE — l'historique reconstruit est semé dans `macroHistory` (`seed`),
 *      qui reste la seule série de capitalisation de l'app : le panneau Macro et
 *      l'overlay du graphe en profitent sans code supplémentaire.
 *
 * CADENCE : le seuil de 429 de CoinGecko est bas (mesuré : 429 dès le 6ᵉ appel d'une
 * rafale sans délai). L'espacement part de 2,1 s avec clé Demo / 6 s sans, puis suit un
 * AIMD — ×1,5 à chaque échec retentable (plafond 15 s), −200 ms après 10 succès
 * (plancher = la base). Le vrai plafond du tier Demo n'est pas documenté de façon
 * fiable ; l'AIMD rend la cadence robuste sans avoir à le trancher.
 *
 * ⚠️ Un 429 CoinGecko arrive au NAVIGATEUR en erreur CORS (réponse d'erreur sans
 * `Access-Control-Allow-Origin`), donc en rejet de `fetch` avec un statut illisible —
 * d'où `estRetryable`, qui couvre aussi le rejet réseau. Constaté en run réel : sans
 * cela, tout le repli était inopérant là où il sert.
 *
 * Patron d'erreur NETLIQ : non destructive (l'historique affiché survit à un échec),
 * garde de double-lancement, lecture de persistance tolérante.
 */
import { createStore } from "zustand/vanilla";
import type { CoinTile, MarketGlobal } from "../data/marketOverview";
import { resolveDemoKey } from "../data/marketOverview";
import {
  ErreurCoinGecko,
  STATUT_RESEAU,
  alignerSurGrille,
  attenteApres429,
  fetchHistoriquePiece,
  fetchMarchesEtGlobal,
  minuitUtc,
  reconstruireTotal,
  serieDifference,
  type SerieJour,
} from "../data/mcap";
import { macroHistoryStore, type McapSnapshot } from "./macroHistory";
import { mirrorOpenState, windowManagerStore } from "./windowManager";

// ─────────────────────────── Constantes ───────────────────────────

const CLE_HIST = "axiom:mcap:v1";
/** Clé du curseur de backfill (exportée : les tests vérifient sa présence/purge). */
export const CLE_BACKFILL = "axiom:mcap:backfill:v1";
const CLE_DOMINANCES = "axiom:mcap:dominances";
const CLE_PERIODE = "axiom:mcap:periode";

/** Taille du panier reconstruit : 97,8 % de couverture mesurée (cf. data/mcap.ts). */
const TAILLE_PANIER = 100;
/** Fraîcheur du point du jour avant re-collecte (hors bouton Rafraîchir). */
const TTL_MS = 10 * 60_000;
/** Nombre maximal de courbes de dominance simultanées (au-delà : illisible). */
export const PLAFOND_DOMINANCES = 6;
/** Pseudo-identifiant de la dominance agrégée des alts (aucun appel réseau). */
export const ID_ALTS = "alts";
/** Pièces toujours mises en cache : TOTAL2/TOTAL3 et BTC.D/ETH.D en dépendent. */
const IDS_BASE = ["bitcoin", "ethereum"] as const;
/** Période affichée par défaut (identifiant de `PERIODES_STANDARD`). */
const PERIODE_DEFAUT = "1a";

/** Tokens de couleur des courbes de dominance — six, comme le plafond. */
export const PALETTE_DOMINANCES = [
  "--serie-1",
  "--serie-2",
  "--serie-3",
  "--serie-4",
  "--serie-5",
  "--serie-6",
] as const;

const ESSAIS_MAX = 4;
const ESPACEMENT_AVEC_CLE_MS = 2_100;
/**
 * Sans clé, CoinGecko tolère de l'ordre de 5 à 15 appels/minute (mesuré : 429 dès le
 * 6ᵉ appel d'une rafale sans délai). 6 s ≈ 10 appels/min part sous ce plafond ; l'AIMD
 * ajuste ensuite. Une base plus vive déclenche une tempête de 429 dès le début.
 */
const ESPACEMENT_SANS_CLE_MS = 6_000;
const ESPACEMENT_PLAFOND_MS = 15_000;
const FACTEUR_429 = 1.5;
const DECREMENT_MS = 200;
const SUCCES_AVANT_DECREMENT = 10;
/** Périodicité d'écriture du curseur (borne les écritures localStorage). */
const PAS_CURSEUR = 5;

// ─────────────────────────── Types ───────────────────────────

/** Historique reconstruit, persisté tel quel. */
export interface HistoriqueMcap {
  version: 1;
  /** ms epoch de la dernière collecte réussie. */
  majTs: number;
  /** Facteur de recalibrage appliqué au TOTAL. */
  k: number;
  /** false = TOTAL non recalibré (somme brute du panier). */
  recalibre: boolean;
  /** Minuits UTC (ms), croissants. */
  grille: number[];
  /** TOTAL en USD, aligné sur `grille`, APRÈS recalibrage. */
  total: number[];
  /** Capitalisations BRUTES par pièce (jamais recalibrées), alignées sur `grille`. */
  pieces: Record<string, number[]>;
}

/** Progression du backfill (affichée par la fenêtre). */
export interface EtatBackfill {
  enCours: boolean;
  faites: number;
  total: number;
  erreur: string | null;
}

/** Dépendances injectables — les tests s'en servent pour éviter réseau et attentes. */
export interface DepsBackfill {
  fetchPiece?: (id: string, signal?: AbortSignal) => Promise<SerieJour>;
  fetchMarchesEtGlobal?: (
    signal?: AbortSignal
  ) => Promise<{ marches: CoinTile[]; global: MarketGlobal }>;
  /** Espacement de base entre appels. **0 ⇒ aucune attente** (mode test). */
  espacementMs?: number;
  maintenant?: () => number;
}

/** Curseur de reprise : ce qu'il faut pour repartir sans re-télécharger le début. */
interface Curseur {
  version: 1;
  grille: number[];
  somme: number[];
  restants: string[];
  pieces: Record<string, number[]>;
}

// ─────────────────────────── Persistance tolérante ───────────────────────────

function lireBrut(cle: string): unknown {
  try {
    const raw = localStorage.getItem(cle);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null; // localStorage indisponible ou JSON corrompu
  }
}

function ecrireBrut(cle: string, valeur: unknown): void {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    /* best-effort : la persistance n'est pas bloquante */
  }
}

function effacer(cle: string): void {
  try {
    localStorage.removeItem(cle);
  } catch {
    /* idem */
  }
}

/** Historique persisté, ou `null` si absent, corrompu, de version inconnue ou incohérent. */
export function lireHistoriquePersiste(): HistoriqueMcap | null {
  const brut = lireBrut(CLE_HIST) as Partial<HistoriqueMcap> | null;
  if (!brut || brut.version !== 1) return null;
  if (!Array.isArray(brut.grille) || !Array.isArray(brut.total)) return null;
  if (brut.grille.length !== brut.total.length || brut.grille.length === 0) return null;
  return {
    version: 1,
    majTs: typeof brut.majTs === "number" ? brut.majTs : 0,
    k: typeof brut.k === "number" ? brut.k : 1,
    recalibre: brut.recalibre === true,
    grille: brut.grille,
    total: brut.total,
    pieces: typeof brut.pieces === "object" && brut.pieces !== null ? brut.pieces : {},
  };
}

function lireCurseur(): Curseur | null {
  const brut = lireBrut(CLE_BACKFILL) as Partial<Curseur> | null;
  if (!brut || brut.version !== 1) return null;
  if (!Array.isArray(brut.grille) || !Array.isArray(brut.somme) || !Array.isArray(brut.restants)) {
    return null;
  }
  if (brut.grille.length !== brut.somme.length) return null;
  return {
    version: 1,
    grille: brut.grille,
    somme: brut.somme,
    restants: brut.restants,
    pieces: typeof brut.pieces === "object" && brut.pieces !== null ? brut.pieces : {},
  };
}

/** Liste de chaînes persistée (sélection de dominances), repli sur `defaut`. */
function lireListe(cle: string, defaut: string[]): string[] {
  const brut = lireBrut(cle);
  if (!Array.isArray(brut)) return defaut;
  const propre = brut.filter((x): x is string => typeof x === "string");
  return propre.length > 0 ? propre.slice(0, PLAFOND_DOMINANCES) : defaut;
}

function lirePeriode(): string {
  const brut = lireBrut(CLE_PERIODE);
  return typeof brut === "string" && brut.length > 0 ? brut : PERIODE_DEFAUT;
}

// ─────────────────────────── Aides ───────────────────────────

/** Espacement de base : une clé Demo relève les quotas, donc autorise une cadence plus vive. */
function espacementParDefaut(): number {
  return resolveDemoKey() ? ESPACEMENT_AVEC_CLE_MS : ESPACEMENT_SANS_CLE_MS;
}

function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Convertit l'historique reconstruit en échantillons `macroHistory`
 * (TOTAL2 = TOTAL − BTC, TOTAL3 = TOTAL − BTC − ETH) et les sème.
 */
function semerMacroHistory(hist: HistoriqueMcap): void {
  const btc = hist.pieces["bitcoin"] ?? [];
  const eth = hist.pieces["ethereum"] ?? [];
  const total2 = serieDifference(hist.total, btc);
  const total3 = serieDifference(hist.total, btc, eth);
  const points: McapSnapshot[] = hist.grille.map((t, i) => ({
    t,
    total: hist.total[i] ?? 0,
    total2: total2[i] ?? 0,
    total3: total3[i] ?? 0,
  }));
  macroHistoryStore.getState().seed(points);
}

/**
 * Un échec vaut-il une nouvelle tentative ? Le 429 explicite (curl, daemon) ET le rejet
 * réseau (`STATUT_RESEAU`) — car un 429 CoinGecko arrive au navigateur en erreur CORS,
 * statut illisible (cf. data/mcap.ts). Ne pas inclure `STATUT_RESEAU` rendrait tout le
 * repli inopérant là où il sert : dans le navigateur.
 */
function estRetryable(e: unknown): boolean {
  return (
    e instanceof ErreurCoinGecko && (e.status === 429 || e.status === STATUT_RESEAU)
  );
}

/** Drapeau d'interruption du backfill — hors state : lu dans la boucle asynchrone. */
let annulationDemandee = false;

// ─────────────────────────── Store ───────────────────────────

export interface McapState {
  open: boolean;
  /** Identifiant de période affichée (`PERIODES_STANDARD`), ou null si zoom manuel. */
  periode: string;
  /** Dominances affichées : ids CoinGecko et/ou `ID_ALTS`, dans l'ordre d'ajout. */
  dominances: string[];
  hist: HistoriqueMcap | null;
  /** Catalogue courant (top 250) — alimente le sélecteur et le prolongement. */
  marches: CoinTile[];
  backfill: EtatBackfill;
  erreur: string | null;
  majTs: number | null;

  ouvrir: () => void;
  fermer: () => void;
  toggle: () => void;
  setPeriode: (id: string) => void;
  demarrerBackfill: (deps?: DepsBackfill) => Promise<void>;
  interrompre: () => void;
  prolonger: (force?: boolean, deps?: DepsBackfill) => Promise<void>;
  ajouterDominance: (id: string, deps?: DepsBackfill) => Promise<void>;
  retirerDominance: (id: string) => void;
}

/** Historique relu UNE fois au chargement du module (et non deux, cf. `majTs`). */
const HIST_INITIAL = lireHistoriquePersiste();

export const mcapStore = createStore<McapState>((set, get) => ({
  open: false,
  periode: lirePeriode(),
  dominances: lireListe(CLE_DOMINANCES, [...IDS_BASE]),
  hist: HIST_INITIAL,
  marches: [],
  backfill: { enCours: false, faites: 0, total: 0, erreur: null },
  erreur: null,
  majTs: HIST_INITIAL?.majTs ?? null,

  ouvrir: () => windowManagerStore.getState().openWindow("mcap"),
  fermer: () => windowManagerStore.getState().closeWindow("mcap"),
  toggle: () => windowManagerStore.getState().toggleWindow("mcap"),

  setPeriode: (id) => {
    ecrireBrut(CLE_PERIODE, id);
    set({ periode: id });
  },

  interrompre: () => {
    annulationDemandee = true;
  },

  demarrerBackfill: async (deps) => {
    if (get().backfill.enCours) return; // garde de double-lancement

    const fetchPiece = deps?.fetchPiece ?? fetchHistoriquePiece;
    const fetchMg = deps?.fetchMarchesEtGlobal ?? fetchMarchesEtGlobal;
    const now = deps?.maintenant ?? Date.now;
    const espacementBase = deps?.espacementMs ?? espacementParDefaut();
    const pause = async (ms: number): Promise<void> => {
      if (espacementBase === 0 || ms <= 0) return; // mode test : aucune attente
      await new Promise((r) => setTimeout(r, ms));
    };

    annulationDemandee = false;
    set({ backfill: { enCours: true, faites: 0, total: 0, erreur: null } });

    try {
      // Le catalogue est indispensable : un seul 429 ici (invisible côté navigateur,
      // cf. estRetryable) tuerait le backfill avant même son premier appel.
      let amorce: { marches: CoinTile[]; global: MarketGlobal } | null = null;
      for (let essai = 1; essai <= ESSAIS_MAX; essai += 1) {
        try {
          amorce = await fetchMg();
          break;
        } catch (e) {
          if (!estRetryable(e) || essai === ESSAIS_MAX) throw e;
          await pause(attenteApres429(essai, (e as ErreurCoinGecko).retryAfter));
        }
      }
      if (amorce === null) throw new Error("Catalogue CoinGecko indisponible");
      const { marches, global } = amorce;
      set({ marches });

      const ids = marches.slice(0, TAILLE_PANIER).map((m) => m.id);
      const aSuivre = new Set<string>([
        ...IDS_BASE,
        ...get().dominances.filter((d) => d !== ID_ALTS),
      ]);

      // Reprise seulement si le curseur parle du MÊME panier (le top 100 bouge).
      const curseur = lireCurseur();
      const reprend = curseur !== null && curseur.restants.every((id) => ids.includes(id));

      let grille: number[] | null = reprend ? curseur.grille : null;
      let somme: number[] | null = reprend ? curseur.somme : null;
      const pieces: Record<string, number[]> = reprend ? { ...curseur.pieces } : {};
      let restants = reprend ? [...curseur.restants] : [...ids];
      let faites = ids.length - restants.length;
      let espacement = espacementBase;
      let succes = 0;

      set({ backfill: { enCours: true, faites, total: ids.length, erreur: null } });

      while (restants.length > 0) {
        if (annulationDemandee) break;
        const id = restants[0] as string;

        let serie: SerieJour | null = null;
        for (let essai = 1; essai <= ESSAIS_MAX; essai += 1) {
          try {
            serie = await fetchPiece(id);
            break;
          } catch (e) {
            if (!estRetryable(e) || essai === ESSAIS_MAX) throw e;
            espacement = Math.min(espacement * FACTEUR_429, ESPACEMENT_PLAFOND_MS);
            succes = 0;
            await pause(attenteApres429(essai, (e as ErreurCoinGecko).retryAfter));
          }
        }
        if (serie === null) throw new Error(`Historique ${id} indisponible`);

        // La PREMIÈRE pièce du panier (BTC, historique complet) fixe la grille commune.
        if (grille === null || somme === null) {
          grille = serie.map((p) => p.t);
          somme = new Array<number>(grille.length).fill(0);
        }
        const alignee = alignerSurGrille(serie, grille);
        somme = somme.map((v, i) => v + (alignee[i] ?? 0));
        if (aSuivre.has(id)) pieces[id] = alignee;

        restants = restants.slice(1);
        faites += 1;
        set({ backfill: { enCours: true, faites, total: ids.length, erreur: null } });

        succes += 1;
        if (succes >= SUCCES_AVANT_DECREMENT) {
          espacement = Math.max(espacement - DECREMENT_MS, espacementBase);
          succes = 0;
        }
        if (faites % PAS_CURSEUR === 0 && restants.length > 0) {
          ecrireCurseurSi(grille, somme, restants, pieces);
        }
        if (restants.length > 0) await pause(espacement);
      }

      if (restants.length > 0) {
        // Interrompu : on garde le curseur, l'historique existant reste affiché.
        ecrireCurseurSi(grille, somme, restants, pieces);
        set({ backfill: { enCours: false, faites, total: ids.length, erreur: null } });
        return;
      }

      const { total, k, recalibre } = reconstruireTotal([somme ?? []], global.totalMcapUsd);
      const hist: HistoriqueMcap = {
        version: 1,
        majTs: now(),
        k,
        recalibre,
        grille: grille ?? [],
        total,
        pieces,
      };
      ecrireBrut(CLE_HIST, hist);
      effacer(CLE_BACKFILL);
      set({
        hist,
        majTs: hist.majTs,
        erreur: null,
        backfill: { enCours: false, faites, total: ids.length, erreur: null },
      });
      semerMacroHistory(hist);
    } catch (e) {
      // Erreur NON destructive : l'historique déjà affiché n'est pas touché.
      set((s) => ({
        backfill: { ...s.backfill, enCours: false, erreur: messageErreur(e) },
      }));
    }
  },

  prolonger: async (force = false, deps) => {
    const now = deps?.maintenant ?? Date.now;
    const maj = get().majTs;
    if (!force && maj !== null && now() - maj < TTL_MS) return;

    const fetchMg = deps?.fetchMarchesEtGlobal ?? fetchMarchesEtGlobal;
    try {
      const { marches, global } = await fetchMg();
      set({ marches });

      const hist = get().hist;
      if (hist === null) {
        set({ majTs: now(), erreur: null });
        return;
      }

      const jour = minuitUtc(now());
      const dernier = hist.grille[hist.grille.length - 1];
      const mcapParId = new Map(marches.map((m) => [m.id, m.mcapUsd]));

      const grille = [...hist.grille];
      const total = [...hist.total];
      const pieces: Record<string, number[]> = {};
      for (const [id, serie] of Object.entries(hist.pieces)) pieces[id] = [...serie];

      if (dernier !== undefined && jour === dernier) {
        total[total.length - 1] = global.totalMcapUsd;
        for (const [id, serie] of Object.entries(pieces)) {
          const courant = mcapParId.get(id);
          if (courant !== undefined) serie[serie.length - 1] = courant;
        }
      } else if (dernier === undefined || jour > dernier) {
        grille.push(jour);
        total.push(global.totalMcapUsd);
        for (const [id, serie] of Object.entries(pieces)) {
          serie.push(mcapParId.get(id) ?? serie[serie.length - 1] ?? 0);
        }
      }

      const suivant: HistoriqueMcap = { ...hist, grille, total, pieces, majTs: now() };
      ecrireBrut(CLE_HIST, suivant);
      set({ hist: suivant, majTs: suivant.majTs, erreur: null });
      semerMacroHistory(suivant);
    } catch (e) {
      set({ erreur: messageErreur(e) }); // non destructif
    }
  },

  ajouterDominance: async (id, deps) => {
    const { dominances, hist } = get();
    if (dominances.includes(id)) return;
    if (dominances.length >= PLAFOND_DOMINANCES) {
      set({ erreur: `Six courbes au maximum — retirez-en une avant d'en ajouter.` });
      return;
    }

    if (id !== ID_ALTS && hist !== null && hist.pieces[id] === undefined) {
      const fetchPiece = deps?.fetchPiece ?? fetchHistoriquePiece;
      try {
        const serie = await fetchPiece(id);
        const suivant: HistoriqueMcap = {
          ...hist,
          pieces: { ...hist.pieces, [id]: alignerSurGrille(serie, hist.grille) },
        };
        ecrireBrut(CLE_HIST, suivant);
        set({ hist: suivant });
      } catch (e) {
        set({ erreur: messageErreur(e) });
        return;
      }
    }

    const suivantes = [...get().dominances, id];
    ecrireBrut(CLE_DOMINANCES, suivantes);
    set({ dominances: suivantes, erreur: null });
  },

  retirerDominance: (id) => {
    // Le cache de la série est CONSERVÉ : le réafficher ne doit pas re-télécharger.
    const suivantes = get().dominances.filter((d) => d !== id);
    ecrireBrut(CLE_DOMINANCES, suivantes);
    set({ dominances: suivantes });
  },
}));

/** Écrit le curseur si l'amorce a bien eu lieu (grille et somme établies). */
function ecrireCurseurSi(
  grille: number[] | null,
  somme: number[] | null,
  restants: string[],
  pieces: Record<string, number[]>
): void {
  if (grille === null || somme === null) return;
  ecrireBrut(CLE_BACKFILL, { version: 1, grille, somme, restants, pieces } satisfies Curseur);
}

mirrorOpenState("mcap", mcapStore);
