/**
 * Couche « HEATMAP HL » — historique des niveaux de liquidation RÉELS Hyperliquid
 * collectés À FROID par le daemon `axiomd` (`GET /hl/liqheat/:coin`, collecteur opt-in
 * piloté par le drapeau KV `hl/heat`, instantané toutes les 5 min, rétention 14 j).
 *
 * ⚠️ HONNÊTETÉ DE LA SOURCE (garde-fou BUILD-CONTRACT) : ces niveaux sont RÉELS mais
 * ÉCHANTILLONNÉS — le daemon ne sonde que le TOP du leaderboard (~475 adresses : top 150
 * par accountValue ∪ top 350 par volume hebdo). Chaque instantané porte sa `couverture`
 * MESURÉE (≈ fraction de l'OI couverte, cf. `couvertureOi`), affichée en légende — à ne
 * JAMAIS présenter comme « toutes » les liquidations à venir.
 *
 * MODULE PARESSEUX : aucun module du chunk d'entrée ne l'importe — il est tiré par
 * `chart/liquidationHeat.ts` (lui-même chargé dynamiquement à la première activation
 * d'une couche liquidations) et par la fenêtre LIQ (chunk paresseux). Le budget JS
 * initial n'embarque donc ni le mapping ni la boucle de rafraîchissement.
 *
 * Ce module tient le CLIENT (mapping + décision d'état, PURS et testés), le STORE
 * vanilla et le fetch NON BLOQUANT (`assurerHeat`, idempotent, appelé à chaque rendu
 * du contrôleur quand LIQHL est actif).
 */
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { hlLiqHeatGet, daemonSupporteHl, kvPut } from "./daemon";

/** Un niveau de liquidation d'un instantané HL (désérialisé du tuple compact daemon). */
export interface NiveauHeat {
  px: number;
  side: "long" | "short";
  usd: number;
}

/** Un instantané collecté par le daemon (une ligne de `hl_liq_instantanes`). */
export interface InstantaneHlHeat {
  ts: number;
  niveaux: NiveauHeat[];
  longUsd: number;
  shortUsd: number;
  nLong: number;
  nShort: number;
  /** OI mesuré du coin au moment de l'instantané (null si inconnu). */
  oiUsd: number | null;
  /** Adresses effectivement scannées — mesure la couverture de l'échantillon. */
  adresses: number;
  /** Couverture mesurée ∈ [0,1] (fournie par le daemon, recalculée ici si absente). */
  couverture: number | null;
}

/** Méta de la collecte daemon (renvoyées par la route, reflètent le collecteur). */
export interface CollecteHeat {
  actif: boolean;
  dernierInstantaneTs: number;
  periodeMs: number;
  retentionMs: number;
  /** Plus ancien instantané du coin en base (null si jamais collecté). */
  premierTs: number | null;
}

/** État affiché de la couche (une seule raison à la fois, cf. légende du contrôleur). */
export type EtatHeat = "ok" | "sans-daemon" | "inactif" | "vide" | "erreur";

/** Charge utile validée de `GET /hl/liqheat/:coin`. */
export interface ReponseHeat {
  coin: string;
  pas: number | null;
  collecte: CollecteHeat;
  instantanes: InstantaneHlHeat[];
}

// ─────────────────────────── Fonctions PURES (testées) ───────────────────────────

/**
 * Couverture mesurée de l'échantillon : `(longUsd + shortUsd) / (2 × oiUsd)` bornée
 * [0, 1] — MÊME formule que le daemon (l'OI est comptée UN côté alors que les niveaux
 * agrègent les DEUX côtés). `null` si l'OI est absente ou ≤ 0 (couverture indéfinie).
 * PURE.
 */
export function couvertureOi(longUsd: number, shortUsd: number, oiUsd: number | null): number | null {
  if (oiUsd === null || !(oiUsd > 0) || !Number.isFinite(oiUsd)) return null;
  const c = (longUsd + shortUsd) / (2 * oiUsd);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/** Un niveau compact `[px, side01, usd]` est-il exploitable ? PURE (locale). */
function niveauCompactValide(brut: unknown): brut is [number, number, number] {
  if (!Array.isArray(brut) || brut.length !== 3) return false;
  const [px, side01, usd] = brut;
  return (
    typeof px === "number" &&
    Number.isFinite(px) &&
    (side01 === 0 || side01 === 1) &&
    typeof usd === "number" &&
    Number.isFinite(usd)
  );
}

/**
 * Valide et normalise la réponse `GET /hl/liqheat/:coin`. Les niveaux compacts
 * inexploitables (tuple mal formé, side hors 0-1, montant non numérique) sont écartés
 * UN À UN ; un instantané à l'enveloppe bancale (pas de `ts`/`niveaux`) est écarté ;
 * l'ENVELOPPE globale non conforme (pas d'objet, `coin`/`collecte`/`instantanes`
 * absents ou de mauvais type) → `null`. `couverture` absente → recalculée localement
 * via `couvertureOi` (même formule que le daemon). PURE.
 */
export function mapperReponseHeat(brut: unknown): ReponseHeat | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.coin !== "string" || !Array.isArray(o.instantanes)) return null;
  const c = o.collecte;
  if (!c || typeof c !== "object" || typeof (c as Record<string, unknown>).actif !== "boolean") {
    return null;
  }
  const co = c as Record<string, unknown>;
  const collecte: CollecteHeat = {
    actif: co.actif === true,
    dernierInstantaneTs: typeof co.dernierInstantaneTs === "number" ? co.dernierInstantaneTs : 0,
    periodeMs: typeof co.periodeMs === "number" ? co.periodeMs : 5 * 60_000,
    retentionMs: typeof co.retentionMs === "number" ? co.retentionMs : 14 * 24 * 3_600_000,
    premierTs: typeof co.premierTs === "number" ? co.premierTs : null,
  };
  const instantanes: InstantaneHlHeat[] = [];
  for (const s of o.instantanes) {
    if (!s || typeof s !== "object") continue;
    const i = s as Record<string, unknown>;
    if (typeof i.ts !== "number" || !Number.isFinite(i.ts) || !Array.isArray(i.niveaux)) continue;
    const niveaux: NiveauHeat[] = [];
    for (const n of i.niveaux) {
      if (!niveauCompactValide(n)) continue;
      niveaux.push({ px: n[0], side: n[1] === 0 ? "long" : "short", usd: n[2] });
    }
    const longUsd = typeof i.longUsd === "number" ? i.longUsd : 0;
    const shortUsd = typeof i.shortUsd === "number" ? i.shortUsd : 0;
    const oiUsd = typeof i.oiUsd === "number" && Number.isFinite(i.oiUsd) ? i.oiUsd : null;
    instantanes.push({
      ts: i.ts,
      niveaux,
      longUsd,
      shortUsd,
      nLong: typeof i.nLong === "number" ? i.nLong : 0,
      nShort: typeof i.nShort === "number" ? i.nShort : 0,
      oiUsd,
      adresses: typeof i.adresses === "number" ? i.adresses : 0,
      couverture:
        typeof i.couverture === "number" && Number.isFinite(i.couverture)
          ? i.couverture
          : couvertureOi(longUsd, shortUsd, oiUsd),
    });
  }
  return {
    coin: o.coin,
    pas: typeof o.pas === "number" && Number.isFinite(o.pas) ? o.pas : null,
    collecte,
    instantanes,
  };
}

/**
 * Fusionne des listes d'instantanés : dédoublonnage par `ts` (le NOUVEAU écrase
 * l'ancien à ts égal — un instantané re-servi est plus frais), tri croissant. PURE.
 */
export function fusionnerInstantanes(
  anciens: readonly InstantaneHlHeat[],
  nouveaux: readonly InstantaneHlHeat[],
): InstantaneHlHeat[] {
  const parTs = new Map<number, InstantaneHlHeat>();
  for (const s of anciens) parTs.set(s.ts, s);
  for (const s of nouveaux) parTs.set(s.ts, s);
  return [...parTs.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * État à afficher, priorité décroissante : `sans-daemon` (la capability `hl` prime —
 * sans daemon aucune réponse ne peut être vraie) > `erreur` (réponse illisible/réseau
 * KO) > `inactif` (collecte arrêtée ET rien en base) > `vide` (collecte active mais
 * aucun instantané dans la fenêtre) > `ok`. PURE.
 */
export function deciderEtatHeat(
  capabilityHl: boolean,
  reponse: ReponseHeat | null,
  nbInstantanes: number,
): EtatHeat {
  if (!capabilityHl) return "sans-daemon";
  if (reponse === null) return "erreur";
  if (!reponse.collecte.actif && nbInstantanes === 0) return "inactif";
  if (nbInstantanes === 0) return "vide";
  return "ok";
}

// ─────────────────────────── Store vanilla ───────────────────────────

export interface HlHeatState {
  etat: EtatHeat;
  /** Coin actuellement chargé (base perp du symbole du chart, ex. « BTC »). */
  coin: string | null;
  /** Pas de sous-échantillonnage demandé (ms). */
  pas: number | null;
  instantanes: InstantaneHlHeat[];
  collecte: CollecteHeat | null;
  /** Borne basse de l'historique déjà chargé (ms) — évite les refetchs de plage couverte. */
  chargeDepuis: number | null;
}

/** État « aucune donnée » — état initial ET remise à zéro au OFF / changement de cible. */
const VIDE: HlHeatState = {
  etat: "vide",
  coin: null,
  pas: null,
  instantanes: [],
  collecte: null,
  chargeDepuis: null,
};

export const hlHeatStore: StoreApi<HlHeatState> = createStore<HlHeatState>(() => ({ ...VIDE }));

// ─────────────────────────── Fetch non bloquant (assurerHeat) ───────────────────────────

/** Cadence du rafraîchissement incrémental (même rythme que la collecte daemon : 5 min). */
const PERIODE_RAFRAICHISSEMENT_MS = 5 * 60_000;
/** Une demande non réitérée depuis plus de 10 min éteint le minuteur (chart fermé/fond). */
const DEMANDE_FRAICHE_MS = 10 * 60_000;

interface DemandeHeat {
  coin: string;
  pasMs: number;
  depuisMs: number;
}

let demandeCourante: DemandeHeat | null = null;
let derniereDemandeTs = 0;
let minuteur: ReturnType<typeof setInterval> | null = null;
/**
 * GARDE anti-tempête : `assurerHeat` est appelée à CHAQUE frame du contrôleur — sans
 * verrou, un défilement vers le passé relançait le fetch complémentaire à chaque frame
 * tant que `chargeDepuis` n'avait pas bougé. Une seule requête en vol ; une borne plus
 * ancienne demandée pendant le vol est mémorisée et servie à la résolution.
 */
let chargementEnCours = false;
let complementEnAttente: number | null = null;
/** Borne `depuis` de la requête EN VOL — `chargeDepuis` n'est publié qu'à la résolution ;
 *  sans elle, un recul de la fenêtre pendant le premier fetch n'était jamais mémorisé. */
let borneEnVol: number | null = null;
/**
 * Backoff après une réponse `null` (daemon absent/erreur) : sans cela le contrôleur
 * retentait un fetch à chaque frame. 30 s de silence avant le prochain essai.
 */
const REESSAI_APRES_NULL_MS = 30_000;
let prochainEssaiTs = 0;

/**
 * Charge/fusionne une plage `[depuis, jusqua]` pour `coin` et publie l'état résultant.
 * Garde anti-course : si la cible demandée a changé pendant l'attente (autre coin ou
 * autre pas), le résultat est jeté — jamais de niveaux ETH publiés sur un chart BTC.
 * Une réponse `null` arme `prochainEssaiTs` (backoff 30 s).
 */
async function charger(coin: string, pasMs: number, depuis: number, jusqua: number): Promise<void> {
  const brut = await hlLiqHeatGet(coin, { depuis, jusqua, pas: pasMs });
  if (demandeCourante?.coin !== coin || demandeCourante?.pasMs !== pasMs) return;
  if (brut === null) prochainEssaiTs = Date.now() + REESSAI_APRES_NULL_MS;
  const reponse = brut === null ? null : mapperReponseHeat(brut);
  const s = hlHeatStore.getState();
  const instantanes =
    reponse === null ? s.instantanes : fusionnerInstantanes(s.instantanes, reponse.instantanes);
  hlHeatStore.setState({
    etat: deciderEtatHeat(daemonSupporteHl(), reponse, instantanes.length),
    instantanes,
    collecte: reponse?.collecte ?? s.collecte,
    chargeDepuis:
      reponse === null ? s.chargeDepuis : Math.min(s.chargeDepuis ?? depuis, depuis),
  });
}

/**
 * Enveloppe verrouillée de `charger` : une seule requête en vol ; une borne plus ancienne
 * demandée pendant le vol est mémorisée (`complementEnAttente`) et relancée après la
 * résolution si elle reste nécessaire. `prochainEssaiTs` bloque les appels trop tôt
 * après un échec daemon.
 */
async function lancer(coin: string, pasMs: number, depuis: number, jusqua: number): Promise<void> {
  if (chargementEnCours) {
    complementEnAttente = Math.min(complementEnAttente ?? depuis, depuis);
    return;
  }
  if (Date.now() < prochainEssaiTs) return;
  chargementEnCours = true;
  borneEnVol = depuis;
  try {
    await charger(coin, pasMs, depuis, jusqua);
  } finally {
    chargementEnCours = false;
    borneEnVol = null;
  }
  // Plage complémentaire mémorisée pendant le vol : servie une fois, si encore utile.
  if (complementEnAttente !== null && demandeCourante !== null) {
    const borne = complementEnAttente;
    complementEnAttente = null;
    const d = demandeCourante;
    const chargeDepuis = hlHeatStore.getState().chargeDepuis;
    if (chargeDepuis === null || borne < chargeDepuis - d.pasMs) {
      void lancer(d.coin, d.pasMs, borne, chargeDepuis ?? Date.now());
    }
  }
}

function demarrerMinuteur(): void {
  if (minuteur !== null) return;
  minuteur = setInterval(() => {
    if (demandeCourante === null || Date.now() - derniereDemandeTs > DEMANDE_FRAICHE_MS) {
      if (minuteur !== null) {
        clearInterval(minuteur);
        minuteur = null;
      }
      return;
    }
    // Incrémental : ne re-lit que la queue de la série (dernier instantané − un pas de
    // recouvrement) plutôt que tout l'historique — le daemon sous-échantillonne déjà.
    const s = hlHeatStore.getState();
    const borne =
      s.instantanes[s.instantanes.length - 1]?.ts ?? s.chargeDepuis ?? demandeCourante.depuisMs;
    void lancer(demandeCourante.coin, demandeCourante.pasMs, borne - demandeCourante.pasMs, Date.now());
  }, PERIODE_RAFRAICHISSEMENT_MS);
}

/**
 * Garantit (sans bloquer) que le store couvre `[depuisMs, now]` pour `coin`/`pasMs` :
 *  • cible (coin, pas) inchangée → fetch complet de la plage ;
 *  • `depuisMs` plus ancien que la borne déjà chargée → fetch COMPLÉMENTAIRE
 *    `[depuisMs, chargeDepuis]` fusionné ;
 *  • sinon → simple (re)programmation du minuteur incrémental (5 min), actif tant que la
 *    dernière demande a < 10 min.
 * IDEMPOTENTE : appelable à chaque frame de rendu du contrôleur.
 */
export function assurerHeat(demande: DemandeHeat): void {
  derniereDemandeTs = Date.now();
  const s = hlHeatStore.getState();
  const memeCible =
    demandeCourante !== null &&
    demandeCourante.coin === demande.coin &&
    demandeCourante.pasMs === demande.pasMs;
  demandeCourante = demande;
  if (!memeCible) {
    hlHeatStore.setState({
      etat: "vide",
      coin: demande.coin,
      pas: demande.pasMs,
      instantanes: [],
      collecte: null,
      chargeDepuis: null,
    });
    void lancer(demande.coin, demande.pasMs, demande.depuisMs, Date.now());
  } else {
    // Borne basse déjà couverte : chargée (`chargeDepuis`) ou EN VOL (`borneEnVol` — la
    // réponse n'est pas encore publiée). Un recul au-delà → fetch complémentaire
    // `[depuisMs, borne]` ; en vol, `lancer` le mémorise et le sert à la résolution.
    const borneCouverte = s.chargeDepuis ?? borneEnVol;
    if (borneCouverte !== null && demande.depuisMs < borneCouverte - demande.pasMs) {
      void lancer(demande.coin, demande.pasMs, demande.depuisMs, borneCouverte);
    }
  }
  demarrerMinuteur();
}

/** Coupe le minuteur et vide le store (LIQHL repassé OFF / démontage du contrôleur). */
export function arreterHeat(): void {
  if (minuteur !== null) {
    clearInterval(minuteur);
    minuteur = null;
  }
  demandeCourante = null;
  complementEnAttente = null;
  // `prochainEssaiTs` survit au OFF : un daemon KO ne doit pas être martelé par un
  // re-toggle rapide de la couche. `chargementEnCours` se résout seul (réponse jetée
  // par la garde anti-course puisque demandeCourante === null).
  hlHeatStore.setState({ ...VIDE });
}

/**
 * Active/désactive la collecte côté daemon (drapeau KV `hl/heat`, relu par la boucle du
 * collecteur en ≤ 60 s) puis reflète le choix localement dans `collecte.actif`.
 * Best-effort : un daemon absent laisse le store inchangé (kvPut → null).
 */
export async function definirCollecte(actif: boolean): Promise<void> {
  const majA = await kvPut("hl", "heat", { actif, majTs: Date.now() });
  if (majA === null) return;
  const collecte = hlHeatStore.getState().collecte;
  if (collecte !== null) hlHeatStore.setState({ collecte: { ...collecte, actif } });
}
