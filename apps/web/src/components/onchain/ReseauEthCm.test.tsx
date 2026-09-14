import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VueReseauEthCm } from "./ReseauEthCm";
import { calculerReseauEthCm, type ReseauEthCm } from "../../data/onchain/reseauEthCm";
import { formatDec, formatEntier, formatPct, formatPourcentage, formatPrice } from "../../lib/format";

const JOUR = 86_400_000;
const FIN = Date.UTC(2026, 8, 13);

/** 800 jours : flux net −1 000 ETH/j, réserve cohérente sauf une marche de +500 000 ETH à J−100. */
function reseau(): ReseauEthCm {
  const s = (f: (i: number) => number) => {
    const points = Array.from({ length: 800 }, (_, i) => ({ time: FIN - (799 - i) * JOUR, value: f(i) }));
    return { points, dernier: points.at(-1) };
  };
  return calculerReseauEthCm({
    CapMrktCurUSD: s(() => 302_112_948_927.53),
    CapMVRVCur: s(() => 1.093547895553365),
    SplyCur: s((i) => 120_000_000 + 2_900 * i),
    SplyExNtv: s((i) => 16_000_000 - 1_000 * i + (i >= 699 ? 500_000 : 0)),
    FlowInExNtv: s(() => 100_000),
    FlowOutExNtv: s(() => 101_000),
    FeeTotNtv: s(() => 170),
  }, true);
}

describe("section Réseau ETH · Coin Metrics de CHAIN", () => {
  it("réserve, variations avec drapeau de périmètre, émission, frais totaux, prix réalisé, flux et limites", () => {
    const donnee = reseau();
    const html = renderToStaticMarkup(<VueReseauEthCm resultat={{ donnee, ts: FIN + JOUR, perime: false }} />);
    const [v30, v90, v365] = donnee.reserve!.variations;
    expect(v365!.marche).toBe(true);
    expect(v90!.marche).toBe(false);
    expect(html).toContain("Coin Metrics Community");
    expect(html).toContain("Réserve exchanges ETH");
    expect(html).toContain(`${formatPourcentage(donnee.reserve!.partOffrePct)} de l&#x27;offre`);
    expect(html).toContain("Variation de la réserve (30 j)");
    expect(html).toContain(formatPct(v30!.pct));
    expect(html).toContain(`90 j ${formatPct(v90!.pct)} · 365 j ${formatPct(v365!.pct)} (périmètre)`);
    expect(html).toContain("Émission nette ETH (30 j)");
    expect(html).toContain(`${formatPct(donnee.emission.pctAn30)}/an`);
    expect(html).toContain(`frais totaux 30 j ${formatEntier(5_100)} ETH`);
    expect(html).toContain("Prix réalisé ETH");
    expect(html).toContain(`$${formatPrice(donnee.prixRealise.prixRealiseUsd)}`);
    expect(html).toContain(`spot CM $${formatPrice(donnee.prixRealise.spotCmUsd)} · écart ${formatPct(donnee.prixRealise.ecartSpotPct)} · MVRV ${formatDec(donnee.prixRealise.mvrv, 2)}`);
    expect(html).toContain("flash");
    expect(html).toContain("Flux net 30 j");
    expect(html).toContain("Périmètre d&#x27;adresses révisable");
    expect(html).toContain("<svg");
    expect(html).not.toContain("brûl");
    expect(html).not.toContain("plus bas");
    expect(html).not.toContain("cache ou observation périmé");
  });

  it("contrôle de périmètre impossible : « (non contrôlé) », jamais un horizon présenté comme propre", () => {
    const donnee = reseau();
    donnee.reserve!.variations[0] = { ...donnee.reserve!.variations[0]!, marche: null };
    const html = renderToStaticMarkup(<VueReseauEthCm resultat={{ donnee, ts: FIN, perime: true }} />);
    expect(html).toContain(`${formatPct(donnee.reserve!.variations[0]!.pct)} (non contrôlé)`);
    expect(html).toContain("cache ou observation périmé");
  });

  it("valeurs absentes : tirets, aucun dollar ni zéro inventé", () => {
    const donnee = calculerReseauEthCm({
      FlowInExNtv: { points: [{ time: FIN, value: 5 }] },
      FlowOutExNtv: { points: [{ time: FIN, value: 7 }] },
    }, false);
    const html = renderToStaticMarkup(<VueReseauEthCm resultat={{ donnee, ts: FIN, perime: false }} />);
    expect(html).toContain("Prix réalisé ETH");
    expect(html).not.toContain("$—");
    expect(html).not.toContain("$0");
    expect(html).not.toContain(">flash<");
  });

  it("sans résultat : chargement ou indisponibilité explicite", () => {
    expect(renderToStaticMarkup(<VueReseauEthCm resultat={null} loading />)).toContain("Chargement Coin Metrics ETH");
    const indisponible = renderToStaticMarkup(<VueReseauEthCm resultat={null} />);
    expect(indisponible).toContain("Réseau ETH Coin Metrics indisponible.");
    expect(indisponible).not.toContain("<svg");
  });
});
