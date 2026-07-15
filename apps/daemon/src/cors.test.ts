import { describe, expect, test } from "bun:test";
import { entetesCorsRejet, hostAutorise, origineAutorisee, requeteLocaleAutorisee } from "./cors";

describe("frontière locale du daemon", () => {
  test("accepte seulement les Host loopback explicites", () => {
    expect(hostAutorise("127.0.0.1:8787")).toBe(true);
    expect(hostAutorise("localhost:8787")).toBe(true);
    expect(hostAutorise("LOCALHOST:8787")).toBe(true);
    expect(hostAutorise("evil.example:8787")).toBe(false);
    expect(hostAutorise(null)).toBe(false);
  });

  test("refuse userinfo, fragments, formes IP ambiguës et ports non canoniques", () => {
    for (const host of [
      "evil.example@127.0.0.1:8787",
      "127.0.0.1:8787#evil",
      "2130706433:8787",
      "localhost.:8787",
      "127.0.0.1:08787",
      "127.0.0.1:0",
      "127.0.0.1:65536",
    ]) {
      expect(hostAutorise(host)).toBe(false);
    }
  });

  test("ne transforme pas un Host arbitraire en origine same-origin", () => {
    expect(origineAutorisee("http://evil.example:8787", "evil.example:8787")).toBeNull();
    expect(origineAutorisee("http://localhost:5173", "127.0.0.1:8787")).toBe("http://localhost:5173");
    expect(origineAutorisee("http://localhost:8787", "LOCALHOST:8787")).toBe("http://localhost:8787");
  });

  test("rejette DNS rebinding et mutation venant d'une origine web étrangère", () => {
    const rebinding = new Request("http://evil.example:8787/kv/x/y", {
      method: "PUT",
      headers: { host: "evil.example:8787", origin: "http://evil.example" },
    });
    const crossSite = new Request("http://127.0.0.1:8787/kv/x/y", {
      method: "PUT",
      headers: { host: "127.0.0.1:8787", origin: "https://evil.example" },
    });
    expect(requeteLocaleAutorisee(rebinding)).toBe(false);
    expect(requeteLocaleAutorisee(crossSite)).toBe(false);
  });

  test("un rejet 403 reflète l'Origin loopback pour rester lisible côté front", () => {
    // Vite bascule sur un port inattendu (5176) → origine hors ORIGINES_DEV, donc
    // rejetée par la garde, MAIS le front doit pouvoir lire/logger le 403.
    for (const origin of ["http://localhost:5176", "http://127.0.0.1:9999", "https://localhost:5173"]) {
      const req = new Request("http://127.0.0.1:8787/kv/x/y", { headers: { origin } });
      expect(entetesCorsRejet(req)["access-control-allow-origin"]).toBe(origin);
    }
  });

  test("un rejet 403 ne reflète JAMAIS une origine distante ni une absence d'Origin", () => {
    const distant = new Request("http://127.0.0.1:8787/kv/x/y", {
      headers: { origin: "https://evil.example" },
    });
    const cli = new Request("http://127.0.0.1:8787/health", { headers: { host: "127.0.0.1:8787" } });
    expect(entetesCorsRejet(distant)).toEqual({});
    expect(entetesCorsRejet(cli)).toEqual({});
  });

  test("accepte le front Vite autorisé et les clients CLI locaux", () => {
    const vite = new Request("http://127.0.0.1:8787/kv/x/y", {
      method: "PUT",
      headers: { host: "127.0.0.1:8787", origin: "http://localhost:5173" },
    });
    const cli = new Request("http://127.0.0.1:8787/health", {
      headers: { host: "127.0.0.1:8787" },
    });
    expect(requeteLocaleAutorisee(vite)).toBe(true);
    expect(requeteLocaleAutorisee(cli)).toBe(true);
  });
});
