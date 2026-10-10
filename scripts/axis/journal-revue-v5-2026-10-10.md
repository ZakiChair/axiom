# Journal de revue — AXIS v5 (garde-fou de régime BTC : achat si la référence BTC clôture au-dessus de son EMA 100), 10 octobre 2026

Revue du protocole, du runner et du garde-fou dans `stratAxis` AVANT le figeage et
avant toute lecture des données de test (règle du projet : « Backtest / math /
drawdown / expectancy → Réviseur »). Revue menée du 9 octobre 23:40 UTC au
10 octobre 00:10 UTC, dépôt `/Users/zakichair/Projects/axiom`, HEAD
`18ef8b3ffea1c755fd176ec0d28d50351ab61564` (exploration v5 commitée), arbre de
travail contenant le manifeste, le runner, le garde-fou dans `stratAxis` et ses
tests (non commités, attendu avant figeage) ; aucun autre chemin modifié.

**Rôles, à déclarer.** Le protocole (hypothèse, grille d'exploration, règle de
choix, critères, textes des suites) a été rédigé par l'agent lead de la session,
qui signe aussi cette revue ; l'implémentation (runner, manifeste JSON,
garde-fou et tests) a été réalisée par un agent développeur distinct, sur brief,
puis revue par le lead. L'auteur du protocole et le réviseur sont donc le même
agent : c'est une limite de cette revue par rapport aux journaux v3 et v4 (réviseur
tiers) ; en contrepartie, les contrôles croisés ci-dessous ne reposent pas sur la
lecture du code mais sur des implémentations indépendantes et sur la
reproduction exacte de l'exploration.

Méthodes : lecture du manifeste (1 264 lignes) et du contenu autoritaire dont il
procède, du runner (2 298 lignes : chargeur KuCoin, référence, contrôles, critères,
suites, banc), du diff de `stratAxis.ts` et de son test contre HEAD, du pont
`alignAux` (`utils-aux.ts`) ; `pnpm check` ; `--banc` ; `--essai` rejoué deux fois
(avant et après figeage, déterminisme) ; deux contrôles croisés écrits hors dépôt
(`/tmp/axis-v5-revue/`) : A, chart contre la variante explorée ; B, chart contre une
implémentation naïve écrite depuis le texte du manifeste. Aucune requête vers
KuCoin, aucun symbole du pool lu, aucun fichier dans
`scripts/.cache-klines/axis-v5-kucoin/` (vérifié avant, pendant et après).

## Empreintes (telles que lues, `shasum -a 256`)

| Fichier | SHA-256 |
|---|---|
| `scripts/axis/manifeste-v5-2026-10-10.json` (figé à 2026-10-10T00:06:58Z) | `0dc749bb11e7d5d6a0826a96e2e3c6949a903bea5e00861f0a28acb947c9f135` |
| `scripts/axis/manifeste-v5-2026-10-10.json` (candidat, avant figeage, `A_FIGER`) | `f91cc22d1e23b5d8aaa1ae4a5b1f79756ace3723c28c46530d35b79843caa3e8` |
| `scripts/valider-axis-v5.ts` (`HASH_MANIFESTE` épinglé) | `9a7580cdd86d7faea5c4c573ce202b11f32fcb1d7f0452b8138f8eeb3969168c` |
| `scripts/valider-axis-v5.ts` (avant figeage, `HASH_MANIFESTE = "A_FIGER"`) | `27bb1cc8579faf5561a762f030a2975c67fbeca4af733faa653e33f77efcc30b` |
| `packages/indicators/src/strategy/stratAxis.ts` (arbre de travail, garde-fou ajouté) | `a47c56d7782388edaaafa1d576613f561a38adfe703d64dff1a1e67f54f63220` |
| `packages/indicators/src/strategy/stratAxis.test.ts` | `2e4ae6fc20e75e47221563f3646dc3c4fb76025bba40636a7d8af78c3283741c` |
| `packages/indicators/src/utils-aux.ts` (`alignAux`, inchangé) | `3d4b5a35611d67ce772803eb9d5e3e92ef8ee25eeee11e31dda39643a070bd2e` |
| `packages/indicators/src/utils.ts` (inchangé depuis la v3) | `693259721a342f3adf0c897b5e279a9f6e9eb81bdb6d134449c3d19723c5266b` |
| `packages/backtest/src/engine.ts` (inchangé depuis la v3) | `4b1baadc37494b10537818259bc94e0c7b334794d272b3efbc295b2af8011d9d` |
| Arbre hors tests de `packages/{indicators,backtest,types}/src` (observé par le runner) | 247 fichiers, `53c042dcc40bb4deff5cdd82f546bbecfb77d4a4283945093497b46c17b20ceb` |

Le diff du runner entre les deux empreintes se limite à la ligne `HASH_MANIFESTE`
(l. 90), vérifié. Le manifeste n'a changé entre le candidat et le figeage que par
`figeLeUtc`, `historique.repetitionAvantFigeage` et `versions.*`.

## Vérifications exécutées

- `pnpm check` : typage des 8 projets ; tests pacte 120, indicateurs 1 673
  (108 pour AXIS), alertes 142, backtest 143, web 5 958, daemon 785 ; budget
  d'entrée 1 195 838 / 356 207 (plafonds 1 220 000 / 360 000, marge gzip 3 793).
- `tsc --noEmit --strict --noUncheckedIndexedAccess …` sur le runner : propre, avant
  et après l'épinglage (`HASH_MANIFESTE` déclaré `string`).
- `bun scripts/valider-axis-v5.ts --banc` : 38 vérifications passées, aucune donnée
  lue (P1 relatif : v5 > v2 à x1 ET x3, égalité = échec ; P2 60 % tient, 59,2 %
  échoue ; P3 50 % échoue (strict), 50,8 % tient ; seuil de cellules 106/141 ;
  formulations remplies des trois verdicts).
- `bun scripts/valider-axis-v5.ts --essai` (8 symboles déjà vus, cellules
  2023-07-01 → 2026-10-08 exclu, cache de l'exploration, aucun téléchargement) :
  8/8 cellules, contrôles bloquants passés ; v5 319 trades clos contre 339 pour la
  v2 ; expectancy regroupée x1 4,258 % contre 3,721 %, x3 3,970 % contre 3,434 % ;
  Sharpe v5 > v2 sur 6/7 cellules comparables hors BTC, 4/7 puis 5/7 par moitié ;
  43 entrées de la v2 refusées, 94 % des trades clos conservés, 56,0 % des
  décisions avec référence > EMA 100 ; verdict NON_CONCLUANT (7 < 80 comparables),
  attendu. Rejoué après le figeage : mesures strictement identiques
  (déterminisme), `identiqueAuFigeage: true`, seul avertissement « chemins non
  commités ».
- `bun scripts/valider-axis-v5.ts --campagne` : refus avant tout réseau, pour la
  seule raison des chemins non commités (la borne `finExclue` 2026-10-10T00:00Z est
  passée) ; aucun fichier créé sous `axis-v5-kucoin/`.
- **Contrôle croisé A** (`/tmp/axis-v5-revue/controle-croise-A.ts`) : la position
  `btc-ema100` de l'exploration (two-pointer LOCF, `ema` du dépôt sur la série
  alignée, lecture absente = faux, `positionsAxis`, fin n−2) comparée bougie par
  bougie à `computeIndicator(stratAxis, …, { regimeBtc: 100 }, { refClose:
  alignAux(times, btcPoints) }).series.etat` sur les 159 séries du cache de
  l'exploration (151 alts du manifeste v3 + 8 majors, BTC comprise) :
  1 224 429 bougies, **0 écart**. Le chart calcule exactement la variante que
  l'exploration a retenue.
- **Contrôle croisé B** (`/tmp/axis-v5-revue/controle-croise-B.ts`) : implémentation
  naïve écrite depuis `signal.entree`, `signal.sortie` et `signal.position` du
  manifeste (boucle propre, two-pointer propre, EMA propre amorcée sur les 100
  premières valeurs définies, armement « évaluable et fausse une fois », sans
  `positionsAxis`, `positionsStopAxis`, `emaDepuisPremiereDefinie` ni `alignAux`),
  comparée au chart : (a) 8 majors du cache, 141 835 bougies ; (b) 300 séries
  synthétiques à graine (600 à 2 000 bougies, référence indépendante, dont 100 cas
  où la référence ne commence qu'à un indice aléatoire et 50 cas à trous d'heures),
  387 503 bougies ; (c) 12 perturbations (préfixes 40/70/90 % et futur altéré sur
  ETH/SOL/DOGE), 132 295 bougies — **0 écart**, y compris la règle « référence ou
  EMA indéfinie → garde-fou non appliqué ».
- Tests de `stratAxis.test.ts` lus : équivalence à `regimeBtc` 0 au caractère près
  (JSON) avec et sans `aux.refClose`, avec stop, filtre ADX et filtre flux
  combinés ; cas (a) référence toujours au-dessus (positions de la v2, infobulle
  nommant « EMA 100 »), (b) toujours en dessous (aucun achat), (c) entièrement
  indéfinie (positions de la v2, mention « non appliqué (référence indisponible) »),
  (d) définie à partir d'un indice (non appliqué avant, appliqué après, un achat de
  la v2 refusé) ; armement ; causalité avec aux tronquée ; `positionAxis` =
  `calc().series.etat` ; `etatsStrategie` (sans aux) = v2 ; textes dans toutes les
  unités et ordre des mentions (régime, ADX, stop). Les tests croisés web épinglés
  (`indicators.axisAdx/axisStop/axisUnites.test.ts`) passent sans modification :
  à 0, les textes d'avant le test sont inchangés au caractère près.

## Constats

Aucun bloquant, aucun majeur.

Mineurs appliqués avant le figeage :

- m1 — pool : la borne ≤ 2024-07-01 donnait 142 paires dans le contenu autoritaire ;
  `USDE-USDT` (stablecoin, base `USDe` en casse mixte) passait le filtre sensible à
  la casse. Filtre corrigé (comparaison en majuscules), pool recalculé : 141 paires ;
  seuil NON_CONCLUANT de cellules disponibles 106/141 (75 %). Signalé par le
  développeur, accepté.
- m2 — `historique.repetitionAvantFigeage` : rempli avec les chiffres exacts de
  l'essai (ci-dessus), sans modification du protocole.

Remarques sans correction :

- r1 — P1 est RELATIF (expectancy nette regroupée v5 > v2 aux deux coûts) et non
  absolu comme en v3/v4. C'est pré-déclaré avec son motif (`criteres.raisonP1`) : la
  question est l'écart v5 − v2 ; la viabilité absolue est mesurée, rapportée et
  écrite dans l'infobulle quel que soit le verdict (`{viabilite}`). Le réviseur
  note que cela rend un verdict FAVORABLE possible sur un pool structurellement
  perdant ; la formulation « mais perdante en absolu sur ce pool, comme la v2 » est
  alors obligatoire dans l'infobulle, et le runner la remplit depuis la mesure.
- r2 — sélection du candidat : la période 100 a été choisie parmi trois (100/200/400)
  après lecture des données vues ; la règle pré-écrite de l'exploration l'a retenue
  sans écart (contrairement à la v4). Degré de liberté modeste, déclaré
  (`limitesConnues` 9).
- r3 — indépendance : entière en actifs (place jamais lue, bases jamais lues, hors
  Binance USDT), nulle en temps ; la référence BTC est une série déjà vue, relue à
  l'identique et contrôlée contre le cache de l'exploration sur la période commune
  (contrôle bloquant). La même référence sert toutes les cellules : les 141 cellules
  partagent, par construction, le facteur que le garde-fou lit — c'est l'objet du
  test, et `criteres.dependance` le dit.
- r4 — données KuCoin : bougies 4h sans transaction omises par la source → seuil de
  2 % de créneaux manquants (1 % en v4), motivé ; au-delà, cellule indisponible.
  Risque de NON_CONCLUANT si plus de 35 cellules sont indisponibles : accepté, le
  verdict le dira.
- r5 — contexte sans référence (alertes, fenêtre BT, screener, rejeu commun) : le
  garde-fou n'est pas appliqué et le texte le dit ; un verdict FAVORABLE exigera un
  lot ultérieur (référence servie à ces contextes, profondeur de `refClose` du chart
  portée à 1 500 bougies) — écrit dans `suites.FAVORABLE.application` et
  `limitesConnues` 11.
- r6 — budget d'entrée : marge gzip 3 793 octets après le garde-fou ; le lot des
  suites (textes du verdict) coûtera quelques centaines d'octets, à surveiller.

## Verdict du réviseur

Figeage AUTORISÉ en l'état (m1 et m2 appliqués). Le commit de figeage doit contenir :
ce journal, le manifeste figé, le runner épinglé, `stratAxis.ts` et ses tests, les
deux tests web adaptés (`indicators.aux.test.ts`, `indicatorUsability.test.ts`).
Exécution unique ensuite : `bun scripts/valider-axis-v5.ts --campagne`, sur le
commit de figeage, après 2026-10-10T00:00:00Z. Le présent journal sera complété
après l'exécution (section « Après l'exécution »).

## Après l'exécution (10 octobre 2026, 00:11 → 00:30 UTC)

- Exécution unique : `bun scripts/valider-axis-v5.ts --campagne` sur le commit de
  figeage `c7c8b3df8e376b54298903e01850f11596a9e188`, arbre propre, de 00:11:48 à
  00:18:24 UTC (396 s). Le runner a vérifié le manifeste (hash épinglé), rejoué le
  banc (38 vérifications), téléchargé la référence Binance BTCUSDT (20 029 bougies,
  2017-08-17 → 2026-10-09 20:00) et l'a trouvée identique au cache de l'exploration
  sur la période commune, puis les 141 cellules KuCoin ; `identiqueAuFigeage: true`,
  `cheminsFigesCommites: true`, aucun avertissement, aucun arrêt de contrôle.
- Résultat : `scripts/axis/resultat-v5-2026-10-10.json` (SHA-256
  `321c84d1583d0fed321ff48d6d04b3d38ae567c9b8c8a25f80c1019deb9a8bcc`), rapport
  `scripts/axis/rapport-v5-2026-10-10.md`. 139 cellules disponibles sur 141 (BSV-USDT
  et ETN-USDT indisponibles : 441 et 2 142 créneaux manquants, au-delà des 2 %) ;
  139 comparables sur la fenêtre et sur chaque moitié ; 5 293 trades clos v5.
- Verdict pré-déclaré : **FAVORABLE**, les 5 blocs tenus — P1 x1 4,583 % > 3,287 %,
  P1 x3 4,295 % > 3,001 % ; P2 105/139 = 75,5 % ; P3 89/139 = 64,0 % puis 98/139 =
  70,5 %. Descriptifs lus par le réviseur dans le rapport : viabilité absolue vraie
  pour la v5 et la v2 ; drawdown plus faible sur 111/139 ; PnL moyen 17,5 % contre
  14,5 % ; exposition 20,9 % contre 23,7 % ; 1 411 entrées de la v2 refusées (23,0 %),
  86,5 % des trades clos conservés ; LOCF 0,001 % (grilles identiques) ;
  achat-conservation médian −96,0 % ; l'avantage tient dans chaque cohorte de cotation
  (44/55, 18/20, 18/27, 25/37). Les parts de la v5 sur ce pool (75,5 %, 64,0 %,
  70,5 %) sont du même ordre que celles de l'exploration (77,5 %, 58,3 %, 72,2 %) :
  aucune dégradation hors échantillon.
- Suites appliquées conformément à `suites.FAVORABLE` et `suites.communes` :
  défaut du chart `regimeBtc = 100` ; formulations du résultat recopiées au caractère
  près dans `stratAxis.ts` (4h : mesure remplie ; autres unités : « non mesuré en
  {u} » ; 0 : « sans garde-fou de régime (réglage) : signaux de la v2 testée » ;
  autre période : « hors du test ») ; mention « non appliqué (référence
  indisponible) » dans les contextes sans référence ; test croisé
  `apps/web/src/chart/indicators.axisRegime.test.ts` (empreinte du résultat
  épinglée) ; profondeur de `refClose` du chart portée à 1 500 bougies (deux appels
  paginés) ; docs/axis, BUILD-CONTRACT, README mis à jour. `pnpm check` réussi :
  indicateurs 1 675, alertes 142, backtest 143, pacte 120, web 5 970, daemon 785 ;
  budget 1 196 472 / 356 428 (marge gzip 3 572).
- Reste à faire (annoncé dans le manifeste, hors de cette campagne) : servir la
  référence aux alertes et à la fenêtre BT, qui calculent encore la v2.
- Ces 141 paires sont consommées : aucune autre variante n'y sera jugée sans
  décision explicite du propriétaire.
