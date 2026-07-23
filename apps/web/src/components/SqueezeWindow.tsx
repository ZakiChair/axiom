/**
 * Fenêtre « SQZ » — Radar de squeeze : nuage de points funding × ΔOI de l'univers
 * Signaux, dans un plan à quatre quadrants (cf. data/squeeze.ts). Chaque bulle = un
 * symbole ; rayon ∝ volume 24 h ; couleur par quadrant (carburant-squeeze = up,
 * longs-crowded = down, reste = série/gris). Survol → infobulle ; clic → navigation du
 * chart maître vers le symbole. Un run à l'ouverture (pas de polling) + bouton Rafraîchir.
 *
 * Suit le pattern canvas des fenêtres analytiques (CorrWindow/SeasonalityWindow) : dessin
 * en CSS px sous `setTransform(dpr,…)`, ResizeObserver pour la réactivité, couleurs par
 * tokens (`lireTokenCanvas`/`rgbaTokenCanvas`). L'état de données vit dans `squeezeStore`
 * (vanilla) ; seuls le survol et la fraîcheur sont locaux à React. La projection
 * données→pixels est PURE (squeezeWindow.util.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { squeezeStore } from "../store/squeeze";
import { marketStore } from "../store/market";
import { screenerStore } from "../store/screener";
import { BUILTIN_PRESETS } from "../data/screener";
import { navigateTo } from "../lib/navigation";
import {
  plusProchePoint,
  rayonPoint,
  SEUIL_DOI_PCT,
  SEUIL_FUNDING_PCT,
  type PointRadar,
  type QuadrantSqueeze,
} from "../data/squeeze";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { formatPct, formatUsd } from "../lib/format";
import { Chargement, EnTeteFenetre, ErreurBloc, Fraicheur, NoteSource, Vide } from "./ui";
import {
  domaineAxesRobuste,
  estEcrete,
  genTicks,
  placerLabels,
  projeterEnPixels,
  scoreSqueeze,
  type DomaineAxes,
  type PointPixel,
} from "./squeezeWindow.util";

// ─────────────────────────── Constantes de rendu ───────────────────────────

/** Marge intérieure du canvas (px CSS) : loge bulles RAYON_MAX + graduations d'axes. */
const PAD = 40;
/** Rayon de capture du survol (px), aligné sur le cahier des charges. */
const CAPTURE = 12;
/** Nombre de symboles étiquetés (les plus intenses au sens scoreSqueeze). */
const NB_LABELS = 8;
/** Taille max estimée de l'infobulle (px CSS) : sert à la retourner près des bords. */
const TOOLTIP_W = 170;
const TOOLTIP_H = 56;
/** Largeur du panneau « Top candidats » (px). */
const PANNEAU_W = 190;
/** Sous cette largeur de conteneur (px), le panneau se replie (canvas seul). */
const SEUIL_PANNEAU_PX = 520;
/** Score maximal de `scoreSqueeze` (point plaqué au coin) : normalise les barres. */
const SCORE_MAX = Math.SQRT2;

/**
 * Pont EQS : chaque étiquette de coin cliquable charge le preset SCÉNARIO screener du
 * même quadrant (spec v1.5 §1) : carburant-squeeze (funding<0 & OI↑) ↔ « ▲ Long
 * potentiel » ; longs-crowded (funding>0 & OI↑) ↔ « ▼ Short potentiel ». Ces presets
 * vivent sur main (branche eqs-presets-scenario mergée) ; la garde d'absence ci-dessous
 * couvre un checkout qui ne les aurait pas encore.
 */
const PRESET_EQS: Record<"carburant" | "longs", string> = {
  carburant: "builtin:long-potentiel",
  longs: "builtin:short-potentiel",
};

/** Libellés FR lisibles des quadrants (infobulle + étiquettes de coin). */
const LABEL_QUADRANT: Record<QuadrantSqueeze, string> = {
  "carburant-squeeze": "Carburant squeeze",
  "longs-crowded": "Longs crowded",
  "shorts-crowded": "Shorts crowded",
  deleveraging: "Déleveraging",
  neutre: "Neutre",
};

/**
 * Couleur par quadrant : token CSS (thème courant) + repli hex (valeurs Dark d'index.css,
 * contexte sans DOM). Cinq teintes distinctes — carburant-squeeze en vert « up », les deux
 * crowded en rouge/bleu, deleveraging en ambre, neutre en gris dim. Partagé par le canvas
 * (rgbaTokenCanvas) et la légende (var(--token) en CSS).
 */
const COULEUR_QUADRANT: Record<QuadrantSqueeze, { token: string; repli: string }> = {
  "carburant-squeeze": { token: "--up", repli: "#2dc08e" },
  "longs-crowded": { token: "--down", repli: "#f92855" },
  "shorts-crowded": { token: "--accent", repli: "#38bdf8" },
  deleveraging: { token: "--serie-3", repli: "#f59e0b" },
  neutre: { token: "--text-dim", repli: "#9ca3af" },
};

/** Ordre d'affichage des pastilles de la légende (mêmes libellés que LABEL_QUADRANT). */
const ORDRE_LEGENDE: QuadrantSqueeze[] = [
  "carburant-squeeze",
  "longs-crowded",
  "shorts-crowded",
  "deleveraging",
  "neutre",
];

/** Légende chromatique fine sous le canvas : 5 pastilles rondes + libellés (10px). */
function LegendeQuadrants() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim">
      {ORDRE_LEGENDE.map((q) => (
        <span key={q} className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: `var(${COULEUR_QUADRANT[q].token})` }}
          />
          {LABEL_QUADRANT[q]}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────── Panneau « Top candidats » ───────────────────────────

/** Rectangle de hit-test (CSS px) d'une étiquette de coin cliquable. */
interface RectEqs {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** (x, y) est-il dans le rectangle `r` ? */
function dansRect(x: number, y: number, r: RectEqs | undefined): boolean {
  return r !== undefined && x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
}

/** Classe Tailwind de teinte d'une valeur signée (up positif, down négatif, dim nul). */
function teinteSigne(v: number): string {
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-text-dim";
}

/** Top `n` points d'une sélection, classés par intensité de squeeze décroissante. */
function topParScore(pts: readonly PointRadar[], domaine: DomaineAxes, n: number): PointRadar[] {
  return [...pts].sort((a, b) => scoreSqueeze(b, domaine) - scoreSqueeze(a, domaine)).slice(0, n);
}

/** Une ligne candidate : symbole + funding/ΔOI teintés + barre de score (token du quadrant). */
function LigneCandidat({ p, domaine, onPick }: { p: PointRadar; domaine: DomaineAxes; onPick: (symbol: string) => void }) {
  const { token } = COULEUR_QUADRANT[p.quadrant];
  const frac = Math.min(1, scoreSqueeze(p, domaine) / SCORE_MAX);
  return (
    <button
      type="button"
      onClick={() => onPick(p.symbol)}
      className="block w-full rounded px-1 py-1 text-left transition hover:bg-bg"
    >
      <div className="flex items-baseline justify-between gap-1 text-[10px] tabular-nums">
        <span className="truncate font-medium text-text">{p.symbol}</span>
        <span className="flex shrink-0 gap-1">
          <span className={teinteSigne(p.fundingPct)}>{formatPct(p.fundingPct, 3)}</span>
          <span className={teinteSigne(p.dOiPct)}>{formatPct(p.dOiPct)}</span>
        </span>
      </div>
      <div className="mt-0.5 h-0.5" style={{ width: `${frac * 100}%`, backgroundColor: `var(${token})` }} />
    </button>
  );
}

/** Un groupe titré (couleur du quadrant pour les deux corners, dim pour « Autres »). */
function GroupeCandidats({
  titre,
  couleurTitre,
  pts,
  domaine,
  onPick,
}: {
  titre: string;
  couleurTitre?: string;
  pts: readonly PointRadar[];
  domaine: DomaineAxes;
  onPick: (symbol: string) => void;
}) {
  if (pts.length === 0) return null;
  return (
    <div>
      <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wide" style={couleurTitre ? { color: couleurTitre } : undefined}>
        <span className={couleurTitre ? "" : "text-text-dim"}>{titre}</span>
      </div>
      {pts.map((p) => (
        <LigneCandidat key={p.symbol} p={p} domaine={domaine} onPick={onPick} />
      ))}
    </div>
  );
}

/**
 * Panneau droit : lecture ordonnée du nuage par intensité de squeeze. Trois groupes —
 * carburant-squeeze (top 5), longs-crowded (top 5), autres quadrants hors neutre (top 3).
 * Clic sur une ligne → chart maître (même intention que le clic bulle).
 */
function PanneauTopCandidats({
  points,
  domaine,
  onPick,
}: {
  points: readonly PointRadar[];
  domaine: DomaineAxes;
  onPick: (symbol: string) => void;
}) {
  const carburant = topParScore(points.filter((p) => p.quadrant === "carburant-squeeze"), domaine, 5);
  const longs = topParScore(points.filter((p) => p.quadrant === "longs-crowded"), domaine, 5);
  const autres = topParScore(
    points.filter((p) => p.quadrant === "shorts-crowded" || p.quadrant === "deleveraging"),
    domaine,
    3,
  );
  const vide = carburant.length === 0 && longs.length === 0 && autres.length === 0;
  return (
    <div className="flex flex-col gap-2 text-[10px]">
      {vide ? (
        <div className="text-[10px] text-text-dim">Aucun candidat hors zone neutre.</div>
      ) : (
        <>
          <GroupeCandidats
            titre={LABEL_QUADRANT["carburant-squeeze"]}
            couleurTitre={`var(${COULEUR_QUADRANT["carburant-squeeze"].token})`}
            pts={carburant}
            domaine={domaine}
            onPick={onPick}
          />
          <GroupeCandidats
            titre={LABEL_QUADRANT["longs-crowded"]}
            couleurTitre={`var(${COULEUR_QUADRANT["longs-crowded"].token})`}
            pts={longs}
            domaine={domaine}
            onPick={onPick}
          />
          <GroupeCandidats titre="Autres" pts={autres} domaine={domaine} onPick={onPick} />
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Composant ───────────────────────────

export function SqueezeWindow() {
  const points = useStore(squeezeStore, (s) => s.points);
  const enCours = useStore(squeezeStore, (s) => s.enCours);
  const couverture = useStore(squeezeStore, (s) => s.couverture);
  const erreur = useStore(squeezeStore, (s) => s.erreur);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: PointRadar } | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Projection courante partagée entre le dessin et le hit-testing (même repère CSS px).
  const projRef = useRef<PointPixel[]>([]);
  // Rectangles des deux étiquettes de coin cliquables (pont EQS), mesurés au dessin.
  const libellesEqsRef = useRef<{ carburant: RectEqs; longs: RectEqs } | null>(null);
  // Étiquette de coin survolée (soulignée) — hors state React : lue par le dessin, écrite au survol.
  const hoverEqsRef = useRef<"carburant" | "longs" | null>(null);
  // Fonction de dessin courante, exposée pour un redraw léger au survol des libellés EQS.
  const dessinerRef = useRef<(() => void) | null>(null);

  // Conteneur flex (canvas + panneau) : le panneau se replie sous SEUIL_PANNEAU_PX.
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const [largeurConteneur, setLargeurConteneur] = useState<number | null>(null);
  const afficherPanneau = largeurConteneur !== null && largeurConteneur >= SEUIL_PANNEAU_PX;

  // Domaine robuste partagé par le classement du panneau (le canvas le recalcule au dessin).
  const domaine = useMemo(() => domaineAxesRobuste(points), [points]);

  // Run auto au PREMIER open (FloatingWindow ne monte l'enfant que si ouvert). Le store
  // n'a pas de setter `open` : on le pose ici. La garde !enCours && rien-encore évite un
  // double run (StrictMode : run() passe enCours:true avant son premier await).
  useEffect(() => {
    squeezeStore.setState({ open: true });
    const s = squeezeStore.getState();
    if (!s.enCours && s.points.length === 0 && s.erreur === null && s.couverture === "") {
      void s.run();
    }
    return () => squeezeStore.setState({ open: false });
  }, []);

  // Horodatage de fraîcheur : marqué à la fin de chaque run (transition enCours true→false).
  const enCoursPrec = useRef(enCours);
  useEffect(() => {
    if (enCoursPrec.current && !enCours) setMajTs(Date.now());
    enCoursPrec.current = enCours;
  }, [enCours]);

  // Largeur du conteneur → repli du panneau. ResizeObserver sur le conteneur flex (sa
  // largeur est stable que le panneau soit affiché ou non : pas d'oscillation).
  useEffect(() => {
    const el = conteneurRef.current;
    if (el === null) return;
    const maj = (): void => setLargeurConteneur(el.clientWidth);
    maj();
    const ro = new ResizeObserver(maj);
    ro.observe(el);
    return () => ro.disconnect();
  }, [points]);

  // Dessin du nuage (canvas) — redessine sur nouveaux points et au redimensionnement.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const dessiner = (): void => {
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

      // Tokens (lus au dessin : suit le thème courant).
      const dim = lireTokenCanvas("--text-dim", "#94a3b8");
      const texte = lireTokenCanvas("--text", "#e5e7eb");
      const border = lireTokenCanvas("--border", "#262626");

      const domaine = domaineAxesRobuste(points);
      // Pixel de l'origine (funding=0, ΔOI=0) via la MÊME projection que les points :
      // garantit que les lignes de quadrant coïncident avec le repère des bulles.
      const [origine] = projeterEnPixels([{ fundingPct: 0, dOiPct: 0 }], domaine, w, h, PAD);
      const cx = origine?.x ?? w / 2;
      const cy = origine?.y ?? h / 2;

      // Zone neutre : rect [±SEUIL_FUNDING] × [±SEUIL_DOI] PROJETÉ (mêmes coins que les
      // bulles) — fond très discret + libellé, pour situer le seuil de « bruit ».
      const [coinHG, coinBD] = projeterEnPixels(
        [
          { fundingPct: -SEUIL_FUNDING_PCT, dOiPct: SEUIL_DOI_PCT },
          { fundingPct: SEUIL_FUNDING_PCT, dOiPct: -SEUIL_DOI_PCT },
        ],
        domaine,
        w,
        h,
        PAD,
      );
      if (coinHG !== undefined && coinBD !== undefined) {
        ctx.fillStyle = rgbaTokenCanvas("--text-dim", 0.06, "#9ca3af");
        ctx.fillRect(coinHG.x, coinHG.y, coinBD.x - coinHG.x, coinBD.y - coinHG.y);
        ctx.fillStyle = dim;
        ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("neutre", (coinHG.x + coinBD.x) / 2, (coinHG.y + coinBD.y) / 2);
      }

      // Lignes de quadrant en pointillé (axes x=0 et y=0) + cadre discret.
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD, PAD, w - 2 * PAD, h - 2 * PAD);
      ctx.save();
      ctx.strokeStyle = dim;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, PAD);
      ctx.lineTo(cx, h - PAD);
      ctx.moveTo(PAD, cy);
      ctx.lineTo(w - PAD, cy);
      ctx.stroke();
      ctx.restore();

      // Graduations « rondes » (genTicks) : funding sous le cadre, ΔOI à gauche, projetées
      // par la MÊME projection que les bulles. Titres d'axes aux extrémités.
      ctx.fillStyle = dim;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const t of genTicks(-domaine.fMax, domaine.fMax, 5)) {
        const [px] = projeterEnPixels([{ fundingPct: t, dOiPct: 0 }], domaine, w, h, PAD);
        if (px !== undefined) ctx.fillText(formatPct(t, 2), px.x, h - PAD + 4);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const t of genTicks(-domaine.oMax, domaine.oMax, 5)) {
        const [px] = projeterEnPixels([{ fundingPct: 0, dOiPct: t }], domaine, w, h, PAD);
        if (px !== undefined) ctx.fillText(formatPct(t, 2), PAD - 4, px.y);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("funding %/8 h", w / 2, h - 3);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("ΔOI %", 2, 2);

      // Étiquettes de quadrant dans les quatre coins (ΔOI+ en haut ; funding+ à droite).
      // Les deux coins « haut » (carburant-squeeze, longs-crowded) sont CLIQUABLES (pont EQS) :
      // teintés du token de leur quadrant, soulignés au survol, et leurs rects mémorisés.
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      const HAUT_LABEL = 10;
      const coulCarb = lireTokenCanvas(COULEUR_QUADRANT["carburant-squeeze"].token, COULEUR_QUADRANT["carburant-squeeze"].repli);
      const coulLongs = lireTokenCanvas(COULEUR_QUADRANT["longs-crowded"].token, COULEUR_QUADRANT["longs-crowded"].repli);
      const txtCarb = LABEL_QUADRANT["carburant-squeeze"];
      const txtLongs = LABEL_QUADRANT["longs-crowded"];
      const wCarb = ctx.measureText(txtCarb).width;
      const wLongs = ctx.measureText(txtLongs).width;
      const rectCarb: RectEqs = { x1: PAD + 4, y1: PAD + 3, x2: PAD + 4 + wCarb, y2: PAD + 3 + HAUT_LABEL };
      const rectLongs: RectEqs = { x1: w - PAD - 4 - wLongs, y1: PAD + 3, x2: w - PAD - 4, y2: PAD + 3 + HAUT_LABEL };
      libellesEqsRef.current = { carburant: rectCarb, longs: rectLongs };

      ctx.textBaseline = "top";
      ctx.fillStyle = coulCarb;
      ctx.textAlign = "left";
      ctx.fillText(txtCarb, PAD + 4, PAD + 3);
      ctx.fillStyle = coulLongs;
      ctx.textAlign = "right";
      ctx.fillText(txtLongs, w - PAD - 4, PAD + 3);
      // Soulignement de l'étiquette survolée (affordance de clic).
      if (hoverEqsRef.current !== null) {
        const r = hoverEqsRef.current === "carburant" ? rectCarb : rectLongs;
        ctx.strokeStyle = hoverEqsRef.current === "carburant" ? coulCarb : coulLongs;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x1, r.y2);
        ctx.lineTo(r.x2, r.y2);
        ctx.stroke();
      }
      // Coins « bas » (non cliquables) : dim.
      ctx.fillStyle = dim;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "right";
      ctx.fillText(LABEL_QUADRANT.deleveraging, w - PAD - 4, h - PAD - 3);
      ctx.textAlign = "left";
      ctx.fillText(LABEL_QUADRANT["shorts-crowded"], PAD + 4, h - PAD - 3);

      // Projection : points ÉCRÊTÉS plaqués au bord (clamp AVANT projection). projRef partage
      // ces positions clampées → le hit-test vise la bulle telle que dessinée (l'infobulle
      // lit points[idx], donc affiche la vraie valeur hors échelle, pas la clampée).
      const pointsClampes = points.map((p) => ({
        fundingPct: Math.min(domaine.fMax, Math.max(-domaine.fMax, p.fundingPct)),
        dOiPct: Math.min(domaine.oMax, Math.max(-domaine.oMax, p.dOiPct)),
      }));
      const proj = projeterEnPixels(pointsClampes, domaine, w, h, PAD);
      projRef.current = proj;
      const volumeMax = points.reduce((m, p) => Math.max(m, p.volumeUsd24h), 0);

      // Bulles : semi-transparentes, cinq couleurs par quadrant (COULEUR_QUADRANT). Neutre
      // en gris plus effacé (fill 0.25). Un point écrêté porte un second anneau (r+2.5)
      // signalant qu'il est plaqué au bord (valeur hors échelle).
      points.forEach((p, i) => {
        const px = proj[i];
        if (px === undefined) return;
        const r = rayonPoint(p.volumeUsd24h, volumeMax);
        const { token, repli } = COULEUR_QUADRANT[p.quadrant];
        const alphaFill = p.quadrant === "neutre" ? 0.25 : 0.45;
        ctx.beginPath();
        ctx.arc(px.x, px.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbaTokenCanvas(token, alphaFill, repli);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbaTokenCanvas(token, 0.9, repli);
        ctx.stroke();
        if (estEcrete(p, domaine)) {
          ctx.beginPath();
          ctx.arc(px.x, px.y, r + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Étiquettes des NB_LABELS points les plus INTENSES (scoreSqueeze), pas les plus gros
      // volumes : on nomme les candidats de squeeze, pas les mastodontes calmes.
      const topIdx = [...points.keys()]
        .sort((a, b) => scoreSqueeze(points[b]!, domaine) - scoreSqueeze(points[a]!, domaine))
        .slice(0, NB_LABELS);
      ctx.fillStyle = texte;
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      // Candidats ancrés au-dessus de chaque bulle, puis placement anti-collision (marché
      // calme : sans ça les labels s'empilent au centre). Largeur mesurée via le contexte.
      const candidats = topIdx.flatMap((i) => {
        const p = points[i];
        const px = proj[i];
        if (p === undefined || px === undefined) return [];
        const r = rayonPoint(p.volumeUsd24h, volumeMax);
        return [{ x: px.x, y: px.y - r - 2, texte: p.symbol }];
      });
      for (const l of placerLabels(candidats, (t) => ctx.measureText(t).width, w, h)) {
        ctx.fillText(l.texte, l.x, l.y);
      }
    };

    dessinerRef.current = dessiner;
    dessiner();
    const ro = new ResizeObserver(dessiner);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      dessinerRef.current = null;
    };
  }, [points]);

  // Étiquette de coin EQS sous (mx, my), s'il y en a une.
  const libelleEqsSous = (mx: number, my: number): "carburant" | "longs" | null => {
    const libs = libellesEqsRef.current;
    if (libs === null) return null;
    if (dansRect(mx, my, libs.carburant)) return "carburant";
    if (dansRect(mx, my, libs.longs)) return "longs";
    return null;
  };

  // Survol : au dessus d'un libellé EQS → souligne (redraw léger) ; sinon → infobulle du
  // point le plus proche dans le rayon de capture.
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const surLibelle = libelleEqsSous(mx, my);
    if (surLibelle !== hoverEqsRef.current) {
      hoverEqsRef.current = surLibelle;
      dessinerRef.current?.();
    }
    if (surLibelle !== null) {
      setTooltip(null);
      return;
    }
    const idx = plusProchePoint(projRef.current, mx, my, CAPTURE);
    const p = idx >= 0 ? points[idx] : undefined;
    setTooltip(p ? { x: mx, y: my, point: p } : null);
  };

  const onLeave = (): void => {
    if (hoverEqsRef.current !== null) {
      hoverEqsRef.current = null;
      dessinerRef.current?.();
    }
    setTooltip(null);
  };

  // Pont EQS : charge le preset du quadrant, ouvre le screener et lance le run. Garde : si
  // le preset est introuvable dans BUILTIN_PRESETS, on se contente d'ouvrir le screener.
  const ouvrirEqs = (coin: "carburant" | "longs"): void => {
    const presetId = PRESET_EQS[coin];
    const s = screenerStore.getState();
    if (BUILTIN_PRESETS.some((p) => p.id === presetId)) {
      s.loadPreset(presetId);
      s.openScreener();
      s.run();
    } else {
      s.openScreener();
    }
  };

  // Navigue le chart maître vers un symbole (binance, TF courant) — partagé bulle / panneau.
  const ouvrirChart = (symbol: string): void => {
    navigateTo({
      symbol,
      exchange: "binance",
      timeframe: marketStore.getState().timeframe,
      source: "eqs",
    });
  };

  // Clic : hit-test des libellés EQS AVANT les bulles ; sinon navigation du symbole survolé.
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const surLibelle = libelleEqsSous(mx, my);
    if (surLibelle !== null) {
      ouvrirEqs(surLibelle);
      return;
    }
    const idx = plusProchePoint(projRef.current, mx, my, CAPTURE);
    const p = idx >= 0 ? points[idx] : undefined;
    if (p === undefined) return;
    ouvrirChart(p.symbol);
  };

  const rafraichir = (): void => {
    void squeezeStore.getState().run();
  };

  return (
    <>
      <EnTeteFenetre
        mnemo="SQZ"
        titre="Radar de squeeze"
        sousTitre="Funding × ΔOI ~24 h · univers Signaux"
        actions={
          <button
            type="button"
            onClick={rafraichir}
            disabled={enCours}
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↻ Rafraîchir
          </button>
        }
      />

      <div className="flex flex-1 flex-col overflow-hidden px-4 py-4">
        {erreur !== null && points.length === 0 ? (
          <ErreurBloc>{erreur}</ErreurBloc>
        ) : enCours && points.length === 0 ? (
          <Chargement libelle="Collecte funding / ΔOI…" />
        ) : points.length === 0 ? (
          <Vide>Aucun symbole exploitable (funding et ΔOI requis). Réessayez avec Rafraîchir.</Vide>
        ) : (
          <div ref={conteneurRef} className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {/* Refresh non destructif : un nuage valide n'est jamais remplacé par un bloc
                d'erreur ; en cas d'échec du retry, seul un bandeau discret le signale. */}
            {erreur !== null && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 rounded border border-down/40 bg-surface/90 px-2 py-1 text-[10px] text-down">
                {erreur}
              </div>
            )}
            <canvas
              ref={canvasRef}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onClick={onClick}
              className="h-full w-full cursor-pointer"
            />
            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 text-[10px] tabular-nums text-text shadow-lg"
                style={{
                  // Clamp aux bords : bascule à gauche/au-dessus si l'infobulle clipperait
                  // le conteneur overflow-hidden (bord droit / bas).
                  left:
                    tooltip.x + 12 + TOOLTIP_W > (canvasRef.current?.clientWidth ?? Infinity)
                      ? tooltip.x - TOOLTIP_W - 12
                      : tooltip.x + 12,
                  top:
                    tooltip.y + 12 + TOOLTIP_H > (canvasRef.current?.clientHeight ?? Infinity)
                      ? tooltip.y - TOOLTIP_H - 12
                      : tooltip.y + 12,
                }}
              >
                <div className="font-medium">{tooltip.point.symbol}</div>
                <div className="text-text-dim">
                  funding {formatPct(tooltip.point.fundingPct, 4)} · ΔOI {formatPct(tooltip.point.dOiPct)}
                </div>
                <div className="text-text-dim">
                  vol {formatUsd(tooltip.point.volumeUsd24h)} · {LABEL_QUADRANT[tooltip.point.quadrant]}
                </div>
              </div>
            )}
          </div>
          <div className="mt-2">
            <LegendeQuadrants />
          </div>
          </div>
          {afficherPanneau && (
            <div
              className="shrink-0 overflow-y-auto border-l border-border pl-3"
              style={{ width: PANNEAU_W }}
            >
              <PanneauTopCandidats points={points} domaine={domaine} onPick={ouvrirChart} />
            </div>
          )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <NoteSource>
            {couverture || "Nuage funding × ΔOI de l'univers Signaux (perp-based)."} Clic = charger le
            symbole sur le chart.
          </NoteSource>
          <Fraicheur loading={enCours} majTs={majTs} />
        </div>
      </div>
    </>
  );
}
