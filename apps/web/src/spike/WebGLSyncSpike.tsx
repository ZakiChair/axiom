/**
 * WebGLSyncSpike — M4 : SPIKE de faisabilité (risque n°1 de l'architecture AXIOM).
 *
 * Objectif : PROUVER qu'un overlay WebGL autonome (canvas séparé, superposé) peut
 * rester aligné au pixel près sur l'échelle temps/prix de KLineChart pendant
 * pan / zoom / resize — AVANT de bâtir l'orderflow (M5).
 *
 * Principe :
 *  1. Un KLineChart classique (backfill Binance, repli synthétique hors-ligne).
 *  2. Un <canvas> WebGL BRUT (aucun regl/PixiJS) superposé, `pointer-events:none`
 *     pour laisser passer pan/zoom vers le graphe.
 *  3. À chaque frame (rAF) ET à chaque event de viewport (subscribeAction
 *     onScroll/onZoom/onVisibleRangeChange), on relit la position pixel de deux
 *     ancres FIXES (un prix, un timestamp) via `chart.convertToPixel(...)` puis on
 *     redessine en WebGL une ligne horizontale (prix) et une ligne verticale (temps).
 *  4. Référence « vérité terrain » : deux overlays NATIFS KLineChart
 *     (horizontalStraightLine / verticalStraightLine) aux MÊMES ancres, dessinés
 *     par le moteur du graphe lui-même. Si la gestion DPR / viewport WebGL est
 *     correcte, la ligne cyan (WebGL) recouvre exactement la ligne jaune (native).
 *  5. Un panneau de MESURE affiche l'écart pixel (cohérence d'axe, indépendant) et
 *     les compteurs d'events — mis à jour hors render-loop React (textContent direct).
 *
 * Montage isolé : visible uniquement sur `#spike` (cf. main.tsx). N'utilise AUCUN
 * store @axiom (market/indicators) pour ne pas interférer avec le graphe M1/M3.
 */
import { useEffect, useRef } from "react";
import { init, dispose, ActionType, DomPosition } from "klinecharts";
import type { KLineData, Point } from "klinecharts";
import { binanceAdapter } from "../data/binance";

/** Pane principal des bougies (id par défaut de KLineChart). */
const CANDLE_PANE_ID = "candle_pane";
const SYMBOL = "BTCUSDT";
const TIMEFRAME = "1m";

/** Bougie minimale exploitée par le spike (sous-ensemble de @axiom/types Candle). */
interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Coordonnée renvoyée par convertToPixel (x et y optionnels selon l'entrée). */
interface PixelXY {
  x?: number;
  y?: number;
}

/** Bar -> KLineData (KLineChart). */
function toKLineData(b: Bar): KLineData {
  return {
    timestamp: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  };
}

/**
 * Backfill : Binance REST en priorité, repli synthétique (marche aléatoire) si le
 * réseau est indisponible — le spike doit pouvoir s'ouvrir hors-ligne pour vérif.
 */
async function loadBars(): Promise<Bar[]> {
  try {
    return await binanceAdapter.fetchKlines(SYMBOL, TIMEFRAME, { limit: 500 });
  } catch (err) {
    console.warn("[SPIKE] Backfill Binance indisponible, repli synthétique", err);
    const bars: Bar[] = [];
    const tfMs = 60_000;
    const now = Date.now();
    let price = 60_000;
    for (let i = 0; i < 500; i += 1) {
      const open = price;
      const drift = (Math.sin(i / 9) + (Math.random() - 0.5) * 1.4) * 80;
      const close = open + drift;
      const high = Math.max(open, close) + Math.random() * 40;
      const low = Math.min(open, close) - Math.random() * 40;
      bars.push({
        time: now - (500 - i) * tfMs,
        open,
        high,
        low,
        close,
        volume: 10 + Math.random() * 5,
      });
      price = close;
    }
    return bars;
  }
}

/** Compile un shader ; lève en cas d'échec (capturé par l'appelant). */
function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader a renvoyé null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Compilation shader échouée : ${log ?? "?"}`);
  }
  return shader;
}

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;
const FRAGMENT_SRC = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }
`;

export function WebGLSyncSpike() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const chartDom = chartRef.current;
    const canvas = canvasRef.current;
    const panel = panelRef.current;
    if (!container || !chartDom || !canvas || !panel) return;

    // 1) Graphe ------------------------------------------------------------
    const chart = init(chartDom);
    if (!chart) return;
    chart.setStyles({
      grid: { horizontal: { color: "#1f2937" }, vertical: { color: "#1f2937" } },
      xAxis: { tickText: { color: "#9ca3af" } },
      yAxis: { tickText: { color: "#9ca3af" } },
    });

    // 2) Contexte WebGL ----------------------------------------------------
    const gl = canvas.getContext("webgl", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      panel.textContent = "WebGL indisponible dans ce navigateur — spike impossible.";
      dispose(chart);
      return;
    }

    // Programme : positions en NDC -> couleur unie.
    let program: WebGLProgram;
    let aPos: number;
    let uColor: WebGLUniformLocation;
    let buffer: WebGLBuffer;
    try {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
      const prog = gl.createProgram();
      if (!prog) throw new Error("createProgram a renvoyé null");
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`Link programme échoué : ${gl.getProgramInfoLog(prog) ?? "?"}`);
      }
      const loc = gl.getUniformLocation(prog, "u_color");
      const buf = gl.createBuffer();
      if (!loc || !buf) throw new Error("Uniform/buffer introuvable");
      program = prog;
      aPos = gl.getAttribLocation(prog, "a_pos");
      uColor = loc;
      buffer = buf;
    } catch (err) {
      panel.textContent = `Init WebGL échouée : ${String(err)}`;
      dispose(chart);
      return;
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Dimensions CSS courantes + backing-store en pixels physiques (DPR).
    let cssW = container.clientWidth;
    let cssH = container.clientHeight;
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    function resizeBacking() {
      cssW = container!.clientWidth;
      cssH = container!.clientHeight;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      // KLineChart renvoie des pixels CSS ; on applique le DPR nous-mêmes côté GPU.
      canvas!.width = Math.round(cssW * dpr);
      canvas!.height = Math.round(cssH * dpr);
      canvas!.style.width = `${cssW}px`;
      canvas!.style.height = `${cssH}px`;
    }
    resizeBacking();

    // 3) État du spike -----------------------------------------------------
    const counters = { scroll: 0, zoom: 0, range: 0 };
    let frames = 0;
    let lastFpsAt = performance.now();
    let fps = 0;

    let ready = false;
    let fixedPrice = 0;
    let fixedTs = 0;
    let anchorIdx = 0;
    let priceDelta = 1;

    // px (depuis le coin haut-gauche du conteneur) -> NDC [-1, 1].
    const ndcX = (px: number) => (px / cssW) * 2 - 1;
    const ndcY = (px: number) => 1 - (px / cssH) * 2;

    /** Lecture de la position pixel d'une ancre via l'API officielle KLineChart. */
    const toPx = (point: Partial<Point>): PixelXY =>
      chart.convertToPixel(point, {
        paneId: CANDLE_PANE_ID,
        absolute: true,
      }) as PixelXY;

    /** Empile un rectangle (px) sous forme de 2 triangles (6 sommets) en NDC. */
    function pushQuad(out: number[], x0: number, y0: number, x1: number, y1: number) {
      const ax = ndcX(x0);
      const ay = ndcY(y0);
      const bx = ndcX(x1);
      const by = ndcY(y1);
      out.push(ax, ay, bx, ay, bx, by, ax, ay, bx, by, ax, by);
    }

    /** Une frame : relit les positions d'axe, redessine WebGL, met à jour les mesures. */
    const render = () => {
      if (!ready) return;

      // --- Positions « vérité » via convertToPixel (px CSS) ---
      const yRef = toPx({ value: fixedPrice }).y ?? 0;
      const xRef = toPx({ timestamp: fixedTs }).x ?? 0;

      // Bornes de l'aire de dessin principale (exclut l'axe Y à droite, l'axe X en bas).
      const main = chart.getSize(CANDLE_PANE_ID, DomPosition.Main);
      const left = main?.left ?? 0;
      const top = main?.top ?? 0;
      const mainW = main?.width ?? cssW;
      const mainH = main?.height ?? cssH;
      const thick = 1.5; // épaisseur CSS px (fine : la ligne native jaune doit dépasser).

      // --- Dessin WebGL ---
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.useProgram(program);

      const verts: number[] = [];
      // Ligne horizontale au prix fixe (s'étend sur la largeur de l'aire principale).
      pushQuad(verts, left, yRef - thick / 2, left + mainW, yRef + thick / 2);
      // Ligne verticale au timestamp fixe (s'étend sur la hauteur de l'aire principale).
      pushQuad(verts, xRef - thick / 2, top, xRef + thick / 2, top + mainH);

      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
      gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array(verts), gl!.DYNAMIC_DRAW);
      gl!.enableVertexAttribArray(aPos);
      gl!.vertexAttribPointer(aPos, 2, gl!.FLOAT, false, 0, 0);
      gl!.uniform4f(uColor, 0.0, 0.92, 1.0, 0.95); // cyan
      gl!.drawArrays(gl!.TRIANGLES, 0, verts.length / 2);

      // --- MESURE PRINCIPALE : position DESSINÉE en WebGL vs position réelle de l'axe ---
      // On reprojette le pipeline GPU réellement utilisé (px CSS -> NDC -> pixel device
      // via canvas.width/height -> retour CSS via DPR) puis on le compare à yRef/xRef
      // (convertToPixel, là où se trouve la ligne native). ≈ 0 si DPR/viewport corrects ;
      // dériverait immédiatement si l'un d'eux décrochait (ex. backing-store sans DPR).
      const cssYBack = ((canvas!.height * (1 - ndcY(yRef))) / 2) / dpr;
      const cssXBack = ((canvas!.width * (ndcX(xRef) + 1)) / 2) / dpr;
      const ecartWebGLy = Math.abs(cssYBack - yRef);
      const ecartWebGLx = Math.abs(cssXBack - xRef);

      // --- MESURE secondaire : cohérence interne de l'axe ---
      // L'axe prix/temps de KLineChart est linéaire : le pixel du point central doit
      // être la moyenne des pixels de deux points encadrants (reconstruction indépendante).
      const yA = toPx({ value: fixedPrice - priceDelta }).y ?? 0;
      const yB = toPx({ value: fixedPrice + priceDelta }).y ?? 0;
      const ecartV = Math.abs((yA + yB) / 2 - yRef);

      const xByIdx = toPx({ dataIndex: anchorIdx }).x ?? 0;
      const xA = toPx({ dataIndex: anchorIdx - 10 }).x ?? 0;
      const xB = toPx({ dataIndex: anchorIdx + 10 }).x ?? 0;
      const ecartH = Math.abs((xA + xB) / 2 - xByIdx);

      // Cohérence timestamp <-> dataIndex : les deux voies doivent donner le même x.
      const ecartTs = Math.abs(xRef - xByIdx);

      panel.textContent =
        `AXIOM · M4 SPIKE — sync overlay WebGL ↔ KLineChart\n` +
        `cyan = WebGL (convertToPixel)   jaune = overlay NATIF KLineChart\n` +
        `Doivent se RECOUVRIR pendant pan / zoom / resize.\n` +
        `──────────────────────────────────────────────\n` +
        `prix fixe   : ${fixedPrice.toFixed(2)}   -> y = ${yRef.toFixed(2)} px\n` +
        `ts fixe     : ${new Date(fixedTs).toISOString().slice(11, 19)}  -> x = ${xRef.toFixed(2)} px\n` +
        `DPR         : ${dpr}      canvas : ${canvas!.width}×${canvas!.height} px\n` +
        `──────────────────────────────────────────────\n` +
        `écart WebGL↔axe   V=${ecartWebGLy.toFixed(4)}  H=${ecartWebGLx.toFixed(4)} px  ← MESURE\n` +
        `cohérence axe     V=${ecartV.toFixed(4)}  H=${ecartH.toFixed(4)} px\n` +
        `timestamp↔index   ${ecartTs.toFixed(4)} px\n` +
        `(recouvrement visuel cyan↔jaune = preuve DPR à l'écran)\n` +
        `──────────────────────────────────────────────\n` +
        `events  onScroll=${counters.scroll}  onZoom=${counters.zoom}  onRange=${counters.range}\n` +
        `rAF     ${fps} fps`;
    };

    // 4) Boucle rAF (filet de sécurité : couvre tout, y compris resize/anim). ----
    let raf = 0;
    const loop = () => {
      render();
      frames += 1;
      const now = performance.now();
      if (now - lastFpsAt >= 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsAt));
        frames = 0;
        lastFpsAt = now;
      }
      raf = requestAnimationFrame(loop);
    };

    // 5) Redessin SYNCHRONE sur events de viewport -> tracking verrouillé (0 lag). -
    const onScroll = () => {
      counters.scroll += 1;
      render();
    };
    const onZoom = () => {
      counters.zoom += 1;
      render();
    };
    const onRange = () => {
      counters.range += 1;
      render();
    };
    chart.subscribeAction(ActionType.OnScroll, onScroll);
    chart.subscribeAction(ActionType.OnZoom, onZoom);
    chart.subscribeAction(ActionType.OnVisibleRangeChange, onRange);

    // 6) Resize : graphe + backing-store WebGL suivent le conteneur. ------------
    const resizeObserver = new ResizeObserver(() => {
      resizeBacking();
      chart.resize();
    });
    resizeObserver.observe(container);

    // 7) Données + ancres + overlays natifs de référence. ----------------------
    let cancelled = false;
    loadBars()
      .then((bars) => {
        if (cancelled) return;
        chart.applyNewData(bars.map(toKLineData));

        // Ancre visible d'emblée (proche du bord droit), avec marge pour ±10 barres.
        anchorIdx = Math.min(Math.max(15, bars.length - 80), bars.length - 11);
        const anchor = bars[anchorIdx];
        if (!anchor) return;
        fixedPrice = anchor.close;
        fixedTs = anchor.time;

        let hi = -Infinity;
        let lo = Infinity;
        for (const b of bars) {
          if (b.high > hi) hi = b.high;
          if (b.low < lo) lo = b.low;
        }
        priceDelta = (hi - lo) * 0.08 || 1;

        // Vérité terrain : dessinées par le moteur KLineChart lui-même, mêmes ancres.
        chart.createOverlay({
          name: "horizontalStraightLine",
          lock: true,
          points: [{ value: fixedPrice }],
          styles: { line: { color: "#facc15", size: 2 } },
        });
        chart.createOverlay({
          name: "verticalStraightLine",
          lock: true,
          points: [{ timestamp: fixedTs, dataIndex: anchorIdx }],
          styles: { line: { color: "#facc15", size: 2 } },
        });

        ready = true;
      })
      .catch((err) => {
        panel.textContent = `Échec chargement données : ${String(err)}`;
      });

    raf = requestAnimationFrame(loop);

    // 8) Démontage (StrictMode double-invoque en dev : teardown complet obligatoire).
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      chart.unsubscribeAction(ActionType.OnScroll, onScroll);
      chart.unsubscribeAction(ActionType.OnZoom, onZoom);
      chart.unsubscribeAction(ActionType.OnVisibleRangeChange, onRange);
      resizeObserver.disconnect();
      // NB : on ne force PAS loseContext() ici. En dev, StrictMode démonte puis
      // remonte sur le MÊME <canvas> : un contexte « perdu » serait réutilisé mort
      // au remontage (shaders incompilables). Le contexte est libéré par le GC quand
      // le canvas quitte le DOM au vrai démontage.
      dispose(chart);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-200">
      <div className="border-b border-neutral-800 px-4 py-2 text-sm font-semibold text-cyan-300">
        AXIOM — M4 SPIKE · faisabilité sync overlay WebGL ↔ KLineChart
      </div>
      {/* Conteneur de référence : convertToPixel(absolute) renvoie des px relatifs à lui. */}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <div ref={chartRef} className="absolute inset-0" />
        {/* Overlay WebGL : pointer-events:none -> pan/zoom passent au graphe. */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0"
        />
        <pre
          ref={panelRef}
          className="pointer-events-none absolute left-3 top-3 m-0 whitespace-pre rounded bg-black/70 px-3 py-2 font-mono text-[11px] leading-tight text-emerald-300"
        >
          chargement…
        </pre>
      </div>
    </div>
  );
}
