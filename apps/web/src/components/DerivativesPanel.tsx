/**
 * Panneau « Dérivés » — sidebar droite, sous la watchlist.
 *
 * Affiche, pour le symbole courant (mappé sur le perpétuel Binance Coinalyze) :
 * Open Interest, Funding rate, Long/Short ratio et les liquidations récentes.
 * Source : provider Coinalyze (tier gratuit). Rafraîchissement périodique
 * (~1 min, conforme à la latence du dérivé lent et au débit 40 req/min).
 *
 * Sans clé API : aucun appel, aucune erreur bloquante — le panneau invite à
 * saisir une clé (stockée localement, jamais loggée).
 *
 * Étiquette explicite « liquidations échantillonnées / cumul approx. » : Coinalyze
 * agrège les liquidations par intervalle (volume long/short), il n'y a pas
 * d'événements unitaires — cf. critique §4 (forceOrder throttle Binance).
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { FundingRate, Liquidation, LongShortRatio, OpenInterest } from "@axiom/types";
import { marketStore } from "../store/market";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { CoinalyzeError, coinalyzeProvider, toCoinalyzeSymbol } from "../data/coinalyze";

/** Période d'agrégation du long/short ratio et fenêtre des liquidations affichées. */
const LS_PERIOD = "5min";
const LIQ_WINDOW_MS = 60 * 60 * 1000; // 1 h de liquidations récentes.
const REFRESH_MS = 60_000; // ~1 min (respecte le rate-limit).
const MAX_LIQ_ROWS = 8;
/** Libellé humain de l'intervalle d'agrégation des liquidations (affiché dans l'étiquette). */
const LIQ_INTERVAL_LABEL = "5 min";

/** Formatte un notionnel USD de façon compacte ($1.23B / $4.5M / $678K). */
function formatUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Funding rate (fraction) -> pourcentage signé. */
function formatFunding(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(4)}%`;
}

/** HH:MM:SS local d'un horodatage ms. */
function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("fr-FR", { hour12: false });
}

/** Une ligne « libellé / valeur ». */
function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between px-3 py-1.5">
      <span className="text-[11px] text-neutral-500">{label}</span>
      <span className="tabular-nums text-sm" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function DerivativesPanel() {
  const symbol = useStore(marketStore, (s) => s.symbol);
  const hasKey = useStore(coinalyzeKeyStore, (s) => s.hasKey);
  const setKey = useStore(coinalyzeKeyStore, (s) => s.setKey);
  const clearKey = useStore(coinalyzeKeyStore, (s) => s.clearKey);

  // Brouillon du champ clé (jamais loggé, jamais persisté dans le state global).
  const [draftKey, setDraftKey] = useState("");
  const [editing, setEditing] = useState(false);

  const [oi, setOi] = useState<OpenInterest | undefined>();
  const [funding, setFunding] = useState<FundingRate | undefined>();
  const [ls, setLs] = useState<LongShortRatio | undefined>();
  const [liqs, setLiqs] = useState<Liquidation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Pas de clé : on n'appelle rien et on réinitialise l'affichage.
    if (!hasKey) {
      setOi(undefined);
      setFunding(undefined);
      setLs(undefined);
      setLiqs([]);
      setError(null);
      return;
    }

    // Garde LOCALE à cet effet (capturée par chaque `load`) : empêche un setState
    // après changement de symbole/clé ou démontage — les réponses tardives du
    // throttle ne peignent PAS les données d'un symbole obsolète.
    let ignore = false;

    const load = async () => {
      setLoading(true);
      const results = await Promise.allSettled([
        coinalyzeProvider.fetchOpenInterest(symbol),
        coinalyzeProvider.fetchFundingRate(symbol),
        coinalyzeProvider.fetchLongShortRatio(symbol, LS_PERIOD),
        coinalyzeProvider.fetchLiquidations(symbol, Date.now() - LIQ_WINDOW_MS),
      ]);
      if (ignore) return;

      const [oiR, fR, lsR, liqR] = results;
      let authError = false;
      const noteError = (r: PromiseSettledResult<unknown>) => {
        if (r.status === "rejected" && r.reason instanceof CoinalyzeError && r.reason.status === 401) {
          authError = true;
        }
      };
      results.forEach(noteError);

      setOi(oiR.status === "fulfilled" ? oiR.value : undefined);
      setFunding(fR.status === "fulfilled" ? fR.value : undefined);
      setLs(lsR.status === "fulfilled" ? lsR.value : undefined);
      setLiqs(liqR.status === "fulfilled" ? liqR.value : []);

      const allFailed = results.every((r) => r.status === "rejected");
      if (authError) setError("Clé Coinalyze refusée (401). Vérifiez la clé.");
      else if (allFailed) setError("Données dérivées indisponibles pour le moment.");
      else setError(null);

      setLoading(false);
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [symbol, hasKey]);

  const saveKey = () => {
    setKey(draftKey);
    setDraftKey("");
    setEditing(false);
  };

  const coinalyzeSymbol = toCoinalyzeSymbol(symbol);

  // Liquidations les plus récentes en tête.
  const recentLiqs = liqs.slice(-MAX_LIQ_ROWS).reverse();

  return (
    <section className="flex shrink-0 flex-col border-t border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Dérivés</span>
        {hasKey && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] text-neutral-600 hover:text-neutral-300"
          >
            clé ✓ · modifier
          </button>
        )}
      </div>

      {!hasKey || editing ? (
        /* --- Réglage de la clé (aucune erreur bloquante sans clé) --- */
        <div className="space-y-2 px-3 py-3 text-xs text-neutral-400">
          <p>
            Saisissez une clé API Coinalyze (gratuite, sur coinalyze.net) pour afficher Open Interest,
            funding, long/short et liquidations.
          </p>
          <input
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveKey();
            }}
            placeholder="Clé API Coinalyze"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveKey}
              className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-medium text-neutral-950 hover:bg-emerald-400"
            >
              Enregistrer
            </button>
            {hasKey && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraftKey("");
                  }}
                  className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearKey();
                    setEditing(false);
                    setDraftKey("");
                  }}
                  className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-red-400 hover:bg-neutral-700"
                >
                  Supprimer
                </button>
              </>
            )}
          </div>
          <p className="text-[10px] text-neutral-600">
            Stockée localement (localStorage), envoyée uniquement à api.coinalyze.net.
          </p>
        </div>
      ) : (
        /* --- Données dérivées --- */
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-3 py-1 text-[10px] text-neutral-600">
            <span>{coinalyzeSymbol}</span>
            <span>{loading ? "maj…" : "maj ~1 min"}</span>
          </div>

          {error && <div className="px-3 py-1 text-[11px] text-red-400">{error}</div>}

          <Metric label="Open Interest" value={formatUsd(oi?.oiUsd)} />
          <Metric
            label="Funding"
            value={formatFunding(funding?.rate)}
            color={
              funding && Number.isFinite(funding.rate)
                ? funding.rate >= 0
                  ? "#34d399"
                  : "#f87171"
                : undefined
            }
          />
          <Metric
            label="Long / Short"
            value={
              ls && Number.isFinite(ls.ratio)
                ? `${ls.ratio.toFixed(2)} · L ${ls.longAccount.toFixed(1)}% / S ${ls.shortAccount.toFixed(1)}%`
                : "—"
            }
          />

          <div className="mt-1 border-t border-neutral-900 px-3 py-1 text-[11px] text-neutral-500">
            Liquidations récentes
          </div>
          <div className="max-h-40 overflow-y-auto">
            {recentLiqs.length === 0 ? (
              <div className="px-3 py-1.5 text-[11px] text-neutral-600">Aucune sur la dernière heure.</div>
            ) : (
              recentLiqs.map((l, i) => (
                <div
                  key={`${l.time}-${l.side}-${i}`}
                  className="flex items-baseline justify-between px-3 py-1 text-[11px]"
                >
                  <span className="tabular-nums text-neutral-600">{formatTime(l.time)}</span>
                  <span
                    className="font-medium uppercase"
                    style={{ color: l.side === "long" ? "#f87171" : "#34d399" }}
                  >
                    {l.side}
                  </span>
                  <span className="tabular-nums text-neutral-300">{formatUsd(l.qtyUsd)}</span>
                </div>
              ))
            )}
          </div>

          <p className="border-t border-neutral-900 px-3 py-2 text-[10px] leading-snug text-neutral-600">
            Liquidations échantillonnées / cumul approx. — Coinalyze agrège par intervalle
            ({LIQ_INTERVAL_LABEL}) ; pas d'événements unitaires ni de prix.
          </p>
        </div>
      )}
    </section>
  );
}
