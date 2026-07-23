# NETLIQ périodes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Période sélectionnable (1 a / 2 a / 5 a / 10 a) sur la fenêtre NETLIQ, overlay BTC paginé en conséquence — spec `2026-07-23-lot-v16-onchain-expy-dist-data-design.md` §2.

**Architecture:** Paramètre `annees` de bout en bout (fetch → store → fenêtre), cache TTL par fenêtre, pagination arrière des klines 1d pour l'overlay au-delà de ~2.7 a.

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique. Une seule tâche (branche courte).
- Défaut 2 a (comportement actuel préservé au premier lancement). Persistance `axiom:netliq:fenetre` tolérante.
- Klines Binance 1d : limite par appel à VÉRIFIER live (attendu 1000) → pagination ARRIÈRE par endTime (mécanique du store cbprem) pour 5 a (~1826 j) et 10 a (~3653 j), ≤4 pages.
- Branche : `feat/netliq-periodes`. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/netliq.ts` (`fetchSeriesNetliq` — observation_start), `store/netliq.ts` (TTL 12 h, run), `components/NetliqWindow.tsx` (en-tête, overlay BTC fetch 730)
- `apps/web/src/store/cbprem.ts` (pagination arrière klines par endTime)
- `components/ui.tsx` (`Segmente`)

---

### Task 1: Période de bout en bout

**Files:**
- Modify: `apps/web/src/data/netliq.ts`, `apps/web/src/store/netliq.ts`, `apps/web/src/components/NetliqWindow.tsx`
- Test: `data/netliq.test.ts` + `store/netliq.test.ts` (extensions)

**Interfaces (Produces):**
```ts
export type FenetreNetliq = 1 | 2 | 5 | 10; // années
export async function fetchSeriesNetliq(nowMs: number, annees: FenetreNetliq): Promise<…>; // observation_start = nowMs − annees (setUTCFullYear −annees)
// store : { fenetreAnnees: FenetreNetliq (persisté, défaut 2), setFenetre(a) → re-run force,
//          cache TTL 12 h PAR fenêtre (majTs+serie invalidés au changement — le skip TTL ne doit
//          pas servir une série 2 a quand on demande 10 a) }
export async function fetchKlines1dPagine(symbol: string, nJours: number): Promise<{ t: number; close: number }[]>;
// pagination arrière endTime ≤4 pages (limite/appel vérifiée live en Step 1), dédupliquée, triée.
```

- [ ] **Step 1:** Vérifier live la limite klines 1d (`curl "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1500"` → combien de lignes ?). Consigner. Tests rouges : observation_start par fenêtre (4 valeurs) ; skip TTL invalidé au changement de fenêtre (run(2a) frais puis setFenetre(10) → re-fetch) ; pagination (fixtures : jointure sans doublon, tri).
- [ ] **Step 2:** Implémentation : data (param annees + pagination overlay), store (fenetreAnnees persisté + invalidation), fenêtre (`Segmente` « 1 a | 2 a | 5 a | 10 a » dans l'en-tête à côté de ₿ BTC ; l'overlay BTC utilise `fetchKlines1dPagine(nJours = annees×365+5)` et son cache local est invalidé au changement de fenêtre ; NoteSource « … · fenêtre N a » ; repères min/max = extrêmes de la fenêtre affichée).
- [ ] **Step 3:** Suite web + tsc verts. **Step 4: Commit** — `feat(netliq): période sélectionnable 1/2/5/10 ans (fetch, cache par fenêtre, overlay paginé)`

Gate visuel (contrôleur) : bascule 1 a → 10 a → courbe re-fetchée (Réseau : observation_start correct), overlay BTC couvre toute la fenêtre en 5/10 a (pagination visible en Réseau, ≤4 appels), reload → fenêtre persistée, re-bascule vers une fenêtre déjà vue < 12 h → à trancher au gate selon l'implémentation du cache (re-fetch accepté).
