import { useEffect, useState } from "react";
import { fetchEthStaking, type EthStakingResultat } from "../../data/onchain/ethStaking";
import { NoteSource, TuileStat, Vide } from "../ui";
import { boutonHistorique, CourbeOnchain, ProvenanceOnchain, valeurUnite } from "./HistoriqueCommun";

export function VueFilesStakingEth({ resultat }: { resultat: EthStakingResultat }) {
  const p = resultat.points.at(-1);
  if (!p) return <Vide>Files de staking ETH indisponibles.</Vide>;
  return <div className="mt-2 space-y-2">
    <div className="grid grid-cols-2 gap-2">
      <div className="min-w-0"><TuileStat label="File d'entrée" valeur={valeurUnite(p.entreeEth, "ETH")} />
        <CourbeOnchain points={resultat.points.map(r => ({ time: r.time, value: r.entreeEth }))} label="File d'entrée ETH" unite="ETH" /></div>
      <div className="min-w-0"><TuileStat label="File de sortie" valeur={valeurUnite(p.sortieEth, "ETH")} />
        <CourbeOnchain points={resultat.points.map(r => ({ time: r.time, value: r.sortieEth }))} label="File de sortie ETH" unite="ETH" /></div>
      <TuileStat label="Attente entrée estimée" valeur={`${p.attenteEntreeJours.toFixed(2)} j`} />
      <TuileStat label="Attente sortie estimée" valeur={`${p.attenteSortieJours.toFixed(2)} j`} />
      <TuileStat label="ETH en staking" valeur={valeurUnite(p.stakeEth, "ETH")} />
      <TuileStat label="Part en staking" valeur={`${p.stakePct.toFixed(2)} %`} />
    </div>
    <ProvenanceOnchain source="ValidatorQueue · Ether Alpha" sourceId="validatorqueue" observation={p.time} recuperation={resultat.ts} perime={resultat.perime} />
    {resultat.raison && <NoteSource>{resultat.raison}</NoteSource>}
    <NoteSource>Observation quotidienne (première mesure du jour UTC), historique post-Pectra depuis le 22/05/2025.
      Files mesurées en ETH ; délais estimés par le fournisseur, variables avec le churn réseau.</NoteSource>
  </div>;
}

export function FilesStakingEth({ open }: { open: boolean }) {
  const [afficher, setAfficher] = useState(false);
  const [resultat, setResultat] = useState<EthStakingResultat | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !afficher) return;
    const ctrl = new AbortController(); setLoading(true); setResultat(null);
    void fetchEthStaking(ctrl.signal).then(r => { if (!ctrl.signal.aborted) { setResultat(r); setLoading(false); } });
    return () => ctrl.abort();
  }, [open, afficher]);
  return <div className="mt-3">
    <button type="button" className={boutonHistorique} aria-expanded={afficher} onClick={() => setAfficher(!afficher)}>Files de staking ETH</button>
    {afficher && (loading ? <Vide>Chargement des files ETH…</Vide> : resultat ? <VueFilesStakingEth resultat={resultat} /> : <Vide>Historique ValidatorQueue indisponible.</Vide>)}
  </div>;
}
