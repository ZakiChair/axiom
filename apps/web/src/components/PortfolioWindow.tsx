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
  type Direction,
} from "../store/portfolio";
import { notesUiStore } from "../store/notes";
import { formatPrice, formatUsd, formatPct } from "../lib/format";
import { EnTeteFenetre, Vide } from "./ui";

/** Cellules DOM d'une ligne, mises à jour impérativement (hors render-loop). */
interface RowCells {
  prix: HTMLElement | null;
  pnl: HTMLElement | null;
  pct: HTMLElement | null;
}

/** Écrit un montant signé + coloré (tokens --up/--down) dans une cellule DOM. */
function writeMoney(el: HTMLElement, n: number | undefined): void {
  if (n === undefined || !Number.isFinite(n)) {
    el.textContent = "—";
    el.style.color = "";
    return;
  }
  const plus = n > 0 ? "+" : ""; // le moins est déjà porté par formatUsd
  el.textContent = `${plus}${formatUsd(n)}`;
  el.style.color = n > 0 ? "var(--up)" : n < 0 ? "var(--down)" : "";
}

/** Écrit un pourcentage signé + coloré dans une cellule DOM. */
function writePct(el: HTMLElement, pct: number | undefined): void {
  el.textContent = formatPct(pct);
  el.style.color =
    pct === undefined || !Number.isFinite(pct) ? "" : pct > 0 ? "var(--up)" : pct < 0 ? "var(--down)" : "";
}

/** Enregistre/retire une cellule DOM dans la map (callback de ref). */
function registerCell(map: Map<string, RowCells>, id: string, field: keyof RowCells, el: HTMLElement | null): void {
  const cells = map.get(id) ?? { prix: null, pnl: null, pct: null };
  cells[field] = el;
  if (cells.prix === null && cells.pnl === null && cells.pct === null) map.delete(id);
  else map.set(id, cells);
}

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

  // État d'ajout / clôture / proposition de post-mortem (basse fréquence, React admis).
  const [form, setForm] = useState({ symbole: "", direction: "long" as Direction, taille: "", prixEntree: "", fraisPct: "", note: "" });
  const [closing, setClosing] = useState<{ id: string; prix: string } | null>(null);
  const [pmPrompt, setPmPrompt] = useState<{ position: Position; prixSortie: number } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

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
      return; // saisie invalide : on ignore (dégradation silencieuse)
    }
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

  return (
    <>
      {/* En-tête standard, sans croix de fermeture : celle-ci est fournie par le chrome FloatingWindow */}
      <EnTeteFenetre titre="Portefeuille" sousTitre="Positions manuelles · PnL live" />

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
        <section>
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-text-dim">
            <span>Ouvertes</span>
            <span>{openPositions.length}</span>
          </div>
          {openPositions.length === 0 ? (
            <Vide>Aucune position ouverte. Ajoutez-en une ci-dessous.</Vide>
          ) : (
            <div className="space-y-1">
              {openPositions.map((p) => (
                <div key={p.id} className="rounded-md border border-border bg-bg px-2.5 py-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => voirSurChart(p)}
                      className="flex min-w-0 items-center gap-1.5 text-left"
                      title="Voir sur le chart"
                    >
                      <span className="font-medium text-text">{p.symbole}</span>
                      <span
                        className={`rounded px-1 text-[9px] font-semibold uppercase ${
                          p.direction === "long" ? "text-up" : "text-down"
                        }`}
                      >
                        {p.direction}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span ref={(el) => registerCell(cells.current, p.id, "pnl", el)} className="tabular-nums font-medium">—</span>
                      <span ref={(el) => registerCell(cells.current, p.id, "pct", el)} className="tabular-nums text-[10px]">—</span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-dim">
                    <span className="tabular-nums">
                      {p.taille} @ {formatPrice(p.prixEntree)}
                      {p.fraisPct !== undefined ? ` · ${p.fraisPct}%` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-text-dim">
                        mkt <span ref={(el) => registerCell(cells.current, p.id, "prix", el)} className="text-text">—</span>
                      </span>
                      {closing?.id !== p.id && (
                        <button
                          type="button"
                          onClick={() => demanderCloture(p)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] transition hover:text-accent"
                        >
                          Clôturer
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => portfolioStore.getState().supprimer(p.id)}
                        aria-label={`Supprimer ${p.symbole}`}
                        className="text-text-dim transition hover:text-down"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {/* Éditeur de clôture inline (prix marché prérempli) */}
                  {closing?.id === p.id && (
                    <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2">
                      <label className="text-[10px] text-text-dim">Prix sortie</label>
                      <input
                        autoFocus
                        value={closing.prix}
                        onChange={(e) => setClosing({ id: p.id, prix: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmerCloture(p);
                          if (e.key === "Escape") setClosing(null);
                        }}
                        inputMode="decimal"
                        className="w-24 rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
                      />
                      <button
                        type="button"
                        onClick={() => confirmerCloture(p)}
                        className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] transition hover:text-accent"
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        onClick={() => setClosing(null)}
                        className="rounded px-1 text-[10px] text-text-dim transition hover:text-text"
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Formulaire d'ajout compact */}
        <section className="mt-3 rounded-md border border-border bg-bg p-2.5">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-text-dim">Nouvelle position</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={form.symbole}
              onChange={(e) => setForm((f) => ({ ...f, symbole: e.target.value.toUpperCase() }))}
              placeholder="Symbole"
              spellCheck={false}
              className="w-24 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
            />
            <div className="flex overflow-hidden rounded border border-border">
              {(["long", "short"] as Direction[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, direction: d }))}
                  className={`px-2 py-1 text-[10px] font-semibold uppercase transition ${
                    form.direction === d
                      ? `bg-surface ${d === "long" ? "text-up" : "text-down"}`
                      : "text-text-dim hover:text-text"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <input
              value={form.taille}
              onChange={(e) => setForm((f) => ({ ...f, taille: e.target.value }))}
              placeholder="Taille"
              inputMode="decimal"
              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.prixEntree}
              onChange={(e) => setForm((f) => ({ ...f, prixEntree: e.target.value }))}
              placeholder="Prix"
              inputMode="decimal"
              className="w-20 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
            <input
              value={form.fraisPct}
              onChange={(e) => setForm((f) => ({ ...f, fraisPct: e.target.value }))}
              placeholder="Frais %"
              inputMode="decimal"
              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text outline-none focus:border-text-dim"
            />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
              }}
              placeholder="Note (optionnel)"
              className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text outline-none focus:border-text-dim"
            />
            <button
              type="button"
              onClick={submitAdd}
              className="shrink-0 rounded border border-border bg-surface px-3 py-1 text-[11px] text-text transition hover:text-accent"
            >
              Ajouter
            </button>
          </div>
        </section>

        {/* Section « Clos » repliée + stats */}
        <section className="mt-3">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-text-dim transition hover:text-text"
          >
            <span className="uppercase tracking-wider">Clos ({stats.nombre})</span>
            <span className="flex items-center gap-3 tabular-nums">
              <span>
                Win {stats.nombre > 0 ? `${stats.winRate.toFixed(0)}%` : "—"}
              </span>
              <span className={stats.pnlCumule > 0 ? "text-up" : stats.pnlCumule < 0 ? "text-down" : undefined}>
                {stats.nombre > 0 ? `${stats.pnlCumule > 0 ? "+" : ""}${formatUsd(stats.pnlCumule)}` : "—"}
              </span>
              <span>{showClosed ? "▾" : "▸"}</span>
            </span>
          </button>
          {showClosed && (
            <div className="mt-1 space-y-1">
              {stats.nombre > 0 && (
                <div className="flex justify-between rounded-md border border-border bg-bg px-3 py-1.5 text-[10px] text-text-dim">
                  <span>Meilleure <span className="tabular-nums text-up">{formatUsd(stats.meilleure ?? undefined)}</span></span>
                  <span>Pire <span className="tabular-nums text-down">{formatUsd(stats.pire ?? undefined)}</span></span>
                </div>
              )}
              {closedPositions.length === 0 ? (
                <Vide>Aucune position clôturée.</Vide>
              ) : (
                closedPositions.map((p) => {
                  const pnl = pnlRealisePosition(p);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[11px]">
                      <button type="button" onClick={() => voirSurChart(p)} className="flex items-center gap-1.5 text-left" title="Voir sur le chart">
                        <span className="font-medium text-text">{p.symbole}</span>
                        <span className={`text-[9px] font-semibold uppercase ${p.direction === "long" ? "text-up" : "text-down"}`}>
                          {p.direction}
                        </span>
                      </button>
                      <span className="flex items-center gap-2 text-[10px] text-text-dim">
                        <span className="tabular-nums">{formatPrice(p.prixEntree)} → {formatPrice(p.prixSortie ?? 0)}</span>
                        <span
                          className={`tabular-nums font-medium ${
                            pnl && pnl.net > 0 ? "text-up" : pnl && pnl.net < 0 ? "text-down" : ""
                          }`}
                        >
                          {pnl ? `${pnl.net > 0 ? "+" : ""}${formatUsd(pnl.net)}` : "—"}
                        </span>
                        <button
                          type="button"
                          onClick={() => portfolioStore.getState().supprimer(p.id)}
                          aria-label={`Supprimer ${p.symbole}`}
                          className="text-text-dim transition hover:text-down"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
