# Revue design & ergonomie d'AXIOM — 1er août 2026

**Question posée** : comment designer AXIOM pour faciliter son ergonomie et améliorer la
lisibilité des indicateurs et des stratégies sur le graphique ?

**Méthode** : 14 agents de revue (6 cartographies du code + 6 critiques par axe + parcours
utilisateur + audit visuel), captures de l'application réelle en fonctionnement (thèmes `cute`
et `dark`), lecture du bundle `klinecharts@9.8.12` installé, et validation calculée des cinq
palettes de série avec le validateur OKLab du kit dataviz. Chaque constat de ce document a été
revérifié dans le code source ; les affirmations non vérifiables sont signalées comme telles.

---

## 1. Le verdict en une page

AXIOM calcule remarquablement et **donne à lire médiocrement**. C'est un déséquilibre net entre
deux moitiés du produit :

- Le moteur est mûr : 179 indicateurs au registre — dont 152 exposés au catalogue —, 27 stratégies,
  un régime composite à 8 composants, un backtest honnête (exécution à l'open+1, frais et slippage
  inclus), des référentiels percentiles, un vocabulaire épistémique complet (`BadgeFiabilite`,
  `RefBadge`, `NoteSource`, `Fraicheur`). 3 170 tests.
- La couche de lecture ne suit pas. **Sur le graphe — l'écran regardé 90 % du temps — un
  indicateur n'a ni couleur propre, ni nom visible, ni réglage accessible.** Le système de tokens,
  qui est bon, s'arrête au bord du canvas.

Le symptôme le plus parlant tient en une capture : sur l'écran par défaut, RSI et Connors RSI sont
tracés **dans exactement la même couleur**, leurs noms sont cachés sous le bandeau de symbole, et
un pavé bleu roi `#1677FF` — la couleur d'usine de la librairie de graphe, présente dans aucun des
cinq thèmes — recouvre les bougies au centre de l'écran.

Trois lois de design découlent de ce diagnostic. Elles structurent tout le reste du document.

> **Loi 1 — Une entité, une couleur, un nom visible.**
> Aujourd'hui la couleur suit le rang de la *sortie* dans sa définition, jamais l'entité.
>
> **Loi 2 — Le graphe est une surface de contrôle, pas seulement d'affichage.**
> Aujourd'hui régler un indicateur impose un aller-retour vers un menu latéral de 288 px.
>
> **Loi 3 — Chaque chiffre porte sa fiabilité, et il la porte visiblement.**
> C'est la signature d'AXIOM, et elle est rendue à 9 px dans le token le plus effacé du système.

---

## 2. Ce qui est déjà juste, et qu'il ne faut pas casser

Une revue qui n'énumère que des défauts fait perdre ce qui marche. Cinq acquis sont solides et
doivent servir de socle aux corrections proposées :

1. **Le vocabulaire épistémique.** `BadgeFiabilite` (fiable / partiel / estimation / indisponible),
   `RefBadge` (« p97 · 90 j »), `NoteSource`, la convention Chargement / ErreurBloc / Vide / SansCle.
   Aucun terminal concurrent ne dit à l'utilisateur à quel point il peut croire un chiffre.
2. **Le registre unique de fenêtres.** `WINDOW_REGISTRY` est la source unique du titre, du
   mnémonique et de la taille ; le menu Fonctions en dérive. Ajouter une fenêtre ne demande plus de
   toucher trois listes.
3. **Les primitives UI et leur ratchet.** `ui.tsx` et `uiConventions.test.ts` ont fait converger
   les fenêtres du terminal sur un vocabulaire unique. Le mécanisme est bon même si sa couverture a
   des trous (§ 6.4).
4. **La lecture des tokens au moment du dessin.** `lireTokensCanvas` résout les variables CSS au
   rendu, pas au montage : changer de thème repeint correctement. C'est exactement le bon pattern.
5. **L'honnêteté du moteur de backtest.** Signaux sur bougies clôturées, exécution à l'open
   suivant, frais et slippage appliqués, et un rapport de rejeu qui a produit le marquage
   « non validé ». Peu d'outils grand public sont aussi scrupuleux.

---

## 3. Les six défauts qui coûtent le plus cher

Classés par coût quotidien de lecture, pas par difficulté de correction.

### 3.1 — La palette de six couleurs n'est jamais exercée entre indicateurs

`apps/web/src/chart/indicators.ts:89` construit les figures ainsi :

```ts
const figures = def.outputs.map((o, i) => {
  const styles = () => ({ color: serieCanvas(i) });   // ← i = rang de la SORTIE
  ...
});
```

`i` est l'index de la sortie **à l'intérieur d'une définition**, jamais l'identité de l'indicateur
ni celle de l'instance. Conséquences mécaniques :

- Tout indicateur mono-sortie — RSI, Connors RSI, CCI, ROC, ATR, Supertrend… — reçoit
  `--serie-1`. Vérifié au pixel : RSI et Connors RSI sont `#c026d3` en `cute`, `#38bdf8` en `dark`.
- Deux instances d'une même définition (EMA 20 et EMA 50 sur le prix) sont **deux traits
  strictement identiques**.
- GMMA émet 12 sorties et `indexSerie` module par 6 : EMA 3 et EMA 30 sont appariées dans la même
  couleur, EMA 5 et EMA 35 aussi. Les deux faisceaux dont l'écartement *est* la lecture de
  l'indicateur sont peints avec les six mêmes couleurs, deux à deux.
- `IndicatorOutput.color` existe dans le type et n'est lu nulle part. Aucun champ de couleur par
  instance n'existe dans le store.

Six autres producteurs de séries choisissent leur token à la main, sans registre : `--serie-3`
désigne simultanément le funding, les revenus de protocole, M2, les marqueurs macro et le max pain.

### 3.2 — Les deux emplacements où le nom d'un indicateur pourrait apparaître sont couverts

Le commentaire de `ChartInstance.tsx:198-207` affirme que la légende native de klinecharts est
« la SEULE source du NOM d'indicateur, panes séparés ET overlays ». Or :

- **Ancre haut-gauche** : klinecharts dessine cette légende à `offsetLeft: 4 / offsetTop: 6`.
  `SymbolBanner` est monté dans le même conteneur en `absolute left-2 top-2 z-10` alors que le
  canvas est `absolute inset-0` sans z-index. Le bandeau gagne et couvre y≈8-34, x≈8-672. Le
  résidu « …439B » visible au centre-haut des captures est la queue d'une légende dont tout le
  début est caché.
- **Ancre haut-droite** : `OverlayLegend` pose sa première ligne à `main.top + 2` ; la barre de
  disposition `1 | 1|1 | 1—1 | 2×2 | ⛓` est `absolute right-2 top-2 z-20`. Même pixel, z supérieur.

Et cette légende de droite ne contient **que des croix ✕** : le nom n'existe que dans l'attribut
`title`. Trois EMA actives donnent trois croix identiques empilées ; cliquer la mauvaise retire la
mauvaise instance, sans annulation possible.

### 3.3 — Un pavé bleu de la librairie recouvre les bougies, dans les cinq thèmes

`applyChartTheme` passe à `setStyles` les clés `grid`, `candle`, `xAxis`, `yAxis`, `crosshair` —
et **omet `overlay`, `indicator` et `separator`**. Les défauts d'usine de klinecharts s'appliquent
donc intégralement, dont `text: { backgroundColor: '#1677FF', borderColor: '#1677FF',
family: 'Helvetica Neue' }`.

Mesuré au pixel sur les captures : `#1677ff` occupe 4 735 px en `cute` et 7 394 px en `dark`, sur
la zone centrale du graphe. Contraste du texte sur cette plaque : **1,16:1** en `cute`,
**1,95:1** en `dark` — illisible dans les deux cas. Le retracement de Fibonacci est un bloc bleu
opaque de texte bleu sur bleu, visible dans 9 des 11 captures.

Le piège est **connu et corrigé à un seul endroit** : `annotationsPrix.ts:145-152` documente
`backgroundColor: "transparent"` comme obligatoire en citant nommément `#1677FF`. La correction n'a
jamais été propagée aux huit autres figures texte : `fibonacci.ts:288`, `ecoMarkers.ts:89`,
`position.ts:197` et `:218`, `whaleBubbles.ts:213`, `volumeRangeOverlay.ts:267`,
`tradeMarkers.ts:255` et `:274`.

### 3.4 — Au-delà de cinq panes, le graphe des prix s'éteint sans un mot

**Reproduit dans le navigateur, pas seulement déduit.** Sur l'application en fonctionnement, sept
indicateurs à pane séparé ont été activés depuis le menu. Résultat mesuré dans le DOM :

| Élément | Hauteur du canvas |
|---|---|
| Pane des prix | **8 device-px, soit 4 px CSS** |
| Chacun des sept panes d'indicateurs | 200 device-px, soit 100 px CSS |

À l'écran, **il ne reste plus une seule bougie**. Le bandeau affiche toujours
« PUMPUSDT 0.002139 +4.04 % », le badge annonce « Indicateurs 7 », l'axe des temps est en place —
et le graphe des prix a disparu, réduit à une bande de quatre pixels sous le bandeau.

L'explication est dans le bundle : `_measurePaneHeight` alloue la hauteur des panes séparés
**d'abord**, puis donne au pane prix ce qui reste, **sans plancher**. AXIOM crée chaque pane avec
`{ id, dragEnabled: true, minHeight: 60 }` et klinecharts applique `PANE_DEFAULT_HEIGHT = 100`. Le
`minHeight` protège donc les oscillateurs, et rien ne protège le prix. Le pane qui dépasse le
budget reçoit lui aussi zéro : l'indicateur est activé, compté dans le badge, listé dans
« Actifs », et ne dessine rien.

C'est la réponse littérale à « qu'est-ce qui devient illisible avec 5-10 indicateurs actifs » :
rien ne devient illisible, le graphe s'éteint. Aucun avertissement, aucun plancher, aucun
rééquilibrage.

### 3.5 — Le footprint ne s'affiche jamais sur l'historique, et rien ne le dit

La map d'accumulation `this.footprints` n'est écrite que dans `onTrade`, le handler du flux
`@aggTrade` temps réel. Aucun amorçage depuis les klines. Le rendu fait :

```ts
const cells = this.footprints.get(kd.timestamp);
if (cells === undefined || cells.size === 0) continue;
```

Une bougie historique n'a donc jamais de cellules : aucune colonne n'est dessinée. À froid en 1 m
on obtient une colonne partielle ; en 4 h ou 1 j — le pas de temps de toute lecture macro et de
tous les presets de backtest — le footprint reste invisible pendant des heures. Aucun état vide,
aucun texte, aucun indicateur de chargement sur cette couche : l'utilisateur ne peut pas
distinguer « cassé » de « non supporté » de « juste vide ».

Le code sait pourtant faire : l'overlay OCN a un repli explicite `rowsApprochees` avec le
commentaire « sans quoi la fenêtre démarre vide et met 30+ min à devenir lisible ». Le footprint
n'en bénéficie pas.

### 3.6 — Le chemin clavier principal détruit l'agencement au lieu d'y naviguer

`toggleWindow` restaure bien une fenêtre minimisée (correction d'une revue précédente), mais pour
une fenêtre **ouverte et enfouie** sous d'autres, il exécute `closeWindow`. Or `basculer()` de
`windowPanels.ts` appelle directement `toggleWindow`, et **28 commandes de la palette** passent
par cette fonction (vérifié par comptage).

Concrètement : trois fenêtres empilées, on tape `CORR` dans ⌘K pour revenir à la matrice de
corrélations enfouie — **elle se ferme**. Il faut retaper le mnémonique. Le menu Fonctions, lui,
appelle `openWindow`, qui restaure et monte au sommet : même mnémonique, deux sémantiques
opposées selon le point d'entrée, alors que la barre d'outils annonce « mêmes mnémoniques dans
⌘K ». C'est l'inverse du contrat Bloomberg — taper la fonction, c'est y aller.

Aggravant : aucun pilotage clavier des fenêtres n'existe (ni cycle de focus, ni fermeture, ni
ancrage), et fermer à la souris demande de viser une cible d'environ 14×18 px.

---

## 4. Mesure : combien de couleurs de série AXIOM peut-il réellement porter ?

Les cinq palettes `--serie-1…6` ont été passées au validateur OKLab (bande de clarté, plancher de
chroma, séparation en vision daltonienne, plancher en vision normale, contraste sur la surface),
en mode toutes-paires — le mode correct ici, puisque l'attribution est cyclique et que n'importe
quel couple d'indicateurs peut coexister.

**Les cinq palettes échouent.** Le résultat le plus parlant n'est pas le daltonisme mais le
plancher de vision normale : deux couleurs de la même palette sont indistinguables même avec une
vision des couleurs intacte.

| Thème | Pire couple, vision normale | ΔE | Verdict |
|---|---|---|---|
| `dark` | `#22d3ee` ↔ `#38bdf8` | 6,7 | échec (seuil 15) |
| `bloomberg` | `#d98a00` ↔ `#ff7a00` | 7,2 | échec, plus un ton qui lit gris |
| `matrix` | `#39ff7a` ↔ `#5bff8f` | 3,0 | échec sévère |
| `cute` | `#2563eb` ↔ `#7c3aed` | 12,4 | échec, plus un ton sous 3:1 |
| `aurora` | `#818cf8` ↔ `#a78bfa` | 5,4 | échec |

Toutes les palettes échouent aussi la bande de clarté sauf `cute` : sur fond sombre, les six tons
sont trop clairs (L de 0,68 à 0,94 pour une bande 0,48–0,67), ce qui les fait vibrer et se
ressembler.

**La cause principale est la clarté, pas la teinte.** Quatre palettes sur cinq échouent la bande de
clarté : leurs six tons sont tous très clairs (L de 0,68 à 0,94 pour une bande admissible de
0,48–0,67) **et tous à la même clarté**. Or c'est précisément l'écart de clarté qui fait tenir une
palette catégorielle : la simulation du daltonisme écrase la teinte mais préserve la clarté. Six
tons vifs, clairs et de clarté identique sur fond sombre, c'est la recette du lavage.

Une recherche a alors cherché s'il existe une palette de six qui passe, sous la contrainte propre
à un terminal — aucune teinte de série ne doit s'approcher du vert haussier ni du rouge baissier,
sans quoi une courbe se lit comme un signe — **en laissant cette fois la clarté libre à l'intérieur
de la bande** :

| Palette | Pire ΔE daltonien (seuil 8) | Pire ΔE vision normale (seuil 15) | Verdict |
|---|---|---|---|
| `--serie-1…6` actuelles (`dark`) | 0,3 | 6,7 | échec |
| **6 tons, clarté étagée** | **10,5** | **18,3** | **passe** |

La palette trouvée est `#915006 #3436fe #11a1b4 #a3069e #849c00 #8777ff`, dont les clartés
s'étagent en 0,50 / 0,50 / 0,65 / 0,50 / 0,65 / 0,65. Elle est donnée comme preuve d'existence et
comme point de départ, pas comme proposition esthétique définitive.

**Conclusion opérationnelle : six couleurs de série sont tenables, mais pas six couleurs de même
clarté.** La correction n'est donc pas de réduire la palette, c'est de **ré-étager les six tons
sur la bande de clarté** — deux niveaux suffisent — et de les re-choisir sur le fond sombre plutôt
que de les décliner d'une teinte de thème.

Trois réserves à porter avec cette recommandation :

1. La palette validée laisse un avertissement de contraste : trois tons passent sous 3:1 sur la
   surface. Le validateur l'autorise **à condition qu'un relief existe** — étiquettes visibles ou
   vue tableau. La légende porteuse du § 5.1 fournit exactement ce relief ; sans elle, il faudrait
   remonter ces trois tons.
2. Au-delà de six séries sur une même surface, aucune palette ne tient : le plafond existe, il est
   simplement plus haut que quatre. L'encodage secondaire reste la vraie réponse à la densité.
3. Les collisions relevées doivent être corrigées d'abord, car elles sont gratuites :
   `--accent == --serie-1` en `dark` et `matrix` ; `--crosshair == --serie-1` en `bloomberg`,
   `matrix`, `cute`, `aurora` ; `--up == --serie-1` et `--down == --serie-6` en `aurora` ;
   `--ui-amber` (alias sémantique `warn`) est identique à une couleur de série **dans les cinq
   thèmes**.

Cette dernière collision a un effet visible : la courbe « Revenus protocole ($/j) » est peinte
exactement dans la couleur d'avertissement du produit.

---

## 5. Le design cible

Trois changements structurants, dans l'ordre où ils doivent être faits. Ensemble ils répondent aux
six défauts du § 3.

### 5.1 — La légende porteuse : rendre au graphe l'identité et le contrôle

C'est la proposition centrale. Aujourd'hui, en haut du pane :

```
┌──────────────────────────────────────────────────────────────┐
│ [PUMPUSDT 1d ÷BTC ÷ETH  0.002139  +4.90% …]        …439B   ✕ │  ← nom caché, croix anonyme
│                                                            ✕ │
│      ╱╲    ╱╲                                              ✕ │
```

Cible :

```
┌──────────────────────────────────────────────────────────────┐
│ [PUMPUSDT 1d …]                                              │
│ ■ EMA (20)      0.002144   ⚙ ✕                               │  ← pastille = couleur d'instance
│ ■ EMA (50)      0.002098   ⚙ ✕                               │     nom + valeur au crosshair
│ ■ Bollinger (20, 2)        ⚙ ✕                               │     ⚙ ouvre les réglages
```

Trois modifications solidaires :

1. **Couleur par instance.** Ajouter `couleurIdx: number` à `ActiveIndicator`, attribué à
   l'activation comme le plus petit index libre parmi les instances vivantes, persisté, libéré à la
   suppression.
   **Piège d'implémentation à respecter** : `ensureRegistered` est gardé par un `Set` de portée
   module keyé sur `name` — le template n'est enregistré qu'une fois et jamais ré-enregistré. Il ne
   faut donc **pas** capturer `couleurIdx` dans la closure à l'enregistrement (une suppression qui
   décale les index laisserait une couleur périmée). Il faut le lire **au moment du dessin** dans
   le callback `styles: () => …` déjà en place — exactement le pattern, et pour la même raison, que
   celui documenté pour les tokens de thème.
2. **Légende porteuse.** Dans `overlayLegend.ts` et `paneHeaders.tsx`, chaque ligne devient
   `[pastille 8×8] Nom (params)   valeur   ⚙   ✕`, la valeur suivant le crosshair, les boutons en
   cibles ≥ 20×20 px.
3. **Réglages depuis le graphe.** Le ⚙ — et un double-clic sur le pane — ouvrent le menu
   Indicateurs pré-déplié sur cette instance. Le geste de référence de TradingView n'existe
   aujourd'hui nulle part : `grep dblclick` sur `chart/` ne renvoie rien.

Pour que cette légende soit visible, deux correctifs courts la précèdent :

- `candle: { tooltip: { showRule: 'none', offsetTop: 36 } }` dans `applyChartTheme`. Vérifié dans
  le bundle : c'est le retour de `_drawCandleStandardTooltip` qui sert d'ordonnée à
  `drawIndicatorTooltip` ; `offsetTop: 36` place donc la légende juste **sous** le bandeau de
  symbole. Ne pas poser `showRule: 'none'` seul — l'ordonnée retomberait à 6 et la légende
  passerait entièrement sous le bandeau.
- Déplacer la barre de disposition de `right-2 top-2` à `right-2 bottom-2` pour libérer la colonne.

### 5.2 — Fermer `applyChartTheme` sur les trois familles manquantes

Quinze lignes ajoutées à un objet déjà écrit, avec des tokens déjà lus dix lignes plus haut :

```ts
overlay: {
  text: { color: accentInk, backgroundColor: accent, borderColor: accent, size: 10 },
  point: { color: accent }, line: { color: accent },
  rect: { color: rgbaTokenCanvas("--accent", 0.12, …), borderColor: accent },
},
indicator: { tooltip: { text: { color: textDim, family: font, size: 11 } } },
separator: { color: border },
```

Cela supprime d'un coup, dans les cinq thèmes : le pavé bleu du § 3.3, les légendes en
`#76808F`/Helvetica Neue, les séparateurs figés, et les poignées de dessin bleues. Passer
`overlay.text.size` de 12 à 10 règle au passage le chevauchement des sept niveaux Fibonacci.

À compléter par `backgroundColor: "transparent"` sur les huit figures texte oubliées, **et par un
test de garde** : le piège est structurel (défaut de bibliothèque + fusion partielle des styles) et
se reproduira au prochain overlay écrit. Le test doit lire les fichiers de `chart/`, repérer chaque
littéral `type: "text"` et échouer si le bloc `styles` associé ne mentionne pas `backgroundColor`.

### 5.3 — Un budget de hauteur pour le pane prix

Dans `ChartIndicators.sync`, après la boucle de création/suppression :

```ts
const dispo  = conteneur.clientHeight - hauteurAxeX - separateurs;
const hCible = Math.max(60, Math.floor((dispo * 0.55) / nbPanesSepares));
chart.setPaneOptions({ id: paneId, height: hCible });   // signature confirmée dans index.d.ts
```

Le pane prix conserve ainsi ≥ 45 % de la hauteur quel que soit le nombre d'indicateurs. Au-delà de
`floor(dispo * 0.55 / 60)` panes, refuser l'activation avec un message actionnable — « 6 panes
maximum à cette hauteur de fenêtre : fermez-en un, ou choisissez une variante overlay » — plutôt
que d'activer un indicateur qui rendra 0 px. Le redimensionnement manuel reste possible mais est
re-clampé au même budget sur `OnPaneDrag`.

---

## 6. Le reste, par axe

### 6.1 Navigation et fenêtres

- **Sémantique « focus d'abord »** : une action `focusOuBascule(id)` — minimisée → restaurer ;
  ouverte mais enfouie → focaliser ; déjà au premier plan → fermer ; fermée → ouvrir. Y brancher
  `basculer()` et tous les `toggleX` des stores. Le menu Fonctions et ⌘K deviennent identiques.
  ~15 lignes, aucun nouveau composant.
- **Couche clavier** : Échap réduit la fenêtre focalisée, ⇧Échap la ferme, une touche de cycle
  (`Backquote`, par code physique comme les timeframes) fait tourner le focus. ⌥←/→/↑/↓ ancrent —
  `snapWindow` et `setPreSnapGeometry` existent déjà.
- **Menu Fonctions** : 37 entrées en liste plate, dans l'ordre d'implémentation, sans champ de
  recherche, qui dépasse `max-h-[70vh]`. Ajouter un champ `groupe` au registre et rendre des
  en-têtes de section. Harmoniser la colonne mnémonique, aujourd'hui à trois largeurs différentes
  (`w-12` / `w-14` / `w-24`) pour le même token.
- **Groupes de couleur** : la pastille est offerte dans l'en-tête des 37 fenêtres, mais seule DES
  émet un symbole de groupe et seules DES/VOL/SEAG/EVTS le consomment. Réserver la pastille aux
  fenêtres participantes via un drapeau `groupable` au registre, et afficher le symbole diffusé.
- **Collision de mnémoniques** : taper `FUND` dans ⌘K ouvre « Fiche société », pas le funding —
  le sous-pane de funding a d'ailleurs dû être rebaptisé `FRATE` à cause de cette collision,
  commentaire à l'appui. À arbitrer explicitement dans le tri de `rechercher()`.
- **Aucune fenêtre ne signale qu'elle a le focus** : bordure et en-tête sont en dur, sans variante
  conditionnée à l'ordre z.
- Détails : la cascade boucle modulo 8 (la 9ᵉ fenêtre recouvre exactement la 1ʳᵉ) et compte les
  fenêtres réduites ; la mosaïque donne la même cellule à CAP — dont le registre documente qu'en
  dessous de 800 px « les axes se télescopent » — qu'à LIQ ; renommer un workspace passe par
  `window.prompt`.

### 6.2 Indicateurs : trouver, régler, retirer

- **La recherche ne parle pas français** : le filtre ne matche que `name`/`id`, et les définitions
  s'appellent EMA, SMA, HMA. Dans une application entièrement en français, « moyenne mobile »
  renvoie **zéro résultat**. Ajouter des alias, et gérer Entrée pour ajouter le premier résultat.
- **Aucun favori, aucun récent, aucun jeu nommé** dans un catalogue de 152 entrées présenté dans
  288 px. Pour un build mono-utilisateur, les « jeux d'indicateurs » nommés (« setup dérivés »,
  « setup swing ») sont le vrai raccourci quotidien.
- **La bascule ⌘K est destructive** : elle retire *toutes* les instances d'une définition. Trois EMA
  soigneusement réglées disparaissent d'une frappe, sans confirmation ni annulation.
- **Clamp silencieux** : le moteur borne la valeur au calcul, le store garde la saisie brute. Un
  pane peut afficher « EMA (100000) » pour une courbe calculée au maximum. Les bornes ne sont
  jamais montrées.
- **Les raisons de grisage n'existent qu'en `title`**, donc invisibles au clavier — d'autant que le
  parcours au clavier saute les boutons désactivés.
- **La section « Actifs » n'a ni hauteur maximale ni défilement propre** : au-delà d'une dizaine
  d'instances elle écrase le catalogue et la recherche.
- Le badge du bouton affiche le nombre d'actifs s'il y en a, **sinon la taille du catalogue** :
  au premier lancement il annonce « 152 » comme si 152 indicateurs étaient actifs.

### 6.3 Stratégies et backtest

- **Aucun fil entre un backtest et le graphique.** `backtestStore` n'est lu que par sa propre
  fenêtre ; `tradeMarkers.ts` ne contient pas une occurrence de « backtest » ; la table des trades
  monte `TableTriable` sans `surClicLigne` alors que la primitive le supporte et que le BRIEF s'en
  sert déjà pour renvoyer au chart. Le troisième verbe du parcours — régler, lancer, **voir** —
  n'est câblé à rien.
- **Deux catalogues de stratégies disjoints** : 9 presets codés en dur dans BT, 27 définitions dans
  le menu Stratégies. Ils partagent des noms, reposent sur des moteurs différents, et aucun ne
  mentionne l'autre. Le moteur du chart calcule à la clôture hors frais ; celui de BT à l'open
  suivant, frais inclus. Deux vérités chiffrées divergentes pour la même stratégie.
- **Le rapport ne périme jamais** : aucun setter n'efface le résultat. On peut changer symbole, pas
  de temps, plage, règles et frais — les 9 tuiles, la courbe d'équité et la table continuent
  d'afficher le run précédent, sans aucune marque d'obsolescence.
- **« (non validé) » est du texte tronquable**, incorporé au champ `name` : dans un panneau de
  288 px avec `truncate`, c'est la mention coupée en premier ; dans la légende du chart elle se
  concatène aux paramètres. À porter par une donnée (`validation: "non-valide"`) et un badge. Le
  rapport de rejeu qui fonde ce verdict n'est accessible nulle part dans l'application.
- **La courbe d'équité est toujours verte**, y compris pour un run perdant : une ligne verte qui
  descend au-dessus d'une aire rouge, pendant que la tuile PnL affiche du rouge. Le token de statut
  est recyclé en couleur de série.
- **Une étiquette de pourcentage sur chaque sortie** (jusqu'à 60), qui se chevauchent entre
  stratégies — l'anti-patron « une valeur sur chaque point ». Trois plafonds de troncature (60
  trades, 150 annotations, 200 marqueurs) coupent en silence : on ne voit que la fin de l'histoire
  sans le savoir.

### 6.4 Système visuel et identité

- **Le score composite n'affiche jamais sa couverture** : un score sur 3 composants s'affiche
  exactement comme un score sur 8, alors que la panne partielle est le cas nominal (9 sources en
  `allSettled`). L'alerte se déclenche identiquement dans les deux cas.
- **`majTs` est écrit à chaque cycle et lu par personne.** Le « maj 14:36 » du BRIEF date des
  sections réseau, pas du chapeau, qui vient d'un poller de 15 minutes — et le verdict gamma à
  l'intérieur du chapeau a en plus son propre cache de 10 minutes. Une donnée de 25 minutes d'âge
  sous un horodatage à la seconde.
- **Un extrême bas n'est jamais signalé** : les six `RefBadge` en production passent tous
  `hausse-chaud`, la branche `hausse-froid` est du code mort. Un DVOL au 3ᵉ percentile — la
  compression de volatilité, configuration parmi les plus actionnables — s'affiche dans le même
  gris qu'un p40.
- **Le détail des 8 composants du régime vit dans un `title` d'une ligne** : huit fragments
  concaténés dans un attribut HTML, non copiable, inaccessible au clavier, invisible au tactile. Le
  clic ouvre BRIEF, qui n'affiche pas la décomposition.
- **« Nuit » n'est pas la nuit** : c'est le `priceChangePercent` glissant sur 24 h de Binance,
  appelé « BTC 24 h » deux fichiers plus loin. À 11 h 23, la « nuit » couvre l'après-midi de la
  veille.
- **Dans les tuiles inline, la donnée secondaire est rendue avant le chiffre-clé** : « Nuit | ETH
  -0.5% | -1.0% » — le seul actif nommé est celui qui n'est pas le chiffre-clé. La règle est
  inversée par la primitive elle-même, donc partout.
- **L'état désactivé de la barre d'outils est invisible**, pas estompé : `text-neutral-700` sur
  `bg-neutral-900` donne de 1,24:1 à 1,73:1 selon le thème. Aucun n'atteint 3:1. C'est le seul état
  de bouton sans primitive dans `ui.tsx`, donc recopié à la main cinq fois.
- **La police déclarée n'est jamais chargée** : ni `<link>`, ni `@font-face`, ni `@fontsource`.
  `aurora` déclare Inter, qui n'est pas installée sur cette machine ; il retombe donc sur la stack
  de `dark` — les deux thèmes sont typographiquement indiscernables.
- **Le verrou « police canvas unique » est un leurre** : le motif n'interdit que trois chaînes
  périmées et ne scanne que `src/components`. 22 des 61 affectations `ctx.font` divergent, dont
  deux **invalides et silencieusement ignorées** par le navigateur (`"11px var(--font-display)"` —
  `var()` n'est jamais résolu dans `ctx.font`, l'affectation est un no-op).
- **Neuf pas typographiques** (8, 9, 10, 11, 12 px + `text-xs/sm/base/lg`) : deux systèmes de
  nommage superposés pour un même axe. Trois nuances neutres servent de texte alors qu'elles
  échouent AA dans les cinq thèmes.
- **Le dégradé d'ambiance est peint derrière les bougies** : `chartDom.style.backgroundImage =
  atmos`. En `aurora`, il est **animé en boucle de 18 s** — le fond respire derrière les prix.
  C'est le seul endroit du produit où l'identité coûte du contraste, et le seul où elle ne devrait
  pas.

**Sur l'identité, enfin.** Le thème `dark`, présenté en commentaire comme « référence sérieuse »,
est un assemblage de valeurs d'autrui, et le code le dit : la rampe neutre est la palette Tailwind
par défaut, et `--up #2dc08e` / `--down #f92855` sont **exactement** les constantes internes de
klinecharts. Les deux couleurs les plus chargées d'identité d'un terminal financier — celles des
bougies — sont les couleurs de la librairie sortie de la boîte. Les quatre autres thèmes ont du
caractère, mais ce sont des pastiches assumés : Bloomberg, Matrix, un thème kawaii. Aucun ne dit
« AXIOM ».

Or le produit *a* une signature, et elle n'est pas chromatique mais **textuelle** : le préfixe
mnémonique « STBL · STABLECOINS », et surtout le vocabulaire épistémique — fiable / partiel /
estimation / indisponible, « p97 · 90 j », la provenance, la fraîcheur. Aucun terminal concurrent
ne dit à l'utilisateur à quel point il peut croire un chiffre. C'est le trait distinctif, et il est
rendu à 9 et 10 px dans `text-text-dim`, les deux plus petites tailles et le token le plus effacé
du système.

**Le produit chuchote la seule chose qu'il est seul à savoir dire.** Si une direction artistique
doit être choisie pour AXIOM, c'est celle-là : faire du degré de confiance un élément de premier
plan — une colonne réservée, un glyphe stable, une taille qui se lit — plutôt qu'une note de bas de
page.

---

## 7. Plan proposé

Quatre lots, ordonnés par rapport valeur/effort. Les efforts sont indicatifs pour un
développeur seul qui connaît le code.

### Lot A — « Rendre le graphe lisible » ✅ LIVRÉ le 2026-08-01

| # | Action | Effort | État |
|---|---|---|---|
| A1 | Fermer `applyChartTheme` sur `overlay` / `indicator` / `separator` | S | fait |
| A2 | `backgroundColor: "transparent"` sur les 8 figures texte + test de garde | S | fait |
| A3 | `candle.tooltip.showRule: 'none'` + `offsetTop: 36` ; barre de disposition en bas | S | fait |
| A4 | Couleur par instance (`couleurIdx`, lu au dessin) | M | fait |
| A5 | Légende porteuse : pastille + nom + ⚙ + ✕ | M | fait |
| A6 | Double-clic sur pane / ⚙ → réglages de l'instance | S | fait |
| A7 | Filet de hauteur des panes + refus explicite au-delà | M | fait |

Commits `eaecec2` → `a6abfcd`, 2852 tests, CI verte. Un indicateur a désormais une couleur
propre, un nom lisible et des réglages à un clic ; le graphe ne s'éteint plus.

**Ce que la vérification a corrigé après coup** (mesures dans le navigateur + revue
adversariale à 6 lentilles, 32 constats rapportés) :

- Le filet de hauteur ne s'appliquait pas du tout : `hauteurUtile()` comptait le pane des prix
  une fois par overlay, gonflant la hauteur mesurée au point de neutraliser le calcul.
- Sa première version annulait le redimensionnement manuel des panes. Il est devenu un
  **filet** — il ne rogne que si le prix est réellement étouffé, et proportionnellement.
- `rect`/`circle` en « transparent » supprimaient la bande de sélection des dessins.
- La légende OHLCV coupée l'était aussi dans l'export PNG (qui ne composite que les canvases) ;
  elle y est rétablie le temps de la capture.
- L'allocateur de couleurs ignorait l'arité des sorties (Bollinger réserve trois jetons) et sa
  règle de réparation n'était pas idempotente — les couleurs bougeaient à chaque rechargement.
- Le ⚙ des stratégies et des définitions sans paramètre ne menait à aucun éditeur.
- Le verrou lexical se satisfaisait d'un commentaire, et ne couvrait pas la seule figure texte
  hors de `chart/` — que A1 avait justement rendue invisible.

### Lot B — « Le clavier reprend la main »

| # | Action | Effort |
|---|---|---|
| B1 | `focusOuBascule` + rebranchement de toutes les commandes de fenêtre | S |
| B2 | Échap / ⇧Échap / cycle de focus / ⌥flèches d'ancrage, documentés dans l'aide | S |
| B3 | Menu Fonctions groupé + colonne mnémonique harmonisée | S |
| B4 | Recherche d'indicateurs avec alias français + Entrée pour ajouter | S |
| B5 | Jeux d'indicateurs nommés, exposés comme commandes ⌘K | M |
| B6 | Bascule ⌘K non destructive (retirer la dernière instance, pas toutes) | S |

### Lot C — « Le backtest boucle la boucle »

| # | Action | Effort |
|---|---|---|
| C1 | Projeter les trades du run sur le chart (`btMarkers.ts`, scopé au symbole+TF du run) | M |
| C2 | Clic sur une ligne de la table → centrer le chart sur le trade | S |
| C3 | Invalidation visible du résultat (signature de run + bandeau « relancer ») | S |
| C4 | Badge « non validé » typé, retiré des noms ; rapport de rejeu consultable | M |
| C5 | Étiquettes de sortie sélectives (10 dernières) + compteur de troncature | S |
| C6 | Équité colorée par résultat, hiérarchie des 9 tuiles | S |

### Lot D — « La confiance au premier plan » (l'axe d'identité)

| # | Action | Effort |
|---|---|---|
| D1 | Bloc « RÉGIME · composite » dans BRIEF : 8 composants, notes, couverture « 6/8 » | M |
| D2 | `Fraicheur` avec seuils de péremption + branchement de `majTs` | S |
| D3 | `hausse-froid` réellement câblé : signaler les extrêmes bas | S |
| D4 | Corriger les collisions de tokens (`--accent`/`--crosshair`/`--up`/`--ui-amber` vs séries) | S |
| D5 | Remonter le vocabulaire épistémique d'un cran typographique | M |
| D6 | Sortir `--atmos` de la zone de tracé | S |
| D7 | Étendre le ratchet UI au rendu (classes littérales, polices canvas, `src/chart`) | M |

---

## 8. Points laissés ouverts

Ces sujets sont apparus dans la revue mais méritent une décision, pas une correction :

1. **Faut-il porter la palette à 8-10 tons ?** La mesure du § 4 dit que le problème n'est pas le
   nombre mais l'étagement : six tons tiennent si leurs clartés s'étagent, aucun nombre ne tient si
   elles sont égales. Corriger les six existants est donc prioritaire sur en ajouter — et ajouter
   ne servirait de toute façon que si les six producteurs de séries écrits à la main étaient
   d'abord unifiés derrière un allocateur.
2. **Le footprint doit-il être amorcé depuis les klines ?** Approximer le delta bid/ask à partir
   d'une bougie est une reconstruction, pas une mesure. Deux voies : un repli explicitement marqué
   « approché » (comme l'OCN le fait déjà), ou un état vide honnête « en accumulation depuis
   HH:MM ». La seconde est plus fidèle à la convention d'honnêteté du produit.
3. **Les deux catalogues de stratégies doivent-ils fusionner ?** Ils reposent sur deux moteurs aux
   hypothèses d'exécution différentes. Fusionner les noms sans fusionner les moteurs aggraverait la
   confusion ; l'alternative est d'assumer la distinction en la nommant (« signal » sur le chart,
   « exécution » dans BT) et d'afficher l'écart comme un coût d'exécution mesuré.
4. **La spec Lot 4 prévoit de passer de 5 à 9 thèmes.** Avant d'en ajouter quatre, les cinq
   existants doivent passer le validateur et les collisions de tokens doivent être corrigées — et
   le sélecteur à cinq pastilles de 20 px ne tiendra pas à neuf.

---

*Revue produite le 2026-08-01. Les captures d'écran et les rapports détaillés par axe sont dans le
répertoire de travail de la session.*
