/**
 * OnboardingOverlay — parcours premier lancement en 3 étapes (≤5 min).
 *
 * (1) Bienvenue + playbook Scalp (DES + DOM + orderflow)
 * (2) Clé Coinalyze optionnelle (jamais stockée dans le state React)
 * (3) Création d'une alerte prix démo
 *
 * Piloté par `onboardingStore` (vanilla + localStorage). Skip / complete
 * persistent ; rejouable via ⌘K → ONBOARD. Z-index au-dessus des panneaux
 * (settings z-50) pour capturer l'attention au boot.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  ONBOARDING_TOTAL_STEPS,
  appliquerPlaybookScalp,
  creerAlerteDemo,
  doitAfficherOnboarding,
  onboardingStore,
} from "../store/onboarding";
import { coinalyzeKeyStore } from "../store/coinalyze";
import { BTN_SECONDAIRE } from "./ui";

/** Clé locale « présence clé perso » sans exposer la valeur (coinalyze hasKey est toujours true). */
const COINALYZE_KEY_LS = "axiom:coinalyze:key";

function aCleCoinalyzePersonnelle(): boolean {
  try {
    const v = localStorage.getItem(COINALYZE_KEY_LS);
    return v !== null && v.length > 0;
  } catch {
    return false;
  }
}

export function OnboardingOverlay() {
  const completed = useStore(onboardingStore, (s) => s.completed);
  const step = useStore(onboardingStore, (s) => s.step);
  const next = useStore(onboardingStore, (s) => s.next);
  const skip = useStore(onboardingStore, (s) => s.skip);
  const complete = useStore(onboardingStore, (s) => s.complete);

  const visible = doitAfficherOnboarding(completed);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Brouillon clé : state local uniquement, vidé après save / step change (jamais loggé).
  const [draftKey, setDraftKey] = useState("");
  const [clePerso, setClePerso] = useState(aCleCoinalyzePersonnelle);
  const [alerteCreee, setAlerteCreee] = useState(false);
  const [scalpApplique, setScalpApplique] = useState(false);

  // Reset UI locale quand on rejoue (step repasse à 0).
  useEffect(() => {
    if (step === 0 && !completed) {
      setDraftKey("");
      setAlerteCreee(false);
      setScalpApplique(false);
      setClePerso(aCleCoinalyzePersonnelle());
    }
  }, [step, completed]);

  // Focus + Échap = skip (ne bloque pas le terminal indéfiniment).
  useEffect(() => {
    if (!visible) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, skip]);

  if (!visible) return null;

  const etapeAffichee = step + 1;

  const appliquerScalp = () => {
    appliquerPlaybookScalp();
    setScalpApplique(true);
  };

  const enregistrerCle = () => {
    const k = draftKey.trim();
    if (k.length === 0) return;
    coinalyzeKeyStore.getState().setKey(k);
    setDraftKey("");
    setClePerso(true);
  };

  const creerAlerte = () => {
    creerAlerteDemo();
    setAlerteCreee(true);
  };

  const finir = () => {
    if (step >= ONBOARDING_TOTAL_STEPS - 1) complete();
    else next();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-titre"
        tabIndex={-1}
        className="flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-dim">
              Onboarding · {etapeAffichee}/{ONBOARDING_TOTAL_STEPS}
            </p>
            <h2 id="onboarding-titre" className="mt-0.5 text-sm font-semibold text-text">
              {step === 0 && "Bienvenue sur AXIOM"}
              {step === 1 && "Clé Coinalyze (optionnel)"}
              {step === 2 && "Première alerte prix"}
            </h2>
          </div>
          <button
            type="button"
            onClick={skip}
            aria-label="Passer l'onboarding"
            className="shrink-0 rounded px-2 py-1 text-[11px] text-text-dim transition hover:bg-bg hover:text-text"
          >
            Passer
          </button>
        </header>

        {/* Barre de progression */}
        <div className="flex gap-1 px-4 pt-3" aria-hidden>
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="space-y-3 px-4 py-4 text-[12px] leading-relaxed text-text-dim">
          {step === 0 && (
            <>
              <p>
                Terminal crypto mono-utilisateur : graphe, orderflow, dérivés et alertes —
                sans multi-tenant ni Electron.
              </p>
              <p>
                <strong className="text-text">Étape 1 — layout Scalp :</strong> ouvre les
                panneaux Dérivés (DES) et carnet (DOM), active l&apos;orderflow, bascule en{" "}
                <span className="text-text">1m</span>.
              </p>
              <button
                type="button"
                onClick={appliquerScalp}
                className="w-full rounded border border-accent/50 bg-accent/10 px-3 py-2 text-[12px] font-medium text-text transition hover:bg-accent/20"
              >
                {scalpApplique ? "Layout Scalp appliqué ✓" : "Appliquer le layout Scalp"}
              </button>
              <p className="text-[11px]">
                Astuce : <kbd className="rounded border border-border px-1">⌘K</kbd> ouvre la
                palette (mnémoniques DES, DOM, OF, ALRT…).
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <p>
                Coinalyze alimente OI, funding, liquidations et long/short. Une clé perso
                optionnelle remplace le repli serveur.{" "}
                <strong className="text-text">La clé n&apos;est jamais affichée ni loggée</strong>{" "}
                — stockée localement uniquement.
              </p>
              {clePerso ? (
                <p className="rounded border border-up/40 bg-bg px-3 py-2 text-[11px] text-up">
                  Clé personnelle déjà configurée — vous pouvez passer.
                </p>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder="Clé API Coinalyze (optionnel)"
                    className="w-full rounded border border-border bg-bg px-3 py-2 text-[12px] text-text outline-none placeholder:text-text-dim focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={enregistrerCle}
                      disabled={draftKey.trim().length === 0}
                      className={`${BTN_SECONDAIRE} disabled:opacity-40`}
                    >
                      Enregistrer
                    </button>
                    <a
                      href="https://coinalyze.net"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-accent underline-offset-2 hover:underline"
                    >
                      Obtenir une clé
                    </a>
                  </div>
                </div>
              )}
              <p className="text-[11px]">
                Configurable plus tard dans Réglages (⚙). Cette étape est facultative.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <p>
                Créez une alerte prix démo sur le symbole courant (+1 % au-dessus du dernier
                close). Elle apparaît dans le panneau Alertes (sidebar) et sera évaluée par le
                runtime.
              </p>
              <button
                type="button"
                onClick={creerAlerte}
                disabled={alerteCreee}
                className="w-full rounded border border-accent/50 bg-accent/10 px-3 py-2 text-[12px] font-medium text-text transition hover:bg-accent/20 disabled:opacity-60"
              >
                {alerteCreee ? "Alerte démo créée ✓" : "Créer l'alerte démo"}
              </button>
              <p className="text-[11px]">
                Ensuite : ⌘K → ONBOARD pour rejouer ce parcours, ou AIDE pour les raccourcis.
              </p>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={skip}
            className="text-[11px] text-text-dim transition hover:text-text"
          >
            Ne plus afficher
          </button>
          <button
            type="button"
            onClick={finir}
            className="rounded border border-accent bg-accent/20 px-3 py-1.5 text-[12px] font-medium text-text transition hover:bg-accent/30"
          >
            {step >= ONBOARDING_TOTAL_STEPS - 1 ? "Terminer" : "Suivant"}
          </button>
        </footer>
      </div>
    </div>
  );
}
