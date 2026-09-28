import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumeMarcheOptions } from "./ResumeMarcheOptions";
import { resumerMarcheOptions } from "../../data/marcheOptions";

const now = Date.parse("2026-09-25T09:00:00Z");
const resume = resumerMarcheOptions([{
  instrument: "ETH-2OCT26-4000-C", expiryMs: Date.parse("2026-10-02T08:00:00Z"), strike: 4_000,
  type: "call", markIv: 50, openInterest: 25, underlying: 4_000, indexPrice: 4_000,
  interestRate: 0, volume24h: 1, markPrice: 0.05,
}], 4_000, now);
const props = { devise: "ETH" as const, resume, loading: false, erreur: null, majTs: now,
  observedAt: now - 2_000, nowMs: now, onRefresh: () => {} };

describe("résumé options", () => {
  it("distingue heure observée et réception, périmètre inverse Deribit et unités", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} />);
    expect(html).toContain("$100.00K");
    expect(html).toContain("08:59:58 UTC");
    expect(html).toContain("09:00:00 UTC");
    expect(html).toContain("Options inverses Deribit uniquement");
    expect(html).toContain("GEX $/1 %");
    expect(html).toContain("DEX $");
    expect(html).toContain("100.0 %");
  });
  it("date reçue conservée après erreur et signalement de péremption", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} nowMs={now + 600_000} erreur="Actualisation indisponible" />);
    expect(html).toContain("Dernier instantané conservé");
    expect(html).toContain("Instantané périmé");
    expect(html).toContain('dateTime="2026-09-25T09:00:00.000Z"');
    expect(html).toContain("$100.00K");
  });
  it("premier échec sans données : aucune valeur zéro ni tableau trompeur", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} majTs={null} observedAt={null}
      resume={resumerMarcheOptions([], NaN, now)} erreur="Actualisation indisponible" />);
    expect(html).toContain("Données indisponibles");
    expect(html).not.toContain("$0");
    expect(html).not.toContain('role="table"');
  });

  it("le mode compact replie le contexte, tout en gardant fraîcheur et couverture visibles", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} compacte />);
    const visible = html.slice(0, html.indexOf("<details"));
    const contexte = html.slice(html.indexOf("<details"));
    expect(visible).toContain("Deribit ETH");
    expect(visible).toContain("Actualiser les options");
    expect(visible).toContain("Observé :");
    expect(visible).toContain("Reçu :");
    expect(visible).toContain("Calculé :");
    expect(visible).toContain("Greeks / OI connu");
    expect(visible).toContain("100.0 %");
    expect(visible).not.toContain("OI notionnel");
    expect(contexte).toContain("Contexte de chaîne");
    expect(contexte).toContain("OI notionnel");
    expect(contexte).toContain("P/C OI");
    expect(contexte).toContain("Concentration :");
    expect(contexte).toContain("Sous 7 jours :");
    expect(contexte).toContain("Prochaine échéance :");
    expect(contexte).toContain("Expositions par échéance");
    expect(contexte).toContain("Options inverses Deribit uniquement");
    expect(contexte).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
  });

  it("les avertissements partiel, périmé et erreur restent hors contexte replié", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} compacte
      resume={{ ...resume, nbOiInconnus: 2, couvertureOiPct: 75 }}
      nowMs={now + 600_000} erreur="Actualisation indisponible" />);
    const visible = html.slice(0, html.indexOf("<details"));
    expect(visible).toContain("Couverture partielle");
    expect(visible).toContain("OI inconnu pour 2 options");
    expect(visible).toContain("75.0 %");
    expect(visible).toContain("Instantané périmé");
    expect(visible).toContain("Actualisation indisponible");
    expect(visible).toContain("Dernier instantané conservé");
  });

  it("compact sans données : état absent visible et aucun volet de chiffres vide", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} compacte majTs={null} observedAt={null}
      resume={resumerMarcheOptions([], NaN, now)} erreur="Actualisation indisponible" />);
    expect(html).toContain("Données indisponibles");
    expect(html).toContain("heure non fournie");
    expect(html).not.toContain("Contexte de chaîne");
    expect(html).not.toContain("$0");
  });

  it("sans compact, conserve le résumé développé et le seul volet existant des échéances", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} />);
    expect(html).toBe(renderToStaticMarkup(<ResumeMarcheOptions {...props} compacte={false} />));
    const visible = html.slice(0, html.indexOf("<details"));
    expect(visible).toContain("OI notionnel");
    expect(visible).toContain("Greeks / OI connu");
    expect(visible).toContain("Prochaine échéance :");
    expect(html).not.toContain("Contexte de chaîne");
    expect(html.match(/<details/g)).toHaveLength(1);
  });

  it("l’arrondi flottant presque égal à 100 % ne crée pas de couverture partielle", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} compacte
      resume={{ ...resume, couvertureOiPct: 99.99999999999999 }} />);
    const visible = html.slice(0, html.indexOf("<details"));
    expect(visible).toContain("100.0 %");
    expect(visible).not.toContain("(partiel)");
  });

  it("une vraie couverture à 99,99 % reste partielle sans afficher un trompeur 100,0 %", () => {
    const html = renderToStaticMarkup(<ResumeMarcheOptions {...props} compacte
      resume={{ ...resume, couvertureOiPct: 99.99 }} />);
    const visible = html.slice(0, html.indexOf("<details"));
    expect(visible).toContain("&lt;100 %");
    expect(visible).toContain("(partiel)");
    expect(visible).not.toContain("100.0 %");
  });
});
