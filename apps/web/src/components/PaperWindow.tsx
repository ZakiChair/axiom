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
import { paperOverlayStore } from "../chart/paperLignes";
import { pnlLatent, FRAIS_TAKER, type ExecutionPaper, type OrdrePaper, type PositionPaper } from "../data/paper";
import { marketStore } from "../store/market";
import { debutJourLocalMs } from "../store/portfolio";
import { formatUsd, formatDec, VALEUR_ABSENTE } from "../lib/format";
import {
  Badge,
  Bouton,
  BoutonBascule,
  BTN_SECONDAIRE,
  EnTeteFenetre,
  Input,
  NoteSource,
  Segmente,
  TitreSection,
  type TonBadge,
} from "./ui";
import { TableTriable, type ColonneTable } from "./TableTriable";

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
  // Overlay des lignes d'ordres/positions sur le chart maître (toggle éphémère, défaut ON).
  const overlayActif = useStore(paperOverlayStore, (s) => s.actif);

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

  // Colonnes des 3 tables — triable: false partout (l'apport = en-têtes + gabarit unique,
  // pas le tri). Les `rendu` reprennent EXACTEMENT le JSX des cellules d'origine.
  const COLONNES_ORDRES: ColonneTable<OrdrePaper>[] = [
    { id: "symbole", label: "Symbole", triable: false, rendu: (o) => <span className="font-medium">{o.symbol}</span> },
    {
      id: "sens",
      label: "Sens",
      triable: false,
      rendu: (o) => <span className={o.direction === "long" ? "text-up" : "text-down"}>{o.direction}</span>,
    },
    { id: "type", label: "Type", triable: false, rendu: (o) => <span className="text-text-dim">{o.type}</span> },
    {
      id: "prix",
      label: "Prix",
      triable: false,
      rendu: (o) => (
        <span className="text-text-dim">
          {o.type === "limit" && o.prixLimite !== null
            ? `@ ${formatUsd(o.prixLimite)}`
            : o.type === "stop" && o.prixStop !== null
              ? `décl. ${formatUsd(o.prixStop)}`
              : "au marché"}
        </span>
      ),
    },
    {
      id: "taille",
      label: "Taille",
      triable: false,
      rendu: (o) => <span className="text-text-dim">{formatDec(o.taille, 6)} u</span>,
    },
    {
      id: "action",
      label: "",
      align: "right",
      triable: false,
      rendu: (o) => (
        <button
          type="button"
          className="text-text-dim transition hover:text-down"
          title="Annuler l'ordre"
          onClick={() => paperStore.getState().annulerOrdre(o.id)}
        >
          ✕
        </button>
      ),
    },
  ];

  const COLONNES_POSITIONS: ColonneTable<PositionPaper>[] = [
    { id: "symbole", label: "Symbole", triable: false, rendu: (p) => <span className="font-medium">{p.symbol}</span> },
    {
      id: "sens",
      label: "Sens",
      triable: false,
      rendu: (p) => <span className={p.direction === "long" ? "text-up" : "text-down"}>{p.direction}</span>,
    },
    {
      id: "taille",
      label: "Taille",
      triable: false,
      rendu: (p) => (
        <span className="text-text-dim">
          {formatDec(p.taille, 6)} u @ {formatUsd(p.prixEntree)}
        </span>
      ),
    },
    {
      // Brief : 7 en-têtes « Symbole/Sens/Taille/Entrée/PnL latent/TP-SL/(actions) » pour 7
      // cellules, mais cette cellule est le DERNIER prix connu (pas le prix d'entrée, déjà
      // dans « Taille ») — « Entrée » induirait le trader en erreur, on garde « Dernier ».
      id: "dernier",
      label: "Dernier",
      triable: false,
      rendu: (p) => {
        const last = derniersPrix[p.symbol];
        return <span className="text-text-dim">{last !== undefined ? formatUsd(last) : VALEUR_ABSENTE}</span>;
      },
    },
    {
      id: "pnl",
      label: "PnL latent",
      triable: false,
      rendu: (p) => {
        const last = derniersPrix[p.symbol];
        const pnl = last !== undefined ? pnlLatent(p, last) : null;
        return (
          <span className={`font-medium ${pnl !== null ? couleurMontant(pnl) : "text-text-dim"}`}>
            {pnl !== null ? usdSigne(pnl) : VALEUR_ABSENTE}
          </span>
        );
      },
    },
    {
      id: "tpsl",
      label: "TP-SL",
      triable: false,
      rendu: (p) => {
        const enEdition = editTpSl?.id === p.id;
        return (
          <span className="text-text-dim">
            {enEdition && editTpSl !== null ? (
              <span className="flex items-center gap-1">
                <Input
                  className="w-20 tabular-nums"
                  placeholder="TP"
                  value={editTpSl.tp}
                  onChange={(e) => setEditTpSl({ ...editTpSl, tp: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && validerTpSl()}
                />
                <Input
                  className="w-20 tabular-nums"
                  placeholder="SL"
                  value={editTpSl.sl}
                  onChange={(e) => setEditTpSl({ ...editTpSl, sl: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && validerTpSl()}
                />
                <Bouton onClick={validerTpSl}>OK</Bouton>
                <Bouton onClick={() => setEditTpSl(null)}>✕</Bouton>
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
          </span>
        );
      },
    },
    {
      id: "action",
      label: "",
      align: "right",
      triable: false,
      rendu: (p) => {
        const last = derniersPrix[p.symbol];
        return (
          <Bouton
            disabled={last === undefined}
            title={last === undefined ? "Prix inconnu — attendez un tick" : "Clôturer au dernier prix"}
            onClick={() => paperStore.getState().cloturer(p.id)}
          >
            Clôturer
          </Bouton>
        );
      },
    },
  ];

  // { exec, idx } : l'index (unique par construction, contrairement à ts/symbol/genre/prix
  // qui peuvent coïncider entre deux exécutions) fournit la clé React — comme l'ancien
  // `key={`${e.ts}-${i}`}`.
  const COLONNES_EXECUTIONS: ColonneTable<{ exec: ExecutionPaper; idx: number }>[] = [
    {
      id: "heure",
      label: "Heure",
      triable: false,
      rendu: ({ exec: e }) => (
        <span className="text-text-dim">
          {new Date(e.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      ),
    },
    {
      id: "symbole",
      label: "Symbole",
      triable: false,
      rendu: ({ exec: e }) => <span className="font-medium">{e.symbol}</span>,
    },
    {
      id: "genre",
      label: "Genre",
      triable: false,
      rendu: ({ exec: e }) => <span className="text-text-dim">{LIBELLE_GENRE[e.genre] ?? e.genre}</span>,
    },
    {
      id: "prix",
      label: "Prix",
      triable: false,
      rendu: ({ exec: e }) => <span className="text-text-dim">@ {formatUsd(e.prix)}</span>,
    },
    {
      id: "pnl",
      label: "PnL",
      triable: false,
      rendu: ({ exec: e }) => (
        <span className={e.pnlUsd !== null ? couleurMontant(e.pnlUsd) : "text-text-dim"}>
          {e.pnlUsd !== null ? usdSigne(e.pnlUsd) : VALEUR_ABSENTE}
        </span>
      ),
    },
  ];

  const executionsRecentes = [...executions]
    .slice(-10)
    .reverse()
    .map((exec, idx) => ({ exec, idx }));

  return (
    <>
      <EnTeteFenetre
        mnemo="PAPER"
        titre="Paper trading"
        sousTitre="Ordres simulés · flux live · journalisation EXPY"
      />

      <div className="space-y-3 px-4 py-3">
        {/* Overlay des lignes d'ordres/positions du symbole courant sur le chart maître + solde fictif. */}
        <div className="flex items-center gap-2">
          <BoutonBascule
            actif={overlayActif}
            title="Afficher les ordres/positions sur le chart maître"
            onClick={() => paperOverlayStore.getState().basculer()}
          >
            Lignes
          </BoutonBascule>
          {editSolde === null ? (
            <Bouton title="Modifier le solde fictif" onClick={() => setEditSolde(String(solde))}>
              ⚙ solde
            </Bouton>
          ) : (
            <span className="flex items-center gap-1">
              <Input
                className="w-24 tabular-nums"
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
              <Bouton onClick={() => setEditSolde(null)}>✕</Bouton>
            </span>
          )}
        </div>

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
              <Input
                className="w-full"
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
              <Input
                className="w-full tabular-nums"
                value={form.montantUsd}
                onChange={(e) => setForm((f) => ({ ...f, montantUsd: e.target.value }))}
                placeholder="1000"
              />
            </label>
            {form.type === "limit" && (
              <label className="flex flex-col gap-1 text-[10px] text-text-dim">
                Prix limite
                <Input
                  className="w-full tabular-nums"
                  value={form.prixLimite}
                  onChange={(e) => setForm((f) => ({ ...f, prixLimite: e.target.value }))}
                />
              </label>
            )}
            {form.type === "stop" && (
              <label className="flex flex-col gap-1 text-[10px] text-text-dim">
                Déclenchement
                <Input
                  className="w-full tabular-nums"
                  value={form.prixStop}
                  onChange={(e) => setForm((f) => ({ ...f, prixStop: e.target.value }))}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              TP (opt.)
              <Input
                className="w-full tabular-nums"
                value={form.tp}
                onChange={(e) => setForm((f) => ({ ...f, tp: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-text-dim">
              SL (opt.)
              <Input
                className="w-full tabular-nums"
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
          <TitreSection>Ordres en attente ({ordres.length})</TitreSection>
          <TableTriable
            colonnes={COLONNES_ORDRES}
            lignes={ordres}
            cle={(o) => o.id}
            vide="Aucun ordre en attente."
          />
        </section>

        {/* Positions ouvertes */}
        <section>
          <TitreSection>Positions ({positions.length})</TitreSection>
          <TableTriable
            colonnes={COLONNES_POSITIONS}
            lignes={positions}
            cle={(p) => p.id}
            vide="Aucune position ouverte."
          />
        </section>

        {/* Dernières exécutions */}
        <section>
          <TitreSection>Dernières exécutions</TitreSection>
          <TableTriable
            colonnes={COLONNES_EXECUTIONS}
            lignes={executionsRecentes}
            cle={({ idx }) => String(idx)}
            vide="Aucune exécution."
          />
        </section>

        <NoteSource>
          Simulation : frais {(FRAIS_TAKER * 100).toFixed(2)} %/côté, slippage nul, TP/SL remplis au
          niveau (SL prioritaire). Clôtures journalisées dans EXPY (tag « paper »).
        </NoteSource>
      </div>
    </>
  );
}
