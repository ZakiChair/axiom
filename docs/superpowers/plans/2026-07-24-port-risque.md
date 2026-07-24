# Risque de portefeuille — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Section « Risque » de PortfolioWindow — VaR/CVaR du portefeuille consolidé, contributions au risque, bêtas/stress BTC, courbe d'équity 90 j — spec `2026-07-24-lot-v17-trader-fond-design.md` §1.

**Architecture:** T1 = calculs purs (TDD) ; T2 = collecte (klines 1d par position, cache 1 h) + section UI.

**Tech Stack:** TypeScript, canvas 2D, vitest.

## Global Constraints

- Commentaires **français**. Tokens, DPR/RO, paddings partagés. `git -C` systématique.
- Les 3 approximations sont AFFICHÉES (note honnête) : composition actuelle rétro-projetée, stress linéaire en β, périmètre crypto-Binance (positions hors périmètre comptées et signalées).
- Quantiles = convention type-7 du repo (dupliquer localement `quantile` avec provenance si l'import est impropre — précédent distVar). ≥ 30 jours communs sinon « historique insuffisant ».
- Branche : `feat/port-risque`. TDD. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/store/portfolio.ts` (Position, calculerExposition, où sont les prix courants — regarde comment PortfolioWindow les obtient) et `components/PortfolioWindow.tsx` (structure, sections)
- `apps/web/src/data/distVar.ts` (quantile local, conventions) ; `data/cbprem.ts`/store (fetch klines 1d, cache)

---

### Task 1: Calculs purs `portRisque`

**Files:**
- Create: `apps/web/src/data/portRisque.ts` — Test: `apps/web/src/data/portRisque.test.ts`

**Interfaces (Produces — consommé par T2):**
```ts
export interface SerieActif { symbol: string; rendements: { t: number; r: number }[]; } // rendements log 1d, t = openTime
export interface PoidsPosition { symbol: string; poids: number; }                        // $ signé (short < 0)
export function serieRendementsPortefeuille(series: readonly SerieActif[], poids: readonly PoidsPosition[]): { t: number; r: number }[];
// intersection des dates (t communs à TOUTES les séries) ; r_p = Σ (w_i/Σ|w|) × r_i ; [] si aucune date commune.
export interface RisquePortefeuille { var95Pct: number; var99Pct: number; cvar95Pct: number; nJours: number; }
export function risquePortefeuille(rp: readonly { r: number }[]): RisquePortefeuille | null; // null si < 30 ; VaR = −quantile (positif = perte), CVaR95 = −moyenne des r ≤ q5.
export function contributionsRisque(series: readonly SerieActif[], poids: readonly PoidsPosition[]): { symbol: string; ctr: number }[];
// ctr_i = w̃_i × cov(r_i, r_p)/var(r_p) sur dates communes, Σ ctr = 1 (asserté en test) ; [] si var(r_p) = 0.
export function betasVsRef(series: readonly SerieActif[], ref: SerieActif): { symbol: string; beta: number | null }[]; // cov/var sur dates communes par actif, null si < 30 communes ou var(ref)=0
export function stressGrid(poids: readonly PoidsPosition[], betas: ReadonlyMap<string, number | null>, chocs?: readonly number[]): { chocPct: number; impactUsd: number; couvertUsd: number }[];
// chocs défaut [-20,-10,10,20] ; impact = Σ w_i × β_i × choc/100 (β null → exclu, cumulé dans couvertUsd = Σ|w| des inclus).
export function equityHistorique(prix: ReadonlyMap<string, { t: number; close: number }[]>, tailles: ReadonlyMap<string, number>): { t: number; equity: number }[];
// Σ taille_i × close_i,t sur l'intersection des dates (tailles SIGNÉES par direction — short : contribution −taille×close + 2×taille×prixEntrée ? NON : v1 = valeur brute Σ taille×close des LONGS + (2×entrée−close)×taille des SHORTS — trop subtil : simplifier en PnL cumulé : equity_t = Σ_i signe_i × taille_i × (close_i,t − entree_i) ; base 0 = aujourd'hui-90j. Interface : tailles → { taille: number; entree: number; signe: 1|-1 }).
```
NOTE contrôleur sur `equityHistorique` : la formule retenue est le **PnL cumulé rétro-projeté** `Σ signe_i × taille_i × (close_t − entree_i)` (courbe du P&L de la composition actuelle, 0 à l'entrée théorique) — plus honnête qu'une « valeur » qui mélangerait cash inconnu. Adapter la signature en conséquence ; libeller la courbe « P&L de la composition actuelle (90 j) ».

- [ ] **Step 1: Tests rouges** — intersection de dates (série trouée) ; r_p exact sur fixture 2 actifs main-calculée (poids signés, short) ; VaR/CVaR signes (perte positive) + null < 30 ; Σ ctr = 1 exact, ctr négative pour un hedge (fixture short corrélé) ; beta = 2 sur fixture r=2·rRef ; stress impact exact + couvertUsd ; equity PnL cumulé exact (long + short).
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- portRisque`
- [ ] **Step 5: Commit** — `feat(port): calculs de risque du portefeuille (VaR, contributions, bêtas, stress, équity)`

### Task 2: Collecte + section UI « Risque »

**Files:**
- Modify: `apps/web/src/components/PortfolioWindow.tsx` (+ helper de collecte local ou `data/portRisque.ts`)

- [ ] **Step 1:** Collecte au dépliage de la section (lazy, + Rafraîchir) : positions OUVERTES → symboles uniques → `binanceAdapter.fetchKlines(s, "1d", {limit: 91})` via mapPool (concurrence 4, cache mémoire module 1 h par symbole) + BTCUSDT pour la référence β ; symboles en échec/non-Binance → exclus, comptés (« N positions hors calcul »).
- [ ] **Step 2:** Rendus : badges VaR95/99 1 j ($ = pct × Σ|w| ; %), CVaR95 ; tableau contributions (symbole, poids %, β formaté, ctr % teintée signe) ; grid stress 4 cellules ($ teintés) ; canvas « P&L de la composition actuelle (90 j) » (ligne, zéro pointillé, patron canvas repo) ; note honnête des 3 approximations ; « historique insuffisant » si null.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(port): section Risque (VaR portefeuille, contributions, stress BTC, courbe P&L)`

Gate visuel (contrôleur) : avec 2-3 positions saisies (dont 1 short), VaR/$ plausibles, Σ contributions ≈ 100 %, stress signés cohérents (short → impact positif sur choc négatif), courbe P&L continue, note visible, 0 position → section masquée.
