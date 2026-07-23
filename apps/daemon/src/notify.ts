/**
 * notify.ts — notifications d'alertes (macOS + Telegram optionnel).
 *
 * Deux canaux, tous deux best-effort (jamais fatals pour le daemon) :
 *  - macOS : `osascript -e 'display notification …'` via Bun.spawn. L'échappement
 *    des guillemets est CRITIQUE (une valeur/un message contenant `"` casserait le
 *    script AppleScript) → cf. echapperAppleScript, testé.
 *  - Telegram (OPTIONNEL) : si TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID sont présents
 *    dans apps/web/.env (SOURCE UNIQUE des secrets, comme env.ts), on relaie chaque
 *    déclenchement via l'API Bot (sendMessage) — « 90 % du besoin mobile pour 1 %
 *    de l'effort » (roadmap 03 §2.3). Timeout 5 s, échec logué sans crash.
 *
 * INVARIANT (BUILD-CONTRACT) : aucune I/O réseau ici sur le chemin chaud du
 * renderer — ce module n'est appelé que sur un déclenchement d'alerte (rare).
 */
import { readFileSync } from "node:fs";
import { CHEMIN_ENV_DEFAUT, parseEnv } from "./env";
import type { Declenchement } from "@axiom/alerts";

// ─────────────────────────── macOS (osascript) ───────────────────────────

/**
 * Échappe une chaîne pour l'insérer dans un littéral AppleScript entre guillemets
 * doubles : backslash d'abord (sinon on ré-échapperait nos propres échappements),
 * puis les guillemets doubles. Fonction PURE (testée).
 */
export function echapperAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Construit le script AppleScript `display notification "corps" with title "titre"`
 * avec échappement correct des deux champs. Fonction PURE (testée).
 */
export function scriptNotification(titre: string, corps: string): string {
  return `display notification "${echapperAppleScript(corps)}" with title "${echapperAppleScript(titre)}"`;
}

/** Affiche une notification macOS (no-op hors darwin ; best-effort). */
export function notifierMacOs(titre: string, corps: string): void {
  try {
    if (process.platform !== "darwin") return;
    Bun.spawn(["osascript", "-e", scriptNotification(titre, corps)], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch (err) {
    console.error("[axiomd] notification macOS échouée :", err);
  }
}

// ─────────────────────────── Telegram (optionnel) ───────────────────────────

/** Configuration Telegram (jeton du bot + identifiant de conversation). */
export interface TelegramConfig {
  token: string;
  chatId: string;
}

/**
 * Charge la config Telegram depuis apps/web/.env (même source que les clés proxy,
 * cf. env.ts). Renvoie `null` si l'une des deux variables manque : le relais est
 * alors simplement désactivé (l'absence n'est PAS une erreur). Fonction PURE des
 * effets réseau (lecture fichier uniquement).
 */
export function chargerTelegram(cheminEnv: string = CHEMIN_ENV_DEFAUT): TelegramConfig | null {
  try {
    const env = parseEnv(readFileSync(cheminEnv, "utf8"));
    const token = env.TELEGRAM_BOT_TOKEN ?? "";
    const chatId = env.TELEGRAM_CHAT_ID ?? "";
    if (token.length === 0 || chatId.length === 0) return null;
    return { token, chatId };
  } catch {
    return null; // fichier absent/illisible → relais désactivé
  }
}

/** Texte du message Telegram pour un déclenchement. Fonction PURE (testée). */
export function formaterTexteTelegram(symbol: string, decl: Declenchement): string {
  return `🔔 AXIOM — ${symbol}\n${decl.message}`;
}

/**
 * Expurge un éventuel jeton de bot Telegram d'un message d'erreur avant journalisation :
 * l'URL de l'API (`api.telegram.org/bot<TOKEN>/…`) fuiterait le secret dans les logs.
 * Remplace le segment `/bot<...>` par `/bot***`. Fonction PURE (testée) ; accepte tout
 * (Error, chaîne, valeur inconnue) via `String()`.
 */
export function redigerErreurTelegram(err: unknown): string {
  return String(err).replace(/\/bot[^/\s]+/g, "/bot***");
}

/** Délai max d'un appel Telegram (ms). */
const TIMEOUT_TELEGRAM_MS = 5000;

/**
 * Envoie un message Telegram (sendMessage). Timeout 5 s ; toute erreur (réseau,
 * jeton invalide, …) est loguée et renvoyée en `false` sans jamais lever.
 */
export async function envoyerTelegram(
  token: string,
  chatId: string,
  texte: string,
): Promise<boolean> {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_TELEGRAM_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texte }),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch (err) {
    // Rédaction du jeton : l'URL de l'API (bot<TOKEN>) ne doit jamais atterrir dans les logs.
    console.error("[axiomd] envoi Telegram échoué :", redigerErreurTelegram(err));
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

// ─────────────────────────── Point d'entrée ───────────────────────────

/** Config Telegram mémoïsée (le .env est lu une seule fois — les secrets sont stables). */
let telegramCache: TelegramConfig | null | undefined;

/** Réinitialise le cache Telegram (utile en test). */
export function reinitialiserTelegram(): void {
  telegramCache = undefined;
}

/**
 * Notifie un déclenchement sur tous les canaux disponibles : notification macOS +
 * relais Telegram si configuré. Best-effort : ne lève jamais.
 */
export function notifierDeclenchement(symbol: string, decl: Declenchement): void {
  const titre = `AXIOM — ${symbol}`;
  notifierMacOs(titre, decl.message);

  if (telegramCache === undefined) telegramCache = chargerTelegram();
  const tg = telegramCache;
  if (tg) void envoyerTelegram(tg.token, tg.chatId, formaterTexteTelegram(symbol, decl));
}
