/**
 * Fenêtre « CAP » — capitalisation totale du marché crypto, TOTAL3 et dominances.
 *
 * Trois graphiques empilés partageant le MÊME axe des temps et le MÊME réticule :
 *   1. TOTAL   — capitalisation de toutes les cryptos (reconstruite, cf. data/mcap.ts) ;
 *   2. TOTAL3  — hors BTC et ETH (le « risque alt » au sens TradingView) ;
 *   3. DOMINANCES — BTC.D, ETH.D, alts et n'importe quelle pièce du top 100.
 *
 * Présentation PURE (patron NETLIQ/CBPREM) : les séries vivent dans `mcapStore`
 * (vanilla) ; seul le survol est local à React. Tracé canvas en px CSS sous
 * `setTransform(dpr,…)`, `ResizeObserver` pour la réactivité, couleurs lues AU DESSIN
 * (thème courant). La géométrie est PARTAGÉE entre dessin et hit-testing via
 * `mcapWindow.util` — mêmes littéraux des deux côtés, sinon le trait du curseur ne
 * coïncide pas avec le point (leçon HEATMAP).
 *
 * DOMAINE VERTICAL calé sur les extrêmes de la fenêtre, JAMAIS forcé à contenir 0 :
 * un TOTAL de 2,3 T$ qui varie de quelques pourcents s'écraserait contre le cadre
 * (même divergence assumée que NETLIQ).
 *
 * L'HISTORIQUE se construit en une fois (bouton dédié) : 100 appels cadencés, ~3,5 min
 * avec une clé Demo CoinGecko, ~25 min sans (plafond keyless mesuré ≈ 5 appels/min, avec
 * 60 s de pénalité). Interruptible, repris là où il s'était arrêté. Ensuite, deux appels
 * suffisent à prolonger la série jour après jour.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { dominance, dominanceAlts, serieDifference } from "../data/mcap";
import { formatPourcentage, formatUsd } from "../lib/format";
import { lireTokenCanvas, rgbaTokenCanvas, POLICE_CANVAS } from "../lib/canvasTokens";
import {
  ID_ALTS,
  PALETTE_DOMINANCES,
  PLAFOND_DOMINANCES,
  mcapStore,
} from "../store/mcap";
import {
  BarrePeriodes,
  BarreProgression,
  Bouton,
  Chargement,
  Chip,
  CLASSES_BOUTON,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  Input,
  InfobulleGraphe,
  MenuDeroulant,
  NoteSource,
  PERIODES_STANDARD,
  Vide,
  BoutonRafraichir,
} from "./ui";
import {
  MARGES,
  construireVues,
  domaineValeurs,
  indexDepuisX,
  projX,
  projY,
  ticksTemps,
  ticksValeurs,
  type VuesMcap,
} from "./mcapWindow.util";

/** Les trois graphiques, du haut vers le bas. */
type GrapheId = "total" | "total3" | "dom";

/** Point survolé — index partagé par les trois graphiques, abscisse propre au graphe visé. */
interface Survol {
  i: number;
  xPix: number;
  largeur: number;
  graphe: GrapheId;
}

/** Une série à peindre sur un graphique. */
interface SerieTracee {
  valeurs: (number | null)[];
  /** Token de couleur du thème (`--accent`, `--serie-N`). */
  token: string;
  repli: string;
  /** Aire dégradée sous la courbe (réservée aux graphiques mono-série). */
  aire?: boolean;
}

// ─────────────────────────── Dessin ───────────────────────────

function dessiner(
  canvas: HTMLCanvasElement,
  series: readonly SerieTracee[],
  grille: readonly number[],
  formatY: (v: number) => string,
  axeX: boolean,
  survolIdx: number | null
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const n = grille.length;
  if (n === 0) return;

  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const trait = lireTokenCanvas("--grid", "#1f2937");
  const dom = domaineValeurs(series.map((s) => s.valeurs));

  ctx.font = POLICE_CANVAS;

  // Grille horizontale + étiquettes de valeurs à gauche.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of ticksValeurs(dom.min, dom.max, 4)) {
    const y = projY(t, dom.min, dom.max, h);
    ctx.strokeStyle = trait;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGES.g, y);
    ctx.lineTo(w - MARGES.d, y);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(formatY(t), MARGES.g - 4, y);
  }

  // Étiquettes de temps : uniquement sous le graphique du bas (axe commun).
  if (axeX) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = dim;
    for (const t of ticksTemps(grille, w)) {
      ctx.fillText(t.label, projX(t.i, n, w), h - 4);
    }
  }

  // Courbes — un trait par série, interrompu sur les trous (valeur null).
  for (const serie of series) {
    const couleur = lireTokenCanvas(serie.token, serie.repli);

    if (serie.aire === true) {
      ctx.save();
      ctx.beginPath();
      let demarre = false;
      serie.valeurs.forEach((v, i) => {
        if (v === null) return;
        const x = projX(i, n, w);
        const y = projY(v, dom.min, dom.max, h);
        if (!demarre) {
          ctx.moveTo(x, h - MARGES.b);
          ctx.lineTo(x, y);
          demarre = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      if (demarre) {
        ctx.lineTo(projX(n - 1, n, w), h - MARGES.b);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, MARGES.h, 0, h - MARGES.b);
        grad.addColorStop(0, rgbaTokenCanvas(serie.token, 0.14, serie.repli));
        grad.addColorStop(1, rgbaTokenCanvas(serie.token, 0, serie.repli));
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.strokeStyle = couleur;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let trace = false;
    serie.valeurs.forEach((v, i) => {
      if (v === null) {
        trace = false;
        return;
      }
      const x = projX(i, n, w);
      const y = projY(v, dom.min, dom.max, h);
      if (trace) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      trace = true;
    });
    ctx.stroke();
  }

  // Réticule : trait vertical sur TOUS les graphiques, même index.
  if (survolIdx !== null && survolIdx >= 0 && survolIdx < n) {
    const x = projX(survolIdx, n, w);
    ctx.save();
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, MARGES.h);
    ctx.lineTo(x, h - MARGES.b);
    ctx.stroke();
    ctx.restore();
  }
}

// ─────────────────────────── Sous-composants ───────────────────────────

/** Un graphique : canvas + son infobulle quand il est celui qui est survolé. */
function Graphe({
  titre,
  series,
  vues,
  formatY,
  axeX,
  id,
  survol,
  onSurvol,
  lignesInfobulle,
}: {
  titre: string;
  series: readonly SerieTracee[];
  vues: VuesMcap;
  formatY: (v: number) => string;
  axeX: boolean;
  id: GrapheId;
  survol: Survol | null;
  onSurvol: (s: Survol | null) => void;
  lignesInfobulle: (i: number) => { label: string; valeur: string; couleur?: string }[];
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const n = vues.grille.length;

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const redraw = (): void =>
      dessiner(canvas, series, vues.grille, formatY, axeX, survol?.i ?? null);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [series, vues, formatY, axeX, survol]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = indexDepuisX(mx, n, rect.width);
    onSurvol({ i, xPix: projX(i, n, rect.width), largeur: rect.width, graphe: id });
  };

  const jour = survol === null ? null : vues.grille[survol.i];

  return (
    <div className="relative min-h-0 flex-1">
      <span className="pointer-events-none absolute left-14 top-0 z-10 text-[10px] uppercase tracking-wider text-text-dim">
        {titre}
      </span>
      <canvas
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={() => onSurvol(null)}
        className="h-full w-full"
        aria-label={titre}
      />
      {survol !== null && survol.graphe === id && jour !== undefined && jour !== null && (
        <InfobulleGraphe
          xPix={survol.xPix}
          largeurGraphe={survol.largeur}
          titre={new Date(jour).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          })}
          lignes={lignesInfobulle(survol.i)}
        />
      )}
    </div>
  );
}

/** Sélecteur « + » : recherche dans le top 100 et ajout d'une courbe de dominance. */
function AjoutDominance({ desactive }: { desactive: boolean }) {
  const marches = useStore(mcapStore, (s) => s.marches);
  const dominances = useStore(mcapStore, (s) => s.dominances);
  const [filtre, setFiltre] = useState("");

  const candidats = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    return marches
      .slice(0, 100)
      .filter((m) => !dominances.includes(m.id))
      .filter((m) => q === "" || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [marches, dominances, filtre]);

  if (desactive) {
    return (
      <Bouton disabled title="Ajouter une dominance (top 100)">
        + dominance
      </Bouton>
    );
  }

  return (
    <MenuDeroulant
      direction="haut"
      declencheur="+ dominance"
      titre="Ajouter une dominance (top 100)"
      classePanneau="w-56"
      chevron={false}
      declencheurClasse={CLASSES_BOUTON.secondaire}
    >
      {(fermer) => (
        <>
          <Input
            autoFocus
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            placeholder="Symbole ou nom…"
            aria-label="Rechercher une pièce"
            className="mb-1 w-full"
          />
          <div className="max-h-48 overflow-y-auto">
            {!dominances.includes(ID_ALTS) && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void mcapStore.getState().ajouterDominance(ID_ALTS);
                  fermer();
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] text-text hover:bg-bg"
              >
                <span>Alts (100 − BTC.D − ETH.D)</span>
              </button>
            )}
            {candidats.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  void mcapStore.getState().ajouterDominance(m.id);
                  fermer();
                }}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] text-text hover:bg-bg"
              >
                <span>{m.symbol}</span>
                <span className="text-text-dim">{m.name}</span>
              </button>
            ))}
            {candidats.length === 0 && (
              <p className="px-2 py-1 text-[11px] text-text-dim">Aucune pièce.</p>
            )}
          </div>
        </>
      )}
    </MenuDeroulant>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

export function McapWindow() {
  const hist = useStore(mcapStore, (s) => s.hist);
  const marches = useStore(mcapStore, (s) => s.marches);
  const backfill = useStore(mcapStore, (s) => s.backfill);
  const dominances = useStore(mcapStore, (s) => s.dominances);
  const periode = useStore(mcapStore, (s) => s.periode);
  const erreur = useStore(mcapStore, (s) => s.erreur);
  const majTs = useStore(mcapStore, (s) => s.majTs);

  const [survol, setSurvol] = useState<Survol | null>(null);

  // Prolongement au premier affichage (TTL 10 min côté store : deux appels au plus).
  useEffect(() => {
    void mcapStore.getState().prolonger();
  }, []);

  const jours = useMemo(
    () => PERIODES_STANDARD.find((p) => p.id === periode)?.jours ?? null,
    [periode]
  );

  const symboleParId = useMemo(
    () => new Map(marches.map((m) => [m.id, m.symbol])),
    [marches]
  );

  const vues = useMemo(
    () =>
      construireVues(hist, dominances, jours, {
        idAlts: ID_ALTS,
        palette: PALETTE_DOMINANCES,
        libelle: (id) => symboleParId.get(id) ?? id,
        dominance,
        dominanceAlts,
        difference: serieDifference,
      }),
    [hist, dominances, jours, symboleParId]
  );

  const serieTotal = useMemo<SerieTracee[]>(
    () => [{ valeurs: vues.total, token: "--accent", repli: "#38bdf8", aire: true }],
    [vues]
  );
  const serieTotal3 = useMemo<SerieTracee[]>(
    () => [{ valeurs: vues.total3, token: "--serie-2", repli: "#a78bfa", aire: true }],
    [vues]
  );
  const seriesDom = useMemo<SerieTracee[]>(
    () => vues.courbes.map((c) => ({ valeurs: c.valeurs, token: c.token, repli: "#38bdf8" })),
    [vues]
  );

  const vide = hist === null || vues.grille.length === 0;
  const progression =
    backfill.total > 0 ? Math.round((backfill.faites / backfill.total) * 100) : 0;

  return (
    <>
      <EnTeteFenetre
        mnemo="CAP"
        titre="Capitalisation & dominance"
        sousTitre="TOTAL · TOTAL3 · dominances — reconstruction top 100 recalibrée"
        actions={
          <BoutonRafraichir
            onClick={() => void mcapStore.getState().prolonger(true)}
            disabled={backfill.enCours}
          />
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        {backfill.enCours ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            <Chargement
              libelle={`Reconstruction de l'historique — ${backfill.faites}/${backfill.total} pièces`}
            />
            <div className="w-64">
              <BarreProgression fraction={progression / 100} ariaLabel="Progression du backfill" />
            </div>
            <Bouton onClick={() => mcapStore.getState().interrompre()}>
              Interrompre (la progression est conservée)
            </Bouton>
          </div>
        ) : vide ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            <Vide>
              Aucun historique local. CoinGecko ne donne l'agrégat historique qu'au tier Pro :
              AXIOM le reconstruit en sommant les 100 premières capitalisations (≈ 97,8 % du
              marché), puis recale le résultat sur le total courant.
            </Vide>
            <Bouton variante="primaire" onClick={() => void mcapStore.getState().demarrerBackfill()}>
              Construire l'historique (365 j)
            </Bouton>
            <p className="max-w-sm text-center text-[10px] leading-snug text-text-dim">
              100 appels cadencés. Avec une clé Demo CoinGecko (gratuite, à saisir dans les
              Réglages) : environ 3,5 min. Sans clé : environ 25 min — CoinGecko limite alors
              à ~5 appels/minute et impose 60 s d'attente à chaque dépassement (mesuré).
              Interruptible à tout moment, et repris là où il s'est arrêté.
            </p>
            {backfill.erreur !== null && <ErreurBloc>{backfill.erreur}</ErreurBloc>}
          </div>
        ) : (
          <>
            {(erreur !== null || backfill.erreur !== null) && (
              <div className="mb-2">
                <ErreurBloc>{erreur ?? backfill.erreur}</ErreurBloc>
              </div>
            )}

            <div className="mb-1">
              <BarrePeriodes
                actif={periode}
                onChange={(p) => mcapStore.getState().setPeriode(p.id)}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <Graphe
                id="total"
                titre="TOTAL — capitalisation crypto"
                series={serieTotal}
                vues={vues}
                formatY={formatUsd}
                axeX={false}
                survol={survol}
                onSurvol={setSurvol}
                lignesInfobulle={(i) => [
                  {
                    label: "TOTAL",
                    valeur: formatUsd(vues.total[i] ?? null),
                    couleur: lireTokenCanvas("--accent", "#38bdf8"),
                  },
                ]}
              />
              <Graphe
                id="total3"
                titre="TOTAL3 — hors BTC et ETH"
                series={serieTotal3}
                vues={vues}
                formatY={formatUsd}
                axeX={false}
                survol={survol}
                onSurvol={setSurvol}
                lignesInfobulle={(i) => [
                  {
                    label: "TOTAL3",
                    valeur: formatUsd(vues.total3[i] ?? null),
                    couleur: lireTokenCanvas("--serie-2", "#a78bfa"),
                  },
                ]}
              />
              <Graphe
                id="dom"
                titre="Dominances"
                series={seriesDom}
                vues={vues}
                formatY={(v) => formatPourcentage(v, 0)}
                axeX
                survol={survol}
                onSurvol={setSurvol}
                lignesInfobulle={(i) =>
                  vues.courbes.map((c) => ({
                    label: c.libelle,
                    valeur: formatPourcentage(c.valeurs[i] ?? null, 1),
                    couleur: lireTokenCanvas(c.token, "#38bdf8"),
                  }))
                }
              />
            </div>

            {/* Pastilles de dominance : couleur de la courbe, retrait d'un clic. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {vues.courbes.map((c) => (
                <Chip
                  key={c.id}
                  onRetirer={() => mcapStore.getState().retirerDominance(c.id)}
                  retirerLabel={`Retirer ${c.libelle}`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: `var(${c.token})` }}
                  />
                  {c.libelle}
                </Chip>
              ))}
              <AjoutDominance desactive={dominances.length >= PLAFOND_DOMINANCES} />
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <NoteSource>
                CoinGecko · TOTAL reconstruit par somme du top 100 (≈ 97,8 % du marché)
                {hist !== null && hist.recalibre
                  ? ` recalibrée sur /global (×${hist.k.toFixed(4)})`
                  : " — NON recalibrée"}
                {" · "}365 j maximum en gratuit · dominance = part du TOTAL recalibré
              </NoteSource>
              <Fraicheur loading={backfill.enCours} majTs={majTs} cadence="10 min" />
            </div>
          </>
        )}
      </div>
    </>
  );
}
