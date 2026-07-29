/**
 * Store HISTORIQUE de la capitalisation totale crypto — Zustand VANILLA + persistance.
 *
 * POURQUOI : CoinGecko gratuit (/global) ne renvoie qu'un INSTANTANÉ ; l'agrégat
 * historique (/global/market_cap_chart) est réservé au tier PRO (401 vérifié). On
 * ÉCHANTILLONNE donc périodiquement l'instantané et on PERSISTE une série locale.
 *
 * ✅ BACKFILL (corrigé le 2026-07-29) : l'historique PAR PIÈCE, lui, est gratuit
 * (`/coins/{id}/market_chart`, 365 jours max — au-delà, 401 error_code 10012). La
 * fenêtre CAP reconstruit donc une année de TOTAL/TOTAL2/TOTAL3 par somme du top 100
 * recalibrée sur /global (cf. data/mcap.ts) et l'injecte ici via `seed`. La série ne
 * démarre plus vide. L'ancienne affirmation « aucun backfill possible en gratuit »
 * était fausse : c'est l'AGRÉGAT qui est payant, pas les pièces.
 *
 * ⚠️ COMPACTION : sans elle, `MAX_POINTS` (1 500) face à un poller de 5 min
 * (288 points/jour) plafonnait l'historique à 5,2 JOURS — l'accumulation « vers
 * l'avant » ne pouvait donc pas produire d'historique long, et le backfill aurait été
 * évincé en cinq jours. Au-delà de 48 h, on ne conserve qu'un point par jour UTC.
 *
 * SOURCE UNIQUE : le panneau Macro ET l'overlay du graphe lisent cette MÊME série
 * (pas d'échantillonnage concurrent). Un seul poller central (startMacroHistoryPolling,
 * appelé depuis main.tsx) alimente le store, indépendamment de l'affichage des panneaux.
 */
import { createStore } from "zustand/vanilla";
import { fetchGlobalMcapSnapshot, type McapMeasure } from "../data/macro/coingecko";
import { minuitUtc } from "../data/mcap";
import type { MacroSeries } from "../data/macro/types";

const STORAGE_KEY = "axiom:macroHistory:v1";
/** Borne du tampon circulaire (≈ borne stockage/perf). Exportée pour les tests. */
export const MAX_POINTS = 1500;
/** Ancienneté au-delà de laquelle un jour est réduit à son dernier échantillon. */
const FENETRE_DETAIL_MS = 48 * 60 * 60_000;
/** Espacement minimal entre deux points enregistrés (anti-doublon / anti-spam refresh). */
const MIN_GAP_MS = 4 * 60_000;
/** Cadence du poller central. */
const POLL_MS = 5 * 60_000;

/** Un échantillon des trois mesures de capitalisation à un instant donné. */
export interface McapSnapshot {
  /** ms epoch — instant d'ÉCHANTILLONNAGE (pas l'`updated_at` CoinGecko, pour garantir une série monotone). */
  t: number;
  total: number;
  total2: number;
  total3: number;
}

/** Lecture tolérante (localStorage indisponible / JSON corrompu => série vide). */
function read(): McapSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is McapSnapshot =>
        !!p &&
        typeof p === "object" &&
        Number.isFinite((p as McapSnapshot).t) &&
        Number.isFinite((p as McapSnapshot).total)
    );
  } catch {
    return [];
  }
}

/** Écriture tolérante (quota / mode privé => silencieux). */
function write(snaps: McapSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snaps));
  } catch {
    /* best-effort : la persistance n'est pas bloquante */
  }
}

/**
 * Compacte une série triée : tous les échantillons des dernières 48 h sont conservés,
 * les jours plus anciens sont réduits à leur DERNIER échantillon, puis la série est
 * bornée à `MAX_POINTS` (les plus récents gagnent). PURE — testée sans store.
 *
 * C'est ce qui rend l'historique long possible : 288 échantillons/jour ne consomment
 * plus qu'un point par jour passé, contre 288 auparavant.
 */
export function compacter(
  snaps: readonly McapSnapshot[],
  maintenant: number
): McapSnapshot[] {
  const seuil = maintenant - FENETRE_DETAIL_MS;
  const parJour = new Map<number, McapSnapshot>();
  const recents: McapSnapshot[] = [];

  for (const s of snaps) {
    if (s.t >= seuil) recents.push(s);
    else parJour.set(minuitUtc(s.t), s); // le dernier échantillon du jour l'emporte
  }

  return [...parJour.values(), ...recents]
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_POINTS);
}

export interface MacroHistoryState {
  snapshots: McapSnapshot[];
  /** Ajoute un échantillon (ignoré si trop proche du dernier), persiste, compacte. */
  record: (total: number, total2: number, total3: number) => void;
  /**
   * Injecte un historique reconstruit (backfill CAP) : n'ajoute que les jours NON
   * déjà couverts, ne remplace donc jamais un échantillon temps réel par un point
   * journalier, puis compacte. No-op si rien de neuf.
   */
  seed: (points: readonly McapSnapshot[]) => void;
}

export const macroHistoryStore = createStore<MacroHistoryState>((set, get) => ({
  snapshots: read(),

  record: (total, total2, total3) => {
    if (!Number.isFinite(total)) return;
    const now = Date.now();
    const cur = get().snapshots;
    const last = cur[cur.length - 1];
    if (last && now - last.t < MIN_GAP_MS) return; // espacement minimal respecté
    const next = compacter([...cur, { t: now, total, total2, total3 }], now);
    write(next);
    set({ snapshots: next });
  },

  seed: (points) => {
    const cur = get().snapshots;
    const joursCouverts = new Set(cur.map((s) => minuitUtc(s.t)));
    const ajouts = points.filter(
      (p) =>
        Number.isFinite(p.t) && Number.isFinite(p.total) && !joursCouverts.has(minuitUtc(p.t))
    );
    if (ajouts.length === 0) return;
    const next = compacter([...cur, ...ajouts], Date.now());
    write(next);
    set({ snapshots: next });
  },
}));

/** Série temporelle (time/value) d'une mesure, prête pour le graphe / la sparkline. */
export function macroHistorySeries(measure: McapMeasure): MacroSeries {
  return macroHistoryStore.getState().snapshots.map((s) => ({ time: s.t, value: s[measure] }));
}

/** Récupère un instantané CoinGecko et l'enregistre (silencieux en cas d'échec réseau). */
export async function recordGlobalSnapshotNow(signal?: AbortSignal): Promise<void> {
  try {
    const snap = await fetchGlobalMcapSnapshot({ signal });
    macroHistoryStore.getState().record(snap.total, snap.total2, snap.total3);
  } catch (err) {
    console.warn("[AXIOM] Échantillon cap. totale crypto indisponible", err);
  }
}

/**
 * Démarre l'échantillonnage central (immédiat puis toutes les ~5 min). Appelé une
 * fois au boot (main.tsx). Renvoie une fonction d'arrêt (le poller vit toute la session).
 */
export function startMacroHistoryPolling(): () => void {
  void recordGlobalSnapshotNow();
  const timer = setInterval(() => void recordGlobalSnapshotNow(), POLL_MS);
  return () => clearInterval(timer);
}
