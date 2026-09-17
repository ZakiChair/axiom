import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chargerCles, parseEnv } from "./env";

describe("parseEnv", () => {
  test("parse des paires KEY=val simples", () => {
    const env = parseEnv("FRED_API_KEY=abc\nTWELVE_DATA_KEY=def");
    expect(env.FRED_API_KEY).toBe("abc");
    expect(env.TWELVE_DATA_KEY).toBe("def");
  });

  test("ignore lignes vides et commentaires #", () => {
    const env = parseEnv("# commentaire\n\n  # indenté\nA=1\n");
    expect(env.A).toBe("1");
    expect(Object.keys(env)).toEqual(["A"]);
  });

  test("découpe sur le premier = (valeur peut contenir des =)", () => {
    const env = parseEnv("TOKEN=a=b=c");
    expect(env.TOKEN).toBe("a=b=c");
  });

  test("trim clé et valeur, retire les guillemets entourants", () => {
    const env = parseEnv('  K  =  "  espacé  "  \nQ=\'simple\'');
    expect(env.K).toBe("  espacé  ");
    expect(env.Q).toBe("simple");
  });

  test("dernière occurrence d'une clé gagne", () => {
    const env = parseEnv("K=1\nK=2");
    expect(env.K).toBe("2");
  });

  test("ligne sans = ou clé vide ignorée", () => {
    const env = parseEnv("pasdegal\n=valeur\nOK=1");
    expect(env.OK).toBe("1");
    expect(Object.keys(env)).toEqual(["OK"]);
  });
});

describe("chargerCles — repli CryptoQuant (proxy /cqapi local)", () => {
  test("parseEnv lit CRYPTOQUANT_API_KEY", () => {
    expect(parseEnv("CRYPTOQUANT_API_KEY=abc").CRYPTOQUANT_API_KEY).toBe("abc");
  });

  test("chargerCles expose CRYPTOQUANT_API_KEY depuis le fichier .env", () => {
    const dossier = mkdtempSync(join(tmpdir(), "axiom-env-"));
    try {
      const chemin = join(dossier, ".env");
      writeFileSync(chemin, "BGEOMETRICS_API_KEY=bg\nCRYPTOQUANT_API_KEY=abc\n");
      const cles = chargerCles(chemin);
      expect(cles.CRYPTOQUANT_API_KEY).toBe("abc");
      expect(cles.BGEOMETRICS_API_KEY).toBe("bg");
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test("fichier absent : chaîne vide, jamais undefined", () => {
    const absent = join(tmpdir(), `axiom-env-absent-${process.pid}`, ".env");
    expect(chargerCles(absent).CRYPTOQUANT_API_KEY).toBe("");
  });
});
