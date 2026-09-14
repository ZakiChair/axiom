# Synchronisation des vues double et quadruple

> Exécution par agents GPT, avec tests de régression et revue indépendante.

**Objectif :** comparer des actifs distincts avec la même unité et la même période visible.

**Autorisation :** le 7 septembre 2026 à 18:12, l'utilisateur autorise GPT à poursuivre
le plan, l'implémentation et une revue indépendante en remplacement de Fable 5,
dont le quota est épuisé. Ce document ne revendique pas un visa Fable.

**Conception :** conserver un store marché par slot, la grille et KLineChart v9.8.
Étendre les préférences persistées de `chart-layout`, la liaison basse fréquence de
`chart-linking` et ajouter un petit contrôleur impératif de synchronisation du viewport.
Les événements de navigation restent hors du rendu React et du stockage persistant.

**Périmètre :** les fenêtres graphiques de la grille 1/2h/2v/2x2. La liaison existante
des symboles et le canal navigateur `BroadcastChannel` conservent leur rôle.
Aucune dépendance, source de données ou infrastructure nouvelle.

## 1. Unités et préférences — agent unités

Fichiers : `store/chart-layout.ts`, `store/chart-layout.test.ts`,
`store/chart-linking.ts`, `store/chart-linking.test.ts`, `chart/ChartGrid.tsx`,
`chart/ChartSyncControls.tsx` (commandes chargées à l'ouverture de la multivue).

- [x] Ajouter trois booléens persistés : `syncTimeframe` (false), `syncViewport`
  (false), `syncCrosshair` (true, comportement actuel). Setter
  `setSyncOption(option, enabled)` pour ces clés, migration tolérante de v1.
- [x] Exporter `demarrerSyncTimeframes(): () => void` dans `chart-linking`.
  Sur activation, aligner depuis le focus ; sur ouverture de slots supplémentaires,
  aligner depuis un slot précédemment visible. Sur changement de TF maître ou
  secondaire, propager aux autres slots visibles sans toucher aux actifs/sources.
- [x] Une source incompatible conserve son unité ; l'interface signale les unités
  différentes. Les slots masqués et ceux en replay sont exclus. Pas de récursion
  ni de rechargement induit par une écriture identique.
- [x] Ajouter les boutons accessibles « Synchroniser les unités de temps »,
  « Synchroniser le zoom et le défilement », « Synchroniser le réticule » dans
  la barre de grille, avec `aria-pressed`. Conserver le bouton des symboles.
- [x] Réintégrer la vue à la sortie du replay ou lorsque sa source redevient
  compatible, sans réimposer son ancienne unité aux autres vues.
- [x] Tests rouges puis verts : propagation bidirectionnelle, actifs distincts,
  activation, agrandissement grille, désactivation, source incompatible,
  replay et persistance des options.

## 2. Navigation et réticule — agent principal

Fichiers : `chart/viewportSync.ts`, `chart/viewportSync.test.ts`, `chart/ChartInstance.tsx`.

- [x] Exporter `bindViewportSync(chart, store, slot): () => void`.
  Registre des instances montées, activation lue dans `chart-layout`.
- [x] Capturer les dates aux bords de la zone visible par interpolation des bougies.
  Convertir ces dates dans l'historique cible, ajuster l'espacement puis le
  défilement. Les indices bruts ne sont jamais partagés entre actifs.
- [x] Publier uniquement les actions de navigation ; protéger les applications
  distantes du rebond. Coalescer en rAF. Reprendre la dernière plage après le
  chargement d'une cible ou son redimensionnement. Ne pas diffuser des données
  obsolètes pendant les chargements, ni synchroniser un slot en replay.
- [x] Brancher le contrôleur au montage de ChartInstance et le nettoyer avant
  destruction du chart. Respecter `syncCrosshair`, effacer le réticule partagé
  à la sortie de la souris et au démontage du slot émetteur.
- [x] Charger le contrôleur à la demande lors de l'activation en multivue pour
  conserver le budget initial de 670 ko. Recalculer la date du réticule pendant
  une navigation à pointeur immobile (KLineChart ne renotifie pas ce cas).
- [x] Tests rouges puis verts : historiques décalés, tailles différentes,
  absence d'écho, désactivation, chargement différé et nettoyage.

## 3. Parcours navigateur — agent validation

Fichiers : `e2e/multivue.e2e.ts` (le correctif d'unités du tour précédent y est couvert)
et `scripts/ci.sh` (inclure ces parcours hermétiques dans `pnpm check:e2e`).

- [x] Fixtures Binance avec dates régulières et mensuelles calendaires, réseau hermétique.
- [x] Vérifier la sélection longue puis la propagation depuis maître et secondaires
  en 2h/2v/2x2 ; symboles distincts, options persistées, arrêt après désactivation.
- [x] Vérifier sur les vrais charts la période visible après zoom/défilement,
  y compris des historiques d'origines différentes, et le réticule désactivable.
- [x] Exécuter `pnpm check`, les E2E ciblés puis les parcours hermétiques existants.
- [x] Revue indépendante du diff complet, correction des constats, rapport final
  des contrôles et limites. Conserver les changements locaux, sans déploiement.


## Validation finale

- `pnpm check` : types, tests monorepo et build réussis.
- `pnpm check:e2e` : 36 parcours hermétiques réussis ; les 8 multivues ont aussi
  été rejoués après le dernier correctif, tous verts.
- Régressions reproduites avant correction : unités longues absentes, commandes
  de synchronisation absentes, sens du défilement, date du réticule figée,
  sortie replay et retour d'une source compatible avec référence partagée.
- Vérification navigateur : trois dispositions, actifs et historiques distincts,
  agrégation trimestrielle calendaire, souris, réticule canvas et redimensionnement
  réel à 1440 × 900. Les réseaux sont bouchonnés ; il ne s'agit pas d'un test
  de disponibilité des fournisseurs publics.
- Entrée initiale : 669,92 ko, gzip 211,65 ko ; plafond de 670 ko inchangé.
- Revue indépendante GPT : aucun constat bloquant restant. Aucun visa Fable.
- Modifications locales, sans commit ni déploiement.

La synchronisation du viewport nécessite des données prêtes et au moins deux
bougies. Elle respecte les limites de zoom du moteur (1 à 50 px par bougie) et
n'invente aucune donnée pour une période absente. Les unités incompatibles restent
signalées ; la liaison des symboles reste un réglage distinct.
