# Options BTC / ETH — revue du 28 septembre 2026

Demande : vérifier DEX/GEX après la grande expiration récente et rendre le marché
des options plus lisible dans AXIOM. Périmètre : OMON, calculs Deribit et leurs
consommateurs existants (régime et niveaux du graphique). Aucun fournisseur,
aucune dépendance, aucune fenêtre supplémentaire.

## Diagnostic vérifié

- La production recharge OMON chaque minute ; elle ne conserve pas une chaîne
  persistante de plusieurs jours. Les réponses publiques du 28 septembre à
  11:00 UTC contiennent 944 options BTC et 796 options ETH, sans échéance passée.
  La première échéance est le 29 septembre à 08:00 UTC.
- `underlying_price` est le **forward de l'échéance**, pas l'index spot commun.
  Le code prenait le premier forward de la réponse pour calculer toute la chaîne.
  Permuter cette réponse pouvait donc changer artificiellement les expositions.
- L'heure de mise à jour OMON avançait aussi après un échec ; changer BTC/ETH
  pouvait laisser temporairement les valeurs de l'ancien actif à l'écran.
- L'histogramme représentait l'échéance sélectionnée, tandis que les grandes
  tuiles représentaient toutes les échéances. Les deux portées se côtoyaient.
- Les caches de dix minutes pouvaient traverser une expiration. Les niveaux du
  graphique pouvaient rester affichés après un échec de rechargement.

## Vérification indépendante sur données publiques

Instantanés bruts recueillis dans `/tmp/axiom-options-20260928/` par les méthodes
publiques `get_book_summary_by_currency?currency=BTC|ETH&kind=option` et
`get_index_price?index_name=btc_usd|eth_usd`.

Les montants ci-dessous sont ceux de ces instantanés, **pas des cours en direct**.
La comparaison utilise exactement les mêmes contrats, OI, IV et heures ; seul le
modèle de référence de prix change. Calcul indépendant Python (`math.erf`).

| Mesure | BTC | ETH |
|---|---:|---:|
| Index spot (USD) | 83 006,77 | 2 659,32 |
| Open interest (sous-jacent) | 349 998,1 BTC | 1 184 562 ETH |
| Notionnel OI à l'index | 29,052 Md$ | 3,150 Md$ |
| Ratio OI puts/calls | 0,531 | 0,545 |
| GEX ancien calcul (USD / mouvement de 1 %) | +207,902 M$ | +13,065 M$ |
| GEX corrigé (même convention call+ / put−) | +183,087 M$ | +12,958 M$ |
| DEX ancien calcul (USD notionnels) | +4,684 Md$ | +581,708 M$ |
| DEX corrigé | +4,466 Md$ | +602,011 M$ |

Le 30 octobre et le 25 décembre concentrent respectivement 34,12 % et 34,00 % de
l'OI BTC. Le 25 décembre concentre 44,64 % de l'OI ETH. L'encours actuel ne permet
pas de reconstruire le montant exact supprimé le 25 septembre sans instantané
antérieur ; aucune variation historique n'est déduite de cette seule capture.

La concentration des maturités change aussi la lecture du signe : le GEX BTC des
échéances à sept jours au plus est **−15,688 M$/1 %**, malgré un total positif.
Pour ETH, cette même fenêtre représente **+1,017 M$/1 %**. Un total de chaîne
ne décrit donc pas à lui seul l'exposition des prochaines expirations.

## Méthode

La [spécification Deribit des options inverses](https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options)
distingue index X et forward F de chaque échéance. Avec T en années et sigma en
fraction : `R = ln(F/X)/T`, `d1 = (ln(F/K) + sigma²*T/2)/(sigma*sqrt(T))`.
Le delta est `N(d1)` pour un call et `N(d1)-1` pour un put ; le gamma spot est
`phi(d1)/(X*sigma*sqrt(T))`. Le profil en prix conserve la base F/X de chaque
option. Ce profil demeure un scénario à IV et base constantes.

GEX : gamma × OI × X² × 0,01, avec convention de signe annoncée.
DEX : delta signé × OI × X. OI en BTC/ETH, multiplicateur 1.
Ces expositions modélisées ne révèlent pas les positions nettes des dealers.

La [documentation du résumé de carnet](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)
décrit les valeurs de marché et `creation_timestamp`. L'heure d'observation
est conservée distinctement de la réception locale. Les échéances se règlent à
08:00 UTC, ce qui doit aussi borner les caches.

## Organisation et critères de sortie

- Lot données : transport Deribit, index/forward, jambes valides, calculs communs,
  cache et niveaux. Régressions numériques, invariance par permutation, expiration,
  absence de source et temporisations.
- Lot interface : identité BTC/ETH, chargement/fraîcheur, portées cohérentes,
  synthèse et tableau des échéances. Parcours navigateur sur frontière 08:00 UTC,
  erreur réseau et changement de devise.
- Revue indépendante des calculs et du diff, puis typage, tests du monorepo,
  construction avec budget initial et parcours navigateur pertinents.

## Vérifications effectuées

- Le calcul TypeScript est confronté aux mêmes instantanés par un second programme :
  écarts GEX inférieurs à 0,000001 USD ; écarts DEX de 12,70 USD pour BTC et 4,03 USD
  pour ETH, compatibles avec l'approximation de la fonction normale du dépôt.
  Inverser l'ordre des contrats conserve les résultats, le scénario principal et le
  profil au spot donnent le même GEX.
- Contrôle navigateur avec les API réelles en production puis en développement :
  échéances postérieures au 25 septembre, index spot distinct du forward, douze
  échéances par actif, provenance et trois horloges visibles. Sur BTC, passer à
  l'échéance sélectionnée aligne les tuiles GEX/DEX sur la ligne correspondante.
- La revue indépendante a fait corriger la réactivation d'anciens niveaux après
  expiration et le passage du vrai index au calcul du skew. Les OI inconnus sont
  explicitement partiels ; un zéro valide reste distinct d'une absence.
- Le max pain ne renvoie plus un strike arbitraire sans OI positif exploitable ;
  les OI négatifs/non finis sont ignorés. Quatre régressions supplémentaires
  couvrent cette correction du calcul partagé.
- REGIME/BRIEF gardent leur cadence propre de quinze minutes : leur cache refuse
  une lecture après expiration, mais ils ne sont pas présentés comme un flux à la
  seconde. OMON et la couche de niveaux ont leur invalidation temporelle autonome.

Validation finale sur la branche `fix/options-btc-eth-expirations` :

- `pnpm check` : typage monorepo, **8 139 tests** (web 5 689, indicateurs 1 487,
  daemon 756, backtest 128, alertes 79), build et budget réussis.
- Playwright Chromium : **18/18** parcours réussis (`options-fraicheur`,
  `omon-lectures-options`, `niveaux-chart`, `revue-outils-avances`), dont six
  nouvelles régressions. La suite fraîcheur fait partie de `pnpm check:e2e`.
- Chargement initial : **1 188 014 octets bruts / 354 233 gzip**, sous les plafonds
  1 220 000 / 360 000 ; Node 24.13.0, zlib 1.3.1. Marge gzip : 5 767 octets.
- `git diff --check` réussi. Aucun changement de secrets, d'hôtes autorisés ou
  de dépendances. Le délai réseau optionnel est activé pour Deribit seulement.

Logs locaux : `/tmp/axiom-options-20260928/check-complet.log` et
`/tmp/axiom-options-20260928/e2e-final.log`. Le correctif est local ; cette revue
n'inclut pas de publication sur la version en ligne.
