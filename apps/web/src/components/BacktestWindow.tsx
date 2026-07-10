/**
 * Fenêtre « Backtest (BT) » — dockable à droite, NON MODALE (pas d'overlay).
 *
 * Comme ScreenerWindow / DerivativesWindow, ce panneau ne capture pas les clics : le
 * graphe reste interactif. Ouverture via la commande BT (toggle). Il expose un builder de
 * stratégie (règles composables réutilisant le vocabulaire du screener), le choix
 * symbole/TF/plage, frais/slippage/capital, un bouton de run avec progression, puis les
 * résultats : statistiques en grille, equity curve (+ drawdown) sur canvas, et table des
 * trades triable.
 *
 * Étiquette d'honnêteté affichée en permanence : « bougies clôturées, exécution open+1,
 * pas d'intrabar » (cf. le contrat du moteur @axiom/backtest/engine.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type {
  Comparateur,
  Condition,
  Direction,
  Operande,
  ResultatBacktest,
  SensCroisement,
  TradeResultat,
} from "@axiom/backtest";
import {
  backtestStore,
  BACKTEST_TIMEFRAMES,
  BUILTIN_STRATEGIES,
  CATALOGUE_OPERANDES,
  decrireOperande,
  importerDepuisChart,
  PLAGES,
  specParId,
  type PhaseBacktest,
} from "../store/backtest";
import { formatDateHeure, formatDec, formatPct, formatPrice } from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { BTN_SECONDAIRE, EnTeteFenetre, ErreurBloc, NoteSource, Vide } from "./ui";

const inputClass =
  "rounded border border-border bg-bg px-1.5 py-1 text-[11px] text-text focus:border-text-dim focus:outline-none";

const COMPARATEURS: Comparateur[] = [">", ">=", "<", "<="];

/** Opérande neutre par défaut (utilisé aux bascules de type). */
function operandeDefaut(): Operande {
  return { type: "prix", champ: "close" };
}

// ─────────────────────────── Formatage ───────────────────────────

/**
 * Facteur de profit : « ∞ » quand il n'y a aucune perte (sémantique métier),
 * sinon 2 décimales via le formateur partagé.
 */
function formatPF(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return formatDec(n);
}

function phaseLabel(phase: PhaseBacktest): string {
  switch (phase) {
    case "idle":
      return "Prêt";
    case "chargement":
      return "Chargement de l'historique…";
    case "calcul":
      return "Calcul du backtest…";
    case "done":
      return "Terminé";
    case "error":
      return "Erreur";
  }
}

// ─────────────────────────── Sélecteur d'opérande ───────────────────────────

/** Menu déroulant d'opérande (catalogue curé) + éventuel paramètre `length`. */
function OperandeSelect({
  op,
  onChange,
  aria,
}: {
  op: Operande;
  onChange: (o: Operande) => void;
  aria: string;
}) {
  const { specId, param } = decrireOperande(op);
  const spec = specParId(specId);
  return (
    <span className="flex items-center gap-1">
      <select
        value={specId}
        onChange={(e) => {
          const s = specParId(e.target.value);
          if (s) onChange(s.make(s.defaultParam));
        }}
        className={inputClass}
        aria-label={aria}
      >
        {CATALOGUE_OPERANDES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {spec?.paramKey !== undefined && (
        <input
          type="number"
          value={param ?? spec.defaultParam ?? 0}
          onChange={(e) => onChange(spec.make(Number(e.target.value)))}
          className={`${inputClass} w-12 tabular-nums`}
          aria-label={spec.paramKey}
          title={spec.paramKey}
        />
      )}
    </span>
  );
}

/** Bascule une condition entre comparaison et croisement en conservant l'opérande gauche. */
function basculerType(cond: Condition, type: "comparaison" | "croisement"): Condition {
  if (type === cond.type) return cond;
  if (type === "croisement") {
    const a = cond.type === "comparaison" ? cond.gauche : operandeDefaut();
    const b =
      cond.type === "comparaison" && cond.droite.type !== "constante"
        ? cond.droite
        : operandeDefaut();
    return { type: "croisement", a, b, sens: "hausse" };
  }
  const gauche = cond.type === "croisement" ? cond.a : operandeDefaut();
  return { type: "comparaison", gauche, comparateur: ">", droite: { type: "constante", valeur: 0 } };
}

/** Ligne d'édition d'une condition (comparaison ou croisement d'opérandes). */
function ConditionRow({
  cond,
  onChange,
  onRemove,
}: {
  cond: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1 rounded border border-border/60 bg-bg px-2 py-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <select
          value={cond.type}
          onChange={(e) => onChange(basculerType(cond, e.target.value as "comparaison" | "croisement"))}
          className={inputClass}
          aria-label="Type de condition"
        >
          <option value="comparaison">comparaison</option>
          <option value="croisement">croisement</option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer la condition"
          className="rounded px-1 text-text-dim transition hover:text-down"
        >
          ✕
        </button>
      </div>

      {cond.type === "comparaison" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <OperandeSelect op={cond.gauche} onChange={(g) => onChange({ ...cond, gauche: g })} aria="Opérande gauche" />
          <select
            value={cond.comparateur}
            onChange={(e) => onChange({ ...cond, comparateur: e.target.value as Comparateur })}
            className={inputClass}
            aria-label="Comparateur"
          >
            {COMPARATEURS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <select
            value={cond.droite.type === "constante" ? "constante" : "operande"}
            onChange={(e) =>
              onChange({
                ...cond,
                droite: e.target.value === "constante" ? { type: "constante", valeur: 0 } : operandeDefaut(),
              })
            }
            className={inputClass}
            aria-label="Type du terme droit"
          >
            <option value="constante">valeur</option>
            <option value="operande">opérande</option>
          </select>
          {cond.droite.type === "constante" ? (
            <input
              type="number"
              value={cond.droite.valeur}
              onChange={(e) => onChange({ ...cond, droite: { type: "constante", valeur: Number(e.target.value) } })}
              className={`${inputClass} w-20 tabular-nums`}
              aria-label="Valeur"
            />
          ) : (
            <OperandeSelect op={cond.droite} onChange={(d) => onChange({ ...cond, droite: d })} aria="Opérande droit" />
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <OperandeSelect op={cond.a} onChange={(a) => onChange({ ...cond, a })} aria="Opérande A" />
          <select
            value={cond.sens}
            onChange={(e) => onChange({ ...cond, sens: e.target.value as SensCroisement })}
            className={inputClass}
            aria-label="Sens du croisement"
          >
            <option value="hausse">croise ↑</option>
            <option value="baisse">croise ↓</option>
          </select>
          <OperandeSelect op={cond.b} onChange={(b) => onChange({ ...cond, b })} aria="Opérande B" />
        </div>
      )}
    </div>
  );
}

/** Section d'un jeu de règles (entrée ou sortie). */
function RulesSection({
  titre,
  conditions,
  onAdd,
  onUpdate,
  onRemove,
  videLabel,
}: {
  titre: string;
  conditions: Condition[];
  onAdd: () => void;
  onUpdate: (i: number, c: Condition) => void;
  onRemove: (i: number) => void;
  videLabel: string;
}) {
  return (
    <section className="space-y-1.5 rounded-md border border-border bg-bg px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">{titre}</span>
        <button type="button" onClick={onAdd} className="text-[11px] text-text-dim hover:text-text">
          + ajouter
        </button>
      </div>
      {conditions.length === 0 ? (
        <p className="text-[11px] text-text-dim">{videLabel}</p>
      ) : (
        conditions.map((c, i) => (
          <ConditionRow key={i} cond={c} onChange={(nc) => onUpdate(i, nc)} onRemove={() => onRemove(i)} />
        ))
      )}
    </section>
  );
}

// ─────────────────────────── Equity curve (canvas) ───────────────────────────

/** Dessine l'equity curve (haut) + le drawdown (bas) sur le canvas. */
function dessinerEquity(canvas: HTMLCanvasElement, resultat: ResultatBacktest): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const dpr = window.devicePixelRatio || 1;
  const largeur = canvas.clientWidth;
  const hauteur = canvas.clientHeight;
  if (largeur === 0 || hauteur === 0) return;
  canvas.width = Math.round(largeur * dpr);
  canvas.height = Math.round(hauteur * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largeur, hauteur);

  const points = resultat.equity;
  const colUp = lireTokenCanvas("--up", "#2dc08e");
  const colDown = lireTokenCanvas("--down", "#f92855");
  const colDim = lireTokenCanvas("--text-dim", "#9ca3af");
  const colBorder = lireTokenCanvas("--border", "#262626");

  if (points.length < 2) {
    ctx.fillStyle = colDim;
    ctx.font = "11px sans-serif";
    ctx.fillText("Equity : trop peu de points (aucun trade).", 8, hauteur / 2);
    return;
  }

  const pad = 6;
  const hEquity = Math.round(hauteur * 0.72);
  const hDd = hauteur - hEquity;
  const n = points.length;
  const xAt = (i: number): number => pad + (i / (n - 1)) * (largeur - 2 * pad);

  // — Equity (haut) —
  let minE = Infinity;
  let maxE = -Infinity;
  for (const p of points) {
    if (p.equity < minE) minE = p.equity;
    if (p.equity > maxE) maxE = p.equity;
  }
  const spanE = maxE - minE || 1;
  const yEquity = (v: number): number => pad + (1 - (v - minE) / spanE) * (hEquity - 2 * pad);

  // Ligne de capital initial (référence).
  const capital = points[0]?.equity ?? minE;
  ctx.strokeStyle = colBorder;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad, yEquity(capital));
  ctx.lineTo(largeur - pad, yEquity(capital));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = colUp;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yEquity(p.equity);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // — Drawdown (bas, aire rouge, 0 en haut de la zone) —
  let maxDd = 0;
  for (const p of points) if (p.drawdownPct > maxDd) maxDd = p.drawdownPct;
  const spanDd = maxDd || 1;
  const yDd = (dd: number): number => hEquity + (dd / spanDd) * (hDd - pad);
  ctx.fillStyle = colDown + "33"; // aire semi-transparente
  ctx.strokeStyle = colDown;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xAt(0), hEquity);
  points.forEach((p, i) => ctx.lineTo(xAt(i), yDd(p.drawdownPct)));
  ctx.lineTo(xAt(n - 1), hEquity);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i);
    const y = yDd(p.drawdownPct);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Séparateur des deux zones.
  ctx.strokeStyle = colBorder;
  ctx.beginPath();
  ctx.moveTo(0, hEquity);
  ctx.lineTo(largeur, hEquity);
  ctx.stroke();
}

/** Canvas de l'equity curve, redessiné au changement de résultat ou de taille. */
function EquityCanvas({ resultat }: { resultat: ResultatBacktest }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const redraw = (): void => dessinerEquity(canvas, resultat);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [resultat]);
  return (
    <canvas
      ref={ref}
      className="h-40 w-full rounded-md border border-border bg-bg"
      role="img"
      aria-label="Courbe d'équité et drawdown"
    />
  );
}

// ─────────────────────────── Table des trades ───────────────────────────

type SortKey = "tempsEntree" | "pnl" | "pnlPct" | "dureeBarres";
interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

function SortHeader({
  label,
  colKey,
  sort,
  setSort,
}: {
  label: string;
  colKey: SortKey;
  sort: SortState;
  setSort: (s: SortState) => void;
}) {
  const active = sort.key === colKey;
  return (
    <button
      type="button"
      onClick={() => setSort({ key: colKey, dir: active && sort.dir === -1 ? 1 : -1 })}
      className="flex w-full items-center justify-end gap-0.5 text-[10px] uppercase tracking-wide text-text-dim transition hover:text-text"
    >
      {label}
      {active && <span>{sort.dir === -1 ? "▾" : "▴"}</span>}
    </button>
  );
}

const RAISON_LABEL: Record<TradeResultat["raison"], string> = {
  regle: "règle",
  stop: "stop",
  target: "objectif",
  "fin-donnees": "fin",
};

function TradesTable({ trades }: { trades: TradeResultat[] }) {
  const [sort, setSort] = useState<SortState>({ key: "tempsEntree", dir: 1 });
  const sorted = useMemo(() => {
    return [...trades].sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
  }, [trades, sort]);

  const cols = "grid grid-cols-[0.6fr_1fr_1fr_0.7fr_0.9fr_0.7fr] items-center gap-2";
  return (
    <section className="rounded-md border border-border bg-bg">
      <div className={`${cols} border-b border-border px-3 py-1.5`}>
        <span className="text-[10px] uppercase tracking-wide text-text-dim">Sens</span>
        <SortHeader label="Entrée" colKey="tempsEntree" sort={sort} setSort={setSort} />
        <span className="text-right text-[10px] uppercase tracking-wide text-text-dim">Sortie</span>
        <SortHeader label="Durée" colKey="dureeBarres" sort={sort} setSort={setSort} />
        <SortHeader label="PnL" colKey="pnl" sort={sort} setSort={setSort} />
        <SortHeader label="PnL%" colKey="pnlPct" sort={sort} setSort={setSort} />
      </div>
      <div className="max-h-[34vh] overflow-y-auto">
        {sorted.length === 0 ? (
          <Vide>Aucun trade.</Vide>
        ) : (
          sorted.map((tr, i) => (
            <div
              key={i}
              className={`${cols} border-b border-border/50 px-3 py-1.5 text-[11px] last:border-b-0`}
            >
              <span className={tr.sens === "long" ? "text-up" : "text-down"}>
                {tr.sens === "long" ? "L" : "S"}
              </span>
              <span className="text-right tabular-nums text-text-dim">
                {formatDateHeure(tr.tempsEntree)}
                <span className="ml-1 text-text">{formatPrice(tr.prixEntree)}</span>
              </span>
              <span className="text-right tabular-nums text-text-dim">
                {formatDateHeure(tr.tempsSortie)}
                <span className="ml-1 text-text">{formatPrice(tr.prixSortie)}</span>
                <span className="ml-1 text-[9px] uppercase">{RAISON_LABEL[tr.raison]}</span>
              </span>
              <span className="text-right tabular-nums text-text-dim">{tr.dureeBarres}</span>
              <span className={`text-right tabular-nums ${tr.pnl >= 0 ? "text-up" : "text-down"}`}>
                {formatDec(tr.pnl)}
              </span>
              <span className={`text-right tabular-nums ${tr.pnlPct >= 0 ? "text-up" : "text-down"}`}>
                {formatPct(tr.pnlPct)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ─────────────────────────── Grille de statistiques ───────────────────────────

function StatCard({ label, value, ton }: { label: string; value: string; ton?: "up" | "down" }) {
  const couleur = ton === "up" ? "text-up" : ton === "down" ? "text-down" : "text-text";
  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
      <div className={`tabular-nums text-sm font-medium ${couleur}`}>{value}</div>
    </div>
  );
}

function StatsGrid({ resultat }: { resultat: ResultatBacktest }) {
  const s = resultat.stats;
  return (
    <section className="grid grid-cols-3 gap-1.5">
      <StatCard label="Trades" value={String(s.nbTrades)} />
      <StatCard label="Taux de réussite" value={`${s.winRatePct.toFixed(1)}%`} />
      <StatCard label="Facteur de profit" value={formatPF(s.profitFactor)} />
      <StatCard
        label="PnL net"
        value={`${formatDec(s.pnlTotal)} (${formatPct(s.pnlTotalPct)})`}
        ton={s.pnlTotal >= 0 ? "up" : "down"}
      />
      <StatCard label="Drawdown max" value={`${s.maxDrawdownPct.toFixed(1)}%`} ton="down" />
      <StatCard label="Sharpe (annualisé)" value={formatDec(s.sharpe)} />
      <StatCard label="Exposition" value={`${s.expositionPct.toFixed(0)}%`} />
      <StatCard label="Gain moyen" value={formatPct(s.gainMoyenPct)} ton="up" />
      <StatCard label="Perte moyenne" value={formatPct(s.perteMoyennePct)} ton="down" />
    </section>
  );
}

// ─────────────────────────── Panneau principal ───────────────────────────

export function BacktestWindow() {
  const symbol = useStore(backtestStore, (s) => s.symbol);
  const tf = useStore(backtestStore, (s) => s.tf);
  const plage = useStore(backtestStore, (s) => s.plage);
  const direction = useStore(backtestStore, (s) => s.direction);
  const tailleFixe = useStore(backtestStore, (s) => s.tailleFixe);
  const stopPct = useStore(backtestStore, (s) => s.stopPct);
  const targetPct = useStore(backtestStore, (s) => s.targetPct);
  const fraisPct = useStore(backtestStore, (s) => s.fraisPct);
  const slippagePct = useStore(backtestStore, (s) => s.slippagePct);
  const capitalInitial = useStore(backtestStore, (s) => s.capitalInitial);
  const reglesEntree = useStore(backtestStore, (s) => s.reglesEntree);
  const reglesSortie = useStore(backtestStore, (s) => s.reglesSortie);

  const setSymbol = useStore(backtestStore, (s) => s.setSymbol);
  const setTf = useStore(backtestStore, (s) => s.setTf);
  const setPlage = useStore(backtestStore, (s) => s.setPlage);
  const setDirection = useStore(backtestStore, (s) => s.setDirection);
  const setTailleFixe = useStore(backtestStore, (s) => s.setTailleFixe);
  const setStopPct = useStore(backtestStore, (s) => s.setStopPct);
  const setTargetPct = useStore(backtestStore, (s) => s.setTargetPct);
  const setFraisPct = useStore(backtestStore, (s) => s.setFraisPct);
  const setSlippagePct = useStore(backtestStore, (s) => s.setSlippagePct);
  const setCapitalInitial = useStore(backtestStore, (s) => s.setCapitalInitial);
  const addEntree = useStore(backtestStore, (s) => s.addEntree);
  const updateEntree = useStore(backtestStore, (s) => s.updateEntree);
  const removeEntree = useStore(backtestStore, (s) => s.removeEntree);
  const addSortie = useStore(backtestStore, (s) => s.addSortie);
  const updateSortie = useStore(backtestStore, (s) => s.updateSortie);
  const removeSortie = useStore(backtestStore, (s) => s.removeSortie);

  const userPresets = useStore(backtestStore, (s) => s.userPresets);
  const loadPreset = useStore(backtestStore, (s) => s.loadPreset);
  const savePreset = useStore(backtestStore, (s) => s.savePreset);
  const deletePreset = useStore(backtestStore, (s) => s.deletePreset);

  const phase = useStore(backtestStore, (s) => s.phase);
  const progress = useStore(backtestStore, (s) => s.progress);
  const resultat = useStore(backtestStore, (s) => s.resultat);
  const error = useStore(backtestStore, (s) => s.error);
  const note = useStore(backtestStore, (s) => s.note);
  const run = useStore(backtestStore, (s) => s.run);
  const cancel = useStore(backtestStore, (s) => s.cancel);

  const [presetName, setPresetName] = useState("");
  const busy = phase === "chargement" || phase === "calcul";
  const pctProgress =
    progress.cible > 0 ? Math.min(100, (progress.recuperees / progress.cible) * 100) : 0;

  return (
    <>
      <EnTeteFenetre
        titre="Backtest · BT"
        sousTitre="Bougies clôturées · exécution open+1 · pas d'intrabar"
      />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* Presets */}
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-text-dim">Stratégies</div>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_STRATEGIES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => loadPreset(p.id)}
                className={BTN_SECONDAIRE}
              >
                {p.name}
              </button>
            ))}
            {userPresets.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim"
              >
                <button type="button" onClick={() => loadPreset(p.id)} className="transition hover:text-text">
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => deletePreset(p.id)}
                  aria-label={`Supprimer le preset ${p.name}`}
                  className="text-text-dim transition hover:text-down"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Nom de la stratégie…"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => {
                savePreset(presetName);
                setPresetName("");
              }}
              disabled={presetName.trim().length === 0}
              className={`${BTN_SECONDAIRE} disabled:opacity-40`}
            >
              Enregistrer
            </button>
          </div>
        </section>

        {/* Marché & plage */}
        <section className="space-y-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Symbole
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className={`${inputClass} w-28`}
                aria-label="Symbole"
              />
            </label>
            <button
              type="button"
              onClick={importerDepuisChart}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-dim transition hover:text-text"
              title="Reprendre le symbole et le TF du graphe"
            >
              ↧ du chart
            </button>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              TF
              <select
                value={tf}
                onChange={(e) => setTf(e.target.value as (typeof BACKTEST_TIMEFRAMES)[number])}
                className={inputClass}
                aria-label="Timeframe"
              >
                {BACKTEST_TIMEFRAMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Plage
              <select
                value={plage}
                onChange={(e) => setPlage(e.target.value as (typeof PLAGES)[number]["id"])}
                className={inputClass}
                aria-label="Plage historique"
              >
                {PLAGES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Règles */}
        <RulesSection
          titre="Règles d'entrée (toutes vraies)"
          conditions={reglesEntree}
          onAdd={addEntree}
          onUpdate={updateEntree}
          onRemove={removeEntree}
          videLabel="Aucune règle d'entrée → aucun trade."
        />
        <RulesSection
          titre={
            direction === "les-deux" ? "Règles de sortie / signal short (toutes vraies)" : "Règles de sortie (toutes vraies)"
          }
          conditions={reglesSortie}
          onAdd={addSortie}
          onUpdate={updateSortie}
          onRemove={removeSortie}
          videLabel="Aucune règle de sortie → clôture par stop/objectif/fin de données."
        />

        {/* Paramètres d'exécution */}
        <section className="space-y-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Direction
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
                className={inputClass}
                aria-label="Direction"
              >
                <option value="long">Long</option>
                <option value="short">Short</option>
                <option value="les-deux">Les deux (retournement)</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Taille
              <input
                type="number"
                value={tailleFixe}
                onChange={(e) => setTailleFixe(Number(e.target.value))}
                className={`${inputClass} w-20 tabular-nums`}
                aria-label="Taille fixe (notionnel)"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Capital
              <input
                type="number"
                value={capitalInitial}
                onChange={(e) => setCapitalInitial(Number(e.target.value))}
                className={`${inputClass} w-24 tabular-nums`}
                aria-label="Capital initial"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Frais %
              <input
                type="number"
                step="0.01"
                value={fraisPct}
                onChange={(e) => setFraisPct(Number(e.target.value))}
                className={`${inputClass} w-16 tabular-nums`}
                aria-label="Frais en pourcentage"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              Slippage %
              <input
                type="number"
                step="0.01"
                value={slippagePct}
                onChange={(e) => setSlippagePct(Number(e.target.value))}
                className={`${inputClass} w-16 tabular-nums`}
                aria-label="Slippage en pourcentage"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              <input
                type="checkbox"
                checked={stopPct !== null}
                onChange={(e) => setStopPct(e.target.checked ? 5 : null)}
                aria-label="Activer le stop"
              />
              Stop %
              <input
                type="number"
                step="0.1"
                value={stopPct ?? 0}
                disabled={stopPct === null}
                onChange={(e) => setStopPct(Number(e.target.value))}
                className={`${inputClass} w-14 tabular-nums disabled:opacity-40`}
                aria-label="Stop en pourcentage"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-dim">
              <input
                type="checkbox"
                checked={targetPct !== null}
                onChange={(e) => setTargetPct(e.target.checked ? 10 : null)}
                aria-label="Activer l'objectif"
              />
              Objectif %
              <input
                type="number"
                step="0.1"
                value={targetPct ?? 0}
                disabled={targetPct === null}
                onChange={(e) => setTargetPct(Number(e.target.value))}
                className={`${inputClass} w-14 tabular-nums disabled:opacity-40`}
                aria-label="Objectif en pourcentage"
              />
            </label>
          </div>
        </section>

        {/* Contrôle du run */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            {busy ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded border border-border bg-bg px-3 py-1.5 text-[11px] text-text-dim transition hover:text-down"
              >
                Annuler
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className="rounded bg-accent/20 px-3 py-1.5 text-[11px] font-medium text-text transition hover:bg-accent/30"
              >
                Lancer le backtest
              </button>
            )}
            <span className="text-[11px] text-text-dim">{phaseLabel(phase)}</span>
            {phase === "chargement" && progress.cible > 0 && (
              <span className="tabular-nums text-[11px] text-text-dim">
                {progress.recuperees}/{progress.cible} bougies
              </span>
            )}
          </div>

          {phase === "chargement" && progress.cible > 0 && (
            <div className="h-1 w-full overflow-hidden rounded bg-bg">
              <div className="h-full bg-up transition-all" style={{ width: `${pctProgress}%` }} />
            </div>
          )}

          {note !== null && <p className="text-[10px] text-text-dim">{note}</p>}
          {error !== null && <ErreurBloc>{error}</ErreurBloc>}
          <NoteSource>
            Honnêteté : signaux sur bougies CLÔTURÉES, exécution à l'OPEN de la bougie suivante,
            stop/objectif sur la clôture (pas d'intrabar). Frais et slippage appliqués aux deux côtés.
          </NoteSource>
        </section>

        {/* Résultats */}
        {resultat !== null && phase === "done" && (
          <div className="space-y-3">
            <StatsGrid resultat={resultat} />
            <EquityCanvas resultat={resultat} />
            <TradesTable trades={resultat.trades} />
          </div>
        )}
      </div>
    </>
  );
}
