# Améliorations de la revue AXIOM — 30 septembre 2026

Suite autorisée par le propriétaire sur la base de `08b30d6`, avec maintien du
fonctionnement existant et du lien public. Les quatre lots portent sur les
statistiques de backtest, la fraîcheur Finnhub, les contrôles mobiles et le
chargement initial. Aucun fournisseur, package ou calcul de stratégie ajouté.

## Backtest : dates et excursions

Le store transmet désormais la clôture réelle de la dernière bougie aux runs
à unité de temps fixe, indépendamment de l'activation du funding. Sur le cas
de trois bougies horaires de la revue, la position ouverte à 1 h et fermée à
3 h dure bien 2 h : exposition 66,67 %, au lieu de 1 h et 50 % auparavant.
Les périodes calendaires ne sont pas assimilées à une durée fixe.

Pour les stops/objectifs intrabar, les extrêmes de la bougie de sortie ne sont
plus supposés atteints avant l'exécution. Les barres entièrement détenues,
l'ouverture de sortie et le prix exécuté fournissent les excursions confirmées.
Les valeurs sont qualifiées comme bornes : MAE réelle ≤ valeur affichée, MFE
réelle ≥ valeur affichée. Le mode à clôture et les gaps gardent leur traitement.

Les trades et leurs moyennes affichent cette qualification ; le compteur de
trades partiels survit à l'archivage, l'export et la relecture. Les deltas de
MAE/MFE entre archives sont masqués lorsqu'ils compareraient des bornes. Les
archives antérieures restent lisibles ; la version du moteur distingue les
nouvelles statistiques des anciennes.

Le réviseur a enregistré avant correction puis rejoué **48 scénarios / 600
trades**. L'empreinte des exécutions, PnL, frais, funding, quantités, R et équité
est identique. Durée, exposition, excursions et statistiques dépendant de la
durée peuvent changer conformément aux corrections. Les horodatages intrabar
restent ceux du modèle existant : ces changements ne prétendent pas reconstituer
un chemin de prix absent des bougies OHLC.

## Finnhub : repli explicite

En cas de refus d'accès, quota, panne ou réponse de calendrier invalide, les
données déjà disponibles restent affichées avec leur date de récupération et
le motif du repli. Une liste vide périmée garde aussi son avertissement. Une
reprise réussie remplace données et qualification ensemble.

Les caches datés dans le futur, négatifs ou non finis sont écartés localement.
Les annulations ne réécrivent pas le cache avec une réponse obsolète. Les
messages sont contrôlés : ni réponse fournisseur ni URL avec clé n'est affichée.
Les priorités entre clé personnelle et clé serveur restent inchangées.

Les vérifications réseau Finnhub utilisent des réponses simulées : aucune clé
Finnhub réelle n'est disponible dans la configuration serveur de ce chantier.

## CI et chargement

La CI utilise Node 24, comme Vercel. Un job dédié installe Chromium et WebKit
et exécute le même gate mobile que sur le poste local. Les nouvelles régressions
Finnhub et backtest font partie de la sélection bureau hermétique.

Le gate intégré a aussi révélé deux fixtures anciennes incomplètes, CORR puis
Screener G6. Leurs appels RSS et exchanges réels ralentissaient les imports de
modules sous Vite, jusqu'à dépasser le délai du test. Les traces confirment que
le raccourci CORR était reçu : le module de palette restait en attente.
Chaque correction ajoute deux lignes pour installer le bouchonnage global avant
les fixtures métier, sans changer interface, assertions ni délais. CORR passe
de 2 échecs sur 5 à 5/5 réussis ; G6 passe d'une attente de bouton de 20 s à
66–102 ms sur trois répétitions réussies. Les autres specs sélectionnées ont
été contrôlées pour la présence du bouchonnage global.

Un passage suivant a échoué dans CHAIN sur la première ouverture de palette.
Quatre specs envoyaient le raccourci juste après la navigation, sans attendre le
montage React. Une simulation de bootstrap lent a reproduit une touche envoyée
334 ms avant l'installation du gestionnaire, puis validé la correction. Cinq
attentes de visibilité du terminal protègent huit navigations ; aucune pause
fixe ni nouvelle tentative ajoutée. Les quatre specs passent **24/24** sur trois
répétitions après retrait de l'instrumentation.

La capture de consensus ECO reste synchrone, dans un module léger. Le code
d'archives, d'import et d'ALFRED est chargé avec les vues qui l'utilisent. Le
réviseur a comparé les corps et initialisateurs des **20 déclarations déplacées** :
aucune modification logique. Un test du graphe interdit le retour des archives
sur le chemin initial.

Mesure confirmée par le build final Node 24, mode Vercel :

| JavaScript initial | Avant extraction | Après extraction |
| --- | ---: | ---: |
| Brut | 1 200 135 octets | 1 190 244 octets |
| Gzip niveau 9 | 357 812 octets | 354 964 octets |
| Marge gzip sous le plafond inchangé | 2 188 octets | 5 036 octets |

Le gain est modeste, **2 848 octets gzip**. Il établit une diminution du code
initial, pas une mesure de latence perçue. Les Réglages étaient déjà chargés à
la demande ; ils ne sont pas la source de ce gain.

## Validation et publication

Revue indépendante favorable sur les quatre lots. Les preuves ciblées incluent
143 tests moteur, les contrôles web des archives et du worker, les scénarios
Finnhub et les tests macro/graphe. Les deux nouveaux parcours Finnhub et le
parcours réel backtest passent avant le gate intégré.

Le gate global `pnpm check` passe sous Node 24 : TypeScript, **8 273 tests**
(1 487 indicateurs, 79 alertes, 143 backtest, 779 daemon et 5 785 web) et build.
Le build de production séparé confirme le budget ci-dessus. Les parcours
téléphone passent : **39 réussis, 1 ignoré** (geste natif WebKit déjà non pris
en charge par l'outil de test).

Le contrôle des cinq secrets disponibles ne trouve aucune occurrence dans
les sources à publier ni dans le bundle. L'inventaire CLI de publication
contient 1 764 fichiers réguliers, sans secrets, bases locales, symlinks ni
répertoires privés.

Les passages bureau ont couvert **156 scénarios**. Chacun des trois passages
initiaux a réussi 155 scénarios et révélé un problème de fixture ou de
synchronisation décrit ci-dessus ; leurs corrections ont été revues et
rejouées séparément. Le passage intégré final est suivi dans la
[CI du dépôt](https://github.com/ZakiChair/axiom/actions/workflows/ci.yml).

La version de contrôle `dpl_B3Qnen7TC5Ck9q6a5LK8waFaxmXq` est **Ready** sur
Vercel. Les 1 432 fichiers de produit comparés sont identiques à ceux validés
localement. Contrôle dans un navigateur vierge : graphique live, Backtest et
EVTS chargés, cinq clés serveur disponibles et aucune clé personnelle saisie.
Un appel FRED réel sans clé dans la requête renvoie HTTP 200 et
`Cache-Control: private, no-store`.

Cette version est promue sur le lien habituel
[AXIOM](https://axiom-iota-vert.vercel.app). Le dépôt conserve les corrections
de test apportées après la copie de publication ; le code produit reste identique.
