# Reporting fond — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapport périodique HTML autonome téléchargeable (portefeuille, risque, journal EXPY, paper) — spec `2026-07-24-lot-v17-trader-fond-design.md` §4. **PRÉREQUIS : branche `feat/port-risque` mergée** (le rapport consomme ses calculs).

**Architecture:** T1 = générateur pur (assemblage HTML testé) + collecte des stores + bouton UI. Une seule tâche.

**Tech Stack:** TypeScript, vitest.

## Global Constraints

- Commentaires **français**. `git -C` systématique. HTML AUTONOME : styles inline sobres (police système, tableaux propres, teintes vert/rouge inline), AUCUN asset externe, imprimable en PDF navigateur. Zéro fetch nouveau (lecture des stores + caches existants ; les prix courants = ceux que PORT affiche).
- Sections CONDITIONNELLES : Risque (si calculable), Paper (si clôtures dans la période) — sinon mention « non calculé » / section absente. Pied honnête (sources, approximations reprises de la section Risque).
- Nombres : conventions de format du repo (réutiliser lib/format quand c'est du TS ; dans le HTML généré, formatter en dur cohérent).
- Branche : `feat/reporting`. TDD sur l'assemblage. Gate : `pnpm test` racine + tsc verts + gate visuel (contrôleur ouvre le fichier généré).

**Modèles à lire AVANT d'implémenter :**
- `apps/web/src/store/portfolio.ts` (Position, pnl*, calculerExposition, statsClotures) + la section Risque de `PortfolioWindow.tsx` (post-merge port-risque : comment elle collecte prix/klines — RÉUTILISER sa collecte, pas la dupliquer : si elle est enfermée dans le composant, l'extraire chirurgicalement, consigné)
- `apps/web/src/data/expy.ts` (statsExpy, filtrage par période via fermeTs) + `store/expy.ts` ; `store/paper.ts` (executions)
- `apps/web/src/data/rapport… n'existe pas`

---

### Task 1: Générateur + bouton

**Files:**
- Create: `apps/web/src/data/rapport.ts` — Test: `apps/web/src/data/rapport.test.ts`
- Modify: `apps/web/src/components/PortfolioWindow.tsx` (bouton « 📄 Rapport » + Segmente 7 j/30 j), `apps/web/src/store/portfolio.ts` SEULEMENT si une commande palette y est ajoutée (patron commandes existant — optionnel, décision consignée)

**Interfaces (Produces):**
```ts
export interface DonneesRapport {
  genereTs: number; periodeJours: 7 | 30;
  portefeuille: { positions: /* ouvertes avec prix courant + pnl latent */[]; expo: Exposition; pnlRealisePeriode: number; };
  risque: RisquePortefeuille & { varUsd95: number; varUsd99: number } | null;
  journal: { stats: StatsExpy; trades: TradeJournal[] } | null;   // trades CLOS de la période (fermeTs ∈ [now−periode, now])
  paper: { executions: ExecutionPaper[]; pnlPeriode: number } | null;
}
export function genererRapportHtml(d: DonneesRapport): string; // HTML complet autonome, français, sections conditionnelles
export function collecterDonneesRapport(periodeJours: 7 | 30, nowMs: number): Promise<DonneesRapport>; // lit les stores (+ collecte risque réutilisée) — les erreurs par section → section null
```

- [ ] **Step 1: Tests rouges** — genererRapportHtml : contient les titres de sections attendus quand les données existent ; sections null → absentes/mention ; valeurs formatées présentes (fixture avec PnL négatif → teinte rouge inline) ; AUCUNE URL externe dans la sortie (asserté : pas de `http` hors ancres de texte) ; échappement HTML des notes/tags utilisateur (fixture avec `<script>` → échappé, asserté).
- [ ] **Step 2:** Implémentation générateur + collecte (période sur fermeTs pour EXPY, executions.ts pour paper ; risque réutilise la collecte de la section Risque).
- [ ] **Step 3:** Bouton dans PortfolioWindow : Segmente 7 j/30 j + « 📄 Rapport » → `collecterDonneesRapport` → Blob download `axiom-rapport-YYYY-MM-DD.html` (patron export EXPY). Commande palette « rapport » si triviale à greffer.
- [ ] **Step 4:** `pnpm test` racine + tsc verts. **Step 5: Commit** — `feat(rapport): rapport périodique HTML autonome (portefeuille, risque, journal, paper)`

Gate visuel (contrôleur) : générer un rapport 30 j avec données réelles (positions + trades EXPY du gate v1.6/v1.7), ouvrir le fichier → lisible, sections cohérentes avec les fenêtres, teintes correctes, impression PDF propre, aucun asset réseau chargé (fichier isolé).
