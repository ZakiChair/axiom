import { useEffect, useState } from "react";
import { chargerQuadrants, lecturesQuadrants, type AxeQuadrant, type PointQuadrant, type ResultatQuadrants, type SensQuadrant } from "../../data/macro/quadrants";
import type { RegionMacro } from "../../data/macro/catalogueMacro";
import { remplacerLectures } from "../../store/analyseMultidomaine";
import { Chargement, ErreurBloc, NoteSource, Vide } from "../ui";

const sensTexte: Record<SensQuadrant, string> = { accelere: "accélère", decelere: "décélère", stable: "stable", inconnu: "inconnu" };
const nombre = (valeur: number | null): string => valeur === null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(valeur);
const date = (ms: number | null): string => ms === null ? "inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(ms);

function axeTexte(nom: string, axe: AxeQuadrant): string {
  if (axe.sens === "inconnu") return `${nom} inconnu · ${axe.motif ?? "donnée manquante"}`;
  return `${nom} ${sensTexte[axe.sens]} · ${axe.periodePrecedente} ${nombre(axe.precedent)} % → ${axe.periodeCourante} ${nombre(axe.courant)} % · Δ ${nombre(axe.deltaPp)} pp · ${axe.perimetre}${axe.perime ? ` · historique conservé/périmé${axe.motif ? ` : ${axe.motif}` : ""}` : ""}`;
}

function LigneQuadrant({ point }: { point: PointQuadrant }) {
  return <li className="rounded border border-border p-2 text-[11px]">
    <div className="flex flex-wrap items-center justify-between gap-1 font-medium text-text">
      <span>{point.mois} · fin de période {date(point.finPeriode)}</span>
      <span>{point.quadrant ? `croissance ${sensTexte[point.croissance.sens]}, inflation ${sensTexte[point.inflation.sens]}` : "quadrant indéterminé"}</span>
    </div>
    <div className="mt-1 text-text-dim">{axeTexte("Production industrielle a/a", point.croissance)}</div>
    <div className="text-text-dim">{axeTexte("CPI a/a", point.inflation)}</div>
    {point.pib && <div className="text-text-dim">Contexte PIB réel a/a distinct : {nombre(point.pib.valeur)} % · {point.pib.periode} · {point.pib.source}</div>}
    {point.transition && <div className="text-accent">Transition : {point.transition.de} → {point.transition.vers}</div>}
    <div className="text-[10px] text-text-dim">Sources : {point.croissance.source} / {point.inflation.source} · récupération {date(Math.max(point.croissance.recupereLe ?? 0, point.inflation.recupereLe ?? 0) || null)}</div>
  </li>;
}

export function QuadrantsMacroVue({ resultat, chargement, erreur }: { resultat: ResultatQuadrants | null; chargement: boolean; erreur: string | null }) {
  if (chargement && !resultat) return <Chargement libelle="Quadrants macro…" />;
  if (erreur) return <ErreurBloc>{erreur}</ErreurBloc>;
  if (!resultat) return <Vide>Quadrants indisponibles.</Vide>;
  return <section aria-label="Quadrants croissance et inflation" className="space-y-2">
    <p className="text-[11px] text-text-dim">Δ du rythme annuel entre M et M−3 (points de pourcentage) ; quatre mois consécutifs requis. Un Δ nul à ±10⁻⁹ pp est stable et ne donne pas de quadrant.</p>
    {resultat.regions.map((zone) => {
      const dernier = zone.points.at(-1);
      return <div key={zone.region} className="space-y-1">
        <h4 className="text-[11px] font-semibold text-text">{zone.region}</h4>
        {dernier ? <>
          <ul><LigneQuadrant point={dernier} /></ul>
          {zone.points.length > 1 && <details className="text-[10px] text-text-dim"><summary className="cursor-pointer">Historique et transitions · {zone.points.length} périodes</summary><ul className="mt-1 space-y-1">{zone.points.slice(0, -1).reverse().map((point) => <LigneQuadrant key={point.mois} point={point} />)}</ul></details>}
        </> : <p className="text-[11px] text-warn">Quadrant indéterminé · {zone.raison ?? "données indisponibles"}</p>}
      </div>;
    })}
    <NoteSource>Dates = périodes observées, distinctes des publications et de la récupération. {resultat.connuLe ? `Vue ALFRED au ${resultat.connuLe} pour les seules séries FRED ; date civile sans heure de publication.` : "Sources courantes révisables ; transitions historiques non certifiées connues à la date affichée."} Une observation ancienne reste classée si ses quatre mois sont disponibles ; la récupération et l'état de cache qualifient séparément sa fraîcheur. Production industrielle = proxy de croissance ; PIB trimestriel affiché à part. Périmètres nationaux différents.</NoteSource>
  </section>;
}

/** Charge seulement à l'ouverture de la sous-section ; aucune requête sur le chemin chaud. */
export function QuadrantsMacro({ regions, connuLe, refreshToken }: { regions: readonly RegionMacro[]; connuLe: string | null; refreshToken: number }) {
  const [resultat, setResultat] = useState<ResultatQuadrants | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setResultat(null); setChargement(true); setErreur(null);
    remplacerLectures("quadrant", []);
    void chargerQuadrants({ regions, connuLe, signal: ctrl.signal, force: refreshToken > 0 }).then((value) => {
      if (ctrl.signal.aborted || value === null) return;
      setResultat(value);
      remplacerLectures("quadrant", lecturesQuadrants(value));
    }).catch((cause: unknown) => {
      if (!ctrl.signal.aborted) setErreur(cause instanceof Error ? cause.message : "Quadrants indisponibles.");
    }).finally(() => { if (!ctrl.signal.aborted) setChargement(false); });
    return () => ctrl.abort();
  }, [regions, connuLe, refreshToken]);
  return <QuadrantsMacroVue resultat={resultat} chargement={chargement} erreur={erreur} />;
}
