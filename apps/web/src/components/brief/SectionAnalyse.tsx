import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { comparerSnapshotsAnalyse } from "../../data/analyseSynthese";
import { snapshotAnalyseEnJson, snapshotAnalyseEnMarkdown } from "../../data/analyseSnapshotExport";
import { actualiserAnalyseBrief, annulerActualisationAnalyseBrief, analyseBriefStore } from "../../store/analyseBrief";
import { windowManagerStore } from "../../store/windowManager";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { BTN_SECONDAIRE, NoteSource } from "../ui";

const DOMAINES = [
  { id: "quadrant", label: "Macro · quadrants" },
  { id: "liquidite", label: "Micro · coût L2" },
  { id: "rotation", label: "On-chain · rotation" },
  { id: "geo", label: "Géopolitique · scénarios choisis" },
  { id: "divergence", label: "Part TVL / prix du token" },
] as const;
type LigneDomaine = typeof DOMAINES[number];
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
  const lecturesDomaine = (id: LigneDomaine["id"]) => courant?.lectures.filter((lecture) => lecture.domaine === id) ?? [];
  const colonnes: ColonneTable<LigneDomaine>[] = [
    { id: "domaine", label: "Domaine", largeur: "1.1fr", rendu: ({ id, label }) => {
      const chargement = id === "quadrant" ? etat.chargements.quadrant : id === "rotation" ? etat.chargements.rotation : id === "divergence" ? etat.chargements.divergence : null;
      return <><span className="block font-medium text-text">{label}</span><span className="block text-text-dim">{chargement === "chargement" ? "Actualisation…" : chargement === "partiel" ? "Partiel" : chargement === "erreur" ? "Source indisponible" : chargement === "pret" ? "Actualisé" : id === "liquidite" || id === "geo" ? "Acquis seulement" : "En attente"}</span>{id === "quadrant" && etat.macroZones.total > 0 && <span className="block text-text-dim">{etat.macroZones.pretes}/{etat.macroZones.total} zones prêtes · {etat.macroZones.attente} en attente · {etat.macroZones.indisponibles} indisponibles</span>}</>;
    } },
    { id: "constat", label: "Constat / horizon", largeur: "2.4fr", rendu: ({ id }) => {
      const lectures = lecturesDomaine(id);
      return lectures.length === 0 ? "Aucune lecture acquise dans ce domaine." : <>{lectures.map((lecture) => <span key={lecture.id} className="block">{lecture.conclusion} · {date(lecture.horizon.depuis)} → {date(lecture.horizon.jusqua)} UTC</span>)}</>;
    } },
    { id: "qualite", label: "Qualité / couverture", largeur: "1fr", rendu: ({ id }) => {
      const lectures = lecturesDomaine(id);
      return lectures.length === 0 ? "—" : <>{lectures.map((lecture) => <span key={lecture.id} className="block">{lecture.statut} · {lecture.couverture ? `${lecture.couverture.presentes}/${lecture.couverture.attendues}` : "couverture inconnue"}</span>)}</>;
    } },
    { id: "preuve", label: "Preuve", largeur: "2fr", rendu: ({ id }) => {
      const lectures = lecturesDomaine(id);
      return lectures.length === 0 ? "—" : <>{lectures.map((lecture) => <span key={lecture.id} className="block">{lecture.source} · <button type="button" className="underline" onClick={() => windowManagerStore.getState().openWindow(FENETRE_PREUVE[lecture.preuve.fenetre])}>Voir {lecture.preuve.fenetre}</button> · {lecture.preuve.reference}</span>)}</>;
    } },
  ];
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
    <div className="overflow-x-auto"><div className="min-w-[620px]"><TableTriable ariaLabel="Lectures par domaine" colonnes={colonnes} lignes={DOMAINES} cle={(ligne) => ligne.id} /></div></div>
    {etat.reference && <div className="space-y-1"><h4 className="font-medium text-text">Depuis la référence</h4>{changements.length ? <ul className="space-y-1 text-text-dim">{changements.map((c) => <li key={c.identite}>{c.identite} · règle {c.regle} · {c.delta === null ? c.description : `Δ ${c.delta.toFixed(2)} ${c.apres?.unite ?? ""}`}</li>)}</ul> : <p className="text-text-dim">Aucune dimension à comparer.</p>}</div>}
    <NoteSource>La règle TVL 30 j / prix spot ETH, SOL ou ARB compare le signe du gain de part en points à celui du rendement du token sur les mêmes bougies quotidiennes closes. Une opposition est une divergence descriptive, jamais une contradiction logique ni un flux d'investisseurs. Base n'a pas de token de référence. DOM fournit seulement la médiane 1 min acquise ; GLOBE seulement un scénario choisi. Les horizons, sources et propositions incompatibles restent non comparables. Aucun score global.</NoteSource>
  </section>;
}
