# VPFR + rail ΔOI (« OI heatmap de zone ») — design

> **Spec validée en brainstorming le 2026-08-10.** Demande d'origine : « un indicateur
> Open Interest heatmap : je sélectionne une zone et la map me dit où a été exécuté la
> plupart du volume ». Choix utilisateur : mesure **Volume + ΔOI**, sélection par
> **outil de dessin** persistant.

## 1. Découverte d'inventaire (change le périmètre)

L'outil demandé existe aux 4/5 : **VPFR** (`chart/volumeRangeOverlay.ts`, entrée
« Profil de volume (plage) » de `DrawingToolbar.tsx:269`) trace déjà, sur une plage
choisie à 2 points (pattern fibonacci, poignées, persistance par `exchange:symbol`,
multi-chart via `extendData`), les barres de volume buy/sell par bin de prix
(`BIN_COUNT = 24`), le POC et la zone de valeur, avec désactivation propre sur les
séries synthétiques.

**Le périmètre réel de ce lot est donc l'extension, pas la création :**

1. **Rail ΔOI** accolé au profil VPFR — où l'Open Interest s'est construit (+) ou
   déconstruit (−) dans la zone, par bin de prix.
2. **Mnémonique ⌘K `OIMAP`** qui arme l'outil VPFR (aujourd'hui accessible uniquement
   à la souris via la toolbar).

Hors périmètre (YAGNI, décisions explicites) : pas de fetch de bougies plus fines que
le TF du chart (le VPFR lit le buffer du chart — précision actuelle conservée), pas de
multi-profils simultanés au-delà de ce que le VPFR permet déjà, pas de refonte du
rendu volume existant.

## 2. Données ΔOI

- **Source** : `histOiUsdAvecRepli(symbolePerp, "1hour", borneBasseZone)` de
  `data/referentiels.ts` (Coinalyze primaire → repli Binance `openInterestHist`
  gratuit, livré le 2026-08-10). Symbole normalisé par `basePerp()` (`data/symbol.ts`)
  → `${base}USDT` ; `basePerp` nul (synthétiques…) → pas de rail (le VPFR volume
  reste inchangé).
- **Projection prix** : pour chaque point horaire, `ΔOI(h) = oi(h) − oi(h−1)` est
  affecté à la bougie du chart **contenant** cette heure (helper `candleContenant`
  de `chart/liquidationMarkers.ts`), puis réparti uniformément sur la fourchette
  high-low de cette bougie dans les bins du profil, **signé**. À TF > 1 h la
  résolution prix est celle de la bougie conteneuse — approximation assumée.
- **Fenêtre honnête** : l'historique OI couvre ~20-30 j. Zone plus ancienne que le
  premier point OI → rail absent + mention « ΔOI indisponible (> ~30 j) » dans le
  label du profil. Jamais de silence (leçon LIQEST).
- **Asynchronisme** : le `draw` d'un overlay est synchrone ; la série OI est fetchée
  au tracé/déplacement de la zone (throttlé), stockée dans un cache module keyé par
  id d'overlay, et le repaint de l'overlay est déclenché à l'arrivée des données.
  Échec réseau → rail absent + mention, volume inchangé.

## 3. Rendu

- **Rail ΔOI** : fine colonne (~18 px) accolée au bord opposé aux barres de volume
  (les barres volume sont ancrées à droite → rail à gauche du cadre), un segment par
  bin : construction nette (+) en token haussier, déconstruction nette (−) en token
  baissier, longueur ∝ |ΔOI net du bin| normalisée au max de la zone, alpha ~0.8.
- **Bin dominant** : le bin au |ΔOI| max reçoit une étiquette compacte
  (`+67 M$ @ 61 250`, formateurs maison), même règle anti-collision que les labels
  VPFR existants.
- **Synthèse** : le label existant du VPFR est étendu : `POC … · VA … · ΔOI net ±X M$`.
- Tokens via `lib/canvasTokens.ts` (5 thèmes), textes `backgroundColor: "transparent"`
  (piège KLineChart connu), px CSS sous dpr — conventions du fichier.

## 4. Commande ⌘K

- `OIMAP` (« Profil de zone volume + ΔOI — tracer ») : arme l'outil `volumeRange`
  exactement comme le clic toolbar (réutiliser la fonction d'armement existante de
  `DrawingToolbar`/`drawing.ts` — l'extraire si elle est inline). Enregistrement
  identique aux commandes existantes ; test d'unicité des mnémoniques au vert
  (`OIMAP` libre, vérifié dans la liste des 83).
- Grisée/refusée avec toast informatif sur série synthétique (même condition que la
  toolbar `exchange === "synthetic"`).

## 5. Tests (TDD)

- Purs : calcul `ΔOI(h)` depuis la série OI (bornes, premier point, trous),
  projection ΔOI→bins via bougie conteneuse (TF 1 h et 4 h, signes, zone
  partiellement couverte), décision d'état du rail (`ok` / `indisponible >30 j` /
  `sans-perp` / `erreur`), extension du label de synthèse.
- Overlay : mêmes patterns que `volumeRangeOverlay.test.ts` existant (figures
  générées, pas de rendu pixel).
- Gate visuel à l'œil au premier lancement (canvas), comme d'habitude.

## 6. Découpage d'implémentation proposé

1. Module pur `chart/volumeRangeOi.ts` (calculs + états) — TDD.
2. Câblage fetch/cache/repaint + rendu rail dans `volumeRangeOverlay.ts`.
3. Commande `OIMAP` + armement extrait.
