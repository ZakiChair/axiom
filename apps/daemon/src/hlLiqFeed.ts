/**
 * hlLiqFeed.ts — liquidations EXÉCUTÉES Hyperliquid, collectées à FROID par le daemon
 * (« minage officiel partiel » — décision du propriétaire). 3e connexion de la boucle
 * liquidations (cf. liqFeed.ts, qui compose notre santé ; CE module n'importe PAS
 * liqFeed pour éviter un cycle).
 *
 * POURQUOI ce modèle : Hyperliquid n'a AUCUN flux public de liquidations. Elles
 * n'apparaissent que dans les `userFills` des adresses impliquées — le champ
 * `WsFill.liquidation?: { liquidatedUser?: string; markPx: string;
 * method: "market" | "backstop" }` marque les fills d'une liquidation :
 *  - liquidation de MARCHÉ : la contrepartie est un MAKER ; son fill porte
 *    `liquidation.liquidatedUser` = l'adresse liquidée ;
 *  - liquidation BACKSTOP : le vault « HLP Liquidator »
 *    (0x2e3d94f0562703b25c83308a05046ddaf9a8dd14, enfant de HLP — vérifié via
 *    vaultDetails) reprend la position ; son fill porte aussi `liquidation`.
 *
 * Le feed suit donc : (1) le vault HLP Liquidator (toujours), (2) les NB_MAKERS_SUIVIS
 * makers les plus actifs, classés par volume maker glissant FENETRE_MAKERS_MS observé
 * sur le flux public `trades` (maker d'un trade = `side === "B" ? users[1] : users[0]`),
 * avec rotation toutes les PERIODE_ROTATION_MS et HYSTÉRÉSIS (TOLERANCE_RANG) pour ne
 * pas resouscrire en rafale. Limites HL par IP : 10 connexions WS, 10 utilisateurs
 * uniques à travers les souscriptions par utilisateur, 1 000 souscriptions →
 * 9 makers + le vault = 10. AUCUN appel REST dans ce feed.
 *
 * COUVERTURE PARTIELLE (mesurée : top-10 makers ≈ 55 % du volume BTC, top-20 ≈ 70 %) :
 * la santé expose `partiel: true` + `couverture` (part du volume maker suivie) — le
 * front l'affiche et ne laisse PAS cette source masquer le silence de Bybit/OKX.
 *
 * CONVENTION DE CÔTÉ (figée par test) — sur le fill de la CONTREPARTIE (adresse suivie
 * ≠ liquidatedUser) : side "B" (elle achète) → LONG liquidé ; "A" → SHORT. Sur le fill
 * du LIQUIDÉ LUI-MÊME (comparaison insensible à la casse) : "B" (rachat pour fermer) →
 * SHORT ; "A" → LONG. `liquidatedUser` absent → fill IGNORÉ (pas de devinette).
 *
 * WS `wss://api.hyperliquid.xyz/ws` : souscriptions `{method:"subscribe",
 * subscription:{type:"trades",coin}}` et `{type:"userFills",user}` ; HL ferme une WS
 * silencieuse > 60 s → heartbeat `{"method":"ping"}` toutes les 30 s (HEARTBEAT_HL).
 * Le 1er message `userFills` après souscription est un INSTANTANÉ des fills récents —
 * traité comme les autres, la déduplication par `tid` fait le reste.
 */
import { insererLiquidations, type LiqFil } from "./liquidations";
import { connecterBoucleWs, type HorlogeWs } from "./wsLoop";

/** Endpoint WS public Hyperliquid. */
export const URL_WS_HL = "wss://api.hyperliquid.xyz/ws";
/** Vault « HLP Liquidator » (backstop) — toujours suivi, hors quota des 9 makers. */
export const ADRESSE_HLP_LIQUIDATOR = "0x2e3d94f0562703b25c83308a05046ddaf9a8dd14";
/** Makers suivis en plus du vault (HL : 10 utilisateurs uniques max par IP). */
export const NB_MAKERS_SUIVIS = 9;
/** Hystérésis de rotation : un maker suivi reste tant que rang < k + TOLERANCE_RANG. */
export const TOLERANCE_RANG = 5;
/** Fenêtre glissante du classement des makers (30 min). */
export const FENETRE_MAKERS_MS = 30 * 60_000;
/** Granularité des seaux de volume maker (1 min). */
export const TAILLE_SEAU_MS = 60_000;
/** Cadence de rotation des adresses suivies (5 min). */
export const PERIODE_ROTATION_MS = 5 * 60_000;
/** La première rotation attend 1 min : le temps que les seaux se remplissent. */
export const DELAI_PREMIERE_ROTATION_MS = 60_000;
/** Heartbeat applicatif HL (la venue ferme une WS silencieuse > 60 s). */
export const HEARTBEAT_HL = JSON.stringify({ method: "ping" });
/** Borne FIFO du mémo de déduplication des fills (par tid). */
export const MAX_TIDS_MEMO = 5000;
/** Staleness : liquidations sparses (aligné sur liqFeed). */
const DELAI_STALE_MS = 10 * 60_000;

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Cotations acceptées pour mapper un symbole concaténé vers un coin Hyperliquid,
 * triées par longueur DÉCROISSANTE (suffixe le plus long d'abord : "USDT" avant "USD").
 * COPIE ANNOTÉE — l'import depuis apps/web est INTERDIT (règle cross-package).
 */
const COTATIONS_HL: readonly string[] = ["USDT", "USDC", "USD"];

/**
 * Aliases des perps « 1000× » : la base concaténée (ex. "1000PEPE") correspond au coin
 * HL préfixé « k » ("kPEPE"). Vérifié sur l'API meta.
 */
const ALIAS_COINS_HL: Readonly<Record<string, string>> = {
  "1000PEPE": "kPEPE",
  "1000SHIB": "kSHIB",
  "1000BONK": "kBONK",
  "1000FLOKI": "kFLOKI",
  "1000LUNC": "kLUNC",
};

/**
 * Coin Hyperliquid d'un symbole concaténé ("BTCUSDT"/"BTCUSDC"/"BTCUSD" → "BTC",
 * "1000PEPEUSDT" → "kPEPE" via ALIAS_COINS_HL). Base alphanumérique 2–10 caractères
 * requise ; `null` sinon ("BTCEUR", symbole synthétique "BTC|ETH", chaîne vide). PURE.
 */
export function coinHl(symbole: string): string | null {
  const s = symbole.trim().toUpperCase();
  const cotation = COTATIONS_HL.find((q) => s.endsWith(q) && s.length > q.length);
  if (cotation === undefined) return null;
  const base = s.slice(0, s.length - cotation.length);
  if (!/^[A-Z0-9]{2,10}$/.test(base)) return null;
  return ALIAS_COINS_HL[base] ?? base;
}

/** Forme brute des champs lus sur un WsFill HL (tout est `unknown`, gardes en fonction). */
interface FillBrut {
  coin?: unknown;
  side?: unknown; // "A" | "B"
  px?: unknown; // chaîne numérique HL
  sz?: unknown;
  time?: unknown;
  tid?: unknown;
  liquidation?: unknown;
}

/**
 * Parse un `WsFill` HL porteur d'une liquidation en `{coin, tid, liq}` (venue
 * "hyperliquid"), ou `null` si illisible/hors sujet. `adresseSuivie` = l'utilisateur de
 * la souscription userFills d'où vient le fill ; `coins` = coins surveillés.
 * Convention de côté : cf. en-tête (contrepartie B→long / A→short ; liquidé lui-même
 * B→short / A→long, comparaison d'adresse insensible à la casse). PURE.
 */
export function parseFillHl(
  fill: unknown,
  adresseSuivie: string,
  coins: ReadonlySet<string>,
): { coin: string; tid: number; liq: LiqFil } | null {
  if (!fill || typeof fill !== "object") return null;
  const f = fill as FillBrut;
  const liqBrut = f.liquidation;
  if (!liqBrut || typeof liqBrut !== "object") return null;
  const liquidatedUser = (liqBrut as { liquidatedUser?: unknown }).liquidatedUser;
  if (typeof liquidatedUser !== "string" || liquidatedUser.length === 0) return null;
  if (typeof f.coin !== "string" || !coins.has(f.coin)) return null;
  const px = Number(f.px);
  const sz = Number(f.sz);
  const time = Number(f.time);
  const tid = Number(f.tid);
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) return null;
  if (!Number.isFinite(time) || !Number.isFinite(tid)) return null;
  if (f.side !== "A" && f.side !== "B") return null;
  // Contrepartie (adresse suivie ≠ liquidé) : "B" → LONG liquidé, "A" → SHORT.
  // Liquidé lui-même (insensible à la casse) : "B" (rachat) → SHORT, "A" → LONG.
  const luiMeme = adresseSuivie.toLowerCase() === liquidatedUser.toLowerCase();
  const side: "long" | "short" = f.side === "B" ? (luiMeme ? "short" : "long") : luiMeme ? "long" : "short";
  return {
    coin: f.coin,
    tid,
    liq: { t: time, venue: "hyperliquid", side, price: px, qty: sz, usd: px * sz },
  };
}

/** Forme brute d'un WsTrade HL (`users` = [acheteur, vendeur], `side` = côté TAKER). */
interface TradeBrut {
  coin?: unknown;
  side?: unknown;
  px?: unknown;
  sz?: unknown;
  time?: unknown;
  users?: unknown;
}

/**
 * Extrait le MAKER d'un trade public HL : taker acheteur ("B") → maker = vendeur
 * (`users[1]`) ; taker vendeur ("A") → maker = acheteur (`users[0]`). Gardes : coin
 * chaîne, side ∈ {A,B}, px/sz chaînes finies > 0, time fini, `users` = 2 adresses 0x.
 * PURE.
 */
export function makerDuTrade(
  trade: unknown,
): { coin: string; maker: string; usd: number; time: number } | null {
  if (!trade || typeof trade !== "object") return null;
  const t = trade as TradeBrut;
  if (typeof t.coin !== "string" || (t.side !== "A" && t.side !== "B")) return null;
  const px = Number(t.px);
  const sz = Number(t.sz);
  const time = Number(t.time);
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) return null;
  if (!Number.isFinite(time)) return null;
  const users = t.users;
  if (
    !Array.isArray(users) ||
    users.length !== 2 ||
    users.some((u) => typeof u !== "string" || !u.startsWith("0x"))
  ) {
    return null;
  }
  const maker = t.side === "B" ? users[1] : users[0];
  return { coin: t.coin, maker, usd: px * sz, time };
}

// ─────────────────────────── Seaux de volume maker ───────────────────────────

/** Volume maker par seau d'1 min : début du seau (ms) → (adresse maker → usd). */
export type SeauxMakers = Map<number, Map<string, number>>;

/** Accumule `usd` de `maker` dans le seau contenant `time`. PURE (mutateur local). */
export function ajouterAuSeau(seaux: SeauxMakers, time: number, maker: string, usd: number): void {
  const debut = Math.floor(time / TAILLE_SEAU_MS) * TAILLE_SEAU_MS;
  let seau = seaux.get(debut);
  if (seau === undefined) {
    seau = new Map();
    seaux.set(debut, seau);
  }
  seau.set(maker, (seau.get(maker) ?? 0) + usd);
}

/**
 * Élague les seaux entièrement SORTIS de la fenêtre glissante (un seau qui chevauche
 * encore le bord est conservé). PURE (mutateur local).
 */
export function elaguer(seaux: SeauxMakers, now: number, fenetreMs: number): void {
  for (const debut of seaux.keys()) {
    if (debut + TAILLE_SEAU_MS <= now - fenetreMs) seaux.delete(debut);
  }
}

/**
 * Classement des makers par volume cumulé sur la fenêtre glissante (seaux qui la
 * chevauchent), trié DÉCROISSANT. Le vault HLP Liquidator est EXCLU : il est suivi à
 * part (toujours), il ne doit pas occuper une place de maker. PURE.
 */
export function classementMakers(
  seaux: SeauxMakers,
  now: number,
  fenetreMs: number,
): Array<{ maker: string; usd: number }> {
  const totaux = new Map<string, number>();
  for (const [debut, seau] of seaux) {
    if (debut + TAILLE_SEAU_MS <= now - fenetreMs) continue;
    for (const [maker, usd] of seau) {
      if (maker.toLowerCase() === ADRESSE_HLP_LIQUIDATOR) continue;
      totaux.set(maker, (totaux.get(maker) ?? 0) + usd);
    }
  }
  return [...totaux.entries()]
    .map(([maker, usd]) => ({ maker, usd }))
    .sort((a, b) => b.usd - a.usd);
}

/**
 * Choisit les `k` makers à suivre avec HYSTÉRÉSIS : un maker déjà suivi reste tant que
 * son rang < `k + tolerance` ; les places restantes vont aux mieux classés non suivis.
 * Jamais plus de `k` ; l'ordre du résultat suit celui du `classement`. PURE.
 */
export function choisirSuivis(
  classement: readonly string[],
  suivisActuels: readonly string[],
  k = NB_MAKERS_SUIVIS,
  tolerance = TOLERANCE_RANG,
): string[] {
  const rang = new Map(classement.map((m, i) => [m, i]));
  const gardes = new Set(suivisActuels.filter((m) => (rang.get(m) ?? Infinity) < k + tolerance));
  const choisis = new Set(gardes);
  for (const m of classement) {
    if (choisis.size >= k) break;
    choisis.add(m); // ajoute les mieux classés non encore retenus
  }
  return classement.filter((m) => choisis.has(m));
}

/** Delta de souscriptions entre deux ensembles d'adresses. PURE. */
export function deltaSouscriptions(
  anciens: readonly string[],
  nouveaux: readonly string[],
): { retirer: string[]; ajouter: string[] } {
  const n = new Set(nouveaux);
  const a = new Set(anciens);
  return {
    retirer: anciens.filter((x) => !n.has(x)),
    ajouter: nouveaux.filter((x) => !a.has(x)),
  };
}

/**
 * Part du volume maker couverte par les adresses `suivis` sur la fenêtre
 * (∈ [0,1]) ; `null` si le volume total de la fenêtre est nul (couverture
 * indéfinie — le front affiche « en mesure »). PURE.
 */
export function couverture(
  seaux: SeauxMakers,
  suivis: ReadonlySet<string>,
  now: number,
  fenetreMs: number,
): number | null {
  const suivisMin = new Set([...suivis].map((a) => a.toLowerCase()));
  let total = 0;
  let suivi = 0;
  for (const [debut, seau] of seaux) {
    if (debut + TAILLE_SEAU_MS <= now - fenetreMs) continue;
    for (const [maker, usd] of seau) {
      total += usd;
      if (suivisMin.has(maker.toLowerCase())) suivi += usd;
    }
  }
  return total > 0 ? suivi / total : null;
}

// ─────────────────────────── Santé du collecteur ───────────────────────────

/**
 * Santé du collecteur Hyperliquid. `partiel: true` est CONTRACTUEL : la source ne voit
 * qu'une fraction du flux (top makers + vault) — le front ne doit pas laisser cette
 * venue vivante masquer le silence de Bybit/OKX (collecteurLiqMuet ignore les venues
 * partielles).
 */
export interface SanteCollecteurHl {
  /** Dernier message de DONNÉES reçu (trades ou fills, ms) — c'est le silence de la venue. */
  dernierMessageTs: number;
  derniereErreur: string | null;
  /** Source PARTIELLE par construction (cf. en-tête) — toujours true. */
  partiel: true;
  /** Adresses suivies (makers + vault). */
  adressesSuivies: number;
  /** Part du volume maker couverte (∈ [0,1]) ou null si fenêtre vide. */
  couverture: number | null;
  /** Dernière liquidation insérée (ms), 0 = aucune depuis le démarrage. */
  derniereLiqTs: number;
}

const sante: SanteCollecteurHl = {
  dernierMessageTs: 0,
  derniereErreur: null,
  partiel: true,
  adressesSuivies: 0,
  couverture: null,
  derniereLiqTs: 0,
};

/** Santé courante du collecteur HL — composée dans santeLiqFeed() (liqFeed.ts). */
export function santeCollecteurHl(): SanteCollecteurHl {
  return sante;
}

// ─────────────────────────── État partagé du module ───────────────────────────

/** Seaux de volume maker (alimentés par le flux `trades`). */
const seaux: SeauxMakers = new Map();
/** Mémo de déduplication des fills par `tid` (Set + file FIFO bornée). */
const tidsVus = new Set<number>();
const fileTids: number[] = [];
/** Coins surveillés (dérivés des symboles via coinHl) → symboles d'insertion. */
const coinVersSymboles = new Map<string, string[]>();
/** Makers actuellement souscrits en userFills (hors vault). */
let makersSuivis: string[] = [];

/** Réinitialise santé ET état partagé (tests ; appelé par reinitialiserSanteLiqFeed). */
export function reinitialiserSanteHl(): void {
  sante.dernierMessageTs = 0;
  sante.derniereErreur = null;
  sante.adressesSuivies = 0;
  sante.couverture = null;
  sante.derniereLiqTs = 0;
  seaux.clear();
  tidsVus.clear();
  fileTids.length = 0;
  coinVersSymboles.clear();
  makersSuivis = [];
  inserer = (symbole, lot) => {
    insererLiquidations(symbole, lot);
  };
}

/**
 * Recalcule la table coin → symboles depuis un jeu de symboles (via `coinHl` ;
 * symboles non mappables ignorés). Partagée entre le feed (setSymboles) et
 * `ingererMessageHl`. Exportée pour les tests du parseur de messages.
 */
export function majSymbolesHl(symboles: readonly string[]): Map<string, string[]> {
  coinVersSymboles.clear();
  for (const sym of symboles) {
    const coin = coinHl(sym);
    if (coin === null) continue;
    const liste = coinVersSymboles.get(coin);
    if (liste === undefined) coinVersSymboles.set(coin, [sym]);
    else if (!liste.includes(sym)) liste.push(sym);
  }
  return coinVersSymboles;
}

/** Ingestion injectable pour les tests (défaut : la base SQLite du daemon). */
let inserer: (symbole: string, lot: LiqFil[]) => void = (symbole, lot) => {
  insererLiquidations(symbole, lot);
};

/** Remplace l'ingestion (tests uniquement). */
export function definirInsererHl(fn: (symbole: string, lot: LiqFil[]) => void): void {
  inserer = fn;
}

/** Vrai si `tid` est NOUVEAU (et le mémorise, FIFO borné à MAX_TIDS_MEMO). */
function tidNouveau(tid: number): boolean {
  if (tidsVus.has(tid)) return false;
  tidsVus.add(tid);
  fileTids.push(tid);
  if (fileTids.length > MAX_TIDS_MEMO) {
    const ancien = fileTids.shift();
    if (ancien !== undefined) tidsVus.delete(ancien);
  }
  return true;
}

// ─────────────────────────── Ingestion d'un message ───────────────────────────

interface MessageHl {
  channel?: unknown;
  data?: unknown;
}

/**
 * Traite un message WS HL brut. Renvoie `true` pour un message de DONNÉES (trades ou
 * userFills — réarme le backoff de la boucle) ; `subscriptionResponse`/`pong` → false.
 * `trades` alimente les seaux de makers ; `userFills` → parseFillHl par fill
 * (dédupliqué par tid, instantané initial inclus), regroupé par coin puis inséré sous
 * CHAQUE symbole surveillé mappé sur ce coin. `error` → santé + console, false.
 */
export function ingererMessageHl(data: string): boolean {
  let msg: MessageHl;
  try {
    msg = JSON.parse(data) as MessageHl;
  } catch {
    return false;
  }
  if (msg.channel === "trades" && Array.isArray(msg.data)) {
    sante.dernierMessageTs = Date.now();
    for (const brut of msg.data) {
      const t = makerDuTrade(brut);
      if (t !== null) ajouterAuSeau(seaux, t.time, t.maker, t.usd);
    }
    return true;
  }
  if (msg.channel === "userFills" && msg.data && typeof msg.data === "object") {
    const d = msg.data as { user?: unknown; fills?: unknown };
    if (typeof d.user !== "string" || !Array.isArray(d.fills)) return false;
    sante.dernierMessageTs = Date.now();
    const parCoin = new Map<string, LiqFil[]>();
    for (const brut of d.fills) {
      const p = parseFillHl(brut, d.user, new Set(coinVersSymboles.keys()));
      if (p === null || !tidNouveau(p.tid)) continue;
      const lot = parCoin.get(p.coin);
      if (lot === undefined) parCoin.set(p.coin, [p.liq]);
      else lot.push(p.liq);
    }
    for (const [coin, lot] of parCoin) {
      for (const symbole of coinVersSymboles.get(coin) ?? []) {
        try {
          inserer(symbole, lot);
        } catch (err) {
          sante.derniereErreur = err instanceof Error ? err.message : String(err);
          console.error("[axiomd] insertion liquidations HL échouée :", err);
        }
      }
    }
    if (parCoin.size > 0) {
      sante.derniereLiqTs = Date.now();
      sante.derniereErreur = null;
    }
    return true;
  }
  if (msg.channel === "error") {
    sante.derniereErreur = String(msg.data);
    console.error("[axiomd] erreur WS Hyperliquid :", msg.data);
    return false;
  }
  return false; // subscriptionResponse / pong / canal inconnu
}

// ─────────────────────────── Feed ───────────────────────────

/** Interface de feed partagée avec liqFeed.ts (re-déclarée : pas d'import, anti-cycle). */
export interface FeedLiquidations {
  setSymboles: (symboles: readonly string[]) => void;
  arreter: () => void;
}

interface OptionsFeedHl {
  creerWs?: (url: string) => WebSocket;
  horloge?: HorlogeWs;
  inserer?: (symbole: string, lot: LiqFil[]) => void;
}

const HORLOGE_REELLE: HorlogeWs = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/** Message de (dé)souscription HL. */
function souscription(type: "trades" | "userFills", valeur: string, subscribe: boolean): string {
  const sub =
    type === "trades" ? { type, coin: valeur } : { type, user: valeur };
  return JSON.stringify({ method: subscribe ? "subscribe" : "unsubscribe", subscription: sub });
}

/**
 * Crée le feed de liquidations Hyperliquid. INERTE tant qu'aucun symbole n'est
 * mappable ; au 1er coin, ouvre la WS (boucle partagée : backoff + watchdog 10 min +
 * heartbeat 30 s). Un changement de coins (dé)souscrit `trades` SANS reconnecter.
 * Rotation des makers : DELAI_PREMIERE_ROTATION_MS puis PERIODE_ROTATION_MS →
 * classementMakers → choisirSuivis → deltaSouscriptions → unsubscribe/subscribe
 * userFills sur la WS ouverte, puis santé (adressesSuivies, couverture).
 * Horloge et `creerWs` injectables (pattern wsLoop.test.ts).
 */
export function creerFeedLiquidationsHl(options: OptionsFeedHl = {}): FeedLiquidations {
  if (options.inserer !== undefined) definirInsererHl(options.inserer);
  const horloge = options.horloge ?? HORLOGE_REELLE;
  let stopWs: (() => void) | null = null;
  let wsCourante: { send: (d: string) => void } | null = null;
  let minuteurRotation: unknown = null;
  let minuteurPremiere: unknown = null;

  /** Envoie best-effort sur la WS ouverte (une socket morte ne jette pas dehors). */
  const envoyer = (payload: string): void => {
    try {
      wsCourante?.send(payload);
    } catch {
      /* WS fermée entre-temps : la reconnexion re-souscrira tout */
    }
  };

  /** Rotation des makers suivis : classement → hystérésis → delta de souscriptions. */
  const rotation = (): void => {
    const now = horloge.now();
    elaguer(seaux, now, FENETRE_MAKERS_MS);
    const classement = classementMakers(seaux, now, FENETRE_MAKERS_MS).map((m) => m.maker);
    const nouveaux = choisirSuivis(classement, makersSuivis);
    const delta = deltaSouscriptions(makersSuivis, nouveaux);
    makersSuivis = nouveaux;
    for (const a of delta.retirer) envoyer(souscription("userFills", a, false));
    for (const a of delta.ajouter) envoyer(souscription("userFills", a, true));
    sante.adressesSuivies = makersSuivis.length + 1; // + le vault, toujours suivi
    sante.couverture = couverture(
      seaux,
      new Set([...makersSuivis, ADRESSE_HLP_LIQUIDATOR]),
      now,
      FENETRE_MAKERS_MS,
    );
  };

  const armerRotation = (): void => {
    if (minuteurRotation !== null) return;
    minuteurRotation = horloge.setInterval(rotation, PERIODE_ROTATION_MS);
    // La 1re rotation n'attend qu'une minute (les seaux se remplissent vite).
    minuteurPremiere = horloge.setTimeout(() => rotation(), DELAI_PREMIERE_ROTATION_MS);
  };

  const connecter = (): void => {
    stopWs = connecterBoucleWs({
      url: URL_WS_HL,
      onOpen: (ws) => {
        wsCourante = ws;
        for (const coin of coinVersSymboles.keys()) {
          ws.send(souscription("trades", coin, true));
        }
        ws.send(souscription("userFills", ADRESSE_HLP_LIQUIDATOR, true));
        for (const maker of makersSuivis) {
          ws.send(souscription("userFills", maker, true));
        }
      },
      onMessage: ingererMessageHl,
      staleMs: DELAI_STALE_MS,
      heartbeat: { message: HEARTBEAT_HL, intervalleMs: 30_000 },
      ...(options.creerWs !== undefined ? { creerWs: options.creerWs } : {}),
      ...(options.horloge !== undefined ? { horloge } : {}),
    });
  };

  let coinsActuels = new Set<string>();

  const setSymboles = (symboles: readonly string[]): void => {
    const map = majSymbolesHl(symboles);
    const nouveaux = new Set(map.keys());
    const identique =
      nouveaux.size === coinsActuels.size && [...nouveaux].every((c) => coinsActuels.has(c));
    if (identique) return;
    const delta = deltaSouscriptions([...coinsActuels], [...nouveaux]);
    coinsActuels = nouveaux;
    if (nouveaux.size === 0) {
      stopWs?.();
      stopWs = null;
      wsCourante = null;
      return;
    }
    if (stopWs === null) {
      connecter();
      armerRotation();
      return;
    }
    // WS déjà ouverte : (dé)souscription des trades à chaud, sans reconnexion.
    for (const c of delta.retirer) envoyer(souscription("trades", c, false));
    for (const c of delta.ajouter) envoyer(souscription("trades", c, true));
  };

  return {
    setSymboles,
    arreter: () => {
      stopWs?.();
      stopWs = null;
      wsCourante = null;
      if (minuteurRotation !== null) {
        horloge.clearInterval(minuteurRotation);
        minuteurRotation = null;
      }
      if (minuteurPremiere !== null) {
        horloge.clearTimeout(minuteurPremiere);
        minuteurPremiere = null;
      }
      coinsActuels = new Set();
      makersSuivis = [];
    },
  };
}
