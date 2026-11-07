/**
 * Tests des bandes RV (chart/niveaux/bandesRv.ts) : chargeur 1d paginé, ancres et origines des
 * prévisions (veille / dimanche), bandes immobiles dans la semaine, amplitude consommée, lignes,
 * infobulle, cache du jour et source d'un slot. Données synthétiques, adaptateurs bouchonnés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Candle, ExchangeId, IExchangeAdapter } from "@axiom/types";
import { evaluerHorizon, segmentContigu } from "../../data/harRv";
import {
  _viderCacheBandesRv,
  amplitudeConsommee,
  calculerBandesRv,
  chargerBandesRv,
  chargerHistoriqueJour,
  creerSourceBandesRv,
  detailBandesRv,
  infoBandesRvStore,
  lignesBandesRv,
  NOTE_BANDES_RV,
  resumeBandesRv,
  type BandesRvCalculees,
  type InfoBandesRv,
} from "./bandesRv";

const JOUR = 86_400_000;
const LUNDI = Date.UTC(2026, 10, 2); // lundi 2 novembre 2026
const MERCREDI = LUNDI + 2 * JOUR;
const NOW = MERCREDI + 15 * 3_600_000; // mercredi 15:00 UTC

function alea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normale = (u: () => number): number => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());

/** `nb` jours clos finissant la veille de `nowMs`, puis la bougie du jour en cours. */
function historique(nb: number, nowMs: number, graine = 9): Candle[] {
  const u = alea(graine);
  const auj = Math.floor(nowMs / JOUR);
  const out: Candle[] = [];
  let prix = 30_000;
  for (let k = nb; k >= 0; k--) {
    const s = 0.025 * (1 + 0.5 * Math.sin((auj - k) / 30));
    const open = prix;
    const close = open * Math.exp(s * normale(u));
    const high = Math.max(open, close) * Math.exp(Math.abs(normale(u)) * s * 0.4);
    const low = Math.min(open, close) / Math.exp(Math.abs(normale(u)) * s * 0.4);
    out.push({ time: (auj - k) * JOUR, open, high, low, close, volume: 1, ...(k === 0 ? { closed: false } : {}) });
    prix = close;
  }
  return out;
}

describe("chargerHistoriqueJour — pages vers le passé", () => {
  /** Adaptateur factice : `fournies` bougies 1d jusqu'à aujourd'hui, `limit` par page. */
  function adaptateur(fournies: number, opts: { ignoreEndTime?: boolean; echecPage?: number } = {}) {
    const toutes = historique(fournies - 1, NOW);
    const appels: Array<{ limit?: number; endTime?: number }> = [];
    const fetchKlines = vi.fn(async (_s: string, _tf: string, o?: { limit?: number; endTime?: number }) => {
      appels.push({ ...o });
      if (opts.echecPage === appels.length) throw new Error("HTTP 500");
      const fin = opts.ignoreEndTime || o?.endTime === undefined ? Number.POSITIVE_INFINITY : o.endTime;
      const avant = toutes.filter((b) => b.time <= fin);
      return avant.slice(Math.max(0, avant.length - (o?.limit ?? 500)));
    });
    return { adapter: { fetchKlines } as unknown as IExchangeAdapter, appels, toutes };
  }

  it("Binance : pages de 1 000, endTime = plus ancienne − 1, arrêt à la profondeur visée", async () => {
    const { adapter, appels, toutes } = adaptateur(3000);
    const b = await chargerHistoriqueJour("binance", "BTCUSDT", 1500, adapter);
    expect(appels).toEqual([{ limit: 1000 }, { limit: 1000, endTime: toutes[2000]!.time - 1 }]);
    expect(b).toHaveLength(1500); // les 1 500 plus récentes, jour en cours compris
    expect(b[1499]).toBe(toutes[2999]);
    expect(b.every((c, i) => i === 0 || c.time - b[i - 1]!.time === JOUR)).toBe(true);
  });

  it("Coinbase : pages de 350 jusqu'au début réel de l'historique", async () => {
    const { adapter, appels } = adaptateur(800);
    const b = await chargerHistoriqueJour("coinbase", "BTC-USD", 1500, adapter);
    expect(b).toHaveLength(800);
    expect(appels.map((a) => a.limit)).toEqual([350, 350, 350, 350]); // la 4e page est vide
  });

  it("Kraken ignore endTime : la page qui ne recule plus arrête la boucle", async () => {
    const { adapter, appels } = adaptateur(720, { ignoreEndTime: true });
    const b = await chargerHistoriqueJour("kraken", "XBTUSD", 1500, adapter);
    expect(b).toHaveLength(720);
    expect(appels).toHaveLength(2);
  });

  it("échec de la première page : rejet ; d'une suivante : historique partiel gardé s'il suffit aux deux bandes", async () => {
    await expect(chargerHistoriqueJour("binance", "BTCUSDT", 1500, adaptateur(3000, { echecPage: 1 }).adapter)).rejects.toThrow("HTTP 500");
    const partiel = await chargerHistoriqueJour("binance", "BTCUSDT", 1500, adaptateur(3000, { echecPage: 2 }).adapter);
    expect(partiel).toHaveLength(1000);
  });

  it("page suivante en échec sous la profondeur utile (Coinbase, 350) : panne, pas « historique trop court »", async () => {
    await expect(chargerHistoriqueJour("coinbase", "BTC-USD", 1500, adaptateur(3000, { echecPage: 2 }).adapter)).rejects.toThrow(
      "bougies 1d incomplètes (350 reçues, page 2 en échec : HTTP 500)",
    );
    // La source le traite comme une panne : bougies indisponibles, nouvel essai dans 5 min.
    _viderCacheBandesRv();
    expect(await chargerBandesRv("coinbase", "BTC-USD", NOW, (e, s) => chargerHistoriqueJour(e, s, 1500, adaptateur(3000, { echecPage: 2 }).adapter))).toBeNull();
  });
});

describe("calculerBandesRv — ancres, origines et bandes", () => {
  const bougies = historique(1100, NOW);

  it("jour : ouverture du jour × prévision faite à la clôture de la veille ; semaine : lundi × dimanche", () => {
    const b = calculerBandesRv(bougies, NOW);
    const segment = segmentContigu(bougies.slice(0, -1));
    const ouvertureJour = bougies[bougies.length - 1]!.open;
    const ouvertureLundi = bougies.find((c) => c.time === LUNDI)!.open;
    expect(b.ancreJourMs).toBe(MERCREDI);
    expect(b.historique).toBe(1100);
    expect(b.jour?.ancre).toBe(ouvertureJour);
    expect(b.semaine?.ancre).toBe(ouvertureLundi);
    expect(b.jour?.prevision).toEqual(evaluerHorizon(segment, 1, segment.length - 1));
    expect(b.semaine?.prevision).toEqual(evaluerHorizon(segment, 7, segment.findIndex((c) => c.time === LUNDI - JOUR)));
    const j = b.jour!;
    expect(j.plus1).toBeCloseTo(ouvertureJour * Math.exp(j.prevision.k1 * j.prevision.sigma), 8);
    expect(j.moins2).toBeCloseTo(ouvertureJour * Math.exp(-j.prevision.k2 * j.prevision.sigma), 8);
    expect(j.moins2 < j.moins1 && j.moins1 < j.ancre && j.ancre < j.plus1 && j.plus1 < j.plus2).toBe(true);
    expect(b.semaine!.plus1 - b.semaine!.moins1).toBeGreaterThan(j.plus1 - j.moins1);
  });

  it("la bande de la semaine ne bouge pas d'un jour à l'autre (aucune repeinture)", () => {
    const jeudi = NOW + JOUR;
    const avecJeudi = historique(1101, jeudi); // même graine : mêmes jours, un jour clos de plus
    expect(avecJeudi[1100]!.time).toBe(MERCREDI);
    const mercredi = calculerBandesRv(bougies, NOW).semaine!;
    const lendemain = calculerBandesRv(avecJeudi, jeudi).semaine!;
    expect(lendemain.prevision.sigma).toBe(mercredi.prevision.sigma);
    expect(lendemain.prevision.k1).toBe(mercredi.prevision.k1);
    expect(lendemain.plus2).toBe(mercredi.plus2);
  });

  it("historique glissant plafonné : 720 jours (Kraken) sans bande semaine ; au-delà du calibrage complet, semaine immobile", () => {
    // Chaque jour, la place sert les N dernières bougies : le début du segment avance d'un jour.
    const jeudi = NOW + JOUR;
    const avecJeudi = historique(1101, jeudi);
    const kraken = calculerBandesRv(bougies.slice(-721), NOW);
    expect(kraken.historique).toBe(720);
    expect(kraken.jour).not.toBeNull();
    expect(kraken.semaine).toBeNull(); // calibrage partiel : la bande glisserait dans la semaine
    const mercredi = calculerBandesRv(bougies.slice(-821), NOW).semaine!;
    const lendemain = calculerBandesRv(avecJeudi.slice(-821), jeudi).semaine!;
    // Mêmes origines et mêmes issues : égalité aux arrondis des sommes cumulées près (la dérive
    // relevée en revue avec un calibrage partiel était de l'ordre de 1e-2 sur k₁).
    expect(lendemain.prevision.sigma).toBeCloseTo(mercredi.prevision.sigma, 12);
    expect(lendemain.prevision.k1).toBeCloseTo(mercredi.prevision.k1, 12);
    expect(lendemain.prevision.k2).toBeCloseTo(mercredi.prevision.k2, 12);
    expect(lendemain.plus2).toBeCloseTo(mercredi.plus2, 6);
  });

  it("bougie de la veille absente (pas encore publiée) : bande du jour null, semaine intacte", () => {
    const sansVeille = bougies.filter((c) => c.time !== MERCREDI - JOUR);
    const b = calculerBandesRv(sansVeille, NOW);
    expect(b.jour).toBeNull();
    expect(b.historique).toBe(1099); // jours clos jusqu'au lundi
    // Origine dimanche : prévision et bande intactes (seule la couverture perd une issue).
    const reference = calculerBandesRv(bougies, NOW).semaine!;
    expect(b.semaine?.prevision.sigma).toBe(reference.prevision.sigma);
    expect(b.semaine?.prevision.k2).toBe(reference.prevision.k2);
    expect(b.semaine?.plus2).toBe(reference.plus2);
  });

  it("alt récent (400 jours) : aucune bande, jamais d'extrapolation", () => {
    const b = calculerBandesRv(historique(400, NOW), NOW);
    expect(b.jour).toBeNull();
    expect(b.semaine).toBeNull();
    expect(b.historique).toBe(400);
  });
});

describe("amplitudeConsommee", () => {
  const H = 3_600_000;
  const horaires = (depuis: number, nb: number, haut: (k: number) => number, bas: (k: number) => number): Candle[] =>
    Array.from({ length: nb }, (_, k) => ({ time: depuis + k * H, open: 100, high: haut(k), low: bas(k), close: 100, volume: 1 }));

  it("haut − bas (log) depuis l'ancre ÷ amplitude attendue, bougie en cours comprise", () => {
    const bougies = [...horaires(MERCREDI - 3 * H, 3, () => 200, () => 50), ...horaires(MERCREDI, 15, (k) => 101 + k, () => 99)];
    expect(amplitudeConsommee(bougies, MERCREDI, JOUR, 0.1)).toBeCloseTo(Math.log(115 / 99) / 0.1, 12);
  });

  it("non mesurée : bougies plus longues que l'horizon, ancre non couverte, attendue nulle", () => {
    const hebdo: Candle[] = [0, 1].map((k) => ({ time: LUNDI - 7 * JOUR + k * 7 * JOUR, open: 1, high: 2, low: 1, close: 1, volume: 1 }));
    expect(amplitudeConsommee(hebdo, MERCREDI, JOUR, 0.1)).toBeNull();
    expect(amplitudeConsommee(hebdo, LUNDI, 7 * JOUR, 0.1)).toBeCloseTo(Math.log(2) / 0.1, 12);
    expect(amplitudeConsommee(horaires(MERCREDI + H, 5, () => 101, () => 99), MERCREDI, JOUR, 0.1)).toBeNull();
    expect(amplitudeConsommee(horaires(MERCREDI, 5, () => 101, () => 99), MERCREDI, JOUR, 0)).toBeNull();
    expect(amplitudeConsommee([], MERCREDI, JOUR, 0.1)).toBeNull();
  });
});

describe("lignesBandesRv et infobulle", () => {
  const calcul = calculerBandesRv(historique(1100, NOW), NOW);

  it("±1σ forts, ±2σ en pointillé, suffixes J/S, amplitude consommée sur « +1σ »", () => {
    const lignes = lignesBandesRv(calcul, { jour: 0.634, semaine: null });
    expect(lignes.map((l) => l.label)).toEqual([
      "+1σ J (RV) · amp. 63 %", "−1σ J (RV)", "+2σ J (RV)", "−2σ J (RV)",
      "+1σ S (RV)", "−1σ S (RV)", "+2σ S (RV)", "−2σ S (RV)",
    ]);
    expect(lignes.map((l) => l.emphase)).toEqual(["forte", "forte", "faible", "faible", "forte", "forte", "faible", "faible"]);
    expect(new Set(lignes.map((l) => l.couleur))).toEqual(new Set(["--ui-amber"]));
    expect(lignes[0]!.price).toBe(calcul.jour!.plus1);
    expect(lignesBandesRv(null)).toEqual([]);
    expect(lignesBandesRv({ ...calcul, jour: null }).map((l) => l.label)).toHaveLength(4);
  });

  it("infobulle : note générale seule sans calcul, puis σ, couverture hors échantillon et amplitude", () => {
    expect(resumeBandesRv(null)).toBe(NOTE_BANDES_RV);
    expect(NOTE_BANDES_RV).toContain("pas une borne");
    expect(NOTE_BANDES_RV).toContain("bandes VaR");
    const info: InfoBandesRv = { marche: "SOLUSDT (binance)", calcul, amplitudes: { jour: 0.5, semaine: null }, manque: null };
    const c = calcul.jour!.prevision.couverture;
    const detail = detailBandesRv(info)!;
    expect(detail).toContain("SOLUSDT (binance) :");
    expect(detail).toContain(`couverture hors échantillon ±1σ ${Math.round((100 * c.dans1) / c.n)} %`);
    expect(detail).toContain(`(n = ${c.n} jours)`);
    expect(detail).toContain("fenêtres de 7 j chevauchantes");
    expect(detail).toContain("amplitude consommée 50 %");
    expect(detail).toContain("amplitude consommée non mesurée");
    expect(resumeBandesRv(info)).toBe(`${NOTE_BANDES_RV} ${detail}`);
    const indisponible = detailBandesRv({ marche: "X (okx)", calcul: null, amplitudes: { jour: null, semaine: null }, manque: "calcul en cours" });
    expect(indisponible).toBe("X (okx) : jour indisponible ; semaine indisponible (calcul en cours)");
  });
});

describe("chargerBandesRv — cache du jour", () => {
  beforeEach(() => _viderCacheBandesRv());

  it("un chargement par jour et par marché ; échec et résultat incomplet non mis en cache", async () => {
    const complet = vi.fn(async () => historique(1100, NOW));
    const [a, b] = await Promise.all([chargerBandesRv("binance", "SOLUSDT", NOW, complet), chargerBandesRv("binance", "SOLUSDT", NOW + 60_000, complet)]);
    expect(a).toBe(b);
    expect(complet).toHaveBeenCalledTimes(1);
    const echec = vi.fn(async (): Promise<Candle[]> => { throw new Error("réseau"); });
    expect(await chargerBandesRv("okx", "SOLUSDT", NOW, echec)).toBeNull();
    expect(await chargerBandesRv("okx", "SOLUSDT", NOW, echec)).toBeNull();
    expect(echec).toHaveBeenCalledTimes(2);
    const court = vi.fn(async () => historique(300, NOW));
    expect((await chargerBandesRv("bybit", "NEWUSDT", NOW, court))?.jour).toBeNull();
    await chargerBandesRv("bybit", "NEWUSDT", NOW, court);
    expect(court).toHaveBeenCalledTimes(2);
  });

  it("série non alignée sur minuit UTC : refusée", async () => {
    const decalee = historique(1100, NOW).map((c) => ({ ...c, time: c.time + 3_600_000 }));
    expect(await chargerBandesRv("binance", "XUSDT", NOW, async () => decalee)).toBeNull();
  });
});

describe("creerSourceBandesRv — source d'un slot", () => {
  const CTX = { exchange: "binance" as ExchangeId, symbol: "SOLUSDT" };
  let calcul: BandesRvCalculees;

  beforeEach(() => {
    calcul = calculerBandesRv(historique(1100, NOW), NOW);
    infoBandesRvStore.setState({ info: null });
  });
  afterEach(() => vi.useRealTimers());

  function marcheFactice(candles: Candle[], symbol = "SOLUSDT") {
    return createStore<{ exchange: ExchangeId; symbol: string; candles: Candle[] }>(() => ({ exchange: "binance", symbol, candles }));
  }

  it("trace les bandes, publie l'info pour DIST et suit l'amplitude consommée des bougies vivantes", async () => {
    const H = 3_600_000;
    const marche = marcheFactice(
      Array.from({ length: 15 }, (_, k) => ({ time: MERCREDI + k * H, open: 100, high: 100, low: 100, close: 100, volume: 1 })),
    );
    const onChange = vi.fn();
    const toast = vi.fn();
    const source = creerSourceBandesRv(CTX, { charger: async () => calcul, maintenant: () => NOW, disponible: () => true, toast, marche });
    const unsub = source.subscribe(onChange);
    await vi.waitFor(() => expect(source.getLignes()).toHaveLength(8));
    expect(toast).not.toHaveBeenCalled();
    expect(infoBandesRvStore.getState().info).toMatchObject({ marche: "SOLUSDT (binance)", calcul, manque: null });
    const attendue = calcul.jour!.prevision.amplitude;
    marche.setState({ candles: [...marche.getState().candles, { time: MERCREDI + 15 * H, open: 100, high: 100 * Math.exp(attendue / 2), low: 100, close: 100, volume: 1 }] });
    expect(source.getLignes()[0]!.label).toBe("+1σ J (RV) · amp. 50 %");
    expect(infoBandesRvStore.getState().info?.amplitudes.jour).toBeCloseTo(0.5, 10);
    unsub();
    expect(infoBandesRvStore.getState().info).toBeNull();
  });

  it("autre symbole sur le chart maître : amplitude non mesurée", async () => {
    const marche = marcheFactice([{ time: MERCREDI, open: 1, high: 2, low: 1, close: 1, volume: 1 }, { time: MERCREDI + 3_600_000, open: 1, high: 2, low: 1, close: 1, volume: 1 }], "ETHUSDT");
    const source = creerSourceBandesRv(CTX, { charger: async () => calcul, maintenant: () => NOW, disponible: () => true, toast: vi.fn(), marche });
    const unsub = source.subscribe(() => {});
    await vi.waitFor(() => expect(source.getLignes()).toHaveLength(8));
    expect(source.getLignes()[0]!.label).toBe("+1σ J (RV)");
    unsub();
  });

  it("Twelve Data ou série sans 1d : toast, aucune ligne, aucun chargement", () => {
    const charger = vi.fn();
    const toast = vi.fn();
    creerSourceBandesRv({ exchange: "twelvedata", symbol: "AAPL" }, { charger, toast, marche: marcheFactice([]) }).subscribe(() => {});
    creerSourceBandesRv(CTX, { charger, toast, disponible: () => false, marche: marcheFactice([]) }).subscribe(() => {});
    expect(charger).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[0]![0]).toContain("Bandes RV indisponibles");
  });

  it("historique trop court : toast explicite et nouvel essai au prochain jour (pas toutes les 5 min)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const court = calculerBandesRv(historique(400, NOW), NOW);
    const charger = vi.fn(async () => court);
    const toast = vi.fn();
    const source = creerSourceBandesRv(CTX, { charger, maintenant: () => NOW, disponible: () => true, toast, marche: marcheFactice([]) });
    const unsub = source.subscribe(() => {});
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]![0]).toBe("Bandes RV : bandes jour et semaine : historique trop court (400 jours clos contigus, ≈ 790 requis)");
    expect(source.getLignes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(charger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9 * 3_600_000 + 10_000 - 5 * 60_000); // minuit UTC + 5 s
    expect(charger).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("panne : toast unique et nouvel essai dans 5 min ; désabonnement : plus aucun essai", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const charger = vi.fn(async () => null);
    const toast = vi.fn();
    const source = creerSourceBandesRv(CTX, { charger, maintenant: () => NOW, disponible: () => true, toast, marche: marcheFactice([]) });
    const unsub = source.subscribe(() => {});
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0]![0]).toBe("Bandes RV : bougies 1d de SOLUSDT (binance) indisponibles, nouvel essai dans 5 min");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(charger).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledTimes(1);
    unsub();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(charger).toHaveBeenCalledTimes(2);
  });
});
