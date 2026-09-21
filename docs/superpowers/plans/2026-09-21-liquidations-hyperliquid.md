# Liquidations Hyperliquid exécutées — minage partiel des fills (plan et spec)

> **Pour les agents :** chantier orchestré le 2026-09-21 (orchestrateur + un implémenteur sur brief,
> revue du diff par l'orchestrateur avant commit). Fait suite à la demande du propriétaire :
> « la source d'info sur les liquidations doit provenir d'Hyperliquid, intégrée de façon lisible
> et belle dans le graphique ». Le rendu (bulles de clusters, `LIQBUL`) a été livré à part
> (`c7c254f`) ; ce plan couvre la SOURCE.

## 1. Constat (vérifié sur l'API le 2026-09-21)

- Hyperliquid n'expose **aucun flux public de liquidations**. Les liquidations de marché ne
  sont pas des transactions L1 (le flux `explorerTxs` ne les voit pas) et le flux public
  `trades` ne les marque pas. Elles n'apparaissent que dans les **fills des adresses
  impliquées** : `WsFill.liquidation?: { liquidatedUser?, markPx, method: "market" | "backstop" }`.
- Liquidation de marché : la contrepartie est un **maker** ; son fill porte
  `liquidation.liquidatedUser` (adresse liquidée). Liquidation backstop : le vault
  **HLP Liquidator** `0x2e3d94f0562703b25c83308a05046ddaf9a8dd14` (enfant de HLP, vérifié via
  `vaultDetails`) reprend la position ; son fill porte aussi `liquidation` (méthode `backstop`).
- Limites HL par IP : 10 connexions WS, **10 utilisateurs uniques** à travers les souscriptions
  WS par utilisateur, 1 000 souscriptions, 1 200 poids REST/min (`userFillsByTime` = 20 + 1 par
  20 lignes — un polling REST de 20 makers dépasserait le quota).
- Concentration mesurée (sonde `trades` BTC, 2026-09-21) : le top-10 des makers absorbe ≈ 55 %
  du volume, le top-20 ≈ 70 %. Une source fondée sur les makers est donc **partielle par
  construction** et doit l'afficher.

## 2. Décision du propriétaire

Trois options présentées : fournisseur tiers à clé (exhaustif, payant, amendement de
contrat), **minage officiel partiel** (sans clé, API officielle, couverture mesurée), statu quo
Bybit + OKX. **Retenu : minage officiel partiel.**

## 3. Architecture

Daemon `axiomd`, ingestion **à froid** (jamais sur le chemin chaud du renderer), même statut que
le collecteur Bybit/OKX de `liqFeed.ts` :

- `apps/daemon/src/hlLiqFeed.ts` — **une** connexion WS `wss://api.hyperliquid.xyz/ws`
  (`connecterBoucleWs`, heartbeat `{"method":"ping"}` / 30 s, staleness 10 min) :
  - `trades` de chaque coin surveillé (`coinHl(symbole)` : BTCUSDT → BTC, alias `1000PEPE →
    kPEPE`…) → seaux de volume **maker** par minute sur 30 min (maker = `side === "B" ?
    users[1] : users[0]`) ;
  - `userFills` du vault HLP Liquidator (toujours) + des **9** makers les mieux classés
    (rotation toutes les 5 min, première à 60 s, hystérésis : un maker suivi reste tant que son
    rang < 9 + 5) — 10 utilisateurs uniques, plafond HL ;
  - chaque fill portant `liquidation` avec `liquidatedUser` → `LiqFil` venue `hyperliquid`,
    déduplication par `tid` (FIFO 5 000) puis index unique de la table `liquidations`.
  - **Convention de côté figée par test** : fill de la contrepartie (adresse suivie ≠
    liquidatedUser) : `B` → long liquidé, `A` → short ; fill du liquidé lui-même : `B` → short,
    `A` → long ; `liquidatedUser` absent → fill ignoré.
  - Aucun appel REST. Santé exposée dans `/health` → `collecteurs.liquidations.hyperliquid` :
    `{ dernierMessageTs, derniereErreur, partiel: true, adressesSuivies, couverture, derniereLiqTs }`
    où `couverture` = part du volume maker (USD, 30 min, coins surveillés) absorbée par les
    adresses suivies.
- `GET /liquidations/:symbole?venue=hyperliquid` — filtre optionnel `venue` (additif).

Front (`apps/web`) :

- `chart/liquidationMarkers.ts` : tant que le flux LIQ est retenu, poll **30 s** du daemon
  filtré `venue=hyperliquid` depuis le dernier temps HL connu (marge 60 s), fusion dédoublonnée
  dans le buffer (`fusionnerEvenements`), **jamais** de dual-write retour. Les événements HL
  traversent alors heatmap, bulles, profil et fenêtre LIQ (badge « HL ») sans autre code.
- `data/daemon.ts` : champs optionnels `partiel`, `couverture`, `adressesSuivies` ; une venue
  `partiel` est **exclue** du calcul « collecteur muet » (une source partielle vivante ne doit
  pas masquer la mort de Bybit + OKX).
- Fenêtre LIQ : ligne d'honnêteté « Hyperliquid : N adresses suivies · couverture ≈ X % du flux
  makers · différé ≤ 30 s » (ou « flux muet depuis … »), note de source mise à jour.

## 4. Ce que cette source N'EST PAS

- Pas exhaustive : seules les liquidations dont la contrepartie est une adresse suivie sont
  vues. Le chiffre de couverture est **mesuré** (flux makers), pas un taux de capture garanti.
- Pas temps réel strict : ingestion WS immédiate côté daemon, mais consommation front toutes
  les 30 s (étiqueté).
- Indisponible sur Vercel (daemon local requis) — la fenêtre n'affiche alors aucune ligne HL.
- Aucun AggregationEngine, aucun fournisseur nouveau (`EXCHANGE_IDS` à 9, Hyperliquid en fait
  déjà partie), aucune fenêtre, aucun indicateur.

## 5. Vérification

- Daemon : `pnpm --filter @axiom/daemon typecheck`, `pnpm --filter @axiom/daemon test` ; preuve
  réelle : daemon lancé, `/health` après 90 s et 6 min (`adressesSuivies` = 10, `couverture` ∈
  ]0,1[, aucun `channel:"error"` HL), `GET /liquidations/BTCUSDT?venue=hyperliquid`.
- Front : typecheck, tests ciblés (`daemon`, `liquidationMarkers`, `liquidationsWindow`), build
  avec budget d'entrée (plafond 360 000 gzip) ; porte finale `pnpm check`.
- Mesures consignées dans `docs/superpowers/progress/2026-09-21-liquidations-hyperliquid.md`.
