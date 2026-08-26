/**
 * whales.ts — collecte CONTINUE des gros mouvements on-chain (« baleines »), PROPRE au daemon.
 *
 * INVARIANT (BUILD-CONTRACT) : ceci NE touche PAS au chemin chaud du renderer — connexions
 * INDÉPENDANTES ouvertes par le daemon uniquement pour accumuler À FROID les transferts
 * (table `whale_moves`), comme liqFeed.ts pour les liquidations. Le front lit via
 * GET /whales/recent (poll lent) ; sans daemon, la fenêtre WHALES affiche un repli honnête.
 *
 * DEUX amonts GRATUITS, déjà dans l'écosystème du projet (aucun fournisseur nouveau) :
 *  - BTC : poll REST `blockchain.info/latestblock` (~60 s, réponse minuscule) puis
 *    `rawblock/<hash>` à CHAQUE nouveau bloc (~10 min, quelques Mo — précédent leaderboard
 *    HL 34 Mo/6 h). Transactions CONFIRMÉES : latence ~1 bloc mais aucune tx RBF-annulable,
 *    et pas de WebSocket à maintenir (le fil mempool `unconfirmed_sub` du même hôte est
 *    MUET, vérifié 2026-08-25 — pong OK, zéro utx). Montant = somme des sorties vers des
 *    adresses ABSENTES des entrées (heuristique standard d'exclusion du change ; c'est une
 *    ESTIMATION, étiquetée comme telle côté UI). Prix BTC pollé (~60 s) sur Binance REST.
 *  - ETH (stables USDT/USDC) : poll Etherscan v2 `getLogs` (topic Transfer) toutes les
 *    ~90 s depuis le dernier bloc traité (persisté en KV « whales »/« dernierBlocEth »).
 *    Clé ETHERSCAN_API_KEY du .env REQUISE : l'API v2 refuse toute requête sans clé
 *    (« Missing/Invalid API Key », vérifié 2026-08-25 — l'ancien mode dégradé sans clé
 *    n'existe plus). Sans clé, le poll n'est PAS démarré (aucun appel voué au 401) et la
 *    santé l'affiche honnêtement. Peg 1 USDT/USDC = 1 $ assumé (l'écart réel est
 *    négligeable devant le seuil). L'ETH natif n'est PAS couvert en v1 (il faudrait
 *    scanner chaque bloc complet) — documenté côté UI.
 *
 * Étiquetage dépôt/retrait : liste curée whaleLabels.ts (hot/cold wallets publics). Un
 * « dépôt » détecté vers un hot wallet connu est souvent une CONSOLIDATION de dépôts
 * utilisateurs (les adresses de dépôt par client sont inconnaissables sans clustering
 * payant) — la direction reste indicative, badge « estimation » côté UI.
 *
 * Rétention 30 j (purge quotidienne), même convention que la table `liquidations`.
 */
import type { Database } from "bun:sqlite";
import type { DirectionWhale } from "@axiom/alerts";
import { entetesCors } from "./cors";
import { getDb } from "./db";
import { assurerTableKv } from "./hyperliquid";
import type { Routeur } from "./router";
import { etiqueterAdresse, etiqueterDirection } from "./whaleLabels";

/** Seuil de COLLECTE (USD) : sous ce notionnel, un transfert n'est pas persisté. */
export const SEUIL_COLLECTE_USD = 1_000_000;
/** Rétention des mouvements (30 jours) — borne la taille du .db (convention liquidations). */
const RETENTION_MS = 30 * 24 * 3_600_000;
/** Cadence de la purge (quotidienne). */
const PERIODE_PURGE_MS = 24 * 3_600_000;
/** Poll du prix BTC (conversion USD des transferts). */
const PERIODE_PRIX_MS = 60_000;
/** Poll du dernier bloc BTC (~60 s ; un bloc toutes les ~10 min → aucun manqué). */
export const PERIODE_POLL_BTC_MS = 60_000;
/** Poll Etherscan (2 tokens + n° de bloc). */
export const PERIODE_POLL_ETH_MS = 90_000;
/** Rattrapage MAX par poll (blocs) : au-delà on saute en avant (getLogs plafonne à 1000 lignes). */
export const MAX_BLOCS_PAR_POLL = 25;
/** Limites du GET /whales/recent. */
export const LIMITE_DEFAUT = 200;
export const LIMITE_MAX = 2_000;

const URL_LATEST_BLOCK = "https://blockchain.info/latestblock";
const URL_RAWBLOCK = "https://blockchain.info/rawblock";
/** Garde de volume du rawblock (un bloc plein pèse quelques Mo ; 80 Mo = aberrant). */
const TAILLE_MAX_BLOC = 80 * 1024 * 1024;
const URL_PRIX_BTC = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
const URL_ETHERSCAN = "https://api.etherscan.io/v2/api";
/** topic0 de l'évènement ERC-20 Transfer(address,address,uint256). */
export const TOPIC_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Tokens ERC-20 surveillés (stables : peg 1 $ assumé pour le notionnel). */
export const TOKENS_ETH: readonly { asset: string; contrat: string; decimales: number }[] = [
  { asset: "USDT", contrat: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimales: 6 },
  { asset: "USDC", contrat: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimales: 6 },
];

/** Un mouvement baleine persisté (aligné sur le stockage `whale_moves`). */
export interface MouvementWhale {
  /** Id idempotent : hash BTC, ou `txhash-logindex` ETH. */
  id: string;
  /** Horodatage du transfert (ms epoch). */
  t: number;
  chain: "btc" | "eth";
  /** Actif transféré (BTC, USDT, USDC…). */
  asset: string;
  /** Quantité (unité de l'actif). */
  qty: number;
  /** Notionnel estimé (USD). */
  usd: number;
  /** Adresse source (première entrée / émetteur du log). */
  de: string;
  /** Adresse destination (plus grosse sortie nette / destinataire du log). */
  vers: string;
  /** Étiquette exchange de la source (liste curée), ou null. */
  deLabel: string | null;
  versLabel: string | null;
  direction: DirectionWhale;
}

// ─────────────────────────── Table SQLite ───────────────────────────

let tableAssuree = false;

/** Crée la table `whale_moves` + index (idempotent). Exportée pour le tick alertes + tests. */
export function assurerTableWhales(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS whale_moves (
    id        TEXT PRIMARY KEY,
    t         INTEGER NOT NULL,
    chain     TEXT NOT NULL,
    asset     TEXT NOT NULL,
    qty       REAL NOT NULL,
    usd       REAL NOT NULL,
    de        TEXT NOT NULL,
    vers      TEXT NOT NULL,
    deLabel   TEXT,
    versLabel TEXT,
    direction TEXT NOT NULL
  )`);
  d.run("CREATE INDEX IF NOT EXISTS whale_lookup ON whale_moves (t)");
  d.run("CREATE INDEX IF NOT EXISTS whale_asset ON whale_moves (asset, t)");
}

/** Renvoie la base globale en garantissant (une fois) l'existence de la table. */
function db(): Database {
  const d = getDb();
  if (!tableAssuree) {
    assurerTableWhales(d);
    tableAssuree = true;
  }
  return d;
}

/** Insère un lot de mouvements (INSERT OR IGNORE — idempotent par id, transaction). */
export function insererMouvements(d: Database, lot: readonly MouvementWhale[]): void {
  if (lot.length === 0) return;
  const inserer = d.query(
    `INSERT OR IGNORE INTO whale_moves (id, t, chain, asset, qty, usd, de, vers, deLabel, versLabel, direction)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = d.transaction((ms: readonly MouvementWhale[]) => {
    for (const m of ms) {
      inserer.run(m.id, m.t, m.chain, m.asset, m.qty, m.usd, m.de, m.vers, m.deLabel, m.versLabel, m.direction);
    }
  });
  tx(lot);
}

/** Purge les mouvements antérieurs à `avantMs` (rétention à froid). */
export function purgerMouvements(d: Database, avantMs: number): void {
  d.query("DELETE FROM whale_moves WHERE t < ?").run(avantMs);
}

/**
 * Mouvements d'un actif depuis `depuisMs` (ordre chronologique). Réutilisée par le tick
 * `whale-flux` des alertes (contexte `whaleMouvements`) — d'où la base injectée.
 */
export function mouvementsRecents(d: Database, asset: string, depuisMs: number): MouvementWhale[] {
  assurerTableWhales(d);
  return d
    .query("SELECT * FROM whale_moves WHERE asset = ? AND t >= ? ORDER BY t ASC")
    .all(asset.toUpperCase(), depuisMs) as MouvementWhale[];
}

// ─────────────────────────── BTC — fonctions PURES (testées) ───────────────────────────

/** Une transaction blockchain.info (rawblock) réduite aux champs utiles. */
export interface TxBtc {
  hash: string;
  /** ms epoch (l'API livre des secondes). */
  t: number;
  /** Adresses des entrées (dédoublonnées). */
  entrees: string[];
  /** Sorties adressées : adresse → somme des valeurs (satoshis). */
  sorties: { addr: string; valueSat: number }[];
}

/**
 * Parse une transaction blockchain.info (élément de `rawblock.tx`) en TxBtc, ou `null`
 * si illisible. Les sorties sans adresse (OP_RETURN…) sont écartées. Fonction PURE.
 */
export function parseTxBtc(brut: unknown): TxBtc | null {
  if (!brut || typeof brut !== "object") return null;
  const x = brut as { hash?: unknown; time?: unknown; inputs?: unknown; out?: unknown };
  if (typeof x.hash !== "string" || x.hash.length === 0) return null;

  const entrees: string[] = [];
  if (Array.isArray(x.inputs)) {
    for (const inp of x.inputs) {
      const addr = (inp as { prev_out?: { addr?: unknown } } | null)?.prev_out?.addr;
      if (typeof addr === "string" && addr.length > 0 && !entrees.includes(addr)) entrees.push(addr);
    }
  }
  const sorties: { addr: string; valueSat: number }[] = [];
  if (Array.isArray(x.out)) {
    for (const out of x.out) {
      const o = out as { addr?: unknown; value?: unknown } | null;
      const value = Number(o?.value);
      if (typeof o?.addr !== "string" || o.addr.length === 0) continue;
      if (!Number.isFinite(value) || value <= 0) continue;
      sorties.push({ addr: o.addr, valueSat: value });
    }
  }
  const time = Number(x.time);
  return {
    hash: x.hash,
    t: Number.isFinite(time) && time > 0 ? time * 1000 : 0,
    entrees,
    sorties,
  };
}

/** En-tête du dernier bloc (`GET /latestblock`) : hash + hauteur, ou `null`. Fonction PURE. */
export function parseLatestBlock(brut: unknown): { hash: string; height: number } | null {
  if (!brut || typeof brut !== "object") return null;
  const b = brut as { hash?: unknown; height?: unknown };
  const height = Number(b.height);
  if (typeof b.hash !== "string" || !/^[0-9a-fA-F]{64}$/.test(b.hash)) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  return { hash: b.hash, height };
}

/**
 * Montant « net » d'une tx BTC : somme des sorties vers des adresses ABSENTES des
 * entrées (heuristique standard d'exclusion du change — le vrai montant déplacé est
 * inconnaissable sans clustering, c'est une ESTIMATION). Renvoie aussi la plus grosse
 * sortie nette (destination représentative). Fonction PURE.
 */
export function montantNetBtc(tx: TxBtc): { qtyBtc: number; versPrincipal: string | null } {
  const entrees = new Set(tx.entrees);
  let totalSat = 0;
  let maxSat = 0;
  let versPrincipal: string | null = null;
  for (const s of tx.sorties) {
    if (entrees.has(s.addr)) continue; // retour au émetteur : change probable
    totalSat += s.valueSat;
    if (s.valueSat > maxSat) {
      maxSat = s.valueSat;
      versPrincipal = s.addr;
    }
  }
  return { qtyBtc: totalSat / 1e8, versPrincipal };
}

/**
 * Projette une tx mempool en mouvement persistable SI son notionnel net atteint le
 * seuil (prix BTC requis : sans prix, aucune collecte). L'étiquette source retient le
 * PREMIER label exchange trouvé parmi les entrées (sinon la première adresse).
 * Fonction PURE (étiquetage injecté via whaleLabels).
 */
export function versMouvementBtc(tx: TxBtc, prixBtc: number, seuilUsd: number): MouvementWhale | null {
  if (!Number.isFinite(prixBtc) || prixBtc <= 0) return null;
  const { qtyBtc, versPrincipal } = montantNetBtc(tx);
  if (versPrincipal === null || qtyBtc <= 0) return null;
  const usd = qtyBtc * prixBtc;
  if (!Number.isFinite(usd) || usd < seuilUsd) return null;

  // Source : première entrée étiquetée exchange si elle existe, sinon la première.
  let de = tx.entrees[0] ?? "";
  let deLabel: string | null = null;
  for (const addr of tx.entrees) {
    const label = etiqueterAdresse("btc", addr);
    if (label !== null) {
      de = addr;
      deLabel = label;
      break;
    }
  }
  if (de === "") return null; // aucune entrée adressée (coinbase tx) : hors sujet
  const versLabel = etiqueterAdresse("btc", versPrincipal);
  return {
    id: tx.hash,
    t: tx.t > 0 ? tx.t : Date.now(),
    chain: "btc",
    asset: "BTC",
    qty: qtyBtc,
    usd,
    de,
    vers: versPrincipal,
    deLabel,
    versLabel,
    direction: etiqueterDirection(deLabel, versLabel),
  };
}

// ─────────────────────────── ETH — fonctions PURES (testées) ───────────────────────────

/** Nombre depuis un champ hex Etherscan (« 0x1a2b », « 0x » = 0) ou décimal. `null` si illisible. */
export function nombreHex(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.length === 0) return null;
  const s = v.trim();
  if (s === "0x") return 0; // Etherscan encode parfois zéro ainsi
  const n = /^0x[0-9a-fA-F]+$/.test(s) ? Number.parseInt(s, 16) : /^\d+$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Adresse (0x + 40 hex, minuscules) depuis un topic 32 octets, ou `null`. Fonction PURE. */
export function adresseDepuisTopic(topic: unknown): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

/**
 * Quantité décimale depuis le champ `data` d'un log Transfer (hex 32 octets) et les
 * décimales du token. BigInt évite la perte de précision au parse ; la division finale
 * repasse en Number (sûr pour des stables : 1e9 USDT = 1e15 unités < 2^53). PURE.
 */
export function quantiteDepuisData(data: unknown, decimales: number): number | null {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  let brut: bigint;
  try {
    brut = data === "0x" ? 0n : BigInt(data);
  } catch {
    return null;
  }
  const qty = Number(brut) / 10 ** decimales;
  return Number.isFinite(qty) ? qty : null;
}

/** Un log Transfer Etherscan réduit aux champs utiles. */
export interface LogTransfert {
  txHash: string;
  logIndex: number;
  /** ms epoch. */
  t: number;
  de: string;
  vers: string;
  qty: number;
}

/**
 * Parse la réponse `getLogs` d'Etherscan en logs Transfer exploitables (les entrées
 * illisibles sont écartées, le lot partiel n'échoue pas). `status !== "1"` avec un
 * `result` non-tableau (erreur ou « No records found ») → []. Fonction PURE.
 */
export function parseLogsEtherscan(json: unknown, decimales: number): LogTransfert[] {
  const result = (json as { result?: unknown } | null)?.result;
  if (!Array.isArray(result)) return [];
  const out: LogTransfert[] = [];
  for (const brut of result) {
    if (!brut || typeof brut !== "object") continue;
    const l = brut as Record<string, unknown>;
    const topics = Array.isArray(l.topics) ? l.topics : [];
    if (topics[0] !== TOPIC_TRANSFER) continue;
    const de = adresseDepuisTopic(topics[1]);
    const vers = adresseDepuisTopic(topics[2]);
    const qty = quantiteDepuisData(l.data, decimales);
    const ts = nombreHex(l.timeStamp);
    const logIndex = nombreHex(l.logIndex);
    if (typeof l.transactionHash !== "string" || de === null || vers === null) continue;
    if (qty === null || qty <= 0 || ts === null || logIndex === null) continue;
    out.push({ txHash: l.transactionHash, logIndex, t: ts * 1000, de, vers, qty });
  }
  return out;
}

/**
 * Projette un log Transfer en mouvement persistable SI son notionnel atteint le seuil
 * (peg 1 $ assumé pour les stables surveillés). Fonction PURE.
 */
export function versMouvementErc20(log: LogTransfert, asset: string, seuilUsd: number): MouvementWhale | null {
  const usd = log.qty; // stables : 1 unité ≈ 1 $
  if (usd < seuilUsd) return null;
  const deLabel = etiqueterAdresse("eth", log.de);
  const versLabel = etiqueterAdresse("eth", log.vers);
  return {
    id: `${log.txHash}-${log.logIndex}`,
    t: log.t,
    chain: "eth",
    asset,
    qty: log.qty,
    usd,
    de: log.de,
    vers: log.vers,
    deLabel,
    versLabel,
    direction: etiqueterDirection(deLabel, versLabel),
  };
}

/**
 * Fenêtre de blocs du prochain poll : reprend au bloc suivant le dernier traité, mais
 * rattrape AU PLUS `maxBlocs` (getLogs plafonne à 1000 lignes — au-delà on SAUTE en
 * avant, trou assumé et visible via `sante.dernierBlocEth`). Fonction PURE.
 */
export function fenetreBlocs(
  dernierBloc: number | null,
  blocCourant: number,
  maxBlocs: number = MAX_BLOCS_PAR_POLL,
): { de: number; a: number } | null {
  if (!Number.isFinite(blocCourant) || blocCourant <= 0) return null;
  if (dernierBloc === null) return { de: Math.max(1, blocCourant - maxBlocs + 1), a: blocCourant };
  if (dernierBloc >= blocCourant) return null; // rien de nouveau
  return { de: Math.max(dernierBloc + 1, blocCourant - maxBlocs + 1), a: blocCourant };
}

// ─────────────────────────── Requête GET (fonctions PURES) ───────────────────────────

/** Paramètres de GET /whales/recent (bornés). */
export interface RequeteWhales {
  limite: number;
  minUsd: number;
  /** Filtre d'actif (majuscules), ou null (tous). */
  asset: string | null;
}

/** Extrait limite/minUsd/asset d'une query, avec bornage. Fonction PURE. */
export function parseRequeteWhales(params: URLSearchParams): RequeteWhales {
  // Garde « param absent » AVANT Number() : Number(null) vaut 0 (fini) et écraserait
  // le défaut (même piège que parseRequeteLiqs, résolu de la même façon).
  const nombre = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const limiteBrute = nombre(params.get("limite"));
  const limite =
    limiteBrute === null ? LIMITE_DEFAUT : Math.max(1, Math.min(LIMITE_MAX, Math.floor(limiteBrute)));
  const minBrut = nombre(params.get("minUsd"));
  const minUsd = minBrut !== null && minBrut > 0 ? minBrut : 0;
  const assetBrut = params.get("asset");
  const asset = assetBrut !== null && assetBrut.trim().length > 0 ? assetBrut.trim().toUpperCase() : null;
  return { limite, minUsd, asset };
}

// ─────────────────────────── État de santé du collecteur ───────────────────────────

/** Santé exposée dans la réponse /whales/recent (badges honnêtes côté UI). */
export interface SanteWhales {
  /** Dernier poll de bloc BTC ABOUTI (ms), 0 = aucun. */
  dernierPollBtcTs: number;
  /** Hauteur du dernier bloc BTC traité, null tant qu'aucun. */
  dernierBlocBtc: number | null;
  /** Dernière erreur du poll BTC (message court), null si le dernier poll a réussi. */
  erreurBtc: string | null;
  /** Prix BTC courant utilisé pour la conversion, null tant qu'aucun poll n'a abouti. */
  prixBtc: number | null;
  /** Dernier poll Etherscan ABOUTI (ms), 0 = aucun. */
  dernierPollEthTs: number;
  dernierBlocEth: number | null;
  /** Dernière erreur Etherscan (message court), null si le dernier poll a réussi. */
  erreurEth: string | null;
  /** Une clé ETHERSCAN_API_KEY est-elle présente (requise pour les stables) ? */
  clePresente: boolean;
}

const sante: SanteWhales = {
  dernierPollBtcTs: 0,
  dernierBlocBtc: null,
  erreurBtc: null,
  prixBtc: null,
  dernierPollEthTs: 0,
  dernierBlocEth: null,
  erreurEth: null,
  clePresente: false,
};

// ─────────────────────────── Poll blocs BTC ───────────────────────────

/** Hauteur du dernier bloc BTC traité (mémoire process — un redémarrage repart du bloc courant). */
let dernierBlocBtcTraite: number | null = null;

/**
 * Un poll BTC : en-tête du dernier bloc, puis `rawblock` SI la hauteur a avancé —
 * chaque tx du bloc passe l'heuristique de montant net + seuil et rejoint la table.
 * Sans prix BTC connu, le bloc n'est PAS consommé (retraité au poll suivant, une fois
 * le prix disponible). Un redémarrage ne rattrape pas les blocs manqués (trou assumé,
 * même politique que la fenêtre Etherscan).
 */
async function pollBtc(): Promise<void> {
  try {
    const resTete = await fetch(URL_LATEST_BLOCK, { signal: AbortSignal.timeout(15_000) });
    if (!resTete.ok) throw new Error(`latestblock HTTP ${resTete.status}`);
    const tete = parseLatestBlock(await resTete.json());
    if (tete === null) throw new Error("latestblock illisible");

    if (dernierBlocBtcTraite !== null && tete.height <= dernierBlocBtcTraite) {
      sante.dernierPollBtcTs = Date.now();
      sante.erreurBtc = null;
      return; // aucun nouveau bloc : poll abouti quand même (santé fraîche)
    }
    const prix = sante.prixBtc;
    if (prix === null) throw new Error("prix BTC pas encore disponible");

    const resBloc = await fetch(`${URL_RAWBLOCK}/${tete.hash}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!resBloc.ok) throw new Error(`rawblock HTTP ${resBloc.status}`);
    const cl = resBloc.headers.get("content-length");
    if (cl !== null && Number(cl) > TAILLE_MAX_BLOC) throw new Error("rawblock trop volumineux");
    const bloc = (await resBloc.json()) as { tx?: unknown };
    const txs = Array.isArray(bloc.tx) ? bloc.tx : [];

    const lot: MouvementWhale[] = [];
    for (const brut of txs) {
      const tx = parseTxBtc(brut);
      if (tx === null) continue;
      const mouvement = versMouvementBtc(tx, prix, SEUIL_COLLECTE_USD);
      if (mouvement !== null) lot.push(mouvement);
    }
    insererMouvements(db(), lot);
    dernierBlocBtcTraite = tete.height;
    sante.dernierBlocBtc = tete.height;
    sante.dernierPollBtcTs = Date.now();
    sante.erreurBtc = null;
  } catch (err) {
    sante.erreurBtc = err instanceof Error ? err.message : String(err);
    console.error("[axiomd] poll blocs BTC échoué :", err);
  }
}

// ─────────────────────────── Poll prix BTC ───────────────────────────

/** Rafraîchit le prix BTC (Binance REST, best-effort : on garde l'ancien prix sur échec). */
async function pollPrixBtc(): Promise<void> {
  try {
    const res = await fetch(URL_PRIX_BTC, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { price?: unknown };
    const prix = Number(json.price);
    if (Number.isFinite(prix) && prix > 0) sante.prixBtc = prix;
  } catch (err) {
    console.error("[axiomd] poll prix BTC échoué :", err);
  }
}

// ─────────────────────────── Poll Etherscan (stables) ───────────────────────────

/** Lit le dernier bloc traité (KV « whales »/« dernierBlocEth »), null si absent/corrompu. */
export function lireDernierBloc(d: Database): number | null {
  assurerTableKv(d);
  try {
    const ligne = d
      .query("SELECT valeur FROM kv WHERE namespace = ? AND cle = ?")
      .get("whales", "dernierBlocEth") as { valeur: string } | null;
    if (!ligne) return null;
    const n = Number(JSON.parse(ligne.valeur));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Persiste le dernier bloc traité. */
export function ecrireDernierBloc(d: Database, bloc: number): void {
  assurerTableKv(d);
  d.query("INSERT OR REPLACE INTO kv (namespace, cle, valeur, majA) VALUES (?, ?, ?, ?)").run(
    "whales",
    "dernierBlocEth",
    JSON.stringify(bloc),
    Date.now(),
  );
}

/** URL Etherscan v2 (chainid=1) avec clé optionnelle. */
function urlEtherscan(params: Record<string, string>, cle: string): string {
  const q = new URLSearchParams({ chainid: "1", ...params });
  if (cle.length > 0) q.set("apikey", cle);
  return `${URL_ETHERSCAN}?${q.toString()}`;
}

/** Pause utilitaire (respect du 1 req/5 s sans clé). */
function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Un poll Etherscan : n° de bloc courant, puis getLogs Transfer par token sur la
 * fenêtre `fenetreBlocs`, filtrage au seuil et persistance. Échec d'UN appel → poll
 * abandonné SANS avancer le curseur de bloc (rejouera au prochain tick).
 */
async function pollEtherscan(cle: string): Promise<void> {
  const d = db();
  const pauseMs = 250; // clé garantie par l'appelant (sans clé, le poll n'est pas démarré)
  try {
    const resBloc = await fetch(urlEtherscan({ module: "proxy", action: "eth_blockNumber" }, cle), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!resBloc.ok) throw new Error(`eth_blockNumber HTTP ${resBloc.status}`);
    const jsonBloc = (await resBloc.json()) as { result?: unknown };
    const blocCourant = nombreHex(jsonBloc.result);
    if (blocCourant === null || blocCourant <= 0) throw new Error("eth_blockNumber illisible");

    const fenetre = fenetreBlocs(lireDernierBloc(d), blocCourant);
    if (fenetre === null) {
      // Rien de nouveau : poll abouti quand même (santé fraîche).
      sante.dernierPollEthTs = Date.now();
      sante.erreurEth = null;
      return;
    }

    const lot: MouvementWhale[] = [];
    for (const token of TOKENS_ETH) {
      await pause(pauseMs);
      const res = await fetch(
        urlEtherscan(
          {
            module: "logs",
            action: "getLogs",
            address: token.contrat,
            topic0: TOPIC_TRANSFER,
            fromBlock: String(fenetre.de),
            toBlock: String(fenetre.a),
          },
          cle,
        ),
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) throw new Error(`getLogs ${token.asset} HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      for (const log of parseLogsEtherscan(json, token.decimales)) {
        const mouvement = versMouvementErc20(log, token.asset, SEUIL_COLLECTE_USD);
        if (mouvement !== null) lot.push(mouvement);
      }
    }
    insererMouvements(d, lot);
    ecrireDernierBloc(d, fenetre.a);
    sante.dernierBlocEth = fenetre.a;
    sante.dernierPollEthTs = Date.now();
    sante.erreurEth = null;
  } catch (err) {
    sante.erreurEth = err instanceof Error ? err.message : String(err);
    console.error("[axiomd] poll Etherscan whales échoué :", err);
  }
}

// ─────────────────────────── Boucle de vie ───────────────────────────

/**
 * Démarre la collecte des mouvements baleines : poll prix + poll blocs BTC + poll
 * Etherscan + purge quotidienne. Renvoie une fonction d'arrêt. À appeler UNE fois
 * depuis index.ts.
 */
export function demarrerBoucleWhales(cleEtherscan: string): () => void {
  assurerTableWhales(getDb());
  sante.clePresente = cleEtherscan.length > 0;
  sante.dernierBlocEth = lireDernierBloc(getDb());

  // Prix d'abord : pollBtc refuse de consommer un bloc tant qu'aucun prix n'est connu
  // (le bloc reste dû et sera retraité au poll suivant).
  const demarrage = (async (): Promise<void> => {
    await pollPrixBtc();
    await pollBtc();
  })();
  void demarrage;
  const minuteurPrix = setInterval(() => void pollPrixBtc(), PERIODE_PRIX_MS);
  const minuteurBtc = setInterval(() => void pollBtc(), PERIODE_POLL_BTC_MS);

  // Etherscan v2 refuse toute requête SANS clé : ne pas démarrer un poll voué au 401
  // (la santé porte la raison, la fenêtre WHALES affiche « clé requise »).
  let minuteurEth: ReturnType<typeof setInterval> | null = null;
  if (cleEtherscan.length > 0) {
    void pollEtherscan(cleEtherscan);
    minuteurEth = setInterval(() => void pollEtherscan(cleEtherscan), PERIODE_POLL_ETH_MS);
  } else {
    sante.erreurEth = "clé ETHERSCAN_API_KEY requise (Etherscan v2 sans mode dégradé)";
  }

  const purger = (): void => {
    try {
      purgerMouvements(db(), Date.now() - RETENTION_MS);
    } catch (err) {
      console.error("[axiomd] purge whale_moves échouée :", err);
    }
  };
  purger();
  const minuteurPurge = setInterval(purger, PERIODE_PURGE_MS);

  return () => {
    clearInterval(minuteurPrix);
    clearInterval(minuteurBtc);
    if (minuteurEth !== null) clearInterval(minuteurEth);
    clearInterval(minuteurPurge);
  };
}

// ─────────────────────────── Route ───────────────────────────

/** Réponse JSON avec en-têtes CORS (même pattern que liquidations.ts). */
function json(corps: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...entetesCors(req) },
  });
}

/**
 * Gestionnaire de `GET /whales/recent` : mouvements les plus récents (t décroissant),
 * filtres `limite`/`minUsd`/`asset`, + état de santé du collecteur. `dInjecte` pour
 * les tests (convention traiterHl).
 */
export function traiterWhales(req: Request, url: URL, dInjecte?: Database): Response {
  if (req.method !== "GET") return json({ erreur: "méthode non permise" }, req, 405);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  // segments[0] === "whales" (garanti par le préfixe de route)
  if (segments[1] !== "recent" || segments.length !== 2) return json({ erreur: "chemin inconnu" }, req, 404);

  try {
    const d = dInjecte ?? db();
    if (dInjecte !== undefined) assurerTableWhales(dInjecte);
    const { limite, minUsd, asset } = parseRequeteWhales(url.searchParams);
    let sql = "SELECT * FROM whale_moves WHERE usd >= ?";
    const params: Array<string | number> = [minUsd];
    if (asset !== null) {
      sql += " AND asset = ?";
      params.push(asset);
    }
    sql += " ORDER BY t DESC LIMIT ?";
    params.push(limite);
    const mouvements = d.query(sql).all(...params) as MouvementWhale[];
    return json({ mouvements, sante }, req);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ erreur: "erreur interne whales", detail }, req, 500);
  }
}

/** Enregistre le préfixe /whales (modèle enregistrerHl). */
export function enregistrerWhales(routeur: Routeur): void {
  routeur.enregistrerPrefixe("/whales", (req, url) => traiterWhales(req, url));
}
