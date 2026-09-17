/**
 * Store de la clé CryptoQuant personnelle et message « clé requise » (spec 2026-09-16 §4.2,
 * invariant I8).
 *
 * Environnement vitest node : localStorage bouchonné en mémoire (patron store/onchain.test.ts).
 * `vi.resetModules()` + import dynamique : le store lit la clé à sa création, il faut donc
 * poser le stockage AVANT de charger le module pour tester l'hydratation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLE = "axiom:cryptoquant:key";
const SECRET = "CLE-TEST-SECRETE";

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null,
    setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k),
    clear: () => valeurs.clear(),
    key: (i) => [...valeurs.keys()][i] ?? null,
    get length() { return valeurs.size; },
  };
}

describe("clé CryptoQuant personnelle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", stockage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("démarre sans clé : hasKey faux, version 0, lecture nulle, emplacement exact", async () => {
    const { cryptoquantKeyStore, getCryptoquantKey, CLE_STOCKAGE_CRYPTOQUANT } = await import("./cryptoquant");
    expect(CLE_STOCKAGE_CRYPTOQUANT).toBe(CLE);
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(cryptoquantKeyStore.getState().version).toBe(0);
    expect(getCryptoquantKey()).toBeNull();
  });

  it("hydrate hasKey vrai depuis une clé déjà persistée", async () => {
    localStorage.setItem(CLE, SECRET);
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    expect(cryptoquantKeyStore.getState().hasKey).toBe(true);
    expect(getCryptoquantKey()).toBe(SECRET);
  });

  it("stockage inaccessible dès le chargement : hasKey faux, aucune exception", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("refusé", "SecurityError"); },
    });
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(getCryptoquantKey()).toBeNull();
  });

  it("setKey normalise, persiste, et la valeur n'entre jamais dans le state", async () => {
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().setKey(`  ${SECRET}  `);
    const etat = cryptoquantKeyStore.getState();
    expect(etat.hasKey).toBe(true);
    expect(etat.version).toBe(1);
    expect(localStorage.getItem(CLE)).toBe(SECRET);
    expect(getCryptoquantKey()).toBe(SECRET);
    expect(JSON.stringify(etat)).not.toContain(SECRET);
    expect(Object.values(etat)).not.toContain(SECRET);
    expect(etat).not.toHaveProperty("key");
  });

  it("version +1 à chaque setKey/clearKey, y compris en rotation vraie → vraie", async () => {
    const { cryptoquantKeyStore } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().setKey("premiere-cle");
    const apresPremiere = cryptoquantKeyStore.getState();
    cryptoquantKeyStore.getState().setKey(SECRET);
    const apresRotation = cryptoquantKeyStore.getState();
    expect(apresPremiere.hasKey).toBe(true);
    expect(apresRotation.hasKey).toBe(true);
    expect(apresRotation.version).toBe(apresPremiere.version + 1);
    expect(JSON.stringify(apresRotation)).not.toContain(SECRET);

    cryptoquantKeyStore.getState().clearKey();
    expect(cryptoquantKeyStore.getState().version).toBe(apresRotation.version + 1);
    // Un second clearKey (déjà sans clé) incrémente aussi : l'abonné est toujours notifié.
    cryptoquantKeyStore.getState().clearKey();
    expect(cryptoquantKeyStore.getState().version).toBe(apresRotation.version + 2);
  });

  it("setKey d'une chaîne blanche équivaut à clearKey", async () => {
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().setKey(SECRET);
    cryptoquantKeyStore.getState().setKey("   ");
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(cryptoquantKeyStore.getState().version).toBe(2);
    expect(localStorage.getItem(CLE)).toBeNull();
    expect(getCryptoquantKey()).toBeNull();
  });

  it("clearKey supprime la clé persistée", async () => {
    localStorage.setItem(CLE, SECRET);
    const { cryptoquantKeyStore, getCryptoquantKey } = await import("./cryptoquant");
    cryptoquantKeyStore.getState().clearKey();
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(localStorage.getItem(CLE)).toBeNull();
    expect(getCryptoquantKey()).toBeNull();
  });

  it("lecture tolérante : valeur blanche → null, valeur entourée d'espaces → rognée, stockage qui lève ou absent → null", async () => {
    const { getCryptoquantKey } = await import("./cryptoquant");
    localStorage.setItem(CLE, "   ");
    expect(getCryptoquantKey()).toBeNull();
    localStorage.setItem(CLE, `  ${SECRET} `);
    expect(getCryptoquantKey()).toBe(SECRET);
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("refusé", "SecurityError"); },
    });
    expect(getCryptoquantKey()).toBeNull();
    vi.stubGlobal("localStorage", undefined);
    expect(getCryptoquantKey()).toBeNull();
  });

  it("stockage qui refuse l'écriture : aucune exception, hasKey reste faux, version avance", async () => {
    const { cryptoquantKeyStore } = await import("./cryptoquant");
    vi.stubGlobal("localStorage", {
      ...stockage(),
      setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
    });
    expect(() => cryptoquantKeyStore.getState().setKey(SECRET)).not.toThrow();
    expect(cryptoquantKeyStore.getState().hasKey).toBe(false);
    expect(cryptoquantKeyStore.getState().version).toBe(1);
  });

  it("raison « clé requise » : constante exacte, terminée par « ). »", async () => {
    const { RAISON_CLE_CRYPTOQUANT } = await import("./cryptoquant");
    expect(RAISON_CLE_CRYPTOQUANT).toBe("Clé CryptoQuant personnelle requise (Réglages ⚙).");
    // Garde-fou du slice(0, -1) de messageSansCleCq : seul le point final doit être retiré.
    expect(RAISON_CLE_CRYPTOQUANT.endsWith(").")).toBe(true);
  });

  it("messageSansCleCq : complément local (.env) ou Vercel (aucun repli), point final unique", async () => {
    const { messageSansCleCq } = await import("./cryptoquant");
    const local = messageSansCleCq(false);
    const vercel = messageSansCleCq(true);
    expect(local).toBe(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.",
    );
    expect(vercel).toBe(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — licence personnelle, aucun repli serveur sur ce déploiement.",
    );
    for (const message of [local, vercel]) {
      expect(message.endsWith(".")).toBe(true);
      expect(message.endsWith("..")).toBe(false);
      expect(message).not.toContain(").");
    }
    expect(vercel).not.toContain(".env");
    expect(vercel).not.toContain("CRYPTOQUANT_API_KEY");
  });

  it("n'importe aucun module de données (seul zustand/vanilla, aucun chargement dynamique)", () => {
    const source = readFileSync(fileURLToPath(new URL("./cryptoquant.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["zustand/vanilla"]);
    expect(source).not.toMatch(/import\(/);
  });
});
