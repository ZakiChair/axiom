/**
 * Carte de partage (Open Graph + Twitter Card) de `index.html`.
 *
 * Un lien AXIOM posté sur X sans ces balises s'affiche nu (URL seule). Test
 * STRUCTUREL : on lit le fichier servi par Vite et on vérifie la présence des balises
 * et la cohérence image ↔ fichier publié dans `public/`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE_WEB = resolve(__dirname, "../..");
const HTML = readFileSync(resolve(RACINE_WEB, "index.html"), "utf8");

function contenuMeta(attribut: "property" | "name", cle: string): string | null {
  const re = new RegExp(`<meta\\s+${attribut}="${cle}"\\s+content="([^"]*)"`);
  const m = HTML.match(re);
  return m ? (m[1] ?? "") : null;
}

describe("index.html — carte de partage", () => {
  it("décrit la page (description, og:title, og:description, twitter:card)", () => {
    expect(contenuMeta("name", "description")).toBeTruthy();
    expect(contenuMeta("property", "og:title")).toBeTruthy();
    expect(contenuMeta("property", "og:description")).toBeTruthy();
    expect(contenuMeta("property", "og:type")).toBe("website");
    expect(contenuMeta("name", "twitter:card")).toBe("summary_large_image");
  });

  it("pointe vers une image ABSOLUE publiée dans public/ (même fichier pour OG et Twitter)", () => {
    const og = contenuMeta("property", "og:image");
    expect(og).toMatch(/^https:\/\/.+\.jpg$/);
    expect(contenuMeta("name", "twitter:image")).toBe(og);
    const nomFichier = og!.slice(og!.lastIndexOf("/") + 1);
    expect(existsSync(resolve(RACINE_WEB, "public", nomFichier))).toBe(true);
    expect(contenuMeta("property", "og:image:width")).toBe("1200");
    expect(contenuMeta("property", "og:image:height")).toBe("470");
  });

  it("og:url et og:image partagent la même origine (alias de production)", () => {
    const url = contenuMeta("property", "og:url");
    const image = contenuMeta("property", "og:image");
    expect(url).toBeTruthy();
    expect(new URL(image!).origin).toBe(new URL(url!).origin);
  });
});
