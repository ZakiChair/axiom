# Plan de correction — revue complète 2026-09-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Corriger les 55 constats de code confirmés par la revue adversariale du 2026-09-01 (0 critique, 9 hautes, 28 moyennes, 18 basses), en commençant par rendre le chantier CAP/BPL committable.

**Architecture :** Six lots indépendants, exécutables dans l'ordre 0 → A → B → C → D → E. Le Lot 0 est un préalable absolu : il assainit puis committe le chantier non versionné (50 fichiers, 5 jours hors git) — aucun autre lot ne démarre avant, pour ne pas mélanger corrections de revue et chantier en cours dans les mêmes commits. Chaque tâche suit un cycle TDD complet et se termine par un commit dédié.

**Tech Stack :** TypeScript strict (noUncheckedIndexedAccess), React 18 + Vite + KLineChart ^9.8 + Zustand vanilla (apps/web, tests vitest), Bun + SQLite (apps/daemon, tests `bun test`), vitest (packages/*), Playwright (e2e).

**Spec :** La source de vérité des constats est le rapport de revue (artifact « Revue AXIOM », https://claude.ai/code/artifact/d7e6b166-69c7-4937-9d7d-fcd69a5da6f3) — chaque tâche cite son constat (titre + fichier:ligne + sévérité). Le contrat projet reste `BUILD-CONTRACT.md`.

## Global Constraints

- **Contrat** : lire `BUILD-CONTRACT.md` avant toute tâche ; il prime sur ce plan en cas de conflit.
- **TypeScript strict** partout, `noUncheckedIndexedAccess` activé (tsconfig.base.json).
- **Langue** : commentaires, docstrings et messages de commit en **français**.
- **AUCUNE dépendance nouvelle** ; ne pas modifier les `package.json` (deps figées).
- **`packages/types` FIGÉ** : si un type manque, le signaler, ne pas le modifier.
- **Pas de données haute fréquence dans le state React** : ticks/live dans les stores vanilla hors render-loop.
- **Jamais de pane muet** : tout état dégradé est affiché (UNUSABLE / PARTIAL / badge).
- **Vérification finale de chaque lot** : `bash scripts/ci.sh` (typecheck + tests monorepo + build web) doit être vert avant de considérer le lot fini.
- **Aucune nouvelle fenêtre ni surface** : ce plan ne fait que corriger l'existant (gel G100 maintenu, exceptions WHALES + CAP/BPL actées au Lot 0).
- **Hors périmètre de ce plan** : le **verdict G100** lui-même (gate manuel, à rendre par Zaki — voir `docs/superpowers/plans/2026-07-22-gate-g100-qa.md`), et le backlog listé en fin de document.

---
## Ordre d'exécution et dépendances

**Lot 0 d'abord, intégralement** (0.1 → 0.5 dans l'ordre, puis 0.6 valide et committe) : tant que le chantier CAP/BPL n'est pas versionné, aucun autre lot ne démarre — sinon corrections de revue et chantier se mélangent dans les mêmes commits. Ensuite les lots A–E sont indépendants entre eux (ordre A → B → C → D → E recommandé par sévérité).

Dépendances internes (l'ordre des tâches dans chaque lot les respecte déjà) :
- **A.7 après A.1** (imports partagés dans `orderflow.calc.ts`/`orderflow.ts`).
- **B.2 après B.1** (réutilise `pollEtherscan` injectable, `resultatGetLogs` et le stub de test introduits par B.1).
- **C.6 après C.5** (teste via `gererRaccourciGlobal` exporté par C.5).
- **E.3 après E.2** (bascule sur la boucle WS extraite) ; **E.9 après E.7** (interface `OptionsProxy`) **et après E.6** (même fonction `executerTelechargement`).
- 0.3 puis 0.4 (zones disjointes de `mcapCandles.ts`).

## Décisions actées par les rédacteurs (écarts assumés vs les correctifs suggérés par la revue)

Chaque écart est motivé par la lecture du code réel ; le détail est dans la tâche concernée.

- **A.1 (CVD)** : gate binance-only — **Coinbase perd son pane CVD** (il n'était juste qu'en live, faux sur tout l'historique REST) ; tooltip de la Toolbar mis à jour en conséquence.
- **A.3 (borne 5 000)** : stratégie = **suppression de la fenêtre glissante du store**, pas un alignement à 20 000 — KLineChart ne tronque jamais sa dataList, donc toute troncature côté store recrée le décalage index-par-index. La borne mémoire réelle reste la purge au changement d'identité + le plafond de pagination.
- **A.2 (OKX utc)** : pas d'invalidation de cache nécessaire — vérifié : aucune bougie HKT ne survit au correctif après rechargement (buffer purgé par identité, cache daemon sans appelant sur ce chemin).
- **A.4 (z-score funding)** : source primaire = `histFunding` (règlements Binance RÉELS, déjà écrit et memoïsé dans `data/referentiels.ts`), Coinalyze `4hour` sous-échantillonné en repli — pas le « 4hour 1/2 » en primaire.
- **B.2 (troncature getLogs)** : curseur sûr = `max(blockNumber reçu) − 1` (le bloc de tête peut être coupé en plein milieu), borné à `fenetre.de`, MIN entre les 2 tokens (curseur KV partagé) ; idempotence des ids → relecture du bloc frontière sans doublon.
- **B.3 (blocs BTC)** : `rawblock/<hash>` remplacé par `block-height/<h>?format=json` (seule forme résolvable par hauteur) ; couvre aussi la péremption du prix BTC (même fonction).
- **C.1 (multi-fenêtres)** : élection de leader minimale par `document.hasFocus()` dans `writeJson` — pas de BroadcastChannel ; sémantique assumée : la clé reflète la dernière fenêtre active, pas de fusion inter-fenêtres.
- **C.2 (dessins)** : clé **par slot** `slot:exchange:symbole` avec migration douce (copie de la clé héritée, jamais réécrite) — conforme à « overlays scellés au slot » du contrat ; les dessins deviennent indépendants par slot.
- **C.3** : `notes.ts` et `portfolio.ts` partagent le même défaut d'hydratation mais sont **hors périmètre** (le constat visait alerts/paper/presetAlerts) → backlog.
- **D.3 (longueurs fractionnaires)** : PAS de `Math.round` global dans `resolveParams` (casserait les inputs légitimement fractionnaires : factor QQE 4.236, multiplicateurs Bollinger/SuperTrend, step PSAR) ni de flag sur `IndicatorInput` (`@axiom/types` figé) → quantification dans les 8 helpers de fenêtre de `utils.ts` + localement `kama.ts`/`fisher.ts`.
- **D.2 (HalfTrend)** : règle de bascule canonique Everget, mais la ligne conserve le décalage ±dev existant (sinon l'input `atrPeriod` devient mort) — écart documenté en tête de fichier.
- **D.4 (divergences)** : pour les defs d'affichage, correctif documentaire (les segments pivot→pivot sont rétrodatés par nature) ; le vrai retard de signal (jusqu'à +3 barres) est corrigé côté stratégie et documenté.
- **E.10 (VACUUM)** : `PRAGMA incremental_vacuum` est un no-op vérifié sous `auto_vacuum=0` → garde simple : renoncer au VACUUM au-delà de 256 Mo de fichier.
- **E.9 (timeouts)** : 15 s sur les proxys historiques, **600 s** sur le dump replay (des zips de centaines de Mo mourraient à 15 s).
- **0.4 (TOTAL* figées)** : repoll léger CMC (TTL 5/15 min par TF) plutôt que brancher le tick CoinGecko — les niveaux CoinGecko (somme top 100) et CMC diffèrent, la bougie sauterait au raccord ; limitation assumée : en mode CCData-sans-clé-CMC la série reste statique comme aujourd'hui.
- **Lot 0** : les étapes « commit » des Tasks 0.1–0.5 renvoient aux 4 commits structurés de la Task 0.6 (fichiers non suivis = un commit isolé par correctif casserait le découpage) ; `AGENTS.md`/`CLAUDE.md` (hors chantier) exclus, laissés à la décision de Zaki.

---

## Lot 0 — Committer le chantier CAP/BPL proprement

Contexte vérifié le 2026-09-01 : `git status` confirme 36 fichiers modifiés + 14 nouveaux fichiers de code non suivis (chantier CAP/BPL), plus **2 fichiers étrangers au chantier** (`AGENTS.md`, `CLAUDE.md`, non suivis — protocole multi-modèle, à EXCLURE des commits de ce lot). Branche `main`, dernier commit `19f311e`, remote `origin` = github.com/ZakiChair/axiom.

**Particularité assumée du lot** : les Tasks 0.1 à 0.5 corrigent le chantier AVANT versionnement — leur étape « commit » renvoie donc au commit structuré correspondant de la Task 0.6 (un commit isolé d'un fichier non suivi casserait le découpage en lots cohérents). Chaque task reste rejetable indépendamment : si une task est rejetée, son fichier part dans le commit de la Task 0.6 dans l'état du chantier actuel.

Commandes de test vérifiées dans les `package.json` réels :
- web : `pnpm --filter @axiom/web exec vitest run <fichier>` (script `test` = `vitest run`)
- daemon : `pnpm --filter @axiom/daemon exec bun test <fichier>` (script `test` = `bun test src`)
- e2e : `pnpm --filter @axiom/web exec playwright test <fichier>` (config `apps/web/playwright.config.ts`, `testDir: "./e2e"`)

---

### Task 0.1 : Fenêtre incrémentale CMC qui rejoint la fin du cache
**Constat couvert :** Trou permanent dans l'historique CMC après plus de 45 jours sans ouvrir le terminal (`apps/web/src/data/cmcMcap.ts:355`, sévérité moyenne)
**Files:**
- Modify: apps/web/src/data/cmcMcap.ts:346-371 (fonction `chargerInterne`)
- Test: apps/web/src/data/cmcMcap.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans le `describe("chargerHistoriqueCmc")` existant (après le test « rend null sur panne initiale ») :

```ts
  it("repart de la fin du cache quand il est plus vieux que la fenêtre de 45 jours", async () => {
    const timeStarts: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const debut = Number(url.searchParams.get("timeStart")) * 1000;
      const fin = Number(url.searchParams.get("timeEnd")) * 1000;
      if (url.pathname.includes("global-metrics")) {
        timeStarts.push(debut);
        const quotes = Array.from(
          { length: Math.floor((fin - debut) / JOUR) + 1 },
          (_, i) => globalQuote(debut + i * JOUR, 1_000 + i, 600 + i),
        );
        return reponse({ data: { quotes }, status: { error_code: "0" } });
      }
      return reponse({ data: { points: [] }, status: { error_code: "0" } });
    });

    // Semer un cache dont le dernier point est T0 (écrit par un premier chargement).
    await chargerHistoriqueCmc({
      fetcher: fetcher as typeof fetch,
      debut: T0,
      fin: T0,
      maintenant: () => T0 + JOUR,
    });
    timeStarts.length = 0;

    // 60 jours plus tard : la fenêtre incrémentale doit rejoindre la fin du cache (T0),
    // pas s'arrêter à now − 45 j — sinon les 15 jours intermédiaires sont perdus À VIE
    // (majTs=now rend le cache « frais » et aucun rafraîchissement ne recouvre le trou).
    const now = T0 + 60 * JOUR;
    const points = await chargerHistoriqueCmc({
      fetcher: fetcher as typeof fetch,
      fin: now,
      maintenant: () => now,
    });

    expect(Math.min(...timeStarts)).toBeLessThanOrEqual(T0);
    const temps = (points ?? []).map((point) => point.t);
    for (let t = T0; t <= now; t += JOUR) expect(temps).toContain(t);
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/cmcMcap.test.ts` → le nouveau test échoue sur `expect(Math.min(...timeStarts)).toBeLessThanOrEqual(T0)` (valeur reçue = `T0 + 15 jours`, la fenêtre fixe `now − 45j`), les 8 autres tests du fichier restent verts.

- [ ] **Étape 3 : implémentation minimale** — dans `chargerInterne` (cmcMcap.ts:355), remplacer :

```ts
    const debut = cache === null ? deps.debut : Math.max(DEBUT_HISTORIQUE_CMC, now - 45 * JOUR_MS);
```

par :

```ts
    // La fenêtre incrémentale doit TOUJOURS rejoindre la fin du cache : un terminal
    // rouvert après plus de 45 jours partirait sinon de now−45 j, et le trou entre la
    // fin du cache et now−45 j deviendrait définitif (majTs=now rend le cache « frais »,
    // les rafraîchissements suivants ne couvrent jamais plus de 45 j en arrière).
    // On recouvre d'un jour la fin du cache — `fusionner` déduplique par timestamp.
    const dernier = cache?.points.at(-1);
    const debut = cache === null || dernier === undefined
      ? deps.debut
      : Math.max(DEBUT_HISTORIQUE_CMC, Math.min(now - 45 * JOUR_MS, dernier.t - JOUR_MS));
```

(`lireCache` renvoie des points dans l'ordre d'écriture, toujours triés par `fusionner`/`fetchHistoriqueCmc` — `.at(-1)` est bien la fin du cache ; le garde `dernier === undefined` satisfait `noUncheckedIndexedAccess`.)

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/cmcMcap.test.ts` → 9 tests verts (les 8 existants + le nouveau).

- [ ] **Étape 5 : versionnement** — PAS de commit isolé (fichier non suivi, particularité du lot) : `apps/web/src/data/cmcMcap.ts` et son test partent dans le **commit 2 « séries TOTAL* »** de la Task 0.6. Vérifier seulement `git status --short apps/web/src/data/ | grep cmcMcap` → les deux fichiers apparaissent en `??`.

---

### Task 0.2 : Retirer la route générique morte /ccdataapi du daemon
**Constat couvert :** Daemon — entrée RouteProxy /ccdataapi morte, validée par des tests qui n'exercent jamais le chemin réel (`apps/daemon/src/proxy.ts:135`, sévérité basse)
**Files:**
- Modify: apps/daemon/src/proxy.ts:134-148 (entrée de `construireRoutesProxy`), :860-871 (`enregistrerProxy`), :10 (commentaire d'en-tête)
- Test: apps/daemon/src/proxy.test.ts (supprime :62, :134-140, :164-179 ; ajoute 1 test)

- [ ] **Étape 1 : écrire le test qui échoue** — dans `proxy.test.ts`, à la fin du `describe("construireRoutesProxy — cibles et réécritures")` :

```ts
  test("aucune route générique /ccdataapi : le préfixe est servi par traiterCcData seul", () => {
    // enregistrerProxy court-circuite /ccdataapi vers traiterCcData, qui recalcule
    // cible/réécriture/validation lui-même : une entrée RouteProxy serait du code mort
    // (rewrite et entetesAmont jamais exécutés en production).
    expect(construireRoutesProxy(CLES).some((route) => route.prefix === "/ccdataapi")).toBe(false);
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/daemon exec bun test src/proxy.test.ts` → le nouveau test échoue (`Expected: false, Received: true`), le reste du fichier vert.

- [ ] **Étape 3 : implémentation minimale** — trois modifications dans `proxy.ts` :

1. Supprimer l'entrée `/ccdataapi` de `construireRoutesProxy` (l.134-148) :

```ts
    {
      prefix: "/ccdataapi",
      target: "https://min-api.cryptocompare.com",
      rewrite: (chemin) => chemin.replace(/^\/ccdataapi/, ""),
      entetesAmont: (entetesFront) => {
        const authorization = entetesFront.get("authorization");
        const entetes: Record<string, string> = {};
        if (
          authorization !== null &&
          authorization.length <= 512 &&
          /^Apikey\s+\S+$/i.test(authorization)
        ) entetes.authorization = authorization;
        return entetes;
      },
    },
```

→ bloc supprimé entièrement (la `]` de fin de tableau suit directement l'entrée `/bgapi`).

2. Simplifier `enregistrerProxy` (l.860-871) :

```ts
/** Enregistre les routes de proxy à clé + le proxy générique /extapi dans le routeur. */
export function enregistrerProxy(routeur: Routeur, cles: ProxyKeys): void {
  for (const route of construireRoutesProxy(cles)) {
    routeur.enregistrerPrefixe(route.prefix, (req, url) => traiterProxy(req, url, route));
  }
  // /ccdataapi : gestionnaire DÉDIÉ durci (validation Apikey + gardes /extapi), PAS une
  // RouteProxy générique — traiterCcData recalcule cible, réécriture et validation lui-même.
  routeur.enregistrerPrefixe("/ccdataapi", (req, url) => traiterCcData(req, url));
  // Proxy générique /extapi (Phase 3) : hôtes whitelistés, GET only, cache TTL.
  routeur.enregistrerPrefixe("/extapi", (req, url) => traiterExtapi(req, url));
}
```

3. Ajuster la ligne 10 du commentaire d'en-tête :

```ts
 *   /bgapi → bitcoin-data.com (Bearer)
 *   /ccdataapi → min-api.cryptocompare.com (Apikey) — gestionnaire dédié traiterCcData, hors table
```

- [ ] **Étape 3 bis : supprimer les tests de la route morte** dans `proxy.test.ts` (ils validaient du code jamais exécuté en production — fausse assurance ; `traiterCcData` couvre déjà le comportement réel aux l.181-236) :
  - dans « cibles amont exactes », la ligne `expect(routePar("/ccdataapi").target).toBe("https://min-api.cryptocompare.com");` (l.62) ;
  - le test `test("/ccdataapi : strip préfixe sans placer la clé dans la query", () => { … })` (l.134-140) en entier ;
  - le `describe("/ccdataapi — relais borné d'Authorization: Apikey", () => { … })` (l.164-179) en entier.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/daemon exec bun test src/proxy.test.ts` → tout vert (dont les 2 tests `traiterCcData` inchangés), puis non-régression daemon complète : `pnpm --filter @axiom/daemon test`.

- [ ] **Étape 5 : versionnement** — PAS de commit isolé : `proxy.ts` + `proxy.test.ts` partent dans le **commit 1 « proxy /ccdataapi »** de la Task 0.6.

---

### Task 0.3 : Le bandeau affiche la source réellement servie
**Constat couvert :** Le bandeau de provenance affiche la source « disponible », pas la source servie (`apps/web/src/components/SymbolBanner.tsx:280`, sévérité moyenne)
**Files:**
- Modify: apps/web/src/data/mcapCandles.ts:98-136 (`fetchKlines` + nouveau store)
- Modify: apps/web/src/components/SymbolBanner.tsx:19-30 (imports), :275-286 (calcul du libellé)
- Test: apps/web/src/data/mcapCandles.test.ts
- Test: apps/web/src/components/SymbolBanner.test.ts

**Interfaces:** (consommées par SymbolBanner, et par le relecteur de la Task 0.6 — l'e2e `gate-v25-cap-dominance` asserte les libellés)

```ts
// apps/web/src/data/mcapCandles.ts
export type SourceCapitalisation = "cmc" | "ccdata" | "coingecko";
export const sourcesCapitalisationStore: StoreApi<{ sources: Record<string, SourceCapitalisation> }>;
// clé du record : `${symbole}:${timeframe}` (ex. "TOTAL:1d")

// apps/web/src/components/SymbolBanner.tsx
export function libelleSourceCapitalisation(
  source: SourceCapitalisation | undefined,
  timeframe: Timeframe,
): string | null;
```

- [ ] **Étape 1 : écrire les tests qui échouent** —

Dans `mcapCandles.test.ts` : ajouter `sourcesCapitalisationStore` à l'import (`import { capitalisationAdapter, construireBougiesCapitalisation, sourcesCapitalisationStore } from "./mcapCandles";`), ajouter `sourcesCapitalisationStore.setState({ sources: {} });` à la fin du `beforeEach` existant, puis dans `describe("capitalisationAdapter")` :

```ts
  it("publie la provenance réellement servie, pas la source disponible", async () => {
    chargerHistoriqueCmcMock.mockResolvedValue([snapshot(T0, 100)]);
    await capitalisationAdapter.fetchKlines("TOTAL", "1d", { limit: 10 });
    expect(sourcesCapitalisationStore.getState().sources["TOTAL:1d"]).toBe("cmc");

    chargerHistoriqueCmcMock.mockResolvedValue(null);
    chargerHistoriqueCcDataMock.mockResolvedValue([snapshot(T0, 100)]);
    await capitalisationAdapter.fetchKlines("TOTAL", "1d", { limit: 10 });
    expect(sourcesCapitalisationStore.getState().sources["TOTAL:1d"]).toBe("ccdata");
  });

  it("étiquette CoinGecko le repli intraday même quand le cache CMC daily existe", async () => {
    // Scénario du constat : endpoint intraday CMC en panne + cache daily présent →
    // les bougies servies viennent de macroHistory (CoinGecko), le bandeau doit le dire.
    historiqueCmcDisponibleMock.mockReturnValue(true);
    fetchPageHistoriqueCmcMock.mockRejectedValue(new Error("quota"));
    macroHistoryStore.setState({ snapshots: [snapshot(T0, 100)] });

    await capitalisationAdapter.fetchKlines("TOTAL", "1h", { limit: 10 });

    expect(sourcesCapitalisationStore.getState().sources["TOTAL:1h"]).toBe("coingecko");
  });
```

Dans `SymbolBanner.test.ts` (fichier de fonctions pures — le rendu React n'y est pas testable, pas de DOM) : ajouter `libelleSourceCapitalisation` à l'import depuis `./SymbolBanner`, puis en fin de fichier :

```ts
describe("libelleSourceCapitalisation", () => {
  it("étiquette la source réellement servie et se tait tant qu'elle est inconnue", () => {
    expect(libelleSourceCapitalisation(undefined, "1d")).toBeNull();
    expect(libelleSourceCapitalisation("cmc", "1h")).toBe("CoinMarketCap · 1h");
    expect(libelleSourceCapitalisation("cmc", "4h")).toBe("CoinMarketCap · 4h");
    expect(libelleSourceCapitalisation("cmc", "1w")).toBe("CoinMarketCap · daily");
    expect(libelleSourceCapitalisation("ccdata", "1d")).toBe("CCData · daily");
    expect(libelleSourceCapitalisation("coingecko", "1h")).toBe("CoinGecko · local");
  });
});
```

- [ ] **Étape 2 : les lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/mcapCandles.test.ts src/components/SymbolBanner.test.ts` → échec d'import (`sourcesCapitalisationStore` et `libelleSourceCapitalisation` n'existent pas encore : « No export named … » / `undefined is not a function`).

- [ ] **Étape 3 : implémentation minimale** —

Dans `mcapCandles.ts`, ajouter en tête (après les imports existants, `createStore` en plus) :

```ts
import { createStore } from "zustand/vanilla";
```

puis, avant `capitalisationAdapter` :

```ts
/** Source réellement servie par le dernier `fetchKlines` d'une série de capitalisation. */
export type SourceCapitalisation = "cmc" | "ccdata" | "coingecko";

/**
 * Provenance RÉELLE des bougies de capitalisation, posée par l'adaptateur AU MOMENT où il
 * choisit sa source. Le bandeau ne doit pas la re-deviner par disponibilité : un repli
 * CoinGecko avec un cache CMC présent afficherait sinon « CoinMarketCap » sur des données
 * CoinGecko (l'étiquetage des sources est une exigence du contrat — UNUSABLE/PARTIAL).
 * Clé : `${symbole}:${timeframe}` — deux slots sur des TF différents ne s'écrasent pas.
 */
export const sourcesCapitalisationStore = createStore<{
  sources: Record<string, SourceCapitalisation>;
}>(() => ({ sources: {} }));

function publierSourceCapitalisation(
  symbol: string,
  tf: Timeframe,
  source: SourceCapitalisation,
): void {
  sourcesCapitalisationStore.setState((state) =>
    state.sources[`${symbol}:${tf}`] === source
      ? state
      : { sources: { ...state.sources, [`${symbol}:${tf}`]: source } },
  );
}
```

Dans `fetchKlines`, tracer la source choisie et la publier juste avant le retour :

```ts
    let snapshots: McapSnapshot[];
    let erreurIntraday: unknown = null;
    let source: SourceCapitalisation;
    if (tf === "1h" || tf === "4h") {
      try {
        snapshots = await fetchPageHistoriqueCmc(tf, {
          endTime: opts?.endTime,
          limit: opts?.limit,
        });
        source = "cmc";
      } catch (error) {
        erreurIntraday = error;
        snapshots = macroHistoryStore.getState().snapshots;
        source = "coingecko";
      }
    } else {
      const historiqueCmc = await chargerHistoriqueCmc();
      const historiqueCcData = historiqueCmc === null ? await chargerHistoriqueCcData() : null;
      snapshots = historiqueCmc ?? historiqueCcData ?? macroHistoryStore.getState().snapshots;
      source = historiqueCmc !== null ? "cmc" : historiqueCcData !== null ? "ccdata" : "coingecko";
    }
```

et remplacer la fin de la fonction :

```ts
    if (result.length === 0 && erreurIntraday !== null) throw erreurIntraday;
    publierSourceCapitalisation(symbol, tf, source);
    return result;
```

Dans `SymbolBanner.tsx` :

1. Imports : supprimer `import { ccdataKeyStore } from "../store/ccdata";`, `import { historiqueCmcDisponible } from "../data/cmcMcap";`, `import { historiqueCcDataDisponible } from "../data/ccdataMcap";` (orphelins créés par CE changement) ; ajouter :

```ts
import { sourcesCapitalisationStore, type SourceCapitalisation } from "../data/mcapCandles";
```

2. Ajouter la fonction pure exportée (à côté de `nextCloseTs`/`rolling24h`) :

```ts
/**
 * Libellé de provenance d'une série de capitalisation, à partir de la source RÉELLEMENT
 * servie par `capitalisationAdapter.fetchKlines` (jamais re-devinée par disponibilité).
 * `undefined` (fetch pas encore abouti) → null : le bandeau se tait plutôt que de mentir.
 * PURE & testée.
 */
export function libelleSourceCapitalisation(
  source: SourceCapitalisation | undefined,
  timeframe: Timeframe,
): string | null {
  if (source === undefined) return null;
  if (source === "cmc") {
    return `CoinMarketCap · ${timeframe === "1h" || timeframe === "4h" ? timeframe : "daily"}`;
  }
  return source === "ccdata" ? "CCData · daily" : "CoinGecko · local";
}
```

3. Dans le composant, remplacer le bloc `const ccdataHasKey = …` (l.275) et `const sourceCapitalisation = …` (l.280-286) par :

```ts
  const estCapitalisation =
    estSymboleCapitalisation(symbol) || syntheticSpec?.exA === "mcap" || syntheticSpec?.exB === "mcap";
  // Pour un ratio, la jambe mcap porte la provenance (fetchKlines est appelé avec elle).
  const cleSource = syntheticSpec?.exA === "mcap"
    ? syntheticSpec.legA
    : syntheticSpec?.exB === "mcap"
      ? syntheticSpec.legB
      : symbol;
  const sourceServie = useStore(
    sourcesCapitalisationStore,
    (s) => s.sources[`${cleSource}:${timeframe}`],
  );
  const sourceCapitalisation = estCapitalisation
    ? libelleSourceCapitalisation(sourceServie, timeframe)
    : null;
```

(la ligne `const estCapitalisation` existe déjà — seule la déclaration `ccdataHasKey` disparaît et le calcul du libellé change).

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/mcapCandles.test.ts src/components/SymbolBanner.test.ts` → tout vert (nouveaux + existants), puis `pnpm --filter @axiom/web typecheck` (vérifie qu'aucun import orphelin ne subsiste, TS strict `noUnusedLocals`).

- [ ] **Étape 5 : versionnement** — PAS de commit isolé : les 4 fichiers partent dans le **commit 2 « séries TOTAL* »** de la Task 0.6.

---

### Task 0.4 : Rafraîchir la dernière bougie TOTAL* quand l'historique CMC est actif
**Constat couvert :** Séries TOTAL* figées toute la session dès que la meilleure source est disponible (`apps/web/src/data/mcapCandles.ts:142`, sévérité basse)
**Files:**
- Modify: apps/web/src/data/mcapCandles.ts:138-154 (`subscribeKline`)
- Modify: apps/web/src/data/cmcMcap.ts:259-262 (élargir `fetchPageHistoriqueCmc` à `IntervalleCmc`)
- Test: apps/web/src/data/mcapCandles.test.ts

**Interfaces:** `fetchPageHistoriqueCmc(intervalle: IntervalleCmc, options?: PageHistoriqueCmcOptions)` — le paramètre passe de `"1h" | "4h"` à `IntervalleCmc` (= `"1h" | "4h" | "1d"`, déjà exporté) ; aucun appelant existant ne casse (élargissement).

Note de conception (écart avec la 1ʳᵉ option du correctif, cf. avertissements) : on NE branche PAS le tick macroHistory sur la dernière bougie — les niveaux CoinGecko (somme top 100) et CMC diffèrent, la bougie courante sauterait à chaque raccord et le test existant « ne mélange pas les ticks CoinGecko avec un historique CMC actif » l'interdit à raison. On implémente la 2ᵉ option du correctif : **repoll léger de la même source CMC** (page couvrant le bucket courant + un point du bucket précédent, pour que l'open forward-fillé reste identique à l'historique), cadence 5 min en 1h/4h, 15 min au-delà. Limitation assumée : en mode CCData-sans-CMC le repoll CMC échoue silencieusement et la série reste statique (comportement actuel, inchangé).

- [ ] **Étape 1 : écrire le test qui échoue** — dans `mcapCandles.test.ts`, ajouter `vi.useRealTimers();` en tête de l'`afterEach` existant (robustesse si une assertion échoue sous timers factices), puis dans `describe("capitalisationAdapter")` :

```ts
  it("rafraîchit la bougie courante par repoll CMC quand l'historique CMC est actif", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 90 * 60_000); // 01:30 UTC → bucket 1h courant : T0 + 1 h
    historiqueCmcDisponibleMock.mockReturnValue(true);
    fetchPageHistoriqueCmcMock.mockResolvedValue([
      snapshot(T0, 100), // dernier point du bucket précédent → open forward-fillé cohérent
      snapshot(T0 + 3_600_000, 110),
      snapshot(T0 + 90 * 60_000, 115),
    ]);
    const callback = vi.fn();
    const unsubscribe = capitalisationAdapter.subscribeKline("TOTAL", "1h", callback);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchPageHistoriqueCmcMock).toHaveBeenCalledWith("1h", { limit: 3 });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({
      time: T0 + 3_600_000,
      open: 100,
      close: 115,
    });

    // Page identique → signature identique → pas de ré-émission.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchPageHistoriqueCmcMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/mcapCandles.test.ts` → le nouveau test échoue sur `expect(fetchPageHistoriqueCmcMock).toHaveBeenCalledWith("1h", { limit: 3 })` (0 appel : `subscribeKline` renvoie un no-op quand `historiqueCmcDisponible()` est vrai) ; le reste du fichier vert.

- [ ] **Étape 3 : implémentation minimale** —

Dans `cmcMcap.ts`, élargir la signature (l.259-262) :

```ts
export function fetchPageHistoriqueCmc(
  intervalle: IntervalleCmc,
  options: PageHistoriqueCmcOptions = {},
): Promise<McapSnapshot[]> {
```

(le corps est déjà générique : `pasIntervalle`/`alignerTemps` gèrent `"1d"`, et `chargerEth` bascule sur l'intervalle ETH quotidien.)

Dans `mcapCandles.ts` : ajouter `type IntervalleCmc` à l'import de `./cmcMcap`, puis les constantes près de `HEURE_MS` :

```ts
/** Cadence du repoll de la bougie courante quand l'historique long CMC/CCData est actif. */
const REPOLL_MCAP_INTRADAY_MS = 5 * 60_000;
const REPOLL_MCAP_LENT_MS = 15 * 60_000;
```

et remplacer `subscribeKline` :

```ts
  subscribeKline(symbol, tf, cb) {
    if (!estSymboleCapitalisation(symbol) || !TIMEFRAMES_CAPITALISATION.includes(tf)) {
      return () => {};
    }
    if (historiqueCmcDisponible() || historiqueCcDataDisponible()) {
      // Historique long actif : on ne mélange PAS les ticks CoinGecko (niveaux différents
      // de CMC → la bougie courante sauterait à chaque raccord). La dernière bougie est
      // rafraîchie par un repoll léger de la MÊME source CMC : la page couvre le bucket
      // courant + un point du bucket précédent, pour que l'open (close précédent,
      // forward-fill) reste identique à celui de l'historique affiché.
      const intervalle: IntervalleCmc = tf === "1h" || tf === "4h" ? tf : "1d";
      const pas = intervalle === "1h" ? HEURE_MS : intervalle === "4h" ? 4 * HEURE_MS : JOUR_MS;
      let arrete = false;
      let derniereSignature = "";
      const rafraichir = async (): Promise<void> => {
        try {
          const maintenant = Date.now();
          const debutBucket = debutBucketCapitalisation(maintenant, tf);
          const limit = Math.ceil((maintenant - debutBucket) / pas) + 2;
          const snapshots = await fetchPageHistoriqueCmc(intervalle, { limit });
          if (arrete) return;
          const candle = construireBougiesCapitalisation(snapshots, symbol, tf).at(-1);
          // Bucket courant absent de la page (retard amont) : ne rien émettre plutôt
          // que de réécrire une bougie déjà close avec des données partielles.
          if (candle === undefined || candle.time !== debutBucket) return;
          const signature = `${candle.time}:${candle.open}:${candle.high}:${candle.low}:${candle.close}`;
          if (signature === derniereSignature) return;
          derniereSignature = signature;
          cb(candle);
        } catch {
          // Repoll best-effort : une panne transitoire laisse la bougie en l'état.
        }
      };
      const timer = setInterval(
        () => void rafraichir(),
        tf === "1h" || tf === "4h" ? REPOLL_MCAP_INTRADAY_MS : REPOLL_MCAP_LENT_MS,
      );
      return () => {
        arrete = true;
        clearInterval(timer);
      };
    }
    // Mode dégradé (ni CMC ni CCData) : la série vit sur l'échantillonneur macroHistory.
    let derniereSignature = "";
    return macroHistoryStore.subscribe((state) => {
      const candle = construireBougiesCapitalisation(state.snapshots, symbol, tf).at(-1);
      if (candle === undefined) return;
      const signature = `${candle.time}:${candle.open}:${candle.high}:${candle.low}:${candle.close}`;
      if (signature === derniereSignature) return;
      derniereSignature = signature;
      cb(candle);
    });
  },
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/mcapCandles.test.ts src/data/cmcMcap.test.ts` → tout vert, y compris « ne mélange pas les ticks CoinGecko avec un historique CMC actif » (le repoll passe par timers, pas par le store — `setState` n'émet toujours rien) et « émet la bougie journalière mise à jour et se désabonne » (mode dégradé inchangé).

- [ ] **Étape 5 : versionnement** — PAS de commit isolé : `mcapCandles.ts`, `cmcMcap.ts` et le test partent dans le **commit 2 « séries TOTAL* »** de la Task 0.6.

---

### Task 0.5 : Acter l'exception CAP/BPL dans BUILD-CONTRACT.md
**Constat couvert :** Violation du gel G100 — 39ᵉ fenêtre (BPL) + 2 nouveaux fournisseurs sans amendement du contrat (`apps/web/src/store/windowManager.ts:103`, sévérité moyenne). La fenêtre BPL et les séries TOTAL* font partie du chantier demandé : on ACTE l'exception (style de la mention WHALES du 2026-08-25), on ne sort pas la fenêtre du lot.
**Files:**
- Modify: BUILD-CONTRACT.md:17 (§Décisions verrouillées, Sources), :37 (§État actuel), :41 (§Gate G100)

- [ ] **Étape 1 : amender §État actuel (l.37)** — remplacer :

```md
- **38 fenêtres** à mnémonique (`WINDOW_REGISTRY`) — dont WHALES (mouvements baleines on-chain + positions top comptes Hyperliquid), ajoutée le 2026-08-25 sur décision utilisateur : **écart ASSUMÉ** au gel « aucune nouvelle fenêtre avant le verdict G100 » (§ ci-dessous).
```

par :

```md
- **39 fenêtres** à mnémonique (`WINDOW_REGISTRY`) — dont WHALES (mouvements baleines on-chain + positions top comptes Hyperliquid), ajoutée le 2026-08-25 sur décision utilisateur, et BPL (Bitcoin Power Law), ajoutée le 2026-09-01 avec les séries TOTAL/TOTAL2/TOTAL3 chartables (chantier CAP/BPL) : **écarts ASSUMÉS** au gel « aucune nouvelle fenêtre avant le verdict G100 » (§ ci-dessous).
```

- [ ] **Étape 2 : amender §Gate G100 (l.41)** — remplacer :

```md
**Aucune nouvelle fenêtre ni fonctionnalité de surface avant le verdict** — une exception ACTÉE le 2026-08-25 (fenêtre WHALES + alerte `whale-flux`, demande utilisateur explicite) ; le gel reste la règle pour toute autre surface.
```

par :

```md
**Aucune nouvelle fenêtre ni fonctionnalité de surface avant le verdict** — deux exceptions ACTÉES : le 2026-08-25 (fenêtre WHALES + alerte `whale-flux`, demande utilisateur explicite) et le 2026-09-01 (fenêtre BPL + séries TOTAL/TOTAL2/TOTAL3 chartables, chantier CAP/BPL demandé par l'utilisateur) ; le gel reste la règle pour toute autre surface.
```

- [ ] **Étape 3 : acter les fournisseurs (§Décisions verrouillées, après la puce Sources l.17)** — ajouter la puce :

```md
- **Fournisseurs de capitalisation (exception ACTÉE le 2026-09-01, même statut que WHALES)** : l'historique TOTAL/TOTAL2/TOTAL3 et la fenêtre BPL sont servis par l'endpoint public `api.coinmarketcap.com/data-api` (sans clé, via `/extapi`), avec repli CryptoCompare `min-api.cryptocompare.com` (clé personnelle navigateur, route dédiée `/ccdataapi` daemon + Vercel) puis CoinGecko local. `EXCHANGE_IDS` reste à 9 (l'adaptateur de capitalisation est de source `synthetic`). Aucun autre fournisseur sans amendement ici.
```

- [ ] **Étape 4 : vérifier la cohérence** — `grep -n "39 fenêtres\|2026-09-01\|38 fenêtres" BUILD-CONTRACT.md` → « 39 fenêtres » présent, « 38 fenêtres » absent, trois mentions du 2026-09-01 ; et `grep -c "toHaveLength(39)" apps/web/src/store/windowManager.test.ts` → 1 (le compteur de tests du chantier et le contrat disent désormais la même chose).

- [ ] **Étape 5 : versionnement** — PAS de commit isolé : `BUILD-CONTRACT.md` part dans le **commit 4 « contrat + e2e »** de la Task 0.6.

---

### Task 0.6 : Validation complète puis commits structurés du chantier
**Constat couvert :** Chantier CAP/BPL entier non versionné depuis 5 jours — 36 fichiers modifiés + 14 nouveaux (`apps/web/src/store/windowManager.test.ts:242`, sévérité moyenne). Dépend des Tasks 0.1 à 0.5 (leurs fichiers partent dans ces commits).
**Files:**
- Aucune modification de code — validation + `git add`/`git commit` par lots.

- [ ] **Étape 1 : CI locale complète** — `bash scripts/ci.sh` (typecheck monorepo + `pnpm -r test` + build `@axiom/web`) → se termine par `==> [ci] OK`. Tout échec bloque le lot : corriger avant de committer.

- [ ] **Étape 2 : e2e ciblés** — `pnpm --filter @axiom/web exec playwright test gate-v25-cap-dominance.e2e.ts` → tests verts (dont les assertions `CoinMarketCap · daily/1h/4h` qui exercent le nouveau bandeau de provenance de la Task 0.3, la source stubée étant réellement CMC dans ce gate). En cas de doute élargir : `pnpm --filter @axiom/web exec playwright test gate-v25-cap-dominance gate-g7-liens gate-lot3-sect`.

- [ ] **Étape 3 : établir la liste réelle et vérifier l'absence de fichiers étrangers** — `git status --short` et comparer à la liste ci-dessous. Les SEULS fichiers hors chantier attendus sont `AGENTS.md` et `CLAUDE.md` (protocole multi-modèle, non suivis) : ils sont EXCLUS des 4 commits et restent non suivis (décision de versionnement à part, à poser à Zaki). Tout autre fichier inattendu (ex. `apps/web/dist/`, `data/`) : STOP, ne pas l'ajouter, le signaler.

- [ ] **Étape 4 : commit 1 — proxy /ccdataapi + hôte CMC** :

```bash
git add api/_policy.ts \
  apps/daemon/src/cors.ts apps/daemon/src/cors.test.ts \
  apps/daemon/src/proxy.ts apps/daemon/src/proxy.test.ts \
  apps/daemon/src/vercelProxy.test.ts \
  shared/extapi-hosts.ts vercel.json \
  apps/web/vite.config.ts apps/web/src/data/extapi.test.ts
git commit -m "feat(proxy): route CCData /ccdataapi (daemon durci, Vercel, Vite) + hôte CMC public dans /extapi"
```

- [ ] **Étape 5 : commit 2 — sources et séries de capitalisation** :

```bash
git add apps/web/src/data/mcap.ts \
  apps/web/src/data/cmcMcap.ts apps/web/src/data/cmcMcap.test.ts \
  apps/web/src/data/ccdataMcap.ts apps/web/src/data/ccdataMcap.test.ts \
  apps/web/src/data/mcapCandles.ts apps/web/src/data/mcapCandles.test.ts \
  apps/web/src/data/adapters.ts apps/web/src/data/adapters.test.ts \
  apps/web/src/data/ratio.ts apps/web/src/data/ratio.test.ts \
  apps/web/src/data/synthetic.ts apps/web/src/data/synthetic.test.ts \
  apps/web/src/store/ccdata.ts apps/web/src/store/ccdata.test.ts \
  apps/web/src/store/market.ts apps/web/src/store/market.symbol-source.test.ts \
  apps/web/src/store/mcap.ts apps/web/src/store/mcap.test.ts \
  apps/web/src/store/persist.ts apps/web/src/store/persist.test.ts \
  apps/web/src/store/synthetics.ts apps/web/src/store/synthetics.test.ts \
  apps/web/src/components/PairSearch.tsx apps/web/src/components/SettingsPanel.tsx \
  apps/web/src/components/SymbolBanner.tsx apps/web/src/components/SymbolBanner.test.ts \
  apps/web/src/chart/ChartInstance.tsx apps/web/src/main.tsx
git commit -m "feat(web): séries TOTAL/TOTAL2/TOTAL3 chartables — historique CMC public, replis CCData et CoinGecko, provenance réelle au bandeau"
```

- [ ] **Étape 6 : commit 3 — fenêtre Bitcoin Power Law** :

```bash
git add apps/web/src/components/BtcPowerLawWindow.tsx \
  apps/web/src/data/btcPowerLaw.ts apps/web/src/data/btcPowerLaw.test.ts \
  apps/web/src/store/btcPowerLaw.ts \
  apps/web/src/store/windowManager.ts apps/web/src/store/windowManager.test.ts \
  apps/web/src/commands/windowPanels.ts apps/web/src/commands/windowPanels.couverture.test.ts \
  apps/web/src/App.tsx
git commit -m "feat(web): fenêtre Bitcoin Power Law (BPL) — 39e fenêtre, groupe On-chain & stablecoins"
```

- [ ] **Étape 7 : commit 4 — contrat + gate e2e** :

```bash
git add BUILD-CONTRACT.md apps/web/e2e/gate-v25-cap-dominance.e2e.ts
git commit -m "docs(contrat): exception CAP/BPL actée (39 fenêtres, fournisseurs CMC/CCData) + gate e2e CAP étendu"
```

- [ ] **Étape 8 : vérifier et pousser** — `git status --short` → il ne reste QUE `?? AGENTS.md` et `?? CLAUDE.md` ; `git log --oneline -5` → les 4 commits au-dessus de `19f311e` ; chaque commit passe seul ? Non exigé (le chantier est un tout, la CI de l'étape 1 a validé l'état final) — c'est le découpage LISIBLE qui est visé. Puis `git push origin main` (remote HTTPS vérifié : github.com/ZakiChair/axiom). ⚠️ Piège connu (mémoire Corpus/CV) : vérifier l'auteur avant de pousser — `git log -1 --format='%an <%ae>'` doit être l'identité de Zaki, pas « Akzi CEO Agent » ; sinon `git commit --amend --reset-author` après correction de `git config user.name/user.email` locale.


## Lot A — « Vérité des données du chart » (fragment de plan)

Conventions vérifiées : tests web = Vitest (`pnpm --filter @axiom/web exec vitest run <fichier>`), TS strict `noUncheckedIndexedAccess`, commentaires en français, aucune dépendance nouvelle. Tous les extraits ci-dessous ont été écrits après lecture du code réel aux lignes citées.

---

### Task A.1 : Pane CVD réservé aux sources à split buy/sell

**Constat couvert :** CVD = −Σvolume (faux) sur toute source sans buyVolume/sellVolume (apps/web/src/chart/orderflow.calc.ts:29, haute)

Correctif choisi (le plus honnête, cf. contrat « jamais de pane muet ») : NE PAS créer le pane CVD hors Binance — seule source dont TOUT l'historique porte le split (REST `k[9]` + WS `V`) — et l'indiquer dans le tooltip du bouton Orderflow. En complément, `computeCvd` traite désormais une bougie sans split comme delta 0 (défense en profondeur si un buffer mixte lui parvient). Conséquence assumée : Coinbase perd le pane CVD (il n'était juste qu'en live, faux sur tout l'historique REST).

**Files:**
- Modify: apps/web/src/chart/orderflow.calc.ts:22-35 (computeCvd + nouveau helper)
- Modify: apps/web/src/chart/orderflow.ts:51-59, 404-413 (import + garde createCvdPane)
- Modify: apps/web/src/components/Toolbar.tsx:632-649 (commentaire + tooltip)
- Test: apps/web/src/chart/orderflow.calc.test.ts

**Interfaces:** `export function sourceFournitCvd(exchange: ExchangeId): boolean` (orderflow.calc.ts) — consommée par A.1 uniquement.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/web/src/chart/orderflow.calc.test.ts` (le helper `candle` du fichier pose toujours le split ; on en fabrique un local sans split) :

```ts
describe("computeCvd — bougies SANS split buy/sell (Kraken/OKX/Bybit/HL, hist. Coinbase)", () => {
  it("contribue un delta 0 (CVD plat), pas −volume", () => {
    // Bougie sans buyVolume/sellVolume : avant correctif, buy=0 et sell=volume → −volume cumulé.
    const sansSplit: Candle = {
      time: 1_000, open: 100, high: 110, low: 90, close: 105, volume: 42, closed: true,
    };
    expect(computeCvd([sansSplit, { ...sansSplit, time: 2_000 }])).toEqual([0, 0]);
    // Une bougie AVEC split garde son delta réel.
    expect(computeCvd([candle(1_000, 10, 4)])).toEqual([6]);
  });
});

describe("sourceFournitCvd", () => {
  it("vrai UNIQUEMENT pour binance (seule source au split historique complet)", () => {
    expect(sourceFournitCvd("binance")).toBe(true);
    for (const ex of ["kraken", "okx", "bybit", "hyperliquid", "coinbase", "mexc", "twelvedata", "synthetic"] as const) {
      expect(sourceFournitCvd(ex)).toBe(false);
    }
  });
});
```

et compléter l'import en tête du fichier :

```ts
import { buildCvdSpotPerpBuckets, buildFootprintBar, computeCvd, sourceFournitCvd, type FpCell } from "./orderflow.calc";
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/chart/orderflow.calc.test.ts` → échec attendu : `sourceFournitCvd` n'existe pas (erreur d'import), puis, une fois le helper posé sans corriger computeCvd, `expected [ -42, -84 ] to deeply equal [ 0, 0 ]`.

- [ ] **Étape 3 : implémentation minimale** —

Dans `apps/web/src/chart/orderflow.calc.ts`, élargir l'import de types (ligne 9) :

```ts
import type { Candle, ExchangeId, FootprintBar, FootprintRow } from "@axiom/types";
```

remplacer les lignes 28-29 de `computeCvd` :

```ts
      const buy = c.buyVolume ?? 0;
      const sell = c.sellVolume ?? (c.buyVolume === undefined ? 0 : c.volume - buy);
```

et ajouter après `computeCvd` :

```ts
/**
 * Vrai si la source fournit le split volume acheteur/vendeur (`buyVolume`/`sellVolume`)
 * sur TOUT l'historique de bougies — condition d'un CVD honnête. Seul Binance le porte
 * (REST k[9] « taker buy base volume » + WS `V`) ; les mappers Kraken/OKX/Bybit/
 * Hyperliquid n'en posent aucun, et le backfill REST Coinbase non plus (seules ses
 * bougies agrégées en LIVE l'ont). Plutôt qu'afficher une droite −Σvolume, on NE CRÉE
 * PAS le pane CVD (contrat « jamais de pane muet » : pas de pane vaut mieux qu'un pane
 * mensonger) — même patron de gate que wantCvdSpotPerp côté contrôleur.
 */
export function sourceFournitCvd(exchange: ExchangeId): boolean {
  return exchange === "binance";
}
```

Dans `apps/web/src/chart/orderflow.ts`, ajouter `sourceFournitCvd` à l'import de `./orderflow.calc` (bloc lignes 51-59) et garder `createCvdPane` (ligne 404) :

```ts
  private createCvdPane(): void {
    if (this.cvdPaneId) return;
    // Pas de split buy/sell historique sur cette source → pas de pane CVD (cf.
    // sourceFournitCvd) : le footprint (flux de trades live) reste, lui, disponible.
    if (!sourceFournitCvd(this.store.getState().exchange)) return;
    const cvd = computeCvd(this.store.getState().candles);
    const id = this.chart.createIndicator(
      { name: CVD_NAME, extendData: { cvd }, precision: precisionCvd(cvd) },
      true,
      { id: CVD_PANE_ID }
    );
    this.cvdPaneId = id ?? null;
  }
```

(`refreshCvd` est déjà no-op quand `cvdPaneId` est null : rien d'autre à toucher.)

Dans `apps/web/src/components/Toolbar.tsx`, mettre à jour le commentaire JSX (lignes 632-634) et le tooltip (ligne 648) :

```tsx
      {/* Orderflow (M5) : CVD + footprint, alimenté par le flux de trades de la
          source active. Footprint sur toutes les sources à flux de trades ; pane CVD
          créé UNIQUEMENT sur Binance (seule source au split buy/sell historique). */}
```

```tsx
                isBinance ? "Orderflow" : "Footprint seul — CVD indisponible (pas de volumes buy/sell sur cette source)",
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/chart/orderflow.calc.test.ts src/chart/orderflow.cvd.test.ts` → tous verts (le test resync CVD existant utilise des bougies AVEC split, non affecté).

- [ ] **Étape 5 : commit** — `git add apps/web/src/chart/orderflow.calc.ts apps/web/src/chart/orderflow.calc.test.ts apps/web/src/chart/orderflow.ts apps/web/src/components/Toolbar.tsx && git commit -m "fix(orderflow): pane CVD réservé aux sources à split buy/sell (plus de −Σvolume)"`

---

### Task A.2 : Bougies OKX ≥ 6h alignées UTC (suffixe utc)

**Constat couvert :** Bougies OKX ≥ 6h alignées sur UTC+8, pas UTC (apps/web/src/data/okx.ts:40, haute)

Les DEUX chemins passent par la même table `OKX_BAR` : REST (`fetchKlines`, y compris le resync post-reconnexion ligne 162) et WS (`channel = candle${bar}`, ligne 156). Corriger la table corrige donc tout. Cache : vérifié, `candlesPush`/`candlesGet` (daemon) n'ont AUCUN appelant hors data/daemon.ts, et le buffer marché est purgé à chaque changement d'identité — aucune invalidation à prévoir (cf. avertissements).

**Files:**
- Modify: apps/web/src/data/okx.ts:7-8, 40-53
- Test: apps/web/src/data/newAdapters.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — dans le `describe("okxAdapter.fetchKlines")` de `apps/web/src/data/newAdapters.test.ts`, ajouter :

```ts
  it("demande les bars alignés UTC pour 6h/12h/1d/1w/1M (suffixe utc), pas l'alignement Hong Kong", async () => {
    // OKX v5 : les granularités ≥ 6H SANS suffixe ouvrent à 00:00 UTC+8 (16:00 UTC) —
    // jours décalés de 16 h vs toutes les autres sources du terminal. Variantes "…utc" requises.
    const f = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ code: "0", msg: "", data: [] }) }));
    vi.stubGlobal("fetch", f);
    await okxAdapter.fetchKlines("BTCUSDT", "1d");
    await okxAdapter.fetchKlines("BTCUSDT", "6h");
    await okxAdapter.fetchKlines("BTCUSDT", "1h");
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("bar=1Dutc");
    expect(urls[1]).toContain("bar=6Hutc");
    expect(urls[2]).toContain("bar=1H"); // < 6h : pas de variante utc côté OKX
    expect(urls[2]).not.toContain("utc");
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/newAdapters.test.ts` → `expected 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=300' to contain 'bar=1Dutc'`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/data/okx.ts`, remplacer les entrées ≥ 6h de `OKX_BAR` (lignes 48-52) :

```ts
  "6h": "6Hutc",
  "12h": "12Hutc",
  "1d": "1Dutc",
  "1w": "1Wutc",
  "1M": "1Mutc",
```

et mettre à jour le commentaire d'en-tête (lignes 7-8) :

```ts
 * Timeframes : 1m/5m/15m/30m (minutes minuscules), 1h→1H, 2h→2H, 4h→4H, puis variantes
 *   ALIGNÉES UTC pour ≥ 6h : 6h→6Hutc, 12h→12Hutc, 1d→1Dutc, 1w→1Wutc, 1M→1Mutc
 *   (les bars sans suffixe ouvrent à 00:00 UTC+8 — heure de Hong Kong — chez OKX ;
 *   le canal WS suit la même convention : `candle1Dutc`…).
```

Le WS (`candle${bar}`) et le resync REST héritent automatiquement du bon bar.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/newAdapters.test.ts` → tous verts (les tests existants utilisent `1h`/`1m`, non suffixés).

- [ ] **Étape 5 : commit** — `git add apps/web/src/data/okx.ts apps/web/src/data/newAdapters.test.ts && git commit -m "fix(okx): bars ≥ 6h alignés UTC (suffixe utc) au lieu de l'alignement Hong Kong"`

---

### Task A.3 : Buffer store aligné sur la dataList du chart (fin de la troncature 5 000)

**Constat couvert :** Buffer store tronqué à 5 000 vs dataList chart à 20 000 : indicateurs/CVD décalés après pagination (apps/web/src/store/market.ts:186, haute)

Stratégie retenue (justification en une phrase) : **on supprime la fenêtre glissante de `withCandle`** — tronquer le store sans pouvoir tronquer la dataList de KLineChart casse l'alignement index-par-index dont dépendent tous les indicateurs/CVD/footprint, alors que cette troncature ne libérait de toute façon PAS la mémoire du chart (la dataList n'a jamais été bornée) ; la borne mémoire réelle reste la purge à chaque changement d'identité + le plafond de pagination (`PAGINATION_MAX_CANDLES`, ChartInstance.tsx:852) + la croissance live d'1 bougie/période (négligeable).

**Files:**
- Modify: apps/web/src/store/market.ts:15-20, 176-189
- Test: apps/web/src/store/market.test.ts:45-56

- [ ] **Étape 1 : écrire le test qui échoue** — dans `apps/web/src/store/market.test.ts`, remplacer le test « borne le buffer à une fenêtre glissante… » (lignes 45-56) par :

```ts
  it("ne tronque JAMAIS le buffer : il reste aligné index-par-index avec la dataList du chart", () => {
    // La pagination historique (ChartInstance) pousse les MÊMES bougies dans le store et
    // dans la dataList KLineChart ; une troncature côté store seul décale tous les
    // indicateurs/CVD (mappés par index sur dataList). L'ancienne fenêtre de 5 000 est supprimée.
    const seeded = Array.from({ length: 5000 }, (_, i) => candle(i, i));
    marketStore.setState({ candles: seeded });

    marketStore.getState().upsertCandle(candle(5000, 5000)); // une de plus

    const candles = marketStore.getState().candles;
    expect(candles).toHaveLength(5001); // rien d'évincé
    expect(candles[0]?.time).toBe(0); // la plus ancienne est toujours là
    expect(candles[candles.length - 1]?.time).toBe(5000);
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/market.test.ts` → `expected [ …(5000) ] to have a length of 5001 but got 5000`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/store/market.ts`, supprimer la constante et son commentaire (lignes 15-20) :

```ts
// (supprimé) MAX_CANDLES : la fenêtre glissante côté store désalignait le buffer de la
// dataList KLineChart (jamais tronquée, elle) — cf. commentaire de withCandle.
```

et remplacer `withCandle` (lignes 176-189) :

```ts
/**
 * Calcule le buffer suivant ; `null` signifie tick hors-ordre à ignorer.
 *
 * AUCUNE troncature ici : le buffer doit rester le miroir EXACT de la dataList de
 * KLineChart (indicateurs, CVD et footprint sont mappés index-par-index dessus, cf.
 * chart/indicators.ts). L'ancienne fenêtre glissante de 5 000 désalignait les deux dès
 * la première bougie live après une pagination profonde (dataList à 20 000). La borne
 * mémoire réelle : purge à chaque changement d'identité (setMarket/startDataLoad) +
 * plafond de pagination (ChartInstance) + croissance live d'1 bougie/période.
 */
function withCandle(candles: Candle[], candle: Candle): Candle[] | null {
  const last = candles[candles.length - 1];
  if (last && last.time === candle.time) {
    const next = candles.slice();
    next[next.length - 1] = candle;
    return next;
  }
  if (!last || candle.time > last.time) {
    return [...candles, candle];
  }
  return null;
}
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/market.test.ts src/store/market.factory.test.ts src/store/market.data-load.test.ts src/store/market.symbol-source.test.ts` → tous verts.

- [ ] **Étape 5 : commit** — `git add apps/web/src/store/market.ts apps/web/src/store/market.test.ts && git commit -m "fix(market): plus de troncature du buffer — alignement store/dataList garanti après pagination"`

---

### Task A.4 : Z-score de funding sur de vrais règlements (« 8hour » n'existe pas chez Coinalyze)

**Constat couvert :** Intervalle "8hour" inexistant chez Coinalyze : z-score de funding calculé sur du 5 min (apps/web/src/alerts/runtime.ts:480, haute)

Correctif : la source primaire des règlements devient `histFunding` (data/referentiels.ts:96 — `fapi/v1/fundingRate`, règlements RÉELS, déjà écrit, memoïsé), repli Coinalyze en `"4hour"` sous-échantillonné 1 point sur 2 (≈ cadence 8 h). Et `normalizeInterval` devient bruyant (console.warn) au lieu du repli 5min silencieux. Les parties testables sont les helpers purs (`unPointSurDeux`, `normalizeInterval`) ; le câblage de `chargerFunding` (module privé, imports lourds) est vérifié par typecheck (cf. avertissements).

**Files:**
- Modify: apps/web/src/data/coinalyze.ts:188-193 (+ nouveau helper)
- Modify: apps/web/src/alerts/runtime.ts:476-494 (+ import)
- Test: apps/web/src/data/coinalyze.test.ts

**Interfaces:** `export function normalizeInterval(period: string): CoinalyzeInterval` et `export function unPointSurDeux<T>(points: readonly T[]): T[]` (coinalyze.ts).

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans `apps/web/src/data/coinalyze.test.ts` (importer `normalizeInterval, unPointSurDeux` depuis `./coinalyze` et `vi` depuis vitest) :

```ts
describe("normalizeInterval", () => {
  it("laisse passer un intervalle supporté sans avertir", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeInterval("4hour")).toBe("4hour");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("AVERTIT sur un intervalle inconnu au lieu de replier en silence (le piège « 8hour »)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeInterval("8hour")).toBe("5min"); // repli conservé, mais bruyant
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("unPointSurDeux", () => {
  it("garde un point sur deux EN PARTANT DE LA FIN (le dernier est toujours retenu)", () => {
    // 5 clôtures 4 h : on veut approx. la cadence 8 h en retenant les clôtures paires depuis la fin.
    expect(unPointSurDeux([1, 2, 3, 4, 5])).toEqual([1, 3, 5]);
    expect(unPointSurDeux([1, 2, 3, 4])).toEqual([2, 4]);
    expect(unPointSurDeux([])).toEqual([]);
    expect(unPointSurDeux([7])).toEqual([7]);
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/coinalyze.test.ts` → échec attendu : `normalizeInterval`/`unPointSurDeux` non exportés (erreur d'import).

- [ ] **Étape 3 : implémentation minimale** —

Dans `apps/web/src/data/coinalyze.ts`, remplacer `normalizeInterval` (lignes 188-193) et ajouter le helper :

```ts
/**
 * Valide la période demandée comme intervalle Coinalyze. Un intervalle inconnu replie
 * sur « 5min » mais AVERTIT désormais : le repli silencieux a déjà produit un z-score
 * de funding calculé sur du 5 min (« 8hour » n'existe pas chez Coinalyze). Exporté
 * pour test.
 */
export function normalizeInterval(period: string): CoinalyzeInterval {
  if ((COINALYZE_INTERVALS as readonly string[]).includes(period)) {
    return period as CoinalyzeInterval;
  }
  console.warn(`[AXIOM] intervalle Coinalyze inconnu « ${period} » — repli 5min`);
  return "5min";
}

/**
 * Garde un point sur deux EN PARTANT DE LA FIN (le dernier point est toujours retenu).
 * Sert à approximer une cadence 8 h depuis un historique « 4hour » (Coinalyze n'expose
 * pas d'intervalle 8 h) : chaque clôture retenue tombe sur une frontière de 8 h. PURE.
 */
export function unPointSurDeux<T>(points: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = points.length - 1; i >= 0; i -= 2) {
    const p = points[i];
    if (p !== undefined) out.unshift(p);
  }
  return out;
}
```

Dans `apps/web/src/alerts/runtime.ts`, compléter les imports :

```ts
import { coinalyzeProvider, unPointSurDeux } from "../data/coinalyze";
import { histFunding } from "../data/referentiels";
```

et remplacer le bloc z-score de `chargerFunding` (lignes 476-491) :

```ts
  // 3) Z-score sur les RÈGLEMENTS RÉELS (Binance fapi/v1/fundingRate via histFunding —
  //    cadence 8 h OU 4 h selon le perp, memoïsé). Repli : Coinalyze « 4hour »
  //    sous-échantillonné 1 point sur 2 (≈ cadence 8 h) — « 8hour » N'EXISTE PAS chez
  //    Coinalyze et repliait en silence sur du 5 min : les 30 « règlements » couvraient
  //    ~2 h 30, écart-type ≈ 0, z aberrant.
  let z: number | undefined;
  try {
    let rates = ((await histFunding(symbol)) ?? []).map((p) => p.v);
    if (rates.length === 0) {
      const since = Date.now() - FUNDING_Z_WINDOW * 8 * 3_600_000;
      const hist = await coinalyzeProvider.fetchFundingRateHistory(symbol, "4hour", since);
      rates = unPointSurDeux(hist.map((h) => h.rate)).filter((v) => Number.isFinite(v));
    }
    // Inclut le rate courant s'il n'est pas déjà le dernier point.
    const series =
      rates.length > 0 && rates[rates.length - 1] === rate ? rates : [...rates, rate];
    if (series.length >= Math.min(5, FUNDING_Z_WINDOW)) {
      const win = series.slice(-FUNDING_Z_WINDOW);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
      const sd = Math.sqrt(variance);
      z = sd === 0 ? 0 : (rate - mean) / sd;
    }
  } catch {
    /* z optionnel */
  }
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/coinalyze.test.ts` puis `pnpm --filter @axiom/web exec tsc --noEmit` (vérifie le câblage runtime.ts, non couvert par test unitaire).

- [ ] **Étape 5 : commit** — `git add apps/web/src/data/coinalyze.ts apps/web/src/data/coinalyze.test.ts apps/web/src/alerts/runtime.ts && git commit -m "fix(alerts): z-score funding sur règlements réels — l'intervalle 8hour n'existe pas chez Coinalyze"`

---

### Task A.5 : APR funding — intervalle de règlement réel par venue

**Constat couvert :** Funding cross-exchange : intervalle CEX figé à 8 h alors que nombre de perps règlent en 4 h (apps/web/src/data/fundingCrossExchange.ts:84, moyenne)

Sources vérifiées : OKX `public/funding-rate` porte `fundingTime`/`nextFundingTime` dans la MÊME réponse (0 requête en plus) ; Bybit expose `fundingInterval` (minutes) via `instruments-info` ; Binance expose `fundingIntervalHours` via `fapi/v1/fundingInfo` (liste des seuls perps HORS cadence 8 h — absent = 8 h), même hôte `extUrl` que `premiumIndex`. Repli sur 8 h si l'info manque (best-effort).

**Files:**
- Modify: apps/web/src/data/fundingCrossExchange.ts:64-124
- Test: apps/web/src/data/fundingCrossExchange.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans `apps/web/src/data/fundingCrossExchange.test.ts` (compléter l'import avec les 3 parsers) :

```ts
describe("parsers d'intervalle de funding (heures)", () => {
  it("OKX : nextFundingTime − fundingTime de la même réponse funding-rate", () => {
    const h4 = { data: [{ fundingRate: "0.0001", fundingTime: "1700000000000", nextFundingTime: "1700014400000" }] };
    expect(parseOkxFundingIntervalH(h4)).toBe(4); // 4 h exactes
    expect(parseOkxFundingIntervalH({ data: [{ fundingRate: "0.0001" }] })).toBeNull(); // champs absents
    expect(parseOkxFundingIntervalH({ data: [{ fundingTime: "2", nextFundingTime: "1" }] })).toBeNull(); // incohérent
  });

  it("Bybit : fundingInterval (minutes) d'instruments-info converti en heures", () => {
    expect(parseBybitFundingIntervalH({ result: { list: [{ fundingInterval: 240 }] } })).toBe(4);
    expect(parseBybitFundingIntervalH({ result: { list: [{ fundingInterval: 480 }] } })).toBe(8);
    expect(parseBybitFundingIntervalH({ result: { list: [] } })).toBeNull();
  });

  it("Binance : fundingIntervalHours de fundingInfo (liste des perps HORS 8 h ; absent = null → défaut 8)", () => {
    const info = [{ symbol: "PUMPUSDT", fundingIntervalHours: 4 }];
    expect(parseBinanceFundingIntervalH(info, "PUMPUSDT")).toBe(4);
    expect(parseBinanceFundingIntervalH(info, "BTCUSDT")).toBeNull(); // absent = cadence standard 8 h
    expect(parseBinanceFundingIntervalH({}, "BTCUSDT")).toBeNull(); // réponse inattendue
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/fundingCrossExchange.test.ts` → échec attendu : parsers non exportés (erreur d'import).

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/data/fundingCrossExchange.ts` :

Ajouter après `parseHyperliquidFunding` (ligne 80) :

```ts
// ─────────────────────────── Parsers PURS d'INTERVALLE de règlement (heures) ───────────────────────────
// Depuis 2023-2024, nombre de perps USDT Binance/Bybit (et certains OKX) règlent toutes
// les 4 h (voire moins) : figer 8 h fausse l'APR d'un facteur 2 — et donc la divergence
// CEX vs DEX, le signal recherché. On dérive l'intervalle réel par venue, repli 8 h.

/** OKX public/funding-rate → intervalle en heures (nextFundingTime − fundingTime), ou null. */
export function parseOkxFundingIntervalH(json: unknown): number | null {
  const d = (json as { data?: Array<{ fundingTime?: unknown; nextFundingTime?: unknown }> })?.data?.[0];
  const cur = Number(d?.fundingTime);
  const next = Number(d?.nextFundingTime);
  if (!Number.isFinite(cur) || !Number.isFinite(next) || next <= cur) return null;
  const h = Math.round((next - cur) / 3_600_000);
  return h > 0 && h <= 24 ? h : null;
}

/** Bybit v5 instruments-info (linear) → fundingInterval (minutes) converti en heures, ou null. */
export function parseBybitFundingIntervalH(json: unknown): number | null {
  const list = (json as { result?: { list?: Array<{ fundingInterval?: unknown }> } })?.result?.list;
  const min = Number(list?.[0]?.fundingInterval);
  if (!Number.isFinite(min) || min <= 0) return null;
  return min / 60;
}

/** Binance fapi/v1/fundingInfo → fundingIntervalHours du symbole (liste des perps HORS 8 h), ou null. */
export function parseBinanceFundingIntervalH(json: unknown, symbol: string): number | null {
  if (!Array.isArray(json)) return null;
  for (const item of json) {
    const o = item as { symbol?: unknown; fundingIntervalHours?: unknown };
    if (o?.symbol === symbol) {
      const h = Number(o.fundingIntervalHours);
      return Number.isFinite(h) && h > 0 ? h : null;
    }
  }
  return null;
}
```

Remplacer la constante ligne 84 et les trois fetchers CEX (lignes 93-109) :

```ts
/** Cadence STANDARD de règlement CEX : défaut quand l'intervalle réel est indisponible. */
const CEX_INTERVAL_H = 8;
const HL_INTERVAL_H = 1;
```

```ts
async function fetchBinance(base: string): Promise<FundingVenue | null> {
  const json = await jsonDirect(extUrl("fapi.binance.com", `fapi/v1/premiumIndex?symbol=${base}USDT`));
  const rate = parseBinanceFunding(json);
  if (rate === null) return null;
  // Intervalle réel : fundingInfo ne liste QUE les perps hors cadence 8 h. Best-effort.
  let intervalH = CEX_INTERVAL_H;
  try {
    const info = await jsonDirect(extUrl("fapi.binance.com", "fapi/v1/fundingInfo"));
    intervalH = parseBinanceFundingIntervalH(info, `${base}USDT`) ?? CEX_INTERVAL_H;
  } catch {
    /* best-effort : cadence standard */
  }
  return venue("binance", "Binance", rate, intervalH);
}

async function fetchBybit(base: string): Promise<FundingVenue | null> {
  const json = await jsonDirect(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${base}USDT`);
  const rate = parseBybitFunding(json);
  if (rate === null) return null;
  let intervalH = CEX_INTERVAL_H;
  try {
    const info = await jsonDirect(
      `https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${base}USDT`,
    );
    intervalH = parseBybitFundingIntervalH(info) ?? CEX_INTERVAL_H;
  } catch {
    /* best-effort : cadence standard */
  }
  return venue("bybit", "Bybit", rate, intervalH);
}

async function fetchOkx(base: string): Promise<FundingVenue | null> {
  const json = await jsonDirect(`https://www.okx.com/api/v5/public/funding-rate?instId=${base}-USDT-SWAP`);
  const rate = parseOkxFunding(json);
  if (rate === null) return null;
  // fundingTime/nextFundingTime sont dans la MÊME réponse : aucune requête en plus.
  return venue("okx", "OKX", rate, parseOkxFundingIntervalH(json) ?? CEX_INTERVAL_H);
}
```

Mettre à jour le ⚠️ d'en-tête (ligne 5) : `Binance/Bybit/OKX règlent en 8 h STANDARD mais nombre de perps sont passés en 4 h (voire moins) — l'intervalle est dérivé par venue, Hyperliquid reste 1 h.`

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/fundingCrossExchange.test.ts` → tous verts (les tests existants d'`annualiserFunding`/parsers de taux sont inchangés).

- [ ] **Étape 5 : commit** — `git add apps/web/src/data/fundingCrossExchange.ts apps/web/src/data/fundingCrossExchange.test.ts && git commit -m "fix(funding-x): intervalle de règlement réel par venue — APR juste sur les perps 4 h"`

---

### Task A.6 : Resync REST dès la PREMIÈRE ouverture WS (raccord backfill→live)

**Constat couvert :** Raccord backfill→1er WS : bougies clôturées pendant la fenêtre de connexion jamais comblées (apps/web/src/data/wsLoop.ts:118, moyenne)

Correctif : `onReconnected` est appelé à CHAQUE connexion établie, première incluse. Sûr car : (1) les adaptateurs ne le passent QUE sur les flux kline (jamais trades) ; (2) côté ChartInstance, `subscribeKline` n'est appelé qu'APRÈS le commit du backfill (ligne 932) et `onResync` est gardé par `isMarketDataReady` + `prepareResyncApply` (fusion idempotente). Coût : un re-fetch REST (≤ 300 bougies) par souscription kline.

**Files:**
- Modify: apps/web/src/data/wsLoop.ts:12-14, 37, 105-119
- Test: apps/web/src/data/wsLoop.test.ts:55-88

- [ ] **Étape 1 : écrire le test qui échoue** — dans `apps/web/src/data/wsLoop.test.ts`, remplacer le premier test (lignes 56-65) par :

```ts
  it("appelle onOpen ET onReconnected (resync) dès la 1re connexion — raccord backfill→WS", () => {
    // Des bougies peuvent clôturer entre l'instantané REST du backfill et le premier
    // message WS (systématique en 1s) : le resync doit aussi couvrir la 1re connexion.
    const onOpen = vi.fn();
    const onReconnected = vi.fn();
    connectWsLoop({ url: "wss://x", source: "test", onMessage: () => true, onOpen, onReconnected });

    expect(MockWebSocket.instances).toHaveLength(1);
    dernière().déclencherOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });
```

et dans le 2e test (ligne 81), corriger l'attendu : la reconnexion est le DEUXIÈME appel :

```ts
    dernière().déclencherOpen();
    expect(onReconnected).toHaveBeenCalledTimes(2); // 1re connexion + RE-connexion
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/wsLoop.test.ts` → `expected "spy" to be called 1 times, but got 0 times`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/data/wsLoop.ts`, remplacer les lignes 105-119 (`socket.onopen`) :

```ts
    socket.onopen = () => {
      hasConnected = true;
      lastMessageTs = Date.now();
      healthStore.getState().setEtat(o.source, "connected", { dernierMessageTs: lastMessageTs });
      o.onOpen?.(socket);
      // Backoff : AUCUN reset ici (anti-flap). Reset programmé après stableResetMs
      // de connexion maintenue — couvre le cas « connexion stable mais silencieuse ».
      clearStable();
      stableTimer = setTimeout(() => {
        attempt = 0;
      }, stableResetMs);
      armWatchdog();
      // Resync REST à CHAQUE connexion établie, PREMIÈRE INCLUSE : des bougies peuvent
      // clôturer entre l'instantané REST du backfill et le premier message WS (trou
      // systématique en 1s, ~1 chargement/60 en 1m). Les flux trades ne passent jamais
      // ce callback ; côté kline, la fusion (prepareResyncApply) est idempotente.
      o.onReconnected?.();
    };
```

(la variable locale `hasConnected` reste utilisée nulle part ailleurs pour le resync — la garder telle quelle, elle ne sert plus qu'à documenter l'état ; si `tsc` signale une écriture jamais lue, la supprimer avec sa déclaration ligne 64). Mettre à jour la doc : en-tête lignes 12-14 →

```ts
 *  - Resync : `onReconnected` est appelé après CHAQUE connexion établie, première
 *    incluse (raccord backfill→1er message WS) — les flux kline y déclenchent leur
 *    resync REST ; les flux trades ne fournissent pas ce callback.
```

et le doc de l'option ligne 37 →

```ts
  /** Appelé après CHAQUE connexion établie (première incluse) → resync REST kline. */
```

Enfin, ajuster le commentaire d'en-tête du test (`wsLoop.test.ts` ligne 6) : `onReconnected dès la 1re connexion (raccord backfill→WS)`.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/wsLoop.test.ts` → 5 tests verts (backoff/watchdog/unsubscribe inchangés).

- [ ] **Étape 5 : commit** — `git add apps/web/src/data/wsLoop.ts apps/web/src/data/wsLoop.test.ts && git commit -m "fix(ws): resync REST dès la première connexion — plus de trou backfill→premier message"`

---

### Task A.7 : Footprint — colonnes approchées sur l'historique (étiquetées ≈) + tickSize hors Binance

**Constat couvert :** Footprint jamais amorcé depuis l'historique, sans état vide — défaut § 3.5 de la revue 2026-08-01 (apps/web/src/chart/orderflow.ts:807, moyenne). **Étape 6 supplémentaire** : constat trivial même fichier « tickSize toujours résolu via Binance exchangeInfo » (orderflow.ts:617, basse).

Correctif retenu (option riche du constat) : réutiliser `rowsApprochees` (déjà employé par l'overlay OCN, orderflow.ts:892) pour dessiner des colonnes APPROCHÉES sur les bougies jamais vues en live — atténuées, delta préfixé « ≈ », SANS POC/VA/imbalances/divergences (une répartition uniforme ne porte aucun signal de niveau) ; les ticks réels reprennent la main dès qu'ils existent.

**Files:**
- Modify: apps/web/src/chart/orderflow.calc.ts (nouveau helper)
- Modify: apps/web/src/chart/orderflow.ts:614-626, 804-857, 919-1049
- Test: apps/web/src/chart/orderflow.calc.test.ts

**Interfaces:** `export function buildFootprintBarApprochee(time: number, candle: Pick<Candle, "low" | "high" | "volume" | "buyVolume" | "sellVolume">, bucketSize: number): FootprintBar | null` (orderflow.calc.ts).

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans `apps/web/src/chart/orderflow.calc.test.ts` (compléter l'import avec `buildFootprintBarApprochee`) :

```ts
describe("buildFootprintBarApprochee", () => {
  it("répartit l'OHLCV uniformément sur la plage et conserve le delta de bougie", () => {
    // low 100 → high 102, bucket 1 : 3 niveaux ; buy 6 / sell 3 répartis uniformément.
    const bar = buildFootprintBarApprochee(1_000, { low: 100, high: 102, volume: 9, buyVolume: 6, sellVolume: 3 }, 1);
    expect(bar).not.toBeNull();
    expect(bar!.rows.map((r) => r.price)).toEqual([100, 101, 102]);
    expect(bar!.delta).toBeCloseTo(3, 10); // Σ(buy − sell) = 6 − 3
    expect(bar!.rows[0]?.buyVol).toBeCloseTo(2, 10); // 6 / 3 niveaux
  });

  it("sans split buy/sell, répartit 50/50 (delta 0) — approximation assumée", () => {
    const bar = buildFootprintBarApprochee(1_000, { low: 100, high: 100.5, volume: 8 }, 1);
    expect(bar).not.toBeNull();
    expect(bar!.delta).toBeCloseTo(0, 10);
  });

  it("renvoie null pour une bougie sans volume (rien à dessiner)", () => {
    expect(buildFootprintBarApprochee(1_000, { low: 100, high: 102, volume: 0 }, 1)).toBeNull();
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/chart/orderflow.calc.test.ts` → échec : `buildFootprintBarApprochee` non exportée.

- [ ] **Étape 3 : implémentation minimale (calc)** — dans `apps/web/src/chart/orderflow.calc.ts`, ajouter l'import et le helper :

```ts
import { rowsApprochees } from "./openCloseNet.calc";
```

```ts
/**
 * FootprintBar APPROCHÉ d'une bougie jamais vue en live : répartition uniforme de
 * l'OHLCV sur la plage (rowsApprochees — déjà utilisé par l'overlay OCN). Renvoie null
 * si la bougie est inexploitable (volume nul). L'appelant DOIT étiqueter le résultat
 * « ≈ » : ce n'est PAS un footprint tick réel — sans quoi, en 4h/1d, le footprint
 * activé restait invisible pendant des heures (revue 2026-08-01 § 3.5).
 */
export function buildFootprintBarApprochee(
  time: number,
  candle: Pick<Candle, "low" | "high" | "volume" | "buyVolume" | "sellVolume">,
  bucketSize: number
): FootprintBar | null {
  const rows = rowsApprochees(candle, bucketSize);
  if (rows.length === 0) return null;
  const cells = new Map<number, FpCell>();
  for (const r of rows) cells.set(Math.round(r.price / bucketSize), { buy: r.buyVol, sell: r.sellVol });
  return buildFootprintBar(time, cells, bucketSize);
}
```

Puis relancer l'étape 2 → vert côté calc.

- [ ] **Étape 4 : câblage rendu (orderflow.ts)** — ajouter `buildFootprintBarApprochee` à l'import de `./orderflow.calc`, puis :

(a) remplacer la boucle de collecte (lignes 800-817) :

```ts
    const visibleCandles: Candle[] = [];
    const visibleBars: FootprintBar[] = [];
    const barPositions: { xc: number; colW: number }[] = [];
    const approxFlags: boolean[] = [];

    for (let i = start; i < end; i++) {
      const kd: KLineData | undefined = dataList[i];
      if (kd === undefined) continue;
      const xc = this.toPx({ timestamp: kd.timestamp }).x;
      if (xc === undefined) continue;
      const candle = candles[i];
      if (candle === undefined) continue;
      const cells = this.footprints.get(kd.timestamp);
      let bar: FootprintBar | null;
      let approx = false;
      if (cells !== undefined && cells.size > 0) {
        bar = buildFootprintBar(kd.timestamp, cells, this.bucketSize);
      } else {
        // Bougie jamais vue en live : colonne APPROCHÉE depuis l'OHLCV, étiquetée « ≈ ».
        bar = buildFootprintBarApprochee(kd.timestamp, candle, this.bucketSize);
        approx = true;
      }
      if (bar === null) continue;
      visibleCandles.push(candle);
      visibleBars.push(bar);
      barPositions.push({ xc, colW });
      approxFlags.push(approx);
    }
```

(b) après le calcul de `divergences` (lignes 820-823), neutraliser les colonnes approchées :

```ts
    // Une colonne approchée (répartition uniforme) ne porte aucun signal de delta réel :
    // ni divergence ni imbalance n'y sont évaluées.
    for (let i = 0; i < approxFlags.length; i++) {
      if (approxFlags[i] === true) divergences[i] = null;
    }
```

(c) dans la boucle de dessin (lignes 831-857), lire le drapeau et le propager :

```ts
      const approx = approxFlags[i] === true;
      // Imbalances : uniquement sur les colonnes à ticks réels.
      const imbFlags =
        !approx && settings.showImbalances
          ? detectImbalances(bar.rows, settings.imbalanceRatioPct, settings.imbalanceMinVol)
          : null;

      this.drawColumn(
        bar,
        pos.xc,
        pos.colW,
        rowH,
        yOf,
        top,
        height,
        palette,
        imbPalette,
        imbFlags,
        settings.showBarPoc && !approx, // POC/VA d'une répartition uniforme = arbitraire
        settings.showBarVa && !approx,
        divergences[i],
        approx
      );
```

(d) dans `drawColumn` (ligne 919), ajouter le paramètre final `approx: boolean` et deux retouches :

```ts
      const alpha = (0.12 + 0.5 * intensity) * (approx ? 0.55 : 1); // colonnes ≈ atténuées
```

et le libellé de delta (lignes 1021-1026) :

```ts
    if (colW >= 22) {
      ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
      ctx.textAlign = "center";
      if (approx) {
        // Approximation : delta en teinte neutre, préfixé ≈ (jamais présenté comme réel).
        ctx.fillStyle = palette.textDim;
        ctx.fillText(`≈${fmtDelta(bar.delta)}`, xc, paneTop + 8);
      } else {
        ctx.fillStyle = bar.delta >= 0 ? palette.up : palette.down;
        ctx.fillText(fmtDelta(bar.delta), xc, paneTop + 8);
      }
    }
```

- [ ] **Étape 5 : tickSize hors Binance (constat basse regroupé)** — remplacer `resolveTick` (lignes 614-626) :

```ts
  /** Résout le tickSize (REST Binance) puis dimensionne le bucket (repli si échec). */
  private async resolveTick(): Promise<void> {
    if (this.tickResolved) return;
    if (this.store.getState().exchange !== "binance") {
      // fetchSymbolInfo interroge l'exchangeInfo BINANCE : sur toute autre source l'appel
      // est voué au 400 (symbole absent) ou renverrait le pas Binance, pas celui de la
      // venue affichée → repli direct sur la magnitude, sans requête inutile.
      const last = this.store.getState().candles.at(-1);
      this.tickSize = fallbackTick(last?.close ?? 0);
    } else {
      try {
        const meta = await fetchSymbolInfo(this.symbol);
        this.tickSize = meta.tickSize;
      } catch (err) {
        const last = this.store.getState().candles.at(-1);
        this.tickSize = fallbackTick(last?.close ?? 0);
        console.warn("[AXIOM] tickSize indisponible, repli sur la magnitude", err);
      }
    }
    this.tickResolved = true;
    this.recomputeBucket();
  }
```

- [ ] **Étape 6 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/chart/orderflow.calc.test.ts src/chart/orderflow.cvd.test.ts src/chart/footprintAnalytics.test.ts src/chart/openCloseNet.calc.test.ts` puis `pnpm --filter @axiom/web exec tsc --noEmit` (le rendu Canvas n'est pas testé unitairement, comme le reste de render()).

- [ ] **Étape 7 : commit** — `git add apps/web/src/chart/orderflow.calc.ts apps/web/src/chart/orderflow.calc.test.ts apps/web/src/chart/orderflow.ts && git commit -m "fix(footprint): colonnes approchées ≈ sur l'historique + tickSize sans appel Binance hors Binance"`

---

### Task A.8 : Filet de hauteur étendu aux panes hors contrôleur (CVD, CVD S/P, OI, funding, comparaison)

**Constat couvert :** Le filet de hauteur du pane prix ignore les panes non-@axiom (apps/web/src/chart/indicators.ts:484, moyenne)

Les 5 ids sont déterministes et vérifiés dans le code : `axiom_orderflow_cvd`, `axiom_orderflow_cvd_sp` (orderflow.ts:64/68), `axiom_deriv_oi`, `axiom_deriv_funding` (derivatives.ts:33/41), `axiom_compare` (compare.ts:51). On les sonde via `getSize` (null quand le pane n'existe pas) et on les intègre au rognage ET à la hauteur utile — la capacité publiée (`paneMax`) en tient compte automatiquement.

**Files:**
- Modify: apps/web/src/chart/indicators.ts:480-506
- Test: apps/web/src/chart/indicators.hauteurs.test.ts (nouveau, harnais copié d'indicators.symbolSwitch.test.ts)

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/src/chart/indicators.hauteurs.test.ts` :

```ts
/**
 * Filet de hauteur (equilibrerHauteurs) : les panes créés HORS du contrôleur
 * d'indicateurs (CVD, CVD S/P, OI, funding, comparaison — ids déterministes) doivent
 * entrer dans le budget, sinon 5 panes annexes écrasent le pane prix sans que le filet
 * ne voie rien (même symptôme que le « pane prix à 4 px » de la revue § 3.4). Harnais
 * calqué sur indicators.symbolSwitch.test.ts (chart mocké, aucun DOM).
 */
import { describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { ChartIndicators } from "./indicators";

vi.mock("klinecharts", () => ({
  registerIndicator: () => {},
  registerOverlay: () => {},
  IndicatorSeries: { Normal: "normal", Price: "price", Volume: "volume" },
}));

describe("equilibrerHauteurs — panes hors contrôleur", () => {
  it("rogne les panes annexes (CVD/OI/funding/…) quand le pane prix est étouffé", () => {
    // 5 panes annexes à 100 px + prix à 100 px : utile 600, budget 330 → rognage attendu.
    const tailles: Record<string, { height: number }> = {
      candle_pane: { height: 100 },
      axiom_orderflow_cvd: { height: 100 },
      axiom_orderflow_cvd_sp: { height: 100 },
      axiom_deriv_oi: { height: 100 },
      axiom_deriv_funding: { height: 100 },
      axiom_compare: { height: 100 },
    };
    const chart = {
      createIndicator: vi.fn(() => null),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
      getSize: vi.fn((paneId: string) => tailles[paneId] ?? null),
      setPaneOptions: vi.fn(),
    };
    const indicators = new ChartIndicators(chart as unknown as Chart);

    indicators.rafraichirHauteurs();

    // AVANT correctif : aucune instance @axiom active → hauteurs=[] → filet aveugle.
    expect(chart.setPaneOptions).toHaveBeenCalled();
    for (const call of chart.setPaneOptions.mock.calls) {
      const opts = call[0] as { id: string; height: number };
      expect(Object.keys(tailles)).toContain(opts.id);
      expect(opts.height).toBeLessThan(100); // rogné
      expect(opts.height).toBeGreaterThanOrEqual(60); // jamais sous le plancher
    }
  });

  it("ne touche à rien quand aucun pane annexe n'existe (getSize → null)", () => {
    const chart = {
      createIndicator: vi.fn(() => null),
      overrideIndicator: vi.fn(),
      removeIndicator: vi.fn(),
      getSize: vi.fn((paneId: string) => (paneId === "candle_pane" ? { height: 400 } : null)),
      setPaneOptions: vi.fn(),
    };
    const indicators = new ChartIndicators(chart as unknown as Chart);
    indicators.rafraichirHauteurs();
    expect(chart.setPaneOptions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/chart/indicators.hauteurs.test.ts` → `expected "spy" to be called at least once` (le filet ne voit rien).

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/chart/indicators.ts`, ajouter au niveau module (près de `CANDLE_PANE_ID`) :

```ts
/**
 * Panes séparés créés HORS de ce contrôleur (OrderflowController, DerivativesChart-
 * Controller, CompareController) : créés sans minHeight ni budget, ils échappaient au
 * filet de hauteur — 5 panes annexes suffisaient à écraser le pane prix sans que le
 * filet ne voie rien à corriger. Ids déterministes, miroir des constantes de leurs
 * modules (orderflow.ts, derivatives.ts, compare.ts).
 */
const PANES_HORS_CONTROLEUR: readonly string[] = [
  "axiom_orderflow_cvd",
  "axiom_orderflow_cvd_sp",
  "axiom_deriv_oi",
  "axiom_deriv_funding",
  "axiom_compare",
];
```

et dans `equilibrerHauteurs` (après la construction de `separes`, lignes 484-486) :

```ts
    const separes = [...new Set([...this.active.values()].map((i) => i.paneId))].filter(
      (paneId) => paneId !== CANDLE_PANE_ID
    );
    // Panes annexes réellement montés (getSize → null quand le pane n'existe pas) :
    // ils consomment la même hauteur que les panes @axiom et entrent au même budget.
    for (const paneId of PANES_HORS_CONTROLEUR) {
      if (!separes.includes(paneId) && (this.chart.getSize(paneId)?.height ?? 0) > 0) {
        separes.push(paneId);
      }
    }
```

(le reste de la fonction — mesure, `paneMax`, `hauteursCorrigees`, `setPaneOptions` — est déjà générique sur `separes`).

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/chart/indicators.hauteurs.test.ts src/chart/indicators.symbolSwitch.test.ts src/chart/indicators.aux.test.ts src/chart/indicators.throttle.test.ts src/chart/paneBudget.test.ts` → tous verts (les harnais existants renvoient une taille pour TOUT paneId, donc les panes annexes y « existent » : leurs assertions ne portent que sur create/override, non affectées ; si un test existant échoue sur un setPaneOptions inattendu, restreindre son mock `getSize` aux panes réellement créés plutôt que d'affaiblir le filet).

- [ ] **Étape 5 : commit** — `git add apps/web/src/chart/indicators.ts apps/web/src/chart/indicators.hauteurs.test.ts && git commit -m "fix(chart): le filet de hauteur compte aussi les panes CVD/OI/funding/comparaison"`

---

### Task A.9 : ecoMarkers — rejeu sur contexte (Lot D1) + retrait multi-slots (patron tradeMarkers)

**Constat couvert :** ecoMarkers : garde de rejeu périmée depuis le Lot D1 + duplication entre slots au changement de focus (apps/web/src/chart/ecoMarkers.ts:169, moyenne)

On aligne sur le patron déjà appliqué à tradeMarkers : suivi des overlays PAR INSTANCE (`retirerMarqueursSuivis`, exporté et testé par tradeMarkers) et rejeu sur changement du CONTEXTE (focus, symbole, source, axe prêt) — plus jamais sur l'identité d'instance seule, fausse depuis que l'instance KLineChart survit aux changements de symbole/TF (effet MONTAGE deps [slot], ChartInstance).

**Files:**
- Modify: apps/web/src/chart/ecoMarkers.ts:7-17, 100-124, 148-170
- Test: apps/web/src/chart/ecoMarkers.test.ts

**Interfaces:** `export function doitRejouerEco(prev: ContexteRejeuEco, next: ContexteRejeuEco): boolean` + `export interface ContexteRejeuEco { chart: unknown; symbol: string; exchange: string; ready: boolean }` (ecoMarkers.ts).

- [ ] **Étape 1 : écrire le test qui échoue** — dans `apps/web/src/chart/ecoMarkers.test.ts` : (a) compléter les mocks du haut de fichier (ecoMarkers importera tradeMarkers, qui lit theme/market) :

```ts
vi.mock("../store/theme", () => ({
  themeStore: { getState: () => ({ theme: "dark" }), subscribe: () => () => {} },
}));
vi.mock("../store/market", () => ({
  marketStore: {
    getState: () => ({ candles: [], symbol: "BTCUSDT", exchange: "binance" }),
    subscribe: () => () => {},
  },
}));
```

(remplacer le mock `../store/market` existant par celui-ci) ; (b) compléter l'import :

```ts
import { typeEvenementDe, doitRejouerEco, type ContexteRejeuEco } from "./ecoMarkers";
```

(c) ajouter :

```ts
describe("doitRejouerEco — garde de rejeu (post-Lot D1)", () => {
  const base: ContexteRejeuEco = { chart: { id: 1 }, symbol: "BTCUSDT", exchange: "binance", ready: true };

  it("rejoue quand le SYMBOLE change sur la MÊME instance (l'instance survit au changement d'actif)", () => {
    expect(doitRejouerEco(base, { ...base, symbol: "ETHUSDT" })).toBe(true);
  });

  it("rejoue quand l'axe temps devient prêt (fin du backfill) ou quand le focus change", () => {
    expect(doitRejouerEco({ ...base, ready: false }, base)).toBe(true);
    expect(doitRejouerEco(base, { ...base, chart: { id: 2 } })).toBe(true);
    expect(doitRejouerEco(base, { ...base, exchange: "kraken" })).toBe(true);
  });

  it("ne rejoue PAS sur un simple tick (contexte identique)", () => {
    expect(doitRejouerEco(base, { ...base })).toBe(false);
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/chart/ecoMarkers.test.ts` → échec : `doitRejouerEco` non exportée.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/chart/ecoMarkers.ts` :

(a) ajouter l'import (aucun cycle : tradeMarkers n'importe pas ecoMarkers) :

```ts
import { retirerMarqueursSuivis, type CibleMarqueurs } from "./tradeMarkers";
```

(b) remplacer `let boundChart …` (ligne 103) par :

```ts
/** Instances portant ACTUELLEMENT des marqueurs éco (ids posés par instance). En grille
 *  multi-chart, le retrait doit viser TOUTES ces instances, pas le seul focus courant —
 *  patron overlaysSuivis de tradeMarkers (sinon marqueurs orphelins + duplication). */
const overlaysSuivis = new Map<CibleMarqueurs, string[]>();

/** Contexte dont TOUT changement rejoue les marqueurs. L'identité d'instance ne suffit
 *  plus : depuis le Lot D1, l'instance KLineChart SURVIT aux changements de symbole/TF. */
export interface ContexteRejeuEco {
  chart: unknown;
  symbol: string;
  exchange: string;
  ready: boolean;
}

/** PURE : vrai si le contexte a changé (focus, actif, source, axe temps prêt). */
export function doitRejouerEco(prev: ContexteRejeuEco, next: ContexteRejeuEco): boolean {
  return (
    prev.chart !== next.chart ||
    prev.symbol !== next.symbol ||
    prev.exchange !== next.exchange ||
    prev.ready !== next.ready
  );
}
```

(c) dans `redraw()` (lignes 114-150) : remplacer les lignes 116-120 (`boundChart = chart; … chart.removeOverlay({ name: ECO_MARKER });`) par :

```ts
  // Retire d'abord les marqueurs de TOUTES les instances qui en portaient (focus ou non).
  retirerMarqueursSuivis(overlaysSuivis);

  const chart = getActiveChart();
  if (chart === null) return;
```

et collecter les ids à la création (fin de la boucle, lignes 141-149) :

```ts
  const idsPoses: string[] = [];
  for (const ev of marqueurs(events)) {
    // … (corps existant inchangé jusqu'à `const overlay: OverlayCreate = {…}`) …
    const id = chart.createOverlay(overlay);
    if (typeof id === "string") idsPoses.push(id);
  }
  if (idsPoses.length > 0) overlaysSuivis.set(chart, idsPoses);
```

(d) remplacer l'abonnement marketStore (lignes 165-170) :

```ts
  // Rejeu au changement de CONTEXTE (focus, symbole, source, axe prêt) — plus sur la
  // seule identité d'instance : l'instance survit au changement de symbole/TF (Lot D1),
  // et le premier redraw pendant le backfill figeait l'ancien boundChart (marqueurs
  // jamais posés en mono-chart, suffixes de stats de l'ANCIEN symbole conservés).
  let prev: ContexteRejeuEco = {
    chart: getActiveChart(),
    symbol: marketStore.getState().symbol,
    exchange: marketStore.getState().exchange,
    ready: marketStore.getState().candles.length > 0,
  };
  marketStore.subscribe(() => {
    const s = marketStore.getState();
    const next: ContexteRejeuEco = {
      chart: getActiveChart(),
      symbol: s.symbol,
      exchange: s.exchange,
      ready: s.candles.length > 0,
    };
    if (doitRejouerEco(prev, next)) {
      prev = next;
      redraw();
    }
  });
```

(e) mettre à jour l'en-tête du module (lignes 7-13) : le contrôleur reste singleton mais rejoue « au changement de contexte (focus/symbole/source/axe prêt) et retire ses overlays sur toutes les instances suivies (patron tradeMarkers) » — supprimer la phrase « le chart est recréé par Chart.tsx à chaque changement symbole/TF », fausse depuis le Lot D1.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/chart/ecoMarkers.test.ts src/chart/tradeMarkers.test.ts` → tous verts.

- [ ] **Étape 5 : commit** — `git add apps/web/src/chart/ecoMarkers.ts apps/web/src/chart/ecoMarkers.test.ts && git commit -m "fix(eco): rejeu des marqueurs sur contexte (Lot D1) et retrait multi-slots — patron tradeMarkers"`

---

### Task A.10 : Plafond journalier Twelve Data réellement appliqué

**Constat couvert :** Plafond journalier Twelve Data (800 crédits) affiché mais jamais appliqué (apps/web/src/data/twelvedata.ts:147, moyenne)

Correctif : `acquireSlot` refuse EXPLICITEMENT tout crédit quand le compteur du jour UTC (déjà persisté par `bumpDailyCount`) atteint `DAILY_LIMIT`, et marque la source en erreur dans le healthStore. Dégradation vérifiée dans le code appelant : le chart ressert son cache périmé (`cachedSeries`), la watchlist passe en erreur, et `pollLoop` espace les tentatives (backoff) — plus de martèlement silencieux jusqu'à minuit UTC.

**Files:**
- Modify: apps/web/src/data/twelvedata.ts:102-170
- Test: apps/web/src/data/twelvedata.test.ts

**Interfaces:** `export function quotaJourEpuise(stored: DailyUsage | null, now: Date, limite?: number): boolean` (twelvedata.ts).

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans `apps/web/src/data/twelvedata.test.ts` (compléter l'import avec `quotaJourEpuise`) :

```ts
describe("quotaJourEpuise (plafond ~800 crédits/jour)", () => {
  const now = new Date("2026-07-01T12:00:00Z");

  it("vrai quand le compteur du MÊME jour UTC atteint la limite", () => {
    expect(quotaJourEpuise({ jour: "2026-07-01", count: 800 }, now)).toBe(true);
    expect(quotaJourEpuise({ jour: "2026-07-01", count: 799 }, now)).toBe(false);
  });

  it("faux sans compteur, ou pour un compteur d'un AUTRE jour UTC (reset minuit UTC)", () => {
    expect(quotaJourEpuise(null, now)).toBe(false);
    expect(quotaJourEpuise({ jour: "2026-06-30", count: 800 }, now)).toBe(false);
  });
});

describe("plafond journalier appliqué (acquireSlot)", () => {
  it("refuse tout appel réseau quand le compteur du jour a atteint la limite", async () => {
    const jour = utcDayKey(new Date());
    const stockage = new Map<string, string>([
      ["axiom:twelvedata:daily:v1", JSON.stringify({ jour, count: 800 })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stockage.get(k) ?? null,
      setItem: (k: string, v: string) => void stockage.set(k, v),
    });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);

    // Symbole unique : ne partage ni cache ni inflight avec les autres tests du fichier.
    await expect(twelveDataAdapter.fetchKlines("QUOTAJOURTEST", "1d")).rejects.toThrow(/quota journalier/);
    expect(f).not.toHaveBeenCalled(); // aucun crédit consommé
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/data/twelvedata.test.ts` → échec : `quotaJourEpuise` non exportée, puis (après le seul export) `promise resolved instead of rejecting`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/data/twelvedata.ts` :

(a) extraire la lecture du compteur (réutilisée par `bumpDailyCount`) et ajouter le prédicat pur, après `nextDailyCount` (ligne 100) :

```ts
/** Lit le compteur journalier persisté SANS l'incrémenter (null si indisponible/corrompu). */
function lireDailyUsage(): DailyUsage | null {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as DailyUsage).jour === "string" &&
      typeof (parsed as DailyUsage).count === "number"
      ? (parsed as DailyUsage)
      : null;
  } catch {
    return null;
  }
}

/**
 * Vrai si le plafond JOURNALIER est atteint pour le jour UTC de `now`. PURE & testée.
 * Un compteur d'un autre jour ne compte pas (reset minuit UTC), un compteur absent non plus.
 */
export function quotaJourEpuise(stored: DailyUsage | null, now: Date, limite = DAILY_LIMIT): boolean {
  return stored !== null && stored.jour === utcDayKey(now) && stored.count >= limite;
}
```

(b) simplifier `bumpDailyCount` pour réutiliser la lecture :

```ts
function bumpDailyCount(): number | null {
  try {
    const next = nextDailyCount(lireDailyUsage(), new Date());
    localStorage.setItem(DAILY_KEY, JSON.stringify(next));
    return next.count;
  } catch {
    return null; // localStorage indisponible → pas de compteur journalier
  }
}
```

(c) gater `acquireSlot` (ligne 147), en tête du corps sérialisé :

```ts
function acquireSlot(): Promise<void> {
  const run = throttleChain.then(async () => {
    // Plafond JOURNALIER (~800 crédits) : jusqu'ici seulement AFFICHÉ. 3 symboles tradfi
    // pollés à 60 s + le chart crevaient le plafond en cours de séance US, puis chaque
    // appel échouait en silence jusqu'à minuit UTC. On refuse ICI, explicitement : le
    // chart ressert son cache périmé (cachedSeries), la watchlist passe en erreur, et
    // le backoff de pollLoop espace les tentatives.
    if (quotaJourEpuise(lireDailyUsage(), new Date())) {
      healthStore.getState().marquerErreur(HEALTH_SOURCE, "quota journalier Twelve Data épuisé (800 crédits)");
      throw new Error("Twelve Data: quota journalier épuisé (800 crédits) — reset à minuit UTC");
    }
    for (;;) {
      // … boucle existante inchangée …
    }
  });
  // … suite inchangée (la chaîne absorbe déjà les rejets : `run.then(()=>…, ()=>…)`) …
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/data/twelvedata.test.ts src/data/ticker.test.ts src/data/pollLoop.test.ts` → tous verts (les tests existants n'ont pas de localStorage → `lireDailyUsage()` = null → jamais gaté).

- [ ] **Étape 5 : commit** — `git add apps/web/src/data/twelvedata.ts apps/web/src/data/twelvedata.test.ts && git commit -m "fix(twelvedata): plafond journalier 800 crédits appliqué (refus explicite + santé)"`

---

### Task A.11 : Étiquette d'indicateur avec les params EFFECTIFS (clampés)

**Constat couvert :** Étiquette d'indicateur affichée avec les params bruts alors que resolveParams clampe au calcul (apps/web/src/store/indicators.ts:134, basse)

Correctif : `formatInstanceLabel` passe par `resolveParams` (@axiom/indicators — exporté via `engine.ts`, la source de vérité du clamp) mais n'affiche que les clés effectivement posées dans `params` (comportement historique : « EMA (20) », pas « EMA (20, close) »).

**Files:**
- Modify: apps/web/src/store/indicators.ts:19, 134-142
- Test: apps/web/src/store/indicators.test.ts:40-57

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans le `describe("formatInstanceLabel")` de `apps/web/src/store/indicators.test.ts` :

```ts
  it("affiche la valeur EFFECTIVE (clampée/assainie par resolveParams), pas la saisie brute", () => {
    // resolveParams clampe au calcul (gotcha connu) : le libellé doit dire la même chose.
    const ema = getIndicator("ema");
    if (!ema) throw new Error("def ema absente du registre");
    expect(formatInstanceLabel(ema, { length: -3 })).toBe("EMA (1)"); // clamp min=1
    expect(formatInstanceLabel(ema, { length: Number.NaN })).toBe("EMA (20)"); // NaN → défaut

    const rsi = getIndicator("rsi");
    if (!rsi) throw new Error("def rsi absente du registre");
    expect(formatInstanceLabel(rsi, { length: 0 })).toBe("RSI (1)"); // clamp min=1
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/indicators.test.ts` → `expected 'EMA (-3)' to be 'EMA (1)'`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/store/indicators.ts` :

```ts
import { getIndicator, resolveParams } from "@axiom/indicators";
```

et remplacer `formatInstanceLabel` (lignes 134-142) :

```ts
export function formatInstanceLabel(def: IndicatorDef, params: IndicatorParams): string {
  // Params RÉSOLUS (clamp [min,max], NaN → défaut — même chemin que le calcul via
  // computeIndicator→resolveParams) : le libellé doit montrer la valeur EFFECTIVE de la
  // courbe, pas la saisie brute (« RSI (100000) » mentait, la courbe étant clampée).
  // On n'affiche que les clés effectivement posées dans `params` (comportement
  // historique : « EMA (20) », jamais les défauts non touchés comme la source).
  const resolus = resolveParams(def, params);
  const parts: string[] = [];
  for (const input of def.inputs) {
    if (!(input.key in params)) continue;
    const v = resolus[input.key];
    if (typeof v === "number") parts.push(String(v));
    else if (typeof v === "string") parts.push(v);
  }
  return parts.length > 0 ? `${def.name} (${parts.join(", ")})` : def.name;
}
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/indicators.test.ts src/store/indicators.couleur.test.ts src/store/indicatorSets.test.ts` → tous verts (les tests existants passent des valeurs dans les bornes : libellés inchangés).

- [ ] **Étape 5 : commit** — `git add apps/web/src/store/indicators.ts apps/web/src/store/indicators.test.ts && git commit -m "fix(indicateurs): étiquette alignée sur les params effectifs (resolveParams)"`

---

## Clôture du lot

Après la dernière tâche : `pnpm --filter @axiom/web test` (suite complète web) + `pnpm --filter @axiom/web exec tsc --noEmit` pour la non-régression globale.


## Plan de correction — Lot B « WHALES et collecteurs daemon dignes de confiance »

Périmètre : `apps/daemon` (runtime Bun, tests `bun test`). Commande de test vérifiée dans
`apps/daemon/package.json` : `"test": "bun test src"` — les étapes utilisent
`cd /Users/zakichair/axiom/apps/daemon && bun test src/<fichier>.test.ts` (ciblé) puis `bun test src` (non-régression).
Conventions copiées des tests existants : SQLite `:memory:`, `fetchImpl` injecté (stub qui journalise les appels),
`describe/it` dans `whales.test.ts` et `liqFeed.test.ts`, `describe/test` dans `hyperliquid.test.ts` et `globe.test.ts`.

Ordre d'exécution : **B.1 avant B.2** (B.2 réutilise l'export `pollEtherscan` injectable et le helper `stubEth`
introduits par B.1). Les autres tâches sont indépendantes.

---

### Task B.1 : erreurs Etherscan HTTP 200 = échec, curseur non avancé

**Constat couvert :** Erreur Etherscan (HTTP 200, result=chaîne) traitée comme « zéro log » : curseur avancé, fenêtre perdue (apps/daemon/src/whales.ts:614, sévérité moyenne)

**Files:**
- Modify: apps/daemon/src/whales.ts:352 (nouvelle fonction pure après `parseLogsEtherscan`) et :564-622 (`pollEtherscan`)
- Test: apps/daemon/src/whales.test.ts

**Interfaces:** (consommées par B.2)
```ts
export function resultatGetLogs(json: unknown): unknown[]; // jette sur erreur Etherscan
export async function pollEtherscan(
  cle: string,
  dInjecte?: Database,
  fetchImpl?: typeof fetch, // défaut : fetch
  pauseMs?: number,         // défaut : 250
): Promise<void>;
```
Le helper de test `stubEth(...)` (défini à l'étape 1) est aussi réutilisé par B.2.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/whales.test.ts` (et compléter l'import en tête du fichier avec `ecrireDernierBloc, lireDernierBloc, pollEtherscan, resultatGetLogs, TOKENS_ETH`) :

```ts
// ─────────────────────────── Poll Etherscan (fetch injecté, convention traiterHl) ───────────────────────────

/** Stub fetch Etherscan : eth_blockNumber + getLogs par contrat. Journalise les URLs. */
function stubEth(scenario: {
  blockNumber: string;
  parContrat: Record<string, unknown>;
}): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl = (async (entree: RequestInfo | URL) => {
    const u = String(entree);
    urls.push(u);
    if (u.includes("eth_blockNumber")) return new Response(JSON.stringify({ result: scenario.blockNumber }));
    const contrat = new URL(u).searchParams.get("address") ?? "";
    return new Response(JSON.stringify(scenario.parContrat[contrat] ?? { status: "1", result: [] }));
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("resultatGetLogs", () => {
  it("laisse passer un tableau (logs ou « No records found ») et jette sur erreur en chaîne", () => {
    expect(resultatGetLogs({ status: "1", result: [{ x: 1 }] })).toEqual([{ x: 1 }]);
    expect(resultatGetLogs({ status: "0", message: "No records found", result: [] })).toEqual([]);
    expect(() => resultatGetLogs({ status: "0", result: "Max rate limit reached" })).toThrow(
      "Max rate limit reached",
    );
    expect(() => resultatGetLogs({ status: "0", message: "NOTOK" })).toThrow("NOTOK");
    expect(() => resultatGetLogs(null)).toThrow("réponse illisible");
  });
});

describe("pollEtherscan — erreurs Etherscan en HTTP 200", () => {
  it("result en chaîne : curseur NON avancé (fenêtre rejouée), erreur portée en santé", async () => {
    const d = new Database(":memory:");
    assurerTableWhales(d);
    ecrireDernierBloc(d, 90);
    const usdt = TOKENS_ETH[0]?.contrat ?? "";
    const { fetchImpl } = stubEth({
      blockNumber: "0x64", // bloc 100 → fenêtre 91..100
      parContrat: { [usdt]: { status: "0", result: "Max rate limit reached" } },
    });
    await pollEtherscan("cle-test", d, fetchImpl, 0);
    expect(lireDernierBloc(d)).toBe(90); // AVANT le fix : 100 (fenêtre 91..100 perdue en silence)
    const url = new URL("http://127.0.0.1:8787/whales/recent");
    const corps = (await traiterWhales(new Request(url), url, d).json()) as {
      sante: { erreurEth: string | null };
    };
    expect(corps.sante.erreurEth).toContain("Max rate limit reached");
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/whales.test.ts` → échec attendu à l'import : `SyntaxError: ... does not provide an export named 'pollEtherscan'` (ni `resultatGetLogs`).

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/whales.ts` :

(a) après `parseLogsEtherscan` (ligne 352), ajouter :

```ts
/**
 * Extrait le tableau `result` d'une réponse getLogs en JETANT sur erreur Etherscan :
 * l'API renvoie ses erreurs en HTTP 200 avec `status:"0"` et `result` en CHAÎNE
 * (« Max rate limit reached », « Query timeout », clé invalide) — à ne PAS confondre
 * avec « No records found » (status "0" mais `result: []`, cas légitime). Sans cette
 * garde, une erreur passait pour « zéro log » et le curseur sautait la fenêtre.
 * Fonction PURE.
 */
export function resultatGetLogs(json: unknown): unknown[] {
  const j = (json ?? {}) as { message?: unknown; result?: unknown };
  if (Array.isArray(j.result)) return j.result;
  const detail =
    typeof j.result === "string" ? j.result : typeof j.message === "string" ? j.message : "réponse illisible";
  throw new Error(`getLogs erreur Etherscan : ${detail}`);
}
```

(b) remplacer l'en-tête de `pollEtherscan` (lignes 564-571) :

```ts
/**
 * Un poll Etherscan : n° de bloc courant, puis getLogs Transfer par token sur la
 * fenêtre `fenetreBlocs`, filtrage au seuil et persistance. Échec d'UN appel — HTTP
 * non-2xx OU erreur Etherscan en HTTP 200 (cf. resultatGetLogs) → poll abandonné SANS
 * avancer le curseur de bloc (rejouera au prochain tick). `dInjecte`/`fetchImpl`/
 * `pauseMs` pour les tests (convention traiterHl).
 */
export async function pollEtherscan(
  cle: string,
  dInjecte?: Database,
  fetchImpl: typeof fetch = fetch,
  pauseMs = 250, // clé garantie par l'appelant (sans clé, le poll n'est pas démarré)
): Promise<void> {
  const d = dInjecte ?? db();
  if (dInjecte !== undefined) assurerTableWhales(dInjecte);
```
(supprimer les deux anciennes lignes `const d = db();` et `const pauseMs = 250; …`)

(c) dans le corps, remplacer les deux `await fetch(` par `await fetchImpl(` (lignes 573 et 592) ;

(d) après `const json = (await res.json()) as unknown;` (ligne 607), insérer :

```ts
      // Erreur Etherscan en HTTP 200 : jeter AVANT parse — le catch n'avance pas le
      // curseur (la fenêtre sera rejouée au prochain tick) et remplit sante.erreurEth.
      resultatGetLogs(json);
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/whales.test.ts` → tous les tests du fichier passent (y compris les 15 describes existants). Puis `bun run typecheck` (les appelants de `demarrerBoucleWhales` passent toujours `pollEtherscan(cleEtherscan)` avec les défauts).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/whales.ts apps/daemon/src/whales.test.ts && git commit -m "fix(whales): erreurs Etherscan HTTP 200 traitées comme échec, curseur non avancé"`

---

### Task B.2 : détection de troncature getLogs (plafond 1000)

**Constat couvert :** getLogs sans pagination ni détection de troncature (plafond 1000) : queue de fenêtre perdue à chaque rattrapage (apps/daemon/src/whales.ts:599, sévérité haute)

**Files:**
- Modify: apps/daemon/src/whales.ts (nouvelle fonction pure après `resultatGetLogs` ; corps de `pollEtherscan` lignes ~589-617)
- Test: apps/daemon/src/whales.test.ts

**Interfaces:** dépend de B.1 (`pollEtherscan` exporté injectable, `resultatGetLogs`, helper de test `stubEth`).

Stratégie (précisée après lecture du code, cf. avertissements) : à ≥1000 lignes, la réponse est tronquée
et le bloc le plus haut reçu est potentiellement coupé en plein milieu → le curseur sûr est
`max(blockNumber reçu) − 1`, borné à `fenetre.de` (progression garantie même sur méga-bloc, trou assumé
— même philosophie que `fenetreBlocs`). Le curseur persisté est partagé entre les 2 tokens → on prend le
MIN des curseurs par token. Les ids `txhash-logindex` sont idempotents (`INSERT OR IGNORE`) : la relecture
du bloc frontière au poll suivant ne crée aucun doublon.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/whales.test.ts` (compléter l'import avec `curseurApresGetLogs, PLAFOND_GETLOGS`) :

```ts
describe("curseurApresGetLogs", () => {
  const ligne = (bloc: number): unknown => ({ blockNumber: `0x${bloc.toString(16)}` });

  it("sous le plafond : la fenêtre entière est couverte", () => {
    expect(curseurApresGetLogs([ligne(95)], 91, 100)).toBe(100);
    expect(curseurApresGetLogs([], 91, 100)).toBe(100);
  });

  it("au plafond (troncature) : recule au dernier bloc entièrement couvert", () => {
    const tronque = Array.from({ length: PLAFOND_GETLOGS }, () => ligne(96));
    expect(curseurApresGetLogs(tronque, 91, 100)).toBe(95); // 96 − 1
  });

  it("borné au début de fenêtre (méga-bloc) ; tronqué sans blockNumber lisible → jette", () => {
    const tronque = Array.from({ length: PLAFOND_GETLOGS }, () => ligne(91));
    expect(curseurApresGetLogs(tronque, 91, 100)).toBe(91);
    const illisible = Array.from({ length: PLAFOND_GETLOGS }, () => ({}));
    expect(() => curseurApresGetLogs(illisible, 91, 100)).toThrow("tronqué");
  });
});

describe("pollEtherscan — troncature getLogs", () => {
  it("1000 lignes : curseur avancé au dernier blockNumber reçu − 1, PAS à fenetre.a", async () => {
    const d = new Database(":memory:");
    assurerTableWhales(d);
    ecrireDernierBloc(d, 90);
    const usdt = TOKENS_ETH[0]?.contrat ?? "";
    const tronque = Array.from({ length: 1000 }, () => ({ blockNumber: "0x60" })); // bloc 96
    const { fetchImpl } = stubEth({
      blockNumber: "0x64", // bloc 100 → fenêtre 91..100
      parContrat: { [usdt]: { status: "1", result: tronque } }, // USDC : défaut { result: [] }
    });
    await pollEtherscan("cle-test", d, fetchImpl, 0);
    expect(lireDernierBloc(d)).toBe(95); // AVANT le fix : 100 (blocs 96..100 jamais relus)
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/whales.test.ts` → échec attendu à l'import : `does not provide an export named 'curseurApresGetLogs'`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/whales.ts` :

(a) juste après `resultatGetLogs` (ajoutée en B.1) :

```ts
/** Plafond de lignes d'une réponse getLogs Etherscan (au-delà : réponse TRONQUÉE). */
export const PLAFOND_GETLOGS = 1000;

/**
 * Curseur de bloc SÛR après un getLogs : si la réponse atteint le plafond (troncature —
 * les logs au-delà du 1000e sont PERDUS), on ne peut avancer que jusqu'au dernier bloc
 * entièrement couvert = (plus haut blockNumber reçu − 1), le bloc le plus haut étant
 * potentiellement coupé en plein milieu. Borné à `fenetreDe` pour garantir la progression
 * (un méga-bloc saturant seul le plafond avance quand même d'un bloc : trou assumé,
 * cohérent avec fenetreBlocs). Sans troncature : `fenetreA`. Fonction PURE.
 */
export function curseurApresGetLogs(result: readonly unknown[], fenetreDe: number, fenetreA: number): number {
  if (result.length < PLAFOND_GETLOGS) return fenetreA;
  let max = 0;
  for (const brut of result) {
    const bn = nombreHex((brut as { blockNumber?: unknown } | null)?.blockNumber);
    if (bn !== null && bn > max) max = bn;
  }
  if (max === 0) throw new Error("getLogs tronqué sans blockNumber lisible");
  return Math.max(fenetreDe, max - 1);
}
```

(b) dans `pollEtherscan`, remplacer :

```ts
    const lot: MouvementWhale[] = [];
    for (const token of TOKENS_ETH) {
```
par :
```ts
    const lot: MouvementWhale[] = [];
    let curseur = fenetre.a;
    for (const token of TOKENS_ETH) {
```
puis remplacer la ligne `resultatGetLogs(json);` (posée en B.1) par :
```ts
      const lignes = resultatGetLogs(json);
      // Troncature au plafond getLogs : curseur ramené au dernier bloc entièrement
      // couvert — MIN entre tokens (curseur persisté partagé). Les ids idempotents
      // rendent la relecture partielle du bloc frontière sans doublon.
      const c = curseurApresGetLogs(lignes, fenetre.de, fenetre.a);
      if (c < curseur) curseur = c;
```
et remplacer le triplet de fin :
```ts
    insererMouvements(d, lot);
    ecrireDernierBloc(d, fenetre.a);
    sante.dernierBlocEth = fenetre.a;
```
par :
```ts
    insererMouvements(d, lot);
    ecrireDernierBloc(d, curseur);
    sante.dernierBlocEth = curseur;
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/whales.test.ts` → vert, y compris le test B.1 (réponses non tronquées : `curseur === fenetre.a`, comportement inchangé).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/whales.ts apps/daemon/src/whales.test.ts && git commit -m "fix(whales): troncature getLogs détectée, curseur au dernier bloc entièrement couvert"`

---

### Task B.3 : rattrapage des blocs BTC intermédiaires + péremption du prix BTC

**Constat couvert :** pollBtc ne traite que le bloc de tête : blocs intermédiaires perdus silencieusement (apps/daemon/src/whales.ts:482, sévérité moyenne). Couvre AUSSI, en étapes supplémentaires du même fichier/fonction : « Prix BTC conservé sans limite d'âge » (apps/daemon/src/whales.ts:518, sévérité basse).

**Files:**
- Modify: apps/daemon/src/whales.ts:47-62 (constantes/URLs), :217 (nouvelles fonctions pures après `parseLatestBlock`), :426-453 (`SanteWhales`), :455-522 (`pollBtc`/`pollPrixBtc`)
- Test: apps/daemon/src/whales.test.ts

**Interfaces:**
```ts
export const MAX_BLOCS_BTC_PAR_POLL = 6;
export const PEREMPTION_PRIX_BTC_MS = 15 * 60_000;
export function hauteursARattraper(dernierTraite: number | null, tete: number, max?: number): number[];
export function parseBlocParHauteur(brut: unknown): { tx: unknown[] } | null;
export function prixBtcUtilisable(prix: number, prixTs: number, now: number): boolean;
export async function pollBtc(fetchImpl?: typeof fetch, dInjecte?: Database): Promise<void>;
export async function pollPrixBtc(fetchImpl?: typeof fetch): Promise<void>;
export function reinitialiserWhales(): void; // tests (cf. reinitialiserHl)
// SanteWhales gagne un champ ADDITIF : prixBtcTs: number (0 = jamais) — JSON additif, front inchangé.
```

- [ ] **Étape 1 : écrire les tests qui échouent** — ajouter en fin de `apps/daemon/src/whales.test.ts` (compléter l'import avec `hauteursARattraper, parseBlocParHauteur, PEREMPTION_PRIX_BTC_MS, pollBtc, pollPrixBtc, prixBtcUtilisable, reinitialiserWhales`) :

```ts
// ─────────────────────────── Poll blocs BTC (rattrapage borné, fetch injecté) ───────────────────────────

describe("hauteursARattraper", () => {
  it("premier poll : tête seule ; ensuite dernier+1..tête", () => {
    expect(hauteursARattraper(null, 100)).toEqual([100]);
    expect(hauteursARattraper(100, 103)).toEqual([101, 102, 103]);
  });
  it("à jour ou tête illisible → [] ; retard borné aux blocs les plus récents", () => {
    expect(hauteursARattraper(100, 100)).toEqual([]);
    expect(hauteursARattraper(100, 0)).toEqual([]);
    expect(hauteursARattraper(10, 100, 3)).toEqual([98, 99, 100]);
  });
});

describe("parseBlocParHauteur", () => {
  it("choisit le bloc main_chain et renvoie ses tx", () => {
    const orphelin = { main_chain: false, tx: [{ hash: "o" }] };
    const principal = { main_chain: true, tx: [{ hash: "p" }] };
    expect(parseBlocParHauteur({ blocks: [orphelin, principal] })).toEqual({ tx: [{ hash: "p" }] });
  });
  it("réponse illisible → null", () => {
    expect(parseBlocParHauteur(null)).toBeNull();
    expect(parseBlocParHauteur({ blocks: [] })).toBeNull();
    expect(parseBlocParHauteur({ blocks: [{ main_chain: true, tx: "nope" }] })).toBeNull();
  });
});

describe("prixBtcUtilisable", () => {
  it("frais → true ; plus vieux que la péremption ou invalide → false", () => {
    expect(prixBtcUtilisable(100_000, T0, T0 + 60_000)).toBe(true);
    expect(prixBtcUtilisable(100_000, T0, T0 + PEREMPTION_PRIX_BTC_MS + 1)).toBe(false);
    expect(prixBtcUtilisable(0, T0, T0)).toBe(false);
  });
});

describe("pollBtc — rattrapage des blocs intermédiaires", () => {
  const HASH = "0".repeat(64);

  /** Stub fetch blockchain.info + prix Binance ; journalise les hauteurs demandées. */
  function stubBtc(etat: {
    tete: { hash: string; height: number };
    blocs: Record<number, unknown[]>;
  }): { fetchImpl: typeof fetch; hauteursDemandees: number[] } {
    const hauteursDemandees: number[] = [];
    const fetchImpl = (async (entree: RequestInfo | URL) => {
      const u = String(entree);
      if (u.includes("latestblock")) return new Response(JSON.stringify(etat.tete));
      if (u.includes("ticker/price")) return new Response(JSON.stringify({ price: "100000" }));
      const m = /block-height\/(\d+)/.exec(u);
      if (m !== null) {
        const h = Number(m[1]);
        hauteursDemandees.push(h);
        return new Response(JSON.stringify({ blocks: [{ main_chain: true, tx: etat.blocs[h] ?? [] }] }));
      }
      throw new Error(`URL inattendue : ${u}`);
    }) as typeof fetch;
    return { fetchImpl, hauteursDemandees };
  }

  /** Une tx de 20 BTC (2 M$ à 100 k$) vers une adresse propre au bloc. */
  function txBloc(h: number): unknown {
    return {
      hash: `hash-${h}`,
      time: 1_755_000_000,
      inputs: [{ prev_out: { addr: "1Emetteur" } }],
      out: [{ addr: `1Dest${h}`, value: 2_000_000_000 }],
    };
  }

  it("itère de dernierBloc+1 à la tête et insère les mouvements de CHAQUE bloc", async () => {
    reinitialiserWhales();
    const d = new Database(":memory:");
    assurerTableWhales(d);
    const etat = { tete: { hash: HASH, height: 100 }, blocs: {} as Record<number, unknown[]> };
    const stub = stubBtc(etat);
    await pollPrixBtc(stub.fetchImpl);
    await pollBtc(stub.fetchImpl, d); // premier poll : tête seule (comportement actuel conservé)
    expect(stub.hauteursDemandees).toEqual([100]);

    etat.tete = { hash: HASH, height: 103 }; // 3 blocs minés entre deux polls
    etat.blocs[101] = [txBloc(101)];
    etat.blocs[102] = [txBloc(102)];
    etat.blocs[103] = [txBloc(103)];
    await pollBtc(stub.fetchImpl, d);
    expect(stub.hauteursDemandees).toEqual([100, 101, 102, 103]); // AVANT le fix : [<hash>] de la tête seule
    const ids = mouvementsRecents(d, "BTC", 0).map((m) => m.id).sort();
    expect(ids).toEqual(["hash-101", "hash-102", "hash-103"]);
  });

  it("sans prix utilisable : AUCUN bloc téléchargé, erreur portée en santé", async () => {
    reinitialiserWhales();
    const d = new Database(":memory:");
    assurerTableWhales(d);
    const stub = stubBtc({ tete: { hash: HASH, height: 100 }, blocs: {} });
    await pollBtc(stub.fetchImpl, d); // AUCUN pollPrixBtc avant → prix inconnu
    expect(stub.hauteursDemandees).toEqual([]);
    const url = new URL("http://127.0.0.1:8787/whales/recent");
    const corps = (await traiterWhales(new Request(url), url, d).json()) as {
      sante: { erreurBtc: string | null };
    };
    expect(corps.sante.erreurBtc).toContain("prix BTC");
  });
});
```

- [ ] **Étape 2 : les lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/whales.test.ts` → échec attendu à l'import : `does not provide an export named 'hauteursARattraper'` (et suivants).

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/whales.ts` :

(a) remplacer les lignes 49-50 et 59-60 (constantes/URL) :

```ts
/** Poll du dernier bloc BTC (~60 s ; ≥2 blocs minés entre deux polls → rattrapage borné, cf. hauteursARattraper). */
export const PERIODE_POLL_BTC_MS = 60_000;
/** Rattrapage BTC max par poll (chaque bloc pèse quelques Mo : borne le volume téléchargé). */
export const MAX_BLOCS_BTC_PAR_POLL = 6;
/** Péremption du prix BTC : au-delà, le seuil de collecte et le champ `usd` persisté seraient faussés. */
export const PEREMPTION_PRIX_BTC_MS = 15 * 60_000;
```
```ts
const URL_LATEST_BLOCK = "https://blockchain.info/latestblock";
/** Résolution d'un bloc PAR HAUTEUR (`/block-height/<h>?format=json`) : requise pour le rattrapage. */
const URL_BLOCK_HEIGHT = "https://blockchain.info/block-height";
```
(la constante `URL_RAWBLOCK` devient orpheline avec le nouveau `pollBtc` : la supprimer.)

(b) après `parseLatestBlock` (ligne 217), ajouter :

```ts
/**
 * Hauteurs de blocs à traiter ce poll : de `dernierTraite+1` à `tete`, bornées aux plus
 * RÉCENTES (au-delà de `max`, on saute en avant — trou assumé, même politique que la
 * fenêtre Etherscan). Premier poll (`dernierTraite` null) : la tête seule. Fonction PURE.
 */
export function hauteursARattraper(
  dernierTraite: number | null,
  tete: number,
  max: number = MAX_BLOCS_BTC_PAR_POLL,
): number[] {
  if (!Number.isFinite(tete) || tete <= 0) return [];
  if (dernierTraite === null) return [tete];
  if (dernierTraite >= tete) return [];
  const de = Math.max(dernierTraite + 1, tete - max + 1);
  const out: number[] = [];
  for (let h = de; h <= tete; h++) out.push(h);
  return out;
}

/**
 * Bloc PRINCIPAL d'une réponse `block-height/<h>?format=json` (blockchain.info renvoie
 * un tableau `blocks` — orphelins possibles : on prend `main_chain`, sinon le premier),
 * réduit à ses `tx`. `null` si illisible. Fonction PURE.
 */
export function parseBlocParHauteur(brut: unknown): { tx: unknown[] } | null {
  const blocs = (brut as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocs)) return null;
  const principal = blocs.find((b) => (b as { main_chain?: unknown } | null)?.main_chain === true) ?? blocs[0];
  if (!principal || typeof principal !== "object") return null;
  const tx = (principal as { tx?: unknown }).tx;
  return Array.isArray(tx) ? { tx } : null;
}

/** Le prix BTC est-il utilisable (fini, > 0, plus jeune que la péremption) ? Fonction PURE. */
export function prixBtcUtilisable(prix: number, prixTs: number, now: number): boolean {
  return Number.isFinite(prix) && prix > 0 && now - prixTs <= PEREMPTION_PRIX_BTC_MS;
}
```

(c) dans `SanteWhales` (ligne 434), après le champ `prixBtc`, ajouter — et initialiser `prixBtcTs: 0` dans le littéral `sante` (ligne 448) :

```ts
  /** Horodatage du dernier prix BTC obtenu (ms), 0 = jamais (péremption : PEREMPTION_PRIX_BTC_MS). */
  prixBtcTs: number;
```

(d) remplacer intégralement `pollBtc` (lignes 460-507) :

```ts
/**
 * Un poll BTC : en-tête du dernier bloc, puis chaque bloc de `dernierBlocBtcTraite+1`
 * à la tête (rattrapage borné à MAX_BLOCS_BTC_PAR_POLL — ≥2 blocs peuvent être minés
 * entre deux polls) via `block-height/<h>`. Chaque tx passe l'heuristique de montant
 * net + seuil. Sans prix BTC utilisable (absent OU périmé, cf. prixBtcUtilisable), les
 * blocs ne sont PAS consommés (retraités une fois le prix revenu). Le curseur avance
 * bloc PAR bloc : un échec en cours de rattrapage garde l'acquis. `fetchImpl`/`dInjecte`
 * pour les tests (convention traiterHl).
 */
export async function pollBtc(fetchImpl: typeof fetch = fetch, dInjecte?: Database): Promise<void> {
  const d = dInjecte ?? db();
  if (dInjecte !== undefined) assurerTableWhales(dInjecte);
  try {
    const resTete = await fetchImpl(URL_LATEST_BLOCK, { signal: AbortSignal.timeout(15_000) });
    if (!resTete.ok) throw new Error(`latestblock HTTP ${resTete.status}`);
    const tete = parseLatestBlock(await resTete.json());
    if (tete === null) throw new Error("latestblock illisible");

    const hauteurs = hauteursARattraper(dernierBlocBtcTraite, tete.height);
    if (hauteurs.length === 0) {
      sante.dernierPollBtcTs = Date.now();
      sante.erreurBtc = null;
      return; // aucun nouveau bloc : poll abouti quand même (santé fraîche)
    }
    const prix = sante.prixBtc;
    if (prix === null || !prixBtcUtilisable(prix, sante.prixBtcTs, Date.now())) {
      throw new Error("prix BTC indisponible ou périmé");
    }

    for (const hauteur of hauteurs) {
      const resBloc = await fetchImpl(`${URL_BLOCK_HEIGHT}/${hauteur}?format=json`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resBloc.ok) throw new Error(`block-height ${hauteur} HTTP ${resBloc.status}`);
      const cl = resBloc.headers.get("content-length");
      if (cl !== null && Number(cl) > TAILLE_MAX_BLOC) throw new Error("bloc trop volumineux");
      const bloc = parseBlocParHauteur(await resBloc.json());
      if (bloc === null) throw new Error(`block-height ${hauteur} illisible`);

      const lot: MouvementWhale[] = [];
      for (const brut of bloc.tx) {
        const tx = parseTxBtc(brut);
        if (tx === null) continue;
        const mouvement = versMouvementBtc(tx, prix, SEUIL_COLLECTE_USD);
        if (mouvement !== null) lot.push(mouvement);
      }
      insererMouvements(d, lot);
      dernierBlocBtcTraite = hauteur;
      sante.dernierBlocBtc = hauteur;
    }
    sante.dernierPollBtcTs = Date.now();
    sante.erreurBtc = null;
  } catch (err) {
    sante.erreurBtc = err instanceof Error ? err.message : String(err);
    console.error("[axiomd] poll blocs BTC échoué :", err);
  }
}
```

(e) remplacer `pollPrixBtc` (lignes 511-522) :

```ts
/** Rafraîchit le prix BTC (Binance REST, best-effort : on garde l'ancien prix sur échec
 * — mais horodaté : pollBtc refuse un prix plus vieux que PEREMPTION_PRIX_BTC_MS). */
export async function pollPrixBtc(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(URL_PRIX_BTC, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { price?: unknown };
    const prix = Number(json.price);
    if (Number.isFinite(prix) && prix > 0) {
      sante.prixBtc = prix;
      sante.prixBtcTs = Date.now();
    }
  } catch (err) {
    console.error("[axiomd] poll prix BTC échoué :", err);
  }
}
```

(f) après le littéral `sante` (ligne ~453), ajouter le réinitialiseur pour les tests :

```ts
/** Réinitialise l'état mémoire du collecteur (tests ; cf. reinitialiserHl de hyperliquid.ts). */
export function reinitialiserWhales(): void {
  dernierBlocBtcTraite = null;
  sante.dernierPollBtcTs = 0;
  sante.dernierBlocBtc = null;
  sante.erreurBtc = null;
  sante.prixBtc = null;
  sante.prixBtcTs = 0;
  sante.dernierPollEthTs = 0;
  sante.dernierBlocEth = null;
  sante.erreurEth = null;
  sante.clePresente = false;
}
```
NB : `reinitialiserWhales` référence `dernierBlocBtcTraite` déclaré plus bas (ligne ~458) — hoisting `let` interdit à l'exécution du module mais la fonction n'est appelée qu'après chargement complet : OK. Sinon, la placer après la déclaration de `dernierBlocBtcTraite`.

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/whales.test.ts` puis `bun run typecheck` (le champ `prixBtcTs` est additif ; `demarrerBoucleWhales` appelle `pollBtc()`/`pollPrixBtc()` avec les défauts, inchangé).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/whales.ts apps/daemon/src/whales.test.ts && git commit -m "fix(whales): rattrapage des blocs BTC intermédiaires + péremption du prix BTC"`

---

### Task B.4 : heartbeat applicatif WS Bybit/OKX

**Constat couvert :** Aucun heartbeat applicatif sur les WS Bybit/OKX : déconnexions serveur récurrentes et trous d'ingestion (apps/daemon/src/liqFeed.ts:306, sévérité basse)

**Files:**
- Modify: apps/daemon/src/liqFeed.ts:248-403, :514-517 (boucle WS + les deux points de connexion)
- Test: apps/daemon/src/liqFeed.test.ts

**Interfaces:**
```ts
export const PERIODE_HEARTBEAT_WS_MS = 20_000;
export const HEARTBEAT_BYBIT: string; // JSON.stringify({ op: "ping" })
export const HEARTBEAT_OKX = "ping";  // chaîne littérale (protocole OKX)
export function armerHeartbeatWs(
  ws: { send: (data: string) => void },
  payload: string,
  periodeMs?: number,
): () => void;
```

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/liqFeed.test.ts` (compléter l'import avec `armerHeartbeatWs, HEARTBEAT_BYBIT, HEARTBEAT_OKX`) :

```ts
describe("armerHeartbeatWs", () => {
  it("envoie le payload à chaque période et s'arrête au désarmement", async () => {
    const envois: string[] = [];
    const stop = armerHeartbeatWs({ send: (d) => envois.push(d) }, HEARTBEAT_OKX, 5);
    await new Promise((r) => setTimeout(r, 40));
    expect(envois.length).toBeGreaterThanOrEqual(3);
    expect(envois[0]).toBe("ping");
    stop();
    const n = envois.length;
    await new Promise((r) => setTimeout(r, 25));
    expect(envois.length).toBe(n); // plus aucun envoi après désarmement
  });

  it("payloads par feed figés ; un send qui jette (WS fermée) est absorbé", async () => {
    expect(HEARTBEAT_OKX).toBe("ping"); // OKX attend la CHAÎNE « ping » (coupe à 30 s sinon)
    expect(JSON.parse(HEARTBEAT_BYBIT)).toEqual({ op: "ping" }); // Bybit v5 : {"op":"ping"}
    const stop = armerHeartbeatWs(
      {
        send: () => {
          throw new Error("WS fermée");
        },
      },
      HEARTBEAT_BYBIT,
      5,
    );
    await new Promise((r) => setTimeout(r, 15)); // aucune exception ne doit fuir
    stop();
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/liqFeed.test.ts` → échec attendu à l'import : `does not provide an export named 'armerHeartbeatWs'`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/liqFeed.ts` :

(a) après les constantes de la section « Boucle WS reconnectante » (ligne 254), ajouter :

```ts
/** Cadence des pings applicatifs (OKX coupe toute WS silencieuse à 30 s ; Bybit v5 demande ~20 s). */
export const PERIODE_HEARTBEAT_WS_MS = 20_000;
/** Charges utiles de heartbeat PAR FEED (protocoles distincts, vérifiés en réel). */
export const HEARTBEAT_BYBIT = JSON.stringify({ op: "ping" });
export const HEARTBEAT_OKX = "ping";

/**
 * Arme l'envoi périodique d'un heartbeat applicatif sur une WS : les canaux de
 * liquidations sont creux par nature — sans trafic client, les serveurs ferment la
 * connexion en boucle (cycle fermeture/backoff/re-souscription, liquidations perdues
 * dans les fenêtres de reconnexion). Envoi best-effort (une WS fermée entre deux ticks
 * ne jette pas : `onclose` gère la reconnexion). Renvoie la fonction de désarmement.
 */
export function armerHeartbeatWs(
  ws: { send: (data: string) => void },
  payload: string,
  periodeMs: number = PERIODE_HEARTBEAT_WS_MS,
): () => void {
  const minuteur = setInterval(() => {
    try {
      ws.send(payload);
    } catch {
      /* WS fermée entre deux ticks : le onclose relance la reconnexion */
    }
  }, periodeMs);
  return () => clearInterval(minuteur);
}
```

(b) dans `connecterBoucleWs` (ligne 262), ajouter le 4e paramètre et le cycle armement/désarmement :

```ts
function connecterBoucleWs(
  url: string,
  onOpen: (ws: WebSocket) => void,
  onMessage: (data: string) => boolean | void,
  heartbeat?: string,
): () => void {
```
déclarer près des autres minuteurs (ligne ~273) :
```ts
  let desarmerHeartbeat: (() => void) | null = null;
  const nettoyerHeartbeat = (): void => {
    if (desarmerHeartbeat) {
      desarmerHeartbeat();
      desarmerHeartbeat = null;
    }
  };
```
dans `socket.onopen`, après `armerWatchdog();` :
```ts
      // Heartbeat applicatif par feed (chaîne « ping » OKX / {"op":"ping"} Bybit),
      // armé à CHAQUE ouverture, désarmé à la fermeture.
      if (heartbeat !== undefined) {
        nettoyerHeartbeat();
        desarmerHeartbeat = armerHeartbeatWs(socket, heartbeat);
      }
```
en tête de `socket.onclose` (avant `nettoyerStable();`) et dans la fonction d'arrêt retournée (avant `nettoyerStable();`) :
```ts
      nettoyerHeartbeat();
```

(c) brancher les deux feeds :
- Bybit (`creerFeedLiquidations`, ligne ~381) :
```ts
    stopWs = connecterBoucleWs(
      WS_URL,
      (ws) => ws.send(JSON.stringify({ op: "subscribe", args })),
      ingererMessage,
      HEARTBEAT_BYBIT,
    );
```
- OKX (`creerFeedLiquidationsOkx`, ligne ~516) :
```ts
      stopWs = connecterBoucleWs(OKX_WS_URL, (ws) => ws.send(sub), ingererMessageOkx, HEARTBEAT_OKX);
```

NB : les réponses `pong` sont inoffensives — Bybit renvoie un JSON sans `topic` (→ `ingererMessage` renvoie false), OKX renvoie la chaîne « pong » (JSON.parse échoue → false) ; les deux réarment `dernierMessageTs` (watchdog) sans compter comme données.

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/liqFeed.test.ts` → les 2 nouveaux describes + les 6 existants passent.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/liqFeed.ts apps/daemon/src/liqFeed.test.ts && git commit -m "fix(liqfeed): heartbeat applicatif sur les WS Bybit et OKX"`

---

### Task B.5 : retry court des ctVal OKX manquants (+ timeout du fetch)

**Constat couvert :** Échec du fetch ctVal OKX au démarrage : liquidations de l'instrument ignorées jusqu'à 24 h (apps/daemon/src/liqFeed.ts:481, sévérité basse)

**Files:**
- Modify: apps/daemon/src/liqFeed.ts:47 (export URL), :359-365 (`FeedLiquidations`), :431-530 (`creerFeedLiquidationsOkx`), :544-553 (`rafraichir`)
- Test: apps/daemon/src/liqFeed.test.ts

**Interfaces:**
```ts
export const OKX_INSTRUMENTS_URL: string; // export pour les stubs de test (convention URL_INFO de hyperliquid.ts)
export interface RegistreCtVal {
  get: (instId: string) => number | undefined;
  charger: (instIds: Iterable<string>, forcer: boolean) => Promise<void>;
}
export function creerRegistreCtVal(fetchImpl?: typeof fetch): RegistreCtVal;
// FeedLiquidations gagne un membre OPTIONNEL : retenterCtVal?: () => void (OKX seulement).
```

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/liqFeed.test.ts` (compléter l'import avec `creerRegistreCtVal, OKX_INSTRUMENTS_URL`) :

```ts
describe("creerRegistreCtVal", () => {
  const INST = "BTC-USDT-SWAP";

  /** Stub REST instruments OKX : échoue tant que `etat.ok` est false ; compte les appels. */
  function stubCtVal(): { fetchImpl: typeof fetch; etat: { ok: boolean; appels: number } } {
    const etat = { ok: false, appels: 0 };
    const fetchImpl = (async (entree: RequestInfo | URL) => {
      etat.appels += 1;
      expect(String(entree).startsWith(OKX_INSTRUMENTS_URL)).toBe(true);
      if (!etat.ok) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ code: "0", data: [{ instId: INST, ctVal: "0.01" }] }));
    }) as typeof fetch;
    return { fetchImpl, etat };
  }

  it("échec au démarrage puis retry NON forcé : le ctVal manquant est rechargé", async () => {
    const { fetchImpl, etat } = stubCtVal();
    const registre = creerRegistreCtVal(fetchImpl);
    await registre.charger([INST], false);
    expect(registre.get(INST)).toBeUndefined(); // échec absorbé (best-effort)
    expect(etat.appels).toBe(1);

    etat.ok = true;
    await registre.charger([INST], false); // retry : MANQUANT → refetch (le bug : seul le refresh 24 h retentait)
    expect(registre.get(INST)).toBe(0.01);
    expect(etat.appels).toBe(2);

    await registre.charger([INST], false); // présent, non forcé → AUCUN fetch (anti-spam au poll 60 s)
    expect(etat.appels).toBe(2);

    await registre.charger([INST], true); // forcé (refresh 24 h) → refetch
    expect(etat.appels).toBe(3);
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/liqFeed.test.ts` → échec attendu à l'import : `does not provide an export named 'creerRegistreCtVal'`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/liqFeed.ts` :

(a) ligne 47, exporter l'URL (pour les stubs de test, convention `URL_INFO` de hyperliquid.ts) :
```ts
export const OKX_INSTRUMENTS_URL = "https://www.okx.com/api/v5/public/instruments";
```

(b) juste au-dessus de `creerFeedLiquidationsOkx` (après les interfaces `OkxInstrument`/`OkxInstrumentsResponse`, ligne ~423), ajouter le registre (extraction de `chargerCtVal`/`chargerTousCtVal` avec fetch injectable + timeout) :

```ts
/** Registre des ctVal OKX (sz en CONTRATS → qty = sz × ctVal), fetch injectable pour les tests. */
export interface RegistreCtVal {
  get: (instId: string) => number | undefined;
  /** Charge les ctVal des instId donnés (MANQUANTS seulement, ou TOUS si `forcer`). */
  charger: (instIds: Iterable<string>, forcer: boolean) => Promise<void>;
}

export function creerRegistreCtVal(fetchImpl: typeof fetch = fetch): RegistreCtVal {
  const parInst = new Map<string, number>();
  /** Fetch le ctVal d'un instId (best-effort ; log sur échec — le retry court repassera). */
  const chargerUn = async (instId: string): Promise<void> => {
    const instFamily = instId.replace(/-SWAP$/, "");
    try {
      const params = new URLSearchParams({ instType: "SWAP", instFamily });
      const res = await fetchImpl(`${OKX_INSTRUMENTS_URL}?${params.toString()}`, {
        // Timeout : un fetch qui pend bloquait indéfiniment le chargement (aucun avant).
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const json = (await res.json()) as OkxInstrumentsResponse;
      const liste = Array.isArray(json.data) ? (json.data as OkxInstrument[]) : [];
      const inst = liste.find((i) => i.instId === instId);
      const ctVal = Number(inst?.ctVal);
      if (!Number.isFinite(ctVal) || ctVal <= 0) throw new Error("ctVal illisible");
      parInst.set(instId, ctVal);
    } catch (err) {
      console.error("[axiomd] ctVal OKX indisponible pour", instId, err);
    }
  };
  return {
    get: (instId) => parInst.get(instId),
    charger: async (instIds, forcer) => {
      await Promise.all([...instIds].filter((id) => forcer || !parInst.has(id)).map(chargerUn));
    },
  };
}
```

(c) dans `creerFeedLiquidationsOkx` :
- remplacer `const ctValParInst = new Map<string, number>();` par `const registreCtVal = creerRegistreCtVal();` et SUPPRIMER les fonctions locales `chargerCtVal` et `chargerTousCtVal` (lignes 438-462, absorbées par le registre) ;
- ligne 465 : `const minuteurCtVal = setInterval(() => void registreCtVal.charger(mapInst.keys(), true), PERIODE_REFRESH_CTVAL_MS);`
- ligne 480 : `const ctVal = registreCtVal.get(entree.instId);` (le commentaire `// ctVal pas encore chargé → on saute (à froid, ça reviendra)` devient vrai : remplacer par `// ctVal pas encore chargé → on saute (retry court au poll KV 60 s)`) ;
- ligne 513 : `void registreCtVal.charger(mapInst.keys(), false); // charge les ctVal manquants pour les nouveaux instId`
- dans l'objet retourné, ajouter entre `setSymboles` et `arreter` :
```ts
    // Retry COURT des ctVal manquants (appelé par le poll KV 60 s) : sans lui, le seul
    // retry était le refresh 24 h — jusqu'à 24 h de liquidations OKX jetées en silence.
    retenterCtVal: () => void registreCtVal.charger(mapInst.keys(), false),
```

(d) dans l'interface `FeedLiquidations` (ligne 360), ajouter :
```ts
  /** Retente le chargement des ctVal encore MANQUANTS (feed OKX seulement). */
  retenterCtVal?: () => void;
```

(e) dans `rafraichir` (ligne ~549), après `feedOkx.setSymboles(symboles);` :
```ts
      feedOkx.retenterCtVal?.(); // ≤60 s entre deux tentatives sur un ctVal manquant
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/liqFeed.test.ts` puis `bun run typecheck` (Bybit n'implémente pas `retenterCtVal` : membre optionnel, appel gardé `?.`).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/liqFeed.ts apps/daemon/src/liqFeed.test.ts && git commit -m "fix(liqfeed): retry 60 s des ctVal OKX manquants et timeout du fetch instruments"`

---

### Task B.6 : ne pas cacher 5 min un instantané HL entièrement vide

**Constat couvert :** Instantané Hyperliquid entièrement vide (0 adresse scannée) mis en cache 5 min comme donnée valide (apps/daemon/src/hyperliquid.ts:338, sévérité basse)

**Files:**
- Modify: apps/daemon/src/hyperliquid.ts:334-340 (`obtenirInstantane`)
- Test: apps/daemon/src/hyperliquid.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/hyperliquid.test.ts` (imports déjà présents : `reinitialiserHl`, `traiterHl`, `stubHl`, `etat`, `pos`, `baseTest`, `TTL_INSTANTANE_MS` — ajouter `TTL_INSTANTANE_MS` à l'import s'il n'y est pas) :

```ts
describe("instantané entièrement vide (échec amont total)", () => {
  test("0 adresse scannée : PAS de cache — 503 sans cache antérieur, retente immédiate, sinon stale servi", async () => {
    reinitialiserHl();
    const d = baseTest();
    const url = new URL("http://x/hl/liqlevels/BTC");
    // 1) Toutes les adresses en échec, aucun cache antérieur → 503 (pas un 200 « 0 adresses »).
    const ko = stubHl({ adresses: [A1, A2], infoKo: [A1, A2] });
    const res = await traiterHl(new Request(url), url, d, T0, ko.fetchImpl);
    expect(res.status).toBe(503);
    // 2) La requête SUIVANTE retente immédiatement (rien n'a été caché 5 min) et réussit.
    const okStub = stubHl({ adresses: [A1], etats: { [A1]: etat([pos()]) } });
    const res2 = await traiterHl(new Request(url), url, d, T0 + 1_000, okStub.fetchImpl);
    expect(res2.status).toBe(200);
    const corps2 = (await res2.json()) as { ts: number; adressesScannees: number };
    expect(corps2.adressesScannees).toBe(2); // pool persisté [A1,A2] ; A2 → etat([]) du stub
    // 3) Cache expiré + échec amont total → l'ANCIEN instantané est servi (jamais le vide).
    const res3 = await traiterHl(new Request(url), url, d, T0 + 1_000 + TTL_INSTANTANE_MS + 1, ko.fetchImpl);
    expect(res3.status).toBe(200);
    const corps3 = (await res3.json()) as { ts: number };
    expect(corps3.ts).toBe(T0 + 1_000); // instantané de l'étape 2, pas un vide reconstruit
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/hyperliquid.test.ts` → échec attendu : `expect(res.status).toBe(503)` reçoit `200` (l'instantané vide est aujourd'hui caché et servi comme valide).

- [ ] **Étape 3 : implémentation minimale** — dans `obtenirInstantane` (apps/daemon/src/hyperliquid.ts:337-339), remplacer :

```ts
    const inst = await construireInstantane(adresses, fetchImpl, now);
    cacheInstantane = inst;
    return inst;
```
par :
```ts
    const inst = await construireInstantane(adresses, fetchImpl, now);
    // Échec amont TOTAL (0 adresse scannée = les 150 POST ont échoué) : ne PAS cacher
    // 5 min un instantané vide comme une donnée valide — on sert l'ancien cache (même
    // périmé) s'il existe, sinon null (503) ; la requête suivante retente immédiatement.
    if (inst.adressesScannees === 0) return cacheInstantane;
    cacheInstantane = inst;
    return inst;
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/hyperliquid.test.ts` → le nouveau describe + tous les describes existants (cache 5 min, requêtes simultanées mutualisées, 503 pool indisponible) passent.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/hyperliquid.ts apps/daemon/src/hyperliquid.test.ts && git commit -m "fix(hl): ne pas cacher 5 min un instantané entièrement vide"`

---

### Task B.7 : skip-si-frais réel dans rafraichirUcdp

**Constat couvert :** rafraichirUcdp re-télécharge index + CSV complet toutes les 6 h : le « skip si frais » promis n'existe pas (apps/daemon/src/globe.ts:341, sévérité basse)

**Files:**
- Modify: apps/daemon/src/globe.ts:276-281 (tête de `rafraichirUcdp`)
- Test: apps/daemon/src/globe.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — dans `apps/daemon/src/globe.test.ts`, ajouter ce test DANS le describe existant `"rafraichirUcdp + GET /globe/conflits-ucdp"` (ligne 211, pour réutiliser son helper `fetchUcdp`) :

```ts
  test("skip si frais : un instantané < 24 h n'est PAS re-téléchargé (tick 6 h = no-op)", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    await rafraichirUcdp(d, fetchUcdp(true), T0); // seed
    let appels = 0;
    const fetchCompteur = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      appels += 1;
      return (fetchUcdp(true) as typeof fetch)(entree, init);
    }) as typeof fetch;
    // 23 h plus tard : frais → true SANS AUCUN fetch (ni index ni CSV).
    expect(await rafraichirUcdp(d, fetchCompteur, T0 + 23 * 3_600_000)).toBe(true);
    expect(appels).toBe(0);
    // 25 h plus tard : périmé → re-téléchargement (index + CSV) et méta réécrite.
    expect(await rafraichirUcdp(d, fetchCompteur, T0 + 25 * 3_600_000)).toBe(true);
    expect(appels).toBe(2);
    expect(lireMeta(d, "ucdp")?.majA).toBe(T0 + 25 * 3_600_000);
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/globe.test.ts` → échec attendu : `expect(appels).toBe(0)` reçoit `2` (index + CSV re-téléchargés malgré la fraîcheur).

- [ ] **Étape 3 : implémentation minimale** — dans `rafraichirUcdp` (apps/daemon/src/globe.ts:280-281), insérer la garde en tête de fonction, AVANT le `try` :

```ts
export async function rafraichirUcdp(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<boolean> {
  // Skip si frais (< 24 h) : le tick 6 h redevient le no-op promis par les commentaires
  // de demarrerBoucleGlobe (sinon : re-téléchargement index + CSV complet 4×/jour).
  const meta = lireMeta(d, "ucdp");
  if (meta !== null && now - meta.majA < FRAICHEUR_UCDP_MS) return true;
  try {
```

NB : le chemin requête (`repondreConflitsUcdp`, ligne 306) n'appelle `rafraichirUcdp` que si `meta === null || now - meta.majA > FRAICHEUR_UCDP_MS` — la garde n'y déclenche donc jamais de skip à tort (seuils cohérents, strict des deux côtés).

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd /Users/zakichair/axiom/apps/daemon && bun test src/globe.test.ts` → le nouveau test + les tests existants du describe (hit, stale servi à 25 h, 502 sans instantané) passent sans modification.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/globe.ts apps/daemon/src/globe.test.ts && git commit -m "fix(globe): rafraichirUcdp saute le re-téléchargement si l'instantané a moins de 24 h"`

---

## Vérification finale du lot

- [ ] `cd /Users/zakichair/axiom/apps/daemon && bun test src` → suite daemon complète verte (les tests daemon utilisent `:memory:` et des fetch injectés : zéro réseau).
- [ ] `cd /Users/zakichair/axiom/apps/daemon && bun run typecheck` → aucun diagnostic (TS strict + `noUncheckedIndexedAccess`).


## Lot C — Persistance, état, UI (apps/web)

Commande de test du package (vérifiée dans `apps/web/package.json` : `"test": "vitest run"`) :
`pnpm --filter @axiom/web exec vitest run <fichier>`. Tous les chemins sont relatifs à `~/axiom`.

---

### Task C.1 : Persistance multi-fenêtres — n'écrire que depuis la fenêtre focalisée (+ TF validé à l'hydratation, + docstrings)

**Constat couvert :**
- « Multi-fenêtres : la fenêtre passive écrase axiom:chartState:v1 et perd les indicateurs ajoutés ailleurs » (apps/web/src/store/persist.ts:576, haute)
- « Timeframe jamais validé à l'hydratation du maître et des workspaces » (apps/web/src/store/persist.ts:533, basse) — étapes 6-8 de la même tâche
- « Docstrings “Session-only : non persisté” périmées sur trois stores effectivement persistés » (apps/web/src/store/orderflow.ts:10, basse) — étape triviale 11, regroupée ici car elle documente précisément ce que persist.ts persiste

**Files:**
- Modify: apps/web/src/store/persist.ts:105-136 (garde de focus), 511-543 (hydrateChart)
- Modify: apps/web/src/store/workspaces.ts:188-225 (validateContent)
- Modify: apps/web/src/store/orderflow.ts:10-11, apps/web/src/store/volumeProfile.ts:9, apps/web/src/store/compare.ts:10-11, apps/web/src/store/watchlist.ts:9-13 (docstrings)
- Test: apps/web/src/store/persist.test.ts, apps/web/src/store/workspaces.test.ts

**Justification de la stratégie multi-fenêtres** : parmi les deux options du constat (ré-hydratation sur évènement `storage` vs écriture réservée à la fenêtre « leader »), on retient la **garde sur la fenêtre focalisée** (`document.hasFocus()`), qui est l'élection de leader la plus simple possible : aucun protocole BroadcastChannel supplémentaire, aucun état partagé, décision locale et synchrone. Le scénario du constat est exactement une écriture déclenchée dans une fenêtre **non focalisée** (B applique le `setSymbol` diffusé par A pendant que l'utilisateur est dans A) : toute mutation d'origine utilisateur se produit par définition dans la fenêtre qui a le focus, donc la garde ne bloque jamais une écriture légitime. Les écritures sont synchrones dans l'action utilisateur (`subscribe` zustand est synchrone), le focus ne peut pas changer entre les deux. Sémantique résiduelle assumée : la clé reflète la dernière fenêtre **active** (pas une fusion des fenêtres) — c'est déjà la sémantique de ces clés mono-maître.

- [ ] **Étape 1 : écrire le test qui échoue (garde de focus)** — ajouter à la fin de `apps/web/src/store/persist.test.ts` (et ajouter `saveChartState` à l'import existant depuis `"./persist"`) :

```ts
describe("multi-fenêtres — seule la fenêtre focalisée persiste", () => {
  afterEach(() => {
    delete (globalThis as { document?: { hasFocus: () => boolean } }).document;
  });

  it("saveChartState est un no-op dans une fenêtre SANS focus (fenêtre passive du mode multi-fenêtres)", () => {
    // Scénario du constat : la fenêtre B applique un setSymbol diffusé par A (sync.ts)
    // → son abonnement déclenche saveChartState avec SES indicateurs en mémoire (sans
    // l'EMA ajoutée dans A) et écrasait la clé. B n'a pas le focus : l'écriture doit être ignorée.
    (globalThis as { document?: { hasFocus: () => boolean } }).document = { hasFocus: () => false };
    saveChartState();
    expect(localStorage.getItem(CHART_KEY)).toBeNull();
  });

  it("saveChartState écrit normalement dans la fenêtre focalisée", () => {
    (globalThis as { document?: { hasFocus: () => boolean } }).document = { hasFocus: () => true };
    saveChartState();
    expect(JSON.parse(localStorage.getItem(CHART_KEY) ?? "null")?.symbol).toBe("BTCUSDT");
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts` → échec attendu sur le premier `it` : `expected '{"symbol":"BTCUSDT",…}' to be null` (l'écriture passe alors que la fenêtre n'a pas le focus). Le second test passe déjà.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/store/persist.ts`, ajouter juste au-dessus de `writeJson` (l.124) puis garder `writeJson` :

```ts
/**
 * MULTI-FENÊTRES (BroadcastChannel, cf. store/sync.ts) : chaque fenêtre exécute son
 * propre enablePersistence, or les clés gérées ici sont des instantanés COMPLETS
 * (currentChartState re-sérialise aussi les indicateurs). Une fenêtre PASSIVE qui
 * applique un changement distant (setSymbol diffusé) réécrirait la clé avec SON état
 * en mémoire — et perdrait ce que la fenêtre active vient d'y mettre (le dual-write
 * daemon rendant la perte durable). Garde minimale : seule la fenêtre FOCALISÉE écrit
 * (toute mutation d'origine utilisateur s'y produit ; l'écriture est synchrone dans
 * l'action, le focus ne bouge pas entre-temps). `document` absent (tests Node,
 * mono-fenêtre de fait) → on écrit toujours.
 */
function fenetreDoitPersister(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}
```

et en tête de `writeJson` (avant `const serialise = …`) :

```ts
function writeJson(key: string, value: unknown): void {
  if (!fenetreDoitPersister()) return; // fenêtre passive : ne pas écraser la clé
  const serialise = JSON.stringify(value);
```

(La réconciliation daemon et l'import de sauvegarde passent par `setItemSafe`/`localStorage.setItem` directement : non affectés.)

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts` → les 2 nouveaux tests passent ET tous les tests existants du fichier restent verts (ils n'installent pas `document` → la garde laisse passer).

- [ ] **Étape 5 : commit** — `git add apps/web/src/store/persist.ts apps/web/src/store/persist.test.ts && git commit -m "fix(web): la fenêtre passive n'écrase plus les clés persistées (garde de focus)"`

- [ ] **Étape 6 : test qui échoue (TF validé à l'hydratation)** — ajouter au `describe("hydrateStores — marché (exchange/symbole/timeframe)")` de `persist.test.ts` :

```ts
  it("ignore un timeframe persisté que la source restaurée ne supporte pas (plus de cast aveugle)", () => {
    // Coinbase ne supporte pas 6M (adapters.ts) : l'appliquer ferait partir le backfill
    // avec un interval invalide → graphe maître en erreur à chaque boot.
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "BTCUSDT", exchange: "coinbase", timeframe: "6M", indicators: [] })
    );

    hydrateStores();

    expect(marketStore.getState().exchange).toBe("coinbase");
    expect(marketStore.getState().timeframe).toBe("1m"); // valeur d'avant hydratation, inchangée
  });

  it("ignore un timeframe fantaisiste (sauvegarde éditée : \"5x\")", () => {
    localStorage.setItem(
      CHART_KEY,
      JSON.stringify({ symbol: "BTCUSDT", exchange: "binance", timeframe: "5x", indicators: [] })
    );

    hydrateStores();

    expect(marketStore.getState().timeframe).toBe("1m");
  });
```

Et dans `apps/web/src/store/workspaces.test.ts`, au `describe("workspacesStore — validation au chargement")` (réutilise `contenuVierge()` et le patron `vi.resetModules()` du fichier) :

```ts
  it("remplace un timeframe non supporté par la source du workspace par un défaut applicable", async () => {
    installMockLocalStorage();
    localStorage.setItem(
      "axiom:workspaces:v1",
      JSON.stringify({
        workspaces: [
          { id: "defaut", name: "Défaut", content: { ...contenuVierge(), exchange: "coinbase", timeframe: "6M" } },
        ],
        currentId: "defaut",
      })
    );

    vi.resetModules();
    const mod = await import("./workspaces");
    const ws = mod.workspacesStore.getState().workspaces.find((w) => w.id === "defaut");

    // La docstring de validateContent promet un contenu « TOUJOURS applicable » :
    // 6M sur Coinbase ne l'est pas → repli sur 1h (supporté par Coinbase).
    expect(ws?.content.timeframe).toBe("1h");
  });
```

- [ ] **Étape 7 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts src/store/workspaces.test.ts` → échecs attendus : `expected '6M' to be '1m'` (persist), `expected '6M' to be '1h'` (workspaces).

- [ ] **Étape 8 : implémentation minimale** — dans `persist.ts` : ajouter l'import `import { supportedTimeframesFor } from "../data/adapters";` (après l'import de `daemon`), puis remplacer dans `hydrateChart` (l.532-534) :

```ts
    if (typeof persisted.timeframe === "string") {
      marketStore.getState().setTimeframe(persisted.timeframe as Timeframe);
    }
```

par :

```ts
    // TF validé contre la capacité RÉELLE de la source restaurée (même garde que les
    // slots secondaires, cf. sanitizeSlotConfig) : un TF étranger (« 5x », ou retiré
    // d'une version future) ferait partir le backfill avec un interval invalide →
    // graphe maître en erreur à chaque boot. Hors référentiel → on garde le TF courant.
    if (typeof persisted.timeframe === "string") {
      const { exchange, symbol } = marketStore.getState();
      const supportes = supportedTimeframesFor(exchange, symbol) as readonly string[];
      if (supportes.includes(persisted.timeframe)) {
        marketStore.getState().setTimeframe(persisted.timeframe as Timeframe);
      }
    }
```

Dans `workspaces.ts` : ajouter `import { supportedTimeframesFor } from "../data/adapters";` puis, dans `validateContent`, calculer exchange/symbol AVANT le `return` et valider le TF :

```ts
  const exchange =
    typeof o.exchange === "string" && (RESTORABLE_EXCHANGES as string[]).includes(o.exchange)
      ? (o.exchange as ExchangeId)
      : "binance";
  const symbol = isNonEmptyString(o.symbol) ? o.symbol : "BTCUSDT";
  // TF « TOUJOURS applicable » (docstring) : validé contre la source restaurée,
  // repli 1h si supporté, sinon premier TF supporté.
  const supportes = supportedTimeframesFor(exchange, symbol);
  const timeframe =
    isNonEmptyString(o.timeframe) && (supportes as readonly string[]).includes(o.timeframe)
      ? (o.timeframe as Timeframe)
      : supportes.includes("1h")
        ? "1h"
        : (supportes[0] ?? "1h");
  return {
    exchange,
    symbol,
    timeframe,
    indicators: migratePersistedIndicators(o.indicators),
```

(les trois anciennes propriétés `exchange:`, `symbol:`, `timeframe:` inline du `return` sont remplacées par ces variables ; le reste du `return` est inchangé).

- [ ] **Étape 9 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts src/store/workspaces.test.ts` → tout vert, y compris les tests existants (« restaure exchange/symbole/timeframe valides » : kraken+4h supporté ; workspace `synthetic`+BTCUSDT : le test n'asserte pas le TF, le repli 1h est sans effet observable).

- [ ] **Étape 10 : commit** — `git add apps/web/src/store/persist.ts apps/web/src/store/persist.test.ts apps/web/src/store/workspaces.ts apps/web/src/store/workspaces.test.ts && git commit -m "fix(web): timeframe persiste valide contre la capacite de la source a l'hydratation"`

- [ ] **Étape 11 : docstrings périmées (étape triviale, pas de test — commentaires uniquement)** — quatre édits :

`apps/web/src/store/orderflow.ts` (l.10-11), remplacer :
```
 * Session-only : non persisté (le `ChartState` de @axiom/types est figé et ne
 * comporte pas de champ orderflow ; on ne modifie pas les types).
```
par :
```
 * PERSISTANCE : le drapeau `enabled` est persisté par store/persist.ts (clé
 * `axiom:sessionUi:v1`) et restauré au boot — la persistance est DÉLÉGUÉE, ne pas
 * en recréer une ici (double maître). Le `ChartState` de @axiom/types reste figé.
```

`apps/web/src/store/volumeProfile.ts` (l.9), remplacer :
```
 * Session-only : non persisté (ChartState @axiom/types est figé).
```
par :
```
 * PERSISTANCE : `enabled` est persisté par store/persist.ts (clé `axiom:sessionUi:v1`,
 * persistance déléguée — ne pas en recréer ici). ChartState @axiom/types reste figé.
```

`apps/web/src/store/compare.ts` (l.10-11), remplacer :
```
 * Session-only : non persisté (cohérent avec l'orderflow ; le `ChartState` figé de
 * @axiom/types ne comporte pas de champ comparaison — on ne modifie pas les types).
```
par :
```
 * PERSISTANCE : la liste des symboles comparés est persistée par store/persist.ts
 * (clé `axiom:sessionUi:v1`, champ `compare`) et ré-ajoutée au boot — persistance
 * DÉLÉGUÉE, ne pas en recréer ici. Le `ChartState` figé de @axiom/types est inchangé.
```

`apps/web/src/store/watchlist.ts` (l.9-13), remplacer :
```
 * GROUPES (roadmap 1.4) : `groups` liste les onglets (défaut « Principal ») ; `activeGroupId`
 * désigne l'onglet affiché. Le champ `symbols` est un MIROIR en lecture du groupe actif,
 * conservé pour rétro-compatibilité : `persist.ts` (hors de ce périmètre) persiste et restaure
 * UNIQUEMENT cette liste plate via `setAll`. Tant que la persistance n'aura pas été étendue aux
 * groupes (agent ultérieur), un rechargement replie l'ensemble sur un unique groupe « Principal »
```
par :
```
 * GROUPES (roadmap 1.4) : `groups` liste les onglets (défaut « Principal ») ; `activeGroupId`
 * désigne l'onglet affiché. Le champ `symbols` est un MIROIR en lecture du groupe actif.
 * PERSISTANCE : store/persist.ts sauvegarde et restaure le format à GROUPES complet
 * ({groups, activeGroupId, sources} — cf. saveWatchlist/hydrateWatchlist) ; l'ancienne
 * liste plate ne subsiste que comme format de MIGRATION à la lecture
```
(⚠️ conserver tel quel le point final / la suite de la phrase d'origine à la ligne suivante si elle continue — ajuster le fragment exact à l'édition).

- [ ] **Étape 12 : relancer les tests des fichiers touchés + commit** — `pnpm --filter @axiom/web exec vitest run src/store/persist.test.ts src/store/watchlist.test.ts src/store/compare.test.ts src/store/orderflow.test.ts` → vert (commentaires seuls). `git add apps/web/src/store/orderflow.ts apps/web/src/store/volumeProfile.ts apps/web/src/store/compare.ts apps/web/src/store/watchlist.ts && git commit -m "docs(web): en-tetes de stores alignes sur la persistance reelle (sessionUi/watchlist)"`

---

### Task C.2 : Dessins persistés par slot (clé « slot:exchange:symbole » + migration)

**Constat couvert :** « Persistance des dessins : deux slots sur le même actif s'écrasent mutuellement (perte silencieuse) » (apps/web/src/chart/drawing.ts:349, haute). NB : le correctif retenu est la clé PAR SLOT avec migration des clés existantes (directive du lot, cohérente avec BUILD-CONTRACT « les overlays doivent être scellés au slot », plan 2026-08-24 Lot 3) — pas la fusion par identité suggérée en alternative par le constat (elle exigerait des ids stables persistés qui n'existent pas dans `SavedOverlay`).

**Files:**
- Modify: apps/web/src/chart/drawing.ts:321-354 (storageKey/persistEntry), 434-467 (restoreDrawings)
- Test: apps/web/src/chart/drawing.test.ts

- [ ] **Étape 1 : écrire les tests qui échouent** — dans `apps/web/src/chart/drawing.test.ts`, ajouter en fin de fichier (réutilise `createMockChart`, `installMockLocalStorage`, `readStoredCount`, `DRAWINGS_KEY`, `EXCHANGE`, `SYMBOL` du fichier) :

```ts
describe("drawing.ts — slots scellés : même actif affiché sur deux slots", () => {
  let localStorage: Storage;

  beforeEach(() => {
    localStorage = installMockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("un dessin posé sur le slot 1 n'efface pas le dessin persisté du slot 0 (grille liée, même symbole)", () => {
    const a = createMockChart(); // slot 0 = binance:BTCUSDT
    a.setIdPrefix("a-");
    const b = createMockChart(); // slot 1 = binance:BTCUSDT (liaison ⛓ : même actif)
    b.setIdPrefix("b-");
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    bindChart(b.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 1);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);
    restoreDrawings(b.chart, EXCHANGE, SYMBOL);

    setFocusChart(0);
    selectTool("trendLine");
    a.finishDraw("a-ov-0", [{ timestamp: 1, value: 100 }, { timestamp: 2, value: 110 }]);
    expect(readStoredCount(localStorage, "0:binance:BTCUSDT")).toBe(1);

    // AVANT le fix : persistEntry(slot 1) réécrivait la clé PARTAGÉE « binance:BTCUSDT »
    // avec la map du slot 1 (qui n'a jamais vu le segment du slot 0) → perte silencieuse.
    setFocusChart(1);
    selectTool("rect");
    b.finishDraw("b-ov-0", [{ timestamp: 3, value: 30 }, { timestamp: 4, value: 40 }]);

    expect(readStoredCount(localStorage, "0:binance:BTCUSDT")).toBe(1); // intact
    expect(readStoredCount(localStorage, "1:binance:BTCUSDT")).toBe(1);
    unbindChart(a.chart);
    unbindChart(b.chart);
  });

  it("migration : la clé partagée « exchange:symbole » existante est COPIÉE vers la clé du slot à la première lecture (et conservée pour les autres slots)", () => {
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify({
        "binance:BTCUSDT": [{ name: "segment", points: [{ timestamp: 1, value: 100 }] }],
      })
    );

    const a = createMockChart();
    bindChart(a.chart, { exchange: EXCHANGE, symbol: SYMBOL }, 0);
    restoreDrawings(a.chart, EXCHANGE, SYMBOL);

    const all = JSON.parse(localStorage.getItem(DRAWINGS_KEY) ?? "{}") as Record<string, unknown[]>;
    expect(all["0:binance:BTCUSDT"]?.length).toBe(1); // copié vers la clé scellée au slot
    expect(all["binance:BTCUSDT"]?.length).toBe(1); // conservé : source d'héritage des AUTRES slots
    unbindChart(a.chart);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/chart/drawing.test.ts` → les 2 nouveaux tests échouent (`expected 0 to be 1` sur `"0:binance:BTCUSDT"` : la clé slot n'existe pas encore).

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/chart/drawing.ts` :

Remplacer `storageKey` (l.323-326) par :

```ts
/** Clé de stockage d'un SLOT : « slot:exchange:symbole ». Le préfixe numérique scelle
 * les dessins au slot (BUILD-CONTRACT / plan 2026-08-24 Lot 3) : deux slots affichant
 * le MÊME actif (grille liée ⛓) ne s'écrasent plus mutuellement. Aucun id d'exchange
 * n'étant numérique, pas d'ambiguïté avec l'ancienne clé partagée. */
function storageKey(slot: number, exchange: string, symbol: string): string {
  return `${slot}:${exchange}:${symbol}`;
}

/** Ancienne clé PARTAGÉE entre slots (« exchange:symbole ») : source de migration à la
 * lecture. Conservée après copie (les autres slots doivent pouvoir en hériter aussi) ;
 * plus jamais réécrite. */
function legacyKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}
```

Dans `persistEntry` (l.349), remplacer :
```ts
    all[storageKey(entry.exchange, entry.symbol)] = Array.from(entry.liveOverlays.values());
```
par :
```ts
    all[storageKey(entry.slot, entry.exchange, entry.symbol)] = Array.from(entry.liveOverlays.values());
```

Dans `restoreDrawings` (l.441-461), remplacer le bloc lecture + migration :
```ts
  const all = readAll();
  const key = storageKey(exchange, symbol);
  let list = all[key];

  // Migration douce du schéma v1 : …
  if (list === undefined && exchange === "binance") {
    const legacy = all[symbol];
    if (legacy !== undefined) {
      list = legacy;
      all[key] = legacy;
      delete all[symbol];
      try {
        writeAll(all);
      } catch {
        /* best-effort : si l'écriture de reprise échoue, on rejoue quand même les dessins */
      }
    }
  }
```
par :
```ts
  const all = readAll();
  const key = storageKey(entry.slot, exchange, symbol);
  let list = all[key];

  // Migration douce v2 : l'ancien stockage PARTAGEAIT « exchange:symbole » entre slots.
  // À la première lecture d'un slot, on COPIE ces dessins vers sa clé scellée — sans
  // retirer l'entrée héritée (les autres slots affichant le même actif en héritent au
  // même titre ; elle n'est plus jamais réécrite).
  if (list === undefined) {
    const partages = all[legacyKey(exchange, symbol)];
    if (partages !== undefined) {
      list = partages;
      all[key] = partages;
      try {
        writeAll(all);
      } catch {
        /* best-effort : si l'écriture de reprise échoue, on rejoue quand même les dessins */
      }
    }
  }

  // Migration douce v1 (héritage « symbole » nu, implicitement Binance) : reprise vers
  // la clé partagée (pour que les autres slots héritent) ET la clé du slot courant,
  // puis retrait de l'entrée plate (comportement historique conservé).
  if (list === undefined && exchange === "binance") {
    const legacy = all[symbol];
    if (legacy !== undefined) {
      list = legacy;
      all[key] = legacy;
      all[legacyKey(exchange, symbol)] = legacy;
      delete all[symbol];
      try {
        writeAll(all);
      } catch {
        /* best-effort */
      }
    }
  }
```

Mettre à jour le commentaire de section (l.312-319) : remplacer « Stockage par « EXCHANGE:SYMBOLE » » par « Stockage par « SLOT:EXCHANGE:SYMBOLE » (scellé au slot) » et la phrase d'en-tête de module (l.9-10) « Chaque instance persiste ses propres dessins sous « exchange:symbole » — les slots ne se marchent pas dessus. » par « Chaque instance persiste ses propres dessins sous « slot:exchange:symbole » — les slots ne se marchent pas dessus, même sur un actif identique. »

- [ ] **Étape 4 : adapter les tests existants qui figeaient l'ancienne clé** — dans `drawing.test.ts` :
  - `const COMPOSITE_KEY = "binance:BTCUSDT";` → ajouter dessous `const SLOT0_KEY = "0:binance:BTCUSDT";` et changer la valeur par défaut : `function readStoredCount(localStorage: Storage, key = SLOT0_KEY): number`.
  - Test d'isolation multi-chart (l.218-251) : remplacer les 4 clés `"binance:ETHUSDT"` / `"binance:BTCUSDT"` par `"1:binance:ETHUSDT"` / `"0:binance:BTCUSDT"`.
  - Test migration v1 (l.361-379) : remplacer `expect(all[COMPOSITE_KEY]?.length).toBe(1); // repris sous la clé composite` par :
```ts
    expect(all[SLOT0_KEY]?.length).toBe(1); // repris sous la clé scellée au slot
    expect(all[COMPOSITE_KEY]?.length).toBe(1); // clé partagée semée (héritage des autres slots)
```

- [ ] **Étape 5 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/chart/drawing.test.ts` → tout vert (nouveaux + existants adaptés).

- [ ] **Étape 6 : commit** — `git add apps/web/src/chart/drawing.ts apps/web/src/chart/drawing.test.ts && git commit -m "fix(chart): dessins persistes par slot (cle slot:exchange:symbole + migration douce)"`

---

### Task C.3 : Hydratation par élément des stores riches (alerts / paper / presetAlerts)

**Constat couvert :** « Hydratation non validée par élément (alerts/paper/presetAlerts) : un item corrompu casse le boot entier » (apps/web/src/store/alerts.ts:111, moyenne). Patron appliqué : `estTradeValide` d'expy.ts (validateur par item, champs requis + types ; l'item invalide est écarté, pas le boot). `notes.ts`/`portfolio.ts`, cités par le constat, sont HORS périmètre de cette tâche (voir avertissements du fragment).

**Files:**
- Modify: apps/web/src/store/alerts.ts:104-117
- Modify: apps/web/src/store/paper.ts:88-105 (chargerPaper)
- Modify: apps/web/src/store/presetAlerts.ts:88-101 (lirePresetAlerts)
- Test: apps/web/src/store/alerts.test.ts, apps/web/src/store/paper.test.ts, apps/web/src/store/presetAlerts.test.ts

- [ ] **Étape 1 : écrire les tests qui échouent** —

Dans `apps/web/src/store/alerts.test.ts`, ajouter `lireInitial` à l'import depuis `"./alerts"` et, en fin de fichier (mock localStorage : même patron que presetAlerts.test.ts) :

```ts
describe("lireInitial — hydratation par élément (un item corrompu est écarté, pas le boot cassé)", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    const mock: Storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size;
      },
    };
    (globalThis as { localStorage?: Storage }).localStorage = mock;
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("écarte les defs null / sans condition et conserve les valides", () => {
    // {"id":"x","actif":true} sans condition : resyncTicker ferait `d.condition.type`
    // → TypeError dans le useEffect de App → ErrorBoundary racine à CHAQUE boot.
    localStorage.setItem(
      "axiom:alerts:v1",
      JSON.stringify({
        defs: [
          null,
          { id: "x", actif: true },
          {
            id: "ok",
            symbol: "BTCUSDT",
            source: "binance",
            condition: { type: "prix-croise", niveau: 100, sens: "hausse" },
            actif: true,
            declenchements: [],
          },
        ],
        journal: [null, 42, { alertId: "ok", ts: 1, valeur: 2, message: "m" }],
      })
    );

    const etat = lireInitial();

    expect(etat.defs.map((d) => d.id)).toEqual(["ok"]);
    expect(etat.journal).toHaveLength(1);
  });
});
```

Dans `apps/web/src/store/paper.test.ts`, ajouter au `describe("persistance")` existant (la clé et `chargerPaper` sont déjà importées) :

```ts
  it("chargerPaper écarte les ordres/positions/exécutions corrompus item par item (boot préservé)", () => {
    // Un ordre null ferait planter symbolesActifs (`o.symbol`) au démarrage du moteur.
    localStorage.setItem(
      PAPER_STORAGE_KEY,
      JSON.stringify({
        solde: 50_000,
        ordres: [
          null,
          { id: "o1" }, // sans symbol/direction/taille
          { id: "ok", symbol: "BTCUSDT", direction: "long", type: "limit", prixLimite: 10, prixStop: null, taille: 1, tp: null, sl: null, creeTs: 1 },
        ],
        positions: [{ pas: "une position" }],
        executions: [null],
      })
    );

    const relu = chargerPaper();

    expect(relu.solde).toBe(50_000);
    expect(relu.ordres.map((o) => o.id)).toEqual(["ok"]);
    expect(relu.positions).toEqual([]);
    expect(relu.executions).toEqual([]);
  });
```

(si `PAPER_STORAGE_KEY` n'est pas déjà importé dans ce fichier de test, l'ajouter à l'import depuis `"./paper"` — il est exporté.)

Dans `apps/web/src/store/presetAlerts.test.ts`, ajouter au `describe("presetAlertsStore")` (mock localStorage déjà en place) :

```ts
  it("lirePresetAlerts écarte un item sans champs requis au lieu de le charger (resyncPreset lit a.actif/a.periodeMin)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        null,
        { id: "corrompu" }, // sans periodeMin/actif/conditions
        {
          id: "ok",
          presetId: "p1",
          nom: "Momentum",
          tf: "1h",
          baseConditions: [],
          indicatorConditions: [],
          periodeMin: 15,
          actif: true,
          creeTs: 1,
        },
      ])
    );

    expect(lirePresetAlerts().map((a) => a.id)).toEqual(["ok"]);
  });
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/alerts.test.ts src/store/paper.test.ts src/store/presetAlerts.test.ts` → échecs attendus : alerts (`lireInitial` non exporté → erreur d'import), paper (`expected [ null, {id:'o1'}, … ] … to equal ['ok']`), presetAlerts (`expected ['corrompu','ok'] to equal ['ok']` — le null est-il gardé ? le cast actuel garde TOUT le tableau).

- [ ] **Étape 3 : implémentation minimale** —

`apps/web/src/store/alerts.ts` — au-dessus de `lireInitial`, ajouter les gardes, puis filtrer et exporter :

```ts
/** Garde de forme d'une def persistée (patron `estTradeValide` d'expy.ts) : champs
 * requis + types. Un item corrompu est ÉCARTÉ à l'hydratation — sans cette garde,
 * `demarrerAlertes` (App.tsx, useEffect sans try/catch) lit `d.actif && d.condition.type`
 * → TypeError → ErrorBoundary racine à CHAQUE boot tant que la clé n'est pas purgée. */
function estAlertDefValide(v: unknown): v is AlertDef {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id.length === 0) return false;
  if (typeof d.symbol !== "string" || typeof d.source !== "string") return false;
  if (typeof d.actif !== "boolean") return false;
  if (!d.condition || typeof d.condition !== "object") return false;
  if (typeof (d.condition as Record<string, unknown>).type !== "string") return false;
  if (!Array.isArray(d.declenchements) || !d.declenchements.every((t) => typeof t === "number")) return false;
  return true;
}

/** Garde de forme d'une entrée de journal persistée. */
function estDeclenchementValide(v: unknown): v is Declenchement {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.alertId === "string" &&
    typeof d.ts === "number" &&
    typeof d.valeur === "number" &&
    typeof d.message === "string"
  );
}
```

et remplacer `lireInitial` (l.105-117) par :

```ts
/** Lecture tolérante de l'état persisté, validée PAR ÉLÉMENT (localStorage absent /
 * JSON corrompu / item invalide => écarté). Exportée pour les tests. */
export function lireInitial(): Persiste {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { defs: [], journal: [] };
    const parsed = JSON.parse(raw) as Partial<Persiste>;
    return {
      defs: Array.isArray(parsed.defs) ? parsed.defs.filter(estAlertDefValide) : [],
      journal: Array.isArray(parsed.journal) ? parsed.journal.filter(estDeclenchementValide) : [],
    };
  } catch {
    return { defs: [], journal: [] };
  }
}
```

`apps/web/src/store/paper.ts` — compléter l'import de types : `import { …, type EtatPaper, type OrdrePaper, type PositionPaper, type ExecutionPaper } from "../data/paper";` puis, au-dessus de `chargerPaper`, ajouter :

```ts
// ─── Gardes de forme des items persistés (patron estTradeValide d'expy.ts) ───
// Un item corrompu (ordre null, position sans symbol…) ferait planter symbolesActifs
// (`o.symbol`) au démarrage du moteur (App.tsx) : il est écarté à la lecture.
const estNombre = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x);
const estNombreOuNull = (x: unknown): boolean => x === null || estNombre(x);

function estOrdreValide(v: unknown): v is OrdrePaper {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.symbol !== "string") return false;
  if (o.direction !== "long" && o.direction !== "short") return false;
  if (o.type !== "market" && o.type !== "limit" && o.type !== "stop") return false;
  if (!estNombreOuNull(o.prixLimite) || !estNombreOuNull(o.prixStop)) return false;
  if (!estNombre(o.taille) || !estNombre(o.creeTs)) return false;
  return estNombreOuNull(o.tp) && estNombreOuNull(o.sl);
}

function estPositionValide(v: unknown): v is PositionPaper {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.symbol !== "string") return false;
  if (p.direction !== "long" && p.direction !== "short") return false;
  if (!estNombre(p.taille) || !estNombre(p.prixEntree) || !estNombre(p.ouvertTs)) return false;
  return estNombreOuNull(p.tp) && estNombreOuNull(p.sl);
}

function estExecutionValide(v: unknown): v is ExecutionPaper {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.symbol !== "string") return false;
  if (e.direction !== "long" && e.direction !== "short") return false;
  if (!["ouverture", "renfort", "tp", "sl", "cloture-manuelle"].includes(e.genre as string)) return false;
  if (!estNombre(e.ts) || !estNombre(e.taille) || !estNombre(e.prix) || !estNombre(e.fraisUsd)) return false;
  return estNombreOuNull(e.pnlUsd);
}
```

et dans `chargerPaper`, remplacer les trois lignes de cast :

```ts
      ordres: Array.isArray(p.ordres) ? p.ordres.filter(estOrdreValide) : [],
      positions: Array.isArray(p.positions) ? p.positions.filter(estPositionValide) : [],
      executions: Array.isArray(p.executions) ? p.executions.filter(estExecutionValide) : [],
```

(NB : `PositionPaper` et `ExecutionPaper` sont bien exportés par `data/paper.ts`.)

`apps/web/src/store/presetAlerts.ts` — au-dessus de `lirePresetAlerts` :

```ts
/** Garde de forme d'une alerte persistée (patron estTradeValide d'expy.ts) : un item
 * corrompu est écarté à la lecture — `resyncPreset` lit `a.actif`/`a.periodeMin` sans filet. */
function estAlertePresetValide(v: unknown): v is AlertePreset {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.presetId === "string" &&
    typeof a.nom === "string" &&
    typeof a.tf === "string" &&
    Array.isArray(a.baseConditions) &&
    Array.isArray(a.indicatorConditions) &&
    (a.periodeMin === 15 || a.periodeMin === 60) &&
    typeof a.actif === "boolean" &&
    typeof a.creeTs === "number"
  );
}
```

et remplacer `return Array.isArray(parsed) ? (parsed as AlertePreset[]) : [];` par `return Array.isArray(parsed) ? parsed.filter(estAlertePresetValide) : [];`.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/alerts.test.ts src/store/paper.test.ts src/store/presetAlerts.test.ts` → nouveaux tests verts, tests existants intacts (les round-trips écrivent des items complets, tous valides).

- [ ] **Étape 5 : commit** — `git add apps/web/src/store/alerts.ts apps/web/src/store/alerts.test.ts apps/web/src/store/paper.ts apps/web/src/store/paper.test.ts apps/web/src/store/presetAlerts.ts apps/web/src/store/presetAlerts.test.ts && git commit -m "fix(web): hydratation par element des stores alerts/paper/presetAlerts (item corrompu ecarte, boot preserve)"`

---

### Task C.4 : Slot secondaire — dérivation de la source pour les symboles synthétiques

**Constat couvert :** « Slot secondaire : symbole synthétique (TOTAL, ratios SYN) accepté avec une source réelle → pane en erreur permanente, propagée au maître si liaison » (apps/web/src/store/chart-layout.ts:190, moyenne)

**Files:**
- Modify: apps/web/src/store/market.ts:162 (export d'`exchangeForSymbol` — signature inchangée)
- Modify: apps/web/src/store/chart-layout.ts:22, 179-196 (patchSlot)
- Test: apps/web/src/store/chart-layout.test.ts

**Interfaces:** `market.ts` exporte `export function exchangeForSymbol(state: Pick<MarketState, "exchange" | "symbol">, nextSymbol: string): ExchangeId` (fonction existante, seul le mot-clé `export` est ajouté) — consommée par chart-layout.ts.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter à `apps/web/src/store/chart-layout.test.ts` :

```ts
describe("chartLayoutStore — dérivation de source sur symbole synthétique (parité avec le maître)", () => {
  it("« TOTAL » tapé dans un slot binance bascule le slot sur la source synthetic", () => {
    // Avant : binance+TOTAL était ACCEPTÉ par sanitizeSlotConfig et PERSISTÉ →
    // backfill Binance 400 « Invalid symbol » → pane en erreur à chaque boot.
    chartLayoutStore.getState().setSlotSymbol(1, "TOTAL");

    const slot = chartLayoutStore.getState().slots[0];
    expect(slot.symbol).toBe("TOTAL");
    expect(slot.exchange).toBe("synthetic");
  });

  it("un symbole SYN encodé bascule sur synthetic ; quitter le ratio revient à la jambe A", () => {
    chartLayoutStore.getState().setSlotSymbol(1, "kraken:ETHUSD|/|binance:BTCUSDT");
    expect(chartLayoutStore.getState().slots[0].exchange).toBe("synthetic");

    chartLayoutStore.getState().setSlotSymbol(1, "ETHUSD");
    const slot = chartLayoutStore.getState().slots[0];
    expect(slot.exchange).toBe("kraken"); // jambe A du ratio quitté (même règle que market.ts)
    expect(slot.symbol).toBe("ETHUSD");
  });

  it("le chemin ChartGrid (setSlotMarket avec exchange INCHANGÉ, spread d'en-tête) dérive aussi", () => {
    chartLayoutStore
      .getState()
      .setSlotMarket(1, { exchange: "binance", symbol: "TOTAL", timeframe: "1h" });
    expect(chartLayoutStore.getState().slots[0].exchange).toBe("synthetic");
  });

  it("un changement de source EXPLICITE reste prioritaire (pas de dérivation)", () => {
    chartLayoutStore
      .getState()
      .setSlotMarket(1, { exchange: "kraken", symbol: "ETHUSD", timeframe: "1h" });
    expect(chartLayoutStore.getState().slots[0].exchange).toBe("kraken");
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/chart-layout.test.ts` → 3 premiers tests échouent : `expected 'binance' to be 'synthetic'` (le 4ᵉ passe déjà).

- [ ] **Étape 3 : implémentation minimale** —

`apps/web/src/store/market.ts` (l.162) : `function exchangeForSymbol(` → `export function exchangeForSymbol(` (rien d'autre ne change — la docstring de la fonction explique déjà la règle).

`apps/web/src/store/chart-layout.ts` : compléter l'import l.22 → `import { exchangeForSymbol, normalizeMarketSymbol } from "./market";` puis remplacer le corps de `patchSlot` (l.186-195) :

```ts
  const i = gridSlot - 1; // 1..3 → 0..2
  if (i < 0 || i > 2) return slots;
  const cur = slots[i];
  if (cur === undefined) return slots;
  const next = slots.slice() as [SlotConfig, SlotConfig, SlotConfig];
  const symbol = patch.symbol !== undefined ? normalizeMarketSymbol(patch.symbol) : cur.symbol;
  // Changement de SYMBOLE sans changement de SOURCE explicite : même dérivation que le
  // maître (market.ts exchangeForSymbol) — TOTAL/SYN encodé ⇒ `synthetic`, quitter un
  // ratio ⇒ source de la jambe A. Sans elle, « TOTAL » tapé dans l'en-tête d'un slot
  // binance produisait binance+TOTAL, accepté et PERSISTÉ (pane en erreur à chaque
  // boot, propagé au maître via la liaison). Une source posée EXPLICITEMENT gagne.
  const exchangeExplicite = patch.exchange !== undefined && patch.exchange !== cur.exchange;
  const exchange =
    !exchangeExplicite && symbol !== cur.symbol
      ? exchangeForSymbol({ exchange: cur.exchange, symbol: cur.symbol }, symbol)
      : (patch.exchange ?? cur.exchange);
  next[i] = sanitizeSlotConfig(
    { exchange, symbol, timeframe: patch.timeframe ?? cur.timeframe },
    cur,
  );
  return next;
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/chart-layout.test.ts src/store/market.test.ts src/store/market.symbol-source.test.ts` → tout vert (le TF du slot TOTAL retombe sur "1h" via `sanitizeSlotConfig`, comportement déjà couvert).

- [ ] **Étape 5 : commit** — `git add apps/web/src/store/market.ts apps/web/src/store/chart-layout.ts apps/web/src/store/chart-layout.test.ts && git commit -m "fix(web): slot secondaire — derivation de la source synthetic alignee sur le maitre"`

---

### Task C.5 : Hotkeys — branche ⌥+flèches morte + fuite clavier derrière le panneau Réglages

**Constat couvert :**
- « Raccourcis ⌥+flèches (ancrage de fenêtre) morts : branche inaccessible » (apps/web/src/commands/hotkeys.ts:292, moyenne)
- « Échap sur le panneau Réglages minimise (ou ⇧Échap ferme) aussi la fenêtre flottante focalisée » (apps/web/src/commands/hotkeys.ts:274, moyenne)

**Files:**
- Modify: apps/web/src/commands/hotkeys.ts:242-300 (extraction du handler + réordonnancement des gardes)
- Test: apps/web/src/commands/hotkeys.test.ts

**Interfaces:** exporte `export function gererRaccourciGlobal(e: KeyboardEvent): void` (handler global extrait, corps inchangé hors fixes) — consommé par `useRaccourcisGlobaux` et par les tests de C.6.

- [ ] **Étape 1 : écrire les tests qui échouent** — dans `apps/web/src/commands/hotkeys.test.ts`, compléter les imports (`beforeEach` depuis vitest ; `gererRaccourciGlobal` depuis `./hotkeys` ; `settingsUiStore` depuis `../store/settings-ui` ; `windowManagerStore, type SnapZone` depuis `../store/windowManager` ; `orderflowStore` depuis `../store/orderflow` ; `marketStore` depuis `../store/market` ; `paletteStore` depuis `./registry`) et ajouter en fin de fichier :

```ts
// ─── Handler global (extrait pour être testable) ───

/** Événement clavier minimal (env Node : pas de KeyboardEvent natif). */
function ev(
  partiel: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>,
): KeyboardEvent {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    preventDefault: () => {},
    ...partiel,
  } as unknown as KeyboardEvent;
}

describe("gererRaccourciGlobal — ancrage ⌥+flèches et modale Réglages", () => {
  beforeEach(() => {
    // estChampEditable fait `target instanceof HTMLElement` : la classe n'existe pas en Node.
    (globalThis as { HTMLElement?: unknown }).HTMLElement = class {};
    settingsUiStore.getState().closeSettings();
    paletteStore.getState().fermer();
  });

  it("⌥→ ancre la fenêtre focalisée à droite (branche auparavant inaccessible : tout ⌥ sortait à la garde des modificateurs)", () => {
    const zones: Array<SnapZone | "restaurer"> = [];
    const originale = windowManagerStore.getState().ancrerFocalisee;
    windowManagerStore.setState({ ancrerFocalisee: (z: SnapZone | "restaurer") => void zones.push(z) });
    try {
      gererRaccourciGlobal(ev({ key: "ArrowRight", altKey: true }));
      gererRaccourciGlobal(ev({ key: "ArrowDown", altKey: true }));
      expect(zones).toEqual(["right", "restaurer"]);
    } finally {
      windowManagerStore.setState({ ancrerFocalisee: originale });
    }
  });

  it("Réglages ouvert : Échap et ⇧Échap n'atteignent plus la fenêtre flottante derrière la modale", () => {
    const appels: string[] = [];
    const etat = windowManagerStore.getState();
    const originales = {
      fenetreFocalisee: etat.fenetreFocalisee,
      minimizeWindow: etat.minimizeWindow,
      closeWindow: etat.closeWindow,
    };
    windowManagerStore.setState({
      fenetreFocalisee: () => "whales",
      minimizeWindow: (id: string) => void appels.push(`min:${id}`),
      closeWindow: (id: string) => void appels.push(`close:${id}`),
    });
    try {
      settingsUiStore.getState().openSettings();
      gererRaccourciGlobal(ev({ key: "Escape" }));
      gererRaccourciGlobal(ev({ key: "Escape", shiftKey: true }));
      expect(appels).toEqual([]); // la modale absorbe tout (SettingsPanel gère sa propre fermeture)

      settingsUiStore.getState().closeSettings();
      gererRaccourciGlobal(ev({ key: "Escape" }));
      expect(appels).toEqual(["min:whales"]); // comportement normal hors modale
    } finally {
      windowManagerStore.setState(originales);
      settingsUiStore.getState().closeSettings();
    }
  });

  it("Réglages ouvert : les toggles à une touche (O…) sont aussi neutralisés derrière la modale aria-modal", () => {
    marketStore.setState({ exchange: "binance", symbol: "BTCUSDT", timeframe: "1m" });
    orderflowStore.getState().setEnabled(false);

    settingsUiStore.getState().openSettings();
    gererRaccourciGlobal(ev({ key: "o" }));
    expect(orderflowStore.getState().enabled).toBe(false); // absorbé

    settingsUiStore.getState().closeSettings();
    gererRaccourciGlobal(ev({ key: "o" }));
    expect(orderflowStore.getState().enabled).toBe(true); // actif hors modale
    orderflowStore.getState().setEnabled(false);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/commands/hotkeys.test.ts` → échec attendu à l'import : `gererRaccourciGlobal` n'est pas exporté par `./hotkeys`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/web/src/commands/hotkeys.ts` :

1. Ajouter l'import : `import { settingsUiStore } from "../store/settings-ui";` (à côté des autres imports de stores).
2. Extraire le handler : remplacer, dans `useRaccourcisGlobaux`, `const onKey = (e: KeyboardEvent): void => {` … `};` par une fonction module-scope exportée placée AVANT le hook (corps identique, hors modifications 3-4 ci-dessous), et brancher le hook dessus :

```ts
/**
 * Handler keydown GLOBAL — extrait du hook pour être testable en Node (les stores sont
 * tous vanilla). Monté une seule fois par useRaccourcisGlobaux.
 */
export function gererRaccourciGlobal(e: KeyboardEvent): void {
  // …corps de l'ancien onKey…
}
```
et dans le `useEffect` : `window.addEventListener("keydown", gererRaccourciGlobal);` / cleanup `window.removeEventListener("keydown", gererRaccourciGlobal);`.

3. Réordonner les gardes : remplacer le bloc (anciennes l.264-269)

```ts
      // Tout autre raccourci navigateur (Cmd/Ctrl/Alt) : laissé au navigateur.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Palette ouverte : elle gère son propre clavier (⌘K déjà traité au-dessus).
      if (paletteStore.getState().ouvert) return;
      // Champ de saisie focalisé : on ne capture pas les touches nues.
      if (estChampEditable(e.target)) return;
```

par :

```ts
  // Palette ouverte : elle gère son propre clavier (⌘K déjà traité au-dessus).
  if (paletteStore.getState().ouvert) return;
  // Panneau Réglages ouvert (dialogue aria-modal) : AUCUNE touche globale ne doit agir
  // derrière — Échap minimisait (⇧Échap FERMAIT) la fenêtre flottante focalisée EN PLUS
  // de fermer le panneau, et F/T/O/V/L/R/chiffres/↑↓ restaient actives. SettingsPanel
  // gère lui-même Échap → fermeture du panneau.
  if (settingsUiStore.getState().open) return;
  // Champ de saisie focalisé : on ne capture pas les touches nues (⌥+flèches y navigue par mot).
  if (estChampEditable(e.target)) return;

  // ⌥ + flèches : ancrage de la fenêtre au premier plan (moitié gauche/droite, plein
  // workspace, retour à la géométrie d'avant). DOIT précéder le retour anticipé des
  // modificateurs ci-dessous : ce retour incluait e.altKey et rendait cette branche
  // INACCESSIBLE (l'ancrage clavier ne se déclenchait jamais, contredisant l'aide « ? »).
  if (e.altKey && !e.metaKey && !e.ctrlKey) {
    const zone = ANCRAGE_PAR_TOUCHE[e.key];
    if (zone !== undefined) {
      windowManagerStore.getState().ancrerFocalisee(zone);
      e.preventDefault();
    }
    return; // ⌥ + autre touche : laissé au navigateur/OS
  }
  // Tout autre raccourci navigateur (Cmd/Ctrl) : laissé au navigateur.
  if (e.metaKey || e.ctrlKey) return;
```

4. Supprimer l'ancien bloc ⌥+flèches devenu redondant (anciennes l.289-299, commentaire compris) — c'est un orphelin créé par le déplacement.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/commands/hotkeys.test.ts src/commands/registry.test.ts` → nouveaux tests verts + tests existants (helpers purs, mnémoniques) intacts.

- [ ] **Étape 5 : commit** — `git add apps/web/src/commands/hotkeys.ts apps/web/src/commands/hotkeys.test.ts && git commit -m "fix(web): hotkeys — ancrage \\u2325+fleches reactive et clavier neutralise derriere la modale Reglages"`

---

### Task C.6 : Hotkeys — timeframes clavier sur symboles synthétiques (supportedTimeframesFor)

**Constat couvert :** « Raccourcis timeframe clavier (1-9, [ / ]) morts sur tout symbole synthétique / capitalisation » (apps/web/src/commands/hotkeys.ts:330, moyenne). Dépend de C.5 (handler exporté `gererRaccourciGlobal` pour les tests).

**Files:**
- Modify: apps/web/src/commands/hotkeys.ts:21 (import), 328-357 (les 2 lectures TF)
- Test: apps/web/src/commands/hotkeys.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter à `hotkeys.test.ts` (réutilise le helper `ev` de C.5 ; `marketStore` déjà importé) :

```ts
describe("gererRaccourciGlobal — timeframes clavier sur symboles synthétiques", () => {
  beforeEach(() => {
    (globalThis as { HTMLElement?: unknown }).HTMLElement = class {};
    settingsUiStore.getState().closeSettings();
    paletteStore.getState().fermer();
  });

  it("la touche 5 (4h) fonctionne sur un ratio binance/binance (intersection des jambes, comme la Toolbar)", () => {
    // Avant : SUPPORTED_TIMEFRAMES["synthetic"] n'existe pas → [] → no-op silencieux,
    // alors que la Toolbar (supportedTimeframesFor) propose bien 1m→12M sur ce ratio.
    marketStore.setState({
      exchange: "synthetic",
      symbol: "binance:ETHUSDT|/|binance:BTCUSDT",
      timeframe: "1m",
    });

    gererRaccourciGlobal(ev({ key: "5", code: "Digit5" }));

    expect(marketStore.getState().timeframe).toBe("4h");
  });

  it("« ] » monte le TF d'un cran sur une capitalisation (TOTAL : 1h → 4h)", () => {
    marketStore.setState({ exchange: "synthetic", symbol: "TOTAL", timeframe: "1h" });

    gererRaccourciGlobal(ev({ key: "]" }));

    expect(marketStore.getState().timeframe).toBe("4h");
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/commands/hotkeys.test.ts` → les 2 tests échouent : `expected '1m' to be '4h'` / `expected '1h' to be '4h'` (no-op silencieux).

- [ ] **Étape 3 : implémentation minimale** — dans `hotkeys.ts` :
1. Remplacer l'import l.21 : `import { SUPPORTED_TIMEFRAMES } from "../data/adapters";` → `import { supportedTimeframesFor } from "../data/adapters";` (aucun autre usage de la table brute dans ce fichier).
2. Branche `[` / `]` :

```ts
      // [ / ] : timeframe plus bas / plus haut (NON circulaire, borné aux TF supportés).
      // `supportedTimeframesFor` (et non la table brute) : un synthétique/capitalisation
      // n'a pas d'entrée dans SUPPORTED_TIMEFRAMES — la Toolbar calcule l'intersection
      // des jambes, le clavier doit faire pareil (parité clavier/souris).
      if (e.key === "[" || e.key === "]") {
        const { exchange, symbol, timeframe } = marketStore.getState();
        const supportes = supportedTimeframesFor(exchange, symbol);
        const cible = timeframeVoisin(supportes, timeframe, e.key === "[" ? -1 : 1);
```
(le reste de la branche est inchangé).
3. Branche chiffres :

```ts
      // Timeframes rapides par code PHYSIQUE (AZERTY : e.key vaudrait & é " …).
      const tfCode = timeframePourCode(e.code, e);
      if (tfCode !== null) {
        const { exchange, symbol } = marketStore.getState();
        const supportes = supportedTimeframesFor(exchange, symbol);
        if (supportes.includes(tfCode)) marketStore.getState().setTimeframe(tfCode);
        return;
      }
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/commands/hotkeys.test.ts` → tout vert (pour une source non synthétique, `supportedTimeframesFor` renvoie exactement `SUPPORTED_TIMEFRAMES[exchange] ?? []` : aucun changement de comportement).

- [ ] **Étape 5 : commit** — `git add apps/web/src/commands/hotkeys.ts apps/web/src/commands/hotkeys.test.ts && git commit -m "fix(web): raccourcis TF clavier operants sur symboles synthetiques (supportedTimeframesFor)"`

---

### Task C.7 : SymbolBanner — reset de la variation 24 h au changement d'identité

**Constat couvert :** « SymbolBanner : la variation 24 h de l'ancien symbole reste affichée sur un symbole sans ticker (ratio ÷BTC, SYN, TOTAL) » (apps/web/src/components/SymbolBanner.tsx:350, moyenne)

**Files:**
- Modify: apps/web/src/components/SymbolBanner.tsx (helper exporté + appel en tête d'effet, ~l.299 et ~l.345)
- Test: apps/web/src/components/SymbolBanner.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter à `SymbolBanner.test.ts` (ajouter `resetVariation24h` à l'import existant depuis `./SymbolBanner`) :

```ts
describe("resetVariation24h", () => {
  it("remet le texte à « — » et la couleur au token neutre (variation de l'ancien symbole effacée)", () => {
    // Scénario : ETHUSDT affiche « +2,3 % », clic ÷BTC → exchange devient synthetic,
    // isTickerSource est faux → l'abonnement est un no-op et le DOM impératif garde
    // l'ancien texte : le reset en tête d'effet est le seul à l'effacer.
    const el = { textContent: "+2,3 %", style: { color: "var(--up)" } };

    resetVariation24h(el);

    expect(el.textContent).toBe("—");
    expect(el.style.color).toBe("var(--text)");
  });

  it("tolère une ref nulle (montage en cours)", () => {
    expect(() => resetVariation24h(null)).not.toThrow();
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/components/SymbolBanner.test.ts` → échec à l'import : `resetVariation24h` n'existe pas.

- [ ] **Étape 3 : implémentation minimale** — dans `SymbolBanner.tsx` :

1. Ajouter, à côté de `subscribeSymbolBannerTicker` (module scope, exporté) :

```ts
/**
 * Remet la variation 24 h à l'état neutre (« — », couleur de texte par défaut).
 * Le texte est écrit IMPÉRATIVEMENT dans le DOM (aucun re-render sur tick) : React ne
 * le rétablit pas au changement d'identité — sans ce reset, la variation de l'ANCIEN
 * symbole restait affichée indéfiniment sur un symbole SANS ticker (ratio ÷BTC, SYN,
 * TOTAL — isTickerSource("synthetic") est faux, l'abonnement est un no-op).
 * PURE (élément injecté), testée sans DOM.
 */
export function resetVariation24h(
  el: { textContent: string | null; style: { color: string } } | null,
): void {
  if (el === null) return;
  el.textContent = "—";
  el.style.color = "var(--text)";
}
```

2. Dans le `useEffect` d'identité (celui qui commence par `let changePct = Number.NaN;`), insérer l'appel juste avant le commentaire `// État initial (le backfill a pu déjà remplir le buffer avant ce montage).` :

```ts
    // Nouvelle identité : la variation de l'ancien symbole est effacée AVANT toute
    // souscription (elle ne sera ré-écrite que si la nouvelle source a un ticker).
    resetVariation24h(changeRef.current);
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/components/SymbolBanner.test.ts` → tout vert (les tests existants de `nextCloseTs`/`rolling24h`/`subscribeSymbolBannerTicker` sont inchangés). Vérification visuelle (hors CI) : ETHUSDT → clic ÷BTC → la variation affiche « — ».

- [ ] **Étape 5 : commit** — `git add apps/web/src/components/SymbolBanner.tsx apps/web/src/components/SymbolBanner.test.ts && git commit -m "fix(web): SymbolBanner — variation 24h remise a zero au changement d'identite"`

---

### Task C.8 : Palette ⌘K — TF gardés par supportedTimeframesFor + fuzzy insensible aux diacritiques

**Constat couvert :**
- « Recherche fuzzy sans normalisation des accents : “saisonnalite” ne trouve rien et propose de changer la paire vers SAISONNALITE » (apps/web/src/commands/registry.ts:254, moyenne)
- « Palette ⌘K : timeframes et navigation contournent SUPPORTED_TIMEFRAMES → pane chart en erreur » (apps/web/src/commands/registry.ts:390, basse)

**Files:**
- Modify: apps/web/src/commands/registry.ts:207-219 (appliquerNavigation), 251-306 (scoreFuzzy/rechercher), 310-314 (normaliserTexte déplacé/réutilisé), 379-391 (tf:*)
- Test: apps/web/src/commands/registry.test.ts

- [ ] **Étape 1 : écrire les tests qui échouent** — ajouter à `registry.test.ts` (imports déjà présents : `scoreFuzzy`, `rechercher`, `construireRegistre`, `appliquerNavigation`, `marketStore`, `toastsStore`, `retirerToast`, `type Commande`) :

```ts
describe("scoreFuzzy / rechercher — diacritiques normalisés (normaliserTexte réutilisé)", () => {
  it("« saisonnalite » (frappe naturelle sans accent) matche « Saisonnalité »", () => {
    // Vérifié sur l'algorithme actuel : renvoyait null contre TOUTES les cibles de SEAG,
    // et la palette proposait alors « Changer la paire → SAISONNALITE » (symbole poubelle).
    expect(scoreFuzzy("saisonnalite", "Saisonnalité")).not.toBeNull();
    expect(scoreFuzzy("saisonnalité", "saisonnalite")).not.toBeNull(); // sens inverse aussi
  });

  it("rechercher retrouve une commande par ses mots-clés accentués", () => {
    const cmds: Commande[] = [
      {
        id: "seag",
        mnemonique: "SEAG",
        libelle: "Saisonnalité",
        categorie: "panneau",
        motsCles: ["saisonnalité", "heatmap", "mensuel"],
        action: () => {},
      },
    ];
    expect(rechercher(cmds, "saisonnalite").map((c) => c.id)).toEqual(["seag"]);
  });
});

describe("commandes tf:* et navigation — garde des TF supportés (parité avec le clavier)", () => {
  it("tf:6M sur Coinbase ne change pas le TF et pousse un toast explicite", () => {
    const marketAvant = marketStore.getState();
    const toastIdsAvant = new Set(toastsStore.getState().toasts.map((t) => t.id));
    marketStore.setState({ exchange: "coinbase", symbol: "BTCUSDT", timeframe: "1h" });
    try {
      const cmd = construireRegistre().find((c) => c.id === "tf:6M");
      expect(cmd).toBeDefined();

      cmd?.action();

      expect(marketStore.getState().timeframe).toBe("1h"); // pas de setTimeframe → pas de backfill 400
      expect(toastsStore.getState().toasts.at(-1)?.texte).toContain("non supporté");
    } finally {
      marketStore.setState(marketAvant, true);
      for (const t of toastsStore.getState().toasts) {
        if (!toastIdsAvant.has(t.id)) retirerToast(t.id);
      }
    }
  });

  it("appliquerNavigation applique symbole+source mais ignore (avec toast) un TF non supporté par la cible", () => {
    const marketAvant = marketStore.getState();
    const toastIdsAvant = new Set(toastsStore.getState().toasts.map((t) => t.id));
    try {
      // Kraken ne supporte pas 3d (adapters.ts) : « BTC 3D KRAKEN » via ⌘K.
      appliquerNavigation({ source: "kraken", symbol: "ETHUSD", timeframe: "3d" });

      expect(marketStore.getState().exchange).toBe("kraken");
      expect(marketStore.getState().symbol).toBe("ETHUSD");
      expect(marketStore.getState().timeframe).toBe(marketAvant.timeframe); // TF inchangé
      expect(
        toastsStore.getState().toasts.some((t) => t.texte.includes("non supporté")),
      ).toBe(true);
    } finally {
      marketStore.setState(marketAvant, true);
      for (const t of toastsStore.getState().toasts) {
        if (!toastIdsAvant.has(t.id)) retirerToast(t.id);
      }
    }
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/commands/registry.test.ts` → échecs attendus : `expected null not to be null` (fuzzy), `expected '6M' to be '1h'` (tf:6M appliqué sans garde), TF `3d` appliqué par la navigation.

- [ ] **Étape 3 : implémentation minimale** — dans `registry.ts` :

1. Import : `import { supportedTimeframesFor } from "../data/adapters";` (à côté des autres imports data).
2. Fuzzy — déplacer `normaliserTexte` (l.310-314) AVANT `scoreFuzzy` (ou le laisser : les déclarations `function` sont hissées) et ajouter dessous :

```ts
/** Normalisation de RECHERCHE : sans accents (NFD) et en minuscules — réutilise
 * `normaliserTexte` (même règle que le focus sidebar) pour que « saisonnalite »
 * matche « Saisonnalité » dans les deux sens. */
function normaliserRecherche(s: string): string {
  return normaliserTexte(s).toLowerCase();
}
```

puis dans `scoreFuzzy` (l.252-254) :

```ts
  const q = normaliserRecherche(requete.trim());
  if (q.length === 0) return 0;
  const c = normaliserRecherche(cible);
```

et dans `rechercher`, le bonus mnémonique (l.299) :

```ts
    if (cmd.mnemonique !== undefined && normaliserRecherche(cmd.mnemonique).startsWith(normaliserRecherche(q))) {
```

3. Garde TF de `appliquerNavigation` (l.207-219) — remplacer `if (nav.timeframe !== undefined) m.setTimeframe(nav.timeframe);` par :

```ts
  if (nav.timeframe !== undefined) {
    // Garde alignée sur le chemin clavier (hotkeys) : la source/symbole viennent d'être
    // appliqués, on valide contre la capacité RÉELLE de la cible — sinon l'adaptateur
    // lève (« Coinbase: timeframe '6M' non supporté ») et le pane part en erreur.
    const { exchange, symbol } = marketStore.getState();
    if (supportedTimeframesFor(exchange, symbol).includes(nav.timeframe)) {
      m.setTimeframe(nav.timeframe);
    } else {
      pousserToast(`Timeframe ${nav.timeframe} non supporté sur cette source`);
    }
  }
```

4. Garde des commandes `tf:*` (l.390) — remplacer `action: () => marketStore.getState().setTimeframe(tf),` par :

```ts
      action: () => {
        // Même garde que le chemin clavier (pattern du toggle Orderflow : toast, pas d'état cassé).
        const { exchange, symbol } = marketStore.getState();
        if (!supportedTimeframesFor(exchange, symbol).includes(tf)) {
          pousserToast(`Timeframe ${tf} non supporté sur cette source`);
          return;
        }
        marketStore.getState().setTimeframe(tf);
      },
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/commands/registry.test.ts src/commands/hotkeys.test.ts` → nouveaux tests verts, tests existants intacts (scoreFuzzy sans accents : normalisation neutre ; unicité des mnémoniques inchangée).

- [ ] **Étape 5 : commit** — `git add apps/web/src/commands/registry.ts apps/web/src/commands/registry.test.ts && git commit -m "fix(web): palette — fuzzy insensible aux accents et TF gardes par supportedTimeframesFor"`

---

### Task C.9 : migrerJeuxPersistes valide les instances (docstring honorée)

**Constat couvert :** « migrerJeuxPersistes ne valide pas `instances` malgré sa docstring : rappeler un jeu corrompu jette dans assignInstanceIds » (apps/web/src/store/indicatorSets.ts:99, basse)

**Files:**
- Modify: apps/web/src/store/indicatorSets.ts:13-14 (import), 99
- Test: apps/web/src/store/indicatorSets.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter au `describe("migrerJeuxPersistes")` de `indicatorSets.test.ts` :

```ts
  it("valide les instances via migratePersistedIndicators : defId inconnu filtré, params backfillés, instanceId attribué", () => {
    // {"defId":"ema"} sans params : au rappel du jeu, assignInstanceIds ferait
    // shortHash(undefined) → TypeError silencieuse dans le handler de clic.
    const jeux = migrerJeuxPersistes([
      {
        id: "swing",
        nom: "Swing",
        instances: [{ defId: "ema" }, { defId: "disparu-du-registre", params: {} }, null],
      },
    ]);

    expect(jeux).toHaveLength(1);
    const instances = jeux[0]?.instances ?? [];
    expect(instances.map((i) => i.defId)).toEqual(["ema"]); // l'id fantôme et le null sont filtrés
    expect(instances[0]?.params).toEqual(expect.any(Object)); // params backfillés (défauts du registre)
    expect(typeof instances[0]?.instanceId).toBe("string"); // instanceId stable attribué
  });
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/store/indicatorSets.test.ts` → échec attendu : `expected [ 'ema', 'disparu-du-registre', null ] to deeply equal [ 'ema' ]` (le cast garde tout).

- [ ] **Étape 3 : implémentation minimale** — dans `indicatorSets.ts` :
1. Remplacer l'import de type : `import type { ActiveIndicator } from "./indicators";` → `import { migratePersistedIndicators, type ActiveIndicator } from "./indicators";`
2. À la l.99, remplacer :
```ts
    out.push({ id: e.id, nom: e.nom, instances: e.instances as ActiveIndicator[] });
```
par :
```ts
    // Migration RÉELLE des instances (la docstring le promettait, le cast ne le faisait
    // pas) : filtre les defId disparus du registre, backfille les params, attribue des
    // instanceId stables — le rappel d'un jeu ne peut plus jeter dans assignInstanceIds.
    out.push({ id: e.id, nom: e.nom, instances: migratePersistedIndicators(e.instances) });
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/store/indicatorSets.test.ts src/store/persist.test.ts` → tout vert (persist.test « réhydrate les jeux » passe des instances `sma` valides : conservées telles quelles).

- [ ] **Étape 5 : commit** — `git add apps/web/src/store/indicatorSets.ts apps/web/src/store/indicatorSets.test.ts && git commit -m "fix(web): migrerJeuxPersistes migre reellement les instances (defId filtres, params backfilles)"`

---

### Task C.10 : WHALES / onglet Flux — distinguer erreur daemon et daemon absent

**Constat couvert :** « WHALES / onglet Flux : une erreur du daemon est affichée comme “daemon absent” avec une consigne fausse » (apps/web/src/components/WhalesWindow.tsx:162, basse)

**Files:**
- Modify: apps/web/src/components/WhalesWindow.tsx:21 (import), 72 (type exporté), 160-165 (OngletFlux)
- Test: apps/web/src/components/WhalesWindow.test.ts (nouveau)

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/src/components/WhalesWindow.test.ts` :

```ts
/**
 * Test du mapping PUR « lecture nulle → statut » de la fenêtre WHALES. Le rendu React
 * n'est pas testé (pas de DOM ici) : on couvre la distinction daemon présent (erreur
 * douce) / daemon absent (consigne « pnpm run up ») — un pane qui ment sur la cause
 * viole le contrat « jamais de pane muet/malhonnête » (BUILD-CONTRACT).
 */
import { describe, expect, it } from "vitest";
import { statutLectureNulle } from "./WhalesWindow";

describe("statutLectureNulle", () => {
  it("daemon présent mais réponse nulle → « erreur » (pas la consigne de lancement, fausse)", () => {
    expect(statutLectureNulle(true)).toBe("erreur");
  });

  it("daemon absent → « sans-daemon » (consigne pnpm run up légitime)", () => {
    expect(statutLectureNulle(false)).toBe("sans-daemon");
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/components/WhalesWindow.test.ts` → échec à l'import : `statutLectureNulle` n'est pas exporté.

- [ ] **Étape 3 : implémentation minimale** — dans `WhalesWindow.tsx` :
1. Compléter l'import l.21 : `import { daemonSupporte, daemonSupporteHl, hlPositionsGet, whalesRecentGet } from "../data/daemon";`
2. Sous `type Statut = …` (l.72), ajouter :

```ts
/**
 * Statut d'un onglet quand la lecture renvoie null : `whalesRecentGet`/`hlPositionsGet`
 * renvoient null indifféremment daemon ABSENT ou daemon présent mais en échec (!ok /
 * throw). Daemon présent ⇒ « erreur » douce (premier scan en cours, échec amont) — PAS
 * la consigne « Lancer pnpm run up », fausse quand il tourne (même distinction que
 * l'onglet Positions). PURE, testée.
 */
export function statutLectureNulle(daemonPresent: boolean): Statut {
  return daemonPresent ? "erreur" : "sans-daemon";
}
```
3. Dans `OngletFlux` (l.161-164), remplacer :
```ts
      if (brut === null) {
        setStatut("sans-daemon");
        return;
      }
```
par :
```ts
      if (brut === null) {
        setStatut(statutLectureNulle(daemonSupporte("whales")));
        return;
      }
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/components/WhalesWindow.test.ts src/data/whales.test.ts` → vert. (Si l'onglet a déjà un rendu du statut « erreur » — oui : `mapperReponseWhales === null` l'utilise — aucun autre changement UI n'est requis.)

- [ ] **Étape 5 : commit** — `git add apps/web/src/components/WhalesWindow.tsx apps/web/src/components/WhalesWindow.test.ts && git commit -m "fix(web): WHALES — erreur daemon distinguee de l'absence de daemon (onglet Flux)"`

---

### Task C.11 : Constructeur SYN — jambe B par défaut valide pour Twelve Data

**Constat couvert :** « Constructeur SYN : jambe B par défaut “BTCUSDT” sur source Twelve Data, symbole inexistant dans ce catalogue » (apps/web/src/components/PairSearch.tsx:75, basse). Choix : garder `legBExchange = "twelvedata"` (intention du builder : crypto vs tradfi) et corriger le symbole en `"GLD"` (or — présent dans TWELVEDATA_SYMBOLS, cohérent avec les suggestions affichées sous le champ).

**Files:**
- Modify: apps/web/src/components/PairSearch.tsx:75-77
- Test: apps/web/src/components/PairSearch.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter à `PairSearch.test.ts` :

```ts
import { JAMBE_B_TRADFI_DEFAUT } from "./PairSearch";
import { TWELVEDATA_SYMBOLS } from "../data/pairs";

describe("constructeur SYN — jambe B par défaut", () => {
  it("le défaut de la jambe B appartient au catalogue Twelve Data (source pré-sélectionnée)", () => {
    // Avant : legB = "BTCUSDT" (format Binance) sur legBExchange = "twelvedata" →
    // « Charger » sans rien toucher produisait un synthétique dont la jambe tradfi
    // ne peut pas se charger (graphe en erreur sur le geste par défaut du panneau).
    expect(TWELVEDATA_SYMBOLS).toContain(JAMBE_B_TRADFI_DEFAUT);
  });
});
```
(placer les 2 imports en tête de fichier, à côté de l'import existant de `isBuilderQuery`.)

- [ ] **Étape 2 : lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/components/PairSearch.test.ts` → échec à l'import : `JAMBE_B_TRADFI_DEFAUT` n'est pas exporté.

- [ ] **Étape 3 : implémentation minimale** — dans `PairSearch.tsx`, au module scope (près de `isBuilderQuery`) :

```ts
/** Jambe B par défaut du builder SYN — DOIT exister dans TWELVEDATA_SYMBOLS (la source
 * pré-sélectionnée de la jambe B est twelvedata) : « BTCUSDT » (format Binance) y est
 * inconnu et cassait le « Charger » par défaut. GLD = or, cohérent avec les suggestions. */
export const JAMBE_B_TRADFI_DEFAUT = "GLD";
```

et l.77, remplacer `const [legB, setLegB] = useState("BTCUSDT");` par `const [legB, setLegB] = useState(JAMBE_B_TRADFI_DEFAUT);`.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/components/PairSearch.test.ts` → tout vert (les tests `isBuilderQuery` existants sont inchangés).

- [ ] **Étape 5 : commit** — `git add apps/web/src/components/PairSearch.tsx apps/web/src/components/PairSearch.test.ts && git commit -m "fix(web): builder SYN — jambe B par defaut GLD, valide dans le catalogue Twelve Data"`

---

## Vérification finale du lot

- [ ] `pnpm --filter @axiom/web exec vitest run` (suite complète du package web) puis `pnpm --filter @axiom/web run typecheck` → zéro régression avant de considérer le lot terminé.


## Plan de correction — Lot D « Indicateurs » (packages/indicators)

Contexte lu : `~/axiom/BUILD-CONTRACT.md` (TS strict `noUncheckedIndexedAccess`, commentaires FR, aucune dépendance nouvelle, `@axiom/types` figé), constats vérifiés `plan-lotD.json`. Commande de test du package (vérifiée dans `packages/indicators/package.json`, script `"test": "vitest run"`) :
`pnpm --filter @axiom/indicators exec vitest run <fichiers>` (et `pnpm --filter @axiom/indicators test` pour tout le package).

**Toutes les fixtures ci-dessous ont été validées numériquement avant rédaction** (simulation des algos corrigés contre les vrais helpers, exécutée avec bun) : les valeurs attendues des étapes 2 et 4 sont des résultats mesurés, pas des espoirs.

Aucun autre test du monorepo ne fige les valeurs actuelles de QQE / HalfTrend / stratDivergenceRsi (vérifié par grep : seuls `registry.ts`/`registry.test.ts` les référencent, sans valeur numérique) — aucun test à affaiblir ailleurs.

---

### Task D.1 : QQE — bascule de tendance contre les bandes de la barre précédente
**Constat couvert :** « QQE : bascule de tendance mathématiquement impossible — bandes fast/slow figées » (packages/indicators/src/momentum/qqe.ts:129, haute). Couvre AUSSI, pour QQE, le constat basse « couverture purement structurelle » (qqe.test.ts:28) : le nouveau test est un test de VALEUR/comportement (≥ 1 flip exigé), plus seulement `toBeDefined`.
**Files:**
- Modify: packages/indicators/src/momentum/qqe.ts:113-134
- Test: packages/indicators/src/momentum/qqe.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter ce test dans le `describe("qqe")` de `packages/indicators/src/momentum/qqe.test.ts` (le `import type { Candle }` et l'import de `qqe` existent déjà) :

```ts
  it("bascule de tendance : fast/slow échangent de côté quand le RSI lissé traverse les bandes", () => {
    // 5 phases de 40 barres à ±2 %/barre : le RSI lissé traverse franchement
    // les bandes à chaque retournement — le trend DOIT basculer (≥ 1 flip).
    // (Bug corrigé : tester rm contre les bandes DÉJÀ mises à jour rendait
    // rm > shortBand impossible → 0 flip sur toute la série.)
    const closes: number[] = [];
    let p = 100;
    for (let phase = 0; phase < 5; phase++) {
      const pas = phase % 2 === 0 ? 1.02 : 0.98;
      for (let b = 0; b < 40; b++) {
        p *= pas;
        closes.push(p);
      }
    }
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1,
    }));
    const { series } = qqe.calc(
      candles,
      { rsiLength: 14, sf: 5, factor: 4.236 },
      { hl2: [], hlc3: [], ohlc4: [], source: closes },
    );
    let flips = 0;
    let dessous = 0; // barres avec fast < slow (trend long)
    let dessus = 0; // barres avec fast > slow (trend short/neutre)
    let prevSign: number | undefined;
    for (let i = 0; i < closes.length; i++) {
      const f = series.fast?.[i];
      const s = series.slow?.[i];
      if (f === undefined || s === undefined) continue;
      if (f < s) dessous++;
      else if (f > s) dessus++;
      const sign = Math.sign(f - s);
      if (prevSign !== undefined && sign !== 0 && sign !== prevSign) flips++;
      if (sign !== 0) prevSign = sign;
    }
    expect(flips).toBeGreaterThanOrEqual(1);
    expect(dessous).toBeGreaterThanOrEqual(1);
    expect(dessus).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/indicators exec vitest run src/momentum/qqe.test.ts`
  Échec attendu (mesuré sur le code actuel : flips = 0, dessous = 0, dessus = 174) : `AssertionError: expected 0 to be greater than or equal to 1` sur `expect(flips)`.

- [ ] **Étape 3 : implémentation minimale** — dans `packages/indicators/src/momentum/qqe.ts`, remplacer le bloc lignes 116-130 (du commentaire `// Trailing bands` à la ligne `else if (rm < longBand && trend >= 0) trend = -1;` incluse) par :

```ts
      // Bandes de la barre PRÉCÉDENTE : la bascule se teste contre ELLES
      // (convention QQE : cross(RSIndex, shortband[1])). Tester contre les
      // bandes déjà mises à jour rendait `rm > shortBand` impossible
      // (newShort = rm + dar·factor ≥ rm) : le trend restait figé à jamais.
      const prevLongBand = longBand;
      const prevShortBand = shortBand;

      // Trailing bands (logique QQE classique).
      if (rm > prevLongBand && rsiMa[i - 1] !== undefined && rsiMa[i - 1]! > prevLongBand) {
        longBand = Math.max(prevLongBand, newLong);
      } else {
        longBand = newLong;
      }
      if (rm < prevShortBand && rsiMa[i - 1] !== undefined && rsiMa[i - 1]! < prevShortBand) {
        shortBand = Math.min(prevShortBand, newShort);
      } else {
        shortBand = newShort;
      }

      // Direction : croisement du RSI lissé avec la bande opposée PRÉCÉDENTE.
      if (rm > prevShortBand && trend <= 0) trend = 1;
      else if (rm < prevLongBand && trend >= 0) trend = -1;
```

  (Sémantique des mises à jour de bandes inchangée : `longBand`/`shortBand` étaient lus AVANT réassignation, `prevLongBand`/`prevShortBand` ne font que nommer cette valeur ; le seul changement de comportement est le test de bascule.)

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/indicators exec vitest run src/momentum/qqe.test.ts`
  Attendu : 2 tests verts (l'existant « ligne QQE bornée » + le nouveau). Résultats mesurés sur l'algo corrigé : flips = 3, dessous = 78, dessus = 96.

- [ ] **Étape 5 : commit** — `git add packages/indicators/src/momentum/qqe.ts packages/indicators/src/momentum/qqe.test.ts && git commit -m "fix(indicators): QQE — bascule testée contre les bandes de la barre précédente (flip à nouveau possible)"`

---

### Task D.2 : HalfTrend — règle de bascule canonique Everget
**Constat couvert :** « HalfTrend : conditions canoniques calculées puis jetées (blocs if vides), règle de bascule non conforme » (packages/indicators/src/trend/halfTrend.ts:67, haute). Couvre AUSSI, pour HalfTrend, le constat basse « couverture purement structurelle » (qqe.test.ts:28) : deux tests de comportement (anti-flip parasite + bascule obligatoire) remplacent le simple `dir ∈ {1,−1}`.
**Files:**
- Modify: packages/indicators/src/trend/halfTrend.ts:1-95 (en-tête, imports, cœur de la boucle ; les blocs de rendu up/down lignes 97-118 sont conservés tels quels)
- Test: packages/indicators/src/trend/halfTrend.test.ts

- [ ] **Étape 1 : écrire les tests qui échouent** — ajouter ces deux tests dans le `describe("halfTrend")` de `packages/indicators/src/trend/halfTrend.test.ts` (imports déjà présents) :

```ts
  it("pullback léger en tendance haussière : PAS de bascule parasite (règle canonique)", () => {
    // Montée +2/barre, pullback de 2 barres (closes −1 puis −0,5, avec
    // close < low[1]) puis reprise : la SMA(high, amplitude) reste AU-DESSUS
    // du plus haut des creux ratcheté → le HalfTrend canonique ne bascule PAS.
    // (L'ancienne règle `close < maxLowPrice` basculait ici : direction −1
    // parasite aux barres 30-31.)
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 30; i++) {
      p += 2;
      closes.push(p);
    }
    closes.push(p - 1);
    closes.push(p - 1.5);
    p = p - 1.5;
    for (let i = 0; i < 28; i++) {
      p += 2;
      closes.push(p);
    }
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1,
    }));
    const { series } = halfTrend.calc(
      candles,
      { amplitude: 2, atrPeriod: 10 },
      { hl2: [], hlc3: [], ohlc4: [], source: closes },
    );
    const barresBaissieres = (series.direction ?? [])
      .map((d, i) => (d === -1 ? i : -1))
      .filter((i) => i >= 0);
    expect(barresBaissieres).toEqual([]);
  });

  it("cassure franche : bascule haussière → baissière, un seul flip", () => {
    // 60 barres +2/barre puis 60 barres −2/barre : SMA(high, amplitude) passe
    // sous maxLowPrice ET close < low[1] → bascule baissière obligatoire,
    // unique (pas de flip-flop).
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 60; i++) {
      p += 2;
      closes.push(p);
    }
    for (let i = 0; i < 60; i++) {
      p -= 2;
      closes.push(p);
    }
    const candles: Candle[] = closes.map((close, i) => ({
      time: i,
      open: close,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1,
    }));
    const { series } = halfTrend.calc(
      candles,
      { amplitude: 2, atrPeriod: 10 },
      { hl2: [], hlc3: [], ohlc4: [], source: closes },
    );
    expect(series.direction?.[40]).toBe(1); // en pleine montée : haussier
    expect(series.direction?.[119]).toBe(-1); // après la cassure : baissier
    let flips = 0;
    for (let i = 1; i < 120; i++) {
      const d = series.direction?.[i];
      const dPrev = series.direction?.[i - 1];
      if (d !== undefined && dPrev !== undefined && d !== dPrev) flips++;
    }
    expect(flips).toBe(1);
    expect(series.line?.[119]).toBeDefined();
  });
```

- [ ] **Étape 2 : les lancer, vérifier l'échec** — `pnpm --filter @axiom/indicators exec vitest run src/trend/halfTrend.test.ts`
  Échec attendu (mesuré sur le code actuel) : le test « pullback léger » échoue avec `expected [ 30, 31 ] to deeply equal []` (l'ancienne règle bascule à −1 sur les 2 barres du pullback). Le test « cassure franche » passe déjà (l'ancien code flippait aussi sur une vraie cassure) : il est là comme garde anti-sur-correction (une règle qui ne basculerait plus jamais le ferait échouer).

- [ ] **Étape 3 : implémentation minimale** — dans `packages/indicators/src/trend/halfTrend.ts` :

  (a) remplacer l'en-tête (lignes 1-10) par :

```ts
/**
 * @axiom/indicators — trend/halfTrend.ts
 *
 * HalfTrend (règle canonique Everget) — suiveur ATR :
 *   bascule BAISSIÈRE si SMA(high, amplitude) < maxLowPrice (plus haut des
 *   creux ratcheté) ET close < low[1] ; miroir pour la bascule haussière.
 *   maxLowPrice/minHighPrice sont ratchetés sur les extrêmes ROULANTS
 *   (plus bas/plus haut des `amplitude` dernières barres).
 * Écart assumé vs Everget : la LIGNE est décalée de ±dev (dev = ATR·amplitude/2)
 * alors que le canonique trace up/down sans décalage et réserve dev au canal
 * atrHigh/atrLow (non exposé ici) — sans quoi l'input atrPeriod serait mort.
 * La règle de BASCULE, elle, est canonique.
 * Overlay : `line` + `direction` (+1 / −1).
 */
```

  (b) remplacer la ligne d'import `import { rma, trueRange } from "../utils";` par :

```ts
import { highOf, lowOf, rma, rollingHighest, rollingLowest, sma, trueRange } from "../utils";
```

  (c) remplacer le corps de `calc` depuis `const atrVals = rma(trueRange(candles), atrPeriod);` jusqu'à la fin du bloc `if/else` de bascule (ligne 95, l'accolade fermant `} else { … }` juste avant `if (trend === 0) {`) par :

```ts
    const atrVals = rma(trueRange(candles), atrPeriod);
    const highs = highOf(candles);
    const lows = lowOf(candles);
    // Briques canoniques Everget : SMA(high/low, amplitude) pour la condition
    // de bascule, extrêmes roulants pour le ratchet maxLow/minHigh.
    const smaHigh = sma(highs, amplitude);
    const smaLow = sma(lows, amplitude);
    const plusHaut = rollingHighest(highs, amplitude);
    const plusBas = rollingLowest(lows, amplitude);

    // 0 = up, 1 = down (convention Pine halfTrend)
    let trend = 0;
    let nextTrend = 0;
    let maxLowPrice = Number.NaN;
    let minHighPrice = Number.NaN;
    let up = Number.NaN;
    let down = Number.NaN;

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const atr = atrVals[i];
      if (c === undefined || atr === undefined) continue;
      const hma = smaHigh[i];
      const lma = smaLow[i];
      const highPrice = plusHaut[i];
      const lowPrice = plusBas[i];
      // atrPeriod ≥ amplitude en pratique (défauts 100 vs 2) mais les gardes
      // restent explicites (noUncheckedIndexedAccess).
      if (hma === undefined || lma === undefined || highPrice === undefined || lowPrice === undefined) {
        continue;
      }

      const close = c.close;
      const dev = (atr * amplitude) / 2;
      const prev = candles[i - 1];
      const prevLow = prev?.low ?? c.low; // nz(low[1], low)
      const prevHigh = prev?.high ?? c.high; // nz(high[1], high)

      if (Number.isNaN(maxLowPrice)) maxLowPrice = prevLow;
      if (Number.isNaN(minHighPrice)) minHighPrice = prevHigh;

      if (nextTrend === 1) {
        maxLowPrice = Math.max(lowPrice, maxLowPrice);
        // Bascule baissière canonique : SMA des highs passée SOUS le plus haut
        // des creux ratcheté ET close sous le low précédent.
        if (hma < maxLowPrice && close < prevLow) {
          trend = 1;
          nextTrend = 0;
          minHighPrice = highPrice;
        }
      } else {
        minHighPrice = Math.min(highPrice, minHighPrice);
        // Bascule haussière canonique (miroir).
        if (lma > minHighPrice && close > prevHigh) {
          trend = 0;
          nextTrend = 1;
          maxLowPrice = lowPrice;
        }
      }
```

  Les blocs de rendu `if (trend === 0) { … } else { … }` (up/down, reprise de l'ancienne ligne au basculement, `line[i]`/`direction[i]`) restent inchangés. Les lectures mortes `highBack`/`lowBack`/`back` et les deux `if` vides disparaissent avec ce remplacement (orphelins créés par le correctif : c'est le code mort dénoncé par le constat).

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/indicators exec vitest run src/trend/halfTrend.test.ts src/registry.test.ts`
  Attendu : 3 tests halfTrend verts (l'existant « direction ±1 sur une tendance » reste vert — vérifié par simulation : sur sa fixture +0,5/barre, `close` ne dépasse jamais `high[1]`, la direction reste +1 et `line[119]` est défini) + registry inchangé. Valeurs mesurées sur l'algo corrigé : fixture pullback → 0 barre à −1 ; fixture cassure → premier flip à la barre 62, direction[119] = −1, 1 seul flip.

- [ ] **Étape 5 : commit** — `git add packages/indicators/src/trend/halfTrend.ts packages/indicators/src/trend/halfTrend.test.ts && git commit -m "fix(indicators): HalfTrend — bascule canonique Everget (SMA vs extrême ratcheté + close vs low[1])"`

---

### Task D.3 : longueurs de fenêtre fractionnaires quantifiées
**Constat couvert :** « Longueur fractionnaire : resolveParams clampe sans quantifier → SMA cumulative fausse, EMA/RMA/RSI/ADX vides » (packages/indicators/src/engine.ts:97, moyenne). ⚠️ Correctif DIFFÉRENT du « Math.round après clamp dans resolveParams » suggéré : voir Avertissements (un arrondi global dans `resolveParams` casserait les inputs légitimement fractionnaires — `factor` 4.236 du QQE, multiplicateurs 2.5, `step` 0.02 du PSAR — et `IndicatorInput` de `@axiom/types` est FIGÉ, donc pas de flag `entier` possible). Le correctif quantifie à la source de vérité : les helpers de fenêtre de `utils.ts` (couvre sma/ema/rsi/adx/macd/vortex/klinger/ichimoku/alligator… qui passent tous par eux), plus les deux defs à indexation directe (`kama`, `fisher`) que le fix helpers ne suffit pas à réparer.
**Files:**
- Modify: packages/indicators/src/utils.ts:24-311 (8 helpers : sma, ema, rma, stdev, rollingHighest, rollingLowest, wma, rollingSum)
- Modify: packages/indicators/src/trend/kama.ts:32
- Modify: packages/indicators/src/momentum/fisher.ts:43
- Test: packages/indicators/src/utils.test.ts (NOUVEAU fichier)
- Test: packages/indicators/src/trend/kama.test.ts
- Test: packages/indicators/src/momentum/fisher.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — créer `packages/indicators/src/utils.test.ts` :

```ts
/**
 * @axiom/indicators — utils.test.ts
 *
 * Quantification des longueurs de fenêtre : une longueur fractionnaire (saisie
 * UI sans step, ex. 14.5) doit être arrondie à l'entier le plus proche, jamais
 * utilisée telle quelle — sinon `values[i - 14.5]` vaut undefined : la fenêtre
 * SMA ne se vide jamais (somme cumulée divergente) et EMA/RMA restent vides.
 */
import { describe, expect, it } from "vitest";
import {
  ema,
  rma,
  rollingHighest,
  rollingLowest,
  rollingSum,
  sma,
  stdev,
  wma,
} from "./utils";

const valeurs = Array.from({ length: 40 }, (_, i) => 100 + i);

describe("quantification des longueurs fractionnaires", () => {
  it("sma(14.5) === sma(15) — jamais de somme cumulée divergente", () => {
    expect(sma(valeurs, 14.5)).toEqual(sma(valeurs, 15));
  });

  it("ema/rma(14.5) non vides et égales à la version entière", () => {
    const e = ema(valeurs, 14.5);
    expect(e.some((v) => v !== undefined)).toBe(true);
    expect(e).toEqual(ema(valeurs, 15));
    expect(rma(valeurs, 14.5)).toEqual(rma(valeurs, 15));
  });

  it("helpers de fenêtre restants : wma/stdev/rollingSum/rollingHighest/rollingLowest", () => {
    expect(wma(valeurs, 9.5)).toEqual(wma(valeurs, 10));
    expect(stdev(valeurs, 9.5)).toEqual(stdev(valeurs, 10));
    expect(rollingSum(valeurs, 9.5)).toEqual(rollingSum(valeurs, 10));
    expect(rollingHighest(valeurs, 9.5)).toEqual(rollingHighest(valeurs, 10));
    expect(rollingLowest(valeurs, 9.5)).toEqual(rollingLowest(valeurs, 10));
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/indicators exec vitest run src/utils.test.ts`
  Échec attendu : `expected [ …, undefined, 462, 506.4, … ] to deeply equal [ …, 107, 107.5, … ]` sur le test sma (somme cumulée divisée par 14.5 — le constat a mesuré `sma(100..129, 2.5) → [462, 506.4, …]`), et `expected false to be true` sur `e.some(...)` (EMA entièrement vide : `out[length-1]` écrit une propriété non-entière).

- [ ] **Étape 3 : implémentation minimale** — dans `packages/indicators/src/utils.ts`, insérer en PREMIÈRE ligne du corps de chacune des 8 fonctions `sma`, `ema`, `rma`, `stdev`, `rollingHighest`, `rollingLowest`, `wma`, `rollingSum` (avant toute lecture de `length`). Pour `sma` :

```ts
  // Quantifie la fenêtre : une longueur fractionnaire produirait des index
  // fractionnaires (values[i - 14.5] === undefined) et une somme divergente.
  length = Math.round(length);
```

  Pour les 7 autres, la même ligne avec le commentaire court :

```ts
  length = Math.round(length); // fenêtre entière obligatoire (voir sma)
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/indicators exec vitest run src/utils.test.ts src/engine.test.ts`
  Attendu : 3 tests utils verts + le test `resolveParams` existant inchangé (il ne teste que des entiers).

- [ ] **Étape 5 : defs à indexation directe (kama, fisher) — test d'abord** — le fix helpers ne les répare pas : `kama` lit `close[i - length]` et `fisher` boucle `for (let i = length - 1; …)` avec la valeur brute → séries vides si fractionnaire. Ajouter dans le `describe` de `packages/indicators/src/trend/kama.test.ts` (utilise `candles` et `ctx` déjà définis en tête de fichier) :

```ts
  it("longueur fractionnaire quantifiée : kama(10.5) === kama(11), série non vide", () => {
    const frac = kama.calc(candles, { length: 10.5 }, ctx).series.kama;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(kama.calc(candles, { length: 11 }, ctx).series.kama);
  });
```

  Et dans le `describe` de `packages/indicators/src/momentum/fisher.test.ts` (utilise le helper `candle` du fichier) :

```ts
  it("longueur fractionnaire quantifiée : fisher(9.5) === fisher(10), série non vide", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const base = 100 + Math.sin(i * 0.5) * 10;
      candles.push(candle(i, base + 1, base - 1));
    }
    const frac = computeIndicator(fisher, candles, { length: 9.5 }).series.fisher;
    expect(frac?.some((v) => v !== undefined)).toBe(true);
    expect(frac).toEqual(computeIndicator(fisher, candles, { length: 10 }).series.fisher);
  });
```

  Lancer `pnpm --filter @axiom/indicators exec vitest run src/trend/kama.test.ts src/momentum/fisher.test.ts` → échec attendu : `expected false to be true` (les deux séries fractionnaires sont vides).

- [ ] **Étape 6 : implémentation kama/fisher** — dans `packages/indicators/src/trend/kama.ts`, remplacer :

```ts
    const length = Number(params.length ?? 10);
```

  par :

```ts
    // Quantifie : close[i - length] avec length fractionnaire = série vide.
    const length = Math.round(Number(params.length ?? 10));
```

  Dans `packages/indicators/src/momentum/fisher.ts`, remplacer :

```ts
    const length = Number(params.length);
```

  par :

```ts
    // Quantifie : la boucle `i = length - 1` fractionnaire n'atteint aucun index.
    const length = Math.round(Number(params.length));
```

- [ ] **Étape 7 : relancer, vérifier le vert** — `pnpm --filter @axiom/indicators exec vitest run src/utils.test.ts src/trend/kama.test.ts src/momentum/fisher.test.ts src/engine.test.ts src/golden`
  Attendu : tout vert, y compris les 4 golden pandas-ta (ADX/SuperTrend/Ichimoku/PSAR — leurs longueurs sont entières, `Math.round` est neutre : non-régression des valeurs de référence).

- [ ] **Étape 8 : commit** — `git add packages/indicators/src/utils.ts packages/indicators/src/utils.test.ts packages/indicators/src/trend/kama.ts packages/indicators/src/trend/kama.test.ts packages/indicators/src/momentum/fisher.ts packages/indicators/src/momentum/fisher.test.ts && git commit -m "fix(indicators): longueurs de fenêtre fractionnaires quantifiées (helpers utils + kama/fisher)"`

---

### Task D.4 : divergences — confirmation datée au pivot oscillateur
**Constat couvert :** « Divergences : look-ahead jusqu'à 3 barres via l'appariement du pivot oscillateur » (packages/indicators/src/strategy/stratDivergenceRsi.ts:43, moyenne).
**Files:**
- Modify: packages/indicators/src/strategy/stratDivergenceRsi.ts:1-48 (en-tête + calcul des index de confirmation)
- Modify: packages/indicators/src/utils-annotations.ts:13 (documentation uniquement, voir Avertissements)
- Test: packages/indicators/src/strategy/stratDivergenceRsi.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter ce test dans le `describe("stratDivergenceRsi")` de `packages/indicators/src/strategy/stratDivergenceRsi.test.ts` (tous les imports nécessaires — `rampe`, `computeIndicator`, `detecterDivergences`, `lowOf`, `rsiOf`, `Candle` — y existent déjà) :

```ts
  it("pivot oscillateur en retard (oscIdxTo > idxTo) : l'entrée attend max(idxTo, oscIdxTo) + droite", () => {
    // Fixture VALIDÉE numériquement : zigzag baissier (RSI(14) non saturé,
    // creux prix/osc alignés à idx 18), rebond, puis glissade vers un 2e creux :
    // MÈCHE profonde à idx 40 (low 64 → pivot PRIX à 40) alors que les closes
    // baissent jusqu'à idx 42 (→ pivot RSI à 42). detecterDivergences rend UNE
    // divergence haussière {idxTo: 40, oscIdxTo: 42} : le pivot osc n'est
    // confirmé qu'à 42 + droite = 44 — une entrée à idxTo + droite = 42 lirait
    // le futur (le pivot RSI n'y est pas encore confirmé).
    const closesMeche = rampe(60, [
      [0, 100], [6, 84], [8, 88], [14, 72], [16, 76], [18, 70],
      [30, 88], [42, 68], [59, 80],
    ]);
    const candlesMeche: Candle[] = closesMeche.map((close, i) => ({
      time: i * 60_000,
      open: close,
      high: close + 1,
      low: i === 40 ? 64 : close - 1, // mèche : pivot prix AVANT le pivot RSI
      close,
      volume: 100,
    }));
    const paramsMeche = { length: 14, gauche: 2, droite: 2, maxEcart: 60, seuilSortie: 70 };

    // Garde anti-tautologie : la fixture produit bien un pivot osc EN RETARD.
    const rsi = rsiOf(closesMeche, paramsMeche.length);
    const divs = detecterDivergences(lowOf(candlesMeche), rsi, {
      gauche: 2, droite: 2, maxEcart: 60,
    });
    const div = divs.find((d) => d.type === "haussiere");
    expect(div).toBeDefined();
    expect(div!.oscIdxTo).toBeGreaterThan(div!.idxTo);
    const conf = Math.max(div!.idxTo, div!.oscIdxTo) + paramsMeche.droite;

    const r = computeIndicator(stratDivergenceRsi, candlesMeche, paramsMeche);
    const idxMarqueurs = (r.annotations?.marqueurs ?? []).map((m) => m.idx);
    // Aucun marqueur avant la confirmation du pivot OSC (l'ancien code en
    // posait un à idxTo + droite = 42).
    expect(idxMarqueurs.filter((idx) => idx < conf)).toEqual([]);
    // L'entrée long existe, exactement à la confirmation.
    expect(idxMarqueurs).toContain(conf);
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/indicators exec vitest run src/strategy/stratDivergenceRsi.test.ts`
  Échec attendu (mesuré sur le code actuel : marqueurs = [42], conf = 44) : `expected [ 42 ] to deeply equal []` sur l'assertion « aucun marqueur avant la confirmation ». Les valeurs pivots sont vérifiées : divergence unique `{idxFrom: 18, idxTo: 40, oscIdxFrom: 18, oscIdxTo: 42, type: "haussiere"}`, RSI[18] = 17.56 < RSI[42] = 24.70 (HL), lows 69 → 64 (LL).

- [ ] **Étape 3 : implémentation minimale** — dans `packages/indicators/src/strategy/stratDivergenceRsi.ts` :

  (a) remplacer les lignes 5-9 de l'en-tête (`* retournement). Anti-look-ahead STRICT : …` jusqu'à `… jamais au\n * pivot.`) par :

```ts
 * retournement). Anti-look-ahead STRICT : detecterDivergences date une
 * divergence à son pivot PRIX (idxTo) apparié à un pivot OSCILLATEUR
 * (oscIdxTo, jusqu'à ±3 barres — ECART_APPARIEMENT) ; chacun n'est CONNU que
 * `droite` bougies après son PROPRE index. L'entrée est donc posée à
 * max(idxTo, oscIdxTo) + droite, jamais plus tôt. Impact : le signal peut
 * arriver jusqu'à 3 barres après idxTo + droite (retard assumé — prix de
 * l'absence de repaint, dans le rejeu comme en live incrémental).
```

  (b) remplacer les lignes 40-48 (du commentaire `// Index de CONFIRMATION…` à la fermeture de la 2e boucle `for` incluse) par :

```ts
    // Index de CONFIRMATION des divergences régulières : le pivot PRIX (idxTo)
    // ET le pivot OSCILLATEUR apparié (oscIdxTo) doivent chacun être confirmés
    // `droite` barres après leur propre index — la divergence n'est
    // connaissable qu'à max(idxTo, oscIdxTo) + droite.
    const confirmLong = new Set<number>();
    for (const d of detecterDivergences(lowOf(candles), r, opts)) {
      const conf = Math.max(d.idxTo, d.oscIdxTo) + droite;
      if (d.type === "haussiere" && conf < n) confirmLong.add(conf);
    }
    const confirmShort = new Set<number>();
    for (const d of detecterDivergences(highOf(candles), r, opts)) {
      const conf = Math.max(d.idxTo, d.oscIdxTo) + droite;
      if (d.type === "baissiere" && conf < n) confirmShort.add(conf);
    }
```

  (c) adapter le test EXISTANT « entrée long à idxTo + droite… » du même fichier de test — SANS l'affaiblir (justification : sa fixture double-V a `oscIdxTo === idxTo` — vérifié : divergence `{idxTo: 48, oscIdxTo: 48}` — donc ses assertions et son assertion négative anti-repaint restent identiques en valeur ; seule la FORMULE devient celle du contrat corrigé). Remplacer la ligne :

```ts
    const idxConfirmation = idxTo + OPTS.droite;
```

  par :

```ts
    // Contrat corrigé : confirmation au dernier des deux pivots + droite
    // (ici oscIdxTo === idxTo === 48, l'index attendu est inchangé : 50).
    const idxConfirmation = Math.max(idxTo, div!.oscIdxTo) + OPTS.droite;
```

  Et mettre à jour le titre de ce test : `"entrée long à max(idxTo, oscIdxTo) + droite (confirmation), JAMAIS à idxTo (anti-look-ahead pinné)"`.

  (d) documentation côté defs d'affichage — dans `packages/indicators/src/utils-annotations.ts`, remplacer la fin de l'en-tête (ligne 13) :

```ts
 * filtre. Anti-repaint hérité de detecterPivots (droite barres de confirmation).
```

  par :

```ts
 * filtre. Anti-repaint hérité de detecterPivots (droite barres de confirmation).
 * NB : le pivot OSC apparié pouvant suivre le pivot prix de ±3 barres
 * (ECART_APPARIEMENT), une annotation peut n'apparaître — rétrodatée — que
 * jusqu'à 3 barres après idxTo + droite. C'est un TRACÉ rétrodaté par nature
 * (segment pivot→pivot), pas un signal d'entrée : rien à retarder ici — le
 * signal exécutable, lui, est daté dans stratDivergenceRsi.
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/indicators exec vitest run src/strategy/stratDivergenceRsi.test.ts src/utils-annotations.test.ts src/utils-divergence.test.ts src/strategy/rsiDivergence.test.ts src/strategy/cvdDivergence.test.ts`
  Attendu : tout vert — les 3 tests existants de stratDivergenceRsi (dont l'adapté, index inchangé 50) + le nouveau (marqueur unique à 44), et non-régression des defs d'affichage (aucun code exécutable modifié chez elles). Puis non-régression globale du lot : `pnpm --filter @axiom/indicators test` → 0 échec.

- [ ] **Étape 5 : commit** — `git add packages/indicators/src/strategy/stratDivergenceRsi.ts packages/indicators/src/strategy/stratDivergenceRsi.test.ts packages/indicators/src/utils-annotations.ts && git commit -m "fix(indicators): divergence RSI — confirmation datée à max(idxTo, oscIdxTo) + droite (anti look-ahead)"`

---

## Couverture du 5e constat (basse — qqe.test.ts:28)

« Hors golden, la couverture est purement structurelle » : couvert par les tests de VALEUR/comportement de D.1 (QQE : ≥ 1 flip exigé sur série synthétique, régimes fast<slow ET fast>slow tous deux présents) et D.2 (HalfTrend : bascule obligatoire sur cassure, interdiction du flip parasite sur pullback). Pas de tâche dédiée. Le point annexe du constat (golden ADX comparé seulement à partir de l'index 263) est hors périmètre des correctifs demandés au lot D — non traité ici.


## Lot E — « Dette daemon & filet de test » (apps/daemon + e2e)

Fragment de plan de correction. Conventions vérifiées dans le code réel :
- Tests daemon : `bun test` (script `test` de `apps/daemon/package.json` = `bun test src`), style `describe/test` de `bun:test`, injection de `Database` en dernier paramètre (patron `snapshots.ts`/`traiterSnapshots(…, dInjecte?)`).
- Tests web : `vitest run` (script `test` de `apps/web/package.json`), `vi.mock` de modules feuilles (patron `src/chart/liquidationMarkers.test.ts`).
- E2E : `playwright test` (testMatch `e2e/*.e2e.ts`, webServer vite auto), bouchonnage réseau par `page.route` (patron `e2e/gate-lot3-corr.e2e.ts`).
- `bun:test` n'a PAS de fake timers → la boucle WS partagée reçoit une horloge et une fabrique de WebSocket INJECTABLES (défauts réels), testées avec une horloge factice déterministe.

Ordre conseillé : E.1 → E.2 → E.3 (E.3 dépend de E.2), E.7 avant E.9 (E.9 réutilise `OptionsProxy` introduit en E.7), E.6 avant E.9 (E.9 retouche la même fonction `executerTelechargement` après l'extraction d'E.6). E.4, E.5, E.8, E.10 sont indépendantes.

---

### Task E.1 : brancher et tester la purge du cache SQLite

**Constat couvert :** Purge du cache SQLite morte et non testée → croissance non bornée de la table cache (apps/daemon/src/cache.ts:123, sévérité moyenne)

**Files:**
- Modify: apps/daemon/src/cache.ts:11,88-126 (injection `Database` sur les 4 fonctions d'accès)
- Modify: apps/daemon/src/snapshots.ts:29-31,252-274 (branchement de `purgerExpires` dans la boucle d'entretien horaire)
- Test: apps/daemon/src/cache.test.ts

**Interfaces:** signatures modifiées (paramètre optionnel AJOUTÉ en dernier — tous les appelants existants restent valides) :
```ts
export function lireCache(cle: string, dInjecte?: Database): EntreeCache | null;
export function ecrireCache(cle: string, corps: Uint8Array, contentType: string, ttlMs: number, dInjecte?: Database): void;
export function compterEntrees(dInjecte?: Database): number;
export function purgerExpires(dInjecte?: Database): number;
```

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/cache.test.ts` (les imports remplacent la ligne d'import existante) :

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  cleCache,
  compterEntrees,
  ecrireCache,
  lireCache,
  purgerExpires,
  ttlMsPourChemin,
  TTL_SECONDES_PAR_PREFIXE,
} from "./cache";
```

```ts
// ─────────────────────────── Accès SQLite (base injectée :memory:) ───────────────────────────

/** Base :memory: avec le schéma `cache` de db.ts — aucun effet de bord disque. */
function baseMemoire(): Database {
  const d = new Database(":memory:");
  d.run(`CREATE TABLE cache (
    cle TEXT PRIMARY KEY,
    corps BLOB NOT NULL,
    contentType TEXT NOT NULL,
    expireA INTEGER NOT NULL
  )`);
  return d;
}

describe("lireCache / ecrireCache (base injectée)", () => {
  test("aller-retour : une entrée écrite est relue avant expiration", () => {
    const d = baseMemoire();
    ecrireCache("GET /tdapi/x", new TextEncoder().encode("{}"), "application/json", 60_000, d);
    const hit = lireCache("GET /tdapi/x", d);
    expect(hit).not.toBeNull();
    expect(hit?.contentType).toBe("application/json");
    expect(new TextDecoder().decode(hit?.corps)).toBe("{}");
    expect(compterEntrees(d)).toBe(1);
  });

  test("entrée expirée : miss + purge PARESSEUSE à la relecture", () => {
    const d = baseMemoire();
    ecrireCache("GET /tdapi/perime", new Uint8Array([1]), "text/plain", -1, d); // déjà expirée
    expect(lireCache("GET /tdapi/perime", d)).toBeNull();
    expect(compterEntrees(d)).toBe(0); // supprimée par la relecture
  });
});

describe("purgerExpires (base injectée)", () => {
  test("purge de MASSE des expirées jamais relues, épargne les vivantes", () => {
    const d = baseMemoire();
    // Deux entrées expirées à clé unique (patron réel : Coinalyze met `to=now` dans la
    // query → clé nouvelle à chaque poll, jamais relue → la purge paresseuse de
    // lireCache ne les atteint jamais).
    ecrireCache("GET /coinalyzeapi/oi?to=1", new Uint8Array([1]), "text/plain", -1, d);
    ecrireCache("GET /coinalyzeapi/oi?to=2", new Uint8Array([2]), "text/plain", -1, d);
    ecrireCache("GET /coinalyzeapi/oi?to=3", new Uint8Array([3]), "text/plain", 60_000, d);
    expect(purgerExpires(d)).toBe(2);
    expect(compterEntrees(d)).toBe(1);
    expect(lireCache("GET /coinalyzeapi/oi?to=3", d)).not.toBeNull();
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/cache.test.ts` → échec de compilation/exécution attendu : les fonctions n'acceptent pas de 2ᵉ/5ᵉ argument et ouvrent la base RÉELLE via `getDb()` (erreur TS « Expected 1 arguments, but got 2 » au typecheck, et à l'exécution les assertions `compterEntrees(d)` lisent la mauvaise base).

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/cache.ts` :

```ts
import type { Database } from "bun:sqlite";
import { getDb } from "./db";
```

puis sur chacune des 4 fonctions d'accès, remplacer `const db = getDb();` par le paramètre injectable (même patron que `traiterSnapshots(…, dInjecte?)`) :

```ts
/**
 * Lit une entrée non expirée. Purge PARESSEUSE : si l'entrée existe mais est
 * expirée, on la supprime et on renvoie `null` (miss). `dInjecte` permet aux tests
 * d'injecter une base :memory: (défaut : base réelle du daemon).
 */
export function lireCache(cle: string, dInjecte?: Database): EntreeCache | null {
  const db = dInjecte ?? getDb();
  const ligne = db
    .query("SELECT corps, contentType, expireA FROM cache WHERE cle = ?")
    .get(cle) as LigneCache | null;
  if (!ligne) return null;
  if (ligne.expireA <= Date.now()) {
    db.query("DELETE FROM cache WHERE cle = ?").run(cle);
    return null;
  }
  return { corps: ligne.corps, contentType: ligne.contentType };
}

/** Écrit (ou remplace) une entrée de cache avec un TTL en millisecondes. */
export function ecrireCache(
  cle: string,
  corps: Uint8Array,
  contentType: string,
  ttlMs: number,
  dInjecte?: Database,
): void {
  const db = dInjecte ?? getDb();
  const expireA = Date.now() + ttlMs;
  db.query(
    "INSERT OR REPLACE INTO cache (cle, corps, contentType, expireA) VALUES (?, ?, ?, ?)",
  ).run(cle, corps, contentType, expireA);
}

/** Nombre d'entrées actuellement stockées (utilisé par /health). */
export function compterEntrees(dInjecte?: Database): number {
  const db = dInjecte ?? getDb();
  const ligne = db.query("SELECT COUNT(*) AS n FROM cache").get() as { n: number };
  return ligne.n;
}

/** Purge de masse des entrées expirées ; renvoie le nombre de lignes supprimées. */
export function purgerExpires(dInjecte?: Database): number {
  const db = dInjecte ?? getDb();
  return db.query("DELETE FROM cache WHERE expireA <= ?").run(Date.now()).changes;
}
```

BRANCHEMENT (le cœur du constat) — dans `apps/daemon/src/snapshots.ts`, ajouter l'import :

```ts
import { purgerExpires } from "./cache";
```

et dans `demarrerBoucleSnapshots()` (fonction `verifier`, entre la purge du journal d'alertes et `compacterSiNecessaire` — c'est la purge qui fait grossir la freelist que le compactage récupère ensuite) :

```ts
    try {
      // Purge de MASSE du cache TTL : les clés à horodatage (ex. Coinalyze `to=now`,
      // coinalyze.ts:274 côté front) créent une entrée NOUVELLE à chaque poll, jamais
      // relue → la purge paresseuse de lireCache ne les atteint jamais et la table
      // grossirait sans borne sur un daemon long-vivant.
      purgerExpires();
    } catch (err) {
      console.error("[axiomd] purge du cache expiré échouée :", err);
    }
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/cache.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → nouveaux tests verts, aucun test existant cassé (les appelants `proxy.ts`/`index.ts` n'ont pas changé), typecheck OK.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/cache.ts apps/daemon/src/cache.test.ts apps/daemon/src/snapshots.ts && git commit -m "fix(daemon): brancher purgerExpires dans la boucle d'entretien et rendre le cache SQLite injectable/testé"`

---

### Task E.2 : extraire UNE boucle WS reconnectante partagée du daemon (avec tests)

**Constat couvert :** Reconnexion WS côté daemon : deux copies de la boucle reconnectante, zéro test (apps/daemon/src/marketFeed.ts:141, sévérité moyenne) — partie 1/2 : extraction + tests. La bascule des 2 consommateurs est la Task E.3.

**Files:**
- Create: apps/daemon/src/wsLoop.ts
- Test: apps/daemon/src/wsLoop.test.ts

**Interfaces:** consommées par la Task E.3 :
```ts
export interface HorlogeWs {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}
export interface OptionsBoucleWs {
  url: string;
  onOpen?: (ws: WebSocket) => void;
  onMessage: (data: string) => boolean | void;
  staleMs?: number;                       // défaut 60 s ; liqFeed passera 10 min
  creerWs?: (url: string) => WebSocket;   // injectable de test
  horloge?: HorlogeWs;                    // injectable de test
}
export function connecterBoucleWs(o: OptionsBoucleWs): () => void;
```

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/daemon/src/wsLoop.test.ts` (invariants recopiés de `apps/web/src/data/wsLoop.test.ts`, adaptés à `bun:test` sans fake timers : horloge factice + WebSocket factice injectés) :

```ts
/**
 * connecterBoucleWs (daemon) — boucle WS reconnectante PARTAGÉE remplaçant les deux
 * copies privées de marketFeed.ts et liqFeed.ts. Invariants recopiés de
 * apps/web/src/data/wsLoop.test.ts : backoff exponentiel NON remis à zéro dans onopen
 * (anti-flap), reset au 1er message de DONNÉES, watchdog qui ferme une socket zombie,
 * arrêt propre. bun:test n'a pas de fake timers → horloge et WebSocket INJECTÉES.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { connecterBoucleWs, type HorlogeWs } from "./wsLoop";

/** Horloge factice déterministe : file de minuteurs déclenchés par `avancer(ms)`. */
class HorlogeFactice implements HorlogeWs {
  t = 0;
  private seq = 1;
  private minuteurs: Array<{ id: number; echeance: number; fn: () => void; periode?: number }> = [];
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.seq++;
    this.minuteurs.push({ id, echeance: this.t + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown): void => {
    this.minuteurs = this.minuteurs.filter((m) => m.id !== id);
  };
  setInterval = (fn: () => void, ms: number): unknown => {
    const id = this.seq++;
    this.minuteurs.push({ id, echeance: this.t + ms, fn, periode: ms });
    return id;
  };
  clearInterval = (id: unknown): void => this.clearTimeout(id);
  /** Avance le temps en déclenchant les minuteurs échus dans l'ordre chronologique. */
  avancer(ms: number): void {
    const fin = this.t + ms;
    for (;;) {
      const prochain = this.minuteurs
        .filter((m) => m.echeance <= fin)
        .sort((a, b) => a.echeance - b.echeance)[0];
      if (!prochain) break;
      this.t = prochain.echeance;
      if (prochain.periode !== undefined) prochain.echeance = this.t + prochain.periode;
      else this.minuteurs = this.minuteurs.filter((m) => m.id !== prochain.id);
      prochain.fn();
    }
    this.t = fin;
  }
}

/** WebSocket factice : enregistre les instances, expose des déclencheurs manuels. */
class WsFactice {
  static instances: WsFactice[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  ferme = false;
  constructor(public url: string) {
    WsFactice.instances.push(this);
  }
  close(): void {
    if (this.ferme) return;
    this.ferme = true;
    this.onclose?.();
  }
  ouvrir(): void {
    this.onopen?.();
  }
  message(data: string): void {
    this.onmessage?.({ data });
  }
}

function derniere(): WsFactice {
  const w = WsFactice.instances[WsFactice.instances.length - 1];
  if (!w) throw new Error("aucune socket créée");
  return w;
}

interface OptionsTest {
  onOpen?: (ws: WebSocket) => void;
  onMessage?: (d: string) => boolean;
  staleMs?: number;
}

function boucle(horloge: HorlogeFactice, options: OptionsTest = {}): () => void {
  return connecterBoucleWs({
    url: "wss://exemple",
    onMessage: options.onMessage ?? (() => true),
    ...(options.onOpen ? { onOpen: options.onOpen } : {}),
    ...(options.staleMs !== undefined ? { staleMs: options.staleMs } : {}),
    creerWs: (url) => new WsFactice(url) as unknown as WebSocket,
    horloge,
  });
}

beforeEach(() => {
  WsFactice.instances = [];
});

describe("connecterBoucleWs (daemon)", () => {
  test("appelle onOpen à l'ouverture avec la socket (souscription Bybit/OKX)", () => {
    const horloge = new HorlogeFactice();
    let recue: unknown = null;
    boucle(horloge, { onOpen: (ws) => (recue = ws) });
    expect(WsFactice.instances).toHaveLength(1);
    derniere().ouvrir();
    expect(recue).toBe(derniere() as unknown as WebSocket);
  });

  test("reconnecte après une chute, avec backoff exponentiel (1000 puis 2000 ms)", () => {
    const horloge = new HorlogeFactice();
    boucle(horloge, { onMessage: () => false });
    derniere().ouvrir();
    derniere().close(); // chute → reconnexion planifiée à 1000 ms (2^0)
    horloge.avancer(999);
    expect(WsFactice.instances).toHaveLength(1); // pas encore
    horloge.avancer(1);
    expect(WsFactice.instances).toHaveLength(2); // reconnexion no 1
    derniere().ouvrir();
    derniere().close(); // 2e chute → 2000 ms (2^1 : backoff NON remis à zéro dans onopen)
    horloge.avancer(1999);
    expect(WsFactice.instances).toHaveLength(2);
    horloge.avancer(1);
    expect(WsFactice.instances).toHaveLength(3); // backoff doublé confirmé
  });

  test("un message de DONNÉES remet le backoff à zéro (délai suivant = 1000 ms)", () => {
    const horloge = new HorlogeFactice();
    boucle(horloge, { onMessage: (d) => d === "data" });
    derniere().ouvrir();
    derniere().close(); // essai 0→1
    horloge.avancer(1000);
    derniere().ouvrir(); // reconnexion no 1 (essai=1)
    derniere().message("data"); // onMessage true → essai remis à 0
    derniere().close(); // délai suivant : 1000 (2^0), pas 2000
    horloge.avancer(999);
    expect(WsFactice.instances).toHaveLength(2);
    horloge.avancer(1);
    expect(WsFactice.instances).toHaveLength(3);
  });

  test("le watchdog ferme une socket silencieuse après staleMs et relance", () => {
    const horloge = new HorlogeFactice();
    boucle(horloge, { staleMs: 1000 });
    derniere().ouvrir();
    // Watchdog (période min(staleMs, 15 s) = 1000 ms) : tick à t=1000 → diff 1000 ≤ stale
    // (sain) ; tick à t=2000 → diff 2000 > stale → fermeture forcée de la zombie.
    horloge.avancer(2000);
    expect(derniere().ferme).toBe(true);
    horloge.avancer(1000); // délai de reconnexion (2^0)
    expect(WsFactice.instances.length).toBeGreaterThanOrEqual(2);
  });

  test("la fonction d'arrêt ferme la socket et n'ouvre plus aucune reconnexion", () => {
    const horloge = new HorlogeFactice();
    const stop = boucle(horloge);
    derniere().ouvrir();
    stop();
    expect(derniere().ferme).toBe(true);
    horloge.avancer(120_000);
    expect(WsFactice.instances).toHaveLength(1);
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/wsLoop.test.ts` → échec attendu : `error: Cannot find module './wsLoop'` (le module n'existe pas encore).

- [ ] **Étape 3 : implémentation minimale** — créer `apps/daemon/src/wsLoop.ts` (corps = copie de la version de `marketFeed.ts:141-229`, généralisée avec `onOpen`/`staleMs` et les deux injectables ; comportements STRICTEMENT préservés) :

```ts
/**
 * wsLoop.ts — boucle WebSocket reconnectante PARTAGÉE du daemon (backoff exponentiel
 * plafonné 1s→30s + watchdog de staleness). Source UNIQUE remplaçant les deux copies
 * privées historiques de marketFeed.ts et liqFeed.ts (même machinerie ; seuls `onOpen`
 * — souscription Bybit/OKX — et `staleMs` — liquidations sparses : 10 min — diffèrent).
 * Pattern hérité de apps/web/src/data/wsLoop.ts, ADAPTÉ : pas de healthStore côté
 * daemon (aucune remontée d'état, juste des reconnexions silencieuses).
 *
 * Testable SANS réseau ni vrais minuteurs : la fabrique de WebSocket (`creerWs`) et
 * l'horloge (`horloge`) sont injectables — bun:test n'a pas de fake timers.
 */

/** Horloge injectable (les identifiants de minuteur restent opaques). */
export interface HorlogeWs {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

/** Options de la boucle WS reconnectante. */
export interface OptionsBoucleWs {
  url: string;
  /** Envoi de la souscription à l'ouverture (Bybit/OKX) ; omis pour Binance. */
  onOpen?: (ws: WebSocket) => void;
  /**
   * Traite le payload brut d'un message. Renvoie `true` pour un message de DONNÉES
   * (réarme le backoff) ; acks/heartbeats comptent malgré tout comme activité watchdog.
   */
  onMessage: (data: string) => boolean | void;
  /** Seuil de staleness du watchdog (défaut 60 s ; liquidations sparses : 10 min). */
  staleMs?: number;
  /** Injectable de test : fabrique de WebSocket (défaut : `new WebSocket(url)`). */
  creerWs?: (url: string) => WebSocket;
  /** Injectable de test : horloge (défaut : minuteurs globaux + Date.now). */
  horloge?: HorlogeWs;
}

const DELAI_STALE_DEFAUT_MS = 60_000;
const DELAI_STABLE_RESET_MS = 10_000;
const BACKOFF_MAX_MS = 30_000;
const PERIODE_WATCHDOG_MS = 15_000;

/** Horloge réelle (défaut hors tests). */
const HORLOGE_REELLE: HorlogeWs = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/**
 * Ouvre une WebSocket reconnectante (backoff exponentiel 1s→30s + watchdog de
 * staleness). Renvoie une fonction d'arrêt. Comportements préservés des deux copies :
 * AUCUN reset du backoff dans onopen (anti-flap) — reset au 1er message de DONNÉES ou
 * après DELAI_STABLE_RESET_MS de connexion maintenue ; watchdog qui ferme de force une
 * connexion « zombie » silencieuse (onclose relance alors la reconnexion).
 */
export function connecterBoucleWs(o: OptionsBoucleWs): () => void {
  const staleMs = o.staleMs ?? DELAI_STALE_DEFAUT_MS;
  const creerWs = o.creerWs ?? ((url: string) => new WebSocket(url));
  const horloge = o.horloge ?? HORLOGE_REELLE;

  let ws: WebSocket | null = null;
  let fermeParUtilisateur = false;
  let essai = 0;
  let dernierMessageTs = 0;
  let minuteurReconnexion: unknown = null;
  let minuteurStable: unknown = null;
  let minuteurWatchdog: unknown = null;

  const nettoyerStable = (): void => {
    if (minuteurStable !== null) {
      horloge.clearTimeout(minuteurStable);
      minuteurStable = null;
    }
  };
  const nettoyerWatchdog = (): void => {
    if (minuteurWatchdog !== null) {
      horloge.clearInterval(minuteurWatchdog);
      minuteurWatchdog = null;
    }
  };

  const armerWatchdog = (): void => {
    nettoyerWatchdog();
    minuteurWatchdog = horloge.setInterval(() => {
      if (horloge.now() - dernierMessageTs <= staleMs) return;
      // Connexion « zombie » (aucun message depuis staleMs) : on la ferme de force ;
      // `onclose` (fermeParUtilisateur=false) relance la reconnexion.
      try {
        ws?.close();
      } catch {
        /* fermeture best-effort */
      }
    }, Math.min(staleMs, PERIODE_WATCHDOG_MS));
  };

  const connecter = (): void => {
    const socket = creerWs(o.url);
    ws = socket;

    socket.onopen = (): void => {
      dernierMessageTs = horloge.now();
      o.onOpen?.(socket);
      // Backoff : AUCUN reset ici (anti-flap). Reset programmé après une connexion
      // maintenue DELAI_STABLE_RESET_MS (couvre « connecté mais silencieux »).
      nettoyerStable();
      minuteurStable = horloge.setTimeout(() => {
        essai = 0;
      }, DELAI_STABLE_RESET_MS);
      armerWatchdog();
    };

    socket.onmessage = (ev: MessageEvent): void => {
      dernierMessageTs = horloge.now(); // tout message = activité watchdog
      const estDonnee = o.onMessage(ev.data as string) === true;
      if (estDonnee) essai = 0; // seul un message de DONNÉES réarme le backoff
    };

    socket.onerror = (): void => {
      try {
        socket.close();
      } catch {
        /* best-effort */
      }
    };

    socket.onclose = (): void => {
      nettoyerStable();
      nettoyerWatchdog();
      if (fermeParUtilisateur) return;
      const delai = Math.min(BACKOFF_MAX_MS, 1_000 * 2 ** essai);
      essai += 1;
      minuteurReconnexion = horloge.setTimeout(connecter, delai);
    };
  };

  connecter();

  return () => {
    fermeParUtilisateur = true;
    if (minuteurReconnexion !== null) horloge.clearTimeout(minuteurReconnexion);
    nettoyerStable();
    nettoyerWatchdog();
    try {
      ws?.close();
    } catch {
      /* best-effort */
    }
  };
}
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/wsLoop.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → 5 tests verts, suite existante intacte (rien d'existant ne touche encore ce module).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/wsLoop.ts apps/daemon/src/wsLoop.test.ts && git commit -m "feat(daemon): boucle WS reconnectante partagée testée (horloge et WebSocket injectables)"`

---

### Task E.3 : basculer marketFeed et liqFeed sur la boucle WS partagée

**Constat couvert :** Reconnexion WS côté daemon : deux copies de la boucle reconnectante, zéro test (apps/daemon/src/marketFeed.ts:141 et apps/daemon/src/liqFeed.ts:262, sévérité moyenne) — partie 2/2 : suppression des deux copies privées. Dépend de E.2.

**Files:**
- Modify: apps/daemon/src/marketFeed.ts:23-26,129-229,399
- Modify: apps/daemon/src/liqFeed.ts:25-28,248-355,381-386,514-517

**Interfaces:** consomme `connecterBoucleWs(o: OptionsBoucleWs)` de la Task E.2.

Refactor pur (« s'assurer que les tests passent avant et après ») : les tests d'E.2 spécifient déjà le comportement ; aucune nouvelle assertion — le filet est la suite complète + le typecheck.

- [ ] **Étape 1 : vérifier le vert AVANT** — `cd ~/axiom/apps/daemon && bun test src` → tout vert (état de référence).

- [ ] **Étape 2 : basculer marketFeed.ts** — supprimer intégralement la section `// ─── Boucle WS reconnectante (pattern wsLoop.ts) ───` (lignes 129-229 : les 4 constantes `DELAI_STALE_MS`/`DELAI_STABLE_RESET_MS`/`BACKOFF_MAX_MS`/`PERIODE_WATCHDOG_MS` + la fonction privée `connecterBoucleWs`), ajouter l'import :

```ts
import { connecterBoucleWs } from "./wsLoop";
```

remplacer le site d'appel (dans `creerFeed`/`reconnecter`, ligne 399) :

```ts
    stopWs = connecterBoucleWs({ url, onMessage: dispatch });
```

et mettre à jour la phrase du doc d'en-tête (lignes 23-26) :

```ts
 * La reconnexion passe par la boucle PARTAGÉE du daemon (wsLoop.ts : backoff
 * exponentiel plafonné + watchdog de staleness), héritée du pattern de
 * apps/web/src/data/wsLoop.ts sans healthStore (aucune remontée d'état).
```

- [ ] **Étape 3 : basculer liqFeed.ts** — supprimer la section `// ─── Boucle WS reconnectante (pattern marketFeed.ts) ───` (lignes 248-355) SAUF la constante de staleness, conservée avec son commentaire :

```ts
/** Staleness large : les liquidations sont sparses par nature (cf. front liquidations.ts). */
const DELAI_STALE_MS = 10 * 60_000;
```

ajouter l'import :

```ts
import { connecterBoucleWs } from "./wsLoop";
```

remplacer le site d'appel Bybit (dans `creerFeedLiquidations`/`reconnecter`, lignes 381-385) :

```ts
    stopWs = connecterBoucleWs({
      url: WS_URL,
      onOpen: (ws) => ws.send(JSON.stringify({ op: "subscribe", args })),
      onMessage: ingererMessage,
      staleMs: DELAI_STALE_MS,
    });
```

le site d'appel OKX (dans `creerFeedLiquidationsOkx`/`setSymboles`, lignes 514-517) :

```ts
    if (stopWs === null) {
      const sub = JSON.stringify({ op: "subscribe", args: [{ channel: OKX_CANAL_LIQ, instType: "SWAP" }] });
      stopWs = connecterBoucleWs({
        url: OKX_WS_URL,
        onOpen: (ws) => ws.send(sub),
        onMessage: ingererMessageOkx,
        staleMs: DELAI_STALE_MS,
      });
    }
```

et mettre à jour la phrase d'en-tête (lignes 25-28) :

```ts
 * La reconnexion passe par la boucle PARTAGÉE du daemon (wsLoop.ts : backoff exponentiel
 * plafonné 1s→30s + watchdog de staleness — ici 10 min, liquidations sparses), avec un
 * `onOpen` pour envoyer la souscription à l'ouverture. Pas de healthStore (logs seulement).
```

- [ ] **Étape 4 : vérifier le vert APRÈS** — `cd ~/axiom/apps/daemon && bun test src && pnpm --filter @axiom/daemon typecheck` → suite complète verte (marketFeed.test.ts et liqFeed.test.ts ne testent que des fonctions pures, inchangées ; wsLoop.test.ts couvre la machinerie) ; `grep -n "function connecterBoucleWs" apps/daemon/src/*.ts` ne doit plus lister QUE `wsLoop.ts`.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/marketFeed.ts apps/daemon/src/liqFeed.ts && git commit -m "refactor(daemon): dédupliquer la boucle WS reconnectante de marketFeed et liqFeed sur wsLoop partagé"`

---

### Task E.4 : tests du câblage du runtime d'alertes front (clôture de bougie)

**Constat couvert :** Runtime des alertes front (609 lignes) : aucune couverture du câblage d'évaluation (apps/web/src/alerts/runtime.ts:92, sévérité moyenne). Périmètre : la source « clôture de bougie » (déclenchement sur bougie CLÔTURÉE uniquement, jamais en formation, ré-armement bout-en-bout), fetch/flux mockés. Test SEUL — aucun changement de runtime.ts (`demarrerAlertes` est déjà exporté et idempotent).

**Files:**
- Test: apps/web/src/alerts/runtime.test.ts (nouveau)

- [ ] **Étape 1 : écrire le test qui échoue** — créer `apps/web/src/alerts/runtime.test.ts` (patron `vi.mock` des modules feuilles de `src/chart/liquidationMarkers.test.ts` ; les stores Zustand vanilla `alertsStore`/`marketStore` restent RÉELS — c'est le câblage qu'on teste) :

```ts
/**
 * Câblage du runtime des alertes (creerRuntime via demarrerAlertes) — source « clôture
 * de bougie » : une condition variation-pct se déclenche sur bougie CLÔTURÉE uniquement
 * (jamais sur la bougie en formation) et le ré-armement fonctionne bout-en-bout
 * (journal + état `arme` de la def). Réseau/WS/daemon mockés (aucun accès réseau) ;
 * alertsStore et marketStore sont réels : env node, localStorage absent = no-op toléré.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertDef } from "@axiom/alerts";
import type { Candle } from "@axiom/types";

vi.mock("../data/ticker", () => ({ subscribeTickers: vi.fn(() => () => {}) }));
vi.mock("../data/daemon", () => ({
  daemonPret: () => false,
  daemonSupporte: () => false,
  detectDaemon: async () => false,
  urlDaemon: (chemin: string) => chemin,
  kvPut: async () => null,
}));
vi.mock("../data/coinalyze", () => ({
  coinalyzeProvider: {
    fetchFundingRate: async () => ({ rate: 0 }),
    fetchFundingRateHistory: async () => [],
  },
}));
vi.mock("../data/screenerRun", () => ({ executerScreener: async () => ({ rows: [] }) }));
vi.mock("../chart/liquidationMarkers", () => ({
  fluxLiqRetenu: () => false,
  liqEventsStore: { getState: () => ({ events: [] }), subscribe: () => () => {} },
}));
vi.mock("../store/regime", () => ({
  regimeStore: { getState: () => ({ regime: null }), subscribe: () => () => {} },
}));

import { demarrerAlertes } from "./runtime";
import { alertsStore } from "../store/alerts";
import { marketStore } from "../store/market";

/** Bougie plate au prix donné (les champs OHLC égaux suffisent au moteur). */
function bougie(time: number, close: number, closed: boolean): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1, closed };
}

const DEF: AlertDef = {
  id: "a1",
  symbol: "BTCUSDT",
  source: "binance",
  condition: { type: "variation-pct", fenetreMs: 90_000, seuilPct: 5 },
  actif: true,
  declenchements: [],
};

let stop: (() => void) | null = null;

beforeEach(() => {
  alertsStore.setState({ defs: [], journal: [] });
  marketStore.setState({ symbol: "BTCUSDT", candles: [] });
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe("creerRuntime — source clôture de bougie (variation-pct)", () => {
  it("déclenche sur bougie CLÔTURÉE, ignore la bougie en formation, et se ré-arme", () => {
    const maintenant = Date.now();
    const tA = maintenant - 180_000;
    const tB = maintenant - 120_000;
    const tC = maintenant - 60_000;
    const tD = maintenant;

    alertsStore.setState({ defs: [DEF], journal: [] });
    // Calibrage initial (démarrage du runtime) : 2 bougies clôturées à 100 → pct 0,
    // AUCUN déclenchement, l'alerte est armée (frontArme avec arme=undefined).
    marketStore.setState({ candles: [bougie(tA, 100, true), bougie(tB, 100, true)] });
    stop = demarrerAlertes();
    expect(alertsStore.getState().journal).toHaveLength(0);
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);

    // Nouvelle bougie CLÔTURÉE à +10 % (référence = clôture d'il y a ≥ 90 s = 100)
    // → le câblage marketStore → moteur déclenche : journal + désarmement.
    marketStore.setState({
      candles: [bougie(tA, 100, true), bougie(tB, 100, true), bougie(tC, 110, true)],
    });
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(alertsStore.getState().defs[0]?.arme).toBe(false);

    // Bougie EN FORMATION à +100 % : PAS évaluée (la dernière clôturée est déjà traitée,
    // garde dernierTempsCloture) — aucun déclenchement supplémentaire.
    marketStore.setState({
      candles: [bougie(tA, 100, true), bougie(tB, 100, true), bougie(tC, 110, true), bougie(tD, 200, false)],
    });
    expect(alertsStore.getState().journal).toHaveLength(1);

    // La bougie se clôture à 100 (pct 0, sous le seuil) → ré-armement sans déclenchement.
    marketStore.setState({
      candles: [bougie(tA, 100, true), bougie(tB, 100, true), bougie(tC, 110, true), bougie(tD, 100, true)],
    });
    expect(alertsStore.getState().journal).toHaveLength(1);
    expect(alertsStore.getState().defs[0]?.arme).toBe(true);

    // Nouvelle clôture à +12 % → 2e déclenchement : le ré-armement fonctionne bout-en-bout.
    marketStore.setState({
      candles: [
        bougie(tA, 100, true),
        bougie(tB, 100, true),
        bougie(tC, 110, true),
        bougie(tD, 100, true),
        bougie(tD + 60_000, 112, true),
      ],
    });
    expect(alertsStore.getState().journal).toHaveLength(2);
  });

  it("l'arrêt du runtime coupe l'abonnement : plus aucune évaluation ensuite", () => {
    const maintenant = Date.now();
    alertsStore.setState({ defs: [DEF], journal: [] });
    marketStore.setState({
      candles: [bougie(maintenant - 180_000, 100, true), bougie(maintenant - 120_000, 100, true)],
    });
    stop = demarrerAlertes();
    stop();
    stop = null;
    marketStore.setState({
      candles: [
        bougie(maintenant - 180_000, 100, true),
        bougie(maintenant - 120_000, 100, true),
        bougie(maintenant - 60_000, 110, true),
      ],
    });
    expect(alertsStore.getState().journal).toHaveLength(0); // désabonné : rien n'est évalué
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `pnpm --filter @axiom/web exec vitest run src/alerts/runtime.test.ts` → le fichier n'existant pas encore côté implémentation il n'y a rien à créer : ici l'échec attendu est l'échec de PREMIÈRE exécution si un mock manque (ex. `Cannot find module` ou erreur réseau interceptée). Si le test passe DU PREMIER COUP, vérifier qu'il échoue bien quand on le sabote (remplacer temporairement `bougie(tC, 110, true)` par `bougie(tC, 110, false)` → le 1er `toHaveLength(1)` doit échouer avec `expected [] to have a length of 1`), puis restaurer — c'est la preuve que l'assertion mord sur le câblage réel.

- [ ] **Étape 3 : implémentation minimale** — AUCUNE (le runtime existe ; la tâche comble le trou de test). Si l'étape 2 révèle un vrai défaut de câblage, le corriger dans `apps/web/src/alerts/runtime.ts` de façon chirurgicale et le signaler dans le rapport de lot.

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec vitest run src/alerts/runtime.test.ts` → 2 tests verts ; puis `pnpm --filter @axiom/web test` → suite complète verte (aucun module de prod modifié).

- [ ] **Étape 5 : commit** — `git add apps/web/src/alerts/runtime.test.ts && git commit -m "test(web): câblage du runtime d'alertes — déclenchement sur clôture de bougie et ré-armement"`

---

### Task E.5 : e2e « une bougie s'affiche » (assertion sur un contenu dérivé des données)

**Constat couvert :** Aucun e2e ne prouve que le chart principal affiche des bougies (canvas vide = vert) (apps/web/e2e/smoke.e2e.ts:107, sévérité moyenne)

**Files:**
- Test: apps/web/e2e/smoke.e2e.ts (ajout d'un test)

Choix vérifié dans le code : le bandeau symbole (`SymbolBanner`, monté par `ChartInstance.tsx:1048`) écrit `formatPrice(last.close)` depuis le buffer `marketStore` → `42123.5` s'affiche « 42,123.50 » (locale en-US, `src/lib/format.ts:29`). Un adaptateur qui renvoie 0 bougie laisse « — » : l'assertion mord donc sur le chemin backfill REST → buffer → rendu. Les WebSockets sont neutralisées par `page.routeWebSocket` (Playwright ^1.61) pour que le prix ne puisse venir QUE du bouchon.

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/web/e2e/smoke.e2e.ts` :

```ts
test("le chart principal AFFICHE les bougies du backfill (prix du bandeau dérivé des données)", async ({ page }) => {
  // Déterministe et hors ligne (patron gate-lot3-corr) : klines bouchonnées à un close
  // FIXE, WebSockets neutralisées (la page « se connecte » mais ne reçoit rien) → le prix
  // affiché ne peut venir QUE du backfill REST bouchonné. Un adaptateur qui renvoie
  // 0 bougie laisserait le bandeau à « — » avec un canvas monté mais VIDE → échec.
  const MINUTE = 60_000;
  const T_FIN = Math.floor(Date.now() / MINUTE) * MINUTE;
  const CLOSE_FIXE = "42123.5"; // formatPrice → « 42,123.50 » dans le bandeau symbole
  const lignes = Array.from({ length: 180 }, (_, i) => {
    const t = T_FIN - (179 - i) * MINUTE;
    // [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, buyBase, buyQuote, ignore]
    return [t, "42000", "42200", "41900", CLOSE_FIXE, "1000", t + MINUTE - 1, "100000", 100, "500", "50000", "0"];
  });
  await page.routeWebSocket("**/*", () => {});
  // Repli générique AVANT la route klines : la plus récente/spécifique gagne (cf. gate-lot3-corr).
  await page.route("**/api.binance.com/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api.binance.com/api/v3/klines*", (route) => route.fulfill({ json: lignes }));

  await page.goto("/");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  // Assertion SUR LES DONNÉES : le bandeau symbole affiche le close du backfill bouchonné.
  await expect(page.getByText("42,123.50").first()).toBeVisible({ timeout: 20_000 });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec (contre-épreuve)** — d'abord la contre-épreuve « fenêtre vide » : remplacer temporairement `route.fulfill({ json: lignes })` par `route.fulfill({ json: [] })` puis `pnpm --filter @axiom/web exec playwright test e2e/smoke.e2e.ts -g "AFFICHE les bougies"` → échec attendu : `Timed out ... waiting for expect(locator).toBeVisible() — locator: getByText('42,123.50')` (le canvas, lui, EST visible : c'est exactement le trou que comblait le constat). Restaurer `lignes`.

- [ ] **Étape 3 : implémentation minimale** — AUCUNE modification d'app : le test avec `lignes` restauré EST le livrable (la contre-épreuve de l'étape 2 a prouvé que l'assertion discrimine canvas monté ≠ bougies affichées).

- [ ] **Étape 4 : relancer, vérifier le vert** — `pnpm --filter @axiom/web exec playwright test e2e/smoke.e2e.ts` → les 7 tests du fichier verts (les 6 existants sont inchangés ; le nouveau passe avec les klines bouchonnées).

- [ ] **Étape 5 : commit** — `git add apps/web/e2e/smoke.e2e.ts && git commit -m "test(e2e): prouver que le chart principal affiche les bougies du backfill (bandeau prix bouchonné)"`

---

### Task E.6 : replay — rendre la borne MAX_LIGNES réellement effective (tuer unzip)

**Constat couvert :** Replay : le garde MAX_LIGNES neutralise sa propre borne mémoire (stdout d'unzip drainé en RSS, process jamais tué) (apps/daemon/src/replay.ts:304, sévérité moyenne)

**Files:**
- Modify: apps/daemon/src/replay.ts:252-326 (extraction `lireTradesDepuisProcessus` + kill au dépassement et dans le catch)
- Test: apps/daemon/src/replay.test.ts

**Interfaces:** nouvelle fonction exportée (testable avec un process factice) :
```ts
export interface ProcessusUnzip {
  stdout: ReadableStream<Uint8Array>;
  kill: () => void;
  exited: Promise<number>;
}
export function lireTradesDepuisProcessus(
  proc: ProcessusUnzip,
  onLot: (lot: LigneTrade[]) => void,
  maxLignes?: number,
  tailleLot?: number,
): Promise<{ recus: number; deborde: boolean }>;
```

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/replay.test.ts` (compléter l'import existant avec `lireTradesDepuisProcessus`) :

```ts
import { lireTradesDepuisProcessus } from "./replay";

describe("lireTradesDepuisProcessus", () => {
  /** Lance un process réel (bun -e) exécutant `script`, avec un espion sur kill(). */
  function processusScript(script: string): {
    processus: { stdout: ReadableStream<Uint8Array>; kill: () => void; exited: Promise<number> };
    tue: () => boolean;
  } {
    const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "ignore" });
    let aTue = false;
    return {
      processus: {
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        kill: () => {
          aTue = true;
          proc.kill();
        },
        exited: proc.exited,
      },
      tue: () => aTue,
    };
  }

  /** Script imprimant `n` lignes CSV d'aggTrades valides (\n final sauf si demandé). */
  function scriptCsv(n: number, avecNewlineFinal: boolean): string {
    return (
      `let s = ""; for (let i = 0; i < ${n}; i++) ` +
      `s += i + ",100,1,1,1,1782000000000,true,true" + ((i < ${n} - 1 || ${avecNewlineFinal}) ? "\\n" : ""); ` +
      `process.stdout.write(s);`
    );
  }

  test("dépassement de maxLignes : TUE le process (borne mémoire effective) et signale deborde", async () => {
    const { processus, tue } = processusScript(scriptCsv(5_000, true));
    const lots: number[] = [];
    const res = await lireTradesDepuisProcessus(processus, (lot) => lots.push(lot.length), 1_000, 100);
    expect(res.deborde).toBe(true);
    expect(tue()).toBe(true); // unzip tué AVANT `await exited` : stdout restant jamais drainé en RSS
    // Comptage déterministe : flush par 100 jusqu'à 1000, puis 1 ligne fait déborder (flush final).
    expect(res.recus).toBe(1_001);
  });

  test("flux complet sous la borne : tout est lu, dernière ligne SANS \\n incluse, process non tué", async () => {
    const { processus, tue } = processusScript(scriptCsv(250, false));
    let total = 0;
    const res = await lireTradesDepuisProcessus(processus, (lot) => (total += lot.length), 1_000_000, 100);
    expect(res.deborde).toBe(false);
    expect(tue()).toBe(false);
    expect(res.recus).toBe(250);
    expect(total).toBe(250);
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/replay.test.ts` → échec attendu : `SyntaxError: export 'lireTradesDepuisProcessus' not found in './replay'`.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/replay.ts`, ajouter après `parseAggTradesCsv` (section job) la fonction extraite, puis récrire `executerTelechargement` pour l'utiliser :

```ts
/** Sous-ensemble de Bun.Subprocess consommé par la lecture (testable avec un process factice). */
export interface ProcessusUnzip {
  stdout: ReadableStream<Uint8Array>;
  kill: () => void;
  exited: Promise<number>;
}

/**
 * Consomme le stdout CSV d'un process `unzip -p` : parsing ligne à ligne, lots de
 * `tailleLot` remis à `onLot`, borne dure `maxLignes`. BORNE MÉMOIRE EFFECTIVE : au
 * dépassement, le process est TUÉ et le flux ANNULÉ AVANT `await exited` — sinon Bun
 * draine tout le stdout restant du child en RSS (~1-2 Go de CSV décompressé pour un
 * dump juste au-dessus du seuil ; vérifié empiriquement avec releaseLock+exited).
 */
export async function lireTradesDepuisProcessus(
  proc: ProcessusUnzip,
  onLot: (lot: LigneTrade[]) => void,
  maxLignes: number = MAX_LIGNES,
  tailleLot: number = TAILLE_LOT,
): Promise<{ recus: number; deborde: boolean }> {
  const decodeur = new TextDecoder();
  let reste = "";
  let lot: LigneTrade[] = [];
  let recus = 0;
  let deborde = false;

  const viderLot = (): void => {
    if (lot.length === 0) return;
    onLot(lot);
    recus += lot.length;
    lot = [];
  };

  const lecteur = proc.stdout.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (value) reste += decodeur.decode(value, { stream: true });
    let nl = reste.indexOf("\n");
    while (nl !== -1) {
      const ligne = reste.slice(0, nl);
      reste = reste.slice(nl + 1);
      const tr = parseLigneTrade(ligne);
      if (tr !== null) {
        lot.push(tr);
        if (lot.length >= tailleLot) viderLot();
        if (recus + lot.length > maxLignes) {
          deborde = true;
          break;
        }
      }
      nl = reste.indexOf("\n");
    }
    if (deborde) break;
  }
  if (deborde) {
    proc.kill();
    await lecteur.cancel().catch(() => {});
  } else {
    lecteur.releaseLock();
    // Dernière ligne éventuelle (sans \n final).
    const tr = parseLigneTrade(reste);
    if (tr !== null) lot.push(tr);
  }
  viderLot();
  await proc.exited;
  return { recus, deborde };
}
```

puis dans `executerTelechargement`, hisser le process hors du `try` (pour le tuer aussi sur le chemin `catch` — erreur SQLite en cours d'insertion) et remplacer la boucle de lecture inline (lignes 252-304 actuelles) :

```ts
async function executerTelechargement(symbole: string, jour: string): Promise<void> {
  const cheminTmp = join(tmpdir(), `axiom-replay-${symbole}-${jour}-${Date.now()}.zip`);
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  try {
    // … (fetch + Bun.write inchangés) …

    proc = Bun.spawn(["unzip", "-p", cheminTmp], { stdout: "pipe", stderr: "pipe" });

    const inserer = db().query(
      "INSERT INTO replay_trades (symbole, jour, t, prix, qty, isBuyerMaker) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insererLot = db().transaction((lot: LigneTrade[]) => {
      for (const tr of lot) inserer.run(symbole, jour, tr.t, tr.prix, tr.qty, tr.isBuyerMaker);
    });

    let inseres = 0;
    const { recus, deborde } = await lireTradesDepuisProcessus(
      {
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        kill: () => proc?.kill(),
        exited: proc.exited,
      },
      (lot) => {
        insererLot(lot);
        inseres += lot.length;
        majJob(symbole, jour, "en_cours", inseres, octetsZip.byteLength, null);
      },
    );

    if (deborde) {
      majJob(symbole, jour, "erreur", recus, octetsZip.byteLength, `jour trop volumineux (> ${MAX_LIGNES} trades)`);
      return;
    }
    if (recus === 0) {
      majJob(symbole, jour, "erreur", 0, octetsZip.byteLength, "archive vide ou illisible");
      return;
    }
    majJob(symbole, jour, "pret", recus, octetsZip.byteLength, null);
    console.log(
      `[axiomd:replay] ${symbole} ${jour} : ${recus} trades insérés ` +
        `(${(octetsZip.byteLength / 1_048_576).toFixed(1)} Mo zip).`,
    );
  } catch (err) {
    // Même défaut sur le chemin d'erreur : sans kill, Bun drainerait le stdout restant.
    try {
      proc?.kill();
    } catch {
      /* best-effort */
    }
    majJob(symbole, jour, "erreur", 0, 0, err instanceof Error ? err.message : String(err));
  } finally {
    void unlink(cheminTmp).catch(() => {
      /* nettoyage best-effort */
    });
  }
}
```

(les déclarations locales devenues inutiles — `decodeur`, `reste`, `lot`, `recus`, `deborde`, `viderLot`, `lecteur` — sont supprimées d'`executerTelechargement` : orphelins créés PAR cette modification).

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/replay.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → nouveaux tests verts, tests purs existants du fichier intacts.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/replay.ts apps/daemon/src/replay.test.ts && git commit -m "fix(daemon): replay — tuer unzip au dépassement de MAX_LIGNES (borne mémoire réellement effective)"`

---

### Task E.7 : erreurs SQLite des routes historiques → 500 JSON conventionnel avec CORS

**Constat couvert :** Erreurs SQLite non contenues sur les routes historiques → 500 texte brut sans CORS (apps/daemon/src/proxy.ts:167, sévérité moyenne). Deux volets, conformes au constat : (a) cache de `traiterProxy` en try/catch « miss forcé » (patron /extapi, proxy.ts:793-797) ; (b) garde 500 JSON+CORS conventionnelle (patron documenté snapshots.ts:311-314) autour des handlers kv/candles/replay.

**Files:**
- Modify: apps/daemon/src/router.ts (helper `avecGardeErreur`)
- Modify: apps/daemon/src/proxy.ts:157-216 (OptionsProxy + try/catch cache)
- Modify: apps/daemon/src/kv.ts:165-167, apps/daemon/src/candles.ts:200-202, apps/daemon/src/replay.ts:428-430 (enregistrement enveloppé)
- Test: apps/daemon/src/router.test.ts, apps/daemon/src/proxy.test.ts

**Interfaces:** consommées par la Task E.9 (qui ajoutera `timeoutMs`) :
```ts
// proxy.ts
export interface OptionsProxy {
  fetchImpl?: FetchExtapi;
  lireCacheImpl?: typeof lireCache;
  ecrireCacheImpl?: typeof ecrireCache;
}
export async function traiterProxy(req: Request, url: URL, route: RouteProxy, options?: OptionsProxy): Promise<Response>;
// router.ts
export function avecGardeErreur(nom: string, gerer: GestionnaireRoute): GestionnaireRoute;
```

- [ ] **Étape 1 : écrire les tests qui échouent** — dans `apps/daemon/src/router.test.ts`, ajouter (compléter l'import : `import { avecGardeErreur, Routeur } from "./router";`) :

```ts
describe("avecGardeErreur", () => {
  test("une exception du handler devient un 500 JSON conventionnel AVEC en-têtes CORS", async () => {
    const gerer = avecGardeErreur("kv", () => {
      throw new Error("SQLITE_FULL: database or disk is full");
    });
    const url = new URL("http://127.0.0.1:8787/kv/persist/x");
    const requete = new Request(url, {
      headers: { origin: "http://localhost:5173", host: "127.0.0.1:8787" },
    });
    const rep = await gerer(requete, url);
    expect(rep.status).toBe(500);
    expect(rep.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // Sans CORS, le front dev (5173) verrait une erreur réseau opaque au lieu du 500.
    expect(rep.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(await rep.json()).toEqual({ erreur: "erreur interne kv" });
  });

  test("laisse passer telle quelle une réponse réussie (y compris asynchrone)", async () => {
    const gerer = avecGardeErreur("candles", async () => new Response("ok"));
    const url = new URL("http://127.0.0.1:8787/candles/binance/BTCUSDT/1m");
    expect(await (await gerer(new Request(url), url)).text()).toBe("ok");
  });
});
```

et dans `apps/daemon/src/proxy.test.ts` (compléter l'import de `./proxy` avec `traiterProxy` et `construireRoutesProxy` déjà importé) :

```ts
describe("traiterProxy — cache SQLite en panne = optimisation, jamais une panne de route", () => {
  const route = routePar("/tdapi"); // helper déjà présent en tête de proxy.test.ts
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  test("lireCache qui lève → miss forcé, la réponse amont saine est servie (200)", async () => {
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), route, {
      fetchImpl,
      lireCacheImpl: () => {
        throw new Error("SQLITE_CORRUPT");
      },
      ecrireCacheImpl: () => {},
    });
    expect(rep.status).toBe(200);
    expect(rep.headers.get("x-axiomd-cache")).toBe("miss");
    expect(await rep.json()).toEqual({ status: "ok" });
  });

  test("ecrireCache qui lève → la réponse amont est quand même servie (200)", async () => {
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), route, {
      fetchImpl,
      lireCacheImpl: () => null,
      ecrireCacheImpl: () => {
        throw new Error("SQLITE_FULL");
      },
    });
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ status: "ok" });
  });
});
```

(`routePar` et `CLES` existent déjà en tête de `proxy.test.ts:20-33` — ne pas les redéclarer ; seul `traiterProxy` est à ajouter à l'import de `./proxy`.)

- [ ] **Étape 2 : les lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/router.test.ts src/proxy.test.ts` → échecs attendus : `export 'avecGardeErreur' not found in './router'` et, côté proxy, erreur TS/exécution « traiterProxy n'accepte pas de 4ᵉ argument » (puis, une fois compilable, le test lireCache lèverait `SQLITE_CORRUPT` au lieu de servir 200).

- [ ] **Étape 3 : implémentation minimale** —

(a) `apps/daemon/src/router.ts` — ajouter l'import et le helper :

```ts
import { entetesCors } from "./cors";
```

```ts
/**
 * Enveloppe un gestionnaire : toute exception (typiquement SQLite — disque plein, base
 * corrompue) devient un 500 JSON CONVENTIONNEL avec en-têtes CORS, au lieu de remonter
 * jusqu'à `Bun.serve.error` (500 texte brut SANS CORS, illisible en cross-origin dev).
 * Même patron que la garde base documentée dans snapshots.ts (traiterSnapshots).
 */
export function avecGardeErreur(nom: string, gerer: GestionnaireRoute): GestionnaireRoute {
  return async (req, url) => {
    try {
      return await gerer(req, url);
    } catch (err) {
      console.error(`[axiomd] ${nom} — erreur interne :`, err);
      return new Response(JSON.stringify({ erreur: `erreur interne ${nom}` }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
      });
    }
  };
}
```

(b) envelopper les trois routes historiques :

```ts
// kv.ts
export function enregistrerKv(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/kv", avecGardeErreur("kv", (req, url) => traiterKv(req, url)));
}
// candles.ts
export function enregistrerCandles(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/candles", avecGardeErreur("candles", (req, url) => traiterCandles(req, url)));
}
// replay.ts
export function enregistrerReplay(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/replay", avecGardeErreur("replay", (req, url) => traiterReplay(req, url)));
}
```

(dans chacun, compléter l'import : `import { avecGardeErreur, type Routeur } from "./router";` — remplacer l'import type existant).

(c) `apps/daemon/src/proxy.ts` — options injectables + garde cache dans `traiterProxy` :

```ts
/** Dépendances injectables des tests de traiterProxy (cache + fetch). */
export interface OptionsProxy {
  fetchImpl?: FetchExtapi;
  lireCacheImpl?: typeof lireCache;
  ecrireCacheImpl?: typeof ecrireCache;
}

export async function traiterProxy(
  req: Request,
  url: URL,
  route: RouteProxy,
  options: OptionsProxy = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lireCacheImpl = options.lireCacheImpl ?? lireCache;
  const ecrireCacheImpl = options.ecrireCacheImpl ?? ecrireCache;
  const cheminEntrant = url.pathname + url.search;
  const urlAmont = route.target + route.rewrite(cheminEntrant);
  const cors = entetesCors(req);
  const entetesAmont = route.entetesAmont?.(req.headers) ?? {};

  if (req.method === "GET") {
    const ttlMs = ttlMsPourChemin(url.pathname);
    const cle = cleCache("GET", cheminEntrant);
    if (ttlMs > 0) {
      // Le cache est une OPTIMISATION : une panne SQLite (disque plein, base corrompue)
      // ne doit jamais faire échouer une requête dont l'amont est joignable — miss
      // forcé, même patron que /extapi (traiterExtapi).
      let hit: ReturnType<typeof lireCache> = null;
      try {
        hit = lireCacheImpl(cle);
      } catch (err) {
        console.error("[axiomd] cache proxy indisponible (miss forcé) :", err);
      }
      if (hit) {
        return new Response(hit.corps, {
          headers: { "content-type": hit.contentType, "x-axiomd-cache": "hit", ...cors },
        });
      }
    }
    let amont: Response;
    try {
      amont = await fetchImpl(urlAmont, { method: "GET", headers: entetesAmont });
    } catch (err) {
      return reponseErreurAmont(err, cors);
    }
    const corps = new Uint8Array(await amont.arrayBuffer());
    const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
    // On ne met en cache que les réponses valides (évite de figer une erreur transitoire).
    if (ttlMs > 0 && amont.ok) {
      try {
        ecrireCacheImpl(cle, corps, contentType, ttlMs);
      } catch (err) {
        console.error("[axiomd] écriture cache proxy échouée :", err);
      }
    }
    return new Response(corps, {
      status: amont.status,
      headers: { "content-type": contentType, "x-axiomd-cache": "miss", ...cors },
    });
  }

  // Méthodes non-GET : inchangées, si ce n'est `fetchImpl` au lieu de `fetch`.
  // … (reste de la fonction identique) …
}
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/router.test.ts src/proxy.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → nouveaux tests verts ; suite complète verte (l'enregistrement des routes garde la même signature externe ; `traiterProxy` a un paramètre optionnel ajouté).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/router.ts apps/daemon/src/router.test.ts apps/daemon/src/proxy.ts apps/daemon/src/proxy.test.ts apps/daemon/src/kv.ts apps/daemon/src/candles.ts apps/daemon/src/replay.ts && git commit -m "fix(daemon): contenir les erreurs SQLite — cache proxy en miss forcé et 500 JSON+CORS sur kv/candles/replay"`

---

### Task E.8 : refuser DELETE /replay/trades pendant un téléchargement en cours (409)

**Constat couvert :** DELETE /replay/trades pendant un téléchargement en cours : replay partiel marqué « pret » (apps/daemon/src/replay.ts:411, sévérité moyenne)

**Files:**
- Modify: apps/daemon/src/replay.ts:407-425 (`traiterPurge` + passage de l'ensemble `enCours`, injectable pour les tests)
- Test: apps/daemon/src/replay.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter en fin de `apps/daemon/src/replay.test.ts` (compléter l'import avec `traiterReplay`) :

```ts
import { traiterReplay } from "./replay";

describe("traiterReplay — purge pendant téléchargement", () => {
  test("DELETE d'un jour dont le job est EN VOL → 409, sans toucher la base", async () => {
    // Le garde `enCoursInjecte` court-circuite AVANT tout accès SQLite : ce test ne
    // touche donc jamais le fichier axiom.db réel (aucun jeu d'état à nettoyer).
    const url = new URL("http://127.0.0.1:8787/replay/trades/BTCUSDT/2026-01-01");
    const rep = await traiterReplay(
      new Request(url, { method: "DELETE" }),
      url,
      new Set(["BTCUSDT|2026-01-01"]),
    );
    expect(rep.status).toBe(409);
    const corps = (await rep.json()) as Record<string, unknown>;
    expect(corps.erreur).toBe("téléchargement en cours, purge refusée");
    expect(corps.symbole).toBe("BTCUSDT");
    expect(corps.jour).toBe("2026-01-01");
  });
});
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/replay.test.ts` → échec attendu : erreur TS « Expected 2 arguments, but got 3 » (signature de `traiterReplay`), ou à défaut la purge s'exécute et renvoie 200 `{ ok: true, … }` au lieu de 409.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/replay.ts` :

```ts
/** DELETE /replay/trades/:symbole/:jour — purge d'un jour (refusée si job en vol). */
function traiterPurge(url: URL, req: Request, enCoursActuels: ReadonlySet<string>): Response {
  const chemin = parseCheminReplay(url.pathname);
  if (!chemin) return json({ erreur: "chemin invalide" }, req, 400);
  // Téléchargement EN VOL : purger maintenant s'intercalerait entre deux lots d'insertion
  // (transactions synchrones entre deux awaits) — trades déjà insérés effacés, puis
  // `majJob` recrée la ligne et le job finit « pret » avec un replay TROUÉ en silence
  // (CVD/footprint faux). On refuse : purger après la fin (ou l'échec) du job.
  if (enCoursActuels.has(`${chemin.symbole}|${chemin.jour}`)) {
    return json(
      { erreur: "téléchargement en cours, purge refusée", symbole: chemin.symbole, jour: chemin.jour },
      req,
      409,
    );
  }
  db().query("DELETE FROM replay_trades WHERE symbole = ? AND jour = ?").run(chemin.symbole, chemin.jour);
  db().query("DELETE FROM replay_jobs WHERE symbole = ? AND jour = ?").run(chemin.symbole, chemin.jour);
  return json({ ok: true, symbole: chemin.symbole, jour: chemin.jour }, req);
}

/** Aiguille une requête `/replay/...` vers le bon handler. `enCoursInjecte` : tests. */
export async function traiterReplay(
  req: Request,
  url: URL,
  enCoursInjecte?: ReadonlySet<string>,
): Promise<Response> {
  const p = url.pathname;
  if (req.method === "POST" && p === "/replay/download") return traiterDownload(req);
  if (req.method === "GET" && p === "/replay/jours") return traiterJours(req);
  if (req.method === "GET" && p.startsWith("/replay/status/")) return traiterStatus(url, req);
  if (req.method === "GET" && p.startsWith("/replay/trades/")) return traiterTrades(url, req);
  if (req.method === "DELETE" && p.startsWith("/replay/trades/")) {
    return traiterPurge(url, req, enCoursInjecte ?? enCours);
  }
  return json({ erreur: "route replay inconnue" }, req, 404);
}
```

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/replay.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → nouveau test vert, suite intacte (l'enregistrement de route appelle toujours `traiterReplay(req, url)` : le 3ᵉ paramètre est optionnel et retombe sur l'ensemble réel `enCours`).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/replay.ts apps/daemon/src/replay.test.ts && git commit -m "fix(daemon): refuser la purge replay (409) pendant un téléchargement en vol"`

---

### Task E.9 : timeout sur les fetch amont des proxys historiques et du téléchargement replay

**Constat couvert :** Aucun timeout sur les fetch amont des proxys historiques et du téléchargement replay (apps/daemon/src/proxy.ts:176 et replay.ts:240, sévérité basse). Dépend de E.7 (réutilise `OptionsProxy`) et suit E.6 (même fonction `executerTelechargement`).

**Files:**
- Modify: apps/daemon/src/proxy.ts (traiterProxy : AbortController + setTimeout ref'd, patron `recupererExtapiSecurise`)
- Modify: apps/daemon/src/replay.ts (fetch du dump dans `executerTelechargement`)
- Test: apps/daemon/src/proxy.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans `apps/daemon/src/proxy.test.ts` (dans le `describe` traiterProxy de la Task E.7, mêmes `route`/`CLES`) :

```ts
  test("amont qui blackhole (ne répond jamais) → 502 au timeout, pas d'attente infinie", async () => {
    const fetchQuiPend = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Ne se résout QUE sur abort : sans timeout explicite, la requête pendrait à jamais.
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const req = new Request("http://localhost:8787/tdapi/quote?symbol=AAPL");
    const rep = await traiterProxy(req, new URL(req.url), route, {
      fetchImpl: fetchQuiPend,
      lireCacheImpl: () => null,
      ecrireCacheImpl: () => {},
      timeoutMs: 20,
    });
    expect(rep.status).toBe(502);
    const corps = (await rep.json()) as { erreur: string; detail: string };
    expect(corps.erreur).toBe("amont injoignable");
    expect(corps.detail).toContain("timeout amont proxy dépassé");
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/proxy.test.ts` → échec attendu : erreur TS « 'timeoutMs' does not exist in type 'OptionsProxy' » (puis, champ ajouté mais non câblé, le test PEND — le runner bun le tue au timeout de test : c'est exactement le symptôme du constat).

- [ ] **Étape 3 : implémentation minimale** —

(a) `apps/daemon/src/proxy.ts` — étendre `OptionsProxy` et border les DEUX fetch de `traiterProxy` (GET ligne ~176 et non-GET ligne ~194) :

```ts
/** Délai maximum d'un fetch amont des proxys à préfixe (ms) — même valeur que /extapi. */
const PROXY_TIMEOUT_MS = 15_000;

export interface OptionsProxy {
  fetchImpl?: FetchExtapi;
  lireCacheImpl?: typeof lireCache;
  ecrireCacheImpl?: typeof ecrireCache;
  timeoutMs?: number;
}
```

dans `traiterProxy`, après les `const` d'options : `const delaiMs = Math.max(1, options.timeoutMs ?? PROXY_TIMEOUT_MS);` puis, pour la branche GET (le timeout couvre en-têtes ET corps ; `clearTimeout` dans `finally` — minuteur annulable, cf. la longue justification du setTimeout REF'D vs `AbortSignal.timeout()` dans `recupererExtapiSecurise`, proxy.ts:565-585) :

```ts
    let amont: Response;
    let corps: Uint8Array;
    const controleur = new AbortController();
    const minuteur = setTimeout(
      () => controleur.abort(new Error(`timeout amont proxy dépassé (${delaiMs} ms)`)),
      delaiMs,
    );
    try {
      amont = await fetchImpl(urlAmont, {
        method: "GET",
        headers: entetesAmont,
        signal: controleur.signal,
      });
      corps = new Uint8Array(await amont.arrayBuffer());
    } catch (err) {
      return reponseErreurAmont(err, cors);
    } finally {
      clearTimeout(minuteur);
    }
    const contentType = amont.headers.get("content-type") ?? "application/octet-stream";
    // … (suite inchangée : ecrireCacheImpl gardé, Response) …
```

même transformation pour la branche non-GET (fetch + `arrayBuffer` dans le même try/finally, `signal: controleur.signal` ajouté à l'init).

(b) `apps/daemon/src/replay.ts` — dans `executerTelechargement` :

```ts
/**
 * Délai max du téléchargement d'un dump (fetch COMPLET, en-têtes + corps). Large (10 min) :
 * un zip quotidien pèse des centaines de Mo — 15 s tuerait des téléchargements légitimes.
 * Le but est de libérer le slot `enCours` quand l'amont blackhole (TCP qui ne casse pas).
 */
const TELECHARGEMENT_TIMEOUT_MS = 600_000;
```

```ts
    const url = `${BASE_VISION}/${symbole}/${symbole}-aggTrades-${jour}.zip`;
    const controleur = new AbortController();
    const minuteur = setTimeout(
      () => controleur.abort(new Error(`timeout dump replay dépassé (${TELECHARGEMENT_TIMEOUT_MS} ms)`)),
      TELECHARGEMENT_TIMEOUT_MS,
    );
    let rep: Response;
    let octetsZip: ArrayBuffer;
    try {
      rep = await fetch(url, { signal: controleur.signal });
      if (!rep.ok) {
        const msg =
          rep.status === 404
            ? "dump introuvable (jour trop récent ou symbole inexistant)"
            : `amont ${rep.status}`;
        majJob(symbole, jour, "erreur", 0, 0, msg);
        return;
      }
      octetsZip = await rep.arrayBuffer();
    } finally {
      clearTimeout(minuteur);
    }
    await Bun.write(cheminTmp, octetsZip);
```

(un abort remonte au `catch` global d'`executerTelechargement` → job « erreur », slot `enCours` libéré par le `.finally()` de `traiterDownload` — comportement voulu).

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/proxy.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → nouveau test vert en ~20 ms (pas d'attente), suite intacte. Le chemin replay n'a pas de test dédié (fonction privée avec réseau réel) : couvert par le typecheck + le même patron que le test proxy.

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/proxy.ts apps/daemon/src/proxy.test.ts apps/daemon/src/replay.ts && git commit -m "fix(daemon): timeout ref'd sur les fetch amont des proxys historiques et du dump replay"`

---

### Task E.10 : borner le VACUUM synchrone (ne jamais geler le daemon des minutes)

**Constat couvert :** VACUUM synchrone dans la boucle horaire : gèle tout le daemon pendant le compactage (apps/daemon/src/db.ts:79, sévérité basse). CORRECTIF DIFFÉRENT du constat (voir avertissements) : `PRAGMA incremental_vacuum` est documenté DANS db.ts:63-68 comme no-op VÉRIFIÉ sous `auto_vacuum=0` (mode de la base existante) et exigerait une migration + un VACUUM complet (le gel qu'on veut éviter). Garde simple retenue : on RENONCE au VACUUM quand le fichier dépasse une borne (256 Mo) — sous la borne le VACUUM reste sub-seconde, au-delà l'espace libre est simplement conservé (préférable à un daemon gelé, /health compris, que le front croirait absent).

**Files:**
- Modify: apps/daemon/src/db.ts:59-82
- Test: apps/daemon/src/db.test.ts

- [ ] **Étape 1 : écrire le test qui échoue** — ajouter dans le `describe("compacterSiNecessaire")` de `apps/daemon/src/db.test.ts` (compléter l'import : `import { compacterSiNecessaire, ratioFreelist, SEUIL_FREELIST } from "./db";`) :

```ts
  test("fichier au-delà de la borne VACUUM : saute le compactage (event loop jamais gelée)", () => {
    const { d } = baseFichier(20_000);
    d.run("DELETE FROM t WHERE id < 15000");
    expect(ratioFreelist(d)).toBeGreaterThan(0.2); // compactage NORMALEMENT dû…
    // …mais borne minuscule injectée : la base (~6 Mo) est « trop grosse » → renoncement.
    expect(compacterSiNecessaire(d, SEUIL_FREELIST, 1024)).toBe(false);
    expect(ratioFreelist(d)).toBeGreaterThan(0.2); // freelist intacte : VACUUM non exécuté
  });
```

- [ ] **Étape 2 : le lancer, vérifier l'échec** — `cd ~/axiom/apps/daemon && bun test src/db.test.ts` → échec attendu : erreur TS « Expected 1-2 arguments, but got 3 », ou à défaut le VACUUM s'exécute et `compacterSiNecessaire(...)` renvoie `true` / la freelist retombe à 0.

- [ ] **Étape 3 : implémentation minimale** — dans `apps/daemon/src/db.ts` :

```ts
/**
 * Taille de fichier au-delà de laquelle on RENONCE au VACUUM synchrone (256 Mo).
 * bun:sqlite est synchrone : un VACUUM réécrit tout le fichier et bloque l'event loop
 * ENTIER du daemon (plus aucune requête servie, /health compris — le front basculerait
 * en mode dégradé en pleine session). Avec des jours de replay stockés, la base atteint
 * des Go : sous cette borne le VACUUM reste sub-seconde ; au-delà on saute et on log —
 * l'espace libre reste alors simplement dans la freelist (réutilisé par SQLite).
 */
export const TAILLE_MAX_VACUUM_OCTETS = 256 * 1024 * 1024;
```

et dans `compacterSiNecessaire` :

```ts
export function compacterSiNecessaire(
  d: Database,
  seuil = SEUIL_FREELIST,
  tailleMaxOctets = TAILLE_MAX_VACUUM_OCTETS,
): boolean {
  if (ratioFreelist(d) < seuil) return false;
  const { page_count: pages } = d.query("PRAGMA page_count").get() as { page_count: number };
  const { page_size: taillePage } = d.query("PRAGMA page_size").get() as { page_size: number };
  if (pages * taillePage > tailleMaxOctets) {
    console.warn(
      `[axiomd] compactage sauté : base de ${((pages * taillePage) / 1_048_576).toFixed(0)} Mo ` +
        "au-delà de la borne du VACUUM synchrone (event loop bloquante)",
    );
    return false;
  }
  d.run("VACUUM");
  d.run("PRAGMA wal_checkpoint(TRUNCATE)");
  return true;
}
```

(mettre à jour le docstring existant de la fonction : ajouter une phrase renvoyant à `TAILLE_MAX_VACUUM_OCTETS` ; le POURQUOI du refus d'`incremental_vacuum` — déjà documenté lignes 63-68 — reste inchangé).

- [ ] **Étape 4 : relancer, vérifier le vert** — `cd ~/axiom/apps/daemon && bun test src/db.test.ts && bun test src && pnpm --filter @axiom/daemon typecheck` → nouveau test vert ; les 2 tests existants de `compacterSiNecessaire` restent verts (base d'essai ~6 Mo, très en deçà de la borne par défaut de 256 Mo).

- [ ] **Étape 5 : commit** — `git add apps/daemon/src/db.ts apps/daemon/src/db.test.ts && git commit -m "fix(daemon): borner le VACUUM synchrone par la taille du fichier (daemon jamais gelé)"`

---

## Backlog (constats hors plan, à traiter plus tard)

Un seul constat confirmé n'est volontairement pas planifié ici, plus les trouvailles annexes de la revue :

- **Verdict G100 non rendu** (`docs/superpowers/plans/2026-07-22-gate-g100-qa.md:11`, moyenne) — gate manuel, décision de Zaki, pas une tâche de code. Le e2e « une bougie s'affiche » (Task E.4) en est le préalable automatisable.
- **`screener.worker.ts:145`** (hors décompte, trouvé par le critique de complétude) — aucun mécanisme d'annulation : deux runs concurrents cumulent ~20 req/s vers Binance ; et `cond.param` passe brut à `computeIndicator` sans le clamp de `resolveParams` (l. 101). À traiter avec le Lot D3 comme référence.
- **Angle mort à instruire** : vérifier que la fenêtre BPL/mcapCandles (pagination 150 000) n'hérite pas du bug d'alignement store↔dataList corrigé en Task A.3 — ajouter un test croisé si besoin.

## Rappel des sévérités par lot

| Lot | Constats | Hautes |
|-----|----------|--------|
| 0 — Chantier CAP/BPL | 6 | 0 (mais bloque tout commit) |
| A — Vérité des données | 12 | 4 |
| B — WHALES & collecteurs | 8 | 1 |
| C — Persistance & UI | 15 | 2 |
| D — Indicateurs | 5 | 2 |
| E — Dette daemon & tests | 9 | 0 |
