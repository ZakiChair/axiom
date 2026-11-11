/**
 * Section BRIEF — régime · largeur de marché (breadth) : jauges MM50/MM200, A/D du jour
 * (univers USDT complet), tendance MM50, puis l'HISTORIQUE descriptif des 200 derniers jours
 * clôturés (SUG-41, phase 1) : sparklines % > MM50/MM200, solde des nouveaux plus hauts − plus
 * bas sur 20/55 j, ligne A/D et oscillateur type McClellan du TOP 50, part des alts battant BTC
 * sur 90/30 j. Chaque dernière valeur porte son dénominateur ; un jour sans mesure est un trou
 * (jamais 0). Le biais du survivant (univers = top 50 du jour) est écrit sous les séries.
 * Dégradation gracieuse propre via `corps`.
 */
import {
  ligneAdCumulee,
  partsSerie,
  type HistoriqueLargeur,
  type ResumBreadth,
  type SerieDenombree,
} from "../../data/breadth";
import {
  HORIZON_SAISON_COURT_JOURS,
  HORIZON_SAISON_JOURS,
  SEUIL_SAISON_ALTS,
  SEUIL_SAISON_BTC,
  zoneSaison,
} from "../../data/saisonAlts";
import { formatPourcentage, VALEUR_ABSENTE } from "../../lib/format";
import { NoteSource } from "../ui";
import { corps, JaugeBreadth, TitreBloc, type Section } from "./commun";

interface Props {
  breadth: Section<ResumBreadth>;
  noteFraicheur: string;
}

const JOUR_MS = 86_400_000;
/** Repère de la sparkline (viewBox) : la largeur réelle suit la colonne (preserveAspectRatio). */
const LARGEUR_SPARK = 200;
const HAUTEUR_SPARK = 18;
const DOMAINE_PART: readonly [number, number] = [0, 100];

/** « JJ/MM » d'un minuit UTC, lu en UTC (en heure locale à l'ouest de Greenwich : la veille). */
function dateUtc(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

/** Dernier jour d'une série dénombrée : part en % (null si non mesuré), k et n. */
function dernier(s: SerieDenombree): { pct: number | null; k: number; n: number } {
  const i = s.n.length - 1;
  const n = s.n[i] ?? 0;
  const k = s.k[i] ?? 0;
  return { pct: n > 0 ? (100 * k) / n : null, k, n };
}

/** Nombre signé (« +12 », « -3.5 », même écriture que formatPct) ; « — » si absent. */
function signe(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return VALEUR_ABSENTE;
  const texte = v.toFixed(dec);
  return v > 0 ? `+${texte}` : texte === `-${(0).toFixed(dec)}` ? (0).toFixed(dec) : texte;
}

/**
 * Sparkline SVG sans axe : trait interrompu sur les jours non mesurés (null), lignes de repère
 * pointillées (50 %, 0, seuils de convention). Domaine fixe pour les parts (0–100 %), sinon
 * calé sur les valeurs et les repères. Décorative : la valeur lisible est à côté.
 */
function SparklineLargeur({
  valeurs,
  domaine,
  references = [],
}: {
  valeurs: readonly (number | null)[];
  domaine?: readonly [number, number];
  references?: readonly number[];
}) {
  const finies = valeurs.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finies.length < 2) return <span className="block h-[18px] w-full" aria-hidden="true" />;
  const min = domaine?.[0] ?? Math.min(...finies, ...references);
  const max = domaine?.[1] ?? Math.max(...finies, ...references);
  const etendue = max - min || 1;
  const pas = valeurs.length > 1 ? LARGEUR_SPARK / (valeurs.length - 1) : 0;
  const y = (v: number) => (HAUTEUR_SPARK - ((v - min) / etendue) * HAUTEUR_SPARK).toFixed(1);
  const segments: string[] = [];
  let courant: string[] = [];
  valeurs.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (courant.length > 1) segments.push(courant.join(" "));
      courant = [];
      return;
    }
    courant.push(`${(i * pas).toFixed(1)},${y(v)}`);
  });
  if (courant.length > 1) segments.push(courant.join(" "));
  return (
    <svg
      viewBox={`0 0 ${LARGEUR_SPARK} ${HAUTEUR_SPARK}`}
      preserveAspectRatio="none"
      className="block h-[18px] w-full text-text-dim"
      aria-hidden="true"
    >
      {references.map((r) => (
        <line
          key={r}
          x1={0}
          x2={LARGEUR_SPARK}
          y1={y(r)}
          y2={y(r)}
          stroke="currentColor"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.7}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {segments.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** Une ligne de série : libellé, sparkline, dernière valeur (avec son dénominateur). */
function LigneSerie({
  label,
  title,
  valeurs,
  domaine,
  references,
  valeur,
  couleur,
}: {
  label: string;
  title: string;
  valeurs: readonly (number | null)[];
  domaine?: readonly [number, number];
  references?: readonly number[];
  valeur: string;
  couleur?: string;
}) {
  return (
    <div
      title={title}
      className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-[11px]"
    >
      <span className="truncate text-text-dim">{label}</span>
      <SparklineLargeur valeurs={valeurs} domaine={domaine} references={references} />
      <span className="text-right tabular-nums" style={couleur === undefined ? undefined : { color: couleur }}>
        {valeur}
      </span>
    </div>
  );
}

/** Couleur d'une valeur signée (vert/rouge/estompé). */
function couleurSigne(v: number | null): string | undefined {
  if (v === null || !Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

/** Libellé de zone (convention) pour la part des alts battant BTC. */
function libelleZone(pct: number | null): string {
  const zone = zoneSaison(pct);
  if (zone === "alts") return `zone « saison des alts » (≥ ${SEUIL_SAISON_ALTS} %)`;
  if (zone === "btc") return `zone « saison BTC » (≤ ${SEUIL_SAISON_BTC} %)`;
  if (zone === "intermediaire") return `entre ${SEUIL_SAISON_BTC} et ${SEUIL_SAISON_ALTS} %`;
  return "non mesuré";
}

/** Valeur « part · k/n » ou « non mesuré ». */
function valeurPart(d: { pct: number | null; k: number; n: number }, avecK: boolean): string {
  if (d.pct === null) return "non mesuré";
  return `${formatPourcentage(d.pct, 0)} · ${avecK ? `${d.k}/${d.n}` : `n ${d.n}`}`;
}

/** Valeur « solde signé en % · n » ou « non mesuré ». */
function valeurSolde(d: { pct: number | null; n: number }): string {
  return d.pct === null ? "non mesuré" : `${signe(d.pct)} % · n ${d.n}`;
}

/** Bloc des séries historisées (200 jours clôturés). */
function HistoriqueBloc({ h }: { h: HistoriqueLargeur }) {
  const longueur = h.mcClellan.length;
  const finJour = h.debut + (longueur - 1) * JOUR_MS;
  const periode = `du ${dateUtc(h.debut)} au ${dateUtc(finJour)} (${longueur} j)`;
  const mm50 = dernier(h.mm50);
  const mm200 = dernier(h.mm200);
  const hb20 = dernier(h.hb20);
  const hb55 = dernier(h.hb55);
  const ligneAd = ligneAdCumulee(h.ad);
  const ad = dernier(h.ad);
  const cumulAd = ligneAd[ligneAd.length - 1] ?? null;
  const mcClellan = h.mcClellan[longueur - 1] ?? null;
  const saison90 = dernier(h.saison90);
  const saison30 = dernier(h.saison30);
  return (
    <div className="space-y-1 border-t border-border pt-2">
      <p className="text-[10px] uppercase tracking-wider text-text-dim">Historique descriptif · {periode}</p>
      <LigneSerie
        label="% > MM50"
        title={`Part du top 50 au-dessus de sa MM50, jour par jour, ${periode} ; n = symboles à ≥ 50 clôtures ce jour-là`}
        valeurs={partsSerie(h.mm50)}
        domaine={DOMAINE_PART}
        references={[50]}
        valeur={valeurPart(mm50, false)}
      />
      <LigneSerie
        label="% > MM200"
        title={`Part du top 50 au-dessus de sa MM200 ; n = symboles à ≥ 200 clôtures ce jour-là`}
        valeurs={partsSerie(h.mm200)}
        domaine={DOMAINE_PART}
        references={[50]}
        valeur={valeurPart(mm200, false)}
      />
      <LigneSerie
        label="Plus hauts − bas 20 j"
        title="Solde des nouveaux plus hauts et plus bas de clôture sur 20 j, en % des symboles à ≥ 21 clôtures"
        valeurs={partsSerie(h.hb20)}
        references={[0]}
        valeur={valeurSolde(hb20)}
        couleur={couleurSigne(hb20.pct)}
      />
      <LigneSerie
        label="Plus hauts − bas 55 j"
        title="Solde des nouveaux plus hauts et plus bas de clôture sur 55 j, en % des symboles à ≥ 56 clôtures"
        valeurs={partsSerie(h.hb55)}
        references={[0]}
        valeur={valeurSolde(hb55)}
        couleur={couleurSigne(hb55.pct)}
      />
      <LigneSerie
        label="Ligne A/D · top 50"
        title={`Cumul des hausses − baisses de clôture du top 50 depuis le ${dateUtc(h.debut)} (seule la pente compte) ; entre parenthèses, solde du dernier jour clos sur les éligibles : ${signe(ad.k)} sur ${ad.n}`}
        valeurs={ligneAd}
        valeur={cumulAd === null ? "non mesuré" : `${signe(cumulAd)} (${signe(ad.k)}/${ad.n})`}
        couleur={couleurSigne(cumulAd)}
      />
      <LigneSerie
        label="Osc. type McClellan · top 50"
        title="EMA 19 − EMA 39 du solde A/D du top 50 en % des éligibles (convention transposée à 50 titres : bruitée)"
        valeurs={h.mcClellan}
        references={[0]}
        valeur={mcClellan === null ? "non mesuré" : signe(mcClellan, 1)}
        couleur={couleurSigne(mcClellan)}
      />
      <LigneSerie
        label={`Alts > BTC · ${HORIZON_SAISON_JOURS} j`}
        title={`Part des alts du top 50 (hors BTC, stables, emballés, or tokenisé) dont la performance sur ${HORIZON_SAISON_JOURS} j dépasse celle de BTC ; ${libelleZone(saison90.pct)}`}
        valeurs={partsSerie(h.saison90)}
        domaine={DOMAINE_PART}
        references={[SEUIL_SAISON_BTC, SEUIL_SAISON_ALTS]}
        valeur={valeurPart(saison90, true)}
      />
      <LigneSerie
        label={`Alts > BTC · ${HORIZON_SAISON_COURT_JOURS} j`}
        title={`Variante sur ${HORIZON_SAISON_COURT_JOURS} j ; ${libelleZone(saison30.pct)}`}
        valeurs={partsSerie(h.saison30)}
        domaine={DOMAINE_PART}
        references={[SEUIL_SAISON_BTC, SEUIL_SAISON_ALTS]}
        valeur={valeurPart(saison30, true)}
      />
      <p className="text-[10px] leading-snug text-text-dim">
        Saison des alts {HORIZON_SAISON_JOURS} j : {libelleZone(saison90.pct)}. Seuils {SEUIL_SAISON_ALTS} / {SEUIL_SAISON_BTC} %
        = convention (Altcoin Season Index, non revérifiée), pas un signal. Univers = top 50 par volume du jour appliqué
        au passé (biais du survivant : jetons radiés absents, entrants récents en fin de série) ; dénominateurs
        variables. A/D et McClellan sur le top 50, distincts de l'A/D jour (univers USDT complet).
      </p>
    </div>
  );
}

export function SectionBreadth({ breadth, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Régime · largeur de marché</TitreBloc>
      {corps(breadth, "Largeur de marché indisponible.", (b) => {
        const dTend = b.pctMm50Prec === null ? null : b.pctAuDessusMm50 - b.pctMm50Prec;
        // Tendance MM50 vs calcul précédent : ▲ hausse, ▼ baisse, — stable/premier calcul.
        const fleche = dTend === null || Math.abs(dTend) < 0.5 ? "—" : dTend > 0 ? "▲" : "▼";
        const couleurFleche =
          dTend === null || Math.abs(dTend) < 0.5
            ? "var(--text-dim)"
            : dTend > 0
              ? "var(--up)"
              : "var(--down)";
        return (
          <div className="space-y-2">
            <JaugeBreadth label="% > MM50" pct={b.pctAuDessusMm50} />
            <JaugeBreadth label="% > MM200" pct={b.pctAuDessusMm200} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px]">
              <span className="text-text-dim">
                A/D jour · univers USDT{" "}
                <span className="tabular-nums text-up">{b.adJour.hausses}</span>
                <span> / </span>
                <span className="tabular-nums text-down">{b.adJour.baisses}</span>
              </span>
              <span className="text-text-dim">
                Tendance MM50 <span style={{ color: couleurFleche }}>{fleche}</span>
              </span>
            </div>
            <p className="text-[10px] text-text-dim">
              {b.nUnivers < 50 ? `${b.nUnivers}/50 valides` : `${b.nUnivers} valides`}
            </p>
            {b.historique === null ? (
              <p className="text-[10px] text-text-dim">Historique indisponible.</p>
            ) : (
              <HistoriqueBloc h={b.historique} />
            )}
          </div>
        );
      })}
      <NoteSource>Binance ticker 24 h + klines 1d (top 50, 400 j) · cache 12 h · {noteFraicheur}.</NoteSource>
    </section>
  );
}
