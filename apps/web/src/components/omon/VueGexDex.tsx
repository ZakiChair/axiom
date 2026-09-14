/**
 * Vue GEX/DEX de la fenêtre « Options » (OMON) — extraite d'OptionsWindow.tsx (composant présentationnel).
 *
 * Contrairement aux vues smile/heatmap/termiv, ce bloc reste monté CONDITIONNELLEMENT par
 * l'orchestrateur (`{vue === "gexdex" && <VueGexDex … />}`) — pas de canvas useDomaineZoom ici.
 * TOUTE la logique (state cboe/metrique, mémos, effets, handlers) reste dans l'orchestrateur ;
 * ce fichier ne reçoit que des props.
 *
 * Lot E (v2.6) : tuile VERDICT market maker en tête (régime gamma + phrase d'action), murs
 * call/put nommés, distance spot↔flip, portée AFFICHÉE sur chaque tuile (toutes échéances vs
 * échéance sélectionnée), infobulle au survol de l'histogramme et courbe compacte du profil
 * GEX(S) sous l'histogramme (crypto uniquement — les greeks CBOE sont figés, non re-simulables).
 */
import type { MursGamma, ScenarioGamma, VerdictGamma } from "../../data/gexDex";
import { niveauCrypto } from "../../data/cboe";
import { formatDec, formatEntier, formatPct, formatPourcentage, formatUsd } from "../../lib/format";
import { Badge, TuileStat, ErreurBloc, NoteSource, Fraicheur, InfobulleGraphe } from "../ui";
import { formatStrike } from "./dessins";
import { formatUsdExact } from "./format";

/** Barre survolée de l'histogramme GEX/DEX — pilote l'InfobulleGraphe (même patron que SurvolSmile). */
export interface SurvolBarres {
  xPix: number;
  largeur: number;
  strike: number;
  gex: number;
  dex: number;
  oiCall: number | null;
  oiPut: number | null;
  /** Strike converti en niveau crypto (ETF seulement), null sinon ou si la référence manque. */
  niveauCrypto: number | null;
}

/** Lecture d'un ETF spot crypto (IBIT → BTC, ETHA → ETH) en classe Actions. */
export interface LectureEtf {
  sousJacent: "BTC" | "ETH";
  prixEtf: number;
  /** Clôture Binance 1m au dernier échange de l'ETF ; null = conversion masquée. */
  prixCrypto: number | null;
  /** Heure du dernier échange (New York, sans offset), null si absente. */
  dernierEchangeNy: string | null;
  /** IV30 CBOE (%). */
  iv30: number;
  /** Ratios put/call de la chaîne complète (NaN si aucun call). */
  pcOi: number;
  pcVol: number;
  /** Σ OI × 100 × prix de l'ETF, chaîne complète (USD). */
  notionnelUsd: number;
}

interface Props {
  metrique: "gex" | "dex";
  classe: "crypto" | "actions";
  loading: boolean;
  cboeLoading: boolean;
  majTs: number | null;
  erreur: string | null;
  cboeErreur: string | null;
  barCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  gexNet: number;
  dexNet: number;
  /**
   * Spot du PÉRIMÈTRE du verdict (spot de la chaîne complète en crypto, spot
   * CBOE en actions) — le même que celui de Spot↔flip, pour que recalculer
   * (spot − flip)/spot depuis les tuiles redonne le % affiché (revue v2.6 no 8).
   */
  spotVerdict: number;
  flip: number | null;
  strikePicGex: number | null;
  /** Verdict sous la convention principale — régime, action, distance au flip. */
  verdict: VerdictGamma;
  /** Murs de gamma nommés (mursGamma) — même périmètre que le net/flip. */
  murs: MursGamma;
  scenariosGamma: ScenarioGamma[];
  /** Zéro du profil GEX(S) (crypto), null si aucun ou en classe actions. */
  flipReel: number | null;
  /** Canvas du profil GEX(S) — rendu seulement en crypto (dessiné par l'orchestrateur). */
  profilCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Lecture ETF (IBIT/ETHA) : conversions en niveaux crypto et tuiles dédiées ; null sinon. */
  etf: LectureEtf | null;
  survolBarres: SurvolBarres | null;
  onSurvolBarres: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onSortieBarres: () => void;
}

export function VueGexDex({
  metrique,
  classe,
  loading,
  cboeLoading,
  majTs,
  erreur,
  cboeErreur,
  barCanvasRef,
  gexNet,
  dexNet,
  spotVerdict,
  flip,
  strikePicGex,
  verdict,
  murs,
  scenariosGamma,
  flipReel,
  profilCanvasRef,
  etf,
  survolBarres,
  onSurvolBarres,
  onSortieBarres,
}: Props) {
  // Portée du net/flip/murs/verdict : TOUTES les échéances en crypto (agrégation gexDexTout),
  // échéance sélectionnée en actions (le CBOE reste mono-échéance). L'histogramme et le pic
  // |GEX|, eux, sont TOUJOURS mono-échéance — la portée est affichée tuile par tuile.
  const porteeNet = classe === "crypto" ? "toutes échéances" : "échéance sélectionnée";

  // Libellé + ton de la tuile verdict : long gamma = marché amorti (up), short gamma =
  // amplifié (down), indéterminé = neutre (pas de ton).
  const libelleVerdict =
    verdict.regime === "long-gamma"
      ? `Long gamma — ${verdict.qualificatif}`
      : verdict.regime === "short-gamma"
        ? `Short gamma — ${verdict.qualificatif}`
        : "Indéterminé";
  const tonVerdict =
    verdict.regime === "long-gamma" ? "up" : verdict.regime === "short-gamma" ? "down" : undefined;

  // Décimales des OI de l'infobulle : unités de base (fractionnaires) en crypto, contrats
  // entiers en actions.
  const decOi = classe === "crypto" ? 2 : 0;

  // ETF : niveau crypto équivalent affiché à côté du strike (« ≈ — BTC » si la référence manque).
  const converti = (strike: number | null) =>
    etf ? (
      <span className="text-[10px] text-text-dim">
        ≈ {formatUsdExact(niveauCrypto(strike, etf.prixEtf, etf.prixCrypto))} {etf.sousJacent}
      </span>
    ) : undefined;

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
        <span>
          {metrique === "gex" ? "Gamma exposure" : "Delta exposure"} par strike · échéance
          sélectionnée
        </span>
        <Fraicheur loading={classe === "crypto" ? loading : cboeLoading} majTs={majTs} />
      </div>

      {classe === "actions" && (
        <div className="mb-3 rounded-md border border-border bg-bg px-3 py-1.5 text-[10px] text-text-dim">
          {etf
            ? `CBOE — différé ~15 min — marché US fermé nuits et week-ends · dernier échange ${
                etf.dernierEchangeNy?.replace("T", " ") ?? "—"
              } (heure de New York) · niveaux ≈ ${etf.sousJacent} par ratio de prix au dernier échange (pas la NAV)${
                etf.prixCrypto === null ? ` · conversion en ${etf.sousJacent} indisponible (bougie Binance absente)` : ""
              } · endpoint non contractuel.`
            : "CBOE — données différées (~15 min), endpoint non contractuel."}
        </div>
      )}

      {(classe === "crypto" ? erreur : cboeErreur) && (
        <div className="mb-3">
          <ErreurBloc>{classe === "crypto" ? erreur : cboeErreur}</ErreurBloc>
        </div>
      )}

      <div className="rounded-md border border-border bg-bg p-2">
        <div className="relative">
          <canvas
            ref={barCanvasRef}
            className="h-[200px] w-full"
            onMouseMove={onSurvolBarres}
            onMouseLeave={onSortieBarres}
          />
          {survolBarres && (
            <InfobulleGraphe
              xPix={survolBarres.xPix}
              largeurGraphe={survolBarres.largeur}
              titre={`Strike ${formatStrike(survolBarres.strike)}`}
              lignes={[
                {
                  label: "GEX",
                  valeur: formatUsd(survolBarres.gex),
                  couleur: survolBarres.gex >= 0 ? "var(--up)" : "var(--down)",
                },
                {
                  label: "DEX",
                  valeur: formatUsd(survolBarres.dex),
                  couleur: survolBarres.dex >= 0 ? "var(--up)" : "var(--down)",
                },
                { label: "OI calls", valeur: formatDec(survolBarres.oiCall, decOi) },
                { label: "OI puts", valeur: formatDec(survolBarres.oiPut, decOi) },
                ...(etf ? [{ label: `≈ ${etf.sousJacent}`, valeur: formatUsdExact(survolBarres.niveauCrypto) }] : []),
              ]}
            />
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-4 text-[10px] text-text-dim">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-up" />
          exposition positive
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded bg-down" />
          exposition négative
        </span>
      </div>

      {/* Profil GEX(S) — crypto uniquement : GEX net recalculé à spot simulé (±15 %),
          zéro du profil = « flip réel ». Pas d'équivalent actions (greeks CBOE figés). */}
      {classe === "crypto" && (
        <div className="mt-2 rounded-md border border-border bg-bg p-2">
          <div className="mb-1 flex items-center justify-between text-[10px] text-text-dim">
            <span>Profil GEX net (spot simulé ±15 %) · toutes échéances</span>
            <span>flip réel : {formatUsdExact(flipReel)}</span>
          </div>
          <canvas ref={profilCanvasRef} className="h-[90px] w-full" />
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {/* Tuile VERDICT en tête : le MM doit-il acheter ou vendre le sous-jacent ? */}
        <div className="col-span-2">
          <TuileStat
            label="Verdict sous hypothèse gamma"
            valeur={libelleVerdict}
            ton={tonVerdict}
            badge={<Badge>{porteeNet}</Badge>}
            pied={<span>{verdict.action}</span>}
          />
        </div>
        <TuileStat
          disposition="inline"
          label="GEX net"
          badge={<Badge>{porteeNet}</Badge>}
          valeur={formatUsd(gexNet)}
          couleur={gexNet !== 0 ? (gexNet > 0 ? "var(--up)" : "var(--down)") : undefined}
        />
        <TuileStat
          disposition="inline"
          label="DEX net"
          badge={<Badge>{porteeNet}</Badge>}
          valeur={formatUsd(dexNet)}
          couleur={dexNet !== 0 ? (dexNet > 0 ? "var(--up)" : "var(--down)") : undefined}
        />
        <TuileStat
          disposition="inline"
          label="Spot"
          badge={<Badge>{porteeNet}</Badge>}
          valeur={formatUsdExact(spotVerdict)}
          extra={converti(spotVerdict)}
        />
        <TuileStat
          disposition="inline"
          label="Gamma flip"
          badge={
            <>
              <Badge>{porteeNet}</Badge>
              {etf && (
                <Badge
                  ton="warn"
                  title="Sur une chaîne d'ETF, le cumul du GEX par strike change souvent de signe plusieurs fois (cinq fois sur l'échéance IBIT du 18/09 sondée) : premier passage instable, les murs sont plus robustes."
                >
                  indicatif
                </Badge>
              )}
            </>
          }
          valeur={formatUsdExact(flip)}
          extra={converti(flip)}
        />
        <TuileStat
          disposition="inline"
          label="Spot↔flip"
          badge={<Badge>{porteeNet}</Badge>}
          valeur={formatPct(verdict.distanceFlipPct, 1)}
          couleur={
            verdict.distanceFlipPct !== null && verdict.distanceFlipPct !== 0
              ? verdict.distanceFlipPct > 0
                ? "var(--up)"
                : "var(--down)"
              : undefined
          }
        />
        <TuileStat
          disposition="inline"
          label="Call wall"
          badge={<Badge>{porteeNet}</Badge>}
          valeur={formatUsdExact(murs.callWall)}
          extra={converti(murs.callWall)}
        />
        <TuileStat
          disposition="inline"
          label="Put wall"
          badge={<Badge>{porteeNet}</Badge>}
          valeur={formatUsdExact(murs.putWall)}
          extra={converti(murs.putWall)}
        />
        <TuileStat
          disposition="inline"
          label="Strike |GEX| max"
          badge={<Badge>échéance sélectionnée</Badge>}
          valeur={formatUsdExact(strikePicGex)}
          extra={converti(strikePicGex)}
        />
        {etf && (
          <>
            <TuileStat
              disposition="inline"
              label="P/C (OI)"
              badge={<Badge>chaîne complète</Badge>}
              valeur={formatDec(etf.pcOi, 2)}
            />
            <TuileStat
              disposition="inline"
              label="P/C (Vol)"
              badge={<Badge>chaîne complète</Badge>}
              valeur={formatDec(etf.pcVol, 2)}
              title="Volume du fichier CBOE : consolidé toutes places ou propre au CBOE, non vérifié"
            />
            <TuileStat disposition="inline" label="IV30 (CBOE)" valeur={formatPourcentage(etf.iv30, 1)} />
            <TuileStat
              disposition="inline"
              label="Notionnel OI"
              badge={<Badge>chaîne complète</Badge>}
              valeur={formatUsd(etf.notionnelUsd)}
              extra={
                <span className="text-[10px] text-text-dim">
                  ≈ {etf.prixCrypto === null ? "—" : formatEntier(etf.notionnelUsd / etf.prixCrypto)} {etf.sousJacent}
                </span>
              }
            />
          </>
        )}
      </div>

      {scenariosGamma.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-bg px-2 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-text-dim">
            <span className="font-medium text-text">Sensibilité au signe gamma</span>
            <Badge>mêmes contrats · spot · horloge</Badge>
          </div>
          <div className="grid gap-1 text-[10px] md:grid-cols-3">
            {scenariosGamma.map((scenario) => (
              <div key={scenario.hypothese} className="rounded border border-border/60 bg-surface px-2 py-1.5">
                <div className="font-medium text-text">{scenario.libelle}</div>
                <div className="mt-0.5 tabular-nums text-text-dim">GEX {formatUsd(scenario.gexNet)}</div>
                <div className="tabular-nums text-text-dim">
                  flip cumul/strike {formatUsdExact(scenario.flipCumulStrike)}
                </div>
                <div className="text-text-dim">verdict {scenario.verdict.regime}</div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-text-dim">
            Scénarios de convention, pas des positions dealer observées. Le DEX conserve son delta signé.
          </p>
        </div>
      )}

      <div className="mt-3">
        <NoteSource>
          {classe === "crypto"
            ? "GEX/DEX calculés côté client (Black-Scholes sur IV mark Deribit, OI en unités de base, multiplicateur 1). La convention calls+/puts− et les variantes tous-long/tous-short sont des hypothèses, pas une observation des portefeuilles dealers. Histogramme et pic |GEX| : échéance sélectionnée. Net, flip cumul/strike, murs, verdict et profil GEX(S) : toutes échéances ; le flip réel du profil est le zéro du GEX recalculé en spot."
            : "Greeks pré-calculés CBOE (multiplicateur 100) — toutes les métriques portent sur l'échéance sélectionnée. Convention : dealers long les calls, short les puts — le signe du GEX en dépend. GEX = Σ(Γc·OIc − Γp·OIp)·S²·0,01·mult ; DEX = Σ(Δ·OI)·S·mult. Histogramme : strikes < 0,5 % du max masqués. Pas de profil GEX(S) : greeks figés, non re-simulables."}
          {etf &&
            ` ETF ${etf.sousJacent} : strikes conservés à ±25 % du prix de l'ETF (P/C et notionnel sur la chaîne complète) ; OI OCC mis à jour une fois par jour ; volume consolidé ou propre au CBOE : non vérifié. Niveau ≈ ${etf.sousJacent} = strike × clôture Binance 1 min au dernier échange ÷ prix de l'ETF : approximation, pas la NAV (frais, prime ou décote) ; « — » si la bougie manque, jamais le cours courant.`}
        </NoteSource>
      </div>
    </>
  );
}
