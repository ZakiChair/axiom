/**
 * Chargeur intrabar (SUG-3, phase 1) : choix de la source et de la résolution, plafond
 * de requêtes, contrôle de cohérence parente/sous-bougies, causalité (bougie en cours,
 * kline non close au téléchargement, préfixe, replay), cache LRU borné, baux et refus
 * « cache saturé », borne de requêtes dans la durée avec plusieurs surfaces rendues en
 * continu, délai maximal et pause après échec, anti-rebond.
 * Aucun appel réseau : `fetch` est une doublure qui sert un marché déterministe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "@axiom/types";
import {
  ANTI_REBOND_MS,
  BAIL_MS,
  CAPACITE_BLOCS,
  ChargeurIntrabar,
  DELAI_REQUETE_MS,
  LIBELLE_RESOLUTION,
  PLAFOND_REQUETES,
  REESSAI_MS,
  aplatirIntrabar,
  creerClientIntrabar,
  ligneVersSousBougie,
  planifierIntrabar,
  regrouperParBougie,
  sourceIntrabar,
  type ClientIntrabar,
  type IdentiteIntrabar,
  type PlanIntrabar,
  type VueIntrabar,
} from "./intrabar";

const MIN = 60_000;
const H1 = 60 * MIN;
const H4 = 4 * 60 * MIN;
const JOUR = 24 * 60 * MIN;
/** « Maintenant » des tests : 7 nov. 2026 12:07 UTC (au milieu d'une bougie 4h). */
const MAINTENANT = Date.UTC(2026, 10, 7, 12, 7, 0);
const SPOT = { marche: "spot", symbole: "BTCUSDT" } as const;

// ───────────────────────────── Marché déterministe ─────────────────────────────

function frac(x: number): number {
  return x - Math.floor(x);
}

/** Bougie 1m déterministe (fonction du seul instant) : toutes les unités en dérivent. */
function minute(t: number): Candle {
  const k = t / MIN;
  const base = 100 + 10 * Math.sin(k / 700);
  const open = base + frac(Math.sin(k) * 43758.5453) - 0.5;
  const close = base + frac(Math.sin(k + 0.5) * 12543.123) - 0.5;
  const volume = 1 + 3 * frac(Math.sin(k * 1.7) * 9871.77);
  const buyVolume = volume * frac(Math.sin(k * 2.3) * 3141.59);
  return {
    time: t,
    open,
    high: Math.max(open, close) + 0.2,
    low: Math.min(open, close) - 0.2,
    close,
    volume,
    buyVolume,
    sellVolume: volume - buyVolume,
    closed: true,
  };
}

/** Bougie d'unité `duree` agrégée depuis les minutes (somme dans l'ordre du temps). */
function agreger(t0: number, duree: number, maintenant = MAINTENANT): Candle {
  let open = 0;
  let close = 0;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let buyVolume = 0;
  for (let t = t0; t < t0 + duree; t += MIN) {
    const m = minute(t);
    if (t === t0) open = m.open;
    close = m.close;
    if (m.high > high) high = m.high;
    if (m.low < low) low = m.low;
    volume += m.volume;
    buyVolume += m.buyVolume ?? 0;
  }
  return {
    time: t0,
    open,
    high,
    low,
    close,
    volume,
    buyVolume,
    sellVolume: volume - buyVolume,
    closed: t0 + duree <= maintenant,
  };
}

/** Bougies parentes alignées se terminant par la bougie en cours (closed: false). */
function parentes(duree: number, nombre: number, maintenant = MAINTENANT): Candle[] {
  const derniere = Math.floor(maintenant / duree) * duree;
  const out: Candle[] = [];
  for (let i = nombre - 1; i >= 0; i--) out.push(agreger(derniere - i * duree, duree, maintenant));
  return out;
}

/** Ligne brute /klines (12 champs, nombres en chaînes) d'une bougie. */
function ligne(c: Candle, duree: number): unknown[] {
  return [
    c.time,
    String(c.open),
    String(c.high),
    String(c.low),
    String(c.close),
    String(c.volume),
    c.time + duree - 1,
    "0",
    10,
    String(c.buyVolume),
    "0",
    "0",
  ];
}

const DUREES: Record<string, number> = { "1m": MIN, "5m": 5 * MIN, "15m": 15 * MIN, "1h": 60 * MIN, "4h": H4, "1d": JOUR };

/**
 * Doublure de `fetch` façon Binance : sert [startTime, endTime] à l'unité demandée,
 * bougie en cours COMPRISE (comme l'API), au plus `limit` lignes, après `latenceMs` de
 * transit (0 : microtâche). Relève les URL et le nombre maximal de requêtes simultanées.
 */
function serveur(horloge: () => number = () => MAINTENANT, latenceMs = 0) {
  const urls: string[] = [];
  let enVol = 0;
  let maxEnVol = 0;
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    enVol += 1;
    maxEnVol = Math.max(maxEnVol, enVol);
    // Latence simulée (minuterie factice) : sans elle, chaque plan serait entièrement en
    // cache avant que le minuteur suivant parte, et la réservation des blocs en vol
    // ne serait jamais exercée.
    if (latenceMs > 0) await new Promise((r) => setTimeout(r, latenceMs));
    else await Promise.resolve();
    const q = new URL(url, "http://local").searchParams;
    const duree = DUREES[q.get("interval") ?? ""] ?? MIN;
    const debut = Number(q.get("startTime"));
    const fin = Number(q.get("endTime"));
    const limite = Number(q.get("limit"));
    const lignes: unknown[] = [];
    for (let t = Math.ceil(debut / duree) * duree; t <= fin && lignes.length < limite; t += duree) {
      if (t > horloge()) break; // pas de bougie future
      lignes.push(ligne(agreger(t, duree, horloge()), duree));
    }
    enVol -= 1;
    return new Response(JSON.stringify(lignes), { status: 200 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, urls, maxEnVol: () => maxEnVol, appels: fetchFn };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ───────────────────────────── Source et plan ─────────────────────────────

describe("sourceIntrabar", () => {
  it("sert le spot Binance et refuse les autres places (repli explicite)", () => {
    expect(sourceIntrabar("binance", "btcusdt")).toEqual({ marche: "spot", symbole: "BTCUSDT" });
    for (const ex of ["bybit", "okx", "hyperliquid", "coinbase", "kraken", "twelvedata", "mexc", "synthetic"] as const) {
      expect(sourceIntrabar(ex, "BTCUSDT")).toBeNull();
    }
    expect(sourceIntrabar("binance", "BTC|ETH")).toBeNull();
  });
});

describe("planifierIntrabar", () => {
  it("60 j de 4h : 15m sous le plafond, là où le 1m coûterait 87 requêtes", () => {
    const bougies = parentes(H4, 360);
    const plan = planifierIntrabar(SPOT, H4, bougies, 0, bougies.length, MAINTENANT);
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.resolution).toBe("15m");
    expect(plan.blocs.length).toBeLessThanOrEqual(PLAFOND_REQUETES);
    expect(plan.blocs.length).toBeGreaterThanOrEqual(6);
    // Témoin : la même plage en 1m demanderait ≥ 86 blocs de 1 000 minutes.
    expect(Math.ceil((plan.fin - plan.debut) / (1_000 * MIN))).toBeGreaterThanOrEqual(86);
    // La bougie en cours (dernière) est exclue : le plan s'arrête au début de celle-ci.
    expect(plan.fin).toBe(bougies.at(-1)?.time);
  });

  it("plage courte : 1m ; unité journalière longue : 4h ; 1m : aucune unité plus fine", () => {
    const courtes = parentes(5 * MIN, 120);
    const p1 = planifierIntrabar(SPOT, 5 * MIN, courtes, 0, courtes.length, MAINTENANT);
    expect(typeof p1 !== "string" && p1.resolution).toBe("1m");

    const jours = parentes(JOUR, 500);
    const p2 = planifierIntrabar(SPOT, JOUR, jours, 0, jours.length, MAINTENANT);
    expect(typeof p2 !== "string" && p2.resolution).toBe("4h");

    const minutes = parentes(MIN, 100);
    expect(planifierIntrabar(SPOT, MIN, minutes, 0, minutes.length, MAINTENANT)).toBe("aucune unité plus fine");
  });

  it("plage trop longue même au plus grossier : aucun plan (pas de rafale de requêtes)", () => {
    const semaines = Array.from({ length: 2_200 }, (_, i) => ({ time: i * 7 * JOUR, closed: true }));
    expect(planifierIntrabar(SPOT, 7 * JOUR, semaines, 0, semaines.length, 3_000 * 7 * JOUR)).toBe("plage trop longue");
  });

  it("aucune bougie clôturée (seule la bougie en cours visible)", () => {
    const bougies = parentes(H4, 10);
    expect(planifierIntrabar(SPOT, H4, bougies, 9, 10, MAINTENANT)).toBe("aucune bougie clôturée");
  });

  it("perp : blocs de 1 500 sous-bougies", () => {
    const bougies = parentes(H4, 360);
    const spot = planifierIntrabar(SPOT, H4, bougies, 0, bougies.length, MAINTENANT);
    const perp = planifierIntrabar({ marche: "perp", symbole: "BTCUSDT" }, H4, bougies, 0, bougies.length, MAINTENANT);
    if (typeof spot === "string" || typeof perp === "string") throw new Error("plan attendu");
    expect(perp.resolution).toBe("15m");
    expect(perp.blocs.length).toBeLessThan(spot.blocs.length);
  });
});

// ───────────────────────────── Lecture des lignes ─────────────────────────────

describe("ligneVersSousBougie", () => {
  const c = minute(MAINTENANT - 10 * MIN);

  it("lit k[9] (volume acheteur taker) et en déduit le vendeur", () => {
    const s = ligneVersSousBougie(ligne(c, MIN), MAINTENANT);
    expect(s?.buyVolume).toBe(c.buyVolume);
    expect(s?.sellVolume).toBeCloseTo((c.volume - (c.buyVolume ?? 0)), 12);
    expect(s?.closed).toBe(true);
  });

  it("écarte la kline encore ouverte au téléchargement (closeTime ≥ instant de chargement)", () => {
    const enCours = minute(Math.floor(MAINTENANT / MIN) * MIN);
    expect(ligneVersSousBougie(ligne(enCours, MIN), MAINTENANT)).toBeNull();
  });

  it("écarte les lignes malformées ou incohérentes", () => {
    expect(ligneVersSousBougie([1, "a"], MAINTENANT)).toBeNull();
    expect(ligneVersSousBougie("x", MAINTENANT)).toBeNull();
    const l = ligne(c, MIN);
    l[9] = String(c.volume * 2); // acheteur > volume
    expect(ligneVersSousBougie(l, MAINTENANT)).toBeNull();
  });
});

// ───────────────────────────── Regroupement ─────────────────────────────

function sousBougies(debut: number, fin: number, duree: number, maintenant = MAINTENANT): Candle[] {
  const out: Candle[] = [];
  for (let t = debut; t + duree <= Math.min(fin, maintenant); t += duree) out.push(agreger(t, duree, maintenant));
  return out;
}

describe("regrouperParBougie / aplatirIntrabar", () => {
  const bougies = parentes(H4, 6);
  const debut = bougies[0]?.time ?? 0;
  const tous = sousBougies(debut, MAINTENANT, 15 * MIN);

  it("remplace chaque parente clôturée par ses 16 sous-bougies 15m, jamais la bougie en cours", () => {
    const groupes = regrouperParBougie(bougies, 0, bougies.length, H4, tous, MAINTENANT);
    expect(groupes.size).toBe(5);
    expect(groupes.has(bougies.at(-1)?.time ?? -1)).toBe(false);
    for (const membres of groupes.values()) expect(membres).toHaveLength(16);
    const plat = aplatirIntrabar(bougies, 0, bougies.length, groupes);
    expect(plat).toHaveLength(5 * 16 + 1);
    expect(plat.at(-1)).toBe(bougies.at(-1)); // bougie en cours : ancien calcul
    const volPlat = plat.reduce((s, c) => s + c.volume, 0);
    const volParentes = bougies.reduce((s, c) => s + c.volume, 0);
    expect(volPlat).toBeCloseTo(volParentes, 6);
  });

  it("sous-bougie manquante ou hors du [bas, haut] de la parente : repli sur la parente", () => {
    const sansUne = tous.filter((_, i) => i !== 3);
    const groupes = regrouperParBougie(bougies, 0, bougies.length, H4, sansUne, MAINTENANT);
    expect(groupes.has(bougies[0]?.time ?? -1)).toBe(false);
    expect(groupes.size).toBe(4);

    const deformees = tous.map((s, i) => (i === 20 ? { ...s, high: s.high + 1_000 } : s));
    const g2 = regrouperParBougie(bougies, 0, bougies.length, H4, deformees, MAINTENANT);
    expect(g2.has(bougies[1]?.time ?? -1)).toBe(false);
  });

  it("parente close depuis moins de la marge de publication : pas encore remplacée", () => {
    const fin = bougies.at(-1)?.time ?? 0; // fin de l'avant-dernière parente
    const groupes = regrouperParBougie(bougies, 0, bougies.length, H4, tous, fin + 500);
    expect(groupes.has(bougies[4]?.time ?? -1)).toBe(false);
  });

  it("causalité par préfixe : ajouter des bougies ne change pas le résultat des premières", () => {
    const court = parentes(H4, 6, MAINTENANT - 2 * H4);
    const long = parentes(H4, 8, MAINTENANT);
    const subsCourt = sousBougies(court[0]?.time ?? 0, MAINTENANT - 2 * H4, 15 * MIN, MAINTENANT - 2 * H4);
    const subsLong = sousBougies(long[0]?.time ?? 0, MAINTENANT, 15 * MIN);
    const gCourt = regrouperParBougie(court, 0, 5, H4, subsCourt, MAINTENANT - 2 * H4);
    const gLong = regrouperParBougie(long, 0, 5, H4, subsLong, MAINTENANT);
    expect(aplatirIntrabar(long, 0, 5, gLong)).toEqual(aplatirIntrabar(court, 0, 5, gCourt));
  });
});

// ───────────────────────────── Chargeur ─────────────────────────────

function planDe(bougies: Candle[], from = 0, to = bougies.length, maintenant = MAINTENANT): PlanIntrabar {
  const plan = planifierIntrabar(SPOT, H4, bougies, from, to, maintenant);
  if (typeof plan === "string") throw new Error(plan);
  return plan;
}

describe("ChargeurIntrabar", () => {
  it("interroge le spot Binance par blocs alignés, une requête à la fois, puis sert le cache", async () => {
    const srv = serveur();
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 360);
    const plan = planDe(bougies);
    expect(chargeur.lire(plan).aCharger).toEqual(plan.blocs);

    await chargeur.charger(plan);
    expect(chargeur.requetes).toBe(plan.blocs.length);
    expect(chargeur.requetes).toBeLessThanOrEqual(PLAFOND_REQUETES);
    expect(srv.maxEnVol()).toBe(1);
    const url = new URL(srv.urls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.binance.com/api/v3/klines");
    expect(url.searchParams.get("interval")).toBe("15m");
    expect(url.searchParams.get("limit")).toBe("1000");
    expect(url.searchParams.get("symbol")).toBe("BTCUSDT");

    const lecture = chargeur.lire(plan);
    expect(lecture.aCharger).toEqual([]);
    expect(lecture.erreur).toBe(false);
    const groupes = regrouperParBougie(bougies, 0, bougies.length, H4, lecture.sous, MAINTENANT);
    expect(groupes.size).toBe(359); // toutes les clôturées

    await chargeur.charger(plan);
    expect(chargeur.requetes).toBe(plan.blocs.length); // aucun nouvel appel
  });

  it("perp : fapi/v1/klines via extUrl, 1 500 par requête", async () => {
    const srv = serveur();
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 20);
    const plan = planifierIntrabar({ marche: "perp", symbole: "BTCUSDT" }, H4, bougies, 0, 20, MAINTENANT);
    if (typeof plan === "string") throw new Error(plan);
    await chargeur.charger(plan);
    expect(srv.urls[0]).toContain("fapi.binance.com/fapi/v1/klines?");
    expect(new URL(srv.urls[0] ?? "", "http://local").searchParams.get("limit")).toBe("1500");
  });

  // Deux plages 5m disjointes (100 bougies 4h chacune, sans bloc commun).
  const longues = parentes(H4, 400);
  const ancien = planDe(longues, 0, 100);
  const recent = planDe(longues, 200, 300);

  it("cache LRU borné : sans bail, le bloc le moins récemment lu part", async () => {
    const srv = serveur();
    const capacite = ancien.blocs.length + 2;
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT, capacite });
    expect(ancien.resolution).toBe("5m");
    expect(ancien.blocs.some((b) => recent.blocs.includes(b))).toBe(false);
    await chargeur.charger(ancien);
    await chargeur.charger(recent); // admis : aucun bail ne retient les blocs de l'ancienne plage
    expect(chargeur.taille).toBe(capacite);
    expect(chargeur.lire(recent).aCharger).toEqual([]);
    expect(chargeur.lire(ancien).aCharger).toHaveLength(ancien.blocs.length + recent.blocs.length - capacite);
  });

  it("bail : les blocs d'un client actif ne sont jamais évincés, le plan qui ne tient pas est refusé sans requête", async () => {
    const srv = serveur();
    let maintenant = MAINTENANT;
    const capacite = ancien.blocs.length + 2;
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => maintenant, capacite });
    chargeur.lire(ancien, 1);
    await chargeur.charger(ancien);
    expect(chargeur.requetes).toBe(ancien.blocs.length);

    const refus = chargeur.lire(recent, 2);
    expect(refus.sature).toBe(true);
    expect(refus.aCharger).toEqual([]); // tout ou rien : pas de couverture grignotée
    await chargeur.charger(recent);
    expect(chargeur.requetes).toBe(ancien.blocs.length);
    expect(chargeur.lire(ancien, 1).aCharger).toEqual([]); // intacte

    // Bail expiré (client 1 muet depuis plus de BAIL_MS) : ses blocs redeviennent évinçables.
    maintenant += BAIL_MS + 1;
    expect(chargeur.lire(recent, 2).sature).toBe(false);
    // Bail rendu explicitement (dispose) : même effet, sans attendre.
    maintenant = MAINTENANT;
    chargeur.lire(ancien, 1);
    expect(chargeur.lire(recent, 2).sature).toBe(true);
    chargeur.liberer(1);
    const admis = chargeur.lire(recent, 2);
    expect(admis.sature).toBe(false);
    expect(admis.aCharger).toEqual(recent.blocs);
  });

  it("échec réseau : état explicite, une seule requête, pas de nouvel essai avant la pause", async () => {
    let maintenant = MAINTENANT;
    const fetchFn = vi.fn(async () => new Response("", { status: 451 }));
    const chargeur = new ChargeurIntrabar({ fetch: fetchFn as unknown as typeof fetch, maintenant: () => maintenant });
    const plan = planDe(parentes(H4, 20));
    expect(plan.blocs.length).toBeGreaterThan(1);
    await chargeur.charger(plan);
    // Le premier échec pose la pause : les autres blocs de la file ne touchent pas le réseau.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const lecture = chargeur.lire(plan);
    expect(lecture.erreur).toBe(true);
    expect(lecture.aCharger).toEqual([]);
    expect(lecture.sous).toEqual([]);
    maintenant += REESSAI_MS + 1_000;
    expect(chargeur.lire(plan).aCharger).toEqual(plan.blocs);
  });

  it("échecs répétés : pause doublée (1 min, 2 min…), remise à 1 min au premier succès", async () => {
    let maintenant = MAINTENANT;
    let enPanne = true;
    const srv = serveur();
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      enPanne ? new Response("", { status: 429 }) : srv.fetchFn(input),
    );
    const chargeur = new ChargeurIntrabar({ fetch: fetchFn as unknown as typeof fetch, maintenant: () => maintenant });
    const plan = planDe(parentes(H4, 20));
    await chargeur.charger(plan); // échec 1 : pause 1 min
    maintenant += REESSAI_MS + 1;
    await chargeur.charger(plan); // échec 2 : pause 2 min
    expect(fetchFn).toHaveBeenCalledTimes(2);
    maintenant += REESSAI_MS + 1;
    expect(chargeur.lire(plan).erreur).toBe(true); // toujours en pause après 1 min
    await chargeur.charger(plan);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    maintenant += REESSAI_MS;
    enPanne = false;
    await chargeur.charger(plan); // succès : la pause repart de 1 min
    expect(chargeur.lire(plan).aCharger).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2 + plan.blocs.length);
    enPanne = true;
    await chargeur.charger(recent); // nouvel échec : pause de 1 min, pas 4
    maintenant += REESSAI_MS + 1;
    expect(chargeur.lire(recent).aCharger).toEqual(recent.blocs);
  });

  it("kline close PENDANT le transit : écartée, et le bloc reste à rafraîchir (instant relevé avant l'envoi)", async () => {
    // Requête partie 500 ms avant la clôture P de la parente 08:00–12:00 ; réponse générée
    // à l'envoi (kline 11:59 encore ouverte, volume partiel), reçue 3 s après P. Le bloc
    // 1m [21:20, 14:00) couvre la plage du plan et la parente en cours.
    const P = Date.UTC(2026, 10, 7, 12, 0, 0);
    let maintenant = P - 500;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const genereA = maintenant;
      const q = new URL(String(input), "http://local").searchParams;
      const lignes: unknown[] = [];
      for (let t = Number(q.get("startTime")); t <= Number(q.get("endTime")) && t <= genereA; t += MIN) {
        const m = agreger(t, MIN, genereA);
        lignes.push(ligne(t + MIN > genereA ? { ...m, volume: m.volume / 2 } : m, MIN));
      }
      maintenant = P + 3_000; // transit
      return new Response(JSON.stringify(lignes), { status: 200 });
    });
    const chargeur = new ChargeurIntrabar({ fetch: fetchFn as unknown as typeof fetch, maintenant: () => maintenant });
    const avant = parentes(H4, 3, maintenant); // 00:00, 04:00, 08:00 (en cours)
    const planAvant = planDe(avant, 0, avant.length, maintenant);
    expect(planAvant.resolution).toBe("1m");
    expect(planAvant.blocs).toHaveLength(1);
    await chargeur.charger(planAvant);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(maintenant).toBe(P + 3_000);

    // La parente 08:00–12:00 est close depuis plus que la marge, dans le même bloc.
    const apres = parentes(H4, 3, maintenant);
    const plan = planDe(apres, 0, apres.length, maintenant);
    expect(plan.blocs).toEqual(planAvant.blocs);
    const lecture = chargeur.lire(plan);
    // La kline 11:59, ouverte quand la réponse a été produite, n'a pas été retenue…
    expect(lecture.sous.some((c) => c.time === P - MIN)).toBe(false);
    // … et le bloc est redemandé : seul le rafraîchissement explique cette requête.
    expect(lecture.aCharger).toEqual(plan.blocs);
  });

  it("bloc chargé avant la clôture d'une parente : rafraîchi quand la plage s'étend", async () => {
    let maintenant = MAINTENANT;
    const srv = serveur(() => maintenant);
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => maintenant });
    const avant = parentes(H4, 10, maintenant);
    const planAvant = planDe(avant, 0, avant.length, maintenant);
    expect(planAvant.resolution).toBe("1m");
    await chargeur.charger(planAvant);
    // Aucune kline encore ouverte au téléchargement n'a été retenue.
    const lu = chargeur.lire(planAvant);
    expect(lu.sous.length).toBeGreaterThan(0);
    expect(lu.sous.every((s) => s.time + planAvant.resolutionMs <= maintenant)).toBe(true);

    maintenant += H4; // la bougie en cours s'est clôturée
    const apres = parentes(H4, 11, maintenant);
    const plan = planDe(apres, 0, apres.length, maintenant);
    expect(chargeur.lire(plan).aCharger.length).toBeGreaterThan(0);
    await chargeur.charger(plan);
    const g = regrouperParBougie(apres, 0, apres.length, H4, chargeur.lire(plan).sous, maintenant);
    expect(g.has(apres.at(-2)?.time ?? -1)).toBe(true);
  });
});

// ───────────────────────────── Client ─────────────────────────────

describe("creerClientIntrabar", () => {
  const id = { exchange: "binance", symbol: "BTCUSDT", timeframe: "4h" } as const;

  it("autres places et unités calendaires : repli libellé, bougies inchangées, aucun appel", () => {
    const srv = serveur();
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const client = creerClientIntrabar(() => {}, { chargeur, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 30);
    const v = client.vue({ ...id, exchange: "bybit" }, bougies, 10, 30);
    expect(v.bougies).toEqual(bougies.slice(10, 30));
    expect(v.couvertes).toBe(0);
    expect(v.libelle).toBe("≈ réparti sur la bougie (intrabar Binance seulement)");
    expect(client.vue({ ...id, timeframe: "1M" }, bougies, 0, 30).libelle).toContain("unité calendaire");
    expect(client.vue({ ...id, timeframe: "1m" }, bougies, 0, 30).libelle).toContain("aucune unité plus fine");
    expect(srv.appels).not.toHaveBeenCalled();
  });

  it("anti-rebond au déplacement : un seul chargement, celui de la dernière plage", async () => {
    vi.useFakeTimers();
    const srv = serveur();
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const surPret = vi.fn();
    const client = creerClientIntrabar(surPret, { chargeur, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 400);

    // Cinq positions successives d'un déplacement, à 100 ms d'intervalle.
    const planFinal = planDe(bougies, 60, 160);
    expect(planFinal.resolution).toBe("5m"); // 100 bougies 4h : 5m tient sous le plafond
    for (let k = 0; k < 5; k++) {
      const v = client.vue(id, bougies, 300 - 60 * k, 400 - 60 * k);
      expect(v.couvertes).toBe(0);
      expect(v.libelle).toMatch(/^≈ réparti sur la bougie \(intrabar \w+ en chargement\)$/);
      vi.advanceTimersByTime(100);
    }
    expect(srv.appels).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ANTI_REBOND_MS);
    await vi.runAllTimersAsync();
    expect(surPret).toHaveBeenCalledTimes(1);
    expect(chargeur.requetes).toBe(planFinal.blocs.length);

    const v = client.vue(id, bougies, 60, 160);
    expect(v.resolution).toBe("5m");
    expect(v.couvertes).toBe(100);
    expect(v.libelle).toBe("réparti par 5 min (5m) · 100/100");
    expect(v.bougies).toHaveLength(100 * 48);
  });

  it("la bougie en cours reste à l'ancien calcul (couverture N−1/N affichée)", async () => {
    vi.useFakeTimers();
    const srv = serveur();
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const client = creerClientIntrabar(() => {}, { chargeur, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 50);
    client.vue(id, bougies, 0, 50);
    await vi.runAllTimersAsync();
    const v = client.vue(id, bougies, 0, 50);
    expect(v.couvertes).toBe(49);
    expect(v.libelle).toBe(`${LIBELLE_RESOLUTION["5m"]} · 49/50`);
    expect(v.bougies.at(-1)).toBe(bougies.at(-1));
    expect(v.parBougie.has(bougies.at(-1)?.time ?? -1)).toBe(false);
  });

  it("réponse incomplète : couverture partielle affichée, repli pour le reste", async () => {
    vi.useFakeTimers();
    const srv = serveur();
    // Le serveur « perd » une sous-bougie de la 3e parente.
    const bougies = parentes(H4, 30);
    const trou = (bougies[2]?.time ?? 0) + 15 * MIN;
    const fetchTroue = (async (input: string | URL | Request) => {
      const res = await srv.fetchFn(input);
      const lignes = (await res.json()) as unknown[][];
      return new Response(JSON.stringify(lignes.filter((l) => l[0] !== trou)), { status: 200 });
    }) as typeof fetch;
    const chargeur = new ChargeurIntrabar({ fetch: fetchTroue, maintenant: () => MAINTENANT });
    const client = creerClientIntrabar(() => {}, { chargeur, maintenant: () => MAINTENANT });
    client.vue(id, bougies, 0, 30);
    await vi.runAllTimersAsync();
    const v = client.vue(id, bougies, 0, 30);
    expect(v.resolution).toBe("1m"); // une minute manquante sur 240 suffit au repli
    expect(v.couvertes).toBe(28);
    expect(v.libelle).toBe("réparti à la minute (1m) · 28/30");
    expect(v.parBougie.has(bougies[2]?.time ?? -1)).toBe(false);
  });

  it("échec réseau : libellé « indisponible », jamais de valeur inventée", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const chargeur = new ChargeurIntrabar({ fetch: fetchFn, maintenant: () => MAINTENANT });
    const surPret = vi.fn();
    const client = creerClientIntrabar(surPret, { chargeur, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 30);
    client.vue(id, bougies, 0, 30);
    await vi.runAllTimersAsync();
    expect(surPret).toHaveBeenCalledTimes(1);
    const v = client.vue(id, bougies, 0, 30);
    expect(v.couvertes).toBe(0);
    expect(v.bougies).toEqual(bougies);
    expect(v.libelle).toBe("≈ réparti sur la bougie (intrabar 1m indisponible)");
  });

  it("passage à une autre place : chargement en attente annulé et bail rendu aux autres surfaces", async () => {
    vi.useFakeTimers();
    const srv = serveur();
    const bougies = parentes(H4, 30);
    const capacite = planDe(bougies).blocs.length;
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT, capacite });
    const options = { chargeur, maintenant: () => MAINTENANT };

    // Plage abandonnée avant la fin de l'anti-rebond : aucune requête.
    const presse = creerClientIntrabar(() => {}, options);
    presse.vue(id, bougies, 0, 30);
    presse.vue({ ...id, exchange: "bybit" }, bougies, 0, 30);
    await vi.runAllTimersAsync();
    expect(srv.appels).not.toHaveBeenCalled();

    // Le cache plein d'une surface refuse la suivante, jusqu'à ce qu'elle change de place.
    const a = creerClientIntrabar(() => {}, options);
    a.vue(id, bougies, 0, 30);
    await vi.runAllTimersAsync();
    expect(a.vue(id, bougies, 0, 30).couvertes).toBe(29);
    const b = creerClientIntrabar(() => {}, options);
    const idB = { ...id, symbol: "ETHUSDT" };
    expect(b.vue(idB, bougies, 0, 30).libelle).toBe("≈ réparti sur la bougie (intrabar 1m non chargé, cache saturé)");
    a.vue({ ...id, exchange: "bybit" }, bougies, 0, 30);
    expect(b.vue(idB, bougies, 0, 30).libelle).toBe("≈ réparti sur la bougie (intrabar 1m en chargement)");
    await vi.runAllTimersAsync();
    expect(b.vue(idB, bougies, 0, 30).couvertes).toBe(29);
  });

  it("dispose annule le chargement programmé", async () => {
    vi.useFakeTimers();
    const srv = serveur();
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const client = creerClientIntrabar(() => {}, { chargeur, maintenant: () => MAINTENANT });
    client.vue(id, parentes(H4, 30), 0, 30);
    client.dispose();
    await vi.runAllTimersAsync();
    expect(srv.appels).not.toHaveBeenCalled();
  });
});

// ───────────────────────── Borne de requêtes dans la durée ─────────────────────────

/**
 * Surfaces rendues EN CONTINU (comme KLineChart, qui redessine tous les overlays à chaque
 * tick) : chaque rendu est appelé toutes les `pasMs` pendant `dureeMs`, horloge factice.
 */
async function rendreEnContinu(rendus: ReadonlyArray<() => void>, dureeMs: number, pasMs: number): Promise<void> {
  for (let t = 0; t < dureeMs; t += pasMs) {
    for (const r of rendus) r();
    await vi.advanceTimersByTimeAsync(pasMs);
  }
}

interface Surface {
  client: ClientIntrabar;
  id: IdentiteIntrabar;
  bougies: () => readonly Candle[];
  from: () => number;
  to: () => number;
  derniere: VueIntrabar | null;
}

function surface(
  chargeur: ChargeurIntrabar,
  id: IdentiteIntrabar,
  bougies: () => readonly Candle[],
  from: () => number,
  to: () => number,
): Surface {
  return {
    client: creerClientIntrabar(() => {}, { chargeur, maintenant: () => Date.now() }),
    id,
    bougies,
    from,
    to,
    derniere: null,
  };
}

/** Toutes les parentes clôturées de la plage sont couvertes (la bougie en cours ne l'est jamais). */
function complete(s: Surface): boolean {
  const closes = s.bougies().slice(s.from(), s.to()).filter((c) => c.closed !== false).length;
  return s.derniere !== null && s.derniere.couvertes === closes && /^réparti [^·]+ · \d+\/\d+$/.test(s.derniere.libelle);
}

function rendu(s: Surface): () => void {
  return () => {
    s.derniere = s.client.vue(s.id, s.bougies(), s.from(), s.to());
  };
}

function planSurface(s: Surface): PlanIntrabar {
  const duree = s.id.timeframe === "1h" ? H1 : H4;
  const plan = planifierIntrabar({ marche: "spot", symbole: s.id.symbol }, duree, s.bougies(), s.from(), s.to(), Date.now());
  if (typeof plan === "string") throw new Error(plan);
  return plan;
}

// Simulations de plusieurs minutes d'horloge factice : délai large pour une CI chargée.
describe("borne de requêtes avec plusieurs surfaces (cache partagé saturé)", { timeout: 30_000 }, () => {
  /** Quatre VPFR de 140 bougies 1h sur un même graphe BTCUSDT, plages disjointes. */
  function quatreVpfr1h(chargeur: ChargeurIntrabar): Surface[] {
    const bougies = parentes(H1, 640, MAINTENANT);
    return [0, 1, 2, 3].map((k) =>
      surface(chargeur, { exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }, () => bougies, () => 160 * k, () => 160 * k + 140),
    );
  }

  /** Quatre graphes 4h de 180 bougies sur des symboles distincts (VPVR). */
  function quatreGraphes4h(chargeur: ChargeurIntrabar): Surface[] {
    const bougies = parentes(H4, 180, MAINTENANT);
    return ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"].map((symbol) =>
      surface(chargeur, { exchange: "binance", symbol, timeframe: "4h" }, () => bougies, () => 0, () => bougies.length),
    );
  }

  it.each([
    ["quatre VPFR 1h de 140 bougies (plan 1m)", quatreVpfr1h, "1m"],
    ["quatre graphes 4h de 180 bougies (plan 5m)", quatreGraphes4h, "5m"],
  ] as const)("%s : rendus chaque seconde pendant 10 min, requêtes bornées par la capacité", async (_nom, fabrique, resolution) => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now());
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    const surfaces = fabrique(chargeur);
    const plans = surfaces.map(planSurface);
    expect(plans.every((p) => p.resolution === resolution)).toBe(true);
    // L'ensemble de travail dépasse la capacité du cache (cas de l'emballement relevé en revue).
    const somme = plans.reduce((n, p) => n + p.blocs.length, 0);
    expect(somme).toBeGreaterThan(CAPACITE_BLOCS);

    await rendreEnContinu(surfaces.map(rendu), 10_000, 1_000);
    const apresChargement = chargeur.requetes;
    await rendreEnContinu(surfaces.map(rendu), 10 * 60_000, 1_000);

    // Les trois premières surfaces sont chargées une fois, la quatrième attend sans requête.
    const admises = plans.slice(0, 3).reduce((n, p) => n + p.blocs.length, 0);
    expect(chargeur.requetes).toBe(apresChargement);
    expect(chargeur.requetes).toBe(admises);
    expect(chargeur.requetes).toBeLessThanOrEqual(CAPACITE_BLOCS);
    expect(chargeur.taille).toBeLessThanOrEqual(CAPACITE_BLOCS);
    for (const s of surfaces.slice(0, 3)) expect(complete(s)).toBe(true);
    const quatrieme = surfaces[3]?.derniere;
    expect(quatrieme?.couvertes).toBe(0);
    expect(quatrieme?.bougies).toHaveLength(quatrieme?.total ?? -1); // ancien calcul, jamais 0
    expect(quatrieme?.libelle).toBe(`≈ réparti sur la bougie (intrabar ${resolution} non chargé, cache saturé)`);
  });

  it("réponses à 1 s de latence : les blocs en vol sont réservés, aucun bloc sous bail évincé", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now(), 1_000);
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    const surfaces = quatreGraphes4h(chargeur);
    const plans = surfaces.map(planSurface);
    const admises = plans.slice(0, 3).reduce((n, p) => n + p.blocs.length, 0);
    // Quatre surfaces rendues au même instant, puis chaque seconde pendant 10 min.
    for (let t = 0; t < 10 * 60_000; t += 1_000) {
      for (const r of surfaces.map(rendu)) r();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(chargeur.taille).toBeLessThanOrEqual(CAPACITE_BLOCS);
    }
    // Chaque bloc des trois plans admis n'est téléchargé qu'une fois : aucun n'a été évincé.
    expect(chargeur.requetes).toBe(admises);
    expect(chargeur.requetes).toBeLessThanOrEqual(CAPACITE_BLOCS);
    for (const s of surfaces.slice(0, 3)) expect(complete(s)).toBe(true);
    expect(surfaces[3]?.derniere?.libelle).toBe("≈ réparti sur la bougie (intrabar 5m non chargé, cache saturé)");
  });

  it("quel que soit le nombre de surfaces : huit graphes, jamais plus de requêtes que la capacité", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now());
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    const bougies = parentes(H4, 180, MAINTENANT);
    const surfaces = Array.from({ length: 8 }, (_, k) =>
      surface(chargeur, { exchange: "binance", symbol: `SYM${k}USDT`, timeframe: "4h" }, () => bougies, () => 0, () => bougies.length),
    );
    await rendreEnContinu(surfaces.map(rendu), 5 * 60_000, 1_000);
    expect(chargeur.requetes).toBeLessThanOrEqual(CAPACITE_BLOCS);
    expect(surfaces.filter((s) => s.derniere?.libelle.includes("cache saturé"))).toHaveLength(5);
  });

  it("cache plein : une surface déplacée rend ses anciens blocs et charge sa nouvelle plage, les autres restent intactes", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now());
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    const bougies = parentes(H1, 800, MAINTENANT);
    const debuts = [0, 160, 320];
    const surfaces = debuts.map((_, k) =>
      surface(chargeur, { exchange: "binance", symbol: "BTCUSDT", timeframe: "1h" }, () => bougies, () => debuts[k] ?? 0, () => (debuts[k] ?? 0) + 140),
    );
    await rendreEnContinu(surfaces.map(rendu), 10_000, 1_000);
    const avant = chargeur.requetes;
    expect(avant).toBeGreaterThan(CAPACITE_BLOCS - 10); // il reste moins d'un plan de place libre

    debuts[0] = 600; // déplacement vers une plage entièrement nouvelle
    const planDeplace = planSurface(surfaces[0] as Surface);
    await rendreEnContinu(surfaces.map(rendu), 2 * 60_000, 1_000);
    expect(chargeur.requetes).toBe(avant + planDeplace.blocs.length);
    expect(surfaces.every(complete)).toBe(true);
    expect(chargeur.taille).toBeLessThanOrEqual(CAPACITE_BLOCS);
  });

  it("surface fermée (dispose) : la suivante est admise une fois, sans recharger les autres", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now());
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    const surfaces = quatreGraphes4h(chargeur);
    const plans = surfaces.map(planSurface);
    await rendreEnContinu(surfaces.map(rendu), 10_000, 1_000);
    const avant = chargeur.requetes;

    surfaces[0]?.client.dispose();
    const restantes = surfaces.slice(1);
    await rendreEnContinu(restantes.map(rendu), 5 * 60_000, 1_000);
    expect(chargeur.requetes).toBe(avant + (plans[3]?.blocs.length ?? Number.NaN));
    for (const s of restantes) expect(complete(s)).toBe(true);
  });

  it("pas de ping-pong : une surface muette perd son bail, puis revient en « cache saturé » sans requête", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now());
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    const surfaces = quatreGraphes4h(chargeur);
    const [muette, ...autres] = surfaces;
    if (muette === undefined) throw new Error("surface attendue");
    await rendreEnContinu(surfaces.map(rendu), 10_000, 1_000);
    const avant = chargeur.requetes;

    // La première surface n'est plus redessinée au-delà de BAIL_MS : la quatrième prend sa place.
    await rendreEnContinu(autres.map(rendu), BAIL_MS + 10_000, 1_000);
    const apresReprise = chargeur.requetes;
    expect(apresReprise).toBeGreaterThan(avant);
    expect(autres.every(complete)).toBe(true);

    // Elle revient : ses blocs évincés sont refusés (les trois autres sont actives), rien
    // n'est rechargé, ni par elle ni par elles ; elle garde ceux qui restaient (partiel).
    await rendreEnContinu(surfaces.map(rendu), 5 * 60_000, 1_000);
    expect(chargeur.requetes).toBe(apresReprise);
    expect(muette.derniere?.libelle).toMatch(/cache saturé\)$/);
    expect(autres.every(complete)).toBe(true);
  });

  it("en direct sur 3 h : aucune requête entre deux clôtures, au plus deux par surface à chaque clôture", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const srv = serveur(() => Date.now());
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => Date.now() });
    // Quatre VPVR 1h glissants (140 dernières bougies, bougie en cours comprise).
    let heure = -1;
    let bougies: Candle[] = [];
    const courantes = (): Candle[] => {
      const h = Math.floor(Date.now() / H1);
      if (h !== heure) {
        heure = h;
        bougies = parentes(H1, 140, Date.now());
      }
      return bougies;
    };
    const surfaces = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"].map((symbol) =>
      surface(chargeur, { exchange: "binance", symbol, timeframe: "1h" }, courantes, () => 0, () => 140),
    );
    const releves = new Map<number, number>();
    const fin = MAINTENANT + 3 * H1 + 13 * MIN; // 12:07 → 15:20, trois clôtures
    while (Date.now() < fin) {
      for (const s of surfaces) rendu(s)();
      releves.set(Date.now(), chargeur.requetes);
      await vi.advanceTimersByTimeAsync(15_000);
    }
    const a = (t: number): number => {
      const v = releves.get(t);
      if (v === undefined) throw new Error(`relevé absent à ${new Date(t).toISOString()}`);
      return v;
    };
    const initial = a(Date.UTC(2026, 10, 7, 12, 59, 0));
    expect(initial).toBeLessThanOrEqual(CAPACITE_BLOCS);
    let precedent = initial;
    for (const h of [13, 14, 15]) {
      const apresCloture = a(Date.UTC(2026, 10, 7, h, 1, 0));
      expect(apresCloture - precedent).toBeLessThanOrEqual(2 * surfaces.length);
      if (h < 15) {
        // Entre hh:01 et hh:59 : rendus toutes les 15 s, aucune requête.
        expect(a(Date.UTC(2026, 10, 7, h, 59, 0))).toBe(apresCloture);
        precedent = apresCloture;
      } else {
        expect(chargeur.requetes).toBe(apresCloture);
      }
    }
  });
});

// ───────────────────────────── Délai maximal ─────────────────────────────

describe("requête pendante", () => {
  const id = { exchange: "binance", symbol: "BTCUSDT", timeframe: "4h" } as const;

  it("abandonnée après DELAI_REQUETE_MS : « indisponible », la file ne s'attarde pas sur les autres blocs, nouvel essai après la pause", async () => {
    vi.useFakeTimers({ now: MAINTENANT, toFake: ["setTimeout", "clearTimeout", "Date"] });
    // AbortSignal.timeout n'est pas simulé par les faux minuteurs : rebranché sur setTimeout simulé.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(new DOMException("signal timed out", "TimeoutError")), ms);
      return ctrl.signal;
    });
    const srv = serveur(() => Date.now());
    let pendant = true;
    // Connexion qui ne répond jamais mais respecte son signal, comme le fetch réel.
    const fetchFn = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      pendant
        ? new Promise<Response>((_ok, echec) => {
            init?.signal?.addEventListener("abort", () => echec(init.signal?.reason));
          })
        : srv.fetchFn(input),
    );
    const chargeur = new ChargeurIntrabar({ fetch: fetchFn as unknown as typeof fetch, maintenant: () => Date.now() });
    const surPret = vi.fn();
    const client = creerClientIntrabar(surPret, { chargeur, maintenant: () => Date.now() });
    const bougies = parentes(H4, 360);
    const plan = planDe(bougies);
    expect(plan.blocs.length).toBeGreaterThan(1);

    client.vue(id, bougies, 0, bougies.length);
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(DELAI_REQUETE_MS - 1);
    expect(surPret).not.toHaveBeenCalled();
    expect(client.vue(id, bougies, 0, bougies.length).libelle).toBe("≈ réparti sur la bougie (intrabar 15m en chargement)");

    await vi.advanceTimersByTimeAsync(1);
    expect(surPret).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1); // les blocs suivants n'ont pas touché le réseau
    expect(client.vue(id, bougies, 0, bougies.length).libelle).toBe("≈ réparti sur la bougie (intrabar 15m indisponible)");

    pendant = false;
    await vi.advanceTimersByTimeAsync(REESSAI_MS);
    client.vue(id, bougies, 0, bougies.length);
    await vi.advanceTimersByTimeAsync(ANTI_REBOND_MS);
    expect(fetchFn).toHaveBeenCalledTimes(1 + plan.blocs.length);
    expect(client.vue(id, bougies, 0, bougies.length).libelle).toBe(`${LIBELLE_RESOLUTION["15m"]} · 359/360`);
  });
});

// ───────────────────────────── Replay ─────────────────────────────

describe("façon replay (horloge réelle bien après les données)", () => {
  const id = { exchange: "binance", symbol: "BTCUSDT", timeframe: "4h" } as const;
  /** Instant rejoué : deux jours avant l'horloge réelle. */
  const REJOUE = MAINTENANT - 2 * JOUR;

  it("la dernière bougie, en cours par son seul drapeau, n'est jamais remplacée ; aucune sous-bougie postérieure", async () => {
    vi.useFakeTimers();
    const srv = serveur(); // sert jusqu'à l'horloge réelle, donc bien au-delà de l'instant rejoué
    const chargeur = new ChargeurIntrabar({ fetch: srv.fetchFn, maintenant: () => MAINTENANT });
    const client = creerClientIntrabar(() => {}, { chargeur, maintenant: () => MAINTENANT });
    const bougies = parentes(H4, 30, REJOUE);
    const enCours = bougies.at(-1);
    if (enCours === undefined) throw new Error("bougie attendue");
    // Close par l'horloge réelle, et ses sous-bougies retrouvent son volume : seul le drapeau la protège.
    expect(enCours.closed).toBe(false);
    expect(enCours.time + H4).toBeLessThan(MAINTENANT);
    expect(agreger(enCours.time, H4).volume).toBe(enCours.volume);

    client.vue(id, bougies, 0, bougies.length);
    await vi.runAllTimersAsync();
    const v = client.vue(id, bougies, 0, bougies.length);
    expect(v.couvertes).toBe(29);
    expect(v.libelle).toBe(`${LIBELLE_RESOLUTION["1m"]} · 29/30`);
    expect(v.parBougie.has(enCours.time)).toBe(false);
    expect(v.bougies.at(-1)).toBe(enCours);
    expect(v.bougies.slice(0, -1).every((s) => s.time + MIN <= enCours.time)).toBe(true);

    // Témoin : la même bougie marquée close serait remplacée (30/30).
    const close = [...bougies.slice(0, -1), { ...enCours, closed: true }];
    client.vue(id, close, 0, close.length);
    await vi.runAllTimersAsync();
    expect(client.vue(id, close, 0, close.length).couvertes).toBe(30);
  });
});
