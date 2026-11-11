import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { analyserAttention, JOUR_MS, type AnalyseAttention, type ResultatAttentionWiki } from "../../data/attentionWiki";
import { VueAttentionWiki, type EtatAttentionWiki } from "./AttentionWiki";

const jour = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const MAINTENANT = Date.parse("2026-11-07T12:00:00Z");
const rien = (): void => undefined;

function resultat(actif: string, titre: string, perime = false): ResultatAttentionWiki {
  return { actif, edition: "en", titre, serie: { debut: jour("2023-11-07"), vues: [] }, recupereLe: MAINTENANT - 60_000, perime };
}

function analyse(partiel: Partial<AnalyseAttention> = {}): AnalyseAttention {
  return {
    dernierJour: jour("2026-11-06"),
    connuLe: jour("2026-11-07"),
    vuesDernierJour: 48_210,
    z90: 2.4,
    z365: 3.41,
    niveau: "pic",
    ratio7j90j: 1.87,
    pics: [
      { jour: jour("2025-03-02"), connuLe: jour("2025-03-03"), disponibleLe: jour("2025-03-04"), z: 3.2, vues: 90_000 },
      { jour: jour("2026-10-20"), connuLe: jour("2026-10-21"), disponibleLe: jour("2026-10-22"), z: 3.6, vues: 110_000 },
    ],
    picsSur365j: 1,
    joursZ365Mesures: 365,
    couverture: { joursMesures: 1095, joursAttendus: 1096 },
    ...partiel,
  };
}

function rendre(etat: EtatAttentionWiki, actif = "BTC", edition: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(
    <VueAttentionWiki
      actif={actif}
      edition={edition}
      etat={etat}
      maintenant={MAINTENANT}
      onActif={rien}
      onEdition={rien}
      onReessayer={rien}
    />,
  );
}

/** Valeur affichée par la tuile de libellé `label` (premier span « tabular-nums » qui suit). */
function valeurTuile(html: string, label: string): string | undefined {
  const debut = html.indexOf(`>${label}</span>`);
  if (debut < 0) return undefined;
  return /tabular-nums[^>]*>([^<]*)</.exec(html.slice(debut))?.[1];
}

/** HTML de la tuile de libellé `label` (jusqu'à la tuile suivante). */
function htmlTuile(html: string, label: string): string {
  const debut = html.indexOf(`>${label}</span>`);
  const suite = html.indexOf("axiom-tuile-stat", debut);
  return html.slice(debut, suite < 0 ? undefined : suite);
}

const LABEL_PICS = "Épisodes &gt; 3σ · 365 j";

describe("section Attention grand public de CYCLE", () => {
  it("affiche les tuiles BTC, les libellés « descriptif » et « Source : Wikimedia (CC0) »", () => {
    const html = rendre({ statut: "pret", resultat: resultat("BTC", "Bitcoin"), analyse: analyse(), relative: null, erreurBtc: null });
    expect(html).toContain("Attention grand public · Wikipédia");
    expect(html).toContain("descriptif");
    expect(html).toContain("Source : Wikimedia (CC0)");
    expect(html).toContain("« Bitcoin » (en.wikipedia)");
    expect(html).toContain("48");
    expect(html).toContain("2026-11-06");
    expect(html).toContain("publié au plus tôt le 2026-11-07");
    expect(html).toContain("3.41");
    expect(html).toContain("pic &gt; 3σ");
    expect(html).toContain("z 90 j 2.40");
    expect(html).toContain("couverture");
    expect(html).toContain("×1.87");
    expect(html).toContain("dernier pic 2026-10-20");
    expect(html).toContain("2026-10-20 z 3.6");
    // L'épisode de 2025 sort des 365 derniers jours de l'infobulle.
    expect(html).not.toContain("2025-03-02 z");
    expect(html).toContain("jour en cours n&#x27;est jamais montré");
    expect(html).toContain("non signé");
    // BTC : pas de comparaison à lui-même.
    expect(html).not.toContain("Vues vs Bitcoin");
  });

  it("donnée non mesurable : « non mesuré », jamais 0", () => {
    const html = rendre({
      statut: "pret",
      resultat: resultat("BTC", "Bitcoin"),
      analyse: analyse({ z365: null, z90: null, niveau: null, ratio7j90j: null, pics: [], picsSur365j: null, joursZ365Mesures: 0 }),
      relative: null,
      erreurBtc: null,
    });
    expect(html).toContain("non mesuré");
    expect(html).toContain("aucun pic mesuré");
    expect(html).not.toContain("pic &gt; 3σ</span>");
    // Le décompte des pics n'est pas un 0 inventé quand le z 365 j n'est mesuré sur aucun jour de l'année.
    expect(valeurTuile(html, LABEL_PICS)).toBe("non mesuré");
    // Infobulle (attribut `title` de la tuile, placé avant le libellé).
    expect(html).toContain("z 365 j mesuré sur aucun des 365 derniers jours (historique ou couverture insuffisants) : pas de décompte");
  });

  it("historique court réel (200 j) : la tuile des pics affiche « non mesuré », pas 0", () => {
    const vues = Array.from({ length: 200 }, (_, i) => 40_000 + (i % 7) * 900);
    const a = analyserAttention({ debut: jour("2026-11-06") - 199 * JOUR_MS, vues });
    const html = rendre({ statut: "pret", resultat: resultat("BTC", "Bitcoin"), analyse: a, relative: null, erreurBtc: null });
    expect(valeurTuile(html, LABEL_PICS)).toBe("non mesuré");
    expect(valeurTuile(html, "z 365 j · log des vues")).toBe("non mesuré");
    expect(htmlTuile(html, LABEL_PICS)).not.toContain("j mesurés");
  });

  it("z 365 j mesuré sur une partie de l'année : décompte affiché avec sa couverture", () => {
    const html = rendre({
      statut: "pret",
      resultat: resultat("BTC", "Bitcoin"),
      analyse: analyse({ pics: [], picsSur365j: 0, joursZ365Mesures: 135 }),
      relative: null,
      erreurBtc: null,
    });
    expect(valeurTuile(html, LABEL_PICS)).toBe("0");
    const tuile = htmlTuile(html, LABEL_PICS);
    expect(tuile).toContain("sur 135/365 j mesurés");
    expect(html).toContain("sur les 135 jours mesurés de l&#x27;année");
    // Année complète : pas de mention de couverture partielle.
    const complet = rendre({ statut: "pret", resultat: resultat("BTC", "Bitcoin"), analyse: analyse(), relative: null, erreurBtc: null });
    expect(valeurTuile(complet, LABEL_PICS)).toBe("1");
    expect(htmlTuile(complet, LABEL_PICS)).not.toContain("j mesurés");
  });

  it("épisode commencé avant l'année et prolongé dedans : « aucun nouvel épisode », pas « aucun jour au-delà de 3σ »", () => {
    // Vues × 20 du jour 420 au jour 445 ; lecture au jour 800 : l'épisode commence avant la
    // fenêtre d'un an (jours 436 à 800) et se prolonge dedans (jours 436 à 445).
    const vues = Array.from({ length: 801 }, (_, i) => (i >= 420 && i <= 445 ? 20 : 1) * (40_000 + (i % 7) * 900));
    const debut = jour("2026-11-06") - 800 * JOUR_MS;
    const a = analyserAttention({ debut, vues });
    expect(a.pics.map((p) => (p.jour - debut) / JOUR_MS)).toEqual([420]);
    expect(a.picsSur365j).toBe(0);
    const html = rendre({ statut: "pret", resultat: resultat("BTC", "Bitcoin"), analyse: a, relative: null, erreurBtc: null });
    expect(html).toContain("Aucun nouvel épisode (premier jour au-delà de 3σ, z 365 j)");
    expect(html).not.toContain("Aucun jour au-delà");
  });

  it("alt : série BTC resservie d'un cache périmé et en retard → badge et jour commun affichés", () => {
    const html = rendre(
      {
        statut: "pret",
        resultat: resultat("ETH", "Ethereum"),
        analyse: analyse({ niveau: "normale", z365: 0.4 }),
        relative: { dernierJourCommun: jour("2026-09-27"), partVsBtc7j: 0.3, zRatio365: 0.1 },
        erreurBtc: null,
        btcPerime: true,
      },
      "ETH",
    );
    expect(html).toContain("cache BTC périmé");
    expect(htmlTuile(html, "Vues vs Bitcoin · 7 j")).toContain("au 2026-09-27");
  });

  it("alt : part des vues vs Bitcoin et z du ratio ; BTC en échec → « indisponible »", () => {
    const pret = {
      statut: "pret" as const,
      resultat: resultat("ETH", "Ethereum"),
      analyse: analyse({ niveau: "normale", z365: 0.4 }),
    };
    const ok = rendre({ ...pret, relative: { dernierJourCommun: jour("2026-11-06"), partVsBtc7j: 0.3182, zRatio365: 2.15 }, erreurBtc: null }, "ETH");
    expect(ok).toContain("Vues vs Bitcoin · 7 j");
    expect(ok).toContain("31.8 %");
    expect(ok).toContain("z 365 j du ratio 2.15");
    expect(ok).toContain("dans la norme");
    const ko = rendre({ ...pret, relative: null, erreurBtc: "Quota Wikimedia atteint (HTTP 429)." }, "ETH");
    expect(ko).toContain("indisponible");
    expect(ko).toContain("Série Bitcoin indisponible : Quota Wikimedia atteint (HTTP 429).");
  });

  it("cache périmé et retard de publication signalés", () => {
    const perime = rendre({ statut: "pret", resultat: resultat("BTC", "Bitcoin", true), analyse: analyse(), relative: null, erreurBtc: null });
    expect(perime).toContain("cache périmé");
    const enRetard = rendre({
      statut: "pret",
      resultat: resultat("BTC", "Bitcoin"),
      analyse: analyse({ dernierJour: jour("2026-11-03"), connuLe: jour("2026-11-04") }),
      relative: null,
      erreurBtc: null,
    });
    expect(enRetard).toContain("retard 3 j");
  });

  it("états explicites : chargement, erreur avec nouvel essai, article non retenu", () => {
    expect(rendre({ statut: "chargement" })).toContain("Pages vues Wikipédia…");
    const erreur = rendre({ statut: "erreur", message: "Wikimedia injoignable (réseau ou CORS)." });
    expect(erreur).toContain("Attention Wikipédia indisponible : Wikimedia injoignable (réseau ou CORS).");
    expect(erreur).toContain("Réessayer");
    const sans = rendre({ statut: "sans-article" }, "SOL", "fr");
    expect(sans).toContain("Pas d&#x27;article retenu pour SOL sur Wikipédia fr");
    // Sans article, la note ne cite aucun titre.
    expect(sans).not.toContain("de l&#x27;article «");
  });

  it("propose les actifs de la table curée et les deux éditions", () => {
    const html = rendre({ statut: "chargement" });
    for (const actif of ["BTC", "ETH", "SOL", "DOGE"]) expect(html).toContain(`>${actif}</button>`);
    expect(html).toContain('aria-label="Édition de Wikipédia"');
    expect(html).toContain(">fr</button>");
  });
});
