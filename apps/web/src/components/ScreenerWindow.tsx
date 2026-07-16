/**
 * Panneau « Screener (EQS) » — dockable à droite, NON MODAL (pas d'overlay).
 *
 * Comme DerivativesWindow, ce panneau ne capture pas les clics : le graphe reste
 * interactif. Ouverture via la commande EQS (toggle). Il expose un builder de filtres
 * compact (conditions de base + conditions indicateurs), des presets (livrés + perso),
 * un bouton de run avec progression, et une table de résultats triable (clic = ouvre le
 * chart via `navigateTo` / bus C2, bouton = ajoute à la watchlist).
 *
 * Toutes les limites sont affichées honnêtement : le TF ne s'applique qu'aux filtres
 * indicateurs, l'étage indicateurs est plafonné à SCREENER_CAP, et OI/L-S (si demandés)
 * ne couvrent qu'un échantillon top N liquides (badge de couverture).
 */
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  ajouterAWatchlist,
  ouvrirDansChart,
  screenerStore,
  type RunState,
} from "../store/screener";
import {
  BASE_FIELDS,
  BUILTIN_PRESETS,
  getIndicatorField,
  INDICATOR_FIELDS,
  OPERATORS,
  SCREENER_CAP,
  SCREENER_POSITION_CAP,
  SCREENER_TIMEFRAMES,
  type BaseCondition,
  type BaseField,
  type IndicatorCondition,
  type Operator,
  type ScreenerRow,
} from "../data/screener";
import { estExtremeColonne, seuilDecile } from "../lib/extremesColonne";
import { formatPct, formatPrice, formatUsd } from "../lib/format";
import { metaSource } from "../lib/fiabilite";
import { BadgeFiabilite, EnTeteFenetre, ErreurBloc, NoteSource, Vide } from "./ui";

/** Colonnes triables de la table de résultats. */
type SortKey =
  | "symbol"
  | "lastPrice"
  | "priceChangePct24h"
  | "volumeUsd24h"
  | "fundingPct"
  | "oiChangePct"
  | "longShortRatio";
interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

// ─────────────────────────── Formatage ───────────────────────────

/** Libellé humain de l'état du run. */
function runStateLabel(state: RunState): string {
  switch (state) {
    case "idle":
      return "Prêt";
    case "loading":
      return "Chargement de l'univers…";
    case "running":
      return "Évaluation des indicateurs…";
    case "done":
      return "Terminé";
    case "error":
      return "Erreur";
  }
}

// ─────────────────────────── Sous-composants de filtres ───────────────────────────

const inputClass =
  "rounded border border-border bg-bg px-2 py-1 text-[11px] text-text focus:border-text-dim focus:outline-none";

/** Ligne de condition de BASE : champ / opérateur / valeur / suppression. */
function BaseConditionRow({ index, cond }: { index: number; cond: BaseCondition }) {
  const update = useStore(screenerStore, (s) => s.updateBaseCondition);
  const remove = useStore(screenerStore, (s) => s.removeBaseCondition);
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={cond.field}
        onChange={(e) => update(index, { field: e.target.value as BaseField })}
        className={`${inputClass} flex-1`}
        aria-label="Champ"
      >
        {BASE_FIELDS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
          </option>
        ))}
      </select>
      <select
        value={cond.op}
        onChange={(e) => update(index, { op: e.target.value as Operator })}
        className={inputClass}
        aria-label="Opérateur"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={cond.value}
        onChange={(e) => update(index, { value: Number(e.target.value) })}
        className={`${inputClass} w-24 tabular-nums`}
        aria-label="Valeur"
      />
      <button
        type="button"
        onClick={() => remove(index)}
        aria-label="Retirer la condition"
        className="rounded px-1 text-text-dim transition hover:text-down"
      >
        ✕
      </button>
    </div>
  );
}

/** Ligne de condition INDICATEUR : champ / (paramètre) / opérateur / valeur / suppression. */
function IndicatorConditionRow({ index, cond }: { index: number; cond: IndicatorCondition }) {
  const update = useStore(screenerStore, (s) => s.updateIndicatorCondition);
  const remove = useStore(screenerStore, (s) => s.removeIndicatorCondition);
  const spec = getIndicatorField(cond.fieldId);
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={cond.fieldId}
        onChange={(e) => update(index, { fieldId: e.target.value })}
        className={`${inputClass} flex-1`}
        aria-label="Indicateur"
      >
        {INDICATOR_FIELDS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
          </option>
        ))}
      </select>
      {spec?.paramKey !== undefined && (
        <input
          type="number"
          value={cond.param ?? spec.defaultParam ?? 0}
          onChange={(e) => update(index, { param: Number(e.target.value) })}
          className={`${inputClass} w-12 tabular-nums`}
          aria-label={spec.paramKey}
          title={spec.paramKey}
        />
      )}
      <select
        value={cond.op}
        onChange={(e) => update(index, { op: e.target.value as Operator })}
        className={inputClass}
        aria-label="Opérateur"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={cond.value}
        onChange={(e) => update(index, { value: Number(e.target.value) })}
        className={`${inputClass} w-16 tabular-nums`}
        aria-label="Valeur"
      />
      <button
        type="button"
        onClick={() => remove(index)}
        aria-label="Retirer la condition"
        className="rounded px-1 text-text-dim transition hover:text-down"
      >
        ✕
      </button>
    </div>
  );
}

// ─────────────────────────── En-tête de colonne triable ───────────────────────────

function SortHeader({
  label,
  colKey,
  sort,
  setSort,
  align = "left",
}: {
  label: string;
  colKey: SortKey;
  sort: SortState;
  setSort: (s: SortState) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === colKey;
  return (
    <button
      type="button"
      onClick={() => setSort({ key: colKey, dir: active && sort.dir === -1 ? 1 : -1 })}
      className={`flex w-full items-center gap-0.5 text-[10px] uppercase tracking-wide text-text-dim transition hover:text-text ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      {label}
      {active && <span>{sort.dir === -1 ? "▾" : "▴"}</span>}
    </button>
  );
}

// ─────────────────────────── Panneau principal ───────────────────────────

export function ScreenerWindow() {
  const tf = useStore(screenerStore, (s) => s.tf);
  const setTf = useStore(screenerStore, (s) => s.setTf);
  const baseConditions = useStore(screenerStore, (s) => s.baseConditions);
  const indicatorConditions = useStore(screenerStore, (s) => s.indicatorConditions);
  const addBase = useStore(screenerStore, (s) => s.addBaseCondition);
  const addIndicator = useStore(screenerStore, (s) => s.addIndicatorCondition);
  const userPresets = useStore(screenerStore, (s) => s.userPresets);
  const loadPreset = useStore(screenerStore, (s) => s.loadPreset);
  const savePreset = useStore(screenerStore, (s) => s.savePreset);
  const deletePreset = useStore(screenerStore, (s) => s.deletePreset);
  const runState = useStore(screenerStore, (s) => s.runState);
  const progress = useStore(screenerStore, (s) => s.progress);
  const rows = useStore(screenerStore, (s) => s.rows);
  const error = useStore(screenerStore, (s) => s.error);
  const note = useStore(screenerStore, (s) => s.note);
  const run = useStore(screenerStore, (s) => s.run);
  const cancel = useStore(screenerStore, (s) => s.cancel);

  const [presetName, setPresetName] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "volumeUsd24h", dir: -1 });

  const busy = runState === "loading" || runState === "running";

  const sortedRows = useMemo(() => {
    const val = (r: ScreenerRow, k: SortKey): number | string | undefined => r[k];
    return [...rows].sort((a, b) => {
      const va = val(a, sort.key);
      const vb = val(b, sort.key);
      // Valeurs manquantes (ex. funding / OI) toujours en fin de tri.
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * sort.dir;
      }
      return (va - vb) * sort.dir;
    });
  }, [rows, sort]);

  /** Colonnes OI / L-S uniquement si au moins une ligne les porte (échantillon enrichi). */
  const showPositionCols = useMemo(
    () => rows.some((r) => r.oiChangePct !== undefined || r.longShortRatio !== undefined),
    [rows],
  );

  // Extrêmes cross-sectionnels : 9e décile des |valeurs| de l'univers affiché.
  const seuils = useMemo(
    () => ({
      funding: seuilDecile(sortedRows.map((r) => Math.abs(r.fundingPct ?? Number.NaN)), 0.9),
      deltaOi: seuilDecile(sortedRows.map((r) => Math.abs(r.oiChangePct ?? Number.NaN)), 0.9),
    }),
    [sortedRows],
  );

  /** Badge de couverture si la note mentionne l'échantillon OI/L-S. */
  const showPositionBadge =
    note !== null && (note.includes("OI/L-S") || note.includes("échantillon"));

  const gridCols = showPositionCols
    ? "grid-cols-[1.3fr_0.8fr_0.7fr_0.8fr_0.75fr_0.7fr_0.7fr_auto]"
    : "grid-cols-[1.4fr_0.9fr_0.8fr_0.9fr_0.9fr_auto]";

  return (
    <>
      <EnTeteFenetre mnemo="EQS" titre="Screener" sousTitre="Binance spot USDT/USDC · funding perp" />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* Presets */}
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-text-dim">Presets</div>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => loadPreset(p.id)}
                className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text"
                title={
                  p.id.startsWith("builtin:crowded") || p.id === "builtin:funding-extreme"
                    ? `Positionnement · OI/L-S sur top ${SCREENER_POSITION_CAP} liquides`
                    : undefined
                }
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
              placeholder="Nom du preset…"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => {
                savePreset(presetName);
                setPresetName("");
              }}
              disabled={presetName.trim().length === 0}
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text disabled:opacity-40"
            >
              Enregistrer
            </button>
          </div>
        </section>

        {/* Filtres de base */}
        <section className="space-y-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-text-dim">Filtres de base</span>
            <button type="button" onClick={addBase} className="text-[11px] text-text-dim hover:text-text">
              + ajouter
            </button>
          </div>
          {baseConditions.length === 0 ? (
            <p className="text-[11px] text-text-dim">Aucun filtre (tout l'univers USDT/USDC).</p>
          ) : (
            baseConditions.map((c, i) => <BaseConditionRow key={i} index={i} cond={c} />)
          )}
        </section>

        {/* Filtres indicateurs */}
        <section className="space-y-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-text-dim">
              Filtres indicateurs
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-text-dim">
                TF
                <select
                  value={tf}
                  onChange={(e) => setTf(e.target.value as (typeof SCREENER_TIMEFRAMES)[number])}
                  className={inputClass}
                  aria-label="Timeframe des indicateurs"
                >
                  {SCREENER_TIMEFRAMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={addIndicator}
                className="text-[11px] text-text-dim hover:text-text"
              >
                + ajouter
              </button>
            </div>
          </div>
          {indicatorConditions.length === 0 ? (
            <p className="text-[11px] text-text-dim">Aucun filtre indicateur (étage klines ignoré).</p>
          ) : (
            indicatorConditions.map((c, i) => <IndicatorConditionRow key={i} index={i} cond={c} />)
          )}
          {indicatorConditions.length > 0 && (
            <p className="text-[10px] leading-snug text-text-dim">
              Évalués sur le TF {tf}, plafond {SCREENER_CAP} symboles/run (les plus liquides).
            </p>
          )}
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
                className="rounded border border-up/50 bg-bg px-3 py-1.5 text-[11px] font-medium text-up transition hover:bg-up/10"
              >
                Lancer le screen
              </button>
            )}
            <span className="text-[11px] text-text-dim">{runStateLabel(runState)}</span>
            {runState === "running" && (
              <span className="tabular-nums text-[11px] text-text-dim">
                {progress.done}/{progress.total}
              </span>
            )}
          </div>

          {runState === "running" && progress.total > 0 && (
            <div className="h-1 w-full overflow-hidden rounded bg-bg">
              <div
                className="h-full bg-up transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}

          {note !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] text-text-dim">{note}</p>
              {showPositionBadge && (
                <BadgeFiabilite meta={metaSource("binance:futures:position")} />
              )}
            </div>
          )}
          {error !== null && <ErreurBloc>{error}</ErreurBloc>}
        </section>

        {/* Résultats */}
        <section className="rounded-md border border-border bg-bg">
          <div className={`grid ${gridCols} items-center gap-2 border-b border-border px-3 py-1.5`}>
            <SortHeader label="Symbole" colKey="symbol" sort={sort} setSort={setSort} />
            <SortHeader label="Prix" colKey="lastPrice" sort={sort} setSort={setSort} align="right" />
            <SortHeader label="Δ24h" colKey="priceChangePct24h" sort={sort} setSort={setSort} align="right" />
            <SortHeader label="Vol 24h" colKey="volumeUsd24h" sort={sort} setSort={setSort} align="right" />
            <SortHeader label="Funding" colKey="fundingPct" sort={sort} setSort={setSort} align="right" />
            {showPositionCols && (
              <>
                <SortHeader label="Δ OI" colKey="oiChangePct" sort={sort} setSort={setSort} align="right" />
                <SortHeader label="L/S" colKey="longShortRatio" sort={sort} setSort={setSort} align="right" />
              </>
            )}
            <span className="text-right text-[10px] uppercase tracking-wide text-text-dim">Wl</span>
          </div>
          <div className="max-h-[40vh] overflow-y-auto">
            {sortedRows.length === 0 ? (
              <Vide>
                {runState === "done" ? "Aucun résultat." : "Lancez un screen pour voir les résultats."}
              </Vide>
            ) : (
              sortedRows.map((r) => (
                <div
                  key={r.symbol}
                  className={`grid ${gridCols} items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[11px] last:border-b-0 hover:bg-surface`}
                >
                  <button
                    type="button"
                    onClick={() => ouvrirDansChart(r.symbol)}
                    className="truncate text-left font-medium text-text transition hover:text-up"
                    title={`Ouvrir ${r.symbol} dans le chart`}
                  >
                    {r.symbol}
                    {r.indicatorValues && r.indicatorValues.length > 0 && (
                      <span className="ml-1 text-[10px] font-normal text-text-dim">
                        {r.indicatorValues.map((v) => `${v.label} ${v.value.toFixed(2)}`).join(" · ")}
                      </span>
                    )}
                  </button>
                  <span className="text-right tabular-nums text-text">{formatPrice(r.lastPrice)}</span>
                  <span
                    className={`text-right tabular-nums ${r.priceChangePct24h >= 0 ? "text-up" : "text-down"}`}
                  >
                    {formatPct(r.priceChangePct24h)}
                  </span>
                  <span className="text-right tabular-nums text-text-dim">{formatUsd(r.volumeUsd24h)}</span>
                  <span
                    className={`text-right tabular-nums ${
                      estExtremeColonne(r.fundingPct, seuils.funding)
                        ? "font-semibold text-warn"
                        : r.fundingPct === undefined
                          ? "text-text-dim"
                          : r.fundingPct >= 0
                            ? "text-up"
                            : "text-down"
                    }`}
                  >
                    {formatPct(r.fundingPct, 4)}
                  </span>
                  {showPositionCols && (
                    <>
                      <span
                        className={`text-right tabular-nums ${
                          estExtremeColonne(r.oiChangePct, seuils.deltaOi)
                            ? "font-semibold text-warn"
                            : r.oiChangePct === undefined
                              ? "text-text-dim"
                              : r.oiChangePct >= 0
                                ? "text-up"
                                : "text-down"
                        }`}
                      >
                        {r.oiChangePct === undefined ? "—" : formatPct(r.oiChangePct)}
                      </span>
                      <span className="text-right tabular-nums text-text-dim">
                        {r.longShortRatio === undefined ? "—" : r.longShortRatio.toFixed(2)}
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => ajouterAWatchlist(r.symbol)}
                    aria-label={`Ajouter ${r.symbol} à la watchlist`}
                    className="rounded px-1 text-text-dim transition hover:text-up"
                    title="Ajouter à la watchlist"
                  >
                    ＋
                  </button>
                </div>
              ))
            )}
          </div>
          {(seuils.funding !== null || seuils.deltaOi !== null) && (
            <div className="border-t border-border/50 px-3 py-1.5">
              <NoteSource>
                En orange : 10 % les plus extrêmes de l'univers affiché (|funding|, |Δ OI|).
              </NoteSource>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
