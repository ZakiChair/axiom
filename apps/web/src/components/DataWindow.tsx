/**
 * Fenêtre « DATA » — observabilité des sources de données (vue détaillée du `healthStore`).
 *
 * Le rendu ne collecte rien : il projette le registre `healthStore` (alimenté par
 * les adaptateurs WS et les pollers) en une liste ordonnée « erreurs d'abord ». Les actions
 * explicites n'utilisent que les capacités connues de chaque source, après un clic. Pendant que
 * HealthPanel est la section repliable de la sidebar, DATA est la fenêtre plein format :
 * état, fraîcheur, quota et dernière erreur par source, triés pour porter l'attention là où
 * ça casse.
 *
 * Perf (BUILD-CONTRACT « pas de re-render sur tick ») : l'abonnement au store passe par une
 * SIGNATURE qui EXCLUT `dernierMessageTs` (sinon re-render sur chaque message WS ~1/s) ; la
 * fraîcheur relative « vit » via un tick d'affichage léger (10 s) qui force un re-rendu, lequel
 * relit l'horloge et re-trie. Couleurs par tokens de thème (aucun hex), pastilles réutilisées
 * de HealthPanel pour rester COHÉRENT avec la ligne « Santé » du bas.
 *
 * Section « Caches » de la spec §5 OMISE : le repo n'expose aucun inventaire de cache lisible
 * sans nouvelle plomberie (caches ad hoc par module) ; l'ajouter violerait « zéro collecte ».
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { healthStore, type QuotaSource, type SanteSource } from "../store/health";
import { dotClass, etatLabel, formatQuota } from "./HealthPanel";
import { trierSources, formatFraicheur, type LigneData } from "../data/dataCockpit";
import { actionsSourceData, executerActionData } from "../data/dataActions";
import { Badge, Bouton, EnTeteFenetre, NoteSource, Vide } from "./ui";
import { qualiteMetriquesStore } from "../store/qualiteMetriques";
import { QualiteMetrique } from "./QualiteMetrique";

/**
 * Signature de re-rendu : change quand la composition, l'état, le quota ou l'erreur d'une
 * source bouge — mais PAS quand seul `dernierMessageTs` change (géré par le tick 10 s).
 * Même principe que `panelSignature` de HealthPanel.
 */
function signatureRegistre(sources: Record<string, SanteSource>): string {
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

/** Fraction utilisée [0,1] du quota (fenêtre principale). PURE. */
function ratioQuota(q: QuotaSource): number {
  return q.limite > 0 ? q.utilise / q.limite : 0;
}

/** Barre de quota : remplissage proportionnel, teinte « down » au-delà de 80 %. */
function BarreQuota({ quota }: { quota: QuotaSource }) {
  const ratio = ratioQuota(quota);
  const chaud = ratio > 0.8;
  const pct = Math.min(100, Math.round(ratio * 100));
  return (
    <span className="flex items-center gap-1.5" title={`Quota : ${formatQuota(quota)}`}>
      <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface">
        <span
          aria-hidden
          className={`block h-full ${chaud ? "bg-down" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={`shrink-0 tabular-nums ${chaud ? "text-down" : "text-text-dim"}`}>
        {formatQuota(quota)}
      </span>
    </span>
  );
}

interface RetourAction {
  phase: "en-cours" | "succes" | "erreur";
  message: string;
}

/** Un échec reste local à sa source, même si une autre action ouvre une fenêtre. */
function LigneSource({ ligne: l }: { ligne: LigneData }) {
  const capacites = actionsSourceData(l.id);
  const [retour, setRetour] = useState<RetourAction | null>(null);
  const enCours = useRef(false);
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  async function lancer(id: string) {
    if (enCours.current) return;
    enCours.current = true;
    setRetour({ phase: "en-cours", message: "Action en cours…" });
    try {
      const message = await executerActionData(l.id, id);
      if (monte.current) setRetour({ phase: "succes", message });
    } catch (erreur) {
      if (monte.current) setRetour({
        phase: "erreur",
        message: erreur instanceof Error ? erreur.message : "L'action a échoué. Réessayez depuis la fenêtre concernée.",
      });
    } finally {
      enCours.current = false;
    }
  }

  return (
    <li data-source-id={l.id} className="space-y-2 rounded border border-border px-2.5 py-2 text-[11px] leading-relaxed">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(l.etat)}`} />
        <span className="break-words font-medium text-text" title={l.id}>{l.libelle}</span>
        <span className="text-text-dim">{etatLabel(l.etat)}</span>
        <span className="tabular-nums text-text-dim">{formatFraicheur(l.fraicheurMs)}</span>
        {l.quota && <BarreQuota quota={l.quota} />}
      </div>
      {l.erreur && (
        <div className="break-words text-down">
          <span className="font-medium">Dernière erreur enregistrée : </span>
          <p>{l.erreur}</p>
        </div>
      )}
      <p className="text-text-dim">{capacites.motif}</p>
      {capacites.actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Actions ${l.libelle}`}>
          {capacites.actions.map((action) => action.type === "lien" ? (
            <a
              key={action.id}
              href={action.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-1 text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              {action.libelle}
            </a>
          ) : (
            <Bouton
              key={action.id}
              onClick={() => { void lancer(action.id); }}
              disabled={retour?.phase === "en-cours"}
              className="focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            >
              {action.libelle}
            </Bouton>
          ))}
        </div>
      )}
      {retour && (
        <p role="status" aria-live="polite" aria-atomic="true" className={`break-words ${retour.phase === "erreur" ? "text-down" : retour.phase === "succes" ? "text-up" : "text-text-dim"}`}>
          {retour.phase === "erreur" ? "Échec de l'action : " : ""}{retour.message}
        </p>
      )}
    </li>
  );
}

export function DataWindow() {
  // Abonnement piloté par la signature (hors `dernierMessageTs`) — cf. en-tête.
  const signature = useStore(healthStore, (s) => signatureRegistre(s.sources));
  const registreQualite = useStore(qualiteMetriquesStore, (s) => s.metriques);
  const qualites = Object.entries(registreQualite).sort(([a], [b]) => a.localeCompare(b));

  // Tick d'affichage 10 s : force un re-rendu pour rafraîchir les fraîcheurs relatives
  // sans dépendre du flot de messages WS (que la signature ignore volontairement).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  // Lu FRAIS à chaque rendu (déclenché par la signature ou le tick) ; `now` relu ici pour
  // que les fraîcheurs suivent l'horloge. `void signature` : dépendance de rendu explicite.
  void signature;
  const sources = healthStore.getState().sources;
  const lignes = trierSources(sources, Date.now());
  const nbErreurs = lignes.filter((l) => l.etat === "error").length;

  return (
    <>
      <EnTeteFenetre
        mnemo="DATA"
        titre="Sources de données"
        sousTitre="État, fraîcheur, quota et actions disponibles par source"
        actions={
          <span className="flex items-center gap-2 text-[11px] text-text-dim">
            <span className="tabular-nums">{lignes.length} sources</span>
            <span className="text-text-dim">·</span>
            <Badge ton={nbErreurs > 0 ? "down" : "neutre"}>{nbErreurs} en erreur</Badge>
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
        {lignes.length === 0 ? (
          <Vide>Aucune source active pour l'instant. Les flux s'enregistrent à l'usage.</Vide>
        ) : (
          <ul className="flex flex-col gap-2">
            {lignes.map((l) => <LigneSource key={l.id} ligne={l} />)}
          </ul>
        )}

        {qualites.length > 0 ? (
          <section className="mt-4 space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Qualité par métrique</h3>
            <ul className="grid gap-1.5 md:grid-cols-2">
              {qualites.map(([id, entree]) => (
                <li key={id} className="rounded border border-border bg-bg px-2 py-1.5">
                  <p className="text-[11px] font-medium text-text">{entree.libelle}</p>
                  <QualiteMetrique qualite={entree.qualite} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-3">
          <NoteSource>
            Registre santé lu en direct · fraîcheurs rafraîchies toutes les 10 s · les
            actions nécessitent un clic
          </NoteSource>
        </div>
      </div>
    </>
  );
}
