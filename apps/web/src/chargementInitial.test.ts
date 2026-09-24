/**
 * Garde-fou du chemin de chargement initial (budget d'entrée vérifié au build par
 * scripts/verifier-budget-build.mjs, plafond 360 000 o gzip niveau 9).
 *
 * Certains modules ne servent qu'une fois leur fenêtre montée ou leur action lancée : leur
 * fenêtre les tire par React.lazy, un calcul par `import()`. Un seul import statique depuis
 * un module du chemin initial (main.tsx et ses imports statiques transitifs) les ferait
 * revenir dans le chunk d'entrée — `store/backtest.ts` y pesait 6,7 Ko gzip pour la seule
 * commande BT de la palette, désormais une bascule du gestionnaire de fenêtres.
 *
 * Ce test reconstruit ce chemin depuis les sources : imports relatifs de VALEUR (un import de
 * types est effacé à la compilation ; un import mixte `{ a, type B }` reste de valeur), effets
 * de bord `import "x"` et ré-exports compris ; `import()` reste différé. Les lignes de
 * commentaire sont ignorées. Le graphe obtenu peut compter une arête de trop (un import de
 * valeur utilisé seulement comme type), jamais une de moins : le garde-fou penche vers le refus.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url)); // apps/web/src

/** Modules différés : jamais sur le chemin initial (chemins src-relatifs, sans extension). */
const MODULES_DIFFERES: Record<string, string> = {
  "store/backtest": "store du backtest — chargé avec BacktestWindow (React.lazy)",
  "data/backtestFunding": "funding réel du backtest — import() au lancement d'un run",
  "data/brief": "overnight de la watchlist — import() depuis rafraichirRegime (commit 7784984)",
};

/** `import type { A } from "x"`, `import type * as M from "x"`, `export type { A } from "x"`, multi-lignes compris. */
const IMPORT_TYPE =
  /\b(?:import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)|export\s+type\s*\{[^}]*\})\s*from\s*["'][^"']*["']/g;
/** Spécificateurs statiques : `from "x"` (import ou ré-export) et `import "x"` (effet de bord). */
const SPECIFIANT_STATIQUE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
/** Ligne de commentaire (`//`, ouverture ou corps d'un bloc `/* … *\/`). */
const LIGNE_COMMENTAIRE = /^\s*(?:\/\/|\/\*|\*).*$/gm;

/** Spécificateurs relatifs importés statiquement par `texte`. */
function specifiantsStatiques(texte: string): string[] {
  const code = texte.replace(LIGNE_COMMENTAIRE, "").replace(IMPORT_TYPE, "");
  const resultat: string[] = [];
  for (const m of code.matchAll(SPECIFIANT_STATIQUE)) {
    const specifiant = m[1] ?? m[2];
    if (specifiant !== undefined && specifiant.startsWith(".")) resultat.push(specifiant);
  }
  return resultat;
}

/** Fichier source (src-relatif, séparateurs « / ») d'un spécificateur relatif, ou null (CSS, asset…). */
function resoudre(fichier: string, specifiant: string): string | null {
  const base = posix.join(posix.dirname(fichier), specifiant.replace(/\?.*$/, "")).replace(/\.js$/, "");
  for (const candidat of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (!/\.(ts|tsx)$/.test(candidat)) continue;
    const absolu = join(SRC, candidat);
    if (existsSync(absolu) && statSync(absolu).isFile()) return candidat;
  }
  return null;
}

/** Modules atteints depuis main.tsx par imports statiques (src-relatifs, sans extension). */
function cheminInitial(): Map<string, string> {
  const parent = new Map<string, string>([["main.tsx", ""]]);
  const pile = ["main.tsx"];
  while (pile.length > 0) {
    const fichier = pile.pop() as string;
    for (const specifiant of specifiantsStatiques(readFileSync(join(SRC, fichier), "utf8"))) {
      const cible = resoudre(fichier, specifiant);
      if (cible === null || parent.has(cible)) continue;
      parent.set(cible, fichier);
      pile.push(cible);
    }
  }
  return new Map([...parent].map(([f, p]) => [f.replace(/\.(ts|tsx)$/, ""), p]));
}

/** Chaîne d'imports main.tsx → … → module, pour le diagnostic. */
function chaine(parents: Map<string, string>, module: string): string {
  const etapes = [module];
  let courant = parents.get(module);
  while (courant !== undefined && courant !== "") {
    etapes.unshift(courant);
    courant = parents.get(courant.replace(/\.(ts|tsx)$/, ""));
  }
  return etapes.join(" → ");
}

describe("chemin de chargement initial", () => {
  it("lit les imports de valeur et laisse passer types, import() et commentaires", () => {
    expect(specifiantsStatiques('import { a } from "./a";\nexport { b } from "../b";\nimport "./effet";')).toEqual([
      "./a",
      "../b",
      "./effet",
    ]);
    expect(specifiantsStatiques('import { a, type B } from "./mixte";')).toEqual(["./mixte"]);
    expect(specifiantsStatiques('import type {\n  A,\n  B,\n} from "./types";\nexport type { C } from "./c";')).toEqual([]);
    expect(specifiantsStatiques('const m = await import("./differe");')).toEqual([]);
    expect(specifiantsStatiques('/**\n * import { x } from "./doc";\n */\n// import "./ligne";')).toEqual([]);
    expect(specifiantsStatiques('import { createStore } from "zustand/vanilla";')).toEqual([]);
  });

  it("reconstruit le vrai chemin initial (témoins présents)", () => {
    const chemin = cheminInitial();
    // Témoins : sans eux, un garde-fou vide passerait au vert sans rien vérifier.
    for (const temoin of ["App", "commands/windowPanels", "store/windowManager", "chart/ChartInstance"]) {
      expect(chemin.has(temoin), `témoin absent du chemin initial : ${temoin}`).toBe(true);
    }
  });

  it("aucun module différé n'est importé statiquement depuis le chemin initial", () => {
    const chemin = cheminInitial();
    const fautes = Object.keys(MODULES_DIFFERES)
      .filter((module) => chemin.has(module))
      .map((module) => `${chaine(chemin, module)} (${MODULES_DIFFERES[module]})`);
    expect(fautes).toEqual([]);
  });
});
