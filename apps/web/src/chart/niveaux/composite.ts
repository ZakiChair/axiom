/**
 * Fournisseur COMPOSITE des overlays de niveaux (chunk paresseux) : un seul contrôleur canvas
 * pour toutes les sources de lignes du chart maître. Chaque source est créée à la demande
 * (première activation de sa bascule) puis GARDÉE pour la vie du composite, afin que son mémo
 * survive à un OFF → ON ; seules les sources allumées sont abonnées. Les niveaux de même prix
 * sont fusionnés en une ligne (« PDC·OJ·OS ») pour ne pas empiler des étiquettes illisibles.
 */
import type { StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "@axiom/types";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import {
  niveauxOverlaysStore,
  type CleOverlayNiveaux,
  type ContexteNiveaux,
  type NiveauxOverlaysState,
} from "../niveauxOverlays";
import { creerSourceNiveauxCles } from "./niveauxCles";
import { creerSourceNiveauxOptions } from "./niveauxOptions";
import { creerSourceBandesImplicites } from "./bandesImplicites";

export type FabriqueSource = (ctx: ContexteNiveaux) => FournisseurLignes;

export const FABRIQUES: Record<CleOverlayNiveaux, FabriqueSource> = {
  niveauxCles: (ctx) => creerSourceNiveauxCles(ctx),
  niveauxOptions: (ctx) => creerSourceNiveauxOptions(ctx),
  bandesImplicites: (ctx) => creerSourceBandesImplicites(ctx),
};

/** Ordre d'agrégation = priorité de fusion (couleur de la première ligne d'un groupe). */
export const ORDRE_SOURCES: readonly CleOverlayNiveaux[] = ["niveauxCles", "niveauxOptions", "bandesImplicites"];

/**
 * Fusionne les lignes de même prix (écart relatif ≤ `tolRel`) : étiquettes jointes par « · »
 * dans l'ordre d'arrivée, emphase forte si l'une l'est, couleur de la première. Les prix non
 * finis ou ≤ 0 sont écartés. PURE.
 */
export function fusionnerLignes(lignes: readonly LigneNiveau[], tolRel = 1e-9): LigneNiveau[] {
  const out: LigneNiveau[] = [];
  for (const l of lignes) {
    if (!Number.isFinite(l.price) || l.price <= 0) continue;
    const meme = out.find((o) => Math.abs(o.price - l.price) <= tolRel * o.price);
    if (meme === undefined) {
      out.push({ ...l });
    } else {
      meme.label = `${meme.label}·${l.label}`;
      if (l.emphase === "forte") meme.emphase = "forte";
    }
  }
  return out;
}

export function creerFournisseurComposite(
  ctx: ContexteNiveaux,
  fabriques: Partial<Record<CleOverlayNiveaux, FabriqueSource>> = FABRIQUES,
  store: StoreApi<NiveauxOverlaysState> = niveauxOverlaysStore,
): FournisseurLignes {
  const sources = new Map<CleOverlayNiveaux, FournisseurLignes>();
  const source = (cle: CleOverlayNiveaux): FournisseurLignes | null => {
    let s = sources.get(cle);
    const fabrique = fabriques[cle];
    if (s === undefined && fabrique !== undefined) {
      s = fabrique(ctx);
      sources.set(cle, s);
    }
    return s ?? null;
  };

  return {
    getLignes: () => {
      const etat = store.getState();
      return fusionnerLignes(ORDRE_SOURCES.flatMap((cle) => (etat[cle] ? (sources.get(cle)?.getLignes() ?? []) : [])));
    },
    subscribe(onChange): Unsubscribe {
      const abonnements = new Map<CleOverlayNiveaux, Unsubscribe>();
      const synchroniser = (etat: NiveauxOverlaysState): void => {
        for (const cle of ORDRE_SOURCES) {
          const desabonner = abonnements.get(cle);
          if (etat[cle] && desabonner === undefined) {
            const s = source(cle);
            if (s !== null) abonnements.set(cle, s.subscribe(onChange));
          } else if (!etat[cle] && desabonner !== undefined) {
            desabonner();
            abonnements.delete(cle);
          }
        }
        onChange();
      };
      synchroniser(store.getState());
      const desabonnerStore = store.subscribe(synchroniser);
      return () => {
        desabonnerStore();
        for (const desabonner of abonnements.values()) desabonner();
        abonnements.clear();
      };
    },
  };
}
