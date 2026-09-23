/** Stabilité du coût L2 : créneaux réguliers en mémoire bornée. */
import type { OrderBook } from "./depth";
import { meilleursNiveaux } from "./depth";
import { coutExecution } from "./depthExecution";
import { splitSymbol } from "./symbol";

/** Devise réellement consommée par le carnet Binance, sans conversion implicite. */
export function cotationCarnetBinance(symbol: string): string | null {
  const normalise = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalise)) return null;
  try {
    const { base, quote } = splitSymbol(normalise, "Binance spot");
    return /^[A-Z0-9]+$/.test(base) ? quote : null;
  } catch {
    return null;
  }
}

export type FenetreStabilite = 1 | 5 | 15;
type EtatCote = "valide" | "insuffisant" | "invalide";
interface EchantillonCote { etat: EtatCote; bps: number | null }
interface Echantillon { t: number; creneau: number; distinct: boolean; achat: EchantillonCote; vente: EchantillonCote }

export interface VueStabiliteCote {
  courantBps: number | null;
  medianeBps: number | null;
  p95Bps: number | null;
  observations: number;
  /** Nombre de versions différentes, diagnostic distinct du poids temporel. */
  versionsDistinctes: number;
  creneauxCouverts: number;
  insuffisants: number;
  proportionInsuffisante: number;
  /** Couverture des créneaux réellement écoulés depuis le début de la session. */
  couverture: number;
  /** Couverture de la fenêtre demandée complète, y compris pendant la chauffe. */
  couvertureFenetre: number;
}
export interface VueStabiliteFenetre {
  dureeMs: number;
  attendus: number;
  attendusFenetre: number;
  invalides: number;
  achat: VueStabiliteCote;
  vente: VueStabiliteCote;
}
export interface VueStabiliteCarnet {
  notionnelCotation: number;
  ageMs: number | null;
  fenetres: Record<FenetreStabilite, VueStabiliteFenetre>;
}

const CADENCE_MS = 1_000;
const HISTORIQUE_MS = 15 * 60_000;
const AGE_MAX_MS = 5_000;
const MIN_QUANTILES = 20;

/** Quantile interpolé à l'indice (n−1)p ; indépendant du seuil de publication UI. */
export function quantileLineaire(valeurs: readonly number[], p: number): number | null {
  if (valeurs.length === 0 || !Number.isFinite(p) || p < 0 || p > 1 || valeurs.some((v) => !Number.isFinite(v))) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const h = (triees.length - 1) * p;
  const bas = Math.floor(h);
  const poids = h - bas;
  return triees[bas]! + (triees[Math.min(triees.length - 1, bas + 1)]! - triees[bas]!) * poids;
}

function carnetValide(livre: OrderBook): boolean {
  if (!Number.isSafeInteger(livre.lastUpdateId) || livre.lastUpdateId < 0) return false;
  const best = meilleursNiveaux(livre);
  if (!best || !(best.bestBid > 0) || !(best.bestAsk > best.bestBid)) return false;
  for (const cote of [livre.bids, livre.asks]) {
    for (const [prix, quantite] of cote) {
      if (!(prix > 0) || !Number.isFinite(prix) || !(quantite > 0) || !Number.isFinite(quantite)) return false;
    }
  }
  return true;
}

const INVALIDE: EchantillonCote = { etat: "invalide", bps: null };

export class StabiliteCarnet {
  private readonly echantillons: Echantillon[] = [];
  private dernierCreneau: number | null = null;
  private derniereVersion: number | null = null;
  private courant: { achat: EchantillonCote; vente: EchantillonCote; recuA: number } | null = null;
  private dernierRecuA: number | null = null;

  constructor(readonly notionnelCotation: number, private readonly depuis: number) {
    if (!(notionnelCotation > 0) || !Number.isFinite(notionnelCotation)) throw new Error("Notionnel invalide");
  }

  /** Un appel par seconde réelle ; les créneaux manqués restent absents, jamais remplis. */
  echantillonner(t: number, livre: OrderBook | null, recuA: number | null): void {
    if (!Number.isFinite(t) || t < this.depuis) return;
    const creneau = Math.floor((t - this.depuis) / CADENCE_MS);
    if (this.dernierCreneau !== null && creneau <= this.dernierCreneau) return;
    this.dernierCreneau = creneau;
    if (recuA !== null && Number.isFinite(recuA) && recuA <= t) this.dernierRecuA = recuA;
    const premierRecent = this.echantillons.findIndex((e) => e.creneau > creneau - HISTORIQUE_MS / CADENCE_MS);
    this.echantillons.splice(0, premierRecent < 0 ? this.echantillons.length : premierRecent);
    if (livre === null || recuA === null || recuA > t || t - recuA > AGE_MAX_MS) {
      this.courant = null;
      return;
    }
    if (!carnetValide(livre)) {
      this.courant = { achat: INVALIDE, vente: INVALIDE, recuA };
      if (creneau > 0) this.echantillons.push({ t, creneau, distinct: false, achat: INVALIDE, vente: INVALIDE });
      return;
    }
    const lire = (cote: "achat" | "vente"): EchantillonCote => {
      const r = coutExecution(livre, cote, this.notionnelCotation);
      return r === null ? INVALIDE : r.couvert && Number.isFinite(r.slippageBps)
        ? { etat: "valide", bps: r.slippageBps }
        : { etat: "insuffisant", bps: null };
    };
    const achat = lire("achat");
    const vente = lire("vente");
    this.courant = { achat, vente, recuA };
    if (creneau === 0) return; // replay synchrone : coût courant, aucune seconde écoulée
    const distinct = livre.lastUpdateId !== this.derniereVersion;
    this.derniereVersion = livre.lastUpdateId;
    this.echantillons.push({ t, creneau, distinct, achat, vente });
    if (this.echantillons.length > 900) this.echantillons.splice(0, this.echantillons.length - 900);
  }

  vue(t: number): VueStabiliteCarnet {
    const ageMs = this.dernierRecuA === null ? null : t - this.dernierRecuA;
    const courantFrais = ageMs !== null && ageMs >= 0 && ageMs <= AGE_MAX_MS;
    const creneauCourant = Math.max(0, Math.floor((t - this.depuis) / CADENCE_MS));
    const fenetre = (minutes: FenetreStabilite): VueStabiliteFenetre => {
      const dureeMs = Math.max(0, Math.min(t - this.depuis, minutes * 60_000));
      const attendus = Math.min(minutes * 60, creneauCourant);
      const attendusFenetre = minutes * 60;
      const points = this.echantillons.filter((e) => e.creneau > creneauCourant - attendusFenetre && e.creneau <= creneauCourant);
      const cote = (sens: "achat" | "vente"): VueStabiliteCote => {
        const valides = points.flatMap((p) => p[sens].etat === "valide" && p[sens].bps !== null ? [p[sens].bps] : []);
        const versionsDistinctes = points.filter((p) => p.distinct && p[sens].etat === "valide").length;
        const creneauxCouverts = points.filter((p) => p[sens].etat === "valide").length;
        const insuffisants = points.filter((p) => p[sens].etat === "insuffisant").length;
        return {
          courantBps: courantFrais && this.courant?.[sens].etat === "valide" ? this.courant[sens].bps : null,
          medianeBps: valides.length >= MIN_QUANTILES ? quantileLineaire(valides, 0.5) : null,
          p95Bps: valides.length >= MIN_QUANTILES ? quantileLineaire(valides, 0.95) : null,
          observations: valides.length,
          versionsDistinctes,
          creneauxCouverts,
          insuffisants,
          proportionInsuffisante: attendus > 0 ? insuffisants / attendus : 0,
          couverture: attendus > 0 ? creneauxCouverts / attendus : 0,
          couvertureFenetre: creneauxCouverts / attendusFenetre,
        };
      };
      return { dureeMs, attendus, attendusFenetre, invalides: points.filter((p) => p.achat.etat === "invalide" || p.vente.etat === "invalide").length, achat: cote("achat"), vente: cote("vente") };
    };
    return { notionnelCotation: this.notionnelCotation, ageMs, fenetres: { 1: fenetre(1), 5: fenetre(5), 15: fenetre(15) } };
  }
}
