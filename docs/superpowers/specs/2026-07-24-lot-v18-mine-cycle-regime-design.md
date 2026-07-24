# Lot v1.8 — MINE (coût de production), CYCLE (cycle 4 ans), alerte régime

Date : 2026-07-24 · Registre : 31 → 33 · Origine : revue globale du 2026-07-24
(dossier marché : le coût de production est l'angle mort n°1 du terminal ; les
briques cycle existent mais sont dispersées ; le score de régime n'est pas alertable).

Trois livrables indépendants, un implémenteur chacun, branches séparées :
`feat/mine-cout-production`, `feat/cycle-4-ans`, `feat/alerte-regime`.
Conflits attendus entre MINE et CYCLE sur `windowManager.ts` / `App.tsx` /
`windowPanels.ts` : merges séquentiels, résolution triviale (1 ligne chacun).

Invariants du BUILD-CONTRACT à respecter : calculs PURS séparés de l'I/O,
dégradation gracieuse (cache TTL + `perime`), aucune nouvelle clé API, aucun
nouveau host hors whitelist (mempool.space et Coin Metrics community sont CORS
ouverts → appels DIRECTS, pas de proxy), commentaires en français, notes
d'honnêteté affichées quand le chiffre est un modèle et pas une mesure.

---

## 1. MINE — Coût de production & économie minière

Fenêtre `{ id: "mine", title: "Coût de production (minage)", mnemonic: "MINE",
defaultWidth: 640, defaultHeight: 560, nouveau: true }`.

### Données (toutes existantes ou gratuites, en direct)
- **Hashrate + difficulté 1 an** : `GET mempool.space/api/v1/mining/hashrate/1y`
  — la réponse contient AUSSI un tableau `difficulty: [{ time|timestamp, difficulty }]`
  à côté de `hashrates` (vérifier la clé exacte en réel et coder le parseur
  tolérant). Étendre `data/onchain/mempool.ts` : `parseHashrateDifficulte(json)`
  → `{ hashrate: SerieMetrique; difficulte: SerieMetrique }`, même cache 6 h.
  Ne PAS casser `parseHashrate` existant (CHAIN le consomme).
- **Ajustement de difficulté courant** : `GET mempool.space/api/v1/difficulty-adjustment`
  → `{ progressPercent, difficultyChange, estimatedRetargetDate, remainingBlocks, … }`.
  Nouveau fetch dans `mempool.ts`, TTL 5 min, même pattern `ResultatFrais`.
- **Subsidy courant** : dérivé de la hauteur via `computeHalving` déjà présent
  (récompense AVANT le prochain halving = `recompenseApres × 2`).
- **Frais moyens par bloc** : Coin Metrics `FeeTotNtv` (BTC/jour, déjà fetché
  par CHAIN) ÷ 144. Si indisponible → 0 avec mention « hors frais ».
- **Prix BTC** : ticker Binance spot existant (BTCUSDT).

### Calculs purs (`apps/web/src/data/mine.ts` + `mine.test.ts`)
Paramètres réglables (persistés `axiom:mine:v1`, défauts affichés comme tels) :
`efficaciteJParTh = 22` (J/TH — AMENDÉ au merge : la version initiale disait 30,
incohérent avec ses propres repères ; 22 suit l'efficacité effective de parc
impliquée par Capriole ~21,5), `prixKwhUsd = 0.045`,
`multiplicateurAllIn = 1.25` (Capriole mars 2026 : 58 032 / 46 426 ≈ 1,25).

- `emissionBtcParJour(subsidyBtc)` = `144 × subsidyBtc` (post-halving 2024 : 450).
- `coutElectriqueParBtc(hashrateHs, effJParTh, prixKwh, emissionJour)` :
  puissance W = `(hashrateHs / 1e12) × effJParTh` ; énergie kWh/j = `W × 24 / 1000` ;
  coût = `énergie × prixKwh / emissionJour`.
- `coutAllInParBtc = coutElectrique × multiplicateurAllIn`.
- `hashpriceUsdParPhJour(prixBtc, subsidyBtc, feesBtcParBloc, hashrateHs)` =
  `144 × (subsidy + fees) × prixBtc / (hashrateHs / 1e15)`.
- `ratioPrixCout(prixBtc, cout)` = prix / coût (NaN-safe).
Chaque fonction : NaN-safe (entrées non finies → NaN, l'UI affiche « — »),
testée sur des valeurs de référence réalistes (AMENDÉ au merge : 900 EH/s,
22 J/TH, 0,045 $/kWh, 450 BTC/j → 47 520 $/BTC électrique, cohérent avec le
repère Capriole 46,4 k$ ; à 30 J/TH la même formule donne 64 800 $ — le
« ~48,6 k$ » initial était un lapsus arithmétique).

### UI (`components/MineWindow.tsx`)
- Bandeau : prix spot vs **plancher électrique** vs **coût all-in** — barre
  horizontale positionnant le prix entre les deux niveaux, ratios affichés.
- Tuiles : hashprice ($/PH/j), difficulté courante + prochain ajustement estimé
  (% et date), hashrate courant (EH/s) + variation vs pic 1 an.
- Sparklines 1 an : hashrate et difficulté (pattern sparkline existant de CHAIN).
- Panneau paramètres (efficacité, $/kWh, multiplicateur) avec reset défauts.
- Note d'honnêteté visible : « modèle paramétrique (parc moyen supposé), pas une
  mesure ; repères externes mars 2026 : Capriole élec 46,4 k$ / all-in 58 k$ ».
- Store `store/mine.ts` (pattern `*UiStore` + `mirrorOpenState`), commande
  palette MINE dans `commands/windowPanels.ts`, entrée `WINDOW_COMPONENTS`.

---

## 2. CYCLE — Position dans le cycle de 4 ans

Fenêtre `{ id: "cycle", title: "Cycle 4 ans (halving)", mnemonic: "CYCLE",
defaultWidth: 760, defaultHeight: 600, nouveau: true }`.

### Données
- **Prix BTC daily complet** : Coin Metrics community `PriceUSD`,
  `start_time=2010-07-01`, `frequency=1d`, `page_size=10000` (l'historique fait
  ~5 850 points ; si la pagination community plafonne, suivre `next_page_url`).
  Nouveau fetch dédié dans `data/onchain/coinmetrics.ts` (clé cache
  `cm:priceusd:full`, TTL 24 h) — ne pas alourdir le fetch CHAIN existant.
- **Halving countdown** : réutiliser `fetchMempoolReseau` (`computeHalving`).
- **MVRV-Z** : réutiliser la métrique bgeometrics déjà câblée si disponible
  (repli : ratio `CapMVRVCur` Coin Metrics avec libellé « MVRV (ratio) »).

### Calculs purs (`apps/web/src/data/cycle.ts` + `cycle.test.ts`)
Constantes : halvings `2012-11-28`, `2016-07-09`, `2020-05-11`, `2024-04-20`
(UTC). Types :
- `decouperCycles(points)` → pour chaque halving, série
  `{ jour: number; indice: number }` où `indice = prix / prixAuJourDuHalving`
  (jour 0 = halving, fenêtre 0..1500 j ; cycle courant tronqué à aujourd'hui).
- `statsCycle(serie)` → `{ topIndice, topJour, drawdownDepuisTopPct,
  indiceCourant, jourCourant }`.
- `mayerMultiple(points)` → dernier prix / MM200 (null si < 200 points).
Tests : jeu synthétique (prix connus aux dates de halving) + invariants
(indice jour 0 = 1 ; top du cycle 3 ≈ jour 549 sur données réelles simplifiées).

### UI (`components/CycleWindow.tsx`)
- Chart principal : superposition des 4 cycles alignés jour-0 = halving,
  **échelle log** sur l'indice, couleurs `COMPARE_PALETTE`, cycle courant en
  trait épais + marqueur au jour courant (~825 j). Suivre le pattern de rendu
  courbes existant (cf. fenêtre NETLIQ/CBPREM) — pas de nouvelle lib.
- Tableau par cycle : halving, top (date, ×multiple, jours post-halving),
  drawdown top→bottom (bottoms historiques constants documentés), état courant.
- Tuiles : jours depuis halving 2024, drawdown courant vs ATH du cycle,
  Mayer Multiple, MVRV(-Z), compte à rebours prochain halving.
- Note : « les cycles passés ne préjugent pas du courant ; tops historiques
  368/525/549/481 j post-halving ».
- Store `store/cycle.ts`, commande palette CYCLE, entrée `WINDOW_COMPONENTS`.

---

## 3. Alerte `regime-seuil`

Le score de régime (−2..+2, `data/regime.ts`) est visible (BRIEF, SessionStrip)
mais ne déclenche rien. Ajouter une condition d'alerte GLOBALE :

- `packages/alerts/src/types.ts` :
  `interface ConditionRegimeSeuil { type: "regime-seuil"; comparateur: Comparateur;
  valeur: number }` ajoutée à l'union `Condition` ; contexte :
  `regimeScore?: number` (+ doc : injecté par le runtime front ; le daemon ne
  l'évalue pas en v1 — il ne calcule pas le score).
- `engine.ts` : évaluation seuil avec l'armement standard (calibration à la
  première passe, ré-armement au re-franchissement inverse) ; `decrireCondition`
  → « régime ≤ −1.2 » etc. Tests moteur : franchissement, ré-armement,
  contexte sans `regimeScore` → non évaluable (pas de déclenchement).
- Runtime front : injecter le score courant du store régime dans le contexte
  d'évaluation (suivre le câblage existant de `fundingZScore` /
  `cvdDivergenceKind`). La condition est indépendante du symbole de la def
  (convention : def sur BTCUSDT/binance comme porteur neutre).
- UI alertes : le formulaire propose « Score de régime » avec comparateur +
  valeur (pas de presets nouveaux en v1).

---

## Gates par livrable
- `pnpm check` vert (typecheck + tests + build web) sur chaque branche.
- MINE : ordre de grandeur du coût électrique vérifié en test vs repère Capriole.
- CYCLE : chart visuel avec 4 cycles + marqueur courant (gate visuel manuel).
- Régime : test moteur de bout en bout (déclenchement + ré-armement).
