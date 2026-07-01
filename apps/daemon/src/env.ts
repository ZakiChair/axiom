/**
 * Chargement des secrets du daemon.
 *
 * SOURCE UNIQUE DES SECRETS : `apps/web/.env` (gitignored). C'est le MÊME fichier
 * que celui lu par le proxy Vite (voir apps/web/vite.config.ts). On ne duplique
 * PAS les clés : le daemon relit ce fichier pour que dev (Vite) et prod (daemon)
 * partagent exactement la même configuration. Les clés ne transitent jamais dans
 * le bundle navigateur — elles sont injectées côté daemon au moment du proxy.
 *
 * Parse volontairement minimal (aucune dépendance runtime, cf. BUILD-CONTRACT) :
 * une ligne `KEY=valeur` par variable ; lignes vides et commentaires `#` ignorés.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Clés injectées par le proxy (repli quand le front n'en fournit pas). */
export interface ProxyKeys {
  FRED_API_KEY: string;
  COINALYZE_API_KEY: string;
  TWELVE_DATA_KEY: string;
}

/**
 * Parse le contenu brut d'un fichier `.env` en dictionnaire clé→valeur.
 * Fonction PURE (testée) : ignore les lignes vides et les commentaires `#`,
 * découpe sur le PREMIER `=`, trim clé et valeur, retire d'éventuels guillemets
 * entourants. Une clé répétée : la dernière occurrence gagne.
 */
export function parseEnv(contenu: string): Record<string, string> {
  const resultat: Record<string, string> = {};
  for (const ligneBrute of contenu.split("\n")) {
    const ligne = ligneBrute.trim();
    if (ligne.length === 0 || ligne.startsWith("#")) continue;
    const posEgal = ligne.indexOf("=");
    if (posEgal === -1) continue;
    const cle = ligne.slice(0, posEgal).trim();
    if (cle.length === 0) continue;
    let valeur = ligne.slice(posEgal + 1).trim();
    // Retire une paire de guillemets simples ou doubles entourants.
    if (valeur.length >= 2) {
      const premier = valeur[0];
      const dernier = valeur[valeur.length - 1];
      if ((premier === '"' || premier === "'") && premier === dernier) {
        valeur = valeur.slice(1, -1);
      }
    }
    resultat[cle] = valeur;
  }
  return resultat;
}

/** Chemin par défaut vers la source unique des secrets (module-relatif, robuste au cwd). */
export const CHEMIN_ENV_DEFAUT = join(import.meta.dir, "..", "..", "web", ".env");

/**
 * Charge les clés proxy depuis `apps/web/.env`.
 * Fichier absent ou clé manquante → chaîne vide : le daemon démarre quand même et
 * proxifie sans injecter de clé (l'amont répond alors 401, exactement comme le
 * proxy Vite avec une variable `.env` vide). Le daemon ne DOIT jamais planter
 * faute de secrets.
 */
export function chargerCles(cheminEnv: string = CHEMIN_ENV_DEFAUT): ProxyKeys {
  let env: Record<string, string> = {};
  try {
    env = parseEnv(readFileSync(cheminEnv, "utf8"));
  } catch {
    // Fichier absent/illisible : on retombe sur des clés vides (voir docstring).
  }
  return {
    FRED_API_KEY: env.FRED_API_KEY ?? "",
    COINALYZE_API_KEY: env.COINALYZE_API_KEY ?? "",
    TWELVE_DATA_KEY: env.TWELVE_DATA_KEY ?? "",
  };
}
