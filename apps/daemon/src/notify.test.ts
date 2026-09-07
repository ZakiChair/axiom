import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Declenchement } from "@axiom/alerts";
import { afterEach, beforeEach } from "bun:test";
import {
  chargerTelegram,
  echapperAppleScript,
  envoyerTelegram,
  formaterTexteTelegram,
  injecterTransportsNotify,
  notifierDeclenchement,
  redigerErreurTelegram,
  reinitialiserTelegram,
  reinitialiserTransportsNotify,
  scriptNotification,
} from "./notify";

const fetchAppels: string[] = [];

beforeEach(() => {
  fetchAppels.length = 0;
  reinitialiserTelegram();
  injecterTransportsNotify({
    macos: () => {},
    telegram: async (token, _chatId, _texte) => {
      fetchAppels.push(`telegram:${token}`);
      return true;
    },
    fetchTelegram: async (input) => {
      fetchAppels.push(String(input));
      throw new Error("fetch Telegram réel interdit en test");
    },
  });
});

afterEach(() => {
  reinitialiserTransportsNotify();
  reinitialiserTelegram();
});

describe("echapperAppleScript", () => {
  test("échappe les guillemets doubles", () => {
    expect(echapperAppleScript('Prix "BTC" franchit')).toBe('Prix \\"BTC\\" franchit');
  });

  test("échappe le backslash AVANT les guillemets (pas de double échappement)", () => {
    expect(echapperAppleScript('a\\b"c')).toBe('a\\\\b\\"c');
  });

  test("chaîne simple inchangée", () => {
    expect(echapperAppleScript("RSI > 70 sur SOLUSDT")).toBe("RSI > 70 sur SOLUSDT");
  });
});

describe("scriptNotification", () => {
  test("compose display notification avec échappement des deux champs", () => {
    const s = scriptNotification("AXIOM — BTCUSDT", 'seuil "100" atteint');
    expect(s).toBe('display notification "seuil \\"100\\" atteint" with title "AXIOM — BTCUSDT"');
  });
});

describe("formaterTexteTelegram", () => {
  test("titre + message sur deux lignes", () => {
    const decl: Declenchement = { alertId: "a1", ts: 1, valeur: 100, message: "Prix franchit 100 à la hausse" };
    expect(formaterTexteTelegram("BTCUSDT", decl)).toBe("🔔 AXIOM — BTCUSDT\nPrix franchit 100 à la hausse");
  });
});

describe("redigerErreurTelegram", () => {
  test("masque le jeton du bot dans une URL d'API Telegram (fuite de secret)", () => {
    const err = new Error("fetch failed: https://api.telegram.org/bot123:ABC/sendMessage");
    const out = redigerErreurTelegram(err);
    expect(out).not.toContain("123:ABC");
    expect(out).toContain("/bot***/sendMessage");
  });

  test("stringifie une erreur non-Error", () => {
    expect(redigerErreurTelegram({ toString: () => "boom" })).toBe("boom");
    expect(redigerErreurTelegram("réseau indisponible")).toBe("réseau indisponible");
  });

  test("message sans jeton inchangé", () => {
    expect(redigerErreurTelegram(new Error("délai dépassé"))).toBe("Error: délai dépassé");
  });
});

describe("chargerTelegram", () => {
  test("null si le fichier est absent", () => {
    expect(chargerTelegram(join(tmpdir(), "n-existe-pas-axiom.env"))).toBeNull();
  });

  test("null si une seule des deux variables est présente", () => {
    const dir = mkdtempSync(join(tmpdir(), "axiom-tg-"));
    const chemin = join(dir, ".env");
    writeFileSync(chemin, "TELEGRAM_BOT_TOKEN=abc\n");
    expect(chargerTelegram(chemin)).toBeNull();
  });

  test("config renvoyée si les deux variables sont présentes", () => {
    const dir = mkdtempSync(join(tmpdir(), "axiom-tg-"));
    const chemin = join(dir, ".env");
    writeFileSync(chemin, "TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_CHAT_ID=-456\n");
    expect(chargerTelegram(chemin)).toEqual({ token: "123:abc", chatId: "-456" });
  });
});

describe("notifierDeclenchement — transports injectés", () => {
  test("macos injecté, zéro fetch Telegram réel", () => {
    const macos: Array<[string, string]> = [];
    injecterTransportsNotify({
      macos: (titre, corps) => macos.push([titre, corps]),
      telegram: async () => true,
      chargerTelegram: () => ({ token: "tok", chatId: "1" }),
      fetchTelegram: async (input) => {
        fetchAppels.push(String(input));
        throw new Error("fetch Telegram réel interdit en test");
      },
    });
    const decl: Declenchement = { alertId: "a1", ts: 1, valeur: 100, message: "seuil atteint" };
    notifierDeclenchement("BTCUSDT", decl);
    expect(macos).toEqual([["AXIOM — BTCUSDT", "seuil atteint"]]);
    expect(fetchAppels.filter((u) => u.includes("api.telegram.org"))).toEqual([]);
  });

  test("telegram injecté reçoit le texte, sans fetch réel", async () => {
    const tg: string[] = [];
    injecterTransportsNotify({
      macos: () => {},
      telegram: async (_token, _chatId, texte) => {
        tg.push(texte);
        return true;
      },
      chargerTelegram: () => ({ token: "tok", chatId: "42" }),
      fetchTelegram: async (input) => {
        fetchAppels.push(String(input));
        throw new Error("fetch Telegram réel interdit en test");
      },
    });
    notifierDeclenchement("ETHUSDT", { alertId: "a1", ts: 1, valeur: 1, message: "boom" });
    await Promise.resolve();
    expect(tg).toEqual(["🔔 AXIOM — ETHUSDT\nboom"]);
    expect(fetchAppels).toEqual([]);
  });

  test("envoyerTelegram passe par le fetch injecté", async () => {
    const urls: string[] = [];
    injecterTransportsNotify({
      fetchTelegram: async (input) => {
        urls.push(String(input));
        return new Response("{}", { status: 200 });
      },
    });
    const ok = await envoyerTelegram("tok", "42", "hello");
    expect(ok).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://api.telegram.org/bottok/sendMessage");
  });
});
