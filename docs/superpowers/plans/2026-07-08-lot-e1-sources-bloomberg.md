# Lot E1 « Sources & fonctions Bloomberg » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les 5 features de la spec `docs/superpowers/specs/2026-07-08-lot-e1-sources-bloomberg-design.md` : fix du module ETF (BTC/ETH/SOL via SoSoValue), panneau FUND (fiche société via SEC EDGAR + Finnhub), courbe de taux CRVF (extension de RATE), NEWS enrichi (Finnhub général + GDELT ciblé + bandeau Fear&Greed), on-chain ETH (Etherscan v2).

**Architecture:** Chaque source vit dans son propre module pur sous `data/<domaine>/<source>.ts` (fetch + parse + cache local via `data/onchain/cache.ts` réutilisé tel quel), suivant EXACTEMENT le pattern `coinmetrics.ts`/`bgeometrics.ts` (fonction de parse pure testée séparément du fetch réseau non testé). Les 3 nouvelles clés obligatoires (SoSoValue, Finnhub, Etherscan v2) suivent le pattern `bgeometricsKeyStore` (store vanilla `hasKey/setKey/clearKey` + `getXxxKey()` lecteur localStorage), PAS le pattern `coinalyzeKeyStore` (pas de repli serveur .env pour ces 3-là). Le proxy `/extapi` gagne un override de User-Agent par hôte (petite extension chirurgicale) pour satisfaire la politique SEC EDGAR sans casser les hôtes existants.

**Tech Stack:** React 18 + TypeScript strict + Zustand vanilla + vitest. **Aucune nouvelle dépendance.**

## Global Constraints

- Commentaires et documentation en FRANÇAIS.
- TypeScript strict, `noUncheckedIndexedAccess` actif.
- AUCUNE nouvelle dépendance npm ; ne pas modifier les `package.json`.
- Convention de test du projet : seules les fonctions PURES de parsing/format sont unit-testées (vitest, fixtures inline). Les composants React qui intègrent directement du fetch + rendu (fenêtres, widgets) ne sont PAS unit-testés — vérification manuelle (`pnpm --filter @axiom/web dev`, ouvrir la fenêtre, Chrome DevTools MCP si disponible).
- Toute clé API : JAMAIS dans le state React/Zustand rendu, JAMAIS loggée. Store vanilla `hasKey` (booléen) + lecture localStorage à la demande via `getXxxKey()`.
- Toute source réseau : dégradation gracieuse obligatoire (jamais d'exception non rattrapée ; renvoyer un résultat `{disponible/perime, raison}` ou équivalent).
- Whitelist `/extapi` : TOUJOURS modifier les 3 fichiers ensemble (`apps/daemon/src/proxy.ts` EXTAPI_WHITELIST, `apps/web/vite.config.ts` EXTAPI_HOTES, `apps/web/src/data/extapi.ts` EXTAPI_WHITELIST) — vérifié par `apps/daemon/src/proxy.test.ts` (`expect(EXTAPI_WHITELIST.size).toBe(N)`, à incrémenter).
- Commit après chaque tâche complétée et vérifiée (`git add` ciblé, jamais `git add -A`).
- Cache : réutiliser `apps/web/src/data/onchain/cache.ts` (`lireCache`/`ecrireCache`/`estFrais`) tel quel pour TOUTE nouvelle source lente — ne pas dupliquer ce module.
- Nouvelle fenêtre : 4 points d'intégration obligatoires (pattern vérifié sur RATE) : (1) `store/windowManager.ts` → entrée `WINDOW_REGISTRY` ; (2) `App.tsx` → import composant + montage conditionnel par id ; (3) `Toolbar.tsx` → entrée menu « Fonctions » ; (4) le composant lui-même exporte `commandes: Commande[]` pour la palette ⌘K.

**Dépendances entre tâches (parallélisation SDD)** : T0→{T2→T3, T5} · T1 · T4 · T6. Les chaînes {T1}, {T4}, {T6} sont indépendantes de tout le reste et entre elles.

---

## Task 0: Proxy `/extapi` — nouveaux hôtes + User-Agent par hôte

**Files:**
- Modify: `apps/daemon/src/proxy.ts` (EXTAPI_WHITELIST + nouvelle fonction `userAgentPourHote`)
- Modify: `apps/web/vite.config.ts` (EXTAPI_HOTES + header User-Agent conditionnel)
- Modify: `apps/web/src/data/extapi.ts` (EXTAPI_WHITELIST, constante documentée)
- Modify: `apps/daemon/src/proxy.test.ts` (taille whitelist + nouveaux hôtes)

**Interfaces:**
- Produces: `userAgentPourHote(hote: string): string` (exportée de `apps/daemon/src/proxy.ts`) — renvoie un UA conforme SEC pour `data.sec.gov`/`www.sec.gov`, sinon `EXTAPI_USER_AGENT` (inchangé pour tous les hôtes existants).
- Nouveaux hôtes whitelistés (3 fichiers) : `data.sec.gov`, `www.sec.gov`, `api.gdeltproject.org`.

- [ ] **Step 1: Écrire le test de `userAgentPourHote`**

```ts
// apps/daemon/src/proxy.test.ts (ajout, dans le describe "extapi — whitelist" existant ou un nouveau describe)
import { userAgentPourHote, EXTAPI_WHITELIST } from "./proxy";

describe("extapi — User-Agent par hôte", () => {
  test("SEC EDGAR reçoit un UA conforme (identifiant, pas le UA navigateur générique)", () => {
    const ua = userAgentPourHote("data.sec.gov");
    expect(ua).toContain("AxiomTerminal");
    expect(ua).not.toContain("Mozilla");
    expect(userAgentPourHote("www.sec.gov")).toBe(ua);
  });

  test("hôte non-SEC reçoit le UA navigateur générique inchangé", () => {
    expect(userAgentPourHote("mempool.space")).toContain("Mozilla");
  });
});

describe("extapi — whitelist (mise à jour Lot E1)", () => {
  test("taille attendue après ajout SEC + GDELT", () => {
    expect(EXTAPI_WHITELIST.size).toBe(26); // 23 existants + data.sec.gov + www.sec.gov + api.gdeltproject.org
  });
  test("nouveaux hôtes présents", () => {
    expect(EXTAPI_WHITELIST.has("data.sec.gov")).toBe(true);
    expect(EXTAPI_WHITELIST.has("www.sec.gov")).toBe(true);
    expect(EXTAPI_WHITELIST.has("api.gdeltproject.org")).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `pnpm --filter @axiom/daemon test -- proxy.test.ts`
Expected: FAIL (`userAgentPourHote is not a function`, taille whitelist = 23 pas 26)

- [ ] **Step 3: Implémenter dans `apps/daemon/src/proxy.ts`**

Ajouter les 3 hôtes à `EXTAPI_WHITELIST` (avec commentaires cohérents avec le style existant) :

```ts
export const EXTAPI_WHITELIST: ReadonlySet<string> = new Set([
  // ... 23 entrées existantes inchangées ...
  "data.sec.gov", // SEC EDGAR (submissions, XBRL companyfacts) — panneau FUND
  "www.sec.gov", // SEC EDGAR (company_tickers.json, résolution ticker→CIK) — panneau FUND
  "api.gdeltproject.org", // GDELT (recherche news ciblée par mot-clé) — NEWS enrichi
]);
```

Juste après `EXTAPI_USER_AGENT`, ajouter :

```ts
/** Hôtes exigeant un User-Agent CONFORME (identifiant + contact), pas le UA navigateur
 * générique : la politique d'accès équitable de la SEC bloque/liste noire les UA non
 * identifiants. Un `fetch()` navigateur ne peut de toute façon PAS surcharger `User-Agent`
 * (en-tête interdit côté client) — ce proxy est le SEUL endroit où l'injecter. */
const EXTAPI_USER_AGENT_SEC = "AxiomTerminal/1.0 (usage personnel non commercial)";
const EXTAPI_USER_AGENT_HOTES: ReadonlyMap<string, string> = new Map([
  ["data.sec.gov", EXTAPI_USER_AGENT_SEC],
  ["www.sec.gov", EXTAPI_USER_AGENT_SEC],
]);

/** User-Agent à envoyer à l'amont pour un hôte /extapi donné. Fonction PURE (testée). */
export function userAgentPourHote(hote: string): string {
  return EXTAPI_USER_AGENT_HOTES.get(hote) ?? EXTAPI_USER_AGENT;
}
```

Dans `traiterExtapi`, remplacer la ligne `headers: { "user-agent": EXTAPI_USER_AGENT, accept: "*/*" }` par :

```ts
headers: { "user-agent": userAgentPourHote(parsed.hote), accept: "*/*" },
```

- [ ] **Step 4: Répercuter dans `apps/web/vite.config.ts`**

Ajouter les 3 hôtes à `EXTAPI_HOTES` (même commentaire que ci-dessus). Dans la construction de `extapiProxy`, le header est aujourd'hui fixe (`headers: { "User-Agent": EXTAPI_USER_AGENT }` pour toutes les entrées) — rendre conditionnel par hôte en dupliquant la même petite map `EXTAPI_USER_AGENT_HOTES` (constante locale à ce fichier, PAS d'import cross-package `apps/daemon`→`apps/web` interdit par les conventions du projet — copie verbatim documentée, comme `appendApiKeyIfAbsent` l'est déjà entre `apps/daemon/src/proxy.ts` et `apps/web/src/data/apiKeyProxy.ts`).

- [ ] **Step 5: Répercuter dans `apps/web/src/data/extapi.ts`**

Ajouter les 3 mêmes hôtes (avec commentaires) à la constante `EXTAPI_WHITELIST` exportée de ce fichier.

- [ ] **Step 6: Lancer les tests, vérifier le succès**

Run: `pnpm --filter @axiom/daemon test -- proxy.test.ts`
Expected: PASS (tous les tests, y compris les préexistants)

- [ ] **Step 7: Typecheck + build**

Run: `pnpm -r typecheck`
Expected: 0 erreur sur les 6 workspaces

- [ ] **Step 8: Commit**

```bash
git add apps/daemon/src/proxy.ts apps/daemon/src/proxy.test.ts apps/web/vite.config.ts apps/web/src/data/extapi.ts
git commit -m "feat(extapi): whitelist SEC EDGAR + GDELT, User-Agent conforme par hôte"
```

---

## Task 1: Fix ETF flows (BTC/ETH/SOL) — SoSoValue

**Files:**
- Create: `apps/web/src/store/sosovalue.ts` (store clé, pattern `bgeometricsKeyStore`)
- Modify: `apps/web/src/data/onchain/etf.ts` (remplacement complet)
- Test: `apps/web/src/data/onchain/etf.test.ts` (nouveau, remplace tout test existant sur ce module s'il y en a)
- Modify: `apps/web/src/components/OnchainWindow.tsx` (section ETF → sélecteur d'actif)
- Modify: `apps/web/src/components/SettingsPanel.tsx` (nouveau champ clé SoSoValue)

**Interfaces:**
- Consumes: rien (module autonome).
- Produces: `type ActifEtf = "btc" | "eth" | "sol"` ; `interface FluxEmetteur { emetteur: string; flux: number }` (inchangé) ; `interface EtfResultat { disponible: boolean; raison?: string; jour?: string; parEmetteur?: FluxEmetteur[]; total?: number }` (inchangé, réutilisé par `OnchainWindow.tsx`) ; `parseEtfFlows(json: unknown): EtfResultat` (signature inchangée, nouveau schéma JSON reconnu) ; `fetchEtfFlows(actif: ActifEtf, cle: string | null, signal?: AbortSignal): Promise<EtfResultat>` (signature ÉTENDUE : `actif` + `cle` en nouveaux paramètres obligatoires en 1ère/2ème position).
- `soSoValueKeyStore : { hasKey: boolean; setKey: (k: string) => void; clearKey: () => void }` + `getSoSoValueKey(): string | null`, mêmes noms que `bgeometricsKeyStore`/`getBgeometricsKey`.

⚠️ **Avant le Step 1 : découverte manuelle de l'endpoint réel** (la doc gitbook SoSoValue n'a pas pu être lue par la recherche automatisée). Zaki s'inscrit sur `sosovalue.com/developer`, obtient une clé Demo/Beta gratuite, et l'implémenteur teste EN RÉEL (curl avec `x-soso-api-key`) les chemins plausibles sous `https://openapi.sosovalue.com/openapi/v2/` (ex. `etf/historicalInflowChart`, `etf/currentEtfDataMetrics`, variantes `us-btc-spot`/`us-eth-spot`/`us-sol-spot` en paramètre). Documenter le chemin RÉEL trouvé en tête du fichier (même style que le commentaire actuel de `etf.ts` qui documente les tentatives DefiLlama). Si AUCUN chemin ne fonctionne dans un délai raisonnable, dégrader proprement comme aujourd'hui (`disponible:false`) et documenter la tentative — ne pas bloquer le reste du lot dessus.

- [ ] **Step 1: Store de clé — écrire le test**

```ts
// apps/web/src/store/sosovalue.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { soSoValueKeyStore, getSoSoValueKey } from "./sosovalue";

describe("soSoValueKeyStore", () => {
  beforeEach(() => {
    localStorage.clear();
    soSoValueKeyStore.getState().clearKey();
  });

  it("aucune clé par défaut", () => {
    expect(soSoValueKeyStore.getState().hasKey).toBe(false);
    expect(getSoSoValueKey()).toBeNull();
  });

  it("setKey persiste et hasKey passe à true", () => {
    soSoValueKeyStore.getState().setKey("abc123");
    expect(soSoValueKeyStore.getState().hasKey).toBe(true);
    expect(getSoSoValueKey()).toBe("abc123");
  });

  it("setKey avec chaîne vide équivaut à clearKey", () => {
    soSoValueKeyStore.getState().setKey("abc123");
    soSoValueKeyStore.getState().setKey("");
    expect(soSoValueKeyStore.getState().hasKey).toBe(false);
  });

  it("clearKey supprime la clé", () => {
    soSoValueKeyStore.getState().setKey("abc123");
    soSoValueKeyStore.getState().clearKey();
    expect(soSoValueKeyStore.getState().hasKey).toBe(false);
    expect(getSoSoValueKey()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, vérifier l'échec** — `pnpm --filter @axiom/web test -- sosovalue.test.ts` → FAIL (module introuvable)

- [ ] **Step 3: Implémenter `apps/web/src/store/sosovalue.ts`** (copie exacte du pattern `apps/web/src/store/onchain.ts` §BGeometrics, adapté) :

```ts
/**
 * Store clé SoSoValue (ETF flows BTC/ETH/SOL) — Zustand VANILLA.
 * Clé OBLIGATOIRE (pas de repli serveur .env, contrairement à FRED/Coinalyze) : le
 * module `data/onchain/etf.ts` refuse d'appeler l'API sans clé et renvoie
 * `disponible:false, raison:"clé SoSoValue non configurée"`.
 */
import { createStore } from "zustand/vanilla";

const STORAGE_KEY = "axiom:sosovalue:key";

function readKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v !== null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeKey(key: string | null): void {
  try {
    if (key === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* best-effort */
  }
}

export function getSoSoValueKey(): string | null {
  return readKey();
}

export interface SoSoValueKeyState {
  hasKey: boolean;
  setKey: (key: string) => void;
  clearKey: () => void;
}

export const soSoValueKeyStore = createStore<SoSoValueKeyState>((set) => ({
  hasKey: readKey() !== null,
  setKey: (key) => {
    const k = key.trim();
    const value = k.length > 0 ? k : null;
    writeKey(value);
    set({ hasKey: value !== null });
  },
  clearKey: () => {
    writeKey(null);
    set({ hasKey: false });
  },
}));
```

- [ ] **Step 4: Run, vérifier le succès** — PASS

- [ ] **Step 5: Réécrire `data/onchain/etf.ts` — écrire le test de parsing d'abord**

```ts
// apps/web/src/data/onchain/etf.test.ts
import { describe, expect, it } from "vitest";
import { parseEtfFlows } from "./etf";

describe("parseEtfFlows (schéma SoSoValue — À AJUSTER une fois le schéma réel confirmé)", () => {
  it("parse une réponse valide", () => {
    const json = {
      data: {
        date: "2026-07-07",
        list: [
          { ticker: "IBIT", netInflow: "125000000" },
          { ticker: "FBTC", netInflow: "-30000000" },
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.disponible).toBe(true);
    expect(r.parEmetteur).toEqual([
      { emetteur: "IBIT", flux: 125_000_000 },
      { emetteur: "FBTC", flux: -30_000_000 },
    ]);
    expect(r.total).toBe(95_000_000);
    expect(r.jour).toBe("2026-07-07");
  });

  it("dégrade proprement sur forme inconnue", () => {
    expect(parseEtfFlows(null).disponible).toBe(false);
    expect(parseEtfFlows({}).disponible).toBe(false);
    expect(parseEtfFlows({ data: { list: [] } }).disponible).toBe(false);
  });
});
```

**Note pour l'implémenteur** : ce test encode un schéma PLAUSIBLE — à corriger avec le
vrai schéma une fois l'endpoint confirmé (Step 0 ci-dessus). Le principe ne change pas :
défensif, ignore les entrées non reconnues, jamais d'exception.

- [ ] **Step 6: Run, vérifier l'échec** (ancien schéma DefiLlama ne matche plus)

- [ ] **Step 7: Implémenter** — remplacer `apps/web/src/data/onchain/etf.ts` en entier :

```ts
/**
 * Flux ETF spot BTC/ETH/SOL — SoSoValue (openapi.sosovalue.com).
 *
 * Remplace l'ancien module DefiLlama (mort : tous les endpoints `/overview/etfs`
 * renvoient 404/500, vérifié 2026-07-02). SoSoValue couvre BTC + ETH + SOL avec un
 * seul provider (ETF spot Solana actifs depuis approbation SEC 10/2025).
 * Clé OBLIGATOIRE (plan Demo/Beta gratuit, 20 req/min, sosovalue.com/developer),
 * envoyée via l'en-tête `x-soso-api-key` (CORS confirmé : appel DIRECT, pas de proxy).
 */
import { ecrireCache, estFrais, lireCache } from "./cache";

export type ActifEtf = "btc" | "eth" | "sol";

const BASE = "https://openapi.sosovalue.com/openapi/v2/etf/historicalInflowChart";
export const ETF_TTL_MS = 6 * 60 * 60 * 1000;

export interface FluxEmetteur {
  emetteur: string;
  flux: number;
}

export interface EtfResultat {
  disponible: boolean;
  raison?: string;
  jour?: string;
  parEmetteur?: FluxEmetteur[];
  total?: number;
}

/** Parse une réponse SoSoValue en flux par émetteur. PURE, défensive. */
export function parseEtfFlows(json: unknown): EtfResultat {
  const indisponible: EtfResultat = { disponible: false, raison: "Réponse SoSoValue non reconnue." };
  if (json === null || typeof json !== "object") return indisponible;

  const data = (json as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return indisponible;
  const { date, list } = data as { date?: unknown; list?: unknown };
  if (!Array.isArray(list) || list.length === 0) return indisponible;

  const parEmetteur: FluxEmetteur[] = [];
  for (const brut of list) {
    const it = brut as { ticker?: unknown; netInflow?: unknown };
    const emetteur = typeof it.ticker === "string" ? it.ticker : undefined;
    const flux = typeof it.netInflow === "number" ? it.netInflow : Number(it.netInflow);
    if (emetteur === undefined || !Number.isFinite(flux)) continue;
    parEmetteur.push({ emetteur, flux });
  }
  if (parEmetteur.length === 0) return indisponible;

  return {
    disponible: true,
    jour: typeof date === "string" ? date : undefined,
    parEmetteur,
    total: parEmetteur.reduce((s, e) => s + e.flux, 0),
  };
}

/**
 * Récupère les flux ETF pour un actif, avec cache 6 h et dégradation gracieuse.
 * Renvoie `disponible:false` immédiatement (sans appel réseau) si aucune clé n'est
 * configurée — la clé est OBLIGATOIRE chez SoSoValue, contrairement à BGeometrics.
 */
export async function fetchEtfFlows(
  actif: ActifEtf,
  cle: string | null,
  signal?: AbortSignal,
): Promise<EtfResultat> {
  if (cle === null) {
    return { disponible: false, raison: "Clé SoSoValue non configurée (Réglages)." };
  }

  const cacheCle = `etf:${actif}`;
  const cache = await lireCache<EtfResultat>(cacheCle);
  if (estFrais(cache, ETF_TTL_MS) && cache !== null) return cache.donnee;

  let resultat: EtfResultat;
  try {
    const res = await fetch(`${BASE}?type=us-${actif}-spot`, {
      headers: { "x-soso-api-key": cle },
      signal,
    });
    resultat = res.ok
      ? parseEtfFlows((await res.json()) as unknown)
      : { disponible: false, raison: `SoSoValue indisponible (HTTP ${res.status}).` };
  } catch {
    resultat = { disponible: false, raison: "SoSoValue injoignable." };
  }
  await ecrireCache(cacheCle, resultat);
  return resultat;
}
```

- [ ] **Step 8: Run, vérifier le succès** — PASS

- [ ] **Step 9: `OnchainWindow.tsx` — sélecteur d'actif ETF**

Dans `EtatDonnees`, remplacer `etf: EtfResultat | null` par `etf: Record<ActifEtf, EtfResultat | null>`. Ajouter un state local `const [actifEtf, setActifEtf] = useState<ActifEtf>("btc")`. Dans le `charger`, remplacer l'appel unique `fetchEtfFlows(ctrl.signal)` par 3 appels parallèles (un par actif) alimentant la map. Dans la section JSX "Flux ETF spot BTC" (renommer le titre en "Flux ETF spot"), ajouter 3 boutons onglets (BTC/ETH/SOL, même style que les onglets de `MacroRatesWindow`) au-dessus du rendu existant, qui affiche `donnees.etf[actifEtf]` au lieu de `donnees.etf`. Importer `getSoSoValueKey` et `soSoValueKeyStore` (comme le fait déjà `OnchainWindow.tsx` pour `bgeometricsKeyStore`) ; si `!hasKey`, afficher le lien "clé SoSoValue ⚙" vers Réglages (même pattern que le lien BGeometrics existant), au lieu de tenter le fetch.

- [ ] **Step 10: `SettingsPanel.tsx` — nouveau champ**

Ajouter un `<ApiKeyField>` pour SoSoValue (copier le bloc BGeometrics existant), avec :
`name="SoSoValue"`, `purpose="Flux ETF spot BTC/ETH/SOL — obligatoire, plan Demo gratuit."`, `domain="openapi.sosovalue.com"`, `signupUrl="https://sosovalue.com/developer"`, `signupLabel="Obtenir une clé gratuite"`. Importer `soSoValueKeyStore` et brancher `hasKey`/`setKey`/`clearKey` comme les 3 champs existants.

- [ ] **Step 11: Vérification manuelle**

Run: `pnpm --filter @axiom/web dev`, ouvrir Réglages → saisir une vraie clé SoSoValue → ouvrir CHAIN → basculer BTC/ETH/SOL → vérifier des flux réels ou un message d'indisponibilité propre (pas d'erreur console).

- [ ] **Step 12: Typecheck + suite complète**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: 0 erreur, tous les tests verts (y compris les nouveaux)

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/store/sosovalue.ts apps/web/src/store/sosovalue.test.ts \
        apps/web/src/data/onchain/etf.ts apps/web/src/data/onchain/etf.test.ts \
        apps/web/src/components/OnchainWindow.tsx apps/web/src/components/SettingsPanel.tsx
git commit -m "fix(etf): remplace DefiLlama mort par SoSoValue, couvre BTC/ETH/SOL"
```

---

## Task 2: Données FUND — SEC EDGAR + Finnhub (fondamentaux/insider/earnings)

**Files:**
- Create: `apps/web/src/data/fund/secEdgar.ts`
- Create: `apps/web/src/data/fund/finnhub.ts`
- Create: `apps/web/src/store/finnhub.ts` (store clé, pattern BGeometrics — clé partagée FUND+NEWS)
- Test: `apps/web/src/data/fund/secEdgar.test.ts`
- Test: `apps/web/src/data/fund/finnhub.test.ts`
- Test: `apps/web/src/store/finnhub.test.ts`

**Interfaces:**
- Consumes: `extUrl` de `../extapi` (proxy SEC) ; `ecrireCache`/`estFrais`/`lireCache` de `../onchain/cache`.
- Produces:
  - `interface EntreeTicker { cik: string; ticker: string; nom: string }` ; `chargerTickers(signal?: AbortSignal): Promise<EntreeTicker[]>` (charge + cache 24 h `www.sec.gov/files/company_tickers.json`).
  - `rechercherSociete(query: string, tickers: EntreeTicker[]): EntreeTicker[]` (PURE, substring insensible à la casse sur ticker+nom, max 15 résultats).
  - `interface InsiderTx { date: string; initié: string; type: "achat" | "vente"; montant: number | null }` ; `interface ProfilSec { nom: string; cik: string; secteur?: string; insiders: InsiderTx[] }` ; `chargerProfilSec(cik: string, signal?: AbortSignal): Promise<ProfilSec | null>` (submissions + 2-3 concepts XBRL, `null` si CIK inconnu/échec).
  - `getFinnhubKey(): string | null` ; `finnhubKeyStore: { hasKey; setKey; clearKey }` (dans `store/finnhub.ts`).
  - `interface ProfilFinnhub { nom: string; secteur: string; capitalisation: number | null; description: string }` ; `chargerProfilFinnhub(ticker: string, cle: string, signal?: AbortSignal): Promise<ProfilFinnhub | null>`.
  - `interface EarningsEvent { ticker: string; date: string; epsEstime: number | null; epsReel: number | null }` ; `chargerEarnings(ticker: string, cle: string, signal?: AbortSignal): Promise<EarningsEvent[]>`.

- [ ] **Step 1: Store clé Finnhub — test**

```ts
// apps/web/src/store/finnhub.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { finnhubKeyStore, getFinnhubKey } from "./finnhub";

describe("finnhubKeyStore", () => {
  beforeEach(() => {
    localStorage.clear();
    finnhubKeyStore.getState().clearKey();
  });
  it("aucune clé par défaut", () => {
    expect(finnhubKeyStore.getState().hasKey).toBe(false);
    expect(getFinnhubKey()).toBeNull();
  });
  it("setKey persiste", () => {
    finnhubKeyStore.getState().setKey("xyz");
    expect(finnhubKeyStore.getState().hasKey).toBe(true);
    expect(getFinnhubKey()).toBe("xyz");
  });
});
```

- [ ] **Step 2: Run, vérifier l'échec** — module introuvable.

- [ ] **Step 3: Implémenter `store/finnhub.ts`** (copie exacte du pattern `store/sosovalue.ts` du Task 1, `STORAGE_KEY = "axiom:finnhub:key"`, renommer les identifiants).

- [ ] **Step 4: Run, vérifier le succès.**

- [ ] **Step 5: `rechercherSociete` — écrire le test (fonction pure, à isoler en premier)**

```ts
// apps/web/src/data/fund/secEdgar.test.ts
import { describe, expect, it } from "vitest";
import { rechercherSociete, type EntreeTicker } from "./secEdgar";

const TICKERS: EntreeTicker[] = [
  { cik: "0000320193", ticker: "AAPL", nom: "Apple Inc." },
  { cik: "0000789019", ticker: "MSFT", nom: "Microsoft Corp" },
  { cik: "0001652044", ticker: "GOOGL", nom: "Alphabet Inc." },
];

describe("rechercherSociete", () => {
  it("trouve par ticker exact", () => {
    expect(rechercherSociete("AAPL", TICKERS)).toEqual([TICKERS[0]]);
  });
  it("trouve par sous-chaîne du nom, insensible à la casse", () => {
    expect(rechercherSociete("apple", TICKERS)).toEqual([TICKERS[0]]);
  });
  it("aucun résultat renvoie un tableau vide", () => {
    expect(rechercherSociete("zzz", TICKERS)).toEqual([]);
  });
  it("plafonne à 15 résultats", () => {
    const beaucoup: EntreeTicker[] = Array.from({ length: 30 }, (_, i) => ({
      cik: String(i),
      ticker: `T${i}`,
      nom: `Test Corp ${i}`,
    }));
    expect(rechercherSociete("test", beaucoup)).toHaveLength(15);
  });
});
```

- [ ] **Step 6: Run, vérifier l'échec.**

- [ ] **Step 7: Implémenter `data/fund/secEdgar.ts`**

```ts
/**
 * SEC EDGAR — résolution ticker→CIK, profil société, insiders (Form 4), 2-3 concepts
 * XBRL simples. Routé via /extapi (data.sec.gov + www.sec.gov n'ont pas de CORS
 * exploitable pour un User-Agent conforme — cf. spec Lot E1 §0). Gratuit, sans clé,
 * 10 req/s (largement suffisant en usage perso).
 */
import { extUrl } from "../extapi";
import { ecrireCache, estFrais, lireCache } from "../onchain/cache";

const TTL_TICKERS_MS = 24 * 60 * 60 * 1000;
const TTL_PROFIL_MS = 6 * 60 * 60 * 1000;
const CONCEPTS_XBRL = ["Assets", "Liabilities", "NetIncomeLoss"] as const;

export interface EntreeTicker {
  cik: string;
  ticker: string;
  nom: string;
}

/** Recherche substring insensible à la casse sur ticker+nom. PURE. Plafond 15 résultats. */
export function rechercherSociete(query: string, tickers: EntreeTicker[]): EntreeTicker[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const trouves = tickers.filter(
    (t) => t.ticker.toLowerCase().includes(q) || t.nom.toLowerCase().includes(q),
  );
  return trouves.slice(0, 15);
}

/** Parse la réponse `company_tickers.json` (objet indexé 0..N, PAS un tableau). PURE. */
export function parseTickers(json: unknown): EntreeTicker[] {
  if (json === null || typeof json !== "object") return [];
  const out: EntreeTicker[] = [];
  for (const brut of Object.values(json as Record<string, unknown>)) {
    const it = brut as { cik_str?: unknown; ticker?: unknown; title?: unknown };
    const ticker = typeof it.ticker === "string" ? it.ticker : undefined;
    const nom = typeof it.title === "string" ? it.title : undefined;
    const cikNum = typeof it.cik_str === "number" ? it.cik_str : Number(it.cik_str);
    if (ticker === undefined || nom === undefined || !Number.isFinite(cikNum)) continue;
    out.push({ cik: String(cikNum).padStart(10, "0"), ticker, nom });
  }
  return out;
}

/** Charge la liste complète des tickers SEC (cache 24 h, ~10 000 entrées). */
export async function chargerTickers(signal?: AbortSignal): Promise<EntreeTicker[]> {
  const cle = "sec:tickers";
  const cache = await lireCache<EntreeTicker[]>(cle);
  if (estFrais(cache, TTL_TICKERS_MS) && cache !== null) return cache.donnee;

  try {
    const res = await fetch(extUrl("www.sec.gov", "files/company_tickers.json"), { signal });
    if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
    const tickers = parseTickers((await res.json()) as unknown);
    await ecrireCache(cle, tickers);
    return tickers;
  } catch {
    return cache?.donnee ?? [];
  }
}

export interface InsiderTx {
  date: string;
  initié: string;
  type: "achat" | "vente";
  montant: number | null;
}

export interface ProfilSec {
  nom: string;
  cik: string;
  secteur?: string;
  insiders: InsiderTx[];
}

/** Parse `submissions/CIK##########.json` en profil + Form 4 récents. PURE, défensive. */
export function parseProfilSec(json: unknown, cik: string): ProfilSec | null {
  if (json === null || typeof json !== "object") return null;
  const obj = json as { name?: unknown; sicDescription?: unknown };
  if (typeof obj.name !== "string") return null;
  // Les Form 4 individuels ne sont PAS dans /submissions (juste la liste des dépôts) —
  // v1 : uniquement nom + secteur ; `insiders` reste vide tant qu'un parseur Form 4 XML
  // dédié n'est pas écrit (hors scope v1, cf. spec §2 "pas un dépouillement complet").
  return {
    nom: obj.name,
    cik,
    secteur: typeof obj.sicDescription === "string" ? obj.sicDescription : undefined,
    insiders: [],
  };
}

/** Charge le profil SEC d'une société (cache 6 h). `null` si CIK inconnu/échec réseau total. */
export async function chargerProfilSec(cik: string, signal?: AbortSignal): Promise<ProfilSec | null> {
  const cle = `sec:profil:${cik}`;
  const cache = await lireCache<ProfilSec>(cle);
  if (estFrais(cache, TTL_PROFIL_MS) && cache !== null) return cache.donnee;

  try {
    const res = await fetch(extUrl("data.sec.gov", `submissions/CIK${cik}.json`), { signal });
    if (!res.ok) return cache?.donnee ?? null;
    const profil = parseProfilSec((await res.json()) as unknown, cik);
    if (profil !== null) await ecrireCache(cle, profil);
    return profil ?? cache?.donnee ?? null;
  } catch {
    return cache?.donnee ?? null;
  }
}

/** Concepts XBRL simples exposés (référence pour l'appelant — pas encore agrégés v1). */
export const CONCEPTS_XBRL_DISPONIBLES = CONCEPTS_XBRL;
```

- [ ] **Step 8: Run, vérifier le succès.**

- [ ] **Step 9: `data/fund/finnhub.ts` — écrire le test de parsing**

```ts
// apps/web/src/data/fund/finnhub.test.ts
import { describe, expect, it } from "vitest";
import { parseProfilFinnhub, parseEarnings } from "./finnhub";

describe("parseProfilFinnhub", () => {
  it("parse un profil valide", () => {
    const json = { name: "Apple Inc", finnhubIndustry: "Technology", marketCapitalization: 3_000_000, weburl: "" };
    expect(parseProfilFinnhub(json)).toEqual({
      nom: "Apple Inc",
      secteur: "Technology",
      capitalisation: 3_000_000,
      description: "",
    });
  });
  it("renvoie null sur objet vide", () => {
    expect(parseProfilFinnhub({})).toBeNull();
  });
});

describe("parseEarnings", () => {
  it("parse une liste d'événements", () => {
    const json = {
      earningsCalendar: [
        { symbol: "AAPL", date: "2026-07-30", epsEstimate: 1.5, epsActual: null },
      ],
    };
    expect(parseEarnings(json, "AAPL")).toEqual([
      { ticker: "AAPL", date: "2026-07-30", epsEstime: 1.5, epsReel: null },
    ]);
  });
  it("liste vide sur forme inconnue", () => {
    expect(parseEarnings(null, "AAPL")).toEqual([]);
  });
});
```

- [ ] **Step 10: Run, vérifier l'échec.**

- [ ] **Step 11: Implémenter `data/fund/finnhub.ts`**

```ts
/**
 * Finnhub — profil société + calendrier de résultats. Appel DIRECT (CORS confirmé
 * `access-control-allow-origin: *`, vérifié 2026-07-08). Clé requise (60 req/min gratuit).
 */
import { ecrireCache, estFrais, lireCache } from "../onchain/cache";

const BASE = "https://finnhub.io/api/v1";
const TTL_PROFIL_MS = 12 * 60 * 60 * 1000;
const TTL_EARNINGS_MS = 6 * 60 * 60 * 1000;

export interface ProfilFinnhub {
  nom: string;
  secteur: string;
  capitalisation: number | null;
  description: string;
}

/** PURE, défensive. */
export function parseProfilFinnhub(json: unknown): ProfilFinnhub | null {
  if (json === null || typeof json !== "object") return null;
  const obj = json as { name?: unknown; finnhubIndustry?: unknown; marketCapitalization?: unknown; weburl?: unknown };
  if (typeof obj.name !== "string" || obj.name.length === 0) return null;
  const cap = typeof obj.marketCapitalization === "number" ? obj.marketCapitalization : null;
  return {
    nom: obj.name,
    secteur: typeof obj.finnhubIndustry === "string" ? obj.finnhubIndustry : "",
    capitalisation: cap,
    description: typeof obj.weburl === "string" ? obj.weburl : "",
  };
}

export async function chargerProfilFinnhub(
  ticker: string,
  cle: string,
  signal?: AbortSignal,
): Promise<ProfilFinnhub | null> {
  const cacheCle = `finnhub:profil:${ticker}`;
  const cache = await lireCache<ProfilFinnhub>(cacheCle);
  if (estFrais(cache, TTL_PROFIL_MS) && cache !== null) return cache.donnee;

  try {
    const url = `${BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(cle)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return cache?.donnee ?? null;
    const profil = parseProfilFinnhub((await res.json()) as unknown);
    if (profil !== null) await ecrireCache(cacheCle, profil);
    return profil ?? cache?.donnee ?? null;
  } catch {
    return cache?.donnee ?? null;
  }
}

export interface EarningsEvent {
  ticker: string;
  date: string;
  epsEstime: number | null;
  epsReel: number | null;
}

/** PURE, défensive. */
export function parseEarnings(json: unknown, ticker: string): EarningsEvent[] {
  const cal = (json as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(cal)) return [];
  const out: EarningsEvent[] = [];
  for (const brut of cal) {
    const it = brut as { date?: unknown; epsEstimate?: unknown; epsActual?: unknown };
    if (typeof it.date !== "string") continue;
    out.push({
      ticker,
      date: it.date,
      epsEstime: typeof it.epsEstimate === "number" ? it.epsEstimate : null,
      epsReel: typeof it.epsActual === "number" ? it.epsActual : null,
    });
  }
  return out;
}

export async function chargerEarnings(
  ticker: string,
  cle: string,
  signal?: AbortSignal,
): Promise<EarningsEvent[]> {
  const cacheCle = `finnhub:earnings:${ticker}`;
  const cache = await lireCache<EarningsEvent[]>(cacheCle);
  if (estFrais(cache, TTL_EARNINGS_MS) && cache !== null) return cache.donnee;

  try {
    const dansUnAn = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const url = `${BASE}/calendar/earnings?from=${aujourdhui}&to=${dansUnAn}&symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(cle)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return cache?.donnee ?? [];
    const events = parseEarnings((await res.json()) as unknown, ticker);
    await ecrireCache(cacheCle, events);
    return events;
  } catch {
    return cache?.donnee ?? [];
  }
}
```

- [ ] **Step 12: Run, vérifier le succès.**

- [ ] **Step 13: Typecheck**

Run: `pnpm --filter @axiom/web typecheck`
Expected: 0 erreur

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/data/fund/ apps/web/src/store/finnhub.ts apps/web/src/store/finnhub.test.ts
git commit -m "feat(fund): modules SEC EDGAR + Finnhub (fondamentaux, insider, earnings)"
```

---

## Task 3: Fenêtre FUND (consomme Task 2)

**Files:**
- Create: `apps/web/src/components/FundWindow.tsx`
- Modify: `apps/web/src/store/windowManager.ts` (entrée registre)
- Modify: `apps/web/src/App.tsx` (import + montage)
- Modify: `apps/web/src/components/Toolbar.tsx` (entrée menu Fonctions)
- Modify: `apps/web/src/components/SettingsPanel.tsx` (champ clé Finnhub)

**Interfaces:**
- Consumes (de Task 2) : `chargerTickers`, `rechercherSociete`, `chargerProfilSec`, `EntreeTicker`, `ProfilSec` (de `data/fund/secEdgar`) ; `chargerProfilFinnhub`, `chargerEarnings`, `ProfilFinnhub`, `EarningsEvent` (de `data/fund/finnhub`) ; `finnhubKeyStore`, `getFinnhubKey` (de `store/finnhub`).
- Produces: `fundUiStore : { open; openFund; closeFund; toggleFund }` (pattern `macroRatesUiStore`) ; `commandes: Commande[]` (mnémonique `FUND`).

- [ ] **Step 1: Ajouter l'entrée au registre**

Dans `apps/web/src/store/windowManager.ts`, `WINDOW_REGISTRY`, ajouter après l'entrée `"vol"` :

```ts
{ id: "fund", title: "Fiche société (FUND)", mnemonic: "FUND", defaultWidth: 480, defaultHeight: 640 },
```

Mettre à jour le commentaire de tête (`« ... les 18 fenêtres Bloomberg... »` devient 19) et le test `windowManager.test.ts` si celui-ci compte les entrées (`WINDOW_REGISTRY.length`).

- [ ] **Step 2: Implémenter `FundWindow.tsx`** (pattern exact `MacroRatesWindow.tsx` : store UI vanilla + `mirrorOpenState` + `commandes` + onglets Profil/Insider/Earnings, chargement paresseux par onglet). Champ de recherche société en en-tête (utilise `chargerTickers` au montage + `rechercherSociete` sur la saisie, debounce 200 ms) ; sélection d'un résultat déclenche `chargerProfilSec(cik)` + `chargerProfilFinnhub(ticker, cle)` + `chargerEarnings(ticker, cle)` en parallèle. Si `!finnhubKeyStore.getState().hasKey`, afficher un message "configurez une clé Finnhub (Réglages)" à la place des onglets Profil/Earnings (SEC EDGAR seul reste utilisable sans clé — Insider fonctionne même sans clé Finnhub).

- [ ] **Step 3: Câbler `App.tsx`**

Suivre EXACTEMENT le point d'intégration de `macroRates` (import du composant, montage conditionnel par id dans la liste des fenêtres flottantes, import de `commandes` et enregistrement via le même mécanisme que les 18 fenêtres existantes).

- [ ] **Step 4: Câbler `Toolbar.tsx`**

Ajouter l'entrée "FUND — Fiche société" au menu "Fonctions", au même endroit que l'entrée RATE (ligne ~159 selon la reconnaissance).

- [ ] **Step 5: `SettingsPanel.tsx` — champ Finnhub**

Ajouter un `<ApiKeyField>` : `name="Finnhub"`, `purpose="Fondamentaux, earnings (FUND) et actualités générales (NEWS)."`, `domain="finnhub.io"`, `signupUrl="https://finnhub.io/register"`, `signupLabel="Obtenir une clé gratuite"`. Un seul champ, deux consommateurs (FUND + Task 5 NEWS).

- [ ] **Step 6: Vérification manuelle**

Run: `pnpm --filter @axiom/web dev` → ⌘K → "FUND" → rechercher "Apple" → vérifier profil SEC (sans clé Finnhub) puis avec une clé Finnhub réelle (profil + earnings). Vérifier qu'aucune erreur console ne boucle.

- [ ] **Step 7: Typecheck + suite complète**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: 0 erreur, tous les tests verts

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/FundWindow.tsx apps/web/src/store/windowManager.ts \
        apps/web/src/App.tsx apps/web/src/components/Toolbar.tsx apps/web/src/components/SettingsPanel.tsx
git commit -m "feat(fund): nouvelle fenêtre FUND (fiche société tradfi)"
```

---

## Task 4: CRVF — vraie courbe de taux (extension de RATE)

**Files:**
- Modify: `apps/web/src/data/macro/treasuryYields.ts` (élargir `MATURITES_US`)
- Create: `apps/web/src/components/CourbeTaux.tsx` (composant canvas)
- Modify: `apps/web/src/components/MacroRatesWindow.tsx` (toggle Tableau/Courbe + commande CRVF)
- Test: `apps/web/src/data/macro/treasuryYields.test.ts` (si absent, ajouter un cas sur la maturité élargie)

**Interfaces:**
- Consumes: `RendementsSouverains`, `chargerRendementsSouverains` (inchangés, `treasuryYields.ts` parse déjà les 14 maturités — seul `MATURITES_US` filtrait l'affichage).
- Produces: `CourbeTaux({ us, euro }: { us: { maturite: string; anneesTri: number; taux: number }[]; euro: { maturite: string; anneesTri: number; taux: number }[] }): JSX.Element` (composant pur de rendu canvas, PAS unit-testé — pattern `Sparkline`).

- [ ] **Step 1: Élargir `MATURITES_US`**

Dans `apps/web/src/data/macro/treasuryYields.ts`, localiser `MATURITES_US` (actuellement 5 valeurs) et l'étendre aux 14 maturités déjà parsées par le fetch existant (ex. `1 Mo, 2 Mo, 3 Mo, 4 Mo, 6 Mo, 1 Yr, 2 Yr, 3 Yr, 5 Yr, 7 Yr, 10 Yr, 20 Yr, 30 Yr` — noms EXACTS à vérifier contre les clés déjà produites par le parseur du fichier, ne pas en inventer).

- [ ] **Step 2: Run les tests existants du module, vérifier qu'ils passent toujours**

Run: `pnpm --filter @axiom/web test -- treasuryYields.test.ts`
Expected: PASS (élargir `MATURITES_US` ne change pas le parsing, seulement ce qui est itéré à l'affichage)

- [ ] **Step 3: Implémenter `CourbeTaux.tsx`**

Composant canvas pattern `Sparkline` (`OnchainWindow.tsx`) mais avec 2 axes réels : X = maturité convertie en années (mapping `"1 Mo"→1/12`, `"2 Yr"→2`, etc. — fonction pure `anneesDeMaturite(m: string): number`, à exporter et EXPOSER À PART pour rester testable même si le composant lui-même ne l'est pas), Y = taux %. Deux courbes superposées (US = couleur accent, zone euro = couleur secondaire, légende simple). Réutilise les couleurs de thème via `readToken` comme le reste du projet (jamais de couleur en dur).

- [ ] **Step 4: Écrire le test de `anneesDeMaturite` (fonction pure extraite du composant)**

```ts
// apps/web/src/components/CourbeTaux.test.ts (ou co-localisé dans un module .ts séparé si le
// composant est un .tsx — extraire anneesDeMaturite dans un fichier .ts frère testable)
import { describe, expect, it } from "vitest";
import { anneesDeMaturite } from "./courbeTaux.util";

describe("anneesDeMaturite", () => {
  it("convertit les mois en fraction d'année", () => {
    expect(anneesDeMaturite("1 Mo")).toBeCloseTo(1 / 12);
    expect(anneesDeMaturite("6 Mo")).toBeCloseTo(0.5);
  });
  it("convertit les années directement", () => {
    expect(anneesDeMaturite("10 Yr")).toBe(10);
    expect(anneesDeMaturite("30 Yr")).toBe(30);
  });
  it("NaN sur forme inconnue", () => {
    expect(Number.isNaN(anneesDeMaturite("???"))).toBe(true);
  });
});
```

- [ ] **Step 5: Run, vérifier l'échec, puis implémenter `courbeTaux.util.ts` et re-run jusqu'au succès.**

- [ ] **Step 6: `MacroRatesWindow.tsx` — toggle + commande CRVF**

Dans `VueRendements`, ajouter un petit toggle "Tableau / Courbe" (state local `vue: "tableau" | "courbe"`) qui bascule entre le `<table>` existant et `<CourbeTaux us={...} euro={...} />`. Ajouter à `commandes` (déjà exporté par ce fichier) une 2ᵉ entrée :

```ts
{
  id: "panneau:macroRates:crvf",
  mnemonique: "CRVF",
  libelle: "Courbe des taux (CRVF)",
  categorie: "panneau",
  motsCles: ["crvf", "courbe", "yield curve", "taux", "shape of curve"],
  apercu: "Ouvre RATE directement en vue courbe",
  action: () => {
    macroRatesUiStore.getState().toggleMacroRates();
    // nécessite d'exposer un setter de vue par défaut — cf. Step 7
  },
},
```

- [ ] **Step 7: Exposer le contrôle de vue par défaut**

Ajouter un état partagé minimal (ex. variable de state levée dans un petit store vanilla `macroRatesViewStore: { vue: "tableau" | "courbe"; setVue: (v) => void }`, LU par `MacroRatesWindow` au montage pour initialiser son state local `vue`, ÉCRIT par la commande CRVF ci-dessus avant d'ouvrir la fenêtre). Documenter que ce store est éphémère (non persisté), comme `dragPreview` dans `windowManagerStore`.

- [ ] **Step 8: Vérification manuelle**

Run: `pnpm --filter @axiom/web dev` → ⌘K → "RATE" (vue tableau par défaut) puis "CRVF" (vue courbe directe) → vérifier le rendu des 14 maturités US + 3 zone euro sur la courbe, aux deux thèmes clair/sombre disponibles.

- [ ] **Step 9: Typecheck + suite complète**

Run: `pnpm -r typecheck && pnpm -r test`

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/data/macro/treasuryYields.ts apps/web/src/components/CourbeTaux.tsx \
        apps/web/src/components/courbeTaux.util.ts apps/web/src/components/courbeTaux.util.test.ts \
        apps/web/src/components/MacroRatesWindow.tsx apps/web/src/store/macroRatesView.ts
git commit -m "feat(rate): courbe de taux réelle (CRVF), 14 maturités US au lieu de 5"
```

---

## Task 5: NEWS enrichi (Finnhub général + GDELT ciblé + bandeau F&G)

**Files:**
- Modify: `apps/web/src/data/news.ts` (champ `kind`, branchement Finnhub/GDELT)
- Modify: `apps/web/src/components/NewsWindow.tsx` (bandeau Fear&Greed)
- Test: `apps/web/src/data/news.test.ts` (nouveaux cas de parsing Finnhub/GDELT)

**Interfaces:**
- Consumes: `getFinnhubKey` (de `store/finnhub`, créé Task 2) ; la valeur Fear&Greed déjà exposée par `data/marketOverview.ts` (ou son store associé — l'implémenteur lit le fichier pour identifier le nom EXACT de l'export/store existant avant de coder, ne PAS en inventer un).
- Produces: `NewsFeed` gagne `kind?: "xml" | "finnhub" | "gdelt"` (optionnel, défaut implicite `"xml"` pour les 5 flux existants — AUCUNE modification de leurs entrées) ; `parseFinnhubNews(json: unknown): NewsItem[]` ; `parseGdeltNews(json: unknown): NewsItem[]` ; `fetchToutesLesNews` gagne un paramètre optionnel `motsClesGdelt?: string[]` (déclenche la requête GDELT ciblée uniquement si non vide — appelé par `NewsWindow.tsx` avec les mots-clés du symbole UNIQUEMENT quand `filtreSymbole` est actif).

- [ ] **Step 1: Écrire les tests de parsing Finnhub/GDELT**

```ts
// apps/web/src/data/news.test.ts (ajouts au fichier existant)
import { parseFinnhubNews, parseGdeltNews } from "./news";

describe("parseFinnhubNews", () => {
  it("parse une liste d'articles Finnhub", () => {
    const json = [
      { id: 1, headline: "Fed holds rates", summary: "The Fed...", url: "https://x.test/1", datetime: 1751970000 },
    ];
    const items = parseFinnhubNews(json);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Fed holds rates", link: "https://x.test/1", source: "finnhub" });
    expect(items[0]!.time).toBe(1751970000 * 1000);
  });
  it("tableau vide sur forme inconnue", () => {
    expect(parseFinnhubNews(null)).toEqual([]);
    expect(parseFinnhubNews({})).toEqual([]);
  });
});

describe("parseGdeltNews", () => {
  it("parse la forme { articles: [...] }", () => {
    const json = { articles: [{ title: "Bitcoin rallies", url: "https://x.test/2", seendate: "20260707T120000Z" }] };
    const items = parseGdeltNews(json);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Bitcoin rallies", link: "https://x.test/2", source: "gdelt" });
  });
  it("tableau vide sur forme inconnue", () => {
    expect(parseGdeltNews(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, vérifier l'échec.**

- [ ] **Step 3: Étendre `NewsSourceId`, `NewsFeed`, ajouter les parseurs et le branchement**

Dans `apps/web/src/data/news.ts` :
1. `export type NewsSourceId = "coindesk" | "cointelegraph" | "theblock" | "decrypt" | "blockworks" | "finnhub" | "gdelt";`
2. `NewsFeed` gagne `kind?: "xml" | "finnhub" | "gdelt"` (les 5 entrées `NEWS_FEEDS` existantes restent inchangées, `kind` est optionnel donc absent = `"xml"` par défaut dans la logique, PAS besoin de les toucher).
3. Ajouter les 2 fonctions pures :

```ts
/** Parse la réponse Finnhub `/news` (tableau plat). PURE, défensive. */
export function parseFinnhubNews(json: unknown): NewsItem[] {
  if (!Array.isArray(json)) return [];
  const out: NewsItem[] = [];
  for (const brut of json) {
    const it = brut as { headline?: unknown; url?: unknown; datetime?: unknown; summary?: unknown; id?: unknown };
    if (typeof it.headline !== "string" || it.headline.length === 0) continue;
    const time = typeof it.datetime === "number" ? it.datetime * 1000 : 0;
    const link = typeof it.url === "string" ? it.url : "";
    out.push({
      id: link || `finnhub:${String(it.id)}`,
      title: it.headline,
      link,
      time,
      source: "finnhub",
      summary: typeof it.summary === "string" ? it.summary.slice(0, SUMMARY_MAX) : "",
    });
  }
  return out;
}

/** Parse la réponse GDELT DOC 2.0 (`{ articles: [...] }`). PURE, défensive. */
export function parseGdeltNews(json: unknown): NewsItem[] {
  const articles = (json as { articles?: unknown })?.articles;
  if (!Array.isArray(articles)) return [];
  const out: NewsItem[] = [];
  for (const brut of articles) {
    const it = brut as { title?: unknown; url?: unknown; seendate?: unknown };
    if (typeof it.title !== "string" || it.title.length === 0) continue;
    const link = typeof it.url === "string" ? it.url : "";
    const time = typeof it.seendate === "string" ? parseDate(it.seendate) : 0;
    out.push({ id: link || `gdelt:${it.title}:${time}`, title: it.title, link, time, source: "gdelt", summary: "" });
  }
  return out;
}
```

4. Dans `fetchFlux`, ramifier sur `feed.kind` : pour `"finnhub"`, construire l'URL `https://finnhub.io/api/v1/news?category=general&token=${getFinnhubKey()}` (import `getFinnhubKey` de `../store/finnhub`, appel DIRECT — pas `extUrl`) et parser avec `parseFinnhubNews` ; sinon (défaut `"xml"`) comportement INCHANGÉ.
5. Ajouter la ligne à `NEWS_FEEDS` : `{ id: "finnhub", label: "Finnhub", host: "", path: "", color: "#0ea5e9", kind: "finnhub" }` (host/path ignorés pour ce kind — laisser vide plutôt qu'inventer une valeur trompeuse).
6. Ajouter `fetchToutesLesNews(signal?, motsClesGdelt?: string[])` : si `motsClesGdelt` non vide, ajouter DYNAMIQUEMENT un appel GDELT (`extUrl("api.gdeltproject.org", "api/v2/doc/doc?query=" + encodeURIComponent(motsClesGdelt.join(" OR ")) + "&mode=artlist&format=json&maxrecords=20")`, parsé par `parseGdeltNews`) à la liste `Promise.allSettled` existante, en plus des flux statiques.

- [ ] **Step 4: Run, vérifier le succès.**

- [ ] **Step 5: `NewsWindow.tsx` — brancher GDELT sur le toggle symbole + bandeau F&G**

Modifier l'appel à `demarrerVeilleNews`/`fetchToutesLesNews` (selon lequel des deux le composant utilise réellement — vérifier avant d'éditer) pour passer `motsCles` UNIQUEMENT quand `filtreSymbole === true`. Ajouter dans l'en-tête un petit badge Fear&Greed (valeur + libellé "Extreme Fear"/"Neutral"/etc., réutilisant l'export existant de `marketOverview.ts` — lire ce fichier avant d'écrire le code pour prendre le nom EXACT du store/export, ne pas dupliquer le fetch).

- [ ] **Step 6: Vérification manuelle**

Run: `pnpm --filter @axiom/web dev` → ouvrir NEWS → vérifier la présence d'articles Finnhub dans le flux global (badge "Finnhub") → activer le filtre symbole sur BTC → vérifier une éventuelle apparition d'articles GDELT (badge "gdelt") sans casser les 5 flux RSS existants même si GDELT est indisponible.

- [ ] **Step 7: Typecheck + suite complète**

Run: `pnpm -r typecheck && pnpm -r test`

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/data/news.ts apps/web/src/data/news.test.ts apps/web/src/components/NewsWindow.tsx
git commit -m "feat(news): Finnhub général + GDELT ciblé par symbole + bandeau Fear&Greed"
```

---

## Task 6: On-chain ETH (Etherscan v2)

**Files:**
- Create: `apps/web/src/data/onchain/etherscan.ts`
- Create: `apps/web/src/store/etherscan.ts` (pattern BGeometrics)
- Test: `apps/web/src/data/onchain/etherscan.test.ts`
- Test: `apps/web/src/store/etherscan.test.ts`
- Modify: `apps/web/src/components/OnchainWindow.tsx` (section "Réseau ETH")
- Modify: `apps/web/src/components/SettingsPanel.tsx` (champ clé Etherscan)

**Interfaces:**
- Produces: `etherscanKeyStore: { hasKey; setKey; clearKey }`, `getEtherscanKey(): string | null` ; `interface ReseauEth { supplyEth: number | null; nodeCount: number | null; gasSafe: number | null; gasPropose: number | null; gasFast: number | null }` ; `fetchReseauEth(cle: string | null, signal?: AbortSignal): Promise<ReseauEth | null>`.

- [ ] **Step 1: Store clé — test** (copie exacte du Step 1 du Task 1, renommé `etherscan`/`ETHERSCAN`).

- [ ] **Step 2: Run, vérifier l'échec, implémenter `store/etherscan.ts`, re-run jusqu'au succès.**

- [ ] **Step 3: Écrire le test de parsing**

```ts
// apps/web/src/data/onchain/etherscan.test.ts
import { describe, expect, it } from "vitest";
import { parseEthSupply, parseGasOracle, parseNodeCount } from "./etherscan";

describe("parseEthSupply", () => {
  it("convertit les wei en ETH", () => {
    expect(parseEthSupply({ status: "1", result: "120000000000000000000000000" })).toBeCloseTo(120_000_000, 0);
  });
  it("null sur échec", () => {
    expect(parseEthSupply({ status: "0" })).toBeNull();
  });
});

describe("parseGasOracle", () => {
  it("parse les 3 niveaux de gas", () => {
    const json = { status: "1", result: { SafeGasPrice: "10", ProposeGasPrice: "12", FastGasPrice: "15" } };
    expect(parseGasOracle(json)).toEqual({ safe: 10, propose: 12, fast: 15 });
  });
  it("null sur échec", () => {
    expect(parseGasOracle({ status: "0" })).toBeNull();
  });
});

describe("parseNodeCount", () => {
  it("parse le nombre de nœuds", () => {
    expect(parseNodeCount({ status: "1", result: { TotalNodeCount: "8500" } })).toBe(8500);
  });
  it("null sur forme inconnue", () => {
    expect(parseNodeCount({})).toBeNull();
  });
});
```

- [ ] **Step 4: Run, vérifier l'échec.**

- [ ] **Step 5: Implémenter `data/onchain/etherscan.ts`**

```ts
/**
 * Etherscan v2 (API multichain) — réseau ETH : supply totale, nombre de nœuds, gas
 * recommandé. Appel DIRECT (CORS confirmé `*`, vérifié 2026-07-08). Clé requise.
 * ⚠️ Scope volontairement modeste : les métriques "adresses actives/jour" et "tx/jour"
 * historiques équivalentes à Coin Metrics BTC sont réservées au tier Pro d'Etherscan —
 * PAS disponibles gratuitement (cf. spec Lot E1 §5). Le gas recommandé est le pendant
 * direct du widget "Frais recommandés" déjà affiché côté BTC (mempool.space).
 */
import { ecrireCache, estFrais, lireCache } from "./cache";

const BASE = "https://api.etherscan.io/v2/api?chainid=1";
const TTL_MS = 10 * 60 * 1000; // gas change vite, mais pas de temps réel non plus

export function parseEthSupply(json: unknown): number | null {
  const obj = json as { status?: unknown; result?: unknown };
  if (obj.status !== "1" || typeof obj.result !== "string") return null;
  const wei = Number(obj.result);
  return Number.isFinite(wei) ? wei / 1e18 : null;
}

export function parseGasOracle(json: unknown): { safe: number; propose: number; fast: number } | null {
  const obj = json as { status?: unknown; result?: unknown };
  if (obj.status !== "1" || obj.result === null || typeof obj.result !== "object") return null;
  const r = obj.result as { SafeGasPrice?: unknown; ProposeGasPrice?: unknown; FastGasPrice?: unknown };
  const safe = Number(r.SafeGasPrice);
  const propose = Number(r.ProposeGasPrice);
  const fast = Number(r.FastGasPrice);
  if (![safe, propose, fast].every(Number.isFinite)) return null;
  return { safe, propose, fast };
}

export function parseNodeCount(json: unknown): number | null {
  const obj = json as { status?: unknown; result?: unknown };
  if (obj.status !== "1" || obj.result === null || typeof obj.result !== "object") return null;
  const n = Number((obj.result as { TotalNodeCount?: unknown }).TotalNodeCount);
  return Number.isFinite(n) ? n : null;
}

export interface ReseauEth {
  supplyEth: number | null;
  nodeCount: number | null;
  gasSafe: number | null;
  gasPropose: number | null;
  gasFast: number | null;
}

export async function fetchReseauEth(cle: string | null, signal?: AbortSignal): Promise<ReseauEth | null> {
  if (cle === null) return null;
  const cacheCle = "eth:reseau";
  const cache = await lireCache<ReseauEth>(cacheCle);
  if (estFrais(cache, TTL_MS) && cache !== null) return cache.donnee;

  try {
    const q = (params: string) => `${BASE}&${params}&apikey=${encodeURIComponent(cle)}`;
    const [supplyRes, gasRes, nodeRes] = await Promise.all([
      fetch(q("module=stats&action=ethsupply"), { signal }),
      fetch(q("module=gastracker&action=gasoracle"), { signal }),
      fetch(q("module=stats&action=nodecount"), { signal }),
    ]);
    const [supplyJson, gasJson, nodeJson] = await Promise.all([supplyRes.json(), gasRes.json(), nodeRes.json()]);
    const gas = parseGasOracle(gasJson);
    const resultat: ReseauEth = {
      supplyEth: parseEthSupply(supplyJson),
      nodeCount: parseNodeCount(nodeJson),
      gasSafe: gas?.safe ?? null,
      gasPropose: gas?.propose ?? null,
      gasFast: gas?.fast ?? null,
    };
    await ecrireCache(cacheCle, resultat);
    return resultat;
  } catch {
    return cache?.donnee ?? null;
  }
}
```

- [ ] **Step 6: Run, vérifier le succès.**

- [ ] **Step 7: `OnchainWindow.tsx` — section "Réseau ETH"**

Ajouter une 4ᵉ section (après ETF) : si `etherscanKeyStore.hasKey`, afficher 3 `Widget` (Gas recommandé façon "Frais recommandés" BTC, Supply ETH, Nombre de nœuds) alimentés par `fetchReseauEth` (ajouté au `Promise.all` du `charger` existant) ; sinon, lien "clé Etherscan ⚙" vers Réglages (même pattern BGeometrics/SoSoValue).

- [ ] **Step 8: `SettingsPanel.tsx` — champ Etherscan**

`name="Etherscan v2"`, `purpose="Réseau ETH — gas recommandé, supply, nombre de nœuds."`, `domain="api.etherscan.io"`, `signupUrl="https://etherscan.io/register"`, `signupLabel="Obtenir une clé gratuite"`.

- [ ] **Step 9: Vérification manuelle + typecheck + suite complète + commit**

```bash
pnpm --filter @axiom/web dev   # vérifier CHAIN → section ETH avec une vraie clé
pnpm -r typecheck && pnpm -r test
git add apps/web/src/data/onchain/etherscan.ts apps/web/src/data/onchain/etherscan.test.ts \
        apps/web/src/store/etherscan.ts apps/web/src/store/etherscan.test.ts \
        apps/web/src/components/OnchainWindow.tsx apps/web/src/components/SettingsPanel.tsx
git commit -m "feat(onchain): section ETH (gas, supply, nœuds) via Etherscan v2"
```

---

## Self-Review (effectuée à l'écriture de ce plan)

1. **Couverture spec** : §1 ETF → Task 1. §2 FUND → Tasks 2+3. §3 CRVF → Task 4. §4 NEWS → Task 5. §5 ETH → Task 6. §0 (proxy/UA) → Task 0. Unlocks/SOL onchain/clé FRED : explicitement hors scope, aucune tâche — cohérent avec la spec.
2. **Placeholders** : aucun "TODO"/"à implémenter plus tard" dans les steps de code ; la seule incertitude assumée et explicite est l'endpoint SoSoValue exact (Task 1, documentée comme découverte manuelle en préalable, pas un blocage silencieux).
3. **Cohérence de types** : `EtfResultat`/`FluxEmetteur` conservés à l'identique entre l'ancien et le nouveau `etf.ts` (Task 1) pour ne pas casser `OnchainWindow.tsx` au-delà du changement de signature documenté. `NewsItem`/`NewsSourceId` étendus de façon additive (Task 5) sans renommer les champs existants. Les 3 nouveaux key-stores (SoSoValue/Finnhub/Etherscan) partagent EXACTEMENT la même forme (`hasKey/setKey/clearKey` + `getXxxKey()`), vérifiable par comparaison directe des trois fichiers.
