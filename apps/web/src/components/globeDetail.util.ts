/** Textes PURS du panneau détail du globe (testables sans DOM). */
import { formatAge, formatEntier } from "../lib/format";
import { LIBELLES_CATEGORIE } from "../lib/globeRender";
import type { CelluleEvenements, Chokepoint, EvenementDetail, ZoneConflitUcdp } from "../data/globe/types";

/** Sélection ouverte par un clic sur une cible du globe. */
export type SelectionGlobe =
  | { type: "evenement"; lat: number; lon: number; cellule: CelluleEvenements }
  | { type: "conflit"; zone: ZoneConflitUcdp }
  | { type: "chokepoint"; chokepoint: Chokepoint };

export function titreSelection(selection: SelectionGlobe): string {
  if (selection.type === "evenement") return `${LIBELLES_CATEGORIE[selection.cellule.categorie]} — zone ${selection.lat}, ${selection.lon}`;
  if (selection.type === "conflit") return `Conflit confirmé (UCDP) — zone ${selection.zone.lat}, ${selection.zone.lon}`;
  return selection.chokepoint.nom;
}

export function sousTitreSelection(selection: SelectionGlobe, nowMs: number): string {
  if (selection.type === "evenement") {
    const c = selection.cellule;
    return `${formatEntier(c.n)} événements · intensité max ${c.intensite.toFixed(1)}/10 · ${formatEntier(c.mentions)} mentions · dernier ${formatAge(c.dernierMs, nowMs)}`;
  }
  if (selection.type === "conflit") {
    const z = selection.zone;
    const acteurs = z.sideA !== null && z.sideB !== null ? ` · ${z.sideA} vs ${z.sideB}` : "";
    return `${formatEntier(z.morts)} morts (best) · ${formatEntier(z.n)} événements${acteurs} · dernier ${formatAge(z.dernierMs, nowMs)}`;
  }
  const c = selection.chokepoint;
  const navires = c.nNavires !== null ? `${formatEntier(c.nNavires)} navires` : "trafic n/d";
  return `${navires}${c.nTankers !== null ? ` · ${formatEntier(c.nTankers)} pétroliers` : ""}${c.date !== null ? ` · ${c.date}` : ""}`;
}

/** Deux lignes d'affichage pour un événement GDELT du panneau. */
export function lignesEvenement(evt: EvenementDetail, nowMs: number): { entete: string; detail: string } {
  const acteurs = evt.acteur1 !== null && evt.acteur2 !== null
    ? `${evt.acteur1} → ${evt.acteur2}`
    : (evt.acteur1 ?? evt.acteur2 ?? LIBELLES_CATEGORIE[evt.categorie]);
  return {
    entete: `${acteurs} · ${formatAge(evt.dateMs, nowMs)}`,
    detail: `CAMEO ${evt.codeCameo} · Goldstein ${evt.goldstein} · ${formatEntier(evt.mentions)} mentions`,
  };
}
