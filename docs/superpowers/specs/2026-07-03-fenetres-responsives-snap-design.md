# Fenêtres responsives + snap façon Aero — design

**Date :** 2026-07-03. **Statut :** approuvé, en attente de plan d'implémentation.

## Contexte et motivation

Le gestionnaire de fenêtres flottantes (`store/windowManager.ts` + `components/FloatingWindow.tsx`, livré le 2026-07-02) gère drag/resize/minimize/z-order/groupes-couleur pour les 14 fenêtres Bloomberg. Deux lacunes identifiées :

1. **Pas de réaction au redimensionnement du navigateur.** `clampPosition`/`clampSize` (fonctions pures existantes) ne sont appelées QUE pendant un drag/resize actif de l'utilisateur — jamais quand c'est la fenêtre du **navigateur** qui change de taille. Rétrécir le navigateur peut laisser des fenêtres hors-écran ou plus grandes que le viewport, sans aucune correction jusqu'au prochain drag manuel.
2. **Poignées de resize trop fines** (`w-1.5`/`h-1.5`, 6px) — difficiles à attraper précisément.

Demande utilisateur : rendre les fenêtres « responsives et agréables à manipuler ». Décisions prises en clarification :
- Recalage auto au resize navigateur : **oui**.
- Poignées de resize élargies : **oui**.
- Snap façon Windows Aero (glisser vers un bord) : **oui, bords uniquement** (moitié gauche/droite + plein écran en haut) — les coins/quarts d'écran sont explicitement **hors scope** de ce lot (extension future si l'usage le justifie).
- Maximiser au double-clic sur l'en-tête : **explicitement écarté** par l'utilisateur. Le snap vers le bord haut (= plein écran) fait néanmoins partie du mécanisme Aero standard et reste inclus — c'est un geste de *drag*, pas un double-clic.

## Architecture

### 1. Recalage auto (`store/windowManager.ts`)

Nouvelle action pure sur le store, réutilisant `clampPosition`/`clampSize` déjà testés :

```ts
reclampAll: (viewportWidth: number, viewportHeight: number) => void;
```

Itère `windows`, applique le clamp existant à chaque fenêtre ouverte, `set()` en un seul batch. Aucune nouvelle fonction géométrique — juste un nouveau point d'appel.

**Déclenchement :** un `useEffect` monté une fois dans `App.tsx` (à côté du montage existant des 14 `<FloatingWindow>`) pose `window.addEventListener("resize", ...)`, débouncé (~100-150ms via un `setTimeout` réarmé, pattern déjà utilisé ailleurs dans le repo pour les listeners haute-fréquence) pour éviter un flot de `set()` pendant un redimensionnement continu (drag de bordure du navigateur).

### 2. Poignées de resize élargies (`components/FloatingWindow.tsx`)

Les classes Tailwind des 8 poignées (`POIGNEES`) passent d'une largeur de hit-zone ~6px à ~12px. Le liseré visuel (bordure/curseur) reste inchangé perceptuellement — seule la zone cliquable grandit. Pure CSS, aucune logique.

### 3. Snap façon Aero (bords uniquement)

**Détection de zone (fonction pure, testable) :**

```ts
type SnapZone = "left" | "right" | "top" | null;

function detectSnapZone(
  cursorX: number, cursorY: number,
  viewportWidth: number, viewportHeight: number
): SnapZone;
```

Seuils : `cursorY < 8` → `"top"` ; `cursorX < 8` → `"left"` ; `cursorX > viewportWidth - 8` → `"right"` ; sinon `null`. Vérifiée à chaque `pointermove` pendant le drag de l'en-tête (pas pendant un resize).

**Géométrie de la zone (fonction pure, testable) :**

```ts
function snapGeometry(
  zone: Exclude<SnapZone, null>,
  viewportWidth: number, viewportHeight: number
): { x: number; y: number; width: number; height: number };
```

`"left"`/`"right"` → moitié gauche/droite pleine hauteur ; `"top"` → plein viewport (équivalent maximize).

**État éphémère du store (non persisté) :**

```ts
dragPreview: { x: number; y: number; width: number; height: number } | null;
```

`persist.ts` construit déjà explicitement le sous-ensemble de champs sauvegardés (`WINDOW_MANAGER_KEY`, cf. fonction existante « Construit l'état persistable du gestionnaire de fenêtres ») — `dragPreview` n'a donc rien à exclure spécifiquement, il suffit de ne pas l'ajouter à cette fonction.

**Flux d'interaction (`demarrerDrag` dans `FloatingWindow.tsx`) :**
- À chaque `pointermove`, en plus du déplacement libre existant, appelle `detectSnapZone`. Si une zone est active, calcule `snapGeometry` et pousse le résultat dans `windowManagerStore.dragPreview` (remplace, ne s'accumule pas).
- Un nouveau composant `SnapOverlay` (monté une fois dans `App.tsx`, au-dessus de toutes les fenêtres) lit `dragPreview` et affiche un rectangle semi-transparent à cet emplacement — rendu centralisé plutôt que dans `FloatingWindow` lui-même, pour garantir le bon z-index quelle que soit la fenêtre en cours de drag.
- Au `pointerup` (`onUp`) : si `dragPreview` est non-null, appelle `moveWindow` + `resizeWindow` avec sa géométrie (au lieu de la position libre du drag) ; sinon comportement actuel inchangé. Dans tous les cas, `dragPreview` repasse à `null`.

**Persistance :** le snap appelle les mêmes actions `moveWindow`/`resizeWindow` qu'un déplacement libre → persisté automatiquement via le mécanisme dual-write existant (localStorage + daemon), sans code supplémentaire.

## Tests

- Fonctions pures (`reclampAll`, `detectSnapZone`, `snapGeometry`) testées unitairement sans DOM, même pattern que `windowManager.test.ts` existant (`cascadePosition`, `clampPosition`, `clampSize`).
- Vérification manuelle navigateur : rétrécir la fenêtre avec des panneaux ouverts près des bords → confirmer le recalage ; glisser un panneau vers chaque bord → confirmer l'aperçu + le snap au relâchement ; attraper une poignée de resize à plusieurs niveaux de zoom → confirmer une prise plus facile.

## Hors scope (ce lot)

- Snap sur les coins / quarts d'écran.
- Maximiser au double-clic sur l'en-tête.
- Support tactile dédié (les pointer events existants couvrent déjà mouse/touch/pen nativement, aucun changement nécessaire pour ce lot).
