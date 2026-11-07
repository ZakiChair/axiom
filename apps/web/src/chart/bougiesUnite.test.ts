/**
 * Chaîne « unité supérieure » du graphe (SUG-1, phase 1) : chargement, calcul, projection.
 *
 * La place est simulée (aucun réseau) : `fetchKlines` rend les `limit` dernières bougies
 * ouvertes à l'instant courant, la dernière EN COURS avec une clôture fantaisiste (×10)
 * — si elle entrait dans le calcul, l'égalité exacte avec le calcul natif tomberait. Sur
 * une série plus longue que `limit`, sa fenêtre GLISSE d'une bougie à chaque clôture,
 * comme une vraie place.
 * Seule l'horloge `Date` est simulée : promesses et minuteries restent réelles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle, ExchangeId, Timeframe } from "@axiom/types";
import { computeIndicator, getIndicator } from "@axiom/indicators";

const { fetchKlines } = vi.hoisted(() => ({ fetchKlines: vi.fn() }));
vi.mock("../data/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/adapters")>()),
  getAdapter: () => ({ fetchKlines, subscribeKline: () => () => {}, subscribeTrades: () => () => {} }),
}));

import {
  LIMITE_BOUGIES_UNITE,
  MARGE_CLOTURE_MS,
  bougiesCloses,
  calculerSurUnite,
  ouvertureAlignee,
  suiteFenetre,
  viderCacheUnite,
  type DemandeUnite,
  type EtatUnite,
} from "./bougiesUnite";
import { unitesProposees } from "./uniteSuperieure";

const H = 3_600_000;
const J = 24 * H;
/** Lundi 6 janvier 2025, 00:00 UTC. */
const LUNDI = Date.UTC(2025, 0, 6);
const DUREE: Partial<Record<Timeframe, number>> = { "1h": H, "4h": 4 * H, "1d": J, "1w": 7 * J };

/** Série « serveur » complète et déterministe (marche multiplicative). */
function marche(origine: number, pas: number, n: number, graine = 3): Candle[] {
  let s = graine;
  const alea = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o * (1 + (alea() - 0.5) * 0.05);
    out.push({ time: origine + i * pas, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 50 + alea() });
    p = c;
  }
  return out;
}

/** Réponse de la place à `maintenant` : les `limit` dernières bougies ouvertes, la dernière en cours. */
function reponse(serie: Candle[], pas: number, maintenant: number, limit: number): Candle[] {
  const out = serie
    .filter((c) => c.time <= maintenant)
    .slice(-limit)
    .map((c) => ({ ...c, closed: c.time + pas <= maintenant }));
  const derniere = out[out.length - 1];
  if (derniere !== undefined && !derniere.closed) {
    out[out.length - 1] = { ...derniere, close: derniere.close * 10, high: derniere.high * 10 };
  }
  return out;
}

/** La place sert `serie` (unité `tf`) à l'heure simulée. */
function servir(serie: Candle[], tf: Timeframe): void {
  fetchKlines.mockImplementation(async (_symbol: string, unite: Timeframe, opts?: { limit?: number }) => {
    expect(unite).toBe(tf);
    return reponse(serie, DUREE[tf]!, Date.now(), opts?.limit ?? 500);
  });
}

/** Bougies 1h du graphe (alignées sur l'heure) de `debut` jusqu'à l'heure simulée, la dernière en formation. */
function graphe1h(debut: number): Candle[] {
  const out: Candle[] = [];
  for (let t = Math.floor(debut / H) * H; t <= Date.now(); t += H) out.push({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  return out;
}

function demande(candles: Candle[], defId: string, params: DemandeUnite["params"], extra: Partial<DemandeUnite> = {}): DemandeUnite {
  return { def: getIndicator(defId)!, params, unite: "4h", exchange: "binance", symbol: "BTCUSDT", timeframe: "1h", candles, ...extra };
}

/** Indice de la dernière bougie supérieure close à `fin` (oracle naïf). */
function oracle(sup: Candle[], dureeSup: number, fin: number): number | undefined {
  let k: number | undefined;
  sup.forEach((c, j) => {
    if (c.time + dureeSup <= fin) k = j;
  });
  return k;
}

/** Projection attendue : valeur native de la dernière bougie supérieure close à la clôture de chaque bougie du graphe. */
function attendue(candles: Candle[], sup: Candle[], natif: Array<number | undefined>): Array<number | undefined> {
  return candles.map((c) => {
    const k = oracle(sup, 4 * H, c.time + H);
    return k === undefined ? undefined : natif[k];
  });
}

function pret(etat: EtatUnite): Extract<EtatUnite, { status: "ready" }> {
  if (etat.status !== "ready") throw new Error(`état ${etat.status} : ${JSON.stringify(etat)}`);
  return etat;
}

/**
 * Calcul à l'heure simulée : si une requête part (premier chargement, clôture supérieure,
 * nouvel essai), attend sa réception puis recalcule, comme le graphe sur son rappel.
 */
async function charger(d: DemandeUnite): Promise<Extract<EtatUnite, { status: "ready" }>> {
  const rappel = vi.fn();
  const avant = fetchKlines.mock.calls.length;
  const premier = calculerSurUnite(d, rappel);
  if (fetchKlines.mock.calls.length === avant) return pret(premier);
  await vi.waitFor(() => expect(rappel).toHaveBeenCalledTimes(1));
  return pret(calculerSurUnite(d, () => {}));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  viderCacheUnite();
  fetchKlines.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("alignement et bougies closes", () => {
  it("ouvertures alignées UTC ; semaine = lundi 00:00", () => {
    expect(ouvertureAlignee(LUNDI + 8 * H, "4h")).toBe(true);
    expect(ouvertureAlignee(LUNDI + 9 * H, "4h")).toBe(false);
    expect(ouvertureAlignee(LUNDI, "1w")).toBe(true);
    expect(ouvertureAlignee(LUNDI + 3 * J, "1w")).toBe(false); // jeudi (semaine « époque »)
    expect(ouvertureAlignee(LUNDI + 3 * J, "1d")).toBe(true);
  });

  it("garde les seules bougies closes, triées et dédoublonnées ; lève sur une ouverture décalée", () => {
    const b = (time: number, closed?: boolean): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1, ...(closed === undefined ? {} : { closed }) });
    const maintenant = LUNDI + 9 * H;
    const closes = bougiesCloses([b(LUNDI + 4 * H), b(LUNDI), b(LUNDI), b(LUNDI + 8 * H, false)], "4h", maintenant);
    expect(closes.map((c) => c.time)).toEqual([LUNDI, LUNDI + 4 * H]);
    // Sans drapeau : close seulement si sa clôture est passée.
    expect(bougiesCloses([b(LUNDI + 8 * H)], "4h", maintenant)).toEqual([]);
    expect(() => bougiesCloses([b(LUNDI + 3 * J)], "1w", maintenant + 30 * J)).toThrow(/lundi 00:00 UTC/);
  });

  it("marge de clôture : une bougie close depuis moins de MARGE_CLOTURE_MS reste écartée, même marquée close", () => {
    const b: Candle = { time: LUNDI, open: 1, high: 1, low: 1, close: 1, volume: 1, closed: true };
    expect(bougiesCloses([b], "4h", LUNDI + 4 * H + MARGE_CLOTURE_MS - 1)).toEqual([]);
    expect(bougiesCloses([b], "4h", LUNDI + 4 * H + MARGE_CLOTURE_MS)).toEqual([b]);
  });

  it("suite de la fenêtre : seules les bougies postérieures à la dernière détenue ; trou = repartir", () => {
    const b = (i: number): Candle => ({ time: LUNDI + i * 4 * H, open: i, high: i, low: i, close: i, volume: 1 });
    expect(suiteFenetre(b(10), [b(5), b(9), b(10), b(11), b(12)], 4 * H)?.map((c) => c.close)).toEqual([11, 12]);
    expect(suiteFenetre(b(10), [b(11)], 4 * H)?.map((c) => c.close)).toEqual([11]); // contiguë
    expect(suiteFenetre(b(10), [b(4), b(10)], 4 * H)).toEqual([]); // rien de neuf
    expect(suiteFenetre(b(10), [], 4 * H)).toEqual([]);
    expect(suiteFenetre(b(10), [b(12), b(13)], 4 * H)).toBeNull(); // la bougie 11 manque
  });
});

describe("calculerSurUnite — exactitude", () => {
  for (const [defId, params] of [["ema", { length: 20 }], ["rsi", { length: 14 }], ["macd", {}]] as const) {
    it(`égalité exacte avec le calcul natif sur les mêmes bougies 4h closes (${defId}), bougie en cours exclue`, async () => {
      const serie = marche(LUNDI, 4 * H, 900);
      servir(serie, "4h");
      vi.setSystemTime(LUNDI + 700 * 4 * H + 2.5 * H); // au milieu d'une bougie 4h
      const candles = graphe1h(Date.now() - 300 * H - 2.5 * H);
      const etat = await charger(demande(candles, defId, { ...params, unite: "4h" }));
      expect(fetchKlines).toHaveBeenCalledWith("BTCUSDT", "4h", { limit: LIMITE_BOUGIES_UNITE });

      // Mêmes bougies que la place a rendues, sans la bougie en cours : calcul natif 4h.
      const closes = reponse(serie, 4 * H, Date.now(), LIMITE_BOUGIES_UNITE).filter((c) => c.closed);
      expect(etat.nbBougies).toBe(closes.length);
      const natif = computeIndicator(getIndicator(defId)!, closes, params, undefined, "4h");
      let comparees = 0;
      for (const output of getIndicator(defId)!.outputs) {
        const projete = etat.result.series[output.key]!;
        candles.forEach((c, i) => {
          const k = oracle(closes, 4 * H, c.time + H);
          const attendu = k === undefined ? undefined : natif.series[output.key]![k];
          expect(projete[i]).toBe(attendu);
          if (typeof attendu === "number") comparees++;
        });
      }
      expect(comparees).toBeGreaterThan(250);
      expect(etat.partiel).toBeNull();
    });
  }

  it("le paramètre « unité » n'atteint pas le calcul (même résultat que sans la clé)", async () => {
    servir(marche(LUNDI, 4 * H, 900), "4h");
    vi.setSystemTime(LUNDI + 700 * 4 * H + H);
    const candles = graphe1h(Date.now() - 100 * H);
    const avec = await charger(demande(candles, "ema", { length: 20, unite: "4h" }));
    const ema = getIndicator("ema")!;
    const closes = reponse(marche(LUNDI, 4 * H, 900), 4 * H, Date.now(), 500).filter((c) => c.closed);
    expect(computeIndicator(ema, closes, { length: 20 }).series.ema!.at(-1)).toBe(avec.result.series.ema!.at(-1));
  });
});

describe("calculerSurUnite — causalité (fenêtre de la place qui glisse)", () => {
  /** Cumulatives (dépendent du début de la fenêtre) et un oscillateur récursif. */
  const INSTANCES = [
    ["obv", {}],
    ["nvi", { start: 1000 }],
    ["adLine", {}],
    ["pvt", {}],
    ["rsi", { length: 14 }],
  ] as const;

  it("aucune bougie close du graphe ne change d'une clôture 4h à l'autre ; égalité avec le graphe natif ouvert au départ", async () => {
    // 900 bougies 4h, la place n'en sert que les 500 dernières : sa fenêtre avance à chaque clôture.
    const serie = marche(LUNDI, 4 * H, 900, 17);
    servir(serie, "4h");
    const bloc = LUNDI + 600 * 4 * H;
    vi.setSystemTime(bloc + 2.5 * H);
    const debut = bloc - 300 * H;
    const precedentes = new Map<string, Array<number | undefined>>();
    let closesAvant = 0;
    const ETAPES = 3;
    for (let etape = 0; etape <= ETAPES; etape++) {
      if (etape > 0) vi.setSystemTime(bloc + etape * 4 * H + MARGE_CLOTURE_MS + 1_000);
      const candles = graphe1h(debut);
      const closesGraphe = candles.filter((c) => c.time + H <= Date.now()).length;
      const iClotureBloc = candles.findIndex((c) => c.time + H === bloc + etape * 4 * H);
      for (const [defId, params] of INSTANCES) {
        const etat = await charger(demande(candles, defId, { ...params, unite: "4h" }));
        const cle = getIndicator(defId)!.outputs[0]!.key;
        const projete = etat.result.series[cle]!;
        const avant = precedentes.get(defId);
        if (avant !== undefined) {
          // Le constat de revue : sans fenêtre fixe, OBV changeait ici jusqu'à 57 %.
          expect(projete.slice(0, closesAvant), `${defId}, clôture ${etape}`).toEqual(avant.slice(0, closesAvant));
          expect(typeof projete[iClotureBloc], `${defId}, clôture ${etape}`).toBe("number");
        }
        expect(projete.slice(0, closesGraphe).some((v) => typeof v === "number")).toBe(true);
        expect(etat.nbBougies, defId).toBe(499 + etape); // début fixe : une bougie de plus par clôture
        precedentes.set(defId, projete);
      }
      expect(fetchKlines).toHaveBeenCalledTimes(etape + 1); // une requête par clôture, toutes instances confondues
      closesAvant = closesGraphe;
    }

    // Graphe natif 4h ouvert au départ : ses 499 bougies closes, prolongées de celles qui ont clos depuis.
    const fenetre = serie.slice(101, 600 + ETAPES);
    const candles = graphe1h(debut);
    for (const [defId, params] of INSTANCES) {
      const cle = getIndicator(defId)!.outputs[0]!.key;
      const natif = computeIndicator(getIndicator(defId)!, fenetre, params, undefined, "4h").series[cle]!;
      expect(precedentes.get(defId), defId).toEqual(attendue(candles, fenetre, natif));
    }
  });

  it("longue veille (la place ne sert plus la suite) : la fenêtre repart, recalculée sur ce que sert la place", async () => {
    const serie = marche(LUNDI, 4 * H, 1300, 23);
    servir(serie, "4h");
    const bloc = LUNDI + 600 * 4 * H;
    vi.setSystemTime(bloc + 2.5 * H);
    await charger(demande(graphe1h(bloc - 50 * H), "obv", { unite: "4h" }));
    vi.setSystemTime(bloc + 600 * 4 * H + 2.5 * H); // 100 jours plus tard
    const candles = graphe1h(Date.now() - 50 * H);
    const etat = await charger(demande(candles, "obv", { unite: "4h" }));
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    const fenetre = reponse(serie, 4 * H, Date.now(), 500).filter((c) => c.closed);
    expect(etat.nbBougies).toBe(fenetre.length);
    const natif = computeIndicator(getIndicator("obv")!, fenetre, {}, undefined, "4h").series.obv!;
    expect(etat.result.series.obv).toEqual(attendue(candles, fenetre, natif));
  });
});

describe("calculerSurUnite — réseau", () => {
  it("une seule requête par clôture supérieure (marge comprise), partagée entre instances et recalculs", async () => {
    servir(marche(LUNDI, 4 * H, 900), "4h");
    const debutBloc = LUNDI + 700 * 4 * H;
    vi.setSystemTime(debutBloc + 30 * 60_000);
    // Un rappel par instance, comme le graphe (recalcul de CETTE instance seulement).
    const rappelEma = vi.fn();
    const rappelRsi = vi.fn();
    const ema = () => calculerSurUnite(demande(graphe1h(Date.now() - 50 * H), "ema", { length: 20, unite: "4h" }), rappelEma);
    const rsi = () => calculerSurUnite(demande(graphe1h(Date.now() - 50 * H), "rsi", { length: 14, unite: "4h" }), rappelRsi);
    expect(ema().status).toBe("pending");
    expect(rsi().status).toBe("pending");
    await vi.waitFor(() => expect(rappelRsi).toHaveBeenCalledTimes(1));
    expect(rappelEma).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      pret(ema());
      pret(rsi());
    }
    vi.setSystemTime(debutBloc + 3 * H + 59 * 60_000); // toujours dans le même bloc 4h
    pret(ema());
    pret(rsi());
    expect(fetchKlines).toHaveBeenCalledTimes(1);

    // Clôture du bloc, marge pas encore écoulée : aucune requête ; la bougie 1h close à la
    // clôture du bloc attend la bougie 4h (absente, pas périmée).
    vi.setSystemTime(debutBloc + 4 * H + 1_000);
    const candles = graphe1h(Date.now() - 50 * H);
    const iCloseAuBloc = candles.findIndex((c) => c.time + H === debutBloc + 4 * H);
    expect(pret(ema()).result.series.ema![iCloseAuBloc]).toBeUndefined();
    expect(fetchKlines).toHaveBeenCalledTimes(1);

    // Marge écoulée : UNE nouvelle requête ; en attendant, l'ancienne série reste servie.
    vi.setSystemTime(debutBloc + 4 * H + MARGE_CLOTURE_MS + 1_000);
    const pendant = pret(ema());
    pret(rsi());
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(pendant.result.series.ema![iCloseAuBloc]).toBeUndefined();
    await vi.waitFor(() => expect(rappelRsi).toHaveBeenCalledTimes(2));
    expect(rappelEma).toHaveBeenCalledTimes(2);
    const apres = pret(calculerSurUnite(demande(candles, "ema", { length: 20, unite: "4h" }), rappelEma));
    expect(typeof apres.result.series.ema![iCloseAuBloc]).toBe("number");
    pret(ema());
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("horloge du client en avance : la bougie encore ouverte côté serveur, marquée close, n'entre pas dans le calcul", async () => {
    const serie = marche(LUNDI, 4 * H, 900);
    const bloc = LUNDI + 600 * 4 * H;
    // Serveur en retard de 3 s ; l'adaptateur déduit `closed` de l'horloge du client.
    fetchKlines.mockImplementation(async () =>
      reponse(serie, 4 * H, Date.now() - 3_000, 500).map((c) => ({ ...c, closed: c.time + 4 * H <= Date.now() })),
    );
    vi.setSystemTime(bloc + 4 * H + 1_000); // serveur : bougie du bloc encore ouverte (clôture ×10)
    const candles = graphe1h(Date.now() - 50 * H);
    const iCloseAuBloc = candles.findIndex((c) => c.time + H === bloc + 4 * H);
    const avant = await charger(demande(candles, "ema", { length: 20, unite: "4h" }));
    expect(avant.nbBougies).toBe(499); // bougies 101 à 599 : celle du bloc est écartée
    expect(avant.result.series.ema![iCloseAuBloc]).toBeUndefined();

    vi.setSystemTime(bloc + 4 * H + MARGE_CLOTURE_MS + 2_000); // serveur : bougie du bloc close
    const apres = await charger(demande(candles, "ema", { length: 20, unite: "4h" }));
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(apres.nbBougies).toBe(500);
    const natif = computeIndicator(getIndicator("ema")!, serie.slice(101, 601), { length: 20 }, undefined, "4h").series.ema!;
    expect(apres.result.series.ema![iCloseAuBloc]).toBe(natif[499]);
  });

  it("place en retard sur la clôture : bougie close du graphe sans valeur, nouvel essai après 30 s seulement", async () => {
    const serie = marche(LUNDI, 4 * H, 900);
    const debutBloc = LUNDI + 700 * 4 * H;
    // La place ne sert pas encore la bougie qui vient de clore (elle la rend « en cours »).
    fetchKlines.mockImplementation(async () => reponse(serie, 4 * H, Date.now() - 4 * H, 500));
    vi.setSystemTime(debutBloc + 4 * H + MARGE_CLOTURE_MS + 2_000);
    const candles = graphe1h(Date.now() - 50 * H);
    const etat = await charger(demande(candles, "ema", { length: 20, unite: "4h" }));
    const iCloseAuBloc = candles.findIndex((c) => c.time + H === debutBloc + 4 * H);
    const iPrecedent = iCloseAuBloc - 1;
    expect(etat.result.series.ema![iCloseAuBloc]).toBeUndefined(); // close, en attente : absente
    expect(typeof etat.result.series.ema![iPrecedent]).toBe("number");
    expect(typeof etat.result.series.ema![candles.length - 1]).toBe("number"); // en formation : provisoire
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 10_000);
    pret(calculerSurUnite(demande(candles, "ema", { length: 20, unite: "4h" }), () => {}));
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 25_000);
    pret(calculerSurUnite(demande(candles, "ema", { length: 20, unite: "4h" }), () => {}));
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("échec réseau au premier chargement : erreur explicite, aucun nouvel essai avant 30 s", async () => {
    fetchKlines.mockRejectedValue(new Error("HTTP 503"));
    vi.setSystemTime(LUNDI + 700 * 4 * H);
    const d = demande(graphe1h(Date.now() - 10 * H), "ema", { length: 20, unite: "4h" });
    const rappel = vi.fn();
    expect(calculerSurUnite(d, rappel).status).toBe("pending");
    await vi.waitFor(() => expect(rappel).toHaveBeenCalledTimes(1));
    expect(calculerSurUnite(d, rappel)).toEqual({ status: "error", raison: "Bougies 4h indisponibles : HTTP 503" });
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31_000);
    expect(calculerSurUnite(d, rappel).status).toBe("pending");
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it("rechargement en échec : fenêtre gardée sans repeinture, « partiel » motivé, nouvel essai après 30 s", async () => {
    const serie = marche(LUNDI, 4 * H, 900, 5);
    servir(serie, "4h");
    const bloc = LUNDI + 600 * 4 * H;
    vi.setSystemTime(bloc + 2.5 * H);
    const debut = bloc - 100 * H;
    const initial = await charger(demande(graphe1h(debut), "obv", { unite: "4h" }));
    const closesAvant = graphe1h(debut).length - 1;

    const reponseNormale = fetchKlines.getMockImplementation()!;
    fetchKlines.mockImplementationOnce(async () => {
      throw new Error("HTTP 503");
    });
    vi.setSystemTime(bloc + 4 * H + MARGE_CLOTURE_MS + 1_000);
    const candles = graphe1h(debut);
    const iCloseAuBloc = candles.findIndex((c) => c.time + H === bloc + 4 * H);
    const enEchec = await charger(demande(candles, "obv", { unite: "4h" }));
    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(enEchec.partiel).toBe("Bougies 4h : rechargement en échec (HTTP 503), valeurs récentes en attente");
    expect(enEchec.nbBougies).toBe(initial.nbBougies);
    expect(enEchec.result.series.obv!.slice(0, closesAvant)).toEqual(initial.result.series.obv!.slice(0, closesAvant));
    expect(enEchec.result.series.obv![iCloseAuBloc]).toBeUndefined();

    vi.setSystemTime(Date.now() + 10_000);
    expect(pret(calculerSurUnite(demande(candles, "obv", { unite: "4h" }), () => {})).partiel).toMatch(/rechargement en échec/);
    expect(fetchKlines).toHaveBeenCalledTimes(2);

    fetchKlines.mockImplementation(reponseNormale);
    vi.setSystemTime(Date.now() + 25_000);
    const repris = await charger(demande(candles, "obv", { unite: "4h" }));
    expect(fetchKlines).toHaveBeenCalledTimes(3);
    expect(repris.partiel).toBeNull();
    expect(repris.nbBougies).toBe(initial.nbBougies + 1);
    expect(repris.result.series.obv!.slice(0, closesAvant)).toEqual(initial.result.series.obv!.slice(0, closesAvant));
    expect(typeof repris.result.series.obv![iCloseAuBloc]).toBe("number");
  });

  it("semaine non alignée sur le lundi (place à semaines « époque ») : refus durable, sans nouvel essai, retiré du sélecteur", async () => {
    const jeudi = LUNDI + 3 * J;
    servir(marche(jeudi, 7 * J, 300), "1w");
    vi.setSystemTime(jeudi + 200 * 7 * J + J);
    const kraken = "kraken" as ExchangeId;
    const d = demande(graphe1h(Date.now() - 10 * H), "ema", { length: 20, unite: "1w" }, { timeframe: "4h", unite: "1w", exchange: kraken });
    const rappel = vi.fn();
    calculerSurUnite(d, rappel);
    await vi.waitFor(() => expect(rappel).toHaveBeenCalledTimes(1));
    const etat = calculerSurUnite(d, rappel);
    expect(etat.status).toBe("refus");
    expect(etat.status === "refus" && etat.raison).toMatch(/non alignée \(lundi 00:00 UTC\) : unité refusée pour la session$/);
    vi.setSystemTime(Date.now() + 31_000);
    expect(calculerSurUnite(d, rappel).status).toBe("refus");
    vi.setSystemTime(Date.now() + 7 * J);
    expect(calculerSurUnite(d, rappel).status).toBe("refus");
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    const ema = getIndicator("ema")!;
    expect(unitesProposees(ema, { exchange: kraken, symbol: "BTCUSDT", timeframe: "4h" })).toEqual(["1d"]);
    expect(unitesProposees(ema, { exchange: kraken, symbol: "ETHUSDT", timeframe: "4h" })).toEqual(["1d", "1w"]); // non constaté
  });

  it("refus sans aucune requête : place exclue, stratégie, couple non aligné", () => {
    vi.setSystemTime(LUNDI + 700 * 4 * H);
    const candles = graphe1h(Date.now() - 10 * H);
    expect(calculerSurUnite(demande(candles, "ema", { unite: "4h" }, { exchange: "twelvedata" }), () => {})).toEqual({
      status: "refus",
      raison: "Unité supérieure réservée aux places crypto 24/7",
    });
    expect(calculerSurUnite(demande(candles, "stratAxis", { unite: "4h" }), () => {}).status).toBe("refus");
    expect(calculerSurUnite(demande(candles, "ema", { unite: "1w" }, { unite: "1w" }), () => {}).status).toBe("refus");
    expect(fetchKlines).not.toHaveBeenCalled();
  });
});

describe("calculerSurUnite — couverture", () => {
  it("historique supérieur trop court pour le début du graphe : « partiel »", async () => {
    servir(marche(LUNDI, J, 30), "1d"); // 30 jours d'historique, dont 29 clos
    vi.setSystemTime(LUNDI + 29 * J + 12 * H);
    const candles = graphe1h(LUNDI + 8 * J); // le graphe remonte avant la 20e clôture quotidienne
    const etat = await charger(demande(candles, "ema", { length: 20, unite: "1d" }, { unite: "1d" }));
    expect(etat.partiel).toBe("29 bougies 1d : historique trop court pour le début du graphe");
    expect(etat.result.series.ema![0]).toBeUndefined();
    expect(etat.result.series.ema!.some((v) => typeof v === "number")).toBe(true);
  });

  it("amorce plus longue que la profondeur chargée (EMA 450 en 4h) : « partiel » même avec l'historique disponible", async () => {
    servir(marche(LUNDI, 4 * H, 900), "4h");
    const bloc = LUNDI + 600 * 4 * H;
    vi.setSystemTime(bloc + 2.5 * H);
    const candles = graphe1h(bloc - 300 * H);
    const etat = await charger(demande(candles, "ema", { length: 450, unite: "4h" }));
    expect(etat.partiel).toBe("499 bougies 4h chargées : profondeur insuffisante pour le début du graphe");
    expect(etat.result.series.ema![0]).toBeUndefined();
    expect(etat.result.series.ema!.some((v) => typeof v === "number")).toBe(true);
    // Même graphe, période courte : le début est couvert.
    expect((await charger(demande(candles, "ema", { length: 20, unite: "4h" }))).partiel).toBeNull();
  });

  it("place plafonnée (Coinbase sert 350 bougies) : profondeur insuffisante, pas « historique trop court »", async () => {
    // La place détient 2 000 bougies 4h mais n'en sert que 350 par requête.
    const serie = marche(LUNDI, 4 * H, 2000);
    fetchKlines.mockImplementation(async (_s: string, _u: Timeframe, opts?: { limit?: number }) =>
      reponse(serie, 4 * H, Date.now(), Math.min(opts?.limit ?? 500, 350)),
    );
    const bloc = LUNDI + 1500 * 4 * H;
    vi.setSystemTime(bloc + 2.5 * H);
    const candles = graphe1h(bloc - 1300 * H);
    const etat = await charger(demande(candles, "ema", { length: 300, unite: "4h" }, { exchange: "coinbase" }));
    expect(etat.partiel).toBe("349 bougies 4h chargées : profondeur insuffisante pour le début du graphe");
  });

  it("historique long : pas « partiel »", async () => {
    servir(marche(LUNDI, J, 800), "1d");
    vi.setSystemTime(LUNDI + 700 * J + 12 * H);
    const etat = await charger(demande(graphe1h(Date.now() - 400 * H), "ema", { length: 20, unite: "1d" }, { unite: "1d" }));
    expect(etat.partiel).toBeNull();
    expect(typeof etat.result.series.ema![0]).toBe("number");
  });
});
