#!/usr/bin/env node
// Budget de chargement initial AXIOM. Il lit le manifeste Vite plutôt que la taille
// totale de dist : les imports paresseux restent donc mesurés séparément.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, sep } from "node:path";

const PLAFOND_BRUT = 1_220_000;
const PLAFOND_GZIP = 360_000;
const MANIFESTE = ".vite/manifest.json";

function erreur(message) {
  throw new Error(message);
}

function lireJson(chemin) {
  let texte;
  try {
    texte = readFileSync(chemin, "utf8");
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      erreur(`manifest introuvable : ${chemin}`);
    }
    throw cause;
  }
  try {
    return JSON.parse(texte);
  } catch {
    erreur(`manifest invalide : ${chemin}`);
  }
}

function tableauIds(valeur, id, champ) {
  if (valeur === undefined) return [];
  if (!Array.isArray(valeur) || valeur.some((element) => typeof element !== "string")) {
    erreur(`manifest invalide : ${id}.${champ} doit être une liste de chaînes`);
  }
  return valeur;
}

function validerManifeste(valeur) {
  if (valeur === null || Array.isArray(valeur) || typeof valeur !== "object") {
    erreur("manifest invalide : objet attendu");
  }
  const entrees = new Map();
  for (const [id, entree] of Object.entries(valeur)) {
    if (entree === null || Array.isArray(entree) || typeof entree !== "object" || typeof entree.file !== "string") {
      erreur(`manifest invalide : entrée ${id}`);
    }
    entrees.set(id, {
      file: entree.file,
      imports: tableauIds(entree.imports, id, "imports"),
      dynamicImports: tableauIds(entree.dynamicImports, id, "dynamicImports"),
    });
  }
  return entrees;
}

function attribut(tag, nom) {
  const resultat = new RegExp(`\\b${nom}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return resultat?.[2] ?? null;
}

function ressourceLocale(reference) {
  const url = new URL(reference, "http://axiom.local");
  if (url.origin !== "http://axiom.local") return null;
  const chemin = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (chemin.length === 0 || chemin.split("/").includes("..")) {
    erreur(`référence HTML invalide : ${reference}`);
  }
  return chemin;
}

function racinesHtml(html) {
  const racines = new Set();
  for (const correspondance of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = correspondance[0];
    const nom = correspondance[1]?.toLowerCase();
    if (nom === "script" && attribut(tag, "type")?.toLowerCase() === "module") {
      const src = attribut(tag, "src");
      if (src !== null) {
        const ressource = ressourceLocale(src);
        if (ressource !== null) racines.add(ressource);
      }
    }
    if (nom === "link" && attribut(tag, "rel")?.toLowerCase().split(/\s+/).includes("modulepreload")) {
      const href = attribut(tag, "href");
      if (href !== null) {
        const ressource = ressourceLocale(href);
        if (ressource !== null) racines.add(ressource);
      }
    }
  }
  if (racines.size === 0) erreur("entrée HTML introuvable : script module ou modulepreload attendu");
  return racines;
}

function idsPourFichiers(entrees, fichiers) {
  const ids = new Set();
  for (const fichier of fichiers) {
    const id = [...entrees].find(([, entree]) => entree.file === fichier)?.[0];
    if (id === undefined) erreur(`ressource HTML absente du manifeste : ${fichier}`);
    ids.add(id);
  }
  return ids;
}

function entree(entrees, id) {
  const resultat = entrees.get(id);
  if (resultat === undefined) erreur(`import absent du manifeste : ${id}`);
  return resultat;
}

function parcourirStatiques(entrees, ids, visites = new Set()) {
  for (const id of ids) {
    if (visites.has(id)) continue;
    visites.add(id);
    parcourirStatiques(entrees, entree(entrees, id).imports, visites);
  }
  return visites;
}

function parcourirDynamiques(entrees, ids, statiques, visites = new Set()) {
  for (const id of ids) {
    if (statiques.has(id) || visites.has(id)) continue;
    visites.add(id);
    const courant = entree(entrees, id);
    parcourirDynamiques(entrees, courant.imports, statiques, visites);
    parcourirDynamiques(entrees, courant.dynamicImports, statiques, visites);
  }
  return visites;
}

function cheminDansDist(dist, fichier) {
  const cible = resolve(dist, fichier);
  if (cible !== dist && !cible.startsWith(`${dist}${sep}`)) erreur(`fichier manifeste hors dist : ${fichier}`);
  return cible;
}

function mesurer(dist, entrees, ids) {
  const fichiers = [...new Set([...ids].map((id) => entree(entrees, id).file))]
    .filter((fichier) => fichier.endsWith(".js"))
    .sort();
  let octetsBruts = 0;
  let octetsGzip = 0;
  for (const fichier of fichiers) {
    let contenu;
    try {
      contenu = readFileSync(cheminDansDist(dist, fichier));
    } catch (cause) {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
        erreur(`ressource manifeste introuvable : ${fichier}`);
      }
      throw cause;
    }
    octetsBruts += contenu.byteLength;
    octetsGzip += gzipSync(contenu, { level: 9 }).byteLength;
  }
  return { fichiers, octetsBruts, octetsGzip };
}

function analyser(distArg) {
  const dist = resolve(distArg);
  const manifeste = validerManifeste(lireJson(resolve(dist, MANIFESTE)));
  const html = readFileSync(resolve(dist, "index.html"), "utf8");
  const racines = idsPourFichiers(manifeste, racinesHtml(html));
  const statiques = parcourirStatiques(manifeste, racines);
  const racinesDynamiques = new Set([...statiques].flatMap((id) => entree(manifeste, id).dynamicImports));
  const dynamiques = parcourirDynamiques(manifeste, racinesDynamiques, statiques);
  return {
    limites: { octetsBruts: PLAFOND_BRUT, octetsGzip: PLAFOND_GZIP, niveauGzip: 9 },
    initial: mesurer(dist, manifeste, statiques),
    dynamique: mesurer(dist, manifeste, dynamiques),
  };
}

function main() {
  const dist = process.argv[2] ?? "apps/web/dist";
  const resultat = analyser(dist);
  process.stdout.write(`${JSON.stringify(resultat, null, 2)}\n`);
  if (resultat.initial.octetsBruts > PLAFOND_BRUT) {
    erreur(`budget JS initial brut dépassé : ${resultat.initial.octetsBruts} > ${PLAFOND_BRUT}`);
  }
  if (resultat.initial.octetsGzip > PLAFOND_GZIP) {
    erreur(`budget JS initial gzip niveau 9 dépassé : ${resultat.initial.octetsGzip} > ${PLAFOND_GZIP}`);
  }
}

try {
  main();
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`Erreur budget build : ${message}\n`);
  process.exitCode = 1;
}
