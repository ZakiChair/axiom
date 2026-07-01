/**
 * HealthPanel — section sidebar « Santé sources » (panneau de DIAGNOSTIC).
 *
 * Une ligne par source RÉELLEMENT utilisée dans la session (= chaque entrée du
 * `healthStore`, alimenté par les adaptateurs WS et les pollers) : pastille d'état,
 * nom, âge du dernier message, quota si connu, dernière erreur en tooltip.
 *
 * Contraintes de perf (cf. BUILD-CONTRACT « pas de re-render sur tick ») :
 *  - le composant ne se re-rend QUE lorsque la composition / l'état / le quota des
 *    sources change (signature stable qui EXCLUT `dernierMessageTs`) ; jamais sur le
 *    flot de messages WS (throttlés mais ~1/s) ;
 *  - l'âge (« il y a 12 s ») est réécrit IMPÉRATIVEMENT dans le DOM à 1 Hz via des
 *    refs, sans passer par le state React.
 *
 * Sobre et dense (11px comme le reste de la sidebar) ; couleurs via tokens de thème
 * uniquement (aucun hex en dur).
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { healthStore, type EtatSource, type QuotaSource, type SanteSource } from "../store/health";
import { SidebarSection } from "./SidebarSection";

/** Classe de fond (token de thème) de la pastille d'état. */
const DOT_BY_ETAT: Record<EtatSource, string> = {
  connected: "bg-up", // vert : flux normal
  stale: "bg-amber-500", // orange : silencieux (watchdog)
  reconnecting: "bg-amber-500", // orange : (re)connexion en cours
  error: "bg-down", // rouge : dernier cycle/évènement en erreur
  polling: "bg-text-dim", // bleu-gris : source REST pollée
  closed: "bg-neutral-600", // gris éteint : désabonnée
};

/** Classe de la pastille pour un état donné. PURE. */
export function dotClass(etat: EtatSource): string {
  return DOT_BY_ETAT[etat];
}

/** Noms lisibles des sources (préfixe = exchange/fournisseur). */
const SOURCE_NAMES: Record<string, string> = {
  binance: "Binance",
  kraken: "Kraken",
  coinbase: "Coinbase",
  mexc: "MEXC",
  twelvedata: "Twelve Data",
  coinalyze: "Coinalyze",
};

/**
 * Libellé d'une source « <base>[:<canal>] » → « Nom · canal ». PURE.
 * Ex. "binance:trades" → "Binance · trades" ; "coinalyze" → "Coinalyze".
 */
export function sourceLabel(source: string): string {
  const [base, canal] = source.split(":");
  const name = SOURCE_NAMES[base ?? ""] ?? base ?? source;
  return canal ? `${name} · ${canal}` : name;
}

/**
 * Âge lisible du dernier message (« il y a 12 s / 3 min / 2 h / 4 j »). PURE.
 * `ts` = ms epoch du dernier message (0/invalide → « — », jamais reçu).
 */
export function formatAge(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/** Abréviation d'affichage des fenêtres de quota. */
const FENETRE_ABBR: Record<string, string> = { "1min": "min", "1hour": "h", "1jour": "j", "1day": "j" };

/**
 * Quota lisible : « 3/8 min » (fenêtre principale) + « · 142/800 j » si composante
 * journalière connue (Twelve Data). PURE.
 */
export function formatQuota(q: QuotaSource): string {
  const unit = FENETRE_ABBR[q.fenetre] ?? q.fenetre;
  const base = `${q.utilise}/${q.limite} ${unit}`;
  return q.jour ? `${base} · ${q.jour.utilise}/${q.jour.limite} j` : base;
}

/**
 * Pire niveau de dégradation du registre (pour le badge global). PURE.
 *  - « error » : au moins une source en erreur ;
 *  - « warn »  : au moins une source stale/reconnecting (mais aucune en erreur) ;
 *  - null      : tout va bien (connected/polling/closed).
 */
export function degradedLevel(sources: Record<string, SanteSource>): "error" | "warn" | null {
  let warn = false;
  for (const s of Object.values(sources)) {
    if (s.etat === "error") return "error";
    if (s.etat === "stale" || s.etat === "reconnecting") warn = true;
  }
  return warn ? "warn" : null;
}

/**
 * Signature de re-rendu : change quand la composition, l'état, le quota ou l'erreur
 * d'une source change — mais PAS quand seul `dernierMessageTs` bouge (géré en DOM).
 */
function panelSignature(sources: Record<string, SanteSource>): string {
  return Object.keys(sources)
    .sort()
    .map((k) => {
      const s = sources[k];
      if (!s) return k;
      const q = s.quota ? `${s.quota.utilise}/${s.quota.limite}/${s.quota.jour?.utilise ?? ""}` : "";
      return `${k}|${s.etat}|${q}|${s.derniereErreur ?? ""}`;
    })
    .join(";");
}

/** Enregistre/retire la cellule DOM « âge » d'une source (callback de ref). */
function registerAgeCell(
  map: Map<string, HTMLSpanElement>,
  source: string,
  el: HTMLSpanElement | null
): void {
  if (el) map.set(source, el);
  else map.delete(source);
}

/** Point d'alerte affiché dans l'en-tête de section (visible même repliée). */
function BadgeDot({ level }: { level: "error" | "warn" }) {
  return (
    <span
      aria-hidden
      title={level === "error" ? "Une source en erreur" : "Une source dégradée"}
      className={`inline-block h-1.5 w-1.5 rounded-full align-middle ${
        level === "error" ? "bg-down" : "bg-amber-500"
      }`}
    />
  );
}

export function HealthPanel() {
  // Re-rendu piloté par la signature (hors `dernierMessageTs`) — cf. en-tête.
  const signature = useStore(healthStore, (s) => panelSignature(s.sources));

  // Cellules DOM « âge », mises à jour à 1 Hz sans re-render.
  const ageCells = useRef(new Map<string, HTMLSpanElement>());
  useEffect(() => {
    const tick = (): void => {
      const now = Date.now();
      const { sources } = healthStore.getState();
      for (const [source, el] of ageCells.current) {
        el.textContent = formatAge(sources[source]?.dernierMessageTs ?? 0, now);
      }
    };
    tick(); // valeur initiale immédiate (nouvelles lignes)
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [signature]); // re-arme quand la liste/état des sources change (refs renouvelées)

  // Lu frais à chaque rendu : le rendu est déclenché par la signature ci-dessus.
  const sources = healthStore.getState().sources;
  const rows = Object.values(sources).sort((a, b) => a.source.localeCompare(b.source));
  const badge = degradedLevel(sources);

  return (
    <SidebarSection
      title="Santé sources"
      collapsible
      defaultOpen={false}
      badge={badge ? <BadgeDot level={badge} /> : undefined}
    >
      <div className="px-3 py-1.5">
        {rows.length === 0 ? (
          <p className="py-1 text-[11px] text-text-dim">Aucune source active.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((s) => (
              <li
                key={s.source}
                title={s.derniereErreur ?? undefined}
                className="flex items-center gap-2 text-[11px] leading-tight"
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(s.etat)}`}
                />
                <span className="min-w-0 flex-1 truncate text-text">{sourceLabel(s.source)}</span>
                {s.quota && (
                  <span className="shrink-0 tabular-nums text-text-dim">{formatQuota(s.quota)}</span>
                )}
                <span
                  ref={(el) => registerAgeCell(ageCells.current, s.source, el)}
                  className="shrink-0 tabular-nums text-text-dim"
                >
                  —
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SidebarSection>
  );
}
