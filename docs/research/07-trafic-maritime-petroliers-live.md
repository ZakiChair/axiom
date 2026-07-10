# AXIOM — Trafic maritime & activité pétroliers en live sur un globe (faisabilité)

> **Doc de recherche · 2026-07-10.** Cible : terminal perso mono-utilisateur, budget visé **0 $/mois**, plafond dur **30 $/mois**. Demande initiale : afficher **trafic maritime** + **activité des pétroliers** **EN LIVE** sur un globe dans AXIOM.
> Méthode : vérification **empirique directe** (requêtes HTTP/API réelles via `curl`/fetch, pas seulement lecture de doc marketing) sur les 5 sources demandées + recherche web complémentaire pour le cadrage tarifaire et une 6ᵉ piste trouvée en cours de route (TankerMap.com).
> **Verdict en une phrase :** le tracking AIS individuel gratuit et fiable façon « Flightradar24 des bateaux » **n'existe pas** dans une forme exploitable à 0-30 $/mois avec garantie de service — la seule brique gratuite robuste est un **indice agrégé** (IMF PortWatch), pas des points de navires individuels temps réel garantis.

---

## 1. AISHub (aishub.net) — nécessite de partager son propre flux AIS

| Test | Résultat |
|---|---|
| Page API (`aishub.net/api`) | Webservice REST simple (`data.aishub.net/ws.php?username=...`), formats XML/JSON/CSV, bbox + filtre MMSI/IMO — **mais paramètre `username` obligatoire, délivré uniquement aux membres** |
| Page adhésion (`aishub.net/join-us`) | Texte exact du CGU : **« Every AISHub contributor is required to provide at least one raw AIS feed in NMEA format »**, avec exigences qualité (≥10 navires vus/7j, ≥90% uptime, latence <10s) et clause finale **« Applications without an operational AIS station and feed will not be approved »** |
| Test empirique direct (`curl` avec faux username) | `{"ERROR":true,"USERNAME":"test_fake_user","ERROR_MESSAGE":"Invalid username or password!"}` (HTTP 200) — **confirmé : aucun accès sans compte validé, aucun accès sans antenne** |
| Alternative (dataset gratuit, achat ponctuel, accès observateur) | **Aucune trouvée.** AISHub ne vend rien, ne propose pas de tier « lecture seule » sans contribution, pas de dataset statique téléchargeable en accès public |

**Reco AXIOM :** **Blocage confirmé et définitif.** Sans antenne AIS physique (SDR + réception VHF), AISHub est inaccessible — ni gratuitement, ni contre paiement, ni via un tier dégradé. Ce n'est pas un choix de pricing à discuter, c'est un mur d'accès structurel. **À exclure du scope AXIOM tant qu'aucune antenne n'est déployée.**

---

## 2. aisstream.io — WebSocket AIS gratuit

| Aspect | Constat empirique |
|---|---|
| Modèle | WebSocket unique (`wss://stream.aisstream.io/v0/stream`), abonnement par bounding box(es) + filtres optionnels MMSI (max 50) / types de message, **gratuit** |
| Inscription | Compte requis (GitHub OU autre méthode supportée) pour générer une clé API sur la page « API Keys » — pas de friction matérielle (pas d'antenne à fournir) |
| Statut de service | Page doc affiche verbatim : **« aistream.io is in BETA! We make no guarantees and provide no SLA for the uptime of our service! »** — footer du site toujours à « © 2022 » en 2026, signe d'un projet peu actif visuellement (pas de preuve de maintenance récente affichée) |
| Rate limit | Pas de quota chiffré documenté ; contrainte réelle = bande passante/traitement suffisant pour absorber **~300 messages/seconde si abonné au monde entier** (sinon la queue TCP déborde et la connexion est fermée côté serveur) |
| Couverture | Verbatim page coverage : **« live AIS message feed of roughly 200km off the majority of the world's coastlines »** — stations terrestres uniquement, pas de satellite AIS, donc **rien en haute mer au-delà de ~200km d'une côte** |
| Accès navigateur | **CORS/connexion directe navigateur explicitement non supportée** (doc : « Cross-origin resource sharing... are not supported ») — obligatoire de faire transiter par un backend, comme AXIOM le fait déjà pour ses autres flux (Deribit, CBOE, proxy tradfi) |
| Filtre pétroliers | Message `ShipStaticData` (type AIS standard 5) porte nativement le champ type de navire (`Type`/ship & cargo type) — permet un filtre tanker côté client une fois le flux reçu (champ standard AIS, non re-vérifié sur le schéma OpenAPI exact d'aisstream faute d'endpoint JSON exposé statiquement, mais comportement standard du protocole) |

**Reco AXIOM :** **Seule source de positions AIS individuelles réellement gratuite et fonctionnelle trouvée.** Exploitable techniquement (bbox restreinte aux chokepoints pétroliers = charge raisonnable, pas besoin d'absorber le flux mondial), mais à traiter comme **« best effort », jamais comme garanti** : pas de SLA, statut BETA assumé par l'éditeur lui-même, site peu signalé comme activement maintenu. À utiliser en **couche d'enrichissement visuel** (points qui bougent), pas comme source de vérité contractuelle.

---

## 3. MarineTraffic API — grille tarifaire réelle

| Test | Résultat |
|---|---|
| `marinetraffic.com/en/ais-api-services` | **Redirection 301 confirmée en direct vers `kpler.com/product/maritime/data-services`** — MarineTraffic a été racheté par Kpler et son offre API est fusionnée dans le catalogue Kpler |
| Page Kpler (fetch direct) | 6 produits listés (AIS temps réel, Real-time Events, Predictive Events, Past Events, Ship Database, Custom Extracts) — **aucun prix public affiché, aucun tier gratuit, seul CTA = « Request a demo »** |
| `support.marinetraffic.com` (article plans officiel) | Confirme un compte web **gratuit** (dashboard consommateur), plans payants **Basic / Essential / Enterprise** — mais Enterprise = uniquement via formulaire commercial, et l'API n'est **plus vendue en self-serve par crédits** depuis le rachat |
| Recherche croisée (datadocked.com, comparatifs tiers, 2026) | Confirme : **« MarineTraffic discontinued credit-based pricing, switching to enterprise subscriptions only »** ; retour d'expérience cité : *« Service terminated without notice after Kpler acquisition. Had to pay more »* |

**Reco AXIOM :** **Aucun tier exploitable, à aucun prix public.** L'API MarineTraffic est désormais **100% sales-gated côté Kpler**, sans grille tarifaire self-serve, sans essai gratuit documenté pour l'API. Un compte web gratuit existe mais ne donne **aucun accès API embarquable** dans un terminal tiers. **Hors scope AXIOM.**

---

## 4. VesselFinder API — grille tarifaire réelle

| Test | Résultat |
|---|---|
| `api.vesselfinder.com/docs/` (page officielle pricing, fetch direct) | Système **100% prépayé par crédits**, pas d'abonnement mensuel. Prix exacts affichés : **10 000 crédits = 330 €**, 20 000 = 625 €, 50 000 = 1 470 €. Crédits valables 12 mois. Coût : 1/10 crédit par position AIS terrestre, 1 crédit par position satellite, jusqu'à 3 crédits pour les données `MasterData` |
| Free tier / essai | FAQ officielle : **« Yes, you can request a free trial by reaching out through our Contact Us page »** — pas de tier gratuit permanent, essai sur demande commerciale, durée/volume non publiés |
| Cadrage budget | Le ticket d'entrée minimum (330 €, ≈ 360 $) est un **achat unique, pas un abonnement** — il dépasse à lui seul le plafond mensuel de 30 $ dès le premier mois, et ne se « lisse » pas dans un budget récurrent puisqu'il n'est pas mensuel |

**Reco AXIOM :** **Hors budget dès l'entrée.** Même le palier le plus bas (330 €) représente 12x le plafond mensuel fixé, en paiement unique. Pas d'option d'abonnement mensuel light. **Hors scope AXIOM**, sauf si un jour un achat ponctuel de crédits est budgété hors du fonctionnement récurrent (non recommandé pour un flux qui se veut "live" en continu).

---

## 5. IMF PortWatch (portwatch.imf.org) — indices agrégés chokepoints/ports

**Vérification technique la plus poussée de ce rapport** : PortWatch est un site Esri ArcGIS Hub ; sous l'interface web se cache une **vraie API REST publique sans clé** (ArcGIS FeatureServer), testée en direct avec succès.

| Dataset | URL API testée en direct | Contenu confirmé | Fraîcheur confirmée |
|---|---|---|---|
| **Chokepoints (référence)** | `services9.arcgis.com/weJ1QsnbMYJlCHdG/.../PortWatch_chokepoints_database/FeatureServer` | 28 chokepoints mondiaux, champ **`vessel_count_tanker`** dédié (moyenne annuelle 2019-2024) par chokepoint + `industry_top1/2/3` | Statique (référence pluriannuelle, pas un flux) |
| **Daily_Chokepoints_Data** | `services9.arcgis.com/weJ1QsnbMYJlCHdG/.../Daily_Chokepoints_Data/FeatureServer` | Champs `date`, `n_tanker`, `n_total`, `capacity_tanker` **par jour et par chokepoint** | **Testé en direct le 2026-07-10 : dernier enregistrement disponible = 2026-07-05, soit un retard d'environ 5 jours** — cohérent avec la cadence annoncée « mise à jour hebdomadaire le mardi 9h ET » |
| **Daily_Ports_Data** (item confirmé, non requêté en détail) | `services9.arcgis.com/weJ1QsnbMYJlCHdG/.../Daily_Ports_Data/FeatureServer` | Couverture annoncée : 2065 ports mondiaux, même cadence hebdomadaire | Non vérifié en détail (hors scope prioritaire chokepoints/pétroliers) |
| Accès | Aucune clé API, aucun compte, `access:"public"` confirmé sur les 3 items | — | — |

**Couverture des chokepoints pétroliers stratégiques — confirmée en direct (extrait des 28, tri par volume tanker/an) :**

| Chokepoint | Tanker/an (moyenne 2019-2024) |
|---|---|
| Malacca Strait | 27 469 |
| Dover Strait | 21 126 |
| Strait of Hormuz | 19 540 |
| Bosporus Strait | 8 555 |
| Bab el-Mandeb Strait | 6 424 |
| Suez Canal | 6 418 |
| Panama Canal | 4 507 |
| Gibraltar Strait | 15 666 |

→ **Tous les chokepoints pétroliers majeurs habituellement suivis (Hormuz, Malacca, Bab-el-Mandeb, Suez, Bosphore, Panama, Gibraltar) sont couverts nativement, avec un champ tanker isolé du trafic total.**

**Exemple réel interrogé en direct (Strait of Hormuz, 8 derniers jours avant le 2026-07-05) :**
`n_tanker` observé : 17, 11, 21, 18, 23, 6, 13, 11 — donnée journalière réelle, pas un chiffre marketing arrondi.

**Reco AXIOM :** **C'est la meilleure trouvaille de ce rapport.** Gratuit, sans authentification, format JSON/GeoJSON standard ArcGIS (facile à parser), avec un champ **tanker dédié par jour et par chokepoint** — exactement le proxy « zone critique d'approvisionnement » demandé en repli. Seule réserve, à afficher honnêtement dans l'UI AXIOM : **ce n'est pas du live seconde-par-seconde, c'est un indice à ~5 jours de retard, rafraîchi une fois par semaine.** Ne pas vendre ça comme « live » — le présenter comme **« indice hebdomadaire de congestion/activité pétrolière par chokepoint »**.

---

## 6. Flux pétroliers agrégés gratuits — Vortexa/Kpler vs alternatives

| Source | Nature | Accessible à 0-30 $/mois ? |
|---|---|---|
| **Vortexa** | Cargo tracking + intelligence pétrolière institutionnelle, tarification non publique, orientation trading desk/courtiers | **Non** — aucun tier self-serve trouvé, produit B2B pur |
| **Kpler** (maison-mère de MarineTraffic depuis le rachat) | Même famille que Vortexa : data services maritimes/énergie institutionnels | **Non** — confirmé sales-gated (cf. §3) |
| **Filtrage ship-type sur un flux AIS payant** (VesselFinder, Datalastic, etc.) | Filtrer `TYPE`/vessel_type = tanker sur un flux AIS classique payant | **Non dans ce budget** — cf. §4 (VesselFinder 330 €+) ; **Datalastic** (testé en direct, `datalastic.com/pricing`) confirme un tier « Starter » à **9 € pour 14 jours d'essai puis 199 €/mois** — même le moins cher dépasse 6x le plafond mensuel une fois l'essai terminé |
| **Filtrage ship-type sur aisstream.io** (gratuit) | Filtrer le champ type de navire du flux AIS gratuit d'aisstream.io | **Oui, seule option gratuite légitime** — cf. §2 (mêmes réserves : BETA, no SLA, couverture ~200km côtière) |
| **IMF PortWatch `vessel_count_tanker` / `n_tanker`** | Comptage agrégé de tankers par chokepoint (pas de flux, pas de position individuelle) | **Oui — c'est un indice, pas un tracking**, cf. §5 |
| **TankerMap.com** *(trouvaille annexe, hors des 5 sources demandées)* | Site gratuit tiers non officiel filtrant déjà l'AIS sur les pétroliers (`tankermap.com`, FAQ confirmée : gratuit, sans compte, ~4 100 tankers suivis, rafraîchi « toutes les heures ») | Techniquement oui à l'instant du test, **mais à ne pas retenir comme dépendance** — voir avertissement ci-dessous |

**Avertissement empirique sur TankerMap.com (trouvaille non demandée, testée par curiosité en cours de recherche) :** un endpoint JSON non documenté (`tankermap.com/api/vessels/live`) répond réellement en direct avec des positions individuelles de pétroliers/méthaniers récentes (`observed_at` à quelques minutes), incluant `cargo_state` (chargé/lège) et `deadweight`. C'est, empiriquement, la chose la plus proche d'un « Vortexa gratuit » trouvée dans toute cette recherche. **Mais trois signaux de fragilité désignent clairement de ne pas en faire une dépendance AXIOM :** (1) le `robots.txt` du site exclut explicitement `/api/` pour tous les robots y compris les IA — signal que ce n'est pas conçu pour être consommé par des tiers ; (2) aucune doc publique, aucun ToS autorisant la réutilisation programmatique ; (3) un champ observé (`draught_source":"vesselfinder_html"`) suggère que TankerMap lui-même **scrape le site VesselFinder** pour au moins une partie de ses données — donc une dépendance AXIOM sur TankerMap serait une dépendance à 2 niveaux sur un scraping non garanti, qui peut casser sans préavis si VesselFinder bloque ce scraping. **À citer comme curiosité, pas à brancher en dur.**

**Reco AXIOM :** Aucune source d'« activité pétrolière agrégée » gratuite et pérenne au sens Vortexa/Kpler n'existe. Le repli honnête est un **combo à deux étages** : indice hebdomadaire fiable (PortWatch `n_tanker`) + enrichissement best-effort de points individuels filtrés tanker (aisstream.io), les deux gratuits, aucun des deux garanti à 100%.

---

## Synthèse — ce qui rentre réellement dans le budget AXIOM

| # | Source | Statut budget (0-30 $/mois) | Rôle recommandé dans AXIOM |
|---|---|---|---|
| 1 | AISHub | **Bloqué** (antenne AIS physique obligatoire, aucune alternative) | Aucun — à exclure |
| 2 | aisstream.io | **Gratuit, fonctionnel, sans garantie (BETA)** | Couche « points live » best-effort, bbox restreintes aux chokepoints |
| 3 | MarineTraffic API | **Hors budget à tout prix** (100% sales-gated post-Kpler) | Aucun |
| 4 | VesselFinder API | **Hors budget** (330 €+ à l'achat, pas d'abonnement léger) | Aucun |
| 5 | IMF PortWatch | **Gratuit, sans clé, robuste** | **Source primaire** — indice hebdomadaire trafic/tanker par chokepoint |
| 6 | Vortexa/Kpler (flux pétrolier agrégé institutionnel) | **Hors budget** (B2B pur) | Aucun |
| 6bis | TankerMap.com (bonus) | Gratuit aujourd'hui, **fragile/non garanti/scraping en cascade** | À la rigueur, jamais en dépendance dure |

---

## Reco AXIOM — tranchée

**Le tracking AIS individuel gratuit et fiable de type « points de navires qui bougent en live, garantis » n'existe pas dans ce budget.** Toutes les briques commerciales sérieuses (MarineTraffic/Kpler, VesselFinder, Vortexa) sont soit intégralement sales-gated sans prix public, soit à des tickets d'entrée de 330-1500 € qui pulvérisent le plafond de 30 $/mois dès le premier mois — et ce ne sont même pas des abonnements mensuels lissables, mais des achats de crédits ponctuels. AISHub est un mur dur : sans antenne AIS physique, il n'y a rien à négocier, pas même à prix élevé.

**Implémentation recommandée pour le globe AXIOM, en deux couches empilées :**

1. **Couche de fond — IMF PortWatch (`Daily_Chokepoints_Data` + `PortWatch_chokepoints_database`, gratuit, sans clé, testé en direct).** Afficher pour chacun des 28 chokepoints (avec emphase visuelle sur Hormuz, Malacca, Bab-el-Mandeb, Suez, Bosphore, Panama, Gibraltar) un indicateur `n_tanker` / `n_total` daté, avec un badge explicite **« MAJ hebdomadaire, dernière donnée : J-5 »** — ne jamais afficher ça comme du live seconde-par-seconde, ce serait mentir à l'utilisateur sur la nature de la donnée. C'est robuste, gratuit à vie, et répond directement à « activité des pétroliers dans les zones critiques d'approvisionnement ».

2. **Couche d'enrichissement optionnelle — aisstream.io (gratuit, WebSocket, BETA sans SLA).** Brancher un backend AXIOM (jamais le navigateur directement, CORS bloqué) qui s'abonne à des bounding boxes **restreintes aux chokepoints ci-dessus** (pas au monde entier — évite le besoin de bande passante ~300 msg/s et réduit le risque de déconnexion serveur), filtre côté client sur le type de navire (tanker), et anime des points sur le globe en direct. **Documenter clairement dans l'UI que cette couche est « best effort, sans garantie de service »** — c'est la position honnête de l'éditeur lui-même, pas une prudence excessive d'AXIOM.

**Ne pas faire :** ne pas dépendre d'AISHub (impossible sans antenne), ne pas budgétiser MarineTraffic/VesselFinder/Vortexa (aucun ne rentre, à aucun niveau d'usage réduit), ne pas brancher TankerMap.com en dépendance dure (fragile, non documenté, scraping en cascade sur VesselFinder qui peut casser sans préavis).

**Si le budget évolue un jour au-delà de 30 $/mois :** la marche suivante la moins chère identifiée empiriquement est **Datalastic** (199 €/mois après essai, `datalastic.com/pricing`, testé en direct) — pas dans l'enveloppe actuelle, mais à retenir comme prochaine étape si le produit AXIOM justifie un jour un budget data dédié plus large qu'une antenne personnelle.

---

## Limites de cette recherche

- Le champ ship-type d'aisstream.io (`ShipStaticData`) n'a pas été vérifié sur un schéma JSON exposé — son existence est déduite du standard AIS (message type 5), pas confirmée par fetch direct du schéma OpenAPI d'aisstream (l'endpoint schema n'est pas exposé statiquement sur la page doc).
- `Daily_Ports_Data` (2065 ports) a été confirmé accessible (item ArcGIS public) mais pas requêté en détail — hors scope prioritaire de cette recherche centrée chokepoints/pétroliers.
- TankerMap.com est une trouvaille annexe non demandée dans le périmètre initial ; son fonctionnement a été vérifié à l'instant T (2026-07-10) mais rien ne garantit sa stabilité future (site tiers non officiel, financé par dons).
- Pas de test de charge réel sur aisstream.io (impossible à valider sans compte + usage prolongé) — le seuil « ~300 msg/s pour le monde entier » est celui annoncé par l'éditeur, pas mesuré indépendamment.
- Prix Vortexa non publiés nulle part publiquement (produit 100% sales-gated) — confirmé absent de tarif public plutôt que chiffré précisément.
