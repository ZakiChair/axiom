/**
 * Panneau « ECO » — calendrier économique, dockable à droite, NON MODAL (pas d'overlay).
 *
 * Suit le pattern DerivativesWindow : le graphe reste interactif pendant l'affichage.
 * Ouverture via le mnémonique ECO (toggle) ou le bouton de la Toolbar. Liste chronologique
 * (à venir en tête) : heure locale, pays, évènement, badge d'impact, prévision/précédent/
 * actuel. Filtres impact + pays, rafraîchissement discret, et bascule des marqueurs
 * verticaux « fort impact » sur le chart.
 *
 * Import à effet de bord `../chart/ecoMarkers` : démarre le contrôleur de marqueurs pour
 * la session (le composant étant monté en permanence au niveau App, comme DerivativesWindow).
 *
 * Sans réseau : dégradation propre (au moins les dates FOMC statiques + le cache) — jamais
 * d'erreur bloquante ni de boucle console.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { ecoStore, ECO_IMPACTS } from "../store/eco";
import type { EcoEvent, EcoImpact } from "../data/eco";
import { EnTeteFenetre } from "./ui";
import "../chart/ecoMarkers";

/** Libellé court FR d'un impact. */
const IMPACT_LABEL: Record<EcoImpact, string> = {
  high: "Fort",
  medium: "Moyen",
  low: "Faible",
  holiday: "Férié",
};

/** Couleur du badge d'impact — tokens de thème (var(--…)) pour suivre le thème courant. */
const IMPACT_COLOR: Record<EcoImpact, string> = {
  high: "var(--down)",
  medium: "var(--serie-3)",
  low: "var(--text-dim)",
  holiday: "var(--serie-6)",
};

/** Fenêtre de contexte passé conservée en tête de liste (6 h). */
const CONTEXTE_PASSE_MS = 6 * 60 * 60 * 1000;

/** Formate l'horodatage en heure LOCALE (jour court + date + heure). */
function formatEcheance(time: number, approx: boolean | undefined): string {
  const s = new Date(time).toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return approx ? `~${s}` : s;
}

/**
 * Badge d'impact coloré. FORT est REMPLI (encre = var(--accent-ink)) pour être le plus
 * proéminent à repérer et se distinguer nettement de MOYEN — de teinte voisine dans la
 * famille rouge/rose, surtout en thème clair (audit #23). MOYEN/FAIBLE/FÉRIÉ : contour.
 */
function ImpactBadge({ impact }: { impact: EcoImpact }) {
  const color = IMPACT_COLOR[impact];
  const rempli = impact === "high";
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={
        rempli
          ? { color: "var(--accent-ink)", background: color, borderColor: color, border: "1px solid" }
          : { color, borderColor: color, border: "1px solid" }
      }
    >
      {IMPACT_LABEL[impact]}
    </span>
  );
}

/** Une valeur libellée (prévision / précédent / actuel), masquée si absente. */
function Valeur({ label, value, accent }: { label: string; value?: string; accent?: boolean }) {
  if (value === undefined) return null;
  return (
    <span className="whitespace-nowrap">
      <span className="text-text-dim">{label} </span>
      <span className={accent ? "font-medium text-text" : "text-text"}>{value}</span>
    </span>
  );
}

/** Une ligne d'évènement. */
function Ligne({ ev, passe }: { ev: EcoEvent; passe: boolean }) {
  return (
    <div
      className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-border px-3 py-2 ${
        passe ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-col items-start gap-1">
        <span className="whitespace-nowrap tabular-nums text-[11px] text-text-dim">
          {formatEcheance(ev.time, ev.timeApprox)}
        </span>
        <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-medium text-text-dim">
          {ev.country}
        </span>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs leading-snug text-text">{ev.title}</span>
          <ImpactBadge impact={ev.impact} />
        </div>
        {(ev.actual !== undefined || ev.forecast !== undefined || ev.previous !== undefined) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
            <Valeur label="Act." value={ev.actual} accent />
            <Valeur label="Prév." value={ev.forecast} />
            <Valeur label="Préc." value={ev.previous} />
          </div>
        )}
      </div>
    </div>
  );
}

export function EcoWindow() {
  const open = useStore(ecoStore, (s) => s.open);
  const events = useStore(ecoStore, (s) => s.events);
  const status = useStore(ecoStore, (s) => s.status);
  const error = useStore(ecoStore, (s) => s.error);
  const brideDebit = useStore(ecoStore, (s) => s.brideDebit);
  const impacts = useStore(ecoStore, (s) => s.impacts);
  const pays = useStore(ecoStore, (s) => s.pays);
  const markersEnabled = useStore(ecoStore, (s) => s.markersEnabled);

  // Charge le calendrier à l'ouverture (idempotent : `refresh` sert le cache 12 h sans
  // requête réseau si frais — respecte « 1 poll par session »).
  useEffect(() => {
    if (open && status === "idle") ecoStore.getState().refresh(false);
  }, [open, status]);

  // Pays disponibles pour le filtre (dérivé des évènements chargés).
  const paysDispo = Array.from(new Set(events.map((e) => e.country))).sort();

  // Liste filtrée : contexte passé récent + à venir, tri chronologique (déjà ascendant).
  const now = Date.now();
  const cutoff = now - CONTEXTE_PASSE_MS;
  const filtres = events.filter(
    (e) => e.time >= cutoff && impacts[e.impact] && (pays === null || e.country === pays)
  );

  return (
    // Panneau dockable à droite, NON MODAL (cf. DerivativesWindow). Fermé : translaté
    // hors écran + inerte (pointer-events-none). z-40 : au-dessus du graphe, sous la palette.
    <>
      <EnTeteFenetre
        titre="ECO · Calendrier"
        sousTitre={
          <>
            ForexFactory · FRED · FOMC
            {status === "loading" ? " · maj…" : ""}
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => ecoStore.getState().refresh(true)}
            aria-label="Rafraîchir le calendrier"
            title="Rafraîchir"
            className="rounded p-1 text-sm leading-none text-text-dim transition hover:bg-bg hover:text-text"
          >
            ⟳
          </button>
        }
      />

      {/* Barre de filtres + bascule marqueurs. */}
      <div className="space-y-2 border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {ECO_IMPACTS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => ecoStore.getState().toggleImpact(i)}
              className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide transition ${
                impacts[i]
                  ? "border-border bg-bg text-text"
                  : "border-transparent text-text-dim hover:text-text"
              }`}
              style={impacts[i] ? { color: IMPACT_COLOR[i] } : undefined}
            >
              {IMPACT_LABEL[i]}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <select
            value={pays ?? ""}
            onChange={(e) => ecoStore.getState().setPays(e.target.value || null)}
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-text"
            aria-label="Filtrer par pays"
          >
            <option value="">Tous pays</option>
            {paysDispo.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-text-dim">
            <input
              type="checkbox"
              checked={markersEnabled}
              onChange={() => ecoStore.getState().toggleMarkers()}
              className="accent-[color:var(--serie-3)]"
            />
            Marqueurs chart
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {brideDebit && (
          <div className="px-3 py-2 text-[11px] text-text-dim">
            Débit limité (2 requêtes / 5 min) — affichage du dernier cache.
          </div>
        )}
        {error && (
          <div className="border-b border-down/40 px-3 py-2 text-[11px] text-down">{error}</div>
        )}
        {filtres.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-dim">
            {status === "loading" ? "Chargement…" : "Aucun évènement pour ces filtres."}
          </div>
        ) : (
          filtres.map((ev) => <Ligne key={ev.id} ev={ev} passe={ev.time < now} />)
        )}
      </div>
    </>
  );
}
