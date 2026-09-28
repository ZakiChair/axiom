import { Fragment, useMemo, useState } from "react";
import type { CarteExpositions as Carte, CelluleExpositions } from "../../data/carteExpositions";
import type { GexDexPoint } from "../../data/gexDex";
import { formatPct, formatUsd } from "../../lib/format";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { formatUsdExact } from "./format";

export type MetriqueExposition = "gex" | "dex";
export const BLEU_EXPOSITION = "56, 189, 248";
export const ORANGE_EXPOSITION = "245, 158, 11";
export const dateExposition = (t: number) => new Date(t).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit" });
const signe = (n: number | null) => n !== null && n > 0 ? `+${formatUsd(n)}` : formatUsd(n);
const cle = (c: CelluleExpositions) => `${c.expiryMs}:${c.idBande}`;

interface Props {
  carte: Carte;
  metrique: MetriqueExposition;
  spot: number;
  convertirStrike?: (strike: number) => string;
}

/** Bandes catégorielles exhaustives ; même échelle linéaire pour toute la carte. */
export function CarteExpositions({ carte, metrique, spot, convertirStrike }: Props) {
  const [selection, setSelection] = useState<string | null>(null);
  const maximum = Math.max(0, ...carte.cellules.map((c) => Math.abs(c[metrique] ?? 0)));
  const cellules = useMemo(() => new Map(carte.cellules.map((c) => [cle(c), c])), [carte]);
  const choisie = selection === null ? null : cellules.get(selection) ?? null;
  const bandeChoisie = carte.bandes.find((b) => b.idBande === choisie?.idBande);
  const colonnes: ColonneTable<GexDexPoint>[] = [
    { id: "strike", label: "Strike", rendu: (p) => <span>{formatUsdExact(p.strike)}{convertirStrike && <small className="block text-text-dim">{convertirStrike(p.strike)}</small>}</span>, largeur: "1.25fr" },
    { id: "ecart", label: "Écart spot", align: "right", rendu: (p) => formatPct(100 * (p.strike / spot - 1), 1) },
    { id: "gex", label: "GEX $/1 %", align: "right", rendu: (p) => signe(p.gex) },
    { id: "dex", label: "DEX $", align: "right", rendu: (p) => signe(p.dex) },
  ];
  const strikes = choisie ? [...choisie.strikes].sort((a, b) => Math.abs(b[metrique]) - Math.abs(a[metrique])).slice(0, 5) : [];
  const bornes = (min: number, max: number | null) => `${formatUsdExact(spot * (1 + min / 100))} ≤ strike${max === null ? "" : ` < ${formatUsdExact(spot * (1 + max / 100))}`}`;
  const grid = `106px repeat(${carte.colonnes.length}, minmax(72px, 1fr)) 76px`;
  const minWidth = 182 + carte.colonnes.length * 72;

  return (
    <section aria-label="Carte des expositions nettes" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[10px] text-text-dim">
        <span className="font-medium text-text">Exposition nette par distance au spot</span>
        <span>{metrique === "gex" ? "GEX en USD par +1 %" : "DEX en USD notionnels"}</span>
      </div>
      {carte.colonnes.length === 0 ? <p className="py-16 text-center text-[11px] text-text-dim">Aucune exposition calculable sur cette portée.</p> : (
        <div className="max-w-full overflow-x-auto rounded border border-border" tabIndex={0} aria-label="Défilement des échéances">
          <div className="grid text-[10px] tabular-nums" style={{ gridTemplateColumns: grid, minWidth }}>
            <div className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-2 text-text-dim">Distance / prix</div>
            {carte.colonnes.map((c) => <div key={c.expiryMs} className="border-b border-l border-border bg-surface px-1 py-2 text-center text-text-dim">{dateExposition(c.expiryMs)}</div>)}
            <div className="border-b border-l border-border bg-surface py-2 text-center text-text-dim">Total bande</div>
            {carte.bandes.map((b) => <Fragment key={b.idBande}>
              {b.idBande === "bas5" && <div className="relative z-10 border-y border-text-dim bg-surface px-2 py-0.5 font-medium text-text" style={{ gridColumn: "1 / -1" }}>0 % · Spot {formatUsdExact(spot)}</div>}
              <div className="sticky left-0 z-10 flex min-h-9 flex-col justify-center border-b border-border/40 bg-bg px-2" title={bornes(b.minPct, b.maxPct)}>
                <span>{b.label}</span><span className="text-[9px] text-text-dim">{b.maxPct === null ? `≥ ${formatUsdExact(spot * 1.3)}` : b.minPct === -100 ? `< ${formatUsdExact(spot * 0.7)}` : `${formatUsdExact(spot * (1 + b.minPct / 100))}–${formatUsdExact(spot * (1 + b.maxPct / 100))}`}</span>
              </div>
              {carte.colonnes.map((col) => {
                const cellule = cellules.get(`${col.expiryMs}:${b.idBande}`)!;
                const valeur = cellule[metrique];
                const absent = valeur === null;
                const intensite = absent || maximum === 0 ? 0 : Math.abs(valeur) / maximum;
                const choisieIci = selection === cle(cellule);
                return <button key={col.expiryMs} type="button" aria-pressed={choisieIci}
                  aria-label={`${dateExposition(col.expiryMs)} · ${b.label} · ${metrique.toUpperCase()} ${absent ? "aucun strike calculable" : signe(valeur)}`}
                  onFocus={() => setSelection(cle(cellule))} onClick={() => setSelection(cle(cellule))}
                  className={`min-h-9 border-b border-l border-border/40 px-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text ${choisieIci ? "ring-1 ring-inset ring-text" : ""}`}
                  style={absent ? { color: "var(--text-dim)", backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, var(--border) 6px 7px)" } : { backgroundColor: `rgba(${valeur >= 0 ? BLEU_EXPOSITION : ORANGE_EXPOSITION}, ${0.4 * intensite})`, color: "var(--text)" }}>
                  {absent ? "—" : signe(valeur)}
                </button>;
              })}
              <div className="flex min-h-9 items-center justify-end border-b border-l border-border bg-surface px-2 font-medium">{signe(b[metrique])}</div>
            </Fragment>)}
            <div className="sticky left-0 z-10 border-t border-border bg-surface px-2 py-2 text-text-dim">Total échéance</div>
            {carte.colonnes.map((c) => <div key={c.expiryMs} className="border-l border-t border-border bg-surface px-1 py-2 text-center font-medium">{signe(c[metrique])}</div>)}
            <div className="border-l border-t border-border bg-surface px-1 py-2 text-center font-semibold">{signe(carte.total[metrique])}</div>
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-dim">
        <span>{carte.total[metrique] === null ? "Échelle indisponible" : "Échelle commune, linéaire"}</span>
        {carte.total[metrique] !== null && <span className="flex items-center gap-1.5"><span>{signe(-maximum)}</span><span aria-hidden="true" className="h-2 w-20" style={{ background: `linear-gradient(90deg, rgba(${ORANGE_EXPOSITION}, .4), transparent 50%, rgba(${BLEU_EXPOSITION}, .4))` }} /><span>{signe(maximum)}</span><span>· 0 neutre · — absent</span></span>}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-dim">Bleu positif, ambre négatif. Bandes de même hauteur ; dates en colonnes, sans échelle de temps. Des positions opposées peuvent se compenser.</p>
      {choisie && bandeChoisie ? <section aria-label="Détail de la cellule" className="mt-3 border-t border-border pt-2">
        <div className="flex flex-wrap justify-between gap-2 text-[11px]"><span className="font-medium">{dateExposition(choisie.expiryMs)} UTC · {bandeChoisie.label}</span><span className="text-text-dim">{choisie.nbStrikes} strikes calculables</span></div>
        <p className="mt-1 text-[10px] text-text-dim">{bornes(bandeChoisie.minPct, bandeChoisie.maxPct)}</p>
        <div className="my-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] tabular-nums"><span>GEX <strong>{signe(choisie.gex)}</strong> /1 %</span><span>DEX <strong>{signe(choisie.dex)}</strong></span></div>
        {strikes.length ? <><p className="mb-1 text-[10px] text-text-dim">Principaux strikes par |{metrique.toUpperCase()}| · {strikes.length} sur {choisie.nbStrikes}</p><TableTriable colonnes={colonnes} lignes={strikes} cle={(p) => String(p.strike)} ariaLabel="Strikes de la cellule" /></> : <p className="text-[11px] text-text-dim">Aucun strike calculable dans cette bande.</p>}
      </section> : <p className="mt-3 text-[10px] text-text-dim">Sélectionnez une cellule pour lire ses strikes et ses deux expositions.</p>}
    </section>
  );
}
