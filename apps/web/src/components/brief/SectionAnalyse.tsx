import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { comparerSnapshotsAnalyse, snapshotAnalyseEnJson, snapshotAnalyseEnMarkdown } from "../../data/analyseSynthese";
import { actualiserAnalyseBrief, annulerActualisationAnalyseBrief, analyseBriefStore } from "../../store/analyseBrief";
import { windowManagerStore } from "../../store/windowManager";
import { BTN_SECONDAIRE, NoteSource } from "../ui";

const DOMAINES = [
  { id: "quadrant", label: "Macro · quadrants" },
  { id: "liquidite", label: "Micro · coût L2" },
  { id: "rotation", label: "On-chain · rotation" },
  { id: "geo", label: "Géopolitique · scénarios choisis" },
  { id: "divergence", label: "Part TVL / prix du token" },
] as const;
const FENETRE_PREUVE = { RATE: "macroRates", DOM: "dom", CHAIN: "onchain", GLOBE: "globe", BRIEF: "brief" } as const;
const date = (value: number) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(value);
function telecharger(nom: string, contenu: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = nom; a.click();
  URL.revokeObjectURL(url);
}

export function SectionAnalyse({ refreshToken }: { refreshToken: number }) {
  const etat = useStore(analyseBriefStore);
  useEffect(() => { analyseBriefStore.getState().chargerReference(); }, []);
  useEffect(() => {
    if (refreshToken === 0) return;
    void actualiserAnalyseBrief();
    return () => annulerActualisationAnalyseBrief();
  }, [refreshToken]);
  const changements = useMemo(() => etat.reference && etat.courant ? comparerSnapshotsAnalyse(etat.reference, etat.courant) : [], [etat.reference, etat.courant]);
  const courant = etat.courant;
  return <section aria-label="Analyse multidomaine" className="space-y-2 rounded border border-border p-2 text-[11px]">
    <h3 className="font-semibold text-text">Analyse multidomaine</h3>
    <p className="text-text-dim">{courant ? `Instantané affiché ${date(courant.creeLe)} UTC · ${courant.lectures.length} preuves` : "Instantané en attente."} {etat.reference ? `Référence enregistrée ${date(etat.reference.creeLe)} UTC.` : "Aucune référence enregistrée."}</p>
    <div className="flex flex-wrap gap-1">
      <button type="button" disabled={!courant} onClick={() => analyseBriefStore.getState().enregistrerReference()} className={`${BTN_SECONDAIRE} disabled:opacity-40`}>Enregistrer la référence</button>
      {etat.pending && <button type="button" onClick={() => analyseBriefStore.getState().reessayerSauvegarde()} className={BTN_SECONDAIRE}>Réessayer la sauvegarde</button>}
      <button type="button" disabled={!courant} onClick={() => courant && telecharger("axiom-analyse-brief.json", snapshotAnalyseEnJson(courant), "application/json")} className={`${BTN_SECONDAIRE} disabled:opacity-40`}>Exporter JSON</button>
      <button type="button" disabled={!courant} onClick={() => courant && telecharger("axiom-analyse-brief.md", snapshotAnalyseEnMarkdown(courant), "text/markdown")} className={`${BTN_SECONDAIRE} disabled:opacity-40`}>Exporter Markdown</button>
    </div>
    {etat.erreur && <p role="alert" className="text-warn">{etat.erreur}</p>}
    {etat.archiveInvalide !== null && <div className="space-y-1 text-warn"><p>Archive invalide conservée sans modification.</p><button type="button" className={BTN_SECONDAIRE} onClick={() => telecharger("axiom-analyse-archive-invalide.txt", etat.archiveInvalide!, "text/plain")}>Exporter l'archive brute</button><button type="button" className={BTN_SECONDAIRE} onClick={() => analyseBriefStore.getState().autoriserRemplacementArchive()}>Autoriser son remplacement au prochain enregistrement</button></div>}
    <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead><tr className="text-text-dim"><th>Domaine</th><th>Constat / horizon</th><th>Qualité / couverture</th><th>Preuve</th></tr></thead><tbody>{DOMAINES.map(({ id, label }) => {
      const lectures = courant?.lectures.filter((l) => l.domaine === id) ?? [];
      const chargement = id === "quadrant" ? etat.chargements.quadrant : id === "rotation" ? etat.chargements.rotation : id === "divergence" ? etat.chargements.divergence : null;
      return <tr key={id} className="border-t border-border align-top"><th className="py-1 font-medium text-text">{label}<span className="block font-normal text-text-dim">{chargement === "chargement" ? "Actualisation…" : chargement === "erreur" ? "Source indisponible" : chargement === "pret" ? "Actualisé" : id === "liquidite" || id === "geo" ? "Acquis seulement" : "En attente"}</span></th><td colSpan={lectures.length === 0 ? 3 : undefined} className="py-1">{lectures.length === 0 ? "Aucune lecture acquise dans ce domaine." : <ul className="space-y-1">{lectures.map((l) => <li key={l.id}>{l.conclusion} · {date(l.horizon.depuis)} → {date(l.horizon.jusqua)} UTC</li>)}</ul>}</td>{lectures.length > 0 && <><td className="py-1">{lectures.map((l) => <p key={l.id}>{l.statut} · {l.couverture ? `${l.couverture.presentes}/${l.couverture.attendues}` : "couverture inconnue"}</p>)}</td><td className="py-1">{lectures.map((l) => <p key={l.id}>{l.source} · <button type="button" className="underline" onClick={() => windowManagerStore.getState().openWindow(FENETRE_PREUVE[l.preuve.fenetre])}>Voir {l.preuve.fenetre}</button> · {l.preuve.reference}</p>)}</td></>}</tr>;
    })}</tbody></table></div>
    {etat.reference && <div className="space-y-1"><h4 className="font-medium text-text">Depuis la référence</h4>{changements.length ? <ul className="space-y-1 text-text-dim">{changements.map((c) => <li key={c.identite}>{c.identite} · règle {c.regle} · {c.delta === null ? c.description : `Δ ${c.delta.toFixed(2)} ${c.apres?.unite ?? ""}`}</li>)}</ul> : <p className="text-text-dim">Aucune dimension à comparer.</p>}</div>}
    <NoteSource>La règle TVL 30 j / prix spot ETH, SOL ou ARB compare le signe du gain de part en points à celui du rendement du token sur les mêmes bougies quotidiennes closes. Une opposition est une divergence descriptive, jamais une contradiction logique ni un flux d'investisseurs. Base n'a pas de token de référence. DOM fournit seulement la médiane 1 min acquise ; GLOBE seulement un scénario choisi. Les horizons, sources et propositions incompatibles restent non comparables. Aucun score global.</NoteSource>
  </section>;
}
