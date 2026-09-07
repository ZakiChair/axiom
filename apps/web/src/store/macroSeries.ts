/**
 * Store des séries macroéconomiques — Zustand VANILLA (hors render-loop React).
 *
 * C'est la donnée la PLUS LENTE du terminal : publications mensuelles ou trimestrielles,
 * dont le calendrier ECO annonce déjà la date. D'où, volontairement : aucun `setInterval`,
 * aucun polling, un cache localStorage de 24 h, et un rafraîchissement manuel.
 *
 * SÉQUENCEMENT : l'OCDE renvoie un 429 entre 10 et 12 requêtes rapprochées, et son
 * `retry-after: 0` est mensonger. Les appels OCDE sont donc lancés UN PAR UN, espacés
 * d'au moins 2 s. `attendre` est injectable pour que les tests n'attendent pas vraiment.
 *
 * DÉGRADATION : chaque série a son propre statut. Une source en panne n'empêche jamais
 * les autres courbes d'être tracées, et son motif reste affiché (jamais un tiret muet).
 */
import { createStore } from "zustand/vanilla";
import type { MacroSeries } from "../data/macro/types";
import {
  type DefinitionSerieMacro,
  type IndicateurMacro,
  seriesDeIndicateur,
} from "../data/macro/catalogueMacro";
import { chargerSerieMacro, cleSante } from "../data/macro/chargerSerieMacro";
import { healthStore } from "./health";

/** Profondeur d'historique récupérée — au-delà, la courbe devient illisible. */
export const FENETRE_MACRO_MS = 6 * 365 * 24 * 60 * 60 * 1000; // ~6 ans
/** Durée de validité du cache local. */
export const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
/** Espacement minimal entre deux appels OCDE (quota ~10-12 requêtes rapprochées). */
export const ESPACEMENT_OCDE_MS = 2_000;

const PREFIXE_CACHE = "axiom.macro.serie.";

export type StatutSerie = "idle" | "loading" | "ok" | "quota" | "sansCle" | "panne";

export interface EtatSerie {
  statut: StatutSerie;
  points: MacroSeries;
  /** ms epoch du dernier point (fin de période) — alimente la primitive `Fraicheur`. */
  majTs: number | null;
  /** Motif d'indisponibilité, affiché tel quel. `null` quand tout va bien. */
  message: string | null;
}

interface EntreeCache {
  ts: number;
  points: MacroSeries;
}

export interface OptionsDemande {
  /** Ignore le cache. */
  force?: boolean;
  /** Attente injectable (tests). Défaut : `setTimeout`. */
  attendre?: (ms: number) => Promise<void>;
}

export interface MacroSeriesState {
  series: Record<string, EtatSerie>;
  demanderIndicateur: (indicateur: IndicateurMacro, opts?: OptionsDemande) => Promise<void>;
}

function etatVide(): EtatSerie {
  return { statut: "idle", points: [], majTs: null, message: null };
}

/** Lit le cache d'une série ; `null` si absent, illisible ou expiré. */
function lireCache(id: string, now: number): MacroSeries | null {
  try {
    const brut = localStorage.getItem(PREFIXE_CACHE + id);
    if (brut === null) return null;
    const entree = JSON.parse(brut) as EntreeCache;
    if (typeof entree.ts !== "number" || !Array.isArray(entree.points)) return null;
    if (now - entree.ts > TTL_CACHE_MS) return null;
    return entree.points;
  } catch {
    return null; // quota localStorage, JSON corrompu, mode privé…
  }
}

function ecrireCache(id: string, points: MacroSeries, now: number): void {
  try {
    localStorage.setItem(PREFIXE_CACHE + id, JSON.stringify({ ts: now, points } satisfies EntreeCache));
  } catch {
    // Quota atteint : le cache est un confort, jamais une condition de fonctionnement.
  }
}

const attendreParDefaut = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const macroSeriesStore = createStore<MacroSeriesState>((set, get) => ({
  series: {},

  demanderIndicateur: async (indicateur, opts) => {
    const attendre = opts?.attendre ?? attendreParDefaut;
    const force = opts?.force ?? false;
    const now = Date.now();
    const depuis = now - FENETRE_MACRO_MS;
    const definitions = seriesDeIndicateur(indicateur);

    const majSerie = (id: string, patch: Partial<EtatSerie>): void => {
      set((s) => ({
        series: { ...s.series, [id]: { ...(s.series[id] ?? etatVide()), ...patch } },
      }));
    };

    // 1) Cache d'abord : ce qui est frais n'est pas redemandé.
    const aCharger: DefinitionSerieMacro[] = [];
    for (const def of definitions) {
      const cache = force ? null : lireCache(def.id, now);
      if (cache !== null && cache.length > 0) {
        const dernier = cache[cache.length - 1];
        majSerie(def.id, {
          statut: "ok",
          points: cache,
          majTs: dernier?.time ?? null,
          message: null,
        });
      } else {
        majSerie(def.id, { statut: "loading", message: null });
        aCharger.push(def);
      }
    }

    // 2) Les transports sans quota d'abord, en parallèle ; l'OCDE ensuite, un par un.
    const rapides = aCharger.filter((d) => d.source.transport !== "oecd");
    const lents = aCharger.filter((d) => d.source.transport === "oecd");

    const appliquer = (def: DefinitionSerieMacro, r: Awaited<ReturnType<typeof chargerSerieMacro>>): void => {
      const source = cleSante(def);
      if (r.statut === "ok") {
        const dernier = r.points[r.points.length - 1];
        majSerie(def.id, { statut: "ok", points: r.points, majTs: dernier?.time ?? null, message: null });
        ecrireCache(def.id, r.points, now);
        healthStore.getState().marquerMessage(source);
      } else {
        majSerie(def.id, { statut: r.statut, points: [], majTs: null, message: r.message });
        if (r.statut === "quota") {
          healthStore.getState().setEtat(source, "polling", { derniereErreur: r.message });
        } else {
          healthStore.getState().marquerErreur(source, r.message);
        }
      }
    };

    await Promise.all(
      rapides.map((def) => chargerSerieMacro(def, depuis).then((r) => appliquer(def, r))),
    );

    for (let i = 0; i < lents.length; i++) {
      if (i > 0) await attendre(ESPACEMENT_OCDE_MS);
      const def = lents[i];
      if (def === undefined) continue;
      appliquer(def, await chargerSerieMacro(def, depuis));
    }
  },
}));
