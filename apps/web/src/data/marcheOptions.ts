/** Synthèse de la chaîne inverse Deribit. Horloge injectée ; aucun historique reconstitué. */
import type { OptionPoint } from "./deribit";
import { computeCryptoGexDex, estOptionCryptoExploitable } from "./gexDex";

export interface EcheanceMarcheOptions {
  expiryMs: number;
  oiBase: number | null;
  oiUsd: number | null;
  partOiPct: number | null;
  pcOi: number | null;
  couvertureOiPct: number | null;
  nbOiInconnus: number;
  gexUsd: number | null;
  dexUsd: number | null;
}

export interface MarcheOptions {
  oiUsd: number | null;
  pcOi: number | null;
  couvertureOiPct: number | null;
  nbOiInconnus: number;
  courtTerme: { partOiPct: number | null; gexUsd: number | null };
  prochaineEcheance: number | null;
  dominante: EcheanceMarcheOptions | null;
  echeances: EcheanceMarcheOptions[];
}

export function resumerMarcheOptions(chaine: readonly OptionPoint[], spot: number, nowMs: number): MarcheOptions {
  const groupes = new Map<number, OptionPoint[]>();
  for (const p of chaine) {
    if (!Number.isFinite(p.expiryMs) || p.expiryMs <= nowMs) continue;
    const groupe = groupes.get(p.expiryMs) ?? [];
    groupe.push(p);
    groupes.set(p.expiryMs, groupe);
  }
  const indexValide = Number.isFinite(spot) && spot > 0;
  let totalCalls = 0;
  let totalPuts = 0;
  let totalCouvert = 0;
  let totalConnus = 0;
  let totalInconnus = 0;
  const echeances: EcheanceMarcheOptions[] = [...groupes].sort(([a], [b]) => a - b).map(([expiryMs, points]) => {
    let calls = 0;
    let puts = 0;
    let couvert = 0;
    let connus = 0;
    let inconnus = 0;
    let calculables = 0;
    for (const p of points) {
      if (!Number.isFinite(p.openInterest) || p.openInterest < 0) { inconnus++; continue; }
      connus++;
      if (p.type === "call") calls += p.openInterest;
      else puts += p.openInterest;
      if (estOptionCryptoExploitable(p, spot, nowMs)) { couvert += p.openInterest; calculables++; }
    }
    const oiBase = calls + puts;
    totalCalls += calls;
    totalPuts += puts;
    totalCouvert += couvert;
    totalConnus += connus;
    totalInconnus += inconnus;
    const greeks = calculables > 0 ? computeCryptoGexDex(points, spot, nowMs) : [];
    return {
      expiryMs, oiBase: connus > 0 ? oiBase : null,
      oiUsd: indexValide && connus > 0 ? oiBase * spot : null,
      partOiPct: null,
      pcOi: calls > 0 ? puts / calls : null,
      couvertureOiPct: oiBase > 0 ? 100 * couvert / oiBase : null,
      nbOiInconnus: inconnus,
      gexUsd: greeks.length > 0 ? greeks.reduce((s, p) => s + p.gex, 0) : null,
      dexUsd: greeks.length > 0 ? greeks.reduce((s, p) => s + p.dex, 0) : null,
    };
  });
  const total = totalCalls + totalPuts;
  let dominante: EcheanceMarcheOptions | null = null;
  for (const e of echeances) {
    e.partOiPct = total > 0 && e.oiBase !== null ? 100 * e.oiBase / total : null;
    if (e.oiBase !== null && e.oiBase > 0 && (dominante === null || e.oiBase > (dominante.oiBase ?? 0))) dominante = e;
  }
  const courtes = echeances.filter((e) => e.expiryMs <= nowMs + 7 * 86_400_000);
  const gexCourts = courtes.filter((e) => e.gexUsd !== null);
  return {
    oiUsd: indexValide && totalConnus > 0 ? total * spot : null,
    pcOi: totalCalls > 0 ? totalPuts / totalCalls : null,
    couvertureOiPct: total > 0 ? 100 * totalCouvert / total : null,
    nbOiInconnus: totalInconnus,
    courtTerme: {
      partOiPct: total > 0 && (courtes.length === 0 || courtes.some((e) => e.oiBase !== null))
        ? 100 * courtes.reduce((s, e) => s + (e.oiBase ?? 0), 0) / total : null,
      gexUsd: courtes.length === 0 && totalConnus > 0 ? 0 : gexCourts.length > 0 ? gexCourts.reduce((s, e) => s + e.gexUsd!, 0) : null,
    },
    prochaineEcheance: echeances[0]?.expiryMs ?? null,
    dominante,
    echeances,
  };
}
