import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VueFluxNetExchanges } from "./FluxNetExchanges";
import { resumerFluxNet } from "../../data/onchain/fluxExchangesCm";
import { formatDec, formatEntier, formatUsdSigne } from "../../lib/format";

const JOUR = 86_400_000;
const debut = Date.UTC(2024, 6, 1);
const serie = (valeurs: readonly number[]) => valeurs.map((value, i) => ({ time: debut + i * JOUR, value }));

describe("vue des flux nets exchanges (Coin Metrics)", () => {
  it("affiche les sommes 1/7/30 j signées en natif et en USD, le z-score, le statut flash et la courbe", () => {
    const valeurs = Array.from({ length: 800 }, (_, i) => ((i * 37) % 11) * 250 - 1_300);
    const net = serie(valeurs);
    const netUsd = serie(valeurs.map((v) => v * 60_000));
    const r = resumerFluxNet(net, netUsd);
    const html = renderToStaticMarkup(<VueFluxNetExchanges actif="BTC" net={net} netUsd={netUsd} flash />);
    expect(html).toContain("Flux net 1 j");
    expect(html).toContain("Flux net 7 j");
    expect(html).toContain("Flux net 30 j");
    expect(html).toContain(`${r.j30! > 0 ? "+" : ""}${formatEntier(r.j30)} BTC`);
    expect(html).toContain(formatUsdSigne(r.usdJ30));
    expect(html).toContain(formatUsdSigne(r.usdJ1));
    expect(html).toContain("z-score flux 30 j (730 j)");
    expect(html).toContain(formatDec(r.z30, 2));
    expect(html).toContain("flash");
    expect(html).toContain("<svg");
  });

  it("sans USD ni historique suffisant : tirets, jamais de zéro inventé", () => {
    const html = renderToStaticMarkup(<VueFluxNetExchanges actif="ETH" net={serie([-5, 3])} flash={false} />);
    expect(html).toContain("+3 ETH");
    expect(html).not.toContain("flash");
    expect(html).not.toContain("$0");
    expect(html).toContain("—");
  });

  it("série vide : message d'indisponibilité ou de chargement, sans courbe", () => {
    const vide = renderToStaticMarkup(<VueFluxNetExchanges actif="BTC" net={[]} flash={false} />);
    expect(vide).toContain("Flux exchanges indisponibles (Coin Metrics).");
    expect(vide).not.toContain("<svg");
    const chargement = renderToStaticMarkup(<VueFluxNetExchanges actif="BTC" net={[]} flash={false} loading />);
    expect(chargement).toContain("Chargement des flux Coin Metrics");
  });
});
