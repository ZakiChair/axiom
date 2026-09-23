# Revue du 23 septembre 2026 — quatre corrections

Les quatre défauts vérifiés sont corrigés dans le code. Les lots ont été implémentés
avec des régressions rouges puis vertes, puis revus par un agent indépendant de
l'auteur. Les changements préexistants du dépôt sont conservés ; aucune dépendance
ni exécution d'ordre réel n'a été ajoutée.

## Comportement corrigé

| Périmètre | Défaut | Résultat |
|---|---|---|
| Backtest intrabar | La dernière bougie ignorait stop et objectif ; un gap favorable pouvait être remplacé par un stop touché plus tard. | Toutes les barres détenues sont évaluées, y compris une entrée sur la dernière barre. Le franchissement à l'ouverture précède les touches high/low. MAE/MFE excluent les extrêmes après une sortie certaine à l'ouverture. |
| PAPER → EXPY | Modifier le stop changeait rétroactivement le risque utilisé pour le R. | Le stop de la première ouverture est persisté et conservé après modification, suppression ou renfort. Un stop initial inconnu donne un R indéfini. |
| Hyperliquid | Une acquisition forcée en échec pouvait renvoyer le cache puis l'archiver avec une nouvelle date. | Le repli est réservé à l'affichage. Sans observation neuve, aucune archive ni nouveau succès. Archive et santé conservent la date originale de l'observation. |
| Écart de funding HL − Binance | La jambe Binance était supposée réglée toutes les huit heures et pouvait provenir de la série mixte Coinalyze/Binance. | Une série Binance dédiée normalise les règlements historiques à l'heure. Le spread vaut `(HL_h − Binance_h) × 24 × 365 × 100`. Une cadence incertaine laisse un trou. |

La revue a aussi fait corriger deux frontières : les excursions après un gap de
sortie et l'alignement du funding quand des bougies sont absentes. Les vingt
intervalles du chart ont une clôture théorique bornée, calendrier UTC compris ;
une publication postérieure à cette clôture n'est pas lue par la bougie.

## Cadence Binance et limites

La conversion nécessite trois règlements `Regular` consécutifs donnant deux
intervalles concordants de 1, 2, 4 ou 8 h. Une tolérance de 60 s reconnaît les
petits décalages sans arrondir l'instant de publication. Un taux inconnu, un type
absent/spécial ou un doublon contradictoire interrompt la série. La valeur expire
au prochain règlement attendu ; une bougie encore ouverte est lue au plus à
l'instant présent.

Le transport utilise `extUrl`, un module chargé à la demande, une fenêtre de
90 jours, au plus cinq pages de 1 000 règlements et un délai de 8 s par requête,
lecture du corps comprise. Une page en échec invalide l'acquisition entière.

La mention « cadence observée » est volontaire : le REST ne fournit pas un
historique certifié des changements d'intervalle. Des lacunes amont qui forment
elles-mêmes une suite régulière restent indétectables. Aucune cadence actuelle
de `fundingInfo` n'est appliquée rétroactivement. Contrat API vérifié dans la
[documentation officielle Binance](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data).
Une sonde publique de quatre règlements BTCUSDT a confirmé `rateType: Regular`
et des timestamps décalés de 4 ms ; elle vérifie le format, pas tous les marchés.

Les données déjà enregistrées ne sont pas réécrites : anciens trades EXPY et
anciens instantanés HL restent intacts. Les anciennes positions PAPER sans preuve
du stop initial portent une note explicite à leur export et un R indéfini.
Après renfort, le R du trade fusionné utilise le prix moyen et la taille totale
avec le stop de la première ouverture ; ce n'est pas le R isolé de la première
tranche. L'ordre des touches intrabar demeure une convention OHLC de simulation.

## Vérifications finales

`pnpm check` terminé avec code 0 après le dernier correctif :

| Suite | Tests réussis |
|---|---:|
| Indicateurs | 1 450 |
| Alertes | 76 |
| Backtest | 128 |
| Daemon | 687 |
| Web | 4 942 |
| **Total** | **7 283** |

- Vérification TypeScript du monorepo et build web réussis.
- Budget initial : **1 204 408 octets bruts / 356 368 octets gzip**,
  sous les plafonds inchangés de 1 220 000 / 360 000.
- Parcours Chromium existant « Backtest distingue bootstrap, spot sans funding
  et absence du funding réel » : **1 test réussi**, fixtures réseau, profil isolé.
- Revues indépendantes : BT, PAPER, HL et funding acceptés après corrections.
- `git diff --check` réussi ; périmètre comparé aux empreintes avant travaux.

Preuves locales : `/tmp/axiom-four-fixes-check-final.log`,
`/tmp/axiom-four-fixes-e2e.log`. État préalable sauvegardé dans
`/tmp/axiom-4-corrections-zm_0c_x6/`.

Le daemon déjà actif avant les modifications n'a pas été redémarré : un
redémarrage de ce processus est nécessaire pour charger le correctif HL.
