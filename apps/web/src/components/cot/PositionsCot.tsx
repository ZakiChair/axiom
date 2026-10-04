import type { LigneCot } from "../../data/cot";
import { libelleMouvementCot, positionsCot } from "../../data/cotPositions";
import { formatDateComplete, formatEntier } from "../../lib/format";

export function entierSigneCot(valeur: number | null): string {
  if (valeur === null || !Number.isFinite(valeur)) return "—";
  return `${valeur > 0 ? "+" : valeur < 0 ? "−" : ""}${formatEntier(Math.abs(valeur))}`;
}

/** Dates propres à l'instrument, pas date maximale de la watchlist. */
export function PeriodeCot({ ligne }: { ligne: LigneCot }) {
  const { datePrecedente } = positionsCot(ligne);
  const jours = datePrecedente === null ? null : (ligne.dateRapport - datePrecedente) / 86_400_000;
  return (
    <p className="text-[10px] leading-relaxed text-text-dim">
      Rapport du {formatDateComplete(ligne.dateRapport)}
      {datePrecedente === null
        ? " · comparaison indisponible"
        : ` · vs ${formatDateComplete(datePrecedente)} (${formatEntier(jours)} jours)`}
    </p>
  );
}

/** Deux côtés toujours distincts ; signes et mots restent lisibles sans couleur/survol. */
export function PositionsCot({ ligne }: { ligne: LigneCot }) {
  const positions = positionsCot(ligne);
  const cotes = [
    { libelle: "Longs · acheteurs", stock: positions.longs, delta: positions.deltaLongs },
    { libelle: "Shorts · vendeurs", stock: positions.shorts, delta: positions.deltaShorts },
  ];
  return (
    <div className="grid grid-cols-2 gap-2" data-cot-positions>
      {cotes.map((cote) => (
        <div key={cote.libelle} className="min-w-0 rounded border border-border bg-bg/40 px-2 py-1.5">
          <h4 className="text-[11px] font-medium text-text">{cote.libelle}</h4>
          <p className="break-words text-sm font-semibold tabular-nums text-text">
            {cote.stock === null ? "Indisponible" : formatEntier(cote.stock)}
          </p>
          <p className="text-[10px] text-text-dim">contrats encore ouverts</p>
          <p className="text-[11px] tabular-nums text-text">
            {libelleMouvementCot(cote.delta)}
            {cote.delta !== null && <> : <strong>{entierSigneCot(cote.delta)}</strong> contrats</>}
          </p>
        </div>
      ))}
    </div>
  );
}

export function NetCot({ ligne }: { ligne: LigneCot }) {
  const libelle = !Number.isFinite(ligne.net) ? "Net indisponible"
    : ligne.net > 0 ? "Net acheteur" : ligne.net < 0 ? "Net vendeur" : "Équilibré";
  return (
    <p className="text-[11px] tabular-nums text-text-dim">
      {libelle} : {entierSigneCot(ligne.net)} contrats · Δ net : {entierSigneCot(ligne.delta)}
      {ligne.delta !== null ? " contrats" : " (indisponible)"}
    </p>
  );
}

export function GuidePositionsCot() {
  return (
    <aside aria-label="Comprendre les positions COT" className="space-y-1 border-b border-border px-3 py-2 text-[11px] leading-relaxed text-text-dim">
      <p><strong className="text-text">Long = acheteur · Short = vendeur.</strong> À classement constant : ajouts nets = plus d'ouvertures que de clôtures ; réductions nettes = l'inverse.</p>
      <p>Le COT compare des stocks : les flux bruts peuvent se compenser et restent inconnus ; changements de classement possibles.</p>
      <p>Net = longs − shorts · Δ net = Δ longs − Δ shorts. Ces positions peuvent aussi servir de couverture, pas une prévision de prix.</p>
    </aside>
  );
}
