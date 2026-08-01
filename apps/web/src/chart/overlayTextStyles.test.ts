/**
 * Verrou : toute figure d'overlay `type: "text"` DOIT surcharger `backgroundColor`.
 *
 * POURQUOI un test de fichier plutôt qu'un test de comportement : le piège est
 * structurel, pas logique. `getDefaultOverlayStyle().text()` de klinecharts@9.8.12
 * peint les figures texte sur une pastille pleine `#1677FF`, et les styles d'une
 * figure sont MERGÉS aux défauts — un override partiel (juste `color`) laisse donc
 * l'aplat bleu, invariant au thème, par-dessus les bougies. Le défaut ne casse
 * aucun test de rendu, il ne se voit qu'à l'œil ; il s'est reproduit sur 8 des 9
 * figures texte du dossier alors que la 9e portait déjà le correctif ET son
 * explication. Le seul garde-fou qui tient est donc lexical, sur la source.
 *
 * Ce test échoue aussi sur la prochaine figure texte écrite sans le style — c'est
 * son objet.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOSSIER = dirname(fileURLToPath(import.meta.url));

/** Fenêtre de source à inspecter après un `type: "text"` (une figure tient largement dedans). */
const PORTEE_LIGNES = 30;

/**
 * Repère chaque `type: "text"` et vérifie qu'un `backgroundColor` apparaît dans la
 * même figure. PURE (entrée : source ; sortie : numéros de ligne fautifs).
 */
export function figuresTexteSansFond(source: string): number[] {
  const lignes = source.split("\n");
  const fautifs: number[] = [];
  for (let i = 0; i < lignes.length; i++) {
    if (!/type:\s*["']text["']/.test(lignes[i] ?? "")) continue;
    const fenetre = lignes.slice(i, i + PORTEE_LIGNES).join("\n");
    // La figure se termine au prochain `type:` d'une AUTRE figure, sinon à la fenêtre.
    const suite = fenetre.slice(fenetre.indexOf("\n") + 1);
    const finFigure = suite.search(/type:\s*["'](?!text)/);
    const bloc = finFigure >= 0 ? suite.slice(0, finFigure) : suite;
    if (!/backgroundColor/.test(bloc)) fautifs.push(i + 1);
  }
  return fautifs;
}

describe("figures texte d'overlay", () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("le dossier contient bien des figures texte (le verrou a une cible)", () => {
    const total = fichiers.reduce(
      (n, f) => n + (readFileSync(join(DOSSIER, f), "utf8").match(/type:\s*["']text["']/g)?.length ?? 0),
      0
    );
    expect(total).toBeGreaterThan(5);
  });

  it.each(fichiers)("%s : chaque figure texte surcharge backgroundColor", (fichier) => {
    const fautifs = figuresTexteSansFond(readFileSync(join(DOSSIER, fichier), "utf8"));
    expect(
      fautifs,
      `${fichier} : figure(s) texte sans backgroundColor aux lignes ${fautifs.join(", ")} — ` +
        `le fond #1677FF de klinecharts s'appliquera. Poser backgroundColor: "transparent" ` +
        `(ou un token via rgbaTokenCanvas), cf. annotationsPrix.ts.`
    ).toEqual([]);
  });
});

describe("figuresTexteSansFond", () => {
  it("repère une figure texte sans fond", () => {
    const src = `{
      type: "text",
      attrs: { x: 1, y: 2, text: "a" },
      styles: { color: "red", size: 10 },
    }`;
    expect(figuresTexteSansFond(src)).toEqual([2]);
  });

  it("accepte une figure texte qui surcharge le fond", () => {
    const src = `{
      type: "text",
      attrs: { x: 1, y: 2, text: "a" },
      styles: { color: "red", size: 10, backgroundColor: "transparent" },
    }`;
    expect(figuresTexteSansFond(src)).toEqual([]);
  });

  it("ne confond pas deux figures voisines : le fond de la SUIVANTE ne couvre pas la texte", () => {
    const src = `{
      type: "text",
      attrs: { x: 1, y: 2, text: "a" },
      styles: { color: "red" },
    }, {
      type: "rect",
      styles: { backgroundColor: "blue" },
    }`;
    expect(figuresTexteSansFond(src)).toEqual([2]);
  });
});
