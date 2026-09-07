# Corrections de la revue globale — 4 septembre 2026

État : **correctifs implémentés, contrôles automatisés locaux PASS**.
Le visa Fable final reste en attente : quota atteint après la revue du lot calculs.
Les relectures indépendantes complémentaires ne remplacent pas ce visa.

Périmètre : défauts de la revue du 4 septembre, sur HEAD `0ce262f` et le travail local
déjà présent. Le catalogue initial de cette session comporte 187 indicateurs, dont
30 stratégies ; ses huit ajouts et le playbook PLAY-POS sont conservés. Aucune
publication, notification réelle, modification de configuration globale ou commit.

Plan écrit validé par Fable 5, exécution GPT / Grok 4.6, revue Fable. Les correctifs
restent dans l'architecture existante : calculs TypeScript, renderer alimenté en direct,
daemon localhost. Les exceptions de maintenance sont inscrites dans BUILD-CONTRACT.

## Défauts et vérification

| Défaut de la revue | Comportement visé / livré | Vérification |
|---|---|---|
| Alertes entre sources | Contextes, prix précédents et abonnements identifiés par source + symbole ; timeframe conservé | Tests source / timeframe et composite hors chart ; contrôle global PASS |
| Drawdown ignorant le latent | Point initial puis équité à chaque clôture, frais d'entrée immédiats, sortie au fill | 53 tests backtest ; revue Fable conforme |
| Stratégies sans données auxiliaires | Fabrique propage `aux`, stratégies déclarent les séries, contrôleur réel les demande | 32 tests indicateurs ciblés ; 28 tests web ciblés incluant quatre intégrations du contrôleur |
| Taker Net inventé | Split absent/invalide : valeur indéfinie, aucune entrée Spot Breakout, garde source | Régressions vérifiées rouges sur les sources initiales puis vertes |
| VWAP/pivots ajoutés à chaud | Compléter les sessions nécessaires sans rechargement, extension idempotente | Scénarios navigateur 500 → 841 (VWAP), puis 2 281 dès la veille (pivots), sans rechargement |
| Pagination MEXC / Twelve Data | Date limite transmise et incluse dans le cache ; points hors borne exclus | Tests adaptateurs ; MEXC et Twelve Data : caches 30 s, 32 entrées, déduplication en vol |
| Historique Kraken borné | Limite d'environ 720 bougies affichée PARTIAL | Parcours navigateur |
| Spread Smart/Retail désaligné | Soustraction aux timestamps communs seulement | Tests avec bucket absent au début et au milieu |
| Symboles tronqués dans la watchlist | Place réservée au symbole, sparkline masquée en sidebar étroite, actions hors flux | BTCUSDT / ETHUSDT / SOLUSDT entiers à 1440 px, sidebar 240 px |
| Playbooks / couverture CI | Huit playbooks attendus, ouverture PLAY-POS vérifiée, réseau bouchonné | G3 : 9/9 ; sélection partagée par `pnpm check:e2e` et CI |
| Relais de notifications | Heartbeat `{visible, canNotify}`, relais macOS si navigateur incapable, Telegram indépendant | Tests visibilité / capacité / ancien heartbeat et transitions immédiates ; transports simulés uniquement |
| Confinement des proxys fixes | Méthodes, MIME, redirections, DNS et tailles contrôlés | Tests HTML / redirections / DNS / méthodes ; POST borné en lecture, timeout client, redirections 301/302/303 et 307/308 |
| ZIP replay en mémoire / imports partiels | Streaming borné vers fichier temporaire, purge du jour en cas d'échec | 27 tests, ZIP réel en chunks et SQLite mémoire ; purge après erreur, process/fichier nettoyés |
| Avis de sécurité de l'outillage | Mise à jour ciblée Vite / Vitest et transitives autorisées | Installation figée et audits complet / production : zéro avis |

## Conventions verrouillées

Le drawdown inclut les pertes latentes **à la clôture**, sans prétendre mesurer les
extrêmes intrabar. Les signaux restent exécutés à l'ouverture suivante. L'équité
finale est égale au capital initial plus la somme des P&L nets, y compris la clôture
forcée finale. Les statistiques en R gardent leurs contrats. Monte-Carlo conserve
sa convention par trade ; aucun export CSV de la courbe d'équité n'existe à modifier.

Les réponses historiques sont fusionnées contre le buffer courant pour éviter les
doublons si le scroll chevauche une extension de session. Les bougies préfixées
avant un buffer plus récent sont clôturées sans modifier le cache de l'adaptateur.

Le lissage EMA du Taker Net porte sur les observations valides. Les périodes sans
split ne deviennent ni des zéros ni des flux extrêmes et ne font pas avancer l'EMA.

Le navigateur notifie lorsqu'il est visible et autorisé ; il transmet immédiatement
les changements de visibilité et retire son abonnement à l'arrêt du runtime. Le daemon relaie les
notifications macOS dans les autres cas ou après expiration du heartbeat. Un ancien
heartbeat sans capacité déclarée conserve le relais. Telegram appartient au daemon.
Le feed du daemon reste limité à Binance ; le funding conserve sa référence dérivée
Binance/Coinalyze existante, sans nouvel agrégateur multi-exchange.

Les redirections 301/302/303 d'un POST deviennent des GET sans corps conformément au
[standard Fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch). Les 307/308
conservant le POST restent limitées au chemin initial autorisé, en plus des gardes
HTTPS, hôte et DNS.

## Contrôles d'intégration

Avant corrections : `pnpm check` PASS, 4 519 tests ; Playwright 36/37 (échec G3) ;
audit complet 11 avis de développement, audit production sans avis.

Contrôles locaux exécutés (Node 26.7.0 / Bun 1.3.11 ; CI de référence Node 22) :

```sh
pnpm check
pnpm check:e2e
pnpm --filter @axiom/web exec playwright test
pnpm audit
pnpm audit --prod
git diff --check
```

La CI conserve les étapes distinctes avec délais maximaux, Node 22 et Bun 1.3.11.
`pnpm check` garde son périmètre TypeScript / unitaires / build ; `check:e2e` exécute
les parcours navigateur hermétiques avec Chromium Playwright installé.

Résultats après mise à jour Vite 6.4.3 / Vitest 3.2.7 :

| Contrôle | Résultat |
|---|---|
| `pnpm check` | PASS : tous les typechecks, 4 627 tests, build web |
| Tests par lot | Indicateurs 715 ; backtest 53 ; alertes 48 ; daemon 425 ; web 3 386 |
| Playwright complet | **43/43 PASS**, sans relance |
| Sélection hermétique `pnpm check:e2e` | **20/20 PASS** avant mise à jour ; les mêmes scénarios sont inclus dans les 43 tests après mise à jour |
| Audits complet et production | **0 avis** dans chaque audit, contre 11 avis de développement avant correction |
| `git diff --check` | PASS |

Le build réussit avec un avertissement de taille : entrée **676,72 ko / 211,11 ko gzip**
(seuil conservé : 670 ko). Avec les trois modules préchargés : **1 170,19 ko /
342,90 ko gzip**, hors CSS, contre 1 161,26 ko / 340,66 ko avant corrections.
Aucune augmentation artificielle du seuil ni optimisation globale revendiquée.

Revue calculs Fable : conforme, qualité bonne ; réserve de typecheck web levée par
le contrôle global. Les relectures complémentaires Grok du replay, du graphique et du daemon n'ont
relevé aucun défaut important. Les retours sur le cache Twelve Data, la clôture des
bougies historiques, la mesure de visibilité de la watchlist et les redirections POST
ont été traités. Une autorisation exceptionnelle de substitution de Grok à Fable pour
le visa final a été demandée au propriétaire ; aucune substitution n'est présumée.

Mesure indicative moteur : 50 000 bougies,
50 001 points d'équité en 8 ms sous Bun. Ce n'est pas une mesure du rendu canvas.

## Limites conservées

- G100 manuel reste **ouvert** : tenue 30 minutes, coupure/reconnexion, réception
  effective d'une bannière macOS, chronométrage de l'onboarding et jugement visuel.
- Sauvegardes étendues des notes/dessins/journal et optimisation du bundle global
  restent des évolutions séparées ; le budget de performance n'a pas été relevé.
- Aucun test de livraison Telegram réel ni validation d'un déploiement Vercel.
- L'annotation « Session partielle » des indicateurs conserve son placement actuel.
- La mise à jour globale du CLI Vercel reste à la charge du propriétaire :
  `npm i -g vercel@latest` (58.9.0 installé, 59.11.7 signalé pendant la revue).

Traces de travail de cette session : `/private/tmp/axiom-corrections-20260904/`
(`check-final.log`, `e2e-final.log`, `audit-final.json`, `audit-prod-final.json`).
La comparaison de revue utilise une copie du WIP initial pour distinguer les
correctifs des changements préexistants, notamment les nouveaux indicateurs.
