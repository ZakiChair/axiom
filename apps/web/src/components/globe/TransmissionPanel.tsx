import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ExchangeId } from "@axiom/types";
import type { EvenementDetail } from "../../data/globe/types";
import { DOCUMENTATION_CANAL, lectureTransmission, mesurerAutourEvenement, qualifierTransmission, urlSure, type CanalTransmission, type MesureQuotidienne } from "../../data/globe/transmission";
import { getAdapter } from "../../data/adapters";
import { lireLectures, remplacerLectures } from "../../store/analyseMultidomaine";
import { watchlistStore } from "../../store/watchlist";
import { marketStore } from "../../store/market";
import { windowManagerStore } from "../../store/windowManager";

const CANAUX = Object.keys(DOCUMENTATION_CANAL) as CanalTransmission[];
const date = (ms: number) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(ms);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} %`;

export function TransmissionPanel({ evenement, ingereLe }: { evenement: EvenementDetail; ingereLe: number | null }) {
  const watchlist = useStore(watchlistStore, (s) => s.symbols);
  const sources = useStore(watchlistStore, (s) => s.sources);
  const [canal, setCanal] = useState<CanalTransmission>("energie");
  const [condition, setCondition] = useState("");
  const [publie, setPublie] = useState(false);
  const [mesure, setMesure] = useState<{ symbol: string; source: ExchangeId; resultat: MesureQuotidienne } | null>(null);
  const [chargement, setChargement] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const scenario = qualifierTransmission(evenement, canal, condition, watchlist);
  const document = DOCUMENTATION_CANAL[canal];
  const sourceDe = (symbol: string): ExchangeId => sources[symbol] ?? "twelvedata";
  const publier = () => {
    if (!scenario) return;
    const maintenant = Date.now();
    const lecture = lectureTransmission(scenario, maintenant);
    const existantes = lireLectures(maintenant).filter((item) => item.domaine === "geo" && item.id !== lecture.id);
    remplacerLectures("geo", [...existantes, lecture]);
    setPublie(true);
  };
  const voirGraphique = (symbol: string) => {
    const market = marketStore.getState();
    market.setMarket({ exchange: sourceDe(symbol), symbol, timeframe: market.timeframe });
  };
  const comparer = async (symbol: string) => {
    const version = ++generation.current;
    const source = sourceDe(symbol);
    setChargement(true); setMesure(null);
    try {
      const maintenant = Date.now();
      const candles = await getAdapter(source).fetchKlines(symbol, "1d", { limit: 30, endTime: maintenant });
      if (version === generation.current) setMesure({ symbol, source, resultat: mesurerAutourEvenement(evenement.dateMs, candles, maintenant) });
    } catch {
      if (version === generation.current) setMesure({ symbol, source, resultat: { statut: "indisponible", description: "Historique journalier de cette source indisponible." } });
    } finally { if (version === generation.current) setChargement(false); }
  };
  return <section aria-label="Transmission géopolitique" className="mt-2 space-y-2 rounded border border-border p-2 text-[10px]">
    <h4 className="font-semibold text-text">Transmission conditionnelle</h4>
    <p className="text-text-dim">Événement individuel GDELT · référencement {date(evenement.dateMs)} UTC · occurrence et première publication non connues · ingestion {ingereLe === null ? "inconnue" : `${date(ingereLe)} UTC`}.</p>
    {urlSure(evenement.url) && <a href={evenement.url} target="_blank" rel="noreferrer" className="text-accent underline">Événement sourcé ↗</a>}
    <label className="block text-text-dim">Canal supposé<select aria-label="Canal de transmission" value={canal} onChange={(e) => { generation.current += 1; setCanal(e.target.value as CanalTransmission); setPublie(false); setMesure(null); setChargement(false); }} className="mt-1 w-full rounded border border-border bg-bg p-1 text-text">{CANAUX.map((id) => <option key={id} value={id}>{DOCUMENTATION_CANAL[id].libelle}</option>)}</select></label>
    <p className="text-text-dim">{document.explication}</p>
    <a href={document.url} target="_blank" rel="noreferrer" className="break-all text-accent underline">Fondement documentaire ↗</a>
    <label className="block text-text-dim">Condition vérifiable et invalidation<textarea aria-label="Hypothèse conditionnelle" value={condition} maxLength={350} onChange={(e) => { setCondition(e.target.value); setPublie(false); }} placeholder="Si… ; invalidé si…" className="mt-1 min-h-16 w-full rounded border border-border bg-bg p-1 text-text" /></label>
    <button type="button" disabled={!scenario} onClick={publier} className="rounded border border-accent px-2 py-1 text-accent disabled:opacity-50">Publier au brief</button>
    {publie && <p className="text-accent">Scénario conditionnel acquis ; aucune probabilité ni direction de prix attribuée.</p>}
    <p className="text-text-dim">Watchlist · instruments explicitement reliés au thème (direction inconnue) :</p>
    {scenario?.expositions.reconnues.length ? <ul className="space-y-1">{scenario.expositions.reconnues.map((x) => <li key={x.symbol} className="rounded border border-border p-1"><span className="text-text">{x.symbol} · {sourceDe(x.symbol)}</span><p className="text-text-dim">{x.raison}</p><div className="flex gap-1"><button type="button" onClick={() => voirGraphique(x.symbol)} className="text-accent underline">Voir au graphique</button><button type="button" onClick={() => void comparer(x.symbol)} className="text-accent underline">Comparer séances</button></div></li>)}</ul> : <p className="text-text-dim">Aucun instrument de la watchlist reconnu pour ce canal.</p>}
    {scenario?.expositions.inconnues.length ? <p className="text-warn">Exposition non établie : {scenario.expositions.inconnues.join(", ")}.</p> : null}
    {chargement && <p className="text-text-dim">Chargement des séances closes…</p>}
    {mesure && <p className="text-text-dim">{mesure.symbol} · {mesure.source} · 1 j : {mesure.resultat.statut === "mesure" ? `${date(mesure.resultat.avant.date)} ${mesure.resultat.avant.prix} → ${date(mesure.resultat.apres.date)} ${mesure.resultat.apres.prix} · ${pct(mesure.resultat.variationPct)} · couverture 2/2` : mesure.resultat.description}. {mesure.resultat.statut === "mesure" && mesure.resultat.description}</p>}
    <button type="button" onClick={() => windowManagerStore.getState().openWindow("scen")} className="text-accent underline">Ouvrir SCEN et saisir les chocs</button>
    <p className="text-text-dim">Séances quotidiennes descriptives uniquement ; la date GDELT ne prouve pas une heure de marché ni la causalité du mouvement.</p>
  </section>;
}
