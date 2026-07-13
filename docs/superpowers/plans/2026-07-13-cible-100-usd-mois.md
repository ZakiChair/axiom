# AXIOM — Programme multi-agent « Cible 100 $/mois »

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement **lot par lot**. Chaque lot a ses checkboxes. Ne jamais exécuter un lot dont les dépendances DAG ne sont pas ✅.
>
> **Spec produit amont :** analyse session 2026-07-13 + `docs/research/02-indicateurs-edge-crypto.md` + `docs/research/03-roadmap-bloomberg-perso.md` + `BUILD-CONTRACT.md`.
>
> **Nature du document :** plan-programme (orchestration). Chaque **Lot** est une unité SDD indépendante (1 agent, 1 PR, tests verts, commit). Les lots marqués 📦 peuvent être décomposés en plan TDD détaillé au moment de l’exécution si l’agent le demande.

**Goal:** Amener AXIOM du terminal de recherche perso actuel à un outil dont un trader indépendant **paierait 100 $/mois** — via confiance data, edge productisé, workflows 1-clic, boucle alerte→chart→journal, packaging zéro-friction — **sans** violer le BUILD-CONTRACT (mono-user, renderer-first, pas d’AggregationEngine, pas d’Electron, pas de heatmap liq maison).

**Architecture:** Cinq vagues (W0→W4) en DAG. Les agents travaillent en parallèle **uniquement** sur des lots sans arête entrante non résolue. Chaque livrable touche des packages purs (`@axiom/alerts`, `@axiom/indicators`) ou le front/daemon selon la propriété de fichiers. Aucune nouvelle dépendance npm sans escalade utilisateur.

**Tech Stack:** TypeScript strict · React 18 · Zustand vanilla · KLineChart · Bun daemon + SQLite · vitest / bun:test · pnpm workspaces. **Aucune nouvelle dépendance** sauf décision explicite utilisateur.

## Global Constraints

- Commentaires et docs en **français** ; jargon marché EN toléré (funding, OI…).
- TypeScript strict, `noUncheckedIndexedAccess`.
- **BUILD-CONTRACT** : pas de multi-tenant, pas d’Electron, pas d’AggregationEngine multi-ex maison, pas de heatmap liquidation reconstruite, pas de Pine-like, WS marché **directs** (daemon hors chemin chaud).
- Aucune clé API dans le bundle / logs / state React rendu.
- Toute donnée 🟡/🔴 porte un **badge de fiabilité** visible (doctrine doc 02).
- Tests : fonctions pures unit-testées ; composants intégrés = vérif manuelle ou smoke. `pnpm check` vert avant merge de lot.
- Commit ciblé après chaque lot (`git add` fichiers du lot, jamais `git add -A` aveugle).
- Budget API cible : **0–30 $/mois** (plafond doc 03). Passer à 100 $ WTP **produit**, pas en achetant 100 $ de data.

---

## 0. État des lieux (ne pas re-construire)

| Zone | Statut | Preuve |
|---|---|---|
| Chart live multi-ex + multi-grille | ✅ | `ChartGrid`, adapters Binance/Kraken/Coinbase/MEXC/TwelveData |
| ~94 indicateurs + golden | ✅ | `packages/indicators` |
| Orderflow CVD / footprint / VP / DOM | ✅ | `chart/orderflow.ts`, `DomWindow` |
| CVD spot vs perp (détecteur) | ✅ | `chart/cvdSpotPerp.ts` |
| Resync kline + watchdog WS | ✅ | `data/resync.ts`, `connectWsLoop`, adapters |
| Health panel | ✅ | `HealthPanel`, `store/health` |
| Daemon proxy/cache/KV/candles/alertes | ✅ | `apps/daemon` |
| Alertes moteur + daemon + macOS/Telegram | ✅ | `@axiom/alerts`, `daemon/alerts.ts`, `notify.ts` |
| UI alertes (prix + var% seulement) | ⚠️ partiel | `AlertsPanel` — pas d’indicateur / funding / edge |
| Workspaces nommés | ✅ | `store/workspaces` |
| EQS screener (ticker + funding + indics) | ⚠️ partiel | Pas de preset « crowded / squeeze » multi-métriques OI |
| DES / OMON / TERM / BRIEF / GLOBE… | ✅ surface | Manque liens inter-modules + badges fiabilité systématiques |
| Portfolio | ⚠️ manuel | Saisie main, pas d’import, pas de P&L session chrome |
| Packaging one-shot | ❌ | `pnpm dev` + `pnpm daemon` manuels |
| Playbooks 1-clic | ❌ | Workspaces génériques seulement |
| Clic-droit chart → alerte | ❌ | |
| Review de session | ❌ | BRIEF ≠ review trades |

**Implication :** W0 n’est **pas** « refaire la Phase 0 de juillet ». C’est **combler les trous de confiance restants + packaging**, puis productiser l’edge.

---

## 1. Définition de « 100 $/mois » (gate produit)

Un reviewer humain (ou agent `feature-dev:code-reviewer` + checklist) valide la **Gate G100** :

### G100 — Checklist d’acceptation

| # | Critère | Mesure |
|---|---|---|
| G1 | Chart live 30 min sans trou silencieux (Binance BTC 1m) | Watchdog + resync visibles dans Health ; CVD cohérent post-cut |
| G2 | Toute métrique DES/liq/on-chain a un badge 🟢🟡🔴 | Audit UI DES + CHAIN + liq |
| G3 | 5 playbooks 1-clic ouvrent layout + panneaux + toggles | `PLAY` palette + workspaces seed |
| G4 | Alertes edge créables en UI : prix, RSI/ind, funding z, var% | AlertsPanel + clic-droit chart |
| G5 | Alerte onglet fermé : daemon + notif macOS (Telegram si config) | Couper le front, déclencher, notif reçue |
| G6 | Screener « crowded long/short » (funding + ΔOI + L/S) en ≤15 s | Preset EQS livré |
| G7 | Lien EQS/NEWS/ECO/BRIEF → chart (symbole + marqueur/TF) | 1 clic |
| G8 | P&L session + alerte count visibles sans ouvrir de fenêtre | Chrome toolbar/banner |
| G9 | `axiom up` (ou équivalent) démarre front+daemon en 1 commande | Script documenté README |
| G10 | Onboarding ≤5 min : clés optionnelles, 1er playbook, 1 alerte | Flow Settings + AIDE |

**Hors gate 100 $ (explicitement reporté) :** paper trading, heatmap CoinGlass, multi-ex CVD payant, import soldes exchange signés, mobile natif.

---

## 2. DAG d’exécution (multi-agent)

```
                    ┌─────────────┐
                    │  W0-A0      │  Integrity residual + badges core
                    │  confiance  │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
      ┌─────────┐    ┌─────────┐    ┌─────────┐
      │ W0-A1   │    │ W0-A2   │    │ W0-A3   │
      │ package │    │ onboard │    │ chrome  │  (parallèles après A0)
      └────┬────┘    └────┬────┘    └────┬────┘
           └───────────────┼───────────────┘
                           ▼
                    ┌─────────────┐
                    │  W1 (edge)  │  lots B1–B4 parallèles
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │  W2 (liens) │  lots C1–C3 parallèles
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │  W3 (boucle)│  lots D1–D3 (D2 après D1)
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │  W4 Gate    │  E1 polish + E2 G100
                    └─────────────┘
```

### Matrice d’agents (recommandée)

| Lot | Agent type | Isolation | Max fichiers « hot » |
|---|---|---|---|
| A0 | general-purpose (data+chart) | worktree | resync, orderflow, health, lib/fiabilite |
| A1 | general-purpose (tooling) | worktree | scripts, package.json, README |
| A2 | general-purpose (UI) | worktree | Settings, AIDE, premier run |
| A3 | general-purpose (UI chrome) | worktree | Toolbar, SymbolBanner, session strip |
| B1 | general-purpose (alerts) | worktree | packages/alerts + AlertsPanel + runtime |
| B2 | general-purpose (screener) | worktree | data/screener, store/screener, ScreenerWindow |
| B3 | general-purpose (workspaces) | worktree | workspaces, playbooks seed, registry |
| B4 | general-purpose (chart UX) | worktree | drawing/context menu, alerts bridge |
| C1 | general-purpose (UI) | worktree | DES badges, coinalyze labels |
| C2 | general-purpose (navigation) | worktree | bus événements panneau→chart |
| C3 | general-purpose (data) | worktree | candles history daemon, BT depth |
| D1 | general-purpose (portfolio) | worktree | portfolio import CSV |
| D2 | general-purpose (brief/review) | worktree | brief session, NOTES |
| D3 | general-purpose (daemon alerts) | worktree | daemon alertes edge + funding poll |
| E1 | code-simplifier + UI audit | shared | polish tokens / format |
| E2 | review / pr-test-analyzer | read-only | gate G100 |

**Règle anti-conflit :** deux agents ne touchent **jamais** le même fichier en parallèle. Si conflit de propriété (ex. `registry.ts`, `Toolbar.tsx`, `windowManager.ts`), le lot **propriétaire** est listé ci-dessous ; les autres n’y font qu’un greffon documenté en fin de lot séquentiel « wire ».

### Fichiers « goulot » (un seul agent à la fois)

- `apps/web/src/commands/registry.ts` — greffons en fin de vague (lot wire)
- `apps/web/src/components/Toolbar.tsx` — A3 propriétaire chrome ; wire final W2
- `apps/web/src/App.tsx` — wire lots fenêtres
- `apps/web/src/store/windowManager.ts` — rare
- `packages/alerts/src/types.ts` — **B1 seul**
- `package.json` racine — **A1 seul**

---

## 3. Vague W0 — Confiance résiduelle + packaging

### Lot A0 — Integrity residual + badges core 📦

**Owner agent:** data/chart  
**Depends on:** —  
**Blocks:** W1+

**Files:**
- Modify: `apps/web/src/data/binance.ts`, `kraken.ts`, `coinbase.ts` (si gaps resync CVD documentés)
- Modify: `apps/web/src/chart/orderflow.ts` (garantir reseed CVD sur tout chemin resync)
- Modify: `apps/web/src/chart/ChartInstance.tsx` (chemins reseed)
- Create: `apps/web/src/lib/fiabilite.ts` (+ tests)
- Modify: `apps/web/src/components/ui.tsx` (primitive `BadgeFiabilite`)
- Modify: `apps/web/src/components/HealthPanel.tsx` (lien action « détail erreur »)
- Test: `apps/web/src/lib/fiabilite.test.ts`, tests orderflow existants

**Interfaces à produire:**

```ts
// apps/web/src/lib/fiabilite.ts
export type NiveauFiabilite = "fiable" | "partiel" | "estimation" | "indisponible";
export interface MetaFiabilite {
  niveau: NiveauFiabilite;
  /** Court label UI, ex. « ≤1 min · Coinalyze » */
  label: string;
  /** Tooltip long */
  detail?: string;
}
/** Catalogue central des sources connues (DES, liq, on-chain…). */
export function metaSource(id: string): MetaFiabilite;
```

**Tasks:**

- [ ] **A0.1** Audit code : lister tous les chemins où `onResync` / backfill kline ne reseede pas le CVD (grep `reseed`, `onCandles`, `subscribeKline`). Documenter gaps dans le commit message.
- [ ] **A0.2** Tests pures `metaSource` pour au moins : `coinalyze:oi`, `coinalyze:liq`, `binance:forceOrder`, `funding:ws`, `coinmetrics:nvt`, `bgeometrics:mvrv`.
- [ ] **A0.3** Implémenter `lib/fiabilite.ts` + `BadgeFiabilite` (tokens `--up` / ambre / dim, pas d’hex).
- [ ] **A0.4** Brancher reseed CVD manquant si audit non vide ; sinon test de non-régression documentant le chemin existant (`ChartInstance` + `orderflow`).
- [ ] **A0.5** HealthPanel : clic ligne source → panneau détail (dernier erreur, âge, quota) sans re-render haute fréquence (pattern refs 1 Hz existant).
- [ ] **A0.6** `pnpm --filter @axiom/web test` + `typecheck` verts ; commit `fix(data): reseed CVD + badges fiabilité core`.

**Acceptation:** un agent QA peut couper le Wi-Fi 90 s, reconnecter, et constater Health `stale→connected` + pas de trou CVD non signalé.

---

### Lot A1 — Packaging one-shot `axiom up`

**Owner agent:** tooling  
**Depends on:** — (parallèle A0)  
**Conflicts:** `package.json` (seul ce lot)

**Files:**
- Create: `scripts/axiom-up.sh`
- Modify: `package.json` (scripts `up` / `prod:up`)
- Modify: `README.md` (section démarrage)

**Tasks:**

- [ ] **A1.1** Script `scripts/axiom-up.sh` :
  - vérifie `pnpm` + `bun`
  - `pnpm install` si `node_modules` absent
  - lance daemon en arrière-plan (log `logs/daemon.log`)
  - attend `/health` (timeout 15 s)
  - lance `pnpm --filter @axiom/web dev` OU sert `pnpm prod` selon flag `--prod`
  - trap SIGINT pour tuer les deux process
- [ ] **A1.2** Scripts npm : `"up": "bash scripts/axiom-up.sh"`, `"up:prod": "bash scripts/axiom-up.sh --prod"`.
- [ ] **A1.3** README : remplacer le dual-terminal par `pnpm up` ; garder dual-terminal en fallback.
- [ ] **A1.4** Smoke : script démarre, curl health 200, commit `feat(tooling): pnpm up one-shot`.

**Acceptation:** G9 partiel — un dev cold-start en ≤2 commandes (`pnpm up`).

---

### Lot A2 — Onboarding ≤5 min

**Owner agent:** UI settings  
**Depends on:** A0 (BadgeFiabilite optionnel mais préférable)  
**Conflicts:** `SettingsPanel.tsx`

**Files:**
- Modify: `apps/web/src/components/SettingsPanel.tsx`
- Create: `apps/web/src/store/onboarding.ts` (+ test)
- Modify: `apps/web/src/commands/hotkeys.ts` (entrée AIDE onboarding)
- Modify: `apps/web/src/App.tsx` (modal premier lancement, **wire séquentiel** si App goulot)

**Interfaces:**

```ts
// store/onboarding.ts
export interface OnboardingState {
  completed: boolean;
  step: number;
  complete: () => void;
  skip: () => void;
  next: () => void;
}
// Persist clé axiom:onboarding:v1
```

**Tasks:**

- [ ] **A2.1** Store onboarding (vanilla + persist localStorage / daemon KV si pattern existant).
- [ ] **A2.2** Overlay 3 étapes : (1) bienvenue + playbook Scalp (2) clé Coinalyze optionnelle (3) créer 1 alerte prix démo.
- [ ] **A2.3** Skip + ne plus afficher ; commande palette `ONBOARD` pour rejouer.
- [ ] **A2.4** Commit `feat(ui): onboarding 3 étapes`.

**Acceptation:** G10 — parcours chronométrable sans lire le README.

---

### Lot A3 — Chrome session (P&L + alertes + fraîcheur)

**Owner agent:** UI chrome  
**Depends on:** —  
**Conflicts:** `Toolbar.tsx`, `SymbolBanner.tsx`

**Files:**
- Modify: `apps/web/src/components/Toolbar.tsx`
- Modify: `apps/web/src/components/SymbolBanner.tsx` (si besoin)
- Create: `apps/web/src/components/SessionStrip.tsx`
- Modify: `apps/web/src/store/portfolio.ts` (sélecteur pur `pnlSessionJour` si absent)
- Test: fonctions pures portfolio / format

**Tasks:**

- [ ] **A3.1** Fonction pure `pnlSessionDepuis(positions, clos, startOfDayMs)` → `{ latent, realise, total }`.
- [ ] **A3.2** `SessionStrip` dense (11px) : P&L jour coloré tokens · nb alertes actives · pastille health globale (réutilise `degradedLevel`).
- [ ] **A3.3** Montage sous Toolbar (hors plein écran).
- [ ] **A3.4** MàJ DOM impérative pour P&L si ticks (pas de re-render React sur prix) — pattern PortfolioWindow.
- [ ] **A3.5** Commit `feat(ui): session strip P&L + alertes + health`.

**Acceptation:** G8.

---

## 4. Vague W1 — Productiser l’edge

### Lot B1 — Alertes edge (moteur + UI)

**Owner agent:** alerts  
**Depends on:** A0  
**Conflicts:** `packages/alerts/**`, `AlertsPanel.tsx`, `alerts/runtime.ts`

**Files:**
- Modify: `packages/alerts/src/types.ts` — nouvelles conditions
- Modify: `packages/alerts/src/engine.ts`, `describe.ts` + tests
- Modify: `apps/web/src/components/AlertsPanel.tsx`
- Modify: `apps/web/src/alerts/runtime.ts` — contexte funding / séries
- Modify: `apps/web/src/store/alerts.ts` si besoin

**Nouvelles conditions (union discriminée) :**

```ts
/** Funding extrême via z-score ou seuil absolu annualisé. */
export interface ConditionFundingExtreme {
  type: "funding-extreme";
  /** |z| ≥ seuil (défaut 2) OU |rate| ≥ seuilAbs si fourni */
  zSeuil?: number;
  /** rate fraction (ex. 0.001 = 0.1 %) */
  seuilAbs?: number;
  sens: "long-crowded" | "short-crowded" | "les-deux";
}

/** Divergence CVD spot vs perp (réutilise kind du détecteur). */
export interface ConditionCvdSpotPerpDiv {
  type: "cvd-spot-perp-div";
  kind: "spotUp_perpDown" | "spotDown_perpUp" | "les-deux";
}
```

**Tasks:**

- [ ] **B1.1** Étendre `Condition` + tests engine (funding + cvd) avec fixtures candles/ctx.
- [ ] **B1.2** `decrireCondition` FR pour les nouveaux types.
- [ ] **B1.3** Runtime front : injecter `fundingRate` / buckets CVD dans `ContexteAlerte` (étendre le type contexte si besoin, pur).
- [ ] **B1.4** UI AlertsPanel : types sélectionnables `prix | var% | indicateur-seuil | funding-extreme` (CVD div en v1.1 si données absentes hors orderflow).
- [ ] **B1.5** Exposer indicateur-seuil dans l’UI (select defId parmi registry filtré, output, comparateur, valeur).
- [ ] **B1.6** Daemon : si le contexte funding n’est pas dispo daemon-side, documenter dégradation (prix/var/indics only en onglet fermé) **ou** poll funding lent (préférer poll dans D3).
- [ ] **B1.7** Commit `feat(alerts): conditions funding + indicateur UI`.

**Acceptation:** G4 partiel (sans clic-droit — B4).

**Note BUILD-CONTRACT :** pas d’alerte sur heatmap liq ; pas de multi-ex.

---

### Lot B2 — Screener positionnement (crowded / squeeze)

**Owner agent:** screener  
**Depends on:** A0  
**Conflicts:** `data/screener.ts`, `store/screener.ts`, `ScreenerWindow.tsx`, worker

**Files:**
- Modify: `apps/web/src/data/screener.ts` (+ tests)
- Modify: `apps/web/src/data/coinalyze.ts` (batch OI si endpoint gratuit le permet)
- Modify: `apps/web/src/store/screener.ts`
- Modify: `apps/web/src/components/ScreenerWindow.tsx`
- Modify: `apps/web/src/workers/screener.worker.ts` si besoin

**Interfaces:**

```ts
export type BaseField =
  | "volumeUsd24h"
  | "priceChangePct24h"
  | "lastPrice"
  | "fundingPct"
  | "oiChangePct"      // nouveau, optionnel
  | "longShortRatio";  // nouveau, optionnel

/** Preset livré — crowded long */
// fundingPct > X AND oiChangePct > Y AND longShortRatio > Z
```

**Tasks:**

- [ ] **B2.1** Étendre `ScreenerRow` + parse pour OI Δ% / L-S **si** source gratuite batch (sinon : top N liquides via Coinalyze rate-limité + note honnête).
- [ ] **B2.2** Presets livrés : `crowded-long`, `crowded-short`, `funding-extreme`, `momentum-vol`.
- [ ] **B2.3** UI : colonnes OI/L-S si présentes ; badge « échantillon N symboles » si cap.
- [ ] **B2.4** Clic ligne → émettre intention navigation (contrat C2) **ou** `marketStore.setSymbol` direct si C2 pas encore merge (adapter au wire).
- [ ] **B2.5** Commit `feat(eqs): presets positionnement crowded/squeeze`.

**Acceptation:** G6 — preset crowded tourne ≤15 s avec note de couverture honnête.

---

### Lot B3 — Playbooks 1-clic

**Owner agent:** workspaces  
**Depends on:** A0  
**Conflicts:** `store/workspaces.ts`, greffe commandes

**Files:**
- Create: `apps/web/src/data/playbooks.ts` (+ tests pures)
- Modify: `apps/web/src/store/workspaces.ts`
- Create: greffe commandes dans module playbooks (pas registry central en parallèle)
- Modify: `Toolbar.tsx` **uniquement via wire W1** ou menu Fonctions si pattern windowManager

**Playbooks seed (minimum 5) :**

| id | Nom | Layout | Fenêtres | Toggles |
|---|---|---|---|---|
| `scalp-btc` | Scalp BTC orderflow | 1 | DES, DOM | orderflow ON, VP ON |
| `fade-funding` | Fade funding | 1 | DES, EQS | funding pane ON |
| `macro-fomc` | Macro FOMC | 2h | ECO, RATE, NEWS | macro overlays |
| `risk-off` | Risk-off globe | 2v | GLOBE, MAP, CORR | — |
| `options-deribit` | Options | 1 | OMON, TERM, VOL | — |

**Interfaces:**

```ts
export interface Playbook {
  id: string;
  nom: string;
  mnemonique: string; // ex. PLAY-SCALP
  description: string;
  apply: () => void; // stores vanilla only
}
export const PLAYBOOKS: Playbook[];
```

**Tasks:**

- [ ] **B3.1** Définir apply() en composant d’actions stores existants (`chartLayoutStore`, `windowManagerStore`, `orderflowStore`, …).
- [ ] **B3.2** Enregistrer commandes `PLAY`, `PLAY-SCALP`, … via `enregistrerCommandes` au chargement module.
- [ ] **B3.3** Entrée menu Fonctions ou sous-menu Playbooks (wire Toolbar si propriétaire).
- [ ] **B3.4** Commit `feat(ux): 5 playbooks 1-clic`.

**Acceptation:** G3.

---

### Lot B4 — Clic-droit chart → alerte prix

**Owner agent:** chart UX  
**Depends on:** B1 (store alerts stable)  
**Conflicts:** `chart/drawing.ts` / ChartInstance context menu

**Files:**
- Modify: `apps/web/src/chart/ChartInstance.tsx` ou module context menu dédié
- Modify: `apps/web/src/store/alerts.ts` (helper `alertePrixAuNiveau`)
- Test: helper pur

**Tasks:**

- [ ] **B4.1** Détecter clic droit sur pane prix → prix Y de l’axe.
- [ ] **B4.2** Menu minimal : « Alerte croisement ↑ », « ↓ », « les deux ».
- [ ] **B4.3** Crée `AlertDef` prix-croise + ouvre section alertes.
- [ ] **B4.4** Commit `feat(chart): clic-droit alerte prix`.

**Acceptation:** G4 complet.

---

## 5. Vague W2 — Liens, honnêteté data, profondeur

### Lot C1 — Badges fiabilité DES / liq / CHAIN

**Owner agent:** UI data honesty  
**Depends on:** A0 (`BadgeFiabilite`, `metaSource`)  
**Conflicts:** `DerivativesWindow.tsx`, `OnchainWindow.tsx`

**Tasks:**

- [ ] **C1.1** DES : chaque bloc OI / funding / L-S / liquidations affiche `BadgeFiabilite`.
- [ ] **C1.2** Liquidations Coinalyze = 🟡 partiel/latence ; si un jour forceOrder Binance affiché = 🔴 sous-estimé (label exact doc 02).
- [ ] **C1.3** CHAIN : migrer tags locaux vers `lib/fiabilite` (dédup).
- [ ] **C1.4** Commit `feat(ui): badges fiabilité DES/CHAIN`.

**Acceptation:** G2.

---

### Lot C2 — Bus navigation panneau → chart

**Owner agent:** navigation  
**Depends on:** B2 (producteur EQS), B3  
**Conflicts:** nouveau module + greffes

**Files:**
- Create: `apps/web/src/lib/navigation.ts` (+ tests)
- Modify: consommateurs EQS, NEWS, ECO, BRIEF, MAP

**Interfaces:**

```ts
export interface NavIntent {
  symbol?: string;
  exchange?: ExchangeId;
  timeframe?: Timeframe;
  /** ms epoch pour marqueur vertical optionnel */
  markTime?: number;
  source: string; // "eqs" | "news" | …
}
export function navigateTo(intent: NavIntent): void;
// Impl: marketStore + ecoMarkers/tradeMarkers pattern + focus chart
```

**Tasks:**

- [ ] **C2.1** `navigateTo` pur côté effets (appelle stores).
- [ ] **C2.2** Brancher EQS row click, NEWS item, ECO event, BRIEF section.
- [ ] **C2.3** Commit `feat(nav): bus panneau→chart`.

**Acceptation:** G7.

---

### Lot C3 — Profondeur historique candles (BT / SEAG / VOL)

**Owner agent:** daemon data  
**Depends on:** A0  
**Conflicts:** `apps/daemon/src/candles.ts`, `apps/web/src/data/backtestData.ts`

**Tasks:**

- [ ] **C3.1** Audit : pagination `loadMore` chart + cache daemon — documenter profondeur max actuelle.
- [ ] **C3.2** Si gaps : endpoint daemon fetch+store klines historiques à la demande (Binance public), TTL long.
- [ ] **C3.3** BacktestWindow : message clair si série < N barres ; bouton « charger 2 ans 1d ».
- [ ] **C3.4** Commit `feat(data): profondeur historique backtest`.

**Acceptation:** BT sur BTCUSDT 1d ≥ 500 barres en local avec daemon.

---

## 6. Vague W3 — Boucle trader

### Lot D1 — Portfolio import CSV

**Owner agent:** portfolio  
**Depends on:** A3 (session strip)  
**Conflicts:** `store/portfolio.ts`, `PortfolioWindow.tsx`

**Tasks:**

- [ ] **D1.1** Spec CSV : `symbol,side,qty,entryPrice,entryTime,exchange?` (+ test parse pur).
- [ ] **D1.2** UI import fichier + validation + dry-run.
- [ ] **D1.3** Export CSV miroir.
- [ ] **D1.4** Commit `feat(port): import/export CSV`.

**Acceptation:** importer 10 lignes → P&L session strip non nul.

---

### Lot D2 — Review de session (BRIEF soir)

**Owner agent:** brief  
**Depends on:** D1, C2  
**Conflicts:** `data/brief.ts`, `BriefWindow.tsx`

**Tasks:**

- [ ] **D2.1** Section « Session » dans BRIEF : trades clos du jour, PnL, alertes déclenchées, events ECO passés.
- [ ] **D2.2** Export markdown → NOTE (pattern existant BRIEF→NOTES).
- [ ] **D2.3** Commit `feat(brief): review de session`.

**Acceptation:** fin de journée = 1 snapshot actionnable.

---

### Lot D3 — Daemon : funding + alertes edge onglet fermé

**Owner agent:** daemon  
**Depends on:** B1  
**Conflicts:** `apps/daemon/src/alerts.ts`, `marketFeed.ts`

**Tasks:**

- [ ] **D3.1** Poll funding (Binance premiumIndex all ou sous-ensemble symboles alertés) pour conditions `funding-extreme`.
- [ ] **D3.2** Évaluation dans la boucle alertes existante ; tests daemon.
- [ ] **D3.3** Journal + notify inchangés.
- [ ] **D3.4** Commit `feat(daemon): alertes funding onglet fermé`.

**Acceptation:** G5 avec alerte funding (pas seulement prix).

---

## 7. Vague W4 — Polish + Gate G100

### Lot E1 — Polish UI résiduel

**Owner agent:** code-simplifier / UI  
**Depends on:** W0–W3 merge  

**Tasks:**

- [x] **E1.1** Grep hex en dur hors tokens dans fenêtres touchées ; corriger.
- [x] **E1.2** États vides / retry uniformes (`ui.tsx`).
- [x] **E1.3** Commit `fix(ui): polish gate 100`.

---

### Lot E2 — Gate G100 (review multi-agent)

**Owner agents (parallèle read-only):**
1. `feature-dev:code-reviewer` — régression / bugs
2. `pr-review-toolkit:pr-test-analyzer` — couverture
3. Agent QA manuel checklist G1–G10

**Tasks:**

- [ ] **E2.1** Exécuter checklist G100, noter PASS/FAIL.
- [ ] **E2.2** Si FAIL : tickets lots correctifs (pas de scope creep).
- [ ] **E2.3** Mettre à jour ce document section « Verdict gate ».
- [ ] **E2.4** README : section « Valeur produit » alignée gate.

---

## 8. PR Plan (DAG mergeable)

| PR | Titre | Lots | Dépend de |
|---|---|---|---|
| PR-01 | `fix(data): integrity residual + fiabilité core` | A0 | — |
| PR-02 | `feat(tooling): pnpm up one-shot` | A1 | — |
| PR-03 | `feat(ui): session strip` | A3 | — |
| PR-04 | `feat(ui): onboarding` | A2 | PR-01 recommandé |
| PR-05 | `feat(alerts): edge conditions + UI` | B1 | PR-01 |
| PR-06 | `feat(eqs): positionnement presets` | B2 | PR-01 |
| PR-07 | `feat(ux): playbooks` | B3 | PR-01 |
| PR-08 | `feat(chart): context-menu alertes` | B4 | PR-05 |
| PR-09 | `feat(ui): badges DES/CHAIN` | C1 | PR-01 |
| PR-10 | `feat(nav): panneau→chart bus` | C2 | PR-06, PR-07 |
| PR-11 | `feat(data): historique BT` | C3 | PR-01 |
| PR-12 | `feat(port): CSV import` | D1 | PR-03 |
| PR-13 | `feat(brief): session review` | D2 | PR-12, PR-10 |
| PR-14 | `feat(daemon): funding alerts closed-tab` | D3 | PR-05 |
| PR-15 | `fix(ui): polish + docs gate` | E1, E2 | PR-08…PR-14 |

**Parallélisme max recommandé :** 3 worktrees agents (ex. PR-01 ∥ PR-02 ∥ PR-03), puis 3 (PR-05 ∥ PR-06 ∥ PR-07), etc.

---

## 9. Key Decisions

| # | Décision | Rationale |
|---|---|---|
| K1 | Ne pas re-faire Phase 0 complète | Resync/watchdog/health/daemon déjà en place — ROI sur productisation |
| K2 | WTP 100 $ = workflow + confiance, pas plus d’indicateurs classiques | Commodités TV gratuites ; edge = orderflow/dérivés/setups |
| K3 | Pas de heatmap liq maison | BUILD-CONTRACT + honnêteté ; acheter plus tard ou s’en passer |
| K4 | Alertes funding en daemon via poll lent | Cohérent mono-user ; pas de WS dérivés dans daemon sur chemin chart |
| K5 | Playbooks = composition de stores, pas nouveau moteur layout | Réutilise workspaces + windowManager |
| K6 | Bus `navigateTo` unique | Évite N couplages ad hoc EQS/NEWS/… |
| K7 | Budget data ≤30 $/mois | Plafond doc 03 ; le 100 $ est prix **produit mental**, pas COGS |
| K8 | Paper trading hors programme | Fermer la boucle plus tard ; ne pas bloquer G100 |
| K9 | Un lot = un agent = une PR | Conflits fichiers goulots gérés par ownership |
| K10 | Gate G100 binaire | Empêche le scope creep « encore une fenêtre » |

---

## 10. Anti-objectifs (rappel programme)

- Electron / Tauri non justifié
- AggregationEngine multi-exchange maison
- Liquidation heatmap modélisée présentée comme donnée
- LunarCrush / Santiment free J-30
- Scripting Pine-like
- 50 nouveaux oscillateurs techniques
- Docker/Redis/TimescaleDB
- Proxifier les WS marché via le daemon

---

## 11. Estimation effort (ordre de grandeur)

| Vague | Lots | Effort agent-jours | Calendrier si 3 agents // |
|---|---|---|---|
| W0 | A0–A3 | 4–6 | ~2–3 j |
| W1 | B1–B4 | 6–9 | ~3–4 j |
| W2 | C1–C3 | 4–6 | ~2–3 j |
| W3 | D1–D3 | 4–6 | ~2–3 j |
| W4 | E1–E2 | 2–3 | ~1–2 j |
| **Total** | | **~20–30 agent-jours** | **~10–15 j calendaires** |

---

## 12. Protocole d’exécution multi-agent

1. **Orchestrateur** lit ce document, crée une branche `feat/g100-w0` (ou stack Graphite).
2. Pour chaque vague : lancer N agents en **worktree** sur lots parallèles (max 3).
3. Chaque agent :
   - lit BUILD-CONTRACT + lot assigné uniquement
   - TDD sur pures
   - `pnpm check` (ou filtre package) vert
   - commit message conventionnel
   - ne touche pas les fichiers hors lot
4. **Wire goulot** (registry/Toolbar/App) : petit lot séquentiel en fin de vague si greffes concurrentes.
5. Reviewer entre vagues (pas seulement en E2).
6. Stop si un lot casse G1 (confiance chart) — priorité absolue hotfix.

### Commandes orchestrateur types

```bash
# Agent worktree exemple
git worktree add ../axiom-a0 -b feat/g100-a0
# Dans le worktree : implémenter lot A0, puis
pnpm check
```

### Handoff à l’utilisateur

Deux modes d’exécution :

1. **Subagent-Driven (recommandé)** — un agent frais par lot, review entre lots, worktrees isolés.
2. **Vague par vague inline** — orchestrateur enchaîne W0 puis checkpoint humain.

---

## 13. Open Questions (trancher avant W1 si possible)

| # | Question | Défaut recommandé |
|---|---|---|
| Q1 | Plafond budget API pendant le programme ? | **0 $** jusqu’à G6 insuffisant, puis Coinalyze paid si besoin OI batch |
| Q2 | CVD-div alertes v1 ou v1.1 ? | **v1.1** (dépend orderflow live ; funding d’abord) |
| Q3 | Import portfolio : CSV only ou aussi API lecture Binance ? | **CSV only** (CORS/signé = daemon + scope) |
| Q4 | `pnpm up` = dev ou prod par défaut ? | **dev** ; `--prod` pour usage quotidien |

---

## 14. Verdict gate (provisoire E1 — à valider en E2)

Statuts : **code-complete** = livré en main (commits W0–W3) ; **manual QA** = non encore exécuté en conditions réelles. Aucun PASS/FAIL définitif avant E2.

| Critère | Statut | Notes (commits / lots) |
|---|---|---|
| G1 | code-complete · **manual QA** | A0 `4cbbde3` resync CVD + health ; watch 30 min live à faire |
| G2 | code-complete · **manual QA** | A0 `4cbbde3` + C1 `0051c8f` badges DES/CHAIN ; audit UI visuel à faire |
| G3 | code-complete · **manual QA** | B3 `5a95c25` + `c587f04` playbooks PLAY* + Toolbar |
| G4 | code-complete · **manual QA** | B1 `ce8c6b7` funding/ind UI ; B4 `913a0de` clic-droit prix |
| G5 | code-complete · **manual QA** | D3 `e3fad26` poll funding daemon + journal/notify ; test onglet fermé à faire |
| G6 | code-complete · **manual QA** | B2 `10d5364` presets crowded/squeeze EQS ; chrono ≤15 s à mesurer |
| G7 | code-complete · **manual QA** | C2 `7507755` bus panneau→chart |
| G8 | code-complete · **manual QA** | A3 `60b92e6` SessionStrip P&L + alertes + health |
| G9 | code-complete · **manual QA** | A1 `13f5e4d` `pnpm up` documenté README |
| G10 | code-complete · **manual QA** | A2 `144f186` onboarding 3 étapes + PLAY-SCALP |

**Boucle trader (hors critères numérotés, livrée W3) :** D1 `0790b86` CSV port ; D2 `2849ba2` brief review session ; C3 `fd1ddfc` profondeur BT.

**Polish E1 :** `fix(ui): polish gate 100` — états vides DES/ALERTS → `Vide`/`SansCle` ; hex résiduels = canvas/KLine exceptions documentées (pas de hex UI dans fenêtres G100).

**Décision finale WTP 100 $ :** ⬜ NON / ⬜ OUI conditionnel / ⬜ OUI — **tranché en E2 après manual QA G1–G10**

---

## 15. Self-review du plan

| Exigence analyse 100 $ | Lot |
|---|---|
| Confiance live / resync CVD | A0 |
| Badges fiabilité | A0, C1 |
| Packaging one-shot | A1 |
| Onboarding | A2 |
| P&L session visible | A3 |
| Alertes edge UI | B1, B4 |
| Screener positionnement | B2 |
| Playbooks | B3 |
| Liens inter-modules | C2 |
| Historique / BT | C3 |
| Portfolio import | D1 |
| Review session | D2 |
| Alertes onglet fermé edge | D3 |
| Polish + gate | E1, E2 |
| Heatmap / paper / multi-ex | **Hors scope** (anti-objectifs) |

Pas de placeholder TBD opérationnel : chaque lot a fichiers, interfaces, tâches, acceptation.
