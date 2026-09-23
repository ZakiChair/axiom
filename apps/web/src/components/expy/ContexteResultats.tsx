import { useMemo, useState } from "react";
import type { TradeJournal } from "../../data/expy";
import type { DossierDecision } from "../../data/decisionDossier";
import { analyserContextes, statistiquesR, type GroupeContexte, type LigneContexte } from "../../data/expyContexte";
import { formatDec } from "../../lib/format";
import { TitreSection } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";

const fmt = (n: number | null, digits = 2): string => n === null ? "—" : formatDec(n, digits);
const date = (ts: number | null): string => ts === null ? "—" : new Date(ts).toLocaleDateString("fr-FR", { timeZone: "UTC" });

const COLONNES_GROUPES: ColonneTable<GroupeContexte>[] = [
  { id: "etat", label: "État", largeur: "1.2fr", rendu: (g) => g.cle === "non-prouve" ? "Contexte non prouvé" : g.cle === "mixte" ? "Contexte mixte" : g.cle },
  { id: "effectifs", label: "Total fermé / n R / sans R", largeur: "1.2fr", rendu: (g) => `${g.total} / ${g.statistiques.nR} / ${g.sansR}` },
  { id: "centre", label: "R moyen / médian", rendu: (g) => `${fmt(g.statistiques.moyenne)} / ${fmt(g.statistiques.mediane)} R` },
  { id: "dispersion", label: "Dispersion s / SE", rendu: (g) => `${fmt(g.statistiques.ecartType)} / ${fmt(g.statistiques.erreurType)}` },
  { id: "issues", label: "Gains / pertes / zéro", rendu: (g) => `${g.statistiques.gains} / ${g.statistiques.pertes} / ${g.statistiques.breakeven}` },
  { id: "gain", label: "Gain / PF", rendu: (g) => `${g.statistiques.winRate === null ? "—" : `${fmt(g.statistiques.winRate * 100, 1)} %`} / ${g.statistiques.nR === 0 ? "—" : g.statistiques.profitFactor === null ? "indéfini (sans perte)" : fmt(g.statistiques.profitFactor)}` },
  { id: "periode", label: "Période UTC / jours", largeur: "1.3fr", rendu: (g) => `${date(g.debut)} → ${date(g.fin)} · ${g.joursDistincts} j` },
];
const COLONNES_LIGNES: ColonneTable<LigneContexte>[] = [
  { id: "trade", label: "Trade", rendu: (l) => l.tradeId },
  { id: "etat", label: "État d'entrée", rendu: (l) => l.cle },
  { id: "capture", label: "Capture(s)", rendu: (l) => l.lectures.map((v) => date(v.captureLe)).join(" · ") || "—" },
  { id: "valeurs", label: "Valeur(s) archivée(s)", largeur: "2fr", rendu: (l) => l.lectures.map((v) => `${v.nature === "scenario-conditionnel" ? "scénario : " : ""}${v.conclusion} · ${v.valeur === null ? "—" : `${fmt(v.valeur)} ${v.unite ?? ""}`} (${v.statut})`).join(" ; ") || "—" },
  { id: "r", label: "R brut", rendu: (l) => `${fmt(l.r)} R` },
];

/** Cohortes descriptives ; toutes les valeurs proviennent des dossiers persistés. */
export function ContexteResultats({ trades, dossiers }: { trades: readonly TradeJournal[]; dossiers: readonly DossierDecision[] }) {
  const [selection, setSelection] = useState("");
  const inventaire = useMemo(() => analyserContextes(trades, dossiers, selection), [trades, dossiers, selection]);
  const dimension = inventaire.dimensions.includes(selection) ? selection : inventaire.dimensions[0] ?? "";
  const resultat = useMemo(() => analyserContextes(trades, dossiers, dimension), [trades, dossiers, dimension]);
  const ensemble = useMemo(() => statistiquesR(resultat.lignes.flatMap((l) => l.r === null ? [] : [l.r])), [resultat]);
  const nonProuve = resultat.groupes.find((g) => g.cle === "non-prouve")?.total ?? 0;
  const categorique = dimension.startsWith("quadrant:") || dimension.startsWith("divergence:");
  const conditionnel = dimension.startsWith("geo:");
  return <section aria-label="Résultats par contexte archivé" className="space-y-2 rounded border border-border/60 p-3 text-xs">
    <TitreSection>Résultats par contexte archivé</TitreSection>
    <p className="text-text-dim">R prix brut sur trades fermés sourcés, sans frais ni funding. Contexte figé au signal ; aucun régime actuel ou série révisée n'est appliqué aux anciens trades. MAE/MFE non mesurées : aucune trajectoire détenue archivée.</p>
    <p>Total {resultat.total} trade(s) fermé(s) sourcé(s), identifiants uniques. Les groupes forment une partition pour cette seule dimension.</p>
    <p>Ensemble descriptif : n R {ensemble.nR}, sans R {resultat.exclusions.sansR}, moyenne {fmt(ensemble.moyenne)} R, médiane {fmt(ensemble.mediane)} R, dispersion s {fmt(ensemble.ecartType)}, erreur type {fmt(ensemble.erreurType)}, gains/pertes/zéro {ensemble.gains}/{ensemble.pertes}/{ensemble.breakeven}.</p>
    {(dimension === "" || categorique) && <p>Contexte non prouvé : {nonProuve} trade(s).</p>}
    <p className="text-text-dim">Exclusions et limites : {resultat.exclusions.ouverts} ouverts ; {resultat.exclusions.sansSource} sans source ; {resultat.exclusions.dateInvalide} dates invalides ; {resultat.exclusions.sansR} sans R ; {resultat.exclusions.dossierAbsent} dossier(s) absents ; {resultat.exclusions.autreIdentite} autre instrument/source ; {resultat.exclusions.sansAnalyse} sans capture ; {resultat.exclusions.preuveInvalide} preuve invalide ; {resultat.exclusions.posterieurEntree} lectures après entrée ; {resultat.exclusions.posterieurCloture} dossiers après clôture ; {resultat.exclusions.lectureIncompatible} lectures instrumentées incompatibles.</p>
    {resultat.groupes.some((g) => g.statistiques.nR < 30) && <p className="text-text-dim">Petit échantillon (n R &lt; 30) pour au moins un groupe ; aucune conclusion de supériorité ni intervalle de confiance établi. Des trades proches ou chevauchants peuvent être corrélés.</p>}
    {resultat.dimensions.length === 0 ? <p className="text-text-dim">Aucune dimension archivée. Les signaux anciens restent de contexte inconnu.</p> : <>
      <label className="flex items-center gap-2">Dimension observée ou conditionnelle
        <select aria-label="Dimension de contexte" className="min-w-0 rounded border border-border bg-bg px-2 py-1" value={dimension} onChange={(e) => setSelection(e.target.value)}>
          {resultat.dimensions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {conditionnel && <p className="text-text-dim">Scénario géopolitique conditionnel archivé : visible par trade, sans cohorte d'observation.</p>}
      {!categorique && !conditionnel && <p className="text-text-dim">Mesure continue archivée : valeurs et R par trade. Aucun seuil de segmentation ajouté.</p>}
      {categorique && <div className="overflow-x-auto"><TableTriable ariaLabel="Cohortes par état archivé" colonnes={COLONNES_GROUPES} lignes={resultat.groupes} cle={(g) => g.cle} /></div>}
      {resultat.lignes.some((l) => l.lectures.length > 0) && <div className="overflow-x-auto"><TableTriable ariaLabel="Lectures archivées par trade" colonnes={COLONNES_LIGNES} lignes={resultat.lignes} cle={(l) => l.tradeId} maxHauteur="10rem" /></div>}
    </>}
  </section>;
}
