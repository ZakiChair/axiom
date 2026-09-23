# AXIOM — quatre lots et ajouts du 23 septembre 2026

Périmètre confirmé par le propriétaire : « Les quatre lots, avec les ajouts ».
Les quatre corrections financières et de fraîcheur ont été terminées auparavant ;
leurs preuves restent dans [le rapport dédié](revue-2026-09-23-quatre-corrections.md).
Ce chantier ajoute les fonctions suivantes dans les fenêtres existantes.

## 1. Fiabilité et sauvegarde

NOTE et EXPY exposent les erreurs de stockage local, gardent le travail en mémoire
et proposent un réessai. Réessayer ne crée pas de doublon, ne change pas la date du
trade et n'ajoute pas après coup un prix absent lors de la saisie. Le formulaire
reste récupérable après fermeture puis réouverture de sa fenêtre.

La sauvegarde locale réussie est distincte de la réplication facultative vers le
daemon. Les corrections antérieures restent conservées : dernière bougie intrabar
du backtest, stop initial PAPER → EXPY, fraîcheur des instantanés Hyperliquid et
cadence historique du spread de funding.

## 2. Historique BT et dossiers de décision

**BT → Versions et historique** conserve des versions nommées de tous les paramètres
et archive une synthèse des runs réussis. Le calcul, son titre et son archive portent
sur la configuration figée au lancement, même si le constructeur est modifié pendant
le chargement. Restaurer une version ne déclenche aucun run.

La comparaison montre paramètres et statistiques côte à côte. Les deltas exigent
les mêmes marché, source, timeframe et bornes réelles ; les différences de coûts
et de capital restent signalées. Limites : 50 versions et 50 runs, sans éviction
silencieuse. L'archive ne stocke pas les bougies, la courbe ou toutes les exécutions.
Les valeurs infinies légitimes comme un profit factor sans perte ont un encodage
explicite. Une archive corrompue reste exportable avant son remplacement.

Le **journal des alertes → Créer un dossier** ouvre une trace dans **EXPY** : preuve
disponible au signal, thèse, invalidation et revue après le trade. L'origine reste
figée. Un ancien journal ou une preuve invalide donne un dossier partiel ; aucune
donnée actuelle ne reconstitue un contexte historique manquant.

**Préparer dans PAPER** ouvre un brouillon sans ordre. Après validation, la source
et les liens du dossier suivent l'ordre, les renforts et la clôture vers EXPY. Les
prix et fusions sont isolés par source ; les anciennes positions sans provenance
restent séparées. Les liens orphelins sont visibles. Limite : 100 dossiers sans
éviction silencieuse. BT, dossiers et PAPER sont inclus dans la sauvegarde personnelle.

## 3. Quatre indicateurs et historique du funding

Le catalogue passe de **210 à 214 définitions**, dont les 30 stratégies existantes.

| Indicateur | Lecture et limites |
|---|---|
| Liquidations / OI | Liquidations longues et courtes en % de l'OI USD observé au début du même bucket Binance/Coinalyze. Pas de report à travers les trous ; clé Coinalyze et intervalles couverts nécessaires. |
| Corrélation baissière | Corrélation centrée des rendements logarithmiques pendant les seules baisses de la référence. Prix exactement appariés, fenêtre complète et minimum de baisses exigés. |
| Bêta baissier | Covariance conditionnelle divisée par la variance de la référence pendant ses baisses. Variance nulle ou paire manquante : valeur inconnue. |
| Dispersion du funding | Écart-type population, minimum et maximum des APR réalisés de quatre places fixes : Binance, Bybit, OKX, Hyperliquid. Une place manquante rend la dispersion inconnue. |

**FUNDX → Historique 7/30/90 j** affiche la couverture effective, les trous, la
dernière observation complète et les sources. Les taux utilisent les règlements
réalisés, leurs cadences antérieures et une expiration stricte. La durée demandée
n'est pas une garantie de rétention des API. Aucun fournisseur ou abonnement n'est ajouté.
Les [contrats et oracles financiers](superpowers/specs/2026-09-23-indicateurs-contrat.md)
précisent unités, warmup et cas inconnus.

## 4. Usage quotidien

Le menu Indicateurs reçoit favoris persistés, 12 récents maximum et un filtre
« utilisables ici » combinable avec la recherche. Un ajout refusé ne devient pas
un récent. Les menus Indicateurs et Stratégies sont chargés à l'ouverture afin de
respecter le budget de chargement initial existant.

Les alertes simples, composites et de scan peuvent porter une échéance. Une alerte
expirée reste consultable, cesse de déclencher et libère ses demandes de flux exclusives.
Une fenêtre ouverte ou une autre alerte garde son propre flux. Pause/reprise ne
renouvelle pas la date ; la prolongation est explicite. Le quota des quatre scans
actifs ne compte plus les scans expirés.

DATA propose des actions propres à chaque source : ouvrir les réglages ou la vue
qui gère le chargement, consulter une documentation fixe, ou actualiser lorsqu'un
vrai rechargement existe. Une action annonce sa progression et son résultat.

## Vérification

`pnpm check` réussit sur le code final : typage de tout le monorepo, **7 416 tests**
et build web.

| Suite | Tests réussis |
|---|---:|
| Indicateurs | 1 467 |
| Alertes | 79 |
| Backtest | 128 |
| Daemon | 695 |
| Web | 5 047 |

Le chargement initial mesure **1 206 551 octets bruts / 357 464 gzip**, sous les
plafonds inchangés de 1 220 000 / 360 000. Les deux dernières adaptations concernent
uniquement les tests navigateur : noms accessibles des boutons d'ajout, puis horloge
simulée pour respecter le quota local Twelve Data lors des changements d'actif.
Les assertions métier et les limites de production sont conservées.

`AXIOM_E2E_PORT=5262 pnpm check:e2e` réussit : **127 scénarios Chromium sur 127**,
dont les **24 nouveaux** répartis dans sept fichiers, sans échec ni scénario ignoré.
Les serveurs de vérification ont été arrêtés après les parcours. Journaux :
`/tmp/axiom-quatre-lots-final.log` et `/tmp/axiom-quatre-lots-e2e.log`.

Toutes les tâches A–G et leurs correctifs sont acceptés en revue indépendante des
auteurs. Les vérifications visuelles couvrent DATA, comparaison BT, dossier EXPY,
brouillon PAPER, filtres et historique FUNDX complet. La revue financière vérifie
notamment les unités, l'absence de données futures, les trous, les cohortes incomplètes
et la conservation du risque initial. Les tests d'expiration couvrent aussi les
requêtes déjà en vol, les notifications après journal et une échéance franchie
pendant l'installation du minuteur React.

Les parcours navigateur utilisent des réponses simulées : ils vérifient les usages
et les défaillances, sans garantir la disponibilité en direct de chaque fournisseur.
La couverture effective du funding reste bornée par la rétention amont. Les requêtes
déjà parties peuvent terminer après expiration ; leurs résultats sont ignorés et
aucune acquisition funding suivante n'est lancée. Ce rapport ne vaut pas validation
manuelle G100 de toutes les fonctions historiques du terminal.

Les changements préexistants sont conservés ; aucun commit, push ni déploiement.
La comparaison avec la copie initiale ne montre aucune suppression ; aucune dépendance
ou règle de proxy n'a changé. `git diff --check` réussit.

**Le daemon déjà lancé n'a pas été redémarré.** Il faut le redémarrer pour charger les
changements serveur, notamment l'expiration des alertes et la fraîcheur Hyperliquid.
Les vérifications du daemon ont été exécutées séparément sur le nouveau code.
