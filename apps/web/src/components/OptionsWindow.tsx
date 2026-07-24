/**
 * Fenêtre « Options » (mnémonique OMON) — dockable à droite, NON MODALE. Source Deribit.
 *
 * Par échéance sélectionnée : SMILE de volatilité implicite (IV mark par strike, calls et
 * puts), MAX PAIN calculé côté client (fonction pure), PUT/CALL ratio sur l'open interest,
 * SKEW 25Δ (risk reversal — fonction pure, data/skew.ts) et DVOL (indice de volatilité
 * implicite) si disponible. Sélecteurs devise (BTC/ETH) + échéance.
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
  fetchDeribitOptionChain,
  fetchDvol,
  putCallRatioOi,
  type OptionPoint,
  type StrikeOi,
} from "../data/deribit";
import {
  aggregateGexDex,
  computeCryptoGexDex,
  gexParStrikeToutesEcheances,
  gammaFlip,
  EQUITY_CONTRACT_MULTIPLIER,
  type GexDexPoint,
} from "../data/gexDex";
import { calculerSkew25d } from "../data/skew";
import { termStructureIv, type PointTermIv } from "../data/termIv";
import { histDvol } from "../data/referentiels";
import { ivRank } from "../data/ivRank";
import { bandeStrikes, construireGrilleOi, type GrilleOi } from "../data/oiHeatmap";
import {
  CBOE_TICKERS,
  cboeExpiries,
  cboeOptionsToLegs,
  fetchCboeChain,
  type CboeChain,
  type CboeTicker,
} from "../data/cboe";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { valeurVersPixel, pixelVersValeur, type Domaine } from "../lib/domaineAxe";
import { useDomaineZoom } from "../hooks/useDomaineZoom";
import { EnTeteFenetre, Segmente } from "./ui";
import {
  dessinerSmile,
  dessinerBarres,
  dessinerHeatmapOi,
  dessinerTermIv,
  filtrerAuSeuil,
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
import { VueGexDex } from "./omon/VueGexDex";
import { VueHeatmap } from "./omon/VueHeatmap";
import { VueTermIv } from "./omon/VueTermIv";

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

// ─────────────────────────── Constantes ───────────────────────────

const REFRESH_MS = 60_000; // ~1 min.
const DEVISES = ["BTC", "ETH"] as const;
type Devise = (typeof DEVISES)[number];

// ─────────────────────────── Agrégations dérivées (pures, hors réseau) ───────────────────────────

/** Échéances disponibles (futures), triées croissant, avec le nombre d'options. */
function echeancesDispo(chain: OptionPoint[]): { expiryMs: number; count: number }[] {
  const now = Date.now();
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

  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const termIvCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [devise, setDevise] = useState<Devise>("BTC");
  const [chain, setChain] = useState<OptionPoint[]>([]);
  const [dvol, setDvol] = useState<number | null>(null);
  // Historique DVOL 90 j (valeurs seules) pour l'IV Rank — accesseur referentiels, cache TTL 1 h
  // partagé avec le régime (data/regime.ts) : ZÉRO fetch dédié, rechargé au rythme du poll OMON.
  const [dvolHistorique, setDvolHistorique] = useState<number[] | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  // Vue : smile IV (existant), GEX/DEX, ou heatmap OI strike×échéance. En GEX/DEX : classe crypto
  // (Deribit) ou actions (CBOE).
  const [vue, setVue] = useState<"smile" | "gexdex" | "heatmap" | "termiv">("smile");
  const [classe, setClasse] = useState<"crypto" | "actions">("crypto");
  const [metrique, setMetrique] = useState<"gex" | "dex">("gex");
  // Métrique de la heatmap : open interest, |GEX| (murs de gamma) OU volume 24h. État dédié à la vue heatmap.
  const [heatmapMetrique, setHeatmapMetrique] = useState<"oi" | "gex" | "volume">("oi");
  const [survolHeatmap, setSurvolHeatmap] = useState<SurvolHeatmap | null>(null);
  // Index du point de term structure survolé (null = aucun) — pilote l'infobulle et l'anneau.
  const [survolTermIv, setSurvolTermIv] = useState<number | null>(null);
  // Chaîne CBOE (indices actions) — chargée seulement en GEX/DEX « Actions ».
  const [cboeTicker, setCboeTicker] = useState<CboeTicker>("SPX");
  const [cboeChaine, setCboeChaine] = useState<CboeChain | null>(null);
  const [cboeExpiry, setCboeExpiry] = useState<number | null>(null);
  const [cboeErreur, setCboeErreur] = useState<string | null>(null);
  const [cboeLoading, setCboeLoading] = useState(false);

  // Chargement + polling conditionnés à l'ouverture et à la devise.
  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const charger = async () => {
      setLoading(true);
      const [chaine, vol, histVol] = await Promise.allSettled([
        fetchDeribitOptionChain(devise),
        fetchDvol(devise),
        histDvol(devise),
      ]);
      if (ignore) return;
      if (chaine.status === "fulfilled") {
        setChain(chaine.value);
        setErreur(chaine.value.length === 0 ? "Aucune option renvoyée par Deribit." : null);
      } else {
        setChain([]);
        setErreur("Chaîne d'options Deribit indisponible.");
      }
      setDvol(vol.status === "fulfilled" ? vol.value : null);
      const serie = histVol.status === "fulfilled" ? histVol.value : null;
      setDvolHistorique(serie === null ? null : serie.map((p) => p.v));
      setMajTs(Date.now());
      setLoading(false);
    };

    void charger();
    const timer = setInterval(charger, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, devise]);

  // Échéances disponibles (recalculées à chaque changement de chaîne).
  const echeances = useMemo(() => echeancesDispo(chain), [chain]);

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
    () => calculerSkew25d(pointsEcheance, underlying, Date.now()),
    [pointsEcheance, underlying],
  );
  // IV Rank (90 j) : percentile du DVOL courant dans son historique — null tant que l'un des
  // deux manque (historique en cours de chargement, DVOL indisponible).
  const dvolIvRank = useMemo(
    () => (dvol === null || dvolHistorique === null ? null : ivRank(dvolHistorique, dvol)),
    [dvolHistorique, dvol],
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
  const { refCanvas, domaine } = useDomaineZoom(strikesBornes, () => setSurvolSmile(null));

  // Chaîne CBOE : chargée + pollée UNIQUEMENT en vue GEX/DEX « Actions » (dégradation gracieuse
  // totale — fetchCboeChain renvoie null en cas d'échec, jamais d'exception).
  useEffect(() => {
    if (!open || vue !== "gexdex" || classe !== "actions") return;
    let ignore = false;
    const charger = async () => {
      setCboeLoading(true);
      const chaine = await fetchCboeChain(cboeTicker);
      if (ignore) return;
      setCboeChaine(chaine);
      setCboeErreur(chaine ? null : "Chaîne CBOE indisponible (endpoint non contractuel).");
      setCboeLoading(false);
    };
    void charger();
    const timer = setInterval(charger, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [open, vue, classe, cboeTicker]);

  // Échéances CBOE disponibles + sélection de la plus proche (même logique que Deribit).
  const cboeEcheances = useMemo(
    () => (cboeChaine ? cboeExpiries(cboeChaine.options, Date.now()) : []),
    [cboeChaine],
  );
  useEffect(() => {
    if (cboeEcheances.length === 0) {
      setCboeExpiry(null);
      return;
    }
    setCboeExpiry((prev) => {
      if (prev !== null && cboeEcheances.some((e) => e.expiryMs === prev)) return prev;
      return cboeEcheances[0]?.expiryMs ?? null;
    });
  }, [cboeEcheances]);

  // Exposition GEX/DEX par strike : crypto (Black-Scholes client-side) ou actions (greeks CBOE).
  const gexDexSpot = classe === "crypto" ? underlying : (cboeChaine?.spot ?? NaN);
  const gexDexPoints = useMemo<GexDexPoint[]>(() => {
    if (vue !== "gexdex") return [];
    if (classe === "crypto") {
      if (!Number.isFinite(underlying)) return [];
      return computeCryptoGexDex(pointsEcheance, underlying, Date.now());
    }
    if (!cboeChaine || cboeExpiry === null) return [];
    return aggregateGexDex(
      cboeOptionsToLegs(cboeChaine.options, cboeExpiry),
      cboeChaine.spot,
      EQUITY_CONTRACT_MULTIPLIER,
    );
  }, [vue, classe, pointsEcheance, underlying, cboeChaine, cboeExpiry]);

  // Spot valable pour TOUTES les échéances (le sous-jacent est indépendant de l'échéance) : pris
  // sur la chaîne complète, pas sur `pointsEcheance` (limité à l'échéance sélectionnée). Remonté
  // ici (revue finale) car gexDexTout, qui agrège aussi TOUTE la chaîne, doit s'ancrer dessus —
  // pas sur `underlying`, qui ne vaut que pour l'échéance sélectionnée et peut être NaN tant
  // qu'elle n'est pas chargée, faisant disparaître à tort le net/gamma flip toutes-éch.
  // NB revue : quasi-duplication avec `underlying` (spot mono-échéance, cf. plus haut) — à
  // envisager de fusionner si un troisième usage apparaît.
  const spotChaine = useMemo(() => {
    const u = chain.map((p) => p.underlying).find((v) => Number.isFinite(v) && v > 0);
    return u ?? NaN;
  }, [chain]);

  // GEX/DEX crypto agrégé sur TOUTES les échéances (Task 4) — alimente le net et le gamma flip
  // « toutes éch. ». Crypto seulement : le CBOE reste mono-échéance (cf. NoteSource « Une seule
  // échéance »). Date.now() au bord comme gexDexPoints/grilleOi ; la logique pure reçoit nowMs.
  const gexDexTout = useMemo<GexDexPoint[]>(() => {
    if (vue !== "gexdex" || classe !== "crypto") return [];
    if (!Number.isFinite(spotChaine)) return [];
    return gexParStrikeToutesEcheances(chain, spotChaine, Date.now());
  }, [vue, classe, chain, spotChaine]);

  // Source des métriques nettes + du gamma flip : toutes échéances en crypto, mono-échéance en
  // actions (le CBOE n'a pas d'agrégation toutes échéances). L'histogramme et le pic |GEX| restent
  // sur gexDexPoints (mono) — le net « toutes éch. » côtoie donc volontairement le pic mono.
  const sourceNet = classe === "crypto" ? gexDexTout : gexDexPoints;
  const gexNet = useMemo(() => sourceNet.reduce((s, p) => s + p.gex, 0), [sourceNet]);
  const dexNet = useMemo(() => sourceNet.reduce((s, p) => s + p.dex, 0), [sourceNet]);
  const flip = useMemo(() => gammaFlip(sourceNet), [sourceNet]);
  const strikePicGex = useMemo(() => {
    let best: GexDexPoint | null = null;
    for (const p of gexDexPoints) if (!best || Math.abs(p.gex) > Math.abs(best.gex)) best = p;
    return best?.strike ?? null;
  }, [gexDexPoints]);

  // Domaine de l'histogramme GEX/DEX : en crypto, MÊME domaine que le smile (même univers de
  // strikes Deribit — zoom/pan du smile pilote les deux). En actions (CBOE, strikes SPX/NDX/VIX
  // sans rapport avec les strikes crypto), domaine local plein cadre non zoomable — inchangé
  // vis-à-vis du comportement d'avant cette tâche.
  const domaineActionsGexDex = useMemo<Domaine | null>(() => {
    if (classe !== "actions" || gexDexPoints.length === 0) return null;

    // Domaine basé sur le sous-ensemble filtré au seuil (même base que le tracé, via
    // filtrerAuSeuil, partagée avec dessinerBarres).
    const seuil = filtrerAuSeuil(gexDexPoints, metrique);

    // Fallback à tous les points si le sous-ensemble filtré est vide.
    const pointsUtiles = seuil.length > 0 ? seuil : gexDexPoints;
    const strikes = pointsUtiles.map((p) => p.strike);
    let min = Math.min(...strikes, Number.isFinite(gexDexSpot) ? gexDexSpot : Infinity);
    let max = Math.max(...strikes, Number.isFinite(gexDexSpot) ? gexDexSpot : -Infinity);
    if (max === min) max = min + 1;
    return { min, max };
  }, [classe, gexDexPoints, gexDexSpot, metrique]);
  const domaineBarres = classe === "crypto" ? domaine : domaineActionsGexDex;

  // Redessine le smile à chaque changement de données (fenêtre ouverte, vue smile).
  useEffect(() => {
    if (!open || vue !== "smile") return;
    const canvas = refCanvas.current;
    if (canvas && domaine) dessinerSmile(canvas, pointsEcheance, underlying, maxPain, domaine);
  }, [open, vue, pointsEcheance, underlying, maxPain, domaine]);

  // Redessine l'histogramme GEX/DEX (fenêtre ouverte, vue gexdex).
  useEffect(() => {
    if (!open || vue !== "gexdex") return;
    const canvas = barCanvasRef.current;
    if (canvas && domaineBarres)
      dessinerBarres(canvas, gexDexPoints, gexDexSpot, metrique, domaineBarres, flip);
  }, [open, vue, gexDexPoints, gexDexSpot, metrique, domaineBarres, flip]);

  // ─────────────────────────── Heatmap OI strike × échéance ───────────────────────────

  // spotChaine défini plus haut (remonté au-dessus de gexDexTout, revue finale).

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

  // Grille OI/GEX (toutes échéances) — recalculée quand la vue heatmap est active. Date.now() au
  // bord du composant (comme gexDexPoints/skew25) ; la logique pure reçoit nowMs injecté.
  const grilleOi = useMemo<GrilleOi | null>(
    () => (vue === "heatmap" ? construireGrilleOi(chain, spotChaine, Date.now()) : null),
    [vue, chain, spotChaine],
  );
  const bandeOi = useMemo(
    () => (grilleOi ? bandeStrikes(grilleOi.strikes, spotChaine) : []),
    [grilleOi, spotChaine],
  );
  // Bande triée décroissante (strike haut en haut) — hoistée ici pour éviter de retrier à
  // chaque mousemove et pour que dessin (dessinerHeatmapOi) et survol (onSurvolHeatmap)
  // consomment EXACTEMENT le même ordre.
  const bandeOiDesc = useMemo(() => [...bandeOi].sort((a, b) => b - a), [bandeOi]);

  // Redessine la heatmap (données/vue/métrique/thème/survol). Le thème repeint via majTs (les
  // tokens sont lus au dessin) ; survol pilote le liseré.
  useEffect(() => {
    if (!open || vue !== "heatmap") return;
    const canvas = heatmapCanvasRef.current;
    if (canvas && grilleOi) {
      dessinerHeatmapOi(canvas, grilleOi, bandeOiDesc, heatmapMetrique, spotChaine, survolHeatmap);
    }
  }, [open, vue, grilleOi, bandeOiDesc, heatmapMetrique, spotChaine, survolHeatmap, majTs]);

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
    () => (vue === "termiv" ? termStructureIv(chain, spotChaine, Date.now()) : []),
    [vue, chain, spotChaine],
  );

  // Redessine la term structure (données/vue/DVOL/survol ; thème repeint via majTs, tokens lus au dessin).
  useEffect(() => {
    if (!open || vue !== "termiv") return;
    const canvas = termIvCanvasRef.current;
    if (canvas) dessinerTermIv(canvas, termIvPoints, dvol, survolTermIv);
  }, [open, vue, termIvPoints, dvol, survolTermIv, majTs]);

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
    });
  };

  return (
    <>
      <EnTeteFenetre mnemo="OMON" titre="Options" sousTitre="Smile IV · max pain · GEX/DEX · heatmap OI · term IV" />

      <div className="flex-1 overflow-y-auto px-4 py-4">
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
          <div className="mb-3 flex items-center gap-2">
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
          </div>
        )}

        {/* En heatmap : bascule devise + métrique OI ↔ |GEX| (pas de sélecteur d'échéance —
            la heatmap couvre toutes les échéances) */}
        {vue === "heatmap" && (
          <div className="mb-3 flex items-center gap-2">
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
              ] as const}
              actif={heatmapMetrique}
              onChange={setHeatmapMetrique}
            />
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
          <div className="mb-3 flex items-center gap-2">
            <Segmente
              options={DEVISES.map((d) => ({ id: d, label: d }))}
              actif={devise}
              onChange={setDevise}
            />
            <select
              value={expiry ?? ""}
              onChange={(e) => setExpiry(Number(e.target.value))}
              aria-label="Échéance"
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-text"
            >
              {echeances.length === 0 && <option value="">—</option>}
              {echeances.map((e) => (
                <option key={e.expiryMs} value={e.expiryMs}>
                  {new Date(e.expiryMs).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}{" "}
                  · {joursAvant(e.expiryMs)} · {e.count} opt
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Sélecteurs ticker + échéance CBOE (gex/dex actions) */}
        {vue === "gexdex" && classe === "actions" && (
          <div className="mb-3 flex items-center gap-2">
            <Segmente
              options={CBOE_TICKERS.map((t) => ({ id: t, label: t }))}
              actif={cboeTicker}
              onChange={setCboeTicker}
            />
            <select
              value={cboeExpiry ?? ""}
              onChange={(e) => setCboeExpiry(Number(e.target.value))}
              aria-label="Échéance CBOE"
              className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] text-text"
            >
              {cboeEcheances.length === 0 && <option value="">—</option>}
              {cboeEcheances.map((e) => (
                <option key={e.expiryMs} value={e.expiryMs}>
                  {new Date(e.expiryMs).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}{" "}
                  · {joursAvant(e.expiryMs)} · {e.count} opt
                </option>
              ))}
            </select>
          </div>
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
        />

        {/* ─────────── Vue GEX/DEX (montée conditionnellement) ─────────── */}
        {vue === "gexdex" && (
          <VueGexDex
            metrique={metrique}
            classe={classe}
            loading={loading}
            cboeLoading={cboeLoading}
            majTs={majTs}
            erreur={erreur}
            cboeErreur={cboeErreur}
            barCanvasRef={barCanvasRef}
            gexNet={gexNet}
            dexNet={dexNet}
            gexDexSpot={gexDexSpot}
            flip={flip}
            strikePicGex={strikePicGex}
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
        />
      </div>
    </>
  );
}

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
