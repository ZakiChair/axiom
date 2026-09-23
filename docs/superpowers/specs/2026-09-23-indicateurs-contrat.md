# Contrat financier du lot C

Contrat fourni et validé le 23 septembre 2026 par le réviseur indépendant (Astra),
avant implémentation (Sol). Complète la conception des quatre lots, sans nouveau
fournisseur, dépendance, service, clé ou fenêtre.

## Liquidations / OI

Même perp Binance USDT, même intervalle Coinalyze, mêmes unités USD pour L, S et OI.
Le dénominateur du bucket courant est la clôture du bucket immédiatement précédent,
exactement adjacent, donc l'OI observé à l'ouverture du bucket courant. Nouvel aux
`oiDebutLiqUsd` : `fetchOpenInterestHistory` au timeframe du chart, un bucket de chauffe
antérieur ; ne pas reprendre l'aux `oi` existant, fixé à 1 h.

Appariement exact de `liqLongUsd`, `liqShortUsd` et du dénominateur ; aucun report d'un
flux à travers un trou. Longs = −100 L/OI ; shorts = 100 S/OI ; total = 100 (L+S)/OI ;
net = 100 (S−L)/OI. OI absent/non fini/≤0 : inconnu. Jambe absente/non finie/négative :
inconnue ; total/net nécessitent les deux jambes. Un zéro observé reste zéro. Aucun
plafond à 100 %. Titre : « Intensité des liquidations — % de l'OI initial ».

Timeframes : 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d. Clé Coinalyze existante
requise. Profondeur effective explicitée ; documentation : 1 500–2 000 observations
intraday, aucune promesse générale de 90 jours.

Oracle : L=200, S=100, OI=10 000 → −2 %, +1 %, 3 %, −1 %.

## Corrélation et bêta baissiers

Rendements log x du close actif et y du close référence. Benchmark choisi par le
`refSymbolStore` existant, nouvel aux `refCloseStrict` apparié exactement sur
l'ouverture et le timeframe. Le contrat LOCF de `refClose` existant reste intact.
Cache référence par symbole et timeframe ; profondeur existante de 720 bougies.

Fenêtre des N derniers emplacements de rendement, N=100 par défaut (20–500). Sur cette
fenêtre complète, sélectionner uniquement y<0. Minimum de baisses=20 (3–N). Une paire
manquante, non positive ou non finie invalide toute la fenêtre. Aucune exclusion
opportuniste ou recherche de baisses antérieures hors fenêtre.

Moyennes calculées sur les baisses : corr = Σdxdy / √(Σdx² Σdy²) ; bêta = Σdxdy / Σdy².
Moments centrés, constante implicite. Variance de référence numériquement nulle :
deux inconnus. Actif constant, référence variable : corrélation inconnue, bêta zéro.
Corrélation bornée à [−1,1], bêta non borné. Nombre de baisses conservé pour diagnostic,
visible en annotation, jamais tracé sur le même axe que la corrélation ou le bêta.

Oracles : x=2y sur baisses → bêta2/corr1 ; x=−2y → −2/−1. Modifier les rendements
pendant les hausses du benchmark n'affecte pas le résultat. Tests des trous, minimum,
variance, fenêtres et invariance du préfixe lorsqu'on ajoute des données futures.

## Funding historique et dispersion

Cohorte fixe de quatre venues : Binance, Bybit, OKX, Hyperliquid. Même couche de
clients/cache/normalisation pour FUNDX et l'indicateur ; même fonction pure de calcul
exportée par `@axiom/indicators`. Chargement à la demande ; cache/promesse en vol par
venue et symbole ; au maximum 90 jours demandés, couverture effective distincte.
Vue FUNDX : choix 7/30/90 jours, défaut 7 jours. Conserver le snapshot live distinct.

Endpoints et bornes :

- Binance : client `fetchBinanceFundingHourly` déjà corrigé, transport `extUrl`,
  `/fapi/v1/fundingRate`, croissant, 1 000/page, au plus 5 pages, délai 8 s corps JSON
  compris ; règlements `Regular` seulement.
- Bybit : `/v5/market/funding/history?category=linear&symbol=BASEUSDT&limit=200&endTime=…`,
  `retCode=0`, décroissant ; pagination `endTime=minTs−1`, au plus 12 pages.
- OKX : `/api/v5/public/funding-rate-history?instId=BASE-USDT-SWAP&limit=400&after=…`,
  `code=0` ; `after` vers les lignes anciennes, au plus 6 pages. Utiliser uniquement
  `realizedRate`, jamais `fundingRate` prédit.
- Hyperliquid : POST `/info`, type `fundingHistory`, vrai coin natif, fraction horaire.
  Ne pas utiliser aveuglément les conversions `Number('')` ni le filtrage de doublons
  du parseur historique existant. Page de 500 éléments, progression temporelle sans
  doublonner le timestamp inclusif, au plus 8 pages ; détection de non-progression
  et d'épuisement avant couverture demandée.

Bybit/OKX : endpoints officiels sondés HTTP200/code0 avec CORS depuis localhost.
Transports existants seulement ; pas de nouvelle whitelist/proxy. Chaque requête
est bornée en durée, corps JSON inclus. Une venue en échec n'efface pas les autres.

Pour CEX, `rate/intervalH` n'est connu qu'après deux intervalles antérieurs cohérents,
tolérance de 60 s sans arrondir les timestamps. Cadences BN/BY : 1/2/4/8 h ; OKX :
1/2/4/6/8 h. Endpoints Bybit/OKX établissent leur nature réglée : ne pas exiger un champ
`rateType` inexistant. Taux/types inconnus, contradictions et trous restent des
barrières. Validité exclusive jusqu'à t+cadence observée ; Hyperliquid jusqu'à t+1 h.
Ne pas appliquer les informations d'instruments actuelles au passé.

À l'instant τ, prendre le dernier règlement connu à τ uniquement si τ<validUntil.
APR = hourly × 24 × 365 × 100 ; σ = √(Σ(APR−moyenne)²/4), population équipondérée,
unité points d'APR. Min/max conservés. Une venue inconnue → σ/min/max inconnus ; nombre
de venues connues 0–4 distinct. Jamais de réduction dynamique de la cohorte.

Réutiliser les règles existantes de clôture exacte, calendrier UTC et bornage à
l'instant présent dans AuxProvider. FUNDX montre plage demandée/effective, couverture,
trous sans liaison graphique, venue en défaut, source et cadence observée. Données
strictes nouvelles séparées des séries historiques aux contrats moins stricts si
nécessaire ; les aux exacts sont annoncés avant implémentation.

Oracles : APR [0,2,4,6] → σ=√5, min0, max6 ; valeurs identiques →0 ; une venue absente
→σ inconnu. Tests : exactitude à ±1 ms, préfixe causal, cadences/transitions/gaps/
expiration, doublons contradictoires, taux vides, OKX prédit≠réalisé, pagination,
timeout du corps JSON, changement de symbole pendant chargement et cache partagé.

## Sources primaires vérifiées par le réviseur

- [Coinalyze API](https://api.coinalyze.net/v1/doc/)
- [Bybit Funding Rate History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate)
- [OKX Funding Rate History](https://app.okx.com/docs-v5/en/#public-data-rest-api-get-funding-rate-history)
- [Hyperliquid Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
- [Hyperliquid Info — pagination](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)

Production : `/root/fix_paper` après A/G. Revue : `/root/review_product`. Les fichiers
réservés et parcours navigateur sont ceux du plan, port 5246 pour l'E2E C.
