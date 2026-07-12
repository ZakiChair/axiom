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
