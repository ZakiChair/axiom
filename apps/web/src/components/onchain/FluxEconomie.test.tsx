import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { seuilAlerteFlux, VueFluxCapitaux } from "./FluxCapitaux";
import { VueEconomieChaines } from "./EconomieChaines";
import { resumerSerie, type SerieEconomie } from "../../data/onchain/economieChaines";
import type { VueFluxCapitaux as DonneesFluxCapitaux } from "../../data/onchain/fluxCapitaux";

describe("rendu des flux communs", () => {
  it("affiche unités, période et qualité, et désactive l'alerte d'une valeur absente", () => {
    const now = Date.UTC(2026, 8, 9);
    const donnees: DonneesFluxCapitaux = { recupereLe: now, metriques: [
      { id: "etf-btc-flow", libelle: "Flux ETF BTC", valeur: 100_000_000, unite: "USD/j", periode: "séance", observeLe: now, source: "SoSoValue", alerte: false },
      { id: "exchange-netflow", libelle: "Flux net exchanges", valeur: null, unite: "BTC/j", periode: "jour", observeLe: null, source: "BGeometrics", alerte: true,
        qualite: { sourceId: "flux:exchange-netflow", sourceEffective: "BGeometrics", observeLe: null, recupereLe: now, cadenceMs: 86_400_000, couverture: null, estime: false, acces: "abonnement", statut: "indisponible", raison: "Abonnement requis" } },
    ] };
    const html = renderToStaticMarkup(<VueFluxCapitaux donnees={donnees} chargement={false} erreur={null} />);
    expect(html).toContain("Flux ETF BTC · séance");
    expect(html).toContain("Flux net exchanges · jour");
    expect(html).toContain("Abonnement requis");
    expect(html).toContain("disabled");
    expect(html).toContain("ne sont pas additionnés en score");
  });

  it("refuse un seuil vide et revalide la fraîcheur au moment de créer", () => {
    const now = Date.UTC(2026, 8, 9);
    const metrique: DonneesFluxCapitaux["metriques"][number] = {
      id: "exchange-netflow", libelle: "Flux", valeur: 12, unite: "BTC/j", periode: "jour", observeLe: now, source: "BGeometrics", alerte: true,
      qualite: { sourceId: "flux:exchange-netflow", sourceEffective: "BGeometrics", observeLe: now, recupereLe: now,
        cadenceMs: 86_400_000, couverture: null, estime: false, acces: "abonnement", statut: "frais" },
    };
    expect(seuilAlerteFlux(metrique, "", now)).toBeNull();
    expect(seuilAlerteFlux(metrique, "  ", now)).toBeNull();
    expect(seuilAlerteFlux(metrique, "1.5", now)).toBe(1.5);
    metrique.qualite!.statut = "perime";
    expect(seuilAlerteFlux(metrique, "1.5", now)).toBeNull();
  });

  it("refuse un snapshot resté frais en mémoire mais devenu ancien ou futur", () => {
    const now = Date.UTC(2026, 8, 9);
    const metrique: DonneesFluxCapitaux["metriques"][number] = {
      id: "exchange-netflow", libelle: "Flux", valeur: 1, unite: "BTC/j", periode: "jour", observeLe: now - 6 * 86_400_000, source: "BG", alerte: true,
      qualite: { sourceId: "x", sourceEffective: "BG", observeLe: now - 6 * 86_400_000, recupereLe: now - 6 * 86_400_000,
        cadenceMs: 86_400_000, couverture: null, estime: false, acces: "public", statut: "frais" },
    };
    expect(seuilAlerteFlux(metrique, "2", now)).toBeNull();
    metrique.observeLe = now + 1;
    metrique.qualite!.observeLe = now + 1;
    expect(seuilAlerteFlux(metrique, "2", now)).toBeNull();
    metrique.observeLe = now;
    metrique.qualite!.observeLe = now;
    metrique.qualite!.recupereLe = now + 1;
    expect(seuilAlerteFlux(metrique, "2", now)).toBeNull();
  });
});

describe("rendu de l'économie des chaînes", () => {
  it("sépare frais et revenus et rend l'absence de revenus explicite", () => {
    const points = [{ time: 1_788_739_200_000, value: 100 }, { time: 1_788_825_600_000, value: 110 }];
    const serie = (source: string): SerieEconomie => ({ disponible: true, perime: false, serie: points, resume: resumerSerie(points, 1_788_825_600_000), source, recupereLe: 1_788_825_600_000 });
    const absent: SerieEconomie = { disponible: false, perime: false, serie: [], resume: resumerSerie([], 1_788_825_600_000), source: "DefiLlama revenus", recupereLe: 1_788_825_600_000, raison: "historique vide" };
    const donnees = { recupereLe: 1_788_825_600_000, chaines: [
      { id: "base", libelle: "Base", tvl: serie("TVL"), dex: serie("DEX"), stablecoins: serie("stablecoins"), frais: serie("frais"), revenus: absent },
    ] } as const;
    const html = renderToStaticMarkup(<VueEconomieChaines donnees={{ recupereLe: donnees.recupereLe, chaines: [...donnees.chaines] }} chargement={false} erreur={null} />);
    expect(html).toContain("30 j");
    expect(html).toContain("90 j");
    expect(html).toContain("365 j");
    expect(html).toContain("Frais");
    expect(html).toContain("Revenus");
    expect(html).toContain("indisponible");
    expect(html).toContain("historique vide");
    expect(html).toContain("obs.");
    expect(html).toContain("récup.");
    expect(html).toContain("DefiLlama revenus");
    expect(html).not.toContain("Revenus</th><td");
    expect(html).toContain("Les quantités natives sous-jacentes ne sont pas fournies");
  });
});
