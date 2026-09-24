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
   et d'une vérification indépendante (six constats sur sept corrigés sur
   `ef81574`). Le septième, les négatifs non abrégés, est corrigé ensuite
   (`4ae03f8`) et revu séparément (approuvé). La documentation a été vérifiée
   affirmation par affirmation.
4. **Preuve au navigateur** (Chrome, API réelles, serveur Vite de dev ; pas le
   bundle de prod), main contre branche.

## Chargement : causes et effets mesurés

| Cause (vérifiée) | Effet mesuré avant | Correction |
|---|---|---|
| Tout backfill crypto attendait les 8 catalogues, sans servir le cache périmé | +0,4 à 1,6 s à chaque expiration ; jusqu'à 12 s si une place était muette | Stale-while-revalidate, résolution progressive, essai spéculatif borné à 4 s |
| Catalogue et ticker Coinbase en direct, sans en-tête CORS | Coinbase toujours « indisponible », cache ramené à 30 s, 13 erreurs CORS en 6 min | `/extapi` (hôte déjà admis) |
| exchangeInfo Binance complet | 17,6 Mo décodés | `symbolStatus=TRADING&showPermissionSets=false` : 2,5 Mo, mêmes 1 372 symboles |
| File Twelve Data 8/60 s sérialisée, sans annulation | AMZN 20 022 ms et META 20 027 ms puis erreur, sans aucune requête partie ; requête orpheline envoyée à +60 s | FIFO à deux priorités, annulable ; délai armé au créneau ; message de quota ; crédits groupés réservés d'un coup |
| Watchlist : TOTAL/TOTAL2/TOTAL3 jamais résolus, boucle de 30 s qui resondait tout | 15,1 requêtes/min en fond (sondes ticker et catalogue Coinbase toutes les 30 s) ; sur la watchlist du propriétaire, chaque sonde OKX téléchargeait la liste SPOT entière (122 Ko gzip) | Synthétiques résolus sans prix, confirmations de session, sonde OKX `instId` |

Preuve au navigateur (Chrome, API réelles, serveur de dev, main → branche) :

- **Démarrage à froid sur BTCUSDT** : 1 084 → 748 ms. Les bougies partent après
  le seul catalogue Binance.
- **Ouverture après expiration du cache** (simulée par `Date.now` + 6 min) :
  ETHUSDT 1M 994 → 257 ms, BTCUSDT 15m 975 → 300 ms, CARDSUSDT 698 → 392 ms.
  En inactivité réelle de 6 min, main ne bloquait pas (ETHUSDT 1M 270 contre
  284 ms) : ses boucles de fond gardaient le catalogue chaud. Le gain porte donc
  sur les ouvertures qui tombent sur un rafraîchissement.
- **OKX muet** (simulé par surcharge de `fetch`, WebSocket non coupées) :
  BTCUSDT 12 507 → 814 ms, ETHUSDT rouvert 12 274 → 260 ms.
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
- au plus bas 24 h, jusqu'à 100 % de tout le volume acheteur agressif déclaré
  « piégé » (épisode du 20 septembre) ;
- sur perp en 1h, L valait en médiane 130 à 220 % de l'OI Binance entier
  (maxima 350 à 870 %).

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
- **Grands nombres négatifs** : abrégés comme les positifs. C'est couvert par des
  tests unitaires, mais pas observé au navigateur (correctif postérieur à la
  session).

À savoir :

- Les valeurs baissent d'un facteur qui croît avec l'unité de temps (médianes à
  horizon 96 : ~30× en 5m, ~45× en 15m, 60-120× en 1h, ~200× en 4h et 1d ; 26 à
  38× observés sur BTCUSDT 15m). Les seuils d'alerte existants sur `trappedLong`
  et `trappedShort` sont à recalibrer au cas par cas, jamais par un facteur
  unique.
- L'histogramme n'est pas plus lisse : il dépend du chemin du prix.
- Sur le comptant, il s'agit d'acheteurs et de vendeurs agressifs nets, pas de
  positions à levier.
- En 1M, l'horizon de 96 barres dépasse l'historique de la plupart des actifs :
  réduire l'horizon dans les réglages de l'indicateur.

## Vérification

- **Typage** : `pnpm -r typecheck` vert.
- **Tests unitaires** : `pnpm -r test` vert. Indicateurs 838, alertes 62, backtest
  114, daemon 695, web 5 301.
- **Parcours navigateur** : `pnpm check:e2e` 139/139 deux fois de suite sur
  `1f9383a`, réseau simulé, sans valeur de verdict manuel G100.
  - Le test FUNDX « expire une source perp âgée » contenait une course
    préexistante : il échouait 2 à 3 fois sur 5 sur main. Il attendait un texte
    déjà affiché avant l'actualisation, puis avançait l'horloge trop tôt.
  - Il attend désormais la cotation actualisée elle-même, avec la même assertion
    métier (15/15 en répétition).
- **Budget d'entrée** : la première fusion a fait échouer la CI (361 075 > 360 000
  octets gzip en zlib 1.3.x), alors que le Node 26 local mesurait 359 667 (zlib
  1.2.12). Le correctif `ebd74eb` sort `store/backtest` du chargement initial.
  Budget final : 1 189 319 octets bruts ; 354 431 octets gzip en zlib 1.3.1
  (référence CI) et 353 099 en zlib 1.2.12, pour des plafonds de 1 220 000 /
  360 000.
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
