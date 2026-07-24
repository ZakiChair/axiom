/**
 * Rapport périodique HTML AUTONOME (portefeuille + risque + journal EXPY + paper).
 *
 * `genererRapportHtml` produit un document HTML complet et ISOLÉ : styles inline sobres
 * (police système), AUCUNE ressource réseau (imprimable en PDF, lisible hors-ligne), et
 * échappement HTML systématique de toute chaîne utilisateur (symboles, notes, tags). Les
 * teintes gain/perte sont des CONSTANTES locales (vert/rouge), indépendantes des tokens de
 * l'app — le fichier doit rester correct ouvert seul, sans le thème.
 *
 * `collecterDonneesRapport` assemble les données depuis les stores existants. Chaque section
 * faillible est isolée (erreur → section `null`). Décisions du contrôleur consignées :
 *  - PRIX COURANTS : le rapport n'a pas de flux WS (celui-ci est un état interne de
 *    PortfolioWindow) ⇒ les positions sont valorisées au PRIX D'ENTRÉE, avec mention
 *    explicite dans le rapport. Choix le plus honnête simple (pas de couplage au live).
 *  - PnL RÉALISÉ période = clôtures du portfolioStore dont `dateSortie` ∈ [now−période, now].
 *  - JOURNAL = trades EXPY dont `fermeTs` ∈ [now−période, now] ; `stats` recalculées sur ce
 *    MÊME sous-ensemble (cohérence liste/agrégats).
 *  - PAPER : exécutions de clôture de la période (branché sur paperStore) ; section absente si aucune ;
 *    `ExecutionPaper` est un placeholder neutre local que T-futur remplacera par l'import réel.
 */
import { formatUsd, formatPrice, formatDec } from "../lib/format";
import {
  portfolioStore,
  pnlLatentPosition,
  pnlRealisePosition,
  calculerExposition,
  type Exposition,
} from "../store/portfolio";
import { expyStore } from "../store/expy";
import { statsExpy, rMultiple, type StatsExpy, type TradeJournal } from "./expy";
import {
  collecterRisquePortefeuille,
  serieRendementsPortefeuille,
  risquePortefeuille,
  klinesVersRendements,
  type RisquePortefeuille,
  type SerieActif,
} from "./portRisque";

// Type réel du moteur paper (branché au merge du lot v1.7 — les exécutions de la période
// alimentent la section Paper du rapport).
import type { ExecutionPaper } from "./paper";
import { paperStore } from "../store/paper";
export type { ExecutionPaper };

/** Une position ouverte telle qu'affichée dans le rapport (prix courant = prix d'entrée). */
export interface LignePositionRapport {
  symbole: string;
  direction: "long" | "short";
  taille: number;
  prixEntree: number;
  prixCourant: number;
  pnlLatent: number | null;
}

export interface DonneesRapport {
  genereTs: number;
  periodeJours: 7 | 30;
  portefeuille: {
    positions: LignePositionRapport[];
    expo: Exposition;
    pnlRealisePeriode: number;
  };
  risque: (RisquePortefeuille & { varUsd95: number; varUsd99: number }) | null;
  journal: { stats: StatsExpy; trades: TradeJournal[] } | null;
  paper: { executions: ExecutionPaper[]; pnlPeriode: number } | null;
}

// ── Constantes de présentation (locales, indépendantes des tokens app) ───────

/** Teinte gain (vert) — inline dans le HTML autonome. */
const VERT = "#16a34a";
/** Teinte perte (rouge) — inline dans le HTML autonome. */
const ROUGE = "#dc2626";

// ── Helpers de rendu PURS ────────────────────────────────────────────────────

/** Échappe les 5 caractères sensibles HTML. Appliqué à TOUTE chaîne utilisateur. PURE. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Couleur inline d'un montant signé (vide si nul/absent). PURE. */
function teinte(n: number): string {
  return n > 0 ? VERT : n < 0 ? ROUGE : "";
}

/** Montant $ signé et coloré (span inline) ou « — ». PURE. */
function montantColore(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const txt = `${n > 0 ? "+" : ""}${formatUsd(n)}`;
  const c = teinte(n);
  return c ? `<span style="color:${c}">${txt}</span>` : txt;
}

/** Date/heure locale lisible (fr-FR), sans dépendance réseau. PURE. */
function formatDateHeure(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR");
}

/** Ratio [0,1] en pourcentage « niveau » ou « — ». PURE. */
function pctNiveau(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)} %`;
}

// ── Sections HTML (chaînes) ──────────────────────────────────────────────────

function sectionPortefeuille(p: DonneesRapport["portefeuille"]): string {
  const lignes = p.positions
    .map(
      (pos) => `<tr>
        <td>${esc(pos.symbole)}</td>
        <td>${pos.direction === "long" ? "Long" : "Short"}</td>
        <td class="num">${formatDec(pos.taille, 4)}</td>
        <td class="num">${formatPrice(pos.prixEntree)}</td>
        <td class="num">${formatPrice(pos.prixCourant)}</td>
        <td class="num">${montantColore(pos.pnlLatent)}</td>
      </tr>`,
    )
    .join("");
  const corps =
    p.positions.length > 0
      ? `<table>
          <thead><tr>
            <th>Symbole</th><th>Sens</th><th class="num">Taille</th>
            <th class="num">Prix entrée</th><th class="num">Prix courant</th>
            <th class="num">PnL latent</th>
          </tr></thead>
          <tbody>${lignes}</tbody>
        </table>`
      : `<p class="vide">Aucune position ouverte.</p>`;
  return `<section>
    <h2>Portefeuille</h2>
    <div class="kpis">
      <div class="kpi"><span class="lbl">Expo brute</span><span class="val">${formatUsd(p.expo.brute)}</span></div>
      <div class="kpi"><span class="lbl">Expo nette</span><span class="val">${montantColore(p.expo.nette)}</span></div>
      <div class="kpi"><span class="lbl">Longue</span><span class="val">${formatUsd(p.expo.longue)}</span></div>
      <div class="kpi"><span class="lbl">Courte</span><span class="val">${formatUsd(p.expo.courte)}</span></div>
      <div class="kpi"><span class="lbl">PnL réalisé (période)</span><span class="val">${montantColore(p.pnlRealisePeriode)}</span></div>
    </div>
    ${corps}
    <p class="note">Positions valorisées au prix d'entrée : le rapport ne dispose pas du flux
    temps réel (état interne de la fenêtre Portefeuille). Le PnL latent est donc net de frais
    au prix d'entrée.</p>
  </section>`;
}

function sectionRisque(r: NonNullable<DonneesRapport["risque"]>): string {
  return `<section>
    <h2>Risque</h2>
    <div class="kpis">
      <div class="kpi"><span class="lbl">VaR 95 % · 1j</span><span class="val" style="color:${ROUGE}">−${formatUsd(r.varUsd95)}</span><span class="sub">${(r.var95Pct * 100).toFixed(2)} %</span></div>
      <div class="kpi"><span class="lbl">VaR 99 % · 1j</span><span class="val" style="color:${ROUGE}">−${formatUsd(r.varUsd99)}</span><span class="sub">${(r.var99Pct * 100).toFixed(2)} %</span></div>
      <div class="kpi"><span class="lbl">CVaR 95 %</span><span class="val">${(r.cvar95Pct * 100).toFixed(2)} %</span></div>
      <div class="kpi"><span class="lbl">Historique</span><span class="val">${r.nJours} j</span></div>
    </div>
    <p class="note">VaR historique 1 jour sur le notionnel brut (Σ|positions|), périmètre
    crypto-Binance. Perte exprimée positivement.</p>
  </section>`;
}

function sectionJournal(j: NonNullable<DonneesRapport["journal"]>): string {
  const s = j.stats;
  const lignes = j.trades
    .map((t) => {
      const r = rMultiple(t);
      const tags = t.tags.map((tag) => esc(tag)).join(", ");
      return `<tr>
        <td>${esc(t.symbol)}</td>
        <td>${t.direction === "long" ? "Long" : "Short"}</td>
        <td class="num">${formatPrice(t.entree)}</td>
        <td class="num">${t.sortie !== null ? formatPrice(t.sortie) : "—"}</td>
        <td class="num">${r !== null ? `<span style="color:${teinte(r)}">${r > 0 ? "+" : ""}${formatDec(r, 2)} R</span>` : "—"}</td>
        <td>${t.note ? esc(t.note) : ""}</td>
        <td>${tags}</td>
      </tr>`;
    })
    .join("");
  const table =
    j.trades.length > 0
      ? `<table>
          <thead><tr>
            <th>Symbole</th><th>Sens</th><th class="num">Entrée</th><th class="num">Sortie</th>
            <th class="num">R</th><th>Note</th><th>Tags</th>
          </tr></thead>
          <tbody>${lignes}</tbody>
        </table>`
      : `<p class="vide">Aucun trade clôturé sur la période.</p>`;
  const expTeinte = s.expectancy !== null ? teinte(s.expectancy) : "";
  return `<section>
    <h2>Journal (EXPY)</h2>
    <div class="kpis">
      <div class="kpi"><span class="lbl">Trades clôturés</span><span class="val">${s.n}</span></div>
      <div class="kpi"><span class="lbl">Expectancy</span><span class="val"${expTeinte ? ` style="color:${expTeinte}"` : ""}>${s.expectancy !== null ? `${s.expectancy > 0 ? "+" : ""}${formatDec(s.expectancy, 2)} R` : "—"}</span></div>
      <div class="kpi"><span class="lbl">Win rate</span><span class="val">${pctNiveau(s.winRate)}</span></div>
      <div class="kpi"><span class="lbl">Profit factor</span><span class="val">${formatDec(s.profitFactor, 2)}</span></div>
      <div class="kpi"><span class="lbl">Moy. gain</span><span class="val">${s.moyGain !== null ? `${formatDec(s.moyGain, 2)} R` : "—"}</span></div>
      <div class="kpi"><span class="lbl">Moy. perte</span><span class="val">${s.moyPerte !== null ? `${formatDec(s.moyPerte, 2)} R` : "—"}</span></div>
    </div>
    ${table}
  </section>`;
}

function sectionPaper(p: NonNullable<DonneesRapport["paper"]>): string {
  return `<section>
    <h2>Paper trading</h2>
    <div class="kpis">
      <div class="kpi"><span class="lbl">Exécutions (période)</span><span class="val">${p.executions.length}</span></div>
      <div class="kpi"><span class="lbl">PnL période</span><span class="val">${montantColore(p.pnlPeriode)}</span></div>
    </div>
  </section>`;
}

/** Feuille de style inline (sobre, imprimable, aucune ressource externe). */
const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a;
    background: #ffffff; margin: 0; padding: 24px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 10px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
  header { margin-bottom: 20px; }
  .meta { color: #64748b; margin: 0; }
  section { margin-bottom: 24px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; min-width: 120px;
    display: flex; flex-direction: column; }
  .kpi .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .kpi .val { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .kpi .sub { font-size: 10px; color: #64748b; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 8px; text-align: left; }
  th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: .03em;
    color: #475569; }
  td.num, th.num { text-align: right; }
  .vide { color: #64748b; font-style: italic; }
  .note { color: #64748b; font-size: 11px; margin: 8px 0 0; }
  @media print { body { padding: 0; } section { break-inside: avoid; } }
`;

/**
 * Génère le rapport HTML complet et autonome. Sections conditionnelles : Risque, Journal et
 * Paper n'apparaissent que si leurs données existent. Toute chaîne utilisateur est échappée.
 * Fonction PURE.
 */
export function genererRapportHtml(d: DonneesRapport): string {
  const sections = [sectionPortefeuille(d.portefeuille)];
  if (d.risque) sections.push(sectionRisque(d.risque));
  if (d.journal) sections.push(sectionJournal(d.journal));
  if (d.paper) sections.push(sectionPaper(d.paper));

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport de portefeuille — AXIOM</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>Rapport de portefeuille</h1>
  <p class="meta">Généré le ${esc(formatDateHeure(d.genereTs))} · Période : ${d.periodeJours} jours</p>
</header>
${sections.join("\n")}
</body>
</html>`;
}

// ── Collecte depuis les stores (IMPURE) ──────────────────────────────────────

/**
 * Assemble les données du rapport depuis les stores. Chaque section faillible (risque)
 * est isolée : une erreur la ramène à `null` sans faire échouer le rapport entier.
 * `nowMs` injecté (bornes de période testables). IMPURE (stores + réseau pour le risque).
 */
export async function collecterDonneesRapport(
  periodeJours: 7 | 30,
  nowMs: number,
): Promise<DonneesRapport> {
  const debut = nowMs - periodeJours * 86_400_000;
  const positions = portfolioStore.getState().positions;
  const ouvertes = positions.filter((p) => p.statut === "ouvert");

  // Prix courants = prix d'entrée (pas de flux temps réel dans le rapport, cf. en-tête).
  const prixEntree: Record<string, number> = {};
  for (const p of ouvertes) prixEntree[p.symbole] = p.prixEntree;

  const positionsRapport: LignePositionRapport[] = ouvertes.map((p) => ({
    symbole: p.symbole,
    direction: p.direction,
    taille: p.taille,
    prixEntree: p.prixEntree,
    prixCourant: p.prixEntree,
    pnlLatent: pnlLatentPosition(p, p.prixEntree)?.net ?? null,
  }));

  let pnlRealisePeriode = 0;
  for (const p of positions) {
    if (p.statut !== "clos") continue;
    if ((p.dateSortie ?? 0) < debut || (p.dateSortie ?? 0) > nowMs) continue;
    pnlRealisePeriode += pnlRealisePosition(p)?.net ?? 0;
  }

  const portefeuille = {
    positions: positionsRapport,
    expo: calculerExposition(positions, prixEntree),
    pnlRealisePeriode,
  };

  // Risque : collecte réseau réutilisée (klines Binance) → VaR via fonctions pures.
  let risque: DonneesRapport["risque"] = null;
  try {
    if (ouvertes.length > 0) {
      const c = await collecterRisquePortefeuille(ouvertes, prixEntree);
      if (c.poids.length > 0) {
        const series: SerieActif[] = c.poids.map((pd) => ({
          symbol: pd.symbol,
          rendements: klinesVersRendements(c.klines.get(pd.symbol)!),
        }));
        const rq = risquePortefeuille(serieRendementsPortefeuille(series, c.poids));
        if (rq) {
          risque = { ...rq, varUsd95: rq.var95Pct * c.sommeAbs, varUsd99: rq.var99Pct * c.sommeAbs };
        }
      }
    }
  } catch {
    risque = null;
  }

  // Journal : trades EXPY clôturés dans la fenêtre ; stats recalculées sur ce sous-ensemble.
  let journal: DonneesRapport["journal"] = null;
  try {
    const trades = expyStore
      .getState()
      .trades.filter((t) => t.fermeTs !== null && t.fermeTs >= debut && t.fermeTs <= nowMs)
      .sort((a, b) => (b.fermeTs ?? 0) - (a.fermeTs ?? 0));
    journal = { stats: statsExpy(trades), trades };
  } catch {
    journal = null;
  }

  // Paper : exécutions de CLÔTURE (pnl non null) de la période — section absente si aucune.
  let paper: DonneesRapport["paper"] = null;
  try {
    const execs = paperStore
      .getState()
      .executions.filter((e) => e.ts >= debut && e.ts <= nowMs && e.pnlUsd !== null);
    if (execs.length > 0) {
      paper = { executions: execs, pnlPeriode: execs.reduce((acc, e) => acc + (e.pnlUsd ?? 0), 0) };
    }
  } catch {
    paper = null;
  }

  return { genereTs: nowMs, periodeJours, portefeuille, risque, journal, paper };
}
