/**
 * Tests PURES de l'onboarding (parse, bornage, transitions) + conteneur store
 * (next / skip / complete / rejouer). localStorage mocké en mémoire.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_LAST_STEP,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_TOTAL_STEPS,
  bornerStep,
  doitAfficherOnboarding,
  etatApresNext,
  niveauAlerteDemo,
  onboardingStore,
  paramsAlerteDemo,
  parseOnboardingPersiste,
} from "./onboarding";
import type { Candle } from "@axiom/types";

/** Mock localStorage en mémoire (env Node). */
function installMockLocalStorage(): Storage {
  const data = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = mock;
  return mock;
}

let storage: Storage;

beforeEach(() => {
  storage = installMockLocalStorage();
  // Réinit store (l'hydratation initiale a déjà eu lieu à l'import — on force).
  onboardingStore.setState({ completed: false, step: 0 });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("parseOnboardingPersiste", () => {
  it("défauts si raw invalide", () => {
    expect(parseOnboardingPersiste(null)).toEqual({ completed: false, step: 0 });
    expect(parseOnboardingPersiste("x")).toEqual({ completed: false, step: 0 });
    expect(parseOnboardingPersiste([])).toEqual({ completed: false, step: 0 });
  });

  it("accepte completed + step borné", () => {
    expect(parseOnboardingPersiste({ completed: true, step: 2 })).toEqual({
      completed: true,
      step: 0, // completed → step figé à 0
    });
    expect(parseOnboardingPersiste({ completed: false, step: 1 })).toEqual({
      completed: false,
      step: 1,
    });
    expect(parseOnboardingPersiste({ completed: false, step: 99 })).toEqual({
      completed: false,
      step: ONBOARDING_LAST_STEP,
    });
  });
});

describe("bornerStep", () => {
  it("borne dans [0, LAST]", () => {
    expect(bornerStep(-3)).toBe(0);
    expect(bornerStep(1.7)).toBe(1);
    expect(bornerStep(ONBOARDING_TOTAL_STEPS)).toBe(ONBOARDING_LAST_STEP);
    expect(bornerStep(Number.NaN)).toBe(0);
  });
});

describe("etatApresNext", () => {
  it("incrémente puis complete à la dernière étape", () => {
    expect(etatApresNext({ completed: false, step: 0 })).toEqual({ completed: false, step: 1 });
    expect(etatApresNext({ completed: false, step: 1 })).toEqual({ completed: false, step: 2 });
    expect(etatApresNext({ completed: false, step: ONBOARDING_LAST_STEP })).toEqual({
      completed: true,
      step: 0,
    });
  });

  it("no-op si déjà completed", () => {
    expect(etatApresNext({ completed: true, step: 0 })).toEqual({ completed: true, step: 0 });
  });
});

describe("niveauAlerteDemo / paramsAlerteDemo", () => {
  it("utilise le dernier close +1 % arrondi", () => {
    const candles: Candle[] = [
      { time: 1, open: 100, high: 110, low: 90, close: 100, volume: 1 },
    ];
    expect(niveauAlerteDemo(candles)).toBe(101);
  });

  it("repli si buffer vide", () => {
    expect(niveauAlerteDemo([])).toBe(101_000); // 100_000 * 1.01
  });

  it("params alerte démo normalisent le symbole", () => {
    const p = paramsAlerteDemo("btcusdt", "binance", []);
    expect(p.symbol).toBe("BTCUSDT");
    expect(p.source).toBe("binance");
    expect(p.condition.type).toBe("prix-croise");
    expect(p.condition.sens).toBe("hausse");
    expect(p.message).toContain("démo");
  });
});

describe("doitAfficherOnboarding", () => {
  it("masque si completed", () => {
    expect(doitAfficherOnboarding(false)).toBe(true);
    expect(doitAfficherOnboarding(true)).toBe(false);
  });
});

describe("onboardingStore", () => {
  it("next avance les étapes puis complete", () => {
    onboardingStore.getState().next();
    expect(onboardingStore.getState()).toMatchObject({ completed: false, step: 1 });
    onboardingStore.getState().next();
    expect(onboardingStore.getState().step).toBe(2);
    onboardingStore.getState().next();
    expect(onboardingStore.getState().completed).toBe(true);
    expect(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}")).toMatchObject({
      completed: true,
    });
  });

  it("skip marque completed", () => {
    onboardingStore.getState().setStep(1);
    onboardingStore.getState().skip();
    expect(onboardingStore.getState().completed).toBe(true);
  });

  it("rejouer réouvre depuis l'étape 0", () => {
    onboardingStore.getState().complete();
    onboardingStore.getState().rejouer();
    expect(onboardingStore.getState()).toMatchObject({ completed: false, step: 0 });
  });
});
