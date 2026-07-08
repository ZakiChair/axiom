/**
 * Fenêtre « CHAIN » — panneau ON-CHAIN, dockable à droite, NON MODAL (pattern DerivativesWindow).
 *
 * Grille de widgets compacts (valeur + sparkline canvas + libellé + fraîcheur + étiquette
 * de fiabilité) en trois sections : RÉSEAU BTC, VALORISATION, ETF. Données LENTES (daily
 * pour l'essentiel) → récupérées à l'ouverture, mises en cache (6 h / 24 h), et redégradées
 * proprement (cache périmé étiqueté, jamais d'erreur console en boucle).
 *
 * Sources : Coin Metrics community (sans clé), BGeometrics/bitcoin-data.com (clé optionnelle),
 * mempool.space (direct), SoSoValue/openapi.sosovalue.com (ETF spot BTC/ETH/SOL, clé
 * OBLIGATOIRE — section « indisponible » sans clé configurée).
 *
 * Règle d'or (doc 02) : chaque widget porte une étiquette de fiabilité honnête
 * (« daily », « live », « estimation », « indisponible »).
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { onchainUiStore, getBgeometricsKey, bgeometricsKeyStore } from "../store/onchain";
import { getSoSoValueKey, soSoValueKeyStore } from "../store/sosovalue";
import { getEtherscanKey, etherscanKeyStore } from "../store/etherscan";
import { settingsUiStore } from "../store/settings-ui";
import {
  fetchCoinMetrics,
  type CoinMetricsResultat,
  type SerieMetrique,
} from "../data/onchain/coinmetrics";
import { fetchBgeometrics, BG_METRIQUES, type BgResultat } from "../data/onchain/bgeometrics";
import {
  fetchHashrate,
  fetchMempoolReseau,
  type MempoolReseau,
  type ResultatFrais,
} from "../data/onchain/mempool";
import { fetchEtfFlows, type ActifEtf, type EtfResultat } from "../data/onchain/etf";
import { fetchReseauEth, type ReseauEth } from "../data/onchain/etherscan";

const ACTIFS_ETF: readonly ActifEtf[] = ["btc", "eth", "sol"];

// ─────────────────────────── Formatage ───────────────────────────

/** Nombre compact (1.2K / 3.4M / 5.6B). */
function fmtCompact(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

/** Montant USD compact. */
function fmtUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return `$${fmtCompact(n)}`;
}

/** Nombre à N décimales, ou tiret. */
function fmtDec(n: number | undefined, d = 2): string {
  return n !== undefined && Number.isFinite(n) ? n.toFixed(d) : "—";
}

/** Hashrate H/s → EH/s (1e18). */
function fmtHashrate(hps: number | undefined): string {
  if (hps === undefined || !Number.isFinite(hps)) return "—";
  return `${(hps / 1e18).toFixed(1)} EH/s`;
}

/** Prix de gas en Gwei (peut être < 1 en période calme → 2 décimales). */
function fmtGwei(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} Gwei`;
}

/** Date courte d'un ms epoch (ex. « 30 juin »). */
function fmtJour(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Âge relatif compact (« à l'instant », « il y a 12 min », « il y a 3 h »). */
function fmtAge(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`;
  return `il y a ${Math.floor(diff / 86_400_000)} j`;
}

/** Durée en jours (compte à rebours halving). */
function fmtJours(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const j = Math.round(ms / 86_400_000);
  return `≈ ${j.toLocaleString("fr-FR")} j`;
}

// ─────────────────────────── Sparkline canvas ───────────────────────────

const SPARK_W = 88;
const SPARK_H = 26;

/** Mini-courbe canvas (dessinée hors React à chaque changement de données). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cvs = ref.current;
    if (cvs === null) return;
    const ctx = cvs.getContext("2d");
    if (ctx === null) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    cvs.width = SPARK_W * dpr;
    cvs.height = SPARK_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    if (values.length < 2) return;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = SPARK_W / (values.length - 1);
    const pad = 2;
    const h = SPARK_H - pad * 2;

    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * step;
      const y = pad + (h - ((v - min) / span) * h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [values, color]);

  return (
    <canvas
      ref={ref}
      style={{ width: SPARK_W, height: SPARK_H }}
      className="shrink-0"
      aria-hidden="true"
    />
  );
}

// ─────────────────────────── Widget ───────────────────────────

type Fiabilite = "daily" | "live" | "estimation" | "indisponible";

const FIABILITE_STYLE: Record<Fiabilite, string> = {
  daily: "border-border text-text-dim",
  live: "border-up/50 text-up",
  estimation: "border-border text-text-dim",
  indisponible: "border-down/50 text-down",
};

/** Étiquette de fiabilité (honnête, cf. règle d'or doc 02). */
function FiabiliteTag({ f }: { f: Fiabilite }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${FIABILITE_STYLE[f]}`}
    >
      {f}
    </span>
  );
}

/** Un widget compact : libellé + étiquette, valeur + sparkline, sous-texte + fraîcheur. */
function Widget({
  libelle,
  valeur,
  fiabilite,
  spark,
  color,
  sousTexte,
  fraicheur,
  perime,
}: {
  libelle: string;
  valeur: string;
  fiabilite: Fiabilite;
  spark?: number[];
  color?: string;
  sousTexte?: string;
  fraicheur?: string;
  perime?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-text-dim">{libelle}</span>
        <FiabiliteTag f={fiabilite} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="tabular-nums text-base font-semibold text-text" style={color ? { color } : undefined}>
          {valeur}
        </span>
        {spark && spark.length >= 2 && <Sparkline values={spark} color={color ?? "#9ca3af"} />}
      </div>
      {(sousTexte || fraicheur) && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-text-dim">
          <span className="truncate">{sousTexte ?? ""}</span>
          <span className="shrink-0">
            {perime ? "cache périmé · " : ""}
            {fraicheur ?? ""}
          </span>
        </div>
      )}
    </div>
  );
}

/** Derniers N points d'une série (valeurs), pour la sparkline. */
function sparkDe(serie: SerieMetrique | undefined, n = 60): number[] {
  if (serie === undefined) return [];
  return serie.points.slice(-n).map((p) => p.value);
}

// ─────────────────────────── Fenêtre ───────────────────────────

interface EtatDonnees {
  cm: CoinMetricsResultat | null;
  bg: Record<string, BgResultat | null>;
  mp: ResultatFrais<MempoolReseau> | null;
  hr: ResultatFrais<SerieMetrique> | null;
  etf: Record<ActifEtf, EtfResultat | null>;
  eth: ReseauEth | null;
}

const VIDE: EtatDonnees = {
  cm: null,
  bg: {},
  mp: null,
  hr: null,
  etf: { btc: null, eth: null, sol: null },
  eth: null,
};

export function OnchainWindow() {
  const open = useStore(onchainUiStore, (s) => s.open);
  const bgHasKey = useStore(bgeometricsKeyStore, (s) => s.hasKey);
  const soSoHasKey = useStore(soSoValueKeyStore, (s) => s.hasKey);
  const etherscanHasKey = useStore(etherscanKeyStore, (s) => s.hasKey);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  const [donnees, setDonnees] = useState<EtatDonnees>(VIDE);
  const [loading, setLoading] = useState(false);
  const [actifEtf, setActifEtf] = useState<ActifEtf>("btc");

  useEffect(() => {
    if (!open) {
      setDonnees(VIDE);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    let ignore = false;

    const charger = async () => {
      setLoading(true);
      const cleSoSo = getSoSoValueKey();
      const [cm, bg, mp, hr, btcEtf, ethEtf, solEtf, eth] = await Promise.all([
        fetchCoinMetrics("btc", ctrl.signal),
        fetchBgeometrics(getBgeometricsKey(), ctrl.signal),
        fetchMempoolReseau(ctrl.signal),
        fetchHashrate(ctrl.signal),
        fetchEtfFlows("btc", cleSoSo, ctrl.signal),
        fetchEtfFlows("eth", cleSoSo, ctrl.signal),
        fetchEtfFlows("sol", cleSoSo, ctrl.signal),
        fetchReseauEth(getEtherscanKey(), ctrl.signal),
      ]);
      if (ignore) return;
      setDonnees({ cm, bg, mp, hr, etf: { btc: btcEtf, eth: ethEtf, sol: solEtf }, eth });
      setLoading(false);
    };

    void charger();
    return () => {
      ignore = true;
      ctrl.abort();
    };
    // bgHasKey/soSoHasKey/etherscanHasKey en dépendance : re-fetch quand une clé est saisie/retirée.
  }, [open, bgHasKey, soSoHasKey, etherscanHasKey]);

  const cm = donnees.cm;
  const adr = cm?.series["AdrActCnt"];
  const tx = cm?.series["TxCnt"];
  const feeNtv = cm?.series["FeeTotNtv"];
  const mcap = cm?.series["CapMrktCurUSD"];
  const mvrvRatio = cm?.series["CapMVRVCur"];
  const cmDaily = cm ? fmtJour(adr?.dernier?.time ?? tx?.dernier?.time) : "—";

  const mp = donnees.mp?.donnee;
  const halving = mp?.halving;
  const hr = donnees.hr?.donnee;
  const etf = donnees.etf[actifEtf];
  const eth = donnees.eth;

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">On-chain</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">
            Coin Metrics · BGeometrics · mempool.space {loading ? "· maj…" : ""}
          </p>
        </div>
        {/* Croix de fermeture retirée — fournie par le chrome FloatingWindow */}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* ─────────── RÉSEAU BTC ─────────── */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Réseau BTC
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Widget
              libelle="Adresses actives"
              valeur={fmtCompact(adr?.dernier?.value)}
              fiabilite="daily"
              spark={sparkDe(adr)}
              color="#38bdf8"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Transactions / j"
              valeur={fmtCompact(tx?.dernier?.value)}
              fiabilite="daily"
              spark={sparkDe(tx)}
              color="#a78bfa"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Frais totaux (BTC)"
              valeur={fmtDec(feeNtv?.dernier?.value, 2)}
              fiabilite="daily"
              spark={sparkDe(feeNtv)}
              color="#fbbf24"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Hashrate (1 an)"
              valeur={fmtHashrate(hr?.dernier?.value)}
              fiabilite="daily"
              spark={sparkDe(hr, 90)}
              color="#34d399"
              fraicheur={fmtJour(hr?.dernier?.time)}
              perime={donnees.hr?.perime}
            />
            <Widget
              libelle="Frais recommandés"
              valeur={mp ? `${fmtDec(mp.fees.fastestFee, 0)} sat/vB` : "—"}
              fiabilite="live"
              sousTexte={mp ? `1h ${fmtDec(mp.fees.hourFee, 0)} · éco ${fmtDec(mp.fees.economyFee, 0)}` : undefined}
              fraicheur={fmtAge(donnees.mp?.ts)}
              perime={donnees.mp?.perime}
            />
            <Widget
              libelle="Hauteur de bloc"
              valeur={mp ? mp.hauteur.toLocaleString("fr-FR") : "—"}
              fiabilite="live"
              fraicheur={fmtAge(donnees.mp?.ts)}
              perime={donnees.mp?.perime}
            />
            <div className="col-span-2">
              <Widget
                libelle={halving ? `Halving (bloc ${halving.prochainBloc.toLocaleString("fr-FR")})` : "Halving"}
                valeur={fmtJours(halving?.msEstimes)}
                fiabilite="estimation"
                sousTexte={
                  halving
                    ? `reste ${halving.blocsRestants.toLocaleString("fr-FR")} blocs → ${halving.recompenseApres} BTC`
                    : undefined
                }
                fraicheur={halving ? fmtJour(Date.now() + halving.msEstimes) : undefined}
              />
            </div>
          </div>
        </section>

        {/* ─────────── VALORISATION ─────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              Valorisation
            </h3>
            {!bgHasKey && (
              <button
                type="button"
                onClick={openSettings}
                className="text-[10px] text-accent hover:underline"
                title="Clé gratuite sur bitcoin-data.com — relève le quota (15 req/jour sans clé)"
              >
                clé BGeometrics ⚙
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {BG_METRIQUES.map((def) => {
              const r = donnees.bg[def.id] ?? null;
              return (
                <Widget
                  key={def.id}
                  libelle={def.libelle}
                  valeur={fmtDec(r?.serie.dernier?.value, def.id === "mvrv" ? 2 : 4)}
                  fiabilite="daily"
                  spark={sparkDe(r?.serie)}
                  color="#f472b6"
                  fraicheur={fmtJour(r?.serie.dernier?.time)}
                  perime={r?.perime}
                />
              );
            })}
            <Widget
              libelle="MVRV (ratio)"
              valeur={fmtDec(mvrvRatio?.dernier?.value, 2)}
              fiabilite="daily"
              spark={sparkDe(mvrvRatio)}
              color="#f472b6"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Cap. marché BTC"
              valeur={fmtUsd(mcap?.dernier?.value)}
              fiabilite="daily"
              spark={sparkDe(mcap)}
              color="#60a5fa"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
          </div>
          {!bgHasKey && (
            <p className="mt-2 text-[10px] leading-snug text-text-dim">
              MVRV Z-Score / SOPR / NUPL affichés sans clé (quota 15 req/jour, cache 24 h).
              Une clé gratuite sur bitcoin-data.com relève le quota.
            </p>
          )}
        </section>

        {/* ─────────── ETF ─────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              Flux ETF spot
            </h3>
            {!soSoHasKey && (
              <button
                type="button"
                onClick={openSettings}
                className="text-[10px] text-accent hover:underline"
                title="Clé gratuite sur sosovalue.com/developer — obligatoire (plan Demo)"
              >
                clé SoSoValue ⚙
              </button>
            )}
          </div>
          <div className="mb-2 flex gap-1">
            {ACTIFS_ETF.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setActifEtf(a)}
                className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide transition ${
                  actifEtf === a ? "bg-surface text-text" : "text-text-dim hover:text-text"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          {etf && etf.disponible && etf.parEmetteur ? (
            <div className="space-y-1 rounded-md border border-border bg-bg px-3 py-2">
              {etf.parEmetteur.map((e) => (
                <div key={e.emetteur} className="flex items-center justify-between text-[11px]">
                  <span className="text-text-dim">{e.emetteur}</span>
                  <span
                    className="tabular-nums"
                    style={{ color: e.flux >= 0 ? "#34d399" : "#f87171" }}
                  >
                    {fmtUsd(e.flux)}
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-[11px] font-medium">
                <span className="text-text">Cumul {etf.jour ?? ""}</span>
                <span className="tabular-nums text-text">{fmtUsd(etf.total)}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-3">
              <span className="text-[11px] leading-snug text-text-dim">
                {etf?.raison ?? "Flux ETF indisponibles."}
              </span>
              <FiabiliteTag f="indisponible" />
            </div>
          )}
        </section>

        {/* ─────────── RÉSEAU ETH ─────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              Réseau ETH
            </h3>
            {!etherscanHasKey && (
              <button
                type="button"
                onClick={openSettings}
                className="text-[10px] text-accent hover:underline"
                title="Clé gratuite sur etherscan.io/register — obligatoire"
              >
                clé Etherscan ⚙
              </button>
            )}
          </div>
          {etherscanHasKey ? (
            <div className="grid grid-cols-2 gap-2">
              <Widget
                libelle="Gas recommandé"
                valeur={fmtGwei(eth?.gasFast)}
                fiabilite="live"
                sousTexte={
                  eth ? `sûr ${fmtGwei(eth.gasSafe)} · standard ${fmtGwei(eth.gasPropose)}` : undefined
                }
                color="#fbbf24"
              />
              <Widget
                libelle="Supply ETH"
                valeur={fmtCompact(eth?.supplyEth ?? undefined)}
                fiabilite="live"
                color="#60a5fa"
              />
              <div className="col-span-2">
                <Widget
                  libelle="Nombre de nœuds"
                  valeur={eth?.nodeCount ? eth.nodeCount.toLocaleString("fr-FR") : "—"}
                  fiabilite="daily"
                  color="#34d399"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-3">
              <span className="text-[11px] leading-snug text-text-dim">
                Réseau ETH indisponible sans clé Etherscan.
              </span>
              <FiabiliteTag f="indisponible" />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
