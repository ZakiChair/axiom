# Lot C1 « Analytics chart » — Design

> **Spec validée · 2026-07-06.** Issue du brainstorming avec Zaki (séquençage validé : C1 → C2 → D, puis axe B).
> Cadre : **BUILD-CONTRACT.md** inchangé (mono-utilisateur, renderer-first, KLineChart figé, indicateurs TS pur,
> pas de scripting Pine-like, budget API 0 $/mois). Aucune dépendance nouvelle.

## Objectif

Cinq features d'analytics au niveau du chart, indépendantes entre elles, qui rapprochent AXIOM d'un
terminal Bloomberg : séries synthétiques chartables (HRA-like), saisonnalité (SEAG), analytics de
volatilité (VOL), footprint analytique, volume profile à plage fixe (VPFR).

**Décisions utilisateur actées :**
- Séries synthétiques **cross-source dès la v1** (BTC/DXY, BTC/GOLD via Twelve Data) — pas seulement same-source.
- Architecture SYN = **adapter virtuel** (`SyntheticAdapter` implémentant `IExchangeAdapter`), pas de
  modification du cœur de `market.ts`, pas d'extension du CompareController.

---

## 1. Séries synthétiques (SYN)

### Représentation

- Nouvelle valeur `"synthetic"` dans `ExchangeId` (`packages/types/src/…`) — seule modification de
  `@axiom/types` du lot.
- **Encodage du symbole** (source de vérité unique, aucune table annexe) :
  `LEGA/LEGB@exA,exB` ou `LEGA-LEGB@exA,exB` — ex. `ETHUSDT/BTCUSDT@binance,binance`,
  `BTCUSDT/DXY@binance,twelvedata`. Affichage court : « ETHUSDT/BTCUSDT ».
- Module pur `apps/web/src/data/synthetic.ts` :
  - `parseSyntheticSymbol(sym: string): { legA, legB, op, exA, exB } | null` (parse + validation) ;
  - `combineKlines(a: Candle[], b: Candle[], op): Candle[]` (alignement + composition) ;
  - `syntheticAdapter: IExchangeAdapter` (id `"synthetic"`).
- Enregistrement dans `ADAPTERS` + `SUPPORTED_TIMEFRAMES` calculés **dynamiquement** par intersection
  des deux jambes (fonction `syntheticTimeframes(exA, exB)` exposée ; le grisage TF existant l'utilise —
  petite adaptation dans la Toolbar : pour `synthetic`, appeler la fonction au lieu de lire la table statique).

### Composition des bougies

- Alignement par bucket de timestamp (ouverture de bougie, UTC). Une bougie synthétique n'est émise que
  si la jambe A a une bougie dans le bucket ; la jambe B utilise sa bougie du bucket, sinon **forward-fill
  du dernier close connu** (cas marché tradfi fermé).
- OHLC jambe-à-jambe : `O=Oa∘Ob, H=Ha∘Hb, L=La∘Lb, C=Ca∘Cb` (∘ = `/` ou `-`), puis re-clamp
  `H=max(O,H,L,C)`, `L=min(O,H,L,C)`. Approximation standard (idem TradingView), documentée en
  commentaire d'en-tête.
- Pour `/` : si `Cb === 0` (théorique), bucket ignoré. `volume = 0` sur toutes les bougies synthétiques.
- `fetchKlines` : fetch **parallèle** des 2 jambes via `getAdapter(exA/exB)`, mêmes `opts`
  (`limit`, `endTime`) transmis aux deux ; pagination historique héritée gratuitement.
- `subscribeKline` : 2 souscriptions via les adaptateurs des jambes ; à chaque tick d'une jambe,
  ré-émission de la bougie synthétique du bucket courant avec le dernier état connu de l'autre jambe
  (cache interne des dernières bougies par jambe). L'`Unsubscribe` retourné ferme les deux.
- `subscribeTrades` : **no-op** (retourne un unsubscribe vide) → orderflow/footprint/CVD/DOM inertes
  sur un synthétique, sans `if (synthetic)` dans le code appelant. Le grisage UI des toggles orderflow
  réutilise le pattern « Binance-only » existant (condition : `exchange === "synthetic"` → désactivé).

### Cross-source / UX

- Jambe Twelve Data = adaptateur existant (polling ; quotas gérés par `twelvedata.ts` et le HealthPanel).
- Bandeau symbole (`SymbolBanner`) : si une jambe est `twelvedata` et `isMarketOpen()` est faux, badge
  « jambe tradfi : dernier close (marché fermé) ».
- `PairSearch` : la détection de `/` ou `-` dans la saisie bascule en **mode constructeur** : 2 champs jambe
  (même autocomplete que la recherche normale + sélecteur de source par jambe ; défauts : source courante
  pour une paire crypto, `twelvedata` si le ticker appartient au catalogue tradfi de `pairs.ts`) +
  **3 presets** : `ETH/BTC`, `BTC/DXY`, `BTC/GOLD` (proxy ETF/ticker Twelve Data du catalogue existant).
  Le spread perp−spot est **hors scope v1** : l'adaptateur Binance est spot-only (aucun support fapi dans
  `binance.ts`/`pairs.ts`, vérifié) — il reviendra si/quand un adaptateur perp existe.
- Presets et derniers synthétiques utilisés persistés (localStorage, clé dédiée, via `persist.ts`).

### Limitations v1 (assumées, affichées si pertinent)

- Pas de synthétiques dans la watchlist ni le screener ni les alertes.
- Dérivés (OI/funding), orderflow, DOM, replay : non applicables.
- 2 jambes max, opérateurs `/` et `-` uniquement, pas de coefficient ni de formule libre.
- Persistance : `ChartState.symbol` = symbole encodé + `exchange: "synthetic"` ; clé de dessins existante
  `exchange:symbol` fonctionne sans modification.

### Critères d'acceptation

1. `ETHUSDT/BTCUSDT@binance,binance` s'affiche en live sur tous les TF communs, RSI et fibs posables dessus.
2. `BTCUSDT/DXY@binance,twelvedata` en 1d affiche l'historique complet, forward-fill hors séance, badge visible.
3. Reload → le chart synthétique et ses dessins/indicateurs sont restaurés.
4. Toggles orderflow/VP grisés sur un synthétique ; pane Volume masqué.
5. Tests : `parseSyntheticSymbol` (valides/invalides), `combineKlines` (golden values main-calculées :
   ratio, spread, forward-fill, buckets manquants, re-clamp H/L, division par zéro).

---

## 2. SEAG — Saisonnalité

- **Fenêtre** `SeasonalityWindow` : entrée `windowManager` (id `seasonality`), mnémonique **`SEAG`**,
  menu « Fonctions », groupe-couleur (suit le symbole du groupe).
- **3 vues** (onglets) :
  - *Mensuelle* : heatmap année × mois (rendement % du mois), tout l'historique daily disponible
    (pagination `fetchKlines` existante, par lots de 1000) ;
  - *Jour de semaine* : lun→dim, sur l'historique daily ;
  - *Heure du jour* : 0→23 h UTC (mention explicite du fuseau), klines 1h des 90 derniers jours.
- **Par cellule** : rendement moyen, médian, win-rate, N (au survol) ; ligne/colonne de synthèse
  (moyenne par mois toutes années confondues). Couleur divergente rouge↔vert via les tokens du thème actif.
- **Moteur pur** `apps/web/src/lib/seasonality.ts` : `bucketReturns(candles, mode)` →
  `{ bucket, mean, median, winRate, n }[]` ; golden tests à la main (petites séries construites).
- Données via le cache `/candles` du daemon quand présent (chemin existant), sinon direct.
- Rendu heatmap : **canvas** (cohérent avec treemap IMAP maison), pas de dépendance.

**Acceptation** : SEAG sur BTCUSDT affiche ≥ 5 ans de vue mensuelle ; changement de symbole du groupe
→ la fenêtre suit ; tests moteur verts.

---

## 3. VOL — Analytics de volatilité

### 3a. Indicateur `RV` (`@axiom/indicators`, catégorie `volatility`)

- Vol réalisée close-to-close annualisée : `RV = stdev(log-returns, N) × √(barsPerYear)` avec
  `barsPerYear` dérivé du timeframe et **√365 j** en base (crypto 24/7) ; N paramétrable (défaut 30).
- Fichier + test dédiés selon la convention du package (un fichier par indicateur, golden test).
- S'affiche en sous-pane partout, y compris sur les synthétiques.

### 3b. Fenêtre `VOL`

- Entrée `windowManager` (id `vol`), mnémonique **`VOL`**, menu « Fonctions », groupe-couleur.
- **Cône de volatilité** : percentiles 5/25/50/75/95 de RV par horizon 7/14/30/60/90 j, calculés sur
  ~2 ans de daily (pagination existante) ; RV courante superposée par horizon → lecture immédiate
  « cher/pas cher ».
- **RV vs IV** : DVOL Deribit (`fetchDvol` existant + historique `get_volatility_index_data`) superposé
  à la RV 30 j → **VRP** (IV − RV) affiché. BTC/ETH uniquement ; autres symboles : message explicite
  « IV indisponible (Deribit ne cote que BTC/ETH) », le cône RV reste affiché.
- **Z-score de RV** (RV courante vs distribution 2 ans) affiché en en-tête.
- **Moteur pur** `apps/web/src/lib/volCone.ts` : `realizedVol(closes, n, barsPerYear)`,
  `volCone(closes, horizons, percentiles)` ; golden tests.
- Rendu : canvas simple (percentiles en bandes + points RV), tokens de thème.

**Acceptation** : cône BTC avec bandes + RV courante + DVOL superposé ; SOL → cône seul + message IV ;
tests moteur verts.

---

## 4. Footprint pro

Couche analytique **au-dessus du rendu existant** (`chart/orderflow.ts`), calculs extraits dans un
module pur `apps/web/src/chart/footprintAnalytics.ts` :

- `detectImbalances(bar, ratio)` : imbalances **diagonales** bid/ask (comparaison ask[i] vs bid[i+1tick]),
  seuil ratio paramétrable, **défaut 300 %**, volume minimal pour éviter les faux positifs sur niveaux vides ;
  détection des **stacked ≥ 3** consécutives (surlignage renforcé).
- `valueArea(bar, 0.70)` : POC (niveau de volume max), VAH/VAL à 70 % — par bougie.
- `deltaDivergence(bars)` : plus-haut de prix avec delta ≤ 0 (et symétrique) → flag.

Rendu (dans `OrderflowController`) : contour/teinte sur les cellules en imbalance, liseré sur les stacked,
marqueur POC par bougie, value area optionnelle (bande), triangle de divergence au-dessus de la bougie.
**Toutes les couleurs via `readToken`** — ce qui résout au passage la dette « couleurs en dur
orderflow.ts:562-597 » (seule dette existante touchée par ce lot, car sur le chemin).

Réglages : section orderflow existante — toggles par analytique (imbalances / POC / value area /
divergences) + champ seuil %. Persistés avec les réglages actuels.

**Acceptation** : sur BTCUSDT 1m live, imbalances et POC visibles et cohérents avec les volumes affichés ;
zéro couleur en dur restante dans le rendu footprint ; tests purs sur les 3 fonctions (barres construites
à la main, cas limites : bougie vide, un seul niveau, égalité de volumes).

---

## 5. VPFR — Volume profile à plage fixe

- Nouvel outil dans `DrawingToolbar` : « VP plage » — 2 clics (bougie de début, bougie de fin).
- Overlay custom KLineChart tracké (pattern `createTrackedOverlay` de `chart/drawing.ts`) : rectangle
  discret sur la plage + rendu du profil (barres horizontales, POC/VAH/VAL) **réutilisant le moteur de
  `store/volumeProfile.ts`** appliqué aux seules bougies de la plage.
- Persisté/restauré comme tout dessin (SavedPoint × 2, clé `exchange:symbol` existante) ; recalcul quand
  le backfill étend les données de la plage.
- Sur un synthétique : outil grisé (volume = 0).

⚠️ **Dette héritée documentée** : le moteur VP est désaligné en échelle log/% (dette A3, hors scope ici) ;
le VPFR présentera le même défaut tant que la dette n'est pas purgée. Ne pas « re-découvrir » ce point en
revue.

**Acceptation** : poser un VPFR sur 3 plages, reload → restaurés ; POC/VAH/VAL cohérents avec le VPVR
global sur la même plage ; suppression via le flux de suppression de dessins existant.

---

## 6. Tests & vérification de fin de lot

- **Unitaires** (vitest, conventions du repo) : synthetic (parse/combine), seasonality, volCone/RV,
  footprintAnalytics, + test d'intersection `syntheticTimeframes`.
- **Typecheck/build** : `pnpm -r typecheck && pnpm -r test && pnpm --filter @axiom/web build` verts.
- **Runtime (manuel, navigateur, mode daemon prod)** :
  1. ETH/BTC live + RSI + fib, reload OK ;
  2. BTC/DXY daily avec forward-fill + badge (à vérifier un soir/week-end ou en simulant `isMarketOpen`) ;
  3. SEAG BTCUSDT (3 vues) ;
  4. VOL BTC (cône + DVOL) puis SOL (message IV) ;
  5. footprint 1m avec imbalances/POC ;
  6. VPFR posé, reload, supprimé.
- Captures d'écran de fin de lot (convention du projet).

## Hors scope (rappel)

- Watchlist/screener/alertes sur synthétiques ; formules libres ; coefficient de jambe ; spread perp−spot
  (nécessite un adaptateur Binance futures inexistant).
- Fix du VP en log/% (dette A3) ; réutilisation d'instance KLineChart (dette A2) ; smoke Playwright (dette A1).
- Lots C2 (YC, ETF flows, pipeline screener, DES) et D (news/FTS/copilote) : specs séparées à venir.

## Risques identifiés

| Risque | Mitigation |
|---|---|
| Buckets Kraken/Coinbase aux bornes non alignées sur Binance (bougies 4h décalées) | Alignement par bucket calculé depuis le TF (floor du timestamp), testé ; si une source émet des bornes exotiques, la jambe est rejetée avec message clair plutôt que composée de travers |
| Quota Twelve Data (8 req/min, ~800/j) consommé par la jambe tradfi | La jambe passe par l'adaptateur existant (cache + compteur HealthPanel déjà en place) ; TF < 1h déconseillés sur cross-source (mention UI) |
| Ré-émission synthétique à chaque tick des 2 jambes = double fréquence | Bougie synthétique recalculée en O(1) (dernier état des 2 jambes en cache), throttle rAF existant côté chart |
| `PaneOptions` KLineChart : pas d'API pane exotique pour la heatmap/cône | SEAG et VOL sont des **fenêtres** canvas indépendantes du chart, pas des panes |
