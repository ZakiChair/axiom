/**
 * Store des indicateurs actifs — Zustand VANILLA (hors render-loop React).
 *
 * Contient la liste des instances d'indicateurs (`ActiveIndicator`) actuellement
 * affichées sur le graphe. Lu en BASSE fréquence par le panneau « Indicateurs »
 * et par le contrôleur d'indicateurs du Chart (souscription impérative).
 *
 * Modèle MULTI-INSTANCES : le même `defId` peut apparaître plusieurs fois avec des
 * `params` différents (ex. EMA(20) + EMA(50)). Chaque instance porte un
 * `instanceId` STABLE (figé à la création) qui sert de clé d'identité côté chart
 * (nom KLineChart + pane) et de clé React. Ajout/duplication/édition/suppression
 * se font par `instanceId`.
 *
 * IMPORTANT : ce store ne stocke QUE la SÉLECTION. La source de vérité du CALCUL
 * reste @axiom/indicators (cf. BUILD-CONTRACT).
 */
import { createStore } from "zustand/vanilla";
import type { IndicatorDef, IndicatorInstance } from "@axiom/types";
import { getIndicator } from "@axiom/indicators";

/** Jeu de paramètres d'un indicateur (miroir du type des `params` d'IndicatorInstance). */
type IndicatorParams = Record<string, number | boolean | string>;

/**
 * Instance active d'un indicateur : `IndicatorInstance` (defId + params) enrichi
 * d'un `instanceId` stable. Le type `IndicatorInstance` de @axiom/types est FIGÉ
 * (pas d'`instanceId`) ; on l'étend donc localement côté app.
 */
export interface ActiveIndicator extends IndicatorInstance {
  /** Identité stable de l'instance (base « defId-hashParams » + suffixe d'unicité). */
  instanceId: string;
}

/** Paramètres par défaut déclarés dans les `inputs` d'une définition. */
export function defaultParams(defId: string): IndicatorParams {
  const def = getIndicator(defId);
  const params: IndicatorParams = {};
  if (!def) return params;
  for (const input of def.inputs) params[input.key] = input.default;
  return params;
}

/**
 * Hash court et DÉTERMINISTE d'un jeu de params (FNV-1a 32 bits en base36).
 * Clés triées → indépendant de l'ordre d'insertion. Sert à composer l'instanceId
 * lisible et à indexer le cache de calcul côté chart.
 */
export function shortHash(params: IndicatorParams): string {
  const keys = Object.keys(params).sort();
  let serial = "";
  for (const k of keys) serial += `${k}=${String(params[k])};`;
  let h = 0x811c9dc5; // offset basis FNV-1a
  for (let i = 0; i < serial.length; i++) {
    h ^= serial.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // prime FNV
  }
  return (h >>> 0).toString(36);
}

/** Clé de calcul « defId::hashParams » — deux instances de même config la partagent. */
export function computeKey(defId: string, params: IndicatorParams): string {
  return `${defId}::${shortHash(params)}`;
}

/**
 * Libellé lisible d'une instance : « EMA (20) », « MACD (12, 26, 9) », « VWAP »…
 * On n'affiche que les paramètres de forme (nombres et chaînes source/select),
 * pas les booléens (bruit visuel). Utilisé comme `shortName` de pane KLineChart
 * et dans la section « Actifs » du menu.
 */
export function formatInstanceLabel(def: IndicatorDef, params: IndicatorParams): string {
  const parts: string[] = [];
  for (const input of def.inputs) {
    const v = params[input.key];
    if (typeof v === "number") parts.push(String(v));
    else if (typeof v === "string") parts.push(v);
  }
  return parts.length > 0 ? `${def.name} (${parts.join(", ")})` : def.name;
}

/** Rend `base` unique vis-à-vis de `used` en suffixant « -2 », « -3 »… si besoin. */
function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Élément entrant potentiellement déjà identifié (persistance) ou non (défaut). */
type MaybeIdentified = IndicatorInstance & { instanceId?: string };

/**
 * Attribue un `instanceId` stable et UNIQUE à chaque élément : réutilise
 * l'instanceId fourni s'il existe (état déjà migré), sinon le compose depuis
 * `defId-hashParams`. Les collisions (duplicatas de config) reçoivent un suffixe.
 */
function assignInstanceIds(list: ReadonlyArray<MaybeIdentified>): ActiveIndicator[] {
  const used = new Set<string>();
  const out: ActiveIndicator[] = [];
  for (const item of list) {
    const base =
      typeof item.instanceId === "string" && item.instanceId.length > 0
        ? item.instanceId
        : `${item.defId}-${shortHash(item.params)}`;
    const instanceId = uniqueId(base, used);
    used.add(instanceId);
    out.push({ instanceId, defId: item.defId, params: item.params });
  }
  return out;
}

/**
 * Migration/validation PURE de l'état persisté (liste hétérogène `defId(+params)`
 * potentiellement ancienne) vers des `ActiveIndicator`. Filtre les `defId`
 * disparus du registre, normalise les params manquants/invalides et attribue les
 * instanceId. Exposée pour que la consolidation future de `persist.ts` s'appuie
 * dessus (cf. vigilance) — elle ne touche à aucun store (fonction pure).
 */
export function migratePersistedIndicators(raw: unknown): ActiveIndicator[] {
  if (!Array.isArray(raw)) return [];
  const valid: MaybeIdentified[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { defId?: unknown; params?: unknown; instanceId?: unknown };
    if (typeof e.defId !== "string" || getIndicator(e.defId) === undefined) continue;
    const params: IndicatorParams =
      e.params && typeof e.params === "object"
        ? (e.params as IndicatorParams)
        : defaultParams(e.defId);
    const identified: MaybeIdentified = { defId: e.defId, params };
    if (typeof e.instanceId === "string" && e.instanceId.length > 0) {
      identified.instanceId = e.instanceId;
    }
    valid.push(identified);
  }
  return assignInstanceIds(valid);
}

export interface IndicatorsState {
  indicators: ActiveIndicator[];
  /** Ajoute une NOUVELLE instance du `defId` aux params par défaut. */
  add: (defId: string) => void;
  /** Retire l'instance identifiée. */
  remove: (instanceId: string) => void;
  /** Duplique une instance (params clonés, nouvel instanceId), insérée juste après. */
  duplicate: (instanceId: string) => void;
  /** Remplace les params d'une instance (instanceId INCHANGÉ → override en place). */
  updateParams: (instanceId: string, params: IndicatorParams) => void;
  /**
   * Bascule « rapide » par defId (utilisée par la command palette) : retire TOUTES
   * les instances du defId si au moins une est présente, sinon en ajoute une aux
   * params par défaut. Pratique pour un raccourci « activer / désactiver ».
   */
  toggle: (defId: string) => void;
  /** Remplace toute la liste (restauration depuis localStorage) ; réattribue les instanceId. */
  setAll: (indicators: IndicatorInstance[]) => void;
}

export const indicatorsStore = createStore<IndicatorsState>((set, get) => ({
  indicators: [],

  add: (defId) => {
    const def = getIndicator(defId);
    if (!def) return; // defId inconnu au registre : ignoré.
    const params = defaultParams(defId);
    const current = get().indicators;
    const used = new Set(current.map((i) => i.instanceId));
    const instanceId = uniqueId(`${defId}-${shortHash(params)}`, used);
    set({ indicators: [...current, { instanceId, defId, params }] });
  },

  remove: (instanceId) => {
    set({ indicators: get().indicators.filter((i) => i.instanceId !== instanceId) });
  },

  duplicate: (instanceId) => {
    const current = get().indicators;
    const idx = current.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) return;
    const src = current[idx];
    if (!src) return; // noUncheckedIndexedAccess : garde le typage strict content.
    const used = new Set(current.map((i) => i.instanceId));
    // Params identiques → même hash → uniqueId suffixe pour dédoublonner.
    const newId = uniqueId(`${src.defId}-${shortHash(src.params)}`, used);
    const copy: ActiveIndicator = {
      instanceId: newId,
      defId: src.defId,
      params: { ...src.params },
    };
    const next = current.slice();
    next.splice(idx + 1, 0, copy);
    set({ indicators: next });
  },

  updateParams: (instanceId, params) => {
    // instanceId figé : le contrôleur de chart met l'instance à jour EN PLACE
    // (override), sans recréer le pane — le libellé, lui, est recalculé.
    set({
      indicators: get().indicators.map((i) =>
        i.instanceId === instanceId ? { instanceId: i.instanceId, defId: i.defId, params } : i
      ),
    });
  },

  toggle: (defId) => {
    const current = get().indicators;
    if (current.some((i) => i.defId === defId)) {
      set({ indicators: current.filter((i) => i.defId !== defId) });
    } else {
      get().add(defId);
    }
  },

  setAll: (indicators) => set({ indicators: assignInstanceIds(indicators) }),
}));
