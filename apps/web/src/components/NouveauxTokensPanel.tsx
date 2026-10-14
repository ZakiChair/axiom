/**
 * Panneau « Nouveaux tokens & contrats » — détection des protocoles/tokens récemment
 * listés et évaluation fondamentale de leur potentiel sur 100 points :
 *   1. Revenus & Cash-Flow (0–25) : Frais/Revenus DefiLlama, ratios P/S et P/F, Take-rate %
 *   2. Tokenomics & Dilution (0–25) : Float % (Circulating/Total ou MCap/FDV), risque Low Float / High FDV
 *   3. Traction, TVL & Liquidité (0–25) : TVL, momentum 7j, rotation Volume 24h / MCap
 *   4. Contrat, Sécurité & Architecture (0–25) : contrat on-chain, audits, original vs fork,
 *      + inspection Etherscan v2 à la demande (code source vérifié, proxy modifiable).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  FENETRES_ANCIENNETE,
  chargerNouveauxTokens,
  evaluerPotentielToken,
  filtrerNouveauxTokens,
  inspecterContratEvm,
  type CatalogueNouveauxTokens,
  type EvaluationPotentiel,
  type FenetreAncienneteJours,
  type InspectionContratEvm,
  type NouveauToken,
  type VerdictPotentiel,
} from "../data/nouveauxTokens";
import { fetchPairs } from "../data/pairs";
import { formatPct, formatPrice, formatUsd, VALEUR_ABSENTE } from "../lib/format";
import { navigateTo } from "../lib/navigation";
import { etherscanKeyStore, getEtherscanKey } from "../store/etherscan";
import { watchlistStore } from "../store/watchlist";
import {
  Badge,
  BadgeFiabilite,
  BarreProgression,
  Bouton,
  BoutonBascule,
  BoutonRafraichir,
  Chargement,
  ErreurBloc,
  Fraicheur,
  Input,
  NoteSource,
  SegmenteCompact,
  Select,
  TitreSection,
  TuileStat,
  Vide,
  type TonBadge,
} from "./ui";
import { TableTriable, trierLignes, type ColonneTable, type TriTable } from "./TableTriable";

const CHAINES_INSPECTEUR_EVM: ReadonlyArray<{ chainId: number; label: string }> = [
  { chainId: 1, label: "Ethereum" },
  { chainId: 8453, label: "Base" },
  { chainId: 42161, label: "Arbitrum" },
  { chainId: 10, label: "Optimism" },
  { chainId: 137, label: "Polygon" },
  { chainId: 56, label: "BSC" },
  { chainId: 43114, label: "Avalanche" },
];

function tonPotentiel(verdict: VerdictPotentiel): TonBadge {
  switch (verdict) {
    case "potentiel-fort":
      return "up";
    case "potentiel-modere":
      return "accent";
    case "speculatif":
      return "warn";
    case "risque-eleve":
      return "down";
  }
}

function libellePotentiel(verdict: VerdictPotentiel): string {
  switch (verdict) {
    case "potentiel-fort":
      return "Potentiel fort";
    case "potentiel-modere":
      return "Potentiel modéré";
    case "speculatif":
      return "Spéculatif";
    case "risque-eleve":
      return "Risque élevé";
  }
}

function classeScore(score: number): string {
  if (score >= 70) return "text-up";
  if (score >= 50) return "text-accent";
  if (score >= 30) return "text-warn";
  return "text-down";
}

function formatMultiple(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  if (v >= 1000) return ">1000x";
  if (v >= 100) return `${v.toFixed(0)}x`;
  return `${v.toFixed(1)}x`;
}

function formatFloatPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return VALEUR_ABSENTE;
  return `${v.toFixed(1)}%`;
}

export function NouveauxTokensPanel() {
  const [catalogue, setCatalogue] = useState<CatalogueNouveauxTokens | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(0);

  // Filtres opérateur
  const [fenetreJours, setFenetreJours] = useState<FenetreAncienneteJours>(90);
  const [chaine, setChaine] = useState<string>("toutes");
  const [uniquementAvecContrat, setUniquementAvecContrat] = useState<boolean>(false);
  const [uniquementAvecRevenus, setUniquementAvecRevenus] = useState<boolean>(false);
  const [recherche, setRecherche] = useState<string>("");

  // Tri de la table (défaut : score de potentiel décroissant)
  const [tri, setTri] = useState<TriTable | null>({ colonne: "potentiel", dir: -1 });

  // Sélection pour la fiche détaillée
  const [selectionSlug, setSelectionSlug] = useState<string | null>(null);

  // Cache local des inspections Etherscan v2 par clé "chainId:address"
  const [inspectionsEvm, setInspectionsEvm] = useState<Record<string, InspectionContratEvm>>({});
  const [inspectionEnCoursCle, setInspectionEnCoursCle] = useState<string | null>(null);
  const ctrlInspectionSelectionRef = useRef<AbortController | null>(null);
  const ctrlInspectionManuelleRef = useRef<AbortController | null>(null);

  // Inspecteur manuel de contrat 0x
  const [adresseManuelle, setAdresseManuelle] = useState<string>("");
  const [chainIdManuel, setChainIdManuel] = useState<number>(1);
  const [inspectionManuelle, setInspectionManuelle] = useState<InspectionContratEvm | null>(null);
  const [erreurManuelle, setErreurManuelle] = useState<string | null>(null);
  const [chargementManuel, setChargementManuel] = useState<boolean>(false);

  // Paires Binance connues pour ouverture directe sur le chart
  const [pairesBinance, setPairesBinance] = useState<Set<string> | null>(null);
  const [dernierAjoutWatchlist, setDernierAjoutWatchlist] = useState<string | null>(null);

  // Abonnement réactif à la clé Etherscan
  useStore(etherscanKeyStore, (s) => s.version);

  useEffect(() => {
    return () => {
      ctrlInspectionSelectionRef.current?.abort();
      ctrlInspectionManuelleRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    void fetchPairs("binance")
      .then((list) => {
        if (!ignore) {
          setPairesBinance(new Set(list.map((p) => p.toUpperCase())));
        }
      })
      .catch(() => {
        // Non bloquant : désactive uniquement le raccourci vers le chart si absent
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    chargerNouveauxTokens({ force: tick > 0, signal: ctrl.signal })
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setCatalogue(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Échec du chargement des nouveaux tokens");
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [tick]);

  // Liste des chaînes disponibles dans les données
  const chainesDisponibles = useMemo(() => {
    if (!catalogue) return [];
    const compteurs = new Map<string, number>();
    for (const t of catalogue.tokens) {
      const c = t.contrat?.chaine ?? t.chainePrincipale;
      if (c && c !== "Multi-Chain") {
        compteurs.set(c, (compteurs.get(c) ?? 0) + 1);
      }
    }
    return [...compteurs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(([nom, count]) => ({ nom, count }));
  }, [catalogue]);

  // Enrichissement dynamique avec les inspections Etherscan v2 déjà effectuées
  const tokensEnrichis = useMemo<NouveauToken[]>(() => {
    if (!catalogue) return [];
    return catalogue.tokens.map((t) => {
      if (!t.contrat?.estEvm || !t.contrat.chainIdEvm) return t;
      const cle = `${t.contrat.chainIdEvm}:${t.contrat.adresse.toLowerCase()}`;
      const insp = inspectionsEvm[cle];
      if (!insp) return t;
      return {
        ...t,
        evaluation: evaluerPotentielToken({
          mcapUsd: t.mcapUsd,
          fdvUsd: t.fdvUsd,
          volume24hUsd: t.volume24hUsd,
          circulatingSupply: t.circulatingSupply,
          totalSupply: t.totalSupply,
          maxSupply: t.maxSupply,
          tvlUsd: t.tvlUsd,
          tvlChange7dPct: t.tvlChange7dPct,
          frais24hUsd: t.frais24hUsd,
          frais30jUsd: t.frais30jUsd,
          fraisChange7dPct: t.fraisChange7dPct,
          revenus24hUsd: t.revenus24hUsd,
          revenus30jUsd: t.revenus30jUsd,
          revenusChange7dPct: t.revenusChange7dPct,
          contrat: t.contrat,
          nbAudits: t.nbAudits,
          forkDe: t.forkDe,
          inspection: insp,
        }),
      };
    });
  }, [catalogue, inspectionsEvm]);

  const lignesFiltrees = useMemo(
    () =>
      filtrerNouveauxTokens(tokensEnrichis, {
        recherche,
        fenetreJours,
        chaine,
        uniquementAvecContrat,
        uniquementAvecRevenus,
      }),
    [tokensEnrichis, recherche, fenetreJours, chaine, uniquementAvecContrat, uniquementAvecRevenus],
  );

  // Sélection courante (par défaut le 1er token filtré)
  const tokenSelectionne = useMemo<NouveauToken | null>(() => {
    if (lignesFiltrees.length === 0) return null;
    if (selectionSlug) {
      const trouve = lignesFiltrees.find((t) => t.slug === selectionSlug);
      if (trouve) return trouve;
    }
    return lignesFiltrees[0] ?? null;
  }, [lignesFiltrees, selectionSlug]);

  const inspectionSelection = useMemo<InspectionContratEvm | null>(() => {
    if (!tokenSelectionne?.contrat?.estEvm || !tokenSelectionne.contrat.chainIdEvm) return null;
    const cle = `${tokenSelectionne.contrat.chainIdEvm}:${tokenSelectionne.contrat.adresse.toLowerCase()}`;
    return inspectionsEvm[cle] ?? null;
  }, [tokenSelectionne, inspectionsEvm]);

  // Statistiques de cohorte
  const statsCohorte = useMemo(() => {
    let revenus24h = 0;
    let frais24h = 0;
    let potentielFort = 0;
    let avecContrat = 0;
    const scores: number[] = [];

    for (const t of lignesFiltrees) {
      if (t.revenus24hUsd !== null && t.revenus24hUsd > 0) revenus24h += t.revenus24hUsd;
      if (t.frais24hUsd !== null && t.frais24hUsd > 0) frais24h += t.frais24hUsd;
      if (t.evaluation.scoreTotal >= 70) potentielFort++;
      if (t.contrat !== null) avecContrat++;
      scores.push(t.evaluation.scoreTotal);
    }

    scores.sort((a, b) => a - b);
    const scoreMedian =
      scores.length === 0
        ? null
        : scores.length % 2 === 1
          ? (scores[(scores.length - 1) / 2] ?? null)
          : Math.round(((scores[scores.length / 2 - 1] ?? 0) + (scores[scores.length / 2] ?? 0)) / 2);

    return {
      total: lignesFiltrees.length,
      revenus24h,
      frais24h,
      potentielFort,
      avecContrat,
      scoreMedian,
    };
  }, [lignesFiltrees]);

  // Inspection Etherscan v2 à la demande pour le token sélectionné (avec annulation de la requête précédente)
  const lancerInspectionSelection = (t: NouveauToken) => {
    if (!t.contrat?.estEvm || !t.contrat.chainIdEvm) return;
    ctrlInspectionSelectionRef.current?.abort();
    const ctrl = new AbortController();
    ctrlInspectionSelectionRef.current = ctrl;
    const chainId = t.contrat.chainIdEvm;
    const adresse = t.contrat.adresse;
    const cle = `${chainId}:${adresse.toLowerCase()}`;
    setInspectionEnCoursCle(cle);
    inspecterContratEvm(adresse, chainId, getEtherscanKey(), ctrl.signal)
      .then((insp) => {
        if (ctrl.signal.aborted) return;
        if (insp) {
          setInspectionsEvm((prev) => ({ ...prev, [cle]: insp }));
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setInspectionEnCoursCle((courante) => (courante === cle ? null : courante));
        }
      });
  };

  // Inspection manuelle d'une adresse 0x arbitraire (avec annulation de la requête précédente)
  const lancerInspectionManuelle = () => {
    const adr = adresseManuelle.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(adr)) return;
    ctrlInspectionManuelleRef.current?.abort();
    const ctrl = new AbortController();
    ctrlInspectionManuelleRef.current = ctrl;
    setChargementManuel(true);
    setErreurManuelle(null);
    inspecterContratEvm(adr, chainIdManuel, getEtherscanKey(), ctrl.signal)
      .then((insp) => {
        if (ctrl.signal.aborted) return;
        if (insp) {
          setInspectionManuelle(insp);
          const cle = `${chainIdManuel}:${adr.toLowerCase()}`;
          setInspectionsEvm((prev) => ({ ...prev, [cle]: insp }));
        } else {
          setInspectionManuelle(null);
          setErreurManuelle("Réponse Etherscan v2 indisponible ou limite de débit atteinte.");
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setChargementManuel(false);
        }
      });
  };

  const colonnes = useMemo<ReadonlyArray<ColonneTable<NouveauToken>>>(
    () => [
      {
        id: "token",
        label: "Token / Contrat",
        largeur: "minmax(0,1.5fr)",
        triable: true,
        valeurTri: (t) => t.symbole,
        rendu: (t) => (
          <div className="flex flex-col gap-0.5 py-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] font-semibold text-text">{t.symbole}</span>
              <span className="truncate text-[11px] text-text-dim" title={t.nom}>
                {t.nom}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-[10px] text-text-dim">
              <span className="rounded bg-bg px-1 py-0.2 text-text-dim">
                {t.contrat?.chaine ?? t.chainePrincipale}
              </span>
              {t.contrat ? (
                <span className="font-mono text-accent" title={`${t.contrat.chaine}:${t.contrat.adresse}`}>
                  {t.contrat.adresseCourte}
                </span>
              ) : (
                <span>sans contrat publié</span>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "age",
        label: "Âge",
        align: "right",
        largeur: "0.55fr",
        triable: true,
        valeurTri: (t) => t.ageJours,
        rendu: (t) =>
          t.ageJours === null ? (
            <span className="text-text-dim">{VALEUR_ABSENTE}</span>
          ) : (
            <span className={t.ageJours <= 14 ? "text-accent" : "text-text"}>
              {t.ageJours === 0 ? "< 1 j" : `${t.ageJours} j`}
            </span>
          ),
      },
      {
        id: "potentiel",
        label: "Potentiel",
        align: "right",
        largeur: "0.95fr",
        triable: true,
        valeurTri: (t) => t.evaluation.scoreTotal,
        rendu: (t) => (
          <div className="flex flex-col items-end gap-0.5">
            <Badge ton={tonPotentiel(t.evaluation.verdict)}>
              {t.evaluation.scoreTotal}/100
            </Badge>
            <span className="text-[9px] text-text-dim">
              R{t.evaluation.piliers.revenus}·T{t.evaluation.piliers.tokenomics}·L
              {t.evaluation.piliers.traction}·S{t.evaluation.piliers.securite}
            </span>
          </div>
        ),
      },
      {
        id: "revenus",
        label: "Rev / Frais 24h",
        align: "right",
        largeur: "0.95fr",
        triable: true,
        valeurTri: (t) => t.revenus24hUsd ?? t.frais24hUsd,
        rendu: (t) => {
          const rev = t.revenus24hUsd;
          const frais = t.frais24hUsd;
          const valeur = rev !== null && rev > 0 ? rev : frais;
          const estFraisSeul = (rev === null || rev === 0) && frais !== null && frais > 0;
          const multiple = t.evaluation.ratioPs ?? t.evaluation.ratioPf;
          return (
            <div className="flex flex-col items-end">
              <span className={valeur && valeur > 0 ? "text-up" : "text-text-dim"}>
                {valeur !== null && valeur > 0 ? formatUsd(valeur) : VALEUR_ABSENTE}
              </span>
              <span className="text-[9px] text-text-dim">
                {estFraisSeul ? "frais · " : ""}
                {multiple !== null ? `P/S ${formatMultiple(multiple)}` : "P/S —"}
              </span>
            </div>
          );
        },
      },
      {
        id: "tokenomics",
        label: "Float · FDV",
        align: "right",
        largeur: "0.9fr",
        triable: true,
        valeurTri: (t) => t.evaluation.floatPct,
        rendu: (t) => {
          const fl = t.evaluation.floatPct;
          const classeFl =
            fl === null
              ? "text-text-dim"
              : fl >= 60
                ? "text-up"
                : fl < 20
                  ? "text-down"
                  : "text-warn";
          const valo = t.fdvUsd ?? t.mcapUsd;
          return (
            <div className="flex flex-col items-end">
              <span className={classeFl}>{formatFloatPct(fl)}</span>
              <span className="text-[9px] text-text-dim">
                {valo !== null ? formatUsd(valo) : VALEUR_ABSENTE}
              </span>
            </div>
          );
        },
      },
      {
        id: "tvl",
        label: "TVL · 7j",
        align: "right",
        largeur: "0.85fr",
        triable: true,
        valeurTri: (t) => t.tvlUsd,
        rendu: (t) => (
          <div className="flex flex-col items-end">
            <span className="text-text">
              {t.tvlUsd !== null && t.tvlUsd > 0 ? formatUsd(t.tvlUsd) : VALEUR_ABSENTE}
            </span>
            {t.tvlChange7dPct !== null ? (
              <span className={`text-[9px] ${t.tvlChange7dPct >= 0 ? "text-up" : "text-down"}`}>
                {formatPct(t.tvlChange7dPct)}
              </span>
            ) : (
              <span className="text-[9px] text-text-dim">{VALEUR_ABSENTE}</span>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  const lignesTriees = useMemo(
    () => trierLignes(lignesFiltrees, colonnes, tri),
    [lignesFiltrees, colonnes, tri],
  );

  const infoFiabilite = useMemo(() => {
    if (!catalogue) {
      return {
        niveau: "indisponible" as const,
        title: "Sources : DefiLlama + CoinGecko + Etherscan v2",
      };
    }
    const { protocols, fees, revenue, coingecko } = catalogue.sourcesActives;
    const nbSources =
      (protocols ? 1 : 0) + (fees || revenue ? 1 : 0) + (coingecko ? 1 : 0);
    if (nbSources === 3 && !catalogue.perime) {
      return {
        niveau: "fiable" as const,
        title: "DefiLlama (Protocoles + Revenus) · CoinGecko (FDV/Float) · Etherscan v2",
      };
    }
    return {
      niveau: "partiel" as const,
      title: `Couverture partielle (${nbSources}/3 sources actives${catalogue.perime ? " · cache" : ""})`,
    };
  }, [catalogue]);

  const paireChartSelection = useMemo(() => {
    if (!tokenSelectionne) return null;
    const candidat = `${tokenSelectionne.symbole.toUpperCase()}USDT`;
    if (pairesBinance && pairesBinance.has(candidat)) return candidat;
    return null;
  }, [tokenSelectionne, pairesBinance]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5 text-xs">
      {/* En-tête de section + fraîcheur + fiabilité */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-text">
            Radar Nouveaux Tokens & Contrats On-Chain
          </span>
          <BadgeFiabilite niveau={infoFiabilite.niveau} title={infoFiabilite.title} />
          {catalogue && <Fraicheur loading={loading} majTs={catalogue.recupereLe} />}
        </div>
        <BoutonRafraichir
          onClick={() => setTick((t) => t + 1)}
          disabled={loading}
          title="Rafraîchir DefiLlama (protocoles + frais/revenus) et CoinGecko"
        />
      </div>

      {/* Synthèse KPI de la cohorte filtrée */}
      <div className="mb-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <TuileStat
          label="Nouveaux tokens"
          valeur={String(statsCohorte.total)}
          pied={`${statsCohorte.avecContrat} avec contrat on-chain`}
        />
        <TuileStat
          label="Potentiel fort (≥70)"
          valeur={String(statsCohorte.potentielFort)}
          ton={statsCohorte.potentielFort > 0 ? "up" : undefined}
          pied={
            statsCohorte.scoreMedian !== null
              ? `Score médian : ${statsCohorte.scoreMedian}/100`
              : "Score médian : —"
          }
        />
        <TuileStat
          label="Revenus 24h cohorte"
          valeur={statsCohorte.revenus24h > 0 ? formatUsd(statsCohorte.revenus24h) : VALEUR_ABSENTE}
          ton={statsCohorte.revenus24h > 0 ? "up" : undefined}
          pied="Cash-flow net protocole (24h)"
        />
        <TuileStat
          label="Frais 24h cohorte"
          valeur={statsCohorte.frais24h > 0 ? formatUsd(statsCohorte.frais24h) : VALEUR_ABSENTE}
          pied="Frais totaux payés par les utilisateurs"
        />
      </div>

      {/* Barre de filtres */}
      <div className="mb-2.5 space-y-1.5 rounded border border-border bg-surface/40 p-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-text-dim">Ancienneté</span>
            <SegmenteCompact
              options={FENETRES_ANCIENNETE}
              actif={fenetreJours}
              onChange={setFenetreJours}
              ariaLabel="Filtrer par ancienneté de listing"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <BoutonBascule
              actif={uniquementAvecContrat}
              onClick={() => setUniquementAvecContrat((v) => !v)}
              title="Afficher uniquement les tokens disposant d'une adresse de contrat vérifiable"
            >
              Contrat on-chain
            </BoutonBascule>
            <BoutonBascule
              actif={uniquementAvecRevenus}
              onClick={() => setUniquementAvecRevenus((v) => !v)}
              title="Afficher uniquement les protocoles générant des frais ou des revenus on-chain (> 0 $)"
            >
              Revenus &gt; 0
            </BoutonBascule>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="text"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher symbole, nom, catégorie ou contrat (0x…)"
            className="min-w-[180px] flex-1"
          />
          <Select
            value={chaine}
            onChange={(e) => setChaine(e.target.value)}
            aria-label="Filtrer par blockchain"
          >
            <option value="toutes">Toutes chaînes</option>
            {chainesDisponibles.map((c) => (
              <option key={c.nom} value={c.nom}>
                {c.nom} ({c.count})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error !== null && (
        <div className="mb-2">
          <ErreurBloc>{error}</ErreurBloc>
        </div>
      )}

      {loading && catalogue === null ? (
        <Chargement libelle="Analyse des nouveaux tokens, revenus et contrats en cours…" />
      ) : (
        <>
          {/* Fiche d'évaluation détaillée du token sélectionné */}
          {tokenSelectionne !== null && (
            <CarteEvaluationDetaillee
              token={tokenSelectionne}
              inspection={inspectionSelection}
              paireChart={paireChartSelection}
              inspectionEnCours={
                Boolean(
                  tokenSelectionne.contrat?.estEvm &&
                    tokenSelectionne.contrat.chainIdEvm !== null &&
                    inspectionEnCoursCle ===
                      `${tokenSelectionne.contrat.chainIdEvm}:${tokenSelectionne.contrat.adresse.toLowerCase()}`,
                )
              }
              dernierAjoutWatchlist={dernierAjoutWatchlist}
              onInspecterContrat={() => lancerInspectionSelection(tokenSelectionne)}
              onOuvrirChart={(paire) => {
                navigateTo({ symbol: paire, exchange: "binance", source: "eqs" });
              }}
              onAjouterWatchlist={(paire) => {
                watchlistStore.getState().add(paire);
                setDernierAjoutWatchlist(paire);
              }}
            />
          )}

          {/* Table triable des nouveaux tokens */}
          <div className="mt-2">
            <TitreSection
              extra={
                <span className="font-mono text-[10px] text-text-dim">
                  {lignesTriees.length} token{lignesTriees.length > 1 ? "s" : ""} · clic = fiche détaillée
                </span>
              }
            >
              Classement par potentiel fondamental
            </TitreSection>
            {lignesTriees.length === 0 ? (
              <Vide>Aucun nouveau token ne correspond aux filtres actifs.</Vide>
            ) : (
              <TableTriable
                colonnes={colonnes}
                lignes={lignesTriees}
                tri={tri}
                onTri={setTri}
                cle={(t) => t.slug}
                surClicLigne={(t) => setSelectionSlug(t.slug)}
              />
            )}
          </div>

          {/* Inspecteur direct de contrat EVM (0x...) */}
          <div className="mt-3 rounded border border-border bg-surface/30 p-2.5">
            <TitreSection>Inspecteur direct de contrat EVM (Etherscan v2)</TitreSection>
            <p className="mb-2 text-[10px] text-text-dim">
              Vérifiez n&apos;importe quelle adresse de contrat EVM (0x…) sur 7 chaînes pour contrôler la
              vérification du code source Solidity, la présence d&apos;un proxy modifiable et l&apos;offre
              totale on-chain.
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                value={String(chainIdManuel)}
                onChange={(e) => setChainIdManuel(Number(e.target.value))}
                aria-label="Chaîne EVM à inspecter"
              >
                {CHAINES_INSPECTEUR_EVM.map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    {c.label} (chainId {c.chainId})
                  </option>
                ))}
              </Select>
              <Input
                type="text"
                value={adresseManuelle}
                onChange={(e) => setAdresseManuelle(e.target.value)}
                placeholder="Coller une adresse 0x… (40 hex)"
                className="min-w-[200px] flex-1 font-mono"
              />
              <Bouton
                variante="primaire"
                disabled={chargementManuel || !/^0x[a-fA-F0-9]{40}$/.test(adresseManuelle.trim())}
                onClick={lancerInspectionManuelle}
              >
                {chargementManuel ? "Inspection…" : "Vérifier contrat"}
              </Bouton>
            </div>
            {erreurManuelle && (
              <div className="mt-2 text-[11px] text-warn">{erreurManuelle}</div>
            )}
            {inspectionManuelle && (
              <div className="mt-2 rounded border border-border bg-bg p-2 text-[11px]">
                <ResumeInspectionEvm inspection={inspectionManuelle} />
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-3 border-t border-border pt-2">
        <NoteSource>
          Sources : DefiLlama (/protocols + /overview/fees + /overview/revenue), CoinGecko (/coins/markets
          pour FDV, MCap et offre circulante/totale) et Etherscan v2 (/ethscanapi/v2/api) pour la
          vérification du code source et la détection de proxy. Le score de potentiel (0–100) est un
          indicateur analytique déterministe en 4 piliers (25 pts chacun) et ne constitue pas un conseil
          en investissement.
        </NoteSource>
      </div>
    </div>
  );
}

// ─────────────────────────── Sous-composants ───────────────────────────

function BarrePilier({
  label,
  score,
  max = 25,
  detail,
}: {
  label: string;
  score: number;
  max?: number;
  detail: string;
}) {
  const fraction = Math.max(0, Math.min(1, score / max));
  return (
    <div className="rounded border border-border bg-bg/70 p-2">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-medium text-text">{label}</span>
        <span className={`font-mono font-semibold ${classeScore((score / max) * 100)}`}>
          {score}/{max}
        </span>
      </div>
      <BarreProgression fraction={fraction} ariaLabel={label} />
      <div className="mt-1 truncate text-[10px] text-text-dim" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function ResumeInspectionEvm({ inspection }: { inspection: InspectionContratEvm }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge ton={inspection.verifie ? "up" : "down"}>
          {inspection.verifie ? "Code source vérifié" : "Code NON vérifié"}
        </Badge>
        {inspection.estProxy && (
          <Badge ton="warn">
            Proxy modifiable
          </Badge>
        )}
        {inspection.nomContrat && (
          <span className="font-mono text-[11px] font-semibold text-text">
            {inspection.nomContrat}
          </span>
        )}
        <span className="font-mono text-[10px] text-text-dim">
          (chainId {inspection.chainId} · {inspection.adresse})
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] text-text-dim">
        {inspection.compilateur && <span>Compilateur : {inspection.compilateur}</span>}
        {inspection.adresseImplementation && (
          <span>Implémentation : {inspection.adresseImplementation}</span>
        )}
        {inspection.supplyBrute && <span>TotalSupply (wei/raw) : {inspection.supplyBrute}</span>}
      </div>
    </div>
  );
}

function CarteEvaluationDetaillee({
  token,
  inspection,
  paireChart,
  inspectionEnCours,
  dernierAjoutWatchlist,
  onInspecterContrat,
  onOuvrirChart,
  onAjouterWatchlist,
}: {
  token: NouveauToken;
  inspection: InspectionContratEvm | null;
  paireChart: string | null;
  inspectionEnCours: boolean;
  dernierAjoutWatchlist: string | null;
  onInspecterContrat: () => void;
  onOuvrirChart: (paire: string) => void;
  onAjouterWatchlist: (paire: string) => void;
}) {
  const p: EvaluationPotentiel = token.evaluation;

  const revAnn =
    token.revenus30jUsd !== null && token.revenus30jUsd > 0
      ? token.revenus30jUsd * (365 / 30)
      : token.revenus24hUsd !== null && token.revenus24hUsd > 0
        ? token.revenus24hUsd * 365
        : null;
  const fraisAnn =
    token.frais30jUsd !== null && token.frais30jUsd > 0
      ? token.frais30jUsd * (365 / 30)
      : token.frais24hUsd !== null && token.frais24hUsd > 0
        ? token.frais24hUsd * 365
        : null;

  const detailRevenus =
    revAnn !== null && revAnn > 0
      ? `Rev. ann. ${formatUsd(revAnn)} · P/S ${formatMultiple(p.ratioPs)} · Take-rate ${formatFloatPct(p.takeRatePct)}`
      : fraisAnn !== null && fraisAnn > 0
        ? `Frais ann. ${formatUsd(fraisAnn)} · P/F ${formatMultiple(p.ratioPf)}`
        : "Aucun revenu ni frais indexé sur DefiLlama";

  const detailTokenomics =
    p.floatPct !== null
      ? `Float ${formatFloatPct(p.floatPct)}${p.floatPct < 20 ? " (Low Float)" : ""} · FDV/TVL ${formatMultiple(p.ratioFdvTvl)}`
      : `FDV/TVL ${formatMultiple(p.ratioFdvTvl)} · Float non communiqué`;

  const rotationVolMcap =
    token.volume24hUsd !== null && token.mcapUsd !== null && token.mcapUsd > 0
      ? (token.volume24hUsd / token.mcapUsd) * 100
      : null;

  const detailTraction = `TVL ${
    token.tvlUsd !== null && token.tvlUsd > 0 ? formatUsd(token.tvlUsd) : VALEUR_ABSENTE
  } · Δ7j ${
    token.tvlChange7dPct !== null ? formatPct(token.tvlChange7dPct) : VALEUR_ABSENTE
  } · Vol/MCap ${formatFloatPct(rotationVolMcap)}`;

  const detailSecurite = `${token.contrat ? token.contrat.adresseCourte : "Sans contrat"} · ${
    token.nbAudits > 0 ? `Audité (${token.nbAudits})` : "Non audité"
  }${token.forkDe.length > 0 ? ` · Fork (${token.forkDe[0]})` : " · Code original"}`;

  return (
    <div className="rounded border border-accent/50 bg-surface/60 p-2.5">
      {/* En-tête de la fiche */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-text">{token.symbole}</span>
            <span className="text-xs font-medium text-text">{token.nom}</span>
            <Badge ton={tonPotentiel(p.verdict)}>
              {p.scoreTotal}/100 · {libellePotentiel(p.verdict)}
            </Badge>
            {token.ageJours !== null && (
              <Badge ton="neutre">
                Listé il y a {token.ageJours === 0 ? "< 1" : token.ageJours} j
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-text-dim">
            <span>Catégorie : {token.categorie}</span>
            <span>·</span>
            <span>Chaîne : {token.contrat?.chaine ?? token.chainePrincipale}</span>
            {token.prixUsd !== null && (
              <>
                <span>·</span>
                <span className="font-mono text-text">
                  Prix : ${formatPrice(token.prixUsd)}
                  {token.changePrix24hPct !== null && (
                    <span
                      className={`ml-1 ${token.changePrix24hPct >= 0 ? "text-up" : "text-down"}`}
                    >
                      ({formatPct(token.changePrix24hPct)})
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions rapides */}
        <div className="flex flex-wrap items-center gap-1.5">
          {paireChart && (
            <>
              <Bouton variante="primaire" onClick={() => onOuvrirChart(paireChart)}>
                Chart {paireChart}
              </Bouton>
              <Bouton onClick={() => onAjouterWatchlist(paireChart)}>
                {dernierAjoutWatchlist === paireChart ? "✓ Watchlist" : "＋ Watchlist"}
              </Bouton>
            </>
          )}
          {token.contrat?.estEvm && token.contrat.chainIdEvm !== null && (
            <Bouton
              onClick={onInspecterContrat}
              disabled={inspectionEnCours}
              title="Interroger Etherscan v2 pour vérifier le code source Solidity et détecter un proxy"
            >
              {inspectionEnCours
                ? "Audit EVM…"
                : inspection
                  ? "Actualiser audit EVM"
                  : "Vérifier contrat EVM"}
            </Bouton>
          )}
          {token.contrat?.explorateurUrl && (
            <a
              href={token.contrat.explorateurUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-accent hover:border-accent"
            >
              Explorateur ↗
            </a>
          )}
        </div>
      </div>

      {/* Adresse complète du contrat si présente */}
      {token.contrat && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded bg-bg px-2 py-1 font-mono text-[10px]">
          <span className="text-text-dim">
            Contrat ({token.contrat.chaine}) :{" "}
            <span className="select-all text-text">{token.contrat.adresse}</span>
          </span>
          <span className="text-text-dim">
            {token.contrat.estEvm ? "Compatible EVM" : "Contrat non-EVM"}
          </span>
        </div>
      )}

      {/* Résultat d'inspection Etherscan v2 si disponible */}
      {inspection && (
        <div className="mt-2 rounded border border-border bg-bg p-2">
          <ResumeInspectionEvm inspection={inspection} />
        </div>
      )}

      {/* Grille des 4 piliers de notation sur 25 points */}
      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <BarrePilier
          label="1. Revenus & Cash-Flow"
          score={p.piliers.revenus}
          detail={detailRevenus}
        />
        <BarrePilier
          label="2. Tokenomics & Dilution"
          score={p.piliers.tokenomics}
          detail={detailTokenomics}
        />
        <BarrePilier
          label="3. Traction, TVL & Liquidité"
          score={p.piliers.traction}
          detail={detailTraction}
        />
        <BarrePilier
          label="4. Contrat & Sécurité"
          score={p.piliers.securite}
          detail={detailSecurite}
        />
      </div>

      {/* Métriques fondamentales détaillées (Revenus + Tokenomics) */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded bg-bg/70 px-2 py-1.5">
          <div className="text-[10px] text-text-dim">Frais (24h / 30j)</div>
          <div className="font-mono text-[11px] text-text">
            {token.frais24hUsd !== null ? formatUsd(token.frais24hUsd) : VALEUR_ABSENTE}
            {" / "}
            {token.frais30jUsd !== null ? formatUsd(token.frais30jUsd) : VALEUR_ABSENTE}
          </div>
        </div>
        <div className="rounded bg-bg/70 px-2 py-1.5">
          <div className="text-[10px] text-text-dim">Revenus (24h / 30j)</div>
          <div className="font-mono text-[11px] text-up">
            {token.revenus24hUsd !== null ? formatUsd(token.revenus24hUsd) : VALEUR_ABSENTE}
            {" / "}
            {token.revenus30jUsd !== null ? formatUsd(token.revenus30jUsd) : VALEUR_ABSENTE}
          </div>
        </div>
        <div className="rounded bg-bg/70 px-2 py-1.5">
          <div className="text-[10px] text-text-dim">MCap / FDV</div>
          <div className="font-mono text-[11px] text-text">
            {token.mcapUsd !== null ? formatUsd(token.mcapUsd) : VALEUR_ABSENTE}
            {" / "}
            {token.fdvUsd !== null ? formatUsd(token.fdvUsd) : VALEUR_ABSENTE}
          </div>
        </div>
        <div className="rounded bg-bg/70 px-2 py-1.5">
          <div className="text-[10px] text-text-dim">Float · Vol 24h</div>
          <div className="font-mono text-[11px] text-text">
            {formatFloatPct(p.floatPct)}
            {" · "}
            {token.volume24hUsd !== null ? formatUsd(token.volume24hUsd) : VALEUR_ABSENTE}
          </div>
        </div>
      </div>

      {/* Atouts & Risques identifiés automatiquement */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded border border-border bg-bg/60 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-up">
            Atouts fondamentaux ({p.atouts.length})
          </div>
          {p.atouts.length === 0 ? (
            <div className="text-[11px] text-text-dim">Aucun signal fort détecté à ce stade.</div>
          ) : (
            <ul className="space-y-0.5 text-[11px] text-text">
              {p.atouts.map((pt, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-up">+</span>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded border border-border bg-bg/60 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-warn">
            Risques & vigilance ({p.risques.length})
          </div>
          {p.risques.length === 0 ? (
            <div className="text-[11px] text-text-dim">Aucun drapeau rouge majeur détecté.</div>
          ) : (
            <ul className="space-y-0.5 text-[11px] text-text">
              {p.risques.map((rk, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <span className="text-down">!</span>
                  <span>{rk}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
