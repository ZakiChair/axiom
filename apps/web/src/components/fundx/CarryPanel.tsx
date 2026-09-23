import { useEffect, useMemo, useState } from "react";
import { calculerCarryNet } from "../../data/fundingCarry";
import { chargerQuotesCarry, quoteCarryPerime, type QuoteCarry } from "../../data/fundingCarryQuotes";
import { Chargement, ErreurBloc, NoteSource } from "../ui";

const SAISIES = [
  ["spotEntree", "Frais achat spot (%)"], ["perpEntree", "Frais vente perp (%)"],
  ["spotSortie", "Frais vente spot (%)"], ["perpSortie", "Frais rachat perp (%)"],
] as const;
type FeeKey = (typeof SAISIES)[number][0];
const heureUTC = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateHeureUTC = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export function CarryPanel({ symboleCourant }: { symboleCourant: string }) {
  const [symbol, setSymbol] = useState<"BTCUSDT" | "ETHUSDT">(symboleCourant === "ETHUSDT" ? "ETHUSDT" : "BTCUSDT");
  const [notionnel, setNotionnel] = useState("1000");
  const [quote, setQuote] = useState<QuoteCarry | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [maintenant, setMaintenant] = useState(Date.now());
  const [horizon, setHorizon] = useState<1 | 7 | 30>(7);
  const [frais, setFrais] = useState<Record<FeeKey, string>>({ spotEntree: "", perpEntree: "", spotSortie: "", perpSortie: "" });
  const [spotSortie, setSpotSortie] = useState("");
  const [basisSortie, setBasisSortie] = useState("0");
  const [slippageSpot, setSlippageSpot] = useState("");
  const [slippagePerp, setSlippagePerp] = useState("");
  const [taux, setTaux] = useState("");
  const [modeFinancement, setModeFinancement] = useState<"cash" | "emprunt">("cash");
  const [financement, setFinancement] = useState("0");
  const [execution, setExecution] = useState("0");
  useEffect(() => { const id = setInterval(() => setMaintenant(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const ctl = new AbortController();
    setQuote(null); setErreur(null); setLoading(true);
    void chargerQuotesCarry(symbol, Number(notionnel), ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      setLoading(false);
      if (r.statut !== "ok") { setErreur(r.raison); return; }
      setQuote(r.quote); setSpotSortie(r.quote.spotEntree.toFixed(4));
      setBasisSortie("0"); setTaux((r.quote.fundingRate * 100).toString());
    });
    return () => ctl.abort();
  }, [symbol, notionnel, version]);
  const perime = quote !== null && quoteCarryPerime(quote, maintenant);
  const resultat = useMemo(() => {
    if (!quote || perime) return null;
    const valeurFrais = Object.fromEntries(SAISIES.map(([id]) => [id, frais[id] === "" ? NaN : Number(frais[id]) / 100])) as Record<FeeKey, number>;
    return calculerCarryNet({ symbol: quote.symbol, base: quote.base, quote: quote.quote, reglement: quote.reglement, venue: "binance", type: "linear",
      quantite: quote.quantite, spotEntree: quote.spotEntree, perpEntree: quote.perpEntree,
      spotSortie: spotSortie === "" ? NaN : Number(spotSortie), basisSortie: basisSortie === "" ? NaN : Number(basisSortie),
      slippageSortieSpotBps: slippageSpot === "" ? NaN : Number(slippageSpot), slippageSortiePerpBps: slippagePerp === "" ? NaN : Number(slippagePerp),
      frais: valeurFrais, tauxFunding: taux === "" ? NaN : Number(taux) / 100,
      notionnelReglement: quote.quantite * quote.spotEntree, cadenceHeures: quote.intervalHours,
      entreeTs: quote.spot.fin, prochainReglementTs: quote.nextFundingTime, horizonJours: horizon,
      executionNonIncluse: execution === "" ? NaN : Number(execution), financement: financement === "" ? NaN : Number(financement), provenance: "live" });
  }, [quote, perime, frais, spotSortie, basisSortie, slippageSpot, slippagePerp, taux, horizon, financement, execution]);
  return <section aria-label="Carry net spot perp" className="space-y-3 text-xs">
    <div className="flex flex-wrap gap-2 items-center">
      <strong>Calculatrice long spot / short perp Binance</strong>
      <label>Paire <select aria-label="Paire carry" value={symbol} onChange={(e) => setSymbol(e.target.value as "BTCUSDT" | "ETHUSDT")} className="rounded border border-border bg-bg p-1"><option>BTCUSDT</option><option>ETHUSDT</option></select></label>
      <label>Notionnel visé (USDT) <input aria-label="Notionnel carry USDT" type="number" min="1" value={notionnel} onChange={(e) => setNotionnel(e.target.value)} className="w-24 rounded border border-border bg-bg p-1" /></label>
      <button type="button" onClick={() => setVersion((v) => v + 1)} className="underline">Actualiser les carnets</button>
    </div>
    {loading && <Chargement libelle="Acquisition des deux carnets et du funding…" />}
    {erreur && <ErreurBloc>{erreur}</ErreurBloc>}
    {perime && <ErreurBloc>Cotations périmées (plus de 5 s) : actualisez les carnets.</ErreurBloc>}
    {quote && <>
      <div>Quantité couverte : {quote.quantite.toFixed(8)} {quote.base} sur chaque jambe. Achat spot VWAP {quote.spotEntree.toFixed(4)} USDT ; vente perp VWAP {quote.perpEntree.toFixed(4)} USDT. Basis entrée {(quote.perpEntree - quote.spotEntree).toFixed(4)} USDT.</div>
      <div>Acquisitions spot {heureUTC.format(quote.spot.debut)}–{heureUTC.format(quote.spot.fin)} UTC, perp {heureUTC.format(quote.perp.debut)}–{heureUTC.format(quote.perp.fin)} UTC. Heure marché perp {quote.perp.observeLe ? `${heureUTC.format(quote.perp.observeLe)} UTC` : "inconnue"} ; heure marché spot inconnue.</div>
      <div>Dernier taux observé {(quote.fundingRate * 100).toFixed(4)} % / {quote.intervalHours} h ; prochain règlement {dateHeureUTC.format(quote.nextFundingTime)} UTC.</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label>Horizon hypothétique <select aria-label="Horizon carry" value={horizon} onChange={(e) => setHorizon(Number(e.target.value) as 1 | 7 | 30)} className="rounded border border-border bg-bg p-1"><option value={1}>1 jour</option><option value={7}>7 jours</option><option value={30}>30 jours</option></select></label>
        <label>Funding futur supposé (% par règlement) <input aria-label="Funding futur supposé" type="number" step="0.0001" value={taux} onChange={(e) => setTaux(e.target.value)} className="w-24 rounded border border-border bg-bg p-1" /></label>
        <label>Spot de sortie supposé (USDT) <input aria-label="Spot de sortie supposé" type="number" value={spotSortie} onChange={(e) => setSpotSortie(e.target.value)} className="w-24 rounded border border-border bg-bg p-1" /></label>
        <label>Basis de sortie supposée F−S (USDT) <input aria-label="Basis de sortie supposée" type="number" value={basisSortie} onChange={(e) => setBasisSortie(e.target.value)} className="w-24 rounded border border-border bg-bg p-1" /></label>
        <label>Slippage vente spot sortie (pb) <input aria-label="Slippage spot sortie" type="number" min="0" value={slippageSpot} onChange={(e) => setSlippageSpot(e.target.value)} placeholder="à saisir" className="w-20 rounded border border-border bg-bg p-1" /></label>
        <label>Slippage rachat perp sortie (pb) <input aria-label="Slippage perp sortie" type="number" min="0" value={slippagePerp} onChange={(e) => setSlippagePerp(e.target.value)} placeholder="à saisir" className="w-20 rounded border border-border bg-bg p-1" /></label>
        {SAISIES.map(([id, label]) => <label key={id}>{label} <input aria-label={label} type="number" min="0" step="0.001" placeholder="à saisir" value={frais[id]} onChange={(e) => setFrais((f) => ({ ...f, [id]: e.target.value }))} className="w-20 rounded border border-border bg-bg p-1" /></label>)}
        <label>Coût d'exécution non inclus (USDT) <input aria-label="Coût exécution non inclus" type="number" min="0" value={execution} onChange={(e) => setExecution(e.target.value)} className="w-20 rounded border border-border bg-bg p-1" /></label>
        <label>Spot financé par <select aria-label="Mode de financement spot" value={modeFinancement} onChange={(e) => { const mode = e.target.value as "cash" | "emprunt"; setModeFinancement(mode); setFinancement(mode === "cash" ? "0" : ""); }} className="rounded border border-border bg-bg p-1"><option value="cash">cash (coût d'opportunité)</option><option value="emprunt">emprunt (coût d'intérêt)</option></select></label>
        <label>{modeFinancement === "cash" ? "Coût d'opportunité supposé" : "Intérêt d'emprunt supposé"} (USDT) <input aria-label="Financement supposé" type="number" min="0" value={financement} onChange={(e) => setFinancement(e.target.value)} placeholder="à saisir" className="w-20 rounded border border-border bg-bg p-1" /></label>
      </div>
      {resultat?.statut === "indisponible" && <ErreurBloc>{resultat.raison}</ErreurBloc>}
      {resultat?.statut === "ok" && <div className="rounded border border-border p-2 space-y-1">
        <div>Hypothèse : sortie spot/perp de référence {resultat.spotSortieReference.toFixed(4)} / {resultat.perpSortieReference.toFixed(4)} USDT ; VWAP simulés après slippage {resultat.spotSortie.toFixed(4)} / {resultat.perpSortie.toFixed(4)} USDT ; basis terminale {resultat.basisSortie.toFixed(4)} USDT ; {resultat.reglements} règlements futurs dans (entrée, sortie].</div>
        <div>P&L prix après slippage de sortie {resultat.prix.toFixed(4)} (dont slippage {resultat.slippageSortie.toFixed(4)} déjà inclus) ; funding supposé {resultat.funding.toFixed(4)} sur notionnel de règlement figé {(quote.quantite * quote.spotEntree).toFixed(4)} USDT ; quatre frais {resultat.frais.toFixed(4)} ; exécution non incluse {resultat.executionNonIncluse.toFixed(4)} ; financement {resultat.financement.toFixed(4)} USDT.</div>
        <div className="font-semibold">Net conditionnel {resultat.net.toFixed(4)} USDT ({resultat.rendementSpotPct.toFixed(4)} % du notionnel spot initial).</div>
        <div>Funding nul {resultat.fundingNul.toFixed(4)} ; funding inversé {resultat.fundingInverse.toFixed(4)} USDT. Seuil de rentabilité {resultat.seuilFunding === null ? "indéfini" : `${(resultat.seuilFunding * 100).toFixed(5)} % par règlement`}.</div>
      </div>}
    </>}
    <NoteSource>Simulation indicative sans ordre. {quote?.limite ?? "Deux carnets publics requis."} Frais, funding futur, notionnel de règlement, basis, coûts de sortie et financement {modeFinancement === "cash" ? "du cash" : "par emprunt"} sont des hypothèses. Risques de basis, marge, liquidation et contrepartie non garantis.</NoteSource>
  </section>;
}
