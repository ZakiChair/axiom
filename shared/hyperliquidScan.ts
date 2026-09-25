/**
 * Scan des niveaux de liquidation RÉELS Hyperliquid — code PARTAGÉ entre le daemon `axiomd`
 * (apps/daemon/src/hyperliquid.ts, qui réexporte ces symboles), la fonction Vercel
 * `api/hlpool.ts` (pool réduit servi par le CDN) et le scanner NAVIGATEUR
 * (apps/web/src/data/hyperliquidLiqNavigateur.ts, mode Vercel ou local sans daemon).
 *
 * Module FEUILLE et PUR d'environnement : aucun import, ni Bun, ni node:*, ni DOM — seulement
 * les API Web communes aux trois cibles (fetch, Response, AbortSignal, setTimeout, console).
 * Tout ce qui dépend d'un environnement est INJECTÉ : horloge, en-têtes (le user-agent du
 * daemon, en-tête interdit au navigateur), journal, pause avant lot (onglet caché),
 * interruption (couche passée à OFF), progression (barres publiées pendant le scan).
 * Même mécanisme de partage que shared/daemon-capabilities.ts : fichier relatif, ajouté à
 * l'`include` des deux tsconfig (web + daemon) ; importé en `../shared/hyperliquidScan.js`
 * par la fonction Vercel (convention de api/proxy.ts, tracée par le bundler Vercel).
 *
 * Deux amonts :
 *  - Pool d'adresses : GET stats-data.hyperliquid.xyz/Mainnet/leaderboard (≈ 39 Mo non
 *    compressés, ≈ 31-33 s mesurées le 2026-09-25 sur la liaison du poste). Pool cible de
 *    TAILLE_POOL (~1 500) adresses : top N_VALEUR_POOL (500) par accountValue, complété par
 *    le classement volume hebdomadaire (cf. extrairePool). ÉCHANTILLON du leaderboard, JAMAIS
 *    « toutes » les positions.
 *  - Instantané des positions : POST api.hyperliquid.xyz/info { type: "clearinghouseState",
 *    user } par adresse, CONCURRENCE (4) en vol, lots cadencés par un DÉBIT DE POIDS
 *    plafonné (cf. DEBIT_POIDS_MIN). UN SEUL instantané couvre TOUS les coins.
 *
 * QUOTA (doc officielle lue le 2026-09-25, hyperliquid.gitbook.io → For developers → API →
 * « Rate limits and user limits ») : « REST requests share an aggregated weight limit of
 * 1200 per minute » PAR IP ; poids 2 pour « l2Book, allMids, clearinghouseState, orderStatus,
 * spotClearinghouseState, exchangeStatus », 20 pour les autres requêtes info. Budget :
 * 1 500 adresses × 2 = 3 000 poids par scan ; à 750 poids/min → ≈ 240 s (mesuré le
 * 2026-09-25 : 1 500 adresses en 240,9 s, aucun 429). Les 450 poids/min restants vont aux
 * autres appels HL du navigateur (même IP que le daemon en local ; seul sur son IP sur
 * Vercel) ; un 429 tronque l'instantané.
 *
 * PIÈGE amont (vérifié) : en marge croisée, `liquidationPx` peut être `null` (compte bien
 * collatéralisé) ou ABERRANT (short BNB de 12 $ « liquidable » à 53 899 700 $). On renvoie
 * les niveaux BRUTS mais on filtre l'évident : liquidationPx non-null, fini, > 0, et
 * positionValue ≥ 1000 $.
 */

export const URL_LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
export const URL_INFO = "https://api.hyperliquid.xyz/info";

/**
 * Taille CIBLE totale du pool d'adresses échantillonné (demande du propriétaire du
 * 2026-09-25 : « ~1 500 »). Échantillon du leaderboard, JAMAIS « toutes » les positions.
 */
export const TAILLE_POOL = 1500;
/** Part du pool prise au classement `accountValue` (les plus gros comptes). */
export const N_VALEUR_POOL = 500;
/** Fraîcheur du pool d'adresses : au plus un téléchargement des ≈ 39 Mo / 6 h. */
export const TTL_POOL_MS = 6 * 3_600_000;
/** Plancher de valeur notionnelle : sous ce seuil, un liquidationPx est du bruit. */
export const SEUIL_VALEUR_USD = 1000;

/** Requêtes `clearinghouseState` en vol simultanément (un lot). */
export const CONCURRENCE = 4;
/** Poids d'une requête `clearinghouseState` (doc officielle, cf. en-tête). */
export const POIDS_CLEARINGHOUSE = 2;
/**
 * Poids/min alloués au scan, SOUS le quota IP de 1 200 : la marge (450/min) reste aux autres
 * appels HL de la même IP. Elle dépend des indicateurs HL actifs : chaque série
 * `fundingHistory` 90 j (hlFunding, fundingHistHl ; TTL aux 60 s, pages de 500 à 20 + 25
 * poids) coûte ≈ 208 poids/min, le ticker HL 2 × (20 + 20 par symbole -PERP) par minute.
 * Au-delà, un 429 tronque l'instantané.
 */
export const DEBIT_POIDS_MIN = 750;
/**
 * Écart minimal entre les DÉMARRAGES de deux lots : CONCURRENCE × POIDS × 60 000 / DÉBIT
 * = 640 ms (arrondi au-dessus si la division ne tombe pas juste, pour ne jamais dépasser
 * le débit alloué). 1 500 adresses = 375 lots → ≈ 240 s par scan.
 */
export const INTERVALLE_LOT_MS = Math.ceil((CONCURRENCE * POIDS_CLEARINGHOUSE * 60_000) / DEBIT_POIDS_MIN);
/**
 * Abandon précoce : si les LOTS_ECHEC_ABANDON PREMIERS lots échouent TOUS (aucune adresse
 * n'a répondu, hors 429 qui a son propre arrêt), l'amont est en panne — inutile de cadencer
 * 375 lots d'échecs (≈ 240 s, voire ≈ 62 min si chaque requête pend jusqu'à
 * TIMEOUT_ETAT_MS). En DÉBUT de scan seulement : un incident passager au milieu d'un scan
 * sain ne le tronque pas. `clearinghouseState` répond pour toute adresse valide (même
 * vide) : 12 échecs d'affilée — 16 avec le rejeu du 1er lot — signent une panne, pas des
 * comptes particuliers.
 * AVANT d'abandonner, le PREMIER lot est rejoué UNE fois, à la cadence (un intervalle de
 * lot, 8 poids) : une coupure d'≈ 1-2 s au lancement (réveil machine, Wi-Fi, rafale de
 * 502) couvre les 3 lots (partis à 0, 640, 1 280 ms) sans signer une panne. Une adresse
 * répond au rejeu → scan poursuivi (les adresses des lots 2 et 3 ne comptent simplement
 * pas) ; aucune → abandon.
 */
export const LOTS_ECHEC_ABANDON = 3;
/** Délai d'une requête `clearinghouseState` (une adresse qui pend est ignorée). */
export const TIMEOUT_ETAT_MS = 10_000;
/** Le leaderboard pèse ≈ 39 Mo : bornage large, seulement contre une réponse aberrante. */
export const TAILLE_MAX_LEADERBOARD = 80 * 1024 * 1024;
/** ≈ 31 s mesurées le 2026-09-25 sur la liaison du poste (1,5 Mo/s) : marge ×4. */
export const TIMEOUT_LEADERBOARD_MS = 120_000;
/**
 * Progression (option `onProgression`) : au plus un rappel tous les 5 lots — 20 adresses,
 * ≈ 3,2 s à la cadence nominale — assez tôt pour que les premières barres apparaissent
 * vite, assez rare pour ne pas ré-agréger l'instantané partiel à chaque lot.
 */
export const LOTS_PAR_PROGRESSION = 5;

/** Un niveau de liquidation réel (les champs sont tous scalaires : contrat front). */
export interface NiveauLiqHL {
  /** Prix de liquidation (`liquidationPx`). */
  px: number;
  /** Sens de la position (`szi` > 0 → long). */
  side: "long" | "short";
  /** Valeur notionnelle en $ (`positionValue`). */
  valueUsd: number;
  entryPx: number;
  /** Levier NUMÉRIQUE (`leverage.value`, pas l'objet {type,value}). */
  lev: number;
  addr: string;
}

/** Niveau + son coin (le coin ne figure pas dans NiveauLiqHL : il est la clé d'agrégation). */
export interface PositionLiq {
  coin: string;
  niveau: NiveauLiqHL;
}

/** Instantané des positions du pool, tous coins confondus. */
export interface InstantaneHL {
  /** Horodatage de CONSTRUCTION de l'instantané (pas de la requête). */
  ts: number;
  /** Nombre d'adresses ayant effectivement répondu (les échecs sont ignorés). */
  adressesScannees: number;
  parCoin: Map<string, NiveauLiqHL[]>;
}

/**
 * Horloge du scan : `now` mesure la cadence, les minuteurs portent les attentes. Définie
 * ici structurellement (le daemon lui passe sa `HorlogeWs`, sur-ensemble compatible).
 */
export interface HorlogeScan {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const HORLOGE_REELLE: HorlogeScan = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Injections du scan. Sans elles, comportement historique du daemon (hors journal/en-têtes). */
export interface OptionsScan {
  /** Horloge (tests : horloge factice → aucun sommeil réel). */
  horloge?: HorlogeScan;
  /** Écart minimal entre démarrages de lots (défaut INTERVALLE_LOT_MS). */
  intervalleLotMs?: number;
  /**
   * Instantané PARTIEL publié pendant le scan : `faites` adresses tentées sur `total`.
   * Au plus un appel tous les `lotsParProgression` lots ; jamais après le dernier lot
   * (l'instantané rendu par construireInstantane est alors complet).
   */
  onProgression?: (partiel: InstantaneHL, faites: number, total: number) => void;
  /** Pas de la progression, en lots (défaut LOTS_PAR_PROGRESSION). */
  lotsParProgression?: number;
  /**
   * Interruption (couche passée à OFF) : vérifiée avant chaque lot — plus aucun lot n'est
   * envoyé, les requêtes en vol (≤ CONCURRENCE, ≤ TIMEOUT_ETAT_MS) finissent seules ; le
   * partiel est rendu.
   */
  signal?: AbortSignal;
  /** Attendue AVANT chaque lot, rejeu compris (pause tant que l'onglet est caché). */
  avantLot?: () => Promise<void>;
  /** Ligne de fin de scan (défaut console.log, sans préfixe ; le daemon préfixe « [axiomd] »). */
  journal?: (ligne: string) => void;
  /** En-têtes ajoutés aux requêtes `clearinghouseState` (user-agent du daemon). */
  entetes?: Record<string, string>;
}

/** Attente de `ms` sur l'horloge fournie. */
function attendre(horloge: HorlogeScan, ms: number): Promise<void> {
  return new Promise((r) => {
    horloge.setTimeout(r, ms);
  });
}

/** Conversion tolérante des champs numériques HL (chaînes « 6.18756 ») ; null si inexploitable. */
function nombre(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const RE_ADRESSE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Top N adresses du leaderboard par `accountValue` DÉCROISSANT (la part « valeur » du
 * pool, d'où le défaut N_VALEUR_POOL). Fonction PURE.
 *
 * PIÈGE : `accountValue` est une CHAÎNE — un tri lexicographique classerait "9"
 * devant "10000000". Le tri est donc numérique. Les lignes sans adresse valide ou
 * sans accountValue exploitable sont écartées ; un JSON inattendu renvoie [].
 */
export function extraireTopAdresses(donnees: unknown, n: number = N_VALEUR_POOL): string[] {
  const lignes = (donnees as { leaderboardRows?: unknown } | null)?.leaderboardRows;
  if (!Array.isArray(lignes)) return [];
  const valides: Array<{ addr: string; valeur: number }> = [];
  for (const ligne of lignes) {
    const addr = (ligne as { ethAddress?: unknown } | null)?.ethAddress;
    if (typeof addr !== "string" || !RE_ADRESSE.test(addr)) continue;
    const valeur = nombre((ligne as { accountValue?: unknown }).accountValue);
    if (valeur === null) continue;
    valides.push({ addr, valeur });
  }
  valides.sort((a, b) => b.valeur - a.valeur);
  return valides.slice(0, n).map((v) => v.addr);
}

/** Fenêtre `windowPerformances` dont le `vlm` classe le pool complémentaire. */
const FENETRE_VOLUME_POOL = "week";

/**
 * Pool d'adresses à scanner, de taille `tailleCible` au plus : le top `nValeur` par
 * `accountValue` décroissant (les plus gros comptes), puis COMPLÉTÉ par le classement
 * volume hebdomadaire (`windowPerformances` fenêtre « week » → `vlm` décroissant),
 * sans doublon, jusqu'à `tailleCible`. `nValeur > tailleCible` → tronqué à la cible.
 * Leaderboard trop maigre → pool plus petit (jamais de remplissage artificiel).
 * Fonction PURE.
 *
 * POURQUOI le volume : le top accountValue est peu leviérisé (liquidationPx
 * lointain ou null) ; les gros TRADEURS du leaderboard portent des positions
 * liquidables plus près du prix. Mesure du 2026-09-22 : intersection top-150
 * valeur ∩ top-150 volume jour = 19 adresses — le complément est substantiel.
 *
 * `windowPerformances` est un tableau de paires `[nom, {pnl, roi, vlm}]`.
 * Les lignes sans adresse `0x…40 hex` ou sans valeur numérique sont écartées ;
 * un JSON inattendu renvoie [].
 */
export function extrairePool(
  donnees: unknown,
  nValeur: number = N_VALEUR_POOL,
  tailleCible: number = TAILLE_POOL,
): string[] {
  const lignes = (donnees as { leaderboardRows?: unknown } | null)?.leaderboardRows;
  if (!Array.isArray(lignes)) return [];
  const parValeur: Array<{ addr: string; score: number }> = [];
  const parVolume: Array<{ addr: string; score: number }> = [];
  for (const ligne of lignes) {
    const addr = (ligne as { ethAddress?: unknown } | null)?.ethAddress;
    if (typeof addr !== "string" || !RE_ADRESSE.test(addr)) continue;
    const valeur = nombre((ligne as { accountValue?: unknown }).accountValue);
    if (valeur !== null) parValeur.push({ addr, score: valeur });
    // fenêtre « week » → vlm (volume), sous-forme de paires [nom, stats].
    const fenetres = (ligne as { windowPerformances?: unknown }).windowPerformances;
    if (Array.isArray(fenetres)) {
      const entree = fenetres.find(
        (f): f is [unknown, unknown] => Array.isArray(f) && f[0] === FENETRE_VOLUME_POOL,
      );
      const vlm = nombre((entree?.[1] as { vlm?: unknown } | null | undefined)?.vlm);
      if (vlm !== null) parVolume.push({ addr, score: vlm });
    }
  }
  parValeur.sort((a, b) => b.score - a.score);
  parVolume.sort((a, b) => b.score - a.score);
  const cible = Math.max(0, tailleCible);
  const retenues = new Set<string>();
  const pool: string[] = [];
  for (const { addr } of parValeur.slice(0, Math.max(0, Math.min(nValeur, cible)))) {
    if (retenues.has(addr)) continue;
    retenues.add(addr);
    pool.push(addr);
  }
  for (const { addr } of parVolume) {
    if (pool.length >= cible) break;
    if (retenues.has(addr)) continue;
    retenues.add(addr);
    pool.push(addr);
  }
  return pool;
}

/**
 * Pool transporté (réponse de `api/hlpool`, stockage local du navigateur) : adresses +
 * horodatage de CONSTRUCTION + PARAMÈTRES de construction (pas la longueur réelle : un
 * leaderboard maigre ne doit pas forcer un retéléchargement à chaque lecture).
 */
export interface PoolHL {
  adresses: string[];
  ts: number;
  nValeur: number;
  tailleCible: number;
}

/**
 * Pool utilisable SANS retéléchargement : mêmes paramètres que les constantes courantes ET
 * moins de TTL_POOL_MS. Paramètres absents (`null`, ancien format daemon) → pas frais. PURE.
 */
export function poolEstFrais(
  p: { ts: number; nValeur: number | null; tailleCible: number | null },
  now: number,
): boolean {
  return p.nValeur === N_VALEUR_POOL && p.tailleCible === TAILLE_POOL && now - p.ts < TTL_POOL_MS;
}

/**
 * Valide un pool transporté. Adresses non conformes (`0x` + 40 hex) écartées une à une,
 * doublons retirés ; null si l'enveloppe n'est pas conforme (HTML du repli SPA servi en 200,
 * champs manquants ou mal typés), si aucune adresse ne reste, ou si le pool dépasse la
 * taille cible qu'il annonce (réponse aberrante). PURE.
 */
export function validerPoolHl(brut: unknown): PoolHL | null {
  if (brut === null || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (!Array.isArray(o.adresses)) return null;
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return null;
  if (typeof o.nValeur !== "number" || typeof o.tailleCible !== "number") return null;
  const vues = new Set<string>();
  const adresses: string[] = [];
  for (const a of o.adresses) {
    if (typeof a !== "string" || !RE_ADRESSE.test(a) || vues.has(a)) continue;
    vues.add(a);
    adresses.push(a);
  }
  if (adresses.length === 0 || adresses.length > o.tailleCible) return null;
  return { adresses, ts: o.ts, nValeur: o.nValeur, tailleCible: o.tailleCible };
}

/**
 * Télécharge le leaderboard (≈ 39 Mo) et en extrait le pool aux paramètres courants.
 * Rejette (Error) sur HTTP ≠ 2xx, corps démesuré (content-length puis longueur lue),
 * JSON invalide ou pool vide — un pool vide ne doit JAMAIS remplacer un bon pool connu.
 * Le délai est porté par `signal` (l'appelant choisit : 120 s daemon/navigateur, sous le
 * maxDuration pour la fonction Vercel).
 */
export async function telechargerPool(
  fetchImpl: typeof fetch,
  options: { signal?: AbortSignal; entetes?: Record<string, string> } = {},
): Promise<string[]> {
  const res = await fetchImpl(URL_LEADERBOARD, {
    headers: { accept: "application/json", ...options.entetes },
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`leaderboard HTTP ${res.status}`);
  // Pré-bornage sur l'en-tête avant lecture du corps (le corps NORMAL fait ≈ 39 Mo).
  const cl = res.headers.get("content-length");
  if (cl !== null && Number(cl) > TAILLE_MAX_LEADERBOARD) throw new Error("leaderboard trop volumineux");
  const texte = await res.text();
  if (texte.length > TAILLE_MAX_LEADERBOARD) throw new Error("leaderboard trop volumineux");
  const adresses = extrairePool(JSON.parse(texte));
  if (adresses.length === 0) throw new Error("leaderboard sans ligne exploitable");
  return adresses;
}

/**
 * Extrait d'un `clearinghouseState` les positions exploitables. Fonction PURE.
 * Filtre (cf. piège amont documenté en tête de fichier) : liquidationPx non-null,
 * fini et > 0 ; positionValue ≥ SEUIL_VALEUR_USD ; szi non nul.
 */
export function parserEtatCompte(etat: unknown, addr: string): PositionLiq[] {
  const positions = (etat as { assetPositions?: unknown } | null)?.assetPositions;
  if (!Array.isArray(positions)) return [];
  const resultat: PositionLiq[] = [];
  for (const entree of positions) {
    const p = (entree as { position?: Record<string, unknown> } | null)?.position;
    if (p === null || typeof p !== "object") continue;
    const coin = p.coin;
    if (typeof coin !== "string" || coin === "") continue;
    const px = nombre(p.liquidationPx);
    if (px === null || px <= 0) continue;
    const valueUsd = nombre(p.positionValue);
    if (valueUsd === null || valueUsd < SEUIL_VALEUR_USD) continue;
    const szi = nombre(p.szi);
    if (szi === null || szi === 0) continue;
    const lev = nombre((p.leverage as { value?: unknown } | null | undefined)?.value);
    resultat.push({
      coin,
      niveau: {
        px,
        side: szi > 0 ? "long" : "short",
        valueUsd,
        entryPx: nombre(p.entryPx) ?? 0,
        lev: lev ?? 0,
        addr,
      },
    });
  }
  return resultat;
}

/** Regroupe les positions par coin (casse EXACTE : HL a des « kPEPE »). Fonction PURE. */
export function agregerParCoin(positions: readonly PositionLiq[]): Map<string, NiveauLiqHL[]> {
  const parCoin = new Map<string, NiveauLiqHL[]>();
  for (const { coin, niveau } of positions) {
    const liste = parCoin.get(coin);
    if (liste === undefined) parCoin.set(coin, [niveau]);
    else liste.push(niveau);
  }
  return parCoin;
}

/** Résultat d'un `clearinghouseState` : positions, échec isolé, ou limite de quota. */
export interface ResultatEtat {
  /** Positions extraites ; null si l'appel a échoué (adresse ignorée). */
  positions: PositionLiq[] | null;
  /** true si l'amont a répondu HTTP 429 (quota) — l'instantané doit s'arrêter là. */
  limite: boolean;
}

/**
 * Interroge `clearinghouseState` pour une adresse. Un HTTP 429 est distingué des
 * autres échecs (`limite`) : il signale que le quota est atteint et que continuer
 * les lots suivants ne produirait que des erreurs.
 */
export async function etatCompte(
  addr: string,
  fetchImpl: typeof fetch,
  entetes: Record<string, string> = {},
): Promise<ResultatEtat> {
  try {
    const res = await fetchImpl(URL_INFO, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...entetes },
      body: JSON.stringify({ type: "clearinghouseState", user: addr }),
      signal: AbortSignal.timeout(TIMEOUT_ETAT_MS),
    });
    if (res.status === 429) return { positions: null, limite: true };
    if (!res.ok) return { positions: null, limite: false };
    return { positions: parserEtatCompte(await res.json(), addr), limite: false };
  } catch {
    return { positions: null, limite: false }; // échec d'UNE adresse : ignorée, jamais d'échec global
  }
}

/**
 * Construit l'instantané des positions du pool : lots de CONCURRENCE requêtes en
 * vol ; chaque lot démarre au plus tôt `intervalleLotMs` (INTERVALLE_LOT_MS) après
 * le DÉMARRAGE du précédent — la durée du lot est déduite de l'attente, aucune
 * attente après le dernier lot. Débit résultant ≤ DEBIT_POIDS_MIN poids/min.
 * Une adresse en échec est simplement ignorée et ne compte pas dans
 * `adressesScannees`. Un 429 amont interrompt le reste de l'instantané : les lots
 * non envoyés ne sont PAS lancés (les adresses restantes ne comptent pas). Idem si
 * les LOTS_ECHEC_ABANDON premiers lots échouent tous ET que le rejeu unique du premier
 * lot (un lot cadencé comme les autres) échoue aussi (amont en panne), ou si
 * `options.signal` est interrompu (vérifié avant chaque lot, après la pause `avantLot`).
 * `options.avantLot` est attendue avant de mesurer le démarrage du lot : une pause (onglet
 * caché) ne provoque donc aucune rafale à la reprise.
 */
export async function construireInstantane(
  adresses: readonly string[],
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
  options: OptionsScan = {},
): Promise<InstantaneHL> {
  const horloge = options.horloge ?? HORLOGE_REELLE;
  const intervalle = options.intervalleLotMs ?? INTERVALLE_LOT_MS;
  const pasProgression = Math.max(1, options.lotsParProgression ?? LOTS_PAR_PROGRESSION);
  const journal = options.journal ?? ((ligne: string) => console.log(ligne));
  const entetes = options.entetes ?? {};
  const debut = horloge.now(); // horloge réelle (≠ `now`, horodatage logique de l'instantané)
  const positions: PositionLiq[] = [];
  let adressesScannees = 0;
  let limite429 = false;
  let abandon = false;
  let interrompu = false;
  let rejeu = false;
  /** Pause éventuelle puis vérification de l'interruption ; false → ne plus rien envoyer. */
  const pretPourLot = async (): Promise<boolean> => {
    if (options.signal?.aborted) return false;
    if (options.avantLot !== undefined) await options.avantLot();
    return options.signal?.aborted !== true;
  };
  /** Envoie un lot et intègre ses réponses (échecs ignorés, 429 signalé). */
  const scannerLot = async (lot: readonly string[]): Promise<void> => {
    const resultats = await Promise.all(lot.map((a) => etatCompte(a, fetchImpl, entetes)));
    for (const r of resultats) {
      if (r.limite) {
        limite429 = true;
        continue;
      }
      if (r.positions === null) continue;
      adressesScannees += 1;
      positions.push(...r.positions);
    }
  };
  for (let i = 0; i < adresses.length; i += CONCURRENCE) {
    if (!(await pretPourLot())) {
      interrompu = true;
      break;
    }
    let debutLot = horloge.now();
    await scannerLot(adresses.slice(i, i + CONCURRENCE));
    if (limite429) break; // quota atteint : on n'envoie plus les lots restants
    const resteDesLots = i + CONCURRENCE < adresses.length;
    // Premiers lots tous en échec (réseau, 5xx, délais) : panne, ou coupure brève au
    // lancement ? Le premier lot est rejoué UNE fois, à la cadence (cf. LOTS_ECHEC_ABANDON).
    if (!rejeu && resteDesLots && adressesScannees === 0 && i / CONCURRENCE + 1 >= LOTS_ECHEC_ABANDON) {
      rejeu = true;
      const avantRejeu = debutLot + intervalle - horloge.now();
      if (avantRejeu > 0) await attendre(horloge, avantRejeu);
      if (!(await pretPourLot())) {
        interrompu = true;
        break;
      }
      debutLot = horloge.now(); // le lot suivant se cadence sur le DÉMARRAGE du rejeu
      await scannerLot(adresses.slice(0, CONCURRENCE));
      if (limite429) break;
      // Toujours aucune réponse : amont en panne, on n'envoie plus rien.
      if (adressesScannees === 0) {
        abandon = true;
        break;
      }
    }
    // Progression : instantané PARTIEL tous les `pasProgression` lots (jamais après le
    // dernier : l'instantané complet est rendu juste après).
    if (options.onProgression !== undefined && resteDesLots && (i / CONCURRENCE + 1) % pasProgression === 0) {
      options.onProgression(
        { ts: now, adressesScannees, parCoin: agregerParCoin(positions) },
        Math.min(i + CONCURRENCE, adresses.length),
        adresses.length,
      );
    }
    const reste = debutLot + intervalle - horloge.now();
    if (resteDesLots && reste > 0) await attendre(horloge, reste);
  }
  // Durée réelle du scan (≈ 240 s attendues pour 1 500 adresses) : une ligne de journal
  // par instantané construit, pour vérifier la cadence en service.
  const dureeS = Math.max(0, (horloge.now() - debut) / 1000);
  journal(
    `instantané HL : ${adressesScannees} adresses en ${dureeS.toFixed(1)} s` +
      (rejeu ? " (1er lot rejoué)" : "") +
      (limite429 ? " (interrompu sur 429)" : "") +
      (abandon ? " (abandonné : amont en échec)" : "") +
      (interrompu ? " (interrompu)" : ""),
  );
  return { ts: now, adressesScannees, parCoin: agregerParCoin(positions) };
}
