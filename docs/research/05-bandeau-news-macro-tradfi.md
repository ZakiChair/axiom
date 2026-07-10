# AXIOM — Bandeau news « tête TV » (ticker Bloomberg-style) : UI + enrichissement macro/tradfi (recensement)

> **Doc de recherche · 2026-07-10.** Complète `01-fournisseurs-api-indicateurs.md` (news crypto déjà couvertes). Cible : (1) confirmer que le bandeau défilant demandé est un pur travail UI côté crypto, (2) recenser des flux HEADLINES macro/tradfi gratuits pour l'enrichir, (3) vérifier la couverture Finnhub au-delà de la crypto.
> Méthode : **vérification empirique en direct** (`curl`, pas de supposition) sur chaque flux candidat, aujourd'hui 2026-07-10, avec et sans User-Agent navigateur. Code existant lu en premier : `apps/web/src/data/news.ts`, `apps/web/src/store/news.ts`, `apps/web/src/data/extapi.ts`, `apps/daemon/src/proxy.ts`.

---

## 1. Le bandeau défilant lui-même : confirmé — pur travail UI, zéro nouvelle source (crypto)

`newsStore` (Zustand vanilla, `apps/web/src/store/news.ts`) contient déjà `items: NewsItem[]` — le résultat fusionné/trié/dédupliqué de **tous** les flux, alimenté par `demarrerVeilleNews()` (poll 3 min, `apps/web/src/data/news.ts:481`). Un bandeau défilant façon Bloomberg TV n'a besoin d'AUCUNE nouvelle donnée : c'est un second composant de lecture (comme `NewsWindow.tsx` l'est déjà), qui :
- s'abonne au même `newsStore` (sélecteur Zustand sur `items`),
- rend une piste CSS `@keyframes` (translation horizontale en boucle, `animation-play-state: paused` au survol) — aucune dépendance nouvelle, aucun canvas,
- réutilise `tempsRelatif`, les badges couleur par source (`NEWS_FEEDS[...].color`), et le filtre symbole existant si besoin.

**Un seul point d'architecture à trancher en implémentation (pas un blocage)** : `demarrerVeilleNews()` est aujourd'hui appelé **uniquement par `NewsWindow`** à l'ouverture du panneau (`NewsWindow.tsx:175`) — le polling s'arrête à sa fermeture. Si le bandeau doit rester visible en permanence (indépendamment du panneau NEWS), c'est LUI qui doit démarrer/arrêter sa propre veille (`useEffect` avec le même `demarrerVeilleNews`/`Unsubscribe`), pas un nouveau mécanisme réseau — juste un second appelant de la fonction existante. Si panneau ET bandeau sont ouverts ensemble, ça fait deux pollers indépendants sur les mêmes flux (3 min chacun) : anodin vu le TTL cache 120 s déjà en place côté `axiomd` (`EXTAPI_TTL_DEFAUT_MS`), mais à documenter dans le composant.

**Verdict : confirmé.** Aucune clé, aucun host, aucun proxy à ajouter pour le bandeau crypto — 100 % UI.

---

## 2. Flux HEADLINES macro/tradfi généralistes gratuits — recensement testé en direct

| Source | Endpoint testé | HTTP (2026-07-10) | Auth | CORS | Fraîcheur constatée | Verdict |
|---|---|---|---|---|---|---|
| **Reuters** (`reutersagency.com/feed`, `reuters.com/rssFeed/*`, `arc/outboundfeeds/rss`) | 4 chemins testés | `301`→404, `000` (timeout DNS), `404`, **`401` avec `x-datadome: protected`** sur `reuters.com/business/` | Bot-protection **DataDome** active sur le domaine principal ; `reutersagency.com/feed` redirige vers une page marketing HubSpot (pas un flux) | — | — | **MORT.** Reuters a fermé son RSS public il y a plusieurs années ; toute variante d'URL retombe soit sur une 404, soit sur le mur DataDome. Ne pas implémenter. |
| **CNBC — Top News** (`www.cnbc.com/id/100003114/device/rss/rss.html`) | testé | **200**, `application/xml` | Aucune (mais **exige un User-Agent navigateur** — UA vide/générique → 403 Akamai « Access Denied ») | Aucun header CORS → nécessite le proxy `/extapi` (comme les 5 flux crypto déjà en place) | Items datés à la minute près (17:00 GMT même jour) | **VIVANT et gratuit.** Fonctionne tel quel avec le UA Chrome déjà envoyé par défaut par `axiomd` (`EXTAPI_USER_AGENT`, `proxy.ts:233`) — **zéro adaptation du proxy nécessaire**, juste ajouter l'hôte à la whitelist. |
| **CNBC — Economy** (`www.cnbc.com/id/20910258/device/rss/rss.html`) | testé | **200** | idem | idem | Titres vérifiés : CPI Chine, Lagarde/BCE, NFP US — 100 % macro pur, zéro bruit lifestyle | **Meilleur candidat CNBC pour un bandeau macro** — signal le plus dense observé sur ce recensement. |
| **Bloomberg — `feeds.bloomberg.com/markets/news.rss`** | testé | **200**, `application/rss+xml` | Aucune (fonctionne même avec le UA par défaut de `curl`, pas besoin de UA navigateur) | Aucun header CORS → proxy requis | Items vieux de quelques minutes seulement | **VIVANT.** Contredit l'hypothèse de départ (« Bloomberg a fermé son RSS public ») — **faux aujourd'hui**, `feeds.bloomberg.com` répond en direct. Bruit constaté : items non-macro (tennis, sport, un titre en japonais) mêlés au flux « Markets ». |
| **Bloomberg — `feeds.bloomberg.com/economics/news.rss`** | testé | **200** | idem | idem | Titres vérifiés : inflation Russie/Turquie/Brésil, Fed monetary policy report — 100 % macro pur | **Meilleur candidat Bloomberg** — même verdict que CNBC Economy : verticale `economics` nette, pas de bruit éditorial. |
| **Bloomberg — `feeds.bloomberg.com/politics/news.rss`** | testé | **200** | idem | idem | Géopolitique (Iran, sanctions, politique US) | Vivant mais plus géopolitique que macro-marché stricto sensu — optionnel, pas prioritaire. |
| **Trading Economics « stream »** (`api.tradingeconomics.com/news?c=guest:guest`) | testé | **410 Gone** — *"the guest account has been discontinued"* | Payant confirmé | — | — | **Confirmé payant.** Le compte invité gratuit historique a été fermé côté Trading Economics ; toute intégration nécessite un abonnement (cf. `tradingeconomics.com/api/pricing.aspx`). Ne pas implémenter sans budget. |
| **FRED release calendar** (`api.stlouisfed.org/fred/releases` + `/releases/dates`) | testé avec la vraie clé AXIOM (`.env`) | **200** | Clé gratuite déjà détenue par AXIOM (FRED_API_KEY) | — | — | **Existe mais n'est PAS des headlines.** Réponse = métadonnées structurées (`release_id`, `release_name`, `date` — ex. « Commercial Paper », « Dow Jones Averages », « CBOE Market Statistics »), c'est un **calendrier de publication de séries chiffrées**, aucun champ de texte narratif/titre d'article. Inutilisable tel quel pour un bandeau de « phrases » — pertinent uniquement pour un futur widget calendrier économique (déjà couvert par ForexFactory JSON dans `extapi.ts`), pas pour ce ticker. |

---

## 3. Finnhub au-delà de la crypto : déjà branché, et extensible gratuitement

Le code existant (`news.ts:412`) appelle **déjà** `finnhub.io/api/v1/news?category=general` — ce n'est PAS un flux crypto, c'est la catégorie généraliste marché/business de Finnhub. **Le bandeau bénéficierait donc immédiatement de cette source sans rien changer**, simplement en la faisant apparaître dans la vue défilante.

L'endpoint `/news` accepte 4 valeurs de `category` : **`general`, `forex`, `crypto`, `merger`** — les 4 sur le tier gratuit (60 req/min, confirmé par la documentation publique Finnhub ; `general` fonctionne déjà en prod côté AXIOM, preuve que le tier actuel y a accès). Deux catégories inexploitées, gratuites, zéro nouvelle clé (même `getFinnhubKey()`) :
- **`forex`** : pertinent pour un bandeau macro/devises — actualité FX généraliste, bon complément.
- **`merger`** : M&A — plus niche, moins « macro », optionnel.

**Verdict : Finnhub `general` = déjà fait. `forex` = extension triviale (dupliquer l'entrée `NEWS_FEEDS` avec un `category` différent), zéro nouveau host/proxy (Finnhub est appelé en direct, CORS ouvert, cf. commentaire `news.ts:76`).**

---

## Synthèse — Reco AXIOM

| Source | Ajouter ? | Effort | Modifs nécessaires |
|---|---|---|---|
| **Bandeau UI (crypto)** | Oui — c'est la demande | Composant seul | Nouveau composant `NewsTicker.tsx` (CSS marquee), lit `newsStore`, démarre sa propre veille via `demarrerVeilleNews()` existant |
| **Bloomberg `economics`** | **Oui, en priorité** | Faible | Ajouter `feeds.bloomberg.com` aux 3 fichiers whitelist (`extapi.ts`, `vite.config.ts`, `proxy.ts`) + 1 entrée `NEWS_FEEDS` (`kind` absent = xml, `parseFeed` gère déjà le RSS Bloomberg tel quel) |
| **CNBC `Economy` (id 20910258)** | **Oui, en priorité** | Faible | Ajouter `www.cnbc.com` à la whitelist + 1 entrée `NEWS_FEEDS` — UA navigateur déjà envoyé par défaut par `axiomd`, aucune adaptation proxy |
| **Finnhub `forex`** | Oui, en bonus | Trivial | Dupliquer l'entrée Finnhub existante avec `category=forex` (même clé, même mécanisme direct) |
| Bloomberg `markets` / `politics` | Optionnel | — | Plus bruyant (markets) ou plus géopolitique (politics) que macro pur — à ne considérer qu'en second temps |
| Reuters (toutes variantes) | **Non** | — | Mort — DataDome + 404, RSS public fermé |
| Trading Economics stream | **Non** | — | Confirmé payant (410 Gone sur le compte invité) |
| FRED release calendar | **Non** (pour CE besoin) | — | Ce sont des séries/dates, pas des headlines — hors-sujet pour un ticker de titres |

**Bilan chiffré :** sur 4 pistes tradfi envisagées au départ (Reuters, Trading Economics, FRED, + Bloomberg/CNBC en creux), **2 sont mortes ou hors-sujet côté headlines** (Reuters, Trading Economics), **1 est vivante mais ne produit pas le bon type de donnée** (FRED), et **2 sont vivantes et gratuites aujourd'hui, contrairement à l'hypothèse de prudence de départ** (Bloomberg `feeds.bloomberg.com/*`, CNBC `cnbc.com/id/*/device/rss/rss.html`) — à condition de les router par le proxy `/extapi` déjà en place (exactement le même schéma que CoinDesk/Cointelegraph/etc.), le second avec un User-Agent navigateur déjà fourni par défaut par `axiomd` sans code supplémentaire.

---

## Limites de cette recherche

- Les flux Bloomberg/CNBC ne sont **pas documentés officiellement comme API publique pérenne** (comme le CBOE `cdn.cboe.com` déjà signalé dans `04-...md`) — traiter comme un enrichissement dégradable gracieusement (le pattern `Promise.allSettled` par flux de `fetchToutesLesNews` couvre déjà ce risque), pas une garantie contractuelle. Robustesse à long terme non garantie.
- Bloomberg `feeds.bloomberg.com/markets/news.rss` a montré un item en japonais lors du test (probable flux partagé multi-marché côté Bloomberg CDN) — signal que la verticale `markets` mélange plusieurs éditions ; `economics` s'est montrée propre sur l'échantillon observé mais n'a été vérifiée que sur ~5 items à un instant T, pas dans la durée.
- Autres médias non testés dans ce recensement (hors périmètre de la demande) : MarketWatch, Yahoo Finance, WSJ, FT — pourraient valoir une passe dédiée si le bandeau doit être élargi au-delà de Bloomberg/CNBC/Finnhub.
- Le tier gratuit Finnhub (60 req/min) n'a pas été testé en direct avec une clé réelle pour `forex`/`merger` spécifiquement (aucune clé serveur disponible dans ce repo, la clé est saisie côté client) — confirmé uniquement par la documentation publique Finnhub, pas par un appel HTTP direct comme le reste de ce document. `general` est en revanche confirmé en PROD (déjà utilisé par AXIOM).
