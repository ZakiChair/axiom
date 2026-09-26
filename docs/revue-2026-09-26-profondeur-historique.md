# Revue AXIOM — source la plus profonde en historique

Demande du propriétaire (26 septembre 2026) : « lorsque je recherche un actif pour
l'ajouter à ma liste de surveillance, la source doit être celle qui affiche le plus
de données d'historique » (HYPEUSDT routé sur Binance, qui n'a pas une semaine
d'historique).

Branche `feat/sources-profondeur-historique` sur main `f786c0a` : `410d90d`,
`28bc365`, `8a4986e`, `4c7f304`, `b0062f2`, `fc6271d`, puis le lot G (après
`fc6271d`). Aucune fusion ni déploiement.

## Méthode

1. **Cartographie** du routage des sources par cinq agents : profondeur d'historique
   par adaptateur, graphe, favoris, tests, documentation.
2. **Lots à fichiers disjoints** (A routage, B favoris, C recherche, E parcours
   navigateur, D documentation), en TDD, chacun vérifié par un agent indépendant
   puis corrigé avant son commit.
3. **Revue finale** sous trois angles (routage et latence, favoris et
   persistance, budget et sécurité) et vérification au navigateur sur API
   réelles. Chaque constat bloquant ou important a été confié à un autre agent
   chargé de le réfuter (dix contre-vérifications).
4. **Lot F** : corrections de la revue finale en deux sous-lots parallèles (F1
   noyau, F2 favoris et recherche), vérifiés et corrigés jusqu'à conformité, puis
   contrôle conjoint avec remesure au navigateur.
5. **Lot G** : mineurs relevés par le contrôle conjoint, puis vérification
   indépendante.

## Cause mesurée

Premières bougies relevées sur les API réelles le 26/09 (curl, node et
navigateur) :

| Place | HYPEUSDT | BTCUSDT |
|---|---|---|
| Binance | 1w : 1 bougie ; 1d : 3 bougies, première le 2026-09-24 | 2017-08-14 |
| Bybit | W : 64 bougies (2025-07-07) ; D : 443 bougies, première le 2025-07-11 | 2021-07-05 |
| OKX | 1Wutc : 47 bougies (2025-11-03) ; 1d : 327 bougies depuis le 2025-11-04 | 2020-12-28 en 1Wutc × 300 (borne) ; 2018-01-01 en 1Mutc |
| Kraken | non coté | 2019-12-19 |
| Coinbase | non coté | 2022-11-27 (borne de la sonde de 4 pages) |

L'amendement du 24/09 faisait passer Binance confirmé devant toute autre place
(seule place qui porte le split taker). HYPEUSDT, coté chez Binance depuis deux
jours, y partait donc avec 3 bougies 1d.

## Conception finale

Règle détaillée dans `BUILD-CONTRACT.md` (section « Profondeur d'historique ») et
dans l'amendement du 26/09 de la
[conception](superpowers/specs/2026-09-23-sources-automatiques-design.md).

- **Classement** (`data/marketRouting.ts`) : unité supportée, puis palier de
  profondeur, puis Binance confirmé, provenance et ordre des sources. Historique
  accessible = max(première bougie, maintenant − min(plafond de la place,
  20 000) × unité) ; plafonds OKX 1 440, Kraken 500, graphe 20 000. Tolérance :
  5 % de la fenêtre du graphe, bornée à 7 jours, au moins une bougie. Une borne
  compte comme « au moins aussi profonde » ; une place non mesurée garde le
  bénéfice du doute jusqu'au plancher de sa place.
- **Mesure** (`data/profondeurHistorique.ts`, nouveau) : Binance, Bybit et MEXC
  en 1w × 1 000, Kraken 1w × 720, OKX 1M × 300, Coinbase 1d × 350 sur 4 pages au
  plus ; affinage au jour. Files par place à trois rangs (graphe, favoris,
  recherche), deux créneaux dont un toujours laissé au graphe, départs espacés,
  créneau rendu à la fin réelle de la requête, sortie anticipée dès que la tête
  est décidée. Cache `axiom:profondeurHistorique:v1` de 25 à 35 j ; « vide » 24 h,
  échec 60 s.
- **Graphe à froid** : catalogue Binance toujours lu, autres catalogues spot
  jusqu'à 2,5 s ; Binance décidé part seul, sinon mesure puis classement.
- **Favoris** (`components/Watchlist.tsx`) : classés en 1h ; migration possible
  vers une place plus profonde, jamais sous la source enregistrée ; doute de
  5 min au plus tant qu'une place reste sans mesure ; graphe prêt retenu
  seulement en tête du classement.
- **Recherche** (`components/PairSearch.tsx`) : « Auto » tant qu'une place du
  résultat n'est pas mesurée, puis la place retenue ; mesure du résultat actif
  puis des 12 premiers au dernier rang, abandonnée à la frappe suivante et à la
  fermeture.

## Lots

| Lot | Commit | Fichiers | Vérification indépendante |
|---|---|---|---|
| A, routage | `410d90d` | `profondeurHistorique.ts` (nouveau), `marketRouting.ts`, `ChartInstance.tsx`, tests | Un tour de correction : le chemin à froid ne concluait pas comme la résolution à chaud quand Binance manquait au cache (corrigé, puis remplacé au lot F1). |
| B, favoris | `28bc365` | `Watchlist.tsx`, `ticker.ts`, `store/screener.ts`, tests | Un tour : bascule d'un favori quand la mesure est lente (attente de 15 s et garde : 0 bascule sur 40, 60 et 30 favoris, contre 6, 44 et 28 sans la garde) ; graphe restauré qui bloquait la migration ; 9 mutants détectés. |
| C, recherche | `8a4986e` | `PairSearch.tsx`, test | Conforme au premier passage. Les lignes 9 à 12, visibles sans défiler, restaient « Auto » : la mesure couvre les 12 premiers résultats. |
| E, parcours navigateur | `4c7f304` | `e2e/sources-automatiques.e2e.ts` | 22/22 deux fois. Son vérificateur a trouvé la tolérance de 7 jours (ci-dessous). |
| D, documentation | — | contrat, conception, plan, README, ce rapport | — |
| F1, noyau | `b0062f2` | `profondeurHistorique.ts`, `marketRouting.ts`, tests | Deux tours de correction (ci-dessous). |
| F2, favoris et recherche | `fc6271d` | `Watchlist.tsx`, `PairSearch.tsx`, `ticker.ts`, tests | Conforme ; sept mineurs, dont quatre repris au lot G. |
| G, mineurs | après `fc6271d` | `Watchlist.tsx`, `profondeurHistorique.ts`, message Kraken de `ChartInstance.tsx`, tests, `e2e/corrections-revue.e2e.ts` | Conforme : scénarios rejoués avant et après G (12/12), 2 mutants détectés, web 5 546 tests, e2e 30/30, limite Kraken 1/1 ; trois mineurs (contrat périmé, hors lot ; lisibilité du repli l.368 ; plancher Hyperliquid sans effet). L'implémenteur avait détecté 7 mutants sur 7 dans `Watchlist.tsx`. |

### Corrections avant la revue finale

- **Tolérance 7 j → 5 %, trouvée par l'e2e.** Le vérificateur du lot E a montré
  qu'en 1m (fenêtre d'environ 13,9 j), une tolérance fixe de 7 jours, ajoutée au
  grain hebdomadaire de la sonde (lundi 21/09 au lieu du 24/09), remettait
  Binance au palier 0 dès le 2026-09-27 21:20 UTC : HYPEUSDT repartait sur
  Binance en 1m, l'unité par défaut. Corrigé dans le lot A avant son commit :
  tolérance de 5 % de la fenêtre, bornée à 7 jours, et affinage au jour d'une
  cotation récente. Le mutant « 7 jours » est détecté ; le parcours e2e fige son
  horloge et un mutant à +7 jours échoue.
- **Oscillation d'un favori quand la mesure est lente** (lot B) : mesures
  attendues 15 s, puis aucune décision tant que la source et une place au-dessus
  restent inconnues.
- **Graphe restauré** (lot B) : l'identité du graphe est persistée ; un graphe
  restauré sur `binance:HYPEUSDT` bloquait la migration du favori.
- **Libellé de recherche** (lot C) : le résultat affichait « Binance » avant
  toute mesure ; il affiche « Auto », puis la place retenue.

## Revue finale (HEAD `4c7f304`) et suites données

| Gravité | Constat | Contre-vérification | Correction | Résidu |
|---|---|---|---|---|
| **Bloquant** | Les sondes de la recherche occupaient la file FIFO de chaque place, sans priorité ni annulation. Sur « HYPE », HYPEUSDT était 5e dans la file Binance (9e après « H » puis « HY »). Avec Binance à 0,5-1,4 s par requête, un clic 1 à 2,5 s après l'anti-rebond chargeait le graphe sur Binance, et un favori sans source y était confirmé pour la session. | Confirmée sur réseau réel ; régression sur le cas signalé. | F1 : files à trois rangs, promotion, abandon, deux créneaux par place dont un laissé au graphe. F2 : recherche au dernier rang, abandonnée à la frappe, à la fermeture et au démontage. | Dépassements simulés : Kraken 1 cas sur 48 ; Coinbase à 1 340 ms par page. Marge Binance sur HYPEUSDT : environ 1,15 s par requête. |
| Important | Le chemin à froid ne classait que les places dont la profondeur était en cache. Session 2 après un échec Bybit : OKX (60 j en 1h) au lieu de Bybit (442 j). | Confirmée ; régression pour un actif non coté chez Binance. | F1 : raccourci supprimé. | — |
| Important | Une paire Binance suspendue (BREAK) mesurée dans les 30 j était servie figée à froid. STORJUSDT et ICXUSDT, suspendues depuis le 2026-09-03 : la branche chargeait Binance (dernière bougie le 2026-09-03), main OKX (2026-09-25). | Confirmée ; régression. | F1 : catalogue Binance toujours lu ; test STORJUSDT → OKX. | — |
| Important | `exact` n'était jamais lu : les bornes de sonde valaient de vrais débuts. Coinbase BTC-EUR commence le 2015-04-23, la sonde s'arrêtait au 2022-11-27 ; 21 paires sur 211 cotées chez Binance et Coinbase restaient sur Binance en 4h, 6h ou 1d. | Confirmée ; pas de régression. | F1 : bornes « au moins aussi profondes » ; OKX sondé en 1M. | Coinbase garde 4 pages : BTCEUR, BTCUSDC et ETHBTC partent sur Binance en 4h, 6h et 1d. |
| Important | Plafond Kraken de 720, alors que le graphe n'obtient que 500 bougies. PEPEUSD et WIFUSD en 1d partaient sur Kraken, en réalité la moins profonde des trois places. | Confirmée ; pas de régression (main : Kraken par l'ordre des sources). | F1 : plafond 500. G : message « ~500 bougies ». | — |
| Important | La borne de 2,5 s était attendue même quand la tête était décidée (Binance BTCUSDT au plafond dès 0,4 s en 1h) : environ 1,6 à 1,8 s perdues à chaque chargement à froid. | Confirmée. | F1 : sortie anticipée (`teteDecidee`). | — |
| Important | File partagée entre favoris, graphe et recherche : créneau rendu à 15 s alors que la requête restait en vol, TTL de 30 j aligné, « vide » et échec remesurés à chaque session. Avec les 12 favoris réels du propriétaire, un graphe HYPEUSDT demandé pendant la rafale de démarrage partait sur Binance. | Confirmée. | F1 : priorités, créneau rendu à la fin réelle, TTL de 25 à 35 j, « vide » 24 h. | Requête pendue (ci-dessous). |
| Important | Le contrat et la conception décrivaient encore l'ancien routage. | Confirmée. | Lot D. | — |
| Réfuté | Migration `binance:HYPEUSDT` non garantie en 1re session si la sonde Bybit échoue : la preuve ne cotait pas OKX ; avec le vrai catalogue, OKX puis Bybit à la session suivante. | Réfutée. | F2 puis G : doute de 5 min au plus tant qu'une de ses places, la retenue comprise, reste sans mesure (dès qu'il en a deux). | — |
| Mineur (rétrogradé) | Favori sans source ajouté pendant qu'un graphe prêt est sur Binance (unités propres à Binance : 1s, 3m, 3d, 3M, 6M, 12M) : confirmé sur Binance sans classement. | Rétrogradée. | F2 : place du graphe retenue seulement en tête du classement 1h. G : même règle quand aucun ticker ne répond. | — |

### Mineurs de la revue finale

Corrigés :

- la limite du palier 0 n'est plus prise que sur les places qui peuvent être en
  tête (F1) ;
- une place muette garde son créneau jusqu'à la fin réelle de sa requête et ses
  demandeurs reçoivent « inconnu » à 15 s (F1) ;
- les sondes de recherche encore en file sont abandonnées, et les départs sont
  espacés par place (F1, F2) ;
- l'exemple « HYPEUSD : Kraken en 1d » des commentaires est corrigé (OKX en 1d) ;
- `PLAFONDS.hyperliquid`, code mort, est supprimé (G) ;
- l'en-tête du module décrit l'export réel : la clé
  `axiom:profondeurHistorique:v1` est incluse dans l'export JSON comme les autres
  caches (`eco`, `cot`) et n'est pas recopiée par le daemon (G).

Ouverts :

- `buildSynthetic` classe chaque jambe à l'unité de construction puis la fige :
  construite en 1d, une jambe peut tomber sur Kraken et le synthétique perd des
  unités (8 au lieu de 18) ;
- chaque confirmation de favori fait un `setSource` séparé, qui réabonne toute la
  liste (15 migrations : environ 750 requêtes de bougies 1h en 6 s, d'après le
  code) ;
- les autres consommateurs de `resolveTickerMarket` (portefeuille, bandeau de
  séance, positions paper héritées, cohortes BTC) mesurent aussi la profondeur :
  jusqu'à 2,5 s avant le premier prix, et HYPEUSDT valorisé sur Bybit ;
- la migration n'est écrite dans localStorage que si la fenêtre a le focus
  (préexistant) ;
- la lecture du cache accepte un début ≤ 0, un horodatage futur et plus de 1 000
  entrées ;
- la sonde des favoris filtre les places sur le symbole brut : un favori écrit
  « BTC/USD » n'a que la borne de 2,5 s ;
- la watchlist classe en 1h fixe, le graphe à l'unité courante ; un échec de
  mesure n'est mémorisé que 60 s ;
- le trafic de fond n'a pas été remesuré (hors démarrage, ci-dessous).

## Lot F — corrections de la revue finale

### F1, noyau (`b0062f2`)

Files à trois rangs avec promotion et abandon, deux créneaux par place (favoris
et recherche n'en prennent qu'un), départs espacés (Kraken 1 s, Coinbase 200 ms,
OKX 70 ms, autres 50 ms), créneau rendu à la fin réelle, TTL étalé de 25 à 35 j,
« vide » 24 h ; sortie anticipée ; chemin à froid sans raccourci ; bornes « au
moins aussi profondes » ; OKX sondé en 1M puis affiné ; plafond Kraken 500.

Deux tours de correction :

1. Le premier vérificateur a trouvé deux importants. Les sondes de recherche
   pouvaient encore occuper les deux créneaux Binance (le graphe ne tenait la
   borne que jusqu'à environ 700 ms par requête Binance), et la sonde Binance
   passait seule avant les autres catalogues à froid (HYPEUSDT perdait 0,7 à
   1,1 s). Corrigé : un créneau réservé au graphe
   sur les places à deux créneaux ; course entre « Binance décidé », « tous les
   catalogues arrivés » et l'échéance. Au passage, `teteDecidee` n'attend plus
   une place sans l'unité de la tête (BTCUSDT 1w rendu à 50 ms au lieu de
   2 500 ms).
2. Le second a trouvé que Kraken et Coinbase, à un seul créneau, restaient sans
   réserve : HYPEUSD 1d pouvait finir sur une place inconnue. Corrigé : deux
   créneaux partout, espacement inchangé.

Preuves du troisième passage (conforme) :

| Coinbase, latence par page | Graphe au-delà de la borne, avant | Après |
|---|---|---|
| 350 ms | 0/9 | 0/9 |
| 700 ms | 5/9 | 0/9 |
| 1 000 ms | 9/9 | 0/9 |
| 1 340 ms | 9/9 | 9/9, comme le témoin sans recherche : deux pages dépassent seules la borne |

- Kraken : 1 cas sur 48, contre 4 sur 9 à 800 ms avant.
- Sortie anticipée : 0 contre-exemple sur 1 959 cas, dont 986 décidés avant la
  borne.
- Invariants de file : 30 graines, puis 40 graines sous charge aléatoire, sans
  violation de créneau ou d'espacement, famine ni minuteur résiduel.
- Scénario du bloquant rejoué sans abandon (pire cas) : Bybit en tête 40 fois sur
  40, pour une latence de 350 à 1 150 ms. Frappe réelle : Bybit en tête dans les
  36 cas, rendu entre 850 et 2 250 ms.
- Réseau réel, démarrage à froid (4 passes par cas) : BTCUSDT 1m sur
  Binance en 593 à 1 598 ms, 1h en 603 à 1 169 ms ; HYPEUSDT 1h et 1d sur Bybit
  en 967 à 1 605 ms.

### F2, favoris et recherche (`fc6271d`)

- Favoris et ticker mesurent au rang « favoris » ; la recherche au rang
  « recherche », avec abandon au changement de requête, à la fermeture et au
  démontage (résultat actif d'abord, puis les 12 premiers).
- Pas de confirmation définitive tant qu'une autre place du favori reste sans
  mesure : source enregistrée conservée sans sonde, favori sans source provisoire,
  réessai à chaque passe, 5 min au plus depuis le premier doute.
- Favori sans source et graphe prêt : place du graphe retenue seulement en tête
  du classement 1h.
- 10 mutants de `Watchlist.tsx` et 6 de `PairSearch.tsx` détectés ; les 22
  parcours `sources-automatiques` ont tourné contre la vraie file de F1.

Le vérificateur l'a jugé conforme, avec sept mineurs : place retenue elle-même
sans mesure, graphe hors favoris classé et mesuré, repli sur la place du graphe
quand aucun ticker ne répond, doute jamais purgé, doute étendu aux places classées
sous la place retenue, résultat actif au-delà des 12 premiers mesuré en dernier,
commentaire inexact sur le palier 0. Le contrôle conjoint a corrigé le
commentaire et documenté le report du doute comme assumé ; le lot G a traité les
quatre premiers.

### Contrôle conjoint

`pnpm -r typecheck` réussi ; web 390 fichiers, 5 538 tests ; parcours
`sources-automatiques` et `multivue` 30/30 deux fois. Un test sans lien avec la
branche (`tresoreriesBtc.test.ts`, 1 ms d'écart) a échoué une fois, puis passé
15 fois sur 15 isolé. Mesures au navigateur : section suivante.

## Lot G — mineurs du contrôle conjoint (après `fc6271d`)

1. Un graphe prêt sur un actif absent de tous les groupes de la watchlist n'est ni
   classé ni mesuré.
2. La place retenue compte dans le doute : si sa propre mesure manque et qu'une
   autre place existe, rien n'est confirmé (5 min au plus). Un favori à place
   unique n'est jamais en doute.
3. Favori sans source et aucun ticker qui répond : la place du graphe n'est
   retenue que si elle est en tête du classement ; sinon réessai à 30 s.
4. Un favori retiré de tous les groupes oublie son doute ; rajouté, il retrouve
   ses 5 min. Limite : retiré puis rajouté pendant le démontage de la watchlist,
   il garde son ancienne fenêtre.
5. Message « Historique Kraken limité à ~500 bougies ».
6. En-tête du cache corrigé ; `PLAFONDS.hyperliquid` supprimé (Hyperliquid n'a
   pas de sonde et reste seul classé pour son perp).

Coût : quand la mesure de la place retenue échoue, le favori reste en doute
jusqu'à 5 min, avec un réessai toutes les 30 s (mesure de 15 s au plus, puis
classement). Une place sans mesure d'un autre type, par exemple MEXC
injoignable, avait déjà ce coût.

## Mesures au navigateur

Chromium headless, profil neuf à chaque mesure, API réelles, sans bouchon,
serveurs Vite de dev (branche sur 5301, main `f786c0a` sur 5302). Revue finale :
`4c7f304`, le 26/09 entre 14 h 35 et 14 h 55. Contrôle conjoint : F1 + F2, avant
le lot G (non remesuré ensuite). Chaque colonne compare la branche au main de la
même session.

| Parcours | Revue finale : main → branche | Contrôle conjoint : main → branche |
|---|---|---|
| Démarrage à froid, BTCUSDT 1m (médiane de 5) | 1 817 → 4 874 ms (+3 057) | **1 272 → 1 562 ms (+290)** |
| Rechargement à chaud (médiane de 5) | 1 151 → 913 ms | 915 → 906 ms |
| Requêtes de sonde au démarrage | 0 → 24 | 0 → 27 (15 sondes : 3 favoris × 5 places) |
| Recherche HYPEUSDT | « Binance » à 24 ms → « Auto » à 47 ms, « Bybit » à 812 ms | « Binance » à 7 ms → « Auto » à 8 ms, « Bybit » à 1 050 ms |
| Entrée sur HYPEUSDT | Binance → Bybit prêt en 354 ms | Binance en 409 ms → Bybit en 307 ms |
| Entrée immédiate, libellé encore « Auto » | non mesuré | 317, 320, 416 ms → 827, 927, 1 847 ms |
| Graphe HYPEUSDT 1d | 3 bougies depuis le 2026-09-24 → **443 depuis le 2025-07-11** | idem |
| Frappe lente de « HYPEUSDT », 250 / 350 ms par touche | 0 → 55 sondes, 10 paires non choisies | 0 → 32 / 36 sondes, 9 paires non choisies |

- **Démarrage à froid** : avant F, la borne de 2,5 s était atteinte dans 4 cas
  sur 5, le plus souvent sur la sonde Coinbase (4 pages en série). Après F, elle
  n'est plus atteinte ; il reste 337 à 658 ms entre le catalogue Binance et la
  requête du graphe (43 à 239 ms sur main) : la sonde Binance 1w, qui décide la
  tête. Les 27 requêtes de sonde se terminent entre 5,7 et 6,9 s.
- **À chaud** : la branche était plus rapide avant F (requête 1m vers 170 à
  210 ms) grâce au raccourci du cache ; F1 l'a retiré et les deux sont à égalité.
- **Frappe lente** : 42 % de requêtes en moins ; l'abandon ne retire que les
  sondes pas encore parties. Le « 20 paires » de la revue finale comptait chaque
  graphie de place ; normalisé, il vaut 10.
- **Mesures de la revue finale, non remesurées après F** : favori HYPEUSDT sur
  Bybit en 1 014 ms, stable pendant 20 s, 5 sondes (main : Binance en 408 ms) ;
  BTCUSDT sur Binance et CARDSUSDT sur OKX des deux côtés ; BTCUSD 1d sur
  Coinbase (main : Binance) ; HYPEUSD sur OKX en 1d et Coinbase en 1h (main :
  Kraken).
- **CVD** : sur HYPEUSDT (Bybit), désactivé avec le badge UNUSABLE ; sur main
  (Binance), disponible.
- **Plafonds** : OKX s'arrête à 1 440 bougies en 1h ; Kraken renvoie 721 lignes,
  dont le graphe ne garde que 500.
- **MEXC** : `api.mexc.com` ne se résout pas depuis ce poste ; MEXC n'est jamais
  mesuré, sur les deux serveurs.

## Tests et budget

- **État final (lot G)** : web 390 fichiers, 5 546 tests, deux fois (lot G et son
  vérificateur) ; `Watchlist.test.ts` 65 tests ; `tsc` web réussi ; parcours
  `sources-automatiques` et `multivue` 30/30, deux fois ; limite Kraken PARTIAL
  1/1.
- **Contrôle conjoint (F1 + F2)** : `pnpm -r typecheck` réussi ; web 5 538 tests.
- **Revue finale (`4c7f304`)** : `pnpm -r typecheck` 6/6 ; `pnpm -r test` : web
  5 484 (390 fichiers), indicateurs 1 481 (408 fichiers, dont 187 copies
  compilées sous `dist/`), alertes 79, backtest 128, daemon 756, 0 échec. La
  branche ne modifie que `apps/web`.
- **Lot E** : `sources-automatiques` 22/22 deux fois.
- **Périmètre** : fichiers sous `apps/web` seulement ; aucune dépendance, aucun
  hôte, aucune règle de proxy, `@axiom/types` inchangé.

Budget d'entrée de la branche (Node 24.13, zlib 1.3.x ; plafonds 1 220 000 /
360 000 inchangés) :

| État | Brut (octets) | Gzip (octets) | Marge gzip |
|---|---|---|---|
| main (base fournie) | 1 190 550 | 355 056 | — |
| `4c7f304` (revue finale) | 1 195 249 | 356 875 | 3 125 |
| F1 + F2 (contrôle conjoint) | 1 198 940 | 358 297 | **1 703 (0,47 %)** |

Non remesuré après le lot G. Le prochain ajout au chargement initial peut
dépasser la marge gzip.

## Limites assumées

- **Split taker** : pour un actif dont Binance n'est pas la place la plus
  profonde, CVD, indicateurs acheteur/vendeur, DOM et DES perdent le split taker
  Binance.
- **Unité de temps** : la place retenue peut changer avec elle (HYPEUSD : OKX en
  1d, Coinbase en 1h). Les dessins, indexés par `slot:place:symbole`, ne suivent
  pas le changement de place.
- **Coinbase sur 4 pages** : sa borne (environ 3,8 ans) reste « au moins aussi
  profonde » et Binance départage. BTCEUR 1d part sur Binance (6,7 ans) alors
  que Coinbase afficherait 11,4 ans ; BTCUSDC 6h : 7,8 contre 11,2 ans ; ETHBTC
  1d : 9,2 contre 10,4 ans.
- **Borne de 2,5 s** : dépassements simulés chez Kraken (1 cas sur 48) et chez
  Coinbase à 1 340 ms par page ; la place non mesurée garde alors le bénéfice du
  doute. Sur HYPEUSDT, Binance reste inconnu à la borne au-delà d'environ 1,15 s
  par requête.
- **Requête pendue** : faute de signal dans `fetchKlines` (`@axiom/types` figé),
  elle garde son créneau pour la session. Une seule sonde pendue, quel que soit
  son demandeur (graphe compris), bloque favoris et recherche de sa place ; une
  seconde, forcément du graphe puisque le second créneau lui est réservé,
  bloquerait tout. Le graphe se dégrade proprement : place
  inconnue à la borne, bénéfice du doute.
- **Recherche** : la frappe lente mesure encore environ 9 paires non choisies ;
  l'Entrée immédiate sur « Auto » coûte environ 600 ms ; un résultat actif
  au-delà des 12 premiers est mesuré en dernier.
- **Favoris** : quand une place reste sans mesure, la confirmation attend jusqu'à
  5 min, même si le plafond de cette place la classe sous la place retenue
  (`binance:HYPEUSDT` avec OKX toujours en échec : environ 5 min 30 s avant
  Bybit).
- **OKX** : limité aux 1 440 dernières bougies par son adaptateur
  (`/market/candles`).
- **Budget** : marge gzip de 1 703 octets.
- Mineurs ouverts listés plus haut.

## Suites possibles

- Coinbase : recherche dichotomique sur des fenêtres de 350 j (environ 5 à 6
  requêtes) à la place des 4 pages.
- OKX : `history-candles` pour dépasser 1 440 bougies.
- Si `@axiom/types` est dégelé : passer un `AbortSignal` à `fetchKlines` et
  l'annuler vers 60 s, ou ne plus compter une sonde pendue au-delà comme créneau
  occupé.
- Ne pas lancer l'affinage 1d ni la page Coinbase suivante quand le résultat ne
  peut plus changer la tête ; reclasser le graphe quand une mesure tardive change
  la tête (`abonnerProfondeurs`).
- Différer la mesure de la liste de recherche tant que la frappe continue.
- Regrouper les confirmations d'une passe de favoris en une seule écriture.
- Valider la lecture du cache comme l'écriture (début > 0, horodatage passé,
  1 000 entrées).
- Remesurer le trafic de fond (watchlist et recherche type), comme le 24/09.
