import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../scripts/verifier-budget-build.mjs", import.meta.url));
const repertoires: string[] = [];

afterEach(async () => {
  await Promise.all(repertoires.splice(0).map((repertoire) => rm(repertoire, { recursive: true, force: true })));
});

async function creerDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), "axiom-budget-build-"));
  repertoires.push(dist);
  await mkdir(join(dist, ".vite"));
  await mkdir(join(dist, "assets"));
  return dist;
}

async function ecrire(dist: string, chemin: string, contenu: string | Uint8Array): Promise<void> {
  const cible = join(dist, chemin);
  await mkdir(dirname(cible), { recursive: true });
  await writeFile(cible, contenu);
}

function verifier(dist: string) {
  return spawnSync(process.execPath, [script, dist], { encoding: "utf8" });
}

describe("verifier-budget-build", () => {
  it("déduplique le graphe statique initial et compte les imports dynamiques séparément", async () => {
    const dist = await creerDist();
    await ecrire(
      dist,
      "index.html",
      '<script type="module" src="/assets/main.js"></script><link rel="modulepreload" href="/assets/vendor.js">',
    );
    await ecrire(
      dist,
      ".vite/manifest.json",
      JSON.stringify({
        "index.html": { file: "assets/main.js", isEntry: true, imports: ["vendor"], dynamicImports: ["lazy"] },
        vendor: { file: "assets/vendor.js", imports: ["shared"] },
        shared: { file: "assets/shared.js" },
        lazy: { file: "assets/lazy.js", imports: ["shared", "dynamic-only"] },
        "dynamic-only": { file: "assets/dynamic-only.js" },
      }),
    );
    await ecrire(dist, "assets/main.js", "main");
    await ecrire(dist, "assets/vendor.js", "vendor");
    await ecrire(dist, "assets/shared.js", "s");
    await ecrire(dist, "assets/lazy.js", "lazy");
    await ecrire(dist, "assets/dynamic-only.js", "dynamic");

    const resultat = verifier(dist);

    expect(resultat.status, resultat.stderr).toBe(0);
    const budget = JSON.parse(resultat.stdout) as {
      initial: { fichiers: string[]; octetsBruts: number; octetsGzip: number };
      dynamique: { fichiers: string[]; octetsBruts: number };
    };
    expect(budget.initial.fichiers).toEqual(["assets/main.js", "assets/shared.js", "assets/vendor.js"]);
    expect(budget.initial.octetsBruts).toBe(11);
    expect(budget.initial.octetsGzip).toBeGreaterThan(0);
    expect(budget.dynamique.fichiers).toEqual(["assets/dynamic-only.js", "assets/lazy.js"]);
    expect(budget.dynamique.octetsBruts).toBe(11);
  });

  it("échoue si le manifeste est absent ou mal formé", async () => {
    const absent = await creerDist();
    const resultatAbsent = verifier(absent);
    expect(resultatAbsent.status).not.toBe(0);
    expect(resultatAbsent.stderr).toContain("manifest introuvable");

    const invalide = await creerDist();
    await ecrire(invalide, ".vite/manifest.json", "{");
    const resultatInvalide = verifier(invalide);
    expect(resultatInvalide.status).not.toBe(0);
    expect(resultatInvalide.stderr).toContain("manifest invalide");

    const entreeInvalide = await creerDist();
    await ecrire(entreeInvalide, ".vite/manifest.json", JSON.stringify({
      "index.html": { file: "assets/main.js", imports: "vendor" },
    }));
    const resultatEntreeInvalide = verifier(entreeInvalide);
    expect(resultatEntreeInvalide.status).not.toBe(0);
    expect(resultatEntreeInvalide.stderr).toContain("manifest invalide");
  });

  it("échoue si le graphe ou une ressource du manifeste est absent", async () => {
    const dist = await creerDist();
    await ecrire(dist, "index.html", '<script type="module" src="/assets/main.js"></script>');
    await ecrire(
      dist,
      ".vite/manifest.json",
      JSON.stringify({ "index.html": { file: "assets/main.js", imports: ["vendor"] } }),
    );
    await ecrire(dist, "assets/main.js", "main");

    const resultat = verifier(dist);

    expect(resultat.status).not.toBe(0);
    expect(resultat.stderr).toContain("import absent du manifeste");
  });

  it("bloque un graphe initial qui dépasse le plafond brut", async () => {
    const dist = await creerDist();
    await ecrire(dist, "index.html", '<script type="module" src="/assets/main.js"></script>');
    await ecrire(
      dist,
      ".vite/manifest.json",
      JSON.stringify({ "index.html": { file: "assets/main.js", isEntry: true } }),
    );
    await ecrire(dist, "assets/main.js", new Uint8Array(1_220_001));

    const resultat = verifier(dist);

    expect(resultat.status).not.toBe(0);
    expect(resultat.stderr).toContain("budget JS initial brut dépassé");
  });
});
