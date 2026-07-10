# AXIOM — Trafic aérien live sur un globe : OpenSky / ADS-B Exchange / FlightAware (recensement)

> **Doc de recherche · 2026-07-10.** Cible : afficher un flux de trafic aérien mondial « crédible » sur un globe 3D, terminal perso mono-utilisateur, budget **0–30 $/mois**.
> Méthode : **vérification empirique en direct** (`curl` réel sur les endpoints, pas de supposition) le 2026-07-10, complétée par lecture des pages de tarification/documentation officielles (sources primaires citées). Les 3 sources demandées (OpenSky, ADS-B Exchange, FlightAware AeroAPI) ont chacune été testées ou, pour les tarifs, vérifiées sur la page officielle. Une 4ᵉ famille de sources (mirroirs communautaires gratuits type ADS-B Exchange) a été découverte en cours de recherche et testée en direct — ajoutée car elle change la réponse.

---

## 1. OpenSky Network — REST API `/states/all`

**Test en direct effectué** (`curl`, zéro clé, zéro header d'auth) :
- Requête globale (sans bbox) : **HTTP 200**, 11 358 vecteurs d'état renvoyés, ~1,4 Mo JSON, `time` du payload = 2026-07-10 20:59:53 UTC pour une requête envoyée à 21:00:01 UTC → **fraîcheur ~8–20 s**, cohérent avec la doc (résolution 10 s en anonyme).
- Header `x-rate-limit-remaining` observé : 396 après le 1ᵉʳ appel global, **395** après un appel bbox Suisse (~9 sq°, coût 1 crédit), **391** après un 2ᵉ appel global (coût 4 crédits) → **le barème de coût par crédit documenté est confirmé exact en direct**, pas seulement sur le papier.
- Test de couverture par bbox (même jour, même minute) : **Paris/Île-de-France (bbox ~1 sq°) → 31 avions** ; **Pacifique Sud/Polynésie (bbox ~300 sq°, océan) → 6 avions** ; **Afrique centrale (bbox ~300 sq°) → 2 avions**. Confirme empiriquement le trou de couverture connu (réseau de récepteurs ADS-B **bénévoles**, dense en Europe/Amérique du Nord, clairsemé sur les océans et l'Afrique).

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Catch |
|---|---|---|---|---|---|---|
| **OpenSky `/states/all` — anonyme** | Mondiale, dépend des récepteurs ADS-B **bénévoles** (dense Europe/Am. du Nord, creux océans/Afrique/Moyen-Orient — confirmé empiriquement ci-dessus) | **Aucune** (testé en direct, zéro clé requise) | **400 crédits/jour, par IP** ; coût par appel `/states/all` selon taille bbox : ≤25 sq°=1, 25–100 sq°=2, 100–400 sq°=3, >400 sq° ou global=4 crédits | JSON (tableau de vecteurs d'état : icao24, callsign, pays, lat/lon, altitude, vitesse, cap, on_ground, squawk…) | Résolution figée à **10 s**, uniquement l'instant présent (paramètre `time` ignoré en anonyme) | Budget journalier vite consommé si appel global naïf en boucle : 400÷4 = **100 rafraîchissements globaux/jour max** (~1/14 min) |
| **OpenSky `/states/all` — compte gratuit (inscrit)** | Idem | **OAuth2 client_credentials** (le login/mot de passe classique **n'est plus accepté** — confirmé sur la doc officielle du repo) ; token Bearer, expire au bout de 30 min | **4 000 crédits/jour** (même barème par bbox) ; **8 000/jour** si le compte fait tourner un récepteur actif ≥30 % du mois | Idem | Résolution **5 s**, historique jusqu'à 1 h en arrière disponible | Nécessite gérer un flux OAuth2 (échange client_id/secret → token, refresh <30 min) côté `axiomd` — pas un simple header `api_key` |

**Reco AXIOM :** commencer **anonyme, zéro compte, zéro clé** — c'est la seule des 3 sources demandées qui donne un **instantané mondial en un seul appel** pour 0 $. Mettre en cache côté `axiomd` (TTL 15–30 s type) pour rester large sous 400 crédits/jour, et biaiser vers des appels bbox régionaux (moins chers) plutôt que globaux répétés si le globe affiche une zone zoomée. Créer un compte gratuit (toujours 0 $) dès que le rythme de rafraîchissement voulu dépasse ~100 appels globaux/jour — ça multiplie le budget par 10 (4000/jour) sans dépenser un centime, au prix d'implémenter le flux OAuth2 client_credentials.

**Sources :** doc officielle REST — [openskynetwork.github.io/opensky-api/rest.html](https://openskynetwork.github.io/opensky-api/rest.html), [github.com/openskynetwork/opensky-api/docs/free/rest.rst](https://github.com/openskynetwork/opensky-api/blob/master/docs/free/rest.rst) ; tests `curl` en direct du 2026-07-10 (ci-dessus).

---

## 2. ADS-B Exchange

**Pas de vrai tier gratuit aujourd'hui.** L'ancienne « API Lite » gratuite n'existe plus (confirmé sur la page officielle `adsbexchange.com/community/developer-hub/` — la doc actuelle ne mentionne qu'un accès payant, et plusieurs sources tierces signalent que les références à une API gratuite sont datées). L'accès passe exclusivement par RapidAPI.

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Catch |
|---|---|---|---|---|---|---|
| **ADS-B Exchange — Community API (ex-« API Lite »)**, via RapidAPI | Mondiale, réseau de **25 000+ récepteurs bénévoles** — réputé plus dense qu'OpenSky (réseau distinct, recouvrement partiel) | Clé RapidAPI (compte + carte bancaire) | **$10/mois** pour **10 000 requêtes** (Basic RapidAPI), $0,0015/requête en dépassement, quota bande passante 10 240 Mo puis $0,001/Mo | JSON (position, cap, vitesse, + champs enrichis : squawk, catégorie, etc.) | Annoncé « updates 500 ms » côté récepteurs (pas la cadence d'appel autorisée par le plan payant) | **Licence non-commerciale explicite** (« built for non-commercial use ») — compatible usage perso AXIOM ; mais **payant dès le 1ᵉʳ appel**, aucun tier $0 |

**Reco AXIOM :** budget-compatible (10 $/mois tient dans l'enveloppe 0–30 $) mais **pas en premier** — inutile de payer alors qu'OpenSky couvre déjà le besoin de base à 0 $. À envisager en **upgrade** seulement si la densité/qualité OpenSky déçoit à l'usage (ADS-B Exchange a la réputation d'un réseau plus dense sur certaines zones) — décision à prendre après avoir vu le rendu réel, pas avant.

**Sources :** page officielle — [adsbexchange.com/community/developer-hub/](https://www.adsbexchange.com/community/developer-hub/) ; tarif RapidAPI Basic ($10/mois, 10 000 req) — [rapidapi.com/adsbx/api/adsbexchange-com1/pricing](https://rapidapi.com/adsbx/api/adsbexchange-com1/pricing) (page rendue côté client, tiers Pro/Ultra au-delà du Basic non extraits automatiquement — cf. limites de cette recherche).

---

## 3. FlightAware AeroAPI

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Catch |
|---|---|---|---|---|---|---|
| **FlightAware AeroAPI v4 — tier Personal** | Mondiale (réseau FlightAware : ADS-B + MLAT + données radar sous licence) | Clé API (compte FlightAware) | **10 result sets/minute** ; **$5 de crédit gratuit/mois** ($10/mois si on fait tourner un récepteur PiAware/FlightFeeder) — au-delà, facturation à l'usage | JSON, orienté **vol individuel** (`/flights/{ident}`, `/flights/search` par zone géo) | Pas de flux « tous les avions du monde en un appel » — architecture centrée vol/route, pas vecteur d'état global | `/flights/position` = **0,01 $/result set** → ~500 appels gratuits/mois (≈16/jour) ; `/flights/search` (le plus proche d'une requête par zone) = **0,05 $/result set**, et **au-delà de 15 résultats, un appel compte pour plusieurs "result sets"** → budget gratuit épuisé en quelques requêtes si la zone est dense |
| **FlightAware AeroAPI v4 — tier Standard** | Idem | Idem | 5 result sets/s | Idem + historique/alertes | **Minimum $100/mois** — hors budget 0–30 $ | — |

**Reco AXIOM : écarter.** Deux raisons cumulatives, pas juste le prix :
1. **Budget** — le crédit gratuit ($5–10/mois) ne couvre qu'une poignée de dizaines d'appels par jour maximum vu le coût par result set ; le palier suivant (Standard, seul avec accès large) exige **100 $/mois minimum**, très au-dessus du budget 0–30 $.
2. **Mauvaise forme de données pour ce besoin** — AeroAPI est conçu pour interroger un **vol identifié** ou une **recherche filtrée**, pas pour obtenir en un seul appel « tous les avions actuellement en l'air dans le monde » comme le fait OpenSky `/states/all`. Même avec un budget illimité, il faudrait paginer/agréger `/flights/search` zone par zone à 0,05 $/result set — non viable pour un flux globe temps réel.

**Sources :** page tarifs officielle AeroAPI v4 — [flightaware.com/commercial/aeroapi/v4](https://www.flightaware.com/commercial/aeroapi/v4/) ; portail développeur — [flightaware.com/aeroapi/portal](https://www.flightaware.com/aeroapi/portal).

---

## 4. Bonus (non demandé, trouvé en cours de recherche) — mirroirs communautaires gratuits type ADS-B Exchange

En cherchant les alternatives à ADS-B Exchange payant, une famille de **mirroirs communautaires gratuits** est apparue (`airplanes.live`, et ses cousins `adsb.lol` / `adsb.fi` / `adsb.one` — même modèle : réseau de récepteurs bénévoles partagé, API REST publique sans clé). **Testé en direct** : `api.airplanes.live/v2/point/48.8/2.3/250` (Paris, rayon 250 nm) → **HTTP 200 en 0,2 s, 445 avions renvoyés**, avec des champs bien plus riches qu'OpenSky (mach, vent, cap magnétique/vrai, `nac_p`/`nac_v`/`sil` de qualité de position). Rafale de 5 requêtes en <1 s → toutes 200 (pas de blocage immédiat constaté), mais la doc affiche une limite officielle de **1 req/s**. Pas d'endpoint mondial : `/v2/all` renvoie **404** — seuls des endpoints par **zone (rayon max 250 nm)**, hex, callsign, squawk, militaire sont exposés.

| Source | Couverture | Auth | Rate limit | Format | Fréquence | Catch |
|---|---|---|---|---|---|---|
| **airplanes.live (et cousins adsb.lol/adsb.fi/adsb.one)** | Mondiale, réseau bénévole distinct — densité constatée nettement supérieure à OpenSky sur la zone testée (445 vs 31 avions sur un rayon Paris comparable) | **Aucune** pour l'usage de base (clé optionnelle recommandée pour usage prod) | **1 req/s** documenté ; **rayon max 250 nm par appel**, pas de dump mondial en un coup | JSON, champs riches (mach, vent, nav, qualité position) | Temps réel (secondes) | **Projet hobbyiste non officiel** : « usage éducatif et non-commercial uniquement », aucune garantie de service (SLA), peut changer/disparaître sans préavis ; pour couvrir le globe entier il faudrait des centaines d'appels en tuilage (rayon 250 nm) — à 1 req/s ça prend plusieurs minutes pour un balayage complet, donc **pas adapté comme flux mondial primaire**, mais excellent en **enrichissement zoom** (zone survolée par l'utilisateur) |

**Reco AXIOM :** ne remplace pas OpenSky comme source primaire mondiale (limite de rayon + 1 req/s rendent un balayage global lent), mais **complément gratuit idéal pour la vue zoomée** : quand l'utilisateur zoome sur une région dans le globe AXIOM, un appel `point/lat/lon/rayon` sur airplanes.live donne une densité et une richesse de champs bien supérieures à OpenSky, pour 0 $. À traiter comme un **enrichissement optionnel post-MVP**, pas comme le socle.

**Sources :** doc API — [airplanes.live/api-docs](https://airplanes.live/api-docs/), [airplanes.live/api-guide](https://airplanes.live/api-guide/) ; test `curl` en direct du 2026-07-10 (ci-dessus).

---

## Synthèse — quelle source en premier

| Critère | OpenSky (anonyme) | ADS-B Exchange | FlightAware AeroAPI | airplanes.live (bonus) |
|---|---|---|---|---|
| Coût | **0 $** | 10 $/mois min | 100 $/mois pour un usage réel | **0 $** |
| Appel mondial en 1 requête | **Oui** (confirmé, 11 358 avions) | Non testé mais probable (payant) | **Non** — architecture par vol/zone | **Non** — rayon 250 nm max |
| Auth | Aucune | Clé RapidAPI + CB | Clé + facturation à l'usage | Aucune |
| Verdict | **★ Source à intégrer en premier** | Upgrade éventuel si densité insuffisante | **Écarté** (prix + mauvaise forme de données) | Enrichissement zoom post-MVP |

**Conclusion tranchée : OpenSky Network `/states/all`, en anonyme, sans clé, en premier.** C'est la seule des 3 sources demandées qui tient dans le budget (0 $) ET qui répond à la question posée (« tout le trafic mondial en un instantané ») en un seul appel. ADS-B Exchange est une bascule payante crédible plus tard si besoin de densité, mais pas un point de départ gratuit. FlightAware AeroAPI est à écarter : trop cher pour un usage continu ET mal formé pour ce besoin (centré vol individuel, pas vecteur d'état global).

---

## Limites à annoncer à l'utilisateur

- **Densité affichable simultanément** : l'appel mondial OpenSky a renvoyé **11 358 avions** au moment du test (cohérent avec l'ordre de grandeur généralement cité pour le trafic aérien mondial instantané, ~10–20k) — mais ce nombre **varie selon l'heure** (creux nocturne vs pic de journée) et ne reflète que les appareils **vus par un récepteur ADS-B bénévole**, pas la totalité du trafic réel. Afficher 10 000+ points sur un globe 3D en continu demande un **throttling/clustering côté client** indépendant des limites API (performance rendu, pas juste débit réseau).
- **Fraîcheur** : en anonyme, résolution figée à **10 s**, uniquement l'instant présent (pas d'historique). Testé en direct : décalage horloge serveur ↔ horloge murale ~**8–20 s**. C'est un globe « qui donne l'impression du direct », pas un flux seconde par seconde.
- **Zones creuses** : la couverture dépend à 100 % de bénévoles qui possèdent un récepteur ADS-B chez eux. **Confirmé empiriquement** : Europe dense (31 avions sur une petite bbox Paris), océans et Afrique quasi vides (6 et 2 avions sur des bbox 300× plus grandes). Il faut prévenir l'utilisateur que des trous apparaîtront **structurellement** au-dessus des océans, d'Afrique, et de certaines zones d'Asie/Moyen-Orient/Amérique du Sud — ce n'est pas un bug, c'est la nature de toute source basée sur des récepteurs sol bénévoles (vrai aussi pour ADS-B Exchange et airplanes.live).
- **Budget de crédits** : 400 crédits/jour en anonyme, 4 crédits par appel mondial → **100 rafraîchissements globaux/jour max** si on n'optimise pas ; prévoir un cache serveur (`axiomd`) et/ou des appels bbox régionaux (moins chers) plutôt qu'un polling global naïf.
- **Auth à prévoir si upgrade** : passer au compte gratuit OpenSky (pour 4 000 crédits/jour) impose un flux **OAuth2 client_credentials** avec refresh de token toutes les <30 min — plus complexe qu'une simple clé `api_key`, à budgétiser en implémentation.

---

## Limites de cette recherche

- Les tiers RapidAPI « Pro »/« Ultra » d'ADS-B Exchange (au-delà du Basic $10/mois confirmé) n'ont pas pu être extraits automatiquement (page de tarification rendue côté client, contenu non exposé au fetch direct) — seul le tier Basic est confirmé chiffré.
- Le nombre d'avions mondial observé (11 358) est une **mesure ponctuelle** (2026-07-10, 21h UTC) — pas une moyenne ou un plancher/plafond garanti ; à re-vérifier à différentes heures si un chiffre précis doit être communiqué comme engagement produit.
- La clause ToS exacte d'OpenSky sur l'usage commercial n'a pas pu être re-vérifiée en direct (page FAQ bloquée en HTTP 403 au moment du test) — sans impact ici puisqu'AXIOM est un usage strictement personnel, mais à revisiter si le projet change de statut un jour.
- La famille airplanes.live/adsb.lol/adsb.fi/adsb.one est un projet **communautaire non officiel** : aucune garantie de pérennité, de SLA, ou de stabilité de l'API constatée dans la documentation — traiter tout branchement dessus comme un **enrichissement dégradable gracieusement**, jamais comme une dépendance dure.
