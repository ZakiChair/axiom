import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { fetchEtfHistory, resumerEtfHistory, type HistoriqueEtf as DonneeHistoriqueEtf } from "../../data/onchain/etfHistory";
import type { ActifEtf } from "../../data/onchain/etf";
import type { BgResultat } from "../../data/onchain/bgeometrics";
import { getSoSoValueKey, soSoValueKeyStore } from "../../store/sosovalue";
import { formatUsd } from "../../lib/format";
import { NoteSource, TuileStat, Vide } from "../ui";
import { boutonHistorique, CourbeOnchain, ProvenanceOnchain, valeurUnite } from "./HistoriqueCommun";

export function VueHistoriqueEtf({ resultat, repliBtc }: { resultat: DonneeHistoriqueEtf; repliBtc?: BgResultat | null }) {
  if (!resultat.points.length) {
    if (!repliBtc?.serie.points.length) return <Vide>{resultat.raison ?? "Historique ETF indisponible."}</Vide>;
    const points = repliBtc.serie.points;
    const cumul = (n: number) => points.length >= n ? points.slice(-n).reduce((s, p) => s + p.value, 0) : null;
    return <div className="mt-2 space-y-2">
      <NoteSource>{resultat.raison} · Repli BTC en unité native. Aucun ratio USD sans encours de la même source et date.</NoteSource>
      <div className="grid grid-cols-2 gap-2">{[5, 20].map(n => <TuileStat key={n} label={`Cumul ${n} séances`} valeur={valeurUnite(cumul(n), "BTC")}
        pied={cumul(n) === null ? "Historique insuffisant" : undefined} />)}</div>
      <CourbeOnchain points={points} label="Flux ETF BTC publiés" unite="BTC" zero ecartMaxJours={4} />
      <ProvenanceOnchain source="BGeometrics (repli)" observation={points.at(-1)?.time} recuperation={repliBtc.ts} perime={repliBtc.perime} />
    </div>;
  }
  const r = resumerEtfHistory(resultat.points); const dernier = resultat.points.at(-1)!;
  return <div className="mt-2 space-y-2">
    <div className="grid grid-cols-2 gap-2">
      {[{ n: 5, cumul: r.cumul5 }, { n: 20, cumul: r.cumul20 }].map(({ n, cumul }) => <TuileStat key={n} label={`Cumul ${n} séances`}
        valeur={formatUsd(cumul ?? undefined)} pied={cumul === null ? "Historique insuffisant ou séance sans flux publié" : undefined} />)}
      <TuileStat label="Encours du jour publié" valeur={formatUsd(dernier.encoursUsd ?? undefined)} />
      <TuileStat label="Flux / encours du jour" valeur={r.ratioJourPct === null ? "—" : `${r.ratioJourPct.toFixed(2)} %`} />
    </div>
    <CourbeOnchain points={resultat.points.map(p => ({ time: p.time, value: p.fluxUsd }))} label="Flux nets ETF publiés" unite="USD" zero ecartMaxJours={4} />
    <ProvenanceOnchain source="SoSoValue" sourceId="sosovalue:historique" observation={dernier.time} recuperation={resultat.ts} perime={resultat.perime} />
    {resultat.raison && <NoteSource>{resultat.raison}</NoteSource>}
    <NoteSource>{r.observations} séances reçues, dernier mois disponible selon l'accès API. Week-ends et jours fériés exclus ;
      aucune date remplie depuis le flux du jour. Ratio calculé avec les encours de la même séance.</NoteSource>
  </div>;
}

export function HistoriqueEtf({ open, actif, repliBtc }: { open: boolean; actif: ActifEtf; repliBtc: BgResultat | null }) {
  const [afficher, setAfficher] = useState(false);
  const [resultat, setResultat] = useState<DonneeHistoriqueEtf | null>(null);
  const versionCle = useStore(soSoValueKeyStore, s => s.version);
  useEffect(() => {
    if (!open || !afficher) return;
    const ctrl = new AbortController(); setResultat(null);
    void fetchEtfHistory(actif, getSoSoValueKey(), ctrl.signal).then(r => { if (!ctrl.signal.aborted) setResultat(r); });
    return () => ctrl.abort();
  }, [open, afficher, actif, versionCle]);
  return <div className="mt-3">
    <button type="button" className={boutonHistorique} aria-expanded={afficher} onClick={() => setAfficher(!afficher)}>Historique ETF {actif.toUpperCase()}</button>
    {afficher && (resultat ? <VueHistoriqueEtf resultat={resultat} repliBtc={actif === "btc" ? repliBtc : null} /> : <Vide>Chargement de l'historique ETF…</Vide>)}
  </div>;
}
