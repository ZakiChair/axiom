/**
 * Bandes de mouvement attendu implicite sur le chart maître (chunk paresseux) : ±1σ et ±2σ
 * ancrées sur l'ouverture du jour UTC (horizon 1 j, suffixe « J ») et sur l'ouverture du lundi
 * UTC (horizon 7 j, suffixe « S »), pour BTC et ETH cotés en dollar.
 *
 * IV OBSERVÉE À L'ANCRE : DVOL Deribit de clôture de la bougie quotidienne précédente (veille
 * pour le jour, dimanche pour la semaine) ; σ = DVOL/100 × √(jours/365), bande = ancre × (1 ± kσ).
 * C'est la mesure calibrée par la recherche : ≈ 78 % des clôtures quotidiennes dans ±1σ sur
 * 998 jours (déc. 2023 – sept. 2026), 76,8 % des semaines. Le DVOL est une IV à maturité
 * constante 30 j : ce n'est ni l'IV de l'échéance du lendemain ni une borne, c'est l'amplitude
 * payée par les options (l'IV ATM par échéance sert au mouvement attendu d'OMON, pas ici).
 * Ancres = mêmes bougies 1d que les niveaux clés (cache par jour partagé, aucun appel en plus).
 */
import type { Candle, Unsubscribe } from "@axiom/types";
import { utcDayOf } from "@axiom/indicators";
import { actifDeribit, type DeviseDeribit } from "../../data/chaineOptionsCache";
import { pousserToast } from "../../store/toasts";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import type { ContexteNiveaux } from "../niveauxOverlays";
import { bougiesJourDisponibles, chargerBougiesJour, msAvantProchainJourUtc } from "./bougiesJour";
import { chargerDvolJour, type PointDvol } from "./dvolJour";
import { calculerNiveauxCles } from "./niveauxCles";

const JOUR_MS = 86_400_000;
/** Nouvel essai après un échec ou une bande incalculable. */
const REESSAI_MS = 5 * 60_000;
/** Marge après minuit UTC avant de recharger (la bougie du nouveau jour doit exister). */
const MARGE_JOUR_MS = 5_000;

export interface Bandes {
  plus1: number;
  moins1: number;
  plus2: number;
  moins2: number;
}

/** PURE — σ = ivPct/100 × √(horizonJours/365) ; null si une entrée n'est pas finie et > 0. */
export function bandesImplicites(ancre: number, ivPct: number, horizonJours: number): Bandes | null {
  if (![ancre, ivPct, horizonJours].every((v) => Number.isFinite(v) && v > 0)) return null;
  const sigma = (ivPct / 100) * Math.sqrt(horizonJours / 365);
  return { plus1: ancre * (1 + sigma), moins1: ancre * (1 - sigma), plus2: ancre * (1 + 2 * sigma), moins2: ancre * (1 - 2 * sigma) };
}

/** PURE — clôture de la bougie DVOL stampée exactement à `jourMs` (jamais la plus proche). */
export function dvolCloture(points: readonly PointDvol[] | null, jourMs: number): number | null {
  const v = points?.find((p) => p.time === jourMs)?.value;
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : null;
}

export interface BandeAncree {
  ancre: number;
  ivPct: number;
  bandes: Bandes;
}

export interface BandesImplicitesCalculees {
  jour: BandeAncree | null;
  semaine: BandeAncree | null;
  /** 00:00 UTC du jour de calcul (ms) : des bandes d'un autre jour ne sont jamais affichées. */
  ancreJourMs: number;
}

/** PURE — bandes du jour et de la semaine à `nowMs` ; une ancre ou une clôture absente → null. */
export function calculerBandesImplicites(bougies1d: readonly Candle[], dvol: readonly PointDvol[], nowMs: number): BandesImplicitesCalculees {
  const n = calculerNiveauxCles(bougies1d, nowMs);
  const bande = (ancre: number | null, ancreMs: number, jours: number): BandeAncree | null => {
    const ivPct = dvolCloture(dvol, ancreMs - JOUR_MS);
    if (ancre === null || ivPct === null) return null;
    const bandes = bandesImplicites(ancre, ivPct, jours);
    return bandes === null ? null : { ancre, ivPct, bandes };
  };
  return {
    jour: bande(n.ouvertureJour, n.ancreJourMs, 1),
    semaine: bande(n.ouvertureSemaine, n.ancreSemaineMs, 7),
    ancreJourMs: n.ancreJourMs,
  };
}

/** PURE — ±1σ en trait fort, ±2σ en pointillé ; une bande absente ne donne aucune ligne. */
export function lignesBandesImplicites(b: BandesImplicitesCalculees | null): LigneNiveau[] {
  if (b === null) return [];
  const out: LigneNiveau[] = [];
  for (const [bande, suffixe] of [[b.jour, "J"], [b.semaine, "S"]] as const) {
    if (bande === null) continue;
    const { plus1, moins1, plus2, moins2 } = bande.bandes;
    const candidates: [number, string, LigneNiveau["emphase"]][] = [
      [plus1, "+1σ", "forte"],
      [moins1, "−1σ", "forte"],
      [plus2, "+2σ", "faible"],
      [moins2, "−2σ", "faible"],
    ];
    for (const [price, k, emphase] of candidates) out.push({ price, label: `${k} ${suffixe} (DVOL)`, couleur: "--accent", emphase });
  }
  return out;
}

export interface DepsSourceBandesImplicites {
  chargerBougies?: (exchange: ContexteNiveaux["exchange"], symbol: string, nowMs: number) => Promise<Candle[] | null>;
  chargerDvol?: (devise: DeviseDeribit, nowMs: number) => Promise<PointDvol[] | null>;
  maintenant?: () => number;
  disponible?: (exchange: ContexteNiveaux["exchange"], symbol: string) => boolean;
  toast?: (texte: string) => void;
}

/**
 * Source « bandes implicites » d'un slot : bougies 1d et DVOL chargés au subscribe, recalcul au
 * changement de jour UTC (bandes de la veille retirées d'abord), nouvel essai toutes les 5 min
 * tant qu'une bande manque. Toujours un toast quand une bande ne peut pas être tracée.
 */
export function creerSourceBandesImplicites(ctx: ContexteNiveaux, deps: DepsSourceBandesImplicites = {}): FournisseurLignes {
  const chargerBougies = deps.chargerBougies ?? chargerBougiesJour;
  const chargerDvol = deps.chargerDvol ?? chargerDvolJour;
  const maintenant = deps.maintenant ?? Date.now;
  const disponible = deps.disponible ?? bougiesJourDisponibles;
  const toast = deps.toast ?? pousserToast;
  const devise = actifDeribit(ctx.exchange, ctx.symbol);
  const marche = `${ctx.symbol} (${ctx.exchange})`;
  let calcul: BandesImplicitesCalculees | null = null;

  return {
    getLignes: () => lignesBandesImplicites(calcul),
    subscribe(onChange): Unsubscribe {
      if (devise === null) {
        toast(`Bandes implicites : BTC et ETH cotés en dollar seulement (DVOL Deribit), pas ${ctx.symbol}`);
        return () => {};
      }
      if (!disponible(ctx.exchange, ctx.symbol)) {
        toast(`Bandes implicites indisponibles : pas de bougies 1d UTC pour ${marche}`);
        return () => {};
      }
      let annule = false;
      let echecSignale = false;
      let minuteur: ReturnType<typeof setTimeout> | undefined;
      const charge = (): void => {
        const now = maintenant();
        if (calcul !== null && calcul.ancreJourMs !== utcDayOf(now) * JOUR_MS) {
          calcul = null; // bandes de la veille : jamais affichées comme celles du jour
          onChange();
        }
        void Promise.all([chargerBougies(ctx.exchange, ctx.symbol, now), chargerDvol(devise, now)]).then(([bougies, dvol]) => {
          if (annule) return;
          let manque: string | null;
          if (bougies === null) manque = `bougies 1d de ${marche} indisponibles`;
          else if (dvol === null) manque = `DVOL Deribit ${devise} indisponible`;
          else {
            calcul = calculerBandesImplicites(bougies, dvol, now);
            onChange();
            const absentes = [calcul.jour === null ? "jour" : null, calcul.semaine === null ? "semaine" : null].filter((b) => b !== null);
            const s = absentes.length > 1 ? "s" : "";
            manque =
              absentes.length === 0
                ? null
                : `bande${s} ${absentes.join(" et ")} incalculable${s} (ouverture 1d ou clôture DVOL de la veille absente)`;
          }
          if (manque === null) {
            echecSignale = false;
            minuteur = setTimeout(charge, msAvantProchainJourUtc(now) + MARGE_JOUR_MS);
            return;
          }
          if (!echecSignale) toast(`Bandes implicites : ${manque}, nouvel essai dans 5 min`);
          echecSignale = true;
          minuteur = setTimeout(charge, REESSAI_MS);
        });
      };
      charge();
      return () => {
        annule = true;
        clearTimeout(minuteur);
      };
    },
  };
}
