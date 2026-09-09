import { afterEach, expect, it, vi } from "vitest";
import { abonnerHorloge } from "./horloge";

afterEach(() => vi.useRealTimers());

it("partage un seul minuteur, notifie sans réseau et le libère au dernier départ", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const a = vi.fn();
  const b = vi.fn();
  const libererA = abonnerHorloge(a);
  const libererB = abonnerHorloge(b);
  try {
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(a).toHaveBeenLastCalledWith(1_010_000);
    expect(b).toHaveBeenLastCalledWith(1_010_000);
    libererA();
    libererA();
    expect(vi.getTimerCount()).toBe(1);
  } finally {
    libererA();
    libererB();
  }
  expect(vi.getTimerCount()).toBe(0);
});
