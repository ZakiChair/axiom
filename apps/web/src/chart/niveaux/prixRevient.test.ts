/**
 * Tests de la ligne « Coût Strategy » du chart maître (chart/niveaux/prixRevient.ts) : golden
 * sur la fixture CoinGecko (845 050 BTC pour 64 267 830 000 $ → 76 052,10 $) calculé par le
 * contrat du couloir CHAIN (`resumerTresoreries`), suffixe « (périmé) », aucune ligne sans
 * coût, éligibilité BTC coté en dollar, module CHAIN chargé au seul abonnement, rafraîchissement
 * horaire et toasts explicites (une fois par cause).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResultatFrais } from "../../data/onchain/mempool";
import { resumerTresoreries, type TresoreriesBtc } from "../../data/onchain/tresoreriesBtc";
import { RAFRAICHISSEMENT_PRIX_REVIENT_MS, creerSourcePrixRevient, lignesPrixRevient, type ModuleTresoreries } from "./prixRevient";

afterEach(() => vi.useRealTimers());

const BTC = { exchange: "binance" as const, symbol: "BTCUSDT" };
const FIXTURE: TresoreriesBtc = {
  totalBtc: 941_581,
  valeurUsd: 941_581 * 79_175.91,
  societes: [
    { nom: "Strategy", symbole: "MSTR.US", avoirsBtc: 845_050, coutTotalUsd: 64_267_830_000 },
    { nom: "Metaplanet", symbole: "3350.T", avoirsBtc: 43_000, coutTotalUsd: 3_810_765_023.48 },
  ],
};
const frais = (donnee: TresoreriesBtc = FIXTURE, perime = false): ResultatFrais<TresoreriesBtc> => ({ donnee, ts: 1, perime });

/** Module CHAIN factice : réponses successives (la dernière se répète), vrai `resumerTresoreries`. */
function moduleFactice(reponses: (ResultatFrais<TresoreriesBtc> | null | Error)[]) {
  const c = { imports: 0, chargements: 0 };
  const mod: ModuleTresoreries = {
    chargerTresoreriesBtc: async () => {
      c.chargements += 1;
      const r = reponses.length > 1 ? reponses.shift()! : reponses[0]!;
      if (r instanceof Error) throw r;
      return r;
    },
    resumerTresoreries,
  };
  const module = async () => {
    c.imports += 1;
    return mod;
  };
  return { c, module };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("lignesPrixRevient", () => {
  it("golden : Strategy 845 050 BTC pour 64 267 830 000 $ → une seule ligne à 76 052,10", () => {
    const cout = resumerTresoreries(FIXTURE).strategy?.coutMoyenUsd;
    const lignes = lignesPrixRevient(cout, false);
    expect(lignes).toEqual([{ price: 64_267_830_000 / 845_050, label: "Coût Strategy", couleur: "--text-dim", emphase: "forte" }]);
    expect(lignes[0]!.price.toFixed(2)).toBe("76052.10");
  });

  it("résultat périmé : suffixe « (périmé) »", () => {
    expect(lignesPrixRevient(76_052.1, true).map((l) => l.label)).toEqual(["Coût Strategy (périmé)"]);
  });

  it("coût absent, nul, négatif ou non fini : aucune ligne", () => {
    for (const cout of [null, undefined, 0, -1, Number.NaN]) expect(lignesPrixRevient(cout, false)).toEqual([]);
  });
});

describe("creerSourcePrixRevient", () => {
  it("marché non éligible (ETH, action) : ni import du module CHAIN ni appel, toast explicatif", () => {
    const toasts: string[] = [];
    for (const ctx of [
      { exchange: "coinbase" as const, symbol: "ETH-USD" },
      { exchange: "twelvedata" as const, symbol: "MSTR" },
    ]) {
      const m = moduleFactice([frais()]);
      const source = creerSourcePrixRevient(ctx, { module: m.module, toast: (t) => toasts.push(t) });
      source.subscribe(() => {})();
      expect(m.c.imports).toBe(0);
      expect(source.getLignes()).toEqual([]);
    }
    expect(toasts).toEqual([
      "Coût Strategy : BTC coté en dollar seulement (trésoreries CoinGecko), pas ETH-USD",
      "Coût Strategy : BTC coté en dollar seulement (trésoreries CoinGecko), pas MSTR",
    ]);
  });

  it("BTC : module chargé au seul abonnement, ligne tracée et notifiée ; BTC-USD aussi éligible", async () => {
    const m = moduleFactice([frais()]);
    const toasts: string[] = [];
    const source = creerSourcePrixRevient(BTC, { module: m.module, toast: (t) => toasts.push(t) });
    expect(m.c.imports).toBe(0);
    let notifs = 0;
    const unsub = source.subscribe(() => (notifs += 1));
    await flush();
    unsub();
    expect(m.c.chargements).toBe(1);
    expect(notifs).toBe(1);
    expect(source.getLignes().map((l) => [l.label, l.price.toFixed(2)])).toEqual([["Coût Strategy", "76052.10"]]);
    expect(toasts).toEqual([]);

    const usd = moduleFactice([frais(FIXTURE, true)]);
    const sourceUsd = creerSourcePrixRevient({ exchange: "coinbase", symbol: "BTC-USD" }, { module: usd.module, toast: () => {} });
    const unsubUsd = sourceUsd.subscribe(() => {});
    await flush();
    unsubUsd();
    expect(sourceUsd.getLignes().map((l) => l.label)).toEqual(["Coût Strategy (périmé)"]);
  });

  it("rafraîchit toutes les heures ; échec : toast unique, ligne conservée ; succès puis échec : nouveau toast ; désabonnement coupe tout", async () => {
    vi.useFakeTimers();
    const m = moduleFactice([frais(), null, null, frais(FIXTURE, true), null]);
    const toasts: string[] = [];
    const source = creerSourcePrixRevient(BTC, { module: m.module, toast: (t) => toasts.push(t) });
    const unsub = source.subscribe(() => {});
    await flush();
    const lignes = source.getLignes();
    expect(lignes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(RAFRAICHISSEMENT_PRIX_REVIENT_MS);
    await vi.advanceTimersByTimeAsync(RAFRAICHISSEMENT_PRIX_REVIENT_MS);
    expect(m.c.chargements).toBe(3);
    expect(source.getLignes()).toEqual(lignes);
    expect(toasts).toEqual(["Coût Strategy : trésoreries CoinGecko indisponibles, nouvel essai dans 1 h"]);

    await vi.advanceTimersByTimeAsync(RAFRAICHISSEMENT_PRIX_REVIENT_MS);
    expect(source.getLignes().map((l) => l.label)).toEqual(["Coût Strategy (périmé)"]);
    await vi.advanceTimersByTimeAsync(RAFRAICHISSEMENT_PRIX_REVIENT_MS);
    expect(toasts).toHaveLength(2);

    unsub();
    await vi.advanceTimersByTimeAsync(5 * RAFRAICHISSEMENT_PRIX_REVIENT_MS);
    expect(m.c.chargements).toBe(5);
  });

  it("Strategy absente ou coût non publié : aucune ligne, causes distinguées par toast", async () => {
    const sansStrategy = { ...FIXTURE, societes: FIXTURE.societes.filter((s) => s.nom !== "Strategy") };
    const sansCout = { ...FIXTURE, societes: FIXTURE.societes.map((s) => (s.nom === "Strategy" ? { ...s, coutTotalUsd: null } : s)) };
    const toasts: string[] = [];
    for (const donnee of [sansStrategy, sansCout]) {
      const m = moduleFactice([frais(donnee)]);
      const source = creerSourcePrixRevient(BTC, { module: m.module, toast: (t) => toasts.push(t) });
      const unsub = source.subscribe(() => {});
      await flush();
      unsub();
      expect(source.getLignes()).toEqual([]);
    }
    expect(toasts).toEqual([
      "Coût Strategy : Strategy absente des trésoreries CoinGecko",
      "Coût Strategy : coût moyen de Strategy non publié par CoinGecko",
    ]);
  });

  it("module CHAIN introuvable (chunk non chargé) : toast, jamais d'overlay muet", async () => {
    const toasts: string[] = [];
    const source = creerSourcePrixRevient(BTC, {
      module: () => Promise.reject(new Error("chunk")),
      toast: (t) => toasts.push(t),
    });
    const unsub = source.subscribe(() => {});
    await flush();
    unsub();
    expect(source.getLignes()).toEqual([]);
    expect(toasts).toEqual(["Coût Strategy : trésoreries CoinGecko indisponibles, nouvel essai dans 1 h"]);
  });

  it("désabonnement avant la réponse : aucune notification ni toast", async () => {
    let resoudre: (r: ResultatFrais<TresoreriesBtc> | null) => void = () => {};
    const toasts: string[] = [];
    const source = creerSourcePrixRevient(BTC, {
      module: async () => ({ chargerTresoreriesBtc: () => new Promise((res) => (resoudre = res)), resumerTresoreries }),
      toast: (t) => toasts.push(t),
    });
    let notifs = 0;
    const unsub = source.subscribe(() => (notifs += 1));
    await flush();
    unsub();
    resoudre(null);
    await flush();
    expect(notifs).toBe(0);
    expect(toasts).toEqual([]);
  });
});
