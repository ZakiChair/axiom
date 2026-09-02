# AXIOM — Suggestions d'améliorations (2026-09-02)

> Audit multi-agents en **lecture seule** : 1 auditeur de clôture (état à HEAD de chaque
> piste ouverte par les revues précédentes), 2 vérificateurs adversariaux des correctifs
> de la branche `fix/revue-2026-09`, 8 finders par dimension, puis réfutation de chaque
> constat par **trois lentilles distinctes** (reproduction dans le code / compatibilité
> avec `BUILD-CONTRACT.md` / valeur pour un opérateur solo), survie à ≥ 2 voix sur 3.
>
> Différence avec les cinq revues précédentes : **`pnpm check` a été relancé à HEAD**
> (la revue du 08-20 ne l'avait pas fait), la table de clôture est construite par lecture
> du code et non des documents, et chaque suggestion est étiquetée compatible-avec-le-gel
> ou nécessitant-un-amendement du contrat.

---

## 1. Verdict

La branche `fix/revue-2026-09` — **56 commits, mergée dans `main` pendant cet audit,
non poussée** — est le meilleur lot de qualité du projet à ce jour. Le plan de correction
du 01-09 compte 49 tâches ; **41 ont pu être contrôlées** commit par commit (E.2 à E.9
étaient en cours d'écriture pendant l'audit et ont été exclues). Verdict des
vérificateurs : **38 complètes**, 2 incomplètes, 1 insuffisamment testée — le point
incomplet d'A.4 ayant ensuite été réfuté par la lentille « contrat », il reste **une
seule tâche réellement incomplète (D.3)**.

Une régression a été trouvée, introduite par la branche elle-même : la palette ⌘K
n'ouvre plus les paires sur un ticker nu (§4, constat 3 — Task C.8, dont le test livré
n'exerçait qu'un registre de deux commandes). Deux autres constats sont des effets de
bord assumables de correctifs par ailleurs justes (dessins « zombies » après C.2, reset
de la variation 24 h sur changement de timeframe après C.7).

Ce que la branche ne change pas : le gate **G100 n'a toujours pas de verdict**. Neuf
cases restent `NON EXÉCUTÉ`, zéro cochée, depuis le 13 juillet. C'est la quatrième revue
consécutive à l'écrire. Le répéter ne suffit plus : la §4 de ce rapport propose un
**script de session minuté** plutôt qu'une injonction.

Ce que la branche révèle, en revanche, est neuf. Les revues précédentes cherchaient les
« demi-ponts » (le back livré sans le dernier mètre) et la « mémoire longue ». Cette
revue-ci trouve autre chose, plus près de l'usage : **plusieurs surfaces du terminal
mesurent autre chose que ce qu'elles montrent.**

---

## 2. Chiffres (2026-09-02, HEAD `e1e7e20`)

| Mesure | Valeur |
|---|---|
| `pnpm check` | **VERT** — 4 354 tests (666 indicateurs · 40 backtest · 39 alertes · 366 daemon · 3 243 web) |
| Build web | `index-*.js` **1 141,90 kB** minifié / **335,43 kB** gzip (avertissement Vite > 500 kB) |
| Branche | `fix/revue-2026-09` mergée dans `main` ; **56 commits d'avance sur `origin/main`, non poussés** |
| Indicateurs (`INDICATORS`) | **179**, dont **27** de catégorie `strategy` — **8** seulement portent l'étiquette « non validé » |
| Fenêtres (`WINDOW_REGISTRY`) | **39** — le README en annonce **38** et omet BPL |
| Fichiers de test | **456** · 13 specs Playwright, dont **5** seulement bouchonnent le réseau |
| LOC TS/TSX (hors `node_modules`/`dist`) | **~172 300** |
| `setInterval` en prod (`apps/web/src`) | **46** dans 27 fichiers · `visibilitychange` / `visibilityState` : **1** occurrence |
| `TODO` / `FIXME` / `@ts-ignore` / `: any` en prod | **0** |
| Golden tests pandas-ta | **4 / 179** (ADX, SuperTrend, Ichimoku, PSAR) |
| `axiom.db` | **22,5 Mo** |
| Gate G100 | **9 cases `NON EXÉCUTÉ`, 0 cochée** |

**Bilan de l'audit** : 54 constats uniques après déduplication → **47 retenus**
(41 confirmés par la vérification à trois lentilles, 6 vérifiés directement par
l'orchestrateur après panne des agents), **3 réfutés sur le fond**, 3 abandonnés faute
de vérification. Répartition des 47 : **5 hautes**, 17 moyennes, 19 basses,
6 améliorations. **Aucun constat critique.**

---

## 3. Ce que la branche a réellement fermé

Contrôle commit par commit de 41 des 49 tâches du plan
`2026-09-01-corrections-revue-complete.md` (E.2 à E.9 étaient en cours d'écriture par
une autre session pendant l'audit, et ont été exclues à dessein) :

| Verdict | Nombre | Détail |
|---|---|---|
| Complet | **38** | Lots 0 (chantier CAP/BPL), A (vérité des données), B (collecteurs), C (persistance/UI), D.1/D.2/D.4 (indicateurs), E.10 |
| Incomplet | **2** | D.3 (quantification) et A.4 (z-score funding) — voir ci-dessous |
| Test insuffisant | **1** | E.1 : la purge du cache SQLite est branchée et testée unitairement, mais **le branchement lui-même n'a aucun test** — une suppression accidentelle de l'appel dans la boucle d'entretien repasserait inaperçue |

Les deux incomplets :

- **D.3 (résidu)** — le commit `0ce6bb4` exclut le `displacement` d'Ichimoku et les
  3 shifts d'Alligator au motif d'une « décision actée du plan » qui n'existe pas dans le
  plan. `packages/indicators/src/trend/ichimoku.ts:123` et `alligator.ts:67-71` consomment
  toujours le paramètre brut : une saisie fractionnaire vide entièrement les séries
  spanA/spanB/chikou et les mâchoires. Même classe de bug, même correctif d'une ligne.
- **A.4 (réfuté ensuite)** — le vérificateur signalait que le repli Coinalyze retient les
  buckets 4 h ouvrant sur une frontière 8 h. La lentille « contrat » a **réfuté** ce point
  spécifique, spécification Coinalyze en main (`t` = début d'intervalle, `c` = taux du
  règlement) : le filtre est correct. Le correctif A.4 est donc bon ; seule sa docstring
  mérite d'être précisée.

---

## 4. Fil rouge 2026-09-02

> **Ce qui est calculé n'est pas ce qui est montré.**

Cinq constats de sévérité haute convergent, et aucun n'était visible dans les revues
précédentes parce qu'ils vivent à la jointure entre deux sous-systèmes corrects
séparément.

1. **Une alerte de bougie n'a pas de timeframe.** `AlertDef`
   (`packages/alerts/src/types.ts:154-172`) porte le symbole, la source, la condition —
   pas le TF. Le front évalue sur le TF affiché du slot 0 ; le daemon évalue les mêmes
   définitions sur des bougies **1 minute** (`apps/daemon/src/marketFeed.ts:12`). Une
   alerte « RSI(14) < 30 » créée depuis un chart 4 h devient une alerte 15 m si l'opérateur
   change de timeframe, et une alerte 1 min dès qu'il ferme l'onglet. L'aide de l'interface
   dit seulement « Évalué à la clôture de bougie », sans jamais nommer un TF.

2. **`variation-pct` mesure la mauvaise fenêtre.** `clotureAvant`
   (`packages/alerts/src/engine.ts:312-318`) prend la clôture de la dernière bougie dont
   l'**ouverture** précède la cible — donc une bougie qui se ferme *après* la cible. La
   variation porte sur (fenêtre − TF), et l'alerte est structurellement morte dès que
   fenêtre ≤ TF. Les quatre fenêtres proposées par l'interface (1 min, 5 min, 15 min, 1 h)
   sont toutes ≤ aux timeframes usuels : **sur un chart 1 h, aucune n'est évaluable côté
   front**. Reproduit par script sur le moteur réel : chute de 10 % sur la dernière bougie
   en TF 1 h avec fenêtre 1 h → zéro déclenchement.

3. **⌘K n'ouvre plus les paires sur un ticker nu.** Régression introduite **par cette
   branche** (`a033f20`). Depuis `CommandPalette.tsx:128-133`, l'item « → Changer la
   paire » n'est plus rétrogradé quand la recherche fuzzy trouve autre chose : il
   **disparaît**. Or presque tout ticker de 3-4 lettres matche quelque chose dans un
   registre de ~240 commandes. Mesuré sur le registre réel : `ETH` → 6 résultats (tête
   HURST), `SOL` → 16, `ADA` → 179 (tête ADX), `SPY` → 3, `GLD` → 12. Taper « ETH » puis
   Entrée **bascule un indicateur** au lieu de changer de paire. Ce n'est pas une absence
   d'action, c'est une action non voulue.

4. **VWAP et pivots lisent une session tronquée.** Le backfill initial est de 500 bougies
   (`ChartInstance.tsx:777`) : 8 h 20 en 1 min, 41 h en 5 min. `vwap.calc` cumule dès la
   première bougie du buffer et ne remet à zéro qu'au changement de jour UTC. Mesuré sur
   les définitions réelles : buffer démarrant à 05:40 UTC, la VWAP affichée à 13:59 vaut
   200,00 contre 112,82 depuis 00:00. En 5 min, les pivots du jour se calculent sur une
   veille tronquée dès 17:40 UTC. Mêmes fonctions pour les 5 définitions de pivots et les
   bandes de VWAP.

5. **Le cache du proxy daemon n'est jamais sur le chemin des requêtes.** Mesure réelle :
   4,4 jours d'uptime, table `cache` = 2 lignes de 3 octets au total, toutes deux
   expirées, aucune réponse réelle mise en cache. `extUrl()`
   (`apps/web/src/data/extapi.ts:36-43`) renvoie toujours un chemin relatif ; en dev Vite
   proxie directement l'amont sans rien cacher, et `pnpm run up` — le lancement par
   défaut — est précisément « daemon + Vite dev ». La capability `proxy` est annoncée sur
   `/health` mais `daemonSupporte("proxy")` n'a **aucun appelant**. Conséquence : le
   TTL 30 s, l'anti-aliasing OpenSky et les gardes MIME/redirect/DNS du `/extapi` durci
   n'ont jamais vu de trafic réel — et ne le verront pas avant le verdict G100.
   *(Survit à 2 voix sur 3 : la lentille « valeur » a jugé le gain d'usage quotidien
   incertain pour un opérateur solo. Le gain de couverture avant le gate, lui, ne l'est
   pas.)*

Le point commun n'est pas la négligence : chaque moitié est correcte. C'est que **rien ne
vérifie l'accord entre les deux moitiés**, et qu'aucune surface ne l'affiche.

---

## 5. Suggestions, par rendement

Sévérité honnête : une « haute » ici est un comportement produit faux en usage quotidien,
pas un crash. Toutes les suggestions ci-dessous sont **compatibles avec le gel G100**
(aucune nouvelle fenêtre, aucun nouveau fournisseur, aucune dépendance, `@axiom/types`
intouché) sauf mention contraire.

### P0 — 30 minutes, zéro code

**1. Jouer G100 — script de session minuté.**
Quatre revues l'ont demandé ; ce qui manquait était un mode d'emploi. Le protocole
lui-même est périmé sur trois points vérifiés :

- `docs/…/2026-07-22-gate-g100-qa.md:27` annonce « 16 tests » avec la commande
  `npx playwright test e2e/gate`. Contrôlé par `--list` : ce filtre en sélectionne **29
  dans 12 fichiers**. Le filtre qui donne bien 16 tests / 7 fichiers est **`gate-g`**.
- La ligne 35 impose « app en prod locale (`pnpm run up`) » alors que le README fait de
  `up` le mode **dev** et de `up:prod` le mode prod.
- Le backlog du plan 09-01 désigne la Task E.4 comme préalable automatisable ; c'est
  la **E.5** (l'e2e « une bougie s'affiche », désormais livré).

Session proposée, ≈ 75 minutes dont 30 en fond, dans cet ordre — **imposé par les scripts
eux-mêmes** : `g9` exige les ports 5173/8787 libres, `g5` exige le daemon arrêté, donc
tout l'automatisé passe **avant** le lancement de l'application.

| Moment | Action | Critère |
|---|---|---|
| T−15, app fermée | arbre propre, `pnpm check` | vert |
| | `scripts/gate/g9-up-smoke.sh` puis `g5-daemon-journal.sh` | G9 PASS · G5 PASS + bannière macOS vue |
| | `pnpm --filter @axiom/web exec playwright test gate-g` | 16/16 |
| T0 | `pnpm run up:prod`, chart Binance BTCUSDT 1 min, orderflow + CVD ON | noter l'heure |
| T0+2 | G6 — EQS preset « crowded long », chrono clic → résultats | ≤ 15 s (noter la valeur) |
| T0+5 | G3 playbook, G4 alerte prix, G7 un clic depuis ECO / NEWS / BRIEF | chart atteint |
| T0+10 | G2 — ouvrir LIQ, juger l'étiquetage « EST. » | décision notée |
| T0+15 | **G1.3 — Wi-Fi coupé 90 s** | santé `stale`/`reconnecting` puis `connected` ; aucune bougie manquante ; CVD sans saut. **FAIL → STOP** |
| T0+18→48 | G1.4 — onglet **visible** sur un autre espace, 30 min | 30 bougies présentes, CVD continu |
| T0+50 | G10 — fenêtre privée, onboarding | ≤ 5 min |
| T0+55 | reporter les 13 cases + décision produit | commit `docs: enregistrer le verdict G100` |

G1.4 se joue **onglet visible**, pas masqué : sans `visibilitychange`, l'onglet masqué
n'est pas le cas que le gate prétend couvrir. Si G1 échoue, le reste de la feuille de
route est du bruit.

**2. Aligner le README sur le code.** Cinq amendements de texte, tous vérifiés :
« 38 fenêtres » ×2 → 39 et insérer BPL dans la liste (l.138) ; l'exception au gel du
01-09 (BPL + séries TOTAL) n'est actée que dans le contrat ; « les 179 indicateurs sont
vérifiés par golden tests » alors que `scripts/golden/README.md` dit **4 défs** ; cinq
clés API citées sur les **neuf** qu'expose le panneau Réglages. Verrou possible en un
test vitest sur le modèle de `uiConventions.test.ts` (lecture du README + comparaison au
registre), pour que la prochaine exception au gel ne puisse plus laisser la
documentation derrière.

**3. Réconcilier les documents de routage.** `.devin/provider-rules.md` (Fable / Opus /
GPT-sol / DeepSeek) et `AGENTS.md` (Fable / Grok 4.6 / GPT 5.6, non versionné) se
contredisent, et `BUILD-CONTRACT.md` renvoie au premier. La règle « un développeur ne
modifie pas BUILD-CONTRACT ni les plans » est d'ailleurs violée par le plan 09-01
lui-même (Task 0.5). Remplacer les noms de modèles par des **rôles** dans `.devin`, et
laisser `AGENTS.md` porter la correspondance rôle → modèle.

### P1 — L'écart entre l'écran et le moteur (le fil rouge, ≈ 1 jour)

**4. Corriger `variation-pct`.** Une ligne dans `engine.ts:315` (prendre la bougie
précédant la dernière ouverte ≤ cible) plus un test « fenêtre = TF déclenche ». Rejoué
par script : les trois fixtures existantes restent vertes. Attention à coordonner avec la
fixture du test de câblage E.4, qui lira désormais une bougie plus tôt.

**5. Donner un timeframe aux alertes.** Champ optionnel `timeframe?: Timeframe` dans
`AlertDef` (paquet `@axiom/alerts`, non figé — `@axiom/types` reste intouché), renseigné
à la création depuis le TF courant. Le front ne filtre que les définitions du TF affiché ;
le daemon n'évalue que celles sans TF ou en 1 min — **une alerte 4 h devient front-only
plutôt que fausse**. Et le texte de l'interface nomme enfin le TF.

**6. Réparer ⌘K.** Une ligne : ne jamais supprimer l'item de navigation, l'ajouter en fin
de liste quand il n'est pas proéminent. Le test ajouté par la Task C.8 n'exerce qu'un
registre de deux commandes, d'où le cas manqué ; le nouveau test doit utiliser le registre
réel.

**7. Alertes de preset : la seule garde de visibilité du projet protège la seule source
sans relais daemon.** `runtime.ts:334` saute le scan EQS quand l'onglet n'est pas visible,
or ces alertes n'ont **aucune couverture daemon** — l'opérateur qui passe sur un autre
onglet croit être couvert et ne l'est pas. Retirer la garde (un `setInterval` de 15 à
60 min survit à la limitation de Chrome), et exposer `dernierScanTs` / `derniereErreur`
dans la ligne du panneau, aujourd'hui verte tant que l'alerte est active même après des
heures d'échecs avalés.

**8. Une alerte CVD rallume l'orderflow à chaque émission du store.** `assurerPipelineCvd`
est appelé sans filtre sur `defs` : un simple ajout au journal (déclenchement d'une alerte
prix quelconque) rallume l'orderflow et le CVD spot/perp, et l'état est persisté.
L'opérateur qui coupe le footprint le voit revenir tout seul. Correctif : comparer
`state.defs !== prev.defs`, patron déjà présent dans `store/alerts.ts:237`.

### P2 — Ne pas mentir sur l'état

**9. Le backfill REST du chart n'a aucun délai.** Aucun `setTimeout`, `Promise.race` ni
signal dans les six adaptateurs : un fetch qui ne répond jamais laisse « Chargement des
bougies… » indéfiniment. Le WebSocket a un chien de garde, le REST non — alors que c'est
exactement le scénario G1. Un `Promise.race` de 20 s emprunte le `catch` existant : le
bouton « Réessayer » et le libellé de timeout sont **déjà câblés**.

**10. L'état des collecteurs du daemon n'est exposé nulle part.** Mesure réelle : le flux
de liquidations est muet depuis le 2026-08-30 04:48, soit 2,5 jours, sans qu'aucune
surface ne le dise. `/health` ne renvoie ni l'état des collecteurs ni la taille de la
base ; l'onglet LIQ calcule sa fraîcheur sur le flux Binance direct, ce qui masque les
venues mortes. La cause de cette panne-ci est corrigée (heartbeat Bybit/OKX, `dc87134`) ;
la prochaine resterait invisible. Ajouter `collecteurs: { liquidations, whales, globe }`
à `/health` sur le modèle de `SanteWhales`, et un badge « collecteur muet depuis X h ».

**11. FUNDX confond panne réseau et absence de perp.** Quatre fetchs qui échouent donnent
le même tableau vide qu'un symbole non listé : après une coupure Wi-Fi de 30 s, la matrice
valide est remplacée par « symbole non listé en perp USDT » et la fraîcheur affiche « à
l'instant ». Compter les rejets, conserver la dernière matrice, ne pas avancer
l'horodatage.

**12. FUND est muet à l'échec.** Tout échec de l'annuaire SEC renvoie un tableau vide,
indiscernable d'un annuaire chargé. L'opérateur tape « AAPL », rien ne se passe, aucune
explication. `FundWindow.tsx` n'importe aucun bloc d'erreur, contre 3 à 17 occurrences
dans les autres fenêtres — c'est le « jamais de pane muet » du contrat.

**13. BRIEF force `binance` au clic.** Les sections Watchlist et Session envoient le chart
sur `binance:SPY` ou `binance:<paire Kraken>` alors que la source réelle est connue
(positions PORT, sources de watchlist). Le patron correct existe déjà trois fois dans le
dépôt (`allerAuSymbole`, PORT, NOTE).

**14. Le marqueur de navigation se duplique en 2×2.** `redrawNavMarker` retire l'overlay
sur le chart focus courant puis le recrée : au changement de focus, le marqueur apparaît
sur le second slot et reste sur le premier. Les quatre autres overlays suivent leurs
overlays par instance depuis la Task A.9 ; `navigation.ts` a été oublié.

### P3 — Justesse des calculs

**15. VWAP et pivots sur session partielle** (cf. §4). Pour les pivots, marquer le premier
extent comme partiel quand il ne démarre pas à 00:00 UTC et l'ignorer — même convention
que le jour 0. Pour la VWAP, un `undefined` viderait l'overlay toute la journée : le vrai
correctif est côté web, étendre le backfill jusqu'au dernier 00:00 UTC quand une
définition sessionnée est active (la pagination existe déjà), avec une annotation
« session partielle » en attendant.

**16. `fundingApr` suppose 8 h.** Depuis `aff1116`, FUNDX dérive l'intervalle **réel** par
venue ; le pane d'indicateur, lui, garde le défaut 8 h. Sur un perp réglé toutes les 4 h,
le même symbole affiche deux APR différents dans le même terminal. Pré-remplir
l'`intervalH` avec la fonction existante et nommer l'hypothèse dans le libellé de l'input.

**17. Séries auxiliaires Coinalyze horodatées au début du bucket.** La valeur de clôture
d'un bucket 1 h est datée de son début, puis reportée. Sur un chart 15 min, les bougies
reçoivent une valeur **future** — l'OI semble précéder le prix dans la lecture « 4
quadrants » d'`oiChange` ; sur 4 h, elle a 3 h de retard. À vérifier sur une réponse
réelle avant correctif (un appel, clé personnelle), puis décaler à la fin du bucket **et**
aligner sur la clôture de bougie : décaler seulement les points régresserait le chart 1 h
d'une barre.

**18. Résidu D.3 :** Ichimoku et Alligator (cf. §3).

**19. `fundingZScore` et l'alerte `funding-extreme` ne calculent pas le même z.** Fenêtre
de 30 barres reportées côté chart, 30 règlements réels côté alerte : « Fenêtre 30 » vaut
7 h 30 en 15 min et 30 jours en 1 jour. À défaut de fusionner, nommer la convention dans
le libellé.

### P4 — Le lot « Tient » à finir, et la performance

**20. Toujours zéro `visibilitychange`.** Le lot « Tient » recommandé le 20-08 est livré
aux deux tiers : le plafond Twelve Data est appliqué, la purge du cache est branchée, la
suspension des pollers a disparu du plan 09-01. 46 `setInterval` tournent onglet masqué,
et le heartbeat de 30 s fait croire au daemon que l'application est ouverte — donc **pas
de notification onglet fermé** tant que l'onglet existe en arrière-plan.

**21. Brancher le cache du proxy daemon** (cf. §4, constat 5). Dans `extUrl()`, si
`daemonSupporte("proxy")`, renvoyer l'URL du daemon. Préconditions déjà vérifiées : CORS
accepte les origines Vite, `/extapi` est GET-only, aucun appel via `extUrl` n'utilise de
méthode, les en-têtes de cache sont déjà exposés. Bénéfice secondaire, et le vrai : le
chemin de production obtient enfin de l'exercice avant le gate.

**22. Le footprint repeint à ~60 images par seconde.** Chaque trade marque l'état sale et
la boucle n'a aucun intervalle minimal, contrairement au chemin store → chart qui passe
par `createRafThrottle(…, { minIntervalMs: 100 })`. Chaque rendu reconstruit **toutes** les
colonnes visibles, y compris — depuis la Task A.7 — les colonnes approchées dont l'OHLCV
ne change plus. Correctif : le même helper, la même constante, trois lignes. *(Une des
trois lentilles a réfuté ce constat en jugeant le coût non mesuré ; il survit à 2/3 et le
correctif reste peu coûteux.)*

**23. Chunk principal à 1 142 kB.** 41 % de vendeurs stables (klinecharts, react-dom,
`@axiom/indicators`) non séparés ; et le patron « importer le store pour ses commandes »
tire dans l'entrée la couche data de fenêtres pourtant chargées paresseusement. Un
`manualChunks` et un budget non bloquant.

**24. Les cinq specs e2e déjà hermétiques ne tournent nulle part.** Aucune étape Playwright
en CI, et la configuration ne distingue pas hermétique de live alors que son en-tête
prétend qu'aucune spec ne dépend du réseau. Deux flakes documentés ont désormais une
cause précise : **G7/MAP** vient du couplage Fear & Greed dans le même `Promise.all` que
la treemap, dont le timeout de proxy (15 s) égale exactement celui de l'assertion — la
fixture CoinGecko du test ne peut donc pas le résoudre, il faut bouchonner
`api.alternative.me` ; **G6** dépend de quatre endpoints Binance live, dont deux en direct
hors `/extapi` contrairement à ce qu'affirme son en-tête, et **accepte inconditionnellement
« Aucun résultat »** — une régression de l'enrichissement passerait au vert.

### Sécurité — trois points, tous de faible gravité en mono-utilisateur loopback

**25. L'export JSON de sauvegarde emporte les clés API en clair, sans avertissement.**
C'est le seul artefact du terminal conçu pour **quitter la machine** ; l'import a une
confirmation, l'export non. Ajouter la même confirmation. Second volet : la clé CoinGecko
est stockée sous `axiom.coingecko.demoApiKey` (point au lieu de deux-points), donc **hors
du filtre** — elle est absente de l'export malgré la promesse « tout ».

**26. La clé Etherscan est écrite en clair dans `logs/daemon.log`** à chaque erreur réseau
du collecteur whales (Bun imprime l'URL complète). Même traitement que le token Telegram,
déjà expurgé.

**27. Aucune Content-Security-Policy sur le déploiement Vercel**, alors que le
`localStorage` y détient neuf clés personnelles. Une politique minimale se teste en
`Report-Only` sans risque.

---

## 6. Ordonnancement recommandé

1. **G100** (une session, zéro code) — script en §5, suggestion 1. Si G1 échoue, tout le
   reste attend.
2. **Vérité documentaire** (30 min) — README, routage. Le critère de sortie du Lot 0 du
   plan 08-24 n'est toujours pas atteint : un agent qui lit le README et le test reçoit
   deux instructions contradictoires.
3. **Lot « Alertes »** (≈ 1 jour) — suggestions 4 à 8. C'est le fil rouge, et c'est la
   fonction qui justifie que le terminal tourne quand l'opérateur ne regarde pas.
4. **Lot « Ne pas mentir »** (≈ 1 jour) — suggestions 9 à 14. Toutes petites, toutes
   visibles à l'usage.
5. **Lot « Justesse »** (≈ 1 jour) — 15 à 19, en commençant par la vérification de
   l'horodatage Coinalyze sur une réponse réelle.
6. Puis seulement : `visibilitychange`, cache proxy, bundle, e2e en CI.

Les lots ouverts des revues précédentes qui restent pertinents et non traités ici :
la **mémoire longue** (miroir daemon de `macroHistory`, dessins, workspaces, paper, expy ;
`candlesPush` depuis Coinalyze et Twelve Data), la **vérité du backtest** (drawdown
mark-to-market, expectancy à l'écran, split in/out-of-sample, métadonnée de fidélité des
presets), et la **cohérence multi-chart** (les quatre singletons restants, `symboleContextuel`).
Leur état exact à HEAD figure dans la table de clôture ci-dessous.

## 7. Ne pas faire avant

- Une 40ᵉ fenêtre. Le gel a déjà été dérogé deux fois (WHALES le 25-08, BPL le 01-09),
  toujours sur demande explicite, toujours documenté — mais toujours **sans verdict G100**.
  La seconde dérogation a laissé le README en arrière : le coût réel d'une exception n'est
  pas la fenêtre, c'est la propagation.
- Les goldens de masse (4/179 reste un choix assumé).
- La fusion des catalogues « stratégies chart » et « stratégies backtest » — les nommer
  *signal* et *exécution* coûte moins cher et ment moins.
- Les migrations majeures React / Vite / Zustand / KLineChart.
- Épingler Bun en CI : proposé, puis **réfuté** — le diagnostic du blocage de juillet
  n'est pas clos par les runs verts, et l'épinglage masquerait la variable en cours
  d'observation.

---

## 8. Méthode et limites

- `pnpm check` relancé deux fois, vert les deux fois : à `5a0aa04` (4 332 tests) au début
  de l'audit, puis à `e1e7e20` (4 354 tests) après le merge.
- Aucun fichier du dépôt modifié pendant l'audit ; le présent rapport en a été le seul
  écrit. Il a été versionné ensuite, avec les correctifs issus de cet audit
  (branche `fix/revue-2026-09-02`, cf. annexe « Suites données »).
- Une autre session travaillait dans le même checkout : les tâches E.2 à E.10 ont été
  traitées comme **en cours** et exclues des constats. Elles ont été committées et mergées
  dans `main` pendant l'audit.
- **Trois constats ont été réfutés** et sont écartés : le filtre de frontières 8 h du
  z-score funding (spécification Coinalyze en main), le double envoi d'alertes après
  restauration de snapshot (erreur factuelle dans la preuve), l'épinglage de Bun.
- **Trois constats n'ont pas pu être vérifiés** (limite d'API atteinte sur les
  vérificateurs) et sont volontairement omis : l'en-tête de `.env.example`, l'ancienneté
  des documents de `docs/research`, et le caractère public du proxy Vercel.
- Non mesuré : le coût navigateur réel du footprint (aucun profil), le quota d'API
  consommé (non instrumenté), `pnpm audit --prod` sur cette session.

---

## Annexe — Table de clôture des pistes ouvertes

État à HEAD `e1e7e20` de chaque piste des revues du 09-08 et du 20-08 et du plan d'action
du 24-08, établi par lecture du code (et non des documents). `EN_COURS` désigne une tâche
du plan 09-01 traitée pendant l'audit.

| Piste | Source | État | Ce qui reste |
|---|---|---|---|
| Verdict G100 | 08-20 §5 P0.1 | **OUVERT** | 9 cases, 0 cochée ; préalable E.5 désormais livré |
| Merge `lots-bcd` | 08-20 §5 P0.2 | CORRIGÉ | |
| README chiffres / CI / paper | 08-20 §5 P0.3 | **PARTIEL** | 38 vs 39 fenêtres, BPL absent |
| BUILD-CONTRACT périmé | 08-20 §6 #15 | CORRIGÉ | versions Node/Bun toujours absentes |
| Tableau G100 à trois états | plan 08-24 Lot 0 | CORRIGÉ | |
| Alerte → navigation chart | 08-20 §5 P1.1a | CORRIGÉ | |
| `indicateur-croisement` dans l'UI | 08-20 §5 P1.2 | CORRIGÉ | |
| Journal daemon dans BRIEF | 08-20 §5 P1.4 | **PARTIEL** | l'export markdown l'ignore toujours |
| ⌘K ↔ registre des fenêtres | 08-20 §5 P1.5 | PARTIEL | liste manuelle, mais verrouillée par test |
| EQS / alerte → backtest | 08-20 §5 P1.3 | **OUVERT** | zéro occurrence de « backtest » dans les deux panneaux |
| Historiser le BRIEF | 08-20 §5 P2.1 | **OUVERT** | |
| `candlesPush` Coinalyze / Twelve Data | 08-20 §5 P2.2 | **OUVERT** | un seul writer (backtest Binance) |
| Badge de source OI | 08-20 §5 P2.3 | PARTIEL | repli livré ; la fonction ne renvoie pas la source servie |
| FUNDX horodaté ou relabelé | 08-20 §5 P2.4 | **OUVERT** | la mention est dans un commentaire, pas dans l'UI |
| Miroir daemon des clés critiques | 08-20 §5 P2.5 | PARTIEL | restent `macroHistory`, dessins, workspaces, paper, expy |
| Stratégies v2.6 dans `runBacktest` | 08-20 §5 P3.1 | **OUVERT** | |
| Métadonnée de fidélité des presets BT | plan 08-24 §5.2 | **OUVERT** | |
| Walk-forward dans BacktestWindow | 08-20 §5 P3.2 | **OUVERT** | `partagerMoities` toujours CLI-only |
| Expectancy à l'écran + MAE/MFE | 08-20 §5 P3.3 | **OUVERT** | `statsRejeu` non ré-exporté |
| Drawdown mark-to-market | plan 08-24 §5.1 | **OUVERT** | aucune des 7 cases faite |
| Goldens 4/179 | 08-20 §5 P3.4 | OUVERT | choix assumé |
| Ticker tradfi sur `wsLoop` | 08-20 §5 P4.1 | CORRIGÉ | |
| `purgerExpires` branché | 08-20 §5 P4.2 | CORRIGÉ | le branchement n'a pas de test |
| Rétention replay / VACUUM | 08-20 §5 P4.2 | PARTIEL | aucune rétention automatique des `replay_trades` |
| 429 / Retry-After / cooldown proxy | 08-20 §5 P4.3 | **OUVERT** | non couvert par E.9 (timeouts ≠ 429) |
| `visibilitychange` / pollers en fond | 08-20 §5 P4.4 | **OUVERT** | 1 occurrence, sur la seule source sans relais daemon |
| Plafond Twelve Data appliqué | 08-20 §6 #2 | PARTIEL | appliqué ; le toast explicite manque |
| Helper AbortController | plan 08-24 §4.2 | **OUVERT** | |
| MAP non bloquée par Fear & Greed | plan 08-24 §4.2 | PARTIEL | une erreur ne bloque plus, un fetch qui pend si |
| Screener : annulation, deadline | plan 08-24 §4.2 | **OUVERT** | un run annulé s'achève en arrière-plan |
| `screener.worker` : clamp des params | backlog 09-01 | **OUVERT** | |
| Overlays singletons `getActiveChart()` | 08-20 §5 P5.1 | PARTIEL | rejeu propre au changement de focus ; aucun injecté par slot |
| Contrat commun de contrôleur | plan 08-24 Lot 3 | **OUVERT** | |
| Navigation sur le slot focus | plan 08-24 Lot 3 | **OUVERT** | `navigateTo` force le slot 0 |
| `symboleContextuel()` | 08-20 §5 P5.2 | **OUVERT** | |
| `useDonneesAsync` / unions `Statut` | 08-20 §5 P5.3 | **OUVERT** | dérive : 3 unions le 08-20, **8** aujourd'hui |
| Ratchet UI hors `components/` | 08-20 §5 P5.4 | **OUVERT** | |
| `orderflow.worker` | 08-20 §5 P5.5 | **OUVERT** | |
| NOTE → épinglage chart | 08-20 §6 #10 | **OUVERT** | |
| VPFR rail ΔOI / `OIMAP` | 08-20 §6 #14 | OUVERT | rien codé — gel respecté |
| Onglet Insider FUND / collision FUND-FUNDX | 08-20 §6 #17 | **OUVERT** | décision produit non prise |
| Gel « aucune nouvelle fenêtre » | 08-20 §8 | DÉROGÉ | deux exceptions actées et documentées |
| Suites e2e séparées + CI | plan 08-24 §7.1 | **OUVERT** | aucune étape Playwright en CI |
| Bun épinglé / versions au contrat | plan 08-24 §7.2 | PARTIEL | Node 22 fait ; épinglage de Bun **réfuté** |
| Rétention des candles daemon | plan 08-24 Lot 5 | PARTIEL | dédup oui, rétention non |
| Test de restauration profil vierge | plan 08-24 Lot 5 | **OUVERT** | |
| Taille SQLite dans `/health` | plan 08-24 Lot 5 | **OUVERT** | |
| Budget de bundle | plan 08-24 Lot 6 | PARTIEL | aucun budget ; le chunk a grossi de ~40 kB depuis le 24-08 |
| Angle mort BPL / `mcapCandles` | backlog 09-01 | **OUVERT** | test croisé à écrire ou à écarter |
| Hydratation par élément `notes` / `portfolio` | décisions actées C.3 | **OUVERT** | annoncé « → backlog », absent du backlog |

---

*Audit du 2026-09-02. 174 agents lancés, 146 aboutis ; les 28 restants ont été perdus sur
la limite d'API et leurs constats ont été soit vérifiés directement, soit écartés comme
non vérifiés. Les chemins et numéros de ligne ont été lus entre `5a0aa04` et `c2abfbb` ;
les fichiers du daemon touchés par les tâches E.3 à E.10 (`marketFeed.ts`, `proxy.ts`,
`replay.ts`, `snapshots.ts`, `candles.ts`) ont pu se décaler de quelques lignes à
`e1e7e20` — les constats les concernant restent valides, leurs numéros de ligne sont à
recaler.*

---

## Annexe — Suites données (2026-09-02, branche `fix/revue-2026-09-02`)

Huit commits, `pnpm check` vert (4 424 tests, soit +70). **Livrés** : les 5 constats de
sévérité haute (suggestions 4, 5, 6, 9 et la référence de `variation-pct`), FUNDX / FUND /
BRIEF (11 à 13), le marqueur de navigation (14), le résidu de quantification (18), le
libellé de `fundingApr` (16), la cadence du footprint (22), le test de gate G7 (24), les
trois points de sécurité (25 à 27), et toute la vérité documentaire (2, 3, et le protocole
G100 avec son script de session).

**Laissés délibérément**, parce qu'ils demandent une décision et non un correctif :
la session partielle de VWAP et des pivots (15 — le vrai correctif est d'étendre le
backfill au dernier minuit UTC, ce qui change le volume de données chargé), l'horodatage
des buckets Coinalyze (17 — à vérifier d'abord sur une réponse réelle), le branchement du
cache du proxy daemon (21 — change le chemin de TOUTES les requêtes), et le découpage du
bundle (23).

### Deux résidus connus, introduits par rien mais bornant les correctifs

1. **L'horloge de référence des alertes reste celle de la machine.** Le contexte
   d'évaluation est construit avec `Date.now()` alors que `Candle.time` porte l'horloge de
   l'exchange. Avec la référence corrigée, la cible doit tomber pile sur l'ouverture de la
   bougie qui vient de clôturer : une horloge cliente en retard de quelques secondes fait
   glisser la référence d'une bougie de plus, et la fenêtre effective devient 2 × TF.
   L'ancien code avait la fragilité miroir, ce n'est donc **pas une régression**, mais la
   correction de `variation-pct` n'est exacte que si l'horloge est juste. Le correctif
   robuste est de dériver la cible de l'horloge des bougies au site d'appel, des deux côtés
   (front et daemon) — il touche la sémantique de `maintenant` pour tous les types de
   condition, ce qui n'est pas un correctif d'une ligne.

2. **Une souscription oisive subsiste côté daemon.** La sélection des symboles suivis n'a
   pas été filtrée par timeframe : un symbole dont la seule alerte est en 4 h ouvre encore
   un abonnement aux bougies d'une minute que le daemon n'évaluera jamais. Coût réel : une
   souscription WebSocket inutile, zéro évaluation. Une ligne, non faite faute de périmètre.

### Trois écarts d'implémentation à connaître

- **Pipeline CVD** : la garde par comparaison de références que le brief prescrivait ne
  corrige rien — `appliquerMisesAJour` réalloue le tableau des définitions à chaque
  évaluation. La garde porte donc sur l'ensemble des identifiants d'alertes CVD actives.
- La constante d'intervalle minimal a été **déplacée** vers le module d'orderflow, qui ne
  peut pas importer le composant sans créer un cycle.
- Le libellé de `fundingApr` a été **raccourci à 30 caractères** : le menu tronque sans
  attribut de survol, et le piège est déjà documenté ailleurs dans le dépôt.

### Non couvert par le gate

`scripts/ci.sh` n'a **aucune étape Playwright** : le correctif du test de gate G7 n'a été
vérifié que par son auteur, contre un serveur de développement qui servait alors les
modifications non committées des autres agents. Le changement est un bouchon de test, sans
code de production, mais le gate final ne l'a pas exercé.
