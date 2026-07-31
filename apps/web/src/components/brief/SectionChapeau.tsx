/**
 * Section BRIEF — chapeau interprété (H16) : régime + nuit + funding + vol +
 * γ dealers, puis lecture générée. Purement présentationnel : reçoit l'état du
 * store regime.
 */
import { tonRegime, type Regime } from "../../data/regime";
import type { Chapeau } from "../../store/regime";
import { formatDec, formatFunding, formatPct, formatPourcentage, formatUsdSigne } from "../../lib/format";
import { TuileStat, RefBadge, Badge } from "../ui";

interface Props {
  regime: Regime | null;
  chapeau: Chapeau | null;
  phrasesLecture: string[];
}

export function SectionChapeau({ regime, chapeau, phrasesLecture }: Props) {
  return (
    <section className="flex flex-col gap-2">
      {/* grid-cols-2 fixe (pas de md:grid-cols-4) : le seuil `md:` réagit à la largeur du
          VIEWPORT, pas à celle de la fenêtre flottante (BRIEF = 480px par défaut), donc
          4 colonnes s'activaient même sur une fenêtre étroite et écrasaient les tuiles
          (libellé + badge + valeur) — gate visuel 2026-07-29, anomalie 1. */}
      <div className="grid grid-cols-2 gap-2">
        <TuileStat
          disposition="inline"
          label="Régime"
          valeur={
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
        <TuileStat
          disposition="inline"
          label="Nuit"
          valeur={chapeau?.nuitBtcPct !== null && chapeau !== null ? formatPct(chapeau.nuitBtcPct, 1) : "—"}
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
        <TuileStat
          disposition="inline"
          label="Funding BTC"
          valeur={formatFunding(chapeau?.fundingBtcRate)}
          badge={<RefBadge referentiel={chapeau?.fundingRef ?? null} sens="hausse-chaud" />}
        />
        {/* Convention couleur Vol : DVOL en HAUSSE = stress → --down ; en baisse → --up. */}
        <TuileStat
          disposition="inline"
          label="Vol (DVOL)"
          badge={<RefBadge referentiel={chapeau?.dvolRef ?? null} sens="hausse-chaud" />}
          valeur={chapeau?.dvolCourant != null ? formatPourcentage(chapeau.dvolCourant, 1) : "—"}
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
        {/* Verdict gamma dealer (OMON v2.6) : long gamma = mouvements amortis (up),
            short gamma = amplifiés (down) — la note DÉCRIT, elle ne conseille pas. */}
        <TuileStat
          disposition="inline"
          label="γ dealers"
          badge={<Badge>BTC · toutes échéances</Badge>}
          valeur={
            chapeau?.regimeGamma === "long-gamma"
              ? "Long gamma — amorti"
              : chapeau?.regimeGamma === "short-gamma"
                ? "Short gamma — amplifié"
                : "—"
          }
          ton={
            chapeau?.regimeGamma === "long-gamma"
              ? "up"
              : chapeau?.regimeGamma === "short-gamma"
                ? "down"
                : undefined
          }
          title={
            "Hypothèse dealer (convention retail) : dealers long les calls, short les puts. " +
            "GEX net Deribit BTC, toutes échéances" +
            (chapeau?.distanceFlipPct != null
              ? ` · spot vs gamma flip ${formatPct(chapeau.distanceFlipPct, 1)}`
              : "") +
            "."
          }
          extra={
            chapeau?.gexNetUsd != null &&
            Number.isFinite(chapeau.gexNetUsd) &&
            chapeau.regimeGamma !== null ? (
              <span className="text-[10px] tabular-nums text-text-dim">
                net {formatUsdSigne(chapeau.gexNetUsd)}
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
