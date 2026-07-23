# Clé BGeometrics + on-chain élargi — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proxy `/bgapi` avec repli de clé .env (Bearer), correction du format d'auth, quota 10/h, et 3 nouvelles métriques bitcoin-data.com (flux ETF BTC en repli SoSoValue, hashrate, OI par exchange) — spec `2026-07-23-lot-v16-onchain-expy-dist-data-design.md` §1.

**Architecture:** T1 = plomberie proxy (vite + daemon, patron sosoapi) + bascule de bgeometrics.ts ; T2 = nouvelles défs/fetch + repli ETF du panneau ON-CHAIN ; T3 = tuile hashrate + section OI par exchange (DES).

**Tech Stack:** TypeScript, Vite proxy, daemon Bun, vitest.

## Global Constraints

- Commentaires **français**. La clé ne DOIT jamais entrer dans le bundle (seul un booléen de présence peut être exposé). `git -C` systématique.
- FAITS VÉRIFIÉS (spec) : seul `Authorization: Bearer <clé>` est reconnu (quota clé ~10 req/h, réponse 429 HOUR vs DAY) ; le format actuel (`Authorization` nu) est INOPÉRANT. `etf-flow-btc`/`open-interest-futures` renvoient des CHAÎNES (`unixTs`, valeurs). 404 : difficulty/funding-rates/miner-revenue.
- Clé personnelle (Réglages) PRIORITAIRE sur le repli .env (le proxy n'injecte que si aucun header Authorization entrant).
- Branche : `feat/bg-cle-onchain`. TDD sur parseurs/formatage. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/vite.config.ts` (patron sosoapi : proxy + injection d'en-tête conditionnelle, lecture .env :59-65) et le pendant daemon (chercher « sosoapi » dans apps/daemon/src — route + injection)
- `apps/web/src/data/onchain/bgeometrics.ts` (TOUT : BASE, fetchBgeometricMetrique, compteur quota, défs) et `store/onchain.ts` (bgeometricsKeyStore)
- `apps/web/src/components/OnchainWindow.tsx` (section ETF SoSoValue actuelle + sections tuiles/sparklines) et `DerivativesWindow.tsx` (structure des sections)

---

### Task 1: Proxy `/bgapi` + bascule Bearer + quota horaire

**Files:**
- Modify: `apps/web/vite.config.ts`, `apps/web/.env.example` (déjà fait — vérifier), le fichier daemon des proxys (patron sosoapi), `apps/web/src/data/onchain/bgeometrics.ts`
- Test: extension des tests existants de bgeometrics/daemon si présents

**Interfaces (Produces):**
```ts
// bgeometrics.ts : BASE = "/bgapi/v1" (même origine) ; clé personnelle envoyée `Bearer ${cle}` ;
// export const BG_CLE_ENV_PRESENTE: boolean  (booléen Vite define/import.meta.env VITE_… — JAMAIS la clé) ;
// quota : si clé active (personnelle OU BG_CLE_ENV_PRESENTE) → compteur par HEURE (clé stockage horaire),
// limite affichée 10/« 1heure » ; sinon comportement 15/« 1jour » actuel.
```

- [ ] **Step 1:** Vite : proxy `/bgapi` → bitcoin-data.com, `configure`/`headers` injectant `Authorization: Bearer ${BGEOMETRICS_API_KEY}` si absent ET clé non vide (patron sosoapi octet pour octet) ; exposer la PRÉSENCE via `define` (ex. `__BG_CLE_ENV__: JSON.stringify(cle !== "")`) ou variable VITE_ dérivée — pas la valeur.
- [ ] **Step 2:** Daemon : même route `/bgapi` avec injection depuis le même .env (suivre sosoapi ; ajouter le test miroir de proxy.test.ts si le patron en a un).
- [ ] **Step 3:** bgeomterics.ts : BASE relative, `Bearer`, compteur horaire sous clé, quota santé adapté. Tests du compteur/format si extractibles purs.
- [ ] **Step 4:** Vérif LIVE (dev server 5174) : `curl "http://localhost:5174/bgapi/v1/sopr?startday=…&endday=…"` → 200 (ou 429 HOUR = clé reconnue — consigner). Suite web + tsc verts.
- [ ] **Step 5: Commit** — `feat(onchain): proxy /bgapi avec repli de clé .env (Bearer) + quota horaire`

### Task 2: Défs nouvelles + repli ETF (panneau ON-CHAIN)

**Files:**
- Modify: `apps/web/src/data/onchain/bgeometrics.ts` (défs + parseur chaînes), `apps/web/src/components/OnchainWindow.tsx` (+ store onchain si la section ETF y vit)
- Test: `bgeometrics.test.ts` (extension)

**Interfaces (Produces):**
```ts
export const BG_ETF_FLOW: DefMetriqueBg;   // chemin "etf-flow-btc", champ "etfFlow" — VALEURS CHAÎNES → parseur tolérant (Number(), "NaN"/non-fini ignoré)
export const BG_HASHRATE: DefMetriqueBg;   // chemin "hashrate", champ "hashrate"
export async function fetchOiFuturesParExchange(cle?, signal?): Promise<{ ts: number; jours: { d: string; parExchange: Record<string, number> }[] } | null>;
// open-interest-futures : clés dynamiques (tout champ ≠ d/unixTs), valeurs Number(chaîne), cache 24 h même mécanique.
```

- [ ] **Step 1: T1 VÉRIFIE l'unité d'etfFlow** (échantillon 2738.489 le 2026-07-20) : croiser avec une source publique (flux ETF BTC ce jour-là ≈ X M$ ou X BTC) via une requête d'exploration — CONSIGNER la conclusion et formater en conséquence (M$ ou BTC). Tests rouges parseurs (chaînes, "NaN", champs dynamiques OI) → verts.
- [ ] **Step 2:** Panneau ON-CHAIN : section ETF — si SoSoValue répond, comportement actuel INTACT ; sinon (401/erreur/clé absente) repli bitcoin-data : tuile « Flux ETF BTC (jour) » teintée +/-, sparkline 90 j, cumul 30 j, NoteSource « bitcoin-data.com (repli) ». Le repli ne fetch que si SoSoValue a échoué (pas de double coût).
- [ ] **Step 3:** Suite web + tsc verts. **Step 4: Commit** — `feat(onchain): flux ETF BTC (repli bitcoin-data) + défs hashrate/OI`

### Task 3: Tuile hashrate + section OI par exchange (DES) + gate

**Files:**
- Modify: `apps/web/src/components/OnchainWindow.tsx` (tuile hashrate), `apps/web/src/components/DerivativesWindow.tsx` (section OI)

- [ ] **Step 1:** ON-CHAIN section réseau : tuile « Hashrate » (formatage EH/s : valeur ~9.18e8 TH/s → « 918 EH/s », helper pur testé) + sparkline 120 j (patron des tuiles existantes du panneau).
- [ ] **Step 2:** DES : section repliable « OI BTC par exchange (quotidien) » — barres horizontales triées desc (dernier jour) : exchange, $ formatés, part %, Δ vs J-7 teinté ; données via `fetchOiFuturesParExchange` au premier dépliage (lazy, pas au montage de DES) ; dégradation : erreur → ligne discrète.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(onchain): tuile hashrate + OI BTC par exchange dans DES`

Gate visuel (contrôleur) : Réseau → les appels partent sur `/bgapi/...` (plus AUCUN bitcoin-data.com direct), 200 avec le repli .env ; quota santé « x/10 h » ; section ETF affiche le repli (SoSoValue étant 401) avec valeurs plausibles vs presse spécialisée ; hashrate ~900 EH/s ; OI par exchange : Binance en tête ~9 G$, total cohérent avec la fenêtre DES.
