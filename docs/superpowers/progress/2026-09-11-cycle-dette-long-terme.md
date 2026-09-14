# Cycle de la dette à long terme — réalisation du 11 septembre 2026

Ajout demandé par le propriétaire, dans MACRO / RATE → Indicateurs.
Le [plan](../plans/2026-09-11-cycle-dette-long-terme.md) précise les sources,
le périmètre et les lots. Le présent rapport distingue les tests avec fixtures
des réponses effectivement obtenues auprès des fournisseurs.

## Sources réelles

Les huit séries BIS distribuées par FRED ont été contrôlées sur leurs pages
officielles et leurs CSV publics. Le proxy FRED existant de l’application a
ensuite répondu HTTP 200 aux huit requêtes avec `observation_start=1900-01-01`.
Les réponses contiennent respectivement 313, 108, 240, 113, 121, 180, 144 et
121 observations pour US, EZ, UK, JP, CN, IN, CA et CH. La dernière période
observée est T4 2025 pour toutes les zones ; l’historique US commence à T4 1947.

Preuve locale des réponses du proxy :
`/private/tmp/axiom-20260911-dette-api.json`.
Note du chercheur indépendant : `/private/tmp/axiom-20260911-dette-sources.md`.
Aucune clé n’est incluse dans ces preuves.

## Vérifications

- Horizons, cache et présentation : 56 tests ciblés réussis, après reproduction
  des nouveaux cas absents. Le réviseur indépendant a réexécuté les 56 tests.
- Catalogue et BRIEF : 42 tests ciblés réussis et réexécutés par le réviseur.
  La correction BRIEF conserve l’ancre ALFRED lors du filtrage de l’historique
  et affiche `% du PIB` dans le panneau comme dans l’export.
- `pnpm check` : succès, code de sortie 0. TypeScript monorepo, 1 376 tests
  indicateurs, 70 alertes, 93 backtest, 513 daemon et 3 867 web réussis, soit
  **5 919 tests**. Build web réussi : 1 209 782 octets bruts et 357 341 gzip
  pour le chargement initial, sous les limites 1 220 000 / 360 000.
- Navigateur hermétique : **12 parcours réussis**, commande
  `AXIOM_E2E_PORT=5255 pnpm --filter @axiom/web exec playwright test macro-dette-long-terme.e2e.ts macro-globale.e2e.ts revue-macro-vintage.e2e.ts`.
  Trois nouveaux parcours couvrent Max depuis 1960, les fenêtres 30/60 ans,
  huit sources, unités, ALFRED avant 1970, exclusion d’une révision ultérieure
  et réponse HTTP 401 sans valeurs inventées. Les neuf autres contrôlent les
  parcours macro existants, leurs transformations, ECO/BRIEF et NETLIQ.
- Vérification réelle dans Chrome via le serveur existant : les huit courbes
  et les tableaux affichent les valeurs et périodes effectivement renvoyées
  par FRED ; Max montre US depuis T4 1947. Inspection visuelle du graphique et
  du tableau en fenêtre normale puis maximisée : unités et dates lisibles.
- Revue indépendante finale favorable, aucun bloquant restant. Le réviseur
  a exécuté personnellement 98 tests ciblés et relu les parcours navigateur.
  Rapport : `/private/tmp/axiom-20260911-dette-revue.md`.
- `git diff --check` : propre. Aucun commit effectué.
- Les trois nouveaux parcours sont raccordés à `pnpm check:e2e` dans
  `scripts/ci.sh` ; validation de syntaxe `bash -n` réussie. La suite complète
  `check:e2e` n’a pas été relancée ; les 12 parcours concernés l’ont été.

Journaux locaux : `/private/tmp/axiom-20260911-dette-check.log` et
`/private/tmp/axiom-20260911-dette-e2e.log`.

## Déploiement Vercel demandé le 11 septembre 2026

Déployé en production après autorisation explicite du propriétaire.
Statut Vercel **Ready**, ID `dpl_AzjGV42z2e1Z6urUkDtDJ4iqH6UL`.
Alias : [AXIOM](https://axiom-iota-vert.vercel.app).
URL immuable : [déploiement](https://axiom-2myo2mcq9-zakichair-4589s-projects.vercel.app).

Une copie filtrée des sources suivies et des nouveaux fichiers du lot a été
utilisée : 1 388 fichiers, vérifiés par SHA-256 contre le workspace par le
réviseur indépendant. Le dry-run Vercel inclut 1 387 fichiers (12,4 Mo), sans
`.env` privé, base locale, worktree ou dépendances installées. Cette précaution
était nécessaire car l’upload direct de la CLI n’applique pas `.gitignore`.
La liaison existante au projet `axiom` est conservée ; aucun réglage de compte
ou de protection n’a changé. Déploiement CLI depuis cette copie, sans commit.

Contrôles après publication :

- Alias public HTTP 200, application chargée dans Chrome.
- Parcours réel `⌘K → MACRO → Indicateur` : option « Cycle de la dette à long
  terme » présente, sélection `dette-pib`, Max actif, horizons 30/60 ans visibles,
  huit lignes de zones et huit liens FRED corrects.
- Proxy FRED publié fonctionnel : sans clé personnelle, l’amont répond HTTP 400
  avec clé manquante. Aucun secret n’a été copié dans le navigateur de contrôle.
  Les valeurs réelles avaient été vérifiées via le proxy local ; ce contrôle
  de production valide l’interface et le routage, pas un appel authentifié.
- Build distant terminé, chargement initial 1 206 004 octets bruts / 357 229
  gzip, sous les budgets. Le bundler de fonction Vercel a émis TS2550 sur
  `Object.hasOwn` dans `shared/nbs-series.ts` (bibliothèque TypeScript implicite
  antérieure à ES2022). La compilation ne bloque pas le déploiement ; le runtime
  configuré est Node 24 et le proxy FRED a répondu après publication.

Preuves locales : `/private/tmp/axiom-20260911-vercel-stage.json`,
`/private/tmp/axiom-20260911-vercel-stage-dry.json` et
`/private/tmp/axiom-20260911-vercel-deploy.log`.

## Limites

Le ratio publié mesure le crédit non financier public et privé, en valeur de
marché, ajusté des ruptures et rapporté au PIB. Une baisse du ratio ne prouve
pas un remboursement nominal ; PIB et valorisation peuvent intervenir.
Les débuts d’historiques diffèrent selon les zones. Max ne complète pas les
périodes absentes et ne date pas automatiquement un supercycle.

Le transport API réutilise la clé FRED déjà configurée. Les tests ALFRED avec
cutoff antérieur à 1970 vérifient le traitement des dates sur fixtures ; ils ne
démontrent pas l’existence de millésimes BIS/FRED effectivement archivés en 1965.
La disponibilité réelle d’une vue historique reste celle fournie par ALFRED.

Aucune nouvelle fenêtre, dépendance, source réseau ou modification de proxy.
Le catalogue technique demeure à 189 indicateurs ; le catalogue macro atteint
25 familles et 96 définitions, dont 94 raccordées.
