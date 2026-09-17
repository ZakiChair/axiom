/**
 * Section repliable « Flux takers toutes places (quotidien · CryptoQuant) » de DES.
 *
 * Vue PURE `VueFluxTakers` (testée en rendu statique) + conteneur `SectionFluxTakers`.
 * Le conteneur charge les QUATRE séries au MONTAGE de la fenêtre, pas au dépliage : la
 * collecte de l'archive côté client ne doit pas dépendre d'un clic (un jour non collecté
 * au-delà de 30 j est perdu), et les segmentés ne déclenchent ainsi aucun appel. La section
 * reste repliée par défaut. Le client CryptoQuant n'est chargé que par `import()` (chunk à
 * la demande) : ce fichier n'en importe que des TYPES. La raison « sans clé » et son
 * complément viennent du store de clé, déjà importé ici pour `version`.
 *
 * Agrégat fournisseur consommé tel quel : spot et perp jamais additionnés, ratio et VWAP
 * jamais recalculés, aucune comparaison Binance. Indépendante de la clé Coinalyze, du
 * symbole et de l'exchange. Courbe et sparkline LOCALES : un module commun DES/CHAIN
 * créerait un chunk préchargé par l'entrée.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { ChargementCq, DiagnosticCq, SerieCq } from "../data/onchain/cryptoquant";
import { IS_VERCEL } from "../lib/deployment";
import {
  formatCompact,
  formatDec,
  formatPct,
  formatPourcentage,
  formatPrice,
  formatUsd,
  formatUsdSigne,
  VALEUR_ABSENTE,
} from "../lib/format";
import { useHorloge } from "../lib/horloge";
import { cryptoquantKeyStore, messageSansCleCq, RAISON_CLE_CRYPTOQUANT } from "../store/cryptoquant";
import {
  construireModeleFluxTakers,
  serieTaker,
  type ActifTaker,
  type MarcheTaker,
  type ModeleFluxTakers,
  type SelectionTaker,
} from "./fluxTakers.util";
import { Badge, BadgeFiabilite, ErreurBloc, NoteSource, SansCle, SegmenteCompact, TuileStat, Vide } from "./ui";

const JOUR_MS = 86_400_000;
/** Séries chargées par la section (spot/perp × BTC/ETH). */
const NB_SERIES_TAKER = 4;
const MENTION_PERP = "unités fournisseur, champ inverse non documenté";
/**
 * Rejet de l'`await import()` du client (coupure réseau, ou chunk évincé après un redéploiement) :
 * rien n'a été lu, le libellé ne mentionne donc jamais « archive ». Même texte que CHAIN, recopié
 * ici : l'importer depuis MineursCotes lierait les deux chunks.
 */
const CLIENT_NON_CHARGE = "Client CryptoQuant non chargé (réseau ou mise à jour d'AXIOM) ; rechargez la page.";
/** Bandeau d'une erreur après appel sans aucune archive : la raison du client, elle, annonce une archive affichée. */
const ERREUR_SANS_ARCHIVE = "CryptoQuant injoignable ; aucune archive locale.";

const OPTIONS_ACTIF: ReadonlyArray<{ id: ActifTaker; label: string }> = [
  { id: "btc", label: "BTC" },
  { id: "eth", label: "ETH" },
];
const OPTIONS_MARCHE: ReadonlyArray<{ id: MarcheTaker; label: string; title?: string }> = [
  { id: "spot", label: "Spot" },
  { id: "swap", label: "Perp", title: "Perpétuels (swap) : volumes en unités fournisseur" },
];

const jourIso = (t: number | null) =>
  t !== null && Number.isFinite(t) && t > 0 ? new Date(t).toISOString().slice(0, 10) : VALEUR_ABSENTE;

const formatVwap = (v: number | null) => (v !== null && v > 0 ? `$${formatPrice(v)}` : VALEUR_ABSENTE);

const ordinal = (rang: number) => (rang === 1 ? "1ᵉʳ" : `${rang}ᵉ`);

export interface PropsVueFluxTakers {
  chargements: Partial<Record<SerieCq, ChargementCq>>;
  selection: SelectionTaker;
  onSelection: (s: SelectionTaker) => void;
  enCours: boolean;
  recues: number;
  attendues: number;
  file: { enAttente: number; repriseTs: number | null };
  now: number;
  onOuvrirReglages: () => void;
  /** `await import()` du client rejeté ce cycle (chunk introuvable) : aucune série n'a été lue. */
  echecClient?: boolean;
}

/** Mini-courbe de tendance récente (SVG inline) — copie locale de celle de DES. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 64;
  const height = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/** Ratio achat/vente à dates réelles : pointillé à 1.00, ligne coupée aux jours absents. */
function CourbeTakers({ points }: { points: ModeleFluxTakers["courbe"] }) {
  const valides = points.filter((p): p is { jour: string; valeur: number } => p.valeur !== null);
  const premier = points[0];
  const dernier = points.at(-1);
  if (valides.length < 2 || premier === undefined || dernier === undefined) return null;
  const temps = (jour: string) => Date.parse(`${jour}T00:00:00Z`);
  const x0 = temps(premier.jour);
  const x1 = temps(dernier.jour);
  // Légende = plage des DONNÉES ; l'axe l'élargit à 1.00 pour garder le pointillé visible.
  const minDonnees = Math.min(...valides.map((p) => p.valeur));
  const maxDonnees = Math.max(...valides.map((p) => p.valeur));
  const min = Math.min(1, minDonnees);
  const max = Math.max(1, maxDonnees);
  const x = (jour: string) => 4 + ((temps(jour) - x0) / (x1 - x0 || 1)) * 292;
  const y = (v: number) => 56 - ((v - min) / (max - min || 1)) * 48;
  let rupture = true;
  const commandes: string[] = [];
  for (const p of points) {
    if (p.valeur === null) {
      rupture = true;
      continue;
    }
    commandes.push(`${rupture ? "M" : "L"}${x(p.jour).toFixed(1)},${y(p.valeur).toFixed(1)}`);
    rupture = false;
  }
  return (
    <figure className="mt-1" aria-label="Ratio taker achat/vente quotidien">
      <svg viewBox="0 0 300 64" className="h-16 w-full" role="img" aria-label="Ratio taker achat/vente quotidien">
        <title>{`Ratio taker achat/vente · ${premier.jour} au ${dernier.jour} · pointillé = 1.00`}</title>
        <line x1="4" x2="296" y1={y(1)} y2={y(1)} stroke="var(--border)" strokeDasharray="3 3" />
        <path d={commandes.join(" ")} fill="none" stroke="var(--serie-1)" strokeWidth="1.5" />
      </svg>
      <figcaption className="flex justify-between gap-1 text-[9px] text-text-dim">
        <span>{premier.jour}</span>
        <span>{`${formatDec(minDonnees, 2)} → ${formatDec(maxDonnees, 2)}`}</span>
        <span>{dernier.jour}</span>
      </figcaption>
    </figure>
  );
}

function ligneSituation(partPct: number | null, s: ModeleFluxTakers["situation"]): string {
  const acheteurs = `acheteurs ${formatPourcentage(partPct, 1)}`;
  if (s === null) return `${acheteurs} · archive trop courte pour situer le ratio`;
  return (
    `${acheteurs} · ${s.n} j archivés : min ${formatDec(s.min, 2)} · méd. ${formatDec(s.mediane, 2)}` +
    ` · max ${formatDec(s.max, 2)} · ${ordinal(s.rang)} plus bas`
  );
}

/**
 * Ligne d'archive : début, taille et trois états de trous (J-1 absent n'est jamais un trou).
 * `hierPresent` est jugé à l'heure du rendu, pas repris du diagnostic figé au chargement.
 */
function ligneArchive(d: DiagnosticCq, nbJours: number, hierPresent: boolean): string {
  const k = d.manquantsFenetre.length;
  const p = d.perdus.length;
  const morceaux = [
    `Archive locale depuis ${d.debut ?? VALEUR_ABSENTE}`,
    `${nbJours} j archivés`,
    `${k} ${k > 1 ? "manquants" : "manquant"} dans la fenêtre`,
    p === 0 ? "0 perdu" : `${p} ${p > 1 ? "perdus (définitifs)" : "perdu (définitif)"}`,
  ];
  if (!hierPresent) morceaux.push("J-1 en attente de publication");
  return morceaux.join(" · ");
}

function titreTrous(d: DiagnosticCq): string | undefined {
  const lignes = [
    d.manquantsFenetre.length > 0 ? `Manquants (récupérables sous 30 j) : ${d.manquantsFenetre.join(", ")}` : "",
    d.perdus.length > 0 ? `Perdus (hors fenêtre fournisseur) : ${d.perdus.join(", ")}` : "",
  ].filter((l) => l !== "");
  return lignes.length > 0 ? lignes.join("\n") : undefined;
}

/** Résumé du côté droit de l'en-tête (visible même section repliée). PURE. */
export function resumeEnTeteFluxTakers(
  p: Omit<PropsVueFluxTakers, "onSelection" | "onOuvrirReglages">,
): string {
  if (p.enCours && p.file.enAttente > 0) return `${p.recues}/${p.attendues} reçues · en attente du quota`;
  if (p.echecClient) return "client CryptoQuant non chargé";
  const c = p.chargements[serieTaker(p.selection)];
  if (c === undefined) return p.enCours ? "chargement…" : "série non encore archivée";
  if (c.statut === "quota") {
    const secondes = p.file.repriseTs === null ? 0 : Math.ceil((p.file.repriseTs - p.now) / 1000);
    return secondes > 0 ? `quota atteint, reprise ${secondes} s` : "quota atteint, réessai à la prochaine ouverture";
  }
  if (c.statut === "cle-requise") return c.raison === null || c.raison === RAISON_CLE_CRYPTOQUANT ? "clé personnelle requise" : "clé CryptoQuant refusée";
  if (c.statut === "offre") return "offre CryptoQuant insuffisante";
  const nbJours = Object.keys(c.archive?.jours ?? {}).length;
  const dernier = c.diagnostic.dernier;
  if (dernier === null || nbJours === 0)
    return c.statut === "erreur" ? (c.appel ? "CryptoQuant injoignable" : "erreur CryptoQuant") : "archive vide";
  // « J-1 » jugé à l'heure du rendu : une fenêtre ouverte depuis la veille ne l'affirme plus.
  const archive = `archive ${nbJours} j · ${dernier === jourIso(p.now - JOUR_MS) ? "J-1" : "dernier"} ${dernier}`;
  return c.statut === "erreur" ? `CryptoQuant injoignable · ${archive}` : archive;
}

export function VueFluxTakers({
  chargements,
  selection,
  onSelection,
  enCours,
  recues,
  attendues,
  file,
  now,
  onOuvrirReglages,
  echecClient = false,
}: PropsVueFluxTakers) {
  const hier = jourIso(now - JOUR_MS);
  const c = chargements[serieTaker(selection)];
  const archive = c?.archive ?? null;
  const nbJours = archive === null ? 0 : Object.keys(archive.jours).length;
  const m = construireModeleFluxTakers(archive, jourIso(now));
  const perp = selection.marche === "swap";

  const selecteurs = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmenteCompact
        ariaLabel="Actif des flux takers"
        options={OPTIONS_ACTIF}
        actif={selection.actif}
        onChange={(actif) => onSelection({ ...selection, actif })}
      />
      <SegmenteCompact
        ariaLabel="Marché des flux takers"
        options={OPTIONS_MARCHE}
        actif={selection.marche}
        onChange={(marche) => onSelection({ ...selection, marche })}
      />
      {m.jour !== null && (
        <span className="ml-auto text-[10px] tabular-nums text-text-dim">
          {`observation ${m.jour}${m.jour === hier ? " (J-1)" : ""} · récupéré ${jourIso(archive?.majTs ?? null)}`}
        </span>
      )}
    </div>
  );
  const partiel = enCours && recues < attendues && (
    <p className="px-1 text-[10px] text-text-dim">
      {`${recues}/${attendues} reçues${file.enAttente > 0 ? " · en attente du quota CryptoQuant (10 req/min)" : ""}`}
    </p>
  );

  if (echecClient) {
    return (
      <div className="space-y-2">
        {selecteurs}
        <Vide>{CLIENT_NON_CHARGE}</Vide>
      </div>
    );
  }

  if (c === undefined) {
    return (
      <div className="space-y-2">
        {selecteurs}
        {partiel}
        <Vide>{enCours ? "Chargement des flux takers…" : "Série non encore archivée."}</Vide>
      </div>
    );
  }

  if (c.statut === "cle-requise" && nbJours === 0) {
    // Bouton Réglages pour toute clé absente OU refusée. Le complément `.env`/Vercel ne
    // concerne que l'absence de clé : une clé refusée (401) s'affiche telle quelle.
    const raison = c.raison ?? RAISON_CLE_CRYPTOQUANT;
    const message = raison === RAISON_CLE_CRYPTOQUANT ? messageSansCleCq(IS_VERCEL) : raison;
    return (
      <div className="space-y-2">
        {selecteurs}
        <SansCle message={message} onOuvrirReglages={onOuvrirReglages} />
      </div>
    );
  }

  const bandeau =
    c.statut === "erreur" && c.appel && m.jour === null
      ? ERREUR_SANS_ARCHIVE
      : c.statut === "quota" || c.statut === "offre" || c.statut === "erreur"
        ? (c.raison ?? "CryptoQuant indisponible ; archive affichée.")
        : null;
  const tonRatio = m.ratio === null ? undefined : m.ratio >= 1 ? "up" : "down";
  const sparkRatio = m.courbe
    .map((p) => p.valeur)
    .filter((v): v is number => v !== null)
    .slice(-30);
  const perime = c.diagnostic.perime && m.jour !== null;
  // Une raison non nulle avec « pret » n'est pas une erreur : le client n'en produit qu'une,
  // l'archive locale illisible remplacée. Sa valeur n'est pas importable ici (client chargé à
  // la demande) : la vue lit la forme et montre la raison en infobulle.
  const illisible = c.statut === "pret" && c.raison !== null;
  const stockagePlein = c.persistance.local === false;
  const kvNonEcrit = c.persistance.kv === false;
  const signaux = c.statut === "cle-requise" || perime || illisible || stockagePlein || kvNonEcrit;
  const volumeBase = `Volume base ${formatCompact(m.volumeBase)} ${selection.actif.toUpperCase()}`;
  const titreVolume = perp ? `${volumeBase} · VWAP ${formatVwap(m.vwap)} — ${MENTION_PERP}` : volumeBase;

  return (
    <div className="space-y-2">
      {selecteurs}
      {partiel}
      {bandeau !== null && <ErreurBloc>{bandeau}</ErreurBloc>}
      {signaux && (
        <div className="flex flex-wrap gap-1.5">
          {c.statut === "cle-requise" && (
            <Badge ton="warn" title={c.raison ?? undefined}>
              clé requise pour actualiser
            </Badge>
          )}
          {perime && <Badge ton="warn">cache ou observation périmé</Badge>}
          {illisible && (
            <Badge ton="warn" title={c.raison ?? undefined}>
              archive locale illisible remplacée
            </Badge>
          )}
          {stockagePlein && <Badge ton="warn">archive non persistée localement (stockage plein)</Badge>}
          {kvNonEcrit && <Badge ton="warn">copie daemon non écrite</Badge>}
        </div>
      )}
      {m.jour === null ? (
        <Vide>Série non encore archivée.</Vide>
      ) : (
        <>
          <TuileStat
            disposition="inline"
            label="Ratio taker achat/vente"
            valeur={formatDec(m.ratio, 2)}
            ton={tonRatio}
            badge={
              <BadgeFiabilite
                niveau="partiel"
                label="J-1 · CryptoQuant"
                title="Agrégat quotidien CryptoQuant publié à J-1 ; composition des places non documentée."
              />
            }
            extra={
              sparkRatio.length >= 2 && (
                <Sparkline values={sparkRatio} color={tonRatio === "up" ? "var(--up)" : "var(--down)"} />
              )
            }
          />
          <p className="px-1 text-[11px] tabular-nums text-text-dim">{ligneSituation(m.partAcheteursPct, m.situation)}</p>
          <TuileStat
            disposition="inline"
            label="Δ taker (quote)"
            valeur={formatUsdSigne(m.deltaQuote)}
            ton={m.deltaQuote === null ? undefined : m.deltaQuote >= 0 ? "up" : "down"}
            title="Volume acheteur − volume vendeur en quote (USD), valeurs du fournisseur"
          />
          <p className="px-1 text-[11px] tabular-nums text-text-dim">
            {m.cumul7.valeur === null
              ? `7 j ${VALEUR_ABSENTE} (${m.cumul7.presents}/7 j)`
              : `7 j ${formatUsdSigne(m.cumul7.valeur)} (7/7 j)`}
          </p>
          <TuileStat disposition="inline" label="Volume quote" valeur={formatUsd(m.volumeQuote)} title={titreVolume} />
          <p className="px-1 text-[11px] tabular-nums text-text-dim">
            {`${formatCompact(m.trades)} trades · vs méd. 30 j ${formatPct(m.vsMediane30Pct, 1)}`}
          </p>
          {perp ? (
            <p className="px-1 text-[10px] text-text-dim">
              {`Perp : volume base et VWAP en infobulle du volume (${MENTION_PERP}).`}
            </p>
          ) : (
            <TuileStat disposition="inline" label="VWAP agrégé" valeur={formatVwap(m.vwap)} />
          )}
          <CourbeTakers points={m.courbe} />
          <p className="px-1 text-[10px] text-text-dim" title={titreTrous(c.diagnostic)}>
            {ligneArchive(c.diagnostic, nbJours, m.jour === hier)}
          </p>
        </>
      )}
      <NoteSource>
        <BadgeFiabilite niveau="partiel" label="J-1 · CryptoQuant" /> · agrégat toutes places (composition non
        documentée) · licence personnelle · fenêtre 30 j sans rattrapage : un jour non collecté au-delà est
        perdu · quota 10 req/min (compteur dans DATA) · spot et perp jamais additionnés, ratio et VWAP tels que
        publiés
        {c.persistance.kv === null && " · sans daemon : vider le stockage du navigateur perd l'archive"}
      </NoteSource>
    </div>
  );
}

export function SectionFluxTakers({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  // Rotation de clé (setKey/clearKey) → nouvelle passe ; la valeur de la clé n'est jamais lue ici.
  const version = useStore(cryptoquantKeyStore, (s) => s.version);
  const [ouvert, setOuvert] = useState(false);
  const [selection, setSelection] = useState<SelectionTaker>({ actif: "btc", marche: "spot" });
  const [chargements, setChargements] = useState<Partial<Record<SerieCq, ChargementCq>>>({});
  const [enCours, setEnCours] = useState(true);
  const [recues, setRecues] = useState(0);
  const [file, setFile] = useState<{ enAttente: number; repriseTs: number | null }>({
    enAttente: 0,
    repriseTs: null,
  });
  const [echecClient, setEchecClient] = useState(false);
  // Horloge partagée (un tic toutes les 10 s, comme CHAIN) : « J-1 » suit l'heure réelle.
  const now = useHorloge();
  // Seul le changement de jour UTC relance une passe (diagnostic et « périmé » recalculés) ;
  // les tics de l'horloge ne font que redessiner.
  const jourCourant = jourIso(now);
  const [, redessiner] = useState(0);

  // Chargement au MONTAGE (puis à chaque rotation de clé et à chaque nouveau jour UTC) : boucle
  // séquentielle, affichage progressif série par série. Le client est importé à la demande ;
  // démontage → annulation.
  useEffect(() => {
    const ctrl = new AbortController();
    const abonnement: { arreter: () => void } = { arreter: () => undefined };
    let vivant = true;
    setEnCours(true);
    setRecues(0);
    setEchecClient(false);
    void (async () => {
      const cq = await import("../data/onchain/cryptoquant");
      if (!vivant) return;
      const majFile = () => {
        if (vivant) setFile(cq.etatFileCq());
      };
      abonnement.arreter = cq.abonnerFileCq(majFile);
      majFile();
      for (const serie of cq.SERIES_TAKER) {
        let resultat: ChargementCq;
        try {
          resultat = await cq.chargerSerieCq(serie, ctrl.signal);
        } catch {
          // Annulation au démontage ou échec inattendu : la série reste absente de l'écran.
          if (!vivant) return;
          continue;
        }
        if (!vivant) return;
        setChargements((precedents) => ({ ...precedents, [serie]: resultat }));
        setRecues((n) => n + 1);
        majFile();
      }
      if (vivant) setEnCours(false);
    })().catch(() => {
      // Chunk introuvable (échec de l'import()) ou abonnerFileCq en erreur : sans ce repli, la
      // section resterait sur « chargement… » indéfiniment (rejet non intercepté). Rien n'a été
      // lu : la vue et l'en-tête le disent au lieu d'afficher « série non encore archivée ».
      if (vivant) {
        setEnCours(false);
        setEchecClient(true);
      }
    });
    return () => {
      vivant = false;
      ctrl.abort();
      abonnement.arreter();
    };
  }, [version, jourCourant]);

  // Compte à rebours de reprise après un 429 : un rendu par seconde jusqu'à l'échéance (l'horloge
  // partagée ne bat que toutes les 10 s ; chaque rendu relit l'heure réelle).
  useEffect(() => {
    const reprise = file.repriseTs;
    if (reprise === null || reprise <= Date.now()) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      redessiner(t);
      if (t >= reprise) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [file.repriseTs]);

  const props: PropsVueFluxTakers = {
    chargements,
    selection,
    onSelection: setSelection,
    enCours,
    recues,
    attendues: NB_SERIES_TAKER,
    file,
    now,
    onOuvrirReglages,
    echecClient,
  };

  return (
    <section className="mt-3 rounded-md border border-border bg-bg">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Flux takers toutes places (quotidien · CryptoQuant)
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums text-text-dim">
          <span>{resumeEnTeteFluxTakers(props)}</span>
          <span className="text-[11px]">{ouvert ? "▾" : "▸"}</span>
        </span>
      </button>
      {ouvert && (
        <div className="border-t border-border px-3 py-2">
          <VueFluxTakers {...props} />
        </div>
      )}
    </section>
  );
}
