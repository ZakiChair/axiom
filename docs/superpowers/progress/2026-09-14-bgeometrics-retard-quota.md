# 2026-09-14 (après-midi) — BGeometrics : source en retard, refus d'abonnement, plafond journalier

Demande du propriétaire : « Reprends le projet et fais fonctionner les nouveaux outils on-chain »,
avec la clé BGeometrics. Arbitrage en cours de séance : **BGeometrics uniquement**
(pas de repli Coin Metrics), correctifs « Messages trompeurs » et « Économie de quota ».

## Diagnostic (preuves réelles)

| Constat | Preuve |
|---|---|
| La clé fournie est celle déjà installée ce matin | `apps/web/.env` (gitignoré) et `vercel env ls production` |
| Mineurs, Thermocap, Activité DEX fonctionnent en prod | alias, contexte Chrome vierge : hashprice 42,42 $/PH/j, thermocap 16,5, DEX 6,76 Md$ |
| MVRV-Z, SOPR, NUPL, Puell s'arrêtent au **2026-09-07** (J-7) — lu d'abord comme un arrêt de publication, **corrigé ensuite : embargo payant**, cf. section « Embargo » | réponses `/bgapi` (114/120 points) **et** fichiers publics `charts.bgeometrics.com/files/{mvrv_zscore,sopr,nupl}_data.json` qui s'arrêtent au 07/09 ; reserve-risk, realized-cap, STH/LTH au 13/09 |
| Offre gratuite : 10 req/heure **et** 15 req/jour | page pricing bitcoin-data.com |
| Le quota est compté par IP pour une même clé | 429 `RATE_LIMIT_HOUR_EXCEEDED` depuis le poste à 09:09 UTC, 200 via Vercel à 09:12 UTC avec la même clé |
| Une ouverture à froid de CHAIN consommait 10 requêtes | onglet réseau prod : 9 × 200 + 403 netflow, puis reserve bloquée par le compteur client (« Quota atteint » au lieu de « abonnement requis ») |

Conséquence sur l'offre gratuite : les alertes `onchain-seuil` sur MVRV-Z / SOPR / NUPL restent
non évaluables (valeurs > 3 j exclues, comportement voulu).

## Embargo (enquête après déploiement, lot `f0343c0`)

Le propriétaire signale « toutes les sources sont périmées ». Enquête sans quota (fichiers
charts.bgeometrics.com = dépôt GitHub `BGeometrics/bgeometrics.github.io`, journaux d'un tiers,
changelog), puis une seule sonde :

| Constat | Preuve |
|---|---|
| Embargo payant, pas une panne | changelog BGeometrics v1.7 (septembre 2026) : « MVRV, SOPR, NUPL and Realized Price API endpoints: the most recent 7 days now require an active paid subscription » |
| Clé AXIOM concernée | `GET /v1/mvrv-zscore/last` → `{"d":"2026-09-07",…,"delayed":true,"message":"Real-time data (last 7 days) requires an active subscription."}` ; en-têtes `X-RateLimit-Limit-Hour: 10`, `X-RateLimit-Limit-Day: 15` |
| Fenêtre glissante J-7 | 15 versions quotidiennes de `mvrv_zscore_data.json` (31/08 → 14/09) finissant chacune à J-7 ; API tierce passée de J-1 à J-7 le 2026-09-11 |
| Copies non retardées d'un partenaire (`files/*_alfabitcoin.json`, J-2) | **écartées** : contournement d'une restriction payante, non documentées |

Décision du propriétaire : rester sur l'offre gratuite. Lot `f0343c0` : badge « embargo 7 j »,
raison « Offre gratuite BGeometrics : les 7 derniers jours sont réservés aux abonnés (dernière
observation accessible : JJ/MM/AAAA) », motif mesuré à l'appel (âge 6 à 9 j, robuste au cache 24 h) ;
« source en retard » réservé aux autres retards. CI : 6 093 tests, gzip 356 821 / 360 000, e2e 53/53.

## Lot livré (`50d7e40`)

- `BgResultat.repli` : « cache périmé » seulement pour une valeur resservie faute d'appel abouti ;
  sinon « source en retard » + « Dernière observation publiée par BGeometrics : JJ/MM/AAAA ».
  `perime` inchangé.
- 403 d'abonnement mémorisé 24 h (`refusAbonnementBg.ts`, type d'accès seul), invalidé au
  changement de clé par un compteur de génération, exclu de l'export/import de sauvegarde.
- Plafond journalier 15 appliqué avec clé ; quota santé « x/10 h · y/15 j » (`"1hour"`, reconnu par HealthPanel).
- Repli ETF BTC : règle des séances à 5 jours partout (badge, qualité, historique).
- Textes Réglages / CHAIN : une clé gratuite ne relève pas le quota.

## Revue

Workflow : développeur TDD (13 tests rouges puis verts), 3 relecteurs (quota/sécurité,
états/consommateurs, tests), 12 constats contre-vérifiés et corrigés. Contre-revue du diff final :
aucun bloquant ; retenus — cohérence 5 j du repli ETF, génération obligatoire, ordre
incrément/effacement ; réordonnancement netflow/reserve dans `fluxCapitaux.ts` **retiré**
(sacrifiait cap/STH/LTH à un 403 connu). Relecture des retouches : aucun constat.

## Preuves

- `bash scripts/ci.sh` : web 4 007, indicators 1 376, backtest 103, alerts 76, daemon 519 ;
  gzip initial 356 816 / 360 000.
- `pnpm check:e2e` : 53/53 (un premier passage avait vu `gate-lot3-corr` instable, 4/4 en isolé, vert au passage suivant).
- Réseau réel, serveur de dev, contexte vierge : 9 requêtes `/bgapi` à froid (reserve non demandée,
  « abonnement requis »), 0 à chaud ; tuiles MVRV-Z/SOPR/NUPL/Puell « SOURCE EN RETARD », Reserve Risk frais ;
  mémoire `{"echeance":…,"acces":"env"}` sans clé.

## Limites connues

- Compteur client figé sur l'offre gratuite (10 req/heure, 15 req/jour) pour toute clé : une clé
  personnelle d'offre payante resterait bridée côté client (déjà vrai pour l'horaire, accentué par le plafond journalier).
- DataWindow : la jauge de quota ne lit que la fenêtre principale (texte correct, barre horaire).
- Clé serveur remplacée côté Vercel : une mémoire `env` reste valide jusqu'à 24 h.
- Course entre onglets sur la mémoire d'abonnement : fenêtre réduite, non fermée (pas de verrou localStorage).
- `50d7e40` déployé (prébuilt `dpl_7vaYEPsBduCsNxEuRyYbmQWQ5j3X`, alias vérifié en réseau réel).
