# Outils d'analyse — 1 octobre 2026

Demande du propriétaire : ajouter des indicateurs/fonctions utiles pour les
analyses polyvalentes, intraday et swing. Le lot complète les 215 définitions
existantes avec trois mesures calculées sur les bougies déjà disponibles.

## Accès

Dans **Indicateurs → Techniques → Préréglages d’analyse**, ouvrir la section
repliée puis choisir parmi trois configurations facultatives :

| Configuration | Contenu | Utilité |
| --- | --- | --- |
| Polyvalent | EMA 20 + autocorrélation sur 50 rendements | Lire la tendance avec la persistance ou l'alternance récente des variations |
| Intraday | EMA 20 + compression NR 7 / Inside Bar | Repérer une amplitude resserrée dans son contexte de tendance |
| Swing | EMA 50 + repli sur 100 clôtures | Situer le cours sous son sommet récent et mesurer la hausse nécessaire pour le retrouver |

Ces périodes désignent des bougies ou rendements du graphique, et non des jours.
Les configurations ajoutent les éléments manquants à la sélection active. Elles
préservent les réglages et jeux personnels. Si la place manque pour le panneau
supplémentaire, l'ajout est refusé avec une explication. L'annulation retire
uniquement les instances ajoutées par cette action et restées non modifiées.
Une instance retirée puis recréée personnellement est aussi préservée.

Chaque indicateur peut également être recherché et ajouté séparément, puis
paramétré avec l'éditeur habituel. Aucun changement automatique de symbole,
d'unité de temps ou de disposition n'est effectué.

## Compression NR / Inside Bar

NR 7 vaut **1** lorsque l'amplitude haut−bas de la bougie est la plus petite des
sept dernières bougies, courante comprise ; les égalités sont acceptées. La
période est réglable de 2 à 100. Avant une fenêtre complète, la valeur est absente.

Inside vaut **1** lorsque le haut est strictement inférieur au haut précédent et
le bas strictement supérieur au bas précédent. Cette seconde mesure n'a besoin
que de deux bougies. Une égalité sur un bord ne compte pas comme Inside.

Les deux états peuvent coïncider. Ils décrivent une compression relative sans
prédire la direction d'une cassure. Un plateau d'amplitudes identiques satisfait
NR ; cela ne prouve pas la liquidité du marché.

Références : [Narrow Range — Sierra Chart](https://www.sierrachart.com/index.php?ID=166&page=doc/StudiesReference.php)
et [Inside Bar — Sierra Chart](https://www.sierrachart.com/index.php?ID=92&page=doc/StudiesReference.php).
Sierra compte les barres précédentes ; notre période inclut la courante.

## Autocorrélation des rendements

ACF de retard 1 sur les rendements logarithmiques, selon la
[formule du NIST](https://itl.nist.gov/div898/handbook/eda/section3/eda35c.htm).
La moyenne est calculée sur toute la fenêtre ; le numérateur additionne les
produits des écarts adjacents et le dénominateur tous les écarts au carré.

Une valeur positive décrit une liaison positive entre rendements adjacents ;
une valeur négative décrit leur alternance. Elle ne donne pas le sens du prix
ni un signal de trading validé. Aucune bande de significativité n'est ajoutée.

Une période de 50 exige 51 clôtures à pas temporel régulier. Les prix non positifs,
la variance indéterminable ou les intervalles irréguliers rendent la mesure
absente avec une explication. Les week-ends et fermetures des marchés tradfi
peuvent donc interrompre la série ; les mois de durées différentes aussi.

## Repli au sommet glissant / récupération

Le sommet est le maximum des **clôtures** de la fenêtre, pas celui des mèches.
Le repli vaut `100 × (cours / sommet − 1)` ; la hausse nécessaire pour retrouver
ce sommet vaut `100 × (sommet / cours − 1)`.

Exemples : de 100 à 80, le repli est −20 % et la hausse nécessaire +25 % ; de
100 à 50, ils valent −50 % et +100 %. Cette hausse est une distance arithmétique,
pas un objectif de cours.

Lorsque l'ancien sommet sort de la fenêtre, le repli peut revenir à zéro sans
hausse du cours. La mesure n'est donc ni un ATH universel, ni le drawdown maximal
d'un compte. Elle complète l'Ulcer Index existant, qui agrège les replis passés.
La [définition du drawdown relatif](https://arxiv.org/html/1710.01503#S2) est ici
adaptée à une fenêtre de clôtures et à un signe négatif explicite.

## Conventions et validation

Les trois mesures attendent les bougies clôturées. Une bougie en formation ne
produit pas de valeur confirmée. Les trous ne sont pas comblés et les timestamps
invalides ou non croissants invalident les fenêtres concernées. NR et repli
portent sur les observations disponibles ; seule l'ACF exige une cadence constante.

Dans les alertes, ces trois mesures exigent une valeur à la dernière bougie
évaluée, et deux valeurs consécutives pour un croisement. Une ancienne valeur
avant une interruption ne doit pas être réutilisée comme valeur courante.

Le lot utilise le moteur et le rendu existants. Aucun nouveau fournisseur,
abonnement, secret, dépendance ou calcul d'exécution n'est ajouté. Le catalogue
de stratégies backtest n'est pas étendu par ces configurations visuelles.

Les trois formules ont été comparées à un oracle indépendant en arithmétique
décimale : **294 cas, 18 521 valeurs**, sans divergence. **5 636 contrôles**
complètent la vérification de pureté, alignement et causalité par préfixe/futur
perturbé. Neuf scénarios d'intégration avec le moteur backtest vérifient également
qu'un signal confirmé ne s'exécute qu'à l'ouverture suivante, sans modifier ce
moteur ni proposer de nouvelle stratégie.

Un second oracle compare **4 698 décisions d'alertes**, dont **1 200 cas non
évaluables** : absence de reprise d'une valeur périmée et conservation de
l'armement vérifiées, sans divergence.

Mesure indicative sur ce poste, Node 24.13.0, 10 000 bougies : les trois calculs
aux paramètres par défaut totalisent environ 8,6 ms de médianes. Les fenêtres
maximales portent ce total à environ 67,8 ms. Cette mesure locale, sensible au
JIT/GC, n'est pas une garantie de latence sur téléphone ; les configurations
proposées emploient les paramètres par défaut.

Les revues indépendantes des calculs/alertes et du frontend sont favorables.
Le contrôle global `pnpm check`, sous Node 24.13.0, passe : types, **8 431 tests**
(1 570 indicateurs, 139 alertes, 143 backtest, 779 daemon, 5 800 web) et build.
Le parcours dédié au menu passe **11/11** ; les quatre nouveaux parcours
tactiles passent sur Chromium/WebKit en 320 et 390 px. La suite mobile complète
passe : **43 réussis, un test de geste natif WebKit déjà non pris en charge ignoré**.
La suite bureau intégrée passe **159/159** en 3,4 minutes, sans nouvelle tentative.
Le décompte local des tests inclut les artefacts de compilation préexistants des
packages ; pour les seules sources indicateurs, 927 tests passent.

Les plafonds restent à **1 220 000 octets bruts / 360 000 gzip niveau 9** :

| JavaScript initial | Brut | Gzip |
| --- | ---: | ---: |
| Build local final | 1 201 440 | 358 781 |
| Build final en mode Vercel | 1 196 609 | 357 094 |

Les cartes et explications restent dans le menu chargé à la demande. Le contrôle
des cinq secrets disponibles sur 1 894 fichiers de sources et de build ne trouve
aucune occurrence. Aucune valeur de clé n'est ajoutée au code client.

Application : [AXIOM](https://axiom-iota-vert.vercel.app).
Les vérifications distantes sont consultables dans la
[CI du dépôt](https://github.com/ZakiChair/axiom/actions/workflows/ci.yml).

## Contrôle de publication : clés au premier chargement

La [CI du lot d'indicateurs](https://github.com/ZakiChair/axiom/actions/runs/36836101664)
est passée pour `ab60971`. Les trois préréglages ont été exercés sur le déploiement
Vercel : ajout, absence de doublon d'EMA, annulation et tracé de compression réel.

Ce contrôle a révélé une limite préexistante : la requête `/api/config` était
annulée après deux secondes. Une réponse serveur tardive pouvait donc laisser
les capacités indisponibles jusqu'au rechargement, même avec les cinq clés
configurées en production. Le premier rendu conserve son attente maximale de
deux secondes ; la requête continue désormais en arrière-plan avec un délai
borné de quinze secondes et une seule reprise après panne transitoire.
L'accueil et les capacités se mettent à jour à l'arrivée de la réponse, en
préservant une éventuelle saisie personnelle en cours. Seuls les booléens de
présence circulent dans cette configuration.

La revue indépendante du correctif est favorable : **39 contrôles** couvrent
notamment l'abandon ignoré, un corps JSON tardif, la concurrence et une ancienne
réponse arrivant après la reprise. Cinq parcours navigateur vérifient les clés
serveur/personnelles, la réponse retardée après montage, ainsi que la
conservation d'un brouillon ou d'un champ simplement focalisé.

Après ce complément, `pnpm check` repasse sous Node 24 : **8 440 tests locaux**
(dont 5 809 web), typage et build. Les parcours de démarrage, clés et menu
d'indicateurs repassent **23/23**, ainsi que les **4/4** parcours des préréglages
sur Chromium/WebKit mobiles. Le build Vercel final est également validé sous
les mêmes plafonds.
