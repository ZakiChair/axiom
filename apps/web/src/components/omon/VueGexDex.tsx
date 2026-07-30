/**
 * Vue GEX/DEX de la fenêtre « Options » (OMON) — extraite d'OptionsWindow.tsx (composant présentationnel).
 *
 * Contrairement aux vues smile/heatmap/termiv, ce bloc reste monté CONDITIONNELLEMENT par
 * l'orchestrateur (`{vue === "gexdex" && <VueGexDex … />}`) — pas de canvas useDomaineZoom ici.
 * TOUTE la logique (state cboe/metrique, mémos, effets, handlers) reste dans l'orchestrateur ;
 * ce fichier ne reçoit que des props. ZÉRO changement de rendu.
 */
import { formatUsd } from "../../lib/format";
import { TuileStat, ErreurBloc, NoteSource, Fraicheur } from "../ui";
import { formatUsdExact } from "./format";

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
  gexDexSpot: number;
  flip: number | null;
  strikePicGex: number | null;
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
  gexDexSpot,
  flip,
  strikePicGex,
}: Props) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between text-[11px] text-text-dim">
        <span>{metrique === "gex" ? "Gamma exposure" : "Delta exposure"} par strike</span>
        <Fraicheur loading={classe === "crypto" ? loading : cboeLoading} majTs={majTs} />
      </div>

      {classe === "actions" && (
        <div className="mb-3 rounded-md border border-border bg-bg px-3 py-1.5 text-[10px] text-text-dim">
          CBOE — données différées (~15 min), endpoint non contractuel.
        </div>
      )}

      {(classe === "crypto" ? erreur : cboeErreur) && (
        <div className="mb-3">
          <ErreurBloc>{classe === "crypto" ? erreur : cboeErreur}</ErreurBloc>
        </div>
      )}

      <div className="rounded-md border border-border bg-bg p-2">
        <canvas ref={barCanvasRef} className="h-[200px] w-full" />
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

      <div className="mt-3 grid grid-cols-2 gap-2">
        <TuileStat
          disposition="inline"
          label={classe === "crypto" ? "GEX net (toutes éch.)" : "GEX net"}
          valeur={formatUsd(gexNet)}
          couleur={gexNet !== 0 ? (gexNet > 0 ? "var(--up)" : "var(--down)") : undefined}
        />
        <TuileStat
          disposition="inline"
          label={classe === "crypto" ? "DEX net (toutes éch.)" : "DEX net"}
          valeur={formatUsd(dexNet)}
          couleur={dexNet !== 0 ? (dexNet > 0 ? "var(--up)" : "var(--down)") : undefined}
        />
        <TuileStat disposition="inline" label="Spot" valeur={formatUsdExact(gexDexSpot)} />
        <TuileStat disposition="inline" label="Gamma flip" valeur={formatUsdExact(flip)} />
        <TuileStat
          disposition="inline"
          label="Strike |GEX| max"
          valeur={formatUsdExact(strikePicGex)}
        />
      </div>

      <div className="mt-3">
        <NoteSource>
          {classe === "crypto"
            ? "GEX/DEX calculés côté client (Black-Scholes sur IV mark Deribit, OI en unités de base, multiplicateur 1). Une seule échéance."
            : "Greeks pré-calculés CBOE (multiplicateur 100). GEX = Σ(Γc·OIc − Γp·OIp)·S²·0,01·mult ; DEX = Σ(Δ·OI)·S·mult."}
        </NoteSource>
      </div>
    </>
  );
}
