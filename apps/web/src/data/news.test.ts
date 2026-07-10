/**
 * Tests des fonctions PURES de data/news.ts : parseur RSS 2.0 + Atom (fixtures inline),
 * fusion/dédup, mots-clés symbole, pertinence par mot entier, horodatage relatif.
 * Aucun réseau, aucun DOM — l'extracteur XML est volontairement sans dépendance.
 */
import { describe, expect, it } from "vitest";
import {
  estPertinentPourSymbole,
  fusionner,
  memesMotsCles,
  NEWS_FEEDS,
  normaliserMotsCles,
  parseDate,
  parseFeed,
  parseFinnhubNews,
  parseGdeltNews,
  symbolKeywords,
  tempsRelatif,
  type NewsItem,
} from "./news";

// Fixture RSS 2.0 : item CDATA (titre + lien) avec atom:updated parasite, item à lien
// entité (&amp;), et item SANS titre (doit être ignoré).
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Feed</title>
  <atom:link href="https://ex.com/rss" rel="self"/>
  <item>
    <title>Bitcoin tops $60K: bull trap or $65K next? </title>
    <pubDate>Wed, 01 Jul 2026 22:02:40 +0000</pubDate>
    <atom:updated>Wed, 01 Jul 2026 22:27:50 +0000</atom:updated>
    <guid isPermaLink="true">https://ct.com/guid-a</guid>
    <link><![CDATA[https://ct.com/markets/a?utm_source=rss_feed&utm_medium=rss]]></link>
    <description><![CDATA[<p><img src="x.jpg"></p><p>Bitcoin & Ethereum rally as <b>ETFs</b> land.</p>]]></description>
  </item>
  <item>
    <title>Trump-backed miner sets reverse stock split</title>
    <link>https://tb.co/post/1?utm_source=rss&amp;utm_medium=rss</link>
    <pubDate>Wed, 01 Jul 2026 15:16:58 -0400</pubDate>
    <guid isPermaLink="false">https://tb.co/post/1</guid>
    <description>Plain summary about Solana staking.</description>
  </item>
  <item>
    <link>https://no-title.example/x</link>
    <pubDate>Wed, 01 Jul 2026 10:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`;

// Fixture Atom : titre/résumé HTML en CDATA, lien en attribut href, dates ISO-8601.
const ATOM = `<?xml version="1.0" encoding="utf-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blockworks</title>
  <link href="https://bw.com" rel="alternate"/>
  <entry>
    <title type="html"><![CDATA[Venezuela sanctions are stablecoins proof of concept]]></title>
    <id>https://bw.com/news/venezuela</id>
    <link href="https://bw.com/news/venezuela"/>
    <updated>2026-07-01T15:00:00.000Z</updated>
    <summary type="html"><![CDATA[Banned from the dollar system, the country uses digital dollars instead.]]></summary>
    <published>2026-07-01T14:00:00.000Z</published>
  </entry>
</feed>`;

describe("parseFeed — RSS 2.0", () => {
  const items = parseFeed(RSS, "cointelegraph");

  it("ignore les items sans titre", () => {
    expect(items).toHaveLength(2);
  });

  it("nettoie le titre (trim, entités, HTML)", () => {
    expect(items[0]?.title).toBe("Bitcoin tops $60K: bull trap or $65K next?");
  });

  it("prend le <link> (CDATA) et non <atom:updated>", () => {
    expect(items[0]?.link).toBe("https://ct.com/markets/a?utm_source=rss_feed&utm_medium=rss");
  });

  it("décode les entités du lien plein texte (&amp; → &)", () => {
    expect(items[1]?.link).toBe("https://tb.co/post/1?utm_source=rss&utm_medium=rss");
  });

  it("strippe le HTML du résumé et décode les entités", () => {
    expect(items[0]?.summary).toBe("Bitcoin & Ethereum rally as ETFs land.");
  });

  it("parse la date en ms epoch (> 0)", () => {
    expect(items[0]?.time).toBe(Date.parse("Wed, 01 Jul 2026 22:02:40 +0000"));
    expect(items[1]?.time).toBeGreaterThan(0);
  });

  it("porte la source fournie", () => {
    expect(items[0]?.source).toBe("cointelegraph");
  });
});

describe("parseFeed — Atom", () => {
  const items = parseFeed(ATOM, "blockworks");

  it("extrait une entrée", () => {
    expect(items).toHaveLength(1);
  });

  it("prend le href du <link/> auto-fermant", () => {
    expect(items[0]?.link).toBe("https://bw.com/news/venezuela");
  });

  it("prend <published> comme date", () => {
    expect(items[0]?.time).toBe(Date.parse("2026-07-01T14:00:00.000Z"));
  });

  it("extrait le résumé depuis <summary>", () => {
    expect(items[0]?.summary).toBe("Banned from the dollar system, the country uses digital dollars instead.");
  });

  it("porte le titre et la source", () => {
    expect(items[0]?.title).toBe("Venezuela sanctions are stablecoins proof of concept");
    expect(items[0]?.source).toBe("blockworks");
  });
});

describe("parseDate", () => {
  it("parse RFC-822 et ISO-8601", () => {
    expect(parseDate("Wed, 01 Jul 2026 15:16:58 -0400")).toBeGreaterThan(0);
    expect(parseDate("2026-07-01T14:00:00.000Z")).toBe(Date.parse("2026-07-01T14:00:00.000Z"));
  });
  it("retourne 0 pour une date illisible ou vide", () => {
    expect(parseDate("pas une date")).toBe(0);
    expect(parseDate("")).toBe(0);
  });
});

describe("fusionner", () => {
  const item = (id: string, link: string, time: number, title = "T"): NewsItem => ({
    id,
    link,
    time,
    title,
    source: "coindesk",
    summary: "",
  });

  it("dédup par lien en gardant la plus récente, trie par date décroissante", () => {
    const a = item("1", "https://x/1", 100, "A");
    const aRecent = item("1b", "https://x/1", 200, "A-recent");
    const b = item("2", "https://x/2", 150, "B");
    const out = fusionner([[a, b], [aRecent]]);
    expect(out).toHaveLength(2);
    expect(out[0]?.time).toBe(200);
    expect(out[0]?.title).toBe("A-recent");
    expect(out[1]?.link).toBe("https://x/2");
  });
});

describe("symbolKeywords", () => {
  it("mappe les majors (nom + ticker)", () => {
    expect(symbolKeywords("BTCUSDT")).toEqual(expect.arrayContaining(["bitcoin", "btc"]));
    expect(symbolKeywords("ETHUSDT")).toContain("ethereum");
    expect(symbolKeywords("SOL")).toContain("solana");
  });
  it("retombe sur le ticker de base si inconnu", () => {
    expect(symbolKeywords("FOOUSDT")).toEqual(["foo"]);
  });
});

describe("estPertinentPourSymbole", () => {
  const news = (title: string, summary = ""): NewsItem => ({
    id: title,
    link: "",
    time: 0,
    title,
    source: "coindesk",
    summary,
  });

  it("matche un mot entier (titre ou résumé)", () => {
    expect(estPertinentPourSymbole(news("Bitcoin ETF approved"), ["bitcoin", "btc"])).toBe(true);
    expect(estPertinentPourSymbole(news("Rally continues", "btc breaks out"), ["bitcoin", "btc"])).toBe(true);
  });

  it("ne matche pas une sous-chaîne", () => {
    expect(estPertinentPourSymbole(news("Bitcoinist rumor mill"), ["bitcoin"])).toBe(false);
    expect(estPertinentPourSymbole(news("New workshop opens"), ["op"])).toBe(false);
  });

  it("est faux quand l'actif n'est pas concerné ou sans mots-clés", () => {
    expect(estPertinentPourSymbole(news("Ethereum upgrade"), ["bitcoin", "btc"])).toBe(false);
    expect(estPertinentPourSymbole(news("Anything"), [])).toBe(false);
  });
});

describe("tempsRelatif", () => {
  const now = 10_000_000_000_000;
  it("formatte les tranches d'âge", () => {
    expect(tempsRelatif(now, now)).toBe("à l'instant");
    expect(tempsRelatif(now - 4 * 60_000, now)).toBe("il y a 4 min");
    expect(tempsRelatif(now - 3 * 3_600_000, now)).toBe("il y a 3 h");
    expect(tempsRelatif(now - 2 * 86_400_000, now)).toBe("il y a 2 j");
    expect(tempsRelatif(now - 10 * 86_400_000, now)).toBe("il y a 1 sem");
  });
  it("retourne — pour une date absente", () => {
    expect(tempsRelatif(0)).toBe("—");
  });
});

describe("parseFinnhubNews", () => {
  it("parse une liste d'articles Finnhub", () => {
    const json = [
      { id: 1, headline: "Fed holds rates", summary: "The Fed...", url: "https://x.test/1", datetime: 1751970000 },
    ];
    const items = parseFinnhubNews(json);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Fed holds rates", link: "https://x.test/1", source: "finnhub" });
    expect(items[0]!.time).toBe(1751970000 * 1000);
  });
  it("tableau vide sur forme inconnue", () => {
    expect(parseFinnhubNews(null)).toEqual([]);
    expect(parseFinnhubNews({})).toEqual([]);
  });
  it("ignore un élément malformé sans perdre les valides", () => {
    const json = [
      { id: 1, headline: "Fed holds rates", url: "https://x.test/1", datetime: 1751970000 },
      null,
      "chaine-invalide",
      42,
      { id: 2, headline: "ETF flows surge", url: "https://x.test/2", datetime: 1751970100 },
    ];
    const items = parseFinnhubNews(json);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(["Fed holds rates", "ETF flows surge"]);
  });

  it("porte la source fournie (catégorie forex → finnhubfx), défaut finnhub", () => {
    const json = [{ id: 7, headline: "EUR/USD slides on ECB", datetime: 1751970000 }];
    const fx = parseFinnhubNews(json, "finnhubfx");
    expect(fx[0]?.source).toBe("finnhubfx");
    // Sans lien : l'id de repli est préfixé par la source (pas de collision inter-catégories).
    expect(fx[0]?.id).toBe("finnhubfx:7");
    expect(parseFinnhubNews(json)[0]?.source).toBe("finnhub");
  });
});

describe("NEWS_FEEDS — invariants de configuration", () => {
  it("a des ids uniques", () => {
    const ids = NEWS_FEEDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tout flux XML (kind absent) a un hôte et un chemin", () => {
    for (const f of NEWS_FEEDS.filter((f) => f.kind === undefined)) {
      expect(f.host.length, f.id).toBeGreaterThan(0);
      expect(f.path.length, f.id).toBeGreaterThan(0);
    }
  });

  it("expose les flux macro/tradfi du bandeau (Bloomberg, CNBC, Finnhub forex)", () => {
    const parId = new Map(NEWS_FEEDS.map((f) => [f.id, f]));
    expect(parId.get("bloomberg")).toMatchObject({ host: "feeds.bloomberg.com", path: "economics/news.rss" });
    expect(parId.get("cnbc")).toMatchObject({ host: "www.cnbc.com", path: "id/20910258/device/rss/rss.html" });
    expect(parId.get("finnhubfx")).toMatchObject({ kind: "finnhub", category: "forex" });
    expect(parId.get("finnhub")).toMatchObject({ kind: "finnhub", category: "general" });
  });
});

describe("normaliserMotsCles — mots-clés de la veille", () => {
  it("null et liste vide → null (cycle SANS appel GDELT)", () => {
    expect(normaliserMotsCles(null)).toBeNull();
    expect(normaliserMotsCles([])).toBeNull();
  });
  it("liste non vide conservée telle quelle (cycle AVEC recherche GDELT)", () => {
    expect(normaliserMotsCles(["bitcoin", "btc"])).toEqual(["bitcoin", "btc"]);
  });
});

describe("memesMotsCles", () => {
  it("égalité élément par élément, ordre significatif", () => {
    expect(memesMotsCles(["bitcoin", "btc"], ["bitcoin", "btc"])).toBe(true);
    expect(memesMotsCles(["bitcoin", "btc"], ["btc", "bitcoin"])).toBe(false);
    expect(memesMotsCles(["btc"], ["bitcoin", "btc"])).toBe(false);
  });
  it("null n'est égal qu'à null (une liste vide non normalisée en diffère)", () => {
    expect(memesMotsCles(null, null)).toBe(true);
    expect(memesMotsCles(null, [])).toBe(false);
    expect(memesMotsCles(["btc"], null)).toBe(false);
  });
});

describe("parseGdeltNews", () => {
  it("parse la forme { articles: [...] }", () => {
    const json = { articles: [{ title: "Bitcoin rallies", url: "https://x.test/2", seendate: "20260707T120000Z" }] };
    const items = parseGdeltNews(json);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Bitcoin rallies", link: "https://x.test/2", source: "gdelt" });
  });
  it("tableau vide sur forme inconnue", () => {
    expect(parseGdeltNews(null)).toEqual([]);
  });
  it("convertit un seendate ISO 8601 compact en ms epoch", () => {
    const json = { articles: [{ title: "Bitcoin rallies", url: "https://x.test/2", seendate: "20260707T120000Z" }] };
    const items = parseGdeltNews(json);
    expect(items[0]!.time).toBe(Date.parse("2026-07-07T12:00:00Z"));
  });
  it("ignore un élément malformé sans perdre les valides", () => {
    const json = {
      articles: [
        { title: "Bitcoin rallies", url: "https://x.test/2", seendate: "20260707T120000Z" },
        null,
        "chaine-invalide",
        42,
        { title: "Ethereum upgrade", url: "https://x.test/3", seendate: "20260708T080000Z" },
      ],
    };
    const items = parseGdeltNews(json);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(["Bitcoin rallies", "Ethereum upgrade"]);
  });
});
