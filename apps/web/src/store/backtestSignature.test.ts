/**
 * Invalidation du résultat de backtest (C3). Aucun setter du builder n'effaçait
 * `resultat` — et il y en a quatorze : on compare donc une SIGNATURE plutôt que
 * d'invalider dans chaque setter, où un oubli rouvrirait le trou en silence.
 */
import { describe, expect, it } from "vitest";
import type { ConfigRun } from "./backtestSignature";
import { resumeRun, runPerime, signatureRun } from "./backtestSignature";

const base: ConfigRun = {
  symbol: "BTCUSDT",
  tf: "1h",
  plage: "6m",
  direction: "long",
  tailleFixe: 1000,
  stopPct: null,
  targetPct: null,
  stopAtr: null,
  risquePct: null,
  fraisPct: 0.05,
  slippagePct: 0.02,
  capitalInitial: 10_000,
  reglesEntree: [
    { type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: ">", droite: { type: "constante", valeur: 0 } },
  ],
  reglesSortie: [],
};

describe("signatureRun", () => {
  it("est stable pour une configuration identique", () => {
    expect(signatureRun(base)).toBe(signatureRun({ ...base }));
  });

  it("ignore la casse du symbole (le builder accepte « btcusdt »)", () => {
    expect(signatureRun({ ...base, symbol: "btcusdt" })).toBe(signatureRun(base));
  });

  it.each([
    ["symbole", { symbol: "ETHUSDT" }],
    ["pas de temps", { tf: "4h" as const }],
    ["plage", { plage: "1a" as const }],
    ["direction", { direction: "short" as const }],
    ["taille", { tailleFixe: 2000 }],
    ["stop", { stopPct: 2 }],
    ["stop ATR", { stopAtr: { length: 14, mult: 2 } }],
    ["risque %", { risquePct: 1 }],
    ["objectif", { targetPct: 5 }],
    ["frais", { fraisPct: 0.1 }],
    ["slippage", { slippagePct: 0.05 }],
    ["capital", { capitalInitial: 50_000 }],
    ["règles de sortie", { reglesSortie: base.reglesEntree }],
  ])("change quand %s change", (_libelle, patch) => {
    expect(signatureRun({ ...base, ...patch })).not.toBe(signatureRun(base));
  });

  it("change quand une RÈGLE est modifiée (pas seulement leur nombre)", () => {
    const modifiee: ConfigRun = {
      ...base,
      reglesEntree: [
        { type: "comparaison", gauche: { type: "prix", champ: "close" }, comparateur: "<", droite: { type: "constante", valeur: 0 } },
      ],
    };
    expect(signatureRun(modifiee)).not.toBe(signatureRun(base));
  });
});

describe("runPerime", () => {
  it("n'est jamais périmé sans run affiché", () => {
    expect(runPerime(null, base)).toBe(false);
  });

  it("n'est pas périmé tant que rien n'a changé", () => {
    expect(runPerime(signatureRun(base), base)).toBe(false);
  });

  it("devient périmé dès qu'un paramètre change", () => {
    expect(runPerime(signatureRun(base), { ...base, fraisPct: 0.2 })).toBe(true);
  });
});

describe("resumeRun", () => {
  it("dit ce que le run décrit, pas seulement le nombre de bougies", () => {
    expect(resumeRun(base, 42, "6 mois")).toBe("BTCUSDT · 1h · 6 mois · 42 trades");
  });

  it("accorde le singulier", () => {
    expect(resumeRun(base, 1, "6 mois")).toContain("1 trade");
    expect(resumeRun(base, 1, "6 mois")).not.toContain("1 trades");
  });

  it("normalise la casse du symbole", () => {
    expect(resumeRun({ ...base, symbol: "btcusdt" }, 3, "3 mois")).toContain("BTCUSDT");
  });
});
