import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { partsADateCommune, type EconomieChaine, type MetriqueEconomie, type SerieEconomie } from "../../data/onchain/economieChaines";
import { economieChainesStore, retenirEconomieChaines } from "../../store/economieChaines";
import { formatPct, formatUsd } from "../../lib/format";
import { Badge, Chargement, ErreurBloc, NoteSource, TitreSection, Vide } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { CourbeOnchain, dateObservation } from "./HistoriqueCommun";

const SERIES: Array<{ id: MetriqueEconomie; label: string }> = [
  { id: "tvl", label: "TVL · stock" }, { id: "dex", label: "Volume DEX/j" },
  { id: "stablecoins", label: "Stablecoins · stock" }, { id: "frais", label: "Frais/j" },
  { id: "revenus", label: "Revenus/j" },
];
type Horizon = 30 | 90 | 365;

function variation(serie: SerieEconomie, horizon: Horizon): number | null {
  return horizon === 30 ? serie.resume.variation30jPct : horizon === 90 ? serie.resume.variation90jPct : serie.resume.variation365jPct;
}

function dateSerie(time: number | null): string {
  if (time === null || !Number.isFinite(time)) return "—";
  return `${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(time)} UTC`;
}

type EtatVueEconomie = ReturnType<typeof economieChainesStore.getState>;

export function VueEconomieChaines({ donnees, chargement, erreur, titre = true }: EtatVueEconomie & { titre?: boolean }) {
  const [horizon, setHorizon] = useState<Horizon>(30);
  if (!donnees && chargement) return <Chargement libelle="Économie des chaînes…" />;
  if (!donnees) return erreur ? <ErreurBloc>{erreur}</ErreurBloc> : <Vide>Économie des chaînes indisponible.</Vide>;
  const colonnes: ColonneTable<EconomieChaine>[] = [
    { id: "chaine", label: "Chaîne", largeur: "0.9fr", rendu: (chaine) => <span className="font-medium text-text">{chaine.libelle}</span> },
    ...SERIES.map(({ id, label }): ColonneTable<EconomieChaine> => ({
      id,
      label,
      align: "right",
      largeur: "1.25fr",
      rendu: (chaine) => {
        const serie = chaine[id]; const delta = variation(serie, horizon);
        return <span className="align-top tabular-nums">
          {serie.disponible ? <><span>{formatUsd(serie.resume.niveau)}</span><br/><span className={delta === null ? "text-text-dim" : delta >= 0 ? "text-up" : "text-down"}>{formatPct(delta)}</span>{serie.perime && <Badge ton="warn">périmé</Badge>}</> : <span className="text-text-dim">indisponible</span>}
          <span className="mt-0.5 block text-[8px] leading-tight text-text-dim">obs. {dateSerie(serie.resume.observeLe)}<br/>récup. {dateSerie(serie.recupereLe)}<br/>{serie.source}</span>
          {serie.raison && <span className="block text-[8px] leading-tight text-warn">{serie.raison}</span>}
        </span>;
      },
    })),
  ];
  return <section className="space-y-2">
    {titre && <TitreSection>Économie des chaînes</TitreSection>}
    <div className="flex items-center gap-1">
      {[30, 90, 365].map((jours) => <button key={jours} type="button" onClick={() => setHorizon(jours as Horizon)}
        className={`rounded border px-2 py-0.5 text-[10px] ${horizon === jours ? "border-accent text-accent" : "border-border text-text-dim"}`}>{jours} j</button>)}
      {chargement && <span className="text-[10px] text-text-dim">actualisation…</span>}
    </div>
    <div className="overflow-x-auto"><TableTriable ariaLabel="Économie comparée des chaînes" colonnes={colonnes} lignes={donnees.chaines} cle={(chaine) => chaine.id} /></div>
    <div className="grid gap-2 md:grid-cols-2">
      {SERIES.map(({ id, label }) => {
        const parts = partsADateCommune(donnees.chaines, id);
        return <div key={id} className="rounded border border-border bg-bg p-2">
          <p className="text-[10px] font-medium text-text">{label}</p>
          {parts ? <p className="text-[9px] text-text-dim">Parts au {dateObservation(parts.date)} · couverture {parts.couverture.disponibles}/{parts.couverture.attendus} · {parts.parts.map((p) => `${p.id} ${p.partPct.toFixed(1)} %`).join(" · ")}</p> : <p className="text-[9px] text-text-dim">Pas de date commune exploitable.</p>}
        </div>;
      })}
    </div>
    <details><summary className="cursor-pointer text-[10px] text-text-dim">Séries temporelles datées</summary>
      <div className="mt-2 grid gap-2 md:grid-cols-2">{donnees.chaines.flatMap((chaine) => SERIES.map(({ id, label }) => {
        const serie = chaine[id];
        return serie.serie.length > 1 ? <div key={`${chaine.id}-${id}`} className="rounded border border-border p-1.5"><p className="text-[9px] text-text-dim">{chaine.libelle} · {label}</p><CourbeOnchain points={serie.serie} label={`${chaine.libelle} · ${label}`} unite="USD" /></div> : null;
      }))}</div>
    </details>
    <NoteSource>DefiLlama public · cache 1 h · 3 appels simultanés maximum. TVL et stablecoins sont des stocks USD ; volumes DEX, frais et revenus sont des montants journaliers USD. Les séries restent distinctes. Les quantités natives sous-jacentes ne sont pas fournies ici ; la TVL USD n’est pas divisée par le prix de l’ETH.</NoteSource>
    {erreur && <ErreurBloc>{erreur}</ErreurBloc>}
  </section>;
}

export function EconomieChaines({ titre = true }: { titre?: boolean }) {
  const etat = useStore(economieChainesStore);
  useEffect(() => retenirEconomieChaines(), []);
  return <VueEconomieChaines {...etat} titre={titre} />;
}
