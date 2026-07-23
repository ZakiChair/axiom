# COT Disaggregated / TFF — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catégories de positionnement fin dans la fenêtre COT — Managed Money / Producer (Disaggregated, matières premières) et Leveraged Funds / Asset Manager (TFF, financiers) — spec `2026-07-23-netliq-mcbt-cot-disagg-design.md` §3.

**Architecture:** Routage PAR FAMILLE d'instrument (metal/energie → Disaggregated ; fx/indice/crypto → TFF), fetch lazy par dataset avec cache v2 étendu, vue COT existante réutilisée telle quelle (seule la série nette change).

**Tech Stack:** TypeScript, Socrata (publicreporting.cftc.gov), vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique.
- ⚠️ INTERDIT d'inventer les ids de dataset Socrata et les noms de champs : la Task 1 les VÉRIFIE live (requêtes d'exploration) et les consigne. Les `market_and_exchange_names` peuvent différer du legacy PAR dataset — vérifier chaque instrument de `WATCHLIST_COT` dans son dataset cible.
- Ne JAMAIS mélanger des catégories de datasets différents dans une même barre/ligne. Instrument non couvert par le dataset de sa catégorie (ex. crypto absent du Disaggregated — attendu) → ligne masquée + note discrète « non couvert ».
- Fetch lazy : le dataset d'une catégorie n'est fetché qu'à la première ouverture de cette catégorie. Cache `axiom:cot:cache:v2:<dataset>`, TTL 12 h, même dégradation que l'existant (cache périmé affiché avec bandeau si fetch échoue).
- Le COT Index (min-max 3 ans) et les stats se recalculent sur la série de la catégorie AFFICHÉE — réutiliser `cotIndex`/`resumerCot` existants sans les modifier si possible.
- Branche : `feat/cot-disaggregated`. TDD sur parseurs/routage purs. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/data/cot.ts` (TOUT : `CotCategorie` :29 — les 5 familles existent déjà —, `InstrumentCot`, `pointCot` :160, `resumerCot` :185, `cotIndex` :235, `construireRequete` :295, dataset legacy et champs actuels)
- `apps/web/src/store/cot.ts` (cache v1/v2, TTL, dégradation) et `components/CotWindow.tsx` (vue badge/sparkline/barre, `Segmente` existants du repo pour le patron)

---

### Task 1: Vérification live Socrata + table de routage

**Files:**
- Modify: `apps/web/src/data/cot.ts` (constantes datasets + routage)
- Test: `apps/web/src/data/cot.test.ts` (extension)

**Interfaces (Produces — consommé par Tasks 2-3):**
```ts
export type CategoriePositionnement = "legacy" | "fonds" | "commerciaux";
export type DatasetCot = "legacy" | "disaggregated" | "tff";
export function datasetPour(famille: CotCategorie, categorie: CategoriePositionnement): DatasetCot | null;
// legacy → "legacy" pour toutes les familles ; fonds/commerciaux → metal|energie → "disaggregated",
// fx|indice|crypto → "tff" ; null jamais (exhaustif) — la non-couverture se constate au fetch (instrument absent).
export const DATASETS_COT: Record<DatasetCot, { id: string; champs: { net1: [string, string]; net2: [string, string] } }>;
// id Socrata VÉRIFIÉ live + paires (long,short) par catégorie : disaggregated net1=Managed Money, net2=Producer/Merchant ;
// tff net1=Leveraged Funds, net2=Asset Manager ; legacy = champs actuels.
```

- [ ] **Step 1: Explorer live** (curl) : trouver les ids des datasets Disaggregated (futures only) et TFF sur publicreporting.cftc.gov ; requête `$select=distinct market_and_exchange_names` filtrée sur les instruments de `WATCHLIST_COT` ; noms de champs long/short des 4 catégories. CONSIGNER requêtes + réponses dans le rapport (preuves).
- [ ] **Step 2: Tests rouges puis verts** — routage exhaustif (10 combinaisons famille×catégorie), structure DATASETS_COT (ids non vides, champs distincts).
- [ ] **Step 3: Commit** — `feat(cot): table de routage Disaggregated/TFF par famille (ids Socrata vérifiés live)`

### Task 2: Fetch + parse par dataset

**Files:**
- Modify: `apps/web/src/data/cot.ts` (généraliser `construireRequete`/`pointCot` par dataset), Test: extension

**Interfaces (Produces):**
```ts
export function construireRequeteDataset(dataset: DatasetCot, watchlist: readonly InstrumentCot[], nowMs: number): string;
// même fenêtre 3 ans/$where que le legacy, champs du dataset ; instruments restreints aux familles routées vers ce dataset.
export function pointCotDataset(dataset: DatasetCot, categorie: CategoriePositionnement, rec: unknown): PointBrutCot | null;
// net = long − short de la paire de champs de la catégorie ; réutilise nombreCot ; null si champs absents.
```

- [ ] **Step 1: Tests rouges** — URL exacte par dataset (fixture nowMs injecté), parse de records fixtures (champs disaggregated/tff réels de la Task 1, valeurs commentées), champs manquants → null, legacy inchangé octet pour octet (non-régression).
- [ ] **Step 2-4: Rouge → implémentation → vert** — `pnpm --filter @axiom/web test -- cot`
- [ ] **Step 5: Commit** — `feat(cot): requête et parse génériques par dataset (MM/Prod, Lev/AM)`

### Task 3: Store — fetch lazy par dataset + cache v2

**Files:**
- Modify: `apps/web/src/store/cot.ts`

**Interfaces (Produces):** état `categorie: CategoriePositionnement` (défaut `"legacy"`), `setCategorie` (déclenche le fetch lazy du/des datasets requis si cache absent/périmé), données par dataset (`axiom:cot:cache:v2:<dataset>` ; la clé actuelle devient le dataset legacy — migration douce : ancien cache lu comme legacy ou invalidé, consigner le choix), sélecteur qui sert à la fenêtre les lignes de la catégorie courante (instruments non couverts par leur dataset → marqués `nonCouvert`).

- [ ] **Step 1:** Implémenter (logique de sélection/fusion extraite pure et testée : pour `fonds`, les lignes metal/energie viennent du Disaggregated ET fx/indice/crypto du TFF — deux fetches, jamais mélangés dans une même ligne).
- [ ] **Step 2:** Suite web verte. **Step 3: Commit** — `feat(cot): catégories de positionnement (fetch lazy par dataset, cache v2)`

### Task 4: UI Segmente + gate

**Files:**
- Modify: `apps/web/src/components/CotWindow.tsx`

- [ ] **Step 1:** `Segmente` en tête : `Spéculatif | Fonds | Commerciaux` (title natifs : « Non-commercial (legacy) », « Managed Money / Leveraged Funds », « Producer / Asset Manager ») ; vue badge/sparkline/barre INCHANGÉE, alimentée par la série de la catégorie ; lignes non couvertes masquées avec note « non couvert par ce rapport » ; NoteSource mentionne le dataset affiché.
- [ ] **Step 2:** `pnpm test` racine + tsc verts. **Step 3: Commit** — `feat(cot): sélecteur de catégorie de positionnement (Spéculatif/Fonds/Commerciaux)`

Gate visuel (contrôleur) : bascule des 3 catégories sur or (metal → Disaggregated) et BTC (crypto → TFF, masqué en Commerciaux si non couvert — vérifier), COT Index recalculé par catégorie, réseau : 1 fetch par dataset à la première ouverture seulement, legacy inchangé.
