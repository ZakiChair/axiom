/**
 * SettingsPanel — panneau Réglages dédié (slide-over depuis la droite).
 *
 * CENTRALISE toute la configuration jusqu'ici éparpillée dans la sidebar :
 *  - les clés API (Coinalyze pour les dérivés, FRED pour le M2 macro) ;
 *  - le choix du thème (réutilise le ThemeSwitcher existant).
 *
 * Ouvert/fermé via le store vanilla `settings-ui`. Trois chemins de fermeture :
 * bouton ✕, clic sur l'overlay, touche Échap. Le panneau reste monté (transition
 * de glissement à l'ouverture ET à la fermeture) ; quand il est fermé, le
 * conteneur passe en `pointer-events-none` pour ne rien intercepter.
 *
 * Sécurité des clés : on NE stocke JAMAIS la valeur d'une clé dans le state React.
 * Chaque champ ne tient qu'un brouillon local transmis à `setKey`/`clearKey` des
 * stores existants (coinalyze, fred) — aucune duplication du stockage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { settingsUiStore } from "../store/settings-ui";
import { onboardingStore } from "../store/onboarding";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { fredKeyStore } from "../store/macro";
import { bgeometricsKeyStore } from "../store/onchain";
import { soSoValueKeyStore } from "../store/sosovalue";
import { finnhubKeyStore } from "../store/finnhub";
import { etherscanKeyStore } from "../store/etherscan";
import { coingeckoKeyStore } from "../store/coingecko";
import { risqueStore } from "../store/risque";
import { refSymbolStore } from "../store/refSymbol";
import { fetchPairs } from "../data/pairs";
import {
  creerSnapshot,
  listerSnapshots,
  restaurerSnapshot,
  type MetaSnapshot,
} from "../data/daemon";
import { formatCompact, formatDateHeure } from "../lib/format";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Badge, BTN_SECONDAIRE, Chargement, Vide } from "./ui";

interface ApiKeyFieldProps {
  /** Nom de la source (ex. « Coinalyze »). */
  name: string;
  /** À quoi sert la clé (une phrase). */
  purpose: string;
  /** Domaine destinataire de la clé (note de confidentialité). */
  domain: string;
  /** Lien « où obtenir une clé » + son libellé. */
  signupUrl: string;
  signupLabel: string;
  /** Placeholder du champ de saisie. */
  placeholder: string;
  /** État + actions du store de clé (réutilisés tels quels, jamais dupliqués). */
  hasKey: boolean;
  onSave: (key: string) => void;
  onClear: () => void;
}

/**
 * Un bloc « clé API » : champ password + Enregistrer / Modifier / Supprimer,
 * état configuré/non configuré, note de stockage local. Le brouillon vit en
 * state LOCAL (jamais loggé, jamais persisté).
 */
function ApiKeyField({
  name,
  purpose,
  domain,
  signupUrl,
  signupLabel,
  placeholder,
  hasKey,
  onSave,
  onClear,
}: ApiKeyFieldProps) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  // Formulaire visible si aucune clé OU si l'utilisateur a cliqué « Modifier ».
  const showForm = !hasKey || editing;

  const save = () => {
    onSave(draft);
    setDraft("");
    setEditing(false);
  };

  const remove = () => {
    onClear();
    setDraft("");
    setEditing(false);
  };

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-text">{name}</span>
        <Badge ton={hasKey ? "up" : "neutre"}>
          {hasKey ? "clé ✓ configurée" : "non configurée"}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-text-dim">{purpose}</p>

      {showForm ? (
        <div className="mt-2 space-y-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              className="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-ink transition hover:opacity-90"
            >
              Enregistrer
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                }}
                className="rounded border border-border bg-surface px-3 py-1.5 text-[11px] text-text-dim transition hover:text-text"
              >
                Annuler
              </button>
            )}
            {hasKey && (
              <button
                type="button"
                onClick={remove}
                className="rounded border border-border bg-surface px-3 py-1.5 text-[11px] text-down transition hover:opacity-90"
              >
                Supprimer
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-border bg-surface px-3 py-1.5 text-[11px] text-text-dim transition hover:text-text"
          >
            Modifier
          </button>
          <button
            type="button"
            onClick={remove}
            className="rounded border border-border bg-surface px-3 py-1.5 text-[11px] text-down transition hover:opacity-90"
          >
            Supprimer
          </button>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-snug text-text-dim">
        Stockée localement (localStorage), envoyée uniquement à {domain}.{" "}
        <a
          href={signupUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:underline"
        >
          {signupLabel}
        </a>
      </p>
    </div>
  );
}

/**
 * Section « Sauvegardes » : snapshots quotidiens versionnés du KV daemon. La restauration
 * ré-applique l'espace de travail miroité au daemon (graphique, watchlist, disposition des
 * fenêtres, état de session) — cf. store/persist.ts. Alertes, notes, portefeuille,
 * workspaces, dessins, thème et clés API ne sont PAS ré-appliqués : pour une sauvegarde
 * complète, utiliser l'export/import manuel de la Toolbar.
 *
 * Feature-detect : `listerSnapshots()` renvoie `null` si le daemon est absent → on
 * affiche l'état indisponible (le front reste 100 % fonctionnel sans daemon). La
 * restauration est DESTRUCTIVE : confirmation explicite en DEUX temps (1er clic arme,
 * 2e restaure) ; le daemon fige un snapshot pré-restauration avant de remplacer.
 */
/**
 * Section RISQUE — capital de référence et risque toléré par trade, utilisés par
 * l'outil position (chart/position.ts) pour afficher une taille de position.
 *
 * Capital vide = NON PARAMÉTRÉ : l'outil affiche alors « capital non paramétré »
 * plutôt qu'une taille calculée sur une valeur inventée.
 */
/**
 * Section « Indicateurs croisés » : le symbole de référence (refSymbol) dont la
 * close alimente corrélation / bêta / spread z-score. Brouillon LOCAL (saisie en
 * MAJUSCULES, patron de l'input watchlist), commité au store sur Entrée / blur —
 * une saisie vide retombe sur la valeur courante (le store ignore le vide).
 */
function RefSymbolSection() {
  const refSymbol = useStore(refSymbolStore, (s) => s.refSymbol);
  const [draft, setDraft] = useState(refSymbol);
  // Statut de disponibilité du symbole committé sur le catalogue spot Binance (la
  // MÊME source que le fetch refClose des indicateurs croisés) : "verif" pendant le
  // contrôle, "ok" présent, "indispo" absent. On ACCEPTE la valeur (accept-and-warn) :
  // un symbole inconnu produit ici un état visible plutôt que des panes statistiques
  // muets (refClose retombe alors sur une série vide, par conception de l'auxProvider).
  const [statutRef, setStatutRef] = useState<"verif" | "ok" | "indispo">("ok");

  // Le store peut changer ailleurs (restauration de session) : on resynchronise
  // le brouillon quand la valeur committée bouge.
  useEffect(() => setDraft(refSymbol), [refSymbol]);

  // Valide le symbole committé contre le catalogue spot Binance (`fetchPairs`, mémoïsé
  // par session → au plus un fetch réseau). Garde `ignore` contre un résultat périmé si
  // la valeur change avant la résolution. Catalogue injoignable → on n'alarme pas
  // (impossible de conclure), l'indicateur reste "ok".
  useEffect(() => {
    let ignore = false;
    setStatutRef("verif");
    fetchPairs("binance")
      .then((paires) => {
        if (!ignore) setStatutRef(paires.includes(refSymbol) ? "ok" : "indispo");
      })
      .catch(() => {
        if (!ignore) setStatutRef("ok");
      });
    return () => {
      ignore = true;
    };
  }, [refSymbol]);

  const commit = () => {
    refSymbolStore.getState().setRefSymbol(draft);
    // Le store a pu normaliser ou ignorer : on réaligne le brouillon sur la vérité.
    setDraft(refSymbolStore.getState().refSymbol);
  };

  return (
    <>
      <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
        Indicateurs croisés
      </h3>
      <p className="mt-1 text-[11px] leading-snug text-text-dim">
        Symbole de référence commun aux indicateurs statistiques (corrélation, bêta,
        spread z-score). Sa close est alignée sur les bougies du chart.
      </p>
      <div className="mt-3">
        <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <span className="min-w-0">
            <span className="text-sm text-text">Symbole de référence (indicateurs croisés)</span>
            <span className="block text-[11px] text-text-dim">Spot Binance, ex. BTCUSDT.</span>
          </span>
          <input
            aria-label="Symbole de référence des indicateurs croisés"
            className="w-28 shrink-0 rounded border border-border bg-panel px-2 py-1 text-right text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
            value={draft}
            placeholder="BTCUSDT"
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>
        {statutRef === "indispo" && (
          <p className="mt-1 text-[11px] leading-snug text-down">
            « {refSymbol} » indisponible sur le spot Binance — indicateurs croisés
            inactifs jusqu'à correction.
          </p>
        )}
      </div>
    </>
  );
}

function RisqueSection() {
  const capital = useStore(risqueStore, (s) => s.capital);
  const risquePct = useStore(risqueStore, (s) => s.risquePct);

  return (
    <>
      <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
        Risque
      </h3>
      <p className="mt-1 text-[11px] leading-snug text-text-dim">
        Sert au dimensionnement affiché par l'outil position. Aucun ordre n'est passé,
        aucune position réelle n'est lue.
      </p>
      <div className="mt-3 space-y-2">
        <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <span className="min-w-0">
            <span className="text-sm text-text">Capital de référence</span>
            <span className="block text-[11px] text-text-dim">
              En USD. Vide = taille de position non affichée.
            </span>
          </span>
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            aria-label="Capital de référence en USD"
            className="w-28 shrink-0 rounded border border-border bg-panel px-2 py-1 text-right text-sm tabular-nums text-text"
            value={capital ?? ""}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value.trim();
              risqueStore.getState().setCapital(v === "" ? null : Number(v));
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
          <span className="min-w-0">
            <span className="text-sm text-text">Risque par trade</span>
            <span className="block text-[11px] text-text-dim">
              En % du capital, perdu si le stop est touché.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <input
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              inputMode="decimal"
              aria-label="Risque par trade en pourcent"
              className="w-16 rounded border border-border bg-panel px-2 py-1 text-right text-sm tabular-nums text-text"
              value={risquePct}
              onChange={(e) => risqueStore.getState().setRisquePct(Number(e.target.value))}
            />
            <span className="text-sm text-text-dim">%</span>
          </span>
        </label>
      </div>
    </>
  );
}

function SauvegardesSection({ open }: { open: boolean }) {
  // undefined = pas encore chargé ; null = daemon indisponible ; tableau = liste.
  const [snapshots, setSnapshots] = useState<MetaSnapshot[] | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  // Snapshot armé pour restauration (confirmation en deux temps).
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const rafraichir = useCallback(async () => {
    setSnapshots(await listerSnapshots());
  }, []);

  // Charge la liste à l'ouverture du panneau ; réinitialise l'armement à la fermeture.
  useEffect(() => {
    if (open) {
      void rafraichir();
    } else {
      setConfirmId(null);
      setMessage(null);
    }
  }, [open, rafraichir]);

  const snapshotImmediat = async () => {
    setConfirmId(null);
    const meta = await creerSnapshot();
    setMessage(meta ? "Snapshot créé." : "Échec : daemon indisponible.");
    if (meta) await rafraichir();
  };

  const restaurer = async (id: number) => {
    // 1er clic : on ARME la confirmation ; 2e clic sur le même snapshot : on restaure.
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    const ok = await restaurerSnapshot(id);
    setMessage(
      ok
        ? "Restauré. Rechargez la page pour appliquer (les stores hydratent au démarrage)."
        : "Échec de la restauration.",
    );
    await rafraichir();
  };

  return (
    <>
      <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
        Sauvegardes
      </h3>
      <p className="mt-1 text-[11px] leading-snug text-text-dim">
        Snapshots quotidiens automatiques du KV daemon (conservés 30 jours). La restauration
        ré-applique le graphique, la watchlist, la disposition des fenêtres et l'état de session.
      </p>

      {message !== null && <p className="mt-2 text-[11px] text-accent">{message}</p>}

      {snapshots === undefined ? (
        <div className="mt-3">
          <Chargement libelle="Chargement des sauvegardes…" />
        </div>
      ) : snapshots === null ? (
        <div className="mt-3">
          <Vide>Sauvegardes indisponibles — le daemon axiomd n'est pas actif.</Vide>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void snapshotImmediat()} className={BTN_SECONDAIRE}>
              Snapshot immédiat
            </button>
            <button type="button" onClick={() => void rafraichir()} className={BTN_SECONDAIRE}>
              Rafraîchir
            </button>
          </div>

          {snapshots.length === 0 ? (
            <div className="mt-3">
              <Vide>Aucune sauvegarde pour l'instant.</Vide>
            </div>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {snapshots.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-[11px] text-text">{formatDateHeure(s.ts)}</span>
                    <Badge title="taille du snapshot">{formatCompact(s.taille)}</Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    {confirmId === s.id && <Badge ton="down">écrase l'état actuel</Badge>}
                    <button
                      type="button"
                      onClick={() => void restaurer(s.id)}
                      className={
                        confirmId === s.id
                          ? "rounded border border-down bg-bg px-2 py-1 text-[11px] text-down transition hover:opacity-90"
                          : BTN_SECONDAIRE
                      }
                    >
                      {confirmId === s.id ? "Confirmer" : "Restaurer"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[10px] leading-snug text-text-dim">
            La restauration REMPLACE le graphique, la watchlist, la disposition et la session par
            ce snapshot (l'état actuel est d'abord sauvegardé automatiquement) ; rechargez ensuite.
            Alertes, notes, portefeuille, workspaces, dessins, thème et clés API ne sont PAS
            couverts — utilisez l'export manuel de la Toolbar pour une sauvegarde complète.
          </p>
        </>
      )}
    </>
  );
}

export function SettingsPanel() {
  const open = useStore(settingsUiStore, (s) => s.open);
  const closeSettings = useStore(settingsUiStore, (s) => s.closeSettings);

  const coinalyzeHasKey = useStore(coinalyzeKeyStore, (s) => s.hasKey);
  const coinalyzeSetKey = useStore(coinalyzeKeyStore, (s) => s.setKey);
  const coinalyzeClearKey = useStore(coinalyzeKeyStore, (s) => s.clearKey);

  const fredHasKey = useStore(fredKeyStore, (s) => s.hasKey);
  const fredSetKey = useStore(fredKeyStore, (s) => s.setKey);
  const fredClearKey = useStore(fredKeyStore, (s) => s.clearKey);

  const bgHasKey = useStore(bgeometricsKeyStore, (s) => s.hasKey);
  const bgSetKey = useStore(bgeometricsKeyStore, (s) => s.setKey);
  const bgClearKey = useStore(bgeometricsKeyStore, (s) => s.clearKey);

  const soSoHasKey = useStore(soSoValueKeyStore, (s) => s.hasKey);
  const soSoSetKey = useStore(soSoValueKeyStore, (s) => s.setKey);
  const soSoClearKey = useStore(soSoValueKeyStore, (s) => s.clearKey);

  const finnhubHasKey = useStore(finnhubKeyStore, (s) => s.hasKey);
  const finnhubSetKey = useStore(finnhubKeyStore, (s) => s.setKey);
  const finnhubClearKey = useStore(finnhubKeyStore, (s) => s.clearKey);

  const etherscanHasKey = useStore(etherscanKeyStore, (s) => s.hasKey);
  const etherscanSetKey = useStore(etherscanKeyStore, (s) => s.setKey);
  const etherscanClearKey = useStore(etherscanKeyStore, (s) => s.clearKey);

  const cgHasKey = useStore(coingeckoKeyStore, (s) => s.hasKey);
  const cgSetKey = useStore(coingeckoKeyStore, (s) => s.setKey);
  const cgClearKey = useStore(coingeckoKeyStore, (s) => s.clearKey);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // Échap ferme — écouteur actif UNIQUEMENT quand le panneau est ouvert.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    // Focus le panneau à l'ouverture (a11y : Échap/Tab opèrent dans le dialogue).
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSettings]);

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Overlay (clic = fermeture) — frère du panneau, pas de propagation à gérer. */}
      <div
        onClick={closeSettings}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Panneau glissant depuis la droite. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Réglages"
        tabIndex={-1}
        className={`absolute right-0 top-0 flex h-full w-[min(380px,92vw)] flex-col border-l border-border bg-surface shadow-2xl outline-none transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* En-tête du panneau. */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text">Réglages</h2>
            <p className="text-[11px] text-text-dim">Clés API et apparence</p>
          </div>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Fermer les réglages"
            className="rounded p-1 text-lg leading-none text-text-dim transition hover:bg-bg hover:text-text"
          >
            ✕
          </button>
        </header>

        {/* Corps défilable. */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* --- Clés API --- */}
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Clés API
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-text-dim">
            Saisissez vos clés personnelles (gratuites). Elles restent sur cet appareil.
          </p>

          <div className="mt-3 space-y-3">
            <ApiKeyField
              name="Coinalyze"
              purpose="Dérivés — Open Interest, funding, long/short et liquidations (Binance)."
              domain="api.coinalyze.net"
              signupUrl="https://coinalyze.net"
              signupLabel="Obtenir une clé"
              placeholder="Clé API Coinalyze"
              hasKey={coinalyzeHasKey}
              onSave={coinalyzeSetKey}
              onClear={coinalyzeClearKey}
            />
            <ApiKeyField
              name="FRED (M2 US)"
              purpose="Masse monétaire — série M2 hebdomadaire de la Fed de Saint-Louis."
              domain="api.stlouisfed.org"
              signupUrl="https://fredaccount.stlouisfed.org/apikeys"
              signupLabel="Obtenir une clé"
              placeholder="Clé API FRED"
              hasKey={fredHasKey}
              onSave={fredSetKey}
              onClear={fredClearKey}
            />
            <ApiKeyField
              name="BGeometrics (on-chain)"
              purpose="Valorisation BTC — MVRV Z-Score, SOPR, NUPL. Optionnelle : la source marche sans clé (quota 15 req/jour) ; une clé relève ce quota."
              domain="bitcoin-data.com"
              signupUrl="https://bitcoin-data.com"
              signupLabel="Clé gratuite"
              placeholder="Clé API BGeometrics (optionnelle)"
              hasKey={bgHasKey}
              onSave={bgSetKey}
              onClear={bgClearKey}
            />
            <ApiKeyField
              name="SoSoValue (ETF)"
              purpose="Flux ETF spot BTC/ETH/SOL — plan Demo gratuit. Optionnelle si SOSOVALUE_API_KEY est renseignée dans .env (repli proxy) ; une clé saisie ici reste prioritaire."
              domain="openapi.sosovalue.com"
              signupUrl="https://sosovalue.com/developer"
              signupLabel="Obtenir une clé gratuite"
              placeholder="Clé API SoSoValue"
              hasKey={soSoHasKey}
              onSave={soSoSetKey}
              onClear={soSoClearKey}
            />
            <ApiKeyField
              name="Finnhub"
              purpose="Fondamentaux, earnings (FUND) et actualités générales (NEWS)."
              domain="finnhub.io"
              signupUrl="https://finnhub.io/register"
              signupLabel="Obtenir une clé gratuite"
              placeholder="Clé API Finnhub"
              hasKey={finnhubHasKey}
              onSave={finnhubSetKey}
              onClear={finnhubClearKey}
            />
            <ApiKeyField
              name="Etherscan v2"
              purpose="Réseau ETH — gas recommandé, supply, nombre de nœuds. Optionnelle si ETHERSCAN_API_KEY est renseignée dans .env (repli proxy) ; une clé saisie ici reste prioritaire."
              domain="api.etherscan.io"
              signupUrl="https://etherscan.io/register"
              signupLabel="Obtenir une clé gratuite"
              placeholder="Clé API Etherscan"
              hasKey={etherscanHasKey}
              onSave={etherscanSetKey}
              onClear={etherscanClearKey}
            />
            <ApiKeyField
              name="CoinGecko (Demo)"
              purpose="Capitalisations et dominances (fenêtre CAP, treemap MAP). Optionnelle : tout marche sans clé, mais elle relève les quotas — la reconstruction de l'historique CAP passe d'environ 15 min à 3,5 min."
              domain="api.coingecko.com"
              signupUrl="https://www.coingecko.com/en/developers/dashboard"
              signupLabel="Clé gratuite"
              placeholder="Clé Demo CoinGecko (optionnelle)"
              hasKey={cgHasKey}
              onSave={cgSetKey}
              onClear={cgClearKey}
            />
          </div>

          {/* --- Apparence --- */}
          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Apparence
          </h3>
          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2.5">
            <span className="text-sm text-text">Thème</span>
            <ThemeSwitcher />
          </div>

          {/* --- Indicateurs croisés (symbole de référence) --- */}
          <RefSymbolSection />

          {/* --- Risque (dimensionnement de l'outil position) --- */}
          <RisqueSection />

          {/* --- Onboarding --- */}
          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Aide
          </h3>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
            <div className="min-w-0">
              <span className="text-sm text-text">Onboarding</span>
              <p className="text-[11px] text-text-dim">
                Parcours 3 étapes (Scalp · Coinalyze · alerte). Aussi via ⌘K → ONBOARD.
              </p>
            </div>
            <button
              type="button"
              className={BTN_SECONDAIRE}
              onClick={() => {
                onboardingStore.getState().rejouer();
                closeSettings();
              }}
            >
              Relancer
            </button>
          </div>

          {/* --- Sauvegardes (snapshots quotidiens du KV daemon) --- */}
          <SauvegardesSection open={open} />
        </div>
      </div>
    </div>
  );
}
