# Lot D1 — Consolidation chart + indicateurs « terminal » (design)

> **Spec validée en brainstorming le 2026-07-07.** Périmètre décidé avec Zaki : les 3 vigilances
> techniques restantes de P4/C1 + les 4 familles d'extensions indicateurs de la roadmap
> (`docs/research/03-roadmap-bloomberg-perso.md` §Indicateurs). Le smoke test Playwright a été
> explicitement écarté de ce lot.
>
> Structure retenue : **lot unique, volet chart d'abord, volet indicateurs ensuite** — le refactor
> de cycle de vie de `ChartInstance` précède tout ce qui s'y intègre (rafraîchissement intra-bougie,
> séries auxiliaires), pour ne coder l'intégration qu'une fois.

## Contexte

- Baseline : `main@5f2101d` (fin du Lot C1), suite complète verte (701 web + 226 indicators +
  88 daemon + 17 alerts + 14 backtest = 1046 tests), typecheck 6 packages OK.
- Le périmètre du doc 04 (RATE/COT/GEX-DEX) est **déjà livré** (commits `467ba20`, `5614a51`,
  `091e0a2` du 2026-07-03) — vérifié avant ce design, ne pas re-livrer.

## Périmètre — 7 chantiers en 2 volets

### Volet chart

**① Réutilisation d'instance KLineChart (fix flash au changement de TF).**
Aujourd'hui `apps/web/src/chart/ChartInstance.tsx` a un seul `useEffect` de deps
`[exchange, symbol, timeframe, slot, isMaster, replayGen]` qui `dispose(chart)` (ligne ~575) et
`init()` à chaque changement → flash visuel + reconstruction de tous les contrôleurs.

Cible — scinder en deux effets :
- **Effet montage** (par slot) : `init(chartDom)` une fois, `dispose` au démontage du slot
  uniquement. Le nœud canvas persiste → plus de flash.
- **Effet données** (deps `exchange/symbol/timeframe/replayGen`) : annule le backfill en vol,
  désabonne le WS (garde par génération contre les fuites/courses), backfill REST →
  `applyNewData` (API déjà utilisée, lignes ~422/519) → resouscription WS.
- Les **contrôleurs** (orderflow, compare, macro, revenue, volumeProfile, paneHeaders,
  derivatives) restent détruits/recréés dans l'effet données — bon marché, évite d'ajouter des
  méthodes `setTimeframe` partout. Seule l'instance chart survit.
- Les panes d'indicateurs actifs sont re-appliqués après `applyNewData`.
- La capture de viewport avant `dispose` (ligne ~115) ne sert plus qu'au démontage du slot ;
  au changement de TF le comportement existant (viewport préservé par slot) est conservé.
- Registre des dessins par chart : inchangé (déjà par symbole).

**② Volume profile (VPVR) en échelle log/%.**
`apps/web/src/chart/volumeProfile.ts` mappe prix→pixel linéairement → désaligné hors échelle
normale. Remplacer par `chart.convertToPixel` par borne de bin (24-48 bins, coût négligeable),
comme le fait déjà le VPFR (`volumeRangeOverlay.ts`, C1). Critère : en échelle log, le POC du
VPVR coïncide avec celui d'un VPFR posé sur la même plage.

**③ Sous-panes en grille + broutilles.**
- Partage explicite par coût : sous-panes **poll-based** (OI, FUND — Coinalyze) disponibles sur
  **tous les slots** de la grille ; sous-panes **WS lourds** (CVD, footprint — aggTrade) restent
  liés au slot maître, avec un **badge UI explicite** « slot maître » (fin du silence).
- Mnémonique treemap : `MAP` devient le mnémonique principal, `IMAP` conservé comme alias dans
  la palette ⌘K (mémoire musculaire).
- ~~Ticker watchlist multi-source~~ — **RETIRÉ à l'écriture du plan (2026-07-07)** : déjà livré
  en P0 (`data/ticker.ts` route kraken/coinbase/mexc en polling REST 30 s). Ne pas refaire.

### Volet indicateurs

**④ Dettes moteur (`@axiom/indicators` + bridge `apps/web/src/chart/indicators.ts`).**
- **Rafraîchissement intra-bougie** : recalcul complet throttlé à **500 ms** sur les ticks
  intra-bougie (full-recalc trivial à 500 bougies). Supprime le RSI « en retard d'une bougie ».
  Throttle : réutiliser `rafThrottle.ts` ou un timer simple — pas de nouveau mécanisme.
- **Input `source`** : `engine.ts` résout `source` (`close` défaut, `open/high/low/hl2/hlc3/ohlc4`)
  en série dérivée avant calcul pour les indicateurs mono-série. Test : RSI(hlc3) ≠ RSI(close)
  sur fixture connue.
- **Pivots sessionnés** : calcul **par session UTC** (jour calendaire) — chaque jour affiche les
  niveaux dérivés de la session précédente.
- **VWAP session** : reset à minuit UTC (remplace le VWAP « depuis le début du chargement »).
- **AVWAP** : ancrage par **timestamp** (stable au backfill gauche) au lieu d'un index, + outil
  d'ancrage **par clic** dans la barre de dessin (flux overlay 1-point existant).

**⑤ Séries auxiliaires — extension de contrat.**
- Le moteur reste **pur et synchrone** : aucun fetch dans `@axiom/indicators`.
- `IndicatorDef` peut déclarer `aux: ("oi" | "funding" | "stablecoins" | "nvt" | "mvrv")[]` ;
  `computeIndicator` reçoit un paramètre optionnel `aux` (séries alignées sur les timestamps
  des bougies).
- Côté app, un **AuxProvider** (bridge) fetch (Coinalyze : OI/funding ; DefiLlama : stablecoins ;
  Coin Metrics : NVT/MVRV), aligne par timestamp (dernière valeur connue ≤ t), mémoïse par
  `(symbole, timeframe)`.
- Chaque indicateur aux déclare son **TF minimum** : NVT/MVRV = 1d (grisé en dessous dans le
  menu) ; OI/funding dispo dès la granularité Coinalyze le permet.
- La catégorie `derivatives` (vide) se peuple : Open Interest, Funding Rate, Supply Stablecoins,
  NVT, MVRV.
- Dégradation : fetch aux en échec (rate-limit) → « Indisponible » dans le pane (pattern
  MacroPanel), jamais de série silencieusement vide.

**⑥ Tier 1 edge crypto (doc 02).**
- **Divergence CVD spot vs perp** : nouveau flux WS aggTrade **Binance Futures**
  (`fstream.binance.com`) en parallèle du flux spot, Binance-only (comme le footprint). Sous-pane
  « CVD S/P » : les deux CVD superposés + marqueurs de divergence sur fenêtre glissante. La
  détection est une **fonction pure testée** (pattern `detectDeltaDivergences` de C1). Vit dans
  `chart/orderflow.ts` (flux de trades, pas OHLCV → pas dans `@axiom/indicators`).
- **Funding z-score** : indicateur `@axiom/indicators` pur consommant la série aux `funding`
  (fenêtre 30 échantillons, paramétrable). Zéro nouveau réseau.
- **ATR régime** : indicateur pur OHLCV — percentile roulant de l'ATR (0-100) en sous-pane.

**⑦ Golden tests + validation params.**
- Script Python **test-only** `scripts/golden/` (hors chemin de build ; BUILD-CONTRACT :
  « pandas-ta-classic en test seulement ») génère des fixtures JSON de référence pour
  **ADX, SuperTrend, Ichimoku, PSAR** sur un jeu OHLCV figé et commité.
- Vitest compare à tolérance près ; chaque divergence de convention d'amorçage connue est
  **documentée dans le test** — pas de tolérance élargie silencieuse.
- `resolveParams` : validation min/max (RSI période 0 ou -5 → rejet propre, pas de NaN).

## Hors périmètre (explicitement)

- Smoke test Playwright (écarté par Zaki pour ce lot).
- Refactor des contrôleurs en « update-in-place » (`setTimeframe`) — recréation conservée.
- CVD spot/perp multi-exchange (Binance-only, comme le footprint).
- Toute nouvelle source réseau payante ou à clé (budget 0 $/mois inchangé).

## Vérification de fin de lot

1. `pnpm -r typecheck && pnpm -r test && pnpm --filter @axiom/web build` — tout vert
   (≥ 1046 tests actuels + nouveaux).
2. Runtime en mode prod daemon (`pnpm prod`) :
   - changement de TF **sans flash** (mono-chart ET grille 2×2) ;
   - VPVR aligné en échelle log (POC = celui d'un VPFR sur la même plage) ;
   - OI/FUND ouverts sur un slot non-maître ; badge « slot maître » sur CVD/footprint ;
   - RSI à la bougie près (intra-bougie) ; VWAP session ; AVWAP posée au clic survit au backfill ;
   - indicateurs OI / funding z-score affichés ; NVT grisé sous 1d ;
   - CVD S/P avec divergences plausibles sur BTCUSDT 1m ;
   - ticker watchlist correct avec source Kraken.
3. Captures de fin de lot (`~/axiom-d1-*.png`).

**Critère de succès global** : suite complète verte, zéro régression sur la checklist, changement
de TF instantané à l'œil.
