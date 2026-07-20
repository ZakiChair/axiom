/**
 * Branche les gestes de navigation d'axe sur un <canvas> :
 *   molette  = zoom centré sur le curseur (listener NATIF { passive: false },
 *              seul moyen de preventDefault le scroll — pattern GlobeWindow) ;
 *   drag     = pan horizontal (pointer capture) ;
 *   dbl-clic = retour aux bornes complètes.
 *
 * `bornes` = domaine total des données (null tant qu'elles ne sont pas chargées).
 * Le domaine visible se réinitialise quand les bornes changent (nouvelle série).
 * `onGeste` est appelé à chaque interaction manuelle — les fenêtres s'en servent
 * pour désactiver le bouton de période actif (« plage personnalisée »).
 */
import { useEffect, useRef, useState } from "react";
import {
  deplacerDomaine,
  pixelVersValeur,
  zoomerDomaine,
  type Domaine,
} from "../lib/domaineAxe";

export function useDomaineZoom(
  bornes: Domaine | null,
  onGeste?: () => void,
): {
  refCanvas: React.RefObject<HTMLCanvasElement | null>;
  domaine: Domaine | null;
  setDomaine: (d: Domaine) => void;
} {
  const refCanvas = useRef<HTMLCanvasElement | null>(null);
  const [domaine, setDomaine] = useState<Domaine | null>(bornes);

  // Miroirs en refs : les listeners natifs (attachés une fois) lisent l'état courant.
  const domaineRef = useRef(domaine);
  domaineRef.current = domaine;
  const bornesRef = useRef(bornes);
  bornesRef.current = bornes;
  const onGesteRef = useRef(onGeste);
  onGesteRef.current = onGeste;

  // Nouvelle série (bornes changent) → plage personnalisée obsolète, on repart du tout.
  useEffect(() => {
    setDomaine(bornes);
  }, [bornes?.min, bornes?.max]);

  // Attache les listeners quand le canvas existe (il apparaît avec les données).
  const actif = bornes !== null;
  useEffect(() => {
    const cvs = refCanvas.current;
    if (cvs === null || !actif) return;

    const surMolette = (e: WheelEvent): void => {
      const d = domaineRef.current;
      const b = bornesRef.current;
      if (d === null || b === null) return;
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const pivot = pixelVersValeur(d, e.clientX - rect.left, rect.width);
      const facteur = Math.exp(-e.deltaY * 0.002); // deltaY < 0 (haut) = zoom avant
      setDomaine(zoomerDomaine(d, facteur, pivot, b));
      onGesteRef.current?.();
    };

    let panDepuisX: number | null = null;
    const surPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      panDepuisX = e.clientX;
      cvs.setPointerCapture(e.pointerId);
    };
    const surPointerMove = (e: PointerEvent): void => {
      const d = domaineRef.current;
      const b = bornesRef.current;
      if (panDepuisX === null || d === null || b === null) return;
      const rect = cvs.getBoundingClientRect();
      const dx = e.clientX - panDepuisX;
      if (dx === 0) return;
      panDepuisX = e.clientX;
      setDomaine(deplacerDomaine(d, (-dx / Math.max(1, rect.width)) * (d.max - d.min), b));
      onGesteRef.current?.();
    };
    const surPointerFin = (e: PointerEvent): void => {
      panDepuisX = null;
      if (cvs.hasPointerCapture(e.pointerId)) cvs.releasePointerCapture(e.pointerId);
    };
    const surDoubleClic = (): void => {
      const b = bornesRef.current;
      if (b === null) return;
      setDomaine({ ...b });
      onGesteRef.current?.();
    };

    cvs.addEventListener("wheel", surMolette, { passive: false });
    cvs.addEventListener("pointerdown", surPointerDown);
    cvs.addEventListener("pointermove", surPointerMove);
    cvs.addEventListener("pointerup", surPointerFin);
    cvs.addEventListener("pointercancel", surPointerFin);
    cvs.addEventListener("dblclick", surDoubleClic);
    return () => {
      cvs.removeEventListener("wheel", surMolette);
      cvs.removeEventListener("pointerdown", surPointerDown);
      cvs.removeEventListener("pointermove", surPointerMove);
      cvs.removeEventListener("pointerup", surPointerFin);
      cvs.removeEventListener("pointercancel", surPointerFin);
      cvs.removeEventListener("dblclick", surDoubleClic);
    };
  }, [actif]);

  return { refCanvas, domaine, setDomaine };
}
