# Revue globale & nouvelles pistes — 2026-08-09

> **Audit multi-agents** (architecture web, couche données + daemon, packages purs, UX/produit),
> croisé avec les audits du 2026-07-24 et du 2026-08-01 pour ne proposer que du neuf.
> État vérifié : `pnpm check` **vert** (typecheck + tests + build) sur `lots-bcd`,
> correctifs de la revue adversariale B/C/D inclus (non commités).

---

## 1. État du projet

**Chiffres au 2026-08-09** : 179 indicateurs (registre verrouillé par test), 37 fenêtres,
83 mnémoniques ⌘K, ~118 000 LOC dans `apps/web` dont ~26 % de tests (211 fichiers),
5 thèmes, daemon avec 12 familles de routes, SQLite 15,4 Mo.

**Ce qui est solide** (à ne pas toucher) :
- `store/market.ts` : discipline `requestId` exemplaire (`startDataLoad`/`completeDataLoad`),
  buffer borné, zéro re-render React sur tick.
- Le multi-chart 2×2 est **réellement implémenté** (fabrique `createMarketStore`,
  `ChartGrid` 4 dispositions, dessins par instance) — contrairement à ce que la roadmap
  de juillet laissait croire.
- Le moteur d'alertes est **le même code** front et daemon (`@axiom/alerts`), comme prévu.
- Ratchet UI (`uiConventions.test.ts`) à zéro exception, 11 paires `*.util.ts` extraites,
  3 `catch` vides seulement dans tout `src`, ErrorBoundary à 3 niveaux.
- 37 fenêtres code-splittées ; ajouter la 38ᵉ coûte ~3 fichiers, avec erreur de
  compilation si oubli du chargeur lazy.

**Deux dettes de gouvernance, avant toute nouvelle feature** :

1. **Le gate G100 n'a jamais rendu son verdict.** La partie automatisée est verte
   (Playwright 16/16 ×2, scripts g5/g9 PASS) mais le noyau manuel §2 est intégralement
   à ⬜ (coupure réseau 90 s, veille 30 min, jugement visuel LIQ). C'était le P1 de
   l'audit du 2026-07-24 (« clôturer avant de coder autre chose ») — ~5 lots ont été
   empilés depuis. 30 minutes d'attention.
2. **`main` est figé au 2026-08-01.** Les Lots B/C/D (`lots-bcd`, 3 commits) + les
   13 fichiers de correctifs adversariaux non commités + `regime.couverture.test.ts`
   dorment hors de `main` alors que `pnpm check` passe. Commit + merge.

---

## 2. Le fil rouge : des demi-ponts

La revue fait apparaître un motif récurrent, plus intéressant que chaque constat isolé :
**le dépôt est plein de refactors et de tuyaux arrêtés à mi-chemin** — le back existe,
le dernier mètre manque.

| Brique | Ce qui existe | Le mètre manquant |
|---|---|---|
| Alerte `indicateur-croisement` | types + moteur + routage front **et** daemon | absent du `<select>` d'`AlertsPanel.tsx:317` |
| Journal d'alertes daemon | `/alerts/journal` sert les déclenchements onglet fermé | **aucun consommateur** ; BRIEF lit le journal front en mémoire |
| Cold-store `candles` | module daemon + helpers client, raison d'être documentée (Coinalyze purgé/jour) | la table SQLite **n'a jamais été créée** ; seul le backtest Binance l'appelle |
| Multi-chart | registre `chart → dessin`, stores par slot | 7 familles d'overlays lisent encore `getActiveChart()` global ; ~34 modules câblés au slot 0 |
| Walk-forward | `partagerMoities` (split in/out-of-sample) | CLI seulement — l'UI backtest est 100 % in-sample |
| Stratégies v2.6 | 7 defs au registre, marqueurs chart | **jamais passées par `runBacktest`** (ni frais ni slippage mesurés) |
| Palette ⌘K | registre de commandes dynamique | les commandes `panneau:*` sont une liste **à la main** (32 entrées) — la 38ᵉ fenêtre serait muette au ⌘K |

Second motif : **le terminal calcule remarquablement mais n'accumule presque rien**.
Coinalyze purge ~1500-2000 pts/jour, les ratios L/S Binance plafonnent à ~20 j, le
funding cross-exchange n'est pas horodaté, le brief n'a aucun historique, et une année
de `macroHistory` vit uniquement en localStorage, hors snapshots. Pour un produit dont
l'axe revendiqué est « la confiance au premier plan », l'absence de mémoire longue est
LE trou identitaire.

---

## 3. Pistes, par ordre de rendement

### P0 — Boucler (coût quasi nul)

| # | Piste | Effort |
|---|---|---|
| 0.1 | Clôturer le **gate G100** (noyau manuel §2) et écrire le fichier de verdict | 30 min |
| 0.2 | Commit des correctifs adversariaux + **merge `lots-bcd` → `main`** | XS |
| 0.3 | Rafraîchir le README : 155→179 indicateurs, 35→37 fenêtres | XS |

### P1 — Relier les briques (le chaînon le moins cher du produit)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 1.1 | **Alerte ⇄ chart ⇄ backtest** | S | (a) `AlertsPanel` → `navigateTo` (seule surface listée qui ne l'importe pas) ; (b) « créer l'alerte de cette règle d'entrée » depuis le backtest — les vocabulaires de conditions sont déjà alignés (`packages/backtest/src/types.ts:8-14` vs `packages/alerts`) ; (c) « backtester cette condition » depuis une alerte. |
| 1.2 | Formulaire **`indicateur-croisement`** dans AlertsPanel | XS | Tout le back existe (front + daemon). Quelques dizaines de lignes de formulaire. |
| 1.3 | **Screener → backtest** : « backtester cette liste » depuis un preset screener | S | Zéro occurrence de « backtest » dans `ScreenerWindow` aujourd'hui. |
| 1.4 | Brancher **`/alerts/journal` daemon** dans le front | S | Helper client dans `data/daemon.ts` + fusion dans `SectionSession` du BRIEF : « pendant votre absence, X alertes ». Le daemon écrit dans le vide depuis sa livraison. |
| 1.5 | **Dériver les commandes `panneau:*` du `WINDOW_REGISTRY`** | XS/S | Ou a minima un test croisé « chaque fenêtre a une commande qui l'ouvre » dans `commands/registry.test.ts`. |

### P2 — Accumuler (la mémoire longue)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 2.1 | **Historiser le brief** | S/M | Store `briefs` + KV daemon (1 snapshot/jour, compaction). Débloque : relire le brief de J-7, comparer le régime à J-30, vérifier a posteriori les lectures de `lecturesBrief.ts`. Prolongement naturel du Lot D. |
| 2.2 | **Brancher le cold-store `candles`** sur ses cibles déclarées | S | Écrire depuis `coinalyze.ts` et `twelvedata.ts` (le module daemon et les helpers existent). Compense la purge quotidienne Coinalyze. |
| 2.3 | **`openInterestHist` Binance** (30 j d'OI, gratuit, sans clé) | XS | ~~L'endpoint n'est pas appelé~~ **Erratum 2026-08-10** : le fetcher existait déjà (`binanceFutures.ts:311`, consommé via `referentiels.ts histOiUsd`). Le vrai manque était l'**arbitrage de repli** Coinalyze→Binance — livré (sous-pane OI du chart, `histOiUsdAvecRepli`). |
| 2.4 | Horodater le **funding cross-exchange** (divergence CEX↔Hyperliquid) | S | Le code le présente comme « le signal recherché » mais ne le rend pas comparable dans le temps. |
| 2.5 | **Étendre les snapshots daemon** aux clés critiques localStorage-only | S | `drawings`, `workspaces`, `paper`, `expy`, et surtout `macroHistory` (1 an de TOTAL/TOTAL2/TOTAL3 non rejouable). Étendre le dual-write de `persist.ts:71-77` (6 clés aujourd'hui). |

### P3 — Mesurer juste (backtest & indicateurs)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 3.1 | **Backtester les 7 stratégies v2.6 via `runBacktest`** | M | Le trou le plus net du dépôt : elles n'existent que comme marqueurs chart (hors frais). Soit les exprimer en conditions déclaratives, soit ajouter un mode « signal précalculé » au moteur. |
| 3.2 | **Remonter le split in/out-of-sample dans BacktestWindow** | S | `partagerMoities` existe (`statsRejeu.ts`) — l'UI est 100 % in-sample. Gain disproportionné/effort. |
| 3.3 | **MAE/MFE + expectancy** dans `StatsBacktest` | S | Le moteur ne trace pas les extrêmes intra-trade (pré-requis pour calibrer les stops) ; l'expectancy existe côté `StatsRejeu` mais n'est jamais rendue. |
| 3.4 | Étendre les **golden tests** (4/179 avec oracle externe) | M | Par famille, aux plus utilisés d'abord (RSI/MACD/BB/EMA/ATR déjà bien testés à la main — prioriser les defs récentes v2.x et les dérivés). |

### P4 — Durcir (robustesse données)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 4.1 | **`ticker.ts` → `wsLoop`** | S | Le bandeau ticker rejoue exactement l'anti-pattern que `wsLoop` documente (`attempt = 0` dans `onopen`, ligne 169), sans watchdog ni entrée healthStore : il peut geler invisiblement. 9 adaptateurs ont déjà migré. |
| 4.2 | **Rétention SQLite** | S | Purger `alertes_journal` (croissance non bornée), rétention replay, `PRAGMA incremental_vacuum` dans la boucle snapshots (24 % du fichier en freelist). |
| 4.3 | **429/`Retry-After` + budgets par route** dans le proxy daemon | S/M | Aujourd'hui seule protection : cache TTL. Etherscan, SoSoValue, Finnhub, FRED, CoinGecko transitent sans compteur ni backoff serveur. |
| 4.4 | **Ordonnanceur de polling + `visibilitychange`** | M | P3 de l'audit 07-24, toujours ouvert (~40 `setInterval`). À coupler avec un boot lazy des ~7 contrôleurs chart importés à effet de bord dans `App.tsx:37-52` (fetch OI au démarrage même si rien n'est affiché). |

### P5 — Dette architecturale (finir le refactor multi-chart, cadrer les fenêtres)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 5.1 | **Injecter le chart dans les contrôleurs d'overlays** | M | 7 familles (tradeMarkers, whaleBubbles, btMarkers, ecoMarkers, liqHeat…) lisent `getActiveChart()` → en 2×2 les marqueurs migrent au clic, y compris vers un pane d'un autre symbole. Migration incrémentale, un contrôleur à la fois (modèle : `CompareController`). |
| 5.2 | **`symboleContextuel()`** pour les 8 fenêtres câblées au slot 0 | S/M | BRIEF/DIST/SQUEEZE/… affichent le symbole du slot 0 quel que soit le pane focus. + test-ratchet interdisant `marketStore.getState()` dans `components/**`. |
| 5.3 | **`useDonneesAsync` + `Statut` canonique** | M | Le triplet `data|null`+`Statut`+`useEffect` est réécrit ~40 fois, avec 3 unions divergentes (2 sans état d'erreur) et 11 fenêtres/38 seulement protégées contre les races. Promouvoir `brief/commun.tsx` en `lib/statut.ts`, migration ratchetable. |
| 5.4 | Étendre le **ratchet UI à `src/`** (aujourd'hui `src/components` seul) | S | 19 919 LOC de `src/chart` hors périmètre. Le mécanisme le supporte déjà. |
| 5.5 | **`orderflow.worker.ts`** | M | `orderflow.calc.ts` et `footprintAnalytics.ts` sont déjà purs et testés — candidats immédiats au modèle `backtest.worker.ts`. Lèverait la restriction « orderflow · slot focus ». |

### P6 — Capacités nouvelles (optionnel, après le reste)

| # | Piste | Effort | Détail |
|---|---|---|---|
| 6.1 | **Export de session unifié** | S/M | 4 mécanismes hétérogènes aujourd'hui (PNG, BACKUP JSON, CSV portefeuille, JSON EXPY). `briefEnMarkdown` est la brique la plus proche d'un « rapport de session » markdown/PDF. |
| 6.2 | **Pop-out vers second écran** | M | `sync.ts` ne diffuse que symbole + thème ; pas de `window.open` d'une fenêtre. Étendre le BroadcastChannel au détachement d'une fenêtre (mode `--app`). |

---

## 4. Recommandation d'ordonnancement

1. **P0 entier** (une session) : G100 + merge + README.
2. **Un « Lot Liens »** : P1.1 + P1.2 + P1.4 + P1.5 — quatre demi-ponts terminés,
   quasi tout le back existe déjà. C'est le lot au meilleur ratio valeur/effort
   identifié par cette revue.
3. **Un « Lot Mémoire »** : P2.1 + P2.2 + P2.3 + P2.5 — donne au terminal une mémoire
   longue et prolonge l'identité « confiance » du Lot D.
4. **Un « Lot Vérité du backtest »** : P3.1 + P3.2 + P3.3 — les stratégies vendues par
   le registre doivent avoir des chiffres nets de frais, out-of-sample.
5. P4/P5 en fil rouge (une piste par lot, comme les revues adversariales actuelles).

---

*Sources : 4 rapports d'agents (2026-08-09) sur `lots-bcd` + `pnpm check` vert.
Constats vérifiés par chemins de fichiers ; les numéros de ligne peuvent glisser après merge.*

---

## Mise à jour 2026-08-10 — Lot « Liens & ménage » livré

- **P0.2 / P0.3 faits** : correctifs adversariaux commités, `lots-bcd` mergé dans `main` et poussé, README à jour (179/37, +CAP +SECT). **P0.1 (G100 manuel) reste à l'opérateur.**
- **P1.1a/1.2/1.4/1.5 livrés** : formulaire `indicateur-croisement` (+ `alertsPanel.util.ts` pur), navigation alerte→chart (liste + journal, `markTime`), journal daemon fusionné dans la section Session du BRIEF (`sessionAlertes.ts`, dédup à tolérance 60 s), test croisé `windowPanels.couverture.test.ts` (génération auto rejetée après mesure : 32/32 entrées portent mots-clés/aperçus faits main).
- **P2.3 livré (erratum ci-dessus)** : repli OI Binance sur le sous-pane dérivés.
- **P4.1/4.2 livrés** : ticker sur `wsLoop` + santé `binance:ticker` (compteur de flux vivants sur clé santé partagée) ; purge `alertes_journal` 30 j + compactage `VACUUM` conditionné (piège WAL : `wal_checkpoint(TRUNCATE)` obligatoire pour rendre l'espace disque).
- **Frigo du lot** : `briefEnMarkdown` n'inclut pas les déclenchements daemon (l'écran oui) ; repli OI silencieux sur le sous-pane (pas de surface de badge) ; couverture DOM impossible en vitest node (formulaire testé via fonctions pures + ratchet).
