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
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { onchainUiStore, getBgeometricsKey, bgeometricsKeyStore } from "../store/onchain";
import { getSoSoValueKey, soSoValueKeyStore } from "../store/sosovalue";
import { getEtherscanKey, etherscanKeyStore } from "../store/etherscan";
import { settingsUiStore } from "../store/settings-ui";
import {
  fetchCoinMetrics,
  type CoinMetricsResultat,
  type PointMetrique,
  type SerieMetrique,
} from "../data/onchain/coinmetrics";
import {
  fetchBgeometrics,
  fetchBgeometricMetrique,
  BG_METRIQUES,
  BG_ETF_FLOW,
  BG_CLE_ENV_PRESENTE,
  BG_LIMITE_HEURE,
  BG_LIMITE_JOUR,
  type BgResultat,
} from "../data/onchain/bgeometrics";
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
  formatDateCourte,
  formatDateComplete,
} from "../lib/format";
import { lireTokenCanvas, rgbaTokenCanvas, POLICE_CANVAS } from "../lib/canvasTokens";
import { metaSource, type MetaFiabilite } from "../lib/fiabilite";
import { zonePourMetrique } from "../lib/zonesOnchain";
import {
  Badge,
  BadgeFiabilite,
  BarrePeriodes,
  EnTeteFenetre,
  Fraicheur,
  InfobulleGraphe,
  NoteSource,
  SegmenteCompact,
  texteFraicheur,
  TitreSection,
  TuileStat,
  Vide,
} from "./ui";
import {
  domainePourPreset,
  indicesVisibles,
  pixelVersValeur,
  valeurVersPixel,
  type Domaine,
} from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";

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

// ─────────────────────────── Métadonnées de fiabilité ───────────────────────────

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

/** Derniers N points d'une série (valeurs), pour la sparkline. */
function sparkDe(serie: SerieMetrique | undefined, n = 60): number[] {
  if (serie === undefined) return [];
  return serie.points.slice(-n).map((p) => p.value);
}

/** Somme des valeurs des N derniers points (cumul de flux sur une fenêtre). */
function cumulDe(serie: SerieMetrique | undefined, n: number): number {
  if (serie === undefined) return 0;
  return serie.points.slice(-n).reduce((s, p) => s + p.value, 0);
}

/** Flux ETF en BTC natif, signé (ex. « +2 738 BTC »). Unité prouvée BTC (cf. bgeometrics.ts). */
function fmtFluxBtc(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${formatEntier(v)} BTC`;
}

// ─────────────────────────── Courbe pleine largeur ───────────────────────────

const COURBE_H = 96;

/**
 * Courbe d'évolution pleine largeur (canvas responsive), trait + aire remplie.
 * Contrairement à la sparkline (largeur codée en dur à 88 px), elle MESURE son
 * conteneur via ResizeObserver pour rester lisible quand le panneau est docké ou
 * redimensionné. Couleurs résolues au dessin (token `--up`) → correctes sur les
 * deux thèmes.
 */
function CourbeHashrate({ points }: { points: PointMetrique[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [largeur, setLargeur] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    setLargeur(wrap.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setLargeur(e.contentRect.width);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const bornes = useMemo<Domaine | null>(
    () =>
      points.length >= 2
        ? { min: points[0]!.time, max: points[points.length - 1]!.time }
        : null,
    [points],
  );
  const [presetId, setPresetId] = useState<string | null>("1a");
  // Déclaré avant useDomaineZoom : son setter est référencé par l'onGeste qui vide le
  // survol après un zoom/pan/double-clic (sinon le trait reste figé sur l'ancien point).
  const [survol, setSurvol] = useState<{ xPix: number; point: PointMetrique } | null>(null);
  const { refCanvas, domaine, setDomaine } = useDomaineZoom(bornes, () => {
    setPresetId(null);
    setSurvol(null);
  });

  useEffect(() => {
    const cvs = refCanvas.current;
    if (cvs === null || largeur <= 0 || domaine === null) return;
    const ctx = cvs.getContext("2d");
    if (ctx === null) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    cvs.width = largeur * dpr;
    cvs.height = COURBE_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, largeur, COURBE_H);

    const { debut, fin } = indicesVisibles(points, (p) => p.time, domaine);
    const visibles = points.slice(debut, fin + 1);
    if (visibles.length < 2) return;

    const PAD_B = 14; // marge basse pour les repères de dates
    const padTop = 6;
    const h = COURBE_H - padTop - 6 - PAD_B;
    const xDe = (t: number) => valeurVersPixel(domaine, t, largeur);

    const values = visibles.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const yDe = (v: number) => padTop + (h - ((v - min) / span) * h);

    // Aire sous la courbe (remplissage semi-transparent), même token que le trait.
    ctx.beginPath();
    visibles.forEach((p, i) => {
      const x = xDe(p.time);
      const y = yDe(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xDe(visibles[visibles.length - 1]!.time), COURBE_H - PAD_B);
    ctx.lineTo(xDe(visibles[0]!.time), COURBE_H - PAD_B);
    ctx.closePath();
    ctx.fillStyle = rgbaTokenCanvas("--up", 0.12, "#22c55e");
    ctx.fill();

    // Trait de la courbe.
    ctx.beginPath();
    visibles.forEach((p, i) => {
      const x = xDe(p.time);
      const y = yDe(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lireTokenCanvas("--up", "#22c55e");
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Repères de dates (début / milieu / fin du domaine).
    const cDim = lireTokenCanvas("--text-dim", "#9ca3af");
    ctx.fillStyle = cDim;
    ctx.font = POLICE_CANVAS;
    const yLabel = COURBE_H - 3;
    ctx.fillText(formatDateCourte(domaine.min), 2, yLabel);
    const milieu = formatDateCourte((domaine.min + domaine.max) / 2);
    ctx.fillText(milieu, largeur / 2 - ctx.measureText(milieu).width / 2, yLabel);
    const finTxt = formatDateCourte(domaine.max);
    ctx.fillText(finTxt, largeur - 2 - ctx.measureText(finTxt).width, yLabel);
  }, [points, largeur, domaine]);

  const surSurvol = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (domaine === null || points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = pixelVersValeur(domaine, e.clientX - rect.left, rect.width);
    let point = points[0]!;
    for (const p of points) if (Math.abs(p.time - t) < Math.abs(point.time - t)) point = p;
    setSurvol({ xPix: valeurVersPixel(domaine, point.time, rect.width), point });
  };

  return (
    <div ref={wrapRef} className="w-full">
      <BarrePeriodes
        actif={presetId}
        onChange={(p) => {
          setPresetId(p.id);
          setSurvol(null);
          if (bornes) setDomaine(domainePourPreset(bornes, p.jours));
        }}
      />
      <div className="relative">
        <canvas
          ref={refCanvas}
          style={{ width: "100%", height: COURBE_H }}
          onMouseMove={surSurvol}
          onMouseLeave={() => setSurvol(null)}
        />
        {survol && (
          <InfobulleGraphe
            xPix={survol.xPix}
            largeurGraphe={largeur}
            titre={formatDateComplete(survol.point.time)}
            lignes={[{ label: "Hashrate", valeur: fmtHashrate(survol.point.value) }]}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Carte pleine largeur du hashrate : en-tête (valeur courante + fiabilité + fraîcheur)
 * au-dessus de la courbe d'évolution 1 an, avec échelle min/max en EH/s et bornes
 * temporelles — de quoi juger l'AMPLEUR des variations, pas seulement la forme.
 */
function CarteHashrate({ hr }: { hr: ResultatFrais<SerieMetrique> | null }) {
  const serie = hr?.donnee;
  const points = serie?.points ?? [];
  const values = points.map((p) => p.value);
  const min = values.length > 0 ? Math.min(...values) : undefined;
  const max = values.length > 0 ? Math.max(...values) : undefined;
  return (
    <div className="col-span-2 flex flex-col gap-1 rounded-md border border-border bg-bg px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-text-dim">Évolution du hashrate (1 an)</span>
        <BadgeFiabilite meta={META_DAILY} />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular-nums text-base font-semibold" style={{ color: "var(--up)" }}>
          {fmtHashrate(serie?.dernier?.value)}
        </span>
        <span className="shrink-0 text-[10px] text-text-dim">
          {hr?.perime ? "cache périmé · " : ""}
          {serie?.dernier?.time === undefined ? "—" : formatDateComplete(serie.dernier.time)}
        </span>
      </div>
      {points.length >= 2 ? (
        <>
          <CourbeHashrate points={points} />
          <div className="text-center text-[9px] tabular-nums text-text-dim">
            min {fmtHashrate(min)} · max {fmtHashrate(max)}
          </div>
        </>
      ) : (
        <Vide>Hashrate indisponible</Vide>
      )}
    </div>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

interface EtatDonnees {
  cm: CoinMetricsResultat | null;
  bg: Record<string, BgResultat | null>;
  mp: ResultatFrais<MempoolReseau> | null;
  hr: ResultatFrais<SerieMetrique> | null;
  etf: Record<ActifEtf, EtfResultat | null>;
  /** Repli BTC bitcoin-data.com (flux ETF en BTC), chargé UNIQUEMENT si SoSoValue BTC échoue. */
  etfRepli: BgResultat | null;
  eth: ReseauEth | null;
  sol: ResultatFrais<ReseauSol> | null;
}

const VIDE: EtatDonnees = {
  cm: null,
  bg: {},
  mp: null,
  hr: null,
  etf: { btc: null, eth: null, sol: null },
  etfRepli: null,
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
  // Horodatage du dernier cycle de fetch complet — alimente le <Fraicheur> du slot actions
  // (convention CorrWindow/DerivativesWindow).
  const [majTs, setMajTs] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setDonnees(VIDE);
      setLoading(false);
      setMajTs(null);
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
      // Repli ETF BTC : bitcoin-data.com fetché SEULEMENT si SoSoValue BTC a échoué (absence
      // de clé / 401 / réseau) — jamais de double coût quand SoSoValue répond.
      const etfRepli = btcEtf.disponible
        ? null
        : await fetchBgeometricMetrique(BG_ETF_FLOW, getBgeometricsKey(), ctrl.signal);
      if (ignore) return; // 2e garde : le repli a pu s'attendre après une fermeture/annulation.
      setDonnees((d) => ({
        cm,
        bg,
        mp,
        hr,
        etf: { btc: btcEtf, eth: ethEtf, sol: solEtf },
        etfRepli,
        eth,
        sol: d.sol,
      }));
      setMajTs(Date.now());
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
  const cmDaily = texteFraicheur(loading, adr?.dernier?.time ?? tx?.dernier?.time ?? null, Date.now(), "quotidien");

  const mp = donnees.mp?.donnee;
  const halving = mp?.halving;
  const etf = donnees.etf[actifEtf];
  const etfPrincipal = Boolean(etf && etf.disponible && etf.parEmetteur);
  const etfRepliDispo = actifEtf === "btc" && Boolean(donnees.etfRepli?.serie.dernier);
  // Ni le rendu principal (SoSoValue) ni le repli (bitcoin-data.com) — le badge
  // indisponible passe alors à côté du titre de section, pas dans le corps.
  const etfIndisponible = !etfPrincipal && !etfRepliDispo;
  // Quota BGeometrics EFFECTIF pour le texte du panneau (bloc affiché sans clé perso) :
  // la seule présence d'une clé de repli .env fait basculer le quota IP 15/jour → 10/heure.
  const bgQuotaTexte = BG_CLE_ENV_PRESENTE
    ? `${BG_LIMITE_HEURE} req/heure`
    : `${BG_LIMITE_JOUR} req/jour`;
  const eth = donnees.eth;
  // Mode dégradé sans clé Etherscan (1 req/5 s) : gas présent mais supply/nœuds null —
  // le CTA « clé Etherscan ⚙ » doit rester proposé tant qu'un champ manque.
  const ethIncomplet =
    eth !== null && (eth.supplyEth === null || eth.nodeCount === null || eth.gasSafe === null);
  const ethIndisponible = eth === null && !loading;
  const sol = donnees.sol?.donnee;
  const solFraicheur = texteFraicheur(loading, donnees.sol?.ts ?? null, Date.now());
  const solPerime = donnees.sol?.perime;

  return (
    <>
      <EnTeteFenetre
        mnemo="CHAIN"
        titre="On-chain"
        sousTitre="Coin Metrics · BGeometrics · mempool.space · SoSoValue · Etherscan · RPC Solana · CoinGecko"
        actions={<Fraicheur loading={loading} majTs={majTs} />}
      />
      {/* Croix de fermeture retirée — fournie par le chrome FloatingWindow */}

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* ─────────── RÉSEAU BTC ─────────── */}
        <section>
          <TitreSection>Réseau BTC</TitreSection>
          <div className="grid grid-cols-2 gap-2">
            <CarteHashrate hr={donnees.hr} />
            <TuileStat
              label="Adresses actives"
              valeur={formatCompact(adr?.dernier?.value)}
              couleur="var(--serie-1)"
              badge={<BadgeFiabilite meta={META_COINMETRICS} />}
              extra={sparkDe(adr).length >= 2 ? <Sparkline values={sparkDe(adr)} color="--serie-1" /> : undefined}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {cm?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {cmDaily}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Transactions / j"
              valeur={formatCompact(tx?.dernier?.value)}
              couleur="var(--serie-2)"
              badge={<BadgeFiabilite meta={META_COINMETRICS} />}
              extra={sparkDe(tx).length >= 2 ? <Sparkline values={sparkDe(tx)} color="--serie-2" /> : undefined}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {cm?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {cmDaily}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Frais totaux (BTC)"
              valeur={formatDec(feeNtv?.dernier?.value, 2)}
              couleur="var(--serie-3)"
              badge={<BadgeFiabilite meta={META_COINMETRICS} />}
              extra={sparkDe(feeNtv).length >= 2 ? <Sparkline values={sparkDe(feeNtv)} color="--serie-3" /> : undefined}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {cm?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {cmDaily}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Frais recommandés"
              valeur={mp ? `${formatDec(mp.fees.fastestFee, 0)} sat/vB` : "—"}
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate">
                    {mp ? `1h ${formatDec(mp.fees.hourFee, 0)} · éco ${formatDec(mp.fees.economyFee, 0)}` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {donnees.mp?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {texteFraicheur(loading, donnees.mp?.ts ?? null, Date.now())}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Hauteur de bloc"
              valeur={formatEntier(mp?.hauteur)}
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {donnees.mp?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {texteFraicheur(loading, donnees.mp?.ts ?? null, Date.now())}
                  </span>
                </>
              }
            />
            <div className="col-span-2">
              <TuileStat
                label={halving ? `Halving (bloc ${formatEntier(halving.prochainBloc)})` : "Halving"}
                valeur={fmtJours(halving?.msEstimes)}
                badge={<BadgeFiabilite meta={META_ESTIMATION} />}
                pied={
                  halving ? (
                    <>
                      <span className="truncate">
                        reste {formatEntier(halving.blocsRestants)} blocs → {halving.recompenseApres} BTC
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {formatDateComplete(Date.now() + halving.msEstimes)}
                      </span>
                    </>
                  ) : undefined
                }
              />
            </div>
          </div>
        </section>

        {/* ─────────── VALORISATION ─────────── */}
        <section>
          <TitreSection
            extra={
              !bgHasKey && (
                <button
                  type="button"
                  onClick={openSettings}
                  className="text-[10px] text-accent hover:underline"
                  title={`Clé gratuite sur bitcoin-data.com — quota actuel ${bgQuotaTexte}, cache 24 h`}
                >
                  clé BGeometrics ⚙
                </button>
              )
            }
          >
            Valorisation
          </TitreSection>
          <div className="grid grid-cols-2 gap-2">
            {BG_METRIQUES.map((def) => {
              const r = donnees.bg[def.id] ?? null;
              const zone = zonePourMetrique(def.id, r?.serie.dernier?.value);
              return (
                <TuileStat
                  key={def.id}
                  label={def.libelle}
                  valeur={formatDec(r?.serie.dernier?.value, def.id === "mvrv" ? 2 : 4)}
                  couleur="var(--serie-4)"
                  badge={
                    <>
                      {zone !== null ? <Badge ton={zone.ton}>{zone.libelle}</Badge> : null}
                      <BadgeFiabilite meta={def.id === "mvrv" ? metaSource("bgeometrics:mvrv") : META_BGEOMETRICS} />
                    </>
                  }
                  extra={
                    sparkDe(r?.serie).length >= 2 ? <Sparkline values={sparkDe(r?.serie)} color="--serie-4" /> : undefined
                  }
                  pied={
                    <>
                      <span className="truncate" />
                      <span className="flex shrink-0 items-center gap-1">
                        {r?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                        {texteFraicheur(loading, r?.serie.dernier?.time ?? null, Date.now(), "quotidien")}
                      </span>
                    </>
                  }
                />
              );
            })}
            <TuileStat
              label="MVRV (ratio)"
              valeur={formatDec(mvrvRatio?.dernier?.value, 2)}
              couleur="var(--serie-4)"
              badge={<BadgeFiabilite meta={META_COINMETRICS} />}
              extra={sparkDe(mvrvRatio).length >= 2 ? <Sparkline values={sparkDe(mvrvRatio)} color="--serie-4" /> : undefined}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {cm?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {cmDaily}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Cap. marché BTC"
              valeur={formatUsd(mcap?.dernier?.value)}
              couleur="var(--serie-6)"
              badge={<BadgeFiabilite meta={META_COINMETRICS} />}
              extra={sparkDe(mcap).length >= 2 ? <Sparkline values={sparkDe(mcap)} color="--serie-6" /> : undefined}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {cm?.perime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {cmDaily}
                  </span>
                </>
              }
            />
          </div>
          {!bgHasKey && (
            <p className="mt-2 text-[10px] leading-snug text-text-dim">
              MVRV Z-Score / SOPR / NUPL affichés sans clé (quota {bgQuotaTexte}, cache 24 h).
              Une clé gratuite sur bitcoin-data.com relève le quota.
            </p>
          )}
          <NoteSource>
            Zones : MVRV-Z &lt; 0 froid · ≥ 3 chaud · ≥ 7 surchauffe ; SOPR &lt; 1 capitulation ;
            NUPL ≥ 0.5 croyance · ≥ 0.75 euphorie. Seuils canoniques, source bitcoin-data.com.
          </NoteSource>
        </section>

        {/* ─────────── ETF ─────────── */}
        <section>
          <TitreSection
            extra={
              <>
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
                {etfIndisponible && <BadgeFiabilite meta={META_INDISPONIBLE} />}
              </>
            }
          >
            Flux ETF spot
          </TitreSection>
          <div className="mb-2">
            <SegmenteCompact
              options={ACTIFS_ETF.map((a) => ({ id: a, label: a.toUpperCase() }))}
              actif={actifEtf}
              onChange={setActifEtf}
              ariaLabel="Actif ETF"
            />
          </div>
          {etfPrincipal && etf && etf.parEmetteur ? (
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
          ) : etfRepliDispo && donnees.etfRepli?.serie.dernier ? (
            // Repli bitcoin-data.com (SoSoValue indisponible pour BTC). Flux en BTC natif
            // (unité prouvée) — teinté +/- selon le sens, sparkline 90 j, cumul 30 j.
            // NB : 30 j / 90 j = dernières SÉANCES de bourse (les week-ends sont absents
            // de la source), pas des jours calendaires.
            (() => {
              const serie = donnees.etfRepli.serie;
              const jour = serie.dernier!.value;
              const cumul30 = cumulDe(serie, 30);
              return (
                <div className="space-y-1.5 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-text-dim">Flux ETF BTC (jour)</span>
                    <span
                      className={`tabular-nums text-base font-semibold ${jour >= 0 ? "text-up" : "text-down"}`}
                    >
                      {fmtFluxBtc(jour)}
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <Sparkline values={sparkDe(serie, 90)} color={jour >= 0 ? "--up" : "--down"} />
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1 text-[11px] font-medium">
                    <span className="text-text">Cumul 30 j</span>
                    <span className={`tabular-nums ${cumul30 >= 0 ? "text-up" : "text-down"}`}>
                      {fmtFluxBtc(cumul30)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <NoteSource>bitcoin-data.com (repli)</NoteSource>
                    <span className="shrink-0 text-[10px] text-text-dim">
                      {donnees.etfRepli.perime ? "cache périmé · " : ""}
                      {formatDateComplete(serie.dernier!.time)}
                    </span>
                  </div>
                </div>
              );
            })()
          ) : (
            <Vide>{etf?.raison ?? "Flux ETF indisponibles."}</Vide>
          )}
        </section>

        {/* ─────────── RÉSEAU ETH ─────────── */}
        <section>
          <TitreSection
            extra={
              <>
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
                {ethIndisponible && <BadgeFiabilite meta={META_INDISPONIBLE} />}
              </>
            }
          >
            Réseau ETH
          </TitreSection>
          {eth !== null || loading ? (
            <div className="grid grid-cols-2 gap-2">
              <TuileStat
                label="Gas recommandé"
                valeur={fmtGwei(eth?.gasFast)}
                couleur="var(--serie-3)"
                badge={<BadgeFiabilite meta={META_LIVE} />}
                pied={
                  eth ? (
                    <>
                      <span className="truncate">
                        sûr {fmtGwei(eth.gasSafe)} · standard {fmtGwei(eth.gasPropose)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1" />
                    </>
                  ) : undefined
                }
              />
              <TuileStat
                label="Supply ETH"
                valeur={formatCompact(eth?.supplyEth ?? undefined)}
                couleur="var(--serie-6)"
                badge={<BadgeFiabilite meta={META_LIVE} />}
              />
              <div className="col-span-2">
                <TuileStat
                  label="Nombre de nœuds"
                  valeur={formatEntier(eth?.nodeCount)}
                  couleur="var(--up)"
                  badge={<BadgeFiabilite meta={META_DAILY} />}
                />
              </div>
            </div>
          ) : (
            <Vide>
              Réseau ETH indisponible — Etherscan injoignable ou clé invalide
              (Réglages ⚙ ou ETHERSCAN_API_KEY dans .env).
            </Vide>
          )}
        </section>

        {/* ─────────── RÉSEAU SOL ─────────── */}
        <section>
          <TitreSection>Réseau SOL</TitreSection>
          <div className="grid grid-cols-2 gap-2">
            <TuileStat
              label="TPS (hors votes)"
              valeur={formatEntier(sol?.tpsHorsVotes)}
              couleur="var(--serie-3)"
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate">
                    {sol?.tps != null ? `total ${formatEntier(sol.tps)} tps (votes inclus)` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {solPerime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {solFraicheur}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Époque"
              valeur={formatEntier(sol?.epoque)}
              couleur="var(--serie-2)"
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate">
                    {sol?.progressionEpoque != null ? `avancée ${fmtPct(sol.progressionEpoque, 1)}` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {solPerime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {solFraicheur}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Supply circulante"
              valeur={formatCompact(sol?.supplySol ?? undefined)}
              couleur="var(--serie-6)"
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {solPerime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {solFraicheur}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Inflation annuelle"
              valeur={fmtPct(sol?.inflation)}
              couleur="var(--serie-4)"
              badge={<BadgeFiabilite meta={META_DAILY} />}
              pied={
                <>
                  <span className="truncate" />
                  <span className="flex shrink-0 items-center gap-1">
                    {solPerime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {solFraicheur}
                  </span>
                </>
              }
            />
            <TuileStat
              label="Validateurs actifs"
              valeur={formatEntier(sol?.validateursActifs)}
              couleur="var(--up)"
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate">
                    {sol?.validateursDelinquants != null ? `${sol.validateursDelinquants} délinquants` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {solPerime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {solFraicheur}
                  </span>
                </>
              }
            />
            <TuileStat
              label="SOL staké"
              valeur={formatCompact(sol?.stakeSol ?? undefined)}
              couleur="var(--serie-1)"
              badge={<BadgeFiabilite meta={META_LIVE} />}
              pied={
                <>
                  <span className="truncate">
                    {sol?.stakeSol != null && sol.supplySol != null && sol.supplySol > 0
                      ? `≈ ${fmtPct(sol.stakeSol / sol.supplySol, 1)} du circulant`
                      : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {solPerime ? <Badge ton="warn">cache périmé</Badge> : null}
                    {solFraicheur}
                  </span>
                </>
              }
            />
          </div>
        </section>
      </div>
    </>
  );
}
