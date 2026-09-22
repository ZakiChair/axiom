# 2026-09-22 — Revue d'AXIOM, heatmap Hyperliquid des niveaux réels, dix indicateurs on-chain

Demande du propriétaire : « fais-moi une revue d'AXIOM, intègre correctement les liquidations sur le
graphique venant d'Hyperliquid (carte thermique des liquidations) et trouve et ajoute de nouveaux
indicateurs on-chain basés sur nos sources déjà disponibles ». Plan :
`docs/superpowers/plans/2026-09-22-heatmap-hl-indicateurs-onchain.md`. Amendement du contrat :
`BUILD-CONTRACT.md`, « Revue et extension du 22 septembre 2026 ». Orchestration : un orchestrateur
(planification, revue de chaque diff avant commit) + un implémenteur sur brief.

## Revue — constats mesurés (daemon + Vite locaux, Playwright)

1. LIQEST / LIQHL muettes après un changement de symbole ou un rechargement quand LIQMARK est OFF
   (reproduit PUMPUSDT 1M → BTCUSDT 15m : ni ligne ni légende) — `ChartInstance.tsx` n'instanciait le
   contrôleur partagé que sur LIQMARK.
2. LIQHL non persistée ; 18 positions BTC dans le pool top-150 `accountValue`, 2 dans ±40 % du prix.
3. Heatmap exécutée : 2 lignes sur 7 jours pour BTCUSDT (8 873 au total, collecte 25–30/08 et
   10–13/09) ; collecteur vivant → aucun repli Coinalyze → heatmap « 7 j » quasi vide.
4. Liquidations HL exécutées : 0 ligne en base depuis le 21/09 (couverture ≈ 52 % du flux makers,
   événements sporadiques, daemon peu allumé).
5. Budget d'entrée : 1 210 126 / 1 220 000 bruts, 356 979 / 360 000 gzip. Attribution par sourcemap
   (99,2 % attribués) : `AlertsPanel.tsx` 23 602 bruts dans le chunk initial, `backtestFunding.ts`
   10 563 via `store/backtest.ts`, `brief.ts` + `catalogueMacro.ts` ≈ 20 700 via `store/regime.ts`,
   `publicationArchive.ts` 12 030 via `data/eco.ts` ; `packages/indicators` 162 333 pour 212 fichiers.

Mesures Hyperliquid (API publique) : 100 adresses du top volume hebdomadaire hors du pool actuel →
35 positions BTC à `liquidationPx` exploitable (418 M$), 32 ETH (395 M$), 15 SOL (17,9 M$) ;
intersection top-150 `accountValue` ∩ top-150 volume jour = 19 adresses ; OI BTC ≈ 3,92 Md$ (un côté) ;
`fundingHistory` BTC : 240 points horaires sur 10 j.

## Lot 0 — budget d'entrée

`AlertsPanel` en `React.lazy` + `Suspense` (repli = en-tête « Alertes » replié), `backtestFunding` en
`import()` dans le bloc asynchrone du run. Mesure : 1 210 126 / 356 979 → **1 176 378 / 347 934**
(−33 748 / −9 045). `AlertsPanel-*.js` (24,4 ko) et `backtestFunding-*.js` désormais dans `dynamique`.

## Lot 1 — heatmap HL des niveaux réels

Daemon : pool `extrairePool` = top-150 `accountValue` ∪ top-350 volume « week » (474 adresses
observées après dédoublonnage), `clearinghouseState` 4 en vol / 100 ms, arrêt sur 429, cache périmé
servi pendant une construction en vol, `idleTimeout` Bun 120 s ; collecteur opt-in `hlLiqHeat.ts`
(drapeau KV `hl/heat`, 5 min, table `hl_liq_instantanes`, rétention 14 j, `metaAndAssetCtxs` pour
l'OI), route `GET /hl/liqheat/:coin?depuis&jusqua&pas`, `/health.collecteurs.hlHeat`.

Preuve réelle : `/health` → `hlHeat = { actif: true, adresses: 474, coins: [BTC, ETH, SOL] }` ;
`/hl/liqheat/BTC?pas=300000` : premier instantané (pool 150) 19 niveaux, couverture 0,115 ; instantanés
suivants (pool 474) **114–119 niveaux BTC, nLong 49–51 / nShort 65, oiUsd ≈ 3,95–3,97 Md$, couverture
0,23** ; scan mesuré **≈ 49–52 s** pour 474 adresses (`[axiomd] instantané HL : 474 adresses en 49.2 s`) ;
`/hl/liqlevels/BTC` → 200 en 0,6 ms depuis le cache. Constaté en revue : le premier `/hl/liqlevels`
après un boot mourait à 10 s (« request timed out after 10 seconds ») → `idleTimeout: 120`.

Front : `data/hyperliquidHeat.ts` (chunk paresseux, garde « une requête en vol », reprise 30 s après
échec), `construireGrilleHl` (dernier instantané ≤ fin de bougie, report ≤ 2 pas, colonne vide
au-delà), rampe `RAMPE_HL_AMBRE`, légende « HL HEATMAP (niveaux réels) — N instantanés · X adresses ·
couverture ≈ Y % OI · pas … [· T trous = daemon éteint] », tooltip HL, état « chargement » de LIQHL,
persistance `sessionUi.liqHl`, contrôleur créé dès qu'une des trois bascules est active, repli
Coinalyze par jour UTC sans événement réel (jour courant exclu, légende « Coinalyze ≈ sur N j »),
fenêtre LIQ : « Heatmap HL : collecte daemon active depuis 22/09 11:46 · 8 instantanés (14 j) ·
dernier il y a 2 min · couverture ≈ 23 % OI » + bouton « Collecte daemon ».

Captures (`.playwright-mcp/`, hors git) : `revue-08-hl-heatmap-btc-5m.png` (heatmap ambre + légende
« 9 instantanés · 474 adresses · couverture ≈ 23 % OI · pas 5 min »), `lot2-liqest-btc.png` /
`lot2-liqest-eth.png` (LIQEST seule survit au changement de symbole), `lot3-repro.png`
(`liqHl === true` après rechargement), `lot4-fenetre-liq.png` (ligne de collecte lue dans le DOM),
`lot5-indicateurs.png` (BTCUSDT 1h : heatmap HL sur 3 colonnes de 60 min, barres HL
« 76 982 · $153,46M », panes Funding Hyperliquid et Liquidations par bougie).

## Lot 2 — dix indicateurs (200 → 210)

Champs JSON BGeometrics vérifiés par un appel `/last` chacun (5 appels du quota) : `sthMvrv` 1,06,
`lthMvrv` 1,55, `nrplUsd` −129 445 415,71, `aviv` 0,974769 (tous `delayed: true` → `embargo`),
`vddMultiple` 0,6575 (J-1, sans embargo) ; fenêtre 1 460 j sur ces cinq défs (`startday=2022-09-23`
observé en production). Coinalyze `liquidation-history` 5min / 14 j via le proxy : 2 466 points → plafond
mesuré ≈ 2 500 points par appel (`LIQ_POINTS_MAX`). Hyperliquid `fundingHistory` BTC : 20 points
horaires sur la plage testée, pagination 500 vérifiée. Hash Ribbons : la première version traçait les
SMA en H/s (≈ 9 × 10²⁰) avec le régime ±1 sur le même axe (pane illisible, capture `lot6`) → sortie
`ratio` SMA courte / SMA longue + régime (`lot7-hashribbons.png`).

## Vérifications

- `pnpm check` vert : typecheck des 6 paquets ; tests indicators **1 450**, alerts 76, backtest 109,
  daemon **679** (+21), web **4 792** (+62).
- Budget d'entrée final : **1 187 537 bruts / 350 745 gzip** (marges 32 463 / 9 255) ;
  `hyperliquidHeat`, `hyperliquidFunding`, `mempool`, `liquidationHeat`, `bgeometrics`, `AlertsPanel`,
  `backtestFunding` hors du chunk initial.

## Limites à ne pas masquer

- La heatmap HL n'a d'historique que quand le daemon tourne avec le drapeau posé : le daemon du
  chantier s'est arrêté deux fois (fin de session d'agent) → trous réels visibles dans la collecte du
  22/09 ; c'est le comportement voulu (« T trous = daemon éteint »), pas une correction silencieuse.
- Échantillon ≤ 500 adresses du leaderboard, couverture ≈ 23 % de l'OI BTC mesurée le 22/09 ; positions
  en marge croisée très collatéralisées absentes (`liquidationPx` null).
- Quota BGeometrics : les sondages du chantier ont épuisé le quota horaire de la clé `.env` pendant
  ~40 min (429) ; en usage normal le cache 24 h amortit, mais un premier usage à quota vide affiche
  « quota » sur les panes on-chain.
- Miroir de persistance daemon (préexistant) : après un redémarrage du daemon, la restauration de
  session peut écraser une fois `sessionUi`/`chartState` fraîchement modifiés — observé deux fois
  pendant les preuves, non corrigé dans ce chantier.
- Le régime Hash Ribbons est descriptif ; `liqParBougie` dépend de la profondeur accordée par
  Coinalyze à chaque intervalle ; `fundingSpreadHl` suppose la convention 8 h de Binance.
