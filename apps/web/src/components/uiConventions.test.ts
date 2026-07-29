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

/** Scan récursif : les chemins imbriqués (ex. "omon/VueSmile.tsx") sont dans le périmètre du ratchet. */
const SOURCES: Array<{ nom: string; texte: string }> = readdirSync(DOSSIER, { recursive: true })
  .filter((f): f is string => typeof f === "string")
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test.") && !HORS_PERIMETRE.has(f))
  .map((nom) => ({ nom, texte: readFileSync(join(DOSSIER, nom), "utf8") }));

interface Motif {
  id: string;
  description: string;
  regex: RegExp;
  /** Fichiers encore autorisés à matcher (état au moment du commit — le ratchet). */
  exceptions: string[];
}

const MOTIFS: Motif[] = [
  {
    id: "champ-local",
    description: "constante input locale — utiliser <Input>/<Select> (ui.tsx)",
    regex: /const\s+input(Class|Cls)\s*=/,
    exceptions: ["PaperWindow.tsx"],
  },
  {
    id: "table-nue",
    description: "<table> nu — utiliser TableTriable",
    regex: /<table\b/,
    exceptions: [
      "PaperWindow.tsx", "MacroRatesWindow.tsx", "StablecoinsWindow.tsx",
      "CycleWindow.tsx", "DistWindow.tsx", "FundWindow.tsx", "FundingMatrixWindow.tsx",
      "brief/SectionSession.tsx", "brief/SectionWatchlist.tsx",
    ],
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
    exceptions: ["OnchainWindow.tsx"],
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
    exceptions: ["McapWindow.tsx", "DerivativesWindow.tsx"],
  },
  {
    id: "btn-secondaire-copie",
    description: "classes de BTN_SECONDAIRE recopiées inline — utiliser <Bouton>",
    regex: /border-border bg-bg px-2 py-1 text-\[11px\] text-text-dim/,
    exceptions: [
      "McapWindow.tsx",
      "CbpremWindow.tsx", "CycleWindow.tsx", "DistWindow.tsx",
      "ExpyWindow.tsx", "MineWindow.tsx", "NetliqWindow.tsx", "SqueezeWindow.tsx",
    ],
  },
  {
    id: "police-canvas-divergente",
    description: "police canvas non standard — utiliser POLICE_CANVAS (canvasTokens)",
    regex: /(9px ui-sans-serif|11px ui-monospace|10px system-ui)/,
    exceptions: [
      "CorrWindow.tsx", "McapWindow.tsx", "EvtsWindow.tsx", "VolWindow.tsx",
      "StablecoinsWindow.tsx", "OnchainWindow.tsx",
      "CbpremWindow.tsx", "CycleWindow.tsx", "DomWindow.tsx", "ExpyWindow.tsx",
      "NetliqWindow.tsx", "SqueezeWindow.tsx", "TermStructureWindow.tsx",
    ],
  },
];

describe("conventions UI (ratchet)", () => {
  for (const motif of MOTIFS) {
    it(`${motif.id} — ${motif.description}`, () => {
      const fautifs = SOURCES.filter((s) => motif.regex.test(s.texte)).map((s) => s.nom).sort();
      expect(
        fautifs,
        `Fichiers matchant « ${motif.id} » (mettre à jour exceptions UNIQUEMENT en migrant)`,
      ).toEqual([...motif.exceptions].sort());
    });
  }
});
