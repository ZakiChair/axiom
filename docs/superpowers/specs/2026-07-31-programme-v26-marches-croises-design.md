# Programme v2.6 « Marchés croisés » — harmonisation, stratégies multi-indicateurs, corrélations cross-asset, ratios multi-dénominateurs, verdict gamma OMON

Date : 2026-07-31
Statut : conçu en session autonome sur demande directe de Zaki (« harmonise et classe par
groupe les indicateurs, ajoute des stratégies de trading multi-indicateur, établis des
corrélations entre le marché tradi et crypto, l'or et les cryptos, les devises et les
cryptos, ajoute la possibilité de faire des rapports (divisés par BTC, ETH ou SOL) avec
d'autres actifs, améliore la lisibilité du marché options et conclus si le market maker
doit vendre ou acheter le sous-jacent »).

## Contexte — ce qui existe déjà

L'exploration préalable (6 lecteurs parallèles, 2026-07-31) établit que le programme est
une **extension de l'existant**, pas une création :

- Le registre d'indicateurs (172 defs) **a déjà un champ de groupe** (`category`, 11
  littéraux) et le menu Indicateurs groupe déjà par catégorie. Le problème est
  l'**harmonisation** : libellés d'inputs bilingues (29× « Length » vs 36× « Longueur »),
  noms FR/EN mélangés, 12 fichiers rangés dans un dossier ≠ catégorie déclarée,
  commentaires de registry.ts trompeurs, menu Stratégies à plat mélangeant trois natures.
- Les stratégies v2.2/v2.3 sont livrées (fabrique `defStrategie`, 12 stratégies chart,
  campagne de validation figée 2026-07-28). **Six combos multi-indicateurs existent déjà
  dans `candidatsChampion.ts` mais HORS registre** — invisibles pour l'utilisateur.
- CORR croise déjà mécaniquement crypto×tradfi (taper SPY/GLD/UUP/EUR-USD marche), mais
  sans références préréglées, sans persistance, avec échecs silencieux. La spec Lot 3 du
  programme « Terminal cohérent » (2026-07-29) avait explicitement écarté la vue « vs
  références tradfi » — **la demande du 2026-07-31 rouvre cette décision** ; le présent
  programme l'assume (périmètre restreint aux références, le reste du Lot 3 est inchangé).
- Le dénominateur ÷BTC/÷ETH/÷SOL existe (lot v2.4) mais **refuse le tradfi** (REFS sans
  entrée twelvedata) et ne reconnaît pas les ratios cross-source, alors que le moteur SYN
  les supporte déjà (presets BTC/GLD, BTC/UUP).
- OMON calcule et affiche déjà GEX/DEX/gamma-flip. **Le verdict dealer n'existe nulle
  part** (grep « dealer / long gamma / short gamma » = 0 occurrence) alors que tous les
  ingrédients (gexNet, flip, spot) sont en mémoire dans le composant.

## Hypothèses et décisions transverses

1. **« Rapports divisés par BTC/ETH/SOL »** est lu comme « ratios de prix » (le mécanisme
   ÷DENOM existant), pas comme « reporting documentaire ». C'est la lecture cohérente
   avec le vocabulaire du terminal (RATIO un clic, onglet dénominateur).
2. **Réouverture CORR tradfi** : la demande explicite du jour prime sur la décision actée
   du 2026-07-29. Documenté ici ; le Lot 3 « Terminal cohérent » (univers Top-N, tri
   similarité, onglet Paires) reste à livrer séparément et n'est pas cannibalisé.
3. **Aucun changement de défauts d'indicateurs, d'ids, ni de clés d'inputs** : goldens,
   campagne de backtest figée, params persistés et alertes en dépendent.
4. `packages/types` est figé (BUILD-CONTRACT) : **aucune nouvelle catégorie de type** ;
   tout sous-classement est une table d'affichage côté web.
5. Honnêteté : toute nouvelle stratégie est étiquetée **non validée** (nom + docblock +
   libellés) tant que la campagne ne l'a pas mesurée ; le verdict gamma d'OMON est une
   lecture **mécanique sous hypothèse déclarée** (dealers long calls / short puts), pas
   un conseil.
6. Ordre d'exécution : A → B séquentiels (mêmes fichiers registre/menus) ; C, D, E
   indépendants (fichiers disjoints), parallélisables. Commits par lot sur main.

---

## Lot A — Harmonisation & classement des indicateurs

**But** : un registre dont la lecture ne ment pas, des libellés uniformes en français,
des menus qui classent réellement.

### A1. Libellés d'inputs en français (clés INCHANGÉES)
Balayage de tous les defs : `name` des inputs uniformisé — « Length »→« Longueur »,
« Window »→« Fenêtre », « Period »→« Période », « Smoothing »→« Lissage »,
« Multiplier »→« Multiplicateur », « Fast/Slow »→« Rapide/Lente », « Offset »→
« Décalage », etc. Les deux doublons conceptuels (`periodsPerYear`/`periodesParAn`)
gardent leurs clés mais partagent le libellé « Périodes par an ». Les tests jumeaux qui
assertent ces libellés sont mis à jour dans le même commit.

### A2. Noms d'indicateurs : français pour les génériques, noms propres conservés
« Historical Volatility »→« Volatilité historique (HV) », « Standard Deviation »→
« Écart-type », « Bollinger Bands »→« Bandes de Bollinger »… Les acronymes et noms
propres restent (RSI, MACD, Ichimoku, SuperTrend, ALMA…). La recherche du menu matche
aussi l'id : « hv », « stdev » restent trouvables.

### A3. Dossier = catégorie déclarée
Déplacement des 12 fichiers dont le dossier ment (4 divergences momentum/, obvDivergence
et les 3 orderflow rangés sous volume/, cvdDivergence + cvdSpotPerp d'orderflow/,
premiumSpotPerp de derivatives/ → chacun vers le dossier de sa catégorie déclarée), tests
jumeaux déplacés avec, imports de registry.ts mis à jour, blocs commentés de registry.ts
réalignés sur la **catégorie** (plus le dossier). Aucun id, aucun calcul ne change.
`anchored-vwap.ts` renommé `anchoredVwap.ts` (seul kebab-case du package).

### A4. Sous-groupes d'affichage
- **IndicatorMenu — catégorie Dérivés (27 defs)** éclatée en 3 sous-groupes d'affichage :
  « Dérivés perp » (funding, OI, basis…), « On-chain » (SOPR, MVRV, NUPL, Puell…),
  « Positionnement » (ratios L/S…). Table locale `SOUS_GROUPES_DERIVES` (defId →
  sous-groupe) + test pur qui impose l'exhaustivité (tout def derivatives non classé fait
  échouer le test).
- **StrategyMenu** : catalogue sectionné par fonction pure `sectionStrategie(def)` —
  « Stratégies » (id `strat*`), « Divergences » (id `*Divergence`), « Spot vs Perp »
  (le reste : cvdSpotPerp, premiumSpotPerp). Robuste aux ajouts du Lot B (dérivation par
  règle, pas par liste).

### A5. Nettoyages constatés
- Retrait des 3 couleurs hex mortes de cvdSpotPerp (outputs[].color, ignoré par le
  bridge) **après vérification qu'aucun consommateur ne les lit**.
- `custom` (0 def) retiré de CATEGORY_ORDER/LABELS du menu (le type reste intact).

**Non-objectifs A** : renommage d'ids ou de clés d'inputs, changement de défauts ou de
bornes, re-catégorisation des 8 defs v2.1 vers leurs familles techniques (décision
produit « foyer exclusif » conservée), harmonisation des politiques min/max (constatée,
non traitée).

**Vérification** : suites indicators + web vertes sans amender registry.test.ts (compte
et liste inchangés) ; recherche menu OK sur libellés FR et ids.

---

## Lot B — Stratégies de trading multi-indicateurs

**But** : exposer à l'utilisateur de vraies stratégies multi-indicateurs paramétrées.

### B1. Promotion des 5 candidats de campagne en defs paramétrés
`stratSupertrendAdx`, `stratMmRsi`, `stratSqueezeKumo`, `stratMacdSupertrend`,
`stratPsarAdx` — recopie paramétrée des règles de `candidatsChampion.ts` (défauts = les
constantes figées de la campagne), via `defStrategie`, patron d'honnêteté de
`stratChampion` : le docblock cite le verdict de campagne (« aucun candidat validé » ;
chiffres mesurés rappelés), le nom et les 3 libellés portent « (non validé) ».
`candidatsChampion.ts` lui-même reste STRICTEMENT intact (protocole).

### B2. Deux nouvelles combinaisons (dimensions inexplorées)
- `stratTripleConfirmation` : Supertrend (régime) + MACD vs signal (déclencheur) + RSI
  vs 50 (momentum) — long si les trois alignés haussiers, short si les trois baissiers,
  sinon flat. Cœurs existants uniquement.
- `stratRsiRange` : réversion RSI **filtrée par ADX < seuil** (défaut 20) — la
  mean-reversion n'est autorisée qu'en régime de range ; miroir conceptuel de
  stratMmAdx. Cœurs existants uniquement.
Étiquetées « non validé » (jamais mesurées).

### B3. Câblage
Registre 172 → 179 ; registry.test.ts amendé (compte + liste triée des 27 ids strategy).
Tests jumeaux au patron v2.2 (contrat, fixture dérivée à la main, gardes
anti-tautologie). Rien à faire côté StrategyMenu (dérivation automatique, sections A4).

### B4. Presets BT builtin (exprimables seulement, conditions de NIVEAU)
- `builtin:macd-supertrend` (MACD > signal ET direction Supertrend = 1, miroir short
  documenté long-only comme les autres builtins),
- `builtin:triple-confirmation` (les 3 conditions de niveau),
- `builtin:psar-adx` (close > PSAR ET ADX ≥ 25) — ajoute l'opérande PSAR au
  CATALOGUE_OPERANDES.
Squeeze+kumo, RSI-range et les stratégies à état restent inexprimables au moteur
déclaratif — documenté, pas de contorsion.

### B5. Campagne de mesure
Relancer `bun scripts/valider-strategies.ts` (fenêtre FIGÉE, cache klines) pour
régénérer le rapport avec les lignes de rejeu des nouvelles stratégies ; sanity : les 5
promues reproduisent les chiffres de leurs candidats. Si le réseau/cache l'empêche, le
lot est livrable sans re-campagne (étiquettes « non validé » déjà posées) et la
re-campagne passe au backlog.

**Vérification** : suites vertes ; chaque nouvelle stratégie visible dans le menu
Stratégies avec params éditables ; presets BT exécutables dans BT.

---

## Lot C — Corrélations croisées : tradfi / or / devises × crypto

**But** : lire en un clic la corrélation de BTC/ETH/SOL (et la watchlist) avec actions,
or, dollar et devises.

### C1. Références tradfi préréglées
`REFERENCES_CORR` (curé, libellés honnêtes sur les proxys) :
S&P 500 (SPY), Nasdaq 100 (QQQ), Or (GLD), Dollar (UUP — proxy DXY), EUR/USD, USD/JPY.
Rangée de toggles individuels (primitives du socle) dans CorrWindow ; les références
actives rejoignent l'univers de la matrice. Routage inchangé : `chargerSerie` route déjà
ces tickers curés vers twelvedata.

### C2. Persistance
`corrUiStore` persisté sous `axiom:corr:v1` (méthode, fenêtre, extras, références
actives) — jamais l'état open. Hydratation validée champ par champ. (C'est la persistance
déjà spécifiée au Lot 3, implémentée ici pour la partie utile au croisement.)

### C3. Fiabilité et honnêteté
- Chips d'erreur pour toute série en échec (« SPY — échec de chargement (quota ?) »),
  plus de cellules vides silencieuses.
- Cellules à n < 20 rendements communs atténuées + note (l'alignement jours UTC communs
  écarte les week-ends : ~62 points communs sur 90 j).
- Le rendement du jour EN COURS est exclu (fonction pure testée) — la dernière bougie
  (crypto comme tradfi) est partielle.
- NoteSource enrichie : clôtures non synchrones (bourse ~20-21h UTC vs crypto 00:00
  UTC), proxys UUP/GLD étiquetés.

### C4. Correctif embarqué
Sparkline du détail : fenêtre glissante = la fenêtre sélectionnée (fix du 30 figé,
prévu Lot 3, nécessaire ici pour lire les corrélations croisées dans le temps).

**Non-objectifs C** : univers Top-N CoinGecko, tri similarité, onglet Paires (restent au
Lot 3 « Terminal cohérent ») ; or spot XAU et vrai DXY (hors plan gratuit — proxys
assumés) ; PAXG. Contraintes : quota Twelve Data ménagé (≈6 crédits par recalcul avec
toutes les références actives, cache session conservé, « changer méthode/fenêtre ne
refetch pas » inchangé) ; signatures de corr.ts consommées par SCEN préservées.

**Vérification** : matrice mixte BTC/ETH/SOL × 6 références sans saisie manuelle ;
réglages retrouvés après fermeture/réouverture ; tests purs (exclusion jour courant,
seuil fiabilité) ; suite web verte.

---

## Lot D — Ratios ÷BTC / ÷ETH / ÷SOL avec d'autres actifs

**But** : « n'importe quel actif » rapporté à BTC, ETH ou SOL en un clic — y compris
or ÷ BTC, SPY ÷ BTC, EUR/USD ÷ BTC.

### D1. Référence canonique cross-source
`REF_CANONIQUE : Record<DenominateurId, { ex: "binance"; sym: string }>` (BTCUSDT /
ETHUSDT / SOLUSDT). `symboleRatio` : comportement actuel INCHANGÉ quand
`REFS[denom][exchange]` existe (même source) ; sinon, si la source est twelvedata,
composition cross-source `exchange:SYM |/| binance:REF` — sans passer par splitSymbol
(un ticker tradfi n'est pas découpable et ne peut pas être déjà coté en BTC). La source
`synthetic` reste exclue (pas de SYN imbriqué).

### D2. Reconnaissance élargie
`estRatio` accepte `exB !== exA` quand `legB === REF_CANONIQUE[denom].sym` ET
`spec.exB === REF_CANONIQUE[denom].ex` (vérifier la jambe B contre la réf de SON
exchange — jamais celle de exA). Détoggle vers la jambe A et rebascule ÷ETH/÷SOL
fonctionnent alors tels quels (déjà pilotés par spec.exA/legA).

### D3. UI
Aucune restructuration : BoutonsRatio est piloté par `disponible()`/`estRatio` — le
bouton apparaît automatiquement sur un symbole tradfi. Le bandeau « jambe tradfi :
dernier close (marché fermé) » existant s'applique. Attention aux pièges connus :
pointer-events-auto, pas d'uppercase sur les SYN, filter typé DenominateurId[].

### D4. Tests
ratio.test.ts étendu (composition twelvedata÷BTC/ETH/SOL, reconnaissance cross-source,
refus d'un legB étranger, refus synthetic, round-trip) ; gate e2e v2.4 étendu (mock
/tdapi) : ouvrir GLD, poser ÷BTC, vérifier le SYN et le détoggle.

**Non-objectifs D** : dénominateur libre, dénominateurs supplémentaires, boutons sur les
slots secondaires, variation 24 h sur SYN, presets supplémentaires de PairSearch.

**Vérification** : suite web verte ; e2e gate vert ; gate visuel (bouton présent sur GLD,
ratio posé, retour propre).

---

## Lot E — OMON : lisibilité + verdict market maker (gamma)

**But** : l'écran options répond à la question « le MM doit-il acheter ou vendre le
sous-jacent ? » et devient lisible sans jargon implicite.

### E1. Verdict gamma (cœur de la demande)
`data/gexDex.ts` (+tests) :
- `verdictGamma(gexNet, spot, flip, sommeAbs)` → régime `long-gamma` / `short-gamma` /
  `indetermine` (|gexNet| sous un seuil relatif de sommeAbs, ou flip nul et net ≈ 0),
  avec phrase d'action mécanique : long gamma → « les dealers VENDENT le sous-jacent
  quand ça monte, ACHÈTENT quand ça baisse — mouvements amortis, aimantation vers les
  murs » ; short gamma → « les dealers ACHÈTENT les hausses, VENDENT les baisses —
  mouvements amplifiés (carburant de squeeze/cascade) ». Distance spot↔flip en %.
- `mursGamma(points)` → call wall (strike du GEX positif max) et put wall (strike du
  GEX négatif max), sur le profil toutes échéances (crypto) / échéance courante (actions).
- Profil `profilGexSpot(chaine, spots, nowMs)` (crypto uniquement) : GEX net recalculé
  par Black-Scholes à spot simulé (±15 % en ~41 points), zéro du profil = « flip réel »
  — courbe compacte sous l'histogramme, sans zoom.

### E2. Lisibilité
- Tuile VERDICT (ton up/down/neutre) en tête des tuiles GEX/DEX + tuiles « Call wall » /
  « Put wall » / « Spot↔flip » ; portée AFFICHÉE sur chaque tuile (« toutes échéances »
  vs « échéance sélectionnée ») — fin du mélange signalé seulement par suffixes.
- Infobulle au survol de l'histogramme GEX/DEX (InfobulleGraphe — seule vue qui n'en a
  pas) : strike, GEX, DEX, OI calls/puts.
- NoteSource réécrite : hypothèse de positionnement dealer EXPLICITE (« convention :
  dealers long les calls, short les puts — le signe du GEX en dépend »), portées
  cohérentes, filtre 0,5 % du max signalé.
- Cas dégradés : flip null → « — » et verdict fondé sur le seul signe du net ; CBOE en
  échec → chemin crypto intact (isolation existante préservée).

**Non-objectifs E** : VEX/vanna/charm, greeks serveur Deribit, bid/ask par strike,
câblage du verdict dans REGIME/BRIEF (backlog), alertes sur bascule de régime.

**Vérification** : tests purs (verdict aux bornes, murs, profil sur chaîne synthétique,
flip null) ; suite web verte ; gate visuel : verdict lisible dans les deux régimes
(fixtures), infobulle opérationnelle.

---

## Vérification finale du programme

1. `pnpm check` (typecheck -r, tests -r, build web) vert.
2. Gates e2e concernés verts (v2.4 étendu ; smoke).
3. Gate visuel navigateur : CORR (matrice croisée), OMON (verdict), bouton ÷BTC sur GLD.
4. Revue adversariale multi-agents sur l'ensemble du diff avant commits.
5. Commits par lot sur main, auteur ZakiChair.
