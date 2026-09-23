# AXIOM — exécution des quatre lots complets

**Objectif :** achever les fonctions de la revue explicitement autorisées par le propriétaire.
**Spécification :** `docs/superpowers/specs/2026-09-23-quatre-lots-design.md`.
**Architecture :** fenêtres existantes, stores vanilla persistés, indicateurs purs,
modules paresseux, transports existants. Aucun commit des changements antérieurs.

## Contraintes et revue

Un responsable par fichier. Développeurs Sol ; réviseur indépendant Astra. Le contrôleur
documente et arbitre. État initial sauvegardé et 7 283 tests déjà verts. Aucune dépendance,
notification réelle, opération de trading, publication ou migration d'infrastructure.
Maintenir les plafonds 1 220 000 / 360 000 octets initiaux. Les erreurs de quota, objets
anciens/corrompus, changements de contexte pendant une requête, dates futures, trous
et sources partielles sont des cas d'acceptation, pas des zéros implicites.

## A — Sauvegardes NOTE / EXPY (développeur B)

Fichiers : `apps/web/src/store/{notes,expy}.ts` et tests,
`apps/web/src/components/{NotesWindow,ExpyWindow}.tsx`, tests ciblés/SSR et
`apps/web/e2e/quatre-lots-sauvegardes.e2e.ts`.

Produire statut d'écriture locale, erreur lisible et méthode de réessai idempotente.
Les anciens appelants PAPER restent compatibles. Saisie récupérable et identifiant
stable pour une création échouée.

```ts
// Quota simulé : l'objet existe en mémoire, le stockage ne contient pas un faux succès.
expect(store.getState().erreurSauvegarde).not.toBeNull();
// Après rétablissement, réessayer ne crée pas un deuxième objet.
expect(store.getState().notes).toHaveLength(1);
```

Écrire/rendre rouges les régressions quota/absence de stockage/édition/import ; implémenter
les stores puis les contrôles de reprise. Exécuter ciblés et typecheck, revue indépendante.
Le lot libère EXPY avant le dossier de décision.

## B — Versions et historique BT (développeur A, parallèle à A)

Fichiers : `apps/web/src/store/backtest.ts`, `backtestSignature.ts` et tests associés,
`components/BacktestWindow.tsx`, nouveaux `data/backtestArchive.ts`/test,
`store/backtestHistory.ts`/test, `components/BacktestHistory.tsx`,
`apps/web/e2e/quatre-lots-backtest.e2e.ts`.

Produire snapshot immuable de `ConfigRun`, versions complètes, archives synthétiques
de 50 runs, codec des valeurs infinies, export et comparaison. Aucun changement du
moteur `packages/backtest` dans ce lot. En-tête et archive utilisent le snapshot lancé.

```ts
expect(archive.config).toEqual(configAuLancement);
expect(archive.signature).toBe(signatureRun(configAuLancement));
expect(rechargerVersion(version)).toEqual(configAuLancement);
// Fenêtres différentes : comparaison descriptive, pas de delta prétendument comparable.
expect(comparaison.comparable).toBe(false);
```

Régressions snapshot malgré édition/annulation, version complète, Infinity round-trip,
quota/corruption sans perte, deux runs distincts et comparaison. Ciblés, typecheck,
revue indépendante avant de greffer les dossiers.

## C — Indicateurs et dispersion historique (développeur B après A)

Fichiers réservés : nouveaux indicateurs/tests dans `packages/indicators/src/{derivatives,statistical}`,
helper pur `statistical/downsideMoments.ts` et test,
`packages/indicators/src/{registry,index}.ts` et tests de catalogue, ajout étroit d'aux dans
`packages/types/src/index.ts`, `apps/web/src/chart/auxProvider.ts` et test,
`apps/web/src/lib/indicatorUsability.ts` et test, `components/IndicatorMenu.tsx`
(classement des nouveaux defs uniquement) et `IndicatorMenu.sousGroupes.test.ts`, `components/FundingMatrixWindow.tsx`,
nouveaux `data/fundingHistory.ts`/test, `data/fundingDispersion.ts`/test et
`components/FundingHistory.tsx`, `apps/web/e2e/quatre-lots-funding-indicateurs.e2e.ts`.
Après revue, normaliseur pur commun `data/fundingIdentity.ts`/test : seules identités
BASEUSDT et BASE-PERP admises pour la cohorte CEX USDT + Hyperliquid natif, cache canonique
partagé et disponibilité identique entre le chart et FUNDX. Aucun alias de multiplicateur
inventé ; pas d'assouplissement des contraintes des auxiliaires OI/liquidations.
Extension de rendu après revue : `chart/annotationsPane.ts`/test et champ optionnel
de `LabelAnnotation` dans types pour ancrage vertical haut de pane, indépendant de
l'axe financier. Le label de couverture doit rester visible quand les dernières
observations manquent ; comportement des annotations existantes inchangé par défaut.
Extension autorisée au scan : `data/binanceFunding.ts`/test, uniquement pour assurer
le rejet au délai de 8 s même si le corps JSON n'honore pas l'abandon du transport.

Contrat financier détaillé : `docs/superpowers/specs/2026-09-23-indicateurs-contrat.md`,
validé par le réviseur indépendant avant implémentation. L'export `index.ts` est limité
au cœur pur partagé entre l'indicateur et la vue FUNDX.
Aux approuvés après scan : `oiDebutLiqUsd`, `refCloseStrict`, `fundingHistBinance`,
`fundingHistBybit`, `fundingHistOkx`, `fundingHistHl`. Les quatre derniers conservent
leur expiration stricte sans modifier le contrat des aux legacy.

Le réviseur fournit préalablement les formules, unités et endpoints officiels. Jeux
numériques : 100 USD de liquidations / 10 000 USD d'OI = 1 % ; rendements x=2y sur les
baisses donnent bêta2/corrélation1 ; une cohorte APR [0,2,4,6] a écart-type sqrt(5).
Un point manquant ne remplace ni volume, ni prix, ni taux par zéro.

Tests rouges puis verts : appariement exact, trous, variance nulle, minimum de baisses,
condition sur la référence, cohortes incomplètes, cadence historique et expirations,
pagination bornée, données OKX réalisées. Vérifier préfixe causal et unités avant rendu.

## D — Dossier de décision (développeur A après A/B)

Fichiers : nouveaux `data/decisionDossier.ts`/test, `store/decisionDossiers.ts`/test,
`components/DecisionDossiers.tsx`, `store/alerts.ts`/test, `alerts/runtime.ts`/test,
`components/AlertsPanel.tsx`, `data/paper.ts`/test, `store/paper.ts`/test,
`components/PaperWindow.tsx`, `data/expy.ts`/test, `store/expy.ts`/test,
`chart/paperLignes.ts`/test (filtre de provenance et notification au changement de source),
`components/ExpyWindow.tsx`, `data/sauvegardeLocale.ts`/test et tests de restauration,
`apps/web/e2e/quatre-lots-decisions.e2e.ts`.

Capturer la preuve lors du déclenchement ; dossier persistant dans EXPY ; brouillon PAPER
sans ordre ; `decisionIds` optionnels et union au renfort ; liens visibles après clôture.
Inclure les clés nouvelles dans la sauvegarde personnelle existante. Préserver A.

```ts
expect(paperStore.getState().ordres).toHaveLength(0); // simple préparation
expect(positionRenforcee.decisionIds).toEqual([idA, idB]);
expect(tradeCloture.decisionIds).toEqual([idA, idB]);
expect(dossier.origine.ts).toBe(declenchement.ts); // pas Date.now() après coup
```

Tests origine après suppression de l'alerte, contexte partiel, absence de données futures,
instrument compatible, anciens imports, quota et réessai, fusion et clôtures TP/SL/manuelle.

## E — Expiration (développeur A après D)

Fichiers : `packages/alerts/src/{types,engine,index}.ts` et tests,
`apps/web/src/store/{alerts,presetAlerts}.ts` et tests, `alerts/runtime.ts` et tests
(dont transition heartbeat), `components/AlertsPanel.tsx`, `components/ScreenerWindow.tsx`
(création d'alertes de scan), `components/SessionStrip.tsx` et test,
`alerts/useExpirationClock.ts` et test éventuel (réveil visuel partagé si nécessaire),
`store/orderflow.ts` et test, `chart/orderflow.ts` et tests, `chart/ChartInstance.tsx`
et tests ciblés, `store/persist.test.ts` (vérifier la demande CVD transitoire),
`apps/daemon/src/{alerts,liqFeed,hlLiqHeat}.ts` et tests,
`apps/web/e2e/quatre-lots-alertes.e2e.ts` (port 5248).

Échéance optionnelle, prédicat commun et validation fini/positif, libération des souscriptions,
UI expirée et prolongation explicite. Pas d'envoi réel.

Contrat détaillé issu du préflight indépendant :
`docs/superpowers/specs/2026-09-23-expiration-contrat.md`.
Après gel D, autoriser d'abord les fichiers disjoints (package alerts, daemon,
orderflow, ChartInstance, SessionStrip et presetAlerts). Les fichiers D restent
gelés jusqu'au verdict. Un auteur Sol garde tout E ; il exerce le rôle développeur
front et le rôle développeur daemon selon le sous-lot.

```ts
expect(evaluerAlertes([alerteAvecEcheance], contexteALaDateExacte).declenchements).toEqual([]);
// La même frontière vaut au redémarrage et dans le daemon, pas uniquement en UI.
```

## F — Favoris, récents et budget (développeur B après C)

Fichiers : `apps/web/src/components/IndicatorMenu.tsx` et tests, nouveaux
`store/indicatorPreferences.ts`/test, helpers de filtre/tests, `components/Toolbar.tsx`,
`components/StrategyMenu.tsx` et extraction éventuelle de l'éditeur commun,
`components/InstanceParamsEditor.tsx`, `lib/indicatorMenuFilters.ts`/test,
`apps/web/e2e/quatre-lots-indicateurs.e2e.ts`, `scripts/ci.sh` (ajouter les sept nouveaux
parcours à la branche `--e2e`, sans modifier les commandes préexistantes).
Extension d'intégration : `apps/web/e2e/corrections-revue.e2e.ts`, seulement les deux
helpers VWAP/Pivot du catalogue et leur commentaire. Utiliser le nom accessible
explicite « Ajouter … » désormais distinct de l'action Favori ; préserver toutes
les assertions de chargement d'historique, idempotence et navigation.

Préférences validées contre le registre, récents bornés sans doublon, ajout réellement
effectué avant marquage récent. Favoris/recherche/utilisabilité combinables ; clavier et
raison d'indisponibilité préservés. Déplacer les parties de menu au chargement à l'ouverture
si nécessaire, sans importer en retour les gros modules par l'éditeur commun.
Clé `axiom:indicatorPreferences:v1`, 12 récents maximum ; erreur d'écriture visible et
réessai explicite. Pendant la revue C, les nouveaux helpers/store, Toolbar et StrategyMenu
peuvent avancer ; `IndicatorMenu.tsx` reste gelé jusqu'au verdict C. Une extraction
provisoire du composant partagé ne supprime sa définition d'origine qu'après libération.
Le chargement de FootprintSettingsPanel peut aussi être différé depuis Toolbar, sans
modifier son implémentation ; un premier geste ouvre le panneau et les erreurs sont visibles.

## G — DATA actionnable (développeur Astra, parallèle à A/B)

Fichiers : `apps/web/src/components/DataWindow.tsx`, nouveaux
`data/dataActions.ts`/test, `apps/web/e2e/quatre-lots-data.e2e.ts`.

Actions fondées sur les capacités vérifiées : `ecoStore.refresh(true)` pour ECO,
Réglages pour les clés configurables, fenêtre propriétaire quand le rafraîchissement
vit dans celle-ci, documentation publique fixe sans clé. Aucun appel au simple rendu.
Erreurs/motifs lisibles, action en cours et résultat/échec annoncés. Conserver le tick
d'affichage 10 s et l'absence de rendu sur chaque message WS. Tests capacités inconnues,
URL sûres, exécution réelle du callback, échec indépendant et navigation effective.
Revue par un Sol indépendant (Astra ne revoit pas sa propre production).

## Intégration finale

Revue indépendante de chaque lot et des interfaces A↔D, D↔E, C↔F. Mise à jour du contrat,
rapport utilisateur et nombres réels du catalogue. `pnpm check`, parcours navigateur
isolés des nouvelles fonctions, revue visuelle et contrôle du manifeste de fichiers.
Pas de commit global, push ou déploiement ; pas de réécriture des historiques anciens.

Extension de vérification attribuée au développeur A après diagnostic de la CI :
dans `apps/web/e2e/sources-automatiques.e2e.ts`, seul scénario USOIL, piloter l'horloge
Playwright pour espacer les sélections d'actifs d'une minute. La fenêtre de quota
locale Twelve Data de 8 appels/60 s est partagée entre prix et historique : huit
créneaux avaient été consommés avant SPY. Garder toutes les identités et assertions,
sans modifier la limite de production ou augmenter les délais d'assertion.

## Résultat

Les sept tâches A–G sont réalisées et acceptées en revue indépendante. Vérification
intégrée : `pnpm check` vert (7 416 tests, typage et build) et `pnpm check:e2e` vert
(127/127 scénarios, dont 24 nouveaux). Budget initial 1 206 551 / 357 464 octets
bruts/gzip, plafonds inchangés. Rapport et limites :
`docs/revue-2026-09-23-quatre-lots.md`. Aucun commit, push, déploiement ou redémarrage
du daemon utilisateur n'a été effectué.
