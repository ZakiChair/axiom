/**
 * Fenêtre « FUND » — Fiche société (fondamentaux tradfi). Dockable à droite, NON MODALE.
 *
 * Recherche d'une société par ticker/nom via l'annuaire SEC EDGAR (`chargerTickers` +
 * `rechercherSociete`, AUCUNE clé requise, annuaire chargé une fois à la première
 * ouverture puis filtré en mémoire, saisie debouncée 200 ms). La sélection d'un
 * résultat déclenche EN PARALLÈLE : le profil SEC (toujours, sans clé) et — si une clé
 * Finnhub est configurée — le profil Finnhub (secteur, capitalisation, site web) et le
 * calendrier des résultats trimestriels.
 *
 * Onglets Profil / Insider / Earnings :
 *   - Profil et Earnings dépendent de Finnhub → message « configurez une clé » sans clé.
 *   - Insider affiche TOUJOURS un message honnête d'indisponibilité : l'endpoint SEC
 *     `submissions/CIK….json` utilisé ici ne contient PAS le détail des Form 4 par
 *     dépôt (juste la liste des dépôts) — `ProfilSec.insiders` reste donc vide en v1
 *     quelle que soit la clé Finnhub (cf. data/fund/secEdgar.ts). Pas de faux-semblant :
 *     mieux vaut un onglet honnête qu'un onglet vide sans explication (règle d'or doc 02,
 *     même convention que le tag « indisponible » d'OnchainWindow).
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { windowManagerStore, mirrorOpenState } from "../store/windowManager";
import { settingsUiStore } from "../store/settings-ui";
import { finnhubKeyStore, getFinnhubKey } from "../store/finnhub";
import {
  chargerTickers,
  rechercherSociete,
  chargerProfilSec,
  type EntreeTicker,
  type ProfilSec,
} from "../data/fund/secEdgar";
import {
  chargerProfilFinnhub,
  chargerEarnings,
  type ProfilFinnhub,
  type EarningsEvent,
} from "../data/fund/finnhub";
import { formatUsd, formatDec, formatDateComplete, VALEUR_ABSENTE } from "../lib/format";
import { EnTeteFenetre, Onglets, Chargement, Input, Vide, SansCle } from "./ui";
import { TableTriable, type ColonneTable } from "./TableTriable";

// ─────────────────────────── Store UI (vanilla, éphémère, non persisté) ───────────────────────────

export interface FundUiState {
  open: boolean;
  openFund: () => void;
  closeFund: () => void;
  toggleFund: () => void;
}

export const fundUiStore = createStore<FundUiState>(() => ({
  open: false,
  openFund: () => windowManagerStore.getState().openWindow("fund"),
  closeFund: () => windowManagerStore.getState().closeWindow("fund"),
  toggleFund: () => windowManagerStore.getState().toggleWindow("fund"),
}));

mirrorOpenState("fund", fundUiStore);

// ─────────────────────────── Formatage (pur) ───────────────────────────

/** Capitalisation Finnhub (en MILLIONS USD) → montant USD compact partagé ($T/$B/$M/$K). */
function fmtCapitalisation(millions: number | null): string {
  if (millions === null || !Number.isFinite(millions)) return VALEUR_ABSENTE;
  return formatUsd(millions * 1_000_000);
}

/**
 * Valide qu'une URL est sûre à rendre en `href` (http/https uniquement). Le champ
 * `weburl` de Finnhub est une donnée EXTERNE non fiable — sans ce garde-fou, une
 * valeur `javascript:` renvoyée par l'API (ou un cache corrompu) s'exécuterait au
 * clic. PURE, ne lève jamais.
 */
function urlHttpSure(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Date ISO (YYYY-MM-DD) → date complète fr-FR partagée, robuste aux dates invalides. */
function fmtDateCourte(iso: string): string {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? iso : formatDateComplete(ms);
}

// ─────────────────────────── Onglets ───────────────────────────

type Onglet = "profil" | "insider" | "earnings";
type Statut = "idle" | "loading" | "ready";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "profil", label: "Profil" },
  { id: "insider", label: "Initiés" },
  { id: "earnings", label: "Résultats" },
];

// ─────────────────────────── Sous-vues ───────────────────────────

function VueProfil({ data }: { data: ProfilFinnhub }) {
  const siteWeb = urlHttpSure(data.description);
  return (
    <div className="space-y-3">
      {/* Fiche identité (3 champs) : pas une table de DONNÉES au sens TableTriable
          (pas de tri, pas de lignes homogènes) — liste définition simple. */}
      <div className="divide-y divide-border/60 text-[11px]">
        <div className="flex items-center justify-between py-1">
          <span className="text-text-dim">Nom</span>
          <span className="text-text">{data.nom}</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-text-dim">Secteur</span>
          <span className="text-text">{data.secteur || "—"}</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-text-dim">Capitalisation</span>
          <span className="tabular-nums text-text">{fmtCapitalisation(data.capitalisation)}</span>
        </div>
      </div>
      {/* NOTE : le champ `description` de ProfilFinnhub est en réalité `weburl` côté
          Finnhub (une URL, pas un texte descriptif) — libellé « Site web », jamais
          « Description », et rendu comme lien plutôt que comme prose. `urlHttpSure`
          re-valide le schéma (http/https) avant de le poser en `href` : c'est une
          donnée externe non fiable, une valeur `javascript:` ne doit jamais devenir
          un lien cliquable. */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-text-dim">Site web</span>
        {siteWeb !== null ? (
          <a
            href={siteWeb}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate text-accent hover:underline"
          >
            {data.description}
          </a>
        ) : (
          <span className="text-text">—</span>
        )}
      </div>
    </div>
  );
}

const COLONNES_EARNINGS: ColonneTable<EarningsEvent>[] = [
  { id: "date", label: "Date", rendu: (e) => <span className="text-text">{fmtDateCourte(e.date)}</span> },
  {
    id: "epsEstime",
    label: "EPS estimé",
    align: "right",
    rendu: (e) => <span className="text-text-dim">{formatDec(e.epsEstime, 2)}</span>,
  },
  {
    id: "epsReel",
    label: "EPS réel",
    align: "right",
    rendu: (e) => <span className="text-text">{formatDec(e.epsReel, 2)}</span>,
  },
];

function VueEarnings({ data }: { data: EarningsEvent[] }) {
  return <TableTriable colonnes={COLONNES_EARNINGS} lignes={data} cle={(e) => e.date} />;
}

// ─────────────────────────── Composant principal ───────────────────────────

export function FundWindow() {
  const open = useStore(fundUiStore, (s) => s.open);
  const hasKey = useStore(finnhubKeyStore, (s) => s.hasKey);
  const openSettings = useStore(settingsUiStore, (s) => s.openSettings);

  // Annuaire SEC EDGAR (tickers), chargé une seule fois à la première ouverture.
  const [tickers, setTickers] = useState<EntreeTicker[]>([]);
  const [statutTickers, setStatutTickers] = useState<Statut>("idle");

  // Recherche : saisie brute + version debouncée (200 ms) utilisée pour filtrer.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [selected, setSelected] = useState<EntreeTicker | null>(null);
  const [onglet, setOnglet] = useState<Onglet>("profil");

  const [profilSec, setProfilSec] = useState<ProfilSec | null>(null);
  const [statutSec, setStatutSec] = useState<Statut>("idle");
  const [profilFinnhub, setProfilFinnhub] = useState<ProfilFinnhub | null>(null);
  const [statutFinnhub, setStatutFinnhub] = useState<Statut>("idle");
  const [earnings, setEarnings] = useState<EarningsEvent[] | null>(null);
  const [statutEarnings, setStatutEarnings] = useState<Statut>("idle");

  // Charge l'annuaire SEC une seule fois, à la première ouverture (10 000 entrées,
  // cache 24 h côté chargerTickers — inutile de refetch à chaque réouverture).
  useEffect(() => {
    if (!open || statutTickers !== "idle") return;
    const ctrl = new AbortController();
    setStatutTickers("loading");
    void chargerTickers(ctrl.signal).then((t) => {
      setTickers(t);
      setStatutTickers("ready");
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statutTickers lu en closure (cf. MacroRatesWindow)
  }, [open]);

  // Debounce 200 ms de la saisie avant de filtrer l'annuaire (évite un filtrage fuzzy
  // sur ~10 000 entrées à chaque frappe).
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const resultats = useMemo(
    () => (dropdownOpen ? rechercherSociete(debouncedQuery, tickers) : []),
    [debouncedQuery, tickers, dropdownOpen],
  );

  // Sélection d'une société : charge le profil SEC (toujours, sans clé) et, SI une clé
  // Finnhub est configurée, le profil + les earnings Finnhub — les trois EN PARALLÈLE
  // (aucun n'attend les autres).
  useEffect(() => {
    if (selected === null) return;
    const ctrl = new AbortController();
    let ignore = false;

    setStatutSec("loading");
    setProfilSec(null);
    void chargerProfilSec(selected.cik, ctrl.signal).then((p) => {
      if (ignore) return;
      setProfilSec(p);
      setStatutSec("ready");
    });

    const cle = getFinnhubKey();
    if (hasKey && cle !== null) {
      setStatutFinnhub("loading");
      setProfilFinnhub(null);
      void chargerProfilFinnhub(selected.ticker, cle, ctrl.signal).then((p) => {
        if (ignore) return;
        setProfilFinnhub(p);
        setStatutFinnhub("ready");
      });

      setStatutEarnings("loading");
      setEarnings(null);
      void chargerEarnings(selected.ticker, cle, ctrl.signal).then((e) => {
        if (ignore) return;
        setEarnings(e);
        setStatutEarnings("ready");
      });
    } else {
      setStatutFinnhub("idle");
      setProfilFinnhub(null);
      setStatutEarnings("idle");
      setEarnings(null);
    }

    return () => {
      ignore = true;
      ctrl.abort();
    };
  }, [selected, hasKey]);

  const choisir = (entry: EntreeTicker) => {
    setSelected(entry);
    setQuery(`${entry.ticker} — ${entry.nom}`);
    setDropdownOpen(false);
  };

  return (
    <>
      <EnTeteFenetre mnemo="FUND" titre="Fiche société" sousTitre="SEC EDGAR · Finnhub" />

      {/* Recherche — annuaire SEC EDGAR, aucune clé requise. */}
      <div className="relative border-b border-border px-4 py-2">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => window.setTimeout(() => setDropdownOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDropdownOpen(false);
          }}
          placeholder="Rechercher un ticker ou une société (ex. AAPL, Apple)"
          spellCheck={false}
          autoComplete="off"
          className="w-full"
          aria-label="Rechercher une société"
        />
        {statutTickers === "loading" && (
          <p className="mt-1 text-[11px] text-text-dim">Chargement de l'annuaire SEC…</p>
        )}
        {dropdownOpen && resultats.length > 0 && (
          <ul className="absolute left-4 right-4 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded border border-border bg-surface py-1 shadow-xl">
            {resultats.map((r) => (
              <li key={r.cik}>
                <button
                  type="button"
                  // onMouseDown (avant le blur du champ) : le clic est pris en compte.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choisir(r);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-bg"
                >
                  <span className="w-16 shrink-0 font-semibold text-accent">{r.ticker}</span>
                  <span className="min-w-0 flex-1 truncate text-text-dim">{r.nom}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected === null ? (
        <div className="min-h-0 flex-1 px-4 py-3">
          <Vide>Recherchez une société ci-dessus (SEC EDGAR, aucune clé requise) pour afficher sa fiche.</Vide>
        </div>
      ) : (
        <>
          {/* Identité — toujours issue de SEC EDGAR, disponible sans clé Finnhub. */}
          <div className="border-b border-border px-4 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-text">{selected.ticker}</span>
              <span className="truncate text-[11px] text-text-dim">
                {statutSec === "loading" ? "Chargement…" : profilSec?.nom ?? selected.nom}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-text-dim">
              {profilSec?.secteur ?? "Secteur —"} · CIK {selected.cik}
            </p>
          </div>

          {/* Onglets. */}
          <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {onglet === "profil" &&
              (!hasKey ? (
                <SansCle
                  message="Configurez une clé Finnhub pour afficher cette section."
                  onOuvrirReglages={openSettings}
                />
              ) : statutFinnhub === "loading" && profilFinnhub === null ? (
                <Chargement />
              ) : profilFinnhub === null ? (
                <Vide>Profil Finnhub indisponible pour ce ticker.</Vide>
              ) : (
                <VueProfil data={profilFinnhub} />
              ))}

            {onglet === "insider" && (
              <Vide>
                Transactions d'initiés (Form 4) indisponibles dans cette version : l'endpoint SEC
                EDGAR utilisé ici ne fournit pas le détail par dépôt, seulement la liste des dépôts.
              </Vide>
            )}

            {onglet === "earnings" &&
              (!hasKey ? (
                <SansCle
                  message="Configurez une clé Finnhub pour afficher cette section."
                  onOuvrirReglages={openSettings}
                />
              ) : statutEarnings === "loading" && earnings === null ? (
                <Chargement />
              ) : earnings === null || earnings.length === 0 ? (
                <Vide>Aucun résultat trimestriel programmé trouvé.</Vide>
              ) : (
                <VueEarnings data={earnings} />
              ))}
          </div>
        </>
      )}
    </>
  );
}
