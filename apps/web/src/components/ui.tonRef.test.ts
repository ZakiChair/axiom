import { describe, expect, it } from "vitest";
import { tonRef } from "./ui";

const ref = (percentile: number) => ({ percentile, profondeurJours: 30, n: 90 });

describe("tonRef", () => {
  it("extrême → warn, sinon neutre", () => {
    expect(tonRef(ref(95))).toBe("warn");
    expect(tonRef(ref(5))).toBe("warn");
    expect(tonRef(ref(50))).toBe("neutre");
  });
  it("sens hausse-chaud : seule la queue HAUTE est chaude", () => {
    expect(tonRef(ref(95), "hausse-chaud")).toBe("warn");
    expect(tonRef(ref(5), "hausse-chaud")).toBe("neutre");
  });
  it("sens hausse-froid : seule la queue BASSE est chaude", () => {
    expect(tonRef(ref(5), "hausse-froid")).toBe("warn");
    expect(tonRef(ref(95), "hausse-froid")).toBe("neutre");
  });
});
