# Réalisation de la revue globale du 9 septembre 2026

Travail en cours sur `feat/revue-integrale-20260909`, worktree
`.worktrees/revue-integrale-20260909`, base `94164d5`.
La demande du propriétaire couvre l'ensemble de la [revue](../../revue-2026-09-09.md).
Le [plan](../plans/2026-09-09-revue-integrale.md) et la
[spec](../specs/2026-09-09-revue-integrale-design.md) définissent les critères.

La restriction réservant l'orchestration à Fable a été retirée à la demande
explicite du propriétaire. L'architecture existante reste en place, avec
implémentation par lots et revue indépendante.

## Couverture de la demande

| Critères de la spec | Lot | État de réalisation |
|---|---|---|
| 1–4 : ETF, référentiels, CHAIN, qualité | 1 | Approuvé après corrections, tête `cef9bb1` |
| 5–7 : macro, ALFRED, TGA/NETLIQ | 2 | Approuvé après corrections, tête `fa24839` |
| 8–9 : flux communs et économie des chaînes | 4 | Approuvé après corrections à `162e3f1` |
| 10 : ECO/EVTS, publications et réactions | 5 | Approuvé après corrections à `4859d05` |
| 11–12 : DOM/EQS, gamma et régime | 6 | Approuvé à `c09835b` ; diagnostic réel et oracle gamma réussis |
| 13–14 : WHALES, unlocks et bridges | 7 | Approuvé à `9e7f07f` ; accès personnel Pro absent |
| 15 : backtest, causalité, funding et OOS | 3 | Approuvé après corrections, tête `1517f7d` ; campagne non concluante |
| 16 : maintenance et budgets | 8 | Approuvé : maintenance `e536af9`, compléments `ddaad34`/`834ef41`/`1c28f2d` ; CI40 réussie |
| 17 : parcours réel et restauration | 9 | Restauration réelle et parcours exécutés ; tenue visible en cours, registre G100 actualisé séparément |

## Vérifications disponibles

- Baseline `94164d5` : `pnpm check` réussi, 4 956 tests ; E2E28 réussis.
  Ces résultats précèdent les modifications et ne valident pas la branche finale.
- Lot 1 : 132 tests ciblés et typecheck web réussis. Trois revues ont notamment
  corrigé les métadonnées des caches et empêché qu'un appel ETF en erreur
  rajeunisse l'acquisition des valeurs réellement agrégées. Revue finale approuvée
  à `cef9bb1`, sans problème important restant.
- Lot 2 initial : 91 tests ciblés réussis. La revue indépendante a ensuite
  reproduit deux défauts majeurs : transformations FRED perdues en ALFRED et
  affichage de valeurs d'un autre millésime lors d'une panne. Leur correction
  a ajouté des tests dédiés et invalidé les anciens caches FRED. Vérification
  finale du lot : 118 tests ciblés et typecheck web réussis ; revue indépendante
  approuvée à `fa24839`, sans problème important restant.
- La campagne OOS utilise le manifeste
  `scripts/oos/manifeste-2026-09-09.json`, SHA-256
  `9b3d1c764946c61311467a79c846158759c9deb76c5489364fdaf6c577a749f4`,
  écrit avant téléchargement et calcul. La période historique réservée au
  script ne constitue pas une preuve qu'aucun humain ne l'avait observée.
- Lot 5 : 70 tests ciblés et un parcours navigateur réexécutés avec succès.
  La pagination M1 a été
  vérifiée sur Binance réel autour du NFP du 4 septembre : 2 881 bougies pour
  chacun de BTC/ETH, trois appels par actif, couverture avant/après complète
  jusqu'à 24 heures. Identité Core PCE, restitution des captures et cycle React
  ont été corrigés ; un import sans remontage et une sélection changée pendant
  une réponse lente passent en navigateur. Date/heure UTC et guide d'import
  effectivement servi sont contrôlés. Lot approuvé à `4859d05` ; compilation
  finale et GET du guide via le daemon de production vérifiés dans le contrôle assemblé.
- Lot 4 : les 65 tests web et 53 tests alertes initiaux passent. Quatre probes
  indépendantes ont ensuite reproduit des doublons lors de franchissements
  simultanés, une alerte supprimée encore journalisée, un agrégat stablecoin
  partiellement absent pris pour zéro et un snapshot vieilli accepté au clic.
  Les quatre sondes indépendantes passent après correction ; revue finale approuvée
  à `162e3f1`. Les 70 tests web ciblés et 53 tests alertes passent aussi.
- Lot 6 : approuvé à `c09835b`, 105 tests ciblés réexécutés par le réviseur.
  Les adaptateurs réels ont fourni 14 bougies spot et 14 points OI
  BTCUSDT en 5 minutes. Le diagnostic garde 12 observations sur une période
  commune, couverture 91,7 %, sans décaler le timestamp de fin OI. Un oracle
  indépendant donne GEX −1/+3/−3 USD par mouvement de 1 % selon l'hypothèse,
  DEX inchangé, et zéro du cumul par strike uniquement dans le scénario attendu.
- Lot 7 : 77 tests web et 138 tests daemon réexécutés avec succès. La revue
  a vérifié migration des anciennes directions WHALES, dénominateurs datés,
  import et protection des secrets. Le middleware Vite réel a été testé avec
  un amont local : quatre refus sans aucun relais, un appel accepté avec
  en-tête de clé retiré. Les parcours navigateur et la compilation globale
  ont ensuite été vérifiés avec les autres lots assemblés.
- Lot 3 : revue des correctifs approuvée à `1517f7d`, 79 tests backtest et
  54 tests web ciblés réussis, typecheck du package réussi. Le loader a été
  vérifié indépendamment sur les archives réelles BTC/ETH et refuse une
  échéance REST supprimée. Les résultats OOS sont identiques après recalcul ;
  seul le hash de l'engine et l'horodatage du résultat changent. La campagne
  reste non concluante et les 30 stratégies globalement non validées.

## Corrections de revue de l’assemblage

- `bfd95c9` exclut les dix credentials fournisseurs (onze emplacements, dont
  l’ancien FRED) de l’export JSON. Un import historique préserve les clés locales,
  remplace les données couvertes et conserve son rollback. L’export est direct ;
  l’import destructif garde sa confirmation. Les deux nouveaux tableaux utilisent
  le composant commun. 63 tests ciblés et typecheck web réussis.
- La revue finale a reproduit un badge « frais » resté identique sept jours après
  arrêt du collecteur. La correction transmet les seuils des sources et projette
  la qualité à l’heure du rendu via une horloge locale partagée. Un parcours DATA
  garde le composant monté, publie entre deux ticks et laisse expirer la donnée
  sans collecte. Les dates montrent l’heure UTC ; une lecture du cache gamma ne
  rajeunit plus son acquisition. Les dates absentes demeurent inconnues.
- Le budget initial a révélé que les alertes chargeaient les transports on-chain
  au démarrage. L’import différé les charge au premier panneau ou à la première
  alerte active. Le plafond reste fixé à 1 220 000 octets bruts et 360 000 gzip
  niveau 9. Mesure finale : 1 208 365 octets bruts / 356 789 gzip niveau 9 ;
  imports dynamiques séparés : 846 806 / 309 654 octets.

- `50184e9` rend le schéma d’import des unlocks accessible sans clé ni token.
  Le guide canonique décrit le format strict et les dénominateurs, avec un exemple
  explicitement synthétique. Le vrai parseur accepte cet exemple et garde les
  ratios absents ; le GET du Markdown servi par Vite est vérifié en navigateur.
- La revue du plan a relevé une couverture E2E incomplète malgré les 35 parcours
  verts. Les compléments CHAIN (source lente/rotation de clé), MACRO/ALFRED,
  TGA et économie comparée sont ajoutés pour fermer ce manque. Le parcours
  économique a reproduit un défaut Chrome réel : `options.fetcher(...)` impose
  un receveur invalide au `fetch` natif. `834ef41` appelle la fonction détachée ;
  le cas passe sans modifier les calculs, le signal, le cache ou le limiteur.
  Quatre E2E et sept tests économie ont été rejoués indépendamment avant les
  dernières assertions macro et CHAIN. Ces dernières passent ensuite quatre E2E
  indépendants en 4,6 secondes. La sélection CI complète à `1c28f2d` réussit :
  **40/40** en 1,2 minute, log `/private/tmp/axiom-lot8-final-e2e.log`.

## Validation assemblée avant les essais réels

- `pnpm check` réussit : 5 213 tests (733 indicateurs, 53 alertes, 79 backtest,
  513 daemon, 3 835 web), contrôles de types et build avec budget bloquant.
- `pnpm check:e2e` réussit : 31 parcours hermétiques en 1,2 minute, puis les
  quatre parcours complémentaires unlocks, gamma, WHALES et modes de backtest
  réussissent en 5,6 secondes. Leur rejeu indépendant réussit en 5,4 secondes.
  Après intégration du filtre à `ddaad34`, la commande CI complète
  `AXIOM_E2E_PORT=5239 pnpm check:e2e` réussit en un passage : **35/35**,
  1,1 minute, sans échec ni relance. Après les cinq parcours de couverture
  complémentaires, la passe complète finale réussit **40/40** en 1,2 minute.
- `pnpm audit --json` : zéro vulnérabilité parmi 238 dépendances.
- Mesure sur build de production et sources volontairement indisponibles :
  Toolbar prête en 134 ms, ouverture CHAIN en 323 ms, 74 ressources et
  418 670 octets transférés, aucune tâche longue de 50 ms ou plus. Ces
  observations hermétiques ne mesurent pas la latence des fournisseurs réels.
- Le guide est émis comme fichier Markdown dans le build. Son GET réel via le
  daemon de production renvoie HTTP 200, `text/markdown`, 1 667 octets identiques
  au fichier construit, SHA-256
  `d17d47a15258d12b64d005ddf113f78a0773c21677a2ea7500c3866a3b40adc0`.
- Workspace réel Binance BTCUSDT, preset Scalp : EQS termine crowded-long en
  1,772 seconde, avec zéro résultat explicite ; le diagnostic reçoit prix/OI/CVD
  réels et les coûts DOM sont affichés. Aucune tâche longue ≥ 50 ms pendant
  la fenêtre observée de 62,892 secondes incluant EQS et ouverture du Scalp.
  Cette mesure ponctuelle ne garantit pas la disponibilité future des sources.

## Accès et observations des sources

- FRED : clé personnelle existante utilisée pour trois appels de lecture
  ALFRED ; millésimes et révisions PAYEMS réellement observés. L'API donne des
  dates quotidiennes et ne prouve pas une heure de publication intraday.
- Treasury DTS : endpoint publicv1 et rupture de schéma du18avril2022 vérifiés.
  Les soldes sont en millionsUSD ; le jour d'observation n'est pas l'heure de
  disponibilité historique.
- DefiLlama : historiques publics TVL, DEX, frais et stablecoins observés.
  Le contrat Pro officiel est disponible, mais aucun appel authentifié Pro
  n'a été exécuté et aucune souscription n'a été prise.
- BLS : heures officielles et premières valeurs de deux publications
  historiques vérifiées. Aucun consensus historique avant annonce n'est
  inventé à partir de ces communiqués.
- Binance : archives fundingRate d'août 2026 BTCUSDT et ETHUSDT téléchargées,
  sommes SHA-256 officielles vérifiées. Pour chaque actif, les 93 échéances
  et taux correspondent exactement à l'API REST. La cadence est fournie
  par les archives ; l'API `fundingInfo` courante ne prouve pas sa valeur passée.
- Catalogue macro contrôlé depuis le module réel : 24 familles, 88 définitions,
  86 raccordées et deux absences explicites ; 189 indicateurs et 39 fenêtres conservés.
- Vercel CLI : version publiée 59.15.0 et installation globale vérifiées ;
  aucune connexion, création de service ni mise en production effectuée.

Le [registre G100](../plans/2026-07-22-gate-g100-qa.md) demeure le seul document
portant les statuts de gate et la décision WTP. Les contrôles automatisés,
observations visuelles et limites d’accès sont distingués des tests hermétiques.
La clôture de la tenue visible et l’onboarding restent en cours à cette étape.


## Restauration réellement exécutée — 10 septembre, production locale

Profil navigateur et base du worktree isolés, aucune modification de la base
quotidienne. Le snapshot nº 2, créé le 9 septembre à 22:05:46.188 UTC
(21 395 octets), contient BTCUSDT/1 min. Après passage à ETHUSDT/5 min et
création d’une note dédiée, « Restaurer » puis « Confirmer » provoquent le
rechargement réel. Le graphique revient à BTCUSDT/1 min, la note postérieure
disparaît et les douze clés couvertes sont identiques octet pour octet à la
situation sauvegardée. Le snapshot de secours nº 3 est créé avant restauration
(22:06:58.501 UTC, 22 310 octets). Le contrôle ne se limite pas à une notification UI.

Le trajet prix → alerte → journal a été exercé avec une alerte dédiée au profil
de QA. Le script daemon seul dispose également de sa preuve de journalisation,
puis nettoie sa définition et son état. Telegram n’était pas configuré dans cette
base de travail ; aucun message à un tiers n’a été envoyé. Les limites des gestes
physiques et de la notification native sont consignées uniquement dans le registre.
