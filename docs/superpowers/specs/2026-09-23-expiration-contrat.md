# Expiration des alertes — contrat d'implémentation

Périmètre autorisé : tâche E du plan des quatre lots. Préflight indépendant Astra,
implémentation Sol ; aucun envoi de notification réel pendant la vérification.

## Échéance et persistance

`expireTs?: number` pour les alertes ordinaires et de scan. Le prédicat partagé est
vrai seulement si `actif === true` et si l'échéance est absente ou `now < expireTs`.
À égalité, l'alerte est expirée. Le moteur utilise `ContexteAlerte.maintenant`.
Un champ présent invalide (null, chaîne, non fini, nul ou négatif) provoque un rejet
explicite ; ne jamais le supprimer pour transformer l'objet en alerte permanente.
Les objets legacy sans échéance restent valides. Hydratation front/daemon, miroir KV
et snapshots conservent la date. Pause/reprise ne renouvelle aucune échéance.

## Frontend et ressources

Appliquer le même prédicat aux sélections ticker, funding, cascade, CVD, régime,
composites, flux de capitaux, on-chain et scans. Un timer réveillé à la prochaine
échéance libère les demandes sans attendre un tick ni une modification du store.
Le réarmer après ajout, prolongation et suppression, borner le délai à la capacité
de setTimeout et réconcilier lors du réveil de l'onglet. Le panneau et le compteur
SessionStrip doivent eux aussi changer sans événement de marché.

Préserver les demandes partagées : une autre alerte, une fenêtre ouverte ou une
préférence utilisateur peuvent encore nécessiter le flux. Les flux de capitaux
possèdent déjà une demande d'alerte dédiée. Pour le CVD, créer une demande transitoire
distincte des intentions utilisateur `enabled` (persistée) et `cvdSpotPerp`
(de session dans le contrat existant), puis faire l'union des besoins effectifs.
Ne jamais désactiver les toggles utilisateur à
l'expiration. Aucun flag de demande transitoire dans la sauvegarde persistée.

## Courses asynchrones

Funding et on-chain revérifient l'activité après l'acquisition et immédiatement
avant journal/notification. Distinguer les générations des scans : un résultat
lancé avant expiration ne redevient pas admissible après prolongation du même ID.
Invalider les générations lors de l'expiration et de l'arrêt ; les anciens catch
et finally ne modifient pas une nouvelle exécution. Revérifier avant chaque
notification d'un ensemble de résultats. On-chain accepte un AbortSignal ; le
chargeur de scan actuel n'en accepte pas, donc ses résultats périmés sont ignorés
sans prétendre annuler physiquement son réseau.

## Daemon et collecteurs

Les sélecteurs Binance, funding, cascades et whales utilisent la même horloge
injectée et le même prédicat. Un réveil dédié à l'échéance remplace l'attente des
pollings de 5 ou 60 secondes pour la libération. `fusionnerSymbolesLiq` conserve
l'union des symboles KV explicitement surveillés et des alertes encore actives ;
une expiration ne retire pas un symbole demandé ailleurs. La sélection de
`hlLiqHeat` est recalculée au début de chaque cycle avec l'horloge injectée, en
conservant les garanties de fraîcheur et d'archivage du chantier précédent.

## Interface

Créations simples, composites et scans : durée optionnelle. Les deux listes
montrent la date, l'état expiré et une action explicite de prolongation. Une
alerte en pause reste en pause lorsqu'on la prolonge. Les scans expirés ne
consomment plus le plafond des quatre scans actifs ; une prolongation qui les
réactive vérifie le plafond atomiquement et refuse sans mutation si nécessaire.
Le playbook CVD garde son idempotence : ne pas recréer automatiquement une alerte
permanente à côté d'une alerte expirée. Les créateurs secondaires legacy peuvent
conserver l'absence d'échéance.

## Preuves attendues

- Frontière −1 ms, égalité, +1 ms ; legacy, valeurs invalides, hydratation et KV.
- Expiration sans tick : désabonnement, demande exclusive libérée, état et compteur.
- Ressources partagées préservées : alerte sœur, KV, fenêtre flux et CVD utilisateur.
- Acquisitions en vol, expiration puis prolongation, ancien rejet après nouvelle génération.
- Quota des scans et prolongation refusée sans mutation.
- SQLite mémoire pour le daemon ; notifier macOS ET transport Telegram neutralisés.
- E2E hermétique : création, expiration visible, reload, prolongation explicite.
