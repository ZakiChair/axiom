/**
 * Tests des niveaux clés périodiques (chart/niveaux/niveauxCles.ts).
 *
 * GOLDEN RÉEL : 100 bougies BTCUSDT 1d Binance sondées le 14/09/2026 ; les onze valeurs
 * attendues ont été recalculées sur la réponse brute et confirmées par le vérificateur
 * indépendant (bougies 1w et 1M natives identiques aux extrêmes dérivés des 1d).
 * Cas limites synthétiques : bougie du jour exclue des périodes « précédentes », frontière
 * du lundi 00:00 UTC, 1er du mois, période incomplète → null (jamais un extrême tronqué),
 * familles filtrées, source (rechargement au changement de jour, désabonnement, toasts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Candle } from "@axiom/types";
import { BTCUSDT_1D } from "./btcusdt1d.fixture";
import { calculerNiveauxCles, creerSourceNiveauxCles, lignesNiveauxCles, type NiveauxCles } from "./niveauxCles";
import { creerFournisseurComposite } from "./composite";
import type { FamilleNiveauxCles, NiveauxOverlaysState } from "../niveauxOverlays";

const JOUR = 86_400_000;
const NOW = Date.UTC(2026, 8, 14, 18);

const FIXTURE: Candle[] = BTCUSDT_1D.map(([time, open, high, low, close]) => ({ time, open, high, low, close, volume: 0 }));

/** Bougies quotidiennes synthétiques de `debut` (inclus) à `fin` (inclus), prix = f(jour). */
function serie(debut: number, fin: number, f: (t: number) => { open: number; high: number; low: number; close: number }): Candle[] {
  const out: Candle[] = [];
  for (let t = debut; t <= fin; t += JOUR) out.push({ time: t, volume: 0, ...f(t) });
  return out;
}

function storeFamilles(familles: FamilleNiveauxCles[]): StoreApi<NiveauxOverlaysState> {
  return createStore<NiveauxOverlaysState>((set) => ({
    niveauxCles: true,
    niveauxOptions: false,
    bandesImplicites: false,
    prixRevient: false,
    familles,
    basculer: () => {},
    setActif: (cle, actif) => set({ [cle]: actif } as Partial<NiveauxOverlaysState>),
    basculerFamille: () => {},
    setFamilles: (f) => set({ familles: [...f] }),
  }));
}

describe("calculerNiveauxCles — golden BTCUSDT 1d du 14/09/2026 18:00 UTC", () => {
  it("reproduit les onze niveaux vérifiés", () => {
    const n = calculerNiveauxCles(FIXTURE, NOW);
    expect(n).toMatchObject({
      pdh: 77450,
      pdl: 76500,
      pdc: 76842.01,
      ouvertureJour: 76842.01,
      ouvertureSemaine: 76842.01,
      pwh: 80443.99,
      pwl: 76046.58,
      pmh: 81478.87,
      pml: 62275,
      ouvertureMois: 78581.3,
      ouvertureTrimestre: 58624.71,
      ancreJourMs: Date.UTC(2026, 8, 14),
      ancreSemaineMs: Date.UTC(2026, 8, 14),
    });
  });

  it("toutes familles → une seule ligne fusionnée « PDC·OJ·OS » à 76 842,01 (via le composite)", () => {
    const n = calculerNiveauxCles(FIXTURE, NOW);
    const store = storeFamilles(["J", "S", "M", "T"]);
    const source = { getLignes: () => lignesNiveauxCles(n, store.getState().familles), subscribe: () => () => {} };
    const composite = creerFournisseurComposite({ exchange: "binance", symbol: "BTCUSDT" }, { niveauxCles: () => source }, store);
    const unsub = composite.subscribe(() => {});
    const lignes = composite.getLignes();
    unsub();
    const a76842 = lignes.filter((l) => l.price === 76842.01);
    expect(a76842).toHaveLength(1);
    expect(a76842[0]?.label).toBe("PDC·OJ·OS");
    expect(a76842[0]?.emphase).toBe("forte");
    expect(lignes.map((l) => l.label)).toEqual(["PDH", "PDL", "PDC·OJ·OS", "PWH", "PWL", "PMH", "PML", "OM", "OQ"]);
  });
});

describe("calculerNiveauxCles — cas limites", () => {
  // Mercredi 16/09/2026 12:00 UTC ; historique du 01/05 au 16/09.
  const MERCREDI = Date.UTC(2026, 8, 16, 12);
  const hist = serie(Date.UTC(2026, 4, 1), Date.UTC(2026, 8, 16), (t) => {
    const j = (t - Date.UTC(2026, 4, 1)) / JOUR;
    return { open: 1000 + j, high: 1000 + j + 10, low: 1000 + j - 10, close: 1000 + j + 1 };
  });
  const prix = (t: number) => 1000 + (t - Date.UTC(2026, 4, 1)) / JOUR;

  it("la bougie du jour n'entre jamais dans la veille ni dans la semaine précédente", () => {
    const n = calculerNiveauxCles(hist, MERCREDI);
    // Veille = mardi 15/09.
    expect(n.pdh).toBe(prix(Date.UTC(2026, 8, 15)) + 10);
    expect(n.pdc).toBe(prix(Date.UTC(2026, 8, 15)) + 1);
    expect(n.ouvertureJour).toBe(prix(Date.UTC(2026, 8, 16)));
    // Semaine précédente = lundi 07/09 → dimanche 13/09 (le lundi 14 ouvre la semaine courante).
    expect(n.pwh).toBe(prix(Date.UTC(2026, 8, 13)) + 10);
    expect(n.pwl).toBe(prix(Date.UTC(2026, 8, 7)) - 10);
    expect(n.ouvertureSemaine).toBe(prix(Date.UTC(2026, 8, 14)));
    expect(n.ancreSemaineMs).toBe(Date.UTC(2026, 8, 14));
    expect(n.ancreJourMs).toBe(Date.UTC(2026, 8, 16));
  });

  it("frontière du lundi 00:00 UTC : un dimanche appartient encore à la semaine qui s'achève", () => {
    const dimanche = Date.UTC(2026, 8, 13, 23, 59);
    const n = calculerNiveauxCles(hist, dimanche);
    expect(n.ouvertureSemaine).toBe(prix(Date.UTC(2026, 8, 7)));
    expect(n.pwh).toBe(prix(Date.UTC(2026, 8, 6)) + 10);
    const lundi = Date.UTC(2026, 8, 14, 0, 0);
    expect(calculerNiveauxCles(hist, lundi).ouvertureSemaine).toBe(prix(Date.UTC(2026, 8, 14)));
  });

  it("1er du mois : ouverture du mois = ce jour, mois précédent complet ; trimestre civil", () => {
    const n = calculerNiveauxCles(hist, Date.UTC(2026, 7, 1, 9));
    expect(n.ouvertureMois).toBe(prix(Date.UTC(2026, 7, 1)));
    expect(n.pmh).toBe(prix(Date.UTC(2026, 6, 31)) + 10);
    expect(n.pml).toBe(prix(Date.UTC(2026, 6, 1)) - 10);
    expect(n.ouvertureTrimestre).toBe(prix(Date.UTC(2026, 6, 1)));
  });

  it("période incomplète (début absent) → null plutôt qu'un extrême tronqué", () => {
    // Historique commençant le 20/08 : août incomplet, trimestre (01/07) absent.
    const court = hist.filter((b) => b.time >= Date.UTC(2026, 7, 20));
    const n = calculerNiveauxCles(court, MERCREDI);
    expect(n.pmh).toBeNull();
    expect(n.pml).toBeNull();
    expect(n.ouvertureTrimestre).toBeNull();
    expect(n.ouvertureMois).toBe(prix(Date.UTC(2026, 8, 1)));
    expect(n.pdh).not.toBeNull();
  });

  it("veille manquante → pdh/pdl/pdc null ; jour courant absent → ouvertureJour null", () => {
    const sansVeille = hist.filter((b) => b.time !== Date.UTC(2026, 8, 15));
    expect(calculerNiveauxCles(sansVeille, MERCREDI)).toMatchObject({ pdh: null, pdl: null, pdc: null });
    const sansJour = hist.filter((b) => b.time < Date.UTC(2026, 8, 16));
    expect(calculerNiveauxCles(sansJour, MERCREDI).ouvertureJour).toBeNull();
    // Semaine précédente dont le dernier jour manque (flux figé) → null.
    const fige = hist.filter((b) => b.time < Date.UTC(2026, 8, 13));
    expect(calculerNiveauxCles(fige, MERCREDI).pwh).toBeNull();
  });

  it("aucune bougie → tous les niveaux null", () => {
    const n = calculerNiveauxCles([], MERCREDI);
    expect(Object.entries(n).filter(([k, v]) => !k.startsWith("ancre") && v !== null)).toEqual([]);
  });
});

describe("lignesNiveauxCles", () => {
  const n = calculerNiveauxCles(FIXTURE, NOW);

  it("null → []", () => {
    expect(lignesNiveauxCles(null, ["J", "S", "M", "T"])).toEqual([]);
  });

  it("filtre par familles, dans l'ordre J, S, M, T, avec couleurs et emphases", () => {
    expect(lignesNiveauxCles(n, ["J"])).toEqual([
      { price: 77450, label: "PDH", couleur: "--text-dim", emphase: "forte" },
      { price: 76500, label: "PDL", couleur: "--text-dim", emphase: "forte" },
      { price: 76842.01, label: "PDC", couleur: "--text-dim", emphase: "forte" },
      { price: 76842.01, label: "OJ", couleur: "--accent", emphase: "faible" },
    ]);
    expect(lignesNiveauxCles(n, ["T"])).toEqual([{ price: 58624.71, label: "OQ", couleur: "--accent", emphase: "faible" }]);
    expect(lignesNiveauxCles(n, ["M", "S"]).map((l) => l.label)).toEqual(["PWH", "PWL", "OS", "PMH", "PML", "OM"]);
  });

  it("un niveau null ne produit aucune ligne", () => {
    const partiel: NiveauxCles = { ...n, pdh: null, ouvertureJour: null };
    expect(lignesNiveauxCles(partiel, ["J"]).map((l) => l.label)).toEqual(["PDL", "PDC"]);
  });
});

describe("creerSourceNiveauxCles", () => {
  const CTX = { exchange: "binance" as const, symbol: "BTCUSDT" };
  let toasts: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    toasts = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function deps(charger: (exchange: string, symbol: string, nowMs: number) => Promise<Candle[] | null>, familles: FamilleNiveauxCles[] = ["J", "S"]) {
    return {
      charger: vi.fn(charger),
      maintenant: () => Date.now(),
      store: storeFamilles(familles),
      disponible: () => true,
      toast: (t: string) => toasts.push(t),
    };
  }

  it("charge au subscribe, notifie, puis expose les lignes des familles choisies", async () => {
    const d = deps(async () => FIXTURE);
    const source = creerSourceNiveauxCles(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.charger).toHaveBeenCalledWith("binance", "BTCUSDT", NOW);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(source.getLignes().map((l) => l.label)).toEqual(["PDH", "PDL", "PDC", "OJ", "PWH", "PWL", "OS"]);
    d.store.getState().setFamilles(["T"]);
    expect(source.getLignes().map((l) => l.label)).toEqual(["OQ"]);
    unsub();
  });

  it("au changement de jour UTC : lignes de la veille retirées puis rechargement", async () => {
    const d = deps(async () => FIXTURE);
    const source = creerSourceNiveauxCles(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.charger).toHaveBeenCalledTimes(1);

    let lignesAuBasculement: number | null = null;
    d.charger.mockImplementation(async () => {
      lignesAuBasculement = source.getLignes().length;
      return FIXTURE;
    });
    await vi.advanceTimersByTimeAsync(6 * 3_600_000 + 5_000);
    expect(d.charger).toHaveBeenCalledTimes(2);
    expect(d.charger.mock.calls[1]?.[2]).toBe(Date.UTC(2026, 8, 15, 0, 0, 5));
    expect(lignesAuBasculement).toBe(0);
    unsub();
  });

  it("échec : un seul toast, nouvel essai toutes les 5 min ; désabonnement coupe tout", async () => {
    const d = deps(async () => null);
    const source = creerSourceNiveauxCles(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("BTCUSDT");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(d.charger).toHaveBeenCalledTimes(3);
    expect(toasts).toHaveLength(1);
    unsub();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(d.charger).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("désabonnement avant la résolution : aucune notification tardive", async () => {
    let resoudre: (b: Candle[]) => void = () => {};
    const d = deps(() => new Promise<Candle[]>((res) => (resoudre = res)));
    const source = creerSourceNiveauxCles(CTX, d);
    const onChange = vi.fn();
    const unsub = source.subscribe(onChange);
    unsub();
    resoudre(FIXTURE);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(source.getLignes()).toEqual([]);
  });

  it("historique chargé mais aucun niveau calculable (bougie du jour absente aussi) : toast explicite et nouvel essai", async () => {
    const d = deps(async () => FIXTURE.slice(-1).map((b) => ({ ...b, time: Date.UTC(2026, 7, 1) })));
    const source = creerSourceNiveauxCles(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toEqual([
      "Niveaux clés : historique 1d insuffisant et bougie du jour absente pour BTCUSDT (binance), nouveaux essais espacés de 5 min à 1 h",
    ]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(d.charger).toHaveBeenCalledTimes(2);
    expect(toasts).toHaveLength(1);
    unsub();
  });

  /** FIXTURE (qui s'arrête au 14/09) prolongée de bougies plates jusqu'au jour UTC de `nowMs` inclus. */
  function avecJour(nowMs: number): Candle[] {
    const out = [...FIXTURE];
    const jour = Math.floor(nowMs / JOUR) * JOUR;
    for (let t = out[out.length - 1]!.time + JOUR; t <= jour; t += JOUR) {
      const c = out[out.length - 1]!.close;
      out.push({ time: t, open: c, high: c, low: c, close: c, volume: 0 });
    }
    return out;
  }

  it("échec après un succès, au jour suivant : l'échec est de nouveau signalé (drapeau remis à zéro)", async () => {
    const reponses: (Candle[] | null)[] = [];
    const d = deps(async (_e, _s, nowMs) => (reponses.shift() === null ? null : avecJour(nowMs)));
    reponses.push([], null, [], null);
    const source = creerSourceNiveauxCles(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getLignes().length).toBeGreaterThan(0);
    expect(toasts).toEqual([]);

    // 15/09 00:00:05 : échec → lignes retirées, toast.
    await vi.advanceTimersByTimeAsync(6 * 3_600_000 + 5_000);
    expect(d.charger).toHaveBeenCalledTimes(2);
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toHaveLength(1);

    // 00:05:05 : succès.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(d.charger).toHaveBeenCalledTimes(3);
    expect(source.getLignes().length).toBeGreaterThan(0);

    // 16/09 00:00:05 : nouvel échec → lignes retirées ET nouveau toast (jamais d'overlay muet).
    await vi.advanceTimersByTimeAsync(Date.UTC(2026, 8, 16, 0, 0, 5) - Date.now());
    expect(d.charger).toHaveBeenCalledTimes(4);
    expect(d.charger.mock.calls[3]?.[2]).toBe(Date.UTC(2026, 8, 16, 0, 0, 5));
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toHaveLength(2);
    expect(toasts[1]).toBe("Niveaux clés : bougies 1d de BTCUSDT (binance) indisponibles, nouvel essai dans 5 min");
    unsub();
  });

  it("bougie du jour pas encore publiée : lignes sans OJ/OS, un toast, nouvel essai à 5 min, puis minuit une fois publiée", async () => {
    const lundi = Date.UTC(2026, 8, 14, 0, 0, 5);
    vi.setSystemTime(lundi);
    const sansJour = FIXTURE.filter((b) => b.time < Date.UTC(2026, 8, 14));
    const d = deps(async () => sansJour);
    const source = creerSourceNiveauxCles(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(source.getLignes().map((l) => l.label)).toEqual(["PDH", "PDL", "PDC", "PWH", "PWL"]);
    expect(toasts).toEqual([
      "Niveaux clés : bougie 1d du jour absente pour BTCUSDT (binance), ouverture du jour non tracée ; nouveaux essais espacés de 5 min à 1 h",
    ]);

    // La bougie du jour paraît : l'essai de 00:05:05 la trouve.
    d.charger.mockImplementation(async () => FIXTURE);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(d.charger).toHaveBeenCalledTimes(2);
    expect(d.charger.mock.calls[1]?.[2]).toBe(Date.UTC(2026, 8, 14, 0, 5, 5));
    expect(source.getLignes().map((l) => l.label)).toEqual(["PDH", "PDL", "PDC", "OJ", "PWH", "PWL", "OS"]);
    expect(toasts).toHaveLength(1);

    // Plus d'essai toutes les 5 min : prochain chargement au minuit UTC suivant.
    await vi.advanceTimersByTimeAsync(Date.UTC(2026, 8, 15, 0, 0, 4) - Date.now());
    expect(d.charger).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.charger).toHaveBeenCalledTimes(3);
    expect(d.charger.mock.calls[2]?.[2]).toBe(Date.UTC(2026, 8, 15, 0, 0, 5));
    unsub();
  });

  it("bougie du jour durablement absente (marché fermé) : essais espacés 5, 10, 20, 40 min puis toutes les heures, un seul toast", async () => {
    const samedi = Date.UTC(2026, 8, 12, 10);
    vi.setSystemTime(samedi);
    const d = deps(async () => FIXTURE.filter((b) => b.time < Date.UTC(2026, 8, 12)));
    const source = creerSourceNiveauxCles(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const MIN = 60_000;
    for (const delai of [5, 10, 20, 40, 60, 60]) {
      await vi.advanceTimersByTimeAsync(delai * MIN - 1);
      const avant = d.charger.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(d.charger.mock.calls.length).toBe(avant + 1);
    }
    expect(d.charger).toHaveBeenCalledTimes(7);
    expect(toasts).toHaveLength(1);
    unsub();
  });

  it("un essai espacé ne dépasse jamais minuit UTC : les niveaux de la veille sont retirés à l'heure", async () => {
    vi.setSystemTime(Date.UTC(2026, 8, 12, 23, 30));
    const d = deps(async (_e, _s, nowMs) => FIXTURE.filter((b) => b.time < Math.floor(nowMs / JOUR) * JOUR));
    const source = creerSourceNiveauxCles(CTX, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000); // 23:35 → prochain essai demandé à +10 min, borné à 00:00:05
    await vi.advanceTimersByTimeAsync(Date.UTC(2026, 8, 13, 0, 0, 5) - Date.now());
    expect(d.charger.mock.calls.at(-1)?.[2]).toBe(Date.UTC(2026, 8, 13, 0, 0, 5));
    // Nouveau jour : l'espacement repart de 5 min (la bougie du jour paraît d'ordinaire vite).
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(d.charger.mock.calls.at(-1)?.[2]).toBe(Date.UTC(2026, 8, 13, 0, 5, 5));
    unsub();
  });

  it("toast « historique insuffisant » évalué sur les familles choisies, pas sur toutes", async () => {
    const recent = FIXTURE.slice(-20); // se termine par la bougie du jour : OJ présente
    const seulT = deps(async () => recent, ["T"]);
    const sourceT = creerSourceNiveauxCles(CTX, seulT);
    const unsubT = sourceT.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(sourceT.getLignes()).toEqual([]);
    expect(toasts).toEqual(["Niveaux clés : historique 1d insuffisant pour BTCUSDT (binance)"]);
    unsubT();

    toasts = [];
    const seulJ = deps(async () => recent, ["J"]);
    const sourceJ = creerSourceNiveauxCles(CTX, seulJ);
    const unsubJ = sourceJ.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(sourceJ.getLignes().length).toBeGreaterThan(0);
    expect(toasts).toEqual([]);
    unsubJ();
  });

  it("symbole sans bougies 1d UTC : toast explicite et aucun chargement", async () => {
    const d = { ...deps(async () => FIXTURE), disponible: () => false };
    const source = creerSourceNiveauxCles({ exchange: "synthetic", symbol: "BTCUSDT|ETHUSDT" }, d);
    const unsub = source.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(d.charger).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("BTCUSDT|ETHUSDT");
    unsub();
  });
});
