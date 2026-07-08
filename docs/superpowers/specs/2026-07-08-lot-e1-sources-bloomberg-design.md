# Lot E1 « Sources & fonctions Bloomberg » — Design

> **Spec validée · 2026-07-08.** Issue de la revue complète AXIOM du même jour (artifact
> `axiom-revue.html`) et des directives de Zaki en suivi : fix prioritaire du module ETF,
> puis les 5 points de la roadmap (hors clé FRED, traitée séparément), plus toute source
> gratuite supplémentaire jugée pertinente et vérifiée en réel.
> Cadre : **BUILD-CONTRACT.md** inchangé (mono-utilisateur, budget API 0 $/mois,
> aucune dépendance nouvelle, TS strict, commentaires en français).

## Objectif

Cinq chantiers indépendants qui comblent des trous identifiés par la revue :
1. Fix du module ETF (BTC/ETH/SOL) — actuellement mort (DefiLlama HS).
2. Nouveau panneau **FUND** (fiche société tradfi — fondamentaux/insider/earnings).
3. **CRVF** — vraie visualisation de courbe de taux (extension de RATE, pas une fenêtre séparée).
4. Enrichissement de **NEWS** (Finnhub général + GDELT ciblé + Fear&Greed en bandeau).
5. On-chain **ETH** dans la fenêtre CHAIN (gas + supply, via Etherscan v2).

**Hors scope de ce lot (documenté, pas codé) :**
- Clé FRED en dur (`fred.ts:52`) — traitée séparément, PAS ce lot.
- Unlocks de tokens (DropsTab) — accès sur candidature manuelle, aucune clé disponible
  aujourd'hui ; pas de code mort en attendant une clé qu'on n'a pas (YAGNI). À reprendre en
  lot ultérieur si Zaki obtient l'accès.
- On-chain **SOL** — **écarté après vérification en réel** (voir §5) : les deux RPC publics
  candidats (`api.mainnet-beta.solana.com`, `rpc.ankr.com/solana`) renvoient **403** en test
  direct (anti-abus IP datacenter/anonyme), donc pas une source fiable pour un usage
  personnel sans clé payante. Les flux ETF SOL (§1), eux, restent bien couverts par
  SoSoValue — l'écart ne concerne QUE l'on-chain SOL.

## Vérifications CORS/UA effectuées en réel (2026-07-08, curl direct)

| Hôte | CORS | Décision |
|---|---|---|
| `finnhub.io` | `access-control-allow-origin: *` | **Appel DIRECT** (comme Coin Metrics/mempool.space) |
| `api.etherscan.io` | `access-control-allow-origin: *` | **Appel DIRECT** |
| `openapi.sosovalue.com` | reflète l'Origin + preflight OK sur header `x-soso-api-key` | **Appel DIRECT** |
| `data.sec.gov` | `*` MAIS SEC exige un **User-Agent identifiant + contact** (politique d'accès équitable) — un `fetch()` navigateur ne peut PAS surcharger `User-Agent` (en-tête interdit par le navigateur, quel que soit CORS) | **Proxy `/extapi`** (UA conforme injecté côté serveur) |
| `www.sec.gov` | pas de CORS observé (403 sans UA conforme, 200 avec) | **Proxy `/extapi`** (même raison) |
| `api.gdeltproject.org` | non concluant (handshake TLS expiré depuis ce sandbox — probablement un blocage anti-bot IP datacenter, pas nécessairement représentatif d'un navigateur résidentiel) | **Proxy `/extapi`** par précaution (comme CFTC/CBOE, autres JSON de statut CORS incertain déjà dans le projet) |
| `api.mainnet-beta.solana.com`, `rpc.ankr.com/solana` | CORS ouvert MAIS **403 applicatif** sur la méthode RPC réelle (POST `getEpochInfo`) | **Source écartée** (voir hors scope ci-dessus) |

---

## 1. Fix ETF flows (BTC/ETH/SOL) — SoSoValue

### Constat

`api.llama.fi/overview/etfs` (utilisé aujourd'hui) renvoie 404/500 sur tous les endpoints
testés — mort. Recherche de remplacement : **SoSoValue** (`openapi.sosovalue.com`) couvre
BTC + ETH + **SOL** (ETF spot Solana actifs depuis leur approbation SEC d'octobre 2025 :
BSOL, GSOL, TSOL, SOEZ, QSOL, VSOL, SSK) avec un seul provider. Plan Demo/Beta gratuit :
20 req/min, inscription sans CB (`sosovalue.com/developer`), header `x-soso-api-key`.

⚠️ **Réserve documentée par la recherche** : le path exact de l'endpoint REST n'a pas pu
être lu en direct (doc gitbook inaccessible en fetch sandbox). **Le Task 1 du plan
COMMENCE donc par une étape de découverte manuelle** (Zaki s'inscrit, récupère une clé,
et l'implémenteur teste 2-3 chemins plausibles avant d'écrire le parseur) plutôt que de
coder en dur un chemin non vérifié.

### Décisions

- Remplace intégralement `data/onchain/etf.ts` : un seul module **paramétré par asset**
  (`"btc" | "eth" | "sol"`), même esprit que `coinmetrics.ts` (`fetchCoinMetrics(asset)`).
- Clé **obligatoire** (pas de repli sans clé chez SoSoValue) → nouveau store
  `soSoValueKeyStore` (pattern BGeometrics : clé optionnelle niveau code, mais message UI
  clair « configurez une clé gratuite » si absente, jamais de fetch sans clé).
- `OnchainWindow.tsx` : la section "Flux ETF spot BTC" devient un **sélecteur d'actif**
  (BTC/ETH/SOL, boutons façon onglets) au-dessus du même rendu par émetteur — pas de
  triplement de section, un seul composant paramétré.
- Cache local 6 h (`ETF_TTL_MS` existant conservé), dégradation gracieuse par actif
  indépendamment (un actif en échec n'empêche pas les 2 autres).

---

## 2. Panneau FUND (fiche société tradfi)

### Constat

Aucun module fondamentaux/insider/earnings n'existe. ⚠️ **Collision de mnémonique** :
`DES` est déjà pris par la fenêtre Produits dérivés (`WINDOW_REGISTRY`). Nouveau
mnémonique : **`FUND`**.

### Décisions

- Deux sources complémentaires, chacune un module dédié :
  - `data/fund/secEdgar.ts` — résolution ticker→CIK (`www.sec.gov/files/company_tickers.json`,
    proxié), puis `data.sec.gov/submissions/CIK##########.json` (profil + 4 derniers
    Form 4 insider) et `data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/<Concept>.json`
    pour 2-3 concepts XBRL simples (`Assets`, `Liabilities`, `NetIncomeLoss`) — pas un
    dépouillement XBRL complet (hors scope v1).
  - `data/fund/finnhub.ts` — `finnhub.io/api/v1/stock/profile2` (secteur/cap/description) et
    `finnhub.io/api/v1/calendar/earnings` (prochaines publications) — appel DIRECT (CORS
    confirmé), clé en query `token=`.
- Nouvelle fenêtre `FundWindow.tsx`, pattern `MacroRatesWindow` (onglets : Profil / Insider /
  Earnings), store UI vanilla dédié (`fundUiStore`), enregistrement dans `WINDOW_REGISTRY`
  (id `"fund"`, mnémonique `FUND`), câblage `App.tsx` + `Toolbar.tsx` (menu Fonctions).
- Recherche de société : champ texte → résout via `company_tickers.json` (chargé une fois,
  mis en cache 24 h, ~10k entrées, recherche client-side substring sur ticker+nom).
- Nouvelle clé requise : `finnhubKeyStore` (partagée avec la tâche NEWS — un seul store,
  un seul champ dans Réglages, deux consommateurs).

---

## 3. CRVF — vraie courbe de taux (extension de RATE, pas une nouvelle fenêtre)

### Constat

La donnée existe déjà et est déjà affichée : `treasuryYields.ts` + onglet "Rendements" de
`MacroRatesWindow`. Aujourd'hui : **tableau** de 5 maturités US (`MATURITES_US`) + 3 points
zone euro. Pas de vraie forme de courbe visualisée.

### Décision (choix produit délibéré)

**Pas de nouvelle fenêtre CRVF** — dupliquer une fenêtre pour la même donnée source
contredirait la simplicité (une info, un seul endroit). À la place :
- `MATURITES_US` élargi aux 14 maturités déjà PARSÉES par `treasuryYields.ts` (le
  fetch/parse couvre déjà tout, seul l'affichage était tronqué à 5).
- Nouveau composant `CourbeTaux` (canvas, pattern `Sparkline` d'`OnchainWindow` : axe X =
  maturité en années, axe Y = taux, deux séries US/zone euro superposées, couleurs
  thème). Toggle "Tableau / Courbe" dans l'onglet Rendements existant.
- Le mnémonique `CRVF` est ajouté à `commandes` de `MacroRatesWindow.tsx` comme **alias**
  de `RATE` qui ouvre directement sur l'onglet Rendements en vue courbe (pas un `id` de
  fenêtre séparé dans `WINDOW_REGISTRY` — une action de palette peut cibler un onglet).

---

## 4. NEWS enrichi

### Constat

`NEWS_FEEDS` est une liste RSS/Atom homogène (parseur XML pur). Finnhub et GDELT renvoient
du JSON — n'entrent pas tels quels dans ce parseur. Fear&Greed **existe déjà**
(`data/marketOverview.ts`, affiché dans `MarketMapWindow`) — pas une nouvelle source, juste
un réaffichage.

### Décisions

- `NewsFeed` gagne un champ `kind: "xml" | "finnhub" | "gdelt"` (défaut `"xml"` pour les 5
  flux existants, inchangés). `fetchFlux` se ramifie sur `kind` : `"finnhub"` appelle
  `finnhub.io/api/v1/news?category=general` (DIRECT, JSON→`NewsItem[]`) ; `"gdelt"` appelle
  la recherche **ciblée** décrite ci-dessous. Le reste de `news.ts` (fusion, dédup, cache,
  poll) est inchangé — DRY, un seul point d'entrée `fetchToutesLesNews`.
- **GDELT n'est PAS un 7ᵉ flux statique généraliste** (son intérêt réel est la recherche par
  mot-clé) : câblé sur le toggle "filtre symbole" déjà existant dans `NewsWindow.tsx` — quand
  actif, une requête GDELT `query=<mot-clé principal du symbole>` est ajoutée aux flux
  interrogés (ex. `bitcoin`, `ethereum`), pour trouver des articles absents des 5 RSS
  crypto-only. Dégrade silencieusement si l'hôte est bloqué (cf. réserve CORS §0).
- Bandeau Fear&Greed dans l'en-tête de `NewsWindow` : réutilise directement l'état déjà
  fetché ailleurs (pas de nouvel appel réseau) — nécessite d'exposer la dernière valeur F&G
  via un store partagé (déjà dans `marketOverview.ts` ou son store associé) plutôt que de la
  recopier.
- Nouvelle clé requise : `finnhubKeyStore` (même store que FUND, cf. §2).

---

## 5. On-chain ETH (Etherscan v2)

### Constat

`coinmetrics.ts` est déjà générique par `asset` mais la doc de tête précise que la Community
tier renvoie `null` pour la quasi-totalité des métriques ETH — donc une vraie section ETH
demande une source dédiée, pas un simple changement de paramètre.

### Décision (scope honnête)

Le tier gratuit Etherscan v2 ne couvre PAS d'équivalent "adresses actives/jour" ou "tx/jour
historique" (réservés au Pro). Scope v1 = ce qui est réellement gratuit et vérifié (200,
CORS ouvert) :
- `module=stats&action=ethsupply` — offre totale ETH (network metric statique).
- `module=gastracker&action=gasoracle` — gas recommandé (Safe/Propose/Fast), **équivalent
  direct** du widget "Frais recommandés" déjà affiché côté BTC (mempool.space) — parallélisme
  volontaire entre les deux sections.
- `module=stats&action=nodecount` — nombre de nœuds (indicateur réseau, comme le hashrate BTC).
- Nouveau module `data/onchain/etherscan.ts`, appel DIRECT (CORS confirmé `*`), clé requise
  en query `apikey=` → nouveau store `etherscanKeyStore` (pattern BGeometrics : optionnel
  niveau code mais Etherscan v2 exige une clé pour tout appel réel — message clair si absente).
- `OnchainWindow.tsx` gagne une section "Réseau ETH" (même widgets compacts que BTC),
  affichée uniquement si une clé Etherscan est configurée (sinon un lien vers Réglages,
  comme le pattern BGeometrics existant).

---

## Récapitulatif des nouvelles clés (Réglages)

| Clé | Obligatoire ? | Consommateurs |
|---|---|---|
| SoSoValue | Oui (pas de repli sans clé) | ETF flows (§1) |
| Finnhub | Oui | FUND (§2), NEWS (§4) |
| Etherscan v2 | Oui | On-chain ETH (§5) |

Aucune nouvelle clé pour SEC EDGAR (pas de clé du tout) ni GDELT (pas de clé du tout).

## Récapitulatif des whitelists `/extapi` à ajouter (3 fichiers, sync manuelle)

`data.sec.gov`, `www.sec.gov`, `api.gdeltproject.org` — PLUS un override de User-Agent
par hôte pour les deux hôtes SEC (cf. §0), mécanisme ajouté au proxy générique (petit,
chirurgical) plutôt qu'un proxy dédié séparé.

## Limitations v1 (assumées)

- Pas de dépouillement XBRL complet (FUND) — 2-3 concepts seulement.
- Pas d'attribution de portefeuille, pas de forwards FX, pas d'options actions US (déjà
  actés hors-scope par la revue du 2026-07-08, non révisés ici).
- On-chain SOL écarté (RPC publics bloqués en usage anonyme).
- Unlocks tokens reporté (accès DropsTab non obtenu).
