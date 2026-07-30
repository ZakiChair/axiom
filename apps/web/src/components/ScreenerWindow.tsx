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
import {
  ouvrirSetupDansChart,
  signauxStore,
  type SignauxRunState,
} from "../store/signaux";
import { presetAlertsStore } from "../store/presetAlerts";
import type { LigneSignaux, SignalDetecte } from "../data/signaux";
import { UNIVERS_VALIDATION } from "../data/validationSignaux";
import { estExtremeColonne, seuilDecile } from "../lib/extremesColonne";
import { formatPct, formatPrice, formatUsd } from "../lib/format";
import { metaSource } from "../lib/fiabilite";
import {
  Badge,
  BadgeFiabilite,
  BarreProgression,
  Bouton,
  Chip,
  EnTeteFenetre,
  ErreurBloc,
  Input,
  NoteSource,
  Segmente,
  Select,
  TitreSection,
  Vide,
} from "./ui";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "./TableTriable";

/**
 * Presets « scénario » : teinte du glyphe directionnel (▲▼↔◆), portée par le premier
 * caractère du nom. Les clés définissent aussi l'appartenance au groupe « Scénarios ».
 */
const SCENARIO_TINT: Record<string, string> = {
  "builtin:long-potentiel": "text-up",
  "builtin:short-potentiel": "text-down",
  "builtin:range": "text-text-dim",
  "builtin:compression": "text-accent",
};

/** Presets livrés, séparés en « Scénarios » (glyphe teinté) et « Filtres » (les autres). */
const SCENARIO_PRESETS = BUILTIN_PRESETS.filter((p) => p.id in SCENARIO_TINT);
const FILTER_PRESETS = BUILTIN_PRESETS.filter((p) => !(p.id in SCENARIO_TINT));

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

/** Ligne de condition de BASE : champ / opérateur / valeur / suppression. */
function BaseConditionRow({ index, cond }: { index: number; cond: BaseCondition }) {
  const update = useStore(screenerStore, (s) => s.updateBaseCondition);
  const remove = useStore(screenerStore, (s) => s.removeBaseCondition);
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={cond.field}
        onChange={(e) => update(index, { field: e.target.value as BaseField })}
        className="flex-1"
        aria-label="Champ"
      >
        {BASE_FIELDS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
          </option>
        ))}
      </Select>
      <Select
        value={cond.op}
        onChange={(e) => update(index, { op: e.target.value as Operator })}
        aria-label="Opérateur"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        value={cond.value}
        onChange={(e) => update(index, { value: Number(e.target.value) })}
        className="w-24 tabular-nums"
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
      <Select
        value={cond.fieldId}
        onChange={(e) => update(index, { fieldId: e.target.value })}
        className="flex-1"
        aria-label="Indicateur"
      >
        {INDICATOR_FIELDS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
          </option>
        ))}
      </Select>
      {spec?.paramKey !== undefined && (
        <Input
          type="number"
          value={cond.param ?? spec.defaultParam ?? 0}
          onChange={(e) => update(index, { param: Number(e.target.value) })}
          className="w-12 tabular-nums"
          aria-label={spec.paramKey}
          title={spec.paramKey}
        />
      )}
      <Select
        value={cond.op}
        onChange={(e) => update(index, { op: e.target.value as Operator })}
        aria-label="Opérateur"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        value={cond.value}
        onChange={(e) => update(index, { value: Number(e.target.value) })}
        className="w-16 tabular-nums"
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

// ─────────────────────────── Panneau principal ───────────────────────────

// ─────────────────────────── Vue « Signaux » (inbox de setups) ───────────────────────────

/** Libellé humain de l'état d'un run signaux. */
function signauxStateLabel(state: SignauxRunState): string {
  switch (state) {
    case "idle":
      return "Prêt";
    case "loading":
      return "Chargement de l'univers…";
    case "running":
      return "Détection des setups…";
    case "done":
      return "Terminé";
    case "error":
      return "Erreur";
  }
}

/** Ton du badge selon la direction d'un signal / d'une ligne. */
function tonDirection(direction: SignalDetecte["direction"] | "mixte"): "up" | "down" | "neutre" {
  return direction === "haussier" ? "up" : direction === "baissier" ? "down" : "neutre";
}

/** Une ligne de l'inbox : en-tête (symbole, Δ24h, direction, score) + badges de signaux. */
function LigneSetup({ ligne }: { ligne: LigneSignaux }) {
  const fleche = ligne.direction === "haussier" ? "▲" : ligne.direction === "baissier" ? "▼" : "◆";
  return (
    <div className="space-y-1.5 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-surface">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ouvrirSetupDansChart(ligne.symbol)}
          className="truncate text-left text-[11px] font-medium text-text transition hover:text-up"
          title={`Ouvrir ${ligne.symbol} dans le chart (4h)`}
        >
          {ligne.symbol}
        </button>
        <span
          className={`tabular-nums text-[11px] ${ligne.priceChangePct24h >= 0 ? "text-up" : "text-down"}`}
        >
          {formatPct(ligne.priceChangePct24h)}
        </span>
        <span className="flex-1" />
        <Badge ton={tonDirection(ligne.direction)} title="Direction agrégée des signaux (somme pondérée)">
          {fleche} {ligne.direction}
        </Badge>
        <span
          className="tabular-nums text-[11px] font-semibold text-text"
          title="Score de confluence (somme des poids des signaux)"
        >
          {ligne.score}
        </span>
        <button
          type="button"
          onClick={() => ajouterAWatchlist(ligne.symbol)}
          aria-label={`Ajouter ${ligne.symbol} à la watchlist`}
          className="rounded px-1 text-text-dim transition hover:text-up"
          title="Ajouter à la watchlist"
        >
          ＋
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ligne.signaux.map((s) => (
          <Badge key={s.id} ton={tonDirection(s.direction)} title={`${s.detail} · fiabilité : ${s.fiabilite}`}>
            {s.libelle}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** Cellule de stats d'une validation : n · taux de réussite · moyenne vs référence. */
function CelluleValidation({ stats }: { stats: { n: number; tauxReussitePct: number; moyennePct: number; baselineMoyennePct: number } | null }) {
  if (stats === null) return <span className="text-right text-[11px] text-text-dim">—</span>;
  const bat = stats.moyennePct > stats.baselineMoyennePct;
  return (
    <span className="text-right tabular-nums text-[11px]">
      <span className="text-text-dim">{stats.n}× · </span>
      <span className={stats.tauxReussitePct >= 50 ? "text-up" : "text-down"}>
        {stats.tauxReussitePct.toFixed(0)} %
      </span>
      <span className={`ml-1 ${bat ? "text-up" : "text-down"}`}>
        {stats.moyennePct >= 0 ? "+" : ""}
        {stats.moyennePct.toFixed(2)} %
      </span>
      <span className="text-text-dim"> (réf {stats.baselineMoyennePct >= 0 ? "+" : ""}{stats.baselineMoyennePct.toFixed(2)} %)</span>
    </span>
  );
}

/** Section « Validation historique » : event study des signaux sur l'univers choisi. */
function SectionValidation() {
  const etat = useStore(signauxStore, (s) => s.validationState);
  const progres = useStore(signauxStore, (s) => s.validationProgress);
  const resultat = useStore(signauxStore, (s) => s.validation);
  const erreur = useStore(signauxStore, (s) => s.validationError);
  const valider = useStore(signauxStore, (s) => s.validerSignaux);
  const univers = useStore(signauxStore, (s) => s.validationUnivers);
  const setUnivers = useStore(signauxStore, (s) => s.setValidationUnivers);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[10px] uppercase tracking-wide text-text-dim">Validation historique</div>
        {/* Univers : le top-volume du jour est biaisé memecoins (funding structurellement
            extrême) — majors / watchlist isolent ce biais de sélection. */}
        <Segmente
          options={UNIVERS_VALIDATION.map((u) => ({ id: u.id, label: u.label }))}
          actif={univers}
          onChange={setUnivers}
        />
        <Bouton onClick={valider} disabled={etat === "running"} className="disabled:opacity-40">
          {etat === "running" ? `Mesure… ${progres.done}/${progres.total}` : "Valider sur l'historique"}
        </Bouton>
      </div>
      {erreur !== null && <p className="text-[10px] text-down">{erreur}</p>}
      {resultat !== null && (
        <div className="rounded-md border border-border bg-bg">
          <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wide text-text-dim">
            <span>Signal</span>
            <span className="text-right">24 h</span>
            <span className="text-right">72 h</span>
          </div>
          {resultat.parSignal.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-[1.2fr_1fr_1fr] items-center gap-2 border-b border-border/50 px-3 py-1.5 last:border-b-0"
              title="n événements · taux de réussite (rendement signé > 0) · rendement signé moyen vs référence (drift inconditionnel signé)"
            >
              <span className="text-[11px] text-text">{s.libelle}</span>
              {s.horizons.map((h) => (
                <CelluleValidation key={h.id} stats={h.stats} />
              ))}
            </div>
          ))}
          <div className="border-t border-border/50 px-3 py-1.5">
            <NoteSource>{resultat.note}</NoteSource>
          </div>
        </div>
      )}
    </section>
  );
}

/** Vue Signaux : un bouton de scan, la progression et l'inbox triée par confluence. */
function VueSignaux() {
  const runState = useStore(signauxStore, (s) => s.runState);
  const progress = useStore(signauxStore, (s) => s.progress);
  const lignes = useStore(signauxStore, (s) => s.lignes);
  const note = useStore(signauxStore, (s) => s.note);
  const error = useStore(signauxStore, (s) => s.error);
  const run = useStore(signauxStore, (s) => s.run);
  const cancel = useStore(signauxStore, (s) => s.cancel);
  const busy = runState === "loading" || runState === "running";

  return (
    <div className="space-y-3 px-4 py-3">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          {busy ? (
            <Bouton variante="danger" onClick={cancel}>
              Annuler
            </Bouton>
          ) : (
            <Bouton variante="primaire" onClick={run}>
              Scanner les setups
            </Bouton>
          )}
          <span className="text-[11px] text-text-dim">{signauxStateLabel(runState)}</span>
          {runState === "running" && (
            <span className="tabular-nums text-[11px] text-text-dim">
              {progress.done}/{progress.total}
            </span>
          )}
        </div>
        {runState === "running" && progress.total > 0 && (
          <BarreProgression fraction={progress.done / progress.total} ariaLabel="Progression du scan" />
        )}
        {note !== null && <p className="text-[10px] text-text-dim">{note}</p>}
        {error !== null && <ErreurBloc>{error}</ErreurBloc>}
      </section>

      <section className="rounded-md border border-border bg-bg">
        {lignes.length === 0 ? (
          <Vide>
            {runState === "done"
              ? "Aucun setup détecté sur l'échantillon."
              : "Scannez pour détecter les setups (quadrant OI×prix, funding extrême, divergence RSI, positionnement)."}
          </Vide>
        ) : (
          lignes.map((l) => <LigneSetup key={l.symbol} ligne={l} />)
        )}
        {lignes.length > 0 && (
          <div className="border-t border-border/50 px-3 py-1.5">
            <NoteSource>
              Survolez un badge pour la lecture complète et sa fiabilité. Lectures heuristiques —
              pas des recommandations.
            </NoteSource>
          </div>
        )}
      </section>

      {/* Toujours visible : les univers majors/watchlist ne dépendent pas d'un scan. */}
      <SectionValidation />
    </div>
  );
}

export function ScreenerWindow() {
  const tf = useStore(screenerStore, (s) => s.tf);
  const setTf = useStore(screenerStore, (s) => s.setTf);
  const baseConditions = useStore(screenerStore, (s) => s.baseConditions);
  const indicatorConditions = useStore(screenerStore, (s) => s.indicatorConditions);
  const addBase = useStore(screenerStore, (s) => s.addBaseCondition);
  const addIndicator = useStore(screenerStore, (s) => s.addIndicatorCondition);
  const userPresets = useStore(screenerStore, (s) => s.userPresets);
  const dernierPresetCharge = useStore(screenerStore, (s) => s.dernierPresetCharge);
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

  const vue = useStore(signauxStore, (s) => s.vue);
  const setVue = useStore(signauxStore, (s) => s.setVue);

  const [presetName, setPresetName] = useState("");
  const [tri, setTri] = useState<TriTable>({ colonne: "volumeUsd24h", dir: -1 });
  // Message discret du bouton « Alerte » (confirmation période / refus limite), auto-effacé.
  const [msgAlerte, setMsgAlerte] = useState<{ ton: "ok" | "limite"; texte: string } | null>(null);

  const busy = runState === "loading" || runState === "running";

  /**
   * Crée une alerte de scan à partir du preset chargé + conditions COURANTES du builder.
   * Le snapshot est figé côté store. Retour "limite" → message discret (4 max).
   */
  const creerAlerte = () => {
    if (dernierPresetCharge === null) return;
    const preset = [...BUILTIN_PRESETS, ...userPresets].find((p) => p.id === dernierPresetCharge);
    if (preset === undefined) return;
    const res = presetAlertsStore.getState().ajouter({
      presetId: preset.id,
      nom: preset.name,
      tf,
      baseConditions,
      indicatorConditions,
    });
    if (res === "limite") {
      setMsgAlerte({ ton: "limite", texte: "4 alertes de scan max" });
    } else {
      // Période identique à la dérivation du store (15 sans filtre indicateur, sinon 60).
      const periode = indicatorConditions.length === 0 ? 15 : 60;
      setMsgAlerte({ ton: "ok", texte: `Alerte créée · vérifié toutes les ${periode} min` });
    }
    setTimeout(() => setMsgAlerte(null), 4000);
  };

  /** Colonnes OI / L-S uniquement si au moins une ligne les porte (échantillon enrichi). */
  const showPositionCols = useMemo(
    () => rows.some((r) => r.oiChangePct !== undefined || r.longShortRatio !== undefined),
    [rows],
  );

  // Extrêmes cross-sectionnels : 9e décile des |valeurs| de l'univers affiché. Calculé sur
  // `rows` (pas le tri courant) : seuilDecile trie en interne, l'ordre d'entrée est sans effet.
  const seuils = useMemo(
    () => ({
      funding: seuilDecile(rows.map((r) => Math.abs(r.fundingPct ?? Number.NaN)), 0.9),
      deltaOi: seuilDecile(rows.map((r) => Math.abs(r.oiChangePct ?? Number.NaN)), 0.9),
    }),
    [rows],
  );

  /** Badge de couverture si la note mentionne l'échantillon OI/L-S. */
  const showPositionBadge =
    note !== null && (note.includes("OI/L-S") || note.includes("échantillon"));

  const COLONNES_RESULTATS: ColonneTable<ScreenerRow>[] = useMemo(
    () => [
      {
        id: "symbol",
        label: "Symbole",
        align: "left",
        largeur: showPositionCols ? "1.3fr" : "1.4fr",
        triable: true,
        valeurTri: (l) => l.symbol,
        rendu: (r) => (
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
        ),
      },
      {
        id: "lastPrice",
        label: "Prix",
        align: "right",
        largeur: showPositionCols ? "0.8fr" : "0.9fr",
        triable: true,
        valeurTri: (l) => l.lastPrice,
        rendu: (r) => <span className="text-right tabular-nums text-text">{formatPrice(r.lastPrice)}</span>,
      },
      {
        id: "priceChangePct24h",
        label: "Δ24h",
        align: "right",
        largeur: showPositionCols ? "0.7fr" : "0.8fr",
        triable: true,
        valeurTri: (l) => l.priceChangePct24h,
        rendu: (r) => (
          <span className={`text-right tabular-nums ${r.priceChangePct24h >= 0 ? "text-up" : "text-down"}`}>
            {formatPct(r.priceChangePct24h)}
          </span>
        ),
      },
      {
        id: "volumeUsd24h",
        label: "Vol 24h",
        align: "right",
        largeur: showPositionCols ? "0.8fr" : "0.9fr",
        triable: true,
        valeurTri: (l) => l.volumeUsd24h,
        rendu: (r) => <span className="text-right tabular-nums text-text-dim">{formatUsd(r.volumeUsd24h)}</span>,
      },
      {
        id: "fundingPct",
        label: "Funding",
        align: "right",
        largeur: showPositionCols ? "0.75fr" : "0.9fr",
        triable: true,
        valeurTri: (l) => l.fundingPct ?? null,
        rendu: (r) => (
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
        ),
      },
      ...(showPositionCols
        ? [
            {
              id: "oiChangePct",
              label: "Δ OI",
              align: "right" as const,
              largeur: "0.7fr",
              triable: true,
              valeurTri: (l: ScreenerRow) => l.oiChangePct ?? null,
              rendu: (r: ScreenerRow) => (
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
              ),
            },
            {
              id: "longShortRatio",
              label: "L/S",
              align: "right" as const,
              largeur: "0.7fr",
              triable: true,
              valeurTri: (l: ScreenerRow) => l.longShortRatio ?? null,
              rendu: (r: ScreenerRow) => (
                <span className="text-right tabular-nums text-text-dim">
                  {r.longShortRatio === undefined ? "—" : r.longShortRatio.toFixed(2)}
                </span>
              ),
            },
          ]
        : []),
      {
        id: "wl",
        label: "Wl",
        align: "right",
        largeur: "auto",
        rendu: (r) => (
          <button
            type="button"
            onClick={() => ajouterAWatchlist(r.symbol)}
            aria-label={`Ajouter ${r.symbol} à la watchlist`}
            className="rounded px-1 text-text-dim transition hover:text-up"
            title="Ajouter à la watchlist"
          >
            ＋
          </button>
        ),
      },
    ],
    [showPositionCols, seuils],
  );

  const triees = useMemo(() => trierLignes(rows, COLONNES_RESULTATS, tri), [rows, tri, COLONNES_RESULTATS]);

  return (
    <>
      <EnTeteFenetre
        mnemo="EQS"
        titre="Screener"
        sousTitre={
          vue === "signaux"
            ? "Setups par confluence · perp Binance"
            : "Binance spot USDT/USDC · funding perp"
        }
      />

      {/* Bascule Filtres / Signaux — l'état vit dans signauxStore (la commande SIG le force). */}
      <div className="px-4 pt-3">
        <Segmente
          options={[
            { id: "filtres", label: "Filtres" },
            { id: "signaux", label: "Signaux" },
          ] as const}
          actif={vue}
          onChange={setVue}
        />
      </div>

      {vue === "signaux" ? (
        <VueSignaux />
      ) : (
      <div className="space-y-3 px-4 py-3">
        {/* Presets — groupés : Scénarios (glyphe teinté) / Filtres / Mes presets */}
        <section className="space-y-2">
          <TitreSection>Presets</TitreSection>

          {/* Scénarios : glyphe directionnel teinté, `title` = logique du scénario. */}
          <div className="text-[9px] uppercase tracking-wide text-text-dim/70">Scénarios</div>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIO_PRESETS.map((p) => {
              // Le premier caractère du nom est le glyphe (▲▼↔◆), teinté à part.
              const glyph = p.name.slice(0, 1);
              const rest = p.name.slice(1);
              return (
                <Bouton key={p.id} onClick={() => loadPreset(p.id)} title={p.description}>
                  <span className={SCENARIO_TINT[p.id]}>{glyph}</span>
                  {rest}
                </Bouton>
              );
            })}
          </div>

          {/* Filtres : les presets livrés « historiques » (comportement inchangé). */}
          <div className="text-[9px] uppercase tracking-wide text-text-dim/70">Filtres</div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_PRESETS.map((p) => (
              <Bouton
                key={p.id}
                onClick={() => loadPreset(p.id)}
                title={
                  p.description ??
                  (p.id.startsWith("builtin:crowded") || p.id === "builtin:funding-extreme"
                    ? `Positionnement · OI/L-S sur top ${SCREENER_POSITION_CAP} liquides`
                    : undefined)
                }
              >
                {p.name}
              </Bouton>
            ))}
          </div>

          {/* Mes presets : seulement si l'utilisateur en a enregistré (comportement conservé). */}
          {userPresets.length > 0 && (
            <>
              <div className="text-[9px] uppercase tracking-wide text-text-dim/70">Mes presets</div>
              <div className="flex flex-wrap gap-1.5">
                {userPresets.map((p) => (
                  <Chip
                    key={p.id}
                    onRetirer={() => deletePreset(p.id)}
                    retirerLabel={`Supprimer le preset ${p.name}`}
                  >
                    <button
                      type="button"
                      onClick={() => loadPreset(p.id)}
                      className="transition hover:text-text"
                    >
                      {p.name}
                    </button>
                  </Chip>
                ))}
              </div>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <Input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Nom du preset…"
              className="flex-1"
            />
            <Bouton
              onClick={() => {
                savePreset(presetName);
                setPresetName("");
              }}
              disabled={presetName.trim().length === 0}
              className="disabled:opacity-40"
            >
              Enregistrer
            </Bouton>
          </div>

          {/* Alerte de scan : rescanne périodiquement le preset chargé, notifie les symboles
              ENTRANTS. Actif seulement sur un preset chargé et intact (édition manuelle → null). */}
          <div className="flex items-center gap-2">
            <Bouton
              onClick={creerAlerte}
              disabled={dernierPresetCharge === null}
              className="disabled:opacity-40"
              title={
                dernierPresetCharge === null
                  ? "Chargez un preset pour créer une alerte de scan"
                  : "Fige les conditions courantes et rescanne périodiquement (notifie les symboles entrants)"
              }
            >
              ⏰ Alerte
            </Bouton>
            {msgAlerte !== null && (
              <span className={`text-[10px] ${msgAlerte.ton === "limite" ? "text-warn" : "text-text-dim"}`}>
                {msgAlerte.texte}
              </span>
            )}
          </div>
        </section>

        {/* Filtres de base */}
        <section className="space-y-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-text-dim">Filtres de base</span>
            <Bouton onClick={addBase}>+ ajouter</Bouton>
          </div>
          {baseConditions.length === 0 ? (
            <p className="text-[11px] text-text-dim">Aucun filtre (tout l'univers USDT/USDC).</p>
          ) : (
            baseConditions.map((c, i) => <BaseConditionRow key={i} index={i} cond={c} />)
          )}
        </section>

        {/* Filtres indicateurs */}
        <section className="space-y-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <TitreSection
            extra={
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-text-dim">
                  TF
                  <Select
                    value={tf}
                    onChange={(e) => setTf(e.target.value as (typeof SCREENER_TIMEFRAMES)[number])}
                    aria-label="Timeframe des indicateurs"
                  >
                    {SCREENER_TIMEFRAMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </label>
                <Bouton onClick={addIndicator}>+ ajouter</Bouton>
              </div>
            }
          >
            Filtres indicateurs
          </TitreSection>
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
              <Bouton variante="danger" onClick={cancel}>
                Annuler
              </Bouton>
            ) : (
              <Bouton variante="primaire" onClick={run}>
                Lancer le screen
              </Bouton>
            )}
            <span className="text-[11px] text-text-dim">{runStateLabel(runState)}</span>
            {runState === "running" && (
              <span className="tabular-nums text-[11px] text-text-dim">
                {progress.done}/{progress.total}
              </span>
            )}
          </div>

          {runState === "running" && progress.total > 0 && (
            <BarreProgression fraction={progress.done / progress.total} ariaLabel="Progression du scan" />
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
        <section className="space-y-2">
          <TableTriable
            colonnes={COLONNES_RESULTATS}
            lignes={triees}
            tri={tri}
            onTri={setTri}
            cle={(l) => l.symbol}
            maxHauteur="40vh"
            vide={runState === "done" ? "Aucun résultat." : "Lancez un screen pour voir les résultats."}
          />
          {(seuils.funding !== null || seuils.deltaOi !== null) && (
            <NoteSource>
              En orange : 10 % les plus extrêmes de l'univers affiché (|funding|, |Δ OI|).
            </NoteSource>
          )}
        </section>
      </div>
      )}
    </>
  );
}
