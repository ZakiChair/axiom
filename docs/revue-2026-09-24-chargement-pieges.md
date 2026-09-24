# Revue AXIOM — lenteur d'ouverture des actifs et volume piégé

Demande du propriétaire (24 septembre 2026) : « Certains actifs prennent énormément
de temps à charger lorsque je les ouvre, + les longs et shorts piégés semblent
toujours incohérents, corrige, merge et déploie. »

## Méthode

1. **Diagnostic sans correction.** Quatre agents indépendants ont travaillé en
   parallèle : mesure au navigateur sur le daemon et sur Vercel (30 ouvertures),
   traçage statique du chargement, chemin d'affichage du volume piégé, modèle du
   volume piégé sur données réelles. Un cinquième agent a contre-vérifié leurs
   conclusions de façon adversariale.
2. **Trois lots disjoints** dans des worktrees isolés : chargement du graphe,
   watchlist et tickers, volume piégé. Chaque lot a été développé en TDD, revu
   sous deux angles, corrigé puis vérifié.
3. **Intégration, puis revue finale** sous quatre angles : chargement, provenance,
   mathématiques du volume piégé, sécurité et conformité. Suivies de corrections
   et d'une vérification indépendante.
4. **Preuve au navigateur sur données réelles**, main contre branche, sans réseau
   simulé.

## Chargement : causes et effets mesurés

| Cause (vérifiée) | Effet mesuré avant | Correction |
|---|---|---|
| Tout backfill crypto attendait les 8 catalogues, sans servir le cache périmé | +0,4 à 1,6 s à chaque expiration ; jusqu'à 12 s si une place était muette | Stale-while-revalidate, résolution progressive, essai spéculatif borné à 4 s |
| Catalogue et ticker Coinbase en direct, sans en-tête CORS | Coinbase toujours « indisponible », cache ramené à 30 s, 13 erreurs CORS en 6 min | `/extapi` (hôte déjà admis) |
| exchangeInfo Binance complet | 17,6 Mo décodés | `symbolStatus=TRADING&showPermissionSets=false` : 2,5 Mo, mêmes 1 372 symboles |
| File Twelve Data 8/60 s sérialisée, sans annulation | AMZN 20 022 ms et META 20 027 ms puis erreur, sans aucune requête partie ; requête orpheline envoyée à +60 s | FIFO à deux priorités, annulable ; délai armé au créneau ; message de quota ; crédits groupés réservés d'un coup |
| Watchlist : TOTAL/TOTAL2/TOTAL3 jamais résolus, boucle de 30 s qui resondait tout | 15,1 requêtes/min en fond, dont la liste SPOT OKX entière (122 Ko gzip) par sonde | Synthétiques résolus sans prix, confirmations de session, sonde OKX `instId` |

Preuve au navigateur (Chrome, données réelles, main → branche) :

- **Démarrage à froid sur BTCUSDT** : 1 084 → 748 ms. Les bougies partent après
  le seul catalogue Binance.
- **Ouverture après expiration du cache** : ETHUSDT 1M 994 → 257 ms, BTCUSDT 15m
  975 → 300 ms, CARDSUSDT 698 → 392 ms.
- **OKX muet** : BTCUSDT 12 507 → 814 ms, ETHUSDT rouvert 12 274 → 260 ms.
- **Trafic de fond** : 95 → 24 requêtes en 6 min 16 s.
- **TradFi avec clé réelle** : inchangé (AAPL et EUR/USD vers 190 ms).

Limites assumées :

- **Hôte de la provenance entièrement muet** (catalogue ET bougies) : l'essai
  spéculatif coûte 4 s avant le repli. Mesuré : okx:CARDSUSDT 388 → 4 538 ms, vers
  MEXC. C'est le prix de la règle « la provenance restaurée garde la tête quand
  son catalogue manque ». Sans elle, un favori Binance glissait vers une autre
  place dès une panne du catalogue Binance.
- **Binance muet à froid** : 12 s, comme sur main.

## Volume piégé : diagnostic et nouveau modèle

L'ancien calcul (Σ volume taker brut × part au-dessus du close, fenêtre dure de
96 barres) mesurait le profil de volume, pas des positions :

- corrélation 0,996 à 1,000 avec le même calcul fait sur un split 50/50 ou
  permuté ;
- au plus bas 24 h, 98 à 100 % de tout le volume acheteur agressif déclaré
  « piégé » ;
- sur perp en 1h, L valait en médiane 130 à 220 % de l'OI Binance entier.

Le nouveau modèle (« C1 exact ») retient le delta agresseur NET de chaque bougie,
réparti sur `[low, high]`. Une tranche est libérée quand le prix revient à son
niveau après être passée sous l'eau. Son poids vaut `1 − âge/length`. Le calcul
se fait en une passe avant, sans état entre appels et invariant par préfixe. Trois
réimplémentations indépendantes concordent à 1e-9 près, sur séries synthétiques
(T1 à T11) et sur klines Binance réelles.

Au navigateur, sur BTCUSDT 15m au même instant et avec des bougies identiques :

- **main** : Longs 2 502 / Shorts −7 072 BTC. L + |S| reste proche de 10 000 BTC,
  soit environ 54 % du volume taker.
- **branche** : Longs 37,5 / Shorts −313 BTC, avec une dynamique qui suit le
  chemin du prix :
  - au pic de 14:15, 4,7 BTC de longs piégés ;
  - après la chute de 14:45, 108 BTC de longs piégés et des shorts en partie
    libérés ;
  - la remontée de 15:30 libère les longs et piège davantage de shorts.

Autres effets visibles :

- **Historique trop court** (SOLUSDT 1M, 74 bougies pour un horizon de 96) : badge
  « indisponible · Historique insuffisant : 74 bougies, horizon 96 », au lieu d'un
  pane muet.
- **Place sans split taker** (OKX) : badge UNUSABLE avec sa raison, et aucune
  barre dessinée.
- **Provenance** : okx:BTCUSDT s'ouvre sur Binance. Le favori est ré-attribué
  moins de 4 s après le démarrage.
- **Grands nombres négatifs** : abrégés comme les positifs (PEPE).

À savoir :

- Les valeurs sont environ 30 à 40 fois plus basses : les seuils d'alerte
  existants sur `trappedLong` et `trappedShort` sont à recalibrer.
- L'histogramme n'est pas plus lisse : il dépend du chemin du prix.
- Sur le comptant, il s'agit d'acheteurs et de vendeurs agressifs nets, pas de
  positions à levier.
- En 1M, l'horizon de 96 barres dépasse l'historique de la plupart des actifs :
  réduire l'horizon dans les réglages de l'indicateur.

## Vérification

- **Typage** : `pnpm -r typecheck` vert.
- **Tests unitaires** : `pnpm -r test` vert. Indicateurs 838, alertes 62, backtest
  114, daemon 695, web 5 301.
- **Parcours navigateur** : `pnpm check:e2e` 139/139, réseau simulé, sans valeur
  de verdict manuel G100.
- **Budget d'entrée** : 1 212 743 / 359 667 octets (bruts/gzip), pour des
  plafonds de 1 220 000 / 360 000, soit 333 octets de marge gzip.
- **Périmètre** : aucune dépendance, aucun hôte, aucune règle de proxy,
  `@axiom/types` inchangé.

## Hors périmètre, relevé

- **TTL des proxys pour le ticker Coinbase** : 60 s sur Vercel, 120 s sur le
  daemon. Les prix Coinbase de la watchlist ont donc 60 à 120 s. Avant, il n'y en
  avait aucun à cause du CORS.
- **Section « Actifs » du menu Indicateurs** : elle n'affiche pas encore la raison
  d'indisponibilité.
- **Couleurs longs/shorts de WHALES** : non harmonisées avec celles du volume
  piégé.
