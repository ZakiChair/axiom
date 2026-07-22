# Screener de signaux (« inbox de setups ») — design (2026-07-23)

## Problème

Le terminal collecte tout (funding, OI, L/S, klines, référentiels) mais la synthèse
reste manuelle : il faut ouvrir chaque paire pour voir si un setup s'y forme. EQS
filtre des métriques brutes (`volume > X`), pas des *lectures*. Suite naturelle du
Lot B (lectures interprétées) : le terminal détecte et nomme les setups.

## Décisions

- **Vue « Signaux » DANS la fenêtre EQS** (Segmente `Filtres | Signaux` en tête) —
  pas de nouvelle fenêtre : même univers, mêmes actions (ouvrir dans le chart,
  + watchlist), le menu Fonctions/Toolbar reste inchangé.
- **Échantillon honnête** : top 20 liquides à perp (funding présent) ∪ watchlist
  Binance ∩ univers, plafonné à 28. Pas de prétention à screener 1000 symboles :
  chaque symbole coûte ~4 requêtes (OI hist, funding hist, L/S ×2, klines).
- **4 détecteurs v1**, tous PURS dans `data/signaux.ts` (TDD), chacun avec un
  **label de fiabilité** (règle d'or doc 02 — jamais présenter une heuristique
  comme un fait) :
  1. **Quadrant OI × Prix** (doc 02 B1) — Δprix 24 h (ticker) × ΔOI ~24 h
     (futures/data 1h×25) : build-up long/short, short squeeze, dé-leveraging.
     Seuils |Δprix| ≥ 2 %, |ΔOI| ≥ 3 %. Poids 1, « échantillonné ».
  2. **Funding extrême** (doc 02 B2, z-score TEMPOREL) — z du dernier funding réglé
     vs fenêtre 60 points de `histFunding` (270 pts ~90 j, cache TTL 1 h déjà en
     place). |z| ≥ 2 → lecture CONTRARIAN (funding très positif = longs crowded =
     baissier). Poids 2, « fiable » (donnée exacte réglée).
  3. **Divergence RSI/prix** — pivots (k=3) sur les 60 dernières bougies 4 h :
     prix plus-haut ↗ + RSI plus-haut ↘ = baissière (et symétrique). RSI via
     `computeIndicator` de @axiom/indicators (source unique). Poids 2,
     « heuristique ».
  4. **Positionnement divergent** — top traders (positions) vs foule (comptes) :
     ratio des ratios ≥ 1.25 ou ≤ 0.8 → les gros comptes sont à contre-courant.
     Poids 1, « bruité » (limites B6).
- **Confluence** : score = Σ poids des signaux ; direction agrégée = signe de la
  somme signée (haussier +poids / baissier −poids), « mixte » si 0. Tri score desc.
  Seules les lignes à ≥ 1 signal apparaissent (inbox, pas une table exhaustive).
- **Exclusions v1 assumées** : divergence CVD spot/perp (exige 2 flux WS live par
  symbole — infaisable en batch honnête) ; volume anomal (pas d'historique bulk).
- **Exécution thread principal** via `mapPool` (concurrence 4) : ~25 symboles ×
  4 requêtes, calculs triviaux — le worker (conçu pour 60 × klines + indicateurs
  multiples) serait de la sur-ingénierie ici.
- **Commande palette `SIG`** (« Signaux — scan de setups ») : ouvre EQS en vue
  signaux. Source greffée `store/signaux.ts`, enregistrée dans App.tsx et couverte
  par le test d'unicité (SOURCES_GREFFEES).

## Extension (même jour) — Validation historique (event study)

Mesurer l'edge réel des signaux au lieu de citer le doc 02 :

- **Méthode : event study, PAS le moteur @axiom/backtest** — les détecteurs (pivots,
  z-score sur série auxiliaire) ne s'expriment pas dans le modèle
  comparaison/croisement du moteur, et surtout un backtest exécutable (sorties, stop,
  sizing, frais) mesurerait la stratégie, pas le signal. On mesure : rendements
  forward à horizon fixe (24 h / 72 h) après chaque déclenchement historique, signés
  par la direction du signal, vs référence inconditionnelle (drift du sous-jacent
  signé par le même mix de directions).
- **Périmètre = les deux signaux de poids 2** : funding extrême (fundingRate
  `limit=1000` ≈ 333 j, ~1000 règlements) et divergence RSI (klines 4 h ×1000 ≈
  166 j). Quadrant et positionnement NON validables (OI/L-S gratuits limités à
  ~20-30 j → trop peu d'événements) — affiché honnêtement dans l'UI.
- **Anti-double-comptage** : funding = hystérésis (un franchissement de seuil = UN
  événement, réarmé quand |z| repasse sous le seuil) ; divergence = détection
  incrémentale barre par barre, dédoublonnée par (direction, pivot final).
- **Pas de look-ahead** : une divergence est datée de la barre où elle devient
  détectable (pivot final + k bougies de confirmation), pas du pivot.
- Agrégation sur l'échantillon du run (sommes poolées par type de signal), UI dans
  la vue Signaux (« Valider sur l'historique »), note : période couverte, sans
  frais/slippage, event study ≠ stratégie exécutable.

## Vérification

- TDD sur `data/signaux.ts` (détecteurs, pivots, confluence, sélection échantillon).
- `pnpm typecheck` + suite web complète + build.
- Gate visuel : vue Signaux en Dark (run réel), badges/directions lisibles.
