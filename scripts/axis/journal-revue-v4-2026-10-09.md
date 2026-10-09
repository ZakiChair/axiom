# Journal de revue — AXIS v4 (filtre ADX 14 ≥ 25 à l'entrée), 9 octobre 2026

Revue indépendante du protocole, du runner et du filtre dans `stratAxis` AVANT le
figeage et avant toute lecture des données de test (règle du projet : « Backtest /
math / drawdown / expectancy → Réviseur »). Le réviseur (agent séparé) n'a pas écrit
ce code. Revue menée de 09:22 à 09:45 UTC, dépôt `/home/factory-user/repos/axiom`,
HEAD `db5689b88d465bf37a4370197c948bf8d7c08dbb` (exploration v4 commitée), arbre de
travail contenant le manifeste, le runner et le filtre dans `stratAxis` et son test
(non commités, attendu avant figeage) ; aucun autre chemin modifié.

Méthodes : lecture du manifeste (772 lignes), du runner (1 989 lignes), du diff de
`stratAxis.ts` et de son test contre HEAD, du moteur (`packages/backtest/src/engine.ts`),
de `adxOf`/`rma`/`trueRange`, de l'explorateur v4 (règle, grille, `tendanceDe`) et de
son rapport ; `tsc --strict` du runner ; `--banc` ; `--essai` rejoué HORS RÉSEAU
(`unshare -rn`) depuis les 8 caches `E-*` déjà présents et comparé aux sorties de
l'auteur ; tests indicateurs et tests web AXIS ; graphe d'imports réel du runner
(esbuild) comparé aux fichiers figés ; cinq scripts de vérification indépendants
écrits dans `/tmp/axis-revue-v4/` (recalcul Python du Sharpe, des moitiés, des parts
et de l'ADX depuis les trades et les closes ; lecture naïve du manifeste comparée à
`positionsAxis` et au chart sur 300 séries aléatoires et sur les 8 séries réelles,
avec perturbations ; comparaison au caractère près de `calc()` à `adxEntree = 0`
contre la v2 de HEAD ; pool contre tous les manifestes, résultats et caches du dépôt
et contre la sonde ; 17 copies cassées du runner pour éprouver chaque contrôle
bloquant et les refus de campagne). Aucune requête vers Binance, aucun symbole du
pool lu, aucun cache `H-*` écrit (vérifié avant, pendant et après), aucun fichier
du dépôt modifié par le réviseur hormis ce journal.

## Empreintes (telles que lues, `sha256sum`)

| Fichier | SHA-256 |
|---|---|
| `scripts/axis/manifeste-v4-2026-10-09.json` (candidat, `figeLeUtc` et `versions` = `A_FIGER`) | `199ecdc6efa785d02f10f8b60ad722de6ad295583a5c645a57075a1d19c9c094` |
| `scripts/valider-axis-v4.ts` (`HASH_MANIFESTE = "A_FIGER"`) | `de5ae1aa5f89e61969dfaf00ffa5c8c992675874a35be9195472a4436ac11490` |
| `packages/indicators/src/strategy/stratAxis.ts` (arbre de travail, filtre ajouté) | `f6e1e3429fefd5ebce7dc46fb13b3bee034279f6050fe86fdb42aaaa23e0121b` |
| `packages/indicators/src/strategy/stratAxis.ts` (HEAD, v2 livrée ; blob `e904e850`) | `67494c337d2c225d81d8a24468186b03854199fd7aa7ad3781ab80aace0c79f0` |
| `packages/indicators/src/strategy/stratAxis.test.ts` | `d6fea2ee7faeee602db6f59a03692d51c3cbc396f59176b38e75de3ab86612d6` |
| `scripts/explorer-axis-v4.ts` (commité) | `4015db4dbb1900f0f1677efa2b8040c21adf325882eb72e8d5078c9cdbffba8b` |
| `scripts/axis/rapport-explo-v4-2026-10-09.md` (commité) | `a65a6a3e4375996a946ff2d7354c5fcb626bf9b98aee54b160fb1da68c91a58b` |
| `packages/backtest/src/engine.ts` | `4b1baadc37494b10537818259bc94e0c7b334794d272b3efbc295b2af8011d9d` |
| `packages/indicators/src/utils.ts` | `693259721a342f3adf0c897b5e279a9f6e9eb81bdb6d134449c3d19723c5266b` |
| `packages/indicators/src/trend/adx.ts` | `c1704f2e876995c75d54fa572a9f691b944d107cf179fdc024b5ec0629fba6df` |
| `packages/indicators/src/timeframes.ts` (voir m2) | `46f5435a7601a724f9f7a782570bc30d44e1a8789e188ae2e244c8748d5d11dd` |
| `pnpm-lock.yaml` | `130d4fb62f5223486552e31137f28d4901e098bf7a78325b943f30fc6beac062` |
| Arbre hors tests de `packages/{indicators,backtest,types}/src` (observé par le runner) | 247 fichiers, `b1703fb8cf8fd6514326485021ef1169114036d5a28bcfc1abf7b25f1c218a38` |
| Sorties de l'essai de l'auteur (`/tmp/axis-v4-essai/`, 09:18 UTC) : rapport / résultat | `006972a3…` / `1b80c131…` (copiées dans `/tmp/axis-revue-v4/essai-auteur/`) |

Le SHA-256 du runner changera au figeage (ligne `HASH_MANIFESTE`, l. 84) : le SHA
final doit être reporté ici, et le diff du runner entre les deux empreintes doit se
limiter à cette ligne (remarque r4). Le manifeste a déjà changé entre l'essai de
l'auteur et cette revue (remarque r3).

## Vérifications exécutées

- `tsc --noEmit --strict --noUncheckedIndexedAccess …` sur le runner : propre (1,9 s).
- `bun scripts/valider-axis-v4.ts --banc` : 39 vérifications passées, aucune donnée
  lue (avertissement « manifeste non figé », attendu).
- `unshare -rn bun scripts/valider-axis-v4.ts --essai` (réseau coupé, 09:24:03 →
  09:24:05 UTC) : 8/8 cellules de 7 176 bougies depuis
  `scripts/.cache-klines/axis-v4/E-*.json.gz`, contrôles bloquants passés (seconde
  méthode du Sharpe sur 3 cellules comprise), verdict NON_CONCLUANT (8 comparables),
  2 s ; rapport identique au rapport de l'auteur sauf deux lignes : le SHA-256
  observé du manifeste (r3) et l'horodatage — toutes les mesures identiques
  (déterminisme) ; aucun fichier `H-*` créé.
- `vitest run src/strategy/stratAxis.test.ts` : 81 tests passés ; paquet
  `indicators` complet : 452 fichiers, 2 008 tests passés ; `apps/web`
  `indicators.axisStop.test.ts`, `indicators.axisUnites.test.ts`,
  `indicators.aux.test.ts` : 46 passés ; `lib/indicatorUsability.test.ts` : 30
  passés. Aucun fichier de `apps/` ni `shared/` ne nomme `adxEntree` : le chart
  calcule au défaut 0.
- `/tmp/axis-revue-v4/graphe.mjs` (esbuild, métafichier) : 234 fichiers de
  `packages/` dans le graphe d'exécution du runner ; le graphe restreint (arrêt sur
  `index.ts`/`registry.ts`) est entièrement couvert par les 15 `FICHIERS_FIGES`
  (`scripts/valider-axis-v4.ts:94-110`) ; `backtest/src/types.ts` et
  `types/src/index.ts` ne sont importés que pour leurs types. Un fichier est importé
  au runtime et n'est pas dans les 15 : `packages/indicators/src/timeframes.ts`
  (m2) ; il est couvert par l'empreinte de l'arbre (247 fichiers).
- `/tmp/axis-revue-v4/verif-sharpe.py` : depuis `tradesX1` du résultat d'essai et
  les closes du cache, recalcul Python (code indépendant) de l'equity par clôture
  (capital réalisé + latent − frais d'entrée), du Sharpe par bougie (× √2191,5, n−1),
  du drawdown, du PnL et de l'expectancy sur la fenêtre et sur chaque moitié, pour
  v4, v2 et EMA sur les 8 cellules ; x3 rejoué depuis les opens ; ADX 14 de Wilder
  recalculé à la main pour compter les entrées v2 refusées : 5 585 vérifications,
  écart maximal 2,7e-12 ; v4 305 trades (305 clos), expectancy 4,383 % (x1) et
  4,095 % (x3), PnL moyen 16,71 % ; v2 393/393, 3,539 / 3,253, 17,39 % ; EMA 955
  (954 clos, 1 fin de données) ; parts v4 > v2 : Sharpe 4/8, moitiés 4/8 et 5/8,
  drawdown plus faible 5/8 ; 266/393 entrées refusées par l'ADX : identiques au
  résultat du runner et à `historique.repetitionAvantFigeage`. Frontière des moitiés
  = open de l'indice 300 + ⌊(n − 300)/2⌋ ; décisions ≤ n−2 ; seconde méthode du
  Sharpe du runner reproduite.
- `/tmp/axis-revue-v4/verif-filtre.ts` (hors réseau) : 1 126 763 vérifications.
  (1) Implémentation naïve écrite depuis `signal.entree` du manifeste (ADX indéfini
  = faux, armement sur la condition complète, sorties v2) comparée au chart
  (`computeIndicator(stratAxis)`) et à `positionsAxis` sur 300 séries aléatoires ×
  EMA 50/200 × k ∈ {0, 20, 25, 30, 80} (3 000 comparaisons, 4 855 entrées) et sur
  les 8 séries réelles × 6 réglages : identiques bougie par bougie. (2) Sur les
  séries réelles : 306 entrées v4 ont toutes ADX ≥ 25 et la condition v2 ; 266 des
  393 entrées v2 (après warmup) sont refusées ; les sorties v4 sont toutes « score ».
  (3) 96 perturbations (bougie i, i+1, préfixe tronqué) : positions avant i
  inchangées, aucune anticipation. (4) ADX recalculé à la main (DI dès l'indice 14,
  DX lissé Wilder, premier ADX à l'indice 27) = `adxOf` sur toutes les bougies.
- `/tmp/axis-revue-v4/verif-v2-exacte.ts` : `calc()` de la v4 à `adxEntree = 0`
  (explicite et absent) comparé à la v2 LIVRÉE (`git show HEAD:…stratAxis.ts`, SHA
  `67494c33…`, copie `/tmp/axis-revue-v4/stratAxis.HEAD.ts`) sur les 8 séries
  réelles, 3 longueurs, 7 réglages (dont `filtreFlux`, EMA 50, seuils 4/3,
  `stopAtr` 3), 4 unités de contexte : 1 344 comparaisons identiques au caractère
  près (toutes séries, 49 316 marqueurs, étiquettes) ; 15 premiers `inputs` = HEAD,
  16e = `adxEntree` {défaut 0, [0, 100]} ; `textesAxis` sur 21 unités : (u), (u, 0),
  (u, 0, 0), (u, 3), (u, 3, 0), (u, 2) = HEAD ; (u, 0, 25) = base + « ; filtre ADX
  14 ≥ 25 à l'entrée : non mesuré (test du 9 octobre 2026 en cours) » ; (u, 3, 25)
  = filtre puis stop ; 2 231 vérifications.
- `/tmp/axis-revue-v4/verif-pool.py` : 123 symboles uniques, `premierJour` de
  2023-07-03 à 2025-06-26 (dans [2023-07-01, 2025-06-30]), tri cotation puis
  symbole, 16 / 56 / 51 par année = `parAnneeDeCotation`, 6 exclusions nominatives
  dans la fenêtre (+ 123 = 129, comme `symboles.regle`), le motif des jetons à
  levier attrape bien JUP et SYRUP (gardés à raison) ; 10 manifestes et résultats
  antérieurs lus : 205 symboles textuels (204 téléchargés + WBTCUSDT, jamais
  téléchargé) ; caches `scripts/.cache-klines/` : 839 fichiers, 201 symboles ; pool
  ∩ caches = ∅, pool ∩ symboles lus = ∅, pool ∩ 159 séries de l'exploration = ∅,
  prédécesseurs renommés (MATIC, FTM, EOS, RNDR, KLAY, ORN, GAL, BNX, MC) absents
  des symboles lus ; `pool-final.json.liste` de la sonde (`/tmp/axis-v4-pool/`,
  08:51:23 → 08:51:30 UTC, 506 paires, 129 dans la fenêtre) = `symboles.liste` ;
  les 204 symboles touchés sont tous dans l'inventaire de la sonde et tous cotés
  avant le 2023-07-01 ; `sonde.ts` ne conserve que l'open time de la première kline
  journalière (r5). Aucun cache `H-*` dans `axis-v4/` (8 `E-*`), aucun lien
  symbolique dans les trois dossiers figés, aucun fichier `skip-worktree` ou
  `assume-unchanged`, aucune copie temporaire du runner dans `scripts/`.
- `/tmp/axis-revue-v4/casser.py` : 17 copies du runner (imports absolus, sorties
  dans `/tmp/axis-revue-v4/casse/`), exécutées en `unshare -rn`. Témoin : exit 0,
  mêmes mesures. 13 copies cassées en `--essai` (ADX décalé d'une bougie, position
  du chart faussée, filtre ignoré, série `stop` définie, v2 au seuil 6, infobulle
  sans mention de l'ADX, préfixe divergent, rejeu amputé, fills dépendant du coût,
  statistique de timing faussée, frais d'entrée omis dans la seconde méthode,
  compte des trades faussé) : chacune s'arrête sur le contrôle visé (exit 1, « écart
  de contrôle », trace `arret-v4-*.json` avec cellule et contrôle), aucun rapport ni
  résultat écrit. Copie `ESSAI = false` + ADX décalé : le message ne porte que
  « BTCUSDT : contrôle « position v4 = recalcul » en écart », aucune valeur. Trois
  copies en `--campagne` : `HASH_MANIFESTE` faux → refus au chargement
  (« manifeste modifié … Aucun calcul autorisé ») ; `A_FIGER` → refus au chargement ;
  hash exact mais `figeLeUtc = A_FIGER` → refus dans `verifierFigeage` après le banc
  (« figeLeUtc absent, invalide ou futur … campagne refusée »), avant tout fetch.
  Cache `axis-v4/` inchangé après les 17 exécutions, `git status` inchangé.
- Chiffres de `historique` recoupés : `explorationV4.resultat` avec
  `scripts/axis/rapport-explo-v4-2026-10-09.md` (adx-25 94/151 = 62,3 %, moitiés
  79 et 92/151, panel B 2/8 XRP et SOL, PnL moyen des 8 : 60,9 → 53,9 %, agrégats
  v2 6 320 / 1,52 / 1,24 / 6,4 / 15,4 / 0,19 / 30,5 et adx-25 4 991 / 2,07 / 1,79 /
  6,9 / 13,3 / 0,21 / 25,2, 78,9 %, classement des 11 éligibles, flux-fort 45,9 %
  → « 46 % », métrique descriptive 102/151, 90 / 82, 6/8) : exacts ;
  `historique.v3` avec `resultat-v3-2026-10-08.json` (62/151 = 41 %, 57 et 78/151
  = 37 % puis 51 %, drawdown 125/151 = 82 %, PnL moyen 3,8 contre 6,4) : exact ;
  `repetitionAvantFigeage` : exact (voir `verif-sharpe.py`) ; fenêtres : SAHARA
  (2025-06-26) 2 820 créneaux 4h, PENDLE (2023-07-03) 7 164 (« 7 160 environ »),
  15 à 39 mois : exact.

## Constats

Gravités : **B** bloquant, **M** majeur (à corriger avant le figeage), **m** mineur,
**r** remarque.

### Bloquants

Aucun.

### Majeurs

Aucun.

### Mineurs

**m1 — `statutIndependance` : « 37 paires du pool apparaissent dans … l'application »
en compte une de trop.**
`scripts/axis/manifeste-v4-2026-10-09.json:24` liste 37 symboles dont « S ». Or
`SUSDT` n'apparaît nulle part dans `apps/` ni `shared/` (`rg -w SUSDT` : 0) ; la
seule chaîne contenant « SUSDT » est `CARDSUSDT` (188 occurrences) et `AXSUSDT`
(1) : faux positif d'une recherche par sous-chaîne. Les 36 autres sont bien
présentes (dont `AUSDT` 15 occurrences et `WUSDT` 1). Correction : « 36 paires » et
retirer « S » de la liste.

**m2 — `packages/indicators/src/timeframes.ts` est importé au runtime et n'est pas
dans les fichiers figés nommément.**
`packages/backtest/src/engine.ts` importe `supportsIndicatorTimeframe` et
`TIMEFRAME_REQUIS` depuis `@axiom/indicators` (`raisonTimeframeBacktest`) ; esbuild
les résout dans `timeframes.ts`, qui n'est ni dans `FICHIERS_FIGES`
(`scripts/valider-axis-v4.ts:94-110`) ni dans la description de `codeFigeNote`
(`manifeste:767`). Le fichier est couvert par l'empreinte de l'arbre (247 fichiers)
et n'affecte aucun calcul (il n'autorise que l'unité 4h) : aucun risque pour le
test. Le journal v3 affirmait « `timeframes.ts` n'est plus importé par ce runner » :
inexact. Correction : l'ajouter aux fichiers figés (16) ou, si le script de figeage
reprend le même graphe, écrire dans `codeFigeNote` que les dépendances de
`backtest/engine.ts` hors graphe nommé sont couvertes par l'arbre.

**m3 — Deux faits du pool ne sont pas recoupés par le runner.**
`verifierManifeste` (`scripts/valider-axis-v4.ts:286-304`) vérifie le nombre,
l'unicité, les bornes `COTATION_MIN`/`COTATION_MAX`, la longueur minimale et le tri,
mais pas `symboles.parAnneeDeCotation` (16 / 56 / 51, `manifeste:99`) contre la
liste, ni que les dates de `symboles.regle` (« 2023-07-01 et le 2025-06-30 »,
`manifeste:84`) sont celles des constantes du code ; l'interface `Manifeste` ignore
ces deux clés. Vérifiés exacts ici par script. Correction : deux assertions au
démarrage, sur le modèle de `chiffre()`.

### Remarques (sans correction exigée)

**r1 —** Un échec mesuré l'emporte sur une insuffisance de cellules (`juger`,
`scripts/valider-axis-v4.ts:1403` ; banc « échec + insuffisance ») : un échec de
P1 avec, par exemple, 60 cellules disponibles sur 123 donnerait DÉFAVORABLE sur un
échantillon non représentatif. Pré-déclaré dans `criteres.verdict` ; le
propriétaire doit le savoir (même remarque qu'en v3).

**r2 —** En campagne, la progression affiche le nombre de séries exploitables
avant le verdict (l. 1914-1916) : pas une valeur mesurée. Acceptable.

**r3 —** Le manifeste a été modifié après l'essai de l'auteur : son rapport épingle
`e3fcaef80cd554330d3caabdb75d370e222800c6286a3cc4400aed73333b6b11`, la version
relue vaut `199ecdc6…` (ajout de `historique.repetitionAvantFigeage`, dont les
chiffres sont ceux de l'essai, vérifiés). L'essai rejoué sur la version relue donne
des mesures identiques : aucune incidence. La séquence attendue au figeage est donc
: corrections m1-m3 → figeage des placeholders → `HASH_MANIFESTE` → commit.

**r4 —** Le runner n'est pas dans `codeAuFigeageSha256` et son SHA change au
figeage (`HASH_MANIFESTE`). Après le commit de figeage : consigner le SHA final ici,
vérifier que `git diff` entre le runner revu (`de5ae1aa…`) et le runner figé se
limite à cette ligne, et après la campagne que `git show <commit>:scripts/valider-
axis-v4.ts | sha256sum` le redonne.

**r5 —** `statutIndependance` dit de la sonde « seul l'open time conservé, aucun
prix lu ni gardé ». La requête `klines?interval=1d&limit=1` renvoie une bougie
complète (OHLC du premier jour) ; `sonde.ts` n'en conserve que l'open time. « Aucun
prix conservé » est exact ; « aucun prix lu » est un peu fort pour une bougie
journalière du premier jour de cotation, sans incidence sur un test 4h commençant
300 bougies plus tard. Formulation plus sûre : « seul l'open time conservé (la
première kline journalière est reçue, aucun prix gardé) ».

**r6 —** `suites.communes.testCroise` (`manifeste:744`) nomme
`apps/web/src/chart/indicators.axisAdx.test.ts`, qui n'existe pas encore : c'est le
test à écrire après la campagne, sur le modèle de `indicators.axisStop.test.ts`
(qui épingle bien le SHA-256 de `resultat-v3-2026-10-08.json`, l. 18 et 55). Le
manifeste v3 nommait `indicators.axisUnites.test.ts` et le fichier créé s'appelle
`axisStop` : le nom annoncé ici doit être celui du fichier réellement créé.

**r7 —** `empreinteArbre` (l. 1829-1841) suit les liens symboliques
(`statSync`/`readFileSync`) et `etatGit` (l. 1843-1849) ne voit pas un fichier marqué
`skip-worktree` ou `assume-unchanged` : limites connues de la vérification du
figeage, sans objet aujourd'hui (aucun lien, aucun drapeau : vérifié). Reprendre la
même vérification dans le journal après le figeage.

**r8 —** Les messages d'écart en mode essai contiennent des valeurs (positions,
dates, écarts numériques) : utile pour le diagnostic, et le mode campagne les
retire bien (`EcartControle`, l. 666 ; vérifié par la copie `ESSAI = false`). Le DD
« plus faible » et le PnL « ≥ » des parts descriptives ne sont pas des critères.

## Vérifié correct (RAS)

- **A. Fidélité manifeste ↔ runner** : P1 (expectancy regroupée `pnlPct`, fin de
  données comprise, x1 ET x3, ≥ 100 trades clos v4), P2 (strictement supérieur,
  ≥ 60 % en arithmétique entière exacte, ≥ 80 comparables), P3 (> 50 % strict par
  moitié, ≥ 80 comparables par moitié), ordre des raisons NON CONCLUANT (cellules,
  comparables, moitié, trades), FAVORABLE = 5 blocs tenus ET ≥ 93 cellules (75 % de
  123, arrondi vers le haut) ; `minDisponibles` recalculé ; fenêtre par cellule du
  00:00 UTC du premier jour de cotation au 2026-10-09 exclu, ≥ 2 400 bougies, grille
  4h, warmup 300, première décision 299, premier fill 300 ; moitiés (frontière au
  milieu des décisions évaluées, rangement par open du fill d'entrée, pic repris,
  premier rendement depuis le dernier point précédent) ; coûts x1/x2/x3 lus du
  manifeste, exécution sans coût pour le timing ; Sharpe (points ≥
  debutEvaluationMs, √2191,5, n−1, indéfini si < 2 rendements ou écart-type nul ;
  Sharpe v4 indéfini compté non supérieur, dénominateur = Sharpe v2 défini) ; timing
  (mulberry32, graine 20261009, 1999 tirages, k = ⌊L(0,1 + 0,8u)⌋ commun à toutes
  les cellules via L minimal, p = (1 + #≥obs)/(tirages + 1)) ; tolérances (bords
  24 h, ≤ 1 % manquantes écartées comprises, bougie en formation exclue, grille,
  croissance stricte) ; pagination 1 000, reprises, −1121 → indisponible, débit
  4 800, parallélisme 4, cache gzip E-/H- avec empreinte revérifiée, acquisition
  complète avant toute mesure ; constantes recoupées avec la prose (`chiffre()`,
  l. 266-285, dont pagination, parallélisme, préfixes, `attentesS`) ;
  `textesAxis("4h", 0, 0)` et sans unité = `TEXTE_BASE_4H` au démarrage (l. 307-310).
- **B. Indépendance** : `--campagne` lit `symboles.liste` seulement ; `--essai` lit
  `repetitionTechnique.symboles` (garde explicite l. 1911 et disjonction vérifiée
  l. 291) ; `--banc` revient avant `verifierFigeage` et toute acquisition ; en
  campagne, `EcartControle` ne porte que la cellule et le contrôle, la trace
  d'arrêt ne contient aucune valeur, aucun rapport n'est écrit avant le verdict
  (éprouvé par `casser.py`). Pool : 123 paires cotées 2023-07-03 → 2025-06-26,
  jamais téléchargées ni nommées par aucune campagne, exploration ou cache du dépôt
  ; les 204 symboles touchés sont tous cotés avant le 2023-07-01 ; prédécesseurs
  des jetons renommés jamais lus ; `MAJORS_VALIDATION`
  (`apps/web/src/data/validationSignaux.ts:82-85`) sans symbole du pool.
  Indépendance en temps partielle, dite telle quelle (`statutIndependance`,
  `limitesConnues[10]`).
- **C. Figeage** : hash du manifeste comparé avant `JSON.parse` (l. 197-206),
  campagne refusée si `A_FIGER` ou hash différent ; `figeLeUtc` ISO UTC passée
  exigée ; fichiers figés, arbre (247 fichiers), `pnpm-lock`, version de Bun et
  `git status --porcelain --untracked-files=all` sur les chemins mesurés, le tout
  avant le premier fetch ; répétition : avertissements seulement. Les trois refus
  de campagne ont été exercés (hash faux, `A_FIGER`, figeage absent).
- **D. Sémantique du filtre** : conforme à `signal.entree` point par point (ADX 14
  de Wilder, le même que le vote DMI ; ADX indéfini = condition fausse ; armement
  sur la condition complète, un refus par l'ADX arme ; sorties v2 inchangées,
  aucune série `stop` ; décisions ≤ n−2 ; bougie au score indéfini = report).
  Identique à la variante `adx-25` de l'explorateur (`tendanceDe`, filtre indéfini
  = faux). Aucun biais d'anticipation (perturbations). Position du chart =
  `positionsAxis` = implémentation naïve sur 3 000 séries aléatoires et 8 réelles.
- **E. Défauts du chart** : `adxEntree` défaut 0, 16e input borné [0, 100]
  (`stratAxis.ts:579`) ; à 0 la v4 est la v2 de HEAD au caractère près (séries,
  marqueurs, étiquettes, métadonnées, textes 4h, sans unité et par unité, avec ou
  sans stop) ; suffixe « non mesuré (test du 9 octobre 2026 en cours) » seulement
  si `adxEntree > 0` (l. 494-508) ; ordre filtre puis stop ; `RESERVE_FILTRE`
  prioritaire (l. 624) ; infobulle d'achat v4 citant « ADX 14 x ≥ 25 » (l. 652) ;
  aucune promesse de performance.
- **F. Contrôles bloquants** : position v4 et v2 du registre = recalcul (chaque
  bougie), série `stop` indéfinie, v2 = `positionsAxis` à `adxEntree` 0, entrées v4
  à ADX ≥ 25 et dans la condition v2, marqueurs/étiquettes/infobulles (mention de
  l'ADX dans les achats v4 seulement), causalité sur préfixes 40/70/90 %,
  chronologie moteur = rejeu, fills identiques aux quatre niveaux de coût, timing =
  somme des ln sans coût, Sharpe par seconde méthode sur les trois premières
  cellules disponibles dans l'ordre du manifeste. Chacun est réellement faillible
  (13 copies cassées, chacune arrêtée sur le contrôle visé). Le banc tourne à
  chaque lancement (39 vérifications).
- **G. Honnêteté** : `historique.choixV4` dit clairement que la règle pré-écrite
  n'a retenu aucune variante et que la condition « 5 grandes cryptos sur 8 » a été
  levée après coup par le propriétaire ; `repetitionAvantFigeage` consigne la
  lecture (4/8, NON_CONCLUANT) sans modification ; `parametresNonAjustes` exact
  (25 parmi 25 et 30) ; chiffres de l'exploration, de la v3 et de l'essai exacts ;
  `limitesConnues` reprend la taille fixe, la sélection en échantillon, le degré de
  liberté, l'indépendance temporelle partielle, le biais de survie, les paires
  jeunes et le facteur de marché commun.
- **H. Suites** : textes FAVORABLE / DÉFAVORABLE / NON CONCLUANT rédigés d'avance,
  placeholders tous définis dans `communes.placeholders` ; `formuler()` remplit
  exactement les gabarits (banc texte par texte, trois échecs joints par « ; »,
  chaque insuffisance) ; `sansFiltreApplication` fixe le verdict d'application et
  l'invariance au caractère près à `adxEntree = 0` (vérifiée) ; le défaut passe à
  25 seulement en FAVORABLE ; seuls `{texteBase}`, `{k}`, `{texteUnite}`, `{u}`
  restent dans les modèles destinés au chart.
- **I. Qualité** : tsc strict propre, banc 39, essai hors réseau déterministe,
  81 + 2 008 (paquet) + 46 + 30 tests passés, 17 copies cassées conformes.

## Décision

**Figeage autorisé**, à la condition que les corrections 1 à 3 (texte du manifeste
et deux assertions du runner) soient appliquées avant le commit de figeage. Elles ne
touchent ni un seuil, ni une mesure, ni une suite, ni le code mesuré ; elles
rétablissent l'exactitude d'un compte d'interface, la complétude de la description
du figeage et deux recoupements. Aucune contre-revue n'est nécessaire si le diff du
manifeste, hors remplissage des placeholders `A_FIGER`, se limite aux corrections
1 à 3 et aux remarques r5-r6, et si le diff du runner se limite aux deux assertions
de m3 (et, s'il est retenu, à l'ajout de `timeframes.ts` dans `FICHIERS_FIGES`)
puis à la ligne `HASH_MANIFESTE` ; toute autre modification du runner ou de
`stratAxis.ts` exige une contre-revue limitée au diff.

### Corrections demandées (avant le figeage)

1. **(m1)** `statutIndependance` : « 36 paires » et retirer « S » de la liste.
2. **(m2)** Ajouter `packages/indicators/src/timeframes.ts` aux fichiers figés, ou
   dire dans `codeFigeNote` que les dépendances de `backtest/engine.ts` hors graphe
   nommé sont couvertes par l'empreinte de l'arbre.
3. **(m3)** Deux assertions au démarrage : `parAnneeDeCotation` recalculé depuis la
   liste ; dates de `symboles.regle` = `COTATION_MIN` / `COTATION_MAX`.

### Remarques à prendre en compte si le texte est repris

4. **(r5)** Sonde : « seul l'open time conservé (la première kline journalière est
   reçue, aucun prix gardé) ».
5. **(r6)** Nom du test croisé = nom du fichier qui sera créé.

### À consigner après le figeage et après l'exécution

- SHA-256 final du manifeste et du runner, `figeLeUtc`, `HASH_MANIFESTE`, hash du
  commit de figeage ; diff du runner limité aux lignes annoncées (r4) ; vérification
  que le runner figé, avec `A_FIGER` remis à la place du hash, redonne le SHA du
  runner relu (ou celui de la version corrigée m3) ; absence de lien symbolique et
  de drapeau `skip-worktree` dans les dossiers figés (r7).
- Après la campagne : `git show <commit>:scripts/valider-axis-v4.ts | sha256sum`,
  empreintes de `resultat-v4-2026-10-09.json` et `rapport-v4-2026-10-09.md`, absence
  de trace d'arrêt ou, le cas échéant, cause, correctif et revue avant toute relance.

## Corrections et figeage (orchestrateur, après la revue)

Date : 2026-10-09, 09:46-09:52 UTC. HEAD inchangé (`db5689b`). Aucune contre-revue
demandée par le réviseur si les diffs se limitent aux corrections 1 à 3, aux
remarques r5-r6 et à la ligne `HASH_MANIFESTE` : c'est le cas, vérifié ci-dessous.

### Corrections appliquées

- **m1** : `statutIndependance` dit « 36 paires » ; « S » retiré de la liste, avec la
  mention du faux positif.
- **m2** : `packages/indicators/src/timeframes.ts` ajouté à `FICHIERS_FIGES` (16
  fichiers) ; `versions.codeFigeNote` le dit (« et de ses dépendances (dont
  timeframes.ts …) : 16 fichiers »).
- **m3** : deux assertions au démarrage de `verifierManifeste` : `symboles.regle`
  contient « entre le 2023-07-01 et le 2025-06-30 inclus » (constantes
  `COTATION_MIN` / `COTATION_MAX`) ; `symboles.parAnneeDeCotation` recalculé depuis
  la liste (16 / 56 / 51), mêmes années et mêmes comptes. L'interface `Manifeste`
  reçoit `regle` et `parAnneeDeCotation`.
- **r5** : sonde : « seul l'open time conservé : la première kline journalière est
  reçue, aucun prix gardé ».
- **r6** : `testCroise` garde le nom `apps/web/src/chart/indicators.axisAdx.test.ts` ;
  c'est le nom que portera le fichier créé après la campagne.
- Diff du manifeste depuis la version relue (`199ecdc6…`) : `statutIndependance`
  (m1, r5) et `versions.codeFigeNote` (m2) seulement, hors placeholders. Diff du
  runner depuis la version relue (`de5ae1aa…`) : interface `Manifeste` (deux clés),
  `FICHIERS_FIGES` (une ligne et son commentaire), les deux assertions m3, puis la
  ligne `HASH_MANIFESTE`. Empreintes après corrections, avant figeage : manifeste
  `682eae165d9ee0fd38110b616f36b1047af1de8bc91963fa290b7bd771091cc9`, runner
  `e146fd87a59c6de3c9ea17fe662c4fb31b5e8751aad2ca31a015525aea201f9b`.
- Vérifications après corrections : tsc strict propre ; `--banc` 39 ; `--essai`
  hors réseau (`unshare -rn`) : 8/8 cellules, mesures identiques au rapport relu
  (seuls le SHA du manifeste, celui du runner et les horodatages changent).
- `stratAxis.ts` (`f6e1e342…121b`) et `stratAxis.test.ts` (`d6fea2ee…12d6`)
  inchangés depuis la revue.

### Figeage

- `figeLeUtc` : **2026-10-09T09:48:50Z**. Placeholders remplis par
  `/tmp/axis-v4-pool/figer.py` (hors dépôt) : `versions.codeAuFigeageSha256` = les 16
  fichiers de `FICHIERS_FIGES` lus dans le runner (stratAxis, utils,
  utils-fabrique-strategie, engine, rsi, adx, macd, supertrend, cmf, ema, registry,
  index, timeframes, backtest engine et types, types index) ; `versions.arbreCode` =
  arbre hors tests de `packages/{indicators,backtest,types}/src`, même algorithme
  que `empreinteArbre` : 247 fichiers,
  `b1703fb8cf8fd6514326485021ef1169114036d5a28bcfc1abf7b25f1c218a38` (identique à
  l'empreinte observée par le runner et par le réviseur) ; `pnpmLockSha256`
  `130d4fb62f5223486552e31137f28d4901e098bf7a78325b943f30fc6beac062`, Bun 1.4.2,
  `baseCommit` db5689b88d465bf37a4370197c948bf8d7c08dbb inchangés.
- Empreintes finales : manifeste
  **`694c9aaf26bdbce7208e6f063e2b410d36640a2b1d46cdb326ad7e50eaf2d36f`** (épinglé
  dans `HASH_MANIFESTE`), runner
  **`deb9893e2e6106963610b726b31d1c24302b164c2f4cab1b60ee0690b1f59a5b`**. Diff du
  runner depuis la version corrigée (`e146fd87…`) : la seule ligne 84,
  `const HASH_MANIFESTE: string = "694c9aaf…"` (l'annotation `: string` est ajoutée
  sur cette ligne pour que `tsc --strict` reste propre une fois le hash épinglé ; le
  runner v3 épinglé déclenche l'erreur TS2367 sur la comparaison à « A_FIGER », ce
  que ce runner évite). `stratAxis.ts` inchangé (`f6e1e342…121b`).
- Vérifications du figeage : tsc strict propre ; `--banc` 39 vérifications, aucun
  avertissement ; `--essai` hors réseau : seul avertissement « chemins mesurés non
  commités », mesures identiques ; refus de campagne vérifié hors réseau
  (`unshare -rn … --campagne`) : arrêt dans `verifierFigeage` sur « chemins mesurés
  non commités : stratAxis.test.ts, stratAxis.ts, manifeste, runner — campagne
  refusée », aucun cache `H-*` créé, rien d'écrit dans `scripts/axis/` ; aucun lien
  symbolique dans les trois dossiers figés, aucun drapeau `skip-worktree` ni
  `assume-unchanged` sur les chemins mesurés (r7).
- Commit de figeage : son SHA-1 ne peut pas figurer ici (le journal en fait
  partie) ; le résultat de la campagne le reporte (`code.commitFigeage`) et la
  documentation le cite.

## Après l'exécution (orchestrateur)

- Commit de figeage : `15cf8d0157a695e89f4b681ef6604e095bf2ab51` (ce journal, le
  manifeste, le runner, `stratAxis.ts` et ses tests). `git show
  15cf8d0:scripts/valider-axis-v4.ts | sha256sum` redonne `deb9893e…9a5b` et
  `git show 15cf8d0:scripts/axis/manifeste-v4-2026-10-09.json | sha256sum` redonne
  `694c9aaf…d36f` : le code exécuté est celui du figeage (r4).
- Campagne unique : `bun scripts/valider-axis-v4.ts --campagne`, 2026-10-09
  09:52:33 → 09:53:08 UTC (35 s), HEAD `15cf8d0`, arbre de travail propre sur les
  chemins mesurés (`code.cheminsFigesCommites` = true), code identique au figeage
  (`code.identiqueAuFigeage` = true, arbre 247 fichiers `b1703fb8…`), aucune trace
  d'arrêt (`arret-v4-*.json` absent de `scripts/axis/`), aucune relance.
- Données : 123 cellules sur 123 disponibles (minimum 93), longueurs de 2 817
  (SAHARAUSDT) à 7 162 bougies (PENDLEUSDT), 14 bougies manquantes et 3 écartées
  au total ; caches `H-*` : 123 fichiers dans `scripts/.cache-klines/axis-v4/`
  (hors dépôt).
- Contrôles bloquants : tous passés sur les 123 cellules (seconde méthode du Sharpe
  sur PENDLE, ARKM et WLD, les trois premières de l'ordre du manifeste).
- Verdict pré-déclaré : **DÉFAVORABLE**. P1 x1 : expectancy nette −1,780 % par trade
  sur 2 515 trades clos (échec) ; P1 x3 : −2,057 % (échec) ; P2 : Sharpe v4 > v2 sur
  77 cellules sur 123 (62,6 %, tenu) ; P3 moitié 1 : 67/123 (54,5 %, tenu) ; P3
  moitié 2 : 60/123 (48,8 %, échec). Descriptif : drawdown plus faible sur 95/123
  (77,2 %), PnL moyen −3,7 % contre −4,9 %, 1 654 entrées de la v2 sur 3 087 refusées
  par le filtre (53,6 %), 2 515 trades clos conservés sur 3 075 (81,8 %), exposition
  21,6 % contre 25,8 %, test des signes p = 0,0033 (optimiste, dépendance),
  achat-conservation médian −87 %.
- Empreintes : `scripts/axis/resultat-v4-2026-10-09.json`
  `251f020d10a90205ef9c7f963a808336124eb338bca1d455a4c1201a73e4a5db` (épinglée dans
  `apps/web/src/chart/indicators.axisAdx.test.ts`), `scripts/axis/rapport-v4-2026-10-09.md`
  `fef8bb362ddc79723448cf50bdaf6773fdf314ab5c61ef1294a9a61cb0b876b8`.
- Suites appliquées (DEFAVORABLE, manifeste `suites`) : défaut `adxEntree` conservé
  à 0 (v2 exacte, textes à 0 inchangés au caractère près) ; `suffixeAdx` de
  `stratAxis.ts` porte l'`infobulleFiltreActif` chiffrée à 25 et le
  `reglageHorsTest` aux autres seuils ; test croisé
  `apps/web/src/chart/indicators.axisAdx.test.ts` (nom annoncé par `testCroise`,
  r6) ; les 123 paires du pool sont consommées : aucune autre variante n'y sera
  jugée.
