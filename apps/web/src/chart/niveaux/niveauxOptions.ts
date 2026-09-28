/**
 * Niveaux d'options Deribit sur le chart maître (chunk paresseux) : murs de gamma, deux gamma
 * flips et max pain de l'échéance dominante, pour BTC et ETH cotés en dollar.
 *
 * Calcul = COMPOSITION des fonctions d'OMON sur la même chaîne (aucune formule recopiée) :
 * spot de la chaîne, GEX par strike toutes échéances, murs, flip cumulé par strike, profil
 * GEX(S) sur 41 spots à ±15 % et max pain. Convention de signe d'OMON : calls +, puts −
 * (hypothèse sur la position des dealers, rappelée par la commande). Deux flips distincts :
 * « Flip GEX(S) » est le zéro du profil recalculé en spot ; « Flip cumulé » le changement de
 * signe du GEX cumulé par strike, affiché uniquement sous son nom de cumul.
 * Le max pain est celui de l'échéance au plus grand open interest, date dans l'étiquette.
 */
import type { Unsubscribe } from "@axiom/types";
import { computeMaxPain, type OptionPoint, type StrikeOi } from "../../data/deribit";
import { gammaFlip, gexParStrikeToutesEcheances, mursGamma, profilGexSpot } from "../../data/gexDex";
import {
  TTL_CHAINE_MS,
  actifDeribit,
  chargerChaineOptions,
  limiteChaineOptions,
  spotDeChaine,
  type ChaineOptionsChargee,
  type DeviseDeribit,
} from "../../data/chaineOptionsCache";
import { pousserToast } from "../../store/toasts";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import type { ContexteNiveaux } from "../niveauxOverlays";

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
 * Source « niveaux d’options » d’un slot : chargement sérialisé, renouvelé au TTL ou à
 * l’expiration la plus proche. Les lignes sont retirées à cette frontière même si le réseau
 * bloque ; aucun calcul dans getLignes. Un échec ou un marché non éligible est expliqué.
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
      let enChargement = false;
      let minuteur: ReturnType<typeof setTimeout> | undefined;
      const effacerPerimes = (): void => {
        if (calculeSur !== null && maintenant() >= limiteChaineOptions(calculeSur)) {
          calculeSur = null;
          niveaux = null;
          onChange();
        }
      };
      const programmer = (): void => {
        clearTimeout(minuteur);
        const fin = calculeSur === null ? maintenant() + TTL_CHAINE_MS : limiteChaineOptions(calculeSur);
        minuteur = setTimeout(() => {
          effacerPerimes();
          charge();
        }, Math.max(1, fin - maintenant()));
      };
      const charge = (): void => {
        if (annule || enChargement) return;
        enChargement = true;
        void charger(devise, maintenant()).catch(() => null).then((res) => {
          if (annule) return;
          const now = maintenant();
          effacerPerimes();
          if (res === null) {
            if (!echecSignale) toast(`Niveaux d'options : chaîne Deribit ${devise} indisponible, nouvel essai dans 10 min`);
            echecSignale = true;
            return;
          }
          echecSignale = false;
          // L’horloge est relue APRÈS le réseau : aucune option expirée pendant l’attente.
          calculeSur = now < limiteChaineOptions(res) ? res : null;
          niveaux = calculeSur === null ? null : calculerNiveauxOptions(res.chaine, now);
          if (lignesNiveauxOptions(niveaux).length === 0) {
            toast(`Niveaux d'options : aucun niveau calculable sur la chaîne Deribit ${devise}`);
          }
          onChange();
        }).finally(() => {
          enChargement = false;
          if (!annule) programmer();
        });
      };
      // Un overlay peut être réactivé avec un ancien snapshot : purger/réarmer avant le réseau.
      effacerPerimes();
      if (calculeSur !== null) programmer();
      charge();
      return () => {
        annule = true;
        clearTimeout(minuteur);
      };
    },
  };
}
