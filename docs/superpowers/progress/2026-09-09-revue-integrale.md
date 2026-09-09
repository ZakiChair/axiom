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
| 8–9 : flux communs et économie des chaînes | 4 | Implémentation en cours sur les interfaces approuvées du lot 1 |
| 10 : ECO/EVTS, publications et réactions | 5 | Première implémentation `557f731` ; corrections de revue en cours |
| 11–12 : DOM/EQS, gamma et régime | 6 | Implémentation en cours ; premiers cas de régression écrits |
| 13–14 : WHALES, unlocks et bridges | 7 | Approuvé à `9e7f07f` ; accès personnel Pro absent |
| 15 : backtest, causalité, funding et OOS | 3 | Approuvé après corrections, tête `1517f7d` ; campagne non concluante |
| 16 : maintenance et budgets | 8 | CLI Vercel59.14.0 vérifié ; CI/build après intégration |
| 17 : parcours réel et restauration | 9 | Préconditions de QA inspectées ; exécution finale à venir |

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
- Lot 5 : la seconde passe compte 68 tests réussis. La pagination M1 a été
  vérifiée sur Binance réel autour du NFP du 4 septembre : 2 881 bougies pour
  chacun de BTC/ETH, trois appels par actif, couverture avant/après complète
  jusqu'à 24 heures. La revue demande encore des corrections d'identité Core
  PCE, de restitution des captures et du cycle React ; lot non approuvé.
- Lot 7 : 77 tests web et 138 tests daemon réexécutés avec succès. La revue
  a vérifié migration des anciennes directions WHALES, dénominateurs datés,
  import et protection des secrets. Le middleware Vite réel a été testé avec
  un amont local : quatre refus sans aucun relais, un appel accepté avec
  en-tête de clé retiré. Les parcours navigateur et la compilation globale
  seront vérifiés avec les autres lots assemblés.
- Lot 3 : revue des correctifs approuvée à `1517f7d`, 79 tests backtest et
  54 tests web ciblés réussis, typecheck du package réussi. Le loader a été
  vérifié indépendamment sur les archives réelles BTC/ETH et refuse une
  échéance REST supprimée. Les résultats OOS sont identiques après recalcul ;
  seul le hash de l'engine et l'horodatage du résultat changent. La campagne
  reste non concluante et les 30 stratégies globalement non validées.

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

Le [registre G100](../plans/2026-07-22-gate-g100-qa.md) demeure le seul document
portant les statuts de gate et la décision WTP. Les contrôles automatisés,
observations visuelles et limites d'accès seront consolidés ici après leur
exécution effective, sans assimiler tests hermétiques et usage réel.
