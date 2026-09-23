/** SCEN descriptif : variations par couples de dates exacts, OLS jointe sans dépendance. */
export type FacteurMultiId = "btc" | "eth" | "spx" | "dxy" | "or" | "taux";
export interface IdentiteSerie { symbol: string; source: string; quote: string; session: string; convention: string }
export interface SerieMulti {
  identite: IdentiteSerie;
  unite: "prix" | "taux-pct";
  points: readonly { date: string; valeur: number }[];
}
export interface VariationDatee { debut: string; fin: string; valeur: number; jours: number }
export const LABEL_DATES_SCEN = "association de variations quotidiennes par dates — clôtures non synchrones ; données révisées disponibles au calcul";
const JOUR = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateMs(date: string): number | null {
  if (!DATE.test(date)) return null;
  const n = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === date ? n : null;
}
export function cutoffScen(maintenant: number): string {
  return new Date(Math.floor(maintenant / JOUR) * JOUR - 2 * JOUR).toISOString().slice(0, 10);
}
function diagnosticVariations(serie: SerieMulti, cutoff: string, debut?: string): { variations: VariationDatee[]; exclues: number } {
  const borne = dateMs(cutoff);
  if (borne === null) return { variations: [], exclues: 0 };
  const points = serie.points.filter((p) => {
    const t = dateMs(p.date);
    return t !== null && t <= borne;
  }).sort((a, b) => a.date.localeCompare(b.date));
  // Doublon de date : identité de la clôture ambiguë, aucune variation à partir de celle-ci.
  const dates = new Set<string>();
  const doublons = new Set<string>();
  for (const p of points) { if (dates.has(p.date)) doublons.add(p.date); dates.add(p.date); }
  const resultats: VariationDatee[] = [];
  let exclues = 0;
  for (let i = 1; i < points.length; i++) {
    const precedent = points[i - 1]!;
    const courant = points[i]!;
    if (debut && courant.date < debut) continue;
    if (doublons.has(precedent.date) || doublons.has(courant.date) || !Number.isFinite(precedent.valeur) || !Number.isFinite(courant.valeur) || (serie.unite === "prix" && (precedent.valeur <= 0 || courant.valeur <= 0))) { exclues++; continue; }
    const jours = (dateMs(courant.date)! - dateMs(precedent.date)!) / JOUR;
    if (jours <= 0) { exclues++; continue; }
    const valeur = serie.unite === "prix" ? Math.log(courant.valeur / precedent.valeur) : courant.valeur - precedent.valeur;
    if (Number.isFinite(valeur)) resultats.push({ debut: precedent.date, fin: courant.date, valeur, jours });
    else exclues++;
  }
  return { variations: resultats, exclues };
}
export function variationsDatees(serie: SerieMulti, cutoff: string): VariationDatee[] { return diagnosticVariations(serie, cutoff).variations; }

export type FitOls = { statut: "ok"; alpha: number; beta: number[]; r2: number | null; r2Ajuste: number | null; sigma: number | null; vif: number[]; n: number }
  | { statut: "refus"; raison: string; n: number };

/** QR modifié à deux passes, sur colonnes centrées/réduites ; refuse tout rang déficient. */
function qr(x: readonly (readonly number[])[], y: readonly number[]): number[] | null {
  const n = x.length, k = x[0]?.length ?? 0;
  if (n === 0 || y.length !== n || x.some((r) => r.length !== k)) return null;
  const q: number[][] = [];
  const r = Array.from({ length: k }, () => Array<number>(k).fill(0));
  for (let j = 0; j < k; j++) {
    const v = x.map((row) => row[j]!);
    const initial = Math.hypot(...v);
    if (!(initial > 0) || !Number.isFinite(initial)) return null;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < j; i++) {
      const dot = q[i]!.reduce((s, z, t) => s + z * v[t]!, 0);
      r[i]![j] = r[i]![j]! + dot;
      for (let t = 0; t < n; t++) v[t] = v[t]! - dot * q[i]![t]!;
    }
    const norme = Math.hypot(...v);
    if (!(norme > initial * 1e-10)) return null;
    r[j]![j] = norme;
    q.push(v.map((z) => z / norme));
  }
  const b = q.map((col) => col.reduce((s, z, i) => s + z * y[i]!, 0));
  const solution = Array<number>(k).fill(0);
  for (let j = k - 1; j >= 0; j--) {
    let z = b[j]!;
    for (let i = j + 1; i < k; i++) z -= r[j]![i]! * solution[i]!;
    solution[j] = z / r[j]![j]!;
  }
  return solution.every(Number.isFinite) ? solution : null;
}

export function ajusterOls(x: readonly (readonly number[])[], y: readonly number[]): FitOls {
  const n = y.length, k = x[0]?.length ?? 0;
  const refus = (raison: string): FitOls => ({ statut: "refus", raison, n });
  if (n <= k + 1 || k === 0 || x.length !== n || x.some((r) => r.length !== k || r.some((v) => !Number.isFinite(v))) || y.some((v) => !Number.isFinite(v))) return refus("matrice incomplète ou non finie");
  const moyennes = Array.from({ length: k }, (_, j) => x.reduce((s, r) => s + r[j]!, 0) / n);
  const echelles = moyennes.map((m, j) => Math.hypot(...x.map((r) => r[j]! - m)) / Math.sqrt(n));
  if (echelles.some((s) => !(s > 0) || !Number.isFinite(s))) return refus("facteur constant");
  const z = x.map((r) => r.map((v, j) => (v - moyennes[j]!) / echelles[j]!));
  const moyenneY = y.reduce((s, v) => s + v, 0) / n;
  const centreY = y.map((v) => v - moyenneY);
  const coef = qr(z, centreY);
  if (coef === null) return refus("rang déficient");
  const vif = Array<number>(k).fill(1);
  for (let j = 0; j < k; j++) {
    if (k === 1) break;
    const autres = z.map((r) => r.filter((_, i) => i !== j));
    const coefs = qr(autres, z.map((r) => r[j]!));
    if (coefs === null) return refus("rang déficient");
    const residu = z.reduce((s, r, i) => s + (r[j]! - autres[i]!.reduce((a, v, l) => a + v * coefs[l]!, 0)) ** 2, 0);
    const total = z.reduce((s, r) => s + r[j]! ** 2, 0);
    vif[j] = total / residu;
    if (!Number.isFinite(vif[j]) || vif[j]! > 10) return refus("facteurs redondants (VIF > 10)");
  }
  const beta = coef.map((v, j) => v / echelles[j]!);
  const alpha = moyenneY - beta.reduce((s, v, j) => s + v * moyennes[j]!, 0);
  const sse = x.reduce((s, r, i) => s + (y[i]! - alpha - r.reduce((a, v, j) => a + v * beta[j]!, 0)) ** 2, 0);
  const sst = centreY.reduce((s, v) => s + v * v, 0);
  const r2 = sst > 0 ? 1 - sse / sst : null;
  const r2Ajuste = r2 === null ? null : 1 - (1 - r2) * (n - 1) / (n - k - 1);
  const sigma = Math.sqrt(sse / (n - k - 1));
  return [alpha, ...beta, sse, sigma, ...vif].every(Number.isFinite)
    ? { statut: "ok", alpha, beta, r2, r2Ajuste, sigma, vif, n }
    : refus("résultat non fini");
}

export interface DemandeMulti { actif: SerieMulti; facteurs: Partial<Record<FacteurMultiId, SerieMulti>>; selection: readonly FacteurMultiId[]; fenetreJours: 90 | 180 | 365; maintenant: number }
export interface EstimationMulti {
  statut: "ok" | "directe" | "indisponible";
  raison: string | null;
  facteurs: FacteurMultiId[];
  beta: Partial<Record<FacteurMultiId, number>>;
  alpha: number | null; r2: number | null; r2Ajuste: number | null; sigma: number | null;
  vif: Partial<Record<FacteurMultiId, number>>;
  n: number; nonAppariees: number; excluesInvalides: number; pairesLongues: number; dureesJours: { min: number; max: number } | null; periode: { debut: string; fin: string } | null;
  stabilite: "estimable" | "non-estimable";
  betaMoitie: [Partial<Record<FacteurMultiId, number>>, Partial<Record<FacteurMultiId, number>>] | null;
}
export function memeIdentite(a: IdentiteSerie, b: IdentiteSerie): boolean {
  return a.symbol === b.symbol && a.source === b.source && a.quote === b.quote && a.session === b.session && a.convention === b.convention;
}
export function estimerMultifactoriel(d: DemandeMulti): EstimationMulti {
  const selection = [...new Set(d.selection)];
  const base: EstimationMulti = { statut: "indisponible", raison: null, facteurs: selection, beta: {}, alpha: null, r2: null, r2Ajuste: null, sigma: null, vif: {}, n: 0, nonAppariees: 0, excluesInvalides: 0, pairesLongues: 0, dureesJours: null, periode: null, stabilite: "non-estimable", betaMoitie: null };
  const refuser = (raison: string, patch: Partial<EstimationMulti> = {}): EstimationMulti => ({ ...base, ...patch, raison });
  if (![90, 180, 365].includes(d.fenetreJours) || !Number.isFinite(d.maintenant) || selection.length === 0 || selection.length !== d.selection.length) return refuser("configuration invalide");
  const propre = selection.find((id) => d.facteurs[id] && memeIdentite(d.actif.identite, d.facteurs[id]!.identite));
  if (propre) return { ...base, statut: "directe", raison: "exposition directe", beta: Object.fromEntries(selection.map((id) => [id, id === propre ? 1 : 0])) };
  if (selection.some((id) => !d.facteurs[id])) return refuser("facteur absent");
  const cutoff = cutoffScen(d.maintenant);
  const borneDebut = new Date(dateMs(cutoff)! - d.fenetreJours * JOUR).toISOString().slice(0, 10);
  const diagnosticActif = diagnosticVariations(d.actif, cutoff, borneDebut);
  const diagnosticsFacteurs = selection.map((id) => diagnosticVariations(d.facteurs[id]!, cutoff, borneDebut));
  const actif = diagnosticActif.variations.filter((v) => v.debut >= borneDebut);
  const facteurs = diagnosticsFacteurs.map((diag) => diag.variations.filter((v) => v.debut >= borneDebut));
  const maps = facteurs.map((serie) => new Map(serie.map((v) => [`${v.debut}/${v.fin}`, v.valeur])));
  const jointes = actif.filter((v) => maps.every((map) => map.has(`${v.debut}/${v.fin}`)));
  const n = jointes.length, k = selection.length;
  const patch = { n, nonAppariees: actif.length - n, excluesInvalides: diagnosticActif.exclues + diagnosticsFacteurs.reduce((s, d) => s + d.exclues, 0), pairesLongues: jointes.filter((v) => v.jours > 1).length, dureesJours: n ? { min: Math.min(...jointes.map((v) => v.jours)), max: Math.max(...jointes.map((v) => v.jours)) } : null, periode: n ? { debut: jointes[0]!.debut, fin: jointes[n - 1]!.fin } : null };
  if (n < Math.max(30, 10 * (k + 1))) return refuser("observations communes insuffisantes", patch);
  const x = jointes.map((v) => maps.map((map) => map.get(`${v.debut}/${v.fin}`)!));
  const y = jointes.map((v) => v.valeur);
  const fit = ajusterOls(x, y);
  if (fit.statut !== "ok") return refuser(fit.raison, patch);
  const beta = Object.fromEntries(selection.map((id, j) => [id, fit.beta[j]!])) as Partial<Record<FacteurMultiId, number>>;
  const vif = Object.fromEntries(selection.map((id, j) => [id, fit.vif[j]!])) as Partial<Record<FacteurMultiId, number>>;
  const milieu = Math.floor(n / 2);
  const gauche = milieu >= Math.max(30, 10 * (k + 1)) ? ajusterOls(x.slice(0, milieu), y.slice(0, milieu)) : null;
  const droite = n - milieu >= Math.max(30, 10 * (k + 1)) ? ajusterOls(x.slice(milieu), y.slice(milieu)) : null;
  const moities: EstimationMulti["betaMoitie"] = gauche?.statut === "ok" && droite?.statut === "ok"
    ? [Object.fromEntries(selection.map((id, j) => [id, gauche.beta[j]!])), Object.fromEntries(selection.map((id, j) => [id, droite.beta[j]!]))]
    : null;
  return { ...base, ...patch, statut: "ok", beta, alpha: fit.alpha, r2: fit.r2, r2Ajuste: fit.r2Ajuste, sigma: fit.sigma, vif, stabilite: moities ? "estimable" : "non-estimable", betaMoitie: moities };
}

export type ResultatChocMulti = { statut: "ok"; contributions: Partial<Record<FacteurMultiId, number>>; logRendement: number; rendement: number; pnl: number }
  | { statut: "indisponible"; raison: string };
export function appliquerChocMultifactoriel(beta: Partial<Record<FacteurMultiId, number>>, chocs: Partial<Record<FacteurMultiId, number>>, valeurSignee: number): ResultatChocMulti {
  if (!Number.isFinite(valeurSignee)) return { statut: "indisponible", raison: "valorisation absente" };
  const contributions: Partial<Record<FacteurMultiId, number>> = {};
  for (const [id, coef] of Object.entries(beta) as [FacteurMultiId, number][]) {
    const choc = chocs[id];
    if (!Number.isFinite(coef) || choc === undefined || !Number.isFinite(choc) || (id !== "taux" && choc <= -100)) return { statut: "indisponible", raison: "choc ou coefficient invalide" };
    contributions[id] = coef * (id === "taux" ? choc / 100 : Math.log1p(choc / 100));
  }
  const logRendement = Object.values(contributions).reduce((s, v) => s + v, 0);
  const rendement = Math.expm1(logRendement), pnl = valeurSignee * rendement;
  return [logRendement, rendement, pnl].every(Number.isFinite) ? { statut: "ok", contributions, logRendement, rendement, pnl } : { statut: "indisponible", raison: "résultat non fini" };
}
