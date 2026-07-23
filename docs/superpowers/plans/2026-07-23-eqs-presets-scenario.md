# EQS presets scénario — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4 presets « scénario de trade » (Long potentiel, Short potentiel, Range, Compression) + extension du catalogue d'indicateurs screenables (ADX, BB bandwidth via nouvelle dérive `lastPct`) + sélecteur groupé — spec `2026-07-23-lot-v15-lisibilite-presets-design.md` §2.

**Architecture:** T1 étend le catalogue pur + la dérive (data/screener.ts, consommée par le worker sans modification de son flux) ; T2 ajoute les presets constants + l'UI de sélection groupée.

**Tech Stack:** TypeScript, Web Worker existant, vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique. Zéro changement au moteur de run hors la dérive `lastPct`.
- Sortie brute `bbBandwidth.bandwidth` = ratio (upper−lower)/basis → la dérive `lastPct` (dernière valeur ×100) l'expose en % comparable entre actifs.
- Seuils des presets = valeurs de départ de la spec ; le CALIBRAGE relève du gate (contrôleur) : un preset systématiquement vide sur l'univers réel → seuil ajusté et consigné au rapport de gate, pas dans cette branche.
- Branche : `feat/eqs-presets-scenario`. TDD sur T1. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/screener.ts` (`INDICATOR_FIELDS` :290, `IndicatorFieldSpec.derive` :275, `deriveScalar` :418, `BUILTIN_PRESETS` :467, labels des presets existants)
- `apps/web/src/workers/screener.worker.ts` (consommation de `deriveScalar` :109 — vérifier qu'aucun switch sur derive n'y existe en propre)
- `apps/web/src/components/ScreenerWindow.tsx` (sélecteur de presets actuel — structure à grouper)

---

### Task 1: Dérive `lastPct` + catalogue ADX / BBW

**Files:**
- Modify: `apps/web/src/data/screener.ts`
- Test: `apps/web/src/data/screener.test.ts` (extension)

**Interfaces (Produces — consommé par T2 et le worker):**
```ts
// IndicatorFieldSpec.derive : "last" | "distPct" | "lastPct"  (lastPct = dernière valeur définie × 100)
// INDICATOR_FIELDS += :
//  { id: "adx", label: "ADX", indicatorId: "adx", output: "adx", paramKey: "length", defaultParam: 14, derive: "last", unit: "" }
//  { id: "bbw", label: "BB bandwidth", indicatorId: "bbBandwidth", output: "bandwidth", paramKey: "length", defaultParam: 20, derive: "lastPct", unit: "%" }
```

- [ ] **Step 1: Tests rouges** — `deriveScalar` lastPct (0.042 → 4.2 ; série vide → undefined) ; non-régression last/distPct ; résolution `getIndicatorField("adx"/"bbw")` ; les outputs `adx`/`bandwidth` existent dans les defs du registre (test d'intégrité via getIndicator).
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- screener`
- [ ] **Step 5: Commit** — `feat(eqs): dérive lastPct + ADX et BB bandwidth screenables`

### Task 2: 4 presets scénario + sélecteur groupé + gate

**Files:**
- Modify: `apps/web/src/data/screener.ts` (BUILTIN_PRESETS), `apps/web/src/components/ScreenerWindow.tsx`

**Interfaces (Produces — ids consommés par le pont SQZ, branche 1):**
```ts
// BUILTIN_PRESETS += (tf "4h" partout, description: string NOUVEAU champ optionnel de ScreenerPreset) :
// builtin:long-potentiel  « ▲ Long potentiel (rebond) »   : volumeUsd24h > 10M ; fundingPct < 0 ; oiChangePct > 0 ; RSI(14) < 35
// builtin:short-potentiel « ▼ Short potentiel (euphorie) »: volumeUsd24h > 20M ; fundingPct > 0.03 ; oiChangePct > 2 ; longShortRatio > 1.5 ; RSI(14) > 70
// builtin:range           « ↔ Range / mean-reversion »    : volumeUsd24h > 5M ; absPriceChangePct24h < 2 ; ADX(14) < 20 ; BBW(20) < 6
// builtin:compression     « ◆ Compression (breakout) »    : volumeUsd24h > 5M ; BBW(20) < 3
// description = une phrase (logique du scénario, reprise de la spec §2).
```

- [ ] **Step 1:** Presets + champ `description?` (affiché en `title` natif). Test : ids présents, champs des conditions valides (BaseField/fieldId existants — test structurel).
- [ ] **Step 2:** Sélecteur groupé : « Scénarios » (les 4, glyphe ▲▼↔◆ teinté up/down/dim/accent) / « Filtres » (les 7 existants) / « Mes presets » (utilisateur). `title` = description. Structure visuelle du sélecteur existant conservée (groupes = sous-titres discrets, pas de refonte).
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(eqs): presets scénario (long/short/range/compression) + sélecteur groupé`

Gate visuel (contrôleur) : les 4 presets chargent leurs conditions dans le builder, un run de chacun rend des résultats plausibles sur l'univers réel (calibrage des seuils si vide systématique — consigné), descriptions au survol, groupes lisibles, presets existants et « Mes presets » intacts.
