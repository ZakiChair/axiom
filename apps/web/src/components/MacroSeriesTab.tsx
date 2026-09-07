/** Évolution macro : une famille et une unité par graphique, sources et périodes explicites. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { INDICATEURS_MACRO, ORDRE_REGIONS, REGIONS_MACRO, seriesDeIndicateur, type DefinitionSerieMacro, type IndicateurMacro, type RegionMacro, type UniteMacro } from "../data/macro/catalogueMacro";
import type { MacroSeries } from "../data/macro/types";
import { macroSeriesStore } from "../store/macroSeries";
import { macroRatesViewStore, type HorizonMacro } from "../store/macroRatesView";
import { formatPeriodeMacro, formatValeurMacro, segmentsMacro, serieDansHorizon } from "./macroSeriesTab.util";
import { BoutonBascule, Fraicheur, NoteSource, Segmente, Vide } from "./ui";
import { TableTriable, type ColonneTable } from "./TableTriable";

type CourbeMacro = { def: DefinitionSerieMacro; points: MacroSeries; couleur: string; tirets?: string };
const HORIZONS: ReadonlyArray<{ id: HorizonMacro; label: string }> = [{ id: 1, label: "1 an" }, { id: 5, label: "5 ans" }, { id: 10, label: "10 ans" }];
const couleur = (region: RegionMacro): string => `var(--serie-${ORDRE_REGIONS.indexOf(region) % 6 + 1})`;
const tirets = (def: DefinitionSerieMacro): string | undefined => ORDRE_REGIONS.indexOf(def.region) >= 6 || def.id.endsWith("-4s") ? "5 3" : undefined;
function sourceLabel(def: DefinitionSerieMacro): string {
  const s = def.source;
  if (s.transport === "fred") return `FRED · ${s.seriesId}`;
  if (s.transport === "ecartFred") return `FRED · ${s.gauche} − ${s.droite}`;
  if (s.transport === "oecd") return "OCDE";
  if (s.transport === "eurostat") return "Eurostat";
  if (s.transport === "ons") return "ONS";
  if (s.transport === "nbs") return "NBS · Chine";
  if (s.transport === "mospi") return "MoSPI · Inde";
  if (s.transport === "statcan") return "Statistique Canada";
  if (s.transport === "boj") return "Banque du Japon";
  return "Source indisponible";
}
function cadence(def: DefinitionSerieMacro): number {
  return ({ D: 3, W: 10, M: 35, Q: 100 }[def.frequence]) * 86_400_000;
}
function EvolutionMacro({ courbes, unite, label }: { courbes: CourbeMacro[]; unite: UniteMacro; label: string }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const points = courbes.flatMap((c) => c.points);
  if (!points.length) return <div className="flex h-56 items-center justify-center"><Vide>Aucune série disponible sur la période sélectionnée.</Vide></div>;
  const times = points.map((p) => p.time);
  const values = points.map((p) => p.value);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const marge = (maxV - minV || 1) * 0.1;
  const bas = minV - marge;
  const haut = maxV + marge;
  const x = (t: number) => 68 + (t - minT) / (maxT - minT || 1) * 588;
  const y = (v: number) => 12 + (haut - v) / (haut - bas) * 190;
  const axeDate = (ts: number): string => new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(ts);
  return (
    <div>
      <svg viewBox="0 0 680 228" className="block w-full" role="img" aria-label={`Évolution · ${label}`} onMouseLeave={() => setSurvol(null)} onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const cible = minT + ((event.clientX - rect.left) / rect.width * 680 - 68) / 588 * (maxT - minT);
        setSurvol(times.reduce((a, b) => Math.abs(b - cible) < Math.abs(a - cible) ? b : a, times[0]!));
      }}>
        <title>{label} · unité : {unite}. Valeurs et périodes disponibles dans le tableau.</title>
        {Array.from({ length: 5 }, (_, i) => bas + (haut - bas) * i / 4).map((v, i) => <g key={i}>
          <line x1={68} x2={656} y1={y(v)} y2={y(v)} stroke="var(--border)" opacity="0.5" />
          <text x={62} y={y(v) + 3} textAnchor="end" fill="var(--text-dim)" fontSize={10}>{unite === "personnes" ? new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(v) : formatValeurMacro(v, unite)}</text>
        </g>)}
        {courbes.map((c) => <g key={c.def.id} fill="none" stroke={c.couleur} strokeWidth={1.6} strokeDasharray={c.tirets}>
          {segmentsMacro(c.points, c.def.frequence).map((segment, i) => segment.length === 1
            ? <circle key={i} cx={x(segment[0]!.time)} cy={y(segment[0]!.value)} r={2} fill={c.couleur} />
            : <polyline key={i} points={segment.map((p) => `${x(p.time)},${y(p.value)}`).join(" ")} />)}
        </g>)}
        {(minT === maxT ? [0] : [0, 1, 2, 3, 4]).map((i) => <text key={i} x={68 + 588 * i / 4} y={222} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fill="var(--text-dim)" fontSize={10}>{axeDate(minT + (maxT - minT) * i / 4)}</text>)}
        {survol !== null && <line x1={x(survol)} x2={x(survol)} y1={12} y2={202} stroke="var(--text-dim)" strokeDasharray="3 3" />}
      </svg>
      <div className="flex min-h-6 flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-dim" aria-live="polite">
        {survol === null ? <span>Survolez la courbe pour lire les observations. Les périodes manquantes interrompent le tracé.</span> : courbes.flatMap((c) => {
          const p = c.points.find((point) => point.time === survol);
          return p ? [<span key={c.def.id}><span style={{ color: c.couleur }}>{c.def.libelleSerie ?? c.def.libelleRegion}</span> · {formatPeriodeMacro(p.time, c.def)} : {formatValeurMacro(p.value, unite)}{p.qualite ? ` · ${p.qualite}` : ""}</span>] : [];
        })}
      </div>
    </div>
  );
}

export function MacroSeriesTab({ refreshToken = 0 }: { refreshToken?: number }) {
  const series = useStore(macroSeriesStore, (s) => s.series);
  const indicateur = useStore(macroRatesViewStore, (s) => s.indicateur);
  const regions = useStore(macroRatesViewStore, (s) => s.regions);
  const horizon = useStore(macroRatesViewStore, (s) => s.horizonAnnees);
  const dernierRefresh = useRef(refreshToken);
  useEffect(() => {
    const ctrl = new AbortController();
    const force = dernierRefresh.current !== refreshToken;
    dernierRefresh.current = refreshToken;
    void macroSeriesStore.getState().demanderIndicateur(indicateur, { regions, horizonAnnees: horizon, signal: ctrl.signal, force });
    return () => ctrl.abort();
  }, [indicateur, regions, horizon, refreshToken]);
  const definitions = useMemo(() => seriesDeIndicateur(indicateur), [indicateur]);
  const visibles = definitions.filter((d) => regions.includes(d.region));
  const meta = INDICATEURS_MACRO.find((i) => i.id === indicateur)!;
  const courbes: CourbeMacro[] = visibles.map((def) => ({ def, points: serieDansHorizon(series[def.id]?.points ?? [], horizon), couleur: couleur(def.region), ...(tirets(def) ? { tirets: tirets(def) } : {}) }));
  const chargement = visibles.some((d) => series[d.id]?.statut === "loading");
  const colonnes: ColonneTable<CourbeMacro>[] = [
    { id: "zone", label: "Zone / périmètre", largeur: "minmax(135px,1.2fr)", rendu: c => <><span className="flex items-center gap-1.5 text-text"><svg width="14" height="4" aria-hidden><line x1="0" x2="14" y1="2" y2="2" stroke={c.couleur} strokeWidth="2" strokeDasharray={c.tirets} /></svg>{c.def.libelleSerie ?? c.def.libelleRegion}</span><span className="block text-[10px] leading-snug text-text-dim">{c.def.perimetre}</span></> },
    { id: "derniere", label: "Dernière", largeur: "85px", rendu: c => <>{c.points.at(-1) ? formatValeurMacro(c.points.at(-1)!.value, meta.unite) : "—"}{c.points.at(-1)?.qualite && <span className="block text-[10px] text-warn">{c.points.at(-1)!.qualite}</span>}</> },
    { id: "precedente", label: "Précédente", largeur: "85px", rendu: c => c.points.at(-2) ? <>{formatValeurMacro(c.points.at(-2)!.value, meta.unite)}<span className="block text-[10px]">{formatPeriodeMacro(c.points.at(-2)!.time, c.def)}</span></> : "—" },
    { id: "variation", label: "Variation", largeur: "75px", rendu: c => c.points.length < 2 ? "—" : `${formatValeurMacro(c.points.at(-1)!.value - c.points.at(-2)!.value, meta.unite === "%" ? "indice" : meta.unite, true)}${meta.unite === "%" ? " pt" : ""}` },
    { id: "periode", label: "Période", largeur: "90px", rendu: c => <>{c.points.at(-1) ? formatPeriodeMacro(c.points.at(-1)!.time, c.def) : "—"}<span className="block"><Fraicheur loading={series[c.def.id]?.statut === "loading"} majTs={series[c.def.id]?.majTs ?? null} cadenceMs={cadence(c.def)} /></span></> },
    { id: "source", label: "Source / état", largeur: "minmax(145px,1fr)", rendu: c => {
      const etat = series[c.def.id];
      const message = etat?.message ?? (c.def.source.transport === "indisponible" ? c.def.source.motif : etat?.statut === "loading" ? "Chargement…" : "En attente.");
      return <span className="text-[10px] leading-snug text-text-dim">{sourceLabel(c.def)}{etat?.recupereTs !== undefined && <span className="block">Récupéré le {new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(etat.recupereTs)}</span>}{etat?.perime && <span className="block text-warn">Historique conservé · cache périmé</span>}{(!c.points.length || etat?.message) && <span className="block text-warn">{message}</span>}</span>;
    } },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="macro-series-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-[11px] text-text-dim">Indicateur
          <select aria-label="Indicateur macro" value={indicateur} onChange={(event) => macroRatesViewStore.getState().selectionnerIndicateur(event.target.value as IndicateurMacro)} className="min-w-0 max-w-full rounded border border-border bg-surface px-2 py-1.5 text-text">
            {INDICATEURS_MACRO.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        <Segmente options={HORIZONS} actif={horizon} onChange={(h) => macroRatesViewStore.getState().selectionnerHorizon(h)} />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Zones macro">
        {ORDRE_REGIONS.map((region) => <BoutonBascule key={region} actif={regions.includes(region)} disabled={!definitions.some((d) => d.region === region)} title={REGIONS_MACRO[region]} onClick={() => macroRatesViewStore.getState().selectionnerRegions(regions.includes(region) ? regions.filter((r) => r !== region) : [...regions, region])}>{region}</BoutonBascule>)}
        <button type="button" className="px-2 text-[10px] text-accent hover:underline" onClick={() => macroRatesViewStore.getState().selectionnerRegions(definitions.map((d) => d.region))}>Toutes les zones</button>
      </div>
      <p className="text-[11px] text-text-dim">{meta.description}</p>
      {visibles.length === 0 ? <Vide>Sélectionnez au moins une zone.</Vide> : <EvolutionMacro key={`${indicateur}-${horizon}`} courbes={courbes} unite={meta.unite} label={meta.label} />}
      {chargement && <p role="status" className="text-[10px] text-text-dim">Chargement des séries macro… Les appels OCDE sont espacés pour respecter le quota.</p>}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <TableTriable ariaLabel="Observations macro par zone" colonnes={colonnes} lignes={courbes} cle={c => c.def.id} />
        </div>
      </div>
      <NoteSource>Dates = périodes observées, distinctes de la récupération. Date de première publication non fournie ; valeurs susceptibles de révision. Cache : 1 h pour les séries quotidiennes, 6 h pour les hebdomadaires, 24 h pour les mensuelles et trimestrielles. FRED nécessite une clé configurée. Les périmètres nationaux diffèrent ; aucune donnée n'est interpolée.</NoteSource>
    </div>
  );
}
