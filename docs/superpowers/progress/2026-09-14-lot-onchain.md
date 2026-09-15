# 2026-09-14 — Lot on-chain : mineurs, thermocap, alertes on-chain, activité DEX, clé BGeometrics

Demande du propriétaire : « Vois-tu de nouvelle fonction pertinente on-chain à ajouter ? »
puis « Go et demande moi quel clé te fournir », suivie de la clé BGeometrics à enregistrer.
Dépôt : `~/Projects/axiom` (déplacé le matin même).

## Sondes réelles avant de coder (toutes sans clé)

| Source | Résultat | Conséquence |
|---|---|---|
| Coin Metrics community `IssTotUSD`, `SplyCur` | servis (historique depuis 2010-07-18) | thermocap faisable |
| Coin Metrics community `SplyAct1yr`, `CapRealUSD`, `NVTAdj90`, `SplyFF`, `SplyAct30d` | refusés | pas d'offre LTH ni de realized cap sans clé |
| BGeometrics `lth-supply`, `hodl-waves`, `exchange-netflow` | 404 | pas de flux exchanges ni de vagues HODL |
| blockchain.info `miners-revenue` | 41,85 M$ au 13/09 | hashprice faisable |
| mempool.space `hashrate/1y` | 365 points | Hash Ribbons faisables |
| DefiLlama `overview/dexs` + CoinGecko `global` | 6,76 Md$ pour 63,2 Md$ | part DEX faisable |

## Lots livrés (commits, tests d'abord, revue indépendante ensuite)

| Commit | Contenu |
|---|---|
| `a152220` | CHAIN section « Mineurs » : Hash Ribbons SMA 30/60 j (capitulation / reprise / expansion), hashprice $/PH/j = revenus blockchain.info ÷ hashrate du même jour UTC. 12 + 3 tests. |
| `992da72` | CHAIN tuile « Thermocap multiple » = capitalisation ÷ Σ IssTotUSD (subvention hors frais, depuis 2010-07-18). Pagination Coin Metrics factorisée. 7 tests. |
| `1a99310` | Tuile Hash Ribbons compactée après contrôle visuel. |
| `f11f7dd` | Proxy Vercel : repli serveur `BGEOMETRICS_API_KEY` vers bitcoin-data.com quand le client n'envoie aucune clé. **Exception actée** dans BUILD-CONTRACT (règle « proxy sans secret partagé »). |
| `edef270` | Alerte globale `onchain-seuil` sur six métriques quotidiennes (MVRV-Z, SOPR, NUPL, thermocap, hashprice, frais sat/vB) ; runtime front, poll 15 min, chargeur importé à la demande ; panneau Alertes. 6 + 3 + 1 tests. |
| `77791d0` | CHAIN section « Activité DEX » : volume DEX 24 h / 7 j et part du volume total CEX + DEX. 7 + 3 tests. |
| `d203ac5` | Contrat : lot on-chain consigné dans les exceptions G100. |
| `de74088` | `ProxyEnv` indexé, garde structurelle du proxy limitée à une seule lecture d'environnement. |
| `f2f22a5` | Revue indépendante : valeurs de cache périmées refusées par les alertes on-chain ; test de bout en bout de la non-fuite de la clé sur une redirection à deux sauts. |

## Revue indépendante

Agent relecteur sur `a748b3e..HEAD`. Aucun bloquant. Deux points importants, corrigés dans
`f2f22a5` : (1) `chargerMetriquesOnchain` consommait un cache périmé comme une valeur
fraîche, à l'inverse de `flux-capitaux-seuil` ; (2) la non-fuite de la clé lors d'une
redirection vers un autre hôte de la whitelist n'était prouvée que par les unités de
`_policy.ts`, pas sur le handler. Les calculs financiers et l'injection de clé ont été jugés
corrects sur le fond, avec deux vérifications empiriques par le relecteur (IssTotUSD servi
par le tier community ; blockchain.info sans point pour le jour courant).

## Preuves

- `bash scripts/ci.sh` : types, 1 376 + 76 + 103 + 3 979 tests unitaires + 519 tests daemon,
  build à 356 719 octets gzip pour 360 000 (marge 3 281).
- `pnpm check:e2e` : 51 parcours hermétiques verts.
- Chrome sur le serveur de dev, données réelles : hashprice 42,42 $/PH/j = 41 850 977 $ ÷
  986 700 PH/s du 13/09 (calcul manuel identique) ; rubans en « Reprise » (croisement
  haussier le 27/08) ; thermocap 16,5 ; DEX 6,76 Md$, −29,92 % 7 j, 10,6 % de 64,03 Md$ ;
  alerte « MVRV Z-Score ≥ 7 » créée et calibrée « armée » (MVRV-Z réel 0,91).
- Déploiement prébuilt ; l'alias sert `index-IJQid6MS.js`, identique au build local.
- Alias, fenêtre CHAIN : mêmes valeurs qu'en dev ; « Thermocap multiple 16,5 » ; option
  « On-chain » présente dans le panneau Alertes.
- `curl` de l'alias `/bgapi/v1/sopr?startday=2026-09-01&endday=2026-09-13` → HTTP 200 avec
  les points du 1er au 7 septembre (le proxy porte la clé serveur) ; la valeur de la clé est
  absente du bundle (grep = 0).

## Clé BGeometrics

- Enregistrée dans `apps/web/.env` (gitignoré) et dans l'environnement Vercel **production**
  (`vercel env add`, valeur chiffrée), jamais dans git.
- Mon IP locale a épuisé le quota journalier bitcoin-data.com (sondes + dev) : l'effet de la
  clé sur le quota (horaire par clé plutôt que journalier par IP) n'a pas pu être mesuré
  depuis ce poste ; seule la réponse 200 via l'alias est prouvée.
- Dans le profil Chrome par défaut, quatre tuiles BGeometrics affichent « cache périmé »
  (observation du 07/09) : le compteur horaire côté client `axiom:onchain:bg:count:<heure>`
  vaut 10, soit le quota horaire par clé atteint par mes sondes et ouvertures de CHAIN ;
  le client cesse alors d'interroger la source jusqu'à l'heure suivante et ressert son
  cache, comme prévu. La série SOPR publiée par bitcoin-data.com s'arrête bien au 07/09.

## Limites connues

- Part DEX = valeur courante ; aucun historique du volume total sans clé.
- Thermocap : émission antérieure au 2010-07-18 négligée (prix quasi nul), frais exclus.
- Alertes on-chain : app ouverte uniquement (front-only), non composables, quota BGeometrics
  partagé pour MVRV-Z / SOPR / NUPL.
- Offre LTH/STH, vagues HODL : hors de portée sans clé Glassnode (plan avec accès API)
  ou CryptoQuant.
- Correction du même jour : les flux nets vers les exchanges ne sont PAS hors de portée.
  Coin Metrics community sert `FlowInExNtv`, `FlowOutExNtv` et `SplyExNtv` sans clé
  depuis 2011-04-24 (sondé le 2026-09-14) ; les flux sont raccordés par le chantier
  « indicateurs gratuits vérifiés » (`docs/superpowers/plans/2026-09-14-indicateurs-gratuits.md`),
  la réserve reste non affichée (dérive du périmètre d'adresses).
