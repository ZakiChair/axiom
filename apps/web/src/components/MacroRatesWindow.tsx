/**
 * Fenêtre « RATE » — Taux & Réserves souveraines. Dockable à droite, NON MODALE.
 *
 * UN panneau unifié (décision produit : pas trois fenêtres séparées) à TROIS sections :
 *   1. Rendements obligataires souverains — courbe US (home.treasury.gov) + zone euro
 *      AAA (ECB SDMX), avec variation jour-sur-jour colorée et écart 2s10s (inversion).
 *   2. Taux directeurs — Fed / BCE / BoE / BoJ / BNS en un seul appel BIS WS_CBPOL.
 *   3. Réserves d'or par pays — classement en tonnes (IMF SDMX 3.0 IRFCL).
 *
 * Données LENTES (quotidiennes/mensuelles) : elles vivent dans le state React et sont
 * chargées PARESSEUSEMENT à la première consultation de chaque onglet (aucun refetch à la
 * réouverture — le composant reste monté). Dégradation gracieuse : chaque source dégrade
 * indépendamment vers un état « indisponible » lisible, jamais d'exception bloquante.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Commande } from "../commands/registry";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import {
  chargerRendementsSouverains,
  deltaJour,
  MATURITES_US,
  spread2s10s,
  type RendementsSouverains,
} from "../data/macro/treasuryYields";
import { chargerTauxDirecteurs, type TauxDirecteur } from "../data/macro/policyRates";
import { chargerReservesOr, type ReserveOr } from "../data/macro/goldReserves";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface MacroRatesUiState {
  open: boolean;
  openMacroRates: () => void;
  closeMacroRates: () => void;
  toggleMacroRates: () => void;
}

export const macroRatesUiStore = createStore<MacroRatesUiState>(() => ({
  open: false,
  openMacroRates: () => windowManagerStore.getState().openWindow("macroRates"),
  closeMacroRates: () => windowManagerStore.getState().closeWindow("macroRates"),
  toggleMacroRates: () => windowManagerStore.getState().toggleWindow("macroRates"),
}));

mirrorOpenState("macroRates", macroRatesUiStore);

/** Commandes exposées à la palette (⌘K) — greffées par App.tsx via `enregistrerCommandes`. */
export const commandes: Commande[] = [
  {
    id: "panneau:macroRates",
    mnemonique: "RATE",
    libelle: "Taux & Réserves souveraines",
    categorie: "panneau",
    motsCles: [
      "taux",
      "rendements",
      "obligations",
      "souverain",
      "treasury",
      "bund",
      "banque centrale",
      "fed",
      "bce",
      "ecb",
      "or",
      "gold",
      "reserves",
      "2s10s",
    ],
    apercu: "Ouvre / ferme les taux souverains, directeurs et réserves d'or",
    action: () => macroRatesUiStore.getState().toggleMacroRates(),
  },
];

// ─────────────────────────── Helpers de format (purs) ───────────────────────────

const fmtTonnes = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Taux en pourcent, 2 décimales (ou « — » si absent). */
function fmtPct(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(2)} %`;
}

/** Variation signée en points de base d'affichage (± 0.02), colorée par le caller. */
function fmtDelta(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}`;
}

/** Classe de couleur d'une variation (thème) : hausse=up, baisse=down, nul=dim. */
function couleurDelta(v: number | null): string {
  if (v === null || !Number.isFinite(v) || v === 0) return "text-text-dim";
  return v > 0 ? "text-up" : "text-down";
}

// ─────────────────────────── Onglets ───────────────────────────

type Onglet = "rendements" | "directeurs" | "or";
type Statut = "idle" | "loading" | "ready";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "rendements", label: "Rendements" },
  { id: "directeurs", label: "Taux directeurs" },
  { id: "or", label: "Réserves d'or" },
];

// ─────────────────────────── Sous-vues ───────────────────────────

function VueRendements({ data, statut }: { data: RendementsSouverains | null; statut: Statut }) {
  if (statut === "loading" && data === null) return <Chargement />;
  const us = data?.us ?? [];
  const euro = data?.euro ?? {};
  const derniere = us[0];
  const spread = spread2s10s(us);

  if (derniere === undefined && Object.keys(euro).length === 0) {
    return <Indisponible libelle="Rendements souverains indisponibles pour le moment." />;
  }

  return (
    <div className="space-y-4">
      {derniere !== undefined && (
        <section>
          <EnteteSection titre="Trésor américain" info={`au ${derniere.date}`} />
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-text-dim">
                <th className="py-1 text-left font-medium">Maturité</th>
                <th className="py-1 text-right font-medium">Taux</th>
                <th className="py-1 text-right font-medium">Δ jour</th>
              </tr>
            </thead>
            <tbody>
              {MATURITES_US.map((m) => {
                const v = derniere.rendements[m];
                const d = deltaJour(us, m);
                return (
                  <tr key={m} className="border-t border-border/60">
                    <td className="py-1 text-left text-text">{m}</td>
                    <td className="py-1 text-right text-text">{fmtPct(v)}</td>
                    <td className={`py-1 text-right ${couleurDelta(d)}`}>{fmtDelta(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {spread !== null && (
            <div className="mt-2 flex items-center justify-between rounded border border-border bg-bg px-2 py-1 text-[11px]">
              <span className="text-text-dim">Écart 2 ans / 10 ans</span>
              <span className={`tabular-nums ${couleurDelta(spread)}`}>
                {fmtDelta(spread)} pt {spread < 0 ? "· courbe inversée" : ""}
              </span>
            </div>
          )}
        </section>
      )}

      {Object.keys(euro).length > 0 && (
        <section>
          <EnteteSection titre="Zone euro (courbe AAA)" info="ECB SDMX" />
          <table className="w-full text-[11px] tabular-nums">
            <tbody>
              {["2 Yr", "10 Yr", "30 Yr"].map((m) =>
                euro[m] === undefined ? null : (
                  <tr key={m} className="border-t border-border/60">
                    <td className="py-1 text-left text-text">{m}</td>
                    <td className="py-1 text-right text-text">{fmtPct(euro[m])}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function VueDirecteurs({ data, statut }: { data: TauxDirecteur[] | null; statut: Statut }) {
  if (statut === "loading" && data === null) return <Chargement />;
  if (data === null || data.length === 0) {
    return <Indisponible libelle="Taux directeurs indisponibles pour le moment." />;
  }
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead>
        <tr className="text-text-dim">
          <th className="py-1 text-left font-medium">Banque centrale</th>
          <th className="py-1 text-right font-medium">Taux</th>
          <th className="py-1 text-right font-medium">au</th>
        </tr>
      </thead>
      <tbody>
        {data.map((t) => (
          <tr key={t.refArea} className="border-t border-border/60">
            <td className="py-1 text-left">
              <span className="font-medium text-accent">{t.sigle}</span>{" "}
              <span className="text-text-dim">· {t.banque}</span>
            </td>
            <td className="py-1 text-right text-text">{fmtPct(t.taux)}</td>
            <td className="py-1 text-right text-text-dim">{t.date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VueOr({ data, statut }: { data: ReserveOr[] | null; statut: Statut }) {
  if (statut === "loading" && data === null) return <Chargement />;
  if (data === null || data.length === 0) {
    return <Indisponible libelle="Réserves d'or indisponibles pour le moment." />;
  }
  const top = data.slice(0, 15);
  const max = top[0]?.tonnes ?? 1;
  return (
    <div className="space-y-1">
      {top.map((r, i) => (
        <div key={r.pays} className="flex items-center gap-2 text-[11px]">
          <span className="w-4 text-right tabular-nums text-text-dim">{i + 1}</span>
          <span className="w-28 shrink-0 truncate text-text" title={r.nom}>
            {r.nom}
          </span>
          <div className="relative h-3.5 flex-1 overflow-hidden rounded-sm bg-bg">
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-accent/40"
              style={{ width: `${Math.max(2, (r.tonnes / max) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums text-text">
            {fmtTonnes.format(r.tonnes)} t
          </span>
        </div>
      ))}
      <p className="pt-1 text-[10px] leading-snug text-text-dim">
        Source IMF SDMX 3.0 (IRFCL) · volume converti en tonnes. Déclarants au chiffre
        aberrant ou agrégats régionaux écartés.
      </p>
    </div>
  );
}

function EnteteSection({ titre, info }: { titre: string; info?: string }) {
  return (
    <div className="mb-1 flex items-baseline justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text">{titre}</span>
      {info !== undefined && <span className="text-[10px] text-text-dim">{info}</span>}
    </div>
  );
}

function Chargement() {
  return <div className="px-1 py-6 text-center text-[11px] text-text-dim">Chargement…</div>;
}

function Indisponible({ libelle }: { libelle: string }) {
  return (
    <div className="rounded border border-border bg-bg px-3 py-4 text-center text-[11px] text-text-dim">
      {libelle}
    </div>
  );
}

// ─────────────────────────── Composant principal ───────────────────────────

export function MacroRatesWindow() {
  const open = useStore(macroRatesUiStore, (s) => s.open);
  const [onglet, setOnglet] = useState<Onglet>("rendements");

  const [rendements, setRendements] = useState<RendementsSouverains | null>(null);
  const [taux, setTaux] = useState<TauxDirecteur[] | null>(null);
  const [reserves, setReserves] = useState<ReserveOr[] | null>(null);

  const [statutR, setStatutR] = useState<Statut>("idle");
  const [statutD, setStatutD] = useState<Statut>("idle");
  const [statutO, setStatutO] = useState<Statut>("idle");
  // Nonce de rechargement (cf. CorrWindow) : bumper force un re-fetch de l'onglet actif.
  const [nonce, setNonce] = useState(0);

  // Chargement PARESSEUX de l'onglet actif, une seule fois par session (idle → loading
  // → ready). La réouverture de la fenêtre ne refait aucun fetch (composant monté). Les
  // statuts sont LUS via la closure et NON mis en dépendances : sinon `setStatut("loading")`
  // relancerait l'effet et sa purge (`ignore=true`) invaliderait le fetch en cours (UI
  // bloquée sur « Chargement… »). Le seul re-déclenchement voulu (rafraîchir) passe par `nonce`.
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    if (onglet === "rendements" && statutR === "idle") {
      setStatutR("loading");
      void chargerRendementsSouverains().then((r) => {
        if (ignore) return;
        setRendements(r);
        setStatutR("ready");
      });
    } else if (onglet === "directeurs" && statutD === "idle") {
      setStatutD("loading");
      void chargerTauxDirecteurs().then((r) => {
        if (ignore) return;
        setTaux(r);
        setStatutD("ready");
      });
    } else if (onglet === "or" && statutO === "idle") {
      setStatutO("loading");
      void chargerReservesOr().then((r) => {
        if (ignore) return;
        setReserves(r);
        setStatutO("ready");
      });
    }
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statuts lus en closure (cf. ci-dessus)
  }, [open, onglet, nonce]);

  // Rafraîchissement manuel : remet l'onglet actif en « idle » ET bump le nonce → l'effet
  // se redéclenche et recharge (le simple reset de statut ne suffirait pas, il n'est pas dep).
  const rafraichir = () => {
    if (onglet === "rendements") setStatutR("idle");
    else if (onglet === "directeurs") setStatutD("idle");
    else setStatutO("idle");
    setNonce((n) => n + 1);
  };

  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">
            RATE · Taux & Réserves
          </h2>
          <p className="mt-0.5 text-[11px] text-text-dim">Trésor US · ECB · BIS · IMF</p>
        </div>
        <button
          type="button"
          onClick={rafraichir}
          aria-label="Rafraîchir la section active"
          title="Rafraîchir"
          className="rounded p-1 text-sm leading-none text-text-dim transition hover:bg-bg hover:text-text"
        >
          ⟳
        </button>
      </header>

      {/* Onglets. */}
      <div className="flex gap-1 border-b border-border px-3 py-2">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setOnglet(o.id)}
            className={`rounded px-2.5 py-1 text-[11px] transition ${
              onglet === o.id
                ? "bg-surface text-text"
                : "text-text-dim hover:text-text"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {onglet === "rendements" && <VueRendements data={rendements} statut={statutR} />}
        {onglet === "directeurs" && <VueDirecteurs data={taux} statut={statutD} />}
        {onglet === "or" && <VueOr data={reserves} statut={statutO} />}
      </div>
    </>
  );
}
