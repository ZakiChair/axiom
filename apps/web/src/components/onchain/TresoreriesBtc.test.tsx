import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TresoreriesBtc } from "../../data/onchain/tresoreriesBtc";
import { formatEntier } from "../../lib/format";
import { VueTresoreriesBtc } from "./TresoreriesBtc";

const SPOT = 79_175.91;
const DONNEE: TresoreriesBtc = {
  totalBtc: 941_581,
  valeurUsd: 941_581 * SPOT,
  societes: [
    { nom: "Strategy", symbole: "MSTR.US", avoirsBtc: 845_050, coutTotalUsd: 64_267_830_000 },
    { nom: "Twenty One Capital", symbole: "XXI.US", avoirsBtc: 43_514, coutTotalUsd: null },
    { nom: "Metaplanet", symbole: "3350.T", avoirsBtc: 43_000, coutTotalUsd: 3_810_765_023.48 },
    { nom: "Société B", symbole: "B.US", avoirsBtc: 10_000, coutTotalUsd: 600_000_000 },
  ],
};
// renderToStaticMarkup échappe l'apostrophe ; les montants BTC passent par formatEntier (espace fine U+202F).
const rendu = (props: Parameters<typeof VueTresoreriesBtc>[0]) =>
  renderToStaticMarkup(<VueTresoreriesBtc {...props} />).replaceAll("&#x27;", "'");

describe("tuile Trésoreries d'entreprises BTC de CHAIN", () => {
  it("total, Strategy et son seuil, coût pondéré, sous leur coût, sensibilité, badge déclaratif", () => {
    const html = rendu({ resultat: { donnee: DONNEE, ts: Date.UTC(2026, 8, 14), perime: false } });
    expect(html).toContain("Trésoreries d'entreprises BTC");
    expect(html).toContain("avoirs déclaratifs non horodatés (jusqu'à J-14)");
    expect(html).toContain(`${formatEntier(941_581)} BTC`);
    expect(html).toContain("4 sociétés détentrices");
    expect(html).toContain("Strategy");
    expect(html).toContain(`${formatEntier(845_050)} BTC`);
    expect(html).toContain("coût moyen $76,052.10");
    expect(html).toContain("prix implicite +4.11%");
    expect(html).toContain("passe sous son coût à -3.95%");
    expect(html).toContain("Coût pondéré (coût connu)");
    expect(html).toContain("$76,475.25");
    expect(html).toContain("3 sociétés · couverture 95.38 % des BTC");
    expect(html).toContain("Sous leur coût");
    expect(html).toContain("1 société<");
    expect(html).toContain(`${formatEntier(43_000)} BTC`);
    expect(html).toContain("prix implicite CoinGecko");
    expect(html).toContain("$79,175.91");
    expect(html).toContain(`−10 % ($71,258.32) : 2 sociétés · ${formatEntier(888_050)} BTC`);
    expect(html).toContain(`−20 % ($63,340.73) : 2 sociétés · ${formatEntier(888_050)} BTC`);
    expect(html).toContain(`−30 % ($55,423.14) : 3 sociétés · ${formatEntier(898_050)} BTC`);
    expect(html).toContain("pas un seuil de liquidation");
    expect(html).toContain("récupéré 2026-09-14");
    expect(html).not.toContain("source inconnue");
    expect(html).not.toContain("périmé");
  });

  it("Strategy déjà sous son coût ; cache resservi signalé périmé", () => {
    const donnee = { ...DONNEE, valeurUsd: DONNEE.totalBtc * 70_000 };
    const html = rendu({ resultat: { donnee, ts: 1, perime: true } });
    expect(html).toContain("déjà sous son coût");
    expect(html).toContain("prix implicite -7.96%");
    expect(html).toContain("cache périmé");
  });

  it("sans valeur publiée : ni écart, ni décompte, ni sensibilité inventés", () => {
    const html = rendu({ resultat: { donnee: { ...DONNEE, valeurUsd: null }, ts: 1, perime: false } });
    expect(html).toContain("coût moyen $76,052.10");
    expect(html).toContain("Prix de comparaison indisponible");
    expect(html).not.toContain("−10 %");
    expect(html).not.toContain("0 société");
  });

  it("résultat nul : chargement puis indisponibilité explicites, badge déclaratif conservé", () => {
    expect(rendu({ resultat: null, loading: true })).toContain("Chargement des trésoreries CoinGecko");
    const html = rendu({ resultat: null });
    expect(html).toContain("Trésoreries d'entreprises indisponibles (CoinGecko).");
    expect(html).toContain("avoirs déclaratifs non horodatés");
  });

  it("Strategy introuvable sous MSTR.US : identification ratée distinguée d'un coût non publié", () => {
    const renommee = { ...DONNEE, societes: DONNEE.societes.map((s) => (s.nom === "Strategy" ? { ...s, symbole: "MSTR" } : s)) };
    const absente = rendu({ resultat: { donnee: renommee, ts: 1, perime: false } });
    expect(absente).toContain("absente de la liste CoinGecko (MSTR.US)");
    expect(absente).not.toContain("coût non publié");
    const sansCout = { ...DONNEE, societes: DONNEE.societes.map((s) => (s.nom === "Strategy" ? { ...s, coutTotalUsd: null } : s)) };
    const html = rendu({ resultat: { donnee: sansCout, ts: 1, perime: false } });
    expect(html).toContain("coût non publié");
    expect(html).not.toContain("absente de la liste");
  });

  it("motif d'échec CoinGecko affiché : sans donnée, et à côté du cache périmé", () => {
    expect(rendu({ resultat: null, raison: "CoinGecko trésoreries 401" }))
      .toContain("Trésoreries d'entreprises indisponibles (CoinGecko trésoreries 401).");
    const html = rendu({ resultat: { donnee: DONNEE, ts: 1, perime: true }, raison: "CoinGecko trésoreries 429" });
    expect(html).toContain("cache périmé");
    expect(html).toContain(" · CoinGecko trésoreries 429");
  });

  it("une seule société détentrice : accord au singulier", () => {
    const donnee = { totalBtc: 800, valeurUsd: 64_000_000, societes: [DONNEE.societes[0]!] };
    expect(rendu({ resultat: { donnee, ts: 1, perime: false } })).toContain("1 société détentrice<");
  });
});
