# Lot v1.4 (suite) — NETLIQ, Monte-Carlo backtest, COT Disaggregated (design)

Date : 2026-07-23 · Statut : périmètre validé par Zaki (AskUser), spec à relire. Trois branches indépendantes.

## 1. NETLIQ — Liquidité nette Fed (`feat/netliq`)

**But** : la série macro « net liquidity » = bilan Fed − compte du Trésor − reverse repo, corrélée aux actifs risqués — item de la roadmap du 22/07.

- **Données** : 3 séries FRED via le proxy daemon EXISTANT (le fetch macro M2 passe déjà par `/extapi` FRED — réutiliser exactement ce chemin/parseur) : `WALCL` (bilan Fed, hebdo), `WTREGEN` (TGA, quotidien), `RRPONTSYD` (RRP, quotidien). ⚠️ Les ids exacts et la forme de réponse sont à VÉRIFIER contre le fetch M2 existant à la première tâche (le plan ne doit pas inventer de format).
- **Calcul pur** `serieNetliq(walcl, tga, rrp)` : alignement par date (forward-fill de WALCL hebdo sur les jours — c'est un NIVEAU, LOCF légitime), netliq = walcl − tga − rrp (tout en $ milliards, normaliser les unités FRED qui diffèrent par série — à vérifier), fenêtre 2 ans.
- **Fenêtre** `id:"netliq"`, mnémonique `NETLIQ`, patron standard (registre + lazy + windowPanels). Rendu : courbe 2 ans (canvas patron des fenêtres macro existantes), delta 4 semaines en en-tête (badge up/down), min/max 2 ans en repères discrets, `NoteSource` FRED + fraîcheur. Refresh manuel + chargement à l'ouverture, cache TTL 12 h (données quotidiennes).
- Cas limites : une des 3 séries en échec → message d'erreur SANS masquer une courbe déjà chargée (patron SQZ) ; trous de dates → LOCF depuis la dernière valeur connue de chaque jambe.

## 2. MC-BT — Monte-Carlo sur le backtest (`feat/mc-bt`)

**But** : transformer la liste de trades du backtest existant (fenêtre BT) en distribution probabiliste — « ce backtest tient-il si l'ordre des trades avait été différent ? ».

- **Données** : AUCUNE nouvelle — la fenêtre BT produit déjà la liste des trades (PnL par trade) et l'equity curve. Première tâche : localiser la forme exacte (store backtest) et l'exposer proprement si besoin.
- **Calcul pur** (`packages/backtest` ou `apps/web/src/data/` selon où vit la logique BT — suivre l'existant) : `monteCarloTrades(pnls, nChemins, rng)` → rééchantillonnage AVEC remise des PnL par trade, `nChemins` (défaut 500, max 2000) chemins d'equity ; sorties : percentiles d'equity finale (p5/p25/p50/p75/p95), distribution du max drawdown (p50/p95), probabilité d'equity finale < 0. **`rng` INJECTÉ** (générateur seedable type mulberry32, seed paramétrable défaut 42) — jamais `Math.random()` dans la logique testée (convention repo, et les tests deviennent déterministes).
- **UI** : nouvel onglet/section dans la fenêtre BT existante (PAS de nouvelle fenêtre ni mnémonique — c'est une analyse du backtest courant) : bouton « Monte-Carlo (500) », cône des percentiles d'equity superposable au tracé existant (réutiliser le canvas equity ou un pane sous), tableau compact des stats (drawdown p95, prob. ruine, equity p5/p50/p95). Griser si < 10 trades (un MC sur 3 trades ment — seuil affiché).
- Cas limites : 0 trade → bouton désactivé ; PnL tous identiques → cône plat correct.

## 3. COT Disaggregated / TFF (`feat/cot-disaggregated`) — le 2C différé

**But** : voir QUI est positionné — Managed Money vs Commercials (matières premières) et Leveraged Funds vs Asset Managers (financiers) — au lieu du seul agrégat « non-commercial » legacy.

- **Réalité des datasets CFTC** (structurant) : le legacy couvre tout ; le **Disaggregated** ne couvre que les matières premières physiques (métaux, énergie) ; le **TFF** (Traders in Financial Futures) couvre les financiers (devises, indices, BTC/ETH). Il faut donc router PAR FAMILLE :
  - metal/energie → dataset Disaggregated : catégories `Managed Money` (net m_money) et `Producer/Merchant` (net prod_merc).
  - fx/indice/crypto → dataset TFF : catégories `Leveraged Funds` (net lev_money) et `Asset Manager` (net asset_mgr).
  - ⚠️ Les ids de dataset Socrata et les noms de champs exacts sont à VÉRIFIER live à la première tâche (requête d'exploration sur publicreporting.cftc.gov) — la spec interdit de les inventer ; les instruments de la watchlist gardent leurs `market_and_exchange_names` exacts (les vérifier par dataset, ils peuvent différer légèrement du legacy).
- **UI** : `Segmente` de catégorie en tête de fenêtre COT : `Spéculatif (legacy) | Fonds (MM/Lev) | Commerciaux (Prod/AM)` — libellés courts à affiner ; la vue actuelle (badge/sparkline/barre) est RÉUTILISÉE telle quelle, seule la série nette change. Le COT Index/percentile se recalcule sur la série de la catégorie affichée.
- **Fetch** : à l'ouverture de la catégorie seulement (lazy par dataset), cache v2 étendu par dataset (`axiom:cot:cache:v2:<dataset>`), TTL 12 h, même dégradation.
- Cas limites : instrument absent d'un dataset (ex. crypto absent du Disaggregated — attendu par construction) → ligne masquée dans cette catégorie avec note discrète « non couvert » ; ne JAMAIS mélanger les catégories de datasets différents dans une même barre.

## Contraintes globales

Français ; TDD sur logique pure ; tokens ; dégradation gracieuse ; `git -C` ; vérifications live (FRED, Socrata) documentées en première tâche de chaque plan plutôt qu'inventées en spec ; gates habituels + gate visuel par fenêtre.
