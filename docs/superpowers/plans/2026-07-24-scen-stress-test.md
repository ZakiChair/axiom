# SCEN — stress-test scénarios — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre SCEN : chocs de facteurs (sliders) × betas roulants 90 j → P&L estimé par position + total, jauge vs VaR95, spec `2026-07-24-lot-v20-analyse-design.md` §C3.

**Architecture:** T1 = module `data/scen.ts` (helpers PURS + collecte) qui GÉNÉRALISE `stressGrid` de portRisque (mono-facteur BTC → 5 facteurs, 1 facteur par position) en réutilisant les primitives existantes (`alignerSeries/fenetrer/logRendements` de corr.ts, `risquePortefeuille/quantile` de portRisque.ts). T2 = fenêtre.

**Tech Stack:** TypeScript, vitest, Zustand vanilla.

## Global Constraints

- Commentaires **français**. Branche : `feat/scen-stress-test`. `git -C ~/axiom` systématique. Gate : `pnpm test` racine + tsc verts + gate visuel contrôleur.
- Modèle ASSUMÉ (spec) : 1 facteur par position, P&L = poids × β × choc — pas de somme multi-facteurs. Mention permanente « approximation 1-facteur, ordres de grandeur » (`NoteSource`).
- Prix courants : dernier close de la série 1d chargée (repli `prixEntree`) — PAS de plomberie WS pour un stress-test (décision consignée, affichée dans la note).
- Dégradation : β incalculable (< 30 points alignés, fetch en échec) → ligne « β indisponible », exclue du total, `couvertUsd` affiché (patron `stressGrid`).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/portRisque.ts` — `stressGrid` l.230 (patron à généraliser), `risquePortefeuille` l.168 (VaR, null si <30), `serieRendementsPortefeuille` l.156, `betasVsRef` l.207, types `SerieActif` l.25 / `PoidsPosition` l.30. NB : sa collecte est Binance-only — NE PAS la réutiliser, SCEN a la sienne.
- `apps/web/src/data/corr.ts` — `chargerSerie(symbol)` l.284 (klines 1d, cache session, résolution de source via watchlist), `alignerSeries` l.50, `fenetrer` l.77, `logRendements` l.91, `SerieCloture` l.23.
- `apps/web/src/store/portfolio.ts:39-55` — `Position` (`symbole`, `source`, `direction`, `taille`, `prixEntree`, `statut`) ; convention poids signé de `calculerExposition` l.147.
- `apps/web/src/data/paper.ts:45-54` — `PositionPaper` (`symbol` anglais !, `direction`, `taille`, `prixEntree`) ; `signe(direction)` l.81 ; `paperStore.getState().derniersPrix`.
- `apps/web/src/data/pairs.ts:95-111` — proxys tradfi : DXY→`UUP`, S&P→`SPY`, or→`GLD` (Twelve Data).
- Enregistrement fenêtre : `WINDOW_REGISTRY` (windowManager.ts:46-80) + `WINDOW_COMPONENTS` (App.tsx:144-208) + `windowPanels.ts` (`basculer`) — menu/persistance automatiques.
- `apps/web/src/components/ui.tsx` — `EnTeteFenetre`, `Segmente` l.388, `Metric` l.248, `Badge`, `NoteSource` l.418. PAS de slider partagé : `<input type="range">` inline (précédent : ReplayWindow.tsx:214).

---

### Task 1: Module `data/scen.ts` (pur + collecte)

**Files:**
- Create: `apps/web/src/data/scen.ts` — Test: `apps/web/src/data/scen.test.ts`

**Interfaces (Produces):**
```ts
export type FacteurId = "btc" | "eth" | "dxy" | "spx" | "or";
export const FACTEURS: { id: FacteurId; label: string; symbole: string; source: "binance" | "twelvedata" }[];
// btc→BTCUSDT/binance, eth→ETHUSDT/binance, dxy→UUP, spx→SPY, or→GLD (twelvedata)
/** Rattachement 1-facteur : crypto → base "ETH"→eth sinon btc ; twelvedata → UUP+forex→dxy, GLD/SLV→or, sinon spx. */
export function facteurDe(symbole: string, source: ExchangeId): FacteurId;
export interface PositionScen { symbole: string; poidsUsd: number /* signé, short<0 */; facteur: FacteurId; beta: number | null }
/** β = cov(rA,rF)/var(rF) sur retours log 1d alignés fenêtrés `jours` ; null si <30 points (convention risquePortefeuille). */
export function betaRoulant(actif: SerieCloture[], facteur: SerieCloture[], jours: number): number | null;
export interface ResultatScen { lignes: { position: PositionScen; plUsd: number | null }[]; totalUsd: number; couvertUsd: number; sommeAbs: number }
export function appliquerScenario(positions: PositionScen[], chocsPct: Record<FacteurId, number>): ResultatScen;
export const PRESETS_SCEN: { label: string; chocs: Partial<Record<FacteurId, number>> }[];
// « Krach crypto » {btc:−30, eth:−35}, « Choc taux » {dxy:+3, spx:−5}, « Risk-on » {btc:+15, eth:+20, spx:+5}
/** Entrée brute : les stores ne connaissent pas le prix courant — la collecte le tire du dernier close 1d. */
export interface PositionBrute { symbole: string; source: ExchangeId; direction: "long" | "short"; taille: number; prixEntree: number }
export interface CollecteScen { positions: PositionScen[]; varUsd95: number | null; exclues: { symbole: string; raison: string }[] }
/** Séries positions via chargerSerie (cache session corr) ; séries FACTEURS via getAdapter(f.source).fetchKlines(f.symbole,"1d",{limit:260})
 *  + cache module (la résolution watchlist de chargerSerie n'est pas fiable pour SPY/UUP/GLD hors watchlist).
 *  poidsUsd = signe(direction) × taille × dernierClose (repli prixEntree si série vide, position tout de même incluse si β calculable).
 *  varUsd95 = risquePortefeuille(serieRendementsPortefeuille(...)).var95Pct × sommeAbs (null si <30 j). */
export async function collecterScen(positions: readonly PositionBrute[], fenetreJours: number): Promise<CollecteScen>;
```

- [ ] **Step 1: Tests rouges** — `facteurDe` : ("ETHUSDT","binance")→eth, ("SOLUSDT","binance")→btc, ("UUP","twelvedata")→dxy, ("EUR/USD","twelvedata")→dxy, ("GLD","twelvedata")→or, ("NVDA","twelvedata")→spx. `betaRoulant` : fixtures synthétiques — actif = 2×facteur → β≈2 (toBeCloseTo) ; séries décorrélées → β≈0 ; 20 points → null. `appliquerScenario` : 2 positions (long β1.5 choc −30 → pl = poids×1.5×−0.30 ; β null → plUsd null, exclue du total, couvertUsd = somme|poids| des incluses) ; chocs tous 0 → total 0.
- [ ] **Step 2: Implémentation** — β via `alignerSeries`+`fenetrer`+`logRendements` importés de corr.ts (pas de recopie) ; cov/var inline (10 lignes) ; `collecterScen` avec pool simple et échecs par symbole → `exclues`. Tests verts.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(scen): moteur pur de stress-test multi-facteurs (betas roulants, scénarios)`

### Task 2: Fenêtre SCEN

**Files:**
- Create: `apps/web/src/components/ScenWindow.tsx`
- Modify: `apps/web/src/store/windowManager.ts` (`{ id: "scen", title: "Stress-test", mnemonic: "SCEN", defaultWidth: 720, defaultHeight: 540, nouveau: true }`), `apps/web/src/App.tsx` (lazy), `apps/web/src/commands/windowPanels.ts` (`basculer("scen")`)

**Interfaces (Consumes):** Task 1 en entier ; `portfolioStore` (positions `statut==="ouvert"` → `PositionBrute`, champs directs), `paperStore` (positions paper → `PositionBrute` avec `source: "binance"` — les paper symbols sont crypto, décision consignée en commentaire ; NB champ `symbol` anglais côté paper).

- [ ] **Step 1: Enregistrement + squelette** — patron CorrWindow : store UI co-localisé + `mirrorOpenState("scen", ...)`, `EnTeteFenetre mnemo="SCEN"`, collecte au premier open (et bouton « Recalculer β » → vide le cache facteurs + re-collecte), `Chargement/ErreurBloc/Vide` (vide si aucune position ouverte portefeuille+paper).
- [ ] **Step 2: UI scénario** — une rangée par FACTEUR : label + `<input type="range" min=-50 max=50 step=1>` + valeur % éditable (input numérique inline, conventions champ du repo) ; boutons presets (`PRESETS_SCEN`, appliquent les chocs, facteurs absents→0) + « Réinitialiser ». Recalcul `appliquerScenario` à chaque changement (pur, instantané — pas de fetch).
- [ ] **Step 3: Résultats** — table : position, facteur (badge), β (2 déc. ou « indispo »), P&L $ (teinte ±) ; pied : total $, « couvre X % du notionnel » si exclusions (patron SectionRisque), jauge vs VaR : barre |total| / varUsd95 avec seuils (<1× neutre, ≥1× warn) quand `varUsd95` non null ; liste `exclues` avec raisons ; `NoteSource` (« β 90 j vs facteur, approximation 1-facteur, prix = dernier close 1d »).
- [ ] **Step 4:** `pnpm test` racine + tsc verts (logique émergente → la déplacer dans scen.ts testée).
- [ ] **Step 5: Gate visuel (contrôleur)** — avec des positions portefeuille + paper réelles : ouvrir SCEN → β plausibles (majors ≈1 vs BTC), preset Krach → total négatif cohérent avec l'expo, position tradfi rattachée au bon facteur, jauge VaR affichée ; sans positions → Vide propre.
- [ ] **Step 6: Commit** — `feat(scen): fenêtre stress-test scénarios (sliders facteurs, P&L estimé, jauge VaR)`
