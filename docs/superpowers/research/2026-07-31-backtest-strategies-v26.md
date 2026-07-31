# Campagne de validation des stratégies — AXIOM v2.3

Généré par `scripts/valider-strategies.ts` le 2026-07-31. **Toutes les valeurs ci-dessous sont des mesures PASSÉES, in-sample pour la sélection du champion — jamais une promesse de performance.**

## Méthodologie

- **Données** : klines Binance spot (`/api/v3/klines`), bougies CLÔTURÉES uniquement.
- **Fenêtre FIGÉE** : `[2024-07-01T00:00:00Z → 2026-07-28T12:00:00Z[` (borne haute EXCLUE, constantes `DEBUT_MS` / `FIN_MS` du script ; le cache disque est re-borné à la lecture). La borne haute valait `Date.now()` avant ce figeage : chaque cellule s'arrêtait à SON heure de téléchargement. **Le rapport commité `docs/superpowers/research/2026-07-28-backtest-strategies.md` a été produit AVANT le figeage** — d'où ses 18180 bougies en BTCUSDT 1h contre 18181 en ETHUSDT 1h (~36 min de dérive entre deux cellules, soit moins d'une bougie 1h, sans effet sur le verdict).
- **Rejeu chart-fidèle** : la fonction `position` de chaque def `strategy` est rejouée, les trades reconstruits close-à-close par `construireTradesStrategie` (mêmes conventions que les marqueurs du chart : anti-repaint, HORS frais).
- **Moitiés temporelles** : coupe au milieu du tableau de bougies, trade rangé selon son index d'ENTRÉE (anti-overfit — une stratégie qui ne gagne que sur une moitié est disqualifiée).
- **Contre-épreuve** : `runBacktest` (fill à l'OPEN de la barre suivante, frais 0.05 % par côté, slippage 0.02 %, capital 10000, taille fixe 1000) sur les stratégies exprimables dans le modèle déclaratif. L'écart avec le rejeu EST la mesure du coût d'exécution.
- **Signes** : `DD max` du rejeu est NÉGATIF (retracement de l'equity composée) ; celui de la contre-épreuve est POSITIF (convention `StatsBacktest`).
- **`Win %` : deux définitions, une par section** — le rejeu compte gagnant tout trade à `pnlPct >= 0` (`statsRejeu.ts` : un trade NUL est rangé en gagnant), la contre-épreuve exige `pnl > 0` (`engine.ts`). Les deux colonnes ne sont donc pas strictement comparables entre sections 1/3 et section 2.
- **Comparabilité des expectancies** : celle du rejeu est une variation de PRIX en % ; celle de la contre-épreuve est le PnL net rapporté au notionnel engagé. À taille fixe et sans levier (quantité = taille / prix d'entrée), les deux dénominateurs coïncident : leur écart isole donc bien frais + slippage + décalage de fill.
- **Aucun réglage par cellule** : un seul jeu de défauts partout, pas de grid-search.

## Données

| Cellule | Bougies | Début | Fin |
|---|---|---|---|
| BTCUSDT 1h | 18180 | 2024-07-01 | 2026-07-28 |
| BTCUSDT 4h | 4545 | 2024-07-01 | 2026-07-28 |
| ETHUSDT 1h | 18180 | 2024-07-01 | 2026-07-28 |
| ETHUSDT 4h | 4545 | 2024-07-01 | 2026-07-28 |

## 1. Rejeu chart-fidèle des stratégies du registre (hors frais)

### BTCUSDT 1h

| Stratégie | Trades | Win % | Expectancy % | PnL composé % | DD max % | Durée moy. | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 792 | 29.55 | 0.050 | 23.08 | -41.98 | 22.9 | 0.171 | -0.066 |
| stratRsiReversion | 68 | 60.29 | -0.119 | -17.84 | -40.07 | 131.4 | 0.599 | -0.796 |
| stratMacdCross | 1389 | 33.98 | -0.000 | -18.79 | -47.28 | 13.0 | 0.005 | -0.005 |
| stratSupertrend | 434 | 37.33 | -0.017 | -24.58 | -62.70 | 41.8 | 0.080 | -0.107 |
| stratDonchian | 402 | 34.08 | -0.015 | -22.68 | -50.40 | 45.1 | -0.028 | -0.001 |
| stratBollingerReversion | 667 | 67.17 | 0.012 | -1.07 | -32.99 | 12.6 | -0.013 | 0.037 |
| stratDivergenceRsi | 86 | 63.95 | -0.047 | -17.34 | -38.73 | 107.2 | -0.024 | -0.067 |
| stratSqueezeBreakout | 326 | 34.36 | 0.056 | 14.48 | -26.25 | 14.3 | 0.078 | 0.034 |
| stratIchimokuKumo | 886 | 21.78 | 0.030 | 8.64 | -48.21 | 17.5 | 0.078 | -0.016 |
| stratMmAdx | 519 | 31.02 | -0.025 | -21.65 | -30.12 | 17.6 | 0.005 | -0.054 |
| stratPsar | 1450 | 38.28 | -0.022 | -40.61 | -48.89 | 12.5 | -0.028 | -0.016 |
| stratChampion | 546 | 35.16 | -0.087 | -45.04 | -53.22 | 23.4 | -0.046 | -0.127 |
| stratSupertrendAdx | 468 | 33.55 | -0.043 | -27.07 | -43.40 | 19.5 | -0.020 | -0.063 |
| stratMmRsi | 1421 | 24.42 | 0.012 | 0.05 | -30.39 | 11.3 | 0.034 | -0.010 |
| stratSqueezeKumo | 204 | 36.27 | 0.076 | 12.87 | -18.67 | 14.4 | 0.159 | -0.017 |
| stratMacdSupertrend | 912 | 35.64 | -0.004 | -14.94 | -46.58 | 11.0 | 0.023 | -0.031 |
| stratPsarAdx | 1044 | 41.00 | -0.058 | -51.19 | -56.80 | 8.7 | -0.051 | -0.064 |
| stratTripleConfirmation | 1035 | 32.27 | -0.002 | -12.94 | -42.06 | 9.2 | 0.005 | -0.010 |
| stratRsiRange | 15 | 40.00 | -0.294 | -4.41 | -5.34 | 4.1 | -0.279 | -0.324 |

### BTCUSDT 4h

| Stratégie | Trades | Win % | Expectancy % | PnL composé % | DD max % | Durée moy. | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 203 | 29.56 | 0.016 | -13.15 | -38.40 | 22.1 | 0.279 | -0.216 |
| stratRsiReversion | 20 | 70.00 | 0.582 | 5.68 | -36.04 | 111.5 | 3.501 | -2.985 |
| stratMacdCross | 336 | 35.42 | 0.117 | 22.92 | -43.01 | 13.3 | 0.170 | 0.066 |
| stratSupertrend | 110 | 43.64 | 0.240 | 11.12 | -40.95 | 41.0 | 0.520 | -0.050 |
| stratDonchian | 95 | 35.79 | 0.170 | -0.24 | -43.70 | 47.0 | -0.004 | 0.390 |
| stratBollingerReversion | 163 | 63.19 | -0.028 | -13.17 | -36.31 | 13.0 | -0.179 | 0.122 |
| stratDivergenceRsi | 18 | 83.33 | 0.383 | -8.54 | -46.02 | 83.0 | -2.755 | 3.521 |
| stratSqueezeBreakout | 70 | 28.57 | -0.232 | -18.60 | -38.10 | 12.5 | 0.152 | -0.662 |
| stratIchimokuKumo | 238 | 22.27 | -0.065 | -25.48 | -41.14 | 15.8 | -0.126 | -0.019 |
| stratMmAdx | 127 | 37.80 | -0.038 | -13.27 | -35.17 | 17.8 | 0.082 | -0.152 |
| stratPsar | 379 | 38.79 | 0.062 | 3.94 | -57.91 | 12.0 | 0.258 | -0.122 |
| stratChampion | 127 | 37.80 | 0.174 | 6.89 | -43.35 | 25.1 | 0.604 | -0.236 |
| stratSupertrendAdx | 115 | 40.00 | 0.079 | -0.43 | -33.48 | 19.6 | -0.006 | 0.180 |
| stratMmRsi | 337 | 26.41 | 0.044 | -1.88 | -41.34 | 11.7 | 0.230 | -0.116 |
| stratSqueezeKumo | 46 | 32.61 | -0.132 | -9.31 | -29.49 | 13.3 | 0.195 | -0.489 |
| stratMacdSupertrend | 223 | 39.01 | 0.130 | 17.79 | -30.53 | 11.8 | 0.227 | 0.034 |
| stratPsarAdx | 278 | 42.81 | 0.060 | 5.26 | -42.59 | 8.2 | 0.181 | -0.064 |
| stratTripleConfirmation | 254 | 33.86 | 0.150 | 30.05 | -29.09 | 9.6 | 0.293 | 0.018 |
| stratRsiRange | 7 | 57.14 | 0.196 | 1.30 | -2.52 | 3.4 | 0.649 | -2.523 |

### ETHUSDT 1h

| Stratégie | Trades | Win % | Expectancy % | PnL composé % | DD max % | Durée moy. | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 835 | 27.31 | 0.053 | -3.26 | -56.69 | 21.6 | 0.046 | 0.060 |
| stratRsiReversion | 70 | 57.14 | -1.088 | -61.86 | -67.78 | 126.8 | -0.901 | -1.265 |
| stratMacdCross | 1352 | 35.58 | 0.031 | -3.37 | -52.25 | 13.4 | 0.101 | -0.040 |
| stratSupertrend | 444 | 32.21 | -0.098 | -59.07 | -74.03 | 40.8 | -0.266 | 0.082 |
| stratDonchian | 390 | 36.41 | 0.192 | 32.72 | -70.99 | 46.5 | -0.194 | 0.672 |
| stratBollingerReversion | 690 | 70.00 | 0.023 | -8.14 | -46.34 | 12.2 | 0.046 | 0.001 |
| stratDivergenceRsi | 76 | 69.74 | -1.070 | -68.89 | -71.75 | 114.8 | -1.014 | -1.122 |
| stratSqueezeBreakout | 339 | 33.63 | 0.059 | 10.25 | -41.74 | 13.2 | -0.000 | 0.122 |
| stratIchimokuKumo | 958 | 23.80 | 0.078 | 39.55 | -62.32 | 15.8 | 0.002 | 0.169 |
| stratMmAdx | 512 | 35.55 | 0.152 | 61.29 | -51.61 | 17.7 | 0.153 | 0.150 |
| stratPsar | 1410 | 38.51 | 0.094 | 133.05 | -48.52 | 12.9 | 0.157 | 0.030 |
| stratChampion | 510 | 37.65 | 0.188 | 83.32 | -39.02 | 24.5 | 0.083 | 0.307 |
| stratSupertrendAdx | 463 | 33.26 | 0.063 | 0.33 | -48.54 | 19.6 | 0.021 | 0.107 |
| stratMmRsi | 1464 | 23.98 | 0.040 | 14.88 | -53.19 | 10.9 | 0.028 | 0.053 |
| stratSqueezeKumo | 227 | 33.48 | 0.065 | 7.43 | -29.59 | 13.2 | -0.041 | 0.202 |
| stratMacdSupertrend | 898 | 34.52 | -0.000 | -24.53 | -41.23 | 11.0 | 0.006 | -0.006 |
| stratPsarAdx | 972 | 42.28 | 0.155 | 240.32 | -37.51 | 9.3 | 0.257 | 0.060 |
| stratTripleConfirmation | 1032 | 30.52 | 0.016 | -8.68 | -37.05 | 9.0 | 0.028 | 0.005 |
| stratRsiRange | 17 | 52.94 | 0.102 | 1.72 | -1.42 | 4.0 | -0.139 | 0.271 |

### ETHUSDT 4h

| Stratégie | Trades | Win % | Expectancy % | PnL composé % | DD max % | Durée moy. | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 234 | 25.64 | -0.334 | -69.00 | -77.13 | 19.2 | -0.107 | -0.576 |
| stratRsiReversion | 18 | 61.11 | -2.687 | -52.62 | -58.95 | 127.7 | -3.000 | -2.374 |
| stratMacdCross | 328 | 37.50 | 0.499 | 221.51 | -57.63 | 13.6 | 0.737 | 0.252 |
| stratSupertrend | 106 | 37.74 | 0.828 | 59.71 | -40.07 | 42.7 | 1.223 | 0.447 |
| stratDonchian | 101 | 34.65 | -0.475 | -57.23 | -71.59 | 43.8 | -0.987 | 0.216 |
| stratBollingerReversion | 174 | 71.84 | -0.032 | -27.32 | -56.05 | 12.5 | 0.272 | -0.373 |
| stratDivergenceRsi | 18 | 61.11 | -3.361 | -56.62 | -66.16 | 111.6 | -8.596 | 0.828 |
| stratSqueezeBreakout | 76 | 30.26 | 0.616 | 38.85 | -34.26 | 13.6 | 1.431 | -0.391 |
| stratIchimokuKumo | 223 | 21.08 | 0.127 | -9.96 | -49.70 | 16.7 | 0.168 | 0.081 |
| stratMmAdx | 127 | 37.01 | -0.055 | -25.55 | -43.05 | 17.9 | 0.474 | -0.472 |
| stratPsar | 357 | 38.10 | 0.032 | -30.89 | -70.07 | 12.6 | -0.007 | 0.069 |
| stratChampion | 128 | 34.38 | 0.477 | 28.66 | -50.83 | 24.0 | 0.744 | 0.193 |
| stratSupertrendAdx | 106 | 40.57 | 0.677 | 63.60 | -31.82 | 21.4 | 1.134 | 0.283 |
| stratMmRsi | 356 | 25.84 | -0.077 | -48.84 | -64.49 | 11.1 | 0.066 | -0.226 |
| stratSqueezeKumo | 57 | 29.82 | 0.604 | 24.34 | -31.59 | 13.8 | 1.596 | -0.578 |
| stratMacdSupertrend | 217 | 35.94 | 0.537 | 133.10 | -43.56 | 11.8 | 0.698 | 0.375 |
| stratPsarAdx | 243 | 40.33 | 0.142 | 7.37 | -51.28 | 9.4 | 0.001 | 0.263 |
| stratTripleConfirmation | 251 | 33.07 | 0.403 | 106.28 | -42.13 | 9.7 | 0.512 | 0.295 |
| stratRsiRange | 8 | 25.00 | -0.958 | -7.47 | -7.84 | 1.4 | -1.235 | -0.125 |

## 2. Contre-épreuve moteur de backtest (frais + slippage + fill à l'open)

### BTCUSDT 1h

| Stratégie | Trades | Win % | PnL total % | DD max % | Profit factor | Expectancy BT % | Expectancy rejeu % | Écart |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 749 | 27.10 | -7.34 | 11.63 | 0.87 | -0.098 | 0.050 | -0.148 |
| stratRsiReversion | 69 | 57.97 | -1.77 | 4.66 | 0.86 | -0.257 | -0.119 | -0.138 |
| stratMacdCross | 1289 | 30.64 | -17.70 | 19.49 | 0.80 | -0.137 | -0.000 | -0.137 |
| stratSupertrend | 435 | 34.02 | -7.51 | 12.84 | 0.85 | -0.173 | -0.017 | -0.156 |
| stratBollingerReversion | 347 | 67.15 | -2.44 | 4.89 | 0.87 | -0.070 | 0.012 | -0.082 |
| stratMmAdx | 332 | 33.13 | -11.60 | 12.44 | 0.74 | -0.349 | -0.025 | -0.324 |

### BTCUSDT 4h

| Stratégie | Trades | Win % | PnL total % | DD max % | Profit factor | Expectancy BT % | Expectancy rejeu % | Écart |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 196 | 29.59 | -2.23 | 6.27 | 0.92 | -0.114 | 0.016 | -0.130 |
| stratRsiReversion | 20 | 70.00 | 0.88 | 3.92 | 1.16 | 0.442 | 0.582 | -0.141 |
| stratMacdCross | 318 | 33.96 | 2.18 | 5.28 | 1.06 | 0.069 | 0.117 | -0.049 |
| stratSupertrend | 112 | 41.07 | -0.52 | 6.05 | 0.98 | -0.047 | 0.240 | -0.287 |
| stratBollingerReversion | 77 | 63.64 | 0.48 | 1.73 | 1.05 | 0.063 | -0.028 | 0.091 |
| stratMmAdx | 87 | 36.78 | -0.32 | 6.59 | 0.98 | -0.037 | -0.038 | 0.001 |

### ETHUSDT 1h

| Stratégie | Trades | Win % | PnL total % | DD max % | Profit factor | Expectancy BT % | Expectancy rejeu % | Écart |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 780 | 27.31 | -2.31 | 9.14 | 0.97 | -0.030 | 0.053 | -0.082 |
| stratRsiReversion | 71 | 56.34 | -8.63 | 10.40 | 0.63 | -1.215 | -1.088 | -0.127 |
| stratMacdCross | 1270 | 33.15 | -16.45 | 17.75 | 0.86 | -0.130 | 0.031 | -0.161 |
| stratSupertrend | 446 | 31.17 | -10.43 | 14.10 | 0.86 | -0.234 | -0.098 | -0.135 |
| stratBollingerReversion | 347 | 66.28 | -5.45 | 6.40 | 0.82 | -0.157 | 0.023 | -0.180 |
| stratMmAdx | 329 | 34.35 | -3.11 | 13.57 | 0.95 | -0.094 | 0.152 | -0.246 |

### ETHUSDT 4h

| Stratégie | Trades | Win % | PnL total % | DD max % | Profit factor | Expectancy BT % | Expectancy rejeu % | Écart |
|---|---|---|---|---|---|---|---|---|
| stratCroisementMM | 219 | 23.74 | -9.89 | 12.68 | 0.80 | -0.451 | -0.334 | -0.118 |
| stratRsiReversion | 18 | 61.11 | -5.08 | 6.49 | 0.63 | -2.824 | -2.687 | -0.137 |
| stratMacdCross | 310 | 36.45 | 7.80 | 7.85 | 1.15 | 0.252 | 0.499 | -0.247 |
| stratSupertrend | 108 | 37.96 | 5.37 | 4.29 | 1.18 | 0.497 | 0.828 | -0.330 |
| stratBollingerReversion | 79 | 63.29 | -6.47 | 7.37 | 0.62 | -0.819 | -0.032 | -0.787 |
| stratMmAdx | 92 | 31.52 | -4.01 | 7.93 | 0.88 | -0.436 | -0.055 | -0.381 |

**Fidélité des équivalents déclaratifs** (ce que le modèle ne reproduit pas) :

- `stratCroisementMM` — fidèle : conditions de NIVEAU (signe de EMA 9 − EMA 21), qui reproduisent l'ÉTAT continu du def
- `stratRsiReversion` — quasi fidèle : le croisement du moteur est `≤ puis >` là où le def teste `< puis ≥`
- `stratMacdCross` — fidèle : conditions de NIVEAU (MACD 12/26/9 vs sa ligne de signal), qui reproduisent l'ÉTAT continu du def
- `stratSupertrend` — fidèle : déjà en NIVEAU (direction du Supertrend 10 ×3) — longs et shorts ressortent à parité, comme attendu d'un système à retournement
- `stratBollingerReversion` — APPROXIMATION : jambe LONG seule — la jambe short et la sortie « retour à la moyenne » ne cohabitent pas dans un système à retournement
- `stratMmAdx` — APPROXIMATION : l'ADX ≥ 25 est exigé des DEUX côtés (comme le def, qui gate l'état entier) — mais parce que les règles sont conjonctives, il gate aussi la CLÔTURE : une position est TENUE tant que le signal opposé ne coïncide pas avec ADX ≥ 25, là où le def la couperait à plat dès ADX < 25. Le flat FORCÉ est donc l'écart résiduel, et il va dans le sens d'une SURESTIMATION de la durée des positions

## 3. Candidats champion (hors frais)

| Candidat | Règle (params figés) |
|---|---|
| `candSupertrendAdx` | Supertrend(10, ×3) suivi seulement si ADX(14) ≥ 25, sinon flat |
| `candMmRsi` | EMA 9/21 confirmé par RSI(14) du même côté de 50, sinon flat |
| `candDonchianTrailing` | cassure du canal Donchian 20, sortie trailing à 3 × ATR(14) de l'extrême atteint |
| `candSqueezeKumo` | libération d'un squeeze TTM(20) de ≥ 3 barres, prise seulement du côté du nuage Ichimoku |
| `candMacdSupertrend` | MACD(12/26/9) vs signal, filtré par la direction du Supertrend(10, ×3) |
| `candPsarAdx` | côté du PSAR(0.02/0.2) suivi seulement si ADX(14) ≥ 25, sinon flat |

### BTCUSDT 1h

| Candidat | Trades | Win % | Expectancy % | PnL composé % | DD max % | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|
| candSupertrendAdx | 468 | 33.55 | -0.043 | -27.07 | -43.40 | -0.020 | -0.063 |
| candMmRsi | 1421 | 24.42 | 0.012 | 0.05 | -30.39 | 0.034 | -0.010 |
| candDonchianTrailing | 546 | 35.16 | -0.087 | -45.04 | -53.22 | -0.046 | -0.127 |
| candSqueezeKumo | 204 | 36.27 | 0.076 | 12.87 | -18.67 | 0.159 | -0.017 |
| candMacdSupertrend | 912 | 35.64 | -0.004 | -14.94 | -46.58 | 0.023 | -0.031 |
| candPsarAdx | 1044 | 41.00 | -0.058 | -51.19 | -56.80 | -0.051 | -0.064 |

### BTCUSDT 4h

| Candidat | Trades | Win % | Expectancy % | PnL composé % | DD max % | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|
| candSupertrendAdx | 115 | 40.00 | 0.079 | -0.43 | -33.48 | -0.006 | 0.180 |
| candMmRsi | 337 | 26.41 | 0.044 | -1.88 | -41.34 | 0.230 | -0.116 |
| candDonchianTrailing | 127 | 37.80 | 0.174 | 6.89 | -43.35 | 0.604 | -0.236 |
| candSqueezeKumo | 46 | 32.61 | -0.132 | -9.31 | -29.49 | 0.195 | -0.489 |
| candMacdSupertrend | 223 | 39.01 | 0.130 | 17.79 | -30.53 | 0.227 | 0.034 |
| candPsarAdx | 278 | 42.81 | 0.060 | 5.26 | -42.59 | 0.181 | -0.064 |

### ETHUSDT 1h

| Candidat | Trades | Win % | Expectancy % | PnL composé % | DD max % | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|
| candSupertrendAdx | 463 | 33.26 | 0.063 | 0.33 | -48.54 | 0.021 | 0.107 |
| candMmRsi | 1464 | 23.98 | 0.040 | 14.88 | -53.19 | 0.028 | 0.053 |
| candDonchianTrailing | 510 | 37.65 | 0.188 | 83.32 | -39.02 | 0.083 | 0.307 |
| candSqueezeKumo | 227 | 33.48 | 0.065 | 7.43 | -29.59 | -0.041 | 0.202 |
| candMacdSupertrend | 898 | 34.52 | -0.000 | -24.53 | -41.23 | 0.006 | -0.006 |
| candPsarAdx | 972 | 42.28 | 0.155 | 240.32 | -37.51 | 0.257 | 0.060 |

### ETHUSDT 4h

| Candidat | Trades | Win % | Expectancy % | PnL composé % | DD max % | Exp. M1 % | Exp. M2 % |
|---|---|---|---|---|---|---|---|
| candSupertrendAdx | 106 | 40.57 | 0.677 | 63.60 | -31.82 | 1.134 | 0.283 |
| candMmRsi | 356 | 25.84 | -0.077 | -48.84 | -64.49 | 0.066 | -0.226 |
| candDonchianTrailing | 128 | 34.38 | 0.477 | 28.66 | -50.83 | 0.744 | 0.193 |
| candSqueezeKumo | 57 | 29.82 | 0.604 | 24.34 | -31.59 | 1.596 | -0.578 |
| candMacdSupertrend | 217 | 35.94 | 0.537 | 133.10 | -43.56 | 0.698 | 0.375 |
| candPsarAdx | 243 | 40.33 | 0.142 | 7.37 | -51.28 | 0.001 | 0.263 |

### Critères pré-déclarés et verdict

Critères FIXÉS avant de voir le moindre chiffre : **expectancy > 0 dans chaque cellule ET dans chaque moitié temporelle** ; départage par **expectancy médiane**.

| Candidat | Critères | Expectancy médiane % | Trades (total) | Échecs |
|---|---|---|---|---|
| `candDonchianTrailing` | ❌ | 0.181 | 1311 | BTCUSDT 1h : expectancy -0.087 ≤ 0 ; BTCUSDT 1h M1 : expectancy -0.046 ≤ 0 ; BTCUSDT 1h M2 : expectancy -0.127 ≤ 0 ; BTCUSDT 4h M2 : expectancy -0.236 ≤ 0 |
| `candPsarAdx` | ❌ | 0.101 | 2537 | BTCUSDT 1h : expectancy -0.058 ≤ 0 ; BTCUSDT 1h M1 : expectancy -0.051 ≤ 0 ; BTCUSDT 1h M2 : expectancy -0.064 ≤ 0 ; BTCUSDT 4h M2 : expectancy -0.064 ≤ 0 |
| `candSupertrendAdx` | ❌ | 0.071 | 1152 | BTCUSDT 1h : expectancy -0.043 ≤ 0 ; BTCUSDT 1h M1 : expectancy -0.020 ≤ 0 ; BTCUSDT 1h M2 : expectancy -0.063 ≤ 0 ; BTCUSDT 4h M1 : expectancy -0.006 ≤ 0 |
| `candSqueezeKumo` | ❌ | 0.071 | 534 | BTCUSDT 1h M2 : expectancy -0.017 ≤ 0 ; BTCUSDT 4h : expectancy -0.132 ≤ 0 ; BTCUSDT 4h M2 : expectancy -0.489 ≤ 0 ; ETHUSDT 1h M1 : expectancy -0.041 ≤ 0 ; ETHUSDT 4h M2 : expectancy -0.578 ≤ 0 |
| `candMacdSupertrend` | ❌ | 0.065 | 2250 | BTCUSDT 1h : expectancy -0.004 ≤ 0 ; BTCUSDT 1h M2 : expectancy -0.031 ≤ 0 ; ETHUSDT 1h : expectancy -0.000 ≤ 0 ; ETHUSDT 1h M2 : expectancy -0.006 ≤ 0 |
| `candMmRsi` | ❌ | 0.026 | 3578 | BTCUSDT 1h M2 : expectancy -0.010 ≤ 0 ; BTCUSDT 4h M2 : expectancy -0.116 ≤ 0 ; ETHUSDT 4h : expectancy -0.077 ≤ 0 ; ETHUSDT 4h M2 : expectancy -0.226 ≤ 0 |

**Aucun candidat ne tient les critères pré-déclarés.** Le mieux placé est `candDonchianTrailing` (Donchian + trailing ATR, expectancy médiane 0.181 %) — il ne peut être livré que sous l'étiquette **« champion relatif, non robuste »**, jamais comme une stratégie validée.

## Limites

- Le rejeu chart-fidèle est HORS frais et hors slippage : il mesure un SIGNAL, pas une exécution. La section 2 chiffre l'écart pour les stratégies exprimables ; pour les autres (Donchian, divergence, squeeze, Ichimoku, PSAR, candidats), cet écart n'est PAS mesuré et le coût réel est donc sous-estimé.
- Sélection IN-SAMPLE : les deux moitiés temporelles sont un garde-fou, pas un walk-forward. Aucune période n'est réservée hors échantillon.
- Deux symboles, deux timeframes, une seule fenêtre calendaire : la robustesse hors de ce périmètre n'est pas établie.
- Aucun réglage de paramètres n'a été tenté : ce sont les défauts qui sont mesurés, ce qui évite le sur-ajustement mais sous-estime probablement chaque stratégie.
- Pas de dimensionnement de position ni de gestion du risque : taille fixe partout.
