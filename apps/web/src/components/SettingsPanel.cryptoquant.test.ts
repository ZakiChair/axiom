/**
 * Garde structurelle des Réglages CryptoQuant (spec 2026-09-16 §4.2).
 *
 * SettingsPanel n'est pas rendable en vitest node sans une chaîne de bouchons (store/theme
 * touche `document` au chargement, onboarding tire market et les adaptateurs). On lit donc la
 * source, patron lib/gardeFous.test.ts : le store de clé est branché, le client de données
 * CryptoQuant n'est jamais importé (bundle), le bloc suit DefiLlama Pro et porte les deux
 * textes Vercel / local.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(fileURLToPath(new URL("./SettingsPanel.tsx", import.meta.url)), "utf8");

describe("Réglages — clé CryptoQuant", () => {
  it("importe le store de clé et jamais le client de données CryptoQuant", () => {
    expect(SOURCE).toContain('import { cryptoquantKeyStore } from "../store/cryptoquant";');
    expect(SOURCE).not.toMatch(/data\/onchain\/cryptoquant/);
  });

  it("branche présence, enregistrement et suppression sur le store (jamais la valeur)", () => {
    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.hasKey)");
    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.setKey)");
    expect(SOURCE).toContain("useStore(cryptoquantKeyStore, (s) => s.clearKey)");
    expect(SOURCE).not.toContain("getCryptoquantKey");
  });

  it("place le bloc après DefiLlama Pro avec les deux textes Vercel / local de la spec", () => {
    const defillama = SOURCE.indexOf('name="DefiLlama Pro"');
    const cryptoquant = SOURCE.indexOf('name="CryptoQuant (takers et mineurs cotés)"');
    expect(defillama).toBeGreaterThan(-1);
    expect(cryptoquant).toBeGreaterThan(defillama);

    const bloc = SOURCE.slice(cryptoquant, SOURCE.indexOf("/>", cryptoquant));
    expect(bloc).toContain("purpose={IS_VERCEL");
    expect(bloc).toContain("clé personnelle requise — aucun repli serveur, licence personnelle");
    expect(bloc).toContain(
      "repli CRYPTOQUANT_API_KEY de .env pour le proxy Vite et le daemon local uniquement ; une clé saisie ici reste prioritaire",
    );
    expect(bloc).toContain('domain="api.cryptoquant.com, via la route locale /cqapi"');
    expect(bloc).toContain('signupUrl="https://cryptoquant.com"');
    expect(bloc).toContain("hasKey={cryptoquantHasKey}");
    expect(bloc).toContain("onSave={cryptoquantSetKey}");
    expect(bloc).toContain("onClear={cryptoquantClearKey}");
  });
});
