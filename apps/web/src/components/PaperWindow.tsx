/**
 * Fenêtre « PAPER » — paper trading : ordres simulés (market/limit/stop + TP/SL) exécutés
 * par le moteur temps réel (store/paper.ts, subscribeTickers), positions suivies avec PnL
 * latent live, clôtures journalisées automatiquement dans EXPY (tag "paper").
 *
 * Présentation PURE : tout l'état de trading vit dans `paperStore` (le moteur tourne hors
 * React, amorcé par App). Ici : formulaire d'ordre (symbole prérempli du chart, taille en $
 * convertie en unités au dernier prix connu), tableaux ordres/positions/exécutions, badges
 * Solde / Équity / PnL jour. Conventions du moteur (frais 0.05 %/côté, TP/SL au niveau,
 * SL prioritaire) documentées dans data/paper.ts — la fenêtre ne décide RIEN.
 */
import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { paperStore } from "../store/paper";
import { pnlLatent, FRAIS_TAKER, type OrdrePaper, type PositionPaper } from "../data/paper";
import { marketStore } from "../store/market";
import { debutJourLocalMs } from "../store/portfolio";
import { formatUsd, formatDec, VALEUR_ABSENTE } from "../lib/format";
import {
  Badge,
  BTN_SECONDAIRE,
  EnTeteFenetre,
  NoteSource,
  Segmente,
  Vide,
  type TonBadge,
} from "./ui";

// ─────────────────────────── Helpers d'affichage ───────────────────────────

/** Ton d'un montant signé (up > 0, down < 0, neutre sinon). */
function tonMontant(v: number): TonBadge {
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "neutre";
}

/** Classe de couleur texte d'un montant signé. */
function couleurMontant(v: number): string {
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-text-dim";
}

/** Montant $ signé avec préfixe explicite (convention monétaire du repo). */
function usdSigne(v: number): string {
  const signe = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${signe}${formatUsd(Math.abs(v))}`;
}

/** Libellés FR des genres d'exécution. */
const LIBELLE_GENRE: Record<string, string> = {
  ouverture: "Ouverture",
  renfort: "Renfort",
  tp: "Take profit",
  sl: "Stop loss",
  "cloture-manuelle": "Clôture manuelle",
};

/** Prix de conversion pour un symbole : derniers prix du moteur, sinon close du chart maître. */
function prixConnu(symbol: string, derniersPrix: Record<string, number>): number | undefined {
  const p = derniersPrix[symbol];
  if (p !== undefined) return p;
  const m = marketStore.getState();
  if (m.symbol === symbol) {
    const derniere = m.candles[m.candles.length - 1];
    if (derniere && Number.isFinite(derniere.close)) return derniere.close;
  }
  return undefined;
}

// ─────────────────────────── Formulaire d'ordre ───────────────────────────

type TypeOrdre = "market" | "limit" | "stop";

interface FormOrdre {
  symbol: string;
  direction: "long" | "short";
  type: TypeOrdre;
  montantUsd: string;
  prixLimite: string;
  prixStop: string;
  tp: string;
  sl: string;
}

function formInitial(symbol: string): FormOrdre {
  return { symbol, direction: "long", type: "market", montantUsd: "", prixLimite: "", prixStop: "", tp: "", sl: "" };
}

/** Nombre optionnel : champ vide → null, sinon fini > 0 requis (NaN → undefined = invalide). */
function nombreOptionnel(s: string): number | null | undefined {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

// ─────────────────────────── Composant ───────────────────────────

export function PaperWindow() {
  const solde = useStore(paperStore, (s) => s.solde);
  const ordres = useStore(paperStore, (s) => s.ordres);
  const positions = useStore(paperStore, (s) => s.positions);
  const executions = useStore(paperStore, (s) => s.executions);
  const derniersPrix = useStore(paperStore, (s) => s.derniersPrix);
  const symbolChart = useStore(marketStore, (s) => s.symbol);

  const [form, setForm] = useState<FormOrdre>(() => formInitial(symbolChart));
  const [erreurForm, setErreurForm] = useState<string | null>(null);
  const [editSolde, setEditSolde] = useState<string | null>(null);
  const [editTpSl, setEditTpSl] = useState<{ id: string; tp: string; sl: string } | null>(null);

  // Équity = solde + Σ PnL latents aux derniers prix connus (positions sans prix → 0, comptées).
  const { equity, latentTotal, sansPrix } = useMemo(() => {
    let latent = 0;
    let inconnues = 0;
    for (const p of positions) {
      const last = derniersPrix[p.symbol];
      if (last === undefined) inconnues++;
      else latent += pnlLatent(p, last);
    }
    return { equity: solde + latent, latentTotal: latent, sansPrix: inconnues };
  }, [solde, positions, derniersPrix]);

  // PnL du jour : exécutions de clôture (pnlUsd non null) depuis minuit local.
  const pnlJour = useMemo(() => {
    const debut = debutJourLocalMs(Date.now());
    return executions.reduce((acc, e) => (e.ts >= debut && e.pnlUsd !== null ? acc + e.pnlUsd : acc), 0);
  }, [executions]);

  // Conversion $ → unités au prix courant (affichée sous le champ).
  const prixConversion = prixConnu(form.symbol.trim().toUpperCase(), derniersPrix);
  const montant = Number(form.montantUsd);
  const unites =
    prixConversion !== undefined && Number.isFinite(montant) && montant > 0
      ? montant / prixConversion
      : undefined;

  const placer = (): void => {
    const symbol = form.symbol.trim().toUpperCase();
    if (symbol === "") return setErreurForm("Symbole requis.");
    if (unites === undefined || prixConversion === undefined) {
      return setErreurForm(
        prixConversion === undefined
          ? "Prix inconnu pour ce symbole — affichez-le sur le chart ou attendez un tick."
          : "Montant $ invalide (> 0 requis).",
      );
    }
    const prixLimite = nombreOptionnel(form.prixLimite);
    const prixStop = nombreOptionnel(form.prixStop);
    const tp = nombreOptionnel(form.tp);
    const sl = nombreOptionnel(form.sl);
    if (prixLimite === undefined || prixStop === undefined || tp === undefined || sl === undefined) {
      return setErreurForm("Prix invalide (nombre > 0 requis).");
    }
    if (form.type === "limit" && prixLimite === null) return setErreurForm("Prix limite requis.");
    if (form.type === "stop" && prixStop === null) return setErreurForm("Prix de déclenchement requis.");
    paperStore.getState().placerOrdre({
      symbol,
      direction: form.direction,
      type: form.type,
      prixLimite: form.type === "limit" ? prixLimite : null,
      prixStop: form.type === "stop" ? prixStop : null,
      taille: unites,
      tp,
      sl,
    });
    setErreurForm(null);
    setForm((f) => ({ ...f, montantUsd: "", prixLimite: "", prixStop: "", tp: "", sl: "" }));
  };

  const validerTpSl = (): void => {
    if (!editTpSl) return;
    const tp = nombreOptionnel(editTpSl.tp);
    const sl = nombreOptionnel(editTpSl.sl);
    if (tp === undefined || sl === undefined) return; // saisie invalide → on n'applique pas
    paperStore.getState().modifierTpSl(editTpSl.id, tp, sl);
    setEditTpSl(null);
  };

  const inputCls =
    "w-full rounded border border-border bg-bg px-2 py-1 text-xs tabular-nums text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <>
      <EnTeteFenetre
        mnemo="PAPER"
        titre="Paper trading"
        sousTitre="Ordres simulés · flux live · journalisation EXPY"
        actions={
          editSolde === null ? (
            <button
              type="button"
              className={BTN_SECONDAIRE}
              title="Modifier le solde fictif"
              onClick={() => setEditSolde(String(solde))}
            >
              ⚙ solde
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input
                className={`${inputCls} w-24`}
                value={editSolde}
                onChange={(e) => setEditSolde(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = Number(editSolde);
                    if (Number.isFinite(v)) paperStore.getState().setSolde(v);
                    setEditSolde(null);
                  }
                  if (e.key === "Escape") setEditSolde(null);
                }}
              />
              <button type="button" className={BTN_SECONDAIRE} onClick={() => setEditSolde(null)}>
                ✕
              </button>
            </span>
          )
        }
      />

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {/* Badges Solde / Équity / PnL jour */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge ton="neutre">Solde {formatUsd(solde)}</Badge>
          <Badge ton={tonMontant(latentTotal)}>
            Équity {formatUsd(equity)}
            {sansPrix > 0 ? ` (${sansPrix} sans prix)` : ""}
          </Badge>
          <Badge ton={tonMontant(pnlJour)}>PnL jour {usdSigne(pnlJour)}</Badge>
        </div>

        {/* Formulaire d'ordre */}
        <section className="rounded-md border border-border bg-bg p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              Symbole
              <input
                className={inputCls}
                value={form.symbol}
                onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                placeholder="BTCUSDT"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              Direction
              <Segmente
                actif={form.direction}
                options={[
                  { id: "long" as const, label: "Long" },
                  { id: "short" as const, label: "Short" },
                ]}
                onChange={(direction: "long" | "short") => setForm((f) => ({ ...f, direction }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              Type
              <Segmente
                actif={form.type}
                options={[
                  { id: "market" as const, label: "Mkt" },
                  { id: "limit" as const, label: "Limit" },
                  { id: "stop" as const, label: "Stop" },
                ]}
                onChange={(type: TypeOrdre) => setForm((f) => ({ ...f, type }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              Montant ($)
              <input
                className={inputCls}
                value={form.montantUsd}
                onChange={(e) => setForm((f) => ({ ...f, montantUsd: e.target.value }))}
                placeholder="1000"
              />
            </label>
            {form.type === "limit" && (
              <label className="flex flex-col gap-1 text-[10px] text-text-dim">
                Prix limite
                <input
                  className={inputCls}
                  value={form.prixLimite}
                  onChange={(e) => setForm((f) => ({ ...f, prixLimite: e.target.value }))}
                />
              </label>
            )}
            {form.type === "stop" && (
              <label className="flex flex-col gap-1 text-[10px] text-text-dim">
                Déclenchement
                <input
                  className={inputCls}
                  value={form.prixStop}
                  onChange={(e) => setForm((f) => ({ ...f, prixStop: e.target.value }))}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              TP (opt.)
              <input
                className={inputCls}
                value={form.tp}
                onChange={(e) => setForm((f) => ({ ...f, tp: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              SL (opt.)
              <input
                className={inputCls}
                value={form.sl}
                onChange={(e) => setForm((f) => ({ ...f, sl: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] tabular-nums text-text-dim">
              {unites !== undefined && prixConversion !== undefined
                ? `≈ ${formatDec(unites, 6)} unités @ ${formatUsd(prixConversion)} · frais ${(FRAIS_TAKER * 100).toFixed(2)} %/côté`
                : "—"}
            </span>
            <button type="button" className={BTN_SECONDAIRE} onClick={placer}>
              Placer
            </button>
          </div>
          {erreurForm !== null && <p className="mt-1 text-[10px] text-down">{erreurForm}</p>}
        </section>

        {/* Ordres en attente */}
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
            Ordres en attente ({ordres.length})
          </h3>
          {ordres.length === 0 ? (
            <Vide>Aucun ordre en attente.</Vide>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {ordres.map((o: OrdrePaper) => (
                  <tr key={o.id} className="border-b border-border/50">
                    <td className="py-1 font-medium">{o.symbol}</td>
                    <td className={o.direction === "long" ? "text-up" : "text-down"}>{o.direction}</td>
                    <td className="text-text-dim">{o.type}</td>
                    <td className="tabular-nums text-text-dim">
                      {o.type === "limit" && o.prixLimite !== null
                        ? `@ ${formatUsd(o.prixLimite)}`
                        : o.type === "stop" && o.prixStop !== null
                          ? `décl. ${formatUsd(o.prixStop)}`
                          : "au marché"}
                    </td>
                    <td className="tabular-nums text-text-dim">{formatDec(o.taille, 6)} u</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-text-dim transition hover:text-down"
                        title="Annuler l'ordre"
                        onClick={() => paperStore.getState().annulerOrdre(o.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Positions ouvertes */}
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">
            Positions ({positions.length})
          </h3>
          {positions.length === 0 ? (
            <Vide>Aucune position ouverte.</Vide>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {positions.map((p: PositionPaper) => {
                  const last = derniersPrix[p.symbol];
                  const pnl = last !== undefined ? pnlLatent(p, last) : null;
                  const enEdition = editTpSl?.id === p.id;
                  return (
                    <tr key={p.id} className="border-b border-border/50 align-middle">
                      <td className="py-1 font-medium">{p.symbol}</td>
                      <td className={p.direction === "long" ? "text-up" : "text-down"}>{p.direction}</td>
                      <td className="tabular-nums text-text-dim">
                        {formatDec(p.taille, 6)} u @ {formatUsd(p.prixEntree)}
                      </td>
                      <td className="tabular-nums text-text-dim">
                        {last !== undefined ? formatUsd(last) : VALEUR_ABSENTE}
                      </td>
                      <td className={`tabular-nums font-medium ${pnl !== null ? couleurMontant(pnl) : "text-text-dim"}`}>
                        {pnl !== null ? usdSigne(pnl) : VALEUR_ABSENTE}
                      </td>
                      <td className="tabular-nums text-text-dim">
                        {enEdition ? (
                          <span className="flex items-center gap-1">
                            <input
                              className={`${inputCls} w-20`}
                              placeholder="TP"
                              value={editTpSl.tp}
                              onChange={(e) => setEditTpSl({ ...editTpSl, tp: e.target.value })}
                              onKeyDown={(e) => e.key === "Enter" && validerTpSl()}
                            />
                            <input
                              className={`${inputCls} w-20`}
                              placeholder="SL"
                              value={editTpSl.sl}
                              onChange={(e) => setEditTpSl({ ...editTpSl, sl: e.target.value })}
                              onKeyDown={(e) => e.key === "Enter" && validerTpSl()}
                            />
                            <button type="button" className={BTN_SECONDAIRE} onClick={validerTpSl}>
                              OK
                            </button>
                            <button type="button" className={BTN_SECONDAIRE} onClick={() => setEditTpSl(null)}>
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="text-text-dim underline decoration-dotted transition hover:text-text"
                            title="Éditer TP / SL"
                            onClick={() =>
                              setEditTpSl({ id: p.id, tp: p.tp !== null ? String(p.tp) : "", sl: p.sl !== null ? String(p.sl) : "" })
                            }
                          >
                            TP {p.tp !== null ? formatUsd(p.tp) : "—"} · SL {p.sl !== null ? formatUsd(p.sl) : "—"}
                          </button>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className={BTN_SECONDAIRE}
                          disabled={last === undefined}
                          title={last === undefined ? "Prix inconnu — attendez un tick" : "Clôturer au dernier prix"}
                          onClick={() => paperStore.getState().cloturer(p.id)}
                        >
                          Clôturer
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Dernières exécutions */}
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-text-dim">Dernières exécutions</h3>
          {executions.length === 0 ? (
            <Vide>Aucune exécution.</Vide>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {[...executions]
                  .slice(-10)
                  .reverse()
                  .map((e, i) => (
                    <tr key={`${e.ts}-${i}`} className="border-b border-border/50">
                      <td className="py-1 text-text-dim">
                        {new Date(e.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="font-medium">{e.symbol}</td>
                      <td className="text-text-dim">{LIBELLE_GENRE[e.genre] ?? e.genre}</td>
                      <td className="tabular-nums text-text-dim">@ {formatUsd(e.prix)}</td>
                      <td className={`tabular-nums ${e.pnlUsd !== null ? couleurMontant(e.pnlUsd) : "text-text-dim"}`}>
                        {e.pnlUsd !== null ? usdSigne(e.pnlUsd) : VALEUR_ABSENTE}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        <NoteSource>
          Simulation : frais {(FRAIS_TAKER * 100).toFixed(2)} %/côté, slippage nul, TP/SL remplis au
          niveau (SL prioritaire). Clôtures journalisées dans EXPY (tag « paper »).
        </NoteSource>
      </div>
    </>
  );
}
