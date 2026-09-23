# Sources automatiques — plan d'implémentation

**Objectif :** sélectionner un actif sans choisir son fournisseur.
**Architecture :** catalogue partagé et résolution centrale, appliquée au chargement
de chaque graphique ; provenance effective conservée.
**Stack :** React, Zustand vanilla, TypeScript, adaptateurs existants.
**Spec :** [conception](../specs/2026-09-23-sources-automatiques-design.md).

## Contraintes

Le propriétaire autorise la réalisation. Lots à fichiers disjoints, revue par un
agent indépendant, aucun commit/push/déploiement dans ce chantier. Aucun changement
de `@axiom/types`, dépendance ou sécurité proxy. `~/DEV-PROTOCOL.md` est absent du
poste ; `AGENTS.md`, `.devin/provider-rules.md` et `BUILD-CONTRACT.md` ont été lus.

## Lot données — agent audit_routage

Fichiers : `data/{pairs,marketRouting,hyperliquid,symbol,synthetic,adapters}.ts`,
`store/market.ts`, `chart/ChartInstance.tsx`, auxiliaires locaux de routage et tests.

- [x] Tests des vrais catalogues et de la sélection par instrument.
- [x] Catalogue global, sources indisponibles isolées, délais bornés.
- [x] Résolution compatible timeframe, conservation quote/type, HL explicite.
- [x] Chargement central avec repli, identité atomique, gardes anti-course/replay.
- [x] Retrait du sélecteur secondaire et tests ciblés.

## Lot interface — agent audit_interface

Fichiers : `components/{Toolbar,PairSearch,Watchlist,CommandPalette,CompareControl}.tsx`,
`commands/registry.ts`, `chart/ChartGrid.tsx`, `data/ticker.ts`, `store/watchlist.ts`,
tests associés et `e2e/sources-automatiques.e2e.ts`.

- [x] Recherche globale et provenance informative ; retrait des sélecteurs.
- [x] Résolution automatique des jambes synthétiques.
- [x] Presets, favoris et palette indépendants de l'ancienne source.
- [x] Aucun ticker faussement attribué à Binance sur une source non prise en charge.
- [x] Parcours navigateur hermétiques et adaptation des anciennes attentes.

## Revue et validation — agent revue_projet et orchestrateur

- [x] Revue architecture et sécurité ciblée (213 tests proxy/credentials réussis).
- [x] Revue indépendante des diffs et corrections des constats importants.
- [x] `pnpm check` : typage, tests monorepo et build avec budgets.
- [x] E2E ciblés et rapport de résultats réellement observés.

Vigilance : absence de clé TradFi, fournisseur suspendu, changement rapide d'actif,
restitution d'anciens symboles HL, incompatibilité TF et comparaison multi-source.

## Lot compatibilité — agent compatibilite_perp

L'audit a montré que plusieurs consommateurs reconnaissaient les actifs par retrait
de suffixe, et que les anciennes restaurations procédaient en plusieurs mutations.
Ce lot complète la migration de symbole explicitement perpétuel :

- [x] Reconnaître `BTC-PERP` dans les données on-chain, options et dérivés dont le
  contrat porte sur l'actif ; préserver les gardes propres à une place.
- [x] Conserver les clés historiques attendues par les collecteurs de liquidations.
- [x] Restaurer atomiquement les identités de sessions, workspaces et synchronisation.
- [x] Adapter les messages d'erreur au routage automatique.

Fichiers attribués : `lib/indicatorUsability.ts`, `chart/auxProvider.ts`,
`data/{fundingCrossExchange,liquidations,chaineOptionsCache,daemon,referentiels,
binanceFutures,coinalyze}.ts`, `chart/{liquidationMarkers,dataLoadErrorMessage}.ts`,
`store/{persist,workspaces,sync}.ts`, `components/{NotesWindow,PortfolioWindow}.tsx`,
`lib/navigation.ts`, `data/playbooks.ts` et tests correspondants, seulement selon besoin.

## Résultat

Réalisation et revues terminées ; 7 159 tests, 101 parcours navigateur, typage et
build validés. Voir le [rapport final](../../revue-2026-09-23-sources-automatiques.md).
Aucun commit, push ou déploiement.

## Reprise sur le cas CARDSUSDT

Le retour utilisateur invalide la validation fonctionnelle précédente : les tests
avaient couvert un actif Bybit simulé, sans prouver le parcours complet d'un actif
OKX ni le rétablissement d'un catalogue. CARDS-USDT est bien un instrument spot
actif d'OKX ; son ticker et ses bougies répondent réellement, contrairement à
Binance qui rejette ce symbole.

- Données (`audit_routage`) : renouveler les caches, rendre les réponses vides
  réessayables, tolérer les catalogues lents, sonder les sources dont le catalogue
  manque et publier les catalogues rafraîchis. Corriger aussi le canal de bougies
  OKX vers `/ws/v5/business`, distinct du canal de transactions public.
- Tickers (`compatibilite_perp`) : raccorder OKX, Bybit et Hyperliquid, vérifier
  effectivement les candidats avant d'attribuer la provenance d'un favori, et
  utiliser l'adaptateur effectif pour les statistiques horaires.
- Interface (`audit_interface`) : renouveler les résultats après retour réseau,
  relancer les favoris non résolus, préserver leur provenance au clic. Régressions
  navigateur avec le symbole exact CARDSUSDT, son prix OKX et catalogue défaillant.
- Orchestrateur : vérifier le parcours avec les API réelles, faire revoir les lots
  par un autre agent, exécuter les contrôles globaux et corriger le rapport.

Les lots ont des fichiers distincts ; les contrats des abonnements et de résolution
des tickers sont coordonnés entre leurs auteurs. Aucun nouveau fournisseur, service
ni dépendance.

**Reprise terminée :** revues indépendantes favorables, `pnpm check` réussi avec
7 201 tests et budgets de build respectés ; `pnpm check:e2e` réussi avec 100
parcours, dont 11 régressions CARDSUSDT. Vérification réelle en navigateur de
l'ajout direct du favori, du prix OKX, des 300 bougies et du flux business.
Voir les preuves correctives du [rapport](../../revue-2026-09-23-sources-automatiques.md).
Aucun commit, push ou déploiement.

## Reprise TradFi — USOIL

Le propriétaire précise le symbole recherché : `USOIL`. Le catalogue public
Twelve Data ne connaît pas ce nom ; il expose `WTI/USD` (« Crude Oil WTI Spot »).
Le catalogue local omet ce symbole et son classement automatique l'envoie à tort
vers les marchés crypto. `WTI` seul désigne notamment l'action W&T Offshore ;
`USO` est un ETF distinct. Les cours WTI/USD sont refusés par l'accès du proxy
local sondé, avec un message explicite d'offre Grow/Venture requise.

- Auteur `audit_interface` : catalogue WTI/USD, classement TradFi, suggestion
  USOIL avec libellé spot explicite, distinction de l'action WTI et de l'ETF USO,
  présentation immédiate du catalogue TradFi local et tests de recherche.
  Fichiers : pairs, marketRouting, PairSearch et leurs tests ; E2E sources.
- Auteur `audit_routage` : message lisible du refus d'abonnement Twelve Data,
  uniquement dataLoadErrorMessage et son test.
- Revues croisées et vérification réelle : alias de recherche seulement, aucune
  réécriture d'anciennes identités, aucun remplacement par un autre instrument.

Aucun fournisseur, clé, abonnement, proxy ni dépendance ajouté.

**Reprise terminée :** revues indépendantes favorables, `pnpm check` réussi avec
7 222 tests, typage et build ; 20 parcours sources automatiques réussis.
Le navigateur utilisateur confirme la suggestion USOIL vers WTI/USD et le refus
réel Grow/Venture, maintenant lisible. La recherche fonctionne ; les cours restent
conditionnés aux droits de l'accès Twelve Data configuré. Aucun commit, push ou
déploiement. Voir les preuves du [rapport](../../revue-2026-09-23-sources-automatiques.md).
