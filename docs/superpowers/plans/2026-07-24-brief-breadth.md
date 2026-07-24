# Brief enrichi + breadth — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BRIEF devient un morning brief complet : sections Régime/breadth, Squeeze, Funding extrêmes, VaR chart, COT semaine — spec `2026-07-24-lot-v17-trader-fond-design.md` §3.

**Architecture:** T1 = brique breadth (fetch top 50 + calculs purs + cache 12 h) ; T2 = les 5 sections BRIEF (best-effort, patron Section<T> existant).

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique. Chaque section est BEST-EFFORT (une panne n'affecte que sa section — patron BriefWindow existant).
- Breadth : top 50 USDT par volume, klines 1d limit 210, mapPool concurrence 6, cache localStorage 12 h (`axiom:breadth:v1`) — ~50 requêtes spot 1×/12 h, budget trivial.
- COT semaine : lecture du CACHE cot uniquement (jamais de fetch dédié) — cache vide → section absente.
- Branche : `feat/brief-breadth`. TDD sur les purs. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/components/BriefWindow.tsx` (patron Section<T>/EN_ATTENTE/corps/lancer — TOUT s'y insère) 
- `apps/web/src/data/screener.ts` (parseTicker24h, TICKER_24H_URL via store, parsePremiumIndex) ; `store/screener.ts` (mapPool)
- `apps/web/src/data/squeeze.ts` + `store/squeeze.ts` (fusion sources du radar — la section réutilise les MÊMES fetchs, pas le store UI)
- `apps/web/src/data/distVar.ts` (VaR chart) ; `store/cot.ts` (forme du cache) ; `data/breadth… n'existe pas`

---

### Task 1: Brique breadth

**Files:**
- Create: `apps/web/src/data/breadth.ts` — Test: `apps/web/src/data/breadth.test.ts`

**Interfaces (Produces — consommé par T2):**
```ts
export interface ResumBreadth { nUnivers: number; pctAuDessusMm50: number; pctAuDessusMm200: number;
  adJour: { hausses: number; baisses: number };            // univers ticker complet (Δ24h signé)
  pctMm50Prec: number | null;                              // valeur du cache précédent (tendance) — null au premier calcul
  ts: number; }
export function calculerAuDessusMm(closes: readonly number[], longueur: number): boolean | null; // SMA simple, null si < longueur closes
export function resumerBreadth(parSymbole: readonly { closes: number[] }[], ad: { hausses: number; baisses: number }, prec: number | null, nowMs: number): ResumBreadth;
export async function fetchBreadth(force?: boolean): Promise<ResumBreadth | null>;
// cache localStorage axiom:breadth:v1 TTL 12 h (retourné si frais et !force) ; sinon : ticker 24h → top 50 USDT
// par volume (exclusions stables : paires *UP/*DOWN/*BEAR/*BULL et stablecoin-vs-stablecoin type USDCUSDT — liste
// courte documentée) + A/D sur l'univers USDT complet ; klines 1d limit 210 ×50 (mapPool 6, échecs tolérés
// et comptés) ; échec ticker → cache périmé si présent sinon null.
```

- [ ] **Step 1: Tests rouges** — calculerAuDessusMm (SMA exacte main-calculée, bornes, null) ; resumerBreadth (pourcentages exacts avec échantillons null exclus du dénominateur, A/D, tendance prec) ; exclusions de l'univers (fixture ticker avec UP/DOWN/USDCUSDT) ; cache frais/périmé/force (localStorage simulé).
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- breadth`
- [ ] **Step 5: Commit** — `feat(breadth): breadth de marché top 50 (MM50/200, A/D, cache 12 h)`

### Task 2: Sections BRIEF + gate

**Files:**
- Modify: `apps/web/src/components/BriefWindow.tsx` (+ petits helpers data si besoin)

- [ ] **Step 1:** Section « Régime » : jauges % > MM50 / % > MM200 (barres horizontales teintées par tranche : > 60 up, < 40 down, sinon dim), A/D jour, tendance vs calcul précédent (flèche) ; source `fetchBreadth()`.
- [ ] **Step 2:** Section « Squeeze » : top 3 carburant-squeeze par score — réutilise `fusionnerSources`/`construirePoints`/`scoreSqueeze` avec les MÊMES fetchs que le store squeeze (extraire du store la collecte en fonction réutilisable si elle est enfermée — modification chirurgicale consignée) ; clic symbole → navigateTo.
- [ ] **Step 3:** Section « Funding extrêmes » : top 3 |funding| > 0.03 %/8 h (premiumIndex via extUrl, parsePremiumIndex) — vide → « aucun extrême » (signal en soi).
- [ ] **Step 4:** Section « VaR chart » : VaR95/99 20b du chart maître via distVar sur les candles chargées (patron DistWindow simplifié — lecture getState, pas d'abonnement : le brief est un instantané) ; < 300 bougies → absente.
- [ ] **Step 5:** Section « COT (semaine) » : depuis le cache cot legacy SEUL — les 3 instruments au |delta hebdo| max (réutilise deltaSemaines) ; cache vide → absente.
- [ ] **Step 6:** Insertion dans l'ordre : Régime en tête, Squeeze/Funding après Watchlist, VaR après Dérivés, COT avant Éco (ajustement fin visuel autorisé). `pnpm test` racine + tsc verts. **Step 7: Commit** — `feat(brief): morning brief — régime/breadth, squeeze, funding extrêmes, VaR, COT semaine`

Gate visuel (contrôleur) : BRIEF ouvre avec les nouvelles sections peuplées (breadth % plausibles vs marché, squeeze cohérent avec la fenêtre SQZ, funding extrêmes = état réel), sections best-effort (COT absente si cache vide acceptable), Réseau : ~50 klines 1× puis cache.
