import { useEffect, useState } from "react";
import { chargerIndiceGeo, SOURCES_GEO, type HistoriqueGeo, type IndiceGeo } from "../data/globe/indicesGeo";
import { GeoHistoryChart } from "./GeoHistoryChart";
import { Bouton, Chargement, ErreurBloc, NoteSource, Select } from "./ui";

export function GlobeIndicesPanel({ onFermer }: { onFermer: () => void }) {
  const [id, setId] = useState<IndiceGeo>("gpr");
  const [annees, setAnnees] = useState(5);
  const [donnees, setDonnees] = useState<HistoriqueGeo | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    const controleur = new AbortController();
    setDonnees(null); setErreur(null);
    void chargerIndiceGeo(id, controleur.signal).then(r => { if (!controleur.signal.aborted) setDonnees(r); }).catch(err => { if (!controleur.signal.aborted) setErreur(err instanceof Error ? err.message : "Source indisponible."); });
    return () => controleur.abort();
  }, [id]);
  const source = SOURCES_GEO[id];
  const limite = Date.now() - annees * 365.25 * 86_400_000;
  return <section aria-label="Indices géopolitiques" className="absolute inset-0 z-20 overflow-y-auto bg-surface p-3">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select aria-label="Indice géopolitique" value={id} onChange={e => setId(e.target.value as IndiceGeo)}>
        {Object.entries(SOURCES_GEO).map(([k, s]) => <option key={k} value={k}>{k.toUpperCase()} · {s.nom}</option>)}
      </Select>
      <Select aria-label="Historique géopolitique" value={annees} onChange={e => setAnnees(Number(e.target.value))}>{[1, 5, 10].map(n => <option key={n} value={n}>{n} an{n > 1 ? "s" : ""}</option>)}</Select>
      <Bouton className="ml-auto" onClick={onFermer}>Retour au globe</Bouton>
    </div>
    <p className="mb-3 text-[11px] text-text-dim">{source.detail}</p>
    {erreur ? <ErreurBloc>{erreur}</ErreurBloc> : !donnees ? <Chargement libelle="Historique officiel…" /> : <>
      {(donnees.perime || donnees.series.some(s => Date.now() - (s.points.at(-1)?.time ?? 0) > 100 * 86_400_000)) && <p className="mb-2 text-[11px] text-warn">Dernières données connues : source en retard ou échec du rafraîchissement.</p>}
      <div className="space-y-2">{donnees.series.map(s => <GeoHistoryChart key={s.id} nom={s.nom} points={s.points.filter(p => p.time >= limite)} unite={source.unite} />)}</div>
      <p className="mt-2 text-[10px] text-text-dim">Récupéré le {new Date(donnees.recupereTs).toLocaleString("fr-FR")}{donnees.millesime ? ` · édition ${donnees.millesime}` : ""}.</p>
    </>}
    <div className="mt-3"><NoteSource><a href={source.source} target="_blank" rel="noreferrer" className="text-accent hover:underline">{source.attribution} ↗</a> · Observations mensuelles, historiques révisables. Courbes recadrées sur la période choisie ; aucune connaissance historique des publications n’est simulée.</NoteSource></div>
  </section>;
}
