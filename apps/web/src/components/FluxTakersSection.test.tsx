import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArchiveCq, ChargementCq, DiagnosticCq, LigneTaker, SerieCq } from "../data/onchain/cryptoquant";
import { RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";
import { cryptoquantUiStore } from "../store/cryptoquantUi";
import {
  RAISON_CREDITS_EPUISES_CQ,
  resumeEnTeteFluxTakers,
  SectionFluxTakers,
  VueFluxTakers,
  type PropsVueFluxTakers,
} from "./FluxTakersSection";

// Espion d'évaluation du client CryptoQuant : la fabrique ne s'exécute qu'à l'import RÉEL du
// module. Ce fichier n'en importe que des types (effacés) et le rendu statique ne lance aucun
// effet : un import statique ajouté par erreur dans la section la déclencherait dès le
// chargement de ce test.
const { clientEvalue } = vi.hoisted(() => ({ clientEvalue: vi.fn() }));
vi.mock("../data/onchain/cryptoquant", async (importOriginal) => {
  clientEvalue();
  return importOriginal<typeof import("../data/onchain/cryptoquant")>();
});

const JOUR_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 16, 12);
/**
 * Raisons produites par le client (tâche 13), recopiées en littéraux : importer leur VALEUR
 * évaluerait le client et ferait échouer le test « client jamais évalué ».
 */
const RAISON_REFUSEE = "Clé CryptoQuant refusée (Réglages ⚙).";
const RAISON_ILLISIBLE = "Archive locale CryptoQuant illisible : remplacée à la prochaine écriture.";
const RAISON_VERSION = "Archive CryptoQuant écrite par une version plus récente d'AXIOM : ni lue ni réécrite.";
/**
 * Plafond de crédits (§13) : raison VARIABLE (la somme consommée), non recopiée dans la vue, qui
 * la reconnaît « par défaut » — tout `credits` dont la raison n'est pas celle du 402. La raison du
 * 402, elle, vient du littéral EXPORTÉ par la vue (`raisonsCreditsCq.test.ts` le compare au client).
 */
const RAISON_BUDGET_CREDITS =
  "Budget de crédits CryptoQuant atteint (≈ 8990/10 000 sur 31 j, ce navigateur) : appels suspendus pour préserver le mois ; archive affichée.";
const jourIso = (t: number) => new Date(t).toISOString().slice(0, 10);

function ligne(p: Partial<LigneTaker> = {}): LigneTaker {
  return {
    n: 1_000_000,
    bv: 150_000,
    qv: 11_500_000_000,
    bbv: 75_000,
    qbv: 6_000_000_000,
    bsv: 75_000,
    qsv: 6_050_000_000,
    vwap: 76_000,
    br: 0.5,
    bsr: 1,
    bc: 500_000,
    sc: 500_000,
    ...p,
  };
}

function archive(
  serie: SerieCq,
  debut: string,
  fin: string,
  exclus: readonly string[] = [],
  surcharges: Record<string, Partial<LigneTaker>> = {},
): ArchiveCq {
  const jours: Record<string, LigneTaker> = {};
  for (let t = Date.parse(`${debut}T00:00:00Z`); t <= Date.parse(`${fin}T00:00:00Z`); t += JOUR_MS) {
    const j = jourIso(t);
    if (!exclus.includes(j)) jours[j] = ligne(surcharges[j]);
  }
  return { version: 1, serie, majTs: Date.UTC(2026, 8, 16, 6), jours };
}

/** Ligne réelle du sondage (spot BTC, 2026-09-15). */
const DERNIER: Partial<LigneTaker> = {
  n: 12_099_486,
  bv: 156_928.13,
  qv: 12_007_360_401.32,
  bbv: 77_681.2,
  qbv: 5_944_281_632.44,
  bsv: 79_246.93,
  qsv: 6_063_078_768.88,
  vwap: 76_515.03,
  br: 0.495,
  bsr: 0.9802,
  bc: 6_133_017,
  sc: 5_966_469,
};

const ARCHIVE_SPOT_BTC = archive("taker:spot:btc", "2026-08-17", "2026-09-15", ["2026-09-01", "2026-09-02"], {
  "2026-09-15": DERNIER,
});
const DIAG_SPOT_BTC: DiagnosticCq = {
  debut: "2026-08-17",
  dernier: "2026-09-15",
  hierPresent: true,
  manquantsFenetre: ["2026-09-01", "2026-09-02"],
  perdus: [],
  perime: false,
};
const DIAG_VIDE: DiagnosticCq = {
  debut: null,
  dernier: null,
  hierPresent: false,
  manquantsFenetre: [],
  perdus: [],
  perime: true,
};

function chargement(serie: SerieCq, p: Partial<ChargementCq> = {}): ChargementCq {
  return {
    serie,
    statut: "pret",
    raison: null,
    archive: null,
    diagnostic: DIAG_VIDE,
    persistance: { local: true, kv: null },
    appel: false,
    ...p,
  };
}

const PRET = chargement("taker:spot:btc", { archive: ARCHIVE_SPOT_BTC, diagnostic: DIAG_SPOT_BTC, appel: true });

function props(p: Partial<PropsVueFluxTakers> = {}): PropsVueFluxTakers {
  return {
    chargements: { "taker:spot:btc": PRET },
    selection: { actif: "btc", marche: "spot" },
    onSelection: () => undefined,
    enCours: false,
    recues: 4,
    attendues: 4,
    file: { enAttente: 0, repriseTs: null },
    now: NOW,
    onOuvrirReglages: () => undefined,
    ...p,
  };
}

const rendre = (p: Partial<PropsVueFluxTakers> = {}) => renderToStaticMarkup(<VueFluxTakers {...props(p)} />);

describe("section DES « Flux takers toutes places »", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("tuiles nominales : ratio, part acheteurs, Δ taker, volumes, VWAP, courbe, archive et limites", () => {
    const html = rendre();
    expect(html).toContain("Ratio taker achat/vente");
    expect(html).toContain('text-sm font-medium text-down">0.98<');
    expect(html).toContain("J-1 · CryptoQuant");
    expect(html).toContain("acheteurs 49.5 % · 28 j archivés : min 0.98 · méd. 1.00 · max 1.00 · 1ᵉʳ plus bas");
    expect(html).toContain("−$118.80M");
    expect(html).toContain("7 j −$418.80M (7/7 j)");
    expect(html).toContain("$12.01B");
    expect(html).toContain("Volume base 156.93K BTC");
    expect(html).toContain("12.10M trades · vs méd. 30 j +4.4%");
    expect(html).toContain("VWAP agrégé");
    expect(html).toContain("$76,515.03");
    expect(html).toContain("<svg");
    expect(html).toContain("observation 2026-09-15 (J-1) · récupéré 2026-09-16");
    expect(html).toContain("Archive locale depuis 2026-08-17 · 28 j archivés · 2 manquants dans la fenêtre · 0 perdu");
    expect(html).toContain("Manquants (récupérables sous 30 j) : 2026-09-01, 2026-09-02");
    expect(html).toContain("composition non documentée");
    expect(html).toContain("licence personnelle");
    expect(html).toContain("fenêtre 30 j sans rattrapage");
    // Sans daemon (kv null) : la perte possible de l'archive est dite, discrètement.
    expect(html).toContain("sans daemon : vider le stockage du navigateur perd l&#x27;archive");
    expect(html).toContain('aria-label="Actif des flux takers"');
    expect(html).toContain('aria-label="Marché des flux takers"');
    expect(html).not.toContain("J-1 en attente de publication");
    expect(html).not.toContain("périmé");
    expect(html).not.toContain("clé requise pour actualiser");
    expect(html).not.toContain("stockage plein");
    expect(html).not.toContain("copie daemon non écrite");
    expect(html).not.toContain("illisible");
    expect(html).not.toContain("border-down/40");
    expect(html).not.toContain("<table");
  });

  it("ton up quand le ratio est au moins 1", () => {
    const haussier = archive("taker:spot:btc", "2026-08-17", "2026-09-15", [], { "2026-09-15": { bsr: 1.05 } });
    const html = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { archive: haussier, diagnostic: DIAG_SPOT_BTC }) },
    });
    expect(html).toContain('text-sm font-medium text-up">1.05<');
    expect(html).not.toContain('text-sm font-medium text-down">1.05<');
  });

  it("J-1 non publié : en attente, jamais compté en trou ; perdus définitifs", () => {
    const perdus = Array.from({ length: 14 }, (_, i) => jourIso(Date.UTC(2026, 7, 3) + i * JOUR_MS));
    const ancienne = archive("taker:spot:btc", "2026-07-20", "2026-09-14", perdus);
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", {
          archive: ancienne,
          diagnostic: { debut: "2026-07-20", dernier: "2026-09-14", hierPresent: false, manquantsFenetre: [], perdus, perime: false },
        }),
      },
    });
    expect(html).toContain("observation 2026-09-14 · récupéré 2026-09-16");
    expect(html).not.toContain("(J-1)");
    expect(html).toContain("0 manquant dans la fenêtre · 14 perdus (définitifs) · J-1 en attente de publication");
    expect(html).toContain("Perdus (hors fenêtre fournisseur) : 2026-08-03");
  });

  it("observation périmée : badge dédié au-dessus des tuiles", () => {
    const html = rendre({
      chargements: { "taker:spot:btc": { ...PRET, diagnostic: { ...DIAG_SPOT_BTC, perime: true } } },
    });
    expect(html).toContain("cache ou observation périmé");
    expect(html).toContain("0.98");
  });

  it("signaux de persistance : stockage plein et copie daemon non écrite, jamais silencieux", () => {
    const sansEcriture = rendre({
      chargements: { "taker:spot:btc": { ...PRET, persistance: { local: false, kv: false } } },
    });
    expect(sansEcriture).toContain("archive non persistée localement (stockage plein)");
    expect(sansEcriture).toContain("copie daemon non écrite");
    expect(sansEcriture).not.toContain("sans daemon");
    expect(sansEcriture).toContain("0.98");
    const avecDaemon = rendre({
      chargements: { "taker:spot:btc": { ...PRET, persistance: { local: true, kv: true } } },
    });
    expect(avecDaemon).not.toContain("stockage plein");
    expect(avecDaemon).not.toContain("copie daemon non écrite");
    expect(avecDaemon).not.toContain("sans daemon");
  });

  it("archive illisible remplacée : raison non nulle sur « pret », badge sans bandeau d'erreur", () => {
    const p = props({ chargements: { "taker:spot:btc": { ...PRET, raison: RAISON_ILLISIBLE } } });
    const html = renderToStaticMarkup(<VueFluxTakers {...p} />);
    expect(html).toContain("archive locale illisible remplacée");
    expect(html).toContain(`title="${RAISON_ILLISIBLE}"`);
    expect(html).not.toContain("border-down/40");
    expect(html).toContain("0.98");
    expect(resumeEnTeteFluxTakers(p)).toBe("archive 28 j · J-1 2026-09-15");
  });

  it("perp : mène avec le volume quote, base et VWAP en infobulle avec la limite fournisseur", () => {
    const perp = archive("taker:swap:eth", "2026-09-10", "2026-09-15", [], {
      "2026-09-15": { bsr: 1.1234, qv: 27_800_000_000, bv: 11_300_000, vwap: 2_450.5 },
    });
    const html = rendre({
      selection: { actif: "eth", marche: "swap" },
      chargements: { "taker:swap:eth": chargement("taker:swap:eth", { archive: perp, diagnostic: DIAG_SPOT_BTC }) },
    });
    expect(html).toContain("1.12");
    expect(html).toContain("$27.80B");
    expect(html).toContain("Volume base 11.30M ETH · VWAP $2,450.50 — unités fournisseur, champ inverse non documenté");
    expect(html).toContain("champ inverse non documenté");
    expect(html).not.toContain("VWAP agrégé");
  });

  it("chargement puis partiel : progression visible, jamais un chargement muet", () => {
    expect(rendre({ chargements: {}, enCours: true, recues: 0 })).toContain("Chargement des flux takers…");
    const partiel = rendre({
      selection: { actif: "eth", marche: "spot" },
      enCours: true,
      recues: 2,
      file: { enAttente: 2, repriseTs: null },
    });
    expect(partiel).toContain("2/4 reçues · en attente du quota CryptoQuant (10 req/min)");
    expect(partiel).toContain("Chargement des flux takers…");
  });

  it("quota, offre, erreur, version inconnue : bandeau au-dessus de l'archive servie", () => {
    const quota = rendre({
      chargements: {
        "taker:spot:btc": { ...PRET, statut: "quota", raison: "Quota CryptoQuant atteint (429) ; nouvel essai dans 42 s." },
      },
    });
    expect(quota).toContain("nouvel essai dans 42 s");
    expect(quota).toContain("border-down/40");
    expect(quota).toContain("0.98");
    const offre = rendre({ chargements: { "taker:spot:btc": { ...PRET, statut: "offre", raison: "Professional plan and above" } } });
    expect(offre).toContain("Professional plan and above");
    expect(offre).toContain("$12.01B");
    const erreur = rendre({
      chargements: { "taker:spot:btc": { ...PRET, statut: "erreur", raison: "CryptoQuant injoignable ; archive affichée." } },
    });
    expect(erreur).toContain("CryptoQuant injoignable ; archive affichée.");
    expect(erreur).toContain("Archive locale depuis 2026-08-17");
    // Archive d'une version future : erreur sans archive servie, zéro appel côté client.
    const version = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "erreur", raison: RAISON_VERSION }) },
    });
    expect(version).toContain("écrite par une version plus récente d&#x27;AXIOM");
    expect(version).toContain("border-down/40");
    expect(version).toContain("Série non encore archivée.");
  });

  it("crédits (§13) : 402 et plafond — en-tête distinct, bandeau = raison, archive servie, aucun CTA", () => {
    const avecRaison = (raison: string, appel: boolean): Partial<PropsVueFluxTakers> => ({
      chargements: { "taker:spot:btc": { ...PRET, statut: "credits", raison, appel } },
    });
    // 402 : raison fixe du client, bandeau d'erreur au-dessus de l'archive servie.
    const epuises = rendre(avecRaison(RAISON_CREDITS_EPUISES_CQ, true)).replaceAll("&#x27;", "'");
    expect(epuises).toContain(RAISON_CREDITS_EPUISES_CQ);
    expect(epuises).toContain("border-down/40");
    expect(epuises).toContain("0.98");
    expect(epuises).not.toContain("Ouvrir les réglages");
    expect(epuises).not.toContain("clé requise pour actualiser");
    // Plafond local : raison variable (somme entière), même traitement.
    const budget = rendre(avecRaison(RAISON_BUDGET_CREDITS, false));
    expect(budget).toContain("Budget de crédits CryptoQuant atteint (≈ 8990/10 000 sur 31 j, ce navigateur)");
    expect(budget).toContain("border-down/40");
    expect(budget).toContain("$12.01B");
    // Sans archive : la raison du client annonce « archive affichée » — variante LOCALE, comme
    // `ERREUR_SANS_ARCHIVE`, sinon le bandeau promet une archive que le corps dit absente.
    const sansArchive = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", { statut: "credits", raison: RAISON_CREDITS_EPUISES_CQ, appel: true }),
      },
    }).replaceAll("&#x27;", "'");
    expect(sansArchive).toContain("Crédits CryptoQuant épuisés (402) ; aucune archive locale.");
    expect(sansArchive).not.toContain("archive affichée");
    expect(sansArchive).toContain("Série non encore archivée.");
    // Quatrième case de la matrice libellé × archive : plafond sans archive.
    const budgetSansArchive = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", { statut: "credits", raison: RAISON_BUDGET_CREDITS }),
      },
    });
    expect(budgetSansArchive).toContain("Budget de crédits CryptoQuant atteint ; aucune archive locale.");
    expect(budgetSansArchive).not.toContain("8990");
    expect(budgetSansArchive).not.toContain("archive affichée");
    expect(budgetSansArchive).toContain("Série non encore archivée.");
    expect(budgetSansArchive).not.toContain("Ouvrir les réglages");
    // En-tête : le 402 se distingue du plafond ; `credits` passe devant le texte d'archive.
    expect(resumeEnTeteFluxTakers(props(avecRaison(RAISON_CREDITS_EPUISES_CQ, true)))).toBe("crédits CryptoQuant épuisés");
    expect(resumeEnTeteFluxTakers(props(avecRaison(RAISON_BUDGET_CREDITS, false)))).toBe("budget de crédits atteint");
    // Une série en attente de quota reste prioritaire (l'ordre des branches ne change pas).
    expect(
      resumeEnTeteFluxTakers(props({ ...avecRaison(RAISON_CREDITS_EPUISES_CQ, true), enCours: true, recues: 1, file: { enAttente: 3, repriseTs: null } })),
    ).toBe("1/4 reçues · en attente du quota");
  });

  it("sans clé et archive vide : SansCle avec le repli local et le lien Réglages", () => {
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise", raison: RAISON_CLE_CRYPTOQUANT }),
      },
    });
    expect(html).toContain(
      "Clé CryptoQuant personnelle requise (Réglages ⚙) — ou CRYPTOQUANT_API_KEY dans apps/web/.env pour le proxy Vite et le daemon.",
    );
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain("Ratio taker achat/vente");
  });

  it("clé refusée (401) et archive vide : raison telle quelle, lien Réglages, sans repli .env", () => {
    const html = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise", raison: RAISON_REFUSEE }) },
    });
    expect(html).toContain("Clé CryptoQuant refusée (Réglages ⚙).");
    expect(html).toContain("Ouvrir les réglages ⚙");
    expect(html).not.toContain("CRYPTOQUANT_API_KEY");
    expect(html).not.toContain("licence personnelle, aucun repli serveur");
  });

  it("sans clé mais archive présente : tuiles servies et badge « clé requise pour actualiser »", () => {
    const html = rendre({
      chargements: { "taker:spot:btc": { ...PRET, statut: "cle-requise", raison: RAISON_CLE_CRYPTOQUANT } },
    });
    expect(html).toContain("clé requise pour actualiser");
    expect(html).toContain("0.98");
    expect(html).not.toContain("Ouvrir les réglages");
    expect(html).not.toContain("illisible");
  });

  it("erreur après appel sans archive : bandeau local « aucune archive locale », jamais « archive affichée »", () => {
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", {
          statut: "erreur",
          raison: "CryptoQuant injoignable ; archive affichée.",
          appel: true,
        }),
      },
    });
    expect(html).toContain("CryptoQuant injoignable ; aucune archive locale.");
    expect(html).not.toContain("archive affichée");
    expect(html).toContain("border-down/40");
    expect(html).toContain("Série non encore archivée.");
    // Avec une archive servie, la raison du client reste exacte et s'affiche telle quelle.
    const avecArchive = rendre({
      chargements: {
        "taker:spot:btc": { ...PRET, statut: "erreur", raison: "CryptoQuant injoignable ; archive affichée." },
      },
    });
    expect(avecArchive).toContain("CryptoQuant injoignable ; archive affichée.");
    expect(avecArchive).not.toContain("aucune archive locale");
  });

  it("échec de l'import() du client (chunk introuvable) : libellé honnête dans la vue et l'en-tête", () => {
    // `chargements` reste vide : rien n'a été lu, contrairement à une série réellement non archivée.
    const html = rendre({ chargements: {}, enCours: false, echecClient: true }).replaceAll("&#x27;", "'");
    expect(html).toContain("Client CryptoQuant non chargé (réseau ou mise à jour d'AXIOM) ; rechargez la page.");
    expect(html).not.toContain("non encore archivée");
    expect(html).toContain('aria-label="Actif des flux takers"');
    expect(resumeEnTeteFluxTakers(props({ chargements: {}, enCours: false, echecClient: true }))).toBe(
      "client CryptoQuant non chargé",
    );
    // Sans échec du client, une série absente reste « non encore archivée » dans l'en-tête.
    expect(resumeEnTeteFluxTakers(props({ chargements: {}, enCours: false }))).toBe("série non encore archivée");
  });

  it("horloge vivante : « J-1 » de l'en-tête et du corps suit l'heure du rendu, pas celle du chargement", () => {
    // Même chargement (diagnostic calculé le 16), rendu le 18 à 10 h UTC : le 15 n'est plus J-1.
    const plusTard = Date.UTC(2026, 8, 18, 10);
    expect(resumeEnTeteFluxTakers(props({ now: plusTard }))).toBe("archive 28 j · dernier 2026-09-15");
    const html = rendre({ now: plusTard });
    expect(html).toContain("observation 2026-09-15 · récupéré 2026-09-16");
    expect(html).not.toContain("(J-1)");
    expect(html).toContain("J-1 en attente de publication");
    // Conteneur : horloge partagée, et une nouvelle passe au seul changement de jour UTC.
    const source = readFileSync(new URL("./FluxTakersSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("const now = useHorloge();");
    expect(source).toContain("}, [version, jourCourant]);");
    expect(source).not.toContain("setNow(");
  });

  it("légende de la courbe : min et max des données, jamais la plage d'axe forcée à 1.00", () => {
    const ratios: Record<string, Partial<LigneTaker>> = {
      "2026-09-10": { bsr: 1.02 },
      "2026-09-11": { bsr: 1.04 },
      "2026-09-12": { bsr: 1.1 },
      "2026-09-13": { bsr: 1.05 },
      "2026-09-14": { bsr: 1.03 },
      "2026-09-15": { bsr: 1.06 },
    };
    const hausse = archive("taker:spot:btc", "2026-09-10", "2026-09-15", [], ratios);
    const html = rendre({
      chargements: { "taker:spot:btc": chargement("taker:spot:btc", { archive: hausse, diagnostic: DIAG_SPOT_BTC }) },
    });
    expect(html).toMatch(/min 1\.02 · méd\. [\d.]+ · max 1\.10/);
    expect(html).toContain("1.02 → 1.10");
    expect(html).not.toContain("1.00 → 1.10");
    // Le pointillé à 1.00 reste tracé : l'axe, lui, inclut toujours 1.00.
    expect(html).toContain('stroke-dasharray="3 3"');
  });

  it("série sélectionnée absente : « Série non encore archivée. »", () => {
    expect(rendre({ chargements: {}, enCours: false })).toContain("Série non encore archivée.");
    const sansArchive = rendre({ chargements: { "taker:spot:btc": chargement("taker:spot:btc") } });
    expect(sansArchive).toContain("Série non encore archivée.");
    expect(sansArchive).not.toContain("périmé");
  });

  it("jamais « 0 » pour une valeur absente : cumul, situation et médiane incomplets", () => {
    const seul = archive("taker:spot:btc", "2026-09-15", "2026-09-15", [], { "2026-09-15": DERNIER });
    const html = rendre({
      chargements: {
        "taker:spot:btc": chargement("taker:spot:btc", {
          archive: seul,
          diagnostic: { debut: "2026-09-15", dernier: "2026-09-15", hierPresent: true, manquantsFenetre: [], perdus: [], perime: false },
        }),
      },
    });
    expect(html).toContain("7 j — (1/7 j)");
    expect(html).toContain("acheteurs 49.5 % · archive trop courte pour situer le ratio");
    expect(html).toContain("vs méd. 30 j —");
    expect(html).not.toContain("$0");
    expect(html).not.toContain("+0.0%");
    expect(html).not.toContain("min 0");
  });

  it("résumé d'en-tête : chargement, partiel, quota, clé, archive", () => {
    expect(resumeEnTeteFluxTakers(props({ chargements: {}, enCours: true, recues: 0 }))).toBe("chargement…");
    expect(resumeEnTeteFluxTakers(props({ enCours: true, recues: 2, file: { enAttente: 2, repriseTs: null } }))).toBe(
      "2/4 reçues · en attente du quota",
    );
    expect(
      resumeEnTeteFluxTakers(
        props({
          chargements: { "taker:spot:btc": { ...PRET, statut: "quota" } },
          file: { enAttente: 0, repriseTs: NOW + 42_000 },
        }),
      ),
    ).toBe("quota atteint, reprise 42 s");
    expect(
      resumeEnTeteFluxTakers(
        props({ chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise" }) } }),
      ),
    ).toBe("clé personnelle requise");
    expect(
      resumeEnTeteFluxTakers(
        props({ chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "cle-requise", raison: RAISON_REFUSEE }) } }),
      ),
    ).toBe("clé CryptoQuant refusée");
    expect(resumeEnTeteFluxTakers(props())).toBe("archive 28 j · J-1 2026-09-15");
    // Version inconnue : erreur sans archive ET sans appel réseau (le client court-circuite
    // avant toute requête) — l'en-tête ne doit pas prétendre à une panne réseau.
    expect(
      resumeEnTeteFluxTakers(
        props({
          chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "erreur", raison: RAISON_VERSION }) },
        }),
      ),
    ).toBe("erreur CryptoQuant");
    // Erreur réseau sans archive (appel réellement parti) : « injoignable » est honnête ici.
    expect(
      resumeEnTeteFluxTakers(
        props({ chargements: { "taker:spot:btc": chargement("taker:spot:btc", { statut: "erreur", appel: true }) } }),
      ),
    ).toBe("CryptoQuant injoignable");
  });

  it("section repliée par défaut : bouton seul, aucun contenu, client jamais évalué", () => {
    const html = renderToStaticMarkup(<SectionFluxTakers onOuvrirReglages={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Flux takers toutes places (quotidien · CryptoQuant)");
    expect(html).toContain("chargement…");
    expect(html).not.toContain("Ratio taker");
    expect(html).not.toContain("Archive locale");
    expect(clientEvalue).not.toHaveBeenCalled();
  });
});

/**
 * Entrée CQTAKR (menu « Fonctions » et ⌘K, décision du propriétaire du 2026-09-18) : la
 * demande vit dans `cryptoquantUiStore`. Les effets ne s'exécutent JAMAIS en environnement
 * node (`renderToStaticMarkup`) : l'ouverture est donc DÉRIVÉE au rendu, ce que ce bloc
 * vérifie — la section visée est déjà dépliée au PREMIER rendu, sans attendre d'effet.
 */
describe("dépliage demandé par l'entrée CQTAKR", () => {
  afterEach(() => {
    cryptoquantUiStore.setState({ cible: null });
  });

  it("cible « takers » : section dépliée et contenu rendu au premier rendu", () => {
    cryptoquantUiStore.setState({ cible: "takers" });
    const html = renderToStaticMarkup(<SectionFluxTakers onOuvrirReglages={() => undefined} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Actif des flux takers");
    expect(html).toContain("Chargement des flux takers…");
  });

  it("cible « mineurs » : la section DES reste repliée (la demande visait CHAIN)", () => {
    cryptoquantUiStore.setState({ cible: "mineurs" });
    const html = renderToStaticMarkup(<SectionFluxTakers onOuvrirReglages={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Actif des flux takers");
  });

  it("cible nulle : section repliée (aucune demande en cours)", () => {
    expect(cryptoquantUiStore.getState().cible).toBeNull();
    const html = renderToStaticMarkup(<SectionFluxTakers onOuvrirReglages={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
  });

  it("le dépliage ne charge rien de plus : le client reste non évalué", () => {
    cryptoquantUiStore.setState({ cible: "takers" });
    renderToStaticMarkup(<SectionFluxTakers onOuvrirReglages={() => undefined} />);
    expect(clientEvalue).not.toHaveBeenCalled();
  });
});
