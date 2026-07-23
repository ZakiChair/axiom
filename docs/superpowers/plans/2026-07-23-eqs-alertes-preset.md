# EQS alertes de preset — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Préviens-moi quand un actif ENTRE dans ce preset » — alertes périodiques sur les presets du screener, notifiées via le canal existant — spec `2026-07-23-lot-v15-lisibilite-presets-design.md` §3.

**Architecture:** T1 factorise le pipeline de run du screener en fonction réutilisable (le store reste l'unique écrivain de son état UI) ; T2 crée le store d'alertes de preset (défs persistées + diff/cooldown purs) et le runtime timer ; T3 câble l'UI (bouton EQS + section du panneau Alertes).

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique. **PRÉREQUIS : branche `feat/eqs-presets-scenario` mergée** (les alertes visent tout preset, mais la base doit contenir la dérive lastPct pour les presets scénario).
- Les alertes de preset ne passent PAS par le moteur `packages/alerts` (AlertDef est par-symbole) : store dédié + runtime dédié, mais MÊMES sorties utilisateur (journal du store d'alertes via `ajouterJournal`, notification système + bip via le helper existant de `alerts/runtime.ts` — l'exporter si privé, modification chirurgicale).
- Période : 15 min si preset SANS condition indicateur, 60 min sinon (figée à la création, affichée). Caps réduits : 30 candidats évalués max. Max 4 alertes actives (création bloquée au-delà, limite affichée). Timer inactif quand `document.visibilityState !== "visible"` (reproduire le pattern des timers funding/liq-cascade de runtime.ts s'il gère la visibilité — sinon garde explicite en tête de tick).
- Amorce silencieuse : le premier run d'une alerte mémorise l'ensemble SANS déclencher. Cooldown 6 h par (alerte, symbole). État runtime (dernier ensemble, cooldowns) en MÉMOIRE seulement — un reload ré-amorce.
- Branche : `feat/eqs-alertes-preset`. TDD sur T1 (si extraction testable) et T2 (diff/cooldown). Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/store/screener.ts` (le `run()` complet :281-422 — pipeline à factoriser ; `mapPool`, caps, notes)
- `apps/web/src/alerts/runtime.ts` (timers funding :183-… et liq-cascade :226-…, `notifier` :438, heartbeat, `demarrerAlertes`)
- `apps/web/src/store/alerts.ts` (`ajouterJournal`, forme `Declenchement` — importée de @axiom/alerts)
- `apps/web/src/components/AlertsPanel.tsx` (structure SidebarSection, où insérer la section « Alertes de scan »)

---

### Task 1: Factorisation `executerScreener`

**Files:**
- Modify: `apps/web/src/store/screener.ts` (ou Create `apps/web/src/data/screenerRun.ts` si l'extraction y est plus propre — suivre le graphe d'imports : la fonction ne doit PAS tirer le windowManager)

**Interfaces (Produces — consommé par le store ET le runtime T2):**
```ts
export interface OptionsRunScreener { capIndicateurs: number; capPosition: number; onProgress?: (done: number, total: number) => void; }
export interface ResultatRunScreener { rows: ScreenerRow[]; notes: string[]; }
export function executerScreener(base: BaseCondition[], indicateurs: IndicatorCondition[], tf: Timeframe, opts: OptionsRunScreener): Promise<ResultatRunScreener>;
// = pipeline actuel (ticker → funding best-effort → filtres base → enrichissement position si requis
// → worker si filtres indicateurs) SANS aucune écriture du screenerStore ; le worker y est
// instancié/terminé localement (un run d'alerte ne tue pas le worker d'un run UI et inversement).
```

- [ ] **Step 1:** Extraire le pipeline en préservant le comportement du store à L'IDENTIQUE : `run()` du store devient un appel à `executerScreener` + les écritures d'état existantes (progress via onProgress, notes, runState). Le mécanisme currentRunId/cancel du store reste dans le store.
- [ ] **Step 2:** Vérifier au diff que la logique déplacée est inchangée (déplacement, pas réécriture). Suite web + tsc verts (les tests screener existants passent sans modification).
- [ ] **Step 3: Commit** — `refactor(eqs): pipeline de run extrait en executerScreener (réutilisable hors store)`

### Task 2: Store presetAlerts + runtime

**Files:**
- Create: `apps/web/src/store/presetAlerts.ts` — Test: `apps/web/src/store/presetAlerts.test.ts`
- Modify: `apps/web/src/alerts/runtime.ts` (timer + notification, patron des timers existants)

**Interfaces (Produces — consommé par T3):**
```ts
export interface AlertePreset {
  id: string; presetId: string; nom: string; tf: Timeframe;
  baseConditions: BaseCondition[]; indicatorConditions: IndicatorCondition[]; // snapshot à la création
  periodeMin: 15 | 60; actif: boolean; creeTs: number;
}
export const presetAlertsStore: StoreApi<{ alertes: AlertePreset[]; ajouter(depuisBuilder): "ok" | "limite"; retirer(id): void; basculer(id): void; }>;
// persistance localStorage "axiom:presetAlerts:v1" (lecture/écriture tolérantes, patron userPresets).
export function diffEntrants(precedent: ReadonlySet<string> | null, courant: readonly string[]): string[];
// null (amorce) → [] ; sinon symboles de courant absents de precedent. PUR.
export function filtrerCooldown(entrants: readonly string[], dernierDeclenchement: ReadonlyMap<string, number>, nowMs: number, cooldownMs: number): string[]; // PUR
```

- [ ] **Step 1: Tests rouges puis verts** — diffEntrants (amorce null → [], entrées/sorties, ensemble identique → []) ; filtrerCooldown (bornes exactes à cooldownMs) ; store (ajouter → periodeMin dérivée des conditions, limite 4 → "limite", persistance, basculer/retirer).
- [ ] **Step 2:** Runtime : timer par alerte active (période propre), garde visibilité, exécution `executerScreener(caps réduits : capIndicateurs 30)`, `diffEntrants` + `filtrerCooldown` → pour chaque symbole retenu : entrée de journal (`ajouterJournal` avec un `Declenchement` au message « EQS <nom> : <SYMBOLE> entre dans le scan ») + notification système/bip via le helper exporté. État runtime en Map module-scope, nettoyé quand l'alerte est retirée/désactivée. Démarrage/arrêt branché dans `demarrerAlertes` (teardown compris).
- [ ] **Step 3:** Suite web + tsc verts. **Step 4: Commit** — `feat(alertes): alertes de preset screener (diff périodique, cooldown, notification)`

### Task 3: UI — bouton EQS + section panneau Alertes + gate

**Files:**
- Modify: `apps/web/src/components/ScreenerWindow.tsx`, `apps/web/src/components/AlertsPanel.tsx`

- [ ] **Step 1:** EQS : bouton « ⏰ Alerte » près du sélecteur de presets (actif si un preset est chargé — comparer builder au preset chargé ou tracker le dernier preset chargé dans le store screener, décision consignée) → `ajouter(...)` ; retour "limite" → toast/message discret « 4 alertes de scan max ». Après création : confirmation discrète avec la période (« vérifié toutes les 60 min »).
- [ ] **Step 2:** AlertsPanel : section compacte « Alertes de scan » (SidebarSection existant) listant les AlertePreset : nom + période + pause (basculer) + ✕ (retirer). Vide → section absente.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(alertes): UI des alertes de preset (création EQS, gestion panneau Alertes)`

Gate visuel (contrôleur) : création depuis un preset scénario (période 60 min affichée), listing/pause/suppression dans le panneau Alertes, limite 4 respectée, run d'alerte observable (raccourcir la période en dev via sonde) → journal + notification sur symbole entrant, amorce silencieuse (pas de rafale à la création), reload → alertes persistées et ré-amorcées.
