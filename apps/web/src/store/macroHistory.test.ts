/**
 * Tests de macroHistoryStore — dédup (MIN_GAP_MS), COMPACTION journalière et seed du
 * backfill. Cette série est la SEULE série historique de capitalisation crypto de
 * l'app (le panneau Macro et l'overlay du graphe lisent la même).
 *
 * ⚠️ Le contrat a changé le 2026-07-29 : le tampon n'est plus un simple
 * `slice(-MAX_POINTS)`. Avec un poller à 5 min (288 points/jour), ce plafond limitait
 * l'historique à 5,2 JOURS — le mécanisme « la série s'étoffe au fil des sessions »
 * ne pouvait donc pas fonctionner. La compaction (un point par jour au-delà de 48 h)
 * lève cette limite et permet à `seed` d'injecter les 365 jours reconstruits par CAP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOUR_MS } from "../data/mcap";
import { compacter, macroHistoryStore, MAX_POINTS, type McapSnapshot } from "./macroHistory";

const MIN_GAP_MS = 4 * 60_000;

/** Raccourci de fixture : un échantillon dont seules la date et le total comptent. */
function s(t: number, total = 1_000): McapSnapshot {
  return { t, total, total2: total * 0.4, total3: total * 0.3 };
}

const T0 = Date.parse("2026-07-29T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  macroHistoryStore.setState({ snapshots: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("macroHistoryStore.record", () => {
  it("enregistre un premier échantillon", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    const snaps = macroHistoryStore.getState().snapshots;
    expect(snaps).toEqual([{ t: 0, total: 100, total2: 50, total3: 10 }]);
  });

  it("ignore un second appel trop proche du dernier (< MIN_GAP_MS)", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    vi.setSystemTime(MIN_GAP_MS - 1);
    macroHistoryStore.getState().record(200, 60, 20);

    expect(macroHistoryStore.getState().snapshots).toHaveLength(1); // 2e appel ignoré
  });

  it("enregistre un nouveau point une fois MIN_GAP_MS écoulé", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    vi.setSystemTime(MIN_GAP_MS);
    macroHistoryStore.getState().record(200, 60, 20);

    const snaps = macroHistoryStore.getState().snapshots;
    expect(snaps.map((x) => x.total)).toEqual([100, 200]);
  });

  it("ignore un total non fini (NaN/Infinity) sans toucher au buffer", () => {
    macroHistoryStore.getState().record(100, 50, 10);
    macroHistoryStore.getState().record(NaN, 60, 20);

    expect(macroHistoryStore.getState().snapshots).toHaveLength(1);
  });

  it("borne la série à MAX_POINTS APRÈS compaction : le plus ancien jour est évincé", () => {
    // Points journaliers (donc déjà compactés) : la borne joue alors exactement comme
    // avant, mais sur des JOURS et non sur des échantillons de 5 minutes.
    const debut = MAX_POINTS * JOUR_MS;
    const seeded = Array.from({ length: MAX_POINTS }, (_, i) => s(i * JOUR_MS, i));
    macroHistoryStore.setState({ snapshots: seeded });
    vi.setSystemTime(debut);

    macroHistoryStore.getState().record(MAX_POINTS, 0, 0); // un jour de plus

    const snaps = macroHistoryStore.getState().snapshots;
    expect(snaps).toHaveLength(MAX_POINTS); // toujours borné
    expect(snaps[0]?.total).toBe(1); // le plus ancien (total=0) a été évincé
    expect(snaps[snaps.length - 1]?.total).toBe(MAX_POINTS); // le nouveau est bien en fin
  });

  it("garde huit jours d'historique malgré un échantillonnage toutes les 5 minutes", () => {
    // Le test qui verrouille la correction : avec l'ancien `slice(-MAX_POINTS)`,
    // 8 jours × 288 échantillons = 2 304 points ⇒ seuls les 1 500 derniers survivaient,
    // soit 5,2 jours d'amplitude. La compaction rend les 8 jours entiers.
    const debut = Date.parse("2026-07-01T00:00:00Z");
    const pas = 5 * 60_000;
    const echantillons = 8 * 288;

    for (let i = 0; i < echantillons; i += 1) {
      vi.setSystemTime(debut + i * pas);
      macroHistoryStore.getState().record(1_000 + i, 400, 300);
    }

    const snaps = macroHistoryStore.getState().snapshots;
    const fin = debut + (echantillons - 1) * pas;
    expect(snaps.length).toBeGreaterThan(0);
    // Amplitude exacte : le premier jour est compacté à son dernier échantillon
    // (23 h 55), d'où 7 jours pile — contre 5,2 jours au plafond de l'ancien code.
    expect(fin - snaps[0]!.t).toBeGreaterThanOrEqual(7 * JOUR_MS);
    expect(snaps.length).toBeLessThanOrEqual(MAX_POINTS);
  });
});

describe("compacter — un point par jour au-delà de 48 h, tout en deçà", () => {
  it("conserve TOUS les échantillons des 48 dernières heures", () => {
    const recents = [s(T0 - 47 * 3_600_000), s(T0 - 3_600_000), s(T0 - 60_000), s(T0)];
    expect(compacter(recents, T0)).toEqual(recents);
  });

  it("réduit les jours anciens à leur DERNIER échantillon", () => {
    const anciens = [
      s(Date.parse("2026-07-20T02:00:00Z"), 10),
      s(Date.parse("2026-07-20T09:00:00Z"), 11),
      s(Date.parse("2026-07-20T23:00:00Z"), 12), // gagnant du 20
      s(Date.parse("2026-07-21T05:00:00Z"), 20),
      s(Date.parse("2026-07-21T18:00:00Z"), 21), // gagnant du 21
    ];
    expect(compacter(anciens, T0).map((x) => x.total)).toEqual([12, 21]);
  });

  it("mélange ancien compacté et récent intact, en ordre strictement croissant", () => {
    const entree = [
      s(Date.parse("2026-07-20T02:00:00Z"), 10),
      s(Date.parse("2026-07-20T23:00:00Z"), 12),
      s(T0 - 3_600_000, 99),
      s(T0, 100),
    ];
    const sortie = compacter(entree, T0);
    expect(sortie.map((x) => x.total)).toEqual([12, 99, 100]);
    for (let i = 1; i < sortie.length; i += 1) {
      expect(sortie[i]!.t).toBeGreaterThan(sortie[i - 1]!.t);
    }
  });

  it("respecte le plafond MAX_POINTS en gardant les plus récents", () => {
    const trop = Array.from({ length: MAX_POINTS + 100 }, (_, i) =>
      s(T0 - (MAX_POINTS + 100 - i) * JOUR_MS, i)
    );
    const sortie = compacter(trop, T0);
    expect(sortie).toHaveLength(MAX_POINTS);
    expect(sortie[sortie.length - 1]!.total).toBe(MAX_POINTS + 99);
  });

  it("est neutre sur une série vide", () => {
    expect(compacter([], T0)).toEqual([]);
  });
});

describe("seed — le backfill CAP s'insère devant les échantillons temps réel", () => {
  it("insère l'historique journalier sans écraser les échantillons existants", () => {
    vi.setSystemTime(T0);
    const reels = [s(T0 - 7_200_000, 900), s(T0 - 3_600_000, 901), s(T0, 902)];
    macroHistoryStore.setState({ snapshots: reels });

    const backfill = Array.from({ length: 366 }, (_, i) => s(T0 - (366 - i) * JOUR_MS, i));
    macroHistoryStore.getState().seed(backfill);

    const snaps = macroHistoryStore.getState().snapshots;
    for (const r of reels) {
      expect(snaps.find((x) => x.t === r.t && x.total === r.total)).toBeDefined();
    }
    expect(snaps[0]!.t).toBeLessThanOrEqual(T0 - 365 * JOUR_MS);
  });

  it("ne crée pas de doublon pour un jour déjà couvert par un échantillon réel", () => {
    vi.setSystemTime(T0);
    macroHistoryStore.setState({ snapshots: [s(T0, 902)] });
    macroHistoryStore.getState().seed([s(T0 - 30_000, 1), s(T0 - JOUR_MS, 2)]);

    const snaps = macroHistoryStore.getState().snapshots;
    const jourDeT0 = snaps.filter((x) => Math.floor(x.t / JOUR_MS) === Math.floor(T0 / JOUR_MS));
    expect(jourDeT0).toHaveLength(1);
    expect(jourDeT0[0]!.total).toBe(902); // l'échantillon RÉEL a gagné
  });

  it("ignore les points non finis", () => {
    vi.setSystemTime(T0);
    macroHistoryStore.getState().seed([{ t: Number.NaN, total: 1, total2: 1, total3: 1 }]);
    expect(macroHistoryStore.getState().snapshots).toEqual([]);
  });
});
