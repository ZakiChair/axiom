/**
 * EQS — boucle de l'étage indicateurs, exécutée par le worker du screener.
 *
 * Pour chaque candidat : klines Binance spot (`/api/v3/klines`, CORS *) à l'unité de
 * chaque condition (au plus deux unités par run), bougie EN FORMATION (dernière kline de
 * la réponse, quelle que soit l'horloge locale) écartée, volume
 * acheteur taker (k[9]) conservé, nombre de bougies porté à l'amorce des conditions
 * (plafond d'une requête : 1000). La série de référence des champs de force relative
 * (refSymbol, BTCUSDT par défaut) est chargée UNE fois par run et par unité ; les bougies
 * de chaque symbole à cette unité sont calées sur elle (dernière heure commune).
 *
 * Les entrées-sorties sont injectées (`IoEtage`) : le worker branche fetch / Date.now /
 * setTimeout, les tests des bouchons. Aucun appel réseau ici.
 */
import type { Candle, IndicatorResult, Timeframe } from "@axiom/types";
import {
  NOTE_ECARTES_SANS_EVALUATION,
  NOTE_FORCE_RELATIVE_NON_EVALUEE,
  SCREENER_KLINE_LIMIT,
  type IndicatorCondition,
  type IndicatorValue,
  type ScreenerRow,
} from "./screener";
import {
  amorceCondition,
  bougiesParJour,
  caleSurReference,
  champParId,
  evaluerCondition,
  libelleCondition,
  LIMITE_KLINES_BINANCE,
  raisonConditions,
  uniteCondition,
} from "./screenerRegles";

/** Klines spot Binance (déjà appelées par le screener, sans clé). */
export const KLINES_URL = "https://api.binance.com/api/v3/klines";
/** Intervalle minimal entre deux requêtes klines (~10 req/s). */
export const REQ_INTERVAL_MS = 100;

/**
 * Convertit la réponse `/api/v3/klines` en bougies. `closed` vient de l'heure de clôture
 * (k[6]) comparée à `maintenantMs` ; le volume acheteur taker (k[9]) donne buyVolume et
 * sellVolume (= volume − achat), comme l'adaptateur Binance du graphe. Un k[9] absent ou
 * incohérent laisse ces champs absents (taker « indisponible », jamais 0). Les lignes
 * aux prix non finis sont écartées.
 */
export function parserKlines(raw: unknown, maintenantMs: number): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const k of raw) {
    if (!Array.isArray(k)) continue;
    const c: Candle = {
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    };
    if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) continue;
    const fin = Number(k[6]);
    c.closed = Number.isFinite(fin) && fin < maintenantMs;
    const achat = k[9] === undefined || k[9] === null ? Number.NaN : Number(k[9]);
    if (Number.isFinite(achat) && achat >= 0 && achat <= c.volume) {
      c.buyVolume = achat;
      c.sellVolume = c.volume - achat;
    }
    out.push(c);
  }
  return out;
}

/** Ne garde que les bougies dont la clôture est passée (la bougie en cours est écartée). */
export function bougiesCloturees(candles: Candle[]): Candle[] {
  return candles.filter((c) => c.closed === true);
}

/** Nombre de bougies closes demandé par unité, amorce voulue, et si elle a dû être plafonnée. */
export interface LimiteUnite {
  limite: number;
  /** Amorce la plus exigeante des conditions de l'unité (bougies closes), avant plafond. */
  voulue: number;
  plafonnee: boolean;
}

/**
 * Bougies closes à charger par unité : le plancher, élevé à l'amorce la plus exigeante
 * des conditions de l'unité (calculée dans cette unité), plafonné à 1000 − 1 (la requête
 * ajoute la bougie en cours).
 */
export function limitesParUnite(
  conds: readonly IndicatorCondition[],
  tfRun: Timeframe,
  plancher: number = SCREENER_KLINE_LIMIT,
): Map<Timeframe, LimiteUnite> {
  const plafond = LIMITE_KLINES_BINANCE - 1;
  const out = new Map<Timeframe, LimiteUnite>();
  for (const cond of conds) {
    const tf = uniteCondition(cond, tfRun);
    const voulue = Math.max(plancher, amorceCondition(cond, tf), out.get(tf)?.voulue ?? 0);
    out.set(tf, { limite: Math.min(plafond, voulue), voulue, plafonnee: voulue > plafond });
  }
  return out;
}

/** Requête de l'étage (préparée par data/screenerRun.ts). */
export interface RequeteEtage {
  candidates: ScreenerRow[];
  tf: Timeframe;
  conditions: IndicatorCondition[];
  /** Plancher de bougies closes par unité (défaut SCREENER_KLINE_LIMIT). */
  plancher?: number;
  /** Symbole de référence des champs de force relative (refSymbolStore). */
  refSymbol: string;
}

/** Entrées-sorties injectées. */
export interface IoEtage {
  /** GET JSON ; rejette sur statut HTTP en échec. */
  lireJson: (url: string) => Promise<unknown>;
  maintenant: () => number;
  attendre: (ms: number) => Promise<void>;
  progression?: (done: number, total: number) => void;
}

/** Durée d'une bougie des unités du screener (15m, 1h, 4h, 1d), en ms. */
function dureeUnite(tf: Timeframe): number {
  return 86_400_000 / bougiesParJour(tf);
}

/**
 * Bougies closes manquantes à la fin de la référence au chargement : 0 si sa dernière
 * bougie close est la plus récente possible. Une bougie de retard est tolérée (clôture à
 * la frontière, publication de la place) ; au-delà, la référence est arrêtée ou suspendue
 * et caler les symboles sur elle lirait toutes leurs conditions dans le passé.
 */
export function retardReference(ref: readonly Candle[], tf: Timeframe, maintenantMs: number): number {
  const derniere = ref[ref.length - 1];
  if (derniere === undefined) return Number.POSITIVE_INFINITY;
  const duree = dureeUnite(tf);
  return Math.max(0, Math.floor((maintenantMs - (derniere.time + duree)) / duree));
}

/** Résultat de l'étage : lignes survivantes et notes de couverture. */
export interface ResultatEtage {
  rows: ScreenerRow[];
  notes: string[];
}

/**
 * Évalue les conditions sur chaque candidat, en série, avec progression. Rejette si une
 * condition est refusée (message prêt à afficher). Un symbole sans klines ne passe pas
 * et est compté dans les notes ; de même, un symbole arrêté sur une condition NON
 * MESURÉE (historique ou volume taker insuffisant) est compté par condition, pour que la
 * couverture se voie (« N résultats » ne veut pas dire que tous les autres ont échoué).
 */
export async function executerEtage(req: RequeteEtage, io: IoEtage): Promise<ResultatEtage> {
  const raison = raisonConditions(req.conditions, req.tf);
  if (raison !== null) throw new Error(raison);

  const limites = limitesParUnite(req.conditions, req.tf, req.plancher);
  const notes: string[] = [];
  let derniereRequete = Number.NEGATIVE_INFINITY;

  const lireBougies = async (symbol: string, tf: Timeframe): Promise<Candle[]> => {
    const attente = derniereRequete + REQ_INTERVAL_MS - io.maintenant();
    if (attente > 0) await io.attendre(attente);
    derniereRequete = io.maintenant();
    const limite = Math.min(LIMITE_KLINES_BINANCE, (limites.get(tf)?.limite ?? SCREENER_KLINE_LIMIT) + 1);
    const url = `${KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(tf)}&limit=${limite}`;
    const raw = await io.lireJson(url);
    // Sans endTime, la DERNIÈRE kline est la bougie en cours : elle est écartée quelle que
    // soit l'horloge locale (une horloge en avance la ferait passer pour close), comme
    // BREADTH (`fetchCloturesJour`). Le filtre k[6] reste pour le reste de la réponse.
    return bougiesCloturees(parserKlines(Array.isArray(raw) ? raw.slice(0, -1) : raw, io.maintenant()));
  };

  // Référence : une seule fois par run et par unité qui la lit.
  const refs = new Map<Timeframe, Candle[] | null>();
  for (const cond of req.conditions) {
    if (cond.kind !== "indicator" || champParId(cond.fieldId)?.besoin !== "ref") continue;
    const tf = uniteCondition(cond, req.tf);
    if (refs.has(tf)) continue;
    let ref: Candle[] | null = null;
    try {
      const bougies = await lireBougies(req.refSymbol, tf);
      ref = bougies.length > 0 ? bougies : null;
    } catch {
      ref = null;
    }
    if (ref === null) {
      notes.push(`référence ${req.refSymbol} ${tf} indisponible : ${NOTE_FORCE_RELATIVE_NON_EVALUEE}`);
    } else {
      // Référence arrêtée (paire suspendue dont la place sert encore l'historique) : aucun
      // symbole n'est calé sur elle, la force relative est tenue pour indisponible.
      const retard = retardReference(ref, tf, io.maintenant());
      if (retard > 1) {
        ref = null;
        notes.push(
          `référence ${req.refSymbol} ${tf} en retard de ${retard} bougies : ${NOTE_FORCE_RELATIVE_NON_EVALUEE}`,
        );
      }
    }
    refs.set(tf, ref);
  }

  const survivants: ScreenerRow[] = [];
  const total = req.candidates.length;
  let done = 0;
  let echecs = 0;
  // Symboles lus à la dernière bougie commune avec la référence (bougie close pendant le run).
  let cales = 0;
  // Symboles arrêtés sur une condition NON MESURÉE (état inconnu sur toute sa fenêtre), par
  // libellé : ils ne sont pas « faux », leur absence des résultats doit se voir.
  const nonMesures = new Map<string, number>();

  for (const cand of req.candidates) {
    let cale = false;
    const bougies = new Map<Timeframe, Candle[]>();
    const caches = new Map<Timeframe, Map<string, IndicatorResult>>();
    const valeurs: IndicatorValue[] = [];
    let passe = true;
    try {
      for (const cond of req.conditions) {
        const tf = uniteCondition(cond, req.tf);
        let candles = bougies.get(tf);
        if (candles === undefined) {
          // Chargement paresseux : un candidat écarté dès la 1re condition n'appelle pas l'autre unité.
          candles = await lireBougies(cand.symbol, tf);
          // Unité lue contre la référence : toutes ses conditions s'arrêtent à la dernière
          // heure que la référence possède (une bougie close pendant le run est laissée).
          const ref = refs.get(tf);
          if (ref !== undefined && ref !== null) {
            const calage = caleSurReference(candles, ref);
            candles = calage.candles;
            if (calage.retirees > 0) cale = true;
          }
          bougies.set(tf, candles);
        }
        let cache = caches.get(tf);
        if (cache === undefined) {
          cache = new Map();
          caches.set(tf, cache);
        }
        const ref = refs.get(tf);
        const lecture = evaluerCondition(cond, candles, { tf, ref, cache });
        if (!lecture.vraie || lecture.valeur === undefined) {
          // Référence indisponible : déjà dite par sa propre note.
          const sansRef = ref === null && cond.kind === "indicator" && champParId(cond.fieldId)?.besoin === "ref";
          if (!lecture.vraie && !lecture.mesuree && !sansRef) {
            const libelle = libelleCondition(cond, req.tf);
            nonMesures.set(libelle, (nonMesures.get(libelle) ?? 0) + 1);
          }
          passe = false;
          break;
        }
        valeurs.push({
          label: libelleCondition(cond, req.tf),
          value: lecture.valeur,
          ...(lecture.barresDepuis !== undefined && lecture.barresDepuis > 0
            ? { barresDepuis: lecture.barresDepuis }
            : {}),
        });
      }
    } catch {
      // Klines indisponibles (réseau, symbole retiré) : le symbole ne passe pas.
      passe = false;
      echecs++;
    }
    if (passe) survivants.push({ ...cand, indicatorValues: valeurs });
    if (cale) cales++;
    done++;
    io.progression?.(done, total);
  }

  for (const [tf, l] of limites) {
    if (!l.plafonnee) continue;
    const jours = Math.floor(l.limite / bougiesParJour(tf));
    notes.push(
      `amorce plafonnée à ${l.limite} bougies closes en ${tf} (≈ ${jours} j ; ${l.voulue} voulues) : valeurs ≈`,
    );
  }
  if (cales > 0) {
    notes.push(
      `${cales} symbole${cales > 1 ? "s" : ""} lu${cales > 1 ? "s" : ""} à la dernière bougie commune avec ` +
        `${req.refSymbol} (bougie close après le chargement de la référence)`,
    );
  }
  for (const [libelle, nb] of nonMesures) {
    const s = nb > 1 ? "s" : "";
    notes.push(
      `${nb} symbole${s} non mesuré${s} pour « ${libelle} » (historique ou volume taker insuffisant) : ` +
        `écarté${s} ${NOTE_ECARTES_SANS_EVALUATION}`,
    );
  }
  if (echecs > 0) notes.push(`${echecs} symbole${echecs > 1 ? "s" : ""} sans klines`);
  return { rows: survivants, notes };
}
