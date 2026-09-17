/**
 * Garde-fou « chunk à la demande » du client CryptoQuant (spec 2026-09-16, invariant I11).
 *
 * `data/onchain/cryptoquant.ts` n'est chargé que par `import()` depuis les sections DES et
 * CHAIN. Un import statique depuis n'importe quel autre module, y compris un voisin de
 * `data/onchain/` (import transitif), le ferait entrer dans un chunk partagé dont le nom
 * s'ajoute aux préchargements de l'entrée (budget initial bloquant). Seul le client lui-même
 * est exempté. Les imports de TYPES sont effacés à la compilation et restent permis ; un
 * import mixte (`import { a, type B }`) reste un import de valeur et est refusé. Le store de
 * clé `store/cryptoquant.ts` porte le même nom de fichier mais n'est pas le client. Les
 * fichiers de test (dont ceux du client) ne sont pas bundlés : hors périmètre.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url)); // apps/web/src

const CIBLE = "data/onchain/cryptoquant";
/** `import type { A } from "x"`, `import type * as M from "x"` et `export type { A } from "x"`, multi-lignes compris. */
const IMPORT_TYPE =
  /\b(?:import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)|export\s+type\s*\{[^}]*\})\s*from\s*["'][^"']*["']/g;
/** Spécificateurs statiques : `from "x"` (import ou ré-export) et `import "x"` (effet de bord). */
const SPECIFIANT_STATIQUE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

/** Le client lui-même, seul fichier source exempté. */
const FICHIER_CLIENT = `${CIBLE}.ts`;

/** Chemin src-relatif, sans extension, d'un spécificateur relatif ; `null` pour un paquet. */
function resoudre(fichier: string, specifiant: string): string | null {
  if (!specifiant.startsWith(".")) return null;
  return posix.join(posix.dirname(fichier), specifiant).replace(/\.(ts|tsx|js)$/, "");
}

/** Imports statiques du client trouvés dans `texte` (fichier src-relatif, séparateurs « / »). */
function importsStatiquesDuClient(fichier: string, texte: string): string[] {
  const fautes: string[] = [];
  for (const m of texte.replace(IMPORT_TYPE, "").matchAll(SPECIFIANT_STATIQUE)) {
    const specifiant = m[1] ?? m[2];
    if (specifiant !== undefined && resoudre(fichier, specifiant) === CIBLE) fautes.push(`${fichier} → ${specifiant}`);
  }
  return fautes;
}

function sources(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));
}

describe("client CryptoQuant chargé à la demande", () => {
  it("détecte les imports de valeur et laisse passer types, import() et store homonyme", () => {
    const util = "components/fluxTakers.util.ts";
    expect(importsStatiquesDuClient(util, 'import { cheminSerie } from "../data/onchain/cryptoquant";')).toEqual([
      "components/fluxTakers.util.ts → ../data/onchain/cryptoquant",
    ]);
    expect(
      importsStatiquesDuClient(util, 'import { cheminSerie, type ArchiveCq } from "../data/onchain/cryptoquant";'),
    ).toHaveLength(1);
    expect(importsStatiquesDuClient(util, 'import "../data/onchain/cryptoquant.js";')).toHaveLength(1);
    expect(
      importsStatiquesDuClient(
        "components/onchain/MineursCotes.tsx",
        'export { chargerSerieCq } from "../../data/onchain/cryptoquant";',
      ),
    ).toHaveLength(1);
    expect(importsStatiquesDuClient(util, 'import type { ArchiveCq } from "../data/onchain/cryptoquant";')).toEqual([]);
    expect(
      importsStatiquesDuClient(util, 'import type {\n  ArchiveCq,\n  SerieCq,\n} from "../data/onchain/cryptoquant";'),
    ).toEqual([]);
    expect(importsStatiquesDuClient(util, 'const cq = await import("../data/onchain/cryptoquant");')).toEqual([]);
    // Un homonyme ailleurs n'est pas le client : ni `./onchain/cryptoquant`, ni le store de clé.
    expect(importsStatiquesDuClient(util, 'import { x } from "./onchain/cryptoquant";')).toEqual([]);
    expect(
      importsStatiquesDuClient(util, 'import { RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";'),
    ).toEqual([]);
    // Un alias de type avant un vrai import ne masque pas ce dernier.
    expect(
      importsStatiquesDuClient(util, 'export type A = string;\nimport { cheminSerie } from "../data/onchain/cryptoquant";'),
    ).toHaveLength(1);
  });

  it("aucun fichier source, voisins de data/onchain/ compris, n'importe statiquement le client", () => {
    expect(sources().filter((f) => f.startsWith("data/onchain/cryptoquant"))).toEqual([FICHIER_CLIENT]);
    // Voisin de data/onchain/ : un import transitif est refusé comme les autres.
    expect(importsStatiquesDuClient("data/onchain/mineurs.ts", 'import { SERIES_MINEURS } from "./cryptoquant";')).toHaveLength(1);
    const fautes = sources()
      .filter((f) => f !== FICHIER_CLIENT)
      .flatMap((f) => importsStatiquesDuClient(f, readFileSync(join(SRC, f), "utf8")));
    expect(fautes).toEqual([]);
  });

  it("la section DES charge le client par import()", () => {
    const section = readFileSync(join(SRC, "components/FluxTakersSection.tsx"), "utf8");
    expect(section).toContain('await import("../data/onchain/cryptoquant")');
  });
});
