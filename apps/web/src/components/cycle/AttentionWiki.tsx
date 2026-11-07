/**
 * Section « Attention grand public · Wikipédia » de CYCLE (SUG-39).
 *
 * Question : l'attention du grand public est-elle au plus haut (souvent en fin d'euphorie…
 * ou en pleine capitulation) ou éteinte (désintérêt de fond de cycle), et une alt attire-t-
 * elle soudain un public nouveau ? Réponse DESCRIPTIVE, non signée : ni alerte, ni signal.
 *
 * `VueAttentionWiki` est PURE (testée en rendu statique) ; `SectionAttentionWiki` porte
 * l'état local (actif, édition, chargement). Elle est mémoïsée sans props : le survol du
 * graphe de CYCLE re-rend la fenêtre à chaque mouvement, pas cette section. L'analyse est
 * calculée une fois par chargement, jamais au rendu.
 */
import { memo, useEffect, useState } from "react";
import {
  ARTICLES_WIKI,
  ESPACEMENT_EPISODES_JOURS,
  JOUR_MS,
  JOURS_ANNEE,
  SEUIL_PIC_SIGMA,
  analyserAttention,
  attentionRelative,
  chargerAttentionWiki,
  retardJours,
  titreArticle,
  type AnalyseAttention,
  type AttentionRelative,
  type EditionWiki,
  type NiveauAttention,
  type ResultatAttentionWiki,
} from "../../data/attentionWiki";
import { formatDec, formatEntier } from "../../lib/format";
import { Badge, Bouton, Chargement, ErreurBloc, Fraicheur, NoteSource, SegmenteCompact, TitreSection, TuileStat, Vide, type TonBadge } from "../ui";

/** Valeur explicite d'une mesure impossible (historique ou couverture insuffisants). */
const NON_MESURE = "non mesuré";
/** Valeur explicite d'une source en échec. */
const INDISPONIBLE = "indisponible";

/** Date ISO UTC « AAAA-MM-JJ » (jours comptés à 00:00 UTC, lisible sans fuseau). */
const dateIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const LIBELLES_NIVEAU: Record<NiveauAttention, { libelle: string; ton: TonBadge }> = {
  pic: { libelle: `pic > ${SEUIL_PIC_SIGMA}σ`, ton: "warn" },
  elevee: { libelle: "élevée", ton: "accent" },
  normale: { libelle: "dans la norme", ton: "neutre" },
  eteinte: { libelle: "éteinte", ton: "neutre" },
};

const OPTIONS_ACTIF = ARTICLES_WIKI.map((a) => ({ id: a.actif, label: a.actif, title: a.nom }));
const OPTIONS_EDITION: ReadonlyArray<{ id: EditionWiki; label: string; title: string }> = [
  { id: "en", label: "en", title: "Wikipédia en anglais" },
  { id: "fr", label: "fr", title: "Wikipédia en français" },
];

export type EtatAttentionWiki =
  | { statut: "chargement" }
  | { statut: "sans-article" }
  | { statut: "erreur"; message: string }
  | {
      statut: "pret";
      resultat: ResultatAttentionWiki;
      analyse: AnalyseAttention;
      /** Attention relative à BTC (alt seulement) ; null pour BTC ou si BTC a échoué. */
      relative: AttentionRelative | null;
      /** Échec du chargement de BTC pour la comparaison (alt seulement). */
      erreurBtc: string | null;
    };

/** Badge du niveau d'attention (z 365 j). */
function BadgeNiveau({ niveau }: { niveau: NiveauAttention | null }) {
  if (niveau === null) return null;
  const { libelle, ton } = LIBELLES_NIVEAU[niveau];
  return (
    <Badge ton={ton} title="Lecture descriptive du z-score 365 j, non signée : un pic accompagne une euphorie comme un krach">
      {libelle}
    </Badge>
  );
}

/** Tuiles d'une série chargée. */
function TuilesAttention({
  actif,
  etat,
  maintenant,
}: {
  actif: string;
  etat: Extract<EtatAttentionWiki, { statut: "pret" }>;
  maintenant: number;
}) {
  const { analyse: a, resultat, relative, erreurBtc } = etat;
  const retard = a.dernierJour !== null ? retardJours(a.dernierJour, maintenant) : 0;
  const dernierPic = a.pics.at(-1);
  // Épisodes chronologiques, tous antérieurs au dernier jour : les `picsSur365j` derniers sont ceux de l'année.
  const pics365 = a.picsSur365j !== null ? a.pics.slice(a.pics.length - a.picsSur365j) : [];
  // Décompte partiel : le z 365 j n'est mesuré que sur une partie de l'année (historique court, jours omis).
  const picsPartiels = a.picsSur365j !== null && a.joursZ365Mesures < JOURS_ANNEE;
  const baseDecompte = picsPartiels ? `les ${formatEntier(a.joursZ365Mesures)} jours mesurés de l'année` : "un an";
  return (
    <div className="grid grid-cols-2 gap-2">
      <TuileStat
        label="Vues · dernier jour complet"
        valeur={a.vuesDernierJour !== null ? formatEntier(a.vuesDernierJour) : NON_MESURE}
        title={
          a.dernierJour !== null && a.connuLe !== null
            ? `Jour compté ${dateIso(a.dernierJour)} (UTC), publié au plus tôt le ${dateIso(a.connuLe)} ; le jour en cours n'est jamais affiché`
            : undefined
        }
        badge={
          resultat.perime ? (
            <Badge ton="warn" title="Wikimedia a échoué : dernière série en cache, au-delà de sa durée de fraîcheur">
              cache périmé
            </Badge>
          ) : retard > 1 ? (
            <Badge ton="warn" title="Le dernier jour mesuré précède la veille UTC">
              retard {retard} j
            </Badge>
          ) : undefined
        }
        extra={a.dernierJour !== null ? <span className="text-[10px] text-text-dim">{dateIso(a.dernierJour)}</span> : undefined}
      />
      <TuileStat
        label="z 365 j · log des vues"
        valeur={a.z365 !== null ? formatDec(a.z365, 2) : NON_MESURE}
        title="Écart de log(1 + vues) du dernier jour à la moyenne des 365 jours strictement précédents, en écarts-types (couverture d'au moins 80 %)"
        badge={<BadgeNiveau niveau={a.niveau} />}
        pied={
          <>
            <span>z 90 j {a.z90 !== null ? formatDec(a.z90, 2) : NON_MESURE}</span>
            <span>
              couverture {formatEntier(a.couverture.joursMesures)}/{formatEntier(a.couverture.joursAttendus)} j
            </span>
          </>
        }
      />
      <TuileStat
        label="Ratio 7 j / 90 j"
        valeur={a.ratio7j90j !== null ? `×${formatDec(a.ratio7j90j, 2)}` : NON_MESURE}
        title="Moyenne des vues des 7 derniers jours mesurés rapportée à celle des 90 derniers"
      />
      <TuileStat
        label={`Pics > ${SEUIL_PIC_SIGMA}σ · 365 j`}
        valeur={a.picsSur365j !== null ? formatEntier(a.picsSur365j) : NON_MESURE}
        title={
          a.picsSur365j === null
            ? `z 365 j mesuré sur aucun des ${JOURS_ANNEE} derniers jours (historique ou couverture insuffisants) : pas de décompte`
            : pics365.length > 0
              ? `Épisodes sur ${baseDecompte} (jour compté, z) : ${pics365.map((p) => `${dateIso(p.jour)} z ${formatDec(p.z, 1)}`).join(" · ")}`
              : `Aucun jour au-delà de ${SEUIL_PIC_SIGMA}σ (z 365 j) sur ${baseDecompte}`
        }
        pied={
          <>
            <span>{dernierPic !== undefined ? `dernier pic ${dateIso(dernierPic.jour)}` : "aucun pic mesuré"}</span>
            {picsPartiels && (
              <span>
                sur {formatEntier(a.joursZ365Mesures)}/{JOURS_ANNEE} j mesurés
              </span>
            )}
          </>
        }
      />
      {actif !== "BTC" && (
        <TuileStat
          label="Vues vs Bitcoin · 7 j"
          valeur={
            erreurBtc !== null
              ? INDISPONIBLE
              : relative?.partVsBtc7j != null
                ? `${formatDec(relative.partVsBtc7j * 100, 1)} %`
                : NON_MESURE
          }
          title={
            erreurBtc !== null
              ? `Série Bitcoin indisponible : ${erreurBtc}`
              : "Vues de l'article de l'actif rapportées à celles de l'article Bitcoin, même édition, 7 derniers jours communs"
          }
          pied={
            <span>
              z 365 j du ratio{" "}
              {erreurBtc === null && relative?.zRatio365 != null ? formatDec(relative.zRatio365, 2) : NON_MESURE}
            </span>
          }
        />
      )}
    </div>
  );
}

/** Vue PURE de la section : contrôles, contenu selon l'état, note de source. */
export function VueAttentionWiki({
  actif,
  edition,
  etat,
  maintenant,
  onActif,
  onEdition,
  onReessayer,
}: {
  actif: string;
  edition: EditionWiki;
  etat: EtatAttentionWiki;
  maintenant: number;
  onActif: (actif: string) => void;
  onEdition: (edition: EditionWiki) => void;
  onReessayer: () => void;
}) {
  const titre = titreArticle(actif, edition);
  return (
    // Montée dans le bloc défilant de CYCLE (déjà en px-4 py-3) : pas de marge horizontale propre.
    <section className="mt-3 shrink-0 border-t border-border pt-3">
      <TitreSection
        extra={
          <Badge title="Lecture de contexte : ni signal, ni prévision, ni alerte">descriptif</Badge>
        }
      >
        Attention grand public · Wikipédia
      </TitreSection>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SegmenteCompact ariaLabel="Actif" options={OPTIONS_ACTIF} actif={actif} onChange={onActif} />
        <SegmenteCompact ariaLabel="Édition de Wikipédia" options={OPTIONS_EDITION} actif={edition} onChange={onEdition} />
      </div>

      {etat.statut === "sans-article" ? (
        <Vide>
          Pas d'article retenu pour {actif} sur Wikipédia {edition} : la correspondance est curée et un titre incertain
          n'est pas deviné.
        </Vide>
      ) : etat.statut === "chargement" ? (
        <Chargement libelle="Pages vues Wikipédia…" />
      ) : etat.statut === "erreur" ? (
        <div className="flex flex-col gap-2">
          <ErreurBloc>Attention Wikipédia {INDISPONIBLE} : {etat.message}</ErreurBloc>
          <div>
            <Bouton onClick={onReessayer}>Réessayer</Bouton>
          </div>
        </div>
      ) : (
        <TuilesAttention actif={actif} etat={etat} maintenant={maintenant} />
      )}

      <div className="mt-2 flex items-start justify-between gap-2">
        <NoteSource>
          Source : Wikimedia (CC0) · pages vues quotidiennes
          {titre !== null ? ` de l'article « ${titre} » (${edition}.wikipedia)` : ""}, agent « user », redirections non
          comptées · le jour D n'est publié qu'à D+1 : le jour en cours n'est jamais montré · z = écart de log(1 + vues)
          à la moyenne des jours strictement précédents · pics : z 365 j &gt; {SEUIL_PIC_SIGMA}, un épisode par{" "}
          {ESPACEMENT_EPISODES_JOURS} j · non signé : l'attention s'emballe en bulle comme en krach, et suit souvent le
          prix plus qu'elle ne le précède · niveaux non comparables d'une année à l'autre (filtrage des robots)
        </NoteSource>
        {etat.statut === "pret" && <Fraicheur loading={false} majTs={etat.resultat.recupereLe} cadenceMs={JOUR_MS} />}
      </div>
    </section>
  );
}

/** Message lisible d'une erreur. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Section avec état : charge l'actif choisi (et BTC pour une alt) à l'ouverture et à chaque choix. */
export const SectionAttentionWiki = memo(function SectionAttentionWiki() {
  const [actif, setActif] = useState("BTC");
  const [edition, setEdition] = useState<EditionWiki>("en");
  const [essai, setEssai] = useState(0);
  const [etat, setEtat] = useState<EtatAttentionWiki>({ statut: "chargement" });

  useEffect(() => {
    if (titreArticle(actif, edition) === null) {
      setEtat({ statut: "sans-article" });
      return;
    }
    const controleur = new AbortController();
    const { signal } = controleur;
    setEtat({ statut: "chargement" });
    void (async () => {
      try {
        const resultat = await chargerAttentionWiki(actif, edition, { signal });
        let relative: AttentionRelative | null = null;
        let erreurBtc: string | null = null;
        if (actif !== "BTC") {
          try {
            const btc = await chargerAttentionWiki("BTC", edition, { signal });
            relative = attentionRelative(resultat.serie, btc.serie);
          } catch (err) {
            if (signal.aborted) return;
            erreurBtc = message(err);
          }
        }
        if (signal.aborted) return;
        setEtat({ statut: "pret", resultat, analyse: analyserAttention(resultat.serie), relative, erreurBtc });
      } catch (err) {
        if (!signal.aborted) setEtat({ statut: "erreur", message: message(err) });
      }
    })();
    return () => controleur.abort();
  }, [actif, edition, essai]);

  return (
    <VueAttentionWiki
      actif={actif}
      edition={edition}
      etat={etat}
      maintenant={Date.now()}
      onActif={setActif}
      onEdition={setEdition}
      onReessayer={() => setEssai((n) => n + 1)}
    />
  );
});
