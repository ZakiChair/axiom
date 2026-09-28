import { useEffect, useMemo, useRef, useState } from "react";
import type { CarteExpositions as Carte } from "../../data/carteExpositions";
import { construireGraphiqueExpositions } from "../../data/graphiqueExpositions";
import { formatPct, formatUsd } from "../../lib/format";
import { Segmente } from "../ui";
import { BLEU_EXPOSITION, ORANGE_EXPOSITION, dateExposition, type MetriqueExposition } from "./CarteExpositions";
import { formatUsdExact } from "./format";

interface Props { carte: Carte; spot: number; metrique: MetriqueExposition; convertirStrike?: (strike: number) => string }
// L'encre du thème fonce les barres en clair et les éclaircit en sombre, sans en épaissir la géométrie.
const couleur = (v: number) => v === 0 ? "var(--text-dim)" : `color-mix(in srgb, rgb(${v > 0 ? BLEU_EXPOSITION : ORANGE_EXPOSITION}) 40%, var(--text))`;
const signe = (v: number | null) => v !== null && v > 0 ? `+${formatUsd(v)}` : formatUsd(v);

/** Géométrie linéaire, zéro toujours inclus ; le domaine des montants reste propre à chaque graphique. */
function echelleY(valeurs: (number | null)[], haut: number, bas: number) {
  const connues = valeurs.filter((v): v is number => v !== null);
  const min = Math.min(0, ...connues); const max = Math.max(0, ...connues);
  const marge = (max - min || 1) * .1;
  const y = (v: number) => bas - (v - min + marge) / (max - min + 2 * marge) * (bas - haut);
  return { y, ticks: [min, 0, max].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || Math.abs(y(v) - y(0)) >= 14)) };
}

function AxesMontants({ ticks, y, gauche, droite }: { ticks: number[]; y: (v: number) => number; gauche: number; droite: number }) {
  return <>{ticks.map((v) => <g key={v}>
    <line x1={gauche} x2={droite} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--text-dim)" : "var(--border)"} strokeWidth={v === 0 ? 1.2 : 1} />
    <text x={gauche - 7} y={y(v) + 3} fill="var(--text-dim)" fontSize="10" textAnchor="end">{v === 0 ? "0" : signe(v)}</text>
  </g>)}</>;
}

/** Deux graphiques signés : strikes à leur prix réel, échéances catégorielles sur toute la portée. */
export function GraphiqueExpositions({ carte, spot, metrique, convertirStrike }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [largeur, setLargeur] = useState(540);
  const [cadrage, setCadrage] = useState<"proche" | "tous">("proche");
  const [strike, setStrike] = useState<number | null>(null);
  const [survolStrike, setSurvolStrike] = useState<number | null>(null);
  const [echeance, setEcheance] = useState<number | null>(null);
  const [survolEcheance, setSurvolEcheance] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entree]) => { if (entree) setLargeur(Math.max(240, entree.contentRect.width)); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const donnees = useMemo(() => construireGraphiqueExpositions(carte, spot, cadrage), [carte, spot, cadrage]);
  const { points, domainePrix, echeances } = donnees;
  const procheSpot = points.reduce((a, p, i) => Math.abs(p.strike - spot) < Math.abs(points[a]!.strike - spot) ? i : a, 0);
  const indiceChoisi = Math.max(0, points.findIndex((p) => p.strike === strike));
  const indice = strike !== null && points.some((p) => p.strike === strike) ? indiceChoisi : procheSpot;
  const choisi = points.find((p) => p.strike === survolStrike) ?? points[indice];
  const indiceEcheance = Math.max(0, echeances.findIndex((e) => e.expiryMs === echeance));
  const choisie = echeances.find((e) => e.expiryMs === survolEcheance) ?? echeances[indiceEcheance];
  const gauche = 66; const droite = largeur - 14; const haut = 25; const bas = 243;
  // Une demi-largeur de barre aux extrémités protège les axes, sans changer le cadrage en prix.
  const x = (prix: number) => domainePrix ? gauche + 14 + (prix - domainePrix.min) / (domainePrix.max - domainePrix.min) * (droite - gauche - 28) : gauche;
  const { y, ticks } = echelleY(points.map((p) => p[metrique]), haut, bas);
  const espacement = points.slice(1).reduce((m, p, i) => Math.min(m, x(p.strike) - x(points[i]!.strike)), 32);
  const barre = Math.max(1, Math.min(26, espacement * .72));
  const px = (event: React.MouseEvent<SVGSVGElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    return (event.clientX - r.left) / r.width * largeur;
  };
  const pointeStrike = (event: React.MouseEvent<SVGSVGElement>) => {
    const pos = px(event);
    return points.reduce((a, p) => Math.abs(x(p.strike) - pos) < Math.abs(x(a.strike) - pos) ? p : a, points[0]!)?.strike ?? null;
  };
  const { y: yEcheance, ticks: ticksEcheance } = echelleY(echeances.map((e) => e[metrique]), 15, 118);
  const pas = (droite - gauche) / Math.max(1, echeances.length);
  const xEcheance = (i: number) => gauche + pas * (i + .5);
  const pointeEcheance = (event: React.MouseEvent<SVGSVGElement>) => echeances[Math.max(0, Math.min(echeances.length - 1, Math.floor((px(event) - gauche) / pas)))]?.expiryMs ?? null;
  const unite = metrique === "gex" ? "GEX en USD par +1 %" : "DEX en USD notionnels";

  return <section ref={ref} aria-label="Graphiques des expositions" className="min-w-0">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] font-medium">Exposition nette par strike</span>
      <Segmente options={[{ id: "proche", label: "Autour du spot ±30 %" }, { id: "tous", label: "Tous les strikes" }] as const} actif={cadrage} onChange={(v) => { setCadrage(v); setSurvolStrike(null); }} />
    </div>
    <div className="flex flex-wrap justify-between gap-1 text-[10px] text-text-dim"><span>{unite}</span><span>{donnees.nbStrikesAffiches} strikes affichés sur {donnees.nbStrikesTotal}</span></div>
    {points.length && domainePrix ? <>
      <svg role="img" aria-label={`${metrique.toUpperCase()} net par strike`} viewBox={`0 0 ${largeur} 280`} className="h-[280px] w-full cursor-crosshair"
        onMouseMove={(e) => setSurvolStrike(pointeStrike(e))} onMouseLeave={() => setSurvolStrike(null)} onClick={(e) => setStrike(pointeStrike(e))}>
        <rect x={gauche} y={haut} width={droite - gauche} height={y(0) - haut} fill={`rgba(${BLEU_EXPOSITION}, .045)`} />
        <rect x={gauche} y={y(0)} width={droite - gauche} height={bas - y(0)} fill={`rgba(${ORANGE_EXPOSITION}, .045)`} />
        <AxesMontants ticks={ticks} y={y} gauche={gauche} droite={droite} />
        {points.map((p) => <g key={p.strike}>
          {p[metrique] === 0 ? <circle cx={x(p.strike)} cy={y(0)} r="2.5" fill="var(--text-dim)" /> : <rect data-strike={p.strike} x={x(p.strike) - barre / 2} y={Math.min(y(0), y(p[metrique]))} width={barre} height={Math.abs(y(p[metrique]) - y(0))} fill={couleur(p[metrique])} fillOpacity={choisi?.strike === p.strike ? 1 : .8} />}
          <title>{`Strike ${formatUsdExact(p.strike)} · GEX ${signe(p.gex)} /1 % · DEX ${signe(p.dex)}`}</title>
        </g>)}
        {Number.isFinite(spot) && spot >= domainePrix.min && spot <= domainePrix.max && <g pointerEvents="none">
          <line x1={x(spot)} x2={x(spot)} y1={haut} y2={bas} stroke="var(--text)" strokeDasharray="4 3" />
          <text x={Math.max(gauche + 4, Math.min(droite - 4, x(spot)))} y="13" textAnchor={x(spot) > droite - 70 ? "end" : x(spot) < gauche + 70 ? "start" : "middle"} fill="var(--text)" fontSize="10">Spot {formatUsdExact(spot)}</text>
        </g>}
        {choisi && <line x1={x(choisi.strike)} x2={x(choisi.strike)} y1={haut} y2={bas} stroke="var(--text)" strokeOpacity=".5" pointerEvents="none" />}
        {[0, .5, 1].map((part) => {
          const prix = domainePrix.min + part * (domainePrix.max - domainePrix.min);
          return <text key={part} x={x(prix)} y="265" textAnchor={part === 0 ? "start" : part === 1 ? "end" : "middle"} fill="var(--text-dim)" fontSize="10">{formatUsdExact(prix)}</text>;
        })}
      </svg>
      <input type="range" min="0" max={points.length - 1} value={indice} onChange={(e) => { setStrike(points[Number(e.target.value)]!.strike); setSurvolStrike(null); }} aria-label="Strike sélectionné" aria-valuetext={formatUsdExact(points[indice]?.strike)} className="w-full accent-text" />
      {choisi && <section aria-label="Détail du strike" className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] tabular-nums">
        <span>Strike <strong>{formatUsdExact(choisi.strike)}</strong> <span className="text-text-dim">({formatPct((choisi.strike / spot - 1) * 100, 1)})</span>{convertirStrike && <small className="ml-2 text-text-dim">{convertirStrike(choisi.strike)}</small>}</span>
        <span>GEX <strong>{signe(choisi.gex)}</strong> /1 %</span><span>DEX <strong>{signe(choisi.dex)}</strong></span>
      </section>}
    </> : <p className="py-20 text-center text-[11px] text-text-dim">{donnees.nbStrikesTotal ? "Aucun strike calculable dans cette plage. Choisissez Tous les strikes." : "Aucune exposition calculable sur cette portée."}</p>}
    <p className="mt-2 text-[10px] text-text-dim">Net dans la plage affichée : {signe(donnees.netVisible[metrique])}{metrique === "gex" ? " /1 %" : ""}. Les chiffres en tête et les échéances couvrent toute la portée.</p>

    <section aria-label="Exposition par échéance" className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap justify-between gap-1 text-[10px]"><span className="font-medium text-text">Exposition par échéance</span><span className="text-text-dim">{unite} · dates catégorielles UTC</span></div>
      {echeances.some((e) => e[metrique] !== null) ? <>
        <svg role="img" aria-label={`${metrique.toUpperCase()} net par échéance`} viewBox={`0 0 ${largeur} 152`} className="h-[152px] w-full cursor-crosshair"
          onMouseMove={(e) => setSurvolEcheance(pointeEcheance(e))} onMouseLeave={() => setSurvolEcheance(null)} onClick={(e) => setEcheance(pointeEcheance(e))}>
          <AxesMontants ticks={ticksEcheance} y={yEcheance} gauche={gauche} droite={droite} />
          {echeances.map((e, i) => <g key={e.expiryMs}>
            {e[metrique] === null ? <text x={xEcheance(i)} y={yEcheance(0) - 5} fill="var(--text-dim)" fontSize="12" textAnchor="middle">—</text>
              : e[metrique] === 0 ? <circle cx={xEcheance(i)} cy={yEcheance(0)} r="2.5" fill="var(--text-dim)" />
              : <rect x={xEcheance(i) - Math.min(38, pas * .65) / 2} y={Math.min(yEcheance(0), yEcheance(e[metrique]!))} width={Math.min(38, pas * .65)} height={Math.abs(yEcheance(e[metrique]!) - yEcheance(0))} fill={couleur(e[metrique]!)} fillOpacity={choisie?.expiryMs === e.expiryMs ? 1 : .8} />}
            {(i % Math.max(1, Math.ceil(echeances.length / Math.max(1, (droite - gauche) / 72))) === 0) && <text x={xEcheance(i)} y="141" textAnchor="middle" fill="var(--text-dim)" fontSize="10">{dateExposition(e.expiryMs).replace(/ \d{2}$/, "")}</text>}
            <title>{`${dateExposition(e.expiryMs)} UTC · GEX ${signe(e.gex)} /1 % · DEX ${signe(e.dex)}`}</title>
          </g>)}
        </svg>
        {echeances.length > 1 && <input type="range" min="0" max={echeances.length - 1} value={indiceEcheance} onChange={(e) => { setEcheance(echeances[Number(e.target.value)]!.expiryMs); setSurvolEcheance(null); }} aria-label="Échéance du graphique" aria-valuetext={dateExposition(echeances[indiceEcheance]!.expiryMs)} className="w-full accent-text" />}
        {choisie && <section aria-label="Détail de l’échéance" className="flex flex-wrap justify-between gap-2 text-[11px] tabular-nums"><span>{dateExposition(choisie.expiryMs)} UTC</span><span>GEX {signe(choisie.gex)} /1 %</span><span>DEX {signe(choisie.dex)}</span></section>}
      </> : <p className="py-10 text-center text-[11px] text-text-dim">Aucune exposition calculable par échéance.</p>}
    </section>
    <p className="mt-3 text-[10px] leading-relaxed text-text-dim">Bleu positif, ambre négatif ; point sur zéro : net nul, — : donnée absente. Survolez ou sélectionnez un strike, puis utilisez les curseurs au clavier. Des positions opposées peuvent se compenser.</p>
  </section>;
}
