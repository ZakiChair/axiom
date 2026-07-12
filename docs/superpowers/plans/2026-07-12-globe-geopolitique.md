# Couche géopolitique du globe — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher sur la fenêtre GLOBE trois couches géopolitiques toggleables — événements GDELT (15 min), conflits confirmés UCDP, front Ukraine ISW — avec tooltip, panneau détail au clic et âges honnêtes des sources.

**Architecture:** Le daemon (Bun+SQLite) ingère les tranches GDELT (zip HTTP-only, dézippé via `node:zlib`, filtré racines CAMEO 14-20, stocké en table `globe_evenements`, boucle 15 min, purge 48 h) et agrège UCDP (CSV RFC 4180, grille 0,5°, instantané stale-capable) — le front consomme deux routes JSON compactes `/globe/*` via `urlDaemon()`. ISW est fetché **direct navigateur** (CORS `*`, géométrie simplifiée serveur → 11,6 Ko). Le rendu suit le pattern canvas impératif existant de `globeRender.ts` (fonctions pures testées, zéro re-render par frame).

**Tech Stack:** Bun (daemon, `bun:test`), `node:zlib` (inflateRawSync), SQLite (`bun:sqlite`), d3-geo (déjà présent), React/zustand-vanilla, vitest (web), Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-07-12-globe-geopolitique-audit-ui-design.md` (chantier 1 ; le chantier 2 — audit UI multi-agents — se lance APRÈS ce plan, ses fixes émergeront des findings).

## Global Constraints

- **Aucune nouvelle dépendance npm ; ne PAS modifier les `package.json`** (BUILD-CONTRACT.md:18 — deps figées).
- **Aucun re-render React par frame** : données de dessin dans des refs, redraw via `throttleRef.current?.trigger()` ; un `setState` par clic/chargement (basse fréquence) est autorisé.
- **Aucune couleur en dur dans le rendu** : tout passe par `TokensGlobe` ← `lireTokensCanvas` (tokens dispo : `--serie-1…6`, `--up`, `--down`, `--accent`, `--text`, `--text-dim`, `--bg`, `--surface`, `--border`, `--grid`).
- **Commentaires et docs en FRANÇAIS** ; TypeScript strict avec `noUncheckedIndexedAccess` (tout index tableau renvoie `T | undefined` → garder les gardes).
- **Interdiction d'import cross-package** apps/daemon ↔ apps/web : les types miroirs sont dupliqués avec un commentaire « COPIE VERBATIM … source de vérité = ce commentaire » (convention existante, cf. `proxy.ts::appendApiKeyIfAbsent`).
- **Le front reste 100 % fonctionnel SANS daemon** : les couches GDELT/UCDP dégradent en silence (`null` → note « daemon hors ligne » en pied), ISW et le reste du globe vivent.
- **Âge exposé en CHAMP JSON epoch-ms** (convention `majA`), jamais en en-tête ; le front calcule l'âge (`formatAge`).
- **Ne PAS toucher `TTL_SECONDES_PAR_PREFIXE`** (cache.ts — verrouillé par un test `toEqual`) : les routes `/globe` gèrent leur propre fraîcheur.
- **Erreurs = JSON conventionnel avec CORS** via un helper `json()` local au module (dupliqué volontairement, ne pas factoriser) ; jamais de throw nu vers `Bun.serve`.
- Tests : daemon = `bun:test` (`cd apps/daemon && bun test src`), web = vitest node SANS DOM ni mock de fetch (`pnpm --filter @axiom/web test`) — fonctions de parse PURES sur fixtures réelles, `chargerXxx` réseau non testé.
- Commandes globales : `pnpm -r typecheck`, `pnpm -r test`, `pnpm build`.

## Faits amont vérifiés empiriquement (2026-07-12, ne pas re-vérifier)

- GDELT : `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` (HTTP **uniquement**, https échoue) → 1ʳᵉ ligne `<taille> <md5> <url .export.CSV.zip>`. Zip mono-fichier DEFLATE (méthode 8), en-tête local sans data-descriptor. Tranche `20260712001500` : 1243 lignes × 61 colonnes tabulées SANS en-tête ; **194 événements** passent le filtre (racines 14:14, 15:1, 16:4, 17:40, 18:41, 19:90, 20:4). Indices 0-based confirmés : 0=GlobalEventID, 6=Actor1Name, 16=Actor2Name, 26=EventCode, 28=EventRootCode, 29=QuadClass, 30=GoldsteinScale, 31=NumMentions, 56=ActionGeo_Lat, 57=ActionGeo_Long, 59=DATEADDED (`YYYYMMDDHHMMSS` UTC), 60=SOURCEURL. Racines 10-14 → QuadClass 3, racines 15-20 → QuadClass 4.
- UCDP : fichier courant découvert via `https://ucdp.uu.se/downloads/index.html` (motif `candidateged/GEDEvent_v26_0_5.csv` — versionné, PAS d'URL stable), CSV 49 colonnes avec en-tête, champs quotés RFC 4180 (virgules, `""` échappés, retours ligne DANS les champs). Colonnes utiles par NOM : `latitude`, `longitude`, `best`, `side_a`, `side_b`, `date_start` (`2026-05-05 00:00:00.000`), `country`. 1686 enregistrements, ~680 zones sur grille 0,5°. Pas de CORS → daemon obligatoire.
- ISW : `https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49/query?where=1%3D1&outFields=EditDate&f=geojson&geometryPrecision=3&maxAllowableOffset=0.01` → FeatureCollection de **10 polygones, 11,6 Ko** (2 Mo sans simplification — les 2 params sont OBLIGATOIRES). CORS `*` → direct navigateur. `EditDate` = epoch ms.
- Fixtures pré-téléchargées dans le scratchpad de session `/private/tmp/claude-501/-Users-zakichair/00cf0e45-d667-4fbb-8a68-c25ab7caa7e1/scratchpad/` : `gdelt-tranche-20260712001500.export.CSV.zip` (69 466 o, MD5 `62d4b8e0437c72927200ece0e6fdd8c4`), `ucdp-fixture.csv` (en-tête + 20 enregistrements réécrits proprement). Si absent, re-télécharger : `curl -s "http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip"` (URL d'archive stable) et re-carver UCDP depuis `GEDEvent_v26_0_5.csv` (en-tête + 20 enregistrements via le module `csv` Python).

## Écarts assumés par rapport à la spec (justifiés à l'implémentation)

1. **Filtre GDELT simplifié** : la spec disait « QuadClass 4 OU (QuadClass 3 ET racine ∈ {14, 16}) » ; la table croisée réelle montre racines 10-14 → Q3 et 15-20 → Q4, donc le filtre équivalent et plus simple est **racine ∈ {14…20}** (même intention : protestations + coercition + conflit matériel, sans le bruit verbal diplomatique 09-13).
2. **Racine 15 (« posture militaire ») → coercition**, pas protestation : la spec groupait 14/15 en « protestation » ; exhiber une posture de force n'est pas une protestation.
3. **Couleur coercition = `--serie-4` (rose)** au lieu de « orange » : le seul orange des thèmes (`--serie-3` ambre) est déjà la couleur des chokepoints — collision de sémantique sur la même carte.
4. **Panneau détail trié par mentions décroissantes** (importance médiatique), pas par « intensité » : Goldstein est une échelle de type d'acte, pas un score d'importance d'un événement donné.
5. **Dédoublonnage par `GlobalEventID`** (clé primaire GDELT) plutôt que « position arrondie + racine » : plus fiable à l'ingestion ; l'agrégation par cellule fusionne de toute façon l'affichage.
6. **« Légende avec toggles » = la rangée de chips existante étendue** (pastilles colorées + aria-pressed, pattern déjà en place) + pied `NoteSource` pour les âges — pas de nouvelle bande de légende redondante en pied.

## Carte des fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `apps/daemon/src/zip.ts` (+ test) | Créer | Dézippage minimal d'un .zip GDELT mono-fichier |
| `apps/daemon/src/gdelt.ts` (+ test) | Créer | Parse/filtre/catégorisation des lignes 61 col. + agrégation grille |
| `apps/daemon/src/ucdp.ts` (+ test) | Créer | Parseur CSV RFC 4180, choix du fichier candidat, agrégation zones |
| `apps/daemon/src/globe.ts` (+ test) | Créer | Table SQLite, ingestion/purge, routes `/globe/*`, boucle 15 min, instantané stale UCDP |
| `apps/daemon/src/fixtures/…` | Créer | Zip GDELT réel + extrait CSV UCDP réel |
| `apps/daemon/src/index.ts` | Modifier | `enregistrerGlobe(routeur)` + `demarrerBoucleGlobe()` |
| `apps/web/src/data/daemon.ts` | Modifier | Export `urlDaemon(chemin)` |
| `apps/web/src/data/globe/types.ts` | Modifier | Types partagés des 3 nouvelles couches |
| `apps/web/src/data/globe/gdelt.ts` (+ test) | Créer | `parseEvenements`/`chargerEvenements`/`chargerZoneEvenements` |
| `apps/web/src/data/globe/ucdp.ts` (+ test) | Créer | `parseConflitsUcdp`/`chargerConflitsUcdp` |
| `apps/web/src/data/globe/isw.ts` (+ test) | Créer | `parseFrontIsw`/`chargerFrontIsw` (direct, cache 6 h pattern portwatch) |
| `apps/web/src/lib/globeRender.ts` (+ test) | Modifier | Tokens étendus, cibles multi-couches, rayons/couleurs/halo, dessin 3 couches, libellés |
| `apps/web/src/store/globe-ui.ts` | Modifier | 3 couches, mots-clés palette |
| `apps/web/src/components/GlobeWindow.tsx` | Modifier | Chargements gated, chips, pied enrichi, clic→panneau |
| `apps/web/src/components/globeWindow.util.ts` (+ test) | Créer | Textes purs du pied de fenêtre et du panneau |
| `apps/web/src/components/GlobeDetailPanel.tsx` | Créer | Panneau latéral détail (markup seul) |

---

### Task 1: Dézippage ZIP minimal côté daemon (`zip.ts`)

**Files:**
- Create: `apps/daemon/src/zip.ts`
- Create: `apps/daemon/src/zip.test.ts`
- Create: `apps/daemon/src/fixtures/gdelt-tranche-20260712001500.export.CSV.zip` (copie depuis le scratchpad, cf. « Faits amont »)

**Interfaces:**
- Consomme : `node:zlib` (`inflateRawSync`, `deflateRawSync` pour le test).
- Produit : `extraireFichierZip(zip: Uint8Array): Uint8Array` — utilisé par Task 5 (`rafraichirGdelt`).

- [ ] **Step 1: Copier la fixture réelle**

```bash
mkdir -p ~/axiom/apps/daemon/src/fixtures
cp "/private/tmp/claude-501/-Users-zakichair/00cf0e45-d667-4fbb-8a68-c25ab7caa7e1/scratchpad/gdelt-tranche-20260712001500.export.CSV.zip" ~/axiom/apps/daemon/src/fixtures/
md5 ~/axiom/apps/daemon/src/fixtures/gdelt-tranche-20260712001500.export.CSV.zip
```
Attendu : `62d4b8e0437c72927200ece0e6fdd8c4`. (Repli si scratchpad disparu : `curl -s -o <fixture> "http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip"` — archive GDELT stable.)

- [ ] **Step 2: Écrire le test qui échoue** (`apps/daemon/src/zip.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { extraireFichierZip } from "./zip";

/** Construit un .zip mono-fichier minimal (en-tête local + données DEFLATE brutes). */
function construireZip(nomFichier: string, contenu: string): Uint8Array {
  const donnees = new Uint8Array(deflateRawSync(Buffer.from(contenu, "utf8")));
  const nom = new TextEncoder().encode(nomFichier);
  const entete = new Uint8Array(30 + nom.length);
  const dv = new DataView(entete.buffer);
  dv.setUint32(0, 0x04034b50, true); // signature en-tête local
  dv.setUint16(8, 8, true); // méthode 8 = DEFLATE
  dv.setUint32(18, donnees.length, true); // taille compressée
  dv.setUint32(22, contenu.length, true); // taille décompressée
  dv.setUint16(26, nom.length, true);
  entete.set(nom, 30);
  const zip = new Uint8Array(entete.length + donnees.length);
  zip.set(entete, 0);
  zip.set(donnees, entete.length);
  return zip;
}

describe("extraireFichierZip", () => {
  test("dézippe un zip mono-fichier DEFLATE construit à la main", () => {
    const zip = construireZip("hello.csv", "a\tb\tc\nd\te\tf\n");
    expect(new TextDecoder().decode(extraireFichierZip(zip))).toBe("a\tb\tc\nd\te\tf\n");
  });

  test("rejette une signature inconnue", () => {
    expect(() => extraireFichierZip(new Uint8Array(64))).toThrow("signature");
  });

  test("rejette un zip tronqué", () => {
    expect(() => extraireFichierZip(new Uint8Array(10))).toThrow("tronqué");
  });

  test("dézippe la vraie tranche GDELT (fixture du 2026-07-12)", async () => {
    const zip = new Uint8Array(
      await Bun.file(new URL("./fixtures/gdelt-tranche-20260712001500.export.CSV.zip", import.meta.url)).arrayBuffer(),
    );
    const texte = new TextDecoder().decode(extraireFichierZip(zip));
    const lignes = texte.trimEnd().split("\n");
    expect(lignes.length).toBe(1243);
    expect((lignes[0] ?? "").split("\t").length).toBe(61);
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run : `cd ~/axiom/apps/daemon && bun test src/zip.test.ts`
Attendu : FAIL — `Cannot find module './zip'` (ou équivalent).

- [ ] **Step 4: Implémenter** (`apps/daemon/src/zip.ts`)

```ts
/**
 * Lecture MINIMALE d'un .zip GDELT : un seul fichier, compressé en DEFLATE brut.
 * On parse l'en-tête local (signature PK\x03\x04) puis inflateRawSync — zéro
 * dépendance npm. Vérifié empiriquement le 2026-07-12 sur une vraie tranche
 * (20260712001500.export.CSV.zip : 1243 lignes × 61 colonnes après dézippage).
 * Les zips à data-descriptor (tailles absentes de l'en-tête local, bit 3 des
 * drapeaux) sont rejetés explicitement — GDELT n'en produit pas.
 */
import { inflateRawSync } from "node:zlib";

const SIGNATURE_LOCALE = 0x04034b50;
const METHODE_STOCKE = 0;
const METHODE_DEFLATE = 8;

/** Extrait (et décompresse si besoin) le premier fichier d'un .zip mono-fichier. */
export function extraireFichierZip(zip: Uint8Array): Uint8Array {
  if (zip.byteLength < 30) throw new Error("zip tronqué (moins de 30 octets)");
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (dv.getUint32(0, true) !== SIGNATURE_LOCALE) throw new Error("signature d'en-tête local ZIP absente");
  const drapeaux = dv.getUint16(6, true);
  if ((drapeaux & 0x8) !== 0) throw new Error("zip à data-descriptor non géré");
  const methode = dv.getUint16(8, true);
  const tailleComp = dv.getUint32(18, true);
  const tailleNom = dv.getUint16(26, true);
  const tailleExtra = dv.getUint16(28, true);
  const debut = 30 + tailleNom + tailleExtra;
  if (tailleComp === 0 || debut + tailleComp > zip.byteLength) throw new Error("tailles d'en-tête local ZIP incohérentes");
  const donnees = zip.slice(debut, debut + tailleComp);
  if (methode === METHODE_STOCKE) return donnees;
  if (methode !== METHODE_DEFLATE) throw new Error(`méthode de compression zip ${methode} non gérée`);
  return new Uint8Array(inflateRawSync(donnees));
}
```

- [ ] **Step 5: Vérifier le passage**

Run : `cd ~/axiom/apps/daemon && bun test src/zip.test.ts`
Attendu : PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/axiom && git add apps/daemon/src/zip.ts apps/daemon/src/zip.test.ts apps/daemon/src/fixtures/gdelt-tranche-20260712001500.export.CSV.zip
git commit -m "feat(daemon): dézippage minimal des tranches GDELT (en-tête local + inflateRawSync)"
```

### Task 2: Parse + filtre + agrégation GDELT (`gdelt.ts` daemon)

**Files:**
- Create: `apps/daemon/src/gdelt.ts`
- Create: `apps/daemon/src/gdelt.test.ts`

**Interfaces:**
- Consomme : rien (module pur).
- Produit (utilisé par Task 4/5) :
  - `type CategorieEvenement = "materiel" | "coercition" | "protestation"`
  - `interface EvenementGdelt { idGdelt: string; dateMs: number; lat: number; lon: number; codeCameo: string; racine: string; quadClass: number; goldstein: number; mentions: number; acteur1: string | null; acteur2: string | null; url: string | null; categorie: CategorieEvenement }`
  - `categoriePourRacine(racine: string): CategorieEvenement | null`
  - `parseDateGdelt(brut: string): number | null`
  - `parseLigneGdelt(ligne: string): EvenementGdelt | null`
  - `parseTrancheGdelt(tsv: string): EvenementGdelt[]`
  - `GRILLE_DEG = 0.5` ; `cleGrille(v: number): number`
  - `interface CelluleEvenements { lat: number; lon: number; categorie: CategorieEvenement; n: number; intensite: number; mentions: number; dernierMs: number }`
  - `agregerEvenements(evenements: readonly EvenementGdelt[]): CelluleEvenements[]`

- [ ] **Step 1: Écrire le test qui échoue** (`apps/daemon/src/gdelt.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { extraireFichierZip } from "./zip";
import {
  agregerEvenements,
  categoriePourRacine,
  cleGrille,
  parseDateGdelt,
  parseLigneGdelt,
  parseTrancheGdelt,
} from "./gdelt";

/** Fabrique une ligne GDELT 61 colonnes avec surcharges par index (0-based). */
function ligne(patch: Record<number, string>): string {
  const c: string[] = new Array(61).fill("");
  c[0] = "1234567890"; // GlobalEventID
  c[26] = "190"; // EventCode
  c[28] = "19"; // EventRootCode (Fight)
  c[29] = "4"; // QuadClass
  c[30] = "-10.0"; // GoldsteinScale
  c[31] = "4"; // NumMentions
  c[56] = "48.45"; // ActionGeo_Lat
  c[57] = "35.02"; // ActionGeo_Long
  c[59] = "20260712001500"; // DATEADDED
  c[60] = "https://exemple.test/article";
  for (const [i, v] of Object.entries(patch)) c[Number(i)] = v;
  return c.join("\t");
}

describe("categoriePourRacine", () => {
  test("mappe 14→protestation, 15/16/17→coercition, 18/19/20→materiel, reste→null", () => {
    expect(categoriePourRacine("14")).toBe("protestation");
    expect(categoriePourRacine("15")).toBe("coercition");
    expect(categoriePourRacine("16")).toBe("coercition");
    expect(categoriePourRacine("17")).toBe("coercition");
    expect(categoriePourRacine("18")).toBe("materiel");
    expect(categoriePourRacine("19")).toBe("materiel");
    expect(categoriePourRacine("20")).toBe("materiel");
    expect(categoriePourRacine("13")).toBeNull();
    expect(categoriePourRacine("04")).toBeNull();
    expect(categoriePourRacine("")).toBeNull();
  });
});

describe("parseDateGdelt", () => {
  test("convertit YYYYMMDDHHMMSS (UTC) en epoch ms", () => {
    expect(parseDateGdelt("20260712001500")).toBe(Date.UTC(2026, 6, 12, 0, 15, 0));
  });
  test("rejette les formats invalides", () => {
    expect(parseDateGdelt("")).toBeNull();
    expect(parseDateGdelt("2026-07-12")).toBeNull();
  });
});

describe("parseLigneGdelt", () => {
  test("parse une ligne de combat complète", () => {
    const evt = parseLigneGdelt(ligne({ 6: "RUSSIA", 16: "UKRAINE" }));
    expect(evt).toEqual({
      idGdelt: "1234567890",
      dateMs: Date.UTC(2026, 6, 12, 0, 15, 0),
      lat: 48.45,
      lon: 35.02,
      codeCameo: "190",
      racine: "19",
      quadClass: 4,
      goldstein: -10,
      mentions: 4,
      acteur1: "RUSSIA",
      acteur2: "UKRAINE",
      url: "https://exemple.test/article",
      categorie: "materiel",
    });
  });
  test("rejette racine hors 14-20, géoloc vide, date invalide, nb de colonnes ≠ 61", () => {
    expect(parseLigneGdelt(ligne({ 28: "04" }))).toBeNull();
    expect(parseLigneGdelt(ligne({ 56: "" }))).toBeNull();
    expect(parseLigneGdelt(ligne({ 57: "" }))).toBeNull();
    expect(parseLigneGdelt(ligne({ 59: "hier" }))).toBeNull();
    expect(parseLigneGdelt("a\tb\tc")).toBeNull();
  });
  test("acteurs/url vides deviennent null, mentions invalides deviennent 0", () => {
    const evt = parseLigneGdelt(ligne({ 31: "n/a", 60: "" }));
    expect(evt?.acteur1).toBeNull();
    expect(evt?.acteur2).toBeNull();
    expect(evt?.url).toBeNull();
    expect(evt?.mentions).toBe(0);
  });
});

describe("parseTrancheGdelt sur la VRAIE tranche (fixture 2026-07-12)", () => {
  test("retient exactement 194 événements, répartition par racine connue", async () => {
    const zip = new Uint8Array(
      await Bun.file(new URL("./fixtures/gdelt-tranche-20260712001500.export.CSV.zip", import.meta.url)).arrayBuffer(),
    );
    const evenements = parseTrancheGdelt(new TextDecoder().decode(extraireFichierZip(zip)));
    expect(evenements.length).toBe(194);
    const parRacine = new Map<string, number>();
    for (const e of evenements) parRacine.set(e.racine, (parRacine.get(e.racine) ?? 0) + 1);
    expect(parRacine.get("14")).toBe(14);
    expect(parRacine.get("19")).toBe(90);
    expect(parRacine.get("20")).toBe(4);
  });
});

describe("agrégation grille 0,5°", () => {
  test("cleGrille arrondit au demi-degré", () => {
    expect(cleGrille(48.45)).toBe(48.5);
    expect(cleGrille(35.02)).toBe(35);
    expect(cleGrille(-0.26)).toBe(-0.5);
  });
  test("agrège par (cellule, catégorie) : n, mentions sommées, intensité max, dernierMs max", () => {
    const a = parseLigneGdelt(ligne({ 0: "1", 30: "-8.0", 31: "3", 59: "20260712001500" }));
    const b = parseLigneGdelt(ligne({ 0: "2", 30: "-10.0", 31: "5", 59: "20260712003000" }));
    const c = parseLigneGdelt(ligne({ 0: "3", 28: "14", 29: "3" })); // protestation, même cellule
    const d = parseLigneGdelt(ligne({ 0: "4", 56: "10.0", 57: "10.0" })); // autre cellule
    if (a === null || b === null || c === null || d === null) throw new Error("fixture invalide");
    const cellules = agregerEvenements([a, b, c, d]);
    expect(cellules.length).toBe(3);
    const combat = cellules.find((x) => x.categorie === "materiel" && x.lat === 48.5);
    expect(combat).toEqual({
      lat: 48.5, lon: 35, categorie: "materiel",
      n: 2, intensite: 10, mentions: 8, dernierMs: Date.UTC(2026, 6, 12, 0, 30, 0),
    });
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `cd ~/axiom/apps/daemon && bun test src/gdelt.test.ts`
Attendu : FAIL — module `./gdelt` introuvable.

- [ ] **Step 3: Implémenter** (`apps/daemon/src/gdelt.ts`)

```ts
/**
 * GDELT Event Database 2.0 — parse des tranches 15 min (CSV tabulé, 61 colonnes
 * SANS en-tête, indices vérifiés empiriquement le 2026-07-12 sur une vraie
 * tranche), filtre « tension géopolitique » (racines CAMEO 14-20 : protestations,
 * posture de force, réduction de relations, coercition, assauts, combats,
 * violence de masse — les racines 01-13, coopération et conflit verbal
 * diplomatique, sont du bruit pour une carte) et agrégation sur grille 0,5°.
 * Module PUR : aucune E/S, tout est testable sans réseau ni disque.
 */

/** Catégorie de rendu d'un événement (regroupement de racines CAMEO). */
export type CategorieEvenement = "materiel" | "coercition" | "protestation";

/** Événement GDELT filtré et géolocalisé. */
export interface EvenementGdelt {
  idGdelt: string;
  dateMs: number;
  lat: number;
  lon: number;
  codeCameo: string;
  racine: string;
  quadClass: number;
  goldstein: number;
  mentions: number;
  acteur1: string | null;
  acteur2: string | null;
  url: string | null;
  categorie: CategorieEvenement;
}

/** 14 = protestation ; 15-17 = coercition/posture ; 18-20 = conflit matériel ; reste = écarté. */
export function categoriePourRacine(racine: string): CategorieEvenement | null {
  if (racine === "14") return "protestation";
  if (racine === "15" || racine === "16" || racine === "17") return "coercition";
  if (racine === "18" || racine === "19" || racine === "20") return "materiel";
  return null;
}

/** `YYYYMMDDHHMMSS` (UTC, colonne DATEADDED) → epoch ms, null si malformé. */
export function parseDateGdelt(brut: string): number | null {
  if (!/^\d{14}$/.test(brut)) return null;
  return Date.UTC(
    Number(brut.slice(0, 4)),
    Number(brut.slice(4, 6)) - 1,
    Number(brut.slice(6, 8)),
    Number(brut.slice(8, 10)),
    Number(brut.slice(10, 12)),
    Number(brut.slice(12, 14)),
  );
}

/** Chaîne vide → null (les colonnes GDELT absentes sont des chaînes vides). */
function ouNull(v: string | undefined): string | null {
  return v === undefined || v === "" ? null : v;
}

/** Parse une ligne 61 colonnes ; null si hors filtre ou malformée. */
export function parseLigneGdelt(ligne: string): EvenementGdelt | null {
  const c = ligne.split("\t");
  if (c.length !== 61) return null;
  const racine = c[28] ?? "";
  const categorie = categoriePourRacine(racine);
  if (categorie === null) return null;
  const latBrut = c[56] ?? "";
  const lonBrut = c[57] ?? "";
  if (latBrut === "" || lonBrut === "") return null;
  const lat = Number(latBrut);
  const lon = Number(lonBrut);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const dateMs = parseDateGdelt(c[59] ?? "");
  if (dateMs === null) return null;
  const goldstein = Number(c[30]);
  const mentions = Number(c[31]);
  return {
    idGdelt: c[0] ?? "",
    dateMs,
    lat,
    lon,
    codeCameo: c[26] ?? "",
    racine,
    quadClass: Number(c[29]) || 0,
    goldstein: Number.isFinite(goldstein) ? goldstein : 0,
    mentions: Number.isFinite(mentions) && mentions > 0 ? Math.trunc(mentions) : 0,
    acteur1: ouNull(c[6]),
    acteur2: ouNull(c[16]),
    url: ouNull(c[60]),
    categorie,
  };
}

/** Parse une tranche complète (tolère \r\n et lignes vides). */
export function parseTrancheGdelt(tsv: string): EvenementGdelt[] {
  const evenements: EvenementGdelt[] = [];
  for (const brute of tsv.split("\n")) {
    const ligne = brute.endsWith("\r") ? brute.slice(0, -1) : brute;
    if (ligne === "") continue;
    const evt = parseLigneGdelt(ligne);
    if (evt !== null) evenements.push(evt);
  }
  return evenements;
}

/** Pas de la grille d'agrégation (degrés). Partagé avec l'agrégation UCDP. */
export const GRILLE_DEG = 0.5;

/** Arrondit une coordonnée au pas de grille. */
export function cleGrille(v: number): number {
  return Math.round(v / GRILLE_DEG) * GRILLE_DEG;
}

/** Cellule agrégée servie au front (COPIE VERBATIM côté web : data/globe/types.ts). */
export interface CelluleEvenements {
  lat: number;
  lon: number;
  categorie: CategorieEvenement;
  n: number;
  /** max de |GoldsteinScale| borné [0, 10] sur la cellule. */
  intensite: number;
  mentions: number;
  dernierMs: number;
}

/** Agrège par (cellule 0,5°, catégorie). Ordre de sortie stable (clé croissante). */
export function agregerEvenements(evenements: readonly EvenementGdelt[]): CelluleEvenements[] {
  const cellules = new Map<string, CelluleEvenements>();
  for (const e of evenements) {
    const lat = cleGrille(e.lat);
    const lon = cleGrille(e.lon);
    const cle = `${lat}|${lon}|${e.categorie}`;
    const intensite = Math.min(10, Math.abs(e.goldstein));
    const existante = cellules.get(cle);
    if (existante === undefined) {
      cellules.set(cle, { lat, lon, categorie: e.categorie, n: 1, intensite, mentions: e.mentions, dernierMs: e.dateMs });
    } else {
      existante.n += 1;
      existante.mentions += e.mentions;
      existante.intensite = Math.max(existante.intensite, intensite);
      existante.dernierMs = Math.max(existante.dernierMs, e.dateMs);
    }
  }
  return [...cellules.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom/apps/daemon && bun test src/gdelt.test.ts`
Attendu : PASS. Si le compte 194 diffère : NE PAS ajuster le test au hasard — re-dériver le compte attendu depuis la fixture (`awk -F'\t' '$29>="14" && $29<="20" && length($29)==2 && $57!="" && $58!="" && $60 ~ /^[0-9]{14}$/' | wc -l` sur le CSV dézippé ; awk est 1-based) et comprendre l'écart.

- [ ] **Step 5: Commit**

```bash
cd ~/axiom && git add apps/daemon/src/gdelt.ts apps/daemon/src/gdelt.test.ts
git commit -m "feat(daemon): parse/filtre/agrégation GDELT (racines CAMEO 14-20, grille 0,5°)"
```

### Task 3: Parseur CSV RFC 4180 + choix de fichier + agrégation UCDP (`ucdp.ts` daemon)

**Files:**
- Create: `apps/daemon/src/ucdp.ts`
- Create: `apps/daemon/src/ucdp.test.ts`
- Create: `apps/daemon/src/fixtures/ucdp-extrait.csv` (copie depuis le scratchpad : `ucdp-fixture.csv`, en-tête 49 colonnes + 20 enregistrements réels réécrits proprement)

**Interfaces:**
- Consomme : `cleGrille` de `./gdelt`.
- Produit (utilisé par Task 5) :
  - `parseCsv(texte: string): string[][]` — RFC 4180 (quotes, `""` échappés, virgules ET retours ligne dans les champs, CRLF)
  - `choisirFichierCandidat(html: string): string | null` — ex. `"GEDEvent_v26_0_5.csv"`
  - `interface ZoneConflitUcdp { lat: number; lon: number; morts: number; n: number; sideA: string | null; sideB: string | null; dernierMs: number }`
  - `agregerUcdp(lignes: readonly string[][]): ZoneConflitUcdp[]` — 1ʳᵉ ligne = en-tête, résolution des colonnes PAR NOM

- [ ] **Step 1: Copier la fixture réelle**

```bash
cp "/private/tmp/claude-501/-Users-zakichair/00cf0e45-d667-4fbb-8a68-c25ab7caa7e1/scratchpad/ucdp-fixture.csv" ~/axiom/apps/daemon/src/fixtures/ucdp-extrait.csv
wc -l ~/axiom/apps/daemon/src/fixtures/ucdp-extrait.csv
```
Attendu : 21 lignes physiques ou plus (20 enregistrements — certains champs contiennent des retours ligne ; c'est le nombre de RECORDS parsés qui doit faire 20, pas le nombre de lignes physiques).

- [ ] **Step 2: Écrire le test qui échoue** (`apps/daemon/src/ucdp.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { agregerUcdp, choisirFichierCandidat, parseCsv } from "./ucdp";

describe("parseCsv (RFC 4180)", () => {
  test("champs simples, CRLF et ligne finale sans retour", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
  test("champs quotés : virgules, guillemets échappés et retours ligne INTERNES", () => {
    expect(parseCsv('a,"x, y",fin\n1,"il a dit ""non""\nsur deux lignes",2')).toEqual([
      ["a", "x, y", "fin"],
      ["1", 'il a dit "non"\nsur deux lignes', "2"],
    ]);
  });
  test("champs vides conservés", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });
});

describe("choisirFichierCandidat", () => {
  test("choisit la version mensuelle la plus récente, ignore les fichiers trimestriels à 4 nombres", () => {
    const html = `
      <a href="candidateged/GEDEvent_v26_01_26_03.csv">t</a>
      <a href="candidateged/GEDEvent_v26_0_4.csv">a</a>
      <a href="candidateged/GEDEvent_v26_0_5.csv">b</a>`;
    expect(choisirFichierCandidat(html)).toBe("GEDEvent_v26_0_5.csv");
  });
  test("null si aucun fichier trouvé", () => {
    expect(choisirFichierCandidat("<html>rien</html>")).toBeNull();
  });
});

describe("agregerUcdp", () => {
  const ENTETE = ["id", "latitude", "longitude", "best", "side_a", "side_b", "date_start"];
  test("agrège par cellule 0,5° : morts sommés, n compté, acteurs du pire événement, dernierMs max", () => {
    const zones = agregerUcdp([
      ENTETE,
      ["1", "48.6", "35.1", "12", "Armée A", "Armée B", "2026-05-05 00:00:00.000"],
      ["2", "48.4", "34.9", "30", "Armée A", "Milice C", "2026-05-20 00:00:00.000"],
      ["3", "10.0", "10.0", "0", "X", "Y", "2026-05-01 00:00:00.000"],
    ]);
    expect(zones.length).toBe(2);
    const donbass = zones.find((z) => z.lat === 48.5);
    expect(donbass).toEqual({
      lat: 48.5, lon: 35, morts: 42, n: 2,
      sideA: "Armée A", sideB: "Milice C", // acteurs de l'événement le plus meurtrier (30 morts)
      dernierMs: Date.UTC(2026, 4, 20),
    });
  });
  test("ignore les lignes sans coordonnées valides et tolère best vide", () => {
    const zones = agregerUcdp([ENTETE, ["1", "", "35", "5", "A", "B", "2026-05-05 00:00:00.000"], ["2", "48", "35", "", "A", "B", "2026-05-05 00:00:00.000"]]);
    expect(zones.length).toBe(1);
    expect(zones[0]?.morts).toBe(0);
  });
  test("parse la VRAIE fixture UCDP (20 enregistrements, 49 colonnes)", async () => {
    const texte = await Bun.file(new URL("./fixtures/ucdp-extrait.csv", import.meta.url)).text();
    const lignes = parseCsv(texte);
    expect(lignes.length).toBe(21); // en-tête + 20 records
    expect(lignes[0]?.length).toBe(49);
    expect(lignes[0]?.[29]).toBe("latitude");
    const zones = agregerUcdp(lignes);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(Number.isFinite(z.lat)).toBe(true);
      expect(z.morts).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run : `cd ~/axiom/apps/daemon && bun test src/ucdp.test.ts`
Attendu : FAIL — module `./ucdp` introuvable.

- [ ] **Step 4: Implémenter** (`apps/daemon/src/ucdp.ts`)

```ts
/**
 * UCDP Candidate GED — le CSV mensuel (https://ucdp.uu.se/downloads/candidateged/)
 * porte un nom VERSIONNÉ (GEDEvent_v26_0_5.csv…) découvert en scrapant la page
 * d'index. Champs quotés RFC 4180 (virgules, "" échappés, retours ligne DANS
 * les champs source_article — vérifié empiriquement le 2026-07-12, 1686
 * enregistrements × 49 colonnes). Colonnes résolues PAR NOM d'en-tête.
 * Agrégation sur la même grille 0,5° que GDELT. Module PUR.
 */
import { cleGrille } from "./gdelt";

/** Parseur CSV RFC 4180 minimal (état : dans/hors guillemets). */
export function parseCsv(texte: string): string[][] {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (dansGuillemets) {
      if (ch === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; } else dansGuillemets = false;
      } else champ += ch;
    } else if (ch === '"') {
      dansGuillemets = true;
    } else if (ch === ",") {
      ligne.push(champ); champ = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      lignes.push(ligne); ligne = [];
    } else champ += ch;
  }
  if (champ !== "" || ligne.length > 0) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

/**
 * Repère le fichier candidat mensuel le plus récent dans le HTML de la page
 * d'index. Motif à 3 nombres (v<année>_<x>_<mois>) ; les fichiers trimestriels
 * consolidés à 4 nombres (GEDEvent_v26_01_26_03.csv) ne matchent pas ce motif.
 */
export function choisirFichierCandidat(html: string): string | null {
  const motif = /candidateged\/(GEDEvent_v(\d+)_(\d+)_(\d+)\.csv)/g;
  let meilleur: { nom: string; score: number } | null = null;
  for (const m of html.matchAll(motif)) {
    const score = Number(m[2]) * 1_000_000 + Number(m[3]) * 1_000 + Number(m[4]);
    if (meilleur === null || score > meilleur.score) meilleur = { nom: m[1] ?? "", score };
  }
  return meilleur?.nom ?? null;
}

/** Zone de conflit agrégée (COPIE VERBATIM côté web : data/globe/types.ts). */
export interface ZoneConflitUcdp {
  lat: number;
  lon: number;
  morts: number;
  n: number;
  sideA: string | null;
  sideB: string | null;
  dernierMs: number;
}

/** `2026-05-05 00:00:00.000` → epoch ms UTC, null si malformé. */
function parseDateUcdp(brut: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(brut);
  if (m === null) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Agrège les enregistrements (1ʳᵉ ligne = en-tête) par cellule 0,5°. */
export function agregerUcdp(lignes: readonly string[][]): ZoneConflitUcdp[] {
  const entete = lignes[0];
  if (entete === undefined) return [];
  const iLat = entete.indexOf("latitude");
  const iLon = entete.indexOf("longitude");
  const iMorts = entete.indexOf("best");
  const iSideA = entete.indexOf("side_a");
  const iSideB = entete.indexOf("side_b");
  const iDate = entete.indexOf("date_start");
  if (iLat < 0 || iLon < 0 || iMorts < 0) return [];
  const zones = new Map<string, ZoneConflitUcdp & { pireMorts: number }>();
  for (const l of lignes.slice(1)) {
    const lat = Number(l[iLat]);
    const lon = Number(l[iLon]);
    if (l[iLat] === "" || l[iLon] === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const morts = Math.max(0, Math.trunc(Number(l[iMorts]) || 0));
    const dateMs = parseDateUcdp(l[iDate] ?? "") ?? 0;
    const cLat = cleGrille(lat);
    const cLon = cleGrille(lon);
    const cle = `${cLat}|${cLon}`;
    const sideA = (l[iSideA] ?? "") === "" ? null : (l[iSideA] as string);
    const sideB = (l[iSideB] ?? "") === "" ? null : (l[iSideB] as string);
    const z = zones.get(cle);
    if (z === undefined) {
      zones.set(cle, { lat: cLat, lon: cLon, morts, n: 1, sideA, sideB, dernierMs: dateMs, pireMorts: morts });
    } else {
      z.morts += morts;
      z.n += 1;
      z.dernierMs = Math.max(z.dernierMs, dateMs);
      if (morts >= z.pireMorts) { z.pireMorts = morts; z.sideA = sideA; z.sideB = sideB; }
    }
  }
  return [...zones.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, { pireMorts: _p, ...zone }]) => zone);
}
```

- [ ] **Step 5: Vérifier le passage**

Run : `cd ~/axiom/apps/daemon && bun test src/ucdp.test.ts`
Attendu : PASS. Si le test fixture échoue sur `lignes.length` : vérifier que la fixture a bien été réécrite par le module `csv` Python (records complets) et compter les RECORDS, pas les lignes physiques.

- [ ] **Step 6: Commit**

```bash
cd ~/axiom && git add apps/daemon/src/ucdp.ts apps/daemon/src/ucdp.test.ts apps/daemon/src/fixtures/ucdp-extrait.csv
git commit -m "feat(daemon): parseur CSV RFC 4180 + découverte du fichier UCDP + agrégation zones"
```

### Task 4: Table SQLite + routes de lecture `/globe/evenements` (`globe.ts` daemon, 1/2)

**Files:**
- Create: `apps/daemon/src/globe.ts`
- Create: `apps/daemon/src/globe.test.ts`

**Interfaces:**
- Consomme : `EvenementGdelt`, `CelluleEvenements`, `agregerEvenements`, `cleGrille` de `./gdelt` ; `entetesCors` de `./cors` ; `getDb` de `./db` ; `Database` de `bun:sqlite`.
- Produit (utilisé par Task 5 et par le front Task 6) :
  - `assurerTablesGlobe(d: Database): void` — `CREATE TABLE IF NOT EXISTS` inconditionnel (pas de flag module : les tests injectent des bases `:memory:` distinctes)
  - `ingererEvenements(d: Database, evenements: readonly EvenementGdelt[]): number` (INSERT OR IGNORE sur `idGdelt`, transaction)
  - `purgerEvenements(d: Database, now: number, retentionH?: number): number` (défaut 48 h)
  - `lireMeta(d: Database, cle: string): { corps: string; majA: number } | null` / `ecrireMeta(d: Database, cle: string, corps: string, majA: number): void` (table `globe_instantanes`)
  - `traiterGlobe(req: Request, url: URL, dInjecte?: Database, now?: number): Promise<Response>`
  - Contrat JSON `GET /globe/evenements?fenetreH=24` (clamp [1, 48]) :
    `{ majA: number | null, couverture: { deMs: number, aMs: number } | null, cellules: CelluleEvenements[] }`
  - Contrat JSON `GET /globe/evenements/zone?lat=<0,5°>&lon=<0,5°>&fenetreH=24` :
    `{ evenements: Array<{ dateMs, categorie, codeCameo, goldstein, mentions, acteur1, acteur2, url }> }` (top 20 par mentions décroissantes)

- [ ] **Step 1: Écrire le test qui échoue** (`apps/daemon/src/globe.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { EvenementGdelt } from "./gdelt";
import { assurerTablesGlobe, ingererEvenements, lireMeta, ecrireMeta, purgerEvenements, traiterGlobe } from "./globe";

const T0 = Date.UTC(2026, 6, 12, 12, 0, 0);

function evt(patch: Partial<EvenementGdelt>): EvenementGdelt {
  return {
    idGdelt: "1", dateMs: T0, lat: 48.45, lon: 35.02, codeCameo: "190", racine: "19",
    quadClass: 4, goldstein: -10, mentions: 4, acteur1: "A", acteur2: "B",
    url: "https://exemple.test", categorie: "materiel", ...patch,
  };
}

function baseTest(): Database {
  const d = new Database(":memory:");
  assurerTablesGlobe(d);
  return d;
}

describe("ingestion / purge", () => {
  test("insère, dédoublonne par idGdelt, purge au-delà de la rétention", () => {
    const d = baseTest();
    expect(ingererEvenements(d, [evt({ idGdelt: "1" }), evt({ idGdelt: "2" })])).toBe(2);
    expect(ingererEvenements(d, [evt({ idGdelt: "2" }), evt({ idGdelt: "3" })])).toBe(1);
    const vieux = evt({ idGdelt: "4", dateMs: T0 - 72 * 3_600_000 });
    ingererEvenements(d, [vieux]);
    expect(purgerEvenements(d, T0)).toBe(1); // rétention 48 h par défaut
  });
});

describe("meta (globe_instantanes)", () => {
  test("écrit puis relit un instantané avec son majA", () => {
    const d = baseTest();
    expect(lireMeta(d, "ucdp")).toBeNull();
    ecrireMeta(d, "ucdp", '{"zones":[]}', T0);
    expect(lireMeta(d, "ucdp")).toEqual({ corps: '{"zones":[]}', majA: T0 });
  });
});

describe("traiterGlobe — gardes (AVANT tout accès base)", () => {
  test("405 hors GET, 404 chemin inconnu", async () => {
    const res405 = await traiterGlobe(new Request("http://x/globe/evenements", { method: "POST" }), new URL("http://x/globe/evenements"));
    expect(res405.status).toBe(405);
    const res404 = await traiterGlobe(new Request("http://x/globe/nimporte"), new URL("http://x/globe/nimporte"));
    expect(res404.status).toBe(404);
  });
});

describe("GET /globe/evenements", () => {
  test("agrège la fenêtre demandée et renvoie majA + couverture", async () => {
    const d = baseTest();
    ingererEvenements(d, [
      evt({ idGdelt: "1", dateMs: T0 - 3_600_000 }),
      evt({ idGdelt: "2", dateMs: T0 - 2 * 3_600_000, mentions: 6 }),
      evt({ idGdelt: "3", dateMs: T0 - 30 * 3_600_000 }), // hors fenêtre 24 h
    ]);
    ecrireMeta(d, "gdelt", "{}", T0);
    const url = new URL("http://x/globe/evenements?fenetreH=24");
    const res = await traiterGlobe(new Request(url), url, d, T0);
    expect(res.status).toBe(200);
    const corps = (await res.json()) as { majA: number | null; couverture: { deMs: number; aMs: number } | null; cellules: unknown[] };
    expect(corps.majA).toBe(T0);
    expect(corps.couverture).toEqual({ deMs: T0 - 2 * 3_600_000, aMs: T0 - 3_600_000 });
    expect(corps.cellules.length).toBe(1); // même cellule, même catégorie
  });
  test("base vide → cellules [], couverture null (jamais d'erreur)", async () => {
    const url = new URL("http://x/globe/evenements");
    const res = await traiterGlobe(new Request(url), url, baseTest(), T0);
    expect(((await res.json()) as { cellules: unknown[]; couverture: null }).couverture).toBeNull();
  });
});

describe("GET /globe/evenements/zone", () => {
  test("renvoie les événements de la cellule triés par mentions, plafonnés à 20", async () => {
    const d = baseTest();
    const beaucoup: EvenementGdelt[] = [];
    for (let i = 0; i < 25; i++) beaucoup.push(evt({ idGdelt: `z${i}`, mentions: i }));
    beaucoup.push(evt({ idGdelt: "ailleurs", lat: 10, lon: 10, mentions: 999 }));
    ingererEvenements(d, beaucoup);
    const url = new URL("http://x/globe/evenements/zone?lat=48.5&lon=35&fenetreH=24");
    const res = await traiterGlobe(new Request(url), url, d, T0);
    const corps = (await res.json()) as { evenements: Array<{ mentions: number }> };
    expect(corps.evenements.length).toBe(20);
    expect(corps.evenements[0]?.mentions).toBe(24); // pas le 999 d'une autre cellule
  });
  test("400 si lat/lon absents ou non numériques", async () => {
    const url = new URL("http://x/globe/evenements/zone?lat=abc");
    const res = await traiterGlobe(new Request(url), url, baseTest(), T0);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `cd ~/axiom/apps/daemon && bun test src/globe.test.ts`
Attendu : FAIL — module `./globe` introuvable.

- [ ] **Step 3: Implémenter** (`apps/daemon/src/globe.ts`)

```ts
/**
 * Routes /globe/* — données géopolitiques du globe (fenêtre GLOBE du front).
 *   GET /globe/evenements?fenetreH=24        → cellules GDELT agrégées (grille 0,5°)
 *   GET /globe/evenements/zone?lat=&lon=     → détail d'une cellule (top 20 par mentions)
 *   GET /globe/conflits-ucdp                 → zones UCDP agrégées (Task 5)
 * Stockage : table `globe_evenements` (événements GDELT, rétention 48 h) et
 * `globe_instantanes` (dernier instantané par source — sert le PÉRIMÉ en cas
 * d'échec amont : « jamais d'écran vide », le cache TTL de cache.ts purge
 * l'expiré et ne convient pas). Âge exposé en champ JSON `majA` (epoch ms),
 * convention kv.ts. CREATE TABLE inconditionnel (pas de flag module) : les
 * tests injectent des bases :memory: distinctes via `dInjecte`.
 */
import { Database } from "bun:sqlite";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { agregerEvenements, cleGrille, type CategorieEvenement, type EvenementGdelt } from "./gdelt";

/** Rétention des événements GDELT (heures). */
export const RETENTION_H = 48;
/** Fenêtre servie par défaut (heures) et bornes du paramètre fenetreH. */
export const FENETRE_DEFAUT_H = 24;

export function assurerTablesGlobe(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS globe_evenements (
    idGdelt TEXT PRIMARY KEY,
    dateMs INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    categorie TEXT NOT NULL,
    codeCameo TEXT NOT NULL,
    goldstein REAL NOT NULL,
    mentions INTEGER NOT NULL,
    acteur1 TEXT,
    acteur2 TEXT,
    url TEXT
  )`);
  d.run("CREATE INDEX IF NOT EXISTS idx_globe_evenements_dateMs ON globe_evenements(dateMs)");
  d.run(`CREATE TABLE IF NOT EXISTS globe_instantanes (
    cle TEXT PRIMARY KEY,
    corps TEXT NOT NULL,
    majA INTEGER NOT NULL
  )`);
}

/** Insère en ignorant les doublons (idGdelt). Renvoie le nombre réellement inséré. */
export function ingererEvenements(d: Database, evenements: readonly EvenementGdelt[]): number {
  assurerTablesGlobe(d);
  const stmt = d.query(
    `INSERT OR IGNORE INTO globe_evenements
     (idGdelt, dateMs, lat, lon, categorie, codeCameo, goldstein, mentions, acteur1, acteur2, url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inseres = 0;
  const tx = d.transaction(() => {
    for (const e of evenements) {
      const info = stmt.run(e.idGdelt, e.dateMs, e.lat, e.lon, e.categorie, e.codeCameo, e.goldstein, e.mentions, e.acteur1, e.acteur2, e.url);
      inseres += Number(info.changes);
    }
  });
  tx();
  return inseres;
}

/** Supprime les événements plus vieux que la rétention. Renvoie le nombre purgé. */
export function purgerEvenements(d: Database, now: number, retentionH: number = RETENTION_H): number {
  assurerTablesGlobe(d);
  const info = d.query("DELETE FROM globe_evenements WHERE dateMs < ?").run(now - retentionH * 3_600_000);
  return Number(info.changes);
}

/** Lit/écrit le dernier instantané d'une source (fallback périmé + méta gdelt). */
export function lireMeta(d: Database, cle: string): { corps: string; majA: number } | null {
  assurerTablesGlobe(d);
  const ligne = d.query("SELECT corps, majA FROM globe_instantanes WHERE cle = ?").get(cle) as { corps: string; majA: number } | null;
  return ligne;
}

export function ecrireMeta(d: Database, cle: string, corps: string, majA: number): void {
  assurerTablesGlobe(d);
  d.query("INSERT OR REPLACE INTO globe_instantanes (cle, corps, majA) VALUES (?, ?, ?)").run(cle, corps, majA);
}

/** Helper JSON + CORS (dupliqué volontairement par module, convention kv/replay). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/** Ligne relue de globe_evenements (forme SELECT *). */
interface LigneEvenement {
  idGdelt: string; dateMs: number; lat: number; lon: number; categorie: CategorieEvenement;
  codeCameo: string; goldstein: number; mentions: number;
  acteur1: string | null; acteur2: string | null; url: string | null;
}

function fenetreDepuisQuery(url: URL): number {
  const brut = Number(url.searchParams.get("fenetreH") ?? FENETRE_DEFAUT_H);
  if (!Number.isFinite(brut)) return FENETRE_DEFAUT_H;
  return Math.min(RETENTION_H, Math.max(1, Math.trunc(brut)));
}

function repondreEvenements(req: Request, url: URL, d: Database, now: number): Response {
  const depuisMs = now - fenetreDepuisQuery(url) * 3_600_000;
  const lignes = d.query("SELECT * FROM globe_evenements WHERE dateMs >= ?").all(depuisMs) as LigneEvenement[];
  let deMs = Number.POSITIVE_INFINITY;
  let aMs = Number.NEGATIVE_INFINITY;
  for (const l of lignes) { deMs = Math.min(deMs, l.dateMs); aMs = Math.max(aMs, l.dateMs); }
  // agregerEvenements n'exige que les champs communs — les lignes SQL en ont la forme.
  const cellules = agregerEvenements(lignes.map((l) => ({ ...l, racine: "", quadClass: 0 })));
  const meta = lireMeta(d, "gdelt");
  return json(
    { majA: meta?.majA ?? null, couverture: lignes.length > 0 ? { deMs, aMs } : null, cellules },
    req,
  );
}

function repondreZone(req: Request, url: URL, d: Database, now: number): Response {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ erreur: "lat/lon requis" }, req, 400);
  const depuisMs = now - fenetreDepuisQuery(url) * 3_600_000;
  const lignes = d.query("SELECT * FROM globe_evenements WHERE dateMs >= ?").all(depuisMs) as LigneEvenement[];
  const evenements = lignes
    .filter((l) => cleGrille(l.lat) === lat && cleGrille(l.lon) === lon)
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 20)
    .map((l) => ({
      dateMs: l.dateMs, categorie: l.categorie, codeCameo: l.codeCameo, goldstein: l.goldstein,
      mentions: l.mentions, acteur1: l.acteur1, acteur2: l.acteur2, url: l.url,
    }));
  return json({ evenements }, req);
}

/** Gestionnaire des routes /globe/*. Gardes AVANT tout accès base (testables sans disque). */
export async function traiterGlobe(req: Request, url: URL, dInjecte?: Database, now?: number): Promise<Response> {
  if (req.method !== "GET") return json({ erreur: "méthode non autorisée" }, req, 405);
  const chemin = url.pathname;
  if (chemin !== "/globe/evenements" && chemin !== "/globe/evenements/zone" && chemin !== "/globe/conflits-ucdp") {
    return json({ erreur: "chemin inconnu" }, req, 404);
  }
  const d = dInjecte ?? getDb();
  const maintenant = now ?? Date.now();
  try {
    assurerTablesGlobe(d);
    if (chemin === "/globe/evenements") return repondreEvenements(req, url, d, maintenant);
    if (chemin === "/globe/evenements/zone") return repondreZone(req, url, d, maintenant);
    return await repondreConflitsUcdp(req, d, maintenant); // implémentée en Task 5
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ erreur: "erreur interne globe", detail }, req, 500);
  }
}

/** Placeholder Task 5 — la route UCDP répond 503 tant que le rafraîchissement n'existe pas. */
async function repondreConflitsUcdp(req: Request, _d: Database, _now: number): Promise<Response> {
  return json({ erreur: "non câblé (Task 5)" }, req, 503);
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom/apps/daemon && bun test src/globe.test.ts`
Attendu : PASS (8 tests). Puis `cd ~/axiom/apps/daemon && bun test src && tsc --noEmit` — tout vert.

- [ ] **Step 5: Commit**

```bash
cd ~/axiom && git add apps/daemon/src/globe.ts apps/daemon/src/globe.test.ts
git commit -m "feat(daemon): table globe_evenements + routes /globe/evenements et /zone"
```

### Task 5: Rafraîchissement GDELT/UCDP + boucle 15 min + câblage `index.ts` (`globe.ts` daemon, 2/2)

**Files:**
- Modify: `apps/daemon/src/globe.ts` (ajouts en fin de fichier + remplacement du placeholder UCDP)
- Modify: `apps/daemon/src/globe.test.ts` (ajouts)
- Modify: `apps/daemon/src/index.ts` (2 lignes : import + enregistrement, + démarrage boucle)

**Interfaces:**
- Consomme : `extraireFichierZip` de `./zip` ; `parseTrancheGdelt` de `./gdelt` ; `parseCsv`, `choisirFichierCandidat`, `agregerUcdp` de `./ucdp`.
- Produit :
  - `urlsTranches(urlDerniere: string, n: number): string[]` — la dernière + les `n-1` précédentes (pas de 15 min), pure
  - `rafraichirGdelt(d: Database, fetchImpl?: typeof fetch, now?: number): Promise<{ tranches: number; inseres: number }>`
  - `rafraichirUcdp(d: Database, fetchImpl?: typeof fetch, now?: number): Promise<boolean>`
  - `demarrerBoucleGlobe(): () => void`
  - `enregistrerGlobe(routeur: Routeur): void`
  - Contrat JSON `GET /globe/conflits-ucdp` : `{ majA: number, fichier: string, zones: ZoneConflitUcdp[] }` + en-tête `x-axiomd-cache: hit|stale` (stale = rafraîchissement échoué, instantané périmé servi)

- [ ] **Step 1: Ajouter les tests qui échouent** (append à `apps/daemon/src/globe.test.ts` — les `import` ci-dessous peuvent rester en fin de fichier, la syntaxe ESM les hisse, ou être fusionnés en tête au choix)

```ts
import { deflateRawSync } from "node:zlib";
import { demarrerBoucleGlobe, enregistrerGlobe, rafraichirGdelt, rafraichirUcdp, urlsTranches } from "./globe";
import { Routeur } from "./router";

/** Zip mono-fichier minimal (même helper que zip.test.ts — dupliqué, fixtures de test). */
function zipDe(contenu: string): Uint8Array {
  const donnees = new Uint8Array(deflateRawSync(Buffer.from(contenu, "utf8")));
  const entete = new Uint8Array(30);
  const dv = new DataView(entete.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(8, 8, true);
  dv.setUint32(18, donnees.length, true);
  const zip = new Uint8Array(30 + donnees.length);
  zip.set(entete, 0);
  zip.set(donnees, 30);
  return zip;
}

/** Ligne GDELT 61 colonnes minimale valide (racine 19, géolocalisée). */
function ligneGdeltBrute(id: string): string {
  const c: string[] = new Array(61).fill("");
  c[0] = id; c[26] = "190"; c[28] = "19"; c[29] = "4"; c[30] = "-10.0"; c[31] = "2";
  c[56] = "48.45"; c[57] = "35.02"; c[59] = "20260712001500";
  return c.join("\t");
}

describe("urlsTranches", () => {
  test("génère la tranche courante + les précédentes par pas de 15 min", () => {
    expect(urlsTranches("http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip", 3)).toEqual([
      "http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip",
      "http://data.gdeltproject.org/gdeltv2/20260712000000.export.CSV.zip",
      "http://data.gdeltproject.org/gdeltv2/20260711234500.export.CSV.zip",
    ]);
  });
  test("URL sans horodatage reconnaissable → juste elle-même", () => {
    expect(urlsTranches("http://x/bizarre.zip", 3)).toEqual(["http://x/bizarre.zip"]);
  });
});

describe("rafraichirGdelt (fetch stubé, zéro réseau)", () => {
  test("lit lastupdate, ingère les tranches manquantes, tolère un 404 individuel, écrit la méta", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    const urlZip = "http://data.gdeltproject.org/gdeltv2/20260712001500.export.CSV.zip";
    const fetchStub = (async (entree: RequestInfo | URL) => {
      const u = String(entree);
      if (u.endsWith("lastupdate.txt")) return new Response(`69666 abc ${urlZip}\nreste ignoré`);
      if (u === urlZip) return new Response(zipDe(`${ligneGdeltBrute("10")}\n${ligneGdeltBrute("11")}\n`));
      return new Response("introuvable", { status: 404 }); // tranches de backfill absentes
    }) as typeof fetch;
    const r = await rafraichirGdelt(d, fetchStub, T0);
    expect(r.inseres).toBe(2);
    expect(lireMeta(d, "gdelt")?.majA).toBe(T0);
    // Second appel : lastupdate inchangé → aucun travail.
    const r2 = await rafraichirGdelt(d, fetchStub, T0 + 1);
    expect(r2).toEqual({ tranches: 0, inseres: 0 });
  });
});

describe("rafraichirUcdp + GET /globe/conflits-ucdp", () => {
  const CSV = `latitude,longitude,best,side_a,side_b,date_start\n48.6,35.1,12,"Armée A","Armée B",2026-05-05 00:00:00.000\n`;
  function fetchUcdp(ok: boolean): typeof fetch {
    return (async (entree: RequestInfo | URL) => {
      if (!ok) return new Response("boom", { status: 500 });
      const u = String(entree);
      if (u.endsWith("index.html")) return new Response('<a href="candidateged/GEDEvent_v26_0_5.csv">x</a>');
      return new Response(CSV);
    }) as typeof fetch;
  }
  test("succès → instantané écrit, route répond hit", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    expect(await rafraichirUcdp(d, fetchUcdp(true), T0)).toBe(true);
    const url = new URL("http://x/globe/conflits-ucdp");
    const res = await traiterGlobe(new Request(url), url, d, T0);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-axiomd-cache")).toBe("hit");
    const corps = (await res.json()) as { majA: number; fichier: string; zones: unknown[] };
    expect(corps).toEqual({ majA: T0, fichier: "GEDEvent_v26_0_5.csv", zones: [{ lat: 48.5, lon: 35, morts: 12, n: 1, sideA: "Armée A", sideB: "Armée B", dernierMs: Date.UTC(2026, 4, 5) }] });
  });
  test("échec amont avec instantané présent → stale servi ; sans instantané → 502", async () => {
    const d = new Database(":memory:");
    assurerTablesGlobe(d);
    await rafraichirUcdp(d, fetchUcdp(true), T0);
    const url = new URL("http://x/globe/conflits-ucdp");
    // Instantané vieux de 25 h → la route retente, échoue, sert le périmé.
    const res = await traiterGlobe(new Request(url), url, d, T0 + 25 * 3_600_000, fetchUcdp(false));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-axiomd-cache")).toBe("stale");
    const d2 = new Database(":memory:");
    assurerTablesGlobe(d2);
    const res502 = await traiterGlobe(new Request(url), url, d2, T0, fetchUcdp(false));
    expect(res502.status).toBe(502);
  });
});

describe("enregistrerGlobe", () => {
  test("le préfixe /globe est routé", async () => {
    const routeur = new Routeur();
    enregistrerGlobe(routeur);
    const url = new URL("http://x/globe/nimporte");
    const res = await routeur.gerer(new Request(url), url);
    expect(res?.status).toBe(404); // géré par traiterGlobe (chemin inconnu), pas null
  });
});

describe("demarrerBoucleGlobe", () => {
  test("renvoie une fonction d'arrêt sans lancer de réseau immédiat bloquant", () => {
    const arreter = demarrerBoucleGlobe();
    expect(typeof arreter).toBe("function");
    arreter();
  });
});
```

Note : `traiterGlobe` gagne un 5ᵉ paramètre optionnel `fetchImpl?: typeof fetch` (défaut `fetch`) transmis à `repondreConflitsUcdp` — mettre à jour sa signature dans ce step.

- [ ] **Step 2: Vérifier l'échec**

Run : `cd ~/axiom/apps/daemon && bun test src/globe.test.ts`
Attendu : FAIL — `urlsTranches` (etc.) non exportés.

- [ ] **Step 3: Implémenter** (append à `apps/daemon/src/globe.ts`, remplacer le placeholder `repondreConflitsUcdp`)

```ts
// ————— Rafraîchissement amont (GDELT http-only, UCDP https) —————
// data.gdeltproject.org ne répond QU'EN HTTP (vérifié 2026-07-12) : c'est le
// premier amont http:// clair du daemon — impossible via /extapi (schéma https
// imposé + whitelist). Trafic localhost → amont public, aucun secret transmis.

const URL_LASTUPDATE = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const URL_INDEX_UCDP = "https://ucdp.uu.se/downloads/index.html";
const BASE_UCDP = "https://ucdp.uu.se/downloads/candidateged/";
const TIMEOUT_AMONT_MS = 15_000;
const BACKFILL_TRANCHES = 12; // 3 h d'historique au premier démarrage
const FRAICHEUR_UCDP_MS = 24 * 3_600_000;
export const INTERVALLE_BOUCLE_GLOBE_MS = 15 * 60_000;

function entetesAmont(): Record<string, string> {
  return { "user-agent": "axiom-daemon/1.0 (terminal perso)", accept: "*/*" };
}

/** URL de la tranche courante + les (n-1) précédentes, par pas de 15 min. Pure. */
export function urlsTranches(urlDerniere: string, n: number): string[] {
  const m = /^(.*\/)(\d{14})(\.export\.CSV\.zip)$/.exec(urlDerniere);
  if (m === null) return [urlDerniere];
  const [, base, horodatage, suffixe] = m;
  const dateMs = parseDateGdelt(horodatage ?? "");
  if (dateMs === null) return [urlDerniere];
  const urls: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(dateMs - i * 15 * 60_000);
    const p = (v: number, l = 2) => String(v).padStart(l, "0");
    urls.push(`${base}${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${suffixe}`);
  }
  return urls;
}
```

(ajouter `parseDateGdelt` à l'import depuis `./gdelt`, et `extraireFichierZip` depuis `./zip`, `agregerUcdp`/`choisirFichierCandidat`/`parseCsv` depuis `./ucdp`, `Routeur` depuis `./router`)

```ts
/**
 * Ingestion GDELT : lit lastupdate.txt ; si la tranche a déjà été vue → no-op.
 * Sinon ingère la tranche courante + backfill (premier démarrage : 12 tranches,
 * ensuite : celles publiées depuis la dernière vue, plafonné à 12). Un 404 sur
 * une tranche individuelle est toléré (tranche sautée). Purge la rétention puis
 * écrit la méta { url } sous la clé "gdelt" avec majA = now.
 */
export async function rafraichirGdelt(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<{ tranches: number; inseres: number }> {
  assurerTablesGlobe(d);
  const resIndex = await fetchImpl(URL_LASTUPDATE, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS) });
  if (!resIndex.ok) throw new Error(`lastupdate HTTP ${resIndex.status}`);
  const premiereLigne = (await resIndex.text()).split("\n")[0] ?? "";
  const urlZip = premiereLigne.trim().split(/\s+/)[2] ?? "";
  if (!urlZip.endsWith(".export.CSV.zip")) throw new Error("lastupdate.txt : URL de tranche introuvable");
  const meta = lireMeta(d, "gdelt");
  const derniereVue = meta === null ? null : (JSON.parse(meta.corps) as { url?: string }).url ?? null;
  if (derniereVue === urlZip) return { tranches: 0, inseres: 0 };
  // Candidates : la courante + backfill ; on s'arrête à la dernière déjà vue.
  const candidates: string[] = [];
  for (const u of urlsTranches(urlZip, BACKFILL_TRANCHES)) {
    if (u === derniereVue) break;
    candidates.push(u);
  }
  let tranches = 0;
  let inseres = 0;
  for (const u of candidates) {
    try {
      const res = await fetchImpl(u, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS) });
      if (!res.ok) continue; // tranche manquante/404 : tolérée
      const zip = new Uint8Array(await res.arrayBuffer());
      inseres += ingererEvenements(d, parseTrancheGdelt(new TextDecoder().decode(extraireFichierZip(zip))));
      tranches += 1;
    } catch {
      // Tranche individuelle en échec (réseau/zip corrompu) : sautée, les autres continuent.
    }
  }
  purgerEvenements(d, now);
  ecrireMeta(d, "gdelt", JSON.stringify({ url: urlZip }), now);
  return { tranches, inseres };
}

/**
 * Rafraîchit l'instantané UCDP : découvre le fichier candidat courant sur la
 * page d'index, télécharge/parse/agrège, stocke le JSON sous la clé "ucdp".
 * Renvoie false (sans jeter) si l'amont est injoignable — l'appelant décide
 * de servir le périmé.
 */
export async function rafraichirUcdp(
  d: Database,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const resIndex = await fetchImpl(URL_INDEX_UCDP, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS) });
    if (!resIndex.ok) return false;
    const fichier = choisirFichierCandidat(await resIndex.text());
    if (fichier === null) return false;
    const resCsv = await fetchImpl(`${BASE_UCDP}${fichier}`, { headers: entetesAmont(), signal: AbortSignal.timeout(TIMEOUT_AMONT_MS * 4) });
    if (!resCsv.ok) return false;
    const zones = agregerUcdp(parseCsv(await resCsv.text()));
    if (zones.length === 0) return false; // réponse vide/inattendue : ne pas écraser un bon instantané
    ecrireMeta(d, "ucdp", JSON.stringify({ fichier, zones }), now);
    return true;
  } catch {
    return false;
  }
}
```

Remplacer le placeholder `repondreConflitsUcdp` par :

```ts
/** Sert l'instantané UCDP ; le rafraîchit d'abord s'il est absent ou > 24 h. */
async function repondreConflitsUcdp(req: Request, d: Database, now: number, fetchImpl: typeof fetch): Promise<Response> {
  let meta = lireMeta(d, "ucdp");
  let stale = false;
  if (meta === null || now - meta.majA > FRAICHEUR_UCDP_MS) {
    const ok = await rafraichirUcdp(d, fetchImpl, now);
    if (ok) meta = lireMeta(d, "ucdp");
    else if (meta !== null) stale = true; // périmé servi quand même : jamais d'écran vide
  }
  if (meta === null) {
    return new Response(JSON.stringify({ erreur: "amont injoignable", detail: "UCDP indisponible et aucun instantané" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
    });
  }
  const { fichier, zones } = JSON.parse(meta.corps) as { fichier: string; zones: unknown[] };
  return new Response(JSON.stringify({ majA: meta.majA, fichier, zones }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-axiomd-cache": stale ? "stale" : "hit",
      ...entetesCors(req),
    },
  });
}
```

Mettre à jour la signature de `traiterGlobe` (5ᵉ paramètre `fetchImpl: typeof fetch = fetch`, transmis à `repondreConflitsUcdp`), puis ajouter en fin de fichier :

```ts
/**
 * Boucle d'ingestion GDELT (pattern demarrerBoucleSnapshots) : un tick immédiat
 * non bloquant puis toutes les 15 min — UNIQUEMENT du stockage à froid, jamais
 * sur le chemin chaud du renderer (BUILD-CONTRACT).
 */
export function demarrerBoucleGlobe(): () => void {
  const tick = () => {
    rafraichirGdelt(getDb()).catch((err: unknown) => {
      console.error("[globe] rafraîchissement GDELT en échec :", err instanceof Error ? err.message : err);
    });
  };
  const timerInitial = setTimeout(tick, 3_000); // léger différé : ne pas gêner le démarrage
  const intervalle = setInterval(tick, INTERVALLE_BOUCLE_GLOBE_MS);
  return () => {
    clearTimeout(timerInitial);
    clearInterval(intervalle);
  };
}

/** Enregistre le préfixe /globe (modèle enregistrerReplay). */
export function enregistrerGlobe(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/globe", (req, url) => traiterGlobe(req, url));
}
```

- [ ] **Step 4: Câbler `index.ts`**

Dans `apps/daemon/src/index.ts` : ajouter `import { demarrerBoucleGlobe, enregistrerGlobe } from "./globe";`, ajouter `enregistrerGlobe(routeur);` à côté de `enregistrerReplay(routeur);`, et `demarrerBoucleGlobe();` à côté de `demarrerBoucleSnapshots()` (même zone de démarrage ; suivre la gestion du dispose existante s'il y en a une).

- [ ] **Step 5: Vérifier le passage**

Run : `cd ~/axiom/apps/daemon && bun test src && tsc --noEmit`
Attendu : PASS (toute la suite daemon). Puis vérification RÉELLE bout-en-bout :

```bash
cd ~/axiom && bun apps/daemon/src/index.ts &
sleep 25 && curl -s "http://127.0.0.1:8787/globe/evenements" | head -c 400; echo
curl -s "http://127.0.0.1:8787/globe/conflits-ucdp" | head -c 300; echo
kill %1
```
Attendu : `/globe/evenements` → JSON avec `majA` non null et des `cellules` (l'ingestion initiale a ~22 s + 12 tranches à télécharger — si `cellules` vide, réessayer après 30 s de plus) ; `/globe/conflits-ucdp` → JSON avec `zones` (~680).

- [ ] **Step 6: Commit**

```bash
cd ~/axiom && git add apps/daemon/src/globe.ts apps/daemon/src/globe.test.ts apps/daemon/src/index.ts
git commit -m "feat(daemon): ingestion GDELT 15 min (backfill 3 h) + instantané UCDP stale + routes câblées"
```

### Task 6: Types partagés + modules data front GDELT/UCDP (`apps/web`)

**Files:**
- Modify: `apps/web/src/data/globe/types.ts` (ajouts après `EtatOpenSky`)
- Modify: `apps/web/src/data/daemon.ts` (export `urlDaemon`)
- Create: `apps/web/src/data/globe/gdelt.ts` + `apps/web/src/data/globe/gdelt.test.ts`
- Create: `apps/web/src/data/globe/ucdp.ts` + `apps/web/src/data/globe/ucdp.test.ts`

**Interfaces:**
- Consomme : `daemonPret()` et `baseDaemon()` (via le nouvel export `urlDaemon`) de `../daemon`.
- Produit (utilisé par Tasks 8-11) — dans `types.ts` :
  - `type CategorieEvenement = "materiel" | "coercition" | "protestation"`
  - `interface CelluleEvenements { lat; lon; categorie: CategorieEvenement; n; intensite; mentions; dernierMs }` (COPIE VERBATIM du daemon `gdelt.ts` — source de vérité = ce commentaire)
  - `interface EtatEvenements { cellules: CelluleEvenements[]; majA: number | null; couverture: { deMs: number; aMs: number } | null }`
  - `interface EvenementDetail { dateMs: number; categorie: CategorieEvenement; codeCameo: string; goldstein: number; mentions: number; acteur1: string | null; acteur2: string | null; url: string | null }`
  - `interface ZoneConflitUcdp { lat; lon; morts; n; sideA: string | null; sideB: string | null; dernierMs }` (COPIE VERBATIM du daemon `ucdp.ts`)
  - `interface EtatConflitsUcdp { zones: ZoneConflitUcdp[]; majA: number; fichier: string }`
- Dans `gdelt.ts` : `parseEvenements(json: unknown): EtatEvenements | null` ; `chargerEvenements(signal?: AbortSignal): Promise<EtatEvenements | null>` ; `parseZone(json: unknown): EvenementDetail[] | null` ; `chargerZoneEvenements(lat: number, lon: number, signal?: AbortSignal): Promise<EvenementDetail[] | null>` ; `INTERVALLE_POLL_EVENEMENTS_MS = 15 * 60_000`.
- Dans `ucdp.ts` : `parseConflitsUcdp(json: unknown): EtatConflitsUcdp | null` ; `chargerConflitsUcdp(signal?: AbortSignal): Promise<EtatConflitsUcdp | null>` (mémo module — donnée mensuelle, 1 fetch par session suffit).
- Dans `daemon.ts` : `export function urlDaemon(chemin: string): string` = `` `${baseDaemon()}${chemin}` ``.

- [ ] **Step 1: Écrire les tests qui échouent**

`apps/web/src/data/globe/gdelt.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseEvenements, parseZone } from "./gdelt";

// Fixture VERBATIM de la forme servie par le daemon (contrat Task 4).
const REPONSE = {
  majA: 1783728000000,
  couverture: { deMs: 1783720800000, aMs: 1783724400000 },
  cellules: [
    { lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: 1783724400000 },
    { lat: 31.5, lon: 34.5, categorie: "protestation", n: 3, intensite: 6.5, mentions: 9, dernierMs: 1783720800000 },
  ],
};

describe("parseEvenements", () => {
  it("accepte la réponse daemon nominale", () => {
    const etat = parseEvenements(REPONSE);
    expect(etat?.cellules).toHaveLength(2);
    expect(etat?.majA).toBe(1783728000000);
    expect(etat?.couverture?.aMs).toBe(1783724400000);
  });
  it("accepte majA/couverture null (base vide) et filtre les cellules malformées", () => {
    const etat = parseEvenements({ majA: null, couverture: null, cellules: [{ lat: "x" }, REPONSE.cellules[0]] });
    expect(etat?.majA).toBeNull();
    expect(etat?.cellules).toHaveLength(1);
  });
  it("rejette les formes inattendues sans jeter", () => {
    expect(parseEvenements(null)).toBeNull();
    expect(parseEvenements({ cellules: "pas un tableau" })).toBeNull();
    expect(parseEvenements(42)).toBeNull();
  });
});

describe("parseZone", () => {
  it("accepte la réponse nominale et tolère les champs null", () => {
    const evts = parseZone({ evenements: [{ dateMs: 1, categorie: "coercition", codeCameo: "172", goldstein: -5, mentions: 2, acteur1: null, acteur2: "POLICE", url: null }] });
    expect(evts).toHaveLength(1);
    expect(evts?.[0]?.acteur2).toBe("POLICE");
  });
  it("rejette sans jeter", () => {
    expect(parseZone(undefined)).toBeNull();
    expect(parseZone({})).toBeNull();
  });
});
```

`apps/web/src/data/globe/ucdp.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseConflitsUcdp } from "./ucdp";

describe("parseConflitsUcdp", () => {
  it("accepte la réponse daemon nominale", () => {
    const etat = parseConflitsUcdp({
      majA: 1783728000000,
      fichier: "GEDEvent_v26_0_5.csv",
      zones: [{ lat: 48.5, lon: 35, morts: 42, n: 2, sideA: "Armée A", sideB: "Milice C", dernierMs: 1779580800000 }],
    });
    expect(etat?.zones).toHaveLength(1);
    expect(etat?.fichier).toBe("GEDEvent_v26_0_5.csv");
  });
  it("filtre les zones malformées, rejette les formes inattendues sans jeter", () => {
    expect(parseConflitsUcdp({ majA: 1, fichier: "f", zones: [{ lat: "x" }] })?.zones).toHaveLength(0);
    expect(parseConflitsUcdp(null)).toBeNull();
    expect(parseConflitsUcdp({ zones: [] })).toBeNull(); // majA/fichier manquants
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/data/globe/gdelt.test.ts src/data/globe/ucdp.test.ts`
Attendu : FAIL — modules introuvables.

- [ ] **Step 3: Implémenter**

Dans `apps/web/src/data/daemon.ts`, sous `baseDaemon()` :

```ts
/** URL absolue d'un chemin daemon (DEV : cross-origin 127.0.0.1:8787 ; PROD : same-origin). */
export function urlDaemon(chemin: string): string {
  return `${baseDaemon()}${chemin}`;
}
```

Dans `apps/web/src/data/globe/types.ts`, ajouter après `EtatOpenSky` (respecter l'avertissement de tête de fichier — contrat partagé data/rendu) :

```ts
/** Catégorie d'un événement géopolitique (COPIE VERBATIM de apps/daemon/src/gdelt.ts —
 *  interdiction d'import cross-package ; source de vérité = ce commentaire). */
export type CategorieEvenement = "materiel" | "coercition" | "protestation";

/** Cellule GDELT agrégée par le daemon (grille 0,5°, COPIE VERBATIM idem). */
export interface CelluleEvenements {
  lat: number;
  lon: number;
  categorie: CategorieEvenement;
  n: number;
  /** max de |GoldsteinScale| borné [0, 10] sur la cellule. */
  intensite: number;
  mentions: number;
  dernierMs: number;
}

/** Réponse de GET /globe/evenements. */
export interface EtatEvenements {
  cellules: CelluleEvenements[];
  /** Dernière ingestion daemon (epoch ms), null si base vide. */
  majA: number | null;
  /** Fenêtre réellement couverte par les données servies. */
  couverture: { deMs: number; aMs: number } | null;
}

/** Un événement du panneau détail (GET /globe/evenements/zone). */
export interface EvenementDetail {
  dateMs: number;
  categorie: CategorieEvenement;
  codeCameo: string;
  goldstein: number;
  mentions: number;
  acteur1: string | null;
  acteur2: string | null;
  url: string | null;
}

/** Zone UCDP agrégée (COPIE VERBATIM de apps/daemon/src/ucdp.ts). */
export interface ZoneConflitUcdp {
  lat: number;
  lon: number;
  morts: number;
  n: number;
  sideA: string | null;
  sideB: string | null;
  dernierMs: number;
}

/** Réponse de GET /globe/conflits-ucdp. */
export interface EtatConflitsUcdp {
  zones: ZoneConflitUcdp[];
  majA: number;
  fichier: string;
}

/** Front Ukraine ISW : FeatureCollection GeoJSON opaque côté data (assertion côté rendu, pattern TERRES). */
export interface FrontUkraine {
  collection: unknown;
  /** EditDate ArcGIS le plus récent (epoch ms), null si absent. */
  majMs: number | null;
  n: number;
}
```

`apps/web/src/data/globe/gdelt.ts` :

```ts
/**
 * Événements géopolitiques GDELT — servis par le DAEMON (routes /globe/evenements
 * et /globe/evenements/zone, cf. apps/daemon/src/globe.ts) : l'amont GDELT est
 * http-only + zip, intraitable depuis le navigateur. Sans daemon, la couche
 * dégrade en silence (null → note « daemon hors ligne » dans la fenêtre).
 * Pattern du repo : parse PUR testé / chargerXxx réseau non testé, jamais d'exception.
 */
import { daemonPret, urlDaemon } from "../daemon";
import type { CategorieEvenement, CelluleEvenements, EtatEvenements, EvenementDetail } from "./types";

/** Cadence de poll de la fenêtre (alignée sur la publication GDELT 15 min). */
export const INTERVALLE_POLL_EVENEMENTS_MS = 15 * 60_000;

const CATEGORIES: ReadonlySet<string> = new Set(["materiel", "coercition", "protestation"]);

function estNombre(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseCellule(brut: unknown): CelluleEvenements | null {
  if (typeof brut !== "object" || brut === null) return null;
  const c = brut as Record<string, unknown>;
  if (!estNombre(c.lat) || !estNombre(c.lon) || !estNombre(c.n) || !estNombre(c.intensite) || !estNombre(c.mentions) || !estNombre(c.dernierMs)) return null;
  if (typeof c.categorie !== "string" || !CATEGORIES.has(c.categorie)) return null;
  return { lat: c.lat, lon: c.lon, categorie: c.categorie as CategorieEvenement, n: c.n, intensite: c.intensite, mentions: c.mentions, dernierMs: c.dernierMs };
}

/** Parse défensif de la réponse /globe/evenements. */
export function parseEvenements(json: unknown): EtatEvenements | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.cellules)) return null;
  const majA = estNombre(r.majA) ? r.majA : null;
  let couverture: EtatEvenements["couverture"] = null;
  if (typeof r.couverture === "object" && r.couverture !== null) {
    const c = r.couverture as Record<string, unknown>;
    if (estNombre(c.deMs) && estNombre(c.aMs)) couverture = { deMs: c.deMs, aMs: c.aMs };
  }
  const cellules: CelluleEvenements[] = [];
  for (const brut of r.cellules) {
    const cellule = parseCellule(brut);
    if (cellule !== null) cellules.push(cellule);
  }
  return { cellules, majA, couverture };
}

/** Parse défensif de la réponse /globe/evenements/zone. */
export function parseZone(json: unknown): EvenementDetail[] | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.evenements)) return null;
  const evenements: EvenementDetail[] = [];
  for (const brut of r.evenements) {
    if (typeof brut !== "object" || brut === null) continue;
    const e = brut as Record<string, unknown>;
    if (!estNombre(e.dateMs) || typeof e.categorie !== "string" || !CATEGORIES.has(e.categorie)) continue;
    evenements.push({
      dateMs: e.dateMs,
      categorie: e.categorie as CategorieEvenement,
      codeCameo: typeof e.codeCameo === "string" ? e.codeCameo : "",
      goldstein: estNombre(e.goldstein) ? e.goldstein : 0,
      mentions: estNombre(e.mentions) ? e.mentions : 0,
      acteur1: typeof e.acteur1 === "string" ? e.acteur1 : null,
      acteur2: typeof e.acteur2 === "string" ? e.acteur2 : null,
      url: typeof e.url === "string" ? e.url : null,
    });
  }
  return evenements;
}

/** Charge la fenêtre agrégée. null = daemon absent/en échec (dégradation silencieuse). */
export async function chargerEvenements(signal?: AbortSignal): Promise<EtatEvenements | null> {
  if (!daemonPret()) return null;
  try {
    const res = await fetch(urlDaemon("/globe/evenements?fenetreH=24"), { signal });
    if (!res.ok) return null;
    return parseEvenements((await res.json()) as unknown);
  } catch {
    return null;
  }
}

/** Charge le détail d'une cellule (clic). null = daemon absent/en échec. */
export async function chargerZoneEvenements(lat: number, lon: number, signal?: AbortSignal): Promise<EvenementDetail[] | null> {
  if (!daemonPret()) return null;
  try {
    const res = await fetch(urlDaemon(`/globe/evenements/zone?lat=${lat}&lon=${lon}&fenetreH=24`), { signal });
    if (!res.ok) return null;
    return parseZone((await res.json()) as unknown);
  } catch {
    return null;
  }
}
```

`apps/web/src/data/globe/ucdp.ts` :

```ts
/**
 * Conflits armés confirmés UCDP (Candidate GED, ~1 mois de retard) — servis par
 * le daemon (/globe/conflits-ucdp, instantané 24 h + stale). Donnée mensuelle :
 * un mémo module suffit, un seul fetch par session. Sans daemon → null.
 */
import { daemonPret, urlDaemon } from "../daemon";
import type { EtatConflitsUcdp, ZoneConflitUcdp } from "./types";

let memo: EtatConflitsUcdp | null = null;

function estNombre(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Parse défensif de la réponse /globe/conflits-ucdp. */
export function parseConflitsUcdp(json: unknown): EtatConflitsUcdp | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (!estNombre(r.majA) || typeof r.fichier !== "string" || !Array.isArray(r.zones)) return null;
  const zones: ZoneConflitUcdp[] = [];
  for (const brut of r.zones) {
    if (typeof brut !== "object" || brut === null) continue;
    const z = brut as Record<string, unknown>;
    if (!estNombre(z.lat) || !estNombre(z.lon) || !estNombre(z.morts) || !estNombre(z.n) || !estNombre(z.dernierMs)) continue;
    zones.push({
      lat: z.lat, lon: z.lon, morts: z.morts, n: z.n,
      sideA: typeof z.sideA === "string" ? z.sideA : null,
      sideB: typeof z.sideB === "string" ? z.sideB : null,
      dernierMs: z.dernierMs,
    });
  }
  return { zones, majA: r.majA, fichier: r.fichier };
}

/** Charge (une fois par session) les zones UCDP. null = daemon absent/en échec. */
export async function chargerConflitsUcdp(signal?: AbortSignal): Promise<EtatConflitsUcdp | null> {
  if (memo !== null) return memo;
  if (!daemonPret()) return null;
  try {
    const res = await fetch(urlDaemon("/globe/conflits-ucdp"), { signal });
    if (!res.ok) return null;
    const etat = parseConflitsUcdp((await res.json()) as unknown);
    if (etat !== null) memo = etat;
    return etat;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/data/globe/gdelt.test.ts src/data/globe/ucdp.test.ts && pnpm --filter @axiom/web typecheck`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/axiom && git add apps/web/src/data/globe/types.ts apps/web/src/data/globe/gdelt.ts apps/web/src/data/globe/gdelt.test.ts apps/web/src/data/globe/ucdp.ts apps/web/src/data/globe/ucdp.test.ts apps/web/src/data/daemon.ts
git commit -m "feat(web): modules data GDELT/UCDP via daemon + types partagés du globe géopolitique"
```

### Task 7: Module data front ISW (direct navigateur, `isw.ts`)

**Files:**
- Create: `apps/web/src/data/globe/isw.ts`
- Create: `apps/web/src/data/globe/isw.test.ts`

**Interfaces:**
- Consomme : `lireCache`/`ecrireCache`/`estFrais` de `../onchain/cache` (pattern portwatch — triple cache mémo/localStorage/KV) ; `FrontUkraine` de `./types`.
- Produit : `parseFrontIsw(json: unknown): FrontUkraine | null` ; `chargerFrontIsw(signal?: AbortSignal): Promise<FrontUkraine | null>` ; `ISW_TTL_MS = 6 * 60 * 60 * 1000`.
- NE PAS whitelister l'hôte dans /extapi : accès DIRECT navigateur, précédent explicite PortWatch (extapi.ts:54-58).

- [ ] **Step 1: Écrire le test qui échoue** (`apps/web/src/data/globe/isw.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { parseFrontIsw } from "./isw";

// Forme VERBATIM d'une réponse ArcGIS f=geojson (vérifiée en direct le 2026-07-12 :
// 10 features Polygon, propriété EditDate en epoch ms).
const GEOJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { OBJECTID: 250, EditDate: 1783204674229 }, geometry: { type: "Polygon", coordinates: [[[37.5, 47.9], [37.6, 47.9], [37.6, 48.0], [37.5, 47.9]]] } },
    { type: "Feature", properties: { OBJECTID: 251, EditDate: 1783100000000 }, geometry: { type: "MultiPolygon", coordinates: [[[[30, 46], [30.1, 46], [30.1, 46.1], [30, 46]]]] } },
  ],
};

describe("parseFrontIsw", () => {
  it("accepte une FeatureCollection et extrait le EditDate max", () => {
    const front = parseFrontIsw(GEOJSON);
    expect(front?.n).toBe(2);
    expect(front?.majMs).toBe(1783204674229);
    expect(front?.collection).toBe(GEOJSON); // la collection passe telle quelle à geoPath
  });
  it("tolère l'absence d'EditDate (majMs null)", () => {
    const front = parseFrontIsw({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } }] });
    expect(front?.majMs).toBeNull();
  });
  it("rejette sans jeter : null, mauvais type, features absentes, collection vide", () => {
    expect(parseFrontIsw(null)).toBeNull();
    expect(parseFrontIsw({ type: "Point" })).toBeNull();
    expect(parseFrontIsw({ type: "FeatureCollection" })).toBeNull();
    expect(parseFrontIsw({ type: "FeatureCollection", features: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/data/globe/isw.test.ts`
Attendu : FAIL — module `./isw` introuvable.

- [ ] **Step 3: Implémenter** (`apps/web/src/data/globe/isw.ts`)

```ts
/**
 * Front Ukraine ISW/CTP — couche ArcGIS FeatureServer publique découverte via la
 * story map officielle (reverse-engineering, cf. docs/research/08 §4) : source
 * NON CONTRACTUELLE, même classe de risque que l'endpoint CBOE GEX — toujours
 * dégradable, jamais bloquante. CORS `*` vérifié → appel DIRECT navigateur,
 * pattern PortWatch (PAS d'entrée whitelist /extapi). Les deux paramètres de
 * simplification sont OBLIGATOIRES : sans eux la réponse fait 2 Mo / 57 000
 * sommets ; avec, 11,6 Ko / ~650 sommets (mesuré le 2026-07-12) — invisible à
 * l'échelle d'un globe. Cache 6 h (mémo module + localStorage/KV), dégradation
 * vers le périmé puis null.
 */
import { ecrireCache, estFrais, lireCache, type CacheEntree } from "../onchain/cache";
import type { FrontUkraine } from "./types";

export const ISW_TTL_MS = 6 * 60 * 60 * 1000;
const CLE_CACHE = "globe:isw-front";
const URL_ISW =
  "https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49/query" +
  "?where=1%3D1&outFields=EditDate&f=geojson&geometryPrecision=3&maxAllowableOffset=0.01";

let memo: CacheEntree<FrontUkraine> | null = null;

/** Parse défensif d'une FeatureCollection ArcGIS ; null si vide ou inattendue. */
export function parseFrontIsw(json: unknown): FrontUkraine | null {
  if (typeof json !== "object" || json === null) return null;
  const r = json as Record<string, unknown>;
  if (r.type !== "FeatureCollection" || !Array.isArray(r.features) || r.features.length === 0) return null;
  let majMs: number | null = null;
  for (const brut of r.features) {
    if (typeof brut !== "object" || brut === null) continue;
    const props = (brut as Record<string, unknown>).properties;
    if (typeof props !== "object" || props === null) continue;
    const editDate = (props as Record<string, unknown>).EditDate;
    if (typeof editDate === "number" && Number.isFinite(editDate)) majMs = Math.max(majMs ?? 0, editDate);
  }
  return { collection: json, majMs, n: r.features.length };
}

/** Charge le front (cache 6 h → périmé → null). Jamais d'exception. */
export async function chargerFrontIsw(signal?: AbortSignal): Promise<FrontUkraine | null> {
  if (memo !== null && estFrais(memo, ISW_TTL_MS)) return memo.donnee;
  const cache = await lireCache<FrontUkraine>(CLE_CACHE);
  if (cache !== null && estFrais(cache, ISW_TTL_MS) && parseFrontIsw(cache.donnee.collection) !== null) {
    memo = cache;
    return cache.donnee;
  }
  try {
    const res = await fetch(URL_ISW, { signal });
    if (!res.ok) throw new Error(`ISW HTTP ${res.status}`);
    const front = parseFrontIsw((await res.json()) as unknown);
    if (front === null) throw new Error("ISW : réponse vide/inattendue");
    await ecrireCache(CLE_CACHE, front);
    memo = { donnee: front, ts: Date.now() };
    return front;
  } catch {
    if (cache !== null && parseFrontIsw(cache.donnee.collection) !== null) return cache.donnee; // périmé accepté
    return null;
  }
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/data/globe/isw.test.ts && pnpm --filter @axiom/web typecheck`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/axiom && git add apps/web/src/data/globe/isw.ts apps/web/src/data/globe/isw.test.ts
git commit -m "feat(web): front Ukraine ISW en direct navigateur (géométrie simplifiée, cache 6 h)"
```

### Task 8: Briques pures du rendu — tokens, cibles multi-couches, rayons/couleurs (`globeRender.ts`, 1/2)

**Files:**
- Modify: `apps/web/src/lib/globeRender.ts` (AJOUTS non cassants + extension `TokensGlobe`)
- Modify: `apps/web/src/lib/globeRender.test.ts` (ajouts)
- Modify: `apps/web/src/components/GlobeWindow.tsx` (UNIQUEMENT `lireTokensGlobe` : 2 tokens de plus)

**Interfaces:**
- Consomme : `CategorieEvenement` de `../data/globe/types`.
- Produit (utilisé par Task 9/11) :
  - `TokensGlobe` gagne `down: string` (`--down`) et `serie4: string` (`--serie-4`) — champs REQUIS
  - `type CoucheCible = "chokepoint" | "evenement" | "conflit"`
  - `interface CibleGlobe { couche: CoucheCible; index: number; x: number; y: number; r: number }`
  - `type SurvolGlobe = { couche: CoucheCible; index: number }`
  - `hitTestCibles(cibles: readonly CibleGlobe[], mx: number, my: number, margePx?: number): CibleGlobe | null` (plus proche gagnant, même sémantique que `hitTestChokepoints`)
  - `rayonEvenement(intensite: number, n: number): number` — `2 + √n + intensite × 0,4`, clampé [2, 13] px écran
  - `rayonConflit(morts: number): number` — `3 + √morts × 0,35`, clampé [3, 16] px écran
  - `couleurCategorie(categorie: CategorieEvenement, tokens: TokensGlobe): string` — materiel→`tokens.down`, coercition→`tokens.serie4`, protestation→`tokens.serie2` (le rouge sémantique `--down` = danger ; `--serie-3` ambre est ÉVITÉ : déjà pris par les chokepoints ; déviation documentée vs le mot « orange » de la spec)
  - `estRecent(dernierMs: number, nowMs: number): boolean` — < 1 h
  - `rayonHalo(rayon: number, tMs: number): number` — `rayon + 2,5 + sin(tMs / 300) × 1,5` (pulse ~2 s, statique quand la boucle rAF dort puisque tMs fige)

- [ ] **Step 1: Ajouter les tests qui échouent** (append à `globeRender.test.ts`, harnais vitest node sans canvas, comme l'existant)

```ts
import { couleurCategorie, estRecent, hitTestCibles, rayonConflit, rayonEvenement, rayonHalo, type CibleGlobe, type TokensGlobe } from "./globeRender";

const TOKENS: TokensGlobe = { bg: "#000", border: "#333", textDim: "#999", serie2: "#a78bfa", serie3: "#f59e0b", down: "#f92855", serie4: "#f472b6" };

describe("briques géopolitiques", () => {
  it("rayonEvenement croît avec n et l'intensité, clampé [2, 13]", () => {
    expect(rayonEvenement(0, 0)).toBe(2);
    expect(rayonEvenement(10, 4)).toBe(8); // 2 + 2 + 4
    expect(rayonEvenement(10, 400)).toBe(13); // clampé
  });
  it("rayonConflit en racine des morts, clampé [3, 16]", () => {
    expect(rayonConflit(0)).toBe(3);
    expect(rayonConflit(100)).toBe(6.5); // 3 + 10×0,35
    expect(rayonConflit(6111)).toBe(16); // top réel UCDP → clampé
  });
  it("couleurCategorie mappe vers les tokens sémantiques", () => {
    expect(couleurCategorie("materiel", TOKENS)).toBe("#f92855");
    expect(couleurCategorie("coercition", TOKENS)).toBe("#f472b6");
    expect(couleurCategorie("protestation", TOKENS)).toBe("#a78bfa");
  });
  it("estRecent : strictement moins d'une heure", () => {
    expect(estRecent(1000, 1000 + 3_599_000)).toBe(true);
    expect(estRecent(1000, 1000 + 3_600_000)).toBe(false);
  });
  it("rayonHalo oscille autour de rayon + 2,5 (amplitude 1,5)", () => {
    expect(rayonHalo(5, 0)).toBe(7.5);
    expect(rayonHalo(5, Math.PI / 2 * 300)).toBeCloseTo(9, 5);
  });
});

describe("hitTestCibles (multi-couches)", () => {
  const cibles: CibleGlobe[] = [
    { couche: "chokepoint", index: 0, x: 100, y: 100, r: 5 },
    { couche: "evenement", index: 3, x: 104, y: 100, r: 6 },
  ];
  it("renvoie la cible la plus PROCHE en cas de chevauchement", () => {
    expect(hitTestCibles(cibles, 103, 100)).toEqual(cibles[1]);
    expect(hitTestCibles(cibles, 101, 100)).toEqual(cibles[0]);
  });
  it("respecte la marge (4 px défaut) et renvoie null au-delà", () => {
    expect(hitTestCibles(cibles, 100, 108)).toEqual(cibles[0]); // r5 + marge 4
    expect(hitTestCibles(cibles, 100, 130)).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/lib/globeRender.test.ts`
Attendu : FAIL — exports manquants (les tests existants du fichier restent verts).

- [ ] **Step 3: Implémenter** — dans `globeRender.ts` :

1. Étendre `TokensGlobe` (champs requis, avec les commentaires d'usage) :

```ts
export interface TokensGlobe {
  bg: string;
  border: string;
  textDim: string;
  /** --serie-2 : sous-cercle pétroliers + protestations GDELT. */
  serie2: string;
  /** --serie-3 : points chokepoints + nom dans le libellé. */
  serie3: string;
  /** --down : conflits matériels GDELT, zones UCDP, front ISW (rouge sémantique danger). */
  down: string;
  /** --serie-4 : coercition/répression GDELT. */
  serie4: string;
}
```

2. Ajouter les briques pures (imports : `type CategorieEvenement` depuis `../data/globe/types`) :

```ts
/** Couches porteuses de cibles de survol/clic. */
export type CoucheCible = "chokepoint" | "evenement" | "conflit";

/** Cible écran d'un marqueur dessiné (px CSS), toutes couches confondues. */
export interface CibleGlobe {
  couche: CoucheCible;
  /** Index dans le tableau SOURCE de la couche (chokepoints/cellules/zones). */
  index: number;
  x: number;
  y: number;
  r: number;
}

/** Référence de survol stockée côté fenêtre (ref, jamais de state par frame). */
export type SurvolGlobe = { couche: CoucheCible; index: number };

/** Cible la plus proche dont le disque + marge contient le curseur, sinon null. */
export function hitTestCibles(cibles: readonly CibleGlobe[], mx: number, my: number, margePx = 4): CibleGlobe | null {
  let meilleure: CibleGlobe | null = null;
  let meilleureDist = Number.POSITIVE_INFINITY;
  for (const cible of cibles) {
    const dist = Math.hypot(mx - cible.x, my - cible.y);
    if (dist <= cible.r + margePx && dist < meilleureDist) {
      meilleure = cible;
      meilleureDist = dist;
    }
  }
  return meilleure;
}

/** Bornes des rayons écran des marqueurs géopolitiques (px CSS, indépendants du zoom). */
export const RAYON_EVENEMENT_MIN = 2;
export const RAYON_EVENEMENT_MAX = 13;
export const RAYON_CONFLIT_MIN = 3;
export const RAYON_CONFLIT_MAX = 16;

/** Rayon d'une cellule GDELT : base 2 px + √n + 0,4 px par point d'intensité. */
export function rayonEvenement(intensite: number, n: number): number {
  return Math.min(RAYON_EVENEMENT_MAX, Math.max(RAYON_EVENEMENT_MIN, 2 + Math.sqrt(Math.max(0, n)) + intensite * 0.4));
}

/** Rayon d'une zone UCDP : échelle racine des morts (6111 morts réels → clampé). */
export function rayonConflit(morts: number): number {
  return Math.min(RAYON_CONFLIT_MAX, Math.max(RAYON_CONFLIT_MIN, 3 + Math.sqrt(Math.max(0, morts)) * 0.35));
}

/** Couleur de catégorie — tokens sémantiques uniquement (--serie-3 réservé aux chokepoints). */
export function couleurCategorie(categorie: CategorieEvenement, tokens: TokensGlobe): string {
  if (categorie === "materiel") return tokens.down;
  if (categorie === "coercition") return tokens.serie4;
  return tokens.serie2;
}

/** Un événement de moins d'une heure mérite un halo « récent ». */
export function estRecent(dernierMs: number, nowMs: number): boolean {
  return nowMs - dernierMs < 3_600_000;
}

/** Rayon du halo pulsant (période ~1,9 s) ; statique si la boucle rAF dort (tMs figé). */
export function rayonHalo(rayon: number, tMs: number): number {
  return rayon + 2.5 + Math.sin(tMs / 300) * 1.5;
}
```

3. Dans `GlobeWindow.tsx`, étendre `lireTokensGlobe` :

```ts
function lireTokensGlobe(): TokensGlobe {
  const t = lireTokensCanvas(["--bg", "--border", "--text-dim", "--serie-2", "--serie-3", "--down", "--serie-4"]);
  return {
    bg: t["--bg"],
    border: t["--border"],
    textDim: t["--text-dim"],
    serie2: t["--serie-2"],
    serie3: t["--serie-3"],
    down: t["--down"],
    serie4: t["--serie-4"],
  };
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/lib/globeRender.test.ts && pnpm --filter @axiom/web typecheck`
Attendu : PASS (anciens + nouveaux tests).

- [ ] **Step 5: Commit**

```bash
cd ~/axiom && git add apps/web/src/lib/globeRender.ts apps/web/src/lib/globeRender.test.ts apps/web/src/components/GlobeWindow.tsx
git commit -m "feat(web): briques pures du rendu géopolitique (cibles multi-couches, rayons, couleurs, halo)"
```

### Task 9: Dessin des 3 couches + libellé multi-couche (`globeRender.ts`, 2/2)

**Files:**
- Modify: `apps/web/src/lib/globeRender.ts` (extension `ParamsDessinGlobe`, `dessinerGlobe`, généralisation libellé, SUPPRESSION de `CibleChokepoint`/`hitTestChokepoints` remplacés par `CibleGlobe`/`hitTestCibles`)
- Modify: `apps/web/src/lib/globeRender.test.ts` (adapter les tests hit-test existants + tests `contenuLibelle`)
- Modify: `apps/web/src/components/GlobeWindow.tsx` (migration minimale : types de refs + appel `dessinerGlobe` — les nouvelles couches reçoivent `[]`/`null` en dur, câblées en Task 10)

**Interfaces:**
- Consomme : Task 8 + `CelluleEvenements`, `ZoneConflitUcdp` de `../data/globe/types` ; `formatAge`, `formatEntier` de `./format`.
- Produit :
  - `ParamsDessinGlobe` : `indexSurvol: number` → **`survol: SurvolGlobe | null`** ; nouveaux champs `cellules: readonly CelluleEvenements[]`, `zonesUcdp: readonly ZoneConflitUcdp[]`, `frontUkraine: GeoPermissibleObjects | null` (`[]`/`null` = couche désactivée, pattern existant)
  - `dessinerGlobe(...): CibleGlobe[]` (les cibles chokepoints portent `couche: "chokepoint"`)
  - `contenuLibelle(survol: SurvolGlobe, params: ParamsDessinGlobe): { titre: string; lignes: string[] } | null` — EXPORTÉE et pure (testable sans canvas), consommée par le `dessinerLibelle` privé

**Ordre des couches (renuméroter les commentaires)** : 1 sphère · 2 graticule · 3 terres · 4 terminateur · 5 limbe · **6 front ISW** (polygones sous tous les marqueurs) · 7 avions · **8 zones UCDP** · **9 cellules GDELT** · 10 chokepoints · 11 libellé.

- [ ] **Step 1: Adapter/ajouter les tests**

Dans `globeRender.test.ts` : remplacer les usages `CibleChokepoint`/`hitTestChokepoints` par `CibleGlobe`(couche `"chokepoint"`)/`hitTestCibles` (mêmes cas, même sémantique). Ajouter :

```ts
import { contenuLibelle, type ParamsDessinGlobe } from "./globeRender";

describe("contenuLibelle", () => {
  const base: ParamsDessinGlobe = {
    largeur: 400, hauteur: 300, vue: { lambda: 0, phi: 0, zoom: 1 }, tokens: TOKENS,
    chokepoints: [{ id: "c6", nom: "Détroit d'Ormuz", lat: 26.3, lon: 56.9, nNavires: 34, nTankers: 17, nCargos: 17, date: "2026-07-05" }],
    avions: [],
    cellules: [{ lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: Date.UTC(2026, 6, 12, 10) }],
    zonesUcdp: [{ lat: 48.5, lon: 35, morts: 42, n: 2, sideA: "Armée A", sideB: "Milice C", dernierMs: Date.UTC(2026, 4, 20) }],
    frontUkraine: null,
    survol: null,
    date: new Date(Date.UTC(2026, 6, 12, 12)),
  };
  it("chokepoint : nom + navires", () => {
    const c = contenuLibelle({ couche: "chokepoint", index: 0 }, base);
    expect(c?.titre).toBe("Détroit d'Ormuz");
    expect(c?.lignes.join(" ")).toContain("34");
  });
  it("événement : catégorie, compte, intensité, fraîcheur", () => {
    const c = contenuLibelle({ couche: "evenement", index: 0 }, base);
    expect(c?.titre).toBe("Conflit armé");
    expect(c?.lignes.join(" ")).toContain("12 évt");
    expect(c?.lignes.join(" ")).toContain("10");
  });
  it("conflit UCDP : morts + acteurs", () => {
    const c = contenuLibelle({ couche: "conflit", index: 0 }, base);
    expect(c?.titre).toContain("UCDP");
    expect(c?.lignes.join(" ")).toContain("42 morts");
    expect(c?.lignes.join(" ")).toContain("Armée A");
  });
  it("index hors bornes → null", () => {
    expect(contenuLibelle({ couche: "evenement", index: 9 }, base)).toBeNull();
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @axiom/web test src/lib/globeRender.test.ts` → FAIL.

- [ ] **Step 3: Implémenter dans `globeRender.ts`**

1. `ParamsDessinGlobe` étendu (survol remplace indexSurvol) :

```ts
export interface ParamsDessinGlobe {
  largeur: number;
  hauteur: number;
  vue: VueGlobe;
  tokens: TokensGlobe;
  /** Chokepoints à dessiner ([] si couche désactivée). */
  chokepoints: readonly Chokepoint[];
  /** Avions à dessiner ([] si couche désactivée). */
  avions: readonly Avion[];
  /** Cellules d'événements GDELT ([] si couche désactivée ou daemon absent). */
  cellules: readonly CelluleEvenements[];
  /** Zones de conflit UCDP ([] si couche désactivée ou daemon absent). */
  zonesUcdp: readonly ZoneConflitUcdp[];
  /** Front Ukraine ISW (null si couche désactivée ou source en échec). */
  frontUkraine: GeoPermissibleObjects | null;
  /** Cible survolée (couche + index dans le tableau source), null sinon. */
  survol: SurvolGlobe | null;
  /** Horloge du terminateur ET du halo pulsant (injectable — défaut : maintenant). */
  date?: Date;
}
```

2. Libellés par couche : libellé des catégories + contenu pur :

```ts
/** Libellés humains des catégories (affichage libellé + légende + panneau). */
export const LIBELLES_CATEGORIE: Readonly<Record<CategorieEvenement, string>> = {
  materiel: "Conflit armé",
  coercition: "Coercition / répression",
  protestation: "Protestation / instabilité",
};

/** Contenu textuel du libellé survolé — pur, testable sans canvas. */
export function contenuLibelle(survol: SurvolGlobe, params: ParamsDessinGlobe): { titre: string; lignes: string[] } | null {
  const nowMs = (params.date ?? new Date()).getTime();
  if (survol.couche === "chokepoint") {
    const c = params.chokepoints[survol.index];
    if (c === undefined) return null;
    const navires = c.nNavires !== null ? `${formatEntier(c.nNavires)} navires` : "trafic n/d";
    const tankers = c.nTankers !== null ? ` · ${formatEntier(c.nTankers)} pétroliers` : "";
    return { titre: c.nom, lignes: [`${navires}${tankers}`] };
  }
  if (survol.couche === "evenement") {
    const cellule = params.cellules[survol.index];
    if (cellule === undefined) return null;
    return {
      titre: LIBELLES_CATEGORIE[cellule.categorie],
      lignes: [
        `${formatEntier(cellule.n)} évt · intensité ${cellule.intensite.toFixed(1)}/10`,
        `${formatEntier(cellule.mentions)} mentions · ${formatAge(cellule.dernierMs, nowMs)}`,
      ],
    };
  }
  const zone = params.zonesUcdp[survol.index];
  if (zone === undefined) return null;
  const acteurs = zone.sideA !== null && zone.sideB !== null ? `${zone.sideA} vs ${zone.sideB}` : (zone.sideA ?? zone.sideB ?? "acteurs n/d");
  return {
    titre: `Conflit confirmé (UCDP)`,
    lignes: [`${formatEntier(zone.morts)} morts · ${formatEntier(zone.n)} évt`, acteurs],
  };
}
```

(imports en tête : `import { formatAge, formatEntier } from "./format";` + types cellules/zones. Adapter `dessinerLibelle` : elle prend désormais `(ctx, cible: CibleGlobe, contenu: { titre: string; lignes: string[] }, tokens, largeur, hauteur)` et dessine titre + N lignes — même boîte bornée au canvas qu'aujourd'hui, hauteur = `14 + 12 × lignes.length`.)

3. Dans `dessinerGlobe`, après la couche limbe (5) et AVANT les avions :

```ts
  // — Couche 6 : front Ukraine ISW (polygones clippés gratuitement par clipAngle). —
  if (params.frontUkraine !== null) {
    ctx.beginPath();
    chemin(params.frontUkraine);
    ctx.fillStyle = tokens.down;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = tokens.down;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
```

Après les avions, remplacer la collecte de cibles chokepoints par la version multi-couches (déclarer `const cibles: CibleGlobe[] = [];` AVANT, et `const nowMs = (params.date ?? new Date()).getTime();`) :

```ts
  // — Couche 8 : zones de conflit UCDP (cercles NON remplis, sous les points GDELT). —
  params.zonesUcdp.forEach((zone, index) => {
    const point = projeterVisible(projection, zone.lon, zone.lat);
    if (point === null) return;
    const r = rayonConflit(zone.morts);
    const survole = params.survol?.couche === "conflit" && params.survol.index === index;
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = tokens.down;
    ctx.lineWidth = survole ? 2 : 1.25;
    ctx.globalAlpha = survole ? 0.95 : 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;
    cibles.push({ couche: "conflit", index, x: point.x, y: point.y, r });
  });

  // — Couche 9 : cellules d'événements GDELT (points pleins, halo si < 1 h). —
  params.cellules.forEach((cellule, index) => {
    const point = projeterVisible(projection, cellule.lon, cellule.lat);
    if (point === null) return;
    const r = rayonEvenement(cellule.intensite, cellule.n);
    const couleur = couleurCategorie(cellule.categorie, tokens);
    const survole = params.survol?.couche === "evenement" && params.survol.index === index;
    if (estRecent(cellule.dernierMs, nowMs)) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, rayonHalo(r, nowMs), 0, Math.PI * 2);
      ctx.strokeStyle = couleur;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
    ctx.fillStyle = couleur;
    ctx.globalAlpha = survole ? 1 : 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    cibles.push({ couche: "evenement", index, x: point.x, y: point.y, r });
  });
```

Couche chokepoints (10) : conserver le dessin actuel, remplacer `cibles.push({ index, … })` par `cibles.push({ couche: "chokepoint", index, x: point.x, y: point.y, r })` et la condition de survol par `params.survol?.couche === "chokepoint" && params.survol.index === index`. Couche libellé (11) :

```ts
  if (params.survol !== null) {
    const cible = cibles.find((c) => c.couche === params.survol?.couche && c.index === params.survol.index);
    const contenu = contenuLibelle(params.survol, params);
    if (cible !== undefined && contenu !== null) dessinerLibelle(ctx, cible, contenu, tokens, largeur, hauteur);
  }
  return cibles;
```

Supprimer `CibleChokepoint` et `hitTestChokepoints` (remplacés — plus aucun consommateur après le step 4).

4. Migration minimale de `GlobeWindow.tsx` (le câblage réel des données arrive en Task 10) :
- `ciblesRef: useRef<CibleGlobe[]>([])` ; `survolRef: useRef<SurvolGlobe | null>(null)` (toutes les comparaisons `=== -1` deviennent `=== null`, y compris les DEUX conditions de pause de la rotation auto).
- `surPointerMove` : `const cible = hitTestCibles(ciblesRef.current, mx, my); const survol = cible === null ? null : { couche: cible.couche, index: cible.index };` — déclencher un redraw si `survol?.couche !== survolRef.current?.couche || survol?.index !== survolRef.current?.index`.
- Appel `dessinerGlobe` : ajouter `cellules: [], zonesUcdp: [], frontUkraine: null, survol: survolRef.current` (supprimer `indexSurvol`).

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom && pnpm --filter @axiom/web test src/lib/globeRender.test.ts && pnpm --filter @axiom/web typecheck`
Attendu : PASS + typecheck vert (plus AUCUNE référence à `CibleChokepoint`/`hitTestChokepoints` : `grep -rn "hitTestChokepoints\|CibleChokepoint" apps/web/src` → vide).

- [ ] **Step 5: Vérification visuelle de non-régression**

Run : `cd ~/axiom && pnpm dev` puis ouvrir la fenêtre GLOBE (palette ⌘K → GLOBE) : le globe tourne, chokepoints/avions/survol/libellé identiques à avant (les nouvelles couches sont vides). Fermer.

- [ ] **Step 6: Commit**

```bash
cd ~/axiom && git add apps/web/src/lib/globeRender.ts apps/web/src/lib/globeRender.test.ts apps/web/src/components/GlobeWindow.tsx
git commit -m "feat(web): dessin des couches ISW/UCDP/GDELT + libellé et hit-test multi-couches"
```

### Task 10: Store 5 couches + câblage données + chips + pied enrichi (`globe-ui.ts`, `GlobeWindow.tsx`)

**Files:**
- Modify: `apps/web/src/store/globe-ui.ts`
- Create: `apps/web/src/components/globeWindow.util.ts` + `apps/web/src/components/globeWindow.util.test.ts`
- Modify: `apps/web/src/components/GlobeWindow.tsx`

**Interfaces:**
- Consomme : `chargerEvenements`/`INTERVALLE_POLL_EVENEMENTS_MS` de `../data/globe/gdelt` ; `chargerConflitsUcdp` de `../data/globe/ucdp` ; `chargerFrontIsw` de `../data/globe/isw` ; types Task 6 ; `GeoPermissibleObjects` (assertion locale documentée pattern TERRES pour `frontUkraine.collection`).
- Produit :
  - `CouchesGlobe` gagne `evenements: boolean; conflits: boolean; ukraine: boolean` (défaut `true` tous les trois)
  - `globeWindow.util.ts` : `noteEvenements(etat: EtatEvenements | null, coucheActive: boolean, daemonOk: boolean, nowMs: number): string` ; `noteConflits(etat: EtatConflitsUcdp | null, coucheActive: boolean, daemonOk: boolean, nowMs: number): string` ; `noteUkraine(front: FrontUkraine | null, coucheActive: boolean, nowMs: number): string` — textes purs du pied de fenêtre (pattern `courbeTaux.util.ts`)

- [ ] **Step 1: Écrire le test qui échoue** (`apps/web/src/components/globeWindow.util.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { noteConflits, noteEvenements, noteUkraine } from "./globeWindow.util";

const NOW = Date.UTC(2026, 6, 12, 12);

describe("notes de pied de fenêtre", () => {
  it("événements : compte de cellules + âge + couverture", () => {
    const note = noteEvenements(
      { cellules: [{ lat: 0, lon: 0, categorie: "materiel", n: 1, intensite: 1, mentions: 1, dernierMs: NOW }], majA: NOW - 120_000, couverture: { deMs: NOW - 24 * 3_600_000, aMs: NOW } },
      true, true, NOW,
    );
    expect(note).toContain("GDELT");
    expect(note).toContain("1 zone");
  });
  it("événements : daemon hors ligne explicitement dit", () => {
    expect(noteEvenements(null, true, false, NOW)).toContain("daemon hors ligne");
  });
  it("événements : couche désactivée", () => {
    expect(noteEvenements(null, false, true, NOW)).toContain("désactivé");
  });
  it("conflits : fichier + âge ; ukraine : n polygones + fraîcheur ISW", () => {
    expect(noteConflits({ zones: [], majA: NOW, fichier: "GEDEvent_v26_0_5.csv" }, true, true, NOW)).toContain("v26_0_5");
    expect(noteUkraine({ collection: {}, majMs: NOW - 3_600_000, n: 10 }, true, NOW)).toContain("ISW");
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @axiom/web test src/components/globeWindow.util.test.ts` → FAIL.

- [ ] **Step 3: Implémenter**

`apps/web/src/store/globe-ui.ts` — étendre l'interface, la valeur initiale et la doc :

```ts
/** Couches de données affichables sur le globe. */
export interface CouchesGlobe {
  /** Chokepoints maritimes IMF PortWatch (hebdo ~J-5). */
  chokepoints: boolean;
  /** Trafic aérien OpenSky (instantané, poll ~2 min). */
  avions: boolean;
  /** Événements géopolitiques GDELT (15 min, via daemon). */
  evenements: boolean;
  /** Conflits armés confirmés UCDP (~1 mois de lag, via daemon). */
  conflits: boolean;
  /** Front Ukraine ISW (polygones, direct navigateur). */
  ukraine: boolean;
}
```

Valeur initiale : `couches: { chokepoints: true, avions: true, evenements: true, conflits: true, ukraine: true }`. Commande palette : `libelle: "Globe (géopolitique, chokepoints & trafic aérien)"`, `apercu: "Ouvre / ferme le globe : conflits géopolitiques, chokepoints maritimes, trafic aérien"`, `motsCles` += `"conflits"`, `"guerre"`, `"coup d'etat"`, `"protestations"`, `"ukraine"`, `"gdelt"`, `"ucdp"`, `"isw"`, `"crises"`.

`apps/web/src/components/globeWindow.util.ts` :

```ts
/**
 * Textes PURS du pied de la fenêtre GLOBE (une note par source, avec fraîcheur
 * honnête) — extraits du JSX pour être testables au harnais vitest node sans DOM.
 */
import { formatAge, formatEntier } from "../lib/format";
import type { EtatConflitsUcdp, EtatEvenements, FrontUkraine } from "../data/globe/types";

/** Note GDELT : « jamais du live » — âge d'ingestion + largeur de fenêtre réelle. */
export function noteEvenements(etat: EtatEvenements | null, coucheActive: boolean, daemonOk: boolean, nowMs: number): string {
  if (!coucheActive) return "Événements : désactivé";
  if (!daemonOk) return "Événements : daemon hors ligne";
  if (etat === null || etat.majA === null) return "Événements : GDELT en attente…";
  const fenetreH = etat.couverture === null ? 0 : Math.round((etat.couverture.aMs - etat.couverture.deMs) / 3_600_000);
  return `Événements : GDELT 15 min, ${formatEntier(etat.cellules.length)} zone${etat.cellules.length > 1 ? "s" : ""} sur ${formatEntier(fenetreH)} h, maj ${formatAge(etat.majA, nowMs)}`;
}

/** Note UCDP : fichier mensuel + âge de l'instantané daemon. */
export function noteConflits(etat: EtatConflitsUcdp | null, coucheActive: boolean, daemonOk: boolean, nowMs: number): string {
  if (!coucheActive) return "Conflits : désactivé";
  if (!daemonOk) return "Conflits : daemon hors ligne";
  if (etat === null) return "Conflits : UCDP en attente…";
  const version = etat.fichier.replace(/^GEDEvent_|\.csv$/g, "");
  return `Conflits : UCDP ${version} (~1 mois de lag), ${formatEntier(etat.zones.length)} zones, maj ${formatAge(etat.majA, nowMs)}`;
}

/** Note ISW : source non contractuelle, fraîcheur EditDate. */
export function noteUkraine(front: FrontUkraine | null, coucheActive: boolean, nowMs: number): string {
  if (!coucheActive) return "Ukraine : désactivé";
  if (front === null) return "Ukraine : ISW en attente…";
  const maj = front.majMs !== null ? `, maj ${formatAge(front.majMs, nowMs)}` : "";
  return `Ukraine : front ISW, ${formatEntier(front.n)} polygones${maj}`;
}
```

`apps/web/src/components/GlobeWindow.tsx` — câblage (suivre les patterns EXACTS déjà en place dans ce fichier) :

1. **États basse fréquence** (à côté de `chokepoints`/`etatAvions`) : `etatEvenements: EtatEvenements | null`, `conflitsUcdp: EtatConflitsUcdp | null`, `frontUkraine: FrontUkraine | null` — chacun doublé d'une ref (`cellulesRef`, `zonesRef`, `frontRef`) mise à jour au même moment que le `setState`, suivie de `throttleRef.current?.trigger()`.
2. **Chargements** (trois `useEffect` calqués sur les effets PortWatch/OpenSky existants, avec `AbortController` et gating `open && couches.<x>`) :
   - Événements : chargement immédiat + `setInterval(INTERVALLE_POLL_EVENEMENTS_MS)` tant que `open && couches.evenements` (pattern du poll OpenSky ligne ~193). `daemonOk` = résultat non-null au moins une fois ; conserver le dernier état non-null en cas d'échec ponctuel (pattern `echecAvions`).
   - Conflits UCDP : chargement UNE fois par ouverture si `couches.conflits` (mémo module côté data).
   - Front ISW : chargement UNE fois par ouverture si `couches.ukraine` (cache 6 h côté data).
3. **Appel `dessinerGlobe`** : remplacer les `[]`/`null` en dur de Task 9 par `couchesRef.current.evenements ? cellulesRef.current : []`, `couchesRef.current.conflits ? zonesRef.current : []`, `couchesRef.current.ukraine ? (frontRef.current?.collection as GeoPermissibleObjects | null) ?? null : null` (assertion locale documentée, pattern TERRES — `import type { GeoPermissibleObjects } from "d3-geo"`).
4. **Chips** : trois boutons de plus dans la rangée existante, même classe/aria-pressed que les actuels, pastilles `<span className="text-down">●</span> Événements`, `<span className="text-down">○</span> Conflits`, `<span className="text-down">▧</span> Ukraine` (pastilles distinctes : disque plein / anneau / hachure — la couleur seule ne suffit pas, trois couches partagent le rouge sémantique pour ISW/UCDP/matériel ; les catégories GDELT coercition/protestation restent identifiables par `--serie-4`/`--serie-2` dans le libellé survolé).
5. **Sous-titre** : `sousTitre="Conflits géopolitiques (GDELT · UCDP · ISW) · chokepoints (PortWatch) · trafic aérien (OpenSky)"`.
6. **Pied** : conserver la `NoteSource` actuelle (PortWatch/OpenSky) et la compléter : `{" "}· {noteEvenements(etatEvenements, couches.evenements, daemonOk, Date.now())} · {noteConflits(conflitsUcdp, couches.conflits, daemonOk, Date.now())} · {noteUkraine(frontUkraine, couches.ukraine, Date.now())}`.
7. **Condition `aucuneCouche`** (lignes ~277-279) : étendre aux 5 couches.

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom && pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck`
Attendu : PASS (suite web complète).

- [ ] **Step 5: Vérification réelle dans le navigateur**

```bash
cd ~/axiom && bun apps/daemon/src/index.ts &
pnpm dev
```
Ouvrir la fenêtre GLOBE : points rouges/roses/violets visibles sur les zones chaudes (Ukraine, Moyen-Orient attendus), cercles UCDP, polygone rouge translucide sur l'est de l'Ukraine, 5 chips toggleables (chaque toggle retire/remet sa couche), pied avec les âges des 5 sources. Survol d'un point → libellé catégorie/intensité. Arrêter le daemon (`kill %1`) et recharger : les couches GDELT/UCDP affichent « daemon hors ligne », le reste vit.

- [ ] **Step 6: Commit**

```bash
cd ~/axiom && git add apps/web/src/store/globe-ui.ts apps/web/src/components/globeWindow.util.ts apps/web/src/components/globeWindow.util.test.ts apps/web/src/components/GlobeWindow.tsx
git commit -m "feat(web): couches géopolitiques câblées — store 5 couches, chips, pied avec fraîcheurs"
```

### Task 11: Clic → panneau détail (`GlobeDetailPanel.tsx`)

**Files:**
- Create: `apps/web/src/components/globeDetail.util.ts` + `apps/web/src/components/globeDetail.util.test.ts`
- Create: `apps/web/src/components/GlobeDetailPanel.tsx`
- Modify: `apps/web/src/components/GlobeWindow.tsx`

**Interfaces:**
- Consomme : `chargerZoneEvenements` (Task 6), `hitTestCibles`/`CibleGlobe`/`LIBELLES_CATEGORIE` (Tasks 8-9), types Task 6, primitives `ui.tsx` (`Chargement`, `Vide`), `BTN_SECONDAIRE`.
- Produit :
  - `type SelectionGlobe = { type: "evenement"; lat: number; lon: number; cellule: CelluleEvenements } | { type: "conflit"; zone: ZoneConflitUcdp } | { type: "chokepoint"; chokepoint: Chokepoint }`
  - `globeDetail.util.ts` : `titreSelection(selection: SelectionGlobe): string` ; `sousTitreSelection(selection: SelectionGlobe, nowMs: number): string` ; `lignesEvenement(evt: EvenementDetail, nowMs: number): { entete: string; detail: string }`
  - `GlobeDetailPanel({ selection, evenements, onFermer }: { selection: SelectionGlobe; evenements: EvenementDetail[] | "chargement" | null; onFermer: () => void })` — markup seul, logique dans la fenêtre (contrat ui.tsx)

- [ ] **Step 1: Écrire le test qui échoue** (`apps/web/src/components/globeDetail.util.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { lignesEvenement, sousTitreSelection, titreSelection } from "./globeDetail.util";

const NOW = Date.UTC(2026, 6, 12, 12);

describe("globeDetail.util", () => {
  it("titres par type de sélection", () => {
    expect(titreSelection({ type: "evenement", lat: 48.5, lon: 35, cellule: { lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: NOW } })).toBe("Conflit armé — zone 48.5, 35");
    expect(titreSelection({ type: "conflit", zone: { lat: 48.5, lon: 35, morts: 42, n: 2, sideA: "A", sideB: "B", dernierMs: NOW } })).toContain("UCDP");
    expect(titreSelection({ type: "chokepoint", chokepoint: { id: "c6", nom: "Détroit d'Ormuz", lat: 26.3, lon: 56.9, nNavires: 34, nTankers: 17, nCargos: 17, date: "2026-07-05" } })).toBe("Détroit d'Ormuz");
  });
  it("sous-titre événement : n, intensité, mentions (PAS d'assertion sur le format exact de formatAge)", () => {
    const st = sousTitreSelection({ type: "evenement", lat: 48.5, lon: 35, cellule: { lat: 48.5, lon: 35, categorie: "materiel", n: 12, intensite: 10, mentions: 40, dernierMs: NOW - 1_800_000 } }, NOW);
    expect(st).toContain("12 événements");
    expect(st).toContain("10.0/10");
    expect(st).toContain("40 mentions");
  });
  it("ligne d'événement : acteurs, code CAMEO, goldstein, mentions", () => {
    const l = lignesEvenement({ dateMs: NOW - 3_600_000, categorie: "coercition", codeCameo: "172", goldstein: -5, mentions: 3, acteur1: "GOV", acteur2: "PROTESTERS", url: "https://x.test/a" }, NOW);
    expect(l.entete).toContain("GOV");
    expect(l.entete).toContain("PROTESTERS");
    expect(l.detail).toContain("CAMEO 172");
    expect(l.detail).toContain("-5");
  });
  it("acteurs absents → libellé neutre", () => {
    const l = lignesEvenement({ dateMs: NOW, categorie: "materiel", codeCameo: "190", goldstein: -10, mentions: 1, acteur1: null, acteur2: null, url: null }, NOW);
    expect(l.entete.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — `pnpm --filter @axiom/web test src/components/globeDetail.util.test.ts` → FAIL.

- [ ] **Step 3: Implémenter**

`apps/web/src/components/globeDetail.util.ts` :

```ts
/** Textes PURS du panneau détail du globe (testables sans DOM). */
import { formatAge, formatEntier } from "../lib/format";
import { LIBELLES_CATEGORIE } from "../lib/globeRender";
import type { CelluleEvenements, Chokepoint, EvenementDetail, ZoneConflitUcdp } from "../data/globe/types";

/** Sélection ouverte par un clic sur une cible du globe. */
export type SelectionGlobe =
  | { type: "evenement"; lat: number; lon: number; cellule: CelluleEvenements }
  | { type: "conflit"; zone: ZoneConflitUcdp }
  | { type: "chokepoint"; chokepoint: Chokepoint };

export function titreSelection(selection: SelectionGlobe): string {
  if (selection.type === "evenement") return `${LIBELLES_CATEGORIE[selection.cellule.categorie]} — zone ${selection.lat}, ${selection.lon}`;
  if (selection.type === "conflit") return `Conflit confirmé (UCDP) — zone ${selection.zone.lat}, ${selection.zone.lon}`;
  return selection.chokepoint.nom;
}

export function sousTitreSelection(selection: SelectionGlobe, nowMs: number): string {
  if (selection.type === "evenement") {
    const c = selection.cellule;
    return `${formatEntier(c.n)} événements · intensité max ${c.intensite.toFixed(1)}/10 · ${formatEntier(c.mentions)} mentions · dernier ${formatAge(c.dernierMs, nowMs)}`;
  }
  if (selection.type === "conflit") {
    const z = selection.zone;
    const acteurs = z.sideA !== null && z.sideB !== null ? ` · ${z.sideA} vs ${z.sideB}` : "";
    return `${formatEntier(z.morts)} morts (best) · ${formatEntier(z.n)} événements${acteurs} · dernier ${formatAge(z.dernierMs, nowMs)}`;
  }
  const c = selection.chokepoint;
  const navires = c.nNavires !== null ? `${formatEntier(c.nNavires)} navires` : "trafic n/d";
  return `${navires}${c.nTankers !== null ? ` · ${formatEntier(c.nTankers)} pétroliers` : ""}${c.date !== null ? ` · ${c.date}` : ""}`;
}

/** Deux lignes d'affichage pour un événement GDELT du panneau. */
export function lignesEvenement(evt: EvenementDetail, nowMs: number): { entete: string; detail: string } {
  const acteurs = evt.acteur1 !== null && evt.acteur2 !== null
    ? `${evt.acteur1} → ${evt.acteur2}`
    : (evt.acteur1 ?? evt.acteur2 ?? LIBELLES_CATEGORIE[evt.categorie]);
  return {
    entete: `${acteurs} · ${formatAge(evt.dateMs, nowMs)}`,
    detail: `CAMEO ${evt.codeCameo} · Goldstein ${evt.goldstein} · ${formatEntier(evt.mentions)} mentions`,
  };
}
```

`apps/web/src/components/GlobeDetailPanel.tsx` (markup seul — pattern SettingsPanel adapté en interne au conteneur relatif du corps ; `absolute` DANS `containerRef`, les events pointer/wheel ne touchent pas le canvas car leur cible est le panneau) :

```tsx
/**
 * Panneau latéral détail de la fenêtre GLOBE — MARKUP SEUL (contrat ui.tsx),
 * la logique (sélection, fetch de zone) vit dans GlobeWindow. Glisse depuis la
 * droite DANS le corps de la fenêtre (adaptation du pattern SettingsPanel).
 */
import { Chargement, Vide } from "./ui";
import { lignesEvenement, sousTitreSelection, titreSelection, type SelectionGlobe } from "./globeDetail.util";
import type { EvenementDetail } from "../data/globe/types";

export function GlobeDetailPanel({ selection, evenements, onFermer }: {
  selection: SelectionGlobe;
  /** Liste du détail de zone : "chargement", null (indisponible) ou les événements. */
  evenements: EvenementDetail[] | "chargement" | null;
  onFermer: () => void;
}) {
  const nowMs = Date.now();
  return (
    <div className="absolute right-0 top-0 z-10 flex h-full w-[min(280px,85%)] flex-col border-l border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-[12px] text-text">{titreSelection(selection)}</div>
          <div className="truncate text-[10px] text-text-dim">{sousTitreSelection(selection, nowMs)}</div>
        </div>
        <button type="button" onClick={onFermer} aria-label="Fermer le détail" className="ml-2 shrink-0 text-text-dim transition hover:text-text">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {selection.type !== "evenement" ? (
          <Vide>Détail agrégé ci-dessus — pas de liste d'événements pour cette couche.</Vide>
        ) : evenements === "chargement" ? (
          <Chargement libelle="Détail de la zone…" />
        ) : evenements === null ? (
          <Vide>Détail indisponible (daemon hors ligne ?).</Vide>
        ) : evenements.length === 0 ? (
          <Vide>Aucun événement dans la fenêtre servie.</Vide>
        ) : (
          <ul className="space-y-2">
            {evenements.map((evt, i) => {
              const l = lignesEvenement(evt, nowMs);
              return (
                <li key={i} className="border-b border-border pb-1.5 text-[11px] last:border-b-0">
                  <div className="text-text">{l.entete}</div>
                  <div className="text-text-dim">{l.detail}</div>
                  {evt.url !== null ? (
                    <a href={evt.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">source ↗</a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

Dans `GlobeWindow.tsx` :
1. États : `selection: SelectionGlobe | null` (null = panneau fermé) et `detailZone: EvenementDetail[] | "chargement" | null`.
2. **Discrimination clic/drag** (aucun onClick n'existe : `surPointerDown` pose `dragRef` immédiatement) : dans `surPointerDown`, mémoriser `clicDepartRef.current = { x: ev.clientX, y: ev.clientY }` ; dans `surPointerUp`, si le déplacement total `< 5 px` → traiter comme un clic : `hitTestCibles(ciblesRef.current, mx, my)` ; construire la `SelectionGlobe` selon `cible.couche` (cellule → `{ type: "evenement", lat: cellule.lat, lon: cellule.lon, cellule }`, etc.) ; `setSelection(...)` (UN setState par clic — autorisé). Clic dans le vide → `setSelection(null)`.
3. Effet `[selection]` : si `selection?.type === "evenement"` → `setDetailZone("chargement")` puis `chargerZoneEvenements(selection.lat, selection.lon, signal)` → `setDetailZone(resultat)` (AbortController au démontage) ; sinon `setDetailZone(null)`.
4. JSX : `{selection !== null ? <GlobeDetailPanel selection={selection} evenements={detailZone} onFermer={() => setSelection(null)} /> : null}` DANS le div `containerRef` (après le canvas et les surimpressions Chargement/Vide).

- [ ] **Step 4: Vérifier le passage**

Run : `cd ~/axiom && pnpm --filter @axiom/web test && pnpm --filter @axiom/web typecheck`
Attendu : PASS.

- [ ] **Step 5: Vérification réelle**

Daemon + `pnpm dev` : cliquer un point GDELT → panneau avec liste d'événements triés par mentions + liens sources cliquables ; cliquer un cercle UCDP → agrégat ; cliquer un chokepoint → trafic ; glisser le globe ne DOIT PAS ouvrir le panneau (discrimination 5 px) ; molette au-dessus du panneau scrolle le panneau, pas le zoom du globe.

- [ ] **Step 6: Commit**

```bash
cd ~/axiom && git add apps/web/src/components/globeDetail.util.ts apps/web/src/components/globeDetail.util.test.ts apps/web/src/components/GlobeDetailPanel.tsx apps/web/src/components/GlobeWindow.tsx
git commit -m "feat(web): panneau détail au clic sur le globe (zones GDELT, UCDP, chokepoints)"
```

### Task 12: Vérification finale bout-en-bout

**Files:** aucun nouveau — vérifications + éventuels correctifs.

- [ ] **Step 1: Suites complètes**

Run : `cd ~/axiom && pnpm -r typecheck && pnpm -r test`
Attendu : tout vert (1341 tests existants + ~45 nouveaux).

- [ ] **Step 2: Budget bundle (contrainte : pas d'explosion, zéro nouvelle dépendance)**

```bash
cd ~/axiom && pnpm build && gzip -c apps/web/dist/assets/index-*.js | wc -c
```
Attendu : ~272 549 o gzip + quelques Ko de code nouveau (< 285 000 o). Au-delà → chercher l'import accidentel.

- [ ] **Step 3: Vérification produit (daemon + navigateur, 2 thèmes)**

`bun apps/daemon/src/index.ts &` puis `pnpm dev`. Vérifier : couches visibles et toggleables, survols, clic→panneau, pied avec fraîcheurs, bascule de thème (couleurs suivent les tokens), rotation auto pausée pendant survol/drag et JAMAIS de jank pendant le drag (aucun re-render par frame). Vérifier `curl -s http://127.0.0.1:8787/globe/evenements | python3 -m json.tool | head -30`.

- [ ] **Step 4: Commit final éventuel** (si correctifs) puis signaler la fin du chantier 1. Le **chantier 2 (audit UI multi-agents)** part d'ici : app buildée + daemon, screenshots des 35 fenêtres × 2 thèmes, reviewers par dimension, findings vérifiés adversarialement, vagues de fixes — il génère son propre plan à partir des findings (hors périmètre de ce document).








