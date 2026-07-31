/**
 * Fenêtre « SECT » — Secteurs crypto (Lot 3, spec 3.2).
 *
 * Table triable des ~10 groupes CURÉS (data/secteurs.ts) : perf 1 j / 7 j / 30 j
 * pondérée par capitalisation, cap totale, couverture « n/m membres » (membre hors
 * top 250 = non couvert, compté, JAMAIS re-fetché). Clic sur un groupe → drill-down
 * membres (perf, cap, poids dans le groupe) ; clic sur un membre coté Binance →
 * ouvre la paire sur le chart maître (patron MAP : la paire est vérifiée contre le
 * catalogue Binance réel, « sinon rien »). Bouton retour vers la table des groupes.
 *
 * Données : le fetch /coins/markets top 250 DÉJÀ budgété et caché 5 min
 * (data/marketOverview — SECT n'ajoute AUCUN appel réseau, épinglé en test), enrichi
 * des périodes 7 j/30 j sur la même requête. États Chargement / ErreurBloc / repli
 * cache périmé (« · cache ») hérités du pipeline overview, comme MAP.
 *
 * L'état local (drill-down, tri) est volontairement éphémère (useState) : la fenêtre
 * rouvre sur la vue groupes, il n'y a aucun réglage à retenir (contrairement à CORR).
 */
import { useEffect, useMemo, useState } from "react";
import { fetchMarketOverview, type MarketOverview } from "../data/marketOverview";
import { fetchPairs } from "../data/pairs";
import { agregerSecteurs, type AgregatSecteur, type MembreValorise } from "../data/secteurs";
import { navigateTo } from "../lib/navigation";
import { formatPct, formatPourcentage, formatUsd, VALEUR_ABSENTE } from "../lib/format";
import { classePct, paireOuvrable } from "./sectWindow.util";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "./TableTriable";
import {
  Bouton,
  BoutonRafraichir,
  Chargement,
  EnTeteFenetre,
  ErreurBloc,
  Fraicheur,
  NoteSource,
  Vide,
} from "./ui";

/** Cadence de rafraîchissement (le cache 5 min partagé absorbe les appels réseau). */
const REFRESH_MS = 5 * 60_000;

/** Perf colorée up/down, « — » estompé si valeur absente (non couvert / vieux cache). */
function Pct({ v }: { v: number | null }) {
  return <span className={classePct(v)}>{v === null ? VALEUR_ABSENTE : formatPct(v)}</span>;
}

/** Colonnes de la table des GROUPES (aucune capture d'état : définies au module). */
const COLONNES_GROUPES: readonly ColonneTable<AgregatSecteur>[] = [
  {
    id: "nom",
    label: "Secteur",
    largeur: "minmax(0,1.6fr)",
    triable: true,
    valeurTri: (g) => g.nom,
    rendu: (g) => <span className="truncate text-text">{g.nom}</span>,
  },
  {
    id: "p24h",
    label: "1 j",
    align: "right",
    triable: true,
    valeurTri: (g) => g.changePct24h,
    rendu: (g) => <Pct v={g.changePct24h} />,
  },
  {
    id: "p7j",
    label: "7 j",
    align: "right",
    triable: true,
    valeurTri: (g) => g.changePct7j,
    rendu: (g) => <Pct v={g.changePct7j} />,
  },
  {
    id: "p30j",
    label: "30 j",
    align: "right",
    triable: true,
    valeurTri: (g) => g.changePct30j,
    rendu: (g) => <Pct v={g.changePct30j} />,
  },
  {
    id: "cap",
    label: "Cap",
    align: "right",
    triable: true,
    valeurTri: (g) => g.mcapUsd,
    rendu: (g) => (g.mcapUsd > 0 ? formatUsd(g.mcapUsd) : VALEUR_ABSENTE),
  },
  {
    id: "membres",
    label: "Membres",
    align: "right",
    triable: true,
    valeurTri: (g) => g.couverts,
    rendu: (g) => (
      <span title={`${g.couverts} membres couverts par le top 250 CoinGecko sur ${g.total}`}>
        {g.couverts}/{g.total}
      </span>
    ),
  },
];

export function SectWindow() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Catalogue Binance (garde-fou du clic membre) — null tant que non chargé. */
  const [paires, setPaires] = useState<ReadonlySet<string> | null>(null);
  /** Incrémenté par ↻ : relance le pipeline (le cache 5 min partagé reste juge). */
  const [tick, setTick] = useState(0);
  const [groupeSel, setGroupeSel] = useState<string | null>(null);
  const [triGroupes, setTriGroupes] = useState<TriTable | null>({ colonne: "cap", dir: -1 });
  const [triMembres, setTriMembres] = useState<TriTable | null>({ colonne: "cap", dir: -1 });

  // — Chargement via le pipeline overview (cache 5 min, repli cache périmé) —
  useEffect(() => {
    let ignore = false;
    const charger = async () => {
      setLoading(true);
      try {
        const ov = await fetchMarketOverview();
        if (ignore) return;
        setOverview(ov);
        // `ov.stale` (repli cache périmé) est un avertissement signalé dans
        // l'en-tête (« · cache ») ; `error` reste réservé aux échecs durs.
        setError(null);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Secteurs indisponibles.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void charger();
    const timer = setInterval(charger, REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [tick]);

  // — Catalogue Binance (une fois par session, mémoïsé dans data/pairs) —
  useEffect(() => {
    let ignore = false;
    void fetchPairs("binance")
      .then((liste) => {
        if (!ignore) setPaires(new Set(liste));
      })
      .catch(() => {
        /* best-effort : sans catalogue, le clic membre ne navigue simplement pas */
      });
    return () => {
      ignore = true;
    };
  }, []);

  const agregats = useMemo(() => (overview === null ? [] : agregerSecteurs(overview.coins)), [overview]);
  const groupe = useMemo(
    () => agregats.find((g) => g.id === groupeSel) ?? null,
    [agregats, groupeSel],
  );

  // — Colonnes de la table des MEMBRES (capture le catalogue pour l'infobulle) —
  const colonnesMembres = useMemo<readonly ColonneTable<MembreValorise>[]>(
    () => [
      {
        id: "actif",
        label: "Actif",
        largeur: "minmax(0,1.6fr)",
        triable: true,
        valeurTri: (m) => m.membre.ticker,
        rendu: (m) => {
          const paire = paireOuvrable(m.membre.paireBinance, paires);
          return (
            <span
              className="flex min-w-0 items-baseline gap-1.5"
              title={
                paire !== null
                  ? `Ouvrir ${paire} dans le chart`
                  : !m.couvert
                    ? "Hors top 250 CoinGecko (non couvert)"
                    : paires === null
                      ? "Catalogue Binance non chargé — clic inactif"
                      : "Non cotée sur Binance"
              }
            >
              <span className={m.couvert ? "text-text" : "text-text-dim"}>{m.membre.ticker}</span>
              {m.nom !== null && <span className="truncate text-[10px] text-text-dim">{m.nom}</span>}
            </span>
          );
        },
      },
      {
        id: "p24h",
        label: "1 j",
        align: "right",
        triable: true,
        valeurTri: (m) => m.changePct24h,
        rendu: (m) => <Pct v={m.changePct24h} />,
      },
      {
        id: "p7j",
        label: "7 j",
        align: "right",
        triable: true,
        valeurTri: (m) => m.changePct7j,
        rendu: (m) => <Pct v={m.changePct7j} />,
      },
      {
        id: "p30j",
        label: "30 j",
        align: "right",
        triable: true,
        valeurTri: (m) => m.changePct30j,
        rendu: (m) => <Pct v={m.changePct30j} />,
      },
      {
        id: "cap",
        label: "Cap",
        align: "right",
        triable: true,
        valeurTri: (m) => m.mcapUsd,
        rendu: (m) => (m.mcapUsd === null ? VALEUR_ABSENTE : formatUsd(m.mcapUsd)),
      },
      {
        id: "poids",
        label: "Poids",
        align: "right",
        triable: true,
        valeurTri: (m) => m.poidsPct,
        rendu: (m) => (m.poidsPct === null ? VALEUR_ABSENTE : formatPourcentage(m.poidsPct, 1)),
      },
    ],
    [paires],
  );

  /** Clic membre : ouvre la paire sur le chart maître si cotée Binance, sinon rien. */
  const surClicMembre = (m: MembreValorise) => {
    const paire = paireOuvrable(m.membre.paireBinance, paires);
    if (paire !== null) navigateTo({ symbol: paire, exchange: "binance", source: "sect" });
  };

  return (
    <>
      <EnTeteFenetre
        mnemo="SECT"
        titre="Secteurs crypto"
        sousTitre={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Mapping curé · perf pondérée par capitalisation</span>
            {overview !== null && (
              <span className={overview.stale ? "text-warn" : undefined}>
                <Fraicheur loading={loading} majTs={overview.fetchedAt} />
                {overview.stale ? " · cache" : ""}
              </span>
            )}
          </span>
        }
        actions={
          <BoutonRafraichir
            onClick={() => setTick((t) => t + 1)}
            disabled={loading}
            title="Rafraîchir (cache CoinGecko 5 min partagé avec MAP)"
          />
        }
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {error !== null && <ErreurBloc>{error}</ErreurBloc>}

        {overview === null ? (
          error === null && (loading ? <Chargement libelle="Chargement du top 250…" /> : <Vide>Secteurs indisponibles.</Vide>)
        ) : groupe === null ? (
          <TableTriable
            colonnes={COLONNES_GROUPES}
            lignes={trierLignes(agregats, COLONNES_GROUPES, triGroupes)}
            tri={triGroupes}
            onTri={setTriGroupes}
            cle={(g) => g.id}
            vide="Aucun secteur."
            surClicLigne={(g) => setGroupeSel(g.id)}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Bouton onClick={() => setGroupeSel(null)}>← Groupes</Bouton>
              <span className="text-[11px] font-medium text-text">{groupe.nom}</span>
              <span className="text-[11px] text-text-dim">
                {groupe.couverts}/{groupe.total} membres · Cap{" "}
                {groupe.mcapUsd > 0 ? formatUsd(groupe.mcapUsd) : VALEUR_ABSENTE}
              </span>
            </div>
            <TableTriable
              colonnes={colonnesMembres}
              lignes={trierLignes(groupe.membres, colonnesMembres, triMembres)}
              tri={triMembres}
              onTri={setTriMembres}
              cle={(m) => m.membre.id}
              vide="Aucun membre."
              surClicLigne={surClicMembre}
            />
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 py-1.5">
        <NoteSource>
          Données CoinGecko (top 250, cache 5 min partagé). Mapping curé — un actif peut
          appartenir à plusieurs secteurs ; membre hors top 250 = non couvert, affiché sans re-fetch.
        </NoteSource>
      </div>
    </>
  );
}
