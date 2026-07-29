import { describe, expect, it } from "vitest";
import { basculerTri, trierLignes, TableTriable, type ColonneTable } from "./TableTriable";

interface Ligne { sym: string; prix: number | null; }
const COLS: ColonneTable<Ligne>[] = [
  { id: "sym", label: "Symbole", triable: true, valeurTri: (l) => l.sym, rendu: (l) => l.sym },
  { id: "prix", label: "Prix", align: "right", triable: true, valeurTri: (l) => l.prix, rendu: (l) => String(l.prix) },
];
const LIGNES: Ligne[] = [
  { sym: "ETH", prix: 3200 },
  { sym: "BTC", prix: 64000 },
  { sym: "XRP", prix: null },
];

describe("basculerTri", () => {
  it("nouvelle colonne → desc ; même colonne → inversion", () => {
    expect(basculerTri(null, "prix")).toEqual({ colonne: "prix", dir: -1 });
    expect(basculerTri({ colonne: "prix", dir: -1 }, "prix")).toEqual({ colonne: "prix", dir: 1 });
    expect(basculerTri({ colonne: "prix", dir: 1 }, "sym")).toEqual({ colonne: "sym", dir: -1 });
  });
});

describe("trierLignes", () => {
  it("nombres desc, null TOUJOURS en fin, entrée non mutée", () => {
    const copie = [...LIGNES];
    const tri = trierLignes(LIGNES, COLS, { colonne: "prix", dir: -1 });
    expect(tri.map((l) => l.sym)).toEqual(["BTC", "ETH", "XRP"]);
    expect(trierLignes(LIGNES, COLS, { colonne: "prix", dir: 1 }).map((l) => l.sym)).toEqual(["ETH", "BTC", "XRP"]);
    expect(LIGNES).toEqual(copie);
  });
  it("chaînes par localeCompare ; tri null/colonne inconnue → ordre d'origine", () => {
    expect(trierLignes(LIGNES, COLS, { colonne: "sym", dir: 1 }).map((l) => l.sym)).toEqual(["BTC", "ETH", "XRP"]);
    expect(trierLignes(LIGNES, COLS, null).map((l) => l.sym)).toEqual(["ETH", "BTC", "XRP"]);
    expect(trierLignes(LIGNES, COLS, { colonne: "zzz", dir: 1 }).map((l) => l.sym)).toEqual(["ETH", "BTC", "XRP"]);
  });
});

describe("TableTriable (markup)", () => {
  it("grille dérivée des largeurs + état vide", () => {
    const elVide = TableTriable({ colonnes: COLS, lignes: [], cle: (l: Ligne) => l.sym, vide: "Aucun trade." }) as {
      props: Record<string, unknown>;
    };
    expect(JSON.stringify(elVide.props)).toContain("Aucun trade.");
    const plein = TableTriable({ colonnes: COLS, lignes: LIGNES, cle: (l: Ligne) => l.sym }) as {
      props: Record<string, unknown>;
    };
    expect(JSON.stringify(plein.props)).toContain("1fr 1fr");
  });
  it("colonne triable: true SANS valeurTri → span (pas button) même avec onTri", () => {
    const colsSansValeur: ColonneTable<Ligne>[] = [
      { id: "test", label: "Test", triable: true, rendu: (l) => l.sym },
    ];
    const el = TableTriable({
      colonnes: colsSansValeur,
      lignes: LIGNES,
      cle: (l: Ligne) => l.sym,
      onTri: () => {}, // fourni, mais gate doit rejeter car pas de valeurTri
    }) as {
      props: { children: Array<{ props: { children: unknown[] } }> };
    };
    // Navigue vers le header div (premier enfant de section)
    const headerDiv = el.props.children[0];
    expect(headerDiv).toBeDefined();
    const headerCells = (headerDiv?.props.children ?? []) as Array<{ type: string; key: string }>;
    const testHeader = headerCells.find((c) => c.key === "test");
    expect(testHeader?.type).toBe("span"); // type "span", pas "button"
  });

  it("colonne triable WITH valeurTri → button + onClick déclenche onTri avec basculerTri", () => {
    let recu: { colonne: string; dir: 1 | -1 } | undefined;
    const colsAvecValeur: ColonneTable<Ligne>[] = [
      { id: "prix", label: "Prix", triable: true, valeurTri: (l) => l.prix, rendu: (l) => String(l.prix) },
    ];
    const el = TableTriable({
      colonnes: colsAvecValeur,
      lignes: LIGNES,
      cle: (l: Ligne) => l.sym,
      tri: null,
      onTri: (t) => {
        recu = t;
      },
    }) as {
      props: { children: Array<{ props: { children: unknown[] } }> };
    };
    const headerDiv = el.props.children[0];
    expect(headerDiv).toBeDefined();
    const headerCells = (headerDiv?.props.children ?? []) as Array<{
      type: string;
      key: string;
      props: { onClick?: () => void };
    }>;
    const prixHeader = headerCells.find((c) => c.key === "prix");
    expect(prixHeader?.type).toBe("button"); // type "button"
    prixHeader?.props.onClick?.(); // appelle le handler
    expect(recu).toEqual({ colonne: "prix", dir: -1 }); // basculerTri(null, "prix")
  });
});
