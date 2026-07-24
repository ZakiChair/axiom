# Paper trading — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre PAPER — ordres simulés (market/limit/stop + TP/SL) exécutés contre le flux de prix live, positions suivies, clôtures auto-journalisées dans EXPY — spec `2026-07-24-lot-v17-trader-fond-design.md` §2.

**Architecture:** T1 = modèle + évaluateur PUR exhaustif (le cœur à risque) ; T2 = store/moteur (subscribeTickers, persistance, pont EXPY) ; T3 = fenêtre + enregistrement.

**Tech Stack:** TypeScript, vitest, Zustand vanilla.

## Global Constraints

- Commentaires **français**. `git -C` systématique. L'évaluateur est PUR et testé EXHAUSTIVEMENT — aucune décision d'exécution dans le store.
- Conventions documentées : frais taker 0.05 %/côté (constante) ; slippage 0 ; TP/SL remplis AU NIVEAU (pas au last — pas de gap-modeling v1) ; TP et SL touchés dans le même tick → SL prioritaire ; renforcement → prix d'entrée MOYEN pondéré ; solde peut devenir négatif (pas de marge v1).
- Fenêtre : id `paper`, mnémonique `PAPER`, `nouveau: true`, comptes windowManager.test 30 → 31.
- Branche : `feat/paper-trading`. TDD. Gate : `pnpm test` racine + tsc verts + gate visuel scénario complet (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/ticker.ts` (`subscribeTickers` :412, `TickerUpdate` :129, `SubscribeTickersOptions`) et son consommateur Watchlist (cycle de vie de l'abonnement)
- `apps/web/src/data/expy.ts` + `store/expy.ts` (TradeJournal, `ajouter` — le pont de journalisation)
- `apps/web/src/store/paper... n'existe pas` ; patrons : store/cbprem.ts (vanilla), persistance userPresets

---

### Task 1: Modèle + évaluateur pur

**Files:**
- Create: `apps/web/src/data/paper.ts` — Test: `apps/web/src/data/paper.test.ts`

**Interfaces (Produces — consommé par T2/T3):**
```ts
export interface OrdrePaper { id: string; symbol: string; direction: "long" | "short"; type: "market" | "limit" | "stop"; prixLimite: number | null; prixStop: number | null; taille: number; tp: number | null; sl: number | null; creeTs: number; }
export interface PositionPaper { id: string; symbol: string; direction: "long" | "short"; taille: number; prixEntree: number; tp: number | null; sl: number | null; ouvertTs: number; }
export interface ExecutionPaper { ts: number; symbol: string; genre: "ouverture" | "renfort" | "tp" | "sl" | "cloture-manuelle"; direction: "long" | "short"; taille: number; prix: number; fraisUsd: number; pnlUsd: number | null; } // pnl null pour ouverture/renfort
export const FRAIS_TAKER = 0.0005;
export interface EtatPaper { solde: number; ordres: OrdrePaper[]; positions: PositionPaper[]; executions: ExecutionPaper[]; } // executions bornées aux 50 dernières
export function evaluerTick(etat: EtatPaper, symbol: string, last: number, nowMs: number): EtatPaper;
// PURE, retourne un NOUVEL état : 1) stops déclenchés (long: last ≥ prixStop ; short: last ≤ prixStop) → deviennent market ce tick ;
// 2) markets remplis à `last` (frais) → position (fusion par symbol+direction : renfort au prix moyen, TP/SL de l'ordre ÉCRASENT s'ils sont non null) ;
// 3) limits remplis si traversée (long: last ≤ prixLimite ; short: last ≥ prixLimite) au PRIX LIMITE ;
// 4) TP/SL des positions du symbole : SL prioritaire si les deux encadrent last ; rempli AU NIVEAU ; clôture totale → PnL (signé, frais 2 côtés : l'entrée a déjà payé les siens → frais de sortie seuls ici) crédité au solde + exécution.
export function cloturerPosition(etat: EtatPaper, positionId: string, prix: number, nowMs: number): EtatPaper; // clôture manuelle au prix donné (frais sortie), PURE
export function pnlLatent(p: PositionPaper, last: number): number; // signé, sans frais
export function tradeJournalDepuisCloture(p: PositionPaper, exec: ExecutionPaper): /* Omit<TradeJournal,"id"> */; // tag "paper", stopInitial = p.sl ?? p.prixEntree (R null documenté), note = genre
```

- [ ] **Step 1: Tests rouges** — EXHAUSTIFS, fixtures main-calculées : market long rempli + frais exacts ; limit long NON rempli si last > limite, rempli à la traversée AU prix limite ; stop long déclenché → market le même tick ; renfort → prix moyen pondéré exact ; TP long touché → clôture au NIVEAU, PnL = (tp − entree)×taille − frais sortie ; SL short ; TP ET SL encadrant le last dans le même tick → SL exécuté (test discriminant) ; tick d'un AUTRE symbole → état inchangé (référence identique si rien à faire — perf) ; cloturerPosition ; solde négatif possible ; executions bornées 50 ; tradeJournalDepuisCloture (direction/stop/tag/note exacts).
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- paper`
- [ ] **Step 5: Commit** — `feat(paper): modèle et évaluateur pur du paper trading (ordres, TP/SL, frais)`

### Task 2: Store + moteur + pont EXPY

**Files:**
- Create: `apps/web/src/store/paper.ts` — Test: `apps/web/src/store/paper.test.ts` (logique non-réseau)

**Interfaces (Produces — consommé par T3):**
```ts
export const paperStore: StoreApi<EtatPaper & { derniersPrix: Record<string, number>;
  placerOrdre(o: Omit<OrdrePaper, "id" | "creeTs">): void; annulerOrdre(id): void;
  modifierTpSl(positionId, tp, sl): void; cloturer(positionId): void;   // au dernier prix connu du symbole
  setSolde(v): void; }>;
// Moteur interne : subscribeTickers sur l'union des symboles actifs (re-souscription quand l'ensemble change,
// résiliation quand vide) ; chaque TickerUpdate → evaluerTick + derniersPrix ; toute exécution de genre
// tp/sl/cloture-manuelle → expyStore.getState().ajouter(tradeJournalDepuisCloture(...)).
// Persistance axiom:paper:v1 (solde/ordres/positions/executions) à chaque mutation, tolérante ; reprise au boot
// (le moteur démarre à l'import ? NON — démarré par un initialiseur appelé au montage App ou de la fenêtre :
// suivre le patron d'amorçage des stores existants, décision consignée ; les ordres dorment tant que rien ne tick).
```

- [ ] **Step 1:** Implémenter (mutations testées sans réseau : placer/annuler/modifier/cloturer + persistance round-trip + pont EXPY par injection/spy sur expyStore réel réinitialisé).
- [ ] **Step 2:** Cycle d'abonnement : test de l'ensemble des symboles actifs (pur si extrait). Suite web + tsc verts. **Step 3: Commit** — `feat(paper): store et moteur temps réel (subscribeTickers, persistance, pont EXPY)`

### Task 3: Fenêtre PAPER + enregistrement + gate

**Files:**
- Create: `apps/web/src/components/PaperWindow.tsx`
- Modify: `windowManager.ts`, `App.tsx`, `commands/windowPanels.ts`, `windowManager.test.ts` (30 → 31)

- [ ] **Step 1:** En-tête : Solde, Équity (solde + Σ pnlLatent aux derniers prix), PnL jour (Σ executions du jour) — badges teintés ; « ⚙ solde » édition légère.
- [ ] **Step 2:** Formulaire d'ordre : symbole (prérempli chart), direction Segmente, type Segmente (market/limit/stop → champs prix conditionnels), taille en $ (convertie en unités au dernier prix affiché, les deux montrés), TP/SL optionnels ; validations discrètes ; « Placer ».
- [ ] **Step 3:** Tableaux : ordres en attente (type, prix, ✕ annuler) ; positions (entrée, dernier, PnL latent LIVE teinté, TP/SL éditables inline, « Clôturer ») ; 10 dernières exécutions (genre, prix, PnL teinté). États vides propres.
- [ ] **Step 4:** Greffes + comptes (30 → 31). `pnpm test` racine + tsc verts. **Step 5: Commit** — `feat(paper): fenêtre PAPER (ordres, positions live, exécutions)`

Gate visuel (contrôleur) : scénario complet — ordre limit sous le prix → en attente → (sonde : forcer un tick sous la limite OU ordre market) rempli → position avec PnL latent qui vit → poser un TP proche → clôture TP → exécution listée, solde crédité, **trade tagué "paper" visible dans EXPY** ; reload → tout persiste ; annulation d'ordre ; Réseau : 1 abonnement ticker partagé.
