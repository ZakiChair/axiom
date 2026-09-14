/**
 * Section repliable « OI perps DEX » de DES : open interest quotidien des perpétuels DEX
 * (DefiLlama, catégorie Derivatives, tous actifs). Vue PURE testée en rendu statique +
 * conteneur qui charge au PREMIER dépliage seulement (verrou « déjà chargé », cache 1 h
 * dans `data/onchain/oiPerpsDex.ts`). Indépendante de la clé Coinalyze et de l'exchange.
 */
import { useEffect, useState } from "react";
import type { PointEconomie } from "../data/onchain/economieChaines";
import type { ResultatFrais } from "../data/onchain/mempool";
import { fetchOiPerpsDex, type OiPerpsDex } from "../data/onchain/oiPerpsDex";
import { metaSource } from "../lib/fiabilite";
import { formatPct, formatPourcentage, formatUsd } from "../lib/format";
import { Badge, BadgeFiabilite, BarreProgression, NoteSource, TuileStat, Vide } from "./ui";

// Courbe et provenance LOCALES plutôt que `onchain/HistoriqueCommun` : partager ce module
// entre DES et CHAIN crée un chunk commun dont le nom s'ajoute aux dépendances préchargées
// de l'entrée (+37 o gzip mesurés), hors du budget initial de ce lot (0 octet).

const JOUR_MS = 86_400_000;
/** Part du total courant exclue du Δ à périmètre constant au-delà de laquelle on l'affiche. */
const SEUIL_EXCLU_PCT = 1;
const jourIso = (t: number) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : "—");

function classeVariation(v: number | null): string {
  return v === null ? "text-text-dim" : v >= 0 ? "text-up" : "text-down";
}

/** Dates réelles en abscisse ; un jour absent interrompt la ligne. */
function CourbeOiDex({ serie }: { serie: readonly PointEconomie[] }) {
  if (serie.length < 2) return null;
  const x0 = serie[0]!.time;
  const x1 = serie.at(-1)!.time;
  const min = Math.min(...serie.map((p) => p.value));
  const max = Math.max(...serie.map((p) => p.value));
  const x = (t: number) => 4 + ((t - x0) / (x1 - x0 || 1)) * 292;
  const y = (v: number) => 56 - ((v - min) / (max - min || 1)) * 48;
  const d = serie
    .map((p, i) => {
      const rupture = i === 0 || p.time - serie[i - 1]!.time > 1.5 * JOUR_MS;
      return `${rupture ? "M" : "L"}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`;
    })
    .join(" ");
  return (
    <figure className="mt-1" aria-label="OI perps DEX quotidien (USD)">
      <svg viewBox="0 0 300 64" className="h-16 w-full" role="img" aria-label="OI perps DEX quotidien">
        <title>{`OI perps DEX quotidien · USD · ${jourIso(x0)} au ${jourIso(x1)}`}</title>
        <path d={d} fill="none" stroke="var(--serie-5)" strokeWidth="1.5" />
      </svg>
      <figcaption className="flex justify-between gap-1 text-[9px] text-text-dim">
        <span>{jourIso(x0)}</span>
        <span>
          {formatUsd(min)} → {formatUsd(max)}
        </span>
        <span>{jourIso(x1)}</span>
      </figcaption>
    </figure>
  );
}

export function VueOiPerpsDex({
  resultat,
  loading = false,
}: {
  resultat: ResultatFrais<OiPerpsDex> | null;
  loading?: boolean;
}) {
  if (resultat === null) {
    return <Vide>{loading ? "Chargement de l'OI perps DEX…" : "OI perps DEX indisponible (DefiLlama)."}</Vide>;
  }
  const d = resultat.donnee;
  const ecartRecord = (d.niveau / d.record.valeur - 1) * 100;
  const provisoire = jourIso(d.observation) === jourIso(Date.now());
  const exclusions = [
    ["7 j", d.exclu7jPct],
    ["30 j", d.exclu30jPct],
  ] as const;
  return (
    <div className="space-y-1.5">
      <TuileStat
        disposition="inline"
        label="OI perps DEX (Derivatives)"
        valeur={formatUsd(d.niveau)}
        couleur="var(--serie-5)"
      />
      <div className="flex items-baseline justify-between gap-2 px-1 text-[11px] tabular-nums">
        <span className="text-text-dim">Variation</span>
        <span className="flex gap-3">
          <span className={classeVariation(d.delta7jPct)}>7 j {formatPct(d.delta7jPct, 1)}</span>
          <span className={classeVariation(d.delta30jPct)}>30 j {formatPct(d.delta30jPct, 1)}</span>
        </span>
      </div>
      {exclusions.map(
        ([horizon, exclu]) =>
          exclu !== null &&
          exclu > SEUIL_EXCLU_PCT && (
            <p key={horizon} className="px-1 text-[10px] text-text-dim">
              {horizon} · périmètre constant : {formatPourcentage(exclu, 1)} du total actuel exclu (protocoles apparus)
            </p>
          ),
      )}
      <div className="space-y-0.5">
        <div className="flex items-baseline justify-between gap-2 px-1 text-[11px]">
          <span className="text-text-dim">Part d'Hyperliquid Perps</span>
          <span className="tabular-nums text-text">{formatPourcentage(d.partHyperliquidPct, 1)}</span>
        </div>
        {d.partHyperliquidPct !== null && (
          <BarreProgression fraction={d.partHyperliquidPct / 100} ariaLabel="Part d'Hyperliquid Perps" />
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 px-1 text-[11px]">
        <span className="text-text-dim">Record de la catégorie</span>
        <span className="tabular-nums text-text">
          {formatUsd(d.record.valeur)} · {jourIso(d.record.time)} · écart{" "}
          {formatPct(ecartRecord, 1, { signe: false })}
        </span>
      </div>
      <CourbeOiDex serie={d.serie} />
      <NoteSource>
        <BadgeFiabilite meta={metaSource("defillama")} /> · DefiLlama (open interest, catégorie Derivatives) ·
        observation {jourIso(d.observation)} · récupéré {jourIso(resultat.ts)}
        {resultat.perime && (
          <>
            {" "}
            · <Badge ton="warn">cache ou observation périmé</Badge>
          </>
        )}
      </NoteSource>
      <NoteSource>
        OI de tous actifs (pas le seul BTC) des protocoles classés « Derivatives » par DefiLlama ;
        exclus : marchés prédictifs, dérivés de taux, interfaces (tradeXYZ, HIP-3).
        {provisoire && " Dernier point = jour UTC en cours, actualisé en continu : provisoire."} Périmètre
        DefiLlama révisable (protocoles ajoutés ou reclassés) ; un protocole sans valeur un jour donné
        minore ce jour. DefiLlama compte Hyperliquid Perps ≈ +29 % au-dessus de Σ OI × prix mark de
        l'API Hyperliquid (mesure du 2026-09-14) : lire la part comme un ordre de grandeur. Δ7j et
        Δ30j à périmètre constant (protocoles présents aux deux dates) ; niveau, part et record :
        total DefiLlama de chaque jour, sur tout l'historique ; courbe : 120 derniers jours.
      </NoteSource>
    </div>
  );
}

export function SectionOiPerpsDex() {
  const [ouvert, setOuvert] = useState(false);
  const [charge, setCharge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultat, setResultat] = useState<ResultatFrais<OiPerpsDex> | null>(null);

  // Premier dépliage seulement : `charge` verrouille contre tout re-fetch (le cache 1 h
  // sert les réouvertures de la fenêtre). Un repli pendant le chargement annule sans verrouiller.
  useEffect(() => {
    if (!ouvert || charge) return;
    const ctrl = new AbortController();
    let ignore = false;
    setLoading(true);
    void fetchOiPerpsDex(ctrl.signal).then((r) => {
      if (ignore) return;
      setResultat(r);
      setCharge(true);
      setLoading(false);
    });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [ouvert, charge]);

  return (
    <section className="mt-3 rounded-md border border-border bg-bg">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px] uppercase tracking-wide text-text-dim">OI perps DEX (quotidien, tous actifs)</span>
        <span className="text-[11px] text-text-dim">{ouvert ? "▾" : "▸"}</span>
      </button>
      {ouvert && (
        <div className="border-t border-border px-3 py-2">
          <VueOiPerpsDex resultat={resultat} loading={loading} />
        </div>
      )}
    </section>
  );
}
