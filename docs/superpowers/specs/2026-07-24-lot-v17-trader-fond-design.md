# Lot v1.7 — Outil complet trader/fond : risque de portefeuille, paper trading, brief/breadth, reporting (design)

Date : 2026-07-24 · Statut : périmètre validé par Zaki (AskUser — tout sélectionné, objectif « outil complet pour un trader ou un fond »). Quatre branches ; la 4 (reporting) s'exécute APRÈS merge de la 1 (elle consomme la VaR portefeuille).

## 1. Risque de portefeuille (`feat/port-risque`)

**But** : le trou n°1 côté fond — passer de « liste de positions avec PnL » à une vue de RISQUE consolidée.

- **Données** : pour chaque position OUVERTE, klines 1d ~90 j via `binanceAdapter.fetchKlines(symbol, "1d", {limit: 90})` (symboles non-Binance/TradFi : exclus du calcul de risque avec note honnête « N positions hors calcul » — v1 crypto-Binance). Cache mémoire TTL 1 h par symbole.
- **Calculs purs** (`data/portRisque.ts`, TDD) :
  - Poids $ signés : `w_i = ±taille_i × prixCourant_i` (short négatif), normalisés par l'équity brute Σ|w|.
  - Série des rendements quotidiens du PORTEFEUILLE : `r_p,t = Σ (w_i/Σ|w|) × r_i,t` sur l'intersection des dates (positions constantes rétro-projetées — approximation ASSUMÉE et affichée « composition actuelle appliquée à l'historique »).
  - **VaR hist 95/99 1 j** (quantiles empiriques, convention type-7 du repo) + CVaR95, en % ET en $ (× équity brute). ≥ 30 jours communs requis sinon « historique insuffisant ».
  - **Contributions au risque** : décomposition de variance — `ctr_i = w̃_i × cov(r_i, r_p) / var(r_p)` (Σ ctr = 1), affichée en % par position (négatif = hedge, à teinter).
  - **Bêtas vs BTC** (90 j, cov/var sur rendements log) + **stress grid** : scénarios BTC {−20, −10, +10, +20 %} → impact $ = Σ w_i × β_i × choc (approximation linéaire assumée).
  - **Courbe d'équity 90 j** : Σ taille_i × prix_i,t (+ cash si le store en tient un — sinon somme des valeurs, consigné).
- **UI** : section « Risque » dans PortfolioWindow (repliable, calcul au dépliage + bouton Rafraîchir) : badges VaR95/99 1 j ($ et %), CVaR95 ; tableau contributions (position, poids %, β, ctr % teintée) ; grid stress 4 scénarios ($ teintés) ; canvas courbe équity 90 j (patron canvas du repo). Note honnête sur les 3 approximations (composition constante, linéarité β, crypto-Binance seulement).
- 0 position ouverte → section masquée. 1 seule position → VaR = celle de l'actif (cas dégénéré valide).

## 2. Paper trading (`feat/paper-trading`)

**But** : le trou n°1 côté trader — exécuter sa discipline sans risque, avec journalisation automatique.

- **Modèle** (`data/paper.ts`, purs TDD) : `OrdrePaper { id, symbol, direction, type: "market"|"limit"|"stop", prixLimite?, prixStop?, taille, tp?, sl?, creeTs }` ; `PositionPaper { id, symbol, direction, taille, prixEntree (moyen), tp?, sl?, ouvertTs }` ; solde fictif (défaut 100 000 $, configurable), frais taker 0.05 %/côté (constante documentée), slippage 0 (assumé).
- **Moteur** (`store/paper.ts` + évaluateur pur) : abonnement `subscribeTickers` (data/ticker.ts) sur l'union des symboles des ordres+positions actifs (résilié quand vide). À chaque tick :
  - market → rempli immédiatement au dernier prix ; limit → rempli si le prix TRAVERSE (achat : last ≤ limite ; vente : last ≥ limite) ; stop → devient market si traversé.
  - TP/SL des positions : clôture au niveau touché (au PRIX DU NIVEAU, pas au last — convention honnête documentée : pas de gap-modeling v1).
  - Évaluation PURE `evaluerTick(etat, symbol, last) → { etat', executions[] }` — testée exhaustivement (traversées, TP et SL touchés dans le même tick → SL prioritaire documenté, moyennage d'entrée sur renforcement).
  - Clôture (TP/SL/manuelle) → **écrit automatiquement un TradeJournal dans expyStore** (tag `"paper"`, stopInitial = SL de l'ordre s'il existait sinon prix d'entrée — R null documenté, note = raison de clôture) + PnL réalisé imputé au solde.
- **UI fenêtre `PAPER`** (id `paper`, mnémonique `PAPER`, nouvelle fenêtre) : en-tête solde/équity (solde + PnL latent) + PnL jour ; formulaire d'ordre (symbole prérempli du chart, type, taille en $ convertie en unités au prix courant, TP/SL optionnels) ; tableau ordres en attente (annulables ✕) ; tableau positions (PnL latent live teinté, boutons TP/SL édition légère + « Clôturer ») ; historique bref des 10 dernières exécutions. Persistance `axiom:paper:v1` (ordres+positions+solde) ; le moteur reprend au reload (ré-abonnement).
- Pas d'overlay chart v1 (lignes d'ordres sur le chart = backlog explicite). Pas de marge/levier v1 : taille notionnelle simple, solde peut devenir négatif sur short (assumé, mono-utilisateur).

## 3. Brief enrichi + breadth (`feat/brief-breadth`)

**But** : BRIEF = vrai morning brief ; le régime de marché en un coup d'œil.

- **Breadth pur** (`data/breadth.ts`, TDD sur calculs) : univers = top 50 USDT par volume (ticker 24h, réutilise parseTicker24h) ; klines 1d ×50 (limit 210) via mapPool concurrence 6 ; calcul par symbole : au-dessus MM50 ? MM200 ? ; agrégats : % > MM50, % > MM200, A/D du jour (hausses/baisses du ticker 24h, univers complet), % au-dessus à J-7 pour la tendance. Cache 12 h (localStorage, patron onchain).
- **BRIEF nouvelles sections** (best-effort chacune, patron Section<T> existant) :
  - « Régime » : % > MM50 / % > MM200 (jauges), A/D jour, delta 7 j.
  - « Squeeze » : top 3 carburant-squeeze par score (réutilise le run squeeze — fetch léger identique au SQZ, PAS de dépendance à la fenêtre ouverte).
  - « Funding extrêmes » : top 3 |funding| > 0.03 %/8 h (premiumIndex, chemin screener).
  - « COT (semaine) » : 3 lignes max depuis le cache cot legacy (delta hebdo le plus marqué) — cache SEULEMENT, pas de fetch dédié (si cache vide → section absente).
  - « VaR chart » : VaR95 20b du chart maître (réutilise distVar sur les candles chargées).
- Chaque section a sa fraîcheur ; l'ordre du BRIEF : Régime, Watchlist, Squeeze, Funding, Dérivés, ETF, VaR, COT, Éco, News, F&G, DVOL (ajuster à l'existant sans tout réordonner — les nouvelles s'insèrent logiquement, décision fine au plan).

## 4. Reporting fond (`feat/reporting`, APRÈS merge de 1)

**But** : le document qu'un fond produit — en un clic.

- **Générateur pur** (`data/rapport.ts`, TDD sur l'assemblage) : `genererRapportHtml(donnees, periode: "7j"|"30j", nowMs) → string` — HTML AUTONOME (styles inline sobres, imprimable en PDF navigateur, aucun asset externe) : en-tête (période, généré le) ; Portefeuille (positions ouvertes, PnL latent/réalisé période, exposition L/S, VaR95/99 + CVaR si calculées — section conditionnelle sinon « non calculé ») ; Journal (trades EXPY clos de la période : n, expectancy, win rate, PF, meilleurs/pires, tableau) ; Paper (si des clôtures paper dans la période — section conditionnelle) ; pied honnête (sources, approximations).
- **Collecte** (`donneesRapport()`) : lit les stores existants (portfolio + portRisque si dispo + expy + paper) — zéro fetch nouveau ; les prix courants viennent de ce que PORT affiche déjà.
- **UI** : bouton « 📄 Rapport » dans PortfolioWindow (choix 7 j / 30 j) → télécharge `axiom-rapport-YYYY-MM-DD.html`. + commande palette « rapport ».

## Contraintes globales

Français ; TDD sur toute logique pure (évaluateur paper EXHAUSTIF — c'est le morceau à risque) ; tokens ; paddings partagés ; dégradation gracieuse ; zéro nouvelle source externe (tout passe par les chemins existants) ; `git -C` ; gates habituels + gate visuel par livrable (paper : scénario complet limit→fill→TP→journal EXPY vérifié). Registre fenêtres 30 → 31 (PAPER seule nouvelle fenêtre). Ordre : branches 1/2/3 parallèles, 4 après merge de 1 ; merges étalés pour les greffes.
