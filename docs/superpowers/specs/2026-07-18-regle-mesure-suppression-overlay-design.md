# Règle de mesure découvrable + suppression rapide des indicateurs overlay — design

Date : 2026-07-18. Base : `apps/web/src/chart/measureTool.ts` (Shift+glisser, non commité,
développé la veille) + `apps/web/src/chart/paneHeaders.tsx` (pattern croix de suppression
pour panes séparés RSI/MACD).

## 1. Problème

Deux frictions distinctes sur le graphe prix :

1. **Outil de mesure invisible.** `MeasureTool` (règle % / Δ prix / bougies / durée) marche
   déjà en Shift+glisser, mais n'a AUCUNE entrée dans `DrawingToolbar.tsx` : personne ne peut
   le découvrir sans connaître le raccourci.
2. **VWAP non supprimable depuis le graphe.** Le VWAP ancré (AVWAP) et les autres indicateurs
   « overlay » (EMA, BOLL…) sont des instances de `indicatorsStore`, pas des dessins
   (`createOverlay`). Ils échappent donc au clic droit / Suppr / « Effacer tout » qui
   fonctionnent déjà pour les dessins classiques (droites, rectangles, Fibonacci — RAS de ce
   côté, confirmé par lecture de `drawing.ts` : `onRightClick` + `deleteSelectedDrawing`).
   Seule voie actuelle : menu Indicateurs → section « Actifs » → croix.

**Décisions de cadrage (validées avec l'utilisateur)** :
- Bouton « Règle » dans la barre de dessin, mode **armé répétable** (clic-glisser sans Shift
  tant que l'outil reste sélectionné) ; Shift+glisser continue de marcher en parallèle, quel
  que soit l'outil actif.
- Suppression VWAP/EMA/BOLL via une **légende empilée en haut-droite du pane prix**
  (extension du pattern `PaneHeaders` déjà utilisé pour RSI/MACD), pas de hit-testing clic
  droit sur la ligne elle-même (klinecharts ne fournit pas d'événements de clic sur les
  figures d'indicateur — trop fragile).
- Dessins classiques : aucun changement, le comportement existant est correct.

## 2. Outil « Règle de mesure »

### `apps/web/src/chart/drawing.ts`
- Ajouter `"measure"` à `DrawingToolId`.
- `TOOL_OVERLAY.measure = null` (comme `avwapAnchor` : pas d'overlay `createOverlay` créé).
- `selectTool("measure")` : AUCUN branchement supplémentaire requis. `selectTool` met déjà
  `drawingStore` à jour en première ligne, puis la garde existante
  `if (name === null || activeChart === null) return;` sort avant tout `createOverlay` dès
  que `TOOL_OVERLAY[tool]` vaut `null` — `"measure"` en bénéficie automatiquement une fois
  ajouté à la table, sans avoir besoin d'un `if` dédié comme `avwapAnchor` (qui, lui, doit
  déclencher `startAvwapAnchor`).

### `apps/web/src/chart/measureTool.ts`
- Importer `drawingStore` depuis `./drawing`.
- `onMouseDown` : déclenche une mesure si `e.shiftKey` (inchangé) **OU**
  `drawingStore.getState().tool === "measure"` (nouveau). Retirer la garde
  `if (!e.shiftKey ...) return` au profit de
  `if (!(e.shiftKey || arme) || e.button !== 0) return`.
- `DragEnCours` gagne un champ `viaToolbar: boolean` (true si déclenché par le mode armé,
  false si Shift). Sert à décider si le drag doit être annulé quand l'outil change en cours
  de route.
- Nouvel abonnement `drawingStore.subscribe` dans le constructeur : si le tool courant devient
  différent de `"measure"` ET qu'un drag `viaToolbar` est en cours, appeler `annuler()`.
  Un Shift-drag en cours (viaToolbar=false) n'est jamais affecté par ce changement de tool
  (il ne dépend pas du store).
- Comportement répétable : `annuler()` (appelé sur `mouseup`) efface juste le rectangle/label
  — il ne touche PAS `drawingStore` (contrairement à `onDrawEnd` des vrais dessins qui repasse
  au curseur). Le mode armé reste donc actif pour la mesure suivante.
- `dispose()` : désabonner le store en plus du nettoyage DOM existant.

### `apps/web/src/components/DrawingToolbar.tsx`
- Nouvelle icône `RulerIcon` (même convention `ICON_PROPS`, trait fin 24×24).
- Nouvelle entrée dans `TOOLS`, juste après `"cursor"` :
  `{ id: "measure", label: "Règle de mesure — clic-glisser (raccourci : Shift+glisser)", Icon: RulerIcon }`.
  Placée en 2e position (avant les outils de tracé) : conceptuellement un mode d'interaction
  transitoire comme le curseur, pas un dessin persistant.

## 3. Suppression rapide des indicateurs overlay (VWAP/EMA/BOLL…)

### `apps/web/src/chart/overlayLegend.ts` (nouveau fichier)
Contrôleur impératif, même pattern que `PaneHeaders` (`constructor(chart, container) → sync()
→ dispose()`), mais SANS poignée de drag (l'ordre des indicateurs overlay n'a pas d'utilité
fonctionnelle, contrairement aux panes séparés empilables verticalement en hauteur).

- `overlayIndicators()` : filtre `indicatorsStore.getState().indicators` sur
  `def.pane === "overlay"` (miroir exact de `panesSepares()` dans `paneHeaders.tsx`, qui
  filtre l'inverse). Renvoie `{ instanceId, label }[]`.
- `sync()` : réconcilie un `Map<instanceId, HTMLDivElement>` comme `PaneHeaders.sync()`.
  Chaque élément = juste une croix ✕ (bouton), `aria-label="Fermer {label}"`,
  `onClick → indicatorsStore.getState().remove(instanceId)`.
- Positionnement (`repositionnerTout`) : TOUTES les entrées partagent `CANDLE_PANE_ID`
  (contrairement à `panesSepares()` où chaque pane a son propre id/bounding). Un seul
  `chart.getSize(CANDLE_PANE_ID, DomPosition.Main)`, puis empilement vertical :
  `top = main.top + 2 + index * ROW_HEIGHT`, `left = main.left + main.width -
  el.offsetWidth - 4` (même convention haut-droite que `PaneHeaders`, pour ne pas chevaucher
  la légende native nom+valeur en haut-gauche de klinecharts). `ROW_HEIGHT = 20` (px, à
  ajuster visuellement).
- Repositionné sur les mêmes événements que `PaneHeaders` (`OnPaneDrag`, `OnDataReady`) —
  candle_pane peut changer de hauteur (grid layout, resize pane).
- `dispose()` : désabonne les actions, retire les éléments DOM.

### `apps/web/src/chart/ChartInstance.tsx`
- Instancier `OverlayLegend` juste après `PaneHeaders` (même slot de montage, ligne ~340).
- `overlayLegend.sync()` appelé sur le même abonnement `indicatorsStore.subscribe` que
  `paneHeaders.sync()` (ligne ~343) — un seul callback appelle les deux `sync()`.
- `dispose()` de `OverlayLegend` dans le même cleanup que `PaneHeaders`.

## 4. Tests

- `measureTool.test.ts` : cas mode armé (mousedown sans Shift avec `tool==="measure"`
  déclenche une mesure), cas annulation propre au changement d'outil pendant un drag
  `viaToolbar`, cas non-régression (Shift-drag toujours actif avec un autre tool sélectionné,
  jamais annulé par un changement de tool).
- `drawing.test.ts` : ajouter `"measure"` aux cas `TOOL_OVERLAY`/`selectTool` — vérifier
  qu'aucun `createOverlay` n'est déclenché.
- `overlayLegend.test.ts` (nouveau) : `overlayIndicators()` filtre bien `def.pane==="overlay"`
  vs séparé ; `sync()` crée/retire les bons éléments ; clic croix appelle `remove(instanceId)`.

## 5. Hors périmètre

- Dessins classiques (droites, rectangles, Fibonacci, VPFR…) : suppression déjà correcte,
  aucune modification.
- Réordonnancement des indicateurs overlay : pas de besoin fonctionnel identifié, pas de
  poignée de drag sur `OverlayLegend`.
- Persistance du mode armé entre rechargements : non demandé, `drawingStore.tool` repart
  déjà à `"cursor"` par défaut comme tous les autres outils.
