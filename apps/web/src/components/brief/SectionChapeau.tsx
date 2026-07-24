/**
 * Section BRIEF — chapeau interprété (H16) : régime + nuit + funding + vol, puis
 * lecture générée. Purement présentationnel : reçoit l'état du store regime.
 */
import { tonRegime, type Regime } from "../../data/regime";
import type { Chapeau } from "../../store/regime";
import { formatDec, formatFunding, formatPct, formatPourcentage } from "../../lib/format";
import { Metric, RefBadge } from "../ui";

interface Props {
  regime: Regime | null;
  chapeau: Chapeau | null;
  phrasesLecture: string[];
}

export function SectionChapeau({ regime, chapeau, phrasesLecture }: Props) {
  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric
          label="Régime"
          value={
            regime === null || regime.libelle === "indéterminé"
              ? "—"
              : `${regime.libelle} ${regime.score >= 0 ? "+" : ""}${formatDec(regime.score, 1)}`
          }
          couleur={
            regime === null
              ? undefined
              : tonRegime(regime.libelle) === "up"
                ? "var(--up)"
                : tonRegime(regime.libelle) === "down"
                  ? "var(--down)"
                  : undefined
          }
        />
        <Metric
          label="Nuit"
          value={chapeau?.nuitBtcPct !== null && chapeau !== null ? formatPct(chapeau.nuitBtcPct, 1) : "—"}
          couleur={
            chapeau?.nuitBtcPct != null
              ? chapeau.nuitBtcPct >= 0
                ? "var(--up)"
                : "var(--down)"
              : undefined
          }
          extra={
            chapeau?.nuitEthPct != null ? (
              <span className="text-[10px] tabular-nums text-text-dim">ETH {formatPct(chapeau.nuitEthPct, 1)}</span>
            ) : undefined
          }
        />
        <Metric
          label="Funding BTC"
          value={formatFunding(chapeau?.fundingBtcRate)}
          labelExtra={<RefBadge referentiel={chapeau?.fundingRef ?? null} sens="hausse-chaud" />}
        />
        {/* Convention couleur Vol : DVOL en HAUSSE = stress → --down ; en baisse → --up. */}
        <Metric
          label="Vol (DVOL)"
          labelExtra={<RefBadge referentiel={chapeau?.dvolRef ?? null} sens="hausse-chaud" />}
          value={chapeau?.dvolCourant != null ? formatPourcentage(chapeau.dvolCourant, 1) : "—"}
          couleur={
            chapeau?.dvolDeltaPts != null
              ? chapeau.dvolDeltaPts >= 0
                ? "var(--down)"
                : "var(--up)"
              : undefined
          }
          extra={
            chapeau?.dvolDeltaPts != null ? (
              <span className="text-[10px] tabular-nums text-text-dim">
                {chapeau.dvolDeltaPts >= 0 ? "+" : ""}
                {formatDec(chapeau.dvolDeltaPts, 1)} pts vs veille
              </span>
            ) : undefined
          }
        />
      </div>
      {phrasesLecture.length > 0 && (
        <p className="text-[12px] leading-snug text-text">{phrasesLecture.join(" ")}</p>
      )}
    </section>
  );
}
