# Revue globale et fonction MACRO — Plan d'implémentation

> Exécution avec tests de régression et agents aux fichiers disjoints. Demande utilisateur : corriger et ajouter tous les points de la revue du 7 septembre, compléter chômage, PIB, PPI, inflation et leur évolution dans les zones clés.

**Objectif :** fiabiliser AXIOM et rendre accessibles les séries macro, géopolitiques, techniques et on-chain demandées dans les surfaces existantes.
**Architecture :** conserver React/Vite/KLineChart, packages TypeScript purs, WebSockets directs, daemon localhost pour données lentes. Catalogue macro déclaratif et transports existants étendus ; aucune exécution d'ordres, aucun nouveau backend ni agrégateur tick.
**Validation :** tests rouges avant correctifs, parseurs/formules testés sur cas réels et limites, typecheck, tests monorepo, build, navigateur hermétique sur port dédié et revue indépendante.
**Contexte de protocole :** Fable 5 appelé pour conception le 7 septembre : HTTP 429, quota épuisé. L'utilisateur a ensuite demandé de reprendre le chantier. Ce document est le plan GPT de cette reprise et ne revendique aucun visa Fable. La revue finale indépendante ne sera pas présentée comme un visa Fable.
**Base :** 83be54a ; 4 702 tests unitaires, TypeScript, build et 20 parcours navigateur vérifiés dans la revue.

## Contraintes

- Français, compatibilité des données sauvegardées, pas de secret dans les logs ou les rapports.
- Huit zones initiales : US, zone euro, Royaume-Uni (RU interprété ainsi), Japon, Chine, Inde, Canada, Suisse. Filtrer les zones depuis la fonction MACRO.
- Pas de substitution statistique cachée. Périmètres, fréquences, unités et éventuelles absences sont affichés.
- Dates d'observation et de récupération séparées ; périodes glissantes explicites ; publication inconnue jamais inventée ; pas de prétention de backtest point-in-time sur données révisées.
- Pas d'achat ni de souscription. Intégrer réellement les sources publiques et les accès personnels déjà prévus ; les séries nécessitant un abonnement sont signalées avec motif.
- Pas de nouvel indicateur uniquement déclaré : calcul, chargement et accès UI doivent être reliés.
- Pas de changement des garanties de sécurité des proxys pour faciliter un fournisseur ; endpoints spécialisés bornés si un document amont doit être converti.
- Le périmètre demandé autorise les extensions de catalogue/sources/surfaces existantes ; 39 fenêtres, aucune migration majeure.
- Ne pas annoncer de rentabilité ni de validation empirique générale. G100 manuel reste distinct des tests automatisés.

## Lot A — Durabilité et confinement

Fichiers : apps/web/src/store/persist.ts et tests, apps/web/src/data/daemon.ts et tests, apps/daemon/src/snapshots.ts et tests si requis, SettingsPanel.tsx pour messages de restauration ; api/proxy.ts, api/_policy.ts et tests ; apps/daemon/src/proxy.ts seulement pour cohérence de politique.

- [x] Import atomique au sens utilisateur : résultat faux en erreur, ancien état préservé/restauré, aucune purge silencieuse irréversible.
- [x] Restauration exacte des clés incluses dans le périmètre : retirer les clés apparues depuis le snapshot, préserver les autres clés et credentials.
- [x] Étendre les snapshots au travail personnel sérialisable (notes, dessins, journal/portefeuille, alertes, workspaces) en réutilisant KV et le mécanisme existant ; expliciter ce qui est effectivement sauvegardé.
- [x] Corps POST Vercel lu en streaming borné à 64 Kio avec annulation ; rejets avant lecture lorsque Content-Length annonce trop.
- [x] POST SoSoValue limité aux chemins ETF utilisés ; garde des redirections conservant un corps sur le même chemin.
- [x] Tests quota/rollback, snapshot vide et clés nouvelles, corps segmenté interrompu, méthodes/redirects ; relecture indépendante.

## Lot B — Fonction MACRO et économie mondiale

Fichiers : apps/web/src/data/macro/{catalogueMacro,harmonisation,chargerSerieMacro,fred,oecd,eurostat,ons}.ts et tests, nouveaux modules ciblés de catalogue/transformation si nécessaires ; apps/web/src/store/{macroSeries,macroRatesView}.ts et tests ; composants de l'onglet macro de RATE et utilitaires/tests associés.

- [x] Catalogue familles : inflation CPI a/a et m/m, inflation sous-jacente, PPI a/a, PIB réel a/a, chômage, production industrielle a/a, change effectif réel a/a, croissance de masse monétaire quand les sources sont disponibles.
- [x] Canada et Suisse ajoutés ; définitions réelles vérifiées, trous et séries arrêtées explicitement identifiés. UK chômage trimestriel glissant correctement daté.
- [x] Ajouter taux réel US 10 ans (DFII10), breakeven 10 ans (T10YIE), NFCI, HY OAS (BAMLH0A0HYM2), ICSA et moyenne 4 semaines, SOFR–IORB.
- [x] Cadences jour/semaine/mois/trimestre et unités séparées : pourcentages, indices, effectifs ; pas de courbes de dimensions incompatibles sur un axe.
- [x] Vue évolution avec sélection famille/zones/horizon 1/5/10 ans, valeurs actuelles et précédentes, variations, dates, sources et fraîcheur ; conserver les courbes du code existant.
- [x] Source en erreur/quota périmée n'est jamais remplacée par une fausse valeur ; cache cadencé, ordonnancement OCDE global entre familles et arrêt de requêtes obsolètes.
- [x] Tests transformations avec périodes manquantes et vrais glissements annuels, listes/paramètres source, valeurs négatives/zéros, régions/horizons et intégration UI.

## Lot C — Graphique et microstructure

Fichiers : apps/web/src/chart/{auxProvider,footprintAnalytics}.ts et tests ; packages/indicators pour deux indicateurs OHLCV et enregistrement ; apps/web/src/data/depth*.ts, stores DOM/depth et DomWindow.tsx ; VolWindow.tsx si utile.

- [x] Mark perp aligné avec la clôture réellement connue et le timeframe approprié ; tests H15/H1/H4, pas d'anticipation.
- [x] Divergences footprint réarmées après une barre neutre et changement de séquence.
- [x] RVOL par heure/jour avec nombre de références et minimum d'historique, uniquement historique antérieur.
- [x] Part de variance réalisée baissière/haussière, calcul testé et présent dans le catalogue/graphe.
- [x] OFI dynamique et microprix dans DOM depuis le L2 disponible ; accumulation bornée et reset reconnexion/source.
- [x] Reconstitution du carnet après retrait de liquidité L2 : observations/minimum, cas censurés et étiquette heuristique ; aucune attribution certaine à une agression, aucun recorder permanent.

## Lot D — Intégration et ergonomie (root)

Fichiers : commandes/palette, data/eco.ts et tests, EcoWindow.tsx, Brief/lecturesBrief si nécessaire ; Playwright config et helper réseau ; labels NETLIQ/STBL ; documentation finale.

- [x] Commande MACRO ouvre RATE directement sur l'onglet Indicateurs ; alias documentés et recherche des familles.
- [x] Boutons ECO → bonne famille/zone/fréquence sans fausse correspondance ; BRIEF reflète les séries effectivement affichées.
- [x] Calendrier FRED transmet la clé personnelle ; cache de résultats éco adapté aux publications et refresh manuel ; aucune surprise historique inventée.
- [x] Libellés NETLIQ proxy/mix fréquence et STBL variation de stocks USD ; dates/limites lisibles.
- [x] E2E port dédié configurable partagé avec les bouchons réseau, aucune réutilisation aveugle d'une autre application.
- [x] Documenter usages réels des auxiliaires, alertes et backtest ; garder stratégies non validées.

## Lot E — Géopolitique exploitable

Fichiers : apps/web/src/data/globe/portwatch.ts et tests ; nouveaux modules données lentes géo ; composants GLOBE détails/historiques ; routes spécialisées amont si nécessaires (coordination après A).

- [x] Historique PortWatch réel et paginé, moyenne 7 jours, comparaison saisonnière et date, séparant navires/tankers/cargos.
- [x] GPR, TPU et GSCPI chargés depuis leurs sources publiées ; courbes et valeurs visibles dans GLOBE ou RATE, dates/unités/licences et limites de mesure.
- [x] Extraire uniquement les séries attendues si source HTML spécialisée ; limiter URL/hôte/taille/délai, jamais servir le HTML amont au navigateur.
- [x] Aucune statistique 30/90 jours inférée à partir des 48 heures de GDELT.

## Lot F — Cohortes et flux on-chain

Fichiers : data/onchain/bgeometrics.ts et tests, nouvelles fonctions analytiques ciblées, OnchainWindow.tsx ; indicateurs/packages seulement après C si ajouts chart requis.

- [x] Prix réalisé STH/LTH depuis les endpoints frais realized-price-sth/realized-price-lth, distance du spot.
- [x] Realized cap, variations 30/90 jours et offre en profit/perte ; historiques incomplets clairement indiqués.
- [x] Réserves/netflows exchange BGeometrics : trajet API réel, clé personnelle, statut accès payant explicite sur 403 ; qualité de labels et révisions indiquées, pas de vente présumée.
- [x] Files entrée/sortie staking ETH et historique depuis source publique vérifiée ; unité ETH, date et périmètre affichés.
- [x] ETF historique réel, cumuls 5/20 séances et ratio flux/encours si données fournies ; ne jamais remplir artificiellement les dates avec le snapshot du jour.

## Lot G — Vérification, performance et livraison

- [x] Tests ciblés après chaque lot, relecture par un agent distinct, corrections des régressions.
- [x] Typecheck, tests monorepo, build ; optimisation ciblée du bundle si cause accessible, seuil inchangé.
- [x] E2E hermétiques nouveaux parcours macro multi-familles/zones et sources partielles ; parcours existants sur port dédié.
- [x] Probes réelles limitées par quotas, données/authentification non exposées. Tests offline séparés.
- [x] Protocole G100 mis à jour ; tenue/reconnexion et notifications uniquement si effectivement exécutés et observés, aucun verdict fictif.
- [x] README/BUILD-CONTRACT/rapport synchronisés, CLI Vercel obsolète mis à jour si installé.
- [x] Aucun commit/push/déploiement sans validation finale ; laisser modifications concrètes et vérifiées au propriétaire.

## Suivi

Le registre docs/superpowers/progress/2026-09-07-revue-et-extension-globale.md conserve les tâches terminées, vérifications, réserves et blocages de fournisseurs. Rien n'est retiré silencieusement du périmètre.
