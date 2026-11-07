import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { healthStore } from "../store/health";
import {
  API_USER_AGENT,
  ARTICLES_WIKI,
  DISPONIBILITE_PRUDENTE_JOURS,
  HISTORIQUE_JOURS,
  JOURS_ANNEE,
  JOUR_MS,
  TTL_CACHE_MS,
  analyserAttention,
  attentionRelative,
  chargerAttentionWiki,
  dernierJourComplet,
  episodesPics,
  niveauAttention,
  parsePagesVues,
  retardJours,
  serieContigue,
  titreArticle,
  urlPagesVues,
  zScoresGlissants,
  type EditionWiki,
  type SerieVues,
} from "./attentionWiki";

// Cache on-chain remplacé par une mémoire : aucun localStorage ni daemon en test.
const { memoire } = vi.hoisted(() => ({ memoire: new Map<string, { donnee: unknown; ts: number }>() }));
vi.mock("./onchain/cache", () => ({
  lireCache: vi.fn(async (cle: string) => memoire.get(cle) ?? null),
  ecrireCache: vi.fn(async (cle: string, donnee: unknown) => {
    memoire.set(cle, { donnee, ts: Date.now() });
  }),
}));

const jour = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const aaaammjj = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function aleatoire(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Série de vues bruitées autour de `base` (± 10 %), sans jour manquant. */
function vuesBruitees(n: number, base: number, graine: number): number[] {
  const r = aleatoire(graine);
  return Array.from({ length: n }, () => Math.round(base * (0.9 + 0.2 * r())));
}

/** Réponse JSON de l'API pour des couples (jour, vues). */
function reponseApi(edition: EditionWiki, titre: string, points: Array<[number, number]>): unknown {
  return {
    items: points.map(([t, v]) => ({
      project: `${edition}.wikipedia`,
      article: titre.replace(/ /g, "_"),
      granularity: "daily",
      timestamp: `${aaaammjj(t)}00`,
      access: "all-access",
      agent: "user",
      views: v,
    })),
  };
}

describe("table curée actif → article", () => {
  it("donne le titre par édition, null hors table ou sans titre sûr", () => {
    expect(titreArticle("BTC", "en")).toBe("Bitcoin");
    expect(titreArticle("BTC", "fr")).toBe("Bitcoin");
    expect(titreArticle("SOL", "en")).toBe("Solana (blockchain platform)");
    expect(titreArticle("SOL", "fr")).toBeNull();
    expect(titreArticle("PEPE", "en")).toBeNull();
    // Chaque actif a au moins son article anglais.
    for (const a of ARTICLES_WIKI) expect(a.titres.en).not.toBeNull();
  });
});

describe("URL et datation", () => {
  it("construit l'URL per-article bornée (hôte exact, agent user, quotidien)", () => {
    expect(urlPagesVues("Bitcoin", "en", jour("2023-11-07"), jour("2026-11-06"))).toBe(
      "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Bitcoin/daily/20231107/20261106",
    );
    expect(urlPagesVues("Solana (blockchain platform)", "en", jour("2026-01-01"), jour("2026-01-02"))).toContain(
      "/user/Solana_(blockchain_platform)/daily/",
    );
  });

  it("encode le titre : il ne peut pas sortir du segment d'article", () => {
    const url = new URL(urlPagesVues("../../x/y?z", "fr", jour("2026-01-01"), jour("2026-01-02")));
    expect(url.hostname).toBe("wikimedia.org");
    expect(url.search).toBe("");
    expect(url.pathname.startsWith("/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia/all-access/user/")).toBe(true);
    expect(url.pathname).toContain("..%2F..%2Fx%2Fy%3Fz");
  });

  it("le dernier jour complet est la veille UTC, jamais le jour en cours", () => {
    expect(dernierJourComplet(Date.parse("2026-11-07T00:30:00Z"))).toBe(jour("2026-11-06"));
    expect(dernierJourComplet(Date.parse("2026-11-07T23:59:59Z"))).toBe(jour("2026-11-06"));
    expect(retardJours(jour("2026-11-06"), Date.parse("2026-11-07T12:00:00Z"))).toBe(0);
    expect(retardJours(jour("2026-11-03"), Date.parse("2026-11-07T12:00:00Z"))).toBe(3);
  });
});

describe("CSP Vercel", () => {
  it("connect-src autorise l'hôte EXACT appelé en direct, sans joker", () => {
    const config = JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8")) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy-Report-Only");
    const connect = (csp?.value.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src")) ?? "").split(/\s+/);
    const origine = new URL(urlPagesVues("Bitcoin", "en", jour("2026-01-01"), jour("2026-01-02"))).origin;
    expect(origine).toBe("https://wikimedia.org");
    expect(connect).toContain(origine);
    expect(connect.filter((s) => s.includes("wikimedia") || s.includes("wikipedia"))).toEqual([origine]);
  });
});

describe("parsePagesVues", () => {
  const fin = jour("2026-11-06");

  it("garde les items valides et écarte le jour en cours (jamais complet)", () => {
    const json = reponseApi("en", "Bitcoin", [
      [jour("2026-11-05"), 1200],
      [jour("2026-11-06"), 1300],
      [jour("2026-11-07"), 40], // jour en cours, partiel
    ]);
    const vues = parsePagesVues(json, "en", "Bitcoin", fin);
    expect([...vues.entries()]).toEqual([
      [jour("2026-11-05"), 1200],
      [jour("2026-11-06"), 1300],
    ]);
  });

  it("écarte édition, article, agent, horodatage et vues invalides", () => {
    const base = { project: "en.wikipedia", article: "Bitcoin", granularity: "daily", agent: "user", access: "all-access" };
    const json = {
      items: [
        { ...base, timestamp: "2026110100", views: 10 },
        { ...base, project: "fr.wikipedia", timestamp: "2026110200", views: 11 },
        { ...base, article: "BTC", timestamp: "2026110300", views: 12 },
        { ...base, agent: "automated", timestamp: "2026110400", views: 13 },
        { ...base, timestamp: "2026110512", views: 14 }, // horaire, pas quotidien
        { ...base, timestamp: "2026023000", views: 15 }, // 30 février
        { ...base, timestamp: "2026103000", views: -1 },
        { ...base, timestamp: "2026103100", views: 2.5 },
        { ...base, timestamp: "2026102900", views: "16" },
      ],
    };
    expect([...parsePagesVues(json, "en", "Bitcoin", fin).entries()]).toEqual([[jour("2026-11-01"), 10]]);
  });

  it("lève sur une structure inexploitable", () => {
    expect(() => parsePagesVues({ type: "erreur" }, "en", "Bitcoin", fin)).toThrow(/items absents/);
    expect(() => parsePagesVues(null, "en", "Bitcoin", fin)).toThrow();
  });

  it("un jour absent reste non mesuré (null), jamais 0", () => {
    const points = new Map([
      [jour("2026-11-01"), 5],
      [jour("2026-11-03"), 0],
    ]);
    expect(serieContigue(points, jour("2026-11-01"), jour("2026-11-04"))).toEqual({
      debut: jour("2026-11-01"),
      vues: [5, null, 0, null],
    });
  });
});

describe("zScoresGlissants", () => {
  it("compare chaque jour aux W jours STRICTEMENT précédents (calcul à la main)", () => {
    // Fenêtre 4 sur [1, 2, 3, 4] : moyenne 2,5, écart-type échantillon √(5/3).
    const z = zScoresGlissants([1, 2, 3, 4, 10, 5], 4);
    expect(z.slice(0, 4)).toEqual([null, null, null, null]);
    expect(z[4]).toBeCloseTo((10 - 2.5) / Math.sqrt(5 / 3), 12);
    // Jour 5 : fenêtre [2, 3, 4, 10], le jour 5 lui-même n'y entre pas.
    const m = (2 + 3 + 4 + 10) / 4;
    const sd = Math.sqrt(((2 - m) ** 2 + (3 - m) ** 2 + (4 - m) ** 2 + (10 - m) ** 2) / 3);
    expect(z[5]).toBeCloseTo((5 - m) / sd, 12);
  });

  it("non mesuré si le jour manque, si la couverture est insuffisante ou l'écart-type nul", () => {
    expect(zScoresGlissants([1, 2, 3, 4, null], 4)[4]).toBeNull();
    // 2 jours mesurés sur 4 < 80 % → null.
    expect(zScoresGlissants([1, null, null, 4, 9], 4)[4]).toBeNull();
    // 4 jours sur 5 = 80 % → mesuré.
    expect(zScoresGlissants([1, 2, null, 4, 5, 9], 5)[5]).not.toBeNull();
    expect(zScoresGlissants([3, 3, 3, 3, 9], 4)[4]).toBeNull();
  });

  it("causalité : le résultat sur un préfixe ne change pas quand on ajoute des jours", () => {
    const logs = vuesBruitees(900, 50_000, 7).map((v) => Math.log1p(v));
    const complet = zScoresGlissants(logs, 365);
    for (const n of [365, 366, 500, 731, 899]) {
      expect(zScoresGlissants(logs.slice(0, n), 365)).toEqual(complet.slice(0, n));
    }
    // Modifier le futur ne touche aucune valeur passée.
    const altere = [...logs];
    altere[800] = 99;
    expect(zScoresGlissants(altere, 365).slice(0, 800)).toEqual(complet.slice(0, 800));
  });
});

describe("épisodes de pic et analyse", () => {
  const debut = jour("2024-01-01");

  /** Série bruitée avec des pics (× 20) aux indices donnés. */
  function serieAvecPics(n: number, pics: number[], graine = 3): SerieVues {
    const vues: (number | null)[] = vuesBruitees(n, 40_000, graine);
    for (const i of pics) vues[i] = 800_000;
    return { debut, vues };
  }

  it("un épisode par tranche de 30 j, daté au jour compté et connu le lendemain", () => {
    const serie = serieAvecPics(600, [400, 410, 450]);
    const z = zScoresGlissants(serie.vues.map((v) => (v === null ? null : Math.log1p(v))), 365);
    const pics = episodesPics(serie, z);
    expect(pics.map((p) => p.jour)).toEqual([debut + 400 * JOUR_MS, debut + 450 * JOUR_MS]);
    expect(pics[0]!.connuLe).toBe(pics[0]!.jour + JOUR_MS);
    // Publication à D+1 = borne BASSE ; la date causale prudente est la clôture de D+1 (D+2 00:00 UTC).
    expect(DISPONIBILITE_PRUDENTE_JOURS).toBe(2);
    expect(pics[0]!.disponibleLe).toBe(pics[0]!.jour + 2 * JOUR_MS);
    expect(pics.every((p) => p.disponibleLe > p.connuLe)).toBe(true);
    expect(pics[0]!.vues).toBe(800_000);
    expect(pics[0]!.z).toBeGreaterThan(3);
    // Préfixe : les épisodes connus à l'indice 420 sont un préfixe des épisodes complets.
    const prefixe = { debut, vues: serie.vues.slice(0, 421) };
    expect(episodesPics(prefixe, z.slice(0, 421))).toEqual(pics.slice(0, 1));
  });

  it("lit l'attention au dernier jour mesuré : pic, ratio 7 j / 90 j, pics sur 365 j", () => {
    const serie = serieAvecPics(800, [500, 799]);
    const a = analyserAttention(serie);
    expect(a.dernierJour).toBe(debut + 799 * JOUR_MS);
    expect(a.connuLe).toBe(debut + 800 * JOUR_MS);
    expect(a.vuesDernierJour).toBe(800_000);
    expect(a.z365).toBeGreaterThan(3);
    expect(a.z90).toBeGreaterThan(3);
    expect(a.niveau).toBe("pic");
    expect(a.ratio7j90j).toBeGreaterThan(1);
    expect(a.picsSur365j).toBe(2);
    expect(a.joursZ365Mesures).toBe(JOURS_ANNEE);
    expect(a.couverture).toEqual({ joursMesures: 800, joursAttendus: 800 });
  });

  it("le dernier jour non publié est sauté, jamais lu comme 0", () => {
    const serie = serieAvecPics(800, []);
    serie.vues[799] = null;
    const a = analyserAttention(serie);
    expect(a.dernierJour).toBe(debut + 798 * JOUR_MS);
    expect(a.vuesDernierJour).toBe(serie.vues[798]);
    expect(a.z365).not.toBeNull();
    expect(a.niveau).not.toBeNull();
    expect(a.couverture.joursMesures).toBe(799);
  });

  it("historique trop court : z 365 j non mesuré (null), z 90 j mesuré, pics de l'année non mesurés (jamais 0)", () => {
    const a = analyserAttention({ debut, vues: vuesBruitees(200, 40_000, 5) });
    expect(a.z365).toBeNull();
    expect(a.niveau).toBeNull();
    expect(a.z90).not.toBeNull();
    // Aucun jour de l'année n'a de z 365 j : un décompte « 0 pic » serait inventé.
    expect(a.joursZ365Mesures).toBe(0);
    expect(a.picsSur365j).toBeNull();
  });

  it("z 365 j mesuré sur une partie de l'année : décompte partiel avec sa couverture", () => {
    // 500 jours : le z 365 j existe à partir de l'indice 365, soit 135 des 365 derniers jours.
    const a = analyserAttention({ debut, vues: vuesBruitees(500, 40_000, 6) });
    expect(a.z365).not.toBeNull();
    expect(a.joursZ365Mesures).toBe(135);
    expect(a.picsSur365j).toBe(0);
    // Jours omis par la source (titre de redirection, vues faibles) : la couverture baisse encore.
    const troue = vuesBruitees(800, 40_000, 7).map((v, i) => (i >= 500 && i % 3 === 0 ? null : v));
    const b = analyserAttention({ debut, vues: troue });
    expect(b.joursZ365Mesures).toBeGreaterThan(0);
    expect(b.joursZ365Mesures).toBeLessThan(JOURS_ANNEE);
    expect(b.picsSur365j).not.toBeNull();
  });

  it("couverture insuffisante sur toute l'année : pics de l'année non mesurés", () => {
    // Un jour sur deux omis depuis l'indice 300 : chaque fenêtre de 365 j finissant dans l'année
    // finale est mesurée à moins de 80 %, donc aucun z 365 j sur les 365 derniers jours.
    const vues = vuesBruitees(900, 40_000, 8).map((v, i) => (i >= 300 && i % 2 === 1 ? null : v));
    const a = analyserAttention({ debut, vues });
    expect(a.dernierJour).not.toBeNull();
    expect(a.z365).toBeNull();
    expect(a.joursZ365Mesures).toBe(0);
    expect(a.picsSur365j).toBeNull();
  });

  it("série sans aucun jour mesuré : tout non mesuré", () => {
    const a = analyserAttention({ debut, vues: [null, null, null] });
    expect(a).toMatchObject({
      dernierJour: null,
      vuesDernierJour: null,
      z365: null,
      ratio7j90j: null,
      niveau: null,
      picsSur365j: null,
      joursZ365Mesures: 0,
    });
    expect(a.couverture).toEqual({ joursMesures: 0, joursAttendus: 3 });
  });

  it("niveaux descriptifs du z-score", () => {
    expect(niveauAttention(null)).toBeNull();
    expect(niveauAttention(3.2)).toBe("pic");
    expect(niveauAttention(1.6)).toBe("elevee");
    expect(niveauAttention(0)).toBe("normale");
    expect(niveauAttention(-2)).toBe("eteinte");
  });
});

describe("attentionRelative", () => {
  it("aligne par date, rapporte les vues 7 j de l'alt à BTC et détecte un regain relatif", () => {
    const btc: SerieVues = { debut: jour("2024-01-01"), vues: vuesBruitees(700, 50_000, 11) };
    // L'alt commence 10 jours plus tard : l'alignement doit se faire par date, pas par position.
    const vuesAlt: (number | null)[] = vuesBruitees(690, 10_000, 12);
    for (let i = 683; i < 690; i += 1) vuesAlt[i] = 60_000; // 7 derniers jours : afflux
    const alt: SerieVues = { debut: jour("2024-01-11"), vues: vuesAlt };
    const r = attentionRelative(alt, btc);
    expect(r.dernierJourCommun).toBe(jour("2024-01-01") + 699 * JOUR_MS);
    const sommeBtc = (btc.vues.slice(693, 700) as number[]).reduce((s, v) => s + v, 0);
    expect(r.partVsBtc7j).toBeCloseTo((7 * 60_000) / sommeBtc, 12);
    expect(r.zRatio365).toBeGreaterThan(3);
  });

  it("sans jours communs : non mesuré", () => {
    const a: SerieVues = { debut: jour("2024-01-01"), vues: [1, 2] };
    const b: SerieVues = { debut: jour("2025-01-01"), vues: [1, 2] };
    expect(attentionRelative(a, b)).toEqual({ dernierJourCommun: null, partVsBtc7j: null, zRatio365: null });
  });
});

describe("chargerAttentionWiki (fetch bouchonné, aucun réseau)", () => {
  const maintenant = Date.parse("2026-11-07T12:00:00Z");
  const fin = jour("2026-11-06");
  const debut = fin - (HISTORIQUE_JOURS - 1) * JOUR_MS;

  /** Réponse complète Bitcoin en, plus un point du jour en cours qui doit être écarté. */
  function reponseBitcoin(): Response {
    const points: Array<[number, number]> = [];
    for (let t = debut; t <= fin; t += JOUR_MS) points.push([t, 30_000]);
    points.push([jour("2026-11-07"), 12]);
    return new Response(JSON.stringify(reponseApi("en", "Bitcoin", points)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(() => {
    memoire.clear();
    healthStore.getState().retirer("wikimedia");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appelle l'URL bornée avec Api-User-Agent, s'arrête à la veille et met en cache", async () => {
    const fetchMock = vi.fn(async () => reponseBitcoin());
    vi.stubGlobal("fetch", fetchMock);
    const r = await chargerAttentionWiki("BTC", "en", { maintenant });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(urlPagesVues("Bitcoin", "en", debut, fin));
    const entetes = new Headers(init.headers);
    expect(entetes.get("Api-User-Agent")).toBe(API_USER_AGENT);
    expect(/^[\x20-\x7e]+$/.test(API_USER_AGENT)).toBe(true);
    expect(API_USER_AGENT).not.toContain("@");
    expect(init.credentials).toBe("omit");
    expect(r.serie.debut).toBe(debut);
    expect(r.serie.vues).toHaveLength(HISTORIQUE_JOURS);
    expect(r.serie.vues.at(-1)).toBe(30_000); // le 12 du jour en cours n'apparaît pas
    expect(r.perime).toBe(false);
    expect(r.recupereLe).toBe(maintenant);
    expect(memoire.get("attentionWiki:v1:en:BTC")?.donnee).toEqual({ titre: "Bitcoin", debut, vues: r.serie.vues });
    expect(healthStore.getState().sources.wikimedia?.etat).toBe("polling");
  });

  it("cache frais servi sans réseau", async () => {
    memoire.set("attentionWiki:v1:en:BTC", { donnee: { titre: "Bitcoin", debut, vues: [1, 2, 3] }, ts: maintenant - 3_600_000 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await chargerAttentionWiki("BTC", "en", { maintenant });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ perime: false, recupereLe: maintenant - 3_600_000, serie: { debut, vues: [1, 2, 3] } });
  });

  it("source en échec : cache périmé resservi et étiqueté, santé en erreur", async () => {
    memoire.set("attentionWiki:v1:en:BTC", {
      donnee: { titre: "Bitcoin", debut, vues: [1, 2, 3] },
      ts: maintenant - TTL_CACHE_MS - 1,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("panne", { status: 503 })));
    const r = await chargerAttentionWiki("BTC", "en", { maintenant });
    expect(r.perime).toBe(true);
    expect(r.serie.vues).toEqual([1, 2, 3]);
    expect(healthStore.getState().sources.wikimedia).toMatchObject({
      etat: "error",
      derniereErreur: "Wikimedia indisponible (HTTP 503).",
    });
  });

  it("sans cache : l'erreur remonte avec un message lisible (404 titre, 429 quota)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(chargerAttentionWiki("ETH", "fr", { maintenant })).rejects.toThrow(/HTTP 404/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(chargerAttentionWiki("ETH", "fr", { maintenant })).rejects.toThrow("Quota Wikimedia atteint (HTTP 429).");
  });

  it("réponse sans aucun jour exploitable : erreur, pas une série de zéros", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    await expect(chargerAttentionWiki("BTC", "en", { maintenant })).rejects.toThrow(/vide/);
    expect(memoire.size).toBe(0);
  });

  it("pré-vol refusé (TypeError) : un seul nouvel essai en requête simple", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(reponseBitcoin());
    vi.stubGlobal("fetch", fetchMock);
    const r = await chargerAttentionWiki("BTC", "en", { maintenant });
    expect(r.perime).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init2 = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(new Headers(init2.headers).has("Api-User-Agent")).toBe(false);
  });

  it("réseau coupé deux fois : message réseau ou CORS", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(chargerAttentionWiki("BTC", "en", { maintenant })).rejects.toThrow("Wikimedia injoignable (réseau ou CORS).");
  });

  it("actif hors table ou édition sans titre : refus SANS requête", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(chargerAttentionWiki("PEPE", "en", { maintenant })).rejects.toThrow(/Aucun article/);
    await expect(chargerAttentionWiki("SOL", "fr", { maintenant })).rejects.toThrow(/Aucun article/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("entrée de cache d'une autre forme (titre, longueur) ignorée", async () => {
    memoire.set("attentionWiki:v1:en:BTC", {
      donnee: { titre: "BTC", debut, vues: [1] },
      ts: maintenant,
    });
    memoire.set("attentionWiki:v1:en:ETH", {
      donnee: { titre: "Ethereum", debut, vues: new Array(HISTORIQUE_JOURS + 1).fill(1) },
      ts: maintenant,
    });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chargerAttentionWiki("BTC", "en", { maintenant })).rejects.toThrow(/HTTP 500/);
    await expect(chargerAttentionWiki("ETH", "en", { maintenant })).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("annulation : remonte sans marquer la source en erreur", async () => {
    const controleur = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controleur.abort();
        throw new DOMException("Annulé", "AbortError");
      }),
    );
    await expect(chargerAttentionWiki("BTC", "en", { maintenant, signal: controleur.signal })).rejects.toThrow();
    expect(healthStore.getState().sources.wikimedia).toBeUndefined();
  });
});
