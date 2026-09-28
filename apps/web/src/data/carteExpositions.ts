/** Transformations pures pour la carte GEX/DEX et le profil simulé d’OMON.
 * Les calculs de greeks restent exclusivement dans le moteur GEX/DEX validé.
 */
import { computeCryptoGexDex, type CryptoOptionInput, type GexDexPoint } from "./gexDex";

export interface SourceEcheanceExposition {
  expiryMs: number;
  points: GexDexPoint[];
}

export interface TotauxExpositions {
  /** null = aucune contribution calculable ; 0 = somme calculée réellement nulle. */
  gex: number | null;
  dex: number | null;
  /** Couples (échéance, strike) calculables ; les jambes call/put ne sont pas recomptées. */
  nbStrikes: number;
}

export interface BandeExpositions extends TotauxExpositions {
  idBande: string;
  label: string;
  /** Distance au spot, en pourcentage : borne inférieure inclusive. */
  minPct: number;
  /** Borne supérieure exclusive ; null représente +∞. */
  maxPct: number | null;
}

export interface ColonneExpositions extends TotauxExpositions {
  expiryMs: number;
}

export interface CelluleExpositions extends TotauxExpositions {
  idBande: string;
  expiryMs: number;
  /** Strikes uniques, triés croissant, avec expositions signées. */
  strikes: GexDexPoint[];
}

export interface CarteExpositions {
  /** Huit bandes exhaustives, du prix le plus haut au plus bas. */
  bandes: BandeExpositions[];
  /** Échéances uniques, triées chronologiquement. */
  colonnes: ColonneExpositions[];
  /** Ordre des bandes, puis ordre chronologique des colonnes dans chaque bande. */
  cellules: CelluleExpositions[];
  total: TotauxExpositions;
}

const BANDES = [
  { idBande: "haut30", label: "+30 % et plus", minPct: 30, maxPct: null, facteurMin: 1.3 },
  { idBande: "haut15", label: "+15 à +30 %", minPct: 15, maxPct: 30, facteurMin: 1.15 },
  { idBande: "haut5", label: "+5 à +15 %", minPct: 5, maxPct: 15, facteurMin: 1.05 },
  { idBande: "haut0", label: "0 à +5 %", minPct: 0, maxPct: 5, facteurMin: 1 },
  { idBande: "bas5", label: "−5 à 0 %", minPct: -5, maxPct: 0, facteurMin: .95 },
  { idBande: "bas15", label: "−15 à −5 %", minPct: -15, maxPct: -5, facteurMin: .85 },
  { idBande: "bas30", label: "−30 à −15 %", minPct: -30, maxPct: -15, facteurMin: .7 },
  { idBande: "bas100", label: "Sous −30 %", minPct: -100, maxPct: -30, facteurMin: 0 },
] as const;

function vide(): TotauxExpositions {
  return { gex: null, dex: null, nbStrikes: 0 };
}

/** Sommes signées uniquement : un solde nul garde sa présence via nbStrikes. */
function sommer(totaux: readonly TotauxExpositions[]): TotauxExpositions {
  const presents = totaux.filter((t) => t.nbStrikes > 0);
  if (presents.length === 0) return vide();
  return {
    gex: presents.reduce((s, t) => s + (t.gex ?? 0), 0),
    dex: presents.reduce((s, t) => s + (t.dex ?? 0), 0),
    nbStrikes: presents.reduce((s, t) => s + t.nbStrikes, 0),
  };
}

/**
 * Chaque point valide contribue à une seule cellule, sans seuil de taille.
 * Aucune horloge implicite : l’appelant choisit les échéances (seuls les timestamps
 * non finis/non positifs sont rejetés). Un spot invalide rend toutes les cellules absentes.
 */
export function construireCarteExpositions(sources: SourceEcheanceExposition[], spot: number): CarteExpositions {
  const echeances = [...new Set(sources.map((s) => s.expiryMs).filter((t) => Number.isFinite(t) && t > 0))].sort((a, b) => a - b);
  const cellules: CelluleExpositions[] = BANDES.flatMap((b) => echeances.map((expiryMs) => ({
    ...vide(), idBande: b.idBande, expiryMs, strikes: [],
  })));
  const parCle = new Map(cellules.map((c) => [`${c.idBande}:${c.expiryMs}`, c]));

  if (Number.isFinite(spot) && spot > 0) {
    for (const source of sources) {
      if (!Number.isFinite(source.expiryMs) || source.expiryMs <= 0) continue;
      for (const p of source.points) {
        if (!Number.isFinite(p.strike) || p.strike <= 0 || !Number.isFinite(p.gex) || !Number.isFinite(p.dex)) continue;
        // Comparer les PRIX évite l’erreur d’arrondi de (K/S−1) aux frontières.
        const bande = BANDES.find((b) => p.strike >= spot * b.facteurMin)!;
        parCle.get(`${bande.idBande}:${source.expiryMs}`)!.strikes.push({ ...p });
      }
    }
  }

  for (const cellule of cellules) {
    const parStrike = new Map<number, GexDexPoint>();
    for (const p of cellule.strikes) {
      const precedent = parStrike.get(p.strike);
      if (precedent) {
        precedent.gex += p.gex;
        precedent.dex += p.dex;
      } else parStrike.set(p.strike, p);
    }
    cellule.strikes = [...parStrike.values()].sort((a, b) => a.strike - b.strike);
    Object.assign(cellule, sommer(cellule.strikes.map((p) => ({ gex: p.gex, dex: p.dex, nbStrikes: 1 }))));
  }

  return {
    bandes: BANDES.map(({ facteurMin: _facteur, ...bande }) => ({
      ...bande, ...sommer(cellules.filter((c) => c.idBande === bande.idBande)),
    })),
    colonnes: echeances.map((expiryMs) => ({ expiryMs, ...sommer(cellules.filter((c) => c.expiryMs === expiryMs)) })),
    cellules,
    total: sommer(cellules),
  };
}

/** Une colonne par échéance active, même si aucune option ne possède de greeks calculables. */
export function construireSourcesCrypto(chain: CryptoOptionInput[], spot: number, nowMs: number): SourceEcheanceExposition[] {
  if (!Number.isFinite(nowMs)) return [];
  const groupes = new Map<number, CryptoOptionInput[]>();
  for (const p of chain) {
    if (!Number.isFinite(p.expiryMs) || p.expiryMs <= 0 || p.expiryMs <= nowMs) continue;
    const groupe = groupes.get(p.expiryMs);
    if (groupe) groupe.push(p);
    else groupes.set(p.expiryMs, [p]);
  }
  return [...groupes].sort((a, b) => a[0] - b[0]).map(([expiryMs, points]) => ({
    expiryMs, points: computeCryptoGexDex(points, spot, nowMs),
  }));
}

export interface ProfilExpositionsCrypto {
  points: { spot: number; gex: number; dex: number }[];
}

/**
 * 41 spots à ±15 %, spot exact au centre. IV, OI, échéances et base forward/index
 * restent fixés ; seul le prix simulé varie dans computeCryptoGexDex.
 */
export function profilExpositionsCrypto(chain: CryptoOptionInput[], spot: number, nowMs: number): ProfilExpositionsCrypto {
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(nowMs)) return { points: [] };
  const points = Array.from({ length: 41 }, (_, i) => spot + (spot * .15 * (i - 20)) / 20).flatMap((s) => {
    const calcul = computeCryptoGexDex(chain, s, nowMs);
    if (calcul.length === 0) return [];
    return [{ spot: s, gex: calcul.reduce((somme, p) => somme + p.gex, 0), dex: calcul.reduce((somme, p) => somme + p.dex, 0) }];
  });
  return { points };
}
