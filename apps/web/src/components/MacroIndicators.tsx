/**
 * Contenu de l'onglet « Macro » du menu Indicateurs (ex-panneau « Masse monétaire »
 * de la sidebar droite, déplacé pour ne plus consommer de place latérale).
 *
 * Affiche trois mesures de liquidité, toutes via des fournisseurs gratuits :
 *   1. Cap. totale crypto (CoinGecko)      — INSTANTANÉ (le gratuit ne donne qu'un point).
 *   2. Supply agrégée stablecoins (DefiLlama) — série journalière → valeur + var. 30 j + mini-trend.
 *   3. M2 US (FRED, clé optionnelle)        — série hebdo → valeur + var. 30 j + mini-trend.
 *
 * Chaque case à cocher pilote `macroOverlayStore`, donc le pane macro du graphe
 * (chart/macro.ts) — c'est ce qui fait de ces mesures des INDICATEURS et justifie
 * leur place dans ce menu plutôt que dans la sidebar.
 *
 * ⚠️ La case M2 reste ACTIVE même sans clé FRED perso : le proxy `/fredapi` injecte une
 * clé de repli (.env), donc l'overlay du graphe fonctionne. Seule la LECTURE CHIFFRÉE
 * est conditionnée à `hasKey` et renvoie vers les Réglages.
 *
 * Donnée BASSE fréquence : un fetch à l'ouverture + rafraîchissement périodique LARGE
 * (~15 min) + bouton de refresh manuel. Ces séries peuvent vivre dans le state React
 * (sanctionné par data/macro/types.ts — rien à voir avec les flux tick haute fréquence).
 *
 * GRACIEUX : chaque source est récupérée indépendamment (Promise.allSettled) ; un échec
 * affiche un message inline sur SA ligne sans bloquer les autres.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { lireTokensCanvas } from "../lib/canvasTokens";
import { formatHeureMinute, formatPct, formatUsd } from "../lib/format";
import type { MacroSeries } from "../data/macro";
import { fredM2WeeklyProvider, stablecoinsSupplyProvider } from "../data/macro";
import { fredKeyStore, getFredKey } from "../store/macro";
import { macroHistoryStore, recordGlobalSnapshotNow } from "../store/macroHistory";
import { macroOverlayStore, type MacroOverlayId } from "../store/macro-overlays";

/** Rafraîchissement large (donnée macro basse fréquence). */
const REFRESH_MS = 15 * 60_000; // ~15 min.
/** Fenêtre d'historique récupérée pour les séries (var. + mini-trend). */
const FETCH_WINDOW_MS = 200 * 24 * 60 * 60 * 1000; // ~200 jours.
/** Fenêtre de calcul de la variation affichée. */
const VARIATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours.
/** Nombre de points max du mini-trend (sparkline). */
const SPARK_POINTS = 40;

/** Dernier point d'une série triée croissante (ou undefined si vide). */
function lastValue(series: MacroSeries): number | undefined {
  const p = series.length > 0 ? series[series.length - 1] : undefined;
  return p?.value;
}

/**
 * Variation en % sur ~`windowMs` : compare le dernier point au dernier point
 * antérieur ou égal à (dernier.time − windowMs), à défaut au premier point.
 * Indépendant de l'échelle des valeurs (utilisable sur valeurs brutes).
 */
function changePct(series: MacroSeries, windowMs: number): number | undefined {
  const last = series.length > 0 ? series[series.length - 1] : undefined;
  if (!last) return undefined;
  const refTime = last.time - windowMs;
  let ref = series[0]; // MacroPoint | undefined (noUncheckedIndexedAccess)
  for (const p of series) {
    if (p.time <= refTime) ref = p;
    else break;
  }
  if (!ref || ref.value === 0 || !Number.isFinite(ref.value)) return undefined;
  return ((last.value - ref.value) / ref.value) * 100;
}

/**
 * Couleur JS d'un mini-trend, lue sur le thème courant AU RENDU (les SVG ne
 * voient pas les classes Tailwind). Repli sur --text-dim quand la variation
 * est absente ; les hex de repli couvrent le cas où un token serait vide.
 */
function couleurTrend(pct: number | undefined): string {
  const { "--up": up, "--down": down, "--text-dim": dim } = lireTokensCanvas([
    "--up",
    "--down",
    "--text-dim",
  ]);
  if (pct === undefined || !Number.isFinite(pct)) return dim || "#737373";
  return pct >= 0 ? up || "#34d399" : down || "#f87171";
}

/** Mini-trend SVG (polyline) — rien si moins de 2 points. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 60;
  const h = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}

/** Une mesure macro : libellé, valeur, variation + mini-trend optionnels, erreur inline. */
function Measure({
  label,
  note,
  value,
  pct,
  spark,
  error,
  active,
  onToggle,
}: {
  label: string;
  note?: string;
  value: string;
  pct?: number;
  spark?: number[];
  error?: string | null;
  active?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-text-dim">
          {onToggle && (
            <input
              type="checkbox"
              checked={active ?? false}
              onChange={onToggle}
              className="h-3 w-3 accent-accent"
            />
          )}
          <span>{label}</span>
        </label>
        {note && <span className="text-[10px] text-text-dim/70">{note}</span>}
      </div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <span className="tabular-nums text-base text-text">{value}</span>
        <div className="flex items-center gap-2">
          {pct !== undefined && (
            <span className={`tabular-nums text-[11px] ${pct >= 0 ? "text-up" : "text-down"}`}>
              {formatPct(pct)}
            </span>
          )}
          {spark && spark.length >= 2 && (
            <Sparkline values={spark} color={couleurTrend(pct)} />
          )}
        </div>
      </div>
      {error && <div className="mt-0.5 text-[11px] text-down">{error}</div>}
    </div>
  );
}

export function MacroIndicators({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  const hasKey = useStore(fredKeyStore, (s) => s.hasKey);
  const activeMacros = useStore(macroOverlayStore, (s) => s.enabled);
  const toggleMacro = useStore(macroOverlayStore, (s) => s.toggle);
  const isMacroActive = (id: MacroOverlayId) => activeMacros.includes(id);

  // Cap. totale crypto : série persistée (échantillonnée par le poller central lancé
  // depuis main.tsx, pas ici) — voir store/macroHistory.ts. Le composant se re-rend
  // quand un nouvel échantillon arrive.
  const snapshots = useStore(macroHistoryStore, (s) => s.snapshots);

  const [stables, setStables] = useState<MacroSeries>([]);
  const [m2, setM2] = useState<MacroSeries>([]);
  const [errStables, setErrStables] = useState<string | null>(null);
  const [errM2, setErrM2] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Incrémenté par le bouton « rafraîchir » : relance l'effet (fetch immédiat + reset du timer).
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // Garde locale : empêche un setState après démontage / changement de clé.
    let ignore = false;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      const start = Date.now() - FETCH_WINDOW_MS;
      const fredKey = hasKey ? (getFredKey() ?? undefined) : undefined;

      // Array LITTÉRAL passé directement à allSettled => type tuple précis (pas de | undefined).
      // (La cap. totale crypto est échantillonnée à part par le poller central.)
      const [sR, mR] = await Promise.allSettled([
        stablecoinsSupplyProvider.fetchSeries({ start, signal: controller.signal }),
        hasKey
          ? fredM2WeeklyProvider.fetchSeries({ start, apiKey: fredKey, signal: controller.signal })
          : Promise.resolve<MacroSeries>([]),
      ]);
      if (ignore) return;

      if (sR.status === "fulfilled") {
        setStables(sR.value);
        setErrStables(null);
      } else {
        setErrStables("Stablecoins indisponibles pour le moment.");
      }

      if (hasKey) {
        if (mR.status === "fulfilled") {
          setM2(mR.value);
          setErrM2(
            mR.value.length === 0 ? "M2 indisponible pour le moment (clé FRED invalide ?)." : null,
          );
        } else {
          setErrM2("M2 indisponible pour le moment.");
        }
      } else {
        setM2([]);
        setErrM2(null);
      }

      setUpdatedAt(Date.now());
      setLoading(false);
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);

    return () => {
      ignore = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [hasKey, refreshTick]);

  // Valeurs dérivées des séries.
  // Cap. totale crypto : reconstruite depuis les snapshots persistés (évolution locale).
  const totalSeries: MacroSeries = snapshots.map((s) => ({ time: s.t, value: s.total }));
  const totalValue = lastValue(totalSeries);
  const totalPct = changePct(totalSeries, VARIATION_WINDOW_MS);
  const totalSpark = totalSeries.slice(-SPARK_POINTS).map((p) => p.value);

  const stablesValue = lastValue(stables);
  const stablesPct = changePct(stables, VARIATION_WINDOW_MS);
  const stablesSpark = stables.slice(-SPARK_POINTS).map((p) => p.value);

  const m2Last = lastValue(m2);
  const m2Pct = changePct(m2, VARIATION_WINDOW_MS);
  const m2Spark = m2.slice(-SPARK_POINTS).map((p) => p.value);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* En-tête : rôle de l'onglet + refresh manuel (ex-`action` de SidebarSection).
          Libellé court à dessein : au-delà, il passe sur deux lignes dans le panneau
          (w-72) et bouscule l'horodatage de mise à jour — constaté à l'écran. */}
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="shrink-0 text-[11px] text-text-dim">Tracer sur le graphe</span>
        <button
          type="button"
          onClick={() => {
            setRefreshTick((t) => t + 1);
            void recordGlobalSnapshotNow();
          }}
          className="text-[10px] text-text-dim transition hover:text-text"
          title="Rafraîchir maintenant"
        >
          {loading ? "maj…" : `maj ${updatedAt ? formatHeureMinute(updatedAt) : "—"} · ↻`}
        </button>
      </div>

      {/* 1. Cap. totale crypto — série échantillonnée localement (le gratuit ne donne
            qu'un instantané) : variation ~30 j + mini-trend se construisent dans le temps. */}
      <Measure
        label="Cap. totale crypto"
        note={totalSeries.length < 2 ? "accumulation…" : "évolution locale"}
        value={formatUsd(totalValue)}
        pct={totalPct}
        spark={totalSpark}
        active={isMacroActive("crypto-total")}
        onToggle={() => toggleMacro("crypto-total")}
      />

      {/* 2. Supply agrégée des stablecoins (DefiLlama). */}
      <Measure
        label="Stablecoins (supply)"
        value={formatUsd(stablesValue)}
        pct={stablesPct}
        spark={stablesSpark}
        error={errStables}
        active={isMacroActive("stablecoins")}
        onToggle={() => toggleMacro("stablecoins")}
      />

      {/* 3. M2 US (FRED) — valeur native en milliards $, re-mise à l'échelle pour l'affichage compact. */}
      <div className="px-3 py-2">
        <div className="flex items-baseline justify-between">
          <label className="flex items-center gap-1.5 text-[11px] text-text-dim">
            <input
              type="checkbox"
              checked={isMacroActive("m2")}
              onChange={() => toggleMacro("m2")}
              className="h-3 w-3 accent-accent"
            />
            <span>M2 (US · FRED)</span>
          </label>
        </div>

        {!hasKey ? (
          /* --- Sans clé FRED : renvoi vers les Réglages (le M2 reste optionnel, et
                 l'overlay du graphe marche déjà via la clé de repli du proxy). --- */
          <button
            type="button"
            onClick={onOuvrirReglages}
            className="mt-1 text-[11px] text-accent hover:underline"
          >
            Clé FRED — Réglages ⚙
          </button>
        ) : (
          /* --- Valeur M2 (milliards $ → $ absolu pour la notation compacte) --- */
          <>
            <div className="mt-0.5 flex items-end justify-between gap-2">
              <span className="tabular-nums text-base text-text">
                {formatUsd(m2Last === undefined ? undefined : m2Last * 1e9)}
              </span>
              <div className="flex items-center gap-2">
                {m2Pct !== undefined && (
                  <span
                    className={`tabular-nums text-[11px] ${m2Pct >= 0 ? "text-up" : "text-down"}`}
                  >
                    {formatPct(m2Pct)}
                  </span>
                )}
                {m2Spark.length >= 2 && (
                  <Sparkline values={m2Spark} color={couleurTrend(m2Pct)} />
                )}
              </div>
            </div>
            {errM2 && <div className="mt-0.5 text-[11px] text-down">{errM2}</div>}
          </>
        )}
      </div>

      <p className="border-t border-border px-3 py-2 text-[10px] leading-snug text-text-dim">
        Sources : CoinGecko (cap. crypto, échantillonnée localement — le gratuit n'a pas
        d'historique, la courbe se construit dans le temps), DefiLlama (stablecoins), FRED
        (M2 US). Variation ~30 j. Données basse fréquence, maj ~15 min.
      </p>
    </div>
  );
}
