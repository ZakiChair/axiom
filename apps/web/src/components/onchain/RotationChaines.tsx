import { useEffect, useMemo, useState } from "react";
import type { EconomieChainesResultat, MetriqueEconomie, ChaineEconomieId } from "../../data/onchain/economieChaines";
import { calculerRotationChaines, lectureRotation, referencePrixChaine, type HorizonRotation } from "../../data/onchain/rotationChaines";
import { chargerPrixRotation, type PrixRotation } from "../../data/onchain/prixRotation";
import { remplacerLectures } from "../../store/analyseMultidomaine";
import { NoteSource } from "../ui";

const METRIQUES: Array<{ id: MetriqueEconomie; label: string }> = [
  { id: "tvl", label: "TVL · stock" }, { id: "stablecoins", label: "Stablecoins · stock" },
  { id: "dex", label: "DEX · flux/j" }, { id: "frais", label: "Frais · flux/j" }, { id: "revenus", label: "Revenus · flux/j" },
];
const nombre = (v: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const pct = (v: number | null, suffixe = "%") => v === null ? "—" : `${v >= 0 ? "+" : ""}${nombre(v)} ${suffixe}`;
const date = (v: number | null) => v === null ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(v);

export function RotationChaines({ donnees }: { donnees: EconomieChainesResultat }) {
  const [metrique, setMetrique] = useState<MetriqueEconomie>("tvl");
  const [horizon, setHorizon] = useState<HorizonRotation>(30);
  const [prix, setPrix] = useState<Partial<Record<ChaineEconomieId, PrixRotation | null>>>({});
  const resultat = useMemo(() => calculerRotationChaines(donnees, metrique, horizon, Date.now()), [donnees, metrique, horizon]);
  useEffect(() => {
    remplacerLectures("rotation", resultat.chaines.map((chaine) => lectureRotation(resultat, chaine.id)));
  }, [resultat]);
  useEffect(() => {
    let actif = true;
    setPrix({});
    if (resultat.dateDebut === null || resultat.dateFin === null) return;
    const maintenant = Date.now();
    void Promise.all(resultat.chaines.map(async (chaine) => {
      const value = await chargerPrixRotation(chaine.id, resultat.dateDebut!, resultat.dateFin!, maintenant);
      return [chaine.id, value] as const;
    })).then((values) => { if (actif) setPrix(Object.fromEntries(values)); });
    return () => { actif = false; };
  }, [resultat]);
  return <section aria-label="Rotation historique des chaînes" className="space-y-2 rounded border border-border p-2 text-[10px]">
    <h4 className="text-[11px] font-semibold text-text">Rotation historique · cohorte fixe Ethereum / Solana / Base / Arbitrum</h4>
    <div className="flex flex-wrap gap-1">
      {METRIQUES.map((item) => <button key={item.id} type="button" aria-pressed={metrique === item.id} onClick={() => setMetrique(item.id)} className={`rounded border px-1.5 py-0.5 ${metrique === item.id ? "border-accent text-accent" : "border-border text-text-dim"}`}>{item.label}</button>)}
      {([30, 90] as const).map((jours) => <button key={jours} type="button" aria-pressed={horizon === jours} onClick={() => setHorizon(jours)} className={`rounded border px-1.5 py-0.5 ${horizon === jours ? "border-accent text-accent" : "border-border text-text-dim"}`}>{jours} j</button>)}
    </div>
    <p className="text-text-dim">Dates communes exactes : {date(resultat.dateDebut)} → {date(resultat.dateFin)} · couverture {resultat.couverture.presentes}/4 · {resultat.source} · récup. {date(resultat.recupereLe)}{resultat.perime ? " · série périmée" : ""}</p>
    {resultat.limites.map((limite) => <p key={limite} className="text-warn">{limite}</p>)}
    <div className="overflow-x-auto"><table className="w-full min-w-[630px] text-left tabular-nums"><thead><tr className="text-text-dim"><th>Chaîne</th><th>Niveau début → fin</th><th>Part début → fin</th><th>Δ part</th><th>Δ niveau</th><th>Gains quotidiens</th><th>Prix référence</th></tr></thead><tbody>{resultat.chaines.map((ligne) => {
      const ref = referencePrixChaine(ligne.id);
      const p = prix[ligne.id];
      return <tr key={ligne.id} className="border-t border-border text-text"><td className="py-1 capitalize">{ligne.id}</td><td>{ligne.niveauDebut?.toLocaleString("fr-FR") ?? "—"} → {ligne.niveauFin?.toLocaleString("fr-FR") ?? "—"} USD</td><td>{ligne.partDebutPct === null ? "—" : nombre(ligne.partDebutPct)} → {ligne.partFinPct === null ? "—" : nombre(ligne.partFinPct)} %</td><td>{pct(ligne.deltaPartPp, "pp")}</td><td>{pct(ligne.croissanceNiveauPct)}</td><td>{ligne.persistance.gains}/{ligne.persistance.transitions} transitions · {ligne.persistance.joursCouverts} jours couverts</td><td>{ref === null ? "Base : aucun token natif" : resultat.dateDebut === null || resultat.dateFin === null ? `${ref} · dates/prix indisponibles` : p === undefined ? `${ref} · chargement…` : p === null ? `${ref} · dates/prix indisponibles` : `${ref} · ${pct(p.variationPct)} · ${p.source} ${p.periode}`}</td></tr>;
    })}</tbody></table></div>
    <NoteSource>Parts = valeur de chaque chaîne / somme des quatre, à dates identiques. Persistance = proportion des transitions de jours consécutifs avec gain de part ; les trous ne comptent pas. Les flux sont des montants journaliers USD comparés à deux jours distants de {horizon} jours, jamais des entrées nettes. TVL USD varie aussi avec les prix. Les prix spot de référence sont distincts des métriques de chaîne, cotés en USDT et retenus uniquement si les bougies journalières sont closes aux deux dates exactes.</NoteSource>
  </section>;
}
