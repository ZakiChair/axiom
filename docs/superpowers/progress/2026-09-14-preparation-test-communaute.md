# 2026-09-14 — Préparation du test communautaire (lien partagé sur X)

Demande du propriétaire : « Continue de tester l'app et l'améliorer avant que je partage
le lien sur X à ma commu pour le tester. » Angle retenu : ce que voit un **testeur inconnu**
qui arrive à froid depuis X (aucune clé, région quelconque, parfois sur téléphone), et non
l'opérateur unique pour lequel AXIOM a été conçu.

## Préalable : le dépôt a déménagé

`~/axiom` n'existe plus ; le dépôt vit désormais dans **`~/Projects/axiom`** (mêmes commits,
même remote, même remise `stash@{0}`, même `.vercel/`). Toutes les commandes de ce rapport
utilisent le chemin absolu. Un dossier `~/axiom/.remember` a été recréé par un hook de plugin
à 09:23 ; il n'appartient pas au dépôt.

## Constat en production (alias `axiom-iota-vert.vercel.app`, contexte navigateur vierge)

| Parcours | Résultat |
|---|---|
| Chargement à froid, bureau 2000 px | aucune erreur console, onboarding 1/3 affiché, BTCUSDT 1m chargé |
| Onboarding 3 étapes (Suivant ×2, Terminer) | fluide, clé Coinalyze présentée comme facultative |
| Téléphone 390×844 (émulation tactile) | utilisable : graphe visible, aucun défilement horizontal, en-tête = 40 % de l'écran |
| **Blocage géographique Binance simulé** (fetch et WebSocket `binance.com` forcés en HTTP 451) | « Données indisponibles · La source n’a pas pu fournir l’historique demandé » + « Réessayer » ; watchlist et régime vides ; **aucune issue proposée** |
| Menu Source → Coinbase sous ce blocage | BTCUSDT charge (symbole reconverti automatiquement) |
| Menu Source → Kraken sous ce blocage | BTCUSDT charge (PARTIAL, ~720 bougies) |
| DES sans clé Coinalyze | message clair « Ajoutez une clé Coinalyze… » + « Ouvrir les réglages » |
| Variables d'environnement Vercel production | **aucune** (`vercel env ls production`) : aucune clé du propriétaire n'est partagée via le proxy, toutes les fenêtres à clé affichent « clé requise » |

Le premier point critique est le 451 : les États-Unis (et d'autres régions) sont refusés par
Binance, source par défaut. Un testeur américain concluait que l'application est cassée.

## Lots livrés (trois commits, tests d'abord)

1. **`bb8689e` fix(chart)** — `dataLoadErrorMessage` sort de `ChartInstance.tsx` vers un
   module pur (`apps/web/src/chart/dataLoadErrorMessage.ts`, 7 tests). HTTP 451 →
   « Cette source refuse les connexions depuis votre région (HTTP 451). Changez de source
   dans l’en-tête (menu « Source ») : Coinbase ou Kraken restent accessibles. » Le motif
   `\b451\b` couvre `statusText` vide (HTTP/2) sans confondre « 4511 ».
2. **`ce7b15a` feat(web)** — carte de partage : `meta description`, `og:*`,
   `twitter:card = summary_large_image`, image `apps/web/public/apercu-terminal.jpg`
   (1200×470, 182 373 octets, dérivée de `assets/apercu-terminal.png`). Test structurel
   `apps/web/src/lib/partage.test.ts`. **URL et image ancrées sur l'alias** : à changer si un
   domaine personnalisé est attaché.
3. **`2024ed3` feat(web)** — lien « Signaler un problème » → `github.com/ZakiChair/axiom/issues`
   (dépôt public, issues activées) à la dernière étape de l'onboarding et au pied de l'aide
   « AIDE » ; source unique `apps/web/src/lib/lienRetours.ts`.

## Preuves

- `bash scripts/ci.sh` : typecheck, 1 376 + 70 + 103 + 3 937 tests, build dans le budget
  (355 670 octets gzip pour 360 000, marge 4 330 ≥ 3 ko exigés par la variance zlib du
  runner GitHub).
- `pnpm check:e2e` : 51 parcours hermétiques verts (1,2 min).
- GitHub Actions run `34819008044` sur `2024ed3` : succès (troisième run vert consécutif sur `main`, après `34816202729` et `34816695192`).
- Déploiement `dpl_AqGzzRmpKFFDgYSifhUHEsHYdmCr` (09:41, prébuilt) ; l'alias sert
  `index-C21-vqMl.js`, identique au build local.
- `curl` de l'alias : les six balises de carte présentes ; `apercu-terminal.jpg` → HTTP 200,
  `image/jpeg`, 182 373 octets.
- Chrome sur l'alias, même blocage simulé, bundle neuf : l'overlay affiche le message 451
  actionnable (le contexte de test avait persisté Kraken, remis sur Binance pour la preuve).
- Chrome sur l'alias : touche `?` → pied de l'aide « … · Signaler un problème » (`target=_blank`,
  `rel=noopener noreferrer`) ; onboarding forcé à l'étape 3 via `axiom:onboarding:v1` →
  « Un bug, une idée ? Signalez-le sur GitHub. »

## Limites connues, laissées en l'état

- Sous un 451 Binance, la **watchlist** (ticker 24 h Binance) et le **score de régime**
  restent vides même après passage sur Coinbase ; hors périmètre de ce lot.
- Le libellé « TradFi (Twelve Data) — UNUSABLE sans clé » suit la convention Bloomberg des
  statuts UNUSABLE utilisée partout ; conservé.
- Téléphone : utilisable mais l'en-tête occupe 40 % de l'écran ; aucun mode mobile dédié.
- Aucune limitation de débit sur `/api/proxy` : sans clé serveur le risque est nul, mais un
  afflux de testeurs consomme les quotas Vercel (invocations, bande passante) du compte.

## Ce que le message sur X doit dire

- Un testeur aux États-Unis doit **changer de source** (menu « Source » en haut à gauche) :
  Coinbase ou Kraken ; le message en rouge le lui dit désormais.
- Aucune clé n'est fournie : les fenêtres Coinalyze / Twelve Data / FRED… demandent une clé
  personnelle, à saisir dans Réglages ⚙.
- Les retours vont sur les issues GitHub (lien dans l'onboarding et dans AIDE).
