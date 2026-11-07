/**
 * MESURE (SUG-3, phase 1) : le profil intrabar se rapproche-t-il de l'oracle tick mieux
 * que la répartition uniforme actuelle ?
 *
 * Protocole, figé avant lecture des résultats : 20 tirages synthétiques à graine fixe
 * (marche aléatoire au pas de 10 s sur 10 jours, volume log-normal à saisonnalité horaire
 * et grappes, agresseur acheteur plus probable quand le prix monte), 100 bins comme le
 * VPVR. Oracle = chaque trade dans son bin. Comparé : bougies 4h réparties uniformément
 * (calcul actuel) contre les mêmes 4h remplacées par leurs sous-bougies 15m et 1m via
 * `regrouperParBougie` + `aplatirIntrabar` (chemin réel de data/intrabar.ts), le tout
 * passé à `computeVolumeProfile` inchangé. Critères : POC à ±1 bin de l'oracle,
 * corrélation des profils, erreur de la zone de valeur (en bins), corrélation du delta
 * par bin. Données synthétiques seulement : la mesure sur BTCUSDT réel contre le replay
 * tick du daemon reste à faire (pas de réseau ici).
 */
import { describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import { aplatirIntrabar, regrouperParBougie } from "../data/intrabar";

// volumeProfile.ts importe klinecharts (inerte hors navigateur) pour son contrôleur.
vi.mock("klinecharts", () => ({ ActionType: {}, DomPosition: {} }));

const { computeVolumeProfile } = await import("./volumeProfile");

const PAS_S = 10;
const DUREE_S = 10 * 86_400;
const BINS = 100;
const TIRAGES = 20;

interface Trade {
  t: number; // ms
  prix: number;
  qte: number;
  acheteur: boolean;
}

function generateur(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

function tirage(graine: number, dureeS = DUREE_S): Trade[] {
  const r = generateur(graine);
  const gauss = (): number => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const out: Trade[] = [];
  let prix = 60_000;
  let grappe = 1;
  for (let k = 0; k < dureeS / PAS_S; k++) {
    const t = k * PAS_S * 1000;
    if (r() < 0.005) grappe = 3 + 5 * r();
    grappe = 1 + (grappe - 1) * 0.99;
    const heure = ((k * PAS_S) / 3600) % 24;
    const saison = 1 + 0.6 * Math.sin(((heure - 14) / 24) * 2 * Math.PI);
    const rendement = 0.00038 * gauss() * Math.sqrt(grappe);
    prix *= Math.exp(rendement);
    const qte = saison * grappe * Math.exp(0.8 * gauss());
    const acheteur = r() < (rendement > 0 ? 0.7 : 0.3);
    out.push({ t, prix, qte, acheteur });
  }
  return out;
}

/** Bougies d'unité `dureeMs` agrégées depuis les trades (taker acheteur compris). */
function bougies(trades: readonly Trade[], dureeMs: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | undefined;
  for (const tr of trades) {
    const debut = Math.floor(tr.t / dureeMs) * dureeMs;
    if (cur === undefined || cur.time !== debut) {
      cur = { time: debut, open: tr.prix, high: tr.prix, low: tr.prix, close: tr.prix, volume: 0, buyVolume: 0, sellVolume: 0, closed: true };
      out.push(cur);
    }
    cur.high = Math.max(cur.high, tr.prix);
    cur.low = Math.min(cur.low, tr.prix);
    cur.close = tr.prix;
    cur.volume += tr.qte;
    if (tr.acheteur) cur.buyVolume = (cur.buyVolume ?? 0) + tr.qte;
    else cur.sellVolume = (cur.sellVolume ?? 0) + tr.qte;
  }
  return out;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] ?? 0;
    mb += b[i] ?? 0;
  }
  ma /= n;
  mb /= n;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma;
    const db = (b[i] ?? 0) - mb;
    x += da * db;
    y += da * da;
    z += db * db;
  }
  return x / Math.sqrt(y * z);
}

type Profil = NonNullable<ReturnType<typeof computeVolumeProfile>>;

interface Score {
  poc1: number;
  corr: number;
  erreurVa: number;
  corrDelta: number;
}

function comparer(p: Profil, oracle: Profil): Score {
  const taille = (oracle.priceMax - oracle.priceMin) / BINS;
  return {
    poc1: Math.abs(p.pocIndex - oracle.pocIndex) <= 1 ? 1 : 0,
    corr: correlation(p.bins.map((b) => b.volume), oracle.bins.map((b) => b.volume)),
    erreurVa: (Math.abs(p.vaLow - oracle.vaLow) + Math.abs(p.vaHigh - oracle.vaHigh)) / taille,
    corrDelta: correlation(p.bins.map((b) => b.buyVol - b.sellVol), oracle.bins.map((b) => b.buyVol - b.sellVol)),
  };
}

function profilIntrabar(parentes: Candle[], sous: Candle[], dureeParent: number, maintenant: number): Profil {
  const groupes = regrouperParBougie(parentes, 0, parentes.length, dureeParent, sous, maintenant);
  expect(groupes.size).toBe(parentes.length); // toutes couvertes (contrôle de volume passé)
  const plat = aplatirIntrabar(parentes, 0, parentes.length, groupes);
  const p = computeVolumeProfile(plat, 0, plat.length, BINS);
  if (p === null) throw new Error("profil vide");
  return p;
}

describe("mesure : profil intrabar contre oracle tick (données synthétiques)", () => {
  it("le POC, la zone de valeur et le delta par niveau se rapprochent de l'oracle", () => {
    const somme: Record<"uniforme4h" | "intrabar15m" | "intrabar1m", Score> = {
      uniforme4h: { poc1: 0, corr: 0, erreurVa: 0, corrDelta: 0 },
      intrabar15m: { poc1: 0, corr: 0, erreurVa: 0, corrDelta: 0 },
      intrabar1m: { poc1: 0, corr: 0, erreurVa: 0, corrDelta: 0 },
    };
    const H4 = 4 * 3_600_000;
    const maintenant = DUREE_S * 1000 + 60_000;
    for (let g = 1; g <= TIRAGES; g++) {
      const trades = tirage(1_000 + g);
      const parentes = bougies(trades, H4);
      // Oracle : un trade = une « bougie » de largeur nulle, versé entier dans son bin.
      const ticks: Candle[] = trades.map((tr) => ({
        time: tr.t,
        open: tr.prix,
        high: tr.prix,
        low: tr.prix,
        close: tr.prix,
        volume: tr.qte,
        buyVolume: tr.acheteur ? tr.qte : 0,
        sellVolume: tr.acheteur ? 0 : tr.qte,
      }));
      const oracle = computeVolumeProfile(ticks, 0, ticks.length, BINS);
      const uniforme = computeVolumeProfile(parentes, 0, parentes.length, BINS);
      if (oracle === null || uniforme === null) throw new Error("profil vide");
      // Même grille de prix pour tous : extrêmes des 4h = extrêmes des trades.
      expect(uniforme.priceMin).toBe(oracle.priceMin);
      expect(uniforme.priceMax).toBe(oracle.priceMax);
      const i15 = profilIntrabar(parentes, bougies(trades, 15 * 60_000), H4, maintenant);
      const i1 = profilIntrabar(parentes, bougies(trades, 60_000), H4, maintenant);
      for (const [cle, p] of [["uniforme4h", uniforme], ["intrabar15m", i15], ["intrabar1m", i1]] as const) {
        const s = comparer(p, oracle);
        somme[cle].poc1 += s.poc1;
        somme[cle].corr += s.corr;
        somme[cle].erreurVa += s.erreurVa;
        somme[cle].corrDelta += s.corrDelta;
      }
    }
    const moyenne = (s: Score): Score => ({
      poc1: s.poc1 / TIRAGES,
      corr: s.corr / TIRAGES,
      erreurVa: s.erreurVa / TIRAGES,
      corrDelta: s.corrDelta / TIRAGES,
    });
    const u = moyenne(somme.uniforme4h);
    const m15 = moyenne(somme.intrabar15m);
    const m1 = moyenne(somme.intrabar1m);
    console.info("[mesure intrabar]", JSON.stringify({ uniforme4h: u, intrabar15m: m15, intrabar1m: m1 }));

    // 1m : POC à ±1 bin de l'oracle dans ≥ 90 % des tirages, mieux que l'uniforme.
    expect(m1.poc1).toBeGreaterThanOrEqual(0.9);
    expect(m1.poc1).toBeGreaterThan(u.poc1);
    // 15m : déjà mieux que l'uniforme 4h sur chaque critère.
    expect(m15.poc1).toBeGreaterThanOrEqual(u.poc1);
    expect(m15.corr).toBeGreaterThan(u.corr);
    expect(m15.erreurVa).toBeLessThan(u.erreurVa);
    expect(m15.corrDelta).toBeGreaterThan(u.corrDelta);
    // 1m : profil quasi confondu avec l'oracle, zone de valeur à moins d'un bin.
    expect(m1.corr).toBeGreaterThan(m15.corr);
    expect(m1.corr).toBeGreaterThanOrEqual(0.99);
    expect(m1.erreurVa).toBeLessThan(m15.erreurVa);
    expect(m1.erreurVa).toBeLessThan(1);
    // Delta par niveau : nettement meilleur que l'uniforme, mais la cible 0,9 de l'étude
    // n'est PAS atteinte sur ce modèle (≈ 0,79 en 1m, 0,23 en uniforme 4h) : le sens de
    // l'agresseur change à l'échelle de 10 s, la minute le moyenne. Plancher de
    // non-régression seulement, sous la cible.
    expect(m1.corrDelta).toBeGreaterThan(m15.corrDelta);
    expect(m1.corrDelta).toBeGreaterThanOrEqual(0.75);
  });

  it("coût de calcul : 50 000 sous-bougies regroupées, aplaties et profilées", () => {
    const H1 = 3_600_000;
    const trades = tirage(7, 50_000 * 60); // 50 000 minutes de trades (pas de 10 s)
    const sous = bougies(trades, 60_000);
    const parentes = bougies(trades, H1);
    const maintenant = (trades.at(-1)?.t ?? 0) + 2 * H1;
    const t0 = performance.now();
    const groupes = regrouperParBougie(parentes, 0, parentes.length, H1, sous, maintenant);
    const plat = aplatirIntrabar(parentes, 0, parentes.length, groupes);
    const vp = computeVolumeProfile(plat, 0, plat.length, BINS);
    const ms = performance.now() - t0;
    console.info("[mesure intrabar] 50 000 sous-bougies :", ms.toFixed(1), "ms");
    expect(plat.length).toBeGreaterThanOrEqual(49_000);
    expect(vp).not.toBeNull();
    // Borne large (machine de CI partagée) ; la cible de l'étude est < 50 ms.
    expect(ms).toBeLessThan(500);
  });
});
