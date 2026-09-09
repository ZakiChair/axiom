import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { calculerRatiosUnlock, chargerDefillamaPro, enrichirDenominateurs, exporterCalendrier, importerCalendrier, mapperBridgeVolumes, mapperDetailEmission, mapperEmissions, typeProchainUnlock, type BridgeVolume, type DetailEmission, type TokenUnlock } from "../data/onchain/defillamaPro";
import { lireContexteMarcheCache } from "../data/marketOverview";
import { mcapStore } from "../store/mcap";
import { formatPourcentage, formatUsd, VALEUR_ABSENTE } from "../lib/format";
import { defillamaKeyStore } from "../store/defillamaKey";
import { enregistrerQualite } from "../store/qualiteMetriques";
import { QualiteMetrique } from "./QualiteMetrique";
import { Badge, Bouton, Chargement, ErreurBloc, Input, NoteSource } from "./ui";

type Mode = "unlocks" | "bridges";

function telecharger(nom: string, texte: string): void {
  const url = URL.createObjectURL(new Blob([texte], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = nom; a.click(); URL.revokeObjectURL(url);
}

export function DefillamaProPanel({ initialMode = "unlocks" }: { initialMode?: Mode }) {
  const hasKey = useStore(defillamaKeyStore, (s) => s.hasKey);
  const version = useStore(defillamaKeyStore, (s) => s.version);
  const marchesMcap = useStore(mcapStore, (s) => s.marches);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [tokens, setTokens] = useState<TokenUnlock[]>([]);
  const [bridges, setBridges] = useState<BridgeVolume[]>([]);
  const [chain, setChain] = useState("all");
  const [filtre, setFiltre] = useState("");
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailEmission | null>(null);
  const inputFichier = useRef<HTMLInputElement>(null);
  const [recupereUnlocks, setRecupereUnlocks] = useState<number | null>(null);
  const [recupereBridges, setRecupereBridges] = useState<number | null>(null);
  const [sourceUnlocks, setSourceUnlocks] = useState<"pro" | "import" | null>(null);
  const [versionUnlocks, setVersionUnlocks] = useState<number | null>(null);
  const [identiteBridges, setIdentiteBridges] = useState<{ version: number; chain: string } | null>(null);
  const [identiteDetail, setIdentiteDetail] = useState<{ version: number; id: string } | null>(null);
  const generation = useRef(0);
  const controleur = useRef<AbortController | null>(null);

  const nouvelleRequete = () => {
    controleur.current?.abort(); const controller = new AbortController(); controleur.current = controller;
    return { gen: ++generation.current, signal: controller.signal };
  };

  const chargerUnlocks = async () => {
    const { gen, signal } = nouvelleRequete();
    setLoading(true); setErreur(null);
    try {
      const raw = await chargerDefillamaPro("emissions", signal);
      if (generation.current !== gen) return;
      const base = mapperEmissions(raw);
      const contexte = marchesMcap.length > 0 ? marchesMcap : (lireContexteMarcheCache()?.coins ?? []);
      const mapped = base === null ? null : enrichirDenominateurs(base, contexte);
      if (mapped === null) throw new Error("Contrat emissions illisible.");
      const now = Date.now(); setTokens(mapped); setRecupereUnlocks(now); setSourceUnlocks("pro"); setVersionUnlocks(version);
    } catch (e) { if (generation.current === gen && !signal.aborted) setErreur(e instanceof Error ? e.message : "Données indisponibles."); }
    finally { if (generation.current === gen) setLoading(false); }
  };
  const chargerBridges = async () => {
    const { gen, signal } = nouvelleRequete();
    setLoading(true); setErreur(null);
    try {
      const mapped = mapperBridgeVolumes(await chargerDefillamaPro(`bridgevolume/${encodeURIComponent(chain)}`, signal));
      if (generation.current !== gen) return;
      if (mapped === null) throw new Error("Contrat bridges illisible.");
      setBridges(mapped); setRecupereBridges(Date.now()); setIdentiteBridges({ version, chain });
    } catch (e) { if (generation.current === gen && !signal.aborted) setErreur(e instanceof Error ? e.message : "Données indisponibles."); }
    finally { if (generation.current === gen) setLoading(false); }
  };
  const chargerDetail = async (id: string) => {
    const { gen, signal } = nouvelleRequete();
    setLoading(true); setErreur(null);
    try { const mapped = mapperDetailEmission(await chargerDefillamaPro(`emission/${id}`, signal)); if (generation.current !== gen) return; if (!mapped) throw new Error("Détail emission illisible."); setDetail(mapped); setIdentiteDetail({ version, id }); }
    catch (e) { if (generation.current === gen && !signal.aborted) setErreur(e instanceof Error ? e.message : "Détail indisponible."); }
    finally { if (generation.current === gen) setLoading(false); }
  };
  const importerFichier = async (fichier: File) => {
    controleur.current?.abort(); controleur.current = null;
    const gen = ++generation.current;
    setLoading(false); setErreur(null); setDetail(null);
    try {
      const text = await fichier.text();
      if (generation.current !== gen) return;
      const imported = importerCalendrier(text);
      if (!imported) { setErreur("Calendrier refusé : schéma, bornes ou sources HTTPS invalides."); return; }
      setTokens(imported); setRecupereUnlocks(Date.now()); setSourceUnlocks("import"); setVersionUnlocks(null);
    } catch {
      if (generation.current === gen) setErreur("Lecture du calendrier impossible.");
    }
  };

  useEffect(() => {
    controleur.current?.abort(); generation.current += 1; setLoading(false); setErreur(null); setDetail(null);
    if (mode === "unlocks" && sourceUnlocks !== "import") { setTokens([]); setRecupereUnlocks(null); setSourceUnlocks(null); }
    if (mode === "bridges") { setBridges([]); setRecupereBridges(null); }
    return () => controleur.current?.abort();
  }, [version, mode, chain]);

  // L'identité est vérifiée pendant le rendu : un changement de clé ou de chaîne
  // masque immédiatement l'ancien résultat, avant même l'effet d'annulation.
  const tokensCourants = sourceUnlocks === "import" || versionUnlocks === version ? tokens : [];
  const bridgesCourants = identiteBridges?.version === version && identiteBridges.chain === chain ? bridges : [];
  const detailCourant = mode === "unlocks" && identiteDetail?.version === version ? detail : null;
  const visibles = useMemo(() => tokensCourants.filter((t) => `${t.nom} ${t.id}`.toLowerCase().includes(filtre.toLowerCase())).slice(0, 40), [tokensCourants, filtre]);
  const importDisponible = mode === "unlocks" && sourceUnlocks === "import" && tokensCourants.length > 0;
  const observationBridge = bridgesCourants.at(-1)?.date ?? null;
  const donneesDisponibles = mode === "unlocks" ? tokensCourants.length > 0 : bridgesCourants.length > 0;
  const bridgePerime = observationBridge !== null && Date.now() - observationBridge > 2 * 86_400_000;
  const statut: "frais" | "perime" | "partiel" | "indisponible" | "en-construction" = erreur
    ? (donneesDisponibles ? "partiel" : "indisponible")
    : importDisponible || (mode === "unlocks" && donneesDisponibles)
      ? "partiel"
      : mode === "bridges" && donneesDisponibles
        ? (bridgePerime ? "perime" : "frais")
        : !hasKey ? "indisponible" : "en-construction";
  const raison = erreur
    ? `Dernier chargement en erreur : ${erreur}`
    : importDisponible
      ? "Import au schéma validé et sourcé ; date d'observation du calendrier non fournie."
      : mode === "unlocks" && donneesDisponibles
        ? "Date d'observation du calendrier non fournie par le contrat ; chaque dénominateur garde sa propre date."
        : bridgePerime ? "La dernière observation quotidienne disponible a plus de deux cadences."
          : !hasKey ? "Accès non configuré : clé personnelle DefiLlama Pro requise, ou importez un calendrier sourcé." : undefined;
  const qualite = { sourceId: importDisponible ? "import:unlocks" : `defillama-pro:${mode}`, sourceEffective: importDisponible ? "Import calendrier (schéma validé) + sources incluses" : mode === "unlocks" ? "DefiLlama Pro + contexte marché CoinGecko" : "DefiLlama Pro", observeLe: mode === "unlocks" ? null : observationBridge, recupereLe: mode === "unlocks" ? recupereUnlocks : recupereBridges, cadenceMs: mode === "bridges" ? 86_400_000 : null, couverture: null, estime: false, acces: (importDisponible ? "public" : "abonnement") as "public" | "abonnement", statut, raison };

  useEffect(() => { enregistrerQualite(`defillama:${mode}`, mode === "unlocks" ? "Calendrier unlocks" : "Flux bridges", qualite); }, [mode, qualite.sourceId, qualite.observeLe, qualite.recupereLe, qualite.statut]);

  return <section className="space-y-2 rounded border border-border bg-bg/40 p-2 text-[11px]">
    <div className="flex flex-wrap items-center gap-2">
      <Bouton onClick={() => setMode("unlocks")} variante={mode === "unlocks" ? "primaire" : undefined}>Unlocks</Bouton>
      <Bouton onClick={() => setMode("bridges")} variante={mode === "bridges" ? "primaire" : undefined}>Bridges</Bouton>
      {mode === "unlocks" ? <Input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Token…" className="w-32" /> : <Input value={chain} onChange={(e) => setChain(e.target.value)} placeholder="Chaîne" className="w-32" />}
      <Bouton disabled={!hasKey || loading} onClick={() => void (mode === "unlocks" ? chargerUnlocks() : chargerBridges())}>Charger</Bouton>
      {mode === "unlocks" && <><Bouton disabled={!tokensCourants.length} onClick={() => telecharger("axiom-unlocks-source.json", exporterCalendrier(tokensCourants))}>Exporter</Bouton><Bouton onClick={() => inputFichier.current?.click()}>Importer</Bouton><input ref={inputFichier} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importerFichier(f); e.target.value = ""; }} /></>}
    </div>
    <QualiteMetrique qualite={qualite} />
    {loading && <Chargement libelle="Chargement DefiLlama Pro…" />}{erreur && <ErreurBloc>{erreur}</ErreurBloc>}
    {mode === "unlocks" && visibles.length > 0 && <div className="max-h-40 overflow-auto"><table className="w-full"><tbody>{visibles.map((t) => { const q = t.prochaineQuantite; const prix = t.denominateurs.prixUsd; const volume = t.denominateurs.volume24hUsd; const flottant = t.denominateurs.flottantAjuste; const typeProchain = typeProchainUnlock(t); const ratios = q === null ? { pctFlottant: null, pctVolume24h: null } : calculerRatiosUnlock(q, flottant?.valeur ?? null, volume?.valeur ?? null, prix?.valeur ?? null); const notionnel = q !== null && prix !== null ? q * prix.valeur : null; return <tr key={t.id} className="border-t border-border"><td className="py-1"><span className="text-text">{t.nom}</span><div>{t.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer" className="mr-2 text-accent underline">source</a>)}{sourceUnlocks === "pro" && <button className="text-accent underline" onClick={() => void chargerDetail(t.id)}>notes / niveaux cumulés</button>}</div></td><td>{t.prochaineDate ? new Date(t.prochaineDate).toLocaleDateString("fr-FR") : VALEUR_ABSENTE}</td><td className="text-right">{q ?? VALEUR_ABSENTE} tokens<br />{notionnel === null ? VALEUR_ABSENTE : <>{formatUsd(notionnel)}<br /><span className="text-text-dim">{prix!.source} · {new Date(prix!.observeLe).toLocaleDateString("fr-FR")}</span></>}</td><td className="text-right">% flottant {ratios.pctFlottant === null ? VALEUR_ABSENTE : formatPourcentage(ratios.pctFlottant, 2)}{flottant && <><br /><a href={flottant.source} target="_blank" rel="noreferrer" className="text-accent underline">source flottant</a><span className="text-text-dim"> · {new Date(flottant.observeLe).toLocaleDateString("fr-FR")}</span></>}<br />% volume 24 h {ratios.pctVolume24h === null ? VALEUR_ABSENTE : formatPourcentage(ratios.pctVolume24h, 2)}{volume && <><br /><span className="text-text-dim">{volume.source} · {new Date(volume.observeLe).toLocaleDateString("fr-FR")}</span></>}</td><td><Badge ton={typeProchain === "cliff" ? "warn" : "neutre"}>{typeProchain === "cliff" ? "cliff" : typeProchain === "lineaire" ? "linéaire" : "type inconnu"}</Badge></td></tr>; })}</tbody></table></div>}
    {detailCourant && <div className="rounded border border-border p-2 text-text-dim"><p>{detailCourant.notes.length ? detailCourant.notes.join(" · ") : "Aucune note fournisseur."}</p><p>{detailCourant.seriesCumulees.length} série(s) de niveaux cumulés — aucune conversion automatique en cliff.</p></div>}
    {mode === "bridges" && bridgesCourants.length > 0 && <div className="max-h-40 overflow-auto"><table className="w-full"><tbody>{bridgesCourants.slice(-30).reverse().map((b) => <tr key={b.date} className="border-t border-border"><td>{new Date(b.date).toLocaleDateString("fr-FR")}</td><td className="text-right">entrants {b.entrantsUsd === null ? VALEUR_ABSENTE : formatUsd(b.entrantsUsd)}</td><td className="text-right">sortants {b.sortantsUsd === null ? VALEUR_ABSENTE : formatUsd(b.sortantsUsd)}</td><td className="text-right">net {b.netUsd === null ? VALEUR_ABSENTE : formatUsd(b.netUsd)}</td></tr>)}</tbody></table></div>}
    <NoteSource>{mode === "unlocks" ? "circSupply = offre circulante fournisseur, jamais présentée comme flottant ajusté. Les niveaux cumulés du détail ne sont pas convertis en cliffs." : "Historique quotidien par chaîne · entrants − sortants en USD. Ce net ne mesure pas les flux internes d’un protocole."}</NoteSource>
  </section>;
}
