/**
 * Alerte de prix au bord d'une zone forte d'AXIS S/R (`alerteZone.ts`).
 *
 * Le cœur est pur : il est éprouvé sur le cas de référence BTCUSDT 4h (3 000 bougies closes, les
 * annotations telles que le graphe les calcule), puis sur des zones synthétiques pour chaque règle
 * — bande sous le point, bord tourné vers le cours, états « offre », « posee », « franchi »,
 * échéance, doublon. La lecture du graphe et la pose passent par un faux graphe et les vrais
 * stores ; le rendu (bouton de l'encart, menu du bureau) est prouvé à part (`candleReadout.test.ts`,
 * `priceAlertMenu.test.ts`) et sur le vrai graphe (`e2e/mobile-alerte-zone.e2e.ts`).
 *
 * Tous les textes sont épinglés au caractère près : ce sont eux que le propriétaire lit, sur le
 * bouton, dans l'avis de pose, puis dans la liste, l'avis, le journal et les relais du daemon.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chart } from "klinecharts";
import { decrireAlerte, type AlertDef } from "@axiom/alerts";
import { computeIndicator, getIndicator } from "@axiom/indicators";
import type { AnnotationsIndicateur, Candle, RubanAnnotation, Timeframe } from "@axiom/types";
import fixtureBtc from "../../../../packages/indicators/src/strategy/fixtures/btcusdt-4h-3000.json";

const daemon = vi.hoisted(() => ({ alertes: false }));
vi.mock("../data/daemon", async (original) => ({
  ...(await original<typeof import("../data/daemon")>()),
  daemonSupporte: (capacite: string) => capacite === "alerts" && daemon.alertes,
}));

import { alertsStore } from "../store/alerts";
import { indicatorsStore, type ActiveIndicator } from "../store/indicators";
import { toastsStore } from "../store/toasts";
import { uiSectionsStore } from "../store/ui-sections";
import {
  bordZone,
  DUREE_ALERTE_ZONE_MS,
  offreAuClic,
  offreBordZone,
  offreSousReticule,
  poserAlerteZone,
  suivreAlertes,
  zoneSousPoint,
  zonesDuGraphe,
  zonesFortesTracees,
  type ZoneForteTracee,
} from "./alerteZone";
import { axiomName } from "./indicators";

/** Une ligne du JSON, colonnes `time`, `open`, `high`, `low`, `close`, `volume`, `buyVolume`. */
type LigneBougie = [time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume: number];
const btc: Candle[] = (fixtureBtc.bougies as LigneBougie[]).map(([time, open, high, low, close, volume, buyVolume]) => ({
  time, open, high, low, close, volume, buyVolume, sellVolume: volume - buyVolume, closed: true,
}));
/** Calcul complet tel que le graphe le fait : réglages par défaut, `refClose` = les closes, unité 4h. */
const annotationsBtc = computeIndicator(getIndicator("stratAxisSr")!, btc, {}, { refClose: btc.map((c) => c.close) }, "4h").annotations!;
/** Dernière clôture du cas de référence. */
const COURS = 77582.02;

const BTC_4H = { symbol: "BTCUSDT", source: "binance", timeframe: "4h" } as const;
/** Midi, heure locale, le 31 octobre 2026 : la date écrite dans le message ne dépend pas du fuseau du test. */
const MAINTENANT = new Date(2026, 9, 31, 12).getTime();

/** Zone synthétique à bornes constantes. */
const zone = (role: ZoneForteTracee["role"], bas: number, haut: number, deIdx = 0, n = 10): ZoneForteTracee => ({
  role, deIdx, hauts: Array.from({ length: n }, () => haut), bas: Array.from({ length: n }, () => bas),
});
const SUPPORT = zone("support", 75626.55, 76601.83);
const RESISTANCE = zone("resistance", 85314.76, 86430.38);

const defPrix = (surcharge: Partial<AlertDef> = {}): AlertDef => ({
  id: "a1", symbol: "BTCUSDT", source: "binance", actif: true, declenchements: [],
  condition: { type: "prix-croise", niveau: 76601.83, sens: "baisse" },
  ...surcharge,
});

describe("zonesFortesTracees — cas de référence BTCUSDT 4h", () => {
  const rubans = annotationsBtc.rubans ?? [];
  const fortes = zonesFortesTracees(annotationsBtc);

  it("8 zones fortes actives, 4 supports et 4 résistances ; zones faibles et rubans cassés ignorés", () => {
    expect(btc.at(-1)?.close).toBe(COURS);
    expect(fortes).toHaveLength(8);
    expect(fortes.filter((z) => z.role === "support")).toHaveLength(4);
    expect(fortes.filter((z) => z.role === "resistance")).toHaveLength(4);
    // Témoins : la série réelle porte bien les deux autres sortes de rubans, que la lecture écarte.
    expect(rubans.filter((r) => r.info !== undefined && r.alpha === 0)).toHaveLength(4);
    expect(rubans.filter((r) => r.info === undefined)).toHaveLength(12);
    expect(rubans).toHaveLength(24);
  });

  it("bords tournés vers le cours, arrondis : haut des supports (sous le cours), bas des résistances (au-dessus)", () => {
    const bords = (role: ZoneForteTracee["role"]) => fortes.filter((z) => z.role === role).map((z) => bordZone(z));
    expect(bords("support").map((b) => b.niveau).sort((a, b) => b - a)).toEqual([76601.83, 65998.74, 65064.51, 62866.16]);
    expect(bords("resistance").map((b) => b.niveau).sort((a, b) => a - b)).toEqual([85314.76, 86702.87, 95385.99, 106340.68]);
    expect(bords("support").every((b) => b.sens === "baisse" && b.niveau < COURS)).toBe(true);
    expect(bords("resistance").every((b) => b.sens === "hausse" && b.niveau > COURS)).toBe(true);
  });

  it("le bord est la DERNIÈRE borne tracée, pas celle d'une bougie antérieure", () => {
    // Témoin : au moins une zone forte a bougé au fil de la série (ses bornes ne sont pas constantes).
    const mobiles = fortes.filter((z) => new Set(z.role === "support" ? z.hauts : z.bas).size > 1);
    expect(mobiles.length).toBeGreaterThan(0);
    for (const z of fortes) {
      const bornes = z.role === "support" ? z.hauts : z.bas;
      expect(bordZone(z).niveau).toBeCloseTo(bornes.at(-1)!, 2);
      // Chaque ruban d'une zone active va jusqu'à la dernière bougie décidée.
      expect(z.deIdx + z.hauts.length).toBe(btc.length);
    }
  });

  it("annotations absentes, vides, ou ruban sans borne : aucune zone", () => {
    expect(zonesFortesTracees(undefined)).toEqual([]);
    expect(zonesFortesTracees({})).toEqual([]);
    expect(zonesFortesTracees({ rubans: [{ deIdx: 0, hauts: [], bas: [], couleur: "--up", alpha: 0.2, info: "zone" }] })).toEqual([]);
  });

  it("le rôle vient de la couleur du ruban, jamais de son texte", () => {
    const ruban = (couleur: string, info: string): RubanAnnotation => ({ deIdx: 3, hauts: [2], bas: [1], couleur, alpha: 0.1, info });
    expect(zonesFortesTracees({ rubans: [ruban("--up", "AXIS résistance forte"), ruban("--down", "AXIS support fort")] }).map((z) => z.role)).toEqual(["support", "resistance"]);
  });
});

describe("zoneSousPoint — la bande sous le point, en pixels", () => {
  // Axe synthétique : 1 px par unité de prix, l'ordonnée croît quand le prix baisse.
  const yDe = (prix: number): number => 1000 - prix;
  const z = zone("support", 100, 120, 5, 10); // bande de y = 880 à y = 900, bougies 5 à 14

  it("dans la bande, bords compris ; hors de la bande sans tolérance : aucune", () => {
    expect(zoneSousPoint([z], 7, 890, yDe)).toBe(z);
    expect(zoneSousPoint([z], 7, 880, yDe)).toBe(z);
    expect(zoneSousPoint([z], 7, 900, yDe)).toBe(z);
    expect(zoneSousPoint([z], 7, 879.5, yDe)).toBeNull();
    expect(zoneSousPoint([z], 7, 900.5, yDe)).toBeNull();
  });

  it("avec tolérance : à 6 px retenue, à 6,5 px refusée, des deux côtés", () => {
    expect(zoneSousPoint([z], 7, 874, yDe, 6)).toBe(z);
    expect(zoneSousPoint([z], 7, 873.5, yDe, 6)).toBeNull();
    expect(zoneSousPoint([z], 7, 906, yDe, 6)).toBe(z);
    expect(zoneSousPoint([z], 7, 906.5, yDe, 6)).toBeNull();
  });

  it("avant la première bougie de la zone : aucune ; au-delà de la dernière (marge droite) : ses dernières bornes", () => {
    expect(zoneSousPoint([z], 4, 890, yDe)).toBeNull();
    expect(zoneSousPoint([z], 5, 890, yDe)).toBe(z);
    expect(zoneSousPoint([z], 14, 890, yDe)).toBe(z);
    expect(zoneSousPoint([z], 40, 890, yDe)).toBe(z);
  });

  it("deux bandes : la plus proche ; à égalité, la première", () => {
    const basse = zone("support", 100, 120);
    const haute = zone("resistance", 110, 140);
    // y = 885 est dans les deux (prix 115) : la première de la liste.
    expect(zoneSousPoint([basse, haute], 2, 885, yDe)).toBe(basse);
    expect(zoneSousPoint([haute, basse], 2, 885, yDe)).toBe(haute);
    // y = 870 (prix 130) : dans la haute seule ; avec tolérance, la basse est à 10 px, la haute à 0.
    expect(zoneSousPoint([basse, haute], 2, 870, yDe, 12)).toBe(haute);
  });

  it("bornes qui ont bougé : la zone est trouvée par la bande tracée À LA BOUGIE, le niveau proposé est le dernier bord", () => {
    const mobile: ZoneForteTracee = { role: "support", deIdx: 0, hauts: [120, 120, 150, 150], bas: [100, 100, 130, 130] };
    // Bougie 1 : bande [100, 120] ; le prix 110 y est, le prix 140 non.
    expect(zoneSousPoint([mobile], 1, yDe(110), yDe)).toBe(mobile);
    expect(zoneSousPoint([mobile], 1, yDe(140), yDe)).toBeNull();
    // Bougie 3 : bande [130, 150].
    expect(zoneSousPoint([mobile], 3, yDe(140), yDe)).toBe(mobile);
    expect(bordZone(mobile)).toEqual({ niveau: 150, sens: "baisse" });
    expect(bordZone({ ...mobile, role: "resistance" })).toEqual({ niveau: 130, sens: "hausse" });
  });

  it("ordonnée ou conversion non finie : jamais « dans la bande »", () => {
    expect(zoneSousPoint([z], 7, Number.NaN, yDe, 6)).toBeNull();
    expect(zoneSousPoint([z], 7, 890, () => Number.NaN, 6)).toBeNull();
    expect(zoneSousPoint([], 7, 890, yDe)).toBeNull();
  });
});

describe("offreBordZone — états et textes", () => {
  it("support, cours au-dessus du bord : offre, alerte prix-croise à la baisse, échéance à 7 jours, textes exacts", () => {
    const offre = offreBordZone(SUPPORT, BTC_4H, COURS, [], MAINTENANT);
    expect(offre.etat).toBe("offre");
    expect(offre.libelle).toBe("Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours");
    expect(offre.avis).toBe("Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours");
    expect(offre.alerte).toEqual({
      symbol: "BTCUSDT",
      source: "binance",
      condition: { type: "prix-croise", niveau: 76601.83, sens: "baisse" },
      message: "≤ 76,601.83 · bord du support fort AXIS S/R 4h du 31/10 · niveau fixe",
      expireTs: MAINTENANT + 604_800_000,
    });
    expect(DUREE_ALERTE_ZONE_MS).toBe(604_800_000);
    // L'alerte n'a pas d'unité : évaluée au tick, sur tout graphe, et par le daemon.
    expect(offre.alerte).not.toHaveProperty("timeframe");
  });

  it("résistance : à la hausse, « ≥ », « ↑ », « de la résistance forte »", () => {
    const offre = offreBordZone(RESISTANCE, BTC_4H, COURS, [], MAINTENANT);
    expect(offre.etat).toBe("offre");
    expect(offre.libelle).toBe("Alerte de prix ↑ 85,314.76 · bord de la résistance forte · niveau fixe, 7 jours");
    expect(offre.avis).toBe("Alerte de prix posée : BTCUSDT ↑ 85,314.76 · niveau fixe · expire dans 7 jours");
    expect(offre.alerte?.condition).toEqual({ type: "prix-croise", niveau: 85314.76, sens: "hausse" });
    expect(offre.alerte?.message).toBe("≥ 85,314.76 · bord de la résistance forte AXIS S/R 4h du 31/10 · niveau fixe");
  });

  // Constat de la revue du lot : écrit par `formatPrice` (2 décimales au-dessus de 1, 4 en
  // dessous), le niveau du bouton, de l'avis et du message n'était pas celui de l'alerte, qui en
  // garde jusqu'à 5 chiffres significatifs — « ≤ 2.35 » pour 2.3457, « ≤ 1.00 » pour 1.0049. Or le
  // message REMPLACE la condition partout où l'alerte se lit : le vrai niveau ne se lisait nulle part.
  describe("le niveau est écrit avec toutes les décimales de l'alerte", () => {
    const XRP_4H = { symbol: "XRPUSDT", source: "binance", timeframe: "4h" } as const;
    /** Support dont le bord haut vaut `haut`, cours 10 % au-dessus. */
    const offreAu = (haut: number, role: ZoneForteTracee["role"] = "support") =>
      offreBordZone(role === "support" ? zone(role, haut * 0.98, haut) : zone(role, haut, haut * 1.02), XRP_4H, role === "support" ? haut * 1.1 : haut * 0.9, [], MAINTENANT);

    it("2.34567 : alerte à 2.3457, écrite « 2.3457 » sur le bouton, dans l'avis et dans le message", () => {
      const offre = offreAu(2.34567);
      expect(offre.alerte?.condition).toEqual({ type: "prix-croise", niveau: 2.3457, sens: "baisse" });
      expect(offre.libelle).toBe("Alerte de prix ↓ 2.3457 · bord du support fort · niveau fixe, 7 jours");
      expect(offre.avis).toBe("Alerte de prix posée : XRPUSDT ↓ 2.3457 · niveau fixe · expire dans 7 jours");
      expect(offre.alerte?.message).toBe("≤ 2.3457 · bord du support fort AXIS S/R 4h du 31/10 · niveau fixe");
    });

    it("0.123456 : alerte à 0.12346, écrite « 0.12346 » — offerte, déjà posée, franchie, et en résistance", () => {
      const support = zone("support", 0.12, 0.123456);
      const offre = offreAu(0.123456);
      expect(offre.alerte?.condition).toEqual({ type: "prix-croise", niveau: 0.12346, sens: "baisse" });
      expect(offre.libelle).toBe("Alerte de prix ↓ 0.12346 · bord du support fort · niveau fixe, 7 jours");
      expect(offre.avis).toBe("Alerte de prix posée : XRPUSDT ↓ 0.12346 · niveau fixe · expire dans 7 jours");
      expect(offre.alerte?.message).toBe("≤ 0.12346 · bord du support fort AXIS S/R 4h du 31/10 · niveau fixe");
      const posee = defPrix({ symbol: "XRPUSDT", condition: { type: "prix-croise", niveau: 0.12346, sens: "baisse" } });
      expect(offreBordZone(support, XRP_4H, 0.13, [posee], MAINTENANT).libelle).toBe("Alerte déjà posée ↓ 0.12346 · bord du support fort");
      expect(offreBordZone(support, XRP_4H, 0.12346, [], MAINTENANT).libelle).toBe("Pas d'alerte : le cours a déjà franchi le bord du support fort (0.12346)");
      const resistance = offreAu(0.123456, "resistance");
      expect(resistance.libelle).toBe("Alerte de prix ↑ 0.12346 · bord de la résistance forte · niveau fixe, 7 jours");
      expect(resistance.alerte?.message).toBe("≥ 0.12346 · bord de la résistance forte AXIS S/R 4h du 31/10 · niveau fixe");
    });

    it.each([
      [1.00494, 1.0049, "1.0049"],
      [12.3456, 12.346, "12.346"],
      [123.456, 123.46, "123.46"],
      [0.00123456, 0.0012346, "0.0012346"],
      [0.0000123456, 0.00001235, "0.00001235"],
      // Deux décimales au moins, séparateur des milliers : un prix se lit comme partout ailleurs.
      [150, 150, "150.00"],
      [2.5, 2.5, "2.50"],
      [76601.8, 76601.8, "76,601.80"],
      [1234567.891, 1234567.89, "1,234,567.89"],
    ])("bord %f : alerte à %f, écrite « %s » — le texte, relu comme un nombre, EST le niveau de l'alerte", (bord, niveau, ecrit) => {
      const offre = offreAu(bord);
      expect(offre.alerte?.condition).toMatchObject({ niveau });
      expect(offre.libelle).toBe(`Alerte de prix ↓ ${ecrit} · bord du support fort · niveau fixe, 7 jours`);
      expect(offre.alerte?.message).toBe(`≤ ${ecrit} · bord du support fort AXIS S/R 4h du 31/10 · niveau fixe`);
      expect(Number(ecrit.replace(/,/g, ""))).toBe(niveau);
    });

    it("les 8 zones du cas de référence : le niveau écrit, relu comme un nombre, est celui de la condition", () => {
      for (const z of zonesFortesTracees(annotationsBtc)) {
        const { libelle, alerte } = offreBordZone(z, BTC_4H, COURS, [], MAINTENANT);
        const ecrit = /[↓↑] ([\d,.]+) · /.exec(libelle)?.[1];
        expect(Number(ecrit?.replace(/,/g, ""))).toBe((alerte?.condition as { niveau: number }).niveau);
        expect(alerte?.message).toContain(` ${ecrit} · bord `);
      }
    });
  });

  it("le message est ce que la liste, l'avis, le journal et les relais du daemon écrivent : sans symbole, l'hôte l'ajoute", () => {
    const { alerte } = offreBordZone(SUPPORT, { ...BTC_4H, symbol: "btcusdt" }, COURS, [], MAINTENANT);
    expect(alerte?.symbol).toBe("BTCUSDT");
    // `decrireAlerte` est le libellé commun au web et au daemon (`@axiom/alerts`).
    expect(decrireAlerte({ condition: alerte!.condition, message: alerte!.message })).toBe(alerte!.message);
    expect(alerte!.message).not.toMatch(/btcusdt/i);
    // Le nom écrit est celui de l'indicateur au registre.
    expect(alerte!.message).toContain(` ${getIndicator("stratAxisSr")!.name} 4h `);
  });

  it("unité inconnue : omise ; la date est celle de la pose, en heure locale", () => {
    const sansUnite = offreBordZone(SUPPORT, { symbol: "BTCUSDT", source: "binance" }, COURS, [], MAINTENANT);
    expect(sansUnite.alerte?.message).toBe("≤ 76,601.83 · bord du support fort AXIS S/R du 31/10 · niveau fixe");
    const premierJanvier = offreBordZone(SUPPORT, BTC_4H, COURS, [], new Date(2027, 0, 1, 12).getTime());
    expect(premierJanvier.alerte?.message).toBe("≤ 76,601.83 · bord du support fort AXIS S/R 4h du 01/01 · niveau fixe");
  });

  // Arbitrage de l'orchestrateur (12 novembre 2026) : le message finit par « · niveau fixe », sans
  // « zone mobile ». La règle qui retirait cette mention au-delà de 90 caractères n'a plus d'objet :
  // le message le plus long du cas de référence en fait 78, et tout niveau sous dix millions tient
  // en 80. Longueurs épinglées : un texte qui s'allonge se voit ici.
  it("le message finit par « · niveau fixe » : 69 caractères pour le support de référence, 78 au plus sur les 8 zones et toutes les unités", () => {
    const unites: Timeframe[] = ["1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w", "1M", "3M", "6M", "12M"];
    const longueurs: number[] = [];
    for (const z of zonesFortesTracees(annotationsBtc)) {
      for (const timeframe of unites) {
        const message = offreBordZone(z, { ...BTC_4H, timeframe }, COURS, [], MAINTENANT).alerte!.message!;
        longueurs.push(message.length);
        expect(message).toMatch(/ AXIS S\/R \S{2,3} du 31\/10 · niveau fixe$/);
        expect(message).not.toContain("zone mobile");
      }
    }
    expect(Math.max(...longueurs)).toBe(78);
    expect(offreBordZone(SUPPORT, BTC_4H, COURS, [], MAINTENANT).alerte!.message).toHaveLength(69);
    expect(offreBordZone(RESISTANCE, BTC_4H, COURS, [], MAINTENANT).alerte!.message).toHaveLength(76);
  });

  it("le plus long : résistance, unité à trois caractères — 78 caractères à 106,340.68, 80 à 9,999,999.99 ; rien n'est retiré", () => {
    const haute = zone("resistance", 106340.68, 108000);
    const message = offreBordZone(haute, { ...BTC_4H, timeframe: "15m" }, COURS, [], MAINTENANT).alerte!.message!;
    expect(message).toBe("≥ 106,340.68 · bord de la résistance forte AXIS S/R 15m du 31/10 · niveau fixe");
    expect(message).toHaveLength(78);
    const tresHaute = zone("resistance", 9999999.99, 10_100_000);
    const plusLong = offreBordZone(tresHaute, { ...BTC_4H, timeframe: "12h" }, 9_000_000, [], MAINTENANT).alerte!.message!;
    expect(plusLong).toBe("≥ 9,999,999.99 · bord de la résistance forte AXIS S/R 12h du 31/10 · niveau fixe");
    expect(plusLong).toHaveLength(80);
  });

  it("franchi : cours égal au bord, dans la zone ou au-delà — aucune alerte, le texte dit pourquoi", () => {
    for (const prix of [76601.83, 76000, 75626.55, 70000]) {
      const offre = offreBordZone(SUPPORT, BTC_4H, prix, [], MAINTENANT);
      expect(offre).toMatchObject({ etat: "franchi", libelle: "Pas d'alerte : le cours a déjà franchi le bord du support fort (76,601.83)" });
      expect(offre.alerte).toBeUndefined();
    }
    for (const prix of [85314.76, 86000, 90000]) {
      const offre = offreBordZone(RESISTANCE, BTC_4H, prix, [], MAINTENANT);
      expect(offre).toMatchObject({ etat: "franchi", libelle: "Pas d'alerte : le cours a déjà franchi le bord de la résistance forte (85,314.76)" });
      expect(offre.alerte).toBeUndefined();
    }
    // Un centime avant le bord : l'offre vaut.
    expect(offreBordZone(SUPPORT, BTC_4H, 76601.84, [], MAINTENANT).etat).toBe("offre");
    expect(offreBordZone(RESISTANCE, BTC_4H, 85314.75, [], MAINTENANT).etat).toBe("offre");
  });

  it("dernier prix inconnu ou non fini : l'offre vaut (rien ne dit que le bord est franchi)", () => {
    expect(offreBordZone(SUPPORT, BTC_4H, undefined, [], MAINTENANT).etat).toBe("offre");
    expect(offreBordZone(SUPPORT, BTC_4H, Number.NaN, [], MAINTENANT).etat).toBe("offre");
  });

  it("déjà posée : même symbole, source, niveau et sens, active ou en pause, non expirée", () => {
    const attendu = { etat: "posee", libelle: "Alerte déjà posée ↓ 76,601.83 · bord du support fort" };
    for (const def of [defPrix(), defPrix({ actif: false }), defPrix({ expireTs: MAINTENANT + 1 })]) {
      const offre = offreBordZone(SUPPORT, BTC_4H, COURS, [def], MAINTENANT);
      expect(offre).toMatchObject(attendu);
      expect(offre.alerte).toBeUndefined();
    }
    expect(offreBordZone(RESISTANCE, BTC_4H, COURS, [defPrix({ condition: { type: "prix-croise", niveau: 85314.76, sens: "hausse" } })], MAINTENANT).libelle)
      .toBe("Alerte déjà posée ↑ 85,314.76 · bord de la résistance forte");
    // Symbole du graphe en minuscules : comparé en capitales, comme le store l'enregistre.
    expect(offreBordZone(SUPPORT, { ...BTC_4H, symbol: "btcusdt" }, COURS, [defPrix()], MAINTENANT).etat).toBe("posee");
  });

  it("l'alerte existe et le bord est franchi : « déjà posée », pas « pas d'alerte »", () => {
    expect(offreBordZone(SUPPORT, BTC_4H, 76000, [defPrix()], MAINTENANT).etat).toBe("posee");
  });

  it("pas un doublon : expirée, ou autre sens, niveau, symbole, source, type de condition", () => {
    const autres: AlertDef[] = [
      defPrix({ expireTs: MAINTENANT }),
      defPrix({ expireTs: MAINTENANT - 1 }),
      defPrix({ condition: { type: "prix-croise", niveau: 76601.83, sens: "hausse" } }),
      defPrix({ condition: { type: "prix-croise", niveau: 76601.83, sens: "les-deux" } }),
      defPrix({ condition: { type: "prix-croise", niveau: 76601.84, sens: "baisse" } }),
      defPrix({ symbol: "ETHUSDT" }),
      defPrix({ source: "bybit" }),
      defPrix({ condition: { type: "variation-pct", seuilPct: 5, fenetreMs: 3_600_000 } }),
    ];
    for (const def of autres) expect(offreBordZone(SUPPORT, BTC_4H, COURS, [def], MAINTENANT).etat).toBe("offre");
    expect(offreBordZone(SUPPORT, BTC_4H, COURS, autres, MAINTENANT).etat).toBe("offre");
  });

  it("doctrine : ni « signal », ni « réaction », ni pourcentage, ni promesse — et « niveau fixe » partout où l'alerte est offerte ou écrite", () => {
    const textes: string[] = [];
    for (const z of [...zonesFortesTracees(annotationsBtc), SUPPORT, RESISTANCE]) {
      for (const [prix, defs] of [[COURS, []], [bordZone(z).niveau, []], [COURS, [defPrix({ condition: { type: "prix-croise", ...bordZone(z) } })]]] as const) {
        const offre = offreBordZone(z, BTC_4H, prix, defs, MAINTENANT);
        textes.push(offre.libelle, offre.avis, ...(offre.alerte?.message ? [offre.alerte.message] : []));
        if (offre.etat === "offre") {
          expect(offre.libelle).toContain("niveau fixe");
          expect(offre.avis).toContain("niveau fixe");
          expect(offre.alerte?.message).toContain("niveau fixe");
        }
      }
    }
    expect(new Set(textes.map((t) => t.split(" ")[0]))).toEqual(new Set(["Alerte", "Pas", "≤", "≥"]));
    for (const texte of textes) expect(texte).not.toMatch(/signal|réaction|reaction|%|rebond|gain|profit|performance|garanti/i);
  });
});

// ── Lecture du graphe et pose ─────────────────────────────────────────────────────────────────────

const instance = (instanceId: string, defId: string, params: ActiveIndicator["params"] = {}): ActiveIndicator => ({ instanceId, defId, params, couleurIdx: 0 });

/** Ruban de zone forte active, tel qu'AXIS S/R le trace. */
const rubanFort = (couleur: "--up" | "--down", bas: number, haut: number): RubanAnnotation => ({ deIdx: 0, hauts: [haut, haut], bas: [bas, bas], couleur, alpha: 0.12, info: "zone" });
const ANNOTATIONS_SR: AnnotationsIndicateur = { rubans: [rubanFort("--up", 75626.55, 76601.83), rubanFort("--down", 85314.76, 86430.38)] };

/**
 * Faux graphe : annotations montées par instance, dernière clôture, et un axe où 1 px vaut 10 de
 * prix. Le pane des prix commence à 40 px de la racine : l'ordonnée « absolue » d'un prix est
 * décalée d'autant de son ordonnée dans le pane.
 */
function fauxGraphe(montes: Record<string, AnnotationsIndicateur>, cloture: number = COURS, idxSousClic = 1): Chart {
  const HAUT_PANE = 40;
  const y = (prix: number): number => (100_000 - prix) / 10;
  return {
    getIndicatorByPaneId: (paneId: string, name: string) => {
      const instanceId = Object.keys(montes).find((id) => axiomName(id) === name);
      return paneId === "candle_pane" && instanceId !== undefined ? { extendData: { series: {}, annotations: montes[instanceId] } } : null;
    },
    getDataList: () => [{ close: 1 }, { close: cloture }],
    convertToPixel: ({ value }: { value: number }, { paneId, absolute }: { paneId: string; absolute?: boolean }) =>
      paneId === "candle_pane" ? { y: y(value) + (absolute ? HAUT_PANE : 0) } : {},
    convertFromPixel: () => [{ dataIndex: idxSousClic }],
  } as unknown as Chart;
}
/** Ordonnée d'un prix dans le pane du faux graphe. */
const yPane = (prix: number): number => (100_000 - prix) / 10;

describe("zonesDuGraphe — les zones des instances d'AXIS S/R montées, et d'elles seules", () => {
  afterEach(() => indicatorsStore.setState({ indicators: [] }));

  it("une prime spot/perp porteuse de rubans à texte et bande pleine n'est pas une zone : l'instance est choisie par sa définition", () => {
    indicatorsStore.setState({ indicators: [instance("prime-1", "premiumSpotPerp"), instance("sr-1", "stratAxisSr")] });
    const chart = fauxGraphe({ "prime-1": { rubans: [{ deIdx: 0, hauts: [9], bas: [1], couleur: "--up", alpha: 0.15, info: "prime" }] }, "sr-1": ANNOTATIONS_SR });
    expect(zonesDuGraphe(chart, BTC_4H).map((z) => [z.role, bordZone(z).niveau])).toEqual([["support", 76601.83], ["resistance", 85314.76]]);
  });

  it("deux instances d'AXIS S/R : les zones des deux ; instance non montée sur ce graphe : rien", () => {
    indicatorsStore.setState({ indicators: [instance("sr-1", "stratAxisSr"), instance("sr-2", "stratAxisSr", { maxZonesSr: 4 }), instance("sr-3", "stratAxisSr")] });
    const chart = fauxGraphe({ "sr-1": ANNOTATIONS_SR, "sr-2": { rubans: [rubanFort("--up", 60000, 61000)] } });
    expect(zonesDuGraphe(chart, BTC_4H).map((z) => bordZone(z).niveau)).toEqual([76601.83, 85314.76, 61000]);
  });

  it("en rejeu : aucune zone, donc aucune offre", () => {
    indicatorsStore.setState({ indicators: [instance("sr-1", "stratAxisSr")] });
    const chart = fauxGraphe({ "sr-1": ANNOTATIONS_SR });
    expect(zonesDuGraphe(chart, { ...BTC_4H, rejeu: true })).toEqual([]);
    expect(zonesDuGraphe(chart, { ...BTC_4H, rejeu: false })).toHaveLength(2);
  });

  it("instance au réglage « unite » : écartée — ses zones seraient celles d'une autre unité que celle du message", () => {
    indicatorsStore.setState({ indicators: [instance("sr-1d", "stratAxisSr", { unite: "1d" })] });
    const chart = fauxGraphe({ "sr-1d": ANNOTATIONS_SR });
    expect(zonesDuGraphe(chart, BTC_4H)).toEqual([]);
    // Unité vide : pas de réglage, l'instance est lue.
    indicatorsStore.setState({ indicators: [instance("sr-1d", "stratAxisSr", { unite: "" })] });
    expect(zonesDuGraphe(chart, BTC_4H)).toHaveLength(2);
  });
});

describe("poserAlerteZone et offres prêtes pour l'encart et le menu", () => {
  const AUJOURDHUI = new Date(2026, 9, 31, 12);
  let chart: Chart;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AUJOURDHUI);
    daemon.alertes = false;
    alertsStore.setState({ defs: [], journal: [] });
    toastsStore.setState({ toasts: [] });
    uiSectionsStore.setState({ open: {} });
    indicatorsStore.setState({ indicators: [instance("sr-1", "stratAxisSr")] });
    chart = fauxGraphe({ "sr-1": ANNOTATIONS_SR });
  });
  afterEach(() => {
    vi.useRealTimers();
    indicatorsStore.setState({ indicators: [] });
    alertsStore.setState({ defs: [], journal: [] });
    toastsStore.setState({ toasts: [] });
  });

  const support = (): ZoneForteTracee => zonesDuGraphe(chart, BTC_4H)[0]!;

  it("pose UNE alerte à 7 jours, ouvre la section Alertes, pousse un avis de 6 s ; rend l'offre « posee »", () => {
    const apres = poserAlerteZone(chart, BTC_4H, support())!;
    const { defs } = alertsStore.getState();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      symbol: "BTCUSDT",
      source: "binance",
      actif: true,
      condition: { type: "prix-croise", niveau: 76601.83, sens: "baisse" },
      message: "≤ 76,601.83 · bord du support fort AXIS S/R 4h du 31/10 · niveau fixe",
      expireTs: AUJOURDHUI.getTime() + 7 * 24 * 3_600_000,
      declenchements: [],
    });
    // Jamais calibrée à la pose : c'est le premier prix reçu par le moteur qui l'arme.
    expect(defs[0]?.arme).toBeUndefined();
    expect(defs[0]?.timeframe).toBeUndefined();
    expect(apres).toMatchObject({ etat: "posee", libelle: "Alerte déjà posée ↓ 76,601.83 · bord du support fort" });
    expect(uiSectionsStore.getState().open).toEqual({ Alertes: true });
    const { toasts } = toastsStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.texte).toBe("Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours · sonne application ouverte seulement");
    expect(toasts[0]?.action?.libelle).toBe("Annuler");
    // Avis ordinaire à action : il part de lui-même après 6 s, pas avant.
    expect(toasts[0]?.reste).toBeUndefined();
    vi.advanceTimersByTime(5_999);
    expect(toastsStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toastsStore.getState().toasts).toHaveLength(0);
    expect(alertsStore.getState().defs).toHaveLength(1);
  });

  // Depuis l'arbitrage A2 (garde commune) : un geste qui ne crée rien le dit par un avis court, sans
  // « Annuler ». Au téléphone le bouton « déjà posée » est grisé et n'appelle pas ce geste ; au
  // bureau, c'est le cas d'un menu ouvert avant qu'une alerte identique soit posée.
  it("second geste : jamais deux alertes pour le même bord ; un avis court dit « déjà posée »", () => {
    poserAlerteZone(chart, BTC_4H, support());
    const second = poserAlerteZone(chart, BTC_4H, support());
    expect(second?.etat).toBe("posee");
    expect(alertsStore.getState().defs).toHaveLength(1);
    expect(toastsStore.getState().toasts.map((t) => [t.texte, t.action])).toEqual([
      ["Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours · sonne application ouverte seulement", expect.anything()],
      ["Alerte déjà posée ↓ 76,601.83 · bord du support fort", undefined],
    ]);
  });

  it("garde commune : une zone qui n'est plus tracée à ce bord ne pose rien, et l'avis dit pourquoi", () => {
    const affichee = support();
    const avis = (): string[] => toastsStore.getState().toasts.map((t) => t.texte);
    // Même zone (même rôle, même bougie de confirmation), bord déplacé par une clôture.
    chart = fauxGraphe({ "sr-1": { rubans: [rubanFort("--up", 75626.55, 76529.83)] } });
    expect(poserAlerteZone(chart, BTC_4H, affichee)).toBeUndefined();
    expect(avis()).toEqual(["Pas d'alerte : le bord de la zone forte a bougé"]);
    // Une autre zone de support, confirmée ailleurs : celle de l'affichage n'est plus tracée.
    chart = fauxGraphe({ "sr-1": { rubans: [{ ...rubanFort("--up", 60000, 61000), deIdx: 1 }] } });
    poserAlerteZone(chart, BTC_4H, affichee);
    // AXIS S/R fermé.
    indicatorsStore.setState({ indicators: [] });
    poserAlerteZone(fauxGraphe({ "sr-1": ANNOTATIONS_SR }), BTC_4H, affichee);
    expect(avis().slice(1)).toEqual(["Pas d'alerte : la zone forte n'est plus tracée", "Pas d'alerte : la zone forte n'est plus tracée"]);
    expect(alertsStore.getState().defs).toEqual([]);
  });

  it("« Annuler » supprime l'alerte créée, et elle seule ; l'offre revient", () => {
    alertsStore.getState().ajouter({ symbol: "BTCUSDT", source: "binance", condition: { type: "prix-croise", niveau: 85000, sens: "hausse" } });
    poserAlerteZone(chart, BTC_4H, support());
    expect(alertsStore.getState().defs).toHaveLength(2);
    toastsStore.getState().toasts[0]?.action?.executer();
    expect(alertsStore.getState().defs.map((d) => d.condition)).toEqual([{ type: "prix-croise", niveau: 85000, sens: "hausse" }]);
    expect(offreSousReticule(chart, BTC_4H, { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })?.etat).toBe("offre");
  });

  it("l'offre est relue AU MOMENT DU GESTE : le cours a franchi le bord entre l'affichage et le toucher, rien n'est créé", () => {
    const affichee = offreSousReticule(chart, BTC_4H, { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })!;
    expect(affichee.etat).toBe("offre");
    // Même graphe, dernier prix passé sous le bord.
    (chart as unknown as { getDataList: () => Array<{ close: number }> }).getDataList = () => [{ close: 76500 }];
    affichee.executer();
    expect(alertsStore.getState().defs).toEqual([]);
    // Un avis court le dit (garde commune, arbitrage A2) ; au téléphone, le bouton relit l'offre
    // avant d'appeler ce geste et se réécrit sans avis (`candleReadout.offre.test.ts`).
    expect(toastsStore.getState().toasts.map((t) => [t.texte, t.action])).toEqual([["Pas d'alerte : le cours a déjà franchi le bord du support fort (76,601.83)", undefined]]);
    expect(offreSousReticule(chart, BTC_4H, { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })?.etat).toBe("franchi");
  });

  // Constat de la revue du lot (bouton périmé) : l'encart relit l'offre après chaque recalcul des
  // indicateurs et au toucher (`CandleReadout.offreChangee`). Ce qu'il relit doit dire, à l'instant,
  // ce que le graphe trace — une zone disparue n'a plus d'offre, un bord déplacé change son texte.
  it("l'offre relue suit le graphe : AXIS S/R fermé ou rejeu lancé, plus d'offre ; bord déplacé, un autre texte", () => {
    const reticule = { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) };
    const affichee = offreSousReticule(chart, BTC_4H, reticule)!;
    expect(affichee.libelle).toBe("Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours");
    // Relue sans que rien ait changé : le même texte (l'encart ne se réaffiche pas).
    expect(offreSousReticule(chart, BTC_4H, reticule)?.libelle).toBe(affichee.libelle);
    // Le bord du support a bougé à la clôture suivante : le texte porte le nouveau niveau.
    const deplace = fauxGraphe({ "sr-1": { rubans: [rubanFort("--up", 75626.55, 76529.83)] } });
    expect(offreSousReticule(deplace, BTC_4H, reticule)?.libelle).toBe("Alerte de prix ↓ 76,529.83 · bord du support fort · niveau fixe, 7 jours");
    // Rejeu lancé sur la vue : aucune offre, au téléphone comme au clic droit.
    expect(offreSousReticule(chart, { ...BTC_4H, rejeu: true }, reticule)).toBeUndefined();
    expect(offreAuClic(chart, { ...BTC_4H, rejeu: true }, 200, yPane(76000) + 40)).toBeUndefined();
    // AXIS S/R fermé : l'instance quitte le store, le graphe ne trace plus la zone.
    indicatorsStore.setState({ indicators: [] });
    expect(offreSousReticule(chart, BTC_4H, reticule)).toBeUndefined();
    expect(offreAuClic(chart, BTC_4H, 200, yPane(76000) + 40)).toBeUndefined();
    expect(alertsStore.getState().defs).toEqual([]);
  });

  it("l'échéance est comptée du geste, pas de l'affichage", () => {
    const affichee = offreSousReticule(chart, BTC_4H, { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })!;
    vi.setSystemTime(AUJOURDHUI.getTime() + 3_600_000);
    affichee.executer();
    expect(alertsStore.getState().defs[0]?.expireTs).toBe(AUJOURDHUI.getTime() + 3_600_000 + DUREE_ALERTE_ZONE_MS);
  });

  it("portée dite dans l'avis : sans daemon, ou hors Binance, « sonne application ouverte seulement » ; daemon et Binance, rien de plus", () => {
    const texte = (): string | undefined => toastsStore.getState().toasts.at(-1)?.texte;
    daemon.alertes = true;
    poserAlerteZone(chart, BTC_4H, support());
    expect(texte()).toBe("Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours");
    // Le daemon n'évalue que Binance : sur une autre place, l'alerte ne sonne qu'application ouverte.
    poserAlerteZone(chart, { ...BTC_4H, source: "bybit" }, support());
    expect(texte()).toBe("Alerte de prix posée : BTCUSDT ↓ 76,601.83 · niveau fixe · expire dans 7 jours · sonne application ouverte seulement");
    expect(alertsStore.getState().defs.map((d) => d.source)).toEqual(["binance", "bybit"]);
  });

  it("offreSousReticule : la bande forte SOUS le réticule du pane des prix, sans tolérance", () => {
    const sur = (reticule: { paneId?: string; dataIndex?: number; y?: number }) => offreSousReticule(chart, BTC_4H, reticule);
    expect(sur({ paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })).toMatchObject({ etat: "offre", libelle: "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours" });
    expect(sur({ paneId: "candle_pane", dataIndex: 1, y: yPane(86000) })).toMatchObject({ etat: "offre", libelle: "Alerte de prix ↑ 85,314.76 · bord de la résistance forte · niveau fixe, 7 jours" });
    // Bords de la bande compris ; un pixel dehors : rien.
    expect(sur({ paneId: "candle_pane", dataIndex: 1, y: yPane(76601.83) })?.etat).toBe("offre");
    expect(sur({ paneId: "candle_pane", dataIndex: 1, y: yPane(76601.83) - 1 })).toBeUndefined();
    expect(sur({ paneId: "candle_pane", dataIndex: 1, y: yPane(80000) })).toBeUndefined();
    // Autre pane, réticule hors données ou sans ordonnée : rien.
    expect(sur({ paneId: "axiom_rsi", dataIndex: 1, y: yPane(76000) })).toBeUndefined();
    expect(sur({ dataIndex: 1, y: yPane(76000) })).toBeUndefined();
    expect(sur({ paneId: "candle_pane", y: yPane(76000) })).toBeUndefined();
    expect(sur({ paneId: "candle_pane", dataIndex: 1 })).toBeUndefined();
    // Rejeu : rien.
    expect(offreSousReticule(chart, { ...BTC_4H, rejeu: true }, { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })).toBeUndefined();
  });

  it("offreAuClic : ordonnée relative à la racine du graphe, bande à 6 px près", () => {
    const HAUT_PANE = 40;
    const au = (y: number) => offreAuClic(chart, BTC_4H, 200, y);
    expect(au(yPane(76000) + HAUT_PANE)).toMatchObject({ etat: "offre", libelle: "Alerte de prix ↓ 76,601.83 · bord du support fort · niveau fixe, 7 jours" });
    // L'ordonnée du prix 76 500 DANS LE PANE est, depuis la racine, 40 px au-dessus de sa place :
    // 30 px au-dessus de la bande. Lue dans le mauvais repère, elle serait dans la bande.
    expect(au(yPane(76500))).toBeUndefined();
    expect(offreSousReticule(chart, BTC_4H, { paneId: "candle_pane", dataIndex: 1, y: yPane(76500) })?.etat).toBe("offre");
    // À 6 px au-dessus du bord haut : retenue ; à 7 px : refusée.
    expect(au(yPane(76601.83) + HAUT_PANE - 6)?.etat).toBe("offre");
    expect(au(yPane(76601.83) + HAUT_PANE - 7)).toBeUndefined();
    // Clic hors données (aucun indice de bougie) : rien.
    const sansIndice = { ...chart, convertFromPixel: () => [{}] } as unknown as Chart;
    expect(offreAuClic(sansIndice, BTC_4H, 200, yPane(76000) + HAUT_PANE)).toBeUndefined();
  });

  it("cours dans la zone : l'offre de l'encart et du menu est « franchi », son geste ne crée rien", () => {
    const dedans = fauxGraphe({ "sr-1": ANNOTATIONS_SR }, 76000);
    const offre = offreSousReticule(dedans, BTC_4H, { paneId: "candle_pane", dataIndex: 1, y: yPane(76000) })!;
    expect(offre).toMatchObject({ etat: "franchi", libelle: "Pas d'alerte : le cours a déjà franchi le bord du support fort (76,601.83)" });
    offre.executer();
    expect(alertsStore.getState().defs).toEqual([]);
  });

  it("suivreAlertes : prévient quand les définitions changent, pas pour une entrée de journal ; se désabonne", () => {
    const rappel = vi.fn();
    const arreter = suivreAlertes(rappel);
    alertsStore.getState().ajouterJournal({ alertId: "a", ts: 1, valeur: 1, message: "m" });
    expect(rappel).toHaveBeenCalledTimes(0);
    poserAlerteZone(chart, BTC_4H, support());
    expect(rappel).toHaveBeenCalledTimes(1);
    toastsStore.getState().toasts[0]?.action?.executer();
    expect(rappel).toHaveBeenCalledTimes(2);
    arreter();
    poserAlerteZone(chart, BTC_4H, support());
    expect(rappel).toHaveBeenCalledTimes(2);
  });
});
