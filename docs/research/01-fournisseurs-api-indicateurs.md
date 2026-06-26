# AXIOM — Fournisseurs d'API & librairies d'indicateurs (recensement)

> **Doc de recherche · 2026-06-26.** Cible : terminal crypto **perso mono-utilisateur** (ses propres clés). Crypto d'abord (spot + perp) ; tradfi/commodités plus tard.
> Contexte verrouillé (`BUILD-CONTRACT.md`) : **ACHETER** les données dérivées via `IDerivedDataProvider` (Coinalyze gratuit visé en M6) ; **indicateurs en TS pur** (`@axiom/indicators` = source unique). Ce rapport confirme/source ces décisions, il ne les rouvre pas.
> Chaque chiffre est cité par une URL de **source primaire** (docs/pricing du fournisseur ou registre npm). Légende couverture dérivés : **OI** open interest · **Funding** · **L-S** long/short ratio · **Liq** liquidations · **CVD** order-flow agrégé · **Basis**.

---

## 1. Tableau — Fournisseurs de données DÉRIVÉES

| Fournisseur | Couverture dérivés | Tier GRATUIT | Limites gratuites (exactes) | Auth | Prix commercial le moins cher | Clause « personal use » | Reco AXIOM-perso |
|---|---|---|---|---|---|---|---|
| **Coinalyze** | OI, funding, predicted funding, **Liq (long+short)**, **L-S ratio**, OHLCV | **OUI — couvre tout le dérivé** | **40 req/min/clé** ; ~1500–2000 datapoints intraday conservés, purgés chaque jour | Clé API gratuite (`api_key` en header ou query) | n/a (gratuit ; pas de tier payant public) | Aucune publiée | ★ **À brancher en M6** |
| **CoinGlass** | OI, funding, Liq (+ **liq heatmap / liq-levels = modèle proprio**), L-S, basis, orderbook L2/L3 | **NON (aucun tier API gratuit)** | — | Clé API | **Hobbyist 29 $/mo** (30 req/min, 80+ endpoints) ; Startup 79 $ (80/min) ; Standard 299 $ ; Pro 699 $ (1200/min) | **Hobbyist = « Personal use » uniquement** ; commercial → Standard 299 $+ | Upgrade payant si on veut la **liq heatmap** (le seul vrai modèle à acheter) |
| **Coinank** | OI, funding (+heatmaps), L-S, Liq (+heatmaps/hist), **CVD/order-flow**, basis~ | Non (essai 7 j) | Plan1 = 30 req/min | Clé API (ou x402 keyless) | **Plan1 30 $/mo** (25 $ annuel) 30 req/min ; tous les plans incluent les dérivés | Aucune | Alternative payante la moins chère à **couverture complète** (CVD inclus) |
| **CoinGecko** | OI, funding, basis (**pas** Liq/L-S/CVD) | **OUI (dérivés inclus)** | **Demo : 10 000 calls/mois, ~30 calls/min** | Clé Demo gratuite | Basic 35 $/mo (300/min) | Demo = « For personal use cases », attribution requise | Secours gratuit pour OI/funding/basis **snapshot** seulement |
| **Velo** | OI, funding, basis (cross-exchange) | Non (essai sur demande) | — | Clé API | **199 $/mo** (News 129 $/mo) | Aucune | Trop cher ; latence ≥ 1 min |
| **Tardis.dev** | tick brut : OI, funding, Liq ; CVD/L-S/basis = **à calculer soi-même** | **Échantillons gratuits 1ᵉʳ jour de chaque mois (sans clé)** | 1er jour du mois libre | Clé API (accès complet payant) | Commande min **300 $** ; Solo Perps **700 $/mo** ; Academic 350 $ | Aucune verbatim | **Achat ponctuel** : golden files / replay historique (pas source live) |
| **CryptoCompare / CCData** | OI, funding (**dérivés = payant seulement**) | Free « Personal » = **spot only, non-commercial** | « Capped lifetime calls » (nombre exact non publié ; ~250 k cité en secondaire, non vérifié) | Clé gratuite | Sales-gated (pas de prix public) | Free = **CC BY-NC-SA 4.0 (NonCommercial)** | Mauvais : dérivés gatés/payants, opaque |
| **Laevitas** | OI, funding, Liq, basis, Greeks (options) | Pas de vrai tier API gratuit (web Free 0 $ = 1 sem. hist.) | Clé API → Enterprise | Clé API (Enterprise) ou x402 | **API = 500 $/mo Enterprise** ; web Premium 50 $/mo (**dashboard, pas API**) | Aucune | API trop chère ; option micropaiement x402 |
| **Amberdata** | OI, funding, L-S, Liq, basis (institutionnel) | Non self-serve (clé d'essai sales-gated) | — | Clé API (via sales) | Custom/entreprise (non publié) | Aucune (B2B) | Entreprise-only, surdimensionné |
| **Kaiko** | OI, funding, basis (~L-S/Liq) ; pas de CVD | Pas de tier data gratuit (compte « research » web seul) | — | Clé API (contrat) | Custom/entreprise (non publié) | Aucune (B2B) | Entreprise-only, non viable |

**Sources (dérivés) :**
- Coinalyze : limite 40 req/min, auth `api_key`, endpoints (open-interest-history, funding-rate-history, predicted-funding-rate-history, liquidation-history, long-short-ratio-history, ohlcv-history), rétention 1500–2000 pts intraday — [api.coinalyze.net/v1/doc](https://api.coinalyze.net/v1/doc/) ; page produit [coinalyze.net/futures-data](https://coinalyze.net/futures-data/).
- CoinGlass : pas de tier gratuit, Hobbyist 29 $ « Personal use » (30 req/min, 80+ endpoints), Standard/Pro = « Commercial use » — [coinglass.com/pricing](https://www.coinglass.com/pricing), docs [docs.coinglass.com](https://docs.coinglass.com/).
- Coinank : Plan1 30 $/mo (25 $ annuel, 30 req/min), tous plans incluent dérivés, CVD/order-flow, essai 7 j — [coinank.com/openApi](https://coinank.com/openApi).
- CoinGecko : Demo 10 000 calls/mois ~30 calls/min, dérivés (`/derivatives/tickers` → open_interest, funding_rate, basis) inclus, « For personal use cases » ; Basic 35 $/mo — [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing), [docs.coingecko.com/reference/derivatives-tickers](https://docs.coingecko.com/reference/derivatives-tickers).
- Velo : 199 $/mo, OI/funding cross-exchange — [docs.velo.xyz](https://docs.velo.xyz/), [velodata.app](https://velodata.app/).
- Tardis.dev : échantillons gratuits 1ᵉʳ du mois sans clé, min 300 $, Solo Perps 700 $/mo — [docs.tardis.dev/downloadable-csv-files](https://docs.tardis.dev/downloadable-csv-files), [docs.tardis.dev/faq/billing-and-subscriptions](https://docs.tardis.dev/faq/billing-and-subscriptions).
- CCData/CoinDesk Data : Free « Personal » spot-only CC BY-NC-SA 4.0, dérivés payants — [developers.coindesk.com/pricing](https://developers.coindesk.com/pricing).
- Laevitas : API = Enterprise 500 $/mo, Premium 50 $ = dashboard seul — [docs.laevitas.ch](https://docs.laevitas.ch/), [laevitas.ch](https://www.laevitas.ch/).
- Amberdata : derivatives suite, accès sales-gated — [amberdata.io/ad-derivatives](https://www.amberdata.io/ad-derivatives), [amberdata.io/pricing](https://www.amberdata.io/pricing).
- Kaiko : prix custom/entreprise — [kaiko.com/about-kaiko/pricing-and-contracts](https://www.kaiko.com/about-kaiko/pricing-and-contracts), [docs.kaiko.com](https://docs.kaiko.com/).

> ⚠️ **Limites communes à TOUS les dérivés (confirme la revue §4) :** latence plafonnée à ~1 min (CoinGlass « Updates ≤ 1 min », Velo « ≥ 1 minute resolution »). On achète donc le **dérivé lent** (OI/funding/L-S/liquidations cumulées) ; le sub-seconde (DOM/footprint/CVD/L2) reste **build WS** mono-Binance (M5). Note Coinalyze : sur le gratuit l'historique intraday est court (1500–2000 pts purgés chaque jour) → suffisant pour du live, insuffisant pour de longues séries historiques.

---

## 2. Tableau — API de marché BRUT (exchanges)

Toutes les données de marché (klines/OHLCV, trades/aggTrades, orderbook L2) sont **publiques (aucune clé API requise)** sur Binance, Bybit et OKX. Les limites Binance sont en **poids de requête (weight)**, pas en req/min plat.

| Exchange | Public ? | Limite REST market-data (IP) | Poids/coût klines & depth | WebSocket (msg / streams / conns) | Particularités |
|---|---|---|---|---|---|
| **Binance Spot** (`api.binance.com`) | Oui (`NONE`) | **6000 weight/min/IP** (valeur live de `exchangeInfo`, pas hardcodée dans la doc) | klines **w=2** · aggTrades **w=4** · depth **w=5/25/50/250** (selon limit 100/500/1000/5000) | **5 msg/s** · **1024 streams/conn** · **300 conns/5 min/IP** · conn valide 24 h | — |
| **Binance USDⓈ-M Futures** (`fapi.binance.com`) | Oui | **2400 weight/min/IP** + **bucket dédié `/futures/data/` = 1000 req/5 min** | klines **w=1→10** (selon limit) · depth **w=2→20** | **10 msg/s** · **1024 streams/conn** · conns max non documenté · conn 24 h | `/futures/data/openInterestHist`, `globalLongShortAccountRatio`, `topLongShortAccountRatio/PositionRatio` partagent le bucket 1000/5min ; **`forceOrder` (liquidations) throttlé** |
| **Bybit V5** (`api.bybit.com`) | Oui (topics publics sans auth) | **600 req / fenêtre 5 s** (partagé tous produits, par IP) | klines = 1 requête | **500 conns/5 min** (par domaine WS) · spot ≤ 10 args/sub · keepalive ping 20 s | Endpoints publics absents de la table per-UID → régis par le 600/5s IP seul |
| **OKX V5** (`okx.com`) | Oui (« Market Data do not require authentication ») | par endpoint, **rule IP** : candles **40/2s** · books **40/2s** · trades **100/2s** · history-candles 20/2s · books-full 10/2s | candles 40/2s | connect **3/s (IP)** · **480 sub-ops/h/conn** · pas de cap dur de conns concurrentes (public) | — |

**Verbatim liquidations Binance (sous-comptage structurel, cf. revue §4) :**
> « The Liquidation Order Snapshot Streams push force liquidation order information for specific symbol. **For each symbol, only the largest one liquidation order within 1000ms will be pushed as the snapshot.** »
→ Garder `forceOrder` pour l'**animation de bulles** ; pour tout **total/heatmap cumulé**, acheter un flux agrégé (Coinalyze/CoinGlass).

**Sources (exchanges) :**
- Binance Spot : sécurité `NONE`, poids klines/aggTrades/depth, WS 5 msg/s · 1024 streams · 300 conns/5min — [rest-api.md](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md), [web-socket-streams.md](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md) ; 6000 weight/min via [api.binance.com/api/v3/exchangeInfo](https://api.binance.com/api/v3/exchangeInfo).
- Binance Futures : 2400 weight/min ([fapi exchangeInfo](https://fapi.binance.com/fapi/v1/exchangeInfo)), poids klines [Kline-Candlestick-Data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data) & depth [Order-Book](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Order-Book), bucket 1000/5min [Open-Interest-Statistics](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), throttle liquidations [Liquidation-Order-Streams](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Liquidation-Order-Streams), WS 10 msg/s [Connect](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Connect).
- Bybit V5 : 600 req/5s IP, WS 500 conns/5min — [bybit-exchange.github.io/docs/v5/rate-limit](https://bybit-exchange.github.io/docs/v5/rate-limit), [.../v5/ws/connect](https://bybit-exchange.github.io/docs/v5/ws/connect).
- OKX V5 : auth-free market data, candles/books 40/2s, trades 100/2s, WS connect 3/s & 480 sub-ops/h — [okx.com/docs-v5/en](https://www.okx.com/docs-v5/en/).

---

## 3. Tableau — Librairies d'indicateurs open-source (référence)

Dates de publication, licences et téléchargements depuis le **registre npm** (`registry.npmjs.org` / `api.npmjs.org`). DL hebdo = semaine 2026-06-18 → 2026-06-24.

| Librairie | Couverture | Pur TS/JS ou natif | Dernière publication | DL/sem. | Licence | npm |
|---|---|---|---|---|---|---|
| **technicalindicators** | ~26–30 indicateurs + ~35 patterns chandeliers | **Pur JS** (livre `.d.ts`) | **2020-03-16** (v3.1.0) — **stale** | **40 750** | MIT | [npm](https://www.npmjs.com/package/technicalindicators) |
| **@debut/indicators** | ~50–70 (API incrémentale `nextValue()`) | **Pur TS** | **2026-05-16** (v2.0.1) | 561 | **GPL-3.0** | [npm](https://www.npmjs.com/package/@debut/indicators) |
| **tulind** | 100+ (Tulip Indicators C) | **Addon NATIF** (node-pre-gyp/C, **pas de types TS**) | **2021-08-08** (v0.8.20) | 796 | LGPL-3.0 | [npm](https://www.npmjs.com/package/tulind) |
| **trading-signals** | ~30–40 (streaming-first) | **Pur TS** | **2026-01-21** (v7.4.3) | **11 432** | MIT | [npm](https://www.npmjs.com/package/trading-signals) |
| **indicatorts** | ~50–70 + stratégies/backtesting | **Pur TS** | **2025-02-26** (v2.2.2) | 2 603 | MIT | [npm](https://www.npmjs.com/package/indicatorts) |
| **@ixjb94/indicators** | 100+ (array, perf-focus) | **Pur TS** | **2026-06-26** (v1.2.6) | 426 | MIT | [npm](https://www.npmjs.com/package/@ixjb94/indicators) |

**Lecture :**
- **`technicalindicators` est stale** (aucune publication npm depuis **mars 2020**) — les ~40 k DL/sem sont de l'inertie ; large et lisible mais non maintenu.
- **`tulind` = outlier natif** (compilation node-gyp/C, binaires préfabriqués Windows seulement, pas de types) → **mauvais modèle structurel** pour un projet TS pur (c'est exactement le mur ta-lib/pandas-ta de `~/TradingDashboard`). Référence d'algorithme/couverture seulement.
- **Meilleurs miroirs TS purs :** **`trading-signals`** (streaming-first, le mieux typé, le plus téléchargé du set moderne, MIT, maintenu) pour la **forme d'API** ; **`@ixjb94/indicators`** / **`indicatorts`** pour la **largeur** (100+ / stratégies). **`@debut/indicators`** a une belle API incrémentale mais est **GPL-3.0** → lire pour les idées, **ne pas copier le code**.

**KLineChart — indicateurs NATIFS (25 exactement, v9.8.x)**
Confirmés via [klinecharts.com/en-US/guide/indicator](https://klinecharts.com/en-US/guide/indicator) (context7 `/websites/klinecharts_en-us_guide`) :
`MA · EMA · SMA · BBI · VOL · MACD · BOLL · KDJ · RSI · BIAS · BRAR · CCI · DMI · CR · PSY · DMA · TRIX · OBV · MTM · EMV · SAR · ROC · PVT · AVP · AO`
Superposables sur les chandelles (overlay candle pane) : **BBI, BOLL, EMA, MA, SAR, SMA**.
→ Confirme la revue §4 (« KLineChart ≈ base candlestick + ~25 indicateurs, PAS 100+ »). À noter : **VWAP n'est PAS dans les natifs KLineChart** → cohérent avec `@axiom/indicators` comme source unique (on enregistre nos indicateurs via `registerIndicator`, pas ceux de KLineChart).

---

## 4. RECOMMANDATIONS

### (a) Fournisseur dérivé à brancher en **M6** (usage perso) → **Coinalyze (tier GRATUIT)** ✅

Le contrat visait déjà Coinalyze gratuit ; **confirmé sur source primaire** et c'est le bon choix :
- **Gratuit, clé API en 2 min**, auth simple (`api_key` en header ou query).
- **Couvre tout le besoin contrat** : open-interest-history, funding-rate-history, predicted-funding-rate-history, **liquidation-history**, **long-short-ratio-history**, ohlcv-history. ([api.coinalyze.net/v1/doc](https://api.coinalyze.net/v1/doc/))
- **40 req/min/clé** — largement suffisant pour un screener perso à cadence raisonnable (et bien au-dessus des 30 req/min du CoinGlass Hobbyist payant).
- **Aucune clause restrictive** publiée.

**Limites à assumer (et mitiger derrière `IDerivedDataProvider`) :**
1. **Historique court** sur le gratuit (~1500–2000 pts intraday, purge quotidienne) → OK pour le live ; pour de longues séries, paginer/persister localement ou monter en gamme.
2. **Latence ~1 min** (comme tous les dérivés) → le sub-seconde reste build WS Binance (M5).
3. **Pas de liq-heatmap / liq-levels** (modèle proprio) → si un jour on le veut, c'est le **seul** item qui justifie un achat.

**Plan d'upgrade (garder l'interface `IDerivedDataProvider` pour swap trivial) :**
- **CoinGlass Hobbyist 29 $/mo** (« Personal use », parfait pour la branche perso) si on veut la **liquidation heatmap** + plus d'historique. Passer à Standard 299 $ seulement si SaaS un jour (clause commerciale).
- **Coinank 25–30 $/mo** si on veut des **agrégats CVD/order-flow** clés-en-main + heatmaps, à couverture complète et bas prix.
- **CoinGecko Demo (gratuit)** comme **source secondaire** OI/funding/basis (snapshot), utile pour recouper.
- **Tardis.dev** (échantillons gratuits 1ᵉʳ du mois) pour des **golden files** de test/replay — pas une source live.

### (b) Catalogue d'indicateurs **M2+** → **builder en TS pur** (décision verrouillée), référence = `trading-signals`

- **Miroir d'API** : **`trading-signals`** (streaming-first `nextValue()` incrémental, le mieux typé, MIT, maintenu 2026) — colle au besoin contrat M2 (`engine.ts` à calcul incrémental, helpers SMA/EMA/RMA). C'est le modèle de forme à suivre.
- **Référence de largeur** (quels indicateurs, quelles familles) : **`@ixjb94/indicators`** ou **`indicatorts`** (100+ / stratégies, MIT).
- **À éviter en copie de code** : `@debut/indicators` (**GPL-3.0**). **À ne pas adopter** : `tulind` (natif, anti-contrat « TS pur, pas de WASM/native ») ; `technicalindicators` (stale 2020) — lisible comme référence d'algo, pas comme dépendance maintenue.
- **Oracle de test** : conformément au contrat, valider les 7 indicateurs M2 (SMA, EMA, RSI/Wilder, MACD, Bollinger, Volume, VWAP) contre **`pandas-ta-classic`** (dépendance de test uniquement, jamais runtime). Recoupement secondaire possible avec `trading-signals`/`technicalindicators`.
- **Note KLineChart** : ses 25 natifs recouvrent 6/7 de M2 (MA/EMA/MACD/RSI/BOLL/VOL) **mais pas VWAP** → on enregistre nos propres `IndicatorDef` via l'engine `@axiom/indicators`, source unique, et non les indicateurs de la lib de chart.

---

## 5. Note tradfi / commodités (pour plus tard — crypto-first)

Le modèle « front parle directement aux WS publics des exchanges » **ne transpose pas** au tradfi : pas de flux temps-réel public gratuit équivalent pour actions/futures (données souvent licenciées, ex. CME = payant/licence). Pistes gratuites/accessibles à évaluer le moment venu (toutes citées comme repères, non re-vérifiées ici) :
- **Finnhub** — actions US quasi temps-réel, free ~60 req/min.
- **Twelve Data** — actions/forex/ETF, free ~8 req/min, 800/jour.
- **Alpha Vantage** — free ~25 req/jour (5/min) — c'est l'un des vendeurs de l'ancien `~/TradingDashboard`.
- **Polygon.io** — free 5 req/min (end-of-day), tiers payants pour le tick.
- **Databento / CME** — tick/futures de qualité mais **payant/licencié** (commodités, indices).

À traiter en jalon ultérieur dédié ; rien à brancher tant que la branche crypto perso (M1→M6) n'est pas livrée.

---

*Sources web citées inline. Faits dérivés/exchanges/npm vérifiés sur source primaire (docs/pricing fournisseur, `exchangeInfo` live Binance, registre npm). Seul chiffre non obtenu en primaire : le plafond exact du free CCData (« capped lifetime calls » non chiffré sur leur page).*
