/**
 * Section BRIEF — concordance multi-échelle : les quatre timeframes du symbole courant
 * (15 m, 1 h, 4 h, 1 j) lisent-ils la même tendance ? Table compacte + compteur
 * d'alignement. Lecture DESCRIPTIVE : la concordance ne préjuge pas de la direction
 * future (cf. data/multiEchelle.ts).
 */
import type { Timeframe } from "@axiom/types";
import type { EchelleLue, MesureEchelle } from "../../data/multiEchelle";
import { concordanceEchelles } from "../../data/multiEchelle";
import { formatPourcentage, VALEUR_ABSENTE } from "../../lib/format";
import { NoteSource, Vide } from "../ui";
import { TableTriable, type ColonneTable } from "../TableTriable";
import { corps, TitreBloc, type Section } from "./commun";

interface Props {
  multiEchelle: Section<EchelleLue[]>;
  symbole: string;
  noteFraicheur: string;
}

const LIBELLES_TF: Partial<Record<Timeframe, string>> = {
  "15m": "15 min",
  "1h": "1 h",
  "4h": "4 h",
  "1d": "1 j",
};

function couleurVariation(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined;
  return v > 0 ? "var(--up)" : "var(--down)";
}

function couleurTendance(t: MesureEchelle["tendance"]): string | undefined {
  if (t === "hausse") return "var(--up)";
  if (t === "baisse") return "var(--down)";
  return undefined;
}

/** Colonnes de la table (lecture seule : aucune n'est triable). */
const COLONNES: readonly ColonneTable<EchelleLue>[] = [
  {
    id: "echelle",
    label: "Échelle",
    rendu: (e) => <span className="text-text-dim">{LIBELLES_TF[e.timeframe] ?? e.timeframe}</span>,
  },
  {
    id: "tendance",
    label: "Tendance",
    align: "right",
    rendu: (e) => (
      <span style={{ color: couleurTendance(e.mesure?.tendance ?? null) }}>
        {e.mesure?.tendance ?? VALEUR_ABSENTE}
      </span>
    ),
  },
  {
    id: "rsi",
    label: "RSI",
    align: "right",
    rendu: (e) => (e.mesure?.rsi === null || e.mesure === null ? VALEUR_ABSENTE : e.mesure.rsi.toFixed(1)),
  },
  {
    id: "atr",
    label: "ATR %",
    align: "right",
    rendu: (e) =>
      e.mesure?.atrPct === null || e.mesure === null ? VALEUR_ABSENTE : formatPourcentage(e.mesure.atrPct, 2),
  },
  {
    id: "variation",
    label: "Δ 20 barres",
    align: "right",
    rendu: (e) =>
      e.mesure?.variationPct === null || e.mesure === null ? (
        VALEUR_ABSENTE
      ) : (
        <span style={{ color: couleurVariation(e.mesure.variationPct) }}>
          {formatPourcentage(e.mesure.variationPct, 1)}
        </span>
      ),
  },
];

export function SectionMultiEchelle({ multiEchelle, symbole, noteFraicheur }: Props) {
  return (
    <section className="space-y-2">
      <TitreBloc>Concordance multi-échelle · {symbole}</TitreBloc>
      {corps(multiEchelle, "Échelles indisponibles.", (echelles) => {
        const mesures = echelles
          .map((e) => e.mesure)
          .filter((m): m is MesureEchelle => m !== null);
        if (mesures.length === 0) return <Vide>Aucune échelle mesurable pour ce symbole.</Vide>;
        const c = concordanceEchelles(mesures);
        return (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-text-dim">Alignement</span>
              <span className="tabular-nums text-text">
                {c.total === 0 ? VALEUR_ABSENTE : `${c.alignees}/${c.total}`}
                {c.direction !== null && c.reference !== null && (
                  <span className="ml-1 text-text-dim">
                    ({c.direction} en {LIBELLES_TF[c.reference] ?? c.reference})
                  </span>
                )}
              </span>
            </div>
            <TableTriable<EchelleLue>
              colonnes={COLONNES}
              lignes={echelles}
              cle={(e) => e.timeframe}
              ariaLabel={`Concordance multi-échelle ${symbole}`}
            />
          </div>
        );
      })}
      <NoteSource>
        Tendance = close vs EMA 50 ; RSI 14 ; ATR 14 en % du prix ; Δ sur 20 barres de l'échelle.
        Lecture descriptive — un alignement n'est pas un signal. {noteFraicheur}.
      </NoteSource>
    </section>
  );
}
