import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

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
