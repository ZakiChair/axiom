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
  /**
   * Index de couleur de l'instance dans le cycle `--serie-1…6` du thème (0-based).
   * Attribué à l'ACTIVATION et figé ensuite : la couleur suit l'ENTITÉ, jamais son
   * rang d'affichage — réordonner les panes ou éditer les params ne repeint rien.
   * Le chart le lit AU MOMENT DU DESSIN (cf. chart/indicators.ts).
   */
  couleurIdx: number;
}

/** Nombre de tokens de série du thème (`--serie-1` … `--serie-6`). */
export const NB_COULEURS_SERIE = 6;

/**
 * Nombre de jetons de couleur qu'une instance CONSOMME : une par sortie tracée, car
 * le chart peint la sortie `i` avec `serieCanvas(couleurIdx + i)`. Une instance à trois
 * sorties (Bollinger) occupe donc trois jetons consécutifs, et la suivante doit
 * commencer après — sinon son unique ligne reprend exactement la couleur d'une des
 * bandes, sur le même pane. Borné à la taille du cycle : au-delà, les couleurs se
 * répètent de toute façon à l'intérieur de l'instance.
 */
export function jetonsConsommes(defId: string): number {
  const n = getIndicator(defId)?.outputs.length ?? 1;
  return Math.max(1, Math.min(n, NB_COULEURS_SERIE));
}

/**
 * Index de couleur le MOINS chargé, en tenant compte de l'ARITÉ de chaque instance
 * (à charge égale, le plus petit index). PURE.
 *
 * `pris` liste les instances déjà placées sous la forme `[indexDeDépart, nbJetons]` :
 * chacune marque `nbJetons` index consécutifs à partir de son départ. Le comptage,
 * plutôt qu'un « premier libre sinon 0 », vient de deux cas observés : six panes
 * occupant déjà les six tokens faisaient ressortir toutes les EMA suivantes en
 * --serie-1 ; et une instance multi-sorties non déclarée faisait recouvrir ses bandes
 * par l'overlay suivant.
 */
export function prochainIndexCouleur(
  pris: ReadonlyArray<number | undefined | readonly [number, number]>
): number {
  const comptes = new Array<number>(NB_COULEURS_SERIE).fill(0);
  const marquer = (depart: number, jetons: number): void => {
    if (!Number.isInteger(depart) || depart < 0 || depart >= NB_COULEURS_SERIE) return;
    for (let k = 0; k < jetons; k++) {
      const idx = (depart + k) % NB_COULEURS_SERIE;
      comptes[idx] = (comptes[idx] ?? 0) + 1;
    }
  };
  for (const entree of pris) {
    if (typeof entree === "number") marquer(entree, 1);
    else if (Array.isArray(entree)) marquer(entree[0], Math.max(1, entree[1]));
  }
  let meilleur = 0;
  for (let i = 1; i < NB_COULEURS_SERIE; i++) {
    if ((comptes[i] ?? 0) < (comptes[meilleur] ?? 0)) meilleur = i;
  }
  return meilleur;
}

/** Occupation courante d'une liste d'instances, prête pour `prochainIndexCouleur`. */
export function occupationCouleurs(
  instances: ReadonlyArray<{ defId: string; couleurIdx: number }>
): Array<readonly [number, number]> {
  return instances.map((i) => [i.couleurIdx, jetonsConsommes(i.defId)] as const);
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
type MaybeIdentified = IndicatorInstance & { instanceId?: string; couleurIdx?: number };

/**
 * Attribue un `instanceId` stable et UNIQUE à chaque élément : réutilise
 * l'instanceId fourni s'il existe (état déjà migré), sinon le compose depuis
 * `defId-hashParams`. Les collisions (duplicatas de config) reçoivent un suffixe.
 * Même traitement pour `couleurIdx` : préservé s'il est déjà là (session restaurée,
 * la couleur d'une EMA ne doit pas changer d'un lancement à l'autre), sinon alloué.
 */
function assignInstanceIds(list: ReadonlyArray<MaybeIdentified>): ActiveIndicator[] {
  const couleurPersistee = (item: MaybeIdentified): number | null =>
    typeof item.couleurIdx === "number" &&
    Number.isInteger(item.couleurIdx) &&
    item.couleurIdx >= 0 &&
    item.couleurIdx < NB_COULEURS_SERIE
      ? item.couleurIdx
      : null;

  // Un état enregistré AVANT l'allocation par instance a toutes ses instances sur la
  // même couleur : rien dans l'UI ne permettrait de le réparer, on réalloue donc tout.
  // C'est le SEUL cas de réattribution — hors de là, ce qui est persisté fait foi.
  // Une règle plus fine (« garder sauf si une autre couleur est moins chargée »)
  // paraissait plus juste mais n'était pas idempotente : recharger une liste comportant
  // un doublon inévitable décalait les couleurs de toutes les instances suivantes, et
  // l'agencement changeait de teintes à chaque ouverture.
  const persistees = list.map(couleurPersistee);
  const toutesPersistees = persistees.every((c) => c !== null);
  const degenere =
    list.length > 1 && toutesPersistees && new Set(persistees).size === 1;

  const used = new Set<string>();
  const placees: Array<{ defId: string; couleurIdx: number }> = [];
  const out: ActiveIndicator[] = [];
  list.forEach((item, i) => {
    const base =
      typeof item.instanceId === "string" && item.instanceId.length > 0
        ? item.instanceId
        : `${item.defId}-${shortHash(item.params)}`;
    const instanceId = uniqueId(base, used);
    used.add(instanceId);
    const persistee = degenere ? null : persistees[i] ?? null;
    const couleurIdx = persistee ?? prochainIndexCouleur(occupationCouleurs(placees));
    placees.push({ defId: item.defId, couleurIdx });
    out.push({ instanceId, defId: item.defId, params: item.params, couleurIdx });
  });
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
    const e = entry as {
      defId?: unknown;
      params?: unknown;
      instanceId?: unknown;
      couleurIdx?: unknown;
    };
    if (typeof e.defId !== "string" || getIndicator(e.defId) === undefined) continue;
    const params: IndicatorParams =
      e.params && typeof e.params === "object"
        ? (e.params as IndicatorParams)
        : defaultParams(e.defId);
    const identified: MaybeIdentified = { defId: e.defId, params };
    if (typeof e.instanceId === "string" && e.instanceId.length > 0) {
      identified.instanceId = e.instanceId;
    }
    if (typeof e.couleurIdx === "number") identified.couleurIdx = e.couleurIdx;
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
  /**
   * Remplace toute la liste (restauration depuis localStorage) ; réattribue les
   * instanceId, et les couleurs manquantes (celles déjà persistées sont gardées).
   */
  setAll: (indicators: Array<IndicatorInstance & { couleurIdx?: number }>) => void;
  /** Réordonne les instances selon l'ordre d'instanceId fourni (drag des en-têtes de
   * pane, cf. chart/paneHeaders.tsx). Toute instance absente de `order` est ajoutée
   * en fin (garde-fou anti-perte). */
  reorder: (order: string[]) => void;
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
    const couleurIdx = prochainIndexCouleur(occupationCouleurs(current));
    set({ indicators: [...current, { instanceId, defId, params, couleurIdx }] });
  },

  remove: (instanceId) => {
    set({ indicators: get().indicators.filter((i) => i.instanceId !== instanceId) });
  },

  reorder: (order) => {
    const current = get().indicators;
    const byId = new Map(current.map((i) => [i.instanceId, i]));
    const reordered = order
      .map((id) => byId.get(id))
      .filter((i): i is ActiveIndicator => i !== undefined);
    const missing = current.filter((i) => !order.includes(i.instanceId));
    set({ indicators: [...reordered, ...missing] });
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
      // Couleur PROPRE à la copie : dupliquer celle de la source donnerait deux
      // courbes de mêmes params ET même couleur, donc indiscernables.
      couleurIdx: prochainIndexCouleur(occupationCouleurs(current)),
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
        i.instanceId === instanceId
          ? { instanceId: i.instanceId, defId: i.defId, params, couleurIdx: i.couleurIdx }
          : i
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
