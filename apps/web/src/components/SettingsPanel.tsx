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
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { settingsUiStore } from "../store/settings-ui";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { fredKeyStore } from "../store/macro";
import { bgeometricsKeyStore } from "../store/onchain";
import { ThemeSwitcher } from "./ThemeSwitcher";

/** Pastille d'état de configuration d'une clé. */
function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        configured ? "border-up text-up" : "border-border text-text-dim"
      }`}
    >
      {configured ? "clé ✓ configurée" : "non configurée"}
    </span>
  );
}

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
        <StatusBadge configured={hasKey} />
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
            className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
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
          </div>

          {/* --- Apparence --- */}
          <h3 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-dim">
            Apparence
          </h3>
          <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2.5">
            <span className="text-sm text-text">Thème</span>
            <ThemeSwitcher />
          </div>
        </div>
      </div>
    </div>
  );
}
