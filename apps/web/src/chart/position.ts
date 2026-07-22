/**
 * Outil POSITION — entrée / stop / cible dessinés sur le graphe, avec R:R et
 * taille de position calculée à partir du capital de référence (store/risque).
 *
 * Overlay CUSTOM à 3 points (`registerOverlay`, même famille que « rect » /
 * fibCustom / VPFR), branché dans TOOL_OVERLAY (chart/drawing.ts) : il passe donc
 * par `createTrackedOverlay` et hérite GRATUITEMENT de la persistance par
 * « exchange:symbole », du rejeu après backfill, du clic droit = supprimer et de
 * la touche Suppr. Aucune persistance parallèle.
 *
 * SENS DÉDUIT DE LA GÉOMÉTRIE (stop sous l'entrée = long, au-dessus = short) : un
 * seul outil, jamais d'état contradictoire « long avec stop au-dessus ». Les trois
 * prix sont POSÉS, jamais dérivés d'un ratio global — un setup 2R et un setup 3R
 * coexistent, et le modèle de persistance ne stocke que des points.
 *
 * Rien n'est exécuté : c'est un outil de LECTURE du risque, pas un passage d'ordre.
 */
import { registerOverlay } from "klinecharts";
import type { OverlayFigure, OverlayFigureIgnoreEventType } from "klinecharts";
import { lireTokenCanvas, rgbaTokenCanvas } from "../lib/canvasTokens";
import { risqueStore } from "../store/risque";
import { formatPrice, formatUsd } from "../lib/format";

/** Nom du template d'overlay (référencé par TOOL_OVERLAY). */
export const POSITION_NAME = "position";

/** Zones de risque/gain : transparentes aux mouvements (crosshair + pan préservés). */
const IGNORE_MOVE: OverlayFigureIgnoreEventType[] = ["mouseMoveEvent", "touchMoveEvent"];

/** Sens d'un setup, déduit de la position du stop par rapport à l'entrée. */
export type SensPosition = "long" | "short";

/** Géométrie d'un setup : sens, risque et gain par unité, ratio R:R. */
export interface Position {
  sens: SensPosition;
  entree: number;
  stop: number;
  cible: number;
  /** |entrée − stop|, toujours > 0. */
  risqueParUnite: number;
  /** Gain par unité SIGNÉ dans le sens du trade (négatif = cible du mauvais côté). */
  gainParUnite: number;
  /** gainParUnite / risqueParUnite. */
  ratio: number;
}

/**
 * Calcule la géométrie d'un setup. Null si un prix n'est pas fini ou si l'entrée
 * et le stop sont confondus (risque nul → R:R infini, setup non dimensionnable).
 *
 * Un ratio NÉGATIF (cible du mauvais côté de l'entrée) n'est PAS masqué : le
 * trader doit voir son incohérence, pas recevoir un null silencieux. PURE.
 */
export function calculerPosition(entree: number, stop: number, cible: number): Position | null {
  if (!Number.isFinite(entree) || !Number.isFinite(stop) || !Number.isFinite(cible)) return null;
  const risqueParUnite = Math.abs(entree - stop);
  if (risqueParUnite === 0) return null;
  const sens: SensPosition = stop < entree ? "long" : "short";
  const gainParUnite = sens === "long" ? cible - entree : entree - cible;
  return {
    sens,
    entree,
    stop,
    cible,
    risqueParUnite,
    gainParUnite,
    ratio: gainParUnite / risqueParUnite,
  };
}

/** Dimensionnement d'une position pour un risque toléré donné. */
export interface TaillePosition {
  /** Montant risqué si le stop est touché, en USD. */
  risqueUsd: number;
  /** Nombre d'unités (base) à prendre. */
  unites: number;
  /** Valeur notionnelle de la position, en USD. */
  notionnelUsd: number;
}

/**
 * Taille de position pour `risquePct` % de `capital`, sachant le risque par unité
 * et le prix d'entrée. Null si le capital n'est pas paramétré, si le risque par
 * unité est nul, ou sur toute entrée non finie / non positive.
 *
 * On ne suppose JAMAIS un capital par défaut : afficher une taille calculée sur un
 * capital inventé serait pire que ne rien afficher. PURE.
 */
export function taillePosition(
  capital: number | null,
  risquePct: number,
  risqueParUnite: number,
  prixEntree: number,
): TaillePosition | null {
  if (capital === null || !Number.isFinite(capital) || capital <= 0) return null;
  if (!Number.isFinite(risquePct) || risquePct <= 0) return null;
  if (!Number.isFinite(risqueParUnite) || risqueParUnite <= 0) return null;
  if (!Number.isFinite(prixEntree) || prixEntree <= 0) return null;
  const risqueUsd = (capital * risquePct) / 100;
  const unites = risqueUsd / risqueParUnite;
  return { risqueUsd, unites, notionnelUsd: unites * prixEntree };
}

/** « R:R 2.00 » — signe typographique « − » comme le reste du terminal. PURE. */
export function formaterRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "R:R —";
  const signe = ratio < 0 ? "−" : "";
  return `R:R ${signe}${Math.abs(ratio).toFixed(2)}`;
}

// ───────────────────────── Overlay klinecharts ─────────────────────────

/** Étiquette compacte du setup : sens, R:R, puis taille si le capital est paramétré. */
function etiquette(pos: Position): string {
  const base = `${pos.sens === "long" ? "LONG" : "SHORT"}  ${formaterRatio(pos.ratio)}`;
  const { capital, risquePct } = risqueStore.getState();
  const t = taillePosition(capital, risquePct, pos.risqueParUnite, pos.entree);
  // Capital non paramétré : on le DIT, on n'invente pas de taille (même discipline
  // que « réf. en construction » pour les référentiels historiques).
  if (t === null) return `${base}  ·  capital non paramétré`;
  return `${base}  ·  ${formatUsd(t.notionnelUsd)}  (risque ${formatUsd(t.risqueUsd)})`;
}

let positionOverlayRegistered = false;

/**
 * Enregistre le template « position » (idempotent, pattern registerRectOverlay).
 * Couleurs et taille lues AU RENDU : thème-aware, et le dimensionnement suit le
 * store risque sans recalcul manuel (cf. redrawPositionOverlays pour le trigger).
 */
function registerPositionOverlay(): void {
  if (positionOverlayRegistered) return;
  positionOverlayRegistered = true;
  registerOverlay({
    name: POSITION_NAME,
    totalStep: 4, // 3 points à poser : entrée, stop, cible
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const cEntree = coordinates[0];
      const cStop = coordinates[1];
      const cCible = coordinates[2];
      if (cEntree === undefined || cStop === undefined) return [];

      const pEntree = overlay.points[0]?.value;
      const pStop = overlay.points[1]?.value;
      const pCible = overlay.points[2]?.value;
      if (typeof pEntree !== "number" || typeof pStop !== "number") return [];

      // Emprise horizontale : du premier au dernier point posé (le tracé s'étend
      // au fil des clics, sans jamais s'inverser).
      const xs = [cEntree.x, cStop.x, ...(cCible ? [cCible.x] : [])];
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);

      const rouge = lireTokenCanvas("--down", "#ef4444");
      const vert = lireTokenCanvas("--up", "#22c55e");
      const texte = lireTokenCanvas("--text", "#e5e7eb");

      const zone = (yA: number, yB: number, couleur: string, fill: string): OverlayFigure => ({
        type: "polygon",
        // Comme le rect / les zones fib : un fill qui capte le mouseMove casserait
        // le crosshair et le pan sous le dessin.
        ignoreEvent: IGNORE_MOVE,
        attrs: {
          coordinates: [
            { x: xMin, y: yA },
            { x: xMax, y: yA },
            { x: xMax, y: yB },
            { x: xMin, y: yB },
          ],
        },
        styles: { style: "stroke_fill", color: fill, borderColor: couleur, borderSize: 1 },
      });

      const figures: OverlayFigure[] = [
        // Zone de RISQUE : entrée → stop, toujours présente dès le 2e point.
        zone(cEntree.y, cStop.y, rouge, rgbaTokenCanvas("--down", 0.14, "#ef4444")),
      ];

      // Zone de GAIN : seulement une fois la cible posée.
      if (cCible !== undefined) {
        figures.push(zone(cEntree.y, cCible.y, vert, rgbaTokenCanvas("--up", 0.14, "#22c55e")));
      }

      // Ligne d'entrée : le repère le plus lu, tracé par-dessus les deux zones.
      figures.push({
        type: "line",
        ignoreEvent: true,
        attrs: { coordinates: [{ x: xMin, y: cEntree.y }, { x: xMax, y: cEntree.y }] },
        styles: { style: "dashed", size: 1, color: texte, dashedValue: [4, 3] },
      });

      // Étiquettes de prix, alignées à droite de l'emprise.
      const prixLabel = (y: number, prix: number, couleur: string, prefixe: string): OverlayFigure => ({
        type: "text",
        ignoreEvent: true,
        attrs: { x: xMax + 4, y, text: `${prefixe} ${formatPrice(prix)}`, align: "left", baseline: "middle" },
        styles: { color: couleur, size: 10 },
      });
      figures.push(prixLabel(cEntree.y, pEntree, texte, "E"));
      figures.push(prixLabel(cStop.y, pStop, rouge, "SL"));
      if (cCible !== undefined && typeof pCible === "number") {
        figures.push(prixLabel(cCible.y, pCible, vert, "TP"));
      }

      // Synthèse (sens, R:R, taille) au-dessus de l'emprise — uniquement quand le
      // setup est complet ET dimensionnable.
      const pos =
        typeof pCible === "number" ? calculerPosition(pEntree, pStop, pCible) : null;
      if (pos !== null) {
        // Ancrée au-dessus de la CIBLE, mais BORNÉE au pane visible : dès qu'on
        // dézoome, la cible sort de l'écran et l'étiquette — l'information la plus
        // utile du dessin — disparaîtrait avec elle.
        const yHaut = Math.min(cEntree.y, cStop.y, cCible?.y ?? cEntree.y) - 4;
        figures.push({
          type: "text",
          ignoreEvent: true,
          attrs: {
            x: xMin,
            // 24 px de marge haute : sous le bandeau de lecture du graphe (readout
            // HTML superposé au canvas), qui occupe le tout premier bandeau du pane.
            y: Math.min(Math.max(yHaut, 24), Math.max(bounding.height - 4, 24)),
            text: etiquette(pos),
            align: "left",
            baseline: "bottom",
          },
          styles: { color: pos.ratio >= 1 ? vert : texte, size: 11 },
        });
      }

      return figures;
    },
  });
}
registerPositionOverlay();

/**
 * Force le re-rendu des overlays position sur les instances fournies (appelé quand
 * le store risque change : capital / risque %). Même mécanique que
 * `redrawFibOverlays` — `extendData` qui change garantit un redraw effectif, et
 * `createPointFigures` relit alors le store.
 */
export function redrawPositionOverlays(
  charts: Iterable<{ overrideOverlay: (o: { name: string; extendData: number }) => void }>,
  rev: number,
): void {
  for (const chart of charts) chart.overrideOverlay({ name: POSITION_NAME, extendData: rev });
}
