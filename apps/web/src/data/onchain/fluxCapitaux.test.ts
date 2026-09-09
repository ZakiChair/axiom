import { describe, expect, it } from "vitest";
import { _viderCacheStablecoinsFlux, alignerFluxCapitaux, chargerStablecoinsFlux, lireAccordsFlux, qualifierMetriqueFlux, variationSurHorizon, type MetriqueFluxCapitaux } from "./fluxCapitaux";

describe("vue commune des flux de capitaux", () => {
  it("conserve unités, périodes et indisponibilités au lieu de fabriquer un score", () => {
    const jour = 86_400_000;
    const now = Date.UTC(2026, 8, 9);
    const resultat = alignerFluxCapitaux({
      now,
      etf: {
        btc: [{ time: now, fluxUsd: 100, encoursUsd: 10_000 }],
        eth: [],
        sol: [],
      },
      stablecoins: [
        { time: now - 7 * jour, totalUsd: 200 },
        { time: now, totalUsd: 220 },
      ],
      realizedCap: [
        { time: now - 90 * jour, value: 400 },
        { time: now - 30 * jour, value: 450 },
        { time: now, value: 500 },
      ],
      sthRealizedPrice: [],
      exchangeNetflow: [],
      exchangeReserve: [],
    });

    expect(resultat.metriques.map((m) => [m.id, m.valeur, m.unite, m.periode])).toEqual([
      ["etf-btc-flow", 100, "USD/j", "séance"],
      ["etf-btc-ratio", 1, "% AUM/j", "séance"],
      ["etf-eth-flow", null, "USD/j", "séance"],
      ["etf-eth-ratio", null, "% AUM/j", "séance"],
      ["etf-sol-flow", null, "USD/j", "séance"],
      ["etf-sol-ratio", null, "% AUM/j", "séance"],
      ["stablecoins-stock", 220, "USD", "niveau"],
      ["stablecoins-variation-7j", 10, "%", "7 j"],
      ["realized-cap-stock", 500, "USD", "niveau"],
      ["realized-cap-variation-30j", 11.11111111111111, "%", "30 j"],
      ["realized-cap-variation-90j", 25, "%", "90 j"],
      ["sth-realized-price", null, "USD/BTC", "niveau"],
      ["lth-realized-price", null, "USD/BTC", "niveau"],
      ["exchange-netflow", null, "BTC/j", "jour"],
      ["exchange-reserve", null, "BTC", "niveau"],
    ]);
    expect("score" in resultat).toBe(false);
  });

  it("refuse une variation si le point antérieur manque ou vaut zéro", () => {
    const now = Date.UTC(2026, 8, 9);
    expect(variationSurHorizon([{ time: now, value: 10 }], now, 30)).toBeNull();
    expect(variationSurHorizon([
      { time: now - 30 * 86_400_000, value: 0 },
      { time: now, value: 10 },
    ], now, 30)).toBeNull();
    expect(variationSurHorizon([
      { time: now - 31 * 86_400_000, value: 5 },
      { time: now, value: 10 },
    ], now, 30)).toBeNull();
  });

  it("conserve la vraie date d'acquisition stablecoin et marque le cache périmé après échec", async () => {
    _viderCacheStablecoinsFlux();
    let now = Date.UTC(2026, 8, 9);
    let panne = false;
    const fetcher = async () => panne
      ? new Response("panne", { status: 503 })
      : new Response(JSON.stringify([{ date: String(now / 1000), totalCirculatingUSD: { peggedUSD: 100, peggedJPY: 5 } }]));
    const frais = await chargerStablecoinsFlux({ fetcher, now: () => now });
    expect(frais).toMatchObject({ recupereLe: Date.UTC(2026, 8, 9), perime: false });
    expect(frais.points.at(-1)?.totalUsd).toBe(105);

    panne = true;
    now += 2 * 3_600_000;
    const repli = await chargerStablecoinsFlux({ fetcher, now: () => now });
    expect(repli).toMatchObject({ recupereLe: Date.UTC(2026, 8, 9), perime: true, raison: "Cache périmé · HTTP 503" });
  });

  it("ne publie ni stock nul ni variation fraîche depuis un agrégat USD partiel", async () => {
    _viderCacheStablecoinsFlux();
    const now = Date.UTC(2026, 8, 9);
    const charge = await chargerStablecoinsFlux({ now: () => now, fetcher: async () => new Response(JSON.stringify([
      { date: String(now / 1000), totalCirculatingUSD: { peggedUSD: null, peggedEUR: 0 } },
    ])) });
    const vue = alignerFluxCapitaux({ now, etf: { btc: [], eth: [], sol: [] }, stablecoins: charge.points,
      realizedCap: [], sthRealizedPrice: [], exchangeNetflow: [], exchangeReserve: [] });
    const variation = vue.metriques.find((m) => m.id === "stablecoins-variation-7j")!;
    expect(charge).toMatchObject({ disponible: false, raison: "historique vide" });
    expect(vue.metriques.find((m) => m.id === "stablecoins-stock")?.valeur).toBeNull();
    expect(variation.valeur).toBeNull();
    expect(qualifierMetriqueFlux("flux:stablecoins-variation-7j", "DefiLlama", variation.observeLe, now, variation.valeur,
      { recupereLe: charge.recupereLe, disponible: charge.disponible, perime: charge.perime, acces: "public" }, null).statut).toBe("indisponible");
  });

  it("explique accords et désaccords seulement entre observations fraîches et comparables", () => {
    const now = Date.UTC(2026, 8, 9);
    const metrique = (id: MetriqueFluxCapitaux["id"], valeur: number, periode: string): MetriqueFluxCapitaux => ({
      id, libelle: id, valeur, unite: "%", periode, observeLe: now, source: "source", alerte: true,
      qualite: { sourceId: `flux:${id}`, sourceEffective: "source", observeLe: now, recupereLe: now, cadenceMs: 86_400_000,
        couverture: null, estime: false, acces: "public", statut: "frais" },
    });
    const lectures = lireAccordsFlux([
      metrique("etf-btc-ratio", 1, "séance"), metrique("etf-eth-ratio", -1, "séance"),
      metrique("realized-cap-variation-30j", 2, "30 j"), metrique("realized-cap-variation-90j", 3, "90 j"),
    ]);
    expect(lectures).toEqual([
      { id: "etf", titre: "Désaccord entre ETF", detail: "BTC positif ; ETH negatif sur la séance du 2026-09-09. Comparaison de signes des ratios flux/encours de cette séance." },
      { id: "realized-cap", titre: "Même direction selon les horizons", detail: "Capitalisation réalisée : 30 j positif, 90 j positif, observation du 2026-09-09. Les périodes diffèrent et ne sont pas additionnées." },
    ]);
    const decale = metrique("etf-eth-ratio", 1, "séance");
    decale.observeLe = now - 86_400_000;
    expect(lireAccordsFlux([metrique("etf-btc-ratio", 1, "séance"), decale])).toEqual([]);
  });

  it("calcule la fraîcheur contre l'horloge courante et propage la dégradation fournisseur", () => {
    const now = Date.UTC(2026, 8, 9);
    const source = { recupereLe: now - 10 * 86_400_000, disponible: true, perime: false, acces: "public" as const };
    expect(qualifierMetriqueFlux("flux:x", "DefiLlama", now - 10 * 86_400_000, now, 1, source, null))
      .toMatchObject({ statut: "perime", raison: "Dernière observation trop ancienne" });
    expect(qualifierMetriqueFlux("flux:x", "DefiLlama", now, now, 1, { ...source, perime: true, repli: true, raison: "Cache périmé · HTTP 503" }, null))
      .toMatchObject({ statut: "perime", sourceEffective: "cache DefiLlama", raison: "Cache périmé · HTTP 503" });
  });
});
