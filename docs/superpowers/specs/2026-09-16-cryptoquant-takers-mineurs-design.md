# AXIOM — CryptoQuant BASIC : flux takers toutes places (DES) et production des mineurs cotés (CHAIN)

> **Spec de conception · 2026-09-16.** Issue du sondage réel de la clé CryptoQuant du propriétaire
> (33 requêtes le 2026-09-16), d'une contre-vérification multi-agents de la valeur ajoutée
> (8 agents), puis d'un atelier de conception (4 lecteurs du dépôt, 3 architectes, 2 juges).
> Décisions du propriétaire actées le 2026-09-16 : **nouveau fournisseur à clé personnelle**
> (exception au contrat), **archive côté client** (option 1), deux sous-lots **B1** (socle +
> section DES) et **B2** (sous-section CHAIN).
>
> Cadre : `BUILD-CONTRACT.md`. Trois verrous du contrat sont amendés ici (§7). Le lot A
> « gains gratuits » (bug Coinbase `limit`, ETF par fonds, prime CBPREM ajustée USDT) a été
> livré et fusionné dans `main` avant cette spec (`3abd3b5`).

---

## 1. Le problème et la demande

Le propriétaire a souscrit l'offre **BASIC** de CryptoQuant et demande « quel indicateur
pertinent ajouter à AXIOM grâce à cette clé ». Le sondage établit que presque tout ce que
l'offre expose doublonne des sources déjà câblées (prime Coinbase = CBPREM ; prime/décote,
encours et volume des ETF = champs SoSoValue déjà reçus ; OI, funding, liquidations, taker perp
Binance = Coinalyze/Binance/BGeometrics). Deux familles sont **réellement uniques** :

1. **Flux takers agrégés toutes places** (`/v2/market/cq/{spot,swap}/trade`, `btc_all`/`eth_all`) :
   volumes acheteur/vendeur, ratio, VWAP, nombre de trades, sur l'ensemble des places
   suivies par CryptoQuant. AXIOM ne lit le côté agresseur spot que sur Binance.
2. **Production on-chain des mineurs cotés** (`/v1/btc/miner-data/companies`, 9 sociétés) :
   BTC minés du jour attribués aux adresses de chaque société, cumul mensuel, valeur USD,
   production déclarée. Aucune source gratuite ne rattache une production à une société.

Décision du propriétaire : les deux, dans cet ordre, sans nouvelle fenêtre.

## 2. Ce que le sondage établit (faits, à ne pas re-sonder)

**Offre BASIC** (documentation officielle et 403 observés) : licence **personnelle** ;
**10 req/min** (en-têtes `x-ratelimit-limit: 10`, `x-ratelimit-remaining`, `x-ratelimit-reset`
= secondes restantes, `6` observé) ; **10 000 req/mois** ; fenêtre **journalière seule**
(`window=hour` → 403) ; **30 jours glissants** (`limit` plafonné à 30 lignes ; `from` antérieur
à 30 j → HTTP 400 « Out of allowed request range ») ; **aucune donnée on-chain** (exchange-flows,
flow-indicator, market-indicator dont MVRV/SOPR, network-indicator, miner-flows → 403
« Professional plan and above »).

**Transport** : base `https://api.cryptoquant.com`, en-tête `Authorization: Bearer <clé>`.
Enveloppe `{ status: { code, message, description? }, result: { window, data: [...] } }`.
Lignes triées **de la plus récente à la plus ancienne** ; dernière ligne = **J-1** (2026-09-15
vu le 16 à 18:00 UTC). Paramètres : `window=day`, `limit` ≤ 30, `from`/`to` (`YYYYMMDD`).

**Taker agrégé** (v2) — ligne : `datetime "YYYY-MM-DD 00:00:00"`, `symbol`, `base`, `quote:
"all"`, `trade_count`, `base_volume`, `quote_volume`, `base_buy_volume`, `quote_buy_volume`,
`base_sell_volume`, `quote_sell_volume`, `vwap`, `buy_ratio`, `sell_ratio`, `buy_sell_ratio`,
`buy_count`, `sell_count` (+ `inverse: boolean` pour `swap`). Exemple spot BTC 2026-09-15 :
`base_volume` 156 928 BTC, `quote_volume` 12,0 G$, `buy_ratio` 0,495, `buy_sell_ratio` 0,980,
`trade_count` 12,1 M. Composition des places : « CryptoQuant's cross-exchange aggregate »,
**non documentée**.

**Mineurs cotés** (v1) — `?miner=<id>`, ids : `bitf`, `cipher`, `clsk`, `core`, `hive`, `iren`,
`mara`, `riot`, `wulf`. Ligne : `date "YYYY-MM-DD"`, `coinbase_rewards`, `other_mining_rewards`,
`total_rewards` (BTC), `accumulated_monthly_rewards`, `unique_txn`, `active_address_count`,
`reported_production` (`null` hors publication), `report_accuracy` (`null`), `closing_usd`,
`total_daily_rewards_closing_usd`, `accumulated_monthly_rewards_closing_usd`. Exemple MARA
2026-09-15 : 49,05 BTC, cumul mensuel 396,96 BTC, 3,84 M$.

**Budget de requêtes** : 4 séries taker + 9 mineurs = **13 requêtes par jour**. La contrainte
réelle n'est pas le quota mais la **fenêtre de 30 jours sans rattrapage** : tout jour non
collecté au-delà de 30 jours est **perdu définitivement**.

## 3. Décisions du propriétaire (non négociables)

1. Fournisseur **CryptoQuant BASIC** admis pour **deux familles seulement** (§1). Toute autre
   série exige un nouvel amendement. **BGeometrics reste la source unique** de MVRV-Z, SOPR,
   NUPL et Puell : aucune substitution, même si l'offre évoluait (mémoire projet).
2. Clé **personnelle**, saisie dans les Réglages. Repli `.env` (`CRYPTOQUANT_API_KEY`) pour le
   proxy Vite et le daemon lié à `127.0.0.1` **uniquement**. **Aucune variable serveur sur
   Vercel** (déploiement public, licence personnelle) ; sans clé personnelle sur Vercel :
   **aucun appel**, message « clé personnelle requise ».
3. **Archive côté client** (option 1) : à chaque ouverture, le client lit l'API si un jour
   nouveau peut exister, fusionne dans un cache versionné (localStorage + KV du daemon quand il
   tourne). **Pas de collecteur daemon** dans ce lot.
4. **Aucune nouvelle fenêtre** (gel G100 : 39 fenêtres), aucun indicateur graphique (200),
   aucune dépendance, `EXCHANGE_IDS` à 9, aucun hôte `/extapi`, CSP inchangée. Tout code
   nouveau vit dans des **chunks chargés à la demande** ; le budget initial reste bloquant
   (1 220 000 octets bruts / 360 000 gzip, marge mesurée sur le runner ≈ 3 365 gzip).
5. L'agrégat du fournisseur est **consommé tel quel** : aucun AggregationEngine, spot et perp
   jamais additionnés, ratios et VWAP jamais recalculés.
6. La clé collée dans la conversation d'origine est considérée compromise : le propriétaire
   la **régénère** et la renseigne lui-même (`apps/web/.env`, Réglages). Aucun agent ne la lit.

## 4. Architecture

Trois clones du patron `/bgapi` (relais d'un `Authorization: Bearer` vers un seul hôte),
durcis par une **liste fermée de chemins** (patron `/defillamapro`), un client en chunk à la
demande, et une archive par série avec union locale ∪ KV. Une seule abstraction nouvelle :
le module client `apps/web/src/data/onchain/cryptoquant.ts`.

### 4.1 Route `/cqapi` — trois chemins, une politique

**Module partagé `shared/cryptoquant-proxy.ts`** (patron `shared/defillama-proxy.ts`, zéro
import) :

- `CRYPTOQUANT_HOST = "api.cryptoquant.com"` ;
- `cleCryptoQuantValide(authorization)` : `^Bearer\s+\S+$` (casse indifférente), ≤ 512
  caractères — même prédicat que `api/_policy.ts:277-284` ;
- `cheminCryptoQuantAmont(pathname, search): string | null` : retire `/cqapi`, n'accepte
  **que** `/v2/market/cq/spot/trade` et `/v2/market/cq/swap/trade` avec `symbol` ∈
  {`btc_all`, `eth_all`}, et `/v1/btc/miner-data/companies` avec `miner` ∈ {les 9 ids} ;
  `window=day` **obligatoire** ; `limit` entier 1..30 ; **`from`/`to` refusés** ; toute autre
  clé de query, doublon ou casse différente → `null`. Le client demande toujours
  `window=day&limit=30` : même coût qu'une requête d'appoint, capte les révisions du
  fournisseur dans la fenêtre, et rend le 400 « Out of allowed request range » impossible.

**Vercel (`api/_policy.ts`, `api/proxy.ts`, `vercel.json`)** : `"cqapi"` ajouté à
`ProxyRouteId`, `FIXED_ROUTES` (`{ host: CRYPTOQUANT_HOST, methods: ["GET"] }`) et `ROUTE_IDS`
(les trois emplacements ; `ROUTE_IDS` est typé mais non exhaustif : l'oubli compile et donne un
404 silencieux). Dans `planProxyRequest`, branche après celle de `defillamapro` : sans
`Authorization: Bearer` valide → **401 local** « clé CryptoQuant personnelle requise »,
**avant tout appel amont** ; chemin hors liste → 404 « chemin CryptoQuant refusé » ;
`maxRedirects` = 0. `proxyUpstreamHeaders` relaie le Bearer vers `CRYPTOQUANT_HOST` ; le repli
`env["BGEOMETRICS_API_KEY"]` reste strictement borné à `bitcoin-data.com`. **Aucune lecture
d'environnement** : le test structurel `apps/daemon/src/vercelProxy.test.ts:42-45` (exactement
une occurrence de `env[`) reste vert et devient la preuve du verrou. La réponse est
`private, no-store` d'elle-même (credential présent). `api/proxy.ts` recopie les trois
en-têtes `x-ratelimit-limit/remaining/reset` amont dans `responseHeaders` (ensemble fermé,
`:351-356`) pour la route `cqapi` et **relaie le corps JSON amont** (`status.message` utile,
la clé est en en-tête donc sans secret) — ne pas copier le bloc `defillamapro` qui jette le
corps. `vercel.json` : deux rewrites `/cqapi/:path*` et `/cqapi/:path*/` avant le repli SPA ;
`connect-src 'self'` couvre la route (même origine) : **aucun ajout au CSP**.

**Daemon (`apps/daemon/src/proxy.ts`, `env.ts`)** : gestionnaire dédié `traiterCryptoQuant`
calqué sur `traiterCcData`/`traiterDefillamaPro` (hors table `construireRoutesProxy`) :
navigation → 403 ; non-GET → 405 `allow: GET` ; clé = en-tête client si valide, sinon
`Bearer <.env>` si non vide, sinon **401 sans fetch** ; chemin via le module partagé sinon
404 ; `recupererExtapiSecurise` avec `hotesAutorises = {CRYPTOQUANT_HOST}`,
`maxRedirections: 0`, `cache-control: private, no-store` ; recopie des `x-ratelimit-*` +
`access-control-expose-headers` ; corps amont relayé. **Rien dans `cache.ts`** :
`TTL_SECONDES_PAR_PREFIXE` est verrouillé par `cache.test.ts:31-39` et la clé de cache SQLite
ignore `Authorization` (une réponse obtenue avec une clé serait resservie à une autre) ; un
assert `ttlMsPourChemin("/cqapi/…") === 0` fige ce point. `ProxyKeys` et `chargerCles` gagnent
`CRYPTOQUANT_API_KEY` (fichier unique `apps/web/.env`) ; le littéral typé `CLES` de
`proxy.test.ts:22-29` doit recevoir le champ (sinon le typecheck échoue avant les tests).

**Vite dev (`apps/web/vite.config.ts`)** : `CRYPTOQUANT_API_KEY` lu par `loadEnv` ; define
`__CQ_CLE_ENV__ = !isVercelBuild && clé non vide` (gardé par `isVercelBuild` : `loadEnv` lit
aussi `process.env`, une variable posée par erreur dans l'env de build Vercel ne doit jamais
produire des appels puis des 401) ; entrée `server.proxy["/cqapi"]` : `rewrite` par
`cheminCryptoQuantAmont` (chemin refusé → `/__axiom_refuse__`), **un seul `bypass`** (non-GET →
405 ; ni en-tête valide ni `.env` → 401 JSON local ; hors liste → 404 ; chaque réponse locale
termine par `res.end()` puis `return req.url` — Vite 6 relaierait sinon la requête),
`proxyReq` injecte `Authorization: Bearer <.env>` seulement si l'en-tête est absent (patron
`/bgapi`), `proxyRes` force `private, no-store`, timeouts 15 s, `error` → 502 JSON.
`apps/web/.env.example` documente la variable (« licence personnelle — repli Vite/daemon
127.0.0.1 uniquement, jamais sur Vercel ») et complète la liste « Lue par ».

### 4.2 Clé personnelle

- Store `apps/web/src/store/cryptoquant.ts` (patron `store/ccdata.ts`/`store/onchain.ts`,
  **zéro dépendance data**) : clé localStorage `axiom:cryptoquant:key`, `getCryptoquantKey()`,
  état `{ hasKey, version, setKey, clearKey }`, la valeur **jamais dans le state** ;
  `hasKey` = clé **personnelle** seule (badge Réglages cohérent avec BGeometrics/CCData) ;
  `version` incrémenté à chaque `setKey`/`clearKey` (rotation vraie → vraie détectée).
- `apps/web/src/store/persist.ts` : `"axiom:cryptoquant:key"` ajoutée à
  `CLES_CREDENTIALS_LOCALES` (commentaire « Dix credentials » corrigé) ; miroir dans
  `persist.test.ts:62-66`. Voir §4.4 pour l'archive.
- `SettingsPanel.tsx` : un `ApiKeyField` après DefiLlama Pro — nom « CryptoQuant (takers et
  mineurs cotés) », `purpose` ternaire `IS_VERCEL` (sur Vercel : « clé personnelle requise —
  aucun repli serveur, licence personnelle » ; en local : « repli `CRYPTOQUANT_API_KEY` de
  `.env` pour le proxy Vite et le daemon local uniquement ; une clé saisie ici reste
  prioritaire »), domaine « api.cryptoquant.com, via la route locale /cqapi », lien
  cryptoquant.com. `docs/csp-vercel.md` : liste des clés personnelles mise à jour (elle est
  déjà périmée : « neuf clés » pour onze entrées) et mention explicite que les routes proxy à
  préfixe (`/bgapi`, `/cqapi`…) sont même-origine et n'entrent pas dans `connect-src`.
- **Clé active pour un appel** = clé personnelle, ou (`__CQ_CLE_ENV__` et `!IS_VERCEL`). Sans
  clé active : **aucun fetch, aucun créneau**, statut `cle-requise`,
  `RAISON_CLE_CRYPTOQUANT = "Clé CryptoQuant personnelle requise (Réglages ⚙)."` — l'archive
  existante reste affichée avec « clé requise pour actualiser » ; archive vide → `SansCle` +
  bouton Réglages (CTA conditionné à `raison === RAISON_CLE_CRYPTOQUANT`, patron
  `OnchainWindow.tsx:896-907`). Le message local ajoute « — ou `CRYPTOQUANT_API_KEY` dans
  `apps/web/.env` pour le proxy Vite et le daemon » ; sur Vercel : « — licence personnelle,
  aucun repli serveur sur ce déploiement ».

### 4.3 Client `apps/web/src/data/onchain/cryptoquant.ts` (chunk à la demande)

Chargé par `await import(...)` depuis les sections DES et CHAIN, **jamais importé
statiquement** par un module du bundle initial ni par le store de clé (un import statique
partagé DES/CHAIN créerait un chunk préchargé par l'entrée). Quatre parties **pures** et un
orchestrateur.

**Catalogue** : 13 séries `SerieCq` = `taker:spot:btc`, `taker:spot:eth`, `taker:swap:btc`,
`taker:swap:eth`, `mineur:<id>` × 9 ; `cheminSerie(serie)` → URL relative `/cqapi/…?…&window=day&limit=30`.

**Parseur** : enveloppe `{ status: { code }, result: { data } }` ; `code ≠ 200` ou `data`
absent → `[]` ; `datetime.slice(0, 10)` (taker) ou `date` (mineur) validés par `dateOnchain`
(`data/onchain/cohorts.ts`) → clé jour UTC `YYYY-MM-DD` ; nombres par `nombreOnchain` ;
`reported_production`/`report_accuracy` `null` **conservés null, jamais 0** ; jour ≥ aujourd'hui
UTC ignoré (seuls des jours clos) ; ligne invalide ignorée, jamais tout le lot ; tri ascendant
et dédoublonnage par jour.

**Cadence et quota** : fenêtre glissante **10 req / 60 s**, acquisitions **sérialisées** dans une
file unique partagée par les 13 séries (copie adaptée d'`acquireSlot`, `data/coinalyze.ts:106-132`,
où `RATE_LIMIT` vaut 40 ; ici `LIMITE_MIN = 10`) ; chaque créneau publie `healthStore.setQuota("cryptoquant", { utilise,
limite: 10, fenetre: "1min" })` (le panneau DATA affiche « x/10 min ») ; correction par les
en-têtes relayés : `x-ratelimit-remaining: 0` → la file attend `x-ratelimit-reset` secondes
avant le créneau suivant. DES (4) et CHAIN (9) tiennent chacune sous 10 ; ouvertes dans la
même minute, 13 > 10 : les 3 dernières attendent ≤ 60 s et l'interface l'affiche (« n/N reçues
· en attente du quota CryptoQuant (10 req/min) »), jamais un chargement muet. Coalescence :
deux consommateurs simultanés d'une même série = un seul fetch ; annulation par
`AbortSignal.any([signal, AbortSignal.timeout(15_000)])`.

**Déclenchement et court-circuit** (interprétation retenue de « chaque ouverture lit l'API » :
*lit dès qu'un jour nouveau peut exister*) : au **montage de la fenêtre** DES ou CHAIN, pour
chaque série de la section, en boucle séquentielle avec affichage progressif :

1. lire l'archive (§4.4) ;
2. si `jours[hier UTC]` existe → statut `pret`, **zéro appel** ;
3. sinon si aucune clé active → `cle-requise` (archive existante affichée) ;
4. sinon si `Date.now() < repriseTs` (429 en cours) → `quota` ;
5. sinon si `Date.now() − majTs < 6 h` → `pret` sans appel (J-1 pas encore publié ; heure de
   publication inconnue, vue disponible à 18:00 UTC) ;
6. sinon créneau puis `fetch(cheminSerie, { headers, cache: "no-store", redirect: "error",
   signal })` — `Authorization: Bearer <clé perso>` seulement si clé personnelle (le proxy
   Vite/daemon injecte le repli sinon ; sur Vercel sans clé perso on n'arrive jamais ici).

Arithmétique : nominal 13 appels/jour ≈ **390 req/mois** ; pire cas (J-1 jamais présent avant
la reprise, fenêtres rouvertes en permanence) 13 × 4 × 30 = **1 560/mois** sur 10 000. Pas de
plafond mensuel bloquant (YAGNI) ; les chiffres sont consignés ici.

**Réponses** : 200 → parse → fusion → écriture → `healthStore.setEtat("cryptoquant",
"polling")` → `pret` ; **401** → `cle-requise` (« Clé CryptoQuant refusée (Réglages ⚙) ») ;
**403** → `offre` (raison = `status.message` amont, ex. « Professional plan ») — mémorisé **en
session** par famille (taker | mineurs), effacé par `setKey`/`clearKey`, pas de module
persistant (la liste fermée ne contient que des chemins BASIC-éligibles ; un 403 signifie une
offre révoquée) ; **429** → `repriseTs = now + borne[1 s, 15 min](x-ratelimit-reset s |
retry-after | 60 s)`, file suspendue (demandes conservées, reprises dans l'ordre), aucune
écriture, statut `quota` (« Quota CryptoQuant atteint (429) ; nouvel essai dans N s. ») ;
**400/5xx/réseau/timeout** → `erreur` (« CryptoQuant injoignable ; archive affichée. »),
`healthStore.marquerErreur`. Dans tous les cas d'échec, l'archive existante est renvoyée et
affichée, avec le badge « cache ou observation périmé » si J-1 manque depuis > 2 j. **Aucune
raison, aucun log, aucune URL ne contient jamais la clé** (test I9).

### 4.4 Archive côté client

**Emplacements** : une clé **par série** (13), jamais un blob (le KV daemon plafonne à
1 048 576 o par valeur, `apps/daemon/src/kv.ts:28`) : localStorage `axiom:onchain:cq:<serie>:v1`
et KV daemon namespace `onchain`, clé `cq:<serie>:v1` (convention `data/onchain/cache.ts:18-19`,
constantes privées `NS = "onchain"` et `PREFIXE_LS = "axiom:onchain:"` de `cache.ts:18-19`,
redéclarées localement par le client pour ne pas toucher `cache.ts`).

**Payload** (clés courtes nommées, valeurs **fournisseur brutes**, rien de dérivé) :

```json
{ "version": 1, "serie": "taker:spot:btc", "majTs": 1789580000000,
  "jours": { "2026-09-15": { "n": 12099486, "bv": 156928.13, "qv": 12007360401.32,
                              "bbv": 77681.20, "qbv": 5944281632.44, "bsv": 79246.93,
                              "qsv": 6063078768.88, "vwap": 76515.03, "br": 0.4950,
                              "bsr": 0.9802, "bc": 6133017, "sc": 5966469 } } }
```

Ligne mineur : `{ "r": total_rewards, "cr": coinbase_rewards, "om": other_mining_rewards,
"cm": accumulated_monthly_rewards, "usd": total_daily_rewards_closing_usd,
"cmu": accumulated_monthly_rewards_closing_usd, "px": closing_usd,
"decl": reported_production | null, "prec": report_accuracy | null }`. Non stockés :
`unique_txn`, `active_address_count`, `inverse` (documenté comme limite). `majTs` = horodatage
du **dernier appel réussi**, porté **dans le payload** (l'enveloppe `{ donnee, ts }` de
`ecrireCache` repose `ts` à chaque écriture, y compris une réécriture locale sans appel : elle
ne peut pas porter le TTL de reprise).

**Dérivés à la lecture, jamais stockés** (`diagnostiquer(archive, aujourdhuiUtc)`, pure, `now`
injecté) : `debut` = min(jours), `dernier` = max(jours), `hierPresent`, trous = jours absents
entre `debut` et avant-hier, partitionnés en **perdus** (< aujourd'hui − 30 j, définitifs) et
**manquants dans la fenêtre** (≥ aujourd'hui − 30 j, peuvent revenir) ; hier absent = « J-1 en
attente de publication », **jamais un trou** ; badge « périmé » si le dernier jour a plus de 2 j.

**Fusion** (`fusionner(archive | null, lignes, now)`, pure) : Map par jour ; ligne reçue →
remplace la ligne du même jour (révision fournisseur absorbée, `reported_production` rempli
après publication) ; **aucun jour existant n'est jamais supprimé** ; `null` → archive créée
`version: 1` ; réponse vide → `jours` et `majTs` inchangés.

**Lecture = union locale ∪ KV** (obligatoire : `lireCache` seul renvoie la copie locale sans
regarder le KV, et `ecrireCache` écrase le KV en `void kvPut` — un second navigateur ou un
poste réinstallé détruirait les jours que seul le KV possède). Séquence : `await
detectDaemon("kv")` (mémo 60 s, `false` sur Vercel) → lecture locale → si daemon, lecture KV
**tri-état** (absent / erreur / présent ; `kvGet` confond 404 et erreur, on lit par `fetch`
brut sur `urlDaemon("/kv/onchain/<cle>")`) → union par jour (conflit → copie au `majTs` le plus
grand) → si l'union enrichit le local, réécriture locale immédiate.

**Écriture** : local par `setItem` sous `try/catch` (`QuotaExceededError` → signal « archive
non persistée localement (stockage plein) », jamais silencieux) ; KV par **`await kvPut`**,
**jamais après une lecture KV en erreur** (on ne remplace pas ce qu'on n'a pas pu lire), garde
900 000 caractères. Écriture **par série** : une passe interrompue n'a rien perdu.

**Tolérance** : JSON illisible → « illisible », remplacé à l'écriture suivante avec signal ;
`version` > 1 → servie vide, **jamais réécrite** ni en local ni en KV (un build ancien ne
détruit pas l'archive d'un build futur) ; version 1 avec un jour invalide → seul ce jour ignoré.

**Sauvegarde JSON** : le préfixe `axiom:onchain:cq:` est ajouté à `resteSurLePoste`
(`persist.ts:790-792`, une ligne) : l'archive n'est **ni exportée ni remplacée à l'import**
(`importerSauvegarde` supprime toute clé du périmètre absente du fichier : une sauvegarde
ancienne raccourcirait l'archive ; données obtenues sous licence personnelle, même traitement
que les clés). La durabilité vient du KV daemon et de ses snapshots, pas du fichier d'export.

**Taille** : ≈ 110 car./jour taker, ≈ 75 car./jour mineur → ≈ 0,4 Mo/an, **≈ 2 Mo à 5 ans**
(≈ 160 Ko par clé taker, ≈ 135 Ko par clé mineur, loin de 1 Mio par valeur KV ; localStorage
≈ 5 Mo/origine, ≈ 1 Mo déjà utilisé). Le champ `version` réserve une compaction en tuples si
nécessaire. SQLite daemon : `kv_snapshots` copie tout le KV chaque jour, rétention 30 j
(≈ 60 Mo à 5 ans) — consigné, aucun changement daemon.

### 4.5 Santé, fiabilité, qualité

- Santé : source `cryptoquant` (`setEtat` polling / `marquerErreur`, `setQuota` 10/1min) ;
  libellé « CryptoQuant » dans `data/dataCockpit.ts` (importé seulement par la fenêtre DATA,
  paresseuse) — **pas** d'entrée dans `SOURCE_NAMES` de `HealthPanel.tsx` (bundle initial).
- Fiabilité : badge **local** `BadgeFiabilite niveau="partiel" label="J-1 · CryptoQuant"` en
  props libres (`ui.tsx:692-716`) — **pas** d'entrée dans le catalogue `lib/fiabilite.ts`
  (importé par `ui.tsx`, donc initial ; marge runner ≈ 3 365 gzip).
- Qualité CHAIN (B2) : `enregistrerQualite("chain:mineurs-cotes", "Mineurs cotés ·
  CryptoQuant", …)` — `observeLe` = J-1 max reçu, `recupereLe` = dernière lecture,
  `cadenceMs` 86 400 000, `ageMaxMs` 3 j (voir §12), `couverture { disponibles: sociétés avec ligne J-1,
  attendus: 9 }`, `acces "cle"`, statut « frais » à 9/9 sans trou récupérable, « partiel » si
  trous ou couverture < 9, « périmé » si J-1 absent > 2 j, « indisponible » sans clé et archive
  vide — visible dans « Qualité des blocs ».

## 5. Surfaces

### 5.1 DES — section « Flux takers toutes places (quotidien · CryptoQuant) » (B1)

Emplacement : `DerivativesWindow.tsx`, après `<SectionOiPerpsDex />` (`:769`), **hors** des
branches `!isBinance` / `!hasKey` Coinalyze (`:506-516`) : la section ne dépend ni du symbole
suivi, ni de l'exchange, ni de la clé Coinalyze (visible sur Bybit/OKX). Même enveloppe que
`OiPerpsDexSection.tsx:168-183` (section repliable, bouton `aria-expanded`, `▾/▸`), **repliée
par défaut** ; les données se chargent au **montage de la fenêtre** (§4.3), les quatre séries
d'un coup pour que les segmentés ne déclenchent aucun appel. Nouveau fichier
`components/FluxTakersSection.tsx` : vue **pure** `VueFluxTakers` (testée en
`renderToStaticMarkup`) + conteneur `SectionFluxTakers` (effet au montage, `version` du store
en dépendance, `AbortController` au démontage) ; modèle d'affichage pur `fluxTakers.util.ts`
(`situer`, Δ taker, cumul 7 j, points de courbe). `Sparkline` dupliquée localement (celle de
DES n'est pas exportée ; un module commun DES/CHAIN serait préchargé par l'entrée).

```
┌ ▸ FLUX TAKERS TOUTES PLACES (QUOTIDIEN · CRYPTOQUANT)      archive 30 j · J-1 2026-09-15 ┐
   états du côté droit : « 2/4 reçues · en attente du quota » | « clé personnelle requise »
                          | « quota atteint, reprise 42 s » | « chargement… »
│ [BTC | ETH]  [Spot | Perp]                  observation 2026-09-15 (J-1) · récupéré 2026-09-16
│ Ratio taker achat/vente  [J-1 · CryptoQuant]          ▂▃▅▃▂▃▅   0.98          ← ton up si ≥ 1
│   acheteurs 49.5 % · 30 j archivés : min 0.91 · méd. 0.99 · max 1.07 · 4ᵉ plus bas
│ Δ taker (quote)                                                 −$118.80M     ← qbv − qsv
│   7 j −$420.00M (7/7 j)                                                       ← « — (5/7 j) » si trou
│ Volume quote                                                     $12.01B      ← base en infobulle
│   12.10M trades · vs méd. 30 j +4.2 %
│ VWAP agrégé                                                    $76,515.03
│ [courbe SVG, dates réelles, pointillé à 1.0, rupture aux jours absents]
│ Archive locale depuis 2026-08-17 · 30 j · 2 manquants dans la fenêtre · 0 perdu
│ ▪ J-1 · CryptoQuant · agrégat toutes places (composition non documentée) · licence
│   personnelle · fenêtre 30 j sans rattrapage · quota 4/10 min
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Règles : `situer()` donne min · médiane · max · rang sur **N jours archivés** (N affiché,
**jamais un percentile** sur 30 points) ; Δ taker = `qbv − qsv` en `formatUsdSigne`, cumul 7 j
seulement si les 7 jours sont présents (sinon « — (k/7 j) ») ; formats du dépôt
(`formatDec`, `formatPourcentage`, `formatUsd` → « $12.01B », `formatCompact` → « 12.10M ») ;
**perp** : mène avec quote (USD), base et VWAP en infobulle avec la mention « unités
fournisseur, champ `inverse` non documenté » ; spot et perp **jamais additionnés** ; **pas de
comparaison Binance** dans ce lot. États : chargement (« Chargement des flux takers… », puis
tuiles dès la première série), quota, offre, erreur (bandeau au-dessus de l'archive servie),
sans clé + archive vide (`SansCle`), sans clé + archive (tuiles + badge « clé requise pour
actualiser »), série sélectionnée absente (« Série non encore archivée. »). Ligne d'archive
avec **trois états de trous** : « J-1 en attente de publication », « manquants dans la
fenêtre », « perdus (définitifs) ».

### 5.2 CHAIN — sous-section « Production des mineurs cotés » (B2)

Emplacement : **dans** la section « Mineurs » (`onchain/Mineurs.tsx`), sous les tuiles Hash
Ribbons / Hashprice et la courbe (slot `children` de `VueMineurs`, rendu avant la
`NoteSource`) ; conteneur `MineursCotes` avec son propre état, **hors** de l'effet
`Mineurs.tsx:112-125` qui refetch à chaque ouverture de CHAIN (le court-circuit J-1 rend le
montage sans coût). Bouton `boutonHistorique` « Production des mineurs cotés » `aria-expanded`
(patron `HistoriqueEtf.tsx`), replié par défaut. Nouveau fichier `onchain/MineursCotes.tsx`
(vue pure + conteneur), importé statiquement par `Mineurs.tsx` (OnchainWindow est déjà un
chunk paresseux) ; le **client** reste en `import()`.

```
 [Production des mineurs cotés ▾]                            archive 30 j · J-1 2026-09-15
   2026-09-15 (J-1) · 9/9 sociétés · Σ 1 843.20 BTC/j · cumul mois Σ 5 120.40 BTC · Σ $141.00M/j
   Société   BTC J-1   Cumul mois   USD J-1   Déclaré (mois)    ← TableTriable, défaut BTC J-1 ↓
   MARA      49.05     396.96       $3.84M    non publié
   CLSK      …         …            …         123.00 BTC
   RIOT · CORE · IREN · BITF · CIPHER · HIVE · WULF …
   ─────────────────────────────────────────────────────
   Σ 9       1 843.20  5 120.40     $141.00M  —                 ← seulement à 9/9, sinon « Σ partielle n/9 »
   [courbe « Production Σ 9 sociétés » BTC/j, null les jours où une société manque → ligne coupée]
   Archive locale depuis 2026-08-17 · 30 j · 1 perdu (2026-09-03)
   ▪ J-1 · CryptoQuant · miner-data/companies (9 requêtes) · licence personnelle · attribution
     des blocs par le fournisseur (périmètre non documenté) · cumul mois = valeur fournisseur
     · « déclaré » = production publiée par la société, absente hors publication
```

Règles : « Société » = identifiant fournisseur en majuscules, nom usuel en infobulle
(Bitfarms, Cipher Mining, CleanSpark, Core Scientific, HIVE Digital, IREN, MARA Holdings, Riot
Platforms, TeraWulf) ; « BTC J-1 » = `total_rewards` (`coinbase + autres` en infobulle) ;
« Cumul mois » = `accumulated_monthly_rewards` **consommé tel quel** (remise à zéro du
fournisseur, non recalculée) ; « USD J-1 » = `total_daily_rewards_closing_usd`, « — » si absent
(jamais inventé) ; « Déclaré » = `reported_production` **brut**, « non publié » si `null`,
**aucun écart %** déclaré/observé tant que la sémantique de `reported_production` et
`report_accuracy` n'est pas confirmée. Σ et parts sont des **sommes d'affichage** des 9 lignes
(même nature que le total OI par exchange de DES), pas un AggregationEngine ; Σ affichée
**uniquement à 9/9**. Aucun `<table>` nu (ratchet `uiConventions`, `TableTriable`). États :
mêmes que DES (« n/9 reçues · en attente du quota », quota, offre, erreur, sans clé →
`SansCle` + CTA « clé CryptoQuant ⚙ » dans l'en-tête de la section, conditionné à
`raison === RAISON_CLE_CRYPTOQUANT`) ; couverture partielle : lignes reçues affichées, société
en erreur → « — » avec infobulle de raison, qualité « partiel ».

## 6. Invariants et tests

Chaque invariant est figé par un test qui doit **échouer avant** l'implémentation (TDD).

- **I1 — l'archive ne rétrécit jamais.** Fusion : `{J-40…J-2}` + réponse `{J-30…J-1}` → J-1
  ajouté, J-2…J-30 remplacés, J-31…J-40 conservés, aucune clé supprimée ; jour présent en
  archive et absent de la réponse → conservé ; réponse vide → `jours` et `majTs` inchangés.
  Union : local vide + KV 400 j → 400 j et réécriture locale ; après fetch, `kvPut` reçoit
  ≥ 400 j ; **KV en erreur → `kvPut` jamais appelé** ; conflit même jour → `majTs` le plus grand.
- **I2 — seuls des jours UTC clos.** Deux formats de date → même clé ; jour d'aujourd'hui ou
  futur ignoré ; date invalide ignorée ; lignes récent → ancien → archive croissante ; `null`
  conservés (jamais 0) ; `code ≠ 200` → `[]`.
- **I3 — trous dérivés.** `{J-60…J-45}` puis `{J-30…J-1}` → `debut` J-60, 14 perdus
  (J-44…J-31), 0 manquant dans la fenêtre ; `{J-30…J-1}` sans J-10 → 1 manquant ; hier absent
  → `hierPresent = false`, non compté ; archive vide → `debut` null.
- **I4 — version inconnue et corruption.** `{ version: 2 }` → servie vide, aucun `setItem` ni
  `kvPut` sur cette clé pendant toute la passe ; JSON illisible → remplacé avec signal ;
  version 1 avec un jour invalide → seul ce jour ignoré.
- **I5 — une passe par jour et par série.** Hier présent → 0 fetch ; hier absent et
  `majTs < 6 h` → 0 fetch ; ≥ 6 h → 1 fetch ; URL exacte des 13 séries
  (`window=day&limit=30`, jamais `from`/`to`) ; échec réseau → `majTs` inchangé, archive
  servie ; 429 → aucune écriture.
- **I6 — ≤ 10 req / 60 s.** 13 séries en rafale → 10 fetch immédiats, 3 après 60 s ;
  `x-ratelimit-remaining: 0` + `reset: 42` → la suivante part après 42 s ; `setQuota`
  publié à chaque créneau ; coalescence (2 consommateurs = 1 fetch) ; annulation sans créneau.
- **I7 — 401/403/429 ne brûlent rien.** 403 sur une série taker → la 2ᵉ série taker répond
  `offre` sans fetch, la famille mineurs n'est pas affectée, `setKey` efface ; 401 →
  `cle-requise` ; 429 → file suspendue, demandes conservées, `repriseTs` borné (reset absurde
  1e9 → 15 min).
- **I8 — la clé n'apparaît nulle part.** `JSON.stringify(state)` sans la clé ; `version`
  incrémentée en rotation vraie → vraie ; `axiom:cryptoquant:key` exclue de l'export et
  préservée à l'import ; `axiom:onchain:cq:*` ni exportées ni supprimées à l'import ; espions
  `console.*`, `localStorage.setItem` (hors clé du store), `kvPut` et toutes les `raison` →
  aucune chaîne ne contient `CLE-TEST-SECRETE` ; l'URL fetchée ne la contient pas ; daemon :
  aucune sortie console ne contient l'Authorization ; `traiterCryptoQuant` n'appelle jamais
  `ecrireCache` ; `ttlMsPourChemin("/cqapi/…") === 0`.
- **I9 — Vercel sans secret.** Test structurel `vercelProxy.test.ts:34-46` **inchangé** (un seul
  `env[`) ; `required` + `/cqapi/:path*` ; boucle des routes + `["cqapi", "api.cryptoquant.com"]` ;
  GET sans Authorization → **401 y compris avec env `{ BGEOMETRICS_API_KEY, CRYPTOQUANT_API_KEY }`**
  (jamais de repli serveur) ; Bearer → target exact, en-tête relayé, pas de cookie,
  `cacheControl === "private, no-store"`, `privateResponse`, `maxRedirects === 0` ; 404 pour
  `v1/btc/exchange-flows/…`, `symbol=sol_all`, `miner=inconnu`, `window=hour`, `limit=31`,
  `from=20260901`, paramètre inconnu, doublon ; POST/HEAD → 405 `allow: GET` ; `Apikey x` /
  `Basic x` / > 512 → 401 ; la clé BG ne fuit pas vers api.cryptoquant.com. Handler complet
  (`vercelProxy.redirection.test.ts`) : 302 amont → 502 et un seul fetch ; 429 amont → statut,
  trois en-têtes et corps relayés ; sans clé → 401 et zéro fetch. Client : `IS_VERCEL` sans
  clé perso → 0 fetch, 0 créneau, `RAISON_CLE_CRYPTOQUANT`, archive locale servie, aucun accès KV.
- **I10 — sans clé en local.** `IS_VERCEL` faux, `__CQ_CLE_ENV__` faux, clé vide → 0 fetch ;
  drapeau vrai, clé vide → fetch **sans** en-tête Authorization ; `viteConfig.test.ts` :
  `define.__CQ_CLE_ENV__ === "false"` quand `process.env.VERCEL = "1"` même clé posée ;
  `bypassPour("/cqapi")` : POST → 405, GET sans en-tête et env vide → 401 + `writableEnded` +
  retour `req.url`, hors liste → 404, GET valide → `undefined`.
- **I11 — chunks à la demande, budget tenu.** `pnpm --filter @axiom/web build` avant/après
  chaque sous-lot (JSON du budget consigné) ; dans `.vite/manifest.json`, le client CryptoQuant,
  `FluxTakersSection` et `MineursCotes` absents des imports statiques de l'entrée ; test
  structurel : `data/onchain/cryptoquant.ts` n'est importé statiquement par aucun fichier hors
  `data/onchain/` ; delta initial attendu ≤ ~150 o gzip (store, persist, Réglages) ;
  `pnpm -r typecheck`. Porte d'acceptation : si la marge runner tombe sous ~3 000 gzip, retirer
  d'abord le libellé DATA.
- **Module partagé** (`apps/daemon/src/cryptoquantProxy.test.ts`, bun) : table exhaustive
  acceptés/refusés de `cheminCryptoQuantAmont` et de `cleCryptoQuantValide`.
- **Daemon** (`proxy.test.ts`) : `CLES` + champ ; « aucune route générique `/cqapi` » ;
  `traiterCryptoQuant` : URL amont exacte, Authorization relayée, `redirect: "manual"`,
  `private, no-store`, `x-ratelimit-*` recopiés, corps relayé ; refus 405/403/404/401 **avant
  tout fetch** ; repli `.env` sans en-tête → `Bearer envkey` ; en-tête perso prioritaire ;
  `env.test.ts` : `parseEnv("CRYPTOQUANT_API_KEY=abc")`.
- **Vues** (`renderToStaticMarkup`, `vi.setSystemTime`, patrons `OiPerpsDexSection.test.tsx`,
  `Mineurs.test.tsx`) : libellés exacts (« Flux takers toutes places », « 0.98 », « 49.5 % »,
  « $12.01B », « 12.10M », « Archive locale depuis 2026-08-17 », « 2 manquants dans la
  fenêtre », « J-1 en attente de publication », « composition non documentée », « Clé
  CryptoQuant personnelle requise (Réglages ⚙) », « en attente du quota », « Production des
  mineurs cotés », « non publié », « Σ partielle 7/9 », « Mineurs cotés · CryptoQuant »),
  ton down si ratio < 1, section repliée par défaut (`aria-expanded="false"`, aucun contenu,
  `import()` non appelé), jamais « 0 » pour une valeur absente, aucun `<table` nu,
  `Mineurs.test.tsx` inchangé (children optionnel).
- **e2e hermétiques** (`scripts/ci.sh --e2e`, deux specs **séparées** — l'horloge figée gèle
  `Date.now()` et la fenêtre glissante ne se purge jamais : DES = 4 appels, CHAIN = 9, chacune
  < 10) : `apps/web/e2e/des-flux-takers.e2e.ts` — `bouchonnerReseau`, horloge
  2026-09-16T12:00Z, onboarding, clé `axiom:cryptoquant:key` en `addInitScript`,
  `page.route` sur `pathname.startsWith("/cqapi/v2/market/cq/")` avec compteur et 4 fixtures
  de 30 lignes descendantes (spot BTC sans 2026-09-01/02) ; ouvrir DES → exactement 4 appels,
  bouton `aria-expanded=false` ; déplier → « 0.98 », « $12.01B », « 2 manquants »,
  « 2026-09-15 » ; segmentés → 0 appel de plus ; localStorage présent avec 28 jours et aucune
  URL avec `from` ; fermer/rouvrir → toujours 4 ; source Bybit → section visible ; 2ᵉ test :
  archive pré-remplie (10 jours antérieurs) → « Archive locale depuis 2026-08-07 », aucune
  date dupliquée ; 3ᵉ : fixture 429 `x-ratelimit-reset: 30` → « nouvel essai dans 30 s »,
  archive servie ; 4ᵉ : fixture **401** `{ erreur: "clé CryptoQuant personnelle requise" }` →
  message affiché (le cas « sans clé » n'est pas hermétique en e2e : Playwright lance `pnpm
  dev` qui lit `apps/web/.env` — il est couvert en unitaire, I9/I10).
  `apps/web/e2e/chain-mineurs-cotes.e2e.ts` — `ouvrirChainSansCle` + clé en `addInitScript`,
  9 fixtures `miner=<id>` (MARA `reported` null, RIOT renseigné, une société avec un jour
  manquant) ; ouvrir CHAIN → exactement 9 appels, bouton replié ; clic → « 49.05 »,
  « 396.96 », « $3.84M », « non publié », Σ, courbe ; « Qualité des blocs » contient
  « Mineurs cotés · CryptoQuant » ; repli/dépliage, fermeture/réouverture → 9 toujours.
  Les deux specs sont ajoutées à `scripts/ci.sh`.
- **Preuve manuelle du propriétaire** (hors CI, clé personnelle, jamais depuis un agent) :
  `curl -i http://127.0.0.1:8787/cqapi/v2/market/cq/spot/trade?symbol=btc_all&window=day&limit=30`
  sans en-tête → 401 (ou 200 si repli `.env`) ; avec Bearer → 200 + `x-ratelimit-*` +
  `cache-control: private, no-store` ; hors liste → 404 ; POST → 405 ; même série sur `vite
  dev` ; projet Vercel : **absence** de variable `CRYPTOQUANT_API_KEY` vérifiée dans les
  réglages ; session : DATA « CryptoQuant x/10 min », première ouverture DES → 4 appels,
  réouverture → 0, retrait de clé → « clé requise pour actualiser » ; **valeur réelle de
  `x-ratelimit-reset`** notée dans le rapport (secondes confirmées le 2026-09-16 : `6`).

## 7. Amendement de `BUILD-CONTRACT.md` — exception ACTÉE le 2026-09-16

Rédigé ici ; appliqué au contrat dans le **premier commit du lot** (B1-0), sur ce brief
explicite de l'orchestrateur (`.devin/provider-rules.md`, « Garde-fous »). Quatre retouches de
lignes et un sous-bloc.

1. **Décisions verrouillées, puce « Fournisseurs de capitalisation »** (`:18`), fin de phrase :
   « Aucun autre fournisseur sans amendement du contrat » → « Aucun autre fournisseur sans
   amendement du contrat (amendements : fournisseurs statistiques publics le 2026-09-06,
   CryptoQuant BASIC le 2026-09-16 — cf. « Extension autorisée le 16 septembre 2026 »). »
2. **État actuel, puce Vercel** (`:48`) — le verrou « une seule variable serveur,
   `BGEOMETRICS_API_KEY` » est **préservé mot pour mot** ; phrase ajoutée en fin de puce :
   « La clé CryptoQuant (2026-09-16) relève de cette règle : personnelle, saisie dans les
   Réglages, repli `.env` pour le proxy Vite et le daemon `127.0.0.1` uniquement, JAMAIS de
   variable serveur sur Vercel (le test structurel continue d'exiger exactement une lecture
   d'environnement). »
3. **Gate G100** (`:50`), dans l'énumération des exceptions, avant « ; le gel reste la règle » :
   « , et le 2026-09-16 (fournisseur CryptoQuant BASIC à clé personnelle sur décision du
   propriétaire : section repliable « Flux takers toutes places » dans DES et sous-section
   « Production des mineurs cotés » dans la section Mineurs de CHAIN — aucune fenêtre, aucun
   indicateur graphique, aucune dépendance, aucun hôte `/extapi` ; route dédiée `/cqapi` ;
   spec `docs/superpowers/specs/2026-09-16-cryptoquant-takers-mineurs-design.md`) ».
4. **Anti-objectifs** (`:59`), dans la parenthèse des exceptions : « …fournisseurs statistiques
   publics OCDE/Eurostat/ONS le 2026-09-06, et CryptoQuant BASIC le 2026-09-16 sur décision
   explicite du propriétaire — **sans source défaillante remplacée**, l'exception est nommée
   comme telle ».
5. **Sous-bloc** à la fin de la section « Extension autorisée le 16 septembre 2026 » (après le
   paragraphe « Limites à ne pas masquer », `:258-263`) :

   > ### Fournisseur CryptoQuant BASIC (décision du propriétaire, 2026-09-16)
   >
   > Le propriétaire a souscrit l'offre BASIC de CryptoQuant (licence PERSONNELLE ; 10 req/min ;
   > 10 000 req/mois ; fenêtre journalière seule ; 30 jours glissants, `limit` ≤ 30, `from`
   > antérieur à 30 j refusé ; aucune donnée on-chain, réservée au plan Professional) et
   > demande son raccordement à deux sections existantes : **DES — « Flux takers toutes
   > places »** (agrégat multi-places `spot/trade` et `swap/trade`, `btc_all`/`eth_all` : ratio
   > taker achat/vente, Δ taker en quote, volumes, VWAP, lus contre l'historique accumulé côté
   > client) et **CHAIN — « Production des mineurs cotés »** dans la section Mineurs
   > (`miner-data/companies`, neuf sociétés : production J-1, cumul mensuel fournisseur, USD,
   > production déclarée quand publiée ; Σ et parts sont des sommes d'affichage).
   >
   > Règles : (1) clé PERSONNELLE saisie dans les Réglages, exclue des exports
   > (`CLES_CREDENTIALS_LOCALES`), repli `CRYPTOQUANT_API_KEY` de `apps/web/.env` pour le proxy
   > Vite et le daemon lié à `127.0.0.1` uniquement, JAMAIS de variable serveur sur Vercel —
   > sans clé personnelle sur Vercel : aucun appel, « clé personnelle requise » ; la règle
   > « une seule variable serveur `BGEOMETRICS_API_KEY` » reste intacte. (2) Route dédiée
   > `/cqapi` à liste FERMÉE (`shared/cryptoquant-proxy.ts`) sur les trois chemins — Vite,
   > daemon, fonction Vercel — GET seul, `Authorization: Bearer` relayé, `private, no-store`,
   > zéro redirection, en-têtes `x-ratelimit-*` relayés ; aucun ajout à `shared/extapi-hosts.ts`,
   > CSP inchangée, aucune entrée de cache proxy (`TTL_SECONDES_PAR_PREFIXE` inchangé) :
   > l'archive côté client est le cache. (3) Archive CÔTÉ CLIENT : à l'ouverture des fenêtres,
   > le client fusionne les jours nouveaux dans une archive versionnée par série (localStorage
   > `axiom:onchain:cq:<serie>:v1` + KV daemon `onchain/cq:<serie>:v1`, union des deux, jamais
   > destructive, hors export/import de sauvegarde) ; la fenêtre fournisseur de 30 j sans
   > rattrapage impose d'afficher la date de début de l'archive, ses jours manquants et ses
   > jours définitivement perdus ; aucun collecteur daemon. (4) Requêtes toujours
   > `window=day&limit=30` sans `from` ; cadencement client 10 req/min visible (« en attente du
   > quota »), garde « J-1 déjà archivé → aucun appel » et reprise 6 h — ≈ 390 req/mois nominal,
   > ≤ 1 560 en pire cas, sur 10 000. (5) L'agrégat multi-places du fournisseur est CONSOMMÉ tel
   > quel — aucun AggregationEngine, spot et perp jamais additionnés, composition des places non
   > documentée et affichée comme limite. (6) BGeometrics reste la source unique de MVRV-Z,
   > SOPR, NUPL et Puell : CryptoQuant n'y est jamais substitué et ne fournit ici aucune
   > métrique de valorisation. (7) Aucune fenêtre (39), aucun indicateur graphique (200),
   > aucune dépendance, `EXCHANGE_IDS` à 9 ; tout code nouveau vit dans des chunks chargés à la
   > demande ; le budget initial reste bloquant (1 220 000 octets bruts, 360 000 gzip), mesures
   > avant/après consignées dans le rapport du lot. Exclus sans nouvel amendement : toute autre
   > série CryptoQuant, toute substitution de BGeometrics, tout collecteur daemon, tout
   > AggregationEngine.
   >
   > Limites à ne pas masquer : dernière ligne = J-1 ; composition des places « cross-exchange
   > aggregate » non documentée ; sémantique de `base_volume`/`vwap` pour les swaps inverses et
   > de `reported_production`/`report_accuracy` non confirmée (affichées brutes, sans écart
   > calculé) ; `accumulated_monthly_rewards` est le cumul du fournisseur (non recalculé) ;
   > l'archive dépend de l'usage (pas de collecteur) et, sur un poste sans daemon, vider le
   > stockage du navigateur la perd.

`docs/csp-vercel.md` : liste des clés personnelles actualisée (CryptoQuant incluse, compte
corrigé) et mention que les routes proxy à préfixe n'entrent pas dans `connect-src`.

## 8. Ce qu'on ne fait pas, et pourquoi

1. **Aucun collecteur daemon, cron ou recorder** : décision du propriétaire (option 1) ; le KV
   daemon n'est qu'un miroir durable écrit par le front.
2. **Aucune comparaison Binance** (VWAP ou ratio taker des bougies 1 j) dans DES : périmètre
   non demandé, flux réseau direct supplémentaire dans DES, alignement UTC non contrôlé le
   premier mois. Lot ultérieur si le propriétaire le souhaite.
3. **Aucun écart % « déclaré vs observé »** ni comparaison mois/mois du cumul : sémantique de
   `reported_production`, `report_accuracy` et de la remise à zéro du cumul non confirmée.
4. **Aucun paramètre `from`/`to`** (client et liste fermée) : même coût, révisions captées,
   400 impossible.
5. **Aucun plafond mensuel bloquant ni mémoire persistante des 403** : 13 requêtes par jour, la
   liste fermée est BASIC-éligible ; arithmétique consignée (§4.3).
6. **Pas de `lireCache`/`ecrireCache` pour l'archive** : lecture sans union et `void kvPut`
   écraseraient un KV plus riche ; `ts` d'enveloppe repose à chaque écriture.
7. **Pas de cache daemon pour `/cqapi`**, pas de HEAD, pas d'ajout au CSP ni à
   `extapi-hosts.ts`, pas d'appel direct navigateur → api.cryptoquant.com.
8. **Pas d'entrée catalogue** dans `lib/fiabilite.ts` ni dans `SOURCE_NAMES` (bundle initial) :
   badge local et libellé DATA.
9. **Pas de module commun DES/CHAIN** pour la sparkline ni d'import statique du client :
   chunk préchargé par l'entrée.
10. **Pas de fusion à l'import de sauvegarde** : l'archive est exclue par préfixe (une ligne),
    cohérent avec la licence personnelle.
11. **Aucune série CryptoQuant hors des 13**, aucune métrique de valorisation, aucune
    substitution de BGeometrics.
12. Aucune nouvelle fenêtre, dépendance, hôte, modification de `@axiom/types` ou
    d'`EXCHANGE_IDS`.

## 9. Ordre de livraison

Un développeur par brief, fichiers disjoints, TDD, revue indépendante (sécurité des trois
proxys et calculs revus systématiquement), `pnpm check` avant chaque commit.

- **B1-0** — Amendement `BUILD-CONTRACT.md` (§7) et `docs/csp-vercel.md` ; rapport
  `docs/superpowers/progress/2026-09-16-cryptoquant.md` ouvert. Mesure du budget **avant**.
- **B1-1** — `shared/cryptoquant-proxy.ts` + `apps/daemon/src/cryptoquantProxy.test.ts`
  (module pur, livrable seul) ; `include` des deux `tsconfig`.
- **B1-2** — Trois proxys avec leurs tests (parallélisable en trois briefs disjoints) :
  Vercel (`api/_policy.ts`, `api/proxy.ts`, `vercel.json`, `vercelProxy*.test.ts`) ; daemon
  (`env.ts`, `proxy.ts`, `proxy.test.ts`, `env.test.ts`, `cache.test.ts`) ; Vite
  (`vite.config.ts`, `.env.example`, `viteConfig.test.ts`). Preuve : `pnpm -r typecheck`,
  `pnpm --filter @axiom/daemon test`, `pnpm --filter @axiom/web test`.
- **B1-3** — Socle client initial : `store/cryptoquant.ts` + test, `persist.ts` (credential +
  préfixe) + `persist.test.ts`, `SettingsPanel.tsx`. Mesure du budget intermédiaire.
- **B1-4** — Client pur puis orchestrateur : `data/onchain/cryptoquant.ts` + tests (I1–I8,
  I10) ; publication santé/quota.
- **B1-5** — Section DES : `fluxTakers.util.ts` + test, `FluxTakersSection.tsx` + test,
  insertion `DerivativesWindow.tsx` ; build et budget (I11) ; e2e `des-flux-takers` +
  `scripts/ci.sh` ; `pnpm check` et `scripts/ci.sh --e2e`.
- **Revue indépendante de B1** (fuite de clé, politique de route, fusion d'archive, budget),
  puis commit(s) B1 et preuve manuelle du propriétaire.
- **B2-1** — `onchain/MineursCotes.tsx` (vue pure + conteneur + qualité) + test, insertion
  `Mineurs.tsx` (children optionnel) ; build et budget (delta initial attendu 0).
- **B2-2** — e2e `chain-mineurs-cotes` + `ci.sh` ; revue indépendante de B2 (sommes
  d'affichage, `null` jamais 0, couverture partielle) ; commit B2.
- **Clôture** — rapport avec preuves réelles (sorties de tests, JSON du budget avant/après,
  curl du propriétaire, valeur de `x-ratelimit-reset`), mémoire projet mise à jour. Après un
  premier mois réel : relire le compteur observé et ajuster la reprise 6 h si l'heure de
  publication J-1 est connue (constante unique, test associé).

## 10. Limites et risques à ne pas masquer

- **Collecte dépendante de l'usage** : sans collecteur, une série ne s'archive que si sa fenêtre
  est ouverte ; > 30 jours sans ouverture = trous définitifs. Mitigation : déclenchement au
  montage de la fenêtre (pas au dépliage) et affichage explicite des jours perdus.
- **Heure de publication de J-1 inconnue** (vue disponible à 18:00 UTC) : la reprise 6 h peut
  retarder la collecte de J-1 jusqu'au lendemain sur un poste ouvert une seule fois le matin
  — trou récupérable (dans la fenêtre), pas perdu.
- **Sauvegarde JSON** : l'archive n'y est pas ; sur un poste sans daemon, vider le stockage du
  navigateur perd les jours au-delà de 30 j. L'écran l'annonce, il ne peut pas l'empêcher.
- **Multi-onglets** : lecture-fusion-écriture non atomique sur la même clé ; deux fenêtres DES
  simultanées peuvent s'écraser une passe (même contenu ou un jour d'écart, jamais une perte
  > 30 j puisque `limit=30`). Accepté.
- **Cadence par onglet** : deux onglets peuvent totaliser > 10/min → 429 puis reprise
  automatique avec `x-ratelimit-reset` relayé. Accepté.
- **Sémantique non documentée** : composition des places de `btc_all`/`eth_all`, champ
  `inverse` et unité de `base_volume` pour les swaps inverses, `report_accuracy`, remise à
  zéro de `accumulated_monthly_rewards`, `x-ratelimit-reset` (secondes observées, à confirmer
  sur la première vraie réponse en production). Affichées comme limites, jamais interprétées.
- **Rafale 13 > 10** quand CHAIN puis DES (ou l'inverse) s'ouvrent dans la même minute :
  3 séries attendent ≤ 60 s, affiché.
- **Noms usuels des neuf sociétés** en infobulle : connaissance générale, non issus du
  sondage ; le propriétaire peut demander de n'afficher que l'identifiant fournisseur.
- **Taille** : ≈ 2 Mo localStorage à 5 ans, premier poste de l'origine vers 3 ans, sous 5 Mo ;
  `kv_snapshots` ≈ 60 Mo SQLite à 5 ans.
- **Budget** : le store, `persist.ts` et le champ Réglages touchent le chemin d'entrée pour
  quelques dizaines d'octets gzip ; la mesure au build est la porte.

## 11. Décisions tranchées par défaut dans cette spec

Les points suivants ont été relevés par les juges comme relevant du propriétaire ; la spec
retient un défaut, à contester à la relecture :

| Point | Défaut retenu |
|---|---|
| « Chaque ouverture lit l'API » | Dans son esprit : court-circuit « J-1 archivé → zéro appel », reprise 6 h |
| Déclencheur | Montage de la fenêtre (continuité d'archive), sections repliées par défaut |
| Archive et sauvegarde JSON | Exclue par préfixe (ni exportée, ni remplacée à l'import) |
| Route `/cqapi` | Liste fermée (module partagé), `from`/`to` refusés, GET seul |
| En-têtes `x-ratelimit-*` | Relayés par les trois proxys (six lignes) |
| Mémoire des 401/403 | Session seulement ; pas de plafond mensuel bloquant |
| Badge Réglages `hasKey` | Clé personnelle seule (comme BGeometrics/CCData) |
| Nom de la clé localStorage | `axiom:cryptoquant:key` (patron CCData) |
| Fiabilité et santé | Badge local, libellé dans DATA seulement (bundle initial préservé) |
| Comparaison Binance | Hors lot |
| Noms des sociétés | Infobulle avec noms usuels |

## 12. Arbitrages de planification (2026-09-16)

Le plan `docs/superpowers/plans/2026-09-16-cryptoquant-takers-mineurs.md` a été rédigé zone par
zone contre le code réel, puis vérifié ; l'orchestrateur a tranché les points suivants, qui
précisent ou corrigent la spec :

| Point | Arbitrage |
|---|---|
| `situer` | Vit dans `components/fluxTakers.util.ts` (exporté), pas dans le client : la vue ne peut importer aucune valeur du client sans créer un chunk préchargé par l'entrée |
| `RAISON_CLE_CRYPTOQUANT`, `messageSansCleCq(vercel)` | Vivent dans `store/cryptoquant.ts` (module déjà partagé par Réglages, DES, CHAIN et le client) ; le client les ré-exporte |
| Budget | Le store devient un chunk partagé : delta initial attendu ≤ ~40 o gzip par sous-lot, porte ≤ ~150 o sur B1 ; seule la limite 360 000 est bloquante. Mesures consignées en sections `### Budget <étape>` avec le JSON complet |
| Qualité CHAIN | `ageMaxMs` = 3 j (précédent des séries quotidiennes de CHAIN ; `observeLe` à 00:00 UTC du jour clos) |
| Bouton Réglages | Affiché aussi pour une clé refusée (401) ; le complément `.env`/Vercel seulement pour la clé absente |
| Proxys locaux | « En-tête client s'il est valide, sinon `.env` » (Vite injecte aussi sur en-tête invalide) ; Vercel contrôle la méthode d'abord (POST sans clé → 405) |
| Archive de version inconnue | Statut `erreur`, zéro appel, rien réécrit, bandeau |
| File de requêtes | `enAttente` = demandes en attente d'un créneau ; `repriseTs` couvre le 429 et `x-ratelimit-remaining: 0` |
| Libellé DATA | `cryptoquant: "CryptoQuant"` dans `data/dataCockpit.ts` (module paresseux) |
| Signaux d'archive | Stockage plein, copie daemon non écrite, absence de daemon, archive illisible remplacée et badge périmé visibles dans les deux sections |
| Tri CHAIN | Interactif, état dans le conteneur, défaut BTC J-1 décroissant |
| Couverture CHAIN | Sociétés ayant une ligne au dernier jour archivé commun (« jour de référence », affiché J-n), et non strictement J-1 : avant la publication de J-1, un tableau strict n'afficherait que des « — » |
| Exécution | Tâches strictement séquentielles (les tâches 3, 4 et 5 partagent l'index git et l'état du typecheck) |
| Quota affiché | « x/10 min » dans DATA ; la section affiche « 10 req/min » (la file n'expose pas le compteur) |
| `BUILD-CONTRACT.md:50` | « sept exceptions ACTÉES » devient « des exceptions ACTÉES » |
| Errata | `NS_ONCHAIN` n'existe pas (constantes privées de `cache.ts`) ; `acquireSlot` est en `coinalyze.ts:106-132` ; `resteSurLePoste` en `persist.ts:791-793` ; le prédicat Bearer en `api/_policy.ts:276-284` |
