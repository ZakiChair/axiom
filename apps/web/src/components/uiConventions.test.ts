/**
 * Conventions UI — test « RATCHET » (Lot 1 Socle UI).
 *
 * Scanne les sources de src/components et interdit les patterns locaux remplacés
 * par les primitives de ui.tsx / TableTriable.tsx. Les `exceptions` sont les
 * fichiers PAS ENCORE migrés : chaque vague de migration retire des entrées.
 * ÉGALITÉ STRICTE dans les deux sens — un fichier listé qui ne matche plus est
 * une exception périmée (à retirer), un fichier non listé qui matche est une
 * régression (interdite).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const DOSSIER = dirname(fileURLToPath(import.meta.url));
/** Fichiers hors périmètre : primitives elles-mêmes. */
const HORS_PERIMETRE = new Set(["ui.tsx", "TableTriable.tsx"]);

/**
 * Scan récursif : les chemins imbriqués (ex. "omon/VueSmile.tsx") sont dans le périmètre du
 * ratchet. Tous les fichiers `.ts`/`.tsx` sont indexés ici — chaque motif restreint ensuite
 * lui-même les extensions qu'il scrute via `extensions` (par défaut `.tsx` seul : élargir aux
 * `.ts` à la légère ferait matcher des fichiers hors sujet, ex. chaînes dans des commentaires).
 */
const TOUTES_SOURCES: Array<{ nom: string; texte: string }> = readdirSync(DOSSIER, { recursive: true })
  .filter((f): f is string => typeof f === "string")
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.") && !HORS_PERIMETRE.has(f))
  .map((nom) => ({ nom, texte: readFileSync(join(DOSSIER, nom), "utf8") }));

interface Motif {
  id: string;
  description: string;
  regex: RegExp;
  /** Fichiers encore autorisés à matcher (état au moment du commit — le ratchet). */
  exceptions: string[];
  /** Extensions scrutées par ce motif (défaut : `.tsx` seul). */
  extensions?: Array<".ts" | ".tsx">;
}

const MOTIFS: Motif[] = [
  {
    id: "champ-local",
    description: "constante input locale — utiliser <Input>/<Select> (ui.tsx)",
    regex: /const\s+input(Class|Cls)\s*=/,
    exceptions: [],
  },
  {
    id: "table-nue",
    description: "<table> nu — utiliser TableTriable",
    regex: /<table\b/,
    exceptions: [],
  },
  {
    id: "sort-header-local",
    description: "SortHeader local dupliqué — utiliser TableTriable",
    regex: /function SortHeader\(/,
    exceptions: [],
  },
  {
    id: "tuile-locale",
    description: "tuile KPI locale — utiliser TuileStat",
    regex: /function (StatCard|StatMC|Widget)\(/,
    exceptions: [],
  },
  {
    id: "segmente-maison",
    description: "segmenté compact maison — utiliser SegmenteCompact ou CLASSES_SEGMENT_*",
    regex: /rounded border border-border p-0\.5/,
    exceptions: [],
  },
  {
    id: "barre-progression-maison",
    description: "barre de progression maison — utiliser BarreProgression",
    regex: /h-1 w-(full|64) overflow-hidden rounded/,
    exceptions: [],
  },
  {
    id: "btn-secondaire-copie",
    description: "classes de BTN_SECONDAIRE recopiées inline — utiliser <Bouton>",
    regex: /border-border bg-bg px-2 py-1 text-\[11px\] text-text-dim/,
    exceptions: [],
  },
  {
    id: "police-canvas-divergente",
    description: "police canvas non standard — utiliser POLICE_CANVAS/POLICE_CANVAS_MONO (canvasTokens)",
    // Couvre aussi bien la variante sans-serif (POLICE_CANVAS) que la variante à chasse fixe
    // (POLICE_CANVAS_MONO, 10px ET 11px ui-monospace relevés en dur) — le carnet/tape et les
    // matrices de chiffres (CorrWindow) ont besoin d'une police à chasse fixe pour l'alignement
    // des colonnes (fillText canvas ne bénéficie pas de tabular-nums CSS) : la constante
    // consacre cette valeur au lieu de la chaîne en dur. Scan étendu aux .ts (dessins.ts).
    regex: /(9px ui-sans-serif|1[01]px ui-monospace|10px system-ui)/,
    extensions: [".ts", ".tsx"],
    exceptions: [],
  },
  {
    // Le ratchet matchait sur des IDENTIFIANTS (`const inputClass =`, `function StatCard(`) :
    // un champ écrit directement `className="bg-neutral-800 px-1.5 py-0.5 text-xs"` passait
    // au travers — c'est exactement ce qui laissait les réglages du menu Indicateurs sans
    // bordure ni fond thémé, invisibles en thème clair (revue du 2026-08-01 § 6.4).
    // Ce motif regarde le RENDU, pas le nom.
    id: "champ-inline-non-tokenise",
    description:
      "champ de saisie stylé en classes littérales — utiliser <Input>/<Select> (CLASSES_CHAMP)",
    // `[^<]` borne la recherche à l'intérieur de la balise : le `>` d'une flèche
    // (`onChange={(e) => …}`) ne doit pas la couper, mais un élément voisin ne doit
    // pas être happé non plus.
    // Les DEUX formes d'attribut : `className="…"` ET `className={`…`}` — la forme
    // gabarit est précisément celle que produit la migration, un contournement
    // trivial sinon (revue adversariale BCD).
    regex: /<(?:input|select)\b[^<]{0,400}?className=(?:"[^"]*bg-neutral-\d{3}|\{`[^`]*bg-neutral-\d{3})/,
    extensions: [".tsx"],
    exceptions: [],
  },
  {
    id: "metric-deprecie",
    description: "Metric supprimé — utiliser TuileStat",
    regex: /\bMetric\b/,
    exceptions: [],
  },
];

describe("conventions UI (ratchet)", () => {
  for (const motif of MOTIFS) {
    it(`${motif.id} — ${motif.description}`, () => {
      const extensions = motif.extensions ?? [".tsx"];
      const sources = TOUTES_SOURCES.filter((s) => extensions.some((ext) => s.nom.endsWith(ext)));
      const fautifs = sources.filter((s) => motif.regex.test(s.texte)).map((s) => s.nom).sort();
      expect(
        fautifs,
        `Fichiers matchant « ${motif.id} » (mettre à jour exceptions UNIQUEMENT en migrant)`,
      ).toEqual([...motif.exceptions].sort());
    });
  }
});
