import { useEffect, useId, useRef, useState } from "react";
import { formatUsd } from "../../lib/format";
import { BLEU_EXPOSITION, ORANGE_EXPOSITION, type MetriqueExposition } from "./CarteExpositions";
import { formatUsdExact } from "./format";

interface Point { spot: number; gex: number; dex: number }
interface Props { points: Point[]; spot: number; metrique: MetriqueExposition; portee: string }

/** Profil en prix simulé : géométrie SVG et curseur contrôlé par clic ou clavier. */
export function ProfilExpositions({ points, spot, metrique, portee }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [largeur, setLargeur] = useState(540);
  const [indice, setIndice] = useState(20);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entree]) => { if (entree) setLargeur(Math.max(280, entree.contentRect.width)); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const gauche = 68; const droite = largeur - 14; const haut = 20; const bas = 205;
  const valeurs = points.map((p) => p[metrique]);
  const min = Math.min(0, ...valeurs); const max = Math.max(0, ...valeurs);
  const marge = (max - min || 1) * 0.12;
  const yMin = min - marge; const yMax = max + marge;
  const x = (s: number) => gauche + ((s / spot - 0.85) / 0.3) * (droite - gauche);
  const y = (v: number) => bas - ((v - yMin) / (yMax - yMin)) * (bas - haut);
  const chemin = points.map((p, i) => `${i ? "L" : "M"}${x(p.spot).toFixed(2)},${y(p[metrique]).toFixed(2)}`).join(" ");
  const choisi = points[Math.min(indice, points.length - 1)];
  const clic = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * largeur;
    setIndice(Math.round(Math.max(0, Math.min(1, (px - gauche) / (droite - gauche))) * (points.length - 1)));
  };
  return <section ref={ref} className="min-w-0" aria-label="Sensibilité au prix">
    <div className="mb-1 flex flex-wrap justify-between gap-2 text-[10px] text-text-dim"><span>{metrique.toUpperCase()} net · {portee}</span><span>{metrique === "gex" ? "USD par +1 %" : "USD notionnels"}</span></div>
    {points.length === 0 || !Number.isFinite(spot) ? <p className="py-20 text-center text-[11px] text-text-dim">Profil indisponible sans exposition calculable.</p> : <>
      <svg role="img" aria-label={`Sensibilité ${metrique.toUpperCase()} au prix simulé`} viewBox={`0 0 ${largeur} 238`} className="h-[238px] w-full cursor-crosshair" onClick={clic}>
        <defs><clipPath id={`${id}positif`}><rect x={gauche} y={0} width={droite - gauche} height={y(0)} /></clipPath><clipPath id={`${id}negatif`}><rect x={gauche} y={y(0)} width={droite - gauche} height={238 - y(0)} /></clipPath></defs>
        {[min, max].filter((v, i, a) => Math.abs(y(v) - y(0)) >= 14 && a.indexOf(v) === i).map((v) => <g key={v}><line x1={gauche} x2={droite} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={gauche - 8} y={y(v) + 3} fill="var(--text-dim)" fontSize="10" textAnchor="end">{formatUsd(v)}</text></g>)}
        <line x1={gauche} x2={droite} y1={y(0)} y2={y(0)} stroke="var(--text-dim)" strokeDasharray="3 4" />
        <text x={gauche - 8} y={y(0) + 3} fill="var(--text-dim)" fontSize="10" textAnchor="end">0</text>
        <line x1={x(spot)} x2={x(spot)} y1={haut} y2={bas} stroke="var(--text-dim)" />
        <text x={x(spot) + 5} y={12} fill="var(--text-dim)" fontSize="10">Spot actuel</text>
        <path d={chemin} fill="none" stroke={`rgb(${BLEU_EXPOSITION})`} strokeWidth="2.5" clipPath={`url(#${id}positif)`} />
        <path d={chemin} fill="none" stroke={`rgb(${ORANGE_EXPOSITION})`} strokeWidth="2.5" clipPath={`url(#${id}negatif)`} />
        {[0.85, 1, 1.15].map((rapport) => <text key={rapport} x={x(spot * rapport)} y={227} fill="var(--text-dim)" fontSize="10" textAnchor={rapport === .85 ? "start" : rapport === 1.15 ? "end" : "middle"}>{formatUsdExact(spot * rapport)}</text>)}
        {choisi && <g><line x1={x(choisi.spot)} x2={x(choisi.spot)} y1={haut} y2={bas} stroke="var(--text)" strokeDasharray="2 3" /><circle cx={x(choisi.spot)} cy={y(choisi[metrique])} r="4" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" /></g>}
      </svg>
      <input type="range" min="0" max={points.length - 1} step="1" value={Math.min(indice, points.length - 1)} onChange={(e) => setIndice(Number(e.target.value))} aria-label="Prix simulé" aria-valuetext={choisi ? formatUsdExact(choisi.spot) : undefined} className="w-full accent-text" />
      {choisi && <section aria-label="Lecture du prix simulé" className="mt-1 flex flex-wrap justify-between gap-2 text-[11px] tabular-nums"><span>Prix {formatUsdExact(choisi.spot)}</span><span>GEX {formatUsd(choisi.gex)} /1 %</span><span>DEX {formatUsd(choisi.dex)}</span></section>}
    </>}
    <p className="mt-2 text-[10px] leading-relaxed text-text-dim">IV, OI, temps restant et ratio forward/index constants. Sensibilité modélisée à ±15 % du spot ; aucune prévision de prix ni positions dealers observées.</p>
  </section>;
}
