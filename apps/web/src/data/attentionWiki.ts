/**
 * Attention du grand public : pages vues quotidiennes Wikipédia par actif (SUG-39).
 *
 * Source : API REST Wikimedia `metrics/pageviews/per-article` (wikimedia.org, publique,
 * sans clé, données sous licence CC0). Série quotidienne agent « user » (robots et trafic
 * automatisé identifiés exclus par Wikimedia), tous accès confondus, UNE édition à la fois
 * (en ou fr), article choisi dans une table curée. Lecture DESCRIPTIVE : ni indicateur
 * graphique, ni identifiant aux, ni signal de trading.
 *
 * Transport : appel DIRECT du navigateur, sur le précédent des sources statistiques
 * publiques sans clé (OCDE, Eurostat, ONS ; BUILD-CONTRACT « Fournisseurs statistiques
 * publics »). L'API REST de Wikimedia répond avec `Access-Control-Allow-Origin: *` (non
 * revérifié en ligne depuis ce conteneur sans réseau) ; l'hôte exact `https://wikimedia.org`
 * est ajouté à `connect-src` (vercel.json, docs/csp-vercel.md). Aucun ajout au proxy
 * `/extapi`. L'URL est construite ICI, à partir d'une base fixe et d'un titre de la table
 * curée : aucun chemin libre ne sort de ce module.
 *
 * User-Agent : un `fetch()` navigateur ne peut pas poser `User-Agent` ; la politique
 * Wikimedia demande alors l'en-tête `Api-User-Agent`, identifiant générique ci-dessous (sans
 * e-mail personnel). Cet en-tête déclenche un pré-vol CORS ; si le pré-vol est refusé (le
 * `fetch` rejette en TypeError), UN nouvel essai part en requête simple, où le navigateur
 * envoie son propre User-Agent, que la politique accepte pour un client navigateur.
 *
 * Datation et causalité :
 *   - les vues du jour D (UTC) ne sont publiées qu'à partir de D+1 : la requête s'arrête à
 *     la VEILLE, et tout point du jour en cours ou futur est écarté au parsing. Chaque
 *     pic est daté au jour compté (`jour`), à la borne BASSE de publication (`connuLe` =
 *     D+1 00:00 UTC : les vues de D sortent quelques heures après la fin de D, parfois
 *     seulement à D+2) et à une date de disponibilité PRUDENTE (`disponibleLe` = D+2
 *     00:00 UTC, clôture de D+1), seule date à retenir pour une étude d'évènements causale ;
 *   - le z-score d'un jour compare log(1 + vues) à la moyenne et à l'écart-type des W jours
 *     STRICTEMENT précédents : aucune valeur future n'entre dans un calcul passé (test de
 *     préfixe dans attentionWiki.test.ts) ;
 *   - un jour absent de la réponse reste ABSENT (null, « non mesuré »), jamais 0.
 *
 * Pièges assumés (affichés dans la note de la tuile) : signal NON signé (l'attention
 * s'emballe en bulle comme en krach), concomitant plus que prédictif, redirections non
 * comptées (« BTC » → Bitcoin), niveaux non comparables d'une année à l'autre (filtrage des
 * robots, résumés automatiques des moteurs de recherche).
 *
 * Cache : `onchain/cache` réutilisé (localStorage + KV daemon si présent), UNE entrée par
 * couple (édition, actif) de la table curée, au format compact `{ titre, debut, vues[] }`
 * borné à HISTORIQUE_JOURS valeurs, TTL 6 h, entrée périmée resservie (étiquetée) quand la
 * source échoue. Santé : source `wikimedia` du registre `healthStore`.
 */
import { healthStore } from "../store/health";
import { ecrireCache, lireCache } from "./onchain/cache";

/** Un jour en millisecondes. */
export const JOUR_MS = 86_400_000;

/** Base FIXE de l'API pageviews per-article (hôte exact, chemin borné). */
const BASE_PAGEVIEWS = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";

/**
 * Identifiant envoyé en `Api-User-Agent` (politique User-Agent de Wikimedia). ASCII
 * seulement : une valeur d'en-tête hors Latin-1 ferait échouer le `fetch`.
 */
export const API_USER_AGENT = "AxiomTerminal/1.0 (personal analysis tool; daily pageviews, cached locally)";

/** Profondeur demandée : 3 ans, soit environ 2 ans de z-score sur 365 jours. */
export const HISTORIQUE_JOURS = 1096;

/** Durée de fraîcheur du cache local (la série ne change qu'une fois par jour). */
export const TTL_CACHE_MS = 6 * 3_600_000;

/** Délai maximum d'une requête Wikimedia. */
const DELAI_MS = 15_000;

/** Taille maximale acceptée d'une réponse (≈ 1 100 points × 170 o ≈ 190 Ko attendus). */
const TAILLE_MAX_OCTETS = 1_048_576;

/** Fenêtre « un an » : z-score 365 j et décompte des pics de l'année. */
export const JOURS_ANNEE = 365;

/** Seuil d'un pic d'attention, en écarts-types du z-score 365 j. */
export const SEUIL_PIC_SIGMA = 3;

/** Un seul épisode de pic par tranche de 30 jours (les jours voisins d'un pic s'y rattachent). */
export const ESPACEMENT_EPISODES_JOURS = 30;

/** Part minimale de jours mesurés exigée dans une fenêtre (sinon « non mesuré »). */
export const COUVERTURE_MIN = 0.8;

/** Seuils DESCRIPTIFS du niveau d'attention (conventionnels, non calibrés). */
const SEUIL_ATTENTION_ELEVEE = 1.5;
const SEUIL_ATTENTION_ETEINTE = -1.5;

/** Identifiant de la source dans le registre santé. */
const SOURCE_SANTE = "wikimedia";

/** Version du format de cache (à incrémenter si la forme stockée change). */
const VERSION_CACHE = "v1";

export type EditionWiki = "en" | "fr";

export const EDITIONS_WIKI: readonly EditionWiki[] = ["en", "fr"];

export interface ArticleWiki {
  /** Actif de base (« BTC »). */
  actif: string;
  /** Nom lisible. */
  nom: string;
  /** Titre EXACT de l'article par édition ; null = aucun article retenu dans cette édition. */
  titres: Readonly<Record<EditionWiki, string | null>>;
}

/**
 * Correspondance actif → article, CURÉE. `per-article` ne compte que la page demandée :
 * un titre de redirection donnerait une série quasi nulle, un renommage une rupture. Les
 * titres retenus sont les pages canoniques connues (relevé de mémoire, non revérifié en
 * ligne depuis ce conteneur) ; une édition sans titre sûr reste à null plutôt que devinée.
 * Solana a un titre qualifié en anglais (homonymie) ; son titre français n'est pas retenu.
 */
export const ARTICLES_WIKI: readonly ArticleWiki[] = [
  { actif: "BTC", nom: "Bitcoin", titres: { en: "Bitcoin", fr: "Bitcoin" } },
  { actif: "ETH", nom: "Ethereum", titres: { en: "Ethereum", fr: "Ethereum" } },
  { actif: "SOL", nom: "Solana", titres: { en: "Solana (blockchain platform)", fr: null } },
  { actif: "DOGE", nom: "Dogecoin", titres: { en: "Dogecoin", fr: "Dogecoin" } },
];

/** Titre de l'article d'un actif dans une édition, ou null (actif hors table ou édition sans titre). PURE. */
export function titreArticle(actif: string, edition: EditionWiki): string | null {
  return ARTICLES_WIKI.find((a) => a.actif === actif)?.titres[edition] ?? null;
}

/** Début (00:00 UTC) du jour contenant `ms`. PURE. */
export function jourUtc(ms: number): number {
  return Math.floor(ms / JOUR_MS) * JOUR_MS;
}

/**
 * Dernier jour COMPLET à `maintenant` : la veille UTC. Le jour en cours n'est jamais
 * complet ; ses vues ne seront publiées qu'à partir du lendemain. PURE.
 */
export function dernierJourComplet(maintenant: number): number {
  return jourUtc(maintenant) - JOUR_MS;
}

/** « AAAAMMJJ » UTC d'un instant (format de date de l'API). */
function aaaammjj(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Titre au format de l'API : espaces en soulignés. */
function titreApi(titre: string): string {
  return titre.replace(/ /g, "_");
}

/**
 * URL de la série quotidienne d'un article, agent « user », tous accès, du jour `debut`
 * au jour `fin` inclus. Le titre est encodé (une barre oblique devient %2F) : il ne peut
 * pas sortir du segment d'article. PURE.
 */
export function urlPagesVues(titre: string, edition: EditionWiki, debut: number, fin: number): string {
  const article = encodeURIComponent(titreApi(titre));
  return `${BASE_PAGEVIEWS}/${edition}.wikipedia/all-access/user/${article}/daily/${aaaammjj(debut)}/${aaaammjj(fin)}`;
}

/** Accès défensif à un champ d'objet inconnu. */
function champ(o: unknown, cle: string): unknown {
  return typeof o === "object" && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

/**
 * Convertit la réponse de l'API en vues par jour (00:00 UTC → vues). Ne retient que les
 * items de l'édition, de l'article, de l'agent et de la granularité demandés, à un
 * horodatage quotidien valide, et ÉCARTE tout jour postérieur à `finIncluse` (jour en
 * cours ou futur : jamais complet). Lève si la structure est inexploitable. PURE.
 */
export function parsePagesVues(
  json: unknown,
  edition: EditionWiki,
  titre: string,
  finIncluse: number,
): Map<number, number> {
  const items = champ(json, "items");
  if (!Array.isArray(items)) throw new Error("Réponse Wikimedia invalide (items absents).");
  const projet = `${edition}.wikipedia`;
  const article = titreApi(titre);
  const vues = new Map<number, number>();
  for (const item of items) {
    if (champ(item, "project") !== projet || champ(item, "article") !== article) continue;
    const agent = champ(item, "agent");
    const granularite = champ(item, "granularity");
    if ((agent !== undefined && agent !== "user") || (granularite !== undefined && granularite !== "daily")) continue;
    const horodatage = champ(item, "timestamp");
    if (typeof horodatage !== "string" || !/^\d{8}00$/.test(horodatage)) continue;
    const iso = `${horodatage.slice(0, 4)}-${horodatage.slice(4, 6)}-${horodatage.slice(6, 8)}`;
    const jour = Date.parse(`${iso}T00:00:00Z`);
    if (!Number.isFinite(jour) || new Date(jour).toISOString().slice(0, 10) !== iso) continue;
    if (jour > finIncluse) continue;
    const v = champ(item, "views");
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) continue;
    vues.set(jour, v);
  }
  return vues;
}

/** Série quotidienne CONTIGUË : `vues[i]` = vues du jour `debut + i` jours, null si non mesuré. */
export interface SerieVues {
  /** 00:00 UTC du premier jour. */
  debut: number;
  vues: (number | null)[];
}

/** Range les vues sur la grille quotidienne [debut, fin] ; un jour absent reste null (jamais 0). PURE. */
export function serieContigue(points: ReadonlyMap<number, number>, debut: number, fin: number): SerieVues {
  const vues: (number | null)[] = [];
  for (let jour = debut; jour <= fin; jour += JOUR_MS) vues.push(points.get(jour) ?? null);
  return { debut, vues };
}

/** Valeur exploitable (nombre fini) ? */
function mesure(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/**
 * z-score glissant CAUSAL : `z[i] = (x[i] − moyenne) / écart-type`, moyenne et écart-type
 * (échantillon) des `fenetre` valeurs STRICTEMENT précédentes `x[i−fenetre..i−1]`. Null si
 * `x[i]` manque, si la fenêtre déborde du début de série, si moins de `couvertureMin` de
 * la fenêtre est mesurée ou si l'écart-type est nul. Le résultat en `i` ne dépend que de
 * `x[0..i]` : ajouter des jours ne change aucune valeur passée. PURE.
 */
export function zScoresGlissants(
  valeurs: readonly (number | null)[],
  fenetre: number,
  couvertureMin = COUVERTURE_MIN,
): (number | null)[] {
  const minimum = Math.max(2, Math.ceil(fenetre * couvertureMin));
  const z: (number | null)[] = new Array<number | null>(valeurs.length).fill(null);
  for (let i = fenetre; i < valeurs.length; i += 1) {
    const x = valeurs[i];
    if (!mesure(x)) continue;
    let n = 0;
    let somme = 0;
    for (let j = i - fenetre; j < i; j += 1) {
      const v = valeurs[j];
      if (mesure(v)) {
        n += 1;
        somme += v;
      }
    }
    if (n < minimum) continue;
    const moyenne = somme / n;
    let carres = 0;
    for (let j = i - fenetre; j < i; j += 1) {
      const v = valeurs[j];
      if (mesure(v)) carres += (v - moyenne) ** 2;
    }
    const ecartType = Math.sqrt(carres / (n - 1));
    if (!(ecartType > 0)) continue;
    z[i] = (x - moyenne) / ecartType;
  }
  return z;
}

/** log(1 + vues), null conservé. */
function logVues(vues: readonly (number | null)[]): (number | null)[] {
  return vues.map((v) => (mesure(v) ? Math.log1p(v) : null));
}

/**
 * Moyenne des `longueur` jours finissant à l'indice `fin` inclus, ou null si la fenêtre
 * déborde du début de série ou si moins de `couvertureMin` de ses jours sont mesurés.
 */
function moyenneFenetre(
  vues: readonly (number | null)[],
  fin: number,
  longueur: number,
  couvertureMin = COUVERTURE_MIN,
): number | null {
  const debut = fin - longueur + 1;
  if (debut < 0) return null;
  let n = 0;
  let somme = 0;
  for (let i = debut; i <= fin; i += 1) {
    const v = vues[i];
    if (mesure(v)) {
      n += 1;
      somme += v;
    }
  }
  return n >= Math.ceil(longueur * couvertureMin) ? somme / n : null;
}

/**
 * Délai PRUDENT de disponibilité des vues d'un jour D : D+2 00:00 UTC (clôture de D+1). Les
 * vues quotidiennes de D sont publiées quelques heures après la fin de D, parfois à D+2 ;
 * agir à D+1 00:00 introduirait quelques heures de look-ahead.
 */
export const DISPONIBILITE_PRUDENTE_JOURS = 2;

/** Épisode de pic d'attention, daté au jour compté, à sa publication au plus tôt et à sa disponibilité prudente. */
export interface PicAttention {
  /** 00:00 UTC du jour compté (premier jour de l'épisode au-dessus du seuil). */
  jour: number;
  /**
   * 00:00 UTC du lendemain : borne BASSE de publication (« au plus tôt »), pas l'instant
   * réel où la valeur est servie. À ne PAS utiliser comme date d'action d'une étude causale.
   */
  connuLe: number;
  /**
   * 00:00 UTC de D+2 (clôture de D+1) : date de disponibilité PRUDENTE, la seule à retenir
   * pour une étude d'évènements causale (aucun look-ahead sur l'heure de publication).
   */
  disponibleLe: number;
  z: number;
  vues: number;
}

/**
 * Épisodes de pic : premier jour où `z > seuil`, puis plus aucun nouvel épisode pendant
 * `espacementJours` jours (les jours voisins appartiennent au même épisode). Balayage
 * chronologique : les épisodes d'un préfixe de série sont un préfixe des épisodes de la
 * série complète. PURE.
 */
export function episodesPics(
  serie: SerieVues,
  z: readonly (number | null)[],
  seuil = SEUIL_PIC_SIGMA,
  espacementJours = ESPACEMENT_EPISODES_JOURS,
): PicAttention[] {
  const pics: PicAttention[] = [];
  let dernierIndex = -Infinity;
  for (let i = 0; i < z.length; i += 1) {
    const zi = z[i];
    const vi = serie.vues[i];
    if (!mesure(zi) || !mesure(vi) || zi <= seuil || i - dernierIndex < espacementJours) continue;
    const jour = serie.debut + i * JOUR_MS;
    pics.push({ jour, connuLe: jour + JOUR_MS, disponibleLe: jour + DISPONIBILITE_PRUDENTE_JOURS * JOUR_MS, z: zi, vues: vi });
    dernierIndex = i;
  }
  return pics;
}

/** Niveau DESCRIPTIF de l'attention, lu sur le z-score 365 j. NON signé (bulle comme krach). */
export type NiveauAttention = "pic" | "elevee" | "normale" | "eteinte";

/** Niveau d'attention d'un z-score, null si non mesuré. PURE. */
export function niveauAttention(z: number | null): NiveauAttention | null {
  if (!mesure(z)) return null;
  if (z > SEUIL_PIC_SIGMA) return "pic";
  if (z >= SEUIL_ATTENTION_ELEVEE) return "elevee";
  if (z <= SEUIL_ATTENTION_ETEINTE) return "eteinte";
  return "normale";
}

export interface AnalyseAttention {
  /** 00:00 UTC du dernier jour mesuré (null : aucun jour mesuré). */
  dernierJour: number | null;
  /** Borne BASSE de publication de ce dernier jour (lendemain 00:00 UTC, « au plus tôt »). */
  connuLe: number | null;
  vuesDernierJour: number | null;
  /** z-score de log(1 + vues) contre les 90 / 365 jours strictement précédents. */
  z90: number | null;
  z365: number | null;
  niveau: NiveauAttention | null;
  /** Moyenne 7 j / moyenne 90 j, fenêtres finissant au dernier jour mesuré. */
  ratio7j90j: number | null;
  /** Tous les épisodes de pic de la série (z 365 j > seuil). */
  pics: PicAttention[];
  /**
   * Épisodes dont le jour compté tombe dans les 365 derniers jours (finissant au dernier jour
   * mesuré). null si le z 365 j n'est mesuré sur AUCUN de ces jours : un décompte de 0 y
   * serait inventé. Partiel si `joursZ365Mesures < JOURS_ANNEE` (couverture à afficher).
   */
  picsSur365j: number | null;
  /** Nombre de jours, parmi les 365 derniers, où le z 365 j est mesuré (base de `picsSur365j`). */
  joursZ365Mesures: number;
  couverture: { joursMesures: number; joursAttendus: number };
}

/** Nombre de valeurs mesurées de `z` sur les `longueur` indices finissant à `fin` inclus. */
function joursMesuresFenetre(z: readonly (number | null)[], fin: number, longueur: number): number {
  let n = 0;
  for (let i = Math.max(0, fin - longueur + 1); i <= fin; i += 1) if (mesure(z[i])) n += 1;
  return n;
}

/**
 * Analyse descriptive de la série d'un article, lue au DERNIER JOUR MESURÉ : z 90 j et
 * 365 j sur log(1 + vues), ratio 7 j / 90 j, épisodes de pic. Toute valeur que la
 * couverture ne permet pas de mesurer vaut null. PURE.
 */
export function analyserAttention(serie: SerieVues): AnalyseAttention {
  const { vues } = serie;
  let joursMesures = 0;
  let idx = -1;
  for (let i = 0; i < vues.length; i += 1) {
    if (mesure(vues[i])) {
      joursMesures += 1;
      idx = i;
    }
  }
  const couverture = { joursMesures, joursAttendus: vues.length };
  const logs = logVues(vues);
  const z365Serie = zScoresGlissants(logs, JOURS_ANNEE);
  const pics = episodesPics(serie, z365Serie);
  if (idx < 0) {
    return {
      dernierJour: null,
      connuLe: null,
      vuesDernierJour: null,
      z90: null,
      z365: null,
      niveau: null,
      ratio7j90j: null,
      pics,
      picsSur365j: null,
      joursZ365Mesures: 0,
      couverture,
    };
  }
  const dernierJour = serie.debut + idx * JOUR_MS;
  const z365 = z365Serie[idx] ?? null;
  const z90 = zScoresGlissants(logs, 90)[idx] ?? null;
  const m7 = moyenneFenetre(vues, idx, 7);
  const m90 = moyenneFenetre(vues, idx, 90);
  const joursZ365Mesures = joursMesuresFenetre(z365Serie, idx, JOURS_ANNEE);
  return {
    dernierJour,
    connuLe: dernierJour + JOUR_MS,
    vuesDernierJour: vues[idx] ?? null,
    z90,
    z365,
    niveau: niveauAttention(z365),
    ratio7j90j: m7 !== null && m90 !== null && m90 > 0 ? m7 / m90 : null,
    pics,
    picsSur365j:
      joursZ365Mesures > 0 ? pics.filter((p) => p.jour > dernierJour - JOURS_ANNEE * JOUR_MS).length : null,
    joursZ365Mesures,
    couverture,
  };
}

/** Attention d'une alt relative à Bitcoin, même édition. */
export interface AttentionRelative {
  /** Dernier jour mesuré pour les DEUX articles. */
  dernierJourCommun: number | null;
  /** Vues de l'alt / vues de Bitcoin sur les 7 jours finissant au dernier jour commun. */
  partVsBtc7j: number | null;
  /** z-score 365 j (strictement passé) de log((1 + alt) / (1 + BTC)) au dernier jour commun. */
  zRatio365: number | null;
}

/**
 * Attention relative alt / BTC sur les jours mesurés des DEUX séries (alignement par date,
 * jamais par position). Une alt qui « attire un public nouveau » voit son z de ratio
 * monter. PURE.
 */
export function attentionRelative(alt: SerieVues, btc: SerieVues): AttentionRelative {
  const vide: AttentionRelative = { dernierJourCommun: null, partVsBtc7j: null, zRatio365: null };
  const debut = Math.max(alt.debut, btc.debut);
  const fin = Math.min(alt.debut + (alt.vues.length - 1) * JOUR_MS, btc.debut + (btc.vues.length - 1) * JOUR_MS);
  if (fin < debut) return vide;
  const a: (number | null)[] = [];
  const b: (number | null)[] = [];
  for (let jour = debut; jour <= fin; jour += JOUR_MS) {
    const va = alt.vues[Math.round((jour - alt.debut) / JOUR_MS)] ?? null;
    const vb = btc.vues[Math.round((jour - btc.debut) / JOUR_MS)] ?? null;
    const communs = mesure(va) && mesure(vb);
    a.push(communs ? va : null);
    b.push(communs ? vb : null);
  }
  let idx = -1;
  for (let i = 0; i < a.length; i += 1) if (mesure(a[i])) idx = i;
  if (idx < 0) return vide;
  const ratios = a.map((va, i) => {
    const vb = b[i];
    return mesure(va) && mesure(vb) ? Math.log1p(va) - Math.log1p(vb) : null;
  });
  let n = 0;
  let sommeAlt = 0;
  let sommeBtc = 0;
  for (let i = Math.max(0, idx - 6); i <= idx; i += 1) {
    const va = a[i];
    const vb = b[i];
    if (mesure(va) && mesure(vb)) {
      n += 1;
      sommeAlt += va;
      sommeBtc += vb;
    }
  }
  return {
    dernierJourCommun: debut + idx * JOUR_MS,
    partVsBtc7j: n >= Math.ceil(7 * COUVERTURE_MIN) && sommeBtc > 0 ? sommeAlt / sommeBtc : null,
    zRatio365: zScoresGlissants(ratios, JOURS_ANNEE)[idx] ?? null,
  };
}

/** Jours de retard du dernier jour mesuré sur le dernier jour complet attendu (0 = à jour). PURE. */
export function retardJours(dernierJour: number, maintenant: number): number {
  return Math.max(0, Math.round((dernierJourComplet(maintenant) - dernierJour) / JOUR_MS));
}

// ─────────────────────────── Chargement (réseau + cache + santé) ───────────────────────────

export interface ResultatAttentionWiki {
  actif: string;
  edition: EditionWiki;
  titre: string;
  serie: SerieVues;
  /** Instant de la dernière acquisition réussie (conservé lors des lectures de cache). */
  recupereLe: number;
  /** true : la source a échoué et l'entrée de cache servie a dépassé sa TTL. */
  perime: boolean;
}

/** Forme stockée en cache (compacte : un nombre par jour). */
interface DonneeCache {
  titre: string;
  debut: number;
  vues: (number | null)[];
}

/** Garde de forme d'une entrée de cache : titre attendu, grille quotidienne, longueur bornée. */
function donneeCacheValide(d: unknown, titre: string): d is DonneeCache {
  const debut = champ(d, "debut");
  const vues = champ(d, "vues");
  return (
    champ(d, "titre") === titre &&
    typeof debut === "number" &&
    Number.isFinite(debut) &&
    debut % JOUR_MS === 0 &&
    Array.isArray(vues) &&
    vues.length > 0 &&
    vues.length <= HISTORIQUE_JOURS &&
    vues.every((v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0))
  );
}

/** Message lisible d'un statut HTTP de Wikimedia. */
function messageHttp(statut: number): string {
  if (statut === 404) return "Article introuvable ou sans données (HTTP 404) : titre à vérifier.";
  if (statut === 429) return "Quota Wikimedia atteint (HTTP 429).";
  return `Wikimedia indisponible (HTTP ${statut}).`;
}

/** Message lisible d'une erreur de chargement. */
function messageErreur(err: unknown): string {
  // Le délai dépassé arrive en DOMException « TimeoutError » (motif d'AbortSignal.timeout).
  if (champ(err, "name") === "TimeoutError") return "Délai Wikimedia dépassé.";
  if (err instanceof TypeError) return "Wikimedia injoignable (réseau ou CORS).";
  if (err instanceof SyntaxError) return "Réponse Wikimedia illisible.";
  return err instanceof Error ? err.message : String(err);
}

/** GET JSON borné en temps et en taille, avec `Api-User-Agent` puis repli en requête simple. */
async function requeterJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const delai = AbortSignal.timeout(DELAI_MS);
  const signalEffectif = signal ? AbortSignal.any([signal, delai]) : delai;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "Api-User-Agent": API_USER_AGENT }, credentials: "omit", signal: signalEffectif });
  } catch (err) {
    if (signalEffectif.aborted || !(err instanceof TypeError)) throw err;
    // Pré-vol CORS refusé ou réseau coupé : un seul nouvel essai, en requête simple.
    res = await fetch(url, { credentials: "omit", signal: signalEffectif });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(messageHttp(res.status));
  }
  if (Number(res.headers.get("content-length")) > TAILLE_MAX_OCTETS) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error("Réponse Wikimedia trop volumineuse.");
  }
  const texte = await res.text();
  if (texte.length > TAILLE_MAX_OCTETS) throw new Error("Réponse Wikimedia trop volumineuse.");
  return JSON.parse(texte) as unknown;
}

/**
 * Série quotidienne des pages vues d'un actif de la table curée, sur HISTORIQUE_JOURS jours
 * finissant à la VEILLE UTC. Cache frais (TTL 6 h) servi sans réseau ; sur échec, l'entrée
 * périmée est resservie avec `perime: true` ; sans cache, l'erreur remonte (message
 * lisible). Un actif ou une édition hors table lève SANS requête. Une annulation par
 * `signal` remonte telle quelle, sans toucher à la santé ni au cache.
 */
export async function chargerAttentionWiki(
  actif: string,
  edition: EditionWiki,
  options: { signal?: AbortSignal; maintenant?: number } = {},
): Promise<ResultatAttentionWiki> {
  const titre = titreArticle(actif, edition);
  if (titre === null) throw new Error(`Aucun article Wikipédia retenu pour ${actif} (${edition}).`);
  const maintenant = options.maintenant ?? Date.now();
  const fin = dernierJourComplet(maintenant);
  const debut = fin - (HISTORIQUE_JOURS - 1) * JOUR_MS;
  const cle = `attentionWiki:${VERSION_CACHE}:${edition}:${actif}`;

  const cache = await lireCache<DonneeCache>(cle);
  const enCache = cache !== null && donneeCacheValide(cache.donnee, titre) ? cache : null;
  const depuisCache = (perime: boolean): ResultatAttentionWiki | null =>
    enCache === null
      ? null
      : {
          actif,
          edition,
          titre,
          serie: { debut: enCache.donnee.debut, vues: enCache.donnee.vues },
          recupereLe: enCache.ts,
          perime,
        };
  if (enCache !== null && maintenant - enCache.ts >= 0 && maintenant - enCache.ts < TTL_CACHE_MS) {
    return depuisCache(false)!;
  }

  try {
    const json = await requeterJson(urlPagesVues(titre, edition, debut, fin), options.signal);
    const serie = serieContigue(parsePagesVues(json, edition, titre, fin), debut, fin);
    if (!serie.vues.some(mesure)) throw new Error("Réponse Wikimedia vide pour cet article.");
    options.signal?.throwIfAborted();
    await ecrireCache<DonneeCache>(cle, { titre, debut: serie.debut, vues: serie.vues });
    healthStore.getState().setEtat(SOURCE_SANTE, "polling", { dernierMessageTs: maintenant, derniereErreur: undefined });
    return { actif, edition, titre, serie, recupereLe: maintenant, perime: false };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    const message = messageErreur(err);
    healthStore.getState().marquerErreur(SOURCE_SANTE, message);
    const repli = depuisCache(true);
    if (repli !== null) return repli;
    throw new Error(message);
  }
}
