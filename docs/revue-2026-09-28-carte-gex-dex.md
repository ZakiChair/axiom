# Refonte de la représentation GEX / DEX

Demande : changer radicalement la vision et les graphiques des expositions, à la suite de la correction des données options BTC/ETH. Base : `3e9d6bb`. La [conception](superpowers/specs/2026-09-28-carte-gex-dex-design.md) définit les invariants et le périmètre.

## Lecture proposée

L'histogramme par strike devient une carte **distance au spot × échéance**. Le prix actuel sépare les quatre bandes au-dessus du spot des quatre bandes en dessous. Toutes les maturités actives restent identifiables et les totaux par échéance permettent de voir quelle exposition arrive à expiration. Les zones extrêmes restent incluses.

Une cellule représente un **net**, pas le volume brut des positions. Les contributions opposées peuvent s'annuler. Le bleu représente un montant positif, l'ambre un montant négatif ; une seule échelle linéaire symétrique est utilisée pour toute la carte. Le détail sélectionné donne les montants GEX et DEX ainsi que les principaux strikes.

La seconde vue représente la sensibilité de la métrique choisie à un spot simulé de −15 % à +15 %, avec un curseur de prix. L'IV, l'OI, le temps restant et le ratio forward/index sont constants. La vue DEX trace donc une courbe DEX. Aucune simulation n'est produite à partir des greeks CBOE figés.

Les unités, la portée, la qualité de la chaîne et les conventions restent visibles ou accessibles dans les détails. Aucune modification de formule, de source ou d'infrastructure réseau.

## Vérification sur les instantanés réels

Comparaison faite sur les réponses publiques Deribit conservées lors de l'audit précédent, observées le 28 septembre 2026 vers 11:00 UTC. Ces chiffres documentent ce contrôle et ne constituent pas un nouvel instantané du marché.

| Contrôle | BTC | ETH |
|---|---:|---:|
| Échéances | 12 | 12 |
| Cellules, 8 bandes × échéances | 96 | 96 |
| Couples strike/échéance calculables | 472 | 398 |
| GEX net, USD / 1 % | 183 086 967,41720346 | 12 958 367,9979929 |
| DEX net, USD notionnels | 4 466 463 757,013657 | 602 010 941,4485506 |

Sommes de la carte identiques au moteur précédent à moins de 0,000002 USD près (ordre des additions flottantes). Le point central du nouveau profil rejoint exactement les deux totaux calculés par le moteur. La revue indépendante a également inversé l'ordre des 944 et 796 instruments : chaque cellule reste identique.

Les tests de données couvrent les frontières exactes des huit bandes sur plusieurs ordres de prix, les strikes extrêmes, les contributions minuscules, les duplications de sources, les cellules nulles et les compensations, les échéances actives et le point central du profil.

## Validation finale

- Revue indépendante favorable : invariants financiers, échelles, absence/zéro, isolation BTC/ETH, unités du profil et raccords de portée. Le zéro du profil GEX réutilise le moteur existant et son traitement des plateaux nuls.
- `pnpm check` réussi sur le code final sous Node 24.13.0 / zlib 1.3.1 : build, typage du monorepo et **8 166 tests** (indicateurs 1 487, alertes 79, backtest 128, daemon 756, web 5 716).
- **20/20 parcours Chromium réussis** : `options-carte`, `options-fraicheur`, `omon-lectures-options`, `niveaux-chart`, `revue-outils-avances`. Les deux nouveaux parcours de carte/profil sont intégrés à `pnpm check:e2e`.
- Budget initial : **1 188 014 octets bruts / 354 236 gzip**, plafonds 1 220 000 / 360 000 inchangés. Pas de nouvelle dépendance.
- Vérification manuelle sur API réelles : carte BTC/GEX, sélection d'une zone et de ses principaux strikes, carte ETH/DEX, profil DEX et curseur au clavier. Au spot courant, valeurs du profil conformes aux totaux affichés.
- Fenêtres de 320 et 400 px : aucun débordement horizontal du composant ; seul le conteneur de la matrice défile. Contrôles compactés, hauteur réduite avant le graphique. Graduations trop proches du zéro masquées pour éviter leur superposition ; valeurs exactes toujours disponibles via le curseur.
- Contraste vérifié dans les cinq thèmes : opacité maximale des cellules 0,4, toujours proportionnelle à l'exposition absolue sur l'échelle commune.
- Correction issue de la capture finale : un bruit flottant proche de 100 % ne déclenche plus de faux avertissement de couverture partielle ; une couverture réellement incomplète mais arrondie à 100,0 % affiche `<100 % (partiel)`. Deux régressions SSR, contre-revue indépendante, contrôle global et six parcours de fraîcheur relancés avec succès après ce correctif de libellé.
- `git diff --check` propre. Logs de la session : `/tmp/axiom-gex-refonte-20260928/check-final.log` et `e2e-final.log`.

Le travail reste local ; aucun déploiement n'est effectué dans ce lot. Limite antérieure hors périmètre : CBOE conserve temporairement sa précédente chaîne pendant un changement de ticker ; la refonte ne modifie pas ce chargement. Les bascules BTC/ETH restent isolées et testées.

## Complément visuel demandé à 14:30

Le propriétaire demande de conserver les chiffres tout en ajoutant un véritable graphique.
La vue **Graphique** est désormais sélectionnée par défaut dans OMON GEX/DEX. Elle montre
un histogramme signé par strike sur un axe de prix proportionnel, avec repère du spot,
puis un histogramme par échéance. Carte chiffrée et profil simulé restent accessibles.

Le cadrage initial de ±30 % du spot indique le nombre de strikes uniques visibles et le
net de cette plage. « Tous les strikes » rétablit la série entière. Les totaux en tête et
les barres par échéance conservent toujours la portée choisie. Les valeurs se lisent au
survol, au clic ou avec les curseurs au clavier. Un net nul est marqué par un point neutre,
une absence par un tiret ; aucune hauteur minimale ne grossit les petites contributions.

La nouvelle transformation ne recalcule aucun grec. Sur les mêmes instantanés réels,
90 strikes BTC et 84 strikes ETH sont consolidés ; le cadrage en contient respectivement
54 et 48. L'écart maximal avec le moteur précédent filtré en prix est de 0,000000060 USD.
Les douze échéances et les totaux généraux restent strictement identiques entre cadrages.

Validation : revue indépendante favorable, `pnpm check` réussi (**8 181 tests**, dont
5 731 web) et **21/21 parcours Chromium** réussis. Après l'ajustement final de contraste,
les trois tests du composant et le build ont été relancés avec succès. Le budget initial
reste à **1 188 014 / 354 245 octets bruts/gzip**, plafonds inchangés. Les contrôles de
cadrage, de survol/clic persistant et de clavier sont intégrés à `options-carte.e2e.ts`.

Contrôle navigateur sur données réelles : BTC/GEX et ETH/DEX, bascule vers tous les
strikes sans changement du net global, thème clair, puis fenêtre de 320 px sans
débordement. Le mélange local des couleurs avec le texte assure un contraste minimal
de **3,073:1** sur les cinq thèmes sans modifier les hauteurs des barres. Logs :
`/tmp/axiom-options-graphiques-20260928/{check-final,e2e-final,build-final}.log`.
