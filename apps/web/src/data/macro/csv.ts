/**
 * Utilitaire CSV minimal, PUR et testé — partagé par les parseurs macro souverains
 * (courbe des taux US `home.treasury.gov`, taux directeurs BIS `stats.bis.org`).
 *
 * Gère les champs entre guillemets doubles pouvant contenir des virgules (cas BIS :
 * le champ COMPILATION du Japon est un long texte virgulé et guillemeté) et les
 * guillemets échappés (`""`). Aucune dépendance externe : les CSV visés sont petits
 * et bien formés (une source officielle par domaine).
 */

/** Découpe une LIGNE CSV en champs, en respectant les guillemets doubles. Fonction PURE. */
export function decouperLigneCsv(ligne: string): string[] {
  const champs: string[] = [];
  let courant = "";
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      // `""` à l'intérieur d'un champ guillemeté = un guillemet littéral.
      if (dansGuillemets && ligne[i + 1] === '"') {
        courant += '"';
        i++;
      } else {
        dansGuillemets = !dansGuillemets;
      }
    } else if (c === "," && !dansGuillemets) {
      champs.push(courant);
      courant = "";
    } else {
      courant += c;
    }
  }
  champs.push(courant);
  return champs;
}

/** Une table CSV parsée : en-têtes + lignes de données (chaînes brutes, non typées). */
export interface TableCsv {
  entetes: string[];
  lignes: string[][];
}

/**
 * Parse un document CSV complet en en-têtes + lignes. Ignore les lignes vides
 * (y compris un éventuel BOM/CRLF résiduel). Renvoie une table vide si l'entrée
 * n'a pas de contenu exploitable. Fonction PURE.
 */
export function parseCsv(texte: string): TableCsv {
  const lignes = texte
    .replace(/^﻿/, "") // BOM éventuel en tête
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lignes.length === 0) return { entetes: [], lignes: [] };
  const entetes = decouperLigneCsv(lignes[0]!).map((h) => h.trim());
  const corps = lignes.slice(1).map((l) => decouperLigneCsv(l));
  return { entetes, lignes: corps };
}

/**
 * Construit une fonction d'accès aux colonnes PAR NOM (robuste au réordonnancement
 * des colonnes, contrairement à un index fixe). Renvoie une fonction `(ligne, nom)`
 * qui rend la valeur trimée de la colonne `nom`, ou `undefined` si la colonne est
 * absente / hors bornes. Fonction PURE.
 */
export function accesseurColonnes(
  entetes: string[],
): (ligne: string[], nom: string) => string | undefined {
  const index = new Map<string, number>();
  entetes.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });
  return (ligne, nom) => {
    const i = index.get(nom);
    if (i === undefined) return undefined;
    const v = ligne[i];
    return v === undefined ? undefined : v.trim();
  };
}
