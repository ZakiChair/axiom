# Revue AXIOM — sources automatiques

## Périmètre et constats

Revue de l'architecture, du routage marché, des surfaces de sélection, de la
persistance, des consommateurs dérivés/on-chain et des protections proxy existantes.
L'architecture renderer-first, les adaptateurs et les stores par graphique sont
conservés. Aucun nouveau fournisseur ni service n'est nécessaire.

Trois défauts expliquaient la complexité du parcours :

1. `data/pairs.ts` utilisait le catalogue spot Binance par défaut pour Bybit, OKX
   et Hyperliquid, alors que leurs adaptateurs étaient réellement présents.
2. La recherche dépendait de la source déjà choisie ; `setSymbol` pouvait conserver
   une source incompatible avec la nouvelle classe d'actif.
3. Les mutations séparées de la source et du symbole lors des restaurations ne
   garantissaient pas une identité cohérente pendant la transition.

La revue des changements a aussi corrigé la persistance de la source réellement
chargée dans les slots/favoris, les résultats asynchrones périmés du constructeur
de ratios et l'ambiguïté de tickers TradFi comme `GBTC` (suffixe ressemblant à une
devise crypto). GBTC, IBIT, ETHA et ETHE figurent dans le catalogue curé existant.

## Changement réalisé

Une recherche commune réunit les instruments disponibles. Les paires spot sont
dédoublonnées sans fusionner les devises ; les perpétuels Hyperliquid sont explicités
par `-PERP`. La barre principale, les slots et le constructeur de ratios ne demandent
plus de fournisseur. La provenance effective reste lisible.

Un résolveur partagé choisit les candidats compatibles et le chargement initial
essaie les sources sur erreur ou historique vide. Les bougies de la source réussie
sont reprises sous une nouvelle identité atomique, puis les abonnements et contrôleurs
correspondants sont reconstruits. Le replay garde son adaptateur enregistré.

Les consommateurs par actif reconnaissent les perpétuels explicitement nommés ;
les séries propres à une place conservent leurs gardes de compatibilité. Les
collecteurs utilisent toujours leurs clés historiques attendues.

## Défauts révélés par CARDSUSDT

Le retour utilisateur a invalidé la conclusion fonctionnelle de la première passe.
Les tests ci-dessous ne couvraient pas un prix de favori OKX ni la reprise d'un
catalogue en panne. Les défauts ont été reproduits avant correction :

- Le catalogue OKX a répondu en 5,262 secondes lors d'une sonde réelle, dépassant
  la limite de quatre secondes. La recherche conservait ensuite son premier
  catalogue, même après rétablissement. Une réponse vide restait aussi en cache
  indéfiniment dans `fetchPairs`.
- Si les catalogues manquaient, le résolveur essayait uniquement la source
  courante, souvent Binance. Le marché CARDS-USDT existe pourtant sur OKX et
  MEXC ; Binance rejette CARDSUSDT avec le code `-1121`.
- Avec un catalogue sain, le navigateur chargeait bien 300 bougies OKX, mais le
  favori CARDSUSDT affichait « ticker indisponible » sans prix.
- Le flux réel `candle1m` de CARDS-USDT renvoyait l'erreur OKX `60018` sur
  `/ws/v5/public`. La même souscription sur `/ws/v5/business` renvoie une bougie.
  Cette séparation est décrite dans l'[annonce officielle OKX](https://www.okx.com/en-eu/help/changes-to-v5-api-websocket-subscription-parameter-and-url).

La reprise corrige les caches, les réessais et la publication des catalogues ;
les sources confirmées sont prioritaires et les catalogues absents restent
vérifiables. Les tickers OKX, Bybit et Hyperliquid sont raccordés au parcours des
favoris. La provenance est confirmée par un prix réel et conservée au clic.
Le flux de bougies OKX utilise l'adresse business, les transactions l'adresse
public. La validation de cette reprise figure après les preuves historiques.

## Preuves de la première passe

- Sécurité ciblée : 213 tests passés sur les protections CORS, proxy, redirections,
  quotas et clés CryptoQuant/Vercel.
- Contrôle global final : `pnpm check` réussi ; **7 159 tests**, TypeScript et build.
  Détail : web 4 845, indicateurs 1 450, daemon 679, backtest 109, alertes 76.
  Build : **1 195 254 octets initiaux bruts et 353 371 gzip**, sous les plafonds
  1 220 000 / 360 000 (marges 24 746 / 6 629).
- Revues indépendantes croisées : interface et compatibilité examinées par un
  agent différent de leurs auteurs ; routage examiné par un autre agent. Le
  dernier constat GBTC a été reproduit, corrigé puis revalidé indépendamment
  avec 20 tests. Aucun constat bloquant restant sur les périmètres revus.
- **101 parcours navigateur passés** sur le code final : 83 via `pnpm check:e2e`,
  puis 18 dans `sources-automatiques`, `smoke` et `gate-v24-macro-denominateur`.
  Les six nouveaux parcours couvrent recherche inter-fournisseurs, séparation
  spot/perp, repli d'historique, source persistée des slots/favoris, ratios,
  absence de clé, résultat asynchrone périmé et comparaison compatible.
- Inspection visuelle à 1 280 px : recherche et provenance « Auto » lisibles,
  absence de menus fournisseur dans la barre et les slots.
- Catalogues publics sondés réellement : Bybit HTTP 200, 537 instruments spot
  actifs ; OKX HTTP 200, 1 415 instruments spot actifs ; Hyperliquid HTTP 200,
  178 perpétuels non retirés. Comptages observés pendant le chantier, variables
  avec les cotations des fournisseurs.
- Sources API : [Bybit instruments](https://bybit-exchange.github.io/docs/v5/market/instrument),
  [OKX instruments](https://www.okx.com/docs-v5/en/#rest-api-public-data-get-instruments),
  [Hyperliquid perpetuals](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals).

Les premiers parcours ont révélé des fixtures à adapter : nom accessible enrichi
de provenance, ancien raccourci MACRO (MONEY ouvre l'onglet concerné depuis avant
ce chantier), réseau réel encore ouvert dans des tests de données. Ces tests
utilisent désormais des catalogues explicites et des historiques alignés. Les
échecs transitoires de réticule et d'horizon macro n'ont pas été reproduits sur
le code figé ; la suite complète finale passe sans modifier ces assertions.

Le nouveau scénario `sources-automatiques` rejoint la sélection régulière de
`pnpm check:e2e`, désormais 89 tests dans 24 fichiers. La syntaxe Bash et la liste
Playwright ont été vérifiées après cet ajout ; les six nouveaux parcours avaient
déjà été exécutés avec succès dans la validation finale ci-dessus.

## Validation corrective CARDSUSDT

- Régressions reproduites avant modification : recherche figée, cache vide
  permanent, repli limité à Binance, favori OKX sans prix et mauvais canal WS.
- Revue indépendante croisée des données et de l'interface ; les défauts de
  reprise sans événement réseau et de favori anciennement attribué à Binance
  ont été reproduits, corrigés et vérifiés à nouveau.
- `pnpm check` réussi sur le correctif final : **7 201 tests**, typage et build.
  Web 4 887, indicateurs 1 450, daemon 679, backtest 109, alertes 76.
  Build initial : **1 202 009 octets bruts / 355 557 gzip**, sous les plafonds
  1 220 000 / 360 000. Journal : `/tmp/axiom-cards-check-final.log`.
- **17 parcours sources automatiques réussis**, dont 11 régressions CARDSUSDT :
  ajout en minuscules, catalogue lent ou en panne, reprise automatique du
  catalogue et du prix, provenance ancienne erronée, clic vers le graphique.
- `pnpm check:e2e` final réussi : **100 parcours navigateur** en 2,2 minutes,
  incluant ces 17 parcours. Journal : `/tmp/axiom-cards-check-e2e.log`.
- Vérification indépendante en navigateur avec les **API réelles, sans fixture** :
  ajout direct de `Cardsusdt` aux favoris, source `okx`, prix affiché `0.1800`
  lors de la sonde ; clic conservant OKX, 300 bougies chargées, message de bougie
  reçu sur le flux business. Recherche `Cardsusdt` proposant `CARDSUSDT · OKX`.
  Capture : `/tmp/axiom-cards-live-after.png`.
- Tickers applicatifs réels également reçus pour Bybit BTCUSDT et Hyperliquid
  BTC-PERP. Le prix Hyperliquid vient du dernier trade, pas du mark price.

Les prix ci-dessus sont des observations ponctuelles de validation. Le premier
contrôle global a révélé une ancienne assertion supposant OKX sans ticker ; elle
a été remplacée par un vrai cas synthétique sans ticker et complétée par trois
tests de routage des alertes OKX, Bybit et Hyperliquid.

## Validation corrective TradFi — USOIL

Le symbole recherché `USOIL` ne figurait pas dans le catalogue local. Le
[catalogue public Twelve Data](https://api.twelvedata.com/commodities?symbol=WTI%2FUSD)
expose le pétrole spot sous `WTI/USD`. La recherche propose maintenant ce symbole
avec le libellé « Pétrole WTI — spot ». Cet alias sert uniquement à la recherche :
la sélection est explicite, les identités enregistrées restent inchangées, `WTI`
reste l'action W&T Offshore et `USO` l'ETF. Les suggestions TradFi sont disponibles
immédiatement, même pendant le chargement des catalogues crypto.

- `pnpm check` réussi : **7 222 tests**, typage et build. Web 4 908, indicateurs
  1 450, daemon 679, backtest 109, alertes 76.
  Build initial : **1 203 090 octets bruts / 355 948 gzip**, sous les plafonds
  1 220 000 / 360 000. Journal : `/tmp/axiom-usoil-check.log`.
- **20 parcours sources automatiques réussis**, dont trois nouveaux couvrant
  USOIL, le refus d'abonnement et les suggestions TradFi pendant une panne des
  catalogues crypto. La suite navigateur globale n'a pas été relancée pour cette
  reprise ; ses 100 parcours précédents concernent le correctif CARDSUSDT.
- Revue indépendante favorable : 53 tests unitaires et six parcours ciblés
  relancés ; le message d'erreur a été revu séparément avec 48 tests réussis.
- Vérification réelle dans le navigateur utilisateur, sur `127.0.0.1:5253` :
  `USOIL` propose `WTI/USD — Pétrole WTI — spot` ; Entrée ouvre `WTI/USD` en 4 h
  via Twelve Data. L'accès configuré refuse effectivement cet historique avec
  une exigence d'offre Grow ou Venture. Ce motif s'affiche désormais clairement.
  Les anciennes bougies AAPL sont masquées et aucun autre instrument n'est
  substitué.

La recherche et le routage sont corrigés ; la disponibilité des cours du pétrole
reste limitée par les droits de l'accès Twelve Data actuellement configuré.
Aucun fournisseur, abonnement ni dépendance ajouté.

## Limites conservées

- Le repli couvre le chargement initial de l'historique ; une coupure WebSocket
  ultérieure reste gérée par les mécanismes de reconnexion existants.
- Les séries synthétiques sans ticker dédié restent sans cours de favoris.
- La comparaison de courbes utilise les instruments de la source du graphique.
- Les données TradFi nécessitent toujours l'accès personnel Twelve Data existant,
  avec les droits adaptés à chaque instrument ; WTI/USD est refusé par l'offre
  actuellement configurée.
- Les catalogues ont un délai de douze secondes et les succès expirent après
  cinq minutes ; un échec peut être retenté après trente secondes.
  L'historique conserve un délai de vingt secondes par
  source : dans le cas extrême de six sources spot muettes, l'ensemble peut
  prendre environ deux minutes avant de déclarer l'indisponibilité.

Aucun push ni déploiement dans ce chantier. Le verdict manuel G100 reste distinct
des tests automatisés exécutés ici.
