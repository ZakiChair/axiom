import { useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Condition, Operande, StatsBacktest } from "@axiom/backtest";
import { comparerArchives, encoderArchive, type ArchiveRunBacktest } from "../data/backtestArchive";
import { CATALOGUE_OPERANDES, configCourante, backtestStore } from "../store/backtest";
import { backtestHistoryStore } from "../store/backtestHistory";
import { formatDateComplete, formatDec } from "../lib/format";
import { BTN_SECONDAIRE, ErreurBloc, Input, NoteSource, Select, TitreSection } from "./ui";
import { TableTriable, type ColonneTable } from "./TableTriable";

const STATS: { cle: keyof StatsBacktest; libelle: string }[] = [
  { cle: "nbTrades", libelle: "Trades" }, { cle: "winRatePct", libelle: "Réussite %" },
  { cle: "profitFactor", libelle: "Profit factor" }, { cle: "pnlTotal", libelle: "PnL net" },
  { cle: "pnlTotalPct", libelle: "PnL %" }, { cle: "maxDrawdownPct", libelle: "Drawdown %" },
  { cle: "sharpe", libelle: "Sharpe" }, { cle: "expositionPct", libelle: "Exposition %" },
  { cle: "expectancyR", libelle: "Expectancy R" }, { cle: "maeMoyenPct", libelle: "MAE %" },
  { cle: "mfeMoyenPct", libelle: "MFE %" },
];

function nombre(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v === Infinity ? "∞" : formatDec(v);
}

function dateBorne(ms: number): string {
  return `${formatDateComplete(ms)} ${new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function libelleOperande(op: Operande): string {
  if (op.type === "prix") return `Prix ${op.champ}`;
  if (op.type === "constante") return String(op.valeur);
  const spec = CATALOGUE_OPERANDES.find((s) => s.id === `${op.indicateurId}:${op.output}`);
  const params = Object.entries(op.params).map(([cle, valeur]) => `${cle} ${valeur}`).join(", ");
  return `${spec?.label ?? `${op.indicateurId} · ${op.output}`}${params ? ` (${params})` : ""}`;
}

function libelleRegle(regle: Condition): string {
  return regle.type === "comparaison"
    ? `${libelleOperande(regle.gauche)} ${regle.comparateur} ${libelleOperande(regle.droite)}`
    : `${libelleOperande(regle.a)} croise ${regle.sens === "hausse" ? "à la hausse" : "à la baisse"} ${libelleOperande(regle.b)}`;
}

function Regles({ regles }: { regles: Condition[] }) {
  return regles.length === 0 ? <span>aucune</span> : <ol className="space-y-0.5">{regles.map((r, i) => <li key={i}>{i + 1}. {libelleRegle(r)}</li>)}</ol>;
}

interface LigneComparaison {
  id: string;
  libelle: string;
  a: ReactNode;
  b: ReactNode;
  delta: string;
  numerique?: boolean;
}

const COLONNES_COMPARAISON: ColonneTable<LigneComparaison>[] = [
  { id: "libelle", label: "Paramètre / stat", largeur: "minmax(11rem, 27fr)", triable: false, rendu: (l) => l.libelle },
  { id: "a", label: "A", largeur: "minmax(12rem, 29fr)", triable: false, rendu: (l) => <span className={l.numerique ? "block text-right" : "block break-words"}>{l.a}</span> },
  { id: "b", label: "B", largeur: "minmax(12rem, 29fr)", triable: false, rendu: (l) => <span className={l.numerique ? "block text-right" : "block break-words"}>{l.b}</span> },
  { id: "delta", label: "Δ B − A", align: "right", largeur: "minmax(7rem, 15fr)", triable: false, rendu: (l) => l.delta },
];

function lignesComparaison(a: ArchiveRunBacktest, b: ArchiveRunBacktest, deltas: ReturnType<typeof comparerArchives>["deltas"]): LigneComparaison[] {
  const ligne = (id: string, libelle: string, valeurA: ReactNode, valeurB: ReactNode): LigneComparaison =>
    ({ id, libelle, a: valeurA, b: valeurB, delta: "—" });
  return [
    ligne("marche", "Marché · source · TF", `${a.config.symbol} · ${a.source} · ${a.config.tf}`, `${b.config.symbol} · ${b.source} · ${b.config.tf}`),
    ligne("bornes", "Bornes réelles", `${dateBorne(a.donnees.premiereBougieMs)} → ${dateBorne(a.donnees.derniereBougieMs)}`, `${dateBorne(b.donnees.premiereBougieMs)} → ${dateBorne(b.donnees.derniereBougieMs)}`),
    ligne("execution", "Direction · intrabar · funding", `${a.config.direction} · ${a.config.intrabar ? "oui" : "non"} · ${a.funding.modele}`, `${b.config.direction} · ${b.config.intrabar ? "oui" : "non"} · ${b.funding.modele}`),
    ligne("taille", "Plage · taille · risque", `${a.config.plage} · ${a.config.tailleFixe} · ${a.config.risquePct ?? "—"}%`, `${b.config.plage} · ${b.config.tailleFixe} · ${b.config.risquePct ?? "—"}%`),
    ligne("stop", "Stop % · ATR · objectif %", `${a.config.stopPct ?? "—"} · ${a.config.stopAtr ? `${a.config.stopAtr.length}×${a.config.stopAtr.mult}` : "—"} · ${a.config.targetPct ?? "—"}`, `${b.config.stopPct ?? "—"} · ${b.config.stopAtr ? `${b.config.stopAtr.length}×${b.config.stopAtr.mult}` : "—"} · ${b.config.targetPct ?? "—"}`),
    ligne("couts", "Capital · frais · slippage", `${a.config.capitalInitial} · ${a.config.fraisPct}% · ${a.config.slippagePct}%`, `${b.config.capitalInitial} · ${b.config.fraisPct}% · ${b.config.slippagePct}%`),
    ligne("entree", "Règles d'entrée", <Regles regles={a.config.reglesEntree} />, <Regles regles={b.config.reglesEntree} />),
    ligne("sortie", "Règles de sortie", <Regles regles={a.config.reglesSortie} />, <Regles regles={b.config.reglesSortie} />),
    ...STATS.map(({ cle, libelle }) => ({ id: cle, libelle, a: nombre(a.stats[cle]), b: nombre(b.stats[cle]), delta: nombre(deltas?.[cle]), numerique: true })),
  ];
}

function telecharger(nom: string, contenu: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: "application/json;charset=utf-8" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function EtiquetteRun({ run }: { run: ArchiveRunBacktest }) {
  return <>{dateBorne(run.creeMs)} · {run.config.symbol} {run.config.tf} · {run.source === "binance-perp" ? "perp" : "spot"}</>;
}

export function BacktestHistory() {
  const runs = useStore(backtestHistoryStore, (s) => s.runs);
  const versions = useStore(backtestHistoryStore, (s) => s.versions);
  const erreur = useStore(backtestHistoryStore, (s) => s.erreurSauvegarde);
  const reessaiPossible = useStore(backtestHistoryStore, (s) => s.reessaiPossible);
  const brutOriginal = useStore(backtestHistoryStore, (s) => s.brutOriginal);
  const [nom, setNom] = useState("");
  const [idA, setIdA] = useState("");
  const [idB, setIdB] = useState("");
  const a = runs.find((r) => r.id === idA) ?? null;
  const b = runs.find((r) => r.id === idB) ?? null;
  const comparaison = a !== null && b !== null && a.id !== b.id ? comparerArchives(a, b) : null;
  const lignes = comparaison !== null && a !== null && b !== null ? lignesComparaison(a, b, comparaison.deltas) : [];

  return <section className="space-y-3 rounded-md border border-border bg-bg px-3 py-2.5" aria-label="Historique Backtest">
    <TitreSection>Versions et historique BT</TitreSection>
    <NoteSource>Archive synthétique : configuration, provenance et statistiques seulement. Les bougies, la courbe et la table complète des trades ne sont pas restaurées. Charger une version ne lance aucun calcul.</NoteSource>
    {erreur !== null && <div role="alert"><ErreurBloc>{erreur}</ErreurBloc>
      {brutOriginal !== null && <button type="button" className={BTN_SECONDAIRE} onClick={() => {
        telecharger("axiom-backtest-sauvegarde-origine.json", brutOriginal);
        backtestHistoryStore.getState().confirmerExportOriginal();
      }}>Exporter la sauvegarde d'origine</button>}
      {reessaiPossible && <button type="button" className={BTN_SECONDAIRE} onClick={() => backtestHistoryStore.getState().reessayerSauvegarde()}>Réessayer la sauvegarde</button>}
    </div>}

    <div className="space-y-1.5">
      <div className="flex items-center gap-2"><strong className="text-xs">Versions ({versions.length}/50)</strong>
        <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de version complète" aria-label="Nom de version complète" className="min-w-0 flex-1" />
        <button type="button" className={BTN_SECONDAIRE} disabled={!nom.trim() || versions.length >= 50} onClick={() => {
          const id = backtestHistoryStore.getState().sauverVersion(nom, configCourante(backtestStore.getState()));
          if (id !== null) setNom("");
        }}>Sauver version</button>
      </div>
      {versions.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-2 border-b border-border/50 py-1 text-xs">
        <span className="min-w-0 flex-1">{version.nom} · {version.config.symbol} {version.config.tf} · {dateBorne(version.creeMs)}</span>
        <button type="button" className={BTN_SECONDAIRE} onClick={() => backtestStore.getState().appliquerConfig(version.config)}>Charger</button>
        <button type="button" className={BTN_SECONDAIRE} onClick={() => backtestHistoryStore.getState().supprimerVersion(version.id)} aria-label={`Supprimer la version ${version.nom}`}>Supprimer</button>
      </div>)}
    </div>

    <div className="space-y-1.5">
      <div className="flex items-center justify-between"><strong className="text-xs">Runs réussis ({runs.length}/50)</strong>
        <button type="button" className={BTN_SECONDAIRE} onClick={() => telecharger("axiom-backtest-historique.json", backtestHistoryStore.getState().exporterJSON())}>Exporter JSON valide</button>
      </div>
      {runs.length === 0 && <p className="text-xs text-text-dim">Aucun run archivé.</p>}
      {runs.map((run) => <div key={run.id} className="border-b border-border/50 py-1 text-xs">
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1"><EtiquetteRun run={run} /> · PnL {nombre(run.stats.pnlTotal)}</span>
          <button type="button" className={BTN_SECONDAIRE} onClick={() => telecharger(`axiom-backtest-${run.id}.json`, encoderArchive(run))}>Exporter</button>
          <button type="button" className={BTN_SECONDAIRE} onClick={() => backtestHistoryStore.getState().supprimerRun(run.id)} aria-label={`Supprimer le run ${run.id}`}>Supprimer</button>
        </div>
        <p className="text-[10px] text-text-dim">Données {dateBorne(run.donnees.premiereBougieMs)} → {dateBorne(run.donnees.derniereBougieMs)} · {run.donnees.nbBougies} bougies · funding {run.funding.modele} · couverture {run.funding.couverture?.etat ?? "sans objet"}</p>
      </div>)}
    </div>

    {runs.length >= 2 && <div className="space-y-2" aria-label="Comparer deux runs BT">
      <TitreSection>Comparer deux runs</TitreSection>
      <div className="grid grid-cols-2 gap-2">
        {[idA, idB].map((id, i) => <Select key={i} value={id} onChange={(e) => (i === 0 ? setIdA(e.target.value) : setIdB(e.target.value))} aria-label={i === 0 ? "Run A" : "Run B"}>
          <option value="">Choisir run {i === 0 ? "A" : "B"}</option>
          {runs.map((run) => <option key={run.id} value={run.id}>{dateBorne(run.creeMs)} · {run.config.symbol} {run.config.tf} · {run.id.slice(-6)}</option>)}
        </Select>)}
      </div>
      {comparaison !== null && a !== null && b !== null && <>
        <p className="text-[11px] text-text-dim">{comparaison.comparable ? "Même marché, source, timeframe et bornes : deltas B − A." : "Fenêtres ou sources différentes : comparaison descriptive uniquement, aucun delta."} {comparaison.avertissements.join(" · ")}</p>
        <div className="overflow-x-auto"><div className="min-w-[44rem]"><TableTriable ariaLabel="Comparaison des runs BT" colonnes={COLONNES_COMPARAISON} lignes={lignes} cle={(l) => l.id} /></div></div>
      </>}
    </div>}
  </section>;
}
