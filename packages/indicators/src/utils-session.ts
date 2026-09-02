/**
 * @axiom/indicators — utils-session.ts
 *
 * Helpers de découpage par SESSION (jour UTC), PURS et réutilisables.
 * Utilisés par les indicateurs de pivots (support_resistance/pivot*) pour
 * agréger les extents H/L/C du jour UTC précédent.
 *
 * NB : `noUncheckedIndexedAccess` est actif — tout accès indexé est traité
 * comme potentiellement `undefined` et gardé explicitement.
 */

import type { Candle, LabelAnnotation } from "@axiom/types";

const DAY_MS = 86_400_000;

/** Index de jour UTC d'un timestamp ms (`Math.floor(timeMs / 86_400_000)`). */
export function utcDayOf(timeMs: number): number {
  return Math.floor(timeMs / DAY_MS);
}

/**
 * Vrai quand le buffer ne démarre PAS sur une frontière de jour UTC (00:00) :
 * sa première session est alors TRONQUÉE (backfill limité à N bougies). Les
 * cumuls/extents de cette session ne portent pas sur un jour entier.
 */
export function debutSessionPartiel(candles: Candle[]): boolean {
  const premiere = candles[0];
  return premiere !== undefined && premiere.time % DAY_MS !== 0;
}

/**
 * Étiquette « Session partielle » posée sur la PREMIÈRE bougie du buffer, pour
 * les indicateurs cumulatifs de session (VWAP et ses bandes) : l'ancre du cumul
 * est la première bougie chargée, pas 00:00 UTC. On étiquette plutôt que de
 * vider la série (contrat : jamais de pane muet). `serie` sert à ancrer le
 * label sur la valeur affichée ; repli sur la clôture si elle est indéfinie.
 */
export function etiquetteSessionPartielle(
  candles: Candle[],
  serie: ReadonlyArray<number | undefined>,
): LabelAnnotation {
  const premiere = candles[0];
  const valeur = serie[0] ?? premiere?.close ?? 0;
  const heure = new Date(premiere?.time ?? 0).toISOString().slice(11, 16);
  return {
    idx: 0,
    valeur,
    texte: "Session partielle",
    couleur: "--accent",
    cible: "prix",
    position: "dessus",
    info: `Session partielle : le cumul démarre à ${heure} UTC (première bougie chargée) et non à 00:00 UTC.`,
  };
}

/** Agrégat O/H/L/C d'un jour UTC (bornes temporelles incluses pour référence). */
export interface SessionExtent {
  dayIdx: number;
  open: number;
  high: number;
  low: number;
  close: number;
  from: number;
  to: number;
  /** Session TRONQUÉE : ne concerne que le premier intervalle d'un buffer
   *  ne démarrant pas à 00:00 UTC — ses H/L/C ne sont pas ceux du jour entier. */
  partiel: boolean;
}

/**
 * Agrège les bougies par jour UTC (Open = ouverture de la première bougie du
 * jour, High = max, Low = min, Close = clôture de la dernière bougie du
 * jour). Suppose `candles` trié par ordre chronologique croissant. Résultat
 * trié par `dayIdx` croissant (ordre chronologique).
 *
 * Le PREMIER intervalle est marqué `partiel` quand sa première bougie ne tombe
 * pas sur 00:00 UTC : le buffer commence en milieu de journée, ses extents sont
 * ceux d'un bout de session, pas d'un jour.
 */
export function sessionExtents(candles: Candle[]): SessionExtent[] {
  const out: SessionExtent[] = [];
  let current: SessionExtent | undefined;

  for (const c of candles) {
    const dayIdx = utcDayOf(c.time);
    if (current === undefined || current.dayIdx !== dayIdx) {
      current = {
        dayIdx,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        from: c.time,
        to: c.time,
        // Seul le premier intervalle peut être tronqué (les suivants démarrent
        // forcément sur la frontière de jour, par construction de la boucle).
        partiel: out.length === 0 && c.time % DAY_MS !== 0,
      };
      out.push(current);
    } else {
      if (c.high > current.high) current.high = c.high;
      if (c.low < current.low) current.low = c.low;
      current.close = c.close; // dernière clôture rencontrée pour ce jour
      current.to = c.time;
    }
  }
  return out;
}
