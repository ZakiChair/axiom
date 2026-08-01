/**
 * Tests de la fonction PURE `overlayIndicators` : filtre les instances actives à
 * `def.pane === "overlay"` (EMA/BOLL/VWAP ancré…) et exclut les indicateurs à pane
 * séparé (RSI/MACD…). Le contrôleur DOM (`OverlayLegend`) est vérifié par rendu réel,
 * même convention que `measureTool.ts`/`paneHeaders.tsx` (pas de test dédié pour lui).
 */
import { describe, expect, it } from "vitest";
import { overlayIndicators } from "./overlayLegend";
import type { ActiveIndicator } from "../store/indicators";

describe("overlayIndicators", () => {
  it("garde une instance overlay (anchoredVwap) et calcule son libellé", () => {
    const indicators: ActiveIndicator[] = [
      { instanceId: "vwap-1", defId: "anchoredVwap", params: { anchorTime: 1_700_000_000_000 } , couleurIdx: 0 },
    ];
    const result = overlayIndicators(indicators);
    expect(result).toHaveLength(1);
    expect(result[0]?.instanceId).toBe("vwap-1");
    expect(result[0]?.label).toContain("VWAP ancré");
  });

  it("exclut une instance à pane séparé (rsi)", () => {
    const indicators: ActiveIndicator[] = [
      { instanceId: "rsi-1", defId: "rsi", params: { length: 14, source: "close" } , couleurIdx: 0 },
    ];
    expect(overlayIndicators(indicators)).toEqual([]);
  });

  it("ignore silencieusement un defId inconnu (indicateur retiré du catalogue)", () => {
    const indicators: ActiveIndicator[] = [{ instanceId: "ghost-1", defId: "n-existe-pas", params: {} , couleurIdx: 0 }];
    expect(overlayIndicators(indicators)).toEqual([]);
  });

  it("préserve l'ordre d'entrée pour un mélange overlay + séparé", () => {
    const indicators: ActiveIndicator[] = [
      { instanceId: "rsi-1", defId: "rsi", params: { length: 14, source: "close" } , couleurIdx: 0 },
      { instanceId: "vwap-1", defId: "anchoredVwap", params: { anchorTime: 0 } , couleurIdx: 0 },
    ];
    expect(overlayIndicators(indicators).map((r) => r.instanceId)).toEqual(["vwap-1"]);
  });
});
