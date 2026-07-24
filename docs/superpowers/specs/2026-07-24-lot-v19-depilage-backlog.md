# Lot v1.9 — Dépilage du backlog

Date : 2026-07-24 · Origine : reliquats consignés (v1.4/v1.6/v1.7) + revue globale
du 2026-07-24. Vague 1 ci-dessous ; vague 2 (après merges) : découpage des
fenêtres > 40 Ko (PortfolioWindow, OptionsWindow, BriefWindow).

Invariants BUILD-CONTRACT habituels (pur/impur, dégradation gracieuse, FR,
`pnpm check` vert par branche). Branches : `feat/overlays-chart-backlog`,
`chore/backlog-v14`, `feat/etf-par-emetteur`.

## 1. Overlays chart en backlog (branche `feat/overlays-chart-backlog`)

Deux overlays du chart MAÎTRE consignés backlog, à livrer ensemble (même
plomberie) :

- **DIST — lignes VaR** (backlog v1.6, spec `2026-07-23-lot-v16-…` §DIST) :
  toggle DANS DistWindow (défaut OFF, persisté), lignes horizontales p5/p95
  (pleines discrètes) et p1/p99 (plus faibles) de l'horizon 20 bougies, à droite
  du prix, étiquettes « VaR95 »/« VaR99 » — patron `liquidationEstimates` /
  niveaux existants. Chart maître (slot 0) uniquement, comme la fenêtre.
- **PAPER — lignes d'ordres** (backlog v1.7) : ordres ouverts (limit/stop) et
  TP/SL des positions du SYMBOLE COURANT du chart maître, lignes horizontales
  étiquetées (côté + type + taille), couleur par sens (--up/--down, TP/SL
  distincts). Toggle dans PaperWindow (défaut ON), réactif au store paper.

Pas de drag des lignes (édition = fenêtres, v1). Tests : helpers purs de
construction des niveaux/étiquettes (à partir des états DIST/paper) ; le rendu
KLineChart suit le patron overlay existant sans test DOM.

## 2. Quintet backlog v1.4 (branche `chore/backlog-v14`)

Source : `.superpowers/sdd/progress-features-visuelles.md:131`.
1. Validation du refSymbol dans Réglages : symbole inconnu / fetch 4xx → état
   affiché « indisponible » (pas de panes plats muets).
2. COT : réponse CFTC vide sans cache → wording « indisponible » (pas de vide).
3. `store/cot` : squelette `resumerCot` dupliqué → factoriser (refactor sobre).
4. NETLIQ : consommer min2a/max2a déjà calculés (affichage min/max de période).
5. Message « dernier X conservé » trompeur au premier échec (sans cache) →
   parité avec le wording cbprem.
Chirurgical : cinq diffs indépendants, petits, testés là où il y a du calcul.

## 3. Flux ETF par émetteur (branche `feat/etf-par-emetteur`)

Revue 2026-07-24 : l'agrégat existe (SoSoValue + repli bitcoin-data), la
dispersion PAR ÉMETTEUR (IBIT/FBTC/GBTC…) est un signal en soi.
- VÉRIFIER EN RÉEL d'abord (curl) ce que l'endpoint SoSoValue déjà branché
  expose par émetteur (ou un endpoint voisin du même host whitelisté). AUCUN
  nouveau host hors whitelist, aucune clé nouvelle, pas de scraping.
- Si la donnée par émetteur existe : tableau par émetteur (flux du jour, flux
  cumulé, encours si dispo) dans la section ETF de CHAIN (OnchainWindow),
  dégradation gracieuse, cache TTL aligné sur l'existant.
- Si AUCUNE source whitelistée ne l'expose : NE PAS forcer — rapport
  documentant ce qui a été testé (endpoints, réponses), et l'item reste au
  backlog avec ce constat.

## Hors lot (traité par l'orchestrateur)
- Purge des branches locales mergées + `origin/feat/graphes-uniformisation`.
- CI minimale : GitHub Action `pnpm check` sur push.

## Reste au backlog après ce lot (décision documentée)
- EXPY import auto portfolio/backtest (v1.6 : saisie manuelle assumée).
- CVD spot agrégé multi-exchange (feature lourde, non priorisée).
- Gate G100 : checklist manuelle G1-G10 — nécessite un œil humain.
