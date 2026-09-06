# AXIOM — Indicateurs macroéconomiques mondiaux (ECST)

> **Spec de conception · 2026-09-06.** Issue d'un recensement multi-agents (18 agents, 152 séries
> vérifiées en live par curl) puis d'un arbitrage entre trois architectures indépendantes.
> Décisions utilisateur actées le 2026-09-06 : **six régions** (exception fournisseurs) et
> **4ᵉ onglet de la fenêtre RATE** (exception de surface).
>
> Cadre : `BUILD-CONTRACT.md`. Deux exceptions au gel G100 sont demandées ici (§7).

---

## 1. Le problème

AXIOM sait lire le **prix de l'argent** — rendements souverains (`RATE`), taux directeurs,
liquidité nette Fed (`NETLIQ`), M2 US (`MacroIndicators`). Il ne sait rien lire de l'**économie
réelle** : pas une série de chômage, d'inflation, de PIB ni de production industrielle.

Conséquence directe et visible : le calendrier `ECO` annonce la publication du CPI américain,
affiche sa prévision et sa valeur précédente — et **ne peut pas en montrer l'historique**. C'est
un demi-pont au sens de la revue du 2026-09-02 : la donnée est annoncée, jamais montrée.

Demande utilisateur : indicateurs macro (chômage, PPI, CPI, PIB, etc.) et **courbes d'évolution**,
pour les États-Unis, le Japon, la Chine, l'Inde, la zone euro et le Royaume-Uni.

## 2. Ce que le recensement établit

152 séries vérifiées, chacune par un curl ayant renvoyé HTTP 200 avec observations datées.

| Région | Séries vérifiées | Dont fraîches |
|---|---|---|
| Japon | 36 | 35 |
| Zone euro | 30 | 30 |
| États-Unis | 22 | 21 |
| Royaume-Uni | 22 | 22 |
| Chine | 23 | 18 |
| Inde | 19 | 16 |

**La couverture brute est trompeuse.** Sous contrainte de comparabilité entre les six zones
(mêmes unités, même périmètre statistique, fraîcheur équivalente) :

| Indicateur | Couverture comparable |
|---|---|
| **CPI en glissement annuel** | **6/6** — la seule ligne réellement mondiale |
| Change effectif réel (BIS, via FRED) | 6/6 |
| Production industrielle · PIB | 5/6 |
| Core CPI | 4/6 |
| Chômage BIT | 3/6 |
| **PMI** | **0/6** |

### 2.1 Les deux murs

**PMI — mur total, assumé.** ISM, S&P Global, CIPS et Jibun Bank sont propriétaires. Le miroir
DBnomics de l'ISM est périmé *et corrompu* (série servie en HTTP 200 : 48,7 → 11,1 → 10,0). Les
cinq substituts identifiés vivent sur des échelles incompatibles : soldes régionaux Fed centrés
sur **0**, ESI zone euro sur **100**, CI japonais en base 2020, CLI indien à 100 = tendance.
Afficher « PMI = 49,6 » depuis un solde d'opinion serait un **faux**. On n'affiche aucune PMI.

**Chine — bloc gelé au 2026-02.** Chômage, PPI, ventes au détail, core CPI, production
industrielle et salaires sont figés. Point structurant : NBS et World Bank GEM butent sur *le
même* mur — ce ne sont pas deux sources indépendantes. `data.stats.gov.cn` renvoie 403 (WAF).
Restent vivants pour la Chine : CPI a/a (2026-07, via OCDE), PIB a/a, M2, change effectif réel.

## 3. Décision d'architecture

**Livrer une ligne complète plutôt que six lignes trouées.** Le CPI en glissement annuel est le
seul indicateur servi nativement par la source dans les six cas — donc sans calcul maison, sans
approximation, sans périmètre à rattraper.

### 3.1 Sources retenues et pourquoi

| Région | Source | Dataflow / identifiant | Clé | Dernière obs. vérifiée |
|---|---|---|---|---|
| US | FRED | `CPIAUCSL` + `units=pc1` | — | 2026-07 · **3,30 %** |
| EZ | Eurostat | `prc_hicp_minr` | `geo=EA21`, `unit=RCH_A` | **2026-08** |
| UK | ONS | `economy/inflationandpriceindices/timeseries/d7g7/mm23/data` | — | 2026-07 · **2,9 %** |
| JP | OCDE | `OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0` | `JPN.M.N.CPI.PA._T.N.GY` | 2026-07 · **1,9 %** |
| CN | OCDE | `OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0` | `CHN.M.N.CPI.PA._T.N.GY` | 2026-07 · **0,5 %** |
| IN | OCDE | idem CN | `IND.M.N.CPI.PA._T.N.GY` | 2026-07 · **4,57 %** |

⚠️ **Le Japon vit dans un dataflow OCDE distinct** (`DSD_PRICES_COICOP2018`, pas `DSD_PRICES`).
Deux dataflows OCDE cohabitent donc dans le catalogue — le transport est identique, seule la
définition de série change. Vérifié en live : clé précise, HTTP 200, 7 points propres, CORS
reflétant l'origine.

Les trois fournisseurs nouveaux **remplacent des miroirs FRED morts** : FRED sert bien des séries
internationales, mais elles proviennent des OECD Main Economic Indicators, démantelés en
2023-2024. Leurs `last_updated` sont trompeurs — CPI zone euro arrêté en **2023**, CPI japonais
en **2021**, M2 chinois en **2019**. C'est le fondement de l'exception §7.

### 3.2 Réseau — aucun hôte à ajouter

Vérifié par curl avec `Origin: http://localhost:5173` :

| Hôte | En-tête CORS | Verdict |
|---|---|---|
| `ec.europa.eu` | `Access-Control-Allow-Origin: *` | appel direct |
| `www.ons.gov.uk` | `Access-Control-Allow-Origin: *` | appel direct |
| `sdmx.oecd.org` | origine reflétée (y compris origine Vercel) | appel direct |
| `api.stlouisfed.org` | — | route `/fredapi` existante |

`shared/extapi-hosts.ts` n'est **pas modifié**, donc ni `apps/daemon/`, ni `api/_policy.ts`, ni
`vite.config.ts`. Convention déjà appliquée dans le dépôt (« PortWatch ArcGIS (CORS \*) reste en
appel direct »).

⚠️ **`api.ons.gov.uk` est décommissionnée** (retirée le 25/11/2024, confirmé en live). Le seul
hôte ONS valide est `www.ons.gov.uk`.

### 3.3 Pièges vérifiés en live — contraintes d'implémentation

**(a) OCDE : jamais de clé multi-`REF_AREA`.** Une clé `CHN+IND` **tronque silencieusement le
second pays**, en HTTP 200, sans erreur. Mesuré, reproductible sur trois essais :

| `startPeriod` | Clé `CHN+IND` | Appels unitaires |
|---|---|---|
| `2026-01` | CHN 7 pts · **IND 5 pts** | CHN 7 · **IND 7** |
| `2026-05` | CHN 3 pts · **IND 1 pt** | CHN 3 · **IND 3** |

L'Inde perd ses deux points les plus récents à chaque fois. **Un appel par pays.** Cela invalide
l'optimisation « 3 appels OCDE → 2 » proposée en arbitrage.

**(b) OCDE : quota.** Le 429 tombe entre 10 et 12 requêtes rapprochées ; `retry-after: 0` est
mensonger et la fenêtre de reset n'est pas mesurée. D'où : chargement **séquentiel** espacé
≥ 2 s, clés précises (aucun joker), aucun retry serré, et un statut de santé « quota » **distinct**
de « source morte ».

**(c) Eurostat : filtrage dimensionnel obligatoire.** Une requête `prc_hicp_minr` insuffisamment
filtrée renvoie **plusieurs milliers de valeurs** (tous géos, tous postes COICOP) en HTTP 200 —
pas une erreur, un payload ingérable. Le jeu a été rebasé (2025=100, ECOICOP v2, code géo
**EA21**) ; `prc_hicp_manr` et `midx` sont **archivés** (gelés à 2025-12, vérifié).

**(d) Eurostat : `value` vide.** Un HTTP 200 avec `value: {}` est un **échec de source**, pas une
série vide. À traiter comme tel.

**(e) ONS : format.** `months[]` avec `{date: "2026 JUL", value: "3.8"}` — mois en anglais,
valeur en **chaîne**, `"NA"` à filtrer. 451 mois servis, ~122 Ko par série, **sans bornage amont
possible** : tronquer à 2020-01 **avant** mise en cache. Les clés `quarters`/`years` sont ignorées.

**(f) Japon : dataflow distinct.** Le CPI japonais n'est **pas** dans `DSD_PRICES@DF_PRICES_ALL` :
il vit dans `DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0`. Le transport OCDE doit donc porter
le dataflow **par entrée de catalogue**, jamais en constante de module. Le core-core japonais
(`JPN.M.N.CPI.PA._TXCP01_NRG.N.GY`, vérifié : 1,5 % en 2026-07) vit dans le même dataflow.

**(g) OCDE : aucun joker dans la clé.** Les clés jokerisées (`JPN.M......`) sont documentées comme
sujettes à troncature silencieuse, au même titre que les clés multi-pays du point (a). Toutes les
clés du catalogue sont **entièrement spécifiées**.

## 4. Découpage en lots

### LOT 1 — « CPI a/a, six régions », de bout en bout
~620 lignes dont ~290 de tests. Aucun hôte ajouté, aucune ligne de daemon, aucune ligne de proxy.

Catalogue déclaratif + trois transports neufs (OCDE, Eurostat, ONS) + le fetcher FRED existant
étendu de 4 lignes + harmonisation pure + store + 4ᵉ onglet RATE + santé des sources.

**Critères de succès vérifiables :**
- `pnpm -w test` et `scripts/ci.sh` verts.
- L'onglet rend **six séries** sur fixtures. Oracles vérifiés en live le 2026-09-06, à consigner
  en commentaire et **jamais fetchés en test** : US ≈ 3,30 % · EZ (2026-08) · UK 2,9 % ·
  JP 1,9 % · CN 0,5 % · IN ≈ 4,57 %, tous sur 2026-07 sauf EZ.
- `oecd.test.ts` **échoue** si l'on retire le tri chronologique (fixture aux `TIME_PERIOD`
  volontairement désordonnés).
- `oecd.test.ts` : une réponse tronquée façon clé multi-pays est **détectée** (garde de complétude
  sur le nombre de points attendus dans la fenêtre demandée).
- `eurostat.test.ts` : HTTP 200 à `value: {}` → échec de source, pas série vide.
- Test 429 OCDE → statut `quota`, message dédié, **jamais** « source morte ».
- `harmonisation.test.ts` : `finDePeriode("2026-04-01","Q") === 2026-06-30` ; un trimestriel
  T2 2026 au 2026-09-06 ressort **frais**, un mensuel 2026-02 ressort **périmé**.
- La fenêtre `DATA` liste 4 sources : `macro:fred`, `macro:eurostat`, `macro:oecd`, `macro:ons`.
- Clé FRED absente → état `SansCle` et **5 courbes sur 6** restent tracées, aucune exception.
- `git diff --stat shared/extapi-hosts.ts apps/daemon/ api/` → **vide**.

### LOT 2 — Les ponts, avant toute nouvelle série
~150 lignes dont ~55 de tests. Zéro requête réseau nouvelle, zéro source nouvelle.

Section « Macro » dans `BRIEF` (lit le cache 24 h, ne fetche pas) ; `serieMacroDe(country, title)`
pur, réutilisant les motifs déjà écrits dans `impactPublicationFred` (`data/eco.ts:152-173`) ;
second bouton « série » sur la ligne `ECO`.

**Critères :** `serieMacroDe("USD","Consumer Price Index m/m")` → `cpi-aa-us` ;
`serieMacroDe("EUR","ZEW Economic Sentiment")` → `null` (aucun bouton rendu) ; un clic sur une
ligne ECO ouvre l'onglet sur la bonne série ; `briefEnMarkdown` avec `macro: null` rend
`_Section indisponible._`.

### LOT 3 — Élargissement par configuration seule
~130 lignes. **Zéro nouveau transport, zéro nouvel hôte.** Seuls le catalogue et
`glissementAnnuel` (+ son test) sont touchés.

- **Change effectif réel BIS 6/6** — `RBUSBIS`, `RBXMBIS`, `RBGBBIS`, `RBJPBIS`, `RBCNBIS`,
  `RBINBIS`, tout FRED : la ligne la moins chère du catalogue.
  ⚠️ `RBXMBIS` n'est cité que dans une note de famille — le vérifier, repli `NBXMBIS` étiqueté
  « nominal ». Ne **jamais** employer `DTWEXBGS` (nominal, base 2006, échelle non comparable).
- **Core CPI 4/6** (US, EZ, UK, JP). Japon : série **740** (core-core) ou OCDE `_TXCP01_NRG`,
  **jamais 733** (hors produits frais ≠ hors alimentation et énergie). CN et IN : aucun core
  vivant, vérifié sur trois sources.
- **Production industrielle 5/6** — publiée en indice, seul usage de `glissementAnnuel`.
- **Chômage BIT 3/6** (US, EZ, JP). **UK exclu** : `BCJE` est un compte administratif de
  demandeurs d'indemnités, `MGSX` (BIT) plafonne à 2026-05. Trou **assumé**, pas comblé par un
  substitut de définition différente.
- **PIB a/a 5/6** — seuil de fraîcheur trimestriel.

**Critères :** le catalogue passe de 6 à ~30 séries **sans qu'un fichier de transport soit
rouvert** ; le `Segmente` compte 6 indicateurs ; aucune série au périmètre déviant n'est affichée
sans son étiquette.

## 5. Fichiers

### À créer (~700 lignes)

| Chemin | Rôle | ~l |
|---|---|---|
| `apps/web/src/data/macro/catalogueMacro.ts` | `DefinitionSerieMacro { id, region, indicateur, libelle, transport, cle, unite, frequence, transformation, perimetre?, cleRequise? }` + `CATALOGUE_MACRO`. **Seul fichier à éditer quand une source amont bouge.** | 110 |
| `apps/web/src/data/macro/harmonisation.ts` | PUR : `finDePeriode`, `trierChrono`, `filtrerFenetre`. (`glissementAnnuel` au lot 3.) | 70 |
| `apps/web/src/data/macro/harmonisation.test.ts` | Datation début-de-période, seuils M/Q, tri. | 80 |
| `apps/web/src/data/macro/oecd.ts` | SDMX-JSON. **Un appel par pays**, dataflow porté par l'entrée de catalogue (deux dataflows cohabitent : `DSD_PRICES` et `DSD_PRICES_COICOP2018`), clé entièrement spécifiée, tri chrono, garde de complétude, 429 → statut quota, séquencement ≥ 2 s. | 115 |
| `apps/web/src/data/macro/oecd.test.ts` | Fixture désordonnée, réponse tronquée, 429, deux dataflows. | 105 |
| `apps/web/src/data/macro/eurostat.ts` | JSON-stat (`value` indexé par position ↔ `dimension.time.category.index`). Filtrage dimensionnel complet obligatoire. 200-à-`value`-vide = échec. Géo **EA21**, jeu `prc_hicp_minr`. | 75 |
| `apps/web/src/data/macro/eurostat.test.ts` | Mapping index→période, `value` vide, payload non filtré. | 75 |
| `apps/web/src/data/macro/ons.ts` | Parse `months[]`, mois anglais, valeur chaîne, `"NA"` filtré, troncature à 2020-01 avant cache. | 70 |
| `apps/web/src/data/macro/ons.test.ts` | Parse, `"NA"`, troncature. | 65 |
| `apps/web/src/store/macroSeries.ts` | Store vanilla (patron `store/eco.ts`) : état par série, cache localStorage 24 h + garde de débit, `demanderSerie(id)` (patron `macroRatesViewStore.demanderCourbe()`), `healthStore`. | 130 |
| `apps/web/src/data/macro/ecoVersSerie.ts` + `.test.ts` *(lot 2)* | Pont ECO → série, pur. | 60 + 55 |

### À modifier (~+210 lignes)

| Chemin | Modification | ~l |
|---|---|---|
| `apps/web/src/data/macro/fred.ts` | `createFredM2Provider(seriesId = "WM2NS", units?: string)` + `if (units !== undefined) params.set("units", units)`. Purement additif : aucun appelant existant ne passe `units`, l'URL de M2/NETLIQ reste bit-à-bit identique. **Ne pas renommer la fonction** (casserait `netliq.ts`). | +4 |
| `apps/web/src/components/courbeTaux.util.ts` | `pointsDeSerieTemporelle(serie, frequence)` → `PointCourbe[]` (`anneesTri` = années décimales, `maturite` = étiquette « juil. 26 »). Seul domicile possible sans inverser les couches `data/` → `components/`. | +25 |
| `apps/web/src/components/courbeTaux.util.test.ts` | Monotonie, étiquette, série vide. | +30 |
| `apps/web/src/components/MacroRatesWindow.tsx` | 4ᵉ onglet « Indicateurs » : `Segmente` (indicateur) + `<CourbeTaux>` (pays en séries) + `TableTriable` + `BoutonRafraichir`. | +140 |
| `apps/web/src/data/dataCockpit.ts` | 4 entrées dans `LIBELLES_SOURCE` : `macro:fred` (distinct de `eco:fred`), `macro:eurostat`, `macro:oecd`, `macro:ons`. **Une clé par hôte, jamais par série.** | +4 |
| `apps/web/src/data/macro/index.ts` | Ré-exports. | +6 |
| *Lot 2* : `data/brief.ts` (+ `macro: LigneMacroBrief[] \| null` dans `DonneesBrief`), `BriefWindow.tsx`, `EcoWindow.tsx` | Ponts. | +125 |

### À ne pas toucher
`shared/extapi-hosts.ts`, `apps/daemon/**`, `api/_policy.ts`, `packages/alerts/**`,
`chart/macro.ts`, `store/macro-overlays.ts`, `packages/indicators/**` (catalogue gelé à 187),
`packages/types/**`, `store/windowManager.ts` (aucune fenêtre nouvelle).

## 6. Deux choix structurants

**Pas de primitive graphique neuve.** `CourbeTaux` est réutilisable via ~25 lignes de projection
(son axe X est un flottant quelconque), ce qui économise ~480 lignes de canvas. **Contrainte
qui en découle et qui doit être respectée** : son infobulle apparie les points *par identité de
chaîne* (`CourbeTaux.tsx:242`), donc **un graphe = une fréquence**. Un `Segmente` choisit
l'indicateur, les pays sont les séries. Mélanger PIB trimestriel et CPI mensuel sur le même canvas
remplirait l'infobulle de `VALEUR_ABSENTE` — c'est ce qui invalide l'idée d'une matrice 2D
comme vue *graphique*.

**Pas de calcul de glissement annuel maison en lot 1.** FRED (`units=pc1`), Eurostat (`RCH_A`),
ONS (D7G7) et l'OCDE (`GY`) le servent tous nativement. `glissementAnnuel` n'apparaît qu'au lot 3,
pour la production industrielle publiée en indice.

**Réutiliser `Fraicheur` existant** (`ui.tsx:719-788` : `texteFraicheur`, `etatFraicheur`,
`Fraicheur({loading, majTs, cadence, cadenceMs})`). Il ne reste à écrire que
`finDePeriode(debutMs, frequence)`, dont le résultat est passé en `majTs`, avec
`cadenceMs` = 2 périodes.

**Pas de drapeau `vercel`.** Précédent tranché : `netliq` (FRED + clé personnelle,
`store/windowManager.ts:95`) n'en porte aucun ; l'état `SansCle` est la dégradation gracieuse
admise. Ici cinq régions sur six sont sans clé.

## 7. Exceptions au gel G100 — actées par l'utilisateur le 2026-09-06

`BUILD-CONTRACT.md:49` : « Aucune nouvelle fenêtre ni fonctionnalité de surface avant le
verdict ». `BUILD-CONTRACT.md:58` : « pas de nouveau fournisseur sans remplacement direct d'une
source défaillante ».

1. **Surface** — un 4ᵉ onglet dans la fenêtre `RATE` existante. Aucune fenêtre nouvelle, le
   registre reste à 39. Exception de surface la plus petite disponible.
2. **Fournisseurs** — OCDE, Eurostat et ONS, publics, sans clé, en appel direct. Ils entrent
   au titre du **remplacement direct de sources défaillantes** : les miroirs FRED internationaux
   sont morts (§3.1). `EXCHANGE_IDS` reste à 9 (aucun adaptateur d'exchange concerné).

À consigner dans `BUILD-CONTRACT.md` au même titre que les quatre exceptions précédentes
(2026-08-25, 09-01, 09-02, 09-04).

## 8. Ce qu'on ne fait pas, et pourquoi

1. **Aucune ligne PMI.** Rien n'est un PMI nulle part (§2.1). Si cette famille est voulue un jour :
   une ligne « confiance des affaires » contenant **uniquement** le `BCICP` OCDE, jamais de
   seuil 50.
2. **Aucune colonne de surprise vs consensus.** Aucune source gratuite de consensus dans le
   recensement ; le `forecast` ForexFactory ne couvre que la semaine courante — il peut décorer
   une ligne via ECO, il ne fonde pas une colonne.
3. **Pas de ventes au détail** (dollars nominaux US vs indices de volume EZ/UK/JP), **pas de PPI**
   (le WPI indien est un autre concept, EZ en NSA seulement, CN gelée), **pas de balance
   commerciale** (trois périmètres incompatibles), **pas de prix immobilier ni mises en chantier**
   (cinq bases, deux fréquences, périmètre **municipal — Pékin seul** côté BIS mensuel chinois),
   **pas de salaires** (la série OCDE `H_EARN` japonaise est `ACTIVITY=C`, manufacturier seul),
   **pas de confiance des ménages** (l'unité `PB` chinoise est fausse **à la source OCDE** : +89
   là où la zone euro est à −14).
4. **Pas de niveaux absolus comparés entre régions.** M2 US ≠ M4 UK ≠ M3 IN ≠ M2 CN :
   comparables en taux de croissance seulement.
5. **Pas d'agrégat maison** — pas de « M2 mondial », pas d'indice composite. L'obstacle
   (conversion FX + harmonisation des définitions) est documenté depuis l'origine dans l'en-tête
   de `data/macro/fred.ts`.
6. **Pas de primitive `CourbeTemporelle`**, pas de migration de `NETLIQ` ni de `CYCLE`. Ils
   fonctionnent ; les refactoriser serait le « refactoriser ce qui n'est pas cassé » interdit par
   le protocole.
7. **Pas d'alerte macro, pas d'overlay de pane chart, pas de pont screener/backtest, pas de
   collecteur daemon, pas de table SQLite.** Donnée mensuelle dont `ECO` annonce déjà la date de
   sortie. `RATE` et `COT` n'alimentent aucune alerte ; ECST au même niveau n'est pas un
   demi-pont.
8. **Pas de polling, pas de `setInterval`.** Cache 24 h + refetch à l'ouverture si expiré +
   `BoutonRafraichir`. C'est la donnée la plus lente du terminal.
9. **Pas de rebasage base 100, pas de MoM, pas de LOCF, pas de désaisonnalisation locale.**
   Conséquence du « tout en a/a » : trois familles de code non écrites.
10. **Pas de renommage de `createFredM2Provider`** malgré son nom trompeur.
11. **Les 122 autres séries recensées.** Sur 152 vérifiées, 6 sont câblées au lot 1, ~30 après le
    lot 3. Le recensement est un document de référence, pas un cahier des charges — chaque série
    non affichée serait du code mort déguisé en couverture.

## 9. Affichage honnête (règle transverse)

- Toute série au périmètre déviant porte une **étiquette visible** (« core-core », « extra-EA »,
  « claimant count », « manufacturier seul »).
- Une série absente affiche un **motif explicite** (« quota OCDE », « gelé 2026-02 »,
  « propriétaire »), **jamais un tiret muet**.
- Un statut « quota » n'est jamais présenté comme une panne de source.

## 10. Fragilité amont — plan de maintenance

Eurostat a rebasé (2025=100, ECOICOP v2, géo EA21), l'OCDE versionne ses dataflows, l'ONS a
décommissionné son API en 2024. **Tous les identifiants vivent dans `catalogueMacro.ts`** : une
rupture amont se corrige dans un seul fichier, sans rouvrir un transport.
