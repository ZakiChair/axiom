/**
 * Tri et formatage PURS de la fenêtre DATA (observabilité des sources).
 *
 * Ne collecte RIEN : lit le registre `healthStore` tel quel et le projette en lignes
 * ordonnées « erreurs d'abord » pour l'affichage. Les fonctions sont pures (`now`
 * injecté, comme `formatAge`/`formatDelai`) afin d'être testées sans horloge réelle et
 * re-jouables par le tick d'affichage 10 s de la fenêtre.
 */
import type { EtatSource, QuotaSource, SanteSource } from "../store/health";
import { sourceLabel } from "../components/HealthPanel";

/** Ligne d'affichage projetée depuis une `SanteSource` du registre. */
export interface LigneData {
  /** Identifiant de source (clé du registre) — clé React et libellé de repli. */
  id: string;
  /** Nom lisible de la source (« FRED », « Deribit », « BGeometrics »…). */
  libelle: string;
  etat: EtatSource;
  /** Âge du dernier message en ms (`now − dernierMessageTs`), `NaN` si jamais reçu. */
  fraicheurMs: number;
  quota?: QuotaSource;
  erreur?: string;
}

/**
 * Libellés lisibles indexés par la clé COMPLÈTE de source — l'observabilité nomme des
 * fournisseurs que le `sourceLabel` générique de HealthPanel ne connaît pas (il ne mappe
 * que les exchanges WS et découperait « eco:fred » en « eco · fred »). Les clés absentes
 * ici retombent sur `sourceLabel` (Binance/Kraken/Twelve Data · canal…).
 */
const LIBELLES_SOURCE: Record<string, string> = {
  "binance:futures": "Binance · futures",
  "binance:coinm": "Binance · COIN-M",
  deribit: "Deribit",
  cboe: "Cboe",
  "eco:fred": "FRED",
  "eco:forexfactory": "ForexFactory",
  "cot:cftc": "CFTC (COT)",
  bgeometrics: "BGeometrics",
  coinmetrics: "Coin Metrics",
  etherscan: "Etherscan",
  mempool: "mempool.space",
  sosovalue: "SoSoValue",
  news: "Actualités",
  "coingecko:market": "CoinGecko · marché",
  axiomd: "Daemon Axiom",
};

/** Libellé lisible d'une source : map complète d'abord, sinon `sourceLabel` générique. PURE. */
export function libelleSource(source: string): string {
  return LIBELLES_SOURCE[source] ?? sourceLabel(source);
}

/**
 * Projette et ordonne le registre en lignes d'affichage : ERREURS d'abord (plus récentes
 * en tête), puis les autres sources par `dernierMessageTs` décroissant. `now` sert au
 * calcul de la fraîcheur (delta) ; une source jamais vue (`dernierMessageTs = 0`) reçoit
 * `fraicheurMs = NaN` → rendue « — » par `formatFraicheur`. PURE.
 */
export function trierSources(sources: Record<string, SanteSource>, now: number): LigneData[] {
  return Object.values(sources)
    .slice()
    .sort((a, b) => {
      // Les sources en erreur remontent en bloc, quelle que soit leur fraîcheur.
      const errA = a.etat === "error" ? 1 : 0;
      const errB = b.etat === "error" ? 1 : 0;
      if (errA !== errB) return errB - errA;
      // À rang d'erreur égal : la plus récente d'abord (dernierMessageTs desc).
      return b.dernierMessageTs - a.dernierMessageTs;
    })
    .map((s) => ({
      id: s.source,
      libelle: libelleSource(s.source),
      etat: s.etat,
      fraicheurMs: s.dernierMessageTs > 0 ? now - s.dernierMessageTs : NaN,
      quota: s.quota,
      erreur: s.derniereErreur,
    }));
}

/**
 * Âge relatif « il y a 12 s » / « il y a 3 min » / « il y a 2 h » / « il y a 4 j » à
 * partir d'un DELTA en ms. Delta négatif ou non fini (source jamais vue) → « — ».
 * Même convention de bornes et de préfixe que `formatAge`, dont DATA est voisine. PURE.
 */
export function formatFraicheur(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "—";
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
