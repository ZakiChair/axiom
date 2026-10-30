# Fuites des séries synthétiques vers les fournisseurs perp et Twelve Data

Demande du propriétaire du 29/10/2026 au soir : « corrige dans un lot séparé » les deux fuites
préexistantes repérées pendant la revue de STABLE.D. Cartographie : 3 agents en lecture seule sur
c2f757d (34 sites). Ce document est le contrat du lot ; l'orchestrateur seul le modifie.

## 0. Problèmes et périmètre

1. **Perp.** Avec une série sans marché perp au graphe (TOTAL, TOTAL2, TOTAL3, STABLE.D,
   composite SYN, ou toute source Twelve Data : SPY, EUR/USD…), plusieurs sites interrogent
   quand même des fournisseurs perp :
   - le sondage 60 s des alertes Funding : Binance fapi `premiumIndex`, puis Coinalyze
     `funding-rate` (quota partagé 40/min) ;
   - `sync()` des liquidations, partagé par la fenêtre LIQ et la heatmap (état actif persisté) :
     WS Bybit `allLiquidation.<symbole>`, amorce Coinalyze, OKX pour les composites et le forex ;
   - l'indicateur « Liquidations par bougie » : Coinalyze `liquidation-history` ;
   - LIQHL sur Vercel : le scan navigateur Hyperliquid démarre même sans actif perp.
2. **Twelve Data.** Un alias pointé de STABLE.D (« USDT.D », « USDC.D », « DAI.D », la forme
   composite) tapé hors de la liste de recherche part brut vers Twelve Data par la règle
   « . = TradFi » : 1 crédit par backfill, plus des sondes `/quote`. Chemins concernés :
   - Entrée dans PairSearch avant l'arrivée du catalogue commun ;
   - champ « Ajouter » de la watchlist ;
   - champ symbole d'un slot secondaire ;
   - identités restaurées d'avant le correctif.

**Hors périmètre** (fournisseurs gratuits ou sans fuite, signalés au propriétaire) :
- filtre NEWS (GDELT), bascule revenus (DefiLlama) ;
- import Backtest et mode funding « binance-reel » ;
- fenêtres liées par groupe couleur, comparaison base 100, presets d'espace de travail ;
- VOL (Deribit) et DES/OI : aucune requête ;
- unité tapée dans PairSearch (« USDT.D 4H »).

## 1. Prédicat partagé « aucun marché perp »

`sansMarchePerp(exchange, symbol)`, fonction PURE exportée de `store/market.ts` (à côté
d'`exchangeForSymbol`, qui importe déjà `data/pairs` et `data/mcap` : aucun module ajouté à
l'entrée) :

```ts
exchange === "synthetic" || exchange === "twelvedata"
  || estSymboleCapitalisation(symbol) || symbol.includes("|") || isTradfiMarketSymbol(symbol)
```

- **Jamais `basePerp` ni `actifPerpDe` comme garde réseau.** Leurs bornes rejettent de vrais
  perps : SUSDT, WUSDT, TUSDT, BROCCOLI714USDT, 1000000PEIPEIUSDT.
- Matrice de test obligatoire :
  - vrai (aucun marché perp) : TOTAL, TOTAL2, TOTAL3, STABLE.D, un composite SYN, SPY,
    EUR/USD, AAPL, USDT.D, BRK.B ;
  - faux (marché perp) : BTCUSDT sur binance/bybit/okx, HYPEUSDT, HYPE-PERP, kPEPE-PERP,
    1000PEPEUSDT, BTCUSDC, BTCFDUSD (binance), SUSDT, WUSDT, TUSDT, BROCCOLI714USDT,
    1000000PEIPEIUSDT, et les formats réels de kraken, coinbase et mexc relevés dans le code.

## 2. Corrections « perp »

- **Création d'alerte (`AlertsPanel`).**
  - Les options Funding, CVD S/P et Cascade liq sont désactivées (attribut `disabled`, titre
    explicatif) quand le prédicat est vrai pour la cible effective : source du graphe, et
    symbole saisi s'il y en a un.
  - Contrôle défensif à la soumission et dans « Créer l'alerte composée », car le type choisi
    survit à un changement de graphe : refus avec un message clair.
  - Les définitions déjà persistées ne sont ni supprimées ni filtrées à l'hydratation.
- **Évaluation (`alerts/runtime.ts`).** `pollFunding` ignore une définition dont le prédicat
  est vrai (aucune requête). `resyncFunding` n'arme pas le minuteur s'il ne reste aucune
  définition éligible. Les définitions persistées restent inertes.
- **Liquidations (`chart/liquidationMarkers.ts`).** Dans `sync()`, si le prédicat est vrai pour
  `{exchange, symbol}` du graphe, traiter comme inactif pour l'abonnement :
  - désabonnement du WS Bybit et d'OKX, tampon vidé, aucune amorce Coinalyze, arrêt du
    sondage HL ;
  - `fluxLiqRetenu()` rend `false` hors perp : une alerte cascade ne reçoit pas un faux 0 ;
  - `publier()` ne déclare « en attente » que sur un perp ;
  - le déclencheur réagit aussi à un changement de source, sur le modèle de `depthHeat.ts`.

  L'état actif de la heatmap reste persisté tel quel : il redevient effectif au retour sur un
  perp. La fenêtre LIQ affiche « Pas de marché perp pour cette série : liquidations
  indisponibles. » au lieu de « En attente de liquidations… » sans fin.
- **Liquidations par bougie (`lib/indicatorUsability.ts`).** `raisonUnusableIndicateur` rend
  `liqParBougie` inutilisable quand la source est synthetic ou twelvedata. Ne pas l'ajouter à
  AUX_PERP : sa règle USDT casserait HYPE-PERP.
- **LIQHL sur Vercel.** Ne pas DÉMARRER le scan navigateur tant que l'actif perp est nul ; il
  démarre au premier actif perp. On n'arrête pas un scan déjà lancé, dont le pool sert à toutes
  les pièces.

## 3. Corrections « Twelve Data »

- **Résolveur partagé.** `resoudreSerieAutonome(saisie)`, fonction PURE de `data/mcap.ts`,
  rend `{ exchange: "synthetic", symbol }` ou `null`.
  - Entrées reconnues, après trim et sans tenir compte de la casse : le nom exact d'une série
    autonome (TOTAL, TOTAL2, TOTAL3, STABLE.D), un alias POINTÉ de `METADONNEES_SERIES_AUTONOMES`
    (la forme composite), ou l'un de ses termes séparés par « + » (USDT.D, USDC.D, DAI.D).
  - Les alias sans point (STABLES, STABLECOINS, DOMINANCE) rendent `null`, comme aujourd'hui
    dans ⌘K.
  - Il remplace la logique locale de `normaliserSymbole` (`commands/registry.ts`), dont
    l'équivalence est prouvée sur 24 jetons.
- **Points d'application.**
  - PairSearch : le catalogue local initial inclut `SYMBOLES_CAPITALISATION`. Les séries et
    tous leurs alias (STABLES compris) sont donc trouvés avant l'arrivée du catalogue commun.
  - `setSymbol` (`store/market.ts`) : résolveur appliqué avant `normalizeMarketSymbol`. Cela
    couvre l'Entrée sans résultat, le clic watchlist, ↑/↓, ⌘[/⌘] et ⌘K.
  - Watchlist : ajout (`store/watchlist.ts`) et hydratation d'une liste persistée, au point le
    plus étroit couvrant les deux. Un « USDT.D » persisté devient STABLE.D.
  - Slot secondaire : `sanitizeSlotConfig` (`store/chart-layout.ts`), qui couvre la saisie,
    la liaison et l'hydratation.
  - `preparerIdentite` (`data/marketRouting.ts`) : défense en profondeur pour une identité
    restaurée `{twelvedata, USDT.D}`.
  - Ne PAS mettre le résolveur dans `normalizeMarketSymbol` : `setMarket` à source explicite
    produirait `{twelvedata, STABLE.D}`.
- **Préservés.** BRK.B, EUR/USD, SPY, BTCUSDT, HYPE-PERP et le spot restent inchangés : le
  résolveur rend `null`.

## 4. Tests et preuves

- **Unitaires.**
  - Matrice du prédicat.
  - Runtime : aucune requête pour une définition synthetic ou twelvedata (fetch capté),
    requêtes inchangées pour les vrais perps, minuteur non armé.
  - `sync()` : aucun WS, aucun Coinalyze, aucun OKX hors perp ; reprise au retour sur un perp ;
    changement de source seul.
  - Message de la fenêtre LIQ (fonction pure si possible).
  - Options d'alerte désactivées (aide pure).
  - Utilisabilité de `liqParBougie`.
  - Démarrage différé du scan LIQHL.
  - Résolveur (table), puis `setSymbol`, watchlist, `sanitizeSlotConfig`, `preparerIdentite`
    et `searchMarkets` sur le catalogue local.
- **E2E hermétique** `fuites-series-synthetiques.e2e.ts`, inscrit avec son suffixe dans la liste
  `--e2e` de `scripts/ci.sh` :
  - STABLE.D au graphe avec heatmap active persistée, fenêtre LIQ ouverte et alerte Funding
    persistée : aucune requête fapi, Coinalyze ni Bybit (compteurs de routes) ; le message LIQ
    s'affiche ;
  - retour sur BTCUSDT : les requêtes perp reprennent ;
  - « USDT.D » + Entrée immédiatement : STABLE.D s'ouvre sans aucune requête Twelve Data.
- **Portes.** `pnpm check` et `pnpm check:e2e` verts. Budget mesuré sous Node 24.13.0 : point de
  départ 1 186 324 / 355 233 avec la clé factice ; viser au plus +400 o gzip, plafond absolu
  360 000.

## 5. Amendement après la revue (30/10/2026)

Trois tours de revue indépendante. Les arbitrages ci-dessous complètent ou remplacent les §1 à §4.

1. **Garde de `setMarket` (acté).** Une série désignée sur une source twelvedata (`{twelvedata,
   USDT.D}`, la forme composite, DAI.D…) devient `{synthetic, STABLE.D}`. La source et le
   symbole sont résolus ensemble. Cela couvre les workspaces, les messages entre fenêtres et
   « Voir sur le chart ». La garde est limitée à twelvedata : le cas transitoire kraken+TOTAL ne
   change pas. `hydrateChart` résout avant de valider l'unité (1m → 1h pour STABLE.D).
2. **Cible d'alerte saisie (acté, « option b »).** Sur un graphe synthetic, un symbole saisi se
   lit comme sur Binance : les vrais perps restent sondés.
   - Résidu accepté : sur un graphe Twelve Data, les perps cotés USD1 ou U (BTCUSD1, ETHUSD1,
     BTCU, ETHU, SPCXUSD1) restent exclus. Ces cotations manquent à `QUOTE_ASSETS` ; ajouter
     « U » découperait à tort des tickers comme XAU.
   - Sur une source Twelve Data, le titre de l'option désactivée dit que la cible est
     indisponible depuis un graphe Twelve Data et invite à ouvrir la paire crypto. Il ne doit
     pas affirmer qu'il n'existe pas de marché perp.
3. **Liquidations par bougie.** La garde de `raisonUnusableIndicateur` utilise `sansMarchePerp(exchange,
   symbol)` (symbole compris), pas la source seule. Sinon une source périmée (réponse auxiliaire
   en vol après le passage sur une série) laisse partir une requête Coinalyze. Un test de course
   doit le prouver.
4. **LIQHL.** `demarrerHyperliquidLiq` suit aussi la source, comme `liquidationMarkers` : le scan
   démarre quand le premier perp est atteint par un changement de source seul.
5. **LIQEST (ajouté au lot).** Garde `sansMarchePerp` dans `liquidationEstimates` (synchronisation
   et rafraîchissement de l'OI) : EUR/USD donnait la base « EUR » et interrogeait Coinalyze
   toutes les 15 min.
6. **Finitions.**
   - Une seule aide partagée pour « graphe sans perp », évaluée une fois par `sync()`.
   - Matrice du prédicat complétée par le forex hors catalogue curé (USD/SEK, EUR/CHF) et le
     témoin kraken ETH/BTC.
   - Câblage du catalogue local de PairSearch couvert par un test : COIN reste routé vers
     Twelve Data.
   - Commentaires de `hydrateChart` et de son test mis à jour.
7. **Budget.** +638 o gzip au tour 3, pour une cible de +400 (plafond respecté, marge 4 129).
   Écart accepté : le composant `Unusable` de la fenêtre LIQ garde l'idiome visuel du dépôt.
8. **Hors lot (signalé au propriétaire).** Variantes d'alias (combinaisons partielles, espaces
   internes, BTC.D) ; alerte PRIX à source forcée ; appels au daemon local (gratuits).

## 6. Arbitrage du tour 5 (30/10/2026)

Le tour 5 laisse un bloquant et trois mineurs, prouvés par deux réviseurs et le contrôleur des
portes. Les arbitrages ci-dessous complètent le §5.

1. **Course vers un ticker libre Twelve Data (option A, actée).**
   - Constat : la garde du §5.3 ferme la course pour les séries et la TradFi reconnue, pas pour un
     ticker libre (IBM, PLTR, UBER, COIN). Avec la source périmée, `sansMarchePerp("binance",
     "IBM")` est faux par construction, puisque le prédicat ne distingue pas IBM d'un perp coté
     USD1 (BTCUSD1).
   - Cause : dans `chart/indicators.ts` (ajouté au lot), le rappel `onReady` d'`aligner` relance
     `onAuxReady`, qui relit `latestArgs`, donc la source de l'ancien graphe, avec le nouveau
     symbole.
   - Correction : le rappel jette la réponse d'un ancien symbole (`if (this.symbol === symbol)`).
     Elle s'applique avec le test de course étendu : IBM et PLTR, plus KO, curé, comme témoin.
     Les deux changements vont ensemble, jamais l'un sans l'autre. Le commentaire de
     `raisonUnusableIndicateur` et l'en-tête du test sont réécrits pour cette option.
   - Changement de contrat du témoin, accepté. L'ancien témoin « perp → perp, la réponse en vol
     relance la requête du nouveau perp » épinglait un effet du bogue : une requête alignée sur les
     bougies de l'ancien symbole, sur un graphe déjà vidé. Après le backfill,
     `ChartInstance.tsx:1301` resynchronise et demande de toute façon le nouveau perp. Le nouveau
     témoin vérifie donc deux choses : la réponse périmée est jetée, puis le sync du backfill
     demande le nouveau perp.
   - Résidu : la garde compare le symbole seul. Un changement de source seul, sur le même symbole
     et avec une réponse en vol (binance:X vers synthetic:X ou twelvedata:X), relit encore la
     source périmée. C'est la même classe transitoire que kraken+TOTAL (§5.1) et que
     `{twelvedata, BTCUSDT}`, hors lot.
2. **Identité de transition {binance, IBM} (résidu).** Parcours : une alerte PRIX créée avec IBM
   saisi sur un graphe Binance, puis « Voir sur le chart ». Si un indicateur est basculé pendant le
   backfill, le sync direct de liqParBougie demande IBM_PERP.A, avec ou sans l'option A. Ce cas
   relève de « alerte PRIX à source forcée », déjà hors lot (§5.8).
3. **Refus à la soumission sur un graphe Twelve Data.** Le message reprend le texte du titre
   (`titreOptionsPerp`), en type simple comme dans « Créer l'alerte composée ». Le principe du §5.2
   vaut aussi pour le refus : sur un graphe Twelve Data, on n'affirme pas qu'il n'existe pas de
   marché perp. L'e2e (graphe SPY, cible IBM) attend ce texte. Ailleurs, « Pas de marché perp pour
   <symbole> : … » ne change pas. Préférer une aide pure testée sans DOM, appelée aux deux sites.
4. **Doc de `raisonAlertesSansPerp`** (`sansPerp.util.ts`) corrigée : sur un graphe Twelve Data, le
   titre vient de `titreOptionsPerp`.
5. **Appel de `catalogueInterroge` dans PairSearch.** Étape e2e ajoutée : « COIN » + Entrée avant
   l'arrivée du catalogue commun, puis attendre {twelvedata, COIN}. Elle réutilise tel quel le
   harnais de retard du catalogue de l'étape « USDT.D ». Elle échoue sous le mutant `const base =
   catalog;`.
6. **LIQEST, coût accepté.** Un aller-retour par {synthetic, même symbole} relance l'OI au retour
   sur le perp : au plus une requête Coinalyze open-interest-history et son repli fapi
   openInterestHist. C'est la contrepartie de l'attente de 15 min évitée, consignée dans
   `liquidationEstimates.ts`.
7. **Budget.** Le chiffre « +638 » du §5.7 est périmé. À la fin du tour 4, l'entrée mesurée avec
   la clé factice est de 1 188 274 octets bruts / 355 939 gzip : +1 950 / +706 depuis le départ,
   avec une marge de 4 061 sous 360 000. L'écart reste accepté sous le plafond absolu. L'option A
   modifie le chunk d'entrée : le chiffre final vient du build du contrôleur des portes et sera
   consigné dans `BUILD-CONTRACT.md`.
