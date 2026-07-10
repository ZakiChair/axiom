import { describe, expect, it } from "vitest";
import {
  VALEUR_ABSENTE,
  formatAge,
  formatCompact,
  formatCountdown,
  formatDateComplete,
  formatDateCourte,
  formatDateHeure,
  formatDec,
  formatDelai,
  formatEntier,
  formatHeure,
  formatHeureMinute,
  formatPct,
  formatPourcentage,
  formatPrice,
  formatUsd,
} from "./format";

describe("formatPrice", () => {
  it("adapte les décimales à la magnitude (2/4/6), milliers en-US", () => {
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(78.191)).toBe("78.19");
    expect(formatPrice(0.0234)).toBe("0.0234");
    expect(formatPrice(0.0013)).toBe("0.001300");
  });
  it("« — » pour absent, nul ou non fini", () => {
    expect(formatPrice(0)).toBe(VALEUR_ABSENTE);
    expect(formatPrice(Number.NaN)).toBe(VALEUR_ABSENTE);
    expect(formatPrice(null)).toBe(VALEUR_ABSENTE);
    expect(formatPrice(undefined)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatCompact", () => {
  it("paliers K/M/B/T à 2 décimales", () => {
    expect(formatCompact(50)).toBe("50.00");
    expect(formatCompact(1_500)).toBe("1.50K");
    expect(formatCompact(2_500_000)).toBe("2.50M");
    expect(formatCompact(3_200_000_000)).toBe("3.20B");
    expect(formatCompact(1.4e12)).toBe("1.40T");
  });
  it("négatif : signe « − » typographique conservé", () => {
    expect(formatCompact(-2_500_000)).toBe("−2.50M");
  });
  it("« — » si non fini", () => {
    expect(formatCompact(Number.POSITIVE_INFINITY)).toBe(VALEUR_ABSENTE);
    expect(formatCompact(undefined)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatUsd", () => {
  it("préfixe $ sur la notation compacte", () => {
    expect(formatUsd(84_000_000)).toBe("$84.00M");
    expect(formatUsd(612.039)).toBe("$612.04");
  });
  it("signe « − » AVANT le $", () => {
    expect(formatUsd(-1_300_000_000)).toBe("−$1.30B");
  });
  it("« — » si absent", () => {
    expect(formatUsd(null)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatPct", () => {
  it("signe explicite, 2 décimales par défaut", () => {
    expect(formatPct(2.345)).toBe("+2.35%");
    expect(formatPct(-1.2)).toBe("-1.20%");
    expect(formatPct(0)).toBe("+0.00%");
  });
  it("funding : 4 décimales", () => {
    expect(formatPct(0.01, 4)).toBe("+0.0100%");
  });
  it("sans signe explicite sur demande", () => {
    expect(formatPct(2.345, 2, { signe: false })).toBe("2.35%");
  });
  it("« — » si non fini", () => {
    expect(formatPct(Number.NaN)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatPourcentage", () => {
  it("valeur déjà en %, espace avant % (style analytique)", () => {
    expect(formatPourcentage(15.3, 1)).toBe("15.3 %");
    expect(formatPourcentage(4.25)).toBe("4.25 %");
  });
  it("« — » si absent", () => {
    expect(formatPourcentage(undefined)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatDec / formatEntier", () => {
  it("formatDec : décimales fixes ou « — »", () => {
    expect(formatDec(0.876543)).toBe("0.88");
    expect(formatDec(1.5, 1)).toBe("1.5");
    expect(formatDec(null)).toBe(VALEUR_ABSENTE);
  });
  it("formatEntier : séparateurs fr-FR (espace insécable étroite)", () => {
    // Le séparateur de milliers fr-FR varie selon la version ICU (U+00A0 ou
    // U+202F) : on normalise en espace simple avant de comparer.
    expect(formatEntier(1234567).replace(/\s/gu, " ")).toBe("1 234 567");
    expect(formatEntier(undefined)).toBe(VALEUR_ABSENTE);
  });
});

describe("dates et heures (fr-FR)", () => {
  // 2026-07-09 14:03:05 UTC — les assertions ne portent que sur la FORME
  // (indépendante du fuseau de la machine de test).
  const ts = Date.UTC(2026, 6, 9, 14, 3, 5);
  it("formatHeure : HH:MM:SS", () => {
    expect(formatHeure(ts)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
  it("formatHeureMinute : HH:MM", () => {
    expect(formatHeureMinute(ts)).toMatch(/^\d{2}:\d{2}$/);
  });
  it("formatDateCourte : JJ/MM", () => {
    expect(formatDateCourte(ts)).toMatch(/^\d{2}\/07$/);
  });
  it("formatDateHeure : JJ/MM HH:MM", () => {
    expect(formatDateHeure(ts)).toMatch(/^\d{2}\/07 \d{2}:\d{2}$/);
  });
  it("formatDateComplete : « 9 juil. 2026 »", () => {
    expect(formatDateComplete(ts)).toMatch(/^\d{1,2} juil\. 2026$/);
  });
  it("« — » pour un horodatage invalide", () => {
    expect(formatHeure(0)).toBe(VALEUR_ABSENTE);
    expect(formatDateCourte(Number.NaN)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatAge", () => {
  const now = 1_000_000_000;
  it("paliers s/min/h/j", () => {
    expect(formatAge(now - 12_000, now)).toBe("il y a 12 s");
    expect(formatAge(now - 5 * 60_000, now)).toBe("il y a 5 min");
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("il y a 3 h");
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("il y a 2 j");
  });
  it("« — » si horodatage absent, borné à 0 si futur", () => {
    expect(formatAge(0, now)).toBe(VALEUR_ABSENTE);
    expect(formatAge(now + 5_000, now)).toBe("il y a 0 s");
  });
});

describe("formatDelai", () => {
  const now = 1_000_000_000;
  it("paliers imminent/min/h/j", () => {
    expect(formatDelai(now + 30_000, now)).toBe("imminent");
    expect(formatDelai(now + 45 * 60_000, now)).toBe("dans 45 min");
    expect(formatDelai(now + (3 * 60 + 12) * 60_000, now)).toBe("dans 3 h 12");
    expect(formatDelai(now + 2 * 86_400_000, now)).toBe("dans 2 j");
  });
  it("échéance passée : « imminent » (borne basse), invalide : « — »", () => {
    expect(formatDelai(now - 1_000, now)).toBe("imminent");
    expect(formatDelai(0, now)).toBe(VALEUR_ABSENTE);
  });
});

describe("formatCountdown", () => {
  it("MM:SS sous l'heure, H:MM:SS au-delà, négatif borné à 0", () => {
    expect(formatCountdown(65_000)).toBe("01:05");
    expect(formatCountdown(3_665_000)).toBe("1:01:05");
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});
