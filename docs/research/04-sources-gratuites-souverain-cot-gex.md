# AXIOM — Sources gratuites : macro souveraine (taux/or), COT, GEX/DEX (recensement)

> **Doc de recherche · 2026-07-03, complété le 2026-07-10.** Complète `01-fournisseurs-api-indicateurs.md`. Cible : 5 nouveaux domaines demandés — rendements obligataires souverains, taux directeurs banques centrales, réserves d'or par pays, rapport COT (CFTC), GEX/DEX options (crypto + indices actions).
> Méthode : deep-research multi-agent (109 sous-agents, 26 sources primaires fetchées, 25 claims vérifiées par vote adversarial 3-voix) + vérification manuelle complémentaire en direct (`curl`) sur les 2 lacunes laissées par le batch principal (GEX/DEX, réserves d'or IMF) + **complément du 2026-07-10** (section 1bis, `curl` direct) sur la lacune JGB/Gilt explicitement notée en section 1 : Japon, UK, Suisse, Australie, Canada, Chine, plus vérification de BIS/IMF/FRED comme agrégateurs multi-pays.
> Chaque source ci-dessous a été testée **en direct** (requête HTTP réelle, pas seulement documentation lue) sauf mention contraire.

---

## 1. Rendements obligataires souverains

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Profondeur historique | Catch |
|---|---|---|---|---|---|---|---|
| **US Treasury Fiscal Data API** (`api.fiscaldata.treasury.gov`) | Courbe complète US (1Mo→30Y, dont 2Y/10Y/30Y) | **Aucune** (pas de clé) | Non documenté | JSON (XML/CSV via `format=`) | Quotidien | Longue (archives complètes) | Bot-block WAF (Myra Cloud) sur `home.treasury.gov` si User-Agent générique → **exiger un UA navigateur côté proxy** |
| **US Treasury Daily Par Yield Curve CSV** (`home.treasury.gov/.../daily-treasury-rates.csv`) | Alternative CSV directe, même données | Aucune | — | CSV | Quotidien | Par année (`/2026/all`) | Même bot-block que ci-dessus |
| **ECB Data Portal SDMX API** (`data-api.ecb.europa.eu`) | Courbe zone euro (composite/spot/forward/par par maturité résiduelle) — proxy Bund DE via zone euro | **Aucune** | Non documenté | CSV/JSON (SDMX) | Quotidienne, publiée à midi | Depuis le 6 sept. 2004 | Dataflow `YC`, pas de courbe DE isolée nativement (zone euro agrégée) |

**Reco AXIOM :** Treasury Fiscal Data API en source primaire (US 2Y/10Y/30Y), ECB SDMX `YC` en secondaire (zone euro / proxy Bund). Aucun compte à créer. JGB (Japon) et Gilt (UK) couverts depuis la recherche complémentaire ci-dessous (section 1bis, 2026-07-10).

---

## 1bis. Rendements obligataires souverains — Japon, UK et autres pays (complément 2026-07-10)

> Complète la section 1 (limitée à US + zone euro). Mission : couvrir explicitement JGB (Japon) et Gilt (UK), plus évaluer d'autres pays (Suisse, Australie, Canada, Chine) et un éventuel agrégateur multi-pays unique (BIS ? OCDE via FRED ?). Méthode identique : chaque ligne testée **en direct** (`curl` réel, pas de la documentation lue), y compris les échecs (bot-block DMO, staleness SNB) qui sont eux-mêmes des résultats de vérification empirique.

| Pays | Source | Auth | Format | Fréquence | Catch |
|---|---|---|---|---|---|
| **Japon** | MOF `jgbcme.csv` (mois courant) + `historical/jgbcme_all.csv` (courbe complète depuis 1974) — `www.mof.go.jp/english/policy/jgbs/reference/interest_rate/` | **Aucune** (confirmé en direct, HTTP 200 stable sur 3 requêtes consécutives) | CSV (15 maturités : 1Y→10Y, 15/20/25/30/40Y) | Quotidienne, à jour (dernière ligne 2026-07-09 au moment du test) | Pas de CORS (proxy `/extapi` requis, nouvel hôte à whitelister) ; **ligne de pied de page en Shift-JIS parasite** (`"※If you cannot download..."`) dans une cellule non vide de la colonne Date → un parseur qui filtre seulement `date.length === 0` (pattern actuel de `parseTreasuryYieldCurveCsv`) **laisserait passer une ligne fantôme** ; filtrer plutôt sur "au moins une maturité numérique parsée" |
| **Royaume-Uni (DMO)** | `www.dmo.gov.uk/data/` | — | — | — | **BLOQUÉ.** Bot-manager Imperva/ShieldSquare avec challenge hCaptcha réel (`curl`, même avec UA navigateur et redirects suivis, reçoit une page "We apologize for the inconvenience... solve this CAPTCHA") — accès programmatique impossible sans navigateur + résolution CAPTCHA. Pas un simple souci d'UA comme Treasury US, un vrai mur. |
| **Royaume-Uni (BoE GLC)** | Bank of England, *Government Liability Curve* — ZIP `latest-yield-curve-data.zip` (mois courant) + `glcnominalddata.zip` (historique complet depuis 1979) sous `bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/` | **Aucune** (confirmé, HTTP 200, fichiers réellement téléchargés et ouverts) | **ZIP contenant des XLSX** (5 feuilles : info, forwards court terme, courbe forward, spot court terme, courbe spot) — PAS de CSV/JSON natif | Quotidienne à l'intérieur du classeur mensuel | Pas de CORS (proxy requis) ; **aucun parseur XLSX dans le repo** — tous les autres fournisseurs macro d'AXIOM parsent du CSV/JSON pur avec du code maison (`csv.ts`) ; ajouter le Gilt de cette façon introduit une dépendance nouvelle (type SheetJS) ou un dézippage+parsing côté daemon, pas une simple fonction pure de plus. Historique complet volumineux (~39 Mo zippés) |
| **Suisse (SNB)** | SNB Datenportal, cube `rendoblim` — `data.snb.ch/api/cube/rendoblim/data/json/en` | **Aucune** (confirmé, JSON propre reçu) | JSON | Mensuelle **en théorie** | Courbe complète 1/2/3/4/5/6/7/8/9/10/15/20/30 ans depuis 1988 — MAIS **dernière observation confirmée = 2025-07** (re-testé avec cache-busting, résultat identique) : la série semble à l'arrêt ou non maintenue, ~1 an de retard au 2026-07-10. **Ne pas utiliser comme source "actuelle"** en l'état — à re-tester périodiquement si retenue |
| **Suisse (fallback)** | FRED `IRLTLT01CHM156N` (voir ligne FRED ci-dessous) | Clé FRED existante | JSON | Mensuelle, à jour (mai 2026 au test) | Un seul point ~10 ans, pas une courbe — mais c'est la seule source suisse confirmée réellement à jour dans cette recherche |
| **Australie** | RBA, table F2 *Capital Market Yields – Government Bonds* — `rba.gov.au/statistics/tables/csv/f2-data.csv` | **Aucune** (confirmé) | CSV | Quotidienne, à jour (dernière ligne 2026-07-08 au test) | Pas de CORS (proxy requis, nouvel hôte) ; CSV propre, colonnes 2/3/5/10 ans + obligation indexée 10 ans, historique depuis mai 2013 (~3 335 lignes). **MÀJ empirique 2026-07-11 : 403 en conditions réelles du repo.** L'edge Akamai de `www.rba.gov.au` renvoie 403 (fingerprint TLS/client) à travers LES DEUX chemins proxy effectifs du repo — proxy Vite dev (http-proxy/node) ET daemon Bun ; seul `undici` passe, qu'aucun chemin n'utilise (le `curl` du 2026-07-10 ci-contre passait, pas les clients du repo). Source **maintenue au catalogue et intégrée avec dégradation visible** (chargeur conservé, colonne Australie vide + note « Indisponible » dans RATE) : si l'edge Akamai change ou si le réseau diffère, la colonne se remplit toute seule |
| **Canada** | Bank of Canada, Valet API — `bankofcanada.ca/valet/observations/BD.CDN.{2,3,5,7,10}YR.DQ.YLD/json` | **Aucune** | JSON | Quotidienne, à jour (dernière observation 2026-07-09 au test) | **Aucun** — et surtout : **`Access-Control-Allow-Origin: *` confirmé en direct** → seule source de tout ce document (US Treasury, ECB, BIS, IMF, CFTC, CBOE inclus) qui répond avec un en-tête CORS ouvert. Fetch direct navigateur possible, **sans passer par `/extapi`**. 30 ans absent sous ce nommage de série (2/3/5/7/10 ans seulement) |
| **Chine** | — | — | — | — | **Aucune source gratuite/no-auth/anglophone identifiée.** `chinabond.com.cn` renvoie une redirection (302, portail chinois non exploré en profondeur), `chinamoney.com.cn/english` est une simple vitrine sans API de données. FRED, BIS et IMF interrogés explicitement pour la Chine — voir lignes dédiées ci-dessous, tous négatifs ou non concluants |
| **Multi-pays (déjà exploitable)** | **FRED, série `IRLTLT01{XX}M156N`** (OCDE, "Long-term government bond yields, 10-year") via `api.stlouisfed.org/fred/series/observations` — **déjà intégré** dans `apps/web/src/data/macro/fred.ts` (`createFredM2Provider` générique, accepte n'importe quel `series_id`) | Clé FRED **déjà en `.env`** (aucune nouvelle clé) | JSON | Mensuelle, retard ~2 mois (dernier point mai 2026 au test du 2026-07-10) | Confirmé en direct pour **USA, Japon, UK, Suisse, Australie, Canada, Allemagne** (codes `US/JP/GB/CH/AU/CA/DE`) — tous répondent avec des données réelles sur la même clé/le même endpoint déjà câblé. **Chine absente** (`IRLTLT01CNM156N` → "series does not exist", confirmé). Limite structurelle : **un seul point de maturité par pays** (~10 ans), pas une courbe — ne remplace pas les courbes complètes JP/US/zone euro/AU |

**Vérifications négatives (à ne pas retenter sans nouvelle piste) :**
- **BIS comme agrégateur multi-pays de rendements obligataires : réfuté empiriquement.** Catalogue complet des 29 dataflows BIS (`stats.bis.org/api/v1/dataflow/BIS/all/latest`) inspecté en direct : seul `WS_CBPOL` (taux directeurs, déjà documenté section 2) touche aux taux d'intérêt. Aucun dataflow "yield"/"bond"/"long-term rate" n'existe côté BIS — à retirer définitivement de toute hypothèse "BIS fait aussi les rendements souverains".
- **IMF SDMX 3.0, dataflow `MFS_IR`** (Monetary and Financial Statistics, Interest Rates) : existe réellement, et son codelist `CL_MFS_IR_INDICATOR` contient bien des indicateurs pertinents (`S13BONDS_RT_PT_A_PT` = "Government bonds yields", `S13BONDSML_RT_PT_A_PT` = moyen/long terme), et son codelist pays (`CL_MFS_COUNTRY`) contient `CHN`. **Piste prometteuse pour la Chine et un agrégateur IMF unique** — mais la requête `data/dataflow/IMF.STA/MFS_IR/9.0.0/{COUNTRY}.{INDICATOR}.{FREQ}` renvoie une structure JSON valide (HTTP 200) **sans aucune observation**, y compris pour les États-Unis en test de contrôle. Clé de requête probablement mal formée (ordre de dimensions, code fréquence, ou version de dataflow) plutôt qu'absence réelle de données — **non résolu dans cette passe**, comme le code indicateur IRFCL de la section 3 en son temps. À reprendre dans un ticket dédié si la Chine devient prioritaire.

**Reco AXIOM (tranchée) :**
- **Ajoutables à coût zéro, maintenant, même pattern que l'existant (CSV/JSON + proxy `/extapi`) :**
  - **Japon** — MOF `jgbcme.csv` : la meilleure des 3 nouvelles sources (courbe complète 15 maturités, quotidienne, historique dense depuis 1974). 1 hôte à whitelister (`www.mof.go.jp`), parsing quasi identique à `parseTreasuryYieldCurveCsv` (mêmes 3 fichiers à synchroniser : `extapi.ts` / `vite.config.ts` / `proxy.ts`), **avec la garde anti-ligne-fantôme Shift-JIS mentionnée plus haut**.
  - **Canada** — BoC Valet API : la source la PLUS simple de tout ce document (CORS natif → zéro entrée de proxy, juste un `fetch()` direct). Courbe partielle (2/3/5/7/10 ans) mais quotidienne et propre.
  - **Australie** — RBA F2 CSV : courbe partielle (2/3/5/10 ans + indexée), quotidienne, 1 hôte à whitelister (`www.rba.gov.au`).
  - Ces trois pays sont ajoutables à `CourbeTaux.tsx` sans nouvelle dépendance de parsing : le composant est aujourd'hui câblé pour exactement 2 séries (`us`, `euro` en props figées) mais **6 tokens `--serie-N` existent déjà par thème** (`index.css`) — le passer à un tableau générique de séries nommées est un refactor borné, pas un blocage de design.
- **Ajoutable en complément séparé, pas en remplacement de courbe :** FRED `IRLTLT01{XX}M156N` élargit instantanément la couverture pays (US/JP/GB/CH/AU/CA/DE...) sur l'infrastructure FRED **déjà branchée**, zéro nouvel hôte/clé — mais un seul point ~10 ans par pays, mensuel avec ~2 mois de retard. Utile pour un futur panneau "comparateur de taux longs multi-pays" (un point par pays), pas pour nourrir une courbe par maturité comme `CourbeTaux` le fait aujourd'hui.
- **UK (Gilt) : PAS ajoutable à coût zéro au même sens que Japon/Canada/Australie.** DMO est bloqué net (bot-manager + CAPTCHA, aucun contournement raisonnable côté fetch serveur). BoE GLC est gratuit et réel mais livré en ZIP d'XLSX — premier fournisseur macro d'AXIOM qui ne serait pas du CSV/JSON pur, donc un vrai chantier (dépendance de parsing XLSX ou conversion côté daemon), pas une extension au fil de l'eau. **Solution d'attente à coût zéro : FRED `IRLTLT01GBM156N` seul** (1 point 10 ans mensuel) si une couverture UK partielle suffit en attendant un chantier XLSX dédié.
- **Suisse : same conclusion pattern.** Le natif SNB existe et est gratuit mais confirmé **à l'arrêt depuis mi-2025** — ne pas l'utiliser tel quel sans re-vérification. Seul `IRLTLT01CHM156N` (FRED) est confirmé à jour ; à traiter comme la Suisse "GB" ci-dessus (point unique, en attendant mieux).
- **Chine : non ajoutable à coût zéro avec les moyens vérifiés ici.** Aucune des 3 pistes (FRED, BIS, IMF) ne livre de donnée exploitable dans cette passe ; l'IMF `MFS_IR` reste la piste la plus prometteuse mais nécessite une résolution de requête dédiée avant tout ticket d'implémentation.

---

## 2. Taux directeurs banques centrales

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Profondeur | Catch |
|---|---|---|---|---|---|---|---|
| **BIS SDMX API** — dataflow `WS_CBPOL` (`stats.bis.org` v1, `data.bis.org` v2) | Multi-banques centrales en un seul dataflow (Fed confirmé en direct ; **couverture exacte BOJ/BOE/SNB/PBOC NON confirmée** — claim réfutée 0-3 dans le batch) | **Aucune** (réponse taggée `Receiver id="guest"`) | Rate-limit anti-abus IP, non chiffré | CSV/SDMX-JSON | **Quotidien ET mensuel confirmés** (claim "mensuel seulement" réfutée 1-2) | Depuis les années 1990 (Fed) | ⚠️ Couverture pays/fréquence par pays **à vérifier empiriquement avant d'implémenter** (query `D.JP`, `D.GB`, `D.CH`) |
| **ECB SDMX API** — dataflow `FM`/`KR` | Taux de refinancement principal ECB | Aucune | — | CSV/JSON | Confirmé en direct (2.4% au 2026-06-30) | — | Dataflow spécifique ECB seulement (pas multi-banques) |

**Reco AXIOM :** BIS `WS_CBPOL` comme source unique visée (multi-banques, zéro clé) — mais **premier ticket d'implémentation doit inclure une passe de vérification empirique** des codes pays réellement présents (BOJ=JP, BOE=GB, SNB=CH, PBOC=CN) avant de promettre la couverture large annoncée par le marketing BIS. ECB `FM`/`KR` en fallback pour la BCE spécifiquement.

---

## 3. Réserves d'or par pays

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Profondeur | Catch |
|---|---|---|---|---|---|---|---|
| **World Gold Council (Goldhub)** | Référence historique de facto (tonnes, $, % réserves) | **Compte gratuit requis** pour filtrage/export/comparaison | — | Excel/PDF statiques (4 liens) | Trimestrielle | Depuis 2000 (fichier "Quarterly time series") | **Pas d'API** — fichiers statiques seulement ; login gate sur le dashboard interactif |
| **IMF SDMX 3.0 API** (`api.imf.org/external/sdmx/3.0`), dataflow `IMF.STA:IRFCL` (v12.0.0) | Réserves internationales incl. or (donnée source de WGC) | **Aucune — confirmé en direct** (structure ET requête data réelles en HTTP 200, zéro 401/403) | Non documenté | SDMX-JSON | Variable selon pays (mensuel probable) | Non testé (nécessite mapping indicateur/pays exact) | Dimensions confirmées : `COUNTRY.INDICATOR.SECTOR.FREQUENCY` — **code indicateur exact "or" à identifier** (probable `RAFA_USD`/similaire dans le codelist IRFCL, non résolu ici) avant implémentation |

**Reco AXIOM :** **IMF SDMX 3.0 / dataflow IRFCL** — c'est la vraie source primaire derrière WGC, et elle répond sans authentification (vérifié par `curl` direct : `dataflow` structure ET requête `data` avec clé partielle renvoient HTTP 200, pas de mur d'auth). Ceci **contredit/complète** la conclusion "medium confidence" du batch de recherche principal — le chemin non authentifié fonctionne réellement. Premier ticket d'implémentation : résoudre le code indicateur exact pour "or, valorisation nationale" dans le codelist `IRFCL` (`api.imf.org/external/sdmx/3.0/structure/codelist/IMF.STA/CL_INDICATOR_IRFCL`), pas de compte à créer.

---

## 4. Rapport COT (CFTC)

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Profondeur | Catch |
|---|---|---|---|---|---|---|---|
| **CFTC Public Reporting (Socrata SODA API)** (`publicreporting.cftc.gov/resource/{dataset-id}.json`) | **7 catégories** : Legacy F/O + Combined, Disaggregated F/O + Combined, TFF (Traders in Financial Futures) F/O + Combined, Supplemental-CIT | **Aucune** (app token Socrata optionnel = juste un tier de débit plus élevé, pas obligatoire) | Tier anonyme plus bas mais fonctionnel (confirmé en direct : `curl .../6dca-aqww.json?$limit=2` → 200 JSON) | JSON (SODA REST standard) | Hebdomadaire (publication vendredi) | Longue (archives complètes par dataset) | Aucun — API officielle propre, pas de scraping PDF |

**Reco AXIOM :** Socrata SODA API directement — c'est le meilleur résultat de toute la recherche (zéro friction). Dataset `6dca-aqww` (Legacy Futures Only) couvre indices/devises/commodités classiques ; TFF (`98ig-3k9y` — story page, ID dataset exact à confirmer) pour la ventilation "Dealer/Asset Manager/Leveraged Money/Other" plus fine sur indices financiers. **Pas de futures BTC/CME confirmés dans ce batch** — à vérifier si prioritaire (le dataset TFF ou Disaggregated pourrait les inclure sous une catégorie "digital asset" récente, non testé).

---

## 5. GEX/DEX — Crypto (BTC/ETH)

| Source | Ce qu'elle apporte | Auth | Catch |
|---|---|---|---|
| **Deribit `get_book_summary_by_currency` (déjà intégré dans `deribit.ts`)** | Par instrument : `mark_iv`, `open_interest`, `underlying_price`, `interest_rate` — **tous les inputs Black-Scholes** sauf le strike/type/échéance (déjà extraits par `parseOptionInstrument`, fonction pure existante) | Aucune (déjà branché) | **Ne renvoie PAS delta/gamma directement** — mais comme spot/strike/échéance/IV/taux sont déjà tous présents dans le MÊME appel agrégé déjà utilisé pour le smile OMON, delta/gamma se calculent **côté client par une formule Black-Scholes pure** (nouvelle fonction testable, zéro appel réseau supplémentaire) |
| Alternative : Deribit `public/ticker` (par instrument, contient `greeks{delta,gamma,vega,theta,rho}` déjà calculés serveur-side) | Évite de coder Black-Scholes soi-même | Aucune | **1 appel par instrument** (pas d'agrégat) — avec ~5 req/s de débit doux existant, viable seulement si on limite aux strikes proches de la monnaie, pas la chaîne complète |

**Reco AXIOM :** **Calcul Black-Scholes client-side sur les données déjà fetchées** (`get_book_summary_by_currency`, zéro nouvel appel réseau) plutôt que `public/ticker` par instrument. C'est la meilleure option des deux : aucune dépendance réseau supplémentaire, aucune nouvelle clé, and le module `deribit.ts` a déjà tout le nécessaire (spot, strike via parsing, échéance via parsing, `mark_iv`, `interest_rate`). GEX = Σ(gamma × OI × spot² × 0.01 × multiplicateur signe call/put) par strike ; DEX = Σ(delta × OI × spot) par strike — formules standard, à tester unitairement comme `computeMaxPain`/`putCallRatioOi` existants.

---

## 6. GEX/DEX — Indices actions (SPX/NDX/VIX)

| Source | Ce qu'elle apporte | Auth | Catch |
|---|---|---|---|
| **CBOE delayed quotes JSON** (`cdn.cboe.com/api/global/delayed_quotes/options/_{TICKER}.json`, ex. `_SPX.json`, `_NDX.json`, `_VIX.json`) | **Chaîne d'options complète avec greeks PRÉ-CALCULÉS** (`delta`, `gamma`, `vega`, `theta`, `rho`), `open_interest`, `iv`, bid/ask, plus `current_price` (spot) — testé en direct : SPX = 29 322 options, gamma non-nul confirmé sur strikes proches de la monnaie | **Aucune** (confirmé : `curl` sans header renvoie HTTP 200) | **Données différées** (CBOE "delayed quotes" — généralement ~15 min, non confirmé exactement) — acceptable pour un overlay GEX (pas du trading haute fréquence) ; endpoint non documenté officiellement (trouvé via recherche communautaire + confirmé en direct par nous, pas de doc CBOE officielle citée) → **zone grise ToS à surveiller**, mais chemin identique à celui utilisé publiquement par le repo de référence `jensolson/SPX-Gamma-Exposure` (implémentation open-source de calcul GEX SPX à partir de cette même source) |

**Reco AXIOM :** **`cdn.cboe.com` en direct** — c'est en réalité **meilleur** que la source crypto : greeks déjà calculés (pas de Black-Scholes à coder), OI, spot, tout dans un seul appel JSON, confirmé fonctionnel pour SPX/NDX/VIX. Ce chemin n'avait **pas été trouvé/retenu** par le premier passage de recherche automatisé (budget de vérification épuisé sur les 4 autres domaines) — confirmé par vérification manuelle complémentaire le 2026-07-03. Point d'attention : endpoint non documenté officiellement par CBOE (trouvé via un repo GitHub tiers) → traiter comme un **enrichissement, pas une garantie contractuelle** ; prévoir dégradation gracieuse si le format change.

---

## Synthèse — quelle source intégrer en premier par domaine

| Domaine | Source à intégrer en premier | Compte à créer ? |
|---|---|---|
| 1. Rendements souverains | US Treasury Fiscal Data API | Non |
| 2. Taux directeurs | BIS `WS_CBPOL` (+ vérif empirique couverture pays) | Non |
| 3. Réserves d'or | IMF SDMX 3.0 `IRFCL` (+ résolution code indicateur) | Non |
| 4. Rapport COT | CFTC Socrata SODA API | Non |
| 5. GEX/DEX crypto | Deribit (déjà branché) + Black-Scholes client-side | Non |
| 6. GEX/DEX indices actions | `cdn.cboe.com` delayed quotes JSON | Non |

**Aucun des 6 domaines ne nécessite la création d'un compte ou d'une clé API** — résultat notable par rapport à l'hypothèse de départ. Deux réserves à lever en implémentation (pas des blocages, des inconnues mineures) : (a) code indicateur exact "or" dans le codelist IMF IRFCL, (b) couverture pays exacte du dataflow BIS `WS_CBPOL` au-delà du Fed (à vérifier par requête directe `D.JP`/`D.GB`/`D.CH` avant de promettre BOJ/BOE/SNB à l'utilisateur).

---

## Limites de cette recherche

- JGB (Japon) et Gilt (UK) couverts par le complément du 2026-07-10 (section 1bis) : Japon résolu proprement (MOF CSV) ; UK **non résolu à coût zéro** (DMO bloqué par bot-manager+CAPTCHA, BoE livré en ZIP d'XLSX — chantier de parsing séparé, pas une extension gratuite immédiate).
- Chine (rendements souverains) : aucune source gratuite/no-auth exploitable trouvée dans cette recherche (FRED, BIS, IMF MFS_IR tous négatifs ou non concluants en l'état — voir section 1bis) — à reprendre en dédié si prioritaire.
- Futures BTC/CME dans les rapports COT non confirmés présents/absents.
- Deux claims BIS réfutées lors de la vérification adversariale (couverture 36 pays, fréquence "mensuel seulement") — traiter la couverture BIS comme **à confirmer**, pas acquise.
- L'endpoint CBOE n'est pas documenté officiellement — robustesse à long terme non garantie contractuellement (mais utilisé publiquement par des outils tiers connus).
