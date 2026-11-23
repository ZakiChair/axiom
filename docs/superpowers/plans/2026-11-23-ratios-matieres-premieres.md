# Ratios ÷ matières premières et ÷ autre actif — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter 13 dénominateurs matières premières (ETF Twelve Data) au menu ÷ du bandeau, groupés avec l'Or, puis une entrée « Autre actif… » qui divise le marché affiché par n'importe quel actif du catalogue.

**Architecture :** le calcul reste dans le moteur SYN existant (`data/synthetic.ts`, intouché). `data/ratio.ts` (pur) décide quels symboles SYN poser et reconnaître. `SymbolBanner.tsx` affiche le menu. Le sélecteur « Autre actif… » est un composant chargé à la demande, appuyé sur la recherche commune (`searchMarkets`).

**Tech Stack :** TypeScript, React 18, Zustand vanilla, Vitest (environnement node, sans DOM), Playwright (Chromium), pnpm 9.

**Spec :** `docs/superpowers/specs/2026-11-22-ratios-matieres-premieres-design.md`

## Global Constraints

- Français partout : nouveaux identifiants, libellés, commentaires, messages de commit (verbe à l'infinitif). Chaque commit finit par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Jamais de push.
- Rien de nouveau côté fournisseur, hôte, proxy, dépendance ou champ de `@axiom/types`. `EXCHANGE_IDS`, `data/synthetic.ts`, `data/heuresMarche.ts` et `data/twelvedata.ts` ne changent pas.
- Ids persistés, figés : `OR`, `ARGENT`, `PLATINE`, `PALLADIUM`, `CUIVRE`, `PETROLE`, `BRENT`, `GAZ`, `BLE`, `MAIS`, `SOJA`, `SUCRE`, `AGRICULTURE`, `PANIER` (en plus des existants).
- Libellés exacts : `÷Or`, `÷Argent (SLV)`, `÷Platine (PPLT)`, `÷Palladium (PALL)`, `÷Cuivre (CPER)`, `÷Pétrole WTI (USO)`, `÷Brent (BNO)`, `÷Gaz naturel (UNG)`, `÷Blé (WEAT)`, `÷Maïs (CORN)`, `÷Soja (SOYB)`, `÷Sucre (CANE)`, `÷Agriculture (DBA)`, `÷Matières premières (DBC)`.
- Groupes du menu, dans l'ordre : Crypto · Indices · Matières premières · Devises.
- Vitest n'a pas de DOM. La logique se teste en fonctions pures exportées ; l'interface se prouve en Playwright.
- Le cliquet `src/components/uiConventions.test.ts` reste vert. Un champ de saisie utilise `CLASSES_CHAMP` ou `<Input>`, jamais `bg-neutral-###`. Pas de `<table`, ni du mot `Metric`, même en commentaire.
- Budget : au plus **+1 200 octets gzip** sur le chargement initial pour les deux lots réunis, contre la base 1 184 044 / 354 567 (Node 26.7.0). Au-delà, arrêter et le signaler.
- Commandes, depuis la racine du worktree :
  - tests unitaires : `pnpm --filter @axiom/web exec vitest run <fichiers>` ;
  - typage : `pnpm --filter @axiom/web typecheck` ;
  - e2e : `AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test <fichiers>` ;
  - e2e téléphone : `AXIOM_E2E_PORT=5281 pnpm --filter @axiom/web exec playwright test --config=playwright.mobile.config.ts <fichiers>`.

## Review Focus

1. Session restaurée avec une préférence `OR` ou `SP500` d'avant le regroupement : elle s'hydrate et le bouton scindé garde « ÷Or » ou « ÷S&P 500 (SPY) ». Couvert par `persist.test.ts:484` (Tâche 1 l'étend).
2. Feuille du menu au téléphone, environ 25 entrées : elle défile jusqu'à « Autre actif… », qui s'ouvre au toucher. Parcours téléphone, Tâche 5.
3. Diviseur Twelve Data refusé par l'offre, choisi dans « Autre actif… » : le graphe affiche le refus d'abonnement, sans ETF de remplacement. Parcours e2e avec `/tdapi` en 404, Tâche 5.
4. Retour depuis un ratio libre dont la jambe A est un ticker Twelve Data ou une capitalisation (`mcap`) : retour sur la bonne source (`twelvedata`, `synthetic`). Test de `baseDuRatio`, Tâche 4.
5. Marché changé pendant que le sélecteur est ouvert : le sélecteur se ferme, et aucun ratio n'est posé depuis l'ancien marché. Parcours e2e, Tâche 5.

---

## Lot 1 — matières premières

### Task 1 : Dénominateurs matières premières et menu groupé

**Files :**
- Modify : `apps/web/src/data/ratio.ts` (en-tête, familles :34-41, `REFS_TRADFI` :70-80, `symboleRatioTradfi` :117-137)
- Modify : `apps/web/src/components/SymbolBanner.tsx` (imports :29-39, commentaire :163-179, `groupes` :246-250, ids de groupe :299-300)
- Modify : `apps/web/src/store/denominateur.ts` (commentaire :4-6)
- Test : `apps/web/src/data/ratio.test.ts`, `apps/web/src/store/persist.test.ts:484`
- Test e2e : `apps/web/e2e/gate-v24-macro-denominateur.e2e.ts` (:172, :174, :208, plus un test)

**Interfaces :**
- Produces (`data/ratio.ts`) :
  - `DENOMINATEURS_INDICES = ["NASDAQ", "SP500"] as const`. Elle remplace `DENOMINATEURS_MARCHES`, qui est supprimée.
  - `DENOMINATEURS_MATIERES = ["OR", "ARGENT", "PLATINE", "PALLADIUM", "CUIVRE", "PETROLE", "BRENT", "GAZ", "BLE", "MAIS", "SOJA", "SUCRE", "AGRICULTURE", "PANIER"] as const`.
  - `DENOMINATEURS = [...DENOMINATEURS_CRYPTO, ...DENOMINATEURS_INDICES, ...DENOMINATEURS_MATIERES, ...DENOMINATEURS_DEVISES]`, d'où `DenominateurId`.
  - `REFS_TRADFI` garde la forme `{ sym; libelle; detail }`. `libelleDenominateur` et `detailDenominateur` gardent leur signature.

- [ ] **Step 1 : écrire les tests qui échouent.** Dans `ratio.test.ts`, nouveau `describe("matières premières (demande du 22/11/2026)")`, avec `const ETF = [["ARGENT","SLV"],["PLATINE","PPLT"],["PALLADIUM","PALL"],["CUIVRE","CPER"],["PETROLE","USO"],["BRENT","BNO"],["GAZ","UNG"],["BLE","WEAT"],["MAIS","CORN"],["SOJA","SOYB"],["SUCRE","CANE"],["AGRICULTURE","DBA"],["PANIER","DBC"]] as const` :

```ts
it("compose chaque matière première pour un actif en dollar, un ticker Twelve Data et TOTAL", () => {
  for (const [id, etf] of ETF) {
    expect(symboleRatio("BTCUSDT", "binance", id)).toBe(`binance:BTCUSDT|/|twelvedata:${etf}`);
    expect(symboleRatio("AAPL", "twelvedata", id)).toBe(`twelvedata:AAPL|/|twelvedata:${etf}`);
    expect(symboleRatio("TOTAL", "synthetic", id)).toBe(`mcap:TOTAL|/|twelvedata:${etf}`);
  }
});
it("refuse un actif hors dollar et l'ETF divisé par lui-même", () => {
  expect(symboleRatio("BTCEUR", "kraken", "CUIVRE")).toBeNull();
  expect(symboleRatio("CPER", "twelvedata", "CUIVRE")).toBeNull();
  expect(symboleRatio("USO", "twelvedata", "PETROLE")).toBeNull();
  expect(symboleRatio("GLD", "twelvedata", "OR")).toBe("twelvedata:GLD|/|twelvedata:XAU/USD");
});
it("la garde « base = dénominateur » ne vaut que pour les devises", () => {
  expect(symboleRatio("GAZUSDT", "binance", "GAZ")).toBe("binance:GAZUSDT|/|twelvedata:UNG");
  expect(symboleRatio("EURUSDT", "binance", "EUR")).toBeNull();
});
it("estRatio reconnaît chaque matière première et rend la jambe A", () => {
  for (const id of DENOMINATEURS_MATIERES) {
    const actif = estRatio(symboleRatio("BTCUSDT", "binance", id) as string, "synthetic");
    expect(actif?.denom).toBe(id);
    expect(actif?.spec.legA).toBe("BTCUSDT");
  }
});
it("libellés : l'ETF est toujours nommé ; infobulles : nature et spot refusé", () => {
  expect(DENOMINATEURS_MATIERES.map(libelleDenominateur)).toEqual(["÷Or", "÷Argent (SLV)", "÷Platine (PPLT)", "÷Palladium (PALL)", "÷Cuivre (CPER)", "÷Pétrole WTI (USO)", "÷Brent (BNO)", "÷Gaz naturel (UNG)", "÷Blé (WEAT)", "÷Maïs (CORN)", "÷Soja (SOYB)", "÷Sucre (CANE)", "÷Agriculture (DBA)", "÷Matières premières (DBC)"]);
  expect(detailDenominateur("CUIVRE")).toBe("le cuivre via l'ETF CPER (prix de la part, contrats à terme renouvelés : écart possible au cours sur plusieurs années) ; le spot HG1 exige une offre Twelve Data supérieure");
  expect(detailDenominateur("ARGENT")).toBe("l'argent via l'ETF SLV (prix de la part, adossé au métal) ; le spot XAG/USD exige une offre Twelve Data supérieure");
  expect(detailDenominateur("PALLADIUM")).not.toContain("spot");
  expect(detailDenominateur("AGRICULTURE")).toContain("café");
});
it("ordre des familles : crypto, indices, matières premières, devises", () => {
  expect(DENOMINATEURS).toEqual(["BTC", "ETH", "SOL", "NASDAQ", "SP500", "OR", "ARGENT", "PLATINE", "PALLADIUM", "CUIVRE", "PETROLE", "BRENT", "GAZ", "BLE", "MAIS", "SOJA", "SUCRE", "AGRICULTURE", "PANIER", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD"]);
});
```

Dans `persist.test.ts:484`, `it.each(["OR", "SP500", "CHF", "JPY", "CUIVRE", "PANIER"])`.

- [ ] **Step 2 : vérifier l'échec.** `pnpm --filter @axiom/web exec vitest run src/data/ratio.test.ts src/store/persist.test.ts`. Attendu : FAIL (`DENOMINATEURS_MATIERES` absent).

- [ ] **Step 3 : implémenter dans `data/ratio.ts`.**
  - Les familles, comme ci-dessus.
  - `estDevise(d)` = appartenance à `DENOMINATEURS_DEVISES`. Dans `symboleRatioTradfi`, les deux gardes `base === denom` (branche twelvedata) et `parts.base === denom` (branche crypto) ne s'appliquent que si `estDevise(denom)`.
  - Les 13 entrées ETF de `REFS_TRADFI` se génèrent depuis une table compacte `[id, ticker, nomLibellé, nomInfobulle, physique, spotRefusé?]` :

| id | ticker | nomLibellé | nomInfobulle | physique | spotRefusé |
|---|---|---|---|---|---|
| ARGENT | SLV | Argent | l'argent | oui | XAG/USD |
| PLATINE | PPLT | Platine | le platine | oui | XPT/USD |
| PALLADIUM | PALL | Palladium | le palladium | oui | — |
| CUIVRE | CPER | Cuivre | le cuivre | non | HG1 |
| PETROLE | USO | Pétrole WTI | le pétrole WTI | non | WTI/USD |
| BRENT | BNO | Brent | le Brent | non | XBR/USD |
| GAZ | UNG | Gaz naturel | le gaz naturel | non | — |
| BLE | WEAT | Blé | le blé | non | — |
| MAIS | CORN | Maïs | le maïs | non | — |
| SOJA | SOYB | Soja | le soja | non | — |
| SUCRE | CANE | Sucre | le sucre | non | — |
| AGRICULTURE | DBA | Agriculture | un panier agricole (dont café et cacao) | non | — |
| PANIER | DBC | Matières premières | un panier large (énergie, métaux, agriculture) | non | — |

  - Copie exacte :
    - libellé : `` `÷${nomLibellé} (${ticker})` `` ;
    - infobulle : `` `${nomInfobulle} via l'ETF ${ticker} (prix de la part, ${physique ? "adossé au métal" : "contrats à terme renouvelés : écart possible au cours sur plusieurs années"})${spot ? ` ; le spot ${spot} exige une offre Twelve Data supérieure` : ""}` ``.
  - `OR`, `NASDAQ`, `SP500` et les devises restent littéraux et inchangés.
  - Réécrire l'en-tête du module : quatre familles, demande du 22/11.

- [ ] **Step 4 : brancher le menu dans `SymbolBanner.tsx`.**
  - Importer `DENOMINATEURS_INDICES` et `DENOMINATEURS_MATIERES` à la place de `DENOMINATEURS_MARCHES`.
  - `groupes : Array<[titre: string, cle: string, liste: DenominateurId[]]>`, avec les entrées `["Crypto","crypto",…]`, `["Indices","indices",…]`, `["Matières premières","matieres",…]` et `["Devises","devises",…]`.
  - Utiliser `id={`ratio-groupe-${cle}`}` et le `aria-labelledby` assorti. Une espace dans un id casse `aria-labelledby`, qui lit deux ids.
  - Mettre à jour le commentaire de `BoutonsRatio` et celui de `store/denominateur.ts`.

- [ ] **Step 5 : vérifier.** `pnpm --filter @axiom/web exec vitest run src/data/ratio.test.ts src/store/persist.test.ts src/components/uiConventions.test.ts`, puis `pnpm --filter @axiom/web typecheck`. Attendu : tout PASS, typage OK.

- [ ] **Step 6 : mettre à jour l'e2e.** Dans `gate-v24-macro-denominateur.e2e.ts` :
  - groupe « Indices » pour `÷S&P 500 (SPY)` (:172) ;
  - groupe « Matières premières » pour `÷Or` (:174 et :208) ;
  - dans le test BTCEUR, ajouter `÷Cuivre (CPER)` désactivé.
  - Nouveau test, qui reprend le patron du test « BTCUSDT ÷Or puis en CHF » :

```ts
test("bandeau : BTCUSDT ÷Cuivre (CPER), jambe CPER demandée, ETF nommé dans le bandeau", async ({ page }) => {
  const demandes: string[] = [];
  await page.route("**/tdapi/time_series*", (route) => {
    demandes.push(new URL(route.request().url()).searchParams.get("symbol") ?? "");
    return route.fulfill({ json: SERIE_TD });
  });
  await page.route("**/tdapi/quote*", (route) => route.fulfill({ json: QUOTE_TD }));
  await page.goto("/");
  await page.getByRole("button", { name: "Choisir l'actif de comparaison" }).click();
  await page.getByRole("group", { name: "Matières premières" }).getByRole("menuitem", { name: "÷Cuivre (CPER)" }).click();
  await expect(page.getByText("BTCUSDT ÷Cuivre (CPER)", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => demandes).toContain("CPER");
  await expect(page.locator("[data-chart-status]")).toHaveCount(0);
});
```

- [ ] **Step 7 : lancer l'e2e.**
  - `AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test gate-v24-macro-denominateur` : tout PASS.
  - `AXIOM_E2E_PORT=5281 pnpm --filter @axiom/web exec playwright test --config=playwright.mobile.config.ts mobile.e2e.ts -g "ratios"` : PASS.

- [ ] **Step 8 : commit.** Message « Ajouter les dénominateurs matières premières au menu ÷ du bandeau ».

### Task 2 : Recherche des matières premières par leur nom, USOIL vers USO

**Files :**
- Modify : `apps/web/src/data/pairs.ts` (`TWELVEDATA_SYMBOLS` :141-160, `TRADFI_SEARCH_METADATA` :165-168)
- Test : `apps/web/src/data/marketRouting.test.ts` (bloc « recherche du pétrole » :514-538 et un nouveau bloc)
- Test e2e : `apps/web/e2e/sources-automatiques.e2e.ts` (les trois parcours USOIL, :364-424)

**Interfaces :**
- Produces : `TWELVEDATA_SYMBOLS` contient `"SOYB"`. Les métadonnées de recherche exactes :
  - `WTI/USD` : libellé « Pétrole WTI — spot (offre Twelve Data supérieure) », alias `PETROLE` ;
  - `USO` : « Pétrole WTI — ETF », alias `USOIL`, `PETROLE` ;
  - `BNO` : « Brent — ETF », alias `BRENT`, `UKOIL` ;
  - `SLV` : « Argent — ETF », alias `ARGENT`, `SILVER` ;
  - `PPLT` : « Platine — ETF », alias `PLATINE` ;
  - `PALL` : « Palladium — ETF », alias `PALLADIUM` ;
  - `CPER` : « Cuivre — ETF », alias `CUIVRE`, `COPPER` ;
  - `UNG` : « Gaz naturel — ETF », alias `GAZ`, `NATGAS` ;
  - `WEAT` : « Blé — ETF », alias `BLE`, `WHEAT` ;
  - `CORN` : « Maïs — ETF », alias `MAIS` ;
  - `SOYB` : « Soja — ETF », alias `SOJA` ;
  - `CANE` : « Sucre — ETF », alias `SUCRE`, `SUGAR` ;
  - `DBA` : « Agriculture (panier) — ETF », alias `AGRICULTURE` ;
  - `DBC` : « Matières premières (panier) — ETF », alias `MATIERES`.
  - `WTI` (l'action W&T Offshore) ne change pas.

- [ ] **Step 1 : écrire les tests qui échouent.**
  - Dans le bloc « recherche du pétrole », remplacer le premier `it` par deux tests (catalogue `oil` inchangé) :

```ts
it("USOIL propose l'ETF USO servi par l'offre, nommé ETF, avant le symbole crypto ressemblant", () => {
  const results = searchMarkets(oil, "USOIL");
  expect(results[0]).toMatchObject({ symbol: "USO", exchange: "twelvedata", label: "Pétrole WTI — ETF" });
  expect(results.some((r) => r.symbol === "WTI/USD")).toBe(false);
  expect(results.findIndex((r) => r.symbol === "USOILUSDT")).toBeGreaterThan(0);
});
it("PETROLE propose l'ETF et le spot, chacun nommé", () => {
  const results = searchMarkets(oil, "PETROLE");
  expect(results.map((r) => r.symbol)).toEqual(expect.arrayContaining(["USO", "WTI/USD"]));
  expect(results.find((r) => r.symbol === "WTI/USD")?.label).toBe("Pétrole WTI — spot (offre Twelve Data supérieure)");
});
```

  - Nouveau bloc `describe("matières premières par leur nom (demande du 22/11/2026)")`, avec `const tradfi: MarketCatalog = { unavailableSources: [], instruments: TWELVEDATA_SYMBOLS.map((symbol) => ({ exchange: "twelvedata", symbol, kind: "tradfi" })) }` :
    - `it.each([["CUIVRE","CPER"],["SUCRE","CANE"],["ARGENT","SLV"],["PLATINE","PPLT"],["PALLADIUM","PALL"],["BRENT","BNO"],["GAZ","UNG"],["BLE","WEAT"],["MAIS","CORN"],["SOJA","SOYB"],["AGRICULTURE","DBA"],["MATIERES","DBC"]])("%s propose %s en tête, nommé ETF")` ;
    - chacun vérifie `searchMarkets(tradfi, q)[0]` : `{ symbol: etf }` et un `label` contenant « ETF ».

- [ ] **Step 2 : vérifier l'échec.** `pnpm --filter @axiom/web exec vitest run src/data/marketRouting.test.ts`. Attendu : FAIL.

- [ ] **Step 3 : implémenter dans `pairs.ts`.** Les données de l'Interface, rien d'autre. Ajouter `"SOYB"` avec le commentaire « soja→SOYB ».

- [ ] **Step 4 : vérifier.** `pnpm --filter @axiom/web exec vitest run src/data/marketRouting.test.ts src/commands/registry.test.ts src/components/PairSearch.test.ts`. Attendu : PASS. La navigation brute `USOIL` de `registry.test.ts` ne change pas.

- [ ] **Step 5 : réécrire les trois parcours USOIL de `sources-automatiques.e2e.ts`.** Leur intention est conservée.
  - **:364**, renommé « USOIL : la suggestion ouvre l'ETF USO servi, sans confusion avec crypto, action ou spot ». Le premier résultat de « usoil » contient « USO », « Pétrole WTI — ETF » et « Twelve Data ». Entrée donne `{ symbol: "USO", exchange: "twelvedata", status: "ready" }`. La boucle parcourt `["WTI/USD", "WTI", "AAPL", "SPY", "EUR/USD"]`.
  - **:387**, renommé « WTI/USD : un abonnement Grow requis reste visible et ne déclenche aucun ETF de remplacement ». Saisie `WTI/USD`. Les assertions ne changent pas (erreur, `/abonnement.*Grow/i`, `WTI/USD` demandé, `USO` jamais demandé).
  - **:405**. Saisie `USOIL`, option `/^USO\b/` visible, Entrée donne USO `ready`, puis `choisir(page, "SPY")`.

- [ ] **Step 6 : lancer l'e2e.** `AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test sources-automatiques`. Attendu : PASS.

- [ ] **Step 7 : commit.** Message « Trouver les matières premières par leur nom et USOIL par l'ETF USO ».

**Checkpoint lot 1 (orchestrateur) :**
- `pnpm check` vert ;
- mesure du budget (avant / après) ;
- revue indépendante du lot 1.

---

## Lot 2 — « Autre actif… »

### Task 3 : Composition libre pure

**Files :**
- Modify : `apps/web/src/data/ratio.ts` (ajouts après `symboleRatio`)
- Test : `apps/web/src/data/ratio.test.ts`

**Interfaces :**
- Produces (`data/ratio.ts`) :

```ts
export interface JambeChoisie { exchange: ExchangeId; symbol: string }
export type ResultatRatioLibre = { symbole: string; denom: DenominateurId | null } | { refus: string };
/** Devise du prix, stablecoins USD comptés « USD » ; null si inconnue. PURE. */
export function deviseCotation(symbol: string, exchange: ExchangeId): string | null;
/** Dénominateur fixe dont `jambe` est la référence sur sa place, sinon null. PURE. */
export function referenceFixe(jambe: JambeChoisie): DenominateurId | null;
/** Règles 2 à 4 de la spec (§5.2) seules : jambe B, A ÷ A, devise. PURE. */
export function composerRatioLibre(baseSym: string, baseEx: ExchangeId, jambe: JambeChoisie): ResultatRatioLibre;
/** Règle 1 (fixe par référence), sinon `composerRatioLibre`. PURE. */
export function symboleRatioLibre(baseSym: string, baseEx: ExchangeId, jambe: JambeChoisie): ResultatRatioLibre;
```

- **`deviseCotation`** :
  - `synthetic` : `"USD"` si `estCapitalisationUsd`, sinon null ;
  - `twelvedata` :
    - null si le symbole contient « : » ;
    - avec « / » : la partie droite, ramenée à `"USD"` si elle appartient à `COTATIONS_USD` ;
    - sinon `"USD"` ;
  - `hyperliquid` : `"USD"` si `basePerp` est non nul, sinon null ;
  - autres places :
    - null si le symbole contient « / » (format non normalisé, ex. `binance:XAU/USD`) ;
    - sinon la cotation de `decouper`, ramenée à `"USD"` si elle appartient à `COTATIONS_USD` ; null si le symbole n'est pas découpable.
- **`referenceFixe`** :
  - `twelvedata` : l'id dont `REFS_TRADFI[id].sym === symbol` ;
  - sinon : l'id crypto dont `REFS[id][exchange] === symbol`.
- **`composerRatioLibre`**, dans l'ordre, avec la copie exacte des refus :
  1. Jambe B :
     - `synthetic` sans capitalisation USD donne `{ refus: "Série en % ou déjà composée : pas un diviseur" }` ;
     - `synthetic` en capitalisation USD devient la jambe `mcap`.
  2. Base :
     - `synthetic` sans capitalisation USD donne `{ refus: "Graphique composé : revenez à un actif simple" }` ;
     - `synthetic` en capitalisation USD devient la jambe A `mcap`.
  3. Même `exchange` et même `symbol` : `{ refus: "Même actif que le graphique" }`.
  4. Devise nulle d'un côté : `{ refus: "Devise de cotation inconnue" }`.
  5. Devises différentes : `` { refus: `Devises différentes (${a} contre ${b})` } ``.
  6. Sinon : `{ symbole: encodeSyntheticSymbol(…, op "/"), denom: null }`.
- **`symboleRatioLibre`** :
  - `d = referenceFixe(jambe)` ;
  - si `d` est non nul et que `symboleRatio(baseSym, baseEx, d)` est non nul : `{ symbole: ce ratio fixe, denom: d }` ;
  - sinon : `composerRatioLibre(…)`.

- [ ] **Step 1 : écrire les tests qui échouent.** Nouveau `describe("« Autre actif… » : composition libre (lot 2)")`. Chaque ligne est un `expect(...).toEqual(...)` :

```ts
// deviseCotation
[["BTCUSDT","binance","USD"],["BTCEUR","kraken","EUR"],["ETHBTC","binance","BTC"],["HYPE-PERP","hyperliquid","USD"],
 ["SPY","twelvedata","USD"],["USD/JPY","twelvedata","JPY"],["XAU/USD","twelvedata","USD"],["RY:TSX","twelvedata",null],
 ["TOTAL","synthetic","USD"],["STABLE.D","synthetic",null],["XYZ","binance",null],["XAU/USD","binance",null]]
// fixe d'abord, par référence, sur la place du numérateur
symboleRatioLibre("BTCUSDT","binance",{exchange:"binance",symbol:"ETHUSDT"})   → { symbole: "binance:BTCUSDT|/|binance:ETHUSDT", denom: "ETH" }
symboleRatioLibre("HYPEUSDT","bybit",{exchange:"binance",symbol:"ETHUSDT"})    → { symbole: "bybit:HYPEUSDT|/|bybit:ETHUSDT", denom: "ETH" }
symboleRatioLibre("SOLUSD","kraken",{exchange:"binance",symbol:"ETHUSDT"})     → { symbole: "kraken:SOLUSD|/|kraken:ETHUSD", denom: "ETH" }
symboleRatioLibre("BTCUSDT","binance",{exchange:"twelvedata",symbol:"CPER"})   → { symbole: "binance:BTCUSDT|/|twelvedata:CPER", denom: "CUIVRE" }
symboleRatioLibre("BTCUSDT","binance",{exchange:"twelvedata",symbol:"SPY"})    → { symbole: "binance:BTCUSDT|/|twelvedata:SPY", denom: "SP500" }
symboleRatioLibre("ETHBTC","binance",{exchange:"binance",symbol:"SOLUSDT"})    → { symbole: "binance:ETHBTC|/|binance:SOLUSDT", denom: "SOL" }
// libres
symboleRatioLibre("BTCUSD","coinbase",{exchange:"binance",symbol:"BTCUSDT"})   → { symbole: "coinbase:BTCUSD|/|binance:BTCUSDT", denom: null }
symboleRatioLibre("ETHBTC","binance",{exchange:"binance",symbol:"ADABTC"})     → { symbole: "binance:ETHBTC|/|binance:ADABTC", denom: null }
symboleRatioLibre("BTCUSDT","binance",{exchange:"twelvedata",symbol:"AAPL"})   → { symbole: "binance:BTCUSDT|/|twelvedata:AAPL", denom: null }
symboleRatioLibre("TOTAL","synthetic",{exchange:"twelvedata",symbol:"AAPL"})   → { symbole: "mcap:TOTAL|/|twelvedata:AAPL", denom: null }
symboleRatioLibre("BTCUSDT","binance",{exchange:"synthetic",symbol:"TOTAL2"})  → { symbole: "binance:BTCUSDT|/|mcap:TOTAL2", denom: null }
// refus
symboleRatioLibre("ETHUSDT","binance",{exchange:"binance",symbol:"ETHUSDT"})   → { refus: "Même actif que le graphique" }
symboleRatioLibre("BTCUSDT","binance",{exchange:"twelvedata",symbol:"USD/JPY"})→ { refus: "Devises différentes (USD contre JPY)" }
symboleRatioLibre("BTCEUR","kraken",{exchange:"twelvedata",symbol:"CPER"})     → { refus: "Devises différentes (EUR contre USD)" }
symboleRatioLibre("BTCUSDT","binance",{exchange:"twelvedata",symbol:"RY:TSX"}) → { refus: "Devise de cotation inconnue" }
symboleRatioLibre("BTCUSDT","binance",{exchange:"synthetic",symbol:"STABLE.D"})→ { refus: "Série en % ou déjà composée : pas un diviseur" }
symboleRatioLibre("binance:ETHUSDT|-|binance:BTCUSDT","synthetic",{exchange:"twelvedata",symbol:"AAPL"}) → { refus: "Graphique composé : revenez à un actif simple" }
```

- [ ] **Step 2 : vérifier l'échec.** `pnpm --filter @axiom/web exec vitest run src/data/ratio.test.ts`. Attendu : FAIL (exports absents).
- [ ] **Step 3 : implémenter** les quatre fonctions dans `data/ratio.ts`, selon l'Interface.
- [ ] **Step 4 : vérifier.** Même commande. Attendu : PASS. Puis `pnpm --filter @axiom/web typecheck` OK.
- [ ] **Step 5 : commit.** Message « Composer un ratio libre : référence fixe d'abord, même devise, jamais A ÷ A ».

### Task 4 : Reconnaissance resserrée et ratio libre au bandeau

**Files :**
- Modify : `apps/web/src/data/ratio.ts` (`RatioActif` :204-207, `estRatio` :217-236, ajouts)
- Modify : `apps/web/src/components/SymbolBanner.tsx` (`BoutonsRatio` :180-335, libellé du bandeau :342-347)
- Test : `apps/web/src/data/ratio.test.ts` (:117, :130-146, :246, plus des ajouts)
- Test e2e : `apps/web/e2e/gate-v24-macro-denominateur.e2e.ts` (un test)

**Interfaces :**
- Consumes : `composerRatioLibre`, `JambeChoisie` (Tâche 3).
- Produces (`data/ratio.ts`) :

```ts
export interface RatioActif { spec: SyntheticSpec; denom: DenominateurId | null } // null = ratio libre
export function estRatio(symbol: string, exchange: ExchangeId): RatioActif | null;
/** Base de composition : jambe A du ratio (`mcap` redevient `synthetic`), sinon le marché. PURE. */
export function baseDuRatio(actif: RatioActif | null, symbol: string, exchange: ExchangeId): { symbol: string; exchange: ExchangeId };
/** « BTCUSDT ÷Cuivre (CPER) », « BTCUSDT en CHF » (fixe Twelve Data), « BTCUSD ÷ BTCUSDT » (libre) ; null pour un fixe crypto (libellé SYN « A / B » conservé). PURE. */
export function libelleBandeauRatio(actif: RatioActif): string | null;
```

- **`estRatio`**, nouvelle règle :
  - hors `synthetic`, symbole non parsé ou `op` différent de « / » : null ;
  - `exA` est la source de la jambe A, avec `mcap` lu `synthetic` ;
  - **fixe** : premier `d` de `DENOMINATEURS` tel que `symboleRatio(legA, exA, d) === symbol` ;
  - sinon **libre** : `composerRatioLibre(legA, exA, { exchange: exB, symbol: legB })`, avec `mcap` lu `synthetic`. Le ratio est reconnu avec `denom: null` si le résultat a un `symbole` égal à `symbol`.
  - Une jambe B `mcap` n'est plus exclue d'office.

- [ ] **Step 1 : réécrire et ajouter les tests (échec attendu).**
  - `:117` devient `expect(estRatio("kraken:SOLUSD|/|binance:ETHUSDT", "synthetic")).toMatchObject({ denom: null, spec: { legA: "SOLUSD" } })`, avec un commentaire : ÷ETH sur Kraken pose `kraken:ETHUSD`.
  - `:130-146`, les deux `it` « refuse un exB cross-source… » et « refuse un legB étranger… », sont renommés « … est un ratio libre, jamais un dénominateur fixe ». Chaque symbole y donne `toMatchObject({ denom: null })`. Exception : `binance:SOLUSDT|/|binance:ETHUSD` donne aussi `denom: null`, et non `ETH`.
  - `:246` devient `expect(estRatio("binance:BTCUSDT|/|twelvedata:GLD", "synthetic")).toMatchObject({ denom: null })`. `:248` (`binance:XAU/USD`) reste `toBeNull()`.
  - Nouveaux tests :
    - les préréglages `binance:BTCUSDT|/|twelvedata:GLD` et `binance:BTCUSDT|/|twelvedata:UUP` sont libres ;
    - un spread n'est jamais reconnu ;
    - `binance:BTCUSDT|/|mcap:TOTAL2` est libre ;
    - `binance:ETHBTC|/|twelvedata:EUR/USD` reste null.
  - `baseDuRatio` :
    - `(estRatio("mcap:TOTAL3|/|twelvedata:AAPL", "synthetic"), …)` donne `{ symbol: "TOTAL3", exchange: "synthetic" }` ;
    - `(estRatio("twelvedata:GLD|/|binance:BNBUSDT", "synthetic"), …)` donne `{ symbol: "GLD", exchange: "twelvedata" }` ;
    - `(null, "BTCUSDT", "binance")` rend le marché tel quel.
  - `libelleBandeauRatio` :
    - pour `binance:BTCUSDT|/|twelvedata:CPER` : `"BTCUSDT ÷Cuivre (CPER)"` ;
    - pour `coinbase:BTCUSD|/|binance:BTCUSDT` : `"BTCUSD ÷ BTCUSDT"` ;
    - pour `binance:ETHUSDT|/|binance:BTCUSDT` : `null`.
  - Les tests d'aller-retour sur tous les `DENOMINATEURS` (BNBUSDT, GLD) restent inchangés et verts.
- [ ] **Step 2 : vérifier l'échec.** `pnpm --filter @axiom/web exec vitest run src/data/ratio.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : implémenter** `estRatio`, `baseDuRatio` et `libelleBandeauRatio`.
- [ ] **Step 4 : adapter `SymbolBanner.tsx`.**
  - La base se calcule par `baseDuRatio`.
  - Avec un ratio libre actif, le bouton scindé affiche `` `÷${actif.spec.legB}` `` avec `aria-pressed="true"` et le titre `` `Revenir à ${legA}` ``. Un clic revient à la base, unité de temps inchangée. Le menu ▾ reste disponible et compose depuis la base.
  - La puce du menu vaut `actif === null ? choisi : actif.denom`.
  - Le bloc scindé s'affiche si `denomScinde !== undefined` ou si un ratio libre est actif.
  - Le libellé du bandeau vaut `libelleBandeauRatio(actif) ?? formatSyntheticLabel(spec)` pour tout ratio reconnu, sinon le symbole.
- [ ] **Step 5 : vérifier.** `pnpm --filter @axiom/web exec vitest run src/data/ratio.test.ts src/components/uiConventions.test.ts`, puis `pnpm --filter @axiom/web typecheck`. Attendu : PASS, typage OK.
- [ ] **Step 6 : e2e.** Nouveau test dans `gate-v24-macro-denominateur.e2e.ts` :
  - `bouchonnerTwelveData(page)` ;
  - `addInitScript` qui pose `axiom:chartState:v1` = `{ exchange: "synthetic", symbol: "binance:BTCUSDT|/|twelvedata:GLD", timeframe: "1d" }` ;
  - « BTCUSDT ÷ GLD » visible ; bouton `÷GLD` (exact) avec `aria-pressed="true"` ;
  - clic : « BTCUSDT ÷ GLD » disparaît et « BTCUSDT » est visible.

  Puis lancer `AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test gate-v24-macro-denominateur`. Attendu : tout PASS.
- [ ] **Step 7 : commit.** Message « Reconnaître un ratio libre et resserrer les dénominateurs fixes à la recomposition exacte ».

### Task 5 : Sélecteur « Autre actif… »

**Files :**
- Create : `apps/web/src/data/choixDiviseur.ts` (pur, hors chemin initial)
- Create : `apps/web/src/data/choixDiviseur.test.ts`
- Create : `apps/web/src/components/ChoixDiviseur.tsx` (chargé à la demande)
- Modify : `apps/web/src/components/SymbolBanner.tsx` (entrée de menu, montage `lazy`, fermeture au changement de marché, retour du focus)
- Test e2e : `apps/web/e2e/gate-v24-macro-denominateur.e2e.ts`, `apps/web/e2e/mobile.e2e.ts`

**Interfaces :**
- Consumes :
  - `symboleRatioLibre`, `ResultatRatioLibre`, `JambeChoisie` (Tâche 3) ; `baseDuRatio` (Tâche 4) ;
  - `searchMarkets`, `fetchMarketCatalog`, `subscribeMarketCatalog`, `resolveMarketCandidates`, `MarketCandidate`, `MarketCatalog` (`data/marketRouting`) ;
  - `CATALOGUE_LOCAL`, `catalogueInterroge`, `libelleSource` (`components/PairSearch`) ;
  - `supportedTimeframesFor`, `timeframeProche` (`data/adapters`) ;
  - `syntheticsStore` et `marketStore` ;
  - `PortailMobile`, `EnteteMenuMobile`, `classesPanneauMenu` et `CLASSES_CHAMP` (`components/ui`).
- Produces :

```ts
// data/choixDiviseur.ts
export interface OptionDiviseur { candidat: MarketCandidate; resultat: ResultatRatioLibre }
/** Recherche commune (toutes sources), chaque résultat composé contre la base ; requête vide → []. PURE. */
export function optionsDiviseur(catalog: MarketCatalog, requete: string, base: { symbol: string; exchange: ExchangeId }, timeframe: Timeframe, limite?: number): OptionDiviseur[];
// components/ChoixDiviseur.tsx
export function ChoixDiviseur(props: { base: { symbol: string; exchange: ExchangeId }; timeframe: Timeframe; fermer: (rendreFocus: boolean) => void }): JSX.Element;
```

- **Copie et rôles du sélecteur** :
  - conteneur : `role="dialog"`, `aria-label="Diviser par un autre actif"` ; ligne de titre `` `Diviser ${base.symbol} par…` `` ; `EnteteMenuMobile titre="Autre actif"` ;
  - champ : `role="combobox"`, `aria-label="Rechercher un diviseur"`, focalisé à l'ouverture ;
  - liste : `role="listbox"`, `aria-label="Diviseurs"`.
  - Un résultat refusé porte `aria-disabled="true"` et affiche sa raison à la place de la source.
  - Si rien ne correspond, le texte est « Aucun actif trouvé. Entrée pour vérifier ce symbole. » ; Entrée résout alors la saisie par `resolveMarketCandidates` (premier candidat non `synthetic` et non spéculatif). Faute de candidat, le texte est `` `Actif indisponible : ${saisie}` ``.
- **Comportement** :
  - Entrée ou clic sur un résultat accepté :
    - `syntheticsStore.getState().addRecent(symbole)` ;
    - `marketStore.getState().setMarket({ exchange: "synthetic", symbol: symbole, timeframe: timeframeProche(supportedTimeframesFor("synthetic", symbole), timeframe) ?? timeframe })` ;
    - `fermer(false)`.
  - Échap donne `fermer(true)`. Un pointeur hors du panneau donne `fermer(false)`.
  - Le catalogue démarre sur `CATALOGUE_LOCAL`, puis passe à `fetchMarketCatalog()` et `subscribeMarketCatalog`. La requête passe par `catalogueInterroge`.

- [ ] **Step 1 : écrire les tests qui échouent** (`choixDiviseur.test.ts`), avec un catalogue fixe mêlant `binance` ETHUSDT et BTCUSDT, `twelvedata` CPER, AAPL et USD/JPY, et `synthetic` STABLE.D :
  - `optionsDiviseur(cat, "", base, "1d")` donne `[]` ;
  - base BTCUSDT/binance, requête « CPER » : le premier résultat est `{ candidat: { symbol: "CPER" }, resultat: { symbole: "binance:BTCUSDT|/|twelvedata:CPER", denom: "CUIVRE" } }` ;
  - requête « USD/JPY » : `resultat: { refus: "Devises différentes (USD contre JPY)" }` ;
  - requête « STABLE.D » : `resultat: { refus: "Série en % ou déjà composée : pas un diviseur" }` ;
  - requête « BTCUSDT » sur la base BTCUSDT/binance : `resultat: { refus: "Même actif que le graphique" }`.
- [ ] **Step 2 : vérifier l'échec.** `pnpm --filter @axiom/web exec vitest run src/data/choixDiviseur.test.ts`. Attendu : FAIL.
- [ ] **Step 3 : implémenter `optionsDiviseur`.** `searchMarkets(catalog, requete, limite ?? 30, timeframe)`, puis `symboleRatioLibre` sur chaque candidat. Vérifier avec la même commande : PASS.
- [ ] **Step 4 : implémenter `ChoixDiviseur.tsx` et le brancher dans `SymbolBanner.tsx`.**
  - `const ChoixDiviseur = lazy(() => import("./ChoixDiviseur").then((m) => ({ default: m.ChoixDiviseur })))`, monté sous `<Suspense fallback={null}>` dans le `span` du bouton scindé (ref d'ancrage).
  - Dans le menu, après les groupes : un séparateur, puis `<button type="button" role="menuitem">Autre actif…</button>`. Son clic fait `fermer()` puis ouvre le sélecteur.
  - `fermer(true)` rend le focus au bouton `[aria-haspopup="menu"]` de l'ancrage.
  - Un `useEffect` sur `[exchange, symbol]` ferme le sélecteur.
  - Panneau : `axiom-menu-mobile ${classesPanneauMenu("right", "bas")} w-72`, sous `PortailMobile`.
- [ ] **Step 5 : vérifier.**
  - `pnpm --filter @axiom/web exec vitest run src/data/choixDiviseur.test.ts src/components/uiConventions.test.ts` ;
  - `pnpm --filter @axiom/web typecheck`.

  Attendu : PASS, typage OK.
- [ ] **Step 6 : e2e** (`gate-v24-macro-denominateur.e2e.ts`, avec `bouchonnerTwelveData`). Quatre tests :
  1. **Clavier.**
     - Focus sur « Choisir l'actif de comparaison », Entrée, Fin : `menuitem` « Autre actif… » focalisé.
     - Entrée : le combobox « Rechercher un diviseur » est focalisé.
     - `fill("AAPL")`, option `/^AAPL\b/` visible, Entrée : « BTCUSDT ÷ AAPL » visible.
     - Rouvrir menu puis « Autre actif… », Échap : le combobox disparaît, le bouton du menu est focalisé.
  2. **Fixe d'abord.** `fill("ETHUSDT")`, Entrée : « BTCUSDT / ETHUSDT » visible, bouton `÷ETH` avec `aria-pressed="true"`.
  3. **Refus d'offre.**
     - Route `**/tdapi/time_series*` : 404 `{ status: "error", code: 404, message: "This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing" }` pour `symbol=WTI/USD`, sinon `SERIE_TD`.
     - `fill("WTI/USD")`, Entrée : `[data-chart-status="error"]` contient `/abonnement.*Grow/i`.
     - Les symboles demandés ne contiennent pas « USO ».
  4. **Changement de marché.** Sélecteur ouvert, puis `page.evaluate` qui importe `/src/store/market.ts` et `setMarket({ exchange: "binance", symbol: "ETHUSDT", timeframe: "1d" })` : le combobox disparaît.

  Dans `mobile.e2e.ts`, nouveau test « ratios : « Autre actif… » s'ouvre au toucher » :
  - `preparer`, goto, tap « Détails du marché et ratios », tap « Choisir l'actif de comparaison » ;
  - `dansEcran(page, menuMobile(page).getByRole("menuitem", { name: "Autre actif…" }))`, puis tap ;
  - le combobox « Rechercher un diviseur » est visible.

  Lancer :
  - `AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test gate-v24-macro-denominateur` ;
  - `AXIOM_E2E_PORT=5281 pnpm --filter @axiom/web exec playwright test --config=playwright.mobile.config.ts mobile.e2e.ts -g "ratios"`.

  Attendu : PASS.
- [ ] **Step 7 : commit.** Message « Ajouter l'entrée « Autre actif… » au menu ÷ : diviser par n'importe quel actif du catalogue ».

---

### Task 6 : Preuves et consignation (orchestrateur)

**Files :** Modify `BUILD-CONTRACT.md` (nouvelle section en fin de fichier) ; plan et spec cochés.

- [ ] **Step 1.** `pnpm check` vert. Relever les totaux de tests et le budget initial (avant / après, delta gzip ≤ +1 200).
- [ ] **Step 2.** E2E deux fois de suite :
  - `AXIOM_E2E_PORT=5239 pnpm --filter @axiom/web exec playwright test gate-v24-macro-denominateur sources-automatiques` ;
  - le parcours téléphone `-g "ratios"`.
- [ ] **Step 3 : contrôle navigateur en données réelles** (`pnpm --filter @axiom/web dev --host 127.0.0.1`, clé réelle), serveur arrêté à la fin :
  - BTCUSDT ÷Cuivre (CPER) en 1d : dernière clôture ≈ clôture BTC ÷ clôture CPER, chiffre noté. Puis en 15m.
  - ÷Sucre (CANE) ; « en CHF » ;
  - « Autre actif… » :
    - ETHUSDT, sur BTCUSDT et sur Bybit HYPEUSDT, donne le ÷ETH du bouton ;
    - SPY donne ÷S&P 500 (SPY) ;
    - AAPL donne un ratio libre, puis le retour à la jambe A ;
  - le préréglage BTC / OR (proxy GLD) montre « ÷GLD » enfoncé.
- [ ] **Step 4.** Section « Ratios ÷ matières premières et ÷ autre actif (demande du 22 novembre 2026) » de `BUILD-CONTRACT.md`. Elle reprend la table de vérification de la spec §2 (café absent compris), les arbitrages §9, le renversement USOIL du 23/09, les limites §4.6, le budget mesuré et les tests.
- [ ] **Step 5.** Revue finale indépendante de la branche entière. Corriger, puis commit « Consigner les ratios ÷ matières premières et ÷ autre actif ». Fusion dans `main` sur accord du propriétaire.
