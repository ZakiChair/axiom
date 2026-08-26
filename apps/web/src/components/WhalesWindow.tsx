/**
 * Fenêtre « WHALES » — mouvements de baleines, deux onglets :
 *  - FLUX ON-CHAIN : gros transferts (BTC natif + stables USDT/USDC) collectés en continu
 *    par le daemon (`GET /whales/recent`, table SQLite, rétention 30 j). Filtres seuil +
 *    actif, pression dépôts vs retraits, fil horodaté (source → destination étiquetées).
 *  - POSITIONS HL : positions ouvertes des top comptes du leaderboard Hyperliquid
 *    (`GET /hl/positions/:coin`, MÊME instantané 5 min que la couche LIQHL).
 *
 * HONNÊTETÉ (garde-fous BUILD-CONTRACT, cf. data/whales.ts) : montants BTC = estimation
 * (heuristique d'exclusion du change), étiquetage dépôt/retrait = liste curée non
 * exhaustive, ETH natif non couvert, positions HL = échantillon top leaderboard. Chaque
 * onglet porte ses badges et sa note de source. SANS daemon : repli explicite (pattern
 * REPLAY/LIQHL), la fenêtre ne prétend jamais avoir des données qu'elle n'a pas.
 *
 * Données LENTES (collecte daemon en continu, lecture ~30 s) → poll léger monté avec la
 * fenêtre (FloatingWindow démonte quand fermée/minimisée : le poll s'arrête seul).
 * Lecture CEX complémentaire : la palette `WHALE` (bulles de prints agressifs sur le
 * chart) reste l'outil du flux exchange en séance.
 */
import { useEffect, useRef, useState } from "react";
import { daemonSupporteHl, hlPositionsGet, whalesRecentGet } from "../data/daemon";
import {
  libelleBout,
  mapperReponsePositions,
  mapperReponseWhales,
  statsWhales,
  raccourcirAdresse,
  type MouvementWhale,
  type PositionHl,
  type ReponseHlPositions,
  type SanteWhales,
} from "../data/whales";
import { formatCompact, formatHeure, formatPrice, formatUsd } from "../lib/format";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "./TableTriable";
import {
  Badge,
  BadgeFiabilite,
  Chargement,
  EnTeteFenetre,
  Fraicheur,
  NoteSource,
  Onglets,
  Segmente,
  TitreSection,
  TuileStat,
  Vide,
  type TonBadge,
} from "./ui";

/** Cadence de lecture du fil (la collecte daemon est continue, la lecture peut être lente). */
const PERIODE_POLL_MS = 30_000;
/** Seuils de filtre proposés (le daemon ne collecte qu'à partir de 1 M$). */
const SEUILS: ReadonlyArray<{ id: string; usd: number; label: string }> = [
  { id: "1m", usd: 1_000_000, label: "≥ 1M" },
  { id: "5m", usd: 5_000_000, label: "≥ 5M" },
  { id: "10m", usd: 10_000_000, label: "≥ 10M" },
  { id: "50m", usd: 50_000_000, label: "≥ 50M" },
];
/** Filtres d'actif (couverture v1 du collecteur : BTC natif + stables ERC-20). */
const ASSETS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "tous", label: "Tous" },
  { id: "BTC", label: "BTC" },
  { id: "USDT", label: "USDT" },
  { id: "USDC", label: "USDC" },
];
/** Coins proposés pour les positions Hyperliquid (top liquidité du leaderboard). */
const COINS_HL = ["BTC", "ETH", "SOL", "HYPE"] as const;

/** Statut de chargement local (pattern triplet des fenêtres daemon-dépendantes). */
type Statut = "charge" | "ok" | "sans-daemon" | "erreur";

/** Ton + libellé FR du badge de direction (dépôt = offre potentielle → down). */
const BADGE_DIRECTION: Record<MouvementWhale["direction"], { ton: TonBadge; label: string }> = {
  depot: { ton: "down", label: "dépôt" },
  retrait: { ton: "up", label: "retrait" },
  interne: { ton: "neutre", label: "interne" },
  inconnu: { ton: "neutre", label: "—" },
};

// ─────────────────────────── Onglet FLUX ON-CHAIN ───────────────────────────

/** Une ligne du fil : heure · actif · montant · source → destination · direction. */
function LigneMouvement({ m }: { m: MouvementWhale }) {
  const badge = BADGE_DIRECTION[m.direction];
  return (
    <li className="flex items-center gap-2 border-b border-border/60 px-1 py-1.5 text-[11px] tabular-nums">
      <span className="w-12 shrink-0 text-text-dim">{formatHeure(m.t)}</span>
      <span className="w-11 shrink-0 font-medium text-text">{m.asset}</span>
      <span className="w-16 shrink-0 text-right font-medium text-text" title={`${formatCompact(m.qty)} ${m.asset}`}>
        {formatUsd(m.usd)}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-dim" title={`${m.de} → ${m.vers}`}>
        <span className={m.deLabel !== null ? "text-accent" : ""}>{libelleBout(m.de, m.deLabel)}</span>
        <span> → </span>
        <span className={m.versLabel !== null ? "text-accent" : ""}>{libelleBout(m.vers, m.versLabel)}</span>
      </span>
      <Badge ton={badge.ton}>{badge.label}</Badge>
    </li>
  );
}

/** Pied de santé du collecteur : états honnêtes (blocs BTC, poll ETH, clé, prix). */
function SanteCollecteur({ sante }: { sante: SanteWhales }) {
  const btcOk = sante.erreurBtc === null && sante.dernierPollBtcTs > 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        ton={btcOk ? "up" : "warn"}
        title={sante.erreurBtc ?? "Blocs confirmés blockchain.info (~10 min de latence, sans mempool)."}
      >
        {btcOk
          ? `BTC · bloc ${sante.dernierBlocBtc ?? "—"}`
          : sante.erreurBtc !== null
            ? "BTC · erreur de poll"
            : "BTC · en attente"}
      </Badge>
      <Badge
        ton={sante.dernierPollEthTs > 0 && sante.erreurEth === null ? "up" : "warn"}
        title={
          !sante.clePresente
            ? "L'API Etherscan v2 refuse toute requête sans clé : renseigner ETHERSCAN_API_KEY dans apps/web/.env pour suivre USDT/USDC."
            : (sante.erreurEth ?? undefined)
        }
      >
        {!sante.clePresente
          ? "stables · clé Etherscan requise"
          : sante.erreurEth !== null
            ? "stables · erreur Etherscan"
            : sante.dernierPollEthTs > 0
              ? "stables · suivis"
              : "stables · en attente"}
      </Badge>
    </div>
  );
}

function OngletFlux() {
  const [statut, setStatut] = useState<Statut>("charge");
  const [mouvements, setMouvements] = useState<MouvementWhale[]>([]);
  const [sante, setSante] = useState<SanteWhales | null>(null);
  const [majTs, setMajTs] = useState<number | null>(null);
  const [seuilId, setSeuilId] = useState<string>("1m");
  const [asset, setAsset] = useState<string>("tous");

  const seuilUsd = SEUILS.find((s) => s.id === seuilId)?.usd ?? 1_000_000;

  // Poll lent tant que l'onglet est monté. Génération anti-course : seule la dernière
  // requête en vol écrit l'état (« dernière réponse gagne », changement de filtre inclus).
  const generation = useRef(0);
  useEffect(() => {
    const gen = ++generation.current;
    const charger = async (): Promise<void> => {
      const brut = await whalesRecentGet({
        minUsd: seuilUsd,
        ...(asset !== "tous" ? { asset } : {}),
        limite: 300,
      });
      if (generation.current !== gen) return; // réponse périmée
      if (brut === null) {
        setStatut("sans-daemon");
        return;
      }
      const reponse = mapperReponseWhales(brut);
      if (reponse === null) {
        setStatut("erreur");
        return;
      }
      setMouvements(reponse.mouvements);
      setSante(reponse.sante);
      setMajTs(Date.now());
      setStatut("ok");
    };
    void charger();
    const minuteur = setInterval(() => void charger(), PERIODE_POLL_MS);
    return () => clearInterval(minuteur);
  }, [seuilUsd, asset]);

  const stats = statsWhales(mouvements);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmente options={SEUILS.map((s) => ({ id: s.id, label: s.label }))} actif={seuilId} onChange={setSeuilId} />
        <Segmente options={ASSETS.map((a) => ({ id: a.id, label: a.label }))} actif={asset} onChange={setAsset} />
        <span className="ml-auto text-[10px] text-text-dim">
          <Fraicheur loading={statut === "charge"} majTs={majTs} cadence="~30 s" cadenceMs={PERIODE_POLL_MS} />
        </span>
      </div>

      {statut === "sans-daemon" && (
        <Vide>
          Le fil des baleines nécessite le daemon axiomd (collecte continue en SQLite).
          <br />
          Lancer <code className="text-text">pnpm run up</code> puis rouvrir cette fenêtre.
        </Vide>
      )}
      {statut === "erreur" && <Vide>Réponse du daemon illisible — réessaiera au prochain cycle.</Vide>}
      {statut === "charge" && <Chargement libelle="Lecture du fil des baleines…" />}

      {statut === "ok" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TuileStat label="Dépôts exchanges" valeur={formatUsd(stats.depotUsd)} ton="down"
              title="Transferts VERS un wallet exchange connu (offre potentielle) — étiquetage heuristique." />
            <TuileStat label="Retraits exchanges" valeur={formatUsd(stats.retraitUsd)} ton="up"
              title="Transferts DEPUIS un wallet exchange connu (accumulation) — étiquetage heuristique." />
            <TuileStat label="Net vers exchanges" valeur={formatUsd(stats.netExchangeUsd)}
              ton={stats.netExchangeUsd > 0 ? "down" : stats.netExchangeUsd < 0 ? "up" : undefined}
              title="Dépôts − retraits sur la fenêtre affichée : positif = pression d'offre potentielle." />
            <TuileStat label="Plus gros transfert" valeur={formatUsd(stats.maxUsd)} title={`${stats.nb} mouvements affichés`} />
          </div>

          {mouvements.length === 0 ? (
            <Vide>Aucun mouvement ≥ {formatUsd(seuilUsd)} collecté sur la fenêtre (rétention 30 j).</Vide>
          ) : (
            <ul className="min-h-0">
              {mouvements.map((m) => (
                <LigneMouvement key={m.id} m={m} />
              ))}
            </ul>
          )}

          {sante !== null && <SanteCollecteur sante={sante} />}
        </>
      )}

      <NoteSource>
        Couverture v1 : BTC natif (blocs confirmés blockchain.info ~10 min, montant net estimé hors change)
        + USDT/USDC ERC-20 (Etherscan, clé requise, ~90 s) ≥ 1 M$. ETH natif et autres chaînes non couverts.
        Étiquettes dépôt/retrait : liste curée de wallets exchange publics, non exhaustive.{" "}
        <BadgeFiabilite niveau="estimation" label="estimation" title="Montants BTC nets heuristiques ; directions dépendantes d'une liste d'adresses curée." />
      </NoteSource>
    </div>
  );
}

// ─────────────────────────── Onglet POSITIONS HYPERLIQUID ───────────────────────────

/** Colonnes de la table des positions (tri par notionnel décroissant par défaut). */
const COLONNES_POSITIONS: readonly ColonneTable<PositionHl>[] = [
  {
    id: "cote",
    label: "Côté",
    rendu: (p) => <Badge ton={p.side === "long" ? "up" : "down"}>{p.side}</Badge>,
  },
  {
    id: "notionnel",
    label: "Notionnel",
    align: "right",
    triable: true,
    valeurTri: (p) => p.valueUsd,
    rendu: (p) => <span className="font-medium text-text">{formatUsd(p.valueUsd)}</span>,
  },
  {
    id: "levier",
    label: "Levier",
    align: "right",
    triable: true,
    valeurTri: (p) => (p.lev > 0 ? p.lev : null),
    rendu: (p) => <span className="text-text-dim">{p.lev > 0 ? `${p.lev}×` : "—"}</span>,
  },
  {
    id: "entree",
    label: "Entrée",
    align: "right",
    rendu: (p) => <span className="text-text-dim">{formatPrice(p.entryPx)}</span>,
  },
  {
    id: "liq",
    label: "Liq.",
    align: "right",
    triable: true,
    valeurTri: (p) => p.px,
    rendu: (p) => <span className="text-text-dim">{formatPrice(p.px)}</span>,
  },
  {
    id: "compte",
    label: "Compte",
    rendu: (p) => (
      <span className="text-text-dim" title={p.addr}>
        {raccourcirAdresse(p.addr, 6, 4)}
      </span>
    ),
  },
];

function OngletPositions() {
  const [statut, setStatut] = useState<Statut>("charge");
  const [coin, setCoin] = useState<string>("BTC");
  const [reponse, setReponse] = useState<ReponseHlPositions | null>(null);
  const [tri, setTri] = useState<TriTable | null>({ colonne: "notionnel", dir: -1 });
  // Compteur de relance manuelle (bouton Réessayer — utile au démarrage à froid).
  const [relance, setRelance] = useState(0);

  const generation = useRef(0);
  useEffect(() => {
    const gen = ++generation.current;
    setStatut("charge");
    void (async () => {
      const brut = await hlPositionsGet(coin);
      if (generation.current !== gen) return; // réponse périmée (coin changé)
      if (brut === null) {
        // Daemon présent mais réponse indisponible = premier scan en cours (~1 min,
        // 150 comptes + leaderboard 34 Mo) ou échec amont → « erreur » douce, PAS
        // « sans daemon » (le feature-detect hl a répondu).
        setStatut(daemonSupporteHl() ? "erreur" : "sans-daemon");
        return;
      }
      const mappee = mapperReponsePositions(brut);
      if (mappee === null) {
        setStatut("erreur");
        return;
      }
      setReponse(mappee);
      setStatut("ok");
    })();
  }, [coin, relance]);

  const agregats = reponse?.agregats ?? null;
  const total = (agregats?.longUsd ?? 0) + (agregats?.shortUsd ?? 0);
  const partLong = total > 0 && agregats !== null ? agregats.longUsd / total : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmente options={COINS_HL.map((c) => ({ id: c, label: c }))} actif={coin} onChange={setCoin} />
        {reponse !== null && statut === "ok" && (
          <span className="ml-auto text-[10px] text-text-dim">
            {reponse.adressesScannees} comptes scannés · instantané{" "}
            <Fraicheur loading={false} majTs={reponse.ts} cadence="~5 min" cadenceMs={5 * 60_000} />
          </span>
        )}
      </div>

      {statut === "sans-daemon" && (
        <Vide>
          Les positions Hyperliquid nécessitent le daemon axiomd (leaderboard + instantané 5 min).
          <br />
          Lancer <code className="text-text">pnpm run up</code> puis rouvrir cette fenêtre.
        </Vide>
      )}
      {statut === "erreur" && (
        <Vide>
          Instantané indisponible — au premier démarrage, le scan des 150 comptes prend ~1 min.
          <br />
          <button
            type="button"
            onClick={() => setRelance((n) => n + 1)}
            className="mt-2 text-accent hover:underline"
          >
            Réessayer
          </button>
        </Vide>
      )}
      {statut === "charge" && <Chargement libelle="Scan des top comptes Hyperliquid…" />}

      {statut === "ok" && reponse !== null && agregats !== null && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <TuileStat label={`Longs (${agregats.nbLong})`} valeur={formatUsd(agregats.longUsd)} ton="up" />
            <TuileStat label={`Shorts (${agregats.nbShort})`} valeur={formatUsd(agregats.shortUsd)} ton="down" />
            <TuileStat
              label="Part long"
              valeur={partLong !== null ? `${Math.round(partLong * 100)} %` : "—"}
              ton={partLong !== null ? (partLong >= 0.5 ? "up" : "down") : undefined}
              title="Part du notionnel LONG dans l'échantillon (top leaderboard, non exhaustif)."
            />
          </div>

          {reponse.positions.length === 0 ? (
            <Vide>Aucune position exploitable sur {coin} dans l'échantillon scanné.</Vide>
          ) : (
            <div>
              <TitreSection extra={<span>top {reponse.positions.length} par notionnel</span>}>
                Positions des top comptes
              </TitreSection>
              <TableTriable
                colonnes={COLONNES_POSITIONS}
                lignes={trierLignes(reponse.positions, COLONNES_POSITIONS, tri)}
                tri={tri}
                onTri={setTri}
                cle={(p) => `${p.addr}-${p.side}-${p.px}`}
              />
            </div>
          )}
        </>
      )}

      <NoteSource>
        Échantillon : top {reponse?.adressesScannees ?? 150} comptes du leaderboard Hyperliquid, positions à
        prix de liquidation exploitable seulement — jamais « tout le marché ». Même instantané que la couche
        LIQHL (cache 5 min).{" "}
        <BadgeFiabilite niveau="partiel" label="échantillon" title="Réel mais non exhaustif : top leaderboard Hyperliquid uniquement." />
      </NoteSource>
    </div>
  );
}

// ─────────────────────────── Fenêtre ───────────────────────────

export function WhalesWindow() {
  const [onglet, setOnglet] = useState<"flux" | "positions">("flux");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EnTeteFenetre
        mnemo="WHALES"
        titre="Mouvements de baleines"
        sousTitre="Gros transferts on-chain (daemon) · positions des top comptes Hyperliquid"
      />
      <Onglets
        options={[
          { id: "flux", label: "Flux on-chain" },
          { id: "positions", label: "Positions HL" },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === "flux" ? <OngletFlux /> : <OngletPositions />}
    </div>
  );
}
