import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IDS_MINEURS_CQ, type IdMineurCq } from "../../../../../shared/cryptoquant-proxy";
import type { ArchiveCq, ChargementCq, DiagnosticCq, LigneMineur, SerieCq } from "../../data/onchain/cryptoquant";
import { actualiserQualite } from "../../data/qualiteMetrique";
import { RAISON_CLE_CRYPTOQUANT } from "../../store/cryptoquant";
import {
  construireModeleMineurs,
  EnTeteMineursCotes,
  ID_QUALITE_MINEURS,
  IDS_SOCIETES,
  LIBELLE_QUALITE_MINEURS,
  MineursCotes,
  qualiteMineursCotes,
  VueMineursCotes,
  type PropsEnTeteMineursCotes,
  type PropsVueMineursCotes,
} from "./MineursCotes";
import { Mineurs, VueMineurs } from "./Mineurs";

const JOUR_MS = 86_400_000;
/** Horloge des tests : 2026-09-16 12:00 UTC, donc J-1 = 2026-09-15. */
const MAINTENANT = Date.UTC(2026, 8, 16, 12);
const J1 = "2026-09-15";
/** Trente jours clos croissants, 2026-08-17 → 2026-09-15 (fenêtre de l'offre BASIC). */
const JOURS = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 15) - (29 - i) * JOUR_MS).toISOString().slice(0, 10),
);
/** BTC minés par jour, constants ; Σ = 130.00 BTC/j. */
const BTC: Record<IdMineurCq, number> = {
  bitf: 5.1,
  cipher: 7.2,
  clsk: 20.4,
  core: 3.3,
  hive: 4.4,
  iren: 18.5,
  mara: 49.05,
  riot: 15.6,
  wulf: 6.45,
};
const PX = 78_300;

type Chargements = Partial<Record<SerieCq, ChargementCq>>;
const serie = (id: IdMineurCq): SerieCq => `mineur:${id}`;

/**
 * MARA à J-1 = exemple réel du sondage (49.05 BTC, cumul 396.96, 3.84 M$) ; seule RIOT a publié
 * une production déclarée (123 BTC). Σ cumul J-1 = 396.96 + 80.95 × 15 = 1611.21 ;
 * Σ USD J-1 = 3 840 000 + 80.95 × 78 300 = 10 178 385.
 */
function ligne(id: IdMineurCq, jour: string): LigneMineur {
  const r = BTC[id];
  const maraJ1 = id === "mara" && jour === J1;
  return {
    r,
    cr: r - 0.05,
    om: 0.05,
    cm: maraJ1 ? 396.96 : r * Number(jour.slice(8, 10)),
    usd: maraJ1 ? 3_840_000 : r * PX,
    cmu: null,
    px: PX,
    decl: id === "riot" ? 123 : null,
    prec: null,
  };
}

function archive(id: IdMineurCq, jours: readonly string[] = JOURS): ArchiveCq {
  const lignes: Record<string, LigneMineur> = {};
  for (const jour of jours) lignes[jour] = ligne(id, jour);
  return { version: 1, serie: serie(id), majTs: MAINTENANT - 3_600_000, jours: lignes };
}

function diagnostic(surcharge: Partial<DiagnosticCq> = {}): DiagnosticCq {
  return {
    debut: "2026-08-17",
    dernier: J1,
    hierPresent: true,
    manquantsFenetre: [],
    perdus: [],
    perime: false,
    ...surcharge,
  };
}

function chargement(id: IdMineurCq, surcharge: Partial<ChargementCq> = {}): ChargementCq {
  return {
    serie: serie(id),
    statut: "pret",
    raison: null,
    archive: archive(id),
    diagnostic: diagnostic(),
    persistance: { local: true, kv: null },
    appel: true,
    ...surcharge,
  };
}

function tous(): Chargements {
  const resultat: Chargements = {};
  for (const id of IDS_SOCIETES) resultat[serie(id)] = chargement(id);
  return resultat;
}

/** Neuf séries sans clé active ni archive. */
function sansCle(): Chargements {
  const resultat: Chargements = {};
  for (const id of IDS_SOCIETES) {
    resultat[serie(id)] = chargement(id, {
      statut: "cle-requise",
      raison: RAISON_CLE_CRYPTOQUANT,
      archive: null,
      diagnostic: diagnostic({ debut: null, dernier: null, hierPresent: false, perime: true }),
      appel: false,
    });
  }
  return resultat;
}

describe("production des mineurs cotés : modèle et qualité", () => {
  beforeEach(() => vi.setSystemTime(MAINTENANT));
  afterEach(() => vi.useRealTimers());

  it("neuf sociétés dans l'ordre fournisseur ; identifiants de qualité stables", () => {
    expect(IDS_SOCIETES).toEqual([...IDS_MINEURS_CQ]);
    expect(ID_QUALITE_MINEURS).toBe("chain:mineurs-cotes");
    expect(LIBELLE_QUALITE_MINEURS).toBe("Mineurs cotés · CryptoQuant");
  });

  it("9/9 à J-1 : sommes d'affichage, courbe continue, archive, qualité fraîche", () => {
    const m = construireModeleMineurs(tous(), MAINTENANT);
    expect(m.jourRef).toBe(J1);
    expect(m.retardJours).toBe(1);
    expect(m.disponibles).toBe(9);
    expect(m.lignes.map((l) => l.id)).toEqual([...IDS_MINEURS_CQ]);
    expect(m.somme?.r).toBeCloseTo(130, 6);
    expect(m.somme?.cm).toBeCloseTo(1611.21, 6);
    expect(m.somme?.usd).toBeCloseTo(10_178_385, 3);
    expect(m.courbe).toHaveLength(30);
    expect(m.courbe.every((p) => p.value !== null)).toBe(true);
    expect(m.courbe.at(-1)?.time).toBe(Date.UTC(2026, 8, 15));
    expect(m.archive).toEqual({ debut: "2026-08-17", jours: 30, manquants: [], perdus: [], hierEnAttente: 0 });
    expect(m.recupereLe).toBe(MAINTENANT - 3_600_000);
    expect(qualiteMineursCotes(tous(), MAINTENANT)).toEqual({
      sourceId: "cryptoquant",
      sourceEffective: "CryptoQuant BASIC",
      observeLe: Date.UTC(2026, 8, 15),
      recupereLe: MAINTENANT - 3_600_000,
      cadenceMs: 86_400_000,
      ageMaxMs: 3 * 86_400_000,
      couverture: { disponibles: 9, attendus: 9 },
      estime: false,
      acces: "cle",
      statut: "frais",
    });
  });

  it("7/9 : aucune Σ, tiret motivé par société, qualité partielle avec couverture 7/9", () => {
    const chargements = tous();
    delete chargements[serie("wulf")];
    chargements[serie("hive")] = chargement("hive", {
      statut: "erreur",
      raison: "CryptoQuant injoignable ; archive affichée.",
      archive: archive("hive", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
    });
    const m = construireModeleMineurs(chargements, MAINTENANT);
    expect(m.disponibles).toBe(7);
    expect(m.somme).toBeNull();
    expect(m.lignes).toHaveLength(9);
    expect(m.lignes.find((l) => l.id === "wulf")).toMatchObject({ ligne: null, motif: "Série non encore reçue." });
    expect(m.lignes.find((l) => l.id === "hive")).toMatchObject({
      ligne: null,
      motif: "CryptoQuant injoignable ; archive affichée.",
    });
    // Une série absente : aucun jour n'a ses neuf lignes, la courbe Σ est entièrement coupée.
    expect(m.courbe.every((p) => p.value === null)).toBe(true);
    expect(m.archive.hierEnAttente).toBe(1);
    const q = qualiteMineursCotes(chargements, MAINTENANT);
    expect(q.couverture).toEqual({ disponibles: 7, attendus: 9 });
    expect(q.statut).toBe("partiel");
    expect(q.raison).toBe("7/9 sociétés au 2026-09-15. CryptoQuant injoignable ; archive affichée.");
  });

  it("un jour manquant chez une société coupe la courbe Σ ce jour-là et rend la qualité partielle", () => {
    const chargements = tous();
    chargements[serie("hive")] = chargement("hive", {
      archive: archive("hive", JOURS.filter((j) => j !== "2026-09-10")),
      diagnostic: diagnostic({ manquantsFenetre: ["2026-09-10"] }),
    });
    const m = construireModeleMineurs(chargements, MAINTENANT);
    expect(m.somme?.r).toBeCloseTo(130, 6);
    expect(m.courbe.find((p) => p.time === Date.UTC(2026, 8, 10))?.value).toBeNull();
    expect(m.courbe.filter((p) => p.value === null)).toHaveLength(1);
    expect(m.archive.manquants).toEqual(["2026-09-10"]);
    const q = qualiteMineursCotes(chargements, MAINTENANT);
    expect(q.statut).toBe("partiel");
    expect(q.raison).toBe("9/9 sociétés au 2026-09-15. 1 jour manquant dans la fenêtre de 30 j.");
  });

  it("une valeur absente n'est jamais comptée 0 : Σ USD et Σ cumul absentes, Σ BTC conservée", () => {
    const chargements = tous();
    const a = archive("mara");
    a.jours[J1] = { ...ligne("mara", J1), usd: null, cm: null };
    chargements[serie("mara")] = chargement("mara", { archive: a });
    const s = construireModeleMineurs(chargements, MAINTENANT).somme;
    expect(s?.r).toBeCloseTo(130, 6);
    expect(s?.usd).toBeNull();
    expect(s?.cm).toBeNull();
  });

  it("sans clé ni archive : indisponible avec la raison du store ; dernier jour antérieur à J-2 : périmé", () => {
    const q = qualiteMineursCotes(sansCle(), MAINTENANT);
    expect(q).toMatchObject({
      statut: "indisponible",
      acces: "cle",
      observeLe: null,
      recupereLe: null,
      sourceEffective: "archive locale CryptoQuant",
      couverture: { disponibles: 0, attendus: 9 },
    });
    expect(q.raison).toBe("Clé CryptoQuant personnelle requise (Réglages ⚙).");

    const anciens: Chargements = {};
    for (const id of IDS_SOCIETES) {
      anciens[serie(id)] = chargement(id, {
        statut: "erreur",
        raison: "CryptoQuant injoignable ; archive affichée.",
        archive: archive(id, JOURS.slice(0, -2)),
        diagnostic: diagnostic({ dernier: "2026-09-13", hierPresent: false, perime: true }),
      });
    }
    expect(qualiteMineursCotes(anciens, MAINTENANT).statut).toBe("perime");
  });

  it("seuil de péremption : J-1 en attente le matin n'alerte pas, trois jours sans ligne alertent", () => {
    const q = qualiteMineursCotes(tous(), MAINTENANT);
    // Le 17 à 10 h UTC, le 16 (nouvel J-1) n'est pas encore publié : dernière ligne le 15, pas d'alerte.
    expect(actualiserQualite(q, Date.UTC(2026, 8, 17, 10)).statut).toBe("frais");
    // Le 18 à 1 h UTC, ni le 16 ni le 17 : même seuil que `diagnostiquer` (dernier < aujourd'hui − 2 j).
    expect(actualiserQualite(q, Date.UTC(2026, 8, 18, 1)).statut).toBe("perime");
  });

  it("archive locale illisible remplacée (série prête avec raison) : ni motif d'échec ni raison de qualité", async () => {
    const { RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT } = await import("../../data/onchain/cryptoquant");
    const chargements = tous();
    chargements[serie("mara")] = chargement("mara", {
      raison: RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT,
      archive: archive("mara", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
    });
    const m = construireModeleMineurs(chargements, MAINTENANT);
    expect(m.lignes.find((l) => l.id === "mara")).toMatchObject({
      ligne: null,
      motif: "Aucune ligne publiée pour le 2026-09-15.",
    });
    const q = qualiteMineursCotes(chargements, MAINTENANT);
    expect(q.statut).toBe("partiel");
    expect(q.raison).toBe("8/9 sociétés au 2026-09-15.");
  });
});

const PROPS_VUE: PropsVueMineursCotes = {
  chargements: {},
  enCours: false,
  recues: 9,
  file: { enAttente: 0, repriseTs: null },
  now: MAINTENANT,
  onOuvrirReglages: () => {},
};
// renderToStaticMarkup échappe l'apostrophe.
const vue = (surcharge: Partial<PropsVueMineursCotes>): string =>
  renderToStaticMarkup(<VueMineursCotes {...PROPS_VUE} {...surcharge} />).replaceAll("&#x27;", "'");
const entete = (surcharge: Partial<PropsEnTeteMineursCotes>): string =>
  renderToStaticMarkup(<EnTeteMineursCotes ouvert={false} onBasculer={() => {}} {...PROPS_VUE} {...surcharge} />);
/** Raison d'une clé personnelle refusée (401), affichée telle quelle. */
const RAISON_REFUS = "Clé CryptoQuant refusée (Réglages ⚙).";

/** Neuf séries au même statut, sans archive. */
function sansArchive(statut: ChargementCq["statut"], raison: string): Chargements {
  const resultat: Chargements = {};
  for (const id of IDS_SOCIETES) {
    resultat[serie(id)] = chargement(id, {
      statut,
      raison,
      archive: null,
      diagnostic: diagnostic({ debut: null, dernier: null, hierPresent: false, perime: true }),
      appel: false,
    });
  }
  return resultat;
}

describe("production des mineurs cotés : vue, en-tête et conteneur", () => {
  beforeEach(() => vi.setSystemTime(MAINTENANT));
  afterEach(() => vi.useRealTimers());

  it("9/9 : neuf lignes triées par BTC J-1, valeurs brutes, Σ, courbe, archive et limites", () => {
    const html = vue({ chargements: tous() });
    expect(html.match(/role="row"/g)).toHaveLength(10); // en-tête + 9 sociétés ; la ligne Σ est hors tableau
    expect(html).not.toContain("<table");
    expect(html).toContain('title="MARA Holdings">MARA<');
    expect(html.indexOf(">MARA<")).toBeLessThan(html.indexOf(">CLSK<"));
    expect(html.indexOf(">CLSK<")).toBeLessThan(html.indexOf(">CORE<"));
    expect(html).toContain('title="coinbase 49.00 + autres 0.05 BTC">49.05<');
    expect(html).toContain("396.96");
    expect(html).toContain("$3.84M");
    expect(html).toContain("non publié");
    expect(html).toContain("123.00 BTC");
    expect(html).toContain(
      "2026-09-15 (J-1) · 9/9 sociétés · Σ 130.00 BTC/j · cumul mois Σ 1611.21 BTC · Σ $10.18M/j",
    );
    expect(html).toContain(">Σ 9<");
    expect(html).toContain(">1611.21<");
    expect(html).not.toContain("Σ partielle");
    expect(html).toContain("<svg");
    expect(html).toContain("Production Σ 9 sociétés");
    expect(html).toContain("Archive locale depuis 2026-08-17 · 30 j · 0 perdu");
    expect(html).not.toContain("J-1 en attente");
    expect(html).toContain("J-1 · CryptoQuant");
    expect(html).toContain("miner-data/companies (9 requêtes)");
    expect(html).toContain("périmètre non documenté");
    expect(html).toContain("sans daemon : vider le stockage du navigateur perd l'archive");
    expect(html).toContain("récupéré 2026-09-16");
    expect(html).not.toContain("cache ou observation périmé");
    expect(html).not.toContain("archive locale illisible");
    expect(html).not.toMatch(/\d %/); // aucun écart déclaré/observé en pourcentage
    expect(html).not.toContain("reçues");
  });

  it("chargement puis 7/9 en cours : progression du quota, tirets motivés, Σ partielle", () => {
    const vide = vue({ enCours: true, recues: 0 });
    expect(vide).toContain("0/9 reçues · chargement…");
    expect(vide).toContain("Chargement de la production des mineurs cotés…");
    const chargements = tous();
    delete chargements[serie("wulf")];
    delete chargements[serie("core")];
    const html = vue({ chargements, enCours: true, recues: 7, file: { enAttente: 2, repriseTs: null } });
    expect(html).toContain("7/9 reçues · en attente du quota CryptoQuant (10 req/min)");
    expect(html).toContain("Σ partielle 7/9");
    expect(html).not.toContain(">Σ 9<");
    expect(html).toContain('title="Série non encore reçue.">—<');
    expect(html.match(/role="row"/g)).toHaveLength(10);
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/>0\.00</);
  });

  it("échec d'une société : bandeau « archive servie », motif en infobulle, J-1 en attente", () => {
    const chargements = tous();
    chargements[serie("hive")] = chargement("hive", {
      statut: "quota",
      raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.",
      archive: archive("hive", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
    });
    const html = vue({ chargements });
    expect(html).toContain("archive servie");
    expect(html).toContain('title="Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.">—<');
    expect(html).toContain("Σ partielle 8/9");
    expect(html).toContain("J-1 en attente de publication (1/9)");
  });

  it("sans clé ni archive : SansCle avec le complément local, CTA d'en-tête, jamais de zéro", () => {
    const html = vue({ chargements: sansCle() });
    expect(html).toContain(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.",
    );
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("0.00");
    const tete = entete({ chargements: sansCle() });
    expect(tete).toContain("clé CryptoQuant ⚙");
    expect(tete).toContain("clé personnelle requise");
    // Archive existante sans clé : lignes servies avec « clé requise pour actualiser ».
    const avecArchive = tous();
    avecArchive[serie("mara")] = chargement("mara", {
      statut: "cle-requise",
      raison: RAISON_CLE_CRYPTOQUANT,
      archive: archive("mara", JOURS.slice(0, -1)),
      diagnostic: diagnostic({ dernier: "2026-09-14", hierPresent: false }),
      appel: false,
    });
    expect(vue({ chargements: avecArchive })).toContain("clé requise pour actualiser");
  });

  it("clé refusée (401) sans archive : raison telle quelle, bouton Réglages et CTA d'en-tête, sans complément .env", () => {
    const refus = sansArchive("cle-requise", RAISON_REFUS);
    const html = vue({ chargements: refus });
    expect(html).toContain(RAISON_REFUS);
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain("CRYPTOQUANT_API_KEY");
    expect(html).not.toContain('role="table"');
    const tete = entete({ chargements: refus });
    expect(tete).toContain("clé CryptoQuant ⚙");
    expect(tete).toContain("clé CryptoQuant refusée");
    expect(tete).not.toContain("clé personnelle requise");
  });

  it("offre refusée sans archive : motif du fournisseur, ni réglages ni valeur inventée", () => {
    const refus = sansArchive("offre", "Professional plan and above");
    const html = vue({ chargements: refus });
    expect(html).toContain("Professional plan and above");
    expect(html).not.toContain("Ouvrir les réglages");
    expect(html).not.toContain('role="table"');
    expect(entete({ chargements: refus })).not.toContain("clé CryptoQuant ⚙");
  });

  it("en-tête : bouton replié, état de collecte, CTA réservé aux séries « clé requise »", () => {
    const pret = entete({ chargements: tous() });
    expect(pret).toContain('aria-expanded="false"');
    expect(pret).toContain("Production des mineurs cotés ▸");
    expect(pret).toContain("archive 30 j · J-1 2026-09-15");
    expect(pret).not.toContain("clé CryptoQuant ⚙");
    expect(entete({ chargements: tous(), ouvert: true })).toContain('aria-expanded="true"');
    const quota = tous();
    quota[serie("mara")] = chargement("mara", {
      statut: "quota",
      raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 30 s.",
    });
    expect(entete({ chargements: quota })).not.toContain("clé CryptoQuant ⚙");
    const refusee = tous();
    refusee[serie("mara")] = chargement("mara", { statut: "cle-requise", raison: RAISON_REFUS });
    const avecRefus = entete({ chargements: refusee });
    expect(avecRefus).toContain("clé CryptoQuant ⚙");
    expect(avecRefus).toContain("archive 30 j · J-1 2026-09-15");
    expect(entete({ chargements: quota, file: { enAttente: 0, repriseTs: MAINTENANT + 42_000 } })).toContain("quota atteint, reprise 42 s");
    expect(entete({ chargements: tous(), file: { enAttente: 0, repriseTs: MAINTENANT + 42_000 } })).not.toContain("quota atteint");
    expect(entete({ enCours: true, recues: 2, file: { enAttente: 3, repriseTs: null } })).toContain(
      "2/9 reçues · en attente du quota",
    );
    expect(entete({ enCours: true, recues: 0 })).toContain("chargement…");
  });

  it("signaux d'archive : stockage plein, copie daemon non écrite, archive illisible remplacée, périmé", async () => {
    const { RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT } = await import("../../data/onchain/cryptoquant");
    const avecDaemon: Chargements = {};
    for (const id of IDS_SOCIETES) avecDaemon[serie(id)] = chargement(id, { persistance: { local: true, kv: true } });
    avecDaemon[serie("mara")] = chargement("mara", { persistance: { local: false, kv: true } });
    avecDaemon[serie("riot")] = chargement("riot", { persistance: { local: true, kv: false } });
    const html = vue({ chargements: avecDaemon });
    expect(html).toContain("archive non persistée localement (stockage plein)");
    expect(html).toContain("copie daemon non écrite");
    expect(html).not.toContain("sans daemon");
    expect(html).not.toContain("archive servie");
    expect(html).not.toContain("archive locale illisible remplacée");
    expect(html).not.toContain("cache ou observation périmé");

    const illisible = tous();
    illisible[serie("hive")] = chargement("hive", { raison: RAISON_ARCHIVE_ILLISIBLE_CRYPTOQUANT });
    const avecIllisible = vue({ chargements: illisible });
    expect(avecIllisible).toContain("archive locale illisible remplacée");
    expect(avecIllisible).not.toContain("archive servie");
    expect(avecIllisible).toContain(">Σ 9<");
    expect(entete({ chargements: illisible })).not.toContain("clé CryptoQuant ⚙");

    const anciens: Chargements = {};
    for (const id of IDS_SOCIETES) {
      anciens[serie(id)] = chargement(id, {
        archive: archive(id, JOURS.slice(0, -2)),
        diagnostic: diagnostic({ dernier: "2026-09-13", hierPresent: false, perime: true }),
      });
    }
    const perimee = vue({ chargements: anciens });
    expect(perimee).toContain("cache ou observation périmé");
    expect(perimee).toContain("2026-09-13 (J-3) · 9/9 sociétés");
    expect(perimee).toContain("J-1 en attente de publication (9/9)");
  });

  it("tri : BTC J-1 décroissant par défaut, tri imposé par le conteneur, en-têtes cliquables avec onTri", () => {
    const defaut = vue({ chargements: tous() });
    expect(defaut).not.toContain("<button");
    expect(defaut.indexOf(">MARA<")).toBeLessThan(defaut.indexOf(">CLSK<"));
    const parSociete = vue({ chargements: tous(), tri: { colonne: "societe", dir: 1 } });
    expect(parSociete.indexOf(">BITF<")).toBeLessThan(parSociete.indexOf(">CIPHER<"));
    expect(parSociete.indexOf(">CORE<")).toBeLessThan(parSociete.indexOf(">MARA<"));
    expect(parSociete.indexOf(">RIOT<")).toBeLessThan(parSociete.indexOf(">WULF<"));
    const cliquable = vue({ chargements: tous(), onTri: () => {} });
    expect(cliquable.match(/<button/g)).toHaveLength(5);
    expect(cliquable).toContain("BTC J-1<span>▾</span>");
    expect(vue({ chargements: tous(), tri: { colonne: "usd", dir: 1 }, onTri: () => {} })).toContain(
      "USD J-1<span>▴</span>",
    );
    // Une société sans ligne reste en fin de liste, quel que soit le sens.
    const partielle = tous();
    delete partielle[serie("bitf")];
    const croissant = vue({ chargements: partielle, tri: { colonne: "btc", dir: 1 } });
    expect(croissant.indexOf(">CORE<")).toBeLessThan(croissant.indexOf(">WULF<"));
    expect(croissant.indexOf(">MARA<")).toBeLessThan(croissant.indexOf(">BITF<"));
  });

  it("échec de l'import() du client (chunk introuvable) : libellé honnête, ni archive fausse ni en-tête muet", () => {
    // `chargements` reste vide : rien n'a été lu, contrairement à une archive réellement vide.
    const html = vue({ echecClient: true });
    expect(html).toContain("Client CryptoQuant non chargé (réseau ou mise à jour d'AXIOM) ; rechargez la page.");
    expect(html).not.toContain("Aucune ligne CryptoQuant archivée");
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("archive");
    const tete = entete({ echecClient: true });
    expect(tete).toContain("client CryptoQuant non chargé");
    expect(tete).not.toContain("clé CryptoQuant ⚙");
  });

  it("conteneur : sous-section repliée par défaut, aucun contenu rendu", () => {
    const html = renderToStaticMarkup(<MineursCotes onOuvrirReglages={() => {}} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Production des mineurs cotés");
    expect(html).not.toContain('role="table"');
    expect(html).not.toContain("Σ");
  });

  it("source : le client n'est chargé que par import(), client et module partagé importés en type seulement", () => {
    const source = readFileSync(new URL("./MineursCotes.tsx", import.meta.url), "utf8");
    expect(source).toContain('await import("../../data/onchain/cryptoquant")');
    const imports = source
      .split("\n")
      .filter((l) => /from "(?:\.\.\/)+(?:data\/onchain\/cryptoquant|shared\/cryptoquant-proxy)"/.test(l));
    expect(imports).toHaveLength(2);
    expect(imports.every((l) => l.startsWith("import type "))).toBe(true);
  });
});

describe("section Mineurs : emplacement de la production des mineurs cotés", () => {
  it("les enfants de VueMineurs sont rendus avant la note de source", () => {
    const html = renderToStaticMarkup(
      <VueMineurs hashrate={null} revenus={null}>
        <p>sous-section-test</p>
      </VueMineurs>,
    );
    expect(html).toContain("sous-section-test");
    expect(html.indexOf("sous-section-test")).toBeLessThan(html.indexOf("Hash Ribbons : capitulation"));
  });

  it("le conteneur Mineurs monte la sous-section seulement fenêtre ouverte", () => {
    expect(renderToStaticMarkup(<Mineurs open hashrate={null} />)).toContain("Production des mineurs cotés");
    expect(renderToStaticMarkup(<Mineurs open={false} hashrate={null} />)).not.toContain(
      "Production des mineurs cotés",
    );
  });
});
