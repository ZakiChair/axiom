/**
 * Ligne « Coût Strategy » sur le chart maître (chunk paresseux) : coût moyen d'entrée déclaré
 * par Strategy (MSTR), compilé par CoinGecko, pour BTC coté en dollar seulement.
 *
 * Données = contrat du couloir CHAIN (`data/onchain/tresoreriesBtc`), chargé par `import()` à
 * la première activation : `chargerTresoreriesBtc` (un appel, cache 6 h, périmé resservi sur
 * échec) puis `resumerTresoreries().strategy.coutMoyenUsd`. Une seule ligne : le coût pondéré
 * des sociétés reste dans la tuile de CHAIN. Avoirs déclaratifs NON horodatés et coût moyen
 * historique, pas un seuil de liquidation ; un cache resservi est marqué « (périmé) », une ligne
 * gardée après une relecture en échec « (conservée du <date de récupération>) ».
 * Rafraîchissement horaire : une donnée nouvelle n'apparaît qu'à l'expiration du cache 6 h.
 */
import type { Unsubscribe } from "@axiom/types";
import { actifDeribit } from "../../data/chaineOptionsCache";
import { formatDateHeure } from "../../lib/format";
import { pousserToast } from "../../store/toasts";
import type { FournisseurLignes, LigneNiveau } from "../niveauxLignes";
import type { ContexteNiveaux } from "../niveauxOverlays";

export const RAFRAICHISSEMENT_PRIX_REVIENT_MS = 60 * 60_000;

export type ModuleTresoreries = Pick<typeof import("../../data/onchain/tresoreriesBtc"), "chargerTresoreriesBtc" | "resumerTresoreries">;

/**
 * PURE — une ligne « Coût Strategy » (suffixe « (périmé) », ou « (conservée du <date>) » qui prime
 * quand `conserveeDu` date le dernier succès gardé après un échec) ; aucune si le coût est absent ou ≤ 0.
 */
export function lignesPrixRevient(cout: number | null | undefined, perime: boolean, conserveeDu: number | null = null): LigneNiveau[] {
  if (cout == null || !(cout > 0) || !Number.isFinite(cout)) return [];
  const label =
    conserveeDu !== null
      ? `Coût Strategy (conservée du ${formatDateHeure(conserveeDu)})`
      : perime
        ? "Coût Strategy (périmé)"
        : "Coût Strategy";
  return [{ price: cout, label, couleur: "--text-dim", emphase: "forte" }];
}

export interface DepsSourcePrixRevient {
  /** Module CHAIN des trésoreries (import dynamique par défaut). */
  module?: () => Promise<ModuleTresoreries>;
  toast?: (texte: string) => void;
}

/**
 * Source « Coût Strategy » d'un slot : module CHAIN chargé au subscribe, trésoreries relues
 * toutes les heures. Un échec (null ou rejet) garde la dernière ligne, suffixée de sa date de
 * récupération et annoncée par le toast ; un marché non éligible, une absence de Strategy ou de coût
 * publié sont expliqués par toast (une fois par cause, jamais d'overlay muet).
 */
export function creerSourcePrixRevient(ctx: ContexteNiveaux, deps: DepsSourcePrixRevient = {}): FournisseurLignes {
  const module = deps.module ?? (() => import("../../data/onchain/tresoreriesBtc"));
  const toast = deps.toast ?? pousserToast;
  const eligible = actifDeribit(ctx.exchange, ctx.symbol) === "BTC";
  let lignes: LigneNiveau[] = [];
  /** Coût et date de récupération de la dernière ligne tracée ; null si le dernier succès n'en a pas. */
  let dernierSucces: { cout: number; recupereLe: number } | null = null;

  return {
    getLignes: () => lignes,
    subscribe(onChange): Unsubscribe {
      if (!eligible) {
        toast(`Coût Strategy : BTC coté en dollar seulement (trésoreries CoinGecko), pas ${ctx.symbol}`);
        return () => {};
      }
      let annule = false;
      /** Dernière cause signalée par toast ; remise à null dès qu'une ligne est tracée. */
      let causeSignalee: string | null = null;
      const signaler = (cause: string | null): void => {
        if (cause !== null && cause !== causeSignalee) toast(`Coût Strategy : ${cause}`);
        causeSignalee = cause;
      };
      const indisponible = "trésoreries CoinGecko indisponibles, nouvel essai dans 1 h";
      /** Relecture null ou rejetée (abonnement actif) : la dernière ligne reste, datée. */
      const echec = (): void => {
        if (dernierSucces === null) {
          signaler(indisponible);
          return;
        }
        lignes = lignesPrixRevient(dernierSucces.cout, false, dernierSucces.recupereLe);
        onChange();
        const date = formatDateHeure(dernierSucces.recupereLe);
        signaler(`trésoreries CoinGecko indisponibles, ligne du ${date} conservée, nouvel essai dans 1 h`);
      };
      const charge = (): void => {
        void module()
          .then(async (m) => {
            const res = await m.chargerTresoreriesBtc();
            if (annule) return;
            if (res === null) {
              echec();
              return;
            }
            const strategy = m.resumerTresoreries(res.donnee).strategy;
            lignes = lignesPrixRevient(strategy?.coutMoyenUsd, res.perime);
            dernierSucces = lignes[0] === undefined ? null : { cout: lignes[0].price, recupereLe: res.ts };
            onChange();
            if (strategy === null) signaler("Strategy absente des trésoreries CoinGecko");
            else signaler(lignes.length === 0 ? "coût moyen de Strategy non publié par CoinGecko" : null);
          })
          .catch((err: unknown) => {
            console.error("[AXIOM] trésoreries BTC indisponibles", err);
            if (!annule) echec();
          });
      };
      charge();
      const minuteur = setInterval(charge, RAFRAICHISSEMENT_PRIX_REVIENT_MS);
      return () => {
        annule = true;
        clearInterval(minuteur);
      };
    },
  };
}
