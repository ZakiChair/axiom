/**
 * Fenêtre GLOBE — globe orthographique d3-geo sur Canvas 2D, cinq couches live :
 *   • Chokepoints maritimes IMF PortWatch (hebdo ~J-5, cache 6 h, chargés à l'ouverture).
 *   • Trafic aérien OpenSky (instantané ~10 s, poll INTERVALLE_POLL_MS UNIQUEMENT
 *     fenêtre ouverte ET couche active — budget 400 crédits/jour affiché en pied).
 *   • Événements géopolitiques GDELT (15 min via daemon, poll gated par couche).
 *   • Conflits armés confirmés UCDP (~1 mois de lag, via daemon, 1×/ouverture).
 *   • Front Ukraine ISW (polygones, direct navigateur, cache 6 h, 1×/ouverture).
 *
 * Rendu IMPÉRATIF, pattern MarketMapWindow : canvas + refs + ResizeObserver (le chrome
 * FloatingWindow écrit le DOM directement pendant le drag/resize, les props React ne
 * bougent pas — c'est le RO qui pilote la taille du canvas), DPR plafonné à 2. AUCUN
 * setState par frame : la vue (λ/φ/zoom) vit dans des refs ; la boucle rAF (rafThrottle,
 * ~30 fps) ne tourne QUE pendant la rotation auto — sinon redraw à la demande (drag,
 * molette, survol, données, resize, thème). Interactions : glisser = tourner (deltas
 * d'Euler λ/φ clampés), molette = zoom clampé, survol = libellé du chokepoint.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { globeUiStore, type CouchesGlobe } from "../store/globe-ui";
import { themeStore } from "../store/theme";
import { createRafThrottle, type RafThrottle } from "../chart/rafThrottle";
import { lireTokensCanvas } from "../lib/canvasTokens";
import { IS_VERCEL } from "../lib/deployment";
import { formatAge, formatEntier } from "../lib/format";
import { chargerChokepoints } from "../data/globe/portwatch";
import { chargerEtatsAvions, INTERVALLE_POLL_MS } from "../data/globe/opensky";
import { chargerEvenements, chargerZoneEvenements, INTERVALLE_POLL_EVENEMENTS_MS } from "../data/globe/gdelt";
import { chargerConflitsUcdp, invaliderMemoUcdp } from "../data/globe/ucdp";
import { chargerFrontIsw } from "../data/globe/isw";
import type {
  Avion,
  CelluleEvenements,
  Chokepoint,
  EtatConflitsUcdp,
  EtatEvenements,
  EtatOpenSky,
  EvenementDetail,
  FrontUkraine,
  ZoneConflitUcdp,
} from "../data/globe/types";
import type { GeoPermissibleObjects } from "d3-geo"; // assertion locale du front ISW (pattern TERRES)
import {
  appliquerDrag,
  appliquerMolette,
  dessinerGlobe,
  hitTestCibles,
  rayonBase,
  VUE_INITIALE,
  type CibleGlobe,
  type SurvolGlobe,
  type TokensGlobe,
  type VueGlobe,
} from "../lib/globeRender";
import { noteConflits, noteEvenements, noteUkraine } from "./globeWindow.util";
import { GlobeDetailPanel } from "./GlobeDetailPanel";
import type { SelectionGlobe } from "./globeDetail.util";
import { Chargement, EnTeteFenetre, ErreurBloc, NoteSource, Unusable, Vide } from "./ui";

/** Vitesse de la rotation automatique (degrés de longitude par seconde — lente). */
const VITESSE_ROTATION_DEG_S = 2;
/** Cadence maximale de la boucle de rendu (ms) — ~30 fps suffisent pour une rotation lente. */
const INTERVALLE_RENDU_MS = 33;

/** Lit les tokens du thème courant pour le canvas (à la demande, pas au montage). */
function lireTokensGlobe(): TokensGlobe {
  const t = lireTokensCanvas([
    "--bg",
    "--border",
    "--text-dim",
    "--serie-2",
    "--serie-3",
    "--down",
    "--serie-4",
    "--serie-5",
  ]);
  // Thème dark UNIQUEMENT (finding #41) : --serie-4 (#f472b6 rose) est visuellement
  // indiscernable de --down (#f92855 cramoisi) une fois les cellules GDELT empilées
  // dans les zones denses (Europe de l'Est/Moyen-Orient). On y substitue --serie-5
  // (cyan), déjà distinct du rouge dans ce thème — sans toucher aux autres thèmes,
  // où --serie-4 mappe déjà correctement (teal en cute, etc.).
  const themeSombre = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    bg: t["--bg"],
    border: t["--border"],
    textDim: t["--text-dim"],
    serie2: t["--serie-2"],
    serie3: t["--serie-3"],
    down: t["--down"],
    serie4: themeSombre ? t["--serie-5"] : t["--serie-4"],
  };
}

export function GlobeWindow() {
  const open = useStore(globeUiStore, (s) => s.open);
  const couches = useStore(globeUiStore, (s) => s.couches);
  const rotationAuto = useStore(globeUiStore, (s) => s.rotationAuto);
  const themeId = useStore(themeStore, (s) => s.theme); // redessine au changement de thème

  // Données lentes (état React basse fréquence : chargement 1×/ouverture + poll 2 min).
  const [chokepoints, setChokepoints] = useState<Chokepoint[] | null>(null); // null = chargement
  const [etatAvions, setEtatAvions] = useState<EtatOpenSky | null>(null);
  const [echecAvions, setEchecAvions] = useState(false); // dernier appel OpenSky en échec
  const [etatEvenements, setEtatEvenements] = useState<EtatEvenements | null>(null); // dernier instantané GDELT
  const [conflitsUcdp, setConflitsUcdp] = useState<EtatConflitsUcdp | null>(null);
  const [frontUkraine, setFrontUkraine] = useState<FrontUkraine | null>(null);
  const [daemonOk, setDaemonOk] = useState(false); // au moins un chargement daemon (GDELT/UCDP) réussi

  // Panneau détail au clic (basse fréquence : UN setState par clic, jamais par frame).
  const [selection, setSelection] = useState<SelectionGlobe | null>(null); // null = panneau fermé
  const [detailZone, setDetailZone] = useState<EvenementDetail[] | "chargement" | null>(null);

  // Tout ce que la boucle de dessin consomme vit dans des refs (AUCUN state par frame).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vueRef = useRef<VueGlobe>({ ...VUE_INITIALE });
  const tailleRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const tokensRef = useRef<TokensGlobe | null>(null); // invalidé au changement de thème
  const chokepointsRef = useRef<Chokepoint[]>([]);
  const avionsRef = useRef<Avion[]>([]);
  const cellulesRef = useRef<CelluleEvenements[]>([]);
  const zonesRef = useRef<ZoneConflitUcdp[]>([]);
  const frontRef = useRef<FrontUkraine | null>(null);
  const couchesRef = useRef<CouchesGlobe>(couches);
  const rotationAutoRef = useRef<boolean>(rotationAuto);
  const ciblesRef = useRef<CibleGlobe[]>([]); // cibles écran du dernier dessin (hit-test)
  const survolRef = useRef<SurvolGlobe | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const clicDepartRef = useRef<{ x: number; y: number } | null>(null); // origine du pointerdown (discrimination clic/drag)
  const framePrecedenteRef = useRef<number>(0); // horodatage du dernier flush (dt rotation)
  const throttleRef = useRef<RafThrottle | null>(null);

  // — Boucle de rendu : un seul rafThrottle. Le flush avance la rotation auto (dt réel,
  //   sauf pendant un drag) puis redessine ; il se re-déclenche lui-même TANT QUE la
  //   rotation auto est active — sinon la boucle s'éteint et tout redraw est à la demande.
  useEffect(() => {
    if (!open) return;
    const throttle = createRafThrottle(
      () => {
        const canvas = canvasRef.current;
        const maintenant = performance.now();
        const precedente = framePrecedenteRef.current;
        framePrecedenteRef.current = maintenant;
        if (rotationAutoRef.current && dragRef.current === null && survolRef.current === null) {
          // dt borné : au réveil après une pause, pas de saut de rotation.
          const dt = precedente === 0 ? 0 : Math.min(0.2, (maintenant - precedente) / 1000);
          vueRef.current = {
            ...vueRef.current,
            lambda: vueRef.current.lambda + VITESSE_ROTATION_DEG_S * dt,
          };
        }
        if (canvas !== null) {
          const ctx = canvas.getContext("2d");
          const { w, h } = tailleRef.current;
          if (ctx !== null && w > 0 && h > 0) {
            // DPR plafonné à 2 (un canvas 720² @3x coûterait cher pour un gain invisible).
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const pw = Math.round(w * dpr);
            const ph = Math.round(h * dpr);
            if (canvas.width !== pw || canvas.height !== ph) {
              canvas.width = pw;
              canvas.height = ph;
            }
            if (tokensRef.current === null) tokensRef.current = lireTokensGlobe();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ciblesRef.current = dessinerGlobe(ctx, {
              largeur: w,
              hauteur: h,
              vue: vueRef.current,
              tokens: tokensRef.current,
              chokepoints: couchesRef.current.chokepoints ? chokepointsRef.current : [],
              avions: couchesRef.current.avions ? avionsRef.current : [],
              cellules: couchesRef.current.evenements ? cellulesRef.current : [],
              zonesUcdp: couchesRef.current.conflits ? zonesRef.current : [],
              // Assertion locale (pattern TERRES) : `collection` est opaque côté data,
              // c'est un GeoPermissibleObjects (FeatureCollection) côté rendu.
              frontUkraine: couchesRef.current.ukraine
                ? (frontRef.current?.collection as GeoPermissibleObjects | null) ?? null
                : null,
              survol: survolRef.current,
            });
          }
        }
        // Boucle rAF UNIQUEMENT quand une animation est active (le drag et le survol
        // d'un libellé mettent la rotation en pause → la boucle s'éteint aussi ; les
        // interactions la relancent via leurs propres trigger()).
        if (rotationAutoRef.current && dragRef.current === null && survolRef.current === null) {
          throttle.trigger();
        }
      },
      { minIntervalMs: INTERVALLE_RENDU_MS },
    );
    throttleRef.current = throttle;
    framePrecedenteRef.current = 0;
    throttle.trigger();
    return () => {
      throttle.dispose();
      throttleRef.current = null;
    };
  }, [open]);

  // — Config basse fréquence → refs, puis redraw (relance la boucle si rotation activée). —
  useEffect(() => {
    couchesRef.current = couches;
    rotationAutoRef.current = rotationAuto;
    framePrecedenteRef.current = 0; // pas de saut de dt après une pause
    throttleRef.current?.trigger();
  }, [couches, rotationAuto]);

  // — Thème : invalide les tokens mis en cache, redessine. —
  useEffect(() => {
    tokensRef.current = null;
    throttleRef.current?.trigger();
  }, [themeId]);

  // — Taille du canvas pilotée par ResizeObserver (le resize de FloatingWindow est
  //   impératif : aucune prop React ne change pendant le drag des poignées). —
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      tailleRef.current = { w: rect.width, h: rect.height };
      throttleRef.current?.trigger();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // — Chokepoints : chargés à l'ouverture (cache 6 h côté data, jamais d'exception). —
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const ctrl = new AbortController();
    setChokepoints(null);
    void chargerChokepoints(ctrl.signal).then((liste) => {
      if (ignore) return;
      setChokepoints(liste);
      chokepointsRef.current = liste;
      throttleRef.current?.trigger();
    });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [open]);

  // — OpenSky : poll UNIQUEMENT fenêtre ouverte ET couche avions active, nettoyé au
  //   démontage. En cas d'échec on garde le dernier instantané (dégradation gracieuse). —
  useEffect(() => {
    if (!open || !couches.avions) return;
    let ignore = false;
    const ctrl = new AbortController();
    const charger = async (): Promise<void> => {
      const etat = await chargerEtatsAvions(ctrl.signal);
      if (ignore) return;
      setEchecAvions(etat === null);
      if (etat !== null) {
        setEtatAvions(etat);
        avionsRef.current = etat.avions;
        throttleRef.current?.trigger();
      }
    };
    void charger();
    const timer = setInterval(() => void charger(), INTERVALLE_POLL_MS);
    return () => {
      ignore = true;
      ctrl.abort();
      clearInterval(timer);
    };
  }, [open, couches.avions]);

  // — GDELT : poll 15 min UNIQUEMENT fenêtre ouverte ET couche active. Le daemon est
  //   la seule source (amont http-only) : un résultat non-null latche `daemonOk` ; en
  //   cas d'échec ponctuel on garde le dernier instantané (pattern echecAvions). —
  useEffect(() => {
    if (!open || !couches.evenements) return;
    let ignore = false;
    const ctrl = new AbortController();
    const charger = async (): Promise<void> => {
      const etat = await chargerEvenements(ctrl.signal);
      if (ignore || etat === null) return;
      setDaemonOk(true);
      setEtatEvenements(etat);
      cellulesRef.current = etat.cellules;
      throttleRef.current?.trigger();
    };
    void charger();
    const timer = setInterval(() => void charger(), INTERVALLE_POLL_EVENEMENTS_MS);
    return () => {
      ignore = true;
      ctrl.abort();
      clearInterval(timer);
    };
  }, [open, couches.evenements]);

  // — UCDP : re-fetch à chaque ouverture (invalide le mémo pour rattraper un
  //   daemon redémarré / routes /globe fraîches après `pnpm run up`). —
  useEffect(() => {
    if (!open || !couches.conflits) return;
    let ignore = false;
    const ctrl = new AbortController();
    invaliderMemoUcdp();
    void chargerConflitsUcdp(ctrl.signal).then((etat) => {
      if (ignore) return;
      if (etat === null) {
        // Laisse le pied afficher « en attente… » / « daemon hors ligne ».
        setConflitsUcdp(null);
        zonesRef.current = [];
        throttleRef.current?.trigger();
        return;
      }
      setDaemonOk(true);
      setConflitsUcdp(etat);
      zonesRef.current = etat.zones;
      throttleRef.current?.trigger();
    });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [open, couches.conflits]);

  // — Front ISW : direct navigateur (cache 6 h côté data), chargé UNE fois par ouverture. —
  useEffect(() => {
    if (!open || !couches.ukraine) return;
    let ignore = false;
    const ctrl = new AbortController();
    void chargerFrontIsw(ctrl.signal).then((front) => {
      if (ignore || front === null) return;
      setFrontUkraine(front);
      frontRef.current = front;
      throttleRef.current?.trigger();
    });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [open, couches.ukraine]);

  // — Détail de zone au clic sur une cellule GDELT : « chargement » puis liste (ou null
  //   si daemon absent). Les couches agrégées (conflit/chokepoint) n'ont pas de liste. —
  useEffect(() => {
    if (selection === null || selection.type !== "evenement") {
      setDetailZone(null);
      return;
    }
    let ignore = false;
    const ctrl = new AbortController();
    setDetailZone("chargement");
    void chargerZoneEvenements(selection.lat, selection.lon, ctrl.signal).then((res) => {
      if (ignore) return;
      setDetailZone(res);
    });
    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [selection]);

  // — Molette : zoom clampé. Listener NATIF non-passif (React attache wheel en passif
  //   depuis la v17 → preventDefault y serait ignoré et la page défilerait). —
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surMolette = (ev: WheelEvent): void => {
      ev.preventDefault();
      vueRef.current = appliquerMolette(vueRef.current, ev.deltaY);
      throttleRef.current?.trigger();
    };
    canvas.addEventListener("wheel", surMolette, { passive: false });
    return () => canvas.removeEventListener("wheel", surMolette);
  }, [open]);

  // — Pointeur : drag = rotation (refs + throttle, aucun state) ; sinon survol = hit-test. —
  const surPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.currentTarget.style.cursor = ""; // laisse active:cursor-grabbing reprendre la main pendant le drag
    dragRef.current = { x: ev.clientX, y: ev.clientY };
    clicDepartRef.current = { x: ev.clientX, y: ev.clientY }; // origine figée (dragRef, lui, avance à chaque move)
  };

  const surPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (dragRef.current !== null) {
      const dx = ev.clientX - dragRef.current.x;
      const dy = ev.clientY - dragRef.current.y;
      dragRef.current = { x: ev.clientX, y: ev.clientY };
      const rayon = rayonBase(tailleRef.current.w, tailleRef.current.h) * vueRef.current.zoom;
      vueRef.current = appliquerDrag(vueRef.current, dx, dy, rayon);
      throttleRef.current?.trigger();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cible = hitTestCibles(ciblesRef.current, ev.clientX - rect.left, ev.clientY - rect.top);
    // Affordance de clic (finding #25) : curseur pointer sur une cible hit-testée,
    // sinon on retombe sur la classe Tailwind cursor-grab (style inline vidé).
    canvas.style.cursor = cible !== null ? "pointer" : "";
    const survol = cible === null ? null : { couche: cible.couche, index: cible.index };
    if (survol?.couche !== survolRef.current?.couche || survol?.index !== survolRef.current?.index) {
      survolRef.current = survol;
      framePrecedenteRef.current = 0; // le survol met la rotation en pause → pas de saut au départ
      throttleRef.current?.trigger();
    }
  };

  // Construit la sélection depuis une cible cliquée (null = clic dans le vide → ferme le panneau).
  const selectionDepuisCible = (cible: CibleGlobe | null): SelectionGlobe | null => {
    if (cible === null) return null;
    if (cible.couche === "chokepoint") {
      const chokepoint = chokepointsRef.current[cible.index];
      return chokepoint === undefined ? null : { type: "chokepoint", chokepoint };
    }
    if (cible.couche === "evenement") {
      const cellule = cellulesRef.current[cible.index];
      return cellule === undefined ? null : { type: "evenement", lat: cellule.lat, lon: cellule.lon, cellule };
    }
    const zone = zonesRef.current[cible.index];
    return zone === undefined ? null : { type: "conflit", zone };
  };

  const surPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    // Discrimination clic/drag : un pointerup dont le déplacement total depuis le
    //   pointerdown reste < 5 px est traité comme un clic (hit-test → sélection). Le
    //   pointercancel ne fait que réinitialiser (jamais de clic fantôme).
    const depart = clicDepartRef.current;
    const canvas = canvasRef.current;
    if (ev.type === "pointerup" && depart !== null && canvas !== null) {
      const deplacement = Math.hypot(ev.clientX - depart.x, ev.clientY - depart.y);
      if (deplacement < 5) {
        const rect = canvas.getBoundingClientRect();
        const cible = hitTestCibles(ciblesRef.current, ev.clientX - rect.left, ev.clientY - rect.top);
        setSelection(selectionDepuisCible(cible)); // UN setState par clic (autorisé)
      }
    }
    clicDepartRef.current = null;
    dragRef.current = null;
    framePrecedenteRef.current = 0;
    throttleRef.current?.trigger(); // relance la boucle si la rotation auto est active
  };

  const surPointerLeave = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = null;
    ev.currentTarget.style.cursor = "";
    if (survolRef.current !== null) {
      survolRef.current = null;
      throttleRef.current?.trigger();
    }
  };

  // — Pied de fenêtre : fraîcheur des cinq sources. —
  const derniereDatePortWatch = chokepoints?.reduce<string | null>(
    (max, c) => (c.date !== null && (max === null || c.date > max) ? c.date : max),
    null,
  );
  const erreurChokepoints = couches.chokepoints && chokepoints !== null && chokepoints.length === 0;
  const erreurAvions = couches.avions && echecAvions && etatAvions === null;
  const aucuneCouche =
    !couches.chokepoints && !couches.avions && !couches.evenements && !couches.conflits && !couches.ukraine;
  const couchesDaemonVercel = [
    couches.evenements ? "GDELT" : null,
    couches.conflits ? "UCDP" : null,
  ].filter((couche): couche is string => couche !== null);
  const raisonCouchesVercel =
    couchesDaemonVercel.length === 1
      ? `Couche ${couchesDaemonVercel[0]} uniquement : elle dépend du daemon local axiomd, indisponible sur Vercel.`
      : `Couches ${couchesDaemonVercel.join(" et ")} uniquement : elles dépendent du daemon local axiomd, indisponible sur Vercel.`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EnTeteFenetre
        mnemo="GLOBE"
        titre="Globe"
        sousTitre="Conflits géopolitiques (GDELT · UCDP · ISW) · chokepoints (PortWatch) · trafic aérien (OpenSky)"
      />

      {/* Bascules de couches + rotation (chips, pattern MacroRatesWindow). */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] text-text-dim">
        <button
          type="button"
          aria-pressed={couches.chokepoints}
          title={couches.chokepoints ? "Masquer les chokepoints" : "Afficher les chokepoints"}
          onClick={() => globeUiStore.getState().toggleCouche("chokepoints")}
          className={`rounded border border-border px-2 py-0.5 transition ${
            couches.chokepoints ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          <span className="text-serie-3">●</span> Chokepoints
        </button>
        <button
          type="button"
          aria-pressed={couches.avions}
          title={couches.avions ? "Masquer le trafic aérien" : "Afficher le trafic aérien"}
          onClick={() => globeUiStore.getState().toggleCouche("avions")}
          className={`rounded border border-border px-2 py-0.5 transition ${
            couches.avions ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          <span>●</span> Avions
        </button>
        <button
          type="button"
          aria-pressed={couches.evenements}
          title={couches.evenements ? "Masquer les événements GDELT" : "Afficher les événements GDELT"}
          onClick={() => globeUiStore.getState().toggleCouche("evenements")}
          className={`rounded border border-border px-2 py-0.5 transition ${
            couches.evenements ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          <span className="text-down">●</span> Événements
        </button>
        <button
          type="button"
          aria-pressed={couches.conflits}
          title={couches.conflits ? "Masquer les conflits UCDP" : "Afficher les conflits UCDP"}
          onClick={() => globeUiStore.getState().toggleCouche("conflits")}
          className={`rounded border border-border px-2 py-0.5 transition ${
            couches.conflits ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          <span className="text-down">○</span> Conflits
        </button>
        <button
          type="button"
          aria-pressed={couches.ukraine}
          title={couches.ukraine ? "Masquer le front Ukraine" : "Afficher le front Ukraine"}
          onClick={() => globeUiStore.getState().toggleCouche("ukraine")}
          className={`rounded border border-border px-2 py-0.5 transition ${
            couches.ukraine ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          <span className="text-down">▧</span> Ukraine
        </button>
        <button
          type="button"
          aria-pressed={rotationAuto}
          title={rotationAuto ? "Arrêter la rotation automatique" : "Démarrer la rotation automatique"}
          onClick={() => globeUiStore.getState().setRotationAuto(!rotationAuto)}
          className={`rounded border border-border px-2 py-0.5 transition ${
            rotationAuto ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          ⟳ Rotation
        </button>
        <span className="ml-auto">molette = zoom · glisser = tourner · clic = détails</span>
      </div>

      {IS_VERCEL && couchesDaemonVercel.length > 0 && (
        <div className="px-3 pt-2">
          <Unusable raison={raisonCouchesVercel} />
        </div>
      )}

      {(erreurChokepoints || erreurAvions) && (
        <div className="px-3 pt-2">
          <ErreurBloc>
            {erreurChokepoints && "Chokepoints PortWatch indisponibles (réseau, sans cache)."}
            {erreurChokepoints && erreurAvions && " "}
            {erreurAvions && "Trafic aérien OpenSky indisponible (réseau ou quota épuisé)."}
          </ErreurBloc>
        </div>
      )}

      {/* Corps : le canvas remplit la fenêtre ; états standard en surimpression. */}
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={surPointerDown}
          onPointerMove={surPointerMove}
          onPointerUp={surPointerUp}
          onPointerCancel={surPointerUp}
          onPointerLeave={surPointerLeave}
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        />
        {couches.chokepoints && chokepoints === null && (
          <div className="pointer-events-none absolute inset-x-0 top-0">
            <Chargement libelle="Chargement des chokepoints…" />
          </div>
        )}
        {aucuneCouche && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-8">
            <Vide>Toutes les couches sont masquées — réactivez une couche pour afficher des données.</Vide>
          </div>
        )}
        {/* Panneau détail au clic : absolute DANS ce conteneur relatif → ses events
            pointer/molette ciblent le panneau, jamais le canvas (pas de zoom parasite). */}
        {selection !== null ? (
          <GlobeDetailPanel selection={selection} evenements={detailZone} onFermer={() => setSelection(null)} />
        ) : null}
      </div>

      {/* Fraîcheur des sources (note de bas de fenêtre standard). */}
      <div className="shrink-0 border-t border-border px-4 py-1.5">
        <NoteSource>
          Chokepoints : IMF PortWatch, hebdo ~J-5
          {derniereDatePortWatch != null ? ` (dernier point ${derniereDatePortWatch})` : ""}. Avions :
          OpenSky
          {etatAvions !== null
            ? ` ${formatEntier(etatAvions.avions.length)} aéronefs, maj ${formatAge(
                etatAvions.horodatage * 1000,
                Date.now(),
              )}${
                etatAvions.creditsRestants !== null
                  ? `, ${formatEntier(etatAvions.creditsRestants)} crédits restants`
                  : ""
              }`
            : couches.avions
              ? " en attente…"
              : " désactivé"}
          {echecAvions && etatAvions !== null ? " (dernier appel en échec — instantané conservé)" : ""}
          {" "}· {noteEvenements(etatEvenements, couches.evenements, daemonOk, Date.now())} ·{" "}
          {noteConflits(conflitsUcdp, couches.conflits, daemonOk, Date.now())} ·{" "}
          {noteUkraine(frontUkraine, couches.ukraine, Date.now())}
        </NoteSource>
      </div>
    </div>
  );
}
