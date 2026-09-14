/**
 * Niveaux clés périodiques (chunk paresseux) : extrêmes et clôture de la veille (PDH, PDL,
 * PDC), extrêmes de la semaine et du mois précédents (PWH, PWL, PMH, PML), ouvertures du jour,
 * de la semaine (lundi 00:00 UTC), du mois et du trimestre civil (OJ, OS, OM, OQ).
 *
 * Calcul sur les bougies 1d UTC agrégées par `sessionExtents` (@axiom/indicators, le découpage
 * déjà utilisé par les pivots) ; jamais de bougie du jour dans une période « précédente ». Une
 * période dont le premier ou le dernier jour manque (historique trop court, flux figé) donne
 * null : pas de ligne plutôt qu'un extrême tronqué présenté comme celui de la période.
 * Aucun avantage directionnel démontré : ce sont des niveaux de RÉFÉRENCE (recherche du 14/09).
 */
import type { StoreApi } from "zustand/vanilla";
import type { Candle, Unsubscribe } from "@axiom/types";
import { sessionExtents, utcDayOf } from "@axiom/indicators";
import { pousserToast } from "../../store/toasts";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import {
  FAMILLES_NIVEAUX_CLES,
  niveauxOverlaysStore,
  type ContexteNiveaux,
  type FamilleNiveauxCles,
  type NiveauxOverlaysState,
} from "../niveauxOverlays";
import { bougiesJourDisponibles, chargerBougiesJour, msAvantProchainJourUtc } from "./bougiesJour";

const JOUR_MS = 86_400_000;
/** Nouvel essai après un échec de chargement. */
const REESSAI_MS = 5 * 60_000;
/** Marge après minuit UTC avant de recharger (la bougie du nouveau jour doit exister). */
const MARGE_JOUR_MS = 5_000;

export interface NiveauxCles {
  pdh: number | null;
  pdl: number | null;
  pdc: number | null;
  ouvertureJour: number | null;
  pwh: number | null;
  pwl: number | null;
  ouvertureSemaine: number | null;
  pmh: number | null;
  pml: number | null;
  ouvertureMois: number | null;
  ouvertureTrimestre: number | null;
  /** 00:00 UTC du jour courant (ms). */
  ancreJourMs: number;
  /** Lundi 00:00 UTC de la semaine courante (ms). */
  ancreSemaineMs: number;
}

/** Index de jour UTC du 1er jour d'un mois (mois hors bornes normalisé par Date.UTC). */
const premierDuMois = (annee: number, mois: number): number => Date.UTC(annee, mois, 1) / JOUR_MS;

/** PURE — niveaux clés à `nowMs` depuis des bougies 1d UTC triées. */
export function calculerNiveauxCles(bougies1d: readonly Candle[], nowMs: number): NiveauxCles {
  const jours = sessionExtents([...bougies1d]).filter((j) => !j.partiel);
  const parJour = new Map(jours.map((j) => [j.dayIdx, j]));
  const auj = utcDayOf(nowMs);
  const date = new Date(auj * JOUR_MS);
  const annee = date.getUTCFullYear();
  const mois = date.getUTCMonth();
  // 1970-01-01 était un jeudi : (auj + 3) % 7 = jours écoulés depuis le lundi.
  const lundi = auj - ((auj + 3) % 7);
  const debutMois = premierDuMois(annee, mois);

  /** Extrêmes des jours [debut, fin) — null si la période n'est pas couverte de bout en bout. */
  const extremes = (debut: number, fin: number): { high: number; low: number } | null => {
    if (!parJour.has(debut) || !parJour.has(fin - 1)) return null;
    const periode = jours.filter((j) => j.dayIdx >= debut && j.dayIdx < fin);
    return {
      high: Math.max(...periode.map((j) => j.high)),
      low: Math.min(...periode.map((j) => j.low)),
    };
  };
  const ouverture = (jour: number): number | null => parJour.get(jour)?.open ?? null;

  const veille = parJour.get(auj - 1);
  const semaine = extremes(lundi - 7, lundi);
  const moisPrec = extremes(premierDuMois(annee, mois - 1), debutMois);
  return {
    pdh: veille?.high ?? null,
    pdl: veille?.low ?? null,
    pdc: veille?.close ?? null,
    ouvertureJour: ouverture(auj),
    pwh: semaine?.high ?? null,
    pwl: semaine?.low ?? null,
    ouvertureSemaine: ouverture(lundi),
    pmh: moisPrec?.high ?? null,
    pml: moisPrec?.low ?? null,
    ouvertureMois: ouverture(debutMois),
    ouvertureTrimestre: ouverture(premierDuMois(annee, mois - (mois % 3))),
    ancreJourMs: auj * JOUR_MS,
    ancreSemaineMs: lundi * JOUR_MS,
  };
}

/**
 * PURE — lignes des familles choisies, ordre J, S, M, T (= priorité de fusion) : extrêmes et
 * clôture en trait plein neutre, ouvertures en pointillé accent. Niveau null → pas de ligne.
 */
export function lignesNiveauxCles(n: NiveauxCles | null, familles: readonly FamilleNiveauxCles[]): LigneNiveau[] {
  if (n === null) return [];
  // [prix, étiquette, est une ouverture]
  const parFamille: Record<FamilleNiveauxCles, [number | null, string, boolean][]> = {
    J: [[n.pdh, "PDH", false], [n.pdl, "PDL", false], [n.pdc, "PDC", false], [n.ouvertureJour, "OJ", true]],
    S: [[n.pwh, "PWH", false], [n.pwl, "PWL", false], [n.ouvertureSemaine, "OS", true]],
    M: [[n.pmh, "PMH", false], [n.pml, "PML", false], [n.ouvertureMois, "OM", true]],
    T: [[n.ouvertureTrimestre, "OQ", true]],
  };
  const out: LigneNiveau[] = [];
  for (const f of FAMILLES_NIVEAUX_CLES) {
    if (!familles.includes(f)) continue;
    for (const [price, label, ouverture] of parFamille[f]) {
      if (price === null) continue;
      out.push({ price, label, couleur: ouverture ? "--accent" : "--text-dim", emphase: ouverture ? "faible" : "forte" });
    }
  }
  return out;
}

export interface DepsSourceNiveauxCles {
  charger?: (exchange: ContexteNiveaux["exchange"], symbol: string, nowMs: number) => Promise<Candle[] | null>;
  maintenant?: () => number;
  store?: StoreApi<NiveauxOverlaysState>;
  disponible?: (exchange: ContexteNiveaux["exchange"], symbol: string) => boolean;
  toast?: (texte: string) => void;
}

/**
 * Source « niveaux clés » d'un slot : charge les bougies 1d au subscribe, recalcule au
 * changement de jour UTC (en retirant d'abord les lignes de la veille), réessaie toutes les
 * 5 min après un échec. Toujours un toast quand rien ne peut être tracé (jamais d'overlay muet).
 */
export function creerSourceNiveauxCles(ctx: ContexteNiveaux, deps: DepsSourceNiveauxCles = {}): FournisseurLignes {
  const charger = deps.charger ?? chargerBougiesJour;
  const maintenant = deps.maintenant ?? Date.now;
  const store = deps.store ?? niveauxOverlaysStore;
  const disponible = deps.disponible ?? bougiesJourDisponibles;
  const toast = deps.toast ?? pousserToast;
  const marche = `${ctx.symbol} (${ctx.exchange})`;
  let niveaux: NiveauxCles | null = null;

  return {
    getLignes: () => lignesNiveauxCles(niveaux, store.getState().familles),
    subscribe(onChange): Unsubscribe {
      if (!disponible(ctx.exchange, ctx.symbol)) {
        toast(`Niveaux clés indisponibles : pas de bougies 1d UTC pour ${marche}`);
        return () => {};
      }
      let annule = false;
      let echecSignale = false;
      let minuteur: ReturnType<typeof setTimeout> | undefined;
      const charge = (): void => {
        const now = maintenant();
        if (niveaux !== null && niveaux.ancreJourMs !== utcDayOf(now) * JOUR_MS) {
          niveaux = null; // niveaux de la veille : jamais affichés comme ceux du jour
          onChange();
        }
        void charger(ctx.exchange, ctx.symbol, now).then((bougies) => {
          if (annule) return;
          if (bougies === null) {
            if (!echecSignale) toast(`Niveaux clés : bougies 1d de ${marche} indisponibles, nouvel essai dans 5 min`);
            echecSignale = true;
            minuteur = setTimeout(charge, REESSAI_MS);
            return;
          }
          niveaux = calculerNiveauxCles(bougies, now);
          if (lignesNiveauxCles(niveaux, FAMILLES_NIVEAUX_CLES).length === 0) {
            toast(`Niveaux clés : historique 1d insuffisant pour ${marche}`);
          }
          onChange();
          minuteur = setTimeout(charge, msAvantProchainJourUtc(now) + MARGE_JOUR_MS);
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
