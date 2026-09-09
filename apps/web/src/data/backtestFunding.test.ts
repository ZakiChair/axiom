import { describe, expect, it } from "vitest";
import { extapiCheminAutorise } from "../../../../shared/extapi-hosts";
import {
  chargerPreuveArchiveFundingBinance,
  cheminArchiveFundingBinance,
  extraireCsvZipMonoFichier,
  fetchReglementsFundingBinance,
  finFenetreFundingArchivee,
  parseArchiveFundingCsv,
  parseKlinesPerpBinance,
  parseReglementsFundingBinance,
  type LigneArchiveFunding,
} from "./backtestFunding";

const preuve = (lignes: LigneArchiveFunding[]) => async () => ({
  lignes,
  mois: ["1970-01"],
  source: "data.binance.vision SHA-256 vérifié" as const,
});

describe("funding historique Binance pour backtest", () => {
  it("conserve le taux en fraction et le mark associé au règlement", () => {
    expect(parseReglementsFundingBinance([
      { fundingTime: 8, fundingRate: "0.0001", markPrice: "105.25" },
      { fundingTime: 16, fundingRate: "-0.0002", markPrice: "106" },
    ])).toEqual([
      { temps: 8, taux: 0.0001, mark: 105.25, tempsMark: 8 },
      { temps: 16, taux: -0.0002, mark: 106, tempsMark: 16 },
    ]);
  });

  it.each([null, "", " ", false, true, {}, []])("refuse fundingRate absent, vide ou de type incompatible : %j", (fundingRate) => {
    expect(() => parseReglementsFundingBinance([{ fundingTime: 8, fundingRate, markPrice: "100" }]))
      .toThrow("fundingRate");
  });

  it.each([null, "", " ", false, true, {}, []])("refuse fundingTime absent, vide ou de type incompatible : %j", (fundingTime) => {
    expect(() => parseReglementsFundingBinance([{ fundingTime, fundingRate: "0", markPrice: "100" }]))
      .toThrow("fundingTime");
  });

  it("conserve les vrais taux zéro et négatifs, numériques ou décimaux Binance", () => {
    expect(parseReglementsFundingBinance([
      { fundingTime: 0, fundingRate: 0, markPrice: 100 },
      { fundingTime: 8, fundingRate: "0", markPrice: "100" },
      { fundingTime: 16, fundingRate: -0.001, markPrice: 100 },
      { fundingTime: 24, fundingRate: "-0.002", markPrice: "100" },
    ]).map((r) => r.taux)).toEqual([0, 0, -0.001, -0.002]);
  });

  it("refuse une ligne sans mark plutôt que d'inventer un proxy", () => {
    expect(() => parseReglementsFundingBinance([{ fundingTime: 8, fundingRate: "0.0001" }]))
      .toThrow("markPrice");
  });

  it("refuse un rateType Special plutôt que de perdre un règlement non standard", () => {
    expect(() => parseReglementsFundingBinance([
      { fundingTime: 8, fundingRate: "0.0001", markPrice: "100", rateType: "Special" },
    ])).toThrow("Special");
  });

  it("télécharge une fenêtre bornée et expose sa couverture exacte", async () => {
    let appelee = 0;
    let urlAppelee = "";
    const fetcher: typeof fetch = async (input) => {
      appelee++;
      urlAppelee = String(input);
      return new Response(JSON.stringify([
        { fundingTime: 8, fundingRate: "0.0001", markPrice: "100" },
        { fundingTime: 16, fundingRate: "0.0002", markPrice: "101" },
      ]), { status: 200 });
    };
    const resultat = await fetchReglementsFundingBinance("BTCUSDT", 4, 20, fetcher, {
      chargerPreuve: preuve([
        { temps: 8, intervalleHeures: 8, taux: 0.0001 },
        { temps: 16, intervalleHeures: 8, taux: 0.0002 },
      ]),
    });
    expect(appelee).toBe(1);
    expect(urlAppelee).toContain("symbol=BTCUSDT");
    expect(urlAppelee).toContain("startTime=4");
    expect(urlAppelee).toContain("endTime=20");
    expect(resultat).toEqual({
      reglements: [
        { temps: 8, taux: 0.0001, mark: 100, tempsMark: 8 },
        { temps: 16, taux: 0.0002, mark: 101, tempsMark: 16 },
      ],
      couverture: {
        etat: "verifiee", debutMs: 4, finMs: 20, nombre: 2,
        moisArchives: ["1970-01"], intervallesHeures: [8],
        source: "Binance USDⓈ-M REST + data.binance.vision SHA-256 vérifié",
      },
    });
  });

  it("refuse un historique REST tronqué par rapport aux échéances archivées", async () => {
    const fetcher: typeof fetch = async () => Response.json([
      { fundingTime: 8, fundingRate: "0.001", markPrice: "100", rateType: "Regular" },
    ]);
    await expect(fetchReglementsFundingBinance("BTCUSDT", 0, 20, fetcher, {
      chargerPreuve: preuve([
        { temps: 8, intervalleHeures: 8, taux: 0.001 },
        { temps: 16, intervalleHeures: 8, taux: 0.002 },
      ]),
    })).rejects.toThrow("16");
  });

  it("refuse un trou interne REST sans extrapoler une cadence", async () => {
    const fetcher: typeof fetch = async () => Response.json([
      { fundingTime: 8, fundingRate: "0.001", markPrice: "100", rateType: "Regular" },
      { fundingTime: 24, fundingRate: "0.003", markPrice: "100", rateType: "Regular" },
    ]);
    await expect(fetchReglementsFundingBinance("ETHUSDT", 0, 30, fetcher, {
      chargerPreuve: preuve([
        { temps: 8, intervalleHeures: 8, taux: 0.001 },
        { temps: 16, intervalleHeures: 4, taux: 0.002 },
        { temps: 24, intervalleHeures: 8, taux: 0.003 },
      ]),
    })).rejects.toThrow("16");
  });

  it("accepte une fenêtre officiellement archivée sans aucune échéance", async () => {
    const resultat = await fetchReglementsFundingBinance("BTCUSDT", 4, 7, async () => Response.json([]), {
      chargerPreuve: preuve([]),
    });
    expect(resultat.reglements).toEqual([]);
    expect(resultat.couverture).toMatchObject({ etat: "verifiee", debutMs: 4, finMs: 7, nombre: 0 });
  });

  it("refuse un taux REST qui diffère de l'archive officielle au même instant", async () => {
    const fetcher: typeof fetch = async () => Response.json([
      { fundingTime: 8, fundingRate: "0.009", markPrice: "100", rateType: "Regular" },
    ]);
    await expect(fetchReglementsFundingBinance("BTCUSDT", 0, 10, fetcher, {
      chargerPreuve: preuve([{ temps: 8, intervalleHeures: 8, taux: 0.001 }]),
    })).rejects.toThrow(/taux/i);
  });
});

describe("attestation funding Binance Vision", () => {
  const zipBase64 = "UEsDBBQAAAAIAK+yKV1nVlM+OQAAAD0AAAAfAAAAQlRDVVNEVC1mdW5kaW5nUmF0ZS0xOTcwLTAxLmNzdktOzEmOL8nMTdVJK81LycxLj8/MK0ktKkvMic/ILy0q1slJLC6Jh8kVJZakclnoWOgY6BkYGHIBAFBLAQIUAxQAAAAIAK+yKV1nVlM+OQAAAD0AAAAfAAAAAAAAAAAAAACAAQAAAABCVENVU0RULWZ1bmRpbmdSYXRlLTE5NzAtMDEuY3N2UEsFBgAAAAABAAEATQAAAHYAAAAAAA==";
  const zip = Uint8Array.from(atob(zipBase64), (caractere) => caractere.charCodeAt(0));

  it("parse sans arrondi les horaires +1 ms et la cadence historique par ligne", () => {
    expect(parseArchiveFundingCsv("calc_time,funding_interval_hours,last_funding_rate\n1785542400001,8,0.00004123\n1785571200000,4,-0.00001\n"))
      .toEqual([
        { temps: 1785542400001, intervalleHeures: 8, taux: 0.00004123 },
        { temps: 1785571200000, intervalleHeures: 4, taux: -0.00001 },
      ]);
  });

  it("construit seulement les deux chemins mensuels autorisés pour BTC/ETH", () => {
    const zip = cheminArchiveFundingBinance("BTCUSDT", "2026-08", false);
    expect(zip).toBe("data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-08.zip");
    expect(cheminArchiveFundingBinance("ETHUSDT", "2026-08", true)).toBe(
      "data/futures/um/monthly/fundingRate/ETHUSDT/ETHUSDT-fundingRate-2026-08.zip.CHECKSUM",
    );
    expect(extapiCheminAutorise("data.binance.vision", `/${zip}`)).toBe(true);
    expect(extapiCheminAutorise("data.binance.vision", `/${zip}?x=1`)).toBe(false);
    expect(extapiCheminAutorise("data.binance.vision", "/data/futures/um/monthly/klines/BTCUSDT/x.zip")).toBe(false);
    expect(() => cheminArchiveFundingBinance("SOLUSDT", "2026-08", false)).toThrow("BTCUSDT/ETHUSDT");
  });

  it("vérifie le SHA-256 puis extrait le CSV mono-fichier avec deflate natif", async () => {
    const fetcher: typeof fetch = async (input) => String(input).endsWith(".CHECKSUM")
      ? new Response("afeef7ec37641a4f72afd149ed0f2b1272dacfda0273c97bdad7f0cb4f54ac4d  BTCUSDT-fundingRate-1970-01.zip\n")
      : new Response(zip);
    await expect(chargerPreuveArchiveFundingBinance("BTCUSDT", 0, 10, {
      fetcher,
      maintenantMs: Date.UTC(1970, 1, 1),
    })).resolves.toEqual({
      lignes: [{ temps: 8, intervalleHeures: 8, taux: 0.001 }],
      mois: ["1970-01"],
      source: "data.binance.vision SHA-256 vérifié",
    });
    await expect(chargerPreuveArchiveFundingBinance("BTCUSDT", 0, 7, {
      fetcher,
      maintenantMs: Date.UTC(1970, 1, 1),
    })).resolves.toMatchObject({ lignes: [], mois: ["1970-01"] });
    await expect(extraireCsvZipMonoFichier(zip, "ETHUSDT-fundingRate-1970-01.csv"))
      .rejects.toThrow("Nom du CSV");
  });

  it("refuse une archive mensuelle vide comme preuve de couverture", async () => {
    const archive = Uint8Array.from(atob("UEsDBBQAAAAIABOzKV3aKYnZLwAAADMAAAAfAAAARVRIVVNEVC1mdW5kaW5nUmF0ZS0xOTcwLTAxLmNzdktOzEmOL8nMTdVJK81LycxLj8/MK0ktKkvMic/ILy0q1slJLC6Jh8kVJZakcgEAUEsBAhQDFAAAAAgAE7MpXdopidkvAAAAMwAAAB8AAAAAAAAAAAAAAIABAAAAAEVUSFVTRFQtZnVuZGluZ1JhdGUtMTk3MC0wMS5jc3ZQSwUGAAAAAAEAAQBNAAAAbAAAAAAA"), (c) => c.charCodeAt(0));
    const fetcher: typeof fetch = async (input) => String(input).endsWith(".CHECKSUM")
      ? new Response("200490aff63d0adac6ed89307fc6c55edc78af7a0482a50cb554e533adb69d26  ETHUSDT-fundingRate-1970-01.zip\n")
      : new Response(archive);
    await expect(chargerPreuveArchiveFundingBinance("ETHUSDT", 0, 10, {
      fetcher,
      maintenantMs: Date.UTC(1970, 1, 1),
    })).rejects.toThrow(/vide/i);
  });

  it("refuse une échéance hors du mois attesté par le chemin", async () => {
    const archive = Uint8Array.from(atob("UEsDBBQAAAAIABOzKV2TFoQtOQAAAD0AAAAfAAAAQlRDVVNEVC1mdW5kaW5nUmF0ZS0xOTcwLTAyLmNzdktOzEmOL8nMTdVJK81LycxLj8/MK0ktKkvMic/ILy0q1slJLC6Jh8kVJZakchnoWOgY6BkYGHIBAFBLAQIUAxQAAAAIABOzKV2TFoQtOQAAAD0AAAAfAAAAAAAAAAAAAACAAQAAAABCVENVU0RULWZ1bmRpbmdSYXRlLTE5NzAtMDIuY3N2UEsFBgAAAAABAAEATQAAAHYAAAAAAA=="), (c) => c.charCodeAt(0));
    const fetcher: typeof fetch = async (input) => String(input).endsWith(".CHECKSUM")
      ? new Response("9e048d1a5af9702674641d8e106ed0852453c71f72cd62f59dcf445b7cd16d90  BTCUSDT-fundingRate-1970-02.zip\n")
      : new Response(archive);
    await expect(chargerPreuveArchiveFundingBinance("BTCUSDT", Date.UTC(1970, 1, 1), Date.UTC(1970, 2, 1) - 1, {
      fetcher,
      maintenantMs: Date.UTC(1970, 2, 1),
    })).rejects.toThrow(/mois/i);
  });

  it("borne l'UI avant le mois courant non attesté", () => {
    expect(finFenetreFundingArchivee(Date.UTC(2026, 8, 9, 12))).toBe(Date.UTC(2026, 8, 1) - 1);
  });

  it("refuse des bornes finies mais hors du domaine des dates JavaScript", async () => {
    await expect(chargerPreuveArchiveFundingBinance("BTCUSDT", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, {
      fetcher: async () => Response.json([]),
      maintenantMs: Date.UTC(2026, 8, 9),
    })).rejects.toThrow(/bornes/i);
  });
});

describe("bougies perp Binance pour backtest", () => {
  it("ne conserve que les bougies dont le close réel est dans la borne haute exclusive", () => {
    const brut = [
      [0, "100", "110", "90", "105", "12", 59, "1260", 5, "7", "735", "0"],
      [60, "105", "115", "100", "110", "10", 119, "1100", 4, "6", "660", "0"],
    ];
    expect(parseKlinesPerpBinance(brut, 0, 60)).toEqual([{
      time: 0, open: 100, high: 110, low: 90, close: 105, volume: 12,
      quoteVolume: 1260, trades: 5, buyVolume: 7, sellVolume: 5, closed: true,
    }]);
  });
});
