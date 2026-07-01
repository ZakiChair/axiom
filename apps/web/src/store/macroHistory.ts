/**
 * Store HISTORIQUE de la capitalisation totale crypto — Zustand VANILLA + persistance.
 *
 * POURQUOI : CoinGecko gratuit (/global) ne renvoie qu'un INSTANTANÉ ; l'historique
 * (/global/market_cap_chart) est réservé au tier PRO (401 vérifié). Pour voir
 * l'ÉVOLUTION dans le temps sans payer, on ÉCHANTILLONNE périodiquement l'instantané
 * et on PERSISTE une série locale (cf. limite documentée dans data/macro/coingecko.ts).
 *
 * ⚠️ L'historique se construit VERS L'AVANT depuis le premier lancement : la série
 * est courte au début et s'étoffe au fil des sessions. Aucun backfill possible en
 * gratuit (sources empiriquement écartées).
 *
 * SOURCE UNIQUE : le panneau Macro ET l'overlay du graphe lisent cette MÊME série
 * (pas d'échantillonnage concurrent). Un seul poller central (startMacroHistoryPolling,
 * appelé depuis main.tsx) alimente le store, indépendamment de l'affichage des panneaux.
 */
import { createStore } from "zustand/vanilla";
import { fetchGlobalMcapSnapshot, type McapMeasure } from "../data/macro/coingecko";
import type { MacroSeries } from "../data/macro/types";

const STORAGE_KEY = "axiom:macroHistory:v1";
/** Borne du tampon circulaire (≈ borne stockage/perf). */
const MAX_POINTS = 1500;
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

export interface MacroHistoryState {
  snapshots: McapSnapshot[];
  /** Ajoute un échantillon (ignoré si trop proche du dernier), persiste, borne la taille. */
  record: (total: number, total2: number, total3: number) => void;
}

export const macroHistoryStore = createStore<MacroHistoryState>((set, get) => ({
  snapshots: read(),

  record: (total, total2, total3) => {
    if (!Number.isFinite(total)) return;
    const now = Date.now();
    const cur = get().snapshots;
    const last = cur[cur.length - 1];
    if (last && now - last.t < MIN_GAP_MS) return; // espacement minimal respecté
    const next = [...cur, { t: now, total, total2, total3 }].slice(-MAX_POINTS);
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
