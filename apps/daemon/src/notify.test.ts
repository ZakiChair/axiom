import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Declenchement } from "@axiom/alerts";
import {
  chargerTelegram,
  echapperAppleScript,
  formaterTexteTelegram,
  redigerErreurTelegram,
  scriptNotification,
} from "./notify";

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
