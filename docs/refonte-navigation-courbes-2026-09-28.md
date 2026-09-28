# Navigation et graphiques inspirés de Coinglass

## Demande

Le propriétaire demande de changer complètement la navigation et l'affichage des
courbes en s'inspirant de Coinglass, après la publication de l'adaptation mobile
`bafcd1d`. Portée de travail : téléphone et ordinateur, avec priorité à l'usage
tactile.

## Référence observée

Observation directe des pages [Marché](https://www.coinglass.com/),
[Bitcoin](https://www.coinglass.com/currencies/BTC) et
[Open Interest & Volume](https://www.coinglass.com/pro/futures/Cryptofutures),
sur petits et grands écrans. Les principes retenus sont la navigation par
familles de données, des synthèses compactes, des graphiques larges dont le titre,
les filtres et les légendes sont distincts de la zone de tracé. L'identité,
les textes, les données et les outils restent ceux d'AXIOM.

## Direction

- Navigation principale par rubriques métier ; catalogue filtrable des outils
  existants, état actif explicite, accès direct au graphique, aux favoris,
  à la recherche et aux réglages.
- Présentation des outils en pages cadrées ; mode fenêtres disponible sur
  ordinateur pour les dispositions de travail existantes. La présentation ne
  réécrit pas leurs géométries enregistrées. Palette, raccourcis et liens entre
  outils doivent rejoindre la même destination active.
- Graphiques en panneaux : identité du marché et statistiques en flux,
  commandes proches de leur graphique, puis viewport contenant toutes les
  couches de tracé et les indicateurs. Aucune légende ne recouvre les prix.
- Choix Bougies / Courbe / Aire fondé sur KLineChart existant. Courbe et Aire
  utilisent les clôtures sans lissage. Le footprint exige l'affichage Bougies ;
  la préférence de l'utilisateur reste conservée.
- Palette sombre graphite, accents bleus et séries mieux contrastées. Les
  autres thèmes restent disponibles. Typographie système, chiffres tabulaires,
  libellés lisibles, sans bibliothèque de composants ou d'icônes supplémentaire.
- La disposition mobile conserve de vraies cibles tactiles et un accès à tous
  les outils ; paysage compact. La navigation des vues multiples conserve les
  instruments, leur focus et leurs dessins.

## Contraintes

- Aucun nouveau fournisseur, aucune nouvelle formule financière ni donnée fictive.
- Les statistiques gardent leurs sources et leur portée réelles ; un historique
  partiel ne devient pas un total de marché ou une statistique complète sur 24 h.
- Les mises à jour de prix restent impératives, hors du rendu React à chaque tick.
- Rendu, navigation et styles ne relancent pas les chargements de données et ne
  réinitialisent pas le zoom, le replay ou les dessins.
- Budget d'entrée inchangé : 1 220 000 octets bruts / 360 000 gzip, mesuré avec
  Node 24 et zlib 1.3.x. Baseline 1 204 842 / 359 520 : remplacer le chrome
  existant et différer les commandes avancées pour dégager de la marge.

## Lots attribués

1. Navigation : App, Toolbar et son découpage, navigation mobile, Taskbar,
   FloatingWindow, barres secondaires, nouveau catalogue et état de navigation,
   CSS de navigation et tests associés.
2. Graphiques : chart/**, SymbolBanner, préférence de rendu et tests associés.
3. Présentation commune : tokens de thèmes, CSS commun, primitives ui,
   sections et tableaux ; pas de modification des fichiers des deux autres lots.
4. Orchestration : ce document, BUILD-CONTRACT, vérification visuelle et des
   parcours, arbitrage du budget et revue indépendante.

## Critères de sortie

Nouvelle navigation réellement fonctionnelle pour les 39 outils, affichage des
courbes nettement distinct, 320/390 px portrait et paysage utilisables, bureau
conservant les fonctions avancées. Tests du rendu et de sa conservation,
navigation tactile et clavier, retours entre outils, modes pages/fenêtres,
multivue et états indisponibles. Typage, tests adaptés, build Node 24 et revue
indépendante sur le résultat final ; contrôles sur les deux moteurs mobiles.

## Parcours de vérification

- Catalogue : les 39 identifiants canoniques apparaissent exactement une fois
  parmi les neuf rubriques. Les alias gardent leurs sous-vues. Une sélection
  depuis le catalogue, la palette ou un lien métier rejoint la même page.
- Navigation : ouvrir Notes, saisir un brouillon, visiter Macro, revenir aux
  Notes puis au Graphique ; retour/avance du navigateur et rechargement suivent
  la destination. Changer de rubrique ne ferme ni ne réduit les outils.
- Géométrie : capturer une disposition de fenêtres non triviale, passer en
  pages, ouvrir/restaurer des outils, changer la taille du viewport et revenir
  en fenêtres. Les coordonnées et l'état de restauration ne sont pas écrasés
  par la présentation en pages. Les playbooks restent utilisables en fenêtres.
- Graphiques : conserver les données, la plage visible et un dessin au passage
  Bougies → Courbe → Aire ; activer le footprint puis le retirer et retrouver
  le mode choisi. Vérifier la portée locale du timeframe et l'échelle commune
  explicitement nommée, les indicateurs, le replay et quatre instruments distincts.
- Petits écrans : contrôler 320 et 390 px en portrait, 844 × 390 en paysage,
  puis 1440 px sur bureau. Les commandes doivent être atteignables, les pages
  ne doivent pas élargir le document et le tracé doit garder une hauteur utile.
- Provenance : un fournisseur absent ou un historique partiel garde son état
  explicite. Les statistiques du bandeau ne promettent pas une couverture
  complète de 24 h que les bougies chargées ne permettent pas d'établir.
- Preuves : distinguer les parcours hermétiques avec jeux de données déclarés
  des observations de données réelles ; ne pas traiter un écran vide après HMR
  comme une preuve de régression sans reproduire après un rechargement complet.

## Résultats

### Vérifications acquises

- `pnpm check` avec Node 24 : typage, **8 222 tests** et build réussis. Décomposition :
  indicateurs 1 487, alertes 79, backtest 128, daemon 756,
  application web 5 772. Les deux anciennes assertions de police des tuiles
  CryptoQuant ont été découplées du poids typographique ; les valeurs et les
  couleurs sémantiques restent vérifiées.
- Build final : **1 176 646 octets bruts / 352 869 gzip** pour
  l'entrée initiale, contre 1 204 842 / 359 520 avant refonte. Plafonds inchangés.
- Thèmes et primitives : 127 tests ciblés, contrôles de contraste des cinq thèmes
  et distance entre séries et couleurs sémantiques. Vingt rendus des primitives
  (deux moteurs × cinq thèmes × deux largeurs) sans débordement de document.
- Audit du build compilé servi localement : **312 ouvertures** (39 outils ×
  Chromium/WebKit × 320 × 740, 390 × 844, 844 × 390 et 1440 × 900). Aucun cadre
  hors écran, aucune fermeture inaccessible, aucun élargissement du document,
  aucune exception JavaScript. Le débordement interne de texte d'un champ natif
  du screener sous WebKit est défilable et n'élargit pas la page. Cet audit
  neutralise les fournisseurs en réponse 503 : il valide les interfaces et leurs
  états indisponibles, pas la disponibilité des services de marché.
- Nouveaux parcours graphiques sur Chromium et WebKit : même instance de
  graphique, même historique, même zoom/plage et même dessin lors des trois
  changements de rendu ; aucun nouvel appel de bougies. EMA et RSI conservés,
  footprint réversible, commandes du second slot locales et rotations conservées.
  La preuve de rendu attend des pixels de courbe dans le canvas prix : lire
  `getStyles()` seul ne garantit pas que la peinture différée a déjà eu lieu.
- Suite mobile intégrée : **49 réussites**, un test ignoré sous WebKit car il
  utilise une entrée tactile CDP propre à Chromium. Les autres parcours couvrent
  les deux moteurs, dont les dix cas de modes de graphique à densité 3. Les
  contrôles de géométrie ont aussi passé cinq répétitions par moteur.
- WebKit à densité 3 : un texte de prix mesuré à 54,48 px disparaissait lorsque
  KLineChart arrondissait sa largeur à 54 px. La figure publique `text` arrondit
  désormais les seules largeurs automatiques vers le haut ; les largeurs
  explicites et le moteur natif de texte sont conservés. Le test vérifie aussi
  les pixels des chiffres du dernier prix, pas uniquement les styles déclarés.
- Les commandes TICKER, WS, BACKUP et RESTORE restent disponibles avec le
  chargement différé des options. TICKER et son bouton partagent la même
  préférence persistée. Les alertes actives restent visibles dans Favoris.
- Revues indépendantes croisées favorables : navigation et primitives d'une
  part, graphiques et thèmes d'autre part. Les assertions de données, fraîcheur,
  géométrie, historique et brouillons ont été conservées lors de l'adaptation
  des tests à la nouvelle navigation.
- Observation live complémentaire : courbe BTCUSDT Binance, en portrait et sur
  bureau, avec prix et volume effectivement dessinés. Les tests déterministes
  conservent leurs jeux de données explicitement déclarés comme fixtures.

### Validation finale

- `pnpm check` : réussi, Node 24, 8 222 tests, typage et build.
- `pnpm check:e2e` : **157/157 parcours Chromium réussis** en 3,3 minutes.
- Suite `playwright.mobile.config.ts` : **49 réussites / 1 exclusion documentée**
  sur Chromium et WebKit, en 45,2 secondes.
- `git diff --check` : réussi. Aucun fournisseur, calcul financier ou paquet
  supplémentaire ; les révisions finales des tests conservent leurs assertions.
- Les scénarios financiers ouvrent la recherche par son bouton avant d'utiliser
  la palette. Une frappe brute immédiatement après `goto` pouvait précéder de
  18 à 25 ms l'installation de l'écouteur ; les parcours dédiés continuent à
  vérifier les raccourcis. La migration d'un ancien favori est vérifiée après
  l'ouverture explicite de Favoris, qui déclenche maintenant son montage.

Les traces et captures de travail sont conservées dans le dossier ignoré
`.playwright-mcp/navigation-2026-09-28/`. La publication autorisée suit la fusion
sur `main` via l'intégration Git Vercel ; le contrôle final relie le SHA publié
au déploiement et rejoue des parcours sur le domaine de production.
