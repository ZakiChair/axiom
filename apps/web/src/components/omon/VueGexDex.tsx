/** Vue analytique GEX/DEX : carte des expositions nettes et sensibilité au prix. */
import { useState } from "react";
import type { MursGamma, ScenarioGamma, VerdictGamma } from "../../data/gexDex";
import type { CarteExpositions as Carte, ProfilExpositionsCrypto } from "../../data/carteExpositions";
import { niveauCrypto } from "../../data/cboe";
import { formatDec, formatEntier, formatPct, formatPourcentage, formatUsd } from "../../lib/format";
import { Badge, ErreurBloc, NoteSource, Fraicheur, Segmente } from "../ui";
import { CarteExpositions } from "./CarteExpositions";
import { ProfilExpositions } from "./ProfilExpositions";
import { GraphiqueExpositions } from "./GraphiqueExpositions";
import { formatUsdExact } from "./format";

export interface LectureEtf {
  sousJacent: "BTC" | "ETH";
  prixEtf: number;
  prixCrypto: number | null;
  dernierEchangeNy: string | null;
  iv30: number;
  pcOi: number;
  pcVol: number;
  notionnelUsd: number;
}
interface Props {
  metrique: "gex" | "dex";
  classe: "crypto" | "actions";
  portee: "toutes" | "selection";
  loading: boolean;
  cboeLoading: boolean;
  majTs: number | null;
  erreur: string | null;
  cboeErreur: string | null;
  carte: Carte;
  profil: ProfilExpositionsCrypto;
  gexNet: number;
  dexNet: number;
  spotVerdict: number;
  flip: number | null;
  strikePicGex: number | null;
  verdict: VerdictGamma;
  murs: MursGamma;
  scenariosGamma: ScenarioGamma[];
  flipReel: number | null;
  etf: LectureEtf | null;
}
export function VueGexDex({ metrique, classe, portee, loading, cboeLoading, majTs, erreur, cboeErreur,
  carte, profil, gexNet, dexNet, spotVerdict, flip, strikePicGex, verdict, murs, scenariosGamma, flipReel, etf }: Props) {
  const [mode, setMode] = useState<"graphique" | "carte" | "profil">("graphique");
  const porteeNet = classe === "crypto" && portee === "toutes" ? "toutes échéances actives" : "échéance sélectionnée";
  const converti = (strike: number | null) => etf ? `≈ ${formatUsdExact(niveauCrypto(strike, etf.prixEtf, etf.prixCrypto))} ${etf.sousJacent}` : "";
  const niveaux: [string, number | null][] = [["Call wall", murs.callWall], ["Put wall", murs.putWall], ["Strike |GEX| max", strikePicGex]];
  return <section aria-label="Analyse des expositions" className="min-w-0">
    {classe === "actions" && <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-dim">
      <span>{porteeNet} · convention calls + / puts −</span>
      <Fraicheur loading={cboeLoading} majTs={majTs} cadenceMs={etf ? 300_000 : 60_000} />
    </div>}
    {(classe === "crypto" ? erreur : cboeErreur) && <ErreurBloc>{classe === "crypto" ? erreur : cboeErreur}</ErreurBloc>}
    <div className="mb-2 grid grid-cols-3 gap-3 border-y border-border py-1.5 tabular-nums">
      <div role="group" aria-label="GEX net" className="flex flex-wrap items-baseline gap-x-2"><span className="text-[10px] text-text-dim">GEX $/1 %</span><span className="text-[13px] font-medium">{formatUsd(gexNet)}</span></div>
      <div role="group" aria-label="DEX net" className="flex flex-wrap items-baseline gap-x-2"><span className="text-[10px] text-text-dim">DEX $</span><span className="text-[13px] font-medium">{formatUsd(dexNet)}</span></div>
      <div role="group" aria-label="Spot" className="flex flex-wrap items-baseline gap-x-2"><span className="text-[10px] text-text-dim">Spot</span><span className="text-[13px] font-medium">{formatUsdExact(spotVerdict)}</span>{etf && <small className="block w-full text-text-dim">{converti(spotVerdict)}</small>}</div>
    </div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-1"><Segmente options={[
      { id: "graphique", label: "Graphique" }, { id: "carte", label: "Carte des expositions" },
      ...(classe === "crypto" ? [{ id: "profil" as const, label: "Sensibilité au prix" }] : []),
    ] as const} actif={mode} onChange={setMode} /><span className="text-[10px] text-text-dim">{porteeNet} · calls + / puts −{loading ? " · maj…" : ""}</span></div>
    {mode === "graphique" ? <GraphiqueExpositions carte={carte} metrique={metrique} spot={spotVerdict} convertirStrike={etf ? converti : undefined} /> : mode === "carte"
      ? <CarteExpositions carte={carte} metrique={metrique} spot={spotVerdict} convertirStrike={etf ? converti : undefined} />
      : <ProfilExpositions points={profil.points} spot={spotVerdict} metrique={metrique} portee={porteeNet} />}
    <div className="mt-3 grid grid-cols-3 gap-3 border-y border-border py-2 text-[11px] tabular-nums">
      {niveaux.map(([label, valeur]) => <div key={label} role="group" aria-label={label}><div className="text-[10px] text-text-dim">{label}</div><div className="mt-0.5 font-medium">{formatUsdExact(valeur)}</div>{etf && <small className="block text-text-dim">{converti(valeur)}</small>}</div>)}
    </div>
    {etf && <>
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim">CBOE — différé ~15 min — marché US fermé nuits et week-ends · dernier échange {etf.dernierEchangeNy?.replace("T", " ") ?? "—"} (heure de New York){etf.prixCrypto === null && " · conversion en " + etf.sousJacent + " indisponible (bougie Binance absente)"}.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
        <div role="group" aria-label="P/C (OI)"><span className="text-text-dim">P/C (OI) </span>{formatDec(etf.pcOi, 2)}</div>
        <div role="group" aria-label="P/C (Vol)"><span className="text-text-dim">P/C (Vol) </span>{formatDec(etf.pcVol, 2)}</div>
        <div role="group" aria-label="IV30 (CBOE)"><span className="text-text-dim">IV30 (CBOE) </span>{formatPourcentage(etf.iv30, 1)}</div>
        <div role="group" aria-label="Notionnel OI"><span className="text-text-dim">Notionnel OI </span>{formatUsd(etf.notionnelUsd)}<small className="block text-text-dim">≈ {etf.prixCrypto === null ? "—" : formatEntier(etf.notionnelUsd / etf.prixCrypto)} {etf.sousJacent}</small></div>
      </div>
    </>}
    <details className="mt-3 text-[10px]">
      <summary className="cursor-pointer text-text-dim">Niveaux dérivés et conventions</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums">
        <div role="group" aria-label="Flip cumulé par strike"><span className="text-text-dim">Flip cumulé par strike </span>{formatUsdExact(flip)} {etf && <Badge ton="warn">indicatif</Badge>}{etf && <small className="block text-text-dim">{converti(flip)}</small>}</div>
        <div><span className="text-text-dim">Distance spot / cumul </span>{formatPct(verdict.distanceFlipPct, 1)}</div>
        {classe === "crypto" && <div className="col-span-2"><span className="text-text-dim">Zéro du profil GEX modélisé </span>{formatUsdExact(flipReel)}</div>}
      </div>
      <p className="mt-2 text-text-dim">Le cumul par strike n’est pas un seuil de bascule du prix. Le zéro du profil simulé désigne un autre calcul, sous hypothèses constantes.</p>
      {scenariosGamma.length > 0 && <div className="mt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2"><span>Sensibilité au signe gamma</span><Badge>mêmes contrats · spot · horloge</Badge></div>
        <div className="grid gap-2 sm:grid-cols-3">{scenariosGamma.map((s) => <div key={s.hypothese} className="rounded border border-border p-2"><div>{s.libelle}</div><div className="mt-1">GEX {formatUsd(s.gexNet)}</div><div className="text-text-dim">flip cumul/strike {formatUsdExact(s.flipCumulStrike)}</div><div className="text-text-dim">verdict {s.verdict.regime}</div></div>)}</div>
        <p className="mt-2 text-text-dim">Scénarios de convention, pas des positions dealer observées. Le DEX conserve son delta signé.</p>
      </div>}
    </details>
    <div className="mt-3"><NoteSource>{classe === "crypto"
      ? "Options inverses Deribit. Les variantes tous-long/tous-short sont des hypothèses. IV mark et forward par maturité ; valorisation USD à l’index. GEX net : delta notionnel par +1 % ; DEX : USD notionnels. Les petites contributions restent incluses."
      : "Greeks pré-calculés CBOE, multiplicateur 100, échéance sélectionnée. Greeks figés : pas de simulation de prix. Convention calls + / puts −, positions dealers inconnues. Endpoint différé non contractuel."}
      {etf && ` ETF ${etf.sousJacent} : strikes à ±25 % du prix ETF ; P/C et notionnel sur la chaîne complète. OI OCC quotidien. Niveau ≈ ${etf.sousJacent} = strike × prix crypto au dernier échange ÷ prix ETF ; approximation, pas la NAV. Volume consolidé ou propre au CBOE : non vérifié.`}
    </NoteSource></div>
  </section>;
}
