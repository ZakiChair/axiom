/**
 * Intrabar — sous-bougies Binance chargées À LA DEMANDE pour affiner le profil de volume
 * (VPVR, VPFR) et les colonnes historiques du footprint (SUG-3, phase 1).
 *
 * Problème : ces surfaces répartissent le volume d'une bougie du graphe uniformément sur
 * son [bas, haut]. En 4h, le POC et la zone de valeur sont grossiers. On recharge donc la
 * plage en unité plus fine (klines 1m à 1d) et on répartit le volume de CHAQUE sous-bougie
 * sur SON [bas, haut], avec son propre volume acheteur taker (colonne k[9], même lecture que
 * `restKlineToCandle` de data/binance.ts). Le split est exact PAR SOUS-BOUGIE et reste
 * approché par niveau : le libellé dit « réparti à la minute (1m) », jamais « exact ».
 *
 * Garde-fous :
 *  - Causalité : seules les bougies parentes CLÔTURÉES (`closed !== false` et fin passée)
 *    sont remplacées ; la bougie en cours garde l'ancien calcul. Une sous-bougie n'est
 *    retenue que si elle était close à l'instant du téléchargement (horodatage connu).
 *  - Contrôle de cohérence : une parente n'est remplacée que si la somme des volumes de
 *    ses sous-bougies retrouve son volume (à 1e-6 près) et si leurs extrêmes tiennent dans
 *    les siens ; sinon repli explicite sur l'ancien calcul (couverture affichée).
 *  - Débit : résolution choisie pour qu'une plage coûte au plus `PLAFOND_REQUETES`
 *    requêtes (blocs alignés de 1 000 sous-bougies spot, 1 500 perp), requêtes en série,
 *    cache LRU borné à `CAPACITE_BLOCS` blocs, anti-rebond de `ANTI_REBOND_MS` au
 *    déplacement. Exemple : 60 j de 4h → 15m (6 ou 7 requêtes) au lieu de 87 en 1m.
 *  - Borne DANS LA DURÉE, quel que soit le nombre de surfaces : chaque surface tient un
 *    bail sur les blocs de son plan courant, renouvelé à chaque rendu. Un bloc sous bail
 *    n'est jamais évincé pour en charger un autre ; une plage dont les blocs nouveaux ne
 *    tiennent pas TOUS dans la place libre ou libérable n'émet aucune requête et s'affiche
 *    « ≈ … (intrabar 1m non chargé, cache saturé) ». Tant que les surfaces restent rendues
 *    sur les mêmes plages, chaque bloc de leurs plans n'est donc téléchargé qu'une fois (au
 *    plus `CAPACITE_BLOCS` au total), plus un rafraîchissement par clôture de parente ; un
 *    déplacement ne coûte que ses blocs nouveaux. Un bail non renouvelé pendant `BAIL_MS`
 *    (surface retirée sans dispose, comme une VPFR supprimée, ou onglet masqué) expire.
 *  - Échecs : délai maximal de `DELAI_REQUETE_MS` par requête ; après un échec, plus
 *    aucune requête (toutes surfaces) pendant une pause qui double à chaque échec
 *    consécutif (1 min puis 2, 4… jusqu'à 10 min), libellé « indisponible ».
 *  - Pas de 1s : la profondeur historique des klines 1s n'a pas pu être confirmée (et le
 *    perp n'en sert pas) ; le plus fin est donc 1m. Aucun enregistreur : rien n'est écrit
 *    hors de la mémoire de l'onglet.
 *  - Autres places (Bybit, OKX, Hyperliquid, Coinbase, Kraken…) : aucune colonne taker
 *    publique comparable → repli sur l'ancien calcul, avec libellé.
 *
 * Module chargé par `import()` (chunk différé) : VolumeProfileController et l'overlay VPFR
 * sont sur le chemin initial, le budget de chargement n'en porte que l'appel.
 */
import type { Candle, ExchangeId, Timeframe } from "@axiom/types";
import { extUrl } from "./extapi";

/** Marché Binance servi : spot (api.binance.com, appel direct) ou perp USDⓈ-M (fapi). */
export type MarcheIntrabar = "spot" | "perp";

export interface SourceIntrabar {
  marche: MarcheIntrabar;
  /** Symbole Binance (ex. BTCUSDT). */
  symbole: string;
}

/** Unités de sous-bougie candidates, de la plus fine à la plus grossière. */
export type ResolutionIntrabar = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

const RESOLUTIONS: ReadonlyArray<readonly [ResolutionIntrabar, number]> = [
  ["1m", 60_000],
  ["5m", 300_000],
  ["15m", 900_000],
  ["1h", 3_600_000],
  ["4h", 14_400_000],
  ["1d", 86_400_000],
];

/** Libellé honnête de chaque résolution (remplace l'ancien « ≈ »). */
export const LIBELLE_RESOLUTION: Record<ResolutionIntrabar, string> = {
  "1m": "réparti à la minute (1m)",
  "5m": "réparti par 5 min (5m)",
  "15m": "réparti par 15 min (15m)",
  "1h": "réparti à l'heure (1h)",
  "4h": "réparti par 4 h (4h)",
  "1d": "réparti au jour (1d)",
};

/** Libellé de l'ancien calcul (volume de la bougie du graphe réparti sur son [bas, haut]). */
export const LIBELLE_REPLI = "≈ réparti sur la bougie";

/**
 * Durée des unités parentes à durée FIXE. Les unités calendaires (1M, 3M, 6M, 12M) n'ont
 * pas de durée fixe : pas d'intrabar, repli explicite.
 */
const DUREE_UNITE: Partial<Record<Timeframe, number>> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

/**
 * PLAFOND de requêtes pour UNE plage : la résolution retenue est la plus fine dont les
 * blocs couvrant la plage restent sous ce plafond (≤ 10 000 sous-bougies spot, 15 000
 * perp). À ~0,5–1,4 s par requête Binance, une plage froide coûte au pire ~10 s ; un
 * déplacement ne recharge que les blocs nouveaux.
 */
export const PLAFOND_REQUETES = 10;
/** Sous-bougies par requête (= par bloc) : limite des endpoints klines. */
export const LIMITE_PAR_REQUETE: Record<MarcheIntrabar, number> = { spot: 1_000, perp: 1_500 };
/**
 * Capacité du cache LRU, en blocs (32 000 sous-bougies spot au plus, quelques Mo). Trois
 * plans pleins (3 × 10 blocs) y tiennent ensemble ; au-delà, les surfaces suivantes
 * attendent qu'une place se libère (« cache saturé »), sans requête.
 */
export const CAPACITE_BLOCS = 32;
/** Anti-rebond : le chargement part quand la plage n'a plus bougé depuis ce délai. */
export const ANTI_REBOND_MS = 400;
/**
 * Durée d'un bail : un client qui n'a pas relu son plan depuis ce délai libère ses blocs
 * (ils redeviennent évinçables). Les surfaces actives se redessinent bien plus souvent
 * (ticks, trades, déplacements).
 */
export const BAIL_MS = 30_000;
/** Délai maximal d'une requête : une connexion pendante ne gèle pas la file au-delà. */
export const DELAI_REQUETE_MS = 15_000;
/** Délai de publication d'une kline close par Binance avant de la tenir pour définitive. */
const MARGE_CLOTURE_MS = 2_000;
/** Pause après un premier échec (pas de rafale sur 429/451/418), doublée à chaque échec consécutif. */
export const REESSAI_MS = 60_000;
/** Plafond de la pause après échecs répétés. */
const PAUSE_MAX_MS = 10 * 60_000;
/**
 * Écart relatif toléré entre le volume d'une parente et la somme de ses sous-bougies.
 * Binance agrège toutes les unités depuis les mêmes trades : l'égalité est exacte en
 * décimal, l'écart ne vient que de l'arrondi flottant. Serré exprès : une seule minute
 * absente sur 240 (0,4 % du volume d'une 4h) doit faire échouer le contrôle.
 */
const TOLERANCE_VOLUME = 1e-6;

const URL_SPOT = "https://api.binance.com/api/v3/klines";

// ───────────────────────────── Choix de la source et du plan ─────────────────────────────

/**
 * Source intrabar d'un graphe. Seul Binance publie le volume acheteur taker par kline :
 * toute autre place rend `null` (repli). Le graphe « binance » est le spot ; aucune vue ne
 * présente aujourd'hui un perp Binance (les perps du graphe sont Hyperliquid, qu'on ne
 * mélange pas avec le volume d'une autre place). Le chargeur sait servir le perp
 * (`{ marche: "perp" }`) pour un appelant qui en affiche un.
 */
export function sourceIntrabar(exchange: ExchangeId, symbol: string): SourceIntrabar | null {
  if (exchange !== "binance") return null;
  const symbole = symbol.trim().toUpperCase();
  return /^[A-Z0-9]{2,30}$/.test(symbole) ? { marche: "spot", symbole } : null;
}

/** Durée fixe d'une unité parente, `undefined` pour les unités calendaires. */
export function dureeUnite(tf: Timeframe): number | undefined {
  return DUREE_UNITE[tf];
}

export interface PlanIntrabar {
  source: SourceIntrabar;
  resolution: ResolutionIntrabar;
  resolutionMs: number;
  dureeParent: number;
  /** Début de la première parente clôturée de la plage (inclus). */
  debut: number;
  /** Fin de la dernière parente clôturée de la plage (exclue). */
  fin: number;
  /** Indices des blocs alignés (bloc = LIMITE × résolution) couvrant [debut, fin). */
  blocs: number[];
}

export type RaisonSansPlan = "aucune bougie clôturée" | "aucune unité plus fine" | "plage trop longue";

function tailleBloc(marche: MarcheIntrabar, resolutionMs: number): number {
  return LIMITE_PAR_REQUETE[marche] * resolutionMs;
}

function blocsCouvrant(debut: number, fin: number, taille: number): number[] {
  const premier = Math.floor(debut / taille);
  const dernier = Math.floor((fin - 1) / taille);
  const out: number[] = [];
  for (let i = premier; i <= dernier; i++) out.push(i);
  return out;
}

/**
 * Une parente est éligible si elle est clôturée : drapeau non `false` ET fin passée depuis
 * au moins MARGE_CLOTURE_MS (ses sous-bougies sont alors toutes publiées et définitives).
 */
function estClose(c: Pick<Candle, "time" | "closed">, duree: number, maintenant: number): boolean {
  return c.closed !== false && c.time + duree + MARGE_CLOTURE_MS <= maintenant;
}

/**
 * Plan de chargement des bougies [from, to) : bornes des parentes CLÔTURÉES, puis la
 * résolution la plus fine qui (1) est strictement plus fine que l'unité, (2) la divise,
 * (3) tient la plage dans `PLAFOND_REQUETES` blocs. PURE.
 */
export function planifierIntrabar(
  source: SourceIntrabar,
  dureeParent: number,
  bougies: readonly Pick<Candle, "time" | "closed">[],
  from: number,
  to: number,
  maintenant: number,
): PlanIntrabar | RaisonSansPlan {
  let debut = Infinity;
  let fin = -Infinity;
  for (let i = Math.max(0, from); i < Math.min(bougies.length, to); i++) {
    const c = bougies[i];
    if (c === undefined || !estClose(c, dureeParent, maintenant)) continue;
    if (c.time < debut) debut = c.time;
    if (c.time + dureeParent > fin) fin = c.time + dureeParent;
  }
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return "aucune bougie clôturée";
  let plusFineExiste = false;
  for (const [resolution, resolutionMs] of RESOLUTIONS) {
    if (resolutionMs >= dureeParent || dureeParent % resolutionMs !== 0) continue;
    plusFineExiste = true;
    const blocs = blocsCouvrant(debut, fin, tailleBloc(source.marche, resolutionMs));
    if (blocs.length <= PLAFOND_REQUETES) {
      return { source, resolution, resolutionMs, dureeParent, debut, fin, blocs };
    }
  }
  return plusFineExiste ? "plage trop longue" : "aucune unité plus fine";
}

// ───────────────────────────── Regroupement et contrôle ─────────────────────────────

/**
 * Sous-bougies VALIDÉES par open time de parente, pour les parentes [from, to) clôturées.
 * Une parente n'est retenue que si ses sous-bougies retrouvent son volume (à 1e-6 près) et
 * restent dans son [bas, haut] ; sinon elle est absente de la carte (repli de l'appelant).
 * `sous` : triées par temps croissant, sans doublon. PURE.
 */
export function regrouperParBougie(
  parents: readonly Candle[],
  from: number,
  to: number,
  dureeParent: number,
  sous: readonly Candle[],
  maintenant: number,
): Map<number, Candle[]> {
  const out = new Map<number, Candle[]>();
  for (let i = Math.max(0, from); i < Math.min(parents.length, to); i++) {
    const p = parents[i];
    if (p === undefined || !estClose(p, dureeParent, maintenant) || !(p.volume > 0)) continue;
    const finP = p.time + dureeParent;
    // Recherche dichotomique de la première sous-bougie ≥ p.time.
    let lo = 0;
    let hi = sous.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sous[mid]?.time ?? Infinity) < p.time) lo = mid + 1;
      else hi = mid;
    }
    const membres: Candle[] = [];
    let somme = 0;
    let coherent = true;
    const marge = 1e-9 * Math.max(1, Math.abs(p.high));
    for (let j = lo; j < sous.length; j++) {
      const s = sous[j];
      if (s === undefined || s.time >= finP) break;
      if (s.low < p.low - marge || s.high > p.high + marge) coherent = false;
      somme += s.volume;
      membres.push(s);
    }
    if (!coherent || membres.length === 0) continue;
    if (Math.abs(somme - p.volume) > TOLERANCE_VOLUME * p.volume + 1e-12) continue;
    out.set(p.time, membres);
  }
  return out;
}

/** Bougies à profiler : sous-bougies des parentes couvertes, parente sinon. PURE. */
export function aplatirIntrabar(
  parents: readonly Candle[],
  from: number,
  to: number,
  parBougie: ReadonlyMap<number, readonly Candle[]>,
): Candle[] {
  const out: Candle[] = [];
  for (let i = Math.max(0, from); i < Math.min(parents.length, to); i++) {
    const p = parents[i];
    if (p === undefined) continue;
    const membres = parBougie.get(p.time);
    if (membres === undefined) out.push(p);
    else for (const s of membres) out.push(s);
  }
  return out;
}

// ───────────────────────────── Téléchargement et cache ─────────────────────────────

/**
 * Ligne brute klines (spot et fapi : mêmes 12 champs) → sous-bougie, ou null si la ligne
 * est malformée ou si la kline n'était pas close à `chargeA` (closeTime k[6] ≥ chargeA).
 * k[9] = volume acheteur taker (base). PURE.
 */
export function ligneVersSousBougie(ligne: unknown, chargeA: number): Candle | null {
  if (!Array.isArray(ligne) || ligne.length < 10) return null;
  const time = Number(ligne[0]);
  const open = Number(ligne[1]);
  const high = Number(ligne[2]);
  const low = Number(ligne[3]);
  const close = Number(ligne[4]);
  const volume = Number(ligne[5]);
  const cloture = Number(ligne[6]);
  const buyVolume = Number(ligne[9]);
  const nombres = [time, open, high, low, close, volume, cloture, buyVolume];
  if (!nombres.every(Number.isFinite)) return null;
  if (cloture >= chargeA) return null; // kline en cours au téléchargement : jamais retenue
  if (high < low || volume < 0 || buyVolume < 0 || buyVolume > volume * (1 + 1e-9)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    buyVolume,
    sellVolume: Math.max(0, volume - buyVolume),
    closed: true,
  };
}

interface Bloc {
  bougies: Candle[];
  /** Instant du téléchargement (horloge injectée). */
  chargeA: number;
  /** Fin du bloc (exclue). */
  fin: number;
}

export interface LectureIntrabar {
  /** Sous-bougies des blocs en cache (triées, filtrées sur [debut, fin) du plan). */
  sous: Candle[];
  /** Blocs à (re)télécharger : absents mais admis (place disponible), ou à rafraîchir. */
  aCharger: number[];
  /** Pause réseau après un échec récent : les blocs manquants ne partiront qu'après elle. */
  erreur: boolean;
  /** Blocs nouveaux refusés : ils ne tiennent pas dans la place libre ou libérable. */
  sature: boolean;
}

export interface DependancesChargeur {
  fetch?: typeof fetch;
  maintenant?: () => number;
  capacite?: number;
}

/** Bail d'un client : clés des blocs de son plan courant et instant de sa dernière lecture. */
interface Bail {
  cles: readonly string[];
  luA: number;
}

/**
 * Cache LRU de blocs de sous-bougies + téléchargement EN SÉRIE (une requête à la fois,
 * tous consommateurs confondus) avec déduplication des blocs en vol. Les blocs sous bail
 * d'un client actif ne sont jamais évincés pour en charger d'autres ; un plan qui ne
 * tient pas dans la place restante est refusé (`sature`) au lieu d'évincer.
 */
export class ChargeurIntrabar {
  private readonly blocs = new Map<string, Bloc>();
  private readonly enVol = new Map<string, Promise<void>>();
  private readonly baux = new Map<number, Bail>();
  private file: Promise<void> = Promise.resolve();
  private readonly fetchFn: typeof fetch;
  private readonly maintenant: () => number;
  private readonly capacite: number;
  /** Après un échec, aucune requête avant cet instant (toutes surfaces confondues). */
  private pauseJusqua = -Infinity;
  private delaiPause = REESSAI_MS;
  /** Requêtes réseau émises (diagnostic, tests de bornes). */
  requetes = 0;

  constructor(deps: DependancesChargeur = {}) {
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    this.maintenant = deps.maintenant ?? Date.now;
    this.capacite = Math.max(1, deps.capacite ?? CAPACITE_BLOCS);
  }

  /** Nombre de blocs en cache (borne LRU). */
  get taille(): number {
    return this.blocs.size;
  }

  private cle(plan: Pick<PlanIntrabar, "source" | "resolution">, index: number): string {
    return `${plan.source.marche}:${plan.source.symbole}:${plan.resolution}:${index}`;
  }

  /** Clés sous un bail encore valide ; les baux expirés sont purgés au passage. */
  private epingles(maintenant: number): Set<string> {
    const out = new Set<string>();
    for (const [client, bail] of this.baux) {
      if (maintenant - bail.luA > BAIL_MS) this.baux.delete(client);
      else for (const cle of bail.cles) out.add(cle);
    }
    return out;
  }

  /**
   * Blocs nouveaux que le cache peut encore accueillir : place libre, moins les blocs
   * nouveaux déjà en vol (réservés), plus les blocs qu'aucun bail ne retient et que le
   * plan demandeur n'utilise pas (évinçables).
   */
  private placeDisponible(duPlan: ReadonlySet<string>, maintenant: number): number {
    const epingles = this.epingles(maintenant);
    let reserves = 0;
    for (const cle of this.enVol.keys()) if (!this.blocs.has(cle)) reserves++;
    let liberables = 0;
    for (const cle of this.blocs.keys()) if (!epingles.has(cle) && !duPlan.has(cle)) liberables++;
    return this.capacite - this.blocs.size - reserves + liberables;
  }

  /**
   * Lecture SYNCHRONE : ce que le cache sait du plan, et ce qu'il reste à charger. Avec
   * `client`, renouvelle son bail sur les blocs du plan (et abandonne ceux de son plan
   * précédent). Les blocs absents ne sont admis que s'ils tiennent TOUS dans la place
   * disponible ; sinon `sature` et aucun d'eux n'est à charger.
   */
  lire(plan: PlanIntrabar, client?: number): LectureIntrabar {
    const maintenant = this.maintenant();
    const cles = plan.blocs.map((index) => this.cle(plan, index));
    if (client !== undefined) this.baux.set(client, { cles, luA: maintenant });
    const enPause = maintenant < this.pauseJusqua;
    const sous: Candle[] = [];
    const aCharger: number[] = [];
    const nouveaux: number[] = [];
    let erreur = false;
    for (let k = 0; k < plan.blocs.length; k++) {
      const index = plan.blocs[k];
      const cle = cles[k];
      if (index === undefined || cle === undefined) continue;
      const bloc = this.blocs.get(cle);
      if (bloc !== undefined) {
        // LRU : un bloc lu redevient le plus récent.
        this.blocs.delete(cle);
        this.blocs.set(cle, bloc);
        for (const s of bloc.bougies) if (s.time >= plan.debut && s.time < plan.fin) sous.push(s);
        // Bloc téléchargé avant la clôture des sous-bougies utiles au plan : à rafraîchir.
        if (bloc.chargeA >= Math.min(bloc.fin, plan.fin) + MARGE_CLOTURE_MS) continue;
      }
      if (enPause) erreur = true;
      // Rafraîchissement sur place, ou bloc déjà réservé en vol : aucune place nouvelle.
      else if (bloc !== undefined || this.enVol.has(cle)) aCharger.push(index);
      else nouveaux.push(index);
    }
    let sature = false;
    if (nouveaux.length > 0) {
      if (nouveaux.length <= this.placeDisponible(new Set(cles), maintenant)) aCharger.push(...nouveaux);
      else sature = true;
    }
    aCharger.sort((a, b) => a - b);
    return { sous, aCharger, erreur, sature };
  }

  /** Libère le bail d'un client (surface fermée) : ses blocs redeviennent évinçables. */
  liberer(client: number): void {
    this.baux.delete(client);
  }

  /**
   * Télécharge les blocs manquants ADMIS du plan (au plus PLAFOND_REQUETES), en série.
   * L'admission (place réservée par les blocs en vol) se refait ici, au départ réel.
   */
  async charger(plan: PlanIntrabar, client?: number): Promise<void> {
    const { aCharger } = this.lire(plan, client);
    await Promise.all(aCharger.slice(0, PLAFOND_REQUETES).map((index) => this.chargerBloc(plan, index)));
  }

  /**
   * Ramène le cache à sa capacité : d'abord les blocs les moins récemment lus qu'aucun
   * bail ne retient ; puis, seulement dans la course rare où un bail a repris des blocs
   * évinçables pendant un téléchargement, le LRU tout court (borne mémoire dure). Le
   * client lésé retrouve alors un bloc manquant que l'admission refuse : pas de boucle.
   */
  private evincer(): void {
    if (this.blocs.size <= this.capacite) return;
    const epingles = this.epingles(this.maintenant());
    for (const cle of this.blocs.keys()) {
      if (this.blocs.size <= this.capacite) return;
      if (!epingles.has(cle)) this.blocs.delete(cle);
    }
    for (const cle of this.blocs.keys()) {
      if (this.blocs.size <= this.capacite) return;
      this.blocs.delete(cle);
    }
  }

  private chargerBloc(plan: PlanIntrabar, index: number): Promise<void> {
    const cle = this.cle(plan, index);
    const deja = this.enVol.get(cle);
    if (deja !== undefined) return deja;
    const taille = tailleBloc(plan.source.marche, plan.resolutionMs);
    const debut = index * taille;
    const fin = debut + taille;
    const promesse = this.file
      // Pause posée par un échec survenu pendant l'attente dans la file : aucune requête.
      .then(() => (this.maintenant() < this.pauseJusqua ? null : this.telecharger(plan, debut, fin)))
      .then(
        (bloc) => {
          if (bloc === null) return;
          this.delaiPause = REESSAI_MS;
          this.blocs.delete(cle);
          this.blocs.set(cle, bloc);
          this.evincer();
        },
        () => {
          // Échec (HTTP, réseau, délai dépassé) : pause globale, doublée s'il se répète.
          this.pauseJusqua = this.maintenant() + this.delaiPause;
          this.delaiPause = Math.min(2 * this.delaiPause, PAUSE_MAX_MS);
        },
      )
      .finally(() => this.enVol.delete(cle));
    this.file = promesse;
    this.enVol.set(cle, promesse);
    return promesse;
  }

  private async telecharger(plan: PlanIntrabar, debut: number, fin: number): Promise<Bloc> {
    const limite = LIMITE_PAR_REQUETE[plan.source.marche];
    const q = new URLSearchParams({
      symbol: plan.source.symbole,
      interval: plan.resolution,
      startTime: String(debut),
      endTime: String(fin - 1),
      limit: String(limite),
    });
    // Spot : appel direct (CORS public, déjà en connect-src). Perp : fapi via extUrl,
    // patron de `fetchPerpDeltaHistory` (auxProvider.ts) — direct sur Vercel.
    const url =
      plan.source.marche === "spot" ? `${URL_SPOT}?${q}` : extUrl("fapi.binance.com", `fapi/v1/klines?${q}`);
    this.requetes += 1;
    // Délai maximal : l'abandon suit le chemin d'échec (pause, libellé « indisponible »).
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(DELAI_REQUETE_MS) });
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const brut: unknown = await res.json();
    if (!Array.isArray(brut)) throw new Error("Binance klines : réponse inattendue");
    const chargeA = this.maintenant();
    const bougies: Candle[] = [];
    let precedent = -Infinity;
    for (const ligne of brut) {
      const s = ligneVersSousBougie(ligne, chargeA);
      if (s === null || s.time < debut || s.time >= fin || s.time <= precedent) continue;
      precedent = s.time;
      bougies.push(s);
    }
    return { bougies, chargeA, fin };
  }
}

let chargeurPartage: ChargeurIntrabar | null = null;

/** Chargeur commun à toutes les surfaces (un seul cache, une seule file de requêtes). */
export function chargeurIntrabarPartage(): ChargeurIntrabar {
  chargeurPartage ??= new ChargeurIntrabar();
  return chargeurPartage;
}

// ───────────────────────────── Client par surface ─────────────────────────────

export interface IdentiteIntrabar {
  exchange: ExchangeId;
  symbol: string;
  timeframe: Timeframe;
}

export interface VueIntrabar {
  /** Bougies à profiler : sous-bougies des parentes couvertes, parente sinon. */
  bougies: Candle[];
  /** Sous-bougies validées par open time de parente (footprint). */
  parBougie: Map<number, Candle[]>;
  /** Parentes remplacées par leurs sous-bougies / parentes de la plage. */
  couvertes: number;
  total: number;
  resolution: ResolutionIntrabar | null;
  /** « réparti à la minute (1m) » quand au moins une parente est couverte, sinon null. */
  libelleResolution: string | null;
  /** Libellé complet à afficher (résolution et couverture, ou repli et motif). */
  libelle: string;
}

export interface ClientIntrabar {
  vue(id: IdentiteIntrabar, bougies: readonly Candle[], from: number, to: number): VueIntrabar;
  dispose(): void;
}

export interface OptionsClient {
  chargeur?: ChargeurIntrabar;
  maintenant?: () => number;
  antiRebondMs?: number;
}

/** Identifiant de bail des clients (un par surface). */
let compteurClients = 0;

/**
 * Client d'UNE surface (VPVR, une VPFR, le footprint) : lecture synchrone au rendu (qui
 * renouvelle son bail sur les blocs de sa plage), chargement anti-rebondi des blocs
 * manquants admis, `surPret` rappelé à l'arrivée (redessin).
 */
export function creerClientIntrabar(surPret: () => void, options: OptionsClient = {}): ClientIntrabar {
  const chargeur = options.chargeur ?? chargeurIntrabarPartage();
  const maintenantFn = options.maintenant ?? Date.now;
  const antiRebond = options.antiRebondMs ?? ANTI_REBOND_MS;
  const idBail = ++compteurClients;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let cleProgrammee: string | null = null;
  let jete = false;

  /** Annule le chargement encore en attente (plage précédente devenue inutile). */
  const annulerAttente = (): void => {
    if (minuteur === undefined) return;
    clearTimeout(minuteur);
    minuteur = undefined;
    cleProgrammee = null;
  };

  const programmer = (plan: PlanIntrabar, aCharger: readonly number[]): void => {
    const cle = `${plan.source.marche}:${plan.source.symbole}:${plan.resolution}:${aCharger.join(",")}:${plan.fin}`;
    if (cle === cleProgrammee) return; // déjà en attente ou en vol pour ces blocs
    cleProgrammee = cle;
    if (minuteur !== undefined) clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      minuteur = undefined;
      // Sans id : le bail reste celui posé par le dernier rendu (plan courant de la surface).
      void chargeur.charger(plan).finally(() => {
        if (jete) return;
        if (cleProgrammee === cle) cleProgrammee = null;
        surPret();
      });
    }, antiRebond);
  };

  return {
    vue(id, bougies, from, to) {
      const lo = Math.max(0, from);
      const hi = Math.min(bougies.length, to);
      const total = Math.max(0, hi - lo);
      const repli = (motif: string, resolution: ResolutionIntrabar | null = null): VueIntrabar => ({
        bougies: bougies.slice(lo, hi),
        parBougie: new Map(),
        couvertes: 0,
        total,
        resolution,
        libelleResolution: null,
        libelle: `${LIBELLE_REPLI} (${motif})`,
      });
      // Sans plan, la surface n'a plus besoin de blocs : bail rendu, attente annulée.
      const sansPlan = (motif: string): VueIntrabar => {
        chargeur.liberer(idBail);
        annulerAttente();
        return repli(motif);
      };
      const source = sourceIntrabar(id.exchange, id.symbol);
      if (source === null) return sansPlan("intrabar Binance seulement");
      const duree = dureeUnite(id.timeframe);
      if (duree === undefined) return sansPlan("unité calendaire");
      const maintenant = maintenantFn();
      const plan = planifierIntrabar(source, duree, bougies, lo, hi, maintenant);
      if (typeof plan === "string") return sansPlan(plan);

      const lecture = chargeur.lire(plan, jete ? undefined : idBail);
      // Plage courante complète, refusée ou en pause : rien à programmer.
      if (lecture.aCharger.length > 0 && !jete) programmer(plan, lecture.aCharger);
      else annulerAttente();
      const parBougie = regrouperParBougie(bougies, lo, hi, duree, lecture.sous, maintenant);
      const enCours = lecture.aCharger.length > 0;
      if (parBougie.size === 0) {
        const etat = enCours
          ? "en chargement"
          : lecture.erreur
            ? "indisponible"
            : lecture.sature
              ? "non chargé, cache saturé"
              : "incomplet";
        return repli(`intrabar ${plan.resolution} ${etat}`, plan.resolution);
      }
      const libelleResolution = LIBELLE_RESOLUTION[plan.resolution];
      const suffixe = enCours
        ? " · chargement…"
        : lecture.erreur
          ? " · partiel (erreur réseau)"
          : lecture.sature
            ? " · partiel (cache saturé)"
            : "";
      return {
        bougies: aplatirIntrabar(bougies, lo, hi, parBougie),
        parBougie,
        couvertes: parBougie.size,
        total,
        resolution: plan.resolution,
        libelleResolution,
        libelle: `${libelleResolution} · ${parBougie.size}/${total}${suffixe}`,
      };
    },
    dispose() {
      jete = true;
      annulerAttente();
      chargeur.liberer(idBail);
    },
  };
}
