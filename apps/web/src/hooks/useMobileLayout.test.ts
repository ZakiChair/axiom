import { afterEach, describe, expect, it, vi } from "vitest";
import { mobileLayoutSnapshot, subscribeMobileLayout, MOBILE_LAYOUT_QUERY } from "./useMobileLayout";

afterEach(() => vi.unstubAllGlobals());

describe("frontière commune téléphone / desktop", () => {
  it("reste compatible avec un rendu sans navigateur", () => {
    vi.stubGlobal("window", undefined);
    expect(mobileLayoutSnapshot()).toBe(false);
    expect(subscribeMobileLayout(() => {})()).toBeUndefined();
  });

  it("relit matchMedia après rotation et libère l'écouteur au démontage", () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    };
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal("window", { matchMedia });
    const notify = vi.fn();
    const unsubscribe = subscribeMobileLayout(notify);
    expect(mobileLayoutSnapshot()).toBe(false);
    media.matches = true;
    listeners.forEach((listener) => listener());
    expect(notify).toHaveBeenCalledOnce();
    expect(mobileLayoutSnapshot()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(MOBILE_LAYOUT_QUERY);
    unsubscribe();
    listeners.forEach((listener) => listener());
    expect(notify).toHaveBeenCalledOnce();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", notify);
  });
});
