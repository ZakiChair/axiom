# EVTS — étude d'évènements — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fenêtre EVTS : perf du prix alignée autour des N derniers CPI/NFP/FOMC (spaghetti + médiane + p25–p75 + stats pré/post), spec `2026-07-24-lot-v20-analyse-design.md` §C2.

**Architecture:** T1 dates d'évènements (FRED historique + FOMC statique, cache localStorage) ; T2 calculs purs d'alignement (`lib/evts.ts`, patron `lib/seasonality`) ; T3 fenêtre + fetch fenêtré par évènement + canvas ; T4 enrichissement du marqueur ecoMarkers.

**Tech Stack:** TypeScript, vitest, Zustand vanilla, canvas DPR-aware.

## Global Constraints

- Commentaires **français**. Branche : `feat/evts-event-study`. `git -C ~/axiom` systématique. Gate : `pnpm test` racine + tsc verts + gate visuel contrôleur.
- **Écart à la spec, consigné** : dates historiques CPI/NFP via **FRED `release/dates`** (proxy `/fredapi` déjà câblé, cf. `data/eco.ts:409`) au lieu de listes statiques curées — exactes, complètes 2020→présent, et incluent les dates FUTURES planifiées (remplace aussi l'« enrichissement par cache ECO » de la spec, supprimé — YAGNI). Seul FOMC reste statique. Zéro source nouvelle : ce proxy sert déjà le calendrier ECO.
- **Écart au § invariants de la spec** : le menu Fonctions de la Toolbar n'est PLUS une liste en dur — il dérive de `WINDOW_REGISTRY` (`Toolbar.tsx:174-184`, `menuWindows()`). Rien à y toucher.
- Honnêteté d'échantillon : jamais de médiane calculée sur un échantillon différent de celui affiché — les occurrences exclues (fenêtre klines incomplète, fetch en échec) sont LISTÉES avec leur raison.
- Dégradation gracieuse : `/fredapi` en panne → cache ; sans cache → FOMC statique seul + message « CPI/NFP indisponibles ».

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/eco.ts` — patron fetch FRED (`fetchFredReleases` l.409, URL `/fredapi/fred/releases/dates?...`), cache localStorage TTL + clé versionnée (l.310-344), liste `FOMC_DATES` futures l.228 + `FOMC_HEURE_UTC_MS` l.250.
- `apps/web/src/lib/seasonality.ts` + `SeasonalityWindow.tsx` — séparation calculs purs / composant, canvas DPR-aware (`drawBuckets` l.151), `percentile` l.209, `lireTokenCanvas`.
- `apps/web/src/components/SeasonalityWindow.tsx:62-95` — pagination `getAdapter(exchange).fetchKlines(symbol, tf, { limit, endTime })` (PAS de fonction backfill dédiée).
- `apps/web/src/store/windowManager.ts:46-84` — `WINDOW_REGISTRY` (id/title/mnemonic/tailles, `nouveau: true`) ; `WindowId` dérivé → oubli App.tsx = erreur tsc.
- `apps/web/src/App.tsx:144-208` — `WINDOW_COMPONENTS` (lazy) ; montage/persistance/Taskbar automatiques.
- `apps/web/src/commands/windowPanels.ts:16-21` — `basculer(id)` pour la commande palette.
- `apps/web/src/chart/ecoMarkers.ts` — overlay `ecoMarker`, label construit l.108-110 (`tronquer(country + title, 18)`), abonnements dans `demarrerEcoMarkers` l.130.
- `apps/web/src/components/ui.tsx` — `EnTeteFenetre` l.168, `Chargement/ErreurBloc/Vide` l.200-214, `Onglets` l.356, `Segmente` l.388, `NoteSource` l.418.

---

### Task 1: Dates d'évènements (`data/macro/eventDates.ts`)

**Files:**
- Create: `apps/web/src/data/macro/eventDates.ts` — Test: `apps/web/src/data/macro/eventDates.test.ts`

**Interfaces (Produces):**
```ts
export type TypeEvenement = "cpi" | "nfp" | "fomc";
export const TYPES_EVENEMENT: { id: TypeEvenement; label: string }[]; // "CPI US" / "NFP" / "FOMC"
export interface DateEvenement { time: number /* ms UTC exact de publication */; ymd: string }
/** Heure de publication UTC : CPI/NFP 08:30 ET, FOMC 14:00 ET — DST US calculé (pur). */
export function tsPublicationUtc(ymd: string, type: TypeEvenement): number;
/** Second dimanche de mars ≤ date < premier dimanche de novembre (règle DST US post-2007). */
export function estEteUs(ymd: string): boolean;
/** Parse la réponse FRED release/dates → DateEvenement[] trié (pur, testé). */
export function parseReleaseDates(donnees: unknown, type: TypeEvenement): DateEvenement[];
/** CPI/NFP : /fredapi/fred/release/dates?release_id={10|50}&include_release_dates_with_no_data=true
 *  &realtime_start=2020-01-01&limit=1000&sort_order=asc&file_type=json — cache localStorage
 *  "axiom:evts:dates:v1:{type}" TTL 24 h (patron eco.ts). FOMC : statique, AUCUN réseau. */
export async function chargerDatesEvenement(type: TypeEvenement): Promise<DateEvenement[]>;
```

- [ ] **Step 1: Tests rouges** — `estEteUs` : "2026-03-07"→false, "2026-03-08"→true (2e dimanche), "2026-11-01"→false (1er dimanche), "2026-07-15"→true ; `tsPublicationUtc` : CPI été = 12:30 UTC, CPI hiver = 13:30 UTC, FOMC été = 18:00 UTC ; `parseReleaseDates` : fixture JSON FRED (forme `{ release_dates: [{ date: "2025-06-11", release_id: 10 }, ...] }`) → trié, dédoublonné, dates invalides ignorées ; fixture vide → `[]`.
- [ ] **Step 2: Implémentation** — helpers purs + `chargerDatesEvenement` (fetch + cache, patron `lireCache/ecrireCache` d'eco.ts recopié en local — PAS d'export nouveau depuis eco.ts). Tests verts.
- [ ] **Step 3: FOMC statique historique** — constante `FOMC_DATES_HISTO: readonly string[]` : dates de DÉCISION (2e jour de réunion) 2020-01 → présent, à curer depuis la page officielle https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (et sa version « historical materials » pour 2020-2021), format `"YYYY-MM-DD"` comme `FOMC_DATES` d'eco.ts. Concaténer avec les futures de `FOMC_DATES` (importées ? NON : eco.ts ne les exporte pas — les recopier ici avec un commentaire de provenance, décision consignée). Test : liste strictement croissante, ~8 décisions/an sur 2022-2025.
- [ ] **Step 4:** `pnpm test` racine + tsc verts. **Step 5: Commit** — `feat(evts): dates d'évènements CPI/NFP (FRED historique) + FOMC statique`

### Task 2: Calculs purs d'alignement (`lib/evts.ts`)

**Files:**
- Create: `apps/web/src/lib/evts.ts` — Test: `apps/web/src/lib/evts.test.ts`

**Interfaces (Produces):**
```ts
import type { Candle } from "@axiom/types";
export interface FenetreAlignee { eventTime: number; points: { offset: number /* −N..+N */; ratio: number /* close/close(H0), H0=1 */ }[] }
export interface OccurrenceExclue { eventTime: number; raison: "fenetre-incomplete" | "fetch-echec" }
/** H0 = dernière bougie ouverte ≤ eventTime ; fenêtre = [i−N, i+N] ; incomplète → exclue. */
export function alignerFenetre(candles: Candle[], eventTime: number, demiFenetre: number): FenetreAlignee | OccurrenceExclue;
export interface AgregatEvts { offsets: number[]; mediane: number[]; p25: number[]; p75: number[] }
export function agregerFenetres(fenetres: FenetreAlignee[]): AgregatEvts;
export interface StatsEvts { perfMedianePre: number; perfMedianePost: number; volPost: number /* écart-type des retours par barre post, en % */; min: number; max: number }
export function statsEvts(fenetres: FenetreAlignee[]): StatsEvts;
```

- [ ] **Step 1: Tests rouges** — `alignerFenetre` : fixture 100 bougies 1h régulières, évènement au milieu → H0 correct (bougie couvrant l'évènement), 2N+1 points, ratio H0 = 1 ; évènement trop près du bord → `{ raison: "fenetre-incomplete" }` ; évènement entre deux bougies (trou) → H0 = dernière ≤ eventTime. `agregerFenetres` : 3 fenêtres synthétiques → médiane/p25/p75 attendus point à point (réutiliser la convention `percentile` de SeasonalityWindow : interpolation linéaire). `statsEvts` : valeurs vérifiées à la main sur fixture.
- [ ] **Step 2: Implémentation.** Tests verts.
- [ ] **Step 3:** `pnpm test` racine + tsc verts. **Step 4: Commit** — `feat(evts): alignement et agrégats purs des fenêtres d'évènements`

### Task 3: Fenêtre EVTS

**Files:**
- Create: `apps/web/src/components/EvtsWindow.tsx`
- Modify: `apps/web/src/store/windowManager.ts` (registre), `apps/web/src/App.tsx` (`WINDOW_COMPONENTS`), `apps/web/src/commands/windowPanels.ts` (commande `basculer("evts")`)

**Interfaces (Consumes):** Task 1 `chargerDatesEvenement`, Task 2 `alignerFenetre/agregerFenetres/statsEvts`.

- [ ] **Step 1: Enregistrement** — `WINDOW_REGISTRY` : `{ id: "evts", title: "Étude d'évènements", mnemonic: "EVTS", defaultWidth: 760, defaultHeight: 560, nouveau: true }` ; lazy dans `WINDOW_COMPONENTS` ; bloc windowPanels (libellés FR, alias « event study »). Menu Fonctions/persistance/Taskbar : automatiques.
- [ ] **Step 2: Composant** — patron SeasonalityWindow : store UI co-localisé + `mirrorOpenState("evts", ...)` ; contrôles `Segmente` : type (CPI/NFP/FOMC), TF (1h/1d), demi-fenêtre (±12/±24/±48 barres), N derniers (6/12/24) ; symbole = groupe ?? global. Fetch : dates via Task 1 (slice N derniers ÉVÈNEMENTS PASSÉS), puis **un fetchKlines fenêtré PAR évènement** : `getAdapter(exchange).fetchKlines(symbol, tf, { limit: 2*N+10, endTime: eventTime + (demiFenetre+2)*tfMs })` (pas de pagination massive façon Seasonality — 12 fetchs de ~100 bougies), `AbortController`, échec par évènement → `OccurrenceExclue "fetch-echec"`.
- [ ] **Step 3: Rendu canvas** (DPR-aware, patron drawBuckets) — spaghetti des fenêtres en `--text-dim` fin, médiane épaisse `--serie-1`, bande p25–p75 translucide, axe x en offsets (−N…+N, ligne verticale à 0), base 100. Sous le canvas : stats (perf méd. pré/post, vol post, min/max) + liste des occurrences (date locale, ✔ ou raison d'exclusion) + `NoteSource` (FRED/statique + « heure approx. DST »). États `Chargement/ErreurBloc/Vide`.
- [ ] **Step 4:** `pnpm test` racine + tsc verts (le composant n'a pas de test DOM ; toute logique non triviale qui émerge → la déplacer dans `lib/evts.ts` testée).
- [ ] **Step 5: Commit** — `feat(evts): fenêtre étude d'évènements (CPI/NFP/FOMC, spaghetti + médiane + stats)`

### Task 4: Marqueur enrichi + gate visuel

**Files:**
- Modify: `apps/web/src/chart/ecoMarkers.ts` (label), `apps/web/src/components/EvtsWindow.tsx` (expose les stats)

**Interfaces:** le store UI d'EvtsWindow expose `statsParType: Partial<Record<TypeEvenement, string>>` (ex. `{ cpi: "méd +24 h : −0,8 %" }`), mis à jour après chaque calcul réussi.

- [ ] **Step 1:** Dans `ecoMarkers.ts` : mapping titre ECO → `TypeEvenement` (helper pur exporté `typeEvenementDe(title): TypeEvenement | null`, matching insensible : « CPI »/« Consumer Price », « Non-Farm »/« NFP »/« Employment Situation », « FOMC ») ; si stats dispo pour ce type, suffixer le label (allonger `tronquer` à 34 pour les marqueurs suffixés). S'abonner au store EVTS dans `demarrerEcoMarkers` (rejeu si `statsParType` change). Test : `typeEvenementDe` (cas positifs/négatifs) dans `ecoMarkers.test.ts` (créer, patron tests purs).
- [ ] **Step 2:** `pnpm test` racine + tsc verts.
- [ ] **Step 3: Gate visuel (contrôleur)** — EVTS sur BTCUSDT : CPI 1h ±24 → spaghetti cohérent, médiane lisible, occurrences listées avec dates plausibles (2e semaine du mois) ; FOMC 1d → fenêtres alignées ; couper le réseau → cache puis dégradation propre ; marqueur ECO du prochain CPI suffixé par la stat.
- [ ] **Step 4: Commit** — `feat(evts): marqueur ECO enrichi des stats d'étude d'évènements`
