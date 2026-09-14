/**
 * Overlays de NIVEAUX du chart maître — socle chargé au démarrage (budget initial serré).
 *
 * Ce module ne contient que la bascule persistée (défaut OFF), les familles des niveaux
 * clés, les commandes de palette et une ENVELOPPE paresseuse du fournisseur de lignes :
 * le code des sources (`./niveaux/*`) n'est chargé par `import()` qu'au premier abonnement,
 * c'est-à-dire à la première activation — jamais au montage. ChartInstance crée l'enveloppe
 * avec l'identité CAPTURÉE de son effet DONNÉES (overlay scellé au slot) : un changement de
 * symbole détruit contrôleur et fournisseur, aucune ligne d'un actif ne fuit sur un autre.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ExchangeId, Unsubscribe } from "@axiom/types";
import type { Commande } from "../commands/registry";
import type { FournisseurLignes } from "./niveauxLignes";

/** Overlays pilotés par ce socle (les lots suivants ajoutent leurs clés). */
export type CleOverlayNiveaux = "niveauxCles";
/** Familles des niveaux clés : jour, semaine, mois, trimestre (UTC). */
export type FamilleNiveauxCles = "J" | "S" | "M" | "T";
export const FAMILLES_NIVEAUX_CLES: readonly FamilleNiveauxCles[] = ["J", "S", "M", "T"];

export interface NiveauxOverlaysState {
  niveauxCles: boolean;
  /** Familles affichées — jamais vide, ordre canonique J, S, M, T ; défaut J + S. */
  familles: FamilleNiveauxCles[];
  basculer: (cle: CleOverlayNiveaux) => void;
  /** Force une bascule (idempotent) — hydratation persistée. */
  setActif: (cle: CleOverlayNiveaux, actif: boolean) => void;
  /** Ajoute/retire une famille (refuse de vider la liste) et allume les niveaux clés. */
  basculerFamille: (famille: FamilleNiveauxCles) => void;
  /** Remplace les familles (inconnues filtrées, liste vide ignorée). */
  setFamilles: (familles: readonly FamilleNiveauxCles[]) => void;
}

const canoniques = (garder: (f: FamilleNiveauxCles) => boolean): FamilleNiveauxCles[] =>
  FAMILLES_NIVEAUX_CLES.filter(garder);

export const niveauxOverlaysStore: StoreApi<NiveauxOverlaysState> = createStore<NiveauxOverlaysState>((set, get) => ({
  niveauxCles: false,
  familles: ["J", "S"],
  basculer: (cle) => set({ [cle]: !get()[cle] }),
  setActif: (cle, actif) => set({ [cle]: actif }),
  basculerFamille: (famille) => {
    const { familles } = get();
    const suivantes = canoniques((f) => (f === famille) !== familles.includes(f));
    set(suivantes.length > 0 ? { familles: suivantes, niveauxCles: true } : { niveauxCles: true });
  },
  setFamilles: (familles) => {
    const suivantes = canoniques((f) => familles.includes(f));
    if (suivantes.length > 0) set({ familles: suivantes });
  },
}));

/** Au moins un overlay de niveaux est allumé (PURE). */
export function overlaysNiveauxActifs(s: NiveauxOverlaysState): boolean {
  return s.niveauxCles;
}

/** Identité capturée du slot hôte. */
export interface ContexteNiveaux {
  exchange: ExchangeId;
  symbol: string;
}

/**
 * Enveloppe paresseuse : charge `./niveaux/composite` au premier `subscribe` et délègue au
 * fournisseur réel ; `[]` tant qu'il n'est pas chargé. Un désabonnement survenu avant la fin
 * du chargement n'abonne jamais le fournisseur réel.
 */
export function creerFournisseurNiveauxSlot(
  ctx: ContexteNiveaux,
  charger: () => Promise<(ctx: ContexteNiveaux) => FournisseurLignes> = () =>
    import("./niveaux/composite").then((m) => m.creerFournisseurComposite),
): FournisseurLignes {
  let reel: FournisseurLignes | null = null;
  return {
    getLignes: () => reel?.getLignes() ?? [],
    subscribe(onChange): Unsubscribe {
      let vivant = true;
      let desabonner: Unsubscribe | null = null;
      void charger()
        .then((fabrique) => {
          if (!vivant) return;
          reel ??= fabrique(ctx);
          desabonner = reel.subscribe(onChange);
          onChange();
        })
        .catch((err) => console.error("[AXIOM] overlays de niveaux indisponibles", err));
      return () => {
        vivant = false;
        desabonner?.();
      };
    },
  };
}

const NOMS_FAMILLES: Record<FamilleNiveauxCles, string> = { J: "jour", S: "semaine", M: "mois", T: "trimestre" };

export const commandesNiveauxOverlays: Commande[] = [
  {
    id: "action:niveaux-cles",
    mnemonique: "NIVCLE",
    libelle: "Niveaux clés (veille, semaine, mois, ouvertures) — activer / désactiver",
    categorie: "action",
    motsCles: ["pdh", "pdl", "ouverture"],
    action: () => niveauxOverlaysStore.getState().basculer("niveauxCles"),
  },
  ...FAMILLES_NIVEAUX_CLES.map((f): Commande => ({
    id: `action:niveaux-cles-${f.toLowerCase()}`,
    mnemonique: `NIVCLE-${f}`,
    libelle: `Niveaux clés — famille ${NOMS_FAMILLES[f]} (afficher / masquer)`,
    categorie: "action",
    motsCles: [],
    action: () => niveauxOverlaysStore.getState().basculerFamille(f),
  })),
];
