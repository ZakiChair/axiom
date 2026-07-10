/**
 * Formatage partagé des nombres, montants, dates et durées — module UNIQUE.
 *
 * Consolide ~65 helpers auparavant recopiés dans une vingtaine de fenêtres
 * (audit 2026-07-09 : prix adaptatif ×6, compact K/M/B ×9, % signé ×8, âge
 * relatif ×3…). Les versions promues ici sont les plus abouties du codebase
 * (SymbolBanner, HealthPanel), déjà pures et testées.
 *
 * Standard consacré (cf. docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md) :
 *  - NOMBRES financiers en convention anglo : locale en-US pour les milliers,
 *    suffixes K/M/B/T majuscules, « + » explicite sur les variations, 2 déc.
 *    par défaut (4 pour le funding). Signe monétaire négatif : « − » (U+2212).
 *  - DATES/HEURES et libellés relatifs en fr-FR (hour12: false).
 *  - Valeur absente/invalide : tiret cadratin « — ».
 *
 * Restent LOCALES aux fenêtres : les unités métier uniques (fmtGwei, fmtHashrate,
 * formatOctets, formatQuota, heureUtc, formatStrike…) et les writers DOM
 * impératifs (writePct/writeMoney), qui s'appuient sur ces fonctions.
 * Toutes les fonctions sont PURES (le « maintenant » est injecté).
 */

/** Tiret cadratin affiché pour toute valeur absente ou non finie. */
export const VALEUR_ABSENTE = "—";

/** Signe moins typographique (U+2212) des montants négatifs. */
const MOINS = "−";

/** Prix avec un nombre de décimales adapté à sa magnitude (2/4/6), milliers en-US. */
export function formatPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p) || p <= 0) return VALEUR_ABSENTE;
  const decimals = p >= 1 ? 2 : p >= 0.01 ? 4 : 6;
  return p.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Notation compacte K/M/B/T (2 décimales) pour volumes, supply, compteurs. */
export function formatCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const abs = Math.abs(v);
  const signe = v < 0 ? MOINS : "";
  if (abs >= 1e12) return `${signe}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${signe}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${signe}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${signe}${(abs / 1e3).toFixed(2)}K`;
  return `${signe}${abs.toFixed(2)}`;
}

/** Montant USD compact : « $12.34M », « −$1.30B » ; « $78.19 » sous le millier. */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const signe = v < 0 ? MOINS : "";
  return `${signe}$${formatCompact(Math.abs(v))}`;
}

/**
 * Variation en pourcentage signée, style anglo collé : « +1.23% », « -0.05% ».
 * `dec` = décimales (2 par défaut, 4 pour le funding). `signe: false` pour
 * une valeur sans « + » explicite.
 */
export function formatPct(
  p: number | null | undefined,
  dec = 2,
  opts?: { signe?: boolean },
): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return VALEUR_ABSENTE;
  const prefixe = (opts?.signe ?? true) && p >= 0 ? "+" : "";
  return `${prefixe}${p.toFixed(dec)}%`;
}

/**
 * Pourcentage « niveau » (part, ratio déjà ×100, taux) : « 15.3 % » — espace
 * simple avant %, style des fenêtres analytiques (SEAG, CHAIN, RATE).
 */
export function formatPourcentage(valeurEnPct: number | null | undefined, dec = 2): string {
  if (valeurEnPct === null || valeurEnPct === undefined || !Number.isFinite(valeurEnPct)) {
    return VALEUR_ABSENTE;
  }
  return `${valeurEnPct.toFixed(dec)} %`;
}

/** Nombre à `dec` décimales ou « — » (ratios, corrélations, EPS…). */
export function formatDec(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return v.toFixed(dec);
}

/** Entier avec séparateurs de milliers fr-FR (compteurs, tonnes, blocs…). */
export function formatEntier(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return VALEUR_ABSENTE;
  return Math.round(n).toLocaleString("fr-FR");
}

/** Heure locale « HH:MM:SS » (fr-FR, 24 h). */
export function formatHeure(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return VALEUR_ABSENTE;
  return new Date(ms).toLocaleTimeString("fr-FR", { hour12: false });
}

/** Heure locale courte « HH:MM » (fr-FR, 24 h). */
export function formatHeureMinute(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return VALEUR_ABSENTE;
  return new Date(ms).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Date courte « JJ/MM » (fr-FR). */
export function formatDateCourte(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return VALEUR_ABSENTE;
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/** Date + heure « JJ/MM HH:MM » (fr-FR) — notes, échéances. */
export function formatDateHeure(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return VALEUR_ABSENTE;
  return `${formatDateCourte(ms)} ${formatHeureMinute(ms)}`;
}

/** Date complète « 9 juil. 2026 » (fr-FR) — rapports, fiches. */
export function formatDateComplete(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return VALEUR_ABSENTE;
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Âge relatif « il y a X s/min/h/j » — `now` injecté (fonction pure). */
export function formatAge(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return VALEUR_ABSENTE;
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/**
 * Délai futur « dans 3 h 12 » / « dans 45 min » / « imminent » (< 1 min) —
 * prochain funding, prochaine échéance. `now` injecté (fonction pure).
 */
export function formatDelai(targetMs: number, now: number): string {
  if (!Number.isFinite(targetMs) || targetMs <= 0) return VALEUR_ABSENTE;
  const sec = Math.floor((targetMs - now) / 1000);
  if (sec < 60) return "imminent";
  const min = Math.floor(sec / 60);
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `dans ${h} h ${String(min % 60).padStart(2, "0")}`;
  return `dans ${Math.floor(h / 24)} j`;
}

/** Compte à rebours « H:MM:SS » (≥ 1 h) ou « MM:SS ». Négatif borné à 0. */
export function formatCountdown(msRestant: number): string {
  if (!Number.isFinite(msRestant)) return VALEUR_ABSENTE;
  const totalSec = Math.max(0, Math.floor(msRestant / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
