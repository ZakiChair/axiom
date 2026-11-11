# Outils d'analyse, on-chain et nouvelles sources pour AXIOM : suggestions du 2026-11-06

Ce document complète `docs/revue-2026-11-06.md` et ses 35 suggestions sur l'usage quotidien. Il ne traite que les outils d'analyse (technique, quantitative, volatilité, options, dérivés, on-chain) et les sources de données. Lecture seule : aucun code n'a été modifié.

## Méthode

1. **Inventaire de l'existant.** Quatre lecteurs ont recensé ce qu'AXIOM fait déjà : analyse technique, on-chain, dérivés, options et flux, sources et règles du contrat.
2. **Idéation.** Neuf angles d'idéation ont produit 80 idées brutes. Chacune a été confrontée au code avec grep et, pour les sources, à une recherche web.
3. **Fusion et critique.** La fusion a donné 51 idées, dont 8 ajoutées par une critique de complétude (SUG-C1 à SUG-C8). 12 pistes ont été écartées, avec leur raison.
4. **Vérification.** Trois vérifications indépendantes ont été menées :
   - code et contrat, idée par idée ;
   - intérêt analytique : littérature, pièges comme le repaint, le look-ahead ou les données révisées, et protocole de validation ;
   - sources externes, en ligne.
5. **Notation.** Trois juges ont noté chaque idée : valeur analytique, coût-risque et cohérence. **Score = 2 × valeur + coût-risque + cohérence**, sur 20.

> **Limite de la vérification.** Le quota de recherche web s'est épuisé pendant la vérification des sources. Pour beaucoup de sources, les conditions d'utilisation restent « non vérifiées » : c'est indiqué source par source ci-dessous. Quatre points ont été recontrôlés à la main : Binance Vision, Polymarket, Wikimedia et Upbit (voir « Sources »).

## Constats transverses

1. **Les meilleures idées exploitent des données qu'AXIOM a déjà**, sans nouveau fournisseur : klines Binance 1m avec le volume acheteur taker, Deribit, clôtures 1d du top 50, BGeometrics et CoinMetrics. Les idées qui reposent sur une source nouvelle arrivent plus bas, faute de valeur démontrée ou de licence claire.
2. **Presque toutes ajoutent de la surface** et demandent une exception au gel G100. Six sources nouvelles demandent en plus une exception « nouveau fournisseur ».
3. **Le tri analytique n'a trouvé qu'un seul gadget**, SUG-34 (économie des L2). En revanche, la plupart des idées n'ont qu'un intérêt documenté « moyen » ou « faible ». Le libellé « descriptif » doit donc rester tant qu'une étude figée (protocole scripts/axis/) n'a pas conclu.
4. **Deux défauts relevés au passage, absents de la revue :**
   - CBPREM calcule moyenne, σ et z sur toute la série (apps/web/src/data/cbprem.ts:110-131). Les points passés sont donc jugés avec des données futures, mais la valeur courante n'est pas affectée.
   - Le worker EQS garde la bougie en cours sans filtre de clôture et jette le volume taker k[9] (apps/web/src/workers/screener.worker.ts:61-80).

## Classement

| # | Id | Score | V | C-R | Coh | Effort | Catégorie | Intérêt documenté | Idée |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SUG-6 | 16 | 4 | 4 | 4 | M | quantitatif | moyen / utile_avec_reserve | Force relative contre BTC/ETH : indicateur RS Mansfield et alpha résiduel, champ EQS et graphe de rotation ouvert (alts et secteurs) |
| 2 | SUG-7 | 16 | 5 | 3 | 3 | M | analyse technique | fort / utile_avec_reserve | Volatilité attendue contre réalisée pour tous les actifs : bandes HAR-RV calibrées, amplitude consommée, et DVOL/VRP/corrélation spot-vol en séries graphe |
| 3 | SUG-41 | 16 | 4 | 4 | 4 | M | quantitatif | moyen / utile_avec_reserve | Largeur du marché historisée et saison des alts : % > MM50/MM200, nouveaux plus hauts/bas, ligne A/D et oscillateur, indice de saison des alts et dominance BTC hors stablecoins |
| 4 | SUG-C5 | 16 | 4 | 4 | 4 | M | quantitatif | fort / utile | Pouvoir prédictif d'un indicateur continu : rendements futurs par décile, IC de rang avec intervalle bootstrap par blocs et stabilité par moitiés, sur le graphe ou un panier |
| 5 | SUG-3 | 15 | 4 | 3 | 4 | M | volume et flux | moyen / utile_avec_reserve | Flux intrabar reconstruit à la demande : VPVR, VPFR et footprint historique depuis les klines 1m/1s Binance (vrai split taker), puis CVD par taille d'ordre via le daemon |
| 6 | SUG-25 | 15 | 3 | 4 | 5 | M | on-chain BTC | moyen / utile_avec_reserve | Coût de base des détenteurs récents et anciens (STH/LTH) : lignes visibles sur toutes les unités, bandes σ et marqueurs de reconquête ou de perte |
| 7 | SUG-35 | 15 | 3 | 4 | 5 | M | flux institutionnels et sentiment | faible / utile_avec_reserve | Prime Coinbase en série graphe causale (z glissant, persistance, au-delà de BTC/ETH), puis quadrant « levier contre comptant » mesuré par actif |
| 8 | SUG-C4 | 15 | 4 | 3 | 4 | M | analyse technique | moyen / utile_avec_reserve | EQS ouvert au registre : tout indicateur scalaire comme critère, conditions d'évènement (croisement, sortie de squeeze, divergence apparue, NR7) et concordance multi-unité 4h + 1d |
| 9 | SUG-C8 | 15 | 3 | 4 | 5 | S | options | moyen / utile_avec_reserve | ΔOI d'options par strike et échéance sur 24 h et 7 j (instantanés compacts de la chaîne Deribit) : murs naissants et murs qui se vident |
| 10 | SUG-1 | 14 | 4 | 3 | 3 | M | analyse technique | moyen / utile_avec_reserve | Indicateurs d'unité supérieure sur le graphe (RSI 4h ou EMA 1d sur un graphe 1h), lus à la clôture sans repeinture |
| 11 | SUG-2 | 14 | 3 | 4 | 4 | M | analyse technique | faible / utile_avec_reserve | VWAP et pivots hebdomadaires, mensuels et trimestriels, et AVWAP ancré automatiquement sur le dernier pivot confirmé |
| 12 | SUG-12 | 14 | 3 | 4 | 4 | M | volume et flux | moyen / utile_avec_reserve | Absorption « effort contre résultat » en indicateur mesuré, et scanner de flux dans EQS (RVOL, delta taker, pente CVD, fort achat, absorption) |
| 13 | SUG-14 | 14 | 3 | 4 | 4 | M | dérivés | moyen / utile | Historique profond du positionnement Binance (archives metrics : OI, L/S comptes et top traders, taker) et quadrant OI × prix par bougie mesuré |
| 14 | SUG-15 | 14 | 3 | 4 | 4 | M | dérivés | moyen / utile_avec_reserve | Écran dérivés de tout l'univers en 3-4 requêtes : funding prédit Binance/Bybit/HL, OI et prime HL, perps au plafond d'OI, ΔOI Bybit tous symboles |
| 15 | SUG-20 | 14 | 3 | 4 | 4 | M | options | moyen / utile_avec_reserve | Surface d'options normalisée à delta et maturité constants (ATM, RR et butterfly 10Δ/25Δ à 7/30/90 j) et son historique quotidien avec percentiles 1 an |
| 16 | SUG-40 | 14 | 2 | 5 | 5 | S | nouvelle source | moyen / utile_avec_reserve | Anticipations d'évènements : pente attendue des taux US (DGS2 − DFF) sans source nouvelle, puis probabilités FOMC et seuils BTC de Polymarket/Kalshi face aux probabilités Deribit |
| 17 | SUG-42 | 14 | 3 | 4 | 4 | M | quantitatif | moyen / utile_avec_reserve | Régimes mesurés : par actif (tendance × volatilité, 9 états avec statistiques conditionnelles) et transversaux (dispersion, corrélation moyenne, ratio d'absorption) |
| 18 | SUG-C2 | 14 | 3 | 4 | 4 | M | analyse technique | faible / utile_avec_reserve | Dessins d'analyse standard manquants : fourches d'Andrews et de Schiff, extension de Fibonacci à 3 points, Fibonacci temporel, éventail et canal, étiquettes d'Elliott contrôlées, XABCD aux ratios en direct, texte et flèches |
| 19 | SUG-C7 | 14 | 3 | 4 | 4 | S | analyse technique | moyen / utile_avec_reserve | Probabilité de toucher la cible avant le stop dans l'outil position : modèle à deux barrières (IV DVOL ou RV de l'actif) et fréquence empirique sur l'historique de l'actif, espérance en R affichée |
| 20 | SUG-5 | 13 | 4 | 3 | 2 | M | analyse technique | moyen / utile_avec_reserve | Niveaux de liquidité automatiques : zones S/R autonomes, swings non repris et égaux, balayages confirmés par liquidations, testés contre des niveaux aléatoires |
| 21 | SUG-8 | 13 | 3 | 3 | 4 | M | analyse technique | fort / utile_avec_reserve | Saisonnalité intrajournalière de la volatilité et du volume, timing des extrêmes hebdomadaires, et RVOL « au moment » sur toutes les unités intrajournalières |
| 22 | SUG-18 | 13 | 3 | 3 | 4 | L | dérivés | fort / utile_avec_reserve | Coût du portage : funding cumulé réalisé sur 7/30 j, basis daté à maturité constante 90 j sur plusieurs années, écart funding − basis, et lecture « short de portage » du COT CME |
| 23 | SUG-21 | 13 | 3 | 3 | 4 | M | options | moyen / utile_avec_reserve | Niveaux d'options enrichis sur le graphe : murs consolidés Deribit + IBIT/ETHA et quantiles risque-neutres asymétriques (p10 à p90) aux prochaines échéances |
| 24 | SUG-4 | 12 | 3 | 3 | 3 | M | analyse technique | faible / utile_avec_reserve | Profils de volume par période (jour, semaine, mois) : POC nus, HVN/LVN, POC développant, migration de la Value Area, TPO en phase 2 |
| 25 | SUG-24 | 12 | 2 | 4 | 4 | M | options | faible / utile_avec_reserve | Échéances Deribit mesurées dans EVTS (attraction du max pain, compression puis détente) et expositions vanna/charm par strike |
| 26 | SUG-28 | 12 | 2 | 4 | 4 | M | on-chain BTC | faible / utile_avec_reserve | Mineurs sur tout l'historique : Hash Ribbons depuis 2010 avec signaux de reprise annotés, et hashprice en série graphe |
| 27 | SUG-C3 | 12 | 3 | 3 | 3 | M | analyse technique | moyen / utile_avec_reserve | Indicateur appliqué à un indicateur ou à une série auxiliaire (RSI du CVD, z-score de l'OI, Bollinger du funding notionnel), plus une combinaison bornée A ÷ B ou A − B |
| 28 | SUG-10 | 11 | 2 | 4 | 3 | M | volume et flux | faible / utile_avec_reserve | Spot contre perp : ratio de volume perp/spot, part de chaque jambe dans le delta et jambe meneuse des cassures |
| 29 | SUG-17 | 11 | 3 | 2 | 3 | M | dérivés | moyen / utile_avec_reserve | Jauges de levier : ratio OI/capitalisation avec percentile, et levier observé et carburant de liquidation à ±2/5/10 % sur l'échantillon Hyperliquid |
| 30 | SUG-31 | 11 | 2 | 3 | 4 | M | on-chain ETH, DeFi et stablecoins | moyen / utile_avec_reserve | Où arrivent les dollars : flux nets USDT/USDC par chaîne (Tron, Ethereum, Solana, Base, Hyperliquid L1…), offre native en série, et émissions/rachats réels sur Ethereum |
| 31 | SUG-38 | 11 | 3 | 2 | 3 | M | nouvelle source | moyen / utile_avec_reserve | Prime coréenne (Upbit) : prime crypto pure, prime du dollar numérique et alts surchauffées en KRW, à côté de la prime Coinbase |
| 32 | SUG-39 | 11 | 2 | 4 | 3 | S | nouvelle source | moyen / utile_avec_reserve | Attention du grand public : pages vues Wikipédia par actif en série quotidienne, z-score et pics d'attention |
| 33 | SUG-C6 | 11 | 3 | 2 | 3 | M | on-chain BTC | moyen / utile_avec_reserve | URPD on-chain sur l'axe des prix (offre BTC par prix de dernier mouvement, global, STH, LTH) et prix de référence cointime (True Market Mean, prix cointime, prix « vaulted ») via Bitview |
| 34 | SUG-9 | 10 | 2 | 3 | 3 | L | analyse technique | moyen / utile_avec_reserve | Figures chartistes détectées objectivement (lissage à noyau de Lo, Mamaysky et Wang) et mesurées avant tout affichage |
| 35 | SUG-13 | 10 | 2 | 3 | 3 | M | volume et flux | moyen / utile_avec_reserve | Profondeur historique du carnet perp Binance depuis les archives bookDepth : liquidité à ±1-5 %, déséquilibre et ratio volume/profondeur |
| 36 | SUG-19 | 10 | 2 | 3 | 3 | M | dérivés | faible / utile_avec_reserve | Positionnement de la foule sur plusieurs places : L/S comptes Bybit depuis 2020 et OKX, ratio de prêt sur marge OKX, compteur de concordance |
| 37 | SUG-27 | 10 | 2 | 3 | 3 | M | on-chain BTC | faible / utile_avec_reserve | Flux nets vers les plateformes BTC et ETH sur le graphe : histogramme, Σ7 j et z-score multi-cycle, avec étude d'évènement |
| 38 | SUG-30 | 10 | 2 | 3 | 3 | M | on-chain ETH, DeFi et stablecoins | faible / utile_avec_reserve | ETH on-chain sur le graphe : MVRV et prix réalisé reconstitué, files de staking en séries, burn et émission brute |
| 39 | SUG-36 | 10 | 2 | 3 | 3 | M | flux institutionnels et sentiment | faible / utile_avec_reserve | Flux ETF spot BTC/ETH/SOL sur le graphe avec archive journalière accumulée et datation sans look-ahead |
| 40 | SUG-C1 | 10 | 2 | 3 | 3 | M | analyse technique | faible / utile_avec_reserve | Barres non temporelles et types de prix : Renko ATR, range bars, Line Break 3, Heikin Ashi en bougie, types natifs OHLC/aire, puis Point & Figure avec objectifs par comptage |
| 41 | SUG-22 | 9 | 2 | 2 | 3 | M | options | moyen / utile_avec_reserve | Flux d'options : prints Deribit sur 24 h (agresseur, blocs, prime et vega nettes par strike) et historique OKX du put/call et des volumes taker |
| 42 | SUG-23 | 9 | 2 | 2 | 3 | M | options | faible / utile_avec_reserve | Options des alts : IV, skew et mouvement attendu pour SOL et XRP (Deribit USDC), XRP, DOGE et SOL (Bybit), BNB et DOGE (Binance eapi) |
| 43 | SUG-32 | 9 | 2 | 2 | 3 | M | nouvelle source | faible / utile_avec_reserve | Taux d'emprunt et utilisation des stablecoins sur Aave v3, comparés au funding perp et au T-bill (levier on-chain) |
| 44 | SUG-33 | 9 | 2 | 2 | 3 | M | on-chain ETH, DeFi et stablecoins | moyen / utile_avec_reserve | Fiche on-chain d'un alt : rachats et distributions contre dilution réalisée, multiple P/F historique, concentration des détenteurs et liquidité des pools DEX |
| 45 | SUG-11 | 8 | 2 | 2 | 2 | M | volume et flux | faible / utile_avec_reserve | CVD par place côte à côte : Binance, OKX (Rubik taker-volume), Bybit et Coinbase (Coinalyze ohlcv-history), sans agrégation |
| 46 | SUG-16 | 8 | 2 | 2 | 2 | M | dérivés | faible / utile_avec_reserve | OI total, funding pondéré par l'OI et liquidations agrégés sur les 4 places perp via Coinalyze multi-symboles (amendement requis) |
| 47 | SUG-26 | 8 | 2 | 2 | 2 | M | on-chain BTC | moyen / utile_avec_reserve | Valorisation de cycle BTC à J-1 et sur tout l'historique : recalcul depuis Coin Metrics community (option A, gratuite) ou BGeometrics Professional (option B, payante et conforme) |
| 48 | SUG-29 | 8 | 2 | 2 | 2 | M | nouvelle source | moyen / utile_avec_reserve | Nouvelle source Bitview (Bitcoin Research Kit) pour les cohortes, et distribution des détenteurs de long terme (offre LTH, CDD ajusté) à côté du VDD |
| 49 | SUG-34 | 8 | 1 | 3 | 3 | M | nouvelle source | faible / gadget | Économie des L2 via growthepie (CC BY 4.0) : utilisateurs actifs, frais, loyer payé à Ethereum et profit pour ARB, OP, MNT, STRK, ZK… |
| 50 | SUG-37 | 8 | 2 | 2 | 2 | M | nouvelle source | faible / utile_avec_reserve | Positions longues et courtes sur marge Bitfinex (stats1) en séries graphe, et liquidations Bitfinex en troisième historique |
| 51 | SUG-43 | 7 | 2 | 3 | – | M | quantitatif | faible / utile_avec_reserve | Macro inter-marchés : liquidité des banques centrales en USD (Fed + BCE + BoJ) avec décalage mesuré sur BTC, et bêtas macro glissants de l'actif (Nasdaq, dollar large, taux réels) |

**Top 5 de chaque juge**

- valeur : SUG-7, SUG-1, SUG-C5, SUG-3, SUG-6
- cout-risque : SUG-40, SUG-C8, SUG-35, SUG-C7, SUG-41
- coherence : SUG-25, SUG-C8, SUG-35, SUG-40, SUG-21

## Sources

### Recontrôles manuels du 2026-11-06

- **Binance Vision**, archives data.binance.vision, déjà utilisées par AXIOM. Les « Vision Dataset Terms » v1.0 du 26 août 2026 placent les données sous CC BY-NC-SA 4.0. Tout usage commercial exige une licence écrite, et toute redistribution d'une œuvre dérivée doit citer Binance Vision et garder la même licence. Un site personnel non commercial semble compatible, à condition de citer la source. Il reste à lire le PDF complet avant d'en dépendre (SUG-3, SUG-13, SUG-14, SUG-C5, SUG-C7). Source : https://data.binance.vision/Binance_Vision-Terms_of_Use.pdf
- **Polymarket.** Les API Gamma et Data sont publiques et sans authentification, d'après la documentation officielle. Les conditions de réaffichage n'ont pas été trouvées. Source : https://docs.polymarket.com/api-reference/introduction
- **Wikimedia, pages vues.** Des projets tiers indiquent que les données de l'API sont sous CC0 1.0. La page officielle des conditions n'a pas été consultée. Sources : https://github.com/musikanimal/pageviews et https://ironholds.r-universe.dev/pageviews/doc/manual.html
- **Upbit.** Les documents officiels liés (licences du SDK et de la boîte à outils) visent un usage personnel et non commercial, dans le cadre des conditions de l'Open API. Le texte de ces conditions n'a pas été lu. Sources : https://docs.upbit.com/kr/page/upbit_developer_sdk_license.md et https://raw.githubusercontent.com/upbit-official/upbit-strategy-toolkit/main/LICENSE.md

### Catalogue vérifié par les agents

| Source | Dans AXIOM | Verdict | Accès | Licence (affichage public) | Idées |
|---|---|---|---|---|---|
| Binance spot (api.binance.com klines 1m/1s/1d, taker buy k[9]) | oui | — | — | — | SUG-1, SUG-2, SUG-3, SUG-4, SUG-5, SUG-6, SUG-7, SUG-8, SUG-9, SUG-10, SUG-12, SUG-24, SUG-35, SUG-38, SUG-41, SUG-42 |
| Binance USDⓈ-M (fapi klines colonnes 5 et 9) | oui | — | — | — | SUG-3, SUG-10, SUG-12 |
| Binance COIN-M dapi/v1/continuousKlines | oui | — | — | — | SUG-18 |
| data.binance.vision futures/um/daily/metrics | oui | utilisable_avec_reserve | gratuit_sans_cle | CGU de binance-public-data (TERMS_AND_CONDITIONS.md), avec les clauses suivantes : - licence CC BY-NC-SA 4.0 (cl. 3.1) ; - usages non commerciaux admis, dont les « non-monetized open educational projects » et le backt… | SUG-14 |
| data.binance.vision futures/um/daily/bookDepth | oui | utilisable_avec_reserve | gratuit_sans_cle | CGU « Binance Vision Dataset Terms » v1.0, datées du 2026-08-26 (fichier ajouté le 2026-09-30, retouché le 2026-10-16). Licence CC BY-NC-SA 4.0. Usage commercial exclu. Autorisés : recherche personnelle non productive… | SUG-13 |
| data.binance.vision aggTrades futures/um et klines 1s | oui | utilisable_avec_reserve | gratuit_sans_cle | Mêmes CGU v1.0, licence CC BY-NC-SA 4.0. Le replay ne fonctionne qu'avec le daemon local et est indisponible sur Vercel (apps/web/src/components/ReplayWindow.tsx:40-50). Un usage local relève clairement de la « recher… | SUG-3 |
| Bybit V5 (account-ratio, tickers linear tous symboles, tickers option) | oui | — | — | — | SUG-15, SUG-19, SUG-23 |
| OKX V5 Rubik (taker-volume, margin loan-ratio, long-short-account-ratio, statistiques d'options) | oui | — | — | — | SUG-11, SUG-19, SUG-22 |
| Hyperliquid /info (predictedFundings, perpsAtOpenInterestCap, metaAndAssetCtxs, clearinghouseState) | oui | utilisable_avec_reserve | gratuit_sans_cle | Non vérifié : les conditions d'utilisation de hyperliquid.xyz n'ont pas pu être consultées (budget WebSearch épuisé, GitBook inaccessible). Le SDK officiel est sous licence MIT (LICENSE.md, Hyperliquid Labs 2024), mai… | SUG-15, SUG-17 |
| Coinalyze | oui | utilisable_avec_reserve | cle_gratuite | Non vérifié en ligne aujourd'hui. Relevé du 2026-06-26 : aucune clause « usage personnel » publiée et pas d'offre payante publique (docs/research/01-fournisseurs-api-indicateurs.md:13). AXIOM affiche déjà les données … | SUG-5, SUG-11, SUG-16 |
| Deribit API publique v2 | oui | — | — | — | SUG-7, SUG-20, SUG-21, SUG-22, SUG-23, SUG-24, SUG-40 |
| CBOE delayed quotes (IBIT, ETHA) | oui | — | — | — | SUG-21 |
| Binance Options eapi | **non** | — | — | — | SUG-23 |
| Coin Metrics Community API v4 | oui | utilisable_avec_reserve | gratuit_sans_cle | L'archive officielle déclare « Data is made available under the CC BY-NC 4.0 license » et précise qu'elle est « produced using free Community tier of Coin Metrics API » (coinmetrics/data README.md et LICENSE). Je n'ai… | SUG-17, SUG-26, SUG-27, SUG-28, SUG-30 |
| BGeometrics | oui | — | — | — | SUG-25, SUG-26, SUG-29 |
| Bitview (Bitcoin Research Kit hébergé) | **non** | non_verifie | inconnu | Non vérifié : ni CGU, ni licence des données servies, ni attribution exigée. La licence du code open source ne couvre pas forcément le service hébergé. Vérification nécessaire avant tout affichage sur le déploiement V… | SUG-29 |
| mempool.space | oui | utilisable_avec_reserve | gratuit_sans_cle | CGU de l'API publique non vérifiées en ligne. Faits du dépôt : la source est déjà affichée sur le déploiement public avec une mention de source, dans Mineurs.tsx:102, MineWindow.tsx:345 et OnchainWindow.tsx:654. Avant… | SUG-28 |
| Blockchain.com Charts | oui | — | — | — | SUG-28 |
| DefiLlama (stablecoins, fees, revenus de chaîne) | oui | utilisable_avec_reserve | gratuit_sans_cle | Non vérifié. Les conditions d'utilisation de defillama.com sont injoignables depuis la session et le dépôt api-docs ne contient aucune clause sur les données : sa licence MIT couvre le code de la documentation (un for… | SUG-30, SUG-31, SUG-33 |
| ValidatorQueue (GitHub raw) | oui | — | — | — | SUG-30 |
| Etherscan v2 getLogs | oui | utilisable_avec_reserve | cle_gratuite | Non vérifié. Les conditions de l'API (etherscan.io/apiterms) n'ont pas pu être consultées. De mémoire, elles demandent une attribution « Powered by Etherscan.io APIs » et limitent la redistribution, mais ce point est … | SUG-31 |
| RPC Ethereum PublicNode et Aave v3 GraphQL | **non** | — | — | — | SUG-32 |
| Solana RPC PublicNode (getTokenLargestAccounts) | oui | — | — | — | SUG-33 |
| Ethplorer API | **non** | utilisable_avec_reserve | cle_gratuite | Wiki officiel : « The API service is free, but you are required to place references to the Ethplorer API on your website », ou à défaut des liens directs vers les pages Ethplorer. Utiliser les API vaut acceptation des… | SUG-33 |
| CoinGecko Demo (market_chart, endpoints on-chain) | oui | — | — | — | SUG-17, SUG-33 |
| GeckoTerminal API publique (repli) | **non** | — | — | — | SUG-33 |
| growthepie API | **non** | — | — | — | SUG-34 |
| Coinbase Advanced Trade et Kraken | oui | — | — | — | SUG-35 |
| SoSoValue | oui | — | — | — | SUG-35, SUG-36 |
| CFTC Public Reporting (TFF) | oui | — | — | — | SUG-18 |
| Bitfinex API v2 publique | **non** | — | — | — | SUG-37 |
| Upbit Open API (cotation) | **non** | — | — | — | SUG-38 |
| FRED | oui | — | — | — | SUG-38, SUG-40, SUG-43 |
| Twelve Data | oui | utilisable_avec_reserve | freemium | Non vérifié : les conditions et la page des tarifs n'ont pas pu être lues (WebFetch refusé, plus de WebSearch disponible). Risque concret : le message d'erreur cite des offres « Grow » et « Venture », ce qui suggère u… | SUG-38, SUG-43 |
| BCE data-api et API BOJ | oui | utilisable_avec_reserve | gratuit_sans_cle | BCE : conditions de réutilisation non vérifiées dans cette session ; afficher « Source : BCE » par prudence. BOJ : d'après le README du client boj-api, un service qui utilise l'API doit afficher : « このサービスは、日本銀行時系列統計デ… | SUG-43 |
| Wikimedia REST API pageviews | **non** | — | — | — | SUG-39 |
| Polymarket Gamma et CLOB | **non** | — | — | — | SUG-40 |
| Kalshi API de données de marché | **non** | — | — | — | SUG-40 |
| ForexFactory (calendrier éco) | oui | — | — | — | SUG-2 |
| Bitview /api/urpd et séries cointime (compléments à l'entrée Bitview du catalogue) | **non** | — | — | — | SUG-C6 |
| BitcoinURPD.com (dépôt RenshuBTC/URPD-History) | **non** | utilisable_avec_reserve | gratuit_sans_cle | Le code est sous licence MIT. Selon terms.html, « The data belongs to its providers » ; aucune règle explicite sur la réutilisation ou l'intégration des graphiques, aucune attribution exigée. Le site remercie BRK (@_n… | SUG-C6 |
| data.binance.vision futures/um/daily : premiumIndexKlines, indexPriceKlines, markPriceKlines, bookTicker, trades | oui | — | — | — | SUG-C3, SUG-C5 |
| data.binance.vision option/daily/BVOLIndex | **non** | — | — | — | SUG-C7 |
| Dune Analytics API | **non** | non_verifie | freemium | Non vérifié. docs.dune.com et dune.com sont injoignables depuis la session et le budget WebSearch était épuisé. Les CGU sur l'affichage public, l'attribution exigée et la réutilisation des requêtes communautaires écri… |  |
| Tardis.dev, échantillons historiques gratuits | **non** | — | — | — | SUG-C1 |

## Pistes écartées à la fusion

- **FLX-8** : mNAV de Strategy et marqueurs 8-K : question de trading indirecte, effectif faible (étude seulement descriptive), historique des avoirs inexistant tant qu'une archive n'est pas accumulée, couverture MSTR par Twelve Data et chemin XBRL non vérifiés, définition simplifiée divergente de celle de Strategy. À reconsidérer après l'archive de SUG-36.
- **OPT-3 (volet Volmex) et OPT-7 (volet Volmex SVIV/XVIV)** : Nouveau fournisseur sans nécessité : les chaînes Deribit et Bybit couvrent le besoin ; offre gratuite, profondeur et CGU non vérifiées.
- **DER-8 (volet base et OI CME quotidiens)** : Aucune source gratuite trouvée ; seul le COT hebdomadaire est disponible (repris dans SUG-18).
- **FLX-6 (volet Google Trends)** : Aucune API publique gratuite vérifiée ; scraping fragile.
- **ETH-7 (volet DexScreener)** : CGU interdisant un produit concurrent, limites dépendantes du plan.
- **ETH-4 (volet Tokenomist, CryptoRank, DefiLlama emissions)** : Calendriers d'unlocks payants ou gratuits trop limités ; l'import de calendrier sourcé existant (apps/web/src/data/onchain/defillamaPro.ts:206) reste la voie.
- **ETH-8 (volet L2BEAT)** : JSON non officiel, CGU introuvables ; growthepie (CC BY 4.0) retenu.
- **BTC-6 (volet Glassnode API)** : Aucun plan API gratuit selon des agrégateurs (environ 49 à 999 $/mois), hors budget de 0 à 30 $/mois.
- **ETH-3 (voie DefiLlama Yields)** : Statut gratuit ou Pro non tranché et taux d'emprunt (poolsBorrow) réservés au Pro ; voie RPC ou GraphQL Aave préférée.
- **FLX-9 (volet historique complet du Fear & Greed)** : Gain marginal et profondeur d'alternative.me non vérifiée ; hors de la question levier contre comptant.
- **AT-4 (volets BOS/CHoCH, FVG, auto-Fibonacci)** : BOS/CHoCH et FVG écartés sur preuve le 2026-09-14 (docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11) ; auto-Fibonacci sans preuve trouvée.
- **BTC-4 (volets pools, Lightning, frais du mempool, flux des mineurs CM)** : Valeur de trading non démontrée ; disponibilité de FlowMinerOut1HopAllNtv et SplyMiner1HopAllNtv en community non sondée.

## Manques relevés par la critique de complétude

- Types de prix et barres non temporelles (Renko, range, Line Break, Point & Figure, Heikin Ashi en bougie, types natifs ohlc/area/candle_stroke) : signalés dans les trous de l'inventaire, repris par aucune des 43. grep renko|kagi|line.?break|rangeBar ne renvoie rien (Heikin Ashi existe seulement en indicateur, packages/indicators/src/trend/heikinAshi.ts) ; persist.ts:237 fige chartType à « candle_solid ». Voir SUG-C1.
- Outils de dessin standard (fourches d'Andrews/Schiff, extension de Fibonacci à 3 points, Fibonacci temporel, éventail et canal, étiquettes d'Elliott, XABCD, texte et flèches) : trou de l'inventaire, non repris. DrawingToolId compte 17 entrées (apps/web/src/chart/drawing.ts:44-61) ; fibTrend ne prend que 2 points (totalStep 3, apps/web/src/chart/fibonacci.ts:332). Voir SUG-C2.
- Indicateur appliqué à un indicateur ou à une série aux (RSI du CVD, z-score de l'OI, Bollinger sur un funding notionnel) : trou de l'inventaire, non repris. buildCalcContext n'accepte que des clés de prix (packages/indicators/src/engine.ts:25-60). Voir SUG-C3.
- Screener à critères ouverts : les 43 ajoutent des champs de flux (SUG-12) et de force relative (SUG-6), mais n'ouvrent ni le registre, ni des critères d'évènement (croisement, sortie de squeeze, divergence apparue), ni une concordance multi-unité. INDICATOR_FIELDS est curé (apps/web/src/data/screener.ts:290) et un run porte sur une seule unité. Voir SUG-C4.
- Aucun outil pour mesurer le pouvoir prédictif d'un indicateur continu (déciles, IC de rang) : validationSignaux ne traite que des évènements discrets (apps/web/src/data/validationSignaux.ts:34-60, 187). Le doc 02 qualifie des signaux de « faibles en isolé » sans mesure (docs/research/02-indicateurs-edge-crypto.md:190). Voir SUG-C5.
- URPD (répartition de l'offre par prix de dernier mouvement) et prix cointime (True Market Mean, prix cointime, prix « vaulted ») : trous on-chain de l'inventaire, non repris (SUG-29 vise l'offre LTH et le CDD). grep urpd|cointime|true.?market.?mean ne renvoie rien. Voir SUG-C6.
- Planification probabiliste d'un trade : l'outil position calcule R:R et taille (apps/web/src/chart/position.ts:54-105) sans probabilité de toucher la cible avant le stop ni espérance en R. Voir SUG-C7.
- ΔOI d'options par strike sur 24 h et 7 j : trou de l'inventaire. SUG-20 ne garde que des agrégats, SUG-22 des flux de trades ; grep ne trouve aucune variation d'OI par strike. Voir SUG-C8.
- Gap CME du week-end : absent (grep cme.?gap ne renvoie rien), outil courant chez les swing traders BTC. Pas d'idée : je me souviens d'une annonce de CME (2025) de passage des futures crypto au 24/7 début 2026, mais je n'ai pas pu la vérifier ici (budget de recherche épuisé). Si ce passage a eu lieu, les gaps ne se forment plus ; à trancher avant tout travail.
- Liquidations Binance historiques, piste close : data/futures/um/daily ne contient que 9 jeux sans liquidationSnapshot (listage S3 de data.binance.vision, vérifié). Le jeu COIN-M liquidationSnapshot existe pour 118 contrats, mais aucun fichier BTCUSD_PERP après le 2025-01-01 (vérifié).
- Historique d'options Binance inutilisable : data/option/daily/EOHSummary (BNB, BTC, DOGE, ETH, XRP) s'arrête au 2023-10-23 (vérifié). Seul BVOLIndex reste alimenté (fichiers BTCBVOLUSDT jusqu'au moins le 2026-05-21, listage tronqué).
- Calendrier d'unlocks gratuit : la seule voie reste DefiLlama Pro (payant) ou l'import manuel d'un calendrier sourcé (apps/web/src/components/DefillamaProPanel.tsx:27, docs/guides/calendriers-unlocks.md). Aucune source gratuite vérifiée dans cette session.
- Liquidations DeFi par niveau de prix (Aave, Compound, Maker) : trou de l'inventaire des sources, non repris. Le sondage d'une source n'a pas pu être fait (non vérifié).
- Sessions crypto Asie/Londres/New York, plage du lundi, initial balance hors TPO : absentes. L'opening range NY a été écartée sur preuve (docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11) ; à ne rouvrir qu'après la mesure de SUG-8.
- Carnet perp et carnets multi-places côte à côte, murs retirés, icebergs : absents (DOM sur Binance spot seul, apps/web/src/data/depth.ts:226). Non retenu : usage plutôt intraday que swing.
- Places perp au-delà des 4 actuelles (Deribit perp, BitMEX, Bitget) via le catalogue Coinalyze future-markets : trou de l'inventaire, repris par aucune des 43 (SUG-16 reste limité à 4 places).
- Cohortes par montant : BRK définit 15 tranches, de 0 sat à plus de 100 k BTC (crates/bitview_cohort/src/amount_range.rs du dépôt bitcoinresearchkit/mono, vérifié), probablement par UTXO. Sans regroupement par entité, la lecture « baleines » serait trompeuse : pas d'idée.
- Congestion du mempool, pools de minage, Lightning : absents, faible valeur pour un swing.
- Vérification limitée : le budget WebSearch du tour était épuisé, et community-api.coinmetrics.io, docs.tardis.dev et docs.dune.com sont injoignables par WebFetch (à autoriser dans le réseau de la session). Les faits nouveaux viennent du listage S3 de data.binance.vision et d'une recherche de code GitHub (gh search) dans bitcoinresearchkit/mono. Dune et Tardis restent non vérifiés.

## Détail des idées (par score décroissant)

### 1. SUG-6 — Force relative contre BTC/ETH : indicateur RS Mansfield et alpha résiduel, champ EQS et graphe de rotation ouvert (alts et secteurs)

**Score 16/20** · valeur 4 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : quantitatif · origines : AT-5, QNT-1, QNT-2

**Question de trading.** Quels alts et secteurs prennent le leadership contre BTC, lesquels s'essoufflent, et quelle part de leur hausse n'est que du bêta BTC ?

**Proposition retenue après vérification.** Pas de def « forceRelative » : le Mansfield s'obtient avec disparity(n) sur le ratio X÷BTC, à proposer en préréglage documenté. À faire : (1) une sortie « alpha résiduel cumulé » dans betaRef ; (2) un champ EQS « RS vs réf. », Mansfield sur 52 semaines et spreadZScore, avec refClose chargé une fois par run et passé à computeIndicator ; (3) un onglet « Rotation » dans CORR : RS-Ratio/RS-Momentum en z-scores, 4 quadrants, traîne de 8 points, sur le cache de séries de corr.ts (MAX_JOURS ≈ 400), univers watchlist ou top 50 figé, secteurs dans un second temps. Libellé « descriptif » jusqu'à l'étude figée sur au moins 40 alts.

**Proposition initiale.** (1) Indicateur TS pur forceRelative (pane, aux refClose) : Mansfield = 100·(rs/SMA(rs,n) − 1), pente, rang percentile, alpha résiduel cumulé Σ(r − β·r_réf) avec β glissant 90 j. (2) Champ EQS « RS Mansfield vs BTC » : le worker charge une fois BTCUSDT et passe ctx.aux.refClose. (3) Onglet « Rotation » (CORR ou SECT) : nuage RS-Ratio/RS-Momentum en z-scores, 4 quadrants, traîne de 8-10 points, univers top 50, watchlist ou 10 secteurs équipondérés ; libellé « approximation ouverte, pas le RRG® JdK » ; clic = graphe X/BTC.

**Ce qui existe déjà.** Le Mansfield sur le graphe existe déjà par composition. Le ratio X÷BTC se trace (apps/web/src/data/ratio.ts:1-35 ; DENOMINATEURS_CRYPTO, ratio.ts:31). disparity calcule exactement 100·(src − SMA)/SMA (packages/indicators/src/momentum/disparity.ts:4-5, 22-33). Posé sur ce ratio, il donne donc 100·(rs/SMA(rs,n) − 1), soit le Mansfield. spreadZScore donne déjà un RS normalisé : le z-score du log-ratio contre refClose (packages/indicators/src/statistical/spreadZScore.ts:1-20). betaRef donne le bêta glissant (packages/indicators/src/statistical/betaRef.ts:1-28). Seul l'alpha résiduel cumulé est absent. EQS : 5 champs, aucun relatif (apps/web/src/data/screener.ts:291). Le worker appelle computeIndicator(def, candles, params) sans aux (apps/web/src/workers/screener.worker.ts:107), alors que le moteur accepte aux (packages/indicators/src/engine.ts:116-121). Aucun graphe de rotation : grep rrg|mansfield|quadrant ne trouve que les quadrants macro et RotationChaines, qui porte sur les chaînes on-chain. Correction : BREADTH ne garde pas les clôtures horodatées, il ne met en cache que le résumé (apps/web/src/data/breadth.ts:192-232). Le cache réutilisable est celui de CORR, en session et horodaté (apps/web/src/data/corr.ts:656-695 ; MAX_JOURS = 260, corr.ts:36). SECT ne publie que des perfs absolues 24 h/7 j/30 j pondérées par la capitalisation CoinGecko (apps/web/src/data/secteurs.ts:282-340).

**Réutilise.** refClose et refSymbol (apps/web/src/chart/auxProvider.ts:466), betaRef, clôtures 1d de BREADTH (apps/web/src/data/breadth.ts:218) et de CORR (apps/web/src/data/corr.ts:205-257), SECTEURS[].paireBinance (apps/web/src/data/secteurs.ts:49), ratio.ts.

**Point d'intégration.** (1) Ajouter une sortie « alpha résiduel cumulé » Σ(r − β·r_réf) à betaRef, plutôt qu'un nouveau def. (2) Champ EQS : le worker charge refSymbol une fois par run, l'aligne avec alignAux (packages/indicators/src/utils-aux.ts:37) et le passe à computeIndicator. IndicatorFieldSpec gagne un indicateur « nécessite refClose ». (3) Rotation : module pur apps/web/src/data/rotationRelative.ts, nourri par cacheSeries de corr.ts avec MAX_JOURS porté à environ 400. Onglet dans CorrWindow ; clic = navigation vers le ratio X÷BTC (ratio.ts).

**Sources.**

- Binance spot klines 1d (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Clôtures déjà chargées par BREADTH/CORR ; KLINE_LIMIT à porter de 210 à ~400 pour le z sur 52 semaines (apps/web/src/data/breadth.ts:68).

**Contrat.** Le catalogue ne grossit pas si l'alpha devient une sortie de betaRef (un nouveau def forceRelative ferait doublon avec disparity sur le ratio et spreadZScore, ce qui va contre BUILD-CONTRACT.md:82). L'onglet Rotation et le champ EQS sont de nouvelles surfaces : exception G100 (BUILD-CONTRACT.md:71). Aucun fournisseur nouveau : klines spot Binance publiques, déjà utilisées. Chargement initial quasi neutre : CORR et EQS sont chargés à la demande, et la sortie ajoutée à betaRef pèse quelques dizaines d'octets dans le chunk indicators. Intégrer un filtre RS dans AXIS exige une v6 figée puis testée (scripts/axis/).

**Risques.** 1) Biais du survivant : l'univers « top 50 actuel » réécrit le passé. Il faut figer l'univers à la date de début de l'étude. 2) Alts récemment listés (moins de 400 jours) : pas de z sur 52 semaines, ce qui crée des trous dans le nuage. 3) Le bêta glissant sur 90 jours est instable et se casse aux changements de régime. 4) Le RS-Momentum en z-scores est en retard et fait des allers-retours (whipsaw). 5) Charge : SECT équipondéré ≈ 150 paires, donc 150 requêtes Binance par recalcul. Throttle et cache de session nécessaires. Porter MAX_JOURS à 400 alourdit aussi CORR. 6) Libellé « approximation ouverte, pas le RRG® » : la marque déposée et le caractère non publié de la méthode JdK sont non vérifiés en ligne (budget de recherche épuisé). 7) L'effet momentum en coupe crypto n'est pas reproduit en interne : libellé « descriptif » tant que l'étude figée n'est pas faite.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La question de trading (quels alts mènent contre BTC) est bonne et revient souvent pour un trader d'alts swing. Mais l'indicateur Mansfield existe déjà de fait (÷BTC + disparity) : un préréglage suffit, sans nouvelle définition au catalogue. La valeur réelle est la coupe transversale (champ EQS + vue de rotation). C'est aussi la partie la plus exposée au biais du survivant. La littérature sur le momentum crypto en coupe est contradictoire (non vérifiée en ligne ici). À livrer avec le libellé « descriptif » tant que l'étude sur univers daté n'est pas passée.

**Références.**

- Liu Y., Tsyvinski A., Wu X. (2022), « Common Risk Factors in Cryptocurrency », Journal of Finance 77(2) : facteurs marché, taille et momentum en coupe transversale. NON VÉRIFIÉ en ligne dans cette passe (budget WebSearch épuisé).
- Grobys K., Sapkota N. (2019), « Cryptocurrencies and momentum », Economics Letters. De mémoire, pas de momentum en coupe significatif sur environ 140 cryptos. NON VÉRIFIÉ. C'est un résultat contraire à garder en tête.
- Dobrynskaya V. (2023), « Cryptocurrency Momentum and Reversal », Journal of Alternative Investments : de mémoire, momentum à 2-4 semaines puis retournement. NON VÉRIFIÉ.
- Mansfield RS, popularisé par S. Weinstein (1988) : pratique de traders, sans étude contrôlée connue. NON VÉRIFIÉ.
- RRG® / JdK RS-Ratio et RS-Momentum (J. de Kempenaer) : formules non publiées et marque déposée, de mémoire. NON VÉRIFIÉ. D'où la nécessité du libellé « approximation ouverte ».
- Interne : packages/indicators/src/strategy/stratAxis.ts:174-198. Les cellules partagent un même facteur BTC et le filtre btc-ema100 a été jugé favorable en v5. La ligne 191 donne un achat-conservation médian à −96 % sur le pool d'alts.
- Interne : apps/web/src/data/ratio.ts:1-12 (toggle ÷BTC, AT sur le ratio par le moteur SYN) ; packages/indicators/src/momentum/disparity.ts:4-5 ; packages/indicators/src/statistical/betaRef.ts:1-8 ; apps/web/src/data/breadth.ts:60 et :259 (top 50 par volume actuel).

**Redondance.** Forte pour l'indicateur, nulle pour la coupe transversale. Le toggle « ÷BTC » trace déjà X/BTC et l'analyse technique s'y applique (apps/web/src/data/ratio.ts:1-12). `disparity`, défini comme 100·(src − SMA)/SMA (packages/indicators/src/momentum/disparity.ts:4-5), appliqué à ce ratio avec n ≈ 250 j EST le Mansfield RS. betaRef fournit déjà le β glissant, et compare.ts:176 la base 100. Seul l'alpha résiduel cumulé est nouveau côté indicateur. Sans équivalent : un champ EQS relatif (apps/web/src/data/screener.ts:291-331 ne propose que RSI, MACD, EMA, ADX et BBW ; le worker ne passe aucune série auxiliaire, apps/web/src/workers/screener.worker.ts:107) et une vue de rotation des alts. grep rrg|mansfield ne renvoie rien. RotationChaines.tsx porte sur 4 chaînes on-chain, pas sur les alts.

**Pièges.** Biais du survivant et univers choisi après coup : BREADTH prend le top 50 par volume ACTUEL (breadth.ts:259) et SECTEURS est une liste curée d'aujourd'hui (secteurs.ts:49). Une étude historique sur cet univers surestime le leadership, car les perdants délistés en sont absents. Le pool AXIS est à −96 % médian (stratAxis.ts:191) : le retard est la norme. RS ≈ bêta : quand BTC monte, les alts à β > 1 « mènent » mécaniquement, donc le RS brut confond leadership et levier. L'alpha résiduel corrige en partie seulement : le β glissant 90 j est bruité, et estimer β et alpha sur la même fenêtre les biaise. RRG ouvert : les z-scores sur fenêtre glissante et la composante momentum lissée (une dérivée du ratio) font tourner la traîne même sur du bruit. Cette rotation est un artefact de lissage (critique connue, non vérifiée ici). Données d'une seule place (Binance spot USDT) ; des secteurs équipondérés sont dominés par les petites capitalisations volatiles. Passer KLINE_LIMIT de 210 à 400 double le poids des réponses BREADTH et CORR. Dans le worker EQS, les clôtures doivent être alignées par jour UTC (alignerSeries, apps/web/src/data/corr.ts:205).

**Protocole de validation.** (a) Test de construction : pour X = BTC × c, Mansfield et alpha valent 0 et le point reste au centre. (b) Étude en coupe pré-enregistrée sur un univers défini à chaque date. On retient les paires cotées à t, délistées comprises (listes data.binance.vision, ou KuCoin comme pour AXIS v5), pas le top 50 actuel. Classer en quintiles de RS et d'alpha à t, mesurer le rendement relatif à BTC à 7 et 30 j, avec rebalancement hebdomadaire non chevauchant. Geler sur la période ≤ 2024 et tester sur 2025-2026. Critères : écart Q5 − Q1 > 0 après coûts, de même signe dans les deux moitiés. Comparer aussi au momentum absolu 30 j et au seul β : si le RS n'apporte rien au-delà, libellé « descriptif ». (c) Rotation : vérifier si le passage du quadrant Retard au quadrant Amélioration prédit le rendement relatif à 7/30 j mieux qu'un placebo sur séries permutées. Sinon, libellé descriptif. (d) Toute intégration à AXIS passe par une v6 figée puis testée (scripts/axis/).

**Preuve d'intérêt (idéation).** Facteurs marché, taille et momentum en coupe crypto (Liu, Tsyvinski, Wu, JF 2022, cité). Interne : les cellules AXIS partagent un facteur BTC (packages/indicators/src/strategy/stratAxis.ts:178-200) ; le filtre de régime BTC a amélioré la v5 (docs/axis-2026-10-07.md:880-905).

**Mesure de succès.** Test : un actif = BTC×1 a un alpha nul et reste au centre. Étude figée sur ≥ 40 alts jamais vues : écart de rendement relatif à 7/30 j entre quintiles RS extrêmes et entrées Leader/Retard, signe stable dans les deux moitiés, sinon libellé « descriptif ».

**Fichiers à toucher.**

- packages/indicators/src/statistical/betaRef.ts
- packages/indicators/src/statistical/betaRef.test.ts
- apps/web/src/data/screener.ts
- apps/web/src/workers/screener.worker.ts
- apps/web/src/data/rotationRelative.ts
- apps/web/src/data/rotationRelative.test.ts
- apps/web/src/data/corr.ts
- apps/web/src/components/CorrWindow.tsx
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (4) : Choisir les alts sur leur force relative contre BTC est central pour un trader BTC et alts. betaRef et disparity existent, mais pas de vue de rotation transversale ni de champ RS dans EQS : les champs indicateurs se limitent à RSI, EMA et MACD (apps/web/src/data/screener.ts:290). L'alpha résiduel répond directement à la question « est-ce seulement du bêta BTC ? ». Restent descriptifs : le biais du survivant et les allers-retours du RRG.
- cout-risque (4) : Klines spot Binance publiques, déjà utilisées, et cache corr.ts réutilisé. CORR et EQS sont paresseux : impact initial quasi nul. Le principal risque est le biais du survivant (top 50 actuel, breadth.ts) ; il est contenu par le libellé « descriptif » et un univers figé. Coût modéré.
- coherence (4) : Bonne réutilisation : alpha en sortie de betaRef (statistical/betaRef.ts), Mansfield en préréglage de disparity, onglet Rotation dans les Onglets de CORR (CorrWindow.tsx:156) sur le cache corr.ts. Point neuf : refClose doit être injecté dans le worker EQS pour le champ RS.

### 2. SUG-7 — Volatilité attendue contre réalisée pour tous les actifs : bandes HAR-RV calibrées, amplitude consommée, et DVOL/VRP/corrélation spot-vol en séries graphe

**Score 16/20** · valeur 5 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-6, OPT-2

**Question de trading.** Quelle amplitude est raisonnable aujourd'hui et cette semaine sur SOL ou un alt sans options, quelle part est consommée, et la vol implicite BTC/ETH est-elle chère face au réalisé ?

**Proposition retenue après vérification.** (1) Source de niveaux « Bandes RV » pour tout actif : prévision HAR-RV (Corsi) sur Garman-Klass 1d, réestimée en glissant sur au moins 500 jours avec un chargeur 1d dédié (pas le cache de 100 jours). Bandes ±1σ/±2σ jour et semaine ancrées comme les bandes implicites, couverture hors échantillon dans l'infobulle, bouton dans DIST. (2) Étiquette « amplitude consommée » (H − L depuis l'ancre / attendue). (3) Règle Shift : Δ en ATR(14) et en σ de l'horizon. (4) DVOL sur le graphe : un seul def « Prime de vol » (sorties DVOL, VRP = DVOL − RV30, percentile) sur un aux dvol quotidien réhorodaté à l'instant connu, BTC et ETH seulement. Pas de 3600 ni de spotVolCorr tant que le plafond Deribit n'est pas vérifié.

**Proposition initiale.** (1) Prévision HAR (Corsi) de la variance journalière à partir de Garman-Klass 1d (ou somme des carrés 1h), réestimée en glissant ; bandes ±1σ/±2σ jour et semaine ancrées comme les bandes DVOL, libellées « (RV) », couverture hors échantillon affichée. (2) Étiquette « amplitude consommée » (H−L depuis l'ancre / attendue). (3) Règle Shift+glisser : Δ en ATR(14) et en σ de l'horizon. (4) BTC/ETH : aux dvol (get_volatility_index_data 3600, LOCF clôture) et indicateurs dvol (percentile), vrp = DVOL − RV(30 j), spotVolCorr ; TIMEFRAME_REQUIS ≥ 1h.

**Ce qui existe déjà.** L'amplitude implicite n'existe que pour BTC et ETH : bandes ±1σ/±2σ DVOL J et S (apps/web/src/chart/niveaux/bandesImplicites.ts:1-12, 37-42). Pour TOUS les actifs, il existe déjà des bandes réalisées non conditionnelles : les « Bandes VaR » de DIST (quantiles p5/p95 et p1/p99 à 20 bougies sur le graphe maître, apps/web/src/chart/distLignes.ts:1-25, bouton apps/web/src/components/DistWindow.tsx:170-185). VOL offre aussi un cône RV par horizon (apps/web/src/lib/volCone.ts:1-15) et la comparaison RV30/DVOL sur 1 an avec la tuile VRP (apps/web/src/components/VolWindow.tsx:1-8, 456-491). Le régime lit le percentile DVOL (apps/web/src/data/regime.ts:66-67). Absents : la prévision HAR, l'« amplitude consommée », l'ATR et le σ dans la règle (apps/web/src/chart/measureTool.ts:43-54), et toute AuxSeriesId d'IV (packages/types/src/index.ts:186-235). Correction : le cache 1d partagé avec les niveaux clés ne compte que 100 bougies (apps/web/src/chart/niveaux/bougiesJour.ts:15-16, 54). C'est insuffisant pour une régression HAR (composante 22 jours plus fenêtre d'estimation). VOL charge 730 jours (VolWindow.tsx:94).

**Réutilise.** Formule et ancres de bandesImplicites, composite de niveaux, estimateurs GK/YZ du registre, rv.ts (packages/indicators/src/volatility/rv.ts:33), fetchDvolHistory (apps/web/src/data/deribit.ts:347), calculerMesure.

**Point d'intégration.** Module pur apps/web/src/data/harRv.ts (Garman-Klass 1d, OLS sur RV_j, RV_s, RV_m, réestimée en glissant). Nouvelle clé « bandesRv » dans CleOverlayNiveaux et l'état (apps/web/src/chart/niveauxOverlays.ts:17-48), dans FABRIQUES et ORDRE_SOURCES (apps/web/src/chart/niveaux/composite.ts:24-33), bouton dans DistWindow à côté des bandes implicites (DistWindow.tsx:177-184), persistance (apps/web/src/store/persist.ts:444, 474, 536). Chargeur 1d dédié et plus profond (≥ 500 jours, pagination selon la source). Règle : calculerMesure reçoit ATR(14) et σ de l'horizon. DVOL sur le graphe : AuxSeriesId « dvol », un case dans auxProvider avec fetchDvolHistory (apps/web/src/data/deribit.ts:347) réhorodaté à l'instant connu (+ la résolution, cf. dvolJour.ts:3-5), et un seul def volatilité.

**Sources.**

- Bougies 1d/1h des adaptateurs (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Cache 1d partagé avec les niveaux clés.
- Deribit get_volatility_index_data (DVOL) (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Déjà utilisé en 3600 et 86400 ; BTC et ETH seulement ; plafond de points par appel non vérifié ; CGU Deribit à usage personnel (vérifié dans l'idée brute).

**Contrat.** Nouveau bouton de niveaux et étiquettes de règle : exception G100 (BUILD-CONTRACT.md:71). L'aux dvol modifie @axiom/types (BUILD-CONTRACT.md:81) et ajoute au moins une définition (BUILD-CONTRACT.md:82). Limiter à un seul def plutôt que trois. Chargement initial : le module de niveaux est paresseux (composite.ts:1-6), mais le def entre dans le chunk indicators (marge de 4 030 o gzip, BUILD-CONTRACT.md:2038-2042). Aucun fournisseur nouveau : www.deribit.com est déjà sur la liste blanche (shared/extapi-hosts.ts:31) et passe par le proxy /extapi (deribit.ts:60-66). Aucune clé.

**Risques.** 1) Plafond de points de get_volatility_index_data par appel non vérifié (budget WebSearch épuisé, docs.deribit.com non résolu depuis la session). En résolution 3600, un buffer 4h de 1 500 bougies demande environ 6 000 points. Utiliser 86400 en LOCF de la clôture de la veille. 2) Look-ahead si la bougie DVOL, horodatée à son début, n'est pas réhorodatée. 3) Historique 1d court pour les alts récents, et pagination Coinbase/Kraken. 4) Bandes lues comme des bornes : libellé « amplitude statistique ». 5) Doublon visuel possible avec les Bandes VaR (DIST) : l'infobulle doit distinguer HAR conditionnel et quantiles non conditionnels. 6) CGU Deribit pour un affichage public non vérifiées ici. La mention « usage personnel » vient de l'idée brute et concerne déjà l'usage actuel (VOL, bandes implicites). 7) Références Bouri et al. et Almeida et al. non revérifiées en ligne.

**Intérêt analytique.** fort ; verdict utile_avec_reserve. Les bandes HAR pour tout actif sont la mesure la mieux fondée des quatre idées. La persistance de la volatilité est un des faits les plus robustes de l'économétrie financière, et HAR en est la référence simple (standard, non revérifié en ligne ici). Elles comblent un vrai manque : rien pour SOL et les alts sans options. Réserves de périmètre : la partie DVOL/VRP en séries graphe double VOL et le régime, et la règle ATR/σ relève de l'ergonomie. Corriger PRT-11 d'abord, pour ne pas afficher deux familles de bandes non hiérarchisées. Recommandation : livrer d'abord HAR + amplitude consommée ; n'ajouter l'aux dvol que si une alerte ou un backtest en a besoin.

**Références.**

- Corsi F. (2009), « A Simple Approximate Long-Memory Model of Realized Volatility », Journal of Financial Econometrics 7(2) : le modèle HAR-RV, référence standard. Non revérifié en ligne dans cette passe (budget WebSearch épuisé).
- Andersen T., Bollerslev T., Diebold F., Labys P. (2003), « Modeling and Forecasting Realized Volatility », Econometrica 71(2) : la variance réalisée est prévisible. Non revérifié en ligne.
- Patton A. (2011), « Volatility forecast comparison using imperfect volatility proxies », Journal of Econometrics 160 : QLIKE reste robuste quand le proxy de variance est bruité. Non revérifié en ligne.
- Bouri et al. (2020) et Nottingham eprints 57681 (HAR sur Bitcoin), cités par l'idée : NON VÉRIFIÉS dans cette passe.
- Almeida et al. (2024), arXiv 2410.15195 (prime de variance BTC) : NON VÉRIFIÉ, arxiv.org bloqué.
- Interne : apps/web/src/chart/niveaux/bandesImplicites.ts:7-10 : 78 % des clôtures dans ±1σ DVOL sur 998 j. Ces données sont déjà vues.
- Interne : apps/web/src/components/VolWindow.tsx:3 et :456-467 (RV30, DVOL et VRP déjà calculés et affichés sur 1 an) ; apps/web/src/data/regime.ts:66-67 (percentile DVOL sur 90 j) ; apps/web/src/chart/distLignes.ts:25 et :43 (bandes de quantiles empiriques déjà tracées) ; apps/web/src/data/deribit.ts:331 et :357 (résolutions 3600 et 86400).

**Redondance.** Partielle. Neuf : une prévision conditionnelle de la variance et des bandes pour tout actif. Aujourd'hui, les bandes implicites sont réservées à BTC et ETH, avec un toast pour les autres (bandesImplicites.ts:124), et grep HAR|Corsi ne renvoie rien. Redondant : (i) la VRP DVOL − RV30 est déjà calculée et affichée avec 1 an d'historique dans VOL (VolWindow.tsx:3, :456-467). Le percentile DVOL est déjà dans le régime (regime.ts:66-67). Les passer en séries graphe n'ajoute que l'alignement sur le chart et l'usage en alerte. (ii) DIST trace déjà des bandes empiriques p5/p95 et p1/p99 à 20 bougies sur le graphe (apps/web/src/chart/distLignes.ts:25-43, PRT-11). Elles ne sont pas conditionnelles, mais elles concurrencent visuellement les bandes HAR. (iii) Keltner, ATR, atrPct, GK, YZ, Parkinson et rv sont déjà au registre (packages/indicators/src/volatility/). La règle en ATR/σ est un confort sans contenu informatif propre.

**Pièges.** Calibration : des bandes ±kσ supposent une loi normale. Avec les queues épaisses de la crypto, ±1σ couvre souvent plus de 68 % et ±2σ moins de 95 %. Il faut calibrer k hors échantillon, sans le régler sur les données qui servent à afficher la couverture. Look-ahead : estimer HAR en glissant, strictement sur des jours clos. La prévision se fait à la clôture de la veille, et la bougie en cours (`closed:false`) est exclue, même piège que PRT-11. Proxy de variance : GK 1d est biaisé par les sauts, et la valeur dépend de la place choisie. La somme des carrés 1h est meilleure, mais exige une pagination de l'historique. Alts de moins d'un an : paramètres HAR instables. Mieux vaut refuser sous un minimum (par exemple 300 j) qu'extrapoler. DVOL : une seule plateforme (Deribit), BTC et ETH seulement. En LOCF horaire, il faut prendre la DVOL close au plus tard à la fin de la bougie ; une valeur datée à l'ouverture et lue sur une bougie 4h ouverte au même instant fuit d'une heure. Le plafond de points par appel n'est pas vérifié, d'où une pagination à prévoir. Les CGU Deribit sont données « vérifiées » par l'idée brute mais n'ont pas été revérifiées ici. La VRP DVOL − RV passée oppose une IV 30 j prospective à une RV rétrospective : c'est un proxy ex ante, pas la prime ex post, et il faut l'étiqueter. Contrat : TIMEFRAME_REQUIS est une égalité stricte (packages/indicators/src/timeframes.ts:8-17), lue aussi par les alertes (packages/alerts/src/engine.ts:107). Passer à « ≥ 1h » modifie le contrat commun graphe, alertes et BT.

**Protocole de validation.** (a) HAR : manifeste figé fixant le proxy (GK ou RV 1h), la fenêtre d'estimation glissante d'un an, les horizons 1 j et 7 j et k. Test hors échantillon sur au moins 20 actifs, sur la période postérieure au gel. Critères : perte QLIKE de HAR inférieure à celle de la RV30 naïve et d'un EWMA λ = 0,94 (référence plus exigeante), test Diebold-Mariano par actif, part d'actifs gagnants dans chaque moitié. Couverture : taux de clôtures dans ±1σ et ±2σ par actif, à moins de 5 points du nominal empirique. (b) Amplitude consommée : mesure descriptive, sans test, avec l'étiquette « pas une borne ». (c) VRP : event study sur BTC et ETH sur 2 ans (|rendement| à 7 j quand vrp < 0, contre vrp > p75), observations hebdomadaires non chevauchantes. Cela donne environ 100 observations, une puissance faible : annoncer l'IC. Ne pas réutiliser les 998 j de la recherche des bandes implicites pour régler k.

**Preuve d'intérêt (idéation).** HAR-RV supérieur à GARCH/ARFIMA sur Bitcoin (Bouri et al. 2020 ; Nottingham eprints 57681, cités). Interne : 78 % des clôtures dans ±1σ DVOL sur 998 j (bandesImplicites.ts:7-10), prime de vol à suivre dans le temps ; prime de variance BTC > S&P (Almeida et al. 2024, arXiv 2410.15195, cité).

**Mesure de succès.** QLIKE hors échantillon HAR < RV30 naïve sur ≥ 20 actifs ; couverture ±1σ à < 5 pts du nominal empirique ; event study BTC 4h sur 2 ans : |rendement| 7 j quand vrp < 0 contre vrp > p75, sinon « descriptif ».

**Fichiers à toucher.**

- apps/web/src/data/harRv.ts
- apps/web/src/data/harRv.test.ts
- apps/web/src/chart/niveaux/bandesRv.ts
- apps/web/src/chart/niveaux/bandesRv.test.ts
- apps/web/src/chart/niveaux/composite.ts
- apps/web/src/chart/niveauxOverlays.ts
- apps/web/src/store/persist.ts
- apps/web/src/components/DistWindow.tsx
- apps/web/src/chart/measureTool.ts
- packages/types/src/index.ts
- apps/web/src/chart/auxProvider.ts
- packages/indicators/src/volatility/primeVol.ts
- packages/indicators/src/volatility/primeVol.test.ts
- packages/indicators/src/registry.ts
- packages/indicators/src/registry.test.ts
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (5) : La volatilité est le seul domaine où la prévisibilité est robuste (clustering, HAR de Corsi). Les bandes implicites calibrées n'existent que pour BTC et ETH (apps/web/src/chart/niveaux/bandesImplicites.ts:1-10, couverture mesurée de 78 %). Les étendre aux alts sans options, avec la couverture hors échantillon et l'« amplitude consommée », règle la taille du stop et de la cible. Le volet DVOL/VRP est redondant : la VRP (IV − RV) existe déjà dans VOL (apps/web/src/components/VolWindow.tsx:2-3). À réduire aux bandes HAR.
- cout-risque (3) : Le chargeur 1d sur 500 j est bon marché. Mais il faut un nouvel AuxSeriesId et un def dans le chunk initial (BUILD-CONTRACT.md:81-82). Le plafond de points de get_volatility_index_data n'est pas vérifié (docs.deribit.com injoignable depuis la session). Look-ahead si DVOL n'est pas réhorodaté. Des bandes ±kσ supposées normales sont mal calibrées sur des queues épaisses : risque d'affichage trompeur à calibrer hors échantillon.
- coherence (3) : Les bandes HAR-RV se calquent sur chart/niveaux/bandesImplicites.ts. En revanche, le def « Prime de vol » fait doublon avec VOL, qui montre déjà RV30/DVOL/VRP (VolWindow.tsx:3), et ajoute un aux. Il faut aussi un chargeur 1d dédié de 500 j : trois mécanismes pour une idée.

### 3. SUG-41 — Largeur du marché historisée et saison des alts : % > MM50/MM200, nouveaux plus hauts/bas, ligne A/D et oscillateur, indice de saison des alts et dominance BTC hors stablecoins

**Score 16/20** · valeur 4 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : quantitatif · origines : QNT-3, QNT-4

**Question de trading.** La hausse de BTC est-elle confirmée par la participation de l'univers, sommes-nous en phase « BTC d'abord » ou en saison des alts, et une baisse de BTC.D n'est-elle qu'une fuite vers les stables ?

**Proposition retenue après vérification.** Phase 1, sans aux ni indicateur. Historiser BREADTH à partir des mêmes 50 requêtes (KLINE_LIMIT 400) et produire des séries pures : % > MM50 et MM200, solde des nouveaux plus hauts et plus bas sur 20 et 55 j, ligne A/D et oscillateur type McClellan. A/D et McClellan sont libellés « top 50 », distincts de l'A/D du jour sur l'univers complet. Ajouter la part des alts du top 50, hors BTC, stables et emballés, qui battent BTC sur 90 j (variante 30 j), dénominateur affiché. Sparklines dans SectionBreadth. Tuile CAP « BTC.D hors USDT/USDC/DAI » = BTC ÷ (TOTAL − stables), jambes CMC uniquement. Seules les séries dérivées sont mises en cache. L'aux largeurMm50 et l'indicateur graphique passent en phase 2, seulement si une étude figée montre un usage.

**Proposition initiale.** Garder les clôtures du top 50 de BREADTH (KLINE_LIMIT 400) et produire des séries pures : % > MM50 et MM200, solde nouveaux plus hauts − plus bas sur 20 et 55 j, ligne A/D, oscillateur type McClellan ; part des alts battant BTC sur 90 j (variante 30 j) avec seuils 75/25 présentés comme convention, biais du survivant affiché. BTC.D hors stables = BTC.D/(1 − STABLE.D/100), part des alts hors stables, jambes de même source CMC. Aux globale largeurMm50 (patron btcDominance), indicateur « Largeur du marché » avec divergences BTC/largeur, sparklines BRIEF, tuiles CAP.

**Ce qui existe déjà.** BREADTH est un instantané unique, sans historique. ResumBreadth contient seulement pctMm50Prec comme valeur précédente (apps/web/src/data/breadth.ts:40-53). KLINE_LIMIT vaut 210 (breadth.ts:68) et la bougie du jour est écartée (breadth.ts:218-233). Le cache localStorage dure 12 h (breadth.ts:57-58, :182-210). L'affichage se limite au BRIEF : deux jauges (apps/web/src/components/brief/SectionBreadth.tsx:30-31 ; apps/web/src/components/BriefWindow.tsx:233). L'A/D du jour est calculé sur l'univers USDT complet à partir du ticker, et non sur le top 50 (breadth.ts:16-17, :113-123). Seules trois paires stable/stable sont exclues (breadth.ts:85) : pas de WBTC ni d'USDe. Dominances : dominance() et dominanceAlts() (apps/web/src/data/mcap.ts:251-289). STABLE.D ne couvre que USDT+USDC+DAI (mcap.ts:66, :96-99). La série globale CMC fournit total et total2, donc la capitalisation BTC (apps/web/src/data/cmcMcap.ts:96-104). L'onglet Classement de MAP donne hausses, baisses et médiane de 1 h à 30 j, sans stables, sur le top N CoinGecko (apps/web/src/components/classementPerformances.util.ts:14-19, :72-80 ; ClassementPerformances.tsx:179). C'est un instantané, sans comparaison à BTC. L'indicateur adLine est l'ADL Chaikin d'un actif, pas une mesure de largeur (packages/indicators/src/volume/adLine.ts:18-41). « altseason » n'existe que comme mot-clé de recherche (apps/web/src/commands/windowPanels.ts:529). L'indicateur btcDominance lit l'aux BGeometrics, pas CMC (packages/indicators/src/momentum/btcDominance.ts:13-29 ; apps/web/src/chart/auxProvider.ts:560-565). Aucune trace de McClellan, de nouveaux plus hauts ou plus bas, ni de BTC.D hors stables (grep vide).

**Réutilise.** fetchCloturesJour, calculerAuDessusMm, filtrerUnivers (breadth.ts:96-242), STABLECOINS_EXCLUS/EMBALLES_EXCLUS (apps/web/src/data/corr.ts:101, :131), séries CMC (apps/web/src/data/cmcMcap.ts:5), utils-divergence (packages/indicators/src/utils-divergence.ts:61-88).

**Point d'intégration.** Fonctions pures ajoutées à breadth.ts, alimentées par les mêmes 50 requêtes klines. Passer KLINE_LIMIT de 210 à 400 garde une requête par symbole (Binance plafonne à 1 000, apps/web/src/data/netliq.ts:271-277). Nouveau module saisonAlts.ts, sparklines dans SectionBreadth et tuile CAP dans McapWindow. BTC.D hors stables = (TOTAL − TOTAL2) ÷ (TOTAL − capitalisation USDT+USDC+DAI), uniquement sur des jambes CMC. L'aux globale et l'indicateur graphique ne sont possibles qu'en phase 2 : ajout à AuxSeriesId (packages/types/src/index.ts:186-229), case auxProvider (patron auxProvider.ts:560) et entrée au registre.

**Sources.**

- Binance spot klines 1d (top 50) (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà appelé par BREADTH.
- CoinMarketCap data-api (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : TOTAL, TOTAL3 et capitalisations USDT/USDC/DAI déjà chargées ; endpoint non documenté, CGU non vérifiées.

**Contrat.** Exception G100 pour le nouveau contenu du BRIEF et de CAP. Aucun nouveau fournisseur, aucune clé, aucun hôte, aucune CSP : Binance et CMC sont déjà appelés. Le BRIEF reste chargé à la demande avec le même nombre de requêtes ; la charge initiale ne change pas. La phase 2 toucherait @axiom/types (BUILD-CONTRACT.md:81) et étendrait le catalogue (BUILD-CONTRACT.md:82) : à éviter en phase 1. Pour le cache, ne stocker que les séries dérivées, pas les 50 × 400 clôtures (environ 200 Ko), car le localStorage sature déjà (DATA-3 de docs/revue-2026-11-06.md).

**Risques.** 1) Biais du survivant et de sélection : le top 50 vient du volume 24 h d'aujourd'hui, et les alts récentes n'ont pas 90 ou 200 jours d'historique. Le dénominateur varie donc dans le temps : il faut l'afficher. 2) L'A/D historique serait calculé sur le top 50, l'A/D du jour sur l'univers complet (breadth.ts:16-17). Le critère « dernier point = instantané » est faux pour l'A/D : il faut deux libellés distincts. 3) Un McClellan sur 50 titres est bruité ; c'est une convention transposée. 4) Il faut exclure stables et jetons emballés. Les listes de corr.ts (apps/web/src/data/corr.ts:101, :131) portent sur des tickers de base CoinGecko et doivent être converties en paires Binance. 5) STABLE.D ne couvre que USDT, USDC et DAI : le libellé doit être « BTC.D hors USDT/USDC/DAI ». Ne jamais combiner le BTC.D de BGeometrics avec le STABLE.D de CMC. 6) Les prix ne viennent que de Binance : les alts absentes de Binance manquent. 7) Non vérifié : l'endpoint data-api de CMC n'est pas documenté et ses CGU pour un site public restent à lire. La définition et les seuils 75/25 de l'Altcoin Season Index de Blockchaincenter non plus (FRED et le web étaient inaccessibles, le budget de recherche est épuisé). 8) Les seuils 75/25 sont une convention, pas un signal.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Ce contexte manque au swing sur les alts et se calcule presque gratuitement à partir des données déjà chargées. Son intérêt prédictif en crypto n'est pas démontré : la preuve interne porte sur la tendance de BTC, pas sur la largeur. Version recommandée : 3 séries, univers point par point, réserve du survivant chiffrée. Étudier la saison des alts comme un contexte, pas comme un signal. Références externes non revérifiées : quota WebSearch épuisé, blockchaincenter.net et fred.stlouisfed.org bloqués.

**Références.**

- Interne : docs/axis-2026-10-07.md:880-893 (garde-fou BTC > EMA 100 : 23 % d'entrées refusées, expectancy 3,29 % → 4,58 %) ; preuve INDIRECTE, ce filtre est la tendance de BTC, pas la largeur
- Interne : docs/axis-2026-10-07.md:897-898 (EMA 200 seule p = 0,454, pas mieux que le hasard) : une moyenne mobile seule n'apporte rien sur ce pool
- McClellan Oscillator (Sherman et Marian McClellan, 1969), praticien, non revérifié en ligne
- Zweig Breadth Thrust (M. Zweig, « Winning on Wall Street », 1986), praticien, non revérifié en ligne
- Altcoin Season Index Blockchaincenter (75 % du top 50 bat BTC sur 90 j), convention : non vérifié, hôte www.blockchaincenter.net bloqué par le réseau de la session
- Aucune étude crypto sur le pouvoir prédictif de la largeur n'a pu être vérifiée : quota WebSearch épuisé (200 recherches par tour, partagées)

**Redondance.** Partielle. Instantané BREADTH déjà présent : % > MM50 et MM200, A/D du jour, une seule valeur précédente (apps/web/src/data/breadth.ts:40-53, KLINE_LIMIT = 210 à :68 et non 400). Dominance alts brute (apps/web/src/data/mcap.ts:275-276), STABLE.D (mcap.ts:70, :99), indicateur btcDominance (packages/indicators/src/momentum/btcDominance.ts:9, source bitcoin-data.com et non CMC). « altseason » n'est qu'un mot-clé de CAP (apps/web/src/commands/windowPanels.ts:529). L'historisation, l'indice de saison des alts et BTC.D hors stables sont donc nouveaux. En revanche, la ligne A/D, l'oscillateur McClellan et le solde des plus hauts et plus bas sur 50 titres sont quasi colinéaires avec % > MM50. Garder au plus 3 séries : % > MM50/MM200, part des alts battant BTC sur 90 j, BTC.D hors stables.

**Pièges.** 1) Biais du survivant et anticipation : l'univers est le top 50 par volume 24 h DU JOUR (apps/web/src/data/screener.ts:418-419). Les jetons qui viennent de monter y entrent : la fin de la série historisée est donc gonflée, et les jetons radiés sont absents. 2) Dénominateur mouvant : un jeton récent n'entre dans % > MM200 qu'après 200 clôtures, la composition dérive. 3) Profondeur : Binance plafonne à 1000 klines par appel (apps/web/src/data/netliq.ts:274). Avec 400 klines, on n'a qu'environ 200 jours de % > MM200, trop peu pour étudier les franchissements 75/25, rares (quelques-uns par cycle, n minuscule). 4) Plateforme unique : un actif absent du spot Binance est absent de l'univers. 5) BTC.D hors stables : STABLE.D ne couvre que USDT+USDC+DAI (mcap.ts:99), la part des stables est donc sous-estimée. Il faut les mêmes jambes CMC des deux côtés, sans mélanger avec bitcoin-data.com. L'endpoint CMC data-api est non documenté, CGU non vérifiées. 6) Recalcul : la bougie du jour est bien écartée (breadth.ts:64-67), mais tout cache doit stocker l'univers point par point pour ne pas réécrire le passé.

**Protocole de validation.** a) Univers point par point : chaque jour, top 50 sur le volume en quote moyen des 30 jours précédents, tiré des klines d'un univers large (top 150 actuel), sans utiliser le volume d'aujourd'hui. Publier la part du survivant restante. b) Figer dans un manifeste daté les définitions (seuils 75/25, divergence BTC au plus haut 55 j avec % > MM50 en baisse de 15 points sur 20 j) AVANT tout calcul de rendement. c) Étude d'évènements unique sur 2017-08→2026-11 : rendements de BTC et d'un panier d'alts équipondéré à 20 et 30 j contre le même nombre de dates tirées au hasard (décalage circulaire, 1999 tirages, comme le test de timing d'AXIS), dans les deux moitiés. Résultat publié même nul. d) Seule épreuve hors échantillon possible : un garde-fou de largeur ajouté à AXIS v5, testé sur un pool jamais vu (paires spot d'une autre plateforme), avec critères P1-P3 figés, ou le suivi en données postérieures au figeage.

**Preuve d'intérêt (idéation).** Breadth thrust de Zweig, McClellan, % > MM200 : pratique reconnue sur actions ; Altcoin Season Index de Blockchaincenter (convention, non vérifiée en ligne). Interne : le garde-fou BTC d'AXIS a refusé 23 % des entrées et relevé l'expectancy de 3,29 % à 4,58 % (docs/axis-2026-10-07.md:880-893).

**Mesure de succès.** Dernier point = instantané actuel, anti-repaint testé ; étude figée : divergence (BTC au plus haut 55 j, % > MM50 −15 pts) et franchissements 75/25 de l'indice, rendement à 20/30 j dans les deux moitiés, réserve du survivant publiée.

**Fichiers à toucher.**

- apps/web/src/data/breadth.ts
- apps/web/src/data/breadth.test.ts
- apps/web/src/data/saisonAlts.ts (nouveau, + test)
- apps/web/src/components/brief/SectionBreadth.tsx
- apps/web/src/components/McapWindow.tsx
- apps/web/src/data/dominanceStablecoins.ts
- phase 2 seulement : packages/types/src/index.ts, apps/web/src/chart/auxProvider.ts, packages/indicators/src/momentum/<largeurMarche>.ts, packages/indicators/src/registry.ts, packages/indicators/src/registry.test.ts

**Avis des juges.**

- valeur (4) : La largeur du marché n'existe qu'en instantané (apps/web/src/data/breadth.ts:1-20). L'historiser, pour les divergences de participation et la saison des alts face à BTC, éclaire directement le choix BTC ou alts. La BTC.D hors stables corrige une lecture trompeuse courante. Même coût de requêtes. Biais du survivant à afficher.
- cout-risque (4) : Mêmes 50 requêtes Binance, mais KLINE_LIMIT passe de 210 (apps/web/src/data/breadth.ts:68) à 400 : poids légèrement supérieur. CMC déjà utilisé. Seules les séries dérivées sont cachées. Risques : biais du survivant et dénominateur mouvant, rendus visibles par l'affichage du dénominateur ; deux A/D à libeller distinctement.
- coherence (4) : BREADTH (SectionBreadth) et CAP sont les bonnes places, avec les mêmes requêtes. Fait faux : KLINE_LIMIT vaut 210 (data/breadth.ts:68), pas 400. Le porter à 400 alourdit les requêtes. Ne mettre en cache que les séries dérivées.

### 4. SUG-C5 — Pouvoir prédictif d'un indicateur continu : rendements futurs par décile, IC de rang avec intervalle bootstrap par blocs et stabilité par moitiés, sur le graphe ou un panier

**Score 16/20** · valeur 4 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : quantitatif · origines : critique de complétude

**Question de trading.** Sur BTC 4h ou sur les majors, le funding z, le RSI, le ΔOI ou le NPI ont-ils une relation monotone et stable avec le rendement des 6 à 24 bougies suivantes, ou est-ce du bruit ?

**Proposition retenue après vérification.** Section « Pouvoir prédictif (exploratoire, dans l'échantillon) » dans la validation d'EQS. Une sortie d'indicateur choisie avec l'OperandeSelect du BT ou depuis l'instance du graphe ; horizons h en bougies ; rendement de la clôture i à la clôture i+h, comme etudeEvenements. Sorties : quintiles par actif (n, moyenne, médiane, taux de hausse, écart à la dérive inconditionnelle), IC de Spearman sur pas non chevauchants avec intervalle bootstrap par blocs de temps communs (graine fixe), IC de chaque moitié. Univers : majors pour les définitions OHLCV (accumulerKlines), buffer du graphe pour les définitions à aux. Sans compteur d'essais, sans Holm et sans « figer » (IDEE-15 et IDEE-9).

**Proposition initiale.** Depuis une instance d'indicateur (menu « Mesurer »), lire la sortie à la clôture i (causale) puis le rendement de l'ouverture i+1 à la clôture i+h (sémantique d'indexEntree). Sorties : quintiles ou déciles de la valeur avec n, rendement moyen et médian, taux de hausse ; IC de Spearman sur échantillons non chevauchants (pas = h) avec intervalle bootstrap par blocs à graine fixe ; monotonie (corrélation rang/décile) ; IC de chaque moitié ; écart à la dérive inconditionnelle. Univers : buffer du graphe, majors ou watchlist (symbolesUnivers). Libellé « exploratoire, dans l'échantillon » ; compteur d'analyses de la session et seuil corrigé de Holm affichés. Option « figer » : enregistre le manifeste (indicateur, paramètres, horizon, univers, date) pour un retest sur les données postérieures.

**Ce qui existe déjà.** Absent : aucune analyse par quantiles ni IC (grep spearman|décile|quintile|information coefficient : seulement corr.ts et un surlignage de colonnes). Briques présentes : étude d'évènements discrets (EvenementSignal, SommesEtude, apps/web/src/data/validationSignaux.ts:34-61 ; etudeEvenements :187, finaliserEtude :236, fusionnerEtudes :224, symbolesUnivers :92, MAJORS_VALIDATION). Spearman à rangs moyens (apps/web/src/data/corr.ts:319, :346). mulberry32 et bootstrap par blocs mobiles (packages/backtest/src/monteCarlo.ts:21, :93-128). Accumulation d'historique profond avec cache daemon (apps/web/src/data/backtestData.ts:103). seuilDecile ne sert qu'au surlignage (ScreenerWindow.tsx:528-532). Correction : indexEntree (validationSignaux.ts:162) renvoie la dernière bougie CLÔTURÉE, et etudeEvenements mesure de la clôture idx à la clôture idx+h (:200-215), pas « de l'ouverture i+1 ». Recoupements avec les idées exclues : IDEE-10 (IC dans la validation EQS, somme des carrés dans SommesEtude) et IDEE-15 (compteur d'essais, figer une version).

**Réutilise.** indexEntree, symbolesUnivers, finaliserEtude (validationSignaux.ts:92, :162, :236), mulberry32 (packages/backtest/src/monteCarlo.ts:21), Spearman de CORR (apps/web/src/data/corr.ts:30), computeIndicator.

**Point d'intégration.** Module pur apps/web/src/data/pouvoirPredictif.ts, testé sur séries synthétiques. Entrée : un Operande indicateur du BT (OperandeSelect, BacktestWindow.tsx:129) ou l'instance du graphe. Valeur lue à la clôture i, rendement de la clôture i à la clôture i+h (même convention qu'etudeEvenements). Quantiles calculés par actif. IC de Spearman sur échantillons non chevauchants. Bootstrap par blocs de TEMPS communs à tous les actifs (mulberry32, graine fixe). Stabilité par moitiés. Affichage dans SectionValidation d'EQS (ScreenerWindow.tsx:345). Historique via accumulerKlines (OHLCV) pour les majors ; buffer du graphe pour les définitions à aux. Worker au-delà de 100 ms.

**Sources.**

- Bougies du graphe et klines 4h/1d des majors (adaptateurs existants) (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Aucune donnée nouvelle ; séries aux déjà chargées pour les indicateurs dérivés.

**Contrat.** Exception G100 (nouvelle section de mesure). Aucun fournisseur, hôte, clé ni indicateur nouveau. Klines via les adaptateurs et le cache daemon existants. Les définitions à série aux restent limitées au buffer du graphe, pour ne pas consommer les quotas partagés : BGeometrics 15 requêtes par jour sur Vercel (BUILD-CONTRACT.md:69), Coinalyze. Ne remplace pas le protocole AXIS : libellé « exploratoire, dans l'échantillon », jamais « validé ».

**Risques.** 1) Fouille de données : tester 20 indicateurs × 4 horizons produit des IC « significatifs » au hasard. Le compteur, la correction de Holm et le « figer » relèvent d'IDEE-15 et d'IDEE-9 (exclues) : ne pas les dupliquer ici. 2) Bornes de quantiles calculées sur tout l'échantillon : légère anticipation ; préférer des quantiles en fenêtre croissante ou l'annoncer. 3) Actifs corrélés (bêta BTC) : un IC poolé avec un bootstrap par actif surestime la significativité, d'où des blocs de temps communs. 4) Profondeur : 10 ans de 4h × 10 actifs ≈ 220 requêtes paginées, soit des dizaines de secondes à froid. Le critère « < 300 ms » ne vaut que pour le calcul. 5) Séries aux courtes (OI Binance de quelques semaines) : n trop faible, cellules à griser. 6) Références Alphalens et Grinold-Kahn non revérifiées dans cette session (budget de recherche épuisé).

**Intérêt analytique.** fort ; verdict utile. L'outil le plus solide des quatre : il mesure au lieu d'ajouter des indicateurs. Il répond à un constat interne (signaux « faibles en isolé » jamais mesurés, EMA 200 pas meilleure que le hasard) et prolonge le protocole AXIS. Conditions : mutualiser le code avec IDEE-10, adopter le nul par décalage circulaire maison, persister le compteur d'essais, refuser les séries trop courtes, préciser s'il s'agit d'un IC de série temporelle ou transversal, et afficher « exploratoire » en permanence. La méthode est reconnue en recherche de facteurs, mais les références sont citées de mémoire : la limite de recherches web était atteinte et les hôtes externes refusés, donc non vérifié.

**Références.**

- Grinold R. et Kahn R., Active Portfolio Management (1999-2000) : IC et loi fondamentale. Cité de mémoire, non vérifié (quota WebSearch épuisé).
- Alphalens (Quantopian, open source) : rendements par quantile et IC de rang. Cité de mémoire, non vérifié (quantopian.github.io injoignable).
- Künsch (1989), bootstrap par blocs, et Politis et Romano (1994), bootstrap stationnaire. Cités de mémoire, non vérifiés.
- Sullivan, Timmermann et White (1999), J. Finance, data snooping des règles techniques ; Harvey, Liu et Zhu (2016), RFS, tests multiples ; Holm (1979). Cités de mémoire, non vérifiés.
- Liu et Tsyvinski (2021), RFS, « Risks and Returns of Cryptocurrency » : momentum de série temporelle en crypto. Cité de mémoire, non vérifié.
- docs/axis-2026-10-07.md:232-233 (C3, décalage circulaire commun) et :880-898 (EMA 200 seule, p = 0,454) ; scripts/valider-axis-v5.ts:1066-1146 (prefixeTiming et testTiming).
- apps/web/src/data/validationSignaux.ts:34-60, :162, :187 et :236 : seuls des évènements discrets sont mesurés. :82-85 : liste MAJORS figée.
- docs/research/02-indicateurs-edge-crypto.md:190 : signal « faible en isolé », sans mesure.
- /tmp/claude-0/-home-user-axiom/006b3956-3bcb-553d-93c7-502146b32fa7/scratchpad/suggestions-ameliorations-2026-11-06.md:323-343 : IDEE-10, dont le bootstrap et l'IC sont à mutualiser.

**Redondance.** Aucun équivalent continu. etudeEvenements ne mesure que des évènements seuillés (validationSignaux.ts:187). seuilDecile ne sert qu'à surligner des colonnes (apps/web/src/components/ScreenerWindow.tsx:528-532). Le Spearman de CORR porte sur les rendements entre actifs (apps/web/src/data/corr.ts:346). L'infrastructure recoupe IDEE-10 (bootstrap, IC, somme des carrés dans SommesEtude) : il faut un seul module de significativité, pas deux.

**Pièges.** (1) L'outil travaille dans l'échantillon par construction. La boucle « 20 indicateurs × 5 horizons × 3 univers » produit des faux positifs, et un compteur de session se remet à zéro : il faut le persister et le lier au manifeste. (2) Autocorrélation : funding z, OI et MVRV sont très persistants, donc le n effectif est bien inférieur au n brut, et les blocs doivent être au moins aussi longs que cette persistance. Le décalage circulaire, convention maison C3, préserve l'autocorrélation des deux séries. (3) Regroupement multi-actifs : les alts sont corrélées à BTC. Il faut tirer les mêmes blocs temporels pour tous les symboles, comme le décalage commun des scripts AXIS. Il faut aussi distinguer IC de série temporelle et IC transversal ; 10 majors sont trop peu pour le transversal. (4) Biais du survivant : la liste MAJORS est figée aujourd'hui (validationSignaux.ts:82-85), et la watchlist est une sélection après coup. (5) Profondeur : l'OI sans Coinalyze ne couvre que 20 à 90 jours (docs/axis-2026-10-07.md:91), soit 30 à 90 échantillons non chevauchants à h = 6 en 4h, d'où une puissance quasi nulle. (6) Séries on-chain : embargo J-7 (AUX-1), révisions, latence de publication, et alignement à l'ouverture pour tout ce qui n'est pas oi ou funding (apps/web/src/chart/auxProvider.ts:164-171), d'où un look-ahead possible. (7) Lire la valeur à la clôture i et entrer à l'ouverture i+1 est correct et doit être conservé ; les sorties non causales (packages/backtest/src/engine.ts:66-73) doivent être refusées. (8) Non-stationnarité : deux moitiés ne suffisent pas, mieux vaut un découpage par année.

**Protocole de validation.** D'abord les tests de calibration prévus : signal synthétique retrouvé dans son IC, bruit pur non significatif sur au moins 95 % de 200 graines, contrôle par préfixe. Ensuite : (a) un nul par décalage circulaire commun, 1 999 tirages et graine fixe, comme C3, en complément ou à la place du bootstrap par blocs. (b) « Figer » écrit un manifeste au format scripts/axis/manifeste-*.json : SHA-256 du code, paramètres, horizon, univers et date de coupure. (c) Le verdict ne porte que sur les données postérieures à la coupure, avec un critère pré-déclaré : IC > 0 et de même signe pour chaque année. En dessous de 100 échantillons non chevauchants, le verdict est « non concluant ». Un IC mesuré dans l'échantillon n'alimente jamais un préréglage EQS ni une alerte sans l'étape (c).

**Preuve d'intérêt (idéation).** L'analyse par quantiles et par IC est l'outil standard de la recherche de facteurs (Grinold et Kahn, Active Portfolio Management ; outil Alphalens), cité de mémoire, non vérifié. Interne : plusieurs signaux sont jugés « faibles en isolé » sans mesure (docs/research/02-indicateurs-edge-crypto.md:190), et l'EMA 200 seule s'est révélée du hasard (p = 0,454, docs/axis-2026-10-07.md:880-898).

**Mesure de succès.** Série synthétique à signal connu : IC retrouvé dans son intervalle à 95 % ; bruit pur : IC non significatif dans ≥ 95 % de 200 graines ; contrôle par préfixe sans écart ; moins de 300 ms pour 10 ans de 4h sur 10 actifs.

**Fichiers à toucher.**

- apps/web/src/data/pouvoirPredictif.ts (nouveau)
- apps/web/src/data/pouvoirPredictif.test.ts (nouveau)
- apps/web/src/store/signaux.ts (lancement, univers, progression)
- apps/web/src/components/ScreenerWindow.tsx (section dans SectionValidation :345)
- apps/web/src/data/corr.ts (export de rangsMoyens si besoin)

**Avis des juges.**

- valeur (4) : Change la façon de juger les 220 indicateurs : IC de rang, quintiles, bootstrap par blocs et stabilité par moitiés, cohérent avec la culture de preuve du dépôt. validationSignaux ne traite que des signaux discrets (apps/web/src/data/validationSignaux.ts:1-20). Risque de fouille de données dans l'échantillon, à afficher clairement comme exploratoire.
- cout-risque (4) : Aucune source ni clé : majors via les adaptateurs, et defs aux bornées au buffer pour épargner les quotas BG et Coinalyze. Bootstrap par blocs à graine fixe. Risque principal : data snooping et lecture « validé ». Le libellé « exploratoire, dans l'échantillon » est obligatoire, et les quantiles sur tout l'échantillon sont une légère anticipation à annoncer.
- coherence (4) : Se greffe sur la section « Validation historique » d'EQS (ScreenerWindow.tsx:344-351) et sur validationSignaux.ts, avec l'OperandeSelect du BT. Aucun fournisseur, aucun def. Le libellé « exploratoire » est conforme au protocole.

### 5. SUG-3 — Flux intrabar reconstruit à la demande : VPVR, VPFR et footprint historique depuis les klines 1m/1s Binance (vrai split taker), puis CVD par taille d'ordre via le daemon

**Score 15/20** · valeur 4 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : non · exception fournisseur : non · exception G100 : non · catégorie : volume et flux · origines : VOL-1, AT-3, VOL-10

**Question de trading.** Où le volume s'est-il vraiment échangé sur ma plage swing (POC, Value Area, delta par niveau), et les gros ordres accumulent-ils pendant que le petit flux vend ?

**Proposition retenue après vérification.** Phase 1 seule : chargeur intrabar paresseux (Binance spot et perp), résolution choisie par la plage (1m pour une plage courte, 5m ou 15m par défaut en swing, 1s seulement en spot et sur les toutes dernières bougies si la profondeur est confirmée). Cache LRU borné et anti-rebond au pan. Consommé par VPVR, VPFR et les colonnes historiques du footprint. L'étiquette « ≈ » devient « réparti à la minute (1m) » et non « exact » ; repli explicite sur les autres places. Mesure contre l'oracle tick du replay spot : POC à ±1 bin sur 20 bougies 4h BTCUSDT, comparé au taux actuel ; corrélation du delta par bin. Le CVD par taille et les bulles historiques sortent du lot ; si on les reprend plus tard, ce sera par agrégation à la lecture sur replay_trades, sous exception G100.

**Proposition initiale.** Phase 1 (M) : chunk paresseux chart/intrabar.ts qui charge, pour la plage utile, les klines d'unité inférieure (1m par défaut, 1s pour les dernières bougies du footprint, 5m/15m si la plage dépasse ~50 000 bougies), cache LRU borné. computeVolumeProfile et buildFootprintBar les consomment sans modification ; le split acheteur/vendeur par niveau devient exact à la résolution 1m (k[9]) ; l'étiquette « ≈ » est remplacée par la résolution réelle. Phase 2 (L, locale, facultative) : après un téléchargement replay, le daemon écrit un agrégat par minute du delta par tranche de notionnel (<10 k$, 10-100 k$, 100 k-1 M$, ≥1 M$) et des gros prints ; pane « CVD par taille » et bulles baleines historiques.

**Ce qui existe déjà.** VPVR et VPFR répartissent le volume de chaque bougie uniformément sur [low, high] (apps/web/src/chart/volumeProfile.ts:9-10, 91-110 ; apps/web/src/chart/volumeRangeOverlay.ts:166). Le footprint historique est approché et marqué « ≈ » (apps/web/src/chart/orderflow.calc.ts:154-170, via rowsApprochees apps/web/src/chart/openCloseNet.calc.ts:109-124 ; rendu apps/web/src/chart/orderflow.ts:857, 1104-1106). Briques présentes : lecture de k[9] (apps/web/src/data/binance.ts:83-98), pagination fapi par endTime (apps/web/src/chart/auxProvider.ts:365-396) et replay aggTrades SPOT seulement (apps/daemon/src/replay.ts:35), trades bruts déjà en table replay_trades (replay.ts:63-70). Les bulles baleines sont live seulement (apps/web/src/chart/whaleBubbles.ts:48). Aucun chargement intrabar ni CVD par taille (grep : rien).

**Réutilise.** computeVolumeProfile (volumeProfile.ts:60), buildFootprintBar (orderflow.calc.ts:98), lecture k[9] (apps/web/src/data/binance.ts:85), pagination fapi de perpDelta (apps/web/src/chart/auxProvider.ts:365-396), pipeline replay.ts.

**Point d'intégration.** Phase 1 : un module apps/web/src/chart/intrabar.ts importé dynamiquement depuis VolumeProfileController et l'overlay VPFR. Il sert les bougies d'unité inférieure de la plage demandée (pagination endTime, patron auxProvider.ts:365-396) avec un cache LRU borné. computeVolumeProfile (volumeProfile.ts:60) et buildFootprintBar (orderflow.calc.ts:98) les consomment sans changement de signature. Appels directs depuis le navigateur, donc sur le poids de l'IP du visiteur et non sur les quotas du propriétaire : api.binance.com en dur (binance.ts:12), fapi direct sur Vercel (apps/web/src/data/extapi.ts:43). Les deux hôtes sont déjà dans connect-src (vercel.json, CSP). Aucun proxy, aucune liste blanche. Phase 2 éventuelle : une route GET du daemon qui agrège à la lecture (GROUP BY minute et tranche de notionnel) sur replay_trades existant, plutôt que de nouvelles tables.

**Sources.**

- Binance spot /api/v3/klines 1m et 1s (déjà utilisée ; gratuit sans clé, CORS, déjà en connect-src ; vérifiée en ligne par l'idéation : oui) : Taker buy en colonne 9, 1 000 bougies par appel, unité 1s déjà servie (apps/web/src/data/adapters.ts:77-81).
- data.binance.vision futures/um/daily/aggTrades (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Phase 2 seulement ; format identique à /fapi/v1/aggTrades selon binance-public-data, chemin exact non relu.

**Contrat.** La phase 1 améliore la précision de surfaces existantes (VPVR, VPFR, footprint) : ni nouvelle fenêtre ni nouvelle surface, défendable sans exception G100. La phase 2 (pane « CVD par taille », bulles baleines historiques) est une surface nouvelle et exige une exception. Aucun nouveau fournisseur : Binance est déjà câblé. Des dumps futures/um de data.binance.vision seraient un nouveau jeu de données sur un hôte déjà utilisé ; le chemin n'a pas été vérifié en ligne. Pas d'enregistreur : chargement à la demande (BUILD-CONTRACT.md:88). Budget : VolumeProfileController et volumeRangeOverlay sont sur le chemin initial (apps/web/src/chart/ChartInstance.tsx:74 ; apps/web/src/chart/drawing.ts:35), l'import dynamique est donc obligatoire (marge d'environ 4 ko gzip).

**Risques.** (1) Affirmation à corriger : les klines 1m donnent le split taker exact PAR MINUTE, mais le volume reste réparti uniformément dans la mèche de chaque minute. Le split par niveau reste approché ; il faut écrire « réparti à la minute », pas « exact ». (2) Les klines 1s n'existent que sur le spot. Absence côté fapi et profondeur historique du 1s : non vérifiées en ligne ici (budget de recherche épuisé). (3) Volume de requêtes : un graphe 4h de 500 bougies visibles représente 120 000 klines 1m, soit 120 appels à chaque changement de plage. Il faut par défaut une résolution adaptée au swing (15m ou 5m), un anti-rebond sur le pan et un cache par plage. (4) Bybit, OKX et Hyperliquid n'ont pas la colonne taker : on retombe sur le sens de la bougie (volumeProfile.ts:98-99), étiqueté. Twelve Data est à exclure (8 req/min, apps/web/src/data/twelvedata.ts:15). (5) Phase 2 : plusieurs Go en SQLite et MAX_LIGNES de 20 M par jour (replay.ts:39). Le replay est en spot ; le perp demande un autre dump. (6) Ne pas refaire OFL-5 et OFL-6 de docs/revue-2026-11-06.md (footprint live), qui sont exclus.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Phase 1 utile : le gain de fidélité est démontrable et peu coûteux. Un chargement en 5m ou 15m suffit pour l'essentiel ; réserver le 1m et le 1s aux plages courtes et au footprint des dernières bougies. Corriger le libellé : « split taker exact à la minute », pas « exact par niveau ». Phase 2 : gadget en l'état. La fenêtre de stockage ne permet aucune validation swing, et la littérature (non revérifiée ici) dit que l'information se trouve dans les tailles moyennes, pas les plus grosses. La remplacer par un agrégat en flux, testé par script avant toute surface.

**Références.**

- Pratique documentée dans le dépôt : le VP par répartition uniforme est une approximation reconnue (apps/web/src/chart/volumeProfile.ts:9-10 ; docs/research/02-indicateurs-edge-crypto.md:226-230, « approx par bougie répartit mal le volume intra-bougie (idéalement aggTrade) »).
- Mesure scratchpad (/tmp/claude-0/-home-user-axiom/006b3956-3bcb-553d-93c7-502146b32fa7/scratchpad/outils-analyse/vp-intrabar.mjs, 40 tirages synthétiques au pas d'1 s, 10 jours, 50 bins, volume en grappes avec saisonnalité). POC à ±1 bin de l'oracle tick : 68 % depuis le 4h, 78 % depuis le 1h, 88 % depuis le 15m, 90 % depuis le 5m, 98 % depuis le 1m. Corrélation des profils : 0,925 / 0,965 / 0,987 / 0,995 / 0,999.
- Interne, flux : marqueurs « fort achat » au delta taker FAVORABLES en 4h (scripts/axis/rapport-flux-2026-10-08.md:7-17), DÉFAVORABLES sur toutes les autres unités (scripts/axis/rapport-ut-2026-10-08.md:7-21). Le contenu informatif du delta est fragile et dépend de l'unité.
- Barclay & Warner, « Stealth trading and volatility », JFE 1993, et Chakravarty, JFE 2001 : ce sont les ordres de taille MOYENNE qui portent l'information, ce qui contredit l'intuition « gros ordres = argent informé ». Non revérifié en ligne ici.
- Coût réseau mesuré dans le dépôt : Binance répond en 0,5 à 1,4 s par requête, avec deux créneaux par place dont un réservé au graphe (docs/revue-2026-09-26-profondeur-historique.md:112 et 164). Limite de 1 000 bougies par appel (apps/web/src/data/binance.ts:252) ; unité 1s servie (apps/web/src/data/adapters.ts:77-80). Le chemin data.binance.vision futures/um/daily/aggTrades n'a pas été revérifié dans cette session.

**Redondance.** Faible pour la phase 1. Le VP lit déjà le split taker par bougie (volumeProfile.ts:98-100), mais l'étale sur toute la plage de la bougie. Le VPFR utilise le même calcul (volumeRangeOverlay.ts:166). Le footprint live est exact (aggTrade) et l'historique est « ≈ » (orderflow.calc.ts:160-175). Le replay donne le tick, mais en spot et à la demande (apps/daemon/src/replay.ts:1-25). SUG-3 complète la revue (docs/revue-2026-11-06.md:1436-1441, colonnes partielles) sans la reproposer. Phase 2 : le catalogue a déjà cvd, volumeDelta, cvdSpotPerp, vpin, kyleLambda (packages/indicators/src/orderflow/, volume/kyleLambda.ts) ; les bulles baleines sont live seulement (whaleBubbles.ts:48). La tranche par taille est nouvelle.

**Pièges.** 1) « Split exact » surévalué : k[9] donne le volume taker acheteur de la MINUTE, toujours réparti uniformément sur son [low, high]. C'est exact par minute, approché par niveau. 2) Latence : 60 j de 4h en 1m = 87 requêtes, soit environ 45 à 120 s avec un seul créneau libre. Le seuil de « ~50 000 bougies » est trop haut. Choisir la résolution d'après un budget de requêtes (par exemple 10 au plus) : sur données synthétiques, le 15m et le 5m captent l'essentiel du gain (88-90 % contre 68 %). 3) Split taker sur Binance seulement ; ailleurs « ≈ ». Le profil spot et le graphe perp peuvent diverger. 4) Le 1s n'existe qu'en spot (fapi sans 1s : non vérifié). 5) Phase 2 : un aggTrade n'est pas un ordre. Un ordre taker qui balaie plusieurs prix produit plusieurs aggTrades, et les algorithmes découpent les gros ordres : tranche de taille ≠ acteur. 6) Phase 2 : 7 à 14 jours stockés, soit 42 à 84 bougies 4h. C'est trop court pour valider quoi que ce soit à l'horizon swing. Mieux vaut agréger en flux par minute et par tranche sans stocker les trades : l'agrégat est minuscule et des mois d'historique deviennent possibles (zip quotidiens de plusieurs centaines de Mo : replay.ts:44-49).

**Protocole de validation.** Phase 1 = fidélité de mesure, sans risque de sur-ajustement de marché. Figer à l'avance une liste de jours tirés par graine, télécharger l'oracle tick via le replay (spot, comme les klines 1m), puis mesurer par résolution (4h, 1h, 15m, 5m, 1m) le POC à ±1 bin, la corrélation des profils et la corrélation du delta par bin. Retenir la résolution la moins chère qui atteint le seuil pré-déclaré. Phase 2 = d'abord un script hors appli sur ≥ 12 mois BTC et ETH perp agrégés par tranche. Hypothèse pré-écrite (par exemple, une divergence entre le CVD de la tranche ≥ 1 M$ et celui de la tranche < 10 k$ prédit le signe du rendement à 12 bougies 4h). Nul par décalage circulaire, Bonferroni sur 4 tranches × horizons, 6 derniers mois tenus à l'écart. En cas d'échec, affichage descriptif seulement, étiqueté.

**Preuve d'intérêt (idéation).** Les profils intrabar sont la pratique des outils de référence (script TradingView « Volume Profile Plus », vérifié par WebSearch dans l'idée brute) ; la limite est reconnue dans le code (volumeProfile.ts:9-10). Gain mesurable contre l'oracle tick du replay.

**Mesure de succès.** Sur 20 bougies 4h BTCUSDT, POC intrabar à ±1 bin du POC tick dans ≥ 90 % des cas (taux actuel mesuré en regard) ; corrélation ≥ 0,9 du delta par bin ; < 50 ms pour 50 000 bougies. Phase 2 : somme des tranches = CVD tick à 1e-6.

**Fichiers à toucher.**

- apps/web/src/chart/intrabar.ts (nouveau, chunk paresseux) + intrabar.test.ts
- apps/web/src/chart/volumeProfile.ts
- apps/web/src/chart/volumeRangeOverlay.ts
- apps/web/src/chart/orderflow.ts (colonnes historiques approchées, lignes 857 et 964)
- apps/web/src/chart/orderflow.calc.ts
- apps/web/src/data/binance.ts et apps/web/src/data/binanceFutures.ts (fetch paginé par plage)
- apps/daemon/src/replay.ts (phase 2 seulement)

**Avis des juges.**

- valeur (4) : Améliore un outil central. Le VPVR répartit aujourd'hui le volume de chaque bougie du graphe uniformément sur [low, high] (apps/web/src/chart/volumeProfile.ts:8-10). En 4h sur 60 j, le POC et la VA sont grossiers. L'intrabar 15m ou 1m les affine nettement, et la mesure contre l'oracle tick du replay est bien posée. Le libellé « réparti à la minute » est honnête. Valeur forte pour placer les niveaux swing.
- cout-risque (3) : Source déjà câblée, appel direct depuis le navigateur, donc quota par IP du visiteur. Coût réseau élevé : environ 87 requêtes pour 60 j de 4h en 1m, soit 45 à 120 s. Il faut un cache LRU et un anti-rebond, d'où une maintenance non triviale. Risque de surclaim : le split taker est exact par minute, pas par niveau. La profondeur 1s et l'absence côté fapi ne sont pas vérifiées.
- coherence (4) : Rend plus précises des surfaces existantes : colonnes « ≈ » (orderflow.ts:857, orderflow.calc.ts:158), volumeProfile.ts et volumeRangeOverlay.ts. Pas de surface, de fournisseur ni de clé nouveaux. Le coût se limite à un chargeur paresseux avec cache LRU. La phase 2 est correctement écartée.

### 6. SUG-25 — Coût de base des détenteurs récents et anciens (STH/LTH) : lignes visibles sur toutes les unités, bandes σ et marqueurs de reconquête ou de perte

**Score 15/20** · valeur 3 · coût-risque 4 · cohérence 5 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain BTC · origines : BTC-1

**Question de trading.** Le repli tient-il au-dessus du prix moyen d'achat des acheteurs des ~155 derniers jours, plancher typique d'un marché haussier, et cela se lit-il sur le graphe 4h d'AXIS ?

**Proposition retenue après vérification.** Lot unique S, avec exception G100 : une bascule « Coûts on-chain » dans Niveaux (BTC en dollars) qui trace 3 lignes horizontales, coût STH, coût LTH et prix réalisé global, visibles sur toutes les unités. Chaque ligne porte sa date d'observation et l'un de deux suffixes : « embargo J-7 » si /last répond delayed:true, sinon « (périmé) » au-delà de 2 j. Les séries viennent des défs et du cache BG existants, sans fenêtre supplémentaire. Le ±σ, les marqueurs et le BRIEF sont retirés : BRIEF affiche déjà les deux coûts. Les bandes et les marqueurs du lot 2 ne seront faits que si une étude préalable hors graphe le justifie. Cette étude porte sur les reconquêtes et pertes du coût STH, à 7 et 30 j, sur 1 460 j BG et le PriceUSD de Coin Metrics, et doit donner le même signe dans les deux moitiés.

**Proposition initiale.** Lot 1 (S) : famille « Niveaux on-chain » dans la surcouche Niveaux : prix réalisé STH, LTH, global et STH ±1σ en lignes, date d'observation, « (périmé) » au-delà de 2 j, visibles sur toutes les unités. Lot 2 (M) : overlay 1d+ avec bandes STH-RP × exp(μ ± kσ) de ln(close/STH-RP) sur 365 j glissants, marqueurs « reconquête »/« perte » après 2 clôtures, « réinitialisation » quand le STH-SOPR repasse au-dessus de 1 avec le prix au-dessus du coût STH. Lot 3 : distance au coût STH dans le BRIEF.

**Ce qui existe déjà.** Les prix réalisés STH et LTH sont déjà chargés et affichés à deux endroits. (1) CHAIN › Cohortes, avec l'écart au spot Coinbase (apps/web/src/components/onchain/CohortesBtc.tsx:17 et :70 ; défs apps/web/src/data/onchain/bgeometrics.ts:128-129, fenêtre 120 j, bgeometrics.ts:63). (2) BRIEF, dans « Flux · lecture commune », que l'idée ne cite pas (apps/web/src/data/onchain/fluxCapitaux.ts:201-202 et :264 ; apps/web/src/components/brief/SectionFluxCapitaux.tsx:5). Le lot 3 existe donc en partie : la valeur est dans BRIEF, la distance seulement dans CHAIN. Sur le graphe, à partir de 1d : prix réalisé global (packages/indicators/src/derivatives/realizedPrice.ts:15-22) et MVRV STH/LTH, c'est-à-dire prix ÷ coût STH, sur 1 460 j (packages/indicators/src/derivatives/mvrvCohortes.ts:13-22 ; bgeometrics.ts:140), sous embargo J-7. En 4h, rien n'est visible : minTimeframe 1d bloque ces indicateurs (apps/web/src/lib/indicatorUsability.ts:147). La surcouche Niveaux compte 4 bascules (apps/web/src/chart/niveauxOverlays.ts:17). Le patron de la ligne « Coût Strategy » est directement réutilisable (apps/web/src/chart/niveaux/prixRevient.ts ; composite.ts:24-32).

**Réutilise.** creerSourcePrixRevient (apps/web/src/chart/niveaux/prixRevient.ts), FABRIQUES (composite.ts:24-32), chargerBgeometricMetrique et son quota, ecartPrixRealise (apps/web/src/data/onchain/cohorts.ts:12), aux sthSopr, annotations.

**Point d'intégration.** Lot 1 : nouvelle clé dans CleOverlayNiveaux et dans l'état (niveauxOverlays.ts:17-60), commande sur le modèle de « action:prix-revient » (même fichier), persistance (apps/web/src/store/persist.ts), FABRIQUES et ORDRE_SOURCES (composite.ts:24-32). Nouvelle source apps/web/src/chart/niveaux/niveauxOnchain.ts copiée de creerSourcePrixRevient, avec import paresseux de data/onchain/bgeometrics et appel de chargerBgeometricMetrique(BG_STH_REALIZED_PRICE / BG_LTH_REALIZED_PRICE / BG_REALIZED_PRICE). Le cache 24 h est partagé avec CHAIN et BRIEF. Lot 2 : AuxSeriesId +2 (packages/types/src/index.ts:186), case BG et BG_DEF_PAR_AUX (apps/web/src/chart/auxProvider.ts:516-542 et 655-675), nouveau def overlay en 1d+ avec annotations « marqueurs » (types index.ts:345-350), registre, et compteur registry.test.ts:21 qui passe de 220 à 221.

**Sources.**

- BGeometrics realized-price-sth/lth, realized-price, sth-sopr (déjà utilisée ; clé gratuite (serveur), 15 req/j ; vérifiée en ligne par l'idéation : oui) : Chemins déjà autorisés (api/_policy.ts:319) ; prix réalisés de cohortes frais selon le dépôt ; offre gratuite 4 ans max ; CGU du 24/02/2026 : servir des utilisateurs finaux = redistribution commerciale exigeant le plan Professional (vérifié par WebSearch).

**Contrat.** Aucun nouveau fournisseur, et les chemins realized-price-sth et realized-price-lth sont déjà autorisés (api/_policy.ts:319). Une exception G100 est nécessaire pour la nouvelle bascule de surface (BUILD-CONTRACT.md:71). Lot 2 : @axiom/types +2 (BUILD-CONTRACT.md:81) et catalogue +1 (:82). Budget initial : la bascule et la commande vivent dans le socle niveauxOverlays, chargé au démarrage. Le def vit dans le chunk « indicators » (vite.config.ts:154), importé statiquement par le graphe (chart/indicators.ts:33). La marge restante est d'environ 4 Ko gzip (docs/revue-2026-11-06.md:1232-1233). Quota BGeometrics : 10 req/h et 15 req/j, partagés par les visiteurs, en réponse privée sans cache CDN (docs/revue-2026-11-06.md:871-873). Le lot 1 coûte 0 requête si CHAIN ou BRIEF ont déjà chargé ces séries dans les 24 h, sinon jusqu'à 3. La licence BGeometrics pour le site public dépend de SUG-26/SUG-29.

**Risques.** (1) Fraîcheur non établie : l'embargo J-7 date du 2026-09-11, et le dépôt ne note la fraîcheur de realized-price-sth qu'au 2026-09-07 (docs/superpowers/plans/2026-09-07-revue-et-extension-globale.md:81). sth-mvrv est sous embargo (bgeometrics.ts:137-140), le coût STH l'est peut-être aussi. Dans ce cas la règle « (périmé) au-delà de 2 j » s'affichera en permanence. Il faut sonder /last avant d'écrire la règle. (2) Le ±1σ prévu au lot 1 demande 365 j de clôtures quotidiennes, alors que bougiesJour n'en charge que 100 (apps/web/src/chart/niveaux/bougiesJour.ts:16) : ce n'est donc pas un effort S. (3) Le report LOCF sans limite d'âge (AUX-1 de la revue) touche le lot 2. (4) L'étude d'évènement sur 1 460 j couvre un seul cycle et une dizaine de reconquêtes ou pertes, ce qui donne une faible puissance statistique. (5) Une ligne journalière lue en 4h change de niveau une fois par jour : la dater est obligatoire. (6) Les CGU BGeometrics pour un affichage public n'ont pas été revérifiées ici : quota WebSearch épuisé et bitcoin-data.com injoignable depuis le conteneur.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Lot 1 (S) utile : référence très suivie, fraîche à J-1, lisible en 4h, sans quota supplémentaire si le cache CHAIN est chaud. Y joindre le MVRV STH frais calculé. Lot 2 : les marqueurs sont probablement un croisement de moyenne mobile ~150 j déguisé, à livrer seulement s'ils battent cette base ; les bandes σ reconditionnent le MVRV STH. Lot 3 doublonne la tuile CHAIN. LTH facultatif. Recherche web épuisée et hôtes académiques bloqués : références externes non revérifiées ici.

**Références.**

- Glassnode (Week On-Chain) : coût STH (seuil 155 j) présenté comme plancher haussier et résistance baissière, avec bandes σ. Fait vérifié par l'émetteur de l'idée, non revérifié ici (budget WebSearch épuisé).
- Aucune étude hors échantillon publiée connue sur les croisements du coût STH (non vérifié).
- packages/indicators/src/derivatives/mvrvCohortes.ts:11-23 : le pane MVRV STH (= close / coût STH) existe déjà en 1d.
- apps/web/src/data/onchain/bgeometrics.ts:126-129 : prix réalisés STH/LTH, « endpoints frais vérifiés ».
- apps/web/src/data/onchain/bgeometrics.ts:140 : sthMvrv sous embargo J-7, 1 460 j.
- apps/web/src/data/onchain/bgeometrics.ts:90-95 : 1 460 j = maximum de l'offre gratuite.
- apps/web/src/data/onchain/bgeometrics.ts:340 : clé de cache bg:<id> partagée quelle que soit la fenêtre.
- packages/indicators/src/derivatives/realizedPrice.ts:16-22 : overlay du prix réalisé global.
- packages/indicators/src/trend/vwma.ts et packages/indicators/src/trend/sma.ts : bases de comparaison.
- packages/indicators/src/utils-aux.ts:38-58 et apps/web/src/chart/auxProvider.ts:766 : alignement en mode ouverture.
- docs/axis-2026-10-07.md:201-204 : garde-fou de régime BTC EMA 100, verdict FAVORABLE.
- docs/axis-2026-10-07.md:490-491 : données AXIS consommées.
- scripts/valider-axis-flux.ts:388-422 : nul par décalages circulaires.

**Redondance.** Forte pour les lots 2 et 3. Le pane mvrvCohortes donne déjà close / coût STH sur 1 460 j, mais avec 7 jours de retard (embargo). La « distance au coût STH » du lot 3 vaut MVRV STH − 1 : c'est un doublon, sauf pour la fraîcheur. Les bandes σ du lot 2 sont le z-score glissant de ln(MVRV STH) reporté en prix : aucune information nouvelle. Le coût STH est mécaniquement la moyenne des prix des ≤155 derniers jours, pondérée par les pièces déplacées : il est donc proche d'une VWMA/SMA de ~150 j en 1d (vwma.ts, sma.ts) et du garde-fou EMA 100 d'AXIS. Le prix réalisé global est déjà en overlay (realizedPrice.ts) ; STH et LTH sont déjà en tuiles CHAIN (CohortesBtc.tsx:17) et dans la vue flux de capitaux (fluxCapitaux.ts:179-180). Seul apport réel : la valeur à J-1 en ligne horizontale, lisible en 4h (lot 1). Variante gratuite : recalculer un MVRV STH frais = close / coût STH, ce qui lève l'embargo du pane existant sans requête supplémentaire (même cache bg:sthRealizedPrice).

**Pièges.** Look-ahead : le coût STH(D) dépend de la clôture de D et n'est publié qu'à D+1. Or alignAux en mode ouverture pose la valeur de D sur la bougie D dès son ouverture : toute étude doit décaler d'un jour. En 1w, l'alignement lit la valeur du lundi (revue). Profondeur gratuite de 1 460 j = un seul cycle (baisse 2022-23, hausse 2024-26) : les deux moitiés sont deux régimes, donc le critère « même signe dans les deux moitiés » est biaisé par construction. Faux croisements en range : le prix traverse souvent le coût STH, et le paramètre « 2 clôtures » est ad hoc (risque de sur-ajustement si on le règle). Possibles révisions BGeometrics non documentées (non vérifié). Source unique, sans recoupement gratuit. Équivalence du seuil 155 j entre BG et Glassnode non vérifiée. Niveau très suivi : un effet auto-réalisateur est possible, donc instable. Le coût LTH est le plus souvent très loin du prix, peu utile au swing. Licence BG du site public (offre gratuite ≠ redistribution, selon l'émetteur). Passer fenetreJours à 1 460 modifie aussi CHAIN (cache partagé).

**Protocole de validation.** (1) Lot 1 sans validation requise : niveau contextuel, libellé descriptif, « (périmé) » au-delà de 2 j. (2) Marqueurs et bandes : figer dans un manifeste SHA-256, sur le modèle de scripts/valider-axis-flux.ts, la règle exacte (2 clôtures 1d contre le coût STH de J-1, entrée à l'open J+2) et les horizons 7 et 30 j. Tester ensuite contre deux nuls : les décalages circulaires (valider-axis-flux.ts:388-422) et la même règle sur SMA 155 / VWMA 155 1d. Le coût STH n'est retenu que s'il bat la moyenne mobile. (3) Les 1 460 j ont déjà été vus (CHAIN, graphe) : le seul échantillon jamais vu honnête est le futur. Geler maintenant, archiver chaque jour la valeur reçue (ce qui mesure aussi les révisions), juger à 12 mois ; d'ici là, libellé « descriptif ». (4) Pas d'usage comme filtre AXIS : données consommées et garde-fou EMA 100 déjà validé.

**Preuve d'intérêt (idéation).** Glassnode présente le coût STH comme plancher haussier et résistance baissière, avec des bandes σ (Week On-Chain, repris par la presse, vérifié). Aucun test hors échantillon publié trouvé.

**Mesure de succès.** Lignes = tuiles CHAIN au dollar près ; test anti look-ahead ; event study sur 1 460 j des « reconquêtes » et « pertes » à 7 et 30 j, même signe dans les deux moitiés, sinon lignes seules.

**Fichiers à toucher.**

- apps/web/src/chart/niveauxOverlays.ts
- apps/web/src/chart/niveaux/composite.ts
- apps/web/src/chart/niveaux/niveauxOnchain.ts (nouveau)
- apps/web/src/store/persist.ts
- apps/web/src/data/onchain/bgeometrics.ts (lot 2 : fenetreJours 1460)
- packages/types/src/index.ts (lot 2)
- apps/web/src/chart/auxProvider.ts (lot 2)
- packages/indicators/src/derivatives/coutBaseCohortes.ts (lot 2, nouveau)
- packages/indicators/src/registry.ts (lot 2)
- packages/indicators/src/registry.test.ts (lot 2)

**Avis des juges.**

- valeur (3) : Le coût STH est un support haussier suivi pour BTC. Il n'est visible aujourd'hui qu'en 1d (realizedPrice est en minTimeframe 1d, packages/indicators/src/derivatives/realizedPrice.ts:22) et dans le BRIEF. Le porter en 4h est une commodité. La valeur est lente à bouger, sous embargo J-7 possible, et sa réaction n'est pas mesurée.
- cout-risque (4) : Chemins realized-price-sth et realized-price-lth déjà autorisés (api/_policy.ts:319). Il faut réutiliser le cache CHAIN, sinon le quota BG de 15 req/j partagé par les visiteurs (BUILD-CONTRACT.md:69) est vite épuisé. Effort S. Risque : embargo J-7 possible sur ces séries, donc ligne périmée affichée comme actuelle si la date n'est pas portée. Le suffixe daté est prévu. La bascule est dans le socle initial, d'où un coût en octets.
- coherence (5) : Calque exact de chart/niveaux/prixRevient.ts : ligne horizontale « Coût Strategy », suffixe « (périmé) », chunk paresseux, données reprises de CHAIN. Les séries STH et LTH sont déjà chargées (data/onchain/fluxCapitaux.ts:271 ; bgeometrics.ts:128). Ni aux, ni def, ni hôte. À fusionner avec SUG-C6 lot A et SUG-29 lot A.

### 7. SUG-35 — Prime Coinbase en série graphe causale (z glissant, persistance, au-delà de BTC/ETH), puis quadrant « levier contre comptant » mesuré par actif

**Score 15/20** · valeur 3 · coût-risque 4 · cohérence 5 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : flux institutionnels et sentiment · origines : FLX-1, FLX-9

**Question de trading.** La hausse est-elle portée par la demande au comptant américaine ou par le levier offshore, et une hausse portée par le seul levier est-elle plus fragile ?

**Proposition retenue après vérification.** Phase 1 seulement.
(a) Correctif immédiat de CBPREM : z et bandes glissants causaux (168 h) au lieu de toute la série.
(b) Étude figée avant tout code de catalogue. Prime ajustée du peg, calculée en 4h par appariement exact des ouvertures Coinbase USD / Binance USDT, sur BTC, ETH et SOL. Évènement = persistance ≥ N bougies au-delà de +2σ glissant. Rendements à 24 et 72 h selon le protocole de scripts/valider-axis-flux.ts.
(c) Seulement si l'étude est favorable : aux cbPremium (appariement strict, sans LOCF) et indicateur primeCoinbase au catalogue.
Phase 2 « levier contre comptant » écartée. Elle recouvre cvdSpotPerp, le quadrant OI×prix et le régime, et ses composants (L/S ~30 j, ETF journaliers) ne permettent pas de validation en 4h.

**Proposition initiale.** (1) Aux cbPremium (prime ajustée du peg, %, horaire, LOCF à la clôture) pour tout actif ayant une paire Coinbase USD et Binance USDT ; indicateur primeCoinbase : prime, z-score glissant causal (168 h), persistance au-delà de ±kσ, bascule de signe au-dessus de l'EMA 50 ; CBPREM passe au z glissant et s'étend à SOL et aux alts. (2) Phase 2 : indicateur levierComptant, axe levier = rangs percentiles causaux 365 j du funding z, lsAccount et ΔOI ; axe comptant = rangs de cbPremium et des flux ETF (SUG-36), repli CVD spot pour les alts ; composant absent = axe non calculé ; tuile REGIME.

**Ce qui existe déjà.** Fenêtre CBPREM : BTC/ETH seulement (apps/web/src/store/cbprem.ts:66-69), en 1h sur ~30 j (:48, 3 pages Coinbase :50).
Peg via Kraken USDT/USD : un seul appel d'environ 720 bougies, sans pagination possible (:104-118). Un historique long ne peut donc pas être ajusté.
Bandes et z calculés sur toute la série (apps/web/src/data/cbprem.ts:116-160), donc non causaux.
Aucun aux de prime (packages/types/src/index.ts:186-237) ni indicateur de prime ; seul strategy/premiumSpotPerp existe.
Phase 2 déjà largement couverte :
- cvdSpotPerp compare comptant et levier par le flux taker spot contre le delta perp, normalisés, avec marqueurs de divergence (packages/indicators/src/strategy/cvdSpotPerp.ts:1-35, orderflow/divergenceSpotPerp.ts) ;
- quadrant OI×prix (packages/indicators/src/derivatives/oiChange.ts:6, screener) ;
- régime avec funding et ETF (apps/web/src/data/regime.ts:202, :259).

**Réutilise.** serieCbpremAjustee (cbprem.ts:65), pagination Coinbase 350 bougies (store/cbprem.ts:92), neutralisation Kraken USDT/USD, fundingZScore, etudeEvenements, protocole de scripts/valider-axis-flux.ts.

**Point d'intégration.** Calculer la prime à l'UNITÉ DU GRAPHE plutôt qu'en horaire + LOCF : Coinbase gère 4h (apps/web/src/data/coinbase.ts:57-60). Apparier par ouverture exacte, comme mark et refCloseStrict (apps/web/src/chart/auxProvider.ts:760-762), sans report.
Éléments à ajouter : AuxSeriesId cbPremium, une entrée TTL_MS (Record exhaustif, auxProvider.ts:84) et un case dans rawFetch (auxProvider.ts:408).
Peg historique : il faut une référence USDT/USD paginable. Doc 02 §B7 suggère Coinbase USDT-USD ; sa disponibilité via l'adaptateur n'est pas vérifiée.
Indicateur : packages/indicators/src/derivatives/primeCoinbase.ts, câblé dans registry.ts ; registry.test.ts:20-21 compte 220.
Mesure préalable : scripts/valider-cbprem.ts avec manifeste figé, sur le modèle de scripts/valider-axis-flux.ts.

**Sources.**

- Coinbase Advanced Trade, Binance spot, Kraken USDT/USD (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà utilisés par CBPREM.

**Contrat.** z glissant dans CBPREM : correctif d'une fenêtre existante, effort S.
Extension à SOL et aux alts, aux et indicateur : nouvelle fonctionnalité, donc exception G100.
Toucher @axiom/types (BUILD-CONTRACT.md:81) et ajouter au catalogue (:82) seulement après une mesure favorable.
Aucun fournisseur ni hôte : api.coinbase.com est dans shared/extapi-hosts.ts:48, Binance et Kraken sont déjà là.
Coût : environ 3 pages Coinbase par 1000 bougies 4h, plus la jambe de peg ; cache public de 60 s du proxy. AXIS reste figé. Aucun enregistreur.

**Risques.** Alts peu liquides sur Coinbase : l'écart mesure surtout le spread et la latence, pas la demande américaine.
Derniers trades non simultanés à la clôture.
Peg non neutralisable au-delà de 720 bougies Kraken : une prime brute est biaisée par USDT.
Pagination Coinbase à 350 bougies par page, réponses 429 possibles.
Pics brefs peu informatifs (doc 02 §B7, docs/research/02-indicateurs-edge-crypto.md:194-200) : faux signaux sans exigence de persistance.
Phase 2 :
- L/S Binance limité à ~30 j et ETF journaliers sur 3 actifs : quadrant non validable en 4h ;
- redondance avec cvdSpotPerp.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. La phase 1 vaut d'être faite : sans nouvelle source ni nouvel hôte, elle corrige un défaut de causalité réel (bandes et z calculés sur toute la série) et produit un évènement de persistance testable selon le protocole AXIS. L'extension aux alts est à limiter aux paires Coinbase liquides, avec un plancher de volume figé.
La phase 2 est redondante avec cvdSpotPerp, squeezePressureIndex et le régime de marché, et exposée au sur-ajustement : la différer jusqu'à un verdict favorable de la phase 1. Les preuves restent de niveau praticien.

**Références.**

- docs/research/02-indicateurs-edge-crypto.md:194-200 (B7) : statut praticien. Seule la persistance compte, et la bascule de signe pendant une hausse sert d'alerte. Sources CoinGlass, Pickaxe et ainvest (:315-316), aucune étude prédictive.
- Makarov et Schoar (2020, Journal of Financial Economics), « Trading and Arbitrage in Cryptocurrency Markets » : écarts de prix entre places, persistants et régionaux, liés aux frictions de capitaux. Cela confirme que la prime mesure une demande segmentée, pas qu'elle prédit le prix. Cité de mémoire, non revérifié.
- Aucune étude académique sur le pouvoir prédictif de la prime Coinbase n'a pu être vérifiée : budget WebSearch épuisé.
- apps/web/src/data/cbprem.ts:116-139 : bandesPremium calculées sur toute la série, donc non causales.
- apps/web/src/data/cbprem.ts:142 : statsPremium.
- apps/web/src/store/cbprem.ts:46-50 : 720 bougies 1h sur 3 pages au plus.
- apps/web/src/chart/auxProvider.ts:238 : instantConnuCoinalyze.
- docs/revue-2026-09-26-profondeur-historique.md:112,192 : Coinbase à environ 1 340 ms par page.
- docs/research/02-indicateurs-edge-crypto.md:189 : L/S Binance limité à 30 j.

**Redondance.** La phase 1 ne fait doublon qu'avec la fenêtre CBPREM (BTC et ETH, environ 30 j). Elle corrige surtout sa causalité (cbprem.ts:116-142). L'indicateur premiumSpotPerp mesure autre chose (spot contre perp).
La phase 2 fait largement doublon :
- cvdSpotPerp compare déjà flux agresseur spot et perp, avec marqueurs de divergence (packages/indicators/src/strategy/cvdSpotPerp.ts:1-25) ; c'est déjà un « comptant contre levier » ;
- squeezePressureIndex combine funding z et ΔOI ;
- fundingZScore, netPositioningIndex et oiChange existent ;
- le régime de marché est calculé (apps/web/src/data/regime.ts:149).
Le quadrant ne serait qu'un composite d'éléments existants.

**Pièges.** Look-ahead d'horodatage : la bougie 1h est datée à son ouverture, mais la prime n'est connue qu'à la clôture. Sur un graphe 4h, il faut l'aligner sur l'instant connu, sur le modèle d'instantConnuCoinalyze (auxProvider.ts:238), sinon on lit une heure dans le futur.
Le z non causal actuel (cbprem.ts:116-139) ne doit pas être réutilisé en historique.
Alts : les carnets Coinbase sont minces, donc la prime y est dominée par l'écart achat-vente et le décalage du dernier échange. Coinbase ne publie pas de bougie sans transaction, ce qui crée des trous à ne pas reporter.
Peg : l'ajustement dépend de Kraken USDT/USD ; un trou de k supprime le point.
Ruptures structurelles : lancement des ETF spot (janvier 2024) et campagnes de frais nuls Binance qui déplacent le volume. Le z sur 168 h ne neutralise qu'en partie ces ruptures.
Coût réseau : environ 12 pages Coinbase par actif pour 1000 bougies 4h, à environ 1,3 s par page.
Phase 2 : historique L/S d'environ 30 j, donc un percentile sur 365 j est impossible sans Coinalyze. Rangs, axes, seuils et fenêtres multiplient les degrés de liberté et le risque de sur-ajustement. Tester de nombreux alts pose un problème de tests multiples.

**Protocole de validation.** Phase 1 seule, avec un script hors ligne calqué sur scripts/valider-axis-flux.ts.
Manifeste figé avant téléchargement : k = 2, persistance N h, fenêtre de 168 h, horizons 24 et 72 h, et le critère « bascule pendant une hausse » déclaré dès le départ, jamais ajouté après coup.
Données : historique horaire Coinbase, Binance (data.binance.vision) et Kraken USDT/USD.
Cellules BTC, ETH et SOL ; explorer sur la période antérieure à une date de coupure, puis un seul test sur la période postérieure jamais vue.
Nul par décalage circulaire commun ; au moins 50 évènements par cellule, sinon NON CONCLUANT.
Rapporter séparément l'avant et l'après ETF.
Apport incrémental : comparer avec cvdSpotPerp seul (même évènement avec et sans condition de prime).
Phase 2 seulement si la phase 1 est FAVORABLE, et validée sur l'historique L/S de Coinalyze. AXIS reste figé.

**Preuve d'intérêt (idéation).** Doc 02 §B7 : c'est la persistance de la prime qui compte, et sa bascule pendant une hausse sert d'alerte (docs/research/02-indicateurs-edge-crypto.md:194-200), statut praticien. Le z glissant est une exigence de causalité.

**Mesure de succès.** Manifeste figé, BTC/ETH/SOL 4h : persistance ≥ N h au-delà de +2σ, rendement signé 24/72 h, ≥ 50 évènements par cellule, p ≤ 0,05 ; phase 2 : quadrant « levier haut, comptant bas » négatif à 72 h, p ≤ 0,05 et signe tenu dans 3 cellules sur 4.

**Fichiers à toucher.**

- apps/web/src/data/cbprem.ts
- apps/web/src/data/cbprem.test.ts
- apps/web/src/store/cbprem.ts
- apps/web/src/components/CbpremWindow.tsx
- scripts/valider-cbprem.ts (nouveau)
- scripts/axis/manifeste-cbprem-<date>.json (nouveau)
- packages/types/src/index.ts (conditionnel)
- apps/web/src/chart/auxProvider.ts (conditionnel)
- packages/indicators/src/derivatives/primeCoinbase.ts et .test.ts (conditionnel)
- packages/indicators/src/registry.ts et registry.test.ts (conditionnel)

**Avis des juges.**

- valeur (3) : La prime Coinbase est un signal de demande US suivi. Le z actuel est non causal : moyenne et σ sur toute la série (apps/web/src/data/cbprem.ts:118-132). Le corriger et étudier avant tout indicateur est sain. Sur les alts, la prime mesure surtout le spread.
- cout-risque (4) : Correctif S d'abord. Défaut vérifié : z et bandes calculés sur toute la série (apps/web/src/data/cbprem.test.ts:248, :262), donc non causal à l'affichage historique. Étude avant tout catalogue. Aucun hôte : api.coinbase.com est déjà en /extapi. Coûts : pagination de 350 bougies par page, 429 possibles, peg Kraken limité à 720 bougies.
- coherence (5) : Le correctif est vérifié : les bandes et le z de CBPREM sont calculés sur toute la série (data/cbprem.ts:113-132, moyenne et σ de population), donc non causaux. Corriger une fenêtre existante, puis mesurer avant tout aux ou def : c'est le protocole du dépôt.

### 8. SUG-C4 — EQS ouvert au registre : tout indicateur scalaire comme critère, conditions d'évènement (croisement, sortie de squeeze, divergence apparue, NR7) et concordance multi-unité 4h + 1d

**Score 15/20** · valeur 4 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : critique de complétude, trou AT de l'inventaire : limites du screener EQS

**Question de trading.** Parmi 60 alts, lesquelles sortent d'un squeeze en 4h avec un Supertrend 1d haussier, ou affichent une divergence RSI apparue dans les 3 dernières bougies au-dessus de l'EMA 200 ?

**Proposition retenue après vérification.** Aligner EQS sur le modèle de conditions du BT au lieu d'un nouveau sélecteur sur tout le registre. Opérandes de CATALOGUE_OPERANDES (+ ttmSqueeze.on et narrowRange), conditions comparaison et croisement, plus une fenêtre « dans les K dernières bougies clôturées » et au plus une unité supplémentaire par condition (ex. run 4h, filtre Supertrend 1d). Le worker évalue sur des bougies clôturées, avec l'amorce des définitions et le timeframe passé. Un préréglage nouveau, « Sortie de squeeze 4h, Supertrend 1d haussier ». La divergence RSI fraîche existe déjà dans Signaux. Un résultat ouvre le graphe avec les instances de ses conditions. Les définitions à série aux sont exclues en phase 1.

**Proposition initiale.** Remplacer la liste curée de 5 champs par un sélecteur sur les définitions du registre dont la sortie est scalaire et qui n'exigent pas de série aux (phase 1). Trois dérivations de plus : « croise au-dessus/au-dessous de X dans les K dernières bougies », « croisement de deux sorties » (ligne/signal), « annotation présente dans les K dernières bougies » (divergences, NR7, état de squeeze tirés du canal d'annotations). Chaque condition porte son unité (15m à 1d), et le worker charge au plus deux unités par symbole avec amorce. Préréglages « Sortie de squeeze 4h, tendance 1d », « Divergence RSI fraîche ». Les résultats ouvrent le graphe avec les mêmes instances, d'où une parité exacte.

**Ce qui existe déjà.** EQS : 5 champs curés (apps/web/src/data/screener.ts:291-341), dérivations last/distPct/lastPct (:286), une unité par run (SCREENER_TIMEFRAMES :46), 200 bougies seulement (SCREENER_KLINE_LIMIT :49). Le worker appelle computeIndicator sans aux ni timeframe (apps/web/src/workers/screener.worker.ts:107), ignore le volume acheteur taker (k[9]) dans fetchCandles (:60-80) et lit la dernière valeur définie, donc la bougie EN FORMATION. Déjà présent ailleurs : la vue Signaux d'EQS détecte une divergence RSI 4h « fraîche » (FRAICHEUR_DIVERGENCE = 15 bougies, apps/web/src/data/signaux.ts:68-70, détecteur :223). Le préréglage « Divergence RSI fraîche » fait donc doublon. Un modèle de conditions générique existe déjà dans le BT : Operande prix|constante|indicateur, comparaison et croisement (packages/backtest/src/types.ts:42-81). Il a son catalogue curé d'opérandes, environ 30 avec Stoch, Supertrend direction, Bollinger, ADX, PSAR et AXIS (apps/web/src/store/backtest.ts:177-212), son interface OperandeSelect/ConditionRow (apps/web/src/components/BacktestWindow.tsx:129, :187) et ses gardes raisonOperandeNonCausale et raisonTimeframeBacktest (packages/backtest/src/engine.ts:85, :674). Les alertes ont aussi indicateur-seuil et indicateur-croisement (packages/alerts/src/types.ts:45-69). ttmSqueeze expose une série « on » (volatility/ttmSqueeze.ts:79-82) et narrowRange existe (volatility/narrowRange.ts:8) : leurs évènements se dérivent des transitions de série, sans canal d'annotations. ouvrirDansChart n'ouvre que le symbole, sans instances (apps/web/src/store/screener.ts:264-271).

**Réutilise.** computeIndicator et registre, canal d'annotations (packages/indicators/src/utils-annotations.ts:56), TIMEFRAME_REQUIS et supportsIndicatorTimeframe (packages/indicators/src/timeframes.ts:8, :15), cache de klines du worker, détecteurs de signaux.ts pour les préréglages.

**Point d'intégration.** Remplacer IndicatorCondition d'EQS par le type Condition de @axiom/backtest, enrichi d'une unité facultative (au plus 1 unité de plus que celle du run) et d'une fenêtre K (« vraie sur au moins une des K dernières bougies clôturées »). Réutiliser CATALOGUE_OPERANDES (en y ajoutant ttmSqueeze.on et narrowRange) et ConditionRow dans ScreenerWindow. Dans le worker : exclure la bougie en formation, passer le timeframe, adapter le nombre de bougies à l'amorce des définitions utilisées (amorceBougies) avec plafond, et lire k[9] ou refuser les définitions qui exigent buyVolume. Ouverture au graphe : navigateTo puis ajout des instances dans indicatorsStore.

**Sources.**

- Binance spot /api/v3/klines (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà appelé par le worker ; au plus une unité de plus par symbole et par run, poids à mesurer.

**Contrat.** Exception G100 légère : nouveaux réglages d'une fenêtre existante, sans fenêtre ni indicateur nouveau. Aucun fournisseur : Binance spot /api/v3/klines appelé en direct depuis le navigateur (CORS), sans proxy ni clé. Contrat d'unité respecté via supportsIndicatorTimeframe et raisonTimeframeBacktest. Les définitions à série aux restent exclues en phase 1. Aucun impact sur le chargement initial (worker chargé à la demande).

**Risques.** 1) Quotas Binance : 60 symboles × 2 unités, avec un limit porté de 200 à 1000 pour l'amorce de l'EMA 200 ; le poids par requête croît avec limit (non vérifié dans cette session). Le throttle à 100 ms (worker:31) double la durée du run. 2) Parité avec le graphe fausse sans amorce : avec 200 bougies, l'EMA 200 n'a qu'une valeur amorcée par la SMA. 3) Repeinte : l'évaluation actuelle lit la bougie en formation. 4) Multiplication des essais : chaque nouveau filtre est un test non corrigé. La validation existante (etudeEvenements) ne mesure que des horizons fixes en bougies 4h (HORIZONS_VALIDATION, validationSignaux.ts:40-43), donc pas des préréglages en 15m ou 1d. 5) Ouvrir tout le registre (219 définitions, sorties non scalaires, aux) multiplie les cas morts ; le catalogue curé du BT évite ce piège.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Utile pour chercher des actifs : la limite actuelle de 5 champs et d'une unité est réelle. Deux défauts du worker invalident la parité promise et doivent être corrigés d'abord : la bougie en formation et l'amorce de 200 bougies. Retirer le préréglage « divergence RSI fraîche », déjà présent dans EQS. Ne présenter aucun préréglage comme validé tant qu'il n'a pas passé le protocole. Références externes non vérifiées : quota de recherche épuisé.

**Références.**

- apps/web/src/data/screener.ts:36 (SCREENER_CAP = 60), :49 (SCREENER_KLINE_LIMIT = 200) et :290 (INDICATOR_FIELDS curé).
- apps/web/src/workers/screener.worker.ts:60-80 : toutes les klines sont gardées, bougie en formation comprise. :107 : computeIndicator est appelé sans aux ni timeframe.
- apps/web/src/data/signaux.ts:68-70 et :223-288 : la divergence RSI fraîche est déjà détectée en mode signaux d'EQS (FRAICHEUR_DIVERGENCE = 15). :417 : retournement AXIS.
- apps/web/src/data/validationSignaux.ts:67-70 : biais de sélection de l'univers top-volume documenté (listings frais).
- docs/axis-2026-10-07.md:1005-1008 : AXIS ne combine pas plusieurs unités, et seul le 4h est validé. scripts/axis/rapport-flux-2026-10-08.md:8-10 : fort achat validé en 4h.
- packages/indicators/src/volatility/ttmSqueeze.ts, volatility/narrowRange.ts et strategy/stratSqueezeBreakout.ts : le squeeze et NR7 existent déjà.
- Elder A., Trading for a Living (1993), Triple Screen : concordance multi-unité, de pratique. Cité de mémoire, non vérifié.
- Screener TradingView multi-indicateurs et multi-unités : non vérifié (hôte injoignable). Poids de /api/v3/klines selon limit : non vérifié.

**Redondance.** Partielle. Le mode signaux d'EQS couvre déjà la divergence RSI fraîche, le retournement AXIS et le funding extrême : le préréglage « Divergence RSI fraîche » est redondant. La concordance multi-unité existe déjà dans BRIEF pour le symbole courant (apps/web/src/data/multiEchelle.ts:21), et ttmSqueeze, narrowRange et stratSqueezeBreakout existent. L'apport réel tient en trois points : le registre ouvert au screener, les dérivations d'évènements (croisement dans les K bougies) et une seconde unité.

**Pièges.** (1) Repaint : le worker conserve la bougie en cours (screener.worker.ts:60-80, sans filtre de clôture). Un « croisement dans les K dernières bougies » peut donc apparaître puis disparaître pendant la bougie. Il faut exclure la dernière bougie non close. (2) Amorce : avec 200 bougies (screener.ts:49), l'EMA 200 n'est que sa graine SMA, et les lissages RMA (RSI, ATR, Supertrend) ne convergent pas. La parité promise avec le graphe, qui dispose d'un long historique, échoue donc, notamment pour le préréglage « au-dessus de l'EMA 200 ». Il faut au moins 3 à 4 fois la longueur, ce qui coûte plus de poids API. (3) ctx.timeframe n'est pas transmis (screener.worker.ts:107), donc les définitions qui dépendent de l'unité divergent du graphe. (4) Biais de sélection de l'univers top-volume du jour (validationSignaux.ts:67-70) et biais du survivant (symboles délistés absents). (5) Multiplicité : 60 symboles fois N conditions donnent des sorties dues au hasard ; un screener filtre, il ne prédit pas. (6) La concordance 4h plus 1d n'est validée nulle part dans le dépôt. (7) Une seule plateforme, Binance spot : les alts sans spot Binance sont exclues.

**Protocole de validation.** D'abord la parité EQS/graphe, après exclusion de la bougie en cours et avec une amorce suffisante : 10 symboles fois 3 conditions, même valeur et même bougie de déclenchement. Ensuite, chaque préréglage passe par etudeEvenements sur l'univers majors, et non sur le top-volume, aux horizons 24 h et 72 h, comparé au drift inconditionnel. Puis manifeste figé et test sur données postérieures, avec le critère C3 de décalage circulaire pour « squeeze 4h et tendance 1d ». Avant ce test, le libellé reste « filtre descriptif », jamais « signal ».

**Preuve d'intérêt (idéation).** Le screener de TradingView filtre sur de nombreux indicateurs et unités (non vérifié dans cette session). Interne : les signaux AXIS et le fort achat validé hors échantillon (scripts/axis/rapport-flux-2026-10-08.md:8-10) ne sont cherchables qu'actif par actif ; l'univers EQS plafonne à 60 symboles avec 5 champs.

**Mesure de succès.** Parité EQS/graphe sur 10 symboles × 3 conditions (même valeur, même bougie de déclenchement) ; durée d'un run ≤ 2 × l'actuelle pour 2 unités ; chaque préréglage passe par etudeEvenements avant d'être livré, n et rendement signé affichés.

**Fichiers à toucher.**

- apps/web/src/data/screener.ts (spécification de condition, préréglages BUILTIN_PRESETS :492)
- apps/web/src/workers/screener.worker.ts (multi-unité, bougies clôturées, amorce, timeframe)
- apps/web/src/store/screener.ts (requête de run, ouvrirDansChart avec instances)
- apps/web/src/components/ScreenerWindow.tsx (ConditionRow réutilisé)
- apps/web/src/store/backtest.ts (CATALOGUE_OPERANDES exporté et partagé, + ttmSqueeze/narrowRange)
- packages/backtest/src/index.ts (export d'un évaluateur de condition par index, aujourd'hui interne : evaluerCondition, engine.ts:202)
- apps/web/src/data/screener.test.ts

**Avis des juges.**

- valeur (4) : Très actionnable pour un trader d'alts : scanner 60 symboles sur des événements (sortie de squeeze 4h et Supertrend 1d) au lieu de seuils RSI, EMA et MACD seulement (apps/web/src/data/screener.ts:290). Lecture sur bougie close et amorce correcte obligatoires. Aucune preuve d'avantage, mais un gain de couverture réel.
- cout-risque (3) : Binance spot direct sans clé. Mais 60 symboles × 2 unités avec limit 1000 (contre SCREENER_KLINE_LIMIT = 200, apps/web/src/data/screener.ts:49) alourdissent poids et durée. Le worker lit la bougie en cours, d'où des croisements qui apparaissent puis disparaissent. La parité avec le graphe exige l'amorce. Effort M avec un risque de résultats non reproductibles.
- coherence (4) : Réutilise CATALOGUE_OPERANDES du BT (store/backtest.ts) et le worker EQS, sans fenêtre ni def. Il faut écarter la bougie en cours et charger l'amorce, et la double unité double les requêtes.

### 9. SUG-C8 — ΔOI d'options par strike et échéance sur 24 h et 7 j (instantanés compacts de la chaîne Deribit) : murs naissants et murs qui se vident

**Score 15/20** · valeur 3 · coût-risque 4 · cohérence 5 · effort révisé **S** (initial S) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : options · origines : critique de complétude, trou dérivés de l'inventaire : ΔOI options par strike

**Question de trading.** Les murs de calls et de puts de vendredi viennent-ils d'être construits cette semaine (positionnement frais) ou se vident-ils, et à quels strikes l'OI neuf se concentre-t-il ?

**Proposition retenue après vérification.** OMON › Heatmap reçoit une quatrième métrique « ΔOI » pour BTC et ETH Deribit. Un instantané agrégé (échéance, strike, type, OI) est pris par devise et par jour UTC, après 08:00 UTC, au premier chargement réussi de la chaîne. Patron J-1/J-7 de TERM : localStorage, doublé dans le KV si le daemon est présent ; seuls J-1 et J-7 sont conservés. Δ par strike et échéance en contrats et en USD au spot, échéances expirées exclues, instruments nouveaux marqués. La date de l'instantané de référence est toujours affichée (« Δ depuis le <date heure UTC> »). Top 5 des strikes construits et vidés pour l'échéance sélectionnée, sans libellé d'interprétation directionnelle. En lot 2, après 4 semaines de couverture mesurée : collecteur daemon deux fois par jour et étiquette « +x BTC sur 7 j » (toutes échéances) à côté des murs gamma du graphe. L'étude d'attraction des strikes est différée jusqu'à 24 échéances observées.

**Proposition initiale.** Deux fois par jour (même horaire que SUG-20 s'il est livré), le daemon stocke dans le KV l'OI par instrument de la chaîne BTC/ETH (strike, échéance, type, OI) ; repli localStorage par visiteur sur Vercel, 8 jours glissants, avec la couverture affichée. Calcul pur : ΔOI 24 h et 7 j par strike × échéance, en contrats et en USD au spot ; carte Δ (rouge et vert) sur la grille de la heatmap OI ; top 5 des strikes « naissants » et « vidés » ; option sur le graphe : étiquette « +x BTC sur 7 j » à côté des murs de niveauxOptions. Instruments expirés exclus du Δ.

**Ce qui existe déjà.** La heatmap OI est un instantané : construireGrilleOi (oiHeatmap.ts:57) avec trois métriques oi, gex et volume (OptionsWindow.tsx:207, omon/VueHeatmap.tsx:17). P/C volume 24 h calculé à OptionsWindow.tsx:436-445. Patron d'instantanés J-1/J-7 côté front dans TERM : sauverSnapshot et lireSnapshot (TermStructureWindow.tsx:109 et :123), namespace « termstructure » (:70), kvPut seulement si daemonPret (:119), appel à :437. Le ΔOI n'existe que pour les perps (ScreenerWindow.tsx:523-641, SqueezeWindow.tsx). Côté daemon, aucun appel Deribit (grep sur apps/daemon/src : proxy.ts seulement). demarrerBoucleSnapshots (index.ts:34 et :160) est la sauvegarde quotidienne du KV (snapshots.ts:1-27), pas un collecteur : la boucle proposée serait nouvelle, sur le patron de whales.ts ou globe.ts. OptionPoint porte déjà instrument, strike, échéance, type et openInterest (deribit.ts:232-255). Les murs de niveauxOptions sont des murs de GAMMA toutes échéances confondues (niveauxOptions.ts:2-6 et :79), pas des murs d'OI.

**Réutilise.** chargerChaineOptions (apps/web/src/data/chaineOptionsCache.ts:27), construireGrilleOi et bandeStrikes (oiHeatmap.ts:57, :135), kvGet/kvPut et demarrerBoucleSnapshots (apps/daemon/src/index.ts:34), murs de niveauxOptions.

**Point d'intégration.** Instantané pris côté front au premier chargement réussi de la chaîne : hook useOptionsDeribit (hooks/useOptionsDeribit.ts:17) et éventuellement chargerChaineOptions (chaineOptionsCache.ts:27). Un instantané par devise et par jour UTC, après le règlement Deribit de 08:00 UTC, agrégé par strike, échéance et type. Stockage localStorage, doublé par kvPut si le daemon est présent, comme TERM. Module pur apps/web/src/data/deltaOiStrikes.ts. Quatrième métrique « ΔOI » dans heatmapMetrique (OptionsWindow.tsx:207, VueHeatmap.tsx:17), avec la grille et bandeStrikes (oiHeatmap.ts:57 et :135). Le collecteur daemon (nouvelle boucle dans apps/daemon/src/index.ts, hôte www.deribit.com déjà en liste blanche à shared/extapi-hosts.ts:31) viendrait en lot 2, seulement si la couverture côté front ne suffit pas.

**Sources.**

- Deribit public/get_book_summary_by_currency (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà chargé (open_interest par instrument). CGU : usage personnel, publication soumise à accord (vérifié dans le catalogue, risque déjà présent sur OMON).

**Contrat.** Aucun nouveau fournisseur, hôte ni clé. Ce n'est pas un enregistreur interdit (BUILD-CONTRACT.md:88) tant qu'il s'agit d'un ou deux instantanés agrégés par jour, comme TERM. Exception G100 : nouvelle métrique dans une fenêtre existante (BUILD-CONTRACT.md:71) ; l'étiquette sur le graphe est une seconde surface, à reporter. Budget initial nul (OMON est chargé à la demande). Deribit est déjà affiché publiquement par OMON : CGU de redistribution non vérifiées dans cette passe, risque préexistant et inchangé. Effort M avec le collecteur daemon et l'étiquette sur le graphe.

**Risques.** Couverture : sur Vercel sans daemon, un Δ n'existe que si le même navigateur a ouvert OMON à J-1 ou J-7. Il faut donc afficher « Δ depuis l'instantané du <date> », jamais un « 24 h » implicite ; avec daemon, la couverture dépend de la machine allumée. Stockage : la chaîne complète pèse environ 400 Ko (chaineOptionsCache.ts:5). Même compactés (environ 1 000 instruments BTC, estimation non mesurée), 32 instantanés sur 8 jours prendraient plusieurs centaines de Ko d'un localStorage d'environ 5 Mo partagé avec le reste. Interprétation : le ΔOI ne dit ni qui est acheteur ou vendeur ni le signe du gamma des teneurs de marché, et un bloc ou un roulement isolé fabrique un « mur naissant ». Les instruments nouvellement listés (Δ = OI entier) et les règlements de 08:00 UTC faussent le Δ s'ils ne sont pas traités. « Σ ΔOI = variation totale » est une identité : test unitaire, pas une mesure de succès. L'étude d'attraction des strikes demande au moins 24 échéances hebdomadaires, soit 6 mois de collecte avant toute conclusion.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Bonne question de trading, coût faible, aucun hôte ni fournisseur nouveau. Le collecteur opt-in a un vrai précédent contractuel (hlLiqHeat, BUILD-CONTRACT.md:411-414), et non snapshots.ts, qui est une sauvegarde du KV. L'intérêt informatif du ΔOI brut reste toutefois peu documenté : la littérature sur le pinning (actions, S&P) porte sur l'OI total et le delta-hedging, et celle sur l'information des options sur le volume signé. Trois conditions avant de l'appeler outil d'analyse : (1) intégrer IBIT/ETHA, déjà chargés, ou afficher « Deribit seul » ; (2) neutraliser les strikes nouvellement cotés et les roulements d'échéance ; (3) libellé non signé tant qu'aucun signe taker n'est disponible. Sur le site public, la vue sera presque toujours vide faute d'historique : la limiter au mode daemon ou l'afficher avec sa couverture. Recherche web épuisée : littérature citée de mémoire, CGU Deribit non vérifiées.

**Références.**

- Ni, Pearson et Poteshman, « Stock price clustering on option expiration dates », Journal of Financial Economics, 2005 : effet d'aimant (« pinning ») sur actions optionnables (de mémoire, non vérifié en ligne)
- Golez et Jackwerth, « Pinning in the S&P 500 futures », Journal of Financial Economics, 2012 (de mémoire, non vérifié)
- Avellaneda et Lipkin, « A market-induced mechanism for stock pinning », Quantitative Finance, 2003 (de mémoire, non vérifié)
- Pan et Poteshman, « The information in option volume for future stock prices », Review of Financial Studies, 2006 : l'information vient du volume d'ouverture SIGNÉ (achat ou vente), pas de l'OI brut (de mémoire, non vérifié)
- docs/research/01-fournisseurs-api-indicateurs.md:18-21 (Tardis : échantillons gratuits le 1er du mois ; Laevitas API 500 $/mois ; Amberdata sur devis)
- apps/web/src/data/cboe.ts:1-16,33,97 (chaînes IBIT et ETHA déjà chargées via CBOE delayed quotes, avec open_interest)
- apps/web/src/data/oiHeatmap.ts:57,135 (construireGrilleOi, bandeStrikes)
- apps/web/src/components/OptionsWindow.tsx:435-444 (seul le P/C volume 24 h est calculé)
- apps/web/src/components/TermStructureWindow.tsx:87-119 (patron d'instantanés J-1/J-7)
- BUILD-CONTRACT.md:68 et :411-414 (précédent : collecteur daemon opt-in hlLiqHeat toutes les 5 min, rétention 14 j)
- apps/daemon/src/snapshots.ts:1-15 (sauvegarde du KV, « aucune collecte » : ce n'est pas le précédent invoqué)

**Redondance.** Faible. La heatmap OI est un instantané (oiHeatmap.ts:57) ; max pain, GEX/DEX et murs de niveauxOptions sont statiques ; seul le P/C volume 24 h existe (OptionsWindow.tsx:435-444) ; le patron d'instantanés se limite à la basis de TERM (TermStructureWindow.tsx:87-119). Aucun ΔOI par strike dans le dépôt. Point manqué par la proposition : les chaînes IBIT et ETHA (CBOE, cboe.ts:33, :97) sont déjà chargées avec l'OI et devraient entrer dans le Δ, sinon la vue reste mono-plateforme.

**Pièges.** (1) Le ΔOI n'est pas signé. Un +OI sur un strike call peut venir de ventes couvertes (overwriting, neutre ou baissier) autant que d'achats spéculatifs. Le libellé « positionnement frais haussier » serait faux. Pan et Poteshman tirent l'information du volume d'ouverture signé, introuvable ici. On peut l'approcher avec le sens taker des trades Deribit (public/get_last_trades_by_currency, champ direction, non vérifié en ligne), au prix d'un recoupement avec SUG-22. (2) Mécanique de cotation : Deribit ouvre de nouveaux strikes quand le prix se déplace. Un strike absent à J-7 « naît » de 0 et les murs naissants suivent le prix par construction. (3) Roulements : à chaque échéance du vendredi, l'OI glisse vers l'échéance suivante, ce qui gonfle le ΔOI 7 j sans information nouvelle. Il faut neutraliser par échéance et signaler les semaines d'échéance mensuelle ou trimestrielle. (4) Données d'une seule plateforme : Deribit seul ignore IBIT, CME, OKX, Bybit et Binance. Le poids des options IBIT est devenu comparable à celui de Deribit (de mémoire, non vérifié). L'OI des options cotées aux États-Unis n'est publié qu'une fois par jour par l'OCC (de mémoire), donc le Δ 24 h d'IBIT sera journalier. (5) Instantanés : un passage manqué ne doit pas transformer un « 24 h » en 36 h en silence. Stocker l'horodatage exact et afficher l'intervalle réel. (6) Couverture publique : sans daemon, l'historique ne vit que dans le localStorage du visiteur, donc vide pour un visiteur occasionnel. Seul le poste du propriétaire avec daemon aura une série exploitable. (7) Aucun historique gratuit pour amorcer la série (Laevitas et Amberdata sont payants, Tardis n'offre que le 1er du mois, docs/research/01:18-21). La validation exige donc au moins 6 mois de collecte prospective. (8) Biais de proximité dans la mesure proposée : les strikes à fort ΔOI sont proches du prix au moment de la mesure. Comparer |S_T − K| à des strikes aléatoires non appariés en distance donnerait une victoire triviale. (9) CGU Deribit pour l'affichage public non vérifiées : aucune mention trouvée dans le dépôt par grep, recherche web épuisée.

**Protocole de validation.** Tests unitaires : Σ ΔOI par échéance égale la variation de l'OI total à 1e-9, strikes nés ou expirés traités explicitement, intervalle réel stocké. Collecte prospective figée avant toute analyse (manifeste hashé : horaires, définition du top 5 « naissants », seuil minimal d'OI, exclusion des 48 h avant échéance pour le Δ 7 j). Hypothèse primaire unique, par devise : pour chaque échéance hebdomadaire, le strike du top ΔOI 7 j mesuré à J-7 est-il plus proche de S_T que (a) le strike de plus fort OI, (b) le max pain, (c) un strike aléatoire de même distance au spot à J-7 (appariement par moneyness) ? Statistique appariée sur au moins 26 échéances BTC (et ETH à part), IC par bootstrap, verdict pré-déclaré publié quel qu'il soit. Contrôle d'artefact : refaire le test en excluant les strikes absents à J-7. Variante descriptive : ΔOI signé par le volume taker si SUG-22 est livré. Tant que le verdict n'est pas favorable, l'étiquette graphique dit « +x BTC d'OI sur 7 j (non signé) » et jamais « positionnement ».

**Preuve d'intérêt (idéation).** L'OI seul ne distingue pas un mur ancien d'un positionnement neuf ; le ΔOI le fait par construction. Aucune étude sur le pouvoir d'attraction des strikes à forte construction d'OI : à mesurer avec le test d'échéances de SUG-24.

**Mesure de succès.** Σ ΔOI par échéance = variation de l'OI total de l'échéance à 1e-9 ; ≥ 95 % des passages couverts sur 30 j avec daemon ; sur ≥ 24 échéances hebdomadaires, |S_T − K| des strikes du top ΔOI 7 j comparé aux strikes de plus fort OI et à des strikes aléatoires, IC bootstrap publié.

**Fichiers à toucher.**

- apps/web/src/data/deltaOiStrikes.ts (nouveau, + test)
- apps/web/src/hooks/useOptionsDeribit.ts
- apps/web/src/components/OptionsWindow.tsx
- apps/web/src/components/omon/VueHeatmap.tsx
- apps/web/src/components/omon/dessins.ts
- apps/daemon/src/oiOptions.ts (lot 2, nouveau, + test)
- apps/daemon/src/index.ts (lot 2)
- apps/web/src/chart/niveaux/niveauxOptions.ts (lot 2, étiquette)

**Avis des juges.**

- valeur (3) : Distinguer les murs d'options frais des murs qui se vident apporte une information nouvelle sur le positionnement BTC/ETH (OMON ne propose qu'OI, GEX et volume, apps/web/src/components/omon/VueHeatmap.tsx:17). Mais le ΔOI n'est pas signé, et la couverture dépend du navigateur ou du daemon.
- cout-risque (4) : Effort S, aucune requête nouvelle (chaîne Deribit déjà chargée), instantané compact au patron TERM (TermStructureWindow.tsx, localStorage). Risques : couverture lacunaire sur Vercel (afficher « Δ depuis le <date> »), ΔOI non signé (aucun libellé directionnel), taille du stockage à mesurer (chaîne d'environ 400 Ko non compactée).
- coherence (5) : Une 4e métrique dans la Heatmap OI d'OMON, qui a déjà OI, |GEX| et Volume (OptionsWindow.tsx:669-671). Elle reprend tel quel le patron J-1/J-7 de TERM (daemon /kv et repli localStorage, TermStructureWindow.tsx:7, 87). Aucun fournisseur, aux ou def.

### 10. SUG-1 — Indicateurs d'unité supérieure sur le graphe (RSI 4h ou EMA 1d sur un graphe 1h), lus à la clôture sans repeinture

**Score 14/20** · valeur 4 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-1

**Question de trading.** Mon entrée 1h/4h va-t-elle dans le sens de la tendance 4h, 1d ou 1w, sans ouvrir un second graphe ?

**Proposition retenue après vérification.** Phase 1, graphe seul : paramètre réservé « unité » limité aux defs prix sans aux, sans annotations et sans unité requise, hors stratégies. Places 24/7 seulement (Binance, Bybit, OKX, Hyperliquid, MEXC, Kraken ; Coinbase sans 1w ; Twelve Data exclu). Couples alignés 1h→4h/1d, 4h→1d/1w, 1d→1w. Bougies supérieures chargées avec l'amorce de la def par un chunk paresseux, dernière bougie non close exclue, projection alignAux en mode clôture, légende suffixée « [4h] ». Paramètre refusé avec motif dans les imports d'alertes et de BT. Mesure : égalité exacte avec le calcul natif sur le même jeu de bougies supérieures, test de causalité par préfixe, une requête par instance et par clôture supérieure. Retirer la référence à AXIS v5 comme preuve (c'est un filtre BTC dans la même unité).

**Proposition initiale.** Paramètre réservé « unité » sur toute instance d'indicateur prix. Le graphe charge les bougies de cette unité (même adaptateur, avec amorce), calcule, puis projette chaque valeur à la clôture de la bougie supérieure via une fonction pure projeterSurUnite qui réutilise alignAux en mode clôture. Menu limité aux multiples alignés UTC (1h→4h/1d, 4h→1d/1w, 1d→1w). Option « bougie en cours » étiquetée « repeint ». Phase 1 : graphe seul, paramètre refusé avec motif dans alertes et BT ; phase 2 : même fonction pour alertes et BT.

**Ce qui existe déjà.** Aucune projection d'unité supérieure sur un graphe : grep htf|mtf ne trouve que la case manuelle de PAPER (apps/web/src/components/PaperWindow.tsx:701-703). Ce qui existe déjà : (1) la section BRIEF multi-échelle, en lecture seule (apps/web/src/data/multiEchelle.ts:21, 124-134 : 15m/1h/4h/1d, EMA50/RSI/ATR) ; (2) la grille multi-graphe, avec une unité par vue (setSlotTimeframe, apps/web/src/store/chart-layout.ts:90) et un réticule synchronisé par défaut (chart-layout.ts:160). On voit donc déjà le 4h à côté du 1h, mais sur deux vues. Le calcul du graphe est mono-unité (apps/web/src/chart/indicators.ts:427-436). La preuve interne citée est fausse : le garde-fou AXIS v5 lit l'EMA100 de BTC dans la même unité, via refClose (packages/indicators/src/strategy/stratAxis.ts:162-170). C'est un filtre de régime entre actifs, pas une lecture d'unité supérieure.

**Réutilise.** alignAux mode clôture (packages/indicators/src/utils-aux.ts:37), IndicatorInstance.params ouvert (packages/types/src/index.ts:451-454), amorceBougies, supportsIndicatorTimeframe (packages/indicators/src/timeframes.ts:15).

**Point d'intégration.** ChartIndicators.calculerInstance (apps/web/src/chart/indicators.ts:470 et suivantes). Si inst.params.unite est posé : (1) charger les bougies de cette unité via getAdapter(exchange).fetchKlines, avec l'amorce de la def (IndicatorDef.amorceBougies, packages/types/src/index.ts:409) ; (2) appeler computeIndicator(def, bougiesSup, params sans 'unite', undefined, unite) (packages/indicators/src/engine.ts:113-127) ; (3) projeter avec alignAux(tempsGraphe, points horodatés à la CLÔTURE de la bougie supérieure, true) (packages/indicators/src/utils-aux.ts:37), qui est déjà la convention « instant connu + mode clôture » (utils-aux.ts:12-17). Aucun changement de @axiom/types : IndicatorInstance.params est ouvert (packages/types/src/index.ts:451-454) et resolveParams laisse passer les clés inconnues (engine.ts:84-89). L'éditeur n'itère que def.inputs (apps/web/src/components/InstanceParamsEditor.tsx:25) : il faut y ajouter un sélecteur dédié.

**Sources.**

- Bougies OHLCV des adaptateurs existants (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Une requête par instance et par clôture de l'unité supérieure, avec cache.

**Contrat.** Exception G100 nécessaire : c'est une nouvelle fonction de surface (BUILD-CONTRACT.md:71). Aucun fournisseur, aucun hôte, aucune clé serveur, aucun indicateur nouveau. Budget d'entrée : indicators.ts et InstanceParamsEditor sont sur le chemin initial. La marge est d'environ 4 ko gzip (1 188 308 / 355 986 contre 1 220 000 / 360 000, BUILD-CONTRACT.md:2124), donc le chargeur doit être un import dynamique. Le contrat d'unité commun graphe/alertes/BT (packages/indicators/src/timeframes.ts:13-17) impose un refus explicite hors graphe en phase 1. Le risque réel se limite aux imports JSON : ni les alertes ni le BT ne lisent les instances du graphe (indicatorsStore n'est consommé que par les menus, la persistance et les jeux d'indicateurs).

**Risques.** (1) L'égalité exacte avec le calcul natif ne tient que sur le même jeu de bougies supérieures : l'amorçage EMA/RSI dépend de la première bougie. Il faut charger l'unité supérieure avec son amorce et non la rééchantillonner depuis le buffer du graphe (500 bougies par défaut, apps/web/src/chart/ChartInstance.tsx:1225, soit environ 21 j en 1h). (2) Il faut exclure la dernière bougie supérieure non close ; sinon le tracé repeint. (3) Les defs à aux ou auxFacultatives, à annotations indexées (idx calculés sur l'unité supérieure), réservées à une unité (TIMEFRAME_REQUIS : rvolSeasonal, stablecoinPrint) et les stratégies sont à refuser en phase 1. (4) Sources : Coinbase n'a pas de 1w (apps/web/src/data/adapters.ts:93). Twelve Data est plafonné à 8 req/min et 800 par jour (apps/web/src/data/twelvedata.ts:15), avec des bougies d'actions calées sur les séances, non alignées UTC. Phase 1 à limiter aux places 24/7. (5) La phase 2 (alertes et BT) recoupe IDEE-4 des suggestions exclues (contrôle HTF de PAPER) : ne pas y toucher. (6) La preuve citée « Liu & Tsyvinski, RFS 2021 » n'a pas été vérifiée en ligne ici, faute de budget de recherche.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. L'intérêt réel tient à trois cas : les oscillateurs à seuils, les indicateurs de structure, et surtout la lecture d'AXIS 4h (la seule chose validée) depuis un graphe 1h. Pour les moyennes mobiles, c'est presque redondant (99,6 % de concordance sur données synthétiques) : le dire dans l'éditeur plutôt que de le présenter comme un gain. Le contrat d'unité commun (timeframes.ts:13-17) impose le refus explicite en phase 1, et la phase 2 (BT et alertes) conditionne toute mesure intégrée. Références externes non revérifiées dans cette session (budget de recherche épuisé ; developers.binance.com et tradingview.com à autoriser dans le réseau de la session).

**Références.**

- Liu & Tsyvinski, « Risks and Returns of Cryptocurrency », Review of Financial Studies 2021 : momentum temporel crypto aux horizons journalier et hebdomadaire. Référence citée par l'idée brute, non revérifiée en ligne dans cette session (budget WebSearch épuisé, hôtes externes injoignables).
- Moskowitz, Ooi & Pedersen, « Time series momentum », JFE 2012 : référence connue, non revérifiée en ligne ici.
- Interne : AXIS n'est favorable qu'en 4h. Toutes les autres unités sont DÉFAVORABLES, et le 1w NON CONCLUANT (scripts/axis/rapport-ut-2026-10-08.md:7-21). Projeter AXIS 4h sur un graphe 1h est donc le seul moyen de lire le signal validé à l'unité d'entrée.
- Interne : le garde-fou v5 cité par l'idée est un régime BTC à la MÊME unité (EMA 100 en 4h de la série refClose, packages/indicators/src/strategy/stratAxis.ts:162-188). Ce n'est pas une projection d'unité supérieure : preuve indirecte.
- Mesure scratchpad (/tmp/claude-0/-home-user-axiom/006b3956-3bcb-553d-93c7-502146b32fa7/scratchpad/outils-analyse/htf-redondance.mjs, marche aléatoire synthétique, 20 tirages de 1 500 j) : le signe de « close au-dessus de l'EMA 50 1d projetée » concorde avec celui de « close au-dessus de l'EMA 1 200 en 1h » sur 99,6 % des bougies 1h (minimum 99,5 %). Le RSI 14 1d et le RSI 336 1h sont corrélés à 0,955, mais le RSI 1d dépasse 70 sur 4,8 % des bougies et le RSI 336 1h jamais.

**Redondance.** Forte pour les moyennes mobiles : sur données synthétiques, le filtre « close au-dessus de l'EMA 1d » équivaut à 99,6 % à une EMA de période ×24 sur 1h, déjà réglable aujourd'hui. Faible pour les oscillateurs à seuils (RSI, Stoch, MFI), les indicateurs de structure (SuperTrend, Ichimoku) et AXIS : changer la période ne conserve pas le sens des seuils. Le BRIEF donne déjà une concordance 15m/1h/4h/1d (EMA 50, RSI 14, ATR 14 : apps/web/src/data/multiEchelle.ts:21 et 84-92), mais en texte, sans historique, et en lisant la DERNIÈRE bougie, encore en cours (multiEchelle.ts:88 ; binance.ts:82 et 97 : `closed` n'est pas filtré). SUG-1 apporterait donc une valeur close et tracée dans le temps. Recouvrement partiel avec IDEE-4, exclue (mesure automatique de l'alignement pour PACTE) : à garder distincts.

**Pièges.** 1) Bougie supérieure en cours : les adaptateurs la renvoient (binance.ts:82). Il faut l'écarter, sinon la dernière valeur repeint. 2) Horodatage : un point supérieur doit porter l'heure de CLÔTURE (ouverture + durée) avec surCloture=true. alignAux extrapole la clôture de la dernière bougie, et un trou élargit la borne (packages/indicators/src/utils-aux.ts:28-35). 3) Alignement par place : OKX utilise 1Dutc/1Wutc (apps/web/src/data/okx.ts:52-56) ; Coinbase n'a pas de 1w (adapters.ts:89) ; le début de la semaine Kraken est non vérifié. Il faut contrôler time % période et refuser sinon. 4) Amorce profonde : une EMA 200 1w demande plus de 200 semaines, ce que beaucoup d'alts n'ont pas ; afficher « partiel ». 5) En escalier, la valeur paraît en retard d'une période supérieure, jusqu'à 1 semaine : c'est voulu, à expliquer. 6) Phase 1 refusée en alertes et BT : le graphe montrera ce que BT ne peut pas tester, d'où un risque de lecture discrétionnaire non mesurée. 7) L'option « bougie en cours » est un piège à repaint : la laisser hors des captures et du BT.

**Protocole de validation.** Exactitude : égalité avec le calcul natif sur chaque bougie supérieure close, contrôle par préfixe, et une table de cas sur l'alignement par place (refus attendu pour un 1w non aligné). Apport analytique, mesuré par script hors appli comme pour AXIS, car la phase 1 exclut le BT : figer un manifeste avant tout téléchargement. Règle : « signal 1h (par exemple croisement RSI 1h, ou entrée sur fort achat) pris seulement si AXIS 4h est en achat, ou si close 1d est au-dessus de l'EMA 50 1d ». Comparer à (a) la règle non filtrée et (b) l'équivalent à période ×N sur 1h, pour prouver un apport au-delà de la redondance. Nul par décalage circulaire commun ; Bonferroni sur le nombre de filtres. Utiliser un pool neuf, car les données des tests AXIS sont déclarées consommées (stratAxis.ts:198-199) : autre place, paires jamais vues ou données postérieures au figeage.

**Preuve d'intérêt (idéation).** Momentum temporel crypto aux fréquences journalière et hebdomadaire (Liu & Tsyvinski, RFS 2021, cité par l'idée brute). Interne : le garde-fou de régime d'AXIS v5 améliore le Sharpe sur 75,5 % des cellules jamais vues (packages/indicators/src/strategy/stratAxis.ts:162-200).

**Mesure de succès.** Égalité exacte entre valeur projetée et calcul natif sur chaque bougie supérieure close ; test de causalité par préfixe ; au plus une requête par instance et par clôture supérieure.

**Fichiers à toucher.**

- packages/indicators/src/utils-unite.ts (nouveau, pur) + utils-unite.test.ts
- packages/indicators/src/index.ts
- apps/web/src/chart/indicators.ts
- apps/web/src/chart/bougiesUnite.ts (nouveau, import dynamique, cache par exchange:symbole:unité, recharge à chaque clôture supérieure)
- apps/web/src/components/InstanceParamsEditor.tsx
- apps/web/src/store/indicators.ts (formatInstanceLabel : suffixe « [4h] », lignes 138-148)
- packages/alerts/src/engine.ts et chemin d'import du BT (refus motivé d'un paramètre 'unite' importé)

**Avis des juges.**

- valeur (4) : Sert tous les jours au swing : on voit l'EMA ou le RSI 1d sur le graphe 4h. Aujourd'hui, la concordance multi-unité n'existe que sous forme de tableau dans le BRIEF (apps/web/src/data/multiEchelle.ts:21, 15m/1h/4h/1d). L'idée la porte sur le graphe, sans repeinture. Aucune preuve d'un gain : le filtre mesuré d'AXIS est la référence BTC dans la même unité (docs/axis-2026-10-07.md:53-57). C'est une aide à la lecture, pas un avantage démontré.
- cout-risque (3) : Aucune source nouvelle, mais effort M sur le chemin initial (marge gzip d'environ 4 ko, BUILD-CONTRACT.md:2124), donc chargeur obligatoirement dynamique. Risque de repeinture réel : la bougie supérieure en cours est renvoyée par les adaptateurs (binance.ts:82) et doit être exclue. Le contrat d'unité est partagé graphe/alertes/BT. Coût moyen, risque maîtrisable par le test de préfixe.
- coherence (3) : La projection existe déjà : alignAux(…, surCloture) (packages/indicators/src/utils-aux.ts:37-41). L'idée casse pourtant le modèle « une unité par calcul ». Le contrat commun graphe/alertes/BT (timeframes.ts:13-17) devrait refuser le paramètre ailleurs, et il faut un second chargeur de bougies par instance. Exception G100 sur une surface structurante.

### 11. SUG-2 — VWAP et pivots hebdomadaires, mensuels et trimestriels, et AVWAP ancré automatiquement sur le dernier pivot confirmé

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-2

**Question de trading.** Où est le prix moyen payé depuis le début de la semaine, du mois ou depuis le dernier creux majeur, et où sont les pivots hebdomadaires ?

**Proposition retenue après vérification.** (a) Input « réinitialisation » (jour par défaut, semaine lundi 00:00 UTC, mois, trimestre) sur vwap et vwapBands, choix ≤ unité du graphe refusés ; (b) même input sur les 5 pivots via un periodExtents pur (généralisation de sessionExtents), avec l'étiquette « période partielle » ; (c) mode « dernier pivot confirmé » d'anchoredVwap, causal, sans sortie « tracé ». Ancres d'évènement passé tirées de data/macro/eventDates.ts (FOMC statique) et des dates de halving codées en dur, pas de ForexFactory. Abandonner l'étiquette de confluence. Mesure : VWAP semaine en 1h égal au calcul direct, avwapPivot au contrôle par préfixe, taux de réaction contre niveaux aléatoires publié avec n.

**Proposition initiale.** (a) Input « période » (jour par défaut, semaine, mois, trimestre, année) sur vwap et vwapBands, plus le VWAP de clôture de la période précédente en niveau. (b) Même input sur les 5 pivots via un helper pur periodExtents. (c) anchoredVwap en mode auto : sortie causale avwapPivot (ancre = dernier pivot confirmé à i, utilisable en alerte et BT) et sortie « tracé » sur extrême N bougies ou évènement FOMC/CPI/halving, rangée dans SORTIES_NON_CAUSALES. Jusqu'à 3 AVWAP, étiquette « confluence » à moins de 0,5 ATR.

**Ce qui existe déjà.** Niveaux périodiques déjà tracés : PDH/PDL/PDC, PWH/PWL, PMH/PML et ouvertures jour, semaine, mois et trimestre (apps/web/src/chart/niveaux/niveauxCles.ts:1-4, 101-106, 113-116). Il manque la clôture de la semaine précédente (PWC), donc pas de pivot hebdomadaire. Plusieurs AVWAP manuels sont déjà possibles : chaque clic ajoute une instance anchoredVwap (apps/web/src/chart/drawing.ts:187-194). Le VWAP et les 5 pivots ne se remettent à zéro qu'au jour UTC (packages/indicators/src/volume/vwap.ts:53-58 ; packages/indicators/src/support_resistance/pivotStandard.ts:56-61). L'AVWAP n'a qu'un ancrage temporel fixe (packages/indicators/src/volume/anchoredVwap.ts:53-60). Aucun AVWAP automatique.

**Réutilise.** utils-session (packages/indicators/src/utils-session.ts:17-80), confirmation causale de zigzag.ts et pivotHighLow, marqueurs ECO (apps/web/src/chart/ecoMarkers.ts:188), computeHalving.

**Point d'intégration.** (a)(b) Ajouter un input de type « select » (type existant, packages/types/src/index.ts:262), géré tel quel par l'éditeur (apps/web/src/components/InstanceParamsEditor.tsx:25). Le paramètre passe automatiquement aux alertes et au BT ; il est causal. Généraliser utils-session : un periodeIdx(time, periode), lundi via (jour+3)%7 comme niveauxCles.ts:63, mois et trimestre via Date.UTC, plus un periodExtents dérivé de sessionExtents (packages/indicators/src/utils-session.ts:80). Rendre générique l'étiquette « partielle », dont le texte cite « 00:00 UTC » (utils-session.ts:45-53). Défaut « jour » : instances persistées inchangées. Ne pas nommer l'input « period », clé numérique déjà prise (packages/indicators/src/trend/supertrend.ts:119, packages/indicators/src/volatility/atrRegime.ts:44). (c) Ajouter un mode à anchoredVwap : ancre = dernier pivot confirmé à i (pivot en i−n enregistré à la clôture i, même logique que pivotHighLow). Les ancres d'évènement passé ne viennent pas de ForexFactory, dont le flux ne couvre que la semaine courante (apps/web/src/data/eco.ts:5, 402 ff_calendar_thisweek.json ; ecoMarkers.ts:188 n'est que le contrôleur des marqueurs). Elles viennent de apps/web/src/data/macro/eventDates.ts : FOMC statique ; CPI via FRED, qui demande la clé FRED personnelle (eventDates.ts:22). Les halvings passés sont à coder en dur : computeHalving ne donne que le prochain (apps/web/src/data/onchain/mempool.ts:77).

**Sources.**

- Bougies OHLCV du graphe et calendrier ForexFactory (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Aucune donnée nouvelle ; étiquette « période partielle » existante si l'historique chargé est court.

**Contrat.** Le catalogue ne grossit pas (BUILD-CONTRACT.md:82 respecté) : on ajoute des inputs et des sorties à 8 defs existantes. (a)(b) sont de simples réglages d'indicateurs existants, défendables sans exception. (c) (mode auto) est une fonction nouvelle et demande une exception G100 légère (BUILD-CONTRACT.md:71). Aucun fournisseur, aucun hôte, aucune clé. Impact budget faible : du code pur dans @axiom/indicators. Point de contrat manquant : les alertes n'ont aucun garde de causalité (grep NON_CAUSAL dans packages/alerts/src : rien). Une sortie « tracé » y serait évaluée et repeindrait.

**Risques.** (1) Une période inférieure ou égale à l'unité du graphe n'a pas de sens : sur un graphe 1d, le VWAP jour vaut hlc3 de la bougie ; sur un graphe 1w, le VWAP semaine non plus. Masquer ces choix ou les refuser avec motif. (2) Avec le backfill de 500 bougies, le trimestre en 4h (environ 540 bougies) et l'année en 1d restent partiels : il faut l'étiquette, voire l'amorce. (3) VWAP d'une seule place (volume Binance ou autre) et approximation hlc3 par bougie : la preuve est faible et déjà notée (docs/research/02-indicateurs-edge-crypto.md:213-214). (4) L'étiquette « confluence à moins de 0,5 ATR » demande un agrégateur entre instances, qui n'existe pas dans le moteur : c'est une surface nouvelle, à retirer. (5) L'avwapPivot saute à chaque nouveau pivot confirmé : signaux de croisement artificiels en alerte et en BT si l'on ne compare pas seulement à ancre constante.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Réduire le périmètre. (a) Le VWAP par période (input sur vwap et vwapBands) et avwapPivot causal coûtent peu et rendent ces niveaux TESTABLES en BT : utiles avec réserve. (b) Les pivots par période sont quasi redondants avec les niveaux clés : gadget, à abandonner. (c) Les ancres FOMC/CPI/halving et l'étiquette « confluence » sont à reporter tant que l'étude d'évènements n'a rien montré. Étiqueter « référence, aucun avantage démontré » comme les niveaux clés. Références externes non revérifiées dans cette session.

**Références.**

- Berkowitz, Logue & Noser, « The Total Cost of Transactions on the NYSE », Journal of Finance 1988 : le VWAP comme référence d'exécution. Non revérifié en ligne ici ; cela documente un benchmark d'exécution, pas un pouvoir de support ou de résistance.
- Osler, « Support for Resistance: Technical Analysis and Intraday Exchange Rates », FRBNY Economic Policy Review 2000 : les niveaux S/R publiés par des banques interrompent les tendances plus souvent que le hasard en change. Non revérifié en ligne ici ; porte sur des niveaux publiés, pas sur les formules de pivots.
- Interne : preuve faible déjà notée pour l'AVWAP (docs/research/02-indicateurs-edge-crypto.md:208-215, « peu de preuve académique »).
- Interne : niveaux clés « aucun avantage directionnel démontré » (apps/web/src/chart/niveaux/niveauxCles.ts:10).
- Interne, contre-exemple de méthode : les zones AXIS S/R « tiennent à 6 bougies dans ~81 % des tests », mais sur données déjà vues et sans niveaux témoins (docs/axis-2026-10-07.md:986-993).

**Redondance.** Élevée pour les pivots par période. Les extrêmes et ouvertures de semaine, mois et trimestre existent déjà (PWH, PWL, PMH, PML, OS, OM, OQ : niveauxCles.ts:1-4 et 79-109). En crypto 24/7, OS ≈ clôture de la semaine précédente, donc le PP hebdomadaire ≈ (PWH+PWL+OS)/3 : une combinaison linéaire de lignes déjà tracées. Multiplier 5 familles de pivots (pivotStandard, Camarilla, Woodie, DeMark, Fibonacci au registre) par 5 périodes encombre sans information nouvelle. Le VWAP hebdo ou mensuel se fait déjà à la main avec anchoredVwap et un ancrage au lundi (packages/indicators/src/volume/anchoredVwap.ts:48-60), mais sans roulement automatique. L'étiquette « confluence à moins de 0,5 ATR » double les zones causales ±0,5 ATR d'AXIS S/R (README.md:244-256). Seule vraie nouveauté : avwapPivot, causal et utilisable comme opérande BT.

**Pièges.** 1) Troncature : déjà signalée au jour (vwap.ts:21-25), elle s'aggrave au mois, au trimestre et à l'année. Un trimestre fait 2 160 bougies 1h et le buffer ne démarre presque jamais sur la frontière : l'étiquette « partielle » serait la norme, sauf amorce dédiée. 2) avwapPivot : l'ancre ne doit basculer qu'à l'index de CONFIRMATION. La portion tracée entre le pivot et sa confirmation est non causale, et SORTIES_NON_CAUSALES est une liste écrite à la main (packages/backtest/src/engine.ts:66-73 ; voir docs/revue-2026-11-06.md:1044). 3) Ancres d'évènements : FOMC statiques 2020-2027 ; CPI et NFP via FRED, avec clé (apps/web/src/data/macro/eventDates.ts:10-16). computeHalving vit dans apps/web (data/onchain/mempool.ts:77), hors de @axiom/indicators : il faut passer les dates en paramètre, ce qui rend ces sorties inutilisables en alerte et en BT. 4) Comparaisons multiples : 5 périodes × 3 AVWAP × familles de pivots donnent une « confluence » presque toujours trouvable, d'où un biais de confirmation. 5) Le seuil de 0,5 ATR est arbitraire et devient un paramètre sur-ajustable.

**Protocole de validation.** Étude d'évènements figée : chaque premier contact avec le VWAP S ou M de clôture de la période précédente, avec avwapPivot et avec les pivots S. Niveaux témoins appariés : même distance en ATR au moment de la création, même actif, même date. Mesures : taux de rejet et rendement signé à h bougies après le contact, contre les témoins. Nul par décalage circulaire, horizons et tolérance de contact déclarés d'avance, n affiché, pool neuf (autre place ou paires jamais vues). Pour avwapPivot en BT : une seule règle pré-écrite (par exemple, filtre d'entrée AXIS « close au-dessus d'avwapPivot ») comparée à la v5, avec les critères P1 à P3 du protocole v5. Rappel : le filtre v4 de même nature a échoué (stratAxis.ts:150-160).

**Preuve d'intérêt (idéation).** VWAP = référence d'exécution institutionnelle (Berkowitz, Logue, Noser, JF 1988, cité). Preuve faible pour l'AVWAP déjà notée (docs/research/02-indicateurs-edge-crypto.md:208-215) : les niveaux restent étiquetés « référence » et sont mesurés par le test de SUG-5.

**Mesure de succès.** VWAP semaine sur 1h égal au calcul direct ; avwapPivot passe le contrôle par préfixe ; taux de réaction aux VWAP S/M contre niveaux aléatoires sur 40 actifs, n affiché.

**Fichiers à toucher.**

- packages/indicators/src/utils-session.ts + utils-session.test.ts
- packages/indicators/src/volume/vwap.ts + test
- packages/indicators/src/volume/vwapBands.ts + test
- packages/indicators/src/support_resistance/pivotStandard.ts, pivotFibonacci.ts, pivotCamarilla.ts, pivotWoodie.ts, pivotDemark.ts + tests
- packages/indicators/src/volume/anchoredVwap.ts + test
- packages/backtest/src/engine.ts (SORTIES_NON_CAUSALES, lignes 66-73, si une sortie « tracé » est ajoutée)
- packages/alerts/src/engine.ts (refus d'une sortie non causale)

**Avis des juges.**

- valeur (3) : Le VWAP de la semaine ou du mois et les pivots hebdomadaires sont des repères swing classiques. Ce sont de simples réglages de vwap, vwapBands et des pivots, qui existent déjà. Avec 500 bougies, presque toutes les périodes seront tronquées. Le mode auto d'anchoredVwap (ancrage manuel déjà disponible) apporte peu. Aucune preuve que ces niveaux réagissent mieux que le hasard.
- cout-risque (4) : TS pur dans @axiom/indicators, sans source, clé ni hôte. Coût faible. Risque : avec 500 bougies de backfill, le mois et le trimestre seront presque toujours partiels. L'étiquette « période partielle » est indispensable, sinon on affiche un VWAP faux. Le mode avwapPivot est causal si l'ancre ne bascule qu'à la confirmation.
- coherence (4) : Place naturelle : ce sont des inputs sur des defs existantes (vwap.ts:37 a inputs: []), et la généralisation de sessionExtents (utils-session.ts:80) est pure. Le catalogue ne grossit pas. Réserve : eventDates.ts est dans apps/web/src/data/macro, donc le moteur pur ne peut pas l'importer ; les ancres doivent passer par les params. Le libellé « ForexFactory » de la source est erroné.

### 12. SUG-12 — Absorption « effort contre résultat » en indicateur mesuré, et scanner de flux dans EQS (RVOL, delta taker, pente CVD, fort achat, absorption)

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial S) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : volume et flux · origines : VOL-4, VOL-5

**Question de trading.** Parmi 60 alts, lesquelles subissent cette semaine des achats agressifs anormaux, ou une absorption au contact d'un support avant que le prix ne parte ?

**Proposition retenue après vérification.** (1) EQS sans nouvel indicateur : le worker garde k[9] et ignore la bougie en cours. Trois champs sont lus sur la dernière bougie close : RVOL, Taker Net % et pente du CVD normalisée par le volume. S'y ajoute un mode « présent sur les K dernières bougies closes ». Un champ « fort achat AXIS » est proposé en 4h seulement, calculé par grosMouvementsAxis avec une amorce suffisante, ou libellé « sans exclusion des signaux », accompagné de ses vraies statistiques (n, moyenne, médiane). Préréglage « Flux anormal ». (2) Absorption « effort contre résultat » (RVOL ≥ k, delta ≤ −d, corps ≤ c·ATR, clôture dans le tiers haut, version symétrique), Binance seulement : d'abord une campagne figée hors interface sur des cellules 4h hors manifeste flux. Elle n'entre au registre, sous un nom autre qu'absorptionFlux, qu'en cas de succès.

**Proposition initiale.** (1) Indicateur absorptionFlux : RVOL ≥ k, delta taker ≤ −d, corps ≤ c·ATR, clôture dans le tiers haut (symétrique) ; version sans delta étiquetée hors Binance ; paramètres figés puis campagne sur le harnais de valider-axis-flux.ts, libellé « non validé » d'ici là. (2) Worker EQS : conserver k[9] (une ligne), puis champs RVOL, Taker Net %, pente CVD normalisée, présence d'un fort achat/vente AXIS et d'une absorption sur K bougies, de 15m à 1d ; préréglage « Flux anormal » ; jambe perp optionnelle.

**Ce qui existe déjà.** Le worker EQS jette k[9] (apps/web/src/workers/screener.worker.ts:72-79), alors que restKlineToCandle le garde (apps/web/src/data/binance.ts:83-98). Il y a 5 champs indicateurs : rsi, macdHist, emaDist, adx, bbw (apps/web/src/data/screener.ts:291-339). deriveScalar prend la dernière valeur définie (apps/web/src/data/screener.ts:440-453). Les définitions utiles existent déjà : relativeVolume (packages/indicators/src/volume/relativeVolume.ts:13), takerNetPct (packages/indicators/src/orderflow/takerNetPct.ts:19), cvd (packages/indicators/src/orderflow/cvd.ts:42). Le fort achat est grosMouvementsAxis (packages/indicators/src/strategy/stratAxis.ts:470-489). Il exclut les bougies de signal AXIS, ce qui suppose une amorce de 1 500 bougies (stratAxis.ts:229), alors que le screener ne prend que 200 klines (screener.ts:49). absorptionAchat (stratAxis.ts:1123-1127) est une pression acheteuse, pas un effort contre résultat, et `absorptionFlux` est déjà un nom de champ (stratAxis.ts:963). La validation du fort achat porte sur 4 cellules 4h seulement : médiane nulle 20 bps, 51,2 % de hausses, BNB à −14 bps (scripts/axis/rapport-flux-2026-10-08.md:13-14).

**Réutilise.** fluxAxis/forceFlux (stratAxis.ts:417, :441), grosMouvementsAxis (stratAxis.ts:470), relativeVolume, takerNetPct, cvd, computeIndicator, scripts/valider-axis-flux.ts, validationSignaux.

**Point d'intégration.** Champs EQS : le worker conserve k[9] et en déduit buyVolume et sellVolume (une ligne). Nouvelles entrées INDICATOR_FIELDS en réutilisant relativeVolume.rvol, takerNetPct.net et cvd. Nouveaux modes de dérivation dans deriveScalar : « dernière bougie close », « pente normalisée sur K » et « présent sur les K dernières bougies closes ». Préréglage ajouté à BUILTIN_PRESETS (screener.ts:492). Le worker est un chunk séparé (apps/web/src/data/screenerRun.ts:211), donc rien ne pèse sur le chargement initial. L'absorption est une définition dans packages/indicators/src/orderflow/ dont la sortie vaut +1 ou −1 à l'évènement, ce qui la rend scannable, plus une campagne scripts/valider-absorption.ts sur le harnais de valider-axis-flux.ts.

**Sources.**

- Binance spot /api/v3/klines (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà appelé par le worker ; seul le champ conservé change.

**Contrat.** Pas de nouvelle source : api.binance.com spot, déjà appelé en direct. Pas de clé, @axiom/types inchangé. Les champs et le préréglage EQS sont une fonctionnalité de surface, donc exception G100 (BUILD-CONTRACT.md:71), sans fenêtre nouvelle. Les champs reposant sur des définitions existantes n'étendent pas le catalogue. L'absorption, elle, l'étend (BUILD-CONTRACT.md:82) : elle ne doit entrer qu'après la campagne. Les cellules de la campagne doivent sortir du manifeste flux (scripts/axis/manifeste-flux-2026-10-08.json : BTC, ETH, SOL, XRP, BNB, ADA, LINK, DOGE). Ne pas reprendre les poids de detecterRetournementsAxis (IND-1 exclu).

**Risques.** (1) Le worker ne marque pas la bougie en cours : RVOL et delta y seraient lus sur un volume en formation, ce qui sous-estime le RVOL. Il faut lire la dernière bougie close. (2) Sur une série de marqueurs, lastDefined renverrait un évènement ancien comme s'il était « présent ». (3) Sans les exclusions AXIS (amorce de 1 500 bougies contre 200), le « fort achat » EQS n'est plus l'évènement validé : la parité EQS/graphe est cassée. (4) La validation ne vaut qu'en 4h ; de 15m à 1d, le signal n'est pas validé. Le gain moyen vient des queues de distribution (médiane 20 bps). (5) L'absorption est rare et dépend de trois seuils libres (k, d, c) : risque de sur-ajustement et de n < 50 par cellule. (6) Au plus 60 symboles (SCREENER_CAP, screener.ts:33). Les préréglages sont aussi exécutés par le runtime d'alertes (revue MFN-8, apps/web/src/alerts/runtime.ts:648), d'où un coût réseau. (7) La référence Campbell, Grossman et Wang 1993 n'a pas été revérifiée dans cette passe.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Le volet scanner est le plus utile des quatre pour un trader discrétionnaire multi-alts : manque réel, effort S. Le volet absorption a un appui indirect (Campbell, Grossman, Wang ; inversion mesurée des forts achats en intraday), mais seul un test prospectif peut le valider. S'appuyer sur « +161 bps, p = 0,0005 » seul est sélectif : rapport-ut le contredit sur 13 unités.

**Références.**

- Campbell, Grossman, Wang (1993), QJE : les variations à fort volume tendent à s'inverser. Llorente, Michaely, Saar, Wang (2002), RFS : continuation quand le volume est informé. Connus, non revérifiés dans cette passe.
- packages/indicators/src/strategy/stratAxis.ts:522-533 : forts achats sur 42 paires jamais vues. Moyennes négatives de 15m à 6h (p bilatérale de 0,0002 à 0,0072), positives et non significatives en 1d et 3d.
- scripts/axis/rapport-flux-2026-10-08.md:166-185 : en 4h, +161 bps en moyenne mais médiane de 10 bps, 51,2 % de hausses, BNB négatif.
- docs/research/02-indicateurs-edge-crypto.md:83-87 : absorption classée [prat], sans preuve académique.
- apps/web/src/workers/screener.worker.ts:29 et :61-81 : klines spot api.binance.com, k[9] jeté.
- apps/web/src/data/screener.ts:291-340 : seulement 5 champs (rsi, macdHist, emaDist, adx, bbw).
- apps/web/src/data/screener.ts:502-507 : le préréglage « Volume anormal » filtre un volume 24 h > 100 M$, pas un RVOL.
- packages/indicators/src/strategy/stratAxis.ts:1123-1127 : absorptionAchat, pilier non mesuré.
- scripts/axis/manifeste-v5-2026-10-10.json : KuCoin sans volume taker, 329 bases déjà lues.

**Redondance.** Forte pour l'indicateur, faible pour le scanner. absorptionFlux recombinerait relativeVolume, rvolSeasonal, volumeZScore, takerNetPct, fluxAxis et forceFlux (stratAxis.ts:417, :441), grosMouvementsAxis (:470), trappedVolume, vpin et le pilier absorptionAchat. Le scanner comble en revanche un vrai manque : l'EQS n'a aucun champ de flux et son préréglage « Volume anormal » est mal nommé.

**Pièges.** (1) Le signe change avec l'unité. Les forts achats s'inversent de 15m à 6h (stratAxis.ts:525-530) et ne continuent qu'en 4h, sur 4 cellules. Un champ EQS « fort achat présent » lu comme haussier de 15m à 1d serait donc faux sur la plupart des unités. (2) En intraday, les moyennes restent sous le coût aller-retour de 0,14 % (SOUS_COUT, stratAxis.ts:520). (3) Le worker lit aussi la dernière kline, encore en formation : RVOL et delta seraient calculés sur une bougie partielle. (4) La saisonnalité intrajournalière fait qu'un RVOL simple en 15m ou 1h signale les ouvertures de session (rvolSeasonal existe pour ça). (5) Scanner sur 60 alts : il y a toujours des « anomalies » (sélection multiple), avec biais du survivant puisque l'univers se limite aux paires actives. (6) Quatre seuils libres (k, d, c, tiers de clôture) : risque de sur-ajustement. L'historique Binance est déjà lu et l'inversion intraday des forts achats est déjà connue, donc tester une absorption « retournement » sur ces données serait contaminé. (7) Le delta vient de Binance seul ; la version sans delta est un autre indicateur.

**Protocole de validation.** (a) Scanner : le livrer comme outil descriptif, pas comme signal. Ne calculer que sur la dernière bougie clôturée, vérifier la parité EQS/graphe sur 10 symboles et afficher le statut mesuré par unité repris de stratAxis.ts:522-533. (b) Absorption : sens déclaré à l'avance (retour dans le sens de la clôture). Seuils figés sans regarder les données (k = 3 et d = SEUIL_DELTA_AXIS = 0,1, stratAxis.ts:222 ; c et tiers fixés a priori), le tout dans un manifeste. (c) Données : test prospectif sur la période postérieure au gel, toutes paires USDT Binance en 4h et 1h pendant 4 à 6 mois. Nul par décalages circulaires communs, Bonferroni sur les unités. (d) Critères : rendement signé regroupé supérieur au coût aller-retour, même signe dans les deux moitiés et sur plus de la moitié des actifs, n ≥ 50 par cellule. Rapporter aussi la médiane et la part de hausses, car la moyenne 4h des forts achats est tirée par les queues.

**Preuve d'intérêt (idéation).** Campbell, Grossman, Wang (QJE 1993) : variations à fort volume tendant à s'inverser (vérifié). Interne : fort achat validé hors échantillon, 690 évènements, +161 bps, p = 0,0005 (scripts/axis/rapport-flux-2026-10-08.md:8-10) : le scanner rend ce signal cherchable sur l'univers.

**Mesure de succès.** Absorption : ≥ 50 évènements par cellule, rendement signé à 12 bougies > 0 dans ≥ 3 cellules sur 4, p ≤ 0,05 (décalages circulaires). Scanner : durée ±10 %, parité EQS/graphe sur 10 symboles, suivi par event study.

**Fichiers à toucher.**

- apps/web/src/workers/screener.worker.ts
- apps/web/src/data/screener.ts (INDICATOR_FIELDS, deriveScalar, BUILTIN_PRESETS)
- apps/web/src/data/screener.test.ts
- packages/indicators/src/orderflow/absorptionTaker.ts et son test (nouveaux, conditionnels)
- packages/indicators/src/registry.ts, registry.test.ts (conditionnel)
- scripts/valider-absorption.ts et manifeste (nouveaux)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (3) : Seule idée qui transforme l'événement validé (forts achats AXIS 4h, +1,61 % à 12 bougies, docs/axis-2026-10-07.md:323-340) en scanner d'alts. L'avantage reste mince : 51 % de hausses, médiane proche de 0. Les champs RVOL et taker sur la bougie close sont utiles mais recouvrent SUG-C4. L'absorption n'est pas prouvée.
- cout-risque (4) : Binance spot direct, sans clé, @axiom/types inchangé. Correctif obligatoire vérifié : le worker ne garde ni k[9] ni le statut clos et lit la bougie en formation (apps/web/src/workers/screener.worker.ts:60-80). Risque de lecture fausse de « fort achat » hors 4h (le signe s'inverse) : à restreindre au 4h comme proposé. L'absorption est conditionnée à une campagne : sûr.
- coherence (4) : EQS a déjà des conditions indicateurs (data/screener.ts:276-357). Des champs sur des defs existantes suffisent, et l'absorption reste hors UI jusqu'à la campagne. Correctif nécessaire : écarter la bougie en cours (screener.worker.ts:60-80).

### 13. SUG-14 — Historique profond du positionnement Binance (archives metrics : OI, L/S comptes et top traders, taker) et quadrant OI × prix par bougie mesuré

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : non · catégorie : dérivés · origines : DER-1, SRC-1, DER-4

**Question de trading.** L'OI et le positionnement actuels sont-ils extrêmes sur plusieurs cycles, et un mouvement porté par des positions neuves continue-t-il plus souvent qu'un mouvement porté par des fermetures ?

**Proposition retenue après vérification.** Daemon et scripts seulement. Un module à la demande importe en SQLite les archives metrics d'un symbole (OI, L/S comptes, L/S top traders en positions). auxProvider les raccorde, au-delà de 30 j, aux séries existantes oi, lsAccount et lsTopTrader, sans nouvel AuxSeriesId ni repli Vercel ; le taker reste aux klines fapi. Le quadrant OI × prix par bougie commence par une étude d'événements : validationSignaux et campagne figée dans scripts/axis, continuation à 12 bougies contre nul circulaire. Un indicateur, ou le retrait du libellé « continuation » de signaux.ts, n'arrive qu'après ce verdict.

**Proposition initiale.** (1) Le daemon (et scripts/axis) télécharge à la demande data/futures/um/daily/metrics/<SYM>/… (pas 5 min, 288 lignes/j), contrôle le checksum, stocke en SQLite ; auxProvider raccorde archive (> 20 j) et API (fin récente) pour oi, lsAccount, lsTopTrader, lsTaker en 4h/1d, sans nouvel AuxSeriesId ; ajout du ratio top traders compté en comptes. Gestion point-in-time (étiquette create_time changée le 2026-06-25, jours incomplets). (2) Indicateur oiQuadrant : ΔOI USD vs Δprix à la clôture, état (build-up long/short, rachat de shorts, dé-leveraging) au-delà de k·σ, intensité ΔOI/volume, annotations des dé-leveragings > 3σ ; libellé « heuristique » jusqu'à mesure.

**Ce qui existe déjà.** Les ratios L/S comptes, L/S top traders (positions) et taker sont lus en 1h × 500 (apps/web/src/data/positioning.ts:24-25, :57-67), avec un plafond Binance de 30 j (docs/research/02-indicateurs-edge-crypto.md:96, :189). L'OI vient de Coinalyze en 1h, avec repli Binance (apps/web/src/chart/auxProvider.ts:411-426) ; le lookback est de 90 j (:143) mais Coinalyze ne garde qu'environ 1 500 à 2 000 points intraday (docs/research/01-fournisseurs-api-indicateurs.md:13). Le ΔOI par bougie existe déjà comme indicateur, oiChange, dont l'en-tête dit « croisé avec le prix (lecture 4 quadrants) » (packages/indicators/src/derivatives/oiChange.ts:6, :12-48). Le quadrant EQS travaille sur 24 h avec des seuils fixes de 2 % et 3 % (apps/web/src/data/signaux.ts:60-61, :78-110), et SQZ en a une variante funding × ΔOI (apps/web/src/data/squeeze.ts:42). L'étude d'événements couvre le funding et la divergence, pas le quadrant (apps/web/src/data/validationSignaux.ts:1-20, :110). Le flux taker par bougie est déjà disponible sur tout l'historique via les klines fapi (perpDelta, auxProvider.ts:458-465). Le téléchargement d'archives par le daemon existe pour les aggTrades spot (apps/daemon/src/replay.ts:1-35).

**Réutilise.** Téléchargement/SQLite de apps/daemon/src/replay.ts, extraction zip (backtestFunding.ts:186), indicateurs L/S existants, alignAux clôture, validationSignaux, protocole scripts/axis/.

**Point d'intégration.** Module daemon apps/daemon/src/metricsArchive.ts sur le modèle de replay.ts : POST à la demande, table SQLite, checksum, extraction par apps/daemon/src/zip.ts, route GET. Dans rawFetch d'auxProvider.ts, cases "oi", "lsAccount" et "lsTopTrader" (:411, :551-554) : si le daemon est présent, placer la partie archivée (> 30 j) avant la réponse API, avec la convention de clôture (AUX_SUR_CLOTURE, :162-170). scripts/axis réutilise le même lecteur pour tester ΔOI. Pour le quadrant : une fonction evenementsQuadrant() dans validationSignaux.ts, sans indicateur au premier lot. Effort M pour ce périmètre ; L avec l'indicateur oiQuadrant, le repli navigateur et le ratio top traders en comptes.

**Sources.**

- data.binance.vision futures/um/daily/metrics (nouvelle ; gratuit sans clé (hôte autorisé, chemin nouveau) ; vérifiée en ligne par l'idéation : oui) : Colonnes et cadence 5 min vérifiées (issues binance-public-data #211, #503, #513) ; colonnes d'OI et date de début non vérifiées. Licence CC BY-NC-SA 4.0, attribution « Binance Vision », pas de ré-hébergement des fichiers (TERMS lus).

**Contrat.** Hôte déjà autorisé, pas de nouveau fournisseur. Le daemon télécharge en direct (replay.ts:35) : sans repli navigateur, la liste blanche ne change pas. Avec un repli, il faut amender la clause du 9 septembre (BUILD-CONTRACT.md:149-151). Pas d'enregistreur : dumps à la demande (BUILD-CONTRACT.md:88). Le « ratio top traders compté en comptes » demande un nouvel AuxSeriesId (packages/types/src/index.ts:200), ce qui contredit « sans nouvel AuxSeriesId » et BUILD-CONTRACT.md:81. oiQuadrant étendrait le catalogue (BUILD-CONTRACT.md:82) alors qu'oiChange couvre déjà ΔOI. Pas d'exception G100 tant qu'on se raccorde aux séries existantes. Aucun impact sur le budget initial (daemon).

**Risques.** (1) Le repli navigateur de 30 à 60 j n'apporte presque rien, l'API rendant déjà 30 j. Il coûte une invocation Vercel par jour, et l'accès à data.binance.vision depuis Vercel n'est pas vérifié (extapi.ts:5-6). (2) Le lsTaker de l'archive est un ratio par 5 min : l'agréger en 4h par LOCF reproduit le défaut de flux relevé (docs/revue-2026-11-06.md:899), alors que les klines fapi donnent le flux taker exact. (3) Raccord archive/API : décalage d'horodatage create_time et jours incomplets. Colonnes d'OI et date de début non revérifiées ici (budget de recherche web épuisé). (4) Environ 1 100 fichiers quotidiens par symbole pour 2023-2026, à borner (concurrence, reprise). (5) Faux signal : seuils fixes et tests multiples, d'où un protocole figé obligatoire. (6) Licence : le stockage local du propriétaire est acceptable ; la ré-exposition à des visiteurs par le proxy reste à vérifier.

**Intérêt analytique.** moyen ; verdict utile. C'est l'idée la plus solide des quatre. Elle ne promet pas de gain en elle-même : elle permet enfin de mesurer des lectures déjà affichées (ΔOI d'AXIS, quadrant d'EQS, L/S) qui reposent aujourd'hui sur 20 à 90 jours d'historique. La donnée existe depuis le 2020-09-01, gratuite et légère (environ 11 Ko par jour). L'indicateur oiQuadrant est redondant : ne le coder qu'après la mesure, et corriger d'abord le biais OI en USD au profit d'un OI en contrats. Le ratio taker de l'archive est à abandonner (déjà dans les klines).

**Références.**

- docs/research/02-indicateurs-edge-crypto.md:119-133 : lecture OI × prix classée « [prat] », enseignée mais non démontrée.
- docs/research/02-indicateurs-edge-crypto.md:182-190 : ratio L/S contrarien « faible en isolé ».
- docs/axis-2026-10-07.md:1013-1015 : l'OI d'AXIS est « n.d. » au-delà de 20 à 90 jours, donc jamais mesuré. Même constat à scripts/axis (rapport v5 : « OI non mesuré »).
- Issue GitHub binance/binance-public-data #211 (WebFetch) : colonnes create_time, symbol, sum_open_interest, sum_open_interest_value, count_toptrader_long_short_ratio, sum_toptrader_long_short_ratio, count_long_short_ratio, sum_taker_long_short_vol_ratio.
- Issue #503 (WebFetch) : cadence de 5 min et 288 créneaux, confirmées pour le fichier du 2023-09-12 seulement.
- Listing S3 officiel (WebFetch) : BTCUSDT metrics depuis le 2020-09-01, environ 11,5 Ko par jour, publication à J+1 entre 06:35 et 10:10 UTC, aucun fichier mensuel. Le fichier du 2021-01-10 porte LastModified 2026-03-18 : des archives anciennes ont été régénérées.
- Le changement d'étiquette create_time du 2026-06-25 avancé par l'idée n'est pas vérifié.

**Redondance.** Forte pour l'indicateur, nulle pour la donnée. Le quadrant existe déjà trois fois : apps/web/src/data/signaux.ts:78-110 (EQS), quadrantFundingOi (apps/web/src/data/squeeze.ts:40-50) et oiChange (packages/indicators/src/derivatives/oiChange.ts:12-30). S'y ajoutent lsAccountRatio, lsTopTraderRatio, netPositioningIndex, netPositioningTopTrader, smartRetailSpread et squeezePressureIndex. Le ratio taker de l'archive double le volume taker des klines, disponible sur tout l'historique (orderflow/takerBuyRatio.ts) : inutile de l'importer. L'apport réel est l'historique profond de l'OI et des ratios L/S.

**Pièges.** (1) Biais mécanique du quadrant en USD, qui touche déjà le code : signaux.ts:60-61 pose les seuils (prix 2 %, OI 3 %), et oiChangePctFromHist calcule un Δ « notionnel USD » (apps/web/src/data/screener.ts:162-177). Une hausse de prix de 3 % à nombre de contrats constant donne +3 % d'OI en USD, donc « build-up long ». Le quadrant penche ainsi vers la diagonale. Il faut le ΔOI en unités de base (sum_open_interest) et non le Δ de sum_open_interest_value. (2) Point-in-time : fichiers régénérés (LastModified 2026), possibles jours incomplets, changements d'étiquette. Il faut conserver le checksum et la date de téléchargement, et dater chaque valeur à sa connaissance (l'instantané à create_time ≤ clôture 4h). (3) Cadence 5 min non vérifiée avant 2023-09 : l'historique 2020-2023 est peut-être hétérogène. (4) Une seule plateforme : l'OI Binance est un échantillon (doc 02:131), et la migration vers Hyperliquid, Bybit ou OKX déforme le ΔOI sur les alts. (5) Biais du survivant (perps radiés) et sur-ajustement : 4 états × k·σ × horizons, d'où une seule spécification figée. (6) Environ 365 fichiers par an et par symbole sans agrégat mensuel : daemon obligatoire. Le repli navigateur sur Vercel coûte des centaines d'appels au proxy.

**Protocole de validation.** (a) Contrôle de données : couverture d'au moins 95 % des pas de 5 min et écart nul entre archive et API sur les 20 j qui se recouvrent. (b) Campagne AXIS figée (manifeste SHA-256) : ΔOI en contrats, k·σ, horizon de 12 bougies 4h et nul circulaire 1999 décalages comme scripts/axis/rapport-flux-2026-10-08.md:21. Exploration sur BTC/ETH 2020-2023, test unique sur 2024-2026 et sur des alts jamais vues. (c) Mesurer d'abord ce qui est DÉJÀ affiché : le libellé « continuation » de signaux.ts et la qualification ΔOI d'AXIS. Retrait des libellés si p > 0,05. (d) L/S contrarien : étude d'évènements avec hystérésis (patron de apps/web/src/data/validationSignaux.ts:12-19) sur des percentiles multi-cycles.

**Preuve d'intérêt (idéation).** Signal contrarien foule extrême « faible en isolé » mais jamais mesuré au-delà de 20-30 j (docs/research/02-indicateurs-edge-crypto.md:190). Lecture OI × prix enseignée, non démontrée (même doc :119-133).

**Mesure de succès.** ≥ 95 % des pas de 5 min BTCUSDT 2023-2026 ; écart archive/API nul après recalage ; campagne figée (SHA-256) : continuation à 12 bougies par état contre nul circulaire ; libellé « continuation » retiré de signaux.ts si p > 0,05.

**Fichiers à toucher.**

- apps/daemon/src/metricsArchive.ts (nouveau)
- apps/daemon/src/index.ts
- apps/web/src/data/metricsArchive.ts (nouveau, client daemon)
- apps/web/src/chart/auxProvider.ts
- apps/web/src/data/validationSignaux.ts
- scripts/axis/ (nouveau manifeste et script)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (3) : Lève la limite des 30 j du L/S Binance (lsAccount et lsTopTrader viennent de l'API fapi, apps/web/src/chart/auxProvider.ts:551-554) et permet des percentiles sur plusieurs cycles. Elle teste aussi le libellé « continuation » existant, ce qui est sain. Limites : daemon seul, faible preuve historique des ratios L/S, et l'OI profond est déjà en partie servi par Coinalyze.
- cout-risque (4) : Daemon et scripts seulement. Dumps gratuits téléchargés en direct comme replay.ts:35 : ni liste blanche ni repli Vercel. Aucune clé, aucun enregistreur. Risques : raccord archive/API à vérifier (définition de l'OI identique ?), biais USD du quadrant (signaux.ts:60-61), et un AuxSeriesId pour le ratio en comptes. Étude d'événements avant tout indicateur : sûr.
- coherence (4) : Le daemon reste dans son rôle (dumps à la demande, comme replay). Les archives se raccordent aux aux existants oi, lsAccount et lsTopTrader (packages/types/src/index.ts:200) sans nouvel id, et l'étude passe par validationSignaux. Fonction daemon seule, donc à marquer PARTIAL sur Vercel.

### 14. SUG-15 — Écran dérivés de tout l'univers en 3-4 requêtes : funding prédit Binance/Bybit/HL, OI et prime HL, perps au plafond d'OI, ΔOI Bybit tous symboles

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : dérivés · origines : DER-2, SRC-4

**Question de trading.** Sur quels actifs, y compris hors des 60 symboles EQS, le funding du prochain règlement est-il extrême ou divergent, et où l'OI gonfle-t-il jusqu'au plafond ?

**Proposition retenue après vérification.** Vue « Univers » de FUNDX, sous exception G100. Elle donne le funding en cours et l'APR à la cadence réelle pour tous les perps Binance, Bybit et Hyperliquid, lus sur leurs propres endpoints : premiumIndex + fundingInfo, tickers + instruments-info en linear, metaAndAssetCtxs. Une colonne par place, l'écart max-min, la prime HL en bps et un drapeau « au plafond d'OI » (perpsAtOpenInterestCap). predictedFundings ne sert que de contrôle croisé étiqueté. ΔOI à 1 h, 24 h et 7 j seulement avec le daemon, par un collecteur opt-in calqué sur hlLiqHeat ; pas d'historique IndexedDB.

**Proposition initiale.** Module paresseux derivesUnivers.ts : HL /info predictedFundings (BinPerp, BybitPerp, HlPerp, cadence fournie), metaAndAssetCtxs (OI, premium, volume), perpsAtOpenInterestCap ; Bybit /v5/market/tickers?category=linear sans symbole (openInterestValue, fundingRate, basis). Calculs purs : APR normalisé, écart max-min entre places, prime HL en bps, ΔOI 1 h/24 h/7 j par place. Onglet « Univers » de FUNDX et alimentation de SQZ ; instantané horaire 30 j dans le daemon, IndexedDB par visite sur Vercel (« depuis la dernière visite »).

**Ce qui existe déjà.** La vue « Instantané live » de FUNDX couvre 1 symbole sur 4 places. Elle lit déjà le taux de la période en cours : premiumIndex lastFundingRate (Binance), fundingRate des tickers (Bybit), funding-rate (OKX), funding du ctx (HL) (apps/web/src/data/fundingCrossExchange.ts:43-73, :120-172). L'étiquette « sans prédit » est donc probablement inexacte ; la sémantique « taux en cours = prochain règlement » n'est pas revérifiée (budget de recherche web épuisé). FUNDX a déjà 3 vues : live, historique, carry (apps/web/src/components/FundingMatrixWindow.tsx:125-133). Tout l'univers Binance s'obtient déjà en 1 requête premiumIndex, parsée dans apps/web/src/data/screener.ts:127-150 et servie au BRIEF (apps/web/src/data/brief.ts:679-685) et à SQZ (apps/web/src/store/squeeze.ts:1-12). Le ΔOI de SQZ porte sur un échantillon Binance seul. L'univers HL via metaAndAssetCtxs est déjà lu (apps/web/src/data/ticker.ts:305 ; apps/daemon/src/hlLiqHeat.ts:301-309). Les tickers Bybit sans symbole sont déjà appelés en spot (ticker.ts:226). Un collecteur d'instantanés opt-in existe : hlLiqHeat (5 min, 14 j, drapeau KV, hlLiqHeat.ts:1-33). grep predictedFundings|perpsAtOpenInterestCap : rien.

**Réutilise.** annualiserFunding (fundingCrossExchange.ts:35), lecture metaAndAssetCtxs (apps/daemon/src/hlLiqHeat.ts:301-309), radar SQZ (apps/web/src/data/squeeze.ts:29), KV du daemon.

**Point d'intégration.** Module paresseux apps/web/src/data/derivesUnivers.ts : premiumIndex (parsePremiumIndex existant) et fundingInfo Binance ; tickers et instruments-info Bybit en catégorie linear ; metaAndAssetCtxs HL (OI, premium, dayNtlVlm) et perpsAtOpenInterestCap ; APR par annualiserFunding (fundingCrossExchange.ts:36). Correspondance des symboles entre places par la normalisation de marchesPerp.ts (alias, 1000PEPE/kPEPE). Une 4e vue de FundingMatrixWindow en Suspense, sur le modèle de :133. ΔOI : collecteur daemon opt-in calqué sur hlLiqHeat (table SQLite, rétention 30 j). Appels directs vers des hôtes déjà en connect-src (vercel.json) ; ni proxy, ni clé.

**Sources.**

- Hyperliquid /info predictedFundings et perpsAtOpenInterestCap (nouvelle ; gratuit sans clé (hôte déjà en connect-src) ; vérifiée en ligne par l'idéation : oui) : Vérifiés via Chainstack, hexdocs et crates Rust ; nextFundingTime HL parfois périmé ; HIP-3 exclus ; CGU d'affichage non vérifiées.
- Bybit V5 /v5/market/tickers category=linear (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Champs vérifiés dans la doc officielle (tickers.mdx) ; retour de tout l'univers sans symbole non confirmé.

**Contrat.** Ni nouveau fournisseur ni nouvel hôte : api.hyperliquid.xyz, api.bybit.com et fapi.binance.com sont déjà en connect-src, et fapi est appelé en direct sur Vercel (apps/web/src/data/extapi.ts:43). Une nouvelle vue dans FUNDX demande une exception G100 (BUILD-CONTRACT.md:71 ; précédent : onglet RATE du 2026-09-06). La collecte horaire du daemon n'est pas un enregistreur de ticks (BUILD-CONTRACT.md:88), mais c'est une collecte autonome à acter, opt-in comme hlLiqHeat (BUILD-CONTRACT.md:23). Une colonne par place, aucun total (BUILD-CONTRACT.md:1396). Budget initial intact (chunk à la demande). Aucune clé, aucun quota du propriétaire : les appels partent de l'IP du visiteur.

**Risques.** (1) Les prédictions Binance/Bybit relayées par HL sont une source secondaire, alors que les sources primaires sont gratuites en 1 requête chacune : à garder pour un contrôle croisé. (2) Sans fundingInfo et instruments-info, l'APR est faux d'un facteur 2 sur les perps à 4 h (BUILD-CONTRACT.md:1409-1413). (3) Symboles mal appariés entre places, d'où de faux écarts. (4) Poids des réponses univers Bybit et HL non mesuré (probablement des centaines de Ko). (5) Un ΔOI « depuis la dernière visite » en IndexedDB a un intervalle aléatoire et trompe : à retirer. (6) OKX absent : son endpoint de funding est par instrument. (7) CGU d'affichage HL et Bybit non vérifiées, ces sources étant déjà affichées publiquement par AXIOM. (8) Lecture « APR > p95 » sans historique avant 60 j de collecte.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La partie utile est l'élargissement à Hyperliquid (OI, prime, perps au plafond) et à l'OI Bybit de tous les symboles, sans clé ni proxy. La partie « prédit Binance et Bybit relayé par HL » double premiumIndex, déjà consommé, et l'écart prédit/réglé n'a guère de contenu. Pour mesurer le funding extrême transversal, élargir plutôt le chemin d'archive fundingRate (déjà accordé pour BTC et ETH) à tout l'univers, puis tester selon le protocole AXIS. Les instantanés du daemon ne servent qu'aux mesures sans historique (OI d'Hyperliquid).

**Références.**

- docs/research/02-indicateurs-edge-crypto.md:137-150 : funding extrême contrarien, classé [prat] et [acad] partiel, avec un piège de persistance en marché haussier.
- Schmeling, Schrimpf et Todorov, « Crypto carry », BIS Working Paper 1087 (2023) : le carry élevé précède davantage de risque de krach et de liquidations. Connu mais non revérifié dans cette passe (www.bis.org inaccessible).
- He, Manela, Ross et von Wachter, arXiv 2212.06888 (écarts perp/spot), cité par l'idée et non revérifié.
- apps/web/src/data/coinalyze.ts:182-189 : le prédit Coinalyze vaut exactement le lastFundingRate de Binance (vérifié en réel dans le code).
- docs/revue-2026-11-06.md:274 : Binance passe à 4 h ou 1 h les perps dont le funding sature. Normalisation obligatoire.
- predictedFundings et perpsAtOpenInterestCap d'Hyperliquid, ainsi que le retour de tout l'univers par /v5/market/tickers linear sans symbole : non revérifiés (hyperliquid.gitbook.io inaccessible, budget WebSearch épuisé).

**Redondance.** Élevée sur Binance. Le funding courant ou prédit de tous les perps Binance arrive déjà en une requête premiumIndex (apps/web/src/data/screener.ts:6 et :127-140, brief.ts:679-686, radar SQZ). Le relais du prédit Binance par Hyperliquid n'apporte donc rien. FUNDX compare déjà 4 places pour un symbole (fundingCrossExchange.ts:1-14). fundingDispersion, fundingSpreadHl, fundingZScore et fundingApr existent. Nouveau : l'univers Hyperliquid (OI, prime, plafonds d'OI) et l'OI Bybit de tous les symboles en une requête, ce qui lève le plafond de 20 positions d'EQS (screener.ts:43).

**Pièges.** (1) Le prédit et le réglé se confondent par construction à l'échéance : l'écart entre les deux a peu de contenu informatif. (2) Les funding extrêmes du classement transversal sont dominés par des petites capitalisations illiquides, plus tard radiées. Un test sur l'univers actuel subit le biais du survivant. (3) Plafonds de funding et changements d'intervalle au moment de la saturation : APR et cadence à normaliser par place et par instant. (4) Relais par un tiers : l'horodatage du prédit Binance et Bybit relayé par HL peut être périmé, comme nextFundingTime selon l'idée. (5) Un ΔOI à partir d'instantanés horaires suppose de les accumuler : 60 jours ne donnent que quelques dizaines d'épisodes extrêmes indépendants, puissance faible et risque de sur-ajustement. Le statut « non-enregistreur » est à acter au contrat (BUILD-CONTRACT.md:88). (6) Le plafond d'OI d'Hyperliquid est un fait mécanique, pas un signal mesuré.

**Protocole de validation.** Ne pas attendre 60 jours d'instantanés. Le funding RÉGLÉ historique de tous les perps Binance existe dans data.binance.vision/data/futures/um/monthly/fundingRate (préfixe vérifié dans le listing S3), mais l'accès est borné à BTC et ETH (shared/extapi-hosts.ts:66-68). Protocole : étude d'évènements transversale sur « APR réglé > p95 de l'univers ce jour-là » (hystérésis, un épisode = un évènement), rendement à 1, 3 et 7 jours, nul circulaire. Exploration en 2020-2023, test unique en 2024-2026, univers reconstitué à chaque date avec les symboles radiés pour limiter le biais du survivant. Spécification figée (SHA-256). L'écran Hyperliquid (OI, plafond) reste descriptif tant que les instantanés n'ont pas atteint une taille d'échantillon fixée à l'avance.

**Preuve d'intérêt (idéation).** Funding = donnée dérivée gratuite la plus fiable, usage contrarien documenté (docs/research/02-indicateurs-edge-crypto.md:145). Écarts perp/spot co-variants entre actifs (He, Manela, Ross, von Wachter, arXiv 2212.06888, cité). Plafond d'OI HL : fait mécanique.

**Mesure de succès.** Table complète en ≤ 4 requêtes et < 2 s ; ≥ 400 perps couverts ; après 60 j d'instantanés, event study « APR prédit > p95 » et écart prédit/réglé par place.

**Fichiers à toucher.**

- apps/web/src/data/derivesUnivers.ts (nouveau)
- apps/web/src/components/FundingUnivers.tsx (nouveau)
- apps/web/src/components/FundingMatrixWindow.tsx
- apps/daemon/src/derivesInstantanes.ts (nouveau)
- apps/daemon/src/index.ts
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (3) : FUNDX ne compare que le symbole courant (apps/web/src/components/FundingMatrixWindow.tsx:2-8). Un écran univers repère les alts surpeuplées, candidates au squeeze, et les perps au plafond d'OI. Les extrêmes transversaux sont dominés par l'illiquide. Lecture descriptive, sans preuve d'un avantage.
- cout-risque (4) : Sources primaires gratuites et déjà en connect-src (vercel.json:136 : api.bybit.com, api.hyperliquid.xyz, fapi). 3 à 4 requêtes univers. Les réponses tickers et instruments-info Bybit sont lourdes. Sans fundingInfo et instruments-info, l'APR est faux d'un facteur 2 (BUILD-CONTRACT.md:1409-1413). L'appariement des symboles entre places produit de faux écarts. Le collecteur ΔOI opt-in reste une maintenance à acter.
- coherence (4) : FUNDX ne traite que le symbole courant (FundingMatrixWindow.tsx:1-8). Une vue « Univers » sur des hôtes déjà autorisés en est le prolongement naturel. Le collecteur daemon ΔOI est une collecte autonome de plus, à différer.

### 15. SUG-20 — Surface d'options normalisée à delta et maturité constants (ATM, RR et butterfly 10Δ/25Δ à 7/30/90 j) et son historique quotidien avec percentiles 1 an

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : options · origines : OPT-1, OPT-3

**Question de trading.** La protection baissière coûte-t-elle plus cher qu'hier à horizon égal, la courbe d'IV s'inverse-t-elle, et le skew d'aujourd'hui est-il extrême sur l'année ?

**Proposition retenue après vérification.** (1) Ligne « maturité constante » dans la vue Term IV d'OMON (module pur dans shared/) : ATM, RR25 et BF25 à 7, 30 et 90 j, interpolés en delta puis en variance totale. Garde-fou ≥ 2 strikes de chaque côté ; 10Δ affiché seulement si l'OI de l'aile dépasse un seuil. (2) Un instantané quotidien à heure fixe (08:05 UTC, après l'échéance) d'environ 300 octets par devise, avec le collecteur daemon opt-in en primaire et le localStorage du visiteur sur Vercel (patron TERM). Sparkline et percentile affichés seulement au-delà de 90 points, avec la couverture indiquée. Pas de rattrapage via get_mark_price_history tant que sa profondeur n'est pas vérifiée.

**Proposition initiale.** (1) surfaceConstante.ts : interpolation linéaire de l'IV en delta par échéance (10Δ, 25Δ, ATM forward), puis de la variance totale entre échéances encadrantes à 7, 30, 90 j ; sorties ATM, RR25/RR10, BF25/BF10, pente ATM7−ATM90 ; garde-fou ≥ 2 strikes de chaque côté. (2) Collecteur daemon opt-in, 2 passages par jour (08:05 et 20:00 UTC) : ~300 octets par devise (agrégats, P/C OI et volume, GEX net et flip, max pain, OI, DVOL) dans le KV ; repli localStorage sur Vercel avec couverture affichée ; sparklines et percentile 1 an dans OMON et BRIEF. Rattrapage via get_mark_price_history à évaluer.

**Ce qui existe déjà.** RR25 au strike le plus proche avec une tolérance de ±0,10 Δ, sans interpolation (apps/web/src/data/skew.ts:17-23, calculerSkew25d). IV ATM au strike le plus proche (apps/web/src/data/termIv.ts:35-60). L'additivité de la variance totale entre échéances est déjà codée pour la vol forward (apps/web/src/data/volForward.ts:1-10). Le forward par échéance est disponible (apps/web/src/data/deribit.ts:247-248, underlying). Le seul historique est le DVOL : ivRank sur 90 j (apps/web/src/data/ivRank.ts:16), via get_volatility_index_data (deribit.ts:327, :353). Le BRIEF ne montre que le DVOL (apps/web/src/data/brief.ts:499-501). Le patron d'instantané quotidien KV + localStorage existe (TermStructureWindow.tsx:70, :103-130). Aucun butterfly, 10Δ ni maturité constante. Le daemon n'a aucun code Deribit.

**Réutilise.** Chaîne en cache (apps/web/src/data/chaineOptionsCache.ts:27), greeksDeribit (apps/web/src/data/greeksDeribit.ts:19), termStructureIv, computeMaxPain et putCallRatioOi (apps/web/src/data/deribit.ts:124, :150), kvPut/kvGet, collecteurs du daemon (apps/daemon/src/index.ts:156-176).

**Point d'intégration.** (1) Module pur surfaceConstante.ts : interpolation en delta par échéance (avec le forward underlying), puis en variance totale entre échéances encadrantes à 7, 30 et 90 j. Il consomme la chaîne en cache (apps/web/src/data/chaineOptionsCache.ts:27) et greeksOptionCrypto (apps/web/src/data/greeksDeribit.ts:19), et s'affiche en ligne dans la vue Term IV d'OMON. (2) Collecteur : pour partager le calcul entre daemon et web, le module doit vivre dans shared/ (patron shared/hyperliquidScan.ts, utilisé par api/hlpool.ts et le daemon). La boucle opt-in va dans apps/daemon/src/index.ts, à côté des collecteurs à froid (liquidations, hlHeat, whales, :164-176). Le parallèle avec snapshots.ts est impropre : ce module sauvegarde le KV, il ne collecte pas de marché. Sur Vercel, il n'y a ni daemon ni stockage serveur admis : l'historique se limite au localStorage de chaque visiteur (patron TERM).

**Sources.**

- Deribit get_book_summary_by_currency (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Déjà en production. CGU vérifiées : données à usage personnel, publication soumise à accord de Deribit.
- Deribit public/get_mark_price_history (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Marks 5 min des seules options du calcul DVOL ; profondeur et options expirées non vérifiées.

**Contrat.** Exception G100 nécessaire (section OMON, ligne BRIEF). Aucun nouveau fournisseur, aucun hôte, aucune clé. Pas d'enregistreur de ticks : 1 à 2 agrégats par jour, comme les collecteurs à froid existants. Pas de base serveur (anti-objectif « schéma DB serveur ») : pas d'historique partagé sur Vercel. Aucun indicateur ni AuxSeriesId, donc pas d'impact catalogue. Budget initial inchangé si le module est importé par OMON et BRIEF, chargés à la demande. CGU Deribit : usage personnel ; la redistribution publique passe déjà par le proxy /extapi (shared/extapi-hosts.ts:31). Le risque existe déjà ; publier un historique dérivé l'accroît légèrement.

**Risques.** Les ailes à 10Δ sont illiquides : l'IV mark y est modélisée par Deribit, d'où un bruit fort sur RR10 et BF10. L'échéance la plus courte s'interpole mal sous 7 j. Près de 08:00 UTC, heure d'échéance, la chaîne change de forme, donc l'heure de l'instantané compte. Aucun rattrapage : un percentile 1 an demande 1 an de collecte. get_mark_price_history ne couvre que les options du DVOL et sa profondeur n'est pas vérifiée : il ne peut pas reconstruire une année. Sur Vercel, l'historique est lacunaire et propre à chaque visiteur. Le critère « écart < 1,5 pt avec un skew tiers » suppose une source tierce accessible, non vérifiée.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La normalisation à delta et maturité constants est une correction méthodologique justifiée (pratique standard du marché), à coût modéré. Elle améliore la lisibilité de la variation du skew d'un jour à l'autre. L'historique a en revanche une valeur analytique différée, sans rattrapage : la mesure d'utilité (étude d'évènements) ne sera pas faisable avant longtemps. Le BF10 sur mark_iv est fragile. Priorité suggérée : interpolation RR25 et pente à 30 j d'abord, puis le collecteur ; étudier un rattrapage avant de promettre un percentile 1 an. Faits externes non revérifiés dans cette session : quota WebSearch épuisé, WebFetch bloqué.

**Références.**

- DVOL Deribit = IV à 30 j constants ; skew 25Δ à 30 j constants publié par Coin Metrics, Glassnode et NewHedge : vérifié selon l'idée, non revérifié ici
- CGU Deribit : usage personnel, publication soumise à accord : vérifié selon l'idée
- Xing, Zhang, Zhao, « What does the individual option volatility smirk tell us about future equity returns? », JFQA 2010 (actions, pas crypto) : non vérifié dans cette session
- Pouvoir prédictif du RR25 en crypto : aucune étude vérifiée dans cette session
- apps/web/src/data/skew.ts:5-9 et :23 (plus proche voisin, tolérance ±0,10 Δ)
- apps/web/src/data/termIv.ts:28-35 (ATM au strike le plus proche)
- apps/web/src/data/ivRank.ts:16 et apps/web/src/data/regime.ts:66 (seul historique d'options : DVOL)
- apps/web/src/components/OptionsWindow.tsx:203 et :265 (vues smile/GEX/heatmap/termiv, probabilité implicite)
- apps/web/src/components/TermStructureWindow.tsx:108-130 (patron d'instantané J-1/J-7 KV + localStorage)
- apps/daemon/src/snapshots.ts:8-9 (instantanés KV quotidiens, 30 j)

**Redondance.** Partielle. OMON a déjà le smile, le RR25 par échéance, la structure par terme de l'IV, la probabilité implicite, GEX/DEX et max pain. Le DVOL couvre déjà l'ATM à 30 j constants avec son percentile (ivRank, régime). Les vrais ajouts sont : (a) la normalisation à delta et maturité constants, qui supprime le bruit des rolls d'échéance et du strike le plus proche ; (b) l'historique quotidien du RR et du butterfly, absent aujourd'hui. L'ATM 30 j interpolé recoupe largement le DVOL.

**Pièges.** (1) mark_iv est la surface modélisée par Deribit : sur les ailes à 10Δ, le BF10 reflète surtout l'ajustement de Deribit plutôt que des transactions. (2) Convention de delta des options inverses (delta ajusté de la prime ou delta forward) : le strike à 25Δ se déplace. La comparaison avec un tiers exige la même convention. (3) Relevé à 08:05 UTC, juste après l'expiration de 08:00 : la courbe courte saute, et deux relevés par jour à heure fixe introduisent un biais intrajournalier. (4) Aucun rattrapage : percentile 1 an indisponible avant ~novembre 2027, étude d'évènements impossible avant plusieurs années. Pistes de rattrapage, toutes non vérifiées : trades historiques Deribit avec champ iv via history.deribit.com ; échantillons gratuits du 1er de chaque mois chez Tardis.dev, qui serait un nouveau fournisseur à faire passer en exception. get_mark_price_history ne couvre que les options du DVOL. (5) Trous lorsque le daemon est arrêté ; historique fragmenté par visiteur sur Vercel. (6) CGU Deribit (usage personnel) : risque déjà présent sur le site public. Stocker et réafficher un historique dérivé ne l'éteint pas.

**Protocole de validation.** Contrôles techniques : exactitude de l'interpolation sur un smile synthétique ; continuité aux expirations, avec un écart-type des variations quotidiennes du RR25 30 j inférieur à celui de l'échéance la plus proche. Cette mesure de succès de l'idée est un critère de lissage, pas d'information. Écart < 1,5 pt avec un tiers utilisant la même convention de delta. Informatif : impossible sans historique, donc rattrapage d'abord ou attente. Ensuite, manifeste figé : RR25 30 j hors de [p10, p90] puis rendements et drawdown à 7/30 j. Apport mesuré en plus du percentile DVOL déjà dans le régime. Développement sur BTC, test sur une période jamais vue puis sur ETH. Nulle par décalages circulaires, évènements dégroupés.

**Preuve d'intérêt (idéation).** Skew 25Δ à 30 j constants publié par Coin Metrics, NewHedge, Glassnode ; le DVOL est lui-même une IV à 30 j constants (vérifié par WebSearch). Le régime n'utilise que le percentile DVOL 90 j (apps/web/src/data/regime.ts:66).

**Mesure de succès.** Écart-type des variations quotidiennes du RR25 30 j < celui du RR25 de la prochaine échéance ; écart < 1,5 pt d'IV avec un skew 1 mois tiers sur 5 dates ; ≥ 95 % des jours couverts après 90 j ; event study RR25 hors [p10, p90].

**Fichiers à toucher.**

- shared/surfaceConstante.ts (+ test)
- apps/web/src/components/omon/VueTermIv.tsx ou OptionsWindow.tsx
- apps/daemon/src/surfaceOptions.ts (collecteur opt-in) + apps/daemon/src/index.ts
- apps/web/src/data/brief.ts (ligne skew 30 j constants)

**Avis des juges.**

- valeur (3) : Le RR25 et le BF25 à maturité constante sont la métrique standard d'un desk options. Aujourd'hui, Term IV prend le strike le plus proche, échéance par échéance (apps/web/src/data/skew.ts:4-8 ; termIv.ts), ce qui ne permet pas de comparer d'un jour à l'autre. Mais le percentile sur 1 an exige 1 an de collecte, sans rattrapage : valeur différée.
- cout-risque (4) : Aucune requête nouvelle (get_book_summary_by_currency déjà chargé), module pur dans shared/, instantané d'environ 300 o par jour sur le patron TERM en localStorage (TermStructureWindow.tsx). Risques : convention de delta des options inverses, ailes 10Δ modélisées par Deribit (garde-fou d'OI prévu), percentile 1 an inexistant avant 1 an de collecte. Sur Vercel, l'historique est propre à chaque navigateur.
- coherence (4) : L'onglet Term IV existe (OptionsWindow.tsx:628), comme le patron d'instantanés J-1/J-7 de TERM (daemon /kv puis repli localStorage, TermStructureWindow.tsx:7, 87). Le module dans shared/ est pur. Ni aux ni def.

### 16. SUG-40 — Anticipations d'évènements : pente attendue des taux US (DGS2 − DFF) sans source nouvelle, puis probabilités FOMC et seuils BTC de Polymarket/Kalshi face aux probabilités Deribit

**Score 14/20** · valeur 2 · coût-risque 5 · cohérence 5 · effort révisé **S** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : nouvelle source · origines : FLX-7, SRC-7, QNT-9

**Question de trading.** Le prochain FOMC est-il déjà dans les prix, quelle surprise a fait bouger BTC par le passé, et la foule et les options donnent-elles la même P(BTC > K) à l'échéance ?

**Proposition retenue après vérification.** Ne retenir que l'étage 1, sans source nouvelle. D'abord l'entrée de catalogue « Écart 2 ans − fed funds effectif (pb) » par ecartFred(DGS2, DFF). Ensuite une « surprise FOMC » mesurée par ΔDGS2 entre la veille et le jour de décision, mise en regard de la réaction BTC 1 h et 24 h déjà calculée par EVTS, avec n affiché. Polymarket reste une option soumise à la décision du propriétaire sur le plan juridique (France) et les CGU, sans instantané daemon. Kalshi abandonné.

**Proposition initiale.** Étage 1 : entrée de catalogue macro « Pente attendue des taux US » = DGS2 − DFF via ecartFred, variation sur 5 j autour de chaque FOMC dans EVTS. Étage 2 : liste curée de marchés Polymarket (BTC au-dessus de K à T, décision FOMC) lus par Gamma/CLOB ; dans OMON › Probas, P_options (probaClotureAuDessus ou probaToucher) contre P_Polymarket, écart, spread et liquidité ; dans EVTS et BRIEF, probabilités baisse/maintien/hausse et surprise = issue − probabilité de la veille, nuage surprise × réaction BTC 1 h/24 h ; instantané quotidien dans le KV du daemon.

**Ce qui existe déjà.** Le rendement à 2 ans est déjà affiché dans RATE (apps/web/src/data/macro/treasuryYields.ts:147), les taux directeurs viennent de BIS (apps/web/src/data/macro/policyRates.ts:2) et les dates FOMC 2020-2027 sont en dur (apps/web/src/data/macro/eventDates.ts:151 et :209). La « surprise » existe déjà dans EVTS pour CPI, NFP, PCE et ventes au détail : réalisé − consensus capturé (apps/web/src/data/macro/publicationArchive.ts:14 et :257, apps/web/src/components/EvtsWindow.tsx:45). Le FOMC n'en fait pas partie, donc l'affirmation « EVTS sans mesure de surprise » est inexacte. Les probabilités options existent dans OMON (apps/web/src/data/probaImplicite.ts:55, :107 et :121 ; apps/web/src/components/OptionsWindow.tsx:41 et :275). L'écart entre deux séries FRED existe (catalogueMacro.ts:25 et :124, chargerSerieMacro.ts:67-71). Inexact aussi : DFF n'est appelé par aucun code applicatif, seulement par des tests (apps/daemon/src/vercelProxy.test.ts:113, vercelServerCredentials.test.ts:17) et par la revue docs/revue-2026-09-30.md:243. docs/revue-2026-11-06.md:871 traite du cache privé, pas de DFF. La seule mention de Kalshi est une exclusion de test (apps/web/src/data/onchain/oiPerpsDex.test.ts:21).

**Réutilise.** courbeProbaImplicite, chaîne Deribit en cache, chargerFenetreReactionM1, calculerReactionEvenement, dates FOMC (apps/web/src/data/macro/eventDates.ts:322), KV du daemon.

**Point d'intégration.** Étage 1, sans source nouvelle : dans apps/web/src/data/macro/catalogueMacro.ts, une valeur IndicateurMacro (:14), une entrée INDICATEURS_MACRO (:42-69) et une ligne `definir("pente-2a-ff", "US", { transport: "ecartFred", gauche: "DGS2", droite: "DFF", facteur: 100 }, { frequence: "D" })` sur le patron de :124. La route fredapi l'autorise déjà (api/_policy.ts:308) et la série s'affiche dans MacroSeriesTab, ECO et BRIEF. Surprise FOMC : ΔDGS2 du jour de décision contre la veille, calculé dans un module pur et affiché dans EVTS à côté des réactions BTC existantes (chargerFenetreReactionM1 et calculerReactionEvenement), sans modifier TypePublication. Étage 2 (Polymarket) : hôtes gamma-api et clob dans EXTAPI_HOSTS avec extapiCheminAutorise, pas EXTAPI_HOTES_SPECIALISES. Pas d'instantané KV dans le daemon : il n'existe pas sur Vercel, et l'historique de prix du CLOB (/prices-history, non vérifié dans cette passe) le rendrait inutile.

**Sources.**

- Polymarket Gamma API et CLOB (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Lecture publique sans clé ni authentification (docs.polymarket.com et README de py-clob-client, vérifiés) ; limites, CORS, historique des prix et CGU de réaffichage non vérifiés ; statut en France non vérifié.
- Kalshi API de données de marché (nouvelle ; non vérifié ; vérifiée en ligne par l'idéation : non) : Accès public, historique, CORS et CGU non vérifiés.
- FRED DGS2 et DFF (déjà utilisée ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : non) : DFF déjà appelé via /fredapi (docs/revue-2026-11-06.md:871) ; DGS2 non vérifié dans le dépôt.

**Contrat.** Étage 1 : aucun fournisseur nouveau, puisque FRED a déjà une clé serveur (BUILD-CONTRACT.md:1286-1290), et aucune clé à ajouter. Ajouter une ligne au catalogue reste dans la surface existante. La colonne « surprise FOMC » d'EVTS modifie une surface : exception G100 à acter (:71). Les requêtes FRED avec clé serveur ne passent pas par le cache CDN (private, no-store), ce qui consomme le quota partagé. Étage 2 : exception fournisseur (:26 et :80), exceptions G100 pour OMON et EVTS, point juridique et CGU à trancher par le propriétaire avant tout affichage public. Kalshi est à abandonner.

**Risques.** DGS2 − DFF n'est pas une « pente attendue » pure : elle intègre une prime de terme et la position du taux effectif dans la fourchette, d'où un libellé neutre comme « Écart 2 ans − fed funds effectif ». DGS2 est publié en jours ouvrés, DFF tous les jours : il faut les dates communes, ce que fait déjà differenceDatesCommunes. ΔDGS2 sur un jour mélange la décision et les autres nouvelles de la séance, et n reste faible (environ 48 FOMC de 2020 à 2025, plus ceux de 2026), donc puissance faible à annoncer. Polymarket, non vérifié dans cette passe : blocage par l'ANJ en France, CGU de réaffichage, CORS, granularité de l'historique des marchés résolus. Les échéances diffèrent entre Polymarket et Deribit (08:00 UTC), d'où une interpolation sur la courbe implicite. L'écart foule/options mélange prime de risque et frais.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. L'idée réunit deux étages de valeur très différente. Étage 1 : utile avec réserve. Une ligne de catalogue via ecartFred, sans fournisseur nouveau, comble le manque réel de mesure de surprise FOMC dans EVTS ; il faut corriger la fenêtre (jour de décision, pas 5 j) et présenter le résultat comme descriptif vu le faible n. Étage 2 : gadget pour du swing à ce stade. Le seuil BTC double OMON, l'écart foule/options est surtout de la prime de risque et des artefacts de résolution, aucun historique n'est disponible et le statut juridique en France est incertain. Seules les probabilités FOMC (Kalshi) ont un apport propre, sous réserve de CGU et d'accès public (non vérifiés). Recommandation : livrer l'étage 1 et reporter l'étage 2 à une collecte silencieuse préalable. Limite de cette évaluation : budget WebSearch épuisé et docs.polymarket.com injoignable, donc les faits externes ajoutés ici (règles de résolution, ANJ, latences FRED) sont de mémoire et non revérifiés.

**Références.**

- Kuttner, J. Monetary Economics 2001 : surprises de taux mesurées par les futures sur fed funds. Cité, non revérifié
- Gürkaynak, Sack & Swanson, Int. J. Central Banking 2005 : facteurs « cible » et « trajectoire », ce dernier lié aux taux à 2 ans. Cité de mémoire, non revérifié
- Wolfers & Zitzewitz, J. Economic Perspectives 2004 : agrégation d'information par les marchés prédictifs. Cité, non revérifié
- Snowberg & Wolfers, J. Political Economy 2010 : biais favori/outsider dans les marchés de paris. Cité de mémoire, non revérifié
- apps/web/src/data/probaImplicite.ts:55, :107, :121 et apps/web/src/components/omon/VueSmile.tsx:191 (P(clôture > K) risque-neutre déjà affichée)
- apps/web/src/data/macro/publicationArchive.ts:257 et publicationConsensus.ts:100 (surprise CPI/NFP déjà calculée)
- apps/web/src/components/EvtsWindow.tsx:438 (FOMC exclu de la logique de surprise)
- apps/web/src/data/macro/eventDates.ts:141-150 (FOMC curés depuis 2020, environ 57 décisions à ce jour)
- apps/web/src/data/macro/treasuryYields.ts:50, :106 (2 Yr et 2s10s déjà affichés dans RATE)
- apps/web/src/data/macro/catalogueMacro.ts:25, :124 (transport ecartFred, précédent SOFR−IORB)
- shared/server-credentials.ts:3 (clé FRED serveur)
- apps/daemon/src/vercelServerCredentials.test.ts:17 (DFF n'apparaît QUE dans des tests)
- apps/web/src/lib/evts.ts:101, apps/web/src/data/evtsReactions.ts:25

**Redondance.** Étage 1 : mesure dérivée de données déjà affichées (2 ans US dans RATE, treasuryYields.ts:50, et taux directeur Fed via BIS, MacroRatesWindow.tsx:9). Elle n'est cependant pas cataloguée : DGS2 et DFF n'existent qu'en tests (vercelServerCredentials.test.ts:17), contrairement à « DFF déjà appelé » dans l'idée. Le vrai manque est la surprise FOMC : EVTS calcule déjà des surprises CPI/NFP (publicationArchive.ts:257) mais exclut le FOMC (EvtsWindow.tsx:438). Étage 2 : les seuils BTC Polymarket/Kalshi recoupent fortement OMON, qui affiche déjà P(clôture > K) et P(toucher) risque-neutres (probaImplicite.ts:107, :121). Seul l'écart foule/options serait nouveau. Les probabilités FOMC de Kalshi/Polymarket n'ont aucun équivalent (pas de futures fed funds gratuits).

**Pièges.** Étage 1 : 1) DGS2 − DFF reflète la trajectoire moyenne sur 2 ans plus une prime de terme, pas la réunion suivante : il ne dit pas si « le prochain FOMC est dans les prix ». 2) Latence : DFF est publié le jour ouvré suivant et DGS2 (H.15) avec environ 1 jour (de mémoire). Dater au jour de publication. 3) Une fenêtre de 5 j autour du FOMC est contaminée par CPI, NFP et le reste : utiliser la variation du 2 ans le jour de la décision. 4) 2020-2021 au plancher zéro : écart dégénéré. 5) Environ 8 FOMC par an, environ 57 depuis 2020, et un test réel d'environ 20 évènements : puissance faible, à afficher avec n. Étage 2 : 6) Règles de résolution différentes : marchés BTC Polymarket résolus sur un prix de place à une minute précise (règle typique Binance, non revérifiée) contre options Deribit réglées sur une moyenne de l'indice Deribit à 08:00 UTC (de mémoire). L'écart contient un artefact mécanique si K et T ne sont pas identiques. 7) Biais favori/outsider, frais, spreads larges et faible liquidité sur les seuils extrêmes. 8) Liste curée a posteriori : biais de sélection. 9) Historique : sans prices-history CLOB (non vérifié), rien avant les instantanés du daemon, donc aucun backtest au lancement ; un score de Brier sur 30 résolutions FOMC demande environ 4 ans. 10) Risque-neutre contre foule : l'écart mesure par construction une prime de risque et des biais, pas une erreur exploitable. 11) Juridique : accès à Polymarket restreint en France par l'ANJ (de mémoire, non revérifié) ; CGU de réaffichage de Polymarket et Kalshi non vérifiées.

**Protocole de validation.** Étage 1 : 1) contrôle mécanique, DGS2 − DFF égal à FRED sur 10 dates ; 2) étude d'évènements FOMC figée par manifeste : surprise = variation de DGS2 le jour de décision (et non sur 5 j) ; hypothèse signée (surprise restrictive, donc rendement BTC négatif à 24 h) ; exploration 2020-2023, test 2024-2026 jamais consulté ; corrélation de rang et nul par permutation des surprises entre réunions ; n publié. Avec environ 20 évènements de test, prévoir NON CONCLUANT et un usage descriptif. Étage 2 : commencer les instantanés quotidiens dans le KV du daemon SANS affichage. Règles figées : appariement strict K/T/source de résolution, exclusion des marchés à spread > x ou volume < y fixés a priori. Après au moins 30 résolutions BTC, comparer Brier et courbe de calibration Polymarket contre Deribit (probaClotureAuDessus). Afficher seulement si la calibration est publiée avec n.

**Preuve d'intérêt (idéation).** Kuttner (JME 2001) : les surprises monétaires expliquent la réaction des marchés ; Wolfers & Zitzewitz (JEP 2004) : agrégation d'information par les marchés prédictifs (cités, non revérifiés). L'écart risque-neutre/foule mesure par construction une prime de risque.

**Mesure de succès.** DGS2 − DFF égal à FRED sur 10 dates ; après ≥ 30 résolutions, score de Brier Polymarket contre Deribit ; corrélation de rang surprise/réaction BTC 24 h publiée avec n ; affichage refusé sans historique des probabilités.

**Fichiers à toucher.**

- apps/web/src/data/macro/catalogueMacro.ts
- apps/web/src/data/macro/surpriseFomc.ts (nouveau + test)
- apps/web/src/components/EvtsWindow.tsx
- étage 2 seulement : shared/extapi-hosts.ts, apps/web/src/data/polymarket.ts, apps/web/src/components/OptionsWindow.tsx, BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : DGS2 − DFF reflète la trajectoire à 2 ans plus une prime de terme, pas le prochain FOMC. Lien faible avec la décision swing crypto. La réaction FOMC existe déjà dans EVTS.
- cout-risque (5) : Étage 1 seul : FRED déjà en clé serveur, fred/series/observations autorisé (api/_policy.ts:308), ecartFred et differenceDatesCommunes existants, effort S. Coût marginal : réponses private no-store sur le quota FRED partagé. Risque faible si le libellé reste neutre (« Écart 2 ans − fed funds effectif ») et que n est affiché pour la surprise FOMC. Polymarket et Kalshi écartés.
- coherence (5) : L'étage 1 tient en une ligne de catalogueMacro.ts avec le transport ecartFred, comme « sofr-iorb » (data/macro/catalogueMacro.ts:124), et differenceDatesCommunes existe (harmonisation.ts:113). La colonne EVTS est une petite exception G100.

### 17. SUG-42 — Régimes mesurés : par actif (tendance × volatilité, 9 états avec statistiques conditionnelles) et transversaux (dispersion, corrélation moyenne, ratio d'absorption)

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : quantitatif · origines : QNT-8, QNT-5

**Question de trading.** Sur cet actif et cette unité, suis-je dans un régime où le suivi de tendance a payé ou dans un range, et le marché est-il mené par un seul facteur BTC (la sélection d'alts n'apporte rien) ou dispersé ?

**Proposition retenue après vérification.** Garder le volet transversal : dispersion transversale lissée 7 j, médiane des ρ alts/BTC sur 30 j, corrélation moyenne par paire et ratio d'absorption sur 60 j, dans un onglet « Régime » de CORR et une ligne du BRIEF. Il est alimenté par le même panneau de clôtures 1d du top 50 Binance que SUG-41, avec une seule collecte et l'univers affiché. Pour l'actif, un seul indicateur « régime tendance × volatilité » composé des briques existantes (EMA, efficiencyRatio, atrRegime), sous forme de ruban, sans panneau de statistiques dans l'interface. Les statistiques conditionnelles par état se calculent hors ligne dans scripts/axis/ : protocole figé, pool jamais vu, n par état et intervalles par blocs publiés.

**Proposition initiale.** (1) Indicateur regimeTendanceVol : tendance par signe(close − EMA n) si Efficiency Ratio ≥ 0,3, volatilité par terciles du rang percentile de l'ATR, 9 états, ruban annoté ; panneau de statistiques par état (n, rendement médian et dispersion à 5 et 20 bougies, taux de hausse, MAE, IC bootstrap par blocs), libellé « descriptif, dans l'échantillon ». (2) regimeCorrelation.ts sur les rendements 1d du top 50 : dispersion transversale lissée 7 j, médiane des ρ alts/BTC 30 j, corrélation moyenne par paire, ratio d'absorption (première composante sur 60 j par itération de puissance), RV transversale ; onglet « Régime » de CORR et ligne BRIEF.

**Ce qui existe déjà.** Les briques existent séparément : atrRegime, rang percentile de l'ATR (packages/indicators/src/volatility/atrRegime.ts:37-84), efficiencyRatio, adx et kama (packages/indicators/src/trend/), choppiness et hurst (packages/indicators/src/volatility/). utils-annotations peut servir au ruban (packages/indicators/src/utils-annotations.ts). Aucune ne combine tendance et volatilité en états. Le régime de marché est un score composite instantané de −2 à +2 sur 8 composants publics (apps/web/src/data/regime.ts:1-7, :165). CORR propose deux onglets, matrice et paires (apps/web/src/data/corr.ts:93), la corrélation glissante d'une paire (corr.ts:365-382) et un univers CoinGecko top 10/20/30 (corr.ts:75-80). L'étude d'évènements a des horizons fixes de 24 h et 72 h (apps/web/src/data/validationSignaux.ts:40-60, :187-236). Le bootstrap par blocs mobiles existe pour les PnL de trades (packages/backtest/src/monteCarlo.ts:4-7, :48). volCone est à apps/web/src/lib/volCone.ts:109. grep dispersion : seulement FundingHistory et CbpremWindow. Rien pour le ratio d'absorption, l'itération de puissance ou la corrélation moyenne transversale. Le registre compte déjà 220 indicateurs (packages/indicators/src/registry.test.ts:21) alors que le contrat en annonce 219.

**Réutilise.** rma/trueRange, efficiencyRatio, SommesEtude/StatsEtude (apps/web/src/data/validationSignaux.ts:45-60), monteCarlo (packages/backtest/src/monteCarlo.ts:79), logRendements/pearson/alignerSeries (corr.ts:205-300), clôtures BREADTH, volCone.

**Point d'intégration.** (1) Indicateur dans packages/indicators/src/volatility/ qui compose ema, efficiencyRatio et rma(trueRange) et sort un code d'état plus des annotations. Un IndicatorDef ne renvoie que des séries : un panneau de statistiques n'a aucune surface d'accueil et serait une nouvelle UI. (2) Module pur regimeTransversal.ts qui lit le même panneau de clôtures top 50 que SUG-41 (une seule collecte), et onglet « regime » ajouté au type local OngletCorr (corr.ts:93) et à hydraterReglagesCorr (corr.ts:651-652). @axiom/types n'est pas touché. Pour la ligne du BRIEF, réutiliser SectionBreadth. Le calcul est négligeable (covariance 50×50, itération de puissance) : pas de worker.

**Sources.**

- Bougies du graphe et klines 1d du top 50 Binance (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Aucune donnée externe supplémentaire.

**Contrat.** Un nouvel indicateur étend le catalogue (BUILD-CONTRACT.md:82) : la nécessité doit être démontrée et le compte du registre mis à jour. L'onglet CORR et la ligne BRIEF demandent l'exception G100. Aucun fournisseur, aucune clé, aucun hôte, pas de @axiom/types. La version complète (deux volets plus un panneau de statistiques bootstrap dans l'UI) serait plutôt L.

**Risques.** 1) La preuve interne est mal attribuée. Le gain AXIS validé vient du garde-fou « référence BTC au-dessus de son EMA 100 » (docs/axis-2026-10-07.md:889-892), donc d'un régime de marché via BTC, pas d'un état tendance × volatilité propre à l'actif. Rien dans le dépôt ne soutient les 9 états. 2) Statistiques dans l'échantillon : 9 états × 2 horizons, rendements forward qui se chevauchent, n faible par état en 4h. Le risque de comparaisons multiples est élevé, et les h dernières bougies doivent être exclues. 3) Le seuil ER 0,3 et les terciles de rang ATR sont arbitraires et dépendent du lookback. 4) Les univers diffèrent : CORR utilise la capitalisation CoinGecko, BREADTH le volume Binance. Il faut en choisir un et le dire. 5) Le ratio d'absorption sur 50 actifs et 60 observations repose sur une covariance instable. Sans exclusion des stables et des emballés, il est biaisé. 6) Non vérifié : la littérature citée (Moskowitz et al., Kritzman et al., Stivers & Sun), faute de recherche web disponible.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. À scinder. Partie transversale (dispersion des rendements et une seule mesure de corrélation) : utile pour décider si le choix d'alts apporte quelque chose, et nouvelle dans AXIOM. Ruban à 9 états : largement redondant avec atrRegime, efficiencyRatio et adx. Il ne vaut que par son panneau de statistiques, qui doit rester descriptif. Corriger la mesure de succès du ratio d'absorption (plancher de bruit vérifié par simulation). La preuve interne AXIS soutient un régime transversal BTC, pas ce découpage par actif. Références externes non revérifiées : quota WebSearch épuisé.

**Références.**

- Moskowitz, Ooi, Pedersen, « Time Series Momentum », JFE 2012 : non revérifié en ligne
- Liu & Tsyvinski, « Risks and Returns of Cryptocurrency », RFS 2021 (momentum temporel en crypto) : non revérifié en ligne
- Kritzman, Li, Page, Rigobon, « Principal Components as a Measure of Systemic Risk », JPM 2011 (ratio d'absorption, plusieurs vecteurs propres, longue fenêtre) : non revérifié en ligne
- Stivers & Sun, JFQA 2010 (dispersion transversale et primes momentum/value) : non revérifié en ligne
- Forbes & Rigobon, JF 2002 (biais d'hétéroscédasticité des corrélations en crise) : non revérifié en ligne
- Interne : docs/axis-2026-10-07.md:880-898. Le seul gain AXIS validé vient d'un régime TRANSVERSAL (BTC contre son EMA 100), pas d'un régime tendance × volatilité de l'actif
- Simulation locale /tmp/claude-0/-home-user-axiom/006b3956-3bcb-553d-93c7-502146b32fa7/scratchpad/outils-analyse/ar-bruit.py : sur du bruit pur, ratio d'absorption à 1 composante ≈ 0,068 pour N = 50 et T = 60, et non 1/N = 0,02 (Marchenko-Pastur ≈ 0,073)

**Redondance.** (1) Par actif : forte. Le ruban à 9 états combine des briques existantes : atrRegime, rang percentile de l'ATR (packages/indicators/src/volatility/atrRegime.ts:1-40), efficiencyRatio, choppiness, hurst, vhf, adx, supertrend (packages/indicators/src/trend, packages/indicators/src/volatility). La seule nouveauté est le panneau de statistiques conditionnelles. Il recoupe validationSignaux (apps/web/src/data/validationSignaux.ts:40-60, horizons 24 h/72 h) et l'esprit d'IDEE-10, exclue. (2) Transversal : partielle. correlationGlissante et la matrice existent (apps/web/src/data/corr.ts:365, :404), ainsi que les indicateurs rollingCorrelation et betaRef. La dispersion des RENDEMENTS n'existe pas : grep « dispersion » ne renvoie que du funding, apps/web/src/components/FundingHistory.tsx:1. Dans un marché crypto à facteur BTC dominant, la médiane des ρ alts/BTC, la corrélation moyenne par paire et le ratio d'absorption à 1 composante mesurent presque la même chose : en garder une, plus la dispersion.

**Pièges.** Seuils arbitraires (ER ≥ 0,3, terciles) : sur-ajustement dès qu'on les retouche après avoir vu les statistiques. Horizons chevauchants à 5 et 20 bougies, états persistants : le n effectif est bien inférieur au nombre de bougies, d'où la nécessité du bootstrap par blocs proposé. Le rang percentile doit rester glissant (c'est le cas d'atrRegime) : des terciles sur l'échantillon entier seraient une anticipation. Le « p80 de corrélation » de la mesure de succès doit être un quantile en expansion, pas calculé sur tout l'échantillon. Ratio d'absorption avec N = 50 et T = 60 : estimation très bruitée, plancher de 0,068 sur du bruit, donc le test « ≈ 1/N sur bruit » proposé échouera. Le comparer au seuil de Marchenko-Pastur ou à une base mélangée, ou allonger T (≥ 250). Les corrélations montent mécaniquement avec la volatilité (Forbes-Rigobon), ce qui recoupe le régime de volatilité. Mêmes biais d'univers que SUG-41 : top 50 du jour, Binance seul.

**Protocole de validation.** Figer dans un manifeste (patron scripts/axis/) les définitions, seuils et horizons, puis une seule hypothèse par bloc. H1 : l'expectancy de Supertrend+ADX est plus élevée en « tendance, vol normale » qu'hors de cet état, sur un pool jamais vu (paires spot d'une plateforme non encore lue), critères de type P1-P3 et coûts ×3. H2 : l'écart de rendement entre quintiles RS se réduit au-dessus du p80 en expansion de la corrélation moyenne, dans les deux moitiés, avec un test de permutation par décalage circulaire. Dans l'interface, les statistiques par état restent marquées « descriptif, dans l'échantillon » tant que H1 n'est pas tenue.

**Preuve d'intérêt (idéation).** Momentum temporel (Moskowitz, Ooi, Pedersen JFE 2012 ; Liu & Tsyvinski RFS 2021), ratio d'absorption (Kritzman et al., JPM 2011), dispersion et momentum (Stivers & Sun, JFQA 2010), tous cités non revérifiés. Interne : conditionnement par régime = seul gain AXIS validé, EMA 200 seule = hasard (p = 0,454, docs/axis-2026-10-07.md:880-898).

**Mesure de succès.** Somme des n = bougies classées, anti-repaint ; ratio d'absorption = 1 sur séries corrélées, ≈ 1/N sur bruit ; campagne figée : expectancy Supertrend+ADX plus élevée en « tendance, vol normale » ; écart de quintiles RS réduit au-dessus du p80 de corrélation dans les deux moitiés.

**Fichiers à toucher.**

- apps/web/src/data/regimeTransversal.ts (nouveau, + test)
- apps/web/src/data/corr.ts
- apps/web/src/components/CorrWindow.tsx
- apps/web/src/components/brief/SectionBreadth.tsx
- packages/indicators/src/volatility/<regimeTendanceVol>.ts (+ test)
- packages/indicators/src/registry.ts
- packages/indicators/src/registry.test.ts
- scripts/axis/ (étude conditionnelle hors ligne)

**Avis des juges.**

- valeur (3) : Le volet transversal (dispersion, corrélation moyenne) dit si la sélection d'alts paie : information utile, qui recoupe SUG-41 et regime.ts. Le ruban par actif n'est qu'un assemblage de briques existantes, et ses 9 états n'ont aucun appui dans le dépôt.
- cout-risque (4) : Le volet transversal réutilise le panneau de SUG-41 (une seule collecte). L'indicateur de régime est composé de briques existantes, mais ajoute un def au chunk initial. Statistiques conditionnelles hors ligne dans scripts/axis/ : pas de chiffres in-sample dans l'interface. Seuils arbitraires à figer.
- coherence (4) : Le volet transversal partage le panneau de SUG-41 (une seule collecte) dans un onglet CORR. Le ruban par actif compose des briques existantes (efficiencyRatio, atrRegime), mais ajoute un def. Les statistiques sont hors ligne dans scripts/axis.

### 18. SUG-C2 — Dessins d'analyse standard manquants : fourches d'Andrews et de Schiff, extension de Fibonacci à 3 points, Fibonacci temporel, éventail et canal, étiquettes d'Elliott contrôlées, XABCD aux ratios en direct, texte et flèches

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : critique de complétude, trou AT de l'inventaire : dessin avancé

**Question de trading.** Où projeter l'objectif de la jambe C (extension 1,272/1,618 de AB), quel canal médian suit le swing, et mon décompte d'Elliott respecte-t-il les règles de base ?

**Proposition retenue après vérification.** Phase 1 (M) : quatre overlays custom dans chart/dessinsAvances.ts, géométrie pure et testée. (a) Fourche à 3 points en trois noms d'overlay : fourche, fourcheSchiff, fourcheSchiffMod. (b) Extension de Fibonacci ABC : niveaux de AB reportés depuis C, ratios du fibStore. (c) Zones temporelles de Fibonacci (1, 2, 3, 5, 8, 13… bougies depuis le 1er point, projetées vers le futur par versPointGraphe). (d) ABCD/XABCD avec les ratios AB/XA, BC/AB, CD/BC et AD/XA affichés en direct, sans nom de motif. Phase 2 (S) : outil texte/étiquette, avec un champ texte facultatif ajouté à SavedOverlay (≤ 200 caractères) et simpleAnnotation comme rendu, plus les étiquettes d'Elliott 0-5 et A-B-C. Les trois règles y sont des avertissements « hors impulsion classique » qui mentionnent l'exception des diagonales. Écarter l'éventail et le canal de Fibonacci (le canal parallèle existe) et l'exposition d'arc, circle et polygon, qui sont des figures, pas des outils.

**Proposition initiale.** Exposer les templates natifs non utilisés (text, simpleAnnotation, simpleTag, arc, circle, polygon) et ajouter par registerOverlay : fourche (3 points, variantes Andrews, Schiff et Schiff modifiée, médianes 0,5/1), extension de Fibonacci ABC (niveaux 0,618/1/1,272/1,618/2,618 de AB reportés depuis C, ratios du fibStore), zones temporelles de Fibonacci (suite 1, 2, 3, 5, 8… en bougies), éventail et canal de Fibonacci, étiquettes d'Elliott 1-5 et A-B-C avec trois règles vérifiées en avertissement (vague 2 qui ne dépasse pas l'origine, vague 3 jamais la plus courte, vague 4 sans recouvrement de la vague 1), XABCD qui affiche en direct AB/XA, BC/AB, CD/BC et AD/XA sans nommer de « motif ». Couleurs du thème lues au rendu, persistance par slot comme les dessins existants.

**Ce qui existe déjà.** Existe : 17 outils (apps/web/src/chart/drawing.ts:44-61, TOOL_OVERLAY :69-87), dont fibTrend qui projette déjà 127,2/161,8 % au-delà du 2e point d'une jambe à 2 points (fibonacci.ts:331-350, totalStep 3 :332), canal parallèle natif et overlay position à 3 points (position.ts:134-136, totalStep 4). Absents (grep pitchfork|fourche|elliott|xabcd|fibTime : rien dans apps/web) : fourche, extension ABC à 3 points, zones temporelles, Elliott, XABCD, texte. Erreur factuelle dans l'idée : text, arc, circle et polygon ne sont PAS des templates d'overlay mais des FIGURES (registre des figures, index.esm.js:7426-7429). Les seuls templates natifs non exposés sont simpleAnnotation et simpleTag (index.esm.js:5527-5532), et leur texte passe par extendData (:5409-5420). Or la persistance ne garde que le nom et les points (SavedOverlay, drawing.ts:314-317), et createTrackedOverlay ne passe extendData qu'au VPFR (:528-529). Un outil texte demande donc un champ texte persisté et une saisie, ce n'est pas une simple exposition. Points futurs déjà gérés par extrapolation (versPointGraphe :297-307), utile pour les zones temporelles.

**Réutilise.** Patron registerOverlay de fibCustom/fibTrend et position (apps/web/src/chart/fibonacci.ts:20, apps/web/src/chart/position.ts:134), fibStore des ratios, lireTokenCanvas, coinsRectangle comme modèle de géométrie pure testée (drawing.ts:93), DrawingToolbar (apps/web/src/components/DrawingToolbar.tsx:251).

**Point d'intégration.** Overlays custom par registerOverlay, même patron que fibonacci.ts:313-350 et position.ts:134. totalStep libre dans le bundle (:1249, :1312), donc 5-6 points possibles pour XABCD. Géométrie pure testée dans un nouveau module, sur le modèle de coinsRectangle (drawing.ts:99). Ids dans DrawingToolId et TOOL_OVERLAY, entrées dans TOOLS (DrawingToolbar.tsx:250). Seuls ces 3 fichiers référencent les ids d'outils. Variantes (Andrews, Schiff, Schiff modifiée) encodées dans le NOM d'overlay, puisque SavedOverlay ne persiste aucune option. Aucune donnée, aucun hôte.

**Sources.**


**Contrat.** Exception G100 nécessaire (nouveaux outils de surface, BUILD-CONTRACT.md:71). Aucun fournisseur, aucune clé, aucun hôte, aucun impact sur le chargement initial si le module est importé à la demande. KLineChart figé respecté (registerOverlay, BUILD-CONTRACT.md:21). Aucune dépendance (BUILD-CONTRACT.md:53). Dessins scellés au slot via la clé existante slot:exchange:symbole (drawing.ts:457-462). Périmètre complet (8 familles + texte + Elliott) = L, pas M.

**Risques.** 1) Les règles d'Elliott en avertissement donnent de faux avertissements sur les diagonales (recouvrement 4/1 admis) et les cinquièmes tronquées : afficher « hors règle d'impulsion classique », pas « invalide ». 2) Le texte libre change le schéma persisté (SavedOverlay) : migration et lecture tolérante à prévoir. La sauvegarde des dessins échoue déjà en silence quand le localStorage est plein (DATA-3 de la revue). 3) Zones temporelles en bougies sur les marchés à séance (Twelve Data) : l'extrapolation par pas fixe se décale sur les week-ends. 4) Barre déjà longue (17 entrées) : sur mobile, groupe replié obligatoire. 5) Aucun avantage démontré : ce sont des annotations, à présenter comme telles. Preuve externe (aide TradingView) non revérifiée dans cette session, budget de recherche épuisé.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Répond à la demande d'outils d'AT. Ce sont des outils standard, sans hôte ni donnée. L'intérêt informatif n'est pas documenté, et la littérature citée de mémoire est plutôt défavorable aux ratios de Fibonacci. Je recommande un lot réduit : extension de Fibonacci ABC (la seule vraie lacune analytique), fourches d'Andrews et de Schiff, texte et étiquette (simpleTag natif plus texte sur mesure). Reporter Elliott, dont le vérificateur reste partiel à cause des exceptions, ainsi que XABCD. Le Fibonacci temporel et l'éventail relèvent du gadget. La proposition contient une erreur factuelle : text, arc, circle et polygon sont des figures, pas des overlays. Les références externes ne sont pas vérifiées : la limite de 200 recherches web était atteinte, et tradingview.com comme quantopian.github.io sont refusés par le réseau du conteneur.

**Références.**

- Interne : aucune mesure de Fibonacci, d'Elliott, de fourche ni d'harmonique dans docs/research ni scripts/axis/. Le grep elliott|harmoni|pitchfork|xabcd ne trouve que des plans et des revues, sans aucun résultat chiffré.
- node_modules/.pnpm/klinecharts@9.8.12/node_modules/klinecharts/dist/index.esm.js:5527-5531 : les 15 templates d'overlay natifs. simpleAnnotation, simpleTag, horizontalSegment, verticalRayLine et verticalSegment ne sont pas exposés.
- index.esm.js:7427 : text, arc, circle, polygon et rect sont des FIGURES et non des templates d'overlay. C'est la même confusion que celle déjà documentée pour rect en apps/web/src/chart/drawing.ts:79-86.
- apps/web/src/chart/fibonacci.ts:14-18 et :329-345 : fibTrend projette 1,272 et 1,618 de la même jambe à 2 points. Aucune extension AB reportée depuis C.
- Batchelor R. et Ramyar R., « Magic numbers in the Dow » (vers 2006) : pas de sur-représentation des ratios de Fibonacci dans les tendances. Cité de mémoire, non vérifié (quota WebSearch épuisé).
- Frost A.J. et Prechter R., Elliott Wave Principle (1978) : source des trois règles. Ouvrage de pratique, cité de mémoire, non vérifié.
- Lo, Mamaysky et Wang (2000), « Foundations of Technical Analysis », J. Finance : figures détectées par un algorithme, avec un apport informatif modeste. Cité de mémoire, non vérifié.
- Page d'aide TradingView 43000703396 : www.tradingview.com injoignable depuis le conteneur, non revérifiée.

**Redondance.** Partielle. Le canal est déjà couvert par parallelChannel et priceChannel (drawing.ts:79-80). Des repères structurels automatiques et causaux existent déjà : zigzag (support_resistance/zigzag.ts:28), pivotHighLow, pivotFibonacci et les zones S/R d'AXIS S/R (docs/axis-2026-10-07.md:946-990). Ces zones sont même mesurées hors protocole, avec environ 81 % de tenue à 6 bougies. Vraies lacunes : l'extension ABC, la fourche et le texte libre. Correction factuelle : text, arc, circle et polygon ne sont pas des templates « à exposer ». Le texte demande un registerOverlay sur mesure, comme rect, plus une saisie de la chaîne. Seul simpleTag ou simpleAnnotation est natif.

**Pièges.** Aucun repaint calculé, puisque le dessin est manuel. En revanche, le look-ahead est cognitif : A, B, C et les vagues sont posés après coup sur des pivots déjà connus, et un décompte d'Elliott se réétiquette à volonté, ce qui le rend infalsifiable. Le vérificateur de règles a des limites. La règle de non-recouvrement de la vague 4 admet des exceptions (diagonales), d'où de faux avertissements. La règle « vague 3 jamais la plus courte » ne s'évalue qu'une fois la vague 5 tracée. Pour XABCD, afficher les ratios sans nommer de motif est sain, mais l'utilisateur fera de lui-même le rapprochement Gartley ou Bat, avec des tolérances qui permettent un sur-ajustement de lecture. Le Fibonacci temporel compte en bougies : sur Twelve Data ou le forex, les trous de séance faussent la correspondance avec le temps. Chaque nouvel overlay ajoute un nom persistant par slot, à migrer en cas de renommage. Enfin, la surface augmente sous le gel G100.

**Protocole de validation.** Les tests de géométrie à 1e-9 valident le tracé, pas l'intérêt. Le seul protocole honnête passe par une version automatique et causale. Pivots confirmés comme pivotSr d'AXIS S/R (docs/axis-2026-10-07.md:946-955), projection de l'extension ABC, puis étude d'évènements avec etudeEvenements (apps/web/src/data/validationSignaux.ts:187). On mesure le taux de réaction du prix à ±0,25 ATR des niveaux 1,272 et 1,618. On le compare à des ratios placebo (1,2, 1,45, 1,7) et à des niveaux décalés au hasard par décalage circulaire, selon la convention C3 (docs/axis-2026-10-07.md:232-233). Le manifeste est figé, puis testé sur des données postérieures (scripts/axis/). Sans ce test, l'outil est présenté comme une simple annotation, sans aucune statistique.

**Preuve d'intérêt (idéation).** Outils listés par TradingView (page d'aide 43000703396, vérifiée dans l'inventaire). Pas d'avantage démontré pour Elliott, les harmoniques ni les fourches : ce sont des annotations, même statut que le Fibonacci existant. Le contrôle des règles d'Elliott limite les décomptes incohérents.

**Mesure de succès.** Niveaux d'extension ABC égaux à la formule à 1e-9 ; règles d'Elliott couvertes par des tests sur des cas valides et invalides ; aller-retour de persistance sans perte ; rendu < 1 ms par overlay sur 2 000 bougies visibles ; aucun dessin perdu au changement de thème.

**Fichiers à toucher.**

- apps/web/src/chart/dessinsAvances.ts (nouveau : géométrie pure + registerOverlay)
- apps/web/src/chart/dessinsAvances.test.ts (nouveau)
- apps/web/src/chart/drawing.ts (DrawingToolId :44, TOOL_OVERLAY :69, SavedOverlay :314 si texte, createTrackedOverlay :515)
- apps/web/src/chart/fibonacci.ts (export des ratios/extensions du fibStore pour l'extension ABC)
- apps/web/src/components/DrawingToolbar.tsx (TOOLS :250, icônes, groupe « Avancé » replié)
- apps/web/src/chart/drawing.test.ts (aller-retour de persistance)

**Avis des juges.**

- valeur (3) : L'extension de Fibonacci ABC, les fourches et XABCD avec ratios en direct sont des outils de dessin standards du discrétionnaire, demandés par le propriétaire. Aucune valeur prédictive démontrée. Les règles d'Elliott restent infalsifiables.
- cout-risque (4) : Géométrie pure dans un module paresseux, sans source ni hôte, KLineChart figé respecté (registerOverlay). Coût : migration du schéma SavedOverlay pour le texte, avec une sauvegarde déjà silencieuse quand le localStorage est plein. Le vérificateur d'Elliott doit avertir sans invalider (diagonales). Périmètre complet plutôt L.
- coherence (4) : Des overlays registerOverlay et une géométrie pure, dans la continuité de chart/drawing.ts et fibonacci.ts (fibStore), sans dépendance. Réserve : le champ texte modifie SavedOverlay, d'où une migration.

### 19. SUG-C7 — Probabilité de toucher la cible avant le stop dans l'outil position : modèle à deux barrières (IV DVOL ou RV de l'actif) et fréquence empirique sur l'historique de l'actif, espérance en R affichée

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **S** (initial S) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : critique de complétude

**Question de trading.** Avec ce stop et cette cible, quelle est la probabilité réaliste de toucher la cible en premier sous h bougies, et mon R:R de 3 suppose-t-il un avantage que je n'ai pas ?

**Proposition retenue après vérification.** Sous le R:R de l'overlay position, trois éléments. (1) Seuil p* = 1/(1+RR), libellé « taux de réussite requis pour une espérance nulle avant frais ». (2) Fréquence passée sur le buffer chargé : depuis chaque bougie, stop et cible posés aux mêmes distances en multiples d'ATR, premier touché sous h bougies, où h est la largeur du dessin. Quatre comptes : cible, stop, ambigu (compté à part, avec la convention du moteur intrabar en variante prudente) et aucun. Afficher le n effectif ≈ N/h, un IC de Wilson, et la même mesure dans le sens opposé pour exposer la dérive de l'échantillon. (3) P(aucun des deux sous h) sous marche aléatoire avec σ = RV du buffer ; DVOL en option pour BTC/ETH. Pas de « probabilité modèle de toucher la cible » (égale à p* sous dérive nulle) ni d'espérance modèle (nulle par construction). Module pur chargé par import(), mémoïsé par points et buffer, moins de 5 ms par recalcul.

**Proposition initiale.** Dans l'overlay position, sous le R:R : (a) P(cible avant stop) d'un mouvement brownien du log-prix à deux barrières (dérive nulle par défaut, dérive empirique en option), σ tiré du DVOL pour BTC/ETH ou de la RV/HAR de l'actif (SUG-7 si livré) ; P(aucun des deux sous h bougies) par Monte Carlo à graine fixe (10 000 trajectoires) ; (b) fréquence empirique : pour chaque bougie passée, stop et cible posés aux mêmes distances en multiples d'ATR, premier touché sous h bougies, bougies touchant les deux comptées à part (« ambigu ») ; (c) espérance avant frais = p·RR − (1 − p) et seuil p* = 1/(1 + RR). Libellé : « référence sans avantage ; votre setup doit battre p* ».

**Ce qui existe déjà.** L'outil position ne calcule que sens, risque, gain, R:R et taille : calculerPosition (position.ts:54), taillePosition (position.ts:89), étiquette (position.ts:114). probaToucher ne gère qu'une barrière (probaImplicite.ts:121-124) et ne sert que lireProbasNiveau dans OMON (probaImplicite.ts:159). grep barri|first.?passage|premier.?touch|triple.?barri sur apps, packages et scripts : rien. Le moteur de backtest a une convention intrabar avec stop prioritaire en cas d'ambiguïté (packages/backtest/src/engine.ts:14-18), mais sortieIntrabar (engine.ts:458) n'est pas exportée. mulberry32 est exporté (monteCarlo.ts:21) et @axiom/backtest est déjà une dépendance du web (apps/web/package.json:16). Le graphe charge 500 bougies au backfill (ChartInstance.tsx:1225), plus au défilement (:1358). Aucun HAR dans le dépôt : SUG-7 n'est pas livré. Point mathématique : sous dérive nulle, P(cible avant stop) ne dépend pas de σ. Elle vaut (E−S)/(C−S) = 1/(1+RR) exactement si le prix est une martingale, et b/(a+b) en log-prix (ruine du joueur, cité de mémoire). Le point (a) ne fait donc que réafficher p*, l'espérance du modèle est nulle par construction, et σ (DVOL ou RV) ne sert qu'à P(aucun des deux sous h).

**Réutilise.** calculerPosition (position.ts:54), probaToucher (probaImplicite.ts:121), chargerDvolJour (apps/web/src/chart/niveaux/dvolJour.ts:28), realizedVolSeries (apps/web/src/lib/volCone.ts:25), mulberry32 (packages/backtest/src/monteCarlo.ts:21), ATR du registre.

**Point d'intégration.** Étiquette de l'overlay position (position.ts:114) et createPointFigures (position.ts:140), appelé à chaque redessin. Le calcul doit donc être mémoïsé par (points, longueur du buffer, timeframe). Module pur apps/web/src/data/probaBarrieres.ts chargé par import() au premier setup complet, puis redessin via redrawPositionOverlays (position.ts:247), car position.ts est dans le graphe initial (drawing.ts:37, importé par ChartGrid.tsx:34). Bougies lues dans marketStore ; σ = realizedVolSeries du buffer (volCone.ts:25), synchrone ; DVOL en option pour BTC/ETH (chargerDvolJour asynchrone, dvolJour.ts:28). Horizon h = largeur du dessin en bougies (du point 0 au point 2), sans nouveau réglage.

**Sources.**

- Deribit DVOL (BTC/ETH) et bougies des adaptateurs (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà chargés pour les bandes implicites et le graphe ; aucune requête nouvelle.

**Contrat.** Aucun fournisseur, hôte ni clé. Exception G100 légère : l'enrichissement d'un overlay existant reste une fonctionnalité de surface (BUILD-CONTRACT.md:71). Budget de chargement initial : position.ts est chargé au démarrage, donc le scan et les formules doivent être paresseux ou minuscules. Pas de Monte Carlo à 10 000 trajectoires dans le chemin de rendu (renderer-first) : le Monte Carlo reste dans les tests comme contrôle de la formule. Calcul financier, donc revue indépendante (AGENTS.md). Effort M si l'on garde le DVOL asynchrone et le Monte Carlo en direct.

**Risques.** Faux avantage : la fréquence empirique mesure la dérive de l'échantillon (BTC haussier, donc longs « gagnants ») et non la qualité du setup. Fenêtres chevauchantes : n effectif ≈ N/h, soit environ 16 essais indépendants pour 500 bougies 4h et h = 30 ; afficher n = 470 tromperait. Bougies touchant stop et cible fréquentes avec un stop serré ; une convention différente de celle du moteur de backtest (stop prioritaire) donnerait des chiffres incohérents entre outils. Gaps, frais, funding et surveillance discrète (OHLC) contre continue biaisent le modèle. Sans mémo, coût sur chaque redessin et pendant le glissé des poignées. Le libellé risque d'être lu comme une prévision.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Outil peu coûteux (S), sans source ni hôte nouveau, qui corrige une illusion réelle : un grand R:R ne crée pas d'avantage. Sa vraie valeur tient à p* = 1/(1+RR) et à la fréquence empirique de l'actif ; le modèle « IV DVOL » est surtout décoratif, car σ n'affecte que l'horizon. Réserves à lever avant livraison : (a) référence martingale du prix explicite ; (b) espérance cohérente avec la sortie au temps h ; (c) convention de touche alignée sur le backtest (clôture) ou double affichage ; (d) n effectif et IC par bloc à côté de la fréquence ; (e) libellé « référence sans avantage, pas une prévision ». Exception G100 légère (enrichissement de l'overlay position). Références littéraires citées de mémoire : budget WebSearch épuisé.

**Références.**

- Théorème d'arrêt optionnel et ruine du joueur : pour une martingale, P(cible U avant stop L) = (S−L)/(U−L), espérance en R nulle (résultat de manuel, de mémoire, non vérifié en ligne)
- Borodin et Salminen, Handbook of Brownian Motion, 2e éd. 2002 : sortie d'un intervalle à horizon fini (de mémoire, non vérifié)
- López de Prado, Advances in Financial Machine Learning, 2018, ch. 3 « triple-barrier method » (de mémoire, non vérifié)
- Kaminski et Lo, « When do stop-loss rules stop losses? », Journal of Financial Markets, 2014 : un stop n'ajoute de la valeur que si les rendements s'écartent de la marche aléatoire (de mémoire, non vérifié)
- Calcul local (python) : stop −5 %, cible +15 %, RR 3 : 25,0 % sous martingale du prix contre 26,9 % sous log-prix sans dérive ; stop −10 %, cible +30 % : 25,0 % contre 28,7 %
- apps/web/src/chart/position.ts:54-72 (calculerPosition : sens, risque, gain, ratio seulement)
- apps/web/src/data/probaImplicite.ts:120-124 (probaToucher, une barrière, OMON)
- packages/backtest/src/engine.test.ts:404-442 (le moteur évalue stop et objectif sur la CLÔTURE, jamais intrabar)
- packages/backtest/src/monteCarlo.ts:21 (mulberry32)
- apps/web/src/lib/volCone.ts:25 (realizedVolSeries)
- apps/web/src/chart/niveaux/dvolJour.ts:28 (chargerDvolJour)

**Redondance.** Faible. Aucun calcul à deux barrières dans le dépôt : le grep barri|cible avant ne trouve que probaToucher, une barrière unique dans OMON (probaImplicite.ts:120). L'overlay de position ne donne que le R:R (position.ts:54-72). Les MAE/MFE et le Monte Carlo du backtest décrivent une stratégie déjà exécutée, pas un setup avant l'entrée. Redondance interne en revanche : sous l'hypothèse de base (martingale du prix, horizon infini), la probabilité vaut exactement 1/(1+RR) = p*, quel que soit σ. Le DVOL ou la RV ne servent qu'à P(aucune barrière sous h bougies). Le « modèle » se réduit donc à p* plus une durée, et seule la fréquence empirique apporte une information propre à l'actif.

**Pièges.** (1) Le choix de la « dérive nulle » change le chiffre. Avec un log-prix sans dérive, on affiche 26,9 % au lieu de 25 % pour un RR 3 à −5/+15 %, soit un faux avantage de +0,07 R. La référence doit être la martingale du prix (espérance nulle), et l'hypothèse doit être écrite. (2) Incohérence de la proposition : l'espérance p·RR − (1−p) utilise une p à horizon infini alors qu'une sortie au temps h est prévue. Avec horizon, il faut E[R] = p_c·RR − p_s + E[R | aucune]·p_aucune. (3) Convention de touche : le scan empirique sur plus haut et plus bas contredit le moteur de backtest, qui teste sur la clôture (engine.test.ts:404-442). Deux chiffres incompatibles cohabiteraient dans le terminal : il faut aligner la convention ou l'afficher. (4) Ambiguïté intrabar : une bougie qui touche les deux barrières ne se tranche qu'avec les bougies 1m. Les compter à part est correct, mais leur part grimpe vite avec un stop serré. (5) Fenêtres chevauchantes : des milliers de « setups » très autocorrélés, donc un n effectif bien plus petit. Il faut un IC par bootstrap par blocs et afficher le n effectif plutôt que le n brut. (6) Dérive passée et biais du survivant : BTC et les alts d'une watchlist ont monté sur leur historique, donc la fréquence empirique des longs dépasse p* sans aucun avantage. Afficher long et short symétriques et leur écart. (7) Le DVOL est une volatilité implicite à 30 j avec prime de variance (IV supérieure à la RV en moyenne, de mémoire) : il surestime la probabilité de toucher sous h. Il faut aussi tenir compte des queues épaisses et du regroupement de volatilité. (8) Les chiffres sont hors frais, glissement du stop et financement. (9) Risque de lecture : un chiffre de probabilité affiché à côté d'un setup se lit comme une prévision.

**Protocole de validation.** Tests unitaires d'abord : la formule et le Monte Carlo (graine fixe) concordent à ±0,5 pt, et p = (S−L)/(U−L) à horizon infini. Validation analytique pré-déclarée et figée avant les données : 1 000 setups tirés au hasard (BTC/ETH/SOL 4h, distances en multiples d'ATR tirées dans une grille fixe, données postérieures au 2026-10-10 jamais utilisées), convention de touche identique à celle du moteur, ou les deux conventions rapportées. Mesure : score de Brier de p_modèle (avec σ) contre la référence naïve 1/(1+RR) et contre la fréquence empirique de la période d'amorce. Si le modèle avec σ ne bat pas 1/(1+RR) à horizon long, on retire le σ et on garde seulement p* plus P(aucune sous h). Courbe de calibration par décile avec IC par bloc ; part d'ambigus publiée ; résultats séparés long/short et par régime de volatilité (terciles d'ATR) en descriptif seulement. Aucune optimisation des paramètres sur la période de test.

**Preuve d'intérêt (idéation).** Probabilité de sortie à deux barrières d'un mouvement brownien : résultat classique du principe de réflexion, cité de mémoire, non vérifié en ligne. Sous marche aléatoire, p ≈ 1/(1 + RR) pour des distances log symétriques : un grand R:R ne crée pas d'avantage, ce que l'outil actuel ne montre pas.

**Mesure de succès.** Formule et Monte Carlo concordent à ±0,5 pt ; courbe de calibration sur 1 000 setups tirés au hasard (BTC/ETH/SOL 4h, données postérieures au 2026-10-10) : |p modèle − fréquence| < 5 pts par décile ; part d'« ambigus » affichée ; moins de 30 ms par recalcul en glissant les poignées.

**Fichiers à toucher.**

- apps/web/src/chart/position.ts
- apps/web/src/chart/position.test.ts
- apps/web/src/data/probaBarrieres.ts (nouveau)
- apps/web/src/data/probaBarrieres.test.ts (nouveau)

**Avis des juges.**

- valeur (3) : Garde-fou utile : p* = 1/(1+RR) et la fréquence passée avec n effectif ≈ N/h montrent qu'un R:R de 3 suppose 25 % de réussite. Mais la fréquence empirique mesure surtout la dérive de l'échantillon. Outil de discipline plutôt que d'analyse.
- cout-risque (4) : Effort S, aucune source : calcul pur paresseux, puisque position.ts est sur le chemin initial. Calcul financier, donc revue indépendante obligatoire (AGENTS.md). Risque contenu par le design : n effectif ≈ N/h, IC de Wilson, mesure dans le sens opposé pour exposer la dérive, pas de « probabilité modèle » trompeuse. L'hypothèse de martingale du prix doit être écrite.
- coherence (4) : Enrichissement de l'overlay position (chart/position.ts) par un module pur importé à la demande. Pas de Monte Carlo dans le rendu. C'est un calcul financier, donc revue indépendante (AGENTS.md).

### 20. SUG-5 — Niveaux de liquidité automatiques : zones S/R autonomes, swings non repris et égaux, balayages confirmés par liquidations, testés contre des niveaux aléatoires

**Score 13/20** · valeur 4 · coût-risque 3 · cohérence 2 · effort révisé **M** (initial L) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-4, VOL-7

**Question de trading.** Où sont les zones de réaction et les poches de stops, la mèche au-dessus du plus haut est-elle une chasse aux stops ou une cassure acceptée, et sur cet actif ces niveaux font-ils mieux que le hasard ?

**Proposition retenue après vérification.** Un seul overlay « Niveaux de liquidité » (catégorie support_resistance). (a) Zones zonesSrAxis tracées depuis confirmationIdx, avec IND-7 corrigé d'abord. (b) Swings confirmés jamais traversés, tracés en rayons, avec une option « égaux » (≤ ε·ATR). (c) Marqueur « balayage » évalué à la clôture : L est connu à i (PDH/PWH par sessionExtents, ou swing confirmé), high > L et close < L, symétrique pour les bas. Qualification « liquidations » si liqShortUsd/liqLongUsd > q90 sur 100 bougies (aux facultatives), « delta » si le delta taker est absorbé, sinon « non qualifié ». (d) Test de réaction contre 1 000 niveaux aléatoires à graine fixe (mulberry32) : fonction pure côté apps/web, lancée à la demande et hors calc, affichant n et un avertissement sous 30 contacts. Pas de second def, pas de BOS/CHoCH, ni FVG ni auto-Fibonacci.

**Proposition initiale.** (1) Overlay « zonesSr » qui expose zonesSrAxis hors stratégie, rubans tracés depuis la bougie de confirmation. (2) Swings confirmés jamais traversés en rayons, option « égaux » (≤ ε·ATR). (3) Indicateur balayageLiquidite évalué à la clôture : niveau L connu à i (PDH/PWH ou pivot confirmé), high > L et close < L, confirmé par liqShortUsd > q90 sur 100 bougies et/ou delta taker absorbé ; variante « acceptation ». (4) Test intégré à graine fixe : taux de réaction (k·ATR avant cassure sous h bougies) des zones contre 1 000 niveaux aléatoires de même distance, affiché « 58 % contre 46 %, n = 37 », avertissement sous 30 contacts. Pas de BOS/CHoCH, FVG ni auto-Fibonacci.

**Ce qui existe déjà.** Les zones S/R existent déjà sur le graphe, mais seulement à l'intérieur de la stratégie AXIS S/R. zonesSrAxis est pure (packages/indicators/src/strategy/stratAxisSr.ts:137). Elle est tracée en rubans et en segments (stratAxisSr.ts:580-615), et le réglage maxZonesSr (stratAxisSr.ts:426) laisse jusqu'à 12 zones. Ces zones arrivent toujours mêlées aux signaux d'achat et de vente. Elles partent aussi de deIdx (stratAxisSr.ts:597, 605) au lieu de la confirmation : c'est le défaut IND-7 (docs/revue-2026-11-06.md:1069). zonesSrAxis tourne sans série auxiliaire : fluxAxis(candles, undefined, ...) suffit (packages/indicators/src/strategy/stratAxis.ts:417-436). pivotHighLow ne donne que des points, sans rayon (packages/indicators/src/support_resistance/pivotHighLow.ts:32-35). Les PDH/PWH sont des lignes du moment, pas une série par bougie (apps/web/src/chart/niveaux/niveauxCles.ts:1-11, 106-108) ; il faut les recalculer avec sessionExtents. Le générateur aléatoire à graine existe déjà : mulberry32 (packages/backtest/src/monteCarlo.ts:21). Absents (grep sweep|balayage|equal|égaux, aucune occurrence pertinente) : swings non repris, niveaux égaux, balayage, test contre le hasard. Correction factuelle : le plafond Coinalyze mesuré est d'environ 2 500 points, pas 1 500-2 000 (apps/web/src/chart/auxProvider.ts:190-195).

**Réutilise.** zonesSrAxis, pivotHighLow (packages/indicators/src/support_resistance/pivotHighLow.ts:12-15), sessionExtents, canal d'annotations (packages/indicators/src/utils-annotations.ts:56), etudeEvenements (apps/web/src/data/validationSignaux.ts:187).

**Point d'intégration.** Une seule définition overlay dans packages/indicators/src/support_resistance/. Elle appelle zonesSrAxis avec fluxAxis et l'ATR rma(trueRange,14), ajoute les swings confirmés en p = i − g, et calcule PDH/PWH à chaque i avec sessionExtents. Elle déclare auxFacultatives ["liqLongUsd","liqShortUsd","perpDelta"] : sans clé Coinalyze, le def ne devient pas inutilisable (packages/types/src/index.ts:385-393). Rendu par annotations rubans, segments et marqueurs (packages/types/src/index.ts:335-356). Le test contre des niveaux aléatoires doit rester hors de calc : fonction pure dans apps/web/src/data/, à côté de etudeEvenements (apps/web/src/data/validationSignaux.ts:187), avec mulberry32 importé de @axiom/backtest, lancée à la demande.

**Sources.**

- Bougies OHLCV du graphe (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Test sur le buffer chargé.
- Coinalyze liquidation-history (déjà utilisée ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : non) : Déjà servi par le proxy ; 1 500-2 000 points intraday.

**Contrat.** Le catalogue gagne une définition (221) : il faut une nécessité démontrée (BUILD-CONTRACT.md:82) et une exception G100, car c'est une nouvelle surface de graphe (BUILD-CONTRACT.md:71). Le compteur de registry.test.ts est à mettre à jour. Le chargement initial est touché : le chunk indicators est chargé au démarrage, AXIS y coûte environ 800 o gzip (BUILD-CONTRACT.md:1743) et la marge restante est de 4 030 o gzip (BUILD-CONTRACT.md:2038-2042). Aucun nouveau fournisseur ni hôte : la clé Coinalyze est déjà injectée côté serveur (api/_policy.ts:292, 297, 309). Aucun enregistreur.

**Risques.** 1) Biais rétrospectif : les bornes des zones sont moyennées après coup (IND-7). Tracer depuis confirmationIdx est obligatoire. 2) Faux signaux et data snooping : g, ε, k, h et q90 sont autant de libertés de réglage. Il faut les figer avant l'étude sur les données postérieures au 2026-10-10. 3) Le delta taker historique n'existe que sur Binance (apps/web/src/lib/indicatorUsability.ts:16, 153) ; ailleurs, la confirmation repose sur Coinalyze ou n'existe pas. 4) Le dernier bucket Coinalyze est partiel. 5) Quota Coinalyze de 40 requêtes/min par clé (apps/web/src/data/coinalyze.ts:10, 50), partagé par tous les visiteurs du site Vercel. 6) Coût CPU : 1 000 niveaux × contacts × h à chaque tick si le test reste dans calc. 7) Les références Osler et Urquhart, et les CGU Coinalyze pour un affichage public, sont non vérifiées ici : le budget WebSearch était épuisé.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La pièce la plus utile est le test contre des niveaux aléatoires. Il corrigerait le chiffre interne « environ 81 % des zones tiennent », publié sans référence de hasard (docs/axis-2026-10-07.md:986-990). Le balayage relève du vocabulaire SMC. Sa littérature crypto est mince, non vérifiée en ligne ici. Sa confirmation par liquidations dépend d'une seule place et d'un historique court. L'effort L est sous-estimé si l'on compte l'appariement du hasard et le manifeste. Découpage conseillé : lot 1 = IND-7 + testReactionNiveaux + overlay zonesSr ; lot 2, seulement si le verdict est favorable = swings non repris et égaux + balayageLiquidite.

**Références.**

- Osler C. (2000), « Support for Resistance: Technical Analysis and Intraday Exchange Rates », FRBNY Economic Policy Review 6(2). Les S/R publiés par des firmes prédisent mieux les interruptions de tendance intrajournalières que des niveaux arbitraires ; l'effet est modeste et mesuré sur le change, pas sur la crypto. NON VÉRIFIÉ en ligne dans cette passe : budget WebSearch du tour épuisé, www.newyorkfed.org bloqué par le réseau de la session.
- Osler C. (2003), « Currency Orders and Exchange Rate Dynamics: An Explanation for the Predictive Success of Technical Analysis », Journal of Finance 58(5) : take-profit regroupés aux nombres ronds, stop-loss juste au-delà. NON VÉRIFIÉ. De mémoire, le Staff Report NY Fed n° 150 est un autre texte, « Stop-Loss Orders and Price Cascades in Currency Markets » (paru dans JIMF en 2005). La citation de l'idée mélange probablement les deux (à vérifier).
- Urquhart A. (2017), « Price clustering in Bitcoin », Economics Letters : regroupement des prix sur les nombres ronds. NON VÉRIFIÉ en ligne.
- Chung & Bellotti (2021), « Evidence and Behaviour of Support and Resistance Levels in Financial Time Series », arXiv 2101.07410 : à lire avant de figer la définition de la réaction. NON VÉRIFIÉ, arxiv.org bloqué.
- Interne : docs/axis-2026-10-07.md:986-990 indique que les zones tiennent 6 bougies dans environ 81 % des tests. Ce chiffre vient de données déjà vues, SANS référence aléatoire.
- Interne : docs/revue-2026-11-06.md:1069-1076 (IND-7) : les rubans partent du pivot, avec les bornes et la polarité finales (stratAxisSr.ts:585-605).
- Interne : docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11. FVG et BOS/CHoCH y sont écartés sur preuve.
- Interne : apps/web/src/data/coinalyze.ts:11-17 et :170. Liquidations du seul perp Binance (_PERP.A), agrégées et échantillonnées, historique intraday d'environ 1 500 à 2 000 points.

**Redondance.** Partielle. (1) AXIS S/R trace déjà les zones en rubans d'annotations (docs/axis-2026-10-07.md:969-976). Il les expose aussi en séries support/resistance pour les alertes, BT et le screener (docs/axis-2026-10-07.md:977-980). L'overlay zonesSr n'apporte donc que l'affichage sans les signaux de stratégie. pivotHighLow (packages/indicators/src/support_resistance/pivotHighLow.ts:23) et zigzag donnent les swings, mais pas leur statut « jamais repris ». PDH/PWH existent déjà dans le composite de niveaux (apps/web/src/chart/niveaux/composite.ts:24-29, niveauxCles.ts). liqParBougie affiche déjà le flux forcé brut (packages/indicators/src/derivatives/liqParBougie.ts:16-21). Sont réellement neufs : les swings non repris et égaux, le détecteur de balayage, et surtout le test contre des niveaux aléatoires. Aucun équivalent n'existe : grep sweep|balayage|equal.?high ne renvoie que des faux positifs (zigzag, playbooks, workspaces).

**Pièges.** Rétrodatage visuel : tant qu'IND-7 n'est pas corrigé, tout contrôle à l'œil est biaisé. Le test doit compter les contacts après confirmationIdx et avec les bornes connues à cet instant, pas les bornes finales fusionnées. Look-ahead : le statut « jamais traversé » se juge à i. La variante « acceptation » attend j bougies et doit donc être datée à i+j. Liquidations : une seule place, Binance USDⓈ-M via Coinalyze (coinalyze.ts:11-13, :170). Le flux forceOrder est échantillonné (coinalyze.ts:16-17), il sous-estime les volumes et rend le seuil q90 instable. L'historique intraday d'environ 1 500 à 2 000 points couvre environ 2 mois en 1h et 8 à 11 mois en 4h : la variante confirmée par liquidations ne peut pas être étudiée sur 2 ans. Sans clé, la confirmation repose sur le seul delta taker : ce sont deux détecteurs différents sous un même nom. Niveaux aléatoires : apparier sur la seule distance désavantage le hasard. Il faut aussi apparier la date de naissance, l'ATR à l'instant et la proximité du prix à la naissance, car un pivot naît toujours près du prix. Les contacts sont autocorrélés (zones fusionnées, retouches) : il faut un bootstrap par zone ou par blocs, pas par contact. Avec n = 37, l'IC fait environ ±16 points, et 58 % contre 46 % n'est pas distinguable. Les paramètres sont nombreux (g, zoneSrAtr, k, h, ε, q90, fenêtre 100). Un test lancé à la demande sur chaque actif × UT est un test multiple. Les nombres ronds (Urquhart) doivent être contrôlés dans le tirage aléatoire. Enfin, le concept vient du vocabulaire SMC, proche des FVG et BOS écartés sur preuve.

**Protocole de validation.** Ordre de livraison : d'abord IND-7 et la fonction pure testReactionNiveaux, le reste ensuite. (a) Pré-enregistrer un manifeste JSON au format de scripts/axis/manifeste-*.json. Il fixe la définition du contact, k, h, g, ε, l'appariement des niveaux aléatoires (distance, âge, ATR, nombres ronds), la métrique (taux de réaction des zones moins celui du hasard) et les seuils de verdict. (b) Explorer sur les 8 majors en 4h avant le 2026-10-10, puis geler par commit. Faire un test unique après la date de gel et sur des paires non explorées. Critères : écart > 0 dans chaque moitié et IC bootstrap par blocs qui exclut 0. (c) Balayages : event study avec etudeEvenements (apps/web/src/data/validationSignaux.ts:187), en direction baissière après un balayage de plus haut, aux horizons 6 et 18 bougies 4h. Référence : les mêmes franchissements sans clôture de rejet (« acceptation »). Juger la variante liquidations uniquement sur des données accumulées en prospectif, au moins 6 mois. (d) Contrôle par préfixe sur les trois fonctions : le calcul sur candles[0..i] doit égaler le calcul complet à i. En cas d'échec : garder zonesSr comme tracé descriptif et ne pas livrer balayageLiquidite.

**Preuve d'intérêt (idéation).** Osler (FRBNY EPR 2000) : les S/R publiés prédisent mieux les interruptions de tendance que 10 000 jeux arbitraires ; Osler (JF 2003, rapport NY Fed n° 150) : stops regroupés au-delà des niveaux, cascades auto-entretenues. Urquhart (Econ. Letters 2017) : regroupement BTC sur nombres ronds sans rendement prévisible, d'où le test intégré.

**Mesure de succès.** Écart zones/hasard avec IC bootstrap reproductible ; étude figée sur données postérieures au 2026-10-10 : écart positif dans les deux moitiés ; balayages confirmés moins non confirmés > 0 dans ≥ 3 cellules 4h sur 4 ; contrôle par préfixe sans écart.

**Fichiers à toucher.**

- packages/indicators/src/support_resistance/niveauxLiquidite.ts
- packages/indicators/src/support_resistance/niveauxLiquidite.test.ts
- packages/indicators/src/registry.ts
- packages/indicators/src/registry.test.ts
- packages/indicators/src/strategy/stratAxisSr.ts (prérequis IND-7, hors périmètre de cette idée)
- apps/web/src/data/reactionNiveaux.ts
- apps/web/src/data/reactionNiveaux.test.ts
- apps/web/src/components/indicateurAlias.ts
- BUILD-CONTRACT.md
- README.md

**Avis des juges.**

- valeur (4) : La paire balayage de liquidité et liquidations éclaire une décision courante (chasse aux stops ou cassure acceptée ?), et les aux liquidations existent déjà. La vraie nouveauté est le test contre 1 000 niveaux aléatoires : il dit si les niveaux font mieux que le hasard sur cet actif. Les zonesSrAxis existent (packages/indicators/src/strategy/stratAxisSr.ts:137), mais IND-7 est à corriger d'abord (docs/revue-2026-11-06.md:1069). Beaucoup de paramètres libres sont à figer.
- cout-risque (3) : Aucune source nouvelle : Coinalyze liquidations en aux facultatif, quota partagé de 40/min. Mais catalogue +1 dans le chunk initial (marge d'environ 4 ko), et correctif IND-7 préalable sinon les zones sont rétrodatées. Beaucoup de paramètres libres (g, ε, k, q90). Le test contre 1 000 niveaux aléatoires réduit le risque de lecture trompeuse.
- coherence (2) : Quatre fonctions dans un 221e def : zones, swings, balayages qualifiés par liquidations, et un test contre niveaux aléatoires côté apps/web. L'idée dépend du correctif IND-7 de zonesSrAxis (stratAxisSr.ts) et pèse sur le chunk initial. Trop chargé pour un seul lot.

### 21. SUG-8 — Saisonnalité intrajournalière de la volatilité et du volume, timing des extrêmes hebdomadaires, et RVOL « au moment » sur toutes les unités intrajournalières

**Score 13/20** · valeur 3 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-7, VOL-8

**Question de trading.** À quelle heure et quel jour l'actif bouge-t-il vraiment, quand se forme d'habitude le plus haut ou le plus bas de la semaine, et la journée en cours a-t-elle déjà plus de volume que d'habitude à cette heure ?

**Proposition retenue après vérification.** (1) SEAG : modes « amplitude » (|r| et (H−L)/ATR), « volume relatif » par heure, par jour et en matrice 7×24, et « timing des extrêmes » (jour et heure du plus haut et du plus bas hebdomadaires et quotidiens, probabilité cumulée « extrême déjà inscrit »). Historique 1h paginé jusqu'à environ 2 ans avec cache de session, n par cellule, IC bootstrap, mise en avant seulement si la stabilité entre moitiés est ≥ 0,5. (2) RVOL au moment : mode « cumulé depuis 00:00 UTC / lundi » ajouté à rvolSeasonal, sans nouveau def, ouvert de 5m à 4h après accord du propriétaire sur l'élargissement de la restriction H1. N est plafonné par la profondeur chargeable, et la mesure de succès compare à une référence naïve, pas au RVOL journalier final.

**Proposition initiale.** (1) SEAG : modes « amplitude » (|r| ou (H−L)/ATR) et « volume relatif » par heure, par jour et en matrice 7×24 ; mode « timing des extrêmes » (jour/heure du plus haut et du plus bas hebdomadaires et quotidiens, probabilité cumulée « extrême déjà inscrit »). n par cellule, IC bootstrap, indice de stabilité entre moitiés (profil mis en avant seulement si r ≥ 0,5). (2) Indicateur rvolAuMoment : volume cumulé depuis l'ancre jour/semaine UTC / médiane des cumuls au même décalage sur N périodes antérieures, de 5m à 4h, bougie en formation marquée provisoire.

**Ce qui existe déjà.** SEAG ne mesure que les rendements close-à-close, en modes mois, jour et heure (apps/web/src/lib/seasonality.ts:3, 18-24, 42-72). Le mode horaire ne charge que 3 pages 1h, soit environ 125 jours (apps/web/src/components/SeasonalityWindow.tsx:69-80). rvolSeasonal propose déjà « heure UTC » et « jour + heure UTC », non cumulés, sur des créneaux strictement antérieurs (packages/indicators/src/volume/rvolSeasonal.ts:1-40). Il est restreint au 1h (packages/indicators/src/timeframes.ts:8-11), par décision du contrat commune au graphe, aux alertes et au backtest (BUILD-CONTRACT.md:98-99, 1101). relativeVolume n'est pas saisonnier (packages/indicators/src/volume/relativeVolume.ts:1-30). Absents : amplitude ou volume par heure, matrice 7×24, timing des extrêmes, cumul « au moment ».

**Réutilise.** bucketFor/bucketReturns généralisés (apps/web/src/lib/seasonality.ts:18-70), créneaux strictement antérieurs de rvolSeasonal, utils-session.

**Point d'intégration.** SEAG : fonctions pures ajoutées à seasonality.ts (bucketFor généralisé, amplitude, volume relatif, matrice 7×24, timing des extrêmes, IC bootstrap, stabilité entre moitiés), nouveaux onglets dans SeasonalityWindow, 1h paginé jusqu'à environ 18 pages avec cache de session. RVOL au moment : un mode « cumulé depuis l'ancre UTC » dans rvolSeasonal plutôt qu'un nouveau def. La clé de créneau vaut time − début du jour ou de la semaine UTC, sans inférer l'unité de temps. TIMEFRAME_REQUIS passe à un ensemble intrajournalier ; il faut adapter ses lecteurs, qui indexent une valeur unique : apps/web/src/lib/indicatorUsability.ts:146-164, apps/web/src/components/AlertsPanel.tsx:620-621, apps/web/src/components/BacktestWindow.tsx:153, packages/backtest/src/engine.ts:678-679, apps/web/src/store/backtest.ts:188.

**Sources.**

- Bougies 1h et intrajournalières des adaptateurs (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : ~2 ans de 1h ≈ 18 requêtes Binance, à la demande avec cache de session.

**Contrat.** Nouveaux modes de SEAG : exception G100 légère (BUILD-CONTRACT.md:71). En faisant un mode de rvolSeasonal, le catalogue ne grossit pas (BUILD-CONTRACT.md:82). En revanche, élargir l'unité « H1 » touche une décision explicite du contrat (BUILD-CONTRACT.md:98-99, 1101) et demande l'accord du propriétaire. Aucun fournisseur nouveau, aucune clé. Chargement initial quasi neutre : SEAG est paresseuse, la modification de rvolSeasonal pèse quelques centaines d'octets.

**Risques.** 1) Profondeur : le graphe charge au plus 500 bougies plus 8 pages de 500 (apps/web/src/chart/ChartInstance.tsx:186-190, 307), soit environ 4 500 bougies. En 5m, cela fait environ 15 jours de références : N doit être plafonné selon l'unité de temps. 2) La mesure de succès « corrélation entre le RVOL à 12:00 et le RVOL journalier final » est quasi tautologique, puisque le cumul de 12 h fait partie du total. Comparer plutôt à une référence naïve (RVOL de la veille ou relativeVolume) sur le volume du reste de la journée. 3) L'heure d'été déplace les ouvertures US et UE d'une heure en UTC et brouille les profils horaires. 4) 168 cellules : faux positifs multiples, d'où IC et stabilité exigés. 5) La bougie en formation doit rester marquée provisoire. 6) Environ 18 requêtes 1h par actif sur Binance, bien plus sur les sources à pages courtes (Coinbase, non vérifié pour ce cas). 7) Références Eross et al., Caporale & Plastun, et page TradingView 43000705489 non revérifiées ici (budget WebSearch épuisé).

**Intérêt analytique.** fort ; verdict utile_avec_reserve. La saisonnalité de l'amplitude et du volume est un des faits les mieux établis : profil de volatilité en U dans la journée, documenté en tradfi et en crypto (références non revérifiées en ligne ici). Elle aide à choisir l'heure d'exécution et à juger si un volume est anormal pour l'heure. C'est un meilleur usage de SEAG que les rendements. Le RVOL cumulé généralise proprement rvolSeasonal. Réserve majeure : retirer le mode « timing des extrêmes », ou le soumettre à la nulle de l'arcsinus, faute de quoi il montre un motif qui existe même dans du bruit. Effort M réaliste.

**Références.**

- Andersen T., Bollerslev T. (1997), « Intraday periodicity and volatility persistence in financial markets », Journal of Empirical Finance 4 : la périodicité intrajournalière de la volatilité est un fait stylisé. Non revérifié en ligne dans cette passe (budget WebSearch épuisé).
- Eross A., McGroarty F., Urquhart A., Wolfe S. (2019), « The intraday dynamics of bitcoin », Research in International Business and Finance 49. NON VÉRIFIÉ en ligne.
- Baur D., Cahill D., Godfrey K., Liu Z. (2019), « Bitcoin time-of-day, day-of-week and month-of-year effects in returns and trading volume », Finance Research Letters. De mémoire, des effets nets sur le volume et la volatilité, pas sur les rendements. NON VÉRIFIÉ.
- Caporale G.M., Plastun A. (2019), « The day of the week effect in the cryptocurrency market », Finance Research Letters. NON VÉRIFIÉ en ligne.
- Loi de l'arcsinus de Lévy : la date du maximum ou du minimum d'une marche aléatoire sur une fenêtre a une densité en U. C'est un résultat mathématique classique, et il sert de nulle obligatoire pour le mode « timing des extrêmes ».
- TradingView « Relative Volume at Time » (page d'aide 43000705489) : donné comme vérifié par l'idée brute, NON revérifié ici.
- Interne : apps/web/src/lib/seasonality.ts:18-70 (rendements seulement) ; apps/web/src/components/SeasonalityWindow.tsx:69-80 (3 × 1 000 bougies 1h, environ 125 j) ; packages/indicators/src/volume/rvolSeasonal.ts:1-45 ; packages/indicators/src/timeframes.ts:8-17 ; packages/alerts/src/engine.ts:107.

**Redondance.** Faible à moyenne. rvolSeasonal calcule déjà le RVOL par créneau UTC sur des références strictement antérieures, mais sans cumul et en 1h seulement (packages/indicators/src/volume/rvolSeasonal.ts:1-45, timeframes.ts:8-11). relativeVolume et volumeZScore ne sont pas saisonniers. SEAG ne mesure que les rendements (seasonality.ts:42-72), la dimension la moins prévisible. Sont neufs : l'amplitude et le volume par heure × jour, et le RVOL cumulé au même décalage. Le mode « timing des extrêmes » n'existe nulle part.

**Pièges.** Timing des extrêmes : sous une marche aléatoire, l'instant du plus haut et du plus bas d'une fenêtre suit la loi de l'arcsinus, concentrée au début et à la fin. Un profil « le plus bas de la semaine se forme lundi ou dimanche » est donc attendu sans aucune structure. Sans nulle simulée, ce mode est trompeur. De plus, l'ancre du lundi 00:00 UTC est arbitraire pour un marché 24/7. La probabilité « extrême déjà inscrit » ne doit être conditionnée que sur l'information disponible à l'heure h. Dérive de régime : sur 2 ans, le profil horaire change (horaires US/Asie, ETF spot US depuis 2024, heure d'été qui décale les heures UTC deux fois par an). L'indice de stabilité entre moitiés est le bon garde-fou. Volume d'une seule place (Binance) : les campagnes à frais nuls ou le wash trading créent des ruptures (de mémoire, non vérifié). Tests multiples : sur 168 cellules, des IC bootstrap sans correction produisent des faux positifs. Pour le RVOL au moment, les trous de données sous-estiment les cumuls : exclure les jours incomplets. La bougie en formation reste marquée provisoire, comme prévu. Contrat : passer d'une égalité à une liste d'unités touche les alertes et le BT (packages/alerts/src/engine.ts:107).

**Protocole de validation.** (a) Contrôles : une série synthétique à volatilité uniforme doit donner un profil plat ; non-régression avec rvolSeasonal à 1e-9 en mode non cumulé. (b) Profils : estimer sur la moitié 1, puis mesurer la corrélation de rang des 24 ou 168 cellules avec la moitié 2 (r ≥ 0,5). Refaire la mesure sur des données postérieures au gel. (c) RVOL au moment : corrélation de rang avec le RVOL journalier final, comme prévu. Comparer aussi à la référence naïve, volume cumulé / (médiane du volume journalier × fraction de journée écoulée). Si l'apport sur la naïve est nul, simplifier. (d) Timing des extrêmes : comparer à une nulle simulée par 10 000 permutations des rendements horaires au sein de chaque semaine, à graine fixe. N'afficher un écart que s'il sort de l'IC à 95 % dans les deux moitiés. (e) Aucun usage comme filtre AXIS sans v6 figée puis testée.

**Preuve d'intérêt (idéation).** Eross, McGroarty, Urquhart, Wolfe (RIBAF 2019) : volume, spread et volatilité BTC suivent les heures d'ouverture des grandes places. Caporale & Plastun (FRL 2019) : effet lundi faible. TradingView fournit « Relative Volume at Time » (page d'aide 43000705489, vérifié dans l'idée brute).

**Mesure de succès.** Profil plat sur série à volatilité uniforme ; corrélation de rang ≥ 0,7 entre RVOL au moment à 12:00 UTC et RVOL journalier final sur 2 ans BTC/ETH/SOL ; non-régression avec rvolSeasonal à 1e-9 en mode non cumulé.

**Fichiers à toucher.**

- apps/web/src/lib/seasonality.ts
- apps/web/src/lib/seasonality.test.ts
- apps/web/src/components/SeasonalityWindow.tsx
- packages/indicators/src/volume/rvolSeasonal.ts
- packages/indicators/src/volume/rvolSeasonal.test.ts
- packages/indicators/src/timeframes.ts
- apps/web/src/lib/indicatorUsability.ts
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/components/BacktestWindow.tsx
- packages/backtest/src/engine.ts
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (3) : La saisonnalité intrajournalière de l'amplitude et du volume est robuste et utile pour choisir l'heure d'entrée. Elle compte moins pour le sens du swing. Le « timing des extrêmes » est piégé par la loi de l'arcsinus : sans nul simulé, il ne vaut rien. Le RVOL cumulé est un ajout léger à rvolSeasonal (packages/indicators/src/volume/rvolSeasonal.ts:9-20).
- cout-risque (3) : Pas de source nouvelle, mais 2 ans de 1h, soit environ 17 500 bougies et environ 18 à 35 pages par symbole. Toucher la restriction H1 demande une décision du propriétaire (BUILD-CONTRACT.md:98-99). Le mode « timing des extrêmes » est très trompeur sans nulle simulée (loi de l'arcsinus). Le RVOL cumulé reste bon marché.
- coherence (4) : Place naturelle : nouveaux modes de SEAG, qui calcule déjà des seaux horaires et par jour (SeasonalityWindow.tsx:65-69, 151-167), et mode de rvolSeasonal sans def. Réserve : élargir la restriction 1h (timeframes.ts:8-11, BUILD-CONTRACT.md:98-99) revient sur une décision écrite.

### 22. SUG-18 — Coût du portage : funding cumulé réalisé sur 7/30 j, basis daté à maturité constante 90 j sur plusieurs années, écart funding − basis, et lecture « short de portage » du COT CME

**Score 13/20** · valeur 3 · coût-risque 3 · cohérence 4 · effort révisé **L** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : dérivés · origines : DER-7, DER-8, FLX-3

**Question de trading.** Combien les longs ont-ils déjà payé pour tenir, le portage est-il historiquement extrême, et les shorts CME des fonds à levier sont-ils un pari baissier ou la jambe courte d'un basis trade ?

**Proposition retenue après vérification.** Lot 1 : cumul de funding RÉALISÉ exact (somme des règlements) sur 7 et 30 j par place, en colonne de FUNDX, avec percentile sur la profondeur effectivement servie par chaque place et annoncée. Pas d'indicateur graphique, ou un indicateur limité au 1h. Lot 2 : basis COIN-M BTC/ETH à maturité constante 90 j sur plusieurs années, via continuousKlines CURRENT/NEXT_QUARTER et indexPriceKlines, en aux redaté à la clôture et indicateur unique, avec l'écart funding APR − basis 90 j en sortie secondaire. La lecture COT « short de portage » est retirée ; au mieux, un lot ultérieur superpose le prix dans GraphiqueCot.

**Proposition initiale.** (1) Indicateur fundingCumule sur binanceFundingHourly ou hlFunding (cadence observée) : sommes 168 h et 720 h en % et APR, percentile 1 an, persistance du signe ; colonne « réalisé 7 j/30 j » par place dans FUNDX. (2) Basis 90 j continu depuis dapi/v1/continuousKlines (CURRENT/NEXT_QUARTER, ≤ 200 j et 1 500 bougies par requête) et indexPriceKlines, interpolé par portageMaturiteConstante ; aux et indicateur basis 90 j, écart APR funding − basis 90 j. (3) COT TFF BTC/ETH CME projeté sur le graphe, daté à la publication du vendredi, COT Index 156 semaines ; étiquette « short de portage probable » quand les shorts des fonds à levier montent avec un portage excédentaire positif.

**Ce qui existe déjà.** FUNDX trace déjà l'historique par place sur 7/30/90 j, en taux horaire normalisé sur les règlements réels, sans aucun cumul (apps/web/src/components/FundingHistory.tsx:44-60 ; apps/web/src/data/fundingHistory.ts:22 MAX_DAYS=90, :83-99). CarryPanel ne fait qu'une projection : son horizon 1/7/30 j porte sur un funding futur supposé (apps/web/src/components/fundx/CarryPanel.tsx:72). Les aux fundingHist* par place existent (auxProvider.ts:605-612). quarterlyBasis couvre seulement le front, sur la vie du contrat (apps/web/src/data/binanceDapi.ts:325-343). La maturité constante existe seulement en instantané (apps/web/src/data/portageExcedentaire.ts:143). TERM garde des instantanés J-1/J-7 (apps/web/src/components/TermStructureWindow.tsx:70, :103-130). Le COT a déjà un graphique sur tout l'historique, sans le prix (apps/web/src/components/cot/GraphiqueCot.tsx), ainsi que cotIndex (apps/web/src/data/cot.ts:364). prochainePublicationCot se trouve dans data/cotHistorique.ts:474, et non dans store/ (citation erronée). grep continuousKlines : rien.

**Réutilise.** annualiserFunding, archives funding BTC/ETH (apps/web/src/data/backtestFunding.ts:19), annualiserBasis et chargerContrats (binanceDapi.ts:187, :243), portageMaturiteConstante, store cotHistorique et prochainePublicationCot (apps/web/src/store/cotHistorique.ts:474).

**Point d'intégration.** (1) Un indicateur graphique qui somme l'aux aligné serait faux. alignerFundingBinance donne à chaque bougie UN taux horaire à sa clôture (auxProvider.ts:268-285), si bien qu'en 4h ou 1d, Σ taux × durée n'est pas la somme des règlements. Le cumul exact se calcule donc dans la couche données, à partir des points {value, validUntil} de fundingHistory, puis s'affiche en colonne « réalisé 7 j/30 j » par place dans FUNDX. Pour un percentile 1 an, il faut porter MAX_DAYS à 365 et relever les plafonds de pagination : HL est limité à 8×500 h ≈ 166 j (fundingHistory.ts:151), Bybit à 12×200 (:126-127). La profondeur de l'historique OKX n'est pas vérifiée. (2) dapi.binance.com/continuousKlines passe déjà par le proxy générique (shared/extapi-hosts.ts:32 ; extapiCheminAutorise renvoie true) : aucune modification de la liste blanche. La fonction va dans binanceDapi.ts et réutilise annualiserBasis, plus une interpolation à 90 j CURRENT/NEXT. Sous 7 j d'échéance, on prend NEXT seul (JOURS_MIN_PORTAGE, portageExcedentaire.ts). Le nouvel aux doit être redaté ou aligné sur la clôture (défaut d'alignAux à l'ouverture, docs/revue-2026-11-06.md:891). (3) COT sur le graphe : le lookback aux de 90 j donne environ 13 points hebdomadaires, donc le COT Index 156 semaines doit être précalculé. Le plus simple est de superposer le prix BTC hebdomadaire dans GraphiqueCot.

**Sources.**

- Binance COIN-M dapi/v1/continuousKlines (nouvelle ; gratuit sans clé (hôte dapi déjà utilisé) ; vérifiée en ligne par l'idéation : oui) : Paramètres vérifiés sur la page développeurs ; profondeur historique non vérifiée ; contrats expirés non servis en REST (forum Binance).
- CFTC TFF Futures Only (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà utilisé ; taille de contrat de 5 BTC citée de mémoire, non revérifiée.

**Contrat.** Exception G100 nécessaire (colonne FUNDX, indicateur, superposition COT). Catalogue : +1 si fundingCumule reste hors graphe (BUILD-CONTRACT.md:82). AuxSeriesId : +1 à +3, écart à signaler (:81). Aucun nouveau fournisseur : dapi, fapi, Bybit, OKX, HL et CFTC sont déjà utilisés. Aucune clé. Le basis et le COT ne concernent que BTC et ETH. L'impact budget est limité au chunk indicators (marge gzip ~4 Ko, BUILD-CONTRACT.md:2124) ; FUNDX et COT sont des chunks paresseux.

**Risques.** La série continue roule à des dates non garanties : il faut vérifier la règle d'échéance des contrats passés (dernier vendredi, 08:00 UTC) contre les deliveryDate réels, sinon des sauts d'annualisation apparaissent. Près de l'échéance, le basis annualisé explose. La profondeur de continuousKlines COIN-M n'est pas vérifiée (recherche web épuisée dans cette passe). Les changements de cadence de funding (8h → 4h/1h) sont gérés par la normalisation, mais créent des trous. L'étiquette « short de portage probable » est une inférence non mesurée : risque de fausse lecture. Le COT est décalé de 3 j. Trois sous-chantiers couplés font gonfler l'effort.

**Intérêt analytique.** fort ; verdict utile_avec_reserve. Le cœur utile est la partie (2) : historique multi-années du carry à maturité constante, sans nouvel hôte (dapi.binance.com déjà utilisé). C'est la mesure la mieux documentée des quatre idées. La partie (1) est commode (coût réalisé) mais n'apporte presque aucune information nouvelle. L'écart funding − basis et l'étiquette COT « short de portage » sont à abandonner : double comptage d'un côté, inférence non vérifiable de l'autre. La superposition du COT au prix peut rester descriptive. Correction de chemin : prochainePublicationCot se trouve dans apps/web/src/data/cotHistorique.ts:474. Références externes non revérifiées dans cette session : quota WebSearch épuisé, bis.org inaccessible.

**Références.**

- Schmeling, Schrimpf, Todorov, « Crypto carry », BIS Working Paper 1087 (2023) : carry élevé lié à la demande de levier, prédit les krachs. Vérifié selon l'idée, non revérifié ici (www.bis.org inaccessible)
- Coin Metrics, funding cumulé comme mesure standard : vérifié selon l'idée, non revérifié ici
- He, Manela, Ross, von Wachter, « Fundamentals of Perpetual Futures » (arXiv 2212.06888) : non vérifié dans cette session
- Christin, Routledge, Soska, Zetlin-Jones, « The Crypto Carry Trade » : non vérifié dans cette session
- docs/research/02-indicateurs-edge-crypto.md:136-147 (funding, extrêmes persistants :146) et :149-159 (basis très corrélé au funding, ne pas double-compter :158)
- apps/web/src/data/binanceDapi.ts:325-343 (basis du seul contrat front, ~90 j)
- apps/web/src/data/portageExcedentaire.ts:17-18 (échéances < 7 j exclues) et :143 (maturité constante instantanée)
- apps/web/src/data/cot.ts:206-211 (TFF Leveraged Funds / Asset Manager déjà lus) et :364 (cotIndex 156 sem.)
- apps/web/src/data/cotHistorique.ts:474 (prochainePublicationCot ; l'idée cite à tort store/)
- apps/web/src/data/regime.ts:64 (percentile funding 90 j déjà dans le régime)

**Redondance.** (1) Le funding cumulé sur 7/30 j correspond à la moyenne de fundingApr sur la fenêtre, à une constante près. L'information directionnelle nouvelle est faible, car fundingApr, fundingZScore, fundingNotional, la colonne APR de FUNDX et le percentile 90 j du régime existent déjà. L'apport réel est une lecture de coût réalisé, utile pour un swing. (2) Le basis 90 j continu sur plusieurs années est absent : il n'y a ni continuousKlines ni historique multi-années, et la maturité constante n'existe qu'en instantané dans TERM. C'est le vrai manque. (3) L'écart funding − basis 90 j double-compte deux séries très corrélées (doc 02:158). (4) Le COT TFF et son COT Index existent déjà dans la fenêtre COT ; seules la superposition au prix et l'étiquette sont nouvelles.

**Pièges.** (1) Funding : sommer les règlements réels, pas taux × nombre, car l'intervalle change selon le symbole et la période (8 h, 4 h, 1 h ; horaire chez Hyperliquid). N'inclure que les règlements passés, jamais le funding prédit (look-ahead). Une seule place, à étiqueter. (2) Basis continu : continuousKlines ne donne pas la deliveryDate de chaque bougie, il faut la reconstruire (dernier vendredi du trimestre à 08:00 UTC, règle à vérifier contre les deliveryDate réels). Bougies parasites autour des rolls. Juste après un roll, CURRENT_QUARTER est à ~91 j, donc au-dessus de la cible : l'encadrement de 90 j exige le nœud perp/spot ou une extrapolation. Bruit d'annualisation sous 7 j (à exclure comme portageExcedentaire.ts:17-18). Contrat inverse COIN-M. Date de début de cotation COIN-M non vérifiée. Contrats expirés non servis en REST selon l'idée. (3) COT : rapport du mardi publié le vendredi, donc 3 j de décalage. L'étiquette « short de portage probable » est une inférence invérifiable sans le basis CME (données payantes). Le basis Binance n'est qu'un substitut, avec risque d'étiquette fausse affichée comme un fait. (4) Percentile 1 an : régime-dépendant, et les années 2020-2021 de carry à 40-60 % écrasent l'échelle.

**Protocole de validation.** Contrôles techniques d'abord : cumul égal à la somme des règlements à 1e-9 ; basis continu à moins de 0,5 pt de TERM aux dates communes ; saut < 1 pt/an aux rolls, vérifié contre les deliveryDate d'exchangeInfo quand elles sont disponibles. Puis étude d'évènements au manifeste figé (modèle valider-axis-flux.ts). Hypothèse : un percentile du basis 90 j > 95 est suivi d'un drawdown maximal à 7 et 30 j supérieur à la distribution inconditionnelle. Évènements dégroupés, nulle par décalages circulaires, bootstrap par blocs. Développement sur BTC 2020-2023, test unique sur BTC 2024-2026 puis ETH. Mesurer l'apport en plus du percentile de funding (regime.ts:64) pour éviter le double comptage. Pour le COT : purement descriptif (corrélation hebdomadaire entre Δ shorts des Leveraged Funds et basis), sans verdict ni signal.

**Preuve d'intérêt (idéation).** BIS WP 1087 « Crypto carry » (Schmeling, Schrimpf, Todorov) : carry de 40-60 %/an porté par la demande de levier, un carry élevé prédit des krachs (vérifié). Funding cumulé = mesure standard de Coin Metrics (vérifié).

**Mesure de succès.** Cumul = somme des règlements à 1e-9 ; basis continu ≥ 3 ans BTC/ETH, saut < 1 pt/an aux rolls, écart ≤ 0,5 pt avec TERM ; event study percentile > 95/90 : drawdown à 7 et 30 j.

**Fichiers à toucher.**

- apps/web/src/data/fundingHistory.ts (cumul exact, profondeur)
- apps/web/src/components/FundingHistory.tsx (colonne réalisé 7/30 j)
- apps/web/src/data/binanceDapi.ts (continuousKlines, basis 90 j)
- packages/types/src/index.ts (AuxSeriesId basisCm90)
- apps/web/src/chart/auxProvider.ts
- packages/indicators/src/derivatives/basis90j.ts (+ test)
- (option, lot séparé) apps/web/src/components/cot/GraphiqueCot.tsx

**Avis des juges.**

- valeur (3) : Le funding est déjà bien couvert (fundingRate, fundingZScore, fundingApr, fundingNotional). Le cumul sur 7/30 j n'est qu'une transformation. Le basis à 90 j de maturité constante sur plusieurs années corrige les sauts du quarterlyBasis front (packages/indicators/src/derivatives/quarterlyBasis.ts:9-11) et donne un vrai contexte de surchauffe du portage pour BTC et ETH. La profondeur de continuousKlines n'est pas vérifiée.
- cout-risque (3) : Aucun fournisseur ni clé : dapi est déjà autorisé. Le lot 1, cumul de funding réalisé, est sûr et bon marché. Le lot 2 est coûteux (effort L) : règle de roulement à valider contre les deliveryDate, explosion du basis annualisé près de l'échéance, profondeur de continuousKlines COIN-M non vérifiée. AuxSeriesId +1 à +3.
- coherence (4) : Réutilise l'existant : aux et def quarterlyBasis (types:198, binanceDapi.ts:329), FundingHistory et CarryPanel dans FUNDX. Le basis à maturité constante gagnerait à être un mode de quarterlyBasis plutôt qu'un nouveau def. Effort L.

### 23. SUG-21 — Niveaux d'options enrichis sur le graphe : murs consolidés Deribit + IBIT/ETHA et quantiles risque-neutres asymétriques (p10 à p90) aux prochaines échéances

**Score 13/20** · valeur 3 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : options · origines : OPT-4, OPT-6

**Question de trading.** Quels strikes concentrent vraiment l'OI BTC maintenant qu'IBIT pèse autant que Deribit, et où le marché d'options place-t-il les bornes probables pour vendredi, skew compris ?

**Proposition retenue après vérification.** Couche OPTNIV : ajouter les quantiles risque-neutres p10/p25/p50/p75/p90, par inversion de courbeProbaImplicite, pour la prochaine quotidienne et le prochain vendredi. Aucun fetch nouveau ; lignes étiquetées « RN » et retirées à 08:00 UTC. Figer localement p10/p90 à T−24 h pour mesurer la couverture réelle. IBIT/ETHA en second temps : murs IBIT convertis tracés comme lignes distinctes « IBIT (différé, séance US, OI J−1) », plutôt qu'une somme par tranche de 500 USD. GEX consolidé uniquement dans OMON, sous les trois hypothèses de signe.

**Proposition initiale.** (1) Dans niveauxOptions : murs calls/puts et top 3 OI d'IBIT convertis en prix BTC (niveauCrypto), vue consolidée par tranche de 500 USD avec part par place, étiquette « IBIT ≈ différé, séance US » ; GEX consolidé par hypothèse de signe. ETH avec ETHA. (2) Inverser P(S_T > K) de Breeden-Litzenberger aux probabilités 0,9/0,75/0,5/0,25/0,1 pour la quotidienne suivante, le vendredi et la fin de mois ; niveaux « RN p10 (ven.) » jusqu'à 08:00 UTC ; écart de queue avec la distribution empirique de DIST.

**Ce qui existe déjà.** Les murs IBIT/ETHA sont déjà convertis en niveau BTC/ETH, mais seulement dans OMON mode Actions (VueGexDex.tsx:49, niveauCrypto cboe.ts:282-291) et pour la seule échéance CBOE retenue (cboe.ts:162-165). Ils ne sont jamais consolidés avec Deribit. La couche du graphe est Deribit seule (niveauxOptions.ts:1-3, :75-93). La courbe P(S_T>K) de Breeden-Litzenberger existe déjà (probaImplicite.ts:55-104), mais OMON ne la calcule que pour l'échéance sélectionnée (OptionsWindow.tsx:265) et ne lit qu'un niveau à la fois (probaImplicite.ts:151-161). Elle n'est jamais inversée en quantiles (grep quantile dans OMON : rien). Les bandes EMOVE sont symétriques, tirées du DVOL (bandesImplicites.ts:37-42), avec 78 % de couverture documentée (bandesImplicites.ts:8-10). Les horizons de DIST sont en bougies [1,5,20] (distVar.ts:20), pas en heures jusqu'à une échéance.

**Réutilise.** niveauCrypto, mursGamma, gexParStrikeToutesEcheances, FournisseurLignes (niveauxOptions.ts:25), courbeProbaImplicite, distVar (apps/web/src/data/distVar.ts:20).

**Point d'intégration.** Volet RN : calculerNiveauxOptions (niveauxOptions.ts:75) dispose déjà de la chaîne complète, toutes échéances, via chargerChaineOptions (chaineOptionsCache.ts:27). Il suffit d'ajouter une fonction pure quantilesRisqueNeutre(courbe, [0.1..0.9]) dans probaImplicite.ts, de l'appliquer à la prochaine quotidienne, au vendredi et à la fin de mois, et d'émettre les lignes dans lignesNiveauxOptions (:96-106). limiteChaineOptions assure déjà le retrait à 08:00 UTC (chaineOptionsCache.ts:54-56). Aucun appel réseau supplémentaire. Volet IBIT : un cache CBOE paresseux, sur le modèle de chaineOptionsCache, appelé depuis creerSourceNiveauxOptions (:119). Il réutilise fetchCboeChain (cboe.ts:331), prixCryptoAuDernierEchange (:302), comparerHypothesesGamma avec EQUITY_CONTRACT_MULTIPLIER (gexDex.ts:100, :242) et niveauCrypto. Hôtes déjà autorisés : www.deribit.com et cdn.cboe.com dans shared/extapi-hosts.ts.

**Sources.**

- CBOE delayed quotes IBIT/ETHA (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Déjà utilisé, endpoint non documenté, différé ~15 min, CGU en zone grise (docs/research/04-sources-gratuites-souverain-cot-gex.md:101). OI IBIT > Deribit fin septembre 2025 (Bloomberg, vérifié).
- Deribit public/get_delivery_prices (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Prix de règlement historiques pour le calibrage (doc vue par WebSearch).

**Contrat.** Exception G100 nécessaire : extension d'une couche existante du graphe. Pas de nouveau fournisseur, de clé ni d'hôte. Budget initial épargné si tout reste dans le chunk paresseux (niveauxOverlays.ts:6, :81-82). Une nouvelle bascule ou commande toucherait en revanche le socle initial (marge gzip d'environ 4,7 Ko, BUILD-CONTRACT.md:1936) : réutiliser OPTNIV/EMOVE. Pas d'enregistreur. La mesure à T−24 h oblige toutefois à figer quelques nombres par échéance (localStorage ou KV du daemon), ce qui n'existe pas sur Vercel sans daemon. Effort S pour le volet RN seul.

**Risques.** IBIT : environ 1,2 Mo par appel (OptionsWindow.tsx:142), ajoutés au cycle de 10 min de la couche. L'OI OCC est quotidien et le prix reste figé hors séance US (le week-end, ce sont les niveaux du vendredi). Strikes filtrés à ±25 % (cboe.ts:229). La conversion par ratio de prix n'est pas la NAV (cboe.ts:279-280). La convention de signe des dealers est encore plus douteuse sur un ETF dont les porteurs vendent des calls couverts. Une tranche de 500 USD est plus fine que le pas IBIT converti, d'où des tranches vides ou alternées (ordre de grandeur non vérifié). RN : la mesure risque-neutre surestime l'amplitude (même biais que les 78 % du DVOL). La monotonie imposée par minimum biaise la queue haute (probaImplicite.ts:24). Quantile hors grille de strikes → null ; les quotidiennes ont peu de strikes. Faits externes (OI IBIT ≥ Deribit, CGU CBOE) non revérifiés dans cette passe : budget de recherche web épuisé.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Faire d'abord la partie 2 seule. Elle ne demande aucun appel réseau supplémentaire et compose des fonctions existantes. Elle doit être étiquetée RN et comparée à DIST, avec la couverture asymétrique comme vrai test. La partie 1 ne vaut que si le test des murs Deribit seuls montre un effet. Dans ce cas, IBIT va dans une couche distincte avec son âge affiché, et non dans un GEX additif consolidé. Mon budget WebSearch était épuisé (quota partagé de la passe) et docs.deribit.com et www.okx.com sont injoignables en WebFetch : les références externes ci-dessus viennent de ma mémoire et ne sont pas revérifiées.

**Références.**

- Breeden & Litzenberger (1978), Journal of Business 51(4) : densité risque-neutre par dérivée seconde du prix de call (mémoire, non revérifié en ligne dans cette passe)
- Bliss & Panigirtzoglou (2004), Journal of Finance 59(1), « Option-implied risk aversion estimates » : les densités RN surestiment la dispersion et doivent être ajustées du risque pour prévoir (mémoire, non revérifié)
- Carr & Wu (2009), Review of Financial Studies, « Variance risk premiums » (mémoire, non revérifié)
- Baltussen, Da, Lammers & Martens (2021), Journal of Financial Economics, « Hedging demand and market intraday momentum » : effet du gamma agrégé, pas des murs par strike (mémoire, non revérifié)
- Ni, Pearson & Poteshman (2005), Journal of Financial Economics : regroupement des cours aux strikes le jour d'échéance, actions US seulement (mémoire, non revérifié)
- Interne : apps/web/src/chart/niveaux/bandesImplicites.ts:8-10 (78,0 % des clôtures quotidiennes dans ±1σ DVOL sur 998 j, 76,8 % des semaines)
- Interne : apps/web/src/data/probaImplicite.ts:1-30 et :54 (Breeden-Litzenberger déjà implémenté, limites documentées), apps/web/src/data/cboe.ts:33-37 et :279-290 (IBIT/ETHA et niveauCrypto)
- Part IBIT de l'OI options BTC : vérifiée par l'étape précédente (Bloomberg, Checkonchain), non revérifiée ici
- docs/research/04-sources-gratuites-souverain-cot-gex.md:101 (CBOE non documenté, CGU en zone grise)

**Redondance.** Partie 2 : il s'agit d'une lecture inverse de courbeProbaImplicite (probaImplicite.ts:54), déjà affichée dans OMON Smile. L'amplitude est déjà couverte par mouvementsAttendus (mouvementAttendu.ts), les bandes DVOL ±1σ/±2σ J/S et les quantiles empiriques de DIST (distVar.ts:20). L'apport réel se limite à deux points : projeter les quantiles asymétriques sur le graphe et les comparer à DIST. Partie 1 : les murs IBIT convertis en prix BTC existent déjà dans OMON, mode Actions (cboe.ts:279-290). Les murs, les deux flips et le max pain Deribit sont déjà sur le graphe (niveauxOptions.ts:1-12). Seule la consolidation est nouvelle. Le graphe maître porte déjà beaucoup de niveaux : murs, flips, max pain, bandes J/S et niveaux clés.

**Pièges.** (a) Mesure risque-neutre et mesure réelle diffèrent. Le 78 % interne vient d'une surdispersion (prime de variance, et DVOL 30 j appliqué à 1 j), pas d'une asymétrie : l'argument de preuve_interet est donc un non-sequitur. Les quantiles RN hériteront de la même prime, si bien que la couverture [p10, p90] dépassera prévisiblement 80 % et que le p10 restera trop bas à cause du skew put. Un écart à 80 % ne prouvera rien. (b) La grille de strikes est grossière sur les quotidiennes : null avec moins de 3 strikes ou hors grille (probaImplicite.ts:51-52). La monotonie par minimum propage le bruit (probaImplicite.ts:24-25). Les marks viennent du modèle Deribit, pas de trades. (c) Repaint : les quantiles bougent avec chaque chaîne. L'évaluation doit les figer à T−24 h. (d) IBIT est différé d'environ 15 min et ne cote qu'en séance US. L'OI publié une fois par jour peut avoir 1 à 3 jours le week-end (non vérifié). Les dealers IBIT se couvrent en actions IBIT ou en futures pendant la séance US, pas sur Deribit 24/7 : additionner les GEX mélange deux mécanismes. L'hypothèse de signe des dealers peut différer d'une place à l'autre (overwriting de calls sur IBIT, non vérifié). La conversion par ratio de prix dérive avec la prime ou la décote, et les LEAPS gonflent l'OI lointain. (e) Les tranches de 500 USD sont un paramètre libre : risque de sur-ajustement. (f) Les CGU CBOE sont en zone grise pour un site public.

**Protocole de validation.** Figer d'abord un manifeste, comme scripts/axis/manifeste-*.json : interpolation, lissage, instant T−24 h, échéances, tranches. Le dépôt ne garde aucun historique de chaînes et le daemon n'a aucun collecteur d'options (apps/daemon/src). La validation est donc prospective : un agrégat quotidien figé (SUG-20) sur au moins 40 échéances, évalué une seule fois. Métriques déclarées à l'avance : pinball loss ou CRPS des quantiles RN contre trois références, (i) bandes DVOL symétriques, (ii) quantiles DIST, (iii) RN recalibré par un facteur unique estimé sur la première moitié (version simple de Bliss-Panigirtzoglou) puis testé sur la seconde. Couverture rapportée séparément à gauche et à droite pour tester l'asymétrie. Murs : taux de réaction à ±0,5 % contre des niveaux placebo (strikes d'OI comparable tirés au hasard, niveaux ronds), Deribit seul puis consolidé, sur une période jamais vue. Accélération possible : échantillons historiques gratuits de Tardis.dev (1er jour du mois, non vérifié).

**Preuve d'intérêt (idéation).** IBIT ≥ moitié de l'OI options BTC depuis fin 2025 (Bloomberg, Checkonchain, vérifiés). Interne : 78 % des clôtures dans ±1σ DVOL au lieu de 68 % (bandesImplicites.ts:8-10) : la bande symétrique est mal calibrée, la distribution complète garde l'asymétrie.

**Mesure de succès.** Sur ≥ 40 échéances réglées, part des règlements dans [RN p10, RN p90] figé à T−24 h contre 80 % nominal ; sur 60 j, fréquence des extrêmes quotidiens à ±0,5 % d'un mur consolidé contre murs Deribit seuls et niveaux ronds.

**Fichiers à toucher.**

- apps/web/src/data/probaImplicite.ts
- apps/web/src/data/probaImplicite.test.ts
- apps/web/src/chart/niveaux/niveauxOptions.ts
- apps/web/src/chart/niveaux/niveauxOptions.test.ts
- apps/web/src/data/chaineCboeCache.ts (nouveau, volet IBIT)
- apps/web/src/chart/niveauxOverlays.ts (libellé OPTNIV seulement)
- apps/web/src/components/omon/VueSmile.tsx (tableau des quantiles, optionnel)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (3) : Les quantiles risque-neutres asymétriques tiennent compte du skew, contrairement aux bandes DVOL symétriques, et ne demandent aucun fetch nouveau. Il faut toutefois les étiqueter « RN » : ils héritent de la prime de variance. L'influence des murs IBIT (OI J−1, séance US) sur le prix crypto n'est pas démontrée.
- cout-risque (3) : Les quantiles RN se calculent sans fetch nouveau : bon marché, à libeller « risque-neutre, pas une prévision ». Le volet IBIT est coûteux : environ 1,2 Mo par appel au cycle de 10 min (OptionsWindow.tsx:142), OI J−1, prix figé le week-end, conversion par ratio de prix et non par la NAV. Convention de signe des dealers douteuse.
- coherence (4) : Les quantiles RN s'obtiennent par inversion de courbeProbaImplicite dans la source niveauxOptions existante (chunk paresseux), sans aucun fetch. Le volet IBIT (environ 1,2 Mo par appel) est à garder en second temps.

### 24. SUG-4 — Profils de volume par période (jour, semaine, mois) : POC nus, HVN/LVN, POC développant, migration de la Value Area, TPO en phase 2

**Score 12/20** · valeur 3 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-3, VOL-6

**Question de trading.** Quels POC et VAH/VAL des jours, semaines et mois passés n'ont jamais été revisités, et la valeur migre-t-elle vers le haut ou le bas ?

**Proposition retenue après vérification.** Lot unique après SUG-3 : famille « VP » dans le composite de niveaux, avec les POC, VAH et VAL des N derniers jours, semaines et mois encore non revisités (« nPOC S-2 »). Calcul sur intrabar Binance 15m ou 1h, repli sur les bougies du graphe étiqueté, lignes pleine largeur sans rayons en phase 1. Mention de migration de la Value Area (au-dessus, chevauchante, au-dessous) dans l'infobulle. Mesure figée du taux de retest à 5 et 20 j contre des niveaux témoins à même distance, publiée quel qu'en soit le résultat. Sont écartés jusqu'à cette mesure : histogrammes par période, HVN/LVN, POC développant au registre, TPO.

**Proposition initiale.** Un histogramme par période visible (jour si unité ≤ 1h, semaine en 4h, mois en 1d), calculé sur l'intrabar de SUG-3 avec repli sur les bougies du graphe : POC, VAH, VAL, split acheteur/vendeur. POC nus prolongés en rayons jusqu'au premier contact et injectés dans le composite de niveaux (« nPOC S-2 »). HVN/LVN par extrema du profil lissé, LVN ombrées. Migration de VA (au-dessus, chevauchante, au-dessous). POC développant en série causale (overlay TS pur). Phase 2 : TPO (lettres de 30 min, single prints, poor high/low, initial balance UTC).

**Ce qui existe déjà.** Seuls VPVR (apps/web/src/chart/volumeProfile.ts:60) et VPFR (apps/web/src/chart/volumeRangeOverlay.ts:23) existent. grep tpo|market.?profile|naked|nPOC|developing|hvn|lvn : rien. Le composite de niveaux et la fusion des lignes de même prix existent (apps/web/src/chart/niveaux/composite.ts:24-50), ainsi que la mention « niveaux de RÉFÉRENCE » (apps/web/src/chart/niveaux/niveauxCles.ts:10). Mais LigneNiveau n'a ni origine temporelle ni fin (apps/web/src/chart/niveauxLignes.ts:26-35) : uniquement des lignes pleine largeur.

**Réutilise.** computeVolumeProfile, sessionExtents (packages/indicators/src/utils-session.ts:80), fournisseur composite et bascule des familles (apps/web/src/chart/niveauxOverlays.ts:20), chargeur intrabar de SUG-3.

**Point d'intégration.** Une nouvelle source paresseuse apps/web/src/chart/niveaux/profilsPeriodiques.ts, enregistrée dans FABRIQUES et ORDRE_SOURCES (composite.ts:24-32), plus une clé CleOverlayNiveaux et sa bascule dans le socle (apps/web/src/chart/niveauxOverlays.ts:17-58, chemin initial). Calcul : computeVolumeProfile par période (découpage lundi, mois et jour comme niveauxCles.ts:63-66), sur l'intrabar de SUG-3 avec repli sur les bougies. Les nPOC, VAH et VAL encore non touchés deviennent des LigneNiveau. Les rayons « depuis l'origine jusqu'au premier contact » demandent d'étendre LigneNiveau et le rendu de niveauxLignes.ts. Les histogrammes par période demandent un nouveau contrôleur canvas, comme VolumeProfileController.

**Sources.**

- Klines Binance (intrabar) et bougies des autres places (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Aucune donnée nouvelle.

**Contrat.** Exception G100 nécessaire : c'est une nouvelle surface de graphe (BUILD-CONTRACT.md:71). Un POC développant au registre étendrait le catalogue sans nécessité démontrée (BUILD-CONTRACT.md:82) : à écarter tant qu'aucune mesure n'existe. Aucun fournisseur, aucun hôte, aucune clé. Le socle niveauxOverlays.ts est sur le chemin initial (budget d'environ 4 ko gzip) : n'y ajouter que la clé et la bascule. KLineChart inchangé (canvas superposé).

**Risques.** (1) Sans SUG-3, un profil hebdomadaire en 4h répartit 42 bougies uniformément : POC peu fiable. La dépendance à SUG-3 est forte. (2) Encombrement : fusionnerLignes ne fusionne que les prix quasi identiques (tolérance relative 1e-9, composite.ts:38). Les nPOC voisins s'empilent : borner aux N plus récents par famille. (3) TPO : la « balance initiale » n'a pas de définition naturelle sur un marché 24/7 et il faut des bougies 30m. C'est une surface lourde sans preuve (docs/research/02-indicateurs-edge-crypto.md:228) : à écarter. (4) HVN et LVN dépendent du nombre de bins et du lissage : paramètres libres, donc sur-ajustement visuel. (5) Le « premier contact » se calcule sur l'historique chargé : un nPOC plus ancien que le buffer est indécidable, il faut l'étiqueter.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. À conditionner à SUG-3 : sans intrabar, les profils par période sont trop grossiers. Garder les profils par période et les POC, VAH et VAL nus, rendus testables puis mesurés, avec la mention « référence, aucun avantage démontré » tant que l'étude n'a rien montré. Le POC développant ne doit entrer au registre qu'avec un test qui le justifie. TPO en phase 2 : gadget pour un marché 24/7 sans ouverture de séance. Références externes non revérifiées dans cette session (budget WebSearch épuisé ; hôtes externes injoignables).

**Références.**

- Market Profile (Steidlmayer, CBOT ; Dalton, « Mind Over Markets ») : pratique ancienne, validation surtout empirique (docs/research/02-indicateurs-edge-crypto.md:217-232). Ouvrages non revérifiés en ligne ici.
- Kavajecz & Odders-White, « Technical Analysis and Liquidity Provision », Review of Financial Studies 2004 : les niveaux S/R coïncident avec les pics de profondeur du carnet. Non revérifié en ligne ici ; cela soutient « les niveaux où les ordres s'accumulent », pas le POC.
- Osler, « Currency orders and exchange-rate dynamics », Journal of Finance 2003 : regroupement des ordres stop et take-profit sur les nombres ronds. Non revérifié en ligne ici.
- Aucune étude connue sur les POC nus, comme l'idée l'admet. Interne : niveaux clés sans avantage démontré (apps/web/src/chart/niveaux/niveauxCles.ts:10). Le taux de tenue des zones AXIS S/R a été mesuré sans témoins (docs/axis-2026-10-07.md:986-993).
- Mesure scratchpad (vp-intrabar.mjs) : un profil construit depuis des bougies 4h ne retrouve le POC tick à ±1 bin que dans 68 % des cas, contre 98 % en 1m. Le repli « bougies du graphe » proposé est donc grossier.

**Redondance.** Moyenne. VPVR et VPFR existent (volumeProfile.ts:60 ; volumeRangeOverlay.ts:23), et le VPFR permet déjà de tracer à la main un profil de jour ou de semaine. Les niveaux clés J/S/M/T (apps/web/src/chart/niveauxOverlays.ts:16-19) et les zones AXIS S/R couvrent déjà les références périodiques et les structures de swing. Nouveautés réelles : POC, VAH et VAL nus prolongés automatiquement, POC développant causal, migration de VA. Le TPO est nouveau mais mal adapté (voir pièges). Dépend de SUG-3 pour être fiable.

**Pièges.** 1) Crypto 24/7 : les bornes de séance sont arbitraires (minuit UTC). « Initial balance », « poor high/low » et « single prints » viennent des séances à la criée avec une ouverture : leur sens est douteux ici. 2) Le POC dépend du nombre de bins et du pourcentage de VA : des paramètres faciles à sur-ajuster. 3) Le « taux de retest » est mécaniquement élevé pour un niveau proche (probabilité d'atteinte d'une marche aléatoire). Sans témoins appariés à même distance en ATR, il ne mesure rien. 4) Biais du survivant si l'univers testé ne garde que les paires encore cotées. 5) Profil d'une seule place, alors que le volume se répartit entre spot et perp et entre places. 6) Repli sur les bougies du graphe trop grossier (68 % de POC à ±1 bin depuis le 4h, en synthétique). 7) Ajouter le POC développant au registre est une extension à justifier (BUILD-CONTRACT.md:82). 8) Des dizaines de lignes nPOC alimentent le biais de confirmation : borner leur nombre et leur ancienneté.

**Protocole de validation.** Étude d'évènements figée avant téléchargement. À chaque fin de période (jour, semaine, mois), enregistrer nPOC, VAH et VAL. Témoins : niveaux à même distance signée en ATR au moment de la création, et POC décalé de ±k bins. Mesurer la probabilité du premier contact à 5 et 20 jours (attendue semblable aux témoins, contrôle de sanité), puis la réaction conditionnelle au contact : rejet ou traversée, rendement signé à h bougies. Nul par décalage circulaire, Bonferroni sur les familles de périodes, pool neuf (autre place, paires jamais vues), résultat publié dans l'infobulle quel qu'il soit. Migration de VA : la tester comme variable de régime (signe de la migration, puis rendement de la période suivante) avec le même nul. TPO seulement si ces tests passent.

**Preuve d'intérêt (idéation).** Market Profile (Steidlmayer, Dalton) : pratique ancienne, preuve surtout empirique (docs/research/02-indicateurs-edge-crypto.md:228). Profils composites chez Exocharts, TPO chez ATAS et Sierra Chart (vérifié dans l'inventaire). Aucune étude sur les POC nus : mesure obligatoire.

**Mesure de succès.** Taux de retest à 5 et 20 j des POC nus contre niveaux témoins à même distance (protocole figé, données jamais vues), publié dans l'infobulle quel qu'il soit ; rendu < 5 ms par mémoïsation par période.

**Fichiers à toucher.**

- apps/web/src/chart/niveaux/profilsPeriodiques.ts (nouveau) + test
- apps/web/src/chart/niveaux/composite.ts
- apps/web/src/chart/niveauxOverlays.ts
- apps/web/src/chart/niveauxLignes.ts (seulement si rayons)
- apps/web/src/chart/volumeProfile.ts (réutilisation de computeVolumeProfile, aucun changement de signature)
- scripts/ (nouveau script de mesure figée du retest des nPOC)

**Avis des juges.**

- valeur (3) : Les nPOC et VAH/VAL hebdomadaires et mensuels sont des cibles et aimants très suivis en crypto. Leur valeur dépend entièrement de SUG-3 : avec 42 bougies 4h réparties uniformément, le POC hebdomadaire est peu fiable. Les bornes de séance sont arbitraires sur un marché 24/7, et l'idée d'un retest « aimant » relève du folklore tant que le test contre témoins n'est pas publié.
- cout-risque (3) : Dépendance forte à SUG-3 : sans intrabar, le POC hebdo sur 42 bougies 4h est peu fiable. Nouvelle surface dans le socle initial niveauxOverlays. L'encombrement des nPOC impose de borner (composite.ts:38). Bins et pourcentage de VA sont faciles à sur-ajuster. Coût modéré, risque d'afficher des niveaux trompeurs si le lot part avant SUG-3.
- coherence (3) : Place naturelle : une clé de plus dans FABRIQUES/ORDRE_SOURCES (chart/niveaux/composite.ts:23-32). Mais l'idée dépend fortement de SUG-3, demande une exception G100 et touche le socle niveauxOverlays du chargement initial. fusionnerLignes (tolérance 1e-9) n'évitera pas l'empilement.

### 25. SUG-24 — Échéances Deribit mesurées dans EVTS (attraction du max pain, compression puis détente) et expositions vanna/charm par strike

**Score 12/20** · valeur 2 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : options · origines : OPT-9, OPT-10

**Question de trading.** Avant une grosse échéance, faut-il attendre une attraction vers le max pain, une compression de vol puis une détente, ou est-ce un mythe, et le passage du temps pousse-t-il les teneurs de marché à acheter ou vendre du BTC ?

**Proposition retenue après vérification.** Lot 1 (S) : type « Échéance Deribit » (mensuelle, trimestrielle) dans EVTS, qui réutilise calculerReactionEvenement. Témoins : vendredis 08:00 non mensuels. IC bootstrap sur l'écart de RV 24 h avant/après ; verdict « non concluant » par défaut. Lot 2 (M, optionnel) : vanna et charm dans greeksDeribit, VEX/CHEX par échéance dans la carte des expositions sous les trois hypothèses, sans verdict unique. Max pain historique reporté tant qu'aucun collecteur n'est accepté.

**Proposition initiale.** (1) Type d'évènement calculé « Échéance Deribit » dans EVTS (vendredi 08:00 UTC, mensuelle, trimestrielle) : rendement absolu et RV 24 h avant/après, comparés à des vendredis témoins ; règlements via get_delivery_prices ; avec l'historique de SUG-20, |S − max pain| à T−24 h puis au règlement. (2) Vanna et charm ajoutés à greeksOptionCrypto, VEX/CHEX par strike et échéance avec les 3 hypothèses de signe ; « Δ de couverture attendu d'ici l'échéance » et « Δ pour −5 pts d'IV ». Aucun max pain affiché comme cible avant ≥ 12 échéances collectées.

**Ce qui existe déjà.** EVTS mesure déjà, par évènement et pour BTC/ETH, rendement, volume et volatilité avant et après sur 5, 15, 60 et 1 440 min (lib/evts.ts:93, :101-121), à partir des M1 Binance sur [H0−24 h, H0+24 h) (evtsReactions.ts:25-53, EvtsWindow.tsx:176-192). Les types sont CPI, NFP, PCE, ventes au détail et FOMC (eventDates.ts:29-38), et non CPI/NFP/FOMC seuls. Il n'y a ni groupe témoin ni IC bootstrap (exports de lib/evts.ts:37-316). Le max pain instantané existe par échéance (deribit.ts:124) et sur le graphe (niveauxOptions.ts:91). Les greeks se limitent à delta et gamma (blackScholes.ts:45-54, greeksDeribit.ts:19-37). VEX/vanna/charm figurent en non-objectif du lot E (docs/superpowers/specs/2026-07-31-programme-v26-marches-croises-design.md:269).

**Réutilise.** chargerFenetreReactionM1, médiane et bande p25-p75 d'EVTS, computeMaxPain, aggregateGexDex et comparerHypothesesGamma (gexDex.ts), carte des expositions (apps/web/src/data/carteExpositions.ts:80).

**Point d'intégration.** (1) Type d'évènement calculé dans eventDates.ts (union TypeEvenement :29, TYPES_EVENEMENT :32). Calendrier pur : vendredi 08:00 UTC, dernier vendredi du mois, trimestrielle. timeApprox=false, donc le type passe le filtre intraday strict (EvtsWindow.tsx:148-158). « fomc » est un précédent de type qui n'est pas une publication. Témoins : vendredis 08:00 non mensuels ; IC bootstrap à ajouter dans lib/evts.ts. get_delivery_prices est inutile pour l'étude de RV (les klines Binance suffisent) ; il ne sert qu'à |S − max pain| au règlement. (2) vanna et charm purs dans greeksDeribit.ts (d1 et d2 y sont déjà calculés), agrégés comme le gamma sous chaque hypothèse (gexDex.ts:60-90, :100-127). Colonnes ajoutées à TotauxExpositions (carteExpositions.ts:11-17) et au rendu de CarteExpositions.

**Sources.**

- Deribit public/get_delivery_prices (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Historique des règlements, count ≤ 1 000 (doc vue par WebSearch).
- Binance spot klines 1m (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà utilisé par EVTS.

**Contrat.** Les extensions d'EVTS et d'OMON demandent une exception G100. Pas de fournisseur, d'hôte ni de clé ; les klines Binance sont déjà utilisées. Volet max pain à T−24 h : aucune chaîne historique publique gratuite n'est connue, il dépend donc d'un collecteur quotidien (SUG-20). Sur Vercel sans daemon, rien n'est collecté. Rouvrir VEX/charm revient sur un non-objectif écrit : la décision du propriétaire est à consigner. Effort S pour le lot EVTS seul.

**Risques.** L'union TypeEvenement est partagée avec les archives de publications et le calcul de surprise (EvtsWindow.tsx:42-56) : il faut tenir le nouveau type hors de ces chemins. Règle du dernier vendredi et absence de report férié non revérifiées en ligne ; le 25 décembre est bien une échéance (docs/revue-2026-09-28-options-btc-eth.md:45). 24 mensuelles représentent 2 ans : petit échantillon. Les hebdomadaires tombent aussi le vendredi, donc le témoin est imparfait. Coût : environ 3 pages M1 par évènement (evtsReactions.ts:5-6) × (24 + témoins) ; préférer le 1 h. Vanna et charm reposent sur un modèle à IV et base constantes, et le signe des dealers est inconnu : les trois lectures peuvent se contredire. La dérive selon le signe du CHEX n'est pas testable sans historique.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. La partie 1 (event study des échéances) est utile et peu coûteuse : c'est un test qui tranche un mythe répandu avec l'infrastructure EVTS existante. Elle doit corriger les témoins (échéances quotidiennes et hebdomadaires) et l'effet de l'heure 08:00 UTC (funding). La partie 2 (vanna et charm) relève du gadget en l'état : non-objectif documenté du dépôt, signe inconnu, non testable rétroactivement. Références externes non revérifiées dans cette passe.

**Références.**

- Ni, Pearson & Poteshman (2005), Journal of Financial Economics, « Stock price clustering on option expiration dates » (actions US ; mémoire, non revérifié)
- Avellaneda & Lipkin (2003), Quantitative Finance, « A market-induced mechanism for stock pinning » (mémoire, non revérifié)
- Golez & Jackwerth (2012), Journal of Financial Economics, « Pinning in the S&P 500 futures » (mémoire, non revérifié)
- SqueezeMetrics, livre blanc GEX, et SpotGamma (vanna et charm) : pratique de vendeurs, sans validation académique connue (mémoire, non revérifié)
- Max pain : aucune étude rigoureuse connue ; chiffre de presse « 60 % des échéances 2024 » non vérifié
- Deribit get_delivery_prices (count ≤ 1 000) : vu par l'étape précédente, non revérifié ici. Règlement Deribit = moyenne de l'index sur les 30 min avant 08:00 UTC (mémoire, non revérifié)
- Interne : docs/superpowers/specs/2026-07-31-programme-v26-marches-croises-design.md:269 (« Non-objectifs E : VEX/vanna/charm »), docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11 (modèles populaires écartés sur preuve), apps/web/src/data/evtsReactions.ts:25-40 (fenêtre M1 ±24 h), apps/web/src/components/EvtsWindow.tsx:332 et :438 (CPI, NFP, FOMC), apps/web/src/data/deribit.ts:124, apps/web/src/data/blackScholes.ts:83-105, apps/web/src/data/gexDex.ts:42

**Redondance.** Partie 1 : nouvelle. EVTS couvre CPI, NFP et FOMC, pas les échéances. L'infrastructure (klines M1, médiane, bande p25-p75) est directement réutilisable. Max pain instantané (deribit.ts:124) et heatmap OI par échéance existent déjà. Partie 2 : vanna et charm sont nouveaux mais explicitement exclus par la spec v26 (:269). Les reprendre demande que le propriétaire revienne sur cet arbitrage. Ils s'ajouteraient à GEX/DEX, déjà présentés sous 3 hypothèses de signe.

**Pièges.** (a) Témoins mal posés. Deribit a des échéances quotidiennes : la première échéance du 28 septembre était le mardi 29 (docs/revue-2026-09-28-options-btc-eth.md:13). Tout vendredi est donc une échéance hebdomadaire. Les témoins doivent être les vendredis non mensuels (contraste de taille) et la même heure les autres jours. (b) Confusion horaire : 08:00 UTC est aussi l'heure de règlement du funding des perps Binance, Bybit et OKX (00/08/16 UTC, de mémoire) et proche de l'ouverture européenne. Les futures CME BTC expirent le même dernier vendredi (non vérifié). (c) L'OI historique par strike n'est pas public gratuitement : le volet max pain dépend de SUG-20 et prendra 1 à 2 ans pour 12 à 24 mensuelles. (d) Un règlement en moyenne sur 30 min rend le pinning plus faible qu'en actions. (e) Vanna et charm : triple ambiguïté de signe, dépendance à l'IV du modèle, charm instable près de l'échéance, aucun test rétroactif possible sans surface historique. (f) Tests multiples : rendement, RV, max pain et CHEX, croisés avec 3 types d'échéance et plusieurs horizons, exigent une métrique principale déclarée à l'avance ou une correction Holm.

**Protocole de validation.** (1) Faisable dès maintenant, rétroactivement : calendrier des dernières échéances du vendredi en TS pur, recoupé avec get_delivery_prices, et klines 1m Binance via EVTS. Figer une métrique principale (log du ratio RV 24 h après / RV 24 h avant) et les témoins (vendredis non mensuels et jeudis, même heure). Découper en développement (2019-2022) et test jamais vu (2023-2026), environ 45 mensuelles par moitié, avec IC bootstrap. Si l'IC contient 0, écrire « non concluant » dans EVTS. (2) Max pain : prospectif via SUG-20. Mesurer |S − max pain| entre T−24 h et le règlement contre des placebos : strike de plus gros OI, niveau rond, et marche aléatoire depuis le spot à T−24 h. Rien n'est affiché avant le verdict. (3) Vanna et charm : ne pas les implémenter sans nouvel arbitrage du propriétaire ; s'ils le sont, test prospectif seulement.

**Preuve d'intérêt (idéation).** Aucune étude rigoureuse sur le max pain (chiffre de presse « 60 % des échéances 2024 » non vérifié) ; vanna/charm décrits par des vendeurs sur actions US. Le dépôt écarte déjà les concepts populaires non démontrés (docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11) : ce test évite de trader un mythe.

**Mesure de succès.** Sur ≥ 24 échéances mensuelles : écart de RV 24 h avant/après contre témoins avec IC bootstrap, verdict écrit dans EVTS ; dérive BTC T−5 j → T selon le signe du CHEX, sinon « non concluant ».

**Fichiers à toucher.**

- apps/web/src/data/macro/eventDates.ts
- apps/web/src/data/macro/eventDates.test.ts
- apps/web/src/lib/evts.ts (témoins, bootstrap)
- apps/web/src/components/EvtsWindow.tsx
- apps/web/src/data/greeksDeribit.ts (vanna, charm)
- apps/web/src/data/gexDex.ts (VEX/CHEX par hypothèse)
- apps/web/src/data/carteExpositions.ts
- apps/web/src/components/omon/CarteExpositions.tsx
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : Le lot EVTS sert surtout à démystifier le max pain, à petit coût, mais 24 mensuelles ne font qu'un petit échantillon. Vanna et charm rouvrent un non-objectif, sans verdict de signe possible. Impact faible sur la décision swing.
- cout-risque (4) : Le lot 1 est S : il réutilise calculerReactionEvenement et les klines Binance, avec le verdict « non concluant » par défaut. Risques : petit échantillon (24 mensuelles), témoins à bien poser, union TypeEvenement partagée à isoler (EvtsWindow.tsx:42-56). Le lot 2 VEX/charm rouvre un non-objectif et reste optionnel ; il serait plus risqué (hypothèses de signe).
- coherence (4) : Le lot 1 réutilise calculerReactionEvenement dans EVTS (effort S). Il faut tenir le type hors de l'union de surprise (EvtsWindow.tsx:42-56). Le lot 2, VEX et charm, rouvre un non-objectif écrit.

### 26. SUG-28 — Mineurs sur tout l'historique : Hash Ribbons depuis 2010 avec signaux de reprise annotés, et hashprice en série graphe

**Score 12/20** · valeur 2 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain BTC · origines : BTC-4

**Question de trading.** Les mineurs sont-ils en capitulation ou la reprise du hashrate confirme-t-elle un plancher, et combien valaient historiquement les signaux de reprise ?

**Proposition retenue après vérification.** Enrichir hashRibbons sans nouvel aux. (1) Profondeur portée à 3 ans au moins, depuis une seule source (mempool /3y si la sonde le confirme, sinon CM HashRate seul), partagée avec CHAIN. (2) Nouvelle sortie « reprise confirmée » selon la règle d'Edwards (SMA10 de la clôture > SMA20 après le croisement haussier), avec des marqueurs capitulation, reprise et reprise confirmée. (3) Une seule définition de « reprise » pour le graphe et CHAIN. Pas de hashprice sur le graphe tant que la définition unique d'IDEE-35 n'est pas tranchée. Étude d'évènement à 30 et 90 j par moitiés hors graphe, sur le PriceUSD de Coin Metrics.

**Proposition initiale.** (1) Aux hashrate alimentée par CM HashRate sur tout l'historique, mempool.space pour le point courant (ou /mining/hashrate/3y). (2) hashRibbons : sortie « signal » et annotations capitulation, reprise, reprise confirmée (règle d'Edwards, SMA10 prix > SMA20). (3) Aux hashprice = (IssTotUSD + FeeTotNtv × PriceUSD)/HashRate, plus bas 2 ans marqué. Pools, Lightning et flux de mineurs non retenus sans preuve ni sonde.

**Ce qui existe déjà.** L'indicateur hashRibbons sort déjà un régime −1 en capitulation et +1 pendant 10 barres après la reprise (packages/indicators/src/derivatives/hashRibbons.ts:8-11, 56-99). Il est alimenté par mempool /mining/hashrate/1y (apps/web/src/data/onchain/mempool.ts:221 ; apps/web/src/chart/auxProvider.ts:581-588). Sur 1 an, la SMA60 laisse environ 300 barres de régime. CHAIN › Mineurs affiche l'état des rubans, le dernier croisement et la courbe de hashprice sur 1 an (apps/web/src/components/onchain/Mineurs.tsx:55-96 ; apps/web/src/data/onchain/mineurs.ts:55-105). MINE affiche un hashprice théorique sur 144 blocs. Deux définitions de « hashprice » coexistent donc déjà, déjà relevées par IDEE-35. Coin Metrics HashRate n'est utilisé nulle part : il est seulement listé comme disponible (apps/web/src/data/onchain/coinmetrics.ts:11). Il n'y a ni confirmation par le prix (SMA10 > SMA20) ni annotation.

**Réutilise.** smaAux, calculerHashRibbons, calculerHashprice (mineurs.ts:42-87), chargerLignesCoinMetrics, annotations, etudeEvenements.

**Point d'intégration.** La confirmation par le prix et les annotations se calculent dans hashRibbons.ts à partir des clôtures (candles), sans nouvel aux. Les marqueurs sont rendus en pane et sur le prix (types index.ts:345-350 ; apps/web/src/chart/annotationsPane.ts:87). Pour la profondeur, il faut UNE source par série : soit mempool /hashrate/3y dans fetchHashrate (mempool.ts:211-229, cache « mp:hashrate » partagé avec CHAIN, ce qui reste cohérent), soit Coin Metrics HashRate par chargerLignesCoinMetrics. Le raccord CM et mempool proposé crée une jonction artificielle. Le graphe BTCUSDT Binance commence au 2017-08-14 : les signaux 2011-2017 ne se comptent que hors graphe, dans CHAIN ou un script sur le PriceUSD de Coin Metrics. Un hashprice sur le graphe demanderait un AuxSeriesId « hashprice » et un def de plus.

**Sources.**

- Coin Metrics HashRate, IssTotUSD, FeeTotNtv, PriceUSD (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Servis en community (sondes du dépôt) ; profondeur complète de HashRate non vérifiée.
- mempool.space mining/hashrate (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Périodes 1y/2y/3y documentées, « all » non confirmée ; limites et CGU non publiées.

**Contrat.** Aucun nouveau fournisseur : mempool.space, Coin Metrics community et api.blockchain.info sont déjà autorisés (shared/extapi-hosts.ts:26-30 ; CSP vercel.json:136). Ajouter des sorties et des annotations à un indicateur existant reste une fonctionnalité de surface, donc exception G100 (BUILD-CONTRACT.md:71), mais sans hausse du catalogue ni des types. Le hashprice sur le graphe ajouterait @axiom/types +1 et catalogue +1 (BUILD-CONTRACT.md:81-82). Le budget initial grossit peu, car seul le def change, dans le chunk « indicators ».

**Risques.** (1) Un troisième « hashprice », calculé par Coin Metrics avec IssTotUSD + FeeTotNtv × PriceUSD, aggraverait la confusion relevée par IDEE-35 : l'alerte onchain-seuil lit le hashprice de CHAIN. (2) Deux règles de « reprise » incohérentes : 10 barres sur le graphe (hashRibbons.ts:22), 30 j dans CHAIN (mineurs.ts:28). (3) Le hashrate est une estimation par la difficulté, bruitée, et un changement de source décale les croisements de quelques jours. (4) Les signaux sont rares (environ 1 par an), donc l'étude d'évènement est peu puissante, et le « ~64 % gagnants » n'est pas vérifié. (5) L'existence de mempool /hashrate/3y ou « all », et la profondeur complète de CM HashRate, n'ont pas pu être revérifiées ici (quota WebSearch épuisé, hôtes injoignables).

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Les volets (1) et (2) sont un correctif de profondeur peu coûteux, avec une métrique CM déjà servie : ils rendent l'indicateur existant lisible et ses signaux historiques visibles, utiles comme contexte. Le hashprice en série graphe frôle le gadget : il existe déjà dans CHAIN et redonde avec le prix et Puell. Aucune valeur prédictive démontrée : annotations à libeller « historique, non validé ».

**Références.**

- Edwards C., Capriole (2019), « Capitulation & The Hash Ribbons » : SMA 30/60 j du hashrate et confirmation SMA10 > SMA20 du prix ; backtests non audités. Cité par l'émetteur, non revérifié ici.
- « ~64 % de signaux gagnants » : chiffre d'un tiers, non vérifié.
- Kristoufek L. (2020), Energy Economics, « Bitcoin and its mining on the equilibrium path », et Fantazzini & Kolodin (2020), JRFM, « Does the hashrate affect the bitcoin price? » : le hashrate suivrait le prix plutôt que l'inverse. Références de mémoire, non revérifiées.
- packages/indicators/src/derivatives/hashRibbons.ts:56-90 : indicateur actuel.
- apps/web/src/data/onchain/mempool.ts:211-221 : source /mining/hashrate/1y.
- apps/web/src/chart/auxProvider.ts:581-588 : aux hashrate.
- apps/web/src/data/onchain/mineurs.ts:42-105 : calculerHashRibbons et calculerHashprice sur 1 an.
- apps/web/src/data/onchain/coinmetrics.ts:11 : HashRate servi en community.
- apps/web/src/data/validationSignaux.ts:39-42 : horizons 4h seulement.

**Redondance.** hashRibbons existe déjà (ratio et régime +1 pendant 10 barres, hashRibbons.ts:56-90) et CHAIN calcule l'état et le dernier croisement (mineurs.ts:54-82). La proposition corrige surtout le défaut réel : une profondeur d'un an, soit ~300 barres utiles avec la SMA 60 et 0 ou 1 signal. La confirmation SMA10 > SMA20 du prix s'obtient déjà avec sma/ema du catalogue. Le hashprice est déjà dans CHAIN (1 an). En pane, il vaut essentiellement prix × émission / hashrate : très redondant avec le prix et avec Puell (même numérateur IssTotUSD).

**Pièges.** Hashrate quotidien estimé à partir de la difficulté et des horodatages de blocs (chez CM comme chez mempool) : bruit fort. Raccord CM/mempool : un écart de niveau entre estimateurs crée de faux croisements près de la jointure ; ne jamais mêler deux sources dans une même fenêtre SMA. Le signal d'Edwards contient un filtre de momentum prix : sans base prix seul, on attribue au hashrate un effet de momentum. Signaux rares, de l'ordre de 10 à 15 depuis 2011 (non vérifié) : quelques évènements par moitié, horizons 30 et 90 j chevauchants, puissance quasi nulle. Ruptures structurelles (ASIC 2013, halvings, exode chinois de 2021, reconversion IA/HPC de mineurs cotés, non vérifié) : la règle 30/60 n'est pas stationnaire. Hashprice : rupture à chaque halving et dépendance à l'efficacité des ASIC, donc un « plus bas sur 2 ans » quasi systématique après halving (artefact). Valeur du jour D connue à D+1.

**Protocole de validation.** (1) Cohérence : états des rubans CM et mempool sur l'année commune, écart des dates de croisement en jours. (2) Geler la règle d'Edwards telle que publiée, sans réglage, avec entrée à l'open J+2 après la barre de confirmation. (3) Deux bases : momentum prix seul (SMA10 > SMA20 après un repli de X % prédéclaré) et décalages circulaires (scripts/valider-axis-flux.ts:388-422). L'apport du hashrate est l'écart entre les deux. (4) Déclarer d'avance qu'avec N < 20 le résultat sera « descriptif, non concluant ». Afficher le nombre de signaux et chaque rendement individuel plutôt qu'une moyenne. Données jamais vues : le futur seulement.

**Preuve d'intérêt (idéation).** Hash Ribbons (Edwards, Capriole 2019) présenté comme signal d'achat de long terme, backtests non audités ; « ~64 % gagnants » cité par un tiers, non vérifié. Avec tout l'historique, AXIOM peut mesurer au lieu de reprendre ces chiffres.

**Mesure de succès.** Nombre de signaux visibles 2011-2026 affiché ; event study à 30 et 90 j par moitiés ; états des rubans CM/mempool identiques à quelques jours près ; hashprice CM à ±5 % de CHAIN.

**Fichiers à toucher.**

- packages/indicators/src/derivatives/hashRibbons.ts
- packages/indicators/src/derivatives/hashRibbons.test.ts
- apps/web/src/data/onchain/mempool.ts (ou chargeur CM HashRate)
- apps/web/src/chart/auxProvider.ts
- apps/web/src/data/onchain/mineurs.ts (harmoniser la définition de « reprise »)

**Avis des juges.**

- valeur (2) : Les signaux de Hash Ribbons sont rares (quelques-uns par cycle) et se lisent à l'horizon macro. Hashrate bruité, raccord de sources risqué. Apport marginal pour le swing.
- cout-risque (4) : Sources déjà autorisées (mempool, Coin Metrics), aucun AuxSeriesId ni hausse du catalogue : seulement des sorties et des annotations. Risques : raccord entre estimateurs de hashrate (ne jamais mêler deux sources dans une fenêtre SMA), règle de reprise à unifier avec CHAIN (hashRibbons.ts:22 contre mineurs.ts:28). Hashprice reporté : sage.
- coherence (4) : Enrichit hashRibbons (derivatives/hashRibbons.ts) de sorties et d'annotations, sans catalogue ni types de plus. Unifier la règle de reprise avec CHAIN (mineurs.ts) supprime une incohérence. Ne pas raccorder deux sources de hashrate dans une même fenêtre.

### 27. SUG-C3 — Indicateur appliqué à un indicateur ou à une série auxiliaire (RSI du CVD, z-score de l'OI, Bollinger du funding notionnel), plus une combinaison bornée A ÷ B ou A − B

**Score 12/20** · valeur 3 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : critique de complétude, trou AT de l'inventaire : indicateur sur indicateur

**Question de trading.** Le CVD est-il en surachat sur sa propre histoire, l'OI sort-il de ses bandes de Bollinger, le funding notionnel s'écarte-t-il de sa moyenne, sans attendre un indicateur dédié pour chaque combinaison ?

**Proposition retenue après vérification.** Source étendue des 14 définitions qui déclarent « source », en liste fermée. (1) « ind:<defId>.<sortie> » : sortie d'une définition imbriquée à ses propres paramètres, profondeur 1, OHLCV seulement, sortie causale. Exemples : RSI du CVD, Bollinger d'un oscillateur. Pure et autonome, elle marche à l'identique dans le graphe, les alertes et le BT. (2) « aux:<id> » : série auxiliaire déjà chargée, admise seulement si sa cadence est ≤ l'unité du graphe, et seulement dans le graphe en phase 1 ; les alertes et le BT la refusent avec un motif. Moteur : clé inconnue refusée au lieu du repli close, calcul sur le seul segment défini (amorce exacte) et mémoïsation par instance. Pas de chaînage entre instances, pas de combinaison A÷B ou A−B.

**Proposition initiale.** Étendre l'input source des définitions qui le déclarent (SMA, EMA, WMA, RSI, MACD, Bollinger, z-score, QQE, divergences RSI/MACD, corrélation, bêta) à deux familles de valeurs : « aux:<id> » (oi, funding, liqLongUsd, perpDelta…, déjà alignées en mode clôture) et « inst:<uid>.<sortie> » (sortie d'une autre instance du même graphe, calculée avant, dans un ordre topologique sans cycle). Option « combinaison » limitée à deux opérandes et un opérateur (÷ ou −), sur le modèle de SYN. Ce n'est pas un langage : pas de variables, pas de boucles, pas de fonctions. Légende « RSI(14) de CVD ». Phase 1 : graphe seul, refus motivé dans les alertes et le BT. Phase 2 : même résolution dans les alertes et le BT, puisque le moteur est commun.

**Ce qui existe déjà.** buildCalcContext ne résout que les clés de prix et retombe EN SILENCE sur close pour toute clé inconnue (packages/indicators/src/engine.ts:42-64). computeIndicator lit params.source (:122-125). 14 définitions déclarent un input source avec options fermées open…ohlc4 (ex. trend/sma.ts:23-28, rsi.ts:88) ; 26 fichiers lisent ctx.source ; 57 définitions déclarent aux (comptes vérifiés). Aucun chaînage (grep sourceInstance|surIndicateur|applyTo : rien). Précédents utiles : opérande indicateur du BT, autonome {indicateurId, params, output} (packages/backtest/src/types.ts:54-62) ; BT et alertes savent déjà passer des aux à computeIndicator (packages/backtest/src/engine.ts:124-148, packages/alerts/src/engine.ts:223). Point bloquant non relevé dans l'idée : les helpers comptent un undefined comme 0 (sma utils.ts:35, amorce ema :62 et rma :91 ; rsiOf pousse des gains et pertes nuls, rsi.ts:48-50). Une série aux qui commence plus tard que les bougies (OI Binance de quelques semaines) fausserait donc en silence l'amorce de la SMA, de l'EMA et du RSI.

**Réutilise.** CalcContext.source et aux (packages/types/src/index.ts:361-367), alignAux en mode clôture (packages/indicators/src/utils-aux.ts:37), IndicatorInstance.params ouvert (packages/types/src/index.ts:451), combineKlines comme précédent d'opérateur borné (apps/web/src/data/synthetic.ts:74).

**Point d'intégration.** Résolution dans engine.ts (buildCalcContext/computeIndicator) avec deux familles. « aux:<id> » lit ctx.aux[id]. « ind:<defId>.<sortie> » est une définition imbriquée et autonome, à paramètres propres, de profondeur 1, OHLCV seulement : c'est l'Operande indicateur du BT sérialisé dans le paramètre source. Le calcul se fait sur le seul segment défini, puis on réaligne. Une clé inconnue est refusée au lieu du repli close. Côté graphe, ids aux demandés = def.aux ∪ aux de la source (apps/web/src/chart/indicators.ts:493) et mémoïsation de la branche aux, qui n'est pas mémoïsée aujourd'hui (:505-529, seul compute() l'est, :427-435). Options dynamiques dans InstanceParamsEditor.tsx:25 (pas dans def.options, sinon les sélecteurs des alertes et du BT les proposeraient). Libellé dans overlayLegend.ts.

**Sources.**

- Séries auxiliaires existantes (Binance fapi, Coinalyze, BGeometrics, Coin Metrics…) (déjà utilisée ; gratuit sans clé ou clé serveur existante ; vérifiée en ligne par l'idéation : non) : Aucune donnée nouvelle : les séries déjà chargées par auxProvider.

**Contrat.** Exception G100 légère (réglage d'instance existant). Aucun fournisseur, hôte ni clé : séries aux déjà chargées par auxProvider. Une source fermée à deux familles n'est pas un scripting Pine-like (BUILD-CONTRACT.md:91), à condition d'exclure la combinaison A÷B/A−B, qui ouvre la porte aux expressions. Évite des définitions dédiées (BUILD-CONTRACT.md:82). @axiom/types inchangé : la source reste une chaîne dans params. Une sortie non causale (SORTIES_NON_CAUSALES, packages/backtest/src/engine.ts:66-73) est refusée comme source imbriquée.

**Risques.** 1) Séries reportées en LOCF : un RSI ou un z-score sur une série journalière tracée en 4h voit 5 deltas nuls sur 6, et hérite des défauts AUX-1 (embargo J-7 de BGeometrics) et AUX-3 de la revue. Restreindre « aux: » aux séries dont la cadence est ≤ l'unité du graphe (oi, perpDelta, liqLongUsd/liqShortUsd, lsTaker…). 2) Repli silencieux sur close d'une clé inconnue (engine.ts:62-64) : une instance « aux:oi » recopiée dans une alerte calculerait le RSI du prix sans prévenir. Le refus doit être dans le moteur. 3) Le chaînage par instanceId (« inst: ») crée des orphelins à la suppression, des cycles et un ordre de recalcul à chaque tick. La définition imbriquée autonome les évite. 4) Historique aux court (OI Binance) : amorce longue, valeurs rares. 5) Recalcul à chaque tick si la branche aux n'est pas mémoïsée. Le précédent Coinalyze (métriques personnalisées) n'a pas été revérifié dans cette session.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Vrai manque, et bon levier contre l'inflation du catalogue (BUILD-CONTRACT.md:82). Pourtant, la valeur informative des combinaisons n'est pas mesurée, et le moteur ne gère pas les séries creuses. Le correctif d'amorce et de trous (calcul sur le segment défini, puis recalage) est un prérequis bloquant, faute de quoi le graphe affiche un RSI de 100 fantôme. Limiter la phase 1 aux séries aux causales alignées sur la clôture et aux instances causales. Refuser les sorties non causales dès la phase 1 et reporter l'opérateur ÷. Références externes non vérifiées : quota de recherche épuisé.

**Références.**

- packages/indicators/src/engine.ts:25-71 et :124-130 : la source ne peut être qu'un prix (open, high, low, hl2, hlc3, ohlc4, close).
- packages/indicators/src/derivatives/fundingZScore.ts:21-60 : z-score codé en dur sur ctx.aux.funding, ce qui fait un fichier par combinaison.
- apps/web/src/data/signaux.ts:63-64 et :126 : z-score du funding (seuil 2, fenêtre 60) déjà utilisé par EQS.
- docs/research/02-indicateurs-edge-crypto.md:190 : triangle de positionnement OI, funding et L/S, de pratique [prat], « faible en isolé », jamais mesuré.
- docs/axis-2026-10-07.md:91 et :144 : l'OI Binance sans clé Coinalyze n'offre qu'environ 20 à 90 jours d'historique, et AXIS le laisse hors mesure.
- docs/revue-2026-11-06.md:40 (AUX-1) : la valeur de J-7 de BGeometrics est prolongée sur 7 bougies.
- TradingView permet d'appliquer un indicateur à un autre par l'input Source : de mémoire, non vérifié.
- Métriques personnalisées de Coinalyze : affirmées par l'inventaire, non revérifiées dans cette session.

**Redondance.** Partielle. fundingZScore, mvrvZScore, spreadZScore, volumeZScore, priceZScore (sur source prix) et oiChange existent déjà, et 57 définitions déclarent une série aux. EQS calcule aussi le z-score du funding (signaux.ts:126). Aucun mécanisme générique n'existe : grep sourceInstance|applyTo ne trouve rien. La combinaison A÷B recoupe SYN (combineKlines, apps/web/src/data/synthetic.ts:74) pour les prix, ainsi que spreadZScore et betaRef pour les paires.

**Pièges.** Vérifié dans le code : le moteur suppose des séries denses. Les amorces de rma et d'ema comptent les undefined comme 0 (packages/indicators/src/utils.ts:50 et :81). rsiCore remplace un undefined par un gain et une perte nuls (momentum/rsi.ts:48-51), et avgLoss = 0 donne RSI = 100 (rsi.ts:66). Conséquence : RSI(aux:oi) vaut 100 sur toute la période où l'OI manque, alors que l'OI ne couvre que 20 à 90 jours. sma divise par length même en présence de trous (utils.ts:24). ctx.source est typé number[] (packages/types/src/index.ts:361-367), alors qu'une série aux est (number|undefined)[]. Autres pièges : (2) le report de la dernière valeur (LOCF) d'un funding à 8 h ou d'une série on-chain journalière sur un graphe 1h ou 4h produit des marches d'escalier ; la longueur se compte en bougies et non en observations, et le RSI d'une marche vaut 100, 0 ou reste plat. (3) L'embargo J-7 de BGeometrics fige la valeur sur 7 bougies, ce qui fausse le z-score. (4) Révisions on-chain et latence de publication : seules oi, funding, hlFunding et hlWhalesNet sont alignées sur la clôture (apps/web/src/chart/auxProvider.ts:164-171). Les autres séries sont lues dès l'ouverture, d'où un look-ahead possible si la valeur est publiée plus tard (à vérifier série par série). (5) Une source inst: prise sur une sortie non causale (zigzag, pivots, fractals, chikou ; packages/backtest/src/engine.ts:66-73) repeint dès la phase 1 sur le graphe. (6) A÷B explose quand B traverse 0, ce qui arrive au funding. (7) OI et funding gratuits viennent d'une seule plateforme.

**Protocole de validation.** C'est un outil, pas un signal, donc on valide d'abord la parité. RSI(aux:oi) doit égaler le RSI calculé sur la série extraite après rognage de l'amorce non définie. Ajouter un contrôle par préfixe, le refus des cycles, et deux cas de test explicites : une série aux plus courte que les bougies, et une série à pas de 8 h sur un graphe 1h. Tout signal tiré d'une combinaison passe ensuite par SUG-C5 ou etudeEvenements en mode exploratoire. Il ne devient signal qu'après un manifeste figé et un test sur données postérieures (scripts/axis/).

**Preuve d'intérêt (idéation).** Coinalyze propose des métriques personnalisées (vérifié dans l'inventaire, PDF). L'équivalent TradingView n'est pas vérifié. Interne : 57 définitions dépendent d'une série aux, et chaque lissage ou z-score d'une série demande aujourd'hui un fichier dédié.

**Mesure de succès.** RSI(source = aux:oi) égal au RSI calculé sur la série OI extraite à 1e-12 ; contrôle par préfixe sans écart ; cycle d'instances refusé avec un motif ; aucun recalcul en double (mémoïsation par instance) ; temps de calcul du graphe ≤ +10 % avec 3 instances chaînées.

**Fichiers à toucher.**

- packages/indicators/src/engine.ts
- packages/indicators/src/engine-source.test.ts
- apps/web/src/chart/indicators.ts
- apps/web/src/components/InstanceParamsEditor.tsx
- apps/web/src/chart/overlayLegend.ts
- apps/web/src/lib/indicatorUsability.ts (raison unusable si la série aux n'est pas servie pour l'actif ou l'unité)

**Avis des juges.**

- valeur (3) : Capacité générique (RSI du CVD, z de l'OI) qui évite de multiplier les définitions. Mais les séries reportées en LOCF faussent RSI et z-score (moteur supposé dense, packages/indicators/src/utils.ts:50, :81), et la valeur dépend de la restriction aux séries de cadence ≤ unité.
- cout-risque (3) : Aucune source, mais le moteur suppose des séries denses. Vérifié : l'amorce d'ema/rma divise par length en ignorant les undefined (packages/indicators/src/utils.ts:58-63), et rsiCore met gain = perte = 0 sur un trou (momentum/rsi.ts:48-51), d'où RSI = 100. Sans calcul sur segment défini, valeurs fausses silencieuses. Le repli silencieux sur close d'une clé inconnue est à supprimer.
- coherence (3) : Évite de multiplier les defs, dans l'esprit de BUILD-CONTRACT.md:82, mais touche le cœur du moteur : la résolution de source retombe sur close (packages/indicators/src/engine.ts:61-64) et les séries sont supposées denses. Une dérive vers le scripting est à surveiller (:91).

### 28. SUG-10 — Spot contre perp : ratio de volume perp/spot, part de chaque jambe dans le delta et jambe meneuse des cassures

**Score 11/20** · valeur 2 · coût-risque 4 · cohérence 3 · effort révisé **M** (initial S) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : volume et flux · origines : VOL-2, DER-6

**Question de trading.** Cette cassure est-elle portée par des acheteurs spot (plus durable) ou par le levier perp (fragile), et faut-il la suivre ou attendre un retest ?

**Proposition retenue après vérification.** Définition descriptive `spotPerpVolume`, réservée aux graphes Binance spot : z-score et percentile de log(volume perp / volume spot), delta taker de chaque jambe rapporté à son propre volume, part |Δperp| / (|Δperp| + |Δspot|). Elle s'appuie sur un seul aux, `perpVolume`, servi par le même fetch que perpDelta (promesse partagée, zéro requête de plus). Pas d'étiquette « meneuse » à l'affichage. La campagne figée sur 4 cellules 4h compare le rendement à 12 bougies des grosses bougies (grosMouvementsAxis) selon la jambe dominante, avec un décalage d'une bougie. L'étiquette « spot-led/perp-led » n'est ajoutée qu'en cas de même signe dans au moins 3 cellules sur 4.

**Proposition initiale.** Garder volume (col. 5) et taker buy (col. 9) des klines fapi déjà téléchargées pour perpDelta : aux perpVolume (et perpTakerBuy), même clé et appariement 1:1. Indicateur spotPerpVolume : log(volume perp/spot) en z-score et percentile, delta taker de chaque jambe rapporté à son volume, part |Δperp|/(|Δperp|+|Δspot|), leadership glissant sur 50 bougies (corrélation rendement/delta normalisé de chaque jambe, étiquette « spot-led »/« perp-led »), marqueurs sur les gros mouvements.

**Ce qui existe déjà.** Les klines fapi sont déjà téléchargées, mais seul le delta (2 × k[9] − k[5]) est conservé : le volume k[5] est lu puis jeté (apps/web/src/data/binanceFutures.ts:225-237, appelé par fetchPerpDeltaHistory, apps/web/src/chart/auxProvider.ts:365-391). cvdSpotPerp ne compare que deux CVD normalisés (packages/indicators/src/strategy/cvdSpotPerp.ts:138-143, aux perpDelta). La section DES « Flux takers toutes places » donne, en quotidien et pour BTC/ETH seulement, le spot et le perp de CryptoQuant sans les additionner (apps/web/src/components/FluxTakersSection.tsx:1-15 ; apps/web/src/data/onchain/cryptoquant.ts:17). Aucun ratio de volume perp/spot (grep perpVolume/spotVolume : rien). Un patron de fetch partagé entre deux identifiants existe (liqFluxEnVol, auxProvider.ts:198-219). detecterDivergencesSpotPerp est déjà générique sur deux séries (packages/indicators/src/orderflow/divergenceSpotPerp.ts:33-37). Le chiffre interne +161 bps / p = 0,0005 est à la ligne 13 de scripts/axis/rapport-flux-2026-10-08.md, pas aux lignes 8-10. Il porte sur les forts achats, pas sur la jambe meneuse.

**Réutilise.** fetchPerpDeltaHistory (apps/web/src/chart/auxProvider.ts:365), detecterDivergencesSpotPerp (packages/indicators/src/orderflow/divergenceSpotPerp.ts:33), grosMouvementsAxis (stratAxis.ts:470), annotations.

**Point d'intégration.** Un seul nouvel AuxSeriesId, `perpVolume` : le taker buy perp vaut (perpDelta + perpVolume) / 2, donc perpTakerBuy est inutile. fetchPerpDeltaHistory renvoie les deux colonnes sous une promesse partagée (patron liqFluxEnVol), ce qui ne coûte aucune requête de plus. Ajouts nécessaires : `perpVolume` dans CLE_AVEC_TF (auxProvider.ts:806-815), dans le TTL (auxProvider.ts:89) et dans AUX_PERP (apps/web/src/lib/indicatorUsability.ts:76-86). Définition `spotPerpVolume` dans packages/indicators/src/orderflow/. Sur Vercel, fapi reste en appel direct (apps/web/src/data/extapi.ts:42) ; il est déjà en connect-src (vercel.json:136). Pour la campagne, etatsStrategie ne reçoit aucun aux (packages/indicators/src/utils-fabrique-strategie.ts:191-192) : le runner doit télécharger lui-même les klines fapi.

**Sources.**

- Binance USD-M /fapi/v1/klines (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà appelé ; deux colonnes de plus conservées. Appel direct (451 depuis Vercel serverless).

**Contrat.** Pas de nouveau fournisseur : Binance fapi est déjà appelé. Pas de clé. L'ajout à AuxSeriesId est un écart à « ne pas améliorer @axiom/types » (BUILD-CONTRACT.md:81) ; le précédent signalé est à :515. Une définition de plus au catalogue (BUILD-CONTRACT.md:82) et une surface nouvelle demandent une exception G100 (:71). Budget initial : une définition légère de plus dans le chunk principal (chart/indicators.ts:33). L'effort est S pour l'indicateur et M avec la campagne. Ne pas toucher au pane CVD S/P du WebSocket : son correctif est OFL-2 de docs/revue-2026-11-06.md:680, exclu.

**Risques.** (1) La jambe spot vient des bougies du graphe, donc elle n'a de sens que sur un graphe Binance spot. Sur Coinbase ou Bybit, le ratio mélangerait deux places : il faut le bloquer comme sourceFournitCvd (apps/web/src/chart/orderflow.calc.ts:47-49). (2) toFuturesSymbol ne retire que PERP (auxProvider.ts:302-304) : PEPEUSDT donne PEPEUSDT côté fapi au lieu de 1000PEPEUSDT, donc la série est vide pour les alts « 1000× ». (3) Le ratio de volume subit des ruptures de régime (programme zéro frais BTC de Binance en 2022-2023, dates non revérifiées, et wash trading) ; un z-score glissant n'en absorbe qu'une partie. (4) Une corrélation rendement/delta contemporaine mesure une part expliquée, pas une jambe meneuse : l'étiquette « spot-led/perp-led » serait trompeuse sans décalage temporel. (5) Les IP américaines reçoivent une erreur 451 sur fapi, donc la série est vide (comportement existant). (6) Les sources externes citées (Kaiko 2023, J. Futures Markets 2025) n'ont pas été revérifiées dans cette passe.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Effort S sur des données déjà téléchargées. Le ratio de volume perp/spot est un descripteur bon marché et absent du dépôt. Il faut retirer ou redéfinir la « jambe meneuse », traiter le ratio comme descriptif tant que la campagne n'a pas conclu, et déclarer l'écart @axiom/types. La justification doit citer aussi rapport-ut, qui contredit la continuation hors 4h.

**Références.**

- docs/research/02-indicateurs-edge-crypto.md:65-73 : divergence spot/perp classée [prat], « reste une heuristique ».
- scripts/axis/rapport-flux-2026-10-08.md:166-185 : +161 bps en 4h, mais médiane de 10 bps, 51,2 % de hausses et BNB à -14 bps.
- packages/indicators/src/strategy/stratAxis.ts:522-533 et scripts/axis/rapport-ut-2026-10-08.md:7-21 : forts achats DÉFAVORABLES sur les 13 autres unités (42 paires), moyennes négatives de 15m à 6h (-0,10 % à -0,68 %, p bilatérale ≤ 0,0072).
- apps/web/src/data/binanceFutures.ts:224-236 : deltaDepuisKlinesPerp ne garde que 2·k9 − k5.
- apps/web/src/chart/auxProvider.ts:355-380 : fetchPerpDeltaHistory, 3 pages de 1 500 bougies.
- packages/types/src/index.ts:186-226 avec BUILD-CONTRACT.md:58 et :81 : @axiom/types est figé, un nouvel AuxSeriesId est un écart à déclarer (précédents BUILD-CONTRACT.md:515, :619).
- Littérature sur la découverte des prix perp/spot (Alexander, Choi, Park, Sohn 2020, J. Futures Markets) et rapport Kaiko 2023 cité par l'idée : non revérifiés dans cette passe.

**Redondance.** Forte sur la moitié de la proposition. cvdSpotPerp (packages/indicators/src/strategy/cvdSpotPerp.ts:138) montre déjà les deux CVD normalisés et divergenceSpotPerp leurs divergences. takerNetPct donne le delta spot rapporté au volume, takerBuySellRatio (aux lsTaker, derivatives/takerBuySellRatio.ts:8-19) le ratio taker perp, et premiumSpotPerp et basisPct l'écart de prix. Seuls le ratio de volume perp/spot (z-score, percentile) et la part |Δperp|/(|Δperp|+|Δspot|) sont nouveaux.

**Pièges.** (1) « Jambe meneuse » mal définie. Une corrélation contemporaine rendement/delta sur 50 bougies ne mesure aucune antériorité. L'arbitrage spot/perp chez Binance se fait en secondes et reste invisible en 4h. L'étiquette spot-led ou perp-led tromperait. (2) Le spot se réduit à une paire (BTCUSDT), alors que le spot Binance est fragmenté entre quotes (FDUSD, USDC, BUSD autrefois). Les promotions à frais nuls ont déplacé des volumes (dates non revérifiées) : ruptures du ratio que le z-score glissant ne corrige qu'après sa fenêtre. (3) Le delta perp inclut les liquidations, exécutées comme ordres taker (doc 02:71). Une cascade ressemble donc à du « perp-led ». (4) Alignement : 4 500 bougies perp au plus contre un historique spot plus long. Exclure la bougie en formation des deux jambes. (5) Une seule plateforme, dont la part du marché perp change dans le temps. (6) Données « jamais vues » : tous les actifs USDT de Binance ont été lus par AXIS (manifeste-v5:25), les rendements perp suivent ceux du spot et KuCoin n'a pas de volume taker. Il n'existe donc pas d'échantillon historique vierge pour une hypothèse de flux. (7) La preuve interne citée est sélective : +161 bps sur 4 cellules 4h, contredit en 2h et 6h.

**Protocole de validation.** (a) Mesurer d'abord l'existant. Les divergences de cvdSpotPerp n'ont jamais fait l'objet d'un rapport : les passer dans le même harnais (validationSignaux, décalages circulaires). (b) Manifeste figé. Évènement : cassure Donchian 20 clôturée (stratSpotBreakout sans filtre), classée par terciles figés de part perp et de z-score du ratio de volume. Rendement signé à 6, 12 et 24 bougies 4h, entrée à l'open suivant. (c) Critère : écart entre terciles haut et bas de même signe dans au moins 3 cellules sur 4 et dans les deux moitiés, au-delà du coût de 0,14 %. (d) Données : soit un statutIndependance déclaré « hypothèse nouvelle sur actifs lus, indépendance en temps nulle », soit un test prospectif de 6 mois après le gel. (e) Contrôle : la jambe perp de l'étude est produite par deltaDepuisKlinesPerp, comme sur le graphe. (f) Si « meneuse » est conservé, n'utiliser qu'une corrélation décalée (attendue ≈ 0 en 4h).

**Preuve d'intérêt (idéation).** Kaiko (mai 2023, repris par Bloomberg, vérifié) : glissement de la découverte du prix vers les perps ; leadership variable selon les études (J. Futures Markets 2025, vérifié par WebSearch). Interne : couche flux AXIS +161 bps à 12 bougies 4h, p = 0,0005 (scripts/axis/rapport-flux-2026-10-08.md:8-10).

**Mesure de succès.** Campagne figée sur 4 cellules 4h jamais vues : rendement à 12 bougies des cassures spot-led contre perp-led, même signe dans ≥ 3 cellules sur 4 ; sinon « descriptif ».

**Fichiers à toucher.**

- packages/types/src/index.ts (AuxSeriesId `perpVolume`)
- apps/web/src/data/binanceFutures.ts (parse delta + volume)
- apps/web/src/data/binanceFutures.test.ts
- apps/web/src/chart/auxProvider.ts (promesse partagée, case, CLE_AVEC_TF, TTL)
- apps/web/src/lib/indicatorUsability.ts (AUX_PERP)
- packages/indicators/src/orderflow/spotPerpVolume.ts et son test (nouveaux)
- packages/indicators/src/registry.ts, packages/indicators/src/registry.test.ts
- scripts/valider-spot-perp.ts et manifeste (nouveaux)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : Largement redondante avec cvdSpotPerp, divergenceSpotPerp et premiumSpotPerp (packages/indicators/src/strategy/cvdSpotPerp.ts, orderflow/divergenceSpotPerp.ts). La « jambe meneuse » est invisible en 4h, l'idée le reconnaît. Elle ne vaut que pour un graphe Binance spot.
- cout-risque (4) : Aucune requête supplémentaire (fetch perpDelta partagé), aucune clé. Effort S à M, mais AuxSeriesId +1 et def dans le chunk initial. Bug vérifié : toFuturesSymbol ne retire que PERP (apps/web/src/chart/auxProvider.ts:302-304), donc série vide pour 1000PEPEUSDT. À blinder, avec un blocage hors Binance spot. Risque faible une fois l'étiquette « meneuse » retirée.
- coherence (3) : Aucune requête de plus, puisque k[5] arrive avec le fetch perpDelta. Mais le nouveau def et l'AuxSeriesId « perpVolume » recoupent cvdSpotPerp, qui compare déjà les jambes spot et perp (strategy/cvdSpotPerp.ts:1-15). Mieux vaut des sorties de cvdSpotPerp qu'un 221e def.

### 29. SUG-17 — Jauges de levier : ratio OI/capitalisation avec percentile, et levier observé et carburant de liquidation à ±2/5/10 % sur l'échantillon Hyperliquid

**Score 11/20** · valeur 3 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : dérivés · origines : DER-5, DER-9

**Question de trading.** Le levier est-il excessif par rapport à la taille de l'actif, quel levier les positions réelles emploient-elles, et quelle part serait forcée de sortir à ±5 % de chaque côté ?

**Proposition retenue après vérification.** (a) Indicateur OI/capitalisation, avec la place de l'OI affichée, et percentile et z-score sur la profondeur réelle des aux (90 j), annoncée comme telle. BTC et ETH via Coin Metrics (déjà servis), alts via CoinGecko seulement si l'id est résolu sans ambiguïté. Pas de variante OI/volume. (b) « Carburant HL » : notionnel des niveaux réels à ±2/5/10 % du mark, par côté. Ajouter la colonne mark_px sans toucher au tuple, montrer la lecture instantanée dans LIQ partout (y compris sur Vercel) et la série historique avec le daemon seul, grisée sous 30 % de couverture. Abandonner « levier moyen pondéré » (levier réglé ≠ effectif), ou l'étiqueter « levier réglé médian, indicatif ». Allonger la rétention ou exporter des agrégats journaliers avant toute event study.

**Proposition initiale.** (1) Indicateur levierOiMcap : 100 × OI USD / capitalisation, percentile 365 j, z-score ; capitalisation CM pour BTC, CoinGecko market_chart pour les alts (route déjà autorisée) ; variante OI/volume spot 30 j. (2) Le collecteur HL existant (instantanés 5 min, 14 j) stocke par coin : levier moyen pondéré par côté, notionnel à < 2/5/10 % de son prix de liquidation par côté ; aux hlLevier et hlCarburantLong/Short, bloc dans LIQ avec couverture de l'OI HL ; grisé sous 30 %.

**Ce qui existe déjà.** Aucun ratio OI/capitalisation dans le code (recherche oi/mcap, levier, ELR : rien). L'aux marketcap lit CapMrktCurUSD de Coin Metrics sur 200 j (apps/web/src/chart/auxProvider.ts:510-515, apps/web/src/data/onchain/coinmetrics.ts:34). Le commentaire dit « BTC only », mais ETH est aussi servi (coinmetrics.ts:15). L'historique de capitalisation par pièce sur 365 j existe déjà (apps/web/src/data/mcap.ts:357-365, fetchHistoriquePiece). Le levier HL est lu (shared/hyperliquidScan.ts:111-112, :411) et affiché par position dans WHALES (apps/web/src/components/WhalesWindow.tsx:301-302), mais serialiserNiveaux le jette au stockage (apps/daemon/src/hlLiqHeat.ts:132-137) : seuls [px, side, usd] restent. Le markPx est lu à chaque cycle pour l'OI (hlLiqHeat.ts:120) sans être stocké. La couverture existe (apps/web/src/data/hyperliquidHeat.ts:77). La collecte historique tourne seulement avec le daemon (apps/web/src/components/LiquidationsWindow.tsx:268).

**Réutilise.** Aux oi et marketcap, client CoinGecko (apps/web/src/data/macro/coingecko.ts:27), collecteur hlLiqHeat, couvertureOi (apps/web/src/data/hyperliquidHeat.ts:77), patron hlWhalesNet, fills HL du daemon pour la validation.

**Point d'intégration.** (1) Indicateur dans packages/indicators/src/derivatives sur les aux oi et marketcap, mais l'OI aux couvre 90 j (LOOKBACK_MS, auxProvider.ts:143 et :409) en horaire Coinalyze (:418), avec repli Binance openInterestHist. Un percentile 365 j est donc impossible sans un nouveau fetch d'OI quotidien, dont la profondeur Coinalyze n'est pas vérifiée. Faisable : percentile et z-score sur la fenêtre réelle. (2) Carburant : ajouter une colonne mark_px à hl_liq_instantanes (le markPx est déjà dans la réponse metaAndAssetCtxs) et calculer à la lecture le notionnel des niveaux à ±2/5/10 % du mark, par côté. Le tuple ne doit pas passer à 4 éléments : niveauCompactValide exige exactement 3 éléments (hyperliquidHeat.ts:84-85) et casserait le front. La lecture instantanée est aussi possible sur Vercel, en mode navigateur, à partir des positions scannées (apps/web/src/data/hyperliquidLiq.ts, pool api/hlpool.ts) ; la série historique reste réservée au daemon.

**Sources.**

- CoinGecko coins/{id}/market_chart (déjà utilisée ; clé Demo gratuite (serveur) ; vérifiée en ligne par l'idéation : non) : Déjà autorisé par le proxy ; 365 j en Demo.
- Hyperliquid /info clearinghouseState et metaAndAssetCtxs (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Déjà lus par le daemon ; seul un calcul s'ajoute.

**Contrat.** Exception G100 nécessaire (indicateur nouveau et bloc LIQ). Extension du catalogue à justifier (BUILD-CONTRACT.md:82). Ajout à AuxSeriesId : écart à @axiom/types à signaler (:81). Aucun nouveau fournisseur, aucune clé nouvelle. CoinGecko Demo passe par la clé serveur (api/_policy.ts:322, :364) avec un quota de 10 000 appels par mois partagé par tous les visiteurs publics (coingecko.ts:10). Budget : le chunk « indicators » (apps/web/vite.config.ts:154) est importé statiquement par apps/web/src/chart/indicators.ts:33, et la dernière marge gzip mesurée est d'environ 4 Ko (BUILD-CONTRACT.md:2124). Pas d'enregistreur nouveau : on étend le collecteur opt-in existant. Étiquette obligatoire « échantillon leaderboard, pas une carte globale » (BUILD-CONTRACT.md:89).

**Risques.** leverage.value est le levier RÉGLÉ : en marge croisée, il diffère du levier effectif. Un « levier observé » serait donc trompeur, alors que le prix de liquidation intègre déjà la marge réelle. L'OI vient d'une seule place (Coinalyze, ou Binance en repli) et non du marché entier. La capitalisation saute lors des unlocks ou des révisions d'offre (CoinGecko) : faux signaux sur les alts. La correspondance symbole → id CoinGecko est ambiguë (collisions de tickers). Le carburant varie aussi avec la composition de l'échantillon (top leaderboard, couverture variable), pas seulement avec le marché. Avec 14 j de rétention (hlLiqHeat.ts:53), l'event study proposée est impossible sans allonger la rétention.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Partie (1) : jauge de contexte défendable mais pas encore prouvée. Elle n'a de sens qu'avec un historique OI quotidien long, à obtenir via Coinalyze daily (profondeur non vérifiée) ou les archives data.binance.vision « metrics » (existence et profondeur non vérifiées, chemin à ajouter à la liste blanche). Partie (2) : le carburant à ±2/5/10 % est utile et peu coûteux, calculable à partir des instantanés existants. En revanche, le « levier moyen pondéré » est à écarter tel quel : il est trompeur (levier réglé, échantillon biaisé). Si on le garde, il faut lire accountValue et le notionnel pour obtenir un vrai levier effectif. Correction de la mesure de succès : 14 j continus ne valident rien ; il faut au moins 90 j d'agrégats conservés. Vérification web impossible dans cette session : quota WebSearch épuisé et WebFetch refusé (hôtes hyperliquid.gitbook.io et bis.org hors réseau).

**Références.**

- Glassnode « Futures Leverage Ratio » (OI / capitalisation) et CryptoQuant « Estimated Leverage Ratio » (OI / réserves) : définitions données comme vérifiées par l'idée, non revérifiées dans cette session (quota WebSearch épuisé, hôtes WebFetch bloqués)
- Aucune étude publiée trouvée ou vérifiée montrant qu'un percentile OI/capitalisation prédit le drawdown : non vérifié
- docs/research/02-indicateurs-edge-crypto.md:122 (OI seul = signal de volatilité, pas de direction) et :174-181 (carte de liquidation = modèle)
- scripts/axis/rapport-flux-2026-10-08.md:268 (OI non mesuré dans AXIS, faute d'historique long)
- shared/hyperliquidScan.ts:406 (positions sans liquidationPx écartées) et :411 (lev = leverage.value)
- shared/hyperliquidScan.ts:226-229 (pool délibérément orienté vers les comptes à fort levier)
- apps/daemon/src/hlLiqHeat.ts:53 (rétention 14 j) et :68-77 (schéma sans markPx)
- apps/web/src/chart/auxProvider.ts:143 (LOOKBACK 90 j) et :411-426 (OI = Coinalyze _PERP.A sinon Binance)
- apps/web/src/data/coinalyze.ts:15-16 et :165-170 (intraday purgé, code .A = Binance)
- shared/extapi-hosts.ts:66-68 (data.binance.vision limité aux archives de funding BTC/ETH)

**Redondance.** Le ratio OI/capitalisation n'existe pas : grep oiMcap ou « OI / cap » ne trouve rien. Toutes ses briques existent : aux oi (auxProvider.ts:411), aux marketcap BTC (auxProvider.ts:510-515), route CoinGecko market_chart autorisée (api/_policy.ts:322). Les mesures voisines sont oiChange, fundingNotional (funding × OI), squeezePressureIndex (funding z × ΔOI / ATR%) et liquidationsOi. Le levier par position est déjà affiché dans WHALES (apps/web/src/components/WhalesWindow.tsx:297-303). Le « carburant à ±x % » ne demande aucune nouvelle collecte : c'est une somme sur les niveaux [px, side, usd] déjà stockés (hlLiqHeat.ts:22). Il manque seulement le prix de référence de l'instantané, que l'on peut tirer d'une bougie ou d'une colonne mark_px.

**Pièges.** (1) Le « levier observé » est biaisé : leverage.value est probablement le levier RÉGLÉ et non le levier effectif. En marge croisée, le levier effectif se calcule au niveau du compte (notionnel / accountValue), que le parseur ne lit pas. Sémantique à confirmer sur la doc Hyperliquid, non vérifiée ici. (2) Biais de sélection : les positions sans liquidationPx (comptes sains) sont écartées (hyperliquidScan.ts:406), et le pool est choisi pour surpondérer les comptes leviérisés (:226-229). Le levier moyen est donc surestimé par construction. (3) Le pool est rafraîchi toutes les 6 h : chaque changement de composition peut faire sauter la série sans aucun changement de marché. (4) Avec 14 j de rétention, les données nécessaires à l'étude d'évènements sont purgées. (5) L'OI vient d'une seule place (Binance), divisé par une capitalisation globale : la part de marché de Binance varie (montée de Hyperliquid, du CME), ce qui crée une dérive structurelle sur un percentile 365 j. (6) L'OI horaire n'a que 90 j d'historique (auxProvider.ts:143) et Coinalyze purge l'intraday. Le percentile 365 j exige un historique quotidien, de profondeur non vérifiée. (7) La capitalisation des alts dépend de l'offre en circulation : un déblocage de jetons ou une reclassification fait sauter le ratio. (8) Hyperliquid ne représente qu'une part de l'OI mondial, et le libellé doit le dire.

**Protocole de validation.** Manifeste figé avant téléchargement, sur le modèle de scripts/valider-axis-flux.ts et scripts/axis/manifeste-flux-2026-10-08.json : définition, place, fenêtre 365 j, seuils p90/p50, horizon 7 j. Hypothèse unique : le drawdown maximal à 7 j après un percentile > 90 dépasse la distribution inconditionnelle. Hypothèse nulle par décalages circulaires, évènements dégroupés (un par fenêtre de 7 j), bootstrap par blocs. Développement sur BTC 2021-2023, test unique sur BTC 2024-2026 puis sur ETH et SOL jamais vus. On mesure l'apport en plus du percentile de funding déjà utilisé par le régime (regime.ts:64) ; sans apport marginal, on abandonne. Pour Hyperliquid : conserver d'abord au moins 90 j d'agrégats compacts avec la version du pool, puis corrélation de rang entre le carburant à 5 % et les liquidations HL exécutées à 24 h. La référence à battre est l'OI HL × la volatilité réalisée.

**Preuve d'intérêt (idéation).** Futures Leverage Ratio Glassnode (OI/capitalisation) et ELR CryptoQuant, jauges de risque de cascade (définitions vérifiées). Ici le levier est observé, alors que la carte de liquidation est un modèle (docs/research/02-indicateurs-edge-crypto.md:174-181).

**Mesure de succès.** Event study : drawdown max à 7 j après percentile > 90 contre < 50 ; corrélation carburant à 5 % / liquidations HL exécutées dans les 24 h ; 14 j continus d'historique HL.

**Fichiers à toucher.**

- packages/indicators/src/derivatives/oiMcap.ts (+ test, registre)
- packages/types/src/index.ts (AuxSeriesId si aux carburant)
- apps/web/src/chart/auxProvider.ts
- apps/daemon/src/hlLiqHeat.ts (colonne mark_px, route /hl/liqheat)
- apps/web/src/data/hyperliquidHeat.ts (mapping + calcul carburant)
- apps/web/src/components/LiquidationsWindow.tsx (bloc carburant)

**Avis des juges.**

- valeur (3) : Le ratio OI/capitalisation normalise le levier entre alts et aide à repérer celles exposées aux squeezes. Mais l'OI ne vient que d'une place et la capitalisation CoinGecko saute aux unlocks. Le « carburant HL » résume surtout la heatmap existante sur un échantillon partiel. Le levier « observé » est à abandonner, comme le dit l'idée.
- cout-risque (2) : Quota CoinGecko Demo de 10 000/mois partagé par les visiteurs publics. Résolution d'id ambiguë pour les alts. Sauts de capitalisation lors des unlocks. leverage.value est le levier réglé, pas effectif : « levier observé » serait faux. L'échantillon HL est partiel (grisé sous 30 %). Plusieurs sources fragiles cumulées et risque élevé de chiffre trompeur.
- coherence (3) : Deux pièces disparates. (b) exploite des données LIQHL déjà collectées. (a) ajoute un def et un aux, plus une dépendance au quota CoinGecko Demo partagé par les visiteurs. À scinder.

### 30. SUG-31 — Où arrivent les dollars : flux nets USDT/USDC par chaîne (Tron, Ethereum, Solana, Base, Hyperliquid L1…), offre native en série, et émissions/rachats réels sur Ethereum

**Score 11/20** · valeur 2 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain ETH, DeFi et stablecoins · origines : ETH-2, ETH-5

**Question de trading.** La liquidité fraîche arrive-t-elle sur les rails spéculatifs (marge HL, Solana, Base) ou de paiement (Tron), Circle ou Tether viennent-ils d'émettre un gros montant, et des stablecoins sont-ils déposés en net sur les exchanges ?

**Proposition retenue après vérification.** Deux livrables seulement. (1) STBL › Chaînes : Δ1, Δ7 et Δ30 j par chaîne pour USDT et USDC, calculés sur les historiques par chaîne déjà chargés, étiquetés « variation de l'offre circulante », avec un avertissement sur les échanges de chaîne et les ponts. (2) Émissions et rachats réels USDC et USDT sur Ethereum, lus à la demande par getLogs filtré via /ethscanapi (clé serveur existante), sans collecteur ni table daemon, étiquetés « émission on-chain observée (Ethereum) ». Abandonner le volet dépôts nets vers exchanges (déjà dans WHALES) et différer stablesNatifs.

**Proposition initiale.** (1) STBL › Chaînes : tableau des flux nets 1/7/30 j par chaîne × émetteur en unités natives, part du total, persistance. (2) Aux stablesNatifs = USDT + USDC natifs (sans change ni sauts de couverture) et paramètre de base sur stablecoinPrint ; pane « USDC sur Hyperliquid L1 ». (3) Daemon : getLogs Transfer USDC depuis/vers 0x0 et Issue/Redeem USDT, table d'agrégats quotidiens sans purge à 30 j (émis, rachetés, dépôts/retraits nets vers exchanges étiquetés), route GET /whales/stables/jour, série graphe si daemon présent. Libellés « variation de l'offre circulante » et « émission on-chain observée ».

**Ce qui existe déjà.** STBL › Chaînes affiche la répartition courante et, au clic, la courbe sur 1 an d'une chaîne, tous émetteurs confondus (apps/web/src/components/StablecoinsWindow.tsx:583-690). parseChainCirculating ne lit que current (apps/web/src/data/macro/stablecoinsDetail.ts:110-118). L'historique par chaîne d'USDT (id 1) et d'USDC (id 2) est déjà chargé dans VueImpression (StablecoinsWindow.tsx:473-478 ; stablecoinsDetail.ts:205-233), puis aplati en total par agregerHistoriqueEmetteur (apps/web/src/components/stablecoinsWindow.util.ts:153). stablecoinPrint lit le stock agrégé en USD (packages/indicators/src/derivatives/stablecoinPrint.ts:1-16). WHALES collecte déjà tous les Transfer USDT et USDC ≥ 1 M$ (apps/daemon/src/whales.ts:42, :416-433). Les mints USDC (Transfer depuis 0x0) y entrent donc, sans étiquette. WHALES affiche aussi les dépôts, retraits et le net vers les exchanges (apps/web/src/components/WhalesWindow.tsx:237-243). La collecte n'est pas exhaustive par construction : rétention 30 j (whales.ts:44), rattrapage de 25 blocs avec saut en avant (whales.ts:58, :504-512), troncature à 1 000 lignes (whales.ts:462-470).

**Réutilise.** chargerDetailEmetteur (apps/web/src/data/macro/stablecoinsDetail.ts:205), agregerHistoriqueEmetteur, impressionNette, curseur getLogs et parseur (apps/daemon/src/whales.ts:412-470), whaleLabels, tokensupply pour le contrôle.

**Point d'intégration.** (1) Flux par chaîne : une fonction pure dans stablecoinsWindow.util.ts calcule Δ1, Δ7 et Δ30 j par chaîne pour USDT et USDC à partir de historiqueParChaine, déjà chargé. On ajoute les colonnes dans VueChaines (StablecoinsWindow.tsx:583). Si la liste /stablecoins porte circulatingPrevDay, circulatingPrevWeek et circulatingPrevMonth par chaîne (non vérifié ; la fixture stablecoinsDetail.test.ts:25-39 ne contient que current), le calcul couvre tous les émetteurs sans requête de plus. (2) stablesNatifs : nouvel AuxSeriesId (packages/types/src/index.ts:186), case dans auxProvider et paramètre de base sur stablecoinPrint. (3) Émissions et rachats : pas de table daemon. On lit à la demande, via /ethscanapi avec la clé serveur Etherscan existante (shared/server-credentials.ts:6), un getLogs filtré : USDC Transfer avec topic1 = 0x0 (mint) ou topic2 = 0x0 (burn), USDT Issue et Redeem par topic0. Il faut étendre serverPathAllowed (api/_policy.ts:312-318) à module=logs, action=getLogs, adresse ∈ {USDT, USDC} et topics fixes. Ces évènements sont rares : une fenêtre d'un jour tient sous 1 000 lignes, la lecture est complète et fonctionne sur Vercel. Cache via apps/web/src/data/onchain/cache.ts. Le contrôle croisé par tokensupply est déjà autorisé (api/_policy.ts:317).

**Sources.**

- DefiLlama Stablecoins /stablecoin/{id} (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Historique par chaîne déjà chargé ; Hyperliquid L1 présent (pages DefiLlama non datées) ; clause de republication des CGU du 24/06/2025 à trancher (extrait vérifié).
- Etherscan v2 getLogs (déjà utilisée ; clé gratuite ; vérifiée en ligne par l'idéation : oui) : Mint USDC = Transfer(0x0, …) (vérifié) ; Issue USDT sans Transfer ; évènement de redeem non confirmé ; 1 000 lignes par requête.

**Contrat.** Le contrat interdit d'interpréter la variation du stock USD de STBL comme des mint/burn (BUILD-CONTRACT.md:107-110). Les flux par chaîne s'appellent donc « variation de l'offre circulante ». Les évènements on-chain réels forment une mesure distincte, à acter par une décision datée du propriétaire. Exception G100 pour les nouvelles colonnes et la nouvelle section (BUILD-CONTRACT.md:71). Pas de nouveau fournisseur : DefiLlama et Etherscan sont déjà utilisés. La clé serveur Etherscan existe et son quota est partagé par les visiteurs (BUILD-CONTRACT.md:1285-1290). La lecture à la demande évite toute table permanente : pas d'enregistreur ajouté. Le volet daemon de l'idée serait invisible sur le site public. @axiom/types et le catalogue ne sont touchés que si stablesNatifs est retenu (BUILD-CONTRACT.md:81-82).

**Risques.** Les échanges de chaîne de Tether (rachat sur une chaîne, émission sur une autre) et les ponts (USDC.e contre USDC natif sur les L2) créent des « flux » sans argent frais. Les séries DefiLlama ont des trous, des révisions et des chaînes ajoutées en cours de route. L'existence de « Hyperliquid L1 » comme chaîne DefiLlama n'est pas vérifiée. Tether émet sur son trésor : l'évènement économique est la sortie du trésor, pas l'Issue ; la signature de l'évènement Redeem n'est pas vérifiée. Les limites de débit d'Etherscan et sa clause d'affichage public ne sont pas vérifiées dans cette session. La clause de republication de DefiLlama est à trancher (CGU du 24/06/2025). L'étiquetage des dépôts vers exchanges repose sur une liste curée et reste une estimation. Couverture Ethereum seule pour les émissions réelles. Kristoufek (FRL 2021) : les émissions répondent aux prix, donc lecture de confirmation et non de prévision.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Garder un volet 1 resserré : étendre Rotation chaînes et STBL avec Tron, Hyperliquid L1 et le partage USDT/USDC, par fonctions pures sur des données déjà chargées. Garder aussi l'aux stablesNatifs. Reporter le volet 3 (émissions réelles via le daemon) : le piège CCTP, la trésorerie Tether, la couverture Ethereum seule et les trous du daemon rendraient trompeur le libellé « émission on-chain observée ». Aucune source nouvelle. L'usage public de DefiLlama par chaîne existe déjà, donc le risque de CGU ne change pas.

**Références.**

- Limite de cette passe : WebSearch épuisé. Références citées de mémoire, non vérifiées en ligne.
- Griffin et Shams (2020), « Is Bitcoin Really Untethered? », Journal of Finance 75(4) : émissions USDT après les baisses, suivies de hausses. Non vérifié.
- Wei (2018), « The impact of Tether grants on Bitcoin », Economics Letters : pas d'effet sur les rendements, effet sur le volume. Non vérifié.
- Ante, Fiedler et Strehle (2021), FRL, et Kristoufek (2021), FRL : cités par la proposition, non vérifiés dans cette passe. Ensemble, la littérature est partagée.
- apps/web/src/components/onchain/RotationChaines.tsx:9-11 et apps/web/src/data/onchain/economieChaines.ts:270 (stock de stablecoins par chaîne × horizon : Ethereum, Solana, Base, Arbitrum, dans CHAIN, SECT et STBL)
- apps/web/src/components/StablecoinsWindow.tsx:507-549 (plus fortes hausses et baisses sur 7 j par émetteur), :581-690 (onglet Chaînes)
- packages/indicators/src/derivatives/stablecoinPrint.ts:1-16 ; stablecoinSupply.ts ; ssr.ts
- apps/daemon/src/whales.ts:42-44 (seuil 1 M$, rétention 30 j), :58 et :507 (saut au-delà de 25 blocs), :416-432 (parseur)
- api/_policy.ts:312-318 (tokensupply Etherscan autorisé pour le contrôle)
- BUILD-CONTRACT.md:108-109 (pas d'interprétation mint/burn du stock)

**Redondance.** Moyenne. Rotation chaînes donne déjà la variation du stock de stablecoins par chaîne sur 30/90/365 j (4 chaînes, tous émetteurs, en USD). STBL donne déjà les variations sur 7 et 30 j, les plus fortes hausses et baisses par émetteur, et l'historique d'une chaîne au clic. stablecoinPrint, stablecoinSupply et ssr couvrent l'agrégat. WHALES voit déjà les transferts USDC ≥ 1 M$ depuis 0x0 (un mint USDC émet Transfer depuis 0x0) sans les qualifier. Vraiment nouveau : le croisement chaîne × émetteur, Tron et Hyperliquid L1, et une série en unités natives sans effet de change.

**Pièges.** 1) CCTP. USDC circule entre chaînes par burn-and-mint : un Transfer depuis 0x0 sur Ethereum peut être un transfert venu de Base ou de Solana, pas une émission de Circle. Il faut exclure les mints CCTP (mécanisme connu, adresses non vérifiées).
2) USDT. Un Issue est un réapprovisionnement de la trésorerie (« autorisé, non émis ») ; l'émission économique est la sortie de trésorerie vers les clients. Et l'essentiel de l'USDT est sur Tron : une couverture Ethereum seule est partielle.
3) Le daemon local n'est pas 24/7 : il saute en avant au-delà de 25 blocs, donc trous dès que le Mac dort. Les agrégats doivent être reconstruits par getLogs filtré (topic1 = 0x0) avec rattrapage, pas tirés du poll live.
4) DefiLlama par chaîne : ponts, ajouts de couverture et reclassements natif/ponté (USDC sur Hyperliquid) font des sauts, et des révisions rétroactives sont possibles.
5) Le point du jour est réécrit tant que le jour n'est pas clos.
6) Seuils sur-ajustables (p90, 250 M$). n ≥ 30 émissions de plus de 250 M$ est peu réaliste hors USDT.
7) Libellés stricts imposés par BUILD-CONTRACT.md:108-109.

**Protocole de validation.** 1) Volet 1 : contrôle d'identité avant affichage (somme des chaînes = émetteur à ±0,5 %).
2) Étude d'évènements figée : règles définies sur 2021-2023, un seul test sur 2024-2026, évènements déclustérisés, rendements BTC et ETH signés à 1/7/30 j comparés à la dérive. Ajouter le test inverse (une émission qui suit une hausse) pour trancher entre lecture prédictive et simple confirmation.
3) Incrémentalité par rapport à stablecoinPrint agrégé.
4) Volet daemon : rapprochement quotidien avec totalSupply (tokensupply) avant toute lecture.

**Preuve d'intérêt (idéation).** Ante, Fiedler, Strehle (FRL 2021, ~565 émissions) : rendements anormaux positifs autour des émissions ; Kristoufek (FRL 2021) : les émissions répondent aux prix, donc lecture de confirmation. La ventilation par rail ajoute une information absente de l'agrégat.

**Mesure de succès.** Somme par chaîne = variation de l'émetteur à ±0,5 % ; émissions captées = variation de totalSupply USDC à ±0,1 % par jour ; event study (flux HL L1 7 j > p90 ; émissions ≥ 250 M$) avec n ≥ 30.

**Fichiers à toucher.**

- apps/web/src/components/stablecoinsWindow.util.ts
- apps/web/src/components/StablecoinsWindow.tsx
- apps/web/src/data/macro/stablecoinsDetail.ts
- api/_policy.ts (serverPathAllowed ethscanapi)
- apps/daemon/src/proxy.ts et apps/web/vite.config.ts (si la même politique y est dupliquée)
- apps/web/src/data/onchain/emissionsStables.ts (nouveau)
- packages/types/src/index.ts (seulement si stablesNatifs)
- apps/web/src/chart/auxProvider.ts (seulement si stablesNatifs)
- packages/indicators/src/derivatives/stablecoinPrint.ts (seulement si stablesNatifs)

**Avis des juges.**

- valeur (2) : Les flux par chaîne sont pollués par les échanges de chaîne et les ponts. Les émissions USDT/USDC sont très suivies, mais leur pouvoir prédictif est faible et discuté. Lecture descriptive.
- cout-risque (3) : Partie 1 (Δ par chaîne sur DefiLlama déjà chargé) : bon marché. Partie 2 : getLogs n'est pas dans la liste fermée Etherscan (api/_policy.ts:311-317 n'autorise que ethsupply, nodecount, gasoracle, getsourcecode et tokensupply). Il faut l'ouvrir sur la clé serveur partagée, réponses private no-store. Risque élevé de « fausse émission » : mints CCTP, réapprovisionnement du trésor Tether.
- coherence (4) : Le lot 1, Δ par chaîne sur les historiques déjà chargés dans STBL, est très naturel. Le lot 2, getLogs via la clé serveur etherscan existante (shared/server-credentials.ts:7), crée une chaîne d'analyse nouvelle (exclusions CCTP) et demande une décision datée (BUILD-CONTRACT.md:107-110).

### 31. SUG-38 — Prime coréenne (Upbit) : prime crypto pure, prime du dollar numérique et alts surchauffées en KRW, à côté de la prime Coinbase

**Score 11/20** · valeur 3 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : non · exception fournisseur : oui · exception G100 : oui · catégorie : nouvelle source · origines : FLX-5, SRC-6, QNT-10

**Question de trading.** Le détail coréen surchauffe-t-il (prime au-delà de +3 à +5 %) ou capitule-t-il (décote), et une alt monte-t-elle uniquement sous la pression d'Upbit ?

**Proposition retenue après vérification.** Phase 1 : prime crypto pure BTC et ETH, KRW-X Upbit / (X-USDT Binance × USDT-KRW Upbit) − 1, en 1h et 1d. Section « Primes régionales » de CBPREM avec bandes, z sur 90 j et percentile réutilisés de cbprem.ts. Hôte borné par extapiCheminAutorise. Prime du dollar en option, par Twelve Data USD/KRW plutôt que DEXKOUS. Colonne EQS des alts et indicateur reportés après event study. Prérequis : vérifier en ligne l'accès depuis Vercel, KRW-USDT et les CGU d'Upbit.

**Proposition initiale.** Prime crypto pure = KRW-X Upbit / (X-USDT Binance × USDT-KRW Upbit) − 1, sans taux officiel ; prime du dollar = USDT-KRW Upbit / USD-KRW officiel (FRED DEXKOUS ou Twelve Data) − 1. 1h et 1d. Section « Primes régionales » de CBPREM (bandes, z sur 90 j, percentile), aux primeKrw et indicateur, colonne « prime KRW » dans EQS pour les alts du marché KRW. Upbit sert de jambe de prix, pas de source de graphe.

**Ce qui existe déjà.** Aucune occurrence de upbit, bithumb, kimchi ni KRW dans le code ou la documentation. La seule prime régionale est CBPREM : apps/web/src/data/cbprem.ts:33 (brute), :65 (corrigée du peg), :116 (bandesPremium), :131 (zPoint), :142 (statsPremium). Son store se limite à BTC et ETH en 1h sur environ 30 jours (apps/web/src/store/cbprem.ts:4 et :46). Twelve Data sert déjà de jambe de change avec une clé serveur (apps/web/src/data/ratio.ts:65-80 : EUR, GBP, CHF, JPY, CAD et AUD contre USD, sans KRW). La limite par IP est déjà amortie par le CDN Vercel (s-maxage=60, api/_policy.ts:378-381) et par le daemon (TTL de 120 s, apps/daemon/src/proxy.ts:1021) : il n'y a pas de cache à construire.

**Réutilise.** Alignement, bandesPremium et zPoint (cbprem.ts:116, :131), patron de store CBPREM, adaptateur Binance, route /fredapi.

**Point d'intégration.** Module pur apps/web/src/data/primeKrw.ts, qui réutilise bandesPremium, zPoint et statsPremium (cbprem.ts:116, :131, :142). Store sur le patron d'apps/web/src/store/cbprem.ts. Section « Primes régionales » dans apps/web/src/components/CbpremWindow.tsx. La jambe Binance passe par l'adaptateur existant, en direct. Pour Upbit : api.upbit.com dans EXTAPI_HOSTS (shared/extapi-hosts.ts:13) avec une clause dans extapiCheminAutorise (:60) qui borne /v1/ticker et /v1/candles/*, sans EXTAPI_HOTES_SPECIALISES. La jambe de change passe de préférence par Twelve Data USD/KRW (fournisseur et route tdapi existants, api/_policy.ts:310) plutôt que FRED DEXKOUS, que la publication H.10 hebdomadaire rendrait en retard (non vérifié dans cette passe). La colonne EQS est à reporter.

**Sources.**

- Upbit Open API (cotation : ticker, candles) (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Page officielle des limites vérifiée (quota par IP, 10 req/s pour ticker) ; endpoints vus dans pyupbit ; accès sans clé confirmé par des tiers seulement ; CORS, CGU de réaffichage, marché KRW-USDT et accès depuis Vercel non vérifiés.
- FRED DEXKOUS (nouvelle ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : non) : Fournisseur existant ; série non vérifiée en ligne dans cette session.

**Contrat.** Exception « nouveau fournisseur » pour Upbit (BUILD-CONTRACT.md:26 et :80). Les EXCHANGE_IDS restent à 9 (packages/types/src/index.ts:25), Upbit servant de jambe de données comme CMC sert de source « synthetic ». Exception G100 pour la section CBPREM, puis pour toute colonne EQS (:71). Pas de clé Upbit. La jambe de change Twelve Data consomme le quota serveur sans cache CDN (private, no-store, cf. docs/revue-2026-11-06.md:867-871). Aucun indicateur ni AuxSeriesId nécessaire. Budget d'entrée inchangé si la fenêtre est chargée à la demande.

**Risques.** Non vérifié dans cette passe (web indisponible) : accès à Upbit depuis les IP Vercel américaines, CORS, CGU de réaffichage public, existence du marché KRW-USDT (indispensable à la prime crypto pure), plafond de 200 bougies par appel avec pagination par `to`, disponibilité de USD/KRW sur l'offre Twelve Data du propriétaire. Faux signaux : les suspensions de dépôt et de retrait d'une alt sur Upbit créent des primes isolées qui ne disent rien du sentiment, et les primes au listing aussi. La prime BTC a un niveau structurel non nul, d'où l'intérêt des percentiles et z-scores plutôt que de seuils fixes de +3 à +5 %. L'alignement temporel entre bougies Upbit et Binance doit se faire en UTC exact, sans interpolation, comme cbprem.ts:33. La limite de 10 req/s par IP est partagée par les visiteurs passant par les mêmes IP serverless.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. C'est l'idée la mieux fondée du lot : segmentation documentée (Makarov & Schoar), pratique reconnue, information absente d'AXIOM, réutilisation directe du patron CBPREM. Réserves : la littérature décrit la prime sans démontrer de pouvoir prédictif ; les régimes réglementaires cassent la comparabilité ; l'historique de la prime pure est court ; les primes d'alts sont souvent des artefacts de retraits suspendus. Mieux vaut commencer par BTC et ETH en section de CBPREM, en 1h, avec des z glissants, et repousser la colonne EQS des alts à après le filtre de statut des portefeuilles. Corrections au texte de l'idée : préférer Twelve Data USD/KRW à DEXKOUS pour la latence, et ne pas réutiliser bandesPremium telle quelle. Limite de cette évaluation : budget WebSearch épuisé et global-docs.upbit.com injoignable, donc CGU, CORS, date d'ouverture de KRW-USDT et accès depuis Vercel restent non vérifiés.

**Références.**

- Makarov & Schoar, J. Financial Economics 2020, « Trading and arbitrage in cryptocurrency markets » : écarts persistants, maximaux en Corée, qui s'élargissent en hausse. Descriptif, pas prédictif. Cité, non revérifié dans cette session
- Choi, Lehar & Stauffer, « Bitcoin Microstructure and the Kimchi Premium » (SSRN) : prime liée aux contrôles de capitaux. Cité de mémoire, non revérifié
- Pratique : indice « Korea Premium » publié par CryptoQuant, suivi comme jauge de surchauffe du détail coréen. De mémoire, couverture de l'offre BASIC non vérifiée
- docs/research/02-indicateurs-edge-crypto.md:194-202 (B7 : prime en %, neutraliser le peg, persistance plutôt que pics)
- apps/web/src/data/cbprem.ts:33, :65 (serieCbprem, serieCbpremAjustee)
- apps/web/src/data/cbprem.ts:116-129 (bandesPremium : moyenne/σ sur TOUTE la série)
- apps/web/src/store/cbprem.ts:46, :92-115 (1h, ~30 j, peg via Kraken)
- packages/types/src/index.ts:25 (EXCHANGE_IDS, dont Twelve Data, possible jambe USD/KRW)
- apps/web/src/data/onchain/cryptoquant.ts:16-18 (13 séries CQ admises, aucune prime coréenne)
- BUILD-CONTRACT.md:80, :82

**Redondance.** Faible. CBPREM ne couvre que l'écart US/global (cbprem.ts:33) et aucune série coréenne n'existe (grep upbit|bithumb|kimchi : rien). Recoupement conceptuel partiel avec Fear & Greed (sentiment global) et avec CBPREM (même famille « prime régionale »). La colonne « prime KRW » de l'écran EQS chevauche peu l'existant. Une piste à vérifier pourrait éviter un nouveau fournisseur : une prime coréenne servie par CryptoQuant (clé personnelle déjà câblée, cryptoquant.ts), mais l'offre BASIC n'est pas vérifiée.

**Pièges.** 1) Les contrôles de capitaux rendent la prime structurellement non nulle et son niveau change selon les régimes réglementaires (comptes à nom réel 2018, règle de voyage 2022, loi de protection des utilisateurs 2024 : de mémoire). Un z-score sur plusieurs années mélange donc des régimes. 2) La « prime pure » exige KRW-USDT sur Upbit, marché probablement ouvert vers fin 2023 (non vérifié) : historique court. 3) DEXKOUS (FRED H.10) est publié en lot hebdomadaire (de mémoire) : jusqu'à une semaine de retard pour la prime du dollar en temps réel. Twelve Data USD/KRW, fournisseur existant, est préférable si l'offre gratuite le couvre (non vérifié). 4) Les bougies quotidiennes Upbit commencent à 00:00 KST (UTC+9), contre 00:00 UTC chez Binance : décalage de 9 h en 1d. Il faut aligner en 1h par openTime exact, comme serieCbprem. 5) Les primes d'alts explosent quand les dépôts ou retraits sont suspendus, ou sous « avertissement d'investissement » : l'arbitrage est fermé, ce n'est pas de la demande. Filtre obligatoire, et l'état des portefeuilles demande peut-être une clé (non vérifié). 6) Biais du survivant : les alts KRW radiées disparaissent des listes de marchés ; effets de cotation sur Upbit. 7) bandesPremium (cbprem.ts:116-129) utilise moyenne et σ de toute la série. Réutilisée pour un z sur 90 j, un percentile ou une étude d'évènements, elle introduit une anticipation : fenêtres glissantes strictement passées obligatoires. 8) Une seule place (Upbit) : prévoir Bithumb en contrôle croisé (non vérifié). 9) 200 bougies par requête et quotas par IP sur des IP serverless partagées : pagination coûteuse.

**Protocole de validation.** Hypothèse figée dans un manifeste haché : prime BTC au-dessus du p90 glissant sur 365 j, donc rendement BTC à 7 et 14 j sous la référence (retour à la moyenne). Exploration 2018-2022 avec la prime calculée au change officiel (KRW-BTC ÷ (BTCUSDT × USD/KRW)). Test 2023-2026 jamais consulté, avec la prime pure via KRW-USDT dès qu'elle existe. Un événement par épisode (hystérésis), nul par décalages circulaires (valider-axis-flux.ts:761), effectifs publiés. Contrôle d'apport : la prime KRW doit garder son effet en conditionnant sur CBPREM et funding (régression, ou étude stratifiée par quantile de funding). Pour les alts : étude transversale (prime KRW > 3 % contre le reste, rendement à 7 j), en incluant les alts radiées. Sinon, affichage descriptif seulement. Vérification mécanique : prime identique au calcul manuel sur 5 instants, et écart prime pure/prime USD < 0,5 point hors stress.

**Preuve d'intérêt (idéation).** Makarov & Schoar (JFE 2020) : écarts d'arbitrage persistants, maximaux en Corée et plus forts en hausse (cité, non revérifié en ligne dans cette session). Doc 02:203 : segmentation géographique propre à la crypto.

**Mesure de succès.** Prime identique au calcul manuel sur 5 instants ; cohérence prime pure/prime USD (< 0,5 pt hors stress) ; event study prime BTC > p90 sur 1 an à 7 et 14 j (hypothèse pré-déclarée : retour à la moyenne).

**Fichiers à toucher.**

- shared/extapi-hosts.ts
- apps/web/src/data/primeKrw.ts (nouveau + test)
- apps/web/src/store/primeKrw.ts (nouveau + test)
- apps/web/src/components/CbpremWindow.tsx
- BUILD-CONTRACT.md (exception)
- docs/csp-vercel.md et vercel.json:136 seulement si appel direct (CORS non vérifié)

**Avis des juges.**

- valeur (3) : La meilleure des nouvelles sources : la prime coréenne est un thermomètre de l'euphorie de détail, et les pompes d'alts portées par Upbit sont un phénomène réel. Mais les régimes réglementaires cassent le z sur plusieurs années, et l'accès depuis Vercel, KRW-USDT et les CGU ne sont pas vérifiés.
- cout-risque (2) : Nouveau fournisseur, et prérequis tous non vérifiés : accès depuis les IP Vercel US, CORS, existence de KRW-USDT, CGU de réaffichage. La jambe de change Twelve Data consomme le quota serveur partagé sans cache (private, no-store). Régimes réglementaires coréens : un z pluriannuel est trompeur.
- coherence (3) : Place naturelle : une section de CBPREM qui réutilise bandes, z et percentile de cbprem.ts, sans def ni aux. Mais il faut une exception fournisseur (Upbit) et la jambe de change consomme Twelve Data. L'accès depuis Vercel et le CORS ne sont pas vérifiés : budget de recherche web épuisé dans cette passe.

### 32. SUG-39 — Attention du grand public : pages vues Wikipédia par actif en série quotidienne, z-score et pics d'attention

**Score 11/20** · valeur 2 · coût-risque 4 · cohérence 3 · effort révisé **S** (initial S) · existe déjà : non · exception fournisseur : oui · exception G100 : oui · catégorie : nouvelle source · origines : FLX-6, SRC-8

**Question de trading.** L'attention grand public est-elle au plus haut (euphorie tardive, souvent près des sommets) ou éteinte (désintérêt de fond de cycle), et une alt attire-t-elle soudain un public nouveau ?

**Proposition initiale.** Aux globale attentionWiki : vues quotidiennes agent=user des articles Bitcoin, Ethereum, Solana et de l'actif affiché (table curée, somme en/ko/ja/es/de). Indicateur attention : log des vues, z-score 90 et 365 j, ratio 7 j/90 j, pics > 3σ marqués, ratio alt/BTC. D'abord tuile CYCLE/BRIEF et event study ; registre seulement si effet démontré. Google Trends non retenu.

**Ce qui existe déjà.** Aucune occurrence de wikimedia, wikipedia ni pageviews. Le seul sentiment de foule est le Fear & Greed : packages/indicators/src/momentum/fearGreed.ts:15, apps/web/src/chart/auxProvider.ts:557-559 (120 j), apps/web/src/data/marketOverview.ts:415, et un percentile sur 90 j dans apps/web/src/data/referentiels.ts:235. Le module referentiels (mémoïsation 1 h, referentiels.ts:16 et :30) est le point naturel pour un percentile ou un z quotidien affiché dans BRIEF ou CYCLE. Le User-Agent par hôte existe dans trois endroits : api/_policy.ts:337, apps/daemon/src/proxy.ts:430 et apps/web/vite.config.ts:28. Le User-Agent par défaut du proxy imite Chrome (api/_policy.ts:129-131), ce que la politique de Wikimedia proscrit selon le tiers cité (non revérifié ici).

**Réutilise.** Patron d'aux global quotidien (fearGreed), User-Agent posé par hôte dans le proxy (api/_policy.ts:337, précédent SEC), cache on-chain, etudeEvenements.

**Point d'intégration.** Module pur apps/web/src/data/attentionWiki.ts (somme multilingue, log, z sur 90 et 365 j, ratio 7 j/90 j, pics > 3σ) branché sur referentiels.ts pour une tuile BRIEF ou CYCLE. Pas d'AuxSeriesId en phase 1, donc pas de modification des types figés. Transport : appel direct si Wikimedia répond avec CORS * (non vérifié dans cette passe), avec ajout de https://wikimedia.org à connect-src (vercel.json:136, docs/csp-vercel.md:45), sur le précédent des appels directs OCDE et Eurostat (BUILD-CONTRACT.md:27). Sinon, wikimedia.org dans EXTAPI_HOSTS avec une clause extapiCheminAutorise sur /api/rest_v1/metrics/pageviews/per-article/, sans EXTAPI_HOTES_SPECIALISES, et un User-Agent descriptif posé dans les trois endroits. Le « cache 24 h » n'existe pas : CDN à 60 s (api/_policy.ts:378-381), daemon à 120 s (apps/daemon/src/proxy.ts:1021-1044). Il faut soit un TTL par hôte, soit la mémoïsation front de referentiels.

**Sources.**

- Wikimedia REST API metrics/pageviews/per-article (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Endpoint et filtres d'agent vérifiés via clients tiers (python-mwviews, paquet R pageviews) ; User-Agent descriptif demandé selon un tiers ; licence, CORS et date de début (2015) non vérifiés.

**Contrat.** Exception « nouveau fournisseur » public sans clé (BUILD-CONTRACT.md:26 et :80, précédent OCDE, Eurostat et ONS en appel direct à :27). Exception G100 pour la tuile BRIEF ou CYCLE (:71). Pas de clé. Pas d'indicateur ni d'AuxSeriesId tant que l'effet n'est pas démontré (:82). Charge initiale nulle si le module est chargé à la demande. L'exclusion LunarCrush et Santiment (:90) n'est pas concernée.

**Risques.** Non vérifié dans cette passe : CORS, licence des données (CC0 supposé), plafond de débit, début de l'historique en juillet 2015, blocage des User-Agent génériques depuis des IP cloud. Données : du trafic automatisé classé « user » produit de faux pics, d'où un filtre robuste (médiane ou exclusion des pics d'un seul jour sur une seule langue). Les renommages et redirections d'articles sous-comptent, ce qui impose une table de titres curée par langue. La tendance de fond du trafic Wikipédia en baisse demande un z sur log détendancé. Les pics liés à une actualité négative (piratage, faillite) ne sont pas de l'euphorie. Le décalage est de J-1. Il faut 5 langues × N actifs requêtes. Kristoufek 2013 porte sur 2011-2013 : l'effet est à remesurer.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Source gratuite, sans clé, quotidienne, effort faible. La littérature établit une co-évolution attention/prix, mais un pouvoir prédictif fragile et non signé. Valeur réaliste : une tuile de contexte (CYCLE/BRIEF) « attention élevée ou éteinte », pas un déclencheur de trade. L'hypothèse de l'idée (« pics > 3σ près des sommets ») est contredite par l'asymétrie bulle/krach : il faut la signer par la tendance avant tout test. Pas d'indicateur au registre sans résultat hors échantillon (BUILD-CONTRACT.md:82). Limite de cette évaluation : budget WebSearch épuisé et doc.wikimedia.org injoignable, donc licence, CORS, limites et date de début restent non vérifiés.

**Références.**

- Kristoufek, Scientific Reports 2013, doi 10.1038/srep03415 : corrélation et cointégration vues Wikipédia/prix BTC, relation bidirectionnelle et asymétrique en bulle et en chute. Vérifié par l'émetteur de l'idée
- Moat, Curme, Avakian, Kenett, Stanley & Preis, Scientific Reports 2013, « Quantifying Wikipedia usage patterns before stock market moves ». Cité de mémoire, non revérifié
- Urquhart, Economics Letters 2018, « What causes the attention of Bitcoin? » : l'attention (Google) suit la volatilité et le volume passés, faible pouvoir prédictif. Cité de mémoire, non revérifié
- Liu & Tsyvinski, Review of Financial Studies 2021, « Risks and Returns of Cryptocurrency » : l'attention de recherche prédit les rendements à quelques semaines. Cité de mémoire, non revérifié
- Garcia, Tessone, Mavrodiev & Perony, J. R. Soc. Interface 2014, « The digital traces of bubbles ». Cité de mémoire, non revérifié
- packages/indicators/src/momentum/fearGreed.ts:15 (seul sentiment global)
- apps/web/src/chart/auxProvider.ts:559 (Fear & Greed limité à 120 j)
- api/_policy.ts:132, :337 (User-Agent par hôte, précédent SEC)
- apps/web/src/data/news.ts:40 (GDELT déjà autorisé, articles et non série de volume)
- BUILD-CONTRACT.md:27, :80, :82, :90

**Redondance.** Faible à moyenne. Aucune série d'attention (grep wikimedia|pageviews : rien). Fear & Greed (fearGreed.ts:15) intégrerait déjà une part de tendances de recherche et de réseaux sociaux (composition Alternative.me citée de mémoire, non revérifiée) : recoupement partiel. GDELT (news.ts:40) est déjà autorisé mais sert de flux d'articles, sans historique long de volume. Le ratio alt/BTC d'attention n'a aucun équivalent.

**Pièges.** 1) Le signal n'est pas signé : selon Kristoufek, l'attention s'emballe en bulle COMME en krach (mars 2020, Luna, FTX). Un pic > 3σ n'indique pas « l'euphorie tardive » sans conditionnement par la tendance des prix, et le test sans signe mélangera sommets et capitulations. 2) L'attention est surtout concomitante ou en retard (Urquhart) : risque de mesurer le mouvement déjà fait. 3) Ruptures de série : catégorie d'agent « automated » ajoutée vers 2020, puis baisse des vues humaines attribuée en 2025 à une meilleure détection des robots et aux résumés IA (de mémoire, non revérifié). Les niveaux ne sont pas comparables d'une année à l'autre. 4) per-article ne compte pas les redirections (« BTC » vers Bitcoin) ; renommages, homonymies (Solana, Cardano, Chainlink ont des titres qualifiés) et différences entre éditions linguistiques rendent la table curée fragile. 5) Biais de sélection et du survivant : seuls les actifs devenus célèbres ont un article long. 6) Publication à J+1 (non vérifié) : dater l'évènement à la publication, pas au jour compté. 7) Peu d'épisodes > 3σ indépendants sur 10 ans, regroupés en grappes, avec fenêtres de 30 j chevauchantes : puissance très faible et sur-ajustement facile sur le seuil et les fenêtres. 8) Échantillon de Kristoufek (2011-2013) antérieur à l'ère des ETF et des institutionnels.

**Protocole de validation.** Manifeste haché figé avant téléchargement : articles et éditions, agent=user, accès=tous, somme des éditions ; log des vues ; z glissant sur 365 j strictement passé ; seuil 3σ ; un épisode par tranche de 30 j ; hypothèse signée (pic d'attention ET prix au-dessus de la SMA 200, donc drawdown max à 30 j plus fort que la référence ; pic ET prix sous la SMA 200, donc rebond) ; horizons 14 et 30 j. Exploration 2016-2020, test 2021-2026 jamais consulté (sommet 2021, creux 2022, cycle 2024-2025). Nul par décalages circulaires. Effectif minimal pré-déclaré (par exemple 10 épisodes en test), sinon NON CONCLUANT. Contrôle d'apport : l'effet doit subsister à niveau de Fear & Greed égal (stratification ≥ 75 / < 75). Mécanique : reproduire la corrélation et la cointégration 2016-2026 en différences, pas en niveaux, pour éviter la régression fallacieuse.

**Preuve d'intérêt (idéation).** Kristoufek 2013 (Scientific Reports, doi 10.1038/srep03415, vérifié) : corrélation 0,83 vues/prix BTC, cointégration avec Wikipédia mais pas Google Trends, relation bidirectionnelle ; échantillon 2011-2013 à remesurer.

**Mesure de succès.** Reproduction corrélation/cointégration 2016-2026 ; event study pics > 3σ : rendement 14/30 j et drawdown max, succès si drawdown médian significativement supérieur à la référence.

**Fichiers à toucher.**

- apps/web/src/data/attentionWiki.ts (nouveau + test)
- apps/web/src/data/referentiels.ts
- apps/web/src/components/BriefWindow ou fenêtre CYCLE (tuile)
- vercel.json et docs/csp-vercel.md (si direct)
- sinon : shared/extapi-hosts.ts, api/_policy.ts, apps/daemon/src/proxy.ts, apps/web/vite.config.ts
- apps/web/src/data/validationSignaux.ts (event study des pics)
- BUILD-CONTRACT.md (exception)

**Avis des juges.**

- valeur (2) : Attention non signée (bulle comme krach), quotidienne et lente. Elle ne départage pas un sommet d'une capitulation sans conditionner par la tendance. Licence et CORS supposés, non vérifiés ici.
- cout-risque (4) : Effort S, source publique sans clé, API stable depuis 2015. Licence (CC0 supposée), CORS et plafond de débit non vérifiés dans cette session (doc.wikimedia.org injoignable). Exception fournisseur nécessaire, mais tuile chargée à la demande, sans indicateur avant étude. Risques : faux pics de bots et signal non signé (bulle comme krach), à conditionner par la tendance.
- coherence (3) : Nouveau fournisseur sans clé (précédent : appels directs OCDE, Eurostat et ONS, BUILD-CONTRACT.md:27). Tuile d'abord, effort S. CORS, licence et débit Wikimedia non vérifiés ici (budget de recherche web épuisé).

### 33. SUG-C6 — URPD on-chain sur l'axe des prix (offre BTC par prix de dernier mouvement, global, STH, LTH) et prix de référence cointime (True Market Mean, prix cointime, prix « vaulted ») via Bitview

**Score 11/20** · valeur 3 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : oui · exception G100 : oui · catégorie : on-chain BTC · origines : critique de complétude, trous on-chain de l'inventaire : URPD, prix cointime

**Question de trading.** Où se trouvent les amas d'offre achetés récemment (supports et résistances on-chain) et les poches vides où le prix traverse vite, et BTC est-il au-dessus du prix moyen payé par les investisseurs actifs ?

**Proposition retenue après vérification.** Lot A (sans nouvelle source, effort S) : source de niveaux « Prix on-chain » pour BTC dans la surcouche Niveaux. Trois lignes : prix réalisé STH, prix réalisé LTH (séries déjà chargées par CHAIN) et True Market Mean dérivée = clôture 1d / AVIV BGeometrics du même jour. Chaque ligne porte sa date d'observation ; la TMM affiche « embargo J-7 », toute ligne de plus de 2 j « (périmé) ». Avant publication, la TMM dérivée est comparée à une source tierce sur 5 dates. Lot B, conditionné à la sonde Bitview de SUG-29, aux CGU écrites de l'instance hébergée et à une exception fournisseur nommée : profil URPD all/STH/LTH dans un canvas dédié, avec la date du bloc affichée et une comparaison J-30 en option. Pas de pondérations wakefulness ou mobility, pas de prix « vaulted » en phase 1. Aucun libellé « zone » avant la publication du test contre 1 000 niveaux aléatoires.

**Proposition initiale.** Dépend du lot 0 de SUG-29 (sonde Bitview). (1) Profil URPD dessiné comme le VPVR sur le bord du graphe BTC (1h et plus) : /api/urpd/<cohorte>/<n> pour all, sth, lth ; tranches de prix agrégées côté client ; pondérations none, wakefulness et mobility proposées ; date de l'instantané affichée ; option « comparer à J-30 » (accumulation ou distribution par tranche). (2) Lignes de niveau True Market Mean, prix cointime et prix « vaulted » dans la surcouche Niveaux, avec la date d'observation et « (périmé) » au-delà de 2 j. (3) Les poches à faible offre passent au même test contre niveaux aléatoires que SUG-5 avant tout libellé « zone ».

**Ce qui existe déjà.** grep urpd|cointime|bitview|true.?market|vaulted sur tout le dépôt : rien. En revanche, l'AVIV BGeometrics est déjà une série auxiliaire chartable : bgeometrics.ts:144, auxProvider.ts:127, :532 et :672, route Vercel déjà autorisée par api/_policy.ts:319. Dans le cadre cointime, AVIV = prix / True Market Mean (relation citée de mémoire, non vérifiée en ligne ; la définition BG n'est pas vérifiée non plus). La TMM est donc dérivable sans nouvelle source, avec l'embargo J-7. Les prix réalisés STH et LTH sont déjà chargés pour CHAIN (fluxCapitaux.ts:264 et :179-180) mais ne sont tracés nulle part sur le graphe. Seul realizedPrice global est une série auxiliaire (auxProvider.ts:104). Le VPVR est un contrôleur canvas qui lit marketStore en direct (volumeProfile.ts:165, :213 et :292) : il ne sait pas dessiner un profil fourni de l'extérieur. La surcouche Niveaux ne trace que des lignes horizontales (composite.ts:24-32, niveauxOverlays.ts:17). Corrections des références : la CSP réelle est vercel.json:136, en Report-Only (vercel.json:135) ; docs/csp-vercel.md:45-59 n'est que la procédure. Les hôtes spécialisés sont à shared/extapi-hosts.ts:59 et la règle de chemin à :60-69. Offre STH/LTH jugée « hors de portée sans clé Glassnode » (docs/superpowers/progress/2026-09-14-lot-onchain.md:77). Vérification en ligne impossible dans cette passe : budget WebSearch épuisé, bitview.space ne se résout pas depuis la session, dépôt bitcoinresearchkit/mono non accessible. Les affirmations sur Bitview (CORS, MIT, route /api/urpd) ne sont donc pas revérifiées ici.

**Réutilise.** Rendu de profil du VPVR (computeVolumeProfile, volumeProfile.ts:60), FABRIQUES et creerFournisseurComposite (apps/web/src/chart/niveaux/composite.ts:24, :54), cache on-chain et KV (apps/web/src/data/onchain/cache.ts), chargeur Bitview de SUG-29.

**Point d'intégration.** Lot A, lignes : nouvelle clé « onchainPrix » dans CleOverlayNiveaux (niveauxOverlays.ts:17, store, overlaysNiveauxActifs, commandes) et dans FABRIQUES et ORDRE_SOURCES (composite.ts:24-32). La source reprend le modèle de prixRevient.ts : BTC seul via actifDeribit, toast plutôt qu'overlay muet, « (périmé) ». Données : chargerBg(BG_AVIV, BG_STH_REALIZED_PRICE, BG_LTH_REALIZED_PRICE) et le cache onchain (cache.ts). Lot B, URPD : nouveau contrôleur canvas calqué sur VolumeProfileController (volumeProfile.ts:165), câblé dans ChartInstance.tsx:74 à côté du VP, sur le bord gauche ou en exclusion mutuelle avec le VP. Chargeur paresseux data/onchain/bitviewUrpd.ts. Appel direct si le CORS se confirme, avec entrée connect-src dans vercel.json:136 et mise à jour de docs/csp-vercel.md. Sinon proxy : EXTAPI_HOSTS, EXTAPI_HOTES_SPECIALISES et règle de chemin bornée (shared/extapi-hosts.ts:13-69), appliquée aussi par api/_policy.ts:166. Cache 24 h dans le cache onchain (localStorage et KV).

**Sources.**

- Bitview (instance hébergée de Bitcoin Research Kit) : /api/urpd et séries cointime (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Vérifié dans le dépôt bitcoinresearchkit/mono : « Browser access: Permissive CORS », « Authentication: None », licence MIT, v0.13.0 (showcases/llms.txt) ; route /api/urpd/<cohorte>/<n>?weight=none|wakefulness|mobility&agg=raw, cohortes all/sth/lth/tranches d'âge (crates/bitview_server/docs/urpd.md) ; True Market Mean, prix cointime et vaulted dans crates/bitview_plugin_cointime. Non vérifié : quotas, CGU de l'instance hébergée, sens du segment <n> (hauteur de bloc probable), noms exacts des séries dans l'API.

**Contrat.** Lot A : aucun nouveau fournisseur ni hôte ; route bgapi déjà autorisée (api/_policy.ts:319). Il consomme le quota BG partagé par tous les visiteurs (10 req/h, 15 req/j, BUILD-CONTRACT.md:69) et le CDN Vercel ne met en cache que 60 s (api/_policy.ts:380) : réutiliser les clés de cache déjà chargées par CHAIN et par l'aux AVIV. Lot B : nouveau fournisseur avant G100, donc exception explicite nommée « sans source défaillante remplacée » (BUILD-CONTRACT.md:80), commune à SUG-29. Nouvelle surface de graphe (profil et bascule), donc exception G100 (BUILD-CONTRACT.md:71). Aucune clé serveur : la seule variable serveur admise reste BGEOMETRICS_API_KEY (BUILD-CONTRACT.md:69). Budget initial nul si tout passe par import() comme l'enveloppe niveauxOverlays.ts:79-81. Pas d'enregistreur : instantané quotidien. Les CGU écrites de l'instance hébergée sont un préalable à l'affichage public.

**Risques.** CGU de l'instance hébergée bitview.space, quotas et pérennité non vérifiés : bloquant pour le site public, et le service dépend d'un projet individuel. L'auto-hébergement de BRK exige a priori un nœud complet (non vérifié), hors du périmètre du daemon. URPD : le prix du dernier mouvement n'est pas le coût de l'acheteur. Consolidations internes des plateformes, coinjoins et changements de garde déplacent des amas sans transaction de marché, d'où de faux supports. Le sens du segment <n> n'est pas vérifié. TMM dérivée : embargo J-7 et report sans borne déjà relevé (AUX-1, docs/revue-2026-11-06.md:40) ; la définition BG de l'AVIV est à valider contre une source tierce. Le quota BG est partagé entre visiteurs. Lire un amas URPD comme une zone sans test contre des niveaux aléatoires produirait des faux signaux.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La partie URPD a du sens pour un trader BTC swing : c'est la seule donnée on-chain du lot qui place l'offre sur l'axe des prix, et elle est absente du dépôt. En revanche, aucune étude ne prouve son pouvoir de support ou de résistance, et la base UTXO non ajustée par entité peut fabriquer de faux amas. Je réduirais la phase 1 à l'URPD (cohortes all et sth) plus le seul True Market Mean, et j'abandonnerais le prix cointime et le prix « vaulted » (planchers de cycle redondants avec balancedPrice et cvdd). Avant d'ajouter Bitview, sonder si BGeometrics, déjà autorisé, expose un prix réalisé actif (non vérifié). Exception fournisseur et G100 nécessaires (BUILD-CONTRACT.md:80), commune avec SUG-29. Pour le site public, obtenir l'accord écrit de l'instance hébergée, car aucune CGU n'est publiée. Le budget WebSearch de la session est épuisé : faits vérifiés sur GitHub uniquement ; ark-invest.com, docs.glassnode.com et bitview.space sont injoignables depuis la session.

**Références.**

- https://github.com/bitcoinresearchkit/brk (lu le 2026-11-06 : licence MIT, « official free hosted instance is bitview.space », API et MCP sans compte ni authentification)
- https://github.com/bitcoinresearchkit/brk/blob/main/showcases/llms.txt (lu : « Browser access: Permissive CORS », « Authentication: None », v0.13.0 ; aucune limite de débit ni CGU publiées)
- https://github.com/bitcoinresearchkit/brk/blob/main/crates/bitview_server/docs/urpd.md (lu : /api/urpd/{cohorte}/{n}, cohortes all/sth/lth/age_*, weight none|wakefulness|mobility, agg=raw seul documenté ; reconstruction depuis l'ensemble des UTXO, aucune notion d'entité ; sens de n non défini, l'exemple 900000 suggère une hauteur de bloc ; granularité et fréquence de mise à jour non précisées)
- https://github.com/bitcoinresearchkit/brk/tree/main/crates/bitview_server (lu : fenêtre de réorganisation de 6 blocs ; aucune limite de débit générale ni CGU pour l'instance hébergée ; serveur prévu en local 127.0.0.1 sans authentification)
- https://github.com/bitcoinresearchkit/brk/blob/main/docs/PROFESSIONAL_HOSTING.md (lu : hébergement géré à 0,01 BTC/mois, aucun engagement de disponibilité indiqué)
- Puell et Check, « Cointime Economics », ARK Invest et Glassnode, 2023 : de mémoire, non vérifié (ark-invest.com hors du réseau de la session)
- Glassnode, métrique URPD et usage des « air gaps » dans les rapports hebdomadaires : pratique d'industrie de mémoire, non vérifiée (docs.glassnode.com hors du réseau de la session)
- apps/web/src/data/onchain/bgeometrics.ts:128-129 (prix réalisés STH/LTH déjà chargés)
- packages/indicators/src/registry.ts:193,201,202 et packages/indicators/src/derivatives/balancedPrice.ts:1-25 (realizedPrice, cvdd, balancedPrice déjà en overlay)
- apps/web/src/chart/volumeProfile.ts:60 (computeVolumeProfile)
- apps/web/src/chart/niveaux/composite.ts:24-31 (FABRIQUES : 4 sources, aucune on-chain)

**Redondance.** Partielle. Les lignes de niveau proposées sont proches de l'existant : prix réalisé global (indicateur realizedPrice, registry.ts:193), prix réalisés STH et LTH (bgeometrics.ts:128-129), balancedPrice et cvdd (registry.ts:201-202). Le True Market Mean est un prix réalisé « actif » : il faut mesurer son écart et sa corrélation avec le prix réalisé STH avant de l'ajouter. S'il reste à ±5 % la plupart du temps, il n'apporte rien. Le prix cointime et le prix « vaulted » sont des planchers de cycle, souvent très loin du prix : sans utilité pour un horizon swing 4h, ils doublonnent balancedPrice et cvdd. Seule l'URPD est vraiment nouvelle (grep urpd|cointime|true.?market|vaulted : aucun résultat dans le dépôt). Elle recoupe toutefois le VPVR (volumeProfile.ts:60) : une pièce bouge quand elle s'échange, donc l'URPD ressemble à un profil de volume dont les pièces redéplacées sont réaffectées. Vérification à faire : corrélation de rang URPD/VPVR par tranche sur 1 à 3 ans.

**Pièges.** (1) Données UTXO non ajustées par entité (urpd.md) : une consolidation interne d'exchange ou de dépositaire d'ETF remet le « prix du dernier mouvement » au prix du jour. Cela crée de faux amas « achetés récemment » et fait passer des LTH en STH. Phénomène connu chez Glassnode, d'où ses métriques ajustées par entité (de mémoire, non vérifié). C'est le piège principal pour lire des supports. (2) Point-in-time : l'outil n'affiche que l'URPD courante. Tester la réaction aux amas avec cette URPD revient à regarder dans le futur (les amas se forment là où le prix a stagné). Il faut l'URPD à la hauteur de bloc de chaque date de test ; c'est faisable si n est bien une hauteur, ce qui reste non vérifié. (3) Révision faible : seule une fenêtre de réorganisation de 6 blocs est mentionnée, donc pas de repaint notable. La source de prix utilisée par BRK pour valoriser les UTXO n'est pas vérifiée. (4) Le seuil STH/LTH de BRK n'est pas vérifié (la doc cite des seuils de 120, 150 et 180 j). La comparaison avec les STH/LTH de BGeometrics doit se faire à définition égale. (5) Couverture BTC seulement : rien pour les alts tradées. (6) Une seule plateforme, gratuite, sans engagement de disponibilité ni CGU publiées pour l'instance hébergée : l'affichage sur le site public est bloqué tant que support@bitview.space n'a pas répondu par écrit. (7) Sur-ajustement : 3 cohortes × 3 pondérations × largeur de tranche × seuil d'amas font plus de 20 variantes ; sans variante primaire pré-déclarée, une variante « marchera » par hasard. (8) Le True Market Mean ne croise le prix qu'une poignée de fois par cycle : l'étude d'évènements à 30 et 90 j manque de puissance et ne peut être que descriptive. (9) Recherche web épuisée : CGU, quotas et noms des séries cointime restent non vérifiés.

**Protocole de validation.** Avant toute surface : sonde unique pour fixer le sens de n (hauteur de bloc), vérifier que la somme de l'URPD égale l'offre à ±0,5 %, et confronter le True Market Mean à une source tierce sur 5 dates. Manifeste figé (hash) au format AXIS (scripts/axis/manifeste-*.json) avec une seule variante primaire : cohorte all, poids none, tranches de 1 % du prix, amas = tranches au-dessus du 80e centile de l'offre dans ±20 % du prix. Les autres variantes sont descriptives. Données : URPD point-in-time hebdomadaire reconstruite à la hauteur de chaque date. Période d'exploration 2018-2022 ; test unique sur 2023 au 2026-10 jamais regardée, puis contrôle prospectif après la date de gel. Critère : taux de réaction (rebond d'au moins k·ATR avant une traversée de k·ATR, protocole de SUG-5) des amas contre trois références appariées en distance au prix : niveaux aléatoires, nœuds VPVR de même fenêtre, nombres ronds. IC par bootstrap par blocs (semaines chevauchantes). Les « poches vides » se testent par le nombre de bougies 4h pour traverser une tranche à faible offre contre une tranche VPVR appariée. Verdict pré-déclaré publié quel qu'il soit ; la mention « zone » n'apparaît qu'en cas de verdict favorable. True Market Mean : étude d'évènements descriptive seulement, effectif affiché.

**Preuve d'intérêt (idéation).** Le site BitcoinURPD.com (dépôt RenshuBTC/URPD-History, mis à jour le 2026-11-06) affiche l'URPD tirée de BRK (vérifié par recherche de code GitHub). Cadre cointime (ARK Invest et Glassnode, 2023), cité de mémoire, non vérifié. Aucune étude du pouvoir de réaction des amas URPD trouvée : mesure obligatoire.

**Mesure de succès.** Somme de l'URPD = offre en circulation à ±0,5 % ; True Market Mean comparé à une source tierce sur 5 dates ; taux de réaction des amas URPD contre 1 000 niveaux aléatoires (protocole de SUG-5), publié quel qu'il soit ; event study de la première clôture 1d sous ou au-dessus du True Market Mean à 30 et 90 j, par moitiés.

**Fichiers à toucher.**

- apps/web/src/chart/niveauxOverlays.ts
- apps/web/src/chart/niveaux/composite.ts
- apps/web/src/chart/niveaux/prixOnchain.ts (nouveau, + test)
- apps/web/src/store/persist.ts
- apps/web/src/data/onchain/bitviewUrpd.ts (nouveau, lot B, + test)
- apps/web/src/chart/urpdProfile.ts (nouveau contrôleur canvas, lot B)
- apps/web/src/chart/ChartInstance.tsx (lot B)
- apps/web/src/store/workspaces.ts (lot B, bascule persistée)
- vercel.json (connect-src, lot B si appel direct)
- docs/csp-vercel.md (lot B)
- shared/extapi-hosts.ts (lot B si proxy)
- BUILD-CONTRACT.md (exception fournisseur et G100)

**Avis des juges.**

- valeur (3) : Le lot A recoupe SUG-25 et y ajoute la TMM dérivée de l'AVIV. Le lot B, URPD (amas et poches d'offre on-chain sur l'axe des prix), est la seule idée on-chain qui fournit des niveaux de prix nouveaux. Mais les UTXO ne sont pas ajustés par entité, et la source Bitview (CGU, pérennité) n'est pas vérifiée.
- cout-risque (2) : Lot A bon marché (chemin aviv déjà autorisé, api/_policy.ts:319), mais TMM dérivée sous embargo J-7 et formule à contrôler contre une source tierce. Le cœur URPD (lot B) repose sur Bitview : fournisseur nouveau, instable, CGU et quotas inconnus. URPD non ajusté par entité : faux amas après les consolidations d'exchanges ou d'ETF.
- coherence (3) : Le lot A doublonne SUG-25 (motif prixRevient), avec en plus une TMM dérivée de l'aux aviv existant. Le lot B ouvre un nouveau fournisseur, Bitview, et un canvas URPD dédié : surface et fournisseur nouveaux.

### 34. SUG-9 — Figures chartistes détectées objectivement (lissage à noyau de Lo, Mamaysky et Wang) et mesurées avant tout affichage

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **L** (initial L) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : AT-8

**Question de trading.** Le tête-épaules, double sommet, triangle ou rectangle que je crois voir existe-t-il objectivement, et ce type de figure a-t-il modifié les rendements à 3, 10 et 20 bougies sur les cryptos ?

**Proposition retenue après vérification.** Étude figée hors interface, en 4h, de quatre familles LMW : tête-épaules et son inverse, double sommet et double creux, triangles, rectangles. Le détecteur est en TS pur et causal (régression à noyau sur fenêtre glissante, extrema ramenés aux vrais plus hauts et plus bas). Le manifeste fixe un découpage exploration/test daté. Le nul est fait de décalages circulaires communs avec Bonferroni sur figures × horizons (harnais de valider-axis-flux.ts, sans KS), plus le contrôle par préfixe. Les figures de chandeliers sont écartées. Si au moins une famille passe, une seule définition annotée, limitée aux familles qui passent et dotée d'une infobulle de statistiques, est proposée sous exception G100. Sinon, seul le rapport subsiste.

**Proposition initiale.** Détecteur TS pur causal : régression de Nadaraya-Watson sur fenêtre glissante de 35-60 bougies, extrema ramenés aux vrais plus hauts/bas, règles LMW sur 5 extrema (HS/IHS, BTOP/BBOT, TTOP/TBOT, RTOP/RBOT, DTOP/DBOT), déclaration à la complétion + d bougies. Étape 1 hors interface : étude figée (manifeste, données jamais vues), test KS contre l'inconditionnel. Étape 2 : seules les figures qui passent deviennent une définition annotée ; les autres restent dans le rapport. Figures de chandeliers seulement sous la même mesure.

**Ce qui existe déjà.** Aucune détection de figure chartiste ni de chandelier dans le dépôt. Le seul « avalement » est le pilier de rejet interne à AXIS (packages/indicators/src/strategy/stratAxis.ts:960 et :1119-1121). Des briques d'extrema existent déjà. detecterPivots, causal, sans pivot sur les « droite » dernières barres (packages/indicators/src/utils-divergence.ts:26). Les pivots causaux de zonesSrAxis (packages/indicators/src/strategy/stratAxisSr.ts:14-16 et :137). zigzag, qui garde un pivot provisoire en fin de série (support_resistance/zigzag.ts:17-18), et pivotHighLow, qui place la valeur à l'index du pivot alors qu'il n'est connu que « bars » bougies plus tard (support_resistance/pivotHighLow.ts:12-15) : ces deux-là ne conviennent pas à une étude causale. Le rendu ne demande rien de neuf : segments, marqueurs, labels et rubans existent (packages/types/src/index.ts:345-350). Harnais réutilisable : etudeEvenements/finaliserEtude (apps/web/src/data/validationSignaux.ts:197-235), décalages circulaires communs et Bonferroni (scripts/valider-axis-ut.ts:21, :791), contrôle de causalité par préfixe (scripts/valider-axis-flux.ts:348-354). Aucun test de Kolmogorov-Smirnov dans le dépôt (grep).

**Réutilise.** etudeEvenements/finaliserEtude, scripts/valider-hors-echantillon.ts, contrôle de causalité par préfixe.

**Point d'intégration.** Étape 1, hors interface : module pur packages/indicators/src/utils-figures.ts (régression de Nadaraya-Watson sur fenêtre glissante, ou detecterPivots, puis règles LMW sur 5 extrema), appelé par un runner bun scripts/valider-figures.ts avec un manifeste haché avant téléchargement, calqué sur scripts/valider-axis-flux.ts. Étape 2, seulement si l'étape 1 passe : une seule IndicatorDef overlay qui rend annotations.segments et annotations.labels, enregistrée dans packages/indicators/src/registry.ts. Pas d'aux, pas de proxy, pas de daemon.

**Sources.**

- Bougies OHLCV des adaptateurs (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Période postérieure au 2026-10-10 ou autre univers (données AXIS consommées, stratAxis.ts:197-198).

**Contrat.** L'étape 1 est un script hors interface : aucune exception. L'étape 2 ajoute une définition au catalogue, ce qui exige une nécessité démontrée (BUILD-CONTRACT.md:82), et une surface nouvelle, ce qui exige une exception G100 inscrite au contrat (BUILD-CONTRACT.md:71, sur le modèle de :1847 et :2062). Pas de nouveau fournisseur, pas de clé, @axiom/types inchangé. Budget initial : le registre est importé par le chemin du graphe (apps/web/src/chart/indicators.ts:33), donc la définition compte dans le plafond de 360 000 o gzip (scripts/verifier-budget-build.mjs:8-9) ; la marge n'a pas été mesurée (lecture seule). Données : le marquage « consommées » de stratAxis.ts:197-198 ne vise que les variantes AXIS. Pour une hypothèse nouvelle, un découpage exploration/test daté et figé dans le manifeste suffit. La période postérieure au 2026-10-10 seule fait environ 160 bougies 4h par actif : c'est trop court.

**Risques.** (1) Beaucoup de degrés de liberté : fenêtre 35-60, d, facteur 0,3 sur la largeur de bande de LMW, tolérances de 1,5 % et 10 figures × 3 horizons. Sans correction, le risque de faux positif est élevé. (2) Le KS de LMW suppose des observations indépendantes ; c'est faux avec des rendements à 10 et 20 bougies qui se chevauchent et des figures groupées. (3) Les figures sont rares en 4h, d'où un n faible par cellule et un verdict « non concluant » probable. (4) La déclaration à complétion + d bougies retarde l'affichage, et les seuils au bord de la règle feront apparaître et disparaître des figures d'une bougie à l'autre. (5) Calcul en O(n·w²), environ 5 M d'opérations sur 1 500 bougies, refait à chaque tick si la définition est affichée. (6) Afficher des figures non mesurées nourrit l'apophénie : c'est précisément ce que l'étape 1 doit empêcher. Littérature (LMW 2000, Savin et al. 2007, Marshall et al. 2006) non revérifiée en ligne dans cette passe (budget de recherche épuisé).

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. À traiter comme une étude, pas comme un outil. L'étude répond de façon mesurée à une lecture très répandue chez le trader discrétionnaire. Issue la plus probable : rien au registre, puisque les actions US montrent de l'information sans rentabilité et que les chandeliers ne montrent rien. Ne construire l'overlay qu'après réussite. Les références externes n'ont pas été revérifiées : quota WebSearch épuisé dans ce tour.

**Références.**

- Lo, Mamaysky, Wang (2000), Journal of Finance 55(4) : lissage à noyau, 10 figures, tests KS. Distributions conditionnelles différentes, surtout sur le NASDAQ, mais aucune rentabilité démontrée. Connu, non revérifié en ligne dans cette passe (quota WebSearch épuisé).
- Savin, Weller, Zvingelis (2007), Journal of Financial Econometrics : pouvoir prédictif modeste du tête-épaules sur les actions US. Non revérifié dans cette passe.
- Marshall, Young, Rose (2006), Journal of Banking & Finance : chandeliers sans valeur sur le DJIA. Non revérifié dans cette passe.
- Étude des figures LMW sur les cryptos : non vérifié (aucune recherche possible).
- packages/indicators/src/support_resistance/pivotHighLow.ts:11-15 : pivot porté rétroactivement à l'indice de l'extrême, confirmé `bars` bougies plus tard.
- packages/indicators/src/support_resistance/zigzag.ts:17-21 : dernier pivot provisoire.
- apps/web/src/data/validationSignaux.ts:187-220 : etudeEvenements compare à la dérive inconditionnelle et ne teste pas de distribution.
- scripts/axis/manifeste-v5-2026-10-10.json:25 : 329 bases déjà lues et 720 bases Binance exclues, indépendance en temps nulle.
- scripts/axis/manifeste-ut-2026-10-08.json (pMax = 0,05/13) : précédent de correction pour tests multiples.
- packages/indicators/src/strategy/stratAxis.ts:960, :997 : seuls rejet et avalement existent, comme piliers non mesurés d'AXIS.

**Redondance.** Aucune figure chartiste ni de chandelier au registre. Le grep ne trouve que rejet et avalement dans stratAxis.ts:960-1229. Des briques voisines existent : zigzag, pivotHighLow, fractals (billwilliams/fractals.ts) et utils-divergence (pivots confirmés à droite). Le repérage des extrema LMW recouvrirait en partie pivotHighLow et zigzag ; il faut reprendre leur convention de confirmation plutôt qu'un troisième repère de swings. Pas de doublon fonctionnel.

**Pièges.** (1) Repaint et biais rétrospectif. Le lissage de Nadaraya-Watson est bilatéral dans la fenêtre, donc les extrema proches du bord droit bougent à chaque nouvelle bougie. La figure doit être datée et affichée à la bougie de déclaration (complétion + d), jamais tracée après coup à la manière des marqueurs de pivotHighLow.ts:11-15, et jamais montrée « en formation ». (2) Degrés de liberté : fenêtre de 35 à 60 bougies, bande à 0,3 × h_CV (facteur choisi à l'œil par LMW), d, tolérances de 1,5 %, 10 figures × 3 horizons × unités. Cela fait plus de 30 tests ; sans gel préalable, c'est du sur-ajustement garanti. (3) Le KS n'est pas directionnel et suppose des tirages indépendants. Les fenêtres glissantes détectent plusieurs fois la même figure (grappes). Une figure peut aussi caractériser un régime de volatilité : une différence d'échelle n'est pas un sens. (4) Données : la période postérieure au 2026-10-10 compte environ 160 bougies 4h par actif fin octobre, soit presque aucune figure. Les univers Binance et KuCoin ont été lus par AXIS. Pour une hypothèse nouvelle, les relire reste défendable si le détecteur est figé avant lecture, mais l'indépendance en temps est nulle. (5) Biais du survivant : univers des paires au statut TRADING aujourd'hui. (6) Effort L pour un a priori faible.

**Protocole de validation.** (a) Tests unitaires sur des figures synthétiques injectées. Contrôle par préfixe : la détection à t est identique avec les seules données ≤ t. (b) Manifeste figé avant toute lecture : paramètres LMW d'origine, 10 figures, sens attendu déclaré pour chacune, horizons 3, 10 et 20 bougies, unités 4h et 1d. Univers défini par une règle, par exemple les 42 paires antérieures à 2020 de manifeste-ut, jamais testées pour cette hypothèse, avec un statutIndependance honnête. Entrée à l'open de complétion + d + 1, rendements normalisés par la volatilité ex ante, figures dédupliquées. (c) Statistique : rendement signé moyen, nul par décalages circulaires communs (méthode de rapport-flux), Bonferroni 0,05/30. Le KS reste descriptif. (d) Critères : n ≥ 100 par figure regroupée, même signe dans les deux moitiés et dans plus de la moitié des cellules. Sinon, rapport sans entrée au registre. (e) Confirmation prospective à 6 mois avant tout overlay.

**Preuve d'intérêt (idéation).** Lo, Mamaysky, Wang (JF 2000) : information incrémentale de plusieurs figures sur actions US ; Savin, Weller, Zvingelis (JFEc 2007) : tête-épaules prédictif mais peu rentable seul ; Marshall, Young, Rose (JBF 2006) : chandeliers sans valeur. D'où « mesurer avant d'afficher ».

**Mesure de succès.** Rapport figé : n, rendements signés 3/10/20 bougies, p KS corrigée du nombre de figures, même signe dans les deux moitiés ; contrôle par préfixe sans écart ; si rien ne passe, rien au registre.

**Fichiers à toucher.**

- packages/indicators/src/utils-figures.ts (nouveau)
- packages/indicators/src/utils-figures.test.ts (nouveau)
- scripts/valider-figures.ts (nouveau)
- scripts/figures/manifeste-AAAA-MM-JJ.json et rapport (nouveaux)
- Étape 2 conditionnelle : packages/indicators/src/support_resistance/figuresChartistes.ts et son test
- packages/indicators/src/registry.ts et packages/indicators/src/registry.test.ts:21 (220 → 221)
- BUILD-CONTRACT.md (exception et compteur)

**Avis des juges.**

- valeur (2) : L'étude honnête (Lo, Mamaysky et Wang, avec nul circulaire et Bonferroni) est le bon chemin pour trancher un mythe. Mais l'effort est L, les figures sont rares en 4h et un résultat nul est probable. Elle a de la valeur seulement comme verdict ; l'outil graphique n'apparaîtrait qu'en cas de succès.
- cout-risque (3) : Effort L. L'étape 1 est un script hors interface, sans risque d'affichage, et l'affichage n'arrive que si une famille passe : sûr par construction. Coût de développement et de maintenance élevé : un détecteur à noyau à nombreux degrés de liberté. Le lissage bilatéral repeint près du bord : la datation à la déclaration est obligatoire.
- coherence (3) : L'étape 1 en script suit le protocole scripts/axis. L'éventuel def annoté (détecteur LMW, nombreux réglages, effort L) reste lourd et entre dans le chunk initial (chart/indicators.ts:33).

### 35. SUG-13 — Profondeur historique du carnet perp Binance depuis les archives bookDepth : liquidité à ±1-5 %, déséquilibre et ratio volume/profondeur

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : volume et flux · origines : VOL-9

**Question de trading.** Le carnet est-il anormalement mince (risque de mèche ou de cascade, typique des week-ends) et un côté est-il nettement mieux garni à ±2-5 % ?

**Proposition retenue après vérification.** D'abord l'étude : un script Bun hors appli lit 1 an d'archives bookDepth (BTC/ETH perp), calcule la profondeur à ±1 % et le déséquilibre à ±2 % agrégés en 4h, puis teste le Spearman avec la volatilité réalisée suivante (bootstrap par blocs). Seulement si l'effet est significatif : un module daemon à la demande (modèle replay.ts + zip.ts) et, dans DOM, une ligne « profondeur ±1 % perp : percentile p sur 90 j » calculée sur un instantané REST fapi/v1/depth avec profondeurAPct, jamais raccordée au carnet spot live. Au premier lot : ni décompression navigateur, ni AuxSeriesId, ni indicateur.

**Proposition initiale.** Téléchargement à la demande de data.binance.vision/data/futures/um/daily/bookDepth/<SYM>/ (ZIP CSV), décompression navigateur, séries de profondeur bid/ask par tranche de distance. Indicateur profondeurCarnet : profondeur ±1 % et z-score, déséquilibre à ±2 %, ratio volume/profondeur. J-0 complété par la heatmap BOOK live tant que l'onglet est ouvert. Schéma (≈ 12 niveaux de ±0,2 % à ±5 % toutes les ~30 s selon un tiers) à confirmer sur un fichier réel avant de coder.

**Ce qui existe déjà.** Les calculs existent en live, mais seulement sur le spot et sans historique : profondeurAPct (USD par côté à ±pct, apps/web/src/data/depthExecution.ts:79) et desequilibre (N niveaux, :104), utilisés par DOM (apps/web/src/components/DomWindow.tsx:38, :413). La heatmap BOOK est un FIFO de 1 800 colonnes (≈ 30 min) à 20 niveaux par côté (apps/web/src/chart/depthHeat.ts:41-55), alimenté par le carnet spot api.binance.com / stream.binance.com (apps/web/src/data/depth.ts:225-226). Côté perp, il n'y a qu'un instantané REST fapi/v1/depth limit=100 pour le carry (apps/web/src/data/fundingCarryQuotes.ts:80). Sur data.binance.vision, seul le funding mensuel BTC/ETH est autorisé (shared/extapi-hosts.ts:66-68 ; BUILD-CONTRACT.md:149-151). grep bookDepth : rien.

**Réutilise.** Décompression ZIP sans dépendance (apps/web/src/data/backtestFunding.ts:220), proxy /extapi (MIME zip accepté, api/_policy.ts:112-113), alignement LOCF, rendu depthHeat.

**Point d'intégration.** Mesurer d'abord hors appli, avec un script Bun dans scripts/ sur le modèle de scripts/explorer-axis-*.ts : il télécharge directement les ZIP, comme le daemon, qui ne passe pas par la liste blanche (apps/daemon/src/replay.ts:35). Si la mesure est concluante : module daemon à la demande calqué sur replay.ts (SQLite), avec extraction par apps/daemon/src/zip.ts plutôt que `unzip -p`, et agrégation en 4h/1d. Lecture J-0 par un instantané REST fapi/v1/depth?limit=1000 passé à profondeurAPct, puis affichage d'un percentile dans DOM. Sur Vercel seulement : regex bornée dans extapiCheminAutorise (shared/extapi-hosts.ts:66-68), fonction lue par api/_policy.ts:166, apps/daemon/src/proxy.ts:689 et apps/web/vite.config.ts:67. Effort M pour ce périmètre ; L avec la décompression navigateur, une série aux et un indicateur comme proposé.

**Sources.**

- data.binance.vision futures/um/daily/bookDepth (nouvelle ; gratuit sans clé (hôte autorisé, chemin à ouvrir) ; vérifiée en ligne par l'idéation : oui) : Existence attestée par le forum développeurs Binance ; schéma, fréquence et profondeur d'historique non vérifiés sur source officielle ; J-1 au mieux.

**Contrat.** Pas de nouveau fournisseur : l'hôte est déjà autorisé. Il faut en revanche amender la clause du 9 septembre (BUILD-CONTRACT.md:122, :149-151, « seulement les chemins précis » du funding) pour toute lecture par le proxy. Pas d'enregistreur : ce sont des dumps officiels à la demande (BUILD-CONTRACT.md:88). Une ligne nouvelle dans DOM est une surface : exception G100 (BUILD-CONTRACT.md:71). Une série aux demande un nouvel AuxSeriesId dans @axiom/types (packages/types/src/index.ts:186-233), contraire à BUILD-CONTRACT.md:81. Un indicateur étend le catalogue (BUILD-CONTRACT.md:82). Budget initial intact si le module est chargé à la demande. Licence CC BY-NC-SA, schéma et cadence de bookDepth : non revérifiés ici (budget de recherche web épuisé).

**Risques.** (1) Mélange spot et perp : la heatmap BOOK est spot, l'archive est perp. Les raccorder en « J-0 » fausserait le percentile. (2) L'archive est J-1 et ne dit rien de « maintenant » sans instantané REST perp. Un limit=1000 peut ne pas couvrir ±1 %, et profondeurAPct n'extrapole pas. (3) Non vérifiés : la définition de la colonne depth (cumulée depuis le mid ? quantité ou notionnel ?), la cadence et la date de début. À contrôler sur un fichier réel. (4) Volume : 365 fichiers par symbole et par an. Dans le navigateur, les bornes de backtestFunding.ts:8-9 (2 Mo de zip, 8 Mo de CSV) ne conviennent pas, et chaque fichier coûte une invocation Vercel. L'accès à data.binance.vision depuis les IP Vercel n'est pas vérifié (fapi y répond 451, apps/web/src/data/extapi.ts:5-6). (5) Jours manquants dans l'archive. (6) Un carnet mince n'indique pas de direction : seulement un risque de volatilité.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La profondeur à ±1 % comme régime de fragilité (contexte de risque, taille de position) est défendable, et la donnée existe depuis le 2023-01-01. À écarter : le déséquilibre à ±2 % (aucune preuve au-delà de quelques secondes) et le recollage avec le carnet spot live. Calcul dans le daemon uniquement, vu le volume (environ 560 Ko par jour et par symbole). Le critère de succès doit passer d'un Spearman brut à un gain hors échantillon sur le HAR-RV. Sinon la mesure redit l'ATR.

**Références.**

- docs/research/02-indicateurs-edge-crypto.md:106-113 : Cont, Kukanov et Stoikov 2014, impact de prix ∝ 1/profondeur. Effet académique établi, mais à l'horizon de quelques secondes.
- packages/indicators/src/volume/amihudIlliq.ts:1-20 : Amihud 2002, illiquidité reconstruite à partir des bougies (déjà dans AXIOM).
- Listing S3 officiel de data.binance.vision (WebFetch, 2026-11-06) : premier fichier BTCUSDT bookDepth le 2023-01-01. Environ 560 Ko compressés par jour et par symbole, publiés à J+1 vers 07-08 h UTC. Aucun agrégat mensuel (futures/um/monthly ne contient ni bookDepth ni metrics).
- Kaiko : la profondeur à 1 % comme mesure standard et le lien entre week-end et 1er février 2026 sont cités par l'idée et non revérifiés dans cette passe. Budget WebSearch épuisé ; hyperliquid.gitbook.io, api.coinalyze.net et www.bis.org sont hors du réseau autorisé de la session.
- Corsi 2009 (modèle HAR-RV) : référence méthodologique pour la mesure proposée, connue mais non revérifiée en ligne.

**Redondance.** Partielle. Plusieurs mesures de liquidité calculées sur les bougies existent déjà : amihudIlliq, kyleLambda (packages/indicators/src/volume/kyleLambda.ts:34), corwinSchultz (volatility/corwinSchultz.ts) et relativeVolume/volumeZScore. La heatmap BOOK n'est qu'un instantané spot de 30 min (apps/web/src/chart/depthHeat.ts:37-55). La profondeur observée en historique serait nouvelle. Le ratio volume/profondeur recoupe toutefois fortement Amihud et le RVOL. Le déséquilibre à ±2 % n'a aucun équivalent, mais aucune preuve ne le soutient à l'horizon swing.

**Pièges.** (1) Effet de regroupement de la volatilité. La profondeur baisse quand la volatilité monte, parce que les teneurs de marché retirent leurs ordres. Un Spearman entre le percentile de profondeur et la volatilité réalisée à 24 h sortira presque sûrement significatif sans rien apporter. Le critère de succès proposé est donc mal posé : il faut l'apport au-delà de la volatilité réalisée récente. (2) Saisonnalité forte (heure, week-end) : le z-score doit être désaisonnalisé, sur le modèle de rvolSeasonal. (3) Mélange de marchés : à J-0, la heatmap live porte sur le carnet SPOT, alors que l'archive porte sur le PERP. Les recoller fabrique une série hétérogène. (4) Latence J+1 : outil de contexte, inutilisable pour la journée en cours. (5) Une seule plateforme (Binance perp). Une profondeur affichée peut être retirée (spoofing). Au-delà de ±1 %, le déséquilibre est surtout du bruit. (6) Volume : 1 an × 10 perps ≈ 2 Go de ZIP. Irréaliste dans le navigateur via le proxy Vercel (quota du propriétaire) : réservé au daemon, avec stockage des seules séries réduites. (7) Biais du survivant si l'on prend les 10 premiers perps d'aujourd'hui sur 2023-2026. (8) Le schéma (colonnes, nombre de tranches, cadence) n'est pas vérifié : je n'ai pas pu ouvrir le fichier.

**Protocole de validation.** (a) D'abord ouvrir un vrai fichier et en figer le schéma. (b) Régression HAR-RV : RV(t+1) = RV jour + RV semaine + RV mois + indicatrices jour/heure + log(profondeur ±1 %). Spécification et seuils figés (SHA-256) sur BTC/ETH 2023-2024. Test sur 2025-2026 et sur des alts jamais vues, avec une perte QLIKE et un test de Diebold-Mariano contre le HAR seul. L'apport est validé seulement si la perte baisse hors échantillon. (c) Étude d'évènements sur les mèches de plus de 3 ATR 4h selon le quintile de profondeur, avec nul circulaire comme scripts/axis/rapport-flux-2026-10-08.md:21. (d) Déséquilibre à ±2 % : rendement signé à 6 et 12 bougies 4h contre décalage circulaire, avec une seule spécification figée, sinon abandon.

**Preuve d'intérêt (idéation).** Kaiko fait de la profondeur à 1 % la mesure standard et relie la profondeur mince du week-end à la chute du 1er février 2026 (couverture secondaire, vérifiée). Aucune étude chiffrée trouvée : mesure obligatoire.

**Mesure de succès.** Spearman négatif et significatif (bootstrap par blocs) entre percentile de profondeur ±1 % et vol réalisée 24 h suivante sur 1 an BTC/ETH ; ≥ 95 % des jours couverts sur 1 an pour les 10 premiers perps.

**Fichiers à toucher.**

- scripts/explorer-profondeur-carnet.ts (nouveau)
- apps/daemon/src/bookDepthArchive.ts (nouveau)
- apps/daemon/src/index.ts
- apps/web/src/data/bookDepthArchive.ts (nouveau, client daemon)
- apps/web/src/components/DomWindow.tsx
- shared/extapi-hosts.ts (seulement si lecture Vercel)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : La profondeur du carnet baisse mécaniquement quand la volatilité monte : un Spearman significatif n'apprendra presque rien. La version actuelle ne fournit ni lecture instantanée perp fiable ni lien avec la décision swing. À garder comme étude seulement.
- cout-risque (3) : Archives officielles gratuites sur un hôte autorisé, mais clause du 9 septembre à amender (extapiCheminAutorise ne borne aujourd'hui que fundingRate BTC/ETH, shared/extapi-hosts.ts:62-64). La sémantique de la colonne depth n'est pas vérifiée. Le critère de succès risque d'être trivialement vrai (profondeur et volatilité co-mouvantes). Le mélange perp/spot est trompeur s'il est raccordé à BOOK. Étude d'abord : coût contenu.
- coherence (3) : Le script d'étude sur dumps réutilise le patron replay/zip du daemon, ce qui est cohérent. La suite, en revanche, demande un module daemon, une ligne DOM, l'amendement de la clause des chemins data.binance.vision et un instantané fapi distinct du carnet spot.

### 36. SUG-19 — Positionnement de la foule sur plusieurs places : L/S comptes Bybit depuis 2020 et OKX, ratio de prêt sur marge OKX, compteur de concordance

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial S) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : dérivés · origines : SRC-2, SRC-3, FLX-4

**Question de trading.** La foule est-elle trop longue seulement sur Binance, ou aussi sur Bybit et OKX, et le levier spot sur marge gonfle-t-il avant un sommet local ?

**Proposition retenue après vérification.** Ligne « Foule par place » dans DES : L/S comptes Binance (fapi), Bybit (/v5/market/account-ratio) et OKX (rubik long-short-account-ratio), chacun en percentile 90 j, côte à côte, avec la place et la méthode affichées. Signal « foule unanime » dans data/signaux.ts pour le symbole courant seulement (≥ 2 places au-delà de p90/p10), avec fiabilité « bruité ». Retirer le ratio de prêt sur marge OKX (marché spot). Pas de paramètre place, ni de changement de graphe, avant une event study hors app (script) sur l'historique Bybit depuis 2020, qui décidera d'une éventuelle def lsAccountBybit.

**Proposition initiale.** Aux lsAccountBybit (/v5/market/account-ratio, linear, 1h/4h/1d, limit 500, pagination jusqu'à 2020) et lsAccountOkx (rubik long-short-account-ratio) ; paramètre « place » sur lsAccountRatio plutôt qu'un nouvel indicateur. Aux okxMarginLoanRatio en z-score dans DES. Ligne « Foule par place » en percentiles 90 j côte à côte et signal EQS « foule unanime » quand 2-3 places dépassent p90 (ou p10).

**Ce qui existe déjà.** Le L/S Bybit existe déjà via Coinalyze dans DES quand Bybit est la place affichée : drapeau has_long_short_ratio_data (apps/web/src/data/marchesPerp.ts:55-56, :120), choix de la place complémentaire (apps/web/src/components/DerivativesWindow.tsx:321, :447-452, :776-800), mais sparkline de 2 h seulement (:95, :100). Le sentiment Binance fapi est affiché à part (:515). L'aux Binance couvre 500 h environ (apps/web/src/data/positioning.ts:24-25). Coinalyze ne publie pas de L/S pour OKX ni HL (DerivativesWindow.tsx:776-777). grep account-ratio|rubik|loan-ratio : rien. Le signal top traders contre foule existe (apps/web/src/data/signaux.ts:294).

**Réutilise.** lsAccountRatio (packages/indicators/src/derivatives/lsAccountRatio.ts:14), netPositioningIndex, aux L/S (apps/web/src/chart/auxProvider.ts:551-556), signal top traders contre foule (apps/web/src/data/signaux.ts:295).

**Point d'intégration.** Appels directs depuis le navigateur. api.bybit.com et www.okx.com sont dans le connect-src de vercel.json et déjà appelés en direct pour le funding (apps/web/src/data/fundingHistory.ts:127-128), donc le CORS de ces hôtes est déjà établi ; celui des routes account-ratio et rubik n'est pas vérifié. Un « paramètre place sur lsAccountRatio » est impossible sans modifier @axiom/types : IndicatorDef.aux est une liste statique (packages/types/src/index.ts:385), et auxFacultatives ne peut pas porter une sortie requise (:386-393). Il faut donc des defs séparées, ou garder la lecture hors graphe. « Signal EQS » : EQS est le screener multi-symboles (apps/web/src/store/windowManager.ts:90), donc N symboles × 3 places de requêtes. Le signal « foule unanime » se place plutôt dans data/signaux.ts (patron signalPositionnement), pour le symbole courant. La ligne « Foule par place » va dans DES, en percentiles 90 j côte à côte.

**Sources.**

- Bybit V5 /v5/market/account-ratio (nouvelle ; gratuit sans clé (api.bybit.com en connect-src) ; vérifiée en ligne par l'idéation : oui) : Vérifié dans la doc officielle : périodes 5min à 1d, limit ≤ 500, début 20/07/2020, comptage par comptes ; CORS et CGU non vérifiés.
- OKX V5 Rubik margin loan-ratio et long-short-account-ratio (nouvelle ; gratuit sans clé (www.okx.com en connect-src) ; vérifiée en ligne par l'idéation : oui) : Chemins vérifiés dans le SDK officiel ; profondeur, quotas et CORS non vérifiés.

**Contrat.** Aucun nouveau fournisseur : Bybit et OKX font partie des places déjà intégrées. Aucune clé. Exception G100 nécessaire (ligne DES et signal). Pas d'agrégat multi-places, seulement des percentiles par place côte à côte (BUILD-CONTRACT.md:1396). Les niveaux ne sont pas comparables d'une place à l'autre (docs/research/02-indicateurs-edge-crypto.md:190). Une version graphique ajoute AuxSeriesId et des defs (BUILD-CONTRACT.md:81-82) et doit suivre le correctif d'alignement d'ouverture des L/S (docs/revue-2026-11-06.md:891-893). Aucun impact sur le budget initial si tout reste dans DES (chunk paresseux).

**Risques.** Méthodes de comptage différentes selon la place (comptes contre parts d'acheteurs). Le ratio de prêt sur marge OKX concerne la marge SPOT par devise : c'est un autre marché, au signal douteux pour le perp. Profondeur et quotas des endpoints rubik d'OKX non vérifiés (recherche web épuisée dans cette passe) ; l'historique Bybit depuis 2020-07 n'a pas été revérifié ici. Les quotas restent ceux de l'IP de chaque visiteur (appel direct), donc pas de coût serveur. Le signal contrarien est faible isolément (doc 02:190) : risque de faux signaux sans event study. Le seuil p90 sur 90 j varie selon le régime.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. La seule partie à retenir maintenant est l'aux lsAccountBybit avec historique depuis 2020, comme donnée de recherche permettant de mesurer enfin l'hypothèse contrarienne (aujourd'hui intestable sur 20 j Binance). Le ratio de prêt sur marge OKX (historique court, lecture interprétative) et le compteur « foule unanime » sont des gadgets tant que l'étape 0 et l'étude d'évènements n'ont pas conclu. La ligne « Foule par place » de DES fait doublon avec le sélecteur de place existant. Faits externes non revérifiés dans cette session : quota WebSearch épuisé.

**Références.**

- docs/research/02-indicateurs-edge-crypto.md:184-192 (L/S : signal contrarien de pratique, faible en isolé ; comptes ≠ capital ; non comparable d'une place à l'autre)
- Bybit V5 /v5/market/account-ratio (début 20/07/2020, limit 500) : vérifié selon l'idée, non revérifié ici
- OKX Rubik long-short-account-ratio et loan-ratio : chemins vérifiés selon l'idée ; profondeur historique non vérifiée (probablement courte)
- Aucune étude académique vérifiée montrant un pouvoir prédictif du L/S « comptes » multi-places : non vérifié
- apps/web/src/components/DerivativesWindow.tsx:446-451 (L/S Coinalyze de la place affichée déjà dans DES)
- apps/web/src/data/marchesPerp.ts:254-266 (marcheComplement : L/S d'une autre place si absent)
- apps/web/src/data/positioning.ts:8-9 (Binance REST : 500 points 1 h, ~20 j)
- apps/web/src/data/signaux.ts:295 (signal top traders contre foule)
- BUILD-CONTRACT.md:1396 (aucun agrégat multi-places dans DES)
- shared/extapi-hosts.ts:66-68 (chemins data.binance.vision bornés au funding)

**Redondance.** Forte en affichage. DES montre déjà le L/S « comptes » de la place choisie (Binance, Bybit, OKX ou Hyperliquid via Coinalyze, avec complément), en jauge et en sparkline. Le catalogue a déjà lsAccountRatio, lsTopTraderRatio, netPositioningIndex, netPositioningTopTrader et smartRetailSpread, plus le signal « top traders contre foule ». Les vrais ajouts : (a) une série Bybit chartable avec historique depuis 2020, qui pourrait enfin rendre testable l'hypothèse contrarienne ; (b) le ratio de prêt sur marge OKX, inédit ; (c) le compteur de concordance, inédit et non prouvé.

**Pièges.** (1) Comptes ≠ capital : une baleine compte pour un compte. Les définitions et les populations diffèrent selon la place, et la composition de la clientèle d'une place dérive avec les années (biais de survivant des places : FTX disparue). (2) Horodatage Bybit : début ou fin de période, non vérifié. Un point daté au début mais calculé à la fin donne un look-ahead d'une période dans le backtest. (3) Les ratios L/S des places sont probablement très corrélés entre eux. La « foule unanime » risque alors de n'être que Binance compté trois fois, sans information additionnelle. (4) Multiplicité : seuils p90/p10, 3 places, 2 horizons, fenêtres 90 j : fort risque de sur-ajustement. (5) La comparaison « unanime contre Binance seul » est impossible avec le Binance REST (≈ 20-30 j). Il faut un historique Binance long : Coinalyze daily de profondeur non vérifiée, ou archives data.binance.vision metrics non vérifiées, dont le chemin n'est pas en liste blanche. (6) OKX : historique Rubik court, non vérifié ; la place est inutilisable en backtest, seulement en direct. (7) Contrat : le compteur EQS est un agrégat multi-places, qui exige une exception explicite (BUILD-CONTRACT.md:1396). (8) CORS et CGU d'affichage public de Bybit et d'OKX non vérifiés.

**Protocole de validation.** Étape 0, bloquante : mesurer la corrélation des percentiles 90 j Binance et Bybit sur l'historique commun. Si elle est très élevée (par exemple ρ > 0,8, seuil à figer à l'avance), la concordance n'apporte rien et l'on s'arrête. Ensuite, manifeste figé : définitions, seuils p90/p10, horizons 3 et 7 j, sens contrarien. Développement sur Bybit et Binance de 2020-07 à 2023, test unique 2024-2026. Hypothèse nulle par décalages circulaires, évènements dégroupés, n publié pour chaque cas. Mesurer l'apport par rapport au funding z-score seul. OKX exclu de la mesure faute d'historique. Le signal EQS reste interdit tant que le verdict n'est pas favorable.

**Preuve d'intérêt (idéation).** Signal contrarien de pratique reconnue mais faible isolé (doc 02:190) ; l'apport du consensus multi-places n'est pas mesuré : objet de l'event study, rendue possible par l'historique Bybit depuis 2020.

**Mesure de succès.** BTCUSDT depuis 2020-07 en < 30 requêtes ; event study 2021-2026 à 3 et 7 j « foule unanime » contre « Binance seul », n de chaque cas.

**Fichiers à toucher.**

- apps/web/src/data/positioning.ts (fetch Bybit account-ratio, OKX rubik, pagination)
- apps/web/src/components/DerivativesWindow.tsx (ligne Foule par place)
- apps/web/src/data/signaux.ts (+ store/signaux.ts) signal foule unanime
- (option) packages/types/src/index.ts + auxProvider.ts + def lsAccountBybit si chart
- scripts/ (event study hors app)

**Avis des juges.**

- valeur (2) : Des comptes ne sont pas du capital et les méthodes diffèrent selon la place. Le signal « foule unanime » est bruité et sans preuve. Une event study préalable est nécessaire : valeur faible tant qu'elle n'est pas faite.
- cout-risque (3) : Bybit et OKX sont déjà en connect-src, sans clé. Quotas et profondeur des endpoints rubik d'OKX non vérifiés (web indisponible). Historique Bybit depuis 2020 non revérifié. Méthodes non comparables entre places : les percentiles par place côte à côte limitent la lecture fausse. Un signal « foule unanime » sans étude préalable est de fiabilité faible.
- coherence (3) : Des percentiles par place côte à côte dans DES respectent l'interdiction d'agréger. Mais les endpoints Bybit account-ratio et OKX rubik sont nouveaux (CORS et liste blanche à vérifier), et le signal ajouté à signaux.ts est bruité.

### 37. SUG-27 — Flux nets vers les plateformes BTC et ETH sur le graphe : histogramme, Σ7 j et z-score multi-cycle, avec étude d'évènement

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain BTC · origines : BTC-3, ETH-1

**Question de trading.** Pendant ce mouvement, des BTC ou ETH affluent-ils vers les plateformes (offre vendeuse) ou en sortent-ils (absorption), et le niveau est-il extrême face aux cycles passés ?

**Proposition retenue après vérification.** Pane « Flux net plateformes (labels Coin Metrics, flash) » en 1d STRICT (sorties undefined sur toute autre unité), BTC et ETH. Histogramme du flux du jour apparié au jour exact, sans report. Σ7 j. z du Σ30 sur 730 j glissants avec amorceBougies 760. Le chargeur reste à 800 j, sans « tout l'historique ». Pas de marqueurs tant qu'une étude d'évènement hors graphe, z > +2 et z < −2 à 7 et 30 j par moitiés, n'a pas donné le même signe dans les deux moitiés. Exception G100 avec types +1 et catalogue +1.

**Proposition initiale.** Aux fluxNetEx (BTC et ETH natifs, 1d) tirée du chargeur CM existant, profondeur portée à tout l'historique (depuis 2011-04-24 pour BTC). Indicateur pane : histogramme, Σ7 j, z-score du Σ30 j sur 365/730 j ou tout l'historique, badge « flash, révisable » ; marqueurs optionnels « afflux dans la force » (hausse 7 j et z > +2) et « sorties dans la faiblesse ». Unité 1d, mode clôture.

**Ce qui existe déjà.** Les flux nets BTC de Coin Metrics sur 800 j, avec le z du Σ30 sur 730 j, existent dans CHAIN › Cohortes › Exchanges (apps/web/src/data/onchain/fluxExchangesCm.ts:21-23, 58-79, 172 ; apps/web/src/components/onchain/FluxNetExchanges.tsx:19-38). Ils sont aussi dans BRIEF « Flux · lecture commune », avec une alerte déjà armable (apps/web/src/data/onchain/fluxCapitaux.ts:203 et :265 ; apps/web/src/components/brief/SectionFluxCapitaux.tsx:5). Les flux ETH sont dans CHAIN ETH (apps/web/src/data/onchain/reseauEthCm.ts:118 et :150). Il n'existe ni AuxSeriesId de flux (packages/types/src/index.ts:186-228) ni indicateur de flux de plateformes (grep sans résultat dans packages/indicators).

**Réutilise.** fluxNetQuotidien, sommeJours, zScoreSommeGlissante, dernierStatutCm (fluxExchangesCm.ts:30-79), fetchReseauEthCm (reseauEthCm.ts:150), cache 6 h, etudeEvenements.

**Point d'intégration.** AuxSeriesId « fluxNetEx » (+1). Case dans rawFetch (auxProvider.ts:409+), routé par symbolToAsset sur le patron du case « mvrv » (auxProvider.ts:504-508) : BTC lit chargerFluxExchangesBtc().points, ETH lit fetchReseauEthCm().donnee.fluxNet. Les deux sont déjà cachés 6 h et partagés avec CHAIN. Le def de pane (histogramme, Σ7 j, z du Σ30 sur 730 j) doit déclarer amorceBougies ≥ 760 (types index.ts:402-409 ; ChartInstance.tsx:209-219) car le backfill par défaut est de 500 bougies (ChartInstance.tsx:1225). Comme c'est un FLUX : calcul seulement si ctx.timeframe === '1d', puisqu'il n'existe pas de maxTimeframe et qu'un LOCF en 1w prendrait un seul jour. Il faut aussi un appariement au jour exact, sans report vers la bougie du jour en cours, selon la convention notée pour perpDelta (auxProvider.ts:356-360) et le constat AUX-1.

**Sources.**

- Coin Metrics Community FlowInExNtv/FlowOutExNtv (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Déjà utilisé ; BTC servi depuis 2011-04-24 (sonde du dépôt) ; statut flash ; labels CM susceptibles de dériver ; CC BY-NC 4.0.

**Contrat.** Aucun nouveau fournisseur : Coin Metrics est admis pour les flux nets BTC et pour le réseau ETH (BUILD-CONTRACT.md:202-205), la réserve reste non affichée. Exception G100 nécessaire, avec @axiom/types +1 (BUILD-CONTRACT.md:81) et catalogue de 220 à 221 (BUILD-CONTRACT.md:82 ; registry.test.ts:21). Le def entre dans le chunk « indicators » du chargement initial (vite.config.ts:154 ; chart/indicators.ts:33), avec une marge d'environ 4 Ko gzip. Aucun quota payant : Coin Metrics community sans clé, CORS direct.

**Risques.** (1) Le z « multi-cycle » sur tout l'historique mélange des régimes de labels. La même dérive des labels justifie déjà de masquer la réserve (fluxExchangesCm.ts:8-10). Les 730 j glissants actuels sont plus sûrs, et porter la profondeur à 2011 n'apporte rien sur un graphe Binance qui commence en 2017-08. (2) Statut « flash » révisable : le pane n'a aucun canal pour un badge. Il faut passer par le statut du chart (verifier() de chart/indicators.ts) ou par le nom de la sortie. (3) Fausses barres si le LOCF n'est pas neutralisé (AUX-1). (4) Inutilisable en 4h, l'unité d'AXIS. (5) Preuve académique mitigée, et nulle sur BTC en intrajournalier selon l'idée (non revérifiée ici) : des marqueurs avant mesure produiraient de faux signaux.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Pane de contexte peu coûteux (réutilise fluxNetQuotidien, sommeJours, zScoreSommeGlissante), utile pour lire flux et prix ensemble. Marqueurs « afflux dans la force » à exclure tant qu'ils ne battent pas la base prix seul. Renoncer au z sur tout l'historique. Preuve académique mitigée, non revérifiée dans ce passage.

**Références.**

- Hoang & Baur, SSRN 3902504 : variation des réserves liée négativement aux rendements. Cité et vérifié par l'émetteur, non revérifié ici (papers.ssrn.com inaccessible depuis le conteneur).
- Chi, Chu & Hao, arXiv 2411.06327 : pas d'effet intrajournalier significatif sur BTC, effet plus net sur ETH. Cité par l'émetteur, non revérifié ici (arxiv.org inaccessible).
- apps/web/src/data/onchain/fluxExchangesCm.ts:1-13 : labels CM, statut flash, réserve écartée (+200 k BTC de dérive en 90 j).
- apps/web/src/data/onchain/fluxExchangesCm.ts:21-23 et :55-75 : fenêtres et z du Σ30.
- apps/web/src/components/onchain/FluxNetExchanges.tsx:14-38 : vue des flux.
- apps/web/src/data/onchain/reseauEthCm.ts:115-150 : flux ETH.
- packages/types/src/index.ts:186-228 : aucune aux de flux.
- BUILD-CONTRACT.md:202-205 : CM admis pour les flux nets.
- scripts/axis/rapport-flux-2026-10-08.md : gabarit de test figé (flux taker, pas on-chain).

**Redondance.** CHAIN affiche déjà, en BTC et ETH, les Σ1, 7 et 30 j, le z du Σ30 sur 730 j et la courbe (FluxNetExchanges.tsx:28-37). Le pane n'apporte que la co-lecture avec le prix sur le graphe et une profondeur accrue. Aucune aux de flux n'existe sur le graphe (types/src/index.ts:186-228) : c'est nouveau seulement à ce titre. Pas de doublon avec CVD et delta taker, qui mesurent l'agression sur le carnet et non les dépôts on-chain.

**Pièges.** Causalité inverse : les dépôts montent pendant les chutes (ventes, appels de marge), donc un z > +2 peut être contemporain ou consécutif au mouvement plutôt que prédictif. Périmètre de labels CM changeant, avec une dérive documentée (fluxExchangesCm.ts:8-10). Si les labels sont appliqués rétroactivement (non vérifié), l'historique contient une information découverte plus tard (look-ahead de labellisation). Statut flash : valeurs récentes révisables, donc marqueurs qui repeignent. Non-stationnarité : la variance des flux change selon les ères (Mt Gox, 2017-2021, FTX, ETF et dépositaires), donc un z sur tout l'historique depuis 2011 est mal calibré ; garder 365/730 j glissants. Transferts internes (froid/chaud, consolidations) : pics sans contenu économique. ETH : staking, ponts L2 et DeFi brouillent le sens des flux. Jour D connu au plus tôt à D+1. Fournisseur de labels unique.

**Protocole de validation.** (1) Geler la règle et les seuils : z du Σ30 à ±2 sur 730 j, hystérésis, entrée à l'open D+2, horizons 7 et 30 j. (2) Deux nuls : décalages circulaires (scripts/valider-axis-flux.ts:388-422) et base prix seul (z du rendement 30 j au même instant). Le flux doit apporter quelque chose au-delà du prix. (3) Test de précédence : corrélations croisées flux(t) → rendement(t+k) contre rendement(t) → flux(t+k). (4) Archiver un instantané quotidien pour mesurer les révisions flash avant toute conclusion. (5) BTC et ETH en cellules séparées : sans signe stable par moitié et sur les deux actifs, pane sans marqueurs. L'historique a déjà été vu dans CHAIN : le seul échantillon jamais vu est le futur.

**Preuve d'intérêt (idéation).** Hoang & Baur (SSRN 3902504) : variation des réserves liée négativement aux rendements ; Chi, Chu & Hao (arXiv 2411.06327) : pas d'effet intrajournalier significatif sur BTC, plus net sur ETH (vérifié). Preuve mitigée : mesure obligatoire.

**Mesure de succès.** Valeurs = tuile CHAIN ; event study z > +2 et z < −2 à 7 et 30 j par moitiés ; sans stabilité, pane gardé comme contexte sans marqueurs.

**Fichiers à toucher.**

- packages/types/src/index.ts
- apps/web/src/chart/auxProvider.ts
- packages/indicators/src/derivatives/fluxNetPlateformes.ts (nouveau)
- packages/indicators/src/derivatives/fluxNetPlateformes.test.ts (nouveau)
- packages/indicators/src/registry.ts
- packages/indicators/src/registry.test.ts

**Avis des juges.**

- valeur (2) : Causalité inverse (les dépôts montent pendant les chutes) et dérive des labels Coin Metrics déjà documentée. Pouvoir prédictif faible et non démontré. Unité 1d stricte.
- cout-risque (3) : Coin Metrics community, gratuit, sans clé, déjà admis pour les flux BTC. Mais la dérive des labels est documentée (fluxExchangesCm.ts:8-10), le statut « flash » est révisable sans canal de badge dans un pane, et il faut types +1 et catalogue +1 dans le chunk initial. Causalité inverse : un z extrême peut être contemporain du mouvement.
- coherence (3) : Les flux Coin Metrics sont admis et déjà chargés (fluxExchangesCm.ts), mais passer au graphe ajoute un AuxSeriesId et un def en 1d strict. Le déplacement est cohérent, la valeur ajoutée sur 4h faible.

### 38. SUG-30 — ETH on-chain sur le graphe : MVRV et prix réalisé reconstitué, files de staking en séries, burn et émission brute

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain ETH, DeFi et stablecoins · origines : ETH-1

**Question de trading.** Un swing long ETH se prend-il contre un surplomb d'offre (file de sortie du staking qui gonfle) ou en zone de valorisation basse (proche du prix de revient moyen) ?

**Proposition retenue après vérification.** (1) Ouvrir l'indicateur mvrv à l'ETH, servi par le fetch Coin Metrics 800 j de reseauEthCm (séries conservées dans le cache) plutôt que par le fetch 200 j. (2) Ajouter une branche ETH à realizedPrice, étiquetée « reconstitué (Coin Metrics) ». (3) Un seul nouvel indicateur 1d « Files de staking ETH » (sortie − entrée en % du stake), avec un historique annoncé d'environ 530 j. Retirer l'option burn et émission brute : la série DefiLlama citée n'est pas le burn. Il faudrait d'abord sonder une métrique CM d'émission brute ETH (non vérifiée).

**Proposition initiale.** (1) Lever le blocage BTC de mvrv pour ETH, série servie par le fetch ETH 800 j. (2) Prix réalisé ETH quotidien (prixRealiseEth transformé en série), aux realizedPrice routée par actif et étiquetée « reconstitué ». (3) Aux stakingFileSortie/stakingFileEntree et indicateur « Files de staking ETH » (sortie − entrée en % du stake, attente). (4) Option : émission nette décomposée en burn (revenu de chaîne DefiLlama) et émission brute. Unité 1d, mode clôture.

**Ce qui existe déjà.** CHAIN affiche déjà en tuiles les données ETH : MVRV, prix réalisé reconstitué, écart au spot, émission nette (apps/web/src/data/onchain/reseauEthCm.ts:96-147 ; apps/web/src/components/onchain/ReseauEthCm.tsx:51). Les files de staking ont leurs courbes dans CHAIN (apps/web/src/components/onchain/FilesStakingEth.tsx:6-25). Au graphe, l'aux mvrv lit déjà CapMVRVCur par actif (apps/web/src/chart/auxProvider.ts:503-508), mais via fetchCoinMetrics, qui ne demande que 200 j (apps/web/src/data/onchain/coinmetrics.ts:34, :136-146). Les 800 j de l'idée sont faux pour ce chemin. L'indicateur mvrv est bloqué hors BTC par ONCHAIN_BTC (apps/web/src/lib/indicatorUsability.ts:51-54, :171-173). Le fetch ETH sur 800 j (reseauEthCm.ts:150-158 ; fluxExchangesCm.ts:21) ne met en cache que des dérivés, et prixRealiseEth ne rend que le dernier jour (reseauEthCm.ts:96-111). L'aux realizedPrice est servi par BG pour BTC seulement (auxProvider.ts:516-540).

**Réutilise.** fetchReseauEthCm (reseauEthCm.ts:150), emissionNetteAnnualisee (:69), fetchEthStaking (apps/web/src/data/onchain/ethStaking.ts:23), contrat 1d de stablecoinPrint, revenus de chaîne (apps/web/src/data/onchain/economieChaines.ts:272).

**Point d'intégration.** (1) MVRV ETH : retirer mvrv de la garde BTC seule pour l'ETH (indicatorUsability.ts:171). Pour dépasser 200 j, conserver dans le cache cm:eth:reseau les séries CapMVRVCur, CapMrktCurUSD et SplyCur (calculerReseauEthCm, reseauEthCm.ts:114-147), puis brancher dessus le case mvrv pour l'ETH (auxProvider.ts:503-508). (2) Prix réalisé : branche ETH dans le case realizedPrice (auxProvider.ts:516-540), série reconstituée jour par jour (cap ÷ MVRV ÷ offre) et étiquetée « reconstitué (Coin Metrics) ». (3) Staking : deux AuxSeriesId (packages/types/src/index.ts:186), un case qui lit fetchEthStaking (apps/web/src/data/onchain/ethStaking.ts:23) et un indicateur 1d « Files de staking ETH » dans packages/indicators/src/derivatives/. Aucun hôte nouveau.

**Sources.**

- Coin Metrics Community (ETH) (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : CapMVRVCur, SplyCur, déjà chargés sur 800 j.
- ValidatorQueue (GitHub raw) (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Quotidien depuis le 2025-05-22 ; licence non vérifiée.

**Contrat.** Pas de nouveau fournisseur : Coin Metrics community est admis pour le réseau ETH (BUILD-CONTRACT.md:202-206) et ValidatorQueue est déjà utilisé. La règle « aucun substitut Coin Metrics » ne vise que BTC (BUILD-CONTRACT.md:205-206) : ne jamais faire passer la branche BTC de realizedPrice ou de mvrvZ par CM. Exception G100 pour le nouvel indicateur et l'ouverture de surfaces du graphe (BUILD-CONTRACT.md:71). Nouveaux AuxSeriesId (BUILD-CONTRACT.md:81). Catalogue à justifier (BUILD-CONTRACT.md:82). Budget initial (BUILD-CONTRACT.md:216) : le case aux et la définition entrent dans le chunk d'entrée, le client staking reste paresseux. Aucune clé serveur, aucun enregistreur.

**Risques.** L'historique de staking commence le 2025-05-22, soit environ 530 j au 2026-11-06 (ethStaking.ts:15). Le critère de succès « ≥ 800 j » est inatteignable pour ce volet, et une étude d'évènements sur un seul régime de marché sera peu probante. ValidatorQueue : le code est sous MIT (vérifié sur GitHub), mais les données viennent de l'API beaconcha.in, dont les conditions ne sont pas vérifiées pour un affichage public. raw.githubusercontent.com est absent de connect-src (vercel.json:136) : l'écart relève de SECV-3, mais le graphe en dépendrait aussi. Le fichier pèse jusqu'à 2 Mo (ethStaking.ts:44). Option burn à écarter : la série citée (apps/web/src/data/onchain/economieChaines.ts:276, overview/fees/Ethereum?dataType=dailyRevenue) mesure les revenus des protocoles déployés sur Ethereum, pas le burn d'ETH. La méthodologie CM de SplyCur et de la capitalisation réalisée ETH après le Merge n'est pas vérifiée. Les valeurs CM récentes sont révisables. Aucun lien causal entre la file de sortie et le prix.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. À scinder. (1) MVRV et prix réalisé ETH en série : coût faible, aucune source nouvelle, utile comme contexte de valorisation, étiqueté « reconstitué, méthode par comptes », et à charger sur tout l'historique, pas sur 200 j. (3) Files de staking en série : descriptif acceptable, mais pas d'indicateur présenté comme un signal. (4) Burn et émission brute : gadget pour un horizon swing. Il faut l'exception G100 et justifier 1 ou 2 définitions (BUILD-CONTRACT.md:82).

**Références.**

- Limite de cette passe : WebSearch épuisé, hôtes externes non résolus. Faits externes non vérifiés.
- MVRV : pratique reconnue pour BTC (Mahmudov et Puell, 2018). Aucune validation publiée connue pour ETH. Non vérifié.
- Files de staking : aucune étude connue ne relie la file de sortie aux rendements d'ETH. Les causes opérationnelles des pics de 2025 (sortie d'un opérateur pour raison de sécurité, dénouement de boucles stETH) sont citées de mémoire, non vérifiées.
- apps/web/src/lib/indicatorUsability.ts:51-73 et :171-173 (blocage BTC)
- apps/web/src/chart/auxProvider.ts:504-509 (mvrv = CapMVRVCur via fetchCoinMetrics(symbolToAsset(symbol)), déjà paramétré par actif)
- apps/web/src/data/onchain/coinmetrics.ts:9-18 (ETH servi en community, vérifié en réel par le dépôt le 2026-09-14), :34 (FENETRE_JOURS = 200), :136-145, :221 (chargement complet)
- apps/web/src/data/onchain/reseauEthCm.ts:16 et :160 (le cache ne garde que le dérivé), :97-112 (prix réalisé du dernier jour seulement), :69 (émission nette)
- apps/web/src/data/onchain/ethStaking.ts:15 (historique depuis le 2025-05-22) ; apps/web/src/components/onchain/FilesStakingEth.tsx:22 (première mesure du jour UTC)
- apps/web/src/data/onchain/economieChaines.ts:271-272 (revenus de chaîne DefiLlama)
- BUILD-CONTRACT.md:202-206 (CM admis pour ETH ; « aucun substitut CM » vaut pour BTC seulement), :81-82

**Redondance.** Élevée. Le MVRV et le prix réalisé reconstitué d'ETH sont déjà en tuiles CHAIN (reseauEthCm.ts:97). Les files de staking ont déjà tuiles et sparklines (FilesStakingEth.tsx:6-25). L'émission nette sur 7/30/365 j et les revenus de chaîne existent déjà. Le seul apport réel est la série sur le graphe (superposition au prix, historique) pour le MVRV et le prix réalisé ; le reste duplique des tuiles.

**Pièges.** 1) Profondeur. L'aux mvrv lit fetchCoinMetrics, limité à 200 j (coinmetrics.ts:34). Le fetch de 800 j de reseauEthCm ne met en cache que le dérivé (:16, :160). Lever le blocage ne suffit donc pas pour atteindre « ≥ 800 j » : il faut un chargement complet depuis 2015, comme coinmetrics.ts:221.
2) Méthode. Le prix réalisé d'une chaîne à comptes valorise chaque ETH à son dernier mouvement. C'est discutable pour le contrat de dépôt du staking, les contrats, les ponts et l'ETH brûlé (non vérifié). Les zones de MVRV de BTC ne se transposent pas.
3) Données CM : statut « flash » révisable et dernier jour à null.
4) Le point D est publié en D+1 mais aligné sur l'ouverture de D.
5) Files de staking : environ 530 j d'historique et des séries très persistantes (attentes de 40 j et plus), soit 2 à 4 épisodes indépendants. Les sorties sont souvent opérationnelles (changement d'opérateur, rééquilibrage de LST) sans intention de vendre. Source unique (fichier GitHub, licence non vérifiée), heure de mesure non contrôlable.
6) Burn et émission brute : descriptifs, sans pertinence démontrée pour le swing.

**Protocole de validation.** 1) MVRV ETH. Contrôle d'identité graphe = tuile. Puis étude d'évènements figée : seuils en percentiles calculés sur 2016-2021 seulement, un seul test sur 2022-2026, entrée en D+1, horizons de 30 et 90 j. C'est honnête car le dépôt n'a jamais lu le MVRV ETH pour décider quoi que ce soit.
2) Files de staking. Pas de lecture en signal. L'étude à 5/10/20 j sur moins de 10 épisodes déclustérisés n'aurait aucune valeur. Il faut figer un manifeste maintenant pour un test prospectif à 12-18 mois et exiger n ≥ 20 avant de conclure.
3) Burn : pas de validation à prévoir.

**Preuve d'intérêt (idéation).** MVRV et prix réalisé : pratique reconnue (CM publie CapMVRVCur ETH). File de sortie record ~2,65 M ETH et 46 j en septembre 2025 (vérifié) ; aucun lien causal prouvé avec le prix : event study obligatoire avant lecture en signal.

**Mesure de succès.** ≥ 800 j d'historique (staking depuis 2025-05-22) ; test « aucune valeur de D lue avant la clôture de D » ; mvrv ETH du graphe = tuile CHAIN ; rapport d'event study à 5/10/20 j publié dans docs/.

**Fichiers à toucher.**

- apps/web/src/lib/indicatorUsability.ts
- apps/web/src/chart/auxProvider.ts
- apps/web/src/data/onchain/reseauEthCm.ts
- packages/types/src/index.ts
- packages/indicators/src/derivatives/filesStakingEth.ts (nouveau) + test
- packages/indicators/src/derivatives/realizedPrice.ts (libellé ou description par actif)
- packages/indicators/src/registry.ts
- packages/indicators/src/registry.test.ts
- apps/web/src/components/IndicatorMenu.tsx

**Avis des juges.**

- valeur (2) : Le MVRV ETH et les files de staking (environ 530 j d'historique, un seul régime) sont du contexte lent. La file de sortie comme surplomb d'offre est une hypothèse non mesurée.
- cout-risque (3) : Coin Metrics ETH déjà admis et ValidatorQueue déjà utilisé, mais les conditions beaconcha.in pour l'affichage public ne sont pas vérifiées. L'aux mvrv est limité à 200 j (coinmetrics.ts:34) : il faut un nouveau chargement profond. Historique de staking d'environ 530 j. Nouveaux AuxSeriesId et defs. Coût moyen.
- coherence (3) : Coin Metrics est admis pour ETH (BUILD-CONTRACT.md:202-206). Mais ouvrir mvrv à ETH oblige à revoir la profondeur du fetch (200 j), et les files de staking ajoutent un def et un aux pour environ 530 j d'historique.

### 39. SUG-36 — Flux ETF spot BTC/ETH/SOL sur le graphe avec archive journalière accumulée et datation sans look-ahead

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : flux institutionnels et sentiment · origines : FLX-2

**Question de trading.** Les ETF absorbent-ils l'offre (cumul 5/20 séances, ratio flux/encours élevé), le prix diverge-t-il des flux, et les flux mènent-ils ou suivent-ils le prix ?

**Proposition retenue après vérification.** Archive journalière ETF par actif : fusion sans suppression, première valeur vue et dernière valeur révisée, horodatage d'observation. Elle est alimentée par summary-history.
Amorçage BTC depuis janvier 2024 par BGeometrics etf-flow-btc sur 1460 j, converti en USD (profondeur à confirmer), sans essai historicalInflowChart.
Série aux etfFluxUsd datée à un instant de disponibilité prudent : première observation, à défaut J+1 14:00 UTC. Mode clôture, aucune valeur reportée à travers un trou.
Mesure meneur/suiveur et rendement BTC à 1 et 5 séances après un cumul 5 séances > p80 : d'abord dans un script figé, tout de suite pour BTC, pour ETH et SOL dès 120 séances.
Indicateur fluxEtf au catalogue seulement si le résultat est favorable.
Le panneau CHAIN existant (cumul 5/20, ratio, percentile) lit l'archive au lieu du seul mois glissant.

**Proposition initiale.** Archive journalière par actif (patron fusionner/unionArchives : copie locale + KV du daemon) alimentée à chaque lecture de summary-history ; un essai unique de historicalInflowChart pour l'amorcer au-delà du mois. Aux etfFluxUsd datée au plus tôt au lendemain 00:00 UTC, sans report à travers les trous. Indicateur fluxEtf : barres, cumul N séances, ratio flux/encours en z glissant, marqueur de divergence prix/flux sur 5 séances.

**Ce qui existe déjà.** Flux du jour par émetteur (apps/web/src/data/onchain/etf.ts:224). Historique summary-history sur environ un mois, limit 300 (apps/web/src/data/onchain/etfHistory.ts:8, :58-80).
Déjà affichés dans CHAIN : cumul 5 et 20 séances, ratio flux/encours avec percentile (référentiel ≥ 20 ratios), courbes (apps/web/src/components/onchain/HistoriqueEtf.tsx:25-38 ; etfHistory.ts:25-57).
Repli BTC BGeometrics en BTC sur 120 j (apps/web/src/data/onchain/bgeometrics.ts:63, :126 ; apps/web/src/components/OnchainWindow.tsx:534).
Les flux ETF entrent déjà dans le régime (apps/web/src/data/regime.ts:259) et dans fluxCapitaux (apps/web/src/data/onchain/fluxCapitaux.ts:184, :263).
Le cache (localStorage + KV du daemon) remplace l'entrée entière : aucune archive ne s'accumule (apps/web/src/data/onchain/cache.ts).
Aucun aux ETF dans les types, aucun indicateur ETF dans packages/indicators.

**Réutilise.** parseEtfHistory, resumerEtfHistory, historiqueRatiosEtf (etfHistory.ts:9-40), fusionner/unionArchives (apps/web/src/data/onchain/cryptoquant.ts:147, :156), instantConnuCoinalyze (apps/web/src/chart/auxProvider.ts:238).

**Point d'intégration.** Archive : apps/web/src/data/onchain/etfArchive.ts, sur le patron fusionner/unionArchives (apps/web/src/data/onchain/cryptoquant.ts:146-163), alimentée à chaque lecture de fetchEtfHistory.
Amorçage BTC : BGeometrics etf-flow-btc avec fenetreJours 1460, mécanisme déjà utilisé par BG_STH_MVRV (bgeometrics.ts:140), converti en USD par la clôture journalière. ETH et SOL : accumulation seulement.
Aux : AuxSeriesId etfFluxUsd, plus etfEncoursUsd ou un ratio déjà calculé ; entrée TTL_MS ; rawFetch par import dynamique sur le patron chargerClientBg (auxProvider.ts:646).
Datation : points datés à l'instant de disponibilité et alignés en mode clôture (AUX_SUR_CLOTURE, auxProvider.ts:164-171 ; convention dans packages/indicators/src/utils-aux.ts:8-20).
historicalInflowChart déconseillé :
- c'est un POST non ouvert dans les trois proxys (api/_policy.ts:311 et :457, apps/daemon/src/proxy.ts:150, apps/web/vite.config.ts) ;
- la piste a été abandonnée en juillet au profit de summary-history (docs/superpowers/plans/2026-07-08-lot-e1-sources-bloomberg.md:314).

**Sources.**

- SoSoValue summary-history et historicalInflowChart (déjà utilisée ; clé gratuite ; vérifiée en ligne par l'idéation : non) : Clé Demo serveur déjà en place ; historicalInflowChart mentionné dans etf.ts:16 mais profondeur, format et chemin proxy non vérifiés ; CGU de réaffichage non vérifiées.

**Contrat.** Types et catalogue (BUILD-CONTRACT.md:81-82) : mesure d'abord. Un nouvel indicateur graphique demande une exception G100. L'archive alimentant le panneau existant n'ajoute aucune fenêtre.
Aucun nouveau fournisseur : les clés serveur SoSoValue et BGeometrics existent.
Quota BGeometrics : 15 requêtes par jour partagées entre les visiteurs sur Vercel. L'amorçage coûte un appel mis en cache 24 h.
Sur Vercel, sans KV serveur, l'archive vit dans chaque navigateur.
Les CGU SoSoValue pour un réaffichage public ne sont pas vérifiées (recherche web épuisée).
Pas d'enregistreur 24/7 : l'archive s'accumule seulement à la lecture. Pas d'impact sur le chargement initial si l'import est dynamique.

**Risques.** Flux révisés après première publication (émetteurs tardifs). L'archive gardant la dernière valeur, un backtest ne serait pas point-in-time : il faut aussi la première valeur vue et son horodatage.
Disponibilité réelle inconnue : J+1 00:00 UTC est probablement trop tôt, la publication suivant la clôture américaine et la consolidation le lendemain (non vérifié).
BGeometrics publie en BTC, SoSoValue en USD : raccord à contrôler sur la période commune.
Trous si l'archive n'est pas consultée pendant plus d'un mois.
ETH et SOL n'atteindront 120 séances qu'après environ 6 mois.
Sens causal possiblement inverse : les flux peuvent suivre le prix.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. L'archive datée est la partie solide. Elle ne coûte ni hôte ni clé, et sans elle aucune mesure du sens causal n'est possible ; le régime de marché utilise déjà les flux ETF sans preuve.
L'indicateur fluxEtf sur le graphe ne doit afficher le marqueur de divergence qu'après un verdict favorable : sinon il ajoute un signal non démontré.
Priorité : stocker le moment de première observation de chaque valeur (vintage). Essayer historicalInflowChart une seule fois, en sachant que son chemin, sa profondeur et son format ne sont pas vérifiés.
Les CGU de SoSoValue restent à vérifier avant l'exposition publique. BGeometrics (BTC seulement, déjà intégré) sert de repli.

**Références.**

- apps/web/src/data/regime.ts:245-262 : la note ETF du régime vaut ±1 au-delà de ±50 M$, sur la seule séance de la veille.
- apps/web/src/data/onchain/etfHistory.ts:8 : historique summary-history limité au dernier mois.
- apps/web/src/data/onchain/etfHistory.ts:25, :40 : resumerEtfHistory (cumuls 5 et 20 séances) et historiqueRatiosEtf (ratio flux/encours avec référentiel).
- apps/web/src/data/onchain/etf.ts:15-16 : historicalInflowChart mentionné mais non utilisé.
- api/_policy.ts:311 : deux chemins sosoapi autorisés seulement.
- apps/web/src/data/onchain/bgeometrics.ts:120-126 : flux ETF BTC en unités BTC, recoupé avec Farside le 2026-07-23.
- apps/web/src/data/onchain/etf.ts:6 : ETF Solana actifs depuis octobre 2025.
- Études de causalité entre flux ETF et rendement BTC : aucune vérifiée dans cette session (budget WebSearch épuisé). Selon mes souvenirs non revérifiés, plusieurs travaux de 2024-2025 trouvent que les rendements mènent les flux plus que l'inverse.
- CGU SoSoValue pour un réaffichage public : non vérifiées.

**Redondance.** Partielle. Les flux ETF sont déjà :
- un composant du régime (regime.ts:245-262) ;
- présents dans la vue Flux de capitaux et dans le brief (SectionFluxCapitaux.tsx) ;
- couverts sur un mois avec cumuls 5 et 20 séances et ratio flux/encours (etfHistory.ts:25-64) ;
- disponibles en repli BTC via BGeometrics.
Nouveau : la série sur le graphe (aux), l'archive au-delà d'un mois et le marqueur de divergence prix/flux.

**Pièges.** Latence et révision : plusieurs émetteurs (dont IBIT, selon la pratique observée, non vérifié ici) publient le lendemain. Les totaux sont complétés puis révisés, donc dater à J+1 00:00 UTC peut rester trop tôt. Il faut archiver l'instant de première observation, garder la valeur révisée à part, et backtester sur l'instant observé.
Archive : sur Vercel, elle vit dans le navigateur, sans KV serveur. Tout mois sans ouverture crée un trou définitif, et l'archive n'est pas partagée entre appareils.
Historique court : BTC depuis janvier 2024 (environ 700 séances), ETH depuis juillet 2024 et SOL depuis octobre 2025 ; SOL est inexploitable statistiquement.
Les cumuls sur 5 séances se chevauchent : un seuil au-dessus du 80e percentile donne des évènements fortement autocorrélés et un N effectif bien inférieur au nombre de séances.
Unités : BGeometrics en BTC, SoSoValue en USD, à ne jamais mélanger.
Week-ends et jours fériés : pas de séance, donc ne pas reporter la valeur.
Les CGU de réaffichage public ne sont pas clarifiées.

**Protocole de validation.** Manifeste figé.
Comme une datation point-in-time n'est pas reconstituable en arrière, le backtest se fait sur valeurs révisées, en le déclarant, avec une datation prudente à J+2 00:00 UTC.
Étude d'évènements : cumul 5 séances au-dessus du 80e percentile glissant causal, en ne gardant que des évènements non chevauchants (espacement d'au moins 5 séances).
Mesure : rendement BTC à 1 et 5 séances ; nul par décalage circulaire ; au moins 50 évènements, sinon NON CONCLUANT.
Tester la causalité de Granger dans les deux sens, avec 1 à 5 retards fixés à l'avance.
Explorer sur 2024, puis un seul test sur 2025-2026.
À part, valider la donnée en comparant l'archive à Farside ou à BGeometrics converti, sur 20 séances.
Ne rien brancher dans AXIS.

**Preuve d'intérêt (idéation).** Flux ETF déjà composant du régime (apps/web/src/data/regime.ts:259) et de la vue flux de capitaux ; sens causal non démontré, mesuré explicitement.

**Mesure de succès.** Archive ≥ 120 séances continues, trous signalés ; régressions croisées flux/rendement pour classer « meneur » ou « suiveur » ; rendement BTC à 1 et 5 séances après cumul 5 séances > p80.

**Fichiers à toucher.**

- apps/web/src/data/onchain/etfArchive.ts (nouveau)
- apps/web/src/data/onchain/etfArchive.test.ts (nouveau)
- apps/web/src/data/onchain/etfHistory.ts
- apps/web/src/data/onchain/bgeometrics.ts (fenêtre 1460 j pour BG_ETF_FLOW)
- apps/web/src/components/onchain/HistoriqueEtf.tsx
- scripts/valider-flux-etf.ts (nouveau, mesure figée)
- packages/types/src/index.ts (conditionnel)
- apps/web/src/chart/auxProvider.ts (conditionnel)
- packages/indicators/src/volume/fluxEtf.ts et .test.ts (conditionnel)
- packages/indicators/src/registry.ts et registry.test.ts (conditionnel)

**Avis des juges.**

- valeur (2) : Les flux ETF suivent plus souvent qu'ils ne mènent le prix (non démontré dans le dépôt), et le panneau CHAIN montre déjà les cumuls 5/20. L'archive à la date de première observation est propre méthodologiquement, mais l'apport décisionnel est faible.
- cout-risque (3) : Clés SoSoValue et BG déjà serveur. L'amorçage BG consomme le quota de 15 req/j partagé. Révisions et première valeur vue, d'où de la complexité. Sur Vercel, l'archive vit dans chaque navigateur et les visiteurs voient des historiques différents. CGU SoSoValue pour un réaffichage public non vérifiées. Instant de disponibilité incertain.
- coherence (3) : L'archive avec première valeur vue et valeur révisée est saine, mais elle vit par navigateur sur Vercel. L'amorçage consomme le quota BG (15 req/j), et un aux plus un def suivent. Sur Vercel, l'archive reste propre à chaque visiteur.

### 40. SUG-C1 — Barres non temporelles et types de prix : Renko ATR, range bars, Line Break 3, Heikin Ashi en bougie, types natifs OHLC/aire, puis Point & Figure avec objectifs par comptage

**Score 10/20** · valeur 2 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : analyse technique · origines : critique de complétude, trou AT de l'inventaire : types de graphique

**Question de trading.** En retirant le bruit temporel (nuits calmes, week-ends), la tendance swing tient-elle, où sont les retournements de briques, et quel objectif donne le comptage P&F ?

**Proposition retenue après vérification.** Lot 1 (S) : sélecteur des types natifs (candle_solid, candle_stroke, ohlc, area), Heikin Ashi en transformation d'affichage à nombre de barres constant, et chartType persisté. Indicateurs et encart restent sur les prix réels. Lot 2 (M) : Renko (boîte ATR figée à l'ancre ou en %), Line Break 3 et range bars, en variante de symbole synthétique. Ils sont construits sur une unité source ≥ 15 m choisie, pas 1 m par défaut, avec l'ancre affichée et la pagination à gauche désactivée. La dernière brique est marquée provisoire et le timeframe n'est pas transmis aux indicateurs. Alertes, BT, orderflow et aux sont refusés avec un motif. Point & Figure est écarté tant que le lot 2 n'a pas servi.

**Proposition initiale.** Phase 1 : couche de transformation pure sur les bougies (1m de l'adaptateur par défaut, repli sur les bougies du graphe étiqueté « approximation ») qui produit des Candle : Renko (boîte = ATR(14) figé à l'ancre ou en %), range bars (amplitude fixe), Line Break 3, Heikin Ashi en type de bougie (clôture réelle dans l'encart). Chaque brique porte l'horodatage de sa complétion, décalé de +1 ms si plusieurs se forment dans la même bougie source. Volume et taker buy sont sommés, ce qui conserve le CVD. La dernière brique est marquée « provisoire ». Exposer aussi les CandleType natifs ohlc, area et candle_stroke. Les indicateurs tournent sur les briques via computeIndicator, sans changement. Phase 2 : Point & Figure (boîte en %, retournement 3) rendu en colonnes X/O par overlay, avec objectif vertical par comptage, libellé « convention ».

**Ce qui existe déjà.** Heikin Ashi n'existe que comme indicateur (packages/indicators/src/trend/heikinAshi.ts). Ni Renko, ni range bars, ni Line Break, ni Point & Figure : le grep ne renvoie que les needDefaultPointFigure de KLineChart (par ex. apps/web/src/chart/drawing.ts:126). chartType est figé à "candle_solid" (apps/web/src/store/persist.ts:237), alors que ChartState.chartType est déjà typé string (packages/types/src/index.ts:460). KLineChart 9.8.12 déclare candle_solid, candle_stroke, candle_up_stroke, candle_down_stroke, ohlc et area (node_modules/.pnpm/klinecharts@9.8.12/node_modules/klinecharts/dist/index.d.ts:217-224). Aucune occurrence de CandleType dans apps/web. setStyles est déjà appelé dans apps/web/src/chart/ChartInstance.tsx:153 et :451. Patron de l'adaptateur synthétique : apps/web/src/data/synthetic.ts:118-183, avec un encodage en 3 parties séparées par « | » (synthetic.ts:43-54) et des trades inertes (synthetic.ts:180-182). Les indicateurs sont calculés sur les bougies du store, alignées index par index sur dataList (apps/web/src/chart/indicators.ts:284-288, :432). La pagination à gauche ajoute des bougies en tête (ChartInstance.tsx:1358-1380). L'extension de session déduit le pas des bougies par pasBougiesMs (ChartInstance.tsx:239, :1392).

**Réutilise.** Patron createSyntheticAdapter et combineKlines (apps/web/src/data/synthetic.ts:74, :120 ; apps/web/src/data/adapters.ts:52), fetchKlines/subscribeKline de IExchangeAdapter (packages/types/src/index.ts:432-433), ATR du registre, ChartState.chartType déjà typé (packages/types/src/index.ts:459).

**Point d'intégration.** (a) Types natifs : setStyles({ candle: { type } }) dans ChartInstance, sélecteur dans la barre d'outils, chartType persisté (persist.ts:237). Heikin Ashi en transformation d'affichage, avec le même nombre de barres : l'alignement index par index est conservé et les indicateurs restent calculés sur les prix réels. (b) Briques : module pur barresNonTemporelles.ts, exposé comme variante de symbole de l'adaptateur synthétique (EXCHANGE_IDS reste à 9). Pagination désactivée par params.callback([], false), patron de ChartInstance.tsx:974 et :1504. timeframe non transmis à computeIndicator, car CalcContext.timeframe n'est « jamais inférée » (packages/types/src/index.ts:369-373). Alertes, BT, orderflow et aux refusés avec un motif.

**Sources.**

- Bougies 1m des adaptateurs existants (Binance spot en tête) (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Aucune donnée nouvelle ; environ 1 000 bougies par appel, chargement à la demande pour la plage visible.

**Contrat.** Exception G100 pour le nouveau mode de graphe et le contrôle de barre d'outils. KLineChart reste figé : seulement des styles natifs et des données transformées (BUILD-CONTRACT.md:21). EXCHANGE_IDS est inchangé (BUILD-CONTRACT.md:25). Aucun indicateur, fournisseur, hôte ou clé nouveau, et pas de @axiom/types puisque chartType est déjà un string. Aucun enregistreur : construction à la demande. Point & Figure, avec son rendu de colonnes X/O par overlay, serait L.

**Risques.** 1) Une source 1 m pour un horizon swing coûte cher : 6 mois font environ 260 000 bougies, soit environ 260 appels klines, Binance plafonnant à 1 000 bougies par appel (netliq.ts:271-277). C'est lent et consomme du quota, et c'est pire sur d'autres places. Préférer une unité source ≥ 15 m étiquetée. 2) Les range bars et un Renko construit sur OHLC supposent l'ordre haut/bas dans la bougie : c'est une approximation. 3) Les briques dépendent de l'ancre. La pagination à gauche (ChartInstance.tsx:1358) ou un nouveau backfill changent toutes les briques, ce qui revient à repeindre : ancre fixe obligatoire. 4) En direct, plusieurs briques peuvent naître d'une seule bougie, avec des horodatages décalés de +1 ms. pasBougiesMs, l'alignement LOCF des aux et la synchronisation multivue, tous fondés sur le temps, deviennent faux ou approximatifs. 5) Les indicateurs qui ont une sémantique temporelle (sessions, VWAP, minTimeframe, annualisation) sont faux sur des briques. 6) Le comportement de l'axe temps et du zoom avec des horodatages irréguliers n'a pas été vérifié. 7) Aucun avantage démontré connu : c'est un outil de lecture, pas un signal.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Les types natifs ohlc, area, stroke et Heikin Ashi en bougies sont un gain réel de lecture pour un coût minime, dans le respect de KLineChart figé. Renko et range bars sont un outil de lecture légitime à deux conditions : ancre fixe, et source 15m ou 1h pour l'horizon swing plutôt que 1m. La phase 2 P&F avec objectifs par comptage reste un gadget tant qu'aucune étude figée n'a mesuré ces objectifs. Aucun intérêt prédictif documenté : à présenter comme visualisation, jamais comme signal. Références externes non revérifiées : quota WebSearch épuisé.

**Références.**

- Aucune étude démontrant un avantage de Renko, Point & Figure, Line Break ou Heikin Ashi n'est connue ni vérifiée : quota WebSearch épuisé
- Point & Figure, comptage vertical : convention praticienne (T. Dorsey, « Point and Figure Charting » ; J. du Plessis), non revérifiée en ligne
- Heikin Ashi : D. Valcu, Technical Analysis of Stocks & Commodities, 2004, praticien, non revérifié en ligne
- TradingView, page d'aide 43000502276 (types de graphique) : citée par l'inventaire, non revérifiée ici
- Interne : node_modules/.pnpm/klinecharts@9.8.12/node_modules/klinecharts/dist/index.d.ts:217-224 (CandleType ohlc, area, candle_stroke natifs)
- Interne : klinecharts dist/index.esm.js:2205-2216 (axe X indexé par position ; timestampToDataIndex par binarySearchNearest)

**Redondance.** Faible. Aucun Renko, range bars, Line Break, Kagi ni P&F (grep : seuls les needDefaultPointFigure de KLineChart). Heikin Ashi n'existe qu'en LIGNES superposées, pas en bougies (packages/indicators/src/trend/heikinAshi.ts:4-18). chartType est figé à candle_solid (apps/web/src/store/persist.ts:237) et rien n'appelle setStyles({candle:{type}}). L'exposition des types natifs ohlc, area et stroke est donc nouvelle et quasi gratuite. Le filtrage du bruit est en partie couvert par zigzag, supertrend, donchian, chandelierExit et les lignes HA, mais pas la lecture en briques.

**Pièges.** 1) Recalcul au chargement : une boîte ATR « figée à l'ancre » dépend du début de l'historique chargé. Charger plus de passé déplace l'ancre et refait toutes les briques. Le test « préfixe » ne vaut qu'avec une ancre fixe (date ou prix fixés), à imposer. 2) Ordre intrabougie inconnu dès qu'une bougie source franchit plus d'une boîte. Le repli sur les bougies 4h du graphe est donc souvent faux, pas seulement « approximatif ». 3) Volume de données pour le swing : 50 000 bougies 1m ≈ 35 jours seulement. 6 mois ≈ 263 000 bougies, soit environ 263 appels plafonnés à 1000 (apps/web/src/data/netliq.ts:274). Prendre une source 15m ou 1h avec borne d'erreur, ou les dumps data.binance.vision à la demande. 4) Indicateurs à sémantique temporelle (sessions VWAP, aux indexées par unité comme perpDelta ou liq, funding) : faux ou mal alignés sur des briques, à désactiver ou à signaler. 5) Axe KLineChart indexé : des horodatages irréguliers s'affichent avec un espacement uniforme et des étiquettes de temps irrégulières. Des doublons fausseraient l'ancrage des dessins (recherche binaire du plus proche), le décalage de +1 ms est donc nécessaire, ce qui est vérifié. 6) Backtest sur Renko : exécutions irréalistes au prix exact de la boîte. Le refus BT et alertes prévu par l'idée est justifié.

**Protocole de validation.** Outil de lecture : valider la construction, pas un pouvoir prédictif. Fixture golden contre une implémentation de référence indépendante. Causalité par préfixe À ANCRE FIXE. Conservation des volumes à 1e-9. Moins de 50 ms pour 50 000 bougies. Tests de rechargement : élargir l'historique ne doit pas modifier les briques postérieures à l'ancre. Si l'on affiche les objectifs P&F, faire d'abord une étude d'évènements figée : taux d'atteinte de l'objectif par comptage contre un objectif aléatoire à même distance, sur un pool jamais vu. Sans cette étude, libeller « convention, non mesurée ».

**Preuve d'intérêt (idéation).** Types proposés par TradingView (page d'aide 43000502276, vérifiée dans l'inventaire). Aucun avantage démontré connu pour Renko, P&F ou Heikin Ashi : outil de lecture, libellé comme tel, pas un signal.

**Mesure de succès.** Construction identique à une implémentation de référence sur la fixture golden ; causalité par préfixe (les briques d'un préfixe sont un préfixe des briques) ; somme des volumes des briques = somme des volumes source à 1e-9 ; moins de 50 ms pour 50 000 bougies 1m.

**Fichiers à toucher.**

- apps/web/src/chart/ChartInstance.tsx
- apps/web/src/store/persist.ts
- apps/web/src/components/Toolbar (sélecteur de type)
- apps/web/src/data/barresNonTemporelles.ts (nouveau, + test golden)
- apps/web/src/data/synthetic.ts
- apps/web/src/data/adapters.ts
- apps/web/src/chart/indicators.ts
- apps/web/src/alerts/runtime.ts et apps/web/src/store/backtest.ts (refus motivé)

**Avis des juges.**

- valeur (2) : Transformations d'affichage sans information nouvelle. Heikin Ashi existe déjà en indicateur (packages/indicators/src/trend/heikinAshi.ts). Les Renko et range bars dépendent de l'ancre et de l'ordre intrabougie, qui est inconnu. Confort visuel seulement.
- cout-risque (3) : Le lot 1 (types natifs, HA, chartType persisté) est quasi gratuit et sûr. Le lot 2 coûte cher : symbole synthétique, ancre figée, pagination désactivée et refus partout. Un Renko ou des range bars construits sur OHLC supposent l'ordre haut/bas dans la bougie : briques fausses. Requêtes nombreuses si la source est fine.
- coherence (3) : Lot 1 naturel : chartType est déjà persisté (store/persist.ts:237) sans être lu, et heikinAshi existe en def. Le lot 2 (Renko, range, Line Break en symbole synthétique) force la chaîne du graphe : pagination coupée, unité retirée aux indicateurs, refus dans alertes et BT.

### 41. SUG-22 — Flux d'options : prints Deribit sur 24 h (agresseur, blocs, prime et vega nettes par strike) et historique OKX du put/call et des volumes taker

**Score 9/20** · valeur 2 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : options · origines : OPT-5, SRC-5, OPT-8

**Question de trading.** Les gros acteurs achètent-ils de la protection ou des calls pendant ce mouvement, sur quels strikes, en payant au-dessus du mark, et la foule d'options est-elle à un extrême depuis plusieurs jours ?

**Proposition retenue après vérification.** Vue « Flux » d'OMON seule. Trades d'options Deribit sur 24 h glissantes, en mémoire et chargés en incrémental. Prime USD et vega nettes signées selon l'agresseur, par type, échéance et strike ; part des blocs ; écart IV payée − mark ; combos regroupés. Contrôle de cohérence contre volume24h. Premier lot sans bulles sur le graphe ni OKX Rubik ; Rubik seulement après sondage de la profondeur et des CGU. Aucune lecture prédictive affichée avant mesure.

**Proposition initiale.** (1) fluxOptions.ts : public/get_last_trades_by_currency (kind=option, pagination) sur 24 h glissantes et get_block_rfq_trades ; par trade prime USD, delta et vega recalculés avec l'IV du trade, signe selon l'agresseur ; agrégats par type, échéance et strike, part des blocs, écart IV payée − mark ; section « Flux » d'OMON et bulles d'options sur le graphe BTC/ETH ; seul l'agrégat quotidien rejoint le collecteur de SUG-20. (2) okxOptionsStats.ts : rubik option/open-interest-volume-ratio, taker-block-volume, open-interest-volume-expiry/strike ; série journalière avec percentile, étiquette « OKX seulement ».

**Ce qui existe déjà.** OMON calcule un P/C sur le volume 24 h de toute la chaîne (OptionsWindow.tsx:436-445), tiré de volume24h du résumé de carnet (deribit.ts:251, :302), et un P/C OI/volume des ETF (OptionsWindow.tsx:385-386). Aucun appel aux trades, blocs ou RFQ Deribit, ni à Rubik OKX (grep get_last_trades|block_trade|block_rfq|rubik : rien). Les bulles baleines ne portent que sur les trades spot/perp (whaleBubbles.ts:14-19). bsGreeks ne calcule pas le vega (blackScholes.ts:45-54).

**Réutilise.** appelDeribit et son débit (apps/web/src/data/deribit.ts:38, :60), parseOptionInstrument, greeks, rayonBulle, client OKX, etudeEvenements.

**Point d'intégration.** Nouveau module paresseux apps/web/src/data/fluxOptions.ts, qui appelle appelDeribit (deribit.ts:60, à exporter ; débit de 220 ms, :26). Il pagine get_last_trades_by_currency(_and_time) sur 24 h, puis passe en incrémental depuis le dernier horodatage. Parsing par parseOptionInstrument (:90) ; delta via greeksOptionCrypto (greeksDeribit.ts:19) ; vega à ajouter dans blackScholes.ts. Nouvelle vue « Flux » dans OMON (components/omon/, sur le modèle de VueGexDex). En production, Deribit n'est pas dans connect-src (vercel.json:136) : le passage se fait par /extapi (binanceDapi.ts:143-147). Le cache CDN de 60 s (api/_policy.ts:378-382) sert peu sur des URL horodatées. OKX Rubik s'appelle en direct (www.okx.com dans connect-src, CORS * selon okx.ts:23-24).

**Sources.**

- Deribit public/get_last_trades_by_currency et get_block_rfq_trades (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Champs iv, direction, block_trade_id, block_rfq_id, combo_id dans le schéma public (doc vue par WebSearch) ; sens de direction pour un bloc non vérifié.
- OKX V5 Rubik statistiques d'options (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Chemins listés par CCXT et SDK ; champs callBuyVol/putBuyVol/blocs relevés dans des SDK tiers ; profondeur et section 9 de l'accord API OKX non vérifiées.

**Contrat.** Pas d'enregistreur (BUILD-CONTRACT.md:88) : une fenêtre de 24 h en mémoire, active seulement OMON ouvert, reste compatible. La nouvelle vue OMON demande une exception G100 ; des bulles d'options sur le graphe seraient une seconde surface G100. Pas de nouveau fournisseur (Deribit est déjà une source, OKX fait partie des 9 EXCHANGE_IDS), ni de clé ni d'hôte. L'agrégat quotidien dépend du collecteur de SUG-20, non encore accepté. Sur Vercel sans daemon, aucun historique ne se constitue.

**Risques.** Le nombre de trades d'options par jour et le plafond count par page ne sont pas revérifiés (docs.deribit.com injoignable ici) : la durée de reconstitution est incertaine, et chaque page coûte une invocation Vercel. Le sens de direction est ambigu pour les blocs et RFQ. Des jambes de combo non regroupées faussent la prime nette. Pan & Poteshman reposent sur le volume d'ouverture initié par l'acheteur ; l'API publique ne distingue pas ouverture et clôture, donc la preuve ne se transpose qu'en partie. Rubik : profondeur d'historique, granularité et CGU non vérifiées, et part de marché OKX faible. La mesure « corrélation sur 180 j avec le P/C Deribit » est impossible sans historique Deribit. Bulles : un achat de put est baissier, à l'inverse de la convention vert/rouge des bulles spot (whaleBubbles.ts:3-4), d'où un risque de confusion.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Le volet Deribit apporte une information réellement absente d'AXIOM. La lecture descriptive « qui paie quoi, sur quel strike » a de la valeur même sans avantage prouvé, à condition d'être présentée comme descriptive, sans interprétation directionnelle avant le test. Le volet OKX est presque un gadget : à retirer ou différer. Le regroupement des combos est un préalable, pas une option. Références externes non revérifiées dans cette passe (quota WebSearch épuisé, hôtes de documentation injoignables).

**Références.**

- Pan & Poteshman (2006), Review of Financial Studies 19(3), « The information in option volume for future stock prices » : le pouvoir prédictif vient du volume d'ouverture acheteur, une donnée CBOE non publique. Selon mon souvenir, la version calculable sur données publiques est nettement plus faible (non revérifié en ligne ici ; existence vérifiée par l'étape précédente)
- Easley, O'Hara & Srinivas (1998), Journal of Finance : le volume d'options est informatif (mémoire, non revérifié)
- Bollen & Whaley (2004), Journal of Finance : la pression nette d'achat déforme la courbe d'IV (mémoire, non revérifié)
- Garleanu, Pedersen & Poteshman (2009), RFS, « Demand-based option pricing » (mémoire, non revérifié)
- Alexander, Deng, Feng & Wan (2023), Journal of Financial Markets, « Net buying pressure and the information in bitcoin option trades », étude sur Deribit (mémoire : titre et résultats non revérifiés)
- Amberdata Block-Sniffer et ventilation achat/vente Glassnode : pratique de marché (vérifié par l'étape précédente, non revérifié ici)
- Interne : apps/web/src/components/OptionsWindow.tsx:435-444 (seul le P/C du volume 24 h existe), apps/web/src/data/deribit.ts:150 (putCallRatioOi), apps/web/src/chart/whaleBubbles.ts:73 (bulles spot/perp avec agresseur), apps/web/src/data/validationSignaux.ts:1-20 (event study sans look-ahead, réutilisable)

**Redondance.** Faible pour Deribit. AXIOM n'a que le P/C du volume 24 h et le P/C de l'OI : aucune ventilation par agresseur, bloc, strike, prime ou vega. Aucune occurrence de get_last_trades, block_trade ou rubik dans le code. Le volet OKX recoupe la même question sur une place minoritaire : redondance avec le volet Deribit, et donnée d'une seule plateforme.

**Pièges.** (a) L'agresseur n'indique pas l'ouverture. Un achat de put peut être la clôture d'un put vendu. L'effet de Pan-Poteshman tient au volume d'ouverture, que Deribit ne publie pas trade par trade (non vérifié). (b) Blocs et RFQ : le sens côté preneur est ambigu (non vérifié). Les combos et stratégies (risk reversal, spreads, calendriers) ont des jambes de sens opposés qui s'annulent ou se comptent deux fois. (c) Causalité inverse : les achats de protection suivent les baisses. Un seuil « prime de puts > p90 » est donc conditionné par les rendements passés et peut capter une simple réversion. (d) Une fenêtre de 24 h en mémoire ne permet aucune mesure : sans source historique, il faut des mois de collecte avant toute conclusion. (e) Un trou de pagination ou de débit biaise la prime nette. La comparaison au volume 24 h du book summary proposée est indispensable. (f) L'IV d'un trade sur un strike peu liquide rend la vega bruitée. (g) OKX Rubik : profondeur d'historique et granularité non vérifiées. Le seuil « corrélation ≥ 0,6 » est arbitraire et ne mesure pas l'utilité.

**Protocole de validation.** Étape 0 : vérifier si l'historique public des trades Deribit est accessible (hôte d'historique ou paramètre historical, de mémoire : non vérifié). Si oui, reconstruire hors ligne, dans scripts/, les agrégats quotidiens depuis 2020, téléchargés à la demande comme le replay data.binance.vision. Ce n'est pas un enregistreur 24/7. Figer dans un manifeste : signe, regroupement par combo_id et block_trade_id, percentile causal sur 365 j glissants, horizons 1/3/5 j. Découper en développement (2020-2023) et test jamais vu (2024-2026). Évaluer une seule fois : régression des rendements futurs sur le flux net, contrôlée par les rendements passés et la variation d'IV, et event study via validationSignaux (rendements signés contre la référence inconditionnelle), avec IC bootstrap par blocs. Sans historique : collecte prospective de l'agrégat quotidien (SUG-20) et décision après au moins 12 mois. OKX : abandonner si l'historique fait moins d'un an.

**Preuve d'intérêt (idéation).** Pan & Poteshman (RFS 2006, vérifié) : le P/C du volume initié par les acheteurs prédit les rendements actions. Block-Sniffer d'Amberdata et ventilation achat/vente Glassnode (vérifiés). Effet crypto non vérifié : à mesurer.

**Mesure de succès.** 24 h reconstituées en < 30 s, volume à ±5 % du volume 24 h du book summary ; historique OKX ≥ 180 j et corrélation ≥ 0,6 avec le P/C Deribit ; event study prime nette de puts > p90 à 1-5 j.

**Fichiers à toucher.**

- apps/web/src/data/fluxOptions.ts (nouveau)
- apps/web/src/data/fluxOptions.test.ts
- apps/web/src/data/deribit.ts (export d'appelDeribit, type de trade)
- apps/web/src/data/blackScholes.ts (vega)
- apps/web/src/components/omon/VueFlux.tsx (nouveau)
- apps/web/src/components/OptionsWindow.tsx
- apps/web/src/data/okxOptionsStats.ts (optionnel, second lot)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : L'agresseur n'indique pas l'ouverture d'une position (Pan-Poteshman repose sur le volume d'ouverture) et le sens des blocs et RFQ est ambigu. Lecture très bruitée pour un swing ; le nombre de trades par jour n'est pas vérifié.
- cout-risque (2) : Pagination incrémentale de trades d'options. Le plafond count par page n'est pas vérifié, et chaque page coûte une invocation Vercel (www.deribit.com passe par /extapi). L'agresseur ne dit pas ouverture ou clôture, et le sens des blocs et RFQ est ambigu : une « prime nette » signée risque d'être trompeuse. Les combos non regroupés faussent les sommes.
- coherence (3) : Nouvelle vue OMON et nouveaux endpoints Deribit paginés : chaque page coûte une invocation Vercel. La fenêtre de 24 h en mémoire reste compatible avec l'interdiction d'enregistreur, mais c'est une chaîne d'analyse nouvelle.

### 42. SUG-23 — Options des alts : IV, skew et mouvement attendu pour SOL et XRP (Deribit USDC), XRP, DOGE et SOL (Bybit), BNB et DOGE (Binance eapi)

**Score 9/20** · valeur 2 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : options · origines : OPT-7

**Question de trading.** Sur SOL, XRP ou DOGE, quelle amplitude le marché d'options paie-t-il pour la semaine, dépasse-t-elle le réalisé, et la protection est-elle chère avant mon entrée ?

**Proposition retenue après vérification.** OMON pour les alts, en lecture seule. SOL et XRP via Deribit USDC, puis SOL/XRP/DOGE via Bybit, normalisés au type OptionPoint (marks ramenés en unités de base, IV en %). Vues Smile, Term IV et Mouvement attendu uniquement. Garde-fou de liquidité (OI, nombre de strikes, âge du dernier trade) qui masque les valeurs sous le seuil. IV ATM 30 j interpolée comparée à la RV30 instantanée. Écarter Binance eapi (451 depuis Vercel, hôte nouveau) ainsi que le GEX et les niveaux du graphe pour les alts.

**Proposition initiale.** Type commun OptionPoint. Deribit currency=USDC kind=option filtré par préfixe (SOL_USDC, XRP_USDC), parseOptionInstrument étendu et greeks linéaires ; Bybit /v5/market/tickers?category=option (markIv, delta, gamma, OI fournis) ; en option Binance /eapi/v1/mark. Réutilise ATM/RR à maturité constante (SUG-20), mouvement attendu, VRP de VOL, quantiles RN (SUG-21). Garde-fou de liquidité affiché (OI, nombre de strikes, âge du dernier trade), valeurs masquées sous seuil.

**Ce qui existe déjà.** Tout est limité à BTC/ETH : DEVISES (OptionsWindow.tsx:144), DeviseDeribit (chaineOptionsCache.ts:16), fetchDeribitOptionChain(currency: BTC|ETH) avec filtre parsed.currency === currency (deribit.ts:273, :288), index `${currency}_usd` (:277), deriveDvolCurrency (VolWindow.tsx:67-71). parseOptionInstrument rejette « SOL_USDC-… », car [A-Z]+ n'accepte pas le souligné (deribit.ts:91). Il rejetterait aussi un strike décimal noté « d », convention Deribit présumée pour XRP mais non vérifiée ici. Bybit : adaptateur spot seulement (bybit.ts:2, :28). grep eapi.binance|category=option : rien.

**Réutilise.** mouvementsAttendus (apps/web/src/data/mouvementAttendu.ts:56), termStructureIv, smile d'OMON, adaptateur Bybit (apps/web/src/data/bybit.ts:29).

**Point d'intégration.** Normaliser au niveau de l'adaptateur. OptionPoint suppose des marks en unités de base, multipliés ensuite par le forward (deribit.ts:252-253, mouvementAttendu.ts:6-8, probaImplicite.ts:6 et :83-84), et une IV en % (deribit.ts:237). Pour des options linéaires USDC/USDT : markPrice = mark_USD / forward ; IV de Bybit ×100 (fraction présumée, non vérifiée). Deribit : get_book_summary_by_currency currency=USDC kind=option filtré par préfixe, sur le même hôte. Bybit : nouveau data/bybitOptions.ts en appel direct (api.bybit.com déjà dans connect-src vercel.json:136, CORS * selon bybit.ts:18-19). OMON : DEVISES étendues et choix de la place, avec réutilisation de mouvementsAttendus (mouvementAttendu.ts:56), termStructureIv (termIv.ts:35) et calculerSkew25d (skew.ts:57). Exclure le GEX et les niveaux du graphe pour les alts.

**Sources.**

- Deribit options linéaires USDC (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : SOL/XRP lancées en mars 2024, réglées en USDC (vérifié) ; retour par currency=USDC non vérifié.
- Bybit V5 tickers category=option (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Options XRP/DOGE/MNT en USDT depuis octobre 2025 (communiqué vérifié) ; champs vus dans des SDK tiers.
- Binance Options eapi (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Hôte eapi.binance.com nouveau ; /eapi/v1/mark public avec greeks (doc vue par WebSearch) ; 451 depuis Vercel probable, non vérifié.

**Contrat.** Pas de nouvel EXCHANGE_ID (BUILD-CONTRACT.md:25) : Deribit est déjà une source d'options et Bybit fait partie des 9. L'extension d'OMON (et éventuellement de VOL) demande une exception G100. Binance eapi serait un hôte nouveau d'un fournisseur existant. Par /extapi sur Vercel, les IP serverless Binance répondent 451 (précédent fapi, extapi.ts:5-6). Il faudrait donc un appel direct, un ajout dans connect-src (docs/csp-vercel.md:45-49) et un CORS non vérifié. Pas de clé. Budget initial intact si le code reste dans le chunk OMON. Effort L tel que rédigé, M sur le périmètre reformulé.

**Risques.** Chaînes minces : les marks sont des valeurs de modèle, smile et RR bruités. OI et taille de contrat SOL/XRP non vérifiés. Pas de DVOL pour les alts, donc ni IV rank ni cône IV/RV (useOptionsDeribit.ts:19). La VRP et l'ATM à maturité constante dépendent de l'historique de SUG-20. Restrictions géographiques de Bybit pour les visiteurs du site public : non vérifiées. CGU Bybit et Binance pour un affichage public : non vérifiées. Existence et liquidité des options XRP/DOGE chez Bybit et SOL/XRP chez Deribit non revérifiées dans cette passe (recherche web épuisée).

**Intérêt analytique.** faible ; verdict utile_avec_reserve. L'idée est cohérente avec le profil (alts en swing) mais à la limite du gadget : la valeur informative de chaînes minces n'est pas démontrée et l'audit de liquidité doit décider avant tout développement d'interface. Garder Deribit et Bybit, sans hôte nouveau ; exclure Binance eapi. Si l'IV ne bat pas la vol réalisée déjà calculée, ne rien afficher. Faits externes non revérifiés dans cette passe.

**Références.**

- Christensen & Prabhala (1998), Journal of Financial Economics, « The relation between implied and realized volatility » : l'IV prévoit bien la vol sur un indice liquide (mémoire, non revérifié)
- Poon & Granger (2003), Journal of Economic Literature, revue sur la prévision de volatilité (mémoire, non revérifié)
- Corsi (2009), Journal of Financial Econometrics, modèle HAR-RV, référence de comparaison (mémoire, non revérifié)
- Lancement des options Deribit SOL/XRP en USDC (mars 2024) et des options Bybit XRP/DOGE (octobre 2025) : vérifiés par l'étape précédente, non revérifiés ici. Aucune étude sur l'information des options d'alts n'a pu être recherchée dans cette passe
- Interne : apps/web/src/data/deribit.ts:90-91 (la regex rejette « SOL_USDC »), apps/web/src/components/VolWindow.tsx:64-68 (DVOL BTC/ETH seulement), packages/indicators/src/volatility/yangZhangVol.ts, parkinsonVol.ts, garmanKlassVol.ts (vol réalisée des alts déjà calculable)
- BUILD-CONTRACT.md:25 (9 EXCHANGE_IDS ; Bybit et Binance sont des fournisseurs existants)

**Redondance.** Moyenne. La volatilité réalisée des alts existe déjà (Yang-Zhang, Parkinson, Garman-Klass, cône de vol de VolWindow). L'apport serait la seule composante implicite et le skew des alts. mouvementsAttendus, termIv et skew sont génériques mais branchés sur la chaîne BTC/ETH.

**Pièges.** (a) Liquidité : OI et volumes faibles (non chiffrés, non vérifiés). La mark IV est la surface du modèle de chaque plateforme, pas des prix traités : IV figée et skew artificiel sont probables. Les modèles de mark de Deribit et Bybit diffèrent. (b) Biais de sélection : masquer sous un seuil revient à n'afficher l'IV qu'en période animée. (c) Les options linéaires USDC ont des greeks différents des inverses. Étendre parseOptionInstrument expose à une régression sur BTC/ETH. (d) Binance eapi : nouvel hôte, blocage géographique probable depuis les régions US de Vercel (non vérifié), CGU non vérifiées pour un site public. (e) DOGE n'a qu'une plateforme. (f) Aucune série longue d'IV d'alt publique n'est connue : la prime de variance des alts ne peut être mesurée que de façon prospective.

**Protocole de validation.** Étape 0, décisive et sans interface : audit de liquidité prospectif sur 30 j à partir d'un agrégat quotidien (OI, nombre de strikes avec mark et trade de moins de 24 h, écart bid/ask), seuils figés à l'avance. Un actif sous le seuil est abandonné. Étape 1 : chaque lundi 08:00 UTC, figer l'IV ATM 7 j et la comparer à la vol réalisée des 7 j suivants. Sur au moins 26 semaines jamais vues, comparer les pertes QLIKE et MSE à des références déjà calculables : vol réalisée 30 j Yang-Zhang et HAR-RV. L'apport n'est retenu que si l'IV bat ces références. La couverture ±1σ hebdomadaire est rapportée telle quelle. L'écart Deribit/Bybit sert de contrôle qualité, pas de preuve d'utilité.

**Preuve d'intérêt (idéation).** Le propriétaire trade des alts en swing et aucune amplitude implicite d'alt n'existe (VolWindow.tsx:68). La prime mesurée sur BTC ne se transpose pas sans mesure par actif.

**Mesure de succès.** Par alt : OI au-dessus du seuil et ≥ 8 strikes par échéance pendant 30 j ; couverture ±1σ hebdomadaire documentée ; écart d'IV ATM 30 j Deribit/Bybit < 5 pts sur SOL et XRP.

**Fichiers à toucher.**

- apps/web/src/data/deribit.ts (regex, chaîne USDC, normalisation linéaire)
- apps/web/src/data/deribit.test.ts
- apps/web/src/data/bybitOptions.ts (nouveau)
- apps/web/src/data/bybitOptions.test.ts
- apps/web/src/hooks/useOptionsDeribit.ts
- apps/web/src/components/OptionsWindow.tsx
- apps/web/src/data/mouvementAttendu.ts (documentation des unités)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : Chaînes SOL, XRP et DOGE minces : les marks sont modélisés, le skew est artificiel. Pas de DVOL pour les alts. Valeur faible tant que la liquidité n'est pas chiffrée (non vérifiée).
- cout-risque (2) : Chaînes minces : les marks sont des valeurs de modèle, smile et RR artificiels. Accès Bybit depuis certaines juridictions et CGU d'affichage public non vérifiés. Normalisation de deux modèles de mark différents. Pas de DVOL alts. Coût de maintenance élevé pour une valeur affichée fragile.
- coherence (3) : La normalisation vers OptionPoint réutilise les vues OMON. Mais il faut deux nouveaux adaptateurs de chaînes (Deribit USDC et Bybit option) sur des données minces, sans DVOL, et Binance eapi est écarté à juste titre.

### 43. SUG-32 — Taux d'emprunt et utilisation des stablecoins sur Aave v3, comparés au funding perp et au T-bill (levier on-chain)

**Score 9/20** · valeur 2 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : non · exception fournisseur : non · exception G100 : oui · catégorie : nouvelle source · origines : ETH-3

**Question de trading.** Le levier se construit-il aussi au comptant on-chain, et un taux d'emprunt USDC nettement au-dessus du T-bill et du funding perp signale-t-il un marché sur-endetté exposé à une cascade ?

**Proposition retenue après vérification.** Lire, après une sonde, le taux d'emprunt et l'utilisation USDC et USDT d'Aave v3 Ethereum (marché Core) via DefiLlama yields (chartLendBorrow avec la clé Pro serveur existante, chemin ajouté à la liste fermée). Les afficher en ligne FUNDX et les proposer comme financement dans le CarryPanel. La prime se calcule comme taux d'emprunt converti en simple act/365 − T-bill 3 mois. Aucun nouveau fournisseur, aucun instantané daemon. Le RPC PublicNode n'est envisagé, sous exception, que pour la valeur courante.

**Proposition initiale.** Lecture quotidienne des réserves Aave v3 Ethereum (USDC, USDT, WETH) : taux variable d'emprunt, taux de dépôt, utilisation. Prime de levier DeFi = taux d'emprunt USDC − T-bill 3 mois, et écart au funding perp APR BTC/ETH. Ligne « Aave v3 (emprunt USDC) » dans FUNDX, puis aux quotidienne en pane ; historique constitué par instantané quotidien dans le KV du daemon si aucune source historique gratuite n'est confirmée.

**Ce qui existe déjà.** Aucune lecture de taux Aave : grep aave ne trouve que des slugs ou libellés (apps/web/src/data/secteurs.ts:85 ; apps/web/src/data/protocolRevenue.ts:50). Le CarryPanel de FUNDX demande déjà un « Intérêt d'emprunt supposé », saisi à la main (apps/web/src/components/fundx/CarryPanel.tsx:28, :81) : point d'accroche naturel. Le T-bill est déjà interpolé et converti en taux simple act/365 (apps/web/src/data/portageExcedentaire.ts:8-20, :31-39). DefiLlama Pro est intégré avec une liste fermée de chemins (shared/defillama-proxy.ts:5-17) et une clé serveur possible (shared/server-credentials.ts:10). Aucun chemin yields n'est présent (grep « yields » vide). L'opérateur PublicNode est déjà en connect-src pour Solana (vercel.json:136 ; apps/web/src/data/onchain/solana.ts:31).

**Réutilise.** Série T-bill de portageExcedentaire, matrice FUNDX, KV et instantanés du daemon (patron TERM), etudeEvenements.

**Point d'intégration.** Voie privilégiée, fournisseur existant : DefiLlama yields. Le chemin Pro /yields/chartLendBorrow/{pool} donnerait, au quotidien, apyBaseBorrow, totalSupplyUsd et totalBorrowUsd, donc le taux d'emprunt et l'utilisation historiques. On l'ajoute à cheminDefillamaAmont avec un pool fixé (USDC et USDT Aave v3 Ethereum Core), servi par la clé serveur DefiLlama Pro. Repli gratuit : yields.llama.fi/chart/{pool}, qui ne donne que l'APY de dépôt et la TVL (nouvel hôte du même fournisseur, à ajouter à connect-src ou à /extapi). Ces deux chemins ne sont pas vérifiés en ligne dans cette session : sonde obligatoire. Affichage : ligne « Aave v3 (emprunt USDC) » dans FUNDX (apps/web/src/components/FundingMatrixWindow.tsx:69, :133) et proposition de valeur dans le CarryPanel. Le calcul de prime réutilise chargerRendementsUS. Le RPC PublicNode (eth_call getReserveData) ne sert que de repli pour la valeur courante.

**Sources.**

- RPC Ethereum public PublicNode (eth_call getReserveData) (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : non) : Hôte ethereum-rpc.publicnode.com cité dans des exemples tiers ; limites non publiées ; non vérifié en ligne.
- Aave v3 GraphQL (api.v3.aave.com) (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Appelé sans clé dans le guide MetaMask (vérifié) ; historique et CGU non vérifiés.

**Contrat.** Par DefiLlama : pas de nouveau fournisseur, mais les chemins fermés de DefiLlama doivent être rouverts explicitement (BUILD-CONTRACT.md:1305). Par le RPC PublicNode ou l'API Aave : exception « nouveau fournisseur » (BUILD-CONTRACT.md:80). Dans tous les cas, exception G100 pour une ligne nouvelle dans FUNDX (BUILD-CONTRACT.md:71). La règle « aucun agrégat multi-places » (BUILD-CONTRACT.md:1396) vise les places perp de DES et ne s'applique pas ici. Clé : DefiLlama Pro côté serveur, quota du propriétaire (BUILD-CONTRACT.md:1285-1290). Pas d'enregistreur si l'historique vient de DefiLlama. Avec le RPC, l'historique exigerait des instantanés quotidiens daemon, absents sur Vercel. Aucun nouvel AuxSeriesId tant qu'on reste dans FUNDX.

**Risques.** Comparabilité des taux : l'APY Aave est composé et variable, le funding est un APR simple, le T-bill est en BEY. Une conversion commune s'impose (conventions déjà écrites dans portageExcedentaire.ts:8-20). Courbe de taux coudée : des pics mécaniques apparaissent au-delà de l'utilisation optimale, et les récompenses ou incitations faussent le taux net. Aave v3 Ethereum a deux marchés (Core et Prime), chacun avec un pool USDC : il faut en choisir un et le nommer. Stabilité des identifiants de pool DefiLlama non vérifiée. Conditions d'affichage public de DefiLlama Pro non vérifiées. L'API GraphQL Aave n'est pas vérifiée (clé, historique, conditions) : aave.com est injoignable depuis ce conteneur. Le RPC public a des limites non publiées et ne donne qu'un instantané, l'historique par eth_call demandant un nœud d'archive (non vérifié). Aucune étude publiée sur le pouvoir prédictif propre de ce taux : l'étude d'évènements (validationSignaux.ts) doit précéder toute lecture en signal.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. À conditionner à une source historique. Piste à sonder d'abord : DefiLlama Pro, avec la clé serveur déjà en place. Ce ne serait qu'un chemin borné de plus dans cheminDefillamaAmont pour un fournisseur existant, donc moins d'exception que le RPC ou le GraphQL. La voie RPC PublicNode passe par un opérateur déjà utilisé, mais sur un nouvel hôte, avec des limites non publiées et une valeur instantanée seulement. Sans historique, c'est un gadget à court terme. Une seule plateforme nommée (Aave v3 Ethereum), conformément à BUILD-CONTRACT.md:1396.

**Références.**

- Limite de cette passe : WebSearch épuisé, www.bis.org et api-docs.defillama.com non résolus. Faits externes non vérifiés.
- Schmeling, Schrimpf et Todorov, « Crypto carry », BIS Working Papers n° 1087 (2023) : un carry élevé lié à la demande de levier précède des krachs. Porte sur la base des futures, pas sur le prêt DeFi. Non vérifié dans cette passe.
- Cornelli, Gambacorta, Garratt et Reghezza, « Why DeFi lending? Evidence from Aave V2 », BIS WP (2024) : l'emprunt DeFi sert surtout au levier spéculatif. Cité de mémoire, non vérifié.
- Gudgeon et al. (2020), « DeFi Protocols for Loanable Funds » : taux fonction de l'utilisation, avec un coude. Non vérifié.
- DefiLlama Pro, routes yields chartLendBorrow et poolsBorrow (historique quotidien emprunt, dépôt, utilisation) : de mémoire, non vérifié.
- apps/web/src/data/fundingCrossExchange.ts:195 ; apps/web/src/data/fundingCarry.ts:26 ; apps/web/src/data/portageExcedentaire.ts:115 ; indicateurs fundingApr, fundingZScore, fundingDispersion, basisPct, quarterlyBasis
- shared/server-credentials.ts:11 (DEFILLAMA_API_KEY côté serveur) ; shared/defillama-proxy.ts:5-17 (chemins Pro bornés : emissions, emission, bridgevolume)
- vercel.json:136 et apps/web/src/data/onchain/solana.ts:31 (PublicNode déjà utilisé, pour Solana)
- apps/web/src/data/validationSignaux.ts:110 et :187
- BUILD-CONTRACT.md:80 et :1396

**Redondance.** Forte sur le concept : funding sur 4 places, APR, z-score, dispersion, carry exécutable et portage basis − T-bill mesurent déjà la demande de levier. Le taux USDC d'Aave est arbitré contre le funding (cash-and-carry on-chain, boucles USDe/PT), donc une forte corrélation est attendue. Aucune donnée de prêt DeFi n'existe dans le code (grep « aave » : libellés seulement).

**Pièges.** 1) Pas d'historique gratuit confirmé. Des instantanés quotidiens du daemon demandent des mois avant tout test et laissent des trous quand le daemon dort.
2) Ruptures de structure : la gouvernance modifie les paramètres du modèle de taux (utilisation optimale, pentes) et les plafonds. Le coude vers 90 % d'utilisation rend la série non linéaire.
3) Demande structurelle non directionnelle : boucles sUSDe/PT d'Ethena et incitations. Un taux élevé n'est pas forcément du levier directionnel.
4) Une seule plateforme et une seule chaîne.
5) Taux instantané ou moyenne du jour à trancher ; T-bill absent le week-end et les jours fériés (alignement).
6) Un p90 calé sur 2023-2026, un seul cycle, est sur-ajusté.

**Protocole de validation.** 1) Lot 0 : sonder la profondeur d'historique, d'abord DefiLlama Pro yields puis le GraphQL d'Aave, et vérifier ±5 pb par rapport à l'interface.
2) Si l'historique remonte à 2023 : figer la définition (prime = taux variable d'emprunt USDC − T-bill 3 mois, moyenne du jour UTC) et le seuil p90, calculé sur 2023-2024 seulement. Horizon 7 j, drawdown maximal de BTC et ETH. Un seul test sur 2025-2026, que le projet n'a jamais lu.
3) Comparaison emboîtée : funding seul contre funding + prime, évènements déclustérisés par hystérésis. Ne retenir la prime que si elle ajoute au funding.
4) Sans historique : affichage descriptif seulement, pas de lecture en signal avant 12 mois d'instantanés.

**Preuve d'intérêt (idéation).** BIS WP 1087 : un carry élevé alimenté par la demande de levier prédit les krachs (vérifié) ; le taux Aave en est l'équivalent au comptant on-chain via la courbe de taux. Pas d'étude revue par des pairs sur son pouvoir propre : à mesurer.

**Mesure de succès.** Taux = interface Aave à ±5 pb ; ≥ 90 % des jours couverts ; event study prime > p90 contre drawdowns BTC/ETH à 7 j, comparée au funding perp seul.

**Fichiers à toucher.**

- shared/defillama-proxy.ts
- api/_policy.ts (vérifier la liste fermée et le test associé)
- apps/web/src/data/onchain/defillamaPro.ts ou apps/web/src/data/tauxAave.ts (nouveau)
- apps/web/src/components/FundingMatrixWindow.tsx
- apps/web/src/components/fundx/CarryPanel.tsx
- apps/web/src/data/portageExcedentaire.ts (réutilisation de la conversion T-bill)
- vercel.json et docs/csp-vercel.md (seulement si yields.llama.fi ou un RPC est appelé en direct)

**Avis des juges.**

- valeur (2) : Mesure de niche pour un swing BTC et alts, sans historique gratuit confirmé, avec des conventions de taux hétérogènes. Le funding et le portage, déjà présents, répondent en grande partie à la question du levier.
- cout-risque (2) : Il faut rouvrir les chemins fermés DefiLlama Pro (BUILD-CONTRACT.md:1305) sur la clé du propriétaire. Aucun historique gratuit confirmé. Conventions de taux hétérogènes (APY composé, APR, BEY). Paramètres de gouvernance changeants. Note : PublicNode est déjà en CSP pour Solana (vercel.json:136), donc Ethereum serait un nouvel hôte d'un fournisseur existant. Fragile pour un intérêt faible.
- coherence (3) : Le CarryPanel de FUNDX (fundx/CarryPanel.tsx) est la bonne place. Mais il faut rouvrir les chemins fermés de DefiLlama, et la voie RPC PublicNode ou Aave est un nouveau fournisseur. Pas d'historique gratuit confirmé.

### 44. SUG-33 — Fiche on-chain d'un alt : rachats et distributions contre dilution réalisée, multiple P/F historique, concentration des détenteurs et liquidité des pools DEX

**Score 9/20** · valeur 2 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial L) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain ETH, DeFi et stablecoins · origines : ETH-4, ETH-6, ETH-7

**Question de trading.** Pour un token de protocole, l'offre qui arrive dépasse-t-elle ce que le protocole rachète, le token est-il cher face à son propre historique, son flottant est-il tenu par quelques portefeuilles, et la liquidité DEX suffit-elle pour ma taille ?

**Proposition retenue après vérification.** Fiche « valorisation et dilution » d'un token de protocole, sans nouveau fournisseur :
(a) revenus détenteurs DefiLlama à côté des frais et revenus. Le dataType est à confirmer par un appel réel ; à défaut, la ligne est absente, jamais à zéro.
(b) P/F et P/S annualisés sur 30 j, avec percentile causal sur 365 j. Capitalisation et prix viennent de market_chart, déjà autorisé ; le revenu est décalé d'un jour.
(c) Dilution réalisée 30/90 j tirée des séries cumulées DefiLlama Pro quand la clé existe, sinon offre déclarée CoinGecko avec l'étiquette « déclarative ».
(d) Rendement net détenteur = revenus détenteurs annualisés − dilution annualisée valorisée.
Le tout dans NouveauxTokensPanel et SECT.
Pools DEX : lot séparé et optionnel, réservé aux tokens sans paire CEX majeure, via la route CoinGecko existante (chemins onchain bornés). Coût AMM affiché seulement pour les pools à produit constant.
Concentration des détenteurs : écartée tant qu'aucune source d'étiquettes fiable n'existe.

**Proposition initiale.** (1) DefiLlama dailyHoldersRevenue à côté du revenu tracé ; offre circulante ≈ capitalisation/prix (CoinGecko market_chart) ; dilution réalisée 30/90 j ; rendement net détenteur ; P/F et P/S avec percentile 365 j dans le pane AXIOM_REVENUE, SECT et EQS. (2) Concentration : top 20 comptes Solana (getTokenLargestAccounts + propriétaires) et top 100 EVM (Ethplorer getTopTokenHolders), exclusion exchanges/burn/LP/vesting, part du top 10 et HHI, variation contre J-7. (3) Pools DEX via les endpoints on-chain CoinGecko : réserve, volume, achats/ventes 1 h/24 h, coût estimé d'un ordre (AMM étiqueté approximation), variation de réserve, écart DEX − CEX. Bloc dans NouveauxTokensPanel et SECT.

**Ce qui existe déjà.** Revenus : protocolRevenue ne demande que dataType=dailyRevenue (apps/web/src/data/protocolRevenue.ts:35-36). Le pane AXIOM_REVENUE applique un forward-fill à l'OUVERTURE de bougie (apps/web/src/chart/revenue.ts:89-105). P/F, P/S, float et multiple de dilution existent, mais en instantané seulement (apps/web/src/data/nouveauxTokens.ts:155-162, :603). Les quatre piliers ne comptent aucune concentration (nouveauxTokens.ts:134-143).
NON CITÉ par l'idée : unlocks et émissions déjà intégrés via DefiLlama Pro (clé payante, aussi variable serveur DEFILLAMA_API_KEY, shared/server-credentials.ts:10). On y trouve le calendrier, les ratios unlock/flottant et unlock/volume 24 h, et les séries cumulées unlocked/rawEmission/burned (apps/web/src/data/onchain/defillamaPro.ts:12-42, :132-160 ; apps/web/src/components/DefillamaProPanel.tsx:149, :172).
CoinGecko : market_chart est déjà autorisé sur la route à clé serveur (api/_policy.ts:322) et lu sur 365 j (apps/web/src/data/mcap.ts:358-359). Au-delà, erreur 10012 (apps/web/src/store/macroHistory.ts:9).
Absents (grep) : holdersRevenue, ethplorer, geckoterminal, onchain/networks, getTokenLargestAccounts, pools DEX.
whaleLabels vit dans le daemon (apps/daemon/src/whaleLabels.ts). Ce sont des étiquettes d'exchanges BTC/ETH, inutilisables dans le navigateur sur Vercel.
Le coût d'exécution ne porte que sur le carnet CEX (apps/web/src/data/depthExecution.ts:30).

**Réutilise.** resolveProtocolSlug et fetchProtocolRevenue (protocolRevenue.ts:152-168), route coingeckoapi market_chart, pane revenue.ts, RPC Solana (apps/web/src/data/onchain/solana.ts:31), whaleLabels, logique de depthExecution.

**Point d'intégration.** (1) Valorisation. Paramétrer dataType dans summaryUrl (protocolRevenue.ts:35) et ajouter un module pur de valorisation : P/F et P/S annualisés, percentile 365 j, dilution, rendement net. Ce module est consommé par NouveauxTokensPanel (monté dans SectWindow.tsx:273-275 et ScreenerWindow) ; le pane AXIOM_REVENUE reste inchangé ou reçoit une 2e figure. Sources de la dilution : seriesCumulees Pro (defillamaPro.ts:132-150) si la clé existe, sinon offre ≈ market_caps/prices de market_chart (route déjà ouverte).
(3) Pools. Ajouter des regex onchain/networks/… bornées à serverPathAllowed coingeckoapi (api/_policy.ts:322) et au test apps/daemon/src/vercelServerCredentials.test.ts. En local, appel direct : api.coingecko.com figure déjà dans connect-src (vercel.json).
(2) Ethplorer, si retenu malgré tout. Nouvelle route fixe : FIXED_ROUTES, ROUTE_IDS, ROUTE_PROVIDER et QUERY_CREDENTIAL (api/_policy.ts:46-77, :291-297), PROVIDER_ENV, proxys daemon et Vite.
Piège : le paramètre `apiKey` (casse mixte, selon la doc Ethplorer, non revérifié ici) échappe à l'expurgation des secrets. api/_policy.ts:485 compare `name === "apikey"` en respectant la casse, et la boucle anti-doublon fait de même.

**Sources.**

- DefiLlama fees dailyHoldersRevenue (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : dataType attesté par des sources tierces ; paramètre exact sur /summary non confirmé par la doc officielle.
- Ethplorer getTopTokenHolders (nouvelle ; clé gratuite ; vérifiée en ligne par l'idéation : oui) : Clé personnelle gratuite, 10 req/s, mention « Powered by Ethplorer » exigée (wiki officiel via WebSearch) ; Ethereum seulement.
- CoinGecko Demo endpoints on-chain (données GeckoTerminal) (nouvelle ; clé Demo gratuite (serveur) ; vérifiée en ligne par l'idéation : oui) : « On-chain endpoints » inclus dans l'offre Demo selon la page tarifs (vérifié) ; disponibilité de chaque chemin non vérifiée ; repli api.geckoterminal.com 30 appels/min.

**Contrat.** G100 : aucune fenêtre, mais des lignes et blocs nouveaux dans NouveauxTokensPanel et SECT forment une fonctionnalité de surface. Il faut donc une exception nommée.
Version resserrée : aucun nouveau fournisseur, puisque DefiLlama, DefiLlama Pro et CoinGecko sont déjà acquis. En revanche, ouvrir des chemins onchain sur la clé Demo du propriétaire élargit la liste fermée serverPathAllowed, ce qui doit être acté.
Version d'origine : Ethplorer est un nouveau fournisseur avec nouvelle clé serveur et mention « Powered by Ethplorer » exigée, donc une exception (BUILD-CONTRACT.md:80). GeckoTerminal en direct ajouterait aussi un hôte.
Pas d'impact sur le budget initial si le chargement se fait à l'ouverture du panneau. Aucun enregistreur.

**Risques.** Données révisées : les revenus DefiLlama sont recalculés a posteriori.
Look-ahead : le revenu du jour J est daté de J 00:00 et reporté dès l'ouverture (revenue.ts:89-105). Un percentile P/F calculé par bougie doit donc être décalé d'un jour.
Offre circulante CoinGecko déclarative : un changement de méthodologie crée une fausse « dilution ».
Historique limité à 365 j (market_chart).
Le dataType holdersRevenue n'est pas confirmé par la doc officielle ; non revérifié ici (budget de recherche web épuisé).
Pools : l'estimation à produit constant est fausse pour la liquidité concentrée (v3/CLMM). Le quota Demo est partagé avec CAP/SECT. Pour les grands actifs, l'écart DEX−CEX relève du bruit.
Concentration : sans étiquettes exchange/LP/vesting/bridge, top 10 et HHI trompent. PublicNode bride déjà getSupply (apps/web/src/data/onchain/solana.ts:15-18) ; getTokenLargestAccounts n'a pas été testé.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. La partie utile est le bilan dilution moins rachats, calculé à partir des émissions DefiLlama déjà intégrées plutôt qu'à partir de capitalisation/prix. Le percentile de P/F peut s'y ajouter, avec la mention « série révisée ». L'effort L se réduit alors à M, sans nouveau fournisseur : DefiLlama est déjà utilisé et dailyHoldersRevenue reste à confirmer en réel.
La concentration (Ethplorer, nouveau fournisseur avec obligation de citer la source) et les pools DEX (chemins on-chain de CoinGecko) n'ont pas de preuve d'intérêt documentée et posent un problème d'étiquetage des entités non résolu dans le dépôt. Ce sont des gadgets tant que ce problème n'est pas résolu : à différer.
Limites de vérification : le budget WebSearch était épuisé. Dans cette session, docs.coingecko.com, api-docs.defillama.com, arxiv.org et docs.growthepie.com ne se résolvent pas, seul github.com répond. L'offre Demo on-chain de CoinGecko reste donc non revérifiée ici.

**Références.**

- Keyrock, étude des déblocages de tokens (2024, plus de 16 000 évènements) : environ 90 % exercent une pression baissière, avec un effet qui commence environ 30 j avant. Vérifié par l'étape amont, non revérifié ici : le budget WebSearch partagé (200 recherches) était épuisé dès ma première requête.
- DefiLlama dimension-adapters, adapters/types.ts (lu sur github.com) : la clé dailyHoldersRevenue existe à côté de dailyRevenue, dailyProtocolRevenue et dailySupplySideRevenue. Rien ne la décrit (rachats, burns, distributions ?). Je n'ai pas pu vérifier qu'elle est acceptée comme dataType de /summary/fees : api-docs.defillama.com ne se résout pas depuis la session.
- Wiki Ethplorer API (github.com/EverexIO/Ethplorer/wiki/Ethplorer-API, lu) : getTopTokenHolders renvoie au plus 1000 détenteurs avec une clé personnelle gratuite (100 avec freekey), à 10 req/s. Le wiki exige de « place references to the Ethplorer API on your website » ; la formule « Powered by Ethplorer » ne figure pas mot pour mot. Les conditions renvoient à ethplorer.io/privacy, sans clause explicite sur un site public. Aucun historique des principaux détenteurs n'est documenté.
- Cong, Karolyi, Tang, Zhao (2022), « Value Premium, Network Adoption, and Factor Pricing of Crypto Assets » : facteur valeur fondé sur l'adoption. Cité de mémoire, non revérifié.
- arXiv 2506.08718 (découverte du prix sur les CEX) : non revérifié, arxiv.org ne se résout pas depuis la session.
- apps/web/src/data/onchain/defillamaPro.ts:42,147 : séries cumulées unlocked, rawEmission et burned déjà chargées.
- apps/web/src/data/onchain/defillamaPro.ts:155-160 : calculerRatiosUnlock donne le % du flottant et le % du volume 24 h.
- apps/web/src/data/signaux.ts:371-393 : signal « Surchauffe low-float ».
- apps/web/src/data/nouveauxTokens.ts:158-163, :467-493 : P/F, P/S et take rate instantanés.
- apps/daemon/src/whaleLabels.ts:1-13 : liste courte et statique d'adresses d'exchanges ; le regroupement d'entités y est déclaré hors budget.

**Redondance.** Élevée sur la dilution. Les émissions DefiLlama Pro (déblocages et burns cumulés) sont déjà chargées (defillamaPro.ts:42,147). Le calendrier et ses ratios existent (defillamaPro.ts:155). Ils s'affichent dans « Unlocks / bridges » de SECT et de MCAP (SectWindow.tsx:264, McapWindow.tsx:432). Les signaux « Surchauffe low-float » et « Accumulation revenus vs prix » croisent déjà dilution et revenus (signaux.ts:360-393). P/F, P/S, take rate, flottant et FDV/TVL existent pour les nouveaux tokens (nouveauxTokens.ts:158-163). Le pane de revenus existe (apps/web/src/chart/revenue.ts:28-30). Réellement nouveau : le revenu versé aux détenteurs, le percentile historique de P/F, la concentration et les pools DEX. Le module « whaleLabels » cité comme réutilisable n'existe pas dans apps/web. Il n'existe que dans le daemon, limité aux adresses d'exchanges BTC et ETH, et ne permet pas d'exclure les LP, les contrats de vesting, les bridges ou les multisigs.

**Pièges.** Révision des données : les adaptateurs DefiLlama sont réécrits et recalculés en arrière, donc la série de revenus n'est pas datée au moment de sa publication. Un percentile 365 j recalculé aujourd'hui diffère de ce qu'on aurait vu à l'époque : c'est un look-ahead en backtest.
Offre circulante calculée comme capitalisation/prix (CoinGecko) : chiffre déclaré par les projets et mis à jour par paliers, ce qui crée une dilution fictive. Il vaut mieux partir des émissions DefiLlama déjà chargées, ou de tokensupply on-chain déjà autorisé (api/_policy.ts:312-317).
dailyHoldersRevenue : définition hétérogène selon l'adaptateur. Un rachat financé par la trésorerie peut être confondu avec un rachat financé par les revenus, et un burn peut être compté deux fois (revenu et baisse d'offre).
Concentration : un simple instantané sans historique documenté, donc aucun backtest avant des mois d'archive. L'exclusion des exchanges, LP, vesting et bridges est un problème de regroupement d'entités, déclaré hors budget (whaleLabels.ts:5-8). Ethplorer couvre Ethereum seulement. Côté Solana, getTokenLargestAccounts renvoie 20 comptes de token à rattacher à leurs propriétaires, via un RPC public limité (solana.ts:31).
Pools DEX : pour un alt coté sur Binance, l'écart DEX − CEX est surtout du bruit d'arbitrage et de latence. En liquidité concentrée (v3 et pools similaires), la réserve n'est pas la liquidité disponible au prix courant : le coût calculé en x·y = k est faux. Le volume DEX peut être gonflé par du wash trading.
Biais du survivant : la table curée TOKEN_TO_PROTOCOL (protocolRevenue.ts:48-70) ne contient que des survivants.
Quota Demo CoinGecko partagé avec CAP et SECT.

**Protocole de validation.** Scinder l'idée et ne tester que la partie (1).
Manifeste figé avant téléchargement : univers = tous les tokens qui ont une série d'émissions DefiLlama et un revenu à la date de gel, délistés compris si possible, sinon déclarer le biais du survivant.
Variable : pression nette sur 30 j = (valeur débloquée − revenus versés aux détenteurs) / capitalisation.
Évènement : décile supérieur, figé à l'avance.
Mesure : rendement relatif contre BTC à 30 j, sur fenêtres non chevauchantes.
Nul par permutation des étiquettes de tokens au sein de chaque mois ou par décalage circulaire, sur le modèle de scripts/valider-axis-flux.ts.
Exploration avant la date de gel, puis un seul test sur les mois postérieurs jamais vus, avec au moins 50 évènements, sinon NON CONCLUANT.
Comme les revenus DefiLlama sont révisés, archiver dès maintenant des instantanés datés et ne publier qu'un verdict « sur valeurs révisées ».
Concentration et DEX : aucun test de rendement, seulement une validation de la mesure (écart avec l'explorateur ou GeckoTerminal), étiquetés « filtre de risque, estimation ».

**Preuve d'intérêt (idéation).** Keyrock (2024, > 16 000 déblocages) : 90 % exercent une pression baissière, effet ~30 j avant (vérifié). Krachs de tokens concentrés en 2026 (presse) mais aucune étude rigoureuse : filtre de risque, pas signal. Découverte du prix sur CEX pour les grands actifs (arXiv 2506.08718), intérêt DEX limité aux tokens natifs on-chain.

**Mesure de succès.** Revenus détenteurs = DefiLlama à ±1 % sur 5 protocoles ; top 10 = explorateur à ±1 pt sur 10 tokens ; réserve/volume = GeckoTerminal à ±1 % ; ≤ 3 appels par fiche et < 20 % du quota Demo mensuel.

**Fichiers à toucher.**

- apps/web/src/data/protocolRevenue.ts
- apps/web/src/data/protocolRevenue.test.ts
- apps/web/src/data/valorisationProtocole.ts (nouveau, pur)
- apps/web/src/data/valorisationProtocole.test.ts (nouveau)
- apps/web/src/data/nouveauxTokens.ts
- apps/web/src/components/NouveauxTokensPanel.tsx
- apps/web/src/data/onchain/defillamaPro.ts (réutilisation des séries cumulées)
- apps/web/src/data/mcap.ts (réutilisation market_chart)
- api/_policy.ts (lot pools uniquement)
- apps/daemon/src/vercelServerCredentials.test.ts (lot pools uniquement)

**Avis des juges.**

- valeur (2) : Analyse fondamentale de tokens de protocole : utile en investissement, peu pour une décision swing 4h. Données DefiLlama révisées a posteriori, ce qui crée un look-ahead.
- cout-risque (2) : Composants multiples et fragiles : revenus DefiLlama révisés a posteriori (look-ahead), dataType holders non confirmé, quota CoinGecko Demo de 10 000/mois partagé, ouverture de chemins onchain sur la clé Demo, offre circulante déclarative. Maintenance lourde et risque élevé de dilution ou de multiple faux.
- coherence (3) : Les fournisseurs existent, mais la fiche s'étale sur deux surfaces (NouveauxTokensPanel, SECT) avec des séries révisées et le quota CoinGecko Demo partagé. Le volet pools DEX élargit la liste fermée.

### 45. SUG-11 — CVD par place côte à côte : Binance, OKX (Rubik taker-volume), Bybit et Coinbase (Coinalyze ohlcv-history), sans agrégation

**Score 8/20** · valeur 2 · coût-risque 2 · cohérence 2 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : volume et flux · origines : VOL-3, SRC-3

**Question de trading.** L'achat agressif est-il partagé par toutes les places ou isolé sur Binance pendant qu'OKX ou Coinbase vendent ?

**Proposition retenue après vérification.** Étape 0, hors interface : script de sémantique qui compare le bv de ohlcv-history pour le perp Binance au k[9] de fapi sur 500 bougies 1h et 4h. Corrélation ≥ 0,99, sinon abandon. Étape 1 : pane « Delta perp par place » limité aux perps Bybit, OKX et Hyperliquid à côté de Binance, via Coinalyze ohlcv-history, sur les marchés déjà résolus par marchesPerp. Aux facultatifs normalisés place par place, jamais sommés. Opt-in, en 1h, 4h et 1d, avec une seule requête par place, partagée et mise en cache. Rubik OKX et Coinbase spot n'entrent qu'après vérification de leur granularité, de leur rétention, de leur couverture et des CGU d'affichage public.

**Proposition initiale.** Pane « CVD par place » : une courbe normalisée par place, jamais additionnées. OKX via /api/v5/rubik/stat/taker-volume (SPOT ou CONTRACTS par devise) et taker-volume-contract ; Bybit, Hyperliquid et Coinbase via Coinalyze /v1/ohlcv-history (bv supposé volume acheteur, à confirmer). Divergences entre deux places détectées par detecterDivergencesSpotPerp généralisé. Contrôle de sémantique préalable : bv Coinalyze du marché Binance contre taker buy Binance.

**Ce qui existe déjà.** Le CVD par bougie est réservé à Binance (apps/web/src/chart/orderflow.calc.ts:47-49). Les flux de trades WS d'OKX, Bybit et Coinbase portent bien le côté agresseur (apps/web/src/data/okx.ts:18, apps/web/src/data/bybit.ts:15, apps/web/src/data/coinbase.ts:26), mais en direct seulement, sans historique. CryptoQuant donne un taker toutes places, quotidien, BTC/ETH (apps/web/src/data/onchain/cryptoquant.ts:17). Le client Coinalyze n'appelle ni ohlcv-history ni spot-markets (apps/web/src/data/coinalyze.ts:305-662), et la politique Vercel les refuse (api/_policy.ts:309). Le daemon (apps/daemon/src/proxy.ts:80-84) et Vite (apps/web/vite.config.ts:175-179) relaient tout chemin Coinalyze : seule la politique Vercel est à ouvrir. Aucun usage de Rubik (grep). La résolution des marchés perp par place existe (apps/web/src/data/marchesPerp.ts:318). Les aux facultatifs existent (packages/types/src/index.ts:393). detecterDivergencesSpotPerp est déjà générique sur deux séries (packages/indicators/src/orderflow/divergenceSpotPerp.ts:33-37).

**Réutilise.** resoudreMarchesPerp (apps/web/src/data/marchesPerp.ts:318), proxy /coinalyzeapi, divergenceSpotPerp, normalisation de cvdSpotPerp.

**Point d'intégration.** Ajouter `v1/ohlcv-history` à l'expression de serverPathAllowed (api/_policy.ts:309) et écrire fetchOhlcvHistory dans apps/web/src/data/coinalyze.ts, avec les identifiants de marché déjà résolus par marchesPerp. Ajouter une promesse partagée par (place, symbole, unité de temps) dans auxProvider, en réutilisant le mappage d'intervalles de liquidation-history (auxProvider.ts:566-579). Créer 2 à 3 AuxSeriesId de delta perp par place, déclarés en auxFacultatives d'une définition `cvdParPlace` : normalisation par l'écart-type propre à chaque place (patron cvdSpotPerp), jamais de somme. OKX Rubik passerait par un lecteur direct (www.okx.com est déjà en connect-src, vercel.json:136). Aucun nouvel hôte dans shared/extapi-hosts.ts.

**Sources.**

- OKX V5 Rubik taker-volume (nouvelle ; gratuit sans clé (www.okx.com déjà en connect-src) ; vérifiée en ligne par l'idéation : oui) : Chemins vérifiés via SDK (okxapi/python-okx) ; granularités et rétention vues dans des SDK tiers ; ordre des champs, quota et CORS non vérifiés.
- Coinalyze /v1/ohlcv-history (nouvelle ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : oui) : bv et btx présents dans l'exemple de réponse, sémantique non confirmée ; prise en charge des symboles spot non vérifiée ; 40 req/min par clé.

**Contrat.** Pas d'exception fournisseur : OKX fait partie d'EXCHANGE_IDS et Coinalyze est câblé (BUILD-CONTRACT.md:23, :25). Ouvrir ohlcv-history engage la clé serveur du propriétaire (shared/server-credentials.ts) pour tous les visiteurs. Des AuxSeriesId par place constituent un écart à @axiom/types (BUILD-CONTRACT.md:81). Une définition et un pane de plus demandent une exception G100 (:71, :82). L'affichage côte à côte sans somme reste compatible avec l'interdiction de l'AggregationEngine (:23). En revanche, la règle « une place à la fois » de la section perp de DES (:1396-1397) doit être amendée explicitement pour ce pane. CGU Coinalyze et OKX pour un affichage public : non vérifiées (api.coinalyze.net et www.okx.com sont injoignables depuis la session et le budget WebSearch est épuisé). L'effort est M pour le périmètre resserré et L tel que proposé.

**Risques.** (1) Quota : 40 requêtes par minute et par clé. Le débit n'est limité que par navigateur (apps/web/src/data/coinalyze.ts:49-50). Vercel n'a pas de limiteur côté serveur, et son cache public de 60 s (api/_policy.ts:378-381) sert peu, car les from/to diffèrent d'une requête à l'autre. Avec 3 places par graphe et plusieurs visiteurs, on risque des 429 qui priveraient aussi OI, funding et liquidations. (2) Sémantique de bv non confirmée : unités (contrats, base ou USD) qui varient selon la place, données révisées ou purgées. La rétention Coinalyze est d'environ 1 500 à 2 000 points intraday (docs/research/01-fournisseurs-api-indicateurs.md:13), soit 60 à 80 jours en 1h. (3) OKX Rubik taker-volume agrège toutes les paires d'une devise : ce n'est pas l'instrument du graphe. Granularités, rétention, quota et ordre des champs n'ont pas été revérifiés ici. (4) La couverture du spot Coinbase par Coinalyze n'est pas vérifiée. (5) Le nombre de divergences entre paires de places croît avec le nombre de places : faux signaux sans correction.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Intérêt surtout descriptif : repérer un flux isolé sur une seule place. La valeur prédictive en swing n'est pas documentée. Commencer par OKX seul (gratuit, sans clé, déjà dans la CSP) après vérification de l'endpoint. N'ajouter la jambe Coinalyze que si le contrôle sémantique passe et si le quota partagé le permet. Priorité basse parmi les quatre idées.

**Références.**

- Makarov et Schoar (2020), Journal of Financial Economics : forte composante commune du volume signé entre places pour le BTC. Connu, non revérifié dans cette passe. Les CVD par place devraient donc se ressembler la plupart du temps.
- docs/research/02-indicateurs-edge-crypto.md:60 : CVD par place ; un CVD agrégé multi-exchange est exclu.
- BUILD-CONTRACT.md:23 et :1396 : aucun agrégat multi-places.
- apps/web/src/chart/orderflow.calc.ts:40-49 : CVD Binance seul ; Coinbase n'a le split taker qu'en live.
- apps/web/src/data/coinalyze.ts:10-17 : 40 req/min par clé, latence d'environ 1 min, intraday de 1 500 à 2 000 points purgé chaque jour.
- api/_policy.ts:309 : ohlcv-history n'est pas autorisé.
- apps/web/src/data/onchain/cryptoquant.ts:17-18 : taker spot et swap toutes places, quotidien, BTC et ETH.
- vercel.json:136 (www.okx.com en connect-src) et apps/web/src/data/okx.ts:23 : CORS ouvert vérifié pour les endpoints de marché, pas pour Rubik.
- OKX Rubik taker-volume et Coinalyze ohlcv-history (sens de bv, spot, rétention, CGU) : non revérifiés. www.okx.com et api.coinalyze.net ne se résolvent pas dans cette session et le quota de recherche est épuisé.
- arXiv 2108.09750 et Koutmos et Wei (2023) cités par l'idée : non revérifiés.

**Redondance.** Aucun CVD par place hors Binance : c'est nouveau dans le code. Recouvrement partiel avec CryptoQuant (taker toutes places, quotidien BTC/ETH, cryptoquant.ts:17-18), avec cvdSpotPerp et divergenceSpotPerp (Binance) et avec takerBuySellRatio (perp Binance). On attend une forte redondance statistique, puisque le flux signé est très commun d'une place à l'autre.

**Pièges.** (1) Définitions hétérogènes. Rubik taker-volume agrège toutes les paires ou contrats d'une devise (non vérifié), alors que Binance et Coinalyze donnent un marché unique. Les unités diffèrent (contrats ou actif de base), le sens de bv chez Coinalyze n'est pas confirmé et l'ordre des champs Rubik n'est pas vérifié. (2) Profondeur : l'intraday Coinalyze s'arrête à environ 250-330 jours en 4h et 2 à 3 mois en 1h (coinalyze.ts:15-16). La rétention Rubik n'est pas vérifiée. Pas de backtest long possible : la validation sera surtout prospective. (3) Un CVD dépend de son ancre et de sa fenêtre de normalisation, donc les divergences changent avec l'historique chargé (graphe, alerte, daemon). (4) Quota : la clé du propriétaire est partagée par tous les visiteurs du site public, avec au moins 3 appels par graphe et par unité. Ouvrir ohlcv-history élargit son usage. (5) Droits de redistribution Coinalyze et OKX sur un site public : non vérifiés. (6) Tests multiples : 4 places × paires de places × horizons. (7) Latence d'environ 1 min chez Coinalyze.

**Protocole de validation.** (a) Contrôle sémantique figé avant tout affichage : corrélation entre bv Coinalyze (BTCUSDT_PERP.A) et k[9] de fapi ≥ 0,99 sur 500 bougies, sinon abandon de la jambe. Même contrôle de Rubik CONTRACTS contre les klines OKX si possible. (b) Mesurer d'abord la divergence spot/perp Binance existante. (c) Mesurer la commonalité : corrélation des deltas normalisés entre places en 4h. Au-delà de 0,9, les divergences sont rares par construction et le pane est surtout décoratif. (d) Étude d'évènements prospective et figée : divergence Binance/OKX détectée par detecterDivergencesSpotPerp sans retouche, horizons de 6 et 18 bougies 4h, nul par décalages circulaires, n ≥ 50 par cellule. Collecte périodique de bougies clôturées par le daemon (pas d'enregistreur de ticks). Verdict seulement quand n est atteint.

**Preuve d'intérêt (idéation).** Impact croisé du flux entre places (arXiv 2108.09750, vérifié) ; le déséquilibre d'ordres précède les rendements BTC (Koutmos & Wei 2023, vérifié par WebSearch). Coinalyze, Velo, Exocharts proposent un CVD multi-places.

**Mesure de succès.** Corrélation bv Coinalyze/taker Binance ≥ 0,99 sur 500 bougies, sinon abandon de la jambe ; ≥ 3 places couvertes pour BTC/ETH/SOL en 1h et 4h ; event study des divergences Binance/OKX à 6 et 18 bougies 4h.

**Fichiers à toucher.**

- api/_policy.ts (serverPathAllowed) et son test
- apps/web/src/data/coinalyze.ts (fetchOhlcvHistory) et coinalyze.test.ts
- apps/web/src/chart/auxProvider.ts
- packages/types/src/index.ts (AuxSeriesId par place)
- apps/web/src/lib/indicatorUsability.ts
- packages/indicators/src/orderflow/cvdParPlace.ts et son test (nouveaux)
- packages/indicators/src/registry.ts, registry.test.ts
- scripts/verifier-bv-coinalyze.ts (contrôle de sémantique, nouveau)
- apps/web/src/data/okx.ts (optionnel, Rubik)
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : Les définitions sont hétérogènes d'une place à l'autre : la sémantique du bv Coinalyze et le périmètre Rubik ne sont pas confirmés. Le quota de clé est partagé entre visiteurs. L'apport par rapport au delta Binance seul n'est pas démontré, d'où l'étape 0 bloquante, à juste titre.
- cout-risque (2) : Il faut ouvrir v1/ohlcv-history sur la clé serveur. Ce chemin est absent de la liste fermée (api/_policy.ts:309), dont le quota de 40/min est partagé par tous les visiteurs sans limiteur serveur : les 429 priveraient aussi OI, funding et liquidations. Le sens de bv chez Coinalyze n'est pas confirmé (étape 0 indispensable). Granularité, rétention et CGU de Rubik OKX ne sont pas vérifiées. Fragile.
- coherence (2) : Un AuxSeriesId par place, un pane nouveau et un endpoint Coinalyze ohlcv-history sur la clé serveur partagée (40 req/min, aucun limiteur serveur). Cela frôle l'esprit de l'AggregationEngine interdit (BUILD-CONTRACT.md:23). Lourd pour un gain faible.

### 46. SUG-16 — OI total, funding pondéré par l'OI et liquidations agrégés sur les 4 places perp via Coinalyze multi-symboles (amendement requis)

**Score 8/20** · valeur 2 · coût-risque 2 · cohérence 2 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : dérivés · origines : DER-3

**Question de trading.** Le levier se construit-il sur tout le marché ou seulement sur Binance, et quel funding paient vraiment les positions une fois pondéré par leur taille ?

**Proposition retenue après vérification.** Après amendement explicite du contrat (somme d'affichage, pas d'AggregationEngine) : une section DES « Toutes places (somme d'affichage) ». Elle donne l'OI total et la part par place (1 appel open-interest-history sur les 4 identifiants de marchesPerp), le funding pondéré par l'OI calculé avec les séries fundingHist* existantes ramenées à l'heure (aucun appel Coinalyze), et les liquidations des 3 places qui les publient. Composition et places manquantes sont écrites. 7 appels Coinalyze par rafraîchissement, cache 5 min. Ni AuxSeriesId ni indicateur avant d'avoir mesuré l'écart de lecture entre Binance seul et le total.

**Proposition initiale.** Pour l'actif courant, une requête Coinalyze open-interest-history, funding-rate-history et liquidation-history avec les 4 identifiants déjà résolus. Calcul pur : OI total et part par place, funding pondéré Σ(f·OI)/ΣOI après normalisation de cadence, liquidations additionnées (HL absent chez Coinalyze). Section DES et aux oiTotal/fundingPondere (aires empilées par place), composition écrite (« 4 places, hors CME, Deribit, Bitget… »).

**Ce qui existe déjà.** Coinalyze fournit déjà OI, funding et liquidations par place (apps/web/src/data/coinalyze.ts:365, :394-440). DES lit une place à la fois, avec sélecteur (BUILD-CONTRACT.md:1393-1397), via resoudreMarchesPerp (apps/web/src/data/marchesPerp.ts:318), où MarchePerp.symbole est l'identifiant Coinalyze (:46-64) et aLiquidations est faux pour HL (:210). fetchOpenInterestHistoryBatch n'a aucun consommateur hors mocks (coinalyze.ts:589 ; apps/web/src/store/persist.test.ts:28). Elle mappe vers `_PERP.A`, sauf un identifiant contenant « . », et réindexe en majuscules (coinalyze.ts:165-170, :596-598). Le funding des 4 places existe déjà en séries aux gratuites sans Coinalyze : fundingHistBinance, fundingHistBybit, fundingHistOkx, fundingHistHl (packages/types/src/index.ts:212 ; collecte directe dans apps/web/src/data/fundingHistory.ts:122-160). fundingDispersion les croise déjà (packages/indicators/src/derivatives/fundingDispersion.ts:33-60). Les liquidations live sont déjà fusionnées Bybit + OKX (apps/web/src/data/liquidations.ts:1-6). Ni OI total ni funding pondéré (grep).

**Réutilise.** Batch et throttle Coinalyze (coinalyze.ts:50, :589), marchesPerp (apps/web/src/data/marchesPerp.ts:318), cadences (apps/web/src/data/fundingHistory.ts:131-153), liqParBougie.

**Point d'intégration.** Section repliable de DerivativesWindow.tsx, alimentée par apps/web/src/data/derivesAgreges.ts chargé à la demande. OI des 4 places en 1 appel open-interest-history sur les 4 identifiants Coinalyze de marchesPerp (convert_to_usd). Funding pondéré calculé à partir des fundingHist* existants ramenés à l'heure (cadences de fundingHistory.ts). Liquidations des 3 places où aLiquidations est vrai. Proxy inchangé : chemins déjà autorisés (api/_policy.ts:309), clé serveur COINALYZE_API_KEY (shared/server-credentials.ts:4).

**Sources.**

- Coinalyze API (déjà utilisée ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : oui) : ≤ 20 symboles par requête, chaque symbole compte pour un appel ; usage public avec citation de la source et lien demandés (doc vue par WebSearch). Rétention non vérifiée.

**Contrat.** Amendement obligatoire : BUILD-CONTRACT.md:23 (pas d'AggregationEngine), :212-213 (« OI agrégé multi-venues » exclu sans nouvel amendement) et :1396 (aucun agrégat multi-places). L'argument est défendable : ce sont des sommes d'affichage de séries déjà converties en USD par le fournisseur. Précédents : « Σ et parts sont des sommes d'affichage » pour les mineurs CryptoQuant (BUILD-CONTRACT.md:300) et l'agrégat fournisseur consommé tel quel (:326-327). Une section DES demande une exception G100. Deux AuxSeriesId modifieraient @axiom/types (BUILD-CONTRACT.md:81) : à repousser. Pas de nouveau fournisseur. La clé serveur est partagée sans plafond dans api/proxy.ts (grep vide) ; le throttle de 40/min est par navigateur (coinalyze.ts:49-50).

**Risques.** (1) Quota : chaque symbole compte pour un appel (coinalyze.ts:49). 3 endpoints sur 4 places font 11 à 12 appels par rafraîchissement, pas ≤ 8. Avec le funding pris hors Coinalyze, on tombe à 7 (4 OI + 3 liquidations). Sur Vercel, la clé du propriétaire est partagée entre visiteurs sans garde serveur. (2) Rétention intraday Coinalyze d'environ 1 500 à 2 000 points (doc 01:13) : à peine 2-3 mois en 1h. (3) Unités HL (OI compté d'un seul côté, contrats ×1000 kPEPE) et conversion USD de Coinalyze non vérifiées. (4) Composition partielle (sans CME, Deribit, Bitget…) : risque de lire « total » comme « marché ». (5) Funding pondéré : cadences hétérogènes à normaliser ; une place sans OI biaise le total, à afficher « 3/4 places ». (6) Le paramètre `to` à la seconde empêche le cache CDN (docs/revue-2026-11-06.md:907).

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Le funding pondéré et les liquidations additionnées sont des gadgets : ils redisent fundingDispersion et le funding Binance, et sous-comptent. Seule la somme de l'OI avec la part de chaque place répond à une vraie limite (migration de l'OI vers Hyperliquid ou Bybit sur les alts), mais sur 4 places, avec 2 à 3 mois d'historique et au prix d'un amendement. Cela ne vaut que si le pré-test montre des désaccords fréquents avec Binance seul. Alternative sans amendement : un tableau DES de ΔOI en contrats, une colonne par place, sans somme. Priorité la plus basse des quatre.

**Références.**

- BUILD-CONTRACT.md:23, :212-213 et :1396 : AggregationEngine interdit, OI agrégé multi-places exclu sans amendement, une place à la fois dans DES.
- docs/research/02-indicateurs-edge-crypto.md:131 : l'OI d'une seule place n'est qu'un échantillon. Elle conseille d'« acheter » l'agrégat plutôt que de le recalculer (piège §3 : contractSize et contrats inverses).
- docs/research/02-indicateurs-edge-crypto.md:159-162 : le flux forceOrder de Binance est bridé à 1 ordre par seconde, donc tout cumul de liquidations est sous-compté.
- docs/research/01-fournisseurs-api-indicateurs.md:13, :36 et :100 : Coinalyze gratuit ne conserve qu'environ 1 500 à 2 000 points intraday, purgés chaque jour, et plafonne à 40 requêtes par minute.
- Blog Coinalyze sur le funding pondéré par l'OI, cité par l'idée et non revérifié (api.coinalyze.net inaccessible, budget WebSearch épuisé). Aucune étude ne montre qu'un OI agrégé prédit mieux qu'une seule place.

**Redondance.** Élevée pour le funding. fundingDispersion donne déjà le min, le max et l'écart-type sur les 4 places (packages/indicators/src/derivatives/fundingDispersion.ts:15-31). Une moyenne pondérée par l'OI tombe dans [min, max] et reste dominée par Binance et Bybit. Les auxiliaires fundingHistBinance, Bybit, Okx et Hl existent (apps/web/src/chart/auxProvider.ts:135-138). Pour l'OI, DES montre déjà chaque place une à une (BUILD-CONTRACT.md:1394-1396) et oiChange existe. Seule la somme, avec la part de chaque place, est nouvelle.

**Pièges.** (1) Le « total » couvre 4 places seulement, sans CME, Deribit, Bitget ni Gate. Le présenter comme l'OI du marché serait trompeur, surtout pour BTC où le CME pèse lourd. (2) Biais USD : sommer et différencier des OI en USD ajoute l'effet prix au quadrant (même défaut que signaux.ts:60-61 et screener.ts:162-177). Il faut des unités de base, avec la taille de contrat OKX connue (marchesPerp). (3) Une place absente sur un intervalle fait chuter le total : n'accepter que les intervalles où les 4 places sont présentes, comme knownCount === 4 dans fundingDispersion. (4) Les liquidations additionnées héritent du sous-comptage des flux publics, la correction faite par Coinalyze n'est pas vérifiée, et Hyperliquid manque : somme non comparable. (5) Historique d'environ 1 500 à 2 000 points intraday, soit 2 à 3 mois en 1h : aucune mesure multi-cycles, donc le protocole AXIS est inapplicable. (6) Quota de 40 requêtes par minute, partagé avec les visiteurs publics sur la clé du propriétaire, à raison de 4 symboles × 3 endpoints par rafraîchissement. (7) Amendement du contrat obligatoire.

**Protocole de validation.** Pré-test de décision, en script hors application, avant tout amendement. Sur la fenêtre Coinalyze disponible (1h, BTC, ETH et 5 alts dont une où Hyperliquid domine), mesurer trois choses : corr(funding Binance, funding pondéré), corr(ΔOI Binance en contrats, ΔOI total) et la part des bougies 4h où le quadrant diffère. Seuils d'abandon figés à l'avance : corrélation ≥ 0,95 et désaccord < 10 %. Le contrôle de cohérence de l'agrégat ne se fait qu'en descriptif : à ±5 % de coinalyze.net. Aucune validation prédictive n'est possible faute d'historique. Il faudrait des instantanés quotidiens accumulés, puis une campagne figée après au moins 12 mois.

**Preuve d'intérêt (idéation).** Coinalyze montre qu'une moyenne simple du funding peut indiquer le mauvais sens et que la pondération par l'OI corrige le biais (blog, vérifié). Le doc 02 traite l'OI d'une place comme un échantillon (docs/research/02-indicateurs-edge-crypto.md:131).

**Mesure de succès.** OI total BTC à ±5 % de l'agrégat 4 places de coinalyze.net (contrôle daté) ; ≤ 8 appels par rafraîchissement ; comptage des épisodes où la lecture du quadrant diffère entre Binance seul et le total.

**Fichiers à toucher.**

- apps/web/src/data/derivesAgreges.ts (nouveau)
- apps/web/src/data/coinalyze.ts (variante batch par identifiants Coinalyze, casse conservée)
- apps/web/src/components/DerivativesWindow.tsx
- BUILD-CONTRACT.md

**Avis des juges.**

- valeur (2) : Le « total » ne couvre que 4 places (sans CME ni Deribit) et demande d'amender le contrat. Binance seul donne déjà l'essentiel de la direction. Il faut d'abord mesurer l'écart de lecture : apport marginal faible.
- cout-risque (2) : Amendement de contrat lourd (AggregationEngine interdit, « OI agrégé multi-venues » exclu, BUILD-CONTRACT.md:213). 7 appels Coinalyze par rafraîchissement sur la clé partagée de 40/min. Un « total » sur 4 places, sans CME ni Deribit, est trompeur pour BTC. La somme d'OI en USD ajoute un biais de prix.
- coherence (2) : Heurte une exclusion écrite : « l'OI agrégé multi-venues » est exclu sans nouvel amendement (BUILD-CONTRACT.md:212-213, et :23). Les précédents de « sommes d'affichage » existent, mais l'idée force le contrat.

### 47. SUG-26 — Valorisation de cycle BTC à J-1 et sur tout l'historique : recalcul depuis Coin Metrics community (option A, gratuite) ou BGeometrics Professional (option B, payante et conforme)

**Score 8/20** · valeur 2 · coût-risque 2 · cohérence 2 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : on-chain BTC · origines : BTC-2, BTC-7

**Question de trading.** Où se situe le cycle aujourd'hui et non il y a 7 jours, à quels niveaux MVRV-Z, NUPL et Puell ont-ils marqué les creux et sommets de 2011 à 2024, et puis-je le montrer légitimement sur le lien public ?

**Proposition retenue après vérification.** Présenter au propriétaire deux décisions séparées, sans code de graphe. (A') Dans CYCLE seulement, après amendement de BUILD-CONTRACT.md:202-206 : une tuile « MVRV-Z / NUPL / Puell — Coin Metrics, recalcul J-1 » distincte de la tuile BG, et un tableau des creux et sommets 2011-2024 calculé sur un seul appel CM (prix réalisé = PriceUSD/CapMVRVCur), avec l'écart médian CM/BG publié. Aucun AuxSeriesId ni indicateur. (B) Souscrire ou non l'offre BG payante, couverture du site public confirmée par écrit. Si oui, petit lot S pour rendre les plafonds de quota du navigateur dépendants de l'offre, puis vérifier /last delayed:false.

**Proposition initiale.** Option A : chargeur CM paginé depuis 2010 (CapMrktCurUSD, CapMVRVCur, SplyCur, IssTotUSD), appel direct du navigateur du visiteur ; RC = MC/MVRV (contourne le refus de CapRealUSD), prix réalisé = RC/offre, MVRV-Z avec écart-type expansif sans look-ahead, NUPL = 1 − 1/MVRV, Puell = IssTotUSD/SMA 365 j, thermocap ; séries distinctes étiquetées « Coin Metrics », jamais à la place de BG ; tableau creux/sommets dans CYCLE ; écart CM/BG publié. Option B : souscrire l'offre BG Professional, retirer les drapeaux d'embargo selon /last, porter les fenêtres à la profondeur permise, ajuster les quotas, réactiver exchange-* si inclus.

**Ce qui existe déjà.** CYCLE affiche une tuile MVRV-Z BGeometrics seule, sans repli, avec le badge d'embargo (apps/web/src/components/CycleWindow.tsx:348-351 ; zones apps/web/src/lib/zonesOnchain.ts:14). Le thermocap est calculé depuis Coin Metrics sur tout l'historique (apps/web/src/data/onchain/thermocap.ts:29-75). Le ratio MVRV de Coin Metrics (CapMVRVCur, 200 j) est déjà tracé sur le graphe par l'indicateur « mvrv » (apps/web/src/chart/auxProvider.ts:504-508 ; packages/indicators/src/derivatives/mvrv.ts:13-31), ce que l'idée ne cite pas. Le recalcul RC = MC/MVRV existe déjà pour ETH (apps/web/src/data/onchain/reseauEthCm.ts:96-110). Le PriceUSD complet de Coin Metrics est déjà chargé pour CYCLE et BPL (apps/web/src/data/onchain/coinmetrics.ts:221 ; apps/web/src/store/cycle.ts:98). Aucun tableau historique des creux et sommets de MVRV-Z, NUPL ou Puell n'existe. Embargo BG et quotas : bgeometrics.ts:24-25, 44-48, 63 et 102-105.

**Réutilise.** chargerLignesCoinMetrics et pagination, calculerThermocap (thermocap.ts:29), indicateurs mvrvZScore/nupl/puell/realizedPrice qui lisent un aux, zonesOnchain (apps/web/src/lib/zonesOnchain.ts:14), chaîne BG complète (proxy /bgapi, refusAbonnementBg).

**Point d'intégration.** Option A, resserrée : un seul appel chargerLignesCoinMetrics(['CapMrktCurUSD','CapMVRVCur','IssTotUSD','PriceUSD']) depuis 2010, sur le patron de thermocap.ts (cache 24 h, série dérivée seule). Prix réalisé = PriceUSD ÷ CapMVRVCur, ce qui ne demande pas SplyCur. Écart-type de MVRV-Z expansif. NUPL = 1 − 1/MVRV. Puell = IssTotUSD ÷ SMA365. Affichage dans CYCLE uniquement : un tableau des creux et sommets et une tuile « Coin Metrics (recalcul) » distincte de la tuile BG. Aucun AuxSeriesId : le graphe Binance BTCUSDT ne remonte qu'au 2017-08-14 (docs/revue-2026-09-26-profondeur-historique.md, tableau), donc l'objectif « ≥ 2011 en 1w » ne peut pas être tenu sur le graphe. Option B : remplacer la valeur de BGEOMETRICS_API_KEY dans Vercel (shared/server-credentials.ts). Cela ne suffit pas sans code : les plafonds BG_LIMITE_HEURE et BG_LIMITE_JOUR et le garde de quota du navigateur (bgeometrics.ts:44-48, 59-60, 190-200) continueraient de bloquer à 10 req/h dès qu'une clé est active. Il faut les rendre dépendants de l'offre.

**Sources.**

- Coin Metrics Community API v4 (déjà utilisée ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Métriques servies d'après les sondes du dépôt ; licence CC BY-NC 4.0 avec attribution (vérifiée) ; profondeur complète de CapMVRVCur non vérifiée ; retraits de métriques annoncés en octobre 2025 sans liste.
- BGeometrics offre Professional (déjà utilisée ; payant ; vérifiée en ligne par l'idéation : oui) : Exigée pour servir des utilisateurs finaux (CGU 24/02/2026, vérifiées) ; prix affiché 15 ou 25 $/mois selon la version de page ; fin d'embargo, profondeur et données d'exchanges incluses non vérifiées.

**Contrat.** Option A : elle contredit frontalement la décision du propriétaire « aucun substitut Coin Metrics » pour MVRV-Z, SOPR, NUPL et Puell, et le retrait du repli CapMVRVCur de CYCLE (BUILD-CONTRACT.md:202-206 et :536). Il faut un amendement explicite. Ce n'est pas un nouveau fournisseur : l'hôte est déjà autorisé dans la CSP (vercel.json:136). Le tableau CYCLE est une surface nouvelle, donc exception G100. Option B : le contrat dit que la décision des clés serveur « n'autorise […] ni achat d'abonnement » (BUILD-CONTRACT.md:1280-1283), et l'exception du 2026-09-14 parle d'une « clé gratuite » (BUILD-CONTRACT.md:72). Il faut une décision et un amendement du propriétaire, avec une dépense récurrente.

**Risques.** (1) Deux MVRV-Z, NUPL ou Puell différents selon la source (méthode du capital réalisé, écart-type expansif ou sur tout l'échantillon) : risque de confusion si l'étiquetage est faible. (2) Retraits de métriques Coin Metrics annoncés sans liste ; profondeur de CapMVRVCur non vérifiée. (3) La licence CC BY-NC 4.0 de Coin Metrics et les CGU BGeometrics du 24/02/2026 sont affirmées par l'idée mais n'ont pas été revérifiées ici : quota WebSearch épuisé, coinmetrics.io et bitcoin-data.com injoignables. Si la lecture des CGU BG est exacte, l'usage public actuel de la clé serveur gratuite est déjà non conforme, ce qui dépasse cette idée. (4) Option B : profondeur, fin d'embargo, limites et inclusion des séries exchange-* de l'offre payante non vérifiées. (5) Les extrêmes de cycle se comptent sur 3 ou 4 cycles : un « tableau de seuils » ne prouve rien, il décrit.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. Le gain analytique tient à la profondeur (relire 2011-2024) bien plus qu'à la fraîcheur : ces métriques lentes changent peu en 7 j hors krach, l'embargo pèse surtout sur les flux (NRPL, SOPR). Version minimale recommandée : étendre l'aux mvrv CM à tout l'historique, ajouter MVRV-Z expansif et Puell CM étiquetés « Coin Metrics », sans nuplCm ni realizedPriceCm ; tableau creux/sommets descriptif, sans seuils présentés comme signaux. Alternative S immédiate : fenetreJours 1460 sur les définitions BG. L'option B relève du budget et de la licence, pas de l'analyse. L'option A exige l'accord explicite du propriétaire (BUILD-CONTRACT.md:202-212).

**Références.**

- Mahmudov & Puell (2018) pour le MVRV, Awe & Wonder (2019) pour le MVRV-Z, Puell (2019) pour le Puell Multiple : origine praticienne, références de mémoire non revérifiées.
- Coin Metrics Community sous licence CC BY-NC 4.0 avec attribution : vérifié par l'émetteur, non revérifié ici.
- CGU BGeometrics du 24/02/2026 (Professional exigé pour servir des utilisateurs finaux) : vérifié par l'émetteur, non revérifié ici.
- docs/revue-2026-11-06.md:384-397 : AUX-1, embargo J-7 mesuré.
- apps/web/src/chart/auxProvider.ts:504-508 : aux mvrv = CM CapMVRVCur, déjà sur le graphe.
- apps/web/src/data/onchain/coinmetrics.ts:34 : fenêtre CM de 200 j.
- apps/web/src/data/onchain/coinmetrics.ts:15 : ETH servi en community.
- apps/web/src/data/onchain/bgeometrics.ts:46 : fenêtre BG de 120 j par défaut.
- apps/web/src/data/onchain/bgeometrics.ts:102-105 : MVRV-Z, NUPL et Puell sans fenetreJours, sous embargo.
- apps/web/src/data/onchain/thermocap.ts:29-45 : thermocap CM déjà calculé sur tout l'historique.
- apps/web/src/lib/zonesOnchain.ts:13-20 : seuils 0/3/7 dits canoniques.
- packages/indicators/src/derivatives/puell.ts:5-6 : seuils 0,5 et 4.
- BUILD-CONTRACT.md:202-212 : aucun substitut Coin Metrics pour MVRV-Z, SOPR, NUPL et Puell.
- apps/web/src/data/validationSignaux.ts:12-19 : hystérésis, un épisode = un évènement.

**Redondance.** Le MVRV CM, frais à J-1, est déjà chartable (auxProvider.ts:504-508, indicateur mvrv), mais seulement sur 200 j : l'essentiel du gain de l'option A est la profondeur, obtenable en élargissant cette aux existante. NUPL = 1 − 1/MVRV est une transformation monotone, sans aucune information en plus : nuplCm est inutile. Le prix réalisé CM doublonne realizedPrice BG, déjà frais. Le thermocap existe déjà sur tout l'historique (thermocap.ts). Les panes MVRV-Z, NUPL et Puell BG existent mais ne portent que 120 j (pas de fenetreJours). Ajouter fenetreJours: 1460 à ces définitions donne un cycle complet au même coût de quota (bgeometrics.ts:90-95), sans nouvelle série ni dérogation. Vraiment nouveau : la profondeur 2011+ et MVRV-Z et Puell à J-1.

**Pièges.** Circularité : les seuils MVRV-Z < 0 / > 7 et Puell < 0,5 / > 4 ont été calibrés a posteriori sur cette même histoire ; une étude d'évènements 2011-2026 les confirme par construction. Les pics décroissent d'un cycle à l'autre : MVRV-Z n'aurait pas atteint 7 en 2024-2025 (de mémoire, non vérifié), donc aucun évènement récent au seuil haut. N minuscule (3-4 creux, 3-4 sommets) avec horizons de 90 et 180 j chevauchants : puissance nulle. Le MVRV-Z à écart-type expansif diffère de la série Glassnode/BG (écart-type plein échantillon, qui repeint le passé) : les seuils ne sont pas transposables et l'amorce 2010-2012 est instable. Puell : rupture mécanique à chaque halving (IssTotUSD divisé par deux, SMA 365 en retard, d'où un Puell bas pendant environ un an) ; subvention seule, frais exclus. Méthodes de realized cap différentes entre CM et BG/Glassnode. Statut flash CM révisable ; retraits de métriques CM annoncés sans liste (risque sur CapMVRVCur, non vérifié). En 1w, l'alignement lit la valeur du lundi. Option B : coût récurrent, couverture du site public à confirmer par écrit.

**Protocole de validation.** Aucun test hors échantillon possible sur les seuils historiques connus. (1) Exactitude : écart médian CM/BG sur la plage commune, seuil fixé avant la mesure. (2) Seuils sans look-ahead, par exemple percentiles expansifs 5 % et 95 % calculés sur le seul passé, gelés dans un manifeste. Un épisode = un évènement (hystérésis, validationSignaux.ts:12-19), entrée décalée à J+2. (3) Cellules jamais vues : autres actifs servis par CM community (ETH vérifié dans le dépôt) avec la règle figée. (4) Publier N et un intervalle de confiance ; interdire le libellé « validé » sous un N prédéclaré (par exemple 10 épisodes). (5) Usage limité au contexte de régime, jamais comme déclencheur 4h.

**Preuve d'intérêt (idéation).** Embargo mesuré : MVRV-Z/NUPL figés à J-7, 7 barres NRPL fabriquées, 3 alertes inertes (docs/revue-2026-11-06.md:388-397, :881). Licence CM compatible avec un site public non commercial avec attribution, contrairement à l'offre gratuite BG (vérifié).

**Mesure de succès.** Dernier point à J-1 et profondeur ≥ 2011 en 1w ; écart médian CM/BG sous un seuil fixé avant mesure (ex. 3 %) ; event study MVRV-Z < 0 et > 7 sur 2011-2026 à 30/90/180 j ; option B : /last delayed:false et 0 × 429 sur 30 j.

**Fichiers à toucher.**

- apps/web/src/data/onchain/valorisationCm.ts (nouveau, option A)
- apps/web/src/components/CycleWindow.tsx (option A)
- apps/web/src/store/cycle.ts (option A)
- apps/web/src/data/onchain/bgeometrics.ts (option B : quotas selon l'offre)
- BUILD-CONTRACT.md (amendement dans les deux cas)

**Avis des juges.**

- valeur (2) : La valorisation de cycle se lit à l'horizon macro, peu à l'échelle du swing 4h. Ses seuils sont calibrés a posteriori sur la même histoire (circularité), et l'idée contredit une décision du propriétaire (BUILD-CONTRACT.md:202-206).
- cout-risque (2) : L'option A contredit une décision verrouillée du propriétaire (« aucun substitut Coin Metrics », BUILD-CONTRACT.md:205-206), et la licence Coin Metrics pour un affichage public n'est pas vérifiée ici. Deux MVRV-Z différents risquent la confusion. L'option B est payante, avec une couverture du site public à obtenir par écrit. Coût et risque de gouvernance élevés.
- coherence (2) : L'option A contredit une décision écrite du propriétaire, « aucun substitut Coin Metrics » pour MVRV-Z, NUPL et Puell, et le retrait de CapMVRVCur (BUILD-CONTRACT.md:205-206). L'option B suppose un achat d'abonnement que le contrat n'autorise pas. C'est une note de décision, pas un outil.

### 48. SUG-29 — Nouvelle source Bitview (Bitcoin Research Kit) pour les cohortes, et distribution des détenteurs de long terme (offre LTH, CDD ajusté) à côté du VDD

**Score 8/20** · valeur 2 · coût-risque 2 · cohérence 2 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : oui · exception G100 : oui · catégorie : nouvelle source · origines : BTC-5, BTC-6

**Question de trading.** Les détenteurs anciens vendent-ils dans la hausse (offre LTH qui fond, vieilles pièces réveillées), et à quel prix les cohortes ont-elles acheté, à J-1 et sur tout l'historique, sans le quota de 15 req/j et l'embargo de BG ?

**Proposition retenue après vérification.** Lot A, sans nouveau fournisseur : porter au graphe, en superposition 1d, les prix réalisés STH et LTH BG déjà chargés dans CHAIN (ajout à BG_DEF_PAR_AUX, fenetreJours 1 460). Lot B : sonder Bitview depuis le poste du propriétaire (catalogue /api/series/search, CORS, profondeur, fraîcheur J-1) et demander les conditions d'affichage public à support@bitview.space. Seulement si la sonde et les conditions sont favorables : exception fournisseur pour un indicateur unique « Distribution LTH » (1d). Il réunit Δ30 j de l'offre LTH Bitview et, si sa corrélation au VDD reste sous 0,9, le CDD ajusté en z-score 365 j. Ne pas ajouter de chemins BG (quota de 15 req/j partagé par les visiteurs).

**Proposition initiale.** Lot 0 (S) : sonde depuis le daemon du catalogue bitview.space/api : CORS, noms des métriques (offre LTH/STH, vagues HODL, prix réalisés STH/LTH, CDD), profondeur, fraîcheur, CGU du service hébergé ; sonde en parallèle des chemins BG supply-adjusted-cdd et hodl-waves-supply (1 460 j). Lot 1 (M) : route /extapi à chemins bornés, cache KV 24 h, séries « Bitview » distinctes de BG alimentant SUG-25. Lot 2 : indicateur « Distribution LTH » (1d) : Δ30 j de l'offre LTH, CDD ajusté en z-score 365 j, VDD Multiple surligné > 2,9, pics marqués ; CDD livré seulement si corrélation au VDD < 0,9.

**Ce qui existe déjà.** Aucune occurrence de Bitview, de CDD, de dormance, d'offre LTH ni de vagues HODL (grep sur .ts, .tsx et .md). Les chemins BG lth-supply et hodl-waves répondaient 404 le 2026-09-14 (docs/superpowers/progress/2026-09-14-lot-onchain.md:13). La revue du 2026-09-16 n'a pas fait CDD et dormance faute de sonde (docs/superpowers/progress/2026-09-16-indicateurs-et-fonctions-revue.md:86-88). Déjà présent : VDD Multiple au graphe à J-1 sur 1 460 j (packages/indicators/src/derivatives/vddMultiple.ts:11-33 ; apps/web/src/data/onchain/bgeometrics.ts:143 ; apps/web/src/chart/auxProvider.ts:531) ; MVRV STH/LTH et LTH-SOPR au graphe (bgeometrics.ts:139-140, :107). Les prix réalisés STH/LTH BG ne sont affichés que dans CHAIN (bgeometrics.ts:128-129 ; apps/web/src/components/onchain/CohortesBtc.tsx:17 ; apps/web/src/data/onchain/fluxCapitaux.ts:201-202), avec 120 j de profondeur (bgeometrics.ts:63). Ils sont absents du graphe : ils ne figurent pas dans BG_DEF_PAR_AUX (auxProvider.ts:657-677). La question « à quel prix les cohortes ont acheté » est donc déjà couverte en partie, mais hors du graphe.

**Réutilise.** Liste blanche et chemins bornés /extapi (shared/extapi-hosts.ts:59-70), cache on-chain et KV (apps/web/src/data/onchain/cache.ts), santé des sources, défs BG et quota, vddMultiple.

**Point d'intégration.** Lot 0 : sonde depuis le poste du propriétaire. Le conteneur ne résout pas bitview.space (ENOTFOUND, restriction réseau de la session, sans valeur de preuve). Le README GitHub (vérifié) indique l'API à bitview.space/api, l'OpenAPI à /openapi.json, la recherche par /api/series/search?q= et une instance gratuite sans compte. Le plugin holders couvre les cohortes STH, LTH, <4 mois, >6 mois…, avec l'offre et le prix réalisé (cost_basis.by_coin.avg) (vérifié). Le CDD n'y est pas mentionné (non vérifié). Lot 1 : ajouter bitview.space à EXTAPI_HOSTS, à EXTAPI_HOTES_SPECIALISES et à extapiCheminAutorise avec des chemins bornés (shared/extapi-hosts.ts:13-71). Ces listes sont consommées par le daemon, par Vite et par la fonction Vercel en GET seul (api/_policy.ts:405-411). Variante : appel direct si le CORS est ouvert, avec l'hôte ajouté à connect-src (vercel.json:136 ; docs/csp-vercel.md:45-59). Client apps/web/src/data/onchain/bitview.ts, cache 24 h via apps/web/src/data/onchain/cache.ts (localStorage, plus KV si le daemon est présent). Lot 2 : un case auxProvider sur le patron BG (auxProvider.ts:516-540), un AuxSeriesId (packages/types/src/index.ts:186), l'ajout à ONCHAIN_BTC (apps/web/src/lib/indicatorUsability.ts:51-73), la catégorie dans IndicatorMenu.tsx:131 et le registre (packages/indicators/src/registry.ts ; registry.test.ts:21 attend 220).

**Sources.**

- Bitview (bitview.space), instance hébergée de Bitcoin Research Kit (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Gratuite sans inscription, « pas de limite de débit » annoncée, code MIT, > 8 000 métriques revendiquées, API annoncée instable (vérifié par WebSearch). CORS, CGU du service hébergé et noms des métriques non vérifiés.
- BGeometrics supply-adjusted-cdd et hodl-waves-supply (nouvelle ; clé gratuite (serveur existante) ; vérifiée en ligne par l'idéation : oui) : Listés dans les fonctionnalités gratuites du portail ; statut gratuit de hodl-waves-supply contradictoire ; réponse réelle non sondée.

**Contrat.** Exception « nouveau fournisseur » obligatoire (BUILD-CONTRACT.md:80) : aucune source BG défaillante n'est remplacée stricto sensu. Exception G100 pour un nouvel indicateur graphique (BUILD-CONTRACT.md:71). Modification de @axiom/types (BUILD-CONTRACT.md:81). Extension du catalogue à justifier (BUILD-CONTRACT.md:82). Aucune série BG ne doit être remplacée (BUILD-CONTRACT.md:213-214) : les séries Bitview restent distinctes et ne servent ni de repli à MVRV-Z, SOPR, NUPL ou Puell. Aucune clé serveur nécessaire. Ce n'est pas un enregistreur. Budget initial bloquant (BUILD-CONTRACT.md:216) : le client vit dans un chunk paresseux, seuls le case aux et la définition entrent dans le chunk d'entrée. Les conditions d'utilisation du service hébergé ne sont pas publiées : le README ne donne que la licence MIT du code et un contact support@bitview.space. Un accord écrit est nécessaire avant l'affichage sur le site public.

**Risques.** API annoncée instable : renommage possible des identifiants de séries, d'où un parseur tolérant et une santé de source. Limites de débit et disponibilité du service hébergé non publiées (README vérifié : rien sur ce point). Définition LTH de BRK (seuil de 155 j ?) non vérifiée : écarts possibles avec Glassnode et BG. Le CDD est probablement très corrélé au VDD Multiple déjà présent : risque de doublon (le garde-fou corrélation < 0,9 est pertinent). Ajouter supply-adjusted-cdd et hodl-waves-supply chez BG est contre-productif : avec la clé serveur, la réponse est « private, no-store » (api/_policy.ts:370-381). Chaque visiteur du site public consomme alors le quota partagé de 15 req/j. Le statut gratuit de ces chemins est contradictoire et hodl-waves a déjà répondu 404. Les données on-chain sont révisables (réorganisations, ré-indexation BRK). Faux signaux : la baisse de l'offre LTH est une lecture de distribution, pas un timing ; l'étude d'évènements (apps/web/src/data/validationSignaux.ts) doit précéder toute lecture en signal.

**Intérêt analytique.** moyen ; verdict utile_avec_reserve. L'intérêt est dans la source (J-1, profondeur, pas de quota), beaucoup moins dans le nouvel indicateur, largement redondant. Je recommande le Lot 0 (sonde et CGU). Lot 1 seulement si les CGU autorisent un affichage public, avec un cache KV de 24 h côté serveur. Lot 2 réduit à « offre LTH (BTC) et sa variation », étiqueté « non ajusté par entité ». Le CDD est écarté d'emblée puisque le VDD existe. Il faut l'exception G100 et l'exception nouveau fournisseur (BUILD-CONTRACT.md:80), sans présenter Bitview comme un remplaçant de BG (:211-212).

**Références.**

- Limite de cette passe : quota WebSearch épuisé (200/tour) ; WebFetch refusé pour bitview.space, www.bis.org et api-docs.defillama.com (hôtes non résolus). Tout fait externe ci-dessous est « non vérifié » dans cette passe.
- Pratique d'analystes, pas de preuve académique : CDD (ByteCoin, bitcointalk 2011), HODL Waves (Unchained Capital 2018), seuil LTH/STH de 155 j et VDD Multiple (Glassnode/Checkmate). Non vérifié en ligne ici.
- Je ne connais aucune étude à comité de lecture qui établisse un pouvoir prédictif hors échantillon de l'offre LTH ou du CDD. Les seuils (VDD > 2,9) sont calés sur 3 ou 4 sommets de cycle. Non vérifié.
- Affirmations de la proposition sur Bitview (gratuit, sans limite annoncée, code MIT, API instable) : non vérifiées dans cette passe.
- apps/web/src/data/onchain/bgeometrics.ts:19-21 (quota 10 req/h et 15 req/j avec clé), :102-105 et :140-144 (embargo J-7), :143 (VDD sur 1 460 j)
- docs/superpowers/progress/2026-09-14-lot-onchain.md:11-13 (SplyAct1yr refusé par CM ; lth-supply et hodl-waves en 404 chez BG)
- docs/revue-2026-11-06.md:388 (la valeur embargo J-7 est recopiée sur 7 bougies)
- packages/indicators/src/derivatives/vddMultiple.ts, cvdd.ts, rhodlRatio.ts, lthSopr.ts, sthSopr.ts, asopr.ts, mvrvCohortes.ts, nrpl.ts, aviv.ts, offreEnProfit.ts
- apps/web/src/components/onchain/CohortesBtc.tsx:16-22 (prix réalisés STH/LTH, capitalisation réalisée, offre en profit/perte)
- apps/web/src/chart/auxProvider.ts:164-171 et :766 (série quotidienne alignée sur l'ouverture)
- apps/web/src/data/validationSignaux.ts:110 (hystérésis), :187 (etudeEvenements)
- BUILD-CONTRACT.md:80 (nouveau fournisseur), :82 (catalogue), :211-212 (pas de remplacement des séries BG)

**Redondance.** Forte pour l'indicateur. Le catalogue a déjà 10 indicateurs sur l'âge et les cohortes : vddMultiple ; cvdd (CDD valorisé cumulé) ; rhodlRatio (bandes HODL réalisées 1 semaine / 1-2 ans) ; lth, sth et aSOPR ; mvrvCohortes ; nrpl ; aviv ; offreEnProfit. CHAIN › Cohortes affiche en plus les prix réalisés STH et LTH. Le VDD vaut CDD × prix, donc le CDD ajusté sera très corrélé au VDD Multiple (la proposition le prévoit avec un seuil de 0,9). Seule information vraiment absente : la quantité, c'est-à-dire l'offre LTH en BTC et les vagues HODL ; la profitabilité est déjà couverte. Le vrai gain serait la qualité de la donnée (J-1, profondeur, pas de quota). Mais le contrat interdit de remplacer les séries BG, donc on aurait deux séries de même nom venant de deux sources.

**Pièges.** 1) Pas d'ajustement par entité. Les réorganisations de portefeuilles d'exchanges ou de dépositaires d'ETF, les distributions Mt. Gox et les transferts d'États font des pics de CDD et des chutes d'offre LTH sans aucune vente : faux signaux de distribution.
2) L'offre LTH, ce sont les pièces qui passent 155 j moins celles qui sont dépensées. Sa variation sur 30 j mêle donc la distribution et l'écho mécanique des achats d'il y a environ 5 mois.
3) Look-ahead. Le point daté D est publié en D+1 mais aligné sur l'ouverture de la bougie D (auxProvider.ts:766). En backtest, entrer au plus tôt en D+1.
4) Révisions. API annoncée instable : noms et définitions peuvent changer sans version. Il faut consigner la date de récupération.
5) Sur-ajustement. Les seuils (VDD > 2,9, z > 3) sont lus sur des sommets déjà connus, et un z-score sur 365 j n'est pas stationnaire sur des cycles de 4 ans.
6) Source unique tenue par un bénévole : disponibilité incertaine. La licence MIT couvre le code, pas le service hébergé, dont les CGU sont inconnues.

**Protocole de validation.** 1) Lot 0 seul d'abord : sonde de CORS, noms de métriques, profondeur et fraîcheur, et CGU écrites.
2) Avant tout indicateur, publier dans docs/ un manifeste daté et haché qui fige les définitions, les seuils, les horizons (7/30/90 j) et la déclustérisation par hystérésis (validationSignaux.ts:110).
3) Étude d'évènements avec etudeEvenements : entrée en D+1, rendements signés comparés à la dérive inconditionnelle, intervalles par bootstrap par blocs, et tous les seuils essayés publiés.
4) Test d'incrémentalité : expliquer les rendements futurs par la métrique en contrôlant le VDD Multiple, le MVRV STH et le momentum. Ne garder que si l'apport est significatif.
5) Il n'existe pas de donnée BTC « jamais vue » : tout l'historique est connu et BRK ne couvre que BTC. Le seul hors-échantillon honnête est un test prospectif d'au moins 12 mois après le gel.
6) Ne rien brancher sur AXIS (4h, figé).

**Preuve d'intérêt (idéation).** Glassnode (vérifié) : l'offre LTH chute pendant les grandes hausses (2021, 2024), les pics de CDD se groupent aux inflexions, un VDD > 2,9 a signalé des sommets. Intérêt propre de la source : lever profondeur 120 j, embargo J-7 et quota de BG.

**Mesure de succès.** Sonde concluante si ≥ 3 métriques de cohortes à J-1 avec ≥ 4 ans ; écart du prix réalisé STH Bitview/BG ≤ 2 % ; disponibilité ≥ 99 % sur 30 j ; event study à 30 j après pics de CDD (z > 3).

**Fichiers à toucher.**

- shared/extapi-hosts.ts
- vercel.json (connect-src, si appel direct)
- docs/csp-vercel.md
- apps/web/src/data/onchain/bitview.ts (nouveau)
- apps/web/src/chart/auxProvider.ts
- packages/types/src/index.ts
- packages/indicators/src/derivatives/distributionLth.ts (nouveau) + test
- packages/indicators/src/registry.ts
- packages/indicators/src/registry.test.ts
- apps/web/src/lib/indicatorUsability.ts
- apps/web/src/components/IndicatorMenu.tsx
- apps/web/src/store/health.ts (source de santé)

**Avis des juges.**

- valeur (2) : Le lot A fait doublon avec SUG-25. Le lot B est une source nouvelle (Bitview) dont les CGU, la stabilité et les quotas ne sont pas vérifiés (recherche web épuisée dans cette passe). La distribution LTH est faussée par les mouvements internes des plateformes et se lit à l'horizon macro.
- cout-risque (2) : Le lot A est bon marché, données BG déjà chargées. Le lot B s'appuie sur un nouveau fournisseur (exception nommée) : API annoncée instable avec renommage de séries, débit et disponibilité non publiés, projet individuel, CGU d'affichage public inconnues. Définition LTH à confirmer. Fragilité élevée.
- coherence (2) : Le lot A doublonne SUG-25, en moins bien (aux et def au lieu d'une ligne de niveaux). Le lot B ouvre un nouveau fournisseur, Bitview, sans source défaillante remplacée (BUILD-CONTRACT.md:80), avec une API annoncée instable.

### 49. SUG-34 — Économie des L2 via growthepie (CC BY 4.0) : utilisateurs actifs, frais, loyer payé à Ethereum et profit pour ARB, OP, MNT, STRK, ZK…

**Score 8/20** · valeur 1 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : oui · exception G100 : oui · catégorie : nouvelle source · origines : ETH-8

**Question de trading.** Quel L2 gagne vraiment des utilisateurs et des frais par rapport à la valorisation de son token, et la demande d'espace de blob payée à Ethereum progresse-t-elle ?

**Proposition retenue après vérification.** Deux étapes.
A, sans fournisseur : étendre Économie et Rotation des chaînes de 4 à N chaînes avec les L2 déjà suivis par DefiLlama (OP Mainnet, zkSync Era, Starknet, Mantle, Linea…, identifiants à confirmer), en chargement paresseux par métrique.
B, sous exception fournisseur : growthepie limité aux trois métriques absentes de DefiLlama, à savoir adresses actives quotidiennes, loyer payé à Ethereum et profit. Attribution CC BY, cache 6 h, coupure Dencun signalée. FDV/frais n'est affiché qu'avec l'avertissement « le token ne perçoit pas ces frais ».
Lecture descriptive de rotation : aucune corrélation de rang présentée comme preuve.

**Proposition initiale.** Charger export/{metric}.json (daa, txcount, fees, rent_paid, profit, stables_mcap, fdv) des L2 actifs listés dans master.json. Calculs purs : croissance 30/90 j, parts, profit = frais − loyer, FDV/frais annualisés, loyer total payé à ETH. Économie des chaînes et rotation généralisées à N chaînes, onglet L2, attribution « Source : growthepie ».

**Ce qui existe déjà.** Économie comparée figée à 4 chaînes (apps/web/src/data/onchain/economieChaines.ts:3-8) : TVL, DEX, stablecoins, frais et revenus DefiLlama. Cela fait 5 appels par chaîne (:268-272), avec un limiteur de 3 requêtes simultanées (:196).
La rotation suppose 4 chaînes en dur : rotationChaines.ts:7 (PRIX), :19 (`attendues: 4`), :37 (`parts` exige 4 valeurs), :46, :54, :81, ainsi que apps/web/src/components/onchain/RotationChaines.tsx:56 (« /4 »). Autres consommateurs : prixRotation.ts et analyseSynthese.ts:3-4.
Le secteur « Éco Ethereum » liste déjà ARB, OP, POL, STRK, ZK et MNT (apps/web/src/data/secteurs.ts:73-80).
Aucune donnée sur les adresses actives, le nombre de transactions, le loyer payé à L1 ou les blobs (grep growthepie|l2beat|rollup|blob : rien).

**Réutilise.** Types PointEconomie/SerieEconomie, calculerRotationChaines et lectureRotation (rotationChaines.ts:41, :88), composants EconomieChaines.

**Point d'intégration.** Étape A, sans fournisseur : étendre CHAINES_ECONOMIE aux L2 déjà couverts par DefiLlama (identifiants d'API à confirmer). Généraliser à N chaînes calculerRotationChaines, parts et couverture. Compléter PRIX (ARBUSDT, OPUSDT, STRKUSDT, ZKUSDT ; MNT n'est pas coté sur Binance). Charger paresseusement par métrique pour ne pas tirer 5×N appels.
Étape B : client apps/web/src/data/onchain/growthepie.ts (master.json, puis export/{metric}.json). Deux chemins possibles :
- via /extapi, en ajoutant l'hôte à shared/extapi-hosts.ts:13-56, qui alimente daemon, Vite et Vercel ;
- en direct, en ajoutant l'hôte à connect-src (vercel.json, docs/csp-vercel.md), seulement si le CORS est ouvert (non vérifié).
Cache 6 h via cache.ts, aucun secret.

**Sources.**

- growthepie API (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Docs officielles : sans authentification, ≤ 10 appels/min conseillés, CC BY 4.0 avec attribution (vérifié). Hôte api.growthepie.com ou .xyz à trancher ; CORS non vérifié.

**Contrat.** Étape A : exception G100 seulement (extension d'un onglet de CHAIN), aucun fournisseur ni hôte.
Étape B : growthepie est un nouveau fournisseur, donc exception nommée (BUILD-CONTRACT.md:80), plus un hôte sur la liste blanche ou dans la CSP.
Licence : CC BY 4.0 avec attribution, d'après la vérification amont. Je n'ai pas pu la revérifier : docs.growthepie.com est hors du réseau autorisé de la session. L'attribution doit figurer dans ProvenanceOnchain.
Aucune clé, aucun enregistreur, pas d'impact sur le budget initial si le chargement est paresseux.

**Risques.** Rupture Dencun (EIP-4844, mars 2024) : le loyer payé à L1 s'effondre, si bien que profit et FDV/frais ne sont pas comparables avant et après.
Les tokens ARB, OP et consorts ne perçoivent pas les frais du séquenceur : FDV/frais suggère une capture de valeur qui n'existe pas.
Les adresses actives quotidiennes sont gonflées par les bots et les campagnes d'airdrop.
Avec environ 8 tokens, une corrélation de rang reste statistiquement creuse.
Charge : environ 50 appels DefiLlama pour 10 chaînes.
Limites growthepie : environ 10 appels/min conseillés (vérif amont, non revérifiée ici), hôte .com ou .xyz non tranché, CORS inconnu.

**Intérêt analytique.** faible ; verdict gadget. Comme outil de trading swing, la mesure ne relie pas l'usage du L2 à la valeur du token. Aucune preuve ne soutient que les adresses actives d'un L2 prédisent le rendement du token, et le dépôt a déjà écarté Metcalfe.
Ce contexte fondamental, à coût presque nul, s'obtient sans nouveau fournisseur en étendant CHAINES_ECONOMIE à N chaînes avec DefiLlama, déjà sur la liste blanche. growthepie ne se justifierait que si le loyer payé à Ethereum devenait une question précise sur ETH, avec une exception au contrat (BUILD-CONTRACT.md:80).
La licence CC BY 4.0 rendrait l'affichage public compatible, avec citation de la source, mais elle n'a pas été revérifiée dans cette session.

**Références.**

- docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11 : Metcalfe écarté sur preuve dans le dépôt.
- Liu et Tsyvinski (2021, Review of Financial Studies), « Risks and Returns of Cryptocurrency » : facteurs réseau (croissance des utilisateurs et adresses) associés aux rendements de BTC, ETH et XRP. Cité de mémoire, non revérifié. Ces actifs sont des L1 dont le token paie le gaz, ce qui n'est pas le cas de la plupart des tokens L2.
- Cong, Karolyi, Tang, Zhao (2022), facteur adoption et valeur. Cité de mémoire, non revérifié.
- growthepie : licence CC BY 4.0 et 10 appels/min annoncés par l'étape amont, non revérifiés ici (docs.growthepie.com ne se résout pas). Le dépôt github.com/growthepie/gtp-backend (lu) est sous licence MIT pour le code et ne dit rien de la licence des données, des limites ni des hôtes api.growthepie.com ou .xyz.
- apps/web/src/data/onchain/economieChaines.ts:3-8 et :268-272 : TVL, DEX, stablecoins, frais et revenus DefiLlama paramétrés par nom de chaîne.
- apps/web/src/data/onchain/rotationChaines.ts:19, :35-38, :81 : cohorte figée à 4 chaînes.

**Redondance.** Partielle mais nette. Frais, revenus, TVL, DEX et stablecoins par chaîne viennent déjà de DefiLlama, et l'URL ne dépend que du nom de chaîne (economieChaines.ts:268-272). Étendre CHAINES_ECONOMIE à OP Mainnet, zkSync, Starknet, Mantle ou Linea ne demanderait aucun nouveau fournisseur (noms DefiLlama exacts non vérifiés). Il faudrait seulement lever l'arité 4 dans rotationChaines.ts:35-38,81. growthepie n'apporte en propre que les adresses actives quotidiennes (DAA), le nombre de transactions, le loyer payé à Ethereum (rent_paid) et le profit des L2.

**Pièges.** Captation de valeur : sur la plupart des L2, le gaz se paie en ETH et le profit revient au séquenceur ou à la trésorerie, pas aux détenteurs. FDV/frais n'est donc pas un multiple au sens actionnaire, et la mesure répond mal à la question de trading posée. MNT et STRK font en partie exception, non vérifié chaîne par chaîne.
Adresses actives : gonflées par les bots et la chasse aux airdrops, et définies différemment selon les chaînes (account abstraction).
Loyer payé à Ethereum : rupture structurelle avec EIP-4844 (blobs, mars 2024), après laquelle le coût s'est effondré. La série est donc non stationnaire et pèse peu dans les revenus d'Ethereum.
Révisions méthodologiques recalculées en arrière : séries non datées au moment de la publication.
Biais du survivant : master.json ne liste que les L2 actifs.
Échantillon minuscule : 8 à 15 tokens, la plupart cotés depuis 2023-2024 (ARB, STRK, ZK). Ils sont tous très corrélés à ETH et dominés par leurs déblocages, et des fenêtres de 30 j chevauchantes réduisent encore le N effectif. La corrélation de rang proposée n'a presque aucune puissance statistique.
Hôte (.com ou .xyz) et CORS non vérifiés.

**Protocole de validation.** Si l'idée est malgré tout poursuivie : manifeste figé ; coupes transversales mensuelles non chevauchantes ; Spearman entre la croissance des adresses actives sur 30 j et le rendement relatif contre ETH sur les 30 j suivants. Neutraliser la dilution du mois (émissions DefiLlama déjà chargées). Nul par permutation des tokens au sein de chaque mois. Explorer avant la date de gel, puis faire un seul test sur les mois postérieurs. Fixer à l'avance qu'avec moins d'environ 100 paires token-mois indépendantes le verdict est NON CONCLUANT, ce qui est le résultat le plus probable. L'écart de 2 % avec le site valide la donnée, pas l'intérêt.

**Preuve d'intérêt (idéation).** Preuve faible (Metcalfe écarté, docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md:9-11) : contexte fondamental de rotation, pas signal. Le loyer mesure directement la part des revenus d'Ethereum venant des L2 (définitions growthepie).

**Mesure de succès.** ≥ 8 L2 avec ≥ 365 j ; écart ≤ 2 % avec le site ; corrélation de rang publiée entre croissance des DAA 30 j et rendement relatif du token contre ETH à 30 j.

**Fichiers à toucher.**

- apps/web/src/data/onchain/economieChaines.ts
- apps/web/src/data/onchain/economieChaines.test.ts
- apps/web/src/data/onchain/rotationChaines.ts
- apps/web/src/data/onchain/rotationChaines.test.ts
- apps/web/src/data/onchain/prixRotation.ts
- apps/web/src/components/onchain/EconomieChaines.tsx
- apps/web/src/components/onchain/RotationChaines.tsx
- apps/web/src/store/economieChaines.ts
- apps/web/src/data/analyseSynthese.ts
- apps/web/src/data/onchain/growthepie.ts (nouveau, étape B)
- apps/web/src/data/onchain/growthepie.test.ts (nouveau, étape B)
- shared/extapi-hosts.ts (étape B, voie proxy)
- vercel.json et docs/csp-vercel.md (étape B, voie directe)
- apps/web/src/components/OnchainWindow.tsx

**Avis des juges.**

- valeur (1) : Gadget pour ce profil : les tokens L2 ne captent pas les frais, la rupture Dencun casse les séries et le lien avec un trade swing est inexistant.
- cout-risque (3) : L'étape A est sans fournisseur et bon marché. L'étape B ajoute un nouveau fournisseur gratuit sans clé. Sa licence CC BY 4.0 n'a pas été revérifiée dans cette session (web épuisé) ; l'attribution est à garantir. Risque d'interprétation : FDV/frais suggère une capture de valeur inexistante, et la rupture Dencun empêche toute comparaison avant/après. Petit projet, donc pérennité non garantie.
- coherence (3) : L'étape A, étendre l'économie des chaînes de CHAIN avec DefiLlama, s'intègre bien. L'étape B, qui porte l'essentiel de l'idée, demande une exception fournisseur (growthepie) pour un usage jugé « gadget ».

### 50. SUG-37 — Positions longues et courtes sur marge Bitfinex (stats1) en séries graphe, et liquidations Bitfinex en troisième historique

**Score 8/20** · valeur 2 · coût-risque 2 · cohérence 2 · effort révisé **M** (initial S) · existe déjà : non · exception fournisseur : oui · exception G100 : oui · catégorie : nouvelle source · origines : FLX-4, SRC-9

**Question de trading.** Les « baleines Bitfinex » chargent-elles des longs dans le repli ou les déchargent-elles pendant le mouvement en cours ?

**Proposition retenue après vérification.** Étape 0 : vérifier en ligne la granularité et la profondeur de pos.size ainsi que les CGU de Bitfinex, et comparer avec le ratio de marge OKX (place déjà câblée, aucune exception fournisseur). Phase 1 : ligne quotidienne « Marge spot Bitfinex » BTC et ETH dans le DES (longs, shorts, Δ 7 et 30 j, marqueur « longs +x % pendant une baisse du prix ≥ y % »), sans AuxSeriesId ni indicateur. Hôte borné par extapiCheminAutorise, pas EXTAPI_HOTES_SPECIALISES. Event study via validationSignaux. Liquidations Bitfinex et funding fUSD retirés. Série graphe et registre seulement après significativité et accord de l'orchestrateur sur les types.

**Proposition initiale.** Aux bfxMarginLong/bfxMarginShort (stats1 pos.size long/short, tBTCUSD et tETHUSD) ; indicateur margeBitfinex : longs, shorts, ratio, Δ 7/30 j et z-score, marqueur « longs +x % pendant que le prix perd ≥ y % ». Ligne « Marge spot Bitfinex » dans DES. Secondaire : liquidations/hist étiquetées par place, funding/stats fUSD pour le coût du levier spot. Indicateur au registre seulement après event study positive.

**Ce qui existe déjà.** Aucune donnée de marge spot. « bitfinex » n'apparaît que dans des étiquettes d'adresses : apps/daemon/src/whaleLabels.ts:54 et :63. Le positionnement existant passe par d'autres séries : lsAccount, lsTopTrader et lsTaker de Binance, et hlWhalesNet (packages/types/src/index.ts:199-201 et :228-230). L'historique de liquidations vient de Coinalyze, limité au perp Binance (apps/web/src/chart/auxProvider.ts:566-567, apps/web/src/data/coinalyze.ts:170 suffixe _PERP.A). Le flux live vient de Bybit et OKX (apps/web/src/data/liquidations.ts:1-5). Le DES contient déjà des sections hors clé et hors place, sur le même patron (apps/web/src/components/DerivativesWindow.tsx:1001 et :1005). Piste sans nouveau fournisseur, non vérifiée dans cette passe : le ratio de prêt sur marge d'OKX (/api/v5/rubik/stat/margin/loan-ratio). OKX fait déjà partie des EXCHANGE_IDS et www.okx.com figure déjà dans connect-src (vercel.json:136).

**Réutilise.** Forme Δ% de oiChange (packages/indicators/src/derivatives/oiChange.ts:12), liqParBougie, DES, validationSignaux.

**Point d'intégration.** Phase 1 sans série aux : un module pur apps/web/src/data/bitfinexMarge.ts, chargé à la demande, et une section repliable dans le DES, sur le patron des sections DefiLlama et CryptoQuant (DerivativesWindow.tsx:1001-1005). Côté hôte : api-pub.bitfinex.com dans EXTAPI_HOSTS (shared/extapi-hosts.ts:13), plus une clause dans extapiCheminAutorise (shared/extapi-hosts.ts:60) qui borne le chemin à /v2/stats1/pos.size:*, comme pour data.binance.vision (:66). L'hôte ne doit PAS aller dans EXTAPI_HOTES_SPECIALISES (:59). Cette liste sert à envoyer le dev vers le convertisseur HTML→JSON (apps/web/vite.geo-proxy.ts:9, apps/web/vite.config.ts:57). Event study : un détecteur à ajouter dans apps/web/src/data/validationSignaux.ts (etudeEvenements, :187). La série graphe (2 AuxSeriesId, un case rawFetch dans auxProvider.ts près de :557, alignAux) ne vient qu'après un résultat positif. Elle touche aux types figés (packages/types/src/index.ts:186).

**Sources.**

- Bitfinex API v2 publique (stats1, liquidations/hist, funding/stats) (nouvelle ; gratuit sans clé ; vérifiée en ligne par l'idéation : oui) : Chemins vérifiés dans le SDK officiel bitfinex-api-py et des clients tiers ; plafond 10 000 enregistrements par requête (clients tiers) ; format de clé, hôte api-pub.bitfinex.com, CORS, quotas, profondeur et CGU d'affichage public non vérifiés.

**Contrat.** Exception « nouveau fournisseur » nécessaire : BUILD-CONTRACT.md:26 (« Aucun autre fournisseur sans amendement ») et :80. Exception G100 pour la section DES (:71). Pas de clé et pas de modification des EXCHANGE_IDS. Une série graphe impose d'étendre AuxSeriesId dans @axiom/types, figé (:58), donc un passage par l'orchestrateur ; l'indicateur au registre relève de :82. Le budget d'entrée reste sous plafond (marge gzip d'environ 4,7 ko, BUILD-CONTRACT.md:1936) si le module est chargé à la demande. Aucun enregistreur interdit. En revanche, si l'historique n'est accessible qu'à la minute, une accumulation quotidienne par le daemon serait un collecteur de série journalière, à justifier comme le collecteur whales.

**Risques.** Non vérifié dans cette passe (web inaccessible : docs.bitfinex.com non résolu, budget de recherche épuisé) : granularité de pos.size. Si seul le pas de 1 minute existe, 10 000 enregistrements couvrent environ 7 jours. Les 3 ans visés demanderaient environ 160 pages ou environ 1 100 appels ponctuels, impossible à la demande sur Vercel (cache public de 60 s, api/_policy.ts:378-381). Également non vérifiés : quotas et bannissement d'IP partagés par les IP serverless, CORS, CGU d'affichage public. Les longs Bitfinex incluent des positions couvertes (long sur marge contre short perp), d'où de faux signaux directionnels. La métrique dépend de quelques comptes : sauts de niveau. liquidations/hist mélange toutes les paires et le funding fUSD ajoute du périmètre sans question de trading propre.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. La source est gratuite, l'effort faible et la donnée réellement absente d'AXIOM. Mais l'intérêt documenté repose sur la pratique (CoinGlass, TradingView), pas sur des études, et la série mêle conviction et portage couvert. À traiter comme une mesure à valider, pas comme un outil : ligne DES et étude d'évènements d'abord, indicateur seulement en cas de résultat favorable. Le volet liquidations Bitfinex est un gadget, à abandonner. L'idée affirme « ≥ 3 ans d'historique » sans le vérifier, et c'est la condition de toute l'étude. Limite de cette évaluation : budget WebSearch épuisé et WebFetch refusé (docs.bitfinex.com doit être autorisé dans les réglages réseau de la session). Les faits externes ajoutés ici sont donc de mémoire et non revérifiés.

**Références.**

- Pratique : CoinGlass publie « Bitfinex Margin Long/Short ». Vérifié par l'émetteur de l'idée, non revérifié ici : budget WebSearch épuisé, docs.bitfinex.com injoignable
- TradingView, symboles BTCUSDLONGS/BTCUSDSHORTS issus de Bitfinex : cité de mémoire, non revérifié
- Aucune étude académique sur la valeur prédictive des longs/shorts de marge Bitfinex (absence non revérifiée dans cette session)
- Griffin & Shams, J. Finance 2020 (« Is Bitcoin Really Untethered? ») : spécificités et concentration des flux Bitfinex/Tether. Cité de mémoire, contexte seulement
- packages/indicators/src/derivatives/oiChange.ts:12 (forme Δ% réutilisable)
- packages/types/src/index.ts:200, :211, :229 (lsAccount/lsTopTrader/lsTaker, liqLongUsd/liqShortUsd, hlWhalesNet déjà en aux)
- packages/indicators/src/derivatives/netPositioningTopTrader.ts:16, smartRetailSpread.ts:19, hlWhalesNet.ts:16
- apps/web/src/data/coinalyze.ts:170 (historique des liquidations = Binance `.A` seulement)
- apps/web/src/data/liquidations.ts:1-5 (liquidations live Bybit + OKX)
- apps/daemon/src/whaleLabels.ts:54 (seule mention Bitfinex : une étiquette d'adresse)
- apps/web/src/data/validationSignaux.ts:12-19 (hystérésis et datation sans anticipation, réutilisables)
- scripts/valider-axis-flux.ts:761 (nul par décalage circulaire)
- BUILD-CONTRACT.md:80, :82

**Redondance.** Données nouvelles : aucune série de marge spot financée dans le dépôt (grep bitfinex : whaleLabels.ts:54 seulement). En revanche, le concept « positionnement des gros comptes » est déjà couvert cinq fois : lsTopTrader, netPositioningTopTrader, smartRetailSpread (Binance), hlWhalesNet (Hyperliquid) et COT CME (apps/web/src/data/cot.ts). Le volet secondaire « liquidations Bitfinex » est presque entièrement redondant : historique Binance via Coinalyze (coinalyze.ts:170), live Bybit/OKX (liquidations.ts:1-5), sur une place marginale en volume de dérivés. funding/stats fUSD n'a pas d'équivalent, mais il ne fait qu'expliquer les longs ; ce n'est pas un signal.

**Pièges.** 1) Une partie des longs de marge peut être la jambe couverte d'un portage (achat spot financé en USD, vente du perp ou du future ailleurs). Une hausse des longs traduit alors une prime de base ou de funding, pas une conviction directionnelle. Il faut contrôler par fundingRate et quarterlyBasis (aux déjà présents). 2) Données d'une seule plateforme, concentrées sur peu de comptes : une seule entité peut déplacer la série de plusieurs milliers de BTC. 3) pos.size est en BTC : un Δ% en unités n'est pas un Δ en USD, à préciser. 4) Résolution disponible (1m seulement ?) non vérifiée. Si seul 1m existe, 3 ans de données représentent environ 160 requêtes de 10 000 points, avec une pagination fragile et des IP serverless partagées (refus éventuel non vérifié). 5) Seuils p90/p10 calculés sur tout l'échantillon : anticipation. Il faut des percentiles glissants strictement passés. 6) Le marqueur « longs +x % pendant que le prix perd ≥ y % » a deux paramètres libres : risque de sur-ajustement s'ils sont choisis après coup. 7) Fenêtres de 30 j chevauchantes sur données quotidiennes : peu d'épisodes indépendants (de l'ordre de 10 à 20 sur 3 ans), donc peu de puissance. 8) Ruptures historiques possibles (piratage 2016, changements de règles de marge) : non vérifié. 9) CGU d'affichage public, CORS et profondeur non vérifiés.

**Protocole de validation.** Avant tout regard sur les résultats, figer un manifeste haché (patron scripts/axis/manifeste-flux-2026-10-08.json) qui fixe : séries BTC et ETH quotidiennes ; Δ 30 j comparé aux percentiles glissants sur 365 j ; marqueur avec x et y fixés a priori ; hypothèse signée (contrarienne : longs en hausse pendant une baisse, donc rendement 30 j au-dessus de la référence) ; horizons 7 et 30 j. Puis : 1) exploration jusqu'au 2022-12-31, test du 2023-01-01 au 2026-10 jamais consulté ; 2) un seul événement par épisode, avec l'hystérésis de validationSignaux.ts ; 3) nul par décalages circulaires (valider-axis-flux.ts:761), même décalage pour BTC et ETH ; 4) critère : p unilatérale ≤ 0,05 sur la cellule regroupée et même signe sur BTC et ETH, sinon NON CONCLUANT ; 5) régression de contrôle (rendement à 30 j sur ΔlongsBitfinex + funding + basis) pour montrer une information distincte. Sans succès, une ligne descriptive dans DES au plus, aucun indicateur au registre.

**Preuve d'intérêt (idéation).** Métrique suivie en pratique (CoinGlass publie « Bitfinex Margin Long/Short », vérifié) ; aucune littérature académique trouvée. Position financée sans échéance ni funding de perp : information distincte de l'OI et du funding.

**Mesure de succès.** ≥ 3 ans d'historique BTC ; event study Δ longs 30 j > p90 et < p10 à 30 j, et « longs +x % en baisse » à 7 j ; sans significativité, ligne DES seule.

**Fichiers à toucher.**

- shared/extapi-hosts.ts
- apps/web/src/data/bitfinexMarge.ts (nouveau + test)
- apps/web/src/components/DerivativesWindow.tsx
- apps/web/src/data/validationSignaux.ts
- apps/daemon/src/proxy.ts (TTL ttlMsExtapi :1041, facultatif)
- BUILD-CONTRACT.md (exception)
- plus tard : packages/types/src/index.ts, apps/web/src/chart/auxProvider.ts, packages/indicators/src/derivatives/margeBitfinex.ts, packages/indicators/src/registry.ts

**Avis des juges.**

- valeur (2) : Nouveau fournisseur pour un signal surtout anecdotique (« baleines Bitfinex »), confondu avec les jambes de portage. Granularité et profondeur de pos.size non vérifiées (recherche web épuisée).
- cout-risque (2) : Nouveau fournisseur (BUILD-CONTRACT.md:26, :80). Granularité et profondeur de pos.size non vérifiées : si seul le 1m existe, 3 ans demandent des centaines d'appels. CGU inconnues. Les longs de marge peuvent être une jambe de portage, d'où un risque d'interprétation directionnelle fausse.
- coherence (2) : Nouveau fournisseur, Bitfinex, sans source défaillante remplacée (BUILD-CONTRACT.md:26, :80). La granularité de pos.size n'est pas vérifiée et la série graphe exigerait plus tard un AuxSeriesId.

### 51. SUG-43 — Macro inter-marchés : liquidité des banques centrales en USD (Fed + BCE + BoJ) avec décalage mesuré sur BTC, et bêtas macro glissants de l'actif (Nasdaq, dollar large, taux réels)

**Score 7/20** · valeur 2 · coût-risque 3 · cohérence – · effort révisé **M** (initial M) · existe déjà : partiellement · exception fournisseur : non · exception G100 : oui · catégorie : quantitatif · origines : QNT-6, QNT-7

**Question de trading.** La liquidité est-elle porteuse pour 1 à 3 mois, avec quel décalage BTC a-t-il réagi sans le choisir à l'œil, et l'actif se comporte-t-il en ce moment comme un actif risqué lié au Nasdaq, comme l'inverse du dollar ou de façon propre ?

**Proposition retenue après vérification.** Deux livrables séparés. (1) Dans SCEN, bêtas glissants : estimerMultifactoriel appliqué en fenêtre 90 j avec un pas de 1 j, sur les facteurs existants (SPY, UUP, GLD, DFII10) plus QQQ, avec R², part idiosyncratique et bandes ±2 ET. Pas de DTWEXBGS sans justification écrite. (2) Dans NETLIQ, une section « actifs des banques centrales en USD » : WALCL, plus le bilan de l'Eurosystème × EUR/USD, plus la BoJ ÷ USD/JPY. Elle montre la contribution de chaque banque et la part due au change, et date chaque point à sa publication via ALFRED. La composante Fed est WALCL, pas NETLIQ. Identifiants FRED, ou repli BCE et BOJ sur les hôtes déjà admis, à vérifier avant le code. L'étude du décalage liquidité → BTC se fait d'abord hors ligne dans scripts/ (Newey-West, deux moitiés, rapport publié même nul) ; aucune surimpression décalée dans l'interface avant cela.

**Proposition initiale.** (1) Série pure Fed (WALCL) + Eurosystème × DEXUSEU + BoJ / DEXJPUS, LOCF hebdomadaire, contributions par banque et part due au change, Chine exclue et dite. Corrélation croisée Δ13 semaines liquidité / rendement BTC des 13 semaines suivantes, décalages 0-26, t de Newey-West, affichée seulement si les deux moitiés concordent ; surimpression décalée optionnelle libellée « corrélation passée ». (2) betasGlissants(fenêtre 90 j, pas 1 j) sur ajusterOls : β SPY/QQQ, β dollar (DTWEXBGS en rendements log), β taux réel (DFII10), R² et part idiosyncratique, bandes ±2 ET ; section SCEN et colonne CORR·Paires.

**Ce qui existe déjà.** NETLIQ ne couvre que la Fed : WALCL − TGA − RRP (apps/web/src/data/netliq.ts:2, :58-60, :162, :255-268), avec une surimpression BTC sur 10 ans (netliq.ts:271-309). statsNetliq se limite à courant, Δ4 semaines, min et max (netliq.ts:221-248). Il n'y a ni décalage ni corrélation croisée. Le catalogue précise « aucun total mondial » (apps/web/src/data/macro/catalogueMacro.ts:51). SCEN multifactoriel fait une seule OLS jointe par fenêtre de 90, 180 ou 365 j, avec bêtas par moitié (apps/web/src/data/scenMultifactor.ts:117-165). Facteurs : btc, eth, SPY, UUP, GLD et DFII10 (apps/web/src/data/scenMultifactorLoader.ts:11-18). Ni QQQ, ni fenêtre glissante. L'indicateur betaRef calcule un bêta glissant, mais refClose ne lit que du spot Binance (packages/indicators/src/statistical/betaRef.ts:1-40 ; apps/web/src/chart/auxProvider.ts:466-497). betasVsRef existe dans PORT (apps/web/src/data/portRisque.ts:207). Le module ALFRED donne les dates connuDepuis (apps/web/src/data/macro/alfred.ts:1-16). Le transport BOJ est figé sur le code PPI et rejette tout autre code ou unité (apps/web/src/data/macro/boj.ts:15, :20, :45). Le transport BCE ne charge que les rendements (apps/web/src/data/macro/treasuryYields.ts:189-206).

**Réutilise.** fetchSerieFred, normaliserSerie et LOCF (netliq.ts:43-186), transports BCE et BOJ (apps/web/src/data/macro/treasuryYields.ts:194 ; apps/web/src/data/macro/boj.ts:46, à généraliser), ajusterOls et variationsDatees (scenMultifactor.ts:47, :82), collecte multifactorielle.

**Point d'intégration.** (a) Bêtas glissants : boucle sur ajusterOls ou estimerMultifactoriel (scenMultifactor.ts:82, :132) en fenêtre 90 j avec un pas de 1 j, dans une section SCEN. QQQ s'ajoute au type local FacteurMultiId (scenMultifactor.ts:2) et à FACTEURS_MULTI. (b) Liquidité des banques centrales : fetchSerieFred passe par /fredapi (api/_policy.ts:47) avec la clé serveur FRED_API_KEY (shared/server-credentials.ts:3). Séries : WALCL plus DEXUSEU et DEXJPUS, recensées en docs/research/09-recensement-series-macro.md:97, :211. Repli sans nouveau fournisseur : bilan BCE via data-api.ecb.europa.eu, déjà sur la liste blanche (shared/extapi-hosts.ts:37), et BoJ via getDataCode, chemin déjà autorisé (extapi-hosts.ts:15, :57) une fois boj.ts généralisé. Section de la fenêtre NETLIQ existante.

**Sources.**

- FRED (WALCL, DEXUSEU, DEXJPUS, DTWEXBGS, DFII10 ; ECBASSETSW et JPNASSETS supposés) (déjà utilisée ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : non) : WALCL et DFII10 déjà utilisés ; DEXUSEU, DEXJPUS, DTWEXBGS recensés dans docs/research/09-recensement-series-macro.md ; ECBASSETSW et JPNASSETS non vérifiés ; licences de réaffichage des séries de tiers non vérifiées.
- Twelve Data SPY, QQQ (déjà utilisée ; clé gratuite (serveur) ; vérifiée en ligne par l'idéation : non) : Déjà utilisés ; ≤ 2 crédits par rafraîchissement.

**Contrat.** Pas de nouveau fournisseur si l'on passe par FRED, ou par les hôtes BCE et BOJ déjà admis. La clé FRED est déjà côté serveur. Aucun hôte ni CSP nouveaux, pas de @axiom/types. Exception G100 pour les nouvelles sections SCEN et NETLIQ. Twelve Data tourne avec la clé serveur partagée par les visiteurs : QQQ coûte 1 crédit de plus par rafraîchissement (voir SECV-2 dans docs/revue-2026-11-06.md). DTWEXBGS est explicitement proscrit par docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md:212, dans le contexte des comparaisons de change réel. En rendements log c'est défendable, mais il faut une justification écrite ou garder UUP comme SCEN. La version complète, avec surimpression décalée et colonne CORR·Paires, serait plutôt L.

**Risques.** 1) Non vérifié : les identifiants ECBASSETSW et JPNASSETS, leurs unités et fréquences, ainsi que la licence de réaffichage des séries BCE et BoJ servies par FRED. fred.stlouisfed.org était inaccessible depuis le conteneur et le budget de recherche web est épuisé : il faut les vérifier avant tout code. 2) Fréquences mêlées : la Fed est hebdomadaire, la BoJ probablement mensuelle (non vérifié). Avec un LOCF hebdomadaire, le Δ13 semaines se fait par marches. Les unités diffèrent (M€, centaines de millions de ¥) et l'effet de change peut dominer la variation. 3) Look-ahead : WALCL d'un mercredi est publié le jeudi. Sans dater chaque point par sa publication (alfred.ts connuDepuis), le décalage mesuré est biaisé. 4) Fenêtres de 13 semaines qui se chevauchent et 27 décalages testés : le risque de corrélation fallacieuse est élevé. Newey-West demande une bande ≥ 13 et la concordance par moitié est indispensable. 5) Incohérence interne : la proposition définit la Fed par WALCL, mais son critère de succès exige « composante Fed = NETLIQ », qui vaut WALCL − TGA − RRP. 6) Une fenêtre de 90 jours calendaires donne environ 62 jours tradfi communs, alors que le seuil est n ≥ max(30, 10(k+1)) (scenMultifactor.ts:149). Avec 5 facteurs on est à la limite et les bêtas glissants seront bruités. 7) Les séries FRED sont révisées.

**Intérêt analytique.** faible ; verdict utile_avec_reserve. Bêtas macro glissants : utiles en description, à peu de frais, sans nouvel hôte. Mais ils prolongent SCEN plus qu'ils n'apportent une mesure nouvelle, et il faut les corriger de la non-synchronie. Liquidité mondiale avec « décalage mesuré » : proche du gadget en l'état, faute de puissance statistique et à cause des tests multiples (8,5 % de faux positifs sous l'hypothèse nulle par simulation). Afficher la série et ses contributions, mais ne surimposer aucun décalage tant qu'une étude unique, figée et aux dates de publication ne l'a pas confirmé. Références externes non revérifiées : quota WebSearch épuisé, fred.stlouisfed.org bloqué.

**Références.**

- Howell, « Capital Wars » (2020), et CrossBorder Capital : thèse praticienne de la liquidité mondiale, non revérifiée en ligne
- Adrian, Iyer, Qureshi, blog du FMI de janvier 2022, « Crypto Prices Move More in Sync With Stocks » : non revérifié en ligne
- Granger & Newbold, « Spurious regressions », J. Econometrics 1974 ; Newey & West 1987 : classiques, non revérifiés en ligne
- Dimson, JFE 1979 (bêtas et cotations non synchrones) : non revérifié en ligne
- FRED ECBASSETSW (hebdomadaire) et JPNASSETS (mensuel) : existence et conditions non vérifiées, hôte fred.stlouisfed.org bloqué par le réseau de la session
- Interne : docs/research/09-recensement-series-macro.md:60, :97, :211 (DTWEXBGS, DEXUSEU, DEXJPUS vérifiés vivants au 2026-08-28) ; docs/research/03-roadmap-bloomberg-perso.md:65
- Simulation locale /tmp/claude-0/-home-user-axiom/006b3956-3bcb-553d-93c7-502146b32fa7/scratchpad/outils-analyse/leadlag-faux-positifs.py : sous l'hypothèse nulle (séries indépendantes, 480 semaines, 27 décalages, Newey-West, deux moitiés de même signe avec |t| > 2), 8,5 % de faux positifs

**Redondance.** Forte pour les bêtas. SCEN multifactoriel couvre déjà BTC, ETH, SPY, UUP (dollar), GLD et DFII10 (apps/web/src/data/scenMultifactorLoader.ts:11-17) sur des fenêtres de 90, 180 ou 365 j (apps/web/src/data/scenMultifactor.ts:117, :136). betaRef et rollingCorrelation donnent déjà des bêtas glissants, mais seulement contre des références crypto. betasGlissants revient à faire glisser estimerMultifactoriel. DTWEXBGS doublonne UUP. Liquidité : NETLIQ (Fed seule) existe (apps/web/src/data/netliq.ts:2, :162). Il n'existe ni total mondial (apps/web/src/data/macro/catalogueMacro.ts:51) ni corrélation croisée à décalages (grep lead.?lag, corrélation croisée, newey : rien). Les transports BCE et BoJ existent déjà (apps/web/src/data/macro/treasuryYields.ts:194, apps/web/src/data/macro/boj.ts:46), ce qui évite de dépendre de FRED pour ECBASSETSW et JPNASSETS.

**Pièges.** Puissance très faible : BTCUSDT Binance ne commence qu'au 2017-08-17 (scripts/axis/manifeste-v2-2026-10-07.json:42), soit environ 37 fenêtres de 13 semaines indépendantes et environ 18 par moitié. Tests multiples : 27 décalages, et la règle « deux moitiés concordantes » laisse 8,5 % de faux positifs sous l'hypothèse nulle (simulation). Le décalage choisi comme meilleur sera donc souvent du bruit. Latence de publication : WALCL est publiée le jeudi pour le niveau du mercredi, la BoJ en mensuel. Un LOCF aligné sur la date d'OBSERVATION et non de PUBLICATION est une anticipation. FRED ne garde pas les millésimes hors ALFRED. Conversion en USD : une part de la « liquidité mondiale » n'est que le dollar inversé, ce qui double le comptage avec le β dollar. Clôtures non synchrones (Binance à 00:00 UTC, NYSE vers 21:00 UTC) : les bêtas quotidiens sont biaisés vers 0, il faut des retards à la Dimson ou des rendements sur 2 jours. SPY et QQQ sont quasi colinéaires et ne doivent pas figurer dans la même régression ; dollar et taux réel sont corrélés. Environ 60 séances par fenêtre de 90 j : intervalles larges. Chine exclue. CGU de réaffichage des séries de tiers sur FRED : non vérifiées.

**Protocole de validation.** Liquidité : préenregistrer UN seul décalage, choisi d'après la littérature et non d'après les données, et un seul test. Ou, si l'on garde le balayage 0-26, tester le max |t| contre sa distribution de permutation (décalage circulaire des rendements BTC, 1999 tirages, comme le test de timing d'AXIS). Aligner sur les dates de publication. Publier le rapport même nul, puis ne retenir qu'un suivi en données postérieures au figeage, très lent à un horizon de 13 semaines. Bêtas : aucune promesse prédictive. Contrôles numériques : bêtas glissants = estimerMultifactoriel sur la dernière fenêtre à 1e-12, somme des contributions = total. Ajouter un retard à la Dimson et comparer la stabilité des bêtas avec et sans ce retard.

**Preuve d'intérêt (idéation).** Thèse praticienne de Howell (« Capital Wars ») non vérifiée ; risque de régression fallacieuse sur niveaux (Granger & Newbold 1974), d'où les variations et le contrôle par moitié. Hausse de la corrélation crypto/actions depuis 2020 (FMI 2022, cité) ; roadmap du dépôt (docs/research/03-roadmap-bloomberg-perso.md:65).

**Mesure de succès.** Somme des contributions = total à 1e-9, composante Fed = NETLIQ ; décalage affiché seulement si |t| > 2 dans les deux moitiés, rapport publié même nul ; betasGlissants = estimerMultifactoriel à 1e-12 sur la dernière fenêtre.

**Fichiers à toucher.**

- apps/web/src/data/scenMultifactor.ts
- apps/web/src/data/scenMultifactorLoader.ts
- apps/web/src/components/scen/ (section bêtas glissants)
- apps/web/src/data/liquiditeBanquesCentrales.ts (nouveau, + test)
- apps/web/src/data/netliq.ts
- apps/web/src/components/NetliqWindow.tsx
- apps/web/src/data/macro/boj.ts (si repli BoJ direct)
- scripts/ (étude de décalage hors ligne)

**Avis des juges.**

- valeur (2) : Les bêtas glissants donnent un contexte macro correct. L'étude du décalage liquidité → BTC a une puissance très faible (environ 37 fenêtres indépendantes depuis 2017). Identifiants BCE et BoJ non vérifiés. Peu actionnable en swing.
- cout-risque (3) : Pas de fournisseur nouveau, mais identifiants ECBASSETSW et JPNASSETS, unités, fréquences et droits de réaffichage non vérifiés. QQQ coûte 1 crédit Twelve Data de plus par rafraîchissement sur la clé partagée. ALFRED ajoute de la complexité. L'étude du décalage a une puissance très faible (environ 18 fenêtres par moitié).
