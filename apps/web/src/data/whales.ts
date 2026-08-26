/**
 * Mouvements BALEINES (fenêtre WHALES) — client de `GET /whales/recent` et
 * `GET /hl/positions/:coin` du daemon `axiomd`.
 *
 * ⚠️ HONNÊTETÉ DE LA SOURCE (garde-fou BUILD-CONTRACT) :
 *  - Les transferts on-chain couvrent BTC natif + stables ERC-20 (USDT/USDC) — PAS l'ETH
 *    natif ni les autres chaînes. Le montant BTC est une ESTIMATION (heuristique
 *    d'exclusion du change) et l'étiquetage dépôt/retrait repose sur une liste CURÉE de
 *    hot/cold wallets publics (non exhaustive) — badge « estimation » assumé.
 *  - Les positions Hyperliquid sont un ÉCHANTILLON : top du leaderboard, positions à prix
 *    de liquidation exploitable seulement (cf. daemon hyperliquid.ts) — jamais « tout le
 *    marché ».
 *
 * Ce module tient le MAPPING (validation de forme, PURE et testée, convention
 * `hyperliquidLiq.ts`) et les agrégats d'affichage ; le composant WhalesWindow assure le
 * rendu et le poll (lent, ~30 s — le daemon collecte en continu de son côté).
 */
import type { DirectionWhale } from "@axiom/alerts";

/** Un mouvement baleine servi par le daemon (contrat apps/daemon/whales.ts). */
export interface MouvementWhale {
  id: string;
  /** Horodatage du transfert (ms epoch). */
  t: number;
  chain: "btc" | "eth";
  asset: string;
  qty: number;
  usd: number;
  de: string;
  vers: string;
  deLabel: string | null;
  versLabel: string | null;
  direction: DirectionWhale;
}

/** Santé du collecteur daemon (affichée en pied de fenêtre — fraîcheur honnête). */
export interface SanteWhales {
  /** Dernier poll de bloc BTC abouti (ms), 0 = aucun. */
  dernierPollBtcTs: number;
  /** Hauteur du dernier bloc BTC traité, null tant qu'aucun. */
  dernierBlocBtc: number | null;
  erreurBtc: string | null;
  prixBtc: number | null;
  dernierPollEthTs: number;
  dernierBlocEth: number | null;
  erreurEth: string | null;
  /** Une clé ETHERSCAN_API_KEY est-elle présente (requise pour les stables) ? */
  clePresente: boolean;
}

/** Charge utile de `GET /whales/recent`. */
export interface ReponseWhales {
  mouvements: MouvementWhale[];
  sante: SanteWhales;
}

// ─────────────────────────── Mapping PUR (testé) ───────────────────────────

const DIRECTIONS: ReadonlySet<string> = new Set(["depot", "retrait", "interne", "inconnu"]);

/** Un mouvement brut est-il exploitable ? PURE (locale). */
function mouvementValide(brut: unknown): brut is MouvementWhale {
  if (!brut || typeof brut !== "object") return false;
  const m = brut as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.t === "number" &&
    Number.isFinite(m.t) &&
    (m.chain === "btc" || m.chain === "eth") &&
    typeof m.asset === "string" &&
    typeof m.usd === "number" &&
    Number.isFinite(m.usd) &&
    typeof m.qty === "number" &&
    Number.isFinite(m.qty) &&
    typeof m.de === "string" &&
    typeof m.vers === "string" &&
    typeof m.direction === "string" &&
    DIRECTIONS.has(m.direction)
  );
}

/**
 * Valide et normalise la réponse `GET /whales/recent`. Les mouvements inexploitables sont
 * écartés UN À UN (un enregistrement bancal ne vide pas le fil) ; enveloppe non conforme
 * → `null` (l'appelant affiche l'erreur douce). PURE.
 */
export function mapperReponseWhales(brut: unknown): ReponseWhales | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (!Array.isArray(o.mouvements) || !o.sante || typeof o.sante !== "object") return null;
  const s = o.sante as Record<string, unknown>;
  const mouvements: MouvementWhale[] = [];
  for (const m of o.mouvements) {
    if (!mouvementValide(m)) continue;
    mouvements.push({
      id: m.id,
      t: m.t,
      chain: m.chain,
      asset: m.asset,
      qty: m.qty,
      usd: m.usd,
      de: m.de,
      vers: m.vers,
      deLabel: typeof m.deLabel === "string" ? m.deLabel : null,
      versLabel: typeof m.versLabel === "string" ? m.versLabel : null,
      direction: m.direction,
    });
  }
  return {
    mouvements,
    sante: {
      dernierPollBtcTs: typeof s.dernierPollBtcTs === "number" ? s.dernierPollBtcTs : 0,
      dernierBlocBtc: typeof s.dernierBlocBtc === "number" ? s.dernierBlocBtc : null,
      erreurBtc: typeof s.erreurBtc === "string" ? s.erreurBtc : null,
      prixBtc: typeof s.prixBtc === "number" && Number.isFinite(s.prixBtc) ? s.prixBtc : null,
      dernierPollEthTs: typeof s.dernierPollEthTs === "number" ? s.dernierPollEthTs : 0,
      dernierBlocEth: typeof s.dernierBlocEth === "number" ? s.dernierBlocEth : null,
      erreurEth: typeof s.erreurEth === "string" ? s.erreurEth : null,
      clePresente: s.clePresente === true,
    },
  };
}

// ─────────────────────────── Positions Hyperliquid ───────────────────────────

/** Une position d'un top compte HL (même forme que NiveauHl — contrat daemon). */
export interface PositionHl {
  px: number;
  side: "long" | "short";
  valueUsd: number;
  entryPx: number;
  lev: number;
  addr: string;
}

/** Agrégats long/short du coin (contrat daemon `agregatsPositions`). */
export interface AgregatsHl {
  longUsd: number;
  shortUsd: number;
  nbLong: number;
  nbShort: number;
}

/** Charge utile de `GET /hl/positions/:coin`. */
export interface ReponseHlPositions {
  ts: number;
  coin: string;
  adressesScannees: number;
  agregats: AgregatsHl;
  positions: PositionHl[];
}

/** Une position brute est-elle exploitable ? PURE (locale). */
function positionValide(brut: unknown): brut is PositionHl {
  if (!brut || typeof brut !== "object") return false;
  const p = brut as Record<string, unknown>;
  return (
    (p.side === "long" || p.side === "short") &&
    typeof p.valueUsd === "number" &&
    Number.isFinite(p.valueUsd) &&
    typeof p.px === "number" &&
    Number.isFinite(p.px)
  );
}

/**
 * Valide et normalise la réponse `GET /hl/positions/:coin` (mêmes règles que
 * `mapperReponseHl` : entrée bancale écartée, enveloppe non conforme → null). PURE.
 */
export function mapperReponsePositions(brut: unknown): ReponseHlPositions | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (!Array.isArray(o.positions) || typeof o.coin !== "string" || typeof o.ts !== "number") return null;
  const a = (o.agregats ?? {}) as Record<string, unknown>;
  const agregats: AgregatsHl = {
    longUsd: typeof a.longUsd === "number" ? a.longUsd : 0,
    shortUsd: typeof a.shortUsd === "number" ? a.shortUsd : 0,
    nbLong: typeof a.nbLong === "number" ? a.nbLong : 0,
    nbShort: typeof a.nbShort === "number" ? a.nbShort : 0,
  };
  const positions: PositionHl[] = [];
  for (const p of o.positions) {
    if (!positionValide(p)) continue;
    positions.push({
      px: p.px,
      side: p.side,
      valueUsd: p.valueUsd,
      entryPx: typeof p.entryPx === "number" ? p.entryPx : 0,
      lev: typeof p.lev === "number" ? p.lev : 0,
      addr: typeof p.addr === "string" ? p.addr : "",
    });
  }
  return {
    ts: o.ts,
    coin: o.coin,
    adressesScannees: typeof o.adressesScannees === "number" ? o.adressesScannees : 0,
    agregats,
    positions,
  };
}

// ─────────────────────────── Agrégats d'affichage (PURS, testés) ───────────────────────────

/** Stats de la fenêtre affichée : pression dépôts vs retraits + extrêmes. */
export interface StatsWhales {
  depotUsd: number;
  retraitUsd: number;
  /** Flux net vers les exchanges (dépôts − retraits) : > 0 = offre potentielle. */
  netExchangeUsd: number;
  totalUsd: number;
  nb: number;
  maxUsd: number;
}

/** Agrège dépôts/retraits/total/max d'un lot de mouvements. PURE. */
export function statsWhales(mouvements: readonly MouvementWhale[]): StatsWhales {
  let depotUsd = 0;
  let retraitUsd = 0;
  let totalUsd = 0;
  let maxUsd = 0;
  for (const m of mouvements) {
    if (m.direction === "depot") depotUsd += m.usd;
    else if (m.direction === "retrait") retraitUsd += m.usd;
    totalUsd += m.usd;
    if (m.usd > maxUsd) maxUsd = m.usd;
  }
  return {
    depotUsd,
    retraitUsd,
    netExchangeUsd: depotUsd - retraitUsd,
    totalUsd,
    nb: mouvements.length,
    maxUsd,
  };
}

/**
 * Adresse raccourcie pour le fil (« 0x28c6…1d60 », « 34xp4…wseo ») — les adresses
 * complètes encombrent la fenêtre sans rien apporter (un clic copie l'originale). PURE.
 */
export function raccourcirAdresse(adresse: string, tete = 5, queue = 4): string {
  if (adresse.length <= tete + queue + 1) return adresse;
  return `${adresse.slice(0, tete)}…${adresse.slice(-queue)}`;
}

/** Libellé affiché d'un bout de transfert : étiquette exchange si connue, sinon adresse courte. PURE. */
export function libelleBout(adresse: string, label: string | null): string {
  return label ?? raccourcirAdresse(adresse);
}
