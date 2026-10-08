# Journal de revue — AXIS v3 (stop suiveur 3 × ATR 14), 8 octobre 2026

Revue indépendante du protocole, du runner et du stop dans `stratAxis` AVANT le
figeage et avant toute lecture des données de test (règle du projet : « Backtest /
math / drawdown / expectancy → Réviseur »). Le réviseur (agent séparé) n'a pas écrit
ce code. Revue menée de 13:19 à 13:36 UTC, dépôt `/home/factory-user/repos/axiom`,
HEAD `43988f4f21f30594f8623cabb0b99c4098ac71a8` (v2 livrée), arbre de travail
contenant le manifeste, le runner, l'explorateur et le stop dans `stratAxis`
(non commités, attendu avant figeage).

Méthodes : lecture du manifeste, du runner (1 881 lignes), du diff de `stratAxis.ts`
et de son test contre HEAD, du moteur (`packages/backtest/src/engine.ts`), du rejeu
(`utils-fabrique-strategie.ts`), de `rma`/`trueRange`, de l'explorateur et de ses
sorties `/tmp/axis-v3-explo/` ; `tsc --strict` du runner ; `--banc` ; `--essai`
rejoué HORS RÉSEAU (`unshare -rn`) depuis les 8 caches `E-*` déjà présents ; tests
indicateurs et tests web AXIS ; trois scripts de vérification indépendants écrits
dans `/tmp/axis-revue-v3/` (recalcul Python du Sharpe, des moitiés et des parts
depuis les trades et les closes ; lecture naïve du manifeste comparée à
`positionsStopAxis` sur 400 séries aléatoires et perturbations sur BTC ; comparaison
au caractère près de `calc()` à `stopAtr = 0` contre la v2 de HEAD sur les 8 séries
réelles). Aucune requête vers Binance, aucun symbole du pool lu, aucun cache `H-*`
écrit, aucun fichier du dépôt modifié par le réviseur.

## Empreintes (telles que lues, `sha256sum`)

| Fichier | SHA-256 |
|---|---|
| `scripts/axis/manifeste-v3-2026-10-08.json` (candidat, `figeLeUtc` et `versions` = `A_FIGER`) | `349ac08fb03928028213d0316d8c6292f986e096b0956eb1833a1897dbdcc1ae` |
| `scripts/valider-axis-v3.ts` (`HASH_MANIFESTE = "A_FIGER"`) | `6b3e59bf5eea7494f0da60ade02c3429b3db43d767d5e07376611a052183b4c8` |
| `packages/indicators/src/strategy/stratAxis.ts` | `7c2d94d2ce0a94c864830c1f73bda2a2cc901d2dfdf9e631eba4bc82532cfcdc` |
| `packages/indicators/src/strategy/stratAxis.test.ts` | `6e42e6e346d5b0bbaca0037b5ee38c427f4e3b21dc04ce1676994da1260ae8bb` |
| `scripts/explorer-axis-v3.ts` | `1acf00ee78cb08218895699f9791e0d458c1bb120d6cab5bf934fe423c213c9a` |
| `packages/backtest/src/engine.ts` | `4b1baadc37494b10537818259bc94e0c7b334794d272b3efbc295b2af8011d9d` |
| `packages/indicators/src/utils.ts` | `693259721a342f3adf0c897b5e279a9f6e9eb81bdb6d134449c3d19723c5266b` |
| `pnpm-lock.yaml` | `130d4fb62f5223486552e31137f28d4901e098bf7a78325b943f30fc6beac062` |
| Arbre hors tests de `packages/{indicators,backtest,types}/src` (observé par le runner) | 247 fichiers, `7f4eb89e6668733233d99f52298a237dcc7d2618475bb2586ff1a0209da067db` |

Le SHA-256 du runner changera au figeage (ligne `HASH_MANIFESTE`) : le SHA final doit
être reporté ici, et le diff du runner entre les deux empreintes doit se limiter à
cette ligne (voir remarque r3).

## Vérifications exécutées

- `tsc --noEmit --strict --noUncheckedIndexedAccess …` sur le runner : propre.
- `bun scripts/valider-axis-v3.ts --banc` : 37 vérifications passées, aucune donnée lue.
- `unshare -rn bun scripts/valider-axis-v3.ts --essai` (réseau coupé) : 8/8 cellules
  depuis `scripts/.cache-klines/axis-v3/E-*.json.gz`, contrôles bloquants passés,
  2 s ; rapport identique au rapport de l'auteur sauf la ligne d'horodatage
  (déterminisme) ; aucun fichier `H-*` créé (vérifié avant et après). Les caches
  `E-*` sont identiques, OHLCV pour OHLCV, aux caches de la campagne flux
  (`axis-flux/E-BTCUSDT-4h.json`, `H-BNBUSDT-4h.json`) sur la fenêtre : données
  déjà vues, aucune lecture nouvelle.
- `vitest run src/strategy/stratAxis.test.ts` : 69 tests passés ;
  `apps/web` `indicators.axisUnites.test.ts` et `indicators.aux.test.ts` : 36 passés.
- `/tmp/axis-revue-v3/verif-sharpe.py` : depuis `tradesX1` du résultat d'essai et les
  closes du cache, recalcul Python (code indépendant) de l'equity par clôture
  (capital réalisé + latent − frais d'entrée), du Sharpe par bougie (× √2191,5,
  n−1), du drawdown, du PnL et de l'expectancy sur la fenêtre et sur chaque moitié,
  pour v3, v2 et EMA sur les 8 cellules : écart maximal 2,7e-12 ; parts v3 > v2
  1/8, 2/8, 3/8 ; expectancy regroupée 1,982 % ; 513 trades clos ; 422 sorties par
  stop et 91 par score : identiques au résultat du runner. Frontière des moitiés
  = open de l'indice 300 + ⌊(n − 300)/2⌋ (BTC : 2025-03-14T12:00Z) ; n − 300
  rendements par cellule.
- `/tmp/axis-revue-v3/verif-stop.ts` : 19 846 vérifications. (1) Implémentation
  naïve écrite depuis `signal.stop` du manifeste, comparée à `positionsStopAxis`
  sur 400 séries aléatoires (scores et tendance indéfinis, ATR indéfini, fin < n−1,
  k ∈ {0, 1, 2, 3, 5}) : positions, série `stop` et raisons identiques ; cliquet
  jamais décroissant ; toute sortie « stop » a close[i] < stop[i−1] ; aucune bougie
  tenue sous le stop. (2) Sur la série réelle BTC : perturbation de la bougie i
  (close, high, low, donc ATR[i]) → positions et stop avant i inchangés ; un close
  relevé au-dessus de stop[i−1] avec un ATR[i] énorme ne sort pas ; un close abaissé
  juste sous stop[i−1] avec un ATR[i] minuscule sort par stop : la décision à i ne
  lit ni ATR[i] ni close[i] autrement que par la comparaison close[i] < stop[i−1].
  (3) ATR 14 = rma de Wilder du true range (amorce SMA) recalculé à la main ;
  série `stop` du chart = recalcul direct ; position du chart = `positionsStopAxis`.
- `/tmp/axis-revue-v3/verif-v2-exacte.ts` : `calc()` de la v3 à `stopAtr = 0` (et
  sans le paramètre) comparé à la v2 LIVRÉE (`git show HEAD:…stratAxis.ts`, SHA
  `61e4c33d…`) sur les 8 séries réelles, 6 jeux de réglages (dont `filtreFlux`,
  EMA 50, seuils 4/3), 4 unités de contexte et 3 longueurs de série : 576
  comparaisons identiques au caractère près (séries hors `stop`, marqueurs,
  étiquettes), série `stop` entièrement indéfinie ; `textesAxis(u)` et
  `textesAxis(u, 0)` identiques à HEAD pour 8 unités.
- Pool : 154 symboles uniques, `premierJour` tous dans [2020-01-01, 2023-06-30] et
  triés ; aucun suffixe UP/DOWN/BULL/BEAR, aucun des 8 déjà vus ni WBTC ; aucun
  symbole du pool dans les manifestes et résultats des campagnes 2026-10-07 (v1, v2),
  flux et UT, sauf trois (voir M2). Aucun cache `H-*` dans `axis-v3/`, aucun lien
  symbolique dans les trois dossiers figés, aucun fichier `skip-worktree` ou
  `assume-unchanged`, aucune copie temporaire du runner laissée dans `scripts/`.
- Chiffres de `historique.explorationV3` recoupés avec
  `/tmp/axis-v3-explo/{complet,avant-2023-07}/rapport.md` : RoMaD médians (4,56 /
  4,39 ; 3,92 / 3,48 / 3,38 / 3,22), Sharpe médians (1,05 / 0,96, pct-suiveur-10
  4e à 0,97), parts 7/4/8/7 et par moitié, expectancy 5,00 / 4,71 contre 6,16 /
  5,87, 91 trades contre 70, SOL 5 190 → 1 619 et 52/66 : exacts. Une exception :
  M3.

## Constats

Gravités : **B** bloquant, **M** majeur (à corriger avant le figeage), **m** mineur,
**r** remarque.

### Bloquants

Aucun.

### Majeurs

**M1 — `statutIndependance` surestime l'indépendance temporelle.**
Le texte dit : « l'exploration qui a choisi la v3 n'a lu que des bougies antérieures
à cette date (sur d'autres actifs) : hors échantillon en actifs ET en temps »
(`scripts/axis/manifeste-v3-2026-10-08.json:23`). Or `historique.explorationV3.premiereExecution`
(ligne 15) et `scripts/explorer-axis-v3.ts:75-77` consignent une première exécution
de l'exploration sur l'historique COMPLET jusqu'au 2026-10-08, donc sur toute la
fenêtre du test (2023-07-01 → 2026-10-08), avec les 13 variantes dont
atr-suiveur-3, sur les 8 symboles vus ; et `historique.repetitionAvantFigeage`
(ligne 20) a relu cette fenêtre avec v3 contre v2. Les résultats de la famille de
variantes sur la période de test sont donc connus de l'auteur (atr-suiveur-4 y
était première au RoMaD). L'indépendance est en actifs ; en temps, elle ne vaut que
pour la seconde exécution de l'exploration. La ligne 20 le dit bien, la ligne 23
dit le contraire.
Correction attendue : réécrire la phrase de `statutIndependance` : « hors
échantillon en actifs ; en temps, seule la seconde exécution de l'exploration (celle
dont la règle de choix a été lue) est antérieure au 2023-07-01 : la première
exécution (13 variantes, 8 symboles vus) et la répétition `--essai` ont lu la
période 2023-07 → 2026-10 sur d'autres actifs », et renvoyer à
`historique.explorationV3.premiereExecution` et `repetitionAvantFigeage`. Ajouter
le même point dans `limitesConnues`.

**M2 — Trois symboles du pool ont déjà été lus par le dépôt : OGUSDT, FIDAUSDT,
TLMUSDT.**
`statutIndependance` (ligne 23) : « aucune campagne ni exploration du dépôt ne les a
lus ». Le manifeste UT (`scripts/axis/manifeste-ut-2026-10-08.json:17`) et le journal
UT (section « Répétition technique », « Test de charge sur trois paires peu liquides
hors des deux ensembles ») consignent que OGUSDT, FIDAUSDT et TLMUSDT ont été
téléchargés et que le runner UT (copie temporaire) y a calculé AXIS en 1s, 1m, 3m,
5m, 15m, 30m et 1h (« contrôles bloquants passés sur les 21 cellules mesurables »),
la fenêtre 1h couvrant oct. 2023 → oct. 2026. Ce ne sont pas des séries 4h et aucun
verdict n'y a été lu, mais ce sont trois actifs du pool dont les prix 2023-2026 ont
été téléchargés et traités par AXIS avant le figeage.
Correction attendue : retirer ces trois symboles du pool (nombre 154 → 151,
`exclusionsNominatives.dejaVus` ou une nouvelle clé `testDeChargeUt`, règle du pool
complétée) ; à défaut, si le propriétaire préfère les garder, l'écrire explicitement
dans `statutIndependance` avec la nature de la lecture (unités, fenêtre, aucune
lecture de résultat) et dans `limitesConnues`. Le choix doit être fait et consigné
avant le figeage ; le minimum de 116 cellules (75 % de 154) devient 114 si le pool
passe à 151 (`minDisponibles` le recalcule).

**M3 — Erreur factuelle dans l'historique : part des sorties par stop en exploration.**
`historique.explorationV3.lecture` (ligne 17) : « atr-suiveur-3 : … environ la moitié
des sorties par stop » ; `historique.repetitionAvantFigeage` (ligne 20) : « 82 % des
sorties v3 par stop (contre environ la moitié en exploration avant 2023-07) ». Le
rapport d'exploration `/tmp/axis-v3-explo/avant-2023-07/rapport.md` (tableaux
« Agrégats » et « Sorties par raison ») donne pour atr-suiveur-3 : 135 sorties par
score, 574 par stop, soit 81 % ; c'est atr-suiveur-4 qui est à 50 % (304 / 300). Le
contraste annoncé entre exploration et répétition n'existe pas : la part est la même
(81 % puis 82 %). Un manifeste figé ne doit pas porter une affirmation fausse.
Correction attendue : remplacer « environ la moitié des sorties par stop » par
« 81 % des sorties par stop (574 / 709) » à la ligne 17 et supprimer la parenthèse
« (contre environ la moitié en exploration avant 2023-07) » à la ligne 20, ou la
remplacer par « (81 % en exploration avant 2023-07) ».

### Mineurs

**m1 — `suites.communes.sansStop` : verdict d'application non précisé.**
`manifeste:856` : « {texteBase} ; sans stop (réglage) : signaux de la v2 testée ».
Si ce texte s'applique quel que soit le verdict, l'infobulle 4h au défaut actuel
(stopAtr = 0) change même en DÉFAVORABLE / NON CONCLUANT, alors que
`suites.DEFAVORABLE.application` (ligne 836) promet « signaux inchangés » et que le
test croisé compare les textes. Correction : préciser que `sansStop` ne s'applique
que lorsque 0 n'est plus le défaut (FAVORABLE) et qu'en DÉFAVORABLE / NON
CONCLUANT le texte 4h à stopAtr = 0 reste identique au caractère près au texte
actuel (`TEXTE_BASE_4H`).

**m2 — Réserves d'indépendance d'interface absentes.**
Le manifeste UT (ligne 17) signalait LTC dans `MAJORS_VALIDATION` et les paires
visibles dans l'interface ; le manifeste v3 ne le fait pas alors que AVAXUSDT est
dans `MAJORS_VALIDATION` (`apps/web/src/data/validationSignaux.ts:84`) et que 36
symboles du pool (AAVE, APE, APT, ARB, AVAX, AXS, CELO, COTI, CRV, DOT, DYDX,
FLOKI, GALA, GMT, GRT, HIVE, ICP, IMX, LDO, LUNA, MANA, NEAR, OP, PEPE, POLYX,
RARE, RAY, ROSE, RPL, SAND, SHIB, SUI, UNI, WOO, XEC, ZEN) figurent dans des listes
ou tests de l'application (aucune lecture d'AXIS). Correction : reprendre la réserve
dans `statutIndependance`.

**m3 — `limitesConnues` incomplètes.**
Manquent : la taille fixe (1 000 USDT sur 10 000, le stop ne dimensionne pas la
position : Sharpe et drawdown mesurés sur une equity exposée à environ 10 %, le
critère reste ordinal) ; la sélection après coup du multiplicateur (3 parmi 2-5) et
de la métrique (renvoi à `historique.choixV3`, déjà honnête mais hors des limites) ;
la période de test déjà lue sur d'autres actifs (M1). Correction : trois puces.

**m4 — Constantes du runner non recoupées avec la prose du manifeste.**
`LIMITE_PAGE = 1000` (`scripts/valider-axis-v3.ts:90`), `CONCURRENCE = 4` (ligne 98),
`COUPES_CAUSALITE` (ligne 94) ne sont pas vérifiés contre `donnees.pagination`,
`donnees.parallelisme` et `controlesBloquants[2]` comme le sont le débit et le
timing ; `attentesS.length` n'est pas comparé à `tentativesParPage` (ligne 310,
repli silencieux `?? 16`) ; `verifierManifeste` (ligne 255-258) vérifie
`premierJour < debut` mais pas la borne basse 2020-01-01 de `symboles.regle`
(vérifiée ici par script : conforme). Correction : quatre assertions au démarrage,
sur le modèle de `chiffre()`.

**m5 — Mesures du runner absentes du manifeste (descriptives, sans effet sur le
verdict).**
`fraisTotal` (ligne 876), `medianes` (PnL, DD, Sharpe, trades clos ; ligne 1119),
`sommePnlPct`, `gagnants`, Sharpe aux coûts x2 et x3 par cellule, timing par
cellule et par stratégie (`medianeNulle`, `q95Nulle` ; ligne 804), p du test des
signes par moitié absent alors que les parts par moitié sont rapportées.
Correction : une phrase dans `descriptif` les énumérant (« médianes par cellule,
frais, Sharpe à tous les coûts, timing par cellule : descriptifs »), ou les retirer.

**m6 — `controlesBloquants[0]` ne dit pas que le contrôle des marqueurs porte sur
les 120 signaux les plus récents.**
Le chart n'émet que `MAX_SIGNAUX_AXIS = 120` marqueurs et `MAX_LABELS_SORTIE = 10`
étiquettes ; `controlerMarqueurs` (lignes 672-698) le respecte. Correction :
préciser « (les 120 signaux les plus récents et les 10 dernières étiquettes, ce que
le chart émet) ».

**m7 — `signal.stop.serie` : « absente à plat et à la bougie de sortie » est
incomplet.**
`positionsStopAxis` reporte aussi le niveau en vigueur sur la bougie en formation
(i > fin) et sur une bougie tenue à score indéfini (`stratAxis.ts:263-266`) ; le test
« après `fin`, la position et le niveau en vigueur sont reportés » l'exige.
Correction : « … présente sur la bougie en formation (niveau reporté, non
recalculé) ».

### Remarques (sans correction exigée)

**r1 —** Un échec mesuré l'emporte sur une insuffisance de cellules
(`juger`, ligne 1310 ; banc « cellules insuffisantes + échec P3 »). Lecture littérale
de `criteres.verdict` : un échec de P1 avec, par exemple, 60 cellules disponibles
sur 154 donnerait DÉFAVORABLE sur un échantillon non représentatif. Pré-déclaré ;
le propriétaire doit le savoir.

**r2 —** En campagne, la progression affiche le nombre de séries exploitables avant
le verdict (ligne 1808) : pas une valeur mesurée, mais c'est la seule information
qui précède le verdict. Acceptable.

**r3 —** Le runner n'est pas dans `codeAuFigeageSha256` et son SHA change au figeage
(`HASH_MANIFESTE`). Après le commit de figeage : consigner le SHA final ici, vérifier
que `git diff` entre le runner revu (`6b3e59bf…`) et le runner figé se limite à
cette ligne, et après la campagne que `git show <commit>:scripts/valider-axis-v3.ts |
sha256sum` le redonne (règle r-d du journal UT).

**r4 —** L'arbre de travail contient des modifications étrangères au test
(`apps/web` depthHeat / windowPanels, `BUILD-CONTRACT.md`). `versions.commitDeFigeage`
annonce « le module BOOK différé » dans le commit de figeage : le message du commit
doit en lister le contenu, et aucun de ces fichiers n'est dans les chemins mesurés
(vérifié : les chemins vérifiés sont le runner, le manifeste, `pnpm-lock.yaml` et
les trois dossiers `src`).

**r5 —** Risque réel de NON CONCLUANT par « moitie » : une moitié sans aucun trade
ni position (alts sans signal) donne une equity constante, un Sharpe indéfini et une
cellule non comparable ; il faut 100 comparables dans CHAQUE moitié. Pré-déclaré.

**r6 —** La sortie `stop` ajoutée aux `outputs` (`stratAxis.ts:513-516`) crée une
entrée « Stop suiveur » dans la légende du chart même à stopAtr = 0 (série vide,
rien n'est tracé). Vérifier le rendu avant le merge ; aucun effet sur le test.

**r7 —** Le DEFAVORABLE sur P2 cite `{pSharpe}` arrondi vers le bas (`partEntiere`),
jamais plus favorable que la mesure ; `signeFixe` écrit « 0.0 » sans signe. « 1
trades clos » resterait au pluriel dans `NON_CONCLUANT.raisons.trades` : cas
théorique (≥ 100 attendus pour autre chose qu'une insuffisance).

**r8 —** `sharpeEquity` ignore un rendement si l'equity précédente est ≤ 0
(ligne 830) : impossible avec 10 000 de capital et 1 000 par position en long seul.

## Vérifié correct (RAS)

- **A. Fidélité manifeste ↔ runner** : P1 (expectancy regroupée pnlPct, fin-données
  compris, x1 ET x3 ; ≥ 100 clos par règle), P2 (strictement supérieur, ≥ 60 % en
  arithmétique entière exacte, ≥ 100 comparables), P3 (> 50 % strict par moitié,
  ≥ 100 comparables par moitié), ordre des raisons NON CONCLUANT, FAVORABLE = 5 blocs
  tenus ET ≥ 116 cellules ; fenêtre 2023-07-01 → 2026-10-08, 7 170 bougies
  recalculées, grille 4h, warmup 300, première décision 299, premier fill 300 ;
  moitiés (frontière, rangement par open du fill d'entrée, pic repris, premier
  rendement depuis le dernier point précédent) ; coûts x1/x2/x3 lus du manifeste et
  exécution sans coût pour le timing ; Sharpe (points ≥ debutEvaluationMs, √2191,5,
  n−1, indéfini si < 2 rendements ou écart-type nul) ; timing (mulberry32 standard,
  graine 20261008, 1999 tirages, k = ⌊L(0,1 + 0,8u)⌋, même k pour toutes les
  cellules via L minimal, p = (1 + #≥obs)/(tirages + 1), statistique
  ln(open[i+2]/open[i+1]) et ln(close/open) en dernière décision) ; tolérances
  (bords 24 h, ≤ 1 % manquantes écartées comprises, bougie en formation exclue,
  grille, croissance stricte, closeTime), pagination 1 000 avec page courte
  redemandée, reprises [1, 2, 4, 8, 16] s sur réseau/418/429/5xx avec Retry-After,
  −1121 → indisponible, délai 30 s, débit 4 800, parallélisme 4, cache gzip avec
  empreinte revérifiée à la relecture, acquisition complète avant toute mesure.
- **B. Indépendance** : `--campagne` lit `symboles.liste` seulement ; `--essai`
  lit `repetitionTechnique.symboles` (garde explicite ligne 1803 et disjonction
  vérifiée ligne 253) ; `--banc` revient avant `verifierFigeage` et toute
  acquisition ; en campagne, `EcartControle` ne porte que la cellule et le contrôle
  (ligne 613), la trace d'arrêt ne contient aucune valeur, aucun rapport n'est écrit
  avant le verdict.
- **C. Figeage** : hash du manifeste comparé avant `JSON.parse` (lignes 172-185),
  campagne refusée si `A_FIGER` ; `figeLeUtc` ISO UTC passée exigée ; fichiers
  figés, arbre (247 fichiers), `pnpm-lock`, version de Bun et
  `git status --porcelain --untracked-files=all` sur les chemins mesurés, le tout
  avant le premier fetch ; répétition : avertissements seulement.
- **D. Sémantique du stop** : conforme à `signal.stop` point par point (cliquet,
  niveau d'entrée close − k × ATR, mise à jour sur clôture tenue, déclenchement sur
  le niveau des bougies ≤ i−1, « score » prioritaire, réarmement après stop et
  réentrée immédiate après score, décisions ≤ n−2, série absente à plat et à la
  sortie, ATR 14 Wilder). Aucun biais d'anticipation (perturbations). Identique à la
  variante `atr-suiveur-3` de l'explorateur (`positionsV3`, lignes 297-373).
- **E. Défauts du chart** : `stopAtr` défaut 0, 15e input borné [0, 20] ; textes 4h,
  sans unité et par unité identiques à HEAD à stopAtr = 0 ; `textesAxis(u)` à un
  argument compatible (défaut 0) ; suffixe « non mesuré (test du 8 octobre 2026 en
  cours) » seulement si stopAtr > 0 ; aucune promesse de performance.
- **F. Contrôles bloquants** : position v3 et v2 du registre = recalcul (chaque
  bougie), série `stop` = recalcul, v2 = `positionsAxis` avec raisons toutes
  « score », marqueurs/infobulles/étiquettes « Stop », causalité position ET stop sur
  préfixes 40/70/90 % jusqu'à l'avant-dernière bougie du préfixe, chronologie moteur
  = rejeu (entrées, sorties, fin-données), fills identiques aux quatre niveaux de
  coût, timing = somme des ln sans coût (≤ 1e-9), Sharpe par seconde méthode sur les
  trois premières cellules disponibles dans l'ordre du manifeste (≤ 1e-9), sorties
  v3 = raisons du calcul. Le banc tourne à chaque lancement.
- **G. Honnêteté** : `historique.choixV3` dit clairement le changement de règle
  après lecture et ses conséquences ; `repetitionAvantFigeage` consigne la lecture
  défavorable (1/8) sans modification ; `parametresNonAjustes` exact ; chiffres de
  l'exploration exacts sauf M3.
- **H. Suites** : textes FAVORABLE / DÉFAVORABLE / NON CONCLUANT rédigés d'avance,
  placeholders tous définis dans `communes.placeholders` ; `formuler()` remplit
  exactement les gabarits (le banc le vérifie texte par texte, y compris trois
  échecs joints par « ; » et chaque insuffisance) ; le préfixe littéral du texte
  FAVORABLE est égal à `TEXTE_BASE_4H` ; le défaut passe à 3 seulement en
  FAVORABLE.
- **I. Qualité** : tsc strict propre, banc 37, essai hors réseau déterministe,
  69 + 36 tests passés.

## Décision

**Figeage autorisé**, à la condition que les corrections 1 à 3 (texte du manifeste
uniquement) soient appliquées avant le commit de figeage. Ces corrections ne
touchent ni un seuil, ni une mesure, ni une suite, ni le code mesuré ; elles
rétablissent l'exactitude de l'historique et de l'indépendance déclarée. Aucune
nouvelle contre-revue n'est nécessaire si le diff du manifeste, hors remplissage
des placeholders `A_FIGER`, se limite aux corrections 1 à 3 et aux mineurs 4 à 10,
et si le diff du runner se limite à la ligne `HASH_MANIFESTE` ; toute autre
modification du runner ou de `stratAxis.ts` exige une contre-revue limitée au diff.

### Corrections exigées (avant le figeage)

1. **(M1)** `statutIndependance` : remplacer « hors échantillon en actifs ET en temps »
   par la formulation exacte (indépendance en actifs ; la première exécution de
   l'exploration et la répétition ont lu la période 2023-07 → 2026-10 sur les 8
   symboles vus) ; ajouter la puce correspondante dans `limitesConnues`.
2. **(M2)** OGUSDT, FIDAUSDT, TLMUSDT : les retirer du pool (151 symboles, règle et
   exclusions mises à jour) ou, à défaut, consigner explicitement leur lecture par
   le test de charge UT (1s à 1h, fenêtre 1h oct. 2023 → oct. 2026, aucune lecture
   de résultat) dans `statutIndependance` et `limitesConnues`. Le choix est celui
   du propriétaire ; il doit être écrit avant le figeage.
3. **(M3)** Corriger « environ la moitié des sorties par stop » (ligne 17) en
   « 81 % des sorties par stop (574 / 709) » et la parenthèse de la ligne 20.

### Corrections demandées (mineures, au figeage ou dans le commit qui suit)

4. **(m1)** Préciser le verdict d'application de `suites.communes.sansStop`.
5. **(m2)** Réserve d'interface (AVAXUSDT dans `MAJORS_VALIDATION`, 36 paires du pool
   visibles dans l'application) dans `statutIndependance`.
6. **(m3)** `limitesConnues` : taille fixe sans dimensionnement par le stop ;
   sélection après coup du multiplicateur et de la métrique (renvoi à `choixV3`).
7. **(m4)** Assertions de démarrage : pagination 1 000, parallélisme 4, préfixes
   40/70/90 %, `attentesS.length === tentativesParPage`, `premierJour ≥ 2020-01-01`.
8. **(m5)** Énumérer dans `descriptif` les mesures supplémentaires du runner (ou les
   retirer).
9. **(m6)** `controlesBloquants[0]` : « 120 signaux les plus récents, 10 dernières
   étiquettes ».
10. **(m7)** `signal.stop.serie` : niveau reporté sur la bougie en formation.

### À consigner après le figeage et après l'exécution

- SHA-256 final du manifeste et du runner, `figeLeUtc`, hash du commit de figeage ;
  diff du runner limité à `HASH_MANIFESTE` (r3).
- Après la campagne : `git show <commit>:scripts/valider-axis-v3.ts | sha256sum`,
  empreintes de `resultat-v3-2026-10-08.json` et `rapport-v3-2026-10-08.md`, absence
  de trace d'arrêt ou, le cas échéant, cause, correctif et revue avant toute relance.

## Contre-revue du diff (après corrections)

Date : 2026-10-08, 13:42-13:50 UTC. HEAD inchangé (`43988f4`). Lecture seule sur le
dépôt ; écriture limitée à `/tmp/axis-revue-v3/`.

### Périmètre et méthode

- Base de comparaison : les copies relues `/tmp/axis-revue-v3/manifeste-revu.json`
  (SHA-256 `349ac08f…c1ae`, vérifié) et `/tmp/axis-revue-v3/runner-revu.ts` (SHA-256
  `6b3e59bf…b4c8`, vérifié). Diffs régénérés par moi (`diff -u`) dans
  `/tmp/axis-revue-v3/manifeste.mien.diff` et `runner.mien.diff` : identiques, hors
  en-têtes, aux diffs fournis (`manifeste.diff` 139 lignes, `runner.diff` 37 lignes).
  Aucune modification hors des deux diffs.
- Comparaison structurelle du manifeste (aplatissement JSON) : seules les clés
  suivantes changent — `historique.explorationV3.lecture`,
  `historique.repetitionAvantFigeage`, `statutIndependance`, `limitesConnues[7..9]`
  (ajouts), `signal.stop.serie`, `symboles.regle`, `symboles.exclusionsNominatives.
  dejaVus[8..10]` (ajouts), `symboles.nombre`, `symboles.liste` (3 retraits),
  `fenetre.memeFenetrePourTous`, `mesures.controlesBloquants[0]`,
  `descriptif.supplementaires` (ajout), `suites.communes.sansStopApplication` (ajout).
  Aucun seuil (`criteres`), aucune mesure (`mesures` hors le libellé du contrôle 0),
  aucune suite (textes FAVORABLE / DEFAVORABLE / NON_CONCLUANT, `communes.sansStop`,
  placeholders) ni le `signal` (hors la phrase descriptive `serie`) ne changent.
- `stratAxis.ts` : SHA-256 `7c2d94d2…cfdc`, inchangé ; `stratAxis.test.ts`
  `6e42e6e3…8ebb` et `explorer-axis-v3.ts` `1acf00ee…c9a` inchangés.

### Vérification correction par correction

- **M1** (`statutIndependance`) : appliquée. « hors échantillon en actifs ET en
  temps » remplacé par « Indépendance en ACTIFS : entière. Indépendance en TEMPS :
  partielle seulement », avec renvois exacts à `premiereExecution`,
  `executionCoupee` et `repetitionAvantFigeage` ; puce `limitesConnues[9]`
  cohérente. Conforme aux faits établis en première revue.
- **M2** (OG / FIDA / TLM) : appliquée par retrait. Pool 151 symboles, 151 uniques,
  `nombre` = 151, aucun des trois présents, aucun ajout, ordre par `premierJour`
  conservé, `premierJour` min 2020-01-09 / max 2023-06-28 (tous dans
  [2020-01-01, 2023-06-30]), aucun jeton à levier, pool disjoint des exclusions ;
  les 8 symboles de `repetitionTechnique` restent dans `dejaVus`. La règle du pool
  nomme l'exclusion et son motif ; `memeFenetrePourTous` dit 151.
- **M3** : appliquée. « 81 % des sorties par stop (574 / 709 ; environ la moitié
  pour atr-suiveur-4) » et « (81 % en exploration avant 2023-07) » — recoupés avec
  `/tmp/axis-v3-explo/avant-2023-07/rapport.md` (l. 225-226 : atr-suiveur-3
  135 / 574, 81 % ; atr-suiveur-4 304 / 300, 50 %) et le rapport complet (81 % /
  50 %). Exact.
- **m1** (`sansStopApplication`) : appliquée ; cohérente avec `FAVORABLE.application`
  (défaut → 3) et `DEFAVORABLE/NON_CONCLUANT.application` (défaut reste 0) ; le
  runner contient bien l'assertion `textesAxis("4h", 0).signaux === TEXTE_BASE_4H`
  au démarrage (vérification du manifeste, déjà présente dans la version relue).
- **m2** (réserve d'interface) : appliquée ; `MAJORS_VALIDATION` est bien exporté par
  `apps/web/src/data/validationSignaux.ts:82` ; les 36 paires listées sont toutes
  dans le pool de 151 et correspondent à ma liste de première revue.
- **m3** (`limitesConnues`) : trois puces ajoutées ; « 1 000 USDT sur 10 000 »
  = `mesures.tailleFixeQuote` / `capitalInitialQuote` ; « 3, parmi 2 à 5 » =
  grille `atr-suiveur-k, k ∈ {2, 3, 4, 5}` de `explorer-axis-v3.ts:31,203`. Exact.
- **m4** (runner) : cinq assertions ajoutées, toutes satisfaites par le manifeste
  (`donnees.pagination` contient « pages de 1 000 klines » et `LIMITE_PAGE` = 1000 ;
  `donnees.parallelisme` contient « au plus 4 symboles téléchargés en parallèle » et
  `CONCURRENCE` = 4 ; contrôle de causalité avec « trois préfixes (40 %, 70 %, 90 %
  de la série) » et `COUPES_CAUSALITE` = 0.4, 0.7, 0.9 ; `attentesS` = [1, 2, 4, 8,
  16] pour `tentativesParPage` = 5, toutes finies et > 0 ; `premierJour` ≥
  2020-01-01 pour les 151). Deux champs `pagination` et `parallelisme` ajoutés à
  l'interface `Manifeste` ; ils existaient déjà dans le JSON. Aucune autre ligne du
  runner ne change (mesures, critères, verdict, rapport intacts).
- **m5** (`descriptif.supplementaires`) : appliquée ; chaque élément correspond à
  une sortie effective du runner (`fraisTotal` l. 888/929 ; `medianes` l. 1131 et
  1171-1175 ; Sharpe par coût dans la mesure de cellule ; `sommePnlPct`,
  `gagnants` l. 1123-1124 ; `medianeNulle`, `q95Nulle` l. 816/826) ; le p du test
  des signes n'est bien calculé que sur la fenêtre.
- **m6** (`controlesBloquants[0]`) : appliquée ; « 120 signaux les plus récents »
  = `MAX_SIGNAUX_AXIS` (`stratAxis.ts:131`), « 10 dernières étiquettes »
  = `MAX_LABELS_SORTIE` (`utils-fabrique-strategie.ts:82`). Exact.
- **m7** (`signal.stop.serie`) : appliquée ; décrit le report du niveau (non
  recalculé) sur la bougie en formation et sur une bougie tenue au score indéfini,
  conformément au code `calc` déjà relu.

### Exécutions

- `tsc --strict --noEmit` sur le runner : propre.
- `--banc` : 37 vérifications passées.
- `--essai` hors réseau (`unshare -rn`, caches E-* existants) : 8/8 cellules,
  contrôles bloquants passés, verdict NON_CONCLUANT, 2 s. Diff du rapport avec
  celui de la première revue : seulement le SHA-256 observé du manifeste, le SHA du
  runner, les horodatages et les trois puces ajoutées à `limitesConnues`. Toutes
  les mesures sont identiques (le manifeste et le runner corrigés ne changent aucun
  calcul).

### Constats de la contre-revue

Aucun bloquant, aucun majeur, aucun mineur nouveau.

- **r9** (remarque) — `symboles.regle` dit, pour OG / FIDA / TLM, « aucun résultat
  lu ». Le journal UT (l. 86-91) consigne que le test de charge a fait lire les
  taux de bougies à volume nul et le passage des contrôles bloquants sur 21
  cellules ; aucun chiffre de performance n'y figure, mais « aucun résultat lu »
  est plus fort que ce que le journal permet d'attester. Formulation plus sûre :
  « aucune mesure de performance lue (seuls les contrôles bloquants et les
  statistiques de volume ont été consultés, journal UT) ». Sans conséquence sur le
  test : les trois paires sont hors du pool.
- **r10** (remarque) — le commentaire ajouté dans le runner (« revue, constat m4 »)
  et la mention « retirées à la demande de la revue, constat M2 » dans la règle du
  pool renvoient à ce journal ; acceptable pour un manifeste de campagne, à
  condition que le journal soit bien commité au chemin déclaré
  (`versions.revue` : `scripts/axis/journal-revue-v3-2026-10-08.md`).

### Empreintes relues (contre-revue)

- `scripts/axis/manifeste-v3-2026-10-08.json` :
  `c1ef1bece8d582332604e5580b2fca416d506934c4f764e3e6ecd22af6bce1e5`
  (avant : `349ac08fb03928028213d0316d8c6292f986e096b0956eb1833a1897dbdcc1ae`)
- `scripts/valider-axis-v3.ts` :
  `e0747cae186888271b0ce53480c80f319edddf0538b42375991cbccd99c88f75`
  (avant : `6b3e59bf5eea7494f0da60ade02c3429b3db43d767d5e07376611a052183b4c8`)
- `packages/indicators/src/strategy/stratAxis.ts` :
  `7c2d94d2ce0a94c864830c1f73bda2a2cc901d2dfdf9e631eba4bc82532cfcdc` (inchangé)

### Décision finale

**Figeage autorisé.** Les corrections M1 à M3 et m1 à m7 sont appliquées fidèlement,
sans affirmation nouvelle inexacte (r9 est une nuance de formulation, non une
erreur de fait) ni modification d'un seuil, d'une mesure, d'une suite ou du code
mesuré. Le figeage peut porter sur le manifeste `c1ef1bec…e1e5` et le runner
`e0747cae…8f75` ; au figeage, seuls le remplacement des placeholders `A_FIGER` dans
le manifeste et la ligne `HASH_MANIFESTE` du runner doivent encore changer, ce qui
sera à consigner (empreintes finales, commit de figeage) sans nouvelle contre-revue.

## Figeage (orchestrateur, après la contre-revue)

- Remarque r9 appliquée avant le figeage : `symboles.regle` dit désormais « aucune
  mesure de performance lue » pour OG / FIDA / TLM (seul changement de texte après
  la contre-revue, hors placeholders).
- `figeLeUtc` : **2026-10-08T13:48:24Z**. Placeholders `A_FIGER` remplis par le
  script de figeage (graphe d'import réel via esbuild, même découpage que le
  figeage UT) : 15 fichiers dans `versions.codeAuFigeageSha256` (stratAxis, utils,
  utils-fabrique-strategie, engine, rsi, adx, macd, supertrend, cmf, ema, registry,
  index, backtest engine et types, types index ; `timeframes.ts` n'est plus importé
  par ce runner), arbre hors tests de `packages/{indicators,backtest,types}/src` :
  247 fichiers, `7f4eb89e6668733233d99f52298a237dcc7d2618475bb2586ff1a0209da067db`
  (identique à l'empreinte observée en revue), `pnpm-lock.yaml`
  `130d4fb62f5223486552e31137f28d4901e098bf7a78325b943f30fc6beac062`, Bun 1.4.2,
  `baseCommit` 43988f4f21f30594f8623cabb0b99c4098ac71a8.
- Empreintes finales : manifeste
  `8131e23b9b583a9d5c8f8eaa2ba699723359930e35b1cb870674ac146067e26c` (épinglé dans
  `HASH_MANIFESTE`), runner
  `1b45e0ec6f7e212503e6a54fc5669ac882b5a1e62838253d69182a3b5e596467`. Diff du runner
  depuis la contre-revue limité à la ligne `HASH_MANIFESTE` (vérifié : le runner
  figé, avec `A_FIGER` remis à la place du hash, redonne `e0747cae…8f75`).
  `stratAxis.ts` inchangé (`7c2d94d2…cfdc`).
- Refus de campagne vérifié avant le commit de figeage : `--campagne` s'arrête dans
  `verifierFigeage` sur « chemins mesurés non commités : stratAxis.ts,
  stratAxis.test.ts, manifeste, runner — campagne refusée », aucun cache `H-*` créé.
- Commit de figeage : son SHA-1 ne peut pas figurer ici (le journal en fait
  partie) ; le résultat de la campagne le reporte (`code.commitFigeage`) et la
  documentation le cite.
