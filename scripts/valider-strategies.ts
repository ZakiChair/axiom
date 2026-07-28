#!/usr/bin/env bun
/**
 * AXIOM — campagne de validation des stratégies (spec v2.3 §3).
 *
 * Script d'ORCHESTRATION (I/O : réseau + disque). Toute la logique mesurable
 * vit ailleurs et est testée : `statsTrades`/`partagerMoities`
 * (@axiom/backtest), `CANDIDATS_CHAMPION` (@axiom/indicators),
 * `construireTradesStrategie`/`etatsStrategie` (fabrique), `runBacktest`
 * (moteur). Ici : télécharger, boucler, mettre en forme.
 *
 * Trois mesures sont rendues côte à côte pour CHAQUE cellule symbole × TF :
 *  1. REJEU chart-fidèle de chaque def `strategy` du registre — trades
 *     close-à-close, HORS frais : c'est exactement ce que les marqueurs du
 *     chart montrent. Rendu en global ET sur les deux moitiés temporelles
 *     (anti-overfit).
 *  2. CONTRE-ÉPREUVE `runBacktest` pour les six stratégies exprimables dans le
 *     modèle déclaratif — fill à l'open de la barre suivante, frais 0,05 %,
 *     slippage 0,02 %. L'écart avec (1) est la mesure du coût d'exécution.
 *  3. CANDIDATS champion : mêmes stats de rejeu, plus l'évaluation des critères
 *     PRÉ-DÉCLARÉS du spec (expectancy > 0 dans chaque cellule ET chaque
 *     moitié ; départage par expectancy médiane).
 *
 * Honnêteté (règle du lot) : tout ce que produit ce script est une mesure
 * PASSÉE, in-sample pour la sélection du champion. Jamais une promesse.
 *
 * Usage (depuis la racine du dépôt) :
 *   bun scripts/valider-strategies.ts                        # 4 cellules → stdout
 *   bun scripts/valider-strategies.ts --rapport doc.md       # 4 cellules → fichier
 *   bun scripts/valider-strategies.ts --cellules BTCUSDT:1h  # une seule cellule
 *
 * Le cache disque `scripts/.cache-klines/<symbol>-<tf>.json` (gitignoré) évite
 * de marteler l'API entre deux itérations : le supprimer force le re-fetch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candle } from "../packages/types/src/index";
import {
  construireTradesStrategie,
  etatsStrategie,
  INDICATORS,
  specStrategie,
} from "../packages/indicators/src/index";
import {
  CANDIDATS_CHAMPION,
  type CandidatChampion,
} from "../packages/indicators/src/strategy/candidatsChampion";
import { runBacktest } from "../packages/backtest/src/engine";
import { partagerMoities, statsTrades, type StatsRejeu } from "../packages/backtest/src/statsRejeu";
import type { Condition, Operande, ParamsBacktest, StrategieDef } from "../packages/backtest/src/types";

// ─────────────────────────── Protocole FIGÉ ───────────────────────────

/** Début de la fenêtre d'étude (2024-07-01 UTC) — ~2 ans jusqu'à aujourd'hui. */
const DEBUT_MS = Date.UTC(2024, 6, 1);

/** Les quatre cellules du spec. Un seul jeu de params partout, aucun réglage par cellule. */
const CELLULES: ReadonlyArray<{ symbol: string; tf: "1h" | "4h" }> = [
  { symbol: "BTCUSDT", tf: "1h" },
  { symbol: "BTCUSDT", tf: "4h" },
  { symbol: "ETHUSDT", tf: "1h" },
  { symbol: "ETHUSDT", tf: "4h" },
];

/** Exécution de la contre-épreuve (spec §3). */
const PARAMS_BT: ParamsBacktest = { fraisPct: 0.05, slippagePct: 0.02, capitalInitial: 10000 };
const TAILLE_FIXE = 1000;

/** Chemins ancrés sur le FICHIER, pas sur le cwd : le script marche depuis partout. */
const DOSSIER_SCRIPT = dirname(fileURLToPath(import.meta.url));
const RACINE = join(DOSSIER_SCRIPT, "..");
const DOSSIER_CACHE = join(DOSSIER_SCRIPT, ".cache-klines");
const LIMITE_PAGE = 1000;

// ─────────────────────────── Chargement des klines ───────────────────────────

/** Une ligne kline Binance : [openTime, open, high, low, close, volume, closeTime, …]. */
type LigneKline = [number, string, string, string, string, string, number, ...unknown[]];

/**
 * Klines Binance spot paginées (1000 par appel) depuis `DEBUT_MS` jusqu'à
 * maintenant, converties en `Candle` (time = openTime ms).
 *
 * La bougie EN COURS est écartée (`closeTime >= maintenant`) : tout l'aval
 * suppose des bougies CLÔTURÉES — la fabrique comme le moteur — et une bougie
 * en formation fausserait silencieusement la campagne.
 */
async function telechargerKlines(symbol: string, tf: string): Promise<Candle[]> {
  const maintenant = Date.now();
  const out: Candle[] = [];
  let depuis = DEBUT_MS;

  for (;;) {
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}` +
      `&startTime=${depuis}&limit=${LIMITE_PAGE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance ${res.status} ${res.statusText} sur ${symbol} ${tf}`);
    const lignes = (await res.json()) as LigneKline[];
    if (lignes.length === 0) break;

    for (const l of lignes) {
      if (Number(l[6]) >= maintenant) continue; // bougie en cours : jamais rejouée
      out.push({
        time: Number(l[0]),
        open: Number(l[1]),
        high: Number(l[2]),
        low: Number(l[3]),
        close: Number(l[4]),
        volume: Number(l[5]),
      });
    }

    const derniere = lignes[lignes.length - 1];
    const dernierOpen = derniere === undefined ? depuis : Number(derniere[0]);
    // Garde anti-boucle infinie : sans progression stricte du curseur, on sort.
    if (dernierOpen < depuis || lignes.length < LIMITE_PAGE) break;
    depuis = dernierOpen + 1;
    process.stderr.write(`\r  … ${symbol} ${tf} : ${out.length} bougies`);
  }
  process.stderr.write(`\r  ✓ ${symbol} ${tf} : ${out.length} bougies\n`);
  return out;
}

/** Klines depuis le cache disque, téléchargées et mises en cache si absentes. */
async function chargerKlines(symbol: string, tf: string): Promise<Candle[]> {
  const fichier = join(DOSSIER_CACHE, `${symbol}-${tf}.json`);
  if (existsSync(fichier)) {
    const candles = JSON.parse(readFileSync(fichier, "utf8")) as Candle[];
    process.stderr.write(`  ✓ ${symbol} ${tf} : ${candles.length} bougies (cache)\n`);
    return candles;
  }
  const candles = await telechargerKlines(symbol, tf);
  mkdirSync(dirname(fichier), { recursive: true });
  writeFileSync(fichier, JSON.stringify(candles));
  return candles;
}

// ─────────────────────────── Stratégies exprimables (contre-épreuve) ───────────────────────────

const ema = (length: number): Operande => ({
  type: "indicateur",
  indicateurId: "ema",
  params: { length },
  output: "ema",
});
const ind = (id: string, params: Record<string, number>, output: string): Operande => ({
  type: "indicateur",
  indicateurId: id,
  params,
  output,
});
const close: Operande = { type: "prix", champ: "close" };
const cst = (valeur: number): Operande => ({ type: "constante", valeur });
const croise = (a: Operande, b: Operande, sens: "hausse" | "baisse"): Condition => ({
  type: "croisement",
  a,
  b,
  sens,
});
const cmp = (gauche: Operande, comparateur: ">" | ">=" | "<" | "<=", droite: Operande): Condition => ({
  type: "comparaison",
  gauche,
  comparateur,
  droite,
});

/**
 * Équivalents déclaratifs des six stratégies EXPRIMABLES (spec §3), avec les
 * MÊMES défauts que les defs. `fidelite` documente ce que le modèle déclaratif
 * ne sait PAS reproduire : les règles sont des listes conjonctives (ET), donc
 * toute sortie « A OU B » est hors de portée. Ces écarts sont reportés tels
 * quels dans le rapport — l'approximation est une mesure, pas un détail caché.
 */
const EXPRIMABLES: ReadonlyArray<{ id: string; def: StrategieDef; fidelite: string }> = [
  {
    id: "stratCroisementMM",
    fidelite: "fidèle (EMA 9/21, retournement symétrique)",
    def: {
      reglesEntree: [croise(ema(9), ema(21), "hausse")],
      reglesSortie: [croise(ema(9), ema(21), "baisse")],
      direction: "les-deux",
      tailleFixe: TAILLE_FIXE,
    },
  },
  {
    id: "stratRsiReversion",
    fidelite: "quasi fidèle : le croisement du moteur est `≤ puis >` là où le def teste `< puis ≥`",
    def: {
      reglesEntree: [croise(ind("rsi", { length: 14 }, "rsi"), cst(30), "hausse")],
      reglesSortie: [cmp(ind("rsi", { length: 14 }, "rsi"), ">=", cst(70))],
      direction: "long",
      tailleFixe: TAILLE_FIXE,
    },
  },
  {
    id: "stratMacdCross",
    fidelite: "fidèle (MACD 12/26/9, retournement symétrique)",
    def: {
      reglesEntree: [croise(ind("macd", { fast: 12, slow: 26, signal: 9 }, "macd"), ind("macd", { fast: 12, slow: 26, signal: 9 }, "signal"), "hausse")],
      reglesSortie: [croise(ind("macd", { fast: 12, slow: 26, signal: 9 }, "macd"), ind("macd", { fast: 12, slow: 26, signal: 9 }, "signal"), "baisse")],
      direction: "les-deux",
      tailleFixe: TAILLE_FIXE,
    },
  },
  {
    id: "stratSupertrend",
    fidelite: "fidèle (direction Supertrend 10 ×3, retournement symétrique)",
    def: {
      reglesEntree: [cmp(ind("supertrend", { period: 10, multiplier: 3 }, "direction"), ">", cst(0))],
      reglesSortie: [cmp(ind("supertrend", { period: 10, multiplier: 3 }, "direction"), "<", cst(0))],
      direction: "les-deux",
      tailleFixe: TAILLE_FIXE,
    },
  },
  {
    id: "stratBollingerReversion",
    fidelite: "APPROXIMATION : jambe LONG seule — la jambe short et la sortie « retour à la moyenne » ne cohabitent pas dans un système à retournement",
    def: {
      reglesEntree: [croise(close, ind("bollinger", { length: 20, mult: 2 }, "lower"), "hausse")],
      reglesSortie: [cmp(close, ">=", ind("bollinger", { length: 20, mult: 2 }, "basis"))],
      direction: "long",
      tailleFixe: TAILLE_FIXE,
    },
  },
  {
    id: "stratMmAdx",
    fidelite: "APPROXIMATION : le flat FORCÉ quand ADX < 25 est inexprimable (règles conjonctives) — ici l'ADX ne filtre que les ENTRÉES",
    def: {
      reglesEntree: [croise(ema(9), ema(21), "hausse"), cmp(ind("adx", { length: 14 }, "adx"), ">=", cst(25))],
      reglesSortie: [croise(ema(9), ema(21), "baisse"), cmp(ind("adx", { length: 14 }, "adx"), ">=", cst(25))],
      direction: "les-deux",
      tailleFixe: TAILLE_FIXE,
    },
  },
];

// ─────────────────────────── Mesures ───────────────────────────

/** Stats de rejeu d'une série d'états : global + les deux moitiés temporelles. */
interface MesureRejeu {
  global: StatsRejeu;
  m1: StatsRejeu;
  m2: StatsRejeu;
}

function mesurer(candles: Candle[], etats: Array<1 | 0 | -1 | undefined>): MesureRejeu {
  const { trades } = construireTradesStrategie(candles, etats);
  const { m1, m2 } = partagerMoities(trades, candles.length);
  return { global: statsTrades(trades), m1: statsTrades(m1), m2: statsTrades(m2) };
}

/** Résultat complet d'une cellule symbole × timeframe. */
interface ResultatCellule {
  symbol: string;
  tf: string;
  nbBougies: number;
  debut: number;
  fin: number;
  rejeu: Array<{ id: string; nom: string; m: MesureRejeu }>;
  contreEpreuve: Array<{
    id: string;
    fidelite: string;
    nbTrades: number;
    winRatePct: number;
    pnlTotalPct: number;
    maxDrawdownPct: number;
    profitFactor: number;
    expectancyPct: number;
  }>;
  candidats: Array<{ id: string; m: MesureRejeu }>;
}

function evaluerCellule(symbol: string, tf: string, candles: Candle[]): ResultatCellule {
  const strategies = INDICATORS.filter((d) => d.category === "strategy" && specStrategie(d.id) !== undefined);

  const rejeu: ResultatCellule["rejeu"] = [];
  for (const def of strategies) {
    const etats = etatsStrategie(def.id, candles);
    if (etats === undefined) continue;
    rejeu.push({ id: def.id, nom: def.name, m: mesurer(candles, etats) });
  }

  const contreEpreuve: ResultatCellule["contreEpreuve"] = EXPRIMABLES.map((e) => {
    const r = runBacktest(candles, e.def, PARAMS_BT);
    const expectancyPct =
      r.trades.length === 0
        ? 0
        : r.trades.reduce((acc, t) => acc + t.pnlPct, 0) / r.trades.length;
    return {
      id: e.id,
      fidelite: e.fidelite,
      nbTrades: r.stats.nbTrades,
      winRatePct: r.stats.winRatePct,
      pnlTotalPct: r.stats.pnlTotalPct,
      maxDrawdownPct: r.stats.maxDrawdownPct,
      profitFactor: r.stats.profitFactor,
      expectancyPct,
    };
  });

  const candidats = CANDIDATS_CHAMPION.map((c: CandidatChampion) => ({
    id: c.id,
    m: mesurer(candles, c.position(candles)),
  }));

  return {
    symbol,
    tf,
    nbBougies: candles.length,
    debut: candles[0]?.time ?? 0,
    fin: candles[candles.length - 1]?.time ?? 0,
    rejeu,
    contreEpreuve,
    candidats,
  };
}

// ─────────────────────────── Verdict champion ───────────────────────────

/**
 * Critères PRÉ-DÉCLARÉS du spec §3, appliqués tels quels : expectancy > 0 dans
 * CHAQUE cellule ET dans CHAQUE moitié temporelle ; départage par expectancy
 * médiane (sur toutes les cellules). Aucun ajustement a posteriori.
 */
interface VerdictCandidat {
  id: string;
  nom: string;
  regle: string;
  passe: boolean;
  echecs: string[];
  expectancyMediane: number;
  nbTradesTotal: number;
}

function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const tri = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 === 1 ? tri[milieu]! : (tri[milieu - 1]! + tri[milieu]!) / 2;
}

/**
 * Motif d'échec d'un bloc de mesure, ou `undefined` s'il tient le critère.
 * « aucun trade » et « expectancy ≤ 0 » sont DISTINGUÉS : une moitié vide n'a
 * rien mesuré du tout, l'annoncer comme « expectancy 0.000 » laisserait croire
 * le contraire (règle d'honnêteté du lot — le rapport est l'audit de la campagne).
 */
function echecBloc(cle: string, s: StatsRejeu): string | undefined {
  if (s.nbTrades === 0) return `${cle} : aucun trade`;
  if (s.expectancy <= 0) return `${cle} : expectancy ${fmt(s.expectancy, 3)} ≤ 0`;
  return undefined;
}

function verdicts(cellules: ResultatCellule[]): VerdictCandidat[] {
  return CANDIDATS_CHAMPION.map((cand) => {
    const echecs: string[] = [];
    const expectancies: number[] = [];
    let nbTradesTotal = 0;
    for (const cel of cellules) {
      const r = cel.candidats.find((c) => c.id === cand.id);
      if (r === undefined) continue;
      const cle = `${cel.symbol} ${cel.tf}`;
      expectancies.push(r.m.global.expectancy);
      nbTradesTotal += r.m.global.nbTrades;
      for (const e of [
        echecBloc(cle, r.m.global),
        echecBloc(`${cle} M1`, r.m.m1),
        echecBloc(`${cle} M2`, r.m.m2),
      ]) {
        if (e !== undefined) echecs.push(e);
      }
    }
    return {
      id: cand.id,
      nom: cand.nom,
      regle: cand.regle,
      passe: echecs.length === 0,
      echecs,
      expectancyMediane: mediane(expectancies),
      nbTradesTotal,
    };
  });
}

// ─────────────────────────── Rapport markdown ───────────────────────────

function fmt(v: number, dec = 2): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "—";
  return v.toFixed(dec);
}

function jour(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ligne(cells: Array<string | number>): string {
  return `| ${cells.join(" | ")} |`;
}

function tableau(entetes: string[], lignes: Array<Array<string | number>>): string {
  return [
    ligne(entetes),
    `|${entetes.map(() => "---").join("|")}|`,
    ...lignes.map(ligne),
  ].join("\n");
}

function construireRapport(cellules: ResultatCellule[], partiel: boolean): string {
  const v = verdicts(cellules);
  const parts: string[] = [];

  parts.push("# Campagne de validation des stratégies — AXIOM v2.3");
  parts.push(
    `Généré par \`scripts/valider-strategies.ts\` le ${jour(Date.now())}. ` +
      "**Toutes les valeurs ci-dessous sont des mesures PASSÉES, in-sample pour la " +
      "sélection du champion — jamais une promesse de performance.**"
  );
  if (partiel) {
    parts.push(
      `> ⚠️ **Rapport PARTIEL** : ${cellules.length} cellule(s) sur ${CELLULES.length}. ` +
        "Les critères champion exigent les quatre cellules — le verdict ci-dessous ne " +
        "vaut que comme preuve de tuyauterie, pas comme sélection."
    );
  }

  parts.push("## Méthodologie");
  parts.push(
    [
      "- **Données** : klines Binance spot (`/api/v3/klines`), bougie en cours exclue, " +
        `depuis le ${jour(DEBUT_MS)}.`,
      "- **Rejeu chart-fidèle** : la fonction `position` de chaque def `strategy` est " +
        "rejouée, les trades reconstruits close-à-close par `construireTradesStrategie` " +
        "(mêmes conventions que les marqueurs du chart : anti-repaint, HORS frais).",
      "- **Moitiés temporelles** : coupe au milieu du tableau de bougies, trade rangé " +
        "selon son index d'ENTRÉE (anti-overfit — une stratégie qui ne gagne que sur une " +
        "moitié est disqualifiée).",
      `- **Contre-épreuve** : \`runBacktest\` (fill à l'OPEN de la barre suivante, frais ` +
        `${PARAMS_BT.fraisPct} % par côté, slippage ${PARAMS_BT.slippagePct} %, capital ` +
        `${PARAMS_BT.capitalInitial}, taille fixe ${TAILLE_FIXE}) sur les stratégies ` +
        "exprimables dans le modèle déclaratif. L'écart avec le rejeu EST la mesure du " +
        "coût d'exécution.",
      "- **Signes** : `DD max` du rejeu est NÉGATIF (retracement de l'equity composée) ; " +
        "celui de la contre-épreuve est POSITIF (convention `StatsBacktest`).",
      "- **Comparabilité des expectancies** : celle du rejeu est une variation de PRIX en % ; " +
        "celle de la contre-épreuve est le PnL net rapporté au notionnel engagé. À taille " +
        "fixe et sans levier (quantité = taille / prix d'entrée), les deux dénominateurs " +
        "coïncident : leur écart isole donc bien frais + slippage + décalage de fill.",
      "- **Aucun réglage par cellule** : un seul jeu de défauts partout, pas de grid-search.",
    ].join("\n")
  );

  parts.push("## Données");
  parts.push(
    tableau(
      ["Cellule", "Bougies", "Début", "Fin"],
      cellules.map((c) => [`${c.symbol} ${c.tf}`, c.nbBougies, jour(c.debut), jour(c.fin)])
    )
  );

  parts.push("## 1. Rejeu chart-fidèle des stratégies du registre (hors frais)");
  for (const c of cellules) {
    parts.push(`### ${c.symbol} ${c.tf}`);
    parts.push(
      tableau(
        ["Stratégie", "Trades", "Win %", "Expectancy %", "PnL composé %", "DD max %", "Durée moy.", "Exp. M1 %", "Exp. M2 %"],
        c.rejeu.map((r) => [
          r.id,
          r.m.global.nbTrades,
          fmt(r.m.global.winRate),
          fmt(r.m.global.expectancy, 3),
          fmt(r.m.global.pnlComposePct),
          fmt(r.m.global.maxDrawdownPct),
          fmt(r.m.global.dureeMoyenne, 1),
          fmt(r.m.m1.expectancy, 3),
          fmt(r.m.m2.expectancy, 3),
        ])
      )
    );
  }

  parts.push("## 2. Contre-épreuve moteur de backtest (frais + slippage + fill à l'open)");
  for (const c of cellules) {
    parts.push(`### ${c.symbol} ${c.tf}`);
    const rejeuParId = new Map(c.rejeu.map((r) => [r.id, r.m.global.expectancy]));
    parts.push(
      tableau(
        ["Stratégie", "Trades", "Win %", "PnL total %", "DD max %", "Profit factor", "Expectancy BT %", "Expectancy rejeu %", "Écart"],
        c.contreEpreuve.map((e) => {
          const rej = rejeuParId.get(e.id);
          return [
            e.id,
            e.nbTrades,
            fmt(e.winRatePct),
            fmt(e.pnlTotalPct),
            fmt(e.maxDrawdownPct),
            fmt(e.profitFactor),
            fmt(e.expectancyPct, 3),
            rej === undefined ? "—" : fmt(rej, 3),
            rej === undefined ? "—" : fmt(e.expectancyPct - rej, 3),
          ];
        })
      )
    );
  }
  parts.push("**Fidélité des équivalents déclaratifs** (ce que le modèle ne reproduit pas) :");
  parts.push(EXPRIMABLES.map((e) => `- \`${e.id}\` — ${e.fidelite}`).join("\n"));

  parts.push("## 3. Candidats champion");
  parts.push(
    tableau(
      ["Candidat", "Règle (params figés)"],
      CANDIDATS_CHAMPION.map((c) => [`\`${c.id}\``, c.regle])
    )
  );
  for (const c of cellules) {
    parts.push(`### ${c.symbol} ${c.tf}`);
    parts.push(
      tableau(
        ["Candidat", "Trades", "Win %", "Expectancy %", "PnL composé %", "DD max %", "Exp. M1 %", "Exp. M2 %"],
        c.candidats.map((r) => [
          r.id,
          r.m.global.nbTrades,
          fmt(r.m.global.winRate),
          fmt(r.m.global.expectancy, 3),
          fmt(r.m.global.pnlComposePct),
          fmt(r.m.global.maxDrawdownPct),
          fmt(r.m.m1.expectancy, 3),
          fmt(r.m.m2.expectancy, 3),
        ])
      )
    );
  }

  parts.push("### Critères pré-déclarés et verdict");
  parts.push(
    "Critères FIXÉS avant de voir le moindre chiffre : **expectancy > 0 dans chaque " +
      "cellule ET dans chaque moitié temporelle** ; départage par **expectancy médiane**."
  );
  parts.push(
    tableau(
      ["Candidat", "Critères", "Expectancy médiane %", "Trades (total)", "Échecs"],
      [...v]
        .sort((a, b) => b.expectancyMediane - a.expectancyMediane)
        .map((x) => [
          `\`${x.id}\``,
          x.passe ? "✅ tous" : "❌",
          fmt(x.expectancyMediane, 3),
          x.nbTradesTotal,
          x.echecs.length === 0 ? "—" : x.echecs.join(" ; "),
        ])
    )
  );

  const retenus = v.filter((x) => x.passe).sort((a, b) => b.expectancyMediane - a.expectancyMediane);
  const relatif = [...v].sort((a, b) => b.expectancyMediane - a.expectancyMediane)[0];
  if (retenus.length > 0) {
    const gagnant = retenus[0]!;
    parts.push(
      `**Champion : \`${gagnant.id}\`** (${gagnant.nom}) — ${gagnant.regle}. ` +
        `Expectancy médiane ${fmt(gagnant.expectancyMediane, 3)} %, ` +
        `${gagnant.nbTradesTotal} trades. Tous les critères pré-déclarés sont tenus.`
    );
  } else if (relatif !== undefined) {
    parts.push(
      `**Aucun candidat ne tient les critères pré-déclarés.** Le mieux placé est ` +
        `\`${relatif.id}\` (${relatif.nom}, expectancy médiane ${fmt(relatif.expectancyMediane, 3)} %) — ` +
        "il ne peut être livré que sous l'étiquette **« champion relatif, non robuste »**, " +
        "jamais comme une stratégie validée."
    );
  }

  parts.push("## Limites");
  parts.push(
    [
      "- Le rejeu chart-fidèle est HORS frais et hors slippage : il mesure un SIGNAL, pas " +
        "une exécution. La section 2 chiffre l'écart pour les stratégies exprimables ; " +
        "pour les autres (Donchian, divergence, squeeze, Ichimoku, PSAR, candidats), cet " +
        "écart n'est PAS mesuré et le coût réel est donc sous-estimé.",
      "- Sélection IN-SAMPLE : les deux moitiés temporelles sont un garde-fou, pas un " +
        "walk-forward. Aucune période n'est réservée hors échantillon.",
      "- Deux symboles, deux timeframes, une seule fenêtre calendaire : la robustesse " +
        "hors de ce périmètre n'est pas établie.",
      "- Aucun réglage de paramètres n'a été tenté : ce sont les défauts qui sont mesurés, " +
        "ce qui évite le sur-ajustement mais sous-estime probablement chaque stratégie.",
      "- Pas de dimensionnement de position ni de gestion du risque : taille fixe partout.",
    ].join("\n")
  );

  return `${parts.join("\n\n")}\n`;
}

// ─────────────────────────── Entrée ───────────────────────────

function lireArgs(argv: string[]): { rapport?: string; cellules: typeof CELLULES } {
  let rapport: string | undefined;
  let filtre: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rapport") rapport = argv[++i];
    else if (argv[i] === "--cellules") filtre = argv[++i];
  }
  if (filtre === undefined) return rapport === undefined ? { cellules: CELLULES } : { rapport, cellules: CELLULES };
  const voulues = new Set(filtre.split(","));
  const cellules = CELLULES.filter((c) => voulues.has(`${c.symbol}:${c.tf}`));
  if (cellules.length === 0) {
    throw new Error(`--cellules « ${filtre} » ne correspond à aucune cellule connue`);
  }
  return rapport === undefined ? { cellules } : { rapport, cellules };
}

async function main(): Promise<void> {
  const { rapport, cellules } = lireArgs(process.argv.slice(2));

  // Le registre peuple la map des specs par EFFET DE BORD à l'import. Si l'import
  // avait échoué, tout le rejeu renverrait 0 trade en silence : on échoue fort.
  if (specStrategie("stratSupertrend") === undefined) {
    throw new Error("registre des stratégies non peuplé — import de @axiom/indicators cassé");
  }

  const resultats: ResultatCellule[] = [];
  for (const { symbol, tf } of cellules) {
    const candles = await chargerKlines(symbol, tf);
    if (candles.length === 0) throw new Error(`aucune bougie pour ${symbol} ${tf}`);
    resultats.push(evaluerCellule(symbol, tf, candles));
  }

  const md = construireRapport(resultats, cellules.length < CELLULES.length);
  if (rapport === undefined) {
    process.stdout.write(md);
  } else {
    const chemin = rapport.startsWith("/") ? rapport : join(RACINE, rapport);
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, md);
    process.stderr.write(`  ✓ rapport écrit : ${chemin}\n`);
  }
}

await main();
