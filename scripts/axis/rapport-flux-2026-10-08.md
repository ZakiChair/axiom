# AXIS — couche flux : test final sur données jamais vues, 8 octobre 2026

Généré par `scripts/valider-axis-flux.ts`. Manifeste figé `29d9449b8130d61adea69965f0e57debcfa6f2bcaa8ee952498f3e34efabfc88` (`scripts/axis/manifeste-flux-2026-10-08.json`, figé avant tout téléchargement de ces données). **Toutes les valeurs sont des mesures PASSÉES, jamais une promesse de performance.** Rendement signé = sens × ln(open[i+1+h] / open[i+1]) : positif = continuation du mouvement, négatif = retour. Cellule des tableaux = « N / moyenne en bps / % de continuation / p bilatérale ».

## Verdict pré-déclaré : **FAVORABLE**

- **C1** — forts achats, horizon 12 bougies, cellules regroupées, décalage circulaire commun : p unilatérale (continuation) ≤ 0.05.
- **C2** — forts achats, horizon 12 : rendement signé moyen > 0 dans au moins 3 cellules sur 4.
- Chaque cellule doit compter au moins 50 forts achats évalués, sinon NON CONCLUANT.

| Critère | Bloc | Statut | Détail |
|---|---|---|---|
| C1 | regroupé | ✅ tenu | 690 forts achats, 161 bps en moyenne à 12 bougies (51.2 % de hausses), p unilatérale = 0.0005 (seuil 0.05) ; médiane nulle 20 bps |
| C2 | cellules | ✅ tenu | 3 cellule(s) sur 4 à moyenne > 0 (seuil 3) : BNBUSDT 4h -14 bps (n = 144), ADAUSDT 4h 195 bps (n = 143), LINKUSDT 4h 91 bps (n = 154), DOGEUSDT 4h 287 bps (n = 249) |

## Protocole

- **Événement** : marqueur « fort achat / forte vente » d'AXIS aux défauts livrés — volume ≥ 3 × la SMA 20 du volume (bougie comprise), sens du delta taker si |delta| ≥ 10 % du volume, sinon du corps ; hors bougies de signal AXIS et hors dernière bougie (`grosMouvementsAxis`). Delta taker depuis le volume taker acheteur des klines (champ 9) ; intérêt ouvert hors mesure (pas d'historique long).
- **Données** : klines Binance Spot (`https://data-api.binance.vision/api/v3/klines`), bougies 4h clôturées, du début de chaque cellule au `2026-10-08T00:00:00.000Z` exclu.
- **Évaluation** : 300 bougies de warmup ; décisions des indices 299 à n − 2 − 42 (chaque événement dispose de ses 42 bougies suivantes ; mêmes événements à tous les horizons).
- **Statistique** : somme des rendements signés à 12 bougies ; nul = 1999 décalages circulaires des événements dans la fenêtre évaluée de chaque cellule (mêmes effectifs, mêmes sens, même regroupement), un même décalage pour toutes les cellules, k entre 10 % et 90 % de la plus courte fenêtre ; graine 20261008. Nul complémentaire descriptif : 1999 permutations des sens parmi tous les forts mouvements de chaque cellule (graine 20261009).
- **Code** : les fichiers figés du manifeste sont vérifiés par SHA-256 avant le premier téléchargement. SHA-256 du runner : `cb0328ba85f4cac93af00610cebbba34199e4592e1039d17f302d1805483f104`.
- **Contrôles bloquants passés** (sinon : arrêt sans verdict, ce rapport n'existerait pas) : événements = marqueurs --accent du chart (60 derniers) et signaux = marqueurs du chart (120 derniers) ; causalité sur trois préfixes des données réelles ; horizon disponible pour chaque événement ; statistique directe = statistique par sommes préfixes.

## Données

| Cellule | Bougies | Premier open | Dernière clôture | Manquantes (dont écartées) | Décisions évaluées | Forts achats | Fortes ventes | SHA-256 OHLCV+taker |
|---|---|---|---|---|---|---|---|---|
| BNBUSDT 4h | 19362 | 2017-12-01 00:00 | 2026-10-08 00:00 | 36 (20) | 19020 | 144 | 140 | `f1422c679e1a…` |
| ADAUSDT 4h | 18465 | 2018-05-01 00:00 | 2026-10-08 00:00 | 27 (18) | 18123 | 143 | 149 | `95ffff117d5d…` |
| LINKUSDT 4h | 16817 | 2019-02-01 00:00 | 2026-10-08 00:00 | 19 (14) | 16475 | 154 | 144 | `80e52e7a406d…` |
| DOGEUSDT 4h | 15736 | 2019-08-01 00:00 | 2026-10-08 00:00 | 14 (12) | 15394 | 249 | 176 | `8745f5a46cfc…` |

Bougies manquantes (maintenances de la source ou bougies écartées ; série utilisée telle que servie) :
- BNBUSDT 4h : 1 bougie(s) entre 2018-01-03 20:00 et 2018-01-04 04:00
- BNBUSDT 4h : 8 bougie(s) entre 2018-02-07 20:00 et 2018-02-09 08:00
- BNBUSDT 4h : 3 bougie(s) entre 2018-06-25 20:00 et 2018-06-26 12:00
- BNBUSDT 4h : 2 bougie(s) entre 2018-07-03 20:00 et 2018-07-04 08:00
- BNBUSDT 4h : 1 bougie(s) entre 2018-10-19 00:00 et 2018-10-19 08:00
- BNBUSDT 4h : 2 bougie(s) entre 2018-11-13 20:00 et 2018-11-14 08:00
- BNBUSDT 4h : 2 bougie(s) entre 2019-03-11 20:00 et 2019-03-12 08:00
- BNBUSDT 4h : 3 bougie(s) entre 2019-05-14 20:00 et 2019-05-15 12:00
- BNBUSDT 4h : 2 bougie(s) entre 2019-08-14 20:00 et 2019-08-15 08:00
- BNBUSDT 4h : 1 bougie(s) entre 2019-11-12 20:00 et 2019-11-13 04:00
- BNBUSDT 4h : 1 bougie(s) entre 2019-11-24 20:00 et 2019-11-25 04:00
- BNBUSDT 4h : 2 bougie(s) entre 2020-02-19 04:00 et 2020-02-19 16:00
- BNBUSDT 4h : 1 bougie(s) entre 2020-04-24 20:00 et 2020-04-25 04:00
- BNBUSDT 4h : 1 bougie(s) entre 2020-06-27 20:00 et 2020-06-28 04:00
- BNBUSDT 4h : 1 bougie(s) entre 2020-12-21 08:00 et 2020-12-21 16:00
- BNBUSDT 4h : 1 bougie(s) entre 2021-02-10 20:00 et 2021-02-11 04:00
- BNBUSDT 4h : 1 bougie(s) entre 2021-04-19 20:00 et 2021-04-20 04:00
- BNBUSDT 4h : 1 bougie(s) entre 2021-04-25 00:00 et 2021-04-25 08:00
- BNBUSDT 4h : 1 bougie(s) entre 2021-08-12 20:00 et 2021-08-13 04:00
- BNBUSDT 4h : 1 bougie(s) entre 2021-09-29 00:00 et 2021-09-29 08:00
- ADAUSDT 4h : 3 bougie(s) entre 2018-06-25 20:00 et 2018-06-26 12:00
- ADAUSDT 4h : 2 bougie(s) entre 2018-07-03 20:00 et 2018-07-04 08:00
- ADAUSDT 4h : 1 bougie(s) entre 2018-10-19 00:00 et 2018-10-19 08:00
- ADAUSDT 4h : 2 bougie(s) entre 2018-11-13 20:00 et 2018-11-14 08:00
- ADAUSDT 4h : 2 bougie(s) entre 2019-03-11 20:00 et 2019-03-12 08:00
- ADAUSDT 4h : 3 bougie(s) entre 2019-05-14 20:00 et 2019-05-15 12:00
- ADAUSDT 4h : 2 bougie(s) entre 2019-08-14 20:00 et 2019-08-15 08:00
- ADAUSDT 4h : 1 bougie(s) entre 2019-11-12 20:00 et 2019-11-13 04:00
- ADAUSDT 4h : 1 bougie(s) entre 2019-11-24 20:00 et 2019-11-25 04:00
- ADAUSDT 4h : 2 bougie(s) entre 2020-02-19 04:00 et 2020-02-19 16:00
- ADAUSDT 4h : 1 bougie(s) entre 2020-04-24 20:00 et 2020-04-25 04:00
- ADAUSDT 4h : 1 bougie(s) entre 2020-06-27 20:00 et 2020-06-28 04:00
- ADAUSDT 4h : 1 bougie(s) entre 2020-12-21 08:00 et 2020-12-21 16:00
- ADAUSDT 4h : 1 bougie(s) entre 2021-02-10 20:00 et 2021-02-11 04:00
- ADAUSDT 4h : 1 bougie(s) entre 2021-04-19 20:00 et 2021-04-20 04:00
- ADAUSDT 4h : 1 bougie(s) entre 2021-04-25 00:00 et 2021-04-25 08:00
- ADAUSDT 4h : 1 bougie(s) entre 2021-08-12 20:00 et 2021-08-13 04:00
- ADAUSDT 4h : 1 bougie(s) entre 2021-09-29 00:00 et 2021-09-29 08:00
- LINKUSDT 4h : 2 bougie(s) entre 2019-03-11 20:00 et 2019-03-12 08:00
- LINKUSDT 4h : 3 bougie(s) entre 2019-05-14 20:00 et 2019-05-15 12:00
- LINKUSDT 4h : 2 bougie(s) entre 2019-08-14 20:00 et 2019-08-15 08:00
- LINKUSDT 4h : 1 bougie(s) entre 2019-11-12 20:00 et 2019-11-13 04:00
- LINKUSDT 4h : 1 bougie(s) entre 2019-11-24 20:00 et 2019-11-25 04:00
- LINKUSDT 4h : 2 bougie(s) entre 2020-02-19 04:00 et 2020-02-19 16:00
- LINKUSDT 4h : 1 bougie(s) entre 2020-04-24 20:00 et 2020-04-25 04:00
- LINKUSDT 4h : 1 bougie(s) entre 2020-06-27 20:00 et 2020-06-28 04:00
- LINKUSDT 4h : 1 bougie(s) entre 2020-12-21 08:00 et 2020-12-21 16:00
- LINKUSDT 4h : 1 bougie(s) entre 2021-02-10 20:00 et 2021-02-11 04:00
- LINKUSDT 4h : 1 bougie(s) entre 2021-04-19 20:00 et 2021-04-20 04:00
- LINKUSDT 4h : 1 bougie(s) entre 2021-04-25 00:00 et 2021-04-25 08:00
- LINKUSDT 4h : 1 bougie(s) entre 2021-08-12 20:00 et 2021-08-13 04:00
- LINKUSDT 4h : 1 bougie(s) entre 2021-09-29 00:00 et 2021-09-29 08:00
- DOGEUSDT 4h : 2 bougie(s) entre 2019-08-14 20:00 et 2019-08-15 08:00
- DOGEUSDT 4h : 1 bougie(s) entre 2019-11-12 20:00 et 2019-11-13 04:00
- DOGEUSDT 4h : 1 bougie(s) entre 2019-11-24 20:00 et 2019-11-25 04:00
- DOGEUSDT 4h : 2 bougie(s) entre 2020-02-19 04:00 et 2020-02-19 16:00
- DOGEUSDT 4h : 1 bougie(s) entre 2020-04-24 20:00 et 2020-04-25 04:00
- DOGEUSDT 4h : 1 bougie(s) entre 2020-06-27 20:00 et 2020-06-28 04:00
- DOGEUSDT 4h : 1 bougie(s) entre 2020-12-21 08:00 et 2020-12-21 16:00
- DOGEUSDT 4h : 1 bougie(s) entre 2021-02-10 20:00 et 2021-02-11 04:00
- DOGEUSDT 4h : 1 bougie(s) entre 2021-04-19 20:00 et 2021-04-20 04:00
- DOGEUSDT 4h : 1 bougie(s) entre 2021-04-25 00:00 et 2021-04-25 08:00
- DOGEUSDT 4h : 1 bougie(s) entre 2021-08-12 20:00 et 2021-08-13 04:00
- DOGEUSDT 4h : 1 bougie(s) entre 2021-09-29 00:00 et 2021-09-29 08:00

Bougies servies mais écartées (comptées comme manquantes) :
- BNBUSDT 4h : 2018-01-04 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2018-02-08 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2018-06-26 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2018-07-04 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2018-10-19 04:00 (closeTime incohérent)
- BNBUSDT 4h : 2018-11-14 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2019-03-12 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2019-05-15 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2019-08-15 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2019-11-13 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2019-11-25 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2020-02-19 08:00 (closeTime incohérent)
- BNBUSDT 4h : 2020-04-25 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2020-06-28 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2020-12-21 12:00 (closeTime incohérent)
- BNBUSDT 4h : 2021-02-11 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2021-04-20 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2021-04-25 04:00 (closeTime incohérent)
- BNBUSDT 4h : 2021-08-13 00:00 (closeTime incohérent)
- BNBUSDT 4h : 2021-09-29 04:00 (closeTime incohérent)
- ADAUSDT 4h : 2018-06-26 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2018-07-04 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2018-10-19 04:00 (closeTime incohérent)
- ADAUSDT 4h : 2018-11-14 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2019-03-12 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2019-05-15 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2019-08-15 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2019-11-13 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2019-11-25 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2020-02-19 08:00 (closeTime incohérent)
- ADAUSDT 4h : 2020-04-25 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2020-06-28 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2020-12-21 12:00 (closeTime incohérent)
- ADAUSDT 4h : 2021-02-11 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2021-04-20 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2021-04-25 04:00 (closeTime incohérent)
- ADAUSDT 4h : 2021-08-13 00:00 (closeTime incohérent)
- ADAUSDT 4h : 2021-09-29 04:00 (closeTime incohérent)
- LINKUSDT 4h : 2019-03-12 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2019-05-15 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2019-08-15 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2019-11-13 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2019-11-25 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2020-02-19 08:00 (closeTime incohérent)
- LINKUSDT 4h : 2020-04-25 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2020-06-28 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2020-12-21 12:00 (closeTime incohérent)
- LINKUSDT 4h : 2021-02-11 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2021-04-20 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2021-04-25 04:00 (closeTime incohérent)
- LINKUSDT 4h : 2021-08-13 00:00 (closeTime incohérent)
- LINKUSDT 4h : 2021-09-29 04:00 (closeTime incohérent)
- DOGEUSDT 4h : 2019-08-15 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2019-11-13 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2019-11-25 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2020-02-19 08:00 (closeTime incohérent)
- DOGEUSDT 4h : 2020-04-25 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2020-06-28 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2020-12-21 12:00 (closeTime incohérent)
- DOGEUSDT 4h : 2021-02-11 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2021-04-20 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2021-04-25 04:00 (closeTime incohérent)
- DOGEUSDT 4h : 2021-08-13 00:00 (closeTime incohérent)
- DOGEUSDT 4h : 2021-09-29 04:00 (closeTime incohérent)

## C1 et C2 — forts achats à 12 bougies

| Statistique (cellules regroupées) | Valeur |
|---|---|
| Forts achats | 690 |
| Rendement signé moyen | 161 bps (+1.61 %) |
| Médiane | 10 bps |
| Continuation (rendement > 0) | 51.2 % |
| t (naïf, événements supposés indépendants) | 3.36 |
| p unilatérale (décalage commun) | 0.0005 |
| Médiane / 95e centile des décalages | 20 / 82 bps |
| Net de 0.14 % aller-retour | 147 bps |
| Plus courte fenêtre (décisions) | 15394 |

| Cellule | Forts achats | Moyenne bps | Médiane bps | Continuation % | t | p unilatérale (décalage propre) |
|---|---|---|---|---|---|---|
| BNBUSDT 4h | 144 | -14 | -58 | 44.4 | -0.22 | 0.7595 |
| ADAUSDT 4h | 143 | 195 | 124 | 58.0 | 2.71 | 0.0015 |
| LINKUSDT 4h | 154 | 91 | -14 | 49.4 | 1.27 | 0.1460 |
| DOGEUSDT 4h | 249 | 287 | 14 | 52.2 | 2.57 | 0.0045 |

## Descriptif (sans effet sur le verdict, aucune sélection)

### Nul complémentaire : permutation des sens parmi tous les forts mouvements (horizon 12)

Les forts achats sont-ils suivis de plus de hausse que les forts mouvements en général (fortes ventes comprises) ? Instants, effectifs et volatilité locale préservés ; seul le sens est tiré au sort.

| Cellule | Forts mouvements | dont forts achats | Moyenne brute de tous (bps) | Moyenne des forts achats (bps) | Médiane nulle (bps) | p unilatérale |
|---|---|---|---|---|---|---|
| BNBUSDT 4h | 284 | 144 | -55 | -14 | -54 | 0.1795 |
| ADAUSDT 4h | 292 | 143 | 117 | 195 | 114 | 0.0505 |
| LINKUSDT 4h | 298 | 154 | 118 | 91 | 117 | 0.7105 |
| DOGEUSDT 4h | 425 | 249 | 216 | 287 | 216 | 0.1100 |
| **Regroupé** | 1299 | 690 | 112 | 161 | 118 | 0.0470 |

### Tous horizons, cellules regroupées

| Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|
| Forts achats | 690 / 34 / 50 / 0.0005 | 690 / 73 / 50 / 0.0005 | 690 / 138 / 53 / 0.0005 | 690 / 132 / 51 / 0.0005 | 690 / 161 / 51 / 0.0005 | 690 / 316 / 53 / 0.0005 | 690 / 379 / 56 / 0.0005 |
| Fortes ventes | 609 / -3 / 47 / 0.7870 | 609 / -20 / 43 / 0.1630 | 609 / -26 / 44 / 0.1680 | 609 / -46 / 45 / 0.1245 | 609 / -56 / 45 / 0.2200 | 609 / -61 / 47 / 0.4370 | 609 / -108 / 47 / 0.3480 |

### Tous horizons, par cellule (décalage propre)

| Cellule | Événements | h = 1 | h = 2 | h = 3 | h = 6 | h = 12 | h = 24 | h = 42 |
|---|---|---|---|---|---|---|---|---|
| BNBUSDT 4h | Forts achats | 144 / -8 / 47 / 0.5835 | 144 / 29 / 56 / 0.1835 | 144 / 51 / 59 / 0.0730 | 144 / 1 / 49 / 0.9850 | 144 / -14 / 44 / 0.8340 | 144 / -7 / 52 / 0.9455 | 144 / 17 / 52 / 0.9115 |
| BNBUSDT 4h | Fortes ventes | 140 / 6 / 52 / 0.7060 | 140 / 32 / 49 / 0.1520 | 140 / 47 / 50 / 0.1030 | 140 / 30 / 51 / 0.4915 | 140 / 97 / 53 / 0.1515 | 140 / 157 / 54 / 0.1305 | 140 / 83 / 51 / 0.6150 |
| ADAUSDT 4h | Forts achats | 143 / 56 / 57 / 0.0020 | 143 / 70 / 52 / 0.0060 | 143 / 114 / 54 / 0.0010 | 143 / 129 / 56 / 0.0055 | 143 / 195 / 58 / 0.0025 | 143 / 331 / 55 / 0.0005 | 143 / 372 / 59 / 0.0020 |
| ADAUSDT 4h | Fortes ventes | 149 / 8 / 42 / 0.6645 | 149 / 4 / 45 / 0.8695 | 149 / 15 / 48 / 0.6435 | 149 / -11 / 50 / 0.8065 | 149 / -42 / 50 / 0.5085 | 149 / -46 / 49 / 0.6370 | 149 / -6 / 52 / 0.9700 |
| LINKUSDT 4h | Forts achats | 154 / -10 / 47 / 0.5800 | 154 / -23 / 46 / 0.3775 | 154 / 28 / 52 / 0.3905 | 154 / 18 / 53 / 0.7055 | 154 / 91 / 49 / 0.1895 | 154 / 200 / 53 / 0.0625 | 154 / 310 / 60 / 0.0375 |
| LINKUSDT 4h | Fortes ventes | 144 / -16 / 47 / 0.4230 | 144 / -37 / 41 / 0.1885 | 144 / -64 / 41 / 0.0740 | 144 / -139 / 39 / 0.0085 | 144 / -146 / 43 / 0.0525 | 144 / -104 / 43 / 0.3800 | 144 / -265 / 44 / 0.1055 |
| DOGEUSDT 4h | Forts achats | 249 / 74 / 49 / 0.0005 | 249 / 159 / 47 / 0.0005 | 249 / 270 / 51 / 0.0005 | 249 / 280 / 48 / 0.0005 | 249 / 287 / 52 / 0.0045 | 249 / 566 / 52 / 0.0005 | 249 / 634 / 53 / 0.0030 |
| DOGEUSDT 4h | Fortes ventes | 176 / -8 / 45 / 0.6650 | 176 / -69 / 39 / 0.0300 | 176 / -87 / 36 / 0.0300 | 176 / -62 / 42 / 0.2490 | 176 / -115 / 37 / 0.1575 | 176 / -211 / 43 / 0.1175 | 176 / -218 / 41 / 0.2505 |

### Forts achats et EMA 200 (horizon 12)

| Cellule | Au-dessus : N / bps / % / p bi | Sous : N / bps / % / p bi |
|---|---|---|
| BNBUSDT 4h | 90 / 76 / 44 / 0.3335 | 54 / -165 / 44 / 0.0865 |
| ADAUSDT 4h | 93 / 304 / 61 / 0.0005 | 50 / -9 / 52 / 0.9310 |
| LINKUSDT 4h | 109 / 162 / 51 / 0.0595 | 45 / -79 / 44 / 0.4935 |
| DOGEUSDT 4h | 167 / 456 / 53 / 0.0015 | 82 / -57 / 50 / 0.6080 |

### Par année (forts achats / fortes ventes ; moyenne des forts achats à 12 bougies en bps)

| Année | BNBUSDT 4h | ADAUSDT 4h | LINKUSDT 4h | DOGEUSDT 4h |
|---|---|---|---|---|
| 2018 | 12 / 11 ; -694 | 6 / 7 ; 572 | — | — |
| 2019 | 12 / 9 ; 0 | 23 / 15 ; 214 | 31 / 15 ; 182 | 11 / 12 ; 28 |
| 2020 | 4 / 3 ; -317 | 24 / 11 ; 536 | 26 / 14 ; 287 | 53 / 23 ; 304 |
| 2021 | 9 / 11 ; 1164 | 21 / 14 ; 27 | 10 / 15 ; -49 | 50 / 20 ; 583 |
| 2022 | 16 / 24 ; -232 | 10 / 21 ; -342 | 9 / 15 ; -594 | 35 / 27 ; 128 |
| 2023 | 29 / 26 ; -12 | 14 / 20 ; -75 | 20 / 28 ; 66 | 31 / 25 ; 1 |
| 2024 | 25 / 15 ; 89 | 15 / 23 ; 494 | 15 / 21 ; 133 | 30 / 20 ; 487 |
| 2025 | 25 / 28 ; -72 | 13 / 25 ; -138 | 21 / 25 ; -45 | 18 / 32 ; 262 |
| 2026 | 12 / 13 ; 55 | 17 / 13 ; 289 | 22 / 11 ; 202 | 21 / 17 ; 103 |

### Signaux AXIS v2 par qualité de flux à l'entrée (rejeu close-à-close, hors frais)

| Cellule | fort : trades / exp. % / gagnants % | ordinaire : trades / exp. % / gagnants % | contre-sens : trades / exp. % / gagnants % | indisponible : trades / exp. % / gagnants % |
|---|---|---|---|---|
| BNBUSDT 4h | 23 / 0.64 / 39 | 118 / 4.34 / 42 | 7 / 0.59 / 43 | 0 / — / — |
| ADAUSDT 4h | 14 / -2.69 / 21 | 103 / 5.36 / 39 | 4 / 10.67 / 75 | 0 / — / — |
| LINKUSDT 4h | 9 / 11.45 / 44 | 108 / 5.14 / 42 | 6 / -5.97 / 17 | 0 / — / — |
| DOGEUSDT 4h | 9 / 6.44 / 33 | 74 / 11.39 / 45 | 7 / 0.50 / 29 | 0 / — / — |

Ventes AXIS « fortes » (cellules regroupées, rendement signé −1 × ln à 12 bougies après la sortie) : 46 ventes, -34 bps en moyenne, 43 % de baisses supplémentaires, p unilatérale = 0.5545.

## Formulations pré-déclarées des infobulles

- **Fort achat** : « fort achat : sur données jamais vues (BNB/ADA/LINK/DOGE 4h, 2017-2026), +1.61 % en moyenne sur les 12 bougies suivantes (51 % de hausses, p ≤ 0.0005) — mesure passée, pas une promesse »
- **Forte vente** : « forte vente : repérée ; aucune suite mesurable à 12 bougies sur données jamais vues (BNB/ADA/LINK/DOGE 4h, 2017-2026) »
- **Vente forte (signal AXIS)** : aucune formulation mesurée (effectif, p ou verdict insuffisants) ; « non mesurée » reste
- Garde : ces formulations ne s'affichent que sur une bougie dont le delta taker est disponible (population mesurée : klines Binance avec volume taker) ; sans delta taker, le sens vient du corps seul et « couche flux non mesurée » reste.

## Limites

- Quatre alts crypto spot Binance, une seule unité (4h), même facteur de marché que BTC/ETH : la robustesse hors de ce périmètre (BTC/ETH eux-mêmes hors échantillon vu, autres unités, marchés sans volume taker) n'est pas établie ; en 1h l'exploration ne voyait presque rien.
- Le sens testé (achats) et l'horizon (12 bougies) viennent de l'exploration sur données vues ; ce test unique contrôle ce choix, il ne l'élimine pas. La définition elle-même est antérieure à toute donnée.
- Les événements sont conditionnés sur le volume, donc sur la volatilité, et se regroupent dans les phases agitées ; le décalage circulaire préserve ce regroupement mais pas la volatilité locale de chaque bougie d'événement, et suppose une série à peu près stationnaire ; le nul par permutation des sens (descriptif) préserve instants et volatilité mais répond à une autre question ; le t naïf suppose des événements indépendants et n'est qu'indicatif.
- Rendement log sans coût ni slippage, fill à l'open suivant : un repère de lecture (« que fait le prix après ? »), pas une stratégie exécutable ; aucun stop, aucune gestion du risque.
- L'intérêt ouvert n'est pas mesuré (pas d'historique long) ; dans le chart, les lectures d'OI restent descriptives et le disent.
- Puissance : avec quelques centaines d'événements regroupés (une centaine par cellule), un effet de l'ordre de 1 % à 12 bougies est détectable ; un effet plus petit ne le serait pas, et un échec ne prouverait pas l'absence d'effet.
