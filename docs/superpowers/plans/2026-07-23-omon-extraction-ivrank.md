# OMON extraction dessins + IV Rank — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire les fonctions de dessin d'OptionsWindow (demande de la revue finale v1.2) puis ajouter la métrique IV Rank (percentile DVOL 90 j) — spec `2026-07-23-lot-v13-consolidation-quickwins-design.md` (branche 2).

**Architecture:** T1 = pur déplacement de code (zéro comportement) ; T2 = calcul pur nouveau ; T3 = câblage métrique. L'extraction PRÉCÈDE IV Rank pour que T3 travaille sur le fichier allégé.

**Tech Stack:** TypeScript, canvas 2D, vitest.

## Global Constraints

- Commentaires en **français**. `nowMs` injecté dans la logique pure. `git -C` systématique.
- T1 : ZÉRO changement de comportement — le diff des fonctions déplacées doit être un déplacement à l'identique (mêmes noms, mêmes signatures, mêmes constantes) ; seuls les imports changent.
- Branche : `chore/omon-extraction-ivrank`. Gate : `pnpm test` racine + tsc verts + non-régression visuelle des 4 vues OMON (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/components/OptionsWindow.tsx` (les 4 fonctions de dessin : `dessinerSmile`, `dessinerBarres`, `dessinerHeatmapOi`, `dessinerTermIv`, et leurs constantes SMILE_PAD_*/HEATMAP_PAD_*/TERMIV_PAD_* + helpers locaux qu'elles seules utilisent)
- `apps/web/src/data/referentiels.ts` (:126 — accesseur historique DVOL 90 j utilisé par le régime, avec son cache TTL)
- `apps/web/src/data/cot.ts` (`cotIndex` — contraste : ici on veut un percentile-RANK, pas un min-max)

---

### Task 1: Extraction des fonctions de dessin

**Files:**
- Create: `apps/web/src/components/omon/dessins.ts`
- Modify: `apps/web/src/components/OptionsWindow.tsx`

**Interfaces (Produces):** `dessins.ts` exporte les 4 fonctions de dessin + les constantes de padding (mêmes noms). `OptionsWindow.tsx` les importe. Signatures STRICTEMENT inchangées.

- [ ] **Step 1:** Identifier le périmètre exact : les 4 fonctions, les constantes de padding, et les helpers utilisés UNIQUEMENT par elles (ex. formatteurs locaux du dessin). Ce qui est partagé avec le JSX (survols, formatteurs d'en-tête) RESTE dans OptionsWindow.
- [ ] **Step 2:** Déplacer (couper-coller à l'identique) vers `omon/dessins.ts` avec un en-tête français (POURQUOI : fichier OptionsWindow à sa dernière marge, revue finale v1.2). Exporter ; importer côté fenêtre.
- [ ] **Step 3:** `pnpm --filter @axiom/web test` complet vert + `pnpm --filter @axiom/web typecheck` propre. Vérifier `git diff --stat` : OptionsWindow doit PERDRE ~500-650 lignes, dessins.ts les gagner.
- [ ] **Step 4: Commit** — `refactor(omon): fonctions de dessin extraites vers omon/dessins.ts (zéro comportement)`

### Task 2: Calcul pur `ivRank`

**Files:**
- Create: `apps/web/src/data/ivRank.ts`
- Test: `apps/web/src/data/ivRank.test.ts`

**Interfaces (Produces — consommé par Task 3):**
```ts
export function ivRank(historique: number[], courant: number): number | null;
// percentile-RANK classique : 100 × (nb de points STRICTEMENT < courant) / n, arrondi entier ;
// points non finis exclus ; null si n < 30 après exclusion ou courant non fini.
```

- [ ] **Step 1: Tests rouges** — courant > tous → 100 ; < tous → 0 ; médiane d'une série uniforme → ~50 ; doublons (courant égal à k points → ils ne comptent pas dans « strictement < ») ; NaN exclus ; n<30 → null ; courant NaN → null.
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- ivRank`
- [ ] **Step 5: Commit** — `feat(omon): ivRank — percentile du DVOL courant (pur)`

### Task 3: Métrique « IV Rank (90 j) » + gate

**Files:**
- Modify: `apps/web/src/components/OptionsWindow.tsx`

**Interfaces:** Consumes Task 2 (`ivRank`), l'accesseur DVOL 90 j de `referentiels.ts` (cache TTL existant — ZÉRO fetch nouveau), le state `dvol` courant existant d'OMON.

- [ ] **Step 1:** Charger l'historique via l'accesseur referentiels (au même rythme que le poll OMON existant, pas de polling propre) ; métrique d'en-tête vue Smile « IV Rank (90 j) » à côté de DVOL : valeur entière, teintée `--down` si ≥ 80 (vol chère), `--up` si ≤ 20, neutre sinon, « — » si null ; `title` natif « percentile du DVOL sur 90 j ».
- [ ] **Step 2:** `pnpm test` racine + tsc verts (gate de branche). Vérif visuelle (métrique + non-régression 4 vues) déléguée au contrôleur.
- [ ] **Step 3: Commit** — `feat(omon): métrique IV Rank (percentile DVOL 90 j)`
