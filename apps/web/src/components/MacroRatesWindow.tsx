/**
 * Fenêtre « RATE » — Taux & Réserves souveraines. Dockable à droite, NON MODALE.
 *
 * UN panneau unifié (décision produit : pas trois fenêtres séparées) à TROIS sections :
 *   1. Rendements obligataires souverains — courbe US (home.treasury.gov) + zone euro
 *      AAA (ECB SDMX) + Japon (MOF) + Canada (BoC Valet) + Australie (RBA F2), avec
 *      variation jour-sur-jour US colorée et écart 2s10s (inversion). Vue tableau
 *      (US + matrice internationale) et vue courbe (N séries, bascules par pays).
 *   2. Taux directeurs — 12 grandes banques centrales (Fed, BCE, BoE, BoJ, BNS, PBOC,
 *      BoC, RBA, BCB, RBI, BoK, Banxico) en un seul appel BIS WS_CBPOL.
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
import { deltaJour, MATURITES_US, spread2s10s } from "../data/macro/treasuryYields";
import {
  chargerRendementsSouverainsMulti,
  MATURITE_AU_INDEXEE,
  MATURITES_AU,
  MATURITES_CA,
  MATURITES_JP,
  type RendementsSouverainsMulti,
} from "../data/macro/sovereignYields";
import { chargerTauxDirecteurs, type TauxDirecteur } from "../data/macro/policyRates";
import { chargerReservesOr, type ReserveOr } from "../data/macro/goldReserves";
import { CourbeTaux, type SerieCourbe } from "./CourbeTaux";
import { pointsDeCourbe } from "./courbeTaux.util";
import { paysIndisponibles } from "./macroRatesWindow.util";
import { formatPourcentage, formatEntier, formatDateComplete } from "../lib/format";
import { EnTeteFenetre, Onglets, Chargement, NoteSource, Vide } from "./ui";

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

/**
 * Libellé de maturité en français (AFFICHAGE seulement) — normalise les libellés
 * bruts hétérogènes des sources (« 1 Mo », « 1.5 Month », « 2 Yr », « 10 Yr
 * (indexée) ») en « 1 mois », « 1,5 mois », « 2 ans », « 10 ans (indexée) ». Les
 * clés de données (MATURITES_US/JP…) restent INCHANGÉES : elles indexent
 * `rendements[m]` et alimentent la courbe CRVF. Libellé inconnu rendu tel quel.
 */
function libelleMaturiteFr(m: string): string {
  if (m === "1.5 Month") return "1,5 mois";
  const mois = /^(\d+)\s*Mo$/.exec(m);
  if (mois !== null && mois[1] !== undefined) return `${mois[1]} mois`;
  const ans = /^(\d+)\s*Yr(.*)$/.exec(m);
  if (ans !== null && ans[1] !== undefined) {
    const n = Number(ans[1]);
    const suffixe = (ans[2] ?? "").trim();
    const unite = n > 1 ? "ans" : "an";
    return suffixe.length > 0 ? `${n} ${unite} ${suffixe}` : `${n} ${unite}`;
  }
  return m;
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

/** Maturités zone euro affichées (déjà « N Yr », directement en années). */
const MATURITES_EURO: readonly string[] = ["2 Yr", "10 Yr", "30 Yr"];

/** Lignes du tableau « International » : union des maturités zone euro (2/10/30 Yr,
 * incluses dans la liste JGB), Japon (1→40 Yr), Canada (2/3/5/7/10 Yr, incluses) et
 * Australie (2/3/5/10 Yr + indexée). Les lignes sans aucune valeur sont masquées. */
const MATURITES_INTL: readonly string[] = [...MATURITES_JP, MATURITE_AU_INDEXEE];

/** Classes `text-serie-N` par index de token (littéraux STATIQUES pour le JIT Tailwind). */
const CLASSES_SERIE: readonly string[] = [
  "text-serie-1",
  "text-serie-2",
  "text-serie-3",
  "text-serie-4",
  "text-serie-5",
  "text-serie-6",
];

/** Identifiants des pays affichables sur la courbe (bascules de visibilité). */
type PaysCourbe = "us" | "euro" | "jp" | "ca" | "au";

function VueRendements({
  data,
  statut,
  vue,
  setVue,
}: {
  data: RendementsSouverainsMulti | null;
  statut: Statut;
  vue: VueRendementsMode;
  setVue: (v: VueRendementsMode) => void;
}) {
  // Pays masqués sur la courbe (bascules de lisibilité) — état local, non persisté.
  const [masques, setMasques] = useState<ReadonlySet<PaysCourbe>>(new Set());
  if (statut === "loading" && data === null) return <Chargement />;
  const us = data?.us ?? [];
  const euro = data?.euro ?? {};
  const jp = data?.jp ?? [];
  const ca = data?.ca ?? [];
  const au = data?.au ?? [];
  const derniere = us[0];
  const spread = spread2s10s(us);

  if (
    derniere === undefined &&
    Object.keys(euro).length === 0 &&
    jp.length === 0 &&
    ca.length === 0 &&
    au.length === 0
  ) {
    return <Vide>Rendements souverains indisponibles pour le moment.</Vide>;
  }

  // Une série par pays avec données (couleurs --serie-1…5, légende générée par CourbeTaux).
  const toutesSeries: ReadonlyArray<{ id: PaysCourbe; serie: SerieCourbe }> = [
    {
      id: "us",
      serie: {
        label: "US",
        points: pointsDeCourbe(derniere?.rendements, MATURITES_US),
        couleurTokenIndex: 1,
      },
    },
    {
      id: "euro",
      serie: { label: "Zone euro", points: pointsDeCourbe(euro, MATURITES_EURO), couleurTokenIndex: 2 },
    },
    {
      id: "jp",
      serie: {
        label: "Japon",
        points: pointsDeCourbe(jp[0]?.rendements, MATURITES_JP),
        couleurTokenIndex: 3,
      },
    },
    {
      id: "ca",
      serie: {
        label: "Canada",
        points: pointsDeCourbe(ca[0]?.rendements, MATURITES_CA),
        couleurTokenIndex: 4,
      },
    },
    {
      id: "au",
      serie: {
        label: "Australie",
        points: pointsDeCourbe(au[0]?.rendements, MATURITES_AU),
        couleurTokenIndex: 5,
      },
    },
  ];
  const seriesDisponibles = toutesSeries.filter((p) => p.serie.points.length > 0);
  // Séries restantes après bascules : distinguer « données présentes mais toutes
  // masquées » (message dédié) de « pas assez de points » (message de CourbeTaux).
  const seriesVisibles = seriesDisponibles.filter(({ id }) => !masques.has(id));
  // Pays attendus sans aucune donnée (ex. RBA 403 Akamai) : note discrète en pied.
  const indisponibles = paysIndisponibles(data);

  // Colonnes de la matrice internationale (dernière observation par pays, si disponible).
  const colonnesIntl: ReadonlyArray<{ id: string; titre: string; valeurs: Record<string, number> }> =
    [
      { id: "euro", titre: "Zone euro", valeurs: euro },
      { id: "jp", titre: "Japon", valeurs: jp[0]?.rendements ?? {} },
      { id: "ca", titre: "Canada", valeurs: ca[0]?.rendements ?? {} },
      { id: "au", titre: "Australie", valeurs: au[0]?.rendements ?? {} },
    ].filter((c) => Object.keys(c.valeurs).length > 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-1">
        {VUES_RENDEMENTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVue(v.id)}
            className={`rounded px-2.5 py-1 text-[11px] transition ${
              vue === v.id ? "bg-bg text-text" : "text-text-dim hover:text-text"
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
          {seriesDisponibles.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {seriesDisponibles.map(({ id, serie }) => {
                const actif = !masques.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={actif}
                    title={actif ? `Masquer ${serie.label}` : `Afficher ${serie.label}`}
                    onClick={() =>
                      setMasques((prev) => {
                        const suivant = new Set(prev);
                        if (suivant.has(id)) suivant.delete(id);
                        else suivant.add(id);
                        return suivant;
                      })
                    }
                    className={`rounded px-2 py-0.5 text-[10px] transition ${
                      actif ? "bg-bg text-text" : "text-text-dim opacity-60 hover:opacity-100"
                    }`}
                  >
                    <span className={CLASSES_SERIE[serie.couleurTokenIndex - 1] ?? "text-serie-1"}>
                      ●
                    </span>{" "}
                    {serie.label}
                  </button>
                );
              })}
            </div>
          )}
          {seriesDisponibles.length > 0 && seriesVisibles.length === 0 ? (
            <Vide>Toutes les séries sont masquées.</Vide>
          ) : (
            <CourbeTaux series={seriesVisibles.map(({ serie }) => serie)} />
          )}
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
                        <td className="py-1 text-left text-text">{libelleMaturiteFr(m)}</td>
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

          {colonnesIntl.length > 0 && (
            <section>
              <EnteteSection titre="International" info="ECB · MOF · BoC · RBA" />
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-text-dim">
                    <th className="py-1 text-left font-medium">Maturité</th>
                    {colonnesIntl.map((c) => (
                      <th key={c.id} className="py-1 text-right font-medium">
                        {c.titre}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATURITES_INTL.filter((m) =>
                    colonnesIntl.some((c) => c.valeurs[m] !== undefined),
                  ).map((m) => (
                    <tr key={m} className="border-t border-border/60">
                      <td className="py-1 text-left text-text">{libelleMaturiteFr(m)}</td>
                      {colonnesIntl.map((c) => (
                        <td
                          key={c.id}
                          className={`py-1 text-right ${
                            c.valeurs[m] === undefined ? "text-text-dim" : "text-text"
                          }`}
                        >
                          {formatPourcentage(c.valeurs[m])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-1">
                <NoteSource>
                  Zone euro : courbe AAA (taux spot) · « {MATURITE_AU_INDEXEE} » : rendement réel
                  (obligation indexée australienne).
                </NoteSource>
              </div>
            </section>
          )}
        </>
      )}

      {/* Dégradation VISIBLE : pays attendus restés sans donnée (pattern « sources en
          panne » de NewsWindow) — ex. RBA 403 Akamai, cf. sovereignYields.ts. */}
      {indisponibles.length > 0 && (
        <NoteSource>Indisponible : {indisponibles.join(" · ")}</NoteSource>
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

  const [rendements, setRendements] = useState<RendementsSouverainsMulti | null>(null);
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
      void chargerRendementsSouverainsMulti().then((r) => {
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
        sousTitre="Trésor US · ECB · MOF · BoC · RBA · BIS · IMF"
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
