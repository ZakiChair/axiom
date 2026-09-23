import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DepthStabilityPanel } from "./DepthStabilityPanel";
import { StabiliteCarnet } from "../../data/depthStability";

describe("panneau de stabilité DOM", () => {
  it("affiche la chauffe et les deux couvertures sans attribuer un verdict stable", () => {
    const s = new StabiliteCarnet(1_000, 0);
    s.echantillonner(1_000, { lastUpdateId: 1, bids: new Map([[99, 100]]), asks: new Map([[101, 100]]) }, 1_000);
    const html = renderToStaticMarkup(<DepthStabilityPanel symbole="BTCUSDT" cotation="USDT" notionnelCotation={1_000} vue={s.vue(1_000)} onNotionnelChange={() => {}} />);
    expect(html).toContain("1 s observée");
    expect(html).toContain("100 % de la durée");
    expect(html).toContain("2 % de la fenêtre");
    expect(html).toContain("Vente");
    expect(html).toContain("couv. 100 % durée / 2 % fenêtre");
    expect(html).toContain("n=1 créneaux valides");
    expect(html).toContain("1 version distincte");
    expect(html).not.toContain("$1.00K");
    expect(html).toContain("Montant cible de liquidité en USDT");
    expect(html).toContain("médiane —");
    expect(html).not.toContain("stable");
  });

  it("nomme la vraie cotation et annonce une cotation inconnue", () => {
    const btc = renderToStaticMarkup(<DepthStabilityPanel symbole="ETHBTC" cotation="BTC" notionnelCotation={0.1} vue={null} onNotionnelChange={() => {}} />);
    expect(btc).toContain("Montant cible de liquidité en BTC");
    expect(btc).toContain(" BTC");
    expect(btc).not.toContain("USDT");
    const inconnu = renderToStaticMarkup(<DepthStabilityPanel symbole="BTCXYZ" cotation={null} notionnelCotation={1_000} vue={null} onNotionnelChange={() => {}} />);
    expect(inconnu).toContain("Devise de cotation indisponible");
    expect(inconnu).not.toContain("USDT");
  });
});
