/**
 * Fenêtre « CHAIN » — panneau ON-CHAIN, dockable à droite, NON MODAL (pattern DerivativesWindow).
 *
 * Grille de widgets compacts (valeur + sparkline canvas + libellé + fraîcheur + étiquette
 * de fiabilité) en cinq sections : RÉSEAU BTC, VALORISATION, ETF, RÉSEAU ETH, RÉSEAU SOL.
 * Données LENTES (daily pour l'essentiel) → récupérées à l'ouverture, mises en cache
 * (6 h / 24 h), et redégradées proprement (cache périmé étiqueté, jamais d'erreur console
 * en boucle).
 *
 * Sources : Coin Metrics community (sans clé), BGeometrics/bitcoin-data.com (clé optionnelle),
 * mempool.space (direct), SoSoValue via proxy /sosoapi (ETF spot BTC/ETH/SOL — clé Réglages
 * prioritaire, sinon repli SOSOVALUE_API_KEY du .env), Etherscan v2 via proxy /ethscanapi
 * (réseau ETH — même régime, repli ETHERSCAN_API_KEY ; répond même sans clé en mode
 * dégradé 1 req/5 s), réseau SOL SANS clé (RPC PublicNode + supply CoinGecko —
 * cf. data/onchain/solana.ts).
 *
 * Règle d'or (doc 02) : chaque widget porte un BadgeFiabilite honnête via
 * `metaSource` / métas partagées (fiable · partiel · estimation · indisponible).
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
import {
  fetchEtfFlows,
  rapporterSanteEtf,
  RAISON_CLE_SOSOVALUE,
  type ActifEtf,
  type EtfResultat,
} from "../data/onchain/etf";
import { fetchReseauEth, type ReseauEth } from "../data/onchain/etherscan";
import { fetchReseauSol, type ReseauSol } from "../data/onchain/solana";
import {
  formatCompact,
  formatUsd,
  formatDec,
  formatEntier,
  formatPourcentage,
  formatDateComplete,
  formatAge,
} from "../lib/format";
import { lireTokenCanvas } from "../lib/canvasTokens";
import { metaSource, type MetaFiabilite } from "../lib/fiabilite";
import { BadgeFiabilite, EnTeteFenetre } from "./ui";

const ACTIFS_ETF: readonly ActifEtf[] = ["btc", "eth", "sol"];

// ─────────────────────────── Formatage ───────────────────────────
// Le formatage générique (compact, USD, décimales, entiers, pourcentage, date)
// est délégué au module partagé src/lib/format. Ne restent LOCAUX que les
// unités métier (hashrate EH/s, gas Gwei) et de fins adaptateurs (fraction → %,
// ms optionnel, « maintenant » courant) qui s'appuient sur ces fonctions.

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

/** Taux 0..1 → pourcentage « niveau » (ex. 0.0375 → « 3.75 % »), format partagé. */
function fmtPct(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return formatPourcentage(x * 100, d);
}

/** Date courte d'un ms epoch, avec année (ex. « 30 juin 2026 »). */
function fmtJour(ms: number | undefined): string {
  return ms === undefined ? "—" : formatDateComplete(ms);
}

/** Âge relatif compact d'un ms epoch (« maintenant » courant, format partagé). */
function fmtAge(ms: number | undefined): string {
  return ms === undefined ? "—" : formatAge(ms, Date.now());
}

/** Durée en jours (compte à rebours halving). */
function fmtJours(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  return `≈ ${formatEntier(ms / 86_400_000)} j`;
}

// ─────────────────────────── Sparkline canvas ───────────────────────────

const SPARK_W = 88;
const SPARK_H = 26;

/** Mini-courbe canvas (dessinée hors React à chaque changement de données).
 *  `color` = nom de token CSS (ex. « --serie-1 »), résolu au moment du dessin. */
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
    // Résolution du token CSS (nom transmis par le widget) au moment du dessin :
    // un changement de thème repeint la courbe avec la bonne couleur au prochain rendu.
    ctx.strokeStyle = lireTokenCanvas(color, "#9ca3af");
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

/**
 * Métas réutilisées (lookup catalogue unique — dédup vs. tags locaux « daily/live »).
 * Sources hors catalogue : `niveau` + `label` libres passés à `BadgeFiabilite`.
 */
const META_COINMETRICS = metaSource("coinmetrics");
const META_BGEOMETRICS = metaSource("bgeometrics");
/** Flux live hors catalogue (mempool, Etherscan gas, RPC Solana…). */
const META_LIVE: MetaFiabilite = {
  niveau: "fiable",
  label: "direct",
  detail: "Flux live ou quasi-temps réel (API publique / RPC).",
};
/** Daily / cache long hors catalogue (hashrate mempool, nœuds ETH, inflation SOL…). */
const META_DAILY: MetaFiabilite = {
  niveau: "partiel",
  label: "quotidien",
  detail: "Mise à jour quotidienne ou cache long — pas un tick live.",
};
/** Estimation structurelle (ex. compte à rebours halving). */
const META_ESTIMATION: MetaFiabilite = {
  niveau: "estimation",
  label: "estimation",
  detail: "Valeur modélisée ou extrapolée — pas une mesure brute.",
};
const META_INDISPONIBLE: MetaFiabilite = {
  niveau: "indisponible",
  label: "indisponible",
  detail: "Source non câblée, en échec, ou clé manquante.",
};

/** Un widget compact : libellé + badge fiabilité, valeur + sparkline, sous-texte + fraîcheur. */
function Widget({
  libelle,
  valeur,
  meta,
  spark,
  color,
  sousTexte,
  fraicheur,
  perime,
}: {
  libelle: string;
  valeur: string;
  /** Métadonnées catalogue (`metaSource`) ou constantes locales ci-dessus. */
  meta: MetaFiabilite;
  spark?: number[];
  color?: string; // nom de token CSS (« --serie-1 »…) appliqué à la valeur et à la sparkline
  sousTexte?: string;
  fraicheur?: string;
  perime?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-text-dim">{libelle}</span>
        <BadgeFiabilite meta={meta} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span
          className="tabular-nums text-base font-semibold text-text"
          style={color ? { color: `var(${color})` } : undefined}
        >
          {valeur}
        </span>
        {spark && spark.length >= 2 && <Sparkline values={spark} color={color ?? "--text-dim"} />}
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
  sol: ResultatFrais<ReseauSol> | null;
}

const VIDE: EtatDonnees = {
  cm: null,
  bg: {},
  mp: null,
  hr: null,
  etf: { btc: null, eth: null, sol: null },
  eth: null,
  sol: null,
};

export function OnchainWindow() {
  const open = useStore(onchainUiStore, (s) => s.open);
  const bgHasKey = useStore(bgeometricsKeyStore, (s) => s.hasKey);
  const soSoHasKey = useStore(soSoValueKeyStore, (s) => s.hasKey);
  const etherscanHasKey = useStore(etherscanKeyStore, (s) => s.hasKey);
  // `version` (et non `hasKey`) en dépendance d'effet : remplacer une clé existante
  // laisse hasKey à true→true et ne déclencherait aucun re-fetch.
  const soSoVersion = useStore(soSoValueKeyStore, (s) => s.version);
  const etherscanVersion = useStore(etherscanKeyStore, (s) => s.version);
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
      // Le réseau SOL dépend d'un RPC public sans clé, à latence imprévisible : il
      // alimente sa section seul, HORS de la barrière Promise.all, pour que ses aléas
      // ne retardent jamais les autres sections.
      void fetchReseauSol(ctrl.signal).then((sol) => {
        if (!ignore) setDonnees((d) => ({ ...d, sol }));
      });
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
      // Santé « sosovalue » agrégée sur le cycle complet (3 actifs) — une seule
      // écriture, hors cycles annulés, pour un état déterministe dans le panneau Santé.
      rapporterSanteEtf([btcEtf, ethEtf, solEtf]);
      setDonnees((d) => ({ cm, bg, mp, hr, etf: { btc: btcEtf, eth: ethEtf, sol: solEtf }, eth, sol: d.sol }));
      setLoading(false);
    };

    void charger();
    return () => {
      ignore = true;
      ctrl.abort();
    };
    // Versions de clé en dépendance : re-fetch quand une clé est saisie, REMPLACÉE ou
    // retirée (hasKey seul raterait le remplacement d'une clé existante).
  }, [open, bgHasKey, soSoVersion, etherscanVersion]);

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
  // Mode dégradé sans clé Etherscan (1 req/5 s) : gas présent mais supply/nœuds null —
  // le CTA « clé Etherscan ⚙ » doit rester proposé tant qu'un champ manque.
  const ethIncomplet =
    eth !== null && (eth.supplyEth === null || eth.nodeCount === null || eth.gasSafe === null);
  const sol = donnees.sol?.donnee;
  const solFraicheur = fmtAge(donnees.sol?.ts);
  const solPerime = donnees.sol?.perime;

  return (
    <>
      <EnTeteFenetre
        mnemo="CHAIN"
        titre="On-chain"
        sousTitre={
          <>
            Coin Metrics · BGeometrics · mempool.space · SoSoValue · Etherscan · RPC Solana ·
            CoinGecko {loading ? "· maj…" : ""}
          </>
        }
      />
      {/* Croix de fermeture retirée — fournie par le chrome FloatingWindow */}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* ─────────── RÉSEAU BTC ─────────── */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Réseau BTC
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Widget
              libelle="Adresses actives"
              valeur={formatCompact(adr?.dernier?.value)}
              meta={META_COINMETRICS}
              spark={sparkDe(adr)}
              color="--serie-1"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Transactions / j"
              valeur={formatCompact(tx?.dernier?.value)}
              meta={META_COINMETRICS}
              spark={sparkDe(tx)}
              color="--serie-2"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Frais totaux (BTC)"
              valeur={formatDec(feeNtv?.dernier?.value, 2)}
              meta={META_COINMETRICS}
              spark={sparkDe(feeNtv)}
              color="--serie-3"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Hashrate (1 an)"
              valeur={fmtHashrate(hr?.dernier?.value)}
              meta={META_DAILY}
              spark={sparkDe(hr, 90)}
              color="--up"
              fraicheur={fmtJour(hr?.dernier?.time)}
              perime={donnees.hr?.perime}
            />
            <Widget
              libelle="Frais recommandés"
              valeur={mp ? `${formatDec(mp.fees.fastestFee, 0)} sat/vB` : "—"}
              meta={META_LIVE}
              sousTexte={mp ? `1h ${formatDec(mp.fees.hourFee, 0)} · éco ${formatDec(mp.fees.economyFee, 0)}` : undefined}
              fraicheur={fmtAge(donnees.mp?.ts)}
              perime={donnees.mp?.perime}
            />
            <Widget
              libelle="Hauteur de bloc"
              valeur={formatEntier(mp?.hauteur)}
              meta={META_LIVE}
              fraicheur={fmtAge(donnees.mp?.ts)}
              perime={donnees.mp?.perime}
            />
            <div className="col-span-2">
              <Widget
                libelle={halving ? `Halving (bloc ${formatEntier(halving.prochainBloc)})` : "Halving"}
                valeur={fmtJours(halving?.msEstimes)}
                meta={META_ESTIMATION}
                sousTexte={
                  halving
                    ? `reste ${formatEntier(halving.blocsRestants)} blocs → ${halving.recompenseApres} BTC`
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
                  valeur={formatDec(r?.serie.dernier?.value, def.id === "mvrv" ? 2 : 4)}
                  meta={def.id === "mvrv" ? metaSource("bgeometrics:mvrv") : META_BGEOMETRICS}
                  spark={sparkDe(r?.serie)}
                  color="--serie-4"
                  fraicheur={fmtJour(r?.serie.dernier?.time)}
                  perime={r?.perime}
                />
              );
            })}
            <Widget
              libelle="MVRV (ratio)"
              valeur={formatDec(mvrvRatio?.dernier?.value, 2)}
              meta={META_COINMETRICS}
              spark={sparkDe(mvrvRatio)}
              color="--serie-4"
              fraicheur={cmDaily}
              perime={cm?.perime}
            />
            <Widget
              libelle="Cap. marché BTC"
              valeur={formatUsd(mcap?.dernier?.value)}
              meta={META_COINMETRICS}
              spark={sparkDe(mcap)}
              color="--serie-6"
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
            {/* Proposé seulement sur un échec effectivement lié à la clé (401/403) —
                pas sur un 5xx/réseau où une clé ne changerait rien. */}
            {!soSoHasKey && etf !== null && etf.raison === RAISON_CLE_SOSOVALUE && (
              <button
                type="button"
                onClick={openSettings}
                className="text-[10px] text-accent hover:underline"
                title="Clé gratuite sur sosovalue.com/developer (plan Demo) — ou SOSOVALUE_API_KEY dans .env"
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
                  actifEtf === a ? "bg-bg text-text" : "text-text-dim hover:text-text"
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
                  <span className={`tabular-nums ${e.flux >= 0 ? "text-up" : "text-down"}`}>
                    {formatUsd(e.flux)}
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-[11px] font-medium">
                <span className="text-text">Cumul {etf.jour ?? ""}</span>
                <span className="tabular-nums text-text">{formatUsd(etf.total)}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-3">
              <span className="text-[11px] leading-snug text-text-dim">
                {etf?.raison ?? "Flux ETF indisponibles."}
              </span>
              <BadgeFiabilite meta={META_INDISPONIBLE} />
            </div>
          )}
        </section>

        {/* ─────────── RÉSEAU ETH ─────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
              Réseau ETH
            </h3>
            {/* Proposé dès que les données sont absentes OU incomplètes (mode dégradé
                sans clé : gas seul) et qu'aucune clé Réglages n'est saisie. */}
            {!etherscanHasKey && !loading && (eth === null || ethIncomplet) && (
              <button
                type="button"
                onClick={openSettings}
                className="text-[10px] text-accent hover:underline"
                title="Clé gratuite sur etherscan.io/register — ou ETHERSCAN_API_KEY dans .env"
              >
                clé Etherscan ⚙
              </button>
            )}
          </div>
          {eth !== null || loading ? (
            <div className="grid grid-cols-2 gap-2">
              <Widget
                libelle="Gas recommandé"
                valeur={fmtGwei(eth?.gasFast)}
                meta={META_LIVE}
                sousTexte={
                  eth ? `sûr ${fmtGwei(eth.gasSafe)} · standard ${fmtGwei(eth.gasPropose)}` : undefined
                }
                color="--serie-3"
              />
              <Widget
                libelle="Supply ETH"
                valeur={formatCompact(eth?.supplyEth ?? undefined)}
                meta={META_LIVE}
                color="--serie-6"
              />
              <div className="col-span-2">
                <Widget
                  libelle="Nombre de nœuds"
                  valeur={formatEntier(eth?.nodeCount)}
                  meta={META_DAILY}
                  color="--up"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-3">
              <span className="text-[11px] leading-snug text-text-dim">
                Réseau ETH indisponible — Etherscan injoignable ou clé invalide
                (Réglages ⚙ ou ETHERSCAN_API_KEY dans .env).
              </span>
              <BadgeFiabilite meta={META_INDISPONIBLE} />
            </div>
          )}
        </section>

        {/* ─────────── RÉSEAU SOL ─────────── */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Réseau SOL
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Widget
              libelle="TPS (hors votes)"
              valeur={formatEntier(sol?.tpsHorsVotes)}
              meta={META_LIVE}
              sousTexte={
                sol?.tps != null ? `total ${formatEntier(sol.tps)} tps (votes inclus)` : undefined
              }
              color="--serie-3"
              fraicheur={solFraicheur}
              perime={solPerime}
            />
            <Widget
              libelle="Époque"
              valeur={formatEntier(sol?.epoque)}
              meta={META_LIVE}
              sousTexte={sol?.progressionEpoque != null ? `avancée ${fmtPct(sol.progressionEpoque, 1)}` : undefined}
              color="--serie-2"
              fraicheur={solFraicheur}
              perime={solPerime}
            />
            <Widget
              libelle="Supply circulante"
              valeur={formatCompact(sol?.supplySol ?? undefined)}
              meta={META_LIVE}
              color="--serie-6"
              fraicheur={solFraicheur}
              perime={solPerime}
            />
            <Widget
              libelle="Inflation annuelle"
              valeur={fmtPct(sol?.inflation)}
              meta={META_DAILY}
              color="--serie-4"
              fraicheur={solFraicheur}
              perime={solPerime}
            />
            <Widget
              libelle="Validateurs actifs"
              valeur={formatEntier(sol?.validateursActifs)}
              meta={META_LIVE}
              sousTexte={
                sol?.validateursDelinquants != null ? `${sol.validateursDelinquants} délinquants` : undefined
              }
              color="--up"
              fraicheur={solFraicheur}
              perime={solPerime}
            />
            <Widget
              libelle="SOL staké"
              valeur={formatCompact(sol?.stakeSol ?? undefined)}
              meta={META_LIVE}
              sousTexte={
                sol?.stakeSol != null && sol.supplySol != null && sol.supplySol > 0
                  ? `≈ ${fmtPct(sol.stakeSol / sol.supplySol, 1)} du circulant`
                  : undefined
              }
              color="--serie-1"
              fraicheur={solFraicheur}
              perime={solPerime}
            />
          </div>
        </section>
      </div>
    </>
  );
}
