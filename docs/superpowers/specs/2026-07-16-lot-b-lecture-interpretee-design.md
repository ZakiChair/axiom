# Lot B — Lecture interprétée — design

Date : 2026-07-16. Base : revue UI v2 (`docs/superpowers/audits/2026-07-16-revue-ui-v2.md`,
findings H16-H19 + lentille hiérarchie/synthèse) et fiches features XSTAT/REGIME/BRIEF+.
Prérequis : Lot A mergé (tokens alpha, primitives ui.tsx, garde-fous).

## 1. Problème

Le terminal affiche des valeurs sans référentiel : un funding de +0.01 % se lit comme un
+0.08 % extrême, MVRV-Z/SOPR/NUPL sont des décimales nues, $8M/h de liquidations n'a pas de
baseline, et le BRIEF — fenêtre de synthèse — n'a pas de synthèse. Chaque fenêtre expose ses
chiffres ; personne ne compose le signal.

**Décisions de cadrage (validées)** :
- Référentiels alimentés par les **APIs publiques d'historique à la demande** (cache TTL) —
  aucun chantier daemon (le daemon n'historise que liquidations 30 j + bougies, cf. carte
  données ; les APIs publiques donnent plus de profondeur dès le jour 1).
- Percentiles affichés avec leur **profondeur réelle** (« p97 · 12 j ») ; sous ~5 j de
  données → « réf. en construction ».
- REGIME : **pastille permanente** dans SessionStrip + détail en tête du BRIEF (clic → BRIEF).
- Les 2 reliquats chart du Lot A (menu Indicateurs, empilement footprint×heatmap) sont inclus.

## 2. B1 — Fondations : référentiels purs + historiques à la demande

### `apps/web/src/lib/referentiel.ts` (pur, testé)
- `export interface PointSerie { t: number; v: number }` (t = ms epoch).
- `export interface Referentiel { percentile: number; profondeurJours: number; n: number }`.
- `rangPercentile(valeurs: readonly number[], valeur: number): number` — rang percentile
  0..100 (part des valeurs ≤ valeur, ties inclus, n ≥ 2).
- `referentiel(serie: readonly PointSerie[], valeur: number, now: number): Referentiel | null` —
  null si `serie.length < 2` ou profondeur < `PROFONDEUR_MIN_JOURS = 5`.
- `texteRef(ref: Referentiel): string` — « p97 · 12 j » (percentile arrondi, profondeur
  arrondie au jour).
- `estExtreme(ref): boolean` — percentile ≥ 90 ou ≤ 10.

### `apps/web/src/data/referentiels.ts` (fetchers + caches TTL 1 h)
Chaque fetcher renvoie `PointSerie[] | null` (échec → null, jamais bloquant), cache
module-level `Map<clé, {t, data}>` avec `TTL_MS = 3_600_000` :
- `histFunding(symbol)` — `GET /extapi/fapi.binance.com/fapi/v1/fundingRate?symbol=&limit=270`
  (~90 j à 8 h par règlement) ; v = fundingRate (fraction). fapi est déjà whitelisté
  (précédent `fundingCrossExchange.ts` via /extapi).
- `histDeltaOi(symbol)` — réutilise `fetchOpenInterestHist(symbol, "1h", 500)`
  (`data/binanceFutures.ts:259`, ~20 j) ; v = variation % heure-à-heure de `oiUsd`
  (la série des Δ 1 h ; le ΔOI 24 h courant se compare aux Δ 24 h glissants recalculés
  par une pure `deltasFenetre(points, fenetreMs)`).
- `histDvol(devise)` — réutilise `fetchDvolHistory(devise, 90)` (`data/deribit.ts:320`).
- `histFearGreed()` — `https://api.alternative.me/fng/?limit=90` (via /extapi si l'hôte
  n'est pas déjà whitelisté — l'ajouter à `shared/extapi-hosts.ts` sinon) ; v = value.
- `histLiqParHeure(symbol)` — daemon `liquidationsGet(symbol, {depuis: now-30j})`
  (`data/daemon.ts:488`) agrégé par une pure `bucketsHoraires(events)` → v = USD/heure.
  Null si daemon absent (capability `liquidations`).

### `apps/web/src/components/ui.tsx` — primitive `RefBadge`
`<RefBadge ref={Referentiel | null} sens?: "hausse-chaud" | "hausse-froid" />` :
- `ref === null` → badge neutre « réf. en construction » (title explicatif).
- Sinon Badge « p97 · 90 j », ton `warn` si `estExtreme`, neutre sinon ; `title` détaillé
  (« 97e percentile sur 90 j de données (270 points) »).

## 3. B2 — REGIME : score composite + pastille

### `apps/web/src/data/regime.ts` (pur, testé)
- `export interface ComposantRegime { id: string; libelle: string; note: number | null; detail: string }`
  (note ∈ −2..+2, null = indisponible/exclu).
- `export interface Regime { score: number; libelle: LibelleRegime; composants: ComposantRegime[] }`
  — `score` = moyenne des notes non-null ; si < 3 composants disponibles → libellé
  « indéterminé » (pastille grise).
- `calculerRegime(entrees: EntreesRegime): Regime` — pur, toutes les entrées optionnelles :
  1. `directionBtc24hPct` (source : `priceChangePercent` du ticker 24 h Binance, même
     endpoint que `fetchWatchlistOvernight`) : ≥ +3 % → +2 ; +1..3 → +1 ; −1..+1 → 0 ;
     −3..−1 → −1 ; ≤ −3 % → −2.
  2. `fearGreed` : ≥ 75 → +2 ; 60..74 → +1 ; 40..59 → 0 ; 25..39 → −1 ; < 25 → −2.
  3. `fundingBtcPercentile` (90 j) : p10..p90 → 0 ; > p90 → −1 (positionnement long tendu) ;
     < p10 → +1 (reset/short crowding, contrarien léger).
  4. `dvolBtcPercentile` (90 j) : < p50 → +1 (vol calme) ; p50..p85 → 0 ; > p85 → −2 (stress).
  5. `fluxEtfJourUsd` (total BTC+ETH+SOL de la veille) : > +50 M$ → +1 ; −50..+50 → 0 ;
     < −50 M$ → −1.
  6. `impressionStablecoins7jPct` (Δ supply 7 j en % de la supply) : > +0.5 % → +1 ;
     −0.5..+0.5 → 0 ; < −0.5 % → −1.
- `LibelleRegime` par score : ≥ +1.2 « risk-on tendu » · +0.4..1.2 « risk-on » ·
  −0.4..+0.4 « neutre » · −1.2..−0.4 « risk-off » · ≤ −1.2 « risk-off marqué ».
- Ton pastille : risk-on* → up ; neutre/indéterminé → neutre ; risk-off* → down ;
  « tendu » garde up mais le détail liste le composant funding en warn.

### `apps/web/src/store/regime.ts` (store vanilla + rafraîchissement)
- État `{ regime: Regime | null; majTs: number | null }` ; `rafraichir()` assemble les
  entrées via `data/referentiels.ts` + fetchers existants (`fetchFearGreed`,
  `fetchEtfFlows` du brief, supply stablecoins via le fetcher STBL existant), calcule,
  set. Appelé : au boot (après daemonPret best-effort), puis `setInterval` 15 min
  (léger : tout est sous cache TTL 1 h, seules les valeurs « courantes » se re-fetchent).
- Dégradation : chaque entrée en échec → composant note null.

### Pastille SessionStrip
4ᵉ groupe (pattern du groupe Santé, `SessionStrip.tsx:154-165`) : séparateur `|` +
`◆ RISK-ON +0.8` (pastille colorée + libellé + score signé 1 déc.), `title` = composants
(« F&G 72 (+1) · funding p93 (−1) · … »), clic → `basculer("brief")` (pattern P&L jour).
Indéterminé → « ◆ RÉGIME — » gris. Abonnement au store regime (basse fréquence).

## 4. B3 — BRIEF : chapeau interprété (H16)

En tête du corps (`BriefWindow.tsx:305`, avant la section Session) :
- Rangée de 4 `Metric` : **Régime** (libellé + score, couleur du ton), **Nuit**
  (BTC `formatPct` + ETH en second), **Funding BTC** (`formatFunding` + `RefBadge` en
  labelExtra), **Vol** (DVOL BTC courant + Δ vs veille en points — les 2 derniers points
  de `histDvol("BTC")` —, coloré par signe du Δ).
- Ligne de lecture générée : `data/lecturesBrief.ts` (pur, testé) —
  `lectures(entrees): string[]` produit 1 à 3 phrases factuelles à partir de règles à
  seuils (mêmes entrées que REGIME + ΔOI) ; ex. « Nuit baissière (BTC −2.1 %), funding
  neutre (p48), vol en hausse (p81). », « Funding p95 avec ΔOI +6 % : positionnement long
  tendu. ». Jamais prescriptif (pas de « acheter/vendre »). Affichée sous le bandeau en
  `text-[12px] text-text`.
- Le chapeau est intégré à `briefEnMarkdown` (section « Lecture » en tête de l'export).
- Chargement : le chapeau utilise le store regime (déjà rafraîchi) + les données des
  sections existantes ; section en échec → tuile « — » (pattern des sections).

## 5. B4 — Fenêtres : le chiffre devient lecture

- **DerivativesWindow (H18)** : sous la Metric Funding, ligne
  `APR {formatPct(annualiserFunding(rate, 8), 2)} · <RefBadge>` — référentiel
  `histFunding(symbol)` ; conserve couleur par signe sur le taux, l'extrême vit dans le
  badge. (Convention APR : réutiliser `annualiserFunding` de `fundingCrossExchange.ts:34`
  — l'exporter si privé.)
- **OnchainWindow (H17)** : les Widget MVRV-Z / SOPR / NUPL gagnent un badge de zone
  (nouvelle pure `lib/zonesOnchain.ts`, testée) :
  - MVRV-Z : < 0 « froid » (up) · 0..3 « neutre » · 3..7 « chaud » (warn) · ≥ 7
    « surchauffe » (down).
  - SOPR : < 1 « capitulation » (down) · ≥ 1 « profit » (neutre).
  - NUPL : < 0 « capitulation » (down) · 0..0.25 « espoir » · 0.25..0.5 « optimisme » ·
    0.5..0.75 « croyance » (warn) · ≥ 0.75 « euphorie » (down).
  Seuils documentés dans la NoteSource du bloc. Le `Widget` local gagne un slot badge
  (ou réutilise `labelExtra` du pattern Metric).
- **LiquidationsWindow (baseline)** : onglet Live, sous les totaux : ligne
  « 1 h : {formatUsd} · <RefBadge> » — référentiel `histLiqParHeure(symbol)` (30 j daemon),
  valeur comparée = total USD de la dernière heure. Daemon absent → rien (pas de badge).
- **ScreenerWindow (extrêmes, cross-sectionnel)** : pure `lib/extremesColonne.ts`
  (`seuilDecile(valeurs, 0.9)`) ; les cellules |funding| et |ΔOI| au-delà du 9ᵉ décile de
  la colonne passent en `text-warn font-semibold` ; légende pied de table :
  « en orange : 10 % les plus extrêmes de l'univers affiché ».
- **VolWindow (hiérarchie)** : la ligne 11px de l'en-tête (actions) devient une rangée de
  4 `Metric` en tête du corps (RV30 `formatPourcentage`, DVOL, VRP « pts » coloré par
  signe, z-score RV) ; l'en-tête garde titre/sous-titre seulement.
- **FundingMatrixWindow** : au-dessus de la table, `Metric label="Écart CEX/DEX (APR)"`
  coloré `warn` si ≥ 10 points d'APR (seuil documenté en NoteSource) ; dans la table, la
  venue APR max et min reçoivent un point `●` de repère.
- **StablecoinsWindow** : en tête de la Vue d'ensemble, bandeau d'état des pegs
  (réutilise `ecartPegBps`/`etatPeg` de `stablecoinsWindow.util.ts`) : tous stables →
  ligne discrète « Pegs : N stables » ; sinon badges « tension USDX −38 bps » /
  « depeg USDY −212 bps » (ton warn/down), clic → onglet Pegs.

## 6. B5 — Reliquats chart (du Lot A §10)

- **IndicatorMenu** : `autoFocus` (ref + focus à l'ouverture) sur le champ recherche ;
  navigation clavier ↑/↓ (focus roving sur les boutons d'ajout via `indexRoving` de
  ui.tsx), ⏎ = ajouter l'indicateur focalisé, Échap = fermer le menu.
- **Empilement footprint × heatmap liq** : quand `orderflowStore.enabled` ET
  `liqMarksStore.actif` (slot focus), l'alpha nominal de la heatmap est multiplié par
  0.5 (paramètre existant `alphaFadeIn`/alpha nominal, `liquidationHeat.ts:369`) ; hint
  une ligne dans la fenêtre LIQ (« heatmap atténuée : footprint actif »).

## 7. Contraintes

- TS strict + noUncheckedIndexedAccess ; commentaires/UI FRANÇAIS ; AUCUNE dépendance
  nouvelle ; tokens/primitives du standard (amendé Lot A) ; garde-fous verts.
- Budget requêtes : caches TTL 1 h dans `data/referentiels.ts` ; le store regime tick
  15 min ; AUCUNE nouvelle boucle par fenêtre (les fenêtres consomment les caches).
- Convention funding : fraction en interne, `formatFunding`/`formatPct` à l'affichage ;
  APR via `annualiserFunding`.
- Ton des textes générés : factuel-conditionnel, jamais prescriptif.
- Dégradation : toute source en échec → badge/tuile absents ou « — », jamais d'erreur
  bloquante ; daemon absent → baseline LIQ absente, le reste fonctionne.

## 8. Vérification

`pnpm -r test` + typecheck + build verts ; nouvelles pures testées (referentiel, regime,
lecturesBrief, zonesOnchain, extremesColonne, bucketsHoraires, deltasFenetre) ; contrôle
visuel : pastille REGIME (3 états), chapeau BRIEF, badges DERIV/CHAIN/LIQ, extrêmes EQS,
rangée VOL, bandeau STBL, navigation clavier du menu Indicateurs, atténuation heatmap.

## 9. Hors périmètre

- PULSE (HUD anomalies), ALRT2, SQZ, et toutes les features du Lot C.
- Historisation daemon (table series) : différée — à réévaluer si une API publique
  devient insuffisante (ex. streak ETF multi-jours, non couvert : le composant ETF de
  REGIME se limite au total de la veille).
- Backlog Lot A (`docs/superpowers/backlog-lot-a.md`) : inchangé, sauf si un item touche
  un fichier déjà modifié ici (doc sweep opportuniste autorisé, à tracer).
