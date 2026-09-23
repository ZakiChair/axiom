/** Historique FUNDX : règlements stricts et dispersion de la cohorte fixe. */
import { useEffect, useMemo, useState } from "react";
import { construireSerieDispersion } from "../data/fundingDispersion";
import { chargerFundingVenue, VENUES_FUNDING, type HistoriqueFundingVenue, type VenueFunding } from "../data/fundingHistory";
import { Chargement, ErreurBloc, NoteSource } from "./ui";
import type { ExchangeId } from "@axiom/types";
import { normaliserIdentiteFunding } from "../data/fundingIdentity";

const H = 3_600_000;
const JOUR = 24 * H;
const NOMS: Record<VenueFunding, string> = {
  binance: "Binance", bybit: "Bybit", okx: "OKX", hyperliquid: "Hyperliquid",
};
const SOURCES: Record<VenueFunding, string> = {
  binance: "Binance · règlements réguliers", bybit: "Bybit · règlements réalisés",
  okx: "OKX · règlements réalisés", hyperliquid: "Hyperliquid · historique horaire",
};
type Jours = 7 | 30 | 90;
type Resultat = { symbol: string; exchange: ExchangeId; jours: Jours; donnees: Record<VenueFunding, HistoriqueFundingVenue> };

function date(ts: number | undefined): string {
  return ts === undefined ? "inconnue" : new Date(ts).toLocaleString("fr-CH", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " UTC";
}

/** Chaque suite de valeurs connues devient son propre tracé : aucun pont sur un trou. */
function segments(valeurs: Array<number | undefined>, min: number, max: number): string[] {
  const chemins: string[] = [];
  let chemin = "";
  valeurs.forEach((v, i) => {
    if (v === undefined || !Number.isFinite(v)) {
      if (chemin) chemins.push(chemin);
      chemin = "";
      return;
    }
    const x = valeurs.length <= 1 ? 0 : i * 700 / (valeurs.length - 1);
    const y = 170 - (v - min) * 160 / Math.max(max - min, 1e-12);
    chemin += `${chemin ? " L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  if (chemin) chemins.push(chemin);
  return chemins;
}

export function FundingHistory({ symbol, exchange }: { symbol: string; exchange: ExchangeId }) {
  const [jours, setJours] = useState<Jours>(7);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    void Promise.all(VENUES_FUNDING.map(async (venue) => [venue, await chargerFundingVenue(venue, symbol, jours, fetch, exchange)] as const))
      .then((entries) => {
        if (annule) return;
        setResultat({ symbol, exchange, jours, donnees: Object.fromEntries(entries) as Record<VenueFunding, HistoriqueFundingVenue> });
        setChargement(false);
      });
    return () => { annule = true; };
  }, [symbol, exchange, jours]);

  // Une réponse de l'ancien symbole/plage ne doit jamais être affichée pendant la transition.
  const donnees = resultat?.symbol === symbol && resultat.exchange === exchange && resultat.jours === jours ? resultat.donnees : null;
  const serie = useMemo(() => {
    if (donnees === null) return null;
    const fin = Math.floor(Date.now() / H) * H;
    const times = Array.from({ length: jours * 24 + 1 }, (_, i) => fin - jours * JOUR + i * H);
    return construireSerieDispersion(Object.fromEntries(VENUES_FUNDING.map((v) => [v, donnees[v].points])) as Record<VenueFunding, HistoriqueFundingVenue["points"]>, times);
  }, [donnees, jours]);
  const connus = serie?.filter((p) => p.sigma !== undefined) ?? [];
  const derniereComplete = connus.at(-1);
  const amplitudes = serie?.flatMap((p) => [p.sigma, p.min, p.max].filter((v): v is number => v !== undefined)) ?? [];
  const min = amplitudes.length ? Math.min(...amplitudes) : 0;
  const max = amplitudes.length ? Math.max(...amplitudes) : 1;
  const erreurs = donnees === null ? [] : VENUES_FUNDING.filter((v) => donnees[v].status === "error");
  const identite = normaliserIdentiteFunding(exchange, symbol);

  return (
    <section aria-label="Historique du funding" className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-dim">Période demandée</span>
        {([7, 30, 90] as const).map((n) => (
          <button key={n} type="button" aria-pressed={jours === n} onClick={() => setJours(n)}
            className={`rounded px-2 py-1 text-xs ${jours === n ? "bg-accent text-bg" : "bg-surface text-text"}`}>
            {n} j
          </button>
        ))}
      </div>
      {chargement || donnees === null ? <Chargement /> : <>
        {erreurs.length > 0 && <ErreurBloc>
          Historique indisponible : {erreurs.map((v) => `${NOMS[v]} (${donnees[v].erreur ?? "source indisponible"})`).join(" ; ")}.
          Les autres venues restent visibles.
        </ErreurBloc>}
        <div className="text-xs text-text-dim">
          {symbol} · cohorte {identite ? `${identite.cexSymbol} / ${identite.okxInstId} / ${identite.base} Hyperliquid` : "indisponible"} · demandé depuis {date(serie?.[0]?.time)} · dispersion calculable sur {connus.length}/{serie?.length ?? 0} heures
          {connus.length > 0 ? ` · couverture effective ${date(connus[0]?.time)} → ${date(connus.at(-1)?.time)}` : " · aucune couverture complète"}.
          Trous : {(serie?.length ?? 0) - connus.length}.
        </div>
        {derniereComplete && <div className="rounded border border-border p-2 text-xs" data-testid="funding-derniere-dispersion">
          Dernière observation complète · {date(derniereComplete.time)} ·
          σ {derniereComplete.sigma?.toFixed(2)} · min {derniereComplete.min?.toFixed(2)} · max {derniereComplete.max?.toFixed(2)} points d’APR
          · {derniereComplete.knownCount}/4 venues
        </div>}
        {serie !== null && <div className="space-y-1">
          <svg viewBox="0 0 700 180" preserveAspectRatio="none" role="img"
            aria-label={`Dispersion APR historique ; ${connus.length} heures connues sur ${serie.length}, trous laissés vides`}
            className="h-44 w-full rounded border border-border bg-surface">
            {(["sigma", "min", "max"] as const).flatMap((cle) => segments(serie.map((p) => p[cle]), min, max)
              .map((d, i) => <path key={`${cle}-${i}`} d={d} fill="none" stroke={cle === "sigma" ? "var(--ui-amber)" : cle === "min" ? "var(--down)" : "var(--up)"} strokeWidth="2" />))}
          </svg>
          <div className="flex justify-between text-xs text-text-dim"><span>{date(serie[0]?.time)}</span><span>Échelle : {min.toFixed(2)} à {max.toFixed(2)} points d’APR</span><span>{date(serie.at(-1)?.time)}</span></div>
          <div className="flex gap-3 text-xs text-text-dim" aria-label="Légende des courbes">
            <span><span style={{ color: "var(--ui-amber)" }}>●</span> Dispersion σ</span>
            <span><span style={{ color: "var(--down)" }}>●</span> APR minimum</span>
            <span><span style={{ color: "var(--up)" }}>●</span> APR maximum</span>
          </div>
        </div>}
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          {VENUES_FUNDING.map((venue) => {
            const h = donnees[venue];
            const derniere = h.points.slice().reverse().find((p) => p.value !== undefined && p.validUntil !== undefined);
            const cadence = derniere?.validUntil === undefined ? "inconnue" : `${(derniere.validUntil - derniere.time) / H} h observées`;
            return <div key={venue} className="rounded border border-border p-2">
              <strong>{NOMS[venue]}</strong> · {h.status === "error" ? "indisponible" : h.points.length === 0 ? "aucun règlement reçu" : h.status === "partial" ? "couverture partielle" : "historique reçu"}<br />
              {SOURCES[venue]}<br />
              Couverture effective : {date(h.effectiveFrom)} → {date(h.effectiveTo)} · cadence {cadence}
            </div>;
          })}
        </div>
        <NoteSource>
          APR = taux horaire réalisé × 24 × 365 × 100. σ est l’écart-type équipondéré de quatre venues fixes ;
          une venue inconnue crée un trou. La cadence CEX vient des règlements précédents, jamais du réglage actuel.
          La couverture dépend de la rétention réelle des API et peut être plus courte que la période demandée.
        </NoteSource>
      </>}
    </section>
  );
}
