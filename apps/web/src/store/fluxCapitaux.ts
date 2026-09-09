import { createStore, type StoreApi } from "zustand/vanilla";
import type { VueFluxCapitaux } from "../data/onchain/fluxCapitaux";
import { enregistrerQualite } from "./qualiteMetriques";
import { bgeometricsKeyStore } from "./onchain";
import { soSoValueKeyStore } from "./sosovalue";

export interface FluxCapitauxState {
  donnees: VueFluxCapitaux | null;
  chargement: boolean;
  erreur: string | null;
}

export interface GestionnaireFluxCapitaux {
  store: StoreApi<FluxCapitauxState>;
  retenirVue: () => () => void;
  garderPourAlertes: (active: boolean) => void;
  actualiser: () => Promise<void>;
  invaliderAcces: () => Promise<void>;
}

/**
 * Le runtime d'alertes est présent dès le démarrage, mais la collecte lente ne doit
 * charger ses transports qu'au premier panneau ou à la première alerte active.
 */
async function chargerFluxCapitauxParDefaut(signal?: AbortSignal): Promise<VueFluxCapitaux> {
  const { chargerFluxCapitaux } = await import("../data/onchain/fluxCapitaux");
  return chargerFluxCapitaux(signal);
}

/** Gestionnaire testable : coalescence, timer unique et annulation au dernier consommateur. */
export function creerGestionnaireFluxCapitaux(
  charger: (signal?: AbortSignal) => Promise<VueFluxCapitaux> = chargerFluxCapitauxParDefaut,
  periodeMs = 60 * 60_000,
): GestionnaireFluxCapitaux {
  const store = createStore<FluxCapitauxState>(() => ({ donnees: null, chargement: false, erreur: null }));
  let vues = 0;
  let alerteActive = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let controleur: AbortController | null = null;
  let travail: Promise<void> | null = null;
  let generation = 0;

  const publier = (vue: VueFluxCapitaux): void => {
    for (const metrique of vue.metriques) {
      if (metrique.qualite) enregistrerQualite(`flux:${metrique.id}`, metrique.libelle, metrique.qualite);
    }
  };

  const actualiser = (): Promise<void> => {
    if (travail && !controleur?.signal.aborted) return travail;
    controleur = new AbortController();
    const local = controleur;
    const generationLocale = generation;
    store.setState({ chargement: true, erreur: null });
    const promesse = charger(local.signal)
      .then((donnees) => {
        if (local.signal.aborted || generationLocale !== generation) return;
        publier(donnees);
        store.setState({ donnees, chargement: false, erreur: null });
      })
      .catch((erreur: unknown) => {
        if (local.signal.aborted || generationLocale !== generation) return;
        const message = erreur instanceof Error ? erreur.message : "Chargement des flux impossible";
        const precedentes = store.getState().donnees;
        const donnees = precedentes ? {
          ...precedentes,
          metriques: precedentes.metriques.map((metrique) => ({
            ...metrique,
            ...(metrique.qualite ? { qualite: { ...metrique.qualite, statut: "perime" as const, raison: `Rafraîchissement échoué · ${message}` } } : {}),
          })),
        } : null;
        if (donnees) publier(donnees);
        store.setState({ donnees, chargement: false, erreur: message });
      })
      .finally(() => {
        if (controleur === local) controleur = null;
        if (travail === promesse) travail = null;
      });
    travail = promesse;
    return travail;
  };

  const synchroniser = (): void => {
    const requis = vues > 0 || alerteActive;
    if (requis && timer === null) {
      void actualiser();
      timer = setInterval(() => void actualiser(), periodeMs);
    } else if (!requis && timer !== null) {
      clearInterval(timer);
      timer = null;
      controleur?.abort();
      controleur = null;
      travail = null;
    }
  };

  const invaliderAcces = (): Promise<void> => {
    generation += 1;
    controleur?.abort();
    controleur = null;
    travail = null;
    return vues > 0 || alerteActive ? actualiser() : Promise.resolve();
  };

  return {
    store,
    actualiser,
    invaliderAcces,
    retenirVue: () => {
      vues += 1;
      synchroniser();
      let liberee = false;
      return () => {
        if (liberee) return;
        liberee = true;
        vues = Math.max(0, vues - 1);
        synchroniser();
      };
    },
    garderPourAlertes: (active) => {
      if (alerteActive === active) return;
      alerteActive = active;
      synchroniser();
    },
  };
}

/** Branche les compteurs sans secret ; ils changent aussi lors d'une rotation vraie → vraie. */
export function ecouterRotationsClesFlux(cible: GestionnaireFluxCapitaux): () => void {
  const arreterBg = bgeometricsKeyStore.subscribe((state, precedent) => {
    if (state.version !== precedent.version) void cible.invaliderAcces();
  });
  const arreterSoSo = soSoValueKeyStore.subscribe((state, precedent) => {
    if (state.version !== precedent.version) void cible.invaliderAcces();
  });
  return () => { arreterBg(); arreterSoSo(); };
}

const gestionnaire = creerGestionnaireFluxCapitaux();
ecouterRotationsClesFlux(gestionnaire);
export const fluxCapitauxStore = gestionnaire.store;
export const retenirFluxCapitaux = gestionnaire.retenirVue;
export const garderFluxCapitauxPourAlertes = gestionnaire.garderPourAlertes;
export const actualiserFluxCapitaux = gestionnaire.actualiser;
