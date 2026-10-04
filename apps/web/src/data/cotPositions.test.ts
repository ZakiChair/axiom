import { describe, expect, it } from "vitest";
import { positionsCot, libelleMouvementCot } from "./cotPositions";
import { resumerCot, type LigneCot } from "./cot";

const nom = "GOLD - COMMODITY EXCHANGE INC.";
function rapport(date: string, longs: number, shorts: number) {
  return {
    market_and_exchange_names: nom, report_date_as_yyyy_mm_dd: date,
    noncomm_positions_long_all: longs, noncomm_positions_short_all: shorts,
  };
}

describe("positions COT : stocks et variations nettes distinctes", () => {
  it.each([
    [120, 70, 20, 20, 0], [120, 30, 20, -20, 40],
    [80, 70, -20, 20, -40], [80, 30, -20, -20, 0],
    [100, 50, 0, 0, 0],
  ])("longs %i / shorts %i", (longs, shorts, dl, ds, dn) => {
    const ligne = resumerCot([
      rapport("2026-06-09", 100, 50), rapport("2026-06-23", longs, shorts),
    ]).lignes[0]!;
    expect(positionsCot(ligne)).toEqual({
      longs, shorts, deltaLongs: dl, deltaShorts: ds,
      datePrecedente: Date.parse("2026-06-09"),
    });
    expect(ligne.net).toBe(longs - shorts);
    expect(ligne.delta).toBe(dn);
    expect(dl - ds).toBe(dn);
  });

  it("un seul rapport garde les stocks, sans inventer de variation", () => {
    expect(positionsCot(resumerCot([rapport("2026-06-23", 0, 50)]).lignes[0]!))
      .toEqual({ longs: 0, shorts: 50, deltaLongs: null, deltaShorts: null, datePrecedente: null });
  });

  it("une ancienne ligne net/OI seuls n'invente pas les positions", () => {
    const ligne: LigneCot = {
      nom, libelle: "Or", categorie: "metal", net: 50, delta: 10, openInterest: 200,
      dateRapport: 2000, serie: [{ t: 1000, net: 40, oi: 200 }, { t: 2000, net: 50, oi: 200 }],
    };
    expect(positionsCot(ligne)).toEqual({
      longs: null, shorts: null, deltaLongs: null, deltaShorts: null, datePrecedente: 1000,
    });
  });

  it.each([-1, NaN, Infinity])("rejette des stocks invalides : %s", (valeur) => {
    expect(resumerCot([rapport("2026-06-23", valeur, 50)]).lignes).toEqual([]);
  });

  it.each([-1, NaN, Infinity, undefined])("protège aussi les anciennes lignes directes : %s", (longs) => {
    const ligne = resumerCot([
      rapport("2026-06-09", 100, 50), rapport("2026-06-23", 120, 30),
    ]).lignes[0]!;
    const positions = positionsCot({ ...ligne, longs });
    expect(positions.longs).toBeNull();
    expect(positions.deltaLongs).toBeNull();
    expect(positions.shorts).toBe(30);
    expect(positions.deltaShorts).toBe(-20);
  });

  it("ne compare pas deux dates identiques ou une série ne finissant pas au rapport affiché", () => {
    const ligne = resumerCot([
      rapport("2026-06-09", 100, 50), rapport("2026-06-23", 120, 30),
    ]).lignes[0]!;
    for (const invalide of [
      { ...ligne, dateRapport: Date.parse("2026-06-30") },
      { ...ligne, serie: [ligne.serie[1]!, ligne.serie[1]!] },
    ]) {
      expect(positionsCot(invalide).datePrecedente).toBeNull();
      expect(positionsCot(invalide).deltaLongs).toBeNull();
      expect(positionsCot(invalide).deltaShorts).toBeNull();
    }
  });

  it("nomme les ajouts/réductions NETS, zéro et absence", () => {
    expect(libelleMouvementCot(20)).toBe("Ajouts nets");
    expect(libelleMouvementCot(-20)).toBe("Réductions nettes");
    expect(libelleMouvementCot(0)).toBe("Inchangé");
    expect(libelleMouvementCot(null)).toBe("Variation indisponible");
    expect(libelleMouvementCot(NaN)).toBe("Variation indisponible");
  });
});
