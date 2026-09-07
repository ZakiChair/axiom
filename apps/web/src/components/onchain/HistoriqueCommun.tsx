import { formatCompact } from "../../lib/format";
import { Badge, BadgeFiabilite, NoteSource } from "../ui";
import { metaSource } from "../../lib/fiabilite";

export const boutonHistorique = "rounded border border-border px-2 py-1 text-[11px] text-text-dim hover:border-accent hover:text-text";
export const dateObservation = (time: number) => Number.isFinite(time) && time > 0 ? new Date(time).toISOString().slice(0, 10) : "—";
export const valeurUnite = (v: number | null | undefined, unite: string) => v == null ? "—" : `${formatCompact(v)} ${unite}`;

/** Dates réelles en abscisse ; une observation manquante interrompt la ligne. */
export function CourbeOnchain({ points, label, unite, zero = false, ecartMaxJours = 1.5 }: {
  points: readonly { time: number; value: number | null }[]; label: string; unite: string; zero?: boolean; ecartMaxJours?: number;
}) {
  const fenetre = points.slice(-120);
  const valides = fenetre.filter((p): p is { time: number; value: number } => p.value !== null && Number.isFinite(p.value));
  if (valides.length < 2) return null;
  const xmin = fenetre[0]!.time; const xmax = fenetre.at(-1)!.time;
  const ymin = Math.min(...valides.map(p => p.value), ...(zero ? [0] : []));
  const ymax = Math.max(...valides.map(p => p.value), ...(zero ? [0] : []));
  const x = (t: number) => 4 + (t - xmin) / (xmax - xmin || 1) * 292;
  const y = (v: number) => 56 - (v - ymin) / (ymax - ymin || 1) * 48;
  let rupture = true; let precedent = 0;
  const d = fenetre.map(p => {
    if (p.value === null || !Number.isFinite(p.value)) { rupture = true; return ""; }
    if (p.time - precedent > ecartMaxJours * 86_400_000) rupture = true;
    const commande = `${rupture ? "M" : "L"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`;
    rupture = false; precedent = p.time; return commande;
  }).join(" ");
  return <figure className="mt-1" aria-label={`${label} (${unite})`}>
    <svg viewBox="0 0 300 64" className="h-16 w-full" role="img" aria-label={label}>
      <title>{`${label} · ${unite} · ${dateObservation(xmin)} au ${dateObservation(xmax)}`}</title>
      {zero && <line x1="4" x2="296" y1={y(0)} y2={y(0)} stroke="var(--border)" strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke="var(--serie-4)" strokeWidth="1.5" />
      {valides.map(p => <circle key={p.time} cx={x(p.time)} cy={y(p.value)} r="2" fill="var(--serie-4)">
        <title>{`${dateObservation(p.time)} · ${valeurUnite(p.value, unite)}`}</title>
      </circle>)}
    </svg>
    <figcaption className="flex justify-between gap-1 text-[9px] text-text-dim">
      <span>{dateObservation(xmin)}</span><span>{valeurUnite(ymin, unite)} → {valeurUnite(ymax, unite)}</span><span>{dateObservation(xmax)}</span>
    </figcaption>
  </figure>;
}

export function ProvenanceOnchain({ source, sourceId = "bgeometrics", observation, recuperation, perime }: {
  source: string; sourceId?: string; observation?: number; recuperation: number; perime: boolean;
}) {
  return <NoteSource><BadgeFiabilite meta={metaSource(sourceId)} /> · {source} · observation {dateObservation(observation ?? 0)} · récupéré {dateObservation(recuperation)}
    {perime && <> · <Badge ton="warn">cache ou observation périmé</Badge></>}
  </NoteSource>;
}
