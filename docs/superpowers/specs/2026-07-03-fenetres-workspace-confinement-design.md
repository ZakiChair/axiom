# Confinement des fenêtres flottantes à la zone de travail — design

**Date :** 2026-07-03. **Statut :** approuvé, en attente de plan d'implémentation.

## Contexte et motivation

Le gestionnaire de fenêtres flottantes (`store/windowManager.ts` + `components/FloatingWindow.tsx`) positionne, redimensionne et recale toutes les fenêtres (drag, resize, snap façon Aero, recalage auto au resize navigateur) en utilisant `window.innerWidth`/`window.innerHeight` comme référentiel — c'est-à-dire la fenêtre **du navigateur**, pas la zone de travail **de l'application**.

AXIOM a pourtant son propre chrome autour du graphe : une barre d'outils en haut (`Toolbar`, masquée en plein écran), une barre d'outils de dessin verticale à gauche (`DrawingToolbar`, masquée en plein écran) et un panneau latéral droit de largeur fixe (`aside w-60`, masqué en plein écran) contenant Watchlist/Alertes/Masse monétaire/Comparer/Santé. Les fenêtres flottantes, en `position: fixed` avec un z-index élevé, peuvent aujourd'hui se positionner par-dessus ce chrome — constaté en direct : la poignée de resize de la fenêtre RATE recouvrait le bouton « Fonctions » de la toolbar, le rendant inutilisable sans contournement.

Demande utilisateur : les fenêtres doivent être modulables **au sein de l'application** (la zone de graphe), pas de la fenêtre du navigateur. Confinement choisi : **strict** — une fenêtre ne peut plus du tout chevaucher la toolbar ou le panneau latéral, même partiellement pendant un drag.

## Décision d'architecture

La zone de travail (« workspace ») est mesurée directement sur le conteneur du graphe (`<div class="min-w-0 flex-1"><ChartGrid /></div>` dans `App.tsx`) via `getBoundingClientRect()` — ce div exclut déjà naturellement la toolbar, la barre de dessin ET le panneau latéral, comme conséquence directe de la disposition flex existante (aucun calcul manuel d'offsets à maintenir). En plein écran, ces trois éléments de chrome sont démontés (`{!plein && ...}`), donc ce même div occupe alors tout le viewport — le workspace redevient naturellement le plein écran, sans cas particulier à coder.

Un seul `ResizeObserver` sur ce div remplace l'actuel listener `window.addEventListener("resize", ...)` : il capture non seulement le redimensionnement du navigateur, mais aussi le basculement plein écran et tout futur changement de disposition (panneau replié, etc.) — un seul point d'entrée au lieu d'un listener par déclencheur.

## Modèle de données

```ts
export interface WorkspaceRect {
  x: number; y: number; width: number; height: number;
}
```

`windowManagerStore` gagne un champ `workspace: WorkspaceRect` (état, jamais persisté — comme `dragPreview`) et une action `setWorkspace(rect)` qui met à jour l'état ET recale immédiatement toutes les fenêtres ouvertes contre le nouveau rect (fusionne ce qui était deux préoccupations séparées — suivre le viewport, recaler au changement — en une seule action cohérente).

Valeur initiale (avant la première mesure du `ResizeObserver`, ex. en test) : `{ x: 0, y: 0, width: 1920, height: 1080 }` — un défaut raisonnable, jamais lu tel quel côté navigateur (écrasé dès le premier montage), et qui ne lit pas `window.*` au chargement du module (cohérent avec le reste du fichier, qui n'exécute aucune lecture de `window` en dehors des actions).

## Fonctions géométriques — nouvelles signatures

Les 5 fonctions pures existantes remplacent leurs paramètres `viewportWidth`/`viewportHeight` par un unique `workspace: WorkspaceRect` :

- **`cascadePosition(index, workspace, width, height)`** — cascade désormais ancrée à `workspace.x`/`workspace.y` (plus 0/0).
- **`clampPosition(x, y, width, height, workspace)`** — **confinement strict** sur les deux axes : `x ∈ [workspace.x, workspace.x + workspace.width - width]`, même chose en y. Gagne le paramètre `height` (absent avant : l'ancienne règle « 40px visibles minimum » ne dépendait pas de la hauteur de la fenêtre ; le confinement total, si). La constante `VISIBLE_MARGIN` (40px, partiellement-visible) devient obsolète et est retirée — plus de notion de « à moitié hors champ », une fenêtre est toujours 100% dans le workspace.
- **`clampSize(width, height, minWidth, minHeight, workspace)`** — largeur/hauteur plafonnées à `workspace.width`/`workspace.height` (au lieu de `viewportWidth`/`viewportHeight`). Comportement de repli inchangé si le workspace est plus petit que `MIN_WIDTH`/`MIN_HEIGHT` (le plafond l'emporte, comme aujourd'hui).
- **`detectSnapZone(cursorX, cursorY, workspace)`** — bords testés relatifs à `workspace.x/y/width/height` au lieu de `0/0/viewportWidth/viewportHeight`.
- **`snapGeometry(zone, workspace)`** — « gauche »/« droite » = moitié du workspace (pas du viewport) ; « haut » = workspace entier (maximise dans la zone de travail, ne recouvre jamais la toolbar/le panneau).

## Points d'appel à migrer

- **`windowManagerStore.openWindow`** — lit `get().workspace` au lieu de `window.innerWidth/innerHeight` pour la position en cascade initiale.
- **`windowManagerStore.reclampAll(workspace)`** — signature simplifiée à un seul paramètre rect ; `setWorkspace` l'appelle en interne.
- **`FloatingWindow.tsx`** (`demarrerDrag`, `demarrerResize`) — lisent `windowManagerStore.getState().workspace` au lieu de `window.innerWidth/window.innerHeight`.
- **`App.tsx`** — le `useEffect` du listener `resize` est remplacé par un `useEffect` posant un `ResizeObserver` sur le div conteneur du `ChartGrid` (nécessite un `ref` sur ce div, actuellement anonyme) ; mesure initiale au montage + à chaque callback de l'observer, débounce ~150ms conservé (même esprit que l'ancien listener, pour éviter un flot de `set()` pendant un redimensionnement continu).

## Tests

Les tests existants des 5 fonctions géométriques (`windowManager.test.ts`) doivent être **réécrits** pour les nouvelles signatures (paramètre unique `workspace` au lieu de deux nombres, `clampPosition` gagnant `height`) — attendu, pas un effet de bord accidentel. Nouveaux cas à couvrir : confinement strict aux 4 bords (une position/taille qui dépasserait doit revenir exactement à l'intérieur du rect, plus aucun dépassement autorisé) ; workspace à origine non nulle (x/y > 0, pour vérifier qu'aucun calcul ne suppose implicitement une origine à 0/0) ; `setWorkspace` recale bien les fenêtres existantes.

`FloatingWindow.tsx`/`App.tsx` restent sans test automatisé (composants, convention du repo) — vérification manuelle navigateur : confirmer qu'aucune fenêtre ne peut plus chevaucher la toolbar ou le panneau latéral (drag vers chaque bord, snap vers chaque bord, resize navigateur, bascule plein écran).

## Hors scope

- Panneau latéral repliable/redimensionnable (n'existe pas aujourd'hui — le workspace s'adapterait automatiquement le jour où ça existe, sans changement de ce design).
- Snap sur les coins/quarts d'écran (déjà hors scope du lot précédent, inchangé).
