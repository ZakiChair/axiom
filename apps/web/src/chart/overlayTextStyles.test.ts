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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Racine `src/` : le périmètre est TOUT le code app, pas seulement `chart/` — la
 * première figure texte trouvée hors de ce dossier (lib/navigation.ts) était justement
 * passée au travers du verrou et rendue illisible par le thème d'overlay. */
const RACINE = dirname(dirname(fileURLToPath(import.meta.url)));

/** Fichiers source de `src/`, hors tests, récursivement. */
function sourcesApp(dossier: string): string[] {
  const out: string[] = [];
  for (const entree of readdirSync(dossier)) {
    if (entree === "node_modules") continue;
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) out.push(...sourcesApp(chemin));
    else if (/\.tsx?$/.test(entree) && !/\.test\.tsx?$/.test(entree)) out.push(chemin);
  }
  return out;
}

/** Fenêtre de source à inspecter après un `type: "text"` (une figure tient largement dedans). */
const PORTEE_LIGNES = 30;

/** Retire commentaires de ligne et de bloc — un `backgroundColor` cité en prose ne compte pas. */
function sansCommentaires(source: string): string {
  // Les lignes sont préservées (les numéros rapportés doivent rester justes).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Repère chaque `type: "text"` et vérifie qu'un `backgroundColor` est réellement POSÉ
 * dans la même figure. PURE (entrée : source ; sortie : numéros de ligne fautifs).
 *
 * Deux pièges que ce verrou doit éviter, tous deux constatés :
 *  - un simple COMMENTAIRE contenant le mot suffisait à le satisfaire (le modèle à
 *    recopier étant justement un bloc de commentaire, la confusion était probable) ;
 *  - la figure SUIVANTE, correctement stylée, couvrait la précédente quand deux figures
 *    texte se suivaient — d'où la coupure au prochain `type:` QUEL QU'IL SOIT.
 */
export function figuresTexteSansFond(source: string): number[] {
  const lignes = sansCommentaires(source).split("\n");
  const fautifs: number[] = [];
  for (let i = 0; i < lignes.length; i++) {
    if (!/type:\s*["']text["']/.test(lignes[i] ?? "")) continue;
    const suite = lignes.slice(i + 1, i + PORTEE_LIGNES).join("\n");
    // Fin de figure = prochain `type:` (y compris un autre `text`) — sinon la figure
    // voisine prêterait son style à celle qui n'en a pas.
    const finFigure = suite.search(/type:\s*["']/);
    const bloc = finFigure >= 0 ? suite.slice(0, finFigure) : suite;
    if (!/backgroundColor\s*:/.test(bloc)) fautifs.push(i + 1);
  }
  return fautifs;
}

describe("figures texte d'overlay", () => {
  const fichiers = sourcesApp(RACINE);

  it("le code contient bien des figures texte (le verrou a une cible)", () => {
    const total = fichiers.reduce(
      (n, f) => n + (readFileSync(f, "utf8").match(/type:\s*["']text["']/g)?.length ?? 0),
      0
    );
    expect(total).toBeGreaterThan(5);
  });

  it("le périmètre déborde de chart/ (une figure texte y a déjà échappé)", () => {
    const horsChart = fichiers.filter(
      (f) => !relative(RACINE, f).startsWith("chart/") && /type:\s*["']text["']/.test(readFileSync(f, "utf8"))
    );
    expect(horsChart.length).toBeGreaterThan(0);
  });

  it.each(fichiers.map((f) => relative(RACINE, f)))(
    "%s : chaque figure texte surcharge backgroundColor",
    (relatif) => {
      const fautifs = figuresTexteSansFond(readFileSync(join(RACINE, relatif), "utf8"));
      expect(
        fautifs,
        `${relatif} : figure(s) texte sans backgroundColor aux lignes ${fautifs.join(", ")} — ` +
          `le fond de texte d'overlay s'appliquera (l'accent du thème depuis applyChartTheme, ` +
          `#1677FF de klinecharts sans lui), et l'étiquette sera écrite dans la couleur de son ` +
          `propre fond. Poser backgroundColor: "transparent" (ou un token via rgbaTokenCanvas), ` +
          `cf. chart/annotationsPrix.ts.`
      ).toEqual([]);
    }
  );
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

  it("deux figures TEXTE consécutives : la seconde ne couvre pas la première", () => {
    const src = `{
      type: "text",
      styles: { color: "red" },
    }, {
      type: "text",
      styles: { color: "red", backgroundColor: "transparent" },
    }`;
    expect(figuresTexteSansFond(src)).toEqual([2]);
  });

  it("un COMMENTAIRE citant backgroundColor ne satisfait pas le verrou", () => {
    const src = `{
      type: "text",
      // backgroundColor: "transparent" OBLIGATOIRE (copié depuis annotationsPrix.ts)
      styles: { color: "red" },
    }`;
    expect(figuresTexteSansFond(src)).toEqual([2]);
  });

  it("un commentaire de BLOC citant backgroundColor ne le satisfait pas non plus", () => {
    const src = `{
      type: "text",
      /* pense-bête : backgroundColor est requis ici */
      styles: { color: "red" },
    }`;
    expect(figuresTexteSansFond(src)).toEqual([2]);
  });
});
