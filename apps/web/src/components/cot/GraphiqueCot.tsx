/**
 * Onglet « Graphique » de la fenêtre COT : exposition de chaque catégorie de traders sur un
 * marché, rapport après rapport, sur tout l'historique publié par la CFTC.
 *
 * Panneau du haut : net (longs − shorts) de chaque catégorie, en contrats ou en % de l'open
 * interest. Panneau du bas : open interest du marché (échelle propre — jamais de double axe).
 * Le tableau sous le graphe sert de légende (clic = masquer/afficher), donne les chiffres
 * exacts du dernier rapport et tient lieu de vue tabulaire.
 *
 * Présentation pure : les données vivent dans `cotHistoriqueStore`. Le tracé suit le patron
 * canvas des fenêtres analytiques (CBPREM, NETLIQ) : CSS px sous `setTransform(dpr)`, tokens
 * lus au dessin, géométrie partagée entre dessin et survol, zoom/pan par `useDomaineZoom`.
 * Tant que l'onglet est affiché, le store relit la CFTC à chaque publication hebdomadaire.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { CATEGORIES_COT, WATCHLIST_COT } from "../../data/cot";
import {
  CATEGORIES_GRAPHE,
  LIBELLE_RAPPORT,
  bilanCoherence,
  datasetGraphe,
  dateRapportSuivant,
  expositionDerniere,
  instrumentCot,
  prochainePublicationCot,
  rapportEnRetard,
  type CategorieGraphe,
  type ModeRapportGraphe,
  type PointHistoriqueCot,
  type SerieHistoriqueCot,
} from "../../data/cotHistorique";
import { cotHistoriqueStore } from "../../store/cotHistorique";
import { useDomaineZoom } from "../../hooks/useDomaineZoom";
import {
  domainePourPreset,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  type Domaine,
} from "../../lib/domaineAxe";
import { POLICE_CANVAS, lireTokenCanvas, rgbaTokenCanvas, serieCanvas } from "../../lib/canvasTokens";
import { formatDateComplete, formatEntier } from "../../lib/format";
import { Badge, Chargement, ErreurBloc, Fraicheur, NoteSource, Select, SegmenteCompact, Vide } from "../ui";
import {
  ECART_MAX_MS,
  PERIODES_COT,
  PERIODE_DEFAUT,
  domaineVertical,
  formatAxeCot,
  formatValeurCot,
  indexPlusProche,
  ticksRonds,
  ticksTemps,
  valeurCot,
  type UniteCot,
} from "./graphiqueCot.util";

// ─────────────────────────── Géométrie (partagée dessin / survol) ───────────────────────────

const MARGES = { gauche: 46, droite: 10 } as const;
const PAD_HAUT = 8;
const PAD_BAS = 18;
const ECART_PANNEAUX = 16;
const SEMAINE_MS = 7 * 86_400_000;

interface Geometrie {
  left: number;
  right: number;
  plotW: number;
  net: { top: number; bottom: number };
  oi: { top: number; bottom: number };
}

function geometrie(w: number, h: number): Geometrie {
  const left = MARGES.gauche;
  const right = Math.max(left + 1, w - MARGES.droite);
  const hautOi = Math.max(34, Math.round((h - PAD_HAUT - PAD_BAS - ECART_PANNEAUX) * 0.22));
  return {
    left,
    right,
    plotW: right - left,
    net: { top: PAD_HAUT, bottom: h - PAD_BAS - ECART_PANNEAUX - hautOi },
    oi: { top: h - PAD_BAS - hautOi, bottom: h - PAD_BAS },
  };
}

const xDe = (g: Geometrie, d: Domaine, t: number): number => g.left + valeurVersPixel(d, t, g.plotW);
const yDe = (pane: { top: number; bottom: number }, d: Domaine, v: number): number =>
  pane.bottom - ((v - d.min) / Math.max(1e-12, d.max - d.min)) * (pane.bottom - pane.top);

/** Couleur d'une catégorie : séries 1…4 dans l'ordre fixe du rapport ; non déclarants en retrait. */
function couleurCanvas(cat: CategorieGraphe, index: number): string {
  return cat.residuel ? lireTokenCanvas("--text-dim", "#94a3b8") : serieCanvas(index);
}

function couleurCss(cat: CategorieGraphe, index: number): string {
  return cat.residuel ? "var(--text-dim)" : `var(--serie-${index + 1})`;
}

// ─────────────────────────── Dessin ───────────────────────────

interface ParamsDessin {
  serie: SerieHistoriqueCot;
  visibles: readonly number[];
  unite: UniteCot;
  domaine: Domaine;
  survol: number | null;
}

function tracerLigne(
  ctx: CanvasRenderingContext2D,
  points: readonly PointHistoriqueCot[],
  debut: number,
  fin: number,
  valeur: (p: PointHistoriqueCot) => number | null,
  x: (t: number) => number,
  y: (v: number) => number,
): void {
  ctx.beginPath();
  let ouvert = false;
  let tPrec = -Infinity;
  for (let k = debut; k <= fin; k++) {
    const p = points[k]!;
    const v = valeur(p);
    if (v === null) {
      ouvert = false;
      continue;
    }
    if (!ouvert || p.t - tPrec > ECART_MAX_MS) ctx.moveTo(x(p.t), y(v));
    else ctx.lineTo(x(p.t), y(v));
    ouvert = true;
    tPrec = p.t;
  }
  ctx.stroke();
}

function dessiner(canvas: HTMLCanvasElement, params: ParamsDessin): void {
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

  const { serie, visibles, unite, domaine, survol } = params;
  const points = serie.points;
  const categories = CATEGORIES_GRAPHE[serie.dataset];
  const g = geometrie(w, h);
  const dim = lireTokenCanvas("--text-dim", "#94a3b8");
  const grille = lireTokenCanvas("--grid", "#1f2937");
  const surface = lireTokenCanvas("--surface", "#171717");
  const x = (t: number): number => xDe(g, domaine, t);
  const { debut, fin } = indicesVisibles(points, (p) => p.t, domaine);
  ctx.font = POLICE_CANVAS;
  ctx.lineJoin = "round";

  // Graduations du temps : traits verticaux discrets sur les deux panneaux, dates en bas.
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (const tick of ticksTemps(domaine.min, domaine.max, Math.max(2, Math.floor(g.plotW / 72)))) {
    const xt = x(tick.t);
    ctx.strokeStyle = grille;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xt, g.net.top);
    ctx.lineTo(xt, g.oi.bottom);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(tick.label, Math.min(Math.max(xt, g.left + 14), g.right - 14), g.oi.bottom + 4);
  }

  // ── Panneau net ──
  const domY = domaineVertical(points, visibles, unite, domaine) ?? { min: -1, max: 1 };
  const yNet = (v: number): number => yDe(g.net, domY, v);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of ticksRonds(domY.min, domY.max, 4)) {
    const yt = yNet(t);
    ctx.strokeStyle = grille;
    ctx.beginPath();
    ctx.moveTo(g.left, yt);
    ctx.lineTo(g.right, yt);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.fillText(formatAxeCot(t, unite), g.left - 4, yt);
  }
  // Zéro en trait plein : au-dessus = exposition nette acheteuse, en dessous = vendeuse.
  ctx.strokeStyle = dim;
  ctx.beginPath();
  ctx.moveTo(g.left, yNet(0));
  ctx.lineTo(g.right, yNet(0));
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(g.left, g.net.top, g.plotW, g.net.bottom - g.net.top);
  ctx.clip();
  // Non déclarants d'abord (en dessous), puis les catégories dans l'ordre fixe.
  const ordre = [...visibles].sort((a, b) => Number(!categories[a]?.residuel) - Number(!categories[b]?.residuel));
  for (const i of ordre) {
    const cat = categories[i]!;
    ctx.strokeStyle = couleurCanvas(cat, i);
    ctx.lineWidth = cat.residuel ? 1.25 : 2;
    ctx.setLineDash(cat.residuel ? [4, 3] : []);
    tracerLigne(ctx, points, debut, fin, (p) => valeurCot(p, i, unite), x, yNet);
  }
  ctx.setLineDash([]);
  ctx.restore();

  // ── Panneau open interest (échelle propre, 0 → max visible) ──
  let oiMax = 0;
  for (let k = debut; k <= fin; k++) {
    const oi = points[k]!.oi;
    if (Number.isFinite(oi) && oi > oiMax) oiMax = oi;
  }
  if (oiMax > 0) {
    const pasOi = ticksRonds(0, oiMax, 2);
    const domOi: Domaine = { min: 0, max: Math.max(oiMax * 1.05, pasOi.at(-1) ?? oiMax) };
    const yOi = (v: number): number => yDe(g.oi, domOi, v);
    for (const t of pasOi) {
      if (t === 0) continue;
      ctx.strokeStyle = grille;
      ctx.beginPath();
      ctx.moveTo(g.left, yOi(t));
      ctx.lineTo(g.right, yOi(t));
      ctx.stroke();
      ctx.fillStyle = dim;
      ctx.fillText(formatAxeCot(t, "contrats"), g.left - 4, yOi(t));
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.left, g.oi.top, g.plotW, g.oi.bottom - g.oi.top);
    ctx.clip();
    ctx.fillStyle = rgbaTokenCanvas("--text-dim", 0.16, "#94a3b8");
    let ouvert = false;
    let tPrec = -Infinity;
    let xDebut = 0;
    let xPrec = 0;
    const fermer = (): void => {
      ctx.lineTo(xPrec, g.oi.bottom);
      ctx.lineTo(xDebut, g.oi.bottom);
      ctx.closePath();
      ctx.fill();
    };
    for (let k = debut; k <= fin; k++) {
      const p = points[k]!;
      if (!Number.isFinite(p.oi) || (ouvert && p.t - tPrec > ECART_MAX_MS)) {
        if (ouvert) fermer();
        ouvert = false;
        if (!Number.isFinite(p.oi)) continue;
      }
      const xp = x(p.t);
      if (!ouvert) {
        ctx.beginPath();
        ctx.moveTo(xp, yOi(p.oi));
        xDebut = xp;
        ouvert = true;
      } else ctx.lineTo(xp, yOi(p.oi));
      xPrec = xp;
      tPrec = p.t;
    }
    if (ouvert) fermer();
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    tracerLigne(ctx, points, debut, fin, (p) => (Number.isFinite(p.oi) ? p.oi : null), x, yOi);
    ctx.restore();
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = dim;
  ctx.fillText("Open interest", g.left + 4, g.oi.top + 2);

  // ── Curseur : trait vertical + marqueurs cerclés de la surface ──
  const ps = survol === null ? undefined : points[survol];
  if (ps !== undefined) {
    const xs = x(ps.t);
    ctx.strokeStyle = rgbaTokenCanvas("--text-dim", 0.6, "#94a3b8");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xs, g.net.top);
    ctx.lineTo(xs, g.oi.bottom);
    ctx.stroke();
    for (const i of visibles) {
      const v = valeurCot(ps, i, unite);
      if (v === null) continue;
      ctx.beginPath();
      ctx.arc(xs, yNet(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = couleurCanvas(categories[i]!, i);
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }
}

// ─────────────────────────── Sous-composants ───────────────────────────

/** Échantillon du style de trait d'une catégorie (identité jamais portée par la seule couleur). */
function Echantillon({ cat, index }: { cat: CategorieGraphe; index: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-3.5 shrink-0"
      style={{ borderTop: `${cat.residuel ? "1.5px dashed" : "2.5px solid"} ${couleurCss(cat, index)}` }}
    />
  );
}

function Infobulle({ xPix, largeur, enfants }: { xPix: number; largeur: number; enfants: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-text shadow-lg"
      style={{ left: xPix + 12 + 190 > largeur ? Math.max(0, xPix - 12 - 190) : xPix + 12, top: 6, width: 190 }}
    >
      {enfants}
    </div>
  );
}

function deltaClasse(v: number | null): string {
  return v === null || v === 0 ? "text-text-dim" : "text-text";
}

/** Tableau d'exposition au dernier rapport — sert aussi de légende cliquable. */
function TableauExposition({
  serie,
  unite,
  masquees,
  basculer,
}: {
  serie: SerieHistoriqueCot;
  unite: UniteCot;
  masquees: ReadonlySet<string>;
  basculer: (id: string) => void;
}) {
  const lignes = expositionDerniere(serie);
  const dernier = serie.points.at(-1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-[11px] tabular-nums" aria-label="Exposition par catégorie au dernier rapport">
        <caption className="pb-1 text-left text-[10px] uppercase tracking-wide text-text-dim">
          Exposition au {formatDateComplete(dernier?.t ?? 0)} · cliquer une catégorie pour la masquer
        </caption>
        <thead>
          <tr className="whitespace-nowrap text-[10px] text-text-dim">
            <th scope="col" className="py-1 pr-2 text-left font-normal">Catégorie</th>
            <th scope="col" className="px-1 text-right font-normal">Longs</th>
            <th scope="col" className="px-1 text-right font-normal">Shorts</th>
            <th scope="col" className="px-1 text-right font-normal">Net</th>
            <th scope="col" className="px-1 text-right font-normal" title="Variation du net depuis le rapport précédent">Δ net</th>
            <th scope="col" className="px-1 text-right font-normal" title="Net en % de l'open interest total du marché">Net/OI</th>
            <th scope="col" className="pl-1 text-right font-normal" title="Position du net dans son amplitude min–max des 156 derniers rapports (≈ 3 ans) — pas un percentile">Indice 3 a</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => {
            const masquee = masquees.has(l.categorie.id);
            return (
              <tr key={l.categorie.id} className="border-t border-border/60" data-cot-categorie={l.categorie.id}>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {l.disponible ? (
                    <button
                      type="button"
                      onClick={() => basculer(l.categorie.id)}
                      aria-pressed={!masquee}
                      title={l.categorie.description}
                      className={`flex items-center gap-1.5 text-left hover:text-text ${masquee ? "text-text-dim line-through" : "text-text"}`}
                    >
                      <Echantillon cat={l.categorie} index={l.index} />
                      {l.categorie.libelle}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5 text-text-dim" title={l.categorie.description}>
                      <Echantillon cat={l.categorie} index={l.index} />
                      {l.categorie.libelle}
                    </span>
                  )}
                </th>
                {l.disponible ? (
                  <>
                    <td className="whitespace-nowrap px-1 text-right">{formatEntier(l.long)}</td>
                    <td className="whitespace-nowrap px-1 text-right">{formatEntier(l.short)}</td>
                    <td className="whitespace-nowrap px-1 text-right font-medium">{formatValeurCot(l.net, "contrats")}</td>
                    <td className={`whitespace-nowrap px-1 text-right ${deltaClasse(l.deltaNet)}`}>{formatValeurCot(l.deltaNet, "contrats")}</td>
                    <td className={`whitespace-nowrap px-1 text-right ${unite === "pctOi" ? "font-medium" : ""}`}>{formatValeurCot(l.netPctOi, "pctOi")}</td>
                    <td className="whitespace-nowrap pl-1 text-right">{l.indice === null ? "—" : Math.round(l.indice)}</td>
                  </>
                ) : (
                  <td colSpan={6} className="px-1 text-right text-text-dim">Absente de la réponse CFTC</td>
                )}
              </tr>
            );
          })}
          {dernier !== undefined && (
            <tr className="border-t border-border/60 text-text-dim">
              <th scope="row" className="py-1 pr-2 text-left font-normal">Open interest (tout le marché)</th>
              <td colSpan={6} className="px-1 text-right">{formatEntier(Number.isFinite(dernier.oi) ? dernier.oi : null)} contrats</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Statut hebdomadaire : date des positions, prochaine publication ou rapport en retard. */
function StatutPublication({ serie, ts, enCours }: { serie: SerieHistoriqueCot; ts: number | null; enCours: boolean }) {
  const dernier = serie.points.at(-1)?.t ?? null;
  if (dernier === null) return null;
  const prochaine = prochainePublicationCot(dernier);
  const jourNy = new Date(prochaine).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "America/New_York",
  });
  const retard = rapportEnRetard(dernier, Date.now());
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-text-dim">
      <span>
        Positions du {formatDateComplete(dernier)} ·{" "}
        {retard ? (
          <Badge ton="warn" title="Publication décalée (jour férié aux États-Unis) ou retard CFTC : nouvelle vérification automatique.">
            rapport du {formatDateComplete(dateRapportSuivant(dernier))} attendu, pas encore publié
          </Badge>
        ) : (
          <>prochain rapport {jourNy} vers 15 h 30 (New York), mis à jour automatiquement</>
        )}
      </span>
      <Fraicheur loading={enCours} majTs={ts} cadenceMs={SEMAINE_MS} />
    </div>
  );
}

// ─────────────────────────── Composant ───────────────────────────

export function GraphiqueCot() {
  const marche = useStore(cotHistoriqueStore, (s) => s.marche);
  const mode = useStore(cotHistoriqueStore, (s) => s.mode);
  const serie = useStore(cotHistoriqueStore, (s) => s.serie);
  const ts = useStore(cotHistoriqueStore, (s) => s.ts);
  const enCours = useStore(cotHistoriqueStore, (s) => s.enCours);
  const erreur = useStore(cotHistoriqueStore, (s) => s.erreur);
  const nonCouvert = useStore(cotHistoriqueStore, (s) => s.nonCouvert);

  const [unite, setUnite] = useState<UniteCot>("contrats");
  const [periode, setPeriode] = useState<string | null>(PERIODE_DEFAUT);
  const [masquees, setMasquees] = useState<ReadonlySet<string>>(() => new Set());
  const [survol, setSurvol] = useState<{ index: number; xPix: number; largeur: number } | null>(null);

  // Chargement au montage (garde StrictMode : `charger` pose `enCours` avant son premier await)
  // et suivi hebdomadaire tant que l'onglet est affiché.
  useEffect(() => {
    const s = cotHistoriqueStore.getState();
    if (!s.enCours) void s.charger();
    return s.activerSuivi();
  }, []);

  const instrument = instrumentCot(marche);
  const categories = serie !== null ? CATEGORIES_GRAPHE[serie.dataset] : [];
  const visibles = useMemo(
    () =>
      serie === null
        ? []
        : CATEGORIES_GRAPHE[serie.dataset]
            .map((c, i) => ({ c, i }))
            .filter(({ c, i }) => serie.disponibles[i] === true && !masquees.has(c.id))
            .map(({ i }) => i),
    [serie, masquees],
  );

  const bornes = useMemo<Domaine | null>(() => {
    const premier = serie?.points[0];
    const dernier = serie?.points.at(-1);
    if (premier === undefined || dernier === undefined) return null;
    return premier.t === dernier.t
      ? { min: premier.t - SEMAINE_MS, max: dernier.t + SEMAINE_MS }
      : { min: premier.t, max: dernier.t };
  }, [serie]);

  const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornes, () => setPeriode(null), MARGES);

  // Préréglage de période : appliqué à chaque nouvelle série (après la remise à zéro du hook).
  useEffect(() => {
    if (bornes === null || periode === null) return;
    const p = PERIODES_COT.find((x) => x.id === periode);
    setDomaine(domainePourPreset(bornes, p?.jours ?? null));
  }, [bornes?.min, bornes?.max, periode]);

  // Dessin : nouvelle série, catégories, unité, plage, curseur ; et au redimensionnement.
  const survolIndex = survol?.index ?? null;
  useEffect(() => {
    const canvas = refCanvas.current;
    if (canvas === null || serie === null || domaine === null) return;
    const redraw = (): void => dessiner(canvas, { serie, visibles, unite, domaine, survol: survolIndex });
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [serie, visibles, unite, domaine, survolIndex]);

  const surPointeur = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (serie === null || domaine === null || serie.points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const g = geometrie(rect.width, rect.height);
    const mx = e.clientX - rect.left;
    if (mx < g.left || mx > g.right) {
      setSurvol(null);
      return;
    }
    const index = indexPlusProche(serie.points, pixelVersValeur(domaine, mx - g.left, g.plotW));
    const p = serie.points[index];
    if (p === undefined || p.t < domaine.min || p.t > domaine.max) {
      setSurvol(null);
      return;
    }
    setSurvol({ index, xPix: xDe(g, domaine, p.t), largeur: rect.width });
  };

  const basculer = (id: string): void =>
    setMasquees((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  const dataset = serie?.dataset ?? null;
  const coherence = useMemo(() => (serie === null ? null : bilanCoherence(serie)), [serie]);
  const absentes = serie === null ? [] : categories.filter((_, i) => serie.disponibles[i] !== true);
  const pointSurvol = survol === null || serie === null ? undefined : serie.points[survol.index];

  const controles = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Marché"
        value={marche}
        onChange={(e) => void cotHistoriqueStore.getState().selectionner(e.target.value)}
        className="max-w-[14rem]"
      >
        {CATEGORIES_COT.map((famille) => (
          <optgroup key={famille.id} label={famille.libelle}>
            {WATCHLIST_COT.filter((i) => i.categorie === famille.id).map((i) => (
              <option key={i.nom} value={i.nom}>
                {i.libelle}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <SegmenteCompact<ModeRapportGraphe>
        ariaLabel="Rapport CFTC"
        options={[
          { id: "detaille", label: "Détaillé", title: "TFF pour les financiers, Disaggregated pour les matières premières" },
          { id: "legacy", label: "Legacy", title: "Commerciaux / non-commerciaux / non déclarants" },
        ]}
        actif={mode}
        onChange={(m) => void cotHistoriqueStore.getState().setMode(m)}
      />
      <SegmenteCompact<UniteCot>
        ariaLabel="Unité"
        options={[
          { id: "contrats", label: "Contrats", title: "Net en nombre de contrats" },
          { id: "pctOi", label: "% OI", title: "Net en % de l'open interest total du marché" },
        ]}
        actif={unite}
        onChange={setUnite}
      />
      <SegmenteCompact<string>
        ariaLabel="Période"
        options={PERIODES_COT.map((p) => ({ id: p.id, label: p.label }))}
        actif={periode ?? ""}
        onChange={setPeriode}
      />
    </div>
  );

  let corps: ReactNode;
  if (nonCouvert) {
    corps = (
      <Vide>
        {instrument?.libelle ?? marche} n'apparaît pas dans le rapport{" "}
        {LIBELLE_RAPPORT[datasetGraphe(instrument?.categorie ?? "fx", mode)]}.
        {mode === "detaille" ? " Essayez le rapport Legacy." : ""}
      </Vide>
    );
  } else if (serie === null || serie.points.length === 0) {
    corps = enCours ? (
      <Chargement libelle="Lecture de l'historique CFTC…" />
    ) : erreur !== null ? (
      <ErreurBloc>{erreur}</ErreurBloc>
    ) : (
      <Chargement />
    );
  } else {
    corps = (
      <>
        <StatutPublication serie={serie} ts={ts} enCours={enCours} />
        {erreur !== null && <ErreurBloc>{erreur}</ErreurBloc>}
        <div className="relative h-[300px]">
          <canvas
            ref={refCanvas}
            role="img"
            aria-label={`Exposition nette par catégorie de traders, ${instrument?.libelle ?? marche}, ${serie.points.length} rapports du ${formatDateComplete(serie.points[0]!.t)} au ${formatDateComplete(serie.points.at(-1)!.t)}`}
            onPointerDown={surPointeur}
            onPointerMove={surPointeur}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setSurvol(null);
            }}
            className="h-full w-full cursor-crosshair"
          />
          {survol !== null && pointSurvol !== undefined && (
            <Infobulle
              xPix={survol.xPix}
              largeur={survol.largeur}
              enfants={
                <>
                  <div className="text-text-dim">Positions du {formatDateComplete(pointSurvol.t)}</div>
                  {visibles.map((i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Echantillon cat={categories[i]!} index={i} />
                      <span className="min-w-0 flex-1 truncate">{categories[i]!.court}</span>
                      <span>{formatValeurCot(valeurCot(pointSurvol, i, unite), unite)}</span>
                    </div>
                  ))}
                  <div className="mt-0.5 flex justify-between text-text-dim">
                    <span>Open interest</span>
                    <span>{formatEntier(Number.isFinite(pointSurvol.oi) ? pointSurvol.oi : null)}</span>
                  </div>
                </>
              }
            />
          )}
        </div>
        <TableauExposition serie={serie} unite={unite} masquees={masquees} basculer={basculer} />
        <details className="text-[11px] text-text-dim">
          <summary className="cursor-pointer select-none text-text">Qui sont ces catégories ?</summary>
          <dl className="mt-1 space-y-1">
            {categories.map((c) => (
              <div key={c.id}>
                <dt className="inline font-medium text-text">{c.libelle} : </dt>
                <dd className="inline">{c.description}</dd>
              </div>
            ))}
          </dl>
        </details>
        <NoteSource>
          Exposition = net (longs − shorts) de chaque catégorie{unite === "pctOi" ? ", en % de l'open interest total du marché" : ", en contrats"}.
          Positions du mardi publiées le vendredi par la CFTC (rapport{" "}
          {dataset !== null ? LIBELLE_RAPPORT[dataset] : ""}, futures seuls). Une ligne interrompue = rapport absent.
          Couverture et arbitrage comptent comme des positions : ce n'est pas une prévision de prix.
          Molette = zoom, glisser = déplacer, double-clic = tout l'historique.
        </NoteSource>
        <NoteSource>
          {coherence === null || coherence.controles === 0 ? (
            <>Contrôle Σ des nets = 0 indisponible (catégorie absente).</>
          ) : coherence.ecarts === 0 ? (
            <>Contrôle : la somme des nets de toutes les catégories vaut 0 sur les {formatEntier(coherence.controles)} rapports.</>
          ) : (
            <Badge ton="warn" title="Une colonne CFTC a peut-être changé de nom ou de sens.">
              Σ des nets ≠ 0 sur {coherence.ecarts}/{coherence.controles} rapports (dernier : {formatDateComplete(coherence.dernierEcart ?? 0)})
            </Badge>
          )}
          {absentes.length > 0 && <> · Absente(s) de la réponse CFTC : {absentes.map((c) => c.libelle).join(", ")}.</>}
        </NoteSource>
      </>
    );
  }

  return (
    <div className="space-y-3 px-3 py-3">
      {controles}
      {corps}
    </div>
  );
}
