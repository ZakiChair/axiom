# Ratios ÷ matières premières et ÷ autre actif — design

Date : 22 novembre 2026. Branche `feat/ratios-matieres-premieres` (worktree
`.worktrees/ratios-matieres`), partie d'`origin/main` `33994cd`. Deux lots, chacun livrable seul.

## 1. Demande et intention

Demande du propriétaire, le 22 novembre 2026 : « Reprends notre projet axiom et ajoute la
possibilité de diviser les actifs par d'autre actif comme le cuivre ». À la question « quelques
actifs précis en un clic, ou n'importe quel actif comme diviseur ? » : « Café, sucre, autre
commodité ou actif, USOIL, CHF ». Sur le résumé (un groupe « Matières premières » dans le menu ÷
et une entrée « Autre actif… ») : « ajoute en plus si tu peux sinon c'est parfait ».

Intention : exprimer un actif **en matières premières** (BTC en cuivre, en pétrole, en sucre…)
et, au-delà, **en n'importe quel autre actif**, depuis le bouton ÷ du bandeau, comme ÷BTC, ÷Or ou
« en CHF » aujourd'hui (section « Ratios ÷ marchés et devises » du 26 septembre 2026 de
`BUILD-CONTRACT.md`). Exception au gel G100 sur demande explicite, limitée au bouton ÷ du
bandeau, au catalogue Twelve Data curé et à ses aides de recherche.

## 2. Constat vérifié le 22 novembre 2026

Sondes `time_series` (1d) sur l'offre Twelve Data du propriétaire :

| Demandé | Instrument | Servi | Historique 1d |
|---|---|---|---|
| Cuivre | `HG1` (spot) | **refusé** (« Grow ou Venture ») | — |
| Cuivre | ETF `CPER` | oui | depuis 2011-11-15 |
| Sucre | ETF `CANE` | oui | depuis 2011-09-19 |
| Sucre | `SUGA:LSE` | refusé | — |
| USOIL | `WTI/USD` (spot) | **refusé** | — |
| USOIL | ETF `USO` | oui | depuis 2007-01-09 |
| CHF | `CHF/USD` | oui (vérifié le 26/09, « en CHF » existe) | — |
| Café | `JO` | introuvable (ETN retiré) | — |
| Café | `COFF:LSE` | refusé | — |
| En plus | `SLV`, `PPLT`, `PALL`, `BNO`, `UNG`, `WEAT`, `CORN`, `SOYB`, `DBA`, `DBC` | oui | 2007 à 2011 |
| En plus | `XAG/USD`, `XPT/USD`, `XBR/USD` (spot) | refusés | — |

- **Ajustement** : sur les séries 1d complètes (5 000 barres au plus), aucun saut de plus de 40 %
  d'un jour à l'autre pour USO, UNG, PPLT, PALL, WEAT, CORN et CANE : les regroupements et
  divisions d'actions sont ajustés (USO commence à 378,40 en 2007 après son regroupement 1:8 de
  2020). Seul CPER a **deux barres aberrantes isolées, à volume nul** : 2014-12-04 à 13,05 (entre
  19,52 et 19,56) et 2015-02-02 à 11,90 (entre 16,68 et 17,34).
- **Café introuvable partout** : ni dans l'offre Twelve Data, ni parmi les perpétuels de Binance,
  Bybit, OKX, MEXC et Hyperliquid (dex HIP-3 compris). Le panier agricole DBA en contient une part.
- **Perpétuels « TradFi » des plateformes crypto écartés** : Binance liste XAU, XAG, XPT, XPD,
  COPPER, CL, BZ et NATGAS (USDⓈ-M) depuis décembre 2025 à avril 2026, donc moins d'un an
  d'historique. AXIOM n'affiche que le spot Binance (`/api/v3/klines`) : il faudrait une nouvelle
  source.
- **Méthode** : clé serveur d'`apps/web/.env`, celle que `/tdapi` injecte. L'application préfère
  une clé personnelle enregistrée dans le navigateur si elle existe. Seul le contrôle navigateur
  en données réelles (§7) prouve la disponibilité dans l'application.

## 3. Objectifs, non-objectifs, anti-objectifs

Objectifs :
- **O1 (lot 1)** : un groupe « Matières premières » de 14 dénominateurs fixes dans le menu ÷ ▾.
- **O2 (lot 1)** : la recherche trouve l'ETF servi pour « USOIL » et pour les noms français
  (cuivre, sucre, pétrole, blé…).
- **O3 (lot 2)** : une entrée « Autre actif… » qui divise le marché affiché par n'importe quel
  actif du catalogue commun (toutes sources), avec les gardes du §5.2.

Non-objectifs : le café (aucune source) ; les perpétuels TradFi des plateformes crypto ; les cours
spot qui exigent une offre supérieure (HG1, XAG/USD, WTI/USD, XPT/USD…) ; les places hors
États-Unis (« COFF:LSE ») ; tout changement du moteur SYN (`combineKlines`, souscriptions) ; la
division par un spread ou par une série SYN déjà composée.

Anti-objectifs (échec même si « ça marche ») :
- Un ETF présenté comme le cours de la matière : le libellé et l'infobulle nomment toujours l'ETF,
  jamais une substitution silencieuse.
- Un ratio qui lit un prix futur ou qui se fige (règles 4 et 5 du 26 septembre non respectées).
- Une régression des contrôles existants : ÷BTC, préférence persistée du bouton scindé, parcours
  clavier du menu, « en CHF », reconnaissance des ratios déjà posés.
- Un dépassement du quota Twelve Data (800 crédits par jour) ou du budget du §6.

## 4. Lot 1 — matières premières (entrées fixes)

### 4.1 Dénominateurs

Identifiants **persistés** (préférence du bouton scindé) : figés une fois livrés.

| Id | Ticker | Libellé | Nature |
|---|---|---|---|
| `OR` | `XAU/USD` | ÷Or | spot (existant, inchangé) |
| `ARGENT` | `SLV` | ÷Argent (SLV) | métal physique |
| `PLATINE` | `PPLT` | ÷Platine (PPLT) | métal physique |
| `PALLADIUM` | `PALL` | ÷Palladium (PALL) | métal physique |
| `CUIVRE` | `CPER` | ÷Cuivre (CPER) | contrats à terme |
| `PETROLE` | `USO` | ÷Pétrole WTI (USO) | contrats à terme |
| `BRENT` | `BNO` | ÷Brent (BNO) | contrats à terme |
| `GAZ` | `UNG` | ÷Gaz naturel (UNG) | contrats à terme |
| `BLE` | `WEAT` | ÷Blé (WEAT) | contrats à terme |
| `MAIS` | `CORN` | ÷Maïs (CORN) | contrats à terme |
| `SOJA` | `SOYB` | ÷Soja (SOYB) | contrats à terme |
| `SUCRE` | `CANE` | ÷Sucre (CANE) | contrats à terme |
| `AGRICULTURE` | `DBA` | ÷Agriculture (DBA) | panier de contrats (dont café et cacao) |
| `PANIER` | `DBC` | ÷Matières premières (DBC) | panier de contrats (énergie, métaux, agriculture) |

`DENOMINATEURS` reste une **liste fermée** (crypto, indices, matières premières, devises) :
`persist.ts` valide la préférence contre elle, donc les nouveaux ids s'hydratent et un id inconnu
reste refusé.

### 4.2 Menu

Groupes dans l'ordre : Crypto (ETH, SOL) · **Indices** (÷Nasdaq 100 (QQQ), ÷S&P 500 (SPY)) ·
**Matières premières** (les 14, dans l'ordre du tableau : métaux, énergie, agriculture, paniers) ·
Devises (les 6). L'Or quitte « Marchés », qui devient « Indices » (id `OR` inchangé). Le bouton
÷BTC ne change pas. Le panneau de `MenuDeroulant` défile déjà (`max-h-[70vh]`) : à vérifier au
téléphone.

### 4.3 Infobulles

Chaque infobulle dit ce qui est réellement divisé, par exemple « le cuivre via l'ETF CPER : prix
de la part, pas le cours du cuivre ». Pour un ETF de contrats à terme, elle ajoute que les
contrats renouvelés peuvent s'écarter du cours sur plusieurs années. Quand le cours spot a été
vérifié refusé, elle le dit (HG1, XAG/USD, WTI/USD, XBR/USD, XPT/USD : offre Grow de Twelve
Data). Le texte se **compose à partir de champs** (nom, ticker, nature, spot refusé) plutôt que
de 14 phrases littérales, pour le budget (§6).

### 4.4 Règles héritées et règle modifiée

- **Devise (inchangé)** : un ratio ÷ matière première est réservé aux actifs cotés en dollar
  (`COTATIONS_USD`, tickers Twelve Data sans place, paires X/USD, TOTAL*, perps Hyperliquid).
  BTCEUR n'a pas de ÷Cuivre.
- **Garde `base === denom` de `symboleRatioTradfi` restreinte aux Devises.** Elle n'a de sens que
  là (EURUSDT en EUR). Pour les indices et les matières premières, l'auto-division est déjà
  refusée par `symbol === ref` (CPER ÷Cuivre). Sans cette restriction, un actif dont la base
  serait égale à un id (`GAZ`, `BLE`…) perdrait son bouton en silence.
- **Séance et sondage (inchangé)** : un ETF américain sans « / » est classé `stock` par
  `classifyTradfi`, donc sondé pendant la séance de New York. C'est juste pour ces ETF.
  `heuresMarche.ts` ne change pas.
- **Unités de temps (inchangé)** : 1h et 4h ne sont pas proposées face à un numérateur hors
  Twelve Data (grille décalée) ; 1m n'est pas proposée avec un numérateur Twelve Data ; l'unité
  retirée devient la suivante (`timeframeProche`).
- **Quota (inchangé)** : environ 82 crédits par jour ouvré pour un ratio ouvert en
  intrajournalier, 28 dès 1d.
- **Reconnaissance (inchangé)** : `estRatio` reconnaît les nouveaux ids comme l'Or et SPY (jambe B
  égale au ticker et recomposition identique).

### 4.5 Catalogue et recherche

- Ajouter `SOYB` à `TWELVEDATA_SYMBOLS` ; les 13 autres ETF y sont déjà.
- `TRADFI_SEARCH_METADATA` : un libellé français et des alias **sans accents** pour les 13 ETF
  (exemples : CPER « Cuivre — ETF », `CUIVRE`, `COPPER` ; USO « Pétrole WTI — ETF », `USOIL`,
  `PETROLE` ; CANE `SUCRE`, `SUGAR`). L'alias `USOIL` passe de `WTI/USD` à `USO`. `WTI/USD` reste
  au catalogue, avec un libellé qui dit qu'il exige une offre supérieure. `searchMarkets` classe un
  alias exact au rang 2 : « USOIL » ouvre donc USO.

### 4.6 Limites assumées

- Un ETF de contrats à terme dérive du cours de la matière sur plusieurs années (UNG est le cas
  extrême). SLV, PPLT et PALL détiennent du métal physique.
- Les deux barres aberrantes de CPER (2014-12-04, 2015-02-02) font un pic d'un jour sur un ratio
  dont le numérateur a de l'historique avant 2017 (tradfi, BTCUSD Kraken ou Coinbase). Les
  numérateurs Binance commencent en 2017 et ne sont pas touchés. Pas de filtrage : le moteur SYN
  ne corrige pas les données.
- Jours fériés US sondés pour rien (dette du 26/09). Pas de café.

## 5. Lot 2 — « Autre actif… »

### 5.1 Parcours

- **Dernière entrée du menu ÷ ▾** : « Autre actif… » (`menuitem`). L'activer ferme le menu
  (`fermer`) et ouvre un **sélecteur séparé**. Pas de champ de saisie dans `MenuDeroulant` : le
  menu gère ↑/↓/Début/Fin/Échap et se ferme quand le focus le quitte, et `PairSearch` ouvre sa
  propre liste (portail au téléphone).
- **Sélecteur** : titre « Diviser <jambe A> par… », champ de recherche focalisé à l'ouverture,
  résultats du **catalogue commun, toutes sources** (`fetchMarketCatalog`, `searchMarkets`, comme
  la recherche principale ; pas le mode `onPick` de `PairSearch`, limité à la place affichée), avec
  la source de chaque résultat. Un résultat incompatible est grisé avec sa raison, jamais un clic
  sans effet. Entrée ou clic : le ratio est posé. Échap : fermeture, focus rendu au bouton ÷ ▾. Au
  téléphone, même patron que `PairSearch` (`PortailMobile`).
- **Saisie libre hors catalogue** : résolue par `resolveMarketCandidates`, comme le constructeur
  SYN (sources automatiques), sinon refusée avec un message.
- **Une place par ticker** : `searchMarkets` ne garde qu'un représentant par `kind:symbol`
  (Binance d'abord, à profondeur égale). Le sélecteur ne propose donc pas le même ticker sur une
  autre place. Limite assumée.
- **Pas de « Récents »** (arbitrage). `syntheticsStore.recents` est partagé, limité à 8 et rempli
  par chaque bascule fixe (`poser`) : les diviseurs libres en sortiraient vite. Une liste dédiée
  serait un nouvel état persisté. Suite possible sur demande. **Aucun nouvel état persisté.**

### 5.2 Composition (fonction pure de `data/ratio.ts`)

`symboleRatioLibre(baseSym, baseEx, jambe)` rend le symbole SYN ou une raison de refus. La
**jambe A** est la même base que les boutons existants (jambe A du ratio actif, sinon le marché
courant). Les règles s'appliquent **dans cet ordre** :

1. **Fixe d'abord, par référence.** Si l'actif choisi est la référence d'un dénominateur fixe sur
   sa place, et que ce dénominateur est disponible pour la jambe A (`symboleRatio` non nul), c'est
   le ratio du bouton fixe qui est posé, sur la place du numérateur. Les références sont
   `REFS[d][place]` et `REF_CANONIQUE[d]` pour la crypto, et `REFS_TRADFI[d].sym` sur `twelvedata`.
   - ETHUSDT choisi sur n'importe quel numérateur donne ÷ETH quand ÷ETH est disponible (Kraken
     SOLUSD → `kraken:ETHUSD`).
   - CPER choisi affiche « ÷Cuivre (CPER) ».
   - ETHBTC ÷ SOLUSDT donne le ÷SOL du bouton : les boutons crypto fixes ne vérifient pas la
     devise (`ratio.test.ts:49`), comportement existant conservé. Le sélecteur ne pose jamais
     autre chose que le menu pour un même actif.
2. **Jambe B d'un ratio libre** : un marché réel, ou une capitalisation en USD (TOTAL*, jambe
   `mcap`). STABLE.D (en %) est refusée. Une série SYN déjà composée est refusée : jamais
   d'imbrication.
3. **Jamais A ÷ A** : même source et même symbole refusés. Le même actif sur deux places reste
   permis quand aucun bouton fixe ne s'applique : Coinbase BTCUSD ÷ BTCUSDT (÷BTC impossible sur
   une base BTC) donne la prime de Coinbase, en ratio libre.
4. **Même devise des deux côtés**, stablecoins USD comptés pour 1 USD (`COTATIONS_USD`) :
   - crypto : cotation par le découpage tenant compte de la place ;
   - perps Hyperliquid et TOTAL* : USD ;
   - ticker Twelve Data sans « / » ni « : » : USD ; paire « X/Y » : Y ; place explicite « X:PLACE »
     refusée (devise inconnue).
   Exemples : ETHBTC ÷ ADABTC accepté ; BTCUSDT ÷ USD/JPY refusé (USD contre JPY) ; BTCUSDT ÷
   AAPL accepté ; CPER choisi sur BTCEUR refusé (EUR contre USD, comme le bouton grisé).

### 5.3 Reconnaissance du ratio actif

- Les ids fixes sont reconnus **en premier**, mais seulement s'ils se **recomposent à l'identique**
  depuis la jambe A (`symboleRatio(jambe A, id) === symbole`), pour les trois branches : crypto de
  même place, crypto cross-source canonique et Twelve Data. Aujourd'hui, la branche cross-source
  reconnaît tout SYN dont la jambe B est la référence canonique, quelle que soit la jambe A.
  - Conséquence : `kraken:SOLUSD|/|binance:ETHUSDT` n'est plus lu ÷ETH (`ratio.test.ts:117`
    change) : il devient un ratio libre, car ÷ETH sur Kraken pose `kraken:ETHUSD`.
  - Conséquence : la prime de Coinbase n'affiche plus un ÷BTC enfoncé qui disparaîtrait au retour.
- **Nouveau** : un SYN « / » qui ne correspond à aucun id fixe, mais que §5.2 (règles 2 à 4)
  recomposerait identique depuis sa jambe A, est reconnu comme **ratio libre** (sans id, jambe B
  exposée). `ratio.test.ts:246` (`binance:BTCUSDT|/|twelvedata:GLD` non reconnu) change.
  - Conséquence (arbitrage) : les préréglages « BTC / OR (proxy GLD) », « BTC / DXY (proxy UUP) »
    et tout ratio SYN de l'utilisateur deviennent des ratios actifs. Le bouton scindé affiche
    « ÷GLD » pressé, un clic revient à BTCUSDT, et les autres dénominateurs se composent depuis
    BTCUSDT. Aujourd'hui, ces préréglages n'ont pas de boutons ÷.
  - Le principe du contrat devient : « `estRatio` ne reconnaît que ce que les contrôles ÷
    auraient posé », « Autre actif… » compris.
- Un spread (« - ») n'est jamais reconnu.
- Libellé du bandeau pour un ratio libre : « <jambe A> ÷ <jambe B> ». Les fixes Twelve Data
  gardent le leur (« BTCUSDT ÷Cuivre (CPER) »).
- La préférence du bouton scindé ne stocke jamais un diviseur libre.

### 5.4 Héritages

Unités de temps par `supportedTimeframesFor` (grille décalée de toute jambe Twelve Data) et
`timeframeProche`. Direct, report de la dernière clôture et quota par le moteur SYN et
`souscrireJambeTwelveData` : une paire « X/Y » suit la séance du forex, un ticker celle de New
York. Un ticker libre à une autre séance (HG1 avec l'offre Grow, par exemple) ne serait sondé
qu'aux heures de New York : limite assumée, car l'offre actuelle le refuse.

### 5.5 Chargement

Le sélecteur est chargé à la demande (chunk séparé). Le chemin initial ne reçoit que l'entrée du
menu et les fonctions pures de garde.

## 6. Budget

- Base mesurée le 22/11 dans le worktree (Node 26.7.0) : chargement initial **1 184 044 /
  354 567** octets bruts / gzip, plafonds 1 220 000 / 360 000, marge gzip 5 433. Comparer avant et
  après avec le même Node.
- Garde-fou : les deux lots ensemble ajoutent **au plus +1 200 octets gzip** au chargement
  initial. Au-delà, arrêter et le signaler.

## 7. Tests et preuves

Unitaires (vitest, environnement node, fonctions pures) :
- **Ratios** :
  - chaque nouvel id se compose pour BTCUSDT (Binance), un ticker Twelve Data (AAPL) et TOTAL
    (`mcap`) ; il est refusé pour BTCEUR ;
  - CPER ÷Cuivre est refusé, GLD ÷Or reste accepté, EURUSDT en EUR reste refusé ;
  - aller-retour `estRatio` pour chaque id, priorité aux fixes ;
  - lot 2 : chaque cas du §5.2 dans l'ordre (fixe par référence sur plusieurs places, prime de
    Coinbase, A ÷ A, devises), avec la raison attendue ;
  - lot 2 : reconnaissance resserrée (`ratio.test.ts:117` et `:246` réécrits), préréglages GLD et
    UUP reconnus comme ratios libres, spreads non reconnus.
- **Persistance** : les nouveaux ids s'hydratent ; un id inconnu est refusé.
- **Recherche** : « USOIL » classe USO en tête ; « cuivre » trouve CPER ; « sucre » trouve CANE ;
  « WTI » trouve encore WTI/USD.
- Le cliquet `uiConventions` reste vert (primitives obligatoires).

E2E (Chromium, Twelve Data bouchonné) :
- `gate-v24-macro-denominateur` mis à jour : groupes « Indices » et « Matières premières ».
- Parcours ÷Cuivre (CPER) : requête `CPER`, libellé « BTCUSDT ÷Cuivre (CPER) ».
- Parcours clavier jusqu'à « Autre actif… » : sélecteur, saisie, Entrée, ratio posé ; Échap rend le
  focus au bouton.
- Sur BTCEUR, les matières premières sont grisées.

Contrôle navigateur en **données réelles** (serveur de dev, clé réelle) :
- BTCUSDT ÷Cuivre (CPER) en 1d, avec un chiffre de contrôle : dernière clôture ≈ clôture BTC ÷
  clôture CPER. Puis en 15m.
- ÷Sucre (CANE), et « en CHF » qui marche toujours.
- « Autre actif… » : ETHUSDT donne le même graphique que ÷ETH, sur Binance et sur une autre place
  (Bybit HYPEUSDT) ; SPY pose ÷S&P 500 (SPY) (fixe d'abord) ; un diviseur libre (AAPL) affiche son
  libellé et revient à la jambe A ; le préréglage BTC / OR (proxy GLD) montre « ÷GLD » enfoncé.

Puis `pnpm check` vert, et **revue par un agent indépendant** (`AGENTS.md` : calcul financier).

## 8. Documentation

- `BUILD-CONTRACT.md` : nouvelle section « Ratios ÷ matières premières et ÷ autre actif (demande
  du 22 novembre 2026) ». Elle contient la table de vérification (café absent compris), les
  arbitrages, les limites, le budget et les tests. La section du 26 septembre reste comme
  historique ; la nouvelle remplace sa description du menu.
- Mémoire de session : le dépôt est `~/Projects/axiom`.

## 9. Arbitrages de l'orchestrateur, à confirmer par le propriétaire

1. ETF plutôt que spot (spot refusé par l'offre), toujours nommé dans le libellé.
2. Ajouts au-delà de la demande : argent, platine, palladium, Brent, gaz, blé, maïs, soja, et les
   paniers DBA et DBC.
3. « Marchés » devient « Indices » ; l'Or rejoint « Matières premières » (id inchangé).
4. **Question posée au propriétaire le 22/11** : préréglages BTC/GLD, BTC/UUP et ratios SYN
   utilisateur reconnus comme ratios actifs (lot 2). Toute reconnaissance d'un ratio « Autre
   actif… » se déduit du seul symbole, sans état : elle entraîne forcément celle-ci.
5. Café absent ; perpétuels TradFi des plateformes crypto écartés.
6. « USOIL » mène à USO ; WTI/USD reste au catalogue avec la mention de l'offre.
7. Prime entre places permise quand aucun bouton fixe ne s'applique.
8. Reconnaissance des ids fixes resserrée à « recomposé à l'identique » (lot 2).
9. Fixe d'abord par référence, avant les gardes ; la devise des boutons crypto fixes reste non
   vérifiée, comme aujourd'hui.
10. Pas de « Récents » dans le sélecteur.

## 10. Laissé au développeur

Structure du sélecteur (nouveau composant ou mode de `PairSearch`), classes exactes dans les
primitives du cliquet, formulation exacte des infobulles dans les contraintes du §4.3,
organisation des fichiers de test.

## 11. Ordre

Lot 1, revue, lot 2, revue. Puis intégration, e2e, contrôle en données réelles, consignation au
contrat. Fusion dans `main` sur accord du propriétaire.
