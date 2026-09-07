import { describe, expect, test } from "bun:test";
import { extraireCanNotify } from "./alerts";

describe("capacité heartbeat : visibilité et permission déclarées ensemble", () => {
  test("un onglet caché ne peut pas prendre en charge les notifications même avec permission", () => {
    expect(extraireCanNotify({ visible: false, canNotify: true })).toBe(false);
  });
  test("une visibilité non déclarée ne suffit pas pour désactiver le relais", () => {
    expect(extraireCanNotify({ canNotify: true })).toBe(false);
  });
  test("seule la combinaison visible et capable désactive le relais", () => {
    expect(extraireCanNotify({ visible: true, canNotify: true })).toBe(true);
    expect(extraireCanNotify({ visible: true, canNotify: false })).toBe(false);
    expect(extraireCanNotify({ visible: true })).toBeUndefined();
  });
});
