# Revue globale AXIOM — 2026-08-20

> Audit multi-agents (architecture web, daemon + data, packages purs, produit/UX),
> croisé avec les revues du 2026-07-24, 2026-08-01 et 2026-08-09 pour ne retenir
> que ce qui est encore vrai, ce qui a été fermé, et ce qui est neuf.
> `pnpm check` **n’a pas été relancé** dans cette session (arbre propre, `main`
> à `8348c54`, 1 commit d’avance sur `origin/main` = spec VPFR seule).

---

## 1. Verdict

AXIOM est un **excellent poste de recherche perso**, pas encore un produit dont on a
*vérifié* qu’il vaut 100 $/mois.

Le moteur est mûr : chart live multi-ex, 179 indicateurs TS purs, 37 fenêtres,
orderflow, backtest honnête (fill open+1, frais, slippage), playbooks, alertes
front+daemon, badges de fiabilité là où ils existent, Lot A (lisibilité du graphe)
réellement livré. Le Lot « Liens » du 10 août a fermé les demi-ponts les moins
chers (croisement d’alerte, journal daemon dans BRIEF, ticker `wsLoop`, couverture
⌘K, repli OI Binance, rétention SQLite).

Ce qui manque n’est plus du code de surface. C’est **la preuve que le live tient**,
**la mémoire longue** (le terminal calcule, il n’accumule presque rien), et
**l’honnêteté du backtest à l’écran** (les stratégies chart et le moteur
d’exécution restent deux systèmes).

Le gate G100 — barre que le projet s’est donnée le 13 juillet — est **toujours
ouvert**. C’était déjà le P1 des audits du 24/07 et du 09/08.

---

## 2. Chiffres (2026-08-20)

| Mesure | Valeur |
|---|---|
| Indicateurs (`INDICATORS`) | **179** (test `registry.test.ts`) |
| dont category `strategy` | **27** (8+7+5+7 v2.1–v2.6) |
| Fenêtres `WINDOW_REGISTRY` | **37** |
| LOC TS/TSX (hors `node_modules`/`dist`) | **~160 k** dont **~119 k** `apps/web/src` |
| Fichiers de test | **435** (`*.test.ts(x)` + e2e) · **215** sous `apps/web/src` · **13** Playwright |
| Workers | 2 (`backtest`, `screener`) — pas d’`orderflow.worker` |
| `setInterval` dans `apps/web/src` | **44** occurrences / **25** fichiers |
| `visibilitychange` | **0** |
| `TODO` / `FIXME` / `@ts-ignore` / `: any` prod | **0** |
| Golden pandas-ta | **4 / 179** (ADX, SuperTrend, Ichimoku, PSAR) |
| Daemon | bind `127.0.0.1:8787`, 9 capabilities + `/health` + SPA, 11 tables SQLite |
| `axiom.db` | **15 Mo**, gitignoré, dernier mtime **1er août** |
| HEAD | `8348c54` — spec VPFR/OIMAP, **non poussée** |

Depuis le 09/08 : **+2 721 / −124** lignes (LIQHL, fix LIQEST, Lot Liens, spec VPFR).
Aucune nouvelle fenêtre.

---

## 3. Ce qui est solide (ne pas casser)

- **Chemin chaud renderer-first** : WS marchés directs, daemon hors hot path, UI
  100 % sans daemon (sauf LIQHL, qui se dégrade en `sans-daemon`).
- **`marketStore` / `createMarketStore`** : `requestId`, buffer 5 000, zéro re-render
  React sur tick. Multi-chart 2×2 **réel** (stores par slot).
- **Contrôleurs injectés** pour LIQ heatmap, BOOK, compare, VP, orderflow (modèle
  à étendre, pas à remplacer).
- **Moteur d’alertes unique** `@axiom/alerts` front + daemon. Les 8 types de
  condition sont dans le `<select>` (P1.2 fermé).
- **Backtest honnête** : clôture → fill open suivant, pas d’intrabar, worker dédié.
  Étiquette « non validé » conservée sur les presets v2.6.
- **Lot A lisibilité** : couleur par *instance*, légende porteuse, budget de
  hauteur, `#1677FF` d’usine verrouillé par test.
- **Sécurité localhost** : bind IPv4 loopback, garde Host/Origin/DNS-rebinding,
  `/extapi` whitelist + re-validation DNS aux redirects + IP non publiques refusées,
  clés proxy hors bundle (`import.meta.env` = seulement `VITE_AXIOMD_URL` borné
  loopback). Telegram token rédigé dans les logs.
- **Trois couches liquidation distinctes et étiquetées** : heatmap *exécutée*,
  niveaux **EST.** (modèle levier), niveaux **HL réels** (top 150, non exhaustif).
  BUILD-CONTRACT anti-CoinGlass respecté.
- Ratchet UI, ErrorBoundary à 3 niveaux, 0 `any` de production.

---

## 4. Fil rouge 2026-08-20

Le 09/08, le fil rouge était **les demi-ponts** (le back existe, le dernier mètre
manque). Le Lot Liens a fermé les moins chers.

Le fil d’aujourd’hui est plus dur :

> **Le terminal calcule remarquablement, n’observe pas son propre live, et n’accumule
> presque rien. Depuis le 10 août, on a repris l’ajout de surface (LIQHL, spec VPFR)
> par-dessus un G100 jamais joué.**

Trois symptômes du même déséquilibre :

1. **Preuve absente.** G1 (chart 30 min + coupure 90 s) n’a aucun e2e et aucune
   case manuelle cochée. 44 timers, 0 `visibilitychange`. Quota Twelve Data
   **compté, jamais appliqué**.
2. **Mémoire absente.** Cold-store `candles` : table + routes **oui**, writer =
   backtest Binance **seulement**. Snapshots daemon : 6 clés. `macroHistory`,
   dessins, workspaces, paper, FUNDX : localStorage ou snapshot live.
3. **Deux vérités du backtest.** Les 27 stratégies chart marquent des signaux
   close-à-close hors frais. `runBacktest` (frais, slippage, open+1) ne rejoue
   **aucune** def v2.6 telle quelle. L’UI a 3 approximations `long` étiquetées
   « non validé ». Walk-forward = CLI only.

---

## 5. Ouvert vs corrigé depuis le 09/08

| Piste 09/08 | État | Preuve |
|---|---|---|
| P0.1 G100 manuel | **Ouvert** (4 semaines) | plan §14 encore `manual QA` ; README:127 |
| P0.2 merge `lots-bcd` | **Corrigé** 09/08 | `88bff24` |
| P0.3 README 179/37 | **Corrigé** | README à jour sur ces chiffres ; **pas** sur la CI |
| P1.1a alerte → chart | **Corrigé** | `AlertsPanel` + `navigateTo` |
| P1.2 `indicateur-croisement` UI | **Corrigé** | `AlertsPanel.tsx:366` |
| P1.4 journal daemon → BRIEF | **Corrigé** (écran) ; export markdown **non** | `SectionSession` ; `briefEnMarkdown` ignore le journal daemon |
| P1.5 ⌘K ↔ fenêtres | **Mitigé** | test couverture ; liste `panneau:*` toujours manuelle |
| P1.3 EQS → backtest | **Ouvert** | 0 « backtest » dans `ScreenerWindow` |
| P2.1 historiser BRIEF | **Ouvert** | |
| P2.2 candles Coinalyze/TD | **Ouvert** | `candlesPush` = `backtestData.ts` only |
| P2.3 repli OI Binance | **Corrigé** | `histOiUsdAvecRepli` ; badge de source toujours absent |
| P2.4 FUNDX horodaté | **Ouvert** | « snapshot live (pas d’historique) » |
| P2.5 snapshots clés critiques | **Ouvert** | persist = 6 clés ; drawings/workspaces/paper/expy/`macroHistory` locaux |
| P3.1 strats v2.6 × `runBacktest` | **Partiel** | 3 presets UI approx. ; 4 defs chart jamais dans le moteur |
| P3.2 walk-forward UI | **Ouvert** | `partagerMoities` CLI-only ; signature `TradeStrategie` ≠ `TradeResultat` |
| P3.3 MAE/MFE + expectancy UI | **Ouvert** | 0 MAE/MFE (stop sur close) ; expectancy non exportée |
| P3.4 goldens 4/179 | **Ouvert** | inchangé |
| P4.1 ticker → `wsLoop` | **Corrigé** | |
| P4.2 purge journal + VACUUM | **Corrigé** | replay **non** borné ; `purgerExpires` cache **mort** |
| P4.3 429 / budgets proxy | **Ouvert** | TTL only |
| P4.4 `visibilitychange` | **Ouvert** | 1 skip eval alertes si hidden ; pollers inchangés |
| P5.1 overlays × `getActiveChart()` | **Partiel** | liqHeat + depthHeat injectés ; **4** singletons restent (trades, whale, BT, éco) + nav + fenêtre LIQ |
| P5.2 `symboleContextuel()` | **Ouvert** | ~25 composants lisent `marketStore` (slot 0) |
| P5.3 `useDonneesAsync` | **Ouvert** | 0 helper ; 3 unions `Statut` divergentes |
| P5.4 ratchet UI hors `components/` | **Ouvert** | |
| P5.5 `orderflow.worker` | **Ouvert** | |

**Nouveau depuis le 10/08**

- **LIQHL** (`feat cc34403`) : niveaux réels Hyperliquid, daemon paresseux
  (leaderboard 34 Mo / 6 h, 150 adresses, cache 5 min). Honnête sur la
  non-exhaustivité. Coût : import à effet de bord dans `App.tsx`, `AbortSignal.timeout`
  (piège CI déjà documenté dans `proxy.ts`), race « dernière réponse gagne » sans
  génération de requête, couches empilées dans un seul contrôleur canvas.
- **LIQEST** (`fix 1d0f5d6`) : muet hors perp Binance — `basePerp` + repli OI +
  fenêtre bornée. Livré.
- **Spec VPFR + rail ΔOI / `OIMAP`** (`8348c54`, non poussée) : **0 code**. Le
  VPFR volume existe déjà (`volumeRangeOverlay.ts`). C’est une extension, pas une
  38ᵉ fenêtre.

---

## 6. Issues, par rendement

Sévérité honnête : un « bug » ici est un défaut de *comportement produit* (le 2×2
menteur, le quota qui ne freine pas), pas un crash.

### P0 — 30 minutes, 0 code

1. **Clôturer G100.** Protocole écrit (`2026-07-22-gate-g100-qa.md`), cases ⬜.
   Automatisé : Playwright G2/G3/G4/G6/G7/G8/G10 + scripts G5/G9. Manuel restant :
   G1 30 min + coupure 90 s, alerte onglet fermé réelle, chrono onboarding,
   jugement visuel LIQ/badges. **Si G1 FAIL, le reste de la roadmap est du bruit.**

### P1 — Tient / ne ment pas (usage quotidien)

2. **Quota Twelve Data cosmétique** — `apps/web/src/data/twelvedata.ts:34-35,112-140`.
   8/min : oui (wait). 800/j : bump + affichage santé, **aucun stop**. Watchlist
   tradfi 5–10 symboles = journée brûlée, reset minuit UTC. Ouvert depuis le 24/07.

3. **Aucun `visibilitychange`.** 44 `setInterval`. Pollers 30–60 s (FUNDX, OMON,
   TERM, MAP, Coinalyze, tradfi, Globe OpenSky 400 crédits/j, heartbeat 30 s)
   tournent onglet masqué. Effet collatéral : le heartbeat fait croire au daemon
   que l’app est ouverte (`SEUIL_HEARTBEAT_MS` 90 s) → **pas de notif onglet fermé**
   tant que l’onglet existe en fond.

4. **2×2 menteur pour les overlays.** `tradeMarkers`, `whaleBubbles`, `btMarkers`,
   `ecoMarkers` posent sur `getActiveChart()` avec le **symbole du maître**.
   « Voir sur le graphe » (LIQ) scrolle le focus et flashe le slot 0.
   Heat/EST/HL/BOOK sont injectés dans le **chart maître seulement**
   (`ChartInstance.tsx:643+`) et lisent `marketStore` global.

5. **Proxy daemon sans 429 / Retry-After / budget.** `traiterProxy` : cache TTL
   puis fetch. Un 429 est renvoyé tel quel. `purgerExpires` (`cache.ts`) n’a
   **aucun appelant**. Replay sans TTL.

### P2 — Relier / accumuler (le dernier mètre)

6. **EQS / alerte ↛ backtest.** Vocabulaires de conditions déjà alignés
   (`@axiom/alerts` vs `@axiom/backtest`).

7. **Walk-forward dans `BacktestWindow`.** `partagerMoities` existe ; l’UI est
   100 % in-sample. Attention : la fonction coupe des `TradeStrategie` (`idxEntree`),
   pas des `TradeResultat` (`tempsEntree`) — ce n’est pas un simple import.

8. **`candlesPush` depuis Coinalyze et Twelve Data.** Helpers + table + routes
   existent. Raison d’être (purge quotidienne Coinalyze) non servie.

9. **Étendre le dual-write** à `drawings`, `workspaces`, `paper`, `expy`,
   surtout `macroHistory` (1 an TOTAL/TOTAL2/TOTAL3 non rejouable).

10. **NOTE → pin chart.** Commentaire d’auteur : « l’épinglage visuel viendra
    plus tard » (`NotesWindow.tsx:7-8`).

11. **FUNDX : horodater, ou cesser de le vendre comme « le signal ».** Snapshot
    live, pas de série.

### P3 — Vérité des stratégies

12. **Exprimer les 7 v2.6 dans `runBacktest`, ou arrêter de les montrer dans BT.**
    Aujourd’hui : 3 presets `long` + stop 5 % + sortie conjonctive, alors que les
    defs chart sortent en OU et la campagne CLI est en `les-deux`. Même nom, autre
    système. `stratChampion.ts:26-32` le dit lui-même.

13. **Expectancy dans `StatsGrid`.** `StatsRejeu.expectancy` existe, n’est pas
    exportée par `@axiom/backtest`. MAE/MFE = chantier moteur (stop évalué sur
    close, pas de high/low en position).

### P4 — Spec déjà écrite, 4/5 du code déjà là

14. **VPFR rail ΔOI + mnémonique `OIMAP`.** Spec du 10/08. Pas une 38ᵉ fenêtre.
    **Interdit d’ajouter une fenêtre tant que G100 n’a pas de verdict.**

### Dette documentaire (pas un crash, un piège à agents)

15. **`BUILD-CONTRACT.md` est périmé et dangereux.** Anti-objectifs encore écrits :
    « pas plus de 7 indicateurs », « pas d’exchanges autres que Binance »,
    « paper plus tard ». Le contrat est la source de vérité des agents. Tel quel,
    un agent discipliné *refuserait* l’état actuel du dépôt.

16. **README vs réalité.** « Pas de CI distante imposée » (`README.md:144`) alors
    que `.github/workflows/ci.yml` existe depuis le 24/07. Paper listé dans
    « Décider » (`:24`) et « hors scope » (`:159`). Trois vérités (contrat /
    README / code).

17. **Onglet Insider FUND** : vide *par design* (`FundWindow.tsx:13-18`) — honnête,
    mais surface morte. Collision mnémonique FUND / FUNDX.

---

## 7. Fenêtres — carte de maturité (résumé)

Aucune des 37 n’est du code mort (toutes au registre + ⌘K). Le mort est
**l’onglet Insider**, le **tuyau candles hors BT**, et **GLOBE/FUND comme
vitrines** relativement au rituel 100 $.

| Mature (rituel quotidien) | Utile | Vitrine / demi-pont |
|---|---|---|
| DES, DOM, EQS, ECO, NEWS, BRIEF, CHAIN | LIQ, FUNDX, MAP/CAP/SECT, CORR, PORT, BT, REPLAY, TERM/OMON/VOL, RATE/COT/NETLIQ, STBL/CBPREM/SQZ, DATA, EXPY, PAPER*, EVTS/DIST/SCEN | GLOBE, FUND (Insider mort), CYCLE/MINE/SEAG (honnêtes, basse fréquence), NOTE (pas de pin) |

\* PAPER : moteur réel, **hors G100 (K8)** et hors MVP du contrat. Le code a
tranché pour l’inclusion ; les docs non.

Doublons produit (pas code) : NOTE / EXPY / PORT / PAPER = 4 journaux ;
DES-liq vs LIQ ; DATA vs HealthPanel ; FUND vs FUNDX.

`BadgeFiabilite` n’est **pas** une loi produit. Consommateurs UI : DES, CHAIN,
EQS (1 badge), CORR. Ailleurs : `NoteSource` 10 px en pied. Doctrine doc 02 =
marketing hors de ~4 fenêtres.

---

## 8. Ordonnancement recommandé

1. **G100 manuel** (une session, 0 code). Remplir §14 + E2 + case WTP. Si G1
   FAIL, stop.
2. **Lot « Tient »** : `visibilitychange` + frein Twelve Data (stop+toast à 800)
   + `purgerExpires` dans la boucle snapshots. Sans ça, G1 30 min en fond est
   biaisé (l’onglet brûle encore).
3. **Lot « Boucle trader »** : pin NOTE→chart ; EQS/alerte → BT ; split
   in/out-sample dans `BacktestWindow` (adapter la signature). Le Lot Liens a
   montré que le back existe.
4. **Lot « Mémoire »** : `candlesPush` Coinalyze/TD ; dual-write
   `macroHistory` + drawings + workspaces. Horodater FUNDX **ou** le relabeler.
5. **VPFR rail ΔOI + `OIMAP`** — et s’arrêter. Pas de 38ᵉ fenêtre.

P5 multi-chart (injecter les 4 singletons restants) en fil rouge, un contrôleur
par lot, modèle `CompareController` / `OrderflowController`.

Ne pas faire avant : nouvelle fenêtre, pop-out second écran, goldens de masse,
fusion catalogues stratégies chart vs BT (les nommer « signal » vs « exécution »
plutôt que fusionner).

---

*Sources : 4 revues d’agents (2026-08-20) + greps/lectures orchestrateur.
Constats vérifiés par chemins de fichiers. `pnpm check` non relancé dans cette
session.*
