import { useEffect, useMemo, useState } from "react";
import type { PositionBrute } from "../../data/scen";
import { appliquerChocMultifactoriel, LABEL_DATES_SCEN, type FacteurMultiId } from "../../data/scenMultifactor";
import { collecterMultifactoriel, FACTEURS_MULTI, type CollecteMulti } from "../../data/scenMultifactorLoader";
import { Chargement, ErreurBloc, NoteSource } from "../ui";

const DEFAUT: FacteurMultiId[] = ["btc", "spx", "dxy"];
const JOURS = [90, 180, 365] as const;
export function ScenMultifactorPanel({ positions }: { positions: readonly PositionBrute[] }) {
  const [selection, setSelection] = useState<FacteurMultiId[]>(DEFAUT);
  const [jours, setJours] = useState<90 | 180 | 365>(90);
  const [chocs, setChocs] = useState<Partial<Record<FacteurMultiId, number>>>({ btc: 0, spx: 0, dxy: 0, eth: 0, or: 0, taux: 0 });
  const [collecte, setCollecte] = useState<CollecteMulti | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [version, setVersion] = useState(0);
  const signature = positions.map((p) => JSON.stringify([p.symbole, p.source, p.direction, p.taille, p.prixEntree])).join("|");
  const selectionKey = selection.join("|");
  useEffect(() => {
    if (positions.length === 0 || selection.length === 0) { setCollecte(null); return; }
    const ctl = new AbortController();
    setCollecte(null); setErreur(null); setChargement(true);
    void collecterMultifactoriel(positions, selection, jours, ctl.signal).then((resultat) => {
      if (!ctl.signal.aborted) { setCollecte(resultat); setChargement(false); }
    }).catch(() => { if (!ctl.signal.aborted) { setErreur("Collecte SCEN indisponible."); setChargement(false); } });
    return () => ctl.abort();
  }, [signature, selectionKey, jours, version]);
  const lignes = useMemo(() => collecte?.lignes.map((ligne) => {
    const r = ligne.estimation.statut !== "indisponible" && ligne.valeurSignee !== null
      ? appliquerChocMultifactoriel(ligne.estimation.beta, chocs, ligne.valeurSignee) : null;
    return { ligne, r };
  }) ?? [], [collecte, chocs]);
  const totaux = new Map<string, { pnl: number; couvert: number; total: number }>();
  const sansPrix = lignes.filter(({ ligne }) => ligne.valeurSignee === null).length;
  for (const { ligne, r } of lignes) {
    if (ligne.valeurSignee === null) continue;
    const t = totaux.get(ligne.devise) ?? { pnl: 0, couvert: 0, total: 0 };
    t.total += Math.abs(ligne.valeurSignee);
    if (r?.statut === "ok") { t.pnl += r.pnl; t.couvert += Math.abs(ligne.valeurSignee); }
    totaux.set(ligne.devise, t);
  }
  return <section aria-label="Scénario multifactoriel" className="space-y-3">
    <div className="flex flex-wrap gap-2 items-center">
      <strong className="text-xs">Régression multifacteur conjointe</strong>
      <label className="text-xs">Fenêtre <select aria-label="Fenêtre multifacteur" value={jours} onChange={(e) => setJours(Number(e.target.value) as 90 | 180 | 365)} className="bg-bg border border-border rounded p-1">
        {JOURS.map((j) => <option key={j} value={j}>{j} jours</option>)}
      </select></label>
      <button type="button" onClick={() => setVersion((v) => v + 1)} className="text-xs underline">Recalculer le modèle</button>
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {FACTEURS_MULTI.map((f) => <div key={f.id} className="flex items-center gap-2 text-xs">
        <label className="flex min-w-0 flex-1 items-center gap-1"><input type="checkbox" checked={selection.includes(f.id)} onChange={(e) => setSelection((s) => e.target.checked ? [...s, f.id] : s.filter((id) => id !== f.id))} />{f.label}</label>
        {selection.includes(f.id) && <><input aria-label={`Choc ${f.label} (${f.id === "taux" ? "pb" : "%"})`} type="number" min={f.id === "taux" ? undefined : -99} value={chocs[f.id] ?? 0} onChange={(e) => setChocs((c) => ({ ...c, [f.id]: Number(e.target.value) }))} className="w-16 rounded border border-border bg-bg px-1 py-0.5 tabular-nums" /><span>{f.id === "taux" ? "pb" : "%"}</span></>}
      </div>)}
    </div>
    <NoteSource>{LABEL_DATES_SCEN}. OLS descriptive, non causale. Prix de valorisation distincts des barres retenues pour l'ajustement (date indiquée). Un facteur manquant rend le modèle choisi indisponible.</NoteSource>
    {selection.length === 0 && <ErreurBloc>Sélectionnez au moins un facteur.</ErreurBloc>}
    {chargement && <Chargement libelle="Collecte des séries…" />}
    {erreur && <ErreurBloc>{erreur}</ErreurBloc>}
    {collecte && <>
      <div className="space-y-1 text-xs">{[...totaux].map(([devise, t]) => <div key={devise}>Total des positions estimées : {t.pnl.toFixed(2)} {devise} · couverture {t.total > 0 ? (100 * t.couvert / t.total).toFixed(1) : "0"} % des notionnels valorisés {devise}</div>)}<div>{sansPrix} position(s) sans prix ou devise prouvée, exclue(s) du dénominateur.</div></div>
      <div className="space-y-2">{lignes.map(({ ligne, r }, i) => <div key={`${ligne.position.source}:${ligne.position.symbole}:${i}`} className="rounded border border-border p-2 text-xs">
        <div className="font-semibold">{ligne.position.symbole} · {ligne.position.source} · {ligne.devise} · prix de valorisation {ligne.datePrix ?? "inconnu"}</div>
        <div>{ligne.estimation.statut === "indisponible" ? `Indisponible : ${ligne.estimation.raison}` : ligne.estimation.statut === "directe" ? "Exposition directe (identité exacte)" : `n=${ligne.estimation.n} · α=${ligne.estimation.alpha?.toFixed(5) ?? "—"} · R² (ajustement dans l'échantillon) ${ligne.estimation.r2?.toFixed(3) ?? "—"} · R² ajusté ${ligne.estimation.r2Ajuste?.toFixed(3) ?? "—"} · σ ${ligne.estimation.sigma?.toFixed(4) ?? "—"} · rang complet · stabilité ${ligne.estimation.stabilite}`}</div>
        <div>{ligne.estimation.periode ? `${ligne.estimation.periode.debut} → ${ligne.estimation.periode.fin} · ${ligne.estimation.nonAppariees} variation(s) non appariée(s) · ${ligne.estimation.excluesInvalides} invalides/ambiguës · ${ligne.estimation.pairesLongues} paires >1j · durées ${ligne.estimation.dureesJours?.min}–${ligne.estimation.dureesJours?.max} j` : ""}</div>
        <div>{Object.entries(ligne.estimation.beta).map(([id, beta]) => `${id}: β=${beta.toFixed(3)}${id === "taux" ? " par pp" : ""}${ligne.estimation.vif[id as FacteurMultiId] ? `, VIF=${ligne.estimation.vif[id as FacteurMultiId]!.toFixed(2)}` : ""}`).join(" · ")}</div>
        {ligne.estimation.betaMoitie && <div>β première moitié : {Object.entries(ligne.estimation.betaMoitie[0]).map(([id, b]) => `${id} ${b.toFixed(3)}`).join(" · ")} ; seconde moitié : {Object.entries(ligne.estimation.betaMoitie[1]).map(([id, b]) => `${id} ${b.toFixed(3)}`).join(" · ")}</div>}
        <div>{r?.statut === "ok" ? `Contributions log ${Object.entries(r.contributions).map(([id, v]) => `${id} ${v.toFixed(5)}`).join(" · ")} ; Σ=${r.logRendement.toFixed(5)} ; P&L conditionnel ${r.pnl.toFixed(2)} ${ligne.devise}` : "P&L inconnu"}</div>
      </div>)}</div>
    </>}
  </section>;
}
