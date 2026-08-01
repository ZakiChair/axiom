/**
 * Contrôles communs aux deux légendes du graphe : celle des overlays sur le pane prix
 * (`overlayLegend.ts`) et les en-têtes de panes séparés (`paneHeaders.tsx`).
 *
 * Les deux surfaces avaient dérivé : une pile de croix ✕ ANONYMES à droite du pane prix
 * (trois EMA actives = trois croix identiques, le nom seulement dans un `title`), et
 * ⠿ + ✕ pour les panes. Aucune des deux ne portait la couleur de l'indicateur ni un
 * accès à ses réglages — il fallait passer par le menu latéral (revue du 2026-08-01
 * § 3.2 et § 5.1). Ce module fabrique les trois éléments partagés : pastille de
 * couleur d'instance, bouton de réglages, bouton de fermeture.
 *
 * La pastille est peinte avec `var(--serie-N)` et NON avec la valeur résolue : le
 * moteur CSS re-résout la variable à chaque changement de thème, sans qu'aucun code
 * n'ait à repeindre (contrairement au canvas, où `lireTokenCanvas` est obligatoire).
 */
import { NB_COULEURS_SERIE } from "../store/indicators";

/** Taille des cibles de clic (px) — au-dessus des ~14 px précédents (loi de Fitts). */
const CIBLE = "min-h-[18px] min-w-[18px]";

/**
 * Nom de la variable CSS de série pour un index 0-based, replié dans la bande.
 * PURE — le modulo positif évite `--serie-0` et `--serie-NaN` sur un état douteux.
 */
export function varSerie(couleurIdx: number): string {
  const n = Number.isFinite(couleurIdx) ? Math.trunc(couleurIdx) : 0;
  return `var(--serie-${(((n % NB_COULEURS_SERIE) + NB_COULEURS_SERIE) % NB_COULEURS_SERIE) + 1})`;
}

/**
 * Pastille de couleur d'une instance. `aria-hidden` : elle double une information déjà
 * portée par le libellé textuel voisin — l'identité ne repose jamais sur la couleur seule.
 */
export function creerPastille(couleurIdx: number): HTMLSpanElement {
  const p = document.createElement("span");
  p.setAttribute("data-role", "pastille");
  p.setAttribute("aria-hidden", "true");
  p.className = "inline-block h-2 w-2 flex-none rounded-[1px]";
  p.style.backgroundColor = varSerie(couleurIdx);
  return p;
}

/** Met à jour la pastille d'un élément de légende (réallocation de couleur). */
export function majPastille(parent: HTMLElement, couleurIdx: number): void {
  const p = parent.querySelector<HTMLSpanElement>("[data-role=pastille]");
  if (p) p.style.backgroundColor = varSerie(couleurIdx);
}

/** Libellé de l'instance, tronqué — porte le NOM, que la couleur ne peut pas porter. */
export function creerLibelle(label: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.setAttribute("data-role", "label");
  s.className = "max-w-[150px] truncate";
  s.textContent = label;
  return s;
}

/** Met à jour le libellé d'un élément de légende (édition des params). */
export function majLibelle(parent: HTMLElement, label: string): void {
  const s = parent.querySelector<HTMLSpanElement>("[data-role=label]");
  if (s) s.textContent = label;
}

/**
 * Étiquette d'un bouton de légende. PURE — c'est la seule partie de ce module qui porte
 * une décision (nommer la cible plutôt que laisser une croix anonyme), donc la seule
 * qu'un test peut utilement verrouiller dans un environnement sans DOM.
 */
export function etiquetteBouton(role: "settings" | "close", label: string): string {
  return `${role === "settings" ? "Réglages de" : "Fermer"} ${label}`;
}

/** Fabrique commune aux deux boutons d'action d'une ligne de légende. */
function creerBouton(
  role: "settings" | "close",
  glyphe: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = glyphe;
  b.type = "button";
  b.setAttribute("data-role", role);
  b.setAttribute("aria-label", etiquetteBouton(role, label));
  b.title = etiquetteBouton(role, label);
  b.className = `${CIBLE} rounded leading-none text-text-dim hover:text-text`;
  b.addEventListener("click", onClick);
  return b;
}

/** Bouton « réglages » (⚙) : ouvre le menu Indicateurs déplié sur CETTE instance. */
export function creerBoutonReglages(label: string, onClick: () => void): HTMLButtonElement {
  return creerBouton("settings", "⚙", label, onClick);
}

/** Bouton « fermer » (✕) de l'instance. */
export function creerBoutonFermer(label: string, onClick: () => void): HTMLButtonElement {
  return creerBouton("close", "✕", label, onClick);
}

/** Réétiquette les boutons d'un élément de légende après édition des params. */
export function majEtiquettes(parent: HTMLElement, label: string): void {
  for (const role of ["settings", "close"] as const) {
    const b = parent.querySelector<HTMLButtonElement>(`[data-role=${role}]`);
    if (b) {
      b.setAttribute("aria-label", etiquetteBouton(role, label));
      b.title = etiquetteBouton(role, label);
    }
  }
}
