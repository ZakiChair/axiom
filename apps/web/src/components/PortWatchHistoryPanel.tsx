import { useEffect, useState } from "react";
import type { Chokepoint } from "../data/globe/types";
import { chargerHistoriquePortWatch, statistiquesPortWatch, type HistoriquePortWatch, type MesurePortWatch } from "../data/globe/portwatchHistorique";
import { GeoHistoryChart } from "./GeoHistoryChart";
import { Chargement, ErreurBloc, NoteSource, Select } from "./ui";

export function PortWatchHistoryPanel({ chokepoint }: { chokepoint: Chokepoint }) {
  const [mesure, setMesure] = useState<MesurePortWatch>("navires");
  const [donnees, setDonnees] = useState<HistoriquePortWatch | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDonnees(null); setErreur(null);
    if (!chokepoint.date) { setErreur("Aucune date de référence publiée."); return; }
    void chargerHistoriquePortWatch(chokepoint.id, chokepoint.date, controller.signal).then(r => { if (!controller.signal.aborted) setDonnees(r); }).catch(err => { if (!controller.signal.aborted) setErreur(err instanceof Error ? err.message : "Historique indisponible."); });
    return () => controller.abort();
  }, [chokepoint.id, chokepoint.date]);
  const stats = donnees ? statistiquesPortWatch(donnees.points, mesure) : null;
  const format = (v: number | null) => v === null ? "n/d" : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return <div className="space-y-3 text-[11px]">
    <Select aria-label="Type de transit maritime" value={mesure} onChange={e => setMesure(e.target.value as MesurePortWatch)}>
      <option value="navires">Tous les navires</option><option value="tankers">Pétroliers</option><option value="cargos">Cargos</option>
    </Select>
    {erreur ? <ErreurBloc>{erreur}</ErreurBloc> : !donnees ? <Chargement libelle="Historique PortWatch…" /> : <>
      {donnees.perime && <p className="text-warn">Cache ancien · source inaccessible.</p>}
      {stats?.fin != null && Date.now() - stats.fin > 14 * 86_400_000 && <p className="text-warn">Dernière observation de plus de quatorze jours.</p>}
      <dl className="space-y-1 text-text">
        <div>Moyenne 7 j : <strong>{format(stats!.moyenne7j)}</strong> navires/jour</div>
        <div>Référence saisonnière : {format(stats!.reference)} · {stats!.anneesReference}/3 années</div>
        <div>Écart : {format(stats!.ecartPct)}{stats!.ecartPct !== null ? " %" : " (couverture insuffisante ou référence nulle)"}</div>
      </dl>
      <GeoHistoryChart nom={chokepoint.nom} unite="navires/jour" pasMaxJours={1.5} points={donnees.points.flatMap(p => p[mesure] === null ? [] : [{ time: p.time, value: p[mesure]! }])} />
      <p className="text-text-dim">Dernier jour : {stats?.fin == null ? "n/d" : new Date(stats.fin).toISOString().slice(0, 10)} · récupéré le {new Date(donnees.recupereTs).toLocaleDateString("fr-FR")}.</p>
    </>}
    <NoteSource><a className="text-accent hover:underline" href="https://portwatch.imf.org/" target="_blank" rel="noreferrer">UN Global Platform · IMF PortWatch ↗</a>. Trafic AIS estimé et révisable. Moyenne sur sept jours calendaires complets ; référence = médiane des mêmes fenêtres des trois années précédentes (au moins deux). Le 29 février est ramené au 28 pour une année non bissextile. Mesure dérivée AXIOM, pas un volume en tonnes.</NoteSource>
  </div>;
}
