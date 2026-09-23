# Analyse multidomaine — huit ajouts

## Demande et résultat attendu

Le propriétaire a donné « Go pour les points mentionnés » après une proposition
numérotée de huit fonctions. Ce chantier réalise les huit, dans les fenêtres
existantes : macro croissance/inflation, stabilité de liquidité, rotation des
chaînes, transmission géopolitique, synthèse des contradictions, sensibilités
multifactorielles, carry net et résultats par contexte de décision.

L'utilisateur doit pouvoir parcourir les preuves qui soutiennent une lecture,
identifier son horizon et ses inconnus, puis retrouver exactement le contexte
disponible lorsqu'il a pris une décision. Le résultat n'est pas une stratégie
validée ni une recommandation automatique d'exécution.

## Contraintes communes

- 39 fenêtres, 214 indicateurs, 9 identifiants de marché ; aucune fenêtre,
  dépendance, infrastructure, clé de trading ni fournisseur nouveau.
- Fenêtres existantes, calculs TypeScript purs, acquisition à la demande et
  caches existants. Pas d'enregistrement de ticks permanent.
- Aucun changement de politique proxy, d'environnement Vercel ou de secret.
- Budget initial maximal : 1 220 000 octets bruts et 360 000 octets gzip.
  Les nouveaux panneaux et collecteurs sont chargés à l'ouverture ; les types
  et le registre de contexte partagé restent légers.
- Une absence n'est pas un zéro. Source, instrument, unité, période observée,
  récupération et éventuel millésime restent distincts.
- Les états périmés, partiels et incompatibles sont visibles. L'historique
  révisé n'est jamais présenté comme une observation connue au signal.
- Les mutations personnelles gardent les conventions de durabilité existantes :
  erreur visible, réessai, export d'une archive illisible avant remplacement.
- Le contrat mathématique associé précise les formules, refus et oracles :
  `2026-09-23-analyse-multidomaine-contrat.md`.

## 1. Macro — croissance et inflation

Dans MACRO/RATE, une vue complémentaire compare les zones disponibles. Axe
croissance : changement du rythme annuel de production industrielle, avec le
PIB réel annuel comme contexte distinct. Axe inflation : changement du rythme
annuel CPI. La méthode et les périodes comparées sont explicites ; un manque de
mois consécutifs empêche le classement correspondant. Un niveau négatif de
croissance et une décélération de croissance sont des choses différentes.

La vue montre accélération/décélération sur chaque axe, les valeurs, la période
commune, l'évolution historique et les transitions. Les sources actuelles et la
vue ALFRED « connu au » sont conservées ; une source non compatible est indiquée
comme courante et ne participe pas à une reconstitution historique causale.
Les huit zones restent sélectionnables même si certaines sont indisponibles.

## 2. Microstructure — stabilité du coût d'exécution

DOM conserve, uniquement pendant la consultation, des observations régulières
du coût d'achat et de vente pour le notionnel choisi. La vue présente coût
courant, médiane, percentile défavorable, couverture du notionnel et durée
observée. Les périodes sans carnet exploitable font partie de la couverture.

Les fenêtres 1/5/15 minutes utilisent un historique borné en mémoire. Un
changement de source/symbole/notionnel et une discontinuité du carnet invalident
la série correspondante. Les observations ne sont pas pondérées par le nombre
de messages WebSocket. Un carnet ne garantit ni exécution ni liquidité future.

## 3. On-chain — rotation historique d'une cohorte fixe

CHAIN complète la comparaison Ethereum/Solana/Base/Arbitrum par l'évolution des
parts sur 30/90 jours, la variation en points et la persistance des gains de
parts. Chaque métrique garde la cohorte des quatre chaînes et des dates communes.
La disparition d'une chaîne ne gonfle pas artificiellement les parts des autres.

Stablecoins et TVL restent des stocks USD ; DEX, frais et revenus sont des flux
journaliers USD. La comparaison au prix du token est distincte, avec ETH/SOL/ARB
identifiés ; Base n'a pas de token natif inventé. Les évolutions en USD ne sont
pas renommées « entrées nettes » ou « utilisateurs ». Les horizons et séries
réellement couverts restent affichés.

## 4. Géopolitique — transmission et exposition

GLOBE permet de prendre un événement réellement sourcé comme point de départ
d'un scénario : événement → canal énergie/transport/inflation/taux/dollar →
actifs exposés de la watchlist. La qualification est explicite et modifiable,
pas déduite d'un titre par un classement opaque. Les relations économiques
portent une explication et une source documentaire.

Les faits observés, les réactions de marché mesurées à horizon disponible et
les hypothèses sont affichés séparément. Les horaires approximatifs excluent
une mesure intraday précise. Les actions ouvrent le graphique de l'instrument
exact ou SCEN avec des chocs laissés à l'appréciation de l'utilisateur ; aucune
probabilité de conflit ou variation de prix n'est inventée.

## 5. BRIEF — changements et contradictions

Une section assemble les lectures macro, micro, on-chain et géopolitiques avec
le contexte prix/funding/flux déjà disponible. Les règles de rapprochement sont
nommées et expliquées : concordance, divergence descriptive, horizon différent
ou comparaison impossible. Une différence d'horizon n'est pas une contradiction
statistique. Aucun nouveau score global arbitraire n'est créé.

Un point de référence explicitement enregistré permet de voir les changements
depuis le précédent brief : valeur, état, source ou couverture. Les changements
de source/unité/horizon ne produisent pas de faux delta numérique. Actualiser
réutilise les loaders existants ; micro ne prétend couvrir que le temps observé.
La référence locale conserve sa date et survit au rechargement, avec export et
état d'échec de sauvegarde. Chaque lecture propose un lien vers sa preuve.

## 6. SCEN — sensibilités simultanées

Le mode existant est conservé. Un mode supplémentaire ajuste une régression
jointe avec constante, sur couples de dates d’observation communs, en utilisant
des facteurs sélectionnés parmi les prix déjà disponibles et le taux réel US.
Les rendements de prix et les variations de taux ont des unités distinctes.

Les clôtures quotidiennes crypto, ETF et taux ne sont pas synchrones. La vue
affiche cette limite et décrit une association par dates ; elle ne reconstruit
pas des heures de publication ni un millésime ancien. Les observations de dates
seules sont bornées conservativement à D−2 UTC.

La vue expose coefficients, unités, dates, effectif, qualité d'ajustement,
dispersion résiduelle et stabilité entre sous-périodes. Rang déficient,
colinéarité excessive, données insuffisantes et facteur identique à l'actif
sont traités explicitement. Les chocs sont hypothétiques ; l'ajustement historique
n'est pas une attribution causale ni une garantie de prévision.

## 7. FUNDX — carry net

Une calculatrice spot/perp utilise des cotations synchronisées du même actif et
de la même devise, d'abord Binance BTCUSDT/ETHUSDT, où les deux jambes publiques
sont disponibles. Elle affiche quantité couverte, bases d'entrée/de sortie,
horizon, funding observé, hypothèse future, frais et coût des quatre exécutions.

Le résultat distingue convergence de base, financement projeté, frais et
slippage. Hypothèses de sortie et de funding modifiables, scénarios de funding
nul/inversé et seuil de rentabilité. Les coûts inconnus ne valent pas zéro ; les
valeurs de frais sont des hypothèses utilisateur clairement identifiées. Aucun
rendement garanti ni annualisation dissimulant le capital immobilisé.

## 8. EXPY — résultats selon le contexte figé

Le registre léger des lectures permet de copier le contexte au déclenchement
d'une alerte. Le dossier conserve les faits alors disponibles, avec leur qualité,
sans nouvelle acquisition ni ajout rétrospectif. Les anciens dossiers restent
sans cette preuve ; une capture manuelle ultérieure est datée comme telle.

EXPY groupe les trades fermés reliés aux dossiers par quadrant, qualité de
liquidité, rotation ou divergence. Un trade lié à plusieurs dossiers n'est pas
compté plusieurs fois dans le total ; les cohortes qui se chevauchent sont
signalées. Effectif, exclusions, moyenne/médiane R, dispersion et incertitude
sont visibles. Le R exige un risque initial prouvé. Les excursions ne sont
affichées que si leur trajectoire est effectivement enregistrée.

## Architecture et intégration

Calculs purs et petits composants par lot. Un module de types/validation et un
registre vanilla léger portent les lectures entre surfaces ; seuls les
producteurs possèdent leurs acquisitions. BRIEF utilise des imports dynamiques
pour son actualisation. Le chemin chaud des marchés ne dépend pas des panneaux.
Le contexte est une copie JSON finie et bornée, jamais une référence à un store
mutable. Les nouvelles clés personnelles entrent dans les sauvegardes existantes.

## Vérification

Oracles numériques indépendants, dates futures/révisées, trous, sources changées,
cas de rang déficient, sorties de carry à base différente, reprise après panne
de stockage et anti-double-comptage. Tests de composants et parcours Chromium
hermétiques pour chacune des huit surfaces. Revue indépendante des calculs et
interfaces ; `pnpm check`, budget d'entrée et `pnpm check:e2e` en fin de chantier.
Les contrôles réseau réels sont bornés et n'exposent aucune clé personnelle.

## Sources de méthode consultées

- FRED/ALFRED : https://fred.stlouisfed.org/docs/api/fred/realtime_period.html
- Colinéarité/rang : https://www.statsmodels.org/stable/pitfalls.html
- GPR, menaces et actes : https://www.matteoiacoviello.com/gpr.htm
- PortWatch : https://www.imf.org/en/publications/wp/issues/2025/05/16/nowcasting-global-trade-from-space-566957
- Adresses actives et limites : https://docs.coinmetrics.io/network-data/network-data-overview/addresses/active-addresses

Ces sources documentent les méthodes ; elles ne prouvent pas les droits ou la
couverture effective d'une clé personnelle au moment de l'utilisation.
