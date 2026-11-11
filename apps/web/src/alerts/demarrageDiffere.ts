/**
 * Démarrage différé du runtime des alertes (constat WEB-3 de la revue du 6 novembre 2026).
 *
 * `alerts/runtime` ne sert qu'une fois démarré, dans un effet d'App : il est chargé par
 * `import()`, hors du chargement initial (garde-fou : chargementInitial.test.ts). Le runtime
 * se calibre sur l'état courant des stores à son démarrage ; rien n'est à rattraper ici.
 *
 * Sans runtime, aucune alerte n'est évaluée dans ce navigateur (et, sans daemon, nulle part
 * ailleurs). Un échec de chargement (chunk introuvable après un déploiement, coupure réseau)
 * n'est donc jamais silencieux : `console.error`, toast, puis nouvelle tentative au prochain
 * `online` et au prochain retour de l'onglet au premier plan. Une seule tentative à la fois.
 *
 * Le toast expire en quelques secondes ; l'état, lui, dure. Il est donc aussi inscrit au
 * registre santé (ligne « alertes » en erreur : pastille « Santé » du bandeau, section Santé
 * sources, fenêtre DATA), comme le lien `axiomd` qui n'est pas non plus une source de marché.
 * La ligne est posée par un échec, ou par un chargement qui traîne plus de dix secondes (réseau
 * dégradé : sans elle, le bandeau compterait des alertes que rien n'évalue encore) ; elle reste
 * tant que le runtime n'est pas démarré et disparaît à son démarrage. Avant ces dix secondes,
 * un chargement en cours ne s'affiche pas.
 *
 * Mesuré dans Chromium : un `import()` échoué reste mémorisé pour toute la vie du document,
 * la nouvelle tentative échoue donc aussitôt, sans requête. Elle ramène alors l'avis, dont le
 * bouton « Recharger » est le seul remède fiable (même constat que `ErrorBoundary` pour
 * `React.lazy`) ; un moteur qui relance la requête reprend, lui, sans rechargement.
 */
import type { Unsubscribe } from "@axiom/types";
import { healthStore } from "../store/health";
import { pousserToast, retirerToast, toastsStore } from "../store/toasts";

/** Avis affiché à chaque échec de chargement du runtime. */
export const AVIS_ALERTES_INACTIVES = "Alertes inactives : module non chargé";
/** État inscrit au registre santé, sans toast, quand le chargement dépasse `DELAI_CHARGEMENT_LENT_MS`. */
export const AVIS_ALERTES_CHARGEMENT = "Alertes inactives : chargement en cours";
/** Durée au-delà de laquelle un chargement encore en cours est dit au registre santé. */
export const DELAI_CHARGEMENT_LENT_MS = 10_000;
/** Ligne du registre santé, en erreur après un échec ou pendant un chargement qui traîne. */
export const SOURCE_SANTE_ALERTES = "alertes";

type ChargeurRuntime = () => Promise<{ demarrerAlertes: () => Unsubscribe }>;

/**
 * Charge puis démarre le runtime des alertes ; renvoie l'arrêt. Un arrêt survenu pendant le
 * chargement annule le démarrage (double montage React StrictMode : seul le second montage
 * démarre un runtime). `charger` n'est remplacé que par les tests.
 */
export function demarrerAlertesDifferees(charger: ChargeurRuntime = () => import("./runtime")): Unsubscribe {
  let annule = false;
  let enCours = false;
  let ecoute = false;
  /** Texte du dernier échec signalé par cette instance ; `undefined` : aucun avis à effacer. */
  let avis: string | undefined;
  /** Vrai quand la ligne santé a été posée par cette instance (échec, ou chargement qui traîne). */
  let ligne = false;
  let chargementLent: ReturnType<typeof setTimeout> | undefined;
  let arreter: Unsubscribe | undefined;

  const poserLigne = (texte: string): void => {
    ligne = true;
    healthStore.getState().marquerErreur(SOURCE_SANTE_ALERTES, texte);
  };
  // La ligne n'appartient qu'à l'instance qui l'a posée : un arrêt périmé n'y touche pas.
  const leverLigne = (): void => {
    if (ligne) healthStore.getState().retirer(SOURCE_SANTE_ALERTES);
    ligne = false;
  };

  const retirerAvis = (): void => {
    for (const toast of toastsStore.getState().toasts) {
      if (toast.texte === avis) retirerToast(toast.id);
    }
  };

  const signaler = (texte: string, erreur: unknown): void => {
    console.error(`[AXIOM] ${texte}`, erreur);
    // Un seul avis à la fois : celui d'un échec précédent, encore affiché, est remplacé.
    retirerAvis();
    avis = texte;
    poserLigne(texte);
    // Hors ligne, recharger remplacerait l'application par la page d'erreur du navigateur.
    pousserToast(texte, navigator.onLine ? { libelle: "Recharger", executer: () => window.location.reload() } : undefined);
  };

  const tenter = (): void => {
    if (enCours) return;
    enCours = true;
    // Chargement qui traîne : l'état est dit au registre santé, sans toast (rien n'a échoué).
    chargementLent = setTimeout(() => poserLigne(AVIS_ALERTES_CHARGEMENT), DELAI_CHARGEMENT_LENT_MS);
    charger().then(
      ({ demarrerAlertes }) => {
        clearTimeout(chargementLent);
        enCours = false;
        if (annule) return;
        ecouter(false);
        try {
          arreter = demarrerAlertes();
        } catch (erreur) {
          // Module chargé mais runtime en échec : pas de nouvelle tentative, qui empilerait
          // les abonnements d'un démarrage interrompu.
          signaler("Alertes inactives : démarrage échoué", erreur);
          return;
        }
        leverLigne();
        if (avis === undefined) return;
        // Rétablissement après un échec : l'avis encore affiché disparaît, un toast le dit.
        retirerAvis();
        avis = undefined;
        pousserToast("Alertes actives");
      },
      (erreur: unknown) => {
        clearTimeout(chargementLent);
        enCours = false;
        if (annule) return;
        signaler(AVIS_ALERTES_INACTIVES, erreur);
        ecouter(true);
      },
    );
  };

  const auRetourOnglet = (): void => {
    if (document.visibilityState === "visible") tenter();
  };
  const ecouter = (actif: boolean): void => {
    if (ecoute === actif) return;
    ecoute = actif;
    const methode = actif ? "addEventListener" : "removeEventListener";
    window[methode]("online", tenter);
    document[methode]("visibilitychange", auRetourOnglet);
  };

  tenter();
  return () => {
    annule = true;
    ecouter(false);
    clearTimeout(chargementLent);
    arreter?.();
    arreter = undefined;
    leverLigne();
    avis = undefined;
  };
}
