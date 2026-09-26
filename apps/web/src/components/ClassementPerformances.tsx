/**
 * Onglet « Classement » de la vue marché (MAP) : les actifs les plus performants, à la
 * manière de l'accueil CoinGlass. Mêmes tuiles CoinGecko que la carte (top 250, ~5 min) :
 * aucune requête supplémentaire. Un clic ouvre la paire USDT sur le graphe si un
 * catalogue la cote ; la source reste choisie automatiquement par le routage.
 */
import { useEffect, useMemo, useState } from "react";
import type { CoinTile } from "../data/marketOverview";
import { fetchMarketCatalog } from "../data/marketRouting";
import { formatPct, formatPrice, formatUsd } from "../lib/format";
import { navigateTo } from "../lib/navigation";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "./TableTriable";
import { Chargement } from "./ui";
import {
  classerPerformances,
  PERIODES_CLASSEMENT,
  resumePerformances,
  valeurPeriode,
  type LigneClassement,
  type PeriodeClassement,
  type SensClassement,
} from "./classementPerformances.util";

const classeVariation = (v: number | null) => (v === null ? "text-text-dim" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-text-dim");

/** Colonne de variation d'une période, mise en avant quand c'est la période classée. */
function colonneVariation(periode: PeriodeClassement, label: string, active: boolean): ColonneTable<LigneClassement> {
  return {
    id: periode,
    label,
    align: "right",
    largeur: "0.8fr",
    triable: true,
    valeurTri: (l) => valeurPeriode(l, periode),
    rendu: (l) => {
      const v = valeurPeriode(l, periode);
      return <span className={`${classeVariation(v)} ${active ? "font-semibold" : ""}`}>{formatPct(v)}</span>;
    },
  };
}

function Bouton({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-[11px] transition ${actif ? "bg-accent text-accent-ink" : "bg-surface text-text-dim hover:text-text"}`}
    >
      {children}
    </button>
  );
}

export function ClassementPerformances({ coins, loading }: { coins: readonly CoinTile[]; loading: boolean }) {
  const [periode, setPeriode] = useState<PeriodeClassement>("24h");
  const [sens, setSens] = useState<SensClassement>("hausses");
  const [univers, setUnivers] = useState(100);
  const [sansStables, setSansStables] = useState(true);
  const [tri, setTri] = useState<TriTable | null>(null);
  const [paires, setPaires] = useState<ReadonlySet<string> | null>(null);

  // Paires spot cotées (tous catalogues) : un clic n'ouvre qu'un instrument réel.
  useEffect(() => {
    let actif = true;
    void fetchMarketCatalog()
      .then((c) => { if (actif) setPaires(new Set(c.instruments.filter((i) => i.kind === "spot").map((i) => i.symbol))); })
      .catch(() => { /* sans catalogue, les lignes restent consultables mais ne naviguent pas */ });
    return () => { actif = false; };
  }, []);

  const lignes = useMemo(
    () => classerPerformances(coins, { periode, sens, univers, sansStables }),
    [coins, periode, sens, univers, sansStables],
  );
  const resume = resumePerformances(lignes, periode);

  const colonnes: ColonneTable<LigneClassement>[] = [
    { id: "rang", label: "#", largeur: "2.2rem", rendu: (l) => <span className="text-text-dim">{l.rang}</span> },
    {
      id: "actif",
      label: "Actif",
      largeur: "1.6fr",
      triable: true,
      valeurTri: (l) => l.symbol,
      rendu: (l) => (
        <span className="flex min-w-0 items-baseline gap-1.5" title={`${l.name} — rang ${l.rangCap} par capitalisation`}>
          <span className="font-semibold text-text">{l.symbol}</span>
          <span className="truncate text-[10px] text-text-dim">{l.name}</span>
        </span>
      ),
    },
    { id: "prix", label: "Prix", align: "right", triable: true, valeurTri: (l) => l.price, rendu: (l) => formatPrice(l.price) },
    ...PERIODES_CLASSEMENT.map((p) => colonneVariation(p.id, p.label, p.id === periode)),
    { id: "volume", label: "Vol. 24 h", align: "right", triable: true, valeurTri: (l) => l.volume24hUsd, rendu: (l) => formatUsd(l.volume24hUsd) },
    { id: "cap", label: "Cap.", align: "right", triable: true, valeurTri: (l) => l.mcapUsd, rendu: (l) => formatUsd(l.mcapUsd) },
  ];
  const affichees = tri === null ? lignes : trierLignes(lignes, colonnes, tri);
  const paire = (l: LigneClassement) => `${l.symbol}USDT`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Période du classement">
          {PERIODES_CLASSEMENT.map((p) => (
            <Bouton key={p.id} actif={p.id === periode} onClick={() => { setPeriode(p.id); setTri(null); }}>{p.label}</Bouton>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Sens du classement">
          <Bouton actif={sens === "hausses"} onClick={() => { setSens("hausses"); setTri(null); }}>Hausses</Bouton>
          <Bouton actif={sens === "baisses"} onClick={() => { setSens("baisses"); setTri(null); }}>Baisses</Bouton>
        </div>
        <div className="flex gap-1" role="group" aria-label="Univers du classement">
          <Bouton actif={univers === 100} onClick={() => setUnivers(100)}>Top 100</Bouton>
          <Bouton actif={univers === 250} onClick={() => setUnivers(250)}>Top 250</Bouton>
        </div>
        <label className="flex items-center gap-1 text-[11px] text-text-dim">
          <input type="checkbox" checked={sansStables} onChange={(e) => setSansStables(e.target.checked)} />
          Hors stablecoins
        </label>
        <span className="ml-auto text-[11px] text-text-dim">
          <span className="text-up">▲ {resume.hausses}</span> · <span className="text-down">▼ {resume.baisses}</span> · médiane{" "}
          <span className={classeVariation(resume.mediane)}>{formatPct(resume.mediane)}</span>
        </span>
      </div>
      {coins.length === 0 && loading ? (
        <Chargement />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TableTriable
            ariaLabel="Classement des performances"
            colonnes={colonnes}
            lignes={affichees}
            tri={tri}
            onTri={setTri}
            cle={(l) => l.id}
            vide="Aucun actif avec une variation connue sur cette période."
            surClicLigne={(l) => { if (paires?.has(paire(l))) navigateTo({ symbol: paire(l), source: "map" }); }}
          />
        </div>
      )}
    </div>
  );
}
