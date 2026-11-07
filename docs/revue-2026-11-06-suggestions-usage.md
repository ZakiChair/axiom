# Suggestions d'amélioration d'AXIOM — 2026-11-06

Complément de `docs/revue-2026-11-06.md`. La revue listait des défauts ; ce document propose des **fonctions nouvelles ou mieux reliées**. Lecture seule : aucun code modifié.

## Méthode

- 7 angles d'idéation (chaîne de décision, mesure de l'avantage, ergonomie, risque, transparence des données, simplification, alertes) → 61 idées brutes, chacune appuyée sur des emplacements du code.
- Fusion → 35 idées ; 2 écartées (doublons de correctifs de la revue).
- Vérification dans le code : existe déjà ou non, faisabilité, fichiers à toucher, effort et contrainte de contrat révisés. Aucune idée rejetée, mais toutes ont été resserrées (verdict « reformuler »).
- 3 juges indépendants : valeur, coût-risque, cohérence (1 à 5). **Score = 2 × valeur + coût-risque + cohérence** (sur 20).

## Constats transverses

1. **Le gel G100 est le verrou principal.** Environ 27 idées sur 35 ajoutent de la surface et demandent une exception explicite. Les vérificateurs n'en demandent pas pour la ligne de commande composable (IDEE-29, la palette existe déjà), le catalogue replié (IDEE-33), le témoin de flux (IDEE-27), la fiche de preuve (IDEE-11), les workspaces (IDEE-30) et DATA (IDEE-28). IDEE-31 et IDEE-35 dépendent d'autres décisions du propriétaire (page d'accueil, regroupement de vues).
2. **Les correctifs de la revue passent d'abord.** BT-1, BT-2 et BT-3 conditionnent tout ce qui touche BT (IDEE-9, 10, 15, 16) ; PRT-2 tout ce qui se mesure en R (IDEE-4, 6, 24) ; MFN-1 les alertes et la persistance (IDEE-1, 18, 21) ; DMN-1, 2 et 4 le daemon (IDEE-17, 19, 21).
3. **Aucune idée ne franchit un anti-objectif** : pas de nouveau fournisseur, pas d'Electron, pas d'exécution d'ordres, pas d'enregistreur de ticks. Le daemon reste dans son rôle d'alertes.

## Classement

| # | Id | Score | V | C-R | Coh | Effort | Idée |
|---|---|---|---|---|---|---|---|
| 1 | IDEE-17 | 18 | 5 | 3 | 5 | M | Alertes vraiment surveillées : badge de couverture réelle, et veille 15 min à 1 j par le daemon hors du graphe affiché |
| 2 | IDEE-1 | 16 | 5 | 2 | 4 | L | Positions réelles complètes dans PORT : stop, alertes de stop et journal EXPY automatique |
| 3 | IDEE-22 | 16 | 4 | 4 | 4 | S | Lignes d'alertes prix sur le graphe : voir, supprimer et déplacer au clic droit |
| 4 | IDEE-4 | 15 | 4 | 2 | 5 | M | Contrôle avant l'entrée mesuré et figé avec l'ordre : alignement, régime, état des données, score PACTE |
| 5 | IDEE-6 | 15 | 4 | 3 | 4 | M | EXPY : mes résultats par origine de signal, comparés à la référence historique |
| 6 | IDEE-9 | 15 | 4 | 2 | 5 | M | AXIS depuis son figeage : suivi en données vraiment nouvelles, comparé à ce que le test annonçait |
| 7 | IDEE-10 | 15 | 4 | 3 | 4 | M | « Le hasard ferait-il aussi bien ? » : test de timing et intervalles de confiance dans BT, EQS et EXPY |
| 8 | IDEE-15 | 15 | 4 | 2 | 5 | L | Garde-fous de sur-ajustement dans BT : compteur d'essais, puis figer une version et la mesurer sur l'après |
| 9 | IDEE-18 | 15 | 4 | 3 | 4 | M | Retour au poste : boîte de réception des alertes et encart « depuis votre passage » |
| 10 | IDEE-19 | 15 | 4 | 3 | 4 | M | Bilan de veille : prouver que la surveillance était vivante pendant l'absence |
| 11 | IDEE-29 | 15 | 3 | 4 | 5 | M | Ligne de commande composable : actif, unité, fonctions et alerte en une saisie |
| 12 | IDEE-2 | 14 | 4 | 2 | 4 | M | Budget de risque : profil unique, risque ouvert au stop et garde-fous de session |
| 13 | IDEE-5 | 14 | 3 | 3 | 5 | M | PAPER enregistre la gestion du trade : MAE/MFE en R, cible initiale et motif de sortie dans EXPY |
| 14 | IDEE-11 | 14 | 3 | 3 | 5 | M | Fiche de preuve par signal (statut, population testée) et AXIS en tête des menus |
| 15 | IDEE-16 | 14 | 4 | 2 | 4 | L | Mode panier dans BT : la même règle sur plusieurs actifs |
| 16 | IDEE-21 | 14 | 4 | 2 | 4 | L | Moins de bruit sans rien perdre : anti-rebond, niveau d'urgence, sourdine et heures calmes |
| 17 | IDEE-23 | 14 | 3 | 4 | 4 | S | Prochaine annonce à risque dans le bandeau, avec pré-alerte |
| 18 | IDEE-24 | 14 | 3 | 4 | 4 | M | Risque de ruine et drawdown probable calculés sur mon journal réel (EXPY) |
| 19 | IDEE-3 | 13 | 3 | 3 | 4 | M | Du dessin « position » à un ordre PAPER prérempli et dimensionné au risque, frais compris |
| 20 | IDEE-12 | 13 | 4 | 2 | 3 | L | Valeur mesurée d'une alerte : banc d'essai sur l'historique avant de l'armer, et bilan réel de ses déclenchements |
| 21 | IDEE-14 | 13 | 3 | 3 | 4 | M | Seuil de coût d'un run et coût réel mesuré par le carnet, injectés dans BT |
| 22 | IDEE-20 | 13 | 3 | 3 | 4 | M | Notification qui se suffit à elle-même, et lien qui ouvre le bon graphe |
| 23 | IDEE-27 | 13 | 3 | 2 | 5 | L | Le graphe dit si sa donnée est vivante et d'où elle vient : témoin de flux et provenance des séries |
| 24 | IDEE-33 | 13 | 2 | 5 | 4 | S | Catalogue d'indicateurs : vue « Essentiels » par défaut et familles repliées |
| 25 | IDEE-7 | 12 | 3 | 3 | 3 | M | Revue hebdomadaire guidée dans EXPY |
| 26 | IDEE-8 | 12 | 3 | 2 | 4 | M | Ouvrir un dossier de décision depuis un setup EQS ou une idée manuelle, avec preuve figée |
| 27 | IDEE-26 | 12 | 3 | 2 | 4 | L | SCEN, seule vue de risque du portefeuille, avec des journées de crise réelles |
| 28 | IDEE-31 | 12 | 2 | 4 | 4 | M | Un seul catalogue de setups, avec AXIS 4h en premier et dès l'accueil |
| 29 | IDEE-28 | 11 | 2 | 3 | 4 | M | DATA dit ce qu'une panne coupe vraiment et quand un quota va tomber |
| 30 | IDEE-30 | 11 | 2 | 3 | 4 | M | Workspaces complets et changement de workspace d'une seule touche |
| 31 | IDEE-32 | 11 | 2 | 3 | 4 | M | Menu « Couches » : tout ce qui se dessine sur le graphe, au même endroit |
| 32 | IDEE-34 | 11 | 2 | 4 | 3 | M | Enchaîner les fonctions sans les connaître par cœur : fonctions liées dans l'en-tête et menu Fonctions à la carte |
| 33 | IDEE-35 | 11 | 2 | 3 | 4 | M | Une seule vue par sujet : SECT dans MAP, mineurs dans MINE, retrait des surfaces mortes |
| 34 | IDEE-13 | 10 | 3 | 1 | 3 | L | Jouer en direct exactement la règle testée : armer l'alerte depuis BT et sortir de PAPER par la règle de sortie |
| 35 | IDEE-25 | 9 | 2 | 2 | 3 | M | Impact d'un nouveau trade sur le risque du portefeuille, avant de placer l'ordre |

**Top 5 de chaque juge**

- valeur : IDEE-17, IDEE-1, IDEE-21, IDEE-16, IDEE-12
- cout-risque : IDEE-33, IDEE-22, IDEE-29, IDEE-31, IDEE-23
- coherence : IDEE-17, IDEE-11, IDEE-9, IDEE-27, IDEE-5

## Idées écartées à la fusion

- **TRA-7** : Reprend des correctifs déjà proposés. La revue a mesuré la dépendance à la profondeur d'historique sur les 220 définitions : seuls ressortent VFI et les cumuls assumés (IND-3, docs/revue-2026-11-06.md:436-444). La prémisse « une trentaine de stratégies jamais mesurées » ne tient donc pas. L'amorce de BT relève de BT-1, et le test sur tout le registre relève d'IND-4. Il ne reste qu'une étiquette « cumulatif », trop mince pour en faire une idée.
- **ERG-9** : L'essentiel reprend le remède de MFN-6 (rôles « moteur » et « non moteur » des fenêtres), déjà proposé par la revue, et exige tout le lot C (MFN-1, MFN-5, MFN-6, MFN-7). L'apport propre se limite à une commande ECRAN2 et un mode sans graphe maître, pour un effort L : c'est trop mince. À reconsidérer une fois MFN-6 livré.

## Détail des idées (par score décroissant)

### 1. IDEE-17 — Alertes vraiment surveillées : badge de couverture réelle, et veille 15 min à 1 j par le daemon hors du graphe affiché

**Score 18/20** · valeur 5 · coût-risque 3 · cohérence 5 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : TRA-1, ALR-1

**Problème.** Une alerte sur bougie prend l'unité du graphe à sa création (AlertsPanel.tsx:354). Le front ne l'évalue que si le graphe maître affiche exactement sa source, son symbole et son unité (alerts/runtime.ts:8-13, 284 et 303-314). Le daemon n'a que des bougies 1m Binance (apps/daemon/src/marketFeed.ts:144 et 192 ; alerts.ts:17, 235-237 et 268-275). Mesure en scratchpad (alertes-veille/couverture.ts) : AXIS État ≥ 1 en 4h sur SOLUSDT, RSI 1h sur ETHUSDT et prix sur Bybit ne sont surveillés par personne onglet fermé. Le daemon n'applique pas non plus le garde-fou de régime BTC d'AXIS (README.md:236-237). La liste n'affiche qu'un badge statique « front-only » calculé d'après le type (AlertsPanel.tsx:410 et 439-443 ; engine.ts:168-177) et une phrase d'aide (AlertsPanel.tsx:710-712). Un silence peut donc vouloir dire « rien à signaler » ou « personne ne regarde ».

**Proposition retenue après vérification.** Deux livrables, le troisième reporté. (1, S) Fonction pure couvertureAlerte(def, {daemonPresent, marcheAffiche, fluxLiqRetenu, estVercel}) dans packages/alerts, qui dit qui surveille et pourquoi. Elle remplace le badge statique « front-only » et compte le cas « 4h hors daemon ». Badge par ligne, compteur « N non surveillées » dans ALRT et SessionStrip, avertissement à la création, et le bouton existant « Voir sur le chart » qui passe aussi timeframe: d.timeframe (c'est le bouton Couvrir, sans nouveau bouton). (2, M) Daemon, alertes Binance uniquement : un minuteur par couple (symbole, unité) des défs actives sur bougies, de 15m à 1d. À chaque clôture, fetch incrémental REST (amorce de 1 500 bougies au premier passage, puis les dernières seulement), fusion, refus si la fenêtre n'est pas contiguë, vérification que la bougie attendue est close, puis evaluerEtPersister filtré sur cette unité. Pour les indicateurs qui déclarent refClose (AXIS) avec regimeBtc > 0 : charger le symbole de référence lu dans le KV persist (défaut BTCUSDT) à la même unité, l'aligner par alignAux et le passer dans ctx.aux. Test : sur les mêmes bougies, un horodatage identique à evaluerAlertes. (3) Planificateur front pour les autres sources : reporté après MFN-1 et MFN-6. D'ici là, le badge dit « Bybit : surveillée seulement onglet ouvert sur ce marché ».

**Proposition initiale.** (1) Une fonction pure dit, pour chaque alerte active, qui la surveille maintenant (onglet, daemon, les deux, personne) et pourquoi (« le graphe maître affiche ETHUSDT 1h », « daemon absent », « source Bybit non couverte onglet fermé », « flux liquidations non retenu »). Badge par ligne, compteur « 2 non surveillées » dans ALRT et le bandeau, bouton « Couvrir » qui met le graphe maître sur le marché de l'alerte, avertissement à la création. (2) Daemon : pour chaque couple (symbole, unité) d'une alerte Binance active sur bougies, un minuteur se réveille à chaque clôture (+3 s), relit en REST les 1 500 dernières bougies clôturées et appelle evaluerEtPersister. Pour AXIS, il charge BTCUSDT à la même unité et passe refClose : le daemon produit alors les signaux de la version validée, garde-fou compris. (3) Front : le même planificateur couvre, via l'adaptateur de la source, les alertes dont le marché n'est pas affiché (Bybit, OKX, Vercel sans daemon), tant que l'onglet est ouvert.

**Réutilise.** packages/alerts (evaluerAlertes, typesDeDef, estFrontOnly, alerteActiveAuTemps, conditionSupporteTimeframe), apps/daemon/src/alerts.ts (evaluableDaemon et evaluableSurBougie1m à déplacer en fonctions pures partagées, evaluerEtPersister, creerReveilEcheance), marketFeed.ts (backfill à paramétrer, fusionnerBougies), alignAux de @axiom/indicators, alerts/runtime.ts (lotVeutRefClose), data/adapters (fetchKlines), data/daemon.ts (detectDaemon, daemonSupporte), store/market.ts, chart/liquidationMarkers.ts (fluxLiqRetenu), lib/navigation.ts, SessionStrip (compterAlertesActives).

**À créer.** Fonctions pures couvertureAlerte(def, contexte) et prochainesClotures(defs, maintenant) dans packages/alerts. Boucle « clôtures multi-unités » côté daemon et son équivalent front. Badge, compteur, bouton « Couvrir », avertissement. Tests en table de cas, horloge injectée, fetch bouchonné.

**Données.** Disponibles : même hôte REST Binance que le daemon utilise déjà (marketFeed.ts:35), klines des adaptateurs côté front. Coût : 2 requêtes par symbole et par clôture, soit 12 par jour et par symbole en 4h.

**Ce qui existe déjà.** Badge statique « front-only » calculé d'après le type seulement : apps/web/src/components/AlertsPanel.tsx:410 et 439-443, via estFrontOnly (packages/alerts/src/engine.ts:168-177). Ce badge ne signale pas une alerte 4h, alors que le daemon l'écarte (apps/daemon/src/alerts.ts:235-237 et 268-275). Phrase d'aide « le daemon ne couvre que la minute » : AlertsPanel.tsx:710-712. Le front n'évalue que le graphe maître, avec source, symbole et unité identiques : apps/web/src/alerts/runtime.ts:303-314. Le daemon ne lit que des bougies 1m : apps/daemon/src/marketFeed.ts:144-148 et 192 (backfill avec interval "1m" figé). Mesure reproduite avec bun (scratchpad alertes-veille/couverture.ts) : symbolesBinanceActifs renvoie [] pour AXIS 4h SOLUSDT, RSI 1h ETHUSDT et prix Bybit, donc aucun suivi onglet fermé. Le garde-fou BTC n'est pas appliqué par le daemon (README.md:236 ; aucune trace de refClose dans apps/daemon/src). Le clic sur une alerte navigue sans l'unité : navigateTo({symbol, exchange}) en AlertsPanel.tsx:426, alors que NavIntent accepte timeframe (lib/navigation.ts:28-38). Aucun équivalent sous un autre nom : grep couverture, surveill et prochainesClotures vide.

**Contrat.** Aucun fournisseur nouveau : même hôte api.binance.com que le backfill actuel. Lecture REST aux seules clôtures : ce n'est pas un enregistreur 24/7. Le daemon reste dans son rôle d'alertes. Le badge, le compteur et le bouton ajoutent de la surface à ALRT et au bandeau : il faut une exception G100 explicite, même si le badge remplace une information aujourd'hui trompeuse. Revue indépendante requise (daemon et calcul AXIS). Coordonner avec DMN-2 et DMN-3 (délai des fetch). L'étape 3, un planificateur côté front, gêne l'élection d'une fenêtre moteur (MFN-6) et doit attendre MFN-1 et MFN-6.

**Risques.** (a) Le symbole de référence du garde-fou est un réglage du front (store/refSymbol.ts, défaut BTCUSDT), absent de la déf. Le daemon doit le lire dans le KV « persist » (persist.ts:417-460, déjà miroité) ou le figer dans la déf à la création. Sinon il peut calculer avec une autre référence que le front. (b) À clôture +3 s, l'API peut ne pas encore servir la bougie close. Il faut vérifier que la bougie attendue (ouverture = clôture − unité) est présente et close, sinon réessayer : un signal en retard ou manqué vaut mieux qu'un signal faux. (c) Évaluer seulement sur une fenêtre contiguë (leçon de DMN-2). Préférer un fetch incrémental fusionné par fusionnerBougies plutôt que 1 500 bougies à chaque clôture : avec des alertes 15m sur 10 symboles, on monterait à environ 1 900 requêtes par jour. (d) Si l'onglet affiche le même marché, front et daemon évaluent tous les deux. Telegram part toujours depuis le daemon, et le journal est dédoublonné à 60 s (sessionAlertes.ts:15) : acceptable, comme pour le 1m aujourd'hui. (e) Le front calcule parfois AXIS sur moins de 1 500 bougies (README.md:206-209, « amorce courte ») : les deux côtés peuvent diverger, et c'est le daemon qui sera le plus fidèle. Le dire dans le message. (f) Étape 3, planificateur front pour Bybit, OKX et Twelve Data : elle consomme le quota Twelve Data (8 req/min), est dupliquée par chaque onglet tant que MFN-6 n'est pas fait, et ne vaut que si l'onglet reste ouvert. Valeur faible face au coût.

**Fichiers à toucher.**

- packages/alerts/src/couverture.ts (nouveau : couvertureAlerte, prochainesClotures, evaluableSurBougie et evaluableDaemon déplacés)
- packages/alerts/src/index.ts
- packages/alerts/src/couverture.test.ts
- apps/daemon/src/alerts.ts (evaluerTick prend l'unité des bougies ; planificateur des clôtures ; refClose)
- apps/daemon/src/marketFeed.ts (backfill paramétré par unité et profondeur, délai de fetch)
- apps/daemon/src/alerts.test.ts
- apps/daemon/src/marketFeed.test.ts
- apps/web/src/components/AlertsPanel.tsx (badge par ligne, avertissement à la création, bouton Couvrir avec timeframe)
- apps/web/src/components/SessionStrip.tsx (compteur non surveillées)
- README.md et BUILD-CONTRACT.md (section datée)

**Mesure de succès.** Tests : 4h Binance avec graphe en 1h → non surveillée avant l'étape 2, daemon après ; Bybit onglet fermé → non surveillée ; une alerte AXIS 4h SOLUSDT se déclenche dans le daemon au même horodatage qu'evaluerAlertes sur les mêmes bougies. En usage : le compteur « non surveillées » reste à 0, et un Telegram AXIS arrive sans onglet ouvert.

**Avis des juges.**

- valeur (5) : J'ai vérifié que le daemon écarte toute alerte de bougie hors 1m (apps/daemon/src/alerts.ts:235-237) et que le front exige l'unité affichée (alerts/runtime.ts:303-314). Aujourd'hui, une alerte AXIS 4h sur SOL n'est donc surveillée par personne onglet fermé. Faire arriver sur Telegram le seul signal validé, garde-fou compris, et savoir quelles alertes sont orphelines change le quotidien de l'opérateur.
- cout-risque (3) : Le livrable 1 (fonction pure couvertureAlerte et badge) est S et sûr. Le livrable 2 crée un pipeline d'évaluation daemon : fetch incrémental, contiguïté, référence de régime AXIS. Il présente un vrai risque de signal faux et demande une revue indépendante.
- coherence (5) : Elle remplace un badge statique trompeur par la couverture réelle, et étend le daemon dans son seul rôle autorisé (les alertes), sans enregistreur ni fournisseur. Elle dit enfin clairement si quelqu'un surveille vraiment l'alerte.

### 2. IDEE-1 — Positions réelles complètes dans PORT : stop, alertes de stop et journal EXPY automatique

**Score 16/20** · valeur 5 · coût-risque 2 · cohérence 4 · effort révisé **L** (initial L) · existe déjà : partiellement · origines : DEC-1, SIM-2, ERG-3, RSK-2, RSK-1

**Problème.** Une position PORT n'a ni stop, ni objectif, ni lien vers un dossier (apps/web/src/store/portfolio.ts:39-55 ; components/portfolio/FormulaireAjout.tsx:11-18), alors que PAPER les a (data/paper.ts:45-46). Sa clôture change seulement le statut, avec une date forcée à Date.now() (store/portfolio.ts:306-311). Seuls PAPER (store/paper.ts:239 et 260) et la saisie manuelle (ExpyWindow.tsx:378) écrivent dans EXPY : pour avoir le R d'un trade réel, il faut le ressaisir. Le post-mortem part dans NOTE (PortfolioWindow.tsx:189-207). Les badges d'EXPY mélangent réel et simulé (ExpyWindow.tsx:272), comme SCEN (ScenWindow.tsx:4-5 et 110) et le rapport HTML (data/rapport.ts:15-17). Aucun module du portefeuille n'appelle alertsStore : pour être prévenu au stop, il faut créer puis supprimer une alerte à la main, alors que le daemon relaie déjà prix-croise sur Telegram onglet fermé (apps/daemon/src/alerts.ts:12-16 et 51).

**Proposition retenue après vérification.** Deux lots, sans PACTE dans PORT. Lot 1 (M) : PORT gagne trois champs facultatifs, stop, objectif et dossier. Le stop du mauvais côté est refusé. La ligne affiche la distance au stop en % et en R. À la clôture, l'opérateur saisit le prix et la date réelle ; cloturer(id, prix, dateSortie?). Le trade est versé dans EXPY : entrée, stop initial (sinon sentinelle = entrée, donc R indéfini et affiché comme tel), taille, sortie, frais (après PRT-2), decisionIds, tag « reel ». Le brouillon de post-mortem devient la note du trade, avec une option NOTE. EXPY et le rapport gagnent un filtre d'origine Réel / Simulé (tag paper) / Non classé (anciens trades manuels) / Tout. SCEN gagne une bascule « inclure PAPER », dont le défaut reste à fixer par le propriétaire. Lot 2 (S-M, après MFN-1) : la case « Alerte au stop » crée une alerte prix-croise au stop, avec en option une alerte à 0,5 R. Les ids sont stockés sur la position (alertsStore.ajouter renvoie l'id). Les alertes sont supprimées ou recréées quand le stop change, à la clôture et à la suppression. Un id orphelin est toléré. Le badge PORT dans ALRT se déduit par recherche inverse. La mention « surveillé onglet fermé : Binance (prix spot) seulement » est affichée.

**Proposition initiale.** Le formulaire PORT gagne trois champs facultatifs : stop, objectif et dossier lié. Un stop du mauvais côté est refusé (leçon de PRT-1). Une case « Alertes de stop », cochée par défaut, crée deux alertes prix-croise liées à la position : à 0,5 R du stop et au stop. Le message donne symbole, sens, taille et perte estimée, et un badge PORT les signale dans ALRT. Modifier le stop déplace les alertes ; clôturer ou supprimer la position les retire. La ligne affiche la distance au stop en % et en R, et dit si le daemon la surveille (Binance seulement, marketFeed.ts:18-25). À la clôture, l'opérateur saisit le prix et la date réelle de sortie. La position est alors versée dans EXPY (entrée, stop initial, taille, sortie, frais, dossier, tag « réel ») ; le post-mortem devient la note du trade ou la revue du dossier. EXPY, le rapport et SCEN gagnent un sélecteur « Réel / Simulé / Tout » : Réel par défaut dès qu'un trade réel existe, et SCEN exclut le simulé par défaut. Sans stop, le R est « indéfini » et c'est affiché. La check-list PACTE est proposée, sans bloquer, à l'ouverture d'une position PORT.

**Réutilise.** store/portfolio.ts (ajouter, cloturer, supprimer), FormulaireAjout.tsx, SectionOuvertes.tsx, store/expy.ts (ajouter ; champ decisionIds déjà présent), data/expy.ts (rMultiple, statsExpy), data/paper.ts (tradeJournalDepuisCloture comme patron du pont, evaluerDisciplinePacte), store/alerts.ts (alertePrixAuNiveau, arrondirNiveauAlerte, ajouter, supprimer), condition prix-croise de @axiom/alerts, daemon et notify.ts, store/decisionDossiers.ts, chart/tradeMarkers.ts, data/scen.ts (brutesDepuisPaper), data/rapport.ts, store/portfolioCsv.ts.

**À créer.** Champs optionnels stop, objectif, decisionIds et alerteIds sur Position (store web ; @axiom/types n'est pas touché), avec lecture tolérante des anciennes positions et colonnes CSV. Fonctions pures tradeJournalDepuisPositionPort et alertesStopPour(position). Date de sortie optionnelle dans cloturer. Synchronisation alertes ↔ position. Filtre d'origine dans EXPY, le rapport et SCEN. Tests du cycle de vie.

**Données.** Toutes locales : saisie PORT, frais, prix live déjà souscrits, flux Binance du daemon. Aucun appel réseau nouveau.

**Ce qui existe déjà.** Pont automatique vers EXPY seulement depuis PAPER : apps/web/src/store/paper.ts:239 (clôture manuelle) et 260 (TP/SL), via tradeJournalDepuisCloture (apps/web/src/data/paper.ts:331-348, tag unique « paper » l.346). Saisie manuelle EXPY : apps/web/src/components/ExpyWindow.tsx:378. La position PORT n'a ni stop, ni objectif, ni lien de dossier (apps/web/src/store/portfolio.ts:39-55). Clôture datée de force à Date.now() (store/portfolio.ts:306-311). Post-mortem envoyé vers NOTE (apps/web/src/components/PortfolioWindow.tsx:189-207). Statistiques EXPY calculées sur tous les trades, réels et simulés confondus (ExpyWindow.tsx:272). SCEN mélange PORT et PAPER (ScenWindow.tsx:107-111), un choix prévu au plan docs/superpowers/plans/2026-07-24-scen-stress-test.md:68. Aucun module du portefeuille n'appelle alertsStore (grep). Le daemon ne relaie prix-croise que pour la source binance, et sur le flux spot (apps/daemon/src/alerts.ts:50, marketFeed.ts:18-26). Aucun filtre Réel/Simulé n'existe (grep « simul » vide dans ExpyWindow et rapport).

**Contrat.** Aucune fenêtre, aucun fournisseur, aucune clé de trading : conforme. C'est une extension de surface de PORT, EXPY, ALRT et SCEN, donc une exception G100 est à demander. @axiom/types et AlertDef (packages/alerts/src/types.ts:218) restent inchangés si le lien est stocké côté position. Les trades déjà présents dans EXPY ne doivent pas être réécrits (règle BUILD-CONTRACT.md:561-567). SCEN « simulé exclu par défaut » revient sur un choix prévu au plan SCEN : le propriétaire doit valider ce changement de défaut. Prérequis exacts : PRT-2 (R net des frais), PRT-8 (aller-retour CSV), MFN-1 (sinon une fenêtre périmée efface les alertes créées par PORT), DMN-4/SECL-2.

**Risques.** 1) alertsStore.ajouter ne renvoie pas l'id (store/alerts.ts:218-236). Il faut changer sa signature, ce qui touche ses 5 appelants. 2) Une alerte liée peut être supprimée à la main dans ALRT. La position doit tolérer un alerteIds orphelin, et « déplacer » une alerte veut dire la supprimer puis la recréer : elle est alors recalibrée et ne déclenche pas à la première évaluation. 3) Le daemon lit le prix spot Binance : pour un perpétuel, l'écart de base peut déclencher en avance ou en retard. Kraken, Coinbase et MEXC ne sont pas couverts onglet fermé. 4) prix-croise se réarme à chaque retraversée et peut répéter les Telegram autour du stop. 5) La perte estimée est figée dans le message à la création et devient fausse si la taille ou le stop changent sans resynchronisation. 6) Les anciens trades EXPY saisis à la main n'ont pas d'origine : il faut une classe « non classé », pas « réel » par défaut. 7) Le périmètre est trop large pour un seul lot (cinq sous-fonctions). La check-list PACTE dans PORT fait doublon avec IDEE-4 : PORT n'a pas d'équity, seulement le capital du store risque.

**Fichiers à toucher.**

- apps/web/src/store/portfolio.ts
- apps/web/src/components/portfolio/FormulaireAjout.tsx
- apps/web/src/components/PortfolioWindow.tsx
- apps/web/src/components/portfolio/SectionOuvertes.tsx
- apps/web/src/components/portfolio/SectionClos.tsx
- apps/web/src/store/portfolioCsv.ts
- apps/web/src/data/portExpy.ts (nouveau, pur : tradeJournalDepuisPositionPort, alertesStopPour) + test
- apps/web/src/store/alerts.ts (ajouter renvoie aujourd'hui un booléen, l.82 et 218 : il doit renvoyer l'id)
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/components/ExpyWindow.tsx
- apps/web/src/data/rapport.ts
- apps/web/src/components/ScenWindow.tsx
- apps/web/src/store/portfolio.test.ts

**Mesure de succès.** Un trade réel saisi une seule fois apparaît dans EXPY avec son R et son dossier. Test : ouverture avec stop → 2 alertes liées, clôture → 0 ; stop du mauvais côté refusé. Essai réel : onglet fermé, le franchissement du stop d'une position Binance produit un Telegram en moins de 10 s. Une clôture PAPER ne change pas l'expectancy affichée en mode « Réel ». SCEN ne contient par défaut que des positions réelles.

**Avis des juges.**

- valeur (5) : C'est la seule idée qui touche directement l'argent réel. Une position PORT gagne un stop, sa distance en R, une alerte au stop relayée par Telegram et un R versé automatiquement dans EXPY : la ressaisie disparaît et le stop n'est plus surveillé de mémoire. J'ai vérifié que l'interface Position n'a aucun champ stop (store/portfolio.ts:39-55).
- cout-risque (2) : Chantier L à cinq sous-fonctions qui touche PORT, EXPY, ALRT et SCEN, avec un calcul de R et une synchro d'alertes à tenir (orphelins, recréation à chaque changement de stop). Changer le retour d'alertsStore.ajouter (booléen vers id, store/alerts.ts:218-238) est simple car les appelants testent la vérité, mais les prérequis PRT-2, PRT-8, MFN-1 et DMN-4 rendent l'ensemble cher.
- coherence (4) : L'idée est alignée : suivi manuel, aucune clé de trading, et la séparation Réel / Simulé / Non classé sert l'honnêteté. Mais elle compte cinq sous-fonctions réparties sur PORT, EXPY, ALRT et SCEN, ce qui risque de disperser l'effort : il faut la découper comme proposé.

### 3. IDEE-22 — Lignes d'alertes prix sur le graphe : voir, supprimer et déplacer au clic droit

**Score 16/20** · valeur 4 · coût-risque 4 · cohérence 4 · effort révisé **S** (initial S) · existe déjà : non · origines : ALR-8

**Problème.** On crée une alerte prix par clic droit (chart/priceAlertMenu.ts ; ChartInstance.tsx:876-888), mais elle n'est jamais dessinée : dans apps/web/src/chart, seul priceAlertMenu.ts touche alertsStore, et seulement pour y écrire. L'opérateur ne voit pas ses niveaux face au prix ; il en oublie et en recrée en double, car le niveau arrondi au pixel varie (store/alerts.ts:68-75). Les alertes à ±2 % créées d'un clic par EQS (ScreenerWindow.tsx:245-255) restent elles aussi invisibles.

**Proposition retenue après vérification.** Couche « Alertes » sur le patron PAPER, pas sur le socle des niveaux : un module chart/alertesLignes.ts fournit un FournisseurLignes pur et testé, lu dans alertsStore. Elle trace les alertes prix-croise et les jambes prix des composites du marché du slot maître. Étiquette « ⏰ 65 000 ↑ » suivie de l'état armée, en attente ou en pause. Emphase forte si armée, faible si en pause ou en attente de ré-armement. Couche active par défaut, coupée en replay, bascule par commande ⌘K et dans la section Alertes. Le contrôleur reçoit sa propre instance de NiveauxLignesController, et l'accroche du clic droit concatène ses lignes avec un alertId. Près d'une ligne d'alerte, le menu propose « Supprimer l'alerte » et « Mettre en pause / Reprendre », au lieu d'une nouvelle alerte au même prix. « Déplacer » se fait en deux temps (choisir l'entrée, puis cliquer le nouveau niveau ; Échap annule) et recrée l'alerte avec un NOUVEL id, ce qui recalibre le front et le daemon. Le déplacement est faisable plus tard ; sans lui, l'effort reste S.

**Proposition initiale.** Une couche « Alertes » du graphe, active par défaut, trace une ligne pointillée pour chaque alerte prix du marché du slot, jambes prix des composites comprises. Étiquette « ⏰ 65 000 ↑ · armée » ; trait plein si déclenchée, atténué si en pause ou en sourdine (IDEE-21). Près d'une ligne d'alerte (accroche existante à ±6 px), le clic droit propose « Supprimer l'alerte » et « Déplacer ici » (nouveau niveau, alerte recalibrée). La couche figure dans le menu Couches (IDEE-32).

**Réutilise.** Contrôleur générique chart/niveauxLignes.ts (LigneNiveau, FournisseurLignes), socle chart/niveauxOverlays.ts (bascule persistée, chargement paresseux, couche liée au slot), ligneAccrochee de priceAlertMenu.ts, alertsStore et decrireCondition.

**À créer.** Source chart/niveaux/alertes.ts (FournisseurLignes pur, testé). Clé alertes dans CleOverlayNiveaux. Deux entrées de menu contextuel. Action deplacer(id, niveau) dans store/alerts.ts, qui remet l'armement à undefined.

**Données.** Aucune donnée nouvelle.

**Ce qui existe déjà.** La création au clic droit existe (apps/web/src/chart/priceAlertMenu.ts:149-160 et 294-327, branchée dans apps/web/src/chart/ChartInstance.tsx:876-888), de même que l'accroche à ±6 px sur les lignes de niveaux (priceAlertMenu.ts:55-70, ChartInstance.tsx:1168). Aucun dessin des alertes : dans apps/web/src, seul priceAlertMenu.ts importe alertsStore côté graphe, et seulement pour écrire. Le précédent le plus proche est l'overlay PAPER (apps/web/src/chart/paperLignes.ts : fournisseur léger lu dans un store, actif par défaut, slot maître). AlertsPanel.tsx ne propose que la suppression (l.475) : aucune modification de niveau.

**Contrat.** Aucune fenêtre, aucun fournisseur, aucune dépendance. Nouvelle couche de graphe, donc exception G100 à demander. Le store alerts fait déjà partie du chargement initial (runtime, SessionStrip) : aucun coût de budget si la couche suit le patron PAPER plutôt que le chunk paresseux des niveaux.

**Risques.** (1) Passer la couche par CleOverlayNiveaux et niveaux/composite pose deux problèmes. Le socle est désactivé par défaut et chargé à la demande (niveauxOverlays.ts:1-9) : une couche active par défaut chargerait le composite à chaque démarrage. Et fusionnerLignes (niveaux/composite.ts:37-50) fusionne les lignes de même prix : une alerte posée sur un PDH deviendrait « PDH·⏰ » et le menu ne saurait plus qu'il s'agit d'une alerte. (2) « Déplacer ici » se contredit : l'accroche ne s'active qu'à ±6 px de la ligne, donc « ici » est presque l'ancien niveau. (3) Remettre `arme` à undefined côté front ne recalibre pas le daemon, qui garde son état par id (alertes_etat ; fusionnerEtatArme, apps/daemon/src/alerts.ts:138-145) : il faut un nouvel id (supprimer puis recréer). (4) Les lignes ne sont posées que sur le slot maître (ChartInstance.tsx:1071) et doivent être coupées en replay, comme les niveaux. (5) LigneAccrochable ne porte pas d'identifiant (priceAlertMenu.ts:48-51) : il faut un alertId optionnel pour proposer « Supprimer ».

**Fichiers à toucher.**

- apps/web/src/chart/alertesLignes.ts
- apps/web/src/chart/alertesLignes.test.ts
- apps/web/src/chart/ChartInstance.tsx
- apps/web/src/chart/priceAlertMenu.ts
- apps/web/src/chart/priceAlertMenu.test.ts
- apps/web/src/chart/niveauxLignes.ts
- apps/web/src/store/alerts.ts

**Mesure de succès.** Test du fournisseur : seules les alertes du marché du slot sont renvoyées, avec le bon état. À l'usage : les alertes EQS et celles posées au clic droit sont visibles et se suppriment en deux clics ; plus d'alertes prix en double au même niveau.

**Avis des juges.**

- valeur (4) : Voir ses niveaux d'alerte face au prix est un réflexe standard qui manque. L'opérateur éviterait les doublons et les oublis, et pourrait gérer ses alertes là où il lit le marché, pour un effort S.
- cout-risque (4) : Le patron existe et a fait ses preuves : paperLignes.ts (124 lignes) plus NiveauxLignesController, câblés dans ChartInstance.tsx:1051-1052, et l'accroche du clic droit est déjà en place. Il faut ajouter un alertId à LigneAccrochable et deux entrées de menu. Le déplacement reste reportable.
- coherence (4) : Fonction de base d'un terminal, qui évite les alertes en double ; effort S, sur le modèle déjà utilisé par PAPER. Elle n'apporte rien à la fiabilité des calculs, mais ajoute très peu de surface.

### 4. IDEE-4 — Contrôle avant l'entrée mesuré et figé avec l'ordre : alignement, régime, état des données, score PACTE

**Score 15/20** · valeur 4 · coût-risque 2 · cohérence 5 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : DEC-7, RSK-6, TRA-8

**Problème.** Dans la check-list PACTE, « A·Régime » est une case que l'opérateur coche lui-même (« HTF aligné », PaperWindow.tsx:141 et 697-704 ; data/paper.ts:431), alors que la concordance 15m/1h/4h/1d est déjà calculée pour le BRIEF (data/multiEchelle.ts:109-124) et que le régime vit dans regimeStore (store/regime.ts:58). Le score PACTE, le risque % et le R:R prévu ne suivent pas l'ordre : placerOrdre ne reçoit que prix, taille, TP et SL (PaperWindow.tsx:290-301), et le trade journalisé ne garde qu'entrée, stop et taille (data/paper.ts:331-348). Aucune vérification de fraîcheur des données n'existe dans data/paper.ts, store/paper.ts ni PaperWindow.tsx (grep vide). Tous les trades PAPER ont le seul tag « paper » (data/paper.ts:346), et repartition par tag (data/expy.ts:197) est testée mais affichée nulle part. Impossible donc de savoir si les trades 5/5 rapportent plus que les 3/5, si la contre-tendance coûte, ou si trader sur des données dégradées coûte des R.

**Proposition retenue après vérification.** Le critère A de PACTE devient mesuré. Au changement de symbole du formulaire PAPER, avec debounce et cache, chargerMultiEchelle est lancé. Le badge affiche « 3/4 échelles alignées sur 1d · sens du trade aligné ou contraire · régime marché +1 ». A est validé si le sens du trade suit l'échelle de référence avec au moins 3 échelles alignées sur 4 mesurables ; un trade contraire demande une courte raison. Une ligne Données, informative et hors du score, reprend la santé de la source de l'ordre, le nombre d'échelles mesurées et la fraîcheur du régime. À l'envoi, AXIOM fige disciplineEntree : score, critères manquants, risque %, cible, rPrevu, alignement, régime, état des données et horodatage de mesure (ou « non mesuré »). Il suit ordre, position et trade EXPY comme stopInitial. EXPY ajoute trois dimensions (score PACTE, alignement, données) à la section existante « Résultats par contexte » avec statistiquesR (n, moyenne, erreur type), en partition par dimension, avec le ratio R réalisé / R prévu. Après PRT-2.

**Proposition initiale.** Quand l'opérateur saisit un ordre PAPER (ou une position PORT), AXIOM charge la concordance multi-échelle du symbole et lit le régime. Le badge A affiche « 3/4 échelles haussières · régime +1 » et se colore seul ; un trade contre la tendance de fond demande une courte raison. Une ligne « Données », informative et hors du score, est verte si le flux du graphe est vivant, si les indicateurs affichés ne sont ni en repli ni en amorce courte et si le régime est déterminé ; sinon elle est ambre et donne ses raisons. À l'envoi, AXIOM fige le score, les critères manquants, le risque %, la cible, le R:R prévu, l'alignement mesuré, le régime et l'état des données. Ces éléments suivent ordre, position, trade EXPY et dossier, sous forme de tags (« pacte:5/5 », « mtf:alignee », « donnees-degradees ») et de deux champs (cible, rPrevu). EXPY affiche un tableau « R par tag » (n, moyenne, erreur type) et le ratio « R réalisé / R prévu ».

**Réutilise.** data/multiEchelle.ts (chargerMultiEchelle, concordanceEchelles), store/regime.ts, data/paper.ts (evaluerDisciplinePacte, tradeJournalDepuisCloture), store/paper.ts (placerOrdre), store/health.ts, chart/indicators.ts (statutIndicateur), data/expy.ts (repartition), data/expyContexte.ts (statistiquesR), components/expy/ContexteResultats.tsx, data/decisionDossier.ts (ContexteDecision contient déjà regimeScore).

**À créer.** Appel différé de chargerMultiEchelle au changement de symbole du formulaire. Fonction pure etatDonneesPreTrade. Champ disciplineEntree {score, manquants, alignees, total, regime, donnees, forcage?} sur OrdrePaper, PositionPaper et TradeJournal, figé à la première ouverture. Champs optionnels cible et rPrevu. Tags automatiques. Tableau EXPY par tag.

**Données.** Disponibles : 4 requêtes de bougies par symbole (les mêmes que le BRIEF), régime et santé en mémoire.

**Ce qui existe déjà.** Concordance 15m/1h/4h/1d déjà calculée pour le BRIEF (apps/web/src/data/multiEchelle.ts:109-142 ; BriefWindow.tsx:258). Le critère A de PACTE est une case cochée à la main (PaperWindow.tsx:141 et 697-704 ; data/paper.ts:431). Le régime global vit dans regimeStore (store/regime.ts:58), et regimeScore est déjà un champ de ContexteDecision (data/decisionDossier.ts:15). placerOrdre ne reçoit ni score ni R:R (PaperWindow.tsx:290-301). Le trade journalisé n'a qu'un tag, « paper » (data/paper.ts:346). repartition par tag (data/expy.ts:197) n'est affichée nulle part (grep). Il existe DÉJÀ une section EXPY de cohortes avec n, moyenne, médiane et erreur type, « Résultats par contexte archivé » (components/expy/ContexteResultats.tsx, montée à ExpyWindow.tsx:738 ; statistiquesR dans data/expyContexte.ts:24-40), mais limitée aux lectures de dossiers (quadrant, divergence).

**Contrat.** La contrainte « aucune » est inexacte : badge automatique, ligne Données et cohortes EXPY sont une extension de surface de PAPER et d'EXPY, donc une exception G100 est à demander. Pas d'indicateur, de fournisseur ni de fenêtre. La règle « capture synchrone, jamais de chargement rétrospectif » (BUILD-CONTRACT.md:671-674) impose de figer à l'envoi la valeur déjà chargée, avec son horodatage, ou « non mesuré ». Aucun recalcul après coup, et les anciens trades restent « non mesuré ». La mention du BRIEF (un alignement n'est pas un signal) est à reprendre. Prérequis conseillé : PRT-2, sinon les cohortes comparent des R bruts biaisés sur les stops serrés.

**Risques.** 1) Une règle explicite pour A manque : par exemple, sens du trade = concordance.direction (échelle de référence) et au moins 3 échelles alignées sur 4 mesurables. Le total peut tomber sous 4 si une échelle échoue (multiEchelle.ts:109-118). 2) Le régime est global (BTC) : il faut l'étiqueter « régime marché » pour un altcoin. 3) La ligne Données proposée s'appuie sur statutIndicateur, qui exige l'instance Chart (chart/indicators.ts:124) et porte sur le symbole du graphe, pas forcément celui de l'ordre : source de bruit. Il vaut mieux santé de la source de l'ordre (healthStore), échelles mesurées n/4 et fraîcheur du régime (regimeStore.majTs). 4) Des tags plats se chevauchent : un trade compte dans plusieurs cohortes (data/expy.ts:194-214), donc des comparaisons « 5/5 contre ≤ 3/5 » mal partitionnées. Il faut une partition par dimension, comme ContexteResultats. 5) Quatre requêtes de 200 bougies par changement de symbole : debounce et cache nécessaires. Les sources PAPER (binance, kraken, coinbase, mexc, data/ticker.ts:89-93) n'ont pas de quota Twelve Data. 6) L'échantillon reste petit : avertissement n < 30 déjà présent dans ContexteResultats, à garder.

**Fichiers à toucher.**

- apps/web/src/data/preTrade.ts (nouveau, pur : alignementPourSens, etatDonneesPreTrade) + test
- apps/web/src/data/multiEchelle.ts (petit cache par symbole et source, TTL de quelques minutes)
- apps/web/src/data/paper.ts (EntreeDisciplinePacte avec alignement mesuré ; disciplineEntree sur OrdrePaper et PositionPaper, figée à la première ouverture ; tradeJournalDepuisCloture recopie champs et tags)
- apps/web/src/store/paper.ts (placerOrdre, estOrdreValide l.126, estPositionValide l.138)
- apps/web/src/data/expy.ts et apps/web/src/store/expy.ts (champs optionnels cible, rPrevu, disciplineEntree ; estTradeValide l.104-119)
- apps/web/src/components/PaperWindow.tsx
- apps/web/src/data/expyContexte.ts et apps/web/src/components/expy/ContexteResultats.tsx (dimensions « discipline » au lieu d'une nouvelle table)

**Mesure de succès.** Plus aucune case « aligné » cochée à la main. Chaque trade PAPER clos porte ses tags dans EXPY. Après une trentaine de trades, EXPY montre le R moyen et l'erreur type des trades 5/5 contre ≤ 3/5, alignés contre contre-tendance, données fraîches contre dégradées, ainsi que le ratio de sortie.

**Avis des juges.**

- valeur (4) : Mesurer si les trades 5/5, alignés, ou pris sur des données saines rapportent plus transforme la discipline PACTE en connaissance de l'edge. Le critère A devient objectif au lieu d'être déclaré. La valeur restera limitée par la taille des échantillons PAPER.
- cout-risque (2) : Il faut propager un objet figé ordre → position → trade, comme stopInitial (12 occurrences et 2 validateurs), lancer quatre requêtes avec cache par symbole, et ajouter des cohortes EXPY partitionnées. C'est un M haut, avec des règles d'alignement à inventer et du bruit possible sur les données.
- coherence (5) : Une case cochée par l'opérateur devient une mesure figée à l'envoi. C'est exactement la règle « capture synchrone » et le modèle « résultats par contexte » d'EXPY. Les cohortes doivent rester descriptives : la spec d'analyse interdit de présenter le « meilleur score » comme une preuve.

### 5. IDEE-6 — EXPY : mes résultats par origine de signal, comparés à la référence historique

**Score 15/20** · valeur 4 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : DEC-4

**Problème.** L'opérateur ne peut pas savoir quel signal lui rapporte. PAPER étiquette tous ses trades « paper » (data/paper.ts:346). repartition(par: "symbol" | "tag") existe (data/expy.ts:197) mais n'est utilisée nulle part. « Résultats par contexte archivé » ne groupe que par quadrant ou divergence (data/expyContexte.ts:45-50, components/expy/ContexteResultats.tsx). Pourtant chaque trade lié porte un dossier dont l'origine contient la condition d'alerte (data/decisionDossier.ts:28-38). Les références existent ailleurs sans être rapprochées : étude d'évènements des signaux EQS (data/validationSignaux.ts:187, ScreenerWindow.tsx:344-396) et expectancy R des runs BT archivés (data/backtestArchive.ts:10-23).

**Proposition retenue après vérification.** EXPY affiche les résultats par origine du signal, portée par un tag stable. Une fonction pure cleOrigineDossier(dossier) normalise la condition : type, indicateur, sortie, comparateur et unité de temps, sans niveau de prix. Exemples : « origine:funding-extreme », « origine:indicateur-seuil:axis.etat:4h », « origine:manuel ». Quand un ordre PAPER est lié à un dossier, la clé suit la position, y compris au renfort. Ensuite, tradeJournalDepuisCloture l'ajoute aux tags, ce qui la rend indépendante d'une suppression du dossier. L'opérateur tague ses trades manuels de la même façon. EXPY ajoute un tableau par origine qui reprend repartition(par "tag") et statistiquesR : n, R moyen et médian, erreur type, taux de réussite, R cumulé, avec l'avertissement « petit échantillon » et l'étiquette « R brut ». Une référence s'affiche à côté seulement si elle est dans la même unité : l'expectancy R d'un run BT que l'opérateur a lié explicitement (IDEE-13), montrée seulement une fois PRT-2 et BT-1 corrigés. La validation EQS, en %, reste citée à part comme « taux directionnel historique » et n'est jamais soustraite au R.

**Proposition initiale.** EXPY gagne une dimension « Origine du signal », avec une clé stable tirée du dossier : « AXIS · État ≥ 1 · 4h », « Funding extrême », « EQS · Build-up long », « Manuel ». Pour chaque origine : n, R moyen et médian, erreur type, taux de réussite, R cumulé, avec l'avertissement « petit échantillon » existant. En regard : la référence, soit le dernier run BT archivé de la même règle (même symbole et intervalle, ou le run lié par IDEE-13), soit la validation historique EQS. L'écart entre réel et référence montre si l'exécution dégrade le signal. Le filtre Réel / Simulé d'IDEE-1 s'applique ; les dimensions PACTE d'IDEE-4 utilisent le même tableau.

**Réutilise.** data/expyContexte.ts (statistiquesR, exclusions, partition), components/expy/ContexteResultats.tsx et TableTriable, data/expy.ts (repartition, à recycler), store/backtestHistory.ts (runs archivés), store/signaux.ts (résultat de validation), @axiom/alerts (decrireCondition).

**À créer.** Fonctions pures cleOrigineDossier(dossier) et analyserParOrigine(trades, dossiers, runsBt). Règle d'appariement de la référence. Nouvelle option dans le sélecteur de dimension.

**Données.** Disponibles : trades EXPY avec decisionIds, dossiers, archives BT (50 runs), validation EQS relancée à la demande. Les trades sans dossier vont dans « origine inconnue ».

**Ce qui existe déjà.** repartition(par: "symbol" | "tag") existe mais n'est utilisée par aucun code applicatif (apps/web/src/data/expy.ts:197-220 ; ExpyWindow n'importe que statsExpy, equityR, histogrammeR et rMultiple). La seule dimension de groupement est le contexte d'analyse, limité au quadrant et à la divergence (apps/web/src/data/expyContexte.ts:45-50, analyserContextes l.52). statistiquesR est réutilisable (expyContexte.ts:24). PAPER met le tag fixe « paper » sur tous ses trades (data/paper.ts:346), alors que la saisie manuelle d'EXPY a déjà un champ tags (components/ExpyWindow.tsx:359-373). decrireCondition existe (packages/alerts/src/describe.ts:41) mais inclut le niveau de prix : ce n'est pas une clé stable.

**Contrat.** Ni fenêtre ni fournisseur nouveau. Une section EXPY de plus est de la surface : exception G100 à demander. Règle « aucun ancien trade réécrit » (BUILD-CONTRACT.md:567) : on ne retague pas les anciens trades. Pour eux, on peut calculer l'origine à la volée tant que leur dossier existe, en l'étiquetant comme telle. La limite de 100 dossiers sans éviction (BUILD-CONTRACT.md:611) pèse sur le choix technique. La comparaison à une référence attend PRT-2 (R net) et BT-1.

**Risques.** (1) La limite de 100 dossiers (store/decisionDossiers.ts:7 et 110-113) bloque l'objectif de 30 trades par origine : avec 3 ou 4 origines, il faudrait plus de 100 dossiers. Si l'origine n'est lue qu'à l'analyse via decisionIds, supprimer un dossier fait sortir le trade de son groupe (« dossier absent », expyContexte.ts:77). L'origine doit donc être copiée sur le trade à sa création. (2) Les références proposées ne sont pas dans la même unité. La validation EQS mesure un rendement signé en % à 24 h et 72 h, regroupé sur tout l'univers (data/validationSignaux.ts:187 ; ScreenerWindow.tsx:326-396), et elle n'est pas sauvegardée (store/signaux.ts n'écrit rien en localStorage). Le BT archive une expectancy R nette sur des sorties de règle, alors que PAPER sort au TP, au SL ou à la main, en R brut (PRT-2). (3) Rapprocher automatiquement une alerte de « sa » règle BT n'est pas fiable : AlertDef n'a aucun champ de preset (packages/alerts/src/types.ts:218-245), et un ConfigRun BT combine entrée, sortie, stop et taille. (4) Les dossiers PACTE portent une condition « prix-croise » fictive (PaperWindow.tsx:247-286) : tant qu'IDEE-8 n'est pas fait, ils tomberont tous dans le groupe « Prix croise ». (5) Comparer n = 8 à une référence pousse à des conclusions fausses.

**Fichiers à toucher.**

- apps/web/src/data/decisionDossier.ts
- apps/web/src/data/paper.ts
- apps/web/src/store/paper.ts
- apps/web/src/components/PaperWindow.tsx
- apps/web/src/data/expy.ts
- apps/web/src/components/ExpyWindow.tsx
- apps/web/src/data/decisionDossier.test.ts
- apps/web/src/data/expy.test.ts

**Mesure de succès.** L'opérateur lit en une vue le R moyen par origine et l'écart à la référence, et décide de garder ou couper une alerte sur au moins 30 trades.

**Avis des juges.**

- valeur (4) : « Quel signal me rapporte » est la question centrale de l'opérateur, et copier l'origine sur le trade la rend durable. La réponse arrive lentement (n par origine faible) et reste en R brut tant que PRT-2 n'est pas fait.
- cout-risque (3) : Le cœur est bon marché : repartition par tag et statistiquesR existent déjà, il suffit d'ajouter un tag dans tradeJournalDepuisCloture. La normalisation cleOrigineDossier et le suivi de la clé au renfort demandent pourtant de l'entretien, et le groupe reste faux pour les dossiers PACTE tant qu'IDEE-8 n'est pas fait.
- coherence (4) : Elle répond à « quel signal me rapporte » avec des tags stables, sans réécrire les anciens trades. La comparaison à une référence doit rester descriptive et dans la même unité, sinon elle contredit la spec d'analyse ; elle dépend aussi d'IDEE-8.

### 6. IDEE-9 — AXIS depuis son figeage : suivi en données vraiment nouvelles, comparé à ce que le test annonçait

**Score 15/20** · valeur 4 · coût-risque 2 · cohérence 5 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : EDG-1

**Problème.** AXIS est la seule stratégie validée, mais sa mesure s'arrête au 2024-07-01 (docs/axis-2026-10-07.md:223-225). La v2 a été figée le 2026-10-07 (scripts/axis/manifeste-v2-2026-10-07.json:3) et le garde-fou v5 le 2026-10-10 (manifeste-v5-2026-10-10.json:3). Depuis, chaque bougie 4h est une donnée jamais vue, et rien ne la mesure (grep « figeage », « forward », « dégradation » vide dans le code). BT ne propose que des plages comptées depuis aujourd'hui (store/backtest.ts:116-121). L'infobulle répète un verdict figé (packages/indicators/src/strategy/stratAxis.ts:501-502) sans dire si le comportement depuis le figeage reste dans l'attendu. L'opérateur engage de l'argent réel sur ces signaux sans ce contrôle.

**Proposition retenue après vérification.** « AXIS depuis le figeage » : une section BT (exception G100) ouverte depuis le preset AXIS ou par ⌘K. Elle rejoue AXIS sur BTC, ETH, XRP et SOL en 4h spot Binance, avec 1 500 bougies d'amorce, la mesure commençant strictement après 2026-10-07T12:54Z, référence BTCUSDT forcée. Deux lignes distinctes. (a) La v2 (regimeBtc = 0), seule variante testée sur ces 4 actifs : trades depuis le figeage (clos, plus l'ouvert au prix du moment, coûts x1 et x3) ; rang de la somme observée dans la distribution tirée des 344 trades de resultat-v2 pour le même n ; alarme seulement sous p5 ; mention honnête « n requis pour conclure ≈ 130 trades (≈ 2 ans au rythme actuel) ». (b) La v5 (défaut livré), jugée comme son test : écart v5 − v2 sur les mêmes bougies nouvelles (entrées refusées par le garde-fou et leur résultat), sans bande, avec la mention « population du test v5 : alts KuCoin, non suivable ici ». Ajouter achat-conservation et EMA 200 sur la même période, et le tableau par année prolongé par 2026. Une position ouverte au figeage est étiquetée « héritée » et exclue de la comparaison. Contrôle de fidélité : les trades doivent égaler les ▲▼ du graphe (construireTradesStrategie) sur la même fenêtre.

**Proposition initiale.** Une section « AXIS depuis le figeage », ouverte par le preset BT « AXIS confluence (4h) » ou par ⌘K. Elle rejoue AXIS avec ses réglages livrés sur BTC, ETH, XRP et SOL en 4h (option : la watchlist). Seules les bougies clôturées après la date de figeage comptent ; les 1 500 bougies d'avant servent d'amorce. Chaque variante se compare à sa référence (v2 aux trades de resultat-v2, garde-fou BTC à ceux de resultat-v5). Affichage : (1) les trades depuis le figeage, clos ou ouvert (au prix du moment), nets de coûts x1 et x3 ; (2) une bande p5–p95 de la somme attendue pour n trades, tirée au sort parmi les trades du test ; (3) un verdict simple : « trop tôt (n = 4 ; 30 trades attendus vers mars 2027) », « dans la bande attendue » ou « sous p5 : dégradation à examiner » ; (4) sur la même période, achat-conservation et EMA 200 seule ; (5) le tableau par année du test, prolongé par l'année en cours. Usage : chaque semaine, avant de suivre un signal.

**Réutilise.** runBacktest avec debutEvaluationMs (packages/backtest/src/engine.ts), preset builtin:axis (store/backtest.ts:529), accumulerKlines (data/backtestData.ts:103), chargerRefCloseBacktest (store/backtest.ts:79), monteCarloTrades et mulberry32 (packages/backtest/src/monteCarlo.ts), construireTradesStrategie (packages/indicators/src/utils-fabrique-strategie.ts:121), tradesX1, parAnneeX1 et achatConservationPct de scripts/axis/resultat-v2-2026-10-07.json et resultat-v5-2026-10-10.json.

**À créer.** Module pur suiviFigeage.ts (bande attendue pour n trades, verdict à trois états, exclusion stricte des bougies d'avant le figeage). Constante compacte de référence générée une fois depuis les JSON de résultats. Section d'interface. Tests : bande, verdict, égalité avec les ▲▼ du graphe.

**Données.** Déjà disponibles : bougies spot 4h Binance sans clé, référence BTC chargée par BT, trades de référence versionnés dans scripts/axis.

**Ce qui existe déjà.** Aucun suivi après figeage : grep « figeage », « forward », « dégradation » ne trouve rien dans apps/web/src ni apps/daemon/src. Le plus proche : le preset BT « AXIS confluence (4h) » (apps/web/src/store/backtest.ts:529) sur la plage « 3 mois » (PLAGES, store/backtest.ts:116-121). Il couvre la période depuis le 7 octobre, mais la mélange avec deux mois déjà vus, tourne sans amorce (BT-1) et sans référence. Le Monte-Carlo (components/BacktestWindow.tsx:700-790) rééchantillonne les trades du run lui-même, pas ceux du test. Les trades de référence existent bien : resultat-v2-2026-10-07.json, cellules[].resultat.tradesX1 (101, 99, 84 et 60 trades), parAnneeX1 et achatConservationPct.

**Contrat.** Section dans BT : exception G100 à demander, comme les ajouts du 14 septembre. Données disponibles sans nouveau fournisseur : klines spot Binance sans clé, via accumulerKlines (SOURCE = binance, backtestData.ts:43). Recalcul à la demande, sans enregistreur. Ne jamais embarquer resultat-v5 (11 Mo) dans le bundle : seule une constante compacte d'environ 10 Ko, chargée avec le chunk BT (budget de build). Prérequis : BT-2 ; BT-1 seulement si le calcul passe par run() du store.

**Risques.** 1) Mauvaise population pour la v5. Les trades de resultat-v5 portent sur 139 paires KuCoin de faible capitalisation (achat-conservation à −96 % en médiane), pas sur BTC, ETH, XRP et SOL. KuCoin ne fait pas partie des 9 sources : cette population ne peut pas être suivie. Comparer la v5 sur les majors à ces trades serait faux. Le test v5 affirmait seulement que la v5 fait mieux que la v2 (P1). 2) Puissance très faible. Mesure sur les 344 trades v2 : moyenne +5,4 %, écart-type 24,8 %, médiane entre −2,3 et −3,7 %, environ 36 % de gagnants, environ 4,9 trades par mois sur les 4 actifs. Pour n = 10, la bande p5–p95 de la somme va de −43 % à +207 %. Détecter une chute de l'expectancy à zéro (alpha 5 %, puissance 80 %) demande environ 128 trades, soit environ 26 mois. Le verdict à trois états dira « dans la bande » pendant près de deux ans : « chaque semaine, chiffres à l'appui » promet trop. 3) Une position déjà ouverte au figeage est remplie dès la première barre évaluée, car le moteur entre sur le niveau etat ≥ 1 (engine.ts:550-560). Ce trade ne correspond à aucun ▲ : l'égalité avec le graphe échoue s'il n'est pas étiqueté. 4) chargerRefCloseBacktest lit refSymbolStore, que l'utilisateur peut changer (store/backtest.ts:83) : il faut forcer BTCUSDT. 5) Le code a changé depuis le figeage : stratAxis.ts au commit 2e9947e du 14 octobre (MNT-6 : 5 fichiers figés sur 17 modifiés). Un contrôle de fidélité de l'état est nécessaire. 6) Les trades de 2017 (BTC +57 % par trade) gonflent la queue haute de la bande.

**Fichiers à toucher.**

- packages/backtest/src/suiviFigeage.ts (nouveau, pur)
- packages/backtest/src/suiviFigeage.test.ts
- packages/backtest/src/index.ts
- apps/web/src/data/axisReferenceV2.ts (constante générée : 344 pnlPct datés, parAnneeX1, achatConservationPct)
- scripts/axis/generer-reference-suivi.ts (générateur, distinct des runners figés)
- apps/web/src/store/backtest.ts (exporter chargerRefCloseBacktest en forçant BTCUSDT, action de suivi)
- apps/web/src/data/backtestData.ts (prérequis BT-2)
- apps/web/src/components/BacktestWindow.tsx (section)
- apps/web/src/components/CommandPalette.tsx (entrée ⌘K)

**Mesure de succès.** Les trades depuis le figeage sont identiques aux ▲▼ du graphe sur la même période (test). En simulation, une série tirée de la référence tombe dans la bande p5–p95 environ 90 % du temps. Le verdict des 4 cellules s'affiche en moins de 10 s. L'opérateur peut dire chaque semaine, chiffres à l'appui, si AXIS se comporte comme testé.

**Avis des juges.**

- valeur (4) : AXIS est la seule stratégie engagée en réel. Un suivi honnête sur des données vraiment nouvelles évite deux erreurs : abandonner AXIS pendant un drawdown normal, ou continuer une stratégie cassée. La faible puissance (environ deux ans) est annoncée ; l'alarme sous p5 reste utile contre une rupture nette.
- cout-risque (2) : Le recalcul est faisable, mais les pièges sont nombreux : position héritée, référence BTCUSDT forcée, fidélité au code modifié depuis le figeage, constante de distribution à embarquer et mauvaise population pour la v5. Le risque d'afficher un verdict faux sur la seule stratégie validée est élevé pour un gain statistique faible.
- coherence (5) : Elle applique à AXIS sa propre méthode « figer puis tester », sur des données vraiment nouvelles. Elle dit franchement que la puissance statistique est faible (environ 2 ans pour conclure). C'est le cœur de l'identité du produit : être honnête sur la valeur du signal.

### 7. IDEE-10 — « Le hasard ferait-il aussi bien ? » : test de timing et intervalles de confiance dans BT, EQS et EXPY

**Score 15/20** · valeur 4 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : EDG-2

**Problème.** La grille BT affiche PnL, Sharpe, taux de réussite et expectancy sans aucune marge d'incertitude (components/BacktestWindow.tsx:1006-1056). Le contrôle de timing du protocole AXIS, le critère C3 par décalage circulaire (docs/axis-2026-10-07.md:233 et 266-267), n'existe que dans les scripts (prefixeTiming, capte, testTiming : scripts/valider-axis-v5.ts:1066-1146, recopiés selon MNT-6). C'est pourtant ce test qui a recalé AXIS de 2h à 1d (README.md:187-188 : ces unités « gagnent sans timing démontré face à la même exposition placée au hasard »). La validation EQS affiche des moyennes sans IC (store/signaux.ts:452), et EXPY écrit qu'aucun intervalle de confiance n'est établi (components/expy/ContexteResultats.tsx:46).

**Proposition retenue après vérification.** Extraire dans @axiom/backtest le test de timing par décalage circulaire des scripts (prefixeTiming, capte et testTiming, avec la graine et les 1 999 tirages du protocole), étendu aux intervalles signés. Ajouter sous la grille BT une ligne du type « Timing contre la même exposition au hasard : p = 0,41 — dans l'échantillon, non corrigé ; 7 configurations essayées sur BTCUSDT 4h (archive BT) ». Cette ligne est grisée et dit « trop peu de trades » sous MC_MIN_TRADES. Pour l'IC, réutiliser le Monte-Carlo existant (p5–p95 de l'équité finale ÷ n = IC 90 % de l'expectancy) en le nommant comme tel, plutôt qu'un second bootstrap ; Wilson va dans le title de la tuile (BT-6). Pour EQS, ajouter la somme des carrés à SommesEtude afin d'afficher l'écart au drift avec son IC. EXPY reste inchangé.

**Proposition initiale.** Un module pur dans @axiom/backtest calcule pour chaque run : (a) le test de timing par décalage circulaire, avec la convention de C3 (rendements log d'ouverture à ouverture, graine fixe, 2 000 tirages), affiché « timing contre la même exposition au hasard : p = 0,03 » ; (b) l'IC bootstrap à 95 % de l'expectancy nette par trade, par blocs, et l'intervalle de Wilson du taux de réussite ; (c) la part du gain qui vient de la seule exposition. Une ligne de verdict sous la grille : « +12 % mais p = 0,41 : rien ne distingue ce timing du hasard ». Les IC s'appliquent aussi à la validation EQS et aux groupes EXPY. Cela va plus loin que BT-8 (achat-conservation = exposition 100 %) et que BT-6 (Wilson en infobulle).

**Réutilise.** Code des scripts à extraire : prefixeTiming, capte, testTiming (scripts/valider-axis-v5.ts:1066-1146) et pBinomiale (l.1557), dans l'esprit de l'extraction recommandée par MNT-6. mulberry32, percentileTrie et mode blocs de packages/backtest/src/monteCarlo.ts ; partagerResultatMoities (walkForward.ts) ; statistiquesR (data/expyContexte.ts, erreurType) ; SommesEtude (data/validationSignaux.ts).

**À créer.** packages/backtest/src/significativite.ts et ses tests (p à peu près uniforme sur marche aléatoire, reproduction exacte des valeurs des scripts sur une série figée). Une ligne dans StatsGrid. IC dans les cellules de validation EQS et dans ContexteResultats.

**Données.** Déjà chargées : bougies et trades du run, évènements de la validation EQS, R d'EXPY.

**Ce qui existe déjà.** Le test de timing est absent de l'application : il n'existe que dans les scripts (scripts/valider-axis-v5.ts:1066-1146). Le seul « décalage circulaire » hors scripts est un commentaire, stratAxis.ts:63. Un IC bootstrap existe de fait : le Monte-Carlo BT affiche l'équité finale p5/p50/p95, avec un mode blocs et un minimum de 10 trades (BacktestWindow.tsx:750-768, monteCarlo.ts:79). C'est un intervalle à 90 % de la somme des trades, donc de l'expectancy × n, mais il n'est pas présenté comme un IC. EXPY affiche déjà l'erreur type par groupe et pour l'ensemble (expy/ContexteResultats.tsx:18 et 40), et refuse volontairement tout IC sous n R < 30 (l.46). La validation EQS se compare au drift inconditionnel (data/validationSignaux.ts:187-213) mais sans dispersion : SommesEtude n'a pas de somme des carrés (l.47-52).

**Contrat.** Statistique ajoutée dans BT : exception G100 à demander (BT-6 et BT-8 le disent déjà). Aucune dépendance. StatsBacktest vit dans packages/backtest/src/types.ts, hors @axiom/types figé : un champ facultatif dans statsValides suffit. Changer VERSION_MOTEUR_BT si le champ est archivé. Le mulberry32 du paquet produit exactement la même suite que celui des scripts (vérifié : 0 écart sur 5 graines × 100 000 tirages), ce qui rend la reproduction exacte possible.

**Risques.** 1) Le p est mesuré dans l'échantillon, sans correction. BT est une boucle de réglage : l'opérateur retouche ses règles sur la même fenêtre (3 mois à 2 ans). Un p = 0,03 obtenu après 20 essais ne vaut rien, ce qui va contre le protocole AXIS « figer puis tester ». 2) Puissance faible : AXIS en 4h sur 3 à 6 mois donne 2 à 12 trades, et le p sera presque uniforme. 3) La convention des scripts ne couvre que long/plat, d'ouverture à ouverture. Les directions short et les-deux exigent des intervalles signés ; les stops et cibles intrabar ne sont qu'approchés (serieDepuisFills). 4) La « part due à l'exposition » recoupe BT-8 : une seule implémentation. 5) Ajouter un IC dans EXPY contredit un choix explicite (pas d'IC sous n < 30), et l'erreur type y est déjà affichée.

**Fichiers à toucher.**

- packages/backtest/src/significativite.ts (nouveau)
- packages/backtest/src/significativite.test.ts
- packages/backtest/src/index.ts
- apps/web/src/workers/backtest.worker.ts (calcul avec les bougies du run)
- apps/web/src/store/backtest.ts
- apps/web/src/components/BacktestWindow.tsx (ligne sous StatsGrid, libellé IC du Monte-Carlo)
- apps/web/src/data/backtestArchive.ts (compter les signatures essayées)
- apps/web/src/data/validationSignaux.ts (somme des carrés)
- apps/web/src/store/signaux.ts
- apps/web/src/components/ScreenerWindow.tsx

**Mesure de succès.** Sur 200 marches aléatoires, environ 5 % des runs sortent à p ≤ 0,05. Sur la série figée BTC v2, le p des scripts est reproduit. L'opérateur ne retient plus une règle dont le PnL vient uniquement du marché haussier.

**Avis des juges.**

- valeur (4) : C'est ce test qui a recalé AXIS hors du 4h. Le donner pour les idées de l'opérateur l'empêche de prendre une exposition chanceuse pour un timing. Il reste mesuré dans l'échantillon et peu puissant sur peu de trades, mais il est bien étiqueté.
- cout-risque (3) : Le code du test de timing existe déjà dans les scripts, et le générateur aléatoire est identique, ce qui limite le risque de calcul. Il faut étendre aux positions short avec des intervalles signés, toucher VERSION_MOTEUR_BT, et le p dans l'échantillon risque d'être mal lu.
- coherence (4) : Elle ramène dans le paquet testé le test de timing qui a fondé les verdicts AXIS, ce qui réduit aussi MNT-6. Mais un p mesuré dans l'échantillon, au milieu d'une boucle de réglage, peut rassurer à tort : la mention « non corrigé » et le nombre d'essais affiché sont indispensables.

### 8. IDEE-15 — Garde-fous de sur-ajustement dans BT : compteur d'essais, puis figer une version et la mesurer sur l'après

**Score 15/20** · valeur 4 · coût-risque 2 · cohérence 5 · effort révisé **L** (initial M) · existe déjà : partiellement · origines : EDG-5, EDG-8

**Problème.** BT archive chaque run avec signature, marché, unité et bornes (store/backtest.ts:953-962) et enregistre une version datée (store/backtestHistory.ts:136), mais rien n'utilise ces informations. L'outil sait combien de variantes ont été essayées sur les mêmes données et ne le dit jamais ; or le meilleur de N essais paraît bon même sans avantage réel, ce que la doc AXIS reconnaît pour elle-même (docs/axis-2026-10-07.md:264-265). L'archive s'arrête à 50 runs (backtestHistory.ts:109) et n'accepte que 3m/6m/1a/2a (data/backtestArchive.ts:58) ; les plages sont relatives à aujourd'hui. La méthode « figer puis tester » qui a produit tous les verdicts AXIS n'existe que dans des scripts de 800 à 2 300 lignes (MNT-6) : l'opérateur ne peut pas l'appliquer à ses idées.

**Proposition retenue après vérification.** Scinder en deux. 15a, « Essais sur les mêmes données » (S à M) : sous le PnL, « 14e variante sur BTCUSDT 4h, fenêtres chevauchantes à plus de 50 %, dont 9 de la même famille (mêmes indicateurs, paramètres ou seuils différents) ». Le décompte se fait par signatures distinctes, dans un compteur compact persistant indépendant de l'archive plafonnée à 50. Dès 5 essais, afficher le niveau que le meilleur de N atteindrait par hasard, calculé sur la statistique t de l'expectancy par trade ou sur le Sharpe une fois BT-3 corrigé, avec la mention « runs BT seulement ». 15b, « Figer une version » (M) : le figeage ajoute à une version existante une date et des critères déclarés d'avance (n minimal, expectancy nette positive à ×1 et ×3, et le timing quand IDEE-10 existe). « Mesurer depuis le figeage » rejoue la version sur les seules bougies clôturées après la date, avec amorce (debutEvaluationMs, BT-1). Verdicts : en cours (n/N, délai estimé), tenu, recalé. Toute modification crée une nouvelle version. Le mode panier d'IDEE-16 peut ensuite accélérer l'accumulation de trades.

**Proposition initiale.** (1) Sous le PnL : « 14e variante essayée sur BTCUSDT 4h, même fenêtre (dont 9 de la même famille de règles) ». Dès 5 essais, le niveau que le meilleur de N runs atteindrait sans avantage (Sharpe maximal attendu au hasard, ou permutation via IDEE-10) ; un compteur léger continue au-delà de 50 runs. (2) Un bouton « Figer » sur une version enregistre la date, la signature et des critères déclarés à l'avance (nombre minimal de trades, expectancy nette positive à x1 et x3, p de timing ≤ 0,05), non modifiables. « Mesurer depuis le figeage » rejoue la version sur les seules bougies clôturées postérieures, avec amorce. Verdict : en cours (n/N), tenu, recalé. Toute modification change la signature et repart de zéro. La liste des versions figées sert de tableau de dégradation des idées de l'opérateur, à côté d'AXIS (IDEE-9).

**Réutilise.** backtestHistoryStore (runs, versions, creeMs), signatureRun et copierConfigRun (store/backtestSignature.ts), comparerArchives (data/backtestArchive.ts), runBacktest avec debutEvaluationMs, accumulerKlines, modules d'IDEE-9 et IDEE-10, miroiterTravailPersonnel.

**À créer.** Fonction pure essaisSurMemesDonnees(runs, run), notion de famille de règles et seuil associé, compteur persistant léger. Champ facultatif figeage sur VersionConfigBacktest (décodeur, migration). Fonction pure jugerApresFigeage(stats, criteres). Mode « depuis une date » dans run(). Interface dans BacktestHistory. Tests : signature verrouillée, aucune bougie antérieure hors amorce, compteur exact.

**Données.** Locales (historique BT) et bougies Binance déjà utilisées.

**Ce qui existe déjà.** Les informations sont là mais rien ne les exploite. Runs archivés avec signature, bornes et stats (store/backtest.ts:953-962, data/backtestArchive.ts:10-23). Versions datées via sauverVersion (store/backtestHistory.ts:126-140). Comparaison de deux runs avec avertissements (data/backtestArchive.ts:130-154). Lecture walk-forward d'un run en deux moitiés (packages/backtest/src/walkForward.ts). Aucun compteur d'essais, Sharpe dégonflé ou figeage : grep sur-ajust/deflated/essais vide dans apps/web/src et packages. Aucun test de timing ni p binomial dans l'application (grep testTiming/pBinomiale vide : c'est IDEE-10).

**Contrat.** Ligne et section dans BT : exception G100. Données locales et klines Binance déjà utilisées, rien de nouveau. Prérequis : BT-1, BT-2 et BT-3. Sans BT-3, le Sharpe affiché est gonflé par l'annualisation sur l'étendue des trades (22,1 contre 4,9 dans l'exemple de la revue), et tout seuil « meilleur de N » calculé dessus serait faux. Le critère « p de timing ≤ 0,05 » attend IDEE-10. Schéma : champ facultatif sur VersionConfigBacktest, avec decoderVersion à étendre (backtestArchive.ts:116-121).

**Risques.** Le compteur ne peut pas s'appuyer sur l'archive : ajouterRun REFUSE tout run au-delà de 50 au lieu d'évincer le plus ancien (store/backtestHistory.ts:109-111), donc rien n'est plus archivé ni compté ensuite. Il faut un compteur compact séparé (signature, symbole, intervalle, bornes, famille, statistique), persisté et miroité. Il ne compte que les runs BT terminés : les réglages essayés sur le graphe (InstanceParamsEditor), les runs annulés et les scripts n'y figurent pas, et il faut l'écrire. Les variantes d'une même famille sont très corrélées : la formule du Sharpe maximal attendu avec N brut est alors conservatrice, à dire aussi. Avec 3 à 12 trades par an (BT-6), il vaut mieux bâtir le seuil sur la statistique t de l'expectancy par trade, ou sur le Sharpe corrigé par BT-3, que sur le Sharpe actuel. « Mesurer depuis le figeage » : AXIS 4h sur un seul actif ne donne un verdict qu'après des années, il faut donc afficher le délai estimé pour atteindre N trades. Le mode « depuis une date » sort des plages relatives (backtestArchive.ts:58) : la plage doit rester hors de la signature de la version figée. Effort réel : deux chantiers M.

**Fichiers à toucher.**

- apps/web/src/data/essaisBacktest.ts (nouveau, pur) + test
- apps/web/src/data/backtestArchive.ts
- apps/web/src/store/backtestHistory.ts
- apps/web/src/store/backtest.ts
- apps/web/src/components/BacktestHistory.tsx
- apps/web/src/components/BacktestWindow.tsx

**Mesure de succès.** Le compteur est exact sur un historique de test. Une version figée ne peut pas changer sans changer de signature (test), et la mesure d'après n'utilise aucune bougie antérieure hors amorce (test). L'opérateur voit qu'un Sharpe de 1,5 obtenu après 30 essais n'est pas un signal, et sait pour chaque idée figée si elle tient sur des données qu'il n'avait pas vues.

**Avis des juges.**

- valeur (4) : Le compteur d'essais rend visible le meilleur-de-N, principal piège d'un BT utilisé comme boucle de réglage. « Figer puis mesurer » met dans l'outil la méthode qui a produit le seul verdict fiable. C'est un vrai garde-fou contre l'auto-illusion, mais le verdict après figeage sera lent.
- cout-risque (2) : Ce sont deux chantiers M. Il faut un compteur persistant séparé de l'archive plafonnée, une formule « meilleur de N » qui dépend de BT-3, et un mode « depuis une date » hors des plages relatives. Les prérequis BT-1, BT-2 et BT-3 sont lourds.
- coherence (5) : Elle affiche le nombre d'essais faits sur les mêmes données et met la méthode « figer puis tester » à la portée de l'opérateur, sans passer par les scripts. Très alignée, mais ce sont deux chantiers M, qui recoupent IDEE-9.

### 9. IDEE-18 — Retour au poste : boîte de réception des alertes et encart « depuis votre passage »

**Score 15/20** · valeur 4 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : ALR-6, ERG-1, DEC-2

**Problème.** Le journal du panneau ne contient que ce que l'onglet a vu (store/alerts.ts:295-296), 100 entrées au plus (store/alerts.ts:30). Le daemon garde 30 jours (apps/daemon/src/alerts.ts:84-92), mais seul BRIEF › Session lit journalAlertesGet (components/brief/SectionSession.tsx:60), et il filtre depuis minuit local (data/brief.ts:284 et 317 ; SectionSession.tsx:68-75) : une alerte de 23 h, onglet fermé, est invisible à 8 h. Aucun état « lu » n'existe (SessionStrip.tsx:53-57 et 157 comptent les alertes actives), aucune notion de dernier passage non plus (grep derniereVisite / lastSeen vide), et les entrées du daemon n'ont pas de bouton « Dossier ». Le matin, l'opérateur ouvre ALRT, PAPER, EXPY, NEWS, ECO et DATA pour faire le tour.

**Proposition retenue après vérification.** Version resserrée, sans nouvelle section. (1) ALRT devient une boîte de réception. À l'ouverture du panneau, et au retour de visibilité au plus une fois par minute, il fusionne journalAlertesGet avec le journal local par fusionnerAlertesSession, sans borne « aujourd'hui » (limite : les 200 dernières du daemon). Il ajoute un état non lu (clé locale axiom:alertesLuJusqua:v1, miroitée par persist), « Tout marquer lu », un filtre par alerte, et « Dossier » sur les entrées du daemon (dossier partiel, sans preuve tant qu'IDEE-8 n'est pas fait). (2) SessionStrip affiche « Alertes 5 · 2 nouvelles ». Le clic ouvre ALRT. (3) BRIEF › Session : la borne devient max(minuit, dernier passage). Une bascule « depuis mon passage (hier 22:14) » s'affiche quand le dernier passage précède minuit, les lignes d'alerte deviennent cliquables (navigateTo avec markTime) et le titre de la section dit la période. Au retour après N heures, un toast « 3 alertes pendant votre absence » propose « Voir » et ouvre BRIEF. Pas de lignes PAPER, ni santé, ni Telegram tant qu'IDEE-19 et DMN-4 ne sont pas faits. Pas de route daemon nouvelle.

**Proposition initiale.** (1) Le journal du panneau devient une boîte de réception : il fusionne le journal du daemon sans la limite « aujourd'hui », marque non lues les entrées arrivées depuis le dernier passage, affiche « 3 nouvelles » dans le bandeau, propose « Tout marquer lu », un filtre par alerte et « Dossier » aussi pour les entrées du daemon (preuve complète grâce à IDEE-8). Le front signale la lecture au daemon, ce qui sert à l'escalade d'IDEE-21. (2) AXIOM note l'instant où l'opérateur quitte l'application. S'il revient après plus de N heures (4 h par défaut), un encart « Depuis votre passage (hier 22:14) » s'affiche en tête du BRIEF, avec un toast « Voir la reprise » : alertes (en distinguant celles notifiées seulement par Telegram ou macOS), exécutions PAPER, dossiers sans revue, news non lues, prochain évènement fort impact, sources en erreur et ligne de veille (IDEE-19). Chaque ligne ouvre la bonne cible (graphe avec marqueur, PAPER, EXPY, NEWS, ECO, DATA). La section Session propose « depuis mon passage » en plus de « depuis minuit ».

**Réutilise.** journalAlertesGet (data/daemon.ts:778), fusionnerAlertesSession et TOLERANCE_DEDUP_MS (components/brief/sessionAlertes.ts), creerDepuisJournal et creerDossierDepuisJournal (data/decisionDossier.ts:216), ExecutionPaper (data/paper.ts:66-77), decisionDossiersStore, newsStore.lus, chargerEvenementsEco et son cache, healthStore et degradedLevel, navigateTo avec markTime, pousserToast, écoute visibilitychange de runtime.ts, SessionStrip, BriefWindow.

**À créer.** Clé locale axiom:derniereActivite:v1 (visibilitychange, pagehide) et champ luJusqua. Route POST /alerts/lu dans le daemon. Fonction pure assemblerReprise(depuisMs, maintenant, …). components/brief/SectionReprise.tsx. Paramètre « depuis » pour alertesDeclencheesDuJour et tradesClosDuJour. Compteur de non-lus. Réglage du seuil d'absence. Tests.

**Données.** Disponibles : journal du daemon (200 dernières entrées, 30 jours) et journal local ; ECO et NEWS lus depuis leur cache, sans appel fournisseur. Sans daemon, seul le journal front est lu.

**Ce qui existe déjà.** BRIEF › Session fusionne déjà le journal du daemon avec le journal local et dédoublonne à 60 s : components/brief/SectionSession.tsx:57-75 et sessionAlertes.ts:15-60. Les entrées du daemon y portent déjà la mention « pendant votre absence » (SectionSession.tsx:124-131), mais la fenêtre commence à minuit local (debutJourLocalMs) et les lignes ne sont pas cliquables. Le journal d'ALRT est local, plafonné à 100 entrées (store/alerts.ts:30 et 293-296), et ne lit jamais journalAlertesGet : seul SectionSession l'appelle (data/daemon.ts:778). « Dossier » n'existe que sur le journal local (AlertsPanel.tsx:1002-1005). DeclenchementEnrichi a une preuve facultative (decisionDossier.ts:43), donc un dossier partiel depuis une entrée du daemon est déjà possible. Un motif lu / non lu existe pour NEWS (store/news.ts:79-110 ; NewsWindow.tsx:235-276), rien pour les alertes. Aucune notion de dernier passage : grep derniereVisite, lastSeen et derniereActivite vide. BRIEF couvre déjà News (SectionNews), Éco (SectionEco) et variation 24 h (SectionChapeau, store/regime.ts:197).

**Contrat.** Aucun fournisseur, aucune fenêtre, aucune dépendance. Surface ajoutée à ALRT, BRIEF et au bandeau : exception G100 (BUILD-CONTRACT.md:71). La route POST /alerts/lu est inutile : le KV « persist » du daemon reçoit déjà les clés locales en double écriture (persist.ts:12-20). Plus fiable après MFN-1, car deux onglets se disputeraient luJusqua.

**Risques.** (a) L'encart « Depuis votre passage » refait en partie BRIEF (Session, News, Éco, Chapeau) : risque de doublon visuel et de maintenance. (b) PAPER ne tourne que dans le front (data/paper.ts, aucun moteur côté daemon) : onglet fermé, il n'y a aucune exécution à montrer. La ligne PAPER n'a de sens que si l'onglet est resté ouvert en arrière-plan. (c) « Sources en erreur pendant l'absence » est impossible sans historique de santé (le registre ne garde que l'état courant, store/health.ts:49-57). Cela dépend d'IDEE-19. (d) Le journal du daemon ne dit pas si Telegram est réellement parti (le champ notifie ne concerne que macOS, apps/daemon/src/alerts.ts:452-455 ; DMN-4). Distinguer « notifiée par Telegram » serait donc faux aujourd'hui. (e) L'escalade d'IDEE-21 est une dépendance croisée à ne pas embarquer ici. (f) Le seuil d'absence (4 h) et visibilitychange : un onglet masqué toute la journée compte comme une absence, c'est voulu, mais il faut le dire.

**Fichiers à toucher.**

- apps/web/src/store/alerts.ts (luJusqua, fusion du journal daemon à l'ouverture d'ALRT)
- apps/web/src/components/AlertsPanel.tsx (non lues, Tout marquer lu, Dossier sur les entrées daemon, filtre par alerte)
- apps/web/src/components/SessionStrip.tsx (compteur « N nouvelles »)
- apps/web/src/components/brief/sessionAlertes.ts et son test (borne « depuis »)
- apps/web/src/components/brief/SectionSession.tsx (bascule « depuis minuit / depuis mon passage », lignes cliquables)
- apps/web/src/data/brief.ts (paramètre depuis pour alertesDeclencheesDuJour et tradesClosDuJour)
- apps/web/src/store/persist.ts (clé derniereActivite gérée, donc miroitée au daemon sans route nouvelle)
- apps/web/src/data/daemon.ts

**Mesure de succès.** Test : alerte du daemon à 23 h, retour à 8 h → présente et non lue (absente avec la règle « depuis minuit ») ; doublon front/daemon à moins de 60 s fusionné. E2E : après une absence simulée de 10 h, l'encart s'affiche et chaque lien ouvre la bonne cible. À l'usage : moins de fenêtres ouvertes seulement pour faire le tour.

**Avis des juges.**

- valeur (4) : Le tour du matin entre six fenêtres devient une boîte de réception, et une alerte de 23 h n'est plus invisible à 8 h dans BRIEF. Le gain de temps est quotidien. Telegram couvre déjà une partie du risque d'oubli.
- cout-risque (3) : Il n'y a pas de calcul financier, mais il faut un état non lu persistant disputé entre deux onglets avant MFN-1, la borne de la section Session du BRIEF à changer, et un toast. C'est un M honnête, avec un risque de doublon avec le BRIEF.
- coherence (4) : Elle réutilise le journal du daemon et fusionnerAlertesSession, sans route nouvelle, et raccourcit le tour du matin. La surface ajoutée est modeste ; il faut attendre MFN-1.

### 10. IDEE-19 — Bilan de veille : prouver que la surveillance était vivante pendant l'absence

**Score 15/20** · valeur 4 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : TRA-6, ALR-5

**Problème.** Le registre santé ne garde que l'état courant et la dernière erreur (store/health.ts:49-57 ; DataWindow.tsx:115-120) : une coupure de 20 min à 03:00 disparaît dès que le flux reparle. Le flux du daemon qui évalue les alertes ne remonte aucun état (apps/daemon/src/marketFeed.ts:28-29), et /health n'expose que liquidations, baleines, globe et HL (apps/daemon/src/index.ts:76-88). Les pannes possibles sont silencieuses (DMN-1, DMN-2, DMN-5, SECL-2), et une alerte peut n'être surveillée par personne (IDEE-17). Loin du poste, rien ne distingue « rien ne s'est passé » de « plus rien ne surveille ».

**Proposition retenue après vérification.** Centrer sur le daemon, qui est le seul témoin de l'absence. (1, S) santeMarketFeed() sur le modèle de santeLiqFeed : symboles suivis, connecté depuis, dernière bougie reçue, coupures des 24 dernières heures (début, durée), dernier poll funding réussi. Exposée dans /health > collecteurs.alertes. (2, S) Marque de vie persistée chaque minute. Au démarrage, l'écart avec la dernière marque est enregistré comme « daemon arrêté » (rend DMN-1 visible). (3, S) Statut Telegram : dernier envoi réussi, dernier refus avec code HTTP (après DMN-4). (4, S) Fonction pure composerBilanVeille(journal, defs, santé, vie, telegram, maintenant), servie par GET /alerts/veille et affichée en une ligne « Veille » dans BRIEF › Session : « daemon actif depuis 22:10 · flux coupé 2 fois (3 et 19 min) · 1 alerte non couverte (IDEE-17) · Telegram OK à 06:12 ». Sur Vercel : « aucune veille onglet fermé ». (5, option désactivée par défaut) Bilan Telegram quotidien à TELEGRAM_BILAN_HEURE. Côté front, seulement un compteur de coupures « depuis l'ouverture de l'onglet » dans DATA, sans pourcentage de disponibilité.

**Proposition initiale.** (1) Front : le registre santé garde 24 h de changements d'état ; DATA affiche par source « 24 h : 2 coupures (03:12–03:31, 19 min) · disponible 98,7 % ». (2) Daemon : le flux des alertes expose son état dans /health > collecteurs.alertes (symboles suivis, WebSocket connectée depuis quand, dernière bougie reçue, coupures et trous, dernier relevé du funding). (3) Une ligne « Veille » dans BRIEF › Session et dans l'encart d'IDEE-18 : « daemon actif 22:10→07:45 · flux coupé 2 fois (3 et 19 min) · 1 alerte non couverte · Telegram OK ». (4) En option, désactivé par défaut, un court message Telegram quotidien à l'heure choisie : déclenchements des 24 h, alertes actives par couverture, santé des flux, échecs Telegram. Ne pas le recevoir devient l'alarme. Le même bilan est lisible par une route GET locale.

**Réutilise.** store/health.ts (setEtat et marquerErreur, point de passage unique), data/dataCockpit.ts (formatFraicheur), DataWindow.tsx, modèle santeLiqFeed (apps/daemon/src/liqFeed.ts:239) et santeWhales, data/daemon.ts (sonde /health, parseSanteCollecteurs), heartbeat (alerts/runtime.ts:982-1033), table alertes_journal, lireDefsKv, couvertureAlerte (IDEE-17), envoyerTelegram (notify.ts), creerReveilEcheance, SectionSession.

**À créer.** Mémoire bornée des changements d'état et résumé pur côté front. santeMarketFeed() dans le daemon. Fonction pure composerBilanVeille(db, defs, sante, maintenant) et minuteur quotidien. Variable non secrète TELEGRAM_BILAN_HEURE. Route GET du bilan. Ligne Veille. Tests avec horloge injectée.

**Données.** Changements d'état à collecter en mémoire, sans nouvelle source ; le reste est déjà en SQLite et dans l'état du daemon.

**Ce qui existe déjà.** Le registre santé du front ne garde que l'état courant et la dernière erreur : apps/web/src/store/health.ts:49-57 ; DataWindow.tsx:115-118 affiche « Dernière erreur enregistrée ». /health du daemon expose liquidations, baleines, globe et hlHeat, rien pour le flux des alertes : apps/daemon/src/index.ts:84-86. Le commentaire de marketFeed.ts:27-29 le dit (« aucune remontée d'état »). Le motif à recopier existe : santeLiqFeed (liqFeed.ts:233-245), lu côté front par parseSanteCollecteurs et collecteurLiqMuet (data/daemon.ts:104 et 166). Le résultat de Telegram est ignoré : notifierTelegram fait `void envoyer(...)` (notify.ts:162-167), et envoyerTelegram rend res.ok sans que personne le lise (DMN-4, SECL-2). uptime est déjà exposé dans /health (index.ts:80). Aucun bilan quotidien et aucune trace de vie persistée dans le daemon : grep bilan, digest et alive vide. La seule boucle quotidienne est celle des snapshots KV (index.ts:158).

**Contrat.** Aucun fournisseur. Telegram est déjà le canal du daemon. Le bilan quotidien doit être désactivé par défaut, avec une variable non secrète dans apps/web/.env. Sur Vercel (sans daemon), la ligne Veille doit dire « aucune veille onglet fermé » : pas de pane muet, règle PARTIAL/UNUSABLE. Ligne ajoutée à BRIEF et à DATA : exception G100. Revue indépendante (daemon). Prérequis : DMN-1 (sinon le daemon meurt sans laisser de trace) et DMN-4 (sinon « Telegram OK » est faux).

**Risques.** (a) Sans trace persistée, on ne peut pas mesurer l'arrêt du daemon lui-même. Seule une marque de vie écrite toutes les minutes (KV ou petite table), comparée au démarrage, donne « daemon arrêté de 02:10 à 07:45 ». Sinon « daemon actif 22:10→07:45 » n'est que l'uptime. (b) Côté front, un pourcentage de disponibilité est trompeur. « closed » est un désabonnement volontaire (changement de symbole), les sources apparaissent et disparaissent, et l'onglet ne voit rien quand il est fermé. Compter seulement les coupures (error, stale ou reconnecting de plus de N s) et préciser « depuis l'ouverture de l'onglet ». (c) Le registre est écrit à chaque message (marquerMessage) : l'historique ne doit enregistrer qu'un changement d'état réel (prev.etat ≠ etat) et rester borné. (d) Recoupe IDEE-17 (couverture) et IDEE-18 (encart) : garder une seule fonction pure du bilan, servie par la route et lue par BRIEF. (e) « Ne pas le recevoir devient l'alarme » ne marche que si l'opérateur s'y habitue : c'est une option, pas une garantie.

**Fichiers à toucher.**

- apps/daemon/src/marketFeed.ts (santeMarketFeed : symboles, connexion, dernière bougie, coupures)
- apps/daemon/src/wsLoop.ts (crochet de fermeture si onOpen ne suffit pas)
- apps/daemon/src/notify.ts (mémoriser le dernier succès ou échec de Telegram, prérequis DMN-4)
- apps/daemon/src/veille.ts (nouveau : composerBilanVeille pur, trace de vie, minuteur quotidien) et veille.test.ts
- apps/daemon/src/index.ts (/health > collecteurs.alertes, route GET du bilan)
- apps/web/src/data/daemon.ts (lecture de la santé des alertes et du bilan)
- apps/web/src/components/brief/SectionSession.tsx (ligne Veille)
- apps/web/src/store/health.ts et apps/web/src/components/DataWindow.tsx (option : coupures depuis l'ouverture de l'onglet)

**Mesure de succès.** Test daemon : WebSocket fermée 3 min → coupure listée dans /health. Le bilan se compose depuis une base :memory: et un état injecté. Une coupure volontaire du flux apparaît dans le bilan suivant. La ligne Veille concorde avec logs/daemon.log.

**Avis des juges.**

- valeur (4) : Quand on compte sur le daemon la nuit (alertes de stop, AXIS), distinguer « rien ne s'est passé » de « plus rien ne surveillait » est essentiel à la confiance. Cela rend visibles les pannes silencieuses. L'idée vaut surtout combinée à IDEE-17 et IDEE-1.
- cout-risque (3) : Ce sont des pièces S, côté daemon surtout (marque de vie, santeMarketFeed, route), avec une fonction pure de bilan testable. Elles dépendent de DMN-1 et DMN-4, sinon le bilan affiche un faux « OK ».
- coherence (4) : Très alignée avec « ne pas décrocher » et l'honnêteté sur la surveillance. Elle recoupe IDEE-17 et IDEE-18 et dépend de DMN-1 et DMN-4 : il faut une seule fonction de bilan pour les trois.

### 11. IDEE-29 — Ligne de commande composable : actif, unité, fonctions et alerte en une saisie

**Score 15/20** · valeur 3 · coût-risque 4 · cohérence 5 · effort révisé **M** (initial S) · existe déjà : partiellement · origines : ERG-2

**Problème.** La palette ne traite qu'une intention à la fois : parseNavigation garde le premier mot comme actif et ignore les suivants (commands/registry.ts:182). « ETH 4H DOM FUNDX » change seulement la paire ; il faut rouvrir ⌘K pour DOM puis pour FUNDX, alors que ces fenêtres suivent l'actif du graphe maître. Pour créer une alerte de prix, il faut le clic droit (chart/priceAlertMenu.ts:2-8) ou le formulaire, car la commande ALRT ne fait que défiler jusqu'au panneau (commands/registry.ts:516-523).

**Proposition retenue après vérification.** Saisie composée dans ⌘K, limitée aux 39 mnémoniques de WINDOW_REGISTRY. Un mot qui est exactement un mnémonique est toujours une fonction. Le premier autre mot est l'actif, l'unité est reconnue comme aujourd'hui, et tout autre mot est affiché « ignoré : X ». « ETH 4H DOM FUNDX » change la paire et l'unité, puis OUVRE DOM et FUNDX (openWindow, jamais une bascule). L'aperçu précise quelles fenêtres suivent un groupe de couleur plutôt que le graphe maître. Le toast « Annuler » restaure la paire et l'unité et referme les fenêtres ouvertes par la commande. Sans « + » de mosaïque : WTILE existe déjà. « ALRT <niveau> » accepte « 65000 », « 65 000 » et « 0,35 » ; le niveau est arrondi par arrondirNiveauAlerte. Le sens est hausse si le niveau est au-dessus de la dernière clôture, baisse s'il est en dessous ; la commande est refusée sans prix connu. L'alerte se crée sur le symbole et la source du graphe maître, avec un toast « Annuler » qui la supprime. Tests sur le registre réel : « ETH 4H DOM FUNDX » donne ETHUSDT en 4h et deux ouvertures, même si DOM était déjà ouvert ; « ALRT 65 000 » sous le prix donne une baisse, au-dessus une hausse ; un mot inconnu est signalé.

**Proposition initiale.** Une grammaire courte, sur le modèle Bloomberg <ticker> <fonction> <GO>. « ETH 4H DOM FUNDX » change la paire et l'unité puis ouvre DOM et FUNDX ; avec un « + » final, les fenêtres sont rangées en mosaïque. « ALRT 65000 » crée une alerte de prix sur l'actif affiché, le sens venant du prix courant. L'aperçu dit exactement ce qui va se passer et signale les mots non reconnus (« ignoré : XYZ ») ; un toast « Annuler » suit, comme pour un changement de paire. Ni ordre ni script.

**Réutilise.** parseNavigation, construireItemsRecherche et appliquerNavigation (commands/registry.ts, components/CommandPalette.tsx), WINDOW_REGISTRY et ses mnémoniques, windowManagerStore.openWindow et tileOpenWindows, alertePrixAuNiveau et arrondirNiveauAlerte (store/alerts.ts:48-76), pousserToast avec action Annuler.

**À créer.** parseNavigation qui renvoie les mots restants. Fonction pure resoudreFonctions(mots) qui ne reconnaît que les mnémoniques exacts du registre. Commande synthétique « composée » et variante ALRT <niveau>. Tests sur le registre réel (aucune collision, aperçu exact).

**Données.** Aucune.

**Ce qui existe déjà.** La palette comprend déjà l'actif, l'unité et la source dans n'importe quel ordre, mais elle ignore les mots suivants (apps/web/src/commands/registry.ts:166-190, voir 182-184). La roadmap prévoyait « SOL 4H RSI » ; seuls l'actif et l'unité ont été livrés (docs/research/03-roadmap-bloomberg-perso.md:39). Chaque fenêtre s'ouvre par sa propre commande, et ces commandes sont des BASCULES (windowPanels.ts:21-23). WTILE existe déjà (windowPanels.ts:643-651). Côté alertes de prix, il existe le clic droit (chart/priceAlertMenu.ts:153-162) et le ±2 % du screener (ScreenerWindow.tsx:245-250). ALRT ne fait que défiler jusqu'au panneau (registry.ts:515-523). Aujourd'hui, « ALRT 65000 » propose même « Changer la paire → ALRT », car parseNavigation prend ALRT pour un symbole.

**Contrat.** Aucune fenêtre, aucun fournisseur, aucune dépendance. Ce n'est pas une surface nouvelle au sens du G100 : la palette existe déjà. Pas de recoupement avec UX-9.

**Risques.** (1) Les commandes de fenêtre basculent : si on les réutilise, un DOM déjà ouvert se FERME. Il faut appeler windowManagerStore.openWindow, jamais toggleWindow. (2) Toutes les fenêtres ne suivent pas le graphe maître. Celles qui sont liées à un groupe de couleur (DES, VOL, SEAG, EVTS, PAPER : DerivativesWindow.tsx:210, VolWindow.tsx:377) affichent le symbole du groupe ; l'aperçu doit le dire. DOM et FUNDX suivent bien marketStore (DomWindow.tsx:608, FundingMatrixWindow.tsx:70). (3) tileOpenWindows range TOUTES les fenêtres ouvertes, pas seulement les nouvelles (windowManager.ts:890-905) : le « + » a donc le même effet que WTILE et l'aperçu doit le dire. (4) La saisie est découpée sur les espaces : « ALRT 65 000 » donnerait 65 puis 000, et « 0,35 » utilise une virgule. Il faut recoller les jetons numériques qui suivent ALRT et accepter la virgule décimale. (5) Le sens de l'alerte se déduit de la dernière clôture de marketStore : hausse si le niveau est au-dessus, baisse s'il est en dessous. Sans prix ou à égalité, on refuse. La mesure de succès « saisi sous le prix → hausse » est ambiguë. (6) Pour annuler l'alerte, il faut connaître son id, or alertsStore.ajouter renvoie un booléen (alerts.ts:218-238) : il faudra comparer les defs avant et après, ou faire renvoyer l'id. (7) Un mnémonique peut aussi être un ticker (FUND, CORR, DATA…). La règle doit dire qu'un mnémonique exact reste toujours une fonction, ce qui est déjà le cas dans la palette (devraitAvoirNavProeminent, CommandPalette.tsx:59-80) ; le test d'unicité des mnémoniques existe déjà.

**Fichiers à toucher.**

- apps/web/src/commands/registry.ts
- apps/web/src/components/CommandPalette.tsx
- apps/web/src/commands/registry.test.ts
- apps/web/src/components/CommandPalette.test.ts
- apps/web/src/store/alerts.ts

**Mesure de succès.** Tests : « ETH 4H DOM FUNDX » → ETH 4h et deux fenêtres ouvertes ; « ALRT 65000 » saisi sous le prix → sens hausse ; un mot inconnu est signalé. À l'usage : une ouverture de ⌘K par changement de contexte au lieu de trois.

**Avis des juges.**

- valeur (3) : « ETH 4H DOM FUNDX » et « ALRT 65000 » font gagner quelques secondes plusieurs fois par jour à un utilisateur expert. C'est un vrai gain de fluidité, mais il ne change pas les décisions.
- cout-risque (4) : parseNavigation est pur et court (registry.ts:166-191), et le toast « Annuler » existe déjà dans appliquerNavigation. Il faut un parseur testé, openWindow au lieu de toggle, et recoller les nombres qui suivent ALRT. Aucun calcul financier.
- coherence (5) : Elle réalise la promesse d'origine de la roadmap (1.1, parsing « SOL 4H RSI ») dans la palette existante, sans surface nouvelle. C'est l'identité « command line Bloomberg » au sens propre.

### 12. IDEE-2 — Budget de risque : profil unique, risque ouvert au stop et garde-fous de session

**Score 14/20** · valeur 4 · coût-risque 2 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : RSK-1, RSK-4

**Problème.** Trois règles de risque coexistent sans lien : 1 % dans les Réglages pour l'outil position (store/risque.ts:20), 2 % codé en dur dans PACTE (data/paper.ts:392 ; le paramètre seuilRisqueMaxPct existe l.361 mais PaperWindow ne le passe pas, l.197-206), et BT qui ne recopie les Réglages que sur demande (BacktestWindow.tsx:1483). Le « Verrou PACTE » est un useState(false) (PaperWindow.tsx:142), donc désarmé à chaque réouverture. Il n'existe ni perte maximale du jour ni pause après une série de pertes (grep « perte max », « daily loss », « tilt » : rien hors PACTE). PORT affiche l'exposition notionnelle (PortfolioWindow.tsx:302) et une VaR (SectionRisque.tsx:37), jamais « combien je perds si tous mes stops sont touchés ». Le capital saisi ne sert qu'à l'outil position (store/risque.ts:4).

**Proposition retenue après vérification.** Profil de risque unique dans les Réglages : risque cible par trade (l'outil position le lit déjà), plafond par trade transmis à PACTE via seuilRisqueMaxPct, perte maximale du jour PAPER (en % de l'équity PAPER ou en R, frais d'entrée compris), nombre maximal de pertes consécutives PAPER, verrou PACTE persisté et actif par défaut. PAPER refuse les nouvelles ouvertures quand une limite est atteinte, jusqu'au lendemain local ; les clôtures restent permises. La levée exige une raison, horodatée et gardée. Risque ouvert au stop, frais compris, calculé séparément : PAPER rapporté à l'équity PAPER, affiché dans PAPER ; PORT rapporté au capital réel, affiché dans PORT et dans le bandeau, à titre informatif seulement, et une fois IDEE-1 livrée. Une position sans stop est comptée « non bornée », jamais zéro. Ni liquidation ni levier ; BT garde son bouton « Reprendre RISQUE ».

**Proposition initiale.** La section Risque des Réglages devient un profil unique : risque par trade, plafond de risque ouvert, perte maximale du jour (en % ou en R), nombre maximal de pertes consécutives, verrou PACTE actif par défaut. L'outil position, PACTE (via seuilRisqueMaxPct) et BT lisent ce même profil. Le « risque ouvert » additionne les pertes aux stops, frais compris, des positions PORT (IDEE-1) et PAPER, en $ et en % du capital. Une position sans stop est marquée « non bornée » et n'est jamais comptée zéro. Le total s'affiche dans PORT et dans le bandeau (« Risque ouvert 3,2 % · reste 180 $ aujourd'hui », puis « STOP jour »). Si un levier est saisi, PORT affiche une liquidation estimée et prévient si le stop est au-delà. Quand la perte réalisée du jour (sans le latent, cf. PRT-6) ou la série de pertes atteint la limite, PAPER refuse les nouvelles ouvertures jusqu'au lendemain ; les clôtures restent permises. Lever le verrou exige une raison, gardée au journal. Pour le réel, AXIOM informe sans bloquer.

**Réutilise.** store/risque.ts (clé axiom:risque:v1, déjà dans les sauvegardes), RisqueSection de components/SettingsPanel.tsx, evaluerDisciplinePacte (data/paper.ts), PaperWindow.tsx (pnlJour l.170-173, garde de placer l.240), store/portfolio.ts (pnlSessionDepuis, debutJourLocalMs, calculerExposition), store/paper.ts (positions et SL), components/SessionStrip.tsx (repaint impératif), chart/liquidationEstimates.ts:114-115, store/expy.ts (série de pertes).

**À créer.** Champs du profil avec validation. Fonctions pures testées risqueOuvert(positionsPort, positionsPaper, prix, capital) → {totalUsd, pctCapital, nonBornees} et etatGardeFous(executionsJour, tradesRecents, profil, maintenant) → {budgetRestant, serie, bloque, raison}. Verrou persisté et levée tracée. Cellule dans PORT et SessionStrip.

**Données.** Disponibles : exécutions PAPER, clôtures PORT du jour, trades EXPY, SL PAPER, prix live, capital.

**Ce qui existe déjà.** Risque par trade de 1 % pour l'outil position seulement (apps/web/src/store/risque.ts:20, consommateurs uniques chart/position.ts:116 et SettingsPanel.tsx:293-346). Seuil PACTE de 2 % codé en dur (apps/web/src/data/paper.ts:392) alors que le paramètre seuilRisqueMaxPct existe (l.361) et n'est pas transmis par PaperWindow.tsx:196-206. Verrou PACTE non persisté (PaperWindow.tsx:142). BT recopie déjà le profil à la demande avec le bouton « Reprendre RISQUE » (BacktestWindow.tsx:1479-1491). Aucune perte maximale du jour ni pause après une série de pertes (grep « perte max », « daily loss », « tilt », « pertesConsecutives » vides hors PACTE). PORT n'affiche que l'exposition notionnelle (PortfolioWindow.tsx:296-308) et la VaR (SectionRisque.tsx). La clé axiom:risque:v1 entre bien dans l'export JSON axiom:* (store/persist.ts:846-860), mais pas dans le miroir daemon (data/sauvegardeLocale.ts:6-11).

**Contrat.** Aucune fenêtre ni fournisseur, aucun ordre réel, PORT jamais bloqué : conforme. C'est une extension de surface (Réglages, PAPER, PORT, bandeau), donc une exception G100 est à demander. Faire lire à BT le profil vivant irait contre l'archive immuable de la configuration d'un run (BUILD-CONTRACT.md:601-602) : le bouton existant suffit. Prérequis : IDEE-1 (stop sur PORT) pour la partie réelle, PRT-6 (P&L jour du bandeau), PRT-7. BT-4 ne concerne que le levier, que cette version abandonne.

**Risques.** 1) Calcul faux tel que proposé : additionner le risque PORT et le risque PAPER en % d'un seul capital mélange de l'argent réel et une équity fictive de 100 000 $ (store/paper.ts:45). Il faut deux budgets séparés : PORT rapporté au capital du profil, PAPER rapporté à l'équity PAPER. 2) La liquidation estimée exige un champ levier qui n'existe ni dans PORT ni dans PAPER (grep vide). La formule de liquidationEstimates.ts:114-115 (entrée·(1−1/L)) ignore la marge de maintenance et le mode cross : elle donnerait une précision trompeuse, à abandonner. 3) La perte réalisée du jour en PAPER (PaperWindow.tsx:170-173) somme exec.pnlUsd, qui exclut les frais d'entrée débités à l'ouverture (data/paper.ts:10-11). Le garde-fou doit les ajouter. 4) Le « risque par trade » (cible, 1 %) et le seuil PACTE (plafond, 2 %) n'ont pas le même sens. Les fusionner en une seule valeur ferait échouer un trade dimensionné pile à 1 % à cause des arrondis. Il faut deux champs : cible et plafond. 5) Verrou actif par défaut : changement de comportement visible à annoncer. 6) Le changement de jour se cale sur minuit local (debutJourLocalMs) : à tester autour de minuit et au changement d'heure.

**Fichiers à toucher.**

- apps/web/src/store/risque.ts
- apps/web/src/components/SettingsPanel.tsx
- apps/web/src/data/gardeFous.ts (nouveau, pur : risqueOuvert, etatGardeFous) + test
- apps/web/src/components/PaperWindow.tsx
- apps/web/src/store/paper.ts (verrou et levée persistés, ou petit store dédié)
- apps/web/src/components/PortfolioWindow.tsx
- apps/web/src/components/SessionStrip.tsx

**Mesure de succès.** Tests : le total égale la somme des pertes aux stops, frais compris ; une position sans stop est « non bornée » ; avec 3 pertes maximum, l'ordre après la 3e est refusé mais une clôture passe ; le jour suivant débloque ; le verrou survit au rechargement. Le même risque % se lit dans l'outil position, dans PACTE et dans BT.

**Avis des juges.**

- valeur (4) : « Combien je perds si tous mes stops sont touchés » est un chiffre clé pour décider, et une position sans stop comptée « non bornée » évite une illusion. Les garde-fous de session ne valent que pour PAPER, ce qui limite la portée sur l'argent réel.
- cout-risque (2) : Effort M réel, mais le risque de calcul est fort : bascule de jour local, frais d'entrée absents de pnlUsd, deux budgets à ne pas additionner. Le verrou actif par défaut change un comportement visible, et le volet réel dépend d'IDEE-1.
- coherence (4) : Elle réunit trois règles de risque aujourd'hui incohérentes, ce qui réduit la dispersion, et laisse PORT purement informatif, avec deux budgets séparés. Le verrou PACTE actif par défaut et les blocages de PAPER changent le comportement : le propriétaire doit les valider.

### 13. IDEE-5 — PAPER enregistre la gestion du trade : MAE/MFE en R, cible initiale et motif de sortie dans EXPY

**Score 14/20** · valeur 3 · coût-risque 3 · cohérence 5 · effort révisé **M** (initial S) · existe déjà : partiellement · origines : DEC-6, RSK-9

**Problème.** EXPY reconnaît ne pas pouvoir juger la gestion : « MAE/MFE non mesurées : aucune trajectoire détenue archivée » (components/expy/ContexteResultats.tsx:41). La position PAPER ne garde ni cible initiale ni extrêmes de prix (data/paper.ts:50-63), et le motif de sortie n'arrive dans EXPY qu'en texte de note (data/paper.ts:343-345). Le moteur BT calcule pourtant MAE et MFE par trade (packages/backtest/src/engine.ts:312-340 ; types.ts:224-228), et le moteur PAPER voit chaque tick (store/paper.ts:255-271). L'opérateur ne sait donc pas si ses stops sont trop serrés ni s'il sort trop tôt.

**Proposition retenue après vérification.** PAPER enregistre la trajectoire détenue, et EXPY la lit en R comme des bornes. Pendant la détention, le moteur retient le plus haut et le plus bas des prix reçus. Il garde aussi la fréquence des prix (1 s pour Binance, 30 s ou 60 s par interrogation) et les trous (moteur arrêté, flux coupé). Ces valeurs vivent en mémoire et ne sont écrites qu'à intervalle limité. À la clôture (TP, SL ou manuelle), le trade EXPY reçoit des champs optionnels : maeR et mfeR calculés sur le stop initial (R indéfini si le R l'est, ou après un renfort dégénéré, PRT-3), tpInitial figé comme stopInitial, un motif de sortie typé (TP, SL initial, SL déplacé, manuelle, gap) et la qualité de la trajectoire (complète, bornes ou trouée). EXPY ajoute deux histogrammes avec dessinerHisto (MAE des gagnants, MFE des perdants). Il ajoute aussi deux phrases : le R moyen laissé sur la table par les gagnants (MFE moins R réalisé) et la part des gagnants dont la MAE n'a jamais dépassé −0,5 R. Chacune affiche n et l'avertissement « petit échantillon ». Pas de comparaison automatique au BT : elle viendra seulement avec un lien explicite vers un run (IDEE-13) qui utilise un stop en %. Compléter la trajectoire avec les bougies 1m à la clôture (BT-5) est une étape à part, soumise à la clause l.178 du contrat d'analyse.

**Proposition initiale.** Pendant la détention, le moteur PAPER retient le plus haut et le plus bas observés. À la clôture, EXPY reçoit la MAE et la MFE en R (calculées sur le stop initial), la cible initiale, le motif de sortie (TP, SL, manuelle, règle) et un drapeau « trajectoire partielle » si le moteur a été arrêté pendant la détention. EXPY ajoute deux histogrammes (MAE des gagnants, MFE des perdants) et deux phrases : « vous laissez en moyenne 1,1 R sur la table » (MFE moins R réalisé) et « 80 % de vos gagnants n'ont jamais dépassé −0,5 R ». Les deux se comparent aux MAE/MFE moyennes du BT de la même règle.

**Réutilise.** store/paper.ts (appliquerTick, persistance), data/paper.ts (PositionPaper, evaluerTickDetaille, tradeJournalDepuisCloture), data/expy.ts (TradeJournal, rMultiple, histogrammeR, BUCKETS_R), logique d'excursions de packages/backtest/src/engine.ts, components/ExpyWindow.tsx.

**À créer.** Champs optionnels prixMin, prixMax, tpInitial et dernierTickTs sur PositionPaper ; maeR, mfeR, tpInitial, motifSortie et trajectoirePartielle sur TradeJournal, avec validation tolérante. Persistance seulement quand un nouvel extrême apparaît. Deux histogrammes dans EXPY.

**Données.** Disponibles : ticks déjà reçus par le moteur PAPER. Limite : rien n'est observé application fermée ; le drapeau « partielle » le dit, et le rejeu des bougies 1m suggéré par BT-5 comblerait le trou.

**Ce qui existe déjà.** Le motif de sortie arrive déjà dans EXPY, mais seulement en texte dans la note : apps/web/src/data/paper.ts:343-345 (genre tp, sl ou cloture-manuelle, data/paper.ts:71). Les MAE/MFE n'existent que dans le BT, par trade et en % du prix : packages/backtest/src/engine.ts:305-340 (fonction excursions, non exportée) et types.ts:219-230. L'archive BT ne garde que des moyennes en % : types.ts:272-275 et apps/web/src/data/backtestArchive.ts:10-23. EXPY dit lui-même qu'il ne les mesure pas : components/expy/ContexteResultats.tsx:41. Aucune cible initiale n'est gardée : modifierTpSl écrase le TP (store/paper.ts:225-228). Pour les histogrammes, dessinerHisto est réutilisable tel quel (components/ExpyWindow.tsx:192).

**Contrat.** PAPER est hors gate (BUILD-CONTRACT.md:24 et 70). En revanche, les histogrammes et les phrases ajoutés à EXPY sont de la surface : il faut une exception G100, comme celle du 2026-09-14 pour les MAE/MFE du BT (BUILD-CONTRACT.md:71). Règle « aucun ancien trade réécrit » (BUILD-CONTRACT.md:566-567) : on ajoute seulement des champs optionnels, et seuls les nouveaux trades les reçoivent. Le contrat d'analyse dit : « MAE/MFE uniquement si la trajectoire réellement détenue a été enregistrée ; jamais reconstruites depuis le marché rechargé » (docs/superpowers/specs/2026-09-23-analyse-multidomaine-contrat.md:178). La version par ticks respecte cette règle. Combler les trous avec les bougies 1m (BT-5) demande en plus une décision du propriétaire, avec des valeurs figées à la clôture. Pas de fournisseur ni de dépendance nouvelle.

**Risques.** (1) Le tick n'arrive pas toutes les secondes partout. Binance pousse un prix par seconde (@ticker, data/ticker.ts:137). Kraken, Coinbase, MEXC, OKX, Bybit et Hyperliquid sont interrogés toutes les 30 s, Twelve Data toutes les 60 s (data/ticker.ts:40-42). Les MAE/MFE mesurées sont donc des bornes : l'écart réel peut être plus grand. Il faut les étiqueter comme dans le BT, avec la fréquence affichée. Le drapeau « partielle » doit aussi couvrir les coupures de flux, pas seulement l'application fermée. (2) Après un renfort, les extrêmes vus avant sont rapportés au prix moyen et au stop initial : la distance au stop peut devenir presque nulle et le R absurde (PRT-3). Dans ce cas, il faut un R indéfini. (3) Avec BT-5, un SL rempli à son niveau après un gap donne une MAE sous −1 R alors que le R réalisé vaut −1 : l'écran doit expliquer cet écart. (4) La comparaison automatique au BT « de la même règle » est impossible aujourd'hui : PAPER n'exécute aucune règle (seuls PaperWindow, DecisionDossiers, ScenWindow, rapport et paperLignes lisent paperStore). L'archive BT n'a que des moyennes en % du prix, et un stop ATR (store/backtestSignature.ts:31) empêche de les convertir en R. (5) Le motif « règle » n'existe pas. (6) Vérifié avec bun : à chaque tick d'un symbole actif, positions, ordres et exécutions changent de référence (data/paper.ts:249-289). store/paper.ts:275-285 réécrit donc déjà axiom:paper:v1 à chaque tick, contrairement au commentaire des lignes 273-274. Ajouter les extrêmes ne coûte rien aujourd'hui, mais coûtera dès que ce défaut sera corrigé : il faut prévoir de limiter les écritures. (7) Avec deux fenêtres ouvertes (MFN-2), chacune a ses propres extrêmes et la dernière qui écrit gagne.

**Fichiers à toucher.**

- apps/web/src/data/paper.ts
- apps/web/src/store/paper.ts
- apps/web/src/data/expy.ts
- apps/web/src/store/expy.ts
- apps/web/src/components/ExpyWindow.tsx
- apps/web/src/components/expy/ContexteResultats.tsx
- apps/web/src/data/paper.test.ts
- apps/web/src/store/paper.test.ts
- apps/web/src/data/expy.test.ts

**Mesure de succès.** Tests : MAE ≤ 0 ≤ MFE en R ; un renfort garde la référence au stop initial ; un trade sans stop a un R indéfini. Tous les trades PAPER clos ont une MAE et une MFE, ou le drapeau « partielle ». Après une vingtaine de trades, l'opérateur ajuste stop ou cible d'après le « R laissé » mesuré.

**Avis des juges.**

- valeur (3) : Savoir si ses stops sont trop serrés ou ses sorties trop précoces est une vraie question de gestion. Mais la mesure se limite à PAPER, les valeurs sont des bornes (sondage à 30 s hors Binance) et il faudra beaucoup de trades avant de conclure.
- cout-risque (3) : Ce sont des champs optionnels ajoutés sans réécrire l'existant, et le moteur voit déjà chaque tick. En revanche, il faut gérer les MAE/MFE en bornes selon la cadence, le R dégénéré après un renfort, les écritures à limiter et le cas de deux fenêtres ouvertes.
- coherence (5) : Le contrat d'analyse (l.178) prévoit ce cas mot pour mot : MAE/MFE seulement si la trajectoire réellement détenue a été enregistrée. Les valeurs sont étiquetées comme des bornes, les champs sont facultatifs et aucun ancien trade n'est réécrit. PAPER est hors gate.

### 14. IDEE-11 — Fiche de preuve par signal (statut, population testée) et AXIS en tête des menus

**Score 14/20** · valeur 3 · coût-risque 3 · cohérence 5 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : EDG-3, SIM-1

**Problème.** Les verdicts mesurés sont des textes écrits à la main et dispersés : stratAxis.ts:501 et 521, commentaire du preset BT (store/backtest.ts:511-527), README, sept rapports. Le seul statut structuré, validation?: "non-valide" (packages/types/src/index.ts:419), est binaire et ne dit rien de la population. 11 stratégies portent ce badge (StrategyMenu.tsx:295-300) ; les 21 autres n'ont rien, ce qui se lit « fiable », AXIS comprise. Dans le formulaire d'alerte, AXIS est la 162e entrée sur 163 d'une liste à plat (AlertsPanel.tsx:94 et 618). Un chiffre mesuré sur 4 grandes cryptos s'affiche pour n'importe quel symbole (IND-6), la fiabilité d'EQS porte sur la donnée et non sur le pouvoir prédictif (data/signaux.ts:20), et le formulaire d'alerte ne dit rien de ce qui a été mesuré.

**Proposition retenue après vérification.** Un registre compact de statut de preuve dans @axiom/indicators, sans toucher @axiom/types. Chaque stratégie y reçoit « Validée », « Recalée » ou « Non testée ». AXIS y a des couches séparées : signal v2 (4h, BTC/ETH/XRP/SOL spot Binance, 2017-2024), garde-fou v5 (alts KuCoin) et forts achats (BNB/ADA/LINK/DOGE), chacune avec le lien vers son rapport. Lecteurs : une section « Validée » en tête du menu Stratégies avec AXIS ; un badge « non testée » pour les 19 stratégies sans statut ; un groupe « Validée » en tête du sélecteur d'alerte, avec la sortie etat présélectionnée (IND-2). La couche web ajoute à l'infobulle AXIS un suffixe de couverture par couche selon le symbole affiché. Test : chaque stratégie a un statut, et seules les « Validée » peuvent porter « test réussi ». Les textes figés et les tests croisés restent en place.

**Proposition initiale.** Un registre typé de fiches : signal, unité, population (actifs, place, période), date de figeage, n, expectancy nette à x1 et x3, IC et p de timing (IDEE-10), statut (« Validée — 4h », « Recalée », « Non testée »), lien vers le rapport. Une fonction couverture(fiche, symbole, unité) répond « mesuré ici », « même unité, hors population » ou « non mesuré ». Lecteurs : infobulles AXIS ; menu Stratégies avec une section « Validée » en tête (AXIS 4h et lien vers la méthode) puis « Exploratoires » repliée ; opérandes BT et sélecteur d'alerte avec AXIS en tête ; badge de mesure dans l'inbox EQS, distinct de la fiabilité de la donnée ; formulaire d'alerte (« signal mesuré FAVORABLE en 4h sur BTC/ETH/XRP/SOL ; DOGEUSDT est hors population »). Rien n'est retiré. Un test structurel interdit toute étiquette « validé », « fiable » ou « mesuré » sans fiche, et toute stratégie sans statut.

**Réutilise.** textesUnite, RESERVE et UNITES (stratAxis.ts:501-640), JSON de résultats de scripts/axis, StrategyMenu.tsx (sectionsStrategies, badge l.295), IndicatorDef.validation, AlertsPanel.tsx (INDICATEURS_SEUIL), opérande axisEtat (store/backtest.ts:327-332), SignalDetecte (data/signaux.ts:22-38), MAJORS_VALIDATION (data/validationSignaux.ts:82), patron de test IndicatorMenu.sousGroupes.test.ts.

**À créer.** fichesMesure.ts dans @axiom/indicators (lisible sans dépendre du web). Générateur unique qui extrait les chiffres des JSON. Fonction couverture. Tri et sections dans StrategyMenu, AlertsPanel et les opérandes BT. Test structurel. Branchement des lecteurs.

**Données.** Déjà dans le dépôt : résultats figés et listes d'actifs des manifestes.

**Ce qui existe déjà.** Statut binaire validation?: "non-valide" (packages/types/src/index.ts:419), affiché en badge par StrategyMenu.tsx:295-302. Vérifié avec bun : 32 stratégies, dont 11 « non-valide » ; AXIS est à l'index 161 sur 163 dans INDICATEURS_SEUIL (AlertsPanel.tsx:94 et 618). L'infobulle AXIS nomme déjà la population et l'unité (stratAxis.ts:501-640). Ces textes sont figés et recoupés avec les JSON de résultats par apps/web/src/chart/indicators.axisUnites.test.ts et indicators.axisRegime.test.ts. AXIS est déjà accessible en un clic dans BT via le preset builtin:axis (store/backtest.ts:529). FiabiliteSignal d'EQS (data/signaux.ts:20) décrit la fiabilité de la donnée, pas le pouvoir prédictif. Il n'existe ni statut à trois états, ni couverture par symbole, ni AXIS en tête des listes.

**Contrat.** @axiom/types est figé : ne pas élargir validation, le registre vit dans @axiom/indicators (index.ts appartient à l'agent « engine »). CalcContext ne connaît pas le symbole (types l.361-374) : la couverture par symbole doit donc être ajoutée par la couche web, après la partie figée de l'infobulle, jamais dans le calcul. Les formulations figées restent dans stratAxis.ts ; seuls des suffixes s'ajoutent. Aucun générateur ne doit lire les JSON de résultats à l'exécution.

**Risques.** 1) La couverture dépend de la couche. Sur BTC en 4h, le signal v2 est mesuré, mais le garde-fou v5, actif par défaut, ne l'a été que sur des alts KuCoin, et les forts achats sur BNB, ADA, LINK et DOGE. Un verdict unique par fiche tromperait : l'exemple de l'idée (DOGE « hors population ») est faux pour la couche forts achats. 2) Le test structurel qui interdirait « fiable » et « mesuré » est trop large. « fiable » est une étiquette de donnée légitime (funding réglé, signaux.ts:163) et « mesuré » apparaît dans de nombreux textes de couverture : le test serait bruyant ou cassé. 3) Sortir toutes les chaînes de verdict de stratAxis.ts doublerait les tests croisés existants, pour un fort risque de casser des textes figés et un gain faible. 4) Aucun signal EQS n'a de mesure figée (le retournement AXIS n'a jamais été testé, IND-1) : le badge EQS serait vide.

**Fichiers à toucher.**

- packages/indicators/src/fichesMesure.ts (nouveau)
- packages/indicators/src/fichesMesure.test.ts
- packages/indicators/src/index.ts
- apps/web/src/components/StrategyMenu.tsx
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/chart/indicators.ts (suffixe de couverture de l'infobulle, côté web)
- apps/web/src/components/StrategyMenu.sections.test.ts (test structurel)

**Mesure de succès.** Plus aucune chaîne de verdict codée en dur hors du registre. L'infobulle AXIS sur une alt 4h non testée affiche « hors population ». AXIS est en premier dans le menu Stratégies, les opérandes BT et le sélecteur d'alerte ; une alerte AXIS se crée en trois choix. Le test structurel échoue si quelqu'un réintroduit « fiable » sans fiche.

**Avis des juges.**

- valeur (3) : Le registre évite que 19 stratégies sans badge passent pour fiables et remonte AXIS, aujourd'hui 162e de la liste d'alertes. C'est un étiquetage utile contre une erreur de lecture, sans nouvelle connaissance de l'edge.
- cout-risque (3) : Un registre statique n'a pas de calcul, mais il faut entretenir le statut par couche AXIS et ajouter le suffixe de couverture côté web. Le menu Stratégies et le sélecteur d'alerte changent tous les deux. Un mauvais libellé de couverture tromperait l'opérateur.
- coherence (5) : Elle rassemble des verdicts aujourd'hui dispersés, écrit « non testée » là où l'absence de badge se lit « fiable », et place la seule stratégie validée en tête, sans toucher @axiom/types. Elle renforce directement l'honnêteté sur les signaux.

### 15. IDEE-16 — Mode panier dans BT : la même règle sur plusieurs actifs

**Score 14/20** · valeur 4 · coût-risque 2 · cohérence 4 · effort révisé **L** (initial L) · existe déjà : non · origines : EDG-7

**Problème.** BT ne teste qu'un symbole à la fois : un seul appel runBacktest (workers/backtest.worker.ts:43) et aucune liste de symboles dans store/backtest.ts. Toute la méthode AXIS repose pourtant sur des paniers (4, 42, 123, 139 et 151 actifs) et sur la part d'actifs gagnants (README.md:229 : « Sharpe meilleur que sans garde-fou sur 75 % des actifs »). Un bon résultat sur un seul graphe ne dit rien de la robustesse. L'univers « Majors » existe déjà (data/validationSignaux.ts:82), et la validation EQS sait déjà parcourir la watchlist.

**Proposition retenue après vérification.** Option « Panier » dans BT : Watchlist ou liste saisie de 12 symboles au plus, ou Majors avec la mention fixe « univers d'aujourd'hui (survivants) ; 8 actifs déjà utilisés pour AXIS : relecture, pas validation ». Même stratégie, même plage, mêmes coûts, amorce comprise (BT-1). La référence de régime est chargée une fois. Le résultat montre un tableau par actif (trades, expectancy nette, cellules grisées quand n < 10, colonne « contre détention » quand BT-8 sera fait). Il donne aussi la part d'actifs à expectancy positive avec son p binomial, et une expectancy groupée avec IC par rééchantillonnage d'actifs. Le test de timing commun s'ajoute quand IDEE-10 existera. Le panier est archivé en UNE entrée. Cliquer une ligne relance le run détaillé existant sur ce symbole.

**Proposition initiale.** Une option « Panier » : Majors, Watchlist ou une liste saisie de 12 symboles au plus, avec la même stratégie, la même plage et les mêmes coûts. Le résultat montre un tableau par actif (trades, expectancy nette, PnL comparé à la détention selon BT-8), la part d'actifs à expectancy positive avec son p binomial, l'expectancy groupée avec un IC tiré par actif plutôt que par trade (les actifs partagent le même facteur de marché), et un test de timing commun (comme C3, via IDEE-10). Cliquer une ligne ouvre le run détaillé existant.

**Réutilise.** runBacktest et son worker, accumulerKlines avec le cache de bougies du daemon, MAJORS_VALIDATION et symbolesUnivers (data/validationSignaux.ts), mapPool (store/screener.ts:41), chargerRefCloseBacktest (référence BTC commune), pBinomiale et testTiming extraits par IDEE-10.

**À créer.** Orchestration du panier dans store/backtest (2 requêtes en parallèle, annulation). Agrégats purs : part gagnante, IC par actif, timing commun. Tableau dans l'interface. Tests des agrégats.

**Données.** Bougies Binance publiques : 12 actifs sur 2 ans en 4h font environ 50 requêtes de 1 000 bougies, sous les limites et mises en cache.

**Ce qui existe déjà.** BT teste un seul symbole : un seul appel à runBacktest (workers/backtest.worker.ts:43), sans aucune liste de symboles dans store/backtest.ts. Briques réutilisables : univers Majors et Watchlist de la validation EQS (data/validationSignaux.ts:72-98, utilisée par store/signaux.ts:399), mapPool (data/screenerRun.ts, réexporté par store/screener.ts:41), accumulerKlines avec le cache daemon (data/backtestData.ts), chargerRefCloseBacktest (store/backtest.ts:77, non exporté). Mesure locale : un run AXIS sur 6 000 bougies prend 15 à 50 ms, donc le calcul de 12 actifs est négligeable et seul le réseau compte.

**Contrat.** Nouveau mode dans BT : exception G100. Aucun fournisseur : klines spot Binance déjà utilisées. Réseau borné : avec l'amorce de BT-1, 12 actifs en 4h sur 2 ans font environ 6 pages chacun, soit à peu près 72 requêtes de poids 2, très loin de la limite de 6 000 par minute, et mises en cache. La référence BTC se charge une seule fois puis s'aligne par actif. Prérequis : BT-1, BT-2 (la bougie en formation du cache contaminerait 12 séries) et BT-8 pour la colonne « contre détention ». Le test de timing commun attend IDEE-10 et reste facultatif au départ.

**Risques.** Biais de sélection non signalé. « Majors » est une liste d'aujourd'hui, donc de survivants (data/validationSignaux.ts:82-85), et 8 de ses 10 actifs ont déjà servi à AXIS : BTC, ETH, XRP et SOL au développement v2, BNB, ADA, LINK et DOGE au test du 8 octobre (README.md:179). Sur Majors, un panier AXIS est donc une relecture, pas une validation, et il faut l'afficher. Archive : enregistrer 12 runs par panier saturerait le plafond de 50 en 4 paniers, puisque ajouterRun refuse au-delà (store/backtestHistory.ts:109-111). Il faut une seule entrée panier, avec une signature qui inclut la liste des symboles. L'IC par actif est juste en principe (facteur de marché commun), mais avec 10 à 12 actifs il reste large, et il faut le dire. Les tableaux par actif comptent 3 à 12 trades (BT-6) : à griser comme la tenue par moitié. Annulation et concurrence : deux requêtes en parallèle et un seul runId, pour ne pas mélanger deux paniers.

**Fichiers à toucher.**

- apps/web/src/data/panierBacktest.ts (nouveau, agrégats purs) + test
- apps/web/src/store/backtest.ts
- apps/web/src/store/backtestSignature.ts
- apps/web/src/workers/backtest.worker.ts
- apps/web/src/data/backtestArchive.ts
- apps/web/src/store/backtestHistory.ts
- apps/web/src/components/BacktestWindow.tsx

**Mesure de succès.** Sur les Majors, AXIS 4h donne en moins de 30 s la part d'actifs gagnants et une expectancy groupée avec IC. L'opérateur ne valide plus une règle sur un seul graphe.

**Avis des juges.**

- valeur (4) : Avec 3 à 12 trades par symbole, un BT mono-actif est presque du bruit. Le panier multiplie l'échantillon et mesure la robustesse entre actifs, cœur de la méthode AXIS. Le biais des survivants doit rester affiché comme prévu.
- cout-risque (2) : Le mode panier demande un nouveau format d'archive, un runId unique contre la concurrence, un IC par rééchantillonnage d'actifs et une charge réseau multipliée. C'est un L avec les prérequis BT-1, BT-2 et BT-8.
- coherence (4) : Elle reprend la méthode par paniers qui a fondé AXIS et dit honnêtement « survivants, relecture et non validation ». C'est cependant un nouveau mode de BT, d'effort L, qui ne vient qu'après BT-1 et BT-2.

### 16. IDEE-21 — Moins de bruit sans rien perdre : anti-rebond, niveau d'urgence, sourdine et heures calmes

**Score 14/20** · valeur 4 · coût-risque 2 · cohérence 4 · effort révisé **L** (initial M) · existe déjà : partiellement · origines : ALR-3, ERG-7, ALR-7

**Problème.** Le moteur ré-arme dès que la condition redevient fausse, sans marge ni délai (packages/alerts/src/engine.ts:306-311). Mesure en scratchpad (pingpong.ts) : un prix qui oscille de ±5 $ autour de 65 000 produit 300 déclenchements en 10 min, chacun avec notification et bip (alerts/runtime.ts:1058-1066), entrée dans un journal de 100 (store/alerts.ts:30) et message Telegram côté daemon (apps/daemon/src/alerts.ts:454-461), avec risque de refus 429. Toutes les alertes pèsent pareil : Telegram toujours avec son (notify.ts:129-133, disable_notification jamais utilisé), bip même pour les scans de presets toutes les 15 à 60 min (runtime.ts:31-36) ; AlertDef n'a aucune notion d'importance (packages/alerts/src/types.ts:218-245). Seule façon de faire taire une alerte : la pause, qui arrête aussi l'évaluation et le journal (engine.ts:46-49) et doit être levée à la main.

**Proposition retenue après vérification.** Deux lots M au lieu d'un. Lot 1, anti-rebond (moteur partagé) : une marge de ré-armement en % pour prix-croise (hausse, baisse ET les-deux, ce dernier traité dans evalPrixCroise en réutilisant le champ `arme`, aujourd'hui inutilisé) et pour variation-pct. Défaut de 0,2 % pour les NOUVELLES alertes prix ; les anciennes restent inchangées. Pas d'ATR. Délai minimal optionnel, sans valeur par défaut, appliqué à l'ENVOI et non au déclenchement : l'entrée reste au journal avec notifie=0. Chaque runtime lit sa propre dernière notification (front : declenchements ; daemon : MAX(ts) d'alertes_journal). Pas de mode « une seule fois » tant que le daemon ne sait pas recevoir un jeton de réarmement. Lot 2, niveaux et silence : un niveau par alerte, « Journal » (aucun envoi), « Poste » (navigateur ou macOS, sans Telegram) ou « Téléphone » (comportement actuel, par défaut). Les scans de presets passent en « Poste » sans bip. Une « Sourdine jusqu'à T » via un champ sourdineJusqua, lu par le daemon dans le KV des définitions et levé automatiquement. Des heures calmes (KV alerts/reglages) : Telegram avec disable_notification et pas de bip. Escalade « Critique » renvoyée à IDEE-18. Prérequis : DMN-4/SECL-2 et MFN-1. Mesures : sur la série de 10 min, 1 déclenchement en hausse comme en les-deux avec une marge de 0,2 %, contre 300 et 599 sans marge ; test daemon prouvant que le délai utilise son propre journal.

**Proposition initiale.** (1) Règle de ré-armement par alerte : marge (retour de X % ou de k×ATR de l'autre côté), délai minimal, ou « une seule fois » (bouton « Réarmer »). Défauts sobres pour les nouvelles alertes : 0,2 % et 15 min pour le prix, une bougie pour les conditions sur bougies ; les anciennes alertes gardent leur comportement. (2) Un niveau par alerte : « Journal » (rien ne sonne), « Poste » (navigateur ou macOS), « Téléphone » (comportement actuel, par défaut), « Critique » (passe les heures calmes, renvoyée une fois après 15 min si non lue, via IDEE-18). Les scans de presets sont proposés en « Journal ». (3) « Sourdine 1 h » ou « jusqu'à demain 8 h » : l'alerte reste évaluée et journalisée, ne notifie pas, et la sourdine se lève seule. (4) Heures calmes dans les Réglages : Telegram en silencieux et pas de bip, sauf « Critique ».

**Réutilise.** frontArme et etatCondition (engine.ts, partagé par le front et le daemon), AlertDef.declenchements, table alertes_etat, filtrerCooldown (store/presetAlerts.ts:255) comme précédent, ATR de @axiom/indicators, evaluerEtPersister et notifierTelegram (daemon), notifier et bip (front), miroir KV des définitions (store/alerts.ts:277-283, lireDefsKv), useExpirationClock, colonne notifie d'alertes_journal.

**À créer.** Champs optionnels reArmement, urgence et sourdineJusqua dans packages/alerts/src/types.ts (hors @axiom/types figé). Réglage heuresCalmes (KV alerts/reglages). Logique dans frontArme ; routage par canal dans les deux runtimes ; relance unique de l'escalade. Validation dans estAlertDefValide. Sélecteurs dans le formulaire, menu sourdine et bouton Réarmer sur la ligne. Tests.

**Données.** Aucune donnée nouvelle.

**Ce qui existe déjà.** Seuls existent : le cooldown de 6 h par (alerte, symbole) des alertes de preset (apps/web/src/store/presetAlerts.ts:255, apps/web/src/alerts/runtime.ts:121-122 et 678), la pause manuelle (store/alerts.ts:242-245, AlertsPanel.tsx:1031) et l'échéance expireTs (packages/alerts/src/engine.ts:40-49). Aucune marge de ré-armement, aucun niveau d'urgence, aucune sourdine, aucune heure calme : grep vide sur cooldown, sourdine, mute, quiet, disable_notification et urgence dans packages/alerts, apps/daemon/src et apps/web/src/alerts. Mesure refaite : 300 déclenchements en 10 min en sens « hausse » et 599 en sens « les-deux » (scratchpad/idees/verif-21-24/lesdeux.ts).

**Contrat.** Aucun fournisseur ni dépendance : disable_notification est un champ de sendMessage, déjà appelé dans notify.ts:129-133. AlertDef vit dans packages/alerts, hors de @axiom/types qui est figé. Le daemon est touché, donc revue indépendante obligatoire. Les champs et réglages ajoutés comptent comme surface au titre de G100 : demander une exception. Prérequis : DMN-4/SECL-2 (refus Telegram avalés) et MFN-1 (une fenêtre périmée réécrit axiom:alerts:v1 et le KV : une sourdine posée dans une fenêtre serait perdue).

**Risques.** (1) Le sens « les-deux » ne passe pas par frontArme (engine.ts:283-291) : c'est le cas le plus bruyant (599 déclenchements mesurés), et le menu clic droit le propose. Corriger seulement frontArme le laisse intact. (2) Le daemon garde son propre état `arme` dans alertes_etat et IGNORE celui du front (fusionnerEtatArme, apps/daemon/src/alerts.ts:138-145). Il jette aussi `declenchements`, puisque evaluerEtPersister ne persiste que `arme` (l.440-445). Un délai calculé sur AlertDef.declenchements serait donc faux côté daemon, et le bouton « Réarmer » du mode « une seule fois » ne réarmerait que le front. Il faut au daemon son propre horodatage du dernier envoi, par exemple MAX(ts) d'alertes_journal, et un jeton de réarmement. (3) La marge en k×ATR est infaisable sans nouvelle plomberie : les alertes prix sont évaluées sur le ticker, sans bougies, au front (runtime.ts:229-233) comme au daemon (alerts.ts:553). (4) L'escalade « Critique renvoyée si non lue » suppose une notion de lecture qui n'existe nulle part ; elle dépend d'IDEE-18. (5) Une marge empêche le moteur de déclencher : ces croisements n'arrivent donc pas au journal, contrairement à la mesure « sans déclenchement perdu ». Seul un délai appliqué à l'ENVOI garde le journal complet. (6) Un délai de 15 min par défaut peut masquer une vraie seconde cassure (faux départ puis vraie sortie). La marge seule suffit contre le ping-pong (prototype : 1 déclenchement pendant l'oscillation, puis 1 au vrai retour, dans scratchpad/idees/verif-21-24/marge.ts). (7) Moins de transitions veut dire moins de réécritures localStorage et KV, ce qui réduit aussi la pression de MFN-1.

**Fichiers à toucher.**

- packages/alerts/src/types.ts
- packages/alerts/src/engine.ts
- packages/alerts/src/engine.test.ts
- apps/web/src/store/alerts.ts
- apps/web/src/alerts/runtime.ts
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/components/SettingsPanel.tsx
- apps/daemon/src/alerts.ts
- apps/daemon/src/alerts.test.ts
- apps/daemon/src/notify.ts
- apps/daemon/src/notify.test.ts

**Mesure de succès.** Test moteur : la série oscillante donne 1 déclenchement avec une marge de 0,2 % et toujours 300 sans règle. Tests : une alerte « Journal » crée une entrée sans notification ; une sourdine expirée notifie de nouveau ; en heures calmes, seule « Critique » part. À l'usage : moins de messages Telegram par jour, sans déclenchement perdu au journal.

**Avis des juges.**

- valeur (4) : J'ai vérifié que frontArme réarme sans aucune marge (packages/alerts/src/engine.ts:306-311). 300 déclenchements en 10 minutes ruinent la confiance dans les alertes et risquent un refus Telegram 429 au mauvais moment. C'est aussi la condition pour que les alertes au stop d'IDEE-1 restent supportables.
- cout-risque (2) : Le moteur d'alertes est partagé entre le front et le daemon, et ce dernier garde son propre état arme : une marge mal posée fait perdre des déclenchements. Le lot 2 (niveaux, sourdine, heures calmes) ajoute des champs et des réglages dans le KV. C'est un L avec revue obligatoire.
- coherence (4) : L'anti-rebond (lot 1) corrige dans le moteur partagé une usure réelle de la confiance. Niveaux, sourdine et heures calmes ajoutent beaucoup de réglages et touchent le daemon : il faut les garder dans un second temps.

### 17. IDEE-23 — Prochaine annonce à risque dans le bandeau, avec pré-alerte

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **S** (initial S) · existe déjà : partiellement · origines : ERG-5

**Problème.** Le cadre permanent de l'écran ne signale aucune annonce imminente : le bandeau affiche P&L, alertes, santé et régime (components/SessionStrip.tsx:128-212), et le calendrier n'est visible que si ECO ou BRIEF est ouvert. Aucun des 12 types de condition de @axiom/alerts (packages/alerts/src/types.ts) ne permet de prévenir avant une publication, et aucune pré-alerte n'existe (grep « rappel », « minutes avant » vide). L'opérateur peut entrer en position, ou garder un stop serré, deux minutes avant le CPI.

**Proposition retenue après vérification.** Une case dans le bandeau : « ÉCO CPI US dans 1 h 12 » (≈ si l'heure est approximative). Elle montre le prochain évènement fort impact USD des 24 prochaines heures, avec une liste de devises réglable, et ignore les évènements « toute la journée ». Elle passe en couleur d'avertissement sous 30 min et ouvre ECO au clic. La fonction pure prochainEvenementRisque(events, maintenant, devises) vit hors de data/eco (pas d'import de rangImpact) et est testée avec une horloge injectée. Le bandeau lit ecoStore.events et ne déclenche ecoStore.refresh(false) que si le réglage est actif. Minuterie d'une minute. En option, une pré-alerte à T-15 puis T-2, une seule fois par évènement. Elle ne part que si une position PORT ou PAPER est ouverte, ou un ordre PAPER actif. Elle passe par un appel Notification sans garde de visibilité, plus un bip, et l'écran indique qu'elle ne fonctionne qu'avec l'application ouverte (aucun relais Telegram). Prérequis : DATA-6.

**Proposition initiale.** Une case « ÉCO CPI US dans 1 h 12 » dans le bandeau montre le prochain évènement fort impact des 24 heures ; elle ouvre ECO au clic et passe en couleur d'avertissement sous 30 minutes. En option : une notification 15 minutes puis 2 minutes avant, seulement si une position PORT ou PAPER est ouverte ou un ordre PAPER actif. Le marqueur vertical existe déjà sur le graphe.

**Réutilise.** chargerEvenementsEco et son cache (data/eco.ts ; store/eco.ts:7-8), rangImpact, SessionStrip, notifier et bip (alerts/runtime.ts:1058), portfolioStore et paperStore pour l'exposition, ecoStore.openEco.

**À créer.** Fonction pure prochainEvenementRisque(events, maintenant) et ses tests. Minuterie lente (1 minute) dans le bandeau. Réglage pour activer ou couper la pré-alerte.

**Données.** Calendrier déjà chargé et mis en cache (ForexFactory, FRED, FOMC) ; aucune source nouvelle.

**Ce qui existe déjà.** Le calendrier existe : liste ECO (apps/web/src/components/EcoWindow.tsx:205), section BRIEF des évènements fort impact du jour (apps/web/src/data/brief.ts:248-265, components/brief/SectionEco.tsx), marqueurs verticaux (chart/ecoMarkers.ts, markersEnabled désactivé par défaut, store/eco.ts:65) et superposition des annonces USD fort impact dans OMON termiv (OptionsWindow.tsx:550-556). Rien n'en paraît dans le cadre permanent : SessionStrip.tsx:127-212 n'affiche que P&L, alertes, santé et régime. Aucune pré-alerte : grep vide sur pré-alerte, T-15, « minutes avant » et « avant publication ». Les 12 types de condition sont confirmés (store/alerts.ts:124-128).

**Contrat.** Aucune fenêtre, aucun fournisseur : ForexFactory, FRED et FOMC sont déjà câblés. La case du bandeau est une surface, donc exception G100 à demander. Prérequis DATA-6 confirmé (FRED à 12:30Z et FOMC à 18:30Z figés, data/eco.ts:188 et 252). Budget d'entrée : data/eco est un module différé que chargementInitial.test.ts:39 interdit dans le chemin initial, et SessionStrip est chargé au démarrage.

**Risques.** (1) Importer rangImpact depuis data/eco dans le bandeau ferait échouer chargementInitial.test.ts. Il faut tester `impact === "high"` dans un petit module pur, ou ne passer que par ecoStore, qui charge data/eco par import(). (2) notifier() n'affiche rien quand l'onglet est caché (runtime.ts:1058-1066), et le daemon ne connaît pas le calendrier. Réutilisée telle quelle, la pré-alerte T-15 ne se verrait qu'onglet visible, c'est-à-dire quand le bandeau suffit déjà. Elle demande un appel Notification propre, sans garde de visibilité, puisqu'aucun doublon daemon n'est possible. Pas de Telegram sans travail daemon. (3) Aujourd'hui, le calendrier ne se charge qu'à l'ouverture d'ECO, du BRIEF ou d'OMON. Le charger à chaque démarrage enverrait, sur le déploiement Vercel public, une requête ForexFactory par visiteur sans cache, depuis les IP partagées du proxy, alors que ForexFactory bride fortement (garde de 2 fetch par 5 min). Il vaut mieux ne charger qu'avec le réglage actif, ou ne lire que le cache existant. (4) ForexFactory classe « fort impact » dans toutes les devises (AUD, JPY…). Sans filtre USD par défaut, comme dans OptionsWindow.tsx:555, la case afficherait du bruit. (5) Les heures approximatives (timeApprox de FRED et FOMC, au-delà de la semaine couverte) et les évènements « toute la journée » à 00:00 doivent être signalés (≈) ou écartés. (6) Le P&L du bandeau ne lit que PORT : l'exposition PAPER demande un abonnement de plus à paperStore.

**Fichiers à toucher.**

- apps/web/src/components/SessionStrip.tsx
- apps/web/src/lib/prochainEvenementRisque.ts
- apps/web/src/lib/prochainEvenementRisque.test.ts
- apps/web/src/store/eco.ts
- apps/web/src/components/SettingsPanel.tsx
- apps/web/src/alerts/runtime.ts

**Mesure de succès.** Tests avec horloge injectée : la bonne annonce est choisie, rien ne s'affiche sans annonce dans les 24 h, la notification T-15 part une seule fois. Dans EXPY : moins de trades ouverts dans les 15 minutes qui précèdent une annonce fort impact.

**Avis des juges.**

- valeur (3) : Rappeler qu'un CPI tombe dans 20 minutes évite une erreur classique, entrer ou garder un stop serré juste avant. Mais le calendrier est déjà dans BRIEF et ECO, et la pré-alerte ne fonctionne qu'application ouverte.
- cout-risque (4) : Une fonction pure prochainEvenementRisque et une case dans le bandeau suffisent. Elle lit ecoStore sans importer data/eco, ce qui respecte le garde-fou de chargementInitial.test.ts. Le seul risque est de charger ForexFactory sans réglage sur Vercel, que la proposition évite.
- coherence (4) : Elle réutilise ECO sans fournisseur nouveau et évite une erreur courante (entrer juste avant le CPI). Il faut respecter le budget du chargement initial et ne pas charger ForexFactory à chaque visite du site public.

### 18. IDEE-24 — Risque de ruine et drawdown probable calculés sur mon journal réel (EXPY)

**Score 14/20** · valeur 3 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : RSK-5

**Problème.** Le Monte-Carlo existe (packages/backtest/src/monteCarlo.ts : probabilité de ruine, drawdown p50 et p95), mais seule la fenêtre BT l'utilise (BacktestWindow.tsx:30 et 704), sur des trades simulés. EXPY, qui contient les vrais trades, n'affiche qu'expectancy, taux de réussite et profit factor (data/expy.ts:71-84). L'opérateur ne sait pas si son risque par trade est compatible avec ses propres résultats : à 2 % par trade, quelle chance de perdre 30 % sur les 50 prochains trades ?

**Proposition retenue après vérification.** Section « Projection » dans EXPY, sur les R des trades clos, avec exclusion possible du tag « paper » et le nombre de trades sans R affiché. Une fonction pure projectionR(rs, horizon 50 ou 100, chemins, rng, mode iid ou blocs) dans @axiom/backtest, testée, rend par chemin le drawdown max en R, le minimum cumulé en R, la somme finale en R et la plus longue série de pertes. Tous les chiffres en % se déduisent du risque par trade par simple multiplication, puisque le modèle est à risque fixe, additif et prudent, ce que l'écran annonce. On en tire : drawdown médian et p95, P(finir sous le capital) = P(ΣR < 0), P(toucher −20 % et −50 %), série de pertes médiane et p95. Le curseur « risque par trade » est lu dans store/risque.ts, et le « risque max pour P(DD > 30 %) ≤ 5 % » vaut 30 % ÷ quantile 95 % du DD en R, sans dichotomie. Chaque chiffre est donné deux fois : avec l'expectancy observée, et « sans avantage » (R recentrés sur 0). Avertissement sous 30 trades avec l'erreur type de statistiquesR ; rien sous 10. Prérequis : PRT-2. monteCarloTrades et BT restent inchangés, donc BT-7 n'est pas requis. Le cône est optionnel : extraire dessinerCone de BacktestWindow seulement s'il est repris.

**Proposition initiale.** Une section « Projection » dans EXPY. À partir des R des trades clos et du profil de risque (capital, risque %, IDEE-2), elle rééchantillonne 50 ou 100 trades futurs par blocs et affiche : drawdown maximal médian et p95, probabilité de finir sous le capital, probabilité de toucher −20 % et −50 %, plus longue série de pertes attendue. Un curseur « risque par trade » montre comment P(drawdown > 30 %) varie, et indique le risque % maximal pour rester sous 5 %. Sous 30 trades, un avertissement avec l'erreur type ; le modèle (risque fixe) est dit à l'écran. Le filtre Réel / Simulé d'IDEE-1 s'applique.

**Réutilise.** @axiom/backtest (monteCarloTrades en mode blocs, mulberry32), data/expy.ts (rMultiple), data/expyContexte.ts (statistiquesR et erreur type), store/risque.ts, dessin du cône de BacktestWindow.tsx:577-680.

**À créer.** Option pure et testée longueur (nombre de trades simulés) dans monteCarloTrades. Conversion R → PnL au risque fixe. Section EXPY. Recherche par dichotomie du risque % maximal.

**Données.** Disponibles : trades EXPY. Aucun appel réseau.

**Ce qui existe déjà.** Le Monte-Carlo existe (packages/backtest/src/monteCarlo.ts : probRuine, maxDrawdown p50/p95, mode blocs, mulberry32) mais seule la fenêtre BT l'utilise (apps/web/src/components/BacktestWindow.tsx:30 et 704). EXPY offre la courbe d'équité en R (data/expy.ts:122-137), les stats (l.71-116), l'histogramme, la répartition et statistiquesR avec erreur type (data/expyContexte.ts:24-38). Aucun drawdown, ruine ou projection dans EXPY (grep vide). Le profil de risque existe déjà, sans IDEE-2 : store/risque.ts (capital, risquePct). Les trades PAPER portent le tag « paper » (data/paper.ts:345), ce qui permet un filtre réel/simulé dès maintenant. dessinerCone est local à BacktestWindow.tsx:581 et n'est pas exporté.

**Contrat.** Aucune fenêtre ni fournisseur ni dépendance : @axiom/backtest est déjà une dépendance du web, et EXPY est chargé à la demande (App.tsx:205). La section dans EXPY demande une exception G100. Calcul financier, donc revue indépendante. PRT-2 est un vrai prérequis (R brut, optimiste pour les stops serrés). BT-7 ne l'est pas si la projection calcule ses propres probabilités en R au lieu de lire probFinaleNegative.

**Risques.** (1) Avec un risque fixe (PnL = R × risque% × capital, modèle additif de monteCarloTrades), le drawdown en % est EXACTEMENT risque% × drawdown en R, à graine égale. Vérifié : DD p95 de 13 / 26 / 65 % à 1 / 2 / 5 %, identique à risque × DD_R (scratchpad/idees/verif-21-24/echelle.ts). La dichotomie et les relances par position du curseur sont donc inutiles : un seul tirage en R suffit, et le risque maximal vaut seuil ÷ quantile 95 % du DD en R. (2) monteCarloTrades ne renvoie ni le minimum depuis le départ (« toucher −20 % » est différent du drawdown depuis le pic), ni la plus longue série de pertes, et son horizon est figé au nombre de trades. Ajouter ces sorties dans la fonction partagée avec BT exposerait BT à une régression : mieux vaut une fonction pure dédiée. (3) Le bootstrap reprend l'expectancy de l'échantillon : sur 20 à 40 trades, une chance passée devient une projection rassurante. Il faut un scénario « sans avantage » (R recentrés sur 0) affiché à côté. (4) Les trades sans R (sans stop) sont exclus en silence (rMultiple, expy.ts:50-58) : afficher leur nombre. (5) Le modèle additif est plus prudent qu'un risque en % du capital courant (composé). Le dire à l'écran plutôt que de prétendre au réalisme. (6) Moins de 10 trades : monteCarloTrades renvoie null ; garder ce seuil et ajouter l'avertissement sous 30.

**Fichiers à toucher.**

- packages/backtest/src/projectionR.ts
- packages/backtest/src/projectionR.test.ts
- packages/backtest/src/index.ts
- apps/web/src/components/ExpyWindow.tsx
- apps/web/src/data/expy.ts

**Mesure de succès.** Tests : à graine égale, une même liste de PnL donne les mêmes percentiles qu'un run BT ; avec une expectancy négative, P(drawdown > 30 %) augmente avec le risque %. À l'usage : l'opérateur choisit son risque % depuis cette courbe et le reporte dans le profil.

**Avis des juges.**

- valeur (3) : Calibrer son risque par trade sur ses propres R, avec un scénario « sans avantage », éclaire une décision importante. Elle se prend toutefois rarement, et la projection reste fragile avec 20 à 40 trades.
- cout-risque (4) : Une fonction pure dédiée dans @axiom/backtest laisse BT et monteCarloTrades intacts. La remise à l'échelle linéaire du drawdown évite les relances et le scénario « sans avantage » est simple. C'est un calcul financier à faire relire, après PRT-2.
- coherence (4) : Elle réutilise le Monte-Carlo testé, et le scénario « sans avantage » à côté du scénario observé est honnête. Elle ajoute une fonction dédiée à côté de monteCarloTrades, ce qui reste acceptable pour ne pas exposer BT à une régression.

### 19. IDEE-3 — Du dessin « position » à un ordre PAPER prérempli et dimensionné au risque, frais compris

**Score 13/20** · valeur 3 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : non · origines : DEC-3, RSK-3

**Problème.** L'outil position calcule déjà le sens, le R:R et la taille au risque (chart/position.ts:54-122, store/risque.ts), mais rien ne lit le dessin hors de drawing.ts, et un clic droit le supprime (chart/drawing.ts:558-562). Le brouillon PAPER ne transporte que le symbole, la source et une direction facultative, et exige un decisionId (store/paper.ts:67-82). Le dossier ne transmet même pas la direction (components/DecisionDossiers.tsx:75) et ne stocke qu'une invalidation en texte libre (data/decisionDossier.ts:49-60). PAPER demande un « Montant $ » (PaperWindow.tsx:98, 106 et 620-664) : l'opérateur recopie entrée, SL et TP et convertit son risque en montant à la main, avec un risque de faute de frappe sur le stop. Un brouillon compte comme « thèse renseignée » même quand le dossier est vide (PaperWindow.tsx:204).

**Proposition retenue après vérification.** Bouton « Depuis le dessin position » dans PAPER, et commande de palette, au lieu d'un menu sur le graphe. Il lit le dessin position sélectionné, sinon le plus récent, du symbole du slot focus, et prépare un brouillon complet : sens déduit de la géométrie, ordre limit ou stop selon l'entrée par rapport au dernier prix, SL et TP égaux aux points du dessin, quantité EN UNITÉS calculée par une seule fonction pure, frais aller-retour compris (formule de data/paper.ts:411-415) sur l'équity PAPER, levier implicite affiché et plafonné (BT-4). decisionId facultatif quand l'origine est « dessin ». Rien n'est placé sans clic sur « Placer ». « Préparer dans PAPER » depuis un dossier transmet aussi la direction. Le critère Plan exige une thèse non vide. « Suivre dans PORT » vient après IDEE-1. Le plan chiffré du dossier est reporté.

**Proposition initiale.** Quand un dessin position est sélectionné, un petit menu (même principe que priceAlertMenu) propose « Préparer dans PAPER » et « Suivre dans PORT ». Le dossier gagne un plan chiffré facultatif (entrée, stop, cible, risque %), rempli depuis le dernier outil position du symbole ou à la main. PAPER reçoit un brouillon complet : sens déduit de la géométrie ; ordre limit ou stop selon la position de l'entrée par rapport au prix ; SL et TP ; quantité calculée depuis le risque % du profil, frais aller-retour compris (formule déjà écrite dans evaluerDisciplinePacte), avec levier implicite affiché et plafonné. Rien n'est placé sans clic sur « Placer ». « Suivre dans PORT » préremplit une position réelle avec son stop (IDEE-1). Le critère « Plan » de PACTE exige une thèse non vide.

**Réutilise.** chart/position.ts (calculerPosition, taillePosition), chart/drawing.ts (onSelected, dessins persistés axiom:drawings:v1), chart/priceAlertMenu.ts (menu flottant), store/risque.ts, data/paper.ts:411-415 (risque frais compris), store/paper.ts (paperUiStore.preparer), components/PaperWindow.tsx, store/decisionDossiers.ts, store/portfolio.ts.

**À créer.** Type PlanDecision dans data/decisionDossier.ts avec validation. Extension de BrouillonDecisionPaper (origine « dessin », entrée, sl, tp, montant, type d'ordre, decisionId facultatif). Fonctions pures tailleDepuisRisque (frais, plafond de levier) et dessinVersBrouillon (long et short, limit et stop), testées. Menu du dessin sélectionné.

**Données.** Toutes locales : points du dessin, capital et risque du profil, dernier prix connu.

**Ce qui existe déjà.** L'outil position calcule le sens, le R:R et la taille (apps/web/src/chart/position.ts:54-102). Personne ne lit le dessin hors de drawing.ts (grep calculerPosition et POSITION_NAME). Le clic droit le supprime (chart/drawing.ts:558-562). Le dessin sélectionné est connu via entry.selectedOverlayId (drawing.ts:548-552), et les points sont persistés dans axiom:drawings:v1 (drawing.ts:455). Le brouillon PAPER se limite au symbole, à la source, à une direction facultative et à un decisionId obligatoire (store/paper.ts:67-82). Le dossier ne transmet pas la direction (components/DecisionDossiers.tsx:75). Un brouillon suffit à valider « thèse renseignée » (PaperWindow.tsx:204). Les lignes PAPER du graphe ne se déplacent pas (chart/paperLignes.ts:11-12).

**Contrat.** Aucune fenêtre, aucun fournisseur. PAPER reste une simulation et le brouillon ne crée aucun ordre, ce qui respecte BUILD-CONTRACT.md:606-608. C'est une surface nouvelle, donc une exception G100 est à demander. Le correctif PRT-7 (taille hors frais) doit être livré avant, ou dans la même fonction pure, pour ne pas garder deux formules. Plafond de levier aligné sur BT-4. Le plan chiffré du dossier (PlanDecision) n'est pas nécessaire au premier lot.

**Risques.** 1) Calcul : PaperWindow convertit le montant en unités au prix COURANT même pour un ordre limit ou stop (PaperWindow.tsx:176-181), alors que PACTE calcule au prix d'entrée (data/paper.ts:411). Un brouillon passé en « montant $ » ne tiendrait pas la promesse « perte au stop = risque à 1 % près » dès que l'entrée s'éloigne du prix. Le brouillon doit transporter une quantité en unités, ou corriger la conversion. 2) La base du risque doit être l'équity PAPER pour PAPER, et le capital du profil seulement pour PORT. 3) Un menu flottant sur sélection d'overlay se heurte au modèle d'événements de KLineChart et à la convention clic droit = supprimer. Un bouton dans PAPER, « Depuis le dessin position », qui lit le dessin sélectionné ou le dernier dessin position du symbole sur le slot focus, plus une commande de palette, donne le même gain avec moins de risque. 4) Plusieurs dessins position sur un même symbole : il faut une règle explicite (sélectionné, sinon le plus récent) et l'afficher. 5) Ordre limit ou stop déduit : entrée sous le prix pour un long → limit, au-dessus → stop. Inverse pour un short ; à tester.

**Fichiers à toucher.**

- apps/web/src/data/brouillonDessin.ts (nouveau, pur : dessinVersBrouillon, tailleDepuisRisque) + test
- apps/web/src/chart/drawing.ts (export de lecture du dessin position sélectionné ou du dernier du slot focus)
- apps/web/src/chart/position.ts (taille frais compris, à partager avec le correctif PRT-7)
- apps/web/src/store/paper.ts (BrouillonDecisionPaper étendu ; preparer accepte une origine « dessin » sans decisionId)
- apps/web/src/components/PaperWindow.tsx (préremplissage, quantité en unités, Plan = thèse non vide)
- apps/web/src/components/DecisionDossiers.tsx (transmettre la direction)
- apps/web/src/components/PortfolioWindow.tsx (préremplissage « Suivre dans PORT », après IDEE-1)

**Mesure de succès.** Un setup dessiné devient un ordre prêt en 1 ou 2 clics au lieu de 6 champs. Test : le montant égale le notionnel de l'étiquette, SL et TP égalent les points du dessin. La perte réelle au stop égale le risque affiché à 1 % près. Aucun ordre n'est créé sans « Placer ».

**Avis des juges.**

- valeur (3) : Le gain de temps est réel et la faute de frappe sur le stop disparaît, mais seulement pour PAPER. Le levier ne pèse sur le réel qu'une fois relié à PORT.
- cout-risque (3) : Le patron existe (position.ts calcule déjà la taille, et le brouillon PAPER existe), mais la fonction pure de quantité frais compris et le choix limit/stop sont des calculs financiers neufs. Il faut aussi corriger la conversion au prix courant (PaperWindow.tsx:176-181) et attendre PRT-7.
- coherence (4) : Elle réutilise l'outil position et le brouillon PAPER, et rien n'est placé sans clic, ce qui respecte BUILD-CONTRACT.md:606-608. La surface ajoutée est modeste. Il faut une seule fonction de taille, partagée avec le correctif PRT-7.

### 20. IDEE-12 — Valeur mesurée d'une alerte : banc d'essai sur l'historique avant de l'armer, et bilan réel de ses déclenchements

**Score 13/20** · valeur 4 · coût-risque 2 · cohérence 3 · effort révisé **L** (initial L) · existe déjà : partiellement · origines : ALR-2, EDG-6

**Problème.** Rien ne dit si une alerte apporte une information. Le formulaire crée directement (AlertsPanel.tsx:358) ; l'alerte ne garde que 20 horodatages (packages/alerts/src/engine.ts:34) ; le journal du front est limité à 100 entrées (store/alerts.ts:30) ; celui du daemon est purgé à 30 jours et n'enregistre ni unité ni direction (apps/daemon/src/alerts.ts:92 et 317-325). Personne ne mesure ce qui suit un déclenchement (rien dans store/alerts.ts, AlertsPanel ni decisionDossiers), alors que l'étude d'évènements existe pour EQS (data/validationSignaux.ts). BT ne répond pas : pas de sortie au bout de N bougies, et ses opérandes ne sont pas les conditions d'alerte (packages/backtest/src/types.ts:68-87). Les seuils sont armés à l'intuition, comme la variation de 2,5 % en 1 h créée d'un clic par EQS (ScreenerWindow.tsx:258-262).

**Proposition retenue après vérification.** Livrer d'abord le lot 1 seul : un bouton « Tester sur l'historique » (90 jours par défaut) dans le formulaire et sur chaque alerte des types à bougies, soit variation-pct, indicateur-seuil, indicateur-croisement et funding-extreme. prix-croise est marqué « approché à la clôture », les autres types « non testable ». Le test rejoue le vrai moteur par préfixes clôturés (même calibrage, même ré-armement), sur la source de l'alerte. Il affiche le nombre de déclenchements par semaine, puis, pour le sens choisi par l'opérateur (achat, vente ou amplitude), le rendement à +1, +6 et +24 bougies comparé à toutes les bougies via etudeEvenements. S'y ajoutent l'IC d'IDEE-10, un avertissement sous 10 déclenchements, et la mention « réglé sur ces mêmes 90 j : non probant » dès que l'opérateur modifie l'alerte après un test. Les déclenchements passés sont marqués sur le graphe. Le « bilan réel » vient plus tard (lot 2), après OFL-3, DMN-2 et MFN-3, une fois l'unité et la condition inscrites au journal du daemon. Il sert surtout à compter les déclenchements manqués ou en trop (rejeu contre journal).

**Proposition initiale.** (1) Un bouton « Tester 90 j » dans le formulaire et sur chaque alerte rejoue le vrai moteur bougie par bougie (même calibrage, même ré-armement, sans anticipation). Pour chaque déclenchement : rendement signé à +1, +6 et +24 bougies et excursions, comparés à la même mesure sur toutes les bougies (référence « au hasard »), avec IC (IDEE-10) et avertissement sous 10 déclenchements. Exemple : « 14 déclenchements (≈1,1 par semaine) ; à +6 bougies, médiane +0,9 % contre +0,2 % au hasard ». Les déclenchements passés sont marqués sur le graphe. (2) « Bilan réel » : le même calcul sur les déclenchements effectifs (front et daemon), en séparant ceux suivis d'un trade (decisionIds) et ceux ignorés. Colonne « Suite » dans le journal et ligne par alerte : « +0,4 % à 6 bougies, IC [−0,3 ; +1,1] : non distinguable du hasard ; pris 5, ignorés 9 ». Résultats compacts gardés dans le KV du daemon. Conditions sans direction : amplitude seulement ; types sans historique (CVD, liquidations, régime, baleines) : « non testable ».

**Réutilise.** evaluerAlertes (packages/alerts/src/engine.ts:75), accumulerKlines (data/backtestData.ts:103) et cache de bougies du daemon, chargerRefCloseBacktest (store/backtest.ts:79) pour AXIS, histFunding, etudeEvenements, fusionnerEtudes et finaliserEtude (data/validationSignaux.ts), lib/evts.ts (alignerFenetre, statsEvts), statistiquesR, projeterPreuveDeclenchement (data/decisionDossier.ts:136), journalAlertesGet (data/daemon.ts:778), btMarksStore, modèle du worker de backtest, miroiterTravailPersonnel.

**À créer.** Fonctions pures rejouerAlerte(def, candles, {debutEvaluationMs, aux?, funding?}) et issuesApresSignal(candles, indices, horizons) dans packages/alerts. Direction d'une condition. Stockage compact des résultats. Bloc de résultat et colonne « Suite » dans AlertsPanel. Tests : égalité rejeu/évaluation live, égalité avec l'étude EQS sur les mêmes évènements.

**Données.** Déjà chargées ailleurs : klines et funding historiques, amorce de 1 500 bougies pour AXIS. Mesure en scratchpad (marche aléatoire 4h, 540 bougies + 1 500 d'amorce) : 127 ms pour une alerte RSI, 1,1 s pour AXIS.

**Ce qui existe déjà.** Aucun rejeu d'alerte : grep « rejouerAlerte », « tester » et « simul » ne trouve rien dans AlertsPanel.tsx (1 068 lignes) ni dans packages/alerts. Briques existantes : l'étude d'évènements EQS avec référence inconditionnelle (data/validationSignaux.ts:187 etudeEvenements, fusionnerEtudes, finaliserEtude), mais seulement pour le funding et la divergence, à 6 et 18 bougies 4h ; lib/evts.ts (alignerFenetre, statsEvts) ; histFunding (data/referentiels.ts:107). Les dossiers de décision relient un déclenchement aux trades PAPER/EXPY (decisionDossier.ts:216, DecisionDossiers.tsx:44-46). BT n'a pas de sortie après N bougies (packages/backtest/src/types.ts, engine.ts).

**Contrat.** Bloc dans la section Alertes : exception G100 à demander. Pas de nouveau fournisseur, mais accumulerKlines ne sert que Binance spot (backtestData.ts:43). Une alerte sur Bybit, OKX, Coinbase ou un perp doit passer par l'adaptateur de sa source ou être déclarée « non testable ». Pas d'enregistreur. Le front doit rester complet sans daemon : stockage local borné (DATA-3). Le lot 1 seul (banc d'essai) est de taille M.

**Risques.** 1) Direction : un seuil comme « RSI < 30 » n'a pas de sens intrinsèque, et le deviner est arbitraire. Il faut le demander (achat, vente ou simple surveillance) ou mesurer l'amplitude seulement. 2) Boucle de réglage : tester sur 90 jours puis ajuster le seuil revient à optimiser dans l'échantillon. Il faut compter les essais et le dire. 3) Horizons qui se chevauchent et déclenchements groupés : le n effectif est plus petit, donc l'IC doit être par grappes (IDEE-10). 4) prix-croise se déclenche sur les ticks en cours de bougie ; un rejeu à la clôture n'en donne qu'une approximation. 5) L'égalité rejeu/évaluation live dépend de la fenêtre pour les indicateurs à longue mémoire : le front évalue sur les bougies du graphe, avec refClose (v5), le daemon sans référence (v2). Le test d'égalité doit fixer la fenêtre. 6) Bilan réel : journaux courts (front 100 entrées, store/alerts.ts:30 ; daemon 30 jours et 200 lignes, apps/daemon/src/alerts.ts:85-92). Les faux déclenchements dus au replay (OFL-3) et les doublons (MFN-3) ne sont pas identifiables après coup. « Ignoré » veut seulement dire « sans dossier PAPER/EXPY lié », ce qui reste ambigu : le trade a pu être passé hors de l'outil.

**Fichiers à toucher.**

- packages/alerts/src/rejeu.ts (nouveau : rejouerAlerte, issuesApresSignal)
- packages/alerts/src/rejeu.test.ts
- packages/alerts/src/index.ts
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/store/alerts.ts (résultat compact)
- apps/web/src/data/backtestData.ts (réutiliser accumulerKlines, prérequis BT-2)
- apps/web/src/data/validationSignaux.ts (rendre etudeEvenements utilisable pour une amplitude)
- apps/web/src/chart/btMarkers.ts (marques des déclenchements passés)
- lot 2 : apps/daemon/src/alerts.ts (unité et condition dans le journal), apps/web/src/data/daemon.ts

**Mesure de succès.** Test d'égalité : rejouerAlerte donne exactement les déclenchements d'une évaluation live bougie par bougie. La référence « au hasard » est toujours affichée. Chaque déclenchement de plus de 24 bougies a sa suite. L'opérateur supprime ou ajuste les alertes qui ne font pas mieux que le hasard, et voit l'écart entre signaux pris et ignorés.

**Avis des juges.**

- valeur (4) : Avant d'armer une alerte, l'opérateur verrait combien de fois elle se déclenche et si elle apporte une information face à la dérive de base. Cela change la façon de régler chaque alerte, aujourd'hui fixée à l'intuition. Le risque de réglage dans l'échantillon est correctement signalé.
- cout-risque (2) : Rejouer le vrai moteur par préfixes clôturés sur 90 jours coûte cher en calcul pour les indicateurs longs (amorce AXIS de 1 500 bougies), et chaque source hors Binance demande son adaptateur. Le lot 1 seul reste un M exposé au réglage dans l'échantillon.
- coherence (3) : Mesurer la valeur d'une alerte est une bonne intention. Mais l'idée crée un second banc d'essai à côté de BT et de l'étude EQS, qui pousse au réglage dans l'échantillon. L'effort est L et la surface se disperse.

### 21. IDEE-14 — Seuil de coût d'un run et coût réel mesuré par le carnet, injectés dans BT

**Score 13/20** · valeur 3 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : EDG-4

**Problème.** BT applique par défaut un slippage fixe de 0,02 % (store/backtest.ts:717), quels que soient l'actif et le montant. DOM mesure pourtant le coût réel dans le carnet L2 pour un montant donné, médiane et P95 sur 1, 5 et 15 minutes (data/depthStability.ts:24-27, conservé dans store/microstructure-diagnostic.ts:90 ; README.md:322). Le protocole AXIS juge toujours à x1 et x3 (docs/axis-2026-10-07.md:226-232), et les signaux courts « perdent après frais de 1s à 30m » (README.md:187), mais BT n'indique jamais à partir de quel coût un run cesse de gagner. FUNDX affiche déjà ce genre de seuil pour le carry (components/fundx/CarryPanel.tsx:88). Sur une alt peu liquide avec 10 000 USDT, 0,02 % peut sous-estimer le coût d'un ordre de grandeur.

**Proposition retenue après vérification.** (a) Garder la ligne « Seuil de coût » : coût par côté (frais et slippage) qui annule l'expectancy nette en % par trade, trouvé par dichotomie bornée à [0 ; 2 %] dans le worker. Afficher les résultats à ×1, ×2 et ×3 et la marge (« tient jusqu'à 0,35 %/côté, ×5 la valeur saisie »), avec n trades et une mise en garde quand n < 10. (b) « Mesurer le coût du carnet » : BT ouvre lui-même souscrireDepth sur le symbole du run, avec un StabiliteCarnet au notionnel tailleFixe, pendant 30 à 60 s (20 observations minimum, MIN_QUANTILES). Il propose ensuite max(P95 achat, P95 vente) en %, daté, avec la durée et la mention « carnet spot, photo de session ». Si DOM suit déjà ce symbole à un notionnel ≥ tailleFixe, sa valeur peut servir de majorant immédiat, puisque le coût croît avec le notionnel. Rien n'est appliqué sans clic, et la signature du run change comme pour toute saisie.

**Proposition initiale.** (a) Une ligne « Seuil de coût » sous la grille : le coût par côté (frais et slippage) qui ramène l'expectancy nette à zéro, trouvé par dichotomie dans le worker (environ 8 runs), avec les résultats à x1, x2 et x3 et la marge (« tient jusqu'à 0,35 %/côté, marge ×5 »). (b) Un bouton « Coût mesuré » remplit le slippage avec le P95 L2 du DOM pour le montant du run, en indiquant la date et la fenêtre de la mesure, quand le carnet du symbole est suivi. Sinon le champ reste manuel et la ligne le dit.

**Réutilise.** runBacktest via workers/backtest.worker.ts, StabiliteCarnet et VueStabiliteCote.p95Bps (data/depthStability.ts), coutExecution (data/depthExecution.ts), NOTIONNELS_COUT (store/dom-ui.ts:21), store/microstructure-diagnostic.ts, présentation du seuil de CarryPanel.tsx.

**À créer.** Fonction pure seuilCout(candles, strat, params) dans @axiom/backtest, avec tests de monotonie et de bornes. Lecture du store microstructure depuis BT. Une ligne et un bouton dans BT.

**Données.** Déjà disponibles : carnet Binance reçu par DOM, bougies du run. Le coût L2 est une photo de la session, pas un historique, et c'est écrit.

**Ce qui existe déjà.** Le slippage BT est fixe par défaut (store/backtest.ts:716-717), sans seuil de coût ni stress ×3 dans BT (grep x3/point mort vide). DOM mesure le coût L2 en médiane et P95 sur 1, 5 et 15 min (data/depthStability.ts:24-50, classe StabiliteCarnet l.82, réutilisable) via coutExecution (data/depthExecution.ts:30), mais seulement pour le symbole du graphe maître et tant que DOM ou EQS est ouvert (store/microstructure-diagnostic.ts:1-8). Le seuil de rentabilité du funding existe déjà dans FUNDX (components/fundx/CarryPanel.tsx:88). Rien ne relie DOM et BT : aucun consommateur de coutExecution hors DOM.

**Contrat.** Une ligne et un bouton dans BT : exception G100 à demander, au même titre que BT-8 et les ajouts BT du 14 septembre. Aucun fournisseur : le WS depth Binance est déjà ouvert par DOM via souscrireDepth (data/depth.ts:467). Aucun enregistreur de carnet : une mesure courte à la demande, gardée en mémoire. Prérequis : BT-1 (sinon le seuil d'AXIS porte sur une variante sans amorce) et BT-9 (aujourd'hui les coûts négatifs sont acceptés, la recherche doit être bornée à ≥ 0).

**Risques.** (a) Faisable et peu coûteux. Mesure locale avec bun : un run AXIS sur 6 000 bougies 4h prend 15 à 50 ms, donc 8 runs restent sous 0,5 s dans le worker. Le critère doit être l'expectancy nette en % par trade (pnlTotal / nbTrades / notionnel, non stockée telle quelle dans StatsBacktest), pas l'expectancy R, nulle sans stop. La monotonie n'est pas stricte avec stopPct ou risquePct, car le stop dépend du prix rempli (engine.ts:565-582) : un test de monotonie sur des fixtures suffit. Avec un run à 3 à 12 trades (BT-6), le seuil est très bruité et il faut le présenter avec n. (b) Tel que proposé, le bouton marcherait rarement. La stabilité suit un notionnel choisi dans DOM, d'au moins 10 000 (store/microstructure-diagnostic.ts:35), alors que la taille BT par défaut est de 1 000 USDT. Elle n'existe que pour le symbole du graphe maître, DOM ou EQS ouvert, et sur 15 min au plus (depthStability.ts:52). Le carnet suivi est celui du spot, alors que le mode binance-reel teste du perp. Une photo de 15 min n'est pas le coût à l'open des barres 4h, souvent plus volatiles.

**Fichiers à toucher.**

- packages/backtest/src/seuilCout.ts (nouveau) + test
- packages/backtest/src/index.ts
- apps/web/src/workers/backtest.worker.ts
- apps/web/src/store/backtest.ts
- apps/web/src/components/BacktestWindow.tsx

**Mesure de succès.** Sur AXIS 4h BTC, le seuil affiché est cohérent avec les rapports (expectancy positive à x3, soit 0,21 %/côté). Le bouton remplit un coût daté. Avant de trader une alt, l'opérateur voit sa marge de coût réelle.

**Avis des juges.**

- valeur (3) : Le seuil de coût (« tient jusqu'à 0,35 %/côté ») dit très vite si un run est fragile, ce qui a une vraie valeur de décision. Le volet mesure du carnet marcherait rarement (notionnel, symbole, spot contre perp) et reste bruité avec peu de trades.
- cout-risque (3) : Le volet (a) est peu coûteux et sûr : dichotomie bornée dans le worker, 8 runs sous 0,5 s, et un test de monotonie suffit. Le volet (b), la mesure du carnet, est fragile : mauvais notionnel, spot contre perp, symbole du graphe maître seulement. Il fait baisser la note.
- coherence (4) : Le seuil de coût prolonge le jugement à ×1 et ×3 du protocole AXIS, à peu de frais. La mesure du coût dans le carnet DOM est fragile (notionnel, carnet spot contre perp, photo de session) et devrait rester secondaire.

### 22. IDEE-20 — Notification qui se suffit à elle-même, et lien qui ouvre le bon graphe

**Score 13/20** · valeur 3 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : TRA-5, ALR-4, ERG-4

**Problème.** Le texte Telegram se limite à `🔔 AXIOM — ${symbol}\n${decl.message}` (apps/daemon/src/notify.ts:78-81) ; la notification du navigateur a pour titre « AXIOM — alerte » et pour corps le message (alerts/runtime.ts:1058-1061), sans symbole pour une alerte prix (packages/alerts/src/describe.ts:45) ; macOS fait de même (notify.ts:173-176). Ne sont jamais montrés la valeur qui a déclenché (Declenchement.valeur, types.ts:336-346), l'unité, l'heure de la donnée ni un retard d'envoi. Le clic sur la notification ne fait rien (runtime.ts:1061), et l'application ne lit aucune URL à part #spike (main.tsx:40) : sur téléphone, il faut ouvrir AXIOM, chercher la paire et choisir l'unité.

**Proposition retenue après vérification.** (1, S) formaterAlerte(def, decl, ctx) pure dans packages/alerts, partagée par le daemon, le front et macOS. Titre : « SOLUSDT · 4h · Binance » (ou « Global »). Corps : « AXIS État ≥ 1 → 1 · prix 142,35 · bougie close 12:00 UTC · 3e en 24 h · daemon ». Pour les données lentes, toujours « obs. 30/10 » (pas de seuil de péremption, le moteur filtre déjà). « envoi +6 min » seulement si l'écart entre la clôture de la bougie et l'envoi dépasse 1 min. Tests de texte sur les 12 types. (2, S-M) Lien profond en fragment, qui ne fait que naviguer : #s=SOLUSDT&src=binance&tf=4h&t=…&f=DES,FUNDX, avec liste blanche stricte. Il est appliqué par navigateTo (markTime) et windowManager.openWindow. Pas de ws, et les champs inconnus sont ignorés. Si un autre onglet AXIOM est ouvert (BroadcastChannel), on lui transmet la navigation et on prévient l'utilisateur dans le nouvel onglet. Usages : lien ajouté au message Telegram si AXIOM_URL_LIEN (URL Vercel) est réglée, et commande ⌘K LIEN qui copie la vue courante. Le clic sur la notification du navigateur reste facultatif.

**Proposition initiale.** Une fonction pure partagée par le front et le daemon compose un format constant. Titre : « SOLUSDT · 4h · Binance » (ou « Global »). Corps : « AXIS État ≥ 1 → 1 · prix 142,35 · bougie close 12:00 UTC · 3e fois en 24 h · évaluée par le daemon », plus « ⚠ donnée du 30/10 » si l'observation dépasse 2 cadences et « ⚠ envoi +6 min » si l'envoi a plus d'une minute de retard. Un lien profond en fragment (#s=SOLUSDT&src=binance&tf=4h&t=…&f=DES,FUNDX&ws=Macro), lu au démarrage et sur hashchange, ne fait que naviguer : actif, unité, marqueur à l'heure, fenêtres du registre, workspace existant ; jamais d'alerte, d'ordre ni de clé. Trois usages : lien ajouté au message Telegram si une adresse de base est configurée, clic sur la notification du navigateur, commande ⌘K LIEN qui copie la vue courante.

**Réutilise.** packages/alerts (Declenchement, decrireCondition, instantane), apps/daemon/src/notify.ts (formaterTexteTelegram, scriptNotification), alerts/runtime.ts (notifier), contexteDecision (data/decisionDossier.ts:173) et ContexteAlerte du daemon, def.declenchements, navigateTo avec markTime (lib/navigation.ts:28-38), parseNavigation et normaliserSymbole (commands/registry.ts), WINDOW_REGISTRY, workspacesStore.apply, lib/format.ts, components/brief/sessionAlertes.ts.

**À créer.** formaterAlerte(def, decl, ctx) dans packages/alerts et champ donneeLe sur le déclenchement. lib/lienProfond.ts (lecture, écriture, liste blanche stricte). Écoute hashchange dans App. onclick sur la Notification. Variable non secrète AXIOM_URL_LIEN lue par le daemon. Commande LIEN. Tests par type de condition.

**Données.** Toutes disponibles au déclenchement. Le fragment après # n'est jamais envoyé au serveur.

**Ce qui existe déjà.** Texte Telegram minimal : apps/daemon/src/notify.ts:78-81 (`🔔 AXIOM — ${symbol}\n${decl.message}`). La notification du navigateur a pour titre « AXIOM — alerte » et pour corps le message seul, sans onclick : apps/web/src/alerts/runtime.ts:1056-1065. Elle ne s'affiche que si l'onglet est visible (ongletVisible). macOS a le symbole dans le titre (notify.ts:173-176), donc l'idée exagère sur ce point, mais ni l'unité ni la valeur. Le message par défaut d'une alerte de prix n'a pas de symbole : packages/alerts/src/describe.ts:45-50. Le journal d'ALRT affiche déjà valeur, unité, date d'observation et source pour les données lentes (AlertsPanel.tsx:990, champ instantane de packages/alerts/src/types.ts:344-345). Le moteur refuse déjà les données périmées : flux de capitaux (engine.ts:463-467) et on-chain (alerts/onchainMetriques.ts:52-74, filtre !perime). Lecture d'URL : seulement #spike (main.tsx:40) ; grep hashchange et location.hash vide. Aucune copie dans le presse-papiers dans l'app (grep navigator.clipboard vide). parseNavigation existe (commands/registry.ts:166) ; normaliserSymbole est privé (registry.ts:148). workspacesStore.apply existe (store/workspaces.ts:346).

**Contrat.** Aucun fournisseur, aucune dépendance. Le site Vercel est public : chaque champ du fragment passe par une liste blanche (symbole par motif et longueur bornée, source dans EXCHANGE_IDS, unité dans les unités supportées, fenêtres dans WINDOW_REGISTRY, t numérique borné). Pas d'alerte, d'ordre, de clé ni de réglage, et pas d'application de workspace. Revue de sécurité indépendante conseillée. Le tag anti-doublon relève de MFN-3. La commande LIEN ajoute de la surface : exception G100 légère.

**Risques.** (a) Sur poste de travail, cliquer le lien Telegram ouvre un second onglet AXIOM, ce qui déclenche les défauts multi-fenêtres (MFN-1 : réécriture des alertes ; MFN-3 : notifications en double). Il faut transmettre la navigation à l'onglet existant par BroadcastChannel et le signaler, ou attendre le Lot C. (b) Le paramètre ws=Macro appelle workspacesStore.apply, qui remplace la disposition. Depuis un workspace nommé non sauvegardé, on peut perdre la disposition en cours : un lien ne doit pas avoir cet effet, donc retirer ws. (c) Le clic sur la notification du navigateur apporte peu, puisqu'elle ne s'affiche que onglet visible. (d) L'avertissement « ⚠ donnée du 30/10 si plus de 2 cadences » ne se déclencherait presque jamais, car le moteur refuse déjà les données périmées. Mieux vaut afficher toujours la date d'observation pour les données lentes (instantane.observeLe existe). (e) Le retard d'envoi n'a de sens qu'entre la clôture de la bougie et l'envoi : le calculer à partir de l'heure de la bougie, pas de decl.ts (égal à ctx.maintenant). (f) Sur téléphone, Telegram peut ouvrir le lien dans son navigateur intégré, qui ne partage pas le localStorage : la navigation marche, les réglages personnels ne suivent pas. (g) AXIOM_URL_LIEN doit viser l'URL Vercel : un lien en 127.0.0.1 ne sert à rien sur téléphone.

**Fichiers à toucher.**

- packages/alerts/src/describe.ts (formaterAlerte : titre et corps constants) et describe.test.ts
- packages/alerts/src/index.ts
- apps/daemon/src/notify.ts (utiliser formaterAlerte, ajouter le lien si AXIOM_URL_LIEN)
- apps/daemon/src/alerts.ts (compte des 24 h depuis alertes_journal, unité et heure de la bougie dans le contexte)
- apps/web/src/alerts/runtime.ts (notifier : titre et corps formatés, onclick qui navigue)
- apps/web/src/lib/lienProfond.ts (nouveau : lecture et écriture, liste blanche) et lienProfond.test.ts
- apps/web/src/App.tsx (lecture au montage et sur hashchange)
- apps/web/src/commands/registry.ts (commande LIEN ; exporter normaliserSymbole ou réutiliser parseNavigation)

**Mesure de succès.** Tests de texte pour les 12 types de condition : plus aucune notification sans symbole ni valeur ; une donnée on-chain à J-2 porte l'avertissement. Le parseur ignore les champs inconnus. Sur téléphone, toucher le lien Telegram ouvre SOLUSDT 4h avec le marqueur sur la bougie du signal, en un geste.

**Avis des juges.**

- valeur (3) : Une notification qui donne la valeur, l'unité et l'heure de bougie, plus un lien vers le bon graphe, fait gagner du temps à chaque alerte sur téléphone. Le symbole et le message arrivent déjà ; c'est un confort plus qu'un changement de décision.
- cout-risque (3) : formaterAlerte, une fonction pure partagée, est S et sûre (tests de texte). Le lien profond sur un site Vercel public demande une liste blanche stricte, une revue de sécurité et la gestion d'un second onglet par BroadcastChannel.
- coherence (4) : Le formatage pur, partagé et testé, est un vrai gain. Le lien profond ajoute une surface de sécurité au site public et des cas multi-onglets : il doit rester strictement de la navigation, filtrée par liste blanche.

### 23. IDEE-27 — Le graphe dit si sa donnée est vivante et d'où elle vient : témoin de flux et provenance des séries

**Score 13/20** · valeur 3 · coût-risque 2 · cohérence 5 · effort révisé **L** (initial M) · existe déjà : partiellement · origines : TRA-2, TRA-3

**Problème.** Aucun module du graphe ne lit l'état du flux (aucun usage de healthStore dans apps/web/src/chart), alors que le watchdog détecte « stale » et « reconnexion » (data/wsLoop.ts). L'opérateur ne voit que la pastille globale (SessionStrip.tsx:117-126) ou une section repliée (HealthPanel.tsx:198-203) : un prix figé depuis deux minutes ressemble à un marché calme. En grille, la clé santé est par place (data/binance.ts:228 et 286), donc la coupure d'un graphe peut être masquée par un autre. Le rattrapage REST (data/resync.ts) est muet, et Twelve Data est sondé toutes les 60 s (data/twelvedata.ts:70) sans mention. Le cache des séries auxiliaires ne garde que les points (chart/auxProvider.ts:223-226) ; le repli Coinalyze → Binance est silencieux (`catch {}`, auxProvider.ts:423 et 448) ; le statut des panes ne s'affiche que si rien n'est tracé (chart/indicators.ts:68-77 ; paneHeaders.tsx:64-76) ; et le registre de qualité par métrique (data/qualiteMetrique.ts, DataWindow.tsx:200-212) ne couvre aucune série du graphe.

**Proposition retenue après vérification.** Deux lots. Lot A (M), témoin de flux par graphe. connectWsLoop et pollLoop exposent un rappel facultatif {activitéTs, état} PAR connexion, transmis par chaque adaptateur comme onResync, sans passer par le healthStore partagé. etatTemoinFlux(ageActiviteMs, seuilPlaceMs, etatConnexion, dernierRattrapage) est pur et testé. Le seuil dépend de la place (OKX tolère la fermeture sur symbole calme) et l'âge tient compte des heartbeats. Le témoin est invisible si tout va bien, ambre « muet 45 s », rouge « reconnexion… / arrêté », et affiche « rattrapé : coupure 14:02–14:05, n bougies » pendant 5 min (nombre fourni par mergeResyncCandles). Il est éteint en replay ; pour un synthétique, il prend la pire jambe ; un clic ouvre DATA. En complément, chaque connexion publie sa propre ligne santé, ou la clé partagée fait l'agrégat « pire état », ce qui supprime le dernier écrivain gagnant. Lot B (M), provenance des séries auxiliaires : Entry porte {points, source effective, dernier point, repli}. L'état « info » d'AUX-7 l'affiche dans l'en-tête du pane (« OI · Binance (repli) · 13:00 »), en ambre si l'âge dépasse 2 pas ou si un repli est actif. Chaque série tracée est publiée dans le registre de qualité, avec un test structurel garantissant qu'aucune AuxSeriesId tracée n'est sans fiche.

**Proposition initiale.** (1) Un témoin dans le coin de chaque graphe, invisible quand tout va bien : « flux muet 45 s » (ambre), « flux arrêté 3 min » (rouge), « reconnexion… », « différé : sondage toutes les 60 s (Twelve Data) », et pendant 5 min après une reprise « rattrapé : coupure 14:02–14:05, 3 bougies complétées ». L'âge est calculé sur les messages de CE graphe, le seuil selon la cadence de la source ; un clic ouvre la ligne DATA. (2) Chaque série auxiliaire porte une fiche : source effective (« Coinalyze agrégé », « Binance (repli) », « BGeometrics gratuit »), date du dernier point, pas, repli. L'en-tête du pane l'affiche discrètement (« OI · Binance (repli) · 13:00 »), en ambre si l'âge dépasse 2 pas ou si un repli est actif. Chaque série est publiée dans le registre de qualité, donc visible dans DATA.

**Réutilise.** ChartInstance.tsx (onKline l.1446, prepareResyncApply l.40), store/health.ts, data/wsLoop.ts et data/pollLoop.ts (cadences), components/ui.tsx etatFraicheur (l.843-856), écriture DOM à 1 Hz comme HealthPanel.tsx:166-182, chart/auxProvider.ts (rawFetch, Entry, getAligned), data/qualiteMetrique.ts, store/qualiteMetriques.ts, components/QualiteMetrique.tsx, chart/paneHeaders.tsx, chart/overlayLegend.ts (majBadgeStatut), data/onchain/qualiteChain.ts (motifPeremptionBg).

**À créer.** Horodatage du dernier message par graphe. Fonction pure etatTemoinFlux(ageMs, cadenceMs, etatSante, dernierRattrapage). Nombre de bougies comblées renvoyé par mergeResyncCandles. Fiche dans Entry ({points, source}). État « info » non bloquant dans le canal de statut. Ligne de provenance. Publication dans le registre de qualité. Tests.

**Données.** Disponibles : les callbacks et chaque branche de rawFetch savent déjà ce qui a répondu.

**Ce qui existe déjà.** Il n'existe aucun témoin par graphe : apps/web/src/chart ne lit jamais healthStore. Seuls existent la pastille globale (apps/web/src/components/SessionStrip.tsx:113-126) et la section Santé, repliée par défaut (HealthPanel.tsx:197-203). La clé santé est partagée par place (« binance », data/binance.ts:228 et 286), et l'état fonctionne en « dernier écrivain gagne ». marquerMessage ne lève que « stale » (store/health.ts:89-97) : un « closed » posé par le démontage d'un autre slot (data/wsLoop.ts:156-161), ou un « reconnecting », reste affiché alors que d'autres sockets reçoivent des données. Le masquage est donc confirmé, et plus large que décrit. Le resync est muet (data/resync.ts ; ChartInstance.tsx:1478-1490). Le graphe Twelve Data est sondé toutes les 60 s (data/twelvedata.ts:70 et 662-665). Le cache auxiliaire ne garde que les points (chart/auxProvider.ts:222-225). Le repli Coinalyze vers Binance est muet (`catch {}`, auxProvider.ts:417-427 et 443-452). Le statut des panes ne s'affiche que si rien n'est tracé (chart/indicators.ts:68-77 ; paneHeaders.tsx:64-80). Le registre de qualité (store/qualiteMetriques.ts) est alimenté par CHAIN, le régime, WHALES et les flux, mais par aucune série du graphe. Ce qui s'en rapproche : l'étiquette de source automatique dans l'en-tête de slot (ChartInstance.tsx, rendu, « Source sélectionnée automatiquement ») et la suggestion d'état « info » d'AUX-7 (revue, l.1719).

**Contrat.** Aucune décision verrouillée touchée. @axiom/types reste figé : le rappel d'activité passe, comme onResync, par un paramètre facultatif non typé de subscribeKline (ChartInstance.tsx:413-421). Il n'entre jamais dans le state React : écriture DOM à 1 Hz, comme HealthPanel.tsx:166-182 (BUILD-CONTRACT « pas de re-render du canvas »). Affichage général de ce qu'UX-2, AUX-1, AUX-5 et AUX-7 corrigent localement.

**Risques.** (1) Fausses alarmes : si l'âge vient des bougies reçues par onKline (seulement les messages de données), un symbole calme paraîtra « muet ». OKX ferme d'ailleurs la socket après environ 30 s sans donnée sur un symbole calme (data/okx.ts:20-21), et les heartbeats Kraken ne passent pas par onKline. Il faut lire l'activité de la socket elle-même (lastMessageTs de wsLoop.ts:123, heartbeats compris), avec un seuil propre à chaque place. Sinon on remplace « un prix figé ressemble à un marché calme » par l'inverse, qui use autant la confiance. (2) Le healthStore ne peut pas servir de source par graphe, à cause du partage de clé et du dernier écrivain. (3) Cas à traiter : replay (aucun flux live, témoin éteint), graphes synthétiques à deux jambes (le pire des deux), séries de capitalisation sondées. (4) Huit adaptateurs à modifier : risque de régression du cycle WS, à couvrir par les tests wsLoop existants. (5) « Différé : sondage 60 s » serait affiché en permanence sur les graphes tradfi, ce qui contredit « invisible quand tout va bien » : en faire une mention discrète dans l'en-tête, pas une alerte. (6) Le volet provenance des séries auxiliaires est indépendant. Ensemble, c'est L ; chaque volet est M.

**Fichiers à toucher.**

- apps/web/src/data/wsLoop.ts (rappel d'activité et d'état PAR connexion)
- apps/web/src/data/pollLoop.ts (idem pour MEXC et Twelve Data)
- apps/web/src/data/binance.ts, bybit.ts, okx.ts, kraken.ts, coinbase.ts, hyperliquid.ts, mexc.ts, twelvedata.ts (transmettre ce rappel, comme onResync)
- apps/web/src/data/resync.ts (nombre de bougies comblées)
- apps/web/src/chart/temoinFlux.ts (nouveau, pur : etatTemoinFlux) + test
- apps/web/src/chart/ChartInstance.tsx (témoin dans l'en-tête de slot, écriture DOM à 1 Hz)
- apps/web/src/chart/auxProvider.ts (Entry {points, source, dernierPoint, repli})
- apps/web/src/chart/indicators.ts (état « info » non bloquant)
- apps/web/src/chart/paneHeaders.tsx
- apps/web/src/chart/overlayLegend.ts
- apps/web/src/store/qualiteMetriques.ts (publication des séries du graphe)

**Mesure de succès.** E2E avec une WebSocket muette 70 s : le témoin s'allume sur le seul graphe concerné, puis disparaît au message suivant ; une coupure suivie d'un rattrapage affiche « rattrapé ». Coinalyze rejeté → pane étiqueté « Binance (repli) ». DATA liste les séries du graphe. Un test structurel vérifie qu'aucune série tracée n'est sans provenance.

**Avis des juges.**

- valeur (3) : Un prix figé qui ressemble à un marché calme, ou un repli silencieux de la source d'OI, peut fausser une entrée : le témoin évite cette erreur. Le cas reste rare grâce au watchdog, et le risque de fausses alarmes est réel.
- cout-risque (2) : Il faut modifier huit adaptateurs et la boucle WS : risque de régression sur le cycle de connexion et de fausses alarmes si l'activité n'inclut pas les heartbeats. Le volet provenance des séries auxiliaires est indépendant et moins risqué.
- coherence (5) : Elle montre sur le graphe la règle « jamais de pane muet » et la provenance effective, toutes deux exigées par le contrat. Le témoin est écrit dans le DOM, hors du state React, ce qui respecte la règle « pas de re-render du canvas ».

### 24. IDEE-33 — Catalogue d'indicateurs : vue « Essentiels » par défaut et familles repliées

**Score 13/20** · valeur 2 · coût-risque 5 · cohérence 4 · effort révisé **S** (initial S) · existe déjà : partiellement · origines : SIM-6

**Problème.** Le menu Indicateurs présente 188 indicateurs (hors 32 stratégies) dans un panneau de 288 px, défaut déjà relevé par la revue du 2026-08-01 (store/indicatorSets.ts:3-7). Il contient 14 moyennes mobiles, 7 estimateurs de volatilité réalisée, 5 jeux de pivots et 4 stochastiques ; seule la catégorie Dérivés a des sous-groupes (IndicatorMenu.tsx:91-160). Les filtres Favoris et Récents partent vides (lib/indicatorMenuFilters.ts). Le sélecteur d'indicateur des alertes est une liste à plat de 163 entrées (AlertsPanel.tsx:94 et 618).

**Proposition retenue après vérification.** Catalogue d'indicateurs replié par défaut, avec un socle en tête et des familles. (1) Une section épinglée en tête, sur le modèle de « Récents » : elle montre les favoris s'il y en a, sinon un socle par défaut d'environ 12 lignes calculables sur bougies seules. Ce socle comprend les six votes d'AXIS (EMA, SuperTrend, ADX/DMI, MACD, RSI, CMF), puis ATR, Bollinger, VWAP, Volume, RVOL et CVD. OI, funding et liquidations n'y figurent que s'ils sont utilisables ici. (2) Les 9 catégories sont repliées par défaut, en changeant l'état initial de collapsed : pas de bascule Essentiels/Complet ni de nouvelle clé de stockage. La recherche et les filtres déplient tout, comme aujourd'hui. (3) groupesAffichage est étendu aux familles : Moyennes mobiles (14), Volatilité réalisée, Points pivots (5), Stochastiques (4). La table est exhaustive et testée sur le patron de SOUS_GROUPES_DERIVES. (4) Dans le sélecteur des alertes, un <optgroup> par catégorie (CATEGORY_LABELS exporté, plus « Stratégies »), fait avec la correction IND-2. Mesures : à l'ouverture, au plus 12 lignes d'indicateurs et 9 titres de catégorie ; la recherche trouve toujours les 188 entrées (test) ; chaque id de famille existe au registre (test) ; les e2e sont adaptés.

**Proposition initiale.** Une vue « Essentiels » par défaut, d'environ 25 lignes : les six votes d'AXIS (EMA, SuperTrend, ADX/DMI, MACD, RSI, CMF), puis ATR, Bollinger, VWAP, Volume, RVOL, OI, funding, CVD, liquidations, MVRV-Z… Un bouton « Catalogue complet (188) » donne le reste, avec des familles repliées sous un titre (« Moyennes mobiles (14) », « Volatilité réalisée (7) », « Points pivots (5) », « Stochastiques (4) »). Les mêmes groupes servent de <optgroup> dans le sélecteur des alertes, où AXIS est en tête (IDEE-11). Rien n'est supprimé, et la recherche couvre toujours tout.

**Réutilise.** IndicatorMenu.tsx (groupesAffichage, patron SOUS_GROUPES_DERIVES), lib/indicatorMenuFilters.ts (filtrerCatalogueIndicateurs), store/indicatorPreferences.ts (favoris, récents), AlertsPanel.tsx.

**À créer.** Liste ESSENTIELS et table FAMILLES, chacune avec son test d'exhaustivité. Bascule « Essentiels / Complet » mémorisée en localStorage (préférence de confort).

**Données.** Disponibles.

**Ce qui existe déjà.** Seule la catégorie Dérivés a des sous-groupes (apps/web/src/components/IndicatorMenu.tsx:91-160, groupesAffichage). Les sections par catégorie sont déjà repliables, mais ouvertes par défaut (IndicatorMenu.tsx:199-200, collapsed = new Set()). Favoris et récents existent (apps/web/src/store/indicatorPreferences.ts:6-7, 64-79), comme le filtre « Utilisables ici » (IndicatorMenu.tsx:497-499). Il y a trois préréglages (apps/web/src/lib/indicatorPresets.ts:15-31 : Polyvalent, Intraday, Swing) et des jeux nommés (apps/web/src/store/indicatorSets.ts). Le sélecteur des alertes est une liste à plat de 163 entrées dont 28 stratégies (AlertsPanel.tsx:94 et 617-622 ; comptage exécuté avec bun sur le registre réel). Les chiffres de l'idée sont confirmés : 188 indicateurs hors stratégies, 14 moyennes mobiles (alma, dema, ema, frama, hma, kama, mcginley, sma, smma, t3, tema, vwma, wma, zlema), 5 pivots et 4 stochastiques (stochastic, stochRsi, smi, kdj). Aucune liste « Essentiels » ni table de familles n'existe (grep vide).

**Contrat.** Aucune décision verrouillée n'est touchée : le catalogue n'est ni étendu ni réduit, et il n'y a ni dépendance ni fenêtre nouvelle. IndicatorMenu est chargé à la demande (Toolbar.tsx:79), comme AlertsPanel : aucun effet sur le budget de chargement initial. L'ordre « Order Flow d'abord » de CATEGORY_ORDER est conservé. Côté alertes, le changement touche le même fichier que IND-2 (sortie des stratégies dans le sélecteur, revue-2026-11-06.md:217) : il faut s'y coordonner.

**Risques.** 1) Mesure de succès irréaliste : le panneau est borné à max-h-[70vh] et partagé avec « Actifs » (20vh) et « Jeux » (26vh) (IndicatorMenu.tsx:374, 405 ; JeuxIndicateurs.tsx:45). Avec environ 32 px par ligne, 25 à 30 lignes ne tiennent pas sans défilement sur un portable. 2) La liste proposée contient OI, funding, liquidations et MVRV-Z, qui exigent une série auxiliaire (aux oi, funding, liqLongUsd ou mvrvZ, vérifié par script). Sur un spot, sans clé Coinalyze ou sous embargo BGeometrics, la vue par défaut montrerait des lignes UNUSABLE grisées. 3) Le HTML n'imbrique pas les <optgroup> : dans les alertes, seules les catégories peuvent servir de groupes, pas les familles. 4) Des e2e cliquent directement dans le catalogue ouvert (« Ajouter Pivot Points Standard », corrections-revue.e2e.ts:127 ; « Ajouter RSI », mobile-indicateurs.e2e.ts:44) : ils sont à adapter. 5) Une bascule Essentiels/Complet ajoute un mode et une clé localStorage, alors que l'état replié par défaut suffit. 6) La liste curée demande une maintenance, que le test d'exhaustivité limite.

**Fichiers à toucher.**

- apps/web/src/components/IndicatorMenu.tsx
- apps/web/src/components/IndicatorMenu.sousGroupes.test.ts
- apps/web/src/lib/indicatorFamilles.ts (nouveau, table FAMILLES + SOCLE)
- apps/web/src/lib/indicatorFamilles.test.ts (nouveau, exhaustivité)
- apps/web/src/components/AlertsPanel.tsx
- apps/web/e2e/corrections-revue.e2e.ts
- apps/web/e2e/quatre-lots-indicateurs.e2e.ts
- apps/web/e2e/mobile-indicateurs.e2e.ts

**Mesure de succès.** La vue par défaut tient en 30 lignes au plus, sans défilement. Chaque id de famille existe au registre (test). Un indicateur reste trouvable par la recherche quel que soit le mode.

**Avis des juges.**

- valeur (2) : Un catalogue replié aide surtout à la découverte. L'utilisateur unique a déjà ses favoris et la recherche.
- cout-risque (5) : Le repli par défaut se fait en changeant l'état initial de collapsed (IndicatorMenu.tsx:200). Les familles reprennent le patron de groupesAffichage, et les <optgroup> sont triviaux. Il n'y a ni calcul ni nouvelle clé, seulement trois e2e à adapter.
- coherence (4) : Elle réduit la friction sans étendre ni réduire le catalogue, sans nouvelle clé de stockage ; effort S. Le socle par défaut s'appuie sur les votes d'AXIS.

### 25. IDEE-7 — Revue hebdomadaire guidée dans EXPY

**Score 12/20** · valeur 3 · coût-risque 3 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : DEC-5

**Problème.** Aucune revue hebdomadaire n'existe (aucune occurrence fonctionnelle de « hebdo » côté journal). La seule revue est la section Session du BRIEF, limitée au jour civil et aux positions PORT (data/brief.ts:283-306 ; BriefWindow.tsx:324-336) : les trades PAPER et EXPY en sont absents. Quand le trade lié à un dossier est clos, rien ne signale que son champ « Revue après trade » (data/decisionDossier.ts:59, DecisionDossiers.tsx:60-66) reste vide. Le journal d'alertes du front ne garde que 100 entrées (store/alerts.ts:30) : les signaux non suivis de la semaine disparaissent sans bilan.

**Proposition retenue après vérification.** Revue de la semaine, construite sur le rapport existant, en deux étapes. Étape 1 (S) : DecisionDossiers marque « revue à faire » tout dossier dont le trade lié est clos et la revue vide, avec un compteur dans l'en-tête d'EXPY. Étape 2 (M) : EXPY gagne une section « Revue de la semaine », bornée à la semaine civile locale. Elle contient : (a) les trades EXPY clos sur la semaine, PAPER compris, filtrés comme dans collecterDonneesRapport ; (b) les dossiers à revoir, éditables sur place ; (c) les alertes de la semaine, via fusionnerAlertesSession étendu à des bornes quelconques et un journal daemon demandé à partir d'une date, marquées « suivie » quand un dossier existe, avec la couverture du journal affichée ; (d) le respect du plan : motif de sortie si IDEE-5 est fait, et clôtures manuelles au-delà du stop. Un bouton exporte le markdown vers NOTE sur le modèle du BRIEF. Le rapport HTML de PORT peut gagner l'option « semaine civile ». La suite mesurée des alertes non suivies reste optionnelle (IDEE-12).

**Proposition initiale.** EXPY gagne un onglet « Revue de la semaine ». Pour la semaine choisie : (1) les trades clos (réels, PAPER, manuels) avec R et PnL ; (2) les dossiers à revoir (trade lié fermé, revue vide), éditables sur place ; (3) les alertes déclenchées, front et daemon, marquées « suivie » quand un dossier existe, les autres avec leur suite mesurée (IDEE-12) ; (4) le respect du plan : sortie au stop, au TP ou à la main, trades pires que −1,2 R, tags PACTE (IDEE-4) et R laissé (IDEE-5). Un bouton « Exporter vers NOTE » produit le markdown, comme le BRIEF. En option, la section Session du BRIEF inclut aussi les clôtures PAPER du jour.

**Réutilise.** data/brief.ts (briefEnMarkdown, debutJourLocalMs), components/brief/sessionAlertes.ts (fusion front + daemon), data/daemon.ts (journalAlertesGet), store/notes.ts (ajouter avec tags), data/expy.ts, data/expyContexte.ts, store/decisionDossiers.ts.

**À créer.** Fonction pure assemblerRevueSemaine(trades, dossiers, journalFront, journalDaemon, bornes) et ses tests. Composant de section. Export markdown.

**Données.** Disponibles localement ; la suite d'une alerte non suivie vient des bougies déjà servies par les adaptateurs, à la demande, ou des résultats d'IDEE-12.

**Ce qui existe déjà.** Un rapport HTML sur 7 ou 30 jours existe déjà, lancé depuis PORT (apps/web/src/data/rapport.ts:1-20 et 283-362 ; components/PortfolioWindow.tsx:221-235). Il couvre les clôtures du portefeuille, les trades EXPY clos sur la période avec leurs statistiques et les clôtures PAPER. La section Session du BRIEF est limitée au jour en cours (data/brief.ts:283-306) mais fusionne déjà les alertes du front et du daemon (components/brief/sessionAlertes.ts:36-60). L'export markdown vers NOTE existe aussi (BriefWindow.tsx:357-362). Les dossiers ont un champ « Revue après trade » (DecisionDossiers.tsx:61-66), mais rien ne signale quand il reste vide.

**Contrat.** Pas de fenêtre nouvelle. EXPY n'a pas d'onglets aujourd'hui : on ajoute une section, ce qui est de la surface et demande une exception G100. Modifier la route /alerts/journal du daemon localhost est permis (BUILD-CONTRACT.md:21). Ni fournisseur ni dépendance nouvelle. Plus riche avec IDEE-5 et IDEE-6, mais fonctionne sans elles.

**Risques.** (1) Les alertes d'une semaine ne sont pas garanties d'être toutes visibles. Le journal du front s'arrête à 100 entrées (store/alerts.ts:30 et 261). La route du daemon ne renvoie que les 200 dernières (apps/daemon/src/alerts.ts:84-85 et 734), alors qu'il en garde 30 jours. Il faut un paramètre de date sur cette route, sinon afficher « couverture partielle ». (2) Les exécutions PAPER sont limitées aux 50 dernières (data/paper.ts:89) : il faut partir des trades EXPY tagués « paper », pas des exécutions. (3) La suite mesurée des alertes non suivies dépend d'IDEE-12, ou d'une requête de bougies par alerte. (4) Le contrôle « pire que −1,2 R » ne repère presque rien tant que PAPER remplit le SL à son niveau (BT-5) : il ne verra que les clôtures manuelles au-delà du stop. (5) Avec deux fenêtres (MFN-5), une revue saisie dans l'une peut être écrasée par l'autre.

**Fichiers à toucher.**

- apps/web/src/components/DecisionDossiers.tsx
- apps/web/src/components/ExpyWindow.tsx
- apps/web/src/data/revueSemaine.ts (nouveau, + test)
- apps/web/src/components/brief/sessionAlertes.ts
- apps/web/src/data/daemon.ts
- apps/daemon/src/alerts.ts
- apps/web/src/data/rapport.ts

**Mesure de succès.** Une revue est exportée dans NOTE chaque semaine. Le nombre de dossiers « trade clos sans revue » tend vers 0.

**Avis des juges.**

- valeur (3) : C'est une bonne habitude de discipline, et l'étape 1 (signaler les revues à faire) ne coûte presque rien. La revue organise surtout ce qui existe déjà et change peu les décisions, sauf si IDEE-5 et IDEE-6 l'enrichissent.
- cout-risque (3) : L'étape 1 (marquer « revue à faire ») est S et sans risque. L'étape 2 touche la route du daemon et la fusion d'alertes sur des bornes quelconques, et ajoute une section éditable sensible au conflit entre deux fenêtres (MFN-5).
- coherence (3) : Utile, mais c'est surtout de la discipline de journal, qui recoupe BRIEF › Session et IDEE-18. Sa valeur dépend de journaux d'alertes dont la couverture est incomplète (100 entrées côté front, 200 lignes côté daemon).

### 26. IDEE-8 — Ouvrir un dossier de décision depuis un setup EQS ou une idée manuelle, avec preuve figée

**Score 12/20** · valeur 3 · coût-risque 2 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : DEC-2

**Problème.** Un dossier ne peut naître que d'une entrée du journal d'alertes du front (AlertsPanel.tsx:1001-1004 ; store/decisionDossiers.ts:106 attend un DeclenchementEnrichi). Une ligne de setup EQS ne propose que le graphe, une alerte à ±2 % et la watchlist (ScreenerWindow.tsx:240-265 et 295-302) ; le détail des signaux (quadrant, z du funding, fiabilité) n'est pas persisté (store/signaux.ts). Pour une idée manuelle, PAPER fabrique une fausse alerte `pacte:${ts}` avec une condition « prix-croise » inventée (PaperWindow.tsx:247-275). Le daemon n'archive aucune preuve au déclenchement, ni prix ni bougie (apps/daemon/src/alerts.ts:317-325) : un dossier tiré d'une alerte de nuit serait partiel.

**Proposition retenue après vérification.** Deux lots séparés. Lot A, côté front (M) : OrigineDecision gagne un champ « outil » (alerte, eqs ou manuel), avec un validateur dédié compatible schemaVersion 1. Un bouton « Dossier » sur chaque ligne de setup EQS fige le symbole, la source Binance spot, le prix, la direction et le score. Pour chaque signal, il fige aussi le libellé, le détail, la fiabilité, le poids et la provenance (spot ou perpétuel). Il appelle capturerLectures(ts) pour que les résultats par contexte d'EXPY couvrent ces trades, et dédoublonne sur le symbole et l'horodatage du scan. Dans PAPER, une origine « manuelle » remplace la fausse alerte `pacte:` et enregistre le prix réellement observé, pas le prix limite. Le dossier garde la direction, et « Préparer dans PAPER » la transmet. Ce lot se fait après IND-1. Lot B, côté daemon (M), plus tard et seulement avec la boîte de réception d'IDEE-18 : une colonne de preuve JSON facultative, ajoutée par un ALTER TABLE tolérant comme dans whales.ts:124. Elle contient la condition, l'unité de temps et le contexte réellement évalué : prix et bougie pour les alertes prix, bougie et composite ; funding et z pour le funding ; liquidations par minute pour les liquidations. contexteDecision est alors partagé via @axiom/alerts.

**Proposition initiale.** Le dossier reçoit une origine typée : alerte du front, alerte du daemon, setup EQS ou saisie manuelle. Un bouton « Dossier » sur chaque ligne de setup EQS fige symbole, prix, direction, score et, pour chaque signal, libellé, détail, fiabilité et poids. Dans PAPER, une origine « manuelle » remplace la condition fictive. Côté daemon, une colonne de preuve facultative (dernier prix et dernière bougie clôturée au déclenchement) rend complets les dossiers créés depuis la boîte de réception (IDEE-18). « Préparer dans PAPER » reprend la direction du signal.

**Réutilise.** data/decisionDossier.ts (projeterPreuveDeclenchement, contexteDecision, derniereBougieConnue), store/decisionDossiers.ts, data/signaux.ts (SignalDetecte, LigneSignaux), apps/daemon/src/alerts.ts (journal SQLite, bougies déjà tenues pour l'évaluation).

**À créer.** Champs optionnels origine.outil et origine.signaux, avec un validateur compatible schemaVersion 1. Bouton dans LigneSetup. Colonne preuve nullable dans alertes_journal (ALTER TABLE). Suppression du contournement « pacte: ».

**Données.** Disponibles : lignes EQS en mémoire au moment du clic, bougies déjà chargées par le daemon.

**Ce qui existe déjà.** Aujourd'hui, un dossier ne naît que du journal d'alertes du front (AlertsPanel.tsx:1001-1004 ; store/decisionDossiers.ts:106-119). Pour une idée manuelle, PAPER fabrique une fausse alerte `pacte:${ts}` avec une condition « prix-croise » inventée (PaperWindow.tsx:247-286). Le brouillon PAPER sait déjà porter une direction (store/paper.ts:68-73 ; PaperWindow.tsx:147-148), mais DecisionDossiers ne la transmet pas (DecisionDossiers.tsx:75). La capture des lectures d'analyse est réutilisable : capturerLectures (store/analyseMultidomaine.ts:28), déjà appelée par alerts/runtime.ts:132. Le daemon a déjà migré une table avec un ALTER TABLE tolérant (apps/daemon/src/whales.ts:124).

**Contrat.** Ni fenêtre ni fournisseur nouveau. Les boutons ajoutés dans EQS et EXPY sont de la surface : exception G100 à demander. Changer le schéma SQLite du daemon localhost est permis (BUILD-CONTRACT.md:21), avec une revue indépendante. Règle « un ancien signal reste partiel » (BUILD-CONTRACT.md:606-607) : les dossiers `pacte:` existants ne sont pas réécrits. Limite de 100 dossiers sans éviction silencieuse (l.611). Provenance verrouillée et prix isolés par source (l.608-609). À faire après IND-1.

**Risques.** (1) Validation : un dossier « complet » doit passer projeterPreuveDeclenchement, qui exige une condition d'alerte valide (store/decisionDossiers.ts:47-48 ; data/decisionDossier.ts:136-144). Sans une branche dédiée à chaque outil, un dossier EQS serait forcé en « partiel » ou rejeté à la relecture. La nouvelle forme doit aussi rester lisible par analyserContextes (expyContexte.ts:75-82). (2) Une preuve figée ne change plus jamais. Figer « haute précision » pour les retournements AXIS avant IND-1 inscrirait un libellé faux dans chaque dossier. (3) La création en un clic fait atteindre plus vite la limite de 100 dossiers (store/decisionDossiers.ts:7). Il faut dédoublonner sur le symbole et l'horodatage du scan. (4) Côté daemon, les alertes funding, liquidations et baleines sont évaluées sans prix (dernierPrix: 0, apps/daemon/src/alerts.ts:501, 523 et 662). contexteDecision vit dans l'application web (data/decisionDossier.ts:173) : il faudrait le déplacer dans @axiom/alerts ou le dupliquer. Surtout, aucun écran ne crée de dossier depuis le journal du daemon : journalAlertesGet n'est lu que par components/brief/SectionSession.tsx:60. Sans IDEE-18, la partie daemon n'aurait aucun utilisateur. (5) Défaut confirmé qui justifie l'idée : le dossier PACTE enregistre comme « dernier prix » le prix limite ou stop estimé, et non le prix observé (PaperWindow.tsx:183-193 et 274). (6) EQS mélange le prix spot Binance avec le funding et l'OI des perpétuels (data/screener.ts:4-10) : il faut figer la source de chaque signal.

**Fichiers à toucher.**

- apps/web/src/data/decisionDossier.ts
- apps/web/src/store/decisionDossiers.ts
- apps/web/src/components/ScreenerWindow.tsx
- apps/web/src/components/PaperWindow.tsx
- apps/web/src/components/DecisionDossiers.tsx
- apps/web/src/data/expyContexte.ts
- apps/web/src/data/decisionDossier.test.ts
- apps/web/src/store/decisionDossiers.test.ts
- (lot B) apps/daemon/src/alerts.ts
- (lot B) packages/alerts/src
- (lot B) apps/web/src/data/daemon.ts

**Mesure de succès.** Plus aucun dossier créé avec un alertId « pacte: ». Un setup EQS devient un dossier en un clic. La part des dossiers « partiels » baisse.

**Avis des juges.**

- valeur (3) : C'est surtout de la traçabilité : elle supprime la fausse alerte `pacte:` et rend les trades issus d'EQS mesurables pour IDEE-6. Le lot daemon n'a aucun utilisateur sans IDEE-18 ; l'effet direct sur les décisions est indirect.
- cout-risque (2) : Étendre OrigineDecision demande de garder lisibles projeterPreuveDeclenchement et analyserContextes : une erreur de validateur rejette des dossiers au rechargement. Le lot B daemon (schéma SQLite, contexteDecision à déplacer) n'a pas d'utilisateur sans IDEE-18.
- coherence (4) : Elle supprime la fausse alerte `pacte:` et rend la preuve du dossier honnête, dans le cadre des règles déjà fixées pour les dossiers. Le lot B (preuve côté daemon) n'aurait aucun utilisateur sans IDEE-18 : il faut le garder en réserve.

### 27. IDEE-26 — SCEN, seule vue de risque du portefeuille, avec des journées de crise réelles

**Score 12/20** · valeur 3 · coût-risque 2 · cohérence 4 · effort révisé **L** (initial M) · existe déjà : partiellement · origines : SIM-5, RSK-8

**Problème.** Le même portefeuille a deux VaR 95 et deux stress-tests. PORT utilise un β contre BTC, un choc linéaire et le seul périmètre crypto-Binance (components/portfolio/SectionRisque.tsx:2-6 et 119-158 ; data/portRisque.ts:165 et 226-282). SCEN utilise des β sur BTC, ETH, DXY, SPX et l'or et inclut PORT et PAPER (ScenWindow.tsx:1-12 ; data/scen.ts:306-370). Les correctifs PRT-4 et PRT-5 sont à faire à deux endroits. Par ailleurs SCEN n'a que des chocs hypothétiques linéaires en β (ScenWindow.tsx:11 ; data/scen.ts:164-168) ; en crise, les alts chutent plus que leur β et les corrélations montent, et aucun épisode réel ne peut être rejoué (grep FTX, covid : rien).

**Proposition retenue après vérification.** Deux lots indépendants. Lot 1 (M, forte valeur, aucune suppression) : préréglages « épisodes réels » dans SCEN (12/03/2020, 19/05/2021, 9-12/05/2022, 8-9/11/2022, 05/08/2024, en close-à-close UTC documenté). Pour chaque position : variation réelle lue sur Binance via l'actif de base, avec contrôle que les bougies reçues tombent bien dans la fenêtre (sinon « estimé β × BTC, probablement minoré »). Affichage : perte en $ du portefeuille actuel, part du notionnel couverte par des données réelles, rapport à la VaR 95, et écart avec le préréglage linéaire « Krach crypto ». Fonction pure appliquerEpisode testée sur bougies figées. Lot 2 (M, décision du propriétaire) : une seule fonction varPortefeuille (clôtures alignées d'abord, donc correction PRT-4 ; n affiché et bougie du jour exclue, donc PRT-5), utilisée par PORT, SCEN et rapport.ts, avec le même périmètre par défaut (simulé exclu, IDEE-1). PORT garde ses contributions et sa courbe, mais calculées par ce code, et reçoit un lien « Ouvrir SCEN ». La grille BTC devient un préréglage SCEN. Le retrait de la section n'a lieu que si le propriétaire le demande, après déplacement des contributions et de la courbe dans SCEN.

**Proposition initiale.** SCEN devient la seule vue de risque. PORT garde une ligne de synthèse (VaR 95 en $, pire choc) calculée par le même code, avec un bouton « Ouvrir SCEN » ; la grille BTC −10/−20/−30 % devient un préréglage SCEN ; le simulé est exclu par défaut (IDEE-1). SCEN gagne des préréglages « épisodes réels » datés (12/03/2020, 19/05/2021, 9-12/05/2022, 8-9/11/2022, 05/08/2024). Pour chaque symbole détenu, SCEN lit la variation réelle sur la fenêtre de l'épisode dans les bougies 1 j de Binance ; si le symbole n'existait pas, il prend BTC × β et marque « estimé ». Il affiche la perte du portefeuille actuel par épisode, la part du notionnel couverte par des données réelles, et la compare à la VaR 95.

**Réutilise.** data/scen.ts (collecterScen, β, PositionBrute, appliquerScenario), data/portRisque.ts (VaR/CVaR, stressGrid), components/portfolio/usePortfolioRisque.ts, ScenWindow.tsx, fetchKlines avec endTime (packages/types/src/index.ts:432).

**À créer.** Préréglage « BTC seul », ligne de synthèse dans PORT, retrait de SectionRisque. Constante des épisodes (dates UTC documentées). Fonction pure testée appliquerEpisode(positions, variationsReelles, betas, variationBtc). Collecte des bougies aux dates des épisodes, avec cache.

**Données.** Historique Binance 1 j public (depuis 2017 pour BTC et ETH, plus court pour les alts récentes, d'où le repli β signalé). Positions tradfi exclues ou traitées en β (cf. PRT-4).

**Ce qui existe déjà.** L'application calcule en fait TROIS VaR de portefeuille et TROIS modèles de stress. (1) PORT : VaR et β BTC, stress linéaire ±10/±20 % (pas −30 %), Binance seul, 91 bougies, positions PORT seules (apps/web/src/data/portRisque.ts:222-237 et 361-388 ; components/portfolio/SectionRisque.tsx:119-158). (2) SCEN à 1 facteur : PORT + PAPER, adaptateur de chaque source, 260 bougies ramenées à 90 jours (apps/web/src/data/scen.ts:320-377), préréglages hypothétiques (scen.ts:164-168). (3) SCEN multifacteur : régression OLS conjointe sur 90, 180 ou 365 jours (apps/web/src/components/scen/ScenMultifactorPanel.tsx, data/scenMultifactor.ts, data/scenMultifactorLoader.ts), elle aussi linéaire. Le rapport mensuel recalcule une 3e VaR via portRisque (apps/web/src/data/rapport.ts:317-330). Aucun épisode réel : les grep FTX, covid, LUNA et episode ne trouvent rien dans scen. Disponible : fetchKlines avec endTime (packages/types/src/index.ts:432), géré par Binance (data/binance.ts:260) et déjà utilisé pour des fenêtres datées (components/EvtsWindow.tsx:166, components/globe/TransmissionPanel.tsx:47).

**Contrat.** Aucune fenêtre ni fournisseur : Binance et l'historique 1 j existent déjà. Retirer la section Risque de PORT est une décision du propriétaire. Il faut aussi trancher le périmètre : PORT seul, ou PORT + PAPER comme SCEN aujourd'hui (ScenWindow.tsx:94-110). Sans ce choix, la mesure « une VaR identique dans PORT et SCEN » est impossible. Fonctionnalité de surface : demande explicite au titre du gel G100.

**Risques.** (1) La section Risque de PORT ne fait pas que la VaR : elle montre aussi le tableau des contributions, les β BTC et la courbe P&L de la composition sur 90 jours (SectionRisque.tsx:91-151). SCEN n'a rien de cela, donc la « retirer » ferait perdre ces trois vues si on ne les déplace pas. (2) L'unification doit aussi couvrir rapport.ts, troisième consommateur (et PRT-10). (3) Épisodes : Kraken ignore endTime (data/kraken.ts:16-17 et 175) et renverrait des bougies récentes ; il faut donc relire les dates des bougies reçues, ou passer par Binance via l'actif de base, sinon on obtient une variation fausse sans le voir. Hyperliquid ne couvre pas 2020-2022. (4) Le repli « BTC × β » sous-estime justement la perte des alts en crise, ce que l'idée veut montrer : il faut l'étiqueter « estimé, probablement minoré ». (5) Les dates de chaque épisode doivent être fixées en close-à-close UTC (veille du début → fin) et testées. (6) Coût réseau modeste (≈ 1 requête par symbole et par épisode). Le cache est immuable mais doit rester petit vu DATA-3 (localStorage sans budget). (7) Ensemble, c'est L ; séparé, chaque volet est M.

**Fichiers à toucher.**

- apps/web/src/data/scenEpisodes.ts (nouveau : constante d'épisodes datés UTC + appliquerEpisode pur)
- apps/web/src/data/scenEpisodes.test.ts (nouveau)
- apps/web/src/data/scen.ts (préréglage BTC seul, VaR sur clôtures alignées = PRT-4)
- apps/web/src/data/portRisque.ts (une seule fonction VaR du portefeuille)
- apps/web/src/components/ScenWindow.tsx
- apps/web/src/components/portfolio/SectionRisque.tsx
- apps/web/src/components/portfolio/usePortfolioRisque.ts
- apps/web/src/components/PortfolioWindow.tsx
- apps/web/src/data/rapport.ts (même VaR que PORT et SCEN)

**Mesure de succès.** Une seule VaR 95 du portefeuille dans l'application, identique dans PORT et SCEN (test). Sur bougies figées : variation exacte par symbole, repli β marqué « estimé », couverture réelle affichée. L'opérateur voit l'écart entre le choc linéaire « Krach crypto » et l'épisode réel le plus proche sur sa composition.

**Avis des juges.**

- valeur (3) : Rejouer les vraies journées de crise montre la perte réelle des alts au-delà de leur β, ce qui est concret et parlant. L'unification de la VaR (lot 2) relève surtout de la maintenance.
- cout-risque (2) : Le lot 1 (épisodes réels) est M mais fragile : Kraken ignore endTime et Hyperliquid n'a pas d'historique, donc chaque date de bougie reçue doit être contrôlée. Le lot 2 unifie trois consommateurs de VaR et relève d'une décision du propriétaire.
- coherence (4) : Une seule fonction de VaR supprime une vraie dispersion (deux VaR pour un même portefeuille). Les épisodes de crise réels sont plus honnêtes que des chocs linéaires. Retirer quoi que ce soit de PORT reste une décision du propriétaire.

### 28. IDEE-31 — Un seul catalogue de setups, avec AXIS 4h en premier et dès l'accueil

**Score 12/20** · valeur 2 · coût-risque 4 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : SIM-3, ERG-6

**Problème.** Quatre notions se recouvrent pour appliquer une configuration toute prête : 8 playbooks (data/playbooks.ts:182-234), 4 presets métiers rangés dans le menu Workspaces (store/workspaces.ts:396-440 ; Toolbar.tsx:536-555), 3 presets d'analyse (lib/indicatorPresets.ts:15-31), plus les jeux et les workspaces. Il y a des doublons (« Desk Flux & Dérivés » recoupe PLAY-SCALP et PLAY-LIQ, « Macro & Souveraineté » recoupe PLAY-FOMC), et les presets métiers forcent Binance, ferment toutes les fenêtres et créent un workspace à chaque clic (store/workspaces.ts:457, 464 et 475). Aucun de ces réglages ne pose AXIS, seule stratégie validée. L'accueil applique même PLAY-SCALP en 1m (store/onboarding.ts:4 et 196-200), alors que les signaux perdent après frais de 1s à 30m et que seul le 4h est validé (README.md:187-191).

**Proposition retenue après vérification.** Deux étapes. (A) Taille S, sans décision lourde. Nouveau playbook « PLAY-AXIS — Swing AXIS 4h (seule unité testée favorable) ». Il pose BTCUSDT en 4h, ajoute stratAxis aux défauts s'il est absent, et propose (sans créer d'office) une alerte indicateur-seuil stratAxis.etat >= 1 avec timeframe "4h". Comme pour PLAY-CVD, un doublon est évité. Le texte dit que l'alerte n'est surveillée que si BTC 4h est affiché ou si le daemon tourne. La commande PLAY générique et la première étape de l'accueil proposent PLAY-AXIS en premier ; le scalp reste au choix. Le bouton « Ouvrir BT sur AXIS » (import dynamique puis loadPreset("builtin:axis")) n'arrive qu'après la correction de BT-1. (B) À décider avec MNT-1. Les quatre presets métiers deviennent des playbooks (avec un groupe de couleur optionnel). Ils gardent la source de l'actif courant et demandent confirmation avant de fermer les fenêtres. Ils n'enregistrent plus de workspace à chaque clic. Les deux doublons sont fusionnés : « Desk Flux & Dérivés » avec PLAY-SCALP, « Macro & Souveraineté » avec PLAY-FOMC. Les presets d'analyse ne changent pas. Tests : AXIS 4h et l'alerte 4h sont posés en un clic ; deux playbooks n'ouvrent jamais le même ensemble de fenêtres à la même unité.

**Proposition initiale.** Deux notions seulement : les « Espaces » (instantanés de l'utilisateur, menu Workspaces) et les « Setups » figés (menu Playbooks, mnémoniques PLAY-*). Les presets métiers deviennent des setups (avec leur groupe de couleur), gardent la source de l'actif courant et demandent confirmation avant de fermer des fenêtres ; les doublons sont fusionnés (environ 9 setups au lieu de 15) et les presets d'analyse sans preuve sont retirés. Un nouveau setup prend la tête : « PLAY-AXIS — Swing AXIS 4h (validé) ». Il pose BTCUSDT en 4h avec AXIS aux défauts, propose d'armer l'alerte État ≥ 1 comme PLAY-CVD le fait pour sa divergence (data/playbooks.ts:98-125), et ouvre BT sur l'opérande AXIS. L'accueil le propose en premier ; le scalp reste au choix.

**Réutilise.** PLAYBOOKS et ses fonctions apply*, appliquerPresetMetier (store/workspaces.ts), alertsStore.ajouter, opérande axisEtat (store/backtest.ts:327-332), OnboardingOverlay et store/onboarding.ts, commandes PLAY*.

**À créer.** Fusion des catalogues dans data/playbooks.ts (type Setup avec groupe de couleur optionnel). applyAxis4h. Retrait des presets d'analyse et de la section « Presets métiers » du menu Workspaces. Nouvelle première étape de l'accueil. Test anti-doublon.

**Données.** Disponibles.

**Ce qui existe déjà.** Le backtest a déjà un preset AXIS 4h, « builtin:axis » (apps/web/src/store/backtest.ts:528-539), que l'on charge par loadPreset (backtest.ts:756-768). La sortie etat d'AXIS existe déjà et déclenche bien les alertes : la revue mesure stratAxis.etat >= 1 à 3 entrées pour 3 déclenchements (docs/revue-2026-11-06.md:221). PLAY-AXIS ne dépend donc PAS d'IND-2. En dehors de BT et d'InstanceParamsEditor, aucun playbook, preset ou étape d'accueil n'utilise AXIS (grep stratAxis dans apps/web/src). La commande générique PLAY applique le scalp 1m (data/playbooks.ts:283-284), et l'accueil aussi (store/onboarding.ts:4 et 196-200 ; OnboardingOverlay.tsx:160-169). Les presets métiers forcent Binance, ferment tout et enregistrent un workspace (workspaces.ts:457, 464 et 475). Ils viennent du lot du 14/10, non revu (commit 2e9947e, MNT-1).

**Contrat.** Aucune fenêtre, aucun fournisseur, aucun indicateur. Le changement de l'accueil et le sort des presets métiers relèvent du propriétaire ; ces presets dépendent en plus de la revue a posteriori du 14/10 (MNT-1). L'ouverture de BT depuis le setup dépend de BT-1 (AXIS calculé sans amorce dans BT).

**Risques.** (1) L'alerte doit porter timeframe: "4h" explicitement. Le front n'évalue une alerte d'indicateur que si le graphe affiche ce symbole ET cette unité, et une def sans unité s'évalue sur l'unité affichée, quelle qu'elle soit (alerts/runtime.ts:9-13 et 314). Sur Vercel, sans daemon, l'alerte devient muette dès qu'on quitte BTC 4h : il faut le dire dans le setup (lien avec IDEE-17). (2) BT : store/backtest doit rester hors du chargement initial (chargementInitial.test.ts:27). Il faut donc un import dynamique suivi de loadPreset("builtin:axis"), comme la commande SIG (windowPanels.ts:780-797). Et tant que BT-1 n'est pas corrigé, BT montre des trades AXIS différents de ceux du graphe (36 fenêtres sur 40) : ouvrir BT depuis un setup « validé » serait trompeur. (3) Le mot « validé » doit reprendre la formule du README (4h seulement, mesure passée et non promesse : README.md:187-191). (4) Retirer les presets d'analyse est hors sujet : ce sont des jeux d'indicateurs cumulables et annulables (JeuxIndicateurs.tsx:49), aux explications honnêtes, sans agencement. Le compte « 9 au lieu de 15 » est faux : 8 + 4 − 2 fusions + AXIS donnent 11. (5) Les presets forcent Binance avec le symbole courant : sur SPY, setMarket(binance, SPY) casse le graphe. (6) Deux tests figent l'existant : playbooks.test.ts:51-53 attend 8 playbooks et workspaces.test.ts:399-400 attend au moins 4 presets.

**Fichiers à toucher.**

- apps/web/src/data/playbooks.ts
- apps/web/src/data/playbooks.test.ts
- apps/web/src/store/onboarding.ts
- apps/web/src/components/OnboardingOverlay.tsx
- apps/web/src/store/workspaces.ts
- apps/web/src/store/workspaces.test.ts
- apps/web/src/components/Toolbar.tsx

**Mesure de succès.** Deux notions de configuration au lieu de cinq. AXIS 4h actif avec son alerte armée en un clic. Test : deux setups n'ouvrent jamais le même ensemble de fenêtres au même TF.

**Avis des juges.**

- valeur (2) : Pour un utilisateur unique qui connaît déjà AXIS, l'accueil ne sert qu'une fois et le playbook AXIS économise quelques clics. La consolidation des presets relève du ménage.
- cout-risque (4) : L'étape A est S : un playbook de plus, sur le patron d'applyCvdEdge (data/playbooks.ts), avec une alerte 4h dédoublonnée. Il faut ajuster le test qui attend 8 playbooks. L'étape B (fusion des presets métiers) relève d'une décision et reste à part.
- coherence (4) : Mettre la seule stratégie validée en tête et fusionner les presets en double va dans le sens du produit. Mais l'accueil en mode Scalp porte sur l'orderflow, pas sur les signaux AXIS, et la partie B relève du propriétaire (MNT-1).

### 29. IDEE-28 — DATA dit ce qu'une panne coupe vraiment et quand un quota va tomber

**Score 11/20** · valeur 2 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : non · origines : TRA-4, TRA-9

**Problème.** La pastille du bandeau passe au rouge pour n'importe quelle source en erreur (HealthPanel.tsx:103-110 ; SessionStrip.tsx:66-67 et 117-126) : une erreur NBS colore le bandeau pendant qu'on trade BTC, et l'opérateur apprend à ignorer le rouge. DATA montre état, âge, quota et erreur (DataWindow.tsx:106-121) mais pas ce qui en dépend : pour Coinalyze, la table ne cite que DES (data/dataActions.ts:66), alors que la même clé nourrit OI, funding et liquidations du graphe (auxProvider.ts:418-448). Une source sondée n'est jamais dégradée selon son âge. Les quotas ne montrent que la part consommée, rouge au-delà de 80 % (DataWindow.tsx:52-71) : un graphe tradfi sondé à 60 s consomme 1 crédit par minute sur 800 par jour (twelvedata.ts:70 et 77-97), donc s'arrête net après environ 13 h ; idem BGeometrics (15 appels par jour, bgeometrics.ts:265) et CryptoQuant (store/health.ts:41-46).

**Proposition retenue après vérification.** Trois pas. (1) Pastille prudente, sans graphe de dépendances. Chaque source publie derniereTentativeTs et cadenceMs. Une source en erreur sans tentative depuis plus de 10 min, ou sans tentative depuis la fermeture de sa fenêtre, passe en gris « arrière-plan » et ne colore plus le bandeau. Une source sondée en retard de plus de 3 cadences compte comme dégradée, ce qui couvre aussi DATA-4. Une source inconnue compte toujours. (2) Quotas. BarreQuota se colore sur le segment le plus contraint (minute, jour ou crédits). Une projection pure projectionQuota(historique, quota, maintenant) ne s'applique qu'aux budgets journaliers et mensuels, chacun sur une fenêtre adaptée : dernière heure pour Twelve Data, 7 jours pour CryptoQuant, « n requêtes restantes ; ouvrir CHAIN en coûte 5 » pour BGeometrics. Avertissement ambre si l'épuisement arrive avant la remise à zéro. Test : 540/800 à 09:00, à un par minute, donne 13:20. Corriger en même temps la cause : le graphe Twelve Data respecte les heures de marché comme souscrireJambeTwelveData (twelvedata.ts:635-652), avec une cadence alignée sur le différé. (3) Ensuite seulement, la ligne « alimente : graphe 1 (OI, Funding), DES, n alertes ». Elle repose sur une table pure série/fenêtre → clé santé, vérifiée par un test structurel sur toutes les AuxSeriesId, et sert à l'affichage et à la liste « fermer pour tenir », pas à éteindre la pastille.

**Proposition initiale.** Chaque ligne de DATA et de « Santé sources » indique ce qu'elle alimente parmi les usages actifs (« graphe 1 (OI, Funding), DES, 2 alertes, BRIEF »), cliquable. La pastille globale ne passe ambre ou rouge que si une source dégradée alimente quelque chose d'actif ; les autres restent listées en gris « arrière-plan ». Une source sondée avec plus de 3 cadences de retard compte comme dégradée. Pour chaque source à quota : « au rythme de la dernière heure : épuisé vers 15:20 UTC · reprise à 00:00 UTC », avec un avertissement ambre si l'épuisement arrive avant la remise à zéro, relayé par le témoin du graphe concerné (IDEE-27), et la liste des usages à fermer pour tenir.

**Réutilise.** store/health.ts (QuotaSource l.30-47), HealthPanel.tsx (degradedLevel), data/dataCockpit.ts (trierSources, formatFraicheur), data/dataActions.ts, chart/auxProvider.ts, IndicatorDef.aux, store/windowManager.ts (fenêtres ouvertes), store/alerts.ts, couvertureAlerte (IDEE-17), compteurs de twelvedata.ts, bgeometrics.ts, cryptoquant.ts et coinalyze.ts, BarreQuota de DataWindow.tsx.

**À créer.** Table pure série auxiliaire → clé santé. Fonction pure consommateursActifs(sources, fenêtres, indicateurs, alertes). niveauPondere à la place de degradedLevel dans SessionStrip. Court historique des consommations par source et fonction pure projectionQuota(historique, quota, maintenant). Libellés dans DATA et Santé.

**Données.** Disponibles en mémoire ; les compteurs de quota sont déjà incrémentés à chaque appel.

**Ce qui existe déjà.** degradedLevel colore le bandeau dès qu'UNE source est en erreur, quelle qu'elle soit (apps/web/src/components/HealthPanel.tsx:103-110 ; SessionStrip.tsx:50 et 113-126). healthStore.retirer n'est appelé nulle part (grep), donc l'erreur d'une source dont la fenêtre est fermée (macro:nbs, etc.) garde le bandeau rouge sans limite de temps. La table d'actions de DATA ne relie Coinalyze qu'à DES (apps/web/src/data/dataActions.ts:66), alors que la même clé nourrit OI, funding et liquidations du graphe (chart/auxProvider.ts:417-452). Une source sondée reste « polling » quel que soit son âge (pollLoop ; voir aussi DATA-4). BarreQuota ne regarde que la fenêtre principale (DataWindow.tsx:47-71) : pour Twelve Data, c'est 8 par minute, et le plafond de 800 par jour n'est jamais coloré. Constat mesuré dans le code : twelveDataAdapter.subscribeKline sonde toutes les 60 s sans tenir compte des heures de marché (data/twelvedata.ts:70 et 662-665), soit 1 440 crédits par jour pour un seul graphe, onglet masqué compris (pollLoop.ts:30-35). souscrireJambeTwelveData, lui, respecte les heures (twelvedata.ts:635-652). La revue du 6/11 ne relève pas ce défaut. Aucune projection de quota ni liste de consommateurs n'existe (les grep « alimente », « consommateur » et « épuisé vers » ne trouvent rien).

**Contrat.** Aucune décision verrouillée touchée. SanteSource vit dans apps/web (store/health.ts), pas dans @axiom/types : on peut lui ajouter des champs. Pas de fenêtre ni de fournisseur. Le lien avec IDEE-17 (couvertureAlerte) et IDEE-27 n'existe pas encore (grep) : il faut le traiter comme facultatif.

**Risques.** (1) Faux vert : une pastille pondérée par une table de consommateurs incomplète peut cacher une vraie panne. Il existe des consommateurs de fond : poller du régime au démarrage, macroHistory, alertes évaluées sur ticker et sur poll (pollLoop.ts:23-35), BRIEF. Pour un opérateur qui engage de l'argent réel, un faux vert coûte plus qu'un faux rouge. La règle doit donc être prudente : une source inconnue de la table compte. (2) La table manuelle série → clé (coinalyze OU binance:futures selon la clé, repli) dérivera à chaque nouveauté : il faut un test structurel sur toutes les AuxSeriesId. (3) Projection : « au rythme de la dernière heure » n'a de sens que pour un budget journalier régulier (Twelve Data). BGeometrics (15 par jour) se consomme par paquets (5 requêtes à l'ouverture de CHAIN). CryptoQuant compte des crédits sur 31 jours glissants (store/health.ts:39-46). Coinalyze (40 par minute) est un limiteur avec file d'attente, pas un budget. Les compteurs sont ceux de CE navigateur : sur Vercel, la clé serveur est partagée (BUILD-CONTRACT.md:72), donc la projection reste indicative. (4) La cause principale de l'épuisement Twelve Data est le sondage de 60 s sans heures de marché. L'afficher sans le corriger soigne le symptôme.

**Fichiers à toucher.**

- apps/web/src/store/health.ts (derniereTentativeTs, cadenceMs, court historique des consommations)
- apps/web/src/data/pollLoop.ts (tentative et cadence publiées)
- apps/web/src/components/HealthPanel.tsx (niveauPondere à la place de degradedLevel)
- apps/web/src/components/SessionStrip.tsx
- apps/web/src/components/DataWindow.tsx (BarreQuota sur le segment le plus contraint, projection, ligne « alimente »)
- apps/web/src/data/dataCockpit.ts
- apps/web/src/data/dataActions.ts
- apps/web/src/data/consommateursSources.ts (nouveau, pur : série auxiliaire → clé santé, consommateursActifs) + test
- apps/web/src/data/projectionQuota.ts (nouveau, pur) + test
- apps/web/src/data/twelvedata.ts, data/onchain/bgeometrics.ts, data/onchain/cryptoquant.ts, data/coinalyze.ts (horodatage des consommations)

**Mesure de succès.** Tests : macro:nbs en erreur sans RATE ouvert → bandeau vert, ligne grise ; coinalyze en erreur avec un pane OI → rouge et « alimente : graphe 1 (OI) » ; 540 crédits utilisés à 09:00 au rythme d'un par minute → épuisement annoncé à 13:20. L'heure annoncée concorde à ±15 min avec l'épuisement réel. Moins de rouges sans conséquence sur une semaine.

**Avis des juges.**

- valeur (2) : Cela soigne la fatigue de la pastille rouge et prévient l'épuisement du quota Twelve Data. C'est de l'observabilité utile, mais avec peu d'effet sur les décisions de trading crypto.
- cout-risque (3) : La pastille prudente et projectionQuota sont pures et testables, et le correctif des heures de marché Twelve Data est ciblé. Mal réglée, la nouvelle règle de pastille peut donner un faux vert, et la table de dépendances demande de l'entretien.
- coherence (4) : Elle rend la pastille de santé signifiante et traite la cause de l'épuisement Twelve Data, piste « couper le polling tradfi marché fermé » de la roadmap 0.3 jamais faite. Il faut garder la règle prudente pour éviter un faux vert.

### 30. IDEE-30 — Workspaces complets et changement de workspace d'une seule touche

**Score 11/20** · valeur 2 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : ERG-6

**Problème.** Un workspace ne restaure pas tout le contexte : l'instantané (store/workspaces.ts:83-106) ignore la grille multi-graphes et ses graphes secondaires (sauvegardés à part : store/chart-layout.ts:94 et 275), ainsi que les sous-panes OI/funding et les couches de liquidations, que les playbooks traitent pourtant comme du contexte (data/playbooks.ts:78, 91, 128 et 173). Changer de workspace passe par le menu WS de la barre d'outils ; la palette n'a que « Enregistrer sous », BACKUP et RESTORE (components/Toolbar.tsx:191-219). Mettre à jour le workspace courant oblige à retaper son nom exact (Toolbar.tsx:162-168).

**Proposition retenue après vérification.** (1) L'instantané de workspace ajoute trois champs optionnels : la grille (layout, slots, linked, sync*, lus depuis chartLayoutStore), les couches (exactement l'objet de persist.currentSession plus oi et funding de derivativesChartStore) et groupSymbols. L'application réutilise la validation de hydrateSession. Un champ absent, venant d'une ancienne sauvegarde, laisse l'état courant intact. (2) Une commande ⌘K « WS <nom> » par workspace, construite à l'ouverture de la palette comme les JEU, avec un mnémonique unique testé. (3) « Mettre à jour <nom courant> » en un clic dans le menu WS et dans la palette, sans retaper le nom. Pas de raccourci ⌥ + chiffre : l'historique de la palette suffit. À livrer après MFN-5 et DATA-3. Test : on enregistre une grille 2×2 avec le funding et NIVCLE affichés, on change de workspace puis on revient, et l'on retrouve la même grille, les quatre mêmes actifs, les mêmes sous-panes et les mêmes couches.

**Proposition initiale.** (1) L'instantané inclut la grille (mode, graphes secondaires, synchronisations) et les couches du graphe (OI/funding, liquidations, niveaux). (2) Une commande ⌘K par workspace (« WS MACRO »), sur le modèle des jeux d'indicateurs « JEU … », avec ⌥1 à ⌥9 pour les neuf premiers. (3) « Mettre à jour X » en un clic.

**Réutilise.** workspacesStore (snapshot, applyContent, validateContent), chartLayoutStore et ses slots, derivativesChartStore, liqMarksStore et liqEstStore, niveauxOverlaysStore, modèle des commandes dynamiques JEU (commands/registry.ts:443-455), gererRaccourciGlobal (commands/hotkeys.ts ; ⌥ n'y sert qu'avec les flèches).

**À créer.** Champs optionnels chartLayout et couches dans WorkspaceContent, avec repli sûr pour les anciennes sauvegardes. Commandes dynamiques et raccourcis ⌥ + chiffre. Tests de restauration complète.

**Données.** Aucune.

**Ce qui existe déjà.** L'instantané de workspace (apps/web/src/store/workspaces.ts:83-106) couvre le marché, les indicateurs, OF/VP/Revenus, la comparaison, les overlays macro, le thème, les sections, l'échelle et les fenêtres. Il oublie : la grille (store/chart-layout.ts, clé propre l.94), les sous-panes OI/funding (store/derivatives-chart.ts:11, « session-only » voulu), les couches de liquidations, les niveaux et l'overlay DIST, ainsi que groupSymbols (windowManager.ts:455), qui n'est ni persisté ni pris dans l'instantané. Or persist.ts:410-470 (currentSession / hydrateSession) capture et valide DÉJÀ tous ces drapeaux de couches. La palette n'a que WS (enregistrer), BACKUP et RESTORE (Toolbar.tsx:191-219). On n'applique un workspace que par le menu (Toolbar.tsx:503). Pour mettre à jour le workspace courant, il faut retaper son nom exact, car saveAs écrase par nom (workspaces.ts:323-341). Les commandes dynamiques ont déjà un modèle : JEU (registry.ts:443-455).

**Contrat.** Aucune fenêtre, aucun fournisseur. Ce chantier dépend du lot C (MFN-5 : une autre fenêtre écrase le workspace ; DATA-3 : échec silencieux quand le localStorage est plein). À livrer après ces correctifs ou avec eux.

**Risques.** (1) Il y aurait deux copies de la logique « couches » si l'on recode la capture dans workspaces.ts : il faut exporter et réutiliser currentSession et la validation de hydrateSession (persist.ts). (2) ⌥ + chiffre est à abandonner. Sous Linux, Chrome prend Alt+1 à 8 pour changer d'onglet. Sous macOS, ⌥ + chiffre produit un caractère, il faudrait lire e.code. Les chiffres servent déjà aux unités de temps (hotkeys.ts:153, 194-202). Enfin, la branche ⌥ ne traite que les flèches et rend la main sinon (hotkeys.ts:277-284). (3) Les anciennes sauvegardes n'ont pas ces champs. Le repli sûr doit être « ne rien changer » et non « tout éteindre », sinon revenir à un ancien workspace effacerait la grille courante. (4) Restaurer OI/funding relance des appels Coinalyze (quota de 40 req/min). C'est acceptable parce que l'utilisateur le déclenche, mais il ne faut pas le faire au démarrage : c'est la raison du « session-only ». (5) Les noms de workspace sont libres (accents, doublons après normalisation) : le mnémonique « WS <NOM> » doit rester unique, et le test d'unicité existant doit le couvrir. (6) Les couches chargées à la demande (MARKS, WHALE, BOOK) sont éphémères par conception : il faut les exclure.

**Fichiers à toucher.**

- apps/web/src/store/workspaces.ts
- apps/web/src/store/persist.ts
- apps/web/src/store/chart-layout.ts
- apps/web/src/store/windowManager.ts
- apps/web/src/commands/registry.ts
- apps/web/src/components/Toolbar.tsx
- apps/web/src/store/workspaces.test.ts
- apps/web/src/store/persist.test.ts

**Mesure de succès.** Test : enregistrer un workspace en grille 2×2 avec le funding affiché, en changer puis y revenir → même grille, mêmes quatre actifs, mêmes sous-panes. À l'usage : un changement de contexte coûte une touche ou une commande au lieu de 3 à 6 clics.

**Avis des juges.**

- valeur (2) : Restaurer la grille et les couches en changeant de workspace est un confort ergonomique. Le gain est réel mais ponctuel.
- cout-risque (3) : Le travail réutilise currentSession et hydrateSession, mais un mauvais repli quand un champ manque effacerait la grille de l'utilisateur. Il dépend de MFN-5 et DATA-3 et peut relancer des appels Coinalyze.
- coherence (4) : Elle prolonge la roadmap 1.5 en réutilisant persist et hydrateSession, sans surface nouvelle. Elle dépend du lot C (MFN-5, DATA-3).

### 31. IDEE-32 — Menu « Couches » : tout ce qui se dessine sur le graphe, au même endroit

**Score 11/20** · valeur 2 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : non · origines : SIM-4

**Problème.** Une vingtaine de couches du graphe s'activent depuis sept endroits : 4 boutons de la barre d'outils (OF, VP, LIQ, REV ; Toolbar.tsx:619-625), DES pour l'OI et le funding (DerivativesWindow.tsx:240-243), LIQ pour les niveaux estimés et Hyperliquid (LiquidationsWindow.tsx:183-306), DIST pour les bandes (DistWindow.tsx:89), les réglages footprint, l'onglet Macro du menu Indicateurs et CHAIN. Cinq couches ne s'activent qu'en tapant leur mnémonique dans ⌘K : NIVCLE, OPTNIV, MARKS, WHALE et BOOK (chart/niveauxOverlays.ts:113-160 ; commands/windowPanels.ts:733-800). Aucun endroit ne liste ce qui est actif : on lit un graphe chargé de couches oubliées, ou on ignore qu'un niveau d'options existe.

**Proposition retenue après vérification.** Un menu « Couches (n) », chargé à la demande, dans la barre d'outils et dans la feuille Options sur mobile. Les couches sont groupées par thème : Prix & niveaux, Flux, Liquidations, Dérivés, Options, Macro, Annotations. Le menu est généré depuis une table COUCHES qui donne l'id de la commande déjà déclarée, le groupe, une fonction qui lit l'état réel et la raison d'indisponibilité selon la source (les mêmes règles que la barre d'outils). Un test d'exhaustivité vérifie que chaque commande de couche du registre y figure. Chaque ligne porte sa pastille metaSource quand elle existe. « Tout désactiver » est suivi d'un toast Annuler et ne touche ni aux alertes ni aux dessins. Pour MARKS et WHALE, on extrait des stores de bascule légers, sur le modèle de depthHeatBascule. Le menu remplace les boutons Profil Vol, Liq et Revenus, dont les touches V, L et R restent. Orderflow reste un bouton, avec son clic droit Footprint et l'e2e existant. Les fenêtres gardent leurs réglages fins. Les couches d'alerte (IDEE-22) ne sont ajoutées que lorsqu'elles existent. Il faut une exception explicite au G100.

**Proposition initiale.** Un menu « Couches (n) » dans la barre d'outils, groupé par thème : Prix & niveaux, Flux, Liquidations, Dérivés, Options, Macro, Annotations (dont les alertes d'IDEE-22). Chaque ligne est cochée selon l'état réel et porte sa note de fiabilité ; un bouton « Tout désactiver » complète le menu. Il est généré depuis les commandes déjà déclarées et remplace les 4 boutons OF, VP, LIQ et REV, dont les raccourcis clavier sont conservés. Les fenêtres gardent leurs réglages fins.

**Réutilise.** Commandes existantes (commandesNiveauxOverlays, MARKS/WHALE/BOOK de windowPanels.ts, LIQ* de liquidationMarkers.ts et liquidationEstimates.ts, OI/FRATE de store/derivatives-chart.ts), stores orderflowStore, volumeProfileStore, liqMarksStore, liqEstStore, niveauxOverlaysStore, derivativesChartStore, macroOverlayStore, composants MenuDeroulant et BadgeFiabilite (ui.tsx).

**À créer.** Table COUCHES (id de commande, groupe, lecture de l'état) avec test d'exhaustivité. Composant CouchesMenu. Lecture d'état sans import pour MARKS, WHALE et BOOK, chargés au premier usage (commands/chargementDifferes.test.ts), qui valent « inactif » tant qu'ils ne sont pas chargés.

**Données.** Disponibles.

**Ce qui existe déjà.** Aucun menu ne regroupe les couches (aucun résultat pour « Couches », « tout désactiver » ou « CouchesMenu »). Les couches s'activent depuis plusieurs endroits. Barre d'outils : Orderflow, Profil Vol, Liq et Revenus (apps/web/src/components/Toolbar.tsx:781-892). DES pour OI et funding (DerivativesWindow.tsx:240-243). DIST pour les bandes VaR et les bandes implicites (DistWindow.tsx:88-89, 172 et 180). CHAIN pour la ligne Strategy (onchain/TresoreriesBtc.tsx:153 et 174). Certaines ne s'activent QUE dans la palette, car aucun composant ne les bascule : NIVCLE, NIVCLE-J/S/M/T et OPTNIV (chart/niveauxOverlays.ts:113-140), ainsi que MARKS, WHALE et BOOK (commands/windowPanels.ts:716-800). L'état de presque toutes ces couches est déjà rassemblé dans persist.currentSession (store/persist.ts:450-470). Le catalogue de fiabilité existe aussi (lib/fiabilite.ts:32 et 156 : metaSource, avec par exemple coinalyze:oi).

**Contrat.** Aucune fenêtre ni fournisseur. C'est quand même une surface nouvelle de barre d'outils : il faut une exception explicite du propriétaire au gel G100 (voir MNT-4). Le budget d'entrée est de 360 000 octets gzip (chargementInitial.test.ts:2-3), et il est déjà serré (niveauxOverlays.ts:111) : le menu doit se charger à la demande, comme IndicateursLazy.

**Risques.** (1) MARKS et WHALE ont leur store dans des modules chargés à la demande, qui démarrent leur contrôleur à l'import (windowPanels.ts:744-746). Pour lire leur état sans les importer, il faut extraire de petits stores de bascule sur le modèle de chart/depthHeatBascule.ts:21. « Inactif tant que le module n'est pas chargé » est juste, puisque ces couches ne sont pas persistées (whaleBubbles.ts:151, tradeMarkers.ts:212). (2) Retirer les quatre boutons ferait perdre trois choses : l'état visible d'un coup d'œil (aria-pressed), la désactivation selon la source (noTradeStream, isSynthetic, isTradfi : Toolbar.tsx:659-666) et l'accès aux réglages Footprint par clic droit sur Orderflow (Toolbar.tsx:786-795). En plus, l'e2e cible le bouton Orderflow (e2e/quatre-lots-indicateurs.e2e.ts:114 et 200). (3) Les couches de niveaux ne s'appliquent qu'au graphe maître : en grille, le menu doit le dire. (4) « Tout désactiver » ne doit toucher ni aux alertes ni aux dessins, et il faut un toast Annuler. (5) Sur mobile, le menu vit dans la feuille « Options ». (6) Les couches d'IDEE-22 (alertes) n'existent pas encore : il faut les retirer du périmètre initial.

**Fichiers à toucher.**

- apps/web/src/components/Toolbar.tsx
- apps/web/src/components/CouchesMenu.tsx (nouveau, chargé à la demande)
- apps/web/src/chart/couches.ts (nouveau : table COUCHES + test d'exhaustivité)
- apps/web/src/chart/tradeMarkers.ts
- apps/web/src/chart/whaleBubbles.ts
- apps/web/src/chart/tradeMarkersBascule.ts (nouveau)
- apps/web/src/chart/whaleBubblesBascule.ts (nouveau)
- apps/web/src/commands/windowPanels.ts
- apps/web/e2e/quatre-lots-indicateurs.e2e.ts

**Mesure de succès.** Toutes les couches s'activent sans connaître de mnémonique (test : chaque commande de couche du registre figure dans COUCHES). Le compteur du bouton affiche le nombre réel de couches actives.

**Avis des juges.**

- valeur (2) : Savoir quelles couches sont actives évite de lire un graphe encombré, et rend NIVCLE et OPTNIV découvrables. C'est de l'ergonomie, avec un effet faible sur les décisions.
- cout-risque (3) : C'est un M : nouveau menu chargé à la demande sous un budget d'entrée serré, petits stores de bascule à extraire pour MARKS et WHALE, trois boutons retirés et e2e à adapter. Il n'y a pas de calcul, mais la surface est réelle.
- coherence (4) : Elle montre ce qui est réellement dessiné sur le graphe, ce qui est honnête pour la lecture, et regroupe sept points d'accès. La surface ajoutée à la barre d'outils doit être validée (G100), et le budget d'entrée respecté.

### 32. IDEE-34 — Enchaîner les fonctions sans les connaître par cœur : fonctions liées dans l'en-tête et menu Fonctions à la carte

**Score 11/20** · valeur 2 · coût-risque 4 · cohérence 3 · effort révisé **M** (initial S) · existe déjà : partiellement · origines : ERG-8, SIM-9

**Problème.** Avec 39 fenêtres et une centaine de mnémoniques, l'opérateur doit savoir de mémoire quelle fenêtre ouvrir ensuite. Le README enseigne des enchaînements (« CHAIN / BRIEF / STBL », « ECO → EVTS », « DOM / EQS », README.md:384-390), mais le registre ne décrit aucun lien entre fenêtres (store/windowManager.ts:79-121) ; quelques liens sont codés à la main (EcoWindow.tsx:145, globe/TransmissionPanel.tsx:68, DecisionDossiers.tsx:76, AlertsPanel.tsx:1004). Le menu Fonctions liste 41 entrées (Toolbar.tsx:311-327) et rien ne peut être masqué, alors que le champ menuHidden existe mais reste figé dans le code (store/windowManager.ts:49 et 80).

**Proposition retenue après vérification.** Fonctions liées déclarées dans le registre. (1) Un champ optionnel liees (2 à 3 ids) dans DefinitionFenetre, choisi parmi les enchaînements déjà documentés (README.md:380-390 : CHAIN/BRIEF/STBL, ECO → EVTS, DOM/EQS, OMON/BRIEF, CAP/SECT…) et les liens aujourd'hui codés à la main (ECO → RATE, GLOBE → SCEN). Un test structurel vérifie que chaque id existe et qu'aucune fenêtre ne pointe vers elle-même. (2) Rendu à un seul endroit, dans la barre de titre de FloatingWindow, qui connaît l'id et le groupe couleur : des puces « → MNEMO ». Un clic ouvre la cible et lui applique le groupe couleur de la source (setGroup), pour que DES, VOL, SEAG, EVTS et PAPER suivent le même actif. Sous une largeur donnée, les puces passent dans un petit menu « → ». (3) En option secondaire : masquer une fonction du menu Fonctions (préférence locale, la fonction reste trouvable par ⌘K). (4) Pas de section « Fréquentes » : UX-9 et l'historique de la palette couvrent déjà ce besoin. Mesures : le test structurel passe, aucun lien ne pointe vers un id inconnu, et le surcoût du chemin initial est mesuré par verifier-budget-build.

**Proposition initiale.** Dans l'en-tête de chaque fenêtre, 2 à 4 puces « → FUNDX · LIQ · SQZ » mènent aux fonctions qui complètent la lecture, sur l'actif courant ou celui du groupe couleur. Les liens sont déclarés une fois dans le registre (champ « liees ») et réutilisés par le menu Fonctions et l'aide « ? ». Chaque fonction peut être masquée du menu (préférence locale qui alimente menuHidden ; elle reste trouvable par ⌘K). Une section « Fréquentes », calculée sur un compteur local d'ouvertures, apparaît en tête du menu et de la palette vide.

**Réutilise.** WINDOW_REGISTRY, EnTeteFenetre (components/ui.tsx:378-406, emplacement actions), windowManagerStore.openWindow, groupes couleur (groupSymbols), menuWindowsGroupees et SECTIONS_FONCTIONS, marquerVue/estNouvelle (même patron localStorage), historique de la palette (CommandPalette.tsx:11 et 43-45).

**À créer.** Champ optionnel liees dans DefinitionFenetre et test structurel (chaque lien pointe vers un id existant, aucune fenêtre vers elle-même). Puces dans EnTeteFenetre. Préférence « fonctions masquées ». Compteur d'ouvertures et section Fréquentes.

**Données.** Aucune.

**Ce qui existe déjà.** Des liens existent, codés à la main : EcoWindow.tsx:145 (vers RATE), globe/TransmissionPanel.tsx:68 (vers SCEN), DecisionDossiers.tsx:76 (vers PAPER), AlertsPanel.tsx:1004 (vers EXPY), brief/SectionAnalyse.tsx:18 et 53 (« Voir RATE/DOM/CHAIN/GLOBE »), SessionStrip.tsx:182 (vers BRIEF), TickerBand.tsx:206 (vers NEWS). Des ensembles de fenêtres liées s'ouvrent déjà en un clic : les playbooks (apps/web/src/data/playbooks.ts:52-55, ouvrirFenetres) et les presets métiers d'espace (apps/web/src/store/workspaces.ts:396-407). Le menu Fonctions est groupé (Toolbar.tsx:311-327, 41 entrées confirmées : 38 fenêtres hors DES, plus TICKER, CQTAKR et CQMINE). La palette garde un historique de 20 commandes (CommandPalette.tsx:43-45, 139-149). Le constat UX-9 de la revue (revue-2026-11-06.md:1901-1907) traite déjà la palette vide. Aucun champ « liees », aucune préférence de masquage et aucun compteur d'ouvertures n'existent (grep vide).

**Contrat.** Aucune fenêtre ni donnée nouvelle. Le gel G100 interdit aussi toute « fonctionnalité de surface » (BUILD-CONTRACT.md:71). Puces et masquage sont de la navigation, mais il faut le faire confirmer au propriétaire. FloatingWindow, Toolbar et windowManager sont sur le chemin de chargement initial (App.tsx:61), où la marge gzip n'est que d'environ 4 Ko (revue-2026-11-06.md:1232). L'ajout doit rester minime : table de liens courte et aucun import nouveau.

**Risques.** 1) « Sur l'actif du groupe couleur » ne marche pas tel quel : openWindow crée la fenêtre avec groupColor: null (windowManager.ts:640). Il faut appeler setGroup(cible, couleurSource) (windowManager.ts:772). Seules DES, EVTS, SEAG, VOL, PAPER et la barre de FloatingWindow lisent groupSymbols ; la promesse ne vaut donc que pour elles. 2) EnTeteFenetre (ui.tsx:378) ne connaît que le mnémonique et compte 40 fichiers appelants, alors que FloatingWindow connaît l'id et le groupe : c'est le meilleur emplacement unique. 3) Une barre de titre de 320 px minimum (MIN_WIDTH, windowManager.ts:202) peut déborder avec 3 puces : il faut tronquer ou passer en menu. 4) SECTIONS_FONCTIONS est une constante de module (Toolbar.tsx:311) : le masquage oblige à la recalculer. 5) La section « Fréquentes » recoupe UX-9 et l'historique de la palette ; son seul apport serait l'ordre par fréquence, pour un compteur de plus à persister. 6) La table de liens est à maintenir quand des fenêtres changent, ce que le test structurel limite.

**Fichiers à toucher.**

- apps/web/src/store/windowManager.ts (champ liees dans DefinitionFenetre)
- apps/web/src/store/windowManager.test.ts (test structurel des liens)
- apps/web/src/components/FloatingWindow.tsx (puces dans la barre de titre)
- apps/web/src/components/Toolbar.tsx (SECTIONS_FONCTIONS rendu réactif si masquage)
- apps/web/src/store/fonctionsMasquees.ts (nouveau, optionnel)
- apps/web/src/components/EcoWindow.tsx, globe/TransmissionPanel.tsx (liens manuels remplacés si redondants)
- apps/web/e2e (menu Fonctions)

**Mesure de succès.** Le test structurel du registre passe. Après masquage, le menu Fonctions tient sans défilement. La palette vide montre d'abord les fonctions réellement utilisées. Part des ouvertures faites depuis une puce mesurée.

**Avis des juges.**

- valeur (2) : Des puces de navigation entre fenêtres liées font gagner un peu de mémoire et quelques clics, sans changer les décisions.
- cout-risque (4) : Il suffit d'un champ liees dans le registre, d'un test structurel et de puces dans FloatingWindow, avec setGroup qui existe déjà. Sans calcul, le seul coût est la marge d'environ 4 Ko du chemin initial et la largeur de la barre de titre.
- coherence (3) : Navigation utile, mais elle ajoute des puces à toutes les barres de titre, sur le chemin de chargement initial où la marge n'est que d'environ 4 Ko. Le gain est modeste, et la palette avec son historique couvre déjà une partie du besoin.

### 33. IDEE-35 — Une seule vue par sujet : SECT dans MAP, mineurs dans MINE, retrait des surfaces mortes

**Score 11/20** · valeur 2 · coût-risque 3 · cohérence 4 · effort révisé **M** (initial M) · existe déjà : partiellement · origines : SIM-7, SIM-8, SIM-9

**Problème.** Deux vues « secteurs » coexistent avec des définitions différentes : l'onglet Secteurs de MAP (24 catégories CoinGecko, 24 h seulement ; MarketMapWindow.tsx:9, 46 et 188-230) et SECT (groupes curés pondérés, 1 j/7 j/30 j ; SectWindow.tsx:1-14), sur la même requête /coins/markets (data/marketOverview.ts:8 et 356) ; le panneau Nouveaux tokens est monté deux fois (ScreenerWindow.tsx:66 et 719 ; SectWindow.tsx:39 et 275). Deux « Hashprice » calculés différemment portent le même nom : MINE suppose 144 blocs par jour (data/mine.ts:78-95 ; MineWindow.tsx:437), CHAIN divise les revenus réels des mineurs (data/onchain/mineurs.ts:87 ; onchain/Mineurs.tsx:82). Surfaces mortes : l'onglet « Initiés » de FUND est toujours vide (FundWindow.tsx:14-17, 99 et 405), IMAP est un double de MAP (commands/windowPanels.ts:57), et MONEY « Masse monétaire » ouvre l'onglet Macro du menu Indicateurs alors que MACRO ouvre RATE (commands/registry.ts:479-506).

**Proposition retenue après vérification.** Une seule vue par sujet, sans retirer de fenêtre. (1) SECT reprend les catégories CoinGecko 24 h comme seconde vue, « Groupes curés / Catégories CoinGecko », à partir de fetchMarketOverview().sectors, déjà chargé par le même appel. L'onglet Secteurs de MAP devient un lien « → SECT », et le mot-clé « secteurs » quitte la commande MAP. (2) Nouveaux tokens reste dans EQS seul : le bouton de SECT ouvre EQS sur cette vue (signaux.setVue("nouveaux"), comme SIG force « signaux »). (3) Hashprice : MINE renomme sa tuile « Hashprice théorique (144 blocs/j) » et ajoute un lien « → CHAIN Mineurs (observé) ». L'aide de l'alerte onchain-seuil précise « hashprice observé (CHAIN) », qui est la valeur lue par l'alerte. Un test vérifie qu'aucun libellé n'est « Hashprice » sans qualificatif. Les sections mineurs restent dans CHAIN, conformément aux décisions des 14, 16 et 18 septembre. (4) L'onglet Initiés, toujours vide, est retiré de FUND, et MONEY devient « Mesures de liquidité (menu Indicateurs) ». IMAP peut rester, il est sans enjeu. Mesures : une seule vue des secteurs ; aucune requête réseau ajoutée (le test SECT « aucun appel » existant reste vert) ; aucune fenêtre retirée et aucune migration d'espace.

**Proposition initiale.** L'onglet Secteurs de MAP reprend la table de SECT (groupes curés, périodes, couverture, détail), avec CoinGecko 24 h en second choix ; SECT ouvre MAP sur cet onglet, comme TOP ouvre déjà Classement ; Nouveaux tokens reste dans EQS seul (39 → 38 fenêtres). MINE devient la fenêtre des mineurs (Hash Ribbons, hashprice réel, coût de production, mineurs cotés) ; le hashprice théorique devient un détail « théorique, 144 blocs/j » ; CHAIN remplace sa section par un lien et CQMINE ouvre MINE. Retrait de l'onglet Initiés et de l'alias IMAP (le mot-clé « imap » reste sur MAP) ; MONEY est renommé « Mesures de liquidité » ou fusionné dans MACRO.

**Réutilise.** data/secteurs.ts, sectWindow.util.ts, marketMapUiStore (patron ouvrirClassement), NouveauxTokensPanel, preset « Chasse Alpha » (store/workspaces.ts:398-401), onchain/Mineurs.tsx, onchain/MineursCotes.tsx, data/onchain/mineurs.ts, data/mine.ts, store/mine.ts, cryptoquantUiStore, store/persist.ts.

**À créer.** Contenu de l'onglet et redirection de SECT ; migration des espaces sauvegardés contenant sect vers marketMap ; mise à jour du preset. Déplacement des sections mineurs, redirection de CQMINE, renommage du hashprice théorique. Suppression des trois surfaces. Test : une seule valeur nommée « Hashprice ».

**Données.** Disponibles, sur les mêmes requêtes ; aucun appel supplémentaire.

**Ce qui existe déjà.** Les doublons sont réels et rien ne les réconcilie. Deux vues secteurs existent : l'onglet Secteurs de MAP (MarketMapWindow.tsx:9, 46 et 188-230, catégories CoinGecko 24 h) et SECT (SectWindow.tsx:1-14, environ 10 groupes curés en 1 j, 7 j et 30 j). Correction : les secteurs de MAP viennent de /coins/categories et SECT de /coins/markets, deux requêtes distinctes servies par le même appel fetchMarketOverview (data/marketOverview.ts:7-9 et 353-371). Nouveaux tokens est monté deux fois : ScreenerWindow.tsx:66 et 719, SectWindow.tsx:39 et 275. L'idée a manqué deux autres doublons : EconomieChaines est monté trois fois (SectWindow.tsx:279, StablecoinsWindow.tsx:979, OnchainWindow.tsx:1153) et DefillamaProPanel deux fois (McapWindow.tsx:440, SectWindow.tsx:278). Il y a deux « Hashprice » : MINE suppose 144 blocs par jour (data/mine.ts:33 et 78-95 ; MineWindow.tsx:437), CHAIN divise les revenus observés par le hashrate (data/onchain/mineurs.ts:84-99 ; onchain/Mineurs.tsx:82). L'alerte onchain-seuil lit la valeur de CHAIN (alerts/onchainMetriques.ts:63-67), alors que l'aide dit seulement « hashprice 35 $/PH/j » (AlertsPanel.tsx:852). L'onglet Initiés de FUND est toujours vide, par choix documenté (FundWindow.tsx:14-17, 99 et 405-410). IMAP est un alias, et MAP porte déjà le mot-clé « imap » (commands/windowPanels.ts:51 et 57). MONEY ouvre l'onglet Macro du menu Indicateurs, ce que le README documente (registry.ts:497-506 ; README.md:340). Aucun de ces points ne figure dans la revue du 2026-11-06 (grep).

**Contrat.** Telle que proposée, l'idée retire SECT : le compte « 39 fenêtres » change (README.md:24 et 155, BUILD-CONTRACT.md:67 et plusieurs sections datées). Il faut aussi migrer les espaces sauvegardés, le preset Chasse Alpha (store/workspaces.ts:398-401) et la propagation vers « sect » (NouveauxTokensPanel.tsx:708), puis mettre à jour l'e2e gate-lot3-sect. Surtout, faire de MINE la fenêtre des mineurs revient sur trois décisions consignées du propriétaire. Le 2026-09-14, la section Mineurs a été placée dans CHAIN. Le 2026-09-16, la production des mineurs cotés a été placée dans la section Mineurs de CHAIN (BUILD-CONTRACT.md:71). Le 2026-09-18, CQMINE a été fait pour naviguer vers CHAIN (store/cryptoquantUi.ts:4-5). La version reformulée ne retire aucune fenêtre et ne touche aucune décision : elle reste dans les surfaces existantes.

**Risques.** 1) Fusionner SECT dans MAP déplace aussi EconomieChaines et les unlocks et bridges (DefillamaPro, mode « bridges »), que l'idée ne mentionne pas. Les supprimer est possible puisqu'ils restent dans CHAIN, STBL et CAP, mais c'est à dire. 2) Migrer les espaces sauvegardés pour un id retiré est une source d'erreurs, pour un gain modeste. 3) Déplacer Hash Ribbons, hashprice observé et mineurs cotés vers MINE est faisable, puisque MINE a déjà le hashrate sur un an (store/mine.ts:58-59) et que le cache des revenus est partagé, mais c'est un effort L contre trois décisions du propriétaire. 4) Les catégories CoinGecko sont nombreuses (top 24 par |Δ24 h|), alors que SECT n'a qu'environ 10 groupes : il faut garder les deux lectures. 5) Le vrai risque de décision est le hashprice : un opérateur qui règle un seuil d'alerte en lisant MINE (théorique) compare une valeur que l'alerte ne lit pas. L'écart est de quelques pour cent. 6) Retirer IMAP n'apporte presque rien, puisque l'alias est sans coût et que le mot-clé reste sur MAP.

**Fichiers à toucher.**

- apps/web/src/components/SectWindow.tsx
- apps/web/src/components/MarketMapWindow.tsx
- apps/web/src/store/marketmap-ui.ts
- apps/web/src/commands/windowPanels.ts
- apps/web/src/components/MineWindow.tsx
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/components/FundWindow.tsx
- apps/web/src/commands/registry.ts
- README.md
- apps/web/e2e/gate-lot3-sect.e2e.ts

**Mesure de succès.** Une seule vue des secteurs et une seule valeur « Hashprice » (test). Un espace sauvegardé avec SECT rouvre MAP sur l'onglet Secteurs. Aucune entrée « toujours indisponible ». Aucune requête réseau supplémentaire.

**Avis des juges.**

- valeur (2) : C'est surtout du ménage. Le seul point qui touche une décision est le hashprice théorique confondu avec celui que lit l'alerte, pour un écart de quelques pour cent.
- cout-risque (3) : La version reformulée ne retire aucune fenêtre, et le renommage du hashprice est S et utile. Elle touche quand même cinq fenêtres (SECT, MAP, EQS, MINE, FUND), des commandes et des e2e, pour un gain diffus.
- coherence (4) : Elle réduit la dispersion (deux vues secteurs, deux « Hashprice ») sans retirer de fenêtre ni revenir sur les décisions qui placent les mineurs dans CHAIN. Le libellé du hashprice touche à l'honnêteté du seuil d'alerte.

### 34. IDEE-13 — Jouer en direct exactement la règle testée : armer l'alerte depuis BT et sortir de PAPER par la règle de sortie

**Score 10/20** · valeur 3 · coût-risque 1 · cohérence 3 · effort révisé **L** (initial L) · existe déjà : non · origines : DEC-9, DEC-8

**Problème.** BT et ALRT ne se parlent pas : BacktestWindow.tsx ne référence pas alertsStore, et aucun convertisseur de règles n'existe (grep versAlerte / depuisBacktest vide). Après un run concluant, l'opérateur recrée l'alerte à la main, avec un risque d'écart silencieux (regimeBtc, adxEntree, stopAtr, intervalle). PAPER ne sait sortir qu'au TP, au SL ou à la main (data/paper.ts:71), alors qu'AXIS sort sur son propre signal (preset « État ≤ 0 », store/backtest.ts:536-537) et que le stop suiveur a été jugé DÉFAVORABLE (README.md:193-199). PAPER mesure alors le temps de réaction de l'opérateur, pas la stratégie. Enfin, le garde-fou de régime d'AXIS ne s'applique pas dans le daemon (README.md:236-237) : l'alerte évaluée onglet fermé n'est pas la règle testée.

**Proposition retenue après vérification.** « Surveiller ce run » : depuis un run BT, créer une surveillance de règle qui n'utilise PAS les alertes ALRT. À chaque clôture de l'intervalle du run, elle charge les bougies clôturées du symbole avec l'amorce (accumulerKlines, après BT-1 et BT-2) et la référence de régime (chargerRefCloseBacktest, à exporter). Elle évalue les règles d'entrée et de sortie EXACTES du run avec le moteur BT, via une fonction pure exportée de @axiom/backtest qui réutilise compilerRegles et toutesVraies (engine.ts:156, 223). Le pas de traduction disparaît, et EMA 9/21, prix contre indicateur, etc. passent aussi. Les transitions entrée et sortie sont journalisées dans ALRT (notification, dossier), avec la signature du run dans le message. Le libellé dit « application ouverte, intervalle 4h, pas de Telegram ». Au plus 4 surveillances actives, comme MAX_ALERTES_ACTIVES. Dans PAPER, une position peut être liée à une surveillance. Le signal de sortie la clôture au premier prix reçu après la clôture de la barre, avec le genre « sortie-regle » (validateur mis à jour). Au redémarrage, un rattrapage clôture à l'open de la barre suivant le signal manqué, étiqueté comme tel. EXPY compare l'expectancy nette en % par trade avec celle du run, aux mêmes coûts, en affichant n. Plus tard, déporter le même évaluateur dans le daemon (Bun importe le paquet pur) pour le relais Telegram onglet fermé : c'est le terrain d'IDEE-17.

**Proposition initiale.** (1) Un bouton « Armer en alerte » sur un run BT traduit ses règles d'entrée (et en option de sortie) : sortie comparée à une constante → seuil d'indicateur ; croisement de deux sorties du même indicateur → croisement ; 2 à 4 règles → composite ET. Symbole, intervalle et paramètres sont repris à l'identique, et l'identifiant du run figure dans le message. Une règle intraduisible est refusée, raison à l'appui. Si le daemon doit l'évaluer sans garde-fou (jusqu'à IDEE-17), un avertissement s'affiche. (2) Dans PAPER, l'opérateur attache à une position une « alerte de sortie », par défaut la sortie du preset BT correspondant (AXIS État ≤ 0). À son déclenchement, PAPER clôture au dernier prix avec le motif « sortie par règle », journalisé dans EXPY. Le dossier pointe vers le run BT, qui sert de référence à IDEE-6.

**Réutilise.** store/backtest.ts (presets, ConfigRun, règles de sortie), data/backtestArchive.ts (conditionValide, opérandes), store/backtestHistory.ts (identifiant du run), @axiom/alerts (indicateur-seuil, indicateur-croisement, composite), store/alerts.ts (ajouter), alerts/runtime.ts (évaluation et journal), store/paper.ts (cloturer), data/paper.ts (ExecutionPaper).

**À créer.** Module pur data/btVersAlerte.ts (traduction et motifs de refus), chargé à la demande. Bouton dans BacktestWindow. Champ alerteSortieId sur PositionPaper, genre de sortie « sortie-regle », abonnement au journal qui clôture la position liée, sélecteur dans le formulaire PAPER. Test d'aller-retour.

**Données.** Disponibles : configuration du run, catalogue d'indicateurs, calculs du runtime d'alertes (garde-fou de régime compris côté front).

**Ce qui existe déjà.** Aucun lien BT→ALRT ni BT→PAPER : BacktestWindow.tsx et store/backtest.ts n'importent ni alertsStore ni paperStore (grep vide, de même pour versAlerte/depuisBacktest/sortie-regle). Briques proches : chaîne alerte → dossier → brouillon PAPER (store/paper.ts:67-87, data/decisionDossier.ts:24-33) ; évaluation périodique hors graphe des alertes de preset (store/presetAlerts.ts:1-24, alerts/runtime.ts:719) ; garde-fou de régime appliqué côté front (alerts/runtime.ts:330-348). La roadmap prévoyait déjà un BT « mutualisé avec le futur paper trading » (docs/research/03-roadmap-bloomberg-perso.md:82).

**Contrat.** Le bouton dans BT est une surface : exception G100 à demander. Les changements de PAPER sont hors gate (BUILD-CONTRACT.md:24 et 70). Aucune clé, aucun fournisseur : on n'utilise que les klines Binance déjà employées par BT. L'évaluation tourne côté front, application ouverte seulement, comme les alertes de preset : pas de Telegram, qui reste au daemon (alerts/runtime.ts:985), et c'est à afficher. Prérequis réels : BT-1 (amorce), BT-2 (bougie en formation relue comme clôturée), MFN-2 (deux moteurs PAPER) et MFN-8 (un évaluateur périodique par fenêtre double les notifications). OFL-3 et IND-2 deviennent inutiles : l'évaluateur ne lit pas marketStore, et le catalogue BT n'utilise déjà que la sortie « etat » d'AXIS (store/backtest.ts:206-209).

**Risques.** La traduction en alertes ALRT proposée est fausse sur trois points prouvés. (1) Elle perd de l'information : indicateur-croisement exige deux sorties du MÊME indicateur aux MÊMES paramètres (packages/alerts/src/types.ts:60-68), et aucune alerte ne compare un prix à un indicateur. EMA 9/21, Bollinger, EMA+ADX et PSAR+ADX (4 presets sur 11, store/backtest.ts:400-505) sont donc intraduisibles. Les comparaisons de niveau entre deux sorties placées dans un ET (MACD+Supertrend, triple confirmation) ne deviennent que des croisements d'une barre, ce qui change la règle. (2) Une alerte d'indicateur en 4h n'est évaluée QUE si le graphe maître affiche ce symbole et cet intervalle (alerts/runtime.ts:304-312). Le daemon écarte toute alerte de bougie autre que 1m (apps/daemon/src/alerts.ts:236). L'alerte armée ne sera donc pas évaluée « sans garde-fou » par le daemon : elle ne le sera pas du tout, onglet fermé ou graphe ailleurs. (3) Le graphe ne remonte à 1 500 bougies que si AXIS est AFFICHÉ (chart/ChartInstance.tsx:1418-1424). Sinon l'alerte AXIS calcule sur environ 500 bougies, soit des signaux faux dans 60 % des fenêtres (README.md:203-206). Côté PAPER : l'expectancy R est nulle pour AXIS sans stop (stopInitial sentinelle, data/paper.ts:337-338 ; expectancyR null dans BT). La mesure « écart d'expectancy R » est donc impossible et doit se faire en % par trade. 20 trades AXIS 4h demandent près de deux ans sur un seul actif (3 à 12 par an, BT-6). PAPER compte 0,05 % sans slippage contre 0,07 % pour BT : l'écart mêle les modèles de coût. Un nouveau genre d'exécution est rejeté au rechargement si on oublie le validateur (store/paper.ts:153). Le dossier n'accepte que des conditions d'alerte (decisionDossier.ts:91), il faut l'étendre.

**Fichiers à toucher.**

- packages/backtest/src/engine.ts
- packages/backtest/src/index.ts
- apps/web/src/data/surveillanceRegleBt.ts (nouveau, pur)
- apps/web/src/store/surveillancesBt.ts (nouveau)
- apps/web/src/alerts/runtime.ts
- apps/web/src/store/backtest.ts
- apps/web/src/store/backtestHistory.ts
- apps/web/src/components/BacktestWindow.tsx
- apps/web/src/components/AlertsPanel.tsx
- apps/web/src/data/paper.ts
- apps/web/src/store/paper.ts
- apps/web/src/components/PaperWindow.tsx
- apps/web/src/data/decisionDossier.ts

**Mesure de succès.** Un test d'aller-retour prouve que l'alerte créée a les mêmes paramètres que le run. Aucune alerte AXIS n'est armée sans avertissement quand le daemon l'évalue sans garde-fou. Une position AXIS en PAPER se ferme seule sur le signal de vente ; sur 20 trades, l'écart d'expectancy R entre PAPER et BT est affiché dans EXPY.

**Avis des juges.**

- valeur (3) : Jouer exactement la règle testée supprime une source d'écart, mais l'évaluation n'a lieu qu'application ouverte, sans Telegram, et la mesure prendra des années pour AXIS 4h. Le cas qui compte vraiment, l'alerte AXIS fidèle onglet fermé, est mieux servi par IDEE-17.
- cout-risque (1) : C'est un nouvel évaluateur périodique, un nouveau genre d'exécution PAPER (validateur), du rattrapage au redémarrage et une extension des dossiers, avec quatre prérequis bloquants (BT-1, BT-2, MFN-2, MFN-8). Le chantier est le plus cher et le plus risqué de la liste.
- coherence (3) : Jouer en direct exactement la règle testée est très cohérent, mais l'idée crée un troisième système d'évaluation à côté d'ALRT et du daemon, qui ne tourne qu'application ouverte. C'est lourd (L) et dispersant tant que le daemon ne l'héberge pas.

### 35. IDEE-25 — Impact d'un nouveau trade sur le risque du portefeuille, avant de placer l'ordre

**Score 9/20** · valeur 2 · coût-risque 2 · cohérence 3 · effort révisé **M** (initial M) · existe déjà : non · origines : RSK-7

**Problème.** Le critère C de PACTE juge le trade isolé : perte au stop ≤ 2 % de l'équity (data/paper.ts:400-412). Il ne voit pas que l'opérateur détient déjà, par exemple, trois alts longues corrélées à 0,9 avec BTC. Le risque du portefeuille n'est calculé qu'après coup, sur la composition actuelle (components/portfolio/SectionRisque.tsx:37), et CORR travaille sur la watchlist, pas sur les positions (components/CorrWindow.tsx:320).

**Proposition retenue après vérification.** « Impact portefeuille » à la demande, dans PAPER (et plus tard depuis l'outil position) : on choisit le livre de référence, PORT (réel) ou PAPER (simulé), sans jamais les additionner par défaut. On y ajoute le trade candidat (symbole, source, sens, montant). La fonction pure impactCandidat(series, poidsAvant, candidat) renvoie, EN DOLLARS : VaR 95 1 j avant/après et volatilité avant/après, calculées sur les MÊMES dates ; part signée de la contribution du candidat ; corrélation du candidat avec le portefeuille avant le trade (pearson de corr.ts, sans exporter covPop) ; Σ w·β BTC avant/après ; n jours communs. Si l'historique du candidat fait moins de 60 jours, on n'affiche pas de VaR « après » mais seulement la corrélation et le β sur la période disponible, avec la mention « historique court ». La phrase n'est écrite qu'au-delà de ±10 % d'écart. La collecte passe par l'adaptateur de la source, avec le cache 1 h de portRisque étendu à toutes les sources. La concentration (candidat > 50 % du risque) est un badge d'information, ni dans le score PACTE ni dans le verrou, sauf décision du propriétaire. Tests : un actif seul doublé donne une VaR $ ×2 exacte ; un short identique de même taille donne une VaR nulle ; Σ ctr = 1 après ajout ; un candidat de 20 jours donne « historique court », pas null en silence.

**Proposition initiale.** Un bouton « Impact portefeuille » dans PAPER, et depuis le dessin position (IDEE-3), calcule sur les positions PORT et PAPER plus le trade candidat : VaR 95 % à 1 jour avant et après, part du risque apportée par le candidat, corrélation du candidat avec le portefeuille, exposition nette en équivalent BTC (somme des poids × β). Une phrase simple : « ce trade double votre exposition BTC » ou « ce trade réduit la VaR ». En option, un critère PACTE « concentration » signale un candidat qui apporte plus de 50 % du risque. Le calcul passe par le même code que SCEN (IDEE-26).

**Réutilise.** data/portRisque.ts (collecterRisquePortefeuille et son cache de bougies, risquePortefeuille, contributionsRisque, betasVsRef), data/scen.ts (brutesDepuisPortefeuille, brutesDepuisPaper), bloc PACTE de PaperWindow.tsx, badges de SectionRisque.tsx.

**À créer.** Fonction pure testée impactCandidat(series, poidsAvant, candidat) → {varAvant, varApres, ctrCandidat, corr, expoBeta}. Export d'une corrélation depuis portRisque (covPop et varPop sont internes). Ligne d'impact dans PAPER, calculée à la demande.

**Données.** Disponibles : bougies 1 j Binance sur 90 jours, même collecte que PORT, périmètre crypto-Binance.

**Ce qui existe déjà.** Rien n'évalue un trade candidat face au portefeuille. Le critère C de PACTE ne voit que la perte au stop rapportée à l'équity PAPER (apps/web/src/data/paper.ts:404-416 ; badges dans apps/web/src/components/PaperWindow.tsx:667-731). Le risque du portefeuille n'est calculé qu'après coup, sur la composition existante (apps/web/src/components/portfolio/usePortfolioRisque.ts:83-139 ; SectionRisque.tsx:37). CORR part de la watchlist ou d'un top N, jamais des positions (apps/web/src/components/CorrWindow.tsx:320-327). Les briques pures existent : risquePortefeuille, serieRendementsPortefeuille, contributionsRisque et betasVsRef (apps/web/src/data/portRisque.ts:155-219), pearson exporté par apps/web/src/data/corr.ts:292, brutesDepuisPortefeuille et brutesDepuisPaper (apps/web/src/data/scen.ts:237-261), capital de référence dans apps/web/src/store/risque.ts. Aucun grep ne trouve « impact », « concentration » ou « marginal » sur ce thème.

**Contrat.** Aucune fenêtre, aucun fournisseur, aucune dépendance. C'est une fonctionnalité de surface dans PAPER : PAPER est hors gate G100 (BUILD-CONTRACT.md:25), mais une demande explicite du propriétaire reste prudente. Si l'on ajoute un 6e critère PACTE, la sémantique « score sur 5 » et le verrou changent (PaperWindow.tsx:240-243 et 672) : il faut l'accord du propriétaire. Prérequis conseillé : PRT-5 (afficher n, exclure la bougie du jour).

**Risques.** J'ai vérifié trois risques de calcul faux avec bun sur les vraies fonctions de portRisque. (1) Intersection globale : un candidat listé il y a 20 jours réduit l'intersection à 20 jours, et la VaR « après » devient null pour TOUT le portefeuille (alignerSurPortefeuille, portRisque.ts:117-149). C'est justement le cas d'un nouveau token. (2) La comparaison en % est fausse, car le % est rapporté au brut Σ|w|, qui change avec le trade. Ajouter un short identique de 50 % fait passer la VaR de 2,72 % à 0,91 % du brut (÷3), alors qu'en dollars elle passe de 272 $ à 136 $ (÷2). Il faut comparer en $, éventuellement en % du capital de store/risque. (3) La contribution d'une couverture est négative (ctr −1 pour le short, +2 pour le long) : la phrase « apporte plus de 50 % du risque » doit gérer ce signe. Autres points. Sur 90 jours, la VaR 95 historique est un quantile très bruité. Une variation de quelques % avant/après n'a pas de sens : il faut un seuil (par exemple ±10 %) avant d'écrire « réduit » ou « double », et de préférence l'écart de volatilité, plus stable. collecterRisquePortefeuille ne connaît que Binance (portRisque.ts:313-341), alors que PAPER accepte bybit, okx, kraken, coinbase, mexc, hyperliquid et twelvedata. La promesse « < 2 s avec le cache » ne tient donc que pour les symboles Binance. Additionner PORT (réel) et PAPER (simulé) mélange argent réel et fictif. Enfin, l'idée n'a pas besoin d'IDEE-26 : les fonctions pures existent déjà.

**Fichiers à toucher.**

- apps/web/src/data/impactCandidat.ts (nouveau, pur)
- apps/web/src/data/impactCandidat.test.ts (nouveau)
- apps/web/src/data/portRisque.ts (collecte selon la source, ou réutilisation de la collecte de scen.ts)
- apps/web/src/components/PaperWindow.tsx (ligne « Impact portefeuille » calculée à la demande)
- apps/web/src/data/paper.ts (facultatif : badge concentration hors score)
- apps/web/src/chart/position.ts (facultatif, si IDEE-3 est faite)

**Mesure de succès.** Tests : ajouter un actif identique à une position existante augmente la VaR en proportion ; un actif de corrélation −1 la réduit ; la somme des contributions vaut 1 après l'ajout. Avec le cache chaud, l'impact s'affiche en moins de 2 s.

**Avis des juges.**

- valeur (2) : La concentration avant d'entrer est une bonne question. Mais en crypto la réponse est presque toujours « corrélé à BTC », et une VaR historique sur 90 jours est trop bruitée pour trancher. Le risque ouvert au stop d'IDEE-2 répond plus simplement.
- cout-risque (2) : Trois pièges de calcul ont été vérifiés : intersection des dates, % rapporté au brut, contribution négative d'une couverture. collecterRisquePortefeuille ne couvre que Binance et devrait passer par tous les adaptateurs. Une VaR avant/après bruitée sur 90 jours peut tromper.
- coherence (3) : Elle risque d'afficher une précision trompeuse : VaR historique sur 90 jours, très bruitée, et Binance seulement, souvent sur un livre simulé. Elle est conforme puisque PAPER est hors gate, mais sa valeur pour la décision est faible au regard de sa complexité.
