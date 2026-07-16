# Uniformisation de l'interface + features BRIEF/MARKS/SAVE — design

Date : 2026-07-09. Base : audit multi-agents (166 findings — 29 haute / 76 moyenne / 61 basse —,
67 helpers de formatage dupliqués dans 20 fichiers, carte d'architecture, 12 candidats features).

## 1. Problème

Le chrome (FloatingWindow, thèmes à tokens CSS) est solide, mais le **contenu** des fenêtres a
divergé au fil des lots :

- **49 couleurs en dur** (hex/palette brute) qui contournent les tokens de thème — surtout dans
  les canvas (Options, TermStructure) et le JSX de DerivativesWindow, alors que la bonne pratique
  (lecture des tokens via `getComputedStyle`) existe déjà dans Dom/Vol/MarketMap.
- **67 helpers de formatage** répartis dans 20 fichiers, ~8 familles de doublons quasi identiques
  (prix adaptatif ×6, compact K/M/B ×6, USD compact ×9, % signé ×8, âge relatif ×3…), aucun
  module partagé.
- États de chargement/erreur/vide, boutons, en-têtes de section, badges : chaque fenêtre bricole
  sa variante (ex. 3 badges locaux, trio Chargement/Indisponible/SansCle local à FundWindow).
- Wording FR/EN mélangé, divergences `%` collé vs ` %`, `B` vs `Md`, `-` vs `−`.

## 2. Standard consacré (de facto : groupe « marché », 7/7 fenêtres identiques)

- En-tête : `<header class="flex items-start justify-between gap-3 border-b border-border px-4 py-3">`
  avec `<h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-text">` + sous-titre
  `<p class="mt-0.5 text-[11px] text-text-dim">`.
- Corps : `flex-1 overflow-y-auto px-4 py-4` ; blocs-cartes `rounded-md border border-border bg-bg px-3 py-2`.
- Erreur : `rounded-md border border-down/40 px-3 py-2 text-[11px] text-down` (textuel, pas de retry).
- Chargement : textuel « Chargement… » (pas de spinner). Valeur absente : « — ».
- Bascule active : `bg-bg text-text` / inactif `text-text-dim hover:text-text`.
- Bouton secondaire : `rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text`.
- Nombres financiers : convention anglo (en-US, K/M/B/T majuscules, `+` explicite, 2 déc. par
  défaut, 4 pour le funding), `tabular-nums` alignés à droite. Dates/heures et libellés relatifs :
  fr-FR (`hour12:false`). Libellés UI en français, jargon marché EN toléré (funding, spread…).
- Canvas/SVG : couleurs lues depuis les tokens CSS (`--up/--down/--accent/--text-dim/--border`),
  jamais d'hex en dur. Couleurs de série non sémantiques : nouveaux tokens `--serie-1…6` par thème.
- Fraîcheur : ligne `{loading ? "maj…" : "maj ~1 min"}` + note de source
  `text-[10px] leading-snug text-text-dim` (« Données X, ~1 min. »).

Amendements (Lot A, 2026-07-16) :
- Les variantes d'opacité sur tokens (`border-down/40`, `bg-accent/15`…) sont légitimes et
  FONCTIONNELLES : chaque token couleur a un triplet jumeau `--x-rgb` consommé par
  tailwind.config.js en `rgb(var(--x-rgb) / <alpha-value>)`. Tout nouveau token couleur doit
  définir son `-rgb` dans les 5 thèmes (test themeTokens).
- Fraîcheur : primitive `<Fraicheur>` de ui.tsx — « maj… » (chargement), « maj il y a X »
  (timestamp connu), « maj ~cadence » (cadence seule), « — ». La forme « maj HH:MM » est abandonnée.
- Titres de fenêtres : « MNEMO · Libellé » via le prop `mnemo` d'EnTeteFenetre (mnémonique en accent).
- Rôle « avertissement » : classes `warn` (bg-warn, text-warn, border-warn/50) — alias thémé de --ui-amber.
- Couleurs de série côté chart : `serieCanvas(i)` / `lireTokenCanvas` au RENDU (callback styles),
  jamais d'hex figé à l'enregistrement (tests gardeFous).
- Groupes segmentés : primitive `Segmente` (actif bg-bg) ; onglets : primitive `Onglets`.

## 3. Fondations (nouveaux modules)

1. **`apps/web/src/lib/format.ts`** (+ tests) — promotion des versions les plus abouties
   (SymbolBanner, HealthPanel) : `formatPrice`, `formatCompact`, `formatUsd`, `formatPct`
   (signé optionnel, décimales param.), `formatRatioPct`, `formatHeure`, `formatDateCourte`,
   `formatDateHeure`, `formatAge`, `formatDelai`, `formatEntier`. Les formatters d'unités métier
   uniques (fmtGwei, fmtHashrate, formatOctets, formatQuota…) restent locaux.
2. **`apps/web/src/components/ui.tsx`** — primitives partagées (chacune dédoublonne ≥2 usages
   existants) : `EnTeteFenetre`, `Chargement`, `ErreurBloc`, `Vide`, `SansCle`, `Metric`,
   `Badge`, `Onglets`, `NoteSource`, constantes `BTN_SECONDAIRE`/`BTN_BASCULE`.
3. **`apps/web/src/lib/canvasTokens.ts`** — `lireTokens(...noms)` (getComputedStyle) consolidant
   readTokens/lireTokens de Dom/Vol/MarketMap ; adopté par Options/TermStructure/Derivatives.
4. **`index.css`** — tokens `--serie-1…6` définis pour les 5 thèmes (couleurs de série
   non sémantiques : violet, rose, bleu, ambre… réinterprétées par thème).

## 4. Migration (par fenêtre, parallèle)

Chaque fenêtre est refactorée isolément : remplacement des helpers locaux par `lib/format`, des
états ad hoc par les primitives, des couleurs en dur par tokens/`canvasTokens`, alignement des
boutons/selects/en-têtes/wording sur le standard §2. Aucun changement de logique métier.
Points de vigilance (carte d'architecture) : HealthPanel.test.ts fige des classes (à mettre à
jour), contrats perf (écritures DOM impératives, pas de state React haute fréquence), commentaires
français, deps figées, TS strict.

## 5. Features retenues (sur 12 candidats)

- **BRIEF [M]** — Snapshot marché matinal : fenêtre ⌘K « BRIEF » composant variations overnight
  de la watchlist, funding extrêmes, ΔOI, flux ETF de la veille, événements éco du jour, top
  NEWS, Fear & Greed, DVOL. 100 % sources déjà branchées, dégradation par section
  (Promise.allSettled), export markdown vers NOTES. Nouveaux : `data/brief.ts` (pur, testé),
  `components/BriefWindow.tsx` ; câblage registre/App/commandes.
- **MARKS [S]** — Trades & notes sur le chart : entrées/sorties du portefeuille (flèches + PnL)
  et notes ancrées dessinées sur le graphe, pattern `chart/ecoMarkers.ts`. Toggle palette,
  filtrage par symbole affiché. Nouveau : `chart/tradeMarkers.ts` (+ tests fonctions pures).
- **SAVE [S]** — Sauvegarde versionnée : snapshot nocturne de tous les namespaces KV du daemon
  dans SQLite (rétention 30 j), restauration point-dans-le-temps dans Réglages (confirmation +
  snapshot pré-restauration). Nouveaux : table + job dans `apps/daemon/src/kv.ts`, routes,
  section Réglages.

Écartés pour ce lot (documentés comme suites) : ALRT v2, REGIME, HIST (dépendent d'un historique
long ou d'un chantier daemon continu), JRNL (migration de schéma à sécuriser par SAVE d'abord),
EVNT, GEXL, WATCH, NTAG.

## 6. Vérification

`pnpm -r test` + `pnpm -r typecheck` + `pnpm --filter @axiom/web build` (gate BUILD-CONTRACT)
verts ; revue adversariale des diffs ; contrôle visuel (screenshots) sur les thèmes dark/matrix/
cute ; mise à jour de windowManager.test.ts (19→20 fenêtres) et des commentaires-compteurs.

## 7. Hors périmètre / notes

- Les modifications non commitées préexistantes (clés perso SoSoValue/Etherscan, expurgation du
  cache daemon) sont conservées telles quelles ; ce lot travaille par-dessus.
- Clé FRED en dur : décision assumée 2026-07-08, inchangée.
