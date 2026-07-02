/**
 * Moteur de rejeu de marché (roadmap §4.4) — côté front.
 *
 * Alimente le chart FOCUS avec des données HISTORIQUES rejouées, via LES MÊMES
 * chemins que le live :
 *  - il se présente comme un `IExchangeAdapter` (fetchKlines + subscribeKline +
 *    subscribeTrades) que `ChartInstance` utilise à la place de l'adaptateur d'exchange
 *    quand le slot est en replay → tout le pipeline existant (upsertCandle, indicateurs,
 *    CVD, footprint) fonctionne SANS modification ;
 *  - les trades rejoués (aggTrades du jour, servis par le daemon) reconstruisent les
 *    bougies du TF choisi au fil de l'eau et nourrissent le footprint.
 *
 * Répartition des sources (comme le chart normal) :
 *  - CONTEXTE (bougies déjà clôturées avant le curseur) = klines REST réelles Binance
 *    (`binanceAdapter.fetchKlines`) → seed instantané et exact, seek bon marché.
 *  - REJEU (bougie en formation + clôtures au fil du curseur) = reconstruit depuis les
 *    aggTrades (fonction PURE `reconstruireBougies`, testée).
 *
 * INVARIANT (BUILD-CONTRACT) : hors chemin chaud du renderer côté daemon (le daemon ne
 * fait que servir des pages de trades déjà téléchargées). Aucune donnée haute fréquence
 * dans React : le moteur émet vers des callbacks impératifs (le store ne reçoit que la
 * position du curseur, ~10/s).
 */
import type { Candle, IExchangeAdapter, Timeframe, Trade, Unsubscribe } from "@axiom/types";
import { binanceAdapter } from "./binance";

/** Timeframes proposés au replay (intraday ; natifs Binance). Ordre = ordre du sélecteur. */
export const REPLAY_TFS: Timeframe[] = ["1m", "5m", "15m", "1h"];

/** Durée d'une bougie (ms) par TF de replay. */
const TF_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
};

/** Vitesses de rejeu proposées. */
export const VITESSES: number[] = [1, 5, 15, 60];

/** Durée d'un jour (ms). */
export const JOUR_MS = 86_400_000;

/** Période du minuteur de rejeu (ms) : le curseur avance de `dt × vitesse` à chaque tick. */
const PERIODE_MS = 100;
/** Lignes par page GET de trades (aligné sur LIMITE_DEFAUT du daemon). */
const PAGE_TRADES = 50_000;
/** Marge de préchargement : on charge tant que le buffer ne couvre pas curseur + marge. */
const MARGE_CHARGE_MS = 5 * 60_000;
/** Seuil de rognage du buffer (trades déjà rejoués) — borne mémoire. */
const TRIM_SEUIL = 100_000;

// ─────────────────────────── Accès daemon (HTTP) ───────────────────────────

/**
 * Base d'URL du daemon (réplique la logique privée de data/daemon.ts, non exportée) :
 * DEV → 127.0.0.1:8787 ; PROD → même origine (front servi par le daemon).
 */
function baseDaemon(): string {
  if (import.meta.env.DEV) return "http://127.0.0.1:8787";
  if (typeof window !== "undefined") return window.location.origin;
  return "http://127.0.0.1:8787";
}

/** Trade rejoué au format de fil du daemon. */
export interface TradeReplay {
  t: number;
  prix: number;
  qty: number;
  isBuyerMaker: number;
}

/** État d'un job de téléchargement (miroir du daemon). */
export interface JobStatut {
  etat: "absent" | "en_cours" | "pret" | "erreur";
  symbole?: string;
  jour?: string;
  recus?: number;
  octets?: number;
  erreur?: string | null;
}

/** Un jour stocké (panneau stockage). */
export interface JourStocke {
  symbole: string;
  jour: string;
  etat: string;
  recus: number;
  octets: number;
}

/** Demande le téléchargement d'un jour (idempotent). */
export async function demanderTelechargement(symbole: string, jour: string): Promise<JobStatut> {
  const res = await fetch(`${baseDaemon()}/replay/download`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbole, jour }),
  });
  return (await res.json()) as JobStatut;
}

/** Interroge l'état d'un job. */
export async function statutTelechargement(symbole: string, jour: string): Promise<JobStatut> {
  const res = await fetch(
    `${baseDaemon()}/replay/status/${encodeURIComponent(symbole)}/${encodeURIComponent(jour)}`,
  );
  return (await res.json()) as JobStatut;
}

/** Liste les jours stockés. */
export async function listerJours(): Promise<JourStocke[]> {
  const res = await fetch(`${baseDaemon()}/replay/jours`);
  const corps = (await res.json()) as { jours?: JourStocke[] };
  return Array.isArray(corps.jours) ? corps.jours : [];
}

/** Purge un jour stocké. */
export async function purgerJour(symbole: string, jour: string): Promise<boolean> {
  const res = await fetch(
    `${baseDaemon()}/replay/trades/${encodeURIComponent(symbole)}/${encodeURIComponent(jour)}`,
    { method: "DELETE" },
  );
  return res.ok;
}

/** Charge une page de trades (t croissant, t >= depuis). */
export async function chargerPageTrades(
  symbole: string,
  jour: string,
  depuis: number,
): Promise<TradeReplay[]> {
  const res = await fetch(
    `${baseDaemon()}/replay/trades/${encodeURIComponent(symbole)}/${encodeURIComponent(jour)}` +
      `?depuis=${depuis}&limite=${PAGE_TRADES}`,
  );
  if (!res.ok) return [];
  const corps = (await res.json()) as { trades?: TradeReplay[] };
  return Array.isArray(corps.trades) ? corps.trades : [];
}

// ─────────────────────────── Reconstruction de bougies (PURE, testée) ───────────────────────────

/**
 * Reconstruit les bougies OHLCV d'un TF (ms) depuis une liste de trades TRIÉE par temps.
 * Chaque bougie porte buyVolume/sellVolume (delta/CVD) : côté agresseur = acheteur si
 * `isBuyerMaker` est faux (taker buy), vendeur sinon. La DERNIÈRE bougie est marquée
 * `closed:false` (en formation) ; toutes les autres `closed:true`. Fonction PURE.
 */
export function reconstruireBougies(trades: TradeReplay[], tfMs: number): Candle[] {
  const out: Candle[] = [];
  let courante: Candle | null = null;
  for (const tr of trades) {
    if (!Number.isFinite(tr.t) || !Number.isFinite(tr.prix)) continue;
    const bucket = Math.floor(tr.t / tfMs) * tfMs;
    if (courante === null || bucket > courante.time) {
      if (courante !== null) {
        courante.closed = true;
        out.push(courante);
      }
      courante = {
        time: bucket,
        open: tr.prix,
        high: tr.prix,
        low: tr.prix,
        close: tr.prix,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        closed: false,
      };
    }
    if (tr.prix > courante.high) courante.high = tr.prix;
    if (tr.prix < courante.low) courante.low = tr.prix;
    courante.close = tr.prix;
    courante.volume += tr.qty;
    if (tr.isBuyerMaker) courante.sellVolume = (courante.sellVolume ?? 0) + tr.qty;
    else courante.buyVolume = (courante.buyVolume ?? 0) + tr.qty;
  }
  if (courante !== null) out.push(courante);
  return out;
}

/** Convertit un TradeReplay en Trade (@axiom/types) : côté agresseur normalisé. */
export function versTrade(tr: TradeReplay): Trade {
  return { time: tr.t, price: tr.prix, qty: tr.qty, side: tr.isBuyerMaker ? "sell" : "buy" };
}

/** Renvoie la durée (ms) d'un TF de replay (défaut 1m). */
export function tfEnMs(tf: Timeframe): number {
  return TF_MS[tf] ?? 60_000;
}

/** Minuit UTC (ms) d'un jour `YYYY-MM-DD`. */
export function debutJour(jour: string): number {
  const t = Date.parse(`${jour}T00:00:00Z`);
  return Number.isFinite(t) ? t : NaN;
}

// ─────────────────────────── Moteur de rejeu ───────────────────────────

/** Options de création d'un moteur de rejeu. */
export interface OptionsMoteur {
  symbole: string;
  jour: string;
  tf: Timeframe;
  /** Position initiale du curseur (ms epoch). Défaut : minuit du jour. */
  curseurInitial?: number;
  /** Rappelé (~10/s) avec la position du curseur — pour la barre de progression UI. */
  onCurseur?: (t: number) => void;
  /** Rappelé quand la lecture atteint la fin du jour. */
  onFin?: () => void;
}

export class MoteurReplay {
  readonly symbole: string;
  readonly jour: string;
  readonly tf: Timeframe;
  private readonly tfMs: number;
  readonly jourDebut: number;
  readonly jourFin: number;

  private curseur: number;
  private vitesse = 1;
  private enLecture = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dernierTick = 0;

  private readonly klineSubs = new Set<(c: Candle) => void>();
  private readonly tradeSubs = new Set<(t: Trade) => void>();

  /** Buffer de trades chargés (rognés au fil du rejeu) + curseur de lecture. */
  private buffer: TradeReplay[] = [];
  private idx = 0;
  private dernierTCharge: number;
  private chargementComplet = false;
  private enChargement = false;
  private bougieCourante: Candle | null = null;

  private readonly onCurseur?: (t: number) => void;
  private readonly onFin?: () => void;

  constructor(opts: OptionsMoteur) {
    this.symbole = opts.symbole.toUpperCase();
    this.jour = opts.jour;
    this.tf = opts.tf;
    this.tfMs = tfEnMs(opts.tf);
    this.jourDebut = debutJour(opts.jour);
    this.jourFin = this.jourDebut + JOUR_MS;
    this.curseur = Math.max(this.jourDebut, Math.min(this.jourFin, opts.curseurInitial ?? this.jourDebut));
    // Première page à partir du bucket du curseur (seed = klines réelles avant ce bucket).
    this.dernierTCharge = this.bucketDe(this.curseur) - 1;
    this.onCurseur = opts.onCurseur;
    this.onFin = opts.onFin;
  }

  private bucketDe(t: number): number {
    return Math.floor(t / this.tfMs) * this.tfMs;
  }

  /** Position courante du curseur (ms). */
  position(): number {
    return this.curseur;
  }

  /** true si la lecture est en cours. */
  estEnLecture(): boolean {
    return this.enLecture;
  }

  // --- Surface IExchangeAdapter (consommée par ChartInstance / OrderflowController) ---

  /**
   * Seed du chart : bougies RÉELLES (klines REST Binance) du jour, clôturées AVANT le
   * bucket du curseur. Le rejeu reconstruira les bougies suivantes depuis les aggTrades.
   * En pagination (endTime fourni par le scroll gauche), délègue aux klines réelles.
   */
  async seed(endTime?: number): Promise<Candle[]> {
    if (endTime !== undefined) {
      try {
        return await binanceAdapter.fetchKlines(this.symbole, this.tf, { limit: 500, endTime });
      } catch {
        return [];
      }
    }
    const bucket = this.bucketDe(this.curseur);
    if (bucket <= this.jourDebut) return [];
    try {
      const klines = await binanceAdapter.fetchKlines(this.symbole, this.tf, {
        limit: 1000,
        endTime: bucket - 1,
      });
      return klines.filter((c) => c.time >= this.jourDebut && c.time < bucket);
    } catch {
      return [];
    }
  }

  abonnerKline(cb: (c: Candle) => void): Unsubscribe {
    this.klineSubs.add(cb);
    return () => this.klineSubs.delete(cb);
  }

  abonnerTrades(cb: (t: Trade) => void): Unsubscribe {
    this.tradeSubs.add(cb);
    return () => this.tradeSubs.delete(cb);
  }

  // --- Contrôles de lecture ---

  lecture(): void {
    if (this.enLecture || this.curseur >= this.jourFin) return;
    this.enLecture = true;
    this.dernierTick = performance.now();
    this.timer = setInterval(this.tick, PERIODE_MS);
  }

  pause(): void {
    this.enLecture = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setVitesse(v: number): void {
    this.vitesse = v > 0 ? v : 1;
  }

  dispose(): void {
    this.pause();
    this.klineSubs.clear();
    this.tradeSubs.clear();
    this.buffer = [];
    this.idx = 0;
    this.bougieCourante = null;
  }

  // --- Boucle de rejeu ---

  private readonly tick = (): void => {
    const maintenant = performance.now();
    const dt = maintenant - this.dernierTick;
    this.dernierTick = maintenant;
    this.curseur = Math.min(this.jourFin, this.curseur + dt * this.vitesse);
    void this.assurerCharge(this.curseur);
    this.traiter(this.curseur);
    this.onCurseur?.(this.curseur);
    if (this.curseur >= this.jourFin && this.chargementComplet && this.idx >= this.buffer.length) {
      this.pause();
      this.onFin?.();
    }
  };

  /** Charge les pages de trades tant que le buffer ne couvre pas `jusqua + marge`. */
  private async assurerCharge(jusqua: number): Promise<void> {
    if (this.chargementComplet || this.enChargement) return;
    const dernier = this.buffer[this.buffer.length - 1];
    if (dernier !== undefined && dernier.t >= jusqua + MARGE_CHARGE_MS) return;
    this.enChargement = true;
    try {
      // depuis = dernierTCharge + 1 : évite de réémettre la borne (perte possible des
      // trades partageant l'exacte ms de coupe d'une page — négligeable pour un rejeu visuel).
      const page = await chargerPageTrades(this.symbole, this.jour, this.dernierTCharge + 1);
      if (page.length === 0) {
        this.chargementComplet = true;
        return;
      }
      for (const tr of page) {
        this.buffer.push(tr);
        if (tr.t > this.dernierTCharge) this.dernierTCharge = tr.t;
      }
      if (page.length < PAGE_TRADES) this.chargementComplet = true;
    } catch {
      /* réseau : on réessaiera au prochain tick */
    } finally {
      this.enChargement = false;
    }
  }

  /** Traite tous les trades chargés jusqu'à `jusqua`, émet klines puis trades. */
  private traiter(jusqua: number): void {
    const aEmettre: Candle[] = [];
    const tradesEmis: TradeReplay[] = [];
    while (this.idx < this.buffer.length) {
      const tr = this.buffer[this.idx];
      if (tr === undefined || tr.t > jusqua) break;
      this.idx++;
      tradesEmis.push(tr);
      const bucket = this.bucketDe(tr.t);
      if (this.bougieCourante === null || bucket > this.bougieCourante.time) {
        if (this.bougieCourante !== null) {
          this.bougieCourante.closed = true;
          aEmettre.push({ ...this.bougieCourante });
        }
        this.bougieCourante = {
          time: bucket,
          open: tr.prix,
          high: tr.prix,
          low: tr.prix,
          close: tr.prix,
          volume: 0,
          buyVolume: 0,
          sellVolume: 0,
          closed: false,
        };
      }
      const c = this.bougieCourante;
      if (tr.prix > c.high) c.high = tr.prix;
      if (tr.prix < c.low) c.low = tr.prix;
      c.close = tr.prix;
      c.volume += tr.qty;
      if (tr.isBuyerMaker) c.sellVolume = (c.sellVolume ?? 0) + tr.qty;
      else c.buyVolume = (c.buyVolume ?? 0) + tr.qty;
    }
    if (tradesEmis.length === 0) return;
    // Bougie en formation (snapshot) émise APRÈS les clôtures : tous les buckets existent
    // dans le store avant les trades → le footprint retrouve son bucket par temps.
    if (this.bougieCourante !== null) aEmettre.push({ ...this.bougieCourante });
    for (const c of aEmettre) for (const cb of this.klineSubs) cb(c);
    for (const tr of tradesEmis) {
      const t = versTrade(tr);
      for (const cb of this.tradeSubs) cb(t);
    }
    // Rognage mémoire : on jette les trades déjà rejoués.
    if (this.idx > TRIM_SEUIL) {
      this.buffer.splice(0, this.idx);
      this.idx = 0;
    }
  }
}

// ─────────────────────────── Moteur/adaptateur ACTIF (consommé par le pipeline chart) ───────────────────────────

let _moteurActif: MoteurReplay | null = null;
let _adaptateurActif: IExchangeAdapter | null = null;

/** Façade IExchangeAdapter au-dessus d'un moteur (réutilise le pipeline chart existant). */
function facade(moteur: MoteurReplay): IExchangeAdapter {
  return {
    id: "binance",
    fetchKlines: (_symbol, _tf, opts) => moteur.seed(opts?.endTime),
    subscribeKline: (_symbol, _tf, cb) => moteur.abonnerKline(cb),
    subscribeTrades: (_symbol, cb) => moteur.abonnerTrades(cb),
  };
}

/** Définit (ou efface) le moteur actif. Appelé par le store au start/seek/stop. */
export function definirMoteurActif(moteur: MoteurReplay | null): void {
  _moteurActif = moteur;
  _adaptateurActif = moteur ? facade(moteur) : null;
}

/** Adaptateur du moteur actif, ou `null` si aucun replay en cours. */
export function adaptateurReplayActif(): IExchangeAdapter | null {
  return _adaptateurActif;
}

/** Moteur actif, ou `null` (contrôles de lecture pilotés par le store). */
export function moteurReplayActif(): MoteurReplay | null {
  return _moteurActif;
}
