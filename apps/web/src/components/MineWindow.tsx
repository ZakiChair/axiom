/**
 * Fenêtre « MINE » — coût de production & économie du minage BTC (spec lot v1.8, §1).
 *
 * L'état de données vit dans `mineStore` (vanilla) : le run à l'ouverture collecte les
 * ENTRÉES BRUTES (hashrate/difficulté, ajustement, subsidy, frais/bloc, prix spot). Les
 * grandeurs affichées (plancher électrique, coût all-in, hashprice, ratios) sont
 * RECALCULÉES ici — via les fonctions PURES de `data/mine.ts` — à partir de ces entrées
 * et des PARAMÈTRES réglables : changer un paramètre recalcule sans re-fetch (mémoïsé).
 *
 * Honnêteté (règle d'or doc 02) : c'est un MODÈLE paramétrique (parc moyen supposé), pas
 * une mesure. La note en bas rappelle les repères externes Capriole (mars 2026) ; le
 * défaut d'efficacité (22 J/TH) suit l'efficacité effective de parc impliquée par
 * Capriole (~21,5 J/TH) et reste réglable via le curseur.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { mineStore } from "../store/mine";
import {
  PARAMS_MINE_DEFAUT,
  coutAllInParBtc,
  coutElectriqueParBtc,
  emissionBtcParJour,
  hashpriceUsdParPhJour,
  ratioPrixCout,
} from "../data/mine";
import { lireTokenCanvas } from "../lib/canvasTokens";
import {
  formatCompact,
  formatDateComplete,
  formatDec,
  formatPourcentage,
  formatUsd,
} from "../lib/format";
import {
  Badge,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  NoteSource,
  Vide,
  type TonBadge,
} from "./ui";

// ─────────────────────────── Sparkline (patron CHAIN/OnchainWindow) ───────────────────────────

const SPARK_W = 132;
const SPARK_H = 34;

/** Mini-courbe canvas ; `color` = nom de token CSS résolu au dessin (thème courant). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cvs = ref.current;
    if (cvs === null) return;
    const ctx = cvs.getContext("2d");
    if (ctx === null) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    cvs.width = SPARK_W * dpr;
    cvs.height = SPARK_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    if (values.length < 2) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = SPARK_W / (values.length - 1);
    const pad = 3;
    const h = SPARK_H - pad * 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * step;
      const y = pad + (h - ((v - min) / span) * h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lireTokenCanvas(color, "#9ca3af");
    ctx.lineWidth = 1.3;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [values, color]);
  return (
    <canvas ref={ref} style={{ width: SPARK_W, height: SPARK_H }} className="shrink-0" aria-hidden="true" />
  );
}

// ─────────────────────────── Formatage métier ───────────────────────────

/** Hashrate H/s → EH/s (1e18). */
function fmtEhs(hps: number): string {
  if (!Number.isFinite(hps)) return "—";
  return `${(hps / 1e18).toFixed(1)} EH/s`;
}

/** Ratio prix/coût en « ×1,42 » (ou « — »). */
function fmtRatio(r: number): string {
  if (!Number.isFinite(r)) return "—";
  return `×${formatDec(r, 2)}`;
}

/** Pourcentage signé « +2,3 % » (ou « — »). */
function fmtPctSigne(x: number, dec = 2): string {
  if (!Number.isFinite(x)) return "—";
  const s = formatPourcentage(Math.abs(x), dec);
  return x >= 0 ? `+${s}` : `−${s}`;
}

// ─────────────────────────── Tuile ───────────────────────────

function Tuile({
  libelle,
  valeur,
  ton,
  sousTexte,
  spark,
  sparkColor,
}: {
  libelle: string;
  valeur: string;
  ton?: TonBadge;
  sousTexte?: string;
  spark?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg px-3 py-2">
      <span className="truncate text-[11px] text-text-dim">{libelle}</span>
      <div className="flex items-end justify-between gap-2">
        <span
          className={`tabular-nums text-lg font-semibold ${
            ton === "up" ? "text-up" : ton === "down" ? "text-down" : ton === "warn" ? "text-warn" : "text-text"
          }`}
        >
          {valeur}
        </span>
        {spark && spark.length >= 2 && <Sparkline values={spark} color={sparkColor ?? "--text-dim"} />}
      </div>
      {sousTexte !== undefined && <span className="truncate text-[10px] text-text-dim">{sousTexte}</span>}
    </div>
  );
}

// ─────────────────────────── Bandeau prix vs coûts ───────────────────────────

/** Position en % (0..100) d'une valeur dans [lo, hi], bornée. */
function positionPct(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v) || hi <= lo) return 0;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/**
 * Ton du prix vs les deux planchers : au-dessus de l'all-in = mineurs profitables (up) ;
 * entre plancher élec et all-in = zone de stress (warn) ; sous le plancher élec =
 * capitulation (down). Neutre si indéterminé.
 */
function tonPrix(prix: number, elec: number, allIn: number): TonBadge {
  if (!Number.isFinite(prix) || !Number.isFinite(elec) || !Number.isFinite(allIn)) return "neutre";
  if (prix >= allIn) return "up";
  if (prix >= elec) return "warn";
  return "down";
}

function BandeauCouts({
  prix,
  elec,
  allIn,
  ratioElec,
  ratioAllIn,
}: {
  prix: number;
  elec: number;
  allIn: number;
  ratioElec: number;
  ratioAllIn: number;
}) {
  const valides = [prix, elec, allIn].filter((v) => Number.isFinite(v));
  const ton = tonPrix(prix, elec, allIn);
  if (valides.length < 2) {
    return (
      <div className="rounded-md border border-border bg-bg px-3 py-3 text-[11px] text-text-dim">
        Niveaux indisponibles — entrées de marché incomplètes.
      </div>
    );
  }
  const lo = Math.min(...valides) * 0.9;
  const hi = Math.max(...valides) * 1.1;
  const xElec = positionPct(elec, lo, hi);
  const xAllIn = positionPct(allIn, lo, hi);
  const xPrix = positionPct(prix, lo, hi);
  const gauche = Math.min(xElec, xAllIn);
  const largeur = Math.abs(xAllIn - xElec);

  return (
    <div className="rounded-md border border-border bg-bg px-3 py-3">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-text-dim">Prix spot vs coût de production</span>
        <Badge ton={ton}>
          {ton === "up" ? "marge positive" : ton === "warn" ? "sous all-in" : ton === "down" ? "sous plancher" : "—"}
        </Badge>
      </div>
      {/* Piste : bande grisée entre plancher élec et all-in ; marqueur prix par-dessus. */}
      <div className="relative my-4 h-2 rounded-full bg-surface">
        <div
          className="absolute top-0 h-2 rounded-full bg-warn/25"
          style={{ left: `${gauche}%`, width: `${largeur}%` }}
        />
        {/* Repères plancher (élec) et all-in. */}
        <div className="absolute top-[-3px] h-[14px] w-px bg-up" style={{ left: `${xElec}%` }} />
        <div className="absolute top-[-3px] h-[14px] w-px bg-down" style={{ left: `${xAllIn}%` }} />
        {/* Marqueur prix. */}
        <div
          className="absolute top-[-5px] h-[18px] w-[3px] rounded-full bg-accent"
          style={{ left: `calc(${xPrix}% - 1px)` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
        <span className="text-up">
          Plancher élec<br />
          <span className="text-text">{formatUsd(elec)}</span>
        </span>
        <span className="text-center text-accent">
          Prix spot<br />
          <span className="text-text">{formatUsd(prix)}</span>
        </span>
        <span className="text-right text-down">
          Coût all-in<br />
          <span className="text-text">{formatUsd(allIn)}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px] text-text-dim">
        <span>
          Prix / plancher <span className="tabular-nums text-text">{fmtRatio(ratioElec)}</span>
        </span>
        <span>
          Prix / all-in <span className="tabular-nums text-text">{fmtRatio(ratioAllIn)}</span>
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────── Panneau paramètres ───────────────────────────

/** Un champ numérique de paramètre (libellé + input + unité). */
function ChampParam({
  libelle,
  valeur,
  unite,
  step,
  min,
  onChange,
}: {
  libelle: string;
  valeur: number;
  unite: string;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] text-text-dim">
      <span className="truncate">{libelle}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={valeur}
          step={step}
          min={min}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n > 0) onChange(n);
          }}
          className="w-full rounded border border-border bg-bg px-1.5 py-1 text-[11px] tabular-nums text-text focus:border-accent focus:outline-none"
        />
        <span className="shrink-0 text-text-dim">{unite}</span>
      </span>
    </label>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

export function MineWindow() {
  const enCours = useStore(mineStore, (s) => s.enCours);
  const entrees = useStore(mineStore, (s) => s.entrees);
  const params = useStore(mineStore, (s) => s.params);
  const erreur = useStore(mineStore, (s) => s.erreur);
  const majTs = useStore(mineStore, (s) => s.majTs);

  const [paramsOuverts, setParamsOuverts] = useState(false);

  // Run auto au PREMIER open (patron CBPREM) : garde `majTs === null` + `!enCours` +
  // pas d'erreur pour éviter un double run (StrictMode-safe : `enCours` posé synchrone).
  useEffect(() => {
    const s = mineStore.getState();
    if (!s.enCours && s.majTs === null && s.erreur === null) void s.run();
  }, []);

  // Grandeurs dérivées : PURES, mémoïsées sur (entrées, paramètres). Un changement de
  // paramètre recalcule ici, sans re-fetch (les entrées brutes sont inchangées).
  const derive = useMemo(() => {
    if (entrees === null) return null;
    const emission = emissionBtcParJour(entrees.subsidyBtc);
    const coutElec = coutElectriqueParBtc(
      entrees.hashrateHs,
      params.efficaciteJParTh,
      params.prixKwhUsd,
      emission,
    );
    const coutAllIn = coutAllInParBtc(coutElec, params.multiplicateurAllIn);
    const hashprice = hashpriceUsdParPhJour(
      entrees.prixBtc,
      entrees.subsidyBtc,
      entrees.feesBtcParBloc,
      entrees.hashrateHs,
    );
    return {
      emission,
      coutElec,
      coutAllIn,
      hashprice,
      ratioElec: ratioPrixCout(entrees.prixBtc, coutElec),
      ratioAllIn: ratioPrixCout(entrees.prixBtc, coutAllIn),
    };
  }, [entrees, params]);

  const rafraichir = (): void => {
    void mineStore.getState().run(true);
  };

  // Variation du hashrate courant vs son pic 1 an (négatif = sous le pic).
  const varVsPic =
    entrees !== null && Number.isFinite(entrees.picHashrateHs) && entrees.picHashrateHs > 0
      ? (entrees.hashrateHs - entrees.picHashrateHs) / entrees.picHashrateHs
      : NaN;

  const aj = entrees?.ajustement ?? null;

  return (
    <>
      <EnTeteFenetre
        mnemo="MINE"
        titre="Coût de production (minage)"
        sousTitre="Modèle paramétrique · mempool.space · Coin Metrics · Binance"
        actions={
          <>
            <button
              type="button"
              onClick={() => setParamsOuverts((v) => !v)}
              className={`rounded border px-2 py-1 text-[11px] transition ${
                paramsOuverts ? "border-accent text-accent" : "border-border text-text-dim hover:text-text"
              }`}
            >
              ⚙ Paramètres
            </button>
            <button
              type="button"
              onClick={rafraichir}
              disabled={enCours}
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              ↻ Rafraîchir
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {erreur !== null && entrees === null ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && entrees === null ? (
          <Chargement libelle="Collecte hashrate, difficulté, frais & prix…" />
        ) : entrees === null || derive === null ? (
          <Vide>Aucune donnée de minage exploitable. Réessayez avec Rafraîchir.</Vide>
        ) : (
          <>
            {/* Bandeau discret si retry échoué (série existante préservée). */}
            {erreur !== null && (
              <div className="rounded border border-down/40 bg-surface/90 px-2 py-1 text-[10px] text-down">
                {erreur}
              </div>
            )}

            {/* Panneau paramètres (repliable). */}
            {paramsOuverts && (
              <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text">Paramètres du modèle</span>
                  <button
                    type="button"
                    onClick={() => mineStore.getState().resetParams()}
                    className="text-[10px] text-accent hover:underline"
                  >
                    réinitialiser défauts
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <ChampParam
                    libelle="Efficacité parc"
                    valeur={params.efficaciteJParTh}
                    unite="J/TH"
                    step={1}
                    min={1}
                    onChange={(v) => mineStore.getState().setParams({ efficaciteJParTh: v })}
                  />
                  <ChampParam
                    libelle="Électricité"
                    valeur={params.prixKwhUsd}
                    unite="$/kWh"
                    step={0.005}
                    min={0.001}
                    onChange={(v) => mineStore.getState().setParams({ prixKwhUsd: v })}
                  />
                  <ChampParam
                    libelle="Multiplicateur all-in"
                    valeur={params.multiplicateurAllIn}
                    unite="×"
                    step={0.05}
                    min={1}
                    onChange={(v) => mineStore.getState().setParams({ multiplicateurAllIn: v })}
                  />
                </div>
                <p className="mt-2 text-[10px] leading-snug text-text-dim">
                  Défauts : {PARAMS_MINE_DEFAUT.efficaciteJParTh} J/TH · {PARAMS_MINE_DEFAUT.prixKwhUsd} $/kWh ·
                  ×{PARAMS_MINE_DEFAUT.multiplicateurAllIn}. Le défaut d'efficacité suit l'efficacité
                  effective de parc impliquée par Capriole (~21,5 J/TH) ; monter vers 25-30 modélise un parc moins moderne.
                </p>
              </div>
            )}

            {/* Bandeau prix vs plancher élec vs all-in. */}
            <BandeauCouts
              prix={entrees.prixBtc}
              elec={derive.coutElec}
              allIn={derive.coutAllIn}
              ratioElec={derive.ratioElec}
              ratioAllIn={derive.ratioAllIn}
            />

            {/* Tuiles : hashprice, difficulté + ajustement, hashrate + variation vs pic. */}
            <div className="grid grid-cols-2 gap-2">
              <Tuile
                libelle="Hashprice"
                valeur={Number.isFinite(derive.hashprice) ? `${formatDec(derive.hashprice, 1)} $/PH/j` : "—"}
                sousTexte={
                  entrees.feesDisponible
                    ? `subsidy ${formatDec(entrees.subsidyBtc, 3)} + frais ${formatDec(entrees.feesBtcParBloc, 3)} BTC/bloc`
                    : `subsidy ${formatDec(entrees.subsidyBtc, 3)} BTC/bloc · hors frais`
                }
              />
              <Tuile
                libelle="Hashrate (courant)"
                valeur={fmtEhs(entrees.hashrateHs)}
                ton={Number.isFinite(varVsPic) && varVsPic < -0.05 ? "warn" : "neutre"}
                sousTexte={
                  Number.isFinite(varVsPic)
                    ? `${fmtPctSigne(varVsPic * 100, 1)} vs pic 1 an (${fmtEhs(entrees.picHashrateHs)})`
                    : undefined
                }
                spark={entrees.hashrateSerie.map((p) => p.value)}
                sparkColor="--up"
              />
              <Tuile
                libelle="Difficulté"
                valeur={Number.isFinite(entrees.difficulteCourante) ? formatCompact(entrees.difficulteCourante) : "—"}
                sousTexte={
                  aj !== null && Number.isFinite(aj.difficultyChange)
                    ? `prochain ajust. ${fmtPctSigne(aj.difficultyChange, 2)}`
                    : undefined
                }
                spark={entrees.difficulteSerie.map((p) => p.value)}
                sparkColor="--serie-4"
              />
              <Tuile
                libelle="Prochain retarget"
                valeur={
                  aj !== null && Number.isFinite(aj.estimatedRetargetDate)
                    ? formatDateComplete(aj.estimatedRetargetDate)
                    : "—"
                }
                sousTexte={
                  aj !== null && Number.isFinite(aj.progressPercent)
                    ? `avancée ${formatPourcentage(aj.progressPercent, 0)}${
                        Number.isFinite(aj.remainingBlocks) ? ` · ${aj.remainingBlocks} blocs restants` : ""
                      }`
                    : undefined
                }
              />
            </div>

            {/* Note d'honnêteté (règle d'or) + fraîcheur. */}
            <div className="mt-1 flex items-start justify-between gap-3">
              <NoteSource>
                Modèle paramétrique (parc moyen supposé), pas une mesure ; repères externes mars 2026 :
                Capriole élec 46,4 k$ / all-in 58 k$. Défaut 22 J/TH calé sur l'efficacité effective
                de parc — ajustable dans ⚙ Paramètres.
              </NoteSource>
              <Fraicheur loading={enCours} majTs={majTs} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
