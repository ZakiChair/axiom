# AXIOM sur navigateur de téléphone — 28 septembre 2026

## Demande et périmètre

Rendre les outils existants utilisables sur téléphone, en portrait comme en paysage,
sans modifier les sources de données, les calculs financiers ni les dispositions
enregistrées pour le bureau. Conserver les thèmes et les composants du terminal.
Aucune dépendance supplémentaire.

## Constats avant correction

Audit Chromium avec émulation tactile, viewport 390 × 844 :

- L'en-tête occupe 374 px ; la zone principale commence à 448 px et ne dispose
  plus que de 396 px avant même l'ouverture d'une fenêtre.
- La barre latérale disparaît sous 640 px : watchlist, alertes, comparaison et
  diagnostic des sources perdent leur accès visible.
- Les fenêtres flottantes restent disposées comme sur ordinateur. Un balayage
  des 39 entrées du registre retrouve des fenêtres commençant à x = 48 px avec
  une largeur de 366 px, au-delà des 390 px disponibles.
- Le constructeur de séries synthétiques a une largeur fixe de 30 rem.
- Des commandes de watchlist et de suppression d'alertes dépendent du survol.
- Les tableaux utilisent parfois des colonnes fixes sans défilement horizontal
  commun à l'en-tête et au corps ; certains en-têtes écrasent leur titre.
- Les dispositions multi-graphiques divisent encore le petit écran en plusieurs
  cellules ; les commandes flottantes recouvrent le graphique.

Ces constats sont des observations d'interface, avec les API neutralisées pour
le balayage des fenêtres. Ils ne valident pas la disponibilité des fournisseurs.

## Principes de correction

1. En-tête compact, accès explicite aux options et navigation tactile vers les
   fonctions, la recherche, les panneaux et les dessins.
2. Une fenêtre active occupe l'espace de travail mobile ; ses boutons de fermeture
   et de réduction restent accessibles. La géométrie bureau n'est pas réécrite
   par le passage sur téléphone.
3. Les graphiques d'une disposition se consultent individuellement sur mobile.
   Le choix de disposition et les instruments enregistrés restent conservés.
4. Menus et dialogues bornés au viewport, fermeture tactile, formulaires lisibles
   et tableaux larges défilant dans leur propre conteneur.
5. Hauteur dynamique du navigateur et marges de sécurité du téléphone prises en
   compte ; les interactions souris et clavier restent disponibles sur ordinateur.

## Résultat fonctionnel

- Navigation inférieure : Fonctions, Recherche, Panneaux, Dessins et Réglages.
  Les outils de graphique supplémentaires sont dans Options ; les réglages
  Footprint disposent d'un bouton explicite.
- Les fenêtres se réduisent, se restaurent et se ferment au toucher. La barre
  des fenêtres permet de revenir au graphique. Les tiroirs se ferment quand
  une autre fenêtre est demandée.
- Les notes et formulaires restent conservés pendant la navigation ou la
  réduction. Les réglages non enregistrés survivent aussi au passage entre
  téléphone et bureau ; cette conservation ne les enregistre pas automatiquement.
- Une disposition de quatre graphiques se consulte avec les onglets Vue 1 à 4.
  Le focus des dessins suit la vue choisie, sans écraser les instruments.
- Recherche, indicateurs, stratégies, palettes et réglages utilisent des menus
  cadrés à l'écran ; le clavier, les flèches et le retour de focus de la recherche
  sont conservés. Les tableaux larges défilent localement.
- Les graphiques canvas des fenêtres affichent une lecture au contact. Les
  graphiques concernés permettent le déplacement horizontal tout en laissant
  le navigateur faire défiler verticalement leur panneau.
- À 390 × 844, le graphique dispose désormais de 653 px de hauteur lorsque les
  fenêtres sont fermées, contre environ 396 px avant correction. À 844 × 390,
  la zone principale dispose de 284 px ; les bandes secondaires sont masquées.

## Répartition

- Lot shell : App, barres de navigation, fenêtres, hauteur et styles globaux.
- Lot graphiques : grille, slots, bandeau du symbole et commandes graphiques.
- Lot surfaces : primitives partagées, menus, recherche, dialogues, tableaux et
  actions auparavant réservées au survol.
- Vérification : parcours tactiles, balayage des fenêtres, portrait/paysage,
  non-régression bureau, typage et contrôles du dépôt, revue indépendante.

## Validation

### Contrôles reproductibles

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Typage, tests et compilation | `pnpm check` | Réussi, 8 189 tests : indicateurs 1 487, alertes 79, backtest 128, daemon 756, web 5 739 |
| Parcours téléphone Chromium et WebKit | `./scripts/ci.sh --mobile` | 39 réussis, 1 exclu explicitement |
| Parcours bureau | `pnpm check:e2e` | Réussi, 151 parcours sur 151 en une exécution complète (3,3 min) |
| Format du diff | `git diff --check` | Réussi |

La suite téléphone dispose de sa propre configuration Playwright et n'est pas
incluse dans le gate bureau. Le lancement final a utilisé le port 5281 et une
sortie temporaire dédiée. Le seul test exclu concerne le glissement tactile natif
sous WebKit : son injection utilise une API CDP disponible uniquement sous
Chromium. Le même geste déplace réellement les bougies dans le test Chromium.

Couverture : ouverture/réduction/restauration/fermeture, tiroirs et retour au
graphique, conservation des notes et formulaires, alerte, recherche et SYN,
indicateurs, stratégies, comparaison, quatre vues et focus des dessins,
réglages, onboarding, lecture canvas au toucher, rotation et géométrie bureau.

Le build initial atteint **1 204 842 octets bruts / 358 172 gzip**. Les plafonds
existants restent **1 220 000 / 360 000**, sans modification du budget.
La mesure de publication sous **Node 24.13.0 / zlib 1.3.1** confirme le respect
du budget : **1 204 842 octets bruts / 359 520 gzip**. Cette dernière mesure fait
référence pour la production ; Node 26 local utilise une autre version de zlib.

### Vérifications complémentaires et revue

- Balayage des **39 fenêtres × 4 tailles × 2 moteurs = 312 ouvertures** :
  320 × 740, 390 × 844, 844 × 390 et 1440 × 900, sur Chromium et WebKit.
  Aucun cadre hors viewport, aucune fermeture masquée lors du hit-test,
  aucune erreur JavaScript de page, aucune largeur de document supérieure à
  celle du viewport.
- Lecture visuelle des captures et smoke test avec données réelles : BTCUSDT,
  Binance, 1 minute, 504 bougies observées, puis 500 au rechargement final,
  avec bougies et volumes effectivement visibles. Les cinq thèmes restent cadrés sur
  téléphone ; ce contrôle ne constitue pas un audit exhaustif de contraste.
- Revue indépendante du diff, puis revalidation des correctifs sur les deux
  moteurs : navigation clavier/ARIA et retour de focus de la recherche,
  conservation des brouillons, tiroirs ne masquant plus la fenêtre demandée,
  maintien des dispositions et des instruments du bureau.
- Le parcours bureau de reprise du catalogue au focus a exposé une régression
  d'Échap (saisie effacée) et une course de fermeture après un refocus rapide.
  La saisie est de nouveau conservée et le délai de fermeture est annulé au
  focus. Les 22 parcours `sources-automatiques` ont réussi après correction,
  sans modifier leurs assertions ; un contrôle runtime confirme que les
  résultats restent ouverts au-delà des 150 ms de fermeture différée. La revue
  indépendante finale confirme ces comportements au bureau et sur téléphone,
  dans Chromium et WebKit, ainsi que la fermeture tactile et le raccourci `/`.
- Deux assertions bureau préexistantes, dans `quatre-lots-decisions` et
  `analyse-expy`, inspectaient aussi un UUID aléatoire lors du contrôle du prix
  futur `150` : un identifiant contenant `150` déclenchait un faux échec. Elles
  ciblent désormais le contexte de marché et confirment aussi le plus haut
  `99` à l'écran et dans le dossier enregistré. La protection contre les
  données futures reste vérifiée ; trois répétitions isolées de chaque test
  ont réussi et une revue indépendante confirme la portée des assertions.

Les journaux, captures et le script de balayage locaux sont conservés dans
`.playwright-mcp/mobile-2026-09-28/` (répertoire ignoré par Git).

### Limites

Les parcours automatisés utilisent l'émulation tactile Chromium/WebKit et des
réponses réseau contrôlées. Le balayage géométrique neutralise les fournisseurs :
il ne prouve pas la disponibilité de chacune de leurs API. Le smoke test réel
complète ce contrôle pour le graphique principal. Aucun téléphone physique n'a
été utilisé ; clavier logiciel, encoche et gestes système restent à confirmer
sur appareil réel.

À 320 px sous WebKit, les cartes ONCHAIN « Flux de capitaux » utilisent 13 px du
padding droit ; tous leurs textes et contrôles restent dans la zone visible et
le conteneur ne déborde pas. Le défilement interne de la valeur d'un champ
numérique Screener est natif. Des débordements internes préexistants sur bureau
dans CORR, ONCHAIN et BRIEF ne sont pas couverts par cette adaptation mobile.

Ce rapport décrit les vérifications réalisées avant publication. Le propriétaire
a autorisé l'intégration dans `main` et le déploiement en production le
28 septembre 2026. La cible existante est le projet Vercel `axiom`, relié au dépôt
GitHub `ZakiChair/axiom` et à sa branche de production `main`.
