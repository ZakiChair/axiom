/**
 * Store de la liquidité nette de la Fed (NETLIQ) — Zustand VANILLA.
 *
 * Un run (spec v1.4, branche feat/netliq) : fetch des trois séries FRED sur 2 ans
 * (`fetchSeriesNetliq`, data/netliq.ts) → calcul PUR de la série de liquidité nette
 * (`serieNetliq`) → stats de synthèse (`statsNetliq`). Pas de polling : un run à
 * l'ouverture de la fenêtre + bouton Rafraîchir. Patron EXACT du store CBPREM :
 *
 *   - Erreur NON destructive : la série existante reste affichée pendant un retry,
 *     `erreur` n'est effacée qu'au succès (pas de clignotement).
 *   - Garde 200-vide : un fetch réussi mais à série vide n'écrase PAS une série valide
 *     déjà affichée — série/stats/majTs conservés, `erreur` posée.
 *   - Garde de péremption `currentRunId` (double clic / relance) : les résultats d'un
 *     run périmé sont ignorés.
 *
 * Différence avec CBPREM : cache TTL 12 h en mémoire. `run()` ne re-fetch pas si la
 * dernière collecte réussie date de moins de 12 h ET qu'une série est déjà affichée,
 * SAUF appel `run(true)` (bouton Rafraîchir force ; l'ouverture de fenêtre passe false).
 * Le `majTs` n'étant posé qu'au succès, un premier run vide ou en échec ne fige jamais
 * le cache 12 h — il se ré-tente à la prochaine ouverture (terme `serie.length > 0`).
 */
import { createStore } from "zustand/vanilla";
import {
  fetchSeriesNetliq,
  serieNetliq,
  statsNetliq,
  type FenetreNetliq,
  type PointNetliq,
} from "../data/netliq";

/** TTL du cache en mémoire : 12 heures en millisecondes. */
const TTL_MS = 12 * 60 * 60 * 1000;

/** Fenêtre par défaut (comportement v1.4/v1.5 préservé au premier lancement). */
const FENETRE_DEFAUT: FenetreNetliq = 2;
/** Clé de persistance de la fenêtre choisie. */
const CLE_FENETRE = "axiom:netliq:fenetre";
/** Valeurs de fenêtre acceptées (garde de lecture tolérante). */
const FENETRES_VALIDES: readonly FenetreNetliq[] = [1, 2, 5, 10];

/** Lecture TOLÉRANTE de la fenêtre persistée : toute valeur absente/invalide → défaut 2 a. */
function lireFenetre(): FenetreNetliq {
  try {
    if (typeof localStorage === "undefined") return FENETRE_DEFAUT;
    const n = Number(localStorage.getItem(CLE_FENETRE));
    return (FENETRES_VALIDES as readonly number[]).includes(n) ? (n as FenetreNetliq) : FENETRE_DEFAUT;
  } catch {
    return FENETRE_DEFAUT;
  }
}

/** Écriture best-effort de la fenêtre (quota / localStorage indisponible → silencieux). */
function ecrireFenetre(annees: FenetreNetliq): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CLE_FENETRE, String(annees));
  } catch {
    /* silencieux : localStorage indisponible / readonly. */
  }
}

export interface NetliqState {
  /** true pendant un run (désactive le bouton Rafraîchir). */
  enCours: boolean;
  serie: PointNetliq[];
  stats: ReturnType<typeof statsNetliq> | null;
  /** Message d'erreur affichable si un fetch échoue, sinon null — NON destructif. */
  erreur: string | null;
  /** Horodatage du dernier succès (fraîcheur affichée + base du TTL), sinon null. */
  majTs: number | null;
  /** Fenêtre d'observation courante (années), persistée. */
  fenetreAnnees: FenetreNetliq;
  /** Collecte + calcul. `force` (bouton Rafraîchir) court-circuite le TTL 12 h. */
  run: (force?: boolean) => Promise<void>;
  /**
   * Change la fenêtre : persiste, INVALIDE le cache (serie/stats/majTs remis à zéro pour
   * que le skip TTL ne serve JAMAIS une série d'une autre fenêtre — ex. 2 a quand on
   * demande 10 a), puis relance un run forcé. No-op si la fenêtre est inchangée.
   */
  setFenetre: (annees: FenetreNetliq) => void;
}

/** Identifiant du run courant : les résultats d'un run périmé (double clic / relance) sont ignorés. */
let currentRunId = 0;

export const netliqStore = createStore<NetliqState>((set, get) => ({
  enCours: false,
  serie: [],
  stats: null,
  erreur: null,
  majTs: null,
  fenetreAnnees: lireFenetre(),

  setFenetre: (annees) => {
    if (get().fenetreAnnees === annees) return; // fenêtre inchangée → rien à faire
    ecrireFenetre(annees);
    // Invalidation au changement de fenêtre : serie/stats/majTs remis à zéro AVANT le run
    // forcé — sans quoi le skip TTL pourrait servir la série de l'ancienne fenêtre.
    set({ fenetreAnnees: annees, serie: [], stats: null, majTs: null });
    void get().run(true);
  },

  run: async (force = false) => {
    const nowMs = Date.now();

    // Cache TTL 12 h : pas de re-fetch si une série est déjà affichée et fraîche (< 12 h),
    // sauf force. `serie.length > 0` évite de figer un premier run vide/échoué (majTs posé
    // au seul succès) — on retourne AVANT de bumper currentRunId ou de toucher enCours.
    const { majTs, serie: serieCourante } = get();
    if (!force && majTs !== null && serieCourante.length > 0 && nowMs - majTs < TTL_MS) return;

    const runId = ++currentRunId;
    // On ne remet PAS `erreur` à null ici : le bandeau reste visible pendant le retry et
    // n'est effacé qu'au succès (ci-dessous) — série préservée, pas de clignotement.
    set({ enCours: true });

    let series: Awaited<ReturnType<typeof fetchSeriesNetliq>>;
    try {
      series = await fetchSeriesNetliq(nowMs, get().fenetreAnnees);
    } catch {
      if (runId !== currentRunId) return;
      set({
        enCours: false,
        erreur: "Séries FRED indisponibles — dernière liquidité nette conservée.",
      });
      return;
    }
    if (runId !== currentRunId) return;

    const serie = serieNetliq(series.walcl, series.tga, series.rrp);
    const stats = statsNetliq(serie);

    if (serie.length === 0 && get().serie.length > 0) {
      // Garde 200-vide : un fetch réussi à série vide n'écrase PAS une série valide déjà
      // affichée (violerait l'invariant erreur non destructive) — on conserve l'existant.
      set({ enCours: false, erreur: "Réponse FRED vide — courbe précédente conservée." });
      return;
    }

    // Succès : série/stats mises à jour, `erreur` effacée, fraîcheur horodatée (base du TTL).
    set({ enCours: false, serie, stats, erreur: null, majTs: Date.now() });
  },
}));
