/**
 * Jeux d'indicateurs NOMMÉS — Zustand vanilla, persisté.
 *
 * Le catalogue compte 152 entrées présentées dans un panneau de 288 px, sans favori,
 * sans récent, sans preset : reconstituer un setup de travail imposait de re-cocher
 * huit lignes une par une, à chaque fois (revue du 2026-08-01 § 6.2). Sur un terminal
 * mono-utilisateur, « setup dérivés » ou « setup swing » rappelés en une frappe sont
 * le raccourci le plus rentable du menu.
 *
 * Un jeu fige la SÉLECTION (defId + params + couleur), jamais le calcul : le rappeler
 * passe par `indicatorsStore.setAll`, exactement comme une restauration de session.
 */
import { createStore } from "zustand/vanilla";
import type { ActiveIndicator } from "./indicators";

/** Un jeu nommé : instantané des instances actives au moment de l'enregistrement. */
export interface JeuIndicateurs {
  /** Identité stable (sert de clé React et d'id de commande ⌘K). */
  id: string;
  nom: string;
  instances: ActiveIndicator[];
}

/** Nombre maximal de jeux — garde-fou de lisibilité, pas une contrainte technique. */
export const MAX_JEUX = 12;

/**
 * Id déterministe dérivé du nom (sans accent, en kebab), suffixé en cas de collision.
 * PURE. L'id sert de mnémonique de commande : il doit rester lisible et stable.
 */
export function idPourNom(nom: string, existants: readonly string[]): string {
  const base =
    nom
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "jeu";
  if (!existants.includes(base)) return base;
  let n = 2;
  while (existants.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export interface IndicatorSetsState {
  jeux: JeuIndicateurs[];
  /** Enregistre les instances sous ce nom. Un nom DÉJÀ pris est ÉCRASÉ (pas de doublon). */
  enregistrer: (nom: string, instances: ActiveIndicator[]) => void;
  supprimer: (id: string) => void;
  renommer: (id: string, nom: string) => void;
  /** Remplace toute la liste (restauration depuis localStorage). */
  setAll: (jeux: JeuIndicateurs[]) => void;
}

export const indicatorSetsStore = createStore<IndicatorSetsState>((set, get) => ({
  jeux: [],

  enregistrer: (nom, instances) => {
    const label = nom.trim();
    if (label === "") return;
    const jeux = get().jeux;
    // Écrasement par NOM : ré-enregistrer « swing » après un ajustement met le jeu à
    // jour au lieu d'en créer un second, homonyme et indiscernable dans la palette.
    const existant = jeux.find((j) => j.nom.toLowerCase() === label.toLowerCase());
    const copie = instances.map((i) => ({ ...i, params: { ...i.params } }));
    if (existant) {
      set({ jeux: jeux.map((j) => (j.id === existant.id ? { ...j, instances: copie } : j)) });
      return;
    }
    if (jeux.length >= MAX_JEUX) return;
    set({
      jeux: [...jeux, { id: idPourNom(label, jeux.map((j) => j.id)), nom: label, instances: copie }],
    });
  },

  supprimer: (id) => set({ jeux: get().jeux.filter((j) => j.id !== id) }),

  renommer: (id, nom) => {
    const label = nom.trim();
    if (label === "") return;
    set({ jeux: get().jeux.map((j) => (j.id === id ? { ...j, nom: label } : j)) });
  },

  setAll: (jeux) => set({ jeux: jeux.slice(0, MAX_JEUX) }),
}));

/**
 * Migration PURE de l'état persisté : filtre tout ce qui n'a pas la forme attendue
 * plutôt que de faire confiance au JSON (même patron que `migratePersistedIndicators`).
 */
export function migrerJeuxPersistes(brut: unknown): JeuIndicateurs[] {
  if (!Array.isArray(brut)) return [];
  const out: JeuIndicateurs[] = [];
  for (const entree of brut) {
    if (!entree || typeof entree !== "object") continue;
    const e = entree as { id?: unknown; nom?: unknown; instances?: unknown };
    if (typeof e.id !== "string" || typeof e.nom !== "string") continue;
    if (!Array.isArray(e.instances)) continue;
    out.push({ id: e.id, nom: e.nom, instances: e.instances as ActiveIndicator[] });
  }
  return out.slice(0, MAX_JEUX);
}
