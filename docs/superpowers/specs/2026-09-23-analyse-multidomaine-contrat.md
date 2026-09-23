# Analyse multidomaine — contrat de calcul et de causalité

Date : 23 septembre 2026. Contrat de conception remis à l'orchestrateur pour les huit points autorisés. Les seuils de prudence ci-dessous sont des choix de produit explicites, pas des résultats validés sur les marchés. Ils doivent être constants, documentés et testés ; aucun ajustement opportuniste pour obtenir un signal.

Périmètre inchangé : sources existantes, 9 identifiants de marché, 214 indicateurs, 39 fenêtres, aucune dépendance nouvelle, aucun ordre réel. Budget initial bloquant : 1 220 000 octets bruts / 360 000 gzip. Les calculs lourds et nouvelles sections sont chargés à l'ouverture. Ce document ne modifie pas les anciennes archives ni les résultats déjà journalisés.

## 0. Contrat commun de preuve

Chaque lecture transporte, directement ou via une structure existante, `valeur`, `unite`, `source`, identité d'instrument, période mesurée, date d'observation et date de disponibilité. `capturedAt` est la capture locale ; ce n'est ni la publication ni une observation neuve. Une relecture du cache ne rajeunit jamais la donnée.

- **Identité** : source + symbole canonique + nature spot/perp/action/ETF + devise de cotation/règlement + intervalle/session. Même symbole sur deux sources ne suffit pas. USD, USDT et USDC ne sont pas identiques sans convention de conversion exposée ; un proxy ETF doit être nommé.
- **Causalité** : une lecture à `asOf` utilise uniquement ce qui était disponible au plus tard à `asOf`. Une période terminée n'implique pas publication. Une statistique révisée chargée aujourd'hui ne devient pas un ancien contexte. Une date de publication sans heure ne prouve pas une disponibilité intrajournalière ; première capture prouvée ou borne conservatrice de fin du jour concerné, timezone explicitée.
- **Instant courant** : pour les marchés, dernières barres closes pour l'estimation ; prix vivant séparé pour la valorisation. La clôture d'une bougie ne peut être connue à son ouverture.
- **Qualité** : `disponible`, `partiel`, `périmé`, `indisponible`, avec motif. Inconnu n'est jamais zéro ou neutre. Un taux non fini, une identité incertaine, une période invalide, une source incompatible ou un dénominateur nul refusent le calcul concerné.
- **Historique** : une série révisée sans millésime peut illustrer le passé avec cette limite ; elle ne certifie pas un signal historique. Les instantanés figés sont la preuve pour EXPY.
- **Présentation** : couverture et exclusions près du résultat ; aucune conclusion directionnelle validée, probabilité de gain ou causalité déduite d'une simple association.

## 1. Quadrants macro

Arbitrage de l'orchestrateur : croissance = rythme annuel de **production industrielle mensuelle**, inflation = rythme annuel CPI. Sur le mois commun `m`, calculer `g_m=100×(IP_m/IP_(m−12)−1)` et `π_m=100×(CPI_m/CPI_(m−12)−1)` si la source fournit les niveaux ; une série déjà transformée en a/a n'est pas transformée une seconde fois. Accélérations sur trois mois : `Δg=g_m−g_(m−3)` et `Δπ=π_m−π_(m−3)`, en **points de pourcentage**, jamais en rendement relatif. Le PIB réel a/a trimestriel reste un contexte distinct, sans substitution à l'axe production.

| Croissance | Inflation | Lecture descriptive |
|---|---|---|
| accélère | accélère | croissance et inflation accélèrent |
| accélère | ralentit | croissance accélère, inflation ralentit |
| ralentit | accélère | croissance ralentit, inflation accélère |
| ralentit | ralentit | croissance et inflation ralentissent |

Afficher pays, série, transformation (a/a, SA/NSA), les deux périodes espacées de trois mois et dates de disponibilité de chaque axe. Exiger les mois consécutifs nécessaires ; ne pas substituer le « troisième dernier point » à `m−3` en présence de trous. Comparer la même transformation, le même pays et la même série ; pas de mélange CPI global/core, nominal/réel ou révisé/initial. Un taux de croissance négatif qui remonte reste une contraction dont le rythme ralentit : ne pas le titrer « expansion ».

Neutralité numérique uniquement : `|Δ| <= 1e−9` ; ce seuil fixe n'est pas une bande de neutralité économique. Un axe neutre ou manquant donne un état de transition/indéterminé, pas l'un des quatre quadrants. La fraîcheur suit le calendrier de la série et une échéance configurée ; jamais le seul âge de la requête. Les deux axes utilisent le même mois de référence complet. Si l'un a dépassé son échéance, si les mois requis sont absents ou les séries incompatibles, quadrant indéterminé. La reconstitution « connu au » est limitée aux séries compatibles FRED/ALFRED existantes ; les autres restent une lecture courante/révisée, sans publication inventée.

Oracle : production a/a 2,1 % en `m−3` → 2,4 % en `m`, CPI a/a 3,2 → 2,9 % aux mêmes mois : `Δg=+0,3 pp`, `Δπ=−0,3 pp`, lecture « production accélère, inflation ralentit ». `Δ=5e−10 pp` est numériquement neutre. À l'instant précédant la publication de 2,9 %, cette valeur est interdite. Une révision ultérieure de 3,2 à 2,8 ne réécrit pas le quadrant capturé.

## 2. Stabilité du coût L2

La stabilité porte sur une série d'estimations d'exécution d'un **même montant cible en devise de cotation**, dans une même direction et un même marché. Elle ne mesure pas la probabilité que les ordres visibles soient encore présents à l'envoi.

Conserver la convention existante de `coutExecution` : consommation successive des niveaux jusqu'au **budget N en devise de cotation** (`Σprix×quantité=N`), achat ou vente selon le côté demandé. La quantité de base `q` est le résultat de cette consommation, pas `N/mid`. `mid=(bestBid+bestAsk)/2` et `VWAP = Σ(prix×quantité)/q`. Achat : `coûtBps=10 000×(VWAP_ask/mid−1)`. Vente : `coûtBps=10 000×(1−VWAP_bid/mid)`. Ces coûts incluent spread et profondeur, **pas** les frais ; ne pas ajouter de nouveau le spread. Le montant exécuté partiellement ne devient pas une estimation du budget complet. Une simulation distincte de quantité cible `q=N/mid` peut avoir une API explicitement nommée, mais ne change pas le sens des consommateurs existants ni leurs tests sous prétexte de correction.

Refuser carnet croisé, niveaux non finis/non positifs, ordre des niveaux incohérent, désynchronisation du flux, profondeur insuffisante ou instantané périmé. Une reconnexion/réinitialisation, un changement d'instrument, de montant ou de côté vide la fenêtre. L'échantillonnage représente le **temps passé à un coût**, pas un nombre de carnets indépendants : la même version encore fraîche peut être observée aux instants réguliers suivants, jusqu'à son expiration à 5 s. Une relecture ne change jamais le timestamp du carnet et aucune indépendance statistique des échantillons n'est revendiquée.

Fenêtres glissantes choisies : **1/5/15 minutes**, historique borné à 15 minutes en mémoire pendant la consultation. Au plus une observation par seconde à cadence fixe ; quantiles après au moins 20 échantillons valides, dernier carnet âgé de 5 s maximum. Afficher `n`, durée réellement observée, tentatives invalides et âge, sans label automatique « stable ». Deux couvertures distinctes : seaux valides / seaux de la fenêtre demandée ; seaux valides / seaux écoulés depuis le début effectif d'observation, bornés à cette fenêtre. Si seulement 20 s sont observées sur 15 min, la seconde peut valoir 100 %, la première vaut environ 20/900. Définir uniformément les bornes des seaux pour éviter les décalages d'un échantillon. Montrer médiane et **P95** ; quantiles par interpolation linéaire `h=(n−1)p`. Les changements de régime restent visibles même si la moyenne ne change pas.

Oracle : mid 100 ; budget d'achat **1 002** consommé en 5 unités à 100,1 et 5 à 100,3 → q=10, VWAP 100,2, coût 20 bps. Avec seulement 9 unités offertes dans la profondeur reçue : budget incomplet, coût cible indisponible, jamais 18 bps ou coût extrapolé. Un carnet inchangé peut contribuer aux seaux de temps jusqu'à 5 s d'âge ; ses relectures ne lui donnent pas 60 s de fraîcheur.

## 3. Rotation on-chain

Présenter des **variations d'activité/capital observées par chaîne**, pas une preuve qu'un investisseur a vendu une chaîne pour acheter l'autre. TVL en USD varie avec les prix ; volume DEX n'est ni flux net de capitaux ni utilisateurs uniques ; émission de stablecoins n'est pas achat crypto ; transfert interne/bridge peut compter plusieurs fois.

- Les comparaisons partagent métrique, devise, définition, horizon complet et borne de fin. Variation relative `100×(V_fin/V_début−1)` seulement si `V_début>0`. Volume : somme sur intervalles complets comparables, pas valeur instantanée opposée à un cumul.
- Part de chaîne `100×V_chaîne/ΣV_univers` seulement sur l'univers **Ethereum/Solana/Base/Arbitrum**, avec même couverture aux deux dates, horizons 30/90 jours. Δpart en points de pourcentage. Une chaîne manquante ne peut être retirée silencieusement du dénominateur. Persistance = proportion de transitions journalières communes valides avec Δpart strictement positive ; afficher le nombre de transitions et les jours couverts, pas la durée calendaire seule. Base n'a pas de token natif inventé ; comparaison au prix ETH/SOL/ARB séparée.
- Un classement utilise des observations existantes comparables. Absence de série historique ou d'observation appariée → « non comparable ». Une chaîne sans valeur n'est ni dernière ni à zéro.
- Fraîcheur, horizon, source et couverture doivent suivre le chiffre jusqu'à BRIEF/EXPY. Une hausse d'activité seule autorise « activité relative en hausse », pas « entrée nette » ni recommandation d'achat.

Oracle : A=100, B=100 puis A=120, B=180 : A croît de 20 %, sa part passe de 50 % à 40 %, soit −10 pp. On ne peut pas conclure à une rotation vers A. Si B manque à la fin, aucune part finale de A n'est calculable sur cet univers.

## 4. Transmission géopolitique

Séparer trois objets : événement rapporté, canal économique supposé, mouvement de marché observé. Une chaîne « événement → énergie → inflation → taux → actif » est une hypothèse de transmission ; ses flèches ne sont pas des causalités estimées. Nommer la zone, le canal, l'exposition et les conditions d'invalidation ; aucun score monétaire de perte sans modèle identifié.

Dates distinctes : occurrence annoncée, première publication connue, ingestion. Dédupliquer les reprises du même événement et qualifier les sources contradictoires. Avant/après : mesurer aux timestamps de marché valides, avec source et horizon identiques, sans combler une fermeture de marché par un prix futur. Sans prix d'avant publication connu ou sans heures fiables : pas de réaction chiffrée. La corrélation simultanée ne valide pas le canal supposé.

## 5. Contradictions BRIEF

Une contradiction est une paire de lectures nommées dont les implications sur **la même proposition** sont opposées. Chaque entrée porte thème, proposition, direction, horizon, instrument/périmètre, preuve et fraîcheur. Une métrique générique `haussier/baissier` sans mécanisme ne suffit pas.

- Même horizon et même périmètre : opposition comparable. Horizons distincts : « tension entre horizons », pas contradiction logique. Manquant/périmé : couverture insuffisante, pas opposition.
- Dédupliquer les preuves issues de la même donnée ou formule ; funding brut et percentile du même funding ne constituent pas deux confirmations indépendantes.
- Conserver les deux valeurs, leur période, leur source et la règle déclenchée. Un score moyen proche de zéro n'efface pas deux lectures fortes opposées.
- Pas de vote majoritaire transformé en probabilité ou conseil. Les hypothèses gamma, l'échantillon baleines et les sources partielles restent qualifiés.
- Le point de référence BRIEF est une copie enregistrée explicitement, avec date et version de règle. Delta numérique seulement si source, unité, horizon, définition et périmètre restent identiques ; sinon « méthode/source/périmètre changé ». Actualiser ne remplace pas cette référence en silence. La réhydratation conserve sa date, les données illisibles et les erreurs de sauvegarde restent récupérables.

Oracle : ETF BTC +100 M USD sur 7 j et netflow exchange +20 M USD sur 24 h → tension de flux à horizons différents, pas deux mesures incohérentes. Funding p95 et funding fortement positif → une seule famille de preuve. Régime indisponible + flux positif → pas « divergence ».

## 6. SCEN : vraie régression multifactorielle

### 6.1 Échantillon et unités

Pour une position, une **seule matrice commune** contient les rendements de l'actif et tous les facteurs retenus. Aucun coefficient ne provient d'une régression simple indépendante ensuite additionnée. L'ajustement conjoint minimise la somme des résidus carrés ; l'écart type résiduel utilise les degrés de liberté restant après tous les paramètres, intercept compris. [Référence primaire NIST](https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm).

Prix : `y_t=ln(P_t/P_précédent)` et `x_j,t=ln(F_j,t/F_j,précédent)`, sans unité, en décimal. Chaque série produit des variations entre deux dates d'observation réellement présentes ; la matrice fait une jointure sur le **couple exact (dateDébut,dateFin)**. Ne pas opposer un rendement crypto dimanche→lundi à un rendement ETF vendredi→lundi. Un couple vendredi→lundi est permis uniquement si toutes les séries utilisent ce même couple ; sa durée de trois jours reste déclarée. Ne pas comprimer silencieusement un trou inattendu, ni reporter un prix pour créer un zéro. Compter les lignes non appariées et conserver les durées calendaires réelles.

Les clôtures tradfi et crypto n'ont pas nécessairement le même instant ; DFII10 peut ne fournir qu'une date d'observation. Le mode accepté est **descriptif par dates**, sans prétention de synchronisation intraday : afficher en permanence « association de variations quotidiennes par dates — clôtures non synchrones ; données révisées disponibles au calcul ». Ne pas inventer une heure de publication ou de clôture à une date seule. Sans clôture/session prouvée, retenir au plus la date **D−2 UTC**, D étant le jour UTC du calcul, pour exclure conservativement les derniers jours potentiellement incomplets. Ce délai est une convention prudente de calcul, pas la preuve d'une heure de publication historique.

Facteurs de prix sélectionnables : BTC/ETH/SPX/DXY/or, défaut **BTC/SPX/DXY**. Les références existantes UUP, SPY et GLD sont affichées comme **proxies ETF** du dollar, des actions US et de l'or. Un choc sur UUP n'est pas un choc direct de taux d'intérêt. Facteur de taux optionnel arbitré : **DFII10**, taux réel US 10 ans, clé et loader existants. Ses valeurs source sont en % : `x_t = tauxPourcent_t − tauxPourcent_précédent`, en **points de pourcentage** ; choc UI de +25 bps → `+0,25 pp`, jamais +25 %, ni `ln(taux_t/taux_précédent)`. Bêta exprimé par point de pourcentage de taux réel. Oracle : β_taux=−0,04 par pp et +25 bps → contribution au log-rendement −0,01. Une série à taux négatifs reste calculable par différences. Nommer maturité, date d'observation, millésime lorsqu'il existe et heure de publication inconnue le cas échéant ; une date seule reste admise dans ce mode descriptif, clé absente ou couples de dates insuffisants → facteur indisponible.

Fixer l'instant de calcul, la fenêtre et la liste des facteurs au départ. L'estimation descriptive utilise les données récupérées pour ce calcul sous la borne de dates closes ci-dessus ; elle ne se présente pas comme une reconstitution historique « connu au » si les publications/millésimes ne sont pas prouvés. Un contexte capturé au signal peut certifier le modèle effectivement calculé alors, jamais attribuer rétrospectivement ce modèle aux anciennes dates de l'échantillon. Valoriser séparément au dernier prix connu de la **même identité**, avec sa date. Caches, regroupements, annulation des requêtes et résultats distinguent source/instrument/devise ; aucune substitution par la watchlist ou source PAPER par défaut lorsqu'une source explicite existe.

### 6.2 Ajustement, refus et diagnostic

`y = α + Xβ + ε`. Centrer et réduire les colonnes de X pour le calcul numérique, puis restituer les coefficients dans leurs unités d'origine. Résolution QR avec pivotement ou autre solveur stable disponible en TS pur ; pas d'inversion naïve de `X'X`, pas de dépendance nouvelle. `α = moyenne(y) − Σβ_j moyenne(x_j)`.

Garde-fous proposés : `k` facteurs, `n >= max(30, 10×(k+1))` lignes complètes, variance positive et finie de chaque colonne, rang complet. Tolérance numérique relative au scale de la matrice, pas une constante en dollars. Mesurer la colinéarité globale : pour chaque facteur, `VIF_j=1/(1−R²_j)` où `R²_j` vient de la régression de ce facteur sur **tous les autres**, avec intercept ; maximum >10 → modèle refusé « facteurs redondants ». Pour k=1, VIF=1. Le seuil 10 est une règle de prudence choisie, pas un test de validité économique. Ne pas retirer un facteur silencieusement ou présenter une régularisation comme OLS.

Sortie minimale : liste des facteurs, β dans les unités d'origine, α, n, période réelle, exclusions, `R²=1−SSE/SST`, `R²_ajusté=1−(1−R²)(n−1)/(n−k−1)`, et `σ_résiduelle=√(SSE/(n−k−1))`. `SST=0` donne R² indéfini. R² ajusté négatif est valide et reste négatif ; ne pas le ramener à zéro. R² mesure l'ajustement **dans l'échantillon**, jamais la probabilité de réussite, la causalité ou la validité d'un choc extrême. Ne pas afficher un intervalle prédictif certifié à partir de R² seul. La stabilité compare les coefficients des deux moitiés chronologiques fixées du même échantillon, avec mêmes facteurs et diagnostics. Une moitié qui échoue aux garde-fous donne « stabilité non estimable » ; aucun choix a posteriori de la coupure qui rassure le plus.

**Facteur propre** : si la position et un facteur sont exactement le même instrument, même source, devise, session et convention de prix, appliquer directement son choc (β propre=1, autres=0). Afficher « exposition directe », pas un R² de 100 % obtenu mécaniquement. Un BTC d'une autre source ou un perp n'est pas une identité stricte avec le spot BTC.

### 6.3 Application du choc

Le mode existant reste disponible ; le nouveau mode estime l'impact conditionnel d'un déplacement de facteurs, sans ajouter mécaniquement le drift historique. Pour chaque facteur de prix, choc UI `s_j` en % → `d_j=ln(1+s_j/100)` ; refuser `s_j<=−100`. Pour DFII10, utiliser le delta en points de pourcentage (`chocBps/100`) décrit plus haut. `z=Σβ_j d_j`, `r_estimé=expm1(z)`, `PnL_i = valeurSignée_i × r_estimé`. Cette formule respecte l'échelle des log-rendements ; ce n'est pas une promesse de comportement hors échantillon. Ne pas multiplier par le nombre de jours sans modèle d'horizon.

L'intercept est conservé dans l'ajustement/diagnostic mais exclu du choc relatif : tous les chocs nuls doivent donner un P&L nul. Si le métier conserve une approximation linéaire `valeur×z`, il faut la nommer et l'arbitrer explicitement ; le défaut proposé ici est `expm1`.

Positions non couvertes : P&L inconnu, exclusions visibles. Le total est intitulé « total des positions estimées » et couverture = `Σ|valeurSignée| estimée / Σ|valeurSignée| totale`, pas somme nette. Prix de valorisation inconnu : ne pas appeler « actuelle » une substitution au prix d'entrée ; exclure et expliquer. Une VaR n'est comparée que si périmètre, horizon et valorisation sont compatibles.

### 6.4 Oracles indépendants

Fixture algébrique courte pour le solveur (distincte du seuil d'acceptation en production) :

| ligne | x1 | x2 | y |
|---|---:|---:|---:|
| 1 | 0,01 | 0,01 | 0,011 |
| 2 | −0,01 | 0 | −0,019 |
| 3 | 0,01 | 0 | 0,021 |
| 4 | −0,01 | −0,01 | −0,009 |

Résultat attendu : `α=0,001`, `β1=2`, `β2=−1`, SSE=0, R²=1. Les deux régressions simples donnent respectivement 1,5 et 1 : leur somme serait fausse. Pour 10 000 USD long, chocs +10 % / −5 % : `z=2ln(1,10)−ln(0,95)=0,2419136539962`, P&L = **+2 736,842105 USD** ; short de même valeur : montant opposé. Chocs nuls : 0, même avec α=0,001.

Refus à couvrir : `x2=2x1` (rang déficient) ; dépendance `x3=x1+x2` même si aucune paire n'est parfaitement corrélée ; série constante ; 29 lignes ; borne de date manquante ; observation au-delà du cutoff D−2 ; marque courante présente mais barre en cours exclue du fit ; même ticker/deux sources ; choc ≤−100 % ; sortie non finie. La date seule DFII10 est au contraire un cas valide du mode descriptif si les couples de dates, unités et effectifs satisfont le contrat.

## 7. Carry net : long spot, short perp linéaire

Le premier modèle couvre une quantité égale `q` de sous-jacent, spot acheté et perp linéaire vendu, d'abord **Binance BTCUSDT/ETHUSDT**. Les calculs sont alors en USDT, affichés comme tels ; les exemples USD ci-dessous illustrent la formule pour un instrument intégralement coté/réglé en USD. Contrats inverses, multiplicateur inconnu, unité de taille différente, règlement non compatible ou FX manquant : calcul indisponible. Ne pas prétendre « neutre » avec deux notionnels égaux lorsque les quantités de sous-jacent diffèrent à cause de la basis.

`S0,F0,ST,FT` sont les références spot/perp d'ouverture et de fermeture projetée. Les références d'ouverture proviennent d'acquisitions rapprochées, qualifiées selon la preuve disponible ci-dessous ; la simultanéité de cotation n'est pas garantie par REST. `B0=F0−S0`, `BT=FT−ST`. P&L prix = `q(ST−S0)+q(F0−FT)=q(B0−BT)`. Un perp n'a pas d'échéance garantissant `BT=0` : la basis terminale est une **hypothèse visible**. Ne pas compter la basis d'ouverture comme gain acquis, ni une seconde fois dans le funding.

Pour un short : funding réalisé reçu `Σ q×prixRéférenceRèglement_k×f_k`, où `f_k` est le taux **par règlement**, signé positif lorsque les longs paient les shorts. Référence de notionnel selon le contrat, pas nécessairement le mark : Hyperliquid utilise le prix oracle pour ce paiement. Cadence future et taux futur restent hypothétiques ; l'historique réalisé ne les garantit pas. [Documentation officielle Hyperliquid](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding).

Coûts complets :

`C_frais = q(S_exec_entrée×feeSpotEntrée + F_exec_entrée×feePerpEntrée + S_exec_sortie×feeSpotSortie + F_exec_sortie×feePerpSortie)`.

Il y a **quatre exécutions**, avec leurs propres notionnels, tarifs maker/taker et hypothèses de sortie. Des frais manquants ne valent pas zéro. Si on part des prix réellement exécutables/VWAP, spread et slippage sont déjà dans le P&L prix ; ne pas les soustraire deux fois. Si on part de mid/prix de référence, soustraire explicitement le coût des quatre jambes estimé séparément.

`PnL_net = PnL_prix + funding − C_frais − C_exécutionNonIncluse − C_financement − autresCoûtsExplicites`.

Présenter aussi les variantes funding nul et funding inversé, mêmes autres hypothèses. À coûts et notionnels de règlement explicitement figés, funding constant par règlement au seuil de rentabilité : `f_seuil=(coûtsTotaux−q(B0−BT))/ΣnotionnelsRèglement`. Si le nombre de règlements est nul, seuil funding indéfini. Si les coûts varient avec l'hypothèse de sortie, les recalculer ; ne pas afficher la formule à coûts figés comme une solution exacte d'un problème où ils changent.

Financement : distinguer spot payé cash et spot emprunté ; coût d'opportunité éventuel séparé et déclaré. Rendement net de base = `PnL_net/(q×S0)` avec dénominateur nommé « notionnel spot initial ». Rendement sur capital immobilisé seulement si ce capital (spot + marge + réserves) est explicitement fourni ; ne pas assimiler marge initiale et capital total. Annualisation simple éventuelle `rendement×365/jours`, nommée extrapolation, jamais rendement garanti ou APY composé.

Projection par durée : compter les timestamps de règlement dans l'intervalle de détention selon convention d'entrée/sortie explicite ; pas `APR×durée` avec une cadence arbitraire. Dernier taux connu ramené à l'heure = hypothèse de taux constant, pas observation future. Un historique manquant n'est pas un règlement à taux zéro. La cadence observée expire selon le contrat FUNDX existant ; ne pas appliquer la cadence actuelle rétroactivement.

Le REST spot existant ne prouve pas nécessairement l'heure de cotation. Conserver pour chaque jambe le début et la fin de requête et le timestamp source lorsqu'il existe. Acquisitions acceptées pour la simulation si leurs fenêtres de requête se chevauchent, avec durée/âge locaux bornés à 5 s ; sinon renouveler ou marquer indisponible. Ces mesures prouvent seulement des **acquisitions rapprochées**, pas des cotations simultanées ni une fraîcheur de marché certifiée. Afficher la réserve « heure de cotation spot inconnue » lorsqu'elle l'est ; ne jamais remplacer `observedTs` absent par le temps de réception. Si les deux timestamps source sont connus, vérifier aussi leur cohérence et leur écart. Ne pas calculer la basis d'une clôture daily et d'un mark live. Hypothèses manuelles acceptables uniquement si nommées « simulation saisie ».

Oracle de trésorerie, toutes valeurs en USD : `q=1`, `S0=100`, `F0=101`, `ST=110`, `FT=110,5`. Prix de référence → P&L prix `10−9,5=+0,5`. Frais spot 0,1 % par exécution, perp 0,05 % : `0,1+0,0505+0,11+0,05525=0,31575`. Trois règlements supposés à `f=0,0001` avec notionnel de référence 100 chacun : +0,03. Coût financement 0,02 et exécution non incluse 0,04 → **net +0,15425**, soit **0,15425 %** du notionnel spot initial. Ici les frais sont évalués sur les notionnels de référence par hypothèse explicitée ; en mode exécution ils portent sur les prix exécutés. Si la basis terminale vaut 2 au lieu de 0,5, P&L prix = −1 avant tous coûts : funding positif n'empêche pas la perte.

Refus à couvrir : devise incompatible, taux traité en % au lieu de décimal (0,01 % = 0,0001), notionnel ou quantité non positive, prix invalide, seulement deux frais, funding négatif inversé, cadence inconnue, acquisitions non rapprochées ou timestamps source contradictoires, profondeur partielle, horizon nul/négatif, coût non renseigné, dépassement numérique. L'absence d'horodatage source spot reste une limite affichée, pas une heure inventée. Pas de recommandation d'arbitrage sans risque : basis, liquidité, marge/liquidation et contrepartie restent hors garantie du calcul.

## 8. EXPY : résultats par contexte figé

Une catégorie de contexte est capturée **au signal ou à la décision**, avant la première exécution concernée : timestamp, source, instrument, horizon, valeurs, qualité et version de la règle de classement. Copier les scalaires nécessaires ; aucun pointeur vers un store vivant. Une archive historique partielle reste partielle ; pas de remplissage avec le régime actuel ou une série révisée. Un contexte daté après l'entrée n'est pas un contexte d'entrée prouvé.

La preuve d'un dossier créé depuis une ancienne alerte peut être utilisée si elle a bien été figée à l'alerte et si `preuve.ts<=ouvertTs`. La seule date de création du dossier ne suffit pas ; une édition de thèse/revue ne modifie pas la preuve. Les imports inconnus vont dans « contexte non prouvé », visible et compté.

Un trade fermé contribue **une seule fois** à une partition par contexte. Plusieurs dossiers identiques au même contexte se dédupliquent ; contextes opposés sur plusieurs décisions/renforts donnent « contexte mixte » au niveau du trade fusionné. Ne pas choisir après coup le dossier qui explique le gain. Des vues multi-étiquettes restent explicitement non additives ; ne pas totaliser leurs effectifs comme des trades distincts. Déduplication stable par identifiant de trade.

R exige une preuve du stop de référence et du risque positif : `risqueUSD=|entrée−stopInitial|×taille`, `R_brut=signe×(sortie−entrée)×taille/risqueUSD`. Frais/funding absents : nommer « R prix brut », jamais R net. Le contrat PAPER existant garde son stop initial après renfort et utilise entrée moyenne/taille totale : ce R fusionné n'est pas celui de la première tranche. `null`/champ historique absent, risque nul/non fini, trade ouvert, tailles invalides : exclure des R et compter le motif. Ne pas déduire un stop initial du stop final.

Pour chaque groupe, afficher au minimum : nombre total, fermés, `n_R` exploitables, sans R, contexte incomplet/mixte, période de clôture, moyenne R, médiane R, gains/pertes/breakeven. `E_R=ΣR/n_R`. `winRate=n_gagnants/n_R`, breakeven inclus au dénominateur (c'est le comportement actuel du code EXPY ; le commentaire disant le contraire doit être corrigé dans le lot). Profit factor `ΣR_positifs/|ΣR_négatifs|` ; sans perte, afficher « sans perte observée / indéfini », pas une assurance de performance infinie.

Incertitude minimale : `s²=Σ(R−E_R)²/(n_R−1)` et `SE=s/√n_R` pour `n_R>=2`. Afficher n et s ; un intervalle de Student optionnel est `E_R ± t_(0,975,n_R−1)×SE`. Il suppose des observations indépendantes et une distribution compatible ; les trades corrélés/chevauchants rendent cette hypothèse fragile. En l'absence d'intervalle implémenté et vérifié, afficher la dispersion et l'avertissement d'effectif, pas un faux « IC 95 % » égal à ±1,96s. [Référence primaire NIST](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm).

`n_R<30` : mention « petit échantillon » ; le seuil 30 ne valide pas les groupes au-dessus. Pas de classement « meilleur contexte » présenté comme preuve de supériorité, ni test significatif après recherche de dizaines de catégories. La vue est descriptive ; comparaison honnête = mêmes conventions de R/coûts, qualité de preuve et périodes comparables. Montrer la concentration temporelle (jours/périodes distincts) quand des décisions proches gonflent l'effectif.

MAE/MFE uniquement si la trajectoire de la période réellement détenue a été enregistrée ; jamais reconstruites depuis le seul résultat final ou le marché rechargé aujourd'hui.

Oracle : R `[2,−1,0,1,−0,5]` → n=5, somme=1,5 R, moyenne=0,3 R, médiane=0, win rate=2/5=40 %, profit factor=3/1,5=2, `s≈1,20415946`, `SE≈0,53851648`. L'IC Student indicatif à 95 % (t à 4 ddl ≈2,7764451) est `[−1,19516145 ; 1,79516145]` : moyenne positive ne prouve pas avantage positif. Ajouter un trade sans stop ne modifie pas ces cinq R ; total et nombre exclus augmentent. Modifier le régime courant ne déplace aucun trade archivé entre groupes.

## 9. Acceptation minimale des lots

Les développeurs fournissent des tests ciblés sur les oracles ci-dessus et les refus pertinents, avec un contrôle de rendu qui distingue absence, péremption et zéro. Tester aussi sérialisation/réhydratation du contexte, mutation ultérieure des objets source, données futures, instrument identique sur deux sources et contrats spot/perp distincts. La vérification finale conserve les budgets inchangés ; ce contrat ne demande aucun nouveau fournisseur pour faire disparaître un état indisponible.

Les seuils de fraîcheur/échantillon sont susceptibles d'arbitrage par l'orchestrateur avant implémentation. Tout écart aux unités, à l'OLS conjointe, à l'identité des instruments, aux cashflows quatre jambes ou à la causalité des contextes est un défaut bloquant de revue.
