# AXIOM — Sources gratuites : macro souveraine (taux/or), COT, GEX/DEX (recensement)

> **Doc de recherche · 2026-07-03.** Complète `01-fournisseurs-api-indicateurs.md`. Cible : 5 nouveaux domaines demandés — rendements obligataires souverains, taux directeurs banques centrales, réserves d'or par pays, rapport COT (CFTC), GEX/DEX options (crypto + indices actions).
> Méthode : deep-research multi-agent (109 sous-agents, 26 sources primaires fetchées, 25 claims vérifiées par vote adversarial 3-voix) + vérification manuelle complémentaire en direct (`curl`) sur les 2 lacunes laissées par le batch principal (GEX/DEX, réserves d'or IMF).
> Chaque source ci-dessous a été testée **en direct** (requête HTTP réelle, pas seulement documentation lue) sauf mention contraire.

---

## 1. Rendements obligataires souverains

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Profondeur historique | Catch |
|---|---|---|---|---|---|---|---|
| **US Treasury Fiscal Data API** (`api.fiscaldata.treasury.gov`) | Courbe complète US (1Mo→30Y, dont 2Y/10Y/30Y) | **Aucune** (pas de clé) | Non documenté | JSON (XML/CSV via `format=`) | Quotidien | Longue (archives complètes) | Bot-block WAF (Myra Cloud) sur `home.treasury.gov` si User-Agent générique → **exiger un UA navigateur côté proxy** |
| **US Treasury Daily Par Yield Curve CSV** (`home.treasury.gov/.../daily-treasury-rates.csv`) | Alternative CSV directe, même données | Aucune | — | CSV | Quotidien | Par année (`/2026/all`) | Même bot-block que ci-dessus |
| **ECB Data Portal SDMX API** (`data-api.ecb.europa.eu`) | Courbe zone euro (composite/spot/forward/par par maturité résiduelle) — proxy Bund DE via zone euro | **Aucune** | Non documenté | CSV/JSON (SDMX) | Quotidienne, publiée à midi | Depuis le 6 sept. 2004 | Dataflow `YC`, pas de courbe DE isolée nativement (zone euro agrégée) |

**Reco AXIOM :** Treasury Fiscal Data API en source primaire (US 2Y/10Y/30Y), ECB SDMX `YC` en secondaire (zone euro / proxy Bund). Aucun compte à créer. JGB (Japon) et Gilt (UK) **non couverts** par ce batch — nécessitent une recherche dédiée si prioritaire (probable : Bank of Japan / UK DMO ont leurs propres portails, non testés ici).

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

- JGB (Japon) et Gilt (UK) non couverts pour les rendements souverains (hors scope du batch, non demandé explicitement en priorité 1).
- Futures BTC/CME dans les rapports COT non confirmés présents/absents.
- Deux claims BIS réfutées lors de la vérification adversariale (couverture 36 pays, fréquence "mensuel seulement") — traiter la couverture BIS comme **à confirmer**, pas acquise.
- L'endpoint CBOE n'est pas documenté officiellement — robustesse à long terme non garantie contractuellement (mais utilisé publiquement par des outils tiers connus).
