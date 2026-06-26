# AXIOM — Catalogue d'indicateurs à edge (crypto, orderflow & dérivés)

**Date :** 2026-06-26 · **Auteur :** recherche quant / microstructure · **Branche :** PERSO mono-utilisateur, données gratuites · **Statut :** recherche — décision avant code.

> Ce document propose un **catalogue d'indicateurs au-delà des 7 de base du MVP** (SMA, EMA, RSI, MACD, Bollinger, Volume, VWAP). Objectif : identifier ce qui apporte un **vrai edge sur les marchés crypto** (orderflow + dérivés), en restant **réaliste pour un outil perso branché sur des WS/REST publics gratuits**.
>
> À lire avant : `BUILD-CONTRACT.md` et `~/AXIOM-revue-critique-2026-06-26.md` (surtout §4 « faits dérivés vérifiés » et §5 « build-vs-buy »). Les contraintes de fiabilité de données de §4 **gouvernent tout ce catalogue** et sont rappelées par indicateur.

---

## Légende — qualité de preuve

Distinguer une preuve académique d'une heuristique de praticien est essentiel : **ne pas blanchir un blog de courtier en « edge prouvé »**.

- **[acad]** — appui dans la littérature académique évaluée par les pairs (relation mesurée, échantillon, publication).
- **[prat]** — heuristique de praticien largement documentée (livres, formateurs, vendeurs d'outils) mais **peu de preuve évaluée par les pairs**. Souvent vraie *mécaniquement*, rarement quantifiée hors échantillon.
- **[web ✓]** — fait technique vérifié en source primaire (doc exchange/API).
- **[web ~]** — relevé web à reconfirmer avant d'engager de l'argent.
- **[jugement]** — analyse de conception, pas un fait vérifiable.

## Légende — fiabilité de la donnée source (perso, gratuit)

- 🟢 **FIABLE** — donnée publique complète et exacte en gratuit.
- 🟡 **PARTIEL** — gratuit mais **dégradé** (throttling, latence, rate-limit, échantillon court) ; utilisable avec garde-fous.
- 🔴 **MODÈLE / NON-FIABLE EN GRATUIT** — soit c'est une *estimation* présentée comme une donnée, soit la source gratuite est structurellement incomplète → **acheter** (Coinalyze/CoinGlass) ou **étiqueter « estimation »**, ne pas vendre comme un fait.

## Où vit l'indicateur dans AXIOM (contrainte d'architecture)

Le moteur `IndicatorDef.calc(candles, params, ctx)` **ne reçoit que des `Candle[]`** (cf. `@axiom/types`). Conséquence directe sur la faisabilité :

- **MOTEUR** — calculable dans `@axiom/indicators` à partir des bougies (la `Candle` porte déjà `buyVolume`/`sellVolume`/`trades`/`quoteVolume`). Ex. : CVD, delta, AVWAP, ATR, vol réalisée, volume profile approx.
- **PIPELINE ORDERFLOW (M5)** — exige le flux `aggTrade` tick et/ou le carnet L2 `@depth` ; rendu Canvas 2D/WebGL en overlay, hors moteur d'indicateurs. Ex. : footprint, OFI/imbalance de carnet, heatmap L2.
- **PIPELINE DÉRIVÉS (M6, `IDerivedDataProvider`)** — exige OI/funding/L-S/liquidations ; lent (≤ 1 min), acheté (Coinalyze gratuit) ou poll REST limité. Ex. : OI×prix, liquidations cumulées, premium.

---

## RAPPEL — contraintes de fiabilité de données (§4 de la critique) qui cadrent tout le catalogue

Ces points sont **vrais quelle que soit la suite** et conditionnent quels indicateurs sont honnêtes à afficher :

1. **Liquidations Binance sous-comptées par construction [web ✓].** Le WS `forceOrder` ne pousse que « the largest one liquidation order within 1000ms » → **tout cumul/heatmap/alerte basé dessus est sous-estimé**. Garder `forceOrder` pour l'animation de bulles ; pour un chiffre cumulé, **acheter** un flux agrégé.
2. **« Liquidation map par leverage » = un MODÈLE, pas une donnée [jugement+web].** On ignore le levier/entrée réels ; c'est OI × distribution de levier *supposée*. Étiqueter « estimation » ou **acheter** CoinGlass — ne pas reconstruire.
3. **Agrégation cross-exchange non triviale [jugement].** USDT≠USD, `contractSize`, contrats inverses, skew d'horloge. Le contrat interdit l'`AggregationEngine` maison → **rester mono-venue en gratuit**, acheter l'agrégé.
4. **OI Binance : pas de WS, REST 1 symbole/requête, rate-limité [web ~].** Pas de signal OI *live multi-symboles* en gratuit. OK pour 1-quelques symboles à cadence lente.
5. **Funding = le cas FIABLE [web ✓].** WS `!markPrice@arr` (tous symboles, ~1 push/s) ou 1 appel REST all-symbols. C'est la donnée dérivée la **plus propre** en gratuit — un edge en soi.
6. **Fournisseurs dérivés plafonnent à ~1 min de latence [web ~].** On **achète le dérivé lent** (OI/funding/L-S/liq cumulées via Coinalyze gratuit, 40 req/min) mais on **garde le WS** pour CVD/footprint/L2 sub-seconde.

---

# CATÉGORIE A — Orderflow natif (le cœur de l'edge crypto, gratuit en mono-Binance)

## A1. CVD — Cumulative Volume Delta + divergences

- **Catégorie :** `orderflow` · **Pane :** séparé (ligne) · **Vit :** MOTEUR (par bougie) ou PIPELINE (tick fin).
- **Ce qu'il mesure :** la pression nette des *takers* (agresseurs). Monte quand les acheteurs frappent l'offre, descend quand les vendeurs frappent la demande. C'est le « qui pousse » derrière le prix.
- **Formule :**
  - Classification par trade (Binance `aggTrade`, champ `m` = « buyer is maker ») : si `m=true` → agresseur **vendeur** ; si `m=false` → agresseur **acheteur**.
  - Delta par bougie : `delta_t = buyVol_t − sellVol_t` (déjà mappable sur `Candle.buyVolume`/`sellVolume`).
  - `CVD_t = CVD_{t-1} + delta_t` (somme cumulée ; ancrer le départ à un point de session/anchor pour éviter un offset arbitraire).
- **Données requises :** WS `@aggTrade` Binance (spot ou perp) pour la classification fine ; ou `Candle.buyVolume/sellVolume` pré-agrégés. 🟢 **FIABLE** (gratuit, mono-venue). *NB : ce CVD est **par venue** ; un « CVD agrégé multi-exchange » retombe sous la contrainte §3 → ne pas le construire en gratuit.*
- **Edge :** la **divergence prix/CVD** est le setup phare — nouveau plus-haut de prix *sans* nouveau plus-haut de CVD = absorption/épuisement de la pression acheteuse (et symétriquement). Edge le plus net quand la divergence est sur un TF supérieur et que le funding est extrême dans le même sens (fade haute conviction). **[prat]** — très documenté (Bookmap, ATAS, Tradingriot, Hyblock) mais **support académique mince** ; c'est une heuristique mécaniquement saine, pas un edge backtesté hors échantillon publié.
- **Pièges :** (a) une divergence signale un *affaiblissement de momentum*, **pas** un retournement garanti — beaucoup se résolvent en consolidation. (b) La classification par `m` est une approximation de l'agresseur (correcte sur Binance, mais pas du « lee-ready » académique). (c) CVD a un **offset dépendant de l'ancrage** → comparer des pentes/divergences, pas des niveaux absolus. (d) Sensible aux wash-trades sur petites paires.
- **Crypto-spécifique ?** Le *concept* (delta de volume) est extensible aux futures tradi/commodités (le footprint vient de là, CME). En crypto il est **gratuit et trivial** car les exchanges publient l'agresseur ; sur actions US c'est plus dur (besoin du tick rule / SIP).

## A2. Divergence CVD **spot vs perp** (mono-Binance, gratuit) ⭐

- **Catégorie :** `orderflow` · **Pane :** séparé (2 lignes) · **Vit :** PIPELINE (2 flux `aggTrade`).
- **Ce qu'il mesure :** qui pousse le prix — **vrais acheteurs au comptant** (spot CVD) vs **spéculation à levier** (perp CVD). Spot = transfert de propriété réel ; perp = exposition synthétique réflexive.
- **Méthode :** calculer **deux** CVD séparés — un sur `btcusdt@aggTrade` (spot) et un sur le `btcusdt@aggTrade` **USDⓈ-M futures** — puis comparer leurs pentes / chercher la divergence entre les deux.
- **Données requises :** 2 WS `aggTrade` Binance (spot + USDT-M perp), **les deux gratuits et publics**. 🟢 **FIABLE** — et **sans aucun moteur d'agrégation** (même venue, même quote USDT) → contourne proprement la contrainte §3.
- **Edge :** lecture qualitative à fort contenu : *spot CVD monte mais perp CVD plat/faible* = sponsorship par de l'argent réel, mouvement plus **durable** ; *perp CVD explose mais spot CVD plat/vend* = mouvement **fragile**, alimenté par chasing/short-squeeze, sujet à reversal une fois les spéculateurs sortis. Le perp « ment » plus facilement (liquidations forcées comptent comme de l'agression acheteuse). **[prat]** (BitMart, CryptoAdventure, CryptoCred, 52kskew).
- **Pièges :** spot et perp n'ont pas le même volume/profil de participants → normaliser (z-score ou pente, pas niveaux bruts). Skew d'horloge entre les 2 flux à aligner. Reste une heuristique, pas un signal mécanique.
- **Crypto-spécifique ?** **Oui, intrinsèquement** — la dichotomie spot/perp n'existe qu'avec les perpétuels crypto. **C'est l'item le plus distinctif et le plus faisable en gratuit du catalogue.**

## A3. Footprint — imbalance & absorption (delta par niveau de prix)

- **Catégorie :** `orderflow` (`FootprintBar` existe déjà dans `@axiom/types`) · **Vit :** PIPELINE M5 (Canvas 2D, pas WebGL — dominé par le texte).
- **Ce qu'il mesure :** à chaque **niveau de prix** d'une bougie, le volume acheteur agressif vs vendeur agressif (bid×ask footprint). Révèle où les agresseurs se concentrent et où des limites les absorbent.
- **Méthode / formules :**
  - Agréger les `aggTrade` par `(bougie, prix arrondi au tick/bin)` → `FootprintRow{price, buyVol, sellVol}`.
  - **Imbalance diagonal** (convention footprint) : à un niveau, comparer `askVol[price]` au `bidVol[price−1tick]`. Imbalance si `askVol / bidVol(niveau inférieur) ≥ ratio` (typ. 3:1 ou 300 %).
  - **Stacked imbalance** : ≥ 3 imbalances du même côté à des niveaux adjacents → zone d'agression forte / support-résistance.
  - **Absorption** : fort volume à un niveau **sans** progression du prix → de grosses limites absorbent les market orders (signal de retournement potentiel).
  - **Delta divergence** : nouveau plus-haut de prix avec delta de bougie opposé.
  - POC/VAH/VAL de la bougie : POC = niveau de volume max ; Value Area = expansion autour du POC jusqu'à 70 % du volume de la bougie.
- **Données requises :** WS `aggTrade` + binning au tick. 🟢 **FIABLE** (gratuit, mono-venue). Rétention : ring buffer mémoire court (pas de DB en MVP).
- **Edge :** absorption et stacked imbalances sont parmi les signaux orderflow les plus utilisés pour repérer l'activité d'acteurs taille. **[prat]** — riche littérature praticien (NinjaTrader, ATAS, OrderflowLabs), héritée du footprint CME ; **pas de preuve académique** propre. Mécaniquement crédible, à valider visuellement.
- **Pièges :** le footprint « bid/ask » vrai exige de savoir contre quel côté du carnet chaque trade s'est exécuté — `aggTrade` donne l'agresseur (proxy correct) mais pas le niveau de carnet exact. Très sensible au binning de prix. Bruit énorme en bas TF / paires illiquides. Coûteux à rendre (beaucoup de cellules de texte).
- **Crypto-spécifique ?** Non — **directement issu** des futures tradi (Market Profile/CME). Extensible plus tard ; en crypto c'est gratuit côté données.

## A4. Taker buy/sell ratio (agrégé Binance, REST)

- **Catégorie :** `orderflow`/`derivatives` · **Vit :** PIPELINE dérivés (poll REST) ou MOTEUR si dérivé en `Candle.buyVolume`.
- **Ce qu'il mesure :** ratio agressif acheteur/vendeur **déjà agrégé** par Binance sur le perp (vue « sentiment des takers »).
- **Formule :** `buySellRatio = buyVol / sellVol` (endpoint `GET /futures/data/takerlongshortRatio`, champs `buyVol`/`sellVol`/`buySellRatio`).
- **Données requises :** REST `/futures/data/takerlongshortRatio`. 🟡 **PARTIEL** : gratuit, **mais** bucket dédié **1000 req/5 min**, **30 derniers jours seulement**, pas de WS → poll lent, peu de symboles. **[web ✓]**.
- **Edge :** version « prête à l'emploi » du delta de A1, utile en cross-check / screener léger. **[prat]**. Redondant avec un CVD calculé soi-même (qui est plus granulaire et live) — surtout intéressant pour le screener multi-symboles où recalculer le CVD tick coûte trop cher.
- **Pièges :** agrégé en buckets (5m/15m/1h…), donc **pas live** ; 30 j d'historique ; le rate-limit interdit le balayage de 1000 symboles (cf. §4 critique).
- **Crypto-spécifique ?** Spécifique à l'API Binance, mais le concept (taker imbalance) est universel.

## A5. Order Flow Imbalance (OFI) & déséquilibre de carnet (depth imbalance)

- **Catégorie :** `orderflow` · **Vit :** PIPELINE M5 (carnet L2 `@depth`).
- **Ce qu'il mesure :** le déséquilibre offre/demande au **meilleur bid/ask** (et niveaux proches) — le prédicteur le plus établi *académiquement* des variations de prix à court horizon.
- **Formules :**
  - **OFI (Cont, Kukanov & Stoikov 2014)** — contribution à chaque mise à jour L1 :
    `e_n = 𝟙(P_b^n ≥ P_b^{n-1})·q_b^n − 𝟙(P_b^n ≤ P_b^{n-1})·q_b^{n-1} − [𝟙(P_a^n ≤ P_a^{n-1})·q_a^n − 𝟙(P_a^n ≥ P_a^{n-1})·q_a^{n-1}]`
    `OFI sur [t, t+Δ] = Σ e_n`. Relation **linéaire** mesurée : `ΔP ≈ β·OFI`, avec `β` ∝ 1/profondeur du marché.
  - **Depth/book imbalance** (plus simple, instantané) : `I = (ΣbidSize − ΣaskSize) / (ΣbidSize + ΣaskSize)` sur N niveaux. I ∈ [−1, 1].
- **Données requises :** WS `@depth` (carnet L2 incrémental) Binance, gratuit. 🟡 **PARTIEL** : le **flux** est fiable, mais la donnée arrive en **snapshots/deltas ~100-250 ms** — suffisant pour l'OFI L1 agrégé, **insuffisant pour reconstruire l'événementiel L3** (add/modify/cancel µs). → **OK pour OFI/imbalance ; PAS pour détection de spoofing/iceberg** (cf. §6 critique : infaisable depuis des snapshots).
- **Edge :** **[acad] — le mieux étayé du catalogue.** Cont, Kukanov & Stoikov (*Journal of Financial Econometrics*, 2014) établissent la relation linéaire OFI→prix, pente ∝ 1/profondeur ; nombreuses extensions (multi-niveaux, cross-impact, OFI décomposé) confirment le pouvoir prédictif court-horizon sur les LOB modernes, toutes classes d'actifs.
- **Pièges :** edge à **très court horizon** (secondes), s'érode vite et coûte cher à exploiter sans co-location (pas le cas perso). En perso, **valeur surtout descriptive/visuelle** (pression de carnet) plutôt que tradable HFT. Le resync L2 doit être correct (Binance futures = champ `pu` ; cf. §7 critique). Reste fragile sur snapshots échantillonnés.
- **Crypto-spécifique ?** **Non — résultat académique général** (actions d'abord). Le plus extensible aux marchés tradi/commodités ultérieurs.

---

# CATÉGORIE B — Dérivés (positionnement & financement)

## B1. Open Interest × Prix — état directionnel (build-up / squeeze)

- **Catégorie :** `derivatives` · **Vit :** PIPELINE dérivés (OI lent).
- **Ce qu'il mesure :** OI = nb de contrats ouverts (capital déployé), **pas** un biais directionnel. Croisé avec le prix, il classe la *nature* du flux. **L'OI seul est un signal de volatilité, pas de direction.**
- **Méthode — modèle à 4 quadrants :**
  | Prix | OI | Lecture |
  |---|---|---|
  | ↑ | ↑ | nouveaux **longs** — tendance haussière avec conviction |
  | ↑ | ↓ | **short covering** — rebond moins durable |
  | ↓ | ↑ | nouveaux **shorts** — tendance baissière avec conviction |
  | ↓ | ↓ | **liquidation/clôture de longs** — capitulation/épuisement |
  - `ΔOI%` et `ΔPrix%` sur la fenêtre ; **build-up** = OI↑ soutenu sans réalisation de prix → réservoir de carburant pour un squeeze.
- **Données requises :** OI Binance. 🟡 **PARTIEL** : **pas de WS OI**, REST `/fapi/v1/openInterest` **1 symbole/requête**, rate-limité (cf. §4) → OK pour 1-quelques symboles à cadence ≥ 15-30 s ; **interdit un screener OI 1000 symboles**. Alternative : **acheter** l'OI agrégé Coinalyze (gratuit, ≤ 1 min).
- **Edge :** distinguer « nouveaux shorts » d'un « short covering » change la durabilité attendue du move ; couplé au funding/L-S, identifie les configs de squeeze (OI haut + positionnement crowded). **[prat]** largement enseigné (CryptoCred, MetaMask, Phemex) ; mécaniquement solide.
- **Pièges :** (a) **ne jamais lire l'OI comme directionnel seul** — c'est l'erreur classique. (b) L'OI agrégé multi-exchange retombe sous §3 (contractSize/inverse) → préférer l'acheté. (c) Latence ≥ 1 min en gratuit agrégé → pas pour du timing fin.
- **Crypto-spécifique ?** Concept de futures classique (extensible CME/commodités), mais la lecture *perp* (pas d'expiration, OI persistant) est très crypto.

## B2. Funding rate — extrêmes & funding-adjusted (le cas FIABLE) ⭐

- **Catégorie :** `derivatives` · **Vit :** PIPELINE dérivés, mais **donnée la plus propre en gratuit**.
- **Ce qu'il mesure :** coût de portage du perp = pression de positionnement. Funding positif élevé = longs crowded payent les shorts (perp au-dessus du spot) ; négatif = inverse.
- **Formules :**
  - Funding annualisé (comparable entre intervalles) : `APR = rate × (24/intervalleHeures) × 365` (8h → `rate × 3 × 365`). **Critique :** normaliser par `intervalMs` natif (déjà prévu dans `FundingRate.intervalMs`) car certains symboles fundent en 4h/1h.
  - **Z-score d'extrême** : `z = (rate − μ_n) / σ_n` sur une fenêtre n → fade contrarian quand |z| extrême.
  - **Funding-adjusted** : pondérer un signal long/short par le coût de funding payé (un long en funding très positif a un edge net réduit).
- **Données requises :** WS `!markPrice@arr` (tous symboles, ~1/s) **ou** 1 appel REST all-symbols (weight ~10). 🟢 **FIABLE** — **le seul dérivé vraiment live et complet en gratuit** (cf. §4 critique). Historique : REST `/fapi/v1/fundingRate`.
- **Edge :** funding extrême = indicateur **contrarian** documenté ; un funding persistant très positif signale un positionnement long surchauffé → vulnérable à un long-squeeze (et inversement). La jambe « cash-and-carry » (short perp + long spot) capte le funding comme rendement quasi directionnellement neutre. **[acad] partiel** : la littérature sur le **crypto-carry**/funding existe (SSRN, arXiv 2506.08573 sur le design des funding rates, ScienceDirect sur l'arbitrage de funding CEX/DEX). ⚠️ **Le « Sharpe ~6.45 sur 2020-2025 » est un snippet de recherche non vérifié** (frais/slippage/risque de queue type dé-peg exclus) — à attribuer, **pas** à affirmer comme un fait.
- **Pièges :** « extrême » est régime-dépendant (calibrer μ/σ en glissant, pas un seuil fixe). Le carry n'est neutre qu'en couverture parfaite — risque de dé-peg/liquidation réel. Un funding élevé peut **persister** longtemps en bull (le contrarian se fait étrirer).
- **Crypto-spécifique ?** **Oui** — mécanisme propre aux perpétuels crypto (analogue à un term structure futures mais en continu).

## B3. Basis spot-perp (term structure / contango-backwardation)

- **Catégorie :** `derivatives` · **Vit :** PIPELINE (markPrice perp vs spot) — calculable live & gratuit.
- **Ce qu'il mesure :** écart perp/futures vs spot = prime de portage / sentiment de levier. Analogue continu de la term structure (contango = futures > spot ; backwardation = futures < spot).
- **Formules :**
  - Perp : `basis% = (markPrice_perp − price_spot) / price_spot × 100`.
  - Futures datés (Deribit/Binance) : `basis annualisé = ((F − S)/S) × (365/joursÉchéance)`.
- **Données requises :** `markPrice` perp (WS `!markPrice@arr`) + prix spot (WS `aggTrade`/`bookTicker`). 🟢 **FIABLE** (les deux gratuits, même venue → pas d'agrégation).
- **Edge :** basis/contango étiré = euphorie de levier (proche d'un top potentiel) ; **backwardation profonde** = stress/short-demande, historiquement associée à des bottoms (ex. backwardation post-FTX la plus profonde signalée en déc. 2025). **[prat]/[web ~]** : étayé par des notes d'acteurs (CME OpenMarkets, CF Benchmarks) ; relation momentum/sentiment→basis documentée mais pas un edge mécanique propre.
- **Pièges :** très corrélé au funding (B2) — ne pas double-compter. Pour les futures datés, l'annualisation dépend de l'échéance. La prime peut rester étirée durablement.
- **Crypto-spécifique ?** Le basis est un concept de futures classique (commodités/CME) → **extensible**, mais la version perp est crypto.

## B4. Liquidations & cascades — 🔴 PRUDENCE DONNÉE

- **Catégorie :** `derivatives` · **Vit :** PIPELINE (WS `forceOrder` pour l'animation ; acheté pour les chiffres).
- **Ce qu'il mesure :** clôtures forcées de positions à levier ; les **cascades** = liquidations en chaîne (un flush génère des market orders qui déclenchent d'autres liquidations → wicks violents).
- **Méthode :** flux `forceOrder` → bulles/alertes par `side`/`qty`/`price` ; cumuls par fenêtre.
- **Données requises :** WS `@forceOrder` Binance. 🔴 **NON-FIABLE EN CUMUL** : throttlé à **1 ordre/1000 ms** (« only the largest one liquidation order within 1000ms will be pushed ») → **tout total/heatmap est sous-compté par construction** (cf. §4 critique). **[web ✓]**.
  - ✅ Usage honnête : **animation de bulles** (qualitatif, « ça liquide fort »).
  - ❌ Usage malhonnête : afficher un « total liquidations » ou une heatmap quantitative basée sur ce flux.
  - 💰 Pour un cumul correct : **acheter** l'agrégé (Coinalyze gratuit 40 req/min, ou CoinGlass), latence ≤ 1 min assumée.
- **Edge :** des clusters de liquidations marquent souvent des extrêmes locaux (capitulation/épuisement) ; utile comme contexte de timing, **pas** comme déclencheur précis. **[prat]**.
- **Pièges :** **le throttling est le piège n°1** — un dashboard qui agrège `forceOrder` ment sur les chiffres. Étiqueter clairement « flux Binance throttlé (sous-estimé) » si affiché.
- **Crypto-spécifique ?** **Oui** (levier perp + liquidation engine), peu transposable.

## B5. Liquidation heatmap par leverage — 🔴 C'EST UN MODÈLE

- **Catégorie :** `derivatives` · **Vit :** ACHETÉ (CoinGlass) ou COUPÉ.
- **Ce qu'il mesure :** zones de prix où des liquidations massives sont *probables*, par gradient de couleur.
- **Méthode :** `OI × distribution de levier SUPPOSÉE × seuils de liquidation` → carte. **Ce n'est pas une donnée observée** : on ignore le levier et l'entrée réels de chaque trader.
- **Données requises :** 🔴 **MODÈLE PROPRIÉTAIRE** (CoinGlass). En perso : **acheter** ou **ne pas reconstruire** (calibration = R&D lourde sans données de positions réelles). **[jugement+web]**.
- **Edge :** zones « aimant » (clusters de liquidations attirent le prix) — populaire, mais c'est une prophétie partiellement auto-réalisatrice modélisée. **[prat]**.
- **Pièges :** **danger de présentation** — afficher une heatmap modélisée comme une « donnée de liquidations » est exactement l'erreur que §4 dénonce. Si affiché : séparer visuellement des feeds réels + label « estimation ».
- **Crypto-spécifique ?** Oui.

## B6. Long/Short ratio (account / position / top trader)

- **Catégorie :** `derivatives` · **Vit :** PIPELINE (REST `/futures/data/`).
- **Ce qu'il mesure :** part des comptes/positions longs vs shorts ; le **top-trader** vise le « smart money », le **global account** le retail (souvent fade-able).
- **Formule :** `ratio = longAccount / shortAccount` (endpoints `globalLongShortAccountRatio`, `topLongShortPositionRatio`, `topLongShortAccountRatio`). Le type est déjà modélisé (`LongShortRatio.type`).
- **Données requises :** REST `/futures/data/...`. 🟡 **PARTIEL** : bucket **1000 req/5 min**, 30 j, pas de WS → quelques symboles, cadence lente (cf. §4).
- **Edge :** retail global extrême = signal contrarian classique ; top-trader = confirmation/divergence. **[prat]** (CryptoCred, MEXC, Binance trading-data). Faible en isolé, meilleur combiné (OI + funding + L-S = triangle de positionnement).
- **Pièges :** « comptes » ≠ « capital » (un whale = un compte). Définition propre à Binance, non comparable cross-exchange. Bruité ; rate-limit pour le screener.
- **Crypto-spécifique ?** Spécifique perp crypto.

## B7. Coinbase / Exchange premium — 🟡 EXPRIMER EN %, NEUTRALISER USDT

- **Catégorie :** `derivatives`/sentiment (modélisé `PremiumPoint`) · **Vit :** PIPELINE (2 prix spot).
- **Ce qu'il mesure :** demande **US/institutionnelle** via l'écart Coinbase (USD, US-régulé) vs Binance (USDT, global).
- **Formule (correcte) :** `premium% = (P_Coinbase_USD − P_Binance_USDT × (USDT/USD)) / P_Binance × 100`, où `USDT/USD` est un taux de référence (ex. Coinbase USDT-USD). **Ne PAS** faire le naïf `P_CB − P_Binance` (conflate la prime avec le dé-peg USDT/USD — cf. §7 critique). Exprimer en **%**.
- **Données requises :** WS spot Coinbase (`BTC-USD`) + Binance (`BTCUSDT`) + un proxy USDT/USD. 🟡 **PARTIEL** : techniquement gratuit, mais **exact seulement si on neutralise le peg** ; sinon trompeur.
- **Edge :** prime CB positive soutenue = accumulation US (ETF/desks) ; flip positif→négatif pendant une hausse = early warning d'essoufflement de la demande US. **[prat]/[web ~]** (CoinGlass, ainvest, KuCoin) — proxy de demande, **pas** un prédicteur de prix isolé ; les pics brefs sont peu informatifs, c'est la persistance qui compte.
- **Pièges :** **le piège du peg** (ci-dessus). Spreads/latence entre 2 exchanges. Spurious sur micro-écarts.
- **Crypto-spécifique ?** **Oui** (segmentation géographique des venues crypto).

---

# CATÉGORIE C — Technique à edge documenté, pertinent en crypto

## C1. Anchored VWAP (AVWAP)

- **Catégorie :** `volume`/`support_resistance` · **Pane :** overlay · **Vit :** MOTEUR (candles + volume).
- **Ce qu'il mesure :** prix moyen pondéré-volume depuis un **point d'ancrage choisi** (plus-haut/bas de swing, événement macro, ouverture de range) — le « coût de base » des positions entrées depuis cet événement.
- **Formule :** `AVWAP_t = Σ_{i=anchor..t}(typical_i · vol_i) / Σ_{i=anchor..t} vol_i`, `typical = hlc3` (ou ohlc4). Bandes optionnelles : ± k·σ pondéré-volume autour de l'AVWAP.
- **Données requises :** `Candle` (close/volume/hlc3 via `ctx.hlc3`). 🟢 **FIABLE** (gratuit). Input `anchor` = timestamp.
- **Edge :** les institutions exécutent autour du VWAP → les niveaux AVWAP agissent en support/résistance ; convergence de plusieurs AVWAP (ancres différentes) renforce une zone. **[prat]** (popularisé par Brian Shannon) — heuristique d'exécution institutionnelle bien établie, **peu de preuve académique** propre mais le VWAP comme benchmark d'exécution est, lui, un fait de marché.
- **Pièges :** subjectivité de l'ancre (garbage anchor → garbage level). Le VWAP « vrai » des desks utilise des trades réels, pas des bougies → approximation. Moins pertinent sur très long terme (dérive).
- **Crypto-spécifique ?** **Non — universel** (actions/futures), excellent candidat « extensible tradi/commodités ».

## C2. Volume Profile / VPVR (POC, Value Area, HVN/LVN)

- **Catégorie :** `volume`/`support_resistance` (`VolumeProfileBin` existe) · **Vit :** MOTEUR (approx) ou PIPELINE (split buy/sell fin).
- **Ce qu'il mesure :** distribution du volume **par niveau de prix** (axe vertical), pas par temps. Révèle les prix « acceptés » (HVN) vs « rejetés » (LVN).
- **Méthode :**
  - Binner la plage de prix visible ; accumuler le volume par bin (avec split buy/sell si `aggTrade`).
  - **POC** = bin de volume max (prix le plus « accepté », aimant).
  - **Value Area (70 %)** = expansion symétrique autour du POC jusqu'à 70 % du volume total → VAH/VAL.
  - **HVN** = pics (zones de consolidation/équilibre) ; **LVN** = creux (zones de rejet/breakout rapide).
- **Données requises :** volume par bougie (approx VPVR) ou `aggTrade` (profil exact + delta par niveau). 🟢 **FIABLE** (gratuit). VPVR « visible range » = se synchronise sur le viewport KLineChart.
- **Edge :** POC/VA agissent en support/résistance ; le prix « revient au POC » et traverse vite les LVN — edge prix/volume reconnu sur le day-trading. **[prat]** (héritage Market Profile de J. P. Steidlmayer/CBOT) — concept ancien et robuste, validation surtout empirique/praticien.
- **Pièges :** dépend de la fenêtre choisie (VPVR ≠ profil fixe ≠ session). Le « visible range » change le POC quand on pan/zoom (déroutant). Approx par bougie répartit mal le volume intra-bougie (idéalement aggTrade).
- **Crypto-spécifique ?** **Non — universel** (vient des futures CME). Extensible.

## C3. ATR & Volatilité réalisée (filtre de régime / sizing)

- **Catégorie :** `volatility` · **Pane :** séparé · **Vit :** MOTEUR (candles).
- **Ce qu'il mesure :** amplitude de mouvement. ATR = range vrai lissé (capte les gaps) ; vol réalisée = écart-type des rendements (annualisable).
- **Formules :**
  - **ATR (Wilder)** : `TR_t = max(H_t−L_t, |H_t−C_{t-1}|, |L_t−C_{t-1}|)` ; `ATR_t = RMA_n(TR)` (RMA Wilder, déjà mutualisé dans `utils.ts`). *(Réutilise le helper RMA des 7 de base — cohérent avec RSI Wilder.)*
  - **Vol réalisée (close-to-close)** : `r_i = ln(C_i/C_{i-1})` ; `RV = sqrt(Σ_{i} r_i²)` sur fenêtre ; annualisée `× sqrt(périodes/an)`.
  - **Parkinson (high-low, plus efficace)** : `σ_P = sqrt( (1/(4 ln2)) · (1/n) · Σ ln(H_i/L_i)² )`.
- **Données requises :** `Candle` (OHLC). 🟢 **FIABLE** (gratuit).
- **Edge :** non directionnel mais **multiplicateur d'edge** : (a) **filtre de régime** — comparer ATR rapide vs lent distingue expansion (tradable) de bruit ; (b) **sizing/stops adaptatifs** — stops en multiples d'ATR évitent les stops trop serrés/larges selon le régime. Le **clustering de volatilité** (corrélation des |rendements|) est un **fait stylisé académique** des marchés (et marqué en crypto). **[acad]** pour le clustering ; **[prat]** pour l'usage filtre/sizing.
- **Pièges :** retardé (lissage). « Vol réalisée » dépend de la fenêtre et de l'échantillonnage. ATR seul ne dit rien de la direction.
- **Crypto-spécifique ?** **Non — universel.** Excellent socle commun avant l'extension tradi/commodités.

---

# SHORT-LIST PRIORISÉE — « à implémenter après les 7 de base »

Tri par contrainte la plus serrée : **donnée gratuite & fiable → s'intègre à l'outil live perso → edge réel**. Aligné sur la roadmap (M5 orderflow, M6 dérivés achetés).

### Tier 1 — Gratuit, fiable, fort edge, faisable mono-Binance (à faire en premier)

1. **CVD + divergences prix/CVD (A1)** — 🟢 moteur/aggTrade, gratuit. Brique orderflow fondatrice (déjà prévue M5). Edge praticien net, base de tout le reste.
2. **Divergence CVD spot vs perp (A2)** ⭐ — 🟢 2 flux Binance, gratuit, **sans agrégation**. **Item le plus distinctif** : capte argent réel vs levier. Standout faisable.
3. **Funding rate : extrêmes (z-score) + annualisé (B2)** ⭐ — 🟢 **seule donnée dérivée vraiment live/fiable en gratuit** (WS `!markPrice@arr`). Contrarian documenté, peu de code.
4. **ATR + Volatilité réalisée (C3)** — 🟢 moteur, gratuit. Filtre de régime + sizing ; réutilise le RMA Wilder déjà écrit. Multiplie l'edge de tous les autres.
5. **Anchored VWAP (C1)** — 🟢 moteur, gratuit, universel. Faible coût, fort usage praticien, extensible tradi.

### Tier 2 — Gratuit mais dégradé (rate-limit/latence) ou plus lourd à construire

6. **OI × Prix (4 quadrants) (B1)** — 🟡 REST 1 symbole, lent → 1-quelques symboles, ou acheté Coinalyze (M6). Lecture de positionnement essentielle, à cadence lente.
7. **Basis spot-perp (B3)** — 🟢 calculable live, mais redondant avec le funding → après B2.
8. **Volume Profile / VPVR (C2)** — 🟢 gratuit, mais le rendu visible-range demande la synchro viewport KLineChart (après M4).
9. **Footprint : imbalance / absorption (A3)** — 🟢 données gratuites, mais **gros chantier de rendu** (Canvas 2D, M5). Fort edge praticien quand mûr.

### Tier 3 — À étiqueter « estimation » ou à acheter (NE PAS vendre comme donnée)

10. **OFI / depth imbalance (A5)** — 🟡 **mieux étayé académiquement** mais edge sub-seconde peu exploitable en perso → **valeur visuelle**, pas tradable HFT. Chantier L2.
11. **Long/Short ratio (B6)** + **Taker buy/sell ratio (A4)** — 🟡 REST rate-limité, 30 j, bruité. Cross-check de positionnement, screener léger.
12. **Coinbase premium (B7)** — 🟡 **uniquement en % avec neutralisation du peg USDT** ; sinon trompeur.
13. **Liquidations / cascades (B4)** — 🔴 `forceOrder` **throttlé → animation de bulles seulement** ; cumuls = **acheter** (Coinalyze).
14. **Liquidation heatmap par leverage (B5)** — 🔴 **MODÈLE, pas une donnée** → **acheter CoinGlass** ou couper ; jamais affiché comme un feed réel.

### Règle d'or de présentation (transversale)

Tout indicateur 🟡/🔴 doit porter un **label de fiabilité visible** dans l'UI : « flux Binance throttlé (sous-estimé) », « estimation modélisée », « ≤ 1 min de latence », « % neutralisé du peg ». C'est la traduction directe de §4 de la critique — **ne jamais présenter un modèle ou une donnée dégradée comme un fait**.

---

## Sources

**Orderflow / CVD / footprint (praticien) :**
- [Bookmap — CVD Trading Strategy](https://bookmap.com/blog/how-cumulative-volume-delta-transform-your-trading-strategy)
- [Phemex — Cumulative Delta (CVD) Guide](https://phemex.com/academy/what-is-cumulative-delta-cvd-indicator)
- [Tradingriot — Orderflow: Delta vs Liquidity](https://tradingriot.com/orderflow-trading)
- [Hyblock — Volume Delta (CVD)](https://academy.hyblockcapital.com/indicators/orderflow-and-open-interest/volume-delta-cvd)
- [CryptoAdventure — Spot CVD vs Perp CVD](https://cryptoadventure.com/spot-cvd-vs-perp-cvd-explained-which-one-tells-the-truth-first/) · [BitMart — même sujet](https://www.bitmart.com/en-US/news/detail/spot-cvd-vs-perp-cvd-explained-which-one-tells-the-truth-first-41189)
- [52kskew — Crypto Market Flow (edge)](https://52kskew.medium.com/crypto-market-flow-f327cf0c24ca)
- [OrderflowLabs — Footprint: Delta, Bid/Ask, Absorption](https://orderflowlabs.com/blogs/theblog/footprint-chart-guide) · [NinjaTrader — Footprint Charts](https://ninjatrader.com/futures/blogs/ninjatrader-order-flow/) · [LiteFinance — Order Flow with Footprint](https://www.litefinance.org/blog/for-beginners/trading-strategies/order-flow-trading-with-footprint-charts/)

**OFI / déséquilibre de carnet (académique) :**
- [Cont, Kukanov & Stoikov — *The Price Impact of Order Book Events*, J. Financial Econometrics 2014](https://academic.oup.com/jfec/article-abstract/12/1/47/816163) · [preprint arXiv 1011.6402](https://arxiv.org/pdf/1011.6402)
- [*The Price Impact of Generalized Order Flow Imbalance* (arXiv 2112.02947)](https://arxiv.org/pdf/2112.02947)
- [*Cross-Impact of Order Flow Imbalance in Equity Markets* (arXiv 2112.13213)](https://arxiv.org/abs/2112.13213)
- [*Order Flow Decomposition for Price Impact* (ACM AI in Finance / SSRN 4572510)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4572510)

**Open Interest / squeeze / positionnement :**
- [CryptoCred — Comprehensive Guide to Crypto Futures Indicators](https://medium.com/@cryptocreddy/comprehensive-guide-to-crypto-futures-indicators-f88d7da0c1b5)
- [MetaMask — Open Interest in Perps](https://metamask.io/news/open-interest-perps-explained) · [Phemex — Open Interest to Time BTC](https://phemex.com/academy/open-interest-bitcoin-trading-2026)
- [Tradelink — Funding Rate + Open Interest](https://tradelink.pro/blog/funding-rate-open-interest/)
- [Binance Futures — Trading Data (Long/Short, Taker)](https://www.binance.com/en/futures/funding-history/perpetual/trading-data)

**Funding / basis / carry (académique + praticien) :**
- [arXiv 2506.08573 — *Designing funding rates for perpetual futures*](https://arxiv.org/html/2506.08573v1)
- [SSRN — *Funding Rate Mechanism in Perpetual Futures* (Zhang)](https://papers.ssrn.com/sol3/Delivery.cfm/6185958.pdf?abstractid=6185958&mirid=1)
- [ScienceDirect — *Risk and Return of Funding Rate Arbitrage on CEX/DEX*](https://www.sciencedirect.com/science/article/pii/S2096720925000818)
- [arXiv 2510.14435 — *Cryptocurrency as an Investable Asset Class* (carry, Sharpe — à vérifier)](https://arxiv.org/pdf/2510.14435)
- [Yellow — Funding Rates & Reversals](https://yellow.com/learn/how-to-read-funding-rates-crypto-reversals)
- [Cube — What Is Basis?](https://www.cube.exchange/what-is/basis) · [CME OpenMarkets — Crypto basis signal](https://www.cmegroup.com/openmarkets/finance/Cryptocurrency/for-crypto-traders--a-signal-to-watch-and-a-new-way-to-trade.html) · [CF Benchmarks — Bitcoin Basis drivers](https://www.cfbenchmarks.com/blog/revisiting-the-bitcoin-basis-how-momentum-sentiment-impact-the-structural-drivers-of-basis-activity) · [CoinDesk — backwardation post-FTX](https://www.coindesk.com/markets/2025/12/03/bitcoin-futures-return-to-deepest-backwardation-since-ftx-collapse)

**Liquidations / heatmap :**
- [CoinGlass — Liquidation Heatmap](https://www.coinglass.com/pro/futures/LiquidationHeatMap) · [CoinGlass — How to use Liq Heatmaps](https://www.coinglass.com/learn/how-to-use-liqmap-to-assist-trading-en)
- [Zipmex — What Is a Liquidation Heatmap](https://zipmex.com/blog/what-is-a-liquidation-heatmap/)

**Coinbase premium :**
- [CoinGlass — Coinbase Premium Index](https://www.coinglass.com/pro/i/coinbase-bitcoin-premium-index) · [Pickaxe — Coinbase Premium expliqué](https://www.pickaxe.io/resources/news/coinbase-premium-explained-btcs-bull-signal) · [ainvest — CBPI comme indicateur avancé](https://www.ainvest.com/news/coinbase-bitcoin-premium-index-leading-indicator-market-sentiment-institutional-demand-bitcoin-2512/)

**Anchored VWAP / Volume Profile (praticien) :**
- [Alphatrends (Brian Shannon) — Anchored VWAP](https://alphatrends.net/anchored-vwap/) · [TrendSpider — Anchored VWAP](https://trendspider.com/learning-center/anchored-vwap-trading-strategies/)
- [TradingView — Volume Profile basics](https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/) · [GoCharting — POC & Value Area](https://gocharting.com/docs/orderflow/volume-profile-charts)

**Volatilité (académique + praticien) :**
- [darwintIQ — Volatility Clustering](https://www.darwintiq.com/articles/volatility-clustering-in-markets) · [Forvest — ATR, Bollinger & Risk Regimes (crypto)](https://forvest.io/blog/atr-bollinger-bands-volatility-strategy/)
- [arXiv 2104.03667 — *Market Regime Detection via Realized Covariances*](https://arxiv.org/pdf/2104.03667)

**API / fiabilité de données (source primaire) :**
- [Binance — Taker Buy/Sell Volume endpoint](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Taker-BuySell-Volume) · [Binance — Long/Short Ratio endpoint](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio)
- Voir aussi `~/AXIOM-revue-critique-2026-06-26.md` §4 (forceOrder throttlé, OI sans WS, funding fiable) et §5 (build-vs-buy, Coinalyze gratuit).
