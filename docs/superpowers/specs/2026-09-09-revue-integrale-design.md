# AXIOM — réalisation intégrale de la revue du 9 septembre

Demande acceptée : tous les points de `docs/revue-2026-09-09.md`. Le 9 septembre à 20:59 CEST, le propriétaire confirme la reprise par GPT et demande de supprimer la consigne réservant le chantier à Fable. L’orchestration est GPT, avec développeurs et revue indépendante. Aucun visa de modèle exclusif n’est requis.

## Objectif produit

Rendre les lectures du terminal vérifiables par date, source et couverture ; compléter les outils macro/on-chain existants et éprouver les signaux sans anticipation ni promesse de performance.

## Périmètre accepté et critères

1. ETF du régime : séances compatibles, couverture BTC/ETH/SOL, dates et fraîcheur. Aucune somme de séances différentes présentée comme quotidienne complète.
2. Référentiels : étendue min→max, âge de dernière observation, nombre de points, couverture de cadence connue ; timestamps invalides/futurs et doublons écartés ; les historiques insuffisants ne valident pas une lecture.
3. CHAIN : remplacement de clé BGeometrics observé, publications par source indépendantes, délais bornés, rafraîchissement respectant caches et quotas, absence de résultat obsolète.
4. Qualité DATA/BRIEF/CHAIN : provenance effective, observation/récupération distinctes, cadence, couverture, estimations et accès visibles par métrique lente utilisée dans la lecture.
5. MACRO : PCEPILFE niveau/a-a/3m/6m annualisé SA ; PAYEMS variation mensuelle et moyenne 3 mois en milliers ; RSAFS niveau/variations nominaux. Mois manquants ne deviennent pas périodes consécutives.
6. ALFRED : vue connue à une date, cache séparé par millésime, première publication et révisions ; granularité jour sans heure inventée.
7. NETLIQ : TGA Daily Treasury Statement, rupture de schéma 2022 traitée, millions→milliards explicite ; contributions des trois jambes avec leurs dates et vue hebdomadaire cohérente.
8. BRIEF/CHAIN/STBL : lecture commune des flux et stocks, ETF/encours historique, percentile seulement avec profondeur ; désaccords et alertes expliqués.
9. CHAIN/STBL/SECT : économie comparée des chaînes (TVL, DEX, stables, frais/revenus), histories et dates ; quantités distinctes de valorisation seulement si réellement disponibles.
10. ECO/EVTS : consensus archivé quand disponible, première publication/révisions et réaction BTC/ETH à une heure effective vérifiée ; absence honnête du consensus historique ou de l’heure ; trou OHLC ne doit pas décaler H0.
11. DOM/EQS : écart prix/OI/CVD, persistance et qualité/coûts, configuration explicite, reset des flux discontinus.
12. OMON/BRIEF : plusieurs hypothèses dealer, sensibilité gamma, contributions/désaccords et stabilité des seuils de régime, aucune assimilation couverture/probabilité.
13. WHALES : labels datés et sourcés, entités/transferts internes, couverture inconnue et trous de collecte ; aucune vente ou change BTC certain inféré d’un simple transfert.
14. CAP/SECT : unlocks réels, ratios au flottant/volume avec dénominateurs datés, historique des bridges avec état de droits réel.
15. BT et validation : funding aux règlements, bootstrap par blocs, franchissement de ruine vs terminal négatif, signaux causaux, oracles supplémentaires, campagne OOS figée avec coûts/sensibilité et journal de versions.
16. Maintenance : Vitest 4.1.11, absence de l’avis remonté et tests ; budget bloquant du JS initial effectif ; mesure de performance d’un workspace représentatif. CLI Vercel déjà mis à jour et vérifié 59.14.0.
17. Usage : parcours donnée→lecture→alerte→journal, restauration effective, contrôles G100 exécutés et consignés honnêtement, dont visibilité et réseau réels si réalisables.

## Contraintes globales

- Français ; React 18/Vite 6/Zustand/KLineChart conservés ; 39 fenêtres, 9 identifiants exchange, 189 indicateurs. Réutiliser composants et commandes existants.
- Aucun backend réseau, nouvel ordre réel, nouvelle dépendance runtime, recorder tick permanent ou modification de `@axiom/types`.
- Types locaux et package backtest extensibles de manière compatible ; sources lentes dans les transports/cache existants. Vitest 4.1.11 et lockfile autorisés pour maintenance.
- Secrets jamais rendus, loggés, exportés ou placés dans un état partagé ; réglages à clé personnelle et droits explicites. Aucune souscription ni achat.
- Valeurs absentes non remplacées par zéro ; pas de donnée future dans une décision historique ; source révisée et vintage différentes ; observation, publication et récupération distinctes.
- Les sources payantes sont réellement raccordées et testées sur contrat ; un accès manquant est affiché, sans prétendre qu’un appel authentifié a réussi.
- Tests de régression avant correctif et contrôle de calcul indépendant. Seuls les résultats mesurés sont documentés ; les 30 stratégies ne deviennent pas globalement validées.
- G100 est un registre de résultats observés, pas une conséquence des tests hermétiques. Les opérations sur profils/bases de test sont isolées du travail personnel.

## Exécution

Le plan décline ces points en lots avec fichiers attribués. Les lots indépendants peuvent avancer en parallèle, conformément à la demande et au protocole actualisé. L’orchestrateur tient le journal, écrit les documents et vérifie les interfaces ; les développeurs écrivent le code ; les reviewers sont distincts des auteurs. La validation finale porte sur la branche assemblée.
