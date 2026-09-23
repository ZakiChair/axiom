import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { okxAdapter } from "./okx";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { MockWebSocket.instances.push(this); }
  send(payload: string) { this.sent.push(payload); }
  close() { this.onclose?.(); }
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("flux OKX séparés par service", () => {
  it("abonne CARDS aux bougies du service business et transmet leur clôture", () => {
    const receive = vi.fn();
    const stop = okxAdapter.subscribeKline("CARDSUSDT", "1m", receive);
    try {
      const socket = MockWebSocket.instances[0]!;
      // Depuis juin 2023, public refuse ce canal avec le code 60018.
      expect(socket.url).toBe("wss://ws.okx.com:8443/ws/v5/business");
      socket.onopen?.();
      expect(JSON.parse(socket.sent[0]!)).toEqual({ op: "subscribe", args: [{ channel: "candle1m", instId: "CARDS-USDT" }] });
      socket.onmessage?.({ data: JSON.stringify({ arg: { channel: "candle1m", instId: "CARDS-USDT" },
        data: [["1790161200000", "0.1805", "0.1807", "0.1795", "0.1795", "9328.87", "1679.86", "1679.86", "0"]] }) });
      expect(receive).toHaveBeenCalledWith({ time: 1790161200000, open: 0.1805, high: 0.1807, low: 0.1795, close: 0.1795, volume: 9328.87, closed: false });
    } finally { stop(); }
  });

  it("garde les trades CARDS sur le service public", () => {
    const receive = vi.fn();
    const stop = okxAdapter.subscribeTrades("CARDSUSDT", receive);
    try {
      const socket = MockWebSocket.instances[0]!;
      expect(socket.url).toBe("wss://ws.okx.com:8443/ws/v5/public");
      socket.onopen?.();
      expect(JSON.parse(socket.sent[0]!)).toEqual({ op: "subscribe", args: [{ channel: "trades", instId: "CARDS-USDT" }] });
      socket.onmessage?.({ data: JSON.stringify({ arg: { channel: "trades", instId: "CARDS-USDT" },
        data: [{ instId: "CARDS-USDT", tradeId: "1", px: "0.18", sz: "2", side: "buy", ts: "1790161200000" }] }) });
      expect(receive).toHaveBeenCalledWith({ time: 1790161200000, price: 0.18, qty: 2, side: "buy" });
    } finally { stop(); }
  });
});
