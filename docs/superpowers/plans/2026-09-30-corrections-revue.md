# Corrections de la revue AXIOM — 30 septembre 2026

Le propriétaire autorise les suggestions de la revue en demandant de préserver
le fonctionnement de l'outil. Base : `08b30d6`. Le lien public et les clés par
défaut restent conformes à sa décision précédente.

## Lots et responsabilités

1. **Backtest** : le réviseur financier définit le traitement des excursions
   incertaines et des bornes temporelles ; le développeur B modifie le package,
   le store et la fenêtre Backtest avec leurs tests. Conserver les prix de fill,
   PnL, frais et règles de funding. Ne pas inventer un chemin intrabar.
2. **Finnhub** : le développeur A ajoute la fraîcheur et la raison du repli au
   client et à la fenêtre FUND. Conserver les données utiles et les priorités
   entre clés personnelles et serveur.
3. **CI** : le développeur B aligne Node sur la production (24) et ajoute un job
   mobile Chromium/WebKit utilisant les parcours existants.
4. **Chargement** : après lecture du graphe réel, le développeur A diffère une
   surface facultative identifiée. Mesurer les imports initiaux sous Node 24,
   sans relever les budgets. Les Réglages sont déjà chargés à la demande.

Un seul développeur possède chaque fichier. L'orchestrateur tient les documents,
arbitre les interfaces, centralise les validations et publie. Aucun changement de
`@axiom/types`, aucune nouvelle dépendance, fenêtre ou source de données.

## Vérifications de sortie

- Reproductions rouges puis vertes des défauts ; tests de conservation des
  résultats financiers et des chemins de cache.
- Revue indépendante des diffs, particulièrement du lot financier.
- Typecheck et suites unitaires globales ; parcours bureau et téléphone.
- Build de production sous Node 24 et budget réel d'entrée ; contrôle des
  fichiers publiés et absence des secrets dans le bundle.
- Déploiement vérifié avant promotion du lien stable, puis contrôles du lien
  public et des capacités serveur. Consigner les limites sans promettre une
  absence absolue de régression.
