/**
 * Fenêtre GLOBE — globe orthographique d3-geo sur Canvas 2D, deux couches live :
 *   • Chokepoints maritimes IMF PortWatch (hebdo ~J-5, cache 6 h, chargés à l'ouverture).
 *   • Trafic aérien OpenSky (instantané ~10 s, poll INTERVALLE_POLL_MS UNIQUEMENT
 *     fenêtre ouverte ET couche active — budget 400 crédits/jour affiché en pied).
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
import { formatAge, formatEntier } from "../lib/format";
import { chargerChokepoints } from "../data/globe/portwatch";
import { chargerEtatsAvions, INTERVALLE_POLL_MS } from "../data/globe/opensky";
import type { Avion, Chokepoint, EtatOpenSky } from "../data/globe/types";
import {
  appliquerDrag,
  appliquerMolette,
  dessinerGlobe,
  hitTestChokepoints,
  rayonBase,
  VUE_INITIALE,
  type CibleChokepoint,
  type TokensGlobe,
  type VueGlobe,
} from "../lib/globeRender";
import { Chargement, EnTeteFenetre, ErreurBloc, NoteSource, Vide } from "./ui";

/** Vitesse de la rotation automatique (degrés de longitude par seconde — lente). */
const VITESSE_ROTATION_DEG_S = 2;
/** Cadence maximale de la boucle de rendu (ms) — ~30 fps suffisent pour une rotation lente. */
const INTERVALLE_RENDU_MS = 33;

/** Lit les tokens du thème courant pour le canvas (à la demande, pas au montage). */
function lireTokensGlobe(): TokensGlobe {
  const t = lireTokensCanvas(["--bg", "--border", "--text-dim", "--serie-2", "--serie-3"]);
  return {
    bg: t["--bg"],
    border: t["--border"],
    textDim: t["--text-dim"],
    serie2: t["--serie-2"],
    serie3: t["--serie-3"],
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

  // Tout ce que la boucle de dessin consomme vit dans des refs (AUCUN state par frame).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vueRef = useRef<VueGlobe>({ ...VUE_INITIALE });
  const tailleRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const tokensRef = useRef<TokensGlobe | null>(null); // invalidé au changement de thème
  const chokepointsRef = useRef<Chokepoint[]>([]);
  const avionsRef = useRef<Avion[]>([]);
  const couchesRef = useRef<CouchesGlobe>(couches);
  const rotationAutoRef = useRef<boolean>(rotationAuto);
  const ciblesRef = useRef<CibleChokepoint[]>([]); // cibles écran du dernier dessin (hit-test)
  const survolRef = useRef<number>(-1);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
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
        if (rotationAutoRef.current && dragRef.current === null && survolRef.current === -1) {
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
              indexSurvol: survolRef.current,
            });
          }
        }
        // Boucle rAF UNIQUEMENT quand une animation est active (le drag et le survol
        // d'un libellé mettent la rotation en pause → la boucle s'éteint aussi ; les
        // interactions la relancent via leurs propres trigger()).
        if (rotationAutoRef.current && dragRef.current === null && survolRef.current === -1) {
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
    dragRef.current = { x: ev.clientX, y: ev.clientY };
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
    const idx = hitTestChokepoints(ciblesRef.current, ev.clientX - rect.left, ev.clientY - rect.top);
    if (idx !== survolRef.current) {
      survolRef.current = idx;
      framePrecedenteRef.current = 0; // le survol met la rotation en pause → pas de saut au départ
      throttleRef.current?.trigger();
    }
  };

  const surPointerUp = (): void => {
    dragRef.current = null;
    framePrecedenteRef.current = 0;
    throttleRef.current?.trigger(); // relance la boucle si la rotation auto est active
  };

  const surPointerLeave = (): void => {
    dragRef.current = null;
    if (survolRef.current !== -1) {
      survolRef.current = -1;
      throttleRef.current?.trigger();
    }
  };

  // — Pied de fenêtre : fraîcheur des deux sources. —
  const derniereDatePortWatch = chokepoints?.reduce<string | null>(
    (max, c) => (c.date !== null && (max === null || c.date > max) ? c.date : max),
    null,
  );
  const erreurChokepoints = couches.chokepoints && chokepoints !== null && chokepoints.length === 0;
  const erreurAvions = couches.avions && echecAvions && etatAvions === null;
  const aucuneCouche = !couches.chokepoints && !couches.avions;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EnTeteFenetre
        titre="Globe"
        sousTitre="Chokepoints maritimes (IMF PortWatch) · trafic aérien (OpenSky)"
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
          aria-pressed={rotationAuto}
          title={rotationAuto ? "Arrêter la rotation automatique" : "Démarrer la rotation automatique"}
          onClick={() => globeUiStore.getState().setRotationAuto(!rotationAuto)}
          className={`rounded border border-border px-2 py-0.5 transition ${
            rotationAuto ? "bg-bg text-text" : "opacity-60 hover:opacity-100"
          }`}
        >
          ⟳ Rotation
        </button>
        <span className="ml-auto">molette = zoom · glisser = tourner</span>
      </div>

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
            <Vide>Toutes les couches sont masquées — réactivez Chokepoints ou Avions.</Vide>
          </div>
        )}
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
        </NoteSource>
      </div>
    </div>
  );
}
