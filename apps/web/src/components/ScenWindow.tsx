/**
 * Panneau « SCEN » — stress-test scénarios multi-facteurs, dockable (patron CorrWindow).
 *
 * Rassemble les positions OUVERTES du portefeuille + les positions paper (source « binance »,
 * cf. `brutesDepuisPaper`), les enrichit d'un bêta roulant 90 j vs leur facteur (BTC/ETH/DXY/
 * SPX/Or) via `collecterScen` (réseau, au premier open + « Recalculer β »), puis applique un
 * jeu de chocs éditables (sliders) : le P&L estimé se recalcule à CHAQUE changement de curseur
 * (PUR, synchrone via `useMemo` — aucun fetch). L'ampleur de la perte simulée est située par
 * rapport à la VaR 95 % du portefeuille.
 *
 * Modèle ASSUMÉ (spec) : P&L = poids · β · choc, approximation 1-facteur — ordres de grandeur.
 */
import { useEffect, useMemo, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { portfolioStore } from "../store/portfolio";
import { paperStore } from "../store/paper";
import { viderCacheSeries } from "../data/corr";
import {
  FACTEURS,
  PRESETS_SCEN,
  appliquerScenario,
  brutesDepuisPaper,
  brutesDepuisPortefeuille,
  collecterScen,
  mergePresetEnRecord,
  signatureBrutes,
  viderCacheFacteurs,
  type CollecteScen,
  type FacteurId,
  type ResultatScen,
} from "../data/scen";
import { formatDec, formatUsd, VALEUR_ABSENTE } from "../lib/format";
import { Badge, BoutonRafraichir, BTN_SECONDAIRE, Chargement, EnTeteFenetre, ErreurBloc, Fraicheur, NoteSource, Vide } from "./ui";

// ─────────────────────────── Store UI (vanilla, éphémère) ───────────────────────────

/**
 * Store d'ouverture du panneau SCEN — Zustand VANILLA (hors render-loop). Co-localisé ici
 * (patron CorrWindow) ; NON persisté. `mirrorOpenState` le synchronise avec le gestionnaire
 * de fenêtres (source de vérité), y compris sync immédiat au lazy-load du module.
 */
export interface ScenUiState {
  open: boolean;
  openScen: () => void;
  closeScen: () => void;
  toggleScen: () => void;
}

export const scenUiStore = createStore<ScenUiState>(() => ({
  open: false,
  openScen: () => windowManagerStore.getState().openWindow("scen"),
  closeScen: () => windowManagerStore.getState().closeWindow("scen"),
  toggleScen: () => windowManagerStore.getState().toggleWindow("scen"),
}));

mirrorOpenState("scen", scenUiStore);

// ─────────────────────────── Constantes (module) ───────────────────────────

/** Fenêtre des bêtas et de la VaR — FIXE en v1 (décision spec). */
const FENETRE_JOURS = 90;
/** Amplitude des chocs (%), commune au curseur ET à l'input numérique (restent synchronisés). */
const CHOC_MIN = -50;
const CHOC_MAX = 50;

/** Record de chocs tous à zéro : état initial et « Réinitialiser ». */
const CHOCS_ZERO: Record<FacteurId, number> = mergePresetEnRecord({});

/** Libellé lisible d'un facteur (badges / rangées). */
const LABEL_FACTEUR: Record<FacteurId, string> = Object.fromEntries(
  FACTEURS.map((f) => [f.id, f.label]),
) as Record<FacteurId, string>;

/** Borne un choc à l'amplitude des sliders (curseur et input numérique cohérents). */
function bornerChoc(v: number): number {
  return Math.max(CHOC_MIN, Math.min(CHOC_MAX, v));
}

// ─────────────────────────── Composant ───────────────────────────

export function ScenWindow() {
  const open = useStore(scenUiStore, (s) => s.open);
  // Abonnement par SIGNATURE structurelle (string), PAS par référence de tableau : le store
  // paper reconstruit son tableau `positions` à CHAQUE tick d'un symbole ayant une position
  // ouverte (data/paper.ts `evaluerTickDetaille` rebâtit `positionsRestantes`, même sur un tick
  // SANS exécution) — un abonnement direct à `s.positions` re-rendrait la fenêtre par tick et
  // relancerait la collecte en boucle. La signature est stable PAR VALEUR (Object.is sur strings)
  // : re-render UNIQUEMENT quand une position change réellement. Le portefeuille ne « ticke » pas
  // aujourd'hui, mais suit la même voie par SYMÉTRIE (robuste si une valorisation live y était
  // branchée plus tard).
  const sigPortefeuille = useStore(portfolioStore, (s) => signatureBrutes(brutesDepuisPortefeuille(s.positions)));
  const sigPaper = useStore(paperStore, (s) => signatureBrutes(brutesDepuisPaper(s.positions)));
  const signature = `${sigPortefeuille}#${sigPaper}`;

  const [chocs, setChocs] = useState<Record<FacteurId, number>>(CHOCS_ZERO);
  const [nonce, setNonce] = useState(0); // bump = re-collecte forcée (« Recalculer β »)
  const [collecte, setCollecte] = useState<CollecteScen | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);

  // Entrées brutes reconstruites via getState(), memoïsées sur la SIGNATURE : référence stable
  // tant que les valeurs des positions ne changent pas, insensible au churn de références des ticks.
  const brutes = useMemo(
    () => [
      ...brutesDepuisPortefeuille(portfolioStore.getState().positions),
      ...brutesDepuisPaper(paperStore.getState().positions),
    ],
    [signature],
  );
  const vide = brutes.length === 0;

  // Collecte au premier open + sur changement des positions ou « Recalculer β » (nonce). Le
  // drapeau `ignore` écarte les résultats d'une collecte périmée (course entre deux collectes).
  useEffect(() => {
    if (!open) return;
    if (brutes.length === 0) {
      setCollecte(null);
      setLoading(false);
      setErreur(null);
      return;
    }
    let ignore = false;
    setLoading(true);
    setErreur(null);
    void (async () => {
      try {
        const res = await collecterScen(brutes, FENETRE_JOURS);
        if (ignore) return;
        setCollecte(res);
        setMajTs(Date.now());
        setLoading(false);
      } catch {
        if (ignore) return;
        setErreur("Collecte des séries échouée.");
        setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [open, signature, nonce]);

  // Application du scénario : PURE & synchrone (aucun fetch) — se rejoue à chaque changement
  // de choc comme de collecte.
  const resultat = useMemo(
    () => (collecte === null ? null : appliquerScenario(collecte.positions, chocs)),
    [collecte, chocs],
  );

  const recalculer = () => {
    viderCacheFacteurs(); // séries facteurs (BTC/ETH/DXY/SPX/Or)
    viderCacheSeries(); // séries positions (cache corr partagé)
    setNonce((k) => k + 1);
  };

  const setChoc = (id: FacteurId, valeur: number) => {
    setChocs((c) => ({ ...c, [id]: bornerChoc(valeur) }));
  };

  return (
    <>
      <EnTeteFenetre
        mnemo="SCEN"
        titre="Stress-test"
        sousTitre={`Scénarios multi-facteurs · β ${FENETRE_JOURS} j · approximation 1-facteur`}
        actions={
          <>
            <Fraicheur loading={loading} majTs={majTs} />
            <BoutonRafraichir
              onClick={recalculer}
              libelle="Recalculer β"
              title="Vider les caches de séries et recalculer les bêtas"
            />
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {vide ? (
          <Vide>
            Aucune position ouverte (portefeuille + paper). Ouvrez une position pour lancer un stress-test.
          </Vide>
        ) : (
          <>
            {/* Presets + réinitialisation. */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PRESETS_SCEN.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setChocs(mergePresetEnRecord(p.chocs))}
                  className={BTN_SECONDAIRE}
                >
                  {p.label}
                </button>
              ))}
              <button type="button" onClick={() => setChocs(CHOCS_ZERO)} className={BTN_SECONDAIRE}>
                Réinitialiser
              </button>
            </div>

            {/* Une rangée par facteur : curseur + valeur % éditable. */}
            <div className="mb-4 space-y-2">
              {FACTEURS.map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[11px] text-text">{f.label}</span>
                  <input
                    type="range"
                    min={CHOC_MIN}
                    max={CHOC_MAX}
                    step={1}
                    value={chocs[f.id]}
                    onChange={(e) => setChoc(f.id, Number(e.target.value))}
                    aria-label={`Choc ${f.label} (%)`}
                    className="min-w-0 flex-1 accent-accent"
                  />
                  <input
                    type="number"
                    min={CHOC_MIN}
                    max={CHOC_MAX}
                    step={1}
                    value={chocs[f.id]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setChoc(f.id, Number.isFinite(n) ? n : 0);
                    }}
                    aria-label={`Choc ${f.label} en pourcentage`}
                    className="w-16 rounded border border-border bg-bg px-2 py-1 text-[11px] tabular-nums text-text"
                  />
                  <span className="text-[11px] text-text-dim">%</span>
                </div>
              ))}
            </div>

            {/* Résultats : « maj… » (Fraicheur) tant que la 1re collecte n'a pas abouti. */}
            {erreur !== null ? (
              <ErreurBloc>{erreur}</ErreurBloc>
            ) : collecte === null || resultat === null ? (
              <Chargement libelle="Collecte des séries 1 j…" />
            ) : (
              <ResultatsScen collecte={collecte} resultat={resultat} />
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Sous-vue Résultats ───────────────────────────

/** Table (position / facteur / β / P&L) + pied (total, couverture, jauge VaR) + exclusions. */
function ResultatsScen({ collecte, resultat }: { collecte: CollecteScen; resultat: ResultatScen }) {
  const { totalUsd, couvertUsd, sommeAbs } = resultat;
  const varUsd95 = collecte.varUsd95;
  // Ratio |perte| / VaR (null si VaR incalculable ou nulle → évite la division par 0 = Infinity).
  const ratio = varUsd95 !== null && varUsd95 > 0 ? Math.abs(totalUsd) / varUsd95 : null;

  return (
    <div className="space-y-3">
      {/* Table par position. */}
      <div className="rounded-md border border-border bg-bg px-2.5 py-2">
        <div className="mb-1.5 grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-[9px] uppercase tracking-wider text-text-dim">
          <span>Position</span>
          <span className="text-right">Facteur</span>
          <span className="text-right">β</span>
          <span className="text-right">P&amp;L</span>
        </div>
        {resultat.lignes.map((l, i) => {
          const pl = l.plUsd;
          return (
            <div
              key={`${l.position.symbole}-${i}`}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-0.5 text-[11px] tabular-nums"
            >
              <span className="truncate font-medium text-text">{l.position.symbole}</span>
              <span className="flex justify-end">
                <Badge>{LABEL_FACTEUR[l.position.facteur]}</Badge>
              </span>
              <span className="text-right text-text-dim">
                {l.position.beta === null ? "indispo" : formatDec(l.position.beta, 2)}
              </span>
              <span
                className={`text-right ${
                  pl === null ? "text-text-dim" : pl > 0 ? "text-up" : pl < 0 ? "text-down" : "text-text-dim"
                }`}
              >
                {pl === null ? VALEUR_ABSENTE : `${pl > 0 ? "+" : ""}${formatUsd(pl)}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Pied : total + couverture + jauge VaR. */}
      <div className="rounded-md border border-border bg-bg px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-text-dim">P&amp;L estimé total</span>
          <span
            className={`tabular-nums text-sm font-medium ${
              totalUsd > 0 ? "text-up" : totalUsd < 0 ? "text-down" : "text-text"
            }`}
          >
            {totalUsd > 0 ? "+" : ""}
            {formatUsd(totalUsd)}
          </span>
        </div>
        {couvertUsd < sommeAbs && sommeAbs > 0 && (
          <div className="mt-0.5 text-[10px] text-text-dim">
            couvre {((couvertUsd / sommeAbs) * 100).toFixed(0)} % du notionnel (positions à β estimable)
          </div>
        )}

        {ratio !== null && (
          <div className="mt-2">
            {/* « Ampleur » (pas « perte ») : un scénario favorable donne un P&L positif. */}
            <div className="flex items-baseline justify-between text-[10px] text-text-dim">
              <span>Ampleur estimée vs VaR 95 % · {FENETRE_JOURS} j</span>
              <span className="tabular-nums">
                {formatUsd(Math.abs(totalUsd))} / {formatUsd(varUsd95)} · {ratio.toFixed(2)}×
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded border border-border bg-bg">
              <div
                className={`h-full ${ratio >= 1 ? "bg-warn" : "bg-text-dim"}`}
                style={{ width: `${Math.min(ratio, 1) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Exclusions annotées (β indisponible). */}
      {collecte.exclues.length > 0 && (
        <div className="rounded-md border border-border bg-bg px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
            Exclues du calcul ({collecte.exclues.length})
          </div>
          <div className="space-y-0.5">
            {collecte.exclues.map((e, i) => (
              <div key={`${e.symbole}-${i}`} className="flex justify-between gap-2 text-[10px]">
                <span className="truncate text-text">{e.symbole}</span>
                <span className="shrink-0 text-text-dim">{e.raison}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <NoteSource>β {FENETRE_JOURS} j vs facteur · approximation 1-facteur · prix = dernier close 1 j.</NoteSource>
    </div>
  );
}
