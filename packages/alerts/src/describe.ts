/**
 * @axiom/alerts — describe.ts
 *
 * Description humaine (français) d'une `Condition`. Sert de message par défaut du
 * moteur quand la def n'en fournit pas, et de libellé dans le panneau UI. PURE.
 */

import type { Condition } from "./types";

/** Formatte une durée en ms de façon compacte (« 15 min », « 4 h », « 2 j »). */
export function formaterDuree(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const j = Math.round(h / 24);
  return `${j} j`;
}

/** Description française d'une condition (courte, dense). */
export function decrireCondition(condition: Condition): string {
  switch (condition.type) {
    case "prix-croise": {
      const { niveau, sens } = condition;
      if (sens === "hausse") return `Prix franchit ${niveau} à la hausse`;
      if (sens === "baisse") return `Prix franchit ${niveau} à la baisse`;
      return `Prix franchit ${niveau}`;
    }
    case "variation-pct": {
      const { seuilPct, fenetreMs } = condition;
      const signe = seuilPct > 0 ? "+" : "";
      return `Variation ${signe}${seuilPct}% sur ${formaterDuree(fenetreMs)}`;
    }
    case "indicateur-seuil": {
      const { indicateurId, output, comparateur, valeur } = condition;
      return `${indicateurId}(${output}) ${comparateur} ${valeur}`;
    }
    case "indicateur-croisement": {
      const { indicateurId, outputA, outputB, sens } = condition;
      const verbe =
        sens === "hausse" ? "croise à la hausse" : sens === "baisse" ? "croise à la baisse" : "croise";
      return `${indicateurId} : ${outputA} ${verbe} ${outputB}`;
    }
    case "funding-extreme": {
      const { sens, zSeuil, seuilAbs } = condition;
      const cote =
        sens === "long-crowded"
          ? "long crowded"
          : sens === "short-crowded"
            ? "short crowded"
            : "long/short crowded";
      const parties: string[] = [];
      if (seuilAbs !== undefined) {
        // Affiche en % pour lisibilité (0.001 → 0.1 %).
        const pct = seuilAbs * 100;
        parties.push(`|rate|≥${pct}%`);
      }
      if (zSeuil !== undefined || seuilAbs === undefined) {
        parties.push(`|z|≥${zSeuil ?? 2}`);
      }
      return `Funding extrême (${cote}${parties.length ? `, ${parties.join(" ou ")}` : ""})`;
    }
    case "cvd-spot-perp-div": {
      const { kind } = condition;
      if (kind === "spotUp_perpDown") return "CVD divergence spot↑ perp↓";
      if (kind === "spotDown_perpUp") return "CVD divergence spot↓ perp↑";
      return "CVD divergence spot/perp";
    }
  }
}
