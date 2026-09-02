# Lot v2.7 « Décider » — alerte composite, backtest en R (stop ATR + sizing risque), coût d'exécution L2

Date : 2026-09-02 · Registre indicateurs : **179 → 179** (aucun ajout) · Fenêtres : **39 → 39**
(aucune) · Fournisseurs : **aucun** · Origine : demande Zaki (« quels indicateurs, fonctions
ou features pour pousser l'utilité d'Axiom » → trois items retenus sur les quinze proposés,
« écris la spec »). Statut : **spec de design à valider** avant découpage en briefs.

**Constat fondateur** : les trois items relient des moteurs qui existent déjà au lieu d'en
créer. (A) `@axiom/alerts` évalue neuf types de condition mais UNE seule par `AlertDef`
(`packages/alerts/src/types.ts:143-152`) — le setup phare du doc 02 (« divergence CVD
spot/perp ET funding extrême du même côté ») n'est pas exprimable. (B) `@axiom/backtest`
ne connaît que `tailleFixe` en notionnel et `stopPct` (`packages/backtest/src/types.ts:92-102`)
alors que l'outil POSITION (`chart/position.ts`) dimensionne en % de risque via
`store/risque.ts` et qu'EXPY (`data/expy.ts`) raisonne en R : trois modules, trois unités.
(C) Le DOM reçoit déjà le carnet L2 complet (`data/depth.ts`, `@depth@100ms` + snapshot
1000 niveaux) mais n'en tire que ladder/depth/tape : aucun coût d'exécution, aucun
déséquilibre — le chaînon manquant entre « taille en $ » et « ce que ça coûte de l'exécuter ».

Invariants BUILD-CONTRACT : calculs PURS et testés (packages + `data/*.ts` sans I/O) ;
aucune donnée haute fréquence dans React (DOM peint en rAF, runtime alertes hors
render-loop) ; `@axiom/types` intouché ; aucune dépendance nouvelle ; WS du front directs ;
daemon hors chemin chaud ; docblocks FR ; `pnpm check` vert par brief + post-merge.

**Règle d'honnêteté du lot** : (A) une alerte composite dont UNE sous-condition n'est pas
évaluable dans le contexte courant ne déclenche pas et ne se ré-arme pas (armement figé) —
jamais un « ET » évalué sur des données partielles. (B) tout R affiché est un R **net**
(frais + slippage) rapporté au risque **initial** figé à l'entrée ; l'étiquette le dit. (C)
un notionnel qui dépasse le carnet reçu est affiché « > carnet », jamais extrapolé.

> **Décision requise (écart au gel G100)** — `BUILD-CONTRACT.md` §État actuel gèle « toute
> nouvelle fenêtre ni fonctionnalité de surface avant le verdict ». Ce lot n'ajoute ni
> fenêtre, ni fournisseur, ni indicateur, ni migration (il reste dans les non-objectifs
> stricts du plan 2026-08-24 §12) mais ajoute trois **capacités** dans des surfaces
> existantes. Si Zaki l'acte, l'orchestrateur consigne l'exception dans
> `BUILD-CONTRACT.md` (même formulation que WHALES/BPL : date, demande utilisateur
> explicite, périmètre) — Lot 0 ci-dessous. Sinon, la spec attend le verdict.

---

## 0. Lot 0 — consignation (orchestrateur)

- `BUILD-CONTRACT.md` : troisième exception actée « 2026-09-02 (lot v2.7 : alerte composite,
  backtest en R, coût d'exécution DOM — aucune fenêtre/fournisseur/indicateur) ».
- README « Décider » : mention courte après livraison (pas avant).

## 1. Item A — Alerte composite (`@axiom/alerts` + runtime front + daemon)

### 1.1 Modèle (`packages/alerts/src/types.ts`)

```ts
/** Sous-condition admise dans une composition (tout sauf composite et whale-flux). */
export type ConditionSimple = Exclude<Condition, ConditionComposite | ConditionWhaleFlux>;

/** ET conjonctif de 2 à 4 sous-conditions, évaluées dans le MÊME contexte (même symbole). */
export interface ConditionComposite {
  type: "composite";
  conditions: ConditionSimple[]; // 2 ≤ length ≤ 4, pas d'imbrication
}
```

`Condition` gagne `| ConditionComposite`. Contraintes (validées côté store/UI, et le
moteur renvoie `null` — non évaluable — si violées, jamais d'exception) :
- `2 ≤ conditions.length ≤ 4` ; aucune sous-condition `composite` (pas d'imbrication) ni
  `whale-flux` (convention de portage `symbol = actif` incompatible avec un def porté par
  une paire) ;
- `prix-croise` en sous-condition : sens `hausse`/`baisse` uniquement (sémantique de
  NIVEAU « prix ≥/≤ niveau ») — `les-deux` est un ÉVÉNEMENT dépendant de `prixPrecedent`,
  non composable ;
- `regime-seuil` admis (global : `ctx.regimeScore` ne dépend pas du symbole) ;
- toutes les sous-conditions de bougie partagent le `timeframe` de la def (un seul TF par
  alerte, comme aujourd'hui).

### 1.2 Sémantique d'évaluation (`packages/alerts/src/engine.ts`)

- **État instantané par sous-condition** : chaque type à seuil se réduit déjà à un booléen
  `satisfaite` avant `frontArme` (`engine.ts:105`). On extrait cette réduction en
  `etatCondition(c: ConditionSimple, ctx): { satisfaite: boolean; valeur: number } | null`
  (null = non évaluable) et on réécrit les `evalX` existants à seuil comme
  `frontArme(def.arme, etat.satisfaite)` — **refactor pur, tests existants inchangés**. Les
  deux chemins à ÉVÉNEMENT (`prix-croise` `les-deux`, `indicateur-croisement` autonome,
  `engine.ts:120` et `:176`) ne sont pas touchés : ils ne passent par `etatCondition` qu'en
  sous-condition, avec la sémantique ci-dessous.
- `indicateur-croisement` en sous-condition = « croisement constaté sur les deux dernières
  bougies CLÔTURÉES » (`deuxDernieresPaires`, `engine.ts:356`) : vrai pendant toute la bougie
  courante, faux ensuite. C'est la fenêtre de coïncidence naturelle d'une composition (une
  bougie du TF de la def) — aucun état par sous-condition à persister, aucune `fenetreMs`.
- **Composite** : `satisfaite = ∧ etatCondition(cᵢ)` ; si UN `etatCondition` renvoie `null`
  → le composite renvoie `null` (armement figé, cf. règle d'honnêteté). Puis `frontArme`
  standard sur la def (calibrage à la 1re évaluation, déclenchement sur front montant,
  ré-armement quand le ET redevient faux). `valeur` du déclenchement = nombre de
  sous-conditions (= `conditions.length`) — le journal n'a pas d'autre scalaire honnête.
- `decrireCondition` (`describe.ts`) : sous-descriptions jointes par « ET » ; `formaterDuree`
  réutilisé tel quel.

### 1.3 Runtime front (`apps/web/src/alerts/runtime.ts`)

Aujourd'hui chaque source évalue son propre sous-lot avec un contexte PARTIEL (ticker →
prix ; clôture → bougies ; poll → funding ; stores → cvd/régime ; poll → liq). Un composite
exige un contexte FUSIONNÉ :
- nouveau cache `contextes: Map<symbol, Partial<ContexteAlerte>>` (hors React) — chaque
  source existante y ÉCRIT sa contribution (prix + précédent, bougies clôturées du symbole
  AFFICHÉ uniquement, funding rate/z, kind CVD, score régime, liq/min) juste avant son
  `appliquerResultat` habituel (`runtime.ts:88`) — aucune logique existante déplacée ;
- une fonction `evaluerComposites(symbol)` filtre les defs `composite` actives du symbole et
  appelle `appliquerResultat(lot, ctxFusionné)` ; déclenchée après chaque écriture de
  source pour ce symbole, **throttlée à 1 s par symbole** (le ticker écrit plusieurs fois
  par seconde ; les sous-conditions de bougie ne changent qu'à la clôture — inutile de
  recalculer un indicateur à chaque tick : `etatCondition` recalcule `computeIndicator`,
  donc le throttle est aussi une garde perf) ;
- les entrées `undefined` du cache restent `undefined` (non évaluable) : bougies absentes
  pour un symbole non affiché ⇒ composite avec sous-condition de bougie non évaluable sur
  ce symbole — comportement IDENTIQUE aux alertes de bougie simples aujourd'hui (front sur
  le symbole affiché, daemon pour le reste) ; `dernierPrix` est requis par `ContexteAlerte`
  → tant qu'aucune source n'a écrit de prix pour le symbole, le lot composite n'est pas
  évalué du tout ; `regimeScore` est GLOBAL (indépendant du symbole) et fusionné dans tout
  contexte ;
- les (re)souscriptions ticker/funding/liq (`resyncTicker` et équivalents) DOIVENT compter
  les composites : `symbolesConcernes(type)` parcourt `condition.conditions` — helper pur
  `typesDeDef(def): Set<string>` (exporté de `@axiom/alerts`, réutilisé par le daemon).

### 1.4 Daemon (`apps/daemon/src/alerts.ts`, Dev B)

- `TYPES_COMPOSITE = new Set(["composite"])`, évalué **dans `onBougieClose`** (`alerts.ts:443`,
  1 fois/min/symbole) avec contexte fusionné : `dernierPrix`/`prixPrecedent`/`candles` du
  feed + **cache funding** `Map<symbol, { rate, z?, ts }>` écrit par `pollFunding`
  (`alerts.ts:472`, aujourd'hui non conservé entre deux polls) + `liqUsdParMin` via
  `sommeLiqUsdParMin` (`alerts.ts:371`). Le cache funding est **périmé après 3 ×
  `PERIODE_FUNDING_MS`** → entrée retirée (sous-condition funding non évaluable plutôt
  qu'un rate rassis).
- Un composite contenant `cvd-spot-perp-div` ou `regime-seuil` est **front-only** (le daemon
  n'a ni pipeline orderflow ni score) : `evaluableDaemon(def)` pur l'écarte — même patron
  qu'`evaluableSurBougie1m` (`alerts.ts:178`), appliqué aussi au TF (`timeframe` ≠ 1m ⇒
  front-only si une sous-condition est de bougie).
- `symbolesBinanceActifs`, `symbolesFundingActifs`, `symbolesLiqCascadeActifs` comptent les
  composites via `typesDeDef` (sinon un composite « funding ET prix » n'aurait ni feed ni
  poll). `liqFeed.fusionnerSymbolesLiq` inchangé (il lit `symbolesLiqCascadeActifs`).
- Anti-doublon heartbeat, journal, notification : inchangés.

### 1.5 UI (`apps/web/src/components/AlertsPanel.tsx`, `store/alerts.ts`)

- Le formulaire de création reste **monolithique** (état par type, `soumettre`
  `AlertsPanel.tsx:193`) ; on n'en extrait pas des sous-composants. Ajout d'un mode
  **« Composer »** (case à cocher au-dessus du sélecteur de type) : le bouton « Créer »
  devient « + Ajouter à la composition » et empile la condition construite (validations
  existantes conservées + refus des types interdits §1.1 avec message) dans une liste
  locale (`decrireCondition` par ligne, ✕ par ligne) ; sous la liste, « Créer l'alerte
  composée (n/4) » actif si `2 ≤ n ≤ 4`. Symbole/source = ceux de la première
  sous-condition (les suivantes héritent : le champ symbole est verrouillé pendant la
  composition). `timeframe` de la def = TF courant si ≥ 1 sous-condition de bougie (règle
  actuelle `AlertsPanel.tsx:287`).
- Liste des alertes : libellé composite multi-ligne (une sous-condition par ligne, ⋀ en
  tête) ; pastille « front-only » quand `!evaluableDaemon(def)` (pattern existant
  regime/cvd) ; `IS_VERCEL` : composite créable (aucune sous-condition daemon-only admise).
- `store/alerts.ts` : `ajouter` valide la forme (`validerComposite` pure, exportée, testée) ;
  persistance `AlertDef` **inchangée** (union étendue, hydratation par item déjà tolérante) ;
  dual-write KV inchangé — un daemon ancien ignore le type (filtres par set) : **aucune
  migration**.

### 1.6 Tests

- `packages/alerts` : (a) refactor `etatCondition` → suite `engine.test.ts` verte sans
  modification ; (b) composite : calibrage, déclenchement quand la dernière sous-condition
  devient vraie, ré-armement quand une seule redevient fausse, `null` si une sous-condition
  est non évaluable (et armement conservé), croisement vrai sur la bougie du croisement
  puis faux à la suivante, refus (null) d'imbrication / `whale-flux` / `prix-croise
  les-deux` / n hors [2,4] ; `decrireCondition` « A ET B » ; `typesDeDef`.
- `apps/web` : `validerComposite` ; runtime — test câblé (patron `d3db324`) : deux sources
  écrivent le cache, le composite déclenche à la clôture de bougie, pas au tick seul ;
  throttle 1 s.
- `apps/daemon` : `evaluableDaemon`, comptage des symboles avec composites, cache funding
  périmé → non évaluable, évaluation `onBougieClose` avec contexte fusionné (fixtures).

## 2. Item B — Backtest en R : stop ATR + sizing en % de risque (`@axiom/backtest`)

**Dépendance de séquencement** : `packages/backtest/src/{engine,types}.ts` sont aussi les
fichiers du **Lot 2 §5.1** (drawdown mark-to-market, plan 2026-08-24, P1, non landé au
2026-09-02). Un seul dev sur ces fichiers : soit le même brief/branche que §5.1, soit
après son merge. Conformément à `.devin/provider-rules.md`, le **réviseur pilote** ce
chantier (math/expectancy).

### 2.1 Modèle (`types.ts`)

```ts
export interface StopAtr { length: number; mult: number }   // ex. { length: 14, mult: 2 }
export interface StrategieDef {
  …existant…
  /** Stop en multiples d'ATR (def `atr` de @axiom/indicators, sortie "atr"). Exclusif avec stopPct. */
  stopAtr?: StopAtr;
  /** Risque par trade en % de `params.capitalInitial`. Requiert un stop (pct ou atr) ; sinon ignoré. */
  risquePct?: number;
}
export interface TradeResultat { …existant…; risqueInitial: number | null; r: number | null }
export interface StatsBacktest { …existant…; nbTradesR: number; sommeR: number; expectancyR: number | null }
```

- `stopPct` **et** `stopAtr` définis : le store l'empêche ; le moteur retient `stopAtr`
  (documenté dans le docblock, testé) — jamais d'exception dans un moteur pur.
- `risquePct` sans stop : ignoré → `tailleFixe` (le store grise le champ ; testé).

### 2.2 Moteur (`engine.ts`)

- **Niveau de stop FIGÉ à l'entrée**, porté par `PositionOuverte.niveauStop: number | null`
  (`engine.ts:199`) : pct → `prixEntree × (1 ∓ pct/100)` ; atr → `prixEntree ∓ mult ×
  ATR[i]` où `i` est la barre de **décision** (`runBacktest` `engine.ts:309`, aucun
  look-ahead : l'ATR de la barre de fill n'est pas connu à la décision). La série ATR est
  résolue via `resoudreOperande({type:"indicateur", indicateurId:"atr", params:{length},
  output:"atr"})` — mémoïsée dans le `cache` existant. ATR indéfini à `i` (amorce) → **pas
  d'entrée** (le signal est ignoré, comme un `prixEntree ≤ 0` aujourd'hui).
- `decisionSortie` (`engine.ts:252`) compare la clôture au `niveauStop` figé (au lieu de
  recalculer depuis `stopPct`) — même convention « clôture, pas d'intrabar », même priorité
  stop > target > règle. **Stop fixe** (pas de trailing — frigo).
- Sizing (`engine.ts:332`) : si `risquePct` défini ET `niveauStop !== null` :
  `risqueUsd = params.capitalInitial × risquePct/100`, `distanceStop = |prixEntree −
  niveauStop|` (prix de fill, slippage inclus), `quantite = risqueUsd / distanceStop` ;
  sinon `quantite = tailleFixe / prixEntree` (inchangé). **Décision** : fraction du capital
  **INITIAL**, non composée — les R restent comparables d'un trade à l'autre et la série de
  R est stationnaire ; le compounding est une option d'affichage future (frigo), pas une
  hypothèse cachée du moteur.
- `cloturerTrade` (`engine.ts:211`) : `risqueInitial = niveauStop === null ? null : quantite
  × distanceStop` ; `r = risqueInitial ? pnl / risqueInitial : null` (pnl **NET** frais +
  slippage). `pnlPct` : dénominateur = notionnel d'entrée réel (`quantite × prixEntree`) —
  aujourd'hui `strat.tailleFixe` (`engine.ts:228`), faux dès que le sizing est en risque ;
  pour un sizing notionnel les deux coïncident (test de non-régression).
- `calculerStats` : `nbTradesR`, `sommeR`, `expectancyR = sommeR / nbTradesR` (null si 0).
  Convention alignée sur `data/expy.ts` (breakeven R = 0 compté dans n). **Différence
  documentée** : EXPY = R brut saisi à la main ; BT = R net — le libellé UI le dit.
- `monteCarlo.ts` / `statsRejeu.ts` : inchangés (ils lisent `pnl`).

### 2.3 Store et fenêtre BT (`store/backtest.ts`, `components/BacktestWindow.tsx`)

- `StrategiePreset` (`backtest.ts:178`) : `stopAtr?: StopAtr | null`, `risquePct?: number |
  null` — presets utilisateur anciens sans ces champs = comportement inchangé ; les 9
  builtins (`backtest.ts:283`) **ne changent pas** (leurs mesures consignées le 2026-07-28
  resteraient sinon fausses).
- Builder : champ « Stop » → sélecteur `aucun | % | ATR` (longueur, multiple ; défaut 14 × 2
  à la sélection) ; champ « Taille » → `notionnel fixe (USD) | risque % du capital`, la 2e
  option grisée avec info-bulle si stop = aucun ; bouton « Reprendre RISQUE » pré-remplit
  `risquePct` (et `capitalInitial` si `risqueStore.capital` non null) — lecture seule
  depuis `store/risque.ts`, aucun couplage inverse.
- Résultats : colonne « R » par trade (— si null) ; bandeau stats : « Expectancy R »
  (+ n, ΣR) avec libellé « R net (frais + slippage), risque initial = distance au stop à
  l'entrée » ; export/rapport existants héritent des nouveaux champs si sérialisés tels
  quels (vérifier `data/rapport.ts` ne casse pas sur `risqueInitial: null`).
- `workers/backtest.worker.ts` : aucune logique, types transmis.

### 2.4 Tests (`engine.test.ts`, contrat)

Stop ATR : niveau figé à `prixEntree − 2·ATR[i]` (long) et `+` (short) ; ATR indéfini →
pas d'entrée ; `stopPct` + `stopAtr` → atr retenu. Sizing : `quantite = (capital ×
risque%) / distance` exact ; `risquePct` sans stop → `tailleFixe` ; `r` = pnl net /
risque (trade stoppé exactement au niveau → `r ≈ −1 − frais/risque`, pas −1 : test qui
fige que les frais sont dans le R) ; `pnlPct` inchangé en sizing notionnel (non-régression
sur la suite existante) ; `expectancyR` null sans stop, moyenne sinon, breakeven compté.

## 3. Item C — Coût d'exécution & déséquilibre du carnet (DOM)

### 3.1 Module pur `apps/web/src/data/depthExecution.ts` (+ `.test.ts`)

Aucun I/O, entrée = `OrderBook` de `data/depth.ts` (Maps prix→qté) ; `depth.ts` **intouché**
(plomberie WS/couture, fichier lourd). Fonctions :

```ts
/** Marche le carnet (asks pour un achat, bids pour une vente) jusqu'à consommer `notionnelUsd`. */
export function coutExecution(livre: OrderBook, cote: "achat" | "vente", notionnelUsd: number):
  { prixMoyen: number; slippageBps: number; niveaux: number; quantiteBase: number;
    couvert: boolean; notionnelCouvert: number; pirePrix: number } | null;
/** Notionnel cumulé (USD) disponible à ±pct du mid, par côté. */
export function profondeurAPct(livre: OrderBook, pct: number): { bidUsd: number; askUsd: number } | null;
/** Déséquilibre I = (Σbid − Σask)/(Σbid + Σask) en QUANTITÉ base sur les n meilleurs niveaux de chaque côté, ∈ [−1, 1]. */
export function desequilibre(livre: OrderBook, n: number): number | null;
```

- `slippageBps` = écart du prix moyen au **mid** (`meilleursNiveaux`, `depth.ts:135`) en
  points de base, signé positif quand défavorable ; `null` si mid indéfini (un côté vide).
- Carnet épuisé avant le notionnel → `couvert = false`, `notionnelCouvert` = fraction
  réellement parcourue, `prixMoyen`/`pirePrix` sur cette fraction (l'UI affiche « > carnet »,
  pas ces chiffres — §3.2). Le carnet reçu = snapshot 1000 niveaux/côté + diffs : sa
  couverture en % du mid est calculée (`pirePrix` des deux extrémités) et affichée.
- Tri des clés à chaque appel (`Array.from(map).sort`, ≤ ~2 000 niveaux, ≤ 15 fps) —
  acceptable ; si le profil montre un coût, réutiliser `profondeurCumulee` (`depth.ts:210`)
  déjà triée. Hors frais taker (étiqueté).

### 3.2 Rendu (`components/DomWindow.tsx`, `store/dom-ui.ts`)

- **Bandeau « COÛT »** en pied des onglets LADDER et DEPTH (pas de 4e onglet : le coût se
  lit À CÔTÉ du carnet). Peint dans la boucle rAF existante (~15 fps, `MIN_FRAME_MS`),
  hors React, tokens de thème via `lireTokensCanvas`. Contenu, police mono :
  - une ligne par notionnel de `NOTIONNELS_COUT = [10_000, 50_000, 250_000, 1_000_000]`
    (constante `dom-ui.ts`, à côté de `SEUILS_GROS_TRADE`) : `achat +x bps · vente −y bps`
    ; non couvert → « > carnet » en `textDim` ;
  - ligne « ±0,5 % : bid $A · ask $B » (`profondeurAPct(livre, 0.005)`) ;
  - ligne « déséquilibre I(10) » : valeur + **sparkline 60 s** (ring buffer 60 points, 1
    échantillon/s dans la boucle rAF, hors React — même patron que `tradesRef`).
  - pied : « Binance spot · carnet reçu ±c % (N niveaux) · descriptif, hors frais ».
- `domUiStore` : `coutVisible: boolean` (défaut true, éphémère comme le reste du store) +
  `toggleCout` ; commande ⌘K « DOM — coût d'exécution » ajoutée à `commandes`
  (`dom-ui.ts:66`, ouvre le DOM et bascule le bandeau). Hauteur du bandeau réservée par
  les onglets (LADDER : `LADDER_ROWS` inchangé, la ligne plancher `ROW_H_MIN` absorbe).
- Sources non-Binance : rien de nouveau (le DOM affiche déjà « non disponible »).

### 3.3 Tests

Carnet synthétique à 5 niveaux par côté : prix moyen exact d'un achat traversant 2,5
niveaux ; bps signés par côté ; couverture partielle (`couvert=false`, fraction exacte) ;
mid indéfini → null ; `profondeurAPct` bornes inclusives ; `desequilibre` ∈ [−1,1], +1
sans asks dans les n niveaux, `n` > niveaux disponibles → tous pris ; quantités nulles
ignorées. Rendu : gate visuel (bandeau visible, « > carnet » sur 1 M$ d'une alt, sparkline
qui défile).

## 4. Briefs et propriété des fichiers

| Brief | Rôle | Fichiers (exclusifs) | Sortie |
|---|---|---|---|
| A1 moteur composite | Dev B | `packages/alerts/src/{types,engine,describe}.ts` + tests | refactor `etatCondition` prouvé (suite verte inchangée), composite + `typesDeDef` testés |
| A2 front composite | Dev A | `apps/web/src/alerts/runtime.ts`, `store/alerts.ts`, `components/AlertsPanel.tsx` + tests | cache fusionné, mode Composer, `validerComposite` |
| A3 daemon composite | Dev B | `apps/daemon/src/alerts.ts` + test | `evaluableDaemon`, cache funding, éval `onBougieClose` |
| B1 moteur R | Dev B (réviseur pilote) | `packages/backtest/src/{types,engine}.ts` + tests | §2.1–2.2, après/avec Lot 2 §5.1 |
| B2 UI R | Dev A | `store/backtest.ts`, `components/BacktestWindow.tsx` (+ `data/rapport.ts` si nécessaire) | §2.3 |
| C1 coût L2 | Dev A | `data/depthExecution.ts` + test, `components/DomWindow.tsx`, `store/dom-ui.ts` | §3 |
| Lot 0 | Orchestrateur | `BUILD-CONTRACT.md` | exception consignée |

Ordre : A1 → (A2 ∥ A3) ; C1 indépendant (peut démarrer en premier) ; B1 → B2 après le
Lot 2 §5.1. Jamais deux briefs sur un même fichier en parallèle. Revue réviseur par brief
(sécurité : A3 touche le daemon — vérifier qu'aucune route ni surface réseau n'est ajoutée).

## 5. Gates, hors-scope

- **Gate** : `pnpm check` vert par brief et post-merge ; e2e Playwright existants verts ;
  gate visuel in-page : (A) une alerte « RSI ≤ 30 ET funding short-crowded » créée, listée
  sur deux lignes, déclenchée sur fixture ; (B) un run BT avec stop ATR 14×2 et risque 1 %
  montre la colonne R et l'expectancy R étiquetée ; (C) bandeau COÛT sur BTCUSDT et sur
  une alt illiquide (« > carnet » visible).
- **Hors-scope (frigo)** : `fenetreMs` de coïncidence configurable ; imbrication de
  composites ; `confluence-seuil` (le score de `signaux.ts` exige un run EQS — déjà couvert
  par les alertes de preset) ; alerte « approche de niveau » et `oi-change` (items 7 et 9
  de la proposition — lots suivants) ; trailing stop / stop intrabar ; sizing composé ;
  histogramme de R dans BT (extraire un `bucketsR` commun avec EXPY) ; niveau de stop dans
  `btMarkers` ; notionnel personnalisé et lien DOM ↔ taille de l'outil POSITION ; carnet
  perp (le DOM est Binance spot) ; série temporelle de profondeur ±0,5 %.
