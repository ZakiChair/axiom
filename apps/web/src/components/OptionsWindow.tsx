/**
 * Fenêtre « Options » (mnémonique OMON) — dockable à droite, NON MODALE. Source Deribit.
 *
 * Par échéance sélectionnée : SMILE de volatilité implicite (IV mark par strike, calls et
 * puts), MAX PAIN calculé côté client (fonction pure), PUT/CALL ratio sur l'open interest,
 * SKEW 25Δ (risk reversal — fonction pure, data/skew.ts) et DVOL (indice de volatilité
 * implicite) si disponible. Sélecteurs devise (BTC/ETH) + échéance.
 *
 * Instantanés quotidiens (chantier du 7 novembre 2026) : au premier chargement réussi après
 * 08:05 UTC, un instantané par devise et par jour UTC de la surface à maturité constante (vue
 * Term IV, data/surfaceConstante) et de l'OI par strike (métrique ΔOI de la heatmap,
 * data/deltaOiStrikes) — localStorage, doublé dans le KV du daemon s'il est présent.
 *
 * Données LENTES (~1 min) : elles vivent dans le state React ; le smile est redessiné
 * impérativement au canvas. Le polling ne tourne QUE fenêtre ouverte. Dégradation gracieuse :
 * chaîne d'options et DVOL récupérés indépendamment (Promise.allSettled), pas d'erreur en boucle.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import {
  computeMaxPain,
  putCallRatioOi,
  type OptionPoint,
  type StrikeOi,
} from "../data/deribit";
import {
  aggregateGexDex,
  comparerHypothesesGamma,
  comparerHypothesesGammaCrypto,
  gexParStrikeToutesEcheances,
  gammaFlip,
  mursGamma,
  profilGexSpot,
  verdictGamma,
  EQUITY_CONTRACT_MULTIPLIER,
  type GexDexPoint,
  type ScenarioGamma,
} from "../data/gexDex";
import { construireSourcesCrypto, construireCarteExpositions, profilExpositionsCrypto } from "../data/carteExpositions";
import { calculerSkew25d } from "../data/skew";
import { termStructureIv, type PointTermIv } from "../data/termIv";
import { mouvementsAttendus, type PointMouvementAttendu } from "../data/mouvementAttendu";
import { finCouvertureCalendrier, libelleCourtEvenement, volsForward, type SegmentVolForward } from "../data/volForward";
import { courbeProbaImplicite, lireProbasNiveau, niveauParDefaut, prixCourant } from "../data/probaImplicite";
import { spotDeChaine } from "../data/chaineOptionsCache";
import { resumerMarcheOptions } from "../data/marcheOptions";
import { useOptionsDeribit } from "../hooks/useOptionsDeribit";
import { ivRank } from "../data/ivRank";
import { bandeStrikes, construireGrilleOi, type GrilleOi } from "../data/oiHeatmap";
import {
  ARCHIVE_VIDE,
  capturerSurfaceDuJour,
  couvertureArchive,
  jourUtc,
  lireArchiveSurface,
  lireSurfaceHistorique,
  surfaceMaturiteConstante,
  type LectureArchive,
} from "../data/surfaceConstante";
import {
  calculerDeltaOi,
  capturerInstantaneOi,
  lireReferencesOi,
  topStrikesDeltaOi,
  type ReferencesOi,
} from "../data/deltaOiStrikes";
import {
  CBOE_TICKERS,
  SOUS_JACENT_ETF,
  cboeExpiries,
  cboeOptionsToLegs,
  echeanceCboeRetenue,
  estEtfCrypto,
  fetchCboeChain,
  prixCryptoAuDernierEchange,
  type CboeChain,
  type CboeTicker,
} from "../data/cboe";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { ecoStore } from "../store/eco";
import { valeurVersPixel, pixelVersValeur, type Domaine } from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";
import { EnTeteFenetre, Segmente, Select } from "./ui";
import {
  dessinerSmile,
  dessinerHeatmapOi,
  dessinerTermIv,
  joursAvant,
  SMILE_PAD_L,
  SMILE_PAD_R,
  HEATMAP_PAD_L,
  HEATMAP_PAD_R,
  HEATMAP_PAD_T,
  HEATMAP_PAD_B,
  TERMIV_PAD_L,
  TERMIV_PAD_R,
  type SurvolHeatmap,
} from "./omon/dessins";
// Sous-vues présentationnelles (JSX extrait, découpe v1.9) — toute la logique reste ici.
import { VueSmile, type SurvolSmile } from "./omon/VueSmile";
import { VueGexDex, type LectureEtf } from "./omon/VueGexDex";
import { VueHeatmap, type MetriqueHeatmap } from "./omon/VueHeatmap";
import { VueTermIv, type DonneesSurfaceConstante } from "./omon/VueTermIv";
import type { ChoixReferenceOi } from "./omon/DeltaOi";
import { ResumeMarcheOptions } from "./omon/ResumeMarcheOptions";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface OptionsUiState {
  open: boolean;
  openOptions: () => void;
  closeOptions: () => void;
  toggleOptions: () => void;
}

export const optionsUiStore = createStore<OptionsUiState>(() => ({
  open: false,
  openOptions: () => windowManagerStore.getState().openWindow("options"),
  closeOptions: () => windowManagerStore.getState().closeWindow("options"),
  toggleOptions: () => windowManagerStore.getState().toggleWindow("options"),
}));

mirrorOpenState("options", optionsUiStore);

// ─────────────────────────── Commande palette (enregistrée par l'intégrateur) ───────────────────────────

export const commandes: Commande[] = [
  {
    id: "panneau:options",
    mnemonique: "OMON",
    libelle: "Options (smile IV, max pain, GEX/DEX)",
    categorie: "panneau",
    motsCles: [
      "options",
      "omon",
      "smile",
      "iv",
      "volatilite implicite",
      "max pain",
      "put call ratio",
      "dvol",
      "skew",
      "risk reversal",
      "rr25",
      "deribit",
      "gex",
      "dex",
      "gamma exposure",
      "delta exposure",
      "cboe",
      "spx",
      "ndx",
      "vix",
    ],
    apercu: "Ouvre / ferme le moniteur d'options (smile, GEX/DEX crypto & actions)",
    action: () => optionsUiStore.getState().toggleOptions(),
  },
];

// ─────────────────────────── Constantes ───────────────────────────

const REFRESH_MS = 60_000; // ~1 min.
// ETF CBOE (IBIT/ETHA) : ~1,2 Mo par appel pour une cotation différée d'environ 15 min.
const REFRESH_ETF_MS = 5 * 60_000;
const DEVISES = ["BTC", "ETH"] as const;
type Devise = (typeof DEVISES)[number];

// ─────────────────────────── Agrégations dérivées (pures, hors réseau) ───────────────────────────

/** Échéances disponibles (futures), triées croissant, avec le nombre d'options. */
function echeancesDispo(chain: OptionPoint[], now: number): { expiryMs: number; count: number }[] {
  const parExp = new Map<number, number>();
  for (const p of chain) {
    if (p.expiryMs <= now) continue;
    parExp.set(p.expiryMs, (parExp.get(p.expiryMs) ?? 0) + 1);
  }
  return [...parExp.entries()]
    .map(([expiryMs, count]) => ({ expiryMs, count }))
    .sort((a, b) => a.expiryMs - b.expiryMs);
}

/** Agrège l'open interest par strike (calls / puts) pour un jeu de points d'une échéance. */
function agregerParStrike(points: OptionPoint[]): StrikeOi[] {
  const parStrike = new Map<number, StrikeOi>();
  for (const p of points) {
    const cur = parStrike.get(p.strike) ?? { strike: p.strike, callOi: 0, putOi: 0 };
    if (p.type === "call") cur.callOi += Number.isFinite(p.openInterest) ? p.openInterest : 0;
    else cur.putOi += Number.isFinite(p.openInterest) ? p.openInterest : 0;
    parStrike.set(p.strike, cur);
  }
  return [...parStrike.values()].sort((a, b) => a.strike - b.strike);
}

// ─────────────────────────── Dessin du smile ───────────────────────────

/** Strike réel le plus proche de `cible` parmi `points` (calls et puts confondus). */
function strikePlusProche(points: OptionPoint[], cible: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(p.strike - cible);
    if (d < bestDist) {
      bestDist = d;
      best = p.strike;
    }
  }
  return best;
}

// ─────────────────────────── Composant ───────────────────────────

export function OptionsWindow() {
  const open = useStore(optionsUiStore, (s) => s.open);

  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const termIvCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [devise, setDevise] = useState<Devise>("BTC");
  const { chaine: chain, dvol, dvolHistorique, loading, erreur, majTs, observedAt, nowMs, actualiser } = useOptionsDeribit(devise, open);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [portee, setPortee] = useState<"toutes" | "selection">("toutes");

  // Vue : smile IV (existant), GEX/DEX, ou heatmap OI strike×échéance. En GEX/DEX : classe crypto
  // (Deribit) ou actions (CBOE).
  const [vue, setVue] = useState<"smile" | "gexdex" | "heatmap" | "termiv">("smile");
  const [classe, setClasse] = useState<"crypto" | "actions">("crypto");
  const [metrique, setMetrique] = useState<"gex" | "dex">("gex");
  // Métrique de la heatmap : open interest, |GEX| (murs de gamma), volume 24h OU ΔOI depuis un
  // instantané daté (J-1 ou J-7). État dédié à la vue heatmap.
  const [heatmapMetrique, setHeatmapMetrique] = useState<MetriqueHeatmap>("oi");
  const [refOiChoix, setRefOiChoix] = useState<ChoixReferenceOi>("j1");
  // Instantanés quotidiens (ΔOI : références J-1/J-7 ; surface : archive), étiquetés par devise.
  const [refsOi, setRefsOi] = useState<{ devise: Devise; refs: ReferencesOi } | null>(null);
  const [archiveSurface, setArchiveSurface] = useState<{ devise: Devise; lecture: LectureArchive } | null>(null);
  const [survolHeatmap, setSurvolHeatmap] = useState<SurvolHeatmap | null>(null);
  // Index du point de term structure survolé (null = aucun) — pilote l'infobulle et l'anneau.
  const [survolTermIv, setSurvolTermIv] = useState<number | null>(null);
  // Chaîne CBOE (indices actions) — chargée seulement en GEX/DEX « Actions ».
  const [cboeTicker, setCboeTicker] = useState<CboeTicker>("SPX");
  const [cboeChaine, setCboeChaine] = useState<CboeChain | null>(null);
  // ETF : prix du sous-jacent crypto au dernier échange de l'ETF (null = conversion masquée).
  const [cboeRefCrypto, setCboeRefCrypto] = useState<number | null>(null);
  // Échéance CBOE choisie dans le sélecteur (null = aucun choix : sélection par défaut).
  const [cboeChoix, setCboeChoix] = useState<number | null>(null);
  const [cboeErreur, setCboeErreur] = useState<string | null>(null);
  const [cboeLoading, setCboeLoading] = useState(false);
  const [cboeMajTs, setCboeMajTs] = useState<number | null>(null);

  // Échéances disponibles (recalculées à chaque changement de chaîne).
  const echeances = useMemo(() => echeancesDispo(chain, nowMs), [chain, nowMs]);

  // Sélectionne l'échéance la plus proche si aucune valide n'est retenue.
  useEffect(() => {
    if (echeances.length === 0) {
      setExpiry(null);
      return;
    }
    setExpiry((prev) => {
      if (prev !== null && echeances.some((e) => e.expiryMs === prev)) return prev;
      return echeances[0]?.expiryMs ?? null;
    });
  }, [echeances]);

  // Points de l'échéance sélectionnée + métriques dérivées.
  const pointsEcheance = useMemo(
    () => (expiry === null ? [] : chain.filter((p) => p.expiryMs === expiry)),
    [chain, expiry],
  );
  const maxPain = useMemo(() => computeMaxPain(agregerParStrike(pointsEcheance)), [pointsEcheance]);
  const pcRatio = useMemo(() => putCallRatioOi(pointsEcheance), [pointsEcheance]);
  const underlying = useMemo(() => {
    const u = pointsEcheance.map((p) => p.underlying).find((v) => Number.isFinite(v) && v > 0);
    return u ?? NaN;
  }, [pointsEcheance]);
  // Skew 25Δ (risk reversal) de l'échéance sélectionnée — deltas Black-Scholes côté client
  // (même injection du temps que computeCryptoGexDex). Null si pas de jambe proche de 25Δ.
  const skew25 = useMemo(
    () => calculerSkew25d(pointsEcheance, spotDeChaine(pointsEcheance), nowMs),
    [pointsEcheance, underlying, nowMs],
  );
  // IV Rank (90 j) : percentile du DVOL courant dans son historique — null tant que l'un des
  // deux manque (historique en cours de chargement, DVOL indisponible).
  const dvolIvRank = useMemo(
    () => (dvol === null || dvolHistorique === null ? null : ivRank(dvolHistorique, dvol)),
    [dvolHistorique, dvol],
  );

  // Probabilités implicites de l'échéance sélectionnée (Breeden-Litzenberger centré, fonction pure
  // de data/probaImplicite, nowMs injecté au bord). Niveau saisi ; vide = forward arrondi, remis
  // à vide au changement de devise (un niveau BTC n'a pas de sens en ETH).
  const courbeProba = useMemo(
    () => (vue === "smile" ? courbeProbaImplicite(pointsEcheance, nowMs) : null),
    [vue, pointsEcheance, nowMs],
  );
  // P(toucher) part du prix COURANT (forward de l'échéance la plus proche ≈ index), pas du forward
  // de l'échéance sélectionnée (revue indépendante : +5 à 9 pts au-delà de 3 mois).
  const prixProba = useMemo(() => (vue === "smile" ? prixCourant(chain, nowMs) : null), [vue, chain, nowMs]);
  const [niveauProba, setNiveauProba] = useState("");
  useEffect(() => setNiveauProba(""), [devise]);
  const niveauDefaut = courbeProba === null ? null : niveauParDefaut(courbeProba.forward);
  const lectureProba = useMemo(
    () => lireProbasNiveau(courbeProba, niveauProba.trim() === "" ? niveauDefaut : Number(niveauProba), prixProba),
    [courbeProba, niveauProba, niveauDefaut, prixProba],
  );

  // Domaine d'axe strike (smile) : bornes = min/max des strikes de l'échéance sélectionnée —
  // se réinitialise automatiquement quand devise/échéance changent (pointsEcheance en dépend).
  const strikesBornes = useMemo<Domaine | null>(() => {
    if (pointsEcheance.length === 0) return null;
    const strikes = pointsEcheance.map((p) => p.strike);
    let min = Math.min(...strikes);
    let max = Math.max(...strikes);
    if (max === min) max = min + 1;
    return { min, max };
  }, [pointsEcheance]);
  // Curseur du smile : point (strike, IV/OI call+put) survolé — calls et puts sont deux
  // OptionPoint séparés (pas deux champs d'un même point), d'où jusqu'à 4 lignes. Déclaré
  // avant useDomaineZoom : son setter est référencé par l'onGeste qui vide le survol après
  // un zoom/pan/double-clic (sinon le trait reste figé sur l'ancien point, cf. lot revue finale).
  const [survolSmile, setSurvolSmile] = useState<SurvolSmile | null>(null);
  const { refCanvas, domaine } = useDomaineZoom(strikesBornes, () => setSurvolSmile(null), { gauche: SMILE_PAD_L, droite: SMILE_PAD_R });

  // Chaîne CBOE : chargée + pollée UNIQUEMENT en vue GEX/DEX « Actions » (dégradation gracieuse
  // totale — fetchCboeChain renvoie null en cas d'échec, jamais d'exception). ETF : le prix de
  // référence crypto est attendu AVANT de poser l'état, pour que chaîne et ratio arrivent ensemble.
  useEffect(() => {
    if (!open || vue !== "gexdex" || classe !== "actions") return;
    let ignore = false;
    const charger = async () => {
      setCboeLoading(true);
      const chaine = await fetchCboeChain(cboeTicker);
      const ref =
        chaine && estEtfCrypto(chaine.ticker) && chaine.dernierEchangeNy
          ? await prixCryptoAuDernierEchange(chaine.ticker, chaine.dernierEchangeNy)
          : null;
      if (ignore) return;
      setCboeChaine(chaine);
      if (chaine) setCboeMajTs(Date.now());
      setCboeRefCrypto(ref);
      setCboeErreur(chaine ? null : "Chaîne CBOE indisponible (endpoint non contractuel).");
      setCboeLoading(false);
    };
    void charger();
    const timer = setInterval(charger, estEtfCrypto(cboeTicker) ? REFRESH_ETF_MS : REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, vue, classe, cboeTicker]);

  // Échéances CBOE disponibles + échéance retenue : le choix manuel s'il est encore listé, sinon
  // la plus proche NON expirée (après 16:00 à New York, celle du jour reste listée, greeks résiduels).
  const cboeEcheances = useMemo(
    () => (cboeChaine ? cboeExpiries(cboeChaine.options, nowMs) : []),
    [cboeChaine, nowMs],
  );
  const cboeExpiry = useMemo(
    () => echeanceCboeRetenue(cboeEcheances, cboeChoix),
    [cboeEcheances, cboeChoix],
  );
  const cboeExpiree = cboeEcheances.some((e) => e.expiryMs === cboeExpiry && e.expiree);

  // Un index commun pour les USD ; les forwards de chaque maturité restent portés
  // par OptionPoint pour les greeks. Une seule portée alimente graphique et tuiles.
  const spotChaine = useMemo(() => spotDeChaine(chain), [chain]);
  const resumeMarche = useMemo(() => resumerMarcheOptions(chain, spotChaine, nowMs), [chain, spotChaine, nowMs]);
  const pointsPortee = portee === "toutes" ? chain : pointsEcheance;
  const gexDexSpot = classe === "crypto" ? spotChaine : (cboeChaine?.spot ?? NaN);
  const gexDexPoints = useMemo<GexDexPoint[]>(() => {
    if (vue !== "gexdex") return [];
    if (classe === "crypto") return gexParStrikeToutesEcheances(pointsPortee, spotChaine, nowMs);
    if (!cboeChaine || cboeExpiry === null) return [];
    return aggregateGexDex(cboeOptionsToLegs(cboeChaine.options, cboeExpiry), cboeChaine.spot, EQUITY_CONTRACT_MULTIPLIER);
  }, [vue, classe, pointsPortee, spotChaine, nowMs, cboeChaine, cboeExpiry]);
  const sourceNet = gexDexPoints;
  // Aucun contrat calculable ≠ exposition réellement nulle.
  const gexNet = useMemo(() => sourceNet.length ? sourceNet.reduce((s, p) => s + p.gex, 0) : NaN, [sourceNet]);
  const dexNet = useMemo(() => sourceNet.length ? sourceNet.reduce((s, p) => s + p.dex, 0) : NaN, [sourceNet]);
  const flip = useMemo(() => gammaFlip(sourceNet), [sourceNet]);
  const strikePicGex = useMemo(() => {
    let best: GexDexPoint | null = null;
    for (const p of gexDexPoints) if (!best || Math.abs(p.gex) > Math.abs(best.gex)) best = p;
    return best?.strike ?? null;
  }, [gexDexPoints]);

  // ─────────────────────────── Verdict market maker + murs + profil GEX(S) (Lot E) ───────────────────────────

  // Σ|GEX| par strike du MÊME périmètre que le net — échelle du seuil relatif d'indétermination.
  const sommeAbsGex = useMemo(() => sourceNet.reduce((s, p) => s + Math.abs(p.gex), 0), [sourceNet]);
  // Index commun à la portée crypto choisie ; spot fourni par CBOE en actions.
  const spotVerdict = classe === "crypto" ? spotChaine : gexDexSpot;
  // Verdict market maker (fonction pure verdictGamma) — régime, phrase d'action, distance au flip.
  const verdict = useMemo(
    () => verdictGamma(gexNet, spotVerdict, flip, sommeAbsGex),
    [gexNet, spotVerdict, flip, sommeAbsGex],
  );
  // Murs de gamma nommés — même périmètre que le graphique et le net.
  const murs = useMemo(() => mursGamma(sourceNet), [sourceNet]);

  // Lecture ETF spot crypto (IBIT/ETHA) : ratio de conversion, P/C et notionnel de la chaîne
  // complète (agrégats pris avant le filtre ±25 %). Null hors ETF. Sous-jacent dérivé de la
  // chaîne affichée, jamais du ticker sélectionné (qui la précède pendant le chargement).
  const lectureEtf = useMemo<LectureEtf | null>(() => {
    if (classe !== "actions" || !cboeChaine || !estEtfCrypto(cboeChaine.ticker)) return null;
    const { oiCalls, oiPuts, volCalls, volPuts } = cboeChaine.resume;
    return {
      sousJacent: SOUS_JACENT_ETF[cboeChaine.ticker],
      prixEtf: cboeChaine.spot,
      prixCrypto: cboeRefCrypto,
      dernierEchangeNy: cboeChaine.dernierEchangeNy,
      iv30: cboeChaine.iv30,
      pcOi: oiCalls > 0 ? oiPuts / oiCalls : Number.NaN,
      pcVol: volCalls > 0 ? volPuts / volCalls : Number.NaN,
      notionnelUsd: (oiCalls + oiPuts) * EQUITY_CONTRACT_MULTIPLIER * cboeChaine.spot,
    };
  }, [classe, cboeChaine, cboeRefCrypto]);
  const scenariosGamma = useMemo<ScenarioGamma[]>(() => {
    if (vue !== "gexdex" || !Number.isFinite(spotVerdict)) return [];
    if (classe === "crypto") {
      return comparerHypothesesGammaCrypto(pointsPortee, spotVerdict, nowMs);
    }
    if (!cboeChaine || cboeExpiry === null) return [];
    return comparerHypothesesGamma(
      cboeOptionsToLegs(cboeChaine.options, cboeExpiry),
      spotVerdict,
      EQUITY_CONTRACT_MULTIPLIER,
    );
  }, [vue, classe, pointsPortee, spotVerdict, nowMs, cboeChaine, cboeExpiry]);

  const sourcesCarte = useMemo(() => {
    if (vue !== "gexdex") return [];
    if (classe === "crypto") return construireSourcesCrypto(pointsPortee, spotChaine, nowMs);
    return cboeExpiry === null ? [] : [{ expiryMs: cboeExpiry, points: gexDexPoints }];
  }, [vue, classe, pointsPortee, spotChaine, nowMs, cboeExpiry, gexDexPoints]);
  const carte = useMemo(() => construireCarteExpositions(sourcesCarte, gexDexSpot), [sourcesCarte, gexDexSpot]);
  const profil = useMemo(() => vue === "gexdex" && classe === "crypto"
    ? profilExpositionsCrypto(pointsPortee, spotChaine, nowMs) : { points: [] },
  [vue, classe, pointsPortee, spotChaine, nowMs]);
  // La détection du zéro reste celle du moteur validé, y compris les plateaux nuls.
  const flipProfil = useMemo(() => profil.points.length === 0 ? null
    : profilGexSpot(pointsPortee, profil.points.map((p) => p.spot), nowMs).flipReel,
  [pointsPortee, profil, nowMs]);

  // Redessine le smile à chaque changement de données (fenêtre ouverte, vue smile).
  useEffect(() => {
    if (!open || vue !== "smile") return;
    const canvas = refCanvas.current;
    if (canvas && domaine) dessinerSmile(canvas, pointsEcheance, underlying, maxPain, domaine);
    else if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [open, vue, pointsEcheance, underlying, maxPain, domaine]);

  useEffect(() => {
    setSurvolSmile(null);
    setSurvolHeatmap(null);
    setSurvolTermIv(null);
  }, [devise, expiry, portee, cboeTicker]);

  // ─────────────────────────── Instantanés quotidiens (ΔOI, surface à maturité constante) ───────────────────────────

  // Références ΔOI J-1/J-7 et archive de la surface : relues à l'ouverture, au changement de devise
  // ou de jour UTC, et après une capture. Sonde du daemon mémoïsée 60 s (patron TERM).
  const jourCourant = jourUtc(nowMs);
  const [versionInstantanes, setVersionInstantanes] = useState(0);
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const d = devise;
    void lireReferencesOi(d, Date.now()).then((refs) => { if (!ignore) setRefsOi({ devise: d, refs }); });
    void lireArchiveSurface(d).then((lecture) => { if (!ignore) setArchiveSurface({ devise: d, lecture }); });
    return () => { ignore = true; };
  }, [open, devise, jourCourant, versionInstantanes]);

  // Premier chargement réussi après 08:05 UTC : un instantané par devise et par jour UTC, daté de
  // la réception de la chaîne (majTs) ; rien avant 08:05, jamais réécrit. Captures mémorisées par
  // session : les cycles suivants ne relisent pas le stockage. Le compteur est incrémenté même si
  // l'effet a été relancé entre-temps (la relance ne recapture pas : sans lui, rien ne serait relu).
  useEffect(() => {
    if (!open || majTs === null || chain.length === 0) return;
    void Promise.all([
      capturerSurfaceDuJour(devise, chain, spotChaine, majTs),
      capturerInstantaneOi(devise, chain, majTs),
    ]).then(([archive, oiEcrit]) => {
      if (archive !== null || oiEcrit) setVersionInstantanes((v) => v + 1);
    });
  }, [open, devise, majTs, chain, spotChaine]);

  // ─────────────────────────── Heatmap OI strike × échéance ───────────────────────────

  // Flux du jour (métriques d'en-tête Smile, agrégées sur TOUTE la chaîne — lecture globale du
  // marché, indépendante de l'échéance sélectionnée). P/C (Vol) : ratio put/call sur le volume
  // 24h (même patron que putCallRatioOi, appliqué à volume24h). NaN si aucun volume call.
  const pcVolRatio = useMemo(() => {
    let call = 0;
    let put = 0;
    for (const p of chain) {
      if (!Number.isFinite(p.volume24h)) continue;
      if (p.type === "call") call += p.volume24h;
      else put += p.volume24h;
    }
    return call > 0 ? put / call : NaN;
  }, [chain]);
  // Notionnel OI : Σ(OI × spot) sur toute la chaîne, en USD. NaN si spot indisponible.
  const notionnelOi = useMemo(() => {
    if (!Number.isFinite(spotChaine)) return NaN;
    let somme = 0;
    for (const p of chain) {
      if (!Number.isFinite(p.openInterest)) continue;
      somme += p.openInterest * spotChaine;
    }
    return somme;
  }, [chain, spotChaine]);

  // Grille OI/GEX (toutes échéances) — recalculée quand la vue heatmap est active. nowMs au
  // bord du composant (comme gexDexPoints/skew25) ; la logique pure reçoit nowMs injecté.
  const grilleOi = useMemo<GrilleOi | null>(
    () => (vue === "heatmap" ? construireGrilleOi(chain, spotChaine, nowMs) : null),
    [vue, chain, spotChaine, nowMs],
  );
  const bandeOi = useMemo(
    () => (grilleOi ? bandeStrikes(grilleOi.strikes, spotChaine) : []),
    [grilleOi, spotChaine],
  );
  // Bande triée décroissante (strike haut en haut) — hoistée ici pour éviter de retrier à
  // chaque mousemove et pour que dessin (dessinerHeatmapOi) et survol (onSurvolHeatmap)
  // consomment EXACTEMENT le même ordre.
  const bandeOiDesc = useMemo(() => [...bandeOi].sort((a, b) => b - a), [bandeOi]);

  // ΔOI contre l'instantané J-1 ou J-7 de la devise affichée (fonction pure, nowMs au bord :
  // échéances réglées exclues, référence strictement antérieure). null = aucune référence.
  const refsOiDevise = refsOi?.devise === devise ? refsOi.refs : null;
  const refOi = refsOiDevise === null ? null : refOiChoix === "j1" ? refsOiDevise.j1 : refsOiDevise.j7;
  const deltaOi = useMemo(
    () => (vue === "heatmap" && heatmapMetrique === "doi" && refOi !== null ? calculerDeltaOi(chain, refOi, spotChaine, nowMs) : null),
    [vue, heatmapMetrique, refOi, chain, spotChaine, nowMs],
  );
  const deltaOiCarte = useMemo(
    () => (deltaOi === null ? null : {
      cellules: new Map(deltaOi.cellules.map((c) => [`${c.expiryMs}|${c.strike}`, c])),
      deltaAbsMax: deltaOi.deltaAbsMax,
    }),
    [deltaOi],
  );
  const topDeltaOi = useMemo(
    () => (deltaOi === null || expiry === null ? null : topStrikesDeltaOi(deltaOi, expiry)),
    [deltaOi, expiry],
  );
  const celluleDeltaSurvol = survolHeatmap && deltaOiCarte
    ? (deltaOiCarte.cellules.get(`${survolHeatmap.expiryMs}|${survolHeatmap.strike}`) ?? null)
    : null;

  // Redessine la heatmap (données/vue/métrique/thème/survol). Le thème repeint via majTs (les
  // tokens sont lus au dessin) ; survol pilote le liseré.
  useEffect(() => {
    if (!open || vue !== "heatmap") return;
    const canvas = heatmapCanvasRef.current;
    if (canvas && grilleOi) {
      dessinerHeatmapOi(canvas, grilleOi, bandeOiDesc, heatmapMetrique, spotChaine, survolHeatmap, deltaOiCarte);
    } else if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [open, vue, grilleOi, bandeOiDesc, heatmapMetrique, spotChaine, survolHeatmap, majTs, deltaOiCarte]);

  // Cellule survolée : inverse la géométrie (colonne/ligne depuis les pixels) vers échéance/strike.
  const onSurvolHeatmap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!grilleOi || grilleOi.echeances.length === 0 || bandeOiDesc.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - HEATMAP_PAD_L - HEATMAP_PAD_R);
    const plotH = Math.max(1, rect.height - HEATMAP_PAD_T - HEATMAP_PAD_B);
    const x = e.clientX - rect.left - HEATMAP_PAD_L;
    const y = e.clientY - rect.top - HEATMAP_PAD_T;
    if (x < 0 || y < 0 || x >= plotW || y >= plotH) {
      setSurvolHeatmap(null);
      return;
    }
    const ci = Math.min(grilleOi.echeances.length - 1, Math.floor((x / plotW) * grilleOi.echeances.length));
    const ri = Math.min(bandeOiDesc.length - 1, Math.floor((y / plotH) * bandeOiDesc.length));
    const exp = grilleOi.echeances[ci];
    const strike = bandeOiDesc[ri];
    if (exp === undefined || strike === undefined) return;
    setSurvolHeatmap({ expiryMs: exp, strike });
  };

  // Cellule + max pain de l'échéance survolée (pour l'infobulle).
  const celluleSurvol = useMemo(() => {
    if (!survolHeatmap || !grilleOi) return null;
    return (
      grilleOi.cellules.find(
        (c) => c.expiryMs === survolHeatmap.expiryMs && c.strike === survolHeatmap.strike,
      ) ?? null
    );
  }, [survolHeatmap, grilleOi]);

  // Prime de la cellule survolée = Σ(OI × markPrice × spot) sur call+put (en USD) — la prime
  // markPrice est en unités de base, ×spot la convertit en USD. markPrice non fini exclu de la
  // somme (convention Number.isFinite) ; null si AUCUN côté n'a de markPrice fini → « — ».
  const primeCellule = useMemo(() => {
    if (!survolHeatmap) return null;
    let somme = 0;
    let auMoinsUn = false;
    for (const p of chain) {
      if (p.expiryMs !== survolHeatmap.expiryMs || p.strike !== survolHeatmap.strike) continue;
      if (!Number.isFinite(p.markPrice)) continue;
      const oi = Number.isFinite(p.openInterest) ? p.openInterest : 0;
      somme += oi * p.markPrice * spotChaine;
      auMoinsUn = true;
    }
    return auMoinsUn ? somme : null;
  }, [survolHeatmap, chain, spotChaine]);

  // ─────────────────────────── Term structure IV (toutes échéances) ───────────────────────────

  // Points de la term structure — recalculés seulement quand la vue est active (fonction pure de
  // data/termIv, nowMs injecté au bord comme grilleOi/gexDexPoints). Spot commun à la chaîne.
  const termIvPoints = useMemo<PointTermIv[]>(
    () => (vue === "termiv" ? termStructureIv(chain, spotChaine, nowMs) : []),
    [vue, chain, spotChaine, nowMs],
  );

  // Surface à maturité constante (7/30/90 j) et lectures de son historique quotidien — même garde
  // de vue ; fonctions pures de data/surfaceConstante, nowMs injecté au bord.
  const surfaceCourante = useMemo(
    () => (vue === "termiv" && chain.length > 0 ? surfaceMaturiteConstante(chain, spotChaine, nowMs) : null),
    [vue, chain, spotChaine, nowMs],
  );
  const donneesSurface = useMemo<DonneesSurfaceConstante | null>(() => {
    if (surfaceCourante === null) return null;
    const lecture = archiveSurface?.devise === devise ? archiveSurface.lecture : null;
    const archive = lecture?.archive ?? ARCHIVE_VIDE;
    return {
      lectures: lireSurfaceHistorique(surfaceCourante, archive, nowMs),
      couverture: couvertureArchive(archive, nowMs),
      daemon: lecture?.daemon ?? false,
      nbEcheancesRetenues: surfaceCourante.nbEcheancesRetenues,
      nbEcheancesEcartees: surfaceCourante.nbEcheancesEcartees,
    };
  }, [surfaceCourante, archiveSurface, devise, nowMs]);

  // Mouvement attendu par échéance (straddle ATM au forward + EM IV) — même garde de vue que la
  // term structure ; fonction pure de data/mouvementAttendu, nowMs injecté au bord.
  const mouvements = useMemo<PointMouvementAttendu[]>(
    () => (vue === "termiv" ? mouvementsAttendus(chain, nowMs) : []),
    [vue, chain, nowMs],
  );

  // Calendrier ECO (store déjà partagé avec la fenêtre ECO et les marqueurs chart) : chargé
  // seulement s'il est vide, via le cache et la garde de débit (refresh non forcé).
  const evenementsEco = useStore(ecoStore, (s) => s.events);
  useEffect(() => {
    if (!open || vue !== "termiv") return;
    if (ecoStore.getState().events.length === 0) ecoStore.getState().refresh(false);
  }, [open, vue]);
  const evenementsVol = useMemo(
    () =>
      evenementsEco
        .filter((e) => e.impact === "high" && e.country === "USD")
        .map((e) => ({ time: e.time, libelle: libelleCourtEvenement(e.title) })),
    [evenementsEco],
  );
  // Couverture du calendrier chargé (toutes devises et impacts, hors FOMC statiques).
  const finCouvertureEco = useMemo(() => finCouvertureCalendrier(evenementsEco), [evenementsEco]);
  // Vol forward entre échéances consécutives de la courbe (mêmes IV ATM que le tracé) et part
  // d'événement — fonction pure de data/volForward, nowMs injecté au bord.
  const segmentsFwd = useMemo<SegmentVolForward[]>(
    () => (vue === "termiv" ? volsForward(termIvPoints, nowMs, evenementsVol, finCouvertureEco) : []),
    [vue, termIvPoints, evenementsVol, finCouvertureEco, nowMs],
  );

  // Redessine la term structure (données/vue/DVOL/survol ; thème repeint via majTs, tokens lus au dessin).
  useEffect(() => {
    if (!open || vue !== "termiv") return;
    const canvas = termIvCanvasRef.current;
    if (canvas) dessinerTermIv(canvas, termIvPoints, dvol, survolTermIv, segmentsFwd);
  }, [open, vue, termIvPoints, dvol, survolTermIv, segmentsFwd, majTs]);

  // Point survolé : inverse la géométrie (colonne ordinale depuis les pixels) — MÊMES paddings que
  // le dessin (TERMIV_PAD_*), leçon HEATMAP_PAD.
  const onSurvolTermIv = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (termIvPoints.length === 0) {
      setSurvolTermIv(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - TERMIV_PAD_L - TERMIV_PAD_R);
    const x = e.clientX - rect.left - TERMIV_PAD_L;
    if (x < 0 || x >= plotW) {
      setSurvolTermIv(null);
      return;
    }
    const i = Math.min(termIvPoints.length - 1, Math.floor((x / plotW) * termIvPoints.length));
    setSurvolTermIv(i);
  };

  const onSurvolSmile = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (domaine === null || pointsEcheance.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Reproduit le repère de dessinerSmile (px = padL + valeurVersPixel(domaine, s, plotW)) :
    // sans ça, le trait/point survolé dérive de padL par rapport à la courbe tracée.
    const plotW = Math.max(1, rect.width - SMILE_PAD_L - SMILE_PAD_R);
    const cible = pixelVersValeur(domaine, e.clientX - rect.left - SMILE_PAD_L, plotW);
    const strike = strikePlusProche(pointsEcheance, cible);
    if (strike === null) return;
    const call = pointsEcheance.find((p) => p.strike === strike && p.type === "call") ?? null;
    const put = pointsEcheance.find((p) => p.strike === strike && p.type === "put") ?? null;
    setSurvolSmile({
      xPix: SMILE_PAD_L + valeurVersPixel(domaine, strike, plotW),
      largeur: rect.width,
      strike,
      ivCall: call && Number.isFinite(call.markIv) && call.markIv > 0 ? call.markIv : null,
      ivPut: put && Number.isFinite(put.markIv) && put.markIv > 0 ? put.markIv : null,
      oiCall: call ? call.openInterest : null,
      oiPut: put ? put.openInterest : null,
      ...lireProbasNiveau(courbeProba, strike, prixProba),
    });
  };

  return (
    <>
      {vue !== "gexdex" && <EnTeteFenetre mnemo="OMON" titre="Options" sousTitre="Smile IV · max pain · GEX/DEX · heatmap OI · term IV" />}

      <div className="min-w-0 px-4 py-3">
        {/* Bascule de vue : Smile ↔ GEX/DEX ↔ Heatmap OI */}
        <div className="mb-3">
          <Segmente
            options={[
              { id: "smile", label: "Smile" },
              { id: "gexdex", label: "GEX/DEX" },
              { id: "heatmap", label: "Heatmap OI" },
              { id: "termiv", label: "Term IV" },
            ] as const}
            actif={vue}
            onChange={setVue}
          />
        </div>

        {/* En GEX/DEX : bascules classe (crypto/actions) + métrique (GEX/DEX) */}
        {vue === "gexdex" && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Segmente
              options={[
                { id: "crypto", label: "Crypto" },
                { id: "actions", label: "Actions" },
              ] as const}
              actif={classe}
              onChange={setClasse}
            />
            <Segmente
              options={[
                { id: "gex", label: "GEX" },
                { id: "dex", label: "DEX" },
              ] as const}
              actif={metrique}
              onChange={setMetrique}
            />
            {classe === "crypto" && <Segmente options={DEVISES.map((d) => ({ id: d, label: d }))} actif={devise} onChange={setDevise} />}
          </div>
        )}

        {/* En heatmap : bascule devise + métrique OI ↔ |GEX| ↔ Volume ↔ ΔOI (la carte couvre toutes
            les échéances ; en ΔOI, référence J-1/J-7 et échéance du top 5) */}
        {vue === "heatmap" && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmente
              options={DEVISES.map((d) => ({ id: d, label: d }))}
              actif={devise}
              onChange={setDevise}
            />
            <Segmente
              options={[
                { id: "oi", label: "OI" },
                { id: "gex", label: "|GEX|" },
                { id: "volume", label: "Volume" },
                { id: "doi", label: "ΔOI", title: "Variation d'OI depuis un instantané quotidien (non signée)" },
              ] as const}
              actif={heatmapMetrique}
              onChange={setHeatmapMetrique}
            />
            {heatmapMetrique === "doi" && (
              <>
                <Segmente
                  options={[
                    { id: "j1", label: "J-1" },
                    { id: "j7", label: "J-7" },
                  ] as const}
                  actif={refOiChoix}
                  onChange={setRefOiChoix}
                />
                <Select
                  value={expiry ?? ""}
                  onChange={(e) => setExpiry(Number(e.target.value))}
                  aria-label="Échéance du top 5 ΔOI"
                  className="min-w-0 flex-1"
                >
                  {echeances.length === 0 && <option value="">—</option>}
                  {echeances.map((e) => (
                    <option key={e.expiryMs} value={e.expiryMs}>
                      {new Date(e.expiryMs).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" })}{" "}
                      · {joursAvant(e.expiryMs)}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>
        )}

        {/* En Term IV : bascule devise seule (pas d'échéance — la courbe couvre toutes les échéances) */}
        {vue === "termiv" && (
          <div className="mb-3 flex items-center gap-2">
            <Segmente
              options={DEVISES.map((d) => ({ id: d, label: d }))}
              actif={devise}
              onChange={setDevise}
            />
          </div>
        )}

        {/* Sélecteurs devise + échéance Deribit (smile ET gex/dex crypto) */}
        {(vue === "smile" || (vue === "gexdex" && classe === "crypto")) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {vue === "smile" ? <Segmente options={DEVISES.map((d) => ({ id: d, label: d }))} actif={devise} onChange={setDevise} />
              : <Segmente options={[{ id: "toutes", label: "Toutes échéances" }, { id: "selection", label: "Échéance sélectionnée" }] as const} actif={portee} onChange={setPortee} />}
            <Select
              value={expiry ?? ""}
              onChange={(e) => { setExpiry(Number(e.target.value)); if (vue === "gexdex") setPortee("selection"); }}
              aria-label="Échéance"
              disabled={vue === "gexdex" && portee === "toutes"}
              className="min-w-0 flex-1"
            >
              {echeances.length === 0 && <option value="">—</option>}
              {echeances.map((e) => (
                <option key={e.expiryMs} value={e.expiryMs}>
                  {new Date(e.expiryMs).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  · {joursAvant(e.expiryMs)} · {e.count} opt
                </option>
              ))}
            </Select>
          </div>
        )}

        {(vue !== "gexdex" || classe === "crypto") && (
          <ResumeMarcheOptions compacte={vue === "gexdex"} devise={devise} resume={resumeMarche} loading={loading} erreur={erreur}
            majTs={majTs} observedAt={observedAt} nowMs={nowMs} onRefresh={actualiser} />
        )}

        {/* Sélecteurs ticker + échéance CBOE (gex/dex actions) */}
        {vue === "gexdex" && classe === "actions" && (
          <div className="mb-3 flex items-center gap-2">
            <Segmente
              options={CBOE_TICKERS.map((t) => ({
                id: t,
                label: t,
                title: estEtfCrypto(t) ? `ETF spot ${SOUS_JACENT_ETF[t]} : niveaux convertis en prix ${SOUS_JACENT_ETF[t]}` : undefined,
              }))}
              actif={cboeTicker}
              onChange={setCboeTicker}
            />
            <Select
              value={cboeExpiry ?? ""}
              onChange={(e) => setCboeChoix(Number(e.target.value))}
              aria-label="Échéance CBOE"
              className="flex-1"
            >
              {cboeEcheances.length === 0 && <option value="">—</option>}
              {cboeEcheances.map((e) => (
                <option key={e.expiryMs} value={e.expiryMs}>
                  {new Date(e.expiryMs).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  · {joursAvant(e.expiryMs)} · {e.count} opt
                </option>
              ))}
            </Select>
          </div>
        )}
        {/* Hors du libellé : un <select> natif prend la largeur de son option la plus longue. */}
        {vue === "gexdex" && classe === "actions" && cboeExpiree && (
          <p className="-mt-2 mb-3 text-[10px] text-warn">Échéance expirée (16:00 NY passée) : greeks CBOE résiduels, murs et flip non significatifs.</p>
        )}

        {/* ─────────── Vue SMILE (existante) — bloc TOUJOURS monté (canvas useDomaineZoom), cf. VueSmile ─────────── */}
        <VueSmile
          visible={vue === "smile"}
          loading={loading}
          majTs={majTs}
          erreur={erreur}
          refCanvas={refCanvas}
          survolSmile={survolSmile}
          onSurvolSmile={onSurvolSmile}
          onSortieSmile={() => setSurvolSmile(null)}
          maxPain={maxPain}
          underlying={underlying}
          dvol={dvol}
          dvolIvRank={dvolIvRank}
          pcRatio={pcRatio}
          skew25={skew25}
          pcVolRatio={pcVolRatio}
          notionnelOi={notionnelOi}
          niveauProba={niveauProba}
          onNiveauProba={setNiveauProba}
          niveauDefaut={niveauDefaut}
          lectureProba={lectureProba}
        />

        {/* ─────────── Vue GEX/DEX (montée conditionnellement) ─────────── */}
        {vue === "gexdex" && (
          <VueGexDex
            metrique={metrique}
            classe={classe}
            portee={portee}
            loading={loading}
            cboeLoading={cboeLoading}
            majTs={classe === "crypto" ? majTs : cboeMajTs}
            erreur={erreur}
            cboeErreur={cboeErreur}
            key={`${classe}:${classe === "crypto" ? devise : cboeTicker}`}
            carte={carte}
            profil={profil}
            gexNet={gexNet}
            dexNet={dexNet}
            spotVerdict={spotVerdict}
            flip={flip}
            strikePicGex={strikePicGex}
            verdict={verdict}
            murs={murs}
            scenariosGamma={scenariosGamma}
            flipReel={flipProfil}
            etf={lectureEtf}
          />
        )}

        {/* ─────────── Vue HEATMAP OI — bloc TOUJOURS monté, cf. VueHeatmap ─────────── */}
        <VueHeatmap
          visible={vue === "heatmap"}
          heatmapMetrique={heatmapMetrique}
          loading={loading}
          majTs={majTs}
          erreur={erreur}
          heatmapCanvasRef={heatmapCanvasRef}
          onSurvolHeatmap={onSurvolHeatmap}
          onSortieHeatmap={() => setSurvolHeatmap(null)}
          survolHeatmap={survolHeatmap}
          celluleSurvol={celluleSurvol}
          grilleOi={grilleOi}
          primeCellule={primeCellule}
          deltaOi={{
            devise,
            choix: refOiChoix,
            refs: refsOiDevise,
            resultat: deltaOi,
            top: topDeltaOi,
            expiryMs: expiry,
            celluleSurvol: celluleDeltaSurvol,
          }}
        />

        {/* ─────────── Vue TERM IV — bloc TOUJOURS monté, cf. VueTermIv ─────────── */}
        <VueTermIv
          visible={vue === "termiv"}
          loading={loading}
          majTs={majTs}
          erreur={erreur}
          termIvCanvasRef={termIvCanvasRef}
          onSurvolTermIv={onSurvolTermIv}
          onSortieTermIv={() => setSurvolTermIv(null)}
          survolTermIv={survolTermIv}
          termIvPoints={termIvPoints}
          mouvements={mouvements}
          segments={segmentsFwd}
          finCouvertureEco={finCouvertureEco}
          surface={donneesSurface}
          nowMs={nowMs}
        />
      </div>
    </>
  );
}
