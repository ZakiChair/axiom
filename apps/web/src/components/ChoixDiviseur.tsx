/**
 * Sélecteur « Autre actif… » du menu ÷ ▾ du bandeau, chargé à la demande (React.lazy depuis
 * SymbolBanner, chunk séparé) : divise la jambe A — le marché affiché, ou la jambe A du ratio
 * actif — par n'importe quel actif du catalogue commun, toutes sources (places crypto, actions,
 * ETF et forex Twelve Data, capitalisations).
 *
 * Même patron que PairSearch : catalogue local d'abord, puis catalogue commun ; saisie mise en
 * majuscules ; liste pilotée au clavier depuis le champ ; portail au téléphone. Un résultat
 * incompatible reste listé, grisé, avec sa raison à la place de sa source ; une saisie hors
 * catalogue se vérifie par Entrée, avec les sources automatiques du constructeur SYN. Le choix ne
 * touche jamais la préférence du bouton scindé : un diviseur libre n'y est pas enregistré.
 *
 * Fermeture : Échap (focus rendu au bouton ▾), choix posé, pointeur hors du panneau ou focus
 * parti ailleurs (sans reprendre le focus) ; un changement de marché le ferme aussi (SymbolBanner).
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ExchangeId, Timeframe } from "@axiom/types";
import { marketStore } from "../store/market";
import { syntheticsStore } from "../store/synthetics";
import { supportedTimeframesFor, timeframeProche } from "../data/adapters";
import { fetchMarketCatalog, resolveMarketCandidates, subscribeMarketCatalog, type MarketCatalog } from "../data/marketRouting";
import { optionsDiviseur, symboleRatioLibre, type ResultatRatioLibre } from "../data/choixDiviseur";
import { CATALOGUE_LOCAL, catalogueInterroge, sourceLabel } from "./PairSearch";
import { CLASSES_CHAMP, classesPanneauMenu, EnteteMenuMobile, PortailMobile } from "./ui";
import { useMobileLayout } from "../hooks/useMobileLayout";

export function ChoixDiviseur({ base, timeframe, fermer }: {
  base: { symbol: string; exchange: ExchangeId };
  timeframe: Timeframe;
  fermer: (rendreFocus: boolean) => void;
}) {
  const mobile = useMobileLayout();
  const panneauRef = useRef<HTMLDivElement>(null);
  const champRef = useRef<HTMLInputElement>(null);
  const fermerRef = useRef(fermer);
  fermerRef.current = fermer;
  const idListe = useId();
  const [saisie, setSaisie] = useState("");
  const [catalog, setCatalog] = useState<MarketCatalog>(CATALOGUE_LOCAL);
  const [indexActif, setIndexActif] = useState(0);
  /** Vérification d'une saisie hors catalogue : en cours, ou sa raison d'échec. */
  const [statut, setStatut] = useState<{ texte: string; echec: boolean } | null>(null);
  /** Génération de la vérification en cours : une frappe ou la fermeture l'abandonnent. */
  const verification = useRef(0);

  useEffect(() => {
    let monte = true;
    const desabonner = subscribeMarketCatalog((valeur) => { setCatalog(valeur); setIndexActif(0); });
    // Catalogue en panne : le local reste, et Entrée vérifie toujours la saisie.
    fetchMarketCatalog().then((valeur) => { if (monte) { setCatalog(valeur); setIndexActif(0); } }, () => {});
    // Au téléphone, le portail a déjà focalisé le champ (`focusInitial`) : sans effet.
    champRef.current?.focus();
    return () => { monte = false; verification.current += 1; desabonner(); };
  }, []);

  // Bureau : un pointeur hors du panneau ferme sans reprendre le focus. Au téléphone, le voile du
  // portail s'en charge au clic : fermer dès l'appui laisserait ce clic tomber sur le graphe.
  useEffect(() => {
    if (mobile) return;
    const surPointeur = (e: PointerEvent) => {
      if (!panneauRef.current?.contains(e.target as Node)) fermerRef.current(false);
    };
    document.addEventListener("pointerdown", surPointeur);
    return () => document.removeEventListener("pointerdown", surPointeur);
  }, [mobile]);

  const options = optionsDiviseur(catalogueInterroge(catalog, saisie), saisie, base, timeframe);
  const listeVisible = options.length > 0;

  // L'option active défile dans la liste : le focus reste au champ (`aria-activedescendant`), le
  // navigateur ne la suit donc pas, et Entrée poserait sinon un actif hors de vue (comme PairSearch).
  useEffect(() => {
    document.getElementById(`${idListe}-opt-${indexActif}`)?.scrollIntoView({ block: "nearest" });
  }, [idListe, indexActif, saisie]);

  /** Pose le ratio (unité de temps proposée la plus proche), puis ferme sans reprendre le focus. */
  const poser = (resultat: ResultatRatioLibre): void => {
    if ("refus" in resultat) return;
    syntheticsStore.getState().addRecent(resultat.symbole);
    marketStore.getState().setMarket({
      exchange: "synthetic",
      symbol: resultat.symbole,
      timeframe: timeframeProche(supportedTimeframesFor("synthetic", resultat.symbole), timeframe) ?? timeframe,
    });
    fermer(false);
  };

  /** Saisie hors catalogue : sources automatiques (premier marché réel confirmé), sinon la raison. */
  const verifier = async (symbole: string): Promise<void> => {
    const generation = ++verification.current;
    setStatut({ texte: `Vérification de ${symbole}…`, echec: false });
    let resultat: ResultatRatioLibre = { refus: `Actif indisponible : ${symbole}` };
    try {
      const jambe = (await resolveMarketCandidates({ symbol: symbole, timeframe }))
        .find((c) => c.exchange !== "synthetic" && !c.speculative);
      if (jambe) resultat = symboleRatioLibre(base.symbol, base.exchange, { exchange: jambe.exchange, symbol: jambe.symbol });
    } catch { /* résolution impossible : « Actif indisponible » */ }
    if (generation !== verification.current) return;
    if ("refus" in resultat) setStatut({ texte: resultat.refus, echec: true });
    else poser(resultat);
  };

  const surToucheChamp = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && listeVisible) {
      e.preventDefault();
      const pas = e.key === "ArrowDown" ? 1 : -1;
      setIndexActif((i) => Math.min(options.length - 1, Math.max(0, i + pas)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[indexActif];
      if (option) poser(option.resultat);
      else if (saisie.trim()) void verifier(saisie.trim());
    }
  };

  const rendreFocus = () => fermer(true);
  const texteStatut = statut?.texte ?? (saisie.trim() && !listeVisible ? "Aucun actif trouvé. Entrée pour vérifier ce symbole." : null);

  return <PortailMobile fermer={rendreFocus} focusInitial={champRef}>
    <div ref={panneauRef} role="dialog" aria-label="Diviser par un autre actif"
      onKeyDown={(e) => {
        // Échap : ici au bureau ; au téléphone, le portail l'intercepte et appelle `rendreFocus`.
        if (e.key === "Escape") { e.preventDefault(); rendreFocus(); }
        // ↑/↓ hors du champ (résultat atteint par Tab) : retour au champ, jamais la paire voisine de la watchlist.
        else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target !== champRef.current) { e.preventDefault(); champRef.current?.focus(); }
      }}
      onBlur={(e) => {
        // Bureau : focus parti vers un autre contrôle (Tab) → fermeture, comme le menu ÷ ▾. Pas au
        // téléphone : le portail y retient Tab, et son effet (rejoué en StrictMode) passe le focus
        // par le bouton ▾ avant de le rendre au champ.
        if (!mobile && e.relatedTarget !== null && !panneauRef.current?.contains(e.relatedTarget as Node)) fermer(false);
      }}
      className={`axiom-menu-mobile ${classesPanneauMenu("right", "bas")} top-full w-72`}>
      <EnteteMenuMobile titre="Autre actif" fermer={rendreFocus} />
      <p className="px-1 pb-1 text-[11px] font-semibold text-text">{`Diviser ${base.symbol} par…`}</p>
      <input ref={champRef} value={saisie} role="combobox" aria-label="Rechercher un diviseur"
        aria-expanded={listeVisible} aria-autocomplete="list" aria-controls={listeVisible ? idListe : undefined}
        aria-activedescendant={listeVisible ? `${idListe}-opt-${indexActif}` : undefined}
        onChange={(e) => { setSaisie(e.target.value.toUpperCase()); setIndexActif(0); setStatut(null); verification.current += 1; }}
        onKeyDown={surToucheChamp} placeholder="Action, ETF, crypto, devise…" autoComplete="off" spellCheck={false}
        className={`${CLASSES_CHAMP} w-full`} />
      {listeVisible && <ul id={idListe} role="listbox" aria-label="Diviseurs" className="mt-1 max-h-72 overflow-y-auto">
        {options.map(({ candidat, resultat }, i) => {
          const refus = "refus" in resultat ? resultat.refus : null;
          return <li key={`${candidat.kind}:${candidat.symbol}`} role="none"><button id={`${idListe}-opt-${i}`} type="button" role="option"
            aria-selected={i === indexActif} aria-disabled={refus !== null || undefined}
            onMouseDown={(e) => e.preventDefault()} onClick={() => poser(resultat)} onMouseEnter={() => setIndexActif(i)}
            className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs ${refus === null ? "text-text" : "cursor-not-allowed text-text-dim"} ${i === indexActif ? "bg-neutral-800" : "hover:bg-neutral-800"}`}>
            <span className="min-w-0"><span>{candidat.symbol}</span>{candidat.label && <span className="block text-[10px] text-text-dim">{candidat.label}</span>}</span>
            {/* Source : la place réellement retenue pour la jambe (`candidat.exchange`), jamais « Auto » —
                le sélecteur ne lance pas les mesures de profondeur de la recherche principale. */}
            <span className="max-w-[140px] shrink-0 text-right text-[10px] text-text-dim">{refus ?? `${candidat.kind === "perp" ? "Perp · " : ""}${sourceLabel(candidat.exchange)}`}</span>
          </button></li>;
        })}
      </ul>}
      {/* Région annoncée présente dès l'ouverture ; `hidden` plutôt qu'une classe : aucune règle CSS de plus au chargement initial. */}
      <p role="status" hidden={texteStatut === null} className={`px-1 py-1 text-[11px] ${statut?.echec ? "text-down" : "text-text-dim"}`}>{texteStatut}</p>
    </div>
  </PortailMobile>;
}
