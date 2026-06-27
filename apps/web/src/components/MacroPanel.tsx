/**
 * Panneau « Masse monétaire / Macro » — sidebar droite, sous le panneau Dérivés.
 *
 * Affiche trois mesures de liquidité, toutes via des fournisseurs gratuits :
 *   1. Cap. totale crypto (CoinGecko)      — INSTANTANÉ (le gratuit ne donne qu'un point).
 *   2. Supply agrégée stablecoins (DefiLlama) — série journalière → valeur + var. 30 j + mini-trend.
 *   3. M2 US (FRED, clé optionnelle)        — série hebdo → valeur + var. 30 j + mini-trend.
 *
 * Donnée BASSE fréquence : un fetch à l'ouverture + rafraîchissement périodique LARGE
 * (~15 min) + bouton de refresh manuel. Ces séries peuvent vivre dans le state React
 * (sanctionné par data/macro/types.ts — rien à voir avec les flux tick haute fréquence).
 *
 * GRACIEUX : chaque source est récupérée indépendamment (Promise.allSettled) ; un échec
 * affiche un message inline sur SA ligne sans bloquer les autres. Sans clé FRED, la ligne
 * M2 propose un champ de saisie (clé stockée localement, jamais affichée).
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { MacroSeries } from "../data/macro";
import { coinGeckoTotalProvider, fredM2WeeklyProvider, stablecoinsSupplyProvider } from "../data/macro";
import { fredKeyStore, getFredKey } from "../store/macro";
import { settingsUiStore } from "../store/settings-ui";
import { SidebarSection } from "./SidebarSection";

/** Rafraîchissement large (donnée macro basse fréquence). */
const REFRESH_MS = 15 * 60_000; // ~15 min.
/** Fenêtre d'historique récupérée pour les séries (var. + mini-trend). */
const FETCH_WINDOW_MS = 200 * 24 * 60 * 60 * 1000; // ~200 jours.
/** Fenêtre de calcul de la variation affichée. */
const VARIATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours.
/** Nombre de points max du mini-trend (sparkline). */
const SPARK_POINTS = 40;

/** Formatte un montant USD de façon compacte ($2.41T / $162.3B / $4.5M). */
function formatUsdCompact(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Variation (déjà en pourcentage) -> texte signé. */
function formatPct(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** Heure locale HH:MM d'un horodatage ms (libellé « maj … »). */
function formatClock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

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

/** Couleur d'une variation (vert hausse / rouge baisse / neutre). */
function pctColor(pct: number | undefined): string | undefined {
  if (pct === undefined || !Number.isFinite(pct)) return undefined;
  return pct >= 0 ? "#34d399" : "#f87171";
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
}: {
  label: string;
  note?: string;
  value: string;
  pct?: number;
  spark?: number[];
  error?: string | null;
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-neutral-500">{label}</span>
        {note && <span className="text-[10px] text-neutral-600">{note}</span>}
      </div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <span className="tabular-nums text-base text-neutral-100">{value}</span>
        <div className="flex items-center gap-2">
          {pct !== undefined && (
            <span className="tabular-nums text-[11px]" style={{ color: pctColor(pct) }}>
              {formatPct(pct)}
            </span>
          )}
          {spark && spark.length >= 2 && (
            <Sparkline values={spark} color={pctColor(pct) ?? "#737373"} />
          )}
        </div>
      </div>
      {error && <div className="mt-0.5 text-[11px] text-red-400">{error}</div>}
    </div>
  );
}

export function MacroPanel() {
  const hasKey = useStore(fredKeyStore, (s) => s.hasKey);
  // La saisie de la clé FRED vit désormais dans le panneau Réglages dédié.
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  const [total, setTotal] = useState<MacroSeries>([]);
  const [stables, setStables] = useState<MacroSeries>([]);
  const [m2, setM2] = useState<MacroSeries>([]);
  const [errTotal, setErrTotal] = useState<string | null>(null);
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
      const [tR, sR, mR] = await Promise.allSettled([
        coinGeckoTotalProvider.fetchSeries({ signal: controller.signal }),
        stablecoinsSupplyProvider.fetchSeries({ start, signal: controller.signal }),
        hasKey
          ? fredM2WeeklyProvider.fetchSeries({ start, apiKey: fredKey, signal: controller.signal })
          : Promise.resolve<MacroSeries>([]),
      ]);
      if (ignore) return;

      if (tR.status === "fulfilled") {
        setTotal(tR.value);
        setErrTotal(null);
      } else {
        setErrTotal("Indisponible");
      }

      if (sR.status === "fulfilled") {
        setStables(sR.value);
        setErrStables(null);
      } else {
        setErrStables("Indisponible");
      }

      if (hasKey) {
        if (mR.status === "fulfilled") {
          setM2(mR.value);
          setErrM2(mR.value.length === 0 ? "Série vide (clé invalide ?)" : null);
        } else {
          setErrM2("Indisponible");
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
  const totalValue = lastValue(total);
  const stablesValue = lastValue(stables);
  const stablesPct = changePct(stables, VARIATION_WINDOW_MS);
  const stablesSpark = stables.slice(-SPARK_POINTS).map((p) => p.value);

  const m2Last = lastValue(m2);
  const m2Pct = changePct(m2, VARIATION_WINDOW_MS);
  const m2Spark = m2.slice(-SPARK_POINTS).map((p) => p.value);

  return (
    <SidebarSection
      title="Masse monétaire"
      action={
        <button
          type="button"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="text-[10px] text-text-dim transition hover:text-text"
          title="Rafraîchir maintenant"
        >
          {loading ? "maj…" : `maj ${formatClock(updatedAt)} · ↻`}
        </button>
      }
    >
      {/* 1. Capitalisation totale crypto (instantané — pas d'historique en gratuit). */}
      <Measure
        label="Cap. totale crypto"
        note="instantané"
        value={formatUsdCompact(totalValue)}
        error={errTotal}
      />

      {/* 2. Supply agrégée des stablecoins (DefiLlama). */}
      <Measure
        label="Stablecoins (supply)"
        value={formatUsdCompact(stablesValue)}
        pct={stablesPct}
        spark={stablesSpark}
        error={errStables}
      />

      {/* 3. M2 US (FRED) — valeur native en milliards $, re-mise à l'échelle pour l'affichage compact. */}
      <div className="px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-neutral-500">M2 (US · FRED)</span>
        </div>

        {!hasKey ? (
          /* --- Sans clé FRED : renvoi vers les Réglages (le M2 reste optionnel) --- */
          <button
            type="button"
            onClick={openSettings}
            className="mt-1 rounded border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text-dim transition hover:text-text"
          >
            Configurer dans Réglages ⚙
          </button>
        ) : (
          /* --- Valeur M2 (milliards $ → $ absolu pour la notation compacte) --- */
          <>
            <div className="mt-0.5 flex items-end justify-between gap-2">
              <span className="tabular-nums text-base text-neutral-100">
                {formatUsdCompact(m2Last === undefined ? undefined : m2Last * 1e9)}
              </span>
              <div className="flex items-center gap-2">
                {m2Pct !== undefined && (
                  <span className="tabular-nums text-[11px]" style={{ color: pctColor(m2Pct) }}>
                    {formatPct(m2Pct)}
                  </span>
                )}
                {m2Spark.length >= 2 && (
                  <Sparkline values={m2Spark} color={pctColor(m2Pct) ?? "#737373"} />
                )}
              </div>
            </div>
            {errM2 && <div className="mt-0.5 text-[11px] text-red-400">{errM2}</div>}
          </>
        )}
      </div>

      <p className="border-t border-neutral-900 px-3 py-2 text-[10px] leading-snug text-neutral-600">
        Sources : CoinGecko (cap. crypto, instantané), DefiLlama (stablecoins), FRED (M2 US,
        clé gratuite). Variation ~30 j. Données basse fréquence, maj ~15 min.
      </p>
    </SidebarSection>
  );
}
