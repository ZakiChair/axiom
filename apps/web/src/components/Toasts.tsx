/**
 * Toasts — pile de notifications en bas à droite (feedback des actions : export PNG, workspace
 * enregistré, playbook appliqué, sauvegarde… et déclenchement d'une alerte). Lit le store
 * vanilla `toastsStore` ; l'empilement (max 3 ; un avis d'alerte n'est jamais chassé, les plus
 * anciens sont fondus en un avis de synthèse) et l'auto-retrait (2500 ms, 6000 ms si une
 * action, jamais pour un avis d'alerte) vivent dans le store. Clic sur un toast = fermeture
 * immédiate ; un toast peut aussi porter une action (ex. « Annuler », « Voir ») — un bouton
 * dédié dans le toast (`div` plutôt que `button` pour ne pas imbriquer un bouton interactif
 * dans un autre).
 * `aria-live="polite"` pour les lecteurs d'écran ; apparition discrète (fade-in opacity,
 * keyframe `axiom-toast-in`). Le conteneur `aria-live` reste monté EN PERMANENCE (même
 * pile vide) : un lecteur d'écran ne peut annoncer un ajout que si la région est déjà
 * présente à l'insertion. Vide, il est transparent et inerte (`pointer-events-none`,
 * aucun toast) ; seuls les toasts captent les clics (`pointer-events-auto`).
 *
 * Au téléphone (12 novembre 2026) :
 *  - un toast ne dépasse jamais l'écran : largeur bornée à la fenêtre moins les deux marges
 *    (avant : 320 px fixes, soit 16 px hors d'un écran de 320 px), et son texte revient à la ligne ;
 *  - la pile se place AU-DESSUS des barres du bas de l'écran, qui restent touchables : un avis
 *    d'alerte reste jusqu'au toucher, il ne doit pas les recouvrir. Ces barres sont dans le flux :
 *    la navigation basse (`.axiom-mobile-navigation` de MobileNavigation.tsx) et, juste au-dessus
 *    dès qu'une fenêtre est ouverte ou réduite, la barre « Fenêtres ouvertes » (`.axiom-taskbar`
 *    de Taskbar.tsx). La position est mesurée sur la plus haute des deux, en coordonnées de la
 *    fenêtre : ni hauteur de barre ni marge de sécurité de l'appareil à recopier ici.
 */
import { useLayoutEffect, useState } from "react";
import { useStore } from "zustand";
import { useMobileLayout } from "../hooks/useMobileLayout";
import { retirerToast, toastsStore } from "../store/toasts";

/** Écart (px) entre le bas de la pile et le haut de la plus haute barre du bas de l'écran. */
const ECART_NAVIGATION_PX = 8;

/** Barres du bas de l'écran au téléphone : la barre « Fenêtres ouvertes », puis la navigation basse. */
const BARRES_BASSES = ".axiom-taskbar, .axiom-mobile-navigation";

/**
 * Haut (px, fenêtre) de la plus haute barre affichée au bas de l'écran ; `null` si aucune ne
 * l'est (plein écran sans fenêtre ouverte).
 */
function hautBarresBasses(): number | null {
  let haut: number | null = null;
  for (const barre of document.querySelectorAll(BARRES_BASSES)) {
    const boite = barre.getBoundingClientRect();
    if (boite.height > 0 && (haut === null || boite.top < haut)) haut = boite.top;
  }
  return haut;
}

export function Toasts() {
  const toasts = useStore(toastsStore, (s) => s.toasts);
  const mobile = useMobileLayout();
  const visible = toasts.length > 0;
  const [hautNavigation, setHautNavigation] = useState<number | null>(null);
  // Mesure avant la peinture, tant que la pile est affichée : à son apparition, quand la fenêtre
  // change (rotation), et quand une barre paraît ou disparaît (plein écran, première fenêtre
  // ouverte, dernière fermée : chacune est un enfant direct de la racine de l'application, la
  // fenêtre ne change pas de taille).
  useLayoutEffect(() => {
    if (!mobile || !visible) {
      setHautNavigation(null);
      return;
    }
    const mesurer = (): void => setHautNavigation(hautBarresBasses());
    mesurer();
    window.addEventListener("resize", mesurer);
    const racine = document.querySelector(".axiom-app");
    const observateur = racine === null ? null : new MutationObserver(mesurer);
    if (racine !== null) observateur?.observe(racine, { childList: true });
    return () => {
      window.removeEventListener("resize", mesurer);
      observateur?.disconnect();
    };
  }, [mobile, visible]);

  return (
    <div
      aria-live="polite"
      // Repère lu par l'encart du graphe (`chart/candleReadout.ts`), qui s'arrête au-dessus de la pile.
      data-pile-avis=""
      // Au-dessus des barres : le bas de la pile est posé sur le haut de la plus haute (translation de sa propre hauteur).
      style={hautNavigation === null ? undefined : { top: hautNavigation - ECART_NAVIGATION_PX, bottom: "auto", transform: "translateY(-100%)" }}
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="button"
          tabIndex={0}
          onClick={() => retirerToast(toast.id)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") retirerToast(toast.id);
          }}
          style={{ animation: "axiom-toast-in 160ms ease-out" }}
          className="pointer-events-auto max-w-[min(20rem,calc(100vw-2rem))] break-words rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-text shadow-lg"
        >
          {toast.texte}
          {toast.action !== undefined && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toast.action?.executer();
                retirerToast(toast.id);
              }}
              // Au téléphone le bouton se touche au doigt : un appui à côté fermerait l'avis.
              className={`ml-2 rounded border border-border bg-bg text-accent transition hover:text-text ${mobile ? "px-3 py-1.5 text-xs" : "px-1.5 py-0.5 text-[10px]"}`}
            >
              {toast.action.libelle}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
