# 2026-09-14 (après-midi) — BGeometrics : source en retard, refus d'abonnement, plafond journalier

Demande du propriétaire : « Reprends le projet et fais fonctionner les nouveaux outils on-chain »,
avec la clé BGeometrics. Arbitrage en cours de séance : **BGeometrics uniquement**
(pas de repli Coin Metrics), correctifs « Messages trompeurs » et « Économie de quota ».

## Diagnostic (preuves réelles)

| Constat | Preuve |
|---|---|
| La clé fournie est celle déjà installée ce matin | `apps/web/.env` (gitignoré) et `vercel env ls production` |
| Mineurs, Thermocap, Activité DEX fonctionnent en prod | alias, contexte Chrome vierge : hashprice 42,42 $/PH/j, thermocap 16,5, DEX 6,76 Md$ |
| bitcoin-data.com ne publie plus MVRV-Z, SOPR, NUPL, Puell après le **2026-09-07** | réponses `/bgapi` (114/120 points) **et** fichiers publics `charts.bgeometrics.com/files/{mvrv_zscore,sopr,nupl}_data.json` qui s'arrêtent au 07/09 ; reserve-risk, realized-cap, STH/LTH au 13/09 |
| Offre gratuite : 10 req/heure **et** 15 req/jour | page pricing bitcoin-data.com |
| Le quota est compté par IP pour une même clé | 429 `RATE_LIMIT_HOUR_EXCEEDED` depuis le poste à 09:09 UTC, 200 via Vercel à 09:12 UTC avec la même clé |
| Une ouverture à froid de CHAIN consommait 10 requêtes | onglet réseau prod : 9 × 200 + 403 netflow, puis reserve bloquée par le compteur client (« Quota atteint » au lieu de « abonnement requis ») |

Conséquence non corrigeable côté AXIOM : tant que BGeometrics ne republie pas, les alertes
`onchain-seuil` sur MVRV-Z / SOPR / NUPL restent non évaluables (valeurs > 3 j exclues, comportement voulu).

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
- Non déployé à la rédaction : la prod sert encore `index-IJQid6MS.js`.
