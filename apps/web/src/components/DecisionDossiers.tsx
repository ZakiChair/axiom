import { useStore } from "zustand";
import { decrireCondition, LIBELLES_METRIQUE_ONCHAIN, type MetriqueOnchainAlerte } from "@axiom/alerts";
import { isTickerSource } from "../data/ticker";
import type { ContexteDecision, DossierDecision } from "../data/decisionDossier";
import { decisionDossiersStore } from "../store/decisionDossiers";
import { paperStore, paperUiStore } from "../store/paper";
import { expyStore } from "../store/expy";
import { windowManagerStore } from "../store/windowManager";
import { navigateTo } from "../lib/navigation";
import { BTN_SECONDAIRE, ErreurBloc, NoteSource, TitreSection } from "./ui";

function date(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function decrireContexte(c: ContexteDecision): string[] {
  const lignes: string[] = [];
  if (c.dernierPrix !== undefined) lignes.push(`dernier prix ${c.dernierPrix}`);
  if (c.prixPrecedent !== undefined) lignes.push(`prix précédent ${c.prixPrecedent}`);
  if (c.fundingRate !== undefined) lignes.push(`funding observé (fraction) ${c.fundingRate}`);
  if (c.fundingZScore !== undefined) lignes.push(`score Z du funding ${c.fundingZScore}`);
  if (c.liqUsdParMin !== undefined) lignes.push(`liquidations USD/min ${c.liqUsdParMin}`);
  if (c.regimeScore !== undefined) lignes.push(`score de régime ${c.regimeScore}`);
  if (c.cvdDivergenceKind !== undefined) lignes.push(`divergence CVD ${c.cvdDivergenceKind === null ? "aucune" : c.cvdDivergenceKind === "spotUp_perpDown" ? "spot en hausse, perp en baisse" : "spot en baisse, perp en hausse"}`);
  if (c.onchainMetriques) for (const [cle, valeur] of Object.entries(c.onchainMetriques)) {
    lignes.push(`on-chain ${LIBELLES_METRIQUE_ONCHAIN[cle as MetriqueOnchainAlerte] ?? cle} ${valeur}`);
  }
  if (c.fluxCapitaux) lignes.push(`flux de capitaux ${c.fluxCapitaux.metrique} ${c.fluxCapitaux.valeur} ${c.fluxCapitaux.unite} · observé le ${date(c.fluxCapitaux.observeLe)} · source ${c.fluxCapitaux.source}`);
  if (c.baleines) lignes.push(`baleines ${c.baleines.nombre} transfert(s), total ${c.baleines.usdTotal} USD`);
  if (c.derniereBougie) lignes.push(`dernière bougie ${date(c.derniereBougie.time)} · ouverture ${c.derniereBougie.open}, plus haut ${c.derniereBougie.high}, plus bas ${c.derniereBougie.low}, clôture ${c.derniereBougie.close}, volume ${c.derniereBougie.volume}`);
  return lignes;
}

function telecharger(nom: string, valeur: string): void {
  const url = URL.createObjectURL(new Blob([valeur], { type: "application/json;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DossierLigne({ dossier }: { dossier: DossierDecision }) {
  const positions = useStore(paperStore, (s) => s.positions).filter((p) => p.decisionIds?.includes(dossier.id));
  const ordres = useStore(paperStore, (s) => s.ordres).filter((o) => o.decisionIds?.includes(dossier.id));
  const trades = useStore(expyStore, (s) => s.trades).filter((t) => t.decisionIds?.includes(dossier.id));
  const origine = dossier.origine;
  const navigable = origine.symbol !== null && origine.source !== null;
  const preparable = navigable && isTickerSource(origine.source!);
  const contexte = decrireContexte(dossier.contexte);

  return <article className="space-y-2 rounded border border-border/60 p-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <strong className="min-w-0 flex-1">{origine.message} · {origine.symbol ?? "instrument inconnu"} / {origine.source ?? "source inconnue"}</strong>
      <span>{date(origine.ts)} · {dossier.qualite === "complete" ? "preuve capturée" : "contexte partiel (ancien journal/daemon)"}</span>
    </div>
    <p className="text-text-dim">Alerte {origine.alertId} · valeur {origine.valeur} · condition {origine.condition ? decrireCondition(origine.condition) : "inconnue"}</p>
    <p className="text-text-dim">Contexte connu au signal : {contexte.length ? contexte.join(" · ") : "aucune valeur archivée"}</p>
    <div className="grid gap-2 md:grid-cols-3">
      {(["these", "invalidation", "revue"] as const).map((champ) => <label key={champ} className="flex flex-col gap-1 text-text-dim">
        {champ === "these" ? "Thèse" : champ === "invalidation" ? "Invalidation" : "Revue après trade"}
        <textarea key={`${dossier.id}:${champ}`} defaultValue={dossier[champ]} onBlur={(e) => decisionDossiersStore.getState().modifier(dossier.id, { [champ]: e.target.value })} className="min-h-16 rounded border border-border bg-bg px-2 py-1 text-text" />
      </label>)}
    </div>
    <p className="text-text-dim">Liens : {ordres.length} ordre(s), {positions.length} position(s), {trades.length} trade(s) EXPY{trades.length ? ` · ${trades.map((t) => t.id).join(", ")}` : ""}</p>
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={BTN_SECONDAIRE} disabled={!navigable} onClick={() => {
        if (origine.symbol !== null && origine.source !== null) navigateTo({ symbol: origine.symbol, exchange: origine.source,
          ...(origine.timeframe ? { timeframe: origine.timeframe } : {}), markTime: origine.ts, source: "decision", markLabel: "Dossier" });
      }}>Voir le contexte daté</button>
      <button type="button" className={BTN_SECONDAIRE} disabled={!preparable} title={preparable ? "Ouvre un brouillon, sans ordre" : "Source inconnue ou sans ticker PAPER compatible"} onClick={() => {
        if (origine.symbol === null || origine.source === null) return;
        if (!paperUiStore.getState().preparer({ decisionId: dossier.id, symbol: origine.symbol, source: origine.source })) return;
        windowManagerStore.getState().openWindow("paper");
      }}>Préparer dans PAPER</button>
      <button type="button" className={BTN_SECONDAIRE} onClick={() => decisionDossiersStore.getState().supprimer(dossier.id)}>Supprimer le dossier</button>
    </div>
    {!preparable && <p className="text-text-dim">Préparation PAPER indisponible : provenance absente ou source sans flux compatible.</p>}
  </article>;
}

export function DecisionDossiers() {
  const dossiers = useStore(decisionDossiersStore, (s) => s.dossiers);
  const erreur = useStore(decisionDossiersStore, (s) => s.erreurSauvegarde);
  const reessai = useStore(decisionDossiersStore, (s) => s.reessaiPossible);
  const brut = useStore(decisionDossiersStore, (s) => s.brutOriginal);
  const positions = useStore(paperStore, (s) => s.positions);
  const ordres = useStore(paperStore, (s) => s.ordres);
  const trades = useStore(expyStore, (s) => s.trades);
  const idsConnus = new Set(dossiers.map((d) => d.id));
  const orphelins = [...new Set([...positions, ...ordres, ...trades].flatMap((x) => x.decisionIds ?? []))].filter((id) => !idsConnus.has(id));

  return <section className="space-y-2 rounded border border-border bg-bg p-3" aria-label="Dossiers de décision">
    <div className="flex items-center justify-between gap-2"><TitreSection>Dossiers de décision ({dossiers.length}/100)</TitreSection>
      <button type="button" className={BTN_SECONDAIRE} onClick={() => telecharger("axiom-dossiers-decision.json", decisionDossiersStore.getState().exporterJSON())}>Exporter JSON</button>
    </div>
    <NoteSource>Preuve figée au déclenchement. Les anciens journaux ou signaux du daemon restent partiels ; aucune donnée de marché actuelle ne complète le passé. Préparer dans PAPER ne place aucun ordre.</NoteSource>
    {erreur && <div role="alert"><ErreurBloc>{erreur}</ErreurBloc>
      {brut !== null && <button type="button" className={BTN_SECONDAIRE} onClick={() => { telecharger("axiom-dossiers-origine.json", brut); decisionDossiersStore.getState().confirmerExportOriginal(); }}>Exporter la sauvegarde d'origine</button>}
      {reessai && <button type="button" className={BTN_SECONDAIRE} onClick={() => decisionDossiersStore.getState().reessayerSauvegarde()}>Réessayer la sauvegarde</button>}
    </div>}
    {dossiers.length === 0 && <p className="text-xs text-text-dim">Aucun dossier. Créez-en depuis le journal des alertes.</p>}
    {dossiers.map((d) => <DossierLigne key={d.id} dossier={d} />)}
    {orphelins.length > 0 && <p className="text-xs text-warn">Références vers dossiers supprimés ou absents : {orphelins.join(", ")}. Les trades et positions restent conservés.</p>}
  </section>;
}
