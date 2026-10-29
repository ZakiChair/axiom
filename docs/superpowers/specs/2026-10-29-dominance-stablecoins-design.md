# Dominance des stablecoins (USDT + USDC + DAI) — série chartable `STABLE.D`

Date : 2026-10-29 · Origine : demande du propriétaire (« ajoute la courbe de l'USDT+USDC+DAI
dominance afin de voir la dominance des stablecoins sur le marché »).
Cartographie préalable (5 lecteurs, lecture seule) : routage, couche CoinMarketCap et mesures
réelles, interface, budget d'entrée, conventions de tests.

Invariants : aucune dépendance ; TypeScript strict (`noUncheckedIndexedAccess`) ; commentaires
en français ; **aucune fenêtre, aucun indicateur, aucun fournisseur, aucun hôte, aucune règle de
proxy** ; `@axiom/types` inchangé ; TOTAL/TOTAL2/TOTAL3 strictement inchangés (valeurs, requêtes,
cache, provenance) ; aucune donnée haute fréquence dans le state React.

---

## 0. Décisions

| Sujet | Décision | Raison |
| --- | --- | --- |
| Surface | Série **autonome chartable** sur le graphe principal, comme TOTAL/TOTAL2/TOTAL3 | Équivalent de `USDT.D+USDC.D+DAI.D` sur TradingView : analyse technique, indicateurs, grille synchronisée avec BTC |
| Identifiant | **`STABLE.D`** | 8 caractères (tient dans le bandeau mobile, tronqué à 28 %) ; ne finit pas par une devise de cotation (`splitSymbol` découperait `…DAI`) ; le point est sûr parce que le prédicat de capitalisation est testé AVANT la règle « `.` = TradFi » (`pairs.ts:281`) ; `USDT.D` désigne USDT seul sur TradingView |
| Libellé | « Dominance stablecoins (USDT+USDC+DAI) » | La composition est explicite : la série ne couvre PAS tous les stablecoins |
| Alias de recherche | `USDT.D+USDC.D+DAI.D`, `STABLE`, `STABLES`, `STABLECOINS`, `DOMINANCE` | La sous-chaîne `USDT.D`, `USDC.D`, `DAI.D` trouve l'alias composite |
| Valeur | `100 × (cap USDT + cap USDC + cap DAI) / TOTAL`, en % | Égale à la somme des trois dominances CMC |
| Source | CoinMarketCap public `data-api` via `/extapi` (exception « fournisseurs de capitalisation » du 2026-09-01) | Même fournisseur que TOTAL : méthode cohérente au numérateur et au dénominateur ; hôte déjà autorisé sans liste de chemins |
| Repli | **Aucun** : erreur explicite | CCData et l'échantillonnage CoinGecko local n'ont pas les capitalisations par stablecoin ; mélanger les fournisseurs fausserait le niveau |
| Unités de temps | Celles de TOTAL : 1h, 4h, 1d, 1w, 1M, 3M, 6M, 12M | Le global CMC et les pièces existent en 1h (vérifié jusqu'en 2019) |

## 1. Mesures réelles (29/10/2026, 09:41–09:49 UTC, 15 requêtes sans clé)

- `data-api/v3.3/cryptocurrency/detail/chart?id=<id>&timeStart=<s>&timeEnd=<s>&interval=1d|1h` :
  points `{ s: "<secondes>", v: [prix, volume 24 h, capitalisation] }`, alignés sur 00:00:00Z (1d)
  ou HH:00 (1h). Jusqu'à 12 000 points par réponse (lots de 10 000 retenus, comme ETH).
  `interval=4h` renvoie du **journalier** : en 4h, les pièces se lisent en 1h. Le multi-id
  (`id=825,3408,4943`) est refusé : trois appels.
- `data-api/v3/global-metrics/quotes/historical` : aligné de même ; `error_code 500 « Too many
  items requested. Limit is 2200 »` au-delà de 2 200 points (lots existants). Aucun champ
  stablecoin.
- Premiers points : USDT (825) le **2015-02-25** ; USDC (3408) le **2018-10-08** (capitalisation
  > 0 dès le 16/10) ; DAI (4943) le **2019-11-22** (capitalisation nulle jusqu'au 2020-01-21).
- Dernière barre : le global publie le bucket courant avant la pièce (global 1h à 09:00, USDT à
  08:00) → un report d'un pas est nécessaire, jamais un 0.
- Ordre de grandeur : 9,24 % à 9,62 % du 19 au 28/10/2026 (9,5127 % le 28/10 avec l'appariement
  initial, 9,5326 % après le §9.1) ; 1,27 % le
  01/06/2019. USDT 181,6 G$, USDC 71,2 G$, DAI 4,56 G$ au 28/10/2026.

## 2. Calcul — fonctions pures, testées

1. **Contribution d'une pièce à l'instant `t`** :
   - `t` < lancement de la pièce (constantes `LANCEMENTS_STABLECOINS_CMC`, §1) → **0** (valeur
     exacte avant cotation, même doctrine que `alignerSurGrille` et `LANCEMENT_ETH`) ;
   - sinon, dernier point de la pièce `≤ t` (report), **si son âge ≤ tolérance** (2 pas de la
     série de la pièce : 2 jours en 1d, 2 heures en 1h) ;
   - sinon **inconnue** → aucune dominance à `t` (ni 0 inventé, ni report illimité).
   Une capitalisation publiée à 0 après le lancement (USDC la première semaine, DAI jusqu'au
   2020-01-21) est une donnée CMC, prise telle quelle.
2. **Dominance à `t`** pour chaque point global `{t, total}` : `100 × Σ contributions / total`.
   Aucun point si `total` n'est pas fini ou ≤ 0, si une contribution est inconnue, ou si la
   somme vaut 0 (avant USDT : la série commence le 2015-02-25).
3. **Bougies** : agrégation OHLC identique à TOTAL (`debutBucketCapitalisation`, open = clôture
   précédente, haut/bas sur les points du bucket, volume 0, `closed` selon la fin du bucket).
   `construireBougiesCapitalisation` est généralisée en un constructeur depuis une série
   `{t, v}` ; TOTAL passe par la projection de sa mesure, comportement inchangé.

## 3. Données, cache et chargement

- **Module paresseux** `apps/web/src/data/dominanceStablecoins.ts`, chargé par un `import()`
  mémorisé depuis `mcapCandles.ts` (mémoïsation remise à zéro si le chunk est introuvable, par
  exemple après un redéploiement) et inscrit dans `MODULES_DIFFERES`
  (`src/chargementInitial.test.ts`). Restent statiques dans `data/mcap.ts` : identifiant,
  prédicats, libellé et alias. Un seul import de VALEUR du module paresseux depuis un module
  initial le ramènerait dans le chunk d'entrée sans erreur de build.
- **Couplage interdit avec TOTAL** : aucune pièce stable dans le `Promise.all` de
  `fetchHistoriqueCmc` ; le cache `axiom:mcap:cmc-public:v1`, la forme `McapSnapshot` et la clé de
  déduplication de `fetchPageHistoriqueCmc` sont inchangés. `cmcMcap.ts` peut seulement EXPORTER
  ses aides existantes (requête JSON CMC avec contrôle d'`error_code`, découpage en lots,
  alignement, normalisation d'une série `detail/chart`) et extraire le chargement du global en
  une fonction exportée réutilisée par `fetchHistoriqueCmc` — mêmes requêtes, mêmes comptes
  d'appels dans les tests.
- **Journalier (1d et au-delà)** :
  - dénominateur : `chargerHistoriqueCmc()` existant (cache 12 h, inchangé) ; `null` → erreur ;
  - numérateur : trois séries journalières, cache localStorage **séparé**
    `axiom:mcap:cmc-stables:v1`, compact (par pièce : premier jour + tableau de capitalisations
    arrondies au dollar, `null` pour un jour absent), lecture tolérante (absent, corrompu,
    version inconnue → vide), écriture best-effort ;
  - TTL 12 h ; rafraîchissement incrémental depuis `min(maintenant − 45 j, fin du cache − 1 j)`
    (même règle anti-trou que `cmcMcap.ts`), fusion par jour ;
  - une pièce en échec fait échouer le rafraîchissement : cache existant servi s'il existe,
    sinon erreur. Une pièce qui ne renvoie aucun point sur une fenêtre postérieure à son
    lancement est un échec (pas de sous-comptage silencieux).
- **Intrajournalier (1h, 4h)**, par page (`endTime`, `limit`) : global à l'intervalle du graphe
  (fonction extraite ci-dessus) ; trois pièces en 1h sur `[début − 2 h, fin]` (amorce du report
  sur la première barre), en parallèle, lots séquentiels de 10 000 points ; pas de cache
  persistant (comme TOTAL intraday) ; pages en vol dédoublonnées par une clé propre à la
  dominance.
- **Repoll de la bougie courante** (`subscribeKline`) : cadence de TOTAL (5 min en 1h/4h,
  15 min sinon) ; page courte (global + 3 pièces) ; n'émet que si la bougie du bucket courant
  existe et a changé ; pas de mode dégradé `macroHistory` ; désabonnement sûr même s'il arrive
  avant le chargement du chunk (aucun minuteur orphelin).
- **Provenance** : publiée dans `sourcesCapitalisationStore` sous `STABLE.D:<tf>`, uniquement
  `"cmc"` → « CoinMarketCap · daily / 1h / 4h » au bandeau.
- **Erreur** : message explicite en français (« Dominance stablecoins indisponible :
  CoinMarketCap public ne répond pas — aucun repli, ni CCData ni CoinGecko ne publient ces
  capitalisations »).
- **Pagination du graphe** : pages de 1 000 bougies pour `STABLE.D` en 1h/4h
  (`PAGINATION_MCAP_RATIO_LIMIT`), 10 000 au-delà (comme TOTAL, servi du cache).

## 4. Routage

- `SYMBOLES_CAPITALISATION` est élargi à `STABLE.D` : les 18 sites de routage (adaptateur
  autonome, unités de temps, 1d par défaut, catalogue, persistance, slots, watchlist, bandeau,
  pagination) suivent sans code. Erreur évitée : un site oublié avec un nom à point partirait
  silencieusement vers Twelve Data.
- Prédicats dans `data/mcap.ts` : `estSymboleDominance(symbol)` (série en %) et
  `estCapitalisationUsd(symbol)` (capitalisation ET non dominance).
- **Exclusion aux 5 sites « valeur en USD »** (un % divisé par des dollars n'a pas de sens) :
  `ratio.ts` (`symboleRatioTradfi`, `symboleRatio` : aucun bouton ÷BTC/÷ETH/÷Or/÷SPY/devise),
  `synthetic.ts` (`splitLeg` refuse `mcap:STABLE.D`), `PairSearch.tsx` (`resolveLeg` du
  constructeur SYN : message « STABLE.D est une série en %, non composable »), `mcapCandles.ts`
  (`MESURE_PAR_SYMBOLE` typé sur les seuls symboles USD).

## 5. Interface

- **Bandeau** : libellé `STABLE.D`, composition en `title` (« (USDT+USDC+DAI) ÷ capitalisation
  crypto totale, en % ») ; prix et haut/bas 24 h en `formatPourcentage` (« 9.53 % ») ; « Vol »
  masqué ; provenance existante ; aucun bouton ÷.
- **Graphe** : précision prix forcée à 2 décimales (au lieu des 4 dérivées).
- **Encart de lecture** : O/H/L/C en %, Δ et amplitude en points (« +0.12 pt »).
- **Recherche** : `searchMarkets` lit libellé et alias des séries autonomes (table dans
  `data/mcap.ts`) ; colonne source « Dominance » au lieu de « Capitalisation ».
- **Panneau SYN** : préréglage « USDT+USDC+DAI dominance ». Correction du bogue existant depuis
  `bf25024` : un clic sur un préréglage autonome (TOTAL, TOTAL2, TOTAL3, STABLE.D) ouvre la série
  (`chooseSynthetic`), comme les récents ; sans cela le préréglage serait inerte.
- **⌘K** : commande « Dominance stablecoins (graphe) » (mots-clés stable.d, usdt.d, usdc.d,
  dai.d, dominance stablecoins, usdt usdc dai) qui ouvre `STABLE.D` en 1d par la navigation
  existante (toast « Annuler »).
- Pas de suffixe « % » sur l'axe : KLineChart 9.8 ne le permet que sur les graduations (le
  réticule et le dernier prix resteraient sans unité).

## 6. Tests

- Unitaires : contributions (avant lancement, report dans la tolérance, au-delà, dernière barre
  en retard), dominance (total ≤ 0, somme nulle avant USDT, valeur de référence), bougies
  (1d, 1w, open = clôture précédente) ; requêtes (ids distincts dans l'URL, erreur CMC en HTTP
  200, pièce vide → erreur, 4h → pièces en 1h) ; cache (lecture tolérante, fusion incrémentale,
  fenêtre anti-trou, échec → cache servi) ; adaptateur (aiguillage, provenance `cmc` seule, aucune
  bascule CCData/CoinGecko, TOTAL inchangé, désabonnement avant chunk) ; routage (ratios `null`,
  jambes refusées) ; recherche (alias) ; préréglage autonome ; formats du bandeau et de l'encart ;
  précision ; commande ⌘K ; module différé.
- E2E calqué sur `gate-v25-cap-dominance` : ouverture par la recherche, « % » et provenance au
  bandeau, absence de ÷BTC, bougies tracées ; simulation CMC qui **distingue l'id** dans l'URL
  (la route existante renvoie ETH pour tout id) ; assertions TOTAL3 inchangées.

## 7. Limites assumées

- Périmètre littéral : USDT + USDC + DAI (id 4943). Ni USDe, FDUSD, PYUSD, ni USDS (successeur de
  DAI chez Sky), ni SAI (le DAI d'avant novembre 2019).
- Historique depuis le 2015-02-25 : USDT seul jusqu'au 2018-10-08, puis USDC, puis DAI (en 1d,
  depuis le 2015-02-26 après le §9.1 ; en 1h, depuis le 2015-02-25 13:00).
- La clôture d'une bougie journalière est l'instantané de 00:00 UTC : exact pour le global,
  reconstitué pour les pièces (§9.1) ; le dernier point peut reporter la capitalisation d'une
  pièce publiée un pas plus tard.
- `data-api` non documentée ; aucun repli ; erreurs CMC en HTTP 200 mises en cache par les
  proxys (1 à 2 min, préexistant).
- Watchlist : comme TOTAL, pas de prix (pas de ticker synthétique). Alerte de prix : non
  vérifiée sur une source `synthetic`, non annoncée.

## 8. Budget et documentation

- Mesure Node 24.13.0 / zlib 1.3.1 avant et après (référence au départ : 1 183 987 / 354 249,
  marge gzip 5 751). Objectif : au plus ~600 octets gzip de plus sur l'entrée.
- `BUILD-CONTRACT.md` (orchestrateur) : section « Dominance des stablecoins (demande du
  29 octobre 2026) », `STABLE.D` ajouté à l'exception CMC et à la liste des synthétiques de la
  watchlist.

## 9. Amendement après la revue indépendante (29/10/2026, après-midi)

La revue (6 angles, chaque constat contre-vérifié) a établi un fait de données qui invalide la
phrase du §7 « la clôture journalière est l'instantané CMC de 00:00 UTC » pour les pièces. Les
arbitrages ci-dessous **remplacent** les passages contraires des §0 à §8.

1. **Alignement journalier (bloquant).** Le point `detail/chart` 1d d'une pièce daté D vaut
   `prix(D 00:00) × offre(D 23:00)` (mesuré : USDT et USDC 584 jours sur 584, DAI 801 sur 849,
   le reste étant de l'arrondi). Le global 1d daté D est l'instantané de D 00:00. Le numérateur
   avait donc 23 h d'avance (max 0,856 pt le 2020-03-31 ; 295 jours récents sur 499 différents
   à 2 décimales ; même instant affiché 9.51 en 1d et 9.53 en 4h).
   - Reconstitution de l'instantané de 00:00 (« V2 ») : `cap(D) = cap1d(D−1) × prix1d(D) / prix1d(D−1)`
     (offre de D−1 23:00 × prix de D 00:00). Tant que la ligne 1d de D n'est pas publiée (barre
     du jour), ou si un prix est invalide : `cap1d(D−1)` tel quel (« V1 »). `cap1d(D−1) = 0` → 0.
   - Même règle pour l'historique (1d à 12M) et pour la page du repoll 1d.
   - Lancements décalés d'un jour sur le chemin journalier : contribution 0 le jour du lancement
     (le premier point horaire CMC tombe après 00:00).
   - 1h et 4h inchangés : le point 1h d'une pièce est l'instantané de HH:00.
   - Le cache des pièces garde les données brutes, prix compris : clé
     `axiom:mcap:cmc-stables:v2`, `version: 2`, prix arrondis à 6 décimales (la v1 n'a jamais
     été déployée).
   - Résidu attendu contre la vérité horaire : médiane ≈ 0,0007 pt, max ≈ 0,10 pt ; 2020-03-31
     ≈ 3,04 % au lieu de 3,90 %.
2. **Chunk introuvable (important).** Un rejet de l'`import()` du module paresseux (redéploiement
   Vercel : l'ancien chunk n'existe plus) devient l'erreur `ErreurDominanceStablecoins` de texte
   fixe « Dominance stablecoins non chargée (réseau ou mise à jour d'AXIOM) ; rechargez la
   page. », définie dans l'entrée, jamais importée du chunk. La remise à zéro de la mémoïsation
   ne rattrape qu'une coupure réseau passagère, pas un redéploiement (le §3 est corrigé ainsi).
3. **Recherche.** L'alias `STABLE` est retiré (un token STABLE existe, rang 89 sur CMC). À rang
   égal, un marché réel passe devant une série `synthetic` : « STABLE » + Entrée ouvre la paire
   du token, STABLE.D reste listée. `USDT.D`, `USDC.D`, `DAI.D`, la forme composite, `STABLES`,
   `STABLECOINS` et `DOMINANCE` mènent toujours à STABLE.D.
4. **⌘K.** Un alias exact d'une série autonome tapé comme navigation, avec ou sans unité
   (« usdt.d 4h », « USDT.D+USDC.D+DAI.D »), ouvre STABLE.D au lieu de partir vers Twelve Data.
5. **Rafales.** Au plus 2 pages de dominance en vol (file d'attente) : EVTS en 1h passe de 48
   requêtes CMC simultanées à 8 au plus.
6. **Signaux.** Rafraîchissement des pièces en échec : le cache n'est servi que s'il a au plus
   24 h, avec un `console.warn` (âge et cause) ; au-delà, erreur explicite. Repoll en échec :
   `console.warn` au premier échec d'une série. Un `majTs` dans le futur vaut cache périmé.
7. **Divers.** Un changement de clé CCData ne recharge plus STABLE.D. `PointSerie` reprend le type
   de `lib/referentiel.ts`. `calculerDominance` devient `dominanceSurTotal` (homonyme de sens
   opposé dans `stablecoinsWindow.util.ts`).
8. **Limites assumées (ajouts).**
   - En 1h/4h, une bougie formée en direct garde la valeur reportée de la pièce (publiée un pas
     après le global) jusqu'au rechargement : écart médian 0,001 pt, max 0,07 pt.
   - Avec 2 décimales, 2015–2017 (moins de 0,1 %) s'affiche entre 0.00 et 0.0x %.
   - Préexistant et identique pour TOTAL* (hors lot) : l'alerte Funding et la fenêtre LIQ envoient
     le symbole à Binance fapi, Bybit et Coinalyze.
9. **CI.** `scripts/ci.sh --e2e` inclut `dominance-stablecoins.e2e`. Le suffixe est
   obligatoire : le motif nu sélectionne tout le worktree `.worktrees/dominance-stablecoins/`.
10. **Mesures après correction (contrôle indépendant du 29/10/2026).** Module identique bit à bit
    à un calcul V2 indépendant sur les 4 261 jours de l'historique (2015-02-26 → 2026-10-29).
    Écart à la vérité horaire (Σ capitalisations 1h de 00:00 / TOTAL de 00:00) : médiane
    0,0007 pt, p99 0,064, max 0,10 pt (2022-11-12) ; avant correction, max 0,856 pt
    (2020-03-31). Références : 28/10/2026 = 9,5326 % (vérité 9,5331) ; 31/03/2020 = 3,0407 %
    (vérité 3,0407) ; barre du 29/10 en V1 = 9,4677 % (vérité 9,4421, limite assumée de la barre
    du jour). Cache v2 sur données réelles : ≈ 190 Ko.
