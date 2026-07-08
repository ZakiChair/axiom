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
import type { Commande } from "../commands/registry";
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

/** Commandes exposées à la palette (⌘K) — greffées par App.tsx via `enregistrerCommandes`. */
export const commandes: Commande[] = [
  {
    id: "panneau:fund",
    mnemonique: "FUND",
    libelle: "Fiche société (FUND)",
    categorie: "panneau",
    motsCles: [
      "fondamentaux",
      "societe",
      "action",
      "equity",
      "profil",
      "earnings",
      "resultats",
      "sec",
      "edgar",
      "finnhub",
      "insider",
      "ticker",
    ],
    apercu: "Ouvre / ferme la fiche société (SEC EDGAR + Finnhub)",
    action: () => fundUiStore.getState().toggleFund(),
  },
];

// ─────────────────────────── Formatage (pur) ───────────────────────────

/** Capitalisation Finnhub (en MILLIONS USD) → notation compacte $T/$B/$M. */
function fmtCapitalisation(millions: number | null): string {
  if (millions === null || !Number.isFinite(millions)) return "—";
  const usd = millions * 1_000_000;
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  return `$${usd.toFixed(0)}`;
}

/** EPS (2 décimales) ou tiret. */
function fmtEps(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : v.toFixed(2);
}

/** Date ISO (YYYY-MM-DD) → format court fr-FR, robuste aux dates invalides. */
function fmtDateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ─────────────────────────── Onglets ───────────────────────────

type Onglet = "profil" | "insider" | "earnings";
type Statut = "idle" | "loading" | "ready";

const ONGLETS: ReadonlyArray<{ id: Onglet; label: string }> = [
  { id: "profil", label: "Profil" },
  { id: "insider", label: "Insider" },
  { id: "earnings", label: "Earnings" },
];

// ─────────────────────────── Sous-vues ───────────────────────────

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

/** Message affiché à la place d'un onglet dépendant de Finnhub quand aucune clé n'est configurée. */
function IndisponibleSansCle({ openSettings }: { openSettings: () => void }) {
  return (
    <div className="rounded border border-border bg-bg px-3 py-4 text-center text-[11px] text-text-dim">
      <p>Configurez une clé Finnhub pour afficher cette section.</p>
      <button
        type="button"
        onClick={openSettings}
        className="mt-2 text-accent hover:underline"
      >
        Ouvrir les réglages ⚙
      </button>
    </div>
  );
}

function VueProfil({ data }: { data: ProfilFinnhub }) {
  return (
    <div className="space-y-3">
      <table className="w-full text-[11px]">
        <tbody>
          <tr className="border-b border-border/60">
            <td className="py-1 text-text-dim">Nom</td>
            <td className="py-1 text-right text-text">{data.nom}</td>
          </tr>
          <tr className="border-b border-border/60">
            <td className="py-1 text-text-dim">Secteur</td>
            <td className="py-1 text-right text-text">{data.secteur || "—"}</td>
          </tr>
          <tr>
            <td className="py-1 text-text-dim">Capitalisation</td>
            <td className="py-1 text-right tabular-nums text-text">
              {fmtCapitalisation(data.capitalisation)}
            </td>
          </tr>
        </tbody>
      </table>
      {/* NOTE : le champ `description` de ProfilFinnhub est en réalité `weburl` côté
          Finnhub (une URL, pas un texte descriptif) — libellé « Site web », jamais
          « Description », et rendu comme lien plutôt que comme prose. */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-text-dim">Site web</span>
        {data.description.length > 0 ? (
          <a
            href={data.description}
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

function VueEarnings({ data }: { data: EarningsEvent[] }) {
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead>
        <tr className="text-text-dim">
          <th className="py-1 text-left font-medium">Date</th>
          <th className="py-1 text-right font-medium">EPS estimé</th>
          <th className="py-1 text-right font-medium">EPS réel</th>
        </tr>
      </thead>
      <tbody>
        {data.map((e) => (
          <tr key={e.date} className="border-t border-border/60">
            <td className="py-1 text-left text-text">{fmtDateCourte(e.date)}</td>
            <td className="py-1 text-right text-text-dim">{fmtEps(e.epsEstime)}</td>
            <td className="py-1 text-right text-text">{fmtEps(e.epsReel)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">
          FUND · Fiche société
        </h2>
        <p className="mt-0.5 text-[11px] text-text-dim">SEC EDGAR · Finnhub</p>
      </header>

      {/* Recherche — annuaire SEC EDGAR, aucune clé requise. */}
      <div className="relative border-b border-border px-4 py-2">
        <input
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
          className="w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
          aria-label="Rechercher une société"
        />
        {statutTickers === "loading" && (
          <p className="mt-1 text-[10px] text-text-dim">Chargement de l'annuaire SEC…</p>
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
        <div className="flex-1 px-4 py-6 text-center text-[11px] text-text-dim">
          Recherchez une société ci-dessus (SEC EDGAR, aucune clé requise) pour afficher sa fiche.
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
          <div className="flex gap-1 border-b border-border px-3 py-2">
            {ONGLETS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOnglet(o.id)}
                className={`rounded px-2.5 py-1 text-[11px] transition ${
                  onglet === o.id ? "bg-surface text-text" : "text-text-dim hover:text-text"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {onglet === "profil" &&
              (!hasKey ? (
                <IndisponibleSansCle openSettings={openSettings} />
              ) : statutFinnhub === "loading" && profilFinnhub === null ? (
                <Chargement />
              ) : profilFinnhub === null ? (
                <Indisponible libelle="Profil Finnhub indisponible pour ce ticker." />
              ) : (
                <VueProfil data={profilFinnhub} />
              ))}

            {onglet === "insider" && (
              <Indisponible libelle="Transactions d'initiés (Form 4) indisponibles dans cette version : l'endpoint SEC EDGAR utilisé ici ne fournit pas le détail par dépôt, seulement la liste des dépôts." />
            )}

            {onglet === "earnings" &&
              (!hasKey ? (
                <IndisponibleSansCle openSettings={openSettings} />
              ) : statutEarnings === "loading" && earnings === null ? (
                <Chargement />
              ) : earnings === null || earnings.length === 0 ? (
                <Indisponible libelle="Aucun résultat trimestriel programmé trouvé." />
              ) : (
                <VueEarnings data={earnings} />
              ))}
          </div>
        </>
      )}
    </>
  );
}
