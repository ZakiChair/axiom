# Lot v2.3 — Bouton « Stratégies » dédié + nouvelles stratégies backtestées

Date : 2026-07-28 · Registre indicateurs : 167 → 172 · Origine : demande Zaki
(« mettre ces stratégies dans un bouton dédié comme Indicateurs ou orderflow ;
ajouter de nouvelles stratégies pertinentes ; stratégies que tu backtestes si
possible »). Design validé en brainstorming (foyer exclusif, validation +
presets BT, catalogue de 5 dont un « champion » choisi empiriquement).

**Constat fondateur** : `IndicatorMenu.tsx` est un composant autonome (bouton +
panneau + clic-extérieur + navigation clavier) dont les briques réutilisables
sont déjà exportées ou extractibles (`InstanceParamsEditor`, `indexRoving`) ;
`runBacktest(candles, strat, params)` (`packages/backtest/src/engine.ts:292`)
est appelable depuis un script avec des bougies fournies — la validation
backtestée scriptée est faisable sans toucher au moteur. La fabrique
`defStrategie` (v2.2) rend chaque nouvelle stratégie ~30 lignes.

Invariants BUILD-CONTRACT + acquis v2.1/v2.2 : calculs PURS ; fabrique
`defStrategie` pour toute stratégie (anti-repaint, matérialisation silencieuse,
cap 60, PnL hors frais au close du signal) ; extractions de cœurs = refactor
pur prouvé (patron `rsiOf`, tests existants inchangés, golden compris) ;
fixtures prouvées non tautologiques ; docblocks FR ; `pnpm check` vert par
branche + post-merge ; gate visuel in-page en fin de lot.

**Règle d'honnêteté du lot (prime sur tout le reste)** : aucun chiffre de
backtest n'est présenté comme une promesse. Les résultats sont des mesures
PASSÉES, in-sample pour la sélection ; le rapport les étiquette comme telles.
Si aucun candidat champion ne passe les critères de robustesse, on livre le
meilleur candidat avec son étiquette réelle (« champion relatif, non robuste »)
— jamais un mirage sur-ajusté.

---

## 1. Menu « Stratégies » dédié (foyer exclusif)

- Nouveau composant `apps/web/src/components/StrategyMenu.tsx` : bouton
  « Stratégies » dans la Toolbar, immédiatement à côté du bouton
  « Indicateurs » (même classes, badge = nb d'instances de stratégies actives,
  sinon nb de defs). Panneau au même patron qu'`IndicatorMenu` : section
  « Actives » (instances de stratégies uniquement — ⧉/✎/✕ + éditeur de params
  via `InstanceParamsEditor`), recherche, catalogue plat (une seule catégorie —
  pas de sections repliables), navigation clavier ↑/↓/Home/End + Échap,
  fermeture au clic extérieur. Grisage `minTimeframe`/synthetic identique.
- **Pas d'abstraction générique** : `StrategyMenu` est un composant dédié qui
  réutilise les briques exportées (`InstanceParamsEditor` — l'exporter
  d'`IndicatorMenu.tsx` si privé —, `indexRoving`). Deux menus, deux
  évolutions futures indépendantes (le menu stratégies pourra afficher un PnL
  par instance un jour).
- `IndicatorMenu` : filtre `category !== "strategy"` sur le CATALOGUE et sur
  la section ACTIFS ; compteur basé sur la liste filtrée (152). `CATEGORY_LABELS`
  /`CATEGORY_ORDER` gardent l'entrée `strategy` (inoffensive : la catégorie
  filtrée ne produit plus de section) ou la retirent — au choix du plan, mais
  le menu Indicateurs ne doit plus JAMAIS montrer une stratégie.
- Palette ⌘K : inchangée (elle liste tout le registre — les stratégies restent
  activables par la palette).
- La persistance des instances (`store/indicators.ts`) est commune et
  inchangée : seul l'AFFICHAGE est partitionné par catégorie.

## 2. Cinq nouvelles stratégies (registre 167 → 172)

Extractions de cœurs préalables (refactor pur, AUCUN test existant modifié) :
`ttmSqueezeOf` (volatility/ttmSqueeze.ts → `{ on, mom }`), `ichimokuOf`
(trend/ichimoku.ts → au minimum `{ senkouA, senkouB }` alignés sur les bougies,
AVEC leur décalage kumo standard tel que le def les trace), `adxOf`
(trend/adx.ts → série ADX), `psarOf` (trend/psar.ts → `{ sar, direction }` ou
équivalent — vérifier la forme réelle du def avant d'extraire).

Toutes via `defStrategie` (dossier `packages/indicators/src/strategy/`) :

| Def | Nom | Sens | Règle `position` (défauts) |
|---|---|---|---|
| `stratSqueezeBreakout` | Stratégie squeeze breakout | long/short | armé après ≥ `dureeMin` (3) barres de squeeze ON ; à la LIBÉRATION (ON→OFF), entrée dans le sens du momentum TTM (`mom` > 0 → long, < 0 → short) ; sortie quand le momentum change de signe ; re-armement au prochain squeeze. Inputs : `length` 20, `multBB` 2, `multKC` 1.5, `dureeMin` 3 |
| `stratIchimokuKumo` | Stratégie Ichimoku kumo | long/short | close > max(senkouA, senkouB) → 1 ; close < min(A, B) → −1 ; DANS le nuage → 0. Inputs : `tenkan` 9, `kijun` 26, `senkouB` 52 |
| `stratMmAdx` | Stratégie MM + filtre ADX | long/short | signe(MM rapide − lente) comme stratCroisementMM MAIS position ≠ 0 uniquement si ADX ≥ `seuilAdx` ; ADX < seuil → 0 (flat forcé, y compris sortie d'une position en cours). Inputs : `type` ema/sma, `rapide` 9, `lente` 21, `adxLength` 14, `seuilAdx` 25 |
| `stratPsar` | Stratégie PSAR | long/short | direction du Parabolic SAR (prix au-dessus du SAR → 1, en dessous → −1). Inputs : ceux du def psar (start/increment/max — reprendre ses clés exactes) |
| `stratChampion` | (nom fixé par la campagne §3) | selon règles | UNIQUEMENT des cœurs existants ; règles figées par la campagne de backtest AVANT l'implémentation du def (le plan liste les candidats, la campagne tranche, le def encode le gagnant) |

Chaque def : docblock FR expliquant la logique de trading ET renvoyant aux
résultats de backtest consignés (§3) — première fois qu'un def cite des
mesures : formulation type « backtest 2024-2026 BTC/ETH 1h/4h : voir
docs/superpowers/research/2026-07-28-backtest-strategies.md ; mesures passées,
pas une promesse ».

## 3. Campagne de backtest scriptée

**Script** : `scripts/valider-strategies.ts` (Bun, réutilisable — commité).

- **Données** : klines Binance spot via l'API publique (`/api/v3/klines`,
  pagination 1000, aucun proxy nécessaire en script Node/Bun), BTCUSDT et
  ETHUSDT, 1h et 4h, ~2 ans (2024-07 → 2026-07). Cache disque local
  (`scripts/.cache-klines/`, gitignoré) pour itérer sans marteler l'API.
- **Rejeu chart-fidèle** : pour CHAQUE stratégie (12 = 7 v2.2 + 5 nouvelles),
  rejouer sa fonction `position` via `computeIndicator(def, candles)` et
  reconstruire les trades close-à-close (mêmes conventions que la fabrique —
  hors frais). Stats : nb trades, win rate, PnL cumulé %, expectancy (moyenne
  des PnL %), max drawdown sur equity composée, durée moyenne.
- **Contre-épreuve moteur BT** : pour les stratégies EXPRIMABLES dans le
  modèle déclaratif (`stratCroisementMM`, `stratRsiReversion`,
  `stratMacdCross`, `stratSupertrend` [direction > 0], `stratBollingerReversion`,
  `stratMmAdx` — PAS Donchian [canal des N précédentes inexprimable], PAS
  divergence [pivots], PAS squeeze/ichimoku/psar sauf si trivialement
  exprimables), exécuter AUSSI `runBacktest` (fill à l'open + frais 0,05 % +
  slippage 0,02 %) — l'écart signal-au-close vs exécution-réaliste devient une
  MESURE consignée, plus un avertissement théorique.
- **Anti-overfit** : chaque mesure est rendue séparément sur les deux MOITIÉS
  temporelles de la période, pour les 4 cellules symbole×TF.
- **Champion** : 6 candidats FIGÉS, composés de cœurs existants :
  (1) Supertrend filtré ADX ≥ 25 ; (2) croisement MM 9/21 confirmé RSI > 50 ;
  (3) Donchian 20 avec sortie trailing ATR ×3 ; (4) squeeze breakout filtré
  par la tendance kumo ; (5) croisement MACD filtré par la direction
  Supertrend ; (6) PSAR filtré ADX ≥ 25. Critères PRÉ-DÉCLARÉS (avant de voir
  les chiffres) : expectancy > 0
  dans les 4 cellules ET dans chaque moitié temporelle ; départage par
  expectancy médiane. Aucun réglage de params par cellule (un seul jeu de
  défauts partout — pas de grid-search par marché).
- **Rapport** : `docs/superpowers/research/2026-07-28-backtest-strategies.md`
  (commité) — tableaux chiffrés par stratégie/cellule/moitié, méthodo, limites
  (hors frais côté chart, une seule paire de TF, pas de walk-forward),
  résultat de la sélection du champion (y compris s'il est « relatif »).

## 4. Presets builtin de la fenêtre BT

Dans `apps/web/src/store/backtest.ts` : ajouter des `StrategiePreset` builtin
pour les stratégies exprimables (§3) — `builtin:macd-cross`,
`builtin:supertrend` (ConditionComparaison sur l'output `direction` du def
`supertrend`), `builtin:bollinger-reversion`, `builtin:mm-adx` — avec les
MÊMES défauts que les defs de stratégie (tf 1h ou 4h selon les résultats de la
campagne). Les deux presets historiques (`builtin:rsi`, `builtin:ema-cross`)
sont conservés tels quels (déjà jumeaux de stratRsiReversion/stratCroisementMM).
Si le CATALOGUE_OPERANDES du builder ne connaît pas un indicateur requis
(supertrend/adx), l'y ajouter (entrée curée, patron existant).

## 5. Tests, gates, hors-scope

- **Menu** : tests du filtre (IndicatorMenu ne liste plus les stratégies ;
  StrategyMenu ne liste qu'elles) si l'infra de test composant existe — sinon
  gate visuel ; vérifier qu'AUCUN test existant ne compte les 167 entrées du
  menu Indicateurs.
- **Stratégies** : contrat + fixture prouvée par def (patron v2.2, gardes
  anti-tautologie, mutation-kill pour les non-traçables) ; extractions = tests
  existants inchangés ; registre 167 → 172, liste triée des 20 ids strategy.
- **Script** : les fonctions PURES du script (reconstruction des trades
  close-à-close, stats, split temporel) sont extraites et testées
  (`scripts/valider-strategies.test.ts` ou dans le package backtest si mieux
  placé) ; le fetch/cache reste non testé (I/O).
- **Presets BT** : test du store existant étendu si présent (forme des presets).
- **Gate visuel** : bouton « Stratégies » à côté d'Indicateurs, foyer exclusif
  prouvé (une stratégie active n'apparaît QUE dans son menu ; Indicateurs à
  152), les 5 nouvelles stratégies rendent leurs marqueurs, fenêtre BT montre
  les nouveaux presets et un run fonctionne.
- **Hors-scope (frigo)** : bouton « Backtester » pré-rempli depuis le menu
  Stratégies ; PAPER/EXPY depuis une stratégie ; alertes sur signal ;
  walk-forward/optimisation de params ; PnL par instance dans le menu.
