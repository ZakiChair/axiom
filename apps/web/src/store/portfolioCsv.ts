/**
 * Import / export CSV du portefeuille — fonctions PURES (testées).
 *
 * Spec colonnes (D1) :
 *   symbol,side,qty,entryPrice,entryTime,exchange?
 *
 * - `side` : long|short (alias buy/sell, l/s)
 * - `entryTime` : ISO-8601 ou epoch ms (ou s si 10 chiffres)
 * - `exchange` : optionnel (ExchangeId) ; absent → l'UI injecte la source active
 *
 * Le parse renvoie un dry-run : lignes valides + erreurs par n° de ligne (1-based hors
 * en-tête). L'export est le miroir (positions ouvertes et clôturées, champs d'entrée).
 */
import type { ExchangeId } from "@axiom/types";
import { parseCsv } from "../data/macro/csv";
import type { Direction, NouvellePosition, Position } from "./portfolio";

/** En-têtes canoniques du CSV portefeuille (export). */
export const ENTETES_CSV_PORTFOLIO = [
  "symbol",
  "side",
  "qty",
  "entryPrice",
  "entryTime",
  "exchange",
] as const;

/** Ligne CSV validée, prête à devenir une `NouvellePosition`. */
export interface LigneCsvPortfolio {
  symbole: string;
  direction: Direction;
  taille: number;
  prixEntree: number;
  /** Epoch ms. */
  dateEntree: number;
  /** Absent si la colonne exchange est vide / manquante. */
  source?: ExchangeId;
}

/** Erreur de validation sur une ligne de données (numéro 1-based hors en-tête). */
export interface ErreurLigneCsvPortfolio {
  ligne: number;
  message: string;
}

/** Résultat dry-run du parse : valides + erreurs (les deux peuvent coexister). */
export interface ResultatParseCsvPortfolio {
  ok: LigneCsvPortfolio[];
  erreurs: ErreurLigneCsvPortfolio[];
}

/** Ensemble des ExchangeId acceptés (colonne optionnelle). */
const EXCHANGES_OK = new Set<string>([
  "binance",
  "bybit",
  "okx",
  "deribit",
  "coinbase",
  "kraken",
  "twelvedata",
  "mexc",
  "synthetic",
]);

/** En-têtes obligatoires (case-insensitive après normalisation). */
const REQUIS = ["symbol", "side", "qty", "entryprice", "entrytime"] as const;

/** Normalise un en-tête (minuscule, sans espaces). */
function normaliserEntete(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Interprète le sens d'une position.
 * Alias : buy→long, sell→short, l/s. PURE.
 */
export function parseSideCsv(raw: string): Direction | null {
  const s = raw.trim().toLowerCase();
  if (s === "long" || s === "buy" || s === "l") return "long";
  if (s === "short" || s === "sell" || s === "s") return "short";
  return null;
}

/**
 * Parse `entryTime` : epoch ms, epoch s (10 chiffres), ou ISO-8601 / Date.parse.
 * Renvoie null si invalide. PURE.
 */
export function parseEntryTimeCsv(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  // Entier pur : epoch ms (≥ 12 chiffres) ou s (10 chiffres courants).
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Heuristique : 10 chiffres ≈ secondes ; sinon ms.
    if (t.length <= 10) return n * 1000;
    return n;
  }
  const ms = Date.parse(t);
  if (!Number.isFinite(ms) || Number.isNaN(ms)) return null;
  return ms;
}

/**
 * Parse un ExchangeId optionnel. `undefined` si vide ; `null` si valeur inconnue. PURE.
 */
export function parseExchangeCsv(raw: string | undefined): ExchangeId | undefined | null {
  if (raw === undefined) return undefined;
  const t = raw.trim().toLowerCase();
  if (!t) return undefined;
  if (EXCHANGES_OK.has(t)) return t as ExchangeId;
  return null;
}

/**
 * Parse un document CSV portefeuille (en-tête + lignes). PURE — dry-run :
 * renvoie les lignes valides et les erreurs sans muter le store.
 *
 * En-têtes reconnus (ordre libre, case-insensitive) :
 * symbol, side, qty, entryPrice, entryTime, exchange?
 */
export function parsePortfolioCsv(texte: string): ResultatParseCsvPortfolio {
  const { entetes, lignes } = parseCsv(texte);
  const ok: LigneCsvPortfolio[] = [];
  const erreurs: ErreurLigneCsvPortfolio[] = [];

  if (entetes.length === 0) {
    return { ok, erreurs: [{ ligne: 0, message: "CSV vide ou sans en-tête" }] };
  }

  // Index par en-tête normalisé (accès robuste au réordonnancement / casse).
  const entetesNorm = entetes.map(normaliserEntete);
  const manquants = REQUIS.filter((r) => !entetesNorm.includes(r));
  if (manquants.length > 0) {
    return {
      ok,
      erreurs: [
        {
          ligne: 0,
          message: `En-têtes manquants : ${manquants.join(", ")} (attendu : symbol,side,qty,entryPrice,entryTime,exchange?)`,
        },
      ],
    };
  }

  // Accès via noms d'origine (accesseurColonnes est case-sensitive) → on reconstruit
  // une map normalisée → index.
  const idx = new Map<string, number>();
  entetesNorm.forEach((h, i) => {
    if (!idx.has(h)) idx.set(h, i);
  });
  const get = (ligne: string[], nom: string): string | undefined => {
    const i = idx.get(nom);
    if (i === undefined) return undefined;
    const v = ligne[i];
    return v === undefined ? undefined : v.trim();
  };

  for (let i = 0; i < lignes.length; i++) {
    const row = lignes[i]!;
    const nLigne = i + 1;
    const symbol = get(row, "symbol") ?? "";
    const sideRaw = get(row, "side") ?? "";
    const qtyRaw = get(row, "qty") ?? "";
    const priceRaw = get(row, "entryprice") ?? "";
    const timeRaw = get(row, "entrytime") ?? "";
    const exchangeRaw = get(row, "exchange");

    if (!symbol) {
      erreurs.push({ ligne: nLigne, message: "symbol vide" });
      continue;
    }
    const direction = parseSideCsv(sideRaw);
    if (!direction) {
      erreurs.push({
        ligne: nLigne,
        message: `side invalide « ${sideRaw} » (attendu long|short|buy|sell)`,
      });
      continue;
    }
    const taille = Number(qtyRaw);
    if (!Number.isFinite(taille) || taille <= 0) {
      erreurs.push({ ligne: nLigne, message: `qty invalide « ${qtyRaw} »` });
      continue;
    }
    const prixEntree = Number(priceRaw);
    if (!Number.isFinite(prixEntree) || prixEntree <= 0) {
      erreurs.push({ ligne: nLigne, message: `entryPrice invalide « ${priceRaw} »` });
      continue;
    }
    const dateEntree = parseEntryTimeCsv(timeRaw);
    if (dateEntree === null) {
      erreurs.push({
        ligne: nLigne,
        message: `entryTime invalide « ${timeRaw} » (ISO-8601 ou epoch)`,
      });
      continue;
    }
    const source = parseExchangeCsv(exchangeRaw);
    if (source === null) {
      erreurs.push({
        ligne: nLigne,
        message: `exchange inconnu « ${exchangeRaw ?? ""} »`,
      });
      continue;
    }

    ok.push({
      symbole: symbol.toUpperCase(),
      direction,
      taille,
      prixEntree,
      dateEntree,
      source,
    });
  }

  return { ok, erreurs };
}

/** Convertit une ligne validée en `NouvellePosition` (source défaut si absente). PURE. */
export function ligneCsvVersNouvelle(
  l: LigneCsvPortfolio,
  sourceDefaut: ExchangeId,
): NouvellePosition {
  return {
    symbole: l.symbole,
    source: l.source ?? sourceDefaut,
    direction: l.direction,
    taille: l.taille,
    prixEntree: l.prixEntree,
    dateEntree: l.dateEntree,
  };
}

/** Échappe un champ CSV si nécessaire (virgule, guillemet, saut de ligne). PURE. */
function echapperChamp(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * Export miroir : en-têtes canoniques + une ligne par position (ouverts et clos).
 * `entryTime` en ISO-8601 UTC. PURE.
 */
export function exporterPortfolioCsv(positions: Position[]): string {
  const lignes: string[] = [ENTETES_CSV_PORTFOLIO.join(",")];
  for (const p of positions) {
    const cells = [
      p.symbole,
      p.direction,
      String(p.taille),
      String(p.prixEntree),
      new Date(p.dateEntree).toISOString(),
      p.source,
    ].map((c) => echapperChamp(c));
    lignes.push(cells.join(","));
  }
  return lignes.join("\n") + (lignes.length > 1 ? "\n" : "");
}

/**
 * Déclenche le téléchargement navigateur d'un CSV portefeuille.
 * Effet de bord DOM (hors pure) — utilisé par l'UI uniquement.
 */
export function telechargerPortfolioCsv(positions: Position[]): void {
  const csv = exporterPortfolioCsv(positions);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = url;
  a.download = `axiom-portfolio-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
