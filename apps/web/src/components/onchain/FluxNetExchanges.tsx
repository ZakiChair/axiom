import { useMemo } from "react";
import type { PointMetrique } from "../../data/onchain/coinmetrics";
import { resumerFluxNet } from "../../data/onchain/fluxExchangesCm";
import { formatDec, formatEntier, formatUsdSigne } from "../../lib/format";
import { Badge, TuileStat, Vide } from "../ui";
import { CourbeOnchain } from "./HistoriqueCommun";

/** Somme native signée (« +2 738 BTC ») ; « — » si la fenêtre est incomplète. */
function fluxSigne(v: number | null, actif: string): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${formatEntier(v)} ${actif}`;
}

/**
 * Flux nets quotidiens des exchanges (labels Coin Metrics) : sommes 1/7/30 j en natif et,
 * si la série USD est fournie, en USD ; z du flux 30 j sur 730 j ; courbe des 120 derniers jours.
 * Vue pure partagée BTC / ETH, sans titre (le parent porte la section et la note de source).
 */
export function VueFluxNetExchanges({ actif, net, netUsd, flash, loading = false }: {
  actif: "BTC" | "ETH"; net: readonly PointMetrique[]; netUsd?: readonly PointMetrique[]; flash: boolean; loading?: boolean;
}) {
  const r = useMemo(() => resumerFluxNet(net, netUsd), [net, netUsd]);
  if (net.length === 0) {
    return <Vide>{loading ? "Chargement des flux Coin Metrics…" : "Flux exchanges indisponibles (Coin Metrics)."}</Vide>;
  }
  const badge = flash ? <Badge ton="warn">flash</Badge> : undefined;
  const usd = (v: number | null) => (netUsd === undefined ? undefined : formatUsdSigne(v));
  return <div className="space-y-1">
    <div className="grid grid-cols-2 gap-2">
      <TuileStat label="Flux net 1 j" valeur={fluxSigne(r.j1, actif)} badge={badge} pied={usd(r.usdJ1)} />
      <TuileStat label="Flux net 7 j" valeur={fluxSigne(r.j7, actif)} badge={badge} pied={usd(r.usdJ7)} />
      <TuileStat label="Flux net 30 j" valeur={fluxSigne(r.j30, actif)} badge={badge} pied={usd(r.usdJ30)} />
      <TuileStat label="z-score flux 30 j (730 j)" valeur={formatDec(r.z30, 2)} badge={badge}
        pied={r.z30 === null ? "759 jours consécutifs requis" : "écart à la moyenne des Σ30 sur 730 j"} />
    </div>
    <CourbeOnchain points={net} label={`Flux net exchanges ${actif}`} unite={`${actif}/j`} zero />
  </div>;
}
