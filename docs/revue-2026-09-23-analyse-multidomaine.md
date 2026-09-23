# Analyse multidomaine — revue du chantier du 23 septembre 2026

Le propriétaire a demandé les huit ajouts proposés après la précédente release.
Le chantier utilise les fenêtres et fournisseurs existants ; aucun ordre réel,
nouveau service, secret ou abonnement n’est nécessaire. Les changements sont
isolés sur `codex/analyse-multidomaine-20260923`, à partir de `5ff567e`.

Ce rapport décrit les capacités livrées, leurs méthodes et les limites des
vérifications. Les huit fonctions et leurs correctifs ont reçu une revue
indépendante avant leurs commits locaux.

## Lecture des calculs

| Fonction | Mesure et portée |
|---|---|
| RATE / MACRO | Variation entre M et M−3 du rythme annuel de production industrielle et du CPI, avec quatre mois consécutifs et période commune ; PIB trimestriel séparé. |
| DOM | Coût L2 hors frais pour un budget entièrement couvert dans la devise de cotation, médiane et P95 par créneaux d’une seconde, fenêtres 1/5/15 minutes. |
| CHAIN | Parts de TVL, stablecoins, DEX, frais ou revenus sur la cohorte fixe Ethereum/Solana/Base/Arbitrum ; comparaison 30/90 jours et persistance des gains de part. |
| GLOBE | Événement sourcé, canal économique choisi et condition explicite ; instruments reconnus de la watchlist. |
| BRIEF | Lectures datées, comparaison avec une référence enregistrée et rapprochements descriptifs dont les règles sont visibles. |
| SCEN | Régression jointe sur couples de dates réellement observés ; chocs de prix en pourcentage et de taux réel en points de base. |
| FUNDX | Simulation long spot / short perp de même quantité, quatre frais d’exécution, funding et basis de sortie hypothétiques. |
| EXPY | Résultats descriptifs des trades regroupés par contexte disponible au signal, avec exclusions et effectifs. |

Les calculs financiers et la causalité suivent le
[contrat de calcul](superpowers/specs/2026-09-23-analyse-multidomaine-contrat.md).
Une observation absente ne vaut jamais zéro. Une donnée courante révisée ne
reconstitue pas le contexte connu lors d’un événement passé.

## Vérification de départ

Le checkout initial a passé `pnpm check` : 6 742 tests, typage et build verts.
Le JavaScript initial pesait 1 206 551 octets bruts / 357 457 octets gzip.
Les plafonds restent 1 220 000 / 360 000 octets ; ils ne sont pas relevés.
Les 39 fenêtres, 214 indicateurs et neuf identifiants de marché sont conservés.

## Vérifications finales du 24 septembre

`pnpm check` passe avec **6 867 tests**, le typage de tous les packages et le
build web. Répartition : indicateurs 824, alertes 62, backtest 114, daemon 695,
web 5 172. Le JavaScript initial mesure **1 211 710 octets bruts / 359 300 gzip**,
soit une marge de 8 290 / 700 octets sous les plafonds existants.

Les dépendances, le daemon, `@axiom/types`, le catalogue de fenêtres et le
contrôle des plafonds ne sont pas modifiés. Les mesures proviennent du build
qui contient le dernier correctif de chargement macro progressif.

`AXIOM_E2E_PORT=5267 pnpm check:e2e` passe : **138/138 parcours Chromium**,
dont les onze nouveaux cas répartis dans six fichiers. L’exécution complète
dure 2,8 minutes. Les fixtures SCEN survivent au rechargement Vite et celles du
carry utilisent une horloge commune contrôlée ; les assertions de fraîcheur
et les seuils financiers ont été conservés.

Journaux de la session : `/tmp/axiom-analyse-final-check-3.log` et
`/tmp/axiom-analyse-final-e2e-2.log`. Copies et captures navigateur conservées
dans le répertoire local de preuves du chantier. Les changements sont prêts
sur la branche locale ; cette livraison ne comprend pas de nouvelle publication.

## Observations de revue

La première revue indépendante de MACRO et DOM a reproduit quatre défauts :
expiration arbitraire d’un millésime macro ancien, capture prématurée d’un
chargement concurrent, devise USDT incorrecte sur les autres paires Binance,
et dénominateur de couverture incohérent au créneau initial. Ces cas ont été
corrigés et couverts par des tests avant acceptation des lots. Le parcours réel
Eurostat a aussi conduit à retenir le dernier mois complet commun et à montrer
séparément le mois plus récent dont un axe manque.

La pondération des percentiles DOM a été précisée : chaque créneau valide
compte, même si la version du carnet est inchangée et toujours fraîche.
Le nombre de versions distinctes constitue seulement une information annexe.

La revue de CHAIN a fait borner la fraîcheur à la journée commune réellement
sélectionnée ; un point plus récent exclu du calcul ne rajeunit plus la preuve.
Une cohorte incomplète ne déclenche pas de chargement de prix sans dates.
La fermeture du panneau conserve les preuves acquises avec leur expiration.
MACRO, DOM et les deux fonctions du lot CHAIN/GLOBE sont acceptés en revue.

SCEN et FUNDX sont également acceptés après une revue des moteurs puis de leur
intégration. Les régressions vérifient notamment les unités de cotation forex,
l’exclusion des prix futurs, les trous conservés dans les séries et l’expiration
du carry à la plus ancienne de ses données nécessaires. Une réponse de cadence
funding invalide ne devient pas une cadence de huit heures. Les contrôles finaux
de ce lot comprennent 74 tests ciblés et trois parcours navigateur.

BRIEF est accepté avec 44 tests ciblés indépendants et deux parcours navigateur.
Sa revue a fait contrôler les dates représentables par JavaScript, normaliser la
fraîcheur à la date propre de chaque instantané et rendre exportable une archive
invalide même lorsque son contenu est une chaîne vide. Une référence historique
conserve ainsi son état à la capture ; elle ne vieillit pas artificiellement lors
de sa consultation.

EXPY est accepté après contrôle de la capture synchrone, des imports, des
provenances et des agrégats. Les dates de trade hors plage sont exclues avant
formatage ; les effectifs et exclusions restent visibles même sans dimension
archivée. Le test navigateur exerce le journal enrichi, le dossier, PAPER et
EXPY après rechargement. Le déclenchement runtime et les conflits de renfort
sont couverts par tests unitaires ; le parcours navigateur injecte son signal
de départ et ne simule pas un renfort dans l’interface.

Le contrôle commun a imposé trois migrations vers `TableTriable`, sans ajouter
d’exception au contrôle des conventions UI. Le premier build a aussi révélé
que l’export Markdown de BRIEF entraînait les calculs on-chain dans le graphe
initial via le store de régime. L’export est désormais un petit module sans
import runtime ; les plafonds de build sont conservés.

Le parcours réel a révélé une attente macro excessive dans BRIEF : 24 séries,
dont 14 acquisitions OCDE espacées de sept secondes, étaient attendues avant
la première publication. BRIEF publie maintenant chaque zone terminée, avec
compteurs de zones prêtes, en attente et indisponibles. Chaque zone possède
une limite de 120 secondes et une annulation propre ; une réponse tardive ne
peut réécrire l’instantané. Les sources et leurs cadences restent inchangées.

Les vérifications en navigateur avec données réelles ont montré le carnet
Binance et les quadrants Eurostat, ainsi que les deux carnets et le funding du
carry. Les parcours hermétiques complètent ces observations en contrôlant les
échecs, retards, trous et annulations avec des réponses déterministes. Le profil
de test est distinct du profil personnel : les sources à clé y restent
indisponibles ; le daemon refuse normalement l’origine de test au port5277.

Sur le build servi au port5278, les huit fenêtres ont été ouvertes au clavier.
La rotation réelle couvre quatre chaînes et des bornes exactes ; DOM présente
60 créneaux valides sur une minute complète. La calculatrice carry a produit
une décomposition nette conditionnelle avec des frais et coûts de sortie
explicitement saisis. Les exports JSON et Markdown de BRIEF reprennent les
mêmes dix preuves et conclusions que l’instantané affiché. Aucune exception
JavaScript n’a été observée pendant ces parcours. Les événements GLOBE restent
indisponibles sur cette origine isolée du daemon ; la qualification d’un
événement précis est vérifiée avec une fixture du panneau de détail, sans
clic du globe en canvas. SCEN et EXPY affichent leurs états sans portefeuille
ni historique dans ce profil ; leurs parcours alimentés sont hermétiques.

## Limites des sources et de l’interprétation

- La production industrielle est un proxy de croissance. Les périmètres CPI
  nationaux diffèrent ; les vues ALFRED concernent les séries compatibles.
- L2 observe la profondeur reçue pendant la consultation, sans garantie
  d’exécution future. Un carnet spot sans timestamp de marché ne reçoit pas
  une heure d’observation inventée à partir de sa réception.
- Les stocks et flux on-chain exprimés en USD ne deviennent pas des flux de
  capitaux ou des nombres d’utilisateurs. Base n’a pas de token de comparaison.
- Le scénario géopolitique reste conditionnel. Une variation de marché autour
  d’un événement ne démontre pas sa cause.
- SCEN décrit une association quotidienne avec clôtures non synchrones et
  données révisées disponibles au calcul ; aucune heure manquante n’est inventée.
- Funding futur, financement, frais et coût de sortie du carry sont des
  hypothèses visibles. Une basis de perpétuel n’a pas d’échéance garantissant
  sa convergence.
- BRIEF qualifie la divergence entre variation de part TVL et rendement du token
  de référence sur les mêmes dates closes de 30 jours. La comparaison de signes
  est descriptive et ne prouve ni transfert de capitaux ni causalité. Les autres
  domaines restent distincts lorsque leurs horizons ou propositions diffèrent.
- EXPY regroupe les états de quadrant et de divergence par dimension précise.
  Rotation et liquidité restent des valeurs continues par trade, sans seuils
  ajoutés ; la géopolitique est un contexte conditionnel affiché séparément.
  Les cohortes ne valident pas une stratégie ; les anciens dossiers sans
  preuve restent inconnus et les excursions sans trajectoire restent non mesurées.
