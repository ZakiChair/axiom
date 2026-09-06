# AXIOM — Recensement des séries macroéconomiques gratuites

> **Doc de recherche · 2026-09-06.** Produit par un recensement multi-agents (18 agents,
> ~620 appels d'outils). **Chaque série listée ici a renvoyé un HTTP 200 avec de vraies**
> **observations** au moment du recensement — rien n'est repris de mémoire. Les identifiants
> non vérifiés ont été écartés, pas devinés.
>
> Conception associée : [`../superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md`](../superpowers/specs/2026-09-06-indicateurs-macro-mondiaux-design.md)
>
> ⚠️ **Ce document est une référence, pas un cahier des charges.** La spec n'en câble que 6
> séries au lot 1 et ~30 au lot 3. Chaque série affichée sans être lue serait du code mort
> déguisé en couverture.

## Synthèse — 152 séries vérifiées

| Région | Séries vérifiées | Dont fraîches | Indicateurs sans source |
|---|---|---|---|
| US | 22 | 21 | 2 |
| EZ | 30 | 30 | 2 |
| UK | 22 | 22 | 5 |
| JP | 36 | 35 | 2 |
| CN | 23 | 18 | 5 |
| Inde (IN) | 19 | 16 | 2 |
| **Total** | **152** | | |

« Fraîche » = dernière observation à moins de 4 mois du 2026-09-06.

## Hôtes rencontrés

- `api.db.nomics.world`
- `api.imf.org`
- `api.mospi.gov.in`
- `api.stlouisfed.org`
- `api.worldbank.org`
- `dashboard.e-stat.go.jp`
- `data-api.ecb.europa.eu`
- `ec.europa.eu`
- `landregistry.data.gov.uk`
- `sdmx.oecd.org`
- `stats.bis.org`
- `www.bankofengland.co.uk`
- `www.ons.gov.uk`
- `www.stat-search.boj.or.jp`

La spec ne retient que `api.stlouisfed.org` (route `/fredapi` existante), `sdmx.oecd.org`,
`ec.europa.eu` et `www.ons.gov.uk` — les trois derniers en appel direct (CORS vérifié).

---

## US

| Indicateur | Source | Identifiant | Fréq. | Unités | Dernière obs. | Clé | État |
|---|---|---|---|---|---|---|---|
| Chomage (taux) | FRED | `UNRATE` | Monthly | Percent (desaisonnalise) | 2026-08-01 | oui | ✅ |
| Masse monetaire M2 | FRED | `M2SL` | Monthly | Billions of Dollars (SA) | 2026-07-01 | oui | ✅ |
| Confiance des menages / sentiment consommateur | FRED | `UMCSENT` | Monthly | Index 1966:Q1=100 (NSA) | 2026-07-01 | oui | ✅ |
| Salaires / revenus (croissance) | FRED | `CES0500000003` | Monthly | Dollars per Hour (SA) — avec units=pc1 : Percent Change from Year Ago | 2026-08-01 | oui | ✅ |
| Logement — mises en chantier | FRED | `HOUST` | Monthly | Thousands of Units (SAAR) | 2026-07-01 | oui | ✅ |
| Logement — prix immobilier | FRED | `CSUSHPINSA` | Monthly | Index Jan 2000=100 (NSA) | 2026-06-01 | oui | ✅ |
| Taux de change effectif USD | FRED | `DTWEXBGS` | Daily | Index Jan 2006=100 (NSA) | 2026-08-28 | oui | ✅ |
| CPI / inflation IPC (glissement annuel) | FRED | `CPIAUCSL (units=pc1)` | Monthly | Percent Change from Year Ago | 2026-07-01 | oui | ✅ |
| CPI / inflation IPC (indice) | FRED | `CPIAUCSL` | Monthly | Index 1982-1984=100 (SA) | 2026-07-01 | oui | ✅ |
| Inflation sous-jacente (core CPI) | FRED | `CPILFESL` | Monthly | Index 1982-1984=100 (SA) | 2026-07-01 | oui | ✅ |
| Inflation PCE (deflateur suivi par la Fed) | FRED | `PCEPI` | Monthly | Index 2017=100 (SA) | 2026-07-01 | oui | ✅ |
| Core PCE (cible 2 % de la Fed) | FRED | `PCEPILFE` | Monthly | Index 2017=100 (SA) | 2026-07-01 | oui | ✅ |
| PPI / prix a la production | FRED | `PPIFIS` | Monthly | Index Nov 2009=100 (SA) | 2026-07-01 | oui | ✅ |
| Production industrielle | FRED | `INDPRO` | Monthly | Index 2017=100 (SA) | 2026-07-01 | oui | ✅ |
| Ventes au detail | FRED | `RSAFS` | Monthly | Millions of Dollars (SA) | 2026-07-01 | oui | ✅ |
| Balance commerciale | FRED | `BOPGSTB` | Monthly | Millions of Dollars (SA) | 2026-07-01 | oui | ✅ |
| Exports | FRED | `BOPTEXP` | Monthly | Millions of Dollars (SA) | 2026-07-01 | oui | ✅ |
| PMI manufacturier (national) — MEME serie, transport de secours DBnomics | DBnomics | `OECD/DSD_STES@DF_BTS/USA.M.BCICP.PB.C.Y._Z._Z.N` | Monthly | Percentage balance (solde d'opinions, seuil 0) | 2026-05-01 | — | ⚠️ périmée |
| PMI manufacturier (national) — SUBSTITUT national verifie | OECD | `USA.M.BCICP.PB.C.Y._Z._Z.N (dataflow OECD.SDD.STES,DSD_STES@DF_BTS,4.0)` | Monthly | Percentage balance (solde d'opinions, seuil 0) | 2026-08-01 | — | ✅ |
| PMI manufacturier — PROXY regional Fed (ce n'est PAS un PMI) | FRED | `GACDISA066MSFRBNY` | Monthly | Index (SA) | 2026-08-01 | oui | ✅ |
| PMI manufacturier — PROXY regional Fed (ce n'est PAS un PMI) | FRED | `GACDFSA066MSFRBPHI` | Monthly | Index (SA) | 2026-08-01 | oui | ✅ |
| PMI services — PROXY regional Fed (ce n'est PAS un PMI) | FRED | `TSSOSBACTSAMFRBDAL` | Monthly | Index (SA) | 2026-08-01 | oui | ✅ |

**Sans source gratuite vérifiée :**

- **PMI manufacturier national sur echelle 50 (ISM / S&P Global)** — Toujours introuvable en gratuit. Nouvelles verifications de cette passe : (a) DBnomics expose bien un provider ISM — https://api.db.nomics.world/v22/series/ISM/pmi?observations=1 renvoie HTTP 200 — mais la serie est PERIMEE ET CORROMPUE : derniere obs 2025-12, indexed_at 2026-01-07, et les valeurs de fin sont absurdes (2025-08=48.7 puis 2025-09=11.1, 2025-10=10.0, 2025-11=10.0, 2025-12=10.3) — scr
- **PMI services national sur echelle 50 (ISM Services / S&P Global Services)** — Introuvable en gratuit, et aucune enquete services NATIONALE utilisable trouvee. Verifications de cette passe : (a) DBnomics ISM/nm-pmi renvoie HTTP 200 mais s'arrete a 2025-08 (valeur 52.0), indexed_at 2025-09-05 — un an de retard, inexploitable. (b) L'OCDE BTS ne couvre les activites hors industrie aux Etats-Unis que jusqu'en 2020-06 : les 4 series USA.M.*.A_F_HTU.* (Business situation, Employme

<details><summary>Notes de recensement (pièges, quotas, séries discontinuées)</summary>

COUVERTURE : 14/14 indicateurs couverts, dont 13 par une serie nationale directe et 1 (PMI) uniquement par des proxies regionaux. 22 series testees sur /series/observations, 22 en HTTP 200 avec observations reelles. Aucun autre hote n'a ete necessaire : DBnomics, ECB, BIS et IMF sont inutiles pour les US, FRED etant natif BLS/BEA/Census/Fed.  PIEGE fraiche SUR LES TRIMESTRIELLES : GDPC1 et A191RL1Q225SBEA sont marques fraiche=false parce que leur derniere observation est datee 2026-04-01, soit avant le seuil des 4 mois (2026-05-06). C'est un ARTEFACT DE DATATION, pas une serie perimee : FRED date un trimestre au premier jour de la periode, donc "2026-04-01" = T2 2026, publie le 2026-08-26 (voir lastUpdated). Ces deux series sont vivantes et representent le dernier PIB disponible. J'applique la regle telle qu'ecrite plutot que de forcer true en silence — a l'orchestrateur d'ajuster le critere pour les frequences trimestrielles (comparer sur derniereObs + 1 trimestre, ou sur lastUpdated).  LIMITE DU FETCHER AXIOM : createFredM2Provider (apps/web/src/data/macro/fred.ts, lignes 86-93) ne construit que series_id, file_type, api_key, observation_start et observation_end. Le parametre units n'est PAS transmis. Or FRED sait calculer le glissement annuel cote serveur (units=pc1, verifie en live : CPIAUCSL juillet 2026 = 3.30 %, CES0500000003 aout 2026 = 3.09 %). Deux options : ajouter params.set("units", ...) au fetcher, ou calculer le a/a localement depuis l'indice. Sans cette extension, toutes les series marquees "indice -> glissement annuel" demandent un calcul cote AXIOM.  PIEGE DE PARSING JSON : les reponses de l'endpoint /fred/series contiennent des caracteres de controle bruts (retours a la ligne non echappes) dans le champ notes ; un parseur strict echoue (en Python, json.loads(..., strict=False) est necessaire). L'endpoint /fred/series/observations n'est PAS affecte — et c'est le seul qu'AXIOM utilise, donc pas d'impact runtime.  SERIES DISCONTINUEES CROISEES : TROSBACTSAMFRBDAL (Texas Retail Outlook Survey) s'arrete au 2025-12-01 et est explicitement marquee DISCONTINUED dans son titre — ne pas la confondre avec TSSOSBACTSAMFRBDAL (services, vivante). Aucune des series retenues n'est discontinuee ; le probleme OCDE/MEI evoque dans la consigne ne touche pas les US, dont toutes les series proviennent directement de BLS/BEA/Census/Fed via FRED.  PIEGE D'IDENTIFIANTS : les codes des enquetes regionales Fed sont proches et faciles a inverser. Empire State = GACDISA066MSFRBNY (I), Philadelphie = GACDFSA066MSFRBPHI (F). Mes premieres tentatives inversees ont renvoye 400 — toujours passer par series/search pour ces familles.  ALTERNATIVES ECARTEES : PPIACO (All Commodities) est NSA et couvre un panier plus large que PPIFIS — utilisable mais moins comparable a la publication PPI mensuelle standard, d'ou le choix de PPIFIS (Final Demand, SA). ECIWAG (Employment Cost Index, salaires, verifie a 2026-04-01 / maj 2026-07-31) est un bon indicateur de couts sal

</details>

## EZ

| Indicateur | Source | Identifiant | Fréq. | Unités | Dernière obs. | Clé | État |
|---|---|---|---|---|---|---|---|
| Chomage (taux) | Eurostat | `une_rt_m / M.SA.TOTAL.PC_ACT.T.EA21` | Monthly | % de la population active (desaisonnalise) | 2026-07-01 | — | ✅ |
| Chomage (taux) — alternative sur hote deja en whitelist | ECB | `LFSI.M.I9.S.UNEHRT.TOTAL0.15_74.T` | Monthly | % (PC), desaisonnalise | 2026-07-01 | — | ✅ |
| Masse monetaire M2 | ECB | `BSI.M.U2.Y.V.M20.X.1.U2.2300.Z01.E` | Monthly | Millions d'EUR (UNIT=EUR, UNIT_MULT=6), encours, corrige des variations saisonnieres | 2026-07-01 | — | ✅ |
| Confiance des menages | Eurostat | `ei_bsco_m / M.BS-CSMCI.SA.BAL.EA21` | Monthly | Solde d'opinion en % (SA) | 2026-08-01 | — | ✅ |
| Salaires / cout du travail (croissance) | Eurostat | `ei_lmlc_q / Q.NV.PCH_SM.SCA.B-S.LM-LCI-TOT.EA21` | Quarterly | % glissement annuel (SCA ; NSA n'est pas publie pour EA21) | 2026-04-01 | — | ✅ |
| Taux de change USD/EUR | FRED | `DEXUSEU` | Daily | USD pour 1 EUR | 2026-08-28 | oui | ✅ |
| Taux de change USD/EUR (source BCE, plus fraiche) | ECB | `EXR.D.USD.EUR.SP00.A` | Daily | USD pour 1 EUR | 2026-09-04 | — | ✅ |
| Taux de change effectif nominal | FRED | `NBXMBIS` | Monthly | Indice 2020=100 (NSA) | 2026-07-01 | oui | ✅ |
| CPI / IPCH — glissement annuel | Eurostat | `prc_hicp_minr / M.RCH_A.TOTAL.EA21` | Monthly | % glissement annuel | 2026-08-01 | — | ✅ |
| CPI / IPCH — indice | Eurostat | `prc_hicp_minr / M.I25.TOTAL.EA21` | Monthly | Indice 2025=100 (NSA) | 2026-08-01 | — | ✅ |
| CPI / IPCH — indice (repli FRED, deja branche dans AXIOM) | FRED | `CP00MI15EA20M086NEST` | Monthly | Index 2025=100 (NSA) | 2026-07-01 | oui | ✅ |
| Inflation sous-jacente (core) | Eurostat | `prc_hicp_minr / M.RCH_A.TOT_X_NRG_FOOD.EA21` | Monthly | % glissement annuel | 2026-08-01 | — | ✅ |
| Inflation sous-jacente (core) — repli FRED | FRED | `TOTNRGFOODEA20MI15XM` | Monthly | Index 2025=100 (NSA) | 2026-07-01 | oui | ✅ |
| PPI / prix a la production | Eurostat | `sts_inpp_m / M.PRC_PRR.B-E36.NSA.PCH_SM.EA21` | Monthly | % glissement annuel (NSA — aucune version desaisonnalisee publiee) | 2026-07-01 | — | ✅ |
| PIB — croissance trimestrielle | Eurostat | `namq_10_gdp / Q.CLV_PCH_PRE.SCA.B1GQ.EA21` | Quarterly | % variation par rapport au trimestre precedent (SCA) | 2026-04-01 | — | ✅ |
| PIB — niveau reel | FRED | `CLVMNACSCAB1GQEA19` | Quarterly | Millions d'euros chaines 2010 (SA) | 2026-04-01 | oui | ✅ |
| Production industrielle | Eurostat | `sts_inpr_m / M.PRD.B-D.SCA.I21.EA21` | Monthly | Indice 2021=100 (corrige des variations saisonnieres et jours ouvres) | 2026-06-01 | — | ✅ |
| Ventes au detail | Eurostat | `sts_trtu_m / M.VOL_SLS.G47.SCA.I21.EA21` | Monthly | Indice de volume 2021=100 (SCA) | 2026-07-01 | — | ✅ |
| Balance commerciale (biens, extra-zone euro) | Eurostat | `bop_eu6_m / M.MIO_EUR.G.S1.SCA.S1.BAL.EXT_EA21.EA21` | Monthly | Millions d'euros (SCA) | 2026-06-01 | — | ✅ |
| Balance commerciale douaniere (Comext) — zone euro : EXPORTATIONS extra-EA | ECB | `TRD/M.I10.Y.X.TTT.J10.4.VAL` | Monthly | EUR, milliers (UNIT_MULT=Thousands) | 2026-06-01 | — | ✅ |
| Balance commerciale douaniere (Comext) — zone euro : IMPORTATIONS extra-EA | ECB | `TRD/M.I10.Y.M.TTT.J10.4.VAL` | Monthly | EUR, milliers (UNIT_MULT=Thousands) | 2026-06-01 | — | ✅ |
| Balance commerciale douaniere — Allemagne | Eurostat | `ei_eteu27_2020_m / M.BAL_RT.MIO-EUR-SA.WORLD.ET-T.DE` | Monthly | Mio EUR (desaisonnalise et corrige des jours ouvrables) | 2026-06-01 | — | ✅ |
| Balance commerciale douaniere — France | Eurostat | `ei_eteu27_2020_m / M.BAL_RT.MIO-EUR-SA.WORLD.ET-T.FR` | Monthly | Mio EUR (desaisonnalise et corrige des jours ouvrables) | 2026-06-01 | — | ✅ |
| Exportations (biens, extra-zone euro) | Eurostat | `bop_eu6_m / M.MIO_EUR.G.S1.SCA.S1.CRE.EXT_EA21.EA21` | Monthly | Millions d'euros (SCA) | 2026-06-01 | — | ✅ |
| PMI (substitut EC — PAS un PMI) | Eurostat | `ei_bssi_m_r2 / M.BS-ESI-I.SA.EA21` | Monthly | Indice, moyenne long terme = 100 (SA) | 2026-08-01 | — | ✅ |
| PMI manufacturier (substitut EC — PAS un PMI) | Eurostat | `ei_bssi_m_r2 / M.BS-ICI-BAL.SA.EA21` | Monthly | Solde d'opinion en % (SA), seuil neutre 0 | 2026-08-01 | — | ✅ |
| PMI services (substitut EC — PAS un PMI) | Eurostat | `ei_bssi_m_r2 / M.BS-SCI-BAL.SA.EA21` | Monthly | Solde d'opinion en % (SA), seuil neutre 0 | 2026-08-01 | — | ✅ |
| Bonus — IPCH Allemagne (indice) | FRED | `CP0000DEM086NEST` | Monthly | Index 2025=100 (NSA) | 2026-07-01 | oui | ✅ |
| Bonus — PIB reel Allemagne | FRED | `CLVMNACSCAB1GQDE` | Quarterly | Millions d'euros chaines 2010 (SA) | 2026-04-01 | oui | ✅ |
| Bonus — PIB reel France | FRED | `CLVMNACSCAB1GQFR` | Quarterly | Millions d'euros chaines 2010 (SA) | 2026-04-01 | oui | ✅ |

**Sans source gratuite vérifiée :**

- **PMI manufacturier et services (vrais PMI) — zone euro** — Confirme cette passe avec de nouvelles preuves. (a) Le dataflow ECB/SUR expose bien dans ses codelists les items MANPMI ('Manufacturing - purchasing manager index'), SERPMI et la source NTC='Markit', mais AUCUNE donnee publique n'est servie : https://data-api.ecb.europa.eu/service/data/SUR/M...NTC.MANPMI. et .../M....SERPMI. renvoient HTTP 404 'No Series was returned'. Les 224 series reellement pe
- **Logement — prix immobilier zone euro (remplacement plus frais que 2026-01-01)** — Aucune source plus fraiche n'existe, verifie sur trois pistes : (a) Eurostat prc_hpi_q (API live, HTTP 200) derniere periode = 2026-Q1, updated 2026-07-02 — idem pour DE et FR ; le Q2 2026 est attendu debut octobre 2026. (b) ECB/RPP (Residential Property Price Index Statistics) est mort : derniere observation 2018. (c) BIS/WS_SPP (Selected residential property prices, y compris l'agregat euro area

<details><summary>Notes de recensement (pièges, quotas, séries discontinuées)</summary>

ACTION REQUISE POUR AXIOM — ec.europa.eu N'EST PAS dans la whitelist du proxy (qui ne contient que data-api.ecb.europa.eu, stats.bis.org, api.imf.org, home.treasury.gov, www.mof.go.jp). Or 9 des series retenues en dependent : PPI, production industrielle, ventes au detail, balance commerciale/exports, confiance des menages, ESI + confiances industrie/services, salaires, prix du logement, et l'IPCH en glissement annuel. Il faut ajouter ec.europa.eu, sinon ces indicateurs sont inaccessibles : FRED est mort dessus (OCDE 2023) et le dataflow BCE ICP s'arrete a 2025-12. api.stlouisfed.org passe deja par le proxy /fredapi existant.  CONVENTION DE DATE ET DE FRAICHEUR — derniereObs est datee au DEBUT de periode (convention FRED et Eurostat) : T2 2026 s'ecrit 2026-04-01, aout 2026 s'ecrit 2026-08-01. Le champ fraiche est evalue sur la FIN de periode (T2 2026 -> 2026-06-30, soit 2,2 mois : frais). Sans cela le PIB T2 paraitrait vieux de 5 mois. Seul le logement est marque fraiche=false : dernier point T1 2026, fin de periode 2026-03-31 = 5,2 mois — c'est le delai structurel de l'indice des prix des logements (T2 attendu debut octobre), pas une serie abandonnee.  PIEGES RENCONTRES (verifies, pas supposes) : 1. FRED / OCDE Main Economic Indicators : massacre confirme. Chomage LRHUTTTTEZM156S s'arrete a 2023-01, PPI PIEAMP01EZM661N a 2022-12, exports XTEXVA01EZM664S a 2023-04, production EA19PRINTO01GYSAM et ventes EA19SLRTTO01GPSAM a 2023-10. Aucune n'est utilisable. Signature a fuir : LR*, LF*, PRINTO*, SLRTTO*, XTEXVA01EZ*, CSCICP*, suffixes 656N/659N/661S. 2. Piege plus vicieux : CSCICP02EZM460S (confiance des consommateurs OCDE sur FRED) a l'air vivant (obs 2026-01, maj 2026-02-16) mais est gele depuis fevrier 2026 — 7 mois de retard. Ne pas l'utiliser : la confiance des menages passe par Eurostat ei_bsco_m (2026-08). 3. FRED M2 zone euro (MYAGM2EZM196N) s'arrete en 2017. La seule source vivante est la BCE (BSI). 4. Ce qui SURVIT sur FRED pour la zone euro : les series alimentees par Eurostat (IPCH *M086NEST, comptes nationaux CLVMNACSCAB1GQ*) et par la BRI (QXMN628BIS, NBXMBIS/RBXMBIS), plus DEXUSEU. Tout le reste est perime. 5. Eurostat : le code geo de la zone euro est desormais EA21 (Bulgarie incluse). EA19/EA20 ne renvoient plus rien sur les jeux courants — la requete repond HTTP 200 avec un objet 'value' VIDE, elle n'echoue pas. Toujours verifier la presence d'observations, pas seulement le code HTTP. 6. Eurostat a rebase l'IPCH en 2025=100 et migre vers ECOICOP v2 : prc_hicp_midx et prc_hicp_manr sont ARCHIVES (fin 2025-12, derniere maj 2026-02-06). Le jeu vivant est prc_hicp_minr (dimension coicop18, valeurs TOTAL et TOT_X_NRG_FOOD pour le core, unit I25 / RCH_A), a jour au 2026-08. Le catalogue https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=en (1,9 Mo) est le moyen fiable de trouver les codes courants. 7. Corollaire cote BCE : le dataflow ICP s'arrete lui aussi a 2025-12 (teste sur M.U2.N.000000.4.ANR, .XEF000.4.ANR, .IN

</details>

## UK

| Indicateur | Source | Identifiant | Fréq. | Unités | Dernière obs. | Clé | État |
|---|---|---|---|---|---|---|---|
| Balance commerciale (biens et services) | ONS | `IKBJ` | Monthly | £m (prix courants, desaisonnalise) | 2026-06-01 | — | ✅ |
| CPI / inflation IPC (glissement annuel) | ONS | `D7G7` | Monthly | % | 2026-07-01 | — | ✅ |
| CPI / inflation IPC (indice) | ONS | `D7BT` | Monthly | Index, base year = 100 (2015=100) | 2026-07-01 | — | ✅ |
| Chomage (taux) | ONS | `BCJE` | Monthly | % | 2026-07-01 | — | ✅ |
| Confiance des menages / sentiment consommateur | FRED | `CSCICP02GBM460S` | Monthly | Percentage balance | 2026-06-01 | oui | ✅ |
| Exports (total biens et services) | ONS | `IKBH` | Monthly | £m (prix courants, desaisonnalise) | 2026-06-01 | — | ✅ |
| Inflation sous-jacente (core CPI) | ONS | `DKO8` | Monthly | % | 2026-07-01 | — | ✅ |
| Logement (prix immobilier) | autre | `ukhpi/region/united-kingdom` | Monthly | £ (averagePrice) ; indice (base non renseignee par l'API) ; % (variations) | 2026-06-01 | — | ✅ |
| Masse monetaire M2 (au UK : M4, glissement annuel) | autre | `LPMVQJW` | Monthly | % (glissement annuel), desaisonnalise | 2026-07-31 | — | ✅ |
| Masse monetaire M2 (au UK : M4, niveau) | autre | `LPMAUYN` | Monthly | Millions de livres sterling (M£), desaisonnalise | 2026-07-31 | — | ✅ |
| PIB (niveau reel) | ONS | `ECY2` | Monthly | Indice (volumes chaines, corriges des variations saisonnieres) | 2026-06-01 | — | ✅ |
| PIB (proxy mensuel, plus haute frequence) | ONS | `ECY2` | Monthly | Indice, volumes chaines, desaisonnalise (base non renseignee par l'API) | 2026-06-01 | — | ✅ |
| PPI / prix a la production (input) | ONS | `GHIP` | Monthly | Indice 2015=100 (champ 'unit' vide dans l'API ; base lue dans le titre) | 2026-07-01 | — | ✅ |
| PPI / prix a la production (output) | ONS | `GD6Y` | Monthly | Indice 2015=100 (champ 'unit' vide dans l'API ; base lue dans le titre) | 2026-07-01 | — | ✅ |
| Production industrielle | ONS | `K222` | Monthly | Index, base year = 100 | 2026-06-01 | — | ✅ |
| Production industrielle | ONS | `K222` | Monthly | Indice, base year = 100 | 2026-06-01 | — | ✅ |
| Salaires / revenus (croissance) — salaire regulier | ONS | `KAI9` | Monthly | % | 2026-06-01 | — | ✅ |
| Salaires / revenus (croissance) — salaire total (primes incluses) | ONS | `KAC3` | Monthly | % | 2026-06-01 | — | ✅ |
| Taux de change USD (USD par GBP) | FRED | `DEXUSUK` | Daily | U.S. Dollars to One U.K. Pound Sterling | 2026-08-28 | oui | ✅ |
| Taux de change effectif (reel, large) | FRED | `RBGBBIS` | Monthly | Index 2020=100 | 2026-07-01 | oui | ✅ |
| Ventes au detail | ONS | `J5EK` | Monthly | Index, base year = 100 | 2026-07-01 | — | ✅ |
| Ventes au detail — secours FRED, hote deja cable | FRED | `GBRSLRTTO01GYSAM` | Monthly | Growth rate same period previous year (%) | 2026-06-01 | oui | ✅ |

**Sans source gratuite vérifiée :**

- **PMI manufacturier et services** — Toujours introuvable, et le constat de la passe 1 est confirme par de nouvelles verifications en live. Les PMI UK sont produits par S&P Global / CIPS sous licence proprietaire ; aucun agregateur gratuit ne les redistribue. Ajout de cette passe : (a) DBnomics recherche plein texte 'PMI' et 'purchasing managers' -> aucun resultat pertinent, uniquement du bruit ISTAT/Eurostat ; (b) le substitut natur
- **Logement — mises en chantier (housing starts)** — Toujours aucune API. Confirmations nouvelles de cette passe : (a) l'API de recherche ONS api.beta.ons.gov.uk/v1/search avec content_type=timeseries renvoie count=0 pour 'Construction output new housing', 'All new housing construction' et 'MV3X' — la statistique de construction UK n'existe tout simplement pas dans l'API timeseries de l'ONS, elle n'est publiee qu'en fichiers xlsx ; le substitut de r
- **Chomage (taux BIT / LFS) — remplacement d'une source plus fraiche que 2026-05** — Aucun remplacement possible : ce n'est pas un probleme de source mais un plafond de publication. L'ONS lui-meme n'a pas de donnee posterieure a mai 2026 (le point 2026-06 vaut litteralement 'NA' dans le JSON), verifie a la fois sur l'API ONS directe et sur le miroir DBnomics ONS/LMS/MGSX. La variante trimestrielle MGSX.Q va jusqu'a 2026-Q2, ce qui donne un horodatage 2026-04-01, soit PIRE que le m
- **PIB (croissance trimestrielle) — remplacement d'une source plus fraiche que 2026-Q2** — Aucun remplacement possible, plafond de publication et non defaut de source. Verifie sur deux datasets ONS distincts : ONS/QNA/IHYQ s'arrete a 2026-Q1, ONS/PN2/IHYQ ('GDP first quarterly estimate', la publication la plus precoce) va jusqu'a 2026-Q2 = 0,4 %, soit exactement l'horodatage 2026-04-01 de la passe 1. Le T3 2026 n'existe encore nulle part. Consequence pratique : la regle des 4 mois penal
- **Logement (prix immobilier) — remplacement du secours FRED/QGBN628BIS (2026-01)** — Aucun secours API plus frais trouve. QGBN628BIS est la serie BIS des prix residentiels, trimestrielle et publiee avec un long delai — inutilisable comme indicateur frais. Les deux alternatives mensuelles britanniques a haute frequence, Nationwide House Price Index et Halifax House Price Index, ne sont diffusees qu'en fichiers xlsx sans endpoint JSON/CSV stable, donc non verifiables par curl et non

<details><summary>Notes de recensement (pièges, quotas, séries discontinuées)</summary>

DECOUVERTE / PIEGES RENCONTRES (tout ce qui suit a ete constate en live le 2026-09-06).  1) FRED est PERIME pour les prix UK. Constate par curl : GBRCPIALLMINMEI (CPI indice) s'arrete au 2025-03 ; CPGRLE01GBM659N (core CPI GA) au 2025-03 ; GBRPPDMMINMEI (PPI manufacturier) au 2022-12 ; MABMM402GBM189S (M4) est marque DISCONTINUED et s'arrete en 2013. Ce sont les ex-series OCDE MEI restructurees. FRED reste bon pour : FX (DEXUSUK quotidien), taux de change effectif reel (RBGBBIS), confiance des menages (CSCICP02GBM460S), et les nouveaux identifiants OCDE de forme GBR...GPSAM / GYSAM (production, ventes au detail) — mais ceux-ci sont des TAUX DE CROISSANCE, pas des indices.  2) ONS : l'ancienne API api.ons.gov.uk est MORTE — elle renvoie HTTP 404 avec le texte "This API has been decommissioned ... fully retired on 25/11/2024". La forme qui marche est https://www.ons.gov.uk/<chemin-theme>/timeseries/<cdid>/<dataset>/data. Le chemin generique sans theme (www.ons.gov.uk/timeseries/...) renvoie 404 : il FAUT le bon prefixe thematique par serie (economy/inflationandpriceindices, employmentandlabourmarket/..., businessindustryandtrade/retailindustry, etc.).  3) Outil de decouverte des CDID ONS : https://api.beta.ons.gov.uk/v1/search?content_type=timeseries&limit=20&q=<termes> — renvoie item.cdid, item.dataset_id, item.uri, item.release_date. Indispensable pour trouver les identifiants (aucun ne s'invente). C'est un hote de DECOUVERTE, pas un hote runtime : il n'est pas dans hotesUtilises.  4) Format JSON ONS : la reponse contient months[], quarters[] ET years[] simultanement (historique complet, aucun filtre de date possible -> payload lourd, D7BT = 463 points mensuels). Les dates sont "2026 JUL" / "2026 Q2" -> a parser. Le champ "unit" est souvent VIDE (GD6Y, GHIP, ECY2) et "seasonalAdjustment" vaut toujours None meme pour des series SA : l'information est dans le titre. Chaque observation porte son propre updateDate.  5) PIEGE DE DATATION MGSX (chomage) : les updateDate montrent 2026 MAR->17/06, 2026 APR->20/07, 2026 MAY->17/08. L'ONS date donc le trimestre glissant par son MOIS CENTRAL : "2026 MAY" = periode avril-juin 2026. A l'inverse, les series AWE (KAI9/KAC3) du meme dataset lms datent par le DERNIER mois : "2026 JUN" = avril-juin 2026. Deux conventions differentes dans le meme dataset. J'ai garde derniereObs = la date API telle quelle (2026-05-01 pour MGSX) et donc fraiche=false au sens litteral de la regle (4 mois avant le 06/09 = 06/05), mais la donnee est en realite fraiche (publiee le 17/08/2026 et couvrant juin). Meme effet mecanique sur les series trimestrielles (ABMI/IHYQ : T2 2026 -> derniereObs 2026-04-01 -> false) et sur GBRPRINTO01GPSAM (2026-05-01 -> false).  6) Bank of England IADB (hote www.bankofengland.co.uk) : le CSV marche sans cle. Astuce : CSVF=TT + VFD=Y ajoute en tete un bloc SERIES,DESCRIPTION qui donne le libelle officiel des codes — c'est le seul moyen de verifier qu'un code est bien ce qu'on croit. Avec Dateto=now, la d

</details>

## JP

| Indicateur | Source | Identifiant | Fréq. | Unités | Dernière obs. | Clé | État |
|---|---|---|---|---|---|---|---|
| Balance commerciale | FRED | `XTNTVA01JPM667S` | Monthly | USD (converti au taux de change), desaisonnalise | 2026-06-01 | oui | ✅ |
| CPI / inflation IPC (glissement annuel) | OECD | `JPN.M.N.CPI.PA._T.N.GY (dataflow OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0)` | Monthly | % en glissement annuel | 2026-07-01 | — | ✅ |
| CPI / inflation IPC (indice + glissement annuel) | autre | `JPN.CPI._T.IX.M et JPN.CPI._T.YOY_PCH_PA_PT.M (FMI, dataflow IMF.STA,CPI,5.0.0)` | Monthly | Indice base 2020=100 ; et % glissement annuel pour la cle YOY_PCH_PA_PT | 2026-06-01 | — | ✅ |
| CPI / inflation IPC (indice) | OECD | `JPN.M.N.CPI.IX._T.N._Z (dataflow OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0)` | Monthly | Indice (non desaisonnalise ; variante SA disponible sous ..._T.S._Z) | 2026-07-01 | — | ✅ |
| CPI / inflation IPC (indice) | DBnomics | `STATJP/CPIm/001` | Monthly | Indice (base non exposee par l API, champ unit vide) | 2026-07-01 | — | ✅ |
| Chomage (taux) | FRED | `LRHUTTTTJPM156S` | Monthly | %, desaisonnalise | 2026-06-01 | oui | ✅ |
| Chomage (taux) | OECD | `JPN.M.UNEMP.PT_LF._T.Y._Z (dataflow OECD.SDD.STES,DSD_KEI@DF_KEI,4.0)` | Monthly | % de la population active, desaisonnalise | 2026-07-01 | — | ✅ |
| Confiance des menages / sentiment consommateur | OECD | `JPN.M.CCICP.PB._Z.Y._Z (dataflow OECD.SDD.STES,DSD_KEI@DF_KEI,4.0)` | Monthly | Solde d opinion (percentage balance), desaisonnalise | 2026-08-01 | — | ✅ |
| Confiance des menages / sentiment consommateur | FRED | `CSCICP02JPM460S` | Monthly | Solde d opinion (percentage balance) | 2026-06-01 | oui | ✅ |
| Exports (marchandises) | FRED | `XTEXVA01JPM667S` | Monthly | USD (converti au taux de change), desaisonnalise | 2026-06-01 | oui | ✅ |
| Exports (marchandises) | OECD | `JPN.M.EX.USD._T.Y._Z et JPN.M.EX.GR._T.Y.GY (dataflow OECD.SDD.STES,DSD_KEI@DF_KEI,4.0)` | Monthly | Milliards de USD (niveau) ; % glissement annuel pour la cle GR...GY | 2026-07-01 | — | ✅ |
| Inflation sous-jacente (core CPI, definition OCDE : hors alimentation et energie) | OECD | `JPN.M.N.CPI.PA._TXCP01_NRG.N.GY (dataflow OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0)` | Monthly | % en glissement annuel | 2026-07-01 | — | ✅ |
| Inflation sous-jacente (core CPI, definition japonaise officielle : hors produits frais) | DBnomics | `STATJP/CPIm/733` | Monthly | Indice (base non exposee par l API) | 2026-07-01 | — | ✅ |
| Inflation sous-jacente (core-core japonais : hors produits frais et energie) | DBnomics | `STATJP/CPIm/740` | Monthly | Indice (base non exposee par l API) | 2026-07-01 | — | ✅ |
| Logement (mises en chantier) | OECD | `JPN.M.WSDW.IX.F41.Y._Z._Z.N (dataflow OECD.SDD.STES,DSD_STES@DF_INDSERV,4.3)` | Monthly | Indice, desaisonnalise (variante brute : JPN.M.WSDW.IX.F41.N._Z._Z.N) | 2026-06-01 | — | ✅ |
| Masse monetaire (M3, complement) | OECD | `JPN.M.MABM.GR._Z.Y.GY (glissement annuel) et JPN.M.MABM.IX._Z.Y._Z (indice), dataflow OECD.SDD.STES,DSD_KEI@DF_KEI,4.0` | Monthly | % en glissement annuel (ou indice), desaisonnalise | 2026-07-01 | — | ✅ |
| Masse monetaire M2 | BOJ | `MD02'MAM1NAM2M2MO (niveau) et MD02'MAM1YAM2M2MO (glissement annuel)` | Monthly | 億円 (100 millions de yens) pour le niveau ; % en glissement annuel pour la colonne YA | 2026-07-01 | — | ✅ |
| Masse monetaire M2 | autre | `0702010200000010010` | Monthly | 100 million yen (serie brute / Original Series) | 2026-07-01 | — | ✅ |
| Masse monetaire M2 | autre | `0702010200000030010` | Monthly | % | 2026-07-01 | — | ✅ |
| PIB (croissance trimestrielle et annuelle) | OECD | `JPN.Q.B1GQ_Q.GR._T.Y.G1 (trimestre/trimestre) et JPN.Q.B1GQ_Q.GR._T.Y.GY (glissement annuel), dataflow OECD.SDD.STES,DSD_KEI@DF_KEI,4.0` | Quarterly | % de variation, desaisonnalise | 2026-04-01 | — | ✅ |
| PIB (niveau reel) | FRED | `JPNRGDPEXP` | Quarterly | Milliards de yens chaines 2015, desaisonnalise | 2026-04-01 | oui | ✅ |
| PMI manufacturier et services (SUBSTITUT : indice composite avance/coincident, pas un PMI) | autre | `0706010500000090010` | Monthly | indice (2020=100) ; champ @unit vide dans l API | 2026-06-01 | — | ✅ |
| PMI manufacturier et services (SUBSTITUT : indice composite avance/coincident, pas un PMI) | autre | `0706010500000090020` | Monthly | indice (2020=100) ; champ @unit vide dans l API | 2026-06-01 | — | ✅ |
| PMI manufacturier et services - SUBSTITUT (enquete de conjoncture, trimestriel, base Tankan) | OECD | `JPN.Q.BCICP.PB.C.Y._Z._Z.N (dataflow OECD.SDD.STES,DSD_STES@DF_BTS,4.0)` | Quarterly | Solde d opinion (percentage balance) | 2026-04-01 | — | ✅ |
| PMI services (SUBSTITUT trimestriel : solde d opinion Tankan sur les services) | FRED | `JPNBVBUTE02STSAQ` | Quarterly | Percentage balance (solde d opinion) | 2026-04-01 | oui | ⚠️ périmée |
| PPI / prix a la production | BOJ | `PR01'PRCG20_2200000000 (indice) et PR01'PRCG20_2200000000% (glissement annuel)` | Monthly | Indice base 2020=100 ; et % en glissement annuel | 2026-07-01 | — | ✅ |
| PPI / prix a la production | autre | `0703040400000030010` | Monthly | % | 2026-07-01 | — | ✅ |
| PPI / prix a la production | autre | `0703040400000090010` | Monthly | indice (2020=100) ; champ @unit vide dans l API | 2026-07-01 | — | ✅ |
| Production industrielle (glissement annuel) | FRED | `JPNPRINTO01GYSAM` | Monthly | % en glissement annuel, desaisonnalise | 2026-05-01 | oui | ✅ |
| Production industrielle (indice) | OECD | `JPN.M.PRVM.IX.BTE.Y._Z._Z.N (dataflow OECD.SDD.STES,DSD_STES@DF_INDSERV,4.3)` | Monthly | Indice, desaisonnalise (ADJUSTMENT=Y ; variante brute sous ...N._Z._Z.N) | 2026-06-01 | — | ✅ |
| Salaires / revenus (croissance) | OECD | `JPN.M.H_EARN.GR.C.Y.GY (glissement annuel) et JPN.M.H_EARN.IX.C.Y._Z (indice), dataflow OECD.SDD.STES,DSD_KEI@DF_KEI,4.0` | Monthly | % en glissement annuel (ou indice), desaisonnalise | 2026-06-01 | — | ✅ |
| Salaires / revenus - ensemble de l economie | autre | `0302020000000030000` | Monthly | % | 2026-06-01 | — | ✅ |
| Taux de change USD/JPY | FRED | `DEXJPUS` | Daily | Yens pour 1 USD | 2026-08-28 | oui | ✅ |
| Taux de change effectif | FRED | `RBJPBIS` | Monthly | Indice 2020=100 | 2026-07-01 | oui | ✅ |
| Ventes au detail (glissement annuel) | FRED | `JPNSLRTTO01GYSAM` | Monthly | % en glissement annuel, desaisonnalise | 2026-05-01 | oui | ✅ |
| Ventes au detail (indice de volume) | OECD | `JPN.M.TOVM.IX.G47.Y._Z._Z.N (dataflow OECD.SDD.STES,DSD_STES@DF_INDSERV,4.3)` | Monthly | Indice, desaisonnalise | 2026-06-01 | — | ✅ |

**Sans source gratuite vérifiée :**

- **Prix immobilier - serie fraiche** — Toujours introuvable en gratuit et frais. (1) reinfolib.mlit.go.jp/ex-api/external/XIT001 renvoie HTTP 401 : cle d abonnement obligatoire. (2) La page MLIT de l indice des prix immobiliers (www.mlit.go.jp/totikensangyo/totikensangyo_tk5_000085.html, HTTP 200) ne diffuse que des .xlsx aux identifiants opaques qui changent a chaque publication (ex. /totikensangyo/content/001742351.xlsx) : pas de for
- **PMI manufacturier et services (vrai PMI, ou Economy Watchers Survey mensuel)** — Le PMI au Jibun Bank reste proprietaire S&P Global. La piste Economy Watchers Survey a ete exploree et fermee : le Cabinet Office publie bien un communique mensuel (dernier : www5.cao.go.jp/keizai3/2026/0810watcher/menu.html, HTTP 200, donnees de juillet 2026), mais les deux seuls fichiers CSV de la publication (watcher4.csv et watcher5.csv, cp932) contiennent les commentaires QUALITATIFS des enqu

<details><summary>Notes de recensement (pièges, quotas, séries discontinuées)</summary>

CONVENTION DE FRAICHEUR : "fraiche" est calculee sur la FIN de la periode couverte (une obs mensuelle 2026-05 se termine le 2026-05-31 -> 3,2 mois avant le 2026-09-06 -> true ; une obs trimestrielle 2026-Q2 se termine le 2026-06-30 -> true). Le champ derniereObs contient la date de DEBUT de periode telle que renvoyee par l API (FRED renvoie 2026-04-01 pour le T2 2026). Sans cette convention, tout ce qui est trimestriel et tout ce qui date de mai 2026 basculerait mecaniquement a false alors que c est la derniere publication disponible.  PIEGE MAJEUR CONFIRME - les identifiants FRED Japon issus des OECD Main Economic Indicators sont MORTS : JPNCPIALLMINMEI / CPALTT01JPM661S / CPALTT01JPM659N / JPNCPICORMINMEI s arretent tous au 2021-06 (derniere maj 2024-05-15) ; MYAGM2JPM189S et MYAGM1JPM189S s arretent au 2017-02 ; MABMM201JPM189S est explicitement (DISCONTINUED) en 2013 ; JPNPROINDMISMEI s arrete au 2024-03 ; JPNSLRTTO02IXOBSAM au 2023-10 ; JPNPPDMMINMEI / PIEATI02JPM661N (PPI) au 2022-12 ; CSCICP03JPM665S au 2024-01 ; JPNPERMITMISMEI (logement) est DISCONTINUED depuis 2008. Ne JAMAIS reprendre ces ids depuis une doc ancienne. AUCUNE serie CPI, PPI ou M2 japonaise fraiche n existe sur FRED aujourd hui.  Ce qui SURVIT sur FRED pour le Japon : (a) la famille "Infra-Annual Labor Statistics" (LRHUTTTTJPM156S etc., fraiche a 2026-06) ; (b) la famille de taux de croissance JPN<code>GYSAM / GPSAM (JPNPRINTO01GYSAM, JPNSLRTTO01GYSAM) - attention, ces series n existent QU EN TAUX DE CROISSANCE, il n y a aucun niveau d indice associe (JPNPRINTO01IXOBSAM et JPNSLRTTO01IXOBSAM n existent pas) ; (c) le commerce exterieur XTEXVA01/XTIMVA01/XTNTVA01 JPM667S (2026-06) ; (d) les changes DEXJPUS et RBJPBIS/RNJPBIS.  PIEGE sdmx.oecd.org - RATE LIMIT AGRESSIF. Apres environ 14 requetes rapprochees, l API renvoie HTTP 429 ("You have exceeded the number of requests for data downloads"), et le deblocage ne s est pas produit apres 5 minutes de retry. Consequence pratique pour AXIOM : espacer largement les appels OECD, mettre en cache, et regrouper les series d un meme dataflow en UNE requete "cle large" (ex JPN.M..... ramene 101 series d un coup). Les urlExacte que je reporte pour l OECD sont les requetes lot que j ai reellement curl-ees en 200 avec observations reelles ; la forme cle-unique (ex .../JPN.M.N.CPI.IX._T.N._Z) est valide sur le meme dataflow mais n a pas pu etre re-verifiee individuellement a cause du 429 : le seriesId complet est indique dans le champ seriesId.  api.imf.org (DEJA EN WHITELIST AXIOM) : le dataflow IMF.STA,CPI,5.0.0 donne le CPI japonais avec des cles propres et stables (JPN.CPI._T.IX.M et JPN.CPI._T.YOY_PCH_PA_PT.M), verifie 200 avec observations jusqu au 2026-06, base 2020=100. C est l alternative la plus simple a integrer puisque l hote est deja autorise. En revanche IMF.STA,PPI,3.0.0 ne contient AUCUNE donnee Japon (teste avec JPN, JP et 158 : 0 observation a chaque fois, seuls les Group vides reviennent) - le Japon ne transmet pas de P

</details>

## CN

| Indicateur | Source | Identifiant | Fréq. | Unités | Dernière obs. | Clé | État |
|---|---|---|---|---|---|---|---|
| Balance commerciale | FRED | `XTNTVA01CNM667S` | Monthly | US dollars, exchange rate converted (desaisonnalise) | 2026-06-01 | oui | ✅ |
| CPI / inflation IPC (glissement annuel) | OECD | `CHN.M.CP.GR._Z._Z.GY (DSD_KEI@DF_KEI 4.0)` | Monthly | pourcentage, glissement annuel | 2026-07-01 | — | ✅ |
| CPI / inflation IPC (indice) | OECD | `CHN.M.CP.IX._Z._Z._Z (DSD_KEI@DF_KEI 4.0)` | Monthly | indice, base 2015=100 (NSA) | 2026-07-01 | — | ✅ |
| CPI / inflation IPC (indice, alternative) | OECD | `CHN.M.N.CPI.IX._T.N._Z (DSD_PRICES@DF_PRICES_ALL 1.0)` | Monthly | indice base 2015=100 ; contient aussi PA/GY (glissement annuel) et PC/G1 (variation mensuelle) | 2026-07-01 | — | ✅ |
| Confiance des menages (alternative FRED) | OECD | `OECD.SDD.STES:DSD_STES@DF_CS/CHN.M.CCICP.PB._Z.Y._Z._Z.N` | Monthly | Solde d'opinion en pourcentage (PB), niveau ~89 | 2026-07-01 | — | ✅ |
| Confiance des menages / sentiment consommateur | OECD | `CHN.M.CCICP.PB._Z.Y._Z._Z.N (DSD_STES@DF_CS 4.0)` | Monthly | solde d opinion en pourcentage (desaisonnalise) | 2026-07-01 | — | ✅ |
| Exports | FRED | `XTEXVA01CNM667S` | Monthly | US dollars, exchange rate converted (desaisonnalise) | 2026-06-01 | oui | ✅ |
| Exports (alternative plus fraiche) | OECD | `CHN.M.EX.USD._T.Y._Z (DSD_KEI@DF_KEI 4.0)` | Monthly | milliards de USD (UNIT_MULT=9), desaisonnalise | 2026-07-01 | — | ✅ |
| Inflation (CPI, glissement annuel) | BIS | `BIS:WS_LONG_CPI/M.CN.771` | Monthly | Pourcentage, glissement annuel | 2026-07-01 | — | ✅ |
| Inflation (CPI, glissement annuel) | IMF | `IMF.STA:CPI(5.0.0)/CHN.CPI._T.YOY_PCH_PA_PT.M` | Monthly | Pourcentage, glissement annuel | 2026-07-01 | — | ✅ |
| Inflation sous-jacente (core CPI) | WorldBank | `WB/GEM(source=15)/CHN/CORENS` | Monthly | Indice (niveau ~124) | 2026-02-01 | — | ⚠️ périmée |
| Logement - mises en chantier | OECD | `OECD.SDD.STES:DSD_STES@DF_INDSERV/CHN.M.PRVM.IX.F.Y._Z._Z.N` | Monthly | Indice, base 2015=100 (CVS-CJO) | 2026-07-01 | — | ✅ |
| Logement - prix immobilier | BIS | `BIS:WS_DPP/M.CN.2.N.2.1.1.0` | Monthly | Indice de prix au m2 (niveau ~105, UNIT_MULT=0) | 2026-06-01 | — | ✅ |
| Logement - prix immobilier | BIS | `BIS:WS_DPP/M.CN.2.8.1.1.1.0` | Monthly | Indice de prix au m2 (niveau ~100, UNIT_MULT=0) | 2026-06-01 | — | ✅ |
| Logement - prix immobilier | BIS | `BIS:WS_SPP/Q.CN.N.771` | Quarterly | Pourcentage, glissement annuel | 2026-01-01 | — | ⚠️ périmée |
| Logement - prix immobilier | BIS | `BIS:WS_SPP/Q.CN.R.771` | Quarterly | Pourcentage, glissement annuel en termes reels (deflate par le CPI) | 2026-01-01 | — | ⚠️ périmée |
| Masse monetaire M2 | OECD | `CHN.M.MABM.XDC._Z.N._Z._Z.N (DSD_STES@DF_MONAGG 4.0)` | Monthly | millions de yuans (UNIT_MULT=6) ; 356 710 800 en 2026-06 = 356,7 mille milliards CNY | 2026-06-01 | — | ✅ |
| Masse monetaire M2 (glissement annuel, alternative) | OECD | `OECD.SDD.STES:DSD_STES@DF_MONAGG/CHN.M.MABM.XDC._Z.N._Z._Z.N` | Monthly | Millions de yuan (XDC, UNIT_MULT=6) | 2026-06-01 | — | ✅ |
| PIB (croissance trimestrielle, glissement annuel) | IMF | `IMF.STA:QNEA(7.0.0)/CHN.B1GQ.Q.NSA.XDC.Q` | Quarterly | Yuan, volume aux prix de reference 2020, non desaisonnalise | 2026-04-01 | — | ⚠️ périmée |
| PMI manufacturier | OECD | `OECD.SDD.STES:DSD_STES@DF_BTS/CHN.M.BCICP.PB.C.Y._Z._Z.N` | Monthly | Solde d'opinion en pourcentage (PB), centre sur 0 | 2026-08-01 | — | ✅ |
| Production industrielle | WorldBank | `WB/GEM(source=15)/CHN/IPTOTSAKD` | Monthly | USD constants (niveau ~7,1e11 par mois) | 2026-02-01 | — | ⚠️ périmée |
| Taux de change USD | FRED | `DEXCHUS` | Daily | CNY pour 1 USD | 2026-08-28 | oui | ✅ |
| Taux de change effectif | FRED | `RBCNBIS` | Monthly | Index 2020=100 (BRI, panier large, reel) | 2026-07-01 | oui | ✅ |

**Sans source gratuite vérifiée :**

- **Chomage (taux)** — Aucun chemin plus frais que le miroir NBS (2026-02) n'existe. Verifie : IMF LS 9.0.0 (CHN.U.PT.M) s'arrete en 2020-M10 ; OECD DSD_LFS@DF_IALFS_UNE_M ne contient AUCUNE serie CHN (num_found=0) ; le KEI OCDE monde-entier pour CHN.M ne contient aucun indicateur de chomage ; World Bank GEM UNEMPSA_ s'arrete en 2021 en annuel et renvoie zero observation mensuelle pour la Chine ; FRED ne propose que LMU
- **PPI / prix a la production** — Aucun chemin plus frais. Verifie : IMF PPI 3.0.0 avec cle CHN.*.*.* renvoie 200 mais ZERO ligne avec COUNTRY=CHN (le FMI ne collecte pas le PPI chinois) ; OECD KEI CHN.A.PP.IX.C._Z._Z s'arrete en 2015 et il n'existe aucune serie PP mensuelle pour CHN ; World Bank GEM n'a pas d'indicateur PPI (les 36 indicateurs de la source 15 ont ete listes) ; FRED CHNPIEATI01GYM s'arrete en 2022-12 (serie OCDE d
- **Ventes au detail** — Aucun chemin plus frais. Verifie : OECD DSD_STES@DF_INDSERV en direct, cle CHN........ complete, ne renvoie que PRVM Construction et TOCAPA immatriculations (arretee en 2018-11) - aucune serie de commerce de detail ; le KEI OCDE mensuel CHN ne contient aucun poste ventes ; World Bank GEM RETSALESSA renvoie 200 mais zero observation pour la Chine (total=0) ; FRED CHNSLRTTO02MLM s'arrete en 2023-10 
- **PMI services / non-manufacturier** — Aucune source gratuite. L'OCDE ne publie de business confidence composite que pour l'activite C (Manufacturing) en Chine - la cle DF_BTS CHN ne renvoie que BCICP.PB.C, il n'existe aucun equivalent services/non-manufacturier. Le PMI non-manufacturier NBS/CFLP et le PMI services Caixin/S&P Global n'ont aucune API publique gratuite. Le miroir NBS/NBS/M_A0B02/A0B0201 (2026-02) reste le seul acces veri
- **Salaires / revenus (croissance)** — Aucun chemin plus frais que 2025-10. Verifie : IMF LS 9.0.0 pour CHN ne contient que E/LF/U/UP en annuel (dernier 2023) et aucune serie de salaires ; le KEI OCDE mensuel CHN ne contient aucun poste salaires ; World Bank GEM n'a pas d'indicateur de salaires parmi ses 36 indicateurs ; les datasets ILO sur DBnomics sont annuels et concernent des estimations modelisees. Le miroir NBS/NBS/Q_A0501/A0501

<details><summary>Notes de recensement (pièges, quotas, séries discontinuées)</summary>

POINT LE PLUS IMPORTANT — sdmx.oecd.org n est PAS dans la whitelist du proxy AXIOM, et c est pourtant le SEUL chemin gratuit FRAIS pour la Chine (CPI 2026-07, PIB 2026-Q2, M2 2026-06, confiance conso 2026-07, exports 2026-07). Sans cet hote, la Chine se reduit a 5 series FRED fraiches (commerce, FX, REER) plus des donnees NBS vieilles de 7 mois. api.db.nomics.world non plus n est pas en whitelist.  FRED est quasi mort pour la macro chinoise. Recense via fred/tags/series?tag_names=china (1046 series, 1000 recuperees triees par last_updated) : hors indices NASDAQ et flux de portefeuille TIC, il ne reste vivant en 2026 que le commerce de marchandises (XT*01CN*, 2026-06), les taux de change (DEXCHUS/EXCHUS/NBCNBIS/RBCNBIS), la confiance conso OCDE (2026-05), le CLI OCDE (2026-06), les prix immobiliers BRI (2026-Q1) et les taux interbancaires. TOUT le reste vient des OECD Main Economic Indicators et est perime : CHNCPIALLMINMEI s arrete en 2025-04, CHNPIEATI01GYM (PPI) en 2022-12, CHNPRINTO01IXPYM (production industrielle) en 2023-11, CHNSLRTTO02MLM (ventes au detail) en 2023-10, MYAGM2CNM189N (M2) en 2019-08, MABMM201CN* explicitement DISCONTINUED en 2013, LMUNRRTTCNQ156S (chomage) en 2011. Ne PAS reutiliser ces identifiants.  Le miroir NBS de DBnomics (provider NBS, 3150 datasets, prefixes M_/Q_/A_) est excellent en couverture — c est la seule PMI gratuite au monde, plus le chomage enquete urbain, le core CPI, le PPI, la valeur ajoutee industrielle, les ventes au detail, l immobilier, les revenus — mais il est GELE : indexed_at = 2026-03-08 sur tous les datasets testes, derniere observation 2026-02 (2025-Q4 pour le trimestriel). Aucun chemin plus frais trouve.  Hotes essayes et ECHOUES (a ne pas remettre en whitelist) : data.stats.gov.cn -> HTTP 403 "UrlACL" avec User-Agent navigateur, sur /easyquery.htm comme sur /english/easyquery.htm (400) ; rplumber.ilo.org -> HTTP 200 mais corps vide (0 octet) sur toutes les variantes ; sdmx.ilo.org -> le /rest/dataflow marche (1212 dataflows) mais /rest/data renvoie une erreur Oracle ORA-00936, l API de donnees est cassee ; api.imf.org -> /external/sdmx/2.1/dataflow repond 200 en XML mais /external/sdmx/2.0/service/data/IMF.STA,CPI/... renvoie 404 (je n ai teste qu un seul chemin de donnees, l API IMF meriterait une exploration dediee) ; api.dbnomics.world (sans point) ne resout pas — le bon hote est api.db.nomics.world.  QUOTA OCDE — piege serieux : sdmx.oecd.org renvoie HTTP 429 apres ~10-12 requetes en 2 minutes, avec une periode de refroidissement de plusieurs minutes (une pause de 150 s n a pas suffi). Strategie recommandee pour AXIOM : UNE seule requete joker par rafraichissement, CHN.M...... pour DSD_KEI@DF_KEI qui renvoie d un coup les 20 mesures mensuelles (CPI indice + m/m + a/a, exports, imports, taux, CLI, prix des actions, FX), et CHN.Q...... pour le trimestriel. Il faut aussi envoyer l en-tete "Accept: application/vnd.sdmx.data+csv" sinon l endpoint renvoie du SDMX-XML lourd. Le nombre de points 

</details>

## Inde (IN)

| Indicateur | Source | Identifiant | Fréq. | Unités | Dernière obs. | Clé | État |
|---|---|---|---|---|---|---|---|
| Balance commerciale / exports | OECD | `IND.M.EX.USD._T.Y._Z` | Monthly | MILLIARDS de USD, desaisonnalise (UNIT_MULT=Billions ; 44,79 Md USD en 2026-07) | 2026-07-01 | — | ✅ |
| Balance commerciale / exports | OECD | `IND.M.IM.USD._T.Y._Z` | Monthly | MILLIARDS de USD, desaisonnalise (UNIT_MULT=Billions ; 74,15 Md USD en 2026-07) | 2026-07-01 | — | ✅ |
| Balance commerciale / exports | FRED | `VALEXPINM052N` | Monthly | MILLIONS de USD, brut non desaisonnalise (40 414 M USD en 2026-06) | 2026-06-01 | oui | ✅ |
| Balance commerciale / exports | FRED | `VALIMPINM052N` | Monthly | MILLIONS de USD, brut non desaisonnalise (70 842 M USD en 2026-06) | 2026-06-01 | oui | ✅ |
| CPI / inflation IPC (glissement annuel) | OECD | `IND.M.N.CPI.PA._T.N.GY` | Monthly | Pourcent par an (glissement annuel ; 4,57 % en 2026-07) | 2026-07-01 | — | ✅ |
| CPI / inflation IPC (indice) | OECD | `IND.M.N.CPI.IX._T.N._Z` | Monthly | Indice, non desaisonnalise (derniere valeur 168,79 en 2026-07) | 2026-07-01 | — | ✅ |
| Chomage (taux) | autre | `MOSPI eSankhyiki / plfs.getData (indicator_code=3, frequency_code=3)` | Monthly | % | 2026-07-01 | — | ✅ |
| Masse monetaire M2 | OECD | `IND.M.MABM.XDC._Z.N._Z._Z.N` | Monthly | MILLIONS de roupies (UNIT_MULT=Millions confirme ; 322 778 100 M INR en 2026-07) | 2026-07-01 | — | ✅ |
| Masse monetaire M2 | OECD | `IND.M.MANM.XDC._Z.N._Z._Z.N` | Monthly | MILLIONS de roupies (UNIT_MULT=Millions ; 78 942 860 M INR en 2026-07) | 2026-07-01 | — | ✅ |
| PIB (croissance trimestrielle) | autre | `MOSPI eSankhyiki / nas.getNASData (indicator_code=22, frequency_code=Quarterly)` | Quarterly | % (croissance annuelle ; constant_price = en volume, current_price = en valeur) | 2026-04-01 | — | ⚠️ périmée |
| PIB (niveau reel) | autre | `MOSPI eSankhyiki / nas.getNASData (indicator_code=5, frequency_code=Quarterly)` | Quarterly | crore de roupies (champ constant_price = prix constants, current_price = prix courants) | 2026-04-01 | — | ⚠️ périmée |
| PMI manufacturier et services | DBnomics | `OECD/DSD_STES@DF_CLI/IND.M.LI.IX._Z.AA.IX._Z.H` | Monthly | Indice (amplitude ajustee, 100 = tendance de long terme) | 2026-05-01 | — | ✅ |
| PPI / prix a la production | autre | `MOSPI eSankhyiki / wpi.getWpiRecords (base_year=2022-23)` | Monthly | Indice base 2022-23=100 | 2026-07-01 | — | ✅ |
| Production industrielle | OECD | `IND.M.PRVM.IX.BTE.Y._Z` | Monthly | Indice, desaisonnalise et corrige des jours ouvrables (150,55 en 2026-06 ; UNIT_MULT=Units) | 2026-06-01 | — | ✅ |
| Production industrielle | autre | `MOSPI eSankhyiki / iip.getIIPData (frequency=Monthly, type=General)` | Monthly | Indice base 2022-23=100 (champ index) et variation annuelle en % (champ growth_rate) | 2026-07-01 | — | ✅ |
| Salaires / revenus (croissance) | autre | `MOSPI eSankhyiki / plfs.getData (indicator_code=6, frequency_code=1)` | Annual | roupies par mois | 2025-01-01 | — | ⚠️ périmée |
| Taux de change USD | FRED | `DEXINUS` | Daily | Roupies indiennes pour 1 USD, non desaisonnalise (95,38 au 2026-08-28) | 2026-08-28 | oui | ✅ |
| Taux de change USD | FRED | `EXINUS` | Monthly | Roupies indiennes pour 1 USD, moyenne mensuelle (95,4443 en 2026-08) | 2026-08-01 | oui | ✅ |
| Taux de change effectif | FRED | `RBINBIS` | Monthly | Indice 2020=100, taux de change effectif reel large BIS (90,37 en 2026-07) | 2026-07-01 | oui | ✅ |

**Sans source gratuite vérifiée :**

- **Inflation sous-jacente (core CPI)** — Toujours introuvable en API gratuite. NOUVEAU test cette passe : l API MOSPI /api/cpi/getCPIData?base_year=2024 fonctionne (juillet 2026, champ 'inflation' fourni) mais l enumeration exhaustive des divisions du dernier mois (6 pages de 100 lignes, 68 804 enregistrements au total) ne donne que 13 divisions COICOP-2018 + 'CPI (General)' : AUCUN agregat 'hors alimentation et carburant'. La base 2012 
- **Ventes au detail** — Confirme inexistant. Rien de neuf cette passe : l API MOSPI, exploree exhaustivement via ses specs OpenAPI publiques (cpi, iip, plfs, nas, wpi) et la liste de ses produits (asi, asuse, hces, nss-73 a nss-80, cpialrl, energy, env, gender, rbi, tus, udise, nfhs, aishe, mnre), ne contient aucun indice de ventes au detail — l Inde n en publie pas au niveau national. Le bloc /api/rbi/ d eSankhyiki ne c

<details><summary>Notes de recensement (pièges, quotas, séries discontinuées)</summary>

HOTE A AJOUTER EN WHITELIST : sdmx.oecd.org (non present aujourd hui). Sans lui, ~60% des series fraiches de l Inde tombent. api.imf.org et api.stlouisfed.org sont deja accessibles.  QUOTA OECD (piege majeur) : l API sdmx.oecd.org renvoie du texte brut "You have exceeded the number of requests for data downloads..." (pas du JSON, pas de 429 exploitable) apres ~25-30 appels en quelques minutes. Le quota met ~15 min a se liberer. Il faut donc : 1 serie par appel, >=30 s d intervalle, et un cache cote AXIOM. J ai du faire 3 passes espacees pour tout confirmer en HTTP 200.  PIEGE OECD n2 : une requete MULTI-SERIES (cle avec jokers, ex IND.M.......) renvoie 200 mais TRONQUE silencieusement les observations — la serie M3 apparaissait a 2026-05 en multi alors qu elle va a 2026-07 en appel unitaire. Ne jamais lire une derniere observation depuis une requete jokerisee.  PIEGE OECD n3 : dans le JSON SDMX, la liste TIME_PERIOD n est PAS triee chronologiquement. Il faut trier sur la chaine de periode, pas sur l index d observation, sinon on lit une fausse "derniere valeur".  PIEGE OECD n4 : sdmx.oecd.org repond 403 a python-urllib (filtrage User-Agent). curl passe. Prevoir un User-Agent explicite cote proxy.  PIEGES DE CODES OECD : MEASURE "MANM" = M1 (PAS M3, contrairement a ce que suggere FRED MABMM301) ; "MABM" = monnaie au sens large (M3 indien) ; "RS" = Reference Series du CLI (le PIB), ce n est PAS retail sales. Verifier les codelists avant de mapper.  FRED POUR L INDE : quasiment toutes les series heritees des OECD Main Economic Indicators sont MORTES — CPI (CPALTT01INM659N, INDCPIALLMINMEI) arretees a 2025-03 ; M3 (MABMM301INM189N) a 2023-09 ; production industrielle en indice (INDPRINTO01IXOBM) a 2024-03 ; aucune serie de chomage mensuelle. Ne survivent sur FRED que : le change (DEXINUS/EXINUS), le REER BIS (RBINBIS), les prix immobiliers BIS (QINR628BIS/QINN628BIS), le commerce IMF-IFS (VALEXPINM052N/VALIMPINM052N), le PIB IMF (NGDPRNSAXDCINQ) et la production industrielle en taux (INDPRINTO01GYSAM, encore mise a jour le 2026-08-17). Contre-intuitif : l OECD directe est FRAICHE (CPI a 2026-07) la ou FRED, qui la relaie, est perimee de 16 mois.  DBnomics ECARTE : teste et fonctionnel (api.db.nomics.world v22) mais son ingestion retarde — IMF/CPI Inde indexe le 2025-08-31 (donc ~13 mois de retard, derniere obs 2025-07), OECD prices indexe le 2026-06-16 (derniere obs 2026-04) alors que l OECD directe donne 2026-07. Aucun interet ici, aucun hote supplementaire retenu.  data.gov.in / MOSPI / RBI DBIE : non utilises. data.gov.in exige une cle gratuite dont je ne dispose pas dans ce depot ; RBI DBIE n expose pas d API JSON publique ; le provider MOSPI de DBnomics ne contient que des comptes nationaux ANNUELS (datasets 3.3 a 3.12), inutilisable ici.  CONVENTION TRIMESTRIELLE : derniereObs est note au DEBUT de periode (convention FRED). Consequence mecanique : une serie trimestrielle a jour au 2026-Q2 porte derniereObs 2026-04-01 et ressort donc fraiche=fal

</details>

