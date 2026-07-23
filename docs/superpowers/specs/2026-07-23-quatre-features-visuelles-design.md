# Spec — Quatre features visuelles (heatmap liquidité, bulles baleines, radar squeeze, heatmap OI options)

Date : 2026-07-23. Statut : validée par Zaki (design consolidé approuvé).

Quatre ajouts visuels indépendants, chacun sur sa branche `feat/*`, sans nouveau
backend ni endpoint : tout s'appuie sur les flux et patterns existants.

---

## A. Heatmap de liquidité du carnet — overlay chart « BOOK »

**But** : mémoire visuelle du carnet d'ordres (style Bookmap) — heatmap temps × prix
superposée aux bougies du chart maître, intensité = taille des ordres limites posés.
Les murs de liquidité qui apparaissent/disparaissent deviennent visibles.

### Données
- Source : `apps/web/src/data/depth.ts` (Binance spot, snapshot REST 1000 niveaux +
  diffs WS `@depth@100ms`, carnet reconstitué `OrderBook`). Aucun nouveau flux.
- **Mutualisation de la connexion** : le budget projet est « UNE connexion depth ».
  Ajouter un ref-counting par symbole dans `souscrireDepth` : plusieurs abonnés au
  même symbole partagent la même connexion WS ; la connexion ferme quand le dernier
  se désabonne. Changement chirurgical dans `depth.ts`, fonctions pures testées.
- Nouveau module `apps/web/src/chart/depthHeat.ts` (+ store d'accumulation) :
  - Échantillonnage : ~1 colonne/seconde. Chaque colonne = timestamp + niveaux
    agrégés bid/ask au pas de prix (`agregerNiveaux` + `pasArrondi` existants).
  - Buffer FIFO borné ~1800 colonnes (≈ 30 min), modèle `liqEventsStore`
    (`chart/liquidationMarkers.ts` : événements bruts bornés + `rev` bump,
    grille recalculée au rendu). Aucun disque/DB.
  - Reset du buffer au changement de symbole.

### Rendu
- `DepthHeatController` calqué sur `LiquidationHeatController`
  (`chart/liquidationHeat.ts`) : canvas `pointer-events-none absolute inset-0`
  empilé sur le chart (montage dans `ChartInstance.tsx`, slot maître uniquement),
  boucle rAF + dirty flag, DPR, projection `chart.convertToPixel`, plage
  `getVisibleRange()`, suivi pan/zoom via `subscribeAction`, clip sur
  `candle_pane`.
- Intensité **log** (petites tailles visibles sans écraser les murs), rampe
  viridis theme-aware (réutiliser `intensiteLog` / `rampePourTheme` de
  liquidationHeat si exportables, sinon dupliquer localement le même calcul).
- Deux chemins de rendu comme liquidationHeat : `fillRect` par cellule (zoom
  serré) / offscreen 1 cellule = 1 px upscalé en un `drawImage` sous
  `SEUIL_LISSAGE_PX`.

### Activation & UX
- Store vanilla de bascule (éphémère, non persisté) + commande palette
  `mnemonique: "BOOK"`, catégorie `action` (modèle `liquidationHeat.ts` /
  `dom-ui.ts`). Le test `commands/registry.test.ts` impose l'unicité globale.
- Limites assumées, affichées si pertinent : Binance spot uniquement ;
  l'historique démarre à l'activation (pas de replay du carnet passé).

### Tests (vitest, fonctions pures)
- Échantillonnage/bornage FIFO (éviction, reset symbole).
- Construction de la grille temps × prix depuis les colonnes (plage visible).
- Échelle d'intensité log (bornes, zéro, monotonie).
- Ref-counting `souscrireDepth` (1 connexion pour N abonnés, fermeture au dernier).

---

## B. Bulles de prints baleines — overlay chart « WHALE »

**But** : afficher les gros trades agressifs directement sur les bougies, en bulles
proportionnelles au notionnel, vert/rouge selon le côté agresseur.

### Données
- Flux existants : `adapter.subscribeTrades` (spot, `Trade {time, price, qty, side}`)
  + `subscribePerpAggTrades` (perp). Notionnel = `price × qty` (à calculer).
- Consommation façon `OrderflowController` (`chart/orderflow.ts`) : abonnement dans
  un contrôleur, buffer FIFO ~500 prints hors React (jamais de tick dans un store),
  scopé au symbole affiché, redraw throttlé.

### Rendu
- Nouveau module `apps/web/src/chart/whaleBubbles.ts` sur le pattern
  `tradeMarkers.ts` : `registerOverlay({ name: "whaleBubble", totalStep: 1,
  lock: true, createPointFigures })`, figures `circle` (rayon ∝ √notionnel,
  borné min/max px) + `text` du montant (formatUsd) pour les prints ≥ 5× le seuil.
- Couleurs au dessin : `rgbaTokenCanvas("--up"/"--down", 0.35)` (remplissage) ;
  contrôleur singleton, cycle « efface par id suivi puis recrée »
  (`retirerMarqueursSuivis`-like), abonnements filtrés `prev*` sur
  marketStore/themeStore/store de bascule.
- Les bulles hors seuil ou hors bougies visibles ne créent pas d'overlay (cap).

### Réglage & activation
- `whaleNotionalMin: number` (défaut 100 000 $) + setter dans
  `store/orderflow.ts` (session-only, comme les autres seuils orderflow).
- Champ de réglage dans `FootprintSettingsPanel.tsx` (pattern draft existant).
- Bascule palette `mnemonique: "WHALE"`.

### Tests
- Filtre par seuil notionnel + cap antichrono (fonction `projeterBulles` pure).
- `rayonBulle(notionnel, seuil)` : monotonie, bornes min/max.
- Retrait des overlays suivis (Map instance → ids, tolère instance disposée).
- Convention de côté : side agresseur tel que fourni par `aggTradeToTrade`
  (ne pas inverser).

---

## C. Radar de squeeze — nouvelle fenêtre « SQZ »

**But** : scatter plot quadrants de l'univers perp — X = funding %, Y = ΔOI 24h %,
taille du point ∝ volume 24h, couleur par quadrant. Synthèse visuelle du
positionnement : carburant à short squeeze, longs crowded, dé-leveraging…
Clic sur un point → charge le symbole sur le chart.

### Données (réutilisation intégrale des sources EQS/Signaux)
- Volume + Δprix 24h : `GET api/v3/ticker/24hr` (1 requête, `parseTicker24h`).
- Funding par symbole : `fapi/v1/premiumIndex` via extUrl (1 requête univers perp,
  `parsePremiumIndex`).
- ΔOI 24h : par symbole, `fetchOpenInterestHist(sym, "1h", 25)` +
  `oiChangePctFromHist` (`data/screener.ts`), via le cache `histOiUsd` TTL 1h
  (`data/referentiels.ts`) pour éviter les re-fetchs. Pool de concurrence
  (modèle `enrichPositionSample`).
- **Univers** : même sélection que la vue Signaux (`selectionEchantillon` :
  top 20 liquides à perp ∪ watchlist, cap 28) — pas d'endpoint OI batch gratuit.
  Note de couverture affichée dans la fenêtre (comme EQS).
- Rafraîchissement manuel (bouton) + au plus 1 run auto à l'ouverture ; pas de
  polling continu.

### Rendu & interactions
- Canvas 2D impératif façon `CorrWindow.tsx` : DPR, `clearRect`, tokens de thème
  (`lireTokenCanvas`, `serieCanvas`), `ResizeObserver`.
- Axes X (funding %) / Y (ΔOI %) centrés sur 0, lignes de quadrant, étiquettes de
  quadrant discrètes. Sémantique reprise/adaptée de `signalQuadrantOiPrix`
  (`data/signaux.ts`) — ici les axes sont funding × ΔOI : le nommage des quadrants
  est défini dans une fonction pure dédiée `quadrantFundingOi(fundingPct, dOiPct)`.
- Points : cercle plein semi-transparent, rayon ∝ √volume borné ; label symbole
  sur les N plus gros ou au survol.
- Survol : point le plus proche (distance euclidienne, rayon de capture) →
  tooltip (symbole, funding, ΔOI, volume, quadrant).
- Clic : `navigateTo({ symbol, exchange: "binance", timeframe: tf courant,
  source: "eqs" })` (`lib/navigation.ts`).

### Enregistrement
- `WINDOW_REGISTRY` (`store/windowManager.ts`) : id `squeeze`, mnémonique `SQZ`,
  `nouveau: true`. Lazy component dans `App.tsx` (`WINDOW_COMPONENTS`).
- Commande palette via `commands/windowPanels.ts` (toggle simple).

### Tests
- `quadrantFundingOi` : les 4 quadrants + zone neutre (seuils).
- Projection données → points (échelle rayon, exclusion sans funding/OI).
- Hit-testing du point le plus proche (rayon de capture, aucun match).

---

## D. Heatmap OI strike × échéance + max pain — 3e onglet d'OMON

**But** : carte des positions options — où est l'open interest (et les murs de
gamma) par strike et par échéance, ligne max pain par échéance, ligne du spot.

### Données (zéro fetch supplémentaire)
- La chaîne complète Deribit (`fetchDeribitOptionChain` → `OptionPoint[]` : strike,
  échéance, type, `markIv`, `openInterest`, `underlying`, `interestRate`) est déjà
  chargée/pollée 60 s par OMON.
- Agrégation strike × échéance : nouvelle fonction pure (grouper `chain` par
  `expiryMs` via `echeancesDispo`, puis par strike — généralisation
  d'`agregerParStrike`).
- Max pain par échéance : `computeMaxPain(agregerParStrike(pointsEcheance))`
  (`data/deribit.ts`) en boucle.
- Gamma par strike × échéance : `computeCryptoGexDex(pointsEcheance, spot, nowMs)`
  (`data/gexDex.ts`, s'appuie sur `bsGreeks`) en boucle sur les échéances.

### Rendu & UX
- 3e option du `Segmente` de vue d'OMON : `{ id: "heatmap", label: "Heatmap OI" }`
  (pas de nouvelle fenêtre — cohérent avec smile/GEX-DEX qui partagent devise).
- `dessinerHeatmapOi(canvas, …)` calqué sur `dessinerBarres`
  (`OptionsWindow.tsx`) : DPR, `lireTokenCanvas`, padding + projections px/py.
  Axe X = échéances (ordinal, triées), axe Y = strikes (bande utile autour du
  spot, ex. fenêtre de strikes couvrant ~±40 % du spot ou les strikes à OI non
  nul), cellule colorée par intensité log.
- Bascule de métrique dans l'onglet : **OI** (calls+puts, teinte neutre→accent)
  ↔ **|GEX|** (murs de gamma, signe porté par la teinte up/down).
- Overlays : marqueur max pain par colonne d'échéance ; ligne horizontale du spot.
- Survol : cellule → `InfobulleGraphe` (échéance, strike, OI calls / puts, GEX,
  max pain de l'échéance).
- Canvas monté en permanence, masqué en CSS quand l'onglet n'est pas actif
  (contrainte `useDomaineZoom` documentée dans OptionsWindow).

### Tests
- Agrégation strike × échéance (fusion calls/puts, tri, strikes vides exclus).
- Sélection de la bande de strikes affichée.
- Échelle d'intensité (log, bornes) et bascule OI ↔ |GEX|.
- Max pain par échéance (boucle sur fixtures multi-échéances).

---

## Transversal

- **Langue** : code commenté en français, conventions du repo (docstrings
  POURQUOI/MODÈLE comme `tradeMarkers.ts`).
- **Perf** : aucune donnée tick dans un store Zustand ; accumulation dans les
  contrôleurs, redraw rAF/throttlé (invariant `store/orderflow.ts`).
- **Thème** : couleurs lues au moment du dessin via `lib/canvasTokens`, redraw sur
  `themeStore`.
- **Tests** : logique pure exportée + `.test.ts` vitest ; le couplage
  KLineChart/DOM n'est pas testé (convention repo). Le test d'unicité des
  mnémoniques (`commands/registry.test.ts`) doit passer avec `BOOK`, `WHALE`,
  `SQZ` ajoutés.
- **Branches** : `feat/depth-heatmap`, `feat/whale-bubbles`, `feat/squeeze-radar`,
  `feat/omon-heatmap-oi` — indépendantes, merge une par une après tests verts.
- **Hors périmètre** : replay historique du carnet, sources depth multi-exchanges,
  OI batch univers entier, greeks au-delà de delta/gamma, persistance disque des
  buffers.
