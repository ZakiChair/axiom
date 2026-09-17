/**
 * Sous-section « Production des mineurs cotés » de la section Mineurs de CHAIN (CryptoQuant
 * BASIC, clé personnelle) : BTC minés au dernier jour clos attribués à neuf sociétés cotées,
 * cumul mensuel du fournisseur, valeur USD, production déclarée quand publiée. Σ = sommes
 * d'affichage des neuf lignes, affichées seulement à 9/9 (aucun moteur d'agrégation) ; toute
 * valeur absente s'affiche « — », jamais 0 ; aucun écart déclaré/observé n'est calculé.
 *
 * Aucun import d'exécution du client CryptoQuant ni de `shared/cryptoquant-proxy` : le client
 * reste un chunk chargé à la demande (`await import()` dans le conteneur, garde-fou
 * `chunkCryptoquant.test.ts`). Les messages « clé requise » viennent du store de clé, déjà
 * partagé par les Réglages, DES et le client.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import type { ChargementCq, LigneCq, LigneMineur, SerieCq } from "../../data/onchain/cryptoquant";
import type { QualiteMetrique } from "../../data/qualiteMetrique";
import { IS_VERCEL } from "../../lib/deployment";
import { formatDec, formatUsd } from "../../lib/format";
import { useHorloge } from "../../lib/horloge";
import { cryptoquantKeyStore, messageSansCleCq, RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";
import { enregistrerQualite } from "../../store/qualiteMetriques";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "../TableTriable";
import { Badge, BadgeFiabilite, NoteSource, SansCle, Vide } from "../ui";
import { boutonHistorique, CourbeOnchain, dateObservation } from "./HistoriqueCommun";

const JOUR_MS = 86_400_000;
/** Sociétés suivies par `miner-data/companies` (offre BASIC). */
const ATTENDUES = 9;

/** Identifiant publié dans « Qualité des blocs » (préfixe `chain:` filtré par OnchainWindow). */
export const ID_QUALITE_MINEURS = "chain:mineurs-cotes";
export const LIBELLE_QUALITE_MINEURS = "Mineurs cotés · CryptoQuant";

/**
 * Noms usuels affichés en infobulle (connaissance générale, non issue du sondage). L'ordre
 * d'écriture est celui de `IDS_MINEURS_CQ` ; le type `Record` impose exactement les neuf clés.
 */
const NOMS_SOCIETES: Record<IdMineurCq, string> = {
  bitf: "Bitfarms",
  cipher: "Cipher Mining",
  clsk: "CleanSpark",
  core: "Core Scientific",
  hive: "HIVE Digital",
  iren: "IREN",
  mara: "MARA Holdings",
  riot: "Riot Platforms",
  wulf: "TeraWulf",
};

/** Les neuf sociétés dans l'ordre fournisseur (égalité avec `IDS_MINEURS_CQ` figée par le test). */
export const IDS_SOCIETES: readonly IdMineurCq[] = Object.keys(NOMS_SOCIETES) as IdMineurCq[];

type Chargements = Partial<Record<SerieCq, ChargementCq>>;

const serieDe = (id: IdMineurCq): SerieCq => `mineur:${id}`;
const tempsJour = (jour: string): number => Date.parse(`${jour}T00:00:00Z`);
const accord = (n: number): string => (n > 1 ? "s" : "");

/** Garde de l'union `LigneCq` : seule une ligne mineur porte `r`. */
function estLigneMineur(ligne: LigneCq | undefined): ligne is LigneMineur {
  return ligne !== undefined && "r" in ligne;
}

/** Somme d'affichage : une seule valeur absente rend la somme absente (jamais comptée 0). */
function sommeOuNull(valeurs: ReadonlyArray<number | null>): number | null {
  let total = 0;
  for (const v of valeurs) {
    if (v === null || !Number.isFinite(v)) return null;
    total += v;
  }
  return total;
}

/** Chargements des neuf sociétés déjà reçus, dans l'ordre fournisseur. */
function recusDe(chargements: Chargements): ChargementCq[] {
  return IDS_SOCIETES.flatMap((id) => {
    const charge = chargements[serieDe(id)];
    return charge === undefined ? [] : [charge];
  });
}

/**
 * Raisons des séries en échec. Une série « prête » peut porter une raison : c'est l'archive
 * locale illisible, remplacée à l'écriture — un signal, pas un échec.
 */
function raisonsEchec(recus: readonly ChargementCq[]): string[] {
  return [...new Set(recus.flatMap((c) => (c.statut !== "pret" && c.raison !== null ? [c.raison] : [])))];
}

/**
 * Mêmes raisons, mais celles de `credits` remplacées par leur variante sans archive. Substitution
 * par STATUT : la raison du plafond porte la somme consommée, elle n'est donc pas un littéral.
 */
function raisonsSansArchive(recus: readonly ChargementCq[]): string[] {
  const credits = new Set(recus.flatMap((c) => (c.statut === "credits" && c.raison !== null ? [c.raison] : [])));
  return [
    ...new Set(
      raisonsEchec(recus).map((r) =>
        !credits.has(r)
          ? r
          : r === RAISON_CREDITS_EPUISES_CQ
            ? CREDITS_EPUISES_SANS_ARCHIVE
            : BUDGET_CREDITS_SANS_ARCHIVE,
      ),
    ),
  ];
}

const union = (listes: ReadonlyArray<readonly string[]>): string[] => [...new Set(listes.flat())].sort();

export interface LigneSociete {
  id: IdMineurCq;
  nom: string;
  /** Ligne du jour de référence ; `null` si la société n'en a pas. */
  ligne: LigneMineur | null;
  /** Motif de l'absence, affiché en infobulle du tiret. */
  motif: string;
}

export interface ModeleMineursCotes {
  /** Jour de référence = dernier jour clos archivé, toutes sociétés confondues (J-1 en régime normal). */
  jourRef: string | null;
  /** Écart en jours entre aujourd'hui (UTC) et le jour de référence (1 = J-1). */
  retardJours: number | null;
  /** Toujours neuf lignes, dans l'ordre fournisseur. */
  lignes: LigneSociete[];
  /** Sociétés ayant une ligne au jour de référence. */
  disponibles: number;
  /** Sommes d'affichage des neuf lignes, `null` sous 9/9 ; chaque colonne absente dès qu'une valeur manque. */
  somme: { r: number; cm: number | null; usd: number | null } | null;
  /** Σ BTC/j par jour archivé ; `null` le jour où une société manque (ligne coupée). */
  courbe: Array<{ time: number; value: number | null }>;
  archive: { debut: string | null; jours: number; manquants: string[]; perdus: string[]; hierEnAttente: number };
  /** Dernier appel réussi (max des `majTs`). */
  recupereLe: number | null;
}

/** Modèle d'affichage PUR (aucune lecture d'horloge : `now` injecté). */
export function construireModeleMineurs(chargements: Chargements, now: number): ModeleMineursCotes {
  const societes = IDS_SOCIETES.map((id) => ({ id, charge: chargements[serieDe(id)] }));
  const archives = societes.map(({ charge }) => charge?.archive ?? null);
  const diagnostics = societes.flatMap(({ charge }) => (charge?.archive ? [charge.diagnostic] : []));
  const derniers = diagnostics.map((d) => d.dernier).filter((j): j is string => j !== null).sort();
  const jourRef = derniers.at(-1) ?? null;

  const lignes = societes.map(({ id, charge }): LigneSociete => {
    const brute = jourRef === null ? undefined : charge?.archive?.jours[jourRef];
    const motif =
      charge === undefined
        ? "Série non encore reçue."
        : charge.statut !== "pret" && charge.raison !== null
          ? charge.raison
          : jourRef === null
            ? "Aucune ligne archivée."
            : // Pas forcément impubliée : la série a pu ne pas être relue (reprise de 12 h du client).
              `Aucune ligne archivée pour le ${jourRef} (non encore relue ou non publiée).`;
    return { id, nom: NOMS_SOCIETES[id], ligne: estLigneMineur(brute) ? brute : null, motif };
  });
  const presentes = lignes.flatMap((l) => (l.ligne === null ? [] : [l.ligne]));
  const somme =
    presentes.length === ATTENDUES
      ? {
          r: presentes.reduce((total, l) => total + l.r, 0),
          cm: sommeOuNull(presentes.map((l) => l.cm)),
          usd: sommeOuNull(presentes.map((l) => l.usd)),
        }
      : null;

  const jours = [...new Set(archives.flatMap((a) => (a === null ? [] : Object.keys(a.jours))))].sort();
  const courbe = jours.map((jour): { time: number; value: number | null } => {
    const time = tempsJour(jour);
    let total = 0;
    for (const a of archives) {
      const ligne = a?.jours[jour];
      if (!estLigneMineur(ligne)) return { time, value: null };
      total += ligne.r;
    }
    return { time, value: total };
  });

  const debuts = diagnostics.map((d) => d.debut).filter((j): j is string => j !== null).sort();
  const majs = archives.map((a) => a?.majTs ?? null).filter((t): t is number => t !== null);
  const aujourdhui = dateObservation(now);
  return {
    jourRef,
    retardJours: jourRef === null ? null : Math.round((tempsJour(aujourdhui) - tempsJour(jourRef)) / JOUR_MS),
    lignes,
    disponibles: presentes.length,
    somme,
    courbe,
    archive: {
      debut: debuts[0] ?? null,
      jours: jours.length,
      manquants: union(diagnostics.map((d) => d.manquantsFenetre)),
      perdus: union(diagnostics.map((d) => d.perdus)),
      hierEnAttente: diagnostics.filter((d) => !d.hierPresent).length,
    },
    recupereLe: majs.length > 0 ? Math.max(...majs) : null,
  };
}

/**
 * Qualité du bloc « Mineurs cotés · CryptoQuant ». PURE. Indisponible sans aucune ligne archivée ;
 * périmée si toutes les séries archivées ont leur dernier jour antérieur à aujourd'hui − 2 j ;
 * partielle sous 9/9 ou avec un jour manquant récupérable ; fraîche sinon (J-1 en attente de
 * publication n'est pas un trou). Le statut juge les DONNÉES (§4.5) : une archive fraîche servie
 * pendant une panne reste « frais », mais garde la raison de l'échec et ne se dit « CryptoQuant
 * BASIC » que si au moins une série a été réellement rafraîchie ce cycle (appel réussi).
 */
export function qualiteMineursCotes(chargements: Chargements, now: number): QualiteMetrique {
  const m = construireModeleMineurs(chargements, now);
  const recus = recusDe(chargements);
  const diagnostics = recus.flatMap((c) => (c.archive ? [c.diagnostic] : []));
  const raisons = raisonsEchec(recus);
  const avecDonnees = m.archive.jours > 0;
  const statut: QualiteMetrique["statut"] = !avecDonnees
    ? "indisponible"
    : diagnostics.every((d) => d.perime)
      ? "perime"
      : m.disponibles < ATTENDUES || m.archive.manquants.length > 0
        ? "partiel"
        : "frais";
  const morceaux: string[] = [];
  if (m.jourRef !== null) morceaux.push(`${m.disponibles}/${ATTENDUES} sociétés au ${m.jourRef}.`);
  const n = m.archive.manquants.length;
  if (n > 0) morceaux.push(`${n} jour${accord(n)} manquant${accord(n)} dans la fenêtre de 30 j.`);
  morceaux.push(...raisons);
  const raison =
    statut === "frais"
      ? raisons.length > 0
        ? raisons.join(" ")
        : undefined
      : !avecDonnees
        ? raisonsSansArchive(recus)[0] ?? "Aucune ligne CryptoQuant archivée."
        : morceaux.join(" ");
  return {
    sourceId: "cryptoquant",
    // `appel` vaut aussi pour un 401/403/429/5xx ou une erreur réseau : seul un appel « prêt » est live.
    sourceEffective: recus.some((c) => c.appel && c.statut === "pret") ? "CryptoQuant BASIC" : "archive locale CryptoQuant",
    observeLe: m.jourRef === null ? null : tempsJour(m.jourRef),
    recupereLe: m.recupereLe,
    cadenceMs: JOUR_MS,
    // Observation datée au DÉBUT du jour clos (00:00 UTC) : 3 j équivaut à « dernier jour
    // antérieur à aujourd'hui − 2 j », le seuil de `diagnostiquer`, et reprend le délai des séries
    // quotidiennes de CHAIN (hashrate, thermocap). Avec 2 j, le bloc serait « périmé » chaque matin
    // où J-1 n'est pas encore publié (spec §4.5 amendée, §12).
    ageMaxMs: 3 * JOUR_MS,
    couverture: { disponibles: m.disponibles, attendus: ATTENDUES },
    estime: false,
    acces: "cle",
    statut,
    ...(raison === undefined ? {} : { raison }),
  };
}

// ─────────────────────────── Vue, en-tête et conteneur ───────────────────────────

/** Tri par défaut : BTC J-1 décroissant ; les sociétés sans ligne restent en fin de liste. */
const TRI_DEFAUT: TriTable = { colonne: "btc", dir: -1 };

const abreger = (jours: readonly string[]): string =>
  jours.length <= 3 ? jours.join(", ") : `${jours[0] ?? ""} … ${jours.at(-1) ?? ""}`;

const tiret = (motif: string) => <span title={motif}>—</span>;

/**
 * Rejet de l'`await import()` du client (chunk introuvable : coupure réseau ou redéploiement —
 * l'ancien chunk haché n'existe plus, le navigateur peut garder l'échec en cache). Aucune ligne
 * n'a été lue, contrairement à une archive réellement vide : le libellé ne doit jamais mentionner
 * « archive ». Un rechargement récupère le nouveau chunk (rouvrir CHAIN ne suffit pas si le
 * navigateur a mis l'échec en cache).
 */
const CLIENT_NON_CHARGE = "Client CryptoQuant non chargé (réseau ou mise à jour d'AXIOM) ; rechargez la page.";

/**
 * Raison FIXE du 402 (spec §13), RECOPIÉE du client comme les autres textes partagés : importer
 * sa VALEUR ferait entrer le client dans un chunk préchargé par l'entrée
 * (`chunkCryptoquant.test.ts`). L'autre raison de `credits` — le plafond local — porte la somme
 * consommée et n'est donc pas un littéral : la vue la reconnaît par défaut. Contrat tenu par
 * `components/raisonsCreditsCq.test.ts`, qui compare ce littéral à l'export du client.
 */
export const RAISON_CREDITS_EPUISES_CQ =
  "Crédits mensuels CryptoQuant épuisés (402) : plus d'appel avant la remise à zéro mensuelle ; archive affichée.";
/**
 * Raisons `credits` SANS archive : les deux raisons du §13 se terminent par « archive affichée »,
 * ce qui serait un mensonge dans un bloc vide (et dans l'infobulle de qualité « indisponible »).
 */
const CREDITS_EPUISES_SANS_ARCHIVE = "Crédits CryptoQuant épuisés (402) ; aucune archive locale.";
const BUDGET_CREDITS_SANS_ARCHIVE = "Budget de crédits CryptoQuant atteint ; aucune archive locale.";

const COLONNES: ReadonlyArray<ColonneTable<LigneSociete>> = [
  {
    id: "societe",
    label: "Société",
    largeur: "minmax(0,1.2fr)",
    triable: true,
    valeurTri: (l) => l.id,
    rendu: (l) => <span title={l.nom}>{l.id.toUpperCase()}</span>,
  },
  {
    id: "btc",
    label: "BTC J-1",
    align: "right",
    triable: true,
    valeurTri: (l) => l.ligne?.r ?? null,
    rendu: (l) =>
      l.ligne === null ? (
        tiret(l.motif)
      ) : (
        <span title={`coinbase ${formatDec(l.ligne.cr)} + autres ${formatDec(l.ligne.om)} BTC`}>
          {formatDec(l.ligne.r)}
        </span>
      ),
  },
  {
    id: "cumul",
    label: "Cumul mois",
    align: "right",
    triable: true,
    valeurTri: (l) => l.ligne?.cm ?? null,
    rendu: (l) => (l.ligne === null ? tiret(l.motif) : formatDec(l.ligne.cm)),
  },
  {
    id: "usd",
    label: "USD J-1",
    align: "right",
    triable: true,
    valeurTri: (l) => l.ligne?.usd ?? null,
    rendu: (l) => (l.ligne === null ? tiret(l.motif) : formatUsd(l.ligne.usd)),
  },
  {
    id: "decl",
    label: "Déclaré (mois)",
    align: "right",
    largeur: "minmax(0,1.2fr)",
    triable: true,
    valeurTri: (l) => l.ligne?.decl ?? null,
    // Valeur brute publiée par la société ; aucun écart avec la production observée.
    rendu: (l) =>
      l.ligne === null ? tiret(l.motif) : l.ligne.decl === null ? "non publié" : `${formatDec(l.ligne.decl)} BTC`,
  },
];
/** Même gabarit de colonnes que TableTriable, pour la ligne Σ rendue hors tri. */
const GRILLE = COLONNES.map((c) => c.largeur ?? "1fr").join(" ");

function texteArchive(a: ModeleMineursCotes["archive"]): string {
  const morceaux = [`Archive locale depuis ${a.debut ?? "—"}`, `${a.jours} j`];
  const n = a.manquants.length;
  if (n > 0) morceaux.push(`${n} manquant${accord(n)} dans la fenêtre (${abreger(a.manquants)})`);
  const p = a.perdus.length;
  morceaux.push(p === 0 ? "0 perdu" : `${p} perdu${accord(p)} définitivement (${abreger(a.perdus)})`);
  if (a.hierEnAttente > 0) morceaux.push(`J-1 en attente de publication (${a.hierEnAttente}/${ATTENDUES})`);
  return morceaux.join(" · ");
}

/** Signaux de persistance et d'archive, jamais silencieux (une série prête avec raison = archive illisible remplacée). */
function signauxArchive(recus: readonly ChargementCq[]): string[] {
  const signaux: string[] = [];
  if (recus.some((c) => !c.persistance.local)) signaux.push("archive non persistée localement (stockage plein)");
  if (recus.some((c) => c.persistance.kv === false)) signaux.push("copie daemon non écrite");
  if (recus.some((c) => c.statut === "pret" && c.raison !== null)) signaux.push("archive locale illisible remplacée");
  return signaux;
}

export interface PropsVueMineursCotes {
  chargements: Partial<Record<SerieCq, ChargementCq>>;
  enCours: boolean;
  recues: number;
  file: { enAttente: number; repriseTs: number | null };
  now: number;
  onOuvrirReglages: () => void;
  /** Tri de la table ; absent = BTC J-1 décroissant, `null` = ordre fournisseur. */
  tri?: TriTable | null;
  /** Clic d'en-tête ; absent = en-têtes non cliquables (rendu statique). */
  onTri?: (tri: TriTable) => void;
  /** `await import()` du client rejeté ce cycle (chunk introuvable) : aucune ligne n'a été lue. */
  echecClient?: boolean;
}

/** Contenu déplié de la sous-section. PURE et sans état (rendu statique testé). */
export function VueMineursCotes({
  chargements,
  enCours,
  recues,
  file,
  now,
  onOuvrirReglages,
  tri = TRI_DEFAUT,
  onTri,
  echecClient = false,
}: PropsVueMineursCotes) {
  const m = construireModeleMineurs(chargements, now);
  const recus = recusDe(chargements);
  const raisons = raisonsEchec(recus);
  const cleRequise = recus.some((c) => c.statut === "cle-requise");
  const progression = enCours ? (
    <NoteSource>
      {`${recues}/${ATTENDUES} reçues · ${file.enAttente > 0 ? "en attente du quota CryptoQuant (10 req/min)" : "chargement…"}`}
    </NoteSource>
  ) : null;

  // Rejet de l'import() du client (chunk introuvable) : rien n'a été lu, donc jamais la même
  // branche qu'une archive vide (§4.3 de la spec : jamais un chargement muet).
  if (echecClient) {
    return (
      <div className="mt-2">
        <Vide>{CLIENT_NON_CHARGE}</Vide>
      </div>
    );
  }

  if (m.archive.jours === 0) {
    if (enCours) {
      return (
        <div className="mt-2 space-y-2">
          {progression}
          <Vide>Chargement de la production des mineurs cotés…</Vide>
        </div>
      );
    }
    if (cleRequise) {
      // Clé absente : message complété selon le déploiement. Clé refusée (401) : raison telle quelle.
      const cleAbsente = recus.some((c) => c.statut === "cle-requise" && c.raison === RAISON_CLE_CRYPTOQUANT);
      const refus =
        recus.find((c) => c.statut === "cle-requise" && c.raison !== RAISON_CLE_CRYPTOQUANT)?.raison ?? null;
      return (
        <div className="mt-2">
          <SansCle
            message={cleAbsente || refus === null ? messageSansCleCq(IS_VERCEL) : refus}
            onOuvrirReglages={onOuvrirReglages}
          />
        </div>
      );
    }
    // Bloc VIDE : les raisons `credits` prennent leur variante sans archive (§13 « archive affichée »).
    const sansArchive = raisonsSansArchive(recus);
    return (
      <div className="mt-2">
        <Vide>{sansArchive.length > 0 ? sansArchive.join(" ") : "Aucune ligne CryptoQuant archivée."}</Vide>
      </div>
    );
  }

  const s = m.somme;
  const entete =
    m.jourRef === null || m.retardJours === null
      ? ""
      : [
          `${m.jourRef} (J-${m.retardJours})`,
          `${m.disponibles}/${ATTENDUES} sociétés`,
          ...(s === null
            ? [`Σ partielle ${m.disponibles}/${ATTENDUES}`]
            : [
                `Σ ${formatDec(s.r)} BTC/j`,
                `cumul mois Σ ${s.cm === null ? "—" : `${formatDec(s.cm)} BTC`}`,
                `Σ ${formatUsd(s.usd)}/j`,
              ]),
        ].join(" · ");
  const signaux = signauxArchive(recus);
  const sansDaemon = recus.some((c) => c.persistance.kv === null);
  const perime = recus.some((c) => c.archive !== null && c.diagnostic.perime);

  return (
    <div className="mt-2 space-y-2">
      {progression}
      {raisons.length > 0 && (
        <NoteSource>
          <Badge ton="warn">{cleRequise ? "clé requise pour actualiser" : "archive servie"}</Badge> {raisons.join(" ")}
        </NoteSource>
      )}
      {entete !== "" && <p className="text-[11px] tabular-nums text-text">{entete}</p>}
      <TableTriable
        colonnes={COLONNES}
        lignes={trierLignes(m.lignes, COLONNES, tri)}
        tri={tri}
        onTri={onTri}
        cle={(l) => l.id}
        ariaLabel="Production des mineurs cotés"
      />
      <div
        className="grid items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium tabular-nums"
        style={{ gridTemplateColumns: GRILLE }}
      >
        {s === null ? (
          <span className="col-span-full text-text-dim">
            {`Σ partielle ${m.disponibles}/${ATTENDUES} : somme affichée seulement quand les neuf sociétés ont une ligne au ${m.jourRef ?? "—"}.`}
          </span>
        ) : (
          <>
            <span>{`Σ ${ATTENDUES}`}</span>
            <span className="text-right">{formatDec(s.r)}</span>
            <span className="text-right">{formatDec(s.cm)}</span>
            <span className="text-right">{formatUsd(s.usd)}</span>
            <span className="text-right">—</span>
          </>
        )}
      </div>
      <CourbeOnchain points={m.courbe} label={`Production Σ ${ATTENDUES} sociétés`} unite="BTC/j" />
      <NoteSource>
        {texteArchive(m.archive)}
        {perime && (
          <>
            {" · "}
            <Badge ton="warn">cache ou observation périmé</Badge>
          </>
        )}
      </NoteSource>
      {signaux.length > 0 && (
        <NoteSource>
          <Badge ton="warn">archive</Badge>
          {` ${signaux.join(" · ")}`}
        </NoteSource>
      )}
      <NoteSource>
        <BadgeFiabilite
          niveau="partiel"
          label="J-1 · CryptoQuant"
          title="Offre BASIC : jours clos seulement (J-1), 30 jours glissants sans rattrapage, licence personnelle."
        />
        {` · CryptoQuant · miner-data/companies (${ATTENDUES} requêtes) · licence personnelle · attribution des blocs par le fournisseur (périmètre non documenté) · cumul mois = valeur fournisseur, non recalculée · « déclaré » = production publiée par la société, absente hors publication, sans écart calculé · Σ = sommes d'affichage des ${ATTENDUES} lignes, seulement à ${ATTENDUES}/${ATTENDUES}`}
        {sansDaemon ? " · sans daemon : vider le stockage du navigateur perd l'archive" : ""}
        {m.recupereLe !== null ? ` · récupéré ${dateObservation(m.recupereLe)}` : ""}
      </NoteSource>
    </div>
  );
}

export type ParametresResumeMineurs = Pick<
  PropsVueMineursCotes,
  "chargements" | "enCours" | "recues" | "file" | "now" | "echecClient"
>;

/**
 * Résumé du côté droit de l'en-tête, visible section repliée (état par défaut), agrégé sur les
 * neuf séries. PUR. Mêmes états que DES (spec §5.2), jamais une chaîne vide (§4.3). Ordre :
 * collecte en cours ; client non chargé ; quota à reprise future ; clé requise sans archive (seul
 * état actionnable, porte le CTA) ; quota écoulé ; offre ; crédits (§13) ; erreur sans archive ;
 * erreur après appel avec archive ; texte d'archive.
 */
export function resumeEnTeteMineurs({
  chargements,
  enCours,
  recues,
  file,
  now,
  echecClient = false,
}: ParametresResumeMineurs): string {
  if (enCours) return file.enAttente > 0 ? `${recues}/${ATTENDUES} reçues · en attente du quota` : "chargement…";
  if (echecClient) return "client CryptoQuant non chargé";
  const m = construireModeleMineurs(chargements, now);
  const recus = recusDe(chargements);
  const avecStatut = (statut: ChargementCq["statut"]) => recus.filter((c) => c.statut === statut);
  // Reprise affichée seulement si une série est en quota (429) : une pause `remaining: 0` seule n'en est pas un.
  const enQuota = avecStatut("quota").length > 0;
  if (enQuota && file.repriseTs !== null && file.repriseTs > now) {
    return `quota atteint, reprise ${Math.ceil((file.repriseTs - now) / 1000)} s`;
  }
  const cles = avecStatut("cle-requise");
  if (cles.length > 0 && m.archive.jours === 0) {
    return cles.some((c) => c.raison === RAISON_CLE_CRYPTOQUANT) ? "clé personnelle requise" : "clé CryptoQuant refusée";
  }
  // Le client ne relance pas la collecte à l'expiration du 429 : l'honnêteté est de le dire.
  if (enQuota) return "quota atteint, réessai à la prochaine ouverture";
  if (avecStatut("offre").length > 0) return "offre CryptoQuant insuffisante";
  // `credits` (§13) : refus SANS appel, placé comme « offre ». Un 402 (raison fixe) l'emporte sur
  // le plafond local : c'est le refus du fournisseur, et il vaut pour toutes les séries.
  const credits = avecStatut("credits");
  if (credits.length > 0) {
    return credits.some((c) => c.raison === RAISON_CREDITS_EPUISES_CQ)
      ? "crédits CryptoQuant épuisés"
      : "budget de crédits atteint";
  }
  const erreurs = avecStatut("erreur");
  // Une erreur sans appel (archive d'une version plus récente) n'est pas une panne réseau.
  const injoignable = erreurs.some((c) => c.appel);
  if (m.jourRef === null || m.retardJours === null) {
    if (erreurs.length > 0) return injoignable ? "CryptoQuant injoignable" : "erreur CryptoQuant";
    return "archive vide";
  }
  const archive = `archive ${m.archive.jours} j · J-${m.retardJours} ${m.jourRef}`;
  return injoignable ? `CryptoQuant injoignable · ${archive}` : archive;
}

export type PropsEnTeteMineursCotes = PropsVueMineursCotes & { ouvert: boolean; onBasculer: () => void };

/**
 * Ligne d'en-tête toujours visible : bouton replié par défaut, état de collecte à droite
 * (`resumeEnTeteMineurs`) et CTA « clé CryptoQuant ⚙ » dès qu'une série attend une clé (absente
 * ou refusée par le fournisseur) ; jamais sur un quota, une offre ou une panne, où les Réglages ne
 * changeraient rien.
 */
export function EnTeteMineursCotes({
  ouvert,
  onBasculer,
  chargements,
  enCours,
  recues,
  file,
  now,
  onOuvrirReglages,
  echecClient = false,
}: PropsEnTeteMineursCotes) {
  const cleRequise = recusDe(chargements).some((c) => c.statut === "cle-requise");
  const etat = resumeEnTeteMineurs({ chargements, enCours, recues, file, now, echecClient });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className={boutonHistorique} aria-expanded={ouvert} onClick={onBasculer}>
        {`Production des mineurs cotés ${ouvert ? "▾" : "▸"}`}
      </button>
      <span className="flex items-center gap-2 text-[10px] text-text-dim">
        {cleRequise && (
          <button
            type="button"
            onClick={onOuvrirReglages}
            className="text-[10px] text-accent hover:underline"
            title="Clé personnelle CryptoQuant (offre BASIC) à saisir dans les Réglages"
          >
            clé CryptoQuant ⚙
          </button>
        )}
        <span>{etat}</span>
      </span>
    </div>
  );
}

/**
 * Conteneur : repliée par défaut, charge les neuf séries au MONTAGE (et à chaque changement de
 * clé, via `version`), affiche au fil de l'eau, publie la qualité après la boucle. Un abandon
 * (démontage, double montage du mode strict) ne publie rien et n'occupe aucun créneau. L'état du
 * tri vit ici ; la vue reste pure.
 */
export function MineursCotes({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [tri, setTri] = useState<TriTable>(TRI_DEFAUT);
  const [chargements, setChargements] = useState<Chargements>({});
  const [enCours, setEnCours] = useState(true);
  const [recues, setRecues] = useState(0);
  const [file, setFile] = useState<{ enAttente: number; repriseTs: number | null }>({
    enAttente: 0,
    repriseTs: null,
  });
  const [echecClient, setEchecClient] = useState(false);
  const version = useStore(cryptoquantKeyStore, (s) => s.version);
  const now = useHorloge();

  useEffect(() => {
    const ctrl = new AbortController();
    const abonnement: { fin: (() => void) | null } = { fin: null };
    setEnCours(true);
    setRecues(0);
    setEchecClient(false);
    void (async () => {
      const cq = await import("../../data/onchain/cryptoquant");
      if (ctrl.signal.aborted) return;
      const publierFile = () => setFile(cq.etatFileCq());
      abonnement.fin = cq.abonnerFileCq(publierFile);
      publierFile();
      const recus: Chargements = {};
      let n = 0;
      for (const serie of cq.SERIES_MINEURS) {
        const charge = await cq.chargerSerieCq(serie, ctrl.signal);
        if (ctrl.signal.aborted) return;
        recus[serie] = charge;
        n += 1;
        setRecues(n);
        setChargements((precedents) => {
          const suivants: Chargements = { ...precedents };
          suivants[serie] = charge;
          return suivants;
        });
      }
      setEnCours(false);
      enregistrerQualite(ID_QUALITE_MINEURS, LIBELLE_QUALITE_MINEURS, qualiteMineursCotes(recus, Date.now()));
    })().catch(() => {
      // Démontage pendant une attente : silencieux (le composant disparaît). Rejet réel de
      // l'import() (chunk introuvable : coupure réseau ou redéploiement) : rien n'est publié pour
      // ce cycle, mais la vue et l'en-tête doivent le dire — jamais un chargement muet (spec §4.3).
      if (!ctrl.signal.aborted) {
        setEnCours(false);
        setEchecClient(true);
      }
    });
    return () => {
      ctrl.abort();
      abonnement.fin?.();
    };
  }, [version]);

  return (
    <div className="mt-3 space-y-1">
      <EnTeteMineursCotes
        ouvert={ouvert}
        onBasculer={() => setOuvert((v) => !v)}
        chargements={chargements}
        enCours={enCours}
        recues={recues}
        file={file}
        echecClient={echecClient}
        now={now}
        onOuvrirReglages={onOuvrirReglages}
      />
      {ouvert && (
        <VueMineursCotes
          chargements={chargements}
          enCours={enCours}
          recues={recues}
          file={file}
          echecClient={echecClient}
          now={now}
          onOuvrirReglages={onOuvrirReglages}
          tri={tri}
          onTri={setTri}
        />
      )}
    </div>
  );
}
