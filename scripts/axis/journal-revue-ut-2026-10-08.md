# Journal de revue — AXIS sur les autres unités de temps (8 octobre 2026)

Revue indépendante du protocole et du runner AVANT toute lecture des données
de test (règle du projet : « Backtest / math / drawdown / expectancy →
Réviseur »). Le réviseur (agent séparé) n'a pas écrit ce code. Méthodes :
lecture du manifeste, du runner, du moteur, du rejeu et de `stratAxis.ts` ;
trois répétitions `--essai` (temps, déterminisme, mémoire) ; calcul des
grilles et du nombre de décalages par unité (`/tmp/axis-ut-revue/grilles.ts`) ;
taille du test sous l'hypothèse nulle par simulation (`taille-h0.ts`) ; copie
du runner sur caches synthétiques (volumes nuls, prix constants, trous) et
sur un faux endpoint local (pagination, reprises, débit, symbole invalide).
Aucune requête vers Binance, aucun cache de campagne (`H-*`) écrit, aucun
fichier du dépôt modifié par le réviseur.

Verdict de la première revue : **« figeage refusé »** — un bloquant (B1),
deux majeurs (M1, M2), sept mineurs, huit remarques. Conditions posées :
corriger B1, M1 et M2 ; relancer `tsc --strict` et `--essai` ; contre-revue
limitée au diff ; créer ce journal. Tous les constats sont traités
ci-dessous. Aucune correction n'assouplit un critère : F3 et le statut
« fenetre » ne peuvent que retirer un verdict ; l'énumération exhaustive
rend la p exacte, en moyenne plus grande que l'estimation par tirages, mais
pouvant en différer dans les deux sens sur une réalisation (bruit des
tirages). Contre-revue : **« figeage autorisé »** (quatre mineurs, corrigés
au figeage).

## Empreintes

| Objet | Revu (premier passage) | Final (figé) |
|---|---|---|
| Manifeste `manifeste-ut-2026-10-08.json` | candidat `47025e3cb4f8d0aba67637a75c4419e33db51b21655e3a5b3141f6d561bb58ec` | `05ed40f0762578cf57c14cabf4db47c2e6a8141cf898edaf439bff989ea6c068` (figé à 2026-10-08T09:58:40Z) |
| Runner `scripts/valider-axis-ut.ts` | `35798739e78a62e16cf271e9f63c87d60f15dd26df5282ed27abd5d638b2c6f9` (HASH_MANIFESTE = « A_FIGER ») | `059acc4af3c966b5d3975abeec8fcdc84f1a04874f7b85d945094ecc6c29c95b` (hash du manifeste épinglé) |
| Code figé (16 fichiers, `versions.codeAuFigeageSha256`) | tous identiques | inchangés |
| Arbre de code (`versions.arbreCode`, ajouté après la revue) | — | 247 fichiers hors tests de `packages/{indicators,backtest,types}/src`, `3fcfaa2fedb5ea5cc47fc23cd235f7ab7394489d13af82582e95a4d25d5fa90e` |
| `pnpm-lock.yaml` | `130d4fb6…c062` | inchangé ; Bun 1.4.2 |

Le manifeste ne peut contenir ni le hash du runner (le runner épingle le
sien) ni celui du commit de figeage (il en fait partie) : le résultat les
reporte dans `code.runnerSha256` et `code.commitFigeage`.

## Chronologie (UTC, 8 octobre 2026)

- 08:46 → 08:47 : première répétition, acquisition réseau des 8 symboles
  déjà vus × 13 unités ; résultats lus (voir plus bas).
- Avant la revue : critère F3 et robustesse (débit, cache) ajoutés ; liste
  exacte dans `historique.modificationsApresRepetition` du manifeste.
- Revue indépendante (≈ 37 min) : figeage refusé.
- À partir de 09:20 : corrections ci-dessous.
- 09:30 → 09:37 : `tsc --strict`, deuxième répétition, banc des chemins de
  verdict, chemins d'arrêt. La deuxième répétition a téléchargé à 09:31:50
  les 6 séries SOLUSDT (symbole déjà vu) que la première n'avait pas mises
  en cache parce qu'invalides (m1).
- 09:40 → 09:57 : contre-revue limitée au diff : figeage autorisé.
- Ensuite : corrections des quatre mineurs, `tsc --strict`, troisième
  répétition, figeage (sections dédiées plus bas).

## Répétition technique (données déjà vues, sans valeur probante)

- `--essai` sur les 8 symboles déjà vus (BTC, ETH, XRP, SOL, BNB, ADA, LINK,
  DOGE) × 13 unités, mêmes fenêtres : 104 séries, 98 exploitables (SOL coté le
  2020-08-11 : indisponible à partir du 2h, chemin « cellule indisponible »
  éprouvé). Acquisition réseau de 2 600 pages en 55 s (6 requêtes en vol),
  puis relectures depuis le cache en moins de 60 s au total ; 48 Mo de cache.
  Contrôles bloquants passés sur les 98 cellules.
- Résultats lus (données vues), qui donnent à l'auteur des a priori par
  unité, consignés dans `historique.repetitionLue` : signaux DÉFAVORABLES du
  1s au 12h (frais dominants jusqu'au 15m, −0,14 % à −0,15 % par trade aux
  coûts x1 ; en 2h, 6h, 12h, S1, S3 et S4 tiennent mais le timing échoue,
  p 0,014 à 0,023 > 0,0038), NON CONCLUANTS en 1d (93 trades clos), 3d (27)
  et 1w (aucun trade : EMA 200 hebdomadaire et amorce de 300 bougies ne
  laissent que 53 décisions). Forts achats : FAVORABLES en 2h, 6h, 12h, 1d
  (+119 à +846 bps à 12 bougies), DÉFAVORABLES du 1s au 1h, NON CONCLUANTS
  en 3d et 1w (55 et 16 événements).
- **Constat de la répétition → F3** : en 1s, les forts achats passaient F1 et
  F2 (14 877 événements, p ≤ 0,0002, 8 cellules sur 8) avec +0,235 bps en
  moyenne, soit +0,0024 % : l'infobulle aurait annoncé « +0.00 % en moyenne…
  — mesure passée » au statut favorable, pour un effet cinquante fois plus
  petit que le coût aller-retour. Ajout de F3 (moyenne regroupée > coût
  aller-retour x1, 0,14 %) et du même seuil pour la formulation « forte vente
  significative ». Critère plus strict, jamais plus favorable, fixé avant
  toute lecture des données de test ; consigné dans `criteres.fortsAchats.origineF3`.
- Robustesse ajoutée après la répétition : débit commun (pause de toutes les
  requêtes quand `x-mbx-used-weight-1m` atteint 4 800 sur 6 000, ou sur 418 /
  429), délai de 30 s par requête (erreur réseau reprise), écriture atomique
  du cache, cache illisible signalé ; précision des bps à une décimale dans
  le rapport ; coquille « C2/S2 » des limites.
- Test de charge sur trois paires peu liquides hors des deux ensembles
  (OGUSDT, FIDAUSDT, TLMUSDT, déjà lues par la sonde de faisabilité ; copie
  temporaire du runner, cache et sorties dans /tmp, supprimée ensuite) : 96 %
  des bougies 1s et 29 à 44 % des bougies 1m à volume nul, prix constants par
  plages ; aucun plantage, contrôles bloquants passés sur les 21 cellules
  mesurables, cellules 2h et plus indisponibles (cotations 2020-2021).

## Constats du réviseur et traitement

### B1 (bloquant, corrigé) — décalages trop peu nombreux aux grandes unités

Constat : k = ⌊Lmin (0,1 + 0,8 u)⌋ ne prend qu'environ 0,8 Lmin valeurs ;
4 999 tirages avec remise dans cet ensemble affichaient « p ≤ 0,0002 » là où
la p exacte du test ne descend pas sous 1 / (|K| + 1). Grilles du réviseur :
12h |K| ≈ 3 715 (plancher 0,0003), 1d ≈ 1 737 (0,0006 / 0,0005), 3d ≈ 420
(0,0024 / 0,0017), 1w 43 (0,023) et 209 (0,0048 > pMax). Taille réelle
simulée sous H0 au seuil 0,0038 : 3,9 % pour L = 53, 0,65 % pour L = 261,
0,58 % pour L = 524 ; 0 %, 0 % et 0,20 % en énumération exhaustive. Risque
concret : environ 96 forts achats attendus en 1w sur 42 cellules, F1 n'y
passerait que par artefact ; en répétition, le 1d affichait « p ≤ 0.0002 »
pour un plancher exact de 0,0005.

Traitement :
- `decalagesNul` : K = {⌊0,1 L⌋, …, ⌈0,9 L⌉ − 1} (exactement l'ensemble des
  valeurs que prend le tirage) ; tous les k une fois quand |K| ≤ 4 999 (p
  exacte), 4 999 tirés sinon (inchangé du 1s au 6h, où |K| > 4 999) ; K vide
  → aucun décalage, p = 1. Même fonction pour les signaux et les forts achats
  (p unilatérale et bilatérale, donc aussi la règle des fortes ventes).
- `ResultatTiming` et `Stat` consignent `nDecalages` et `exhaustif` ; le
  rapport écrit « N décalages, tous » ou « N décalages tirés » et le plancher.
- Nouveau statut : S2 ou F1 « insuffisant » quand 1 / (|K| + 1) > pMax →
  NON CONCLUANT, raison « fenetre » (sauf autre bloc en échec, DÉFAVORABLE) ;
  textes `suites.*.raisons.fenetre` (« fenêtre trop courte… : p ≥ {pMin} quel
  que soit le résultat », plancher arrondi vers le bas). Manifeste :
  `timing.decalage`, `pValeur`, `formatP`, `criteres.resolutionDuTest`,
  `origineResolution`, S2, F1, verdicts NON CONCLUANT.
- Vérifié par la deuxième répétition : 12h exhaustif (3 715 et 3 881
  décalages, « p ≤ 0.0003 »), 1d (1 738 et 1 904, « p ≤ 0.0006 »), 3d (419
  et 585), 1w (43 et 209) ; 1s à 6h : 4 999 tirés. Banc sur une copie du
  runner (43 vérifications, `/tmp/axis-fenetre/harness.ts`) : 1w signaux et
  forts achats « insuffisant » → NON CONCLUANT « fenetre » avec « p ≥ 0.0227 »
  et « p ≥ 0.0047 », y compris quand la p observée est grande ; S1 en échec
  + S2 insuffisant → DÉFAVORABLE sans citer S2 ; F3 en échec + F1
  insuffisant → DÉFAVORABLE ; 3d (plancher 0,0024) jugé normalement ; K vide
  → « fenetre » ; moins de 100 forts achats → « evenements » d'abord.

### M1 (majeur, corrigé) — historique incomplet

Constat : `attentes` disait « aucune exploration nouvelle » alors que la
répétition avait été lue sur les 13 unités et avait motivé F3 ; LTCUSDT
figure dans `MAJORS_VALIDATION` (`apps/web/src/data/validationSignaux.ts:84`).

Traitement : `historique.attentes` reformulé ; `historique.repetitionLue`
(résultats lus, a priori de l'auteur, aucune définition ni fenêtre changée
après lecture) ; `historique.modificationsApresRepetition` (deux entrées
horodatées : avant la revue, après la revue) ; réserve LTC dans
`statutIndependance` ; même contenu dans ce journal.

### M2 (majeur, corrigé) — pré-enregistrement non vérifiable

Constat : manifeste et runner non suivis par git, deux fichiers figés
présents seulement dans l'arbre de travail, SHA-256 du runner vérifié par
rien d'exécutable ; aux campagnes précédentes, le manifeste a été commité
avec les résultats.

Traitement : commit local de figeage (manifeste, runner, ce journal, unité du
chart transmise aux indicateurs et ses tests) AVANT `--campagne` ; le runner
refuse la campagne, avant le premier téléchargement, si le runner, le
manifeste ou un fichier de `packages/{indicators,backtest,types}/src`
diffère de HEAD (`git status --porcelain`), puis consigne HEAD dans le
résultat (`code.commitFigeage`) et le rapport ; règle décrite dans
`versions.commitDeFigeage` du manifeste.

### Mineurs

- **m1 (corrigé)** — Une page courte se lisait comme la fin de la série, et
  les séries invalides n'étaient pas mises en cache. Désormais : une page
  vide clôt la série ; une page courte seulement si sa dernière bougie est la
  dernière attendue (ouverture + 2 durées > fin), sinon la suite est
  redemandée. La série servie est mise en cache AVANT sa validation, qu'elle
  soit exploitable ou non ; un « symbole invalide » est consigné dans le
  cache (`erreurSource`, inclus dans le SHA-256) ; une relance rend le même
  statut sans requête. Vérifié : les 6 séries SOL invalides sont désormais en
  cache (104 fichiers `E-*`) et la relance les relit (98/104 exploitables).
- **m2 (corrigé)** — « p = 0.0002 » au plancher dans plusieurs affichages :
  `fmtP` partout (blocs S2 et F1, tableaux, détail par cellule, EMA 200,
  permutation), arrondi vers le haut, « ≤ » au plancher 1 / (N + 1).
- **m3 (corrigé)** — Empreinte limitée à 16 fichiers : `versions.arbreCode`
  (tous les fichiers non-test des trois dossiers, 247), vérifiée avant le
  premier téléchargement, plus l'exigence d'arbre commité (M2).
- **m4 (corrigé)** — Assertion `coutAllerRetourPct = 2 × (frais + slippage)
  x1` à la lecture du manifeste.
- **m5 (corrigé)** — `suites.formatValeurs` documente tous les champs
  (`{pBi}`, `{pMin}`, `{k}`, `{m}`, `{n}`, `{total}`, `{nTradesClos}`,
  `{raison}`, `{echecs}` et leur ordre).
- **m6 (corrigé)** — Un arrondi nul s'écrit « 0.00 » sans signe ; « 0 trade
  clos », « 1 trade clos », « N trades clos » ; quand F1 et F3 échouent
  ensemble, F3 ne répète pas la moyenne (`echecs.F3ApresF1`, ordre F1, F3,
  F2).
- **m7 (corrigé)** — `figeLeUtc` doit être une date ISO UTC passée, sinon
  campagne refusée.

### Remarques

- **r1 à r4, r6 (consignées)** — Prix constants (RSI 100, votes EMA et MACD
  sur des écarts infimes), pas de cotation et rebond entre achat et vente
  (contre les forts achats et les signaux ; une « forte vente … rebondi »
  peut en partie en venir), saturation du volume relatif en 1s, moyennes de
  rendements log (prudentes), chart calculé sur environ 500 bougies : dans
  `limitesConnues` du manifeste et dans les limites du rapport.
- **r5 (sans changement)** — Pas d'effectif minimum pour les fortes ventes
  significatives : la p le couvre.
- **r7 (corrigé)** — Plus d'attente après la dernière tentative.
- **r8 (anticipé)** — Signaux 3d et 1w : NON CONCLUANT presque certain
  (`limitesConnues`) ; 1w : test incapable d'atteindre le seuil dans les deux
  familles (`criteres.resolutionDuTest`).

## Vérifié correct par le réviseur (RAS)

- Hashes du candidat, des 16 fichiers figés (dont les deux non commités), du
  lockfile et de HEAD ; l'unité ajoutée au contexte n'est lue par aucun
  calcul figé ; `@axiom/indicators` résout vers `src/index.ts` (une seule
  instance du registre).
- Causalité : première décision à 299, fill à l'open 300 ; aucune entrée née
  pendant le warmup ; statistique de timing ln(open[i+2] / open[i+1]) et
  ln(close / open) en dernière décision ; intervalles [e, s − 1] égaux aux
  fills ; liquidation au dernier close avec frais et slippage ; sommes
  préfixes doublées sans débordement ; forts achats a = 49, b = n − 44,
  i + 1 + 42 ≤ n − 1 ; SMA du volume causale ; préfixes 40/70/90 %.
- Statistique : p unilatérale et bilatérale comme écrit, égalités comptées
  « ≥ » ; k < 0,9 Lmin ≤ L de chaque cellule ; Bonferroni 0,05 / 13 ; S3 et
  F2 en 2k > m ; NON CONCLUANT et fortes ventes conformes ; permutation des
  sens (Fisher-Yates partiel) ; pnlPct = pnl / 10.
- Données (faux endpoint) : 44 pages pour 43 200 bougies ; bougie en
  formation exclue ; reprises 429 (Retry-After), 503, délai dépassé ; pause
  de débit ; −1121 → indisponible ; bougies incohérentes écartées et
  comptées ; cache relu à l'identique ; grille 1w sur des lundis.
- Volumes nuls et prix constants (caches synthétiques) : aucun NaN, contrôles
  passés, série constante disponible avec 0 trade et 0 événement, 1,1 % de
  trous → indisponible ; formulations remplies.
- Contrôles bloquants : tout écart arrête le run, trace sans valeur mesurée.
- Faisabilité : répétition déterministe (même SHA de rapport sur deux runs) ;
  59 s et 227 Mo pour 8 symboles, environ 6 min de calcul pour 42 ;
  téléchargement de 10 à 20 min probable ; environ 270 Mo de cache.

## Vérifications de l'auteur après corrections

- `tsc --strict` (options du `tsconfig.base.json`) propre sur le runner.
- Deuxième répétition (`--essai`, 61 s) : mêmes verdicts et raisons que le
  candidat revu (la contre-revue l'a rejoué sur le même cache : 26 verdicts
  identiques ; avant l'ajout de F3, la première répétition donnait les forts
  achats 1s favorables), contrôles bloquants passés sur les 98 cellules ; avertissements attendus
  (hash et `figeLeUtc` non figés, chemins non commités) ; aucun champ de
  gabarit laissé vide ; aucun « +0.00 » ; plancher de p exact par unité.
- Banc des chemins de verdict et des formats (copie du runner dans /tmp) :
  43 vérifications conformes.
- Chemins d'arrêt : arguments invalides (`--campagn`, aucun, `--essai
  --campagne`) → code 2 ; `--campagne` avec le hash non épinglé → refus avant
  toute requête ; copies en mode campagne (manifeste copié, endpoint mort,
  cache dans /tmp) : `figeLeUtc` « A_FIGER » ou futur → refus ; arbre
  différent → refus ; chemins non commités → refus ; copie cassée (position
  inversée) → « ✋ écart de contrôle », trace horodatée sans valeur mesurée,
  code 1, aucun rapport. Aucun fichier `H-*` créé.

## Contre-revue (limitée au diff)

Réviseur indépendant (agent séparé, ≈ 17 min) sur le candidat corrigé
(manifeste `536953e4…`, runner `c687b341…`) et les diffs avec le candidat
revu. Méthodes : support de K comparé en fractions exactes pour L de 1 à
300 000 et aux tirages extrêmes de mulberry32 ; taille du mode tiré sous H0 ;
bascules entre p exacte et p tirée ; pagination sur un faux `fetch` (pages
tronquées, trou interne, série arrêtée, une bougie par page, miroir qui
ignore `startTime`) ; rejeu du candidat revu sur le même cache (26 verdicts
et raisons identiques) ; `--essai` hors réseau (`unshare -rn`), rapport
identique octet pour octet ; empreinte de l'arbre recalculée en Python
(247 fichiers, `3fcfaa2f…`) ; refus de campagne quand git échoue. Aucun
fichier `H-*`, dépôt non modifié.

Verdict : **« figeage autorisé »**, aucun bloquant ni majeur. Quatre mineurs,
corrigés au figeage (selon le réviseur, pas de nouvelle contre-revue si les
modifications s'y limitent ; `tsc --strict` et `--essai` relancés) :
- **Mineur 1** — « jamais plus favorable » est inexact cas par cas pour
  l'énumération exhaustive : p exacte et p tirée diffèrent dans les deux sens
  sur une réalisation (sous H0, la p exacte passe là où la p tirée échouait
  avec une probabilité de 0,0001 à 0,0003, l'inverse de 0,0004 à 0,0026).
  Formulations corrigées dans `historique.repetitionLue`,
  `criteres.origineResolution` et en tête de ce journal.
- **Mineur 2** — plancher du détail des blocs S2 et F1 arrondi au plus proche
  (« 0.0048 » en 1w contre « p ≥ 0.0047 » dans l'infobulle) : `fmtPMin`,
  arrondi vers le bas.
- **Mineur 3** — `formatValeurs` : `{continué de baisser|rebondi}` et valeur
  absolue de `{moyennePct}` dans `forteVenteSignificatif` documentés.
- **Mineur 4** — `modificationsApresRepetition` complétée (r7, texte F3
  « sans dépasser le coût », ordre F1, F3, F2) et entrée ajoutée pour la
  contre-revue ; journal : verdicts comparés au candidat revu, téléchargement
  SOL de 09:31:50, `code.commitFigeage`.

Remarques :
- **r-a** — mode tiré (|K| > 4 999, 1s à 6h) : taille exacte sous H0 de
  0,0039 pour |K| = 5 000 et 0,00386 en 6h, quasi nominale. Sans changement.
- **r-b** — d'autres paires du pool sont visibles dans l'application (ZECUSDT
  en recette 1m, TRX, XLM, LTC, HBAR, BCH, HOT dans des listes et des tests),
  sans mesure d'AXIS : réserve d'indépendance élargie dans `statutIndependance`.
- **r-c** — un cache `H-*` antérieur au figeage serait relu : garde non
  ajoutée, aucun `H-*` ne pouvant naître avant le figeage (campagne refusée
  sans hash épinglé, `figeLeUtc` passé et chemins commités) ; vérifié à 09:58
  qu'il n'en existe aucun, ni dans le dépôt ni dans /tmp.
- **r-d** — un fichier `skip-worktree` ou `assume-unchanged` échapperait à
  `git status` : aucun fichier marqué (`git ls-files -v`, 09:58) ; après
  l'exécution, `git show <commit>:scripts/valider-axis-ut.ts` doit redonner le
  SHA-256 du runner (section « Après l'exécution »).
- **r-e** — `statSync` suit les liens symboliques : aucun lien dans les trois
  dossiers.

## Avant le lancement

- Figeage : `figeLeUtc` = 2026-10-08T09:58:40Z ; manifeste `05ed40f0…c068`,
  hash épinglé dans le runner `059acc4a…c95b` (empreintes complètes
  ci-dessus) ; 16 fichiers figés et arbre de code (247 fichiers, `3fcfaa2f…`)
  inchangés.
- `tsc --strict` propre. Troisième répétition (57 s) : un seul avertissement,
  attendu avant le commit (chemins non commités) ; mêmes verdicts et mêmes
  formulations que la deuxième ; planchers arrondis vers le bas (12h
  « p ≤ 0.0003 … plancher 0.0002 », 1d « p ≤ 0.0006 … plancher 0.0005 »).
- Aucun cache `H-*` (dépôt et /tmp), aucun fichier marqué `skip-worktree` ou
  `assume-unchanged`, aucun lien symbolique dans les dossiers figés.
- Commit local de figeage : manifeste, runner, ce journal et l'unité du chart
  transmise aux indicateurs (`packages/types/src/index.ts`,
  `packages/indicators/src/engine.ts` et son test,
  `apps/web/src/chart/indicators.ts` et `indicators.aux.test.ts`) ; typecheck
  des quatre paquets concernés et tests correspondants (48 indicateurs dont
  43 AXIS, 15 web) passés avant le commit. Son hash est consigné par le
  runner (`code.commitFigeage`) et reporté ci-dessous.
- Lancement : `bun scripts/valider-axis-ut.ts --campagne`, une seule fois,
  juste après le commit. Durée attendue de 15 à 30 min (546 séries, environ
  13 650 pages sous la limite de poids, puis environ 6 min de calcul), sans
  aucun résultat partiel. Une interruption technique avant le verdict est
  consignée ici (cause, correctif, revue) avant toute relance ; le cache
  `H-*` déjà validé reste acquis.

## Après l'exécution (consigné après coup)

- Commit local de figeage : `287e014560c4e69dd5762235a264f943bdf98604` (parent
  `605325e`), consigné par le runner (`code.commitFigeage`) avec
  `cheminsFigesCommites` et `identiqueAuFigeage` vrais, arbre de code
  inchangé (247 fichiers, `3fcfaa2f…`), aucun avertissement. Vérification
  r-d : `git show 287e014:scripts/valider-axis-ut.ts | sha256sum` redonne
  `059acc4a…c95b`, et le manifeste du commit redonne `05ed40f0…c068`.
- Exécution unique : `bun scripts/valider-axis-ut.ts --campagne` (Bun 1.4.2),
  lancée à 10:02:11, terminée à 10:13:14 (11 min), code de sortie 0. Aucune
  interruption, aucune trace d'arrêt, aucune relance. Pendant le calcul, la
  sortie n'a montré que la progression et, par unité, « contrôles bloquants
  passés ».
- Données : 546 séries téléchargées puis mises en cache (`H-*`, 240 Mo, hors
  dépôt), 534 exploitables. Les 12 cellules indisponibles sont CVCUSDT et
  FTTUSDT de 2h à 1w (trous de cotation : 621 et 1 249 bougies manquantes
  sur 9 888 en 6h ; en 3d, une bougie hors grille). Ces unités gardent 40
  cellules sur 42, au-dessus du minimum de 75 %.
- Contrôles bloquants passés dans les treize unités.
- Verdicts (`rapport-ut-2026-10-08.md`) : **aucune unité FAVORABLE**.
  Signaux DÉFAVORABLES dans douze unités (de 2h à 1d, seul le timing S2
  échoue, p de 0,055 à 0,12), NON CONCLUANTS en 1w (2 trades clos sur 100
  requis). Forts achats DÉFAVORABLES dans les treize unités (en 1w, F1
  « insuffisant » mais F2 en échec, donc DÉFAVORABLE selon
  `criteres.resolutionDuTest`).
- Empreintes des sorties : `resultat-ut-2026-10-08.json`
  `77b755815e1521ebd6137d1361bc0ccac98b089ae26570519513b7cc926058ec`,
  `rapport-ut-2026-10-08.md`
  `5c6d6aa429362521b13d710ea9c3d1b29cc2699721ae350dc47ff6920ebfd9e4`.
- Écart avec la répétition sur données déjà vues : les forts achats y
  semblaient FAVORABLES de 2h à 1d (8 majors) ; sur les 42 alts jamais vues,
  ils échouent partout, avec une moyenne négative de 2h à 12h. Les signaux
  de 2h à 12h échouaient déjà au seul timing sur les données vues.
- Suites appliquées (manifeste, `suites.DEFAVORABLE` et `NON_CONCLUANT`),
  dans le commit qui suit le figeage : l'infobulle de chaque unité reprend la
  formulation choisie par le runner (`textesAxis` dans `stratAxis.ts`, lue
  par `ctx.timeframe`), recoupée au caractère près par
  `apps/web/src/chart/indicators.axisUnites.test.ts`. 4h et unité absente
  sont inchangés. Aucun changement de calcul, signaux et marqueurs conservés.
  Ces données sont consommées : aucune autre variante n'y sera jugée sans
  décision explicite du propriétaire.
