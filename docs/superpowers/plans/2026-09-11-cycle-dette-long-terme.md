# Cycle de la dette à long terme

Demande du propriétaire du 11 septembre 2026 : ajouter l’indicateur permettant
de voir les cycles de dette à long terme. Ajout ciblé dans MACRO / RATE →
Indicateurs, avec les transports, le cache et le graphique existants.

## Conception retenue

Une famille `dette-pib`, intitulée « Cycle de la dette à long terme », affiche
le crédit total au secteur non financier rapporté au PIB, publié par la BIS
et distribué par FRED. Le total inclut ménages, entreprises non financières et
administrations publiques. Il exclut le secteur financier. Les observations
sont trimestrielles, en valeur de marché, non désaisonnalisées et ajustées des
ruptures. Aucun ratio, filtre de tendance ou score de cycle n’est calculé localement.

L’unité est `% du PIB`, les différences sont en points de PIB. Le niveau sert
à lire l’évolution de l’endettement ; il ne date pas mécaniquement un supercycle.
Une baisse peut provenir du PIB ou de la valorisation de la dette et ne prouve
pas un remboursement nominal. Les données sont révisables.

Aux horizons 1, 5 et 10 ans s’ajoutent 30 ans, 60 ans et Max pour cette famille.
La première sélection ouvre Max. Max demande l’historique depuis 1900, mais le
graphe et les périodes affichées suivent uniquement les observations disponibles.
La sortie de cette famille remet un horizon long à 5 ans. Les bornes sont
communes au chargement et à l’affichage, y compris avant 1970 et en vue ALFRED.

## Sources vérifiées le 11 septembre 2026

Les pages FRED et leurs CSV publics ont répondu avec des séries exploitables.
Les huit séries se terminent à T4 2025 lors de cette vérification.

| Zone | Série FRED | Début observé |
|---|---|---|
| US | [QUSCAM770A](https://fred.stlouisfed.org/series/QUSCAM770A) | T4 1947 |
| Zone euro | [QXMCAM770A](https://fred.stlouisfed.org/series/QXMCAM770A) | T1 1999 |
| Royaume-Uni | [QGBCAM770A](https://fred.stlouisfed.org/series/QGBCAM770A) | T1 1966 |
| Japon | [QJPCAM770A](https://fred.stlouisfed.org/series/QJPCAM770A) | T4 1997 |
| Chine | [QCNCAM770A](https://fred.stlouisfed.org/series/QCNCAM770A) | T4 1995 |
| Inde | [QINCAM770A](https://fred.stlouisfed.org/series/QINCAM770A) | T1 1981 |
| Canada | [QCACAM770A](https://fred.stlouisfed.org/series/QCACAM770A) | T1 1990 |
| Suisse | [QCHCAM770A](https://fred.stlouisfed.org/series/QCHCAM770A) | T4 1995 |

Référence : [méthode et périmètre BIS](https://data.bis.org/topics/TOTAL_CREDIT).
Le code emprunteur `C` désigne le total ; `N` désignerait uniquement les
entreprises non financières. Les dates FRED désignent des trimestres, pas les
dates auxquelles l’encours est devenu connu. La clé FRED personnelle existante
reste requise par le transport API de l’application.

## Lots et propriétaires

1. **Développeur A — horizons et cache** : `store/macroRatesView.ts`,
   `store/macroSeries.ts`, leurs tests, `data/macro/horizon.ts`,
   `data/macro/presentation.ts`, `components/macroSeriesTab.util.test.ts`.
   Interface : `HorizonMacro = 1 | 5 | 10 | 30 | 60 | "max"` et
   `debutHorizonMacro(horizon, ancre)` ; réexport du type existant conservé.
   Raccordement final attribué : ajouter le parcours de dette à la liste
   `--e2e` de `scripts/ci.sh`.
2. **Développeur B — catalogue et affichage** :
   `data/macro/catalogueMacro.ts` et son test, `components/MacroSeriesTab.tsx`,
   `data/brief.ts` et son test, `e2e/macro-dette-long-terme.e2e.ts`.
   Séries sourcées, périodes réellement disponibles, unités lisibles,
   liens FRED et parcours navigateur avec données contrôlées.
3. **Orchestrateur — documentation et vérification** : présent plan,
   `BUILD-CONTRACT.md`, `docs/superpowers/progress/2026-09-11-cycle-dette-long-terme.md`.
4. **Réviseur indépendant** : contrôle du diff, des unités, du périmètre et
   des bornes/cache/ALFRED ; aucun fichier d’implémentation attribué.

## Critères de sortie

- [x] Huit séries `CAM770A`, fréquence trimestrielle et unité explicite.
- [x] Max affiche les observations antérieures à 1970 lorsqu’elles existent.
- [x] Horizons 30/60 ans, élargissement du cache et cutoff ALFRED cohérents.
- [x] Changement de famille/commande et format BRIEF vérifiés.
- [x] Absence de clé ou de source visible ; aucune donnée substituée par zéro.
- [x] Tests ciblés, `pnpm check`, parcours navigateur et revue indépendante.
- [x] Preuves et limites réelles consignées dans le rapport de réalisation.

Pas de nouvelle dépendance, fenêtre, fournisseur réseau, modification des
proxys, des types partagés ni des 189 indicateurs techniques OHLCV.
