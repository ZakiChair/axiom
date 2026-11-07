/**
 * Bandes RV du chart maître (chunk paresseux) : amplitude STATISTIQUE prévue pour TOUT actif,
 * options ou pas. ±1σ et ±2σ ancrées comme les bandes implicites (bandesImplicites.ts) sur
 * l'ouverture du jour UTC (horizon 1 j, « J ») et du lundi UTC (horizon 7 j, « S »).
 *
 * σ = prévision HAR-RV (data/harRv.ts) de la variance de Garman-Klass 1d, faite à la clôture de la
 * veille (jour) ou du dimanche (semaine) : la bande ne bouge pas avant la prochaine ancre. « ±1σ »
 * et « ±2σ » sont les quantiles 68,3 % et 95,4 % des écarts standardisés passés (k calibrés hors
 * échantillon, jamais 1 et 2 gaussiens) ; la couverture hors échantillon est publiée pour la
 * fenêtre DIST (infobulle et note). Ce n'est PAS une borne, et ce n'est pas la bande VaR de DIST
 * (quantiles non conditionnels des rendements du chart) : ici, une prévision conditionnelle.
 *
 * Chargeur 1d DÉDIÉ, plus profond que celui des niveaux clés (100 bougies) : pages successives
 * vers le passé jusqu'à JOURS_HAR jours, une fois par jour UTC et par (source, symbole), calcul
 * mémorisé ; un échec ou un résultat incomplet n'est pas mis en cache.
 *
 * « Amplitude consommée » : haut − bas depuis l'ancre (bougies VIVANTES du chart maître) ÷
 * amplitude attendue de l'horizon (médiane passée de haut − bas / σ prévu, × σ), affichée sur
 * l'étiquette « +1σ ». Non mesurée si les bougies du chart sont plus longues que l'horizon ou ne
 * couvrent pas l'ancre.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Candle, ExchangeId, Unsubscribe } from "@axiom/types";
import { utcDayOf } from "@axiom/indicators";
import { getAdapter } from "../../data/adapters";
import { evaluerHorizon, historiqueRequis, segmentContigu, type PrevisionHorizon } from "../../data/harRv";
import { marketStore } from "../../store/market";
import { pousserToast } from "../../store/toasts";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import type { ContexteNiveaux } from "../niveauxOverlays";
import { bougiesJourDisponibles, estAligneUtc, msAvantProchainJourUtc } from "./bougiesJour";
import { calculerNiveauxCles } from "./niveauxCles";

const JOUR_MS = 86_400_000;
/** Profondeur visée : 500 j de régression + 22 j d'amorce + calibrage + couverture mesurable. */
export const JOURS_HAR = 1500;
/** Bougies 1d par requête selon la place (plafonds des adaptateurs) ; 500 ailleurs. */
const PAGE_1D: Partial<Record<ExchangeId, number>> = {
  binance: 1000,
  bybit: 1000,
  mexc: 1000,
  okx: 300,
  coinbase: 350,
  kraken: 720,
  hyperliquid: 1500,
};
const PAGES_MAX = 8;
const REESSAI_MS = 5 * 60_000;
const MARGE_JOUR_MS = 5_000;

/**
 * Bougies 1d de `symbol`, pages successives vers le passé (`endTime` = plus ancienne − 1) jusqu'à
 * `jours` bougies, une page vide ou qui ne recule plus (Kraken ignore `endTime`). Échec de la
 * première page : rejet ; d'une suivante : l'historique déjà obtenu est gardé. Trié, sans doublon,
 * bougie du jour en cours comprise (son ouverture sert d'ancre).
 */
export async function chargerHistoriqueJour(
  exchange: ExchangeId,
  symbol: string,
  jours = JOURS_HAR,
  adapter = getAdapter(exchange),
): Promise<Candle[]> {
  const page = PAGE_1D[exchange] ?? 500;
  const parTemps = new Map<number, Candle>();
  let fin: number | undefined;
  for (let p = 0; p < PAGES_MAX && parTemps.size < jours; p++) {
    let lot: Candle[];
    try {
      lot = await adapter.fetchKlines(symbol, "1d", fin === undefined ? { limit: page } : { limit: page, endTime: fin - 1 });
    } catch (erreur) {
      if (fin === undefined) throw erreur;
      break;
    }
    const plusAncienne = lot.reduce((m, b) => Math.min(m, b.time), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(plusAncienne) || (fin !== undefined && plusAncienne >= fin)) break;
    for (const b of lot) parTemps.set(b.time, b);
    fin = plusAncienne;
  }
  // Les `jours` plus récentes : le calcul (une régression par origine) reste borné.
  return [...parTemps.values()].sort((a, b) => a.time - b.time).slice(-jours);
}

export interface BandeRv {
  /** Ouverture d'ancrage (prix) et son instant. */
  ancre: number;
  ancreMs: number;
  horizonMs: number;
  prevision: PrevisionHorizon;
  plus1: number;
  moins1: number;
  plus2: number;
  moins2: number;
}

export interface BandesRvCalculees {
  jour: BandeRv | null;
  semaine: BandeRv | null;
  /** 00:00 UTC du jour de calcul : des bandes d'un autre jour ne sont jamais affichées. */
  ancreJourMs: number;
  /** Jours clos contigus disponibles avant aujourd'hui. */
  historique: number;
}

/**
 * PURE — bandes du jour et de la semaine à `nowMs` depuis les bougies 1d (jour en cours compris,
 * pour son ouverture). La prévision du jour part de la veille, celle de la semaine du dimanche ;
 * une ancre, une origine absente ou un historique trop court → bande null.
 */
export function calculerBandesRv(bougies1d: readonly Candle[], nowMs: number): BandesRvCalculees {
  const n = calculerNiveauxCles(bougies1d, nowMs);
  const auj = utcDayOf(nowMs);
  const segment = segmentContigu(bougies1d.filter((b) => utcDayOf(b.time) < auj));
  const bande = (ancre: number | null, ancreMs: number, h: number): BandeRv | null => {
    const origine = segment.findIndex((b) => b.time === ancreMs - JOUR_MS);
    const prevision = ancre === null || origine < 0 ? null : evaluerHorizon(segment, h, origine);
    if (ancre === null || prevision === null) return null;
    const s1 = prevision.k1 * prevision.sigma;
    const s2 = prevision.k2 * prevision.sigma;
    return {
      ancre, ancreMs, horizonMs: h * JOUR_MS, prevision,
      plus1: ancre * Math.exp(s1), moins1: ancre * Math.exp(-s1), plus2: ancre * Math.exp(s2), moins2: ancre * Math.exp(-s2),
    };
  };
  return {
    jour: bande(n.ouvertureJour, n.ancreJourMs, 1),
    semaine: bande(n.ouvertureSemaine, n.ancreSemaineMs, 7),
    ancreJourMs: n.ancreJourMs,
    historique: segment.length,
  };
}

/**
 * PURE — haut − bas (log) depuis `ancreMs` ÷ amplitude attendue (log). null (non mesuré) si les
 * bougies sont plus longues que l'horizon, ne commencent pas exactement à l'ancre ou sont absentes.
 */
export function amplitudeConsommee(bougies: readonly Candle[], ancreMs: number, horizonMs: number, attendue: number): number | null {
  const n = bougies.length;
  const pas = n >= 2 ? bougies[n - 1]!.time - bougies[n - 2]!.time : 0;
  if (!(pas > 0) || pas > horizonMs || !(attendue > 0)) return null;
  let haut = 0;
  let bas = Number.POSITIVE_INFINITY;
  let i = n - 1;
  for (; i >= 0 && bougies[i]!.time >= ancreMs; i--) {
    haut = Math.max(haut, bougies[i]!.high);
    bas = Math.min(bas, bougies[i]!.low);
  }
  if (bougies[i + 1]?.time !== ancreMs || !(bas > 0) || !(haut >= bas)) return null;
  return Math.log(haut / bas) / attendue;
}

export interface Amplitudes {
  jour: number | null;
  semaine: number | null;
}

const pctEntier = (x: number): string => `${Math.round(x * 100)} %`;

/** PURE — ±1σ en trait fort, ±2σ en pointillé ; amplitude consommée sur l'étiquette « +1σ ». */
export function lignesBandesRv(b: BandesRvCalculees | null, amplitudes: Amplitudes = { jour: null, semaine: null }): LigneNiveau[] {
  if (b === null) return [];
  const out: LigneNiveau[] = [];
  for (const [bande, suffixe, amplitude] of [[b.jour, "J", amplitudes.jour], [b.semaine, "S", amplitudes.semaine]] as const) {
    if (bande === null) continue;
    const consommee = amplitude === null ? "" : ` · amp. ${pctEntier(amplitude)}`;
    const candidates: [number, string, LigneNiveau["emphase"]][] = [
      [bande.plus1, `+1σ ${suffixe} (RV)${consommee}`, "forte"],
      [bande.moins1, `−1σ ${suffixe} (RV)`, "forte"],
      [bande.plus2, `+2σ ${suffixe} (RV)`, "faible"],
      [bande.moins2, `−2σ ${suffixe} (RV)`, "faible"],
    ];
    for (const [price, label, emphase] of candidates) out.push({ price, label, couleur: "--ui-amber", emphase });
  }
  return out;
}

/** État publié pour la fenêtre DIST (infobulle et note) par la source active. */
export interface InfoBandesRv {
  marche: string;
  calcul: BandesRvCalculees | null;
  amplitudes: Amplitudes;
  /** Raison d'une bande absente (chargement, historique, source), sinon null. */
  manque: string | null;
}

export const infoBandesRvStore: StoreApi<{ info: InfoBandesRv | null }> = createStore(() => ({ info: null }));

const pct1 = (x: number): string => `${(x * 100).toFixed(1).replace(".", ",")} %`;

/** Ce que mesurent les bandes RV (infobulle du bouton de DIST). */
export const NOTE_BANDES_RV =
  "Bandes ±1σ/±2σ jour et semaine prévues par HAR-RV (variance de Garman-Klass 1d, régression glissante sur 500 j) pour tout actif : " +
  "amplitude statistique, pas une borne. ±1σ/±2σ = quantiles 68,3 %/95,4 % des écarts passés, calibrés hors échantillon. " +
  "Prévision conditionnelle, à distinguer des bandes VaR (quantiles non conditionnels).";

/** PURE — infobulle du bouton « Bandes RV » : note générale, puis le détail du marché calculé. */
export function resumeBandesRv(info: InfoBandesRv | null): string {
  const detail = detailBandesRv(info);
  return detail === null ? NOTE_BANDES_RV : `${NOTE_BANDES_RV} ${detail}`;
}

/** PURE — σ prévu, couverture hors échantillon et amplitude consommée du marché calculé. */
export function detailBandesRv(info: InfoBandesRv | null): string | null {
  if (info === null) return null;
  const morceaux = [`${info.marche} :`];
  for (const [bande, nom, amplitude, fenetres] of [
    [info.calcul?.jour ?? null, "jour", info.amplitudes.jour, "jours"],
    [info.calcul?.semaine ?? null, "semaine", info.amplitudes.semaine, "fenêtres de 7 j chevauchantes"],
  ] as const) {
    if (bande === null) {
      morceaux.push(`${nom} indisponible ;`);
      continue;
    }
    const { sigma, couverture: c } = bande.prevision;
    const couverture = c.n === 0
      ? "couverture non mesurée"
      : `couverture hors échantillon ±1σ ${pctEntier(c.dans1 / c.n)}, ±2σ ${pctEntier(c.dans2 / c.n)} (n = ${c.n} ${fenetres})`;
    const amp = amplitude === null ? "amplitude consommée non mesurée" : `amplitude consommée ${pctEntier(amplitude)}`;
    const filtre = bande.prevision.filtre ? ", prévision remplacée par la moyenne 22 j" : "";
    morceaux.push(`${nom} σ ${pct1(sigma)}${filtre}, ${couverture}, ${amp} ;`);
  }
  if (info.manque !== null) morceaux.push(`(${info.manque})`);
  return morceaux.join(" ").replace(/ ;$/, ".").replace(/ ; \(/, " (");
}

const cache = new Map<string, Promise<BandesRvCalculees | null>>();

/**
 * Bandes du jour pour (source, symbole) : un chargement et un calcul par jour UTC, promesses en
 * vol partagées. Seul un résultat COMPLET (deux bandes) reste en cache ; le reste est recalculé
 * au prochain essai (bougie de la veille pas encore publiée, panne, historique trop court).
 */
export function chargerBandesRv(
  exchange: ExchangeId,
  symbol: string,
  nowMs: number,
  charger: (exchange: ExchangeId, symbol: string) => Promise<Candle[]> = (e, s) => chargerHistoriqueJour(e, s),
): Promise<BandesRvCalculees | null> {
  const jour = `|${utcDayOf(nowMs)}`;
  const cle = `${exchange}|${symbol}${jour}`;
  const existante = cache.get(cle);
  if (existante !== undefined) return existante;
  for (const k of cache.keys()) if (!k.endsWith(jour)) cache.delete(k);
  const promesse = Promise.resolve()
    .then(() => charger(exchange, symbol))
    .then((b) => (b.length > 0 && estAligneUtc(b) ? calculerBandesRv(b, nowMs) : null))
    .catch(() => null)
    .then((c) => {
      if (c?.jour == null || c.semaine === null) cache.delete(cle);
      return c;
    });
  cache.set(cle, promesse);
  return promesse;
}

export function _viderCacheBandesRv(): void {
  cache.clear();
}

/** Marché vivant du slot maître (bougies du chart, pour l'amplitude consommée). */
interface MarcheVivant {
  getState(): { exchange: ExchangeId; symbol: string; candles: Candle[] };
  subscribe(ecouteur: () => void): Unsubscribe;
}

export interface DepsSourceBandesRv {
  charger?: (exchange: ExchangeId, symbol: string, nowMs: number) => Promise<BandesRvCalculees | null>;
  maintenant?: () => number;
  disponible?: (exchange: ExchangeId, symbol: string) => boolean;
  toast?: (texte: string) => void;
  marche?: MarcheVivant;
  info?: StoreApi<{ info: InfoBandesRv | null }>;
}

/**
 * Source « Bandes RV » d'un slot : calcul au subscribe, recalcul au changement de jour UTC (bandes
 * de la veille retirées d'abord), amplitude consommée suivie sur les bougies vivantes du chart.
 * Panne : nouvel essai dans 5 min ; historique trop court : au prochain jour. Toujours un toast
 * quand une bande ne peut pas être tracée.
 */
export function creerSourceBandesRv(ctx: ContexteNiveaux, deps: DepsSourceBandesRv = {}): FournisseurLignes {
  const charger = deps.charger ?? chargerBandesRv;
  const maintenant = deps.maintenant ?? Date.now;
  const disponible = deps.disponible ?? bougiesJourDisponibles;
  const toast = deps.toast ?? pousserToast;
  const marcheVivant = deps.marche ?? marketStore;
  const infoStore = deps.info ?? infoBandesRvStore;
  const marche = `${ctx.symbol} (${ctx.exchange})`;
  let calcul: BandesRvCalculees | null = null;
  let amplitudes: Amplitudes = { jour: null, semaine: null };
  let manque: string | null = null;
  const publier = (): void => infoStore.setState({ info: { marche, calcul, amplitudes, manque } });

  /** Recalcule l'amplitude consommée ; vrai si un pourcentage affiché change. */
  const majAmplitudes = (): boolean => {
    const m = marcheVivant.getState();
    const vivant = m.exchange === ctx.exchange && m.symbol === ctx.symbol;
    const mesurer = (b: BandeRv | null | undefined): number | null =>
      b == null || !vivant ? null : amplitudeConsommee(m.candles, b.ancreMs, b.horizonMs, b.prevision.amplitude);
    const suivantes: Amplitudes = { jour: mesurer(calcul?.jour), semaine: mesurer(calcul?.semaine) };
    const affiche = (x: number | null): number | null => (x === null ? null : Math.round(x * 100));
    const change = affiche(suivantes.jour) !== affiche(amplitudes.jour) || affiche(suivantes.semaine) !== affiche(amplitudes.semaine);
    amplitudes = suivantes;
    return change;
  };

  return {
    getLignes: () => lignesBandesRv(calcul, amplitudes),
    subscribe(onChange): Unsubscribe {
      if (ctx.exchange === "twelvedata" || !disponible(ctx.exchange, ctx.symbol)) {
        manque = `pas de bougies 1d UTC continues pour ${marche} (marchés 24/7 seulement)`;
        publier();
        toast(`Bandes RV indisponibles : ${manque}`);
        return () => {};
      }
      let annule = false;
      let echecSignale = false;
      let minuteur: ReturnType<typeof setTimeout> | undefined;
      const charge = (): void => {
        const now = maintenant();
        if (calcul !== null && calcul.ancreJourMs !== utcDayOf(now) * JOUR_MS) {
          calcul = null; // bandes de la veille : jamais affichées comme celles du jour
          majAmplitudes();
          onChange();
        }
        manque = "calcul en cours";
        publier();
        void charger(ctx.exchange, ctx.symbol, now).then((resultat) => {
          if (annule) return;
          let delai = REESSAI_MS;
          if (resultat === null) manque = `bougies 1d de ${marche} indisponibles`;
          else {
            calcul = resultat;
            majAmplitudes();
            onChange();
            const absentes = [resultat.jour === null ? "jour" : null, resultat.semaine === null ? "semaine" : null].filter((x) => x !== null);
            const court = resultat.historique < historiqueRequis(7) + 6;
            if (absentes.length === 0) manque = null;
            else {
              const s = absentes.length > 1 ? "s" : "";
              manque = court
                ? `bande${s} ${absentes.join(" et ")} : historique trop court (${resultat.historique} jours clos contigus, ≈ ${historiqueRequis(7) + 6} requis)`
                : `bande${s} ${absentes.join(" et ")} incalculable${s} (bougie 1d de la veille ou ouverture absente)`;
              if (court) delai = msAvantProchainJourUtc(now) + MARGE_JOUR_MS;
            }
          }
          publier();
          if (manque === null) {
            echecSignale = false;
            minuteur = setTimeout(charge, msAvantProchainJourUtc(now) + MARGE_JOUR_MS);
            return;
          }
          if (!echecSignale) toast(`Bandes RV : ${manque}${delai === REESSAI_MS ? ", nouvel essai dans 5 min" : ""}`);
          echecSignale = true;
          minuteur = setTimeout(charge, delai);
        });
      };
      const desabonnerMarche = marcheVivant.subscribe(() => {
        if (calcul !== null && majAmplitudes()) {
          onChange();
          publier();
        }
      });
      charge();
      return () => {
        annule = true;
        clearTimeout(minuteur);
        desabonnerMarche();
        if (infoStore.getState().info?.marche === marche) infoStore.setState({ info: null });
      };
    },
  };
}
