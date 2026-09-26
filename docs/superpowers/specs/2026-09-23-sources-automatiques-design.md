# Sources automatiques par actif

Demande du propriétaire : revoir le projet et supprimer le choix manuel des sources ;
AXIOM sélectionne les sources disponibles pour chaque actif.

## Comportement

- Une recherche commune présente les instruments des fournisseurs déjà intégrés.
  Les mêmes paires spot sont dédoublonnées ; la devise de cotation est conservée.
- L'utilisateur choisit un instrument, jamais son fournisseur. La source effective
  reste visible, ainsi que les absences de données et conditions d'accès.
- Le comptant, les perpétuels et les actions tokenisées restent des instruments
  distincts. Les perpétuels Hyperliquid utilisent une désignation `BTC-PERP` explicite.
- Le choix automatique examine les catalogues réellement disponibles et les unités
  de temps compatibles. Un historique vide ou en erreur permet un repli vers une
  autre source du même instrument. Une demande n'oscille pas entre sources en échec.
- Un catalogue indisponible ne signifie pas que l'actif est absent : les sources
  concernées restent vérifiables par leurs données réelles. Les caches expirent et
  les résultats de recherche se renouvellent après le retour d'une source.
- L'ajout direct aux favoris vérifie la source du prix ; cliquer sur un favori
  conserve cette provenance (au comptant, la place la plus profonde passe devant
  depuis le 26/09 : amendement ci-dessous). OKX, Bybit et Hyperliquid ont leurs
  propres tickers.
  *Amendement du 24 septembre 2026 (remplacé par celui du 26 septembre, ci-dessous ;
  conservé pour mémoire)* : au comptant, Binance — seule place qui porte
  le split taker — passe devant une provenance enregistrée dès que son catalogue
  confirme le même instrument (même symbole, même devise). La provenance ne départage
  plus que les replis ; elle garde la tête quand le catalogue Binance est indisponible.
  Un favori enregistré ailleurs par héritage automatique (ex. `okx:BTCUSDT`) est
  ré-attribué à Binance après un vrai prix Binance ; un instrument absent de Binance
  (ex. `CARDSUSDT`) garde sa place, et un favori n'est jamais déplacé vers une
  troisième place, sauf si le catalogue chargé de sa place ne liste plus
  l'instrument (retrait, paire suspendue) : il est alors resondé sur les places
  qui le cotent.
- Les sources des deux jambes d'un ratio sont également déterminées automatiquement.
  Les séries calculées conservent leur encodage de provenance existant.
- Les anciens favoris, sessions et graphiques secondaires passent par le même
  contrôle au chargement. Les notes, positions et alertes historiques conservent
  leur provenance ; le replay conserve ses données enregistrées.

### Amendement du 26 septembre 2026 : profondeur d'historique

Demande du propriétaire : « lorsque je recherche un actif pour l'ajouter à ma liste
de surveillance, la source doit être celle qui affiche le plus de données
d'historique ». HYPEUSDT partait sur Binance, qui ne le cote que depuis le
24/09/2026 (3 bougies 1d). Bybit le cote depuis le 11/07/2025, OKX depuis le
04/11/2025. Cet amendement remplace celui du 24 septembre.

- **Règle.** Pour un même instrument au comptant (même symbole, même devise), la
  place qui affiche le plus d'historique à l'unité de temps demandée passe devant,
  y compris devant la provenance enregistrée. Historique accessible =
  max(première bougie servie par l'adaptateur de la place,
  maintenant − min(plafond de la place, 20 000) × unité). Plafonds : OKX 1 440
  (`/market/candles`), Kraken 500 (ce que le graphe en affiche), graphe 20 000.
  L'unité de temps supportée reste un critère prioritaire.
- **Tolérance.** Deux débuts sont équivalents à 5 % de la fenêtre du graphe près,
  bornés à 7 jours, jamais moins d'une bougie (1m : environ 16 h 40).
- **Binance** ne départage qu'à profondeur équivalente (BTCUSDT reste sur
  Binance). Suivent la provenance, puis l'ordre des sources.
- **Bornes et mesures absentes.** Une borne de sonde (début réel plus ancien)
  compte comme « au moins aussi profonde ». Une place non mesurée (sonde en échec,
  encore en vol, place sans sonde) garde le bénéfice du doute jusqu'au plancher de
  sa place : elle ne perd la tête que si son plafond l'empêche d'égaler la place
  la plus profonde prouvée. Aucune sonde pour un perp, un actif TradFi, un
  synthétique ou un actif coté sur une seule place (CARDSUSDT reste sur OKX).
- **Mesure.** `data/profondeurHistorique.ts` sonde chaque place spot par son
  adaptateur existant (Binance, Bybit, MEXC 1w × 1 000 ; Kraken 1w × 720 ; OKX
  1M × 300 ; Coinbase 1d × 350 sur 4 pages au plus), puis ramène une cotation
  récente au jour. Files par place à trois rangs (graphe, favoris, recherche) ;
  deux créneaux, dont un toujours laissé au graphe ; départs espacés (Kraken 1 s,
  Coinbase 200 ms, OKX 70 ms, autres 50 ms) ; créneau rendu à la fin réelle de la
  requête. Cache mémoire et localStorage de 25 à 35 j selon la clé ; « vide »
  gardé 24 h, échec 60 s. La mesure s'arrête dès que la tête ne peut plus
  changer ; sinon le graphe et la recherche attendent au plus 2,5 s, les favoris
  15 s.
- **Graphe à froid.** Le catalogue Binance est toujours lu, les autres catalogues
  spot attendus jusqu'à 2,5 s. Binance décidé part seul ; sinon les places
  confirmées sont mesurées puis classées.
- **Favoris.** Classés comme le graphe, en 1h. Sans source, le premier candidat
  qui renvoie un vrai prix est retenu. Avec une source R : si R est en tête et
  listée, elle est confirmée sans sonde de ticker ; sinon seules les places
  classées au-dessus de R, puis R, sont sondées, jamais une place classée
  dessous ; sans prix, R est conservée. Un favori peut donc migrer vers une place
  plus profonde (`binance:HYPEUSDT` → Bybit) ; `okx:BTCUSDT` revient à Binance.
  Dès qu'il a deux places mesurables, tant que l'une d'elles, la retenue comprise,
  reste sans mesure, rien n'est confirmé, pendant 5 min au plus (réessai à 30 s) ;
  un favori à place unique n'est jamais en doute ; un favori sans source affiche
  entre-temps, à titre provisoire, le prix de la place retenue. Les confirmations
  valent pour la session : pas d'oscillation. Un graphe prêt ne retient la place
  d'un favori sans source que si elle est en tête du classement 1h. Le screener
  ajoute ses favoris sans source imposée.
- **Recherche.** Un résultat affiche « Auto » tant qu'une de ses places n'est pas
  mesurée, puis la place qui sera retenue, à l'unité de temps du graphe. Le
  résultat actif, puis les 12 premiers, sont mesurés après 250 ms sans frappe,
  derrière le graphe et les favoris ; une nouvelle frappe ou la fermeture
  abandonne les sondes pas encore parties.
- **Limites.** Hors Binance, le split taker est perdu (CVD, indicateurs
  acheteur/vendeur, DOM, DES). La place retenue peut changer avec l'unité de temps
  (HYPEUSD, API réelles : OKX en 1d, Coinbase en 1h) et les dessins sont indexés
  par place. Coinbase, sondé sur 4 pages, laisse Binance départager BTCEUR,
  BTCUSDC et ETHBTC en 4h, 6h et 1d. OKX reste limité à 1 440 bougies par son
  adaptateur. Détails : [rapport](../../revue-2026-09-26-profondeur-historique.md).

## Architecture

`data/pairs.ts` décrit les catalogues réels. `data/marketRouting.ts` réunit recherche
et résolution, sans dépendre des stores. Le chargement de `ChartInstance` change
atomiquement l'identité avant de publier les bougies d'une autre source ; ses gardes
de révision interdisent les réponses obsolètes. Le transport live reste direct.

Les sélecteurs de fournisseur disparaissent de la barre principale, des slots et
du constructeur de ratios. Les paramètres mathématiques « Source » (OHLC) et les
clés personnelles des Réglages restent utiles et conservent leur sens.

## Contraintes et limites

Aucun fournisseur, backend, proxy, dépendance ou type partagé nouveau. Français,
TypeScript strict, stores vanilla et budgets du build conservés. La disponibilité
du catalogue n'est pas une garantie de disponibilité du flux ; les échecs réels
restent signalés. Une clé absente ne justifie jamais de substituer un autre actif.
Les séries synthétiques sans ticker dédié restent explicitement sans prix de favoris.

## Vérification

Catalogues partiels, échec réseau, devise exacte, séparation spot/perp, timeframes,
source de repli effective, absence de boucle, courses entre sélections et replay.
Parcours navigateur : recherche inter-fournisseurs, suppression des sélecteurs,
favoris, ratios, slots et restauration. Revue indépendante puis `pnpm check`.

*26 septembre 2026* : classement par historique accessible à chaque unité de
temps (tolérance, plafonds, bornes, bénéfice du doute jusqu'au plancher de la
place), priorités des files et sortie anticipée, chemin à froid (paire Binance
suspendue), favoris (migration, doute borné à 5 min, graphe retenu seulement en
tête du classement, aucune oscillation : `okx:BTCUSDT` revient à Binance,
`CARDSUSDT` reste sur OKX), libellé « Auto » et abandon des mesures de la
recherche. Mutants détectés sur la tolérance, `Watchlist.tsx` et `PairSearch.tsx`.
Parcours navigateur HYPEUSDT (recherche, graphe, favori, migration d'un ancien
favori Binance). Revue finale sous trois angles avec contre-vérification, puis
contrôle au navigateur sur API réelles, branche contre main.
