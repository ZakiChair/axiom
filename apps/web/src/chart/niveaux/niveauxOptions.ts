/**
 * Niveaux d'options Deribit sur le chart maître (chunk paresseux) : murs de gamma, deux gamma
 * flips et max pain de l'échéance dominante, pour BTC et ETH cotés en dollar.
 *
 * Calcul = COMPOSITION des fonctions d'OMON sur la même chaîne (aucune formule recopiée) :
 * spot de la chaîne, GEX par strike toutes échéances, murs, flip cumulé par strike, profil
 * GEX(S) sur 41 spots à ±15 % et max pain. Convention de signe d'OMON : calls +, puts −
 * (hypothèse sur la position des dealers, rappelée par la commande). Deux flips distincts :
 * « Flip GEX(S) » est le zéro du profil recalculé en spot ; « Flip cumulé » le changement de
 * signe du GEX cumulé par strike, celui dont REGIME et BRIEF affichent la distance.
 * Le max pain est celui de l'échéance au plus grand open interest, date dans l'étiquette.
 */
import type { Unsubscribe } from "@axiom/types";
import { computeMaxPain, type OptionPoint, type StrikeOi } from "../../data/deribit";
import { gammaFlip, gexParStrikeToutesEcheances, mursGamma, profilGexSpot } from "../../data/gexDex";
import {
  TTL_CHAINE_MS,
  actifDeribit,
  chargerChaineOptions,
  spotDeChaine,
  type ChaineOptionsChargee,
  type DeviseDeribit,
} from "../../data/chaineOptionsCache";
import { formatDateHeure } from "../../lib/format";
import { pousserToast } from "../../store/toasts";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import type { ContexteNiveaux } from "../niveauxOverlays";

/** Marge du rafraîchissement : le tick doit trouver la chaîne en cache déjà périmée. */
const MARGE_RAFRAICHISSEMENT_MS = 1_000;

export interface NiveauxOptions {
  spot: number;
  callWall: number | null;
  putWall: number | null;
  /** Zéro du profil GEX(S) (`profilGexSpot().flipReel`). */
  flipProfil: number | null;
  /** Changement de signe du GEX cumulé par strike (`gammaFlip`). */
  flipCumul: number | null;
  echeanceDominante: number | null;
  /** Échéance dominante au format des instruments Deribit (« 25SEP26 »). */
  libelleEcheance: string | null;
  maxPain: number | null;
}

/** Échéance future au Σ OI maximal (égalité → la plus proche), null si aucune OI. PURE. */
export function echeanceDominante(chaine: readonly OptionPoint[], nowMs: number): number | null {
  const parEcheance = new Map<number, number>();
  for (const p of chaine) {
    if (p.expiryMs <= nowMs) continue;
    const oi = Number.isFinite(p.openInterest) ? p.openInterest : 0;
    parEcheance.set(p.expiryMs, (parEcheance.get(p.expiryMs) ?? 0) + oi);
  }
  let meilleure: number | null = null;
  let oiMax = 0;
  for (const [expiryMs, oi] of [...parEcheance].sort((a, b) => a[0] - b[0])) {
    if (oi > oiMax) {
      oiMax = oi;
      meilleure = expiryMs;
    }
  }
  return meilleure;
}

/** OI calls / puts par strike — copie d'`agregerParStrike` (OptionsWindow, non exportée). PURE. */
export function oiParStrike(points: readonly OptionPoint[]): StrikeOi[] {
  const parStrike = new Map<number, StrikeOi>();
  for (const p of points) {
    const cur = parStrike.get(p.strike) ?? { strike: p.strike, callOi: 0, putOi: 0 };
    if (p.type === "call") cur.callOi += Number.isFinite(p.openInterest) ? p.openInterest : 0;
    else cur.putOi += Number.isFinite(p.openInterest) ? p.openInterest : 0;
    parStrike.set(p.strike, cur);
  }
  return [...parStrike.values()].sort((a, b) => a.strike - b.strike);
}

/** PURE — niveaux d'options de la chaîne à `nowMs` ; null sans spot exploitable. */
export function calculerNiveauxOptions(chaine: readonly OptionPoint[], nowMs: number): NiveauxOptions | null {
  const spot = spotDeChaine(chaine);
  if (!Number.isFinite(spot)) return null;
  const gex = gexParStrikeToutesEcheances([...chaine], spot, nowMs);
  const { callWall, putWall } = mursGamma(gex);
  const spots = Array.from({ length: 41 }, (_, i) => spot * (0.85 + (0.3 * i) / 40));
  const exp = echeanceDominante(chaine, nowMs);
  const pointsEcheance = chaine.filter((p) => p.expiryMs === exp);
  return {
    spot,
    callWall,
    putWall,
    flipProfil: profilGexSpot([...chaine], spots, nowMs).flipReel,
    flipCumul: gammaFlip(gex),
    echeanceDominante: exp,
    libelleEcheance: pointsEcheance[0]?.instrument.split("-")[1] ?? null,
    maxPain: exp === null ? null : computeMaxPain(oiParStrike(pointsEcheance)),
  };
}

/** PURE — lignes du chart ; un niveau absent ne donne pas de ligne. */
export function lignesNiveauxOptions(n: NiveauxOptions | null): LigneNiveau[] {
  if (n === null) return [];
  const candidates: [number | null, string, string, LigneNiveau["emphase"]][] = [
    [n.callWall, "Call wall γ", "--up", "forte"],
    [n.putWall, "Put wall γ", "--down", "forte"],
    [n.flipProfil, "Flip GEX(S)", "--accent", "forte"],
    [n.flipCumul, "Flip cumulé", "--accent", "faible"],
    [n.libelleEcheance === null ? null : n.maxPain, `Max pain ${n.libelleEcheance}`, "--text-dim", "faible"],
  ];
  return candidates.flatMap(([price, label, couleur, emphase]) => (price === null ? [] : [{ price, label, couleur, emphase }]));
}

export interface DepsSourceNiveauxOptions {
  charger?: (devise: DeviseDeribit, nowMs: number) => Promise<ChaineOptionsChargee | null>;
  maintenant?: () => number;
  toast?: (texte: string) => void;
}

/**
 * Source « niveaux d'options » d'un slot : chaîne chargée au subscribe puis à chaque TTL, calcul
 * fait UNE fois par chaîne reçue (jamais dans `getLignes`). Un échec garde les dernières lignes
 * et dit de quand elles datent ; un marché non éligible ou une chaîne sans niveau calculable
 * est expliqué par toast (jamais d'overlay muet).
 */
export function creerSourceNiveauxOptions(ctx: ContexteNiveaux, deps: DepsSourceNiveauxOptions = {}): FournisseurLignes {
  const charger = deps.charger ?? chargerChaineOptions;
  const maintenant = deps.maintenant ?? Date.now;
  const toast = deps.toast ?? pousserToast;
  const devise = actifDeribit(ctx.exchange, ctx.symbol);
  let calculeSur: ChaineOptionsChargee | null = null;
  let niveaux: NiveauxOptions | null = null;

  return {
    getLignes: () => lignesNiveauxOptions(niveaux),
    subscribe(onChange): Unsubscribe {
      if (devise === null) {
        toast(`Niveaux d'options : BTC et ETH cotés en dollar seulement (chaîne Deribit), pas ${ctx.symbol}`);
        return () => {};
      }
      let annule = false;
      let echecSignale = false;
      const charge = (): void => {
        const now = maintenant();
        void charger(devise, now).then((res) => {
          if (annule) return;
          if (res === null) {
            const conservees =
              calculeSur !== null && lignesNiveauxOptions(niveaux).length > 0
                ? `, lignes du ${formatDateHeure(calculeSur.recupereLe)} conservées`
                : "";
            if (!echecSignale) toast(`Niveaux d'options : chaîne Deribit ${devise} indisponible${conservees}, nouvel essai dans 10 min`);
            echecSignale = true;
            return;
          }
          echecSignale = false;
          if (res.chaine !== calculeSur?.chaine) {
            calculeSur = res;
            niveaux = calculerNiveauxOptions(res.chaine, now);
            if (lignesNiveauxOptions(niveaux).length === 0) {
              toast(`Niveaux d'options : aucun niveau calculable sur la chaîne Deribit ${devise}`);
            }
          }
          onChange();
        });
      };
      charge();
      const minuteur = setInterval(charge, TTL_CHAINE_MS + MARGE_RAFRAICHISSEMENT_MS);
      return () => {
        annule = true;
        clearInterval(minuteur);
      };
    },
  };
}
