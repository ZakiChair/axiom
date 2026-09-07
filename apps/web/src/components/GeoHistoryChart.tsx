import { useState } from "react";
import type { PointGeo } from "../../../../shared/geo-series";

/** Courbe de données lentes : unité explicite, interruptions aux périodes manquantes. */
export function GeoHistoryChart({ points, nom, unite, pasMaxJours = 45 }: { points: readonly PointGeo[]; nom: string; unite: string; pasMaxJours?: number }) {
  const [index, setIndex] = useState<number | null>(null);
  if (points.length === 0) return <p className="text-[11px] text-text-dim">Historique indisponible.</p>;
  const premier = points[0]!, dernier = points[points.length - 1]!;
  const valeurs = points.map(p => p.value);
  const min = Math.min(...valeurs), max = Math.max(...valeurs), amplitude = max - min || 1;
  const x = (t: number) => 45 + (t - premier.time) / (dernier.time - premier.time || 1) * 505;
  const y = (v: number) => 145 - (v - min) / amplitude * 120;
  const chemin = points.map((p, i) => `${i === 0 || p.time - points[i - 1]!.time > pasMaxJours * 86_400_000 ? "M" : "L"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const choisi = points[Math.min(index ?? points.length - 1, points.length - 1)]!;
  const date = (t: number) => new Date(t).toISOString().slice(0, pasMaxJours > 2 ? 7 : 10);
  const format = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return <figure className="min-w-0 rounded border border-border p-2">
    <figcaption className="flex flex-wrap justify-between gap-2 text-[11px] text-text">
      <span>{nom}</span><span>{date(choisi.time)} · {format(choisi.value)} {unite}</span>
    </figcaption>
    <svg viewBox="0 0 570 174" role="img" aria-label={`Évolution de ${nom}, en ${unite}`} className="w-full text-text-dim"
      onPointerMove={e => {
        const box = e.currentTarget.getBoundingClientRect();
        const cible = premier.time + Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width * 570 - 45) / 505)) * (dernier.time - premier.time);
        let proche = 0;
        for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.time - cible) < Math.abs(points[proche]!.time - cible)) proche = i;
        setIndex(proche);
      }} onPointerLeave={() => setIndex(null)}>
      <path d="M45,25 V145 H550" fill="none" stroke="currentColor" opacity=".35" />
      <text x="41" y="29" textAnchor="end" fill="currentColor" fontSize="10">{format(max)}</text>
      <text x="41" y="145" textAnchor="end" fill="currentColor" fontSize="10">{format(min)}</text>
      <text x="45" y="165" fill="currentColor" fontSize="10">{date(premier.time)}</text>
      <text x="550" y="165" textAnchor="end" fill="currentColor" fontSize="10">{date(dernier.time)}</text>
      <path d={chemin} fill="none" stroke="rgb(var(--serie-1-rgb))" strokeWidth="1.8" />
      <circle cx={x(choisi.time)} cy={y(choisi.value)} r="3" fill="rgb(var(--serie-1-rgb))" />
    </svg>
    <input type="range" aria-label={`Parcourir les observations de ${nom}`} min={0} max={points.length - 1} value={index ?? points.length - 1} onChange={e => setIndex(Number(e.target.value))} className="w-full accent-accent" />
  </figure>;
}
