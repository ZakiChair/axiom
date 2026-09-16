import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthStore } from "../../store/health";
import { parseEtfFlows, rapporterSanteEtf, sosoUnusableWithoutKey } from "./etf";

function stockage(): Storage {
  const valeurs = new Map<string, string>();
  return { getItem: (k) => valeurs.get(k) ?? null, setItem: (k, v) => void valeurs.set(k, v),
    removeItem: (k) => void valeurs.delete(k), clear: () => valeurs.clear(), key: (i) => [...valeurs.keys()][i] ?? null,
    get length() { return valeurs.size; } };
}

describe("fetchEtfFlows — acquisition réelle du cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", stockage());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ne redaté pas une séance relue depuis le cache", async () => {
    const t0 = Date.UTC(2026, 8, 9, 10);
    vi.setSystemTime(t0);
    const fetcher = vi.fn(async () => Response.json({ data: {
      dailyNetInflow: { value: "10", lastUpdateDate: "2026-09-08" },
      list: [{ ticker: "IBIT", dailyNetInflow: { value: "10" } }],
    } }));
    vi.stubGlobal("fetch", fetcher);
    const { fetchEtfFlows } = await import("./etf");
    const premier = await fetchEtfFlows("btc", "cle");
    vi.setSystemTime(t0 + 15 * 60_000);
    const cache = await fetchEtfFlows("btc", "cle");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(premier.recupereLe).toBe(t0);
    expect(cache.recupereLe).toBe(t0);
    expect(cache.sourceEffective).toBe("cache SoSoValue");
  });
});

// Schéma RÉEL confirmé par curl direct (2026-07-08) sur
// POST https://openapi.sosovalue.com/openapi/v2/etf/currentEtfDataMetrics
// avec { type: "us-btc-spot" | "us-eth-spot" | "us-sol-spot" } — voir en-tête de etf.ts.
describe("sosoUnusableWithoutKey", () => {
  it("exige une clé personnelle uniquement sur Vercel", () => {
    expect(sosoUnusableWithoutKey(true, null)).toBe(true);
    expect(sosoUnusableWithoutKey(true, "   ")).toBe(true);
    expect(sosoUnusableWithoutKey(true, "personnelle")).toBe(false);
    expect(sosoUnusableWithoutKey(false, null)).toBe(false);
  });
});

describe("parseEtfFlows (schéma réel SoSoValue currentEtfDataMetrics)", () => {
  it("ne transforme pas les données nulles/non publiées en flux nul", () => {
    const r = parseEtfFlows({ data: { list: [null,
      { ticker: "A", dailyNetInflow: { value: null, status: "3" } },
      { ticker: "B", dailyNetInflow: { value: "", status: "1" } },
      { ticker: "C", dailyNetInflow: { value: "10", status: "3" } },
      { ticker: "D", dailyNetInflow: { value: 0, status: "1" } },
    ] } });
    expect(r.parEmetteur).toEqual([{ emetteur: "D", flux: 0 }]);
  });
  it("parse une réponse valide", () => {
    const json = {
      code: 0,
      msg: null,
      traceId: null,
      data: {
        totalNetAssets: { value: "77259139787.999919722", lastUpdateDate: "2026-07-07", status: "1" },
        dailyNetInflow: { value: "21435004.25", lastUpdateDate: "2026-07-07", status: "1" },
        list: [
          {
            id: 1746110179689463810,
            ticker: "IBIT",
            institute: "BlackRock ",
            dailyNetInflow: { value: "54799040.0000000000000000", lastUpdateDate: "2026-07-07", status: "1" },
          },
          {
            id: 1746110179697852417,
            ticker: "FBTC",
            institute: "Fidelity",
            dailyNetInflow: { value: "-24919910.5499999970000000", lastUpdateDate: "2026-07-07", status: "1" },
          },
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.disponible).toBe(true);
    expect(r.parEmetteur?.[0]).toEqual({ emetteur: "IBIT", flux: 54_799_040 });
    expect(r.parEmetteur?.[1]?.emetteur).toBe("FBTC");
    expect(r.parEmetteur?.[1]?.flux).toBeCloseTo(-24_919_910.55);
    expect(r.total).toBeCloseTo(29_879_129.45);
    expect(r.jour).toBe("2026-07-07");
  });

  it("dégrade proprement sur forme inconnue", () => {
    expect(parseEtfFlows(null).disponible).toBe(false);
    expect(parseEtfFlows({}).disponible).toBe(false);
    expect(parseEtfFlows({ data: { list: [] } }).disponible).toBe(false);
    expect(parseEtfFlows({ data: {} }).disponible).toBe(false);
    // code d'erreur SoSoValue (ex. clé invalide) : pas de `data.list` exploitable.
    expect(parseEtfFlows({ code: 401, msg: "invalid api key", data: null }).disponible).toBe(false);
  });

  it("trie les émetteurs par |flux du jour| décroissant (départage par ticker)", () => {
    // Ordre d'entrée VOLONTAIREMENT différent de l'ordre attendu : GBTC arrive en tête
    // du payload mais a le plus petit |flux| ; ARKB (sortie −80M) doit passer devant IBIT
    // (+50M) car |−80M| > |+50M|. Deux ex æquo (±10M) départagés par ticker : BITB < HODL.
    const json = {
      data: {
        dailyNetInflow: { value: "0", lastUpdateDate: "2026-07-07" },
        list: [
          { ticker: "GBTC", dailyNetInflow: { value: "5000000" } },
          { ticker: "IBIT", dailyNetInflow: { value: "50000000" } },
          { ticker: "HODL", dailyNetInflow: { value: "-10000000" } },
          { ticker: "ARKB", dailyNetInflow: { value: "-80000000" } },
          { ticker: "BITB", dailyNetInflow: { value: "10000000" } },
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.parEmetteur?.map((e) => e.emetteur)).toEqual(["ARKB", "IBIT", "BITB", "HODL", "GBTC"]);
  });

  // Fixture RÉDUITE (3 fonds) d'une réponse réelle du 2026-09-15 (type us-btc-spot) : les
  // fractions SoSoValue (part de la capitalisation, prime/décote, frais) sont exposées ×100.
  const REPONSE_REELLE = {
    code: 0,
    msg: null,
    traceId: null,
    data: {
      totalNetAssets: { value: "95716988283.2459999600000000", lastUpdateDate: "2026-09-15", status: "1" },
      totalNetAssetsPercentage: { value: "0.06275858", lastUpdateDate: "2026-09-15", status: "1" },
      dailyNetInflow: { value: "-450329418.7100000000000000", lastUpdateDate: "2026-09-15", status: "1" },
      cumNetInflow: { value: "54885848662.9279983356500000", lastUpdateDate: "2026-09-15", status: "1" },
      dailyTotalValueTraded: { value: "4346558481.4000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
      totalTokenHoldings: { value: "1260520.19998050", lastUpdateDate: "2026-09-15", status: "1" },
      list: [
        {
          id: 1746110179689463810,
          ticker: "IBIT",
          institute: "BlackRock ",
          fee: { value: "0.00250000", lastUpdateDate: "2026-09-15", status: "1" },
          netAssetsPercentage: { value: "0.03906797", lastUpdateDate: "2026-09-15", status: "1" },
          netAssets: { value: "59584956800.0000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          dailyNetInflow: { value: "-161691280.0000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          cumNetInflow: { value: "63976600063.6599987745000000", lastUpdateDate: "2026-09-15", status: "1" },
          dailyValueTraded: { value: "3328760000.0000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          discountPremiumRate: { value: "0.0024881984977791483", lastUpdateDate: "2026-09-15", status: "1" },
        },
        {
          id: 1746110179697852417,
          ticker: "FBTC",
          institute: "Fidelity",
          fee: { value: "0.00000000", lastUpdateDate: "2026-09-15", status: "1" },
          netAssetsPercentage: { value: "0.00865117", lastUpdateDate: "2026-09-15", status: "1" },
          netAssets: { value: "13194434472.8320000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          dailyNetInflow: { value: "-214754800.0000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          cumNetInflow: { value: "10120528736.9499998597000000", lastUpdateDate: "2026-09-15", status: "1" },
          dailyValueTraded: { value: "425269700.0000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          discountPremiumRate: { value: "0.001840192861812584", lastUpdateDate: "2026-09-15", status: "1" },
        },
        {
          id: 1746110179697852418,
          ticker: "ARKB",
          institute: "Ark & 21Shares",
          fee: { value: "0.00210000", lastUpdateDate: "2026-09-15", status: "1" },
          netAssetsPercentage: { value: "0.00158727", lastUpdateDate: "2026-09-15", status: "1" },
          netAssets: { value: "2420846354.9000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          dailyNetInflow: { value: "-17381727.2100000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          cumNetInflow: { value: "1163146450.4849999813000000", lastUpdateDate: "2026-09-15", status: "1" },
          dailyValueTraded: { value: "127368400.0000000000000000", lastUpdateDate: "2026-09-15", status: "1" },
          discountPremiumRate: { value: "0.0015517899731207763", lastUpdateDate: "2026-09-15", status: "1" },
        },
      ],
    },
  };

  it("lit les champs par fonds et globaux (encours, part de la capitalisation ×100, cumul, volume, prime, frais)", () => {
    const r = parseEtfFlows(REPONSE_REELLE);
    expect(r.disponible).toBe(true);
    // Tri par |flux| inchangé : FBTC (−214 M) devant IBIT (−161 M) devant ARKB (−17 M).
    expect(r.parEmetteur?.map((e) => e.emetteur)).toEqual(["FBTC", "IBIT", "ARKB"]);
    expect(r.total).toBeCloseTo(-393_827_807.21);
    const ibit = r.parEmetteur?.[1];
    expect(ibit?.flux).toBe(-161_691_280);
    expect(ibit?.encoursUsd).toBe(59_584_956_800);
    // netAssetsPercentage = part de la CAPITALISATION du BTC détenue par ce fonds, pas de l'encours ETF.
    expect(ibit?.partCapitalisationPct).toBeCloseTo(3.906797);
    expect(ibit?.cumulUsd).toBeCloseTo(63_976_600_063.66);
    expect(ibit?.volumeUsd).toBe(3_328_760_000);
    expect(ibit?.primeDecotePct).toBeCloseTo(0.2488);
    expect(ibit?.fraisPct).toBeCloseTo(0.25);
    // Frais réellement nuls (FBTC, status 1) : un vrai zéro est conservé.
    expect(r.parEmetteur?.[0]?.fraisPct).toBe(0);
    expect(r.encoursTotalUsd).toBeCloseTo(95_716_988_283.246);
    expect(r.partCapitalisationTotalePct).toBeCloseTo(6.275858);
    expect(r.avoirsTotal).toBeCloseTo(1_260_520.2);
    expect(r.volumeTotalUsd).toBeCloseTo(4_346_558_481.4);
    expect(r.cumulTotalUsd).toBeCloseTo(54_885_848_662.93);
  });

  it("champ non publié (status 3) ou absent → clé omise, jamais 0 ; flux et total inchangés", () => {
    const r = parseEtfFlows({
      data: {
        dailyNetInflow: { value: "-30", lastUpdateDate: "2026-09-15", status: "1" },
        totalNetAssets: { value: "1000", lastUpdateDate: "2026-09-15", status: "3" },
        totalTokenHoldings: { value: "1260520.2", lastUpdateDate: "2026-09-15", status: "1" },
        list: [
          {
            ticker: "IBIT",
            dailyNetInflow: { value: "-20", status: "1" },
            netAssets: { value: "500", status: "3" },
            cumNetInflow: { value: "700", status: "1" },
            discountPremiumRate: { value: null, status: "1" },
          },
          { ticker: "FBTC", dailyNetInflow: { value: "-10", status: "1" } },
        ],
      },
    });
    expect(r.total).toBe(-30);
    const ibit = r.parEmetteur?.[0];
    expect(ibit?.flux).toBe(-20);
    expect(ibit?.cumulUsd).toBe(700);
    expect(ibit).not.toHaveProperty("encoursUsd");
    expect(ibit).not.toHaveProperty("primeDecotePct");
    expect(ibit).not.toHaveProperty("fraisPct");
    expect(r.parEmetteur?.[1]).toStrictEqual({ emetteur: "FBTC", flux: -10 });
    expect(r.avoirsTotal).toBeCloseTo(1_260_520.2);
    expect(r).not.toHaveProperty("encoursTotalUsd");
    expect(r).not.toHaveProperty("volumeTotalUsd");
  });

  it("ignore les entrées de la liste sans ticker ou avec netInflow non numérique", () => {
    const json = {
      data: {
        dailyNetInflow: { value: "1", lastUpdateDate: "2026-07-07" },
        list: [
          { ticker: "IBIT", dailyNetInflow: { value: "100" } },
          { ticker: "BOGUS", dailyNetInflow: { value: "not-a-number" } },
          { dailyNetInflow: { value: "200" } }, // pas de ticker
        ],
      },
    };
    const r = parseEtfFlows(json);
    expect(r.disponible).toBe(true);
    expect(r.parEmetteur).toEqual([{ emetteur: "IBIT", flux: 100 }]);
    expect(r.total).toBe(100);
  });
});

describe("rapporterSanteEtf (agrégation d'un cycle btc/eth/sol)", () => {
  it("au moins un actif disponible → polling (peu importe l'ordre des échecs)", () => {
    rapporterSanteEtf([
      { disponible: false, raison: "SoSoValue indisponible (HTTP 429)." },
      { disponible: true, parEmetteur: [{ emetteur: "IBIT", flux: 1 }], total: 1 },
      { disponible: false, raison: "SoSoValue injoignable." },
    ]);
    expect(healthStore.getState().sources["sosovalue"]?.etat).toBe("polling");
  });

  it("tous en échec → erreur avec la première raison", () => {
    rapporterSanteEtf([
      { disponible: false, raison: "SoSoValue injoignable." },
      { disponible: false, raison: "SoSoValue indisponible (HTTP 500)." },
    ]);
    const sante = healthStore.getState().sources["sosovalue"];
    expect(sante?.etat).toBe("error");
    expect(sante?.derniereErreur).toBe("SoSoValue injoignable.");
  });

  it("cycle vide → aucune écriture (pas d'état fantôme)", () => {
    healthStore.getState().retirer("sosovalue");
    rapporterSanteEtf([]);
    expect(healthStore.getState().sources["sosovalue"]).toBeUndefined();
  });
});
