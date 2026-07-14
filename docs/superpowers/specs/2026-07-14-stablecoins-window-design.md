# Fenêtre STBL — Analyse des stablecoins (supply, impression, dominance, pegs)

Date : 2026-07-14
Statut : validé par Zaki (périmètre complet 4 onglets + drill-down)

## Objectif

Ajouter une fenêtre dédiée à l'analyse des stablecoins dans AXIOM : impression
(mint/burn net), dominance par émetteur, répartition par chaîne, et écarts de
peg. Aujourd'hui il n'existe qu'un overlay macro « supply agrégée »
(`data/macro/stablecoins.ts`) — aucune fenêtre dédiée.

## Sources de données

Toutes gratuites, sans clé, via **fetch direct** vers `stablecoins.llama.fi`
(CORS OK — même convention que `stablecoins.ts` ; respecte l'invariant
BUILD-CONTRACT « UI 100 % fonctionnelle sans daemon », donc pas de whitelist
`/extapi`) :

| Endpoint | Usage |
|---|---|
| `GET /stablecoins?includePrices=true` | Liste émetteurs : mcap (`circulating`), prix, `pegType`, `pegMechanism`, `chainCirculating` |
| `GET /stablecoincharts/all` | Historique supply agrégée (points bruts pour barres d'impression) |
| `GET /stablecoincharts/{chain}` | Historique d'une chaîne (chargé à la demande, onglet Chaînes) |
| `GET /stablecoin/{id}` | Détail émetteur (drill-down) : historique supply + par chaîne |

Cache mémoire TTL 5 min dans le module (pas de persistance).

## Architecture

### Couche données — `apps/web/src/data/macro/stablecoinsDetail.ts`

Quatre fetchers typés + parsing défensif (gardes NaN, champs manquants).
Test co-localisé `stablecoinsDetail.test.ts` avec fixtures JSON DefiLlama et
mock de `global.fetch`.

### Calculs purs — `apps/web/src/components/stablecoinsWindow.util.ts`

Testables sans DOM (`stablecoinsWindow.util.test.ts`) :
- dominance % par émetteur (et agrégat « Autres »)
- Δ supply nets 24 h / 7 j / 30 j (impression nette, agrégée et par émetteur)
- écart de peg en bps (pegs USD uniquement — DefiLlama donne les prix en USD ;
  les pegs EUR/autres sont listés avec prix brut, sans bps)
- seuils de badge peg : stable < 25 bps, tension < 100 bps, depeg ≥ 100 bps
- layout treemap (dominance) et échelles des charts canvas

### UI — `apps/web/src/components/StablecoinsWindow.tsx`

Clone du pattern FUND : store Zustand co-localisé + `mirrorOpenState("stablecoins")`
+ `export const commandes` (⌘K). Primitives `ui.tsx` (`EnTeteFenetre`,
`Onglets`, `Metric`, `Badge`, `Chargement`, `ErreurBloc`, `NoteSource`).
Charts en Canvas 2D via fonctions `dessiner()` pures + `canvasTokens`
(aucun hex en dur).

Quatre onglets :
1. **Vue d'ensemble** — metrics (supply totale, Δ24h/7j/30j, dominance USDT),
   treemap dominance (pattern MarketMapWindow), table top émetteurs
   (mcap, part %, Δ7j, prix, mécanisme). Clic ligne → drill-down.
2. **Impression** — chart supply agrégée + barres quotidiennes mint/burn net,
   sélecteur de fenêtre (30 j / 90 j / 1 a / tout), top mints & burns 7 j.
3. **Chaînes** — table répartition par chaîne (supply, part %, Δ7j, barres) ;
   sélection → chart historique de la chaîne.
4. **Pegs** — table écarts vs 1,00 $ en bps, badges, tri par écart décroissant.

**Drill-down émetteur** — vue remplaçante avec bouton retour : historique
supply, répartition par chaîne, peg, mécanisme.

### Câblage (4 points)

1. `store/windowManager.ts` → `WINDOW_REGISTRY` :
   `{ id: "stablecoins", title: "Stablecoins (STBL)", mnemonic: "STBL", defaultWidth: 860, defaultHeight: 640 }`
2. `App.tsx` → entrée lazy `stablecoins`
3. `commands/windowPanels.ts` → commande STBL (`basculer("stablecoins")`)
4. `components/Toolbar.tsx` → entrée `FONCTIONS` (liste en dur — ne pas oublier)

## Gestion d'erreurs

- Échec réseau / réponse invalide → `ErreurBloc` avec bouton réessayer ;
  chaque onglet gère son propre état de chargement.
- Champs DefiLlama manquants ou non numériques → ignorés avec garde (pas de NaN
  propagé dans les charts).

## Tests & vérification

- `stablecoinsDetail.test.ts` : parsing fixtures, filtres, gardes NaN.
- `stablecoinsWindow.util.test.ts` : dominance, Δ nets, bps, seuils badges,
  layout treemap, échelles.
- `windowManager.test.ts` existant : vérifie automatiquement le nouveau membre
  du registre le cas échéant.
- Commandes : `pnpm --filter @axiom/web test` puis `pnpm check`.
- Gate visuel final : ouvrir la fenêtre via ⌘K « STBL » et via le menu
  Fonctions, vérifier les 4 onglets + drill-down sur les 5 thèmes.

## Hors périmètre (itérations futures)

- Alertes depeg via le daemon.
- Flux mint/burn on-chain temps réel (Tether Treasury, etc.).
- Vélocité / volumes de transfert des stablecoins.
