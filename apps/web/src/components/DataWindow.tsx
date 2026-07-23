/**
 * Fenêtre « DATA » — observabilité des sources de données (vue détaillée du `healthStore`).
 *
 * Vue LECTURE SEULE : ne collecte rien, projette le registre `healthStore` (alimenté par
 * les adaptateurs WS et les pollers) en une liste ordonnée « erreurs d'abord ». Pendant que
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
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { healthStore, type QuotaSource, type SanteSource } from "../store/health";
import { dotClass, etatLabel, formatQuota } from "./HealthPanel";
import { trierSources, formatFraicheur } from "../data/dataCockpit";
import { Badge, EnTeteFenetre, NoteSource, Vide } from "./ui";

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

export function DataWindow() {
  // Abonnement piloté par la signature (hors `dernierMessageTs`) — cf. en-tête.
  const signature = useStore(healthStore, (s) => signatureRegistre(s.sources));

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
        sousTitre="État, fraîcheur, quota et dernière erreur par flux — lecture du registre santé"
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
          <ul className="flex flex-col gap-0.5">
            {lignes.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-2 rounded px-1 py-1 text-[11px] leading-tight hover:bg-surface"
              >
                <span
                  aria-hidden
                  title={etatLabel(l.etat)}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(l.etat)}`}
                />
                <span className="w-36 shrink-0 truncate text-text" title={l.id}>
                  {l.libelle}
                </span>
                <span className="w-20 shrink-0 tabular-nums text-text-dim">
                  {formatFraicheur(l.fraicheurMs)}
                </span>
                <span className="flex-1" />
                {l.quota && <BarreQuota quota={l.quota} />}
                {l.erreur && (
                  <span
                    title={l.erreur}
                    className="max-w-[40%] shrink truncate text-right text-down"
                  >
                    {l.erreur}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <NoteSource>
            Registre santé lu en direct · fraîcheurs rafraîchies toutes les 10 s · aucune
            nouvelle collecte
          </NoteSource>
        </div>
      </div>
    </>
  );
}
