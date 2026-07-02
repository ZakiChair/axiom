# Gestionnaire de fenêtres AXIOM — design

**Date :** 2026-07-02. **Statut :** approuvé, en attente de plan d'implémentation.

## Contexte et motivation

AXIOM compte aujourd'hui 13 fenêtres non modales (« Bloomberg ») — ECO, NEWS, CORR, CHAIN, IMAP, PORT, NOTE, EQS, TERM, OMON, Produits dérivés, DOM, Backtest, Replay — qui partagent **un seul emplacement docké à droite** (`fixed right-0 top-0 z-40`, largeur fixe par fenêtre) avec **exclusion mutuelle** : ouvrir l'une ferme automatiquement les autres (mécanisme `PANNEAUX_DROITE` dans `App.tsx`). Aucune ne peut être déplacée, redimensionnée, ni tenue ouverte en même temps qu'une autre.

Les indicateurs sur le chart (RSI, MACD, EMA…) sont proprement modélisés en instances (`instanceId`/`paneId`, `store/indicators.ts`) mais la seule façon de retirer une instance est le menu Indicateurs → trouver l'instance → bouton « Retirer ». Pas de fermeture directe depuis le pane, pas de réordonnancement.

Objectif : un vrai gestionnaire de fenêtres façon Bloomberg Launchpad — fenêtres flottantes libres, plusieurs ouvertes simultanément, groupes liés par couleur — et des panes d'indicateurs directement manipulables (croix de fermeture, drag pour réordonner), sans passer par un menu.

## Décisions validées avec l'utilisateur

1. **Ambition** : Launchpad complet — fenêtres flottantes (drag n'importe où, redimensionnables par les bords), plusieurs ouvertes en même temps, chevauchement géré par z-index au clic.
2. **Groupes liés (color-linking)** : inclus dès cette v1 (pas reporté).
3. **Panes d'indicateurs** : croix de fermeture directe + poignée de drag pour réordonner (pas d'édition de paramètres inline dans ce lot — reste au menu Indicateurs).

## Vérifications techniques faites (KLineChart v9.8, via context7)

- `setPaneOptions({ id, height, minHeight, dragEnabled, order, state })` : redimensionnement de hauteur, ordre d'empilement et un `state: 'minimize'|'maximize'|'normal'` sont **natifs**. Pas de travail à refaire pour le resize/l'ordre des panes — juste s'assurer que `dragEnabled: true` est bien passé à la création.
- `getSize(paneId, position?)` renvoie un `Bounding` (position/taille) par pane — utilisable pour positionner un en-tête overlay DOM au bon endroit.
- `subscribeAction('onPaneDrag', cb)` existe nativement — permet de recalculer la position de l'overlay après un redimensionnement manuel de pane par l'utilisateur.
- Aucune API native pour un en-tête de pane avec bouton de fermeture visible : nécessite un overlay DOM maison (pas de nouvelle dépendance).

## Architecture

### Store central : `store/windowManager.ts` (nouveau)

Source de vérité unique pour l'état de TOUTES les fenêtres flottantes (les 13 existantes + futures) :

```ts
interface FenetreFlottante {
  id: string;              // même id que le store métier existant ("eco", "news", …)
  x: number; y: number;    // position en px (viewport)
  width: number; height: number;
  z: number;                // ordre d'empilement
  minimized: boolean;
  groupColor: string | null; // couleur de liaison (palette fixe de 6, tokens de thème)
}
```

Actions : `openWindow(id)`, `closeWindow(id)`, `focusWindow(id)` (bump z au sommet), `moveWindow(id, x, y)`, `resizeWindow(id, w, h)`, `minimizeWindow(id)`, `restoreWindow(id)`, `setGroup(id, color | null)`, `setGroupSymbol(color, symbole)` (propage aux fenêtres/slots du même groupe).

**Migration des 13 stores métier existants** (`ecoStore`, `newsUiStore`, `derivativesUiStore`, etc.) : chacun perd son booléen `open` propre et ses fonctions `openX()/closeX()` deviennent de fines délégations vers `windowManagerStore` (`openWindow('eco')`). Les commandes de palette existantes (`ecoCommands`, etc.) n'ont pas besoin de changer de signature. Le mécanisme `PANNEAUX_DROITE` dans `App.tsx` est **supprimé** (obsolète — remplacé par le z-order du store central).

### Composant chrome : `components/FloatingWindow.tsx` (nouveau)

Enveloppe générique montée une fois par fenêtre dans `App.tsx`, autour du contenu de chacun des 13 composants `*Window.tsx` existants :

- En-tête : titre + mnémonique, pastille de couleur de groupe (clic → mini-palette de 6 couleurs), bouton minimiser, croix de fermeture.
- Zone de drag = l'en-tête entier (pointer events maison — `pointerdown/move/up`, pas de nouvelle dépendance).
- 8 poignées de redimensionnement (4 bords + 4 coins), taille minimale par fenêtre (ex. 320×240).
- Clamping viewport : au moins ~40px de l'en-tête reste toujours visible à l'écran (utile après resize de la fenêtre navigateur).
- Clic n'importe où sur la fenêtre → `focusWindow(id)` (passe devant).
- Si `minimized: true` : la fenêtre disparaît du canvas principal, une pastille apparaît dans `components/TaskbarMinimized.tsx` (barre en bas d'écran, mnémonique + titre, clic = restore).

**Migration des 13 fenêtres existantes** : chacune perd son `<div className="fixed right-0 top-0 ...">` externe et ses boutons fermer/dimension internes ; le contenu (en-tête métier spécifique + corps) est monté comme enfant de `<FloatingWindow id="eco" title="Calendrier économique" mnemonic="ECO">`. Modification mécanique par fichier, la logique interne de chaque fenêtre (fetch, affichage, filtres) reste inchangée.

### Groupes liés — portée précise

Toutes les fenêtres n'ont pas un « symbole actif » propre à propager : ECO/NEWS/MAP sont globales ou génériques, PORT est intrinsèquement multi-positions. La propagation de symbole par groupe s'applique concrètement à :

- **Les slots de la grille multi-chart** (`store/chart-layout.ts`) — le binaire `linked: boolean` actuel devient `groupColor: string | null`. Migration douce : `linked: true` → couleur par défaut du groupe 1, `linked: false` → `null`.
- **Produits dérivés** (`DerivativesWindow`) — suit aujourd'hui le symbole global du chart ; gagne un symbole indépendant qui suit son groupe s'il en a un, sinon reste sur le symbole global comme aujourd'hui.

Les autres fenêtres peuvent recevoir une couleur de groupe pour l'organisation visuelle (regroupement à l'écran), sans effet de propagation de symbole dans ce lot. Cette portée pourra être élargie fenêtre par fenêtre dans un lot ultérieur si l'usage le justifie.

### Panes d'indicateurs sur le chart

`chart/paneHeaders.tsx` (nouveau) : overlay DOM léger, un en-tête par pane séparé (RSI, MACD, tout indicateur avec `pane !== "overlay"`), positionné via `chart.getSize(paneId)`, recalculé sur `onPaneDrag` et sur resize de fenêtre/changement de layout.

- Libellé de l'instance (« RSI (14) »), poignée de drag (réordonne : la position de drop parmi les panes actuels détermine les nouveaux `order` envoyés via `setPaneOptions`), croix (appelle `indicatorsStore.removeInstance(instanceId)` directement).
- Redimensionnement de hauteur : natif KLineChart, juste vérifier que `dragEnabled: true` est bien passé dans `chart/indicators.ts` à la création du pane.
- Les indicateurs en overlay (EMA sur les bougies, même pane que les bougies) n'ont pas de pane séparé à eux → pas de croix flottante pertinente, restent gérés depuis le menu Indicateurs (déjà rapide via la section « Actifs »).
- Bonus quasi gratuit : bouton « réduire » à côté de la croix, utilisant `state: 'minimize'` natif.

### Persistance

`windowManagerStore` rejoint le dual-write existant de `persist.ts` (localStorage + daemon si présent — même mécanisme que le reste de l'état UI). `store/workspaces.ts` inclut désormais dans son snapshot : géométrie + groupes des fenêtres flottantes, et l'ordre des panes d'indicateurs.

Migration douce au premier chargement post-mise à jour : les anciennes clés localStorage (juste un booléen `open` par fenêtre) sont lues une fois pour initialiser `windowManagerStore` avec des positions par défaut **en cascade** (éviter que 13 fenêtres apparaissent empilées exactement au même endroit), puis la nouvelle clé prend le relais.

## Fichiers touchés (vue d'ensemble)

**Nouveaux** : `store/windowManager.ts` (+test), `components/FloatingWindow.tsx` (+test logique pure : clamping, calcul de z, calcul d'ordre de drop), `components/TaskbarMinimized.tsx`, `chart/paneHeaders.tsx` (+test position/reorder pure).

**Modifiés (mécanique)** : les 13 `components/*Window.tsx` (retrait du wrapper de positionnement externe), `App.tsx` (bloc `PANNEAUX_DROITE` remplacé par boucle générique de montage + `<TaskbarMinimized/>`), les 13 stores `*UiStore` (délégation `open`/`close` vers `windowManagerStore`), `store/chart-layout.ts` (`linked` binaire → `groupColor`), `store/persist.ts` + `store/workspaces.ts` (inclure le nouvel état), `chart/indicators.ts` (`dragEnabled: true` si absent, exposer un accès pour `paneHeaders.tsx`).

**Aucun changement daemon/backend** — chantier 100% front, s'appuie sur la persistance existante.

## Hors périmètre de ce lot (explicite)

- Snapping/tiling magnétique entre fenêtres (alignement bord à bord automatique).
- Fenêtres à cheval sur plusieurs écrans/moniteurs (le window manager reste par fenêtre-navigateur ; BroadcastChannel existant inchangé).
- Édition de paramètres d'indicateur inline depuis le pane (reste au menu Indicateurs).
- Élargissement des groupes liés à d'autres fenêtres que Dérivés + slots de grille (à réévaluer après usage réel).

## Risques

- **Blast radius de la migration des 13 fenêtres** : mécanique mais touche beaucoup de fichiers — risque de régression visuelle sur une fenêtre oubliée. Mitigation : vérification manuelle systématique (Chrome DevTools MCP) de chacune des 13 après migration, pas seulement d'un échantillon.
- **Positionnement de l'overlay de pane** dépend de `getSize`/`onPaneDrag` — à valider empiriquement que la position reste synchronisée après un changement de layout de grille multi-chart (plusieurs instances KLineChart).
- Aucun risque de performance attendu : tout ce chantier est DOM (drag/resize de fenêtres, overlay de pane recalculé sur événements discrets, pas à chaque tick) — le rendu chart haute fréquence n'est pas touché.

## Tests

- `windowManagerStore` : clamping viewport, calcul de z au focus, calcul du nouvel ordre à partir d'une position de drop, assignation/retrait de groupe, propagation de symbole de groupe.
- `paneHeaders` : calcul de position depuis un `Bounding` simulé, calcul du nouvel `order` à partir d'une position de drop parmi N panes.
- Pas de test E2E automatisé dans ce lot (cohérent avec le reste du projet) — vérification manuelle via Chrome DevTools MCP en fin de plan (comme les phases précédentes de la roadmap).
