/**
 * Onglet « Rotation » de CORR — nuage RS-Ratio / RS-Momentum contre BTC (SUG-6 volet 3,
 * chantier du 2026-11-07). Calcul : data/rotationRelative.ts (pur, testé) ; données :
 * cache de séries 1d de corr.ts (aucune source nouvelle).
 *
 * Libellés imposés : « approximation ouverte, pas le RRG® » et « descriptif » (aucune
 * validation prédictive des quadrants). Les actifs non placés sont listés avec leur raison
 * (jamais posés au centre). Clic sur un point (ou une ligne) : graphe du ratio X÷BTC sur
 * l'historique chargé, et bouton d'ouverture du ratio sur le graphe principal.
 */
import { useMemo, useState } from "react";
import {
  courtSymbole,
  exclureJourCourant,
  MAX_JOURS,
  type SerieCloture,
} from "../../data/corr";
import {
  calculerRotation,
  compterQuadrants,
  FENETRE_Z_ROTATION,
  LIBELLES_QUADRANT,
  LONGUEUR_TRAINE,
  OBS_MIN_POINT,
  PAS_MOMENTUM_ROTATION,
  REFERENCE_ROTATION,
  serieRatio,
  type PointRotation,
  type QuadrantRotation,
} from "../../data/rotationRelative";
import { symboleRatio } from "../../data/ratio";
import { resolveTickerSource } from "../../data/ticker";
import { marketStore } from "../../store/market";
import { syntheticsStore } from "../../store/synthetics";
import { watchlistStore } from "../../store/watchlist";
import { formatDec, formatPct } from "../../lib/format";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "../TableTriable";
import { Badge, Bouton, Chargement, ErreurBloc, NoteSource, Vide } from "../ui";
import { BandeauUnivers, dateJourUtc, useSeriesUnivers, type UniversTransversal } from "./communCorr";

/** Couleur (variable CSS du thème) de chaque quadrant. */
const COULEUR_QUADRANT: Record<QuadrantRotation, string> = {
  meneur: "var(--up)",
  affaiblissement: "rgb(var(--ui-amber-rgb))",
  retard: "var(--down)",
  amelioration: "var(--accent)",
  neutre: "var(--text-dim)",
};

/** Ordre d'affichage des quadrants (sens de rotation habituel : horaire). */
const ORDRE_QUADRANTS: readonly QuadrantRotation[] = ["meneur", "affaiblissement", "retard", "amelioration"];

// ─────────────────────────── Géométrie du nuage ───────────────────────────

const L = 400; // largeur du viewBox
const H = 300; // hauteur du viewBox
const MARGE = 22;

/** Demi-étendue des axes : de ±2 à ±4 z, au demi-z, selon les points et traînes. */
function demiEtendue(points: readonly PointRotation[]): number {
  let max = 0;
  for (const p of points) for (const q of p.traine) max = Math.max(max, Math.abs(q.x), Math.abs(q.y));
  return Math.min(4, Math.max(2, Math.ceil(max * 1.1 * 2) / 2));
}

/** Projection (z, z) → pixels du viewBox, coordonnées écrêtées à ±R (drapeau `coupe`). */
function projeter(x: number, y: number, r: number): { px: number; py: number; coupe: boolean } {
  const cx = Math.max(-r, Math.min(r, x));
  const cy = Math.max(-r, Math.min(r, y));
  return {
    px: MARGE + ((cx + r) / (2 * r)) * (L - 2 * MARGE),
    py: H - MARGE - ((cy + r) / (2 * r)) * (H - 2 * MARGE),
    coupe: cx !== x || cy !== y,
  };
}

/** Nuage SVG : quadrants teintés, traînes, têtes cliquables (infobulle native). */
export function NuageRotation({
  points,
  selection,
  onSelection,
}: {
  points: readonly PointRotation[];
  selection: string | null;
  onSelection: (symbole: string | null) => void;
}) {
  const r = demiEtendue(points);
  const centre = projeter(0, 0, r);
  const quadrants: { q: QuadrantRotation; x: number; y: number; ancre: "start" | "end"; dy: number }[] = [
    { q: "amelioration", x: MARGE + 4, y: MARGE + 10, ancre: "start", dy: 0 },
    { q: "meneur", x: L - MARGE - 4, y: MARGE + 10, ancre: "end", dy: 0 },
    { q: "retard", x: MARGE + 4, y: H - MARGE - 6, ancre: "start", dy: 0 },
    { q: "affaiblissement", x: L - MARGE - 4, y: H - MARGE - 6, ancre: "end", dy: 0 },
  ];
  return (
    <svg
      viewBox={`0 0 ${L} ${H}`}
      className="w-full max-w-[560px]"
      role="img"
      aria-label="Nuage de rotation contre BTC : RS-Ratio en abscisse, RS-Momentum en ordonnée"
      onClick={() => onSelection(null)}
    >
      {/* Fonds de quadrants (teinte légère) */}
      <rect x={centre.px} y={MARGE} width={L - MARGE - centre.px} height={centre.py - MARGE} style={{ fill: COULEUR_QUADRANT.meneur }} fillOpacity={0.06} />
      <rect x={centre.px} y={centre.py} width={L - MARGE - centre.px} height={H - MARGE - centre.py} style={{ fill: COULEUR_QUADRANT.affaiblissement }} fillOpacity={0.06} />
      <rect x={MARGE} y={centre.py} width={centre.px - MARGE} height={H - MARGE - centre.py} style={{ fill: COULEUR_QUADRANT.retard }} fillOpacity={0.06} />
      <rect x={MARGE} y={MARGE} width={centre.px - MARGE} height={centre.py - MARGE} style={{ fill: COULEUR_QUADRANT.amelioration }} fillOpacity={0.06} />
      {/* Axes passant par l'origine (0, 0) */}
      <line x1={MARGE} y1={centre.py} x2={L - MARGE} y2={centre.py} style={{ stroke: "var(--border)" }} strokeWidth={1} />
      <line x1={centre.px} y1={MARGE} x2={centre.px} y2={H - MARGE} style={{ stroke: "var(--border)" }} strokeWidth={1} />
      {quadrants.map(({ q, x, y, ancre }) => (
        <text key={q} x={x} y={y} textAnchor={ancre} fontSize={10} style={{ fill: COULEUR_QUADRANT[q] }} fillOpacity={0.85}>
          {LIBELLES_QUADRANT[q]}
        </text>
      ))}
      {/* Graduations extrêmes et titres d'axes */}
      <text x={MARGE} y={H - 6} fontSize={9} style={{ fill: "var(--text-dim)" }}>−{r}</text>
      <text x={L - MARGE} y={H - 6} fontSize={9} textAnchor="end" style={{ fill: "var(--text-dim)" }}>
        RS-Ratio (z) +{r} →
      </text>
      <text x={centre.px + 4} y={MARGE - 8} fontSize={9} style={{ fill: "var(--text-dim)" }}>
        ↑ RS-Momentum (z) +{r}
      </text>
      {points.map((p) => {
        const couleur = COULEUR_QUADRANT[p.quadrant];
        const traine = p.traine.map((q) => projeter(q.x, q.y, r));
        const tete = projeter(p.x, p.y, r);
        const actif = selection === p.symbole;
        const estompe = selection !== null && !actif;
        return (
          <g
            key={p.symbole}
            opacity={estompe ? 0.35 : 1}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onSelection(actif ? null : p.symbole);
            }}
          >
            <title>
              {`${p.symbole} — ${LIBELLES_QUADRANT[p.quadrant]} · RS-Ratio ${formatDec(p.x)} · RS-Momentum ${formatDec(p.y)} · clôture ${dateJourUtc(p.jour)}${tete.coupe ? " · hors cadre (écrêté)" : ""}`}
            </title>
            {traine.length > 1 && (
              <polyline
                points={traine.map((q) => `${q.px.toFixed(1)},${q.py.toFixed(1)}`).join(" ")}
                fill="none"
                style={{ stroke: couleur }}
                strokeOpacity={0.5}
                strokeWidth={1}
              />
            )}
            {traine.slice(0, -1).map((q, i) => (
              <circle key={i} cx={q.px} cy={q.py} r={1.6} style={{ fill: couleur }} fillOpacity={0.5} />
            ))}
            <circle
              cx={tete.px}
              cy={tete.py}
              r={actif ? 6 : 4.5}
              style={{ fill: tete.coupe ? "transparent" : couleur, stroke: actif ? "var(--text)" : couleur }}
              strokeWidth={actif ? 1.5 : 1}
            />
            <text x={tete.px + 6} y={tete.py - 6} fontSize={9} style={{ fill: "var(--text)" }}>
              {courtSymbole(p.symbole)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────── Détail du ratio X÷BTC ───────────────────────────

/**
 * Variation (%) du ratio sur `pas` jours CALENDAIRES : clôture du dernier jour contre celle
 * du jour `dernier − pas` exactement ; null (affiché « — ») si ce jour manque ou si
 * l'historique est trop court — jamais une variation sur une durée enjambant un trou.
 */
export function variationRatio(jours: readonly number[], ratio: readonly number[], pas: number): number | null {
  const n = ratio.length;
  const fin = ratio[n - 1];
  const dernier = jours[n - 1];
  if (fin === undefined || dernier === undefined) return null;
  const k = jours.lastIndexOf(dernier - pas);
  const debut = k < 0 ? undefined : ratio[k];
  return debut === undefined || debut <= 0 ? null : (fin / debut - 1) * 100;
}

/** Ouvre le ratio X÷BTC sur le graphe principal (même composition que le bouton ÷BTC). */
function cibleRatioBtc(symbole: string): string | null {
  const source = resolveTickerSource(symbole, watchlistStore.getState().sources[symbole]);
  return symboleRatio(symbole, source, "BTC");
}

/**
 * Détail d'un actif sélectionné : graphe du ratio X÷BTC, variations 30/90 j, bouton
 * d'ouverture sur le graphe principal. La série BTC passe par `serieRef` — surtout pas
 * `ref`, prop RÉSERVÉE de React (retirée des props : le composant recevait undefined).
 */
export function DetailRatio({
  point,
  serie,
  serieRef,
  chargeA,
}: {
  point: PointRotation;
  serie: SerieCloture[];
  serieRef: SerieCloture[];
  chargeA: number;
}) {
  const { jours, ratio } = useMemo(
    () => serieRatio(exclureJourCourant(serie, chargeA), exclureJourCourant(serieRef, chargeA)),
    [serie, serieRef, chargeA],
  );
  const cible = useMemo(() => cibleRatioBtc(point.symbole), [point.symbole]);
  const largeur = 400;
  const hauteur = 110;
  const min = Math.min(...ratio);
  const max = Math.max(...ratio);
  const etendue = max - min || 1;
  const premier = jours[0];
  const dernier = jours[jours.length - 1];
  // Abscisse au JOUR (et non au rang) : un trou de clôture reste visible comme un segment
  // droit au lieu de comprimer l'axe du temps.
  const duree = premier === undefined || dernier === undefined ? 1 : Math.max(1, dernier - premier);
  const trace = ratio
    .map((v, i) => {
      const x = (((jours[i] ?? 0) - (premier ?? 0)) / duree) * largeur;
      const y = hauteur - 4 - ((v - min) / etendue) * (hauteur - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const ouvrir = () => {
    if (cible === null) return;
    syntheticsStore.getState().addRecent(cible);
    marketStore.getState().setMarket({ exchange: "synthetic", symbol: cible, timeframe: "1d" });
  };
  return (
    <section className="mt-3 rounded-md border border-border bg-bg">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium text-text">
          {courtSymbole(point.symbole)} ÷ BTC · <span style={{ color: COULEUR_QUADRANT[point.quadrant] }}>{LIBELLES_QUADRANT[point.quadrant]}</span>
        </span>
        <span className="text-[11px] tabular-nums text-text-dim">
          RS-Ratio {formatDec(point.x)} · RS-Momentum {formatDec(point.y)} · Δ30 j {formatPct(variationRatio(jours, ratio, 30), 1)} · Δ90 j{" "}
          {formatPct(variationRatio(jours, ratio, 90), 1)}
        </span>
      </div>
      <div className="px-3 py-2">
        {ratio.length < 2 ? (
          <Vide>Historique du ratio insuffisant.</Vide>
        ) : (
          <svg viewBox={`0 0 ${largeur} ${hauteur}`} preserveAspectRatio="none" className="h-[110px] w-full" role="img" aria-label={`Ratio ${point.symbole} ÷ BTC`}>
            <polyline points={trace} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-dim">
          <span>
            {premier !== undefined && dernier !== undefined
              ? `${dateJourUtc(premier)} → ${dateJourUtc(dernier)} · min ${min.toPrecision(4)} · max ${max.toPrecision(4)} (échelle linéaire)`
              : "—"}
          </span>
          <Bouton
            onClick={ouvrir}
            disabled={cible === null}
            title={cible === null ? "Ratio ÷BTC non composable pour la source de cet actif" : "Ouvre X÷BTC (1d) sur le graphe principal"}
          >
            Ouvrir {courtSymbole(point.symbole)}÷BTC sur le graphe
          </Bouton>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────── Table des points ───────────────────────────

const COLONNES_POINTS: readonly ColonneTable<PointRotation>[] = [
  {
    id: "actif",
    label: "Actif",
    largeur: "1.2fr",
    triable: true,
    valeurTri: (p) => p.symbole,
    rendu: (p) => <span title={p.symbole}>{courtSymbole(p.symbole)}</span>,
  },
  {
    id: "quadrant",
    label: "Quadrant",
    largeur: "1.6fr",
    triable: true,
    valeurTri: (p) => ORDRE_QUADRANTS.indexOf(p.quadrant),
    rendu: (p) => <span style={{ color: COULEUR_QUADRANT[p.quadrant] }}>{LIBELLES_QUADRANT[p.quadrant]}</span>,
  },
  {
    id: "x",
    label: "RS-Ratio",
    align: "right",
    triable: true,
    valeurTri: (p) => p.x,
    rendu: (p) => <>{formatDec(p.x)}</>,
  },
  {
    id: "y",
    label: "RS-Mom.",
    align: "right",
    triable: true,
    valeurTri: (p) => p.y,
    rendu: (p) => <>{formatDec(p.y)}</>,
  },
  {
    id: "obs",
    label: "Obs.",
    align: "right",
    triable: true,
    valeurTri: (p) => p.nObs,
    rendu: (p) => <>{p.nObs}</>,
  },
];

// ─────────────────────────── Onglet ───────────────────────────

export function CorrRotation({ univers, nonce }: { univers: UniversTransversal; nonce: number }) {
  const { statut, series, chargeA } = useSeriesUnivers(univers.alts, nonce);
  const [selection, setSelection] = useState<string | null>(null);
  const [triTable, setTriTable] = useState<TriTable | null>({ colonne: "x", dir: -1 });

  const resultat = useMemo(() => {
    if (series === null || chargeA === null) return null;
    return calculerRotation(series, univers.alts, series.get(REFERENCE_ROTATION) ?? [], chargeA);
  }, [series, chargeA, univers.alts]);

  const alts = univers.alts;
  const nCharges = series === null ? 0 : alts.filter((s) => (series.get(s) ?? []).length > 0).length;
  const lignes = useMemo(
    () => (resultat === null ? [] : trierLignes(resultat.points, COLONNES_POINTS, triTable)),
    [resultat, triTable],
  );
  const pointSelectionne = resultat?.points.find((p) => p.symbole === selection) ?? null;
  const comptes = resultat === null ? null : compterQuadrants(resultat.points);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge ton="accent" title="Méthode ouverte inspirée des graphes de rotation relative ; la méthode JdK (RRG®) n'est pas publiée">
          Approximation ouverte, pas le RRG®
        </Badge>
        <Badge ton="warn" title="Aucune étude figée (≥ 40 alts jamais vues, univers daté) n'a validé un pouvoir prédictif des quadrants">
          Descriptif
        </Badge>
      </div>
      <BandeauUnivers univers={univers} nCharges={nCharges} dernierJour={resultat?.dernierJour ?? null} />

      {alts.length === 0 ? (
        <Vide>Aucun alt crypto coté en dollar dans l'univers. Ajoutez des paires à la watchlist ou choisissez un top N.</Vide>
      ) : statut === "chargement" || resultat === null ? (
        <Chargement libelle={`Séries 1d (${alts.length} alts + BTC, ${MAX_JOURS} jours)…`} />
      ) : !resultat.refDisponible ? (
        <ErreurBloc>Série BTCUSDT indisponible : le ratio X÷BTC ne peut pas être calculé. Réessayez avec « Recalculer ».</ErreurBloc>
      ) : (
        <>
          {resultat.points.length === 0 ? (
            <Vide>Aucun actif placé : historiques insuffisants (voir la liste ci-dessous).</Vide>
          ) : (
            <div className="flex justify-center">
              <NuageRotation points={resultat.points} selection={selection} onSelection={setSelection} />
            </div>
          )}
          {comptes !== null && resultat.points.length > 0 && (
            <p className="mt-1 text-[11px] text-text-dim">
              {ORDRE_QUADRANTS.map((q, i) => (
                <span key={q}>
                  {i > 0 && " · "}
                  <span style={{ color: COULEUR_QUADRANT[q] }}>{LIBELLES_QUADRANT[q]}</span> {comptes[q]}
                </span>
              ))}
              {comptes.neutre > 0 && <> · sur un axe {comptes.neutre}</>}
            </p>
          )}

          {pointSelectionne !== null && series !== null && chargeA !== null && (
            <DetailRatio
              point={pointSelectionne}
              serie={series.get(pointSelectionne.symbole) ?? []}
              serieRef={series.get(REFERENCE_ROTATION) ?? []}
              chargeA={chargeA}
            />
          )}

          <div className="mt-3">
            <TableTriable
              ariaLabel="Actifs placés dans le nuage de rotation"
              colonnes={COLONNES_POINTS}
              lignes={lignes}
              tri={triTable}
              onTri={setTriTable}
              cle={(p) => p.symbole}
              vide="Aucun actif placé."
              maxHauteur="260px"
              surClicLigne={(p) => setSelection(p.symbole === selection ? null : p.symbole)}
            />
          </div>

          {resultat.nonPlaces.length > 0 && (
            <div className="mt-2 text-[11px] text-text-dim">
              <p className="mb-1">Non placés ({resultat.nonPlaces.length}) :</p>
              <ul className="space-y-0.5">
                {resultat.nonPlaces.map((n) => (
                  <li key={n.symbole}>
                    <span className="text-text">{courtSymbole(n.symbole)}</span> — {n.raison}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-3">
        <NoteSource>
          Ratio X÷BTCUSDT sur clôtures 1d (paires cotées en dollar seulement, jour en cours exclu).
          RS-Ratio = z-score du log-ratio sur {FENETRE_Z_ROTATION} jours (52 semaines) ; RS-Momentum =
          z-score, sur la même fenêtre, de sa variation sur {PAS_MOMENTUM_ROTATION} jours ; durées
          calendaires exactes : {OBS_MIN_POINT} jours consécutifs de clôtures communes requis (un trou
          rend l'actif non placé) ; traîne = {LONGUEUR_TRAINE} dernières clôtures. Pièges : un alt à
          bêta élevé « mène » mécaniquement quand BTC monte (voir l'alpha résiduel de l'indicateur
          Bêta référence, option « Alpha résiduel cumulé » de ses paramètres) ; les
          z-scores glissants font tourner la traîne même sur du bruit. Klines réutilisées des sources
          existantes, en cache de session.
        </NoteSource>
      </div>
    </div>
  );
}
