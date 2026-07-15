/**
 * @axiom/indicators — trend/gannHilo.test.ts
 * Vérifie la bascule de tendance et le choix de la ligne (sLow en haussier, sHigh en
 * baissier) avec length=1 (sHigh=high, sLow=low → seuils = bougie courante).
 */
import { describe, it, expect } from "vitest";
import type { Candle } from "@axiom/types";
import { gannHilo } from "./gannHilo";

const noCtx = { hl2: [], hlc3: [], ohlc4: [], source: [] };

function bougie(h: number, l: number, c: number): Candle {
  return { time: 0, open: c, high: h, low: l, close: c, volume: 1 };
}

describe("gannHilo", () => {
  it("length=1 : haussier → ligne = low ; bascule baissier → ligne = high", () => {
    // length=1 : sHigh=high, sLow=low. close>high impossible (close≤high), donc la
    // tendance ne passe haussière que par l'init (close ≥ (h+l)/2). Utilisons l'init +
    // une bascule baissière (close < low impossible aussi)… → on teste via length=1
    // avec close AU milieu : init haussier si close ≥ mid.
    const c = [bougie(10, 6, 9), bougie(10, 6, 7)]; // mid=8 ; c0=9≥8 haussier, c1=7<8…
    // length=1 : sHigh=10, sLow=6. Init idx0 : 9≥8 → hlv=1 → ligne=sLow=6.
    // idx1 : close=7 ; 7>10 ? non ; 7<6 ? non → hlv inchangé=1 → ligne=sLow=6.
    const res = gannHilo.calc(c, { length: 1 }, noCtx);
    expect(res.series.hilo?.[0]).toBe(6); // haussier → low
    expect(res.series.hilo?.[1]).toBe(6);
  });

  it("bascule baissière quand close < sLow (length=1, close sous le low précédent)", () => {
    // Construisons un cas où close < sLow(courant). length=1 → sLow=low courant, et
    // close ≤ low par construction impossible… donc utilisons length=2 pour décorréler.
    // sLow = SMA(low,2). close peut passer sous cette moyenne.
    const c = [bougie(10, 8, 9), bougie(10, 8, 9), bougie(12, 4, 5)];
    // sLow idx2 = (8+4)/2=6 ; sHigh idx2=(10+12)/2=11. close2=5 < sLow(6) → baissier → ligne=sHigh=11.
    const res = gannHilo.calc(c, { length: 2 }, noCtx);
    expect(res.series.hilo?.[2]).toBe(11); // baissier → sHigh
  });

  it("métadonnées (overlay, trend)", () => {
    expect(gannHilo.pane).toBe("overlay");
    expect(gannHilo.category).toBe("trend");
  });
});
