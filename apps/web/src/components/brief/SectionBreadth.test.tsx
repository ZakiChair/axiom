import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  calculerHistoriqueLargeur,
  conserverDerniersJours,
  JOURS_HISTORIQUE,
  resumerBreadth,
  type CloturesDatees,
  type HistoriqueLargeur,
  type ResumBreadth,
} from "../../data/breadth";
import { SectionBreadth } from "./SectionBreadth";

const JOUR = 86_400_000;
const J0 = Date.UTC(2026, 0, 1);

function serie(symbol: string, closes: number[]): CloturesDatees {
  return { symbol, t: closes.map((_, i) => J0 + i * JOUR), closes };
}

function lineaire(depart: number, pente: number, longueur: number): number[] {
  return Array.from({ length: longueur }, (_, i) => depart + pente * i);
}

function resume(series: CloturesDatees[]): ResumBreadth {
  const h = calculerHistoriqueLargeur(series);
  return resumerBreadth(series, { hausses: 7, baisses: 3 }, null, J0, h === null ? null : conserverDerniersJours(h, JOURS_HISTORIQUE));
}

function rendre(b: ResumBreadth): string {
  return renderToStaticMarkup(<SectionBreadth breadth={{ statut: "ready", data: b }} noteFraicheur="à 10:00" />);
}

describe("SectionBreadth — historique descriptif (SUG-41)", () => {
  it("rend les huit séries avec leur dernière valeur et leur dénominateur, et les réserves", () => {
    const b = resume([
      serie("BTCUSDT", lineaire(100, 0.1, 300)), // +~9 % sur 90 j en fin de série
      serie("ETHUSDT", lineaire(10, 0.05, 300)), // bat BTC
      serie("SOLUSDT", lineaire(50, -0.01, 300)), // ne bat pas
      serie("USDCUSDT", lineaire(1, 0, 300)), // stable : hors saison des alts
    ]);
    const html = rendre(b);
    expect(html).toContain("A/D jour · univers USDT");
    expect(html).toContain("Historique descriptif · du ");
    expect(html).toContain("du 11/04 au 27/10 (200 j)"); // dates des minuits UTC, lues en UTC
    for (const libelle of ["% &gt; MM50", "% &gt; MM200", "Plus hauts − bas 20 j", "Plus hauts − bas 55 j", "Ligne A/D · top 50", "Osc. type McClellan · top 50", "Alts &gt; BTC · 90 j", "Alts &gt; BTC · 30 j"]) {
      expect(html).toContain(libelle);
    }
    expect(html).toContain("50 % · 1/2"); // ETH bat BTC, SOL non ; USDC exclu du dénominateur
    expect(html).toContain("50 % · n 4"); // % > MM50 : BTC et ETH au-dessus, SOL (baisse) et USDC (plat) non
    expect(html).toContain("+25 % · n 4"); // plus hauts − bas 20 j : +1 +1 −1 0
    expect(html).toContain("biais du survivant");
    expect(html).toContain("convention (Altcoin Season Index, non revérifiée), pas un signal");
    expect(html).toContain("distincts de l&#x27;A/D jour (univers USDT complet)");
    expect(html.match(/<polyline/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("jour non mesuré (sans BTC, aucune alt comparable) : « non mesuré », jamais 0 %", () => {
    const html = rendre(resume([serie("ETHUSDT", lineaire(10, 0.05, 300)), serie("SOLUSDT", lineaire(50, 0.01, 300))]));
    expect(html.match(/non mesuré/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // 90 j, 30 j et la zone
    expect(html).not.toContain("0 % · 0/0");
  });

  it("historique indisponible : état explicite, l'instantané reste affiché", () => {
    const b: ResumBreadth = { ...resume([serie("BTCUSDT", lineaire(100, 1, 60))]), historique: null };
    const html = rendre(b);
    expect(html).toContain("Historique indisponible");
    expect(html).toContain("% &gt; MM50");
  });

  it("série de parts : un trou (n = 0) interrompt le trait au lieu de tomber à 0", () => {
    const h = resume([serie("BTCUSDT", lineaire(100, 1, 300))]).historique as HistoriqueLargeur;
    const troue: HistoriqueLargeur = {
      ...h,
      mm50: { k: h.mm50.k.map((k, i) => (i === 100 ? 0 : k)), n: h.mm50.n.map((n, i) => (i === 100 ? 0 : n)) },
    };
    const html = rendre({ ...resume([serie("BTCUSDT", lineaire(100, 1, 300))]), historique: troue });
    // La ligne % > MM50 est coupée en deux segments.
    const ligneMm50 = html.split("% &gt; MM50</span>")[2] ?? "";
    const avantLigneSuivante = ligneMm50.split("% &gt; MM200")[0] ?? "";
    expect(avantLigneSuivante.match(/<polyline/g)).toHaveLength(2);
  });
});
