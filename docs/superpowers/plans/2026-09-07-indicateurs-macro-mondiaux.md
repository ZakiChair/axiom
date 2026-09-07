# Indicateurs macroéconomiques mondiaux — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher l'inflation en glissement annuel des six zones (US, zone euro, Royaume-Uni, Japon, Chine, Inde) sous forme de courbes dans un 4ᵉ onglet de la fenêtre `RATE`, puis brancher le calendrier `ECO` et le `BRIEF` dessus.

**Architecture:** Un catalogue déclaratif décrit chaque série (région, transport, clé). Quatre transports purs et testés convertissent la réponse de leur source en `MacroSeries`. Un store vanilla orchestre le chargement séquentiel, le cache 24 h et la santé des sources. La surface réutilise `CourbeTaux` sans le modifier.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), React 18, Zustand vanilla, Vitest, Tailwind. Aucune dépendance nouvelle.

**Spec:** [`docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`](../specs/2026-09-06-indicateurs-macro-mondiaux-design.md)

## Global Constraints

Ces règles s'appliquent à **toutes** les tâches. Valeurs reprises telles quelles de la spec.

- **Français** pour tous les commentaires, noms de symboles métier et libellés d'interface.
- **TypeScript strict** avec `noUncheckedIndexedAccess` : tout accès indexé rend `T | undefined`. Jamais de `!` non justifié, jamais de `any`.
- **Ne pas modifier** : `shared/extapi-hosts.ts`, `apps/daemon/**`, `api/_policy.ts`, `packages/**`, `store/windowManager.ts`, `store/macro-overlays.ts`, `chart/macro.ts`. Un `git diff --stat` sur ces chemins doit rester **vide** à la fin du lot 1.
- **Appel direct** pour OCDE, Eurostat et ONS (CORS vérifié). Seul FRED passe par `/fredapi`.
- **Règle d'axe unique** : l'onglet n'affiche QUE des pourcentages. Aucune série n'entre en niveau ou en indice brut.
- **Une clé OCDE par pays**, entièrement spécifiée : jamais de `+` (multi-pays) ni de segment vide (joker). Les deux provoquent une troncature silencieuse en HTTP 200.
- **Dégradation gracieuse** : une source en panne laisse les autres courbes tracées. Aucune exception ne remonte à React.
- **Aucune absence muette** : une série manquante affiche son motif (« quota OCDE », « clé FRED absente », « source indisponible »), jamais un tiret seul.
- **Pas de `setInterval`, pas de polling.** Cache localStorage 24 h + rafraîchissement manuel.
- **Oracles de test en commentaire uniquement** — aucun test ne fait d'appel réseau.
- Commande de test : `pnpm --filter @axiom/web test`. Contrôle complet : `bash scripts/ci.sh`.

---

## Structure des fichiers

**Créés — couche données (`apps/web/src/data/macro/`)**

| Fichier | Responsabilité |
|---|---|
| `harmonisation.ts` | Fonctions pures de temps : conversion de période SDMX, fin de période, tri, filtrage. Aucune dépendance. |
| `catalogueMacro.ts` | Types du catalogue + `CATALOGUE_MACRO`. **Seul fichier à éditer quand une source amont bouge.** |
| `oecd.ts` | Parseur SDMX-JSON + chargeur OCDE. |
| `eurostat.ts` | Parseur JSON-stat + chargeur Eurostat. |
| `ons.ts` | Parseur ONS + chargeur ONS. |
| `chargerSerieMacro.ts` | Aiguillage transport → chargeur, et résultat typé (succès / quota / sans clé / panne). **Écart assumé vs la liste de fichiers de la spec §5** : la spec logeait cet aiguillage dans le store. L'en sortir rend la distinction quota / sans-clé / panne testable sans monter de store, et amincit `store/macroSeries.ts` d'autant — le total de lignes est inchangé. |
| `ecoVersSerie.ts` | *(lot 2)* Pont pur calendrier ECO → identifiant de série. |

**Créés — état (`apps/web/src/store/`)**

| Fichier | Responsabilité |
|---|---|
| `macroSeries.ts` | Store vanilla : état par série, cache 24 h, séquencement, `healthStore`. |

**Modifiés**

| Fichier | Modification |
|---|---|
| `data/macro/fred.ts` | Paramètre `units` optionnel (+4 l). |
| `data/macro/index.ts` | Ré-exports. |
| `components/courbeTaux.util.ts` | `pointsDeSerieTemporelle` (+ test). |
| `components/MacroRatesWindow.tsx` | 4ᵉ onglet « Indicateurs ». |
| `data/dataCockpit.ts` | 4 libellés de source. |
| `BUILD-CONTRACT.md` | Consignation des deux exceptions au gel G100. |
| `components/EcoWindow.tsx`, `data/brief.ts`, `components/BriefWindow.tsx` | *(lot 2)* Ponts. |

---

# LOT 1 — CPI a/a, six régions

## Task 1 : Consigner les exceptions au gel G100

Le contrat interdit toute surface et tout fournisseur nouveaux avant le verdict G100. Les deux exceptions ont été actées par l'utilisateur le 2026-09-06. Elles se consignent **avant** la première ligne de code, comme les quatre précédentes.

**Files:**
- Modify: `BUILD-CONTRACT.md:49` (ligne « Gate G100 ») et `BUILD-CONTRACT.md:58` (anti-objectifs)

**Interfaces:**
- Consumes: rien
- Produces: rien (documentation)

- [ ] **Step 1: Lire les deux lignes à modifier**

```bash
sed -n '49p;58p' BUILD-CONTRACT.md
```

- [ ] **Step 2: Étendre la ligne du gate G100**

Dans `BUILD-CONTRACT.md:49`, la liste des exceptions se termine par `et le 2026-09-04 (catalogue positionnement/orderflow et PLAY-POS, cf. Conventions)`. Ajouter juste après, avant `; le gel reste la règle` :

```
, et le 2026-09-06 (onglet « Indicateurs » de la fenêtre RATE + trois fournisseurs statistiques publics sans clé — OCDE, Eurostat, ONS — au titre du remplacement des miroirs FRED internationaux démantelés ; spec `docs/superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`)
```

- [ ] **Step 3: Étendre la ligne des anti-objectifs**

Dans `BUILD-CONTRACT.md:58`, la parenthèse se lit `(exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, cf. Décisions verrouillées)`. La remplacer par :

```
(exceptions ACTÉES : fournisseurs de capitalisation CMC/CCData, et fournisseurs statistiques publics OCDE/Eurostat/ONS le 2026-09-06 — cf. Décisions verrouillées)
```

- [ ] **Step 4: Vérifier qu'aucune autre ligne n'a bougé**

Run: `git diff --stat BUILD-CONTRACT.md`
Expected: `1 file changed, 2 insertions(+), 2 deletions(-)`

- [ ] **Step 5: Commit**

```bash
git add BUILD-CONTRACT.md
git commit -m "docs(contrat): acte les deux exceptions G100 du lot macro mondial

Onglet Indicateurs dans RATE (aucune fenêtre nouvelle, registre inchangé à 39)
et trois fournisseurs statistiques publics sans clé (OCDE, Eurostat, ONS) au
titre du remplacement de sources défaillantes : les miroirs FRED internationaux
sont démantelés (CPI zone euro arrêté en 2023, CPI japonais en 2021, M2 chinois
en 2019) avec des last_updated trompeurs.

Décidé par l'utilisateur le 2026-09-06."
```

---

## Task 2 : Harmonisation temporelle (pur)

Socle sans dépendance : conversion des périodes SDMX/Eurostat en horodatages, et datation de la fin de période — c'est elle qui permet de réutiliser la primitive `Fraicheur` existante au lieu d'écrire des seuils maison.

**Files:**
- Create: `apps/web/src/data/macro/harmonisation.ts`
- Test: `apps/web/src/data/macro/harmonisation.test.ts`

**Interfaces:**
- Consumes: `MacroPoint`, `MacroSeries` depuis `./types`
- Produces:
  - `type FrequenceMacro = "M" | "Q"`
  - `periodeVersMs(periode: string): number` — `"2026-05"` ou `"2026-Q2"` → ms UTC du **début** de période ; `NaN` si non reconnu
  - `finDePeriode(debutMs: number, frequence: FrequenceMacro): number` — ms UTC de la **fin** de période
  - `trierChrono(serie: MacroSeries): MacroSeries` — copie triée par `time` croissant
  - `filtrerFenetre(serie: MacroSeries, depuisMs: number): MacroSeries`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/harmonisation.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { filtrerFenetre, finDePeriode, periodeVersMs, trierChrono } from "./harmonisation";

describe("periodeVersMs", () => {
  it("convertit une période mensuelle SDMX en début de mois UTC", () => {
    expect(periodeVersMs("2026-05")).toBe(Date.UTC(2026, 4, 1));
    expect(periodeVersMs("2026-12")).toBe(Date.UTC(2026, 11, 1));
  });

  it("convertit une période trimestrielle en début de trimestre UTC", () => {
    expect(periodeVersMs("2026-Q1")).toBe(Date.UTC(2026, 0, 1));
    expect(periodeVersMs("2026-Q2")).toBe(Date.UTC(2026, 3, 1));
    expect(periodeVersMs("2026-Q4")).toBe(Date.UTC(2026, 9, 1));
  });

  it("renvoie NaN sur une forme inconnue plutôt que de deviner", () => {
    expect(periodeVersMs("2026")).toBeNaN();
    expect(periodeVersMs("2026-13")).toBeNaN();
    expect(periodeVersMs("2026-Q5")).toBeNaN();
    expect(periodeVersMs("")).toBeNaN();
  });
});

describe("finDePeriode", () => {
  // Le cas de la spec : un PIB du T2 2026 ne doit pas être jugé périmé le
  // 2026-09-06 sous prétexte que sa période COMMENCE le 1er avril.
  it("date un trimestre à son dernier instant", () => {
    const fin = finDePeriode(Date.UTC(2026, 3, 1), "Q");
    expect(new Date(fin).toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("date un mois à son dernier instant", () => {
    const fin = finDePeriode(Date.UTC(2026, 6, 1), "M");
    expect(new Date(fin).toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("gère le passage d'année et les mois courts", () => {
    expect(new Date(finDePeriode(Date.UTC(2026, 11, 1), "M")).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(new Date(finDePeriode(Date.UTC(2024, 1, 1), "M")).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(new Date(finDePeriode(Date.UTC(2026, 9, 1), "Q")).toISOString().slice(0, 10)).toBe("2026-12-31");
  });
});

describe("trierChrono", () => {
  // L'OCDE renvoie ses TIME_PERIOD DANS LE DÉSORDRE — vérifié en live le 2026-09-06 :
  // ['2026-05', '2026-07', '2026-06']. Sans ce tri, la courbe zigzague.
  it("trie par temps croissant sans muter l'entrée", () => {
    const entree = [
      { time: Date.UTC(2026, 4, 1), value: 1.2 },
      { time: Date.UTC(2026, 6, 1), value: 0.5 },
      { time: Date.UTC(2026, 5, 1), value: 1 },
    ];
    const copie = [...entree];
    const sortie = trierChrono(entree);
    expect(sortie.map((p) => p.value)).toEqual([1.2, 1, 0.5]);
    expect(entree).toEqual(copie);
  });
});

describe("filtrerFenetre", () => {
  it("garde les points au-delà de la borne incluse", () => {
    const serie = [
      { time: Date.UTC(2019, 0, 1), value: 1 },
      { time: Date.UTC(2020, 0, 1), value: 2 },
      { time: Date.UTC(2021, 0, 1), value: 3 },
    ];
    expect(filtrerFenetre(serie, Date.UTC(2020, 0, 1)).map((p) => p.value)).toEqual([2, 3]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- harmonisation`
Expected: FAIL — `Failed to resolve import "./harmonisation"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/harmonisation.ts` :

```ts
/**
 * Harmonisation temporelle des séries macro — fonctions PURES, sans dépendance.
 *
 * Les quatre sources du catalogue datent leurs observations au DÉBUT de période
 * (« 2026-04 » pour avril, « 2026-Q2 » pour le deuxième trimestre). Juger la fraîcheur
 * sur cette date ferait passer un PIB du T2 2026 pour vieux de cinq mois au 6 septembre,
 * alors qu'il couvre une période close depuis le 30 juin. `finDePeriode` corrige cela et
 * permet de réutiliser la primitive `Fraicheur` de ui.tsx au lieu de seuils maison.
 */
import type { MacroSeries } from "./types";

/** Fréquence de publication d'une série du catalogue. */
export type FrequenceMacro = "M" | "Q";

/**
 * Convertit une période SDMX / Eurostat en ms UTC du DÉBUT de période.
 * Formes reconnues : « YYYY-MM » (mensuel) et « YYYY-Qn » (trimestriel).
 * Toute autre forme renvoie NaN — on n'invente pas une date, l'appelant écarte le point.
 */
export function periodeVersMs(periode: string): number {
  const mensuel = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periode);
  if (mensuel) {
    return Date.UTC(Number(mensuel[1]), Number(mensuel[2]) - 1, 1);
  }
  const trimestriel = /^(\d{4})-Q([1-4])$/.exec(periode);
  if (trimestriel) {
    return Date.UTC(Number(trimestriel[1]), (Number(trimestriel[2]) - 1) * 3, 1);
  }
  return NaN;
}

/**
 * Dernier instant de la période qui COMMENCE à `debutMs`.
 * `Date.UTC(annee, mois, 0)` désigne le dernier jour du mois PRÉCÉDENT — d'où le
 * décalage de +1 mois (M) ou +3 mois (Q) : les mois courts et les bissextiles sont
 * gérés par le calendrier lui-même, sans table.
 */
export function finDePeriode(debutMs: number, frequence: FrequenceMacro): number {
  const d = new Date(debutMs);
  const moisSuivant = d.getUTCMonth() + (frequence === "Q" ? 3 : 1);
  return Date.UTC(d.getUTCFullYear(), moisSuivant, 0, 23, 59, 59, 999);
}

/** Copie triée par temps croissant. L'OCDE renvoie ses périodes dans le désordre. */
export function trierChrono(serie: MacroSeries): MacroSeries {
  return [...serie].sort((a, b) => a.time - b.time);
}

/** Points dont l'horodatage est supérieur ou égal à `depuisMs`. */
export function filtrerFenetre(serie: MacroSeries, depuisMs: number): MacroSeries {
  return serie.filter((p) => p.time >= depuisMs);
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- harmonisation`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/harmonisation.ts apps/web/src/data/macro/harmonisation.test.ts
git commit -m "feat(macro): harmonisation temporelle pure des séries

periodeVersMs (YYYY-MM et YYYY-Qn), finDePeriode (date une période à son
dernier instant, pour que Fraicheur ne juge pas un PIB trimestriel sur sa
date de DÉBUT), trierChrono et filtrerFenetre.

Le tri n'est pas une précaution théorique : l'OCDE renvoie ses TIME_PERIOD
dans le désordre — vérifié en live, ['2026-05', '2026-07', '2026-06']."
```

---

## Task 3 : Catalogue déclaratif

Le point d'entrée unique : tout identifiant de source amont vit ici, et nulle part ailleurs. Une rupture chez Eurostat ou l'OCDE se corrige dans ce seul fichier.

**Files:**
- Create: `apps/web/src/data/macro/catalogueMacro.ts`
- Test: `apps/web/src/data/macro/catalogueMacro.test.ts`

**Interfaces:**
- Consumes: `FrequenceMacro` depuis `./harmonisation`
- Produces:
  - `type RegionMacro = "US" | "EZ" | "UK" | "JP" | "CN" | "IN"`
  - `type IndicateurMacro = "cpi-aa"`
  - `type SourceMacro` — union discriminée sur `transport`
  - `interface DefinitionSerieMacro`
  - `CATALOGUE_MACRO: readonly DefinitionSerieMacro[]`
  - `INDICATEURS_MACRO: ReadonlyArray<{ id: IndicateurMacro; label: string; description: string }>`
  - `seriesDeIndicateur(indicateur: IndicateurMacro): readonly DefinitionSerieMacro[]`
  - `ORDRE_REGIONS: readonly RegionMacro[]`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/catalogueMacro.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { CATALOGUE_MACRO, INDICATEURS_MACRO, ORDRE_REGIONS, seriesDeIndicateur } from "./catalogueMacro";

describe("CATALOGUE_MACRO", () => {
  it("couvre les six régions pour le CPI en glissement annuel", () => {
    const regions = seriesDeIndicateur("cpi-aa").map((d) => d.region);
    expect([...regions].sort()).toEqual(["CN", "EZ", "IN", "JP", "UK", "US"]);
  });

  it("attribue un identifiant unique à chaque série", () => {
    const ids = CATALOGUE_MACRO.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("déclare un couleurTokenIndex distinct par région, dans 1..6", () => {
    const index = ORDRE_REGIONS.map((r, i) => i + 1);
    expect(index).toEqual([1, 2, 3, 4, 5, 6]);
    for (const def of CATALOGUE_MACRO) {
      expect(ORDRE_REGIONS).toContain(def.region);
    }
  });

  it("référence un indicateur déclaré pour chaque série", () => {
    const declares = new Set(INDICATEURS_MACRO.map((i) => i.id));
    for (const def of CATALOGUE_MACRO) {
      expect(declares.has(def.indicateur)).toBe(true);
    }
  });
});

// GARDE-FOU CENTRAL DU LOT. Une clé OCDE multi-pays (« CHN+IND ») ou jokerisée
// (« JPN.M...... ») renvoie HTTP 200 en TRONQUANT SILENCIEUSEMENT une des séries.
// Mesuré en live le 2026-09-06 : avec startPeriod=2026-05, la clé CHN+IND rend
// 3 points pour la Chine et UN SEUL pour l'Inde, là où les appels unitaires en
// rendent 3 chacun. Ce test interdit la régression au niveau du catalogue.
describe("clés OCDE — aucune troncature silencieuse possible", () => {
  const clesOecd = CATALOGUE_MACRO.filter((d) => d.source.transport === "oecd").map((d) =>
    d.source.transport === "oecd" ? d.source.cle : "",
  );

  it("n'utilise jamais de clé multi-pays", () => {
    for (const cle of clesOecd) {
      expect(cle).not.toContain("+");
    }
  });

  it("spécifie entièrement chaque dimension (aucun segment vide)", () => {
    for (const cle of clesOecd) {
      const segments = cle.split(".");
      expect(segments.length).toBe(8);
      for (const s of segments) {
        expect(s.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("filtres Eurostat", () => {
  // Le poste coicop18 compte 555 modalités : une requête sous-filtrée renvoie
  // des milliers de valeurs en HTTP 200. Toutes les dimensions non temporelles
  // doivent donc être fixées.
  it("fixe les quatre dimensions non temporelles", () => {
    for (const def of CATALOGUE_MACRO) {
      if (def.source.transport !== "eurostat") continue;
      expect(Object.keys(def.source.filtres).sort()).toEqual(["coicop18", "freq", "geo", "unit"]);
    }
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- catalogueMacro`
Expected: FAIL — `Failed to resolve import "./catalogueMacro"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/catalogueMacro.ts` :

```ts
/**
 * Catalogue déclaratif des séries macroéconomiques — SOURCE UNIQUE des identifiants amont.
 *
 * Eurostat a rebasé son HICP (ECOICOP v2 : la dimension est `coicop18`, le poste global
 * `TOTAL`), l'OCDE versionne ses dataflows et l'ONS a décommissionné son ancienne API en
 * 2024. Toute rupture amont se corrige DANS CE SEUL FICHIER, sans rouvrir un transport.
 *
 * Tous les identifiants ci-dessous ont été vérifiés en live le 2026-09-06 (HTTP 200 avec
 * observations). Les valeurs citées en commentaire servent d'oracles de relecture — elles
 * ne sont JAMAIS fetchées par un test.
 *
 * RÈGLE D'AXE UNIQUE : l'onglet n'affiche que des pourcentages. Chaque série entre donc en
 * taux ou en glissement annuel, servi NATIVEMENT par sa source — aucun calcul maison.
 */
import type { FrequenceMacro } from "./harmonisation";

/** Les six zones économiques suivies. L'ordre fixe l'affichage ET la couleur de série. */
export type RegionMacro = "US" | "EZ" | "UK" | "JP" | "CN" | "IN";

/** Ordre d'affichage : l'index + 1 donne le token de couleur `--serie-N` (1…6). */
export const ORDRE_REGIONS: readonly RegionMacro[] = ["US", "EZ", "UK", "JP", "CN", "IN"];

/** Indicateurs disponibles. Le lot 1 n'en livre qu'un : la seule ligne comparable 6/6. */
export type IndicateurMacro = "cpi-aa";

/** Paramètres de récupération, propres à chaque transport (union discriminée). */
export type SourceMacro =
  | { transport: "fred"; seriesId: string; units?: string }
  | { transport: "oecd"; dataflow: string; cle: string }
  | { transport: "eurostat"; dataset: string; filtres: Record<string, string> }
  | { transport: "ons"; chemin: string };

/** Une série du catalogue. */
export interface DefinitionSerieMacro {
  /** Identifiant stable, ex. « cpi-aa-us ». Sert de clé de cache et de cible aux ponts ECO. */
  id: string;
  region: RegionMacro;
  indicateur: IndicateurMacro;
  /** Libellé de légende, ex. « États-Unis ». */
  libelleRegion: string;
  frequence: FrequenceMacro;
  source: SourceMacro;
  /** Vrai si une clé API est nécessaire (FRED seul). Pilote l'état « sans clé ». */
  cleRequise: boolean;
  /**
   * Étiquette de périmètre à AFFICHER quand la définition dévie de celle des autres
   * régions (« core-core », « extra-EA »…). Absente quand le périmètre est standard.
   */
  perimetre?: string;
}

/** Indicateurs déclarés, dans l'ordre du sélecteur. */
export const INDICATEURS_MACRO: ReadonlyArray<{
  id: IndicateurMacro;
  label: string;
  description: string;
}> = [
  {
    id: "cpi-aa",
    label: "Inflation (a/a)",
    description: "Indice des prix à la consommation, glissement annuel en %.",
  },
];

/**
 * Le catalogue. Un appel OCDE PAR PAYS : une clé multi-pays (« CHN+IND ») tronque
 * silencieusement la seconde série en HTTP 200 — mesuré le 2026-09-06.
 */
export const CATALOGUE_MACRO: readonly DefinitionSerieMacro[] = [
  {
    id: "cpi-aa-us",
    region: "US",
    indicateur: "cpi-aa",
    libelleRegion: "États-Unis",
    frequence: "M",
    cleRequise: true,
    // FRED sert le glissement annuel via units=pc1. Oracle : 2026-07 ≈ 3,30 %.
    source: { transport: "fred", seriesId: "CPIAUCSL", units: "pc1" },
  },
  {
    id: "cpi-aa-ez",
    region: "EZ",
    indicateur: "cpi-aa",
    libelleRegion: "Zone euro",
    frequence: "M",
    cleRequise: false,
    // ECOICOP v2 : dimension `coicop18`, poste `TOTAL`. Oracle : 2026-08 = 3,2 %.
    // `prc_hicp_manr` est ARCHIVÉ (son label annonce « (1997-2025) »), ne pas l'employer.
    source: {
      transport: "eurostat",
      dataset: "prc_hicp_minr",
      filtres: { freq: "M", unit: "RCH_A", coicop18: "TOTAL", geo: "EA21" },
    },
  },
  {
    id: "cpi-aa-uk",
    region: "UK",
    indicateur: "cpi-aa",
    libelleRegion: "Royaume-Uni",
    frequence: "M",
    cleRequise: false,
    // Hôte www.ons.gov.uk — api.ons.gov.uk est DÉCOMMISSIONNÉE (retirée le 25/11/2024).
    // Oracle : 2026-07 = 2,9 %.
    source: {
      transport: "ons",
      chemin: "economy/inflationandpriceindices/timeseries/d7g7/mm23/data",
    },
  },
  {
    id: "cpi-aa-jp",
    region: "JP",
    indicateur: "cpi-aa",
    libelleRegion: "Japon",
    frequence: "M",
    cleRequise: false,
    // Le Japon vit dans un dataflow DISTINCT (COICOP2018). Oracle : 2026-07 = 1,9 %.
    source: {
      transport: "oecd",
      dataflow: "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0",
      cle: "JPN.M.N.CPI.PA._T.N.GY",
    },
  },
  {
    id: "cpi-aa-cn",
    region: "CN",
    indicateur: "cpi-aa",
    libelleRegion: "Chine",
    frequence: "M",
    cleRequise: false,
    // Oracle : 2026-07 = 0,5 %.
    source: {
      transport: "oecd",
      dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
      cle: "CHN.M.N.CPI.PA._T.N.GY",
    },
  },
  {
    id: "cpi-aa-in",
    region: "IN",
    indicateur: "cpi-aa",
    libelleRegion: "Inde",
    frequence: "M",
    cleRequise: false,
    // Oracle : 2026-07 ≈ 4,57 %.
    source: {
      transport: "oecd",
      dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
      cle: "IND.M.N.CPI.PA._T.N.GY",
    },
  },
];

/** Séries d'un indicateur, dans l'ordre d'affichage des régions. PURE. */
export function seriesDeIndicateur(indicateur: IndicateurMacro): readonly DefinitionSerieMacro[] {
  return ORDRE_REGIONS.flatMap((r) =>
    CATALOGUE_MACRO.filter((d) => d.indicateur === indicateur && d.region === r),
  );
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- catalogueMacro`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/catalogueMacro.ts apps/web/src/data/macro/catalogueMacro.test.ts
git commit -m "feat(macro): catalogue déclaratif des séries, six régions pour le CPI a/a

Source unique des identifiants amont : une rupture chez Eurostat ou l'OCDE se
corrige dans ce seul fichier. Tous les identifiants vérifiés en live le
2026-09-06, oracles en commentaire.

Deux gardes testées au niveau du catalogue :
- aucune clé OCDE multi-pays ni jokerisée (elles tronquent silencieusement en
  HTTP 200 : CHN+IND rend 1 point pour l'Inde là où l'appel unitaire en rend 3) ;
- toutes les dimensions Eurostat non temporelles fixées (coicop18 a 555
  modalités, une requête sous-filtrée rend des milliers de valeurs)."
```

---

## Task 4 : Paramètre `units` du fournisseur FRED

Quatre lignes qui suppriment tout calcul de glissement annuel maison au lot 1. Le test protège surtout la **non-régression** de M2 et NETLIQ, qui partagent ce fournisseur.

**Files:**
- Modify: `apps/web/src/data/macro/fred.ts` (fonction `createFredM2Provider`)
- Test: `apps/web/src/data/macro/fred.test.ts` (créer)

**Interfaces:**
- Consumes: `IMacroProvider`, `MacroFetchOptions` depuis `./types`
- Produces: `createFredM2Provider(seriesId?: string, units?: string): IMacroProvider` — signature **rétro-compatible**, le nom de la fonction ne change pas (`netliq.ts` en dépend)

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/fred.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFredM2Provider } from "./fred";

/** Capture l'URL appelée et renvoie une réponse FRED minimale valide. */
function stubFetch(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            observations: [
              { date: "2026-06-01", value: "2.9" },
              { date: "2026-07-01", value: "3.3" },
              { date: "2026-08-01", value: "." }, // valeur manquante FRED
            ],
          }),
      });
    }),
  );
  return { urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFredM2Provider", () => {
  it("transmet units quand il est fourni", async () => {
    const { urls } = stubFetch();
    await createFredM2Provider("CPIAUCSL", "pc1").fetchSeries();
    expect(urls[0]).toContain("series_id=CPIAUCSL");
    expect(urls[0]).toContain("units=pc1");
  });

  // NON-RÉGRESSION : M2 (MacroIndicators) et NETLIQ appellent ce fournisseur SANS units.
  // Leur URL doit rester bit-à-bit celle d'avant l'ajout du paramètre.
  it("n'ajoute aucun paramètre units quand il est omis", async () => {
    const { urls } = stubFetch();
    await createFredM2Provider("WM2NS").fetchSeries();
    expect(urls[0]).not.toContain("units");
    expect(urls[0]).toBe("/fredapi/fred/series/observations?series_id=WM2NS&file_type=json");
  });

  it("écarte les valeurs manquantes « . » et convertit les dates en ms UTC", async () => {
    stubFetch();
    const serie = await createFredM2Provider("CPIAUCSL", "pc1").fetchSeries();
    expect(serie).toEqual([
      { time: Date.UTC(2026, 5, 1), value: 2.9 },
      { time: Date.UTC(2026, 6, 1), value: 3.3 },
    ]);
  });

  it("porte un identifiant distinct par série", () => {
    expect(createFredM2Provider("CPIAUCSL", "pc1").id).toBe("fred-cpiaucsl");
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- macro/fred`
Expected: FAIL sur « transmet units » — l'URL ne contient pas `units=pc1`

- [ ] **Step 3: Écrire l'implémentation minimale**

Dans `apps/web/src/data/macro/fred.ts`, remplacer la signature et ajouter le paramètre. La ligne actuelle :

```ts
export function createFredM2Provider(seriesId = "WM2NS"): IMacroProvider {
```

devient :

```ts
export function createFredM2Provider(seriesId = "WM2NS", units?: string): IMacroProvider {
```

et, juste après le `params.set("file_type", "json")` du `URLSearchParams`, avant la ligne `if (key !== undefined)`, insérer :

```ts
      // Transformation servie par FRED (« pc1 » = variation sur un an). Purement additif :
      // les appelants historiques (M2, NETLIQ) ne passent pas `units`, leur URL est
      // inchangée. Le paramètre traverse les trois proxys — `appendApiKeyIfAbsent`
      // (daemon/proxy.ts) n'ajoute que `api_key`, `originalQuery` (api/_policy.ts) recopie
      // tout le reste.
      if (units !== undefined) params.set("units", units);
```

Compléter enfin le bloc de doc de la fonction :

```ts
/**
 * Construit un fournisseur pour une série FRED donnée.
 * @param seriesId identifiant FRED de la série (défaut "WM2NS", M2 US hebdo).
 * @param units transformation optionnelle servie par FRED (ex. "pc1" = glissement annuel).
 */
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- macro/fred`
Expected: PASS — 4 tests

- [ ] **Step 5: Vérifier la non-régression des appelants existants**

Run: `pnpm --filter @axiom/web test -- netliq`
Expected: PASS — les tests NETLIQ existants restent verts

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/data/macro/fred.ts apps/web/src/data/macro/fred.test.ts
git commit -m "feat(macro): paramètre units optionnel sur le fournisseur FRED

Permet de laisser FRED calculer le glissement annuel (units=pc1) au lieu de
l'écrire à la main. Purement additif : aucun appelant existant ne passe units,
l'URL de M2 et de NETLIQ reste identique — un test le verrouille.

Le paramètre traverse bien les trois couches de proxy : appendApiKeyIfAbsent
n'ajoute que api_key, originalQuery recopie tous les autres paramètres."
```

---

## Task 5 : Transport OCDE (SDMX-JSON)

Le transport le plus délicat des trois : structure indirecte (les observations sont indexées par position dans un tableau de périodes **non trié**), et une troncature silencieuse à neutraliser.

**Files:**
- Create: `apps/web/src/data/macro/oecd.ts`
- Test: `apps/web/src/data/macro/oecd.test.ts`

**Interfaces:**
- Consumes: `MacroSeries` (`./types`), `periodeVersMs`, `trierChrono` (`./harmonisation`)
- Produces:
  - `parseOecdSdmxJson(json: unknown, refAreaAttendu: string): MacroSeries` — lève `Error` si la zone attendue est absente
  - `chargerSerieOecd(dataflow: string, cle: string, depuisMs: number, signal?: AbortSignal): Promise<MacroSeries>`
  - `ErreurQuotaOecd` — classe d'erreur distinguant le 429 d'une panne

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/oecd.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseOecdSdmxJson } from "./oecd";

// EXTRAIT RÉEL de sdmx.oecd.org, capturé le 2026-09-06 sur
// DSD_PRICES@DF_PRICES_ALL,1.0 / CHN.M.N.CPI.PA._T.N.GY?startPeriod=2026-05.
// Deux traits du format réel à ne pas « corriger » :
//  1. TIME_PERIOD arrive DANS LE DÉSORDRE : ['2026-05', '2026-07', '2026-06'] ;
//  2. REF_AREA liste DEUX modalités (CHN et l'agrégat WXOECD) alors qu'une seule
//     série est demandée — la clé de série « 0:0:… » désigne la position 0.
const SDMX_CHN = {
  data: {
    dataSets: [
      {
        series: {
          "0:0:0:0:0:0:0:0": {
            observations: { "0": [1.2, 0], "1": [0.5, 0], "2": [1, 0] },
          },
        },
      },
    ],
    structures: [
      {
        dimensions: {
          series: [
            {
              id: "REF_AREA",
              keyPosition: 0,
              values: [
                { id: "CHN", name: "China (People's Republic of)" },
                { id: "WXOECD", name: "Non-OECD economies" },
              ],
            },
            { id: "FREQ", keyPosition: 1, values: [{ id: "M" }] },
            { id: "METHODOLOGY", keyPosition: 2, values: [{ id: "N" }] },
            { id: "MEASURE", keyPosition: 3, values: [{ id: "CPI" }] },
            { id: "UNIT_MEASURE", keyPosition: 4, values: [{ id: "PA" }] },
            { id: "EXPENDITURE", keyPosition: 5, values: [{ id: "_T" }] },
            { id: "ADJUSTMENT", keyPosition: 6, values: [{ id: "N" }] },
            { id: "TRANSFORMATION", keyPosition: 7, values: [{ id: "GY" }] },
          ],
          observation: [
            { id: "TIME_PERIOD", values: [{ id: "2026-05" }, { id: "2026-07" }, { id: "2026-06" }] },
          ],
        },
      },
    ],
  },
};

describe("parseOecdSdmxJson", () => {
  it("remet les observations dans l'ordre chronologique", () => {
    const serie = parseOecdSdmxJson(SDMX_CHN, "CHN");
    expect(serie).toEqual([
      { time: Date.UTC(2026, 4, 1), value: 1.2 },
      { time: Date.UTC(2026, 5, 1), value: 1 },
      { time: Date.UTC(2026, 6, 1), value: 0.5 },
    ]);
  });

  it("échoue si l'on retire le tri chronologique", () => {
    // Contrôle de sensibilité : la série NON triée ne doit pas être croissante en temps.
    // C'est ce qui rend le test précédent porteur plutôt que décoratif.
    const brut = SDMX_CHN.data.structures[0]!.dimensions.observation[0]!.values.map((v) => v.id);
    expect(brut).toEqual(["2026-05", "2026-07", "2026-06"]);
  });

  it("ne rend que la zone demandée quand la structure en déclare plusieurs", () => {
    const serie = parseOecdSdmxJson(SDMX_CHN, "CHN");
    expect(serie).toHaveLength(3);
  });

  it("lève une erreur explicite quand la zone attendue est absente", () => {
    expect(() => parseOecdSdmxJson(SDMX_CHN, "IND")).toThrow(/IND/);
  });

  it("écarte une observation dont la valeur n'est pas finie", () => {
    const avecTrou = structuredClone(SDMX_CHN);
    avecTrou.data.dataSets[0]!.series["0:0:0:0:0:0:0:0"]!.observations["1"] = [
      null as unknown as number,
      0,
    ];
    expect(parseOecdSdmxJson(avecTrou, "CHN")).toHaveLength(2);
  });

  it("rejette une réponse sans jeu de données", () => {
    expect(() => parseOecdSdmxJson({ data: { dataSets: [], structures: [] } }, "CHN")).toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- macro/oecd`
Expected: FAIL — `Failed to resolve import "./oecd"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/oecd.ts` :

```ts
/**
 * Transport OCDE — SDMX-JSON 2.0 (sdmx.oecd.org, public, sans clé).
 *
 * En-tête CORS : l'OCDE REFLÈTE l'origine appelante (vérifié le 2026-09-06 depuis
 * localhost:5173) → appel DIRECT, aucun ajout à shared/extapi-hosts.ts.
 *
 * Format, et ses deux pièges :
 *   1. Les observations sont indexées PAR POSITION dans `structures[0].dimensions
 *      .observation[0].values`, et ce tableau N'EST PAS TRIÉ — relevé en live :
 *      ['2026-05', '2026-07', '2026-06']. D'où `trierChrono` en sortie, obligatoire.
 *   2. `REF_AREA` peut déclarer PLUSIEURS modalités même pour une clé mono-pays
 *      (la Chine arrive avec l'agrégat WXOECD). On identifie donc la série par la
 *      position lue dans sa clé « i:j:k:… », et on VÉRIFIE qu'elle correspond à la
 *      zone demandée — un silence ici produirait la courbe d'un autre pays.
 *
 * ⚠️ La clé passée doit être ENTIÈREMENT spécifiée : une clé multi-pays (« CHN+IND »)
 * ou jokerisée tronque silencieusement une série en HTTP 200. Le catalogue le garantit
 * par test (catalogueMacro.test.ts) ; ce module n'accepte qu'une zone attendue à la fois.
 *
 * QUOTA : le 429 tombe entre 10 et 12 requêtes rapprochées et son `retry-after: 0` est
 * mensonger. Il remonte comme `ErreurQuotaOecd` pour que l'appelant l'affiche en
 * « quota », jamais en « source morte ».
 */
import type { MacroPoint, MacroSeries } from "./types";
import { periodeVersMs, trierChrono } from "./harmonisation";

const BASE_OCDE = "https://sdmx.oecd.org/public/rest/data";

/** Quota OCDE atteint (HTTP 429) — à distinguer d'une panne de source. */
export class ErreurQuotaOecd extends Error {
  constructor() {
    super("Quota OCDE atteint");
    this.name = "ErreurQuotaOecd";
  }
}

/** Accès défensif à un objet inconnu. */
function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/**
 * Convertit une réponse SDMX-JSON en série, en ne retenant QUE `refAreaAttendu`.
 * Lève si la structure est inexploitable ou si la zone demandée est absente. PURE.
 */
export function parseOecdSdmxJson(json: unknown, refAreaAttendu: string): MacroSeries {
  const data = champ(json, "data");
  const structures = champ(data, "structures");
  const structure = Array.isArray(structures) ? structures[0] : undefined;
  const dimensions = champ(structure, "dimensions");

  const observation = champ(dimensions, "observation");
  const dimTemps = Array.isArray(observation) ? observation[0] : undefined;
  const valeursTemps = champ(dimTemps, "values");
  if (!Array.isArray(valeursTemps) || valeursTemps.length === 0) {
    throw new Error("OCDE : dimension temporelle absente");
  }
  const periodes = valeursTemps.map((v) => String(champ(v, "id") ?? ""));

  const dimSeries = champ(dimensions, "series");
  if (!Array.isArray(dimSeries)) throw new Error("OCDE : dimensions de série absentes");
  const idxRefArea = dimSeries.findIndex((d) => champ(d, "id") === "REF_AREA");
  if (idxRefArea === -1) throw new Error("OCDE : dimension REF_AREA absente");
  const valeursRefArea = champ(dimSeries[idxRefArea], "values");
  const zones = Array.isArray(valeursRefArea)
    ? valeursRefArea.map((v) => String(champ(v, "id") ?? ""))
    : [];

  const dataSets = champ(data, "dataSets");
  const premierJeu = Array.isArray(dataSets) ? dataSets[0] : undefined;
  const series = champ(premierJeu, "series");
  if (typeof series !== "object" || series === null) {
    throw new Error("OCDE : aucun jeu de données");
  }

  for (const [cleSerie, contenu] of Object.entries(series as Record<string, unknown>)) {
    const positions = cleSerie.split(":");
    const position = Number(positions[idxRefArea]);
    if (!Number.isInteger(position)) continue;
    if (zones[position] !== refAreaAttendu) continue;

    const observations = champ(contenu, "observations");
    if (typeof observations !== "object" || observations === null) continue;

    const points: MacroPoint[] = [];
    for (const [indice, cellule] of Object.entries(observations as Record<string, unknown>)) {
      const periode = periodes[Number(indice)];
      if (periode === undefined) continue;
      const time = periodeVersMs(periode);
      if (!Number.isFinite(time)) continue;
      const value = Array.isArray(cellule) ? Number(cellule[0]) : NaN;
      if (!Number.isFinite(value)) continue;
      points.push({ time, value });
    }
    return trierChrono(points);
  }

  throw new Error(`OCDE : zone ${refAreaAttendu} absente de la réponse`);
}

/**
 * Récupère une série OCDE. `cle` doit viser UNE seule zone et fixer toutes les dimensions.
 * `refAreaAttendu` est le premier segment de la clé — vérifié à la lecture.
 */
export async function chargerSerieOecd(
  dataflow: string,
  cle: string,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<MacroSeries> {
  const refAreaAttendu = cle.split(".")[0] ?? "";
  const debut = new Date(depuisMs).toISOString().slice(0, 7); // « YYYY-MM »
  const url = `${BASE_OCDE}/${dataflow}/${cle}?startPeriod=${debut}&format=jsondata`;
  const res = await fetch(url, { signal });
  if (res.status === 429) throw new ErreurQuotaOecd();
  if (!res.ok) throw new Error(`OCDE ${res.status} ${res.statusText}`);
  return parseOecdSdmxJson(await res.json(), refAreaAttendu);
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- macro/oecd`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/oecd.ts apps/web/src/data/macro/oecd.test.ts
git commit -m "feat(macro): transport OCDE SDMX-JSON avec tri et garde de zone

Fixture = extrait RÉEL capturé le 2026-09-06, avec ses deux pièges intacts :
les TIME_PERIOD arrivent dans le désordre (2026-05, 2026-07, 2026-06) et
REF_AREA déclare deux modalités pour une clé mono-pays (CHN + l'agrégat
WXOECD). Le parseur identifie la série par la position lue dans sa clé et
vérifie qu'elle correspond à la zone demandée.

Le 429 remonte comme ErreurQuotaOecd, distinct d'une panne de source."
```

---

## Task 6 : Transport Eurostat (JSON-stat)

**Files:**
- Create: `apps/web/src/data/macro/eurostat.ts`
- Test: `apps/web/src/data/macro/eurostat.test.ts`

**Interfaces:**
- Consumes: `MacroSeries` (`./types`), `periodeVersMs`, `trierChrono` (`./harmonisation`)
- Produces:
  - `parseEurostatJsonStat(json: unknown): MacroSeries`
  - `chargerSerieEurostat(dataset: string, filtres: Record<string, string>, depuisMs: number, signal?: AbortSignal): Promise<MacroSeries>`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/eurostat.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseEurostatJsonStat } from "./eurostat";

// EXTRAIT RÉEL d'ec.europa.eu, capturé le 2026-09-06 sur
// prc_hicp_minr?freq=M&unit=RCH_A&coicop18=TOTAL&geo=EA21&sinceTimePeriod=2026-05.
// Format JSON-stat : `value` est indexé par POSITION, pas par période ; la
// correspondance passe par `dimension.time.category.index`.
const JSONSTAT_EA = {
  version: "2.0",
  class: "dataset",
  label: "Harmonised index of consumer prices (HICP) - ECOICOP ver.2",
  updated: "2026-09-01T23:00:00+0200",
  value: { "0": 3.2, "1": 2.8, "2": 3.0, "3": 3.2 },
  id: ["freq", "unit", "coicop18", "geo", "time"],
  size: [1, 1, 1, 1, 4],
  dimension: {
    freq: { category: { index: { M: 0 } } },
    unit: { category: { index: { RCH_A: 0 } } },
    coicop18: { category: { index: { TOTAL: 0 } } },
    geo: { category: { index: { EA21: 0 } } },
    time: { category: { index: { "2026-05": 0, "2026-06": 1, "2026-07": 2, "2026-08": 3 } } },
  },
};

describe("parseEurostatJsonStat", () => {
  it("apparie chaque valeur à sa période via l'index de dimension", () => {
    expect(parseEurostatJsonStat(JSONSTAT_EA)).toEqual([
      { time: Date.UTC(2026, 4, 1), value: 3.2 },
      { time: Date.UTC(2026, 5, 1), value: 2.8 },
      { time: Date.UTC(2026, 6, 1), value: 3.0 },
      { time: Date.UTC(2026, 7, 1), value: 3.2 },
    ]);
  });

  it("tolère les trous : une position sans valeur est simplement absente", () => {
    const troue = structuredClone(JSONSTAT_EA);
    delete (troue.value as Record<string, number>)["2"];
    expect(parseEurostatJsonStat(troue)).toHaveLength(3);
  });

  // Un HTTP 200 avec `value` vide est un ÉCHEC DE SOURCE, pas une série vide :
  // le distinguer évite d'afficher « aucune donnée » pour une panne amont.
  it("rejette une réponse dont value est vide", () => {
    const vide = { ...JSONSTAT_EA, value: {} };
    expect(() => parseEurostatJsonStat(vide)).toThrow(/vide/i);
  });

  // GARDE ANTI-PAYLOAD : le poste coicop18 compte 555 modalités. Une requête
  // sous-filtrée renvoie des milliers de valeurs en HTTP 200. On refuse de parser
  // plutôt que d'attribuer les valeurs à la mauvaise période.
  it("rejette une réponse insuffisamment filtrée", () => {
    const large = structuredClone(JSONSTAT_EA);
    large.size = [1, 1, 555, 1, 4];
    expect(() => parseEurostatJsonStat(large)).toThrow(/filtr/i);
  });

  it("rejette une réponse sans dimension temporelle", () => {
    const sansTemps = { ...JSONSTAT_EA, id: ["freq", "unit"], size: [1, 1] };
    expect(() => parseEurostatJsonStat(sansTemps)).toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- macro/eurostat`
Expected: FAIL — `Failed to resolve import "./eurostat"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/eurostat.ts` :

```ts
/**
 * Transport Eurostat — API de dissémination, format JSON-stat 2.0.
 *
 * En-tête CORS : `Access-Control-Allow-Origin: *` (vérifié le 2026-09-06) → appel DIRECT,
 * aucun ajout à shared/extapi-hosts.ts.
 *
 * Format : `value` est un dictionnaire indexé par POSITION dans l'hypercube, pas par
 * période. La correspondance passe par `dimension.time.category.index`. Comme toutes les
 * dimensions non temporelles sont fixées à une modalité par le catalogue, la position
 * d'une observation EST son index temporel — mais on le vérifie au lieu de le supposer.
 *
 * DEUX GARDES :
 *   1. `value` vide sur un HTTP 200 = échec de source, jamais « série vide ». Eurostat
 *      répond 200 avec un objet vide quand le jeu est archivé ou la clé sans donnée.
 *   2. Une réponse dont une dimension non temporelle a plus d'une modalité est REFUSÉE :
 *      cela signale une requête sous-filtrée (le poste `coicop18` compte 555 modalités,
 *      d'où des milliers de valeurs) et le calcul de position ne serait plus trivial.
 *
 * ⚠️ ECOICOP v2 : la dimension est `coicop18` et le poste global `TOTAL`. Le jeu
 * `prc_hicp_manr` est ARCHIVÉ — son propre label annonce « (1997-2025) ».
 */
import type { MacroPoint, MacroSeries } from "./types";
import { periodeVersMs, trierChrono } from "./harmonisation";

const BASE_EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/** Convertit une réponse JSON-stat en série. Lève sur échec de source. PURE. */
export function parseEurostatJsonStat(json: unknown): MacroSeries {
  const ids = champ(json, "id");
  const tailles = champ(json, "size");
  if (!Array.isArray(ids) || !Array.isArray(tailles) || ids.length !== tailles.length) {
    throw new Error("Eurostat : structure de dimensions inexploitable");
  }

  const positionTemps = ids.indexOf("time");
  if (positionTemps === -1) throw new Error("Eurostat : dimension temporelle absente");

  // Garde anti-payload : toute dimension non temporelle doit être réduite à une modalité.
  for (let i = 0; i < ids.length; i++) {
    if (i === positionTemps) continue;
    if (Number(tailles[i]) !== 1) {
      throw new Error(`Eurostat : réponse insuffisamment filtrée sur « ${String(ids[i])} »`);
    }
  }

  const dimension = champ(json, "dimension");
  const index = champ(champ(champ(dimension, "time"), "category"), "index");
  if (typeof index !== "object" || index === null) {
    throw new Error("Eurostat : index temporel absent");
  }

  const valeurs = champ(json, "value");
  if (typeof valeurs !== "object" || valeurs === null) {
    throw new Error("Eurostat : bloc de valeurs absent");
  }
  const table = valeurs as Record<string, unknown>;
  if (Object.keys(table).length === 0) {
    throw new Error("Eurostat : réponse vide (source indisponible ou jeu archivé)");
  }

  // Pas d'écart entre positions successives : toutes les autres dimensions valent 1, et
  // `time` est la dernière de `id`. La position d'une observation est donc son index.
  const points: MacroPoint[] = [];
  for (const [periode, pos] of Object.entries(index as Record<string, number>)) {
    const brut = table[String(pos)];
    const value = Number(brut);
    if (brut === undefined || brut === null || !Number.isFinite(value)) continue;
    const time = periodeVersMs(periode);
    if (!Number.isFinite(time)) continue;
    points.push({ time, value });
  }
  return trierChrono(points);
}

/** Récupère une série Eurostat. `filtres` doit fixer TOUTES les dimensions non temporelles. */
export async function chargerSerieEurostat(
  dataset: string,
  filtres: Record<string, string>,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<MacroSeries> {
  const params = new URLSearchParams(filtres);
  params.set("sinceTimePeriod", new Date(depuisMs).toISOString().slice(0, 7));
  params.set("format", "JSON");
  const res = await fetch(`${BASE_EUROSTAT}/${dataset}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Eurostat ${res.status} ${res.statusText}`);
  return parseEurostatJsonStat(await res.json());
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- macro/eurostat`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/eurostat.ts apps/web/src/data/macro/eurostat.test.ts
git commit -m "feat(macro): transport Eurostat JSON-stat avec deux gardes

Fixture = extrait réel du 2026-09-06 (prc_hicp_minr, ECOICOP v2 : dimension
coicop18, poste TOTAL, géo EA21).

Garde 1 — un HTTP 200 avec value vide est traité comme un échec de source,
pas comme une série vide : Eurostat répond ainsi quand un jeu est archivé.
Garde 2 — une réponse dont une dimension non temporelle a plus d'une modalité
est refusée : elle signale une requête sous-filtrée (coicop18 compte 555
modalités) et le calcul de position ne serait plus fiable."
```

---

## Task 7 : Transport ONS

**Files:**
- Create: `apps/web/src/data/macro/ons.ts`
- Test: `apps/web/src/data/macro/ons.test.ts`

**Interfaces:**
- Consumes: `MacroSeries` (`./types`), `trierChrono`, `filtrerFenetre` (`./harmonisation`)
- Produces:
  - `parseOnsTimeseries(json: unknown, depuisMs: number): MacroSeries`
  - `chargerSerieOns(chemin: string, depuisMs: number, signal?: AbortSignal): Promise<MacroSeries>`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/ons.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseOnsTimeseries } from "./ons";

// EXTRAIT RÉEL de www.ons.gov.uk, capturé le 2026-09-06 sur
// economy/inflationandpriceindices/timeseries/d7g7/mm23/data.
// Traits du format : `value` est une CHAÎNE, le mois est en anglais en toutes
// lettres, et le document porte aussi `quarters`/`years` qu'il faut IGNORER.
const ONS_D7G7 = {
  description: { title: "CPI ANNUAL RATE 00: ALL ITEMS 2015=100" },
  years: [{ date: "2025", value: "2.5", year: "2025", month: "", quarter: "" }],
  quarters: [{ date: "2026 Q2", value: "2.8", year: "2026", month: "", quarter: "Q2" }],
  months: [
    { date: "2019 DEC", value: "1.3", year: "2019", month: "December", quarter: "" },
    { date: "2026 MAY", value: "2.8", year: "2026", month: "May", quarter: "" },
    { date: "2026 JUN", value: "2.6", year: "2026", month: "June", quarter: "" },
    { date: "2026 JUL", value: "2.9", year: "2026", month: "July", quarter: "" },
  ],
};

const DEPUIS_2020 = Date.UTC(2020, 0, 1);

describe("parseOnsTimeseries", () => {
  it("lit les mois, convertit la valeur chaîne en nombre", () => {
    expect(parseOnsTimeseries(ONS_D7G7, DEPUIS_2020)).toEqual([
      { time: Date.UTC(2026, 4, 1), value: 2.8 },
      { time: Date.UTC(2026, 5, 1), value: 2.6 },
      { time: Date.UTC(2026, 6, 1), value: 2.9 },
    ]);
  });

  // L'ONS sert 451 mois (~119 Ko) SANS bornage amont possible : on tronque avant
  // toute mise en cache, sinon localStorage se remplit d'historique jamais affiché.
  it("tronque à la fenêtre demandée", () => {
    const tout = parseOnsTimeseries(ONS_D7G7, Date.UTC(2019, 0, 1));
    expect(tout).toHaveLength(4);
    expect(parseOnsTimeseries(ONS_D7G7, DEPUIS_2020)).toHaveLength(3);
  });

  it("ignore les blocs quarters et years", () => {
    const serie = parseOnsTimeseries(ONS_D7G7, Date.UTC(2019, 0, 1));
    expect(serie.some((p) => p.value === 2.5)).toBe(false); // years
    expect(serie.filter((p) => p.value === 2.8)).toHaveLength(1); // pas le doublon quarters
  });

  it("écarte les valeurs « NA » et les mois illisibles", () => {
    const sale = structuredClone(ONS_D7G7);
    sale.months.push({ date: "2026 AUG", value: "NA", year: "2026", month: "August", quarter: "" });
    sale.months.push({ date: "2026 ???", value: "3.1", year: "2026", month: "Brumaire", quarter: "" });
    expect(parseOnsTimeseries(sale, DEPUIS_2020)).toHaveLength(3);
  });

  it("rejette une réponse sans bloc months", () => {
    expect(() => parseOnsTimeseries({ description: {} }, DEPUIS_2020)).toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- macro/ons`
Expected: FAIL — `Failed to resolve import "./ons"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/ons.ts` :

```ts
/**
 * Transport ONS (Office for National Statistics, Royaume-Uni).
 *
 * ⚠️ HÔTE : `www.ons.gov.uk`. L'ancienne API `api.ons.gov.uk` est DÉCOMMISSIONNÉE
 * (retirée le 25/11/2024 — elle répond 404 avec un message d'adieu).
 *
 * En-tête CORS : `Access-Control-Allow-Origin: *` (vérifié le 2026-09-06) → appel DIRECT.
 *
 * Format : un document par série, contenant `years`, `quarters` ET `months`. On ne lit
 * que `months`. Les valeurs sont des CHAÎNES (« 2.9 », parfois « NA ») et le mois est en
 * anglais en toutes lettres dans le champ `month`.
 *
 * VOLUME : la série D7G7 sert 451 mois, ~119 Ko, et l'API n'accepte AUCUN bornage amont.
 * On tronque donc à la fenêtre demandée DÈS le parsing, avant toute mise en cache.
 */
import type { MacroPoint, MacroSeries } from "./types";
import { filtrerFenetre, trierChrono } from "./harmonisation";

const BASE_ONS = "https://www.ons.gov.uk";

/** Mois anglais → index 0-11. Le champ `month` de l'ONS est en toutes lettres. */
const MOIS_ANGLAIS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/** Convertit un document ONS en série, tronquée à `depuisMs`. PURE. */
export function parseOnsTimeseries(json: unknown, depuisMs: number): MacroSeries {
  const mois = champ(json, "months");
  if (!Array.isArray(mois)) throw new Error("ONS : bloc « months » absent");

  const points: MacroPoint[] = [];
  for (const entree of mois) {
    const annee = Number(champ(entree, "year"));
    const nomMois = String(champ(entree, "month") ?? "").trim().toLowerCase();
    const indexMois = MOIS_ANGLAIS[nomMois];
    if (!Number.isInteger(annee) || indexMois === undefined) continue;

    // « NA » et toute chaîne non numérique deviennent NaN → point écarté.
    const value = Number(champ(entree, "value"));
    if (!Number.isFinite(value)) continue;

    points.push({ time: Date.UTC(annee, indexMois, 1), value });
  }
  return filtrerFenetre(trierChrono(points), depuisMs);
}

/** Récupère une série ONS. `chemin` est le chemin du document, sans barre initiale. */
export async function chargerSerieOns(
  chemin: string,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<MacroSeries> {
  const res = await fetch(`${BASE_ONS}/${chemin}`, { signal });
  if (!res.ok) throw new Error(`ONS ${res.status} ${res.statusText}`);
  return parseOnsTimeseries(await res.json(), depuisMs);
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- macro/ons`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/ons.ts apps/web/src/data/macro/ons.test.ts
git commit -m "feat(macro): transport ONS (www.ons.gov.uk)

Fixture = extrait réel du 2026-09-06. Le document ONS porte years, quarters ET
months : seul months est lu. Les valeurs sont des chaînes (« NA » comprise) et
le mois est en anglais en toutes lettres.

Troncature à la fenêtre DÈS le parsing : l'API n'accepte aucun bornage amont et
sert 451 mois (~119 Ko) par série.

Note d'hôte : api.ons.gov.uk est décommissionnée depuis le 25/11/2024."
```

---

## Task 8 : Aiguillage des transports

Une frontière étroite entre le catalogue et le store : le store ne connaît ni URL ni format, seulement un résultat typé.

**Files:**
- Create: `apps/web/src/data/macro/chargerSerieMacro.ts`
- Test: `apps/web/src/data/macro/chargerSerieMacro.test.ts`

**Interfaces:**
- Consumes: `DefinitionSerieMacro` (`./catalogueMacro`), `ErreurQuotaOecd` + `chargerSerieOecd` (`./oecd`), `chargerSerieEurostat` (`./eurostat`), `chargerSerieOns` (`./ons`), `createFredM2Provider` (`./fred`)
- Produces:
  - `type ResultatSerieMacro = { statut: "ok"; points: MacroSeries } | { statut: "quota" | "sansCle" | "panne"; message: string }`
  - `chargerSerieMacro(def: DefinitionSerieMacro, depuisMs: number, signal?: AbortSignal): Promise<ResultatSerieMacro>`
  - `cleSante(def: DefinitionSerieMacro): string` — « macro:fred » | « macro:oecd » | « macro:eurostat » | « macro:ons »

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/chargerSerieMacro.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DefinitionSerieMacro } from "./catalogueMacro";
import { chargerSerieMacro, cleSante } from "./chargerSerieMacro";

const DEF_OCDE: DefinitionSerieMacro = {
  id: "cpi-aa-cn",
  region: "CN",
  indicateur: "cpi-aa",
  libelleRegion: "Chine",
  frequence: "M",
  cleRequise: false,
  source: {
    transport: "oecd",
    dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
    cle: "CHN.M.N.CPI.PA._T.N.GY",
  },
};

const DEF_FRED: DefinitionSerieMacro = {
  id: "cpi-aa-us",
  region: "US",
  indicateur: "cpi-aa",
  libelleRegion: "États-Unis",
  frequence: "M",
  cleRequise: true,
  source: { transport: "fred", seriesId: "CPIAUCSL", units: "pc1" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cleSante", () => {
  it("nomme UNE clé par hôte, jamais par série", () => {
    expect(cleSante(DEF_OCDE)).toBe("macro:oecd");
    expect(cleSante(DEF_FRED)).toBe("macro:fred");
  });
});

describe("chargerSerieMacro", () => {
  it("rend un statut « quota » distinct sur un 429 OCDE", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 429, statusText: "" })));
    const r = await chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("quota");
    // Le message ne doit JAMAIS laisser croire à une source morte.
    if (r.statut !== "ok") expect(r.message).toMatch(/quota/i);
  });

  it("rend un statut « panne » sur une erreur ordinaire", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 503, statusText: "Service Unavailable" })),
    );
    const r = await chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("panne");
  });

  it("rend un statut « sansCle » sur un 401 FRED plutôt qu'une panne", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" })),
    );
    const r = await chargerSerieMacro(DEF_FRED, Date.UTC(2020, 0, 1));
    expect(r.statut).toBe("sansCle");
  });

  it("ne laisse échapper aucune exception", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("réseau coupé"))));
    await expect(chargerSerieMacro(DEF_OCDE, Date.UTC(2020, 0, 1))).resolves.toMatchObject({
      statut: "panne",
    });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- chargerSerieMacro`
Expected: FAIL — `Failed to resolve import "./chargerSerieMacro"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/chargerSerieMacro.ts` :

```ts
/**
 * Aiguillage transport → chargeur, et normalisation du résultat.
 *
 * Le store n'a besoin de connaître ni les URL, ni les formats, ni les codes HTTP : il
 * reçoit un résultat typé. La distinction « quota » / « sans clé » / « panne » est faite
 * ICI, parce que c'est elle qui décide du message affiché — et la règle produit est
 * qu'une absence n'est jamais muette, ni maquillée en panne.
 */
import type { MacroSeries } from "./types";
import type { DefinitionSerieMacro } from "./catalogueMacro";
import { chargerSerieEurostat } from "./eurostat";
import { chargerSerieOecd, ErreurQuotaOecd } from "./oecd";
import { chargerSerieOns } from "./ons";
import { createFredM2Provider } from "./fred";

/** Issue d'un chargement de série. Aucune exception ne franchit cette frontière. */
export type ResultatSerieMacro =
  | { statut: "ok"; points: MacroSeries }
  | { statut: "quota" | "sansCle" | "panne"; message: string };

/**
 * Clé de santé d'une définition : UNE par hôte, jamais par série — le panneau DATA
 * nomme des fournisseurs, pas des observations.
 */
export function cleSante(def: DefinitionSerieMacro): string {
  return `macro:${def.source.transport}`;
}

/** Charge une série et normalise toute défaillance en statut lisible. */
export async function chargerSerieMacro(
  def: DefinitionSerieMacro,
  depuisMs: number,
  signal?: AbortSignal,
): Promise<ResultatSerieMacro> {
  try {
    const source = def.source;
    let points: MacroSeries;
    switch (source.transport) {
      case "fred": {
        points = await createFredM2Provider(source.seriesId, source.units).fetchSeries({
          start: depuisMs,
          signal,
        });
        break;
      }
      case "oecd":
        points = await chargerSerieOecd(source.dataflow, source.cle, depuisMs, signal);
        break;
      case "eurostat":
        points = await chargerSerieEurostat(source.dataset, source.filtres, depuisMs, signal);
        break;
      case "ons":
        points = await chargerSerieOns(source.chemin, depuisMs, signal);
        break;
    }
    if (points.length === 0) {
      return { statut: "panne", message: "Source sans donnée sur la période." };
    }
    return { statut: "ok", points };
  } catch (e) {
    if (e instanceof ErreurQuotaOecd) {
      return { statut: "quota", message: "Quota OCDE — nouvelle tentative différée." };
    }
    const texte = e instanceof Error ? e.message : String(e);
    // FRED sans clé répond 401 : ce n'est pas une panne, c'est une configuration absente.
    if (def.cleRequise && /\b401\b/.test(texte)) {
      return { statut: "sansCle", message: "Clé FRED absente." };
    }
    return { statut: "panne", message: "Source indisponible." };
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- chargerSerieMacro`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/chargerSerieMacro.ts apps/web/src/data/macro/chargerSerieMacro.test.ts
git commit -m "feat(macro): aiguillage des transports et résultat typé

Le store reçoit un ResultatSerieMacro, jamais une exception ni un code HTTP.
Trois défaillances distinctes plutôt qu'une panne fourre-tout : quota OCDE
(429), clé FRED absente (401 sur une série à clé requise), panne réelle.

cleSante nomme une clé de santé PAR HÔTE — le panneau DATA liste des
fournisseurs, pas des observations."
```

---

## Task 9 : Store des séries macro

**Files:**
- Create: `apps/web/src/store/macroSeries.ts`
- Test: `apps/web/src/store/macroSeries.test.ts`

**Interfaces:**
- Consumes: `CATALOGUE_MACRO`, `IndicateurMacro`, `seriesDeIndicateur` (`../data/macro/catalogueMacro`), `chargerSerieMacro`, `cleSante`, `ResultatSerieMacro` (`../data/macro/chargerSerieMacro`), `healthStore` (`./health`)
- Produces:
  - `type StatutSerie = "idle" | "loading" | "ok" | "quota" | "sansCle" | "panne"`
  - `interface EtatSerie { statut: StatutSerie; points: MacroSeries; majTs: number | null; message: string | null }`
  - `macroSeriesStore` — store vanilla
  - `FENETRE_MACRO_MS`, `TTL_CACHE_MS`, `ESPACEMENT_OCDE_MS` — constantes exportées pour les tests
  - `macroSeriesStore.getState().demanderIndicateur(indicateur, opts?)` où `opts?: { force?: boolean; attendre?: (ms: number) => Promise<void> }`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/store/macroSeries.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { macroSeriesStore } from "./macroSeries";
import { healthStore } from "./health";

// ⚠️ apps/web tourne sous Vitest en environnement NODE, sans jsdom (convention affirmée
// dans tout le dépôt). `localStorage` n'existe donc pas : on installe le faux Storage
// maison, copié de data/cmcMcap.test.ts:32 — même forme, mêmes bornes de vie.
function installMockLocalStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Réponse OCDE minimale valide pour une zone donnée. */
function reponseOecd(refArea: string, valeur: number): unknown {
  return {
    data: {
      dataSets: [{ series: { "0:0:0:0:0:0:0:0": { observations: { "0": [valeur, 0] } } } }],
      structures: [
        {
          dimensions: {
            series: [{ id: "REF_AREA", keyPosition: 0, values: [{ id: refArea }] }],
            observation: [{ id: "TIME_PERIOD", values: [{ id: "2026-07" }] }],
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  installMockLocalStorage();
  macroSeriesStore.setState({ series: {} });
  healthStore.setState({ sources: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/**
 * Aiguillage de stub par HÔTE, partagé par les tests qui ont besoin des six séries.
 * Servir la même charge utile à toutes les URL ferait échouer les parseurs non-OCDE
 * (« bloc months absent »), leurs séries passeraient en `panne`, ne seraient donc PAS
 * mises en cache — et un test de cache compterait alors des refetch parasites.
 */
function stubParHote(): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url.includes("stlouisfed") || url.includes("/fredapi")) {
      return Promise.resolve({ ok: false, status: 401, statusText: "Unauthorized" });
    }
    if (url.includes("sdmx.oecd.org")) {
      const zone = url.includes("JPN") ? "JPN" : url.includes("CHN") ? "CHN" : "IND";
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reponseOecd(zone, 1)) });
    }
    if (url.includes("ec.europa.eu")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: ["freq", "unit", "coicop18", "geo", "time"],
            size: [1, 1, 1, 1, 1],
            dimension: { time: { category: { index: { "2026-08": 0 } } } },
            value: { "0": 3.2 },
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ months: [{ year: "2026", month: "July", value: "2.9" }] }),
    });
  });
}

describe("macroSeriesStore.demanderIndicateur", () => {
  it("charge les six régions et laisse les autres tracées quand une source tombe", async () => {
    vi.stubGlobal("fetch", stubParHote());

    // `attendre` neutralisé : le séquencement est vérifié par son propre test.
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });

    const s = macroSeriesStore.getState().series;
    expect(s["cpi-aa-us"]?.statut).toBe("sansCle");
    expect(s["cpi-aa-ez"]?.statut).toBe("ok");
    expect(s["cpi-aa-uk"]?.statut).toBe("ok");
    expect(s["cpi-aa-jp"]?.statut).toBe("ok");
    expect(s["cpi-aa-cn"]?.statut).toBe("ok");
    expect(s["cpi-aa-in"]?.statut).toBe("ok");
    // Cinq courbes sur six restent traçables malgré l'absence de clé FRED.
    expect(Object.values(s).filter((e) => e.points.length > 0)).toHaveLength(5);
  });

  it("espace les appels OCDE et ne les lance jamais en parallèle", async () => {
    const attentes: number[] = [];
    let enVol = 0;
    let maxEnVol = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (!url.includes("sdmx.oecd.org")) {
          return Promise.resolve({ ok: false, status: 503, statusText: "" });
        }
        enVol++;
        maxEnVol = Math.max(maxEnVol, enVol);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => {
            enVol--;
            const zone = url.includes("JPN") ? "JPN" : url.includes("CHN") ? "CHN" : "IND";
            return Promise.resolve(reponseOecd(zone, 1));
          },
        });
      }),
    );

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", {
      attendre: (ms) => {
        attentes.push(ms);
        return Promise.resolve();
      },
    });

    expect(maxEnVol).toBe(1);
    // Trois séries OCDE → deux attentes intercalées, d'au moins 2 s chacune.
    expect(attentes.filter((ms) => ms >= 2000)).toHaveLength(2);
  });

  it("sert le cache sans refetch dans les 24 h, et refetch si force", async () => {
    const appels = stubParHote();
    vi.stubGlobal("fetch", appels);
    const opts = { attendre: () => Promise.resolve() };
    // On ne compte QUE les séries réellement mises en cache. La série US est en 401
    // (« sansCle ») : elle n'est pas cachée, donc elle sera légitimement redemandée —
    // la compter fausserait le test.
    const appelsOecd = (): number =>
      appels.mock.calls.filter((c) => String(c[0]).includes("sdmx.oecd.org")).length;

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    const n1 = appelsOecd();
    expect(n1).toBe(3); // Japon, Chine, Inde

    macroSeriesStore.setState({ series: {} }); // état perdu, cache conservé
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", opts);
    expect(appelsOecd()).toBe(n1); // servi par le cache : aucun appel OCDE de plus

    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { ...opts, force: true });
    expect(appelsOecd()).toBe(n1 + 3); // force ignore le cache
  });

  it("enregistre une clé de santé par hôte, pas par série", async () => {
    vi.stubGlobal("fetch", stubParHote());
    await macroSeriesStore.getState().demanderIndicateur("cpi-aa", { attendre: () => Promise.resolve() });
    const cles = Object.keys(healthStore.getState().sources).filter((k) => k.startsWith("macro:"));
    // Quatre hôtes, six séries : la clé nomme le fournisseur, jamais l'observation.
    expect(cles.sort()).toEqual(["macro:eurostat", "macro:fred", "macro:oecd", "macro:ons"]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- macroSeries`
Expected: FAIL — `Failed to resolve import "./macroSeries"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/store/macroSeries.ts` :

```ts
/**
 * Store des séries macroéconomiques — Zustand VANILLA (hors render-loop React).
 *
 * C'est la donnée la PLUS LENTE du terminal : publications mensuelles ou trimestrielles,
 * dont le calendrier ECO annonce déjà la date. D'où, volontairement : aucun `setInterval`,
 * aucun polling, un cache localStorage de 24 h, et un rafraîchissement manuel.
 *
 * SÉQUENCEMENT : l'OCDE renvoie un 429 entre 10 et 12 requêtes rapprochées, et son
 * `retry-after: 0` est mensonger. Les appels OCDE sont donc lancés UN PAR UN, espacés
 * d'au moins 2 s. `attendre` est injectable pour que les tests n'attendent pas vraiment.
 *
 * DÉGRADATION : chaque série a son propre statut. Une source en panne n'empêche jamais
 * les autres courbes d'être tracées, et son motif reste affiché (jamais un tiret muet).
 */
import { createStore } from "zustand/vanilla";
import type { MacroSeries } from "../data/macro/types";
import {
  type DefinitionSerieMacro,
  type IndicateurMacro,
  seriesDeIndicateur,
} from "../data/macro/catalogueMacro";
import { chargerSerieMacro, cleSante } from "../data/macro/chargerSerieMacro";
import { healthStore } from "./health";

/** Profondeur d'historique récupérée — au-delà, la courbe devient illisible. */
export const FENETRE_MACRO_MS = 6 * 365 * 24 * 60 * 60 * 1000; // ~6 ans
/** Durée de validité du cache local. */
export const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
/** Espacement minimal entre deux appels OCDE (quota ~10-12 requêtes rapprochées). */
export const ESPACEMENT_OCDE_MS = 2_000;

const PREFIXE_CACHE = "axiom.macro.serie.";

export type StatutSerie = "idle" | "loading" | "ok" | "quota" | "sansCle" | "panne";

export interface EtatSerie {
  statut: StatutSerie;
  points: MacroSeries;
  /** ms epoch du dernier point (fin de période) — alimente la primitive `Fraicheur`. */
  majTs: number | null;
  /** Motif d'indisponibilité, affiché tel quel. `null` quand tout va bien. */
  message: string | null;
}

interface EntreeCache {
  ts: number;
  points: MacroSeries;
}

export interface OptionsDemande {
  /** Ignore le cache. */
  force?: boolean;
  /** Attente injectable (tests). Défaut : `setTimeout`. */
  attendre?: (ms: number) => Promise<void>;
}

export interface MacroSeriesState {
  series: Record<string, EtatSerie>;
  demanderIndicateur: (indicateur: IndicateurMacro, opts?: OptionsDemande) => Promise<void>;
}

function etatVide(): EtatSerie {
  return { statut: "idle", points: [], majTs: null, message: null };
}

/** Lit le cache d'une série ; `null` si absent, illisible ou expiré. */
function lireCache(id: string, now: number): MacroSeries | null {
  try {
    const brut = localStorage.getItem(PREFIXE_CACHE + id);
    if (brut === null) return null;
    const entree = JSON.parse(brut) as EntreeCache;
    if (typeof entree.ts !== "number" || !Array.isArray(entree.points)) return null;
    if (now - entree.ts > TTL_CACHE_MS) return null;
    return entree.points;
  } catch {
    return null; // quota localStorage, JSON corrompu, mode privé…
  }
}

function ecrireCache(id: string, points: MacroSeries, now: number): void {
  try {
    localStorage.setItem(PREFIXE_CACHE + id, JSON.stringify({ ts: now, points } satisfies EntreeCache));
  } catch {
    // Quota atteint : le cache est un confort, jamais une condition de fonctionnement.
  }
}

const attendreParDefaut = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const macroSeriesStore = createStore<MacroSeriesState>((set, get) => ({
  series: {},

  demanderIndicateur: async (indicateur, opts) => {
    const attendre = opts?.attendre ?? attendreParDefaut;
    const force = opts?.force ?? false;
    const now = Date.now();
    const depuis = now - FENETRE_MACRO_MS;
    const definitions = seriesDeIndicateur(indicateur);

    const majSerie = (id: string, patch: Partial<EtatSerie>): void => {
      set((s) => ({
        series: { ...s.series, [id]: { ...(s.series[id] ?? etatVide()), ...patch } },
      }));
    };

    // 1) Cache d'abord : ce qui est frais n'est pas redemandé.
    const aCharger: DefinitionSerieMacro[] = [];
    for (const def of definitions) {
      const cache = force ? null : lireCache(def.id, now);
      if (cache !== null && cache.length > 0) {
        const dernier = cache[cache.length - 1];
        majSerie(def.id, {
          statut: "ok",
          points: cache,
          majTs: dernier?.time ?? null,
          message: null,
        });
      } else {
        majSerie(def.id, { statut: "loading", message: null });
        aCharger.push(def);
      }
    }

    // 2) Les transports sans quota d'abord, en parallèle ; l'OCDE ensuite, un par un.
    const rapides = aCharger.filter((d) => d.source.transport !== "oecd");
    const lents = aCharger.filter((d) => d.source.transport === "oecd");

    const appliquer = (def: DefinitionSerieMacro, r: Awaited<ReturnType<typeof chargerSerieMacro>>): void => {
      const source = cleSante(def);
      if (r.statut === "ok") {
        const dernier = r.points[r.points.length - 1];
        majSerie(def.id, { statut: "ok", points: r.points, majTs: dernier?.time ?? null, message: null });
        ecrireCache(def.id, r.points, now);
        healthStore.getState().marquerMessage(source);
      } else {
        majSerie(def.id, { statut: r.statut, points: [], majTs: null, message: r.message });
        if (r.statut === "quota") {
          healthStore.getState().setEtat(source, "polling", { derniereErreur: r.message });
        } else {
          healthStore.getState().marquerErreur(source, r.message);
        }
      }
    };

    await Promise.all(
      rapides.map((def) => chargerSerieMacro(def, depuis).then((r) => appliquer(def, r))),
    );

    for (let i = 0; i < lents.length; i++) {
      if (i > 0) await attendre(ESPACEMENT_OCDE_MS);
      const def = lents[i];
      if (def === undefined) continue;
      appliquer(def, await chargerSerieMacro(def, depuis));
    }
  },
}));
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- macroSeries`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/macroSeries.ts apps/web/src/store/macroSeries.test.ts
git commit -m "feat(macro): store des séries, cache 24 h et séquencement OCDE

Aucun setInterval, aucun polling : c'est la donnée la plus lente du terminal
et ECO annonce déjà ses dates de publication.

Les appels OCDE partent UN PAR UN, espacés de 2 s — le 429 tombe entre 10 et
12 requêtes rapprochées et son retry-after: 0 est mensonger. L'attente est
injectable pour que les tests ne dorment pas.

Un statut par série : clé FRED absente laisse cinq courbes sur six tracées.
Une clé de santé par hôte, quatre au total dans le panneau DATA."
```

---

## Task 10 : Projection en série temporelle pour `CourbeTaux`

Vingt-cinq lignes qui remplacent ~480 lignes de canvas neuf. `CourbeTaux` n'est pas modifié.

**Files:**
- Modify: `apps/web/src/components/courbeTaux.util.ts`
- Test: `apps/web/src/components/courbeTaux.util.test.ts`

**Interfaces:**
- Consumes: `PointCourbe` (`./CourbeTaux`), `MacroSeries` (`../data/macro/types`)
- Produces: `pointsDeSerieTemporelle(serie: MacroSeries): PointCourbe[]`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `apps/web/src/components/courbeTaux.util.test.ts` :

```ts
import { pointsDeSerieTemporelle } from "./courbeTaux.util";

describe("pointsDeSerieTemporelle", () => {
  it("projette le temps en années décimales strictement croissantes", () => {
    const pts = pointsDeSerieTemporelle([
      { time: Date.UTC(2026, 4, 1), value: 3.2 },
      { time: Date.UTC(2026, 5, 1), value: 2.8 },
      { time: Date.UTC(2027, 0, 1), value: 2.1 },
    ]);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.anneesTri).toBeLessThan(pts[1]!.anneesTri);
    expect(pts[1]!.anneesTri).toBeLessThan(pts[2]!.anneesTri);
    expect(pts.map((p) => p.taux)).toEqual([3.2, 2.8, 2.1]);
  });

  it("étiquette chaque point par mois et année abrégée", () => {
    const pts = pointsDeSerieTemporelle([{ time: Date.UTC(2026, 6, 1), value: 1.9 }]);
    expect(pts[0]!.maturite).toBe("juil. 26");
  });

  // L'infobulle de CourbeTaux apparie les points PAR IDENTITÉ DE CHAÎNE : deux points
  // distincts ne doivent jamais porter la même étiquette, sinon un pays affiche la
  // valeur d'un autre mois.
  it("produit des étiquettes uniques sur douze mois consécutifs", () => {
    const serie = Array.from({ length: 12 }, (_, i) => ({
      time: Date.UTC(2026, i, 1),
      value: i,
    }));
    const labels = pointsDeSerieTemporelle(serie).map((p) => p.maturite);
    expect(new Set(labels).size).toBe(12);
  });

  it("rend un tableau vide sur une série vide", () => {
    expect(pointsDeSerieTemporelle([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- courbeTaux.util`
Expected: FAIL — `pointsDeSerieTemporelle is not a function`

- [ ] **Step 3: Écrire l'implémentation minimale**

D'abord l'import, dans le **bloc d'imports en tête de fichier** (à côté du
`import type { PointCourbe } from "./CourbeTaux";` existant) — jamais en fin de fichier,
la règle `import/first` le rejetterait :

```ts
import type { MacroSeries } from "../data/macro/types";
```

Puis, à la fin de `apps/web/src/components/courbeTaux.util.ts` :

```ts
/** Mois abrégés FR — mêmes libellés que le reste du terminal. */
const MOIS_ABREGES: readonly string[] = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/**
 * Projette une série TEMPORELLE en points de `CourbeTaux`, dont l'axe X (`anneesTri`)
 * accepte n'importe quel flottant : on y met des années décimales. Cela évite d'écrire
 * un second composant canvas — au prix de deux contraintes portées par l'appelant :
 *
 *   1. UN GRAPHE = UNE FRÉQUENCE. L'infobulle de `CourbeTaux` apparie les points par
 *      identité de chaîne sur `maturite` : mélanger du mensuel et du trimestriel
 *      remplirait les colonnes de « — ».
 *   2. UN GRAPHE = DES POURCENTAGES. L'axe Y de `CourbeTaux` formate en dur avec « % ».
 *
 * Fonction PURE.
 */
export function pointsDeSerieTemporelle(serie: MacroSeries): PointCourbe[] {
  const pts: PointCourbe[] = [];
  for (const p of serie) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) continue;
    const d = new Date(p.time);
    const annee = d.getUTCFullYear();
    const mois = d.getUTCMonth();
    // Années décimales : l'axe n'a besoin que de la monotonie et d'un espacement juste.
    const anneesTri = annee + mois / 12;
    const libelleMois = MOIS_ABREGES[mois] ?? String(mois + 1);
    pts.push({
      maturite: `${libelleMois} ${String(annee).slice(2)}`,
      anneesTri,
      taux: p.value,
    });
  }
  return pts;
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- courbeTaux.util`
Expected: PASS — les tests existants de `pointsDeCourbe` restent verts, plus 4 nouveaux

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/courbeTaux.util.ts apps/web/src/components/courbeTaux.util.test.ts
git commit -m "feat(macro): projection d'une série temporelle pour CourbeTaux

Vingt-cinq lignes de projection au lieu d'un second composant canvas :
l'axe X de CourbeTaux accepte n'importe quel flottant, on y met des années
décimales.

Un test vérifie l'unicité des étiquettes sur douze mois consécutifs —
l'infobulle apparie les points par identité de chaîne, une collision ferait
afficher à un pays la valeur d'un autre mois.

CourbeTaux.tsx n'est pas modifié."
```

---

## Task 11 : Onglet « Indicateurs » dans la fenêtre RATE

**Files:**
- Modify: `apps/web/src/components/MacroRatesWindow.tsx`
- Modify: `apps/web/src/data/dataCockpit.ts`
- Modify: `apps/web/src/data/macro/index.ts`

**Interfaces:**
- Consumes: `macroSeriesStore`, `INDICATEURS_MACRO`, `seriesDeIndicateur`, `ORDRE_REGIONS`, `pointsDeSerieTemporelle`, `finDePeriode`
- Produces: rien de nouveau pour les tâches suivantes

- [ ] **Step 1: Ajouter les libellés de source du panneau DATA**

Dans `apps/web/src/data/dataCockpit.ts`, dans l'objet `LIBELLES_SOURCE`, après la ligne `"eco:fred": "FRED",` insérer :

```ts
  "macro:fred": "FRED · macro",
  "macro:oecd": "OCDE",
  "macro:eurostat": "Eurostat",
  "macro:ons": "ONS (UK)",
```

- [ ] **Step 2: Ré-exporter la couche macro**

Dans `apps/web/src/data/macro/index.ts`, ajouter à la fin :

```ts
export type {
  DefinitionSerieMacro,
  IndicateurMacro,
  RegionMacro,
  SourceMacro,
} from "./catalogueMacro";
export { CATALOGUE_MACRO, INDICATEURS_MACRO, ORDRE_REGIONS, seriesDeIndicateur } from "./catalogueMacro";

export type { FrequenceMacro } from "./harmonisation";
export { filtrerFenetre, finDePeriode, periodeVersMs, trierChrono } from "./harmonisation";

export type { ResultatSerieMacro } from "./chargerSerieMacro";
export { chargerSerieMacro, cleSante } from "./chargerSerieMacro";
```

- [ ] **Step 3: Ajouter l'onglet au composant**

Dans `apps/web/src/components/MacroRatesWindow.tsx` :

(a) Étendre le type d'onglet (ligne ~164) :

```ts
type Onglet = "rendements" | "directeurs" | "or" | "indicateurs";
```

(b) Ajouter les imports en tête de fichier.

`useStore` (l.19), `CourbeTaux` + `SerieCourbe` (l.35) et `formatPourcentage` (l.38) sont **déjà importés** — ne pas les ré-importer. Ajouter uniquement :

```ts
import { macroSeriesStore } from "../store/macroSeries";
import { INDICATEURS_MACRO, ORDRE_REGIONS, seriesDeIndicateur, type IndicateurMacro } from "../data/macro/catalogueMacro";
import { finDePeriode } from "../data/macro/harmonisation";
import { pointsDeSerieTemporelle } from "./courbeTaux.util";
```

et ajouter `Fraicheur` à la liste déjà importée depuis `./ui` (l.39).

(c) Ajouter le sous-composant, juste avant la définition de `MacroRatesWindow` :

```tsx
/**
 * Onglet « Indicateurs » — une ligne d'indicateur, six pays en séries superposées.
 *
 * Le découpage n'est pas cosmétique : `CourbeTaux` apparie son infobulle par identité
 * de chaîne et formate son axe Y en pourcentage. UN indicateur (donc une fréquence et
 * une unité) par graphe est la condition de sa réutilisation.
 */
function OngletIndicateurs() {
  const [indicateur, setIndicateur] = useState<IndicateurMacro>("cpi-aa");
  const series = useStore(macroSeriesStore, (s) => s.series);

  useEffect(() => {
    void macroSeriesStore.getState().demanderIndicateur(indicateur);
  }, [indicateur]);

  const definitions = seriesDeIndicateur(indicateur);
  const meta = INDICATEURS_MACRO.find((i) => i.id === indicateur);

  const courbes: SerieCourbe[] = definitions.flatMap((def) => {
    const etat = series[def.id];
    if (etat === undefined || etat.points.length === 0) return [];
    return [
      {
        label: def.libelleRegion,
        points: pointsDeSerieTemporelle(etat.points),
        couleurTokenIndex: ORDRE_REGIONS.indexOf(def.region) + 1,
      },
    ];
  });

  const chargement = definitions.some((d) => series[d.id]?.statut === "loading");

  return (
    <div className="flex flex-col gap-3 p-3">
      <Segmente
        options={INDICATEURS_MACRO.map((i) => ({ id: i.id, label: i.label, title: i.description }))}
        actif={indicateur}
        onChange={setIndicateur}
      />

      {chargement && courbes.length === 0 ? (
        <Chargement libelle="Chargement des séries macro…" />
      ) : courbes.length === 0 ? (
        <Vide>Aucune série disponible.</Vide>
      ) : (
        <CourbeTaux series={courbes} />
      )}

      {/* Une ligne par région : valeur, fraîcheur, et MOTIF explicite si absente —
          jamais un tiret muet (règle d'affichage honnête de la spec). */}
      <div className="flex flex-col gap-1">
        {definitions.map((def) => {
          const etat = series[def.id];
          const dernier = etat?.points[etat.points.length - 1];
          const majTs = dernier !== undefined ? finDePeriode(dernier.time, def.frequence) : null;
          return (
            <div key={def.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="flex items-baseline gap-1.5">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: `var(--serie-${ORDRE_REGIONS.indexOf(def.region) + 1})` }}
                  aria-hidden
                />
                <span className="text-text">{def.libelleRegion}</span>
                {def.perimetre !== undefined && (
                  <span className="text-text-dim">({def.perimetre})</span>
                )}
              </span>
              <span className="flex items-baseline gap-2">
                {dernier !== undefined ? (
                  <span className="tabular-nums text-text">{formatPourcentage(dernier.value)}</span>
                ) : (
                  <span className="text-warn">{etat?.message ?? "Indisponible."}</span>
                )}
                {/* Cadence = durée de période + délai de publication observé, PAS la
                    durée de période seule. Mensuel : 30 j + ~5 j de délai = 35 j ; le
                    seuil « attardé » d'etatFraicheur (1,5 × cadence = 52 j) laisse donc
                    passer un CPI publié à la mi-mois sans crier au retard, tandis que le
                    bloc chinois gelé depuis février ressort bien « périmé » (4 × cadence
                    = 140 j). Trimestriel : 90 j + ~10 j. NE PAS arrondir à 30 ou 90. */}
                <Fraicheur
                  loading={etat?.statut === "loading"}
                  majTs={majTs}
                  cadenceMs={def.frequence === "Q" ? 100 * 24 * 3_600_000 : 35 * 24 * 3_600_000}
                />
              </span>
            </div>
          );
        })}
      </div>

      <NoteSource>
        {meta?.description} Sources : FRED, Eurostat, OCDE, ONS. Publication mensuelle —
        cache local 24 h.
      </NoteSource>
    </div>
  );
}
```

(d) Ajouter l'entrée dans la liste passée à `Onglets` (chercher le tableau contenant `{ id: "or", label: … }`) :

```ts
  { id: "indicateurs", label: "Indicateurs" },
```

(e) Dans le rendu conditionnel du corps de fenêtre, ajouter la branche :

```tsx
{onglet === "indicateurs" && <OngletIndicateurs />}
```

(f) Dans le gestionnaire de rafraîchissement manuel (`onRafraichir`), ajouter la branche :

```ts
    else if (onglet === "indicateurs") {
      void macroSeriesStore.getState().demanderIndicateur("cpi-aa", { force: true });
    }
```

- [ ] **Step 4: Vérifier la compilation et la suite complète**

Run: `pnpm --filter @axiom/web typecheck && pnpm --filter @axiom/web test`
Expected: typecheck sans erreur, toute la suite verte

- [ ] **Step 5: Vérifier visuellement dans l'application**

Run: `pnpm run up`

Puis dans le navigateur : ouvrir `RATE` (⌘K → `RATE`), onglet « Indicateurs ».
Attendu : six courbes tracées, la légende nomme les six régions, la liste sous le graphe
affiche six valeurs en pourcentage avec leur fraîcheur. Contrôle des oracles :
États-Unis ≈ 3,3 · zone euro ≈ 3,2 · Royaume-Uni ≈ 2,9 · Japon ≈ 1,9 · Chine ≈ 0,5 ·
Inde ≈ 4,6.

- [ ] **Step 6: Vérifier la dégradation sans clé FRED**

Renommer temporairement la clé dans `apps/web/.env` (`FRED_API_KEY` → `FRED_API_KEY_OFF`),
relancer, rouvrir l'onglet.
Attendu : cinq courbes tracées, la ligne « États-Unis » affiche « Clé FRED absente. »,
aucune erreur en console. **Restaurer la clé ensuite.**

- [ ] **Step 7: Vérifier qu'aucun fichier interdit n'a bougé**

Run: `git diff --stat shared/extapi-hosts.ts apps/daemon/ api/ packages/ apps/web/src/store/windowManager.ts`
Expected: sortie **vide**

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/MacroRatesWindow.tsx apps/web/src/data/dataCockpit.ts apps/web/src/data/macro/index.ts
git commit -m "feat(macro): onglet Indicateurs dans la fenêtre RATE

Un Segmente choisit l'indicateur, les six pays sont les séries superposées —
c'est la structure qu'impose la réutilisation de CourbeTaux (infobulle
appariée par chaîne, axe Y en pourcentage).

Sous le graphe, une ligne par région avec sa valeur, sa fraîcheur datée en FIN
de période, et son MOTIF explicite quand elle est absente : jamais un tiret muet.

Quatre sources déclarées au panneau DATA. Aucune fenêtre nouvelle, le registre
reste à 39."
```

---

## Task 12 : Contrôle d'intégration du lot 1

Aucun code neuf : on vérifie que le lot tient ses promesses mesurables.

**Files:** aucun

- [ ] **Step 1: Suite complète**

Run: `bash scripts/ci.sh`
Expected: vert de bout en bout

- [ ] **Step 2: Vérifier le périmètre du diff**

```bash
git diff --stat main -- shared/ apps/daemon/ api/ packages/ apps/web/src/store/windowManager.ts
```
Expected: sortie **vide** — le lot 1 n'a touché ni la whitelist, ni le daemon, ni le proxy Vercel, ni les packages, ni le registre de fenêtres.

- [ ] **Step 3: Vérifier qu'aucun test n'appelle le réseau**

Les seules mentions d'URL dans les tests doivent être des commentaires de provenance ou
des chaînes comparées dans un stub — jamais un `fetch` réel.

```bash
grep -rn 'fetch("https://\|fetch(`https://' \
  apps/web/src/data/macro/*.test.ts apps/web/src/store/macroSeries.test.ts
```
Expected: **aucune sortie**.

```bash
grep -c "vi.stubGlobal(\"fetch\"" apps/web/src/store/macroSeries.test.ts
```
Expected: `4` — chaque test du store neutralise `fetch`.

- [ ] **Step 4: Commit du décompte (si des ajustements ont été nécessaires)**

Si les étapes précédentes ont exigé des corrections, les committer :

```bash
git add -A
git commit -m "fix(macro): corrections issues du contrôle d'intégration du lot 1"
```

Sinon, passer à la tâche suivante sans commit.

---

# LOT 2 — Les ponts

Zéro requête réseau nouvelle, zéro source nouvelle. C'est la réponse au reproche récurrent « calculé ≠ montré » : `ECO` annonce la publication du CPI depuis toujours sans jamais pouvoir en montrer l'historique.

## Task 13 : Pont calendrier ECO → série

**Files:**
- Create: `apps/web/src/data/macro/ecoVersSerie.ts`
- Test: `apps/web/src/data/macro/ecoVersSerie.test.ts`

**Interfaces:**
- Consumes: `CATALOGUE_MACRO` (`./catalogueMacro`)
- Produces: `serieMacroDe(country: string, title: string): string | null` — identifiant de série du catalogue, ou `null`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/web/src/data/macro/ecoVersSerie.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { serieMacroDe } from "./ecoVersSerie";

describe("serieMacroDe", () => {
  it("relie une publication CPI à la série de sa zone", () => {
    expect(serieMacroDe("USD", "Consumer Price Index m/m")).toBe("cpi-aa-us");
    expect(serieMacroDe("USD", "CPI y/y")).toBe("cpi-aa-us");
    expect(serieMacroDe("EUR", "Core CPI Flash Estimate y/y")).toBe("cpi-aa-ez");
    expect(serieMacroDe("GBP", "CPI y/y")).toBe("cpi-aa-uk");
    expect(serieMacroDe("JPY", "National Core CPI y/y")).toBe("cpi-aa-jp");
    expect(serieMacroDe("CNY", "CPI y/y")).toBe("cpi-aa-cn");
    expect(serieMacroDe("INR", "CPI y/y")).toBe("cpi-aa-in");
  });

  it("ignore une publication sans série correspondante", () => {
    expect(serieMacroDe("EUR", "ZEW Economic Sentiment")).toBeNull();
    expect(serieMacroDe("USD", "Non-Farm Employment Change")).toBeNull();
    expect(serieMacroDe("USD", "FOMC Statement")).toBeNull();
  });

  it("ignore une devise hors des six zones suivies", () => {
    expect(serieMacroDe("AUD", "CPI q/q")).toBeNull();
    expect(serieMacroDe("", "CPI y/y")).toBeNull();
  });

  it("est insensible à la casse et aux espaces du titre", () => {
    expect(serieMacroDe("usd", "  consumer price index  ")).toBe("cpi-aa-us");
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- ecoVersSerie`
Expected: FAIL — `Failed to resolve import "./ecoVersSerie"`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/web/src/data/macro/ecoVersSerie.ts` :

```ts
/**
 * Pont calendrier ECO → série du catalogue macro. Fonction PURE.
 *
 * `ECO` annonçait la publication du CPI américain — sa date, sa prévision, sa valeur
 * précédente — sans jamais pouvoir en montrer l'historique. Ce module fournit la cible
 * du bouton « série » de la ligne du calendrier.
 *
 * Les motifs de titre reprennent la convention déjà employée par `impactPublicationFred`
 * (data/eco.ts) : reconnaissance par mots-clés sur le titre ForexFactory, jamais par
 * identifiant — les titres varient d'une semaine à l'autre.
 */
import { CATALOGUE_MACRO, type RegionMacro } from "./catalogueMacro";

/** Devise ForexFactory → zone du catalogue. Les devises absentes ne sont pas suivies. */
const DEVISE_VERS_REGION: Record<string, RegionMacro> = {
  USD: "US",
  EUR: "EZ",
  GBP: "UK",
  JPY: "JP",
  CNY: "CN",
  INR: "IN",
};

/** Mots-clés de titre → indicateur du catalogue. Premier motif trouvé l'emporte. */
const MOTIFS: ReadonlyArray<{ motif: RegExp; indicateur: "cpi-aa" }> = [
  { motif: /\bcpi\b|consumer price index/i, indicateur: "cpi-aa" },
];

/**
 * Identifiant de série correspondant à une ligne du calendrier, ou `null` si la
 * publication n'a pas de série suivie (auquel cas aucun bouton n'est rendu).
 */
export function serieMacroDe(country: string, title: string): string | null {
  const region = DEVISE_VERS_REGION[country.trim().toUpperCase()];
  if (region === undefined) return null;

  const titre = title.trim();
  for (const { motif, indicateur } of MOTIFS) {
    if (!motif.test(titre)) continue;
    const def = CATALOGUE_MACRO.find((d) => d.region === region && d.indicateur === indicateur);
    if (def !== undefined) return def.id;
  }
  return null;
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @axiom/web test -- ecoVersSerie`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/macro/ecoVersSerie.ts apps/web/src/data/macro/ecoVersSerie.test.ts
git commit -m "feat(macro): pont pur calendrier ECO vers série du catalogue

Reconnaissance par mots-clés sur le titre ForexFactory, même convention que
impactPublicationFred — les titres varient d'une semaine à l'autre, jamais
d'appariement par identifiant.

Rend null pour toute publication sans série suivie : la ligne ECO ne rend
alors aucun bouton, plutôt qu'un bouton mort."
```

---

## Task 14 : Bouton « série » sur la ligne du calendrier

**Files:**
- Modify: `apps/web/src/components/EcoWindow.tsx`

**Interfaces:**
- Consumes: `serieMacroDe` (`../data/macro/ecoVersSerie`), `macroSeriesStore`, `windowManagerStore`
- Produces: rien

> **⚠️ Contrainte HTML repérée dans le source.** Le composant `Ligne`
> (`EcoWindow.tsx:90`) rend la ligne **entière comme un `<button>`** (clic = marquer sur
> le chart). Imbriquer un second `<button>` dedans est du HTML invalide et React émettra
> un avertissement. Le bouton « série » doit donc être un **frère**, pas un enfant : on
> enveloppe la ligne existante dans un conteneur `relative` et on positionne le nouveau
> bouton en absolu. Le `<button>` existant n'est pas restructuré.

- [ ] **Step 1: Ajouter les imports**

En tête de `apps/web/src/components/EcoWindow.tsx` :

```ts
import { serieMacroDe } from "../data/macro/ecoVersSerie";
import { macroSeriesStore } from "../store/macroSeries";
import { windowManagerStore } from "../store/windowManager";
```

- [ ] **Step 2: Envelopper la ligne et ajouter le bouton frère**

Dans `apps/web/src/components/EcoWindow.tsx:90`, la fonction `Ligne` commence par :

```tsx
function Ligne({ ev, passe }: { ev: EcoEvent; passe: boolean }) {
  return (
    <button
```

La transformer en enveloppant le `<button>` existant, **sans en modifier le contenu** :

```tsx
function Ligne({ ev, passe }: { ev: EcoEvent; passe: boolean }) {
  // Le bouton « série » est un FRÈRE du bouton de ligne, pas un enfant : imbriquer
  // deux <button> est du HTML invalide. D'où le conteneur `relative` + position absolue.
  const idSerie = serieMacroDe(ev.country, ev.title);
  return (
    <div className="relative">
      <button
```

Puis, après la balise fermante `</button>` de ce bouton (fin du corps existant de
`Ligne`), avant le `);` final, insérer le bouton et refermer le conteneur :

```tsx
      {idSerie !== null && (
        <button
          type="button"
          title="Voir l'historique de cette statistique"
          className="absolute right-3 bottom-2 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text-dim transition hover:text-text"
          onClick={() => {
            windowManagerStore.getState().openWindow("macroRates");
            void macroSeriesStore.getState().demanderIndicateur("cpi-aa");
          }}
        >
          série
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier la compilation et la suite**

Run: `pnpm --filter @axiom/web typecheck && pnpm --filter @axiom/web test`
Expected: vert

- [ ] **Step 4: Vérifier dans l'application, console ouverte**

Run: `pnpm run up`

Ouvrir `ECO`. Attendu : les lignes CPI des six zones portent un bouton « série » ; les
autres publications (NFP, FOMC, ZEW) n'en portent aucun. Un clic ouvre `RATE`.
**Contrôle explicite** : la console ne doit contenir aucun avertissement React de type
`validateDOMNesting` — sa présence signalerait que le bouton a été imbriqué au lieu
d'être un frère.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/EcoWindow.tsx
git commit -m "feat(eco): bouton « série » sur les publications à historique suivi

ECO annonçait la publication du CPI sans jamais pouvoir en montrer la courbe.
Le bouton n'apparaît que sur les lignes dont une série existe au catalogue —
aucun bouton mort sur les autres publications."
```

---

## Task 15 : Section macro du point marché (BRIEF)

**Files:**
- Modify: `apps/web/src/data/brief.ts`
- Create: `apps/web/src/components/brief/SectionMacro.tsx`
- Modify: `apps/web/src/components/BriefWindow.tsx`
- Test: `apps/web/src/data/brief.test.ts` (fichier existant, à compléter)

> **Pattern imposé par le source.** `BriefWindow` ne contient pas le JSX de ses sections :
> il compose des composants dédiés de `components/brief/` (`SectionEco`, `SectionCot`…)
> bâtis sur les helpers `TitreBloc` et `corps` de `components/brief/commun.tsx`.
> La section macro suit ce pattern — pas de JSX inline dans `BriefWindow`.
> Le rendu conditionnel suit celui de `SectionCot` (`BriefWindow.tsx:390`) :
> `{macro !== null && <SectionMacro macro={macro} />}` — section simplement **absente**
> quand rien n'est en cache.

**Interfaces:**
- Consumes: `macroSeriesStore`, `seriesDeIndicateur`
- Produces:
  - `interface LigneMacroBrief { region: string; valeur: number | null; message: string | null }`
  - champ `macro: LigneMacroBrief[] | null` ajouté à `DonneesBrief`
  - `lignesMacroBrief(series: Record<string, EtatSerie>): LigneMacroBrief[] | null` — PURE

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `apps/web/src/data/brief.test.ts` :

```ts
import { lignesMacroBrief } from "./brief";

describe("lignesMacroBrief", () => {
  it("rend une ligne par région, valeur du dernier point", () => {
    const lignes = lignesMacroBrief({
      "cpi-aa-us": { statut: "ok", points: [{ time: Date.UTC(2026, 6, 1), value: 3.3 }], majTs: null, message: null },
      "cpi-aa-ez": { statut: "ok", points: [{ time: Date.UTC(2026, 7, 1), value: 3.2 }], majTs: null, message: null },
    });
    expect(lignes).not.toBeNull();
    expect(lignes!.find((l) => l.region === "États-Unis")?.valeur).toBe(3.3);
    expect(lignes!.find((l) => l.region === "Zone euro")?.valeur).toBe(3.2);
  });

  it("porte le motif d'indisponibilité plutôt qu'un vide", () => {
    const lignes = lignesMacroBrief({
      "cpi-aa-us": { statut: "sansCle", points: [], majTs: null, message: "Clé FRED absente." },
    });
    const us = lignes!.find((l) => l.region === "États-Unis");
    expect(us?.valeur).toBeNull();
    expect(us?.message).toBe("Clé FRED absente.");
  });

  // Le BRIEF LIT le cache, il ne déclenche aucun fetch : sans donnée chargée, la
  // section est absente plutôt que vide.
  it("rend null quand aucune série n'est chargée", () => {
    expect(lignesMacroBrief({})).toBeNull();
  });
});
```

Compléter aussi le `describe("briefEnMarkdown")` existant (`brief.test.ts:277`) — le brief
est exporté vers le journal, la section doit y figurer :

```ts
  it("sérialise la section macro, et la marque indisponible quand elle est absente", () => {
    // `donnees` est l'instantané déjà construit par les tests voisins de ce describe :
    // reprendre le même objet et n'en faire varier que le champ `macro`.
    const avec = briefEnMarkdown({ ...donnees, macro: [{ region: "Zone euro", valeur: 3.2, message: null }] }, now);
    expect(avec).toContain("## Inflation (a/a)");
    expect(avec).toContain("Zone euro");

    const sans = briefEnMarkdown({ ...donnees, macro: null }, now);
    expect(sans).toContain("## Inflation (a/a)");
    expect(sans.split("## Inflation (a/a)")[1]).toContain("_Section indisponible._");
  });
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @axiom/web test -- brief`
Expected: FAIL — `lignesMacroBrief is not a function`

- [ ] **Step 3: Écrire l'implémentation**

Dans `apps/web/src/data/brief.ts`, ajouter les imports :

```ts
import type { EtatSerie } from "../store/macroSeries";
import { seriesDeIndicateur } from "./macro/catalogueMacro";
```

puis, avant la définition de `DonneesBrief` :

```ts
/** Une ligne macro du point marché : une zone, sa dernière valeur ou son motif d'absence. */
export interface LigneMacroBrief {
  region: string;
  /** Dernière valeur en %, ou `null` si indisponible. */
  valeur: number | null;
  /** Motif d'indisponibilité, ou `null`. Jamais de ligne muette. */
  message: string | null;
}

/**
 * Projette l'état des séries macro en lignes de BRIEF. PURE — LIT le cache déjà chargé,
 * ne déclenche aucun fetch : le point marché est un instantané, pas un chargeur.
 * Rend `null` (section absente) plutôt qu'un tableau vide quand rien n'est chargé.
 */
export function lignesMacroBrief(series: Record<string, EtatSerie>): LigneMacroBrief[] | null {
  const definitions = seriesDeIndicateur("cpi-aa");
  const lignes: LigneMacroBrief[] = [];
  for (const def of definitions) {
    const etat = series[def.id];
    if (etat === undefined || etat.statut === "idle") continue;
    const dernier = etat.points[etat.points.length - 1];
    lignes.push({
      region: def.libelleRegion,
      valeur: dernier?.value ?? null,
      message: dernier === undefined ? (etat.message ?? "Indisponible.") : null,
    });
  }
  return lignes.length > 0 ? lignes : null;
}
```

Ajouter enfin le champ à l'interface `DonneesBrief` :

```ts
  /** Inflation a/a des six zones ; `null` si aucune série n'est en cache. */
  macro: LigneMacroBrief[] | null;
```

et l'alimenter là où `DonneesBrief` est construit :

```ts
    macro: lignesMacroBrief(macroSeriesStore.getState().series),
```

(avec `import { macroSeriesStore } from "../store/macroSeries";` en tête de fichier)

- [ ] **Step 4: Sérialiser la section dans l'export Markdown**

`briefEnMarkdown` (`brief.ts:313`) sérialise le brief vers le journal : une section
absente de cette fonction serait absente de l'export. Après le bloc de la section
« Événements éco » et avant celui des actualités, ajouter :

```ts
  l.push("## Inflation (a/a)");
  if (d.macro === null) {
    l.push("_Section indisponible._");
  } else {
    for (const ligne of d.macro) {
      l.push(
        `- **${ligne.region}** ${ligne.valeur !== null ? formatPourcentage(ligne.valeur) : (ligne.message ?? "indisponible")}`,
      );
    }
  }
  l.push("");
```

(`formatPourcentage` est déjà importé dans `brief.ts` — vérifier avant d'ajouter un import.)

- [ ] **Step 5: Créer le composant de section**

Créer `apps/web/src/components/brief/SectionMacro.tsx`, calqué sur `SectionEco.tsx` :

```tsx
/**
 * Section BRIEF — inflation en glissement annuel des six zones suivies.
 *
 * LIT le cache du store macro, ne déclenche AUCUN fetch : le point marché est un
 * instantané. La section est absente (et non vide) quand rien n'est chargé — c'est
 * l'orchestrateur qui la conditionne, comme pour SectionCot.
 */
import type { LigneMacroBrief } from "../../data/brief";
import { formatPourcentage } from "../../lib/format";
import { NoteSource } from "../ui";
import { TitreBloc } from "./commun";

interface Props {
  macro: LigneMacroBrief[];
}

export function SectionMacro({ macro }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Inflation (a/a)</TitreBloc>
      <div className="space-y-1">
        {macro.map((l) => (
          <div key={l.region} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-text">{l.region}</span>
            {l.valeur !== null ? (
              <span className="tabular-nums text-text">{formatPourcentage(l.valeur)}</span>
            ) : (
              /* Motif explicite, jamais un tiret muet. */
              <span className="text-warn">{l.message}</span>
            )}
          </div>
        ))}
      </div>
      <NoteSource>FRED · Eurostat · OCDE · ONS — lu du cache local, publication mensuelle.</NoteSource>
    </section>
  );
}
```

- [ ] **Step 6: Composer la section dans la fenêtre**

Dans `apps/web/src/components/BriefWindow.tsx` :

(a) ajouter l'import à côté des autres sections (après la ligne `import { SectionEco } …`) :

```ts
import { SectionMacro } from "./brief/SectionMacro";
```

(b) rendre la section juste après `<SectionEco … />` (l.393), en suivant exactement la
forme conditionnelle de `SectionCot` (l.390) :

```tsx
        {/* Inflation a/a des six zones — cache du store macro, aucun réseau déclenché ici. */}
        {donnees.macro !== null && <SectionMacro macro={donnees.macro} />}
```

> Adapter `donnees.macro` au nom réel de la variable dans le composant : si `DonneesBrief`
> est déstructuré comme les autres sections (`const { eco, news, … } = …`), ajouter `macro`
> à la déstructuration et écrire `{macro !== null && <SectionMacro macro={macro} />}`.

- [ ] **Step 7: Lancer les tests**

Run: `pnpm --filter @axiom/web typecheck && pnpm --filter @axiom/web test`
Expected: vert, 3 nouveaux tests dans `brief`

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/data/brief.ts apps/web/src/data/brief.test.ts \
        apps/web/src/components/brief/SectionMacro.tsx apps/web/src/components/BriefWindow.tsx
git commit -m "feat(brief): section inflation six zones dans le point marché

lignesMacroBrief LIT le cache déjà chargé et ne déclenche aucun fetch : le
point marché est un instantané, pas un chargeur. Section absente plutôt que
vide quand rien n'est en cache, et motif explicite sur chaque ligne
indisponible."
```

---

## Task 16 : Contrôle final et mise à jour du README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Suite complète**

Run: `bash scripts/ci.sh`
Expected: vert

- [ ] **Step 2: Mettre à jour le tableau des capacités du README**

Dans le tableau « Lire le contexte » de `README.md`, ajouter la mention de l'onglet dans
l'énumération des fenêtres macro : après `taux & liquidité Fed`, insérer
`inflation mondiale 6 zones`.

- [ ] **Step 3: Vérifier une dernière fois le périmètre**

```bash
git diff --stat main -- shared/ apps/daemon/ api/ packages/ apps/web/src/store/windowManager.ts
```
Expected: sortie **vide**

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): mentionne l'inflation mondiale six zones"
```

---

## Ce que ce plan ne fait pas

Repris de la spec §8, pour que l'exécutant ne « complète » pas de son propre chef :

- **Aucune ligne PMI** — ISM, S&P Global, CIPS et Jibun sont propriétaires, et les cinq substituts vivent sur des échelles incompatibles. Afficher un solde d'opinion comme un PMI serait un faux.
- **Aucune colonne de surprise vs consensus** — aucune source gratuite de consensus.
- **Pas d'alerte macro, pas d'overlay de pane chart, pas de pont screener/backtest, pas de collecteur daemon, pas de table SQLite.**
- **Pas de primitive `CourbeTemporelle`**, pas de migration de `NETLIQ` ni de `CYCLE`.
- **Pas de renommage de `createFredM2Provider`** malgré son nom trompeur : `netliq.ts` en dépend.
- **Pas de rebasage base 100, pas de MoM, pas de LOCF, pas de désaisonnalisation locale.**
- **Le lot 3** (change effectif réel, core CPI, production industrielle, chômage, PIB — ~30 séries au total) fera l'objet d'un plan distinct, uniquement additif au catalogue. Ne pas l'anticiper ici.
