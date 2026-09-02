/**
 * Section BRIEF · watchlist — le clic sur une ligne doit router le chart sur la source
 * RÉELLE du symbole. `exchange: "binance"` en dur envoyait un actif Kraken/tradfi sur
 * `binance:<symbole>` (pane en erreur, source changée à l'insu de l'opérateur).
 *
 * Env vitest node (pas de jsdom dans apps/web) : la section n'a AUCUN hook, on peut
 * l'invoquer comme une fonction pure et récupérer le `surClicLigne` du tableau.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { SectionWatchlist } from "./SectionWatchlist";
import { TableTriable } from "../TableTriable";
import type { LigneWatchlist } from "../../data/brief";
import { navigateTo } from "../../lib/navigation";

vi.mock("../../lib/navigation", () => ({ navigateTo: vi.fn() }));

/** Premier élément du sous-arbre dont le type est `type` (recherche en profondeur). */
function trouver(noeud: unknown, type: unknown): ReactElement | null {
  if (Array.isArray(noeud)) {
    for (const enfant of noeud) {
      const trouve = trouver(enfant, type);
      if (trouve !== null) return trouve;
    }
    return null;
  }
  if (noeud === null || typeof noeud !== "object") return null;
  const el = noeud as ReactElement;
  if (el.type === type) return el;
  return trouver((el.props as { children?: unknown } | undefined)?.children, type);
}

const KRAKEN: LigneWatchlist = { symbole: "XBTUSD", prix: 108_000, variation24h: 1.2, source: "kraken" };

describe("SectionWatchlist — clic ligne → chart", () => {
  it("navigue sur la source réelle de la ligne (kraken), pas sur binance", () => {
    const arbre = SectionWatchlist({
      watchlist: { statut: "ready", data: [KRAKEN] },
      noteFraicheur: "à l'instant",
    });
    const table = trouver(arbre, TableTriable);
    expect(table).not.toBeNull();
    const surClicLigne = (table?.props as { surClicLigne?: (r: LigneWatchlist) => void } | undefined)
      ?.surClicLigne;
    expect(surClicLigne).toBeTypeOf("function");
    surClicLigne?.(KRAKEN);
    expect(navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "XBTUSD", exchange: "kraken" }),
    );
  });
});
