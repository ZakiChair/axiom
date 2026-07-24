/**
 * Panneau « Portefeuille » — dockable à droite, NON MODAL (pattern DerivativesWindow).
 *
 * Positions saisies à la main (long/short) valorisées en LIVE : le PnL latent et
 * l'exposition sont recalculés à chaque tick des WS existants (subscribeTickers) et écrits
 * IMPÉRATIVEMENT dans le DOM via des refs — AUCUN re-render React sur tick (cf.
 * BUILD-CONTRACT). Le composant ne se re-rend qu'au changement de LISTE de positions.
 *
 * Fonctions : tableau des positions ouvertes (PnL live coloré via tokens --up/--down),
 * formulaire d'ajout compact, clôture au prix du marché en 1 clic (préremplit le prix de
 * sortie), et une section « Clos » repliée avec des stats simples (win rate, PnL cumulé,
 * meilleure/pire). À la clôture, une note de POST-MORTEM préremplie est proposée (lien
 * portfolio → notes). PAS d'attribution multi-facteurs (anti-objectif).
 *
 * Valorisation : subscribeTickers route par source (watchlist / inférence), donc un
 * symbole d'un exchange non inféré peut rester à « — » — dégradation gracieuse assumée.
 *
 * Ce fichier ORCHESTRE : l'état/les refs/les handlers vivent ici, le rendu des sections est
 * délégué aux sous-composants de `./portfolio/*` (découpage v1.9, sans changement de rendu).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { marketStore } from "../store/market";
import { subscribeTickers, type TickerUpdate } from "../data/ticker";
import {
  portfolioStore,
  portfolioUiStore,
  pnlLatentPosition,
  pnlLatentTotal,
  pnlRealisePosition,
  calculerExposition,
  statsClotures,
  type Position,
} from "../store/portfolio";
import {
  parsePortfolioCsv,
  ligneCsvVersNouvelle,
  type ResultatParseCsvPortfolio,
} from "../store/portfolioCsv";
import { notesUiStore } from "../store/notes";
import { formatPrice, formatUsd } from "../lib/format";
import { EnTeteFenetre } from "./ui";
import { genererRapportHtml, collecterDonneesRapport } from "../data/rapport";
import { writeMoney, writePct, type RowCells } from "./portfolio/domCells";
import { BarreCsvRapport } from "./portfolio/BarreCsvRapport";
import { ImportDryRun } from "./portfolio/ImportDryRun";
import { SectionOuvertes } from "./portfolio/SectionOuvertes";
import { FormulaireAjout, type FormState } from "./portfolio/FormulaireAjout";
import { SectionClos } from "./portfolio/SectionClos";
import { SectionRisque } from "./portfolio/SectionRisque";
import { usePortfolioRisque } from "./portfolio/usePortfolioRisque";

/** Prix courant de l'actif actif (dernière clôture du buffer marché), ou undefined. */
function prixMarcheActif(): number | undefined {
  const c = marketStore.getState().candles.at(-1);
  return c ? c.close : undefined;
}

export function PortfolioWindow() {
  const open = useStore(portfolioUiStore, (s) => s.open);
  const positions = useStore(portfolioStore, (s) => s.positions);
  const activeSymbol = useStore(marketStore, (s) => s.symbol);
  const activeExchange = useStore(marketStore, (s) => s.exchange);

  const openPositions = useMemo(() => positions.filter((p) => p.statut === "ouvert"), [positions]);
  const closedPositions = useMemo(
    () => positions.filter((p) => p.statut === "clos").sort((a, b) => (b.dateSortie ?? 0) - (a.dateSortie ?? 0)),
    [positions]
  );
  const openSymbolsKey = useMemo(
    () => Array.from(new Set(openPositions.map((p) => p.symbole))).sort().join(","),
    [openPositions]
  );
  const stats = useMemo(() => statsClotures(positions), [positions]);

  // Ref « toujours à jour » des positions ouvertes : évite une closure périmée quand une
  // 2ᵉ position est ajoutée sur un symbole DÉJÀ souscrit (le SET de symboles ne change pas).
  const openRef = useRef<Position[]>(openPositions);
  openRef.current = openPositions;

  const latest = useRef(new Map<string, number>());
  const cells = useRef(new Map<string, RowCells>());
  const totalPnlRef = useRef<HTMLSpanElement>(null);
  const expoBruteRef = useRef<HTMLSpanElement>(null);
  const expoNetteRef = useRef<HTMLSpanElement>(null);

  // État d'ajout / clôture / proposition de post-mortem / import CSV (basse fréquence, React admis).
  const [form, setForm] = useState<FormState>({ symbole: "", direction: "long", taille: "", prixEntree: "", fraisPct: "", note: "" });
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ id: string; prix: string } | null>(null);
  // Suppression armée (pattern SettingsPanel.restaurer) : id de la position à confirmer.
  const [confirmSuppr, setConfirmSuppr] = useState<string | null>(null);
  const [pmPrompt, setPmPrompt] = useState<{ position: Position; prixSortie: number } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  /** Dry-run import CSV (null = panneau masqué). */
  const [importDryRun, setImportDryRun] = useState<ResultatParseCsvPortfolio | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rapport périodique : fenêtre (7 j / 30 j) + garde anti-double-clic pendant la collecte.
  const [rapportPeriode, setRapportPeriode] = useState<7 | 30>(30);
  const [rapportEnCours, setRapportEnCours] = useState(false);

  // Section « Risque » : état + vue dérivée délégués au hook (collecte lazy, garde anti-course).
  const { showRisk, setShowRisk, risque, collecterRisque, vueRisque } = usePortfolioRisque({
    open,
    openPositions,
    openRef,
    latest,
  });

  /** Repeint toutes les lignes ouvertes + les totaux depuis les derniers prix connus. */
  const repaintAll = useCallback(() => {
    const prix = Object.fromEntries(latest.current);
    for (const p of openRef.current) {
      const row = cells.current.get(p.id);
      if (!row) continue;
      const px = latest.current.get(p.symbole);
      if (row.prix) row.prix.textContent = px !== undefined ? formatPrice(px) : "—";
      const pnl = px !== undefined ? pnlLatentPosition(p, px) : null;
      if (row.pnl) writeMoney(row.pnl, pnl?.net);
      if (row.pct) writePct(row.pct, pnl?.pct);
    }
    if (totalPnlRef.current) writeMoney(totalPnlRef.current, pnlLatentTotal(openRef.current, prix));
    const expo = calculerExposition(openRef.current, prix);
    if (expoBruteRef.current) expoBruteRef.current.textContent = formatUsd(expo.brute);
    if (expoNetteRef.current) writeMoney(expoNetteRef.current, expo.nette);
  }, []);

  // Souscription ticker LIVE des symboles ouverts (uniquement fenêtre ouverte, comme DES).
  useEffect(() => {
    if (!open) return;
    const symbols = openSymbolsKey ? openSymbolsKey.split(",") : [];
    if (symbols.length === 0) return;
    const onTick = (u: TickerUpdate) => {
      latest.current.set(u.symbol, u.price);
      repaintAll();
    };
    return subscribeTickers(symbols, onTick);
  }, [open, openSymbolsKey, repaintAll]);

  // Repeint après tout re-render de structure (nouvelle ligne, clôture) et à l'ouverture :
  // évite le flash « — » d'une cellule fraîchement montée. useLayoutEffect => refs attachées.
  useLayoutEffect(() => {
    if (open) repaintAll();
  }, [open, positions, repaintAll]);

  // Préremplit le formulaire à l'ouverture (symbole actif + prix marché) si vide.
  useEffect(() => {
    if (!open) return;
    setForm((f) => {
      if (f.symbole) return f;
      const px = prixMarcheActif();
      return { ...f, symbole: activeSymbol, prixEntree: px !== undefined ? String(px) : "" };
    });
  }, [open, activeSymbol]);

  const submitAdd = () => {
    const taille = Number(form.taille);
    const prixEntree = Number(form.prixEntree);
    if (!form.symbole.trim() || !Number.isFinite(taille) || taille <= 0 || !Number.isFinite(prixEntree) || prixEntree <= 0) {
      setErreurForm("Symbole, taille et prix d'entrée (> 0) requis.");
      return;
    }
    setErreurForm(null);
    const fraisNum = form.fraisPct.trim() ? Number(form.fraisPct) : undefined;
    portfolioStore.getState().ajouter({
      symbole: form.symbole.trim(),
      source: activeExchange,
      direction: form.direction,
      taille,
      prixEntree,
      fraisPct: fraisNum !== undefined && Number.isFinite(fraisNum) ? fraisNum : undefined,
      note: form.note.trim() || undefined,
    });
    setForm({ symbole: "", direction: "long", taille: "", prixEntree: "", fraisPct: "", note: "" });
  };

  /** Ouvre l'éditeur de clôture en préremplissant le prix marché (ou le prix d'entrée). */
  const demanderCloture = (p: Position) => {
    const px = latest.current.get(p.symbole) ?? p.prixEntree;
    setClosing({ id: p.id, prix: String(px) });
  };

  const confirmerCloture = (p: Position) => {
    const prixSortie = Number(closing?.prix);
    if (!Number.isFinite(prixSortie) || prixSortie <= 0) return;
    portfolioStore.getState().cloturer(p.id, prixSortie);
    setClosing(null);
    setPmPrompt({ position: p, prixSortie }); // propose un post-mortem (opt-in)
  };

  /** Ouvre le panneau Notes avec un brouillon de post-mortem prérempli. */
  const redigerPostMortem = () => {
    if (!pmPrompt) return;
    const { position: p, prixSortie } = pmPrompt;
    const pnl = pnlRealisePosition({ ...p, statut: "clos", prixSortie });
    const netTxt = pnl ? `${pnl.net > 0 ? "+" : ""}${formatUsd(pnl.net)} (${pnl.pct.toFixed(2)}%)` : "—";
    const texte =
      `Post-mortem ${p.symbole} ${p.direction} — entrée ${p.prixEntree}, sortie ${prixSortie}, PnL net ${netTxt}.\n\n` +
      `Ce qui a marché :\n\nÀ améliorer :`;
    notesUiStore.getState().proposerNote({
      symbole: p.symbole,
      source: p.source,
      prix: prixSortie,
      texte,
      tags: ["post-mortem"],
    });
    setPmPrompt(null);
  };

  /** Change le symbole du graphe (et restaure la source d'origine de la position). */
  const voirSurChart = (p: Position) => {
    marketStore.getState().setExchange(p.source);
    marketStore.getState().setSymbol(p.symbole);
  };

  /** Ouvre le sélecteur de fichier CSV (import dry-run). */
  const declencherImportCsv = () => {
    fileInputRef.current?.click();
  };

  /** Génère le rapport HTML autonome de la période et déclenche son téléchargement (patron EXPY). */
  const genererRapport = async () => {
    if (rapportEnCours) return;
    setRapportEnCours(true);
    try {
      const donnees = await collecterDonneesRapport(rapportPeriode, Date.now());
      const html = genererRapportHtml(donnees);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `axiom-rapport-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setRapportEnCours(false);
    }
  };

  /** Lit le fichier, parse en dry-run (aucune mutation store tant que non confirmé). */
  const onFichierCsv = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const texte = typeof reader.result === "string" ? reader.result : "";
      setImportDryRun(parsePortfolioCsv(texte));
    };
    reader.readAsText(file);
    // Reset pour permettre de re-sélectionner le même fichier.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /** Confirme le dry-run : ajoute chaque ligne valide (source défaut = exchange actif). */
  const confirmerImportCsv = () => {
    if (!importDryRun || importDryRun.ok.length === 0) {
      setImportDryRun(null);
      return;
    }
    const ajouter = portfolioStore.getState().ajouter;
    for (const l of importDryRun.ok) {
      ajouter(ligneCsvVersNouvelle(l, activeExchange));
    }
    setImportDryRun(null);
  };

  return (
    <>
      {/* Input fichier hors flux (déclenché programmatiquement) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => onFichierCsv(e.target.files?.[0])}
      />

      {/* En-tête standard, sans croix de fermeture : celle-ci est fournie par le chrome FloatingWindow */}
      <EnTeteFenetre mnemo="PORT" titre="Portefeuille" sousTitre="Positions manuelles · PnL live" />

      {/* Barre import / export CSV + rapport périodique */}
      <BarreCsvRapport
        rapportPeriode={rapportPeriode}
        setRapportPeriode={setRapportPeriode}
        rapportEnCours={rapportEnCours}
        genererRapport={genererRapport}
        declencherImportCsv={declencherImportCsv}
        positions={positions}
      />

      {/* Totaux (maj impérative sur tick) */}
      <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-border px-4 py-3 text-center">
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-dim">PnL latent</div>
          <span ref={totalPnlRef} className="tabular-nums text-sm font-medium text-text">—</span>
        </div>
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-dim">Expo brute</div>
          <span ref={expoBruteRef} className="tabular-nums text-sm font-medium text-text">—</span>
        </div>
        <div className="rounded-md border border-border bg-bg px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-text-dim">Expo nette</div>
          <span ref={expoNetteRef} className="tabular-nums text-sm font-medium text-text">—</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Dry-run import CSV : validation avant écriture store */}
        {importDryRun && (
          <ImportDryRun
            importDryRun={importDryRun}
            confirmerImportCsv={confirmerImportCsv}
            annuler={() => setImportDryRun(null)}
          />
        )}

        {/* Proposition de post-mortem après clôture */}
        {pmPrompt && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-accent/50 bg-bg px-3 py-2 text-[11px] text-text">
            <span>Position clôturée. Rédiger une note de post-mortem ?</span>
            <span className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={redigerPostMortem}
                className="rounded border border-border bg-surface px-2 py-1 text-[10px] transition hover:text-accent"
              >
                Rédiger
              </button>
              <button
                type="button"
                onClick={() => setPmPrompt(null)}
                aria-label="Ignorer le post-mortem"
                className="rounded px-1 text-text-dim transition hover:text-text"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {/* Positions ouvertes */}
        <SectionOuvertes
          openPositions={openPositions}
          cells={cells}
          closing={closing}
          setClosing={setClosing}
          confirmSuppr={confirmSuppr}
          setConfirmSuppr={setConfirmSuppr}
          voirSurChart={voirSurChart}
          demanderCloture={demanderCloture}
          confirmerCloture={confirmerCloture}
        />

        {/* Formulaire d'ajout compact */}
        <FormulaireAjout form={form} setForm={setForm} erreurForm={erreurForm} submitAdd={submitAdd} />

        {/* Section « Clos » repliée + stats */}
        <SectionClos
          stats={stats}
          showClosed={showClosed}
          setShowClosed={setShowClosed}
          closedPositions={closedPositions}
          confirmSuppr={confirmSuppr}
          setConfirmSuppr={setConfirmSuppr}
          voirSurChart={voirSurChart}
        />

        {/* Section « Risque » — repliée par défaut, collecte lazy au dépliage (masquée si 0 position ouverte) */}
        {openPositions.length > 0 && (
          <SectionRisque
            showRisk={showRisk}
            setShowRisk={setShowRisk}
            risque={risque}
            collecterRisque={collecterRisque}
            vueRisque={vueRisque}
          />
        )}
      </div>
    </>
  );
}
