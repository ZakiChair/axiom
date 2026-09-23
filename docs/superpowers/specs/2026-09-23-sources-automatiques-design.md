# Sources automatiques par actif

Demande du propriétaire : revoir le projet et supprimer le choix manuel des sources ;
AXIOM sélectionne les sources disponibles pour chaque actif.

## Comportement

- Une recherche commune présente les instruments des fournisseurs déjà intégrés.
  Les mêmes paires spot sont dédoublonnées ; la devise de cotation est conservée.
- L'utilisateur choisit un instrument, jamais son fournisseur. La source effective
  reste visible, ainsi que les absences de données et conditions d'accès.
- Le comptant, les perpétuels et les actions tokenisées restent des instruments
  distincts. Les perpétuels Hyperliquid utilisent une désignation `BTC-PERP` explicite.
- Le choix automatique examine les catalogues réellement disponibles et les unités
  de temps compatibles. Un historique vide ou en erreur permet un repli vers une
  autre source du même instrument. Une demande n'oscille pas entre sources en échec.
- Un catalogue indisponible ne signifie pas que l'actif est absent : les sources
  concernées restent vérifiables par leurs données réelles. Les caches expirent et
  les résultats de recherche se renouvellent après le retour d'une source.
- L'ajout direct aux favoris vérifie la source du prix ; cliquer sur un favori
  conserve cette provenance. OKX, Bybit et Hyperliquid ont leurs propres tickers.
- Les sources des deux jambes d'un ratio sont également déterminées automatiquement.
  Les séries calculées conservent leur encodage de provenance existant.
- Les anciens favoris, sessions et graphiques secondaires passent par le même
  contrôle au chargement. Les notes, positions et alertes historiques conservent
  leur provenance ; le replay conserve ses données enregistrées.

## Architecture

`data/pairs.ts` décrit les catalogues réels. `data/marketRouting.ts` réunit recherche
et résolution, sans dépendre des stores. Le chargement de `ChartInstance` change
atomiquement l'identité avant de publier les bougies d'une autre source ; ses gardes
de révision interdisent les réponses obsolètes. Le transport live reste direct.

Les sélecteurs de fournisseur disparaissent de la barre principale, des slots et
du constructeur de ratios. Les paramètres mathématiques « Source » (OHLC) et les
clés personnelles des Réglages restent utiles et conservent leur sens.

## Contraintes et limites

Aucun fournisseur, backend, proxy, dépendance ou type partagé nouveau. Français,
TypeScript strict, stores vanilla et budgets du build conservés. La disponibilité
du catalogue n'est pas une garantie de disponibilité du flux ; les échecs réels
restent signalés. Une clé absente ne justifie jamais de substituer un autre actif.
Les séries synthétiques sans ticker dédié restent explicitement sans prix de favoris.

## Vérification

Catalogues partiels, échec réseau, devise exacte, séparation spot/perp, timeframes,
source de repli effective, absence de boucle, courses entre sélections et replay.
Parcours navigateur : recherche inter-fournisseurs, suppression des sélecteurs,
favoris, ratios, slots et restauration. Revue indépendante puis `pnpm check`.
