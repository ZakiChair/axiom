# Indicateur CVD spot vs perp — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indicateur de divergence de flux agresseur spot vs perp (item ⭐ Tier 1 du backlog maison) — spec `2026-07-23-indicateur-cvd-spot-perp-design.md`.

**Architecture:** Une nouvelle série auxiliaire `perpDelta` (delta agresseur perp par bougie, via fapi klines, alignée par `auxProvider`) + un `IndicatorDef` pur `cvdSpotPerp` qui compare le CVD spot (champs taker des bougies) au CVD perp normalisés par l'écart-type de leurs propres deltas, et rend la divergence en histogramme signé.

**Tech Stack:** TypeScript, moteur indicateurs pur (`packages/indicators`), auxProvider (`apps/web`), vitest.

## Global Constraints

- Commentaires en **français**. Le moteur reste PUR : aucun fetch dans le def — tout le réseau vit dans `auxProvider`.
- Dégradation gracieuse : `perpDelta` absent/vide → `cvdPerp` et `divergence` undefined, `cvdSpot` seul tracé ; bougies sans `buyVolume/sellVolume` → tout undefined. JAMAIS de throw (modèle `fundingRate.ts:13-31`).
- Jambe perp = Binance USDT-M (fapi) uniquement ; exchange ≠ binance ou pas de perp → série vide.
- Branche : `feat/ind-cvd-spot-perp`. TDD. Gate : `pnpm test` racine vert + tsc.

**Modèles à lire AVANT d'implémenter :**
- `packages/types/src/index.ts` (AuxSeriesId :178-194, AuxSeries :196-201, IndicatorDef :256-278, Candle enrichie :56-71)
- `apps/web/src/chart/auxProvider.ts` (patron complet d'une série : fetch, TTL, single-flight, `alignAux` ; dégradation :222-241)
- `packages/indicators/src/volume/cvd.ts` (convention CVD : cumul depuis la première bougie chargée)
- `packages/indicators/src/derivatives/fundingRate.ts:13-31` (lecture défensive de `ctx.aux`)
- `apps/web/src/data/binanceFutures.ts` (fetch klines fapi existant s'il y en a un — réutiliser l'URL/parse plutôt que dupliquer)
- Commit modèle d'ajout : `31bbee4` (fichier + test + registry, `+12/-1` sur registry.ts)

---

### Task 1: Série auxiliaire `perpDelta`

**Files:**
- Modify: `packages/types/src/index.ts` (AuxSeriesId + commentaire)
- Modify: `apps/web/src/chart/auxProvider.ts`
- Create ou Modify (selon patron du repo): fonction pure de calcul du delta depuis les lignes klines, avec test — `apps/web/src/data/binanceFutures.ts` + son `.test.ts` (ou fichier data dédié si plus propre localement)

**Interfaces (Produces — consommées par Task 2):**
```ts
// types: AuxSeriesId gagne "perpDelta"
// pure, testée :
export function deltaDepuisKlinesPerp(rows: unknown[][]): { t: number; delta: number }[];
// fapi/v1/klines : delta = 2 × takerBuyBaseVolume − volume (indices officiels du tableau kline fapi) ;
// lignes malformées ignorées.
// auxProvider : série "perpDelta" — symbole perp = même convention spot→perp que les features existantes ;
// TTL cohérent avec les séries fapi existantes ; alignement sur les bougies via le mécanisme alignAux existant ;
// pas de perp / exchange ≠ binance / échec réseau → série vide.
```

- [ ] **Step 1: Tests rouges** de `deltaDepuisKlinesPerp` : fixture klines fapi (tableaux bruts) → deltas corrects (achat dominant positif), ligne malformée ignorée, tableau vide → [].
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- binanceFutures` (ou fichier choisi).
- [ ] **Step 5:** Câbler `perpDelta` dans `auxProvider` en suivant EXACTEMENT le patron d'une série fapi existante (TTL, single-flight, dégradation). Pas de test unitaire du câblage réseau (convention repo) — mais la décision symbole spot→perp doit réutiliser l'existant, pas le dupliquer.
- [ ] **Step 6: Commit** — `feat(aux): série perpDelta — delta agresseur perp par bougie (fapi)`

### Task 2: Def `cvdSpotPerp` — `packages/indicators`

**Files:**
- Create: `packages/indicators/src/orderflow/cvdSpotPerp.ts`
- Test: `packages/indicators/src/orderflow/cvdSpotPerp.test.ts`

**Interfaces (Produces):**
```ts
export const cvdSpotPerp: IndicatorDef;
// id "cvdSpotPerp", category "orderflow", pane "separate", aux: ["perpDelta"]
// inputs : fenetre (défaut 100, min 20, max 500) ; lissage (défaut 3, min 1, max 50 — EMA des deltas, 1 = brut)
// outputs : cvdSpot (line, up), cvdPerp (line, down), divergence (histogram, alpha réduit) — precision 2
// calc :
//   deltaSpot[i] = buyVolume[i] − sellVolume[i] (undefined si champs absents)
//   deltas lissés (EMA lissage), cumulés depuis la première bougie chargée (convention cvd)
//   normalisation : chaque CVD divisé par le stdev roulant (fenetre) de SES deltas lissés ;
//     undefined tant que < 20 points de stdev ou stdev = 0
//   divergence[i] = cvdSpotNorm[i] − cvdPerpNorm[i] (undefined si l'un des deux l'est)
```

- [ ] **Step 1: Tests rouges** :
  - cumul/rebase : fixtures deltas connus → CVD attendus (valeurs commentées dans le test) ;
  - invariance d'échelle : ×10 sur tous les volumes d'une jambe → mêmes séries normalisées (tolérance flottants) ;
  - divergence signée : scénario spot-achète/perp-vend → histogramme positif croissant ;
  - dégradations : `ctx.aux.perpDelta` absent → cvdPerp/divergence undefined, cvdSpot tracé ; bougies sans taker → tout undefined ; stdev nul → undefined ;
  - lissage=1 = deltas bruts (comparaison directe).
- [ ] **Step 2: Rouge** — `pnpm --filter @axiom/indicators test -- cvdSpotPerp`
- [ ] **Step 3-4: Implémenter → vert.**
- [ ] **Step 5: Commit** — `feat(indicators): cvdSpotPerp — divergence de flux spot vs perp`

### Task 3: Enregistrement + gate

**Files:**
- Modify: `packages/indicators/src/registry.ts` (import + entrée tableau)
- Modify: le test de compte du registre s'il asserte un nombre en dur (le chercher — probablement `registry.test.ts` du package)

- [ ] **Step 1:** Import + entrée `INDICATORS` (zone orderflow) ; compte du registre mis à jour si asserté.
- [ ] **Step 2:** `pnpm --filter @axiom/indicators test` complet vert ; `pnpm --filter @axiom/web test` vert (menu Indicateurs : l'entrée apparaît par catégorie automatiquement — vérifier qu'aucun test de menu n'asserte un compte).
- [ ] **Step 3:** `pnpm test` racine vert + `pnpm typecheck`.
- [ ] **Step 4: Commit** — `feat(indicators): enregistrement cvdSpotPerp`
- [ ] **Step 5:** Vérif visuelle contrôleur au gate : BTCUSDT (deux courbes + histogramme cohérents) ; paire sans perp → CVD spot seul, zéro erreur console.
