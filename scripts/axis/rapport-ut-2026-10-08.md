# AXIS — autres unités de temps : test sur données jamais vues, 8 octobre 2026

Généré par `scripts/valider-axis-ut.ts`. Manifeste figé `05ed40f0762578cf57c14cabf4db47c2e6a8141cf898edaf439bff989ea6c068` (`scripts/axis/manifeste-ut-2026-10-08.json`, figé avant tout téléchargement de ces données). **Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.**

## Verdicts pré-déclarés par unité

| Unité | Fenêtre | Cellules | Signaux | Trades x1 (clos) | Exp. nette x1 % | p timing | Forts achats | N | Moyenne 12 (bps) | p |
|---|---|---|---|---|---|---|---|---|---|---|
| 1s | 12 h, 7 octobre 2026 | 42/42 | DÉFAVORABLE | 7407 (7391) | -0.166 | = 1.0000 | DÉFAVORABLE | 31877 | 0.0 | = 0.5242 |
| 1m | 30 jours, sept.-oct. 2026 | 42/42 | DÉFAVORABLE | 15597 (15564) | -0.167 | = 1.0000 | DÉFAVORABLE | 73234 | 0.6 | = 0.2382 |
| 3m | 90 jours, juil.-oct. 2026 | 42/42 | DÉFAVORABLE | 15201 (15172) | -0.184 | = 1.0000 | DÉFAVORABLE | 67417 | 0.2 | = 0.9034 |
| 5m | 150 jours, mai-oct. 2026 | 42/42 | DÉFAVORABLE | 14609 (14585) | -0.229 | = 1.0000 | DÉFAVORABLE | 61255 | -1.6 | = 0.9806 |
| 15m | oct. 2025-oct. 2026 | 42/42 | DÉFAVORABLE | 11067 (11060) | -0.284 | = 0.9948 | DÉFAVORABLE | 36741 | -9.8 | = 1.0000 |
| 30m | oct. 2024-oct. 2026 | 42/42 | DÉFAVORABLE | 10697 (10695) | -0.176 | = 0.6856 | DÉFAVORABLE | 28650 | -14.5 | = 0.9998 |
| 1h | oct. 2023-oct. 2026 | 42/42 | DÉFAVORABLE | 7900 (7899) | 0.058 | = 0.4804 | DÉFAVORABLE | 18247 | -19.2 | = 0.9990 |
| 2h | 2020-2026 | 40/42 | DÉFAVORABLE | 8094 (8091) | 1.644 | = 0.1048 | DÉFAVORABLE | 18507 | -23.6 | = 0.9968 |
| 6h | 2020-2026 | 40/42 | DÉFAVORABLE | 2423 (2407) | 7.379 | = 0.0742 | DÉFAVORABLE | 6193 | -67.6 | = 0.9934 |
| 12h | 2020-2026 | 40/42 | DÉFAVORABLE | 1095 (1061) | 20.237 | = 0.0552 | DÉFAVORABLE | 3119 | -83.8 | = 0.9452 |
| 1d | 2020-2026 | 40/42 | DÉFAVORABLE | 471 (439) | 35.764 | = 0.1208 | DÉFAVORABLE | 1724 | 46.2 | = 0.1785 |
| 3d | 2020-2026 | 40/42 | DÉFAVORABLE | 105 (101) | -7.497 | = 0.8381 | DÉFAVORABLE | 649 | 123.6 | = 0.1451 |
| 1w | 2020-2026 | 40/42 | NON CONCLUANT | 4 (2) | 26.251 | = 1.0000 | DÉFAVORABLE | 275 | 590.1 | = 0.0858 |

- **Signaux** (regroupés sur les cellules disponibles de l'unité) — S1 : expectancy nette > 0 aux coûts x1 ET x3 ; S2 : timing, p ≤ 0.0038 ; S3 : PnL net x1 > 0 dans plus de la moitié des cellules ayant un trade ; S4 : rejeu hors frais, expectancy > 0 dans chaque moitié. Au moins 100 trades clos regroupés.
- **Forts achats** — F1 : rendement signé à 12 bougies, p unilatérale ≤ 0.0038 ; F2 : moyenne > 0 dans plus de la moitié des cellules ayant un fort achat ; F3 : moyenne regroupée > coût aller-retour x1 (0.14 %). Au moins 100 forts achats regroupés.
- Au moins 75 % des cellules de l'unité disponibles, sinon NON CONCLUANT. Seuil 0.0038 = 0,05 / 13 (Bonferroni sur les treize unités de chaque famille). Si la fenêtre ne permet pas d'atteindre ce seuil (plancher 1 / (décalages + 1) > 0.0038), S2 ou F1 est insuffisant : NON CONCLUANT, sauf autre bloc en échec.
- Non mesurables par construction : 1M, 3M, 6M, 12M (historique trop court) ; 4h : tests du 7 et du 8 octobre, inchangés.

## Protocole

- **Signaux** : AXIS v2 aux défauts livrés (achat à score ≥ +5/6 avec close au-dessus de l'EMA 200, vente à score ≤ −4/6). Long pendant un achat affiché, à plat sinon. 300 bougies de warmup ; `runBacktest`, décision à la clôture, fill à l'open suivant, taille fixe 1000 USDT ; coûts par côté x1-central = 0.05 % + 0.02 % ; x2 = 0.1 % + 0.04 % ; x3 = 0.15 % + 0.06 %. Timing : décalages circulaires de la position, un même k pour toutes les cellules de l'unité, k dans [⌊0.1 L⌋, ⌈0.9 L⌉[ (L = plus courte fenêtre) : tous quand il y en a au plus 4999 (p exacte), 4999 tirés sinon (graine 20261011).
- **Forts achats** : marqueurs « fort achat » d'AXIS (volume ≥ 3 × la SMA 20, sens du delta taker sinon du corps, hors bougies de signal et hors dernière bougie). 50 bougies de warmup ; décisions jusqu'à n − 2 − 42 ; rendement signé sens × ln(open[i+1+h] / open[i+1]). Nul : décalages circulaires communs, mêmes règles (au plus 4999, graine 20261012) ; nul complémentaire descriptif : 4999 permutations des sens (graine 20261013). p arrondies vers le haut.
- **Données** : klines Binance Spot (`https://data-api.binance.vision/api/v3/klines`) avec volume taker, 42 alts jamais vues (toutes les paires USDT cotées avant 2020, hors actifs déjà vus et stablecoins) ; bougies à volume nul valides (émises sans transaction) ; au plus 1 % de bougies manquantes par cellule.
- **Code** : vérifié avant le premier téléchargement — 247 fichiers hors tests de packages/indicators/src, packages/backtest/src, packages/types/src (SHA-256 `3fcfaa2fedb5ea5cc47fc23cd235f7ab7394489d13af82582e95a4d25d5fa90e`), chemins figés identiques au commit `287e014560c4e69dd5762235a264f943bdf98604`. SHA-256 du runner : `059acc4af3c966b5d3975abeec8fcdc84f1a04874f7b85d945094ecc6c29c95b`.
- **Contrôles bloquants passés** (sinon : arrêt sans verdict, ce rapport n'existerait pas) : position = recalcul direct ; signaux (120 derniers) et forts mouvements (60 derniers) = marqueurs du chart ; causalité sur trois préfixes ; chronologie moteur = rejeu, coûts sans effet sur les fills, timing = moteur sans coût ; horizon et statistique des forts achats.

## 1s — 12 h, 7 octobre 2026

Fenêtre `2026-10-07T12:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 7407 trades (dont 7391 clos par règle), expectancy nette -1.664 USDT (-0.166 %) |
| Signaux | S1 | x3 | ❌ échec | 7407 trades (dont 7391 clos par règle), expectancy nette -4.461 USDT (-0.446 %) |
| Signaux | S2 | timing | ❌ échec | p = 1.0000 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -196.8 % log contre médiane nulle 15.1 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 0 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ❌ échec | 4163 trades clos, expectancy -0.031 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 3228 trades clos, expectancy -0.026 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 31877 forts achats, 0.0 bps en moyenne à 12 bougies (26.0 % de hausses), p unilatérale = 0.5242 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle 0.0 bps |
| Forts achats | F2 | cellules | ✅ tenu | moyenne > 0 dans 23 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée 0.0 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 7407 (7391) | -1.664 | -0.166 | -12324 | 8.8 |
| AXIS x2 | 7407 (7391) | -3.063 | -0.306 | -22686 | 3.6 |
| AXIS x3 | 7407 (7391) | -4.461 | -0.446 | -33044 | 1.8 |
| EMA 200 x1-central | 10755 (10733) | -1.634 | -0.163 | -17575 | 5.5 |
| EMA 200 x3 | 10755 (10733) | -4.431 | -0.443 | -47660 | 1.7 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 7391, -0.029 / 4163, -0.031 / 3228, -0.026 |
| Timing : capté / médiane nulle / 95e centile (% log) | -196.8 / 15.1 / 44.3 |
| Timing : p unilatérale (plus courte fenêtre) | = 1.0000 (42900 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 1.0000, capté -253.5 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 0 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 21 / 42 |
| Exposition moyenne / achat-conservation médian | 38.3 % / 1.2 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 31877 / 0.0 / 9 / 2.9 | 31877 / 0.0 / 12 / 2.5 | 31877 / 0.0 / 15 / 2.1 | 31877 / 0.1 / 20 / 1.6 | 31877 / 0.0 / 26 / 0.0 | 31877 / -0.1 / 32 / -1.6 | 31877 / -0.1 / 36 / -1.7 |
| Fortes ventes | 32412 / -0.0 / 7 / -2.7 | 32412 / -0.1 / 10 / -3.0 | 32412 / -0.1 / 12 / -3.3 | 32412 / -0.2 / 17 / -5.7 | 32412 / -0.3 / 22 / -7.6 | 32412 / -0.3 / 28 / -6.5 | 32412 / -0.5 / 32 / -7.1 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.5242 / = 0.9612 (43108 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | 0 / 0 / 0 |
| Forts achats nets de 0.14 % aller-retour (bps) | -14 |
| Fortes ventes : p bilatérale | ≤ 0.0002 |
| Cellules à moyenne > 0 / ayant un fort achat | 23 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | 0 / 0 / 0, = 1.0000 |
| Au-dessus / sous l'EMA 200 | 18881 / -0.1 / 25 / -1.0 ; 12833 / 0.1 / 28 / 1.5 |
| Par année (achats / ventes ; moyenne achats bps) | 2026 : 31877 / 32412 ; 0 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 1s | 43200 (0) | 121 | -191 | -0.16 | 37.4 | = 0.9960 | 328 / 607 | -0.6 |
| LTCUSDT 1s | 43200 (0) | 351 | -503 | -0.14 | 36.8 | = 0.7890 | 2150 / 1520 | 0.0 |
| QTUMUSDT 1s | 43200 (0) | 98 | -185 | -0.19 | 48.3 | = 1.0000 | 507 / 201 | -0.1 |
| IOTAUSDT 1s | 43200 (0) | 132 | -322 | -0.24 | 46.7 | = 1.0000 | 359 / 503 | -1.4 |
| XLMUSDT 1s | 43200 (0) | 340 | -577 | -0.17 | 41.0 | = 1.0000 | 1561 / 1387 | -0.2 |
| ONTUSDT 1s | 43200 (0) | 82 | -102 | -0.12 | 51.1 | = 0.4986 | 243 / 187 | 0.2 |
| TRXUSDT 1s | 43200 (0) | 518 | -811 | -0.16 | 29.6 | = 1.0000 | 1159 / 3390 | -0.6 |
| ETCUSDT 1s | 43200 (0) | 158 | -320 | -0.20 | 43.4 | = 1.0000 | 540 / 641 | -0.5 |
| VETUSDT 1s | 43200 (0) | 228 | -321 | -0.14 | 33.1 | = 0.4690 | 869 / 1258 | 0.1 |
| ONGUSDT 1s | 43200 (0) | 132 | -206 | -0.16 | 38.8 | = 0.9966 | 355 / 448 | -0.3 |
| HOTUSDT 1s | 43200 (0) | 54 | -148 | -0.27 | 45.7 | = 1.0000 | 122 / 236 | -0.6 |
| ZILUSDT 1s | 43200 (0) | 101 | -140 | -0.14 | 42.7 | = 0.6268 | 242 / 327 | 0.4 |
| FETUSDT 1s | 43200 (0) | 307 | -442 | -0.14 | 35.9 | = 0.8060 | 1599 / 1608 | -0.2 |
| ZRXUSDT 1s | 43200 (0) | 55 | -88 | -0.16 | 48.8 | = 0.9454 | 154 / 163 | -0.2 |
| BATUSDT 1s | 43200 (0) | 112 | -171 | -0.15 | 44.6 | = 0.9300 | 389 / 430 | 0.4 |
| ZECUSDT 1s | 43200 (0) | 414 | -574 | -0.14 | 35.5 | = 0.5624 | 2240 / 1771 | 0.6 |
| IOSTUSDT 1s | 43200 (0) | 99 | -157 | -0.16 | 43.6 | = 0.8752 | 286 / 335 | 0.9 |
| CELRUSDT 1s | 43200 (0) | 123 | -166 | -0.14 | 45.3 | = 0.7968 | 439 / 239 | 1.0 |
| DASHUSDT 1s | 43200 (0) | 288 | -399 | -0.14 | 39.1 | = 0.4050 | 1973 / 1019 | 0.2 |
| THETAUSDT 1s | 43200 (0) | 108 | -172 | -0.16 | 28.2 | = 0.9794 | 428 / 654 | -0.1 |
| ENJUSDT 1s | 43200 (0) | 211 | -303 | -0.14 | 38.7 | = 0.8120 | 1006 / 843 | 0.7 |
| ATOMUSDT 1s | 43200 (0) | 146 | -181 | -0.12 | 39.7 | = 0.1336 | 757 / 757 | 0.1 |
| TFUELUSDT 1s | 43200 (0) | 160 | -515 | -0.32 | 39.8 | = 1.0000 | 265 / 495 | -2.9 |
| ONEUSDT 1s | 43200 (0) | 154 | -259 | -0.17 | 17.6 | = 0.9988 | 993 / 1111 | 0.0 |
| ALGOUSDT 1s | 43200 (0) | 197 | -344 | -0.17 | 45.7 | = 1.0000 | 730 / 610 | 0.0 |
| DUSKUSDT 1s | 43200 (0) | 114 | -221 | -0.19 | 41.5 | = 1.0000 | 224 / 385 | -0.7 |
| ANKRUSDT 1s | 43200 (0) | 96 | -275 | -0.29 | 32.4 | = 1.0000 | 181 / 912 | -1.8 |
| WINUSDT 1s | 43200 (0) | 314 | -749 | -0.24 | 38.7 | = 1.0000 | 613 / 1127 | -2.5 |
| MTLUSDT 1s | 43200 (0) | 31 | -45 | -0.14 | 12.9 | = 0.6800 | 226 / 264 | 0.5 |
| CVCUSDT 1s | 43200 (0) | 141 | -216 | -0.15 | 42.8 | = 0.8702 | 590 / 401 | -0.3 |
| CHZUSDT 1s | 43200 (0) | 132 | -206 | -0.16 | 42.0 | = 0.9906 | 385 / 543 | 0.0 |
| BANDUSDT 1s | 43200 (0) | 86 | -155 | -0.18 | 27.3 | = 0.9492 | 356 / 408 | 0.8 |
| XTZUSDT 1s | 43200 (0) | 147 | -223 | -0.15 | 31.1 | = 0.9594 | 717 / 611 | 1.0 |
| RVNUSDT 1s | 43200 (0) | 141 | -174 | -0.12 | 42.0 | = 0.3588 | 756 / 478 | 0.6 |
| HBARUSDT 1s | 43200 (0) | 319 | -433 | -0.14 | 30.4 | = 0.0404 | 2174 / 1598 | 0.4 |
| KAVAUSDT 1s | 43200 (0) | 82 | -125 | -0.15 | 42.6 | = 0.9956 | 241 / 236 | 0.2 |
| STXUSDT 1s | 43200 (0) | 227 | -340 | -0.15 | 29.4 | = 0.5914 | 1536 / 1089 | -0.5 |
| ARPAUSDT 1s | 43200 (0) | 82 | -113 | -0.14 | 45.6 | = 0.6092 | 310 / 308 | -0.4 |
| IOTXUSDT 1s | 43200 (0) | 98 | -143 | -0.15 | 42.4 | = 0.8054 | 368 / 280 | 0.0 |
| RLCUSDT 1s | 43200 (0) | 333 | -578 | -0.17 | 28.7 | = 0.9934 | 1839 / 1638 | 0.4 |
| BCHUSDT 1s | 43200 (0) | 241 | -343 | -0.14 | 38.4 | = 0.5832 | 1353 / 1171 | 0.1 |
| FTTUSDT 1s | 43200 (0) | 134 | -388 | -0.29 | 44.7 | = 1.0000 | 314 / 223 | -1.5 |

</details>

## 1m — 30 jours, sept.-oct. 2026

Fenêtre `2026-09-08T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 15597 trades (dont 15564 clos par règle), expectancy nette -1.670 USDT (-0.167 %) |
| Signaux | S1 | x3 | ❌ échec | 15597 trades (dont 15564 clos par règle), expectancy nette -4.468 USDT (-0.447 %) |
| Signaux | S2 | timing | ❌ échec | p = 1.0000 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -558.0 % log contre médiane nulle 209.1 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 1 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ❌ échec | 7925 trades clos, expectancy -0.036 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 7639 trades clos, expectancy -0.073 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 73234 forts achats, 0.6 bps en moyenne à 12 bougies (44.0 % de hausses), p unilatérale = 0.2382 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle 0.4 bps |
| Forts achats | F2 | cellules | ✅ tenu | moyenne > 0 dans 24 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée 0.6 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 15597 (15564) | -1.670 | -0.167 | -26053 | 25.3 |
| AXIS x2 | 15597 (15564) | -3.069 | -0.307 | -47871 | 20.1 |
| AXIS x3 | 15597 (15564) | -4.468 | -0.447 | -69682 | 16.2 |
| EMA 200 x1-central | 38466 (38426) | -1.639 | -0.164 | -63058 | 10.1 |
| EMA 200 x3 | 38466 (38426) | -4.437 | -0.444 | -170660 | 5.8 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 15564, -0.054 / 7925, -0.036 / 7639, -0.073 |
| Timing : capté / médiane nulle / 95e centile (% log) | -558.0 / 209.1 / 559.6 |
| Timing : p unilatérale (plus courte fenêtre) | = 1.0000 (42900 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 1.0000, capté -1100.9 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 1 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 0 / 42 |
| Exposition moyenne / achat-conservation médian | 36.0 % / 14.5 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 73234 / 0.1 / 31 / 1.2 | 73234 / -0.0 / 36 / -0.1 | 73234 / 0.2 / 38 / 1.1 | 73234 / 0.4 / 41 / 2.1 | 73234 / 0.6 / 44 / 2.4 | 73234 / 1.2 / 46 / 3.5 | 73234 / 1.4 / 47 / 3.2 |
| Fortes ventes | 75879 / -0.3 / 31 / -3.9 | 75879 / -0.3 / 36 / -3.0 | 75879 / -0.3 / 38 / -2.3 | 75879 / -0.5 / 42 / -3.2 | 75879 / -1.1 / 44 / -5.3 | 75879 / -2.2 / 45 / -7.7 | 75879 / -3.6 / 45 / -9.8 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.2382 / = 0.2386 (43108 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | 0 / 0 / 1 |
| Forts achats nets de 0.14 % aller-retour (bps) | -13 |
| Fortes ventes : p bilatérale | = 0.0086 |
| Cellules à moyenne > 0 / ayant un fort achat | 24 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | 1 / 1 / 1, = 0.9438 |
| Au-dessus / sous l'EMA 200 | 42321 / 0.2 / 43 / 0.6 ; 30627 / 1.2 / 46 / 3.9 |
| Par année (achats / ventes ; moyenne achats bps) | 2026 : 73234 / 75879 ; 1 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 1m | 43200 (0) | 389 | -647 | -0.17 | 35.9 | = 0.9030 | 2062 / 2065 | 0.2 |
| LTCUSDT 1m | 43200 (0) | 387 | -552 | -0.14 | 39.0 | = 0.8144 | 996 / 1205 | 0.2 |
| QTUMUSDT 1m | 43200 (0) | 367 | -629 | -0.17 | 35.1 | = 0.9052 | 1946 / 2165 | -0.1 |
| IOTAUSDT 1m | 43200 (0) | 358 | -610 | -0.17 | 36.2 | = 0.9272 | 1727 / 2000 | 1.3 |
| XLMUSDT 1m | 43200 (0) | 378 | -590 | -0.16 | 37.7 | = 0.7868 | 1325 / 1420 | -1.6 |
| ONTUSDT 1m | 43200 (0) | 378 | -563 | -0.15 | 36.0 | = 0.6926 | 2123 / 2162 | 0.0 |
| TRXUSDT 1m | 43200 (0) | 247 | -290 | -0.12 | 38.8 | = 0.0062 | 1625 / 1506 | 0.6 |
| ETCUSDT 1m | 43200 (0) | 364 | -706 | -0.19 | 37.2 | = 0.9650 | 1766 / 1673 | 0.0 |
| VETUSDT 1m | 43200 (0) | 361 | -517 | -0.14 | 37.9 | = 0.6744 | 1711 / 1524 | -2.0 |
| ONGUSDT 1m | 43200 (0) | 375 | -878 | -0.23 | 35.4 | = 0.9936 | 1954 / 1982 | 1.2 |
| HOTUSDT 1m | 43200 (0) | 374 | -1007 | -0.27 | 32.3 | = 1.0000 | 1888 / 2089 | 1.4 |
| ZILUSDT 1m | 43200 (0) | 371 | -573 | -0.15 | 36.1 | = 0.7672 | 1946 / 1982 | 1.9 |
| FETUSDT 1m | 43200 (0) | 377 | -568 | -0.15 | 37.1 | = 0.7944 | 1192 / 1331 | 0.7 |
| ZRXUSDT 1m | 43200 (0) | 363 | -547 | -0.15 | 32.8 | = 0.7876 | 2096 / 2126 | -0.0 |
| BATUSDT 1m | 43200 (0) | 375 | -496 | -0.13 | 34.1 | = 0.7402 | 2018 / 1999 | -0.4 |
| ZECUSDT 1m | 43200 (0) | 348 | -248 | -0.07 | 36.9 | = 0.1528 | 925 / 950 | 2.0 |
| IOSTUSDT 1m | 43200 (0) | 343 | -229 | -0.07 | 34.5 | = 0.2146 | 1781 / 1927 | 4.5 |
| CELRUSDT 1m | 43200 (0) | 363 | -242 | -0.07 | 34.5 | = 0.3508 | 1381 / 1531 | 1.9 |
| DASHUSDT 1m | 43200 (0) | 368 | -845 | -0.23 | 35.8 | = 0.9584 | 1382 / 1517 | -3.6 |
| THETAUSDT 1m | 43200 (0) | 379 | -628 | -0.17 | 36.0 | = 0.9082 | 1990 / 1905 | 0.3 |
| ENJUSDT 1m | 43200 (0) | 379 | -563 | -0.15 | 36.4 | = 0.7092 | 1799 / 1994 | 4.6 |
| ATOMUSDT 1m | 43200 (0) | 378 | -489 | -0.13 | 37.6 | = 0.4606 | 1787 / 1650 | 0.4 |
| TFUELUSDT 1m | 43200 (0) | 408 | -1368 | -0.34 | 38.0 | = 1.0000 | 2040 / 1902 | -2.1 |
| ONEUSDT 1m | 43200 (0) | 333 | 480 | 0.14 | 32.4 | = 0.2478 | 1359 / 1459 | 12.2 |
| ALGOUSDT 1m | 43200 (0) | 365 | -561 | -0.15 | 36.7 | = 0.8316 | 1656 / 1543 | -0.3 |
| DUSKUSDT 1m | 43200 (0) | 366 | -809 | -0.22 | 32.7 | = 0.9800 | 1670 / 2224 | -1.0 |
| ANKRUSDT 1m | 43200 (0) | 349 | -770 | -0.22 | 34.2 | = 0.9998 | 1830 / 1964 | -0.4 |
| WINUSDT 1m | 43200 (0) | 376 | -1193 | -0.32 | 40.2 | = 1.0000 | 1606 / 1883 | 0.1 |
| MTLUSDT 1m | 43200 (0) | 368 | -676 | -0.18 | 32.3 | = 0.9198 | 2010 / 2034 | -2.1 |
| CVCUSDT 1m | 43200 (0) | 373 | -442 | -0.12 | 34.6 | = 0.6506 | 1823 / 2066 | 4.2 |
| CHZUSDT 1m | 43200 (0) | 382 | -662 | -0.17 | 36.3 | = 0.9430 | 1850 / 1859 | -0.4 |
| BANDUSDT 1m | 43200 (0) | 385 | -651 | -0.17 | 34.7 | = 0.9292 | 2181 / 1964 | -0.1 |
| XTZUSDT 1m | 43200 (0) | 380 | -500 | -0.13 | 35.2 | = 0.7002 | 1595 / 1733 | -2.9 |
| RVNUSDT 1m | 43200 (0) | 392 | -1227 | -0.31 | 34.8 | = 1.0000 | 1957 / 2140 | -0.8 |
| HBARUSDT 1m | 43200 (0) | 377 | -402 | -0.11 | 37.9 | = 0.3442 | 1048 / 1004 | -0.5 |
| KAVAUSDT 1m | 43200 (0) | 399 | -774 | -0.19 | 36.7 | = 0.9912 | 1782 / 2121 | 0.3 |
| STXUSDT 1m | 43200 (0) | 365 | -217 | -0.06 | 38.2 | = 0.1616 | 1872 / 1734 | 0.4 |
| ARPAUSDT 1m | 43200 (0) | 378 | -549 | -0.15 | 35.7 | = 0.7336 | 2086 / 2083 | 2.9 |
| IOTXUSDT 1m | 43200 (0) | 373 | -493 | -0.13 | 36.9 | = 0.5908 | 2035 / 2135 | -2.1 |
| RLCUSDT 1m | 43200 (0) | 374 | -57 | -0.02 | 34.7 | = 0.3544 | 1958 / 1979 | 8.5 |
| BCHUSDT 1m | 43200 (0) | 410 | -788 | -0.19 | 38.5 | = 0.9838 | 1522 / 1443 | 0.2 |
| FTTUSDT 1m | 43200 (0) | 422 | -1976 | -0.47 | 37.2 | = 1.0000 | 1934 / 1906 | -2.4 |

</details>

## 3m — 90 jours, juil.-oct. 2026

Fenêtre `2026-07-10T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 15201 trades (dont 15172 clos par règle), expectancy nette -1.843 USDT (-0.184 %) |
| Signaux | S1 | x3 | ❌ échec | 15201 trades (dont 15172 clos par règle), expectancy nette -4.640 USDT (-0.464 %) |
| Signaux | S2 | timing | ❌ échec | p = 1.0000 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -945.9 % log contre médiane nulle 452.6 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 2 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ❌ échec | 7370 trades clos, expectancy -0.104 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 7802 trades clos, expectancy -0.064 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 67417 forts achats, 0.2 bps en moyenne à 12 bougies (42.9 % de hausses), p unilatérale = 0.9034 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle 0.8 bps |
| Forts achats | F2 | cellules | ✅ tenu | moyenne > 0 dans 23 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée 0.2 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 15201 (15172) | -1.843 | -0.184 | -28022 | 25.4 |
| AXIS x2 | 15201 (15172) | -3.242 | -0.324 | -49285 | 21.5 |
| AXIS x3 | 15201 (15172) | -4.640 | -0.464 | -70539 | 18.4 |
| EMA 200 x1-central | 42472 (42441) | -1.679 | -0.168 | -71313 | 10.7 |
| EMA 200 x3 | 42472 (42441) | -4.476 | -0.448 | -190118 | 5.8 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 15172, -0.083 / 7370, -0.104 / 7802, -0.064 |
| Timing : capté / médiane nulle / 95e centile (% log) | -945.9 / 452.6 / 904.3 |
| Timing : p unilatérale (plus courte fenêtre) | = 1.0000 (42900 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 1.0000, capté -1596.2 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 2 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 1 / 42 |
| Exposition moyenne / achat-conservation médian | 35.7 % / 33.8 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 67417 / 0.6 / 34 / 4.0 | 67417 / 0.6 / 37 / 2.9 | 67417 / 0.3 / 39 / 1.4 | 67417 / 0.7 / 42 / 2.2 | 67417 / 0.2 / 43 / 0.6 | 67417 / 0.3 / 44 / 0.5 | 67417 / 0.8 / 45 / 1.2 |
| Fortes ventes | 70971 / -0.4 / 32 / -3.2 | 70971 / -0.7 / 36 / -4.3 | 70971 / -0.9 / 38 / -4.7 | 70971 / -1.2 / 41 / -5.3 | 70971 / -2.3 / 43 / -6.7 | 70971 / -4.6 / 44 / -9.9 | 70971 / -6.0 / 45 / -10.3 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9034 / = 0.9124 (43108 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | 0 / 1 / 2 |
| Forts achats nets de 0.14 % aller-retour (bps) | -14 |
| Fortes ventes : p bilatérale | = 0.0006 |
| Cellules à moyenne > 0 / ayant un fort achat | 23 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | 1 / 0 / 1, = 1.0000 |
| Au-dessus / sous l'EMA 200 | 37991 / -0.6 / 41 / -0.9 ; 29142 / 1.2 / 45 / 3.3 |
| Par année (achats / ventes ; moyenne achats bps) | 2026 : 67417 / 70971 ; 0 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 3m | 43200 (0) | 403 | -970 | -0.24 | 36.1 | = 0.9990 | 1902 / 1912 | -0.7 |
| LTCUSDT 3m | 43200 (0) | 376 | -717 | -0.19 | 41.1 | = 0.9984 | 787 / 944 | 3.0 |
| QTUMUSDT 3m | 43200 (0) | 402 | -828 | -0.21 | 35.4 | = 0.9940 | 1820 / 2208 | -3.0 |
| IOTAUSDT 3m | 43200 (0) | 348 | -758 | -0.22 | 36.4 | = 0.9760 | 1594 / 1563 | 2.4 |
| XLMUSDT 3m | 43200 (0) | 358 | -696 | -0.19 | 35.1 | = 0.9128 | 1038 / 1099 | 3.2 |
| ONTUSDT 3m | 43200 (0) | 362 | -718 | -0.20 | 34.3 | = 0.9492 | 1790 / 1966 | 9.0 |
| TRXUSDT 3m | 43200 (0) | 270 | -196 | -0.07 | 40.4 | ≤ 0.0002 | 1528 / 1395 | 1.4 |
| ETCUSDT 3m | 43200 (0) | 362 | -712 | -0.20 | 37.6 | = 0.9674 | 1588 / 1603 | -0.0 |
| VETUSDT 3m | 43200 (0) | 360 | -222 | -0.06 | 37.2 | = 0.3824 | 1586 / 1429 | -0.2 |
| ONGUSDT 3m | 43200 (0) | 330 | 623 | 0.19 | 32.5 | = 0.1790 | 1583 / 1823 | 6.5 |
| HOTUSDT 3m | 43200 (0) | 388 | -1576 | -0.41 | 33.0 | = 1.0000 | 1892 / 2209 | 0.0 |
| ZILUSDT 3m | 43200 (0) | 342 | -648 | -0.19 | 33.0 | = 0.8684 | 1781 / 1948 | 0.9 |
| FETUSDT 3m | 43200 (0) | 377 | -449 | -0.12 | 36.7 | = 0.6586 | 931 / 1013 | 2.6 |
| ZRXUSDT 3m | 43200 (0) | 367 | -700 | -0.19 | 31.8 | = 0.9740 | 2016 / 2056 | 1.2 |
| BATUSDT 3m | 43200 (0) | 380 | -590 | -0.16 | 33.6 | = 0.7728 | 1886 / 1860 | -3.4 |
| ZECUSDT 3m | 43200 (0) | 347 | -77 | -0.02 | 39.4 | = 0.6048 | 959 / 929 | 7.7 |
| IOSTUSDT 3m | 43200 (0) | 359 | -93 | -0.03 | 34.8 | = 0.3556 | 1747 / 1838 | -3.9 |
| CELRUSDT 3m | 43200 (0) | 345 | -350 | -0.10 | 36.6 | = 0.6576 | 789 / 809 | 3.5 |
| DASHUSDT 3m | 43200 (0) | 379 | -541 | -0.14 | 36.2 | = 0.8054 | 1256 / 1393 | 2.9 |
| THETAUSDT 3m | 43200 (0) | 378 | -513 | -0.14 | 36.1 | = 0.8600 | 1747 / 1884 | 1.2 |
| ENJUSDT 3m | 43200 (0) | 364 | -1038 | -0.29 | 34.5 | = 0.9988 | 1666 / 1879 | -1.8 |
| ATOMUSDT 3m | 43200 (0) | 367 | -620 | -0.17 | 36.1 | = 0.8424 | 1654 / 1423 | 0.5 |
| TFUELUSDT 3m | 43200 (0) | 340 | -1179 | -0.35 | 40.4 | = 1.0000 | 1899 / 1741 | -9.7 |
| ONEUSDT 3m | 43200 (0) | 370 | -1413 | -0.38 | 31.7 | = 0.9956 | 1532 / 1811 | 2.6 |
| ALGOUSDT 3m | 43200 (0) | 371 | -893 | -0.24 | 37.3 | = 0.9990 | 1483 / 1329 | 1.9 |
| DUSKUSDT 3m | 43200 (0) | 343 | -624 | -0.18 | 32.6 | = 0.7752 | 1730 / 1896 | -1.9 |
| ANKRUSDT 3m | 43200 (0) | 392 | -1167 | -0.30 | 35.1 | = 1.0000 | 1777 / 2038 | 1.6 |
| WINUSDT 3m | 43200 (0) | 335 | -699 | -0.21 | 43.5 | = 1.0000 | 1479 / 1671 | -2.8 |
| MTLUSDT 3m | 43200 (0) | 329 | -1007 | -0.31 | 30.3 | = 0.9984 | 1853 / 1890 | -3.9 |
| CVCUSDT 3m | 43200 (0) | 344 | -309 | -0.09 | 29.5 | = 0.5664 | 1800 / 2140 | 6.9 |
| CHZUSDT 3m | 43200 (0) | 367 | -944 | -0.26 | 35.3 | = 0.9966 | 1396 / 1472 | -2.4 |
| BANDUSDT 3m | 43200 (0) | 350 | -536 | -0.15 | 33.0 | = 0.8388 | 2036 / 2002 | -0.4 |
| XTZUSDT 3m | 43200 (0) | 389 | -837 | -0.22 | 36.4 | = 0.9894 | 1561 / 1607 | -2.4 |
| RVNUSDT 3m | 43200 (0) | 330 | -825 | -0.25 | 32.6 | = 0.8234 | 1815 / 2117 | -5.0 |
| HBARUSDT 3m | 43200 (0) | 364 | -390 | -0.11 | 37.2 | = 0.5154 | 1060 / 1042 | 2.8 |
| KAVAUSDT 3m | 43200 (0) | 417 | -895 | -0.21 | 39.3 | = 0.9998 | 1872 / 2105 | -1.0 |
| STXUSDT 3m | 43200 (0) | 377 | -86 | -0.02 | 35.1 | = 0.3570 | 1672 / 1549 | 3.3 |
| ARPAUSDT 3m | 43200 (0) | 398 | -984 | -0.25 | 36.4 | = 1.0000 | 1966 / 2084 | -3.4 |
| IOTXUSDT 3m | 43200 (0) | 396 | -1158 | -0.29 | 36.5 | = 0.9984 | 1946 / 2022 | 7.2 |
| RLCUSDT 3m | 43200 (0) | 364 | 199 | 0.05 | 33.1 | = 0.1682 | 1989 / 2041 | 5.7 |
| BCHUSDT 3m | 43200 (0) | 359 | -566 | -0.16 | 36.6 | = 0.8236 | 1284 / 1374 | -2.1 |
| FTTUSDT 3m | 43200 (0) | 302 | -1323 | -0.44 | 39.5 | = 1.0000 | 1727 / 1857 | -9.5 |

</details>

## 5m — 150 jours, mai-oct. 2026

Fenêtre `2026-05-11T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 14609 trades (dont 14585 clos par règle), expectancy nette -2.288 USDT (-0.229 %) |
| Signaux | S1 | x3 | ❌ échec | 14609 trades (dont 14585 clos par règle), expectancy nette -5.084 USDT (-0.508 %) |
| Signaux | S2 | timing | ❌ échec | p = 1.0000 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -1724.3 % log contre médiane nulle -168.9 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 4 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ❌ échec | 6963 trades clos, expectancy -0.275 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 7622 trades clos, expectancy -0.003 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 61255 forts achats, -1.6 bps en moyenne à 12 bougies (43.2 % de hausses), p unilatérale = 0.9806 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle -0.3 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 15 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -1.6 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 14609 (14585) | -2.288 | -0.229 | -33421 | 26.4 |
| AXIS x2 | 14609 (14585) | -3.686 | -0.369 | -53850 | 23.1 |
| AXIS x3 | 14609 (14585) | -5.084 | -0.508 | -74270 | 20.5 |
| EMA 200 x1-central | 43316 (43289) | -1.830 | -0.183 | -79260 | 11.0 |
| EMA 200 x3 | 43316 (43289) | -4.627 | -0.463 | -200414 | 6.4 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 14585, -0.133 / 6963, -0.275 / 7622, -0.003 |
| Timing : capté / médiane nulle / 95e centile (% log) | -1724.3 / -168.9 / 387.6 |
| Timing : p unilatérale (plus courte fenêtre) | = 1.0000 (42900 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 1.0000, capté -2405.2 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 4 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 1 / 42 |
| Exposition moyenne / achat-conservation médian | 34.8 % / -8.7 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 61255 / 0.0 / 36 / 0.3 | 61255 / -0.4 / 39 / -1.5 | 61255 / -0.3 / 41 / -1.0 | 61255 / -0.9 / 42 / -2.1 | 61255 / -1.6 / 43 / -3.0 | 61255 / -3.3 / 44 / -5.2 | 61255 / -4.7 / 44 / -5.9 |
| Fortes ventes | 65729 / -0.3 / 36 / -2.2 | 65729 / -0.5 / 39 / -2.6 | 65729 / -1.0 / 40 / -4.5 | 65729 / -1.5 / 43 / -4.8 | 65729 / -2.0 / 44 / -4.5 | 65729 / -3.4 / 46 / -6.2 | 65729 / -2.7 / 48 / -4.0 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9806 / = 0.0204 (43108 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | 0 / -0 / 1 |
| Forts achats nets de 0.14 % aller-retour (bps) | -16 |
| Fortes ventes : p bilatérale | = 0.0050 |
| Cellules à moyenne > 0 / ayant un fort achat | 15 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | 0 / -2 / 0, = 1.0000 |
| Au-dessus / sous l'EMA 200 | 32943 / -3.3 / 41 / -3.9 ; 28118 / 0.6 / 46 / 1.0 |
| Par année (achats / ventes ; moyenne achats bps) | 2026 : 61255 / 65729 ; -2 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 5m | 43200 (0) | 371 | -1100 | -0.30 | 34.4 | = 0.9946 | 1720 / 1765 | -3.7 |
| LTCUSDT 5m | 43200 (0) | 351 | -642 | -0.18 | 39.7 | = 0.8974 | 713 / 757 | -0.2 |
| QTUMUSDT 5m | 43200 (0) | 376 | -918 | -0.24 | 34.1 | = 0.9822 | 1773 / 2023 | -3.7 |
| IOTAUSDT 5m | 43200 (0) | 308 | -562 | -0.18 | 32.9 | = 0.6828 | 1212 / 1198 | -0.0 |
| XLMUSDT 5m | 43200 (0) | 335 | -189 | -0.06 | 34.1 | = 0.3322 | 788 / 884 | 6.9 |
| ONTUSDT 5m | 43200 (0) | 353 | -1099 | -0.31 | 35.7 | = 0.9950 | 1504 / 1664 | 3.8 |
| TRXUSDT 5m | 43200 (0) | 291 | -226 | -0.08 | 43.2 | = 0.0004 | 1271 / 1176 | 1.6 |
| ETCUSDT 5m | 43200 (0) | 331 | -838 | -0.25 | 33.5 | = 0.9722 | 1417 / 1518 | -2.7 |
| VETUSDT 5m | 43200 (0) | 331 | -294 | -0.09 | 34.1 | = 0.2564 | 1293 / 1265 | 2.1 |
| ONGUSDT 5m | 43200 (0) | 342 | 361 | 0.11 | 33.5 | = 0.2466 | 1564 / 1846 | 7.7 |
| HOTUSDT 5m | 43200 (0) | 371 | -1728 | -0.47 | 35.1 | = 1.0000 | 1732 / 2076 | -0.3 |
| ZILUSDT 5m | 43200 (0) | 330 | -699 | -0.21 | 32.8 | = 0.7870 | 1639 / 1869 | 0.7 |
| FETUSDT 5m | 43200 (0) | 381 | -1228 | -0.32 | 36.7 | = 0.9894 | 746 / 867 | -1.0 |
| ZRXUSDT 5m | 43200 (0) | 376 | -901 | -0.24 | 32.5 | = 0.9610 | 1725 / 1909 | -0.8 |
| BATUSDT 5m | 43200 (0) | 374 | -718 | -0.19 | 35.1 | = 0.8032 | 1769 / 1690 | -5.2 |
| ZECUSDT 5m | 43200 (0) | 343 | 73 | 0.02 | 38.1 | = 0.4212 | 863 / 853 | 16.9 |
| IOSTUSDT 5m | 43200 (0) | 358 | -207 | -0.06 | 32.4 | = 0.4708 | 1831 / 1783 | -4.4 |
| CELRUSDT 5m | 43200 (0) | 327 | -274 | -0.08 | 34.4 | = 0.4944 | 593 / 618 | 1.3 |
| DASHUSDT 5m | 43200 (0) | 350 | -1004 | -0.29 | 36.1 | = 0.9842 | 1146 / 1290 | 3.7 |
| THETAUSDT 5m | 43200 (0) | 347 | -668 | -0.19 | 35.2 | = 0.7696 | 1607 / 1861 | 1.0 |
| ENJUSDT 5m | 43200 (0) | 325 | -734 | -0.23 | 33.1 | = 0.7588 | 1488 / 1612 | -12.4 |
| ATOMUSDT 5m | 43200 (0) | 343 | -717 | -0.21 | 34.4 | = 0.8382 | 1417 / 1288 | -0.5 |
| TFUELUSDT 5m | 43200 (0) | 286 | -970 | -0.34 | 39.2 | = 0.9870 | 1688 / 1718 | -9.4 |
| ONEUSDT 5m | 43200 (0) | 333 | -1554 | -0.47 | 30.8 | = 0.9982 | 1601 / 1933 | 10.4 |
| ALGOUSDT 5m | 43200 (0) | 369 | -1234 | -0.33 | 35.0 | = 1.0000 | 1215 / 1131 | -4.8 |
| DUSKUSDT 5m | 43200 (0) | 333 | -1293 | -0.39 | 32.9 | = 0.9880 | 1545 / 1720 | -0.9 |
| ANKRUSDT 5m | 43200 (0) | 384 | -1518 | -0.40 | 34.6 | = 1.0000 | 1689 / 1876 | -0.8 |
| WINUSDT 5m | 43200 (0) | 327 | -528 | -0.16 | 45.2 | = 0.9968 | 1376 / 1510 | -5.7 |
| MTLUSDT 5m | 43200 (0) | 387 | -1352 | -0.35 | 32.1 | = 0.9996 | 2002 / 2043 | -7.1 |
| CVCUSDT 5m | 43200 (0) | 317 | -727 | -0.23 | 28.1 | = 0.8556 | 1763 / 2114 | -4.4 |
| CHZUSDT 5m | 43200 (0) | 334 | -991 | -0.30 | 32.6 | = 0.8056 | 1061 / 1220 | -7.0 |
| BANDUSDT 5m | 43200 (0) | 366 | -894 | -0.24 | 34.4 | = 0.9494 | 1936 / 1932 | -0.7 |
| XTZUSDT 5m | 43200 (0) | 374 | -1049 | -0.28 | 31.9 | = 0.9848 | 1426 / 1526 | -8.8 |
| RVNUSDT 5m | 43200 (0) | 343 | -1390 | -0.41 | 30.9 | = 0.9932 | 1660 / 1902 | -6.4 |
| HBARUSDT 5m | 43200 (0) | 356 | -514 | -0.14 | 35.2 | = 0.5858 | 923 / 1002 | 4.9 |
| KAVAUSDT 5m | 43200 (0) | 388 | -1058 | -0.27 | 37.6 | = 0.9968 | 1797 / 1958 | -6.0 |
| STXUSDT 5m | 43200 (0) | 360 | 290 | 0.08 | 35.3 | = 0.0192 | 1535 / 1450 | 1.1 |
| ARPAUSDT 5m | 43200 (0) | 393 | -1177 | -0.30 | 34.4 | = 0.9978 | 1831 / 1961 | -0.2 |
| IOTXUSDT 5m | 43200 (0) | 353 | -1032 | -0.29 | 33.2 | = 0.9352 | 1718 / 1960 | 5.3 |
| RLCUSDT 5m | 43200 (0) | 352 | 474 | 0.13 | 32.0 | = 0.0280 | 1938 / 2020 | 6.3 |
| BCHUSDT 5m | 43200 (0) | 339 | -658 | -0.19 | 35.1 | = 0.6462 | 1188 / 1260 | -4.1 |
| FTTUSDT 5m | 43200 (0) | 301 | -1935 | -0.64 | 40.5 | = 1.0000 | 1552 / 1681 | -20.7 |

</details>

## 15m — oct. 2025-oct. 2026

Fenêtre `2025-10-08T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 11067 trades (dont 11060 clos par règle), expectancy nette -2.840 USDT (-0.284 %) |
| Signaux | S1 | x3 | ❌ échec | 11067 trades (dont 11060 clos par règle), expectancy nette -5.635 USDT (-0.564 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.9948 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -2549.5 % log contre médiane nulle -778.2 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 5 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ❌ échec | 5398 trades clos, expectancy -0.283 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 5662 trades clos, expectancy -0.068 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 36741 forts achats, -9.8 bps en moyenne à 12 bougies (43.8 % de hausses), p unilatérale = 1.0000 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle -2.9 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 7 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -9.8 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 11067 (11060) | -2.840 | -0.284 | -31429 | 27.5 |
| AXIS x2 | 11067 (11060) | -4.238 | -0.424 | -46900 | 25.7 |
| AXIS x3 | 11067 (11060) | -5.635 | -0.564 | -62364 | 24.0 |
| EMA 200 x1-central | 34684 (34678) | -2.071 | -0.207 | -71821 | 11.5 |
| EMA 200 x3 | 34684 (34678) | -4.867 | -0.487 | -168816 | 8.0 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 11060, -0.173 / 5398, -0.283 / 5662, -0.068 |
| Timing : capté / médiane nulle / 95e centile (% log) | -2549.5 / -778.2 / 393.9 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.9948 (34740 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.9992, capté -3499.6 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 5 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 1 / 42 |
| Exposition moyenne / achat-conservation médian | 34.7 % / -43.3 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 36741 / -0.3 / 41 / -0.6 | 36741 / -2.0 / 42 / -2.4 | 36741 / -3.4 / 43 / -4.0 | 36741 / -6.0 / 43 / -5.8 | 36741 / -9.8 / 44 / -7.7 | 36741 / -12.2 / 44 / -7.1 | 36741 / -14.4 / 45 / -6.9 |
| Fortes ventes | 38736 / 3.7 / 42 / 3.7 | 38736 / 4.8 / 44 / 4.0 | 38736 / 2.5 / 45 / 2.7 | 38736 / 2.3 / 46 / 2.1 | 38736 / 2.7 / 48 / 2.2 | 38736 / 8.1 / 49 / 4.9 | 38736 / 7.5 / 50 / 3.9 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 1.0000 / ≤ 0.0002 (34948 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -10 / -3 / -0 |
| Forts achats nets de 0.14 % aller-retour (bps) | -24 |
| Fortes ventes : p bilatérale | = 0.5076 |
| Cellules à moyenne > 0 / ayant un fort achat | 7 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -6 / -10 / -6, = 1.0000 |
| Au-dessus / sous l'EMA 200 | 19837 / -18.4 / 41 / -9.1 ; 16768 / -0.4 / 47 / -0.3 |
| Par année (achats / ventes ; moyenne achats bps) | 2025 : 7444 / 8106 ; -3 · 2026 : 29297 / 30630 ; -12 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 15m | 35040 (0) | 293 | -1485 | -0.51 | 36.0 | = 0.9982 | 934 / 928 | -11.4 |
| LTCUSDT 15m | 35040 (0) | 276 | -948 | -0.34 | 39.3 | = 0.9444 | 425 / 512 | -3.0 |
| QTUMUSDT 15m | 35040 (0) | 276 | -925 | -0.34 | 33.8 | = 0.8614 | 1010 / 1124 | -23.7 |
| IOTAUSDT 15m | 35040 (0) | 252 | -1075 | -0.43 | 32.6 | = 0.9166 | 684 / 648 | -3.3 |
| XLMUSDT 15m | 35040 (0) | 256 | -327 | -0.13 | 32.4 | = 0.4596 | 558 / 587 | 12.1 |
| ONTUSDT 15m | 35040 (0) | 248 | -546 | -0.22 | 33.1 | = 0.7352 | 972 / 982 | -2.7 |
| TRXUSDT 15m | 35040 (0) | 298 | -267 | -0.09 | 42.5 | = 0.1700 | 614 / 671 | 2.8 |
| ETCUSDT 15m | 35040 (0) | 252 | -916 | -0.36 | 33.7 | = 0.9172 | 787 / 865 | -4.5 |
| VETUSDT 15m | 35040 (0) | 269 | -718 | -0.27 | 34.1 | = 0.7248 | 675 / 696 | -7.9 |
| ONGUSDT 15m | 35040 (0) | 260 | -836 | -0.32 | 33.5 | = 0.7866 | 938 / 978 | -1.7 |
| HOTUSDT 15m | 35040 (0) | 283 | -2216 | -0.78 | 37.8 | = 1.0000 | 1112 / 1119 | -41.3 |
| ZILUSDT 15m | 35040 (0) | 252 | -780 | -0.31 | 32.2 | = 0.7556 | 955 / 968 | -20.0 |
| FETUSDT 15m | 35040 (0) | 253 | 73 | 0.03 | 36.2 | = 0.2924 | 448 / 476 | 19.4 |
| ZRXUSDT 15m | 35040 (0) | 269 | -665 | -0.25 | 34.3 | = 0.7408 | 964 / 973 | -8.1 |
| BATUSDT 15m | 35040 (0) | 272 | -419 | -0.15 | 35.7 | = 0.5902 | 1065 / 966 | -7.8 |
| ZECUSDT 15m | 35040 (0) | 255 | 1563 | 0.61 | 40.5 | = 0.1724 | 615 / 610 | 44.7 |
| IOSTUSDT 15m | 35040 (0) | 277 | -686 | -0.25 | 32.3 | = 0.7030 | 1089 / 1085 | -3.9 |
| CELRUSDT 15m | 35040 (0) | 276 | -803 | -0.29 | 35.1 | = 0.8734 | 405 / 498 | -15.5 |
| DASHUSDT 15m | 35040 (0) | 254 | 1148 | 0.45 | 33.9 | = 0.1824 | 721 / 719 | 33.8 |
| THETAUSDT 15m | 35040 (0) | 253 | -475 | -0.19 | 35.5 | = 0.4672 | 796 / 923 | -9.9 |
| ENJUSDT 15m | 35040 (0) | 250 | -36 | -0.01 | 32.0 | = 0.6044 | 995 / 918 | -34.3 |
| ATOMUSDT 15m | 35040 (0) | 270 | -537 | -0.20 | 36.1 | = 0.5284 | 748 / 731 | -5.9 |
| TFUELUSDT 15m | 35040 (0) | 228 | -1985 | -0.87 | 35.5 | = 1.0000 | 930 / 1150 | -10.1 |
| ONEUSDT 15m | 35040 (0) | 240 | -551 | -0.23 | 32.2 | = 0.8192 | 894 / 1091 | -2.8 |
| ALGOUSDT 15m | 35040 (0) | 273 | -657 | -0.24 | 34.6 | = 0.7064 | 679 / 709 | -11.3 |
| DUSKUSDT 15m | 35040 (0) | 267 | -40 | -0.02 | 33.9 | = 0.8238 | 863 / 935 | -0.2 |
| ANKRUSDT 15m | 35040 (0) | 255 | -897 | -0.35 | 33.8 | = 0.8404 | 1007 / 1043 | -22.8 |
| WINUSDT 15m | 35040 (0) | 233 | 191 | 0.08 | 41.3 | = 0.2744 | 921 / 1012 | -16.1 |
| MTLUSDT 15m | 35040 (0) | 257 | -1045 | -0.41 | 34.7 | = 0.9708 | 1457 / 1401 | -6.9 |
| CVCUSDT 15m | 35040 (0) | 259 | -1824 | -0.70 | 32.1 | = 1.0000 | 1082 / 1285 | -28.1 |
| CHZUSDT 15m | 35040 (0) | 270 | -1191 | -0.44 | 34.3 | = 0.9504 | 657 / 762 | -8.6 |
| BANDUSDT 15m | 35040 (0) | 263 | -1442 | -0.55 | 33.4 | = 0.9930 | 1016 / 1080 | -11.6 |
| XTZUSDT 15m | 35040 (0) | 276 | -937 | -0.34 | 34.0 | = 0.9092 | 810 / 895 | -26.5 |
| RVNUSDT 15m | 35040 (0) | 259 | -1361 | -0.53 | 33.3 | = 0.9544 | 989 / 1077 | -17.0 |
| HBARUSDT 15m | 35040 (0) | 266 | -355 | -0.13 | 31.9 | = 0.3890 | 553 / 603 | 12.0 |
| KAVAUSDT 15m | 35040 (0) | 282 | -1365 | -0.48 | 34.8 | = 0.9772 | 1134 / 1180 | -20.7 |
| STXUSDT 15m | 35040 (0) | 279 | -117 | -0.04 | 33.1 | = 0.4244 | 904 / 874 | -15.4 |
| ARPAUSDT 15m | 35040 (0) | 278 | -1964 | -0.71 | 37.1 | = 1.0000 | 1189 / 1180 | -1.6 |
| IOTXUSDT 15m | 35040 (0) | 269 | -1441 | -0.54 | 32.7 | = 0.9690 | 1028 / 1095 | -10.6 |
| RLCUSDT 15m | 35040 (0) | 287 | 29 | 0.01 | 33.5 | = 0.5820 | 1213 / 1366 | 1.5 |
| BCHUSDT 15m | 35040 (0) | 256 | -408 | -0.16 | 33.4 | = 0.4576 | 914 / 835 | -3.6 |
| FTTUSDT 15m | 35040 (0) | 226 | -2193 | -0.97 | 34.6 | = 1.0000 | 991 / 1186 | -42.7 |

</details>

## 30m — oct. 2024-oct. 2026

Fenêtre `2024-10-08T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 10697 trades (dont 10695 clos par règle), expectancy nette -1.757 USDT (-0.176 %) |
| Signaux | S1 | x3 | ❌ échec | 10697 trades (dont 10695 clos par règle), expectancy nette -4.554 USDT (-0.455 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.6856 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -2094.6 % log contre médiane nulle -1429.5 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 10 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 5456 trades clos, expectancy 0.066 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 5239 trades clos, expectancy -0.161 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 28650 forts achats, -14.5 bps en moyenne à 12 bougies (44.9 % de hausses), p unilatérale = 0.9998 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle -3.4 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 15 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -14.5 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 10697 (10695) | -1.757 | -0.176 | -18797 | 31.5 |
| AXIS x2 | 10697 (10695) | -3.156 | -0.316 | -33760 | 30.2 |
| AXIS x3 | 10697 (10695) | -4.554 | -0.455 | -48718 | 28.8 |
| EMA 200 x1-central | 31245 (31240) | -1.406 | -0.141 | -43927 | 11.8 |
| EMA 200 x3 | 31245 (31240) | -4.204 | -0.420 | -131343 | 9.7 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 10695, -0.045 / 5456, 0.066 / 5239, -0.161 |
| Timing : capté / médiane nulle / 95e centile (% log) | -2094.6 / -1429.5 / 761.5 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.6856 (34740 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.6400, capté -2365.3 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 10 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 5 / 42 |
| Exposition moyenne / achat-conservation médian | 34.8 % / -68.9 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 28650 / -1.0 / 45 / -1.1 | 28650 / -2.8 / 45 / -2.4 | 28650 / -4.6 / 44 / -3.5 | 28650 / -11.5 / 44 / -7.2 | 28650 / -14.5 / 45 / -7.1 | 28650 / -19.9 / 45 / -7.5 | 28650 / -21.9 / 45 / -6.4 |
| Fortes ventes | 29503 / -0.0 / 45 / -0.0 | 29503 / -2.2 / 46 / -2.0 | 29503 / -1.9 / 47 / -1.5 | 29503 / -0.4 / 48 / -0.3 | 29503 / 5.8 / 50 / 2.7 | 29503 / 0.2 / 50 / 0.1 | 29503 / -2.8 / 50 / -0.9 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9998 / = 0.0004 (34948 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -18 / -3 / 1 |
| Forts achats nets de 0.14 % aller-retour (bps) | -28 |
| Fortes ventes : p bilatérale | = 0.2632 |
| Cellules à moyenne > 0 / ayant un fort achat | 15 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -10 / -14 / -10, = 0.9990 |
| Au-dessus / sous l'EMA 200 | 16123 / -23.5 / 43 / -7.8 ; 12407 / -2.8 / 48 / -1.1 |
| Par année (achats / ventes ; moyenne achats bps) | 2024 : 2908 / 2651 ; -9 · 2025 : 13158 / 13936 ; -12 · 2026 : 12584 / 12916 ; -18 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 30m | 35040 (0) | 255 | -411 | -0.16 | 35.6 | = 0.3140 | 680 / 659 | -23.1 |
| LTCUSDT 30m | 35040 (0) | 289 | -1105 | -0.38 | 40.1 | = 0.9544 | 398 / 427 | 7.6 |
| QTUMUSDT 30m | 35040 (0) | 257 | -313 | -0.12 | 33.2 | = 0.3648 | 723 / 725 | -22.9 |
| IOTAUSDT 30m | 35040 (0) | 250 | 44 | 0.02 | 33.5 | = 0.3172 | 578 / 559 | -8.1 |
| XLMUSDT 30m | 35040 (0) | 235 | 2320 | 0.99 | 32.0 | = 0.0144 | 569 / 551 | 24.7 |
| ONTUSDT 30m | 35040 (0) | 261 | -1583 | -0.61 | 32.9 | = 0.9452 | 766 / 773 | -14.8 |
| TRXUSDT 30m | 35040 (0) | 322 | 403 | 0.13 | 42.4 | = 0.1558 | 402 / 456 | 15.7 |
| ETCUSDT 30m | 35040 (0) | 247 | -423 | -0.17 | 34.0 | = 0.5000 | 647 / 747 | 9.4 |
| VETUSDT 30m | 35040 (0) | 247 | -122 | -0.05 | 33.8 | = 0.3090 | 472 / 495 | 2.5 |
| ONGUSDT 30m | 35040 (0) | 249 | -762 | -0.31 | 33.2 | = 0.7104 | 722 / 631 | -15.5 |
| HOTUSDT 30m | 35040 (0) | 278 | -3317 | -1.19 | 36.5 | = 1.0000 | 799 / 840 | -31.9 |
| ZILUSDT 30m | 35040 (0) | 266 | -1458 | -0.55 | 34.9 | = 0.9030 | 619 / 685 | -13.7 |
| FETUSDT 30m | 35040 (0) | 230 | 922 | 0.40 | 34.3 | = 0.0226 | 395 / 444 | 6.4 |
| ZRXUSDT 30m | 35040 (0) | 258 | -1080 | -0.42 | 36.8 | = 0.8122 | 659 / 649 | -20.6 |
| BATUSDT 30m | 35040 (0) | 261 | -219 | -0.08 | 37.2 | = 0.4252 | 791 / 701 | -8.1 |
| ZECUSDT 30m | 35040 (0) | 247 | 4426 | 1.79 | 40.5 | = 0.0056 | 710 / 624 | 49.2 |
| IOSTUSDT 30m | 35040 (0) | 258 | -1167 | -0.45 | 32.3 | = 0.7446 | 769 / 790 | -1.6 |
| CELRUSDT 30m | 35040 (0) | 270 | -1110 | -0.41 | 35.4 | = 0.7978 | 493 / 513 | 33.3 |
| DASHUSDT 30m | 35040 (0) | 238 | 3592 | 1.51 | 35.8 | = 0.0092 | 635 / 647 | 47.3 |
| THETAUSDT 30m | 35040 (0) | 258 | -918 | -0.36 | 34.2 | = 0.6478 | 548 / 659 | -21.9 |
| ENJUSDT 30m | 35040 (0) | 243 | -693 | -0.29 | 31.2 | = 0.7662 | 715 / 658 | -29.2 |
| ATOMUSDT 30m | 35040 (0) | 270 | -568 | -0.21 | 35.6 | = 0.5768 | 481 / 614 | 3.6 |
| TFUELUSDT 30m | 35040 (0) | 230 | -2377 | -1.03 | 34.0 | = 0.9976 | 672 / 868 | -52.5 |
| ONEUSDT 30m | 35040 (0) | 249 | -522 | -0.21 | 32.4 | = 0.6556 | 686 / 771 | 3.1 |
| ALGOUSDT 30m | 35040 (0) | 263 | 71 | 0.03 | 35.2 | = 0.4412 | 542 / 565 | 2.5 |
| DUSKUSDT 30m | 35040 (0) | 250 | 1711 | 0.68 | 34.3 | = 0.1406 | 679 / 737 | -16.0 |
| ANKRUSDT 30m | 35040 (0) | 245 | -1161 | -0.47 | 34.4 | = 0.7578 | 757 / 761 | -29.9 |
| WINUSDT 30m | 35040 (0) | 222 | 347 | 0.16 | 38.7 | = 0.1214 | 784 / 779 | -10.7 |
| MTLUSDT 30m | 35040 (0) | 248 | -986 | -0.40 | 34.2 | = 0.7690 | 1057 / 914 | -15.9 |
| CVCUSDT 30m | 35040 (0) | 253 | -2093 | -0.83 | 32.3 | = 0.9952 | 854 / 902 | -64.0 |
| CHZUSDT 30m | 35040 (0) | 236 | -48 | -0.02 | 34.1 | = 0.1488 | 514 / 675 | 10.5 |
| BANDUSDT 30m | 35040 (0) | 245 | -685 | -0.28 | 33.2 | = 0.5350 | 699 / 764 | -27.5 |
| XTZUSDT 30m | 35040 (0) | 253 | -203 | -0.08 | 33.7 | = 0.4520 | 661 / 684 | -36.8 |
| RVNUSDT 30m | 35040 (0) | 250 | -1721 | -0.69 | 32.6 | = 0.9502 | 716 / 760 | -26.7 |
| HBARUSDT 30m | 35040 (0) | 250 | 1713 | 0.69 | 34.4 | = 0.0508 | 401 / 456 | 9.5 |
| KAVAUSDT 30m | 35040 (0) | 242 | -877 | -0.36 | 35.1 | = 0.6242 | 996 / 1086 | -36.0 |
| STXUSDT 30m | 35040 (0) | 261 | -144 | -0.06 | 33.6 | = 0.3118 | 695 / 681 | -27.7 |
| ARPAUSDT 30m | 35040 (0) | 270 | -1983 | -0.73 | 37.1 | = 0.9862 | 961 / 797 | -35.6 |
| IOTXUSDT 30m | 35040 (0) | 282 | -2853 | -1.01 | 33.6 | = 0.9962 | 822 / 854 | -29.2 |
| RLCUSDT 30m | 35040 (0) | 263 | -218 | -0.08 | 34.0 | = 0.5926 | 969 / 1043 | -21.5 |
| BCHUSDT 30m | 35040 (0) | 281 | -789 | -0.28 | 36.5 | = 0.8708 | 832 / 698 | 2.3 |
| FTTUSDT 30m | 35040 (0) | 215 | -2437 | -1.13 | 32.3 | = 0.9932 | 782 / 861 | -66.8 |

</details>

## 1h — oct. 2023-oct. 2026

Fenêtre `2023-10-08T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 42 cellule(s) disponible(s) sur 42.

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ✅ tenu | 7900 trades (dont 7899 clos par règle), expectancy nette 0.579 USDT (0.058 %) |
| Signaux | S1 | x3 | ❌ échec | 7900 trades (dont 7899 clos par règle), expectancy nette -2.222 USDT (-0.222 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.4804 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté -1081.7 % log contre médiane nulle -1165.1 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 21 cellule(s) sur 42 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 3969 trades clos, expectancy 0.484 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 3930 trades clos, expectancy -0.079 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 18247 forts achats, -19.2 bps en moyenne à 12 bougies (44.9 % de hausses), p unilatérale = 0.9990 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle -3.3 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 17 cellule(s) sur 42 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -19.2 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 7900 (7899) | 0.579 | 0.058 | 4574 | 32.0 |
| AXIS x2 | 7900 (7899) | -0.822 | -0.082 | -6494 | 31.1 |
| AXIS x3 | 7900 (7899) | -2.222 | -0.222 | -17557 | 30.1 |
| EMA 200 x1-central | 22386 (22381) | -0.290 | -0.029 | -6495 | 12.1 |
| EMA 200 x3 | 22386 (22381) | -3.090 | -0.309 | -69170 | 10.4 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 7899, 0.204 / 3969, 0.484 / 3930, -0.079 |
| Timing : capté / médiane nulle / 95e centile (% log) | -1081.7 / -1165.1 / 1580.2 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.4804 (26004 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.4242, capté -1131.0 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 21 / 42 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 15 / 42 |
| Exposition moyenne / achat-conservation médian | 35.7 % / -62.6 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 18247 / -6.5 / 44 / -4.1 | 18247 / -13.2 / 44 / -6.7 | 18247 / -16.3 / 44 / -7.2 | 18247 / -18.3 / 44 / -6.3 | 18247 / -19.2 / 45 / -5.1 | 18247 / -32.5 / 45 / -6.9 | 18247 / -48.3 / 45 / -8.2 |
| Fortes ventes | 18154 / 1.1 / 45 / 0.8 | 18154 / 3.7 / 48 / 2.2 | 18154 / 5.0 / 48 / 2.6 | 18154 / 8.2 / 48 / 3.2 | 18154 / -1.9 / 49 / -0.6 | 18154 / -7.5 / 49 / -1.8 | 18154 / -5.1 / 49 / -1.0 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9990 / = 0.0012 (26212 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -30 / -3 / 4 |
| Forts achats nets de 0.14 % aller-retour (bps) | -33 |
| Fortes ventes : p bilatérale | = 0.8254 |
| Cellules à moyenne > 0 / ayant un fort achat | 17 / 42 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -9 / -19 / -9, = 1.0000 |
| Au-dessus / sous l'EMA 200 | 10990 / -27.7 / 43 / -5.0 ; 7130 / -6.5 / 48 / -1.5 |
| Par année (achats / ventes ; moyenne achats bps) | 2023 : 1392 / 1198 ; -14 · 2024 : 5692 / 5512 ; -17 · 2025 : 5626 / 6121 ; -29 · 2026 : 5537 / 5323 ; -13 |

<details><summary>Détail par cellule (42)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 1h | 26304 (0) | 204 | -1154 | -0.57 | 35.5 | = 0.8876 | 431 / 424 | -34.1 |
| LTCUSDT 1h | 26304 (0) | 212 | -204 | -0.10 | 39.5 | = 0.5720 | 280 / 308 | 10.4 |
| QTUMUSDT 1h | 26304 (0) | 200 | -1042 | -0.52 | 36.2 | = 0.8592 | 447 / 442 | -35.5 |
| IOTAUSDT 1h | 26304 (0) | 185 | 284 | 0.15 | 33.5 | = 0.2832 | 325 / 347 | -37.5 |
| XLMUSDT 1h | 26304 (0) | 182 | 4029 | 2.21 | 33.5 | = 0.0470 | 385 / 385 | 7.1 |
| ONTUSDT 1h | 26304 (0) | 179 | 49 | 0.03 | 35.0 | = 0.3860 | 526 / 499 | -1.2 |
| TRXUSDT 1h | 26304 (0) | 235 | 1031 | 0.44 | 44.6 | = 0.0752 | 222 / 265 | 34.2 |
| ETCUSDT 1h | 26304 (0) | 198 | -576 | -0.29 | 35.3 | = 0.7198 | 424 / 514 | 1.3 |
| VETUSDT 1h | 26304 (0) | 184 | -46 | -0.03 | 34.3 | = 0.4558 | 301 / 329 | 11.6 |
| ONGUSDT 1h | 26304 (0) | 180 | -128 | -0.07 | 34.3 | = 0.5772 | 508 / 425 | -20.0 |
| HOTUSDT 1h | 26304 (0) | 175 | 232 | 0.13 | 34.3 | = 0.2602 | 483 / 455 | -45.4 |
| ZILUSDT 1h | 26304 (0) | 199 | -1778 | -0.89 | 36.5 | = 0.9446 | 345 / 363 | -55.4 |
| FETUSDT 1h | 26304 (0) | 190 | 693 | 0.36 | 34.3 | = 0.4280 | 291 / 267 | 7.8 |
| ZRXUSDT 1h | 26304 (0) | 208 | -238 | -0.11 | 35.6 | = 0.8296 | 436 / 414 | -5.7 |
| BATUSDT 1h | 26304 (0) | 193 | 142 | 0.07 | 36.7 | = 0.3382 | 455 / 438 | -48.2 |
| ZECUSDT 1h | 26304 (0) | 202 | 3432 | 1.70 | 40.8 | = 0.1640 | 423 / 413 | 39.4 |
| IOSTUSDT 1h | 26304 (0) | 173 | -1212 | -0.70 | 34.5 | = 0.7778 | 474 / 466 | 46.9 |
| CELRUSDT 1h | 26304 (0) | 188 | -164 | -0.09 | 35.6 | = 0.4334 | 340 / 339 | 56.7 |
| DASHUSDT 1h | 26304 (0) | 197 | 1972 | 1.00 | 38.3 | = 0.2536 | 395 / 375 | 74.8 |
| THETAUSDT 1h | 26304 (0) | 199 | -32 | -0.02 | 38.0 | = 0.4692 | 330 / 413 | 3.1 |
| ENJUSDT 1h | 26304 (0) | 173 | 888 | 0.51 | 32.2 | = 0.1184 | 441 / 454 | -71.3 |
| ATOMUSDT 1h | 26304 (0) | 198 | -620 | -0.31 | 36.5 | = 0.5582 | 280 / 382 | -31.7 |
| TFUELUSDT 1h | 26304 (0) | 165 | -2017 | -1.22 | 34.4 | = 0.9968 | 493 / 462 | -85.9 |
| ONEUSDT 1h | 26304 (0) | 181 | 1250 | 0.69 | 34.0 | = 0.2738 | 379 / 429 | -26.8 |
| ALGOUSDT 1h | 26304 (0) | 187 | 1110 | 0.59 | 35.4 | = 0.1552 | 284 / 331 | 30.8 |
| DUSKUSDT 1h | 26304 (0) | 194 | 912 | 0.47 | 36.2 | = 0.5328 | 417 / 431 | 14.1 |
| ANKRUSDT 1h | 26304 (0) | 192 | -1314 | -0.68 | 36.8 | = 0.8866 | 450 / 421 | -53.5 |
| WINUSDT 1h | 26304 (0) | 164 | 1626 | 0.99 | 36.4 | = 0.0110 | 541 / 448 | -35.4 |
| MTLUSDT 1h | 26304 (0) | 182 | -767 | -0.42 | 36.1 | = 0.6828 | 665 / 527 | -48.9 |
| CVCUSDT 1h | 26304 (0) | 167 | 286 | 0.17 | 33.9 | = 0.3128 | 619 / 512 | -73.3 |
| CHZUSDT 1h | 26304 (0) | 187 | 311 | 0.17 | 36.6 | = 0.1644 | 334 / 412 | 15.6 |
| BANDUSDT 1h | 26304 (0) | 199 | -1649 | -0.83 | 37.2 | = 0.9048 | 435 / 513 | -76.0 |
| XTZUSDT 1h | 26304 (0) | 183 | 557 | 0.30 | 34.8 | = 0.1746 | 384 / 444 | -1.1 |
| RVNUSDT 1h | 26304 (0) | 181 | -1077 | -0.60 | 32.8 | = 0.8452 | 415 / 466 | -42.9 |
| HBARUSDT 1h | 26304 (0) | 182 | 1858 | 1.02 | 32.3 | = 0.0674 | 267 / 294 | 41.9 |
| KAVAUSDT 1h | 26304 (0) | 168 | -15 | -0.01 | 35.4 | = 0.1298 | 662 / 745 | -34.9 |
| STXUSDT 1h | 26304 (0) | 192 | 1051 | 0.55 | 33.9 | = 0.2484 | 455 / 404 | -5.9 |
| ARPAUSDT 1h | 26304 (0) | 198 | -2585 | -1.31 | 35.6 | = 0.9970 | 627 / 512 | -53.0 |
| IOTXUSDT 1h | 26304 (0) | 198 | -587 | -0.30 | 34.5 | = 0.5912 | 522 / 498 | -58.3 |
| RLCUSDT 1h | 26304 (0) | 195 | -625 | -0.32 | 36.4 | = 0.8358 | 622 / 599 | 9.9 |
| BCHUSDT 1h | 26304 (0) | 202 | 117 | 0.06 | 37.7 | = 0.5320 | 569 / 518 | 34.3 |
| FTTUSDT 1h | 26304 (0) | 129 | 574 | 0.44 | 33.0 | = 0.4250 | 565 / 471 | -72.5 |

</details>

## 2h — 2020-2026

Fenêtre `2020-01-01T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 40 cellule(s) disponible(s) sur 42 ; indisponibles : CVCUSDT 2h (1868 bougies manquantes (écartées comprises) sur 29664 attendues) ; FTTUSDT 2h (3751 bougies manquantes (écartées comprises) sur 29664 attendues).

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ✅ tenu | 8094 trades (dont 8091 clos par règle), expectancy nette 16.440 USDT (1.644 %) |
| Signaux | S1 | x3 | ✅ tenu | 8094 trades (dont 8091 clos par règle), expectancy nette 13.610 USDT (1.361 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.1048 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté 3286.1 % log contre médiane nulle -401.6 % |
| Signaux | S3 | étendue | ✅ tenu | PnL net x1 > 0 dans 39 cellule(s) sur 40 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 4013 trades clos, expectancy 3.093 % hors frais |
| Signaux | S4 | M2 | ✅ tenu | 4078 trades clos, expectancy 0.489 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 18507 forts achats, -23.6 bps en moyenne à 12 bougies (45.5 % de hausses), p unilatérale = 0.9968 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle -0.3 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 14 cellule(s) sur 40 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -23.6 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 8094 (8091) | 16.440 | 1.644 | 133066 | 32.8 |
| AXIS x2 | 8094 (8091) | 15.025 | 1.502 | 121611 | 32.2 |
| AXIS x3 | 8094 (8091) | 13.610 | 1.361 | 110161 | 31.6 |
| EMA 200 x1-central | 23062 (23053) | 6.312 | 0.631 | 145579 | 12.8 |
| EMA 200 x3 | 23062 (23053) | 3.501 | 0.350 | 80737 | 11.5 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 8091, 1.781 / 4013, 3.093 / 4078, 0.489 |
| Timing : capté / médiane nulle / 95e centile (% log) | 3286.1 / -401.6 / 4508.6 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.1048 (29346 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.1480, capté 2750.8 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 39 / 40 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 18 / 40 |
| Exposition moyenne / achat-conservation médian | 35.5 % / -10.3 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 18507 / -16.2 / 44 / -7.2 | 18507 / -16.7 / 44 / -5.8 | 18507 / -21.6 / 45 / -6.4 | 18507 / -16.4 / 46 / -3.7 | 18507 / -23.6 / 45 / -4.0 | 18507 / -48.0 / 45 / -6.3 | 18507 / -40.4 / 46 / -4.3 |
| Fortes ventes | 15241 / -0.6 / 48 / -0.3 | 15241 / -3.5 / 48 / -1.3 | 15241 / 2.3 / 47 / 0.7 | 15241 / -3.7 / 48 / -0.8 | 15241 / -20.6 / 47 / -3.5 | 15241 / -18.6 / 48 / -2.5 | 15241 / -37.8 / 48 / -4.0 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9968 / = 0.0044 (29554 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -46 / -0 / 13 |
| Forts achats nets de 0.14 % aller-retour (bps) | -38 |
| Fortes ventes : p bilatérale | = 0.1396 |
| Cellules à moyenne > 0 / ayant un fort achat | 14 / 40 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -4 / -24 / -5, = 1.0000 |
| Au-dessus / sous l'EMA 200 | 11596 / -40.9 / 43 / -5.0 ; 6733 / 0.7 / 49 / 0.1 |
| Par année (achats / ventes ; moyenne achats bps) | 2020 : 2755 / 2361 ; 15 · 2021 : 2803 / 1368 ; 8 · 2022 : 2515 / 2245 ; -61 · 2023 : 3026 / 2414 ; -31 · 2024 : 2547 / 2260 ; -15 · 2025 : 2473 / 2613 ; -45 · 2026 : 2388 / 1980 ; -43 |

<details><summary>Détail par cellule (40)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 2h | 29646 (18) | 208 | 1079 | 0.52 | 35.3 | = 0.2596 | 493 / 363 | -11.8 |
| LTCUSDT 2h | 29646 (18) | 229 | 263 | 0.11 | 37.9 | = 0.5300 | 279 / 279 | 53.1 |
| QTUMUSDT 2h | 29646 (18) | 207 | 1431 | 0.69 | 35.4 | = 0.4802 | 530 / 385 | -42.5 |
| IOTAUSDT 2h | 29646 (18) | 199 | 1450 | 0.73 | 34.6 | = 0.2372 | 382 / 334 | -25.0 |
| XLMUSDT 2h | 29646 (18) | 194 | 5526 | 2.85 | 33.1 | = 0.0570 | 340 / 299 | 18.4 |
| ONTUSDT 2h | 29646 (18) | 207 | 91 | 0.04 | 36.1 | = 0.4368 | 474 / 411 | -127.6 |
| TRXUSDT 2h | 29646 (18) | 253 | 2398 | 0.95 | 45.2 | = 0.2630 | 224 / 226 | 18.3 |
| ETCUSDT 2h | 29646 (18) | 205 | 3730 | 1.82 | 32.6 | = 0.1186 | 415 / 463 | 41.2 |
| VETUSDT 2h | 29646 (18) | 202 | 4556 | 2.26 | 36.3 | = 0.0316 | 295 / 267 | 40.7 |
| ONGUSDT 2h | 29646 (18) | 173 | 1136 | 0.66 | 33.0 | = 0.5056 | 713 / 523 | -91.5 |
| HOTUSDT 2h | 29646 (18) | 163 | 5204 | 3.19 | 31.8 | = 0.0056 | 509 / 368 | -15.3 |
| ZILUSDT 2h | 29646 (18) | 195 | 5311 | 2.72 | 35.7 | = 0.0886 | 405 / 337 | 46.2 |
| FETUSDT 2h | 29646 (18) | 204 | 6845 | 3.36 | 36.9 | = 0.1244 | 386 / 258 | -61.9 |
| ZRXUSDT 2h | 29646 (18) | 218 | 1657 | 0.76 | 34.8 | = 0.5540 | 581 / 442 | 48.0 |
| BATUSDT 2h | 29646 (18) | 216 | 391 | 0.18 | 37.6 | = 0.4796 | 458 / 373 | -29.0 |
| ZECUSDT 2h | 29646 (18) | 218 | 4312 | 1.98 | 38.7 | = 0.2056 | 375 / 340 | 77.3 |
| IOSTUSDT 2h | 29646 (18) | 188 | 1838 | 0.98 | 33.2 | = 0.1164 | 495 / 441 | -50.4 |
| CELRUSDT 2h | 29646 (18) | 213 | 3655 | 1.72 | 36.9 | = 0.2694 | 377 / 340 | -141.2 |
| DASHUSDT 2h | 29646 (18) | 211 | 2946 | 1.40 | 37.8 | = 0.1736 | 338 / 301 | 194.9 |
| THETAUSDT 2h | 29646 (18) | 212 | 4736 | 2.23 | 35.5 | = 0.2392 | 336 / 358 | -14.9 |
| ENJUSDT 2h | 29646 (18) | 197 | 2780 | 1.41 | 32.5 | = 0.4282 | 456 / 401 | -67.2 |
| ATOMUSDT 2h | 29646 (18) | 203 | 1507 | 0.74 | 35.5 | = 0.2332 | 295 / 302 | -37.8 |
| TFUELUSDT 2h | 29646 (18) | 177 | 8105 | 4.58 | 33.3 | = 0.1524 | 690 / 465 | -72.4 |
| ONEUSDT 2h | 29646 (18) | 183 | 9963 | 5.44 | 33.5 | = 0.0124 | 359 / 340 | 36.7 |
| ALGOUSDT 2h | 29646 (18) | 206 | 2064 | 1.00 | 35.8 | = 0.2412 | 286 / 248 | -17.5 |
| DUSKUSDT 2h | 29646 (18) | 203 | 2055 | 1.01 | 37.2 | = 0.7076 | 593 / 465 | -44.5 |
| ANKRUSDT 2h | 29646 (18) | 194 | 3365 | 1.73 | 35.8 | = 0.4084 | 539 / 388 | -14.2 |
| WINUSDT 2h | 29646 (18) | 179 | 4752 | 2.65 | 32.9 | = 0.0510 | 497 / 313 | -82.5 |
| MTLUSDT 2h | 29646 (18) | 199 | 1167 | 0.59 | 35.8 | = 0.6520 | 763 / 505 | -11.0 |
| CHZUSDT 2h | 29646 (18) | 197 | 12163 | 6.17 | 36.3 | = 0.0074 | 451 / 437 | -38.3 |
| BANDUSDT 2h | 29646 (18) | 214 | 3180 | 1.49 | 37.7 | = 0.5856 | 467 / 403 | -99.5 |
| XTZUSDT 2h | 29646 (18) | 198 | 849 | 0.43 | 34.6 | = 0.2890 | 400 / 358 | -44.9 |
| RVNUSDT 2h | 29646 (18) | 192 | 7584 | 3.95 | 31.3 | = 0.2098 | 434 / 419 | -66.7 |
| HBARUSDT 2h | 29646 (18) | 195 | 5497 | 2.82 | 33.4 | = 0.0642 | 370 / 304 | 16.9 |
| KAVAUSDT 2h | 29646 (18) | 189 | 574 | 0.30 | 34.0 | = 0.4816 | 581 / 602 | 23.7 |
| STXUSDT 2h | 29646 (18) | 212 | 3285 | 1.55 | 36.3 | = 0.2894 | 531 / 392 | -54.6 |
| ARPAUSDT 2h | 29646 (18) | 210 | -1934 | -0.92 | 37.0 | = 0.9892 | 703 / 411 | -43.6 |
| IOTXUSDT 2h | 29646 (18) | 208 | 3002 | 1.44 | 35.2 | = 0.2726 | 561 / 439 | 13.9 |
| RLCUSDT 2h | 29646 (18) | 210 | 2635 | 1.25 | 36.1 | = 0.5148 | 634 / 539 | -70.5 |
| BCHUSDT 2h | 29646 (18) | 213 | 1918 | 0.90 | 35.7 | = 0.2010 | 492 / 402 | 27.9 |

</details>

## 6h — 2020-2026

Fenêtre `2020-01-01T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 40 cellule(s) disponible(s) sur 42 ; indisponibles : CVCUSDT 6h (621 bougies manquantes (écartées comprises) sur 9888 attendues) ; FTTUSDT 6h (1249 bougies manquantes (écartées comprises) sur 9888 attendues).

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ✅ tenu | 2423 trades (dont 2407 clos par règle), expectancy nette 73.794 USDT (7.379 %) |
| Signaux | S1 | x3 | ✅ tenu | 2423 trades (dont 2407 clos par règle), expectancy nette 70.861 USDT (7.086 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.0742 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; capté 5679.0 % log contre médiane nulle 85.9 % |
| Signaux | S3 | étendue | ✅ tenu | PnL net x1 > 0 dans 39 cellule(s) sur 40 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 1200 trades clos, expectancy 12.073 % hors frais |
| Signaux | S4 | M2 | ✅ tenu | 1207 trades clos, expectancy 2.796 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 6193 forts achats, -67.6 bps en moyenne à 12 bougies (44.0 % de hausses), p unilatérale = 0.9934 (seuil 0.0038 ; 4999 décalages tirés, plancher 0.0002) ; médiane nulle -3.0 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 14 cellule(s) sur 40 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -67.6 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 2423 (2407) | 73.794 | 7.379 | 178802 | 34.3 |
| AXIS x2 | 2423 (2407) | 72.327 | 7.233 | 175248 | 34.1 |
| AXIS x3 | 2423 (2407) | 70.861 | 7.086 | 171695 | 33.9 |
| EMA 200 x1-central | 6932 (6897) | 46.083 | 4.608 | 319444 | 13.6 |
| EMA 200 x3 | 6932 (6897) | 43.199 | 4.320 | 299458 | 12.7 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 2407, 7.421 / 1200, 12.073 / 1207, 2.796 |
| Timing : capté / médiane nulle / 95e centile (% log) | 5679.0 / 85.9 / 6337.5 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.0742 (9584 décisions, 4999 décalages tirés) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.1090, capté 5796.6 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 39 / 40 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 34 / 40 |
| Exposition moyenne / achat-conservation médian | 33.1 % / 76.0 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 6193 / -18.0 / 44 / -2.6 | 6193 / -11.3 / 45 / -1.2 | 6193 / -13.1 / 44 / -1.2 | 6193 / -66.8 / 43 / -4.9 | 6193 / -67.6 / 44 / -4.0 | 6193 / -22.3 / 46 / -1.0 | 6193 / 3.5 / 46 / 0.1 |
| Fortes ventes | 3980 / -9.1 / 47 / -1.3 | 3980 / -7.6 / 48 / -0.8 | 3980 / -18.2 / 47 / -1.6 | 3980 / -18.8 / 48 / -1.4 | 3980 / -36.6 / 47 / -2.1 | 3980 / -20.8 / 50 / -0.9 | 3980 / -82.3 / 49 / -2.7 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9934 / = 0.0072 (9792 décisions, 4999 décalages tirés) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -127 / -3 / 34 |
| Forts achats nets de 0.14 % aller-retour (bps) | -82 |
| Fortes ventes : p bilatérale | = 0.3880 |
| Cellules à moyenne > 0 / ayant un fort achat | 14 / 40 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -27 / -68 / -30, = 0.9998 |
| Au-dessus / sous l'EMA 200 | 3597 / -47.0 / 44 / -1.8 ; 2455 / -125.2 / 43 / -6.2 |
| Par année (achats / ventes ; moyenne achats bps) | 2020 : 875 / 562 ; 93 · 2021 : 1043 / 402 ; -22 · 2022 : 771 / 523 ; -190 · 2023 : 1068 / 708 ; -116 · 2024 : 797 / 646 ; -32 · 2025 : 797 / 656 ; -154 · 2026 : 842 / 483 ; -70 |

<details><summary>Détail par cellule (40)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 6h | 9884 (4) | 57 | 1896 | 3.33 | 34.5 | = 0.1458 | 152 / 93 | -151.2 |
| LTCUSDT 6h | 9884 (4) | 74 | 508 | 0.69 | 38.5 | = 0.6632 | 83 / 61 | 180.9 |
| QTUMUSDT 6h | 9884 (4) | 55 | 3085 | 5.61 | 32.4 | = 0.1136 | 177 / 116 | -182.2 |
| IOTAUSDT 6h | 9884 (4) | 56 | 2491 | 4.45 | 31.8 | = 0.1874 | 122 / 93 | 75.0 |
| XLMUSDT 6h | 9884 (4) | 67 | 3536 | 5.28 | 34.7 | = 0.3138 | 124 / 93 | 279.8 |
| ONTUSDT 6h | 9884 (4) | 64 | -213 | -0.33 | 31.6 | = 0.5888 | 146 / 104 | -328.1 |
| TRXUSDT 6h | 9884 (4) | 87 | 2087 | 2.40 | 46.8 | = 0.5180 | 67 / 51 | 242.8 |
| ETCUSDT 6h | 9884 (4) | 57 | 3450 | 6.05 | 32.5 | = 0.1022 | 151 / 118 | 156.7 |
| VETUSDT 6h | 9884 (4) | 55 | 6355 | 11.56 | 33.8 | = 0.0074 | 94 / 64 | 196.5 |
| ONGUSDT 6h | 9884 (4) | 49 | 979 | 2.00 | 28.3 | = 0.6838 | 272 / 170 | -446.0 |
| HOTUSDT 6h | 9884 (4) | 40 | 6542 | 16.36 | 29.4 | = 0.0060 | 192 / 93 | -89.0 |
| ZILUSDT 6h | 9884 (4) | 58 | 4906 | 8.46 | 30.6 | = 0.0488 | 141 / 105 | -129.4 |
| FETUSDT 6h | 9884 (4) | 58 | 11729 | 20.22 | 36.3 | = 0.0230 | 124 / 69 | 20.3 |
| ZRXUSDT 6h | 9884 (4) | 62 | 2766 | 4.46 | 32.9 | = 0.3400 | 203 / 112 | -20.0 |
| BATUSDT 6h | 9884 (4) | 65 | 731 | 1.13 | 35.9 | = 0.5094 | 166 / 106 | -173.5 |
| ZECUSDT 6h | 9884 (4) | 68 | 10483 | 15.42 | 39.7 | = 0.0612 | 98 / 88 | 624.2 |
| IOSTUSDT 6h | 9884 (4) | 60 | 2489 | 4.15 | 27.9 | = 0.2164 | 176 / 110 | -156.0 |
| CELRUSDT 6h | 9884 (4) | 62 | 3639 | 5.87 | 32.5 | = 0.2618 | 121 / 84 | -400.9 |
| DASHUSDT 6h | 9884 (4) | 62 | 3540 | 5.71 | 34.1 | = 0.1128 | 102 / 75 | 441.7 |
| THETAUSDT 6h | 9884 (4) | 68 | 5885 | 8.65 | 33.3 | = 0.0616 | 101 / 97 | -222.8 |
| ENJUSDT 6h | 9884 (4) | 59 | 4096 | 6.94 | 32.1 | = 0.1258 | 153 / 102 | -205.7 |
| ATOMUSDT 6h | 9884 (4) | 69 | 1651 | 2.39 | 32.3 | = 0.2766 | 75 / 71 | -208.4 |
| TFUELUSDT 6h | 9884 (4) | 52 | 15339 | 29.50 | 31.1 | = 0.0398 | 218 / 138 | -45.7 |
| ONEUSDT 6h | 9884 (4) | 53 | 10101 | 19.06 | 29.9 | = 0.0094 | 111 / 78 | 490.4 |
| ALGOUSDT 6h | 9884 (4) | 67 | 4020 | 6.00 | 32.5 | = 0.2072 | 91 / 58 | 217.2 |
| DUSKUSDT 6h | 9884 (4) | 71 | 3268 | 4.60 | 34.5 | = 0.4648 | 178 / 100 | -22.5 |
| ANKRUSDT 6h | 9884 (4) | 61 | 4156 | 6.81 | 34.3 | = 0.2308 | 200 / 115 | -196.2 |
| WINUSDT 6h | 9884 (4) | 49 | 7023 | 14.33 | 27.6 | = 0.0216 | 179 / 95 | 91.6 |
| MTLUSDT 6h | 9884 (4) | 64 | 520 | 0.81 | 32.3 | = 0.8274 | 290 / 151 | -119.6 |
| CHZUSDT 6h | 9884 (4) | 59 | 20194 | 34.23 | 34.4 | = 0.0144 | 146 / 92 | -176.6 |
| BANDUSDT 6h | 9884 (4) | 65 | 2528 | 3.89 | 33.3 | = 0.4336 | 156 / 106 | -52.1 |
| XTZUSDT 6h | 9884 (4) | 61 | 123 | 0.20 | 31.8 | = 0.6028 | 127 / 87 | 30.6 |
| RVNUSDT 6h | 9884 (4) | 51 | 4938 | 9.68 | 26.7 | = 0.1024 | 166 / 107 | -244.8 |
| HBARUSDT 6h | 9884 (4) | 54 | 6196 | 11.47 | 34.7 | = 0.0702 | 125 / 71 | -16.6 |
| KAVAUSDT 6h | 9884 (4) | 53 | 3296 | 6.22 | 29.5 | = 0.0610 | 154 / 133 | -30.6 |
| STXUSDT 6h | 9884 (4) | 59 | 4535 | 7.69 | 32.6 | = 0.1018 | 188 / 94 | -168.6 |
| ARPAUSDT 6h | 9884 (4) | 56 | 1647 | 2.94 | 34.7 | = 0.4780 | 258 / 113 | -206.7 |
| IOTXUSDT 6h | 9884 (4) | 61 | 5032 | 8.25 | 33.6 | = 0.0718 | 207 / 124 | -74.8 |
| RLCUSDT 6h | 9884 (4) | 64 | 1708 | 2.67 | 33.3 | = 0.6942 | 225 / 141 | -169.9 |
| BCHUSDT 6h | 9884 (4) | 71 | 1545 | 2.18 | 36.7 | = 0.3410 | 134 / 102 | 52.1 |

</details>

## 12h — 2020-2026

Fenêtre `2020-01-01T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 40 cellule(s) disponible(s) sur 42 ; indisponibles : CVCUSDT 12h (309 bougies manquantes (écartées comprises) sur 4944 attendues) ; FTTUSDT 12h (623 bougies manquantes (écartées comprises) sur 4944 attendues).

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ✅ tenu | 1095 trades (dont 1061 clos par règle), expectancy nette 202.370 USDT (20.237 %) |
| Signaux | S1 | x3 | ✅ tenu | 1095 trades (dont 1061 clos par règle), expectancy nette 199.205 USDT (19.921 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.0552 (seuil 0.0038 ; 3715 décalages, tous, plancher 0.0002) ; capté 4480.8 % log contre médiane nulle -1200.2 % |
| Signaux | S3 | étendue | ✅ tenu | PnL net x1 > 0 dans 35 cellule(s) sur 40 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 543 trades clos, expectancy 35.083 % hors frais |
| Signaux | S4 | M2 | ✅ tenu | 518 trades clos, expectancy 5.140 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 3119 forts achats, -83.8 bps en moyenne à 12 bougies (43.5 % de hausses), p unilatérale = 0.9452 (seuil 0.0038 ; 3881 décalages, tous, plancher 0.0002) ; médiane nulle -10.8 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 15 cellule(s) sur 40 ayant au moins un fort achat |
| Forts achats | F3 | économie | ❌ échec | moyenne regroupée -83.8 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 1095 (1061) | 202.370 | 20.237 | 221595 | 35.2 |
| AXIS x2 | 1095 (1061) | 200.787 | 20.079 | 219862 | 34.9 |
| AXIS x3 | 1095 (1061) | 199.205 | 19.921 | 218130 | 34.9 |
| EMA 200 x1-central | 3295 (3258) | 66.839 | 6.684 | 220235 | 12.7 |
| EMA 200 x3 | 3295 (3258) | 63.919 | 6.392 | 210612 | 12.1 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 1061, 20.464 / 543, 35.083 / 518, 5.140 |
| Timing : capté / médiane nulle / 95e centile (% log) | 4480.8 / -1200.2 / 4553.2 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.0552 (4643 décisions, 3715 décalages, tous) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.2326, capté 1889.7 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 35 / 40 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 20 / 40 |
| Exposition moyenne / achat-conservation médian | 30.6 % / -26.9 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 3119 / -29.6 / 42 / -2.1 | 3119 / -92.6 / 40 / -5.4 | 3119 / -115.2 / 41 / -5.8 | 3119 / -138.3 / 42 / -5.5 | 3119 / -83.8 / 44 / -2.5 | 3119 / -50.0 / 43 / -1.1 | 3119 / -60.9 / 43 / -1.1 |
| Fortes ventes | 1719 / -71.4 / 45 / -4.4 | 1719 / -45.7 / 46 / -2.1 | 1719 / -71.9 / 46 / -3.0 | 1719 / -81.0 / 48 / -2.7 | 1719 / -74.5 / 48 / -1.8 | 1719 / -245.7 / 45 / -4.7 | 1719 / -261.5 / 49 / -3.8 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.9452 / = 0.0758 (4851 décisions, 3881 décalages, tous) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -193 / -11 / 66 |
| Forts achats nets de 0.14 % aller-retour (bps) | -98 |
| Fortes ventes : p bilatérale | = 0.3746 |
| Cellules à moyenne > 0 / ayant un fort achat | 15 / 40 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -28 / -84 / -36, = 0.9938 |
| Au-dessus / sous l'EMA 200 | 1661 / -17.2 / 44 / -0.3 ; 1362 / -121.2 / 43 / -3.2 |
| Par année (achats / ventes ; moyenne achats bps) | 2020 : 432 / 209 ; -20 · 2021 : 502 / 193 ; 235 · 2022 : 378 / 233 ; -474 · 2023 : 553 / 282 ; -184 · 2024 : 392 / 304 ; 134 · 2025 : 413 / 274 ; -275 · 2026 : 449 / 224 ; -64 |

<details><summary>Détail par cellule (40)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 12h | 4943 (1) | 25 | 2813 | 11.25 | 29.6 | = 0.1241 | 78 / 42 | -509.4 |
| LTCUSDT 12h | 4943 (1) | 37 | -173 | -0.47 | 37.8 | = 0.7288 | 32 / 30 | -69.8 |
| QTUMUSDT 12h | 4943 (1) | 28 | 1151 | 4.11 | 31.9 | = 0.2616 | 100 / 62 | -155.6 |
| IOTAUSDT 12h | 4943 (1) | 28 | 4368 | 15.60 | 26.3 | = 0.0872 | 66 / 36 | 256.2 |
| XLMUSDT 12h | 4943 (1) | 39 | 949 | 2.43 | 34.1 | = 0.7283 | 57 / 41 | 761.7 |
| ONTUSDT 12h | 4943 (1) | 28 | -57 | -0.20 | 33.0 | = 0.6505 | 82 / 45 | -570.4 |
| TRXUSDT 12h | 4943 (1) | 40 | 3236 | 8.09 | 49.2 | = 0.3224 | 31 / 20 | -230.3 |
| ETCUSDT 12h | 4943 (1) | 29 | 8394 | 28.94 | 32.8 | = 0.1133 | 73 / 51 | 198.2 |
| VETUSDT 12h | 4943 (1) | 25 | 9942 | 39.77 | 30.1 | = 0.0221 | 39 / 31 | -183.3 |
| ONGUSDT 12h | 4943 (1) | 24 | 1447 | 6.03 | 28.3 | = 0.6265 | 141 / 75 | -335.1 |
| HOTUSDT 12h | 4943 (1) | 22 | 14437 | 65.62 | 25.7 | = 0.0407 | 102 / 48 | 75.9 |
| ZILUSDT 12h | 4943 (1) | 23 | 4067 | 17.68 | 28.5 | = 0.0280 | 66 / 41 | 42.2 |
| FETUSDT 12h | 4943 (1) | 25 | 13909 | 55.63 | 35.1 | = 0.0095 | 59 / 30 | 170.8 |
| ZRXUSDT 12h | 4943 (1) | 27 | 2628 | 9.74 | 30.5 | = 0.1970 | 101 / 41 | 49.2 |
| BATUSDT 12h | 4943 (1) | 28 | 2806 | 10.02 | 31.7 | = 0.3281 | 86 / 40 | 61.7 |
| ZECUSDT 12h | 4943 (1) | 35 | 11075 | 31.64 | 35.2 | = 0.1981 | 42 / 33 | 1023.8 |
| IOSTUSDT 12h | 4943 (1) | 23 | 5819 | 25.30 | 25.7 | = 0.1491 | 85 / 58 | -84.0 |
| CELRUSDT 12h | 4943 (1) | 27 | 5090 | 18.85 | 31.1 | = 0.1023 | 46 / 36 | -478.8 |
| DASHUSDT 12h | 4943 (1) | 32 | 1156 | 3.61 | 31.2 | = 0.3916 | 47 / 28 | -0.9 |
| THETAUSDT 12h | 4943 (1) | 28 | 5688 | 20.31 | 30.3 | = 0.0251 | 47 / 37 | 373.2 |
| ENJUSDT 12h | 4943 (1) | 21 | 4252 | 20.25 | 23.9 | = 0.0334 | 66 / 46 | 346.7 |
| ATOMUSDT 12h | 4943 (1) | 30 | 2438 | 8.13 | 33.2 | = 0.1521 | 40 / 36 | -497.7 |
| TFUELUSDT 12h | 4943 (1) | 22 | 25403 | 115.47 | 28.3 | = 0.0940 | 123 / 45 | -6.0 |
| ONEUSDT 12h | 4943 (1) | 25 | 6816 | 27.27 | 27.9 | = 0.0183 | 48 / 42 | 592.3 |
| ALGOUSDT 12h | 4943 (1) | 26 | 2415 | 9.29 | 28.2 | = 0.1887 | 41 / 25 | -31.1 |
| DUSKUSDT 12h | 4943 (1) | 32 | 5411 | 16.91 | 37.3 | = 0.3101 | 89 / 52 | 323.0 |
| ANKRUSDT 12h | 4943 (1) | 24 | 7272 | 30.30 | 27.0 | = 0.3531 | 133 / 37 | -100.8 |
| WINUSDT 12h | 4943 (1) | 20 | 14895 | 74.47 | 27.0 | = 0.0143 | 108 / 42 | -61.3 |
| MTLUSDT 12h | 4943 (1) | 28 | 1209 | 4.32 | 32.5 | = 0.3849 | 141 / 73 | -500.4 |
| CHZUSDT 12h | 4943 (1) | 30 | 16892 | 56.31 | 28.8 | = 0.0889 | 69 / 34 | 94.0 |
| BANDUSDT 12h | 4943 (1) | 24 | 4607 | 19.20 | 28.1 | = 0.2005 | 74 / 44 | -430.0 |
| XTZUSDT 12h | 4943 (1) | 27 | -90 | -0.33 | 26.4 | = 0.4971 | 55 / 37 | -285.7 |
| RVNUSDT 12h | 4943 (1) | 22 | 7523 | 34.20 | 21.8 | = 0.0622 | 88 / 48 | -322.3 |
| HBARUSDT 12h | 4943 (1) | 20 | 12171 | 60.85 | 29.8 | ≤ 0.0003 | 68 / 32 | -150.2 |
| KAVAUSDT 12h | 4943 (1) | 27 | -192 | -0.71 | 25.4 | = 0.5549 | 76 / 53 | -170.9 |
| STXUSDT 12h | 4943 (1) | 25 | 5877 | 23.51 | 33.0 | = 0.0471 | 90 / 39 | -111.6 |
| ARPAUSDT 12h | 4943 (1) | 26 | -42 | -0.16 | 26.6 | = 0.7439 | 161 / 46 | -396.7 |
| IOTXUSDT 12h | 4943 (1) | 25 | 3995 | 15.98 | 30.2 | = 0.1941 | 103 / 58 | -177.3 |
| RLCUSDT 12h | 4943 (1) | 27 | 1954 | 7.24 | 34.0 | = 0.3087 | 107 / 61 | -331.6 |
| BCHUSDT 12h | 4943 (1) | 41 | 44 | 0.11 | 37.2 | = 0.7727 | 59 / 44 | 343.1 |

</details>

## 1d — 2020-2026

Fenêtre `2020-01-01T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 40 cellule(s) disponible(s) sur 42 ; indisponibles : CVCUSDT 1d (154 bougies manquantes (écartées comprises) sur 2472 attendues) ; FTTUSDT 1d (311 bougies manquantes (écartées comprises) sur 2472 attendues).

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ✅ tenu | 471 trades (dont 439 clos par règle), expectancy nette 357.639 USDT (35.764 %) |
| Signaux | S1 | x3 | ✅ tenu | 471 trades (dont 439 clos par règle), expectancy nette 354.196 USDT (35.420 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.1208 (seuil 0.0038 ; 1738 décalages, tous, plancher 0.0005) ; capté 3141.6 % log contre médiane nulle -1150.8 % |
| Signaux | S3 | étendue | ✅ tenu | PnL net x1 > 0 dans 32 cellule(s) sur 40 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 244 trades clos, expectancy 56.823 % hors frais |
| Signaux | S4 | M2 | ✅ tenu | 195 trades clos, expectancy 14.689 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 1724 forts achats, 46.2 bps en moyenne à 12 bougies (43.6 % de hausses), p unilatérale = 0.1785 (seuil 0.0038 ; 1904 décalages, tous, plancher 0.0005) ; médiane nulle -27.9 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 20 cellule(s) sur 40 ayant au moins un fort achat |
| Forts achats | F3 | économie | ✅ tenu | moyenne regroupée 46.2 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 471 (439) | 357.639 | 35.764 | 168448 | 40.8 |
| AXIS x2 | 471 (439) | 355.917 | 35.592 | 167637 | 40.6 |
| AXIS x3 | 471 (439) | 354.196 | 35.420 | 166826 | 40.6 |
| EMA 200 x1-central | 1526 (1493) | 77.388 | 7.739 | 118094 | 14.3 |
| EMA 200 x3 | 1526 (1493) | 74.448 | 7.445 | 113608 | 14.0 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 439, 38.107 / 244, 56.823 / 195, 14.689 |
| Timing : capté / médiane nulle / 95e centile (% log) | 3141.6 / -1150.8 / 4681.2 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.1208 (2172 décisions, 1738 décalages, tous) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.3278, capté 448.6 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 32 / 40 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 11 / 40 |
| Exposition moyenne / achat-conservation médian | 26.5 % / -31.1 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 1724 / -104.2 / 39 / -4.6 | 1724 / -146.5 / 39 / -5.0 | 1724 / -137.3 / 40 / -3.9 | 1724 / -48.1 / 43 / -1.0 | 1724 / 46.2 / 44 / 0.7 | 1724 / 193.5 / 46 / 2.2 | 1724 / 168.1 / 45 / 1.5 |
| Fortes ventes | 715 / -23.5 / 48 / -0.6 | 715 / -118.0 / 45 / -2.8 | 715 / -176.3 / 44 / -3.7 | 715 / -107.5 / 45 / -1.8 | 715 / -185.6 / 44 / -2.6 | 715 / -279.6 / 47 / -2.7 | 715 / -74.9 / 50 / -0.6 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.1785 / = 0.6006 (2380 décisions, 1904 décalages, tous) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -315 / -28 / 113 |
| Forts achats nets de 0.14 % aller-retour (bps) | 32 |
| Fortes ventes : p bilatérale | = 0.2798 |
| Cellules à moyenne > 0 / ayant un fort achat | 20 / 40 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | 87 / 46 / 79, = 0.8528 |
| Au-dessus / sous l'EMA 200 | 770 / 257.5 / 46 / 2.3 ; 839 / -181.5 / 41 / -2.5 |
| Par année (achats / ventes ; moyenne achats bps) | 2020 : 203 / 97 ; 68 · 2021 : 291 / 56 ; 593 · 2022 : 210 / 124 ; -917 · 2023 : 300 / 115 ; 103 · 2024 : 254 / 132 ; 829 · 2025 : 227 / 106 ; -604 · 2026 : 239 / 85 ; -77 |

<details><summary>Détail par cellule (40)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 1d | 2472 (0) | 11 | 857 | 7.79 | 24.4 | = 0.3060 | 48 / 22 | 11.2 |
| LTCUSDT 1d | 2472 (0) | 16 | -949 | -5.93 | 27.3 | = 0.9575 | 14 / 14 | 139.6 |
| QTUMUSDT 1d | 2472 (0) | 15 | -478 | -3.19 | 29.1 | = 0.6947 | 53 / 24 | -399.8 |
| IOTAUSDT 1d | 2472 (0) | 11 | 1925 | 17.50 | 21.4 | = 0.1179 | 28 / 12 | 111.2 |
| XLMUSDT 1d | 2472 (0) | 14 | 3266 | 23.33 | 30.5 | = 0.1329 | 42 / 21 | 926.1 |
| ONTUSDT 1d | 2472 (0) | 12 | -337 | -2.81 | 29.1 | = 0.6659 | 50 / 25 | -338.4 |
| TRXUSDT 1d | 2472 (0) | 19 | 2925 | 15.39 | 52.0 | = 0.3641 | 17 / 13 | -41.7 |
| ETCUSDT 1d | 2472 (0) | 14 | 4031 | 28.79 | 30.3 | = 0.0926 | 37 / 22 | -166.8 |
| VETUSDT 1d | 2472 (0) | 12 | 6517 | 54.30 | 27.9 | = 0.0512 | 22 / 16 | 1022.5 |
| ONGUSDT 1d | 2472 (0) | 9 | -346 | -3.85 | 27.4 | = 0.8385 | 89 / 32 | 263.3 |
| HOTUSDT 1d | 2472 (0) | 11 | 8998 | 81.80 | 21.1 | = 0.1277 | 59 / 17 | 671.0 |
| ZILUSDT 1d | 2472 (0) | 9 | -768 | -8.54 | 15.4 | = 0.7735 | 40 / 20 | 170.7 |
| FETUSDT 1d | 2472 (0) | 15 | 9606 | 64.04 | 27.5 | = 0.1323 | 26 / 13 | -534.0 |
| ZRXUSDT 1d | 2472 (0) | 12 | 1869 | 15.57 | 23.0 | = 0.2600 | 53 / 21 | 212.1 |
| BATUSDT 1d | 2472 (0) | 12 | 3411 | 28.43 | 32.0 | = 0.0627 | 43 / 20 | -440.9 |
| ZECUSDT 1d | 2472 (0) | 18 | 7954 | 44.19 | 37.2 | = 0.2260 | 19 / 12 | 2784.3 |
| IOSTUSDT 1d | 2472 (0) | 9 | 6786 | 75.40 | 21.1 | = 0.1099 | 46 / 19 | -323.8 |
| CELRUSDT 1d | 2472 (0) | 9 | 7312 | 81.25 | 25.7 | = 0.0144 | 27 / 12 | 57.1 |
| DASHUSDT 1d | 2472 (0) | 14 | 1065 | 7.61 | 30.1 | = 0.3687 | 26 / 9 | -558.8 |
| THETAUSDT 1d | 2472 (0) | 8 | 688 | 8.59 | 13.8 | = 0.3175 | 25 / 11 | 2020.3 |
| ENJUSDT 1d | 2472 (0) | 8 | 8554 | 106.93 | 19.8 | = 0.0225 | 47 / 16 | 1043.1 |
| ATOMUSDT 1d | 2472 (0) | 15 | 842 | 5.61 | 27.9 | = 0.6366 | 15 / 13 | -477.1 |
| TFUELUSDT 1d | 2472 (0) | 8 | 20167 | 252.08 | 21.6 | = 0.0955 | 69 / 14 | 252.5 |
| ONEUSDT 1d | 2472 (0) | 11 | 16095 | 146.32 | 22.7 | = 0.0219 | 33 / 13 | 1685.9 |
| ALGOUSDT 1d | 2472 (0) | 10 | 3341 | 33.41 | 23.2 | = 0.0783 | 29 / 8 | -251.9 |
| DUSKUSDT 1d | 2472 (0) | 11 | 5122 | 46.57 | 27.9 | = 0.2226 | 54 / 26 | -85.5 |
| ANKRUSDT 1d | 2472 (0) | 9 | 17 | 0.19 | 16.2 | = 0.4589 | 55 / 15 | -21.9 |
| WINUSDT 1d | 2472 (0) | 8 | 11648 | 145.60 | 19.7 | = 0.0167 | 59 / 18 | 84.3 |
| MTLUSDT 1d | 2472 (0) | 12 | 4123 | 34.36 | 31.2 | = 0.1961 | 85 / 25 | -568.1 |
| CHZUSDT 1d | 2472 (0) | 13 | 7758 | 59.68 | 26.9 | = 0.1473 | 41 / 20 | 257.0 |
| BANDUSDT 1d | 2472 (0) | 13 | -880 | -6.77 | 26.8 | = 0.6274 | 43 / 14 | -584.5 |
| XTZUSDT 1d | 2472 (0) | 11 | 79 | 0.72 | 26.4 | = 0.4877 | 31 / 10 | -438.4 |
| RVNUSDT 1d | 2472 (0) | 10 | 7742 | 77.42 | 21.6 | = 0.1363 | 59 / 19 | -213.6 |
| HBARUSDT 1d | 2472 (0) | 12 | 8620 | 71.83 | 27.9 | = 0.0035 | 37 / 14 | 359.8 |
| KAVAUSDT 1d | 2472 (0) | 11 | -186 | -1.69 | 21.8 | = 0.4808 | 33 / 20 | -33.6 |
| STXUSDT 1d | 2472 (0) | 9 | 7997 | 88.86 | 34.3 | = 0.1036 | 51 / 11 | 85.9 |
| ARPAUSDT 1d | 2472 (0) | 9 | 2069 | 22.99 | 27.0 | = 0.1628 | 77 / 29 | -573.9 |
| IOTXUSDT 1d | 2472 (0) | 13 | 1766 | 13.59 | 26.2 | = 0.4716 | 50 / 26 | -234.6 |
| RLCUSDT 1d | 2472 (0) | 14 | -1254 | -8.95 | 27.0 | = 0.9287 | 61 / 25 | -841.4 |
| BCHUSDT 1d | 2472 (0) | 14 | 496 | 3.54 | 35.6 | = 0.3905 | 31 / 24 | 221.9 |

</details>

## 3d — 2020-2026

Fenêtre `2020-01-01T00:00:00.000Z` → `2026-10-08T00:00:00.000Z` exclu ; 40 cellule(s) disponible(s) sur 42 ; indisponibles : CVCUSDT 3d (bougie hors grille à 2023-05-12T00:00:00.000Z) ; FTTUSDT 3d (bougie hors grille à 2023-09-22T00:00:00.000Z).

**Signaux : DÉFAVORABLE** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | S1 | x1-central | ❌ échec | 105 trades (dont 101 clos par règle), expectancy nette -74.970 USDT (-7.497 %) |
| Signaux | S1 | x3 | ❌ échec | 105 trades (dont 101 clos par règle), expectancy nette -77.635 USDT (-7.764 %) |
| Signaux | S2 | timing | ❌ échec | p = 0.8381 (seuil 0.0038 ; 419 décalages, tous, plancher 0.0023) ; capté -2031.8 % log contre médiane nulle -844.8 % |
| Signaux | S3 | étendue | ❌ échec | PnL net x1 > 0 dans 9 cellule(s) sur 39 ayant au moins un trade |
| Signaux | S4 | M1 | ✅ tenu | 51 trades clos, expectancy 0.203 % hors frais |
| Signaux | S4 | M2 | ❌ échec | 50 trades clos, expectancy -18.844 % hors frais |
| Forts achats | F1 | regroupé | ❌ échec | 649 forts achats, 123.6 bps en moyenne à 12 bougies (43.6 % de hausses), p unilatérale = 0.1451 (seuil 0.0038 ; 585 décalages, tous, plancher 0.0017) ; médiane nulle -150.2 bps |
| Forts achats | F2 | cellules | ✅ tenu | moyenne > 0 dans 22 cellule(s) sur 40 ayant au moins un fort achat |
| Forts achats | F3 | économie | ✅ tenu | moyenne regroupée 123.6 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 105 (101) | -74.970 | -7.497 | -7872 | 23.8 |
| AXIS x2 | 105 (101) | -76.303 | -7.630 | -8012 | 23.8 |
| AXIS x3 | 105 (101) | -77.635 | -7.764 | -8152 | 23.8 |
| EMA 200 x1-central | 320 (314) | 42.063 | 4.206 | 13460 | 9.4 |
| EMA 200 x3 | 320 (314) | 39.188 | 3.919 | 12540 | 8.8 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 101, -9.226 / 51, 0.203 / 50, -18.844 |
| Timing : capté / médiane nulle / 95e centile (% log) | -2031.8 / -844.8 / 2009.1 |
| Timing : p unilatérale (plus courte fenêtre) | = 0.8381 (523 décisions, 419 décalages, tous) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 0.9239, capté -2034.9 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 9 / 39 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 16 / 40 |
| Exposition moyenne / achat-conservation médian | 18.5 % / -72.2 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 649 / -39.7 / 43 / -0.6 | 649 / 51.2 / 46 / 0.6 | 649 / 52.0 / 45 / 0.5 | 649 / 48.2 / 41 / 0.4 | 649 / 123.6 / 44 / 0.7 | 649 / 56.8 / 44 / 0.2 | 649 / -542.7 / 38 / -1.6 |
| Fortes ventes | 168 / -234.3 / 48 / -2.2 | 168 / -30.1 / 51 / -0.3 | 168 / 54.1 / 53 / 0.4 | 168 / 60.5 / 57 / 0.3 | 168 / 714.1 / 65 / 2.9 | 168 / 705.1 / 64 / 1.7 | 168 / 952.6 / 66 / 1.7 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.1451 / = 0.6792 (731 décisions, 585 décalages, tous) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -481 / -150 / 390 |
| Forts achats nets de 0.14 % aller-retour (bps) | 110 |
| Fortes ventes : p bilatérale | = 0.1349 |
| Cellules à moyenne > 0 / ayant un fort achat | 22 / 40 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | -49 / 124 / -20, = 0.0188 |
| Au-dessus / sous l'EMA 200 | 200 / -1166.2 / 30 / -4.0 ; 291 / -20.9 / 44 / -0.1 |
| Par année (achats / ventes ; moyenne achats bps) | 2020 : 76 / 17 ; 78 · 2021 : 124 / 15 ; 2379 · 2022 : 69 / 37 ; -1985 · 2023 : 120 / 25 ; 348 · 2024 : 135 / 23 ; 267 · 2025 : 80 / 41 ; -1168 · 2026 : 45 / 10 ; -1513 |

<details><summary>Détail par cellule (40)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 3d | 823 (0) | 2 | -458 | -22.92 | 19.7 | = 0.5905 | 17 / 8 | 423.7 |
| LTCUSDT 3d | 823 (0) | 6 | -1114 | -18.56 | 30.0 | = 0.9977 | 4 / 4 | 1552.9 |
| QTUMUSDT 3d | 823 (0) | 2 | -405 | -20.24 | 18.2 | = 0.6548 | 17 / 9 | -1341.9 |
| IOTAUSDT 3d | 823 (0) | 2 | -517 | -25.85 | 14.3 | = 0.6881 | 7 / 3 | -182.8 |
| XLMUSDT 3d | 823 (0) | 3 | 444 | 14.81 | 26.0 | = 0.4691 | 14 / 4 | 942.7 |
| ONTUSDT 3d | 823 (0) | 2 | -716 | -35.81 | 15.1 | = 0.8762 | 14 / 6 | -2273.0 |
| TRXUSDT 3d | 823 (0) | 5 | 1241 | 24.83 | 49.9 | = 0.2905 | 5 / 5 | 331.5 |
| ETCUSDT 3d | 823 (0) | 4 | -1020 | -25.49 | 26.6 | = 0.9810 | 18 / 2 | -1130.9 |
| VETUSDT 3d | 824 (0) | 2 | -6 | -0.29 | 16.2 | = 0.3872 | 9 / 2 | 270.6 |
| ONGUSDT 3d | 823 (0) | 2 | -512 | -25.61 | 18.7 | = 0.6643 | 28 / 7 | -421.3 |
| HOTUSDT 3d | 823 (0) | 2 | -320 | -16.00 | 11.5 | = 0.6048 | 23 / 1 | 1564.4 |
| ZILUSDT 3d | 823 (0) | 2 | -717 | -35.86 | 9.2 | = 0.9167 | 16 / 3 | -905.6 |
| FETUSDT 3d | 823 (0) | 3 | 3415 | 113.83 | 26.0 | = 0.2381 | 6 / 5 | 1808.8 |
| ZRXUSDT 3d | 823 (0) | 3 | -958 | -31.93 | 14.3 | = 0.9858 | 21 / 6 | -2119.9 |
| BATUSDT 3d | 824 (0) | 3 | -969 | -32.29 | 17.7 | = 0.9430 | 19 / 2 | -610.5 |
| ZECUSDT 3d | 823 (0) | 3 | 4022 | 134.08 | 37.7 | = 0.2000 | 9 / 1 | 5498.9 |
| IOSTUSDT 3d | 824 (0) | 2 | -755 | -37.75 | 9.0 | = 0.9312 | 19 / 8 | -988.0 |
| CELRUSDT 3d | 824 (0) | 2 | -492 | -24.58 | 15.6 | = 0.6628 | 14 / 2 | 211.3 |
| DASHUSDT 3d | 824 (0) | 3 | -378 | -12.60 | 15.5 | = 0.7221 | 13 / 1 | -574.0 |
| THETAUSDT 3d | 823 (0) | 2 | 187 | 9.37 | 14.0 | = 0.3477 | 10 / 4 | 1770.6 |
| ENJUSDT 3d | 824 (0) | 2 | -906 | -45.32 | 7.4 | = 0.9692 | 18 / 6 | 1729.9 |
| ATOMUSDT 3d | 823 (0) | 3 | -1145 | -38.15 | 21.6 | = 0.9905 | 5 / 2 | 2342.4 |
| TFUELUSDT 3d | 824 (0) | 2 | -559 | -27.94 | 12.2 | = 0.8504 | 24 / 2 | -148.6 |
| ONEUSDT 3d | 823 (0) | 2 | -736 | -36.82 | 8.4 | = 0.8596 | 5 / 4 | 2224.9 |
| ALGOUSDT 3d | 823 (0) | 2 | 39 | 1.95 | 9.6 | = 0.4191 | 18 / 4 | 710.1 |
| DUSKUSDT 3d | 823 (0) | 5 | -1094 | -21.88 | 33.5 | = 0.9667 | 24 / 5 | 25.3 |
| ANKRUSDT 3d | 824 (0) | 3 | -912 | -30.40 | 20.8 | = 0.9217 | 21 / 5 | 2639.8 |
| WINUSDT 3d | 824 (0) | 2 | -246 | -12.32 | 4.6 | = 0.9763 | 20 / 5 | 197.8 |
| MTLUSDT 3d | 823 (0) | 2 | -329 | -16.45 | 17.4 | = 0.6524 | 30 / 7 | 490.3 |
| CHZUSDT 3d | 824 (0) | 4 | -1368 | -34.20 | 18.1 | = 0.9739 | 19 / 4 | 1763.4 |
| BANDUSDT 3d | 824 (0) | 2 | -612 | -30.61 | 11.8 | = 0.8243 | 15 / 6 | -1906.1 |
| XTZUSDT 3d | 824 (0) | 2 | -544 | -27.22 | 8.8 | = 0.8243 | 16 / 3 | -121.9 |
| RVNUSDT 3d | 823 (0) | 2 | -291 | -14.53 | 9.0 | = 0.5762 | 26 / 3 | -214.4 |
| HBARUSDT 3d | 823 (0) | 3 | -252 | -8.41 | 26.0 | = 0.7000 | 18 / 4 | 1828.2 |
| KAVAUSDT 3d | 823 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 9 / 2 | -1925.9 |
| STXUSDT 3d | 823 (0) | 3 | 1297 | 43.24 | 19.3 | = 0.2596 | 21 / 2 | 877.2 |
| ARPAUSDT 3d | 823 (0) | 2 | -205 | -10.23 | 25.4 | = 0.4691 | 30 / 4 | -1221.3 |
| IOTXUSDT 3d | 824 (0) | 2 | -285 | -14.26 | 15.5 | = 0.4846 | 20 / 5 | -398.3 |
| RLCUSDT 3d | 824 (0) | 3 | 168 | 5.60 | 23.3 | = 0.6770 | 18 / 9 | -826.5 |
| BCHUSDT 3d | 823 (0) | 4 | 135 | 3.38 | 43.2 | = 0.6310 | 9 / 3 | 845.4 |

</details>

## 1w — 2020-2026

Fenêtre `2019-12-30T00:00:00.000Z` → `2026-10-05T00:00:00.000Z` exclu ; 40 cellule(s) disponible(s) sur 42 ; indisponibles : CVCUSDT 1w (22 bougies manquantes (écartées comprises) sur 353 attendues) ; FTTUSDT 1w (44 bougies manquantes (écartées comprises) sur 353 attendues).

**Signaux : NON CONCLUANT** — **Forts achats : DÉFAVORABLE**

| Famille | Critère | Bloc | Statut | Détail |
|---|---|---|---|---|
| Signaux | — | trades | ⚠️ insuffisant | 2 trades clos par règle regroupés (minimum 100) |
| Forts achats | F1 | regroupé | ⚠️ insuffisant | 275 forts achats, 590.1 bps en moyenne à 12 bougies (43.6 % de hausses), p unilatérale = 0.0858 (seuil 0.0038 ; 209 décalages, tous, plancher 0.0047) ; médiane nulle -556.4 bps |
| Forts achats | F2 | cellules | ❌ échec | moyenne > 0 dans 16 cellule(s) sur 40 ayant au moins un fort achat |
| Forts achats | F3 | économie | ✅ tenu | moyenne regroupée 590.1 bps contre un coût aller-retour de 14 bps |

### Signaux — regroupé

| Exécution | Trades (clos) | Exp. nette USDT | Exp. nette % | PnL total USDT | Gagnants % |
|---|---|---|---|---|---|
| AXIS x1-central | 4 (2) | 262.512 | 26.251 | 1050 | 50.0 |
| AXIS x2 | 4 (2) | 260.875 | 26.088 | 1044 | 50.0 |
| AXIS x3 | 4 (2) | 259.239 | 25.924 | 1037 | 50.0 |
| EMA 200 x1-central | 12 (9) | 1590.847 | 159.085 | 19090 | 16.7 |
| EMA 200 x3 | 12 (9) | 1585.184 | 158.518 | 19022 | 16.7 |

| Statistique | Valeur |
|---|---|
| Rejeu hors frais : fenêtre / M1 / M2 (trades, exp. %) | 2, -15.774 / 2, -15.774 / 0, — |
| Timing : capté / médiane nulle / 95e centile (% log) | 5.8 / 306.5 / 498.5 |
| Timing : p unilatérale (plus courte fenêtre) | = 1.0000 (53 décisions, 43 décalages, tous) |
| Timing de l'EMA 200 seule (mêmes décalages) | p = 1.0000, capté 67.8 % |
| Cellules à PnL net x1 > 0 / ayant un trade | 1 / 2 |
| Cellules où l'EMA 200 seule fait au moins aussi bien (PnL x1) | 35 / 40 |
| Exposition moyenne / achat-conservation médian | 3.6 % / -51.3 % |

### Forts achats — regroupé (cellule = N / moyenne bps / % de continuation / t naïf)

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 275 / 291.2 / 52 / 2.0 | 275 / 363.3 / 46 / 1.7 | 275 / 735.3 / 50 / 2.7 | 275 / 1039.9 / 50 / 2.9 | 275 / 590.1 / 44 / 1.1 | 275 / -1548.8 / 34 / -3.3 | 275 / -1216.7 / 39 / -2.0 |
| Fortes ventes | 58 / -232.7 / 60 / -0.6 | 58 / -45.6 / 50 / -0.1 | 58 / 51.6 / 57 / 0.1 | 58 / 1090.5 / 62 / 1.7 | 58 / 848.1 / 66 / 0.8 | 58 / 2339.5 / 71 / 2.1 | 58 / 3739.4 / 72 / 2.7 |

| Statistique (horizon 12) | Valeur |
|---|---|
| Forts achats : p unilatérale / bilatérale | = 0.0858 / = 0.5762 (261 décisions, 209 décalages, tous) |
| Forts achats : médiane / médiane nulle / 95e centile nul (bps) | -1488 / -556 / 1008 |
| Forts achats nets de 0.14 % aller-retour (bps) | 576 |
| Fortes ventes : p bilatérale | = 0.4667 |
| Cellules à moyenne > 0 / ayant un fort achat | 16 / 40 |
| Permutation des sens : tous / achats / médiane nulle (bps), p | 340 / 590 / 471, = 0.2548 |
| Au-dessus / sous l'EMA 200 | 33 / -2552.1 / 27 / -2.8 ; 101 / -2058.3 / 33 / -5.1 |
| Par année (achats / ventes ; moyenne achats bps) | 2020 : 8 / 2 ; 21824 · 2021 : 72 / 7 ; 5142 · 2022 : 21 / 13 ; -3101 · 2023 : 57 / 13 ; 244 · 2024 : 84 / 4 ; -2709 · 2025 : 33 / 19 ; -3145 |

<details><summary>Détail par cellule (40)</summary>

| Cellule | Bougies (manquantes) | Trades x1 | PnL x1 USDT | Exp. nette x1 % | Exposition % | p timing | Forts achats / ventes | Moy. achats 12 (bps) |
|---|---|---|---|---|---|---|---|---|
| NEOUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 7 / 1 | 299.1 |
| LTCUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 4 / 0 | 1371.0 |
| QTUMUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 7 / 2 | -480.9 |
| IOTAUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 7 / 1 | 1453.0 |
| XLMUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 6 / 1 | -800.2 |
| ONTUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 6 / 3 | -736.0 |
| TRXUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 1 / 0 | -2654.2 |
| ETCUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 11 / 0 | -2649.6 |
| VETUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 3 / 0 | -3184.7 |
| ONGUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 6 / 5 | -994.9 |
| HOTUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 15 / 1 | 6769.4 |
| ZILUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 7 / 1 | -4248.2 |
| FETUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 3 / 1 | 3928.8 |
| ZRXUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 12 / 2 | -714.0 |
| BATUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 12 / 0 | -1988.0 |
| ZECUSDT 1w | 353 (0) | 2 | 1830 | 91.52 | 69.8 | = 0.6591 | 7 / 2 | -320.7 |
| IOSTUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 10 / 2 | -3679.4 |
| CELRUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 7 / 1 | -1684.8 |
| DASHUSDT 1w | 353 (0) | 2 | -780 | -39.02 | 75.5 | = 1.0000 | 3 / 2 | -2470.3 |
| THETAUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 2 / 0 | -2496.3 |
| ENJUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 7 / 1 | 9198.1 |
| ATOMUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 4 / 0 | 747.6 |
| TFUELUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 5 / 2 | 4507.8 |
| ONEUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 4 / 0 | -1305.5 |
| ALGOUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 4 / 2 | -1156.3 |
| DUSKUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 10 / 1 | 3531.9 |
| ANKRUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 6 / 0 | -6100.7 |
| WINUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 11 / 4 | -414.5 |
| MTLUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 8 / 5 | 2808.8 |
| CHZUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 12 / 1 | 9006.3 |
| BANDUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 3 / 3 | -3376.3 |
| XTZUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 5 / 1 | -5309.5 |
| RVNUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 9 / 3 | 1306.4 |
| HBARUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 9 / 0 | 6257.0 |
| KAVAUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 3 / 1 | 1458.2 |
| STXUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 8 / 1 | 674.9 |
| ARPAUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 13 / 2 | 78.7 |
| IOTXUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 10 / 2 | -600.4 |
| RLCUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 6 / 1 | -3574.1 |
| BCHUSDT 1w | 353 (0) | 0 | 0 | — | 0.0 | = 1.0000 | 2 / 3 | -1508.4 |

</details>

## Formulations pré-déclarées des infobulles, par unité

| Unité | Signaux ▲/▼ | Fort achat | Forte vente | Qualification |
|---|---|---|---|---|
| 1s | en 1s : test échoué sur données jamais vues (42 alts, 12 h, 7 octobre 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 0/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -0.17 % par trade (coûts x1), timing p = 1.0000 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1s sur données jamais vues (42 alts, 12 h, 7 octobre 2026) — forts achats suivis de 0.00 % en moyenne (26 % de hausses, p bilatérale = 0.9612), sans dépasser le coût aller-retour de 0.14 % — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1s sur données jamais vues (42 alts, 12 h, 7 octobre 2026) — forts achats suivis de 0.00 % en moyenne (26 % de hausses, p bilatérale = 0.9612), sans dépasser le coût aller-retour de 0.14 % — pas un signal validé | qualification descriptive, non mesurée en 1s |
| 1m | en 1m : test échoué sur données jamais vues (42 alts, 30 jours, sept.-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 1/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -0.17 % par trade (coûts x1), timing p = 1.0000 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1m sur données jamais vues (42 alts, 30 jours, sept.-oct. 2026) — forts achats suivis de +0.01 % en moyenne (44 % de hausses, p bilatérale = 0.2386), sans dépasser le coût aller-retour de 0.14 % — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1m sur données jamais vues (42 alts, 30 jours, sept.-oct. 2026) — forts achats suivis de +0.01 % en moyenne (44 % de hausses, p bilatérale = 0.2386), sans dépasser le coût aller-retour de 0.14 % — pas un signal validé | qualification descriptive, non mesurée en 1m |
| 3m | en 3m : test échoué sur données jamais vues (42 alts, 90 jours, juil.-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 2/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -0.18 % par trade (coûts x1), timing p = 1.0000 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 3m sur données jamais vues (42 alts, 90 jours, juil.-oct. 2026) — forts achats suivis de 0.00 % en moyenne (43 % de hausses, p bilatérale = 0.9124), sans dépasser le coût aller-retour de 0.14 % — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 3m sur données jamais vues (42 alts, 90 jours, juil.-oct. 2026) — forts achats suivis de 0.00 % en moyenne (43 % de hausses, p bilatérale = 0.9124), sans dépasser le coût aller-retour de 0.14 % — pas un signal validé | qualification descriptive, non mesurée en 3m |
| 5m | en 5m : test échoué sur données jamais vues (42 alts, 150 jours, mai-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 4/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -0.23 % par trade (coûts x1), timing p = 1.0000 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 5m sur données jamais vues (42 alts, 150 jours, mai-oct. 2026) — forts achats suivis de -0.02 % en moyenne (43 % de hausses, p bilatérale = 0.0204), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 15/42 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 5m sur données jamais vues (42 alts, 150 jours, mai-oct. 2026) — forts achats suivis de -0.02 % en moyenne (43 % de hausses, p bilatérale = 0.0204), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 15/42 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 5m |
| 15m | en 15m : test échoué sur données jamais vues (42 alts, oct. 2025-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 5/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -0.28 % par trade (coûts x1), timing p = 0.9948 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 15m sur données jamais vues (42 alts, oct. 2025-oct. 2026) — forts achats suivis de -0.10 % en moyenne (44 % de hausses, p bilatérale ≤ 0.0002), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 7/42 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 15m sur données jamais vues (42 alts, oct. 2025-oct. 2026) — forts achats suivis de -0.10 % en moyenne (44 % de hausses, p bilatérale ≤ 0.0002), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 7/42 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 15m |
| 30m | en 30m : test échoué sur données jamais vues (42 alts, oct. 2024-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 10/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -0.18 % par trade (coûts x1), timing p = 0.6856 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 30m sur données jamais vues (42 alts, oct. 2024-oct. 2026) — forts achats suivis de -0.14 % en moyenne (45 % de hausses, p bilatérale = 0.0004), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 15/42 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 30m sur données jamais vues (42 alts, oct. 2024-oct. 2026) — forts achats suivis de -0.14 % en moyenne (45 % de hausses, p bilatérale = 0.0004), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 15/42 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 30m |
| 1h | en 1h : test échoué sur données jamais vues (42 alts, oct. 2023-oct. 2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 21/42 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette +0.06 % par trade (coûts x1), timing p = 0.4804 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1h sur données jamais vues (42 alts, oct. 2023-oct. 2026) — forts achats suivis de -0.19 % en moyenne (45 % de hausses, p bilatérale = 0.0012), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 17/42 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1h sur données jamais vues (42 alts, oct. 2023-oct. 2026) — forts achats suivis de -0.19 % en moyenne (45 % de hausses, p bilatérale = 0.0012), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 17/42 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 1h |
| 2h | en 2h : test échoué sur données jamais vues (40 alts, 2020-2026) — timing non significatif ; expectancy nette +1.64 % par trade (coûts x1), timing p = 0.1048 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 2h sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de -0.24 % en moyenne (45 % de hausses, p bilatérale = 0.0044), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 14/40 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 2h sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de -0.24 % en moyenne (45 % de hausses, p bilatérale = 0.0044), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 14/40 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 2h |
| 6h | en 6h : test échoué sur données jamais vues (40 alts, 2020-2026) — timing non significatif ; expectancy nette +7.38 % par trade (coûts x1), timing p = 0.0742 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 6h sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de -0.68 % en moyenne (44 % de hausses, p bilatérale = 0.0072), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 14/40 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 6h sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de -0.68 % en moyenne (44 % de hausses, p bilatérale = 0.0072), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 14/40 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 6h |
| 12h | en 12h : test échoué sur données jamais vues (40 alts, 2020-2026) — timing non significatif ; expectancy nette +20.24 % par trade (coûts x1), timing p = 0.0552 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 12h sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de -0.84 % en moyenne (44 % de hausses, p bilatérale = 0.0758), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 15/40 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 12h sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de -0.84 % en moyenne (44 % de hausses, p bilatérale = 0.0758), sans dépasser le coût aller-retour de 0.14 %, suite positive sur 15/40 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 12h |
| 1d | en 1d : test échoué sur données jamais vues (40 alts, 2020-2026) — timing non significatif ; expectancy nette +35.76 % par trade (coûts x1), timing p = 0.1208 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1d sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de +0.46 % en moyenne (44 % de hausses, p bilatérale = 0.6006), suite positive sur 20/40 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1d sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de +0.46 % en moyenne (44 % de hausses, p bilatérale = 0.6006), suite positive sur 20/40 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 1d |
| 3d | en 3d : test échoué sur données jamais vues (40 alts, 2020-2026) — expectancy nette ≤ 0 aux coûts x1 ou x3, timing non significatif, PnL positif sur 9/39 actifs seulement, expectancy négative sur une moitié de la période ; expectancy nette -7.50 % par trade (coûts x1), timing p = 0.8381 — lecture indicative, pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 3d sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de +1.24 % en moyenne (44 % de hausses, p bilatérale = 0.6792) — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 3d sur données jamais vues (40 alts, 2020-2026) — forts achats suivis de +1.24 % en moyenne (44 % de hausses, p bilatérale = 0.6792) — pas un signal validé | qualification descriptive, non mesurée en 3d |
| 1w | en 1w : non mesuré (trop peu de signaux sur données jamais vues : 2 trades clos) — lecture indicative, jamais une promesse | fort achat / forte vente : test échoué à 12 bougies en 1w sur données jamais vues (40 alts, 2020-2026) — suite positive sur 16/40 actifs seulement — pas un signal validé | fort achat / forte vente : test échoué à 12 bougies en 1w sur données jamais vues (40 alts, 2020-2026) — suite positive sur 16/40 actifs seulement — pas un signal validé | qualification descriptive, non mesurée en 1w |
| 1M | en 1M : non mesuré (historique trop court pour l'EMA 200 et l'amorce) — lecture indicative, jamais une promesse | couche flux non mesurée en 1M (historique trop court) | couche flux non mesurée en 1M (historique trop court) | qualification descriptive, non mesurée en 1M |
| 3M | en 3M : non mesuré (historique trop court pour l'EMA 200 et l'amorce) — lecture indicative, jamais une promesse | couche flux non mesurée en 3M (historique trop court) | couche flux non mesurée en 3M (historique trop court) | qualification descriptive, non mesurée en 3M |
| 6M | en 6M : non mesuré (historique trop court pour l'EMA 200 et l'amorce) — lecture indicative, jamais une promesse | couche flux non mesurée en 6M (historique trop court) | couche flux non mesurée en 6M (historique trop court) | qualification descriptive, non mesurée en 6M |
| 12M | en 12M : non mesuré (historique trop court pour l'EMA 200 et l'amorce) — lecture indicative, jamais une promesse | couche flux non mesurée en 12M (historique trop court) | couche flux non mesurée en 12M (historique trop court) | qualification descriptive, non mesurée en 12M |

Garde inchangée : les formulations des forts mouvements ne s'affichent que sur une bougie dont le delta taker est disponible ; sinon « couche flux non mesurée ». 4h et unité absente : formulations des tests précédents.

## Limites

- 42 alts crypto spot Binance, un même facteur de marché ; ni BTC/ETH (déjà vus), ni autres marchés (forex, actions, sources sans volume taker).
- Petites unités : fenêtres récentes et courtes (12 h en 1s, 30 jours en 1m…), un seul régime de marché ; un résultat y décrit cette période, pas l'unité en général. Grandes unités : 2020-2026, phases connues de tous.
- Sur les paires peu liquides, beaucoup de bougies 1s et 1m ont un volume nul (émises sans transaction) : les lectures de volume et de flux y sont celles que le chart affiche, mais leur sens économique est faible.
- Le décalage circulaire préserve l'exposition et le regroupement des événements, pas la volatilité locale de chaque bougie, et suppose une série à peu près stationnaire ; le décalage commun ne préserve qu'en partie la corrélation entre actifs. Le t naïf suppose des événements indépendants.
- Correction de Bonferroni (p ≤ 0.0038) : prudente ; un effet réel faible peut échouer, et un échec ne prouve pas l'absence d'effet. Les critères d'étendue (S3, F2) et de stabilité (S4) sont des seuils simples, sans test propre.
- Les signaux comparés à l'EMA 200 seule : S2 (timing) ne distingue pas AXIS d'un filtre de tendance ; seule la comparaison descriptive renseigne l'apport propre de la confluence.
- Taille fixe, aucun stop ; le slippage est un scénario, pas une mesure du carnet ; les frais réels des petites unités (spread des paires peu liquides) peuvent dépasser les niveaux x3.
- Prix constants (paires peu liquides, petites unités) : le RSI vaut 100 sans baisse enregistrée et les votes EMA et MACD se jouent sur des écarts infimes ; mesuré tel que le chart le calcule. Pas de cotation : sur les paires à bas prix, un pas vaut 0,1 à 0,2 % du prix ; ce rebond joue contre les forts achats et les signaux, et une « forte vente » suivie d'un rebond peut en partie en venir.
- En 1s, le volume moyen inclut la bougie courante : une seule transaction parmi 19 secondes vides donne un volume ×20 ; « fort achat » y signifie surtout « seconde dominée par des achats taker ».
- Moyennes de rendements log (prudentes : la moyenne arithmétique serait plus forte aux grandes unités). Le chart calcule sur environ 500 bougies : l'amorce de l'EMA 200 y diffère de la série longue mesurée, comme en 4h.
