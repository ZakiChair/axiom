/**
 * Modèle d'affichage PUR de la section DES « Flux takers toutes places » (CryptoQuant).
 *
 * L'agrégat du fournisseur est consommé tel quel : ratio achat/vente, part acheteurs, volumes
 * et VWAP sont lus sans recalcul. Seuls des dérivés d'AFFICHAGE sont produits ici : Δ taker
 * en quote, cumul 7 j, situation du ratio dans l'archive (`situer`), écart du volume à sa
 * médiane et points de courbe à dates réelles.
 *
 * Ce module n'importe que des TYPES du client CryptoQuant : une valeur importée ici ferait
 * entrer le client dans le chunk de DES et casserait son chargement à la demande (garde-fou
 * `src/chunkCryptoquant.test.ts`). `situer`, qui ne sert qu'à l'affichage, vit donc ici et
 * non dans le client.
 */
import type { ArchiveCq, LigneCq, LigneTaker, SerieCq } from "../data/onchain/cryptoquant";

export type ActifTaker = "btc" | "eth";
export type MarcheTaker = "spot" | "swap";

export interface SelectionTaker {
  actif: ActifTaker;
  marche: MarcheTaker;
}

export interface ModeleFluxTakers {
  /** Jour affiché : dernier jour clos archivé (J-1 quand il est publié), sinon null. */
  jour: string | null;
  ratio: number | null;
  partAcheteursPct: number | null;
  situation: { min: number; mediane: number; max: number; rang: number; n: number } | null;
  deltaQuote: number | null;
  cumul7: { valeur: number | null; presents: number };
  volumeQuote: number | null;
  volumeBase: number | null;
  trades: number | null;
  vwap: number | null;
  vsMediane30Pct: number | null;
  courbe: Array<{ jour: string; valeur: number | null }>;
}

const JOUR_MS = 86_400_000;
/** Cumul du Δ taker : 7 jours CALENDAIRES se terminant au jour affiché, tous requis. */
const JOURS_CUMUL = 7;
/** Médiane de volume : 30 derniers jours PRÉSENTS, jour affiché inclus. */
const JOURS_MEDIANE = 30;

/** Série CryptoQuant de la sélection (marché puis actif, comme le catalogue du client). */
export function serieTaker(sel: SelectionTaker): SerieCq {
  return `taker:${sel.marche}:${sel.actif}` as const;
}

function estTaker(ligne: LigneCq): ligne is LigneTaker {
  return "bsr" in ligne;
}

function fini(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/** Jour UTC « YYYY-MM-DD » décalé de `n` jours (négatif = passé). */
function decalerJour(jour: string, n: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR_MS).toISOString().slice(0, 10);
}

/** Médiane d'une liste NON vide déjà triée par ordre croissant (paire : moyenne des centrales). */
function medianeTriee(tries: readonly number[]): number {
  const milieu = Math.floor(tries.length / 2);
  return tries.length % 2 === 1 ? tries[milieu]! : (tries[milieu - 1]! + tries[milieu]!) / 2;
}

/**
 * Situe `v` parmi `valeurs` : min · médiane · max · rang (1 = plus bas) · N, sur les seules
 * valeurs finies. Ex æquo : rang = 1 + nombre de valeurs STRICTEMENT inférieures. `null` sous
 * deux valeurs ou si `v` n'est pas fini : jamais un percentile sur trop peu de points.
 */
export function situer(
  valeurs: readonly number[],
  v: number,
): { min: number; mediane: number; max: number; rang: number; n: number } | null {
  const tries = valeurs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const min = tries[0];
  const max = tries[tries.length - 1];
  if (tries.length < 2 || !Number.isFinite(v) || min === undefined || max === undefined) return null;
  return {
    min,
    mediane: medianeTriee(tries),
    max,
    rang: 1 + tries.filter((x) => x < v).length,
    n: tries.length,
  };
}

function modeleVide(): ModeleFluxTakers {
  return {
    jour: null,
    ratio: null,
    partAcheteursPct: null,
    situation: null,
    deltaQuote: null,
    cumul7: { valeur: null, presents: 0 },
    volumeQuote: null,
    volumeBase: null,
    trades: null,
    vwap: null,
    vsMediane30Pct: null,
    courbe: [],
  };
}

/** Construit le modèle d'une série taker à partir de son archive. PURE. */
export function construireModeleFluxTakers(archive: ArchiveCq | null, aujourdhuiUtc: string): ModeleFluxTakers {
  // Jours clos uniquement (strictement avant aujourd'hui UTC), lignes taker, ordre croissant.
  const entrees = Object.entries(archive?.jours ?? {})
    .filter((e): e is [string, LigneTaker] => e[0] < aujourdhuiUtc && estTaker(e[1]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const premiere = entrees[0];
  const derniere = entrees.at(-1);
  if (premiere === undefined || derniere === undefined) return modeleVide();
  const [jour, ligne] = derniere;
  const parJour = new Map(entrees);

  // Cumul 7 j : une valeur seulement si les sept jours calendaires sont archivés.
  let presents = 0;
  let somme = 0;
  for (let k = 0; k < JOURS_CUMUL; k++) {
    const l = parJour.get(decalerJour(jour, -k));
    if (l === undefined) continue;
    presents += 1;
    somme += l.qbv - l.qsv;
  }

  // Volume quote du jour contre la médiane des 30 derniers jours présents (jour inclus).
  const volumes = entrees
    .slice(-JOURS_MEDIANE)
    .map(([, l]) => l.qv)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const mediane = volumes.length >= 2 ? medianeTriee(volumes) : null;
  const vsMediane30Pct =
    mediane !== null && mediane > 0 && Number.isFinite(ligne.qv) ? (ligne.qv / mediane - 1) * 100 : null;

  // Courbe : chaque jour calendaire de l'archive, null quand il manque (ligne coupée).
  const courbe: ModeleFluxTakers["courbe"] = [];
  for (let j = premiere[0]; j <= jour; j = decalerJour(j, 1)) {
    const l = parJour.get(j);
    courbe.push({ jour: j, valeur: l === undefined ? null : fini(l.bsr) });
  }

  return {
    jour,
    ratio: fini(ligne.bsr),
    partAcheteursPct: Number.isFinite(ligne.br) ? ligne.br * 100 : null,
    situation: situer(
      entrees.map(([, l]) => l.bsr),
      ligne.bsr,
    ),
    deltaQuote: fini(ligne.qbv - ligne.qsv),
    cumul7: { valeur: presents === JOURS_CUMUL ? somme : null, presents },
    volumeQuote: fini(ligne.qv),
    volumeBase: fini(ligne.bv),
    trades: fini(ligne.n),
    vwap: fini(ligne.vwap),
    vsMediane30Pct,
    courbe,
  };
}
