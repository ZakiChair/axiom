# AXIOM — revue intégrale, plan d’implémentation

> **For agentic workers:** utiliser `superpowers:subagent-driven-development`, avec lots indépendants en parallèle autorisés par le protocole actualisé. Les briefs et rapports restent propres à ce plan.

**Goal:** réaliser tous les points de la revue globale du 9 septembre.
**Architecture:** conserver les transports et panneaux existants, ajouter des transformations pures et des métadonnées lentes ; isoler les hypothèses et les données insuffisantes.
**Tech Stack:** React 18, Vite 6.4.3, TypeScript strict, Zustand vanilla, KLineChart 9.8, Bun/SQLite localhost.
**Spec:** `docs/superpowers/specs/2026-09-09-revue-integrale-design.md`.

## Global Constraints

- Lire la spec et BUILD-CONTRACT ; la restriction Fable est supprimée par le propriétaire.
- Français ; 39 fenêtres / 9 exchanges / 189 indicateurs conservés ; aucun backend réseau, ordre réel, nouveau runtime ou changement `@axiom/types`.
- Pas de secret rendu/loggé/exporté ; aucune souscription ; absence, quota, abonnement, stale et estimation restent explicites.
- Régressions rouges avant correctif ; tests ciblés pendant le travail, typecheck et tests du périmètre avant rapport ; contrôle global sur branche intégrée. Ne pas lancer plusieurs `pnpm check` simultanément.
- Un propriétaire par fichier ; pas de sous-agent créé par les développeurs. Rapports et diff pour revue indépendante. Aucun push/déploiement dans ces lots.

### Task 1: Fiabilité temporelle, CHAIN et qualité par métrique

**Files:** `apps/web/src/lib/referentiel.ts` et tests ; `data/referentiels.ts`, `data/regime.ts`, `store/regime.ts` et tests ; `store/onchain.ts`, `components/OnchainWindow.tsx`, `data/onchain/{coinmetrics,mempool,etherscan,bgeometrics,cache}.ts` et tests concernés ; `components/{DataWindow.tsx,brief/SectionRegime.tsx}` ; nouveaux `data/qualiteMetrique.ts`, `store/qualiteMetriques.ts`, `components/QualiteMetrique.tsx` et modules locaux de chargement CHAIN si extraction nécessaire. Ne pas toucher les fichiers macro, backtest ou tooling.

**Interfaces:** produire `QualiteMetrique` dans `data/qualiteMetrique.ts`, métadonnées sans secret : `sourceId`, `sourceEffective`, `observeLe: number|null`, `recupereLe: number|null`, `cadenceMs: number|null`, `couverture: {disponibles:number;attendus:number}|null`, `estime:boolean`, `acces: "public"|"cle"|"abonnement"|"indisponible"`, `statut: "frais"|"perime"|"partiel"|"indisponible"|"en-construction"`, `raison?:string`. Un registre vanilla exporte `enregistrerQualite(id:string, libelle:string, qualite:QualiteMetrique):void`, consommé dans DATA. Composant `QualiteMetrique` prend `{qualite:QualiteMetrique}`. Les lots suivants utilisent ces exports ; publier rapidement les signatures au contrôleur.

- [ ] Reproduire les deux défauts déjà établis :
```ts
expect(referentiel([{t:now-30*JOUR,v:1},{t:now-29*JOUR,v:2}],2,now)).toBeNull();
// Fournisseurs ETF : BTC J-1 +100M, ETH J-2 -200M → pas de composante -100M « veille ».
expect(regime.composants.find(c=>c.id==='etf')?.note).toBeNull();
```
- [ ] Référentiels : étendue dernier−premier, âge séparé, dates invalides/futures rejetées, doublons dédupliqués, nombre minimal suffisant (20 observations par défaut). Ajouter option de cadence attendue pour calculer la couverture ; les appelants funding utilisent cadence observée/connue sans supposer éternellement 8h. Refuser un percentile utilisé dans le régime si stale ou couverture insuffisante. Conserver signatures compatibles via options optionnelles et champs additionnels.
- [ ] ETF : date de référence = dernière date valide rapportée, label « séance du … ». Agréger seulement même séance et exposer présents/attendus BTC ETH SOL ; note suspendue tant que couverture incomplète ou donnée âgée de plus de 5 jours calendaires. Ce seuil conservateur n’est pas un calendrier boursier. Détails par actif conservés.
- [ ] BGeometrics : compteur de version sans clé dans state ; rotation vraie→vraie observée. CHAIN publie CoinMetrics/BG/mempool/hashrate/ETF/réseaux indépendamment, délais réseau 15s et abort unmount ; générations obsolètes ignorées. Actualisation manuelle et automatique pendant ouverture (réseau rapide 1min, sources daily cache TTL existant), un seul cycle actif, pas de purge des caches daily pour forcer un appel.
- [ ] Qualité : instrumenter métriques lentes du régime et blocs principaux CHAIN, observation réelle vs récupération, source de repli réelle et motif. DATA les liste ; BRIEF/CHAIN montrent les métadonnées sans tooltip seul pour erreurs/partiels. Les panneaux existants cohortes/historiques peuvent réutiliser le composant sans modifier leur transport hors nécessité.
- [ ] Tests : stale/futur/trous/doublons ; ETF asynchrones/incomplets et dates futures ; rotation clé ; source suspendue pendant que les autres s’affichent, abort/génération ; quota/cache du refresh. Tests ciblés via `pnpm --filter @axiom/web exec vitest run <fichiers>` puis typecheck web. Commit uniquement les fichiers du lot, rapport TDD et interfaces.

### Task 2: Macro, ALFRED et TGA

**Files:** `apps/web/src/data/macro/{catalogueMacro,harmonisation,chargerSerieMacro,fred,types}.ts`, modules NETLIQ réellement référencés par `store/netliq.ts`, `store/{macroSeries,macroRatesView,netliq}.ts`, `components/{MacroSeriesTab,MacroIndicators,NetliqWindow}.tsx`, tests correspondants ; nouveaux `data/macro/{alfred,treasury}.ts` et tests. Tests proxy ciblés si params non conservés, mais aucun changement de politique proxy sans message contrôleur.

**Interfaces:** exposer dans `data/macro/alfred.ts` une fonction `chargerVueAlfred(seriesId:string, connuLe:string, options?:{signal?:AbortSignal; debut?:string; fin?:string}):Promise<ObservationAlfred[]>`, type `{periode:string;valeur:number;connuDepuis:string;connuJusqua:string}`. Exposer `chargerPremieresPublicationsAlfred` avec les mêmes options sans cutoff, réponse même type. Ne pas exporter des timestamps intraday inventés. Réutiliser la clé FRED existante. Exporter le transport Treasury avec points `MacroSeries` et dates récupérées/sources séparées.

- [ ] Lire le rapport factuel `/private/tmp/axiom-20260909-sources-macro.md` (endpoints et rupture Treasury vérifiés), la doc officielle y citée. Les probes actuelles suffisent à démarrer ; ne pas refaire une recherche globale.
- [ ] Écrire tests des transformations exactes :
```ts
// PCEPILFE 3m : 129.681 → 130.658
expect(100*((130.658/129.681)**4-1)).toBeCloseTo(3.048,2);
// PAYEMS différences 100,200,-50 → moyenne 83.333 milliers/mois ; quatre mois consécutifs requis.
```
- [ ] Ajouter familles PCE niveau/a-a/3m/6m, emploi variation/moyenne3m, retail niveau/m-m/a-a. Unités explicites indice 2017=100, milliers, millions USD nominaux. Transformations annuelles/multi-mois seulement dates civiles consécutives, niveaux strictement positifs pour taux ; marquer séries SA et ne pas appliquer aux CPI bruts. Unités cohérentes graphiques/export/formatteurs.
- [ ] ALFRED : URL et validation stricte dates/périodes, `realtime_start=end=connuLe`, caches isolés, filtrer versions après cutoff ; premières publications via `output_type=4` + bornes realtime appropriées. UI MACRO permet date « connu au » pour séries FRED compatibles, affiche granularité quotidienne ; autres sources restent explicitement courantes. Tests param/cutoff/différentes vintages et limites.
- [ ] Treasury : `/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance`, via `extUrl` existant autorisant l’hôte. Pagination bornée historique utile et timeout 15s. Sélection avant 2022 `Treasury General Account (TGA)` + `close_today_bal`, après 2022 `Treasury General Account (TGA) Closing Balance` + `open_today_bal`, rejeter autres lignes et chaîne `null`. Convertir millions→milliards. Ne pas dater disponibilité au début du jour d’observation.
- [ ] NETLIQ : TGA quotidien avec provenance/repli WTREGEN visible, garder WALCL hebdomadaire et RRP ; contributions signées ΔWALCL − ΔTGA − ΔRRP et dates source ; choix vue hebdomadaire comparable (dates d’ancrage communes, reports identifiés) ; jamais quotidien homogène ni point-in-time Treasury historique prétendu.
- [ ] Tests nouveaux + catalogue/store/UI existants et typecheck web. Commit périmètre et rapport avec compte familles/séries final et absence d’heure/publications authentifiées si pas de clé.

### Task 3: Backtest causal, funding, Monte-Carlo et campagne OOS

**Files:** `packages/backtest/src/**`, tests ; `apps/web/src/{components/BacktestWindow.tsx,store/backtest.ts,data/backtest*.ts}` et composants backtest réellement associés ; `scripts/valider-strategies.ts` ou nouveau `scripts/valider-hors-echantillon.ts`, fixtures de protocole, rapports de validation ; `scripts/golden/**`, `packages/indicators/src/golden/**` et tests de causalité sans nouvel indicateur.

**Interfaces:** lire le contrat du réviseur `/private/tmp/axiom-20260909-contrat-math.md` avant implémentation. Étendre `ParamsBacktest` de façon optionnelle pour règlements de funding et exposer frais funding séparés dans trades/résultat sans changer les anciens résultats sans funding. Monte-Carlo conserve le mode iid et sa métrique terminale, ajoute mode blocs et probabilité de franchissement en trajectoire.

- [ ] Écrire les cas numériques indépendants du contrat et reproduire les sorties anticipatives signalées ; les sorties chart projetées/rétro-déplacées ne doivent pas fournir le futur aux règles de stratégie. Pas de masquage général de tests.
- [ ] Funding appliqué uniquement aux positions ouvertes aux instants concernés, avec convention entrée/sortie écrite, taux/mark réellement connus, signe long/short ; ne pas approximer un mark futur. UI permet choix funding réel pour perps supportés et affiche couverture/absence ; stops évalués à clôture clairement indiqués.
- [ ] Bootstrap blocs contigus avec longueur configurable bornée et graine déterministe ; 10 trades minimum, max 2000 simulations maintenus. Mesure distincte `P(capital final < 0)` et `P(min capital <= seuil)`.
```ts
// Une trajectoire 100 → -10 → 110 a ruine en cours mais capital terminal positif.
// Funding +1% sur notionnel 1000 : long paie 10 ; short reçoit 10.
```
- [ ] Protocole OOS écrit AVANT téléchargement/calcul : quelques règles déjà exprimables, paramètres fixes et période réservée `2026-07-29T00:00:00Z` → `2026-09-09T00:00:00Z`, BTC/ETH 1h/4h ; warmup antérieur uniquement, pas de choix des gagnants après résultats. Baseline coûts frais .05%, slippage .02%, scénarios ×1/×2/×3 et paramètres ±20% uniquement pour sensibilité (sans sélection), version/hash/dates/source consignés. Distinguer période historiquement déjà observée par l’humain et règles figées pour cette campagne : test temporel réservé au script, pas garantie d’indépendance absolue.
- [ ] Effectuer la campagne sur données réelles avec téléchargement borné/cache fichiers et publier métriques, n trades, drawdowns, incertitude Monte-Carlo ; absence d’accès/données = résultat indisponible documenté, aucune validation fictive. Conserver les 30 stratégies globalement non validées.
- [ ] Ajouter oracles numériques indépendants pour RSI/ATR/VWAP ou indicateurs décisifs non couverts, références/version de génération ; tests prefixe qui démontrent non anticipation. Aucune dépendance Python runtime.
- [ ] Tests package/backtest et web concernés, typecheck, rapport campagne et TDD, commit. Revue math indépendante obligatoire.

### Task 4: Flux communs et économie des chaînes

**Depends:** Task 1 ; ne pas changer ses signatures. **Files:** nouveaux `data/onchain/{fluxCapitaux,economieChaines}.ts` et tests, store lent associé ; `components/onchain/{FluxCapitaux,EconomieChaines}.tsx` ; branchements `OnchainWindow.tsx`, `components/brief/SectionOnchain.tsx` (ou section équivalente existante), `StablecoinsWindow.tsx`, `SectorsWindow.tsx` (retrouver noms réels) ; `data/onchain/etfHistory.ts` si ratios historiques requis.

**Interfaces:** consommer QualiteMetrique/enregistrerQualite du lot1. Un même loader/cache sert les trois vues de flux, aucune triple collecte identique.

- [ ] Aligner dans une vue commune les flux ETF datés, stock stablecoins et variations7j, realized cap30/90j, prix réalisé STH/cohortes et réserves/netflows. Afficher niveaux/variations/périodes distincts et disponibilité par métrique ; ne pas additionner ces unités en un faux score de flux.
- [ ] ETF ratio flux/AUM jour exact, historiques 5/20 déjà existants préservés ; percentile si minimum20points et profondeur valide de lot1. Réutiliser alertes composites existantes pour lien « créer une alerte » sur métriques réellement supportées, ou ajouter source lente spécifique avec instantané explicatif et qualité, sans alerte basée sur stale. Historique de ratio absent ne se reconstruit pas depuis encours courant.
- [ ] Économie Ethereum/Solana/Base/Arbitrum via endpoints publics vérifiés : `/v2/historicalChainTvl/{chain}`, `/overview/dexs/{chain}`, `/overview/fees/{chain}?dataType=dailyFees|dailyRevenue`, stablecoins hôte `stablecoins.llama.fi/stablecoincharts/{chain}`. Horizons30/90/365 jours, niveaux et variations, parts à dates communes ; caches 1h et concurrencemax3, erreurs indépendantes.
```ts
// totalCirculating contient diverses devises : agréger totalCirculatingUSD, jamais USD+JPY natifs.
// Une chaîne sans revenus connus affiche indisponible, pas 0.
```
- [ ] Frais vs revenus séparés, séries temporelles affichées. Quantité native seulement pour stablecoins ancrés USD dont données réellement fournies ; TVL USD non neutralisée par ETH. Absence d’unités sous-jacentes explicitée.
- [ ] Tests parseurs/alignement/cache/absence/ratios/alertes et rendu via tests existants SSR ou e2e lot8 ; typecheck, commit, rapport.

### Task 5: Évènements, consensus et publications

**Depends:** Task 2. **Files:** `apps/web/src/data/{eco,evts,eventStudies}.ts` (noms réels), store eco/evts, `components/{EcoWindow,EvtsWindow}.tsx`, nouveau module d’archive locale des publications/consensus et tests.

**Interfaces:** consommer fonctions ALFRED lot2 et caches existants ; archives sérialisées avec source, heure de collecte et connuDepuis ; aucun secret.

- [ ] Réparer H0 : événement inclus seulement si sa date appartient à l’intervalle réel de la bougie et OHLC attendues continues ; sinon occurrence exclue avec motif.
- [ ] Historique première publication/révisions ALFRED pour CPI/PCE/NFP/retail ; afficher valeur initiale/révisée et période. Conserver consensus daté observé depuis calendrier courant pour les futures publications ; ne jamais archiver la prévision capturée après annonce comme consensus avant annonce. Pas de fausse archive rétrospective.
- [ ] Heure effective : transmettre horaires exacts lorsque calendrier sourcé les fournit, garder horaires FRED reconstitués comme approximatifs et exclure du mode intraday strict. Autoriser import JSON d’archives sourcées avec validation d’heure/consensus/valeur/dates si historique public indisponible, modèle d’import explicite et export sans secret ; fonctionnalité opérationnelle, pas fixture présentée comme réel.
- [ ] ECO ouvre étude EVTS BTC/ETH avec même événement, mesure rendements/volume/vol réalisée avant-après aux horizons5/15/60min et24h quand données couvrent, taille d’échantillon et dates ; association temporelle sans causalité affirmée.
```ts
// consensus capturé après publishedAt → consensusAvantAnnonce=null.
// Événement 08:30 et bougies 08:00 puis09:00 en M1 → H0 exclu, pas08:00.
```
- [ ] Tests archivage/versions/temps/FXDST/absence/couverture/réaction, typecheck, commit et rapport des sources réellement observées.

### Task 6: Microstructure, gamma et interprétation du régime

**Depends:** Task 1. **Files:** `data/{depthMicrostructure,gexDex,gammaRegime,regime,screener*}.ts`, stores DOM/EQS pertinents, `components/{DomWindow,OptionsMonitorWindow,EquityScreenerWindow}.tsx` (noms réels), `components/brief/SectionRegime.tsx` ; nouvelles fonctions pures ciblées et tests.

**Interfaces:** données prix/OI/CVD aux temps réels existants, options locales sérialisables compatibles ; qualité lente lot1 pour résumé, aucune écriture React par tick.

- [ ] Configurations prix/OI/CVD : signe/variation sur fenêtre bornée, min observations, couverture et persistance calculée à temps continu ; désaccords distincts prix↑/OI↑/CVD↓ etc ; pas d’OI ou CVD de fallback silencieux. EQS n’a pas recorderCVD : disponibilité dépend d’historique réel du symbole, proposer diagnostic du symbole suivi plutôt qu’inventer du CVD universel.
- [ ] UI DOM et EQS expose fenêtre/seuils/persistance, coût d’exécution et qualité ; reset changement exchange/symbole/reconnexion/trou. Tests flux neutre, réarmement, déconnexion et unités.
- [ ] Gamma : calculer au moins trois scénarios de signe dealer (convention existante calls+/puts−, tous long gamma, tous short gamma) à mêmes contrats/spot ; OMON affiche GEX/flip/verdict par hypothèse, BRIEF indique sensibilité quand verdict change. Aucun scénario présenté comme position dealer observée.
- [ ] Régime : contributions explicites (note/n disponible), nombres de signes opposés et poids de vol corrélée ; évaluer changement de verdict pour seuils ±20% avec mêmes entrées, résultats de stabilité visibles, ne pas remplacer les seuils du score par une optimisation cachée.
```ts
// À mêmes contrats, tous-long → GEX >=0 ; tous-short → GEX<=0 ; le spot/oi restent identiques.
```
- [ ] Tests math/intégration et typecheck ; commit et rapport clair de disponibilité CVD dans EQS.

### Task 7: WHALES, unlocks et bridges

**Files:** `apps/daemon/src/whales.ts`, migrations/persistance ciblées et tests ; `apps/web/src/data/whales.ts`, store et `components/WhalesWindow.tsx` ; nouveaux `data/onchain/defillamaPro.ts`, `store/defillamaKey.ts`, panneau ciblé unlocks/bridges ; `SettingsPanel.tsx`, `CapWindow.tsx`, `SectorsWindow.tsx` (noms réels) ; politique proxy `shared/extapi-hosts.ts` et routes existantes seulement si nécessaire pour authentification. Coordination SECT avec lot4 : ne pas modifier même fichier simultanément ; composants d’abord, branchement après accord contrôleur.

**Interfaces:** labels `{entite,source,verifieLe,confiance}` associés aux adresses existantes ; état de continuité explicite. Clé DefiLlama Pro en localStorage via getter, store expose présence/version uniquement. Qualité du lot1 si disponible, sinon import après.

- [ ] WHALES : enrichir labels statiques de provenance/date réelles (origine actuelle explicitée, date inconnue reste inconnue) ; grouper par entité, marquer interne si deux adresses même entité connue, stats connus/inconnus. Curseur/dernier succès persisté et trous de collecte exposés, pagination bornée et risque de reorg sans prétendre finalité immédiate. Pas d’auto-label de change BTC.
- [ ] DefiLlama Pro : vérifier docs officielles et contrat réel, endpoints `/api/emissions`, `/api/emission/{protocol}`, bridges sous `/bridges/...`, clé dans chemin du fournisseur ne doit jamais apparaître dans erreurs, logs ou état. Route dédiée à allowlist de chemins bornés si proxy nécessaire, revue sécurité. Pas de clé ni abonnement = UI état d’accès ; aucune souscription.
- [ ] Calendrier unlocks dans CAP/SECT : prochaines dates, quantité/notionnel si prix source daté, %flottant et %volume24h avec dénominateurs réels du même token ; événements cliff/linéaires distingués, pas d’unlock déduit d’une distribution cumulée sans bornes. Import/export calendrier sourcé validé utile si accès non configuré, sans exemple présenté comme réel.
- [ ] Bridges : historique chaîne, entrants/sortants nets et dates réellement servis, unités et horizon ; accès public402 déjà vérifié. Affichage indépendant des autres séries, erreurs401/402/403/429 explicites et secret redacted.
```ts
// Même entité aux deux extrémités → interne ; une extrémité inconnue → pas d’attribution interne certaine.
// float/volume nul ou absent → ratio null, jamais Inf ou0.
```
- [ ] Tests labels/continuité/parsing/ratios/accès/secret/proxy, typecheck, commit et rapport ; aucun test Telegram réel.

### Task 8: Maintenance, budgets et parcours navigateur

**Depends:** attendre fin des mutations de dépendances/tests des autres lots. **Files:** package.json concernés, pnpm-lock.yaml, scripts/ci.sh, .github/workflows/ci.yml, nouveau script/test budget build, e2e nouvelles fonctionnalités et Playwright configuration minimale.

- [ ] Passer les quatre Vitest3.2.7 à4.1.11, respecter Node/Vite existants ; lire migration4 officielle, corriger uniquement incompatibilités réelles. Aucun nouveau runtime. Audit puis suite globale.
- [ ] Budget initial JS bloquant à **1 220 000 octets bruts / 360 000 gzip niveau9** (base mesurée1162478/342187), entrée HTML/modulepreloads et imports statiques transitifs dédupliqués via manifest Vite ; dynamique mesuré séparément. Le fichier absent/malformed échoue, dépassement échoue. Tests vrai mini graphe et dépassement, pas test recopiant constante.
- [ ] Mesurer workspace représentatif depuis build prod : navigation aux nouveaux panneaux, durée des interactions et longues tâches, ressources réellement chargées ; tester état source indisponible et données réelles disponibles, garder hermétique distinct du live. Si budget dépassé corriger la dépendance causale, ne pas relever la limite en douce.
- [ ] E2E nouveaux parcours : ETF partiel, CHAIN source lente+rotationclé, MACRO additions/asof, TGA, flux/rotation/unlocks sans clé, macroévènements, DOMgammaWHALES, backtestmodes. Port dédié `AXIOM_E2E_PORT=5239`, fixtures datées explicitement hermétiques.
- [ ] `pnpm check`, `AXIOM_E2E_PORT=5239 pnpm check:e2e`, `pnpm audit --json`, rapport résultats exacts, commit. La revue indépendante peut demander correctifs dédiés.

### Task 9: QA réelle, documentation et livraison

**Files:** docs/revue-2026-09-09.md, README.md, BUILD-CONTRACT.md, docs/superpowers/progress/2026-09-09-revue-integrale.md et registre G100 `docs/superpowers/plans/2026-07-22-gate-g100-qa.md` ; scripts de QA ciblés si nécessaire sur brief explicite.

- [ ] Vérifier branche assemblée et sécurité/math via agent indépendant, corrections par auteurs ; rapport des accès/authentifications réellement testés, comparer tous les critères1–17 de la spec.
- [ ] Exécuter profils/bases isolés pour vraie restauration et trajet donnée→lecture→alerte→journal sans notification externe à d’autres. Contrôler les préconditions scripts G5/G9, ne pas arrêter les services personnels existants.
- [ ] Ouvrir application visible pour tenue30min, observer données/restauration. La coupure90s nécessite une coupure réelle applicable à l’application et rétablissement vérifié ; ne pas assimiler fixtures/émulation à Wi-Fi off si registre l’exige. Bannière macOS doit être observée. Conserver NON EXÉCUTÉ pour ce qui n’est pas matériellement observé, avec raison.
- [ ] Documenter usage des nouvelles vues, méthodes, sources/droits, coûts, périodesOOS et résultats. Retirer la note de blocage Fable active ; ne pas réécrire les faits historiques de revues passées.
- [ ] Mettre à jour progression complète, totaux catalogue et tests réellement exécutés ; bilan final de ce qui reste dépendant d’un accès fournisseur ou observation humaine. Travail local vérifié et revue finale, pas de push ou déploiement automatique.
