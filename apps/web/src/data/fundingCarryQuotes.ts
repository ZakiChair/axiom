import { extUrl } from "./extapi";
import { parseBinanceFundingIntervalH } from "./fundingCrossExchange";

export interface FenetreAcquisition { debut: number; fin: number; observeLe: number | null }
export interface QuoteCarry {
  symbol: "BTCUSDT" | "ETHUSDT"; base: "BTC" | "ETH"; quote: "USDT"; reglement: "USDT";
  quantite: number; spotEntree: number; perpEntree: number;
  spot: FenetreAcquisition; perp: FenetreAcquisition; financement: FenetreAcquisition;
  fundingRate: number; intervalHours: number; nextFundingTime: number;
  limite: "heure de cotation spot inconnue ; acquisitions rapprochées, cotations non garanties simultanées";
}
export type ChargeCarry = { statut: "ok"; quote: QuoteCarry } | { statut: "indisponible"; raison: string };

/** Le panneau expire dès que la plus ancienne acquisition ou source connue dépasse 5 s. */
export function quoteCarryPerime(quote: Pick<QuoteCarry, "spot" | "perp" | "financement">, maintenant: number): boolean {
  if (!Number.isFinite(maintenant)) return true;
  const dates = [quote.spot.debut, quote.perp.debut, quote.financement.debut,
    quote.spot.observeLe, quote.perp.observeLe, quote.financement.observeLe].filter((v): v is number => v !== null);
  return dates.some((t) => !Number.isFinite(t) || t > maintenant || maintenant - t > 5_000);
}

/** VWAP pour une quantité de base, refus si la profondeur disponible est partielle. */
export function prixExecutable(niveaux: readonly (readonly [number, number])[], quantite: number): number | null {
  if (!(quantite > 0) || !Number.isFinite(quantite)) return null;
  let reste = quantite, montant = 0;
  for (const [prix, qty] of niveaux) {
    if (!(prix > 0 && qty > 0) || !Number.isFinite(prix) || !Number.isFinite(qty)) return null;
    const pris = Math.min(qty, reste);
    montant += pris * prix;
    reste -= pris;
    if (reste <= 1e-10) break;
  }
  return reste <= 1e-10 && Number.isFinite(montant) ? montant / quantite : null;
}
/** Les fenêtres REST doivent se chevaucher, être terminées et dater de 5 s au plus. */
export function rapprocherCarnets(a: FenetreAcquisition, b: FenetreAcquisition, maintenant: number): boolean {
  if (![a.debut, a.fin, b.debut, b.fin, maintenant].every(Number.isFinite)) return false;
  if (a.debut > a.fin || b.debut > b.fin || a.fin > maintenant || b.fin > maintenant) return false;
  if (Math.max(a.debut, b.debut) > Math.min(a.fin, b.fin)) return false;
  if (maintenant - a.debut > 5_000 || maintenant - b.debut > 5_000) return false;
  for (const fenetre of [a, b]) if (fenetre.observeLe !== null && (!Number.isFinite(fenetre.observeLe) || fenetre.observeLe > maintenant || maintenant - fenetre.observeLe > 5_000)) return false;
  if (a.observeLe !== null && b.observeLe !== null && Math.abs(a.observeLe - b.observeLe) > 5_000) return false;
  return true;
}
function levels(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parsed: [number, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) return null;
    const p = Number(item[0]), q = Number(item[1]);
    if (!(p > 0 && q > 0) || !Number.isFinite(p) || !Number.isFinite(q)) return null;
    parsed.push([p, q]);
  }
  return parsed;
}
function ordonnes(niveaux: readonly (readonly [number, number])[], cote: "bid" | "ask"): boolean {
  return niveaux.every(([prix], i) => i === 0 || (cote === "ask" ? niveaux[i - 1]![0] < prix : niveaux[i - 1]![0] > prix));
}
async function lire(url: string, signal: AbortSignal): Promise<{ json: unknown; fenetre: FenetreAcquisition }> {
  const debut = Date.now();
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json: unknown = await response.json();
  const fin = Date.now();
  return { json, fenetre: { debut, fin, observeLe: null } };
}
/** Trois preuves live publiques + cadence ; aucune clé, ordre ou proxy supplémentaire. */
export async function chargerQuotesCarry(symbol: string, notionnelUsdt: number, signal?: AbortSignal): Promise<ChargeCarry> {
  if (symbol !== "BTCUSDT" && symbol !== "ETHUSDT") return { statut: "indisponible", raison: "paire non couverte (BTCUSDT/ETHUSDT uniquement)" };
  if (!(notionnelUsdt > 0) || !Number.isFinite(notionnelUsdt)) return { statut: "indisponible", raison: "notionnel invalide" };
  const ctl = new AbortController();
  const stopper = () => ctl.abort();
  signal?.addEventListener("abort", stopper, { once: true });
  if (signal?.aborted) ctl.abort();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const query = `symbol=${symbol}`;
    const [spot, perp, funding, info] = await Promise.all([
      lire(`https://data-api.binance.vision/api/v3/depth?${query}&limit=100`, ctl.signal),
      lire(extUrl("fapi.binance.com", `fapi/v1/depth?${query}&limit=100`), ctl.signal),
      lire(extUrl("fapi.binance.com", `fapi/v1/premiumIndex?${query}`), ctl.signal),
      lire(extUrl("fapi.binance.com", "fapi/v1/fundingInfo"), ctl.signal),
    ]);
    const sj = spot.json as { bids?: unknown; asks?: unknown };
    const pj = perp.json as { bids?: unknown; asks?: unknown; T?: unknown };
    const fj = funding.json as { symbol?: unknown; lastFundingRate?: unknown; nextFundingTime?: unknown; time?: unknown };
    const asks = levels(sj?.asks), sbids = levels(sj?.bids), pbids = levels(pj?.bids), pasks = levels(pj?.asks);
    if (!asks || !sbids || !pbids || !pasks || !ordonnes(asks, "ask") || !ordonnes(sbids, "bid") || !ordonnes(pbids, "bid") || !ordonnes(pasks, "ask") || !(sbids[0]![0] < asks[0]![0]) || !(pbids[0]![0] < pasks[0]![0])) return { statut: "indisponible", raison: "carnet invalide" };
    const tPerp = Number(pj.T);
    perp.fenetre.observeLe = Number.isFinite(tPerp) && tPerp > 0 ? tPerp : null;
    const maintenant = Date.now();
    if (!rapprocherCarnets(spot.fenetre, perp.fenetre, maintenant) || perp.fenetre.observeLe === null) return { statut: "indisponible", raison: "acquisitions non rapprochées ou carnet perp périmé" };
    const quantite = notionnelUsdt / asks[0]![0];
    const spotEntree = prixExecutable(asks, quantite), perpEntree = prixExecutable(pbids, quantite);
    if (spotEntree === null || perpEntree === null) return { statut: "indisponible", raison: "profondeur insuffisante" };
    const fundingRate = typeof fj.lastFundingRate === "string" ? Number(fj.lastFundingRate) : NaN;
    const nextFundingTime = Number(fj.nextFundingTime), fundingTime = Number(fj.time);
    if (!Array.isArray(info.json)) return { statut: "indisponible", raison: "cadence funding non vérifiée" };
    const entrees = info.json as unknown[];
    if (entrees.some((v) => {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return true;
      const e = v as { symbol?: unknown; fundingIntervalHours?: unknown };
      const h = Number(e.fundingIntervalHours);
      return typeof e.symbol !== "string" || e.symbol.trim() === "" || e.fundingIntervalHours === undefined || !Number.isFinite(h) || h <= 0 || h > 24;
    })) return { statut: "indisponible", raison: "liste de cadences funding invalide" };
    const correspondances = entrees.filter((v) => (v as { symbol: string }).symbol === symbol);
    const cadences = new Set(correspondances.map((v) => Number((v as { fundingIntervalHours: unknown }).fundingIntervalHours)));
    if (cadences.size > 1) return { statut: "indisponible", raison: "cadences funding contradictoires" };
    const intervalHours = correspondances.length === 0 ? 8 : parseBinanceFundingIntervalH(info.json, symbol);
    if (intervalHours === null) return { statut: "indisponible", raison: "cadence funding invalide" };
    if (fj.symbol !== symbol || !Number.isFinite(fundingRate) || !(nextFundingTime > maintenant) || !(intervalHours > 0 && intervalHours <= 24) || !Number.isFinite(fundingTime) || fundingTime > maintenant || maintenant - fundingTime > 5_000) return { statut: "indisponible", raison: "funding ou cadence indisponible" };
    funding.fenetre.observeLe = fundingTime;
    return { statut: "ok", quote: { symbol, base: symbol === "BTCUSDT" ? "BTC" : "ETH", quote: "USDT", reglement: "USDT", quantite, spotEntree, perpEntree,
      spot: spot.fenetre, perp: perp.fenetre, financement: funding.fenetre, fundingRate, intervalHours, nextFundingTime,
      limite: "heure de cotation spot inconnue ; acquisitions rapprochées, cotations non garanties simultanées" } };
  } catch {
    return { statut: "indisponible", raison: ctl.signal.aborted ? "acquisition annulée ou délai de 15 s" : "source publique indisponible" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stopper);
  }
}
