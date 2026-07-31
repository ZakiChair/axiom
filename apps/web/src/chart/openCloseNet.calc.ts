/**
 * OCN (Open/Close Net) — cœur de CALCUL PUR, façon Flux.
 * Cf. spec docs/superpowers/specs/2026-07-31-open-close-net-design.md.
 *
 * L'OI par niveau de prix n'est PAS observable : on l'ESTIME en croisant le
 * ΔOI par bougie (snapshots Binance Futures) avec le footprint tick par niveau.
 *  - ΔOI > 0 : |ΔOI| réparti sur les niveaux au prorata du volume ; le sens
 *    d'un niveau = signe de son delta agressif (sell net + OI↑ → shorts).
 *  - ΔOI < 0 : consommation PROPORTIONNELLE du registre des positions encore
 *    ouvertes, côté racheté (couper un short = achat agressif). Proportionnelle
 *    et non par prix : une position se ferme au prix courant, pas à son niveau
 *    d'origine. Sur-consommation clampée à 0.
 *
 * Aucune dépendance à KLineChart, au DOM ni aux stores — testé dans
 * openCloseNet.calc.test.ts.
 */
import type { Candle, FootprintBar, FootprintRow } from "@axiom/types";

/** Point OI normalisé (sous-ensemble de BinanceOiHistPoint, découplé de la source). */
export interface OiPoint {
  time: number;
  oi: number;
}

/**
 * Timeframes AXIOM pour lesquels l'OI `/futures/data` existe (miroir
 * BinanceFuturesPeriod). Source unique, partagée entre le gate du contrôleur
 * et le grisage UI (IndicatorMenu) — module pur, importable partout.
 */
export const OCN_PERIODS = new Set<string>([
  "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d",
]);

/** Position nette estimée, ancrée à la bougie et au niveau où elle s'est ouverte. */
export interface OcnEntry {
  time: number; // open time de la bougie d'ouverture
  price: number; // bas du niveau (convention FootprintRow.price)
  side: "long" | "short";
  opened: number; // quantité attribuée à l'ouverture (contrats)
  remaining: number; // encore ouvert après consommations (≥ 0)
}

/** Agrégat par niveau du net encore ouvert (profil latéral droit). */
export interface OcnProfileLevel {
  price: number;
  openLong: number;
  openShort: number;
}

export interface OcnResult {
  entries: OcnEntry[];
  profile: OcnProfileLevel[];
  /** Niveau au plus gros volume total de la fenêtre (null si aucune donnée). */
  poc: number | null;
}

/**
 * Aligne les snapshots OI sur les bougies : le snapshot à T est l'OI à la
 * clôture de la bougie qui se termine en T → le ΔOI est attribué à la bougie
 * PENDANT laquelle il s'est produit. Bougie sans snapshot postérieur → ΔOI = 0
 * (OI inchangé). Bougies antérieures au premier snapshot → absentes (pas de
 * baseline). `times` et `oiPoints` triés ascendants.
 */
export function deltasOiParBougie(
  times: number[],
  oiPoints: OiPoint[]
): Map<number, number> {
  const out = new Map<number, number>();
  if (times.length === 0 || oiPoints.length === 0) return out;

  let j = 0;
  // Baseline = dernier snapshot ≤ open de la première bougie.
  let prevOi: number | null = null;
  while (j < oiPoints.length && (oiPoints[j] as OiPoint).time <= (times[0] as number)) {
    prevOi = (oiPoints[j] as OiPoint).oi;
    j++;
  }

  for (let i = 0; i < times.length; i++) {
    const t = times[i] as number;
    const end = times[i + 1]; // fin de bougie = open de la suivante (dernière : +∞)
    let oiClose: number | null = prevOi;
    while (j < oiPoints.length && (end === undefined || (oiPoints[j] as OiPoint).time <= end)) {
      oiClose = (oiPoints[j] as OiPoint).oi;
      j++;
    }
    if (prevOi === null || oiClose === null) {
      // Pas encore de baseline : impossible d'attribuer un delta à cette bougie.
      prevOi = oiClose;
      continue;
    }
    out.set(t, oiClose - prevOi);
    prevOi = oiClose;
  }
  return out;
}

/**
 * Footprint APPROCHÉ d'une bougie OHLCV : le volume (buy/sell de la bougie —
 * taker buy Binance, historique) est réparti UNIFORMÉMENT sur les buckets
 * couvrant [low, high]. Sert aux bougies antérieures à la souscription tick :
 * sans lui, la fenêtre OCN démarre vide et se remplit sur 30+ min (illisible),
 * alors que Flux affiche l'historique immédiatement — leur modèle est le même
 * (l'attribution intra-bougie de l'historique est TOUJOURS une approximation).
 * Chaque niveau hérite du ratio buy/sell de la bougie → le sens OCN d'une
 * bougie approchée est celui de son delta agressif, à tous ses niveaux.
 * Source sans taker buy → répartition neutre 50/50. PURE.
 */
export function rowsApprochees(
  candle: Pick<Candle, "low" | "high" | "volume" | "buyVolume" | "sellVolume">,
  bucketSize: number
): FootprintRow[] {
  if (candle.volume <= 0 || bucketSize <= 0) return [];
  const buyTotal = candle.buyVolume ?? candle.volume / 2;
  const sellTotal = candle.sellVolume ?? candle.volume - buyTotal;
  const first = Math.floor(candle.low / bucketSize);
  const last = Math.max(first, Math.floor(candle.high / bucketSize));
  const n = last - first + 1;
  const rows: FootprintRow[] = [];
  for (let k = first; k <= last; k++) {
    rows.push({ price: k * bucketSize, buyVol: buyTotal / n, sellVol: sellTotal / n });
  }
  return rows;
}

/** Consomme `amount` proportionnellement sur les entrées d'un côté (clamp à 0). */
function consommer(entries: OcnEntry[], side: "long" | "short", amount: number): void {
  if (amount <= 0) return;
  let total = 0;
  for (const e of entries) {
    if (e.side === side) total += e.remaining;
  }
  if (total <= 0) return;
  const factor = Math.max(0, 1 - amount / total);
  for (const e of entries) {
    if (e.side === side) e.remaining *= factor;
  }
}

/**
 * Estime les positions nettes ouvertes/fermées par (bougie, niveau) sur la
 * fenêtre `bars` (triée par time ascendant), le profil agrégé par niveau et le
 * POC. `deltaOi` vient de `deltasOiParBougie` ; bougie absente de la map →
 * ignorée (aucune info OI). `bucketSize` sert de clé de niveau stable.
 */
export function computeOpenCloseNet(
  bars: FootprintBar[],
  deltaOi: Map<number, number>,
  bucketSize: number
): OcnResult {
  const entries: OcnEntry[] = [];
  const volByLevel = new Map<number, number>(); // clé = idx de bucket → volume total

  for (const bar of bars) {
    let totalVol = 0;
    for (const r of bar.rows) {
      const vol = r.buyVol + r.sellVol;
      totalVol += vol;
      if (vol > 0) {
        const key = Math.round(r.price / bucketSize);
        volByLevel.set(key, (volByLevel.get(key) ?? 0) + vol);
      }
    }

    const dOi = deltaOi.get(bar.time);
    if (dOi === undefined || dOi === 0 || totalVol <= 0) continue;

    if (dOi > 0) {
      // Ouvertures : répartition prorata, sens = delta agressif du niveau.
      for (const r of bar.rows) {
        const vol = r.buyVol + r.sellVol;
        if (vol <= 0) continue;
        const share = (dOi * vol) / totalVol;
        if (r.buyVol > r.sellVol) {
          entries.push({ time: bar.time, price: r.price, side: "long", opened: share, remaining: share });
        } else if (r.sellVol > r.buyVol) {
          entries.push({ time: bar.time, price: r.price, side: "short", opened: share, remaining: share });
        } else {
          entries.push({ time: bar.time, price: r.price, side: "long", opened: share / 2, remaining: share / 2 });
          entries.push({ time: bar.time, price: r.price, side: "short", opened: share / 2, remaining: share / 2 });
        }
      }
    } else {
      // Fermetures : le côté racheté = côté opposé au delta agressif de la bougie.
      const amount = -dOi;
      if (bar.delta > 0) {
        consommer(entries, "short", amount);
      } else if (bar.delta < 0) {
        consommer(entries, "long", amount);
      } else {
        // Delta neutre : consommation des deux côtés au prorata de leurs stocks.
        let longs = 0;
        let shorts = 0;
        for (const e of entries) {
          if (e.side === "long") longs += e.remaining;
          else shorts += e.remaining;
        }
        const stock = longs + shorts;
        if (stock > 0) {
          consommer(entries, "long", (amount * longs) / stock);
          consommer(entries, "short", (amount * shorts) / stock);
        }
      }
    }
  }

  // Profil latéral : net encore ouvert agrégé par niveau.
  const profileByKey = new Map<number, OcnProfileLevel>();
  for (const e of entries) {
    const key = Math.round(e.price / bucketSize);
    let lvl = profileByKey.get(key);
    if (lvl === undefined) {
      lvl = { price: e.price, openLong: 0, openShort: 0 };
      profileByKey.set(key, lvl);
    }
    if (e.side === "long") lvl.openLong += e.remaining;
    else lvl.openShort += e.remaining;
  }
  const profile = [...profileByKey.values()].sort((a, b) => a.price - b.price);

  // POC : niveau au plus gros volume total de la fenêtre.
  let poc: number | null = null;
  let maxVol = 0;
  for (const [key, vol] of volByLevel) {
    if (vol > maxVol) {
      maxVol = vol;
      poc = key * bucketSize;
    }
  }

  return { entries, profile, poc };
}
