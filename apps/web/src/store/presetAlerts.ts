/**
 * Store des ALERTES DE PRESET screener (EQS) — Zustand VANILLA (hors render-loop React).
 *
 * Une « alerte de preset » relance périodiquement un scan (snapshot des filtres pris à la
 * création) et NOTIFIE quand un symbole ENTRE dans l'ensemble des résultats (diff
 * d'ensembles). Ce store ne détient QUE l'état déclaratif (liste + persistance) ; le
 * runtime périodique (timers, diff, cooldown, notification) vit dans `alerts/runtime.ts`.
 *
 * PERSISTANCE : localStorage INTERNE au store (clé `axiom:presetAlerts:v1`), lecture et
 * écriture TOLÉRANTES (absence de DOM / JSON corrompu / quota) — même patron que les
 * presets utilisateur du screener (`store/screener.ts`).
 *
 * Fonctions PURES exportées (`diffEntrants`, `filtrerCooldown`) : consommées par le
 * runtime, testées unitairement ici (le run réseau, lui, n'est pas testé — convention repo).
 */
import { createStore } from "zustand/vanilla";
import type { Timeframe } from "@axiom/types";
import type { BaseCondition, IndicatorCondition } from "../data/screener";

/** Clé localStorage des alertes de preset. */
const STORAGE_KEY = "axiom:presetAlerts:v1";
/** Nombre max d'alertes ACTIVES simultanées (chaque active fait tourner un scan périodique). */
export const MAX_ALERTES_ACTIVES = 4;

/**
 * Une alerte de preset persistée. Le snapshot des filtres (`baseConditions`,
 * `indicatorConditions`, `tf`) est FIGÉ à la création : éditer le builder ensuite
 * n'altère pas les alertes existantes.
 */
export interface AlertePreset {
  /** Identifiant interne de l'alerte (généré). */
  id: string;
  /** Id du preset source (screener) dont l'alerte est issue — traçabilité. */
  presetId: string;
  /** Nom lisible (repris du preset / builder) — sert au message de déclenchement. */
  nom: string;
  tf: Timeframe;
  /** Snapshot des conditions de base à la création. */
  baseConditions: BaseCondition[];
  /** Snapshot des conditions indicateurs à la création. */
  indicatorConditions: IndicatorCondition[];
  /**
   * Période de scan (minutes). Dérivée à la création : 15 si AUCUN filtre indicateur
   * (scan léger : ticker + filtres de base), 60 sinon (étage indicateurs = worker + klines).
   */
  periodeMin: 15 | 60;
  actif: boolean;
  /** ms epoch de création. */
  creeTs: number;
}

/**
 * Données fournies par l'appelant (T3 : builder du screener + preset sélectionné) pour
 * créer une alerte. Le store DÉRIVE le reste (`id`, `periodeMin`, `actif`, `creeTs`).
 * CONTRAT exposé à T3 — toute dérive casse la vue.
 */
export interface DepuisBuilderAlerte {
  presetId: string;
  nom: string;
  tf: Timeframe;
  baseConditions: BaseCondition[];
  indicatorConditions: IndicatorCondition[];
}

export interface PresetAlertsState {
  alertes: AlertePreset[];
  /**
   * Crée une alerte à partir du builder. Renvoie `"limite"` (sans rien créer) si
   * MAX_ALERTES_ACTIVES est déjà atteint, sinon `"ok"`. La nouvelle alerte est ACTIVE.
   */
  ajouter: (b: DepuisBuilderAlerte) => "ok" | "limite";
  retirer: (id: string) => void;
  basculer: (id: string) => void;
}

/** Identifiant d'alerte (crypto.randomUUID si dispo, repli horodaté). */
function genId(): string {
  const c = globalThis.crypto;
  const suffix = c && typeof c.randomUUID === "function" ? c.randomUUID() : Date.now().toString(36);
  return `palert:${suffix}`;
}

/**
 * Lecture TOLÉRANTE des alertes persistées (localStorage absent / JSON corrompu → []).
 * Exportée pour le test de persistance (round-trip + résilience à la corruption).
 */
export function lirePresetAlerts(): AlertePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AlertePreset[]) : [];
  } catch {
    return [];
  }
}

/** Écriture TOLÉRANTE (best-effort : quota / mode privé silencieux). */
function ecrirePresetAlerts(alertes: AlertePreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alertes));
  } catch {
    /* best-effort */
  }
}

export const presetAlertsStore = createStore<PresetAlertsState>((set, get) => ({
  alertes: lirePresetAlerts(),

  ajouter: (b) => {
    const actives = get().alertes.filter((a) => a.actif).length;
    if (actives >= MAX_ALERTES_ACTIVES) return "limite";
    const alerte: AlertePreset = {
      id: genId(),
      presetId: b.presetId,
      nom: b.nom,
      tf: b.tf,
      // Copies profondes : le snapshot ne doit pas partager de référence avec le builder.
      baseConditions: b.baseConditions.map((c) => ({ ...c })),
      indicatorConditions: b.indicatorConditions.map((c) => ({ ...c })),
      periodeMin: b.indicatorConditions.length === 0 ? 15 : 60,
      actif: true,
      creeTs: Date.now(),
    };
    const alertes = [...get().alertes, alerte];
    ecrirePresetAlerts(alertes);
    set({ alertes });
    return "ok";
  },

  retirer: (id) => {
    const alertes = get().alertes.filter((a) => a.id !== id);
    ecrirePresetAlerts(alertes);
    set({ alertes });
  },

  basculer: (id) => {
    const alertes = get().alertes.map((a) => (a.id === id ? { ...a, actif: !a.actif } : a));
    ecrirePresetAlerts(alertes);
    set({ alertes });
  },
}));

// ─────────────────────────── Fonctions PURES (runtime) ───────────────────────────

/**
 * Symboles ENTRANT dans le scan : présents dans `courant` mais absents de `precedent`.
 * `precedent === null` (amorce, aucun scan antérieur) → `[]` (on mémorise sans déclencher).
 * Ordre de `courant` préservé, doublons écartés. PURE.
 */
export function diffEntrants(
  precedent: ReadonlySet<string> | null,
  courant: readonly string[],
): string[] {
  if (precedent === null) return [];
  const vus = new Set<string>();
  const entrants: string[] = [];
  for (const sym of courant) {
    if (precedent.has(sym) || vus.has(sym)) continue;
    vus.add(sym);
    entrants.push(sym);
  }
  return entrants;
}

/**
 * Filtre les symboles encore en COOLDOWN : ne garde un symbole que si son dernier
 * déclenchement date d'AU MOINS `cooldownMs` (borne INCLUSIVE : `now - dernier === cooldownMs`
 * passe). Un symbole jamais déclenché passe toujours. PURE (ne mute pas la map).
 */
export function filtrerCooldown(
  entrants: readonly string[],
  dernierDeclenchement: ReadonlyMap<string, number>,
  nowMs: number,
  cooldownMs: number,
): string[] {
  return entrants.filter((sym) => {
    const dernier = dernierDeclenchement.get(sym);
    return dernier === undefined || nowMs - dernier >= cooldownMs;
  });
}
