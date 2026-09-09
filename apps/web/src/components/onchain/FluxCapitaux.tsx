import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { Comparateur, MetriqueFluxCapitaux as MetriqueAlerte } from "@axiom/alerts";
import { fluxCapitauxStore, retenirFluxCapitaux, type FluxCapitauxState } from "../../store/fluxCapitaux";
import { AGE_MAX_FLUX_MS, lireAccordsFlux, type MetriqueFluxCapitaux } from "../../data/onchain/fluxCapitaux";
import { alertsStore } from "../../store/alerts";
import { formatPct, formatUsd } from "../../lib/format";
import { QualiteMetrique } from "../QualiteMetrique";
import { Badge, Chargement, ErreurBloc, NoteSource, TitreSection, Vide } from "../ui";

function valeur(v: number | null, unite: string): string {
  if (v === null) return "—";
  if (unite === "USD" || unite === "USD/BTC") return formatUsd(v);
  if (unite === "%" || unite === "% AUM/j") return `${formatPct(v)}${unite === "% AUM/j" ? " AUM/j" : ""}`;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${unite}`;
}

export function seuilAlerteFlux(metrique: MetriqueFluxCapitaux | null, saisie: string, now = Date.now()): number | null {
  const qualite = metrique?.qualite;
  if (!metrique || metrique.valeur === null || !Number.isFinite(metrique.valeur) || qualite?.statut !== "frais" || saisie.trim() === "" ||
    metrique.observeLe === null || !Number.isFinite(metrique.observeLe) || qualite.observeLe !== metrique.observeLe ||
    qualite.recupereLe === null || !Number.isFinite(qualite.recupereLe) || qualite.cadenceMs === null || !Number.isFinite(qualite.cadenceMs) || qualite.cadenceMs <= 0 ||
    !Number.isFinite(now) || metrique.observeLe > now || qualite.recupereLe > now || now - metrique.observeLe > AGE_MAX_FLUX_MS) return null;
  const seuil = Number(saisie);
  return Number.isFinite(seuil) ? seuil : null;
}

export function VueFluxCapitaux({ donnees, chargement, erreur, titre = true }: FluxCapitauxState & { titre?: boolean }) {
  const [selection, setSelection] = useState<MetriqueAlerte | null>(null);
  const [comparateur, setComparateur] = useState<Comparateur>(">=");
  const [seuil, setSeuil] = useState("");
  const [confirmation, setConfirmation] = useState(false);
  const metriqueSelectionnee = useMemo(() => donnees?.metriques.find((m) => m.id === selection) ?? null, [donnees, selection]);
  const lectures = useMemo(() => lireAccordsFlux(donnees?.metriques ?? []), [donnees]);
  const seuilValide = seuilAlerteFlux(metriqueSelectionnee, seuil);
  if (!donnees && chargement) return <Chargement libelle="Flux de capitaux…" />;
  if (!donnees) return erreur ? <ErreurBloc>{erreur}</ErreurBloc> : <Vide>Flux de capitaux indisponibles.</Vide>;
  return <section className="space-y-2">
    {titre && <TitreSection>Flux de capitaux alignés</TitreSection>}
    <div className="grid gap-2 md:grid-cols-2">
      {donnees.metriques.map((metrique) => <article key={metrique.id} className="rounded border border-border bg-bg p-2">
        <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] text-text-dim">{metrique.libelle} · {metrique.periode}</p><p className="tabular-nums text-sm text-text">{valeur(metrique.valeur, metrique.unite)}</p></div>
          {metrique.alerte && <button type="button" disabled={seuilAlerteFlux(metrique, String(metrique.valeur ?? "")) === null} onClick={() => { setSelection(metrique.id as MetriqueAlerte); setSeuil(String(metrique.valeur ?? "")); setConfirmation(false); }} className="text-[9px] text-accent disabled:text-text-dim">Créer une alerte</button>}
        </div>
        {metrique.qualite ? <QualiteMetrique qualite={metrique.qualite} /> : <p className="text-[9px] text-text-dim">{metrique.source} · observation indisponible</p>}
      </article>)}
    </div>
    {lectures.length > 0 && <div className="space-y-1 rounded border border-border bg-surface p-2 text-[10px]">
      {lectures.map((lecture) => <p key={lecture.id}><strong className="text-text">{lecture.titre}</strong><span className="text-text-dim"> · {lecture.detail}</span></p>)}
    </div>}
    {metriqueSelectionnee && <div className="rounded border border-accent/50 bg-surface p-2 text-[10px]">
      <p className="mb-1 text-text">Alerte · {metriqueSelectionnee.libelle} ({metriqueSelectionnee.unite}) · source {metriqueSelectionnee.source}</p>
      <div className="flex flex-wrap items-center gap-1"><select value={comparateur} onChange={(e) => setComparateur(e.target.value as Comparateur)} className="rounded border border-border bg-bg px-1 py-0.5">{[">", ">=", "<", "<="].map((op) => <option key={op}>{op}</option>)}</select>
        <input aria-label="Seuil de l'alerte flux" value={seuil} onChange={(e) => setSeuil(e.target.value)} className="w-28 rounded border border-border bg-bg px-1 py-0.5" />
        <span>{metriqueSelectionnee.unite}</span>
        <button type="button" disabled={seuilValide === null} className="rounded border border-accent px-2 py-0.5 text-accent disabled:text-text-dim" onClick={() => { const n = seuilAlerteFlux(metriqueSelectionnee, seuil); if (n === null || selection === null) return; alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", condition: { type: "flux-capitaux-seuil", metrique: selection, comparateur, valeur: n } }); setConfirmation(true); }}>Créer</button>
        {confirmation && <Badge ton="up">alerte créée</Badge>}
      </div>
    </div>}
    <NoteSource>Niveaux, variations et périodes sont affichés séparément ; ils ne sont pas additionnés en score. Un ratio ETF utilise uniquement le flux et l’encours publiés pour la même séance. Une donnée absente ou périmée ne peut pas créer ni déclencher une alerte.</NoteSource>
    {erreur && <ErreurBloc>{erreur}</ErreurBloc>}
  </section>;
}

export function FluxCapitaux({ titre = true }: { titre?: boolean }) {
  const etat = useStore(fluxCapitauxStore);
  useEffect(() => retenirFluxCapitaux(), []);
  return <VueFluxCapitaux {...etat} titre={titre} />;
}
