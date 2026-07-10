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
import { macroRatesViewStore, type VueRendementsMode } from "../store/macroRatesView";
import {
  chargerRendementsSouverains,
  deltaJour,
  MATURITES_US,
  spread2s10s,
  type RendementsSouverains,
} from "../data/macro/treasuryYields";
import { chargerTauxDirecteurs, type TauxDirecteur } from "../data/macro/policyRates";
import { chargerReservesOr, type ReserveOr } from "../data/macro/goldReserves";
import { CourbeTaux, type PointCourbe } from "./CourbeTaux";
import { anneesDeMaturite } from "./courbeTaux.util";
import { formatPourcentage, formatEntier, formatDateComplete } from "../lib/format";
import { EnTeteFenetre, Onglets, Chargement, Vide } from "./ui";

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
  {
    id: "panneau:macroRates:crvf",
    mnemonique: "CRVF",
    libelle: "Courbe des taux (CRVF)",
    categorie: "panneau",
    motsCles: ["crvf", "courbe", "yield curve", "taux", "shape of curve"],
    apercu: "Ouvre RATE directement en vue courbe",
    action: () => {
      macroRatesViewStore.getState().demanderCourbe();
      macroRatesUiStore.getState().openMacroRates();
    },
  },
];

// ─────────────────────────── Helpers de format (purs) ───────────────────────────

/**
 * Formate une date de source (Trésor « MM/JJ/AAAA » ou BIS « AAAA-MM-JJ ») en
 * fr-FR « 2 juil. 2026 » via le formateur partagé. Les composants sont lus en
 * heure locale (aucun décalage de fuseau) ; chaîne renvoyée telle quelle si le
 * format n'est pas reconnu (dégradation gracieuse).
 */
function formatDateSource(brut: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(brut);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brut);
  let annee: number;
  let mois: number;
  let jour: number;
  if (iso !== null) {
    annee = Number(iso[1]);
    mois = Number(iso[2]);
    jour = Number(iso[3]);
  } else if (us !== null) {
    mois = Number(us[1]);
    jour = Number(us[2]);
    annee = Number(us[3]);
  } else {
    return brut;
  }
  return formatDateComplete(new Date(annee, mois - 1, jour).getTime());
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

/** Bascule Tableau/Courbe de l'onglet Rendements (libellés explicites, style aligné sur les onglets). */
const VUES_RENDEMENTS: ReadonlyArray<{ id: VueRendementsMode; label: string }> = [
  { id: "tableau", label: "Tableau" },
  { id: "courbe", label: "Courbe" },
];

// ─────────────────────────── Sous-vues ───────────────────────────

/** Points de la courbe US : maturité → années (via `anneesDeMaturite`) + taux, en
 * écartant les formes non reconnues et les valeurs absentes (dégradation gracieuse). */
function pointsUs(derniere: { rendements: Record<string, number> } | undefined): PointCourbe[] {
  if (derniere === undefined) return [];
  const pts: PointCourbe[] = [];
  for (const m of MATURITES_US) {
    const taux = derniere.rendements[m];
    const annees = anneesDeMaturite(m);
    if (taux !== undefined && Number.isFinite(annees)) pts.push({ maturite: m, anneesTri: annees, taux });
  }
  return pts;
}

/** Points de la courbe zone euro (2/10/30 ans, déjà en années entières). */
function pointsEuro(euro: Record<string, number>): PointCourbe[] {
  return ["2 Yr", "10 Yr", "30 Yr"]
    .filter((m) => euro[m] !== undefined)
    .map((m) => ({ maturite: m, anneesTri: anneesDeMaturite(m), taux: euro[m]! }));
}

function VueRendements({
  data,
  statut,
  vue,
  setVue,
}: {
  data: RendementsSouverains | null;
  statut: Statut;
  vue: VueRendementsMode;
  setVue: (v: VueRendementsMode) => void;
}) {
  if (statut === "loading" && data === null) return <Chargement />;
  const us = data?.us ?? [];
  const euro = data?.euro ?? {};
  const derniere = us[0];
  const spread = spread2s10s(us);

  if (derniere === undefined && Object.keys(euro).length === 0) {
    return <Vide>Rendements souverains indisponibles pour le moment.</Vide>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-1">
        {VUES_RENDEMENTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVue(v.id)}
            className={`rounded px-2.5 py-1 text-[11px] transition ${
              vue === v.id ? "bg-surface text-text" : "text-text-dim hover:text-text"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {vue === "courbe" ? (
        <section>
          <EnteteSection
            titre="Courbe des taux"
            info={derniere !== undefined ? `au ${formatDateSource(derniere.date)}` : undefined}
          />
          <CourbeTaux us={pointsUs(derniere)} euro={pointsEuro(euro)} />
        </section>
      ) : (
        <>
          {derniere !== undefined && (
            <section>
              <EnteteSection titre="Trésor américain" info={`au ${formatDateSource(derniere.date)}`} />
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
                        <td className="py-1 text-right text-text">{formatPourcentage(v)}</td>
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
                        <td className="py-1 text-right text-text">{formatPourcentage(euro[m])}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function VueDirecteurs({ data, statut }: { data: TauxDirecteur[] | null; statut: Statut }) {
  if (statut === "loading" && data === null) return <Chargement />;
  if (data === null || data.length === 0) {
    return <Vide>Taux directeurs indisponibles pour le moment.</Vide>;
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
            <td className="py-1 text-right text-text">{formatPourcentage(t.taux)}</td>
            <td className="py-1 text-right text-text-dim">{formatDateSource(t.date)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VueOr({ data, statut }: { data: ReserveOr[] | null; statut: Statut }) {
  if (statut === "loading" && data === null) return <Chargement />;
  if (data === null || data.length === 0) {
    return <Vide>Réserves d'or indisponibles pour le moment.</Vide>;
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
            {formatEntier(r.tonnes)} t
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

// ─────────────────────────── Composant principal ───────────────────────────

export function MacroRatesWindow() {
  const open = useStore(macroRatesUiStore, (s) => s.open);
  const [onglet, setOnglet] = useState<Onglet>("rendements");
  // Vue Tableau/Courbe de l'onglet « Rendements » — initialisée depuis le store partagé
  // éphémère (macroRatesViewStore) pour honorer une commande CRVF déclenchée avant le
  // (re)montage de la fenêtre. `requete` (bumped par CRVF) force la resynchronisation
  // même si la fenêtre est déjà montée sur un autre onglet/vue.
  const [vue, setVue] = useState<VueRendementsMode>(() => macroRatesViewStore.getState().vue);
  const requeteCourbe = useStore(macroRatesViewStore, (s) => s.requete);
  useEffect(() => {
    if (requeteCourbe === 0) return; // état initial, déjà pris en compte par le lazy useState ci-dessus
    setOnglet("rendements");
    setVue("courbe");
  }, [requeteCourbe]);

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
      <EnTeteFenetre
        titre="RATE · Taux & Réserves"
        sousTitre="Trésor US · ECB · BIS · IMF"
        actions={
          <button
            type="button"
            onClick={rafraichir}
            aria-label="Rafraîchir la section active"
            title="Rafraîchir"
            className="rounded p-1 text-sm leading-none text-text-dim transition hover:bg-bg hover:text-text"
          >
            ⟳
          </button>
        }
      />

      {/* Onglets. */}
      <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {onglet === "rendements" && (
          <VueRendements data={rendements} statut={statutR} vue={vue} setVue={setVue} />
        )}
        {onglet === "directeurs" && <VueDirecteurs data={taux} statut={statutD} />}
        {onglet === "or" && <VueOr data={reserves} statut={statutO} />}
      </div>
    </>
  );
}
