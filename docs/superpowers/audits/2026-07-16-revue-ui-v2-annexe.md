# AXIOM — Revue UI v2 : annexe complète (findings + features)
**Générée le 2026-07-16** depuis les résultats bruts de l'audit multi-agents. Voir la synthèse dans `2026-07-16-revue-ui-v2.md`.

## Lentille : marche-derives

### Sévérité haute (2)

#### `apps/web/src/components/OptionsWindow.tsx:650` (synthese) · **verdict : CONFIRME**
- **Constat :** La ligne de fraîcheur consacrée par le standard §2 (« maj… » / « maj ~1 min ») existe en 4 variantes divergentes selon la fenêtre : impossible de lire la fraîcheur de la même façon d'une fenêtre à l'autre.
- **Preuve :** OptionsWindow:650 et TermStructureWindow:347 `maj ${formatAge(majTs, Date.now())}` (« maj il y a 12 s ») ; MarketMapWindow:415 idem + suffixe « · cache » ; CorrWindow:469 `maj ${formatHeureMinute(majTs)}` (« maj 14:32 ») ; DerivativesWindow:473 `"maj ~1 min"` (conforme spec) ; FundingMatrixWindow : aucune ligne de fraîcheur.
- **Reco :** Consacrer UNE forme (la spec dit « maj ~1 min » ; si « maj il y a X » est jugé meilleur, amender la spec) et l'extraire en primitive ui.tsx (ex. `<Fraicheur loading majTs cadence>`) utilisée par les 6 fenêtres, y compris FUNDX qui n'en a pas.
- **Note de contre-expertise :** Toutes les preuves vérifiées ligne par ligne : OptionsWindow.tsx:650 et TermStructureWindow.tsx:347 affichent `maj ${formatAge(majTs, Date.now())}` ; MarketMapWindow.tsx:414-415 ajoute le suffixe « · cache » ; CorrWindow.tsx:468-469 utilise `maj ${formatHeureMinute(majTs)}` ; DerivativesWindow.tsx:473 affiche `"maj ~1 min"` ; FundingMatrixWindow.tsx n'a aucune ligne de fraîcheur (le seul « maj » du fichier est « majuscules » dans un commentaire L237). La spec docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md §2 consacre bien la forme `{loading ? "maj…" : "maj ~1 min"}`. Les 4 variantes divergentes existent telles que décrites, aux fichiers:lignes exacts.

#### `apps/web/src/components/FundingMatrixWindow.tsx:83` (uniformite) · **verdict : CONFIRME**
- **Constat :** Le taux de funding — donnée signée par excellence — est affiché sans signe « + » et avec espace avant % (`formatDec` + « % »), alors que DerivativesWindow et ScreenerWindow affichent le même funding via `formatPct(v, 4)` (« +0.0100% »), conformément au standard §2 (« + » explicite, 4 déc., % collé).
- **Preuve :** L83 `{formatDec(v.ratePct, 4)} %` et L86 `{formatDec(v.apr, 2)} %` vs DerivativesWindow:80 `formatPct(rate * 100, 4)` et ScreenerWindow:498 `formatPct(r.fundingPct, 4)`.
- **Reco :** Remplacer `formatDec(x, n) + " %"` par `formatPct(x, 4)` (funding) et `formatPct(x, 2)` (APR, spread L60) dans FundingMatrixWindow — le code couleur `couleurSigne` reste, mais le signe doit aussi être typographique.
- **Note de contre-expertise :** FundingMatrixWindow.tsx:83 affiche `{formatDec(v.ratePct, 4)} %` et L86 `{formatDec(v.apr, 2)} %` (L60 spread idem) ; formatDec (format.ts:84) est un simple toFixed sans « + ». Le même funding est affiché via formatPct signé et collé (« +0.0100% ») dans DerivativesWindow.tsx:80 (`formatPct(rate * 100, 4)`) et ScreenerWindow.tsx:498 (`formatPct(r.fundingPct, 4)`), conformément au standard §2 de la spec (« + » explicite, 4 déc. pour le funding, style anglo collé). Seule nuance mineure : format.ts définit aussi formatPourcentage (espace avant %) pour les pourcentages « niveau » des fenêtres analytiques, mais le funding est une donnée signée explicitement couverte par la règle formatPct — le constat et la localisation sont exacts.

### Sévérité moyenne (9)

#### `apps/web/src/components/OptionsWindow.tsx:681` (uniformite)
- **Constat :** La même donnée DVOL est affichée « 62.3% » (collé, toFixed inline) dans OMON et « DVOL 62.3 % » (via formatPourcentage, espace) dans VOL : deux fenêtres, deux conventions pour un même indice.
- **Preuve :** OptionsWindow:681 `value={dvol !== null ? `${dvol.toFixed(1)}%` : "—"}` vs VolWindow:356 `morceaux.push(`DVOL ${formatPourcentage(dvolCourant, 1)}`)`.
- **Reco :** Choisir une convention pour les « niveaux » en % (la spec/format.ts destine formatPourcentage à ce cas) et l'utiliser dans les deux fenêtres : `formatPourcentage(dvol, 1)` dans OptionsWindow.

#### `apps/web/src/components/DerivativesWindow.tsx:627` (uniformite)
- **Constat :** Dans la même fenêtre, la tuile « Open Interest » Coinalyze est colorée `var(--serie-1)` (L483) mais la tuile « Open Interest » Binance est colorée avec l'hex figé OI_COLOR (#22d3ee) importé du chart : même métrique, deux couleurs, dont un hex en dur dans le JSX — exactement le défaut que le lot du 9 juillet corrigeait dans ce fichier.
- **Preuve :** L627 `color={OI_COLOR}` (chart/derivatives.ts:35 `export const OI_COLOR = "#22d3ee"`) vs L483 `color="var(--serie-1)"` pour l'OI Coinalyze.
- **Reco :** Réserver OI_COLOR aux seuls ChartToggle (lien visuel avec le sous-pane, exception documentée) et colorer la Metric OI Binance en `var(--serie-1)` comme sa jumelle Coinalyze.

#### `apps/web/src/components/DerivativesWindow.tsx:94` (uniformite)
- **Constat :** DerivativesWindow redéclare un composant local `Metric` alors que ui.Metric a été promu précisément depuis « les ex-Metric locaux de DERIV et OMON » et que son slot `extra` a été conçu pour « la sparkline de DERIV » (JSDoc de ui.tsx) : la fondation créée pour cette fenêtre est contournée.
- **Preuve :** L94 `function Metric({ label, value, color, sparkValues, sourceId })` + L92 « Markup local (badge à côté du libellé) plutôt que Metric partagé » ; ui.tsx:218-222 « Tuile … (ex-Metric locaux de DERIV et OMON) … extra accueille … (sparkline de DERIV) ».
- **Reco :** Étendre ui.Metric d'un slot `labelExtra` (ou accepter un ReactNode en label) pour loger le BadgeFiabilite, et supprimer la copie locale — sinon le prochain lot re-divergera à partir de cette copie.

#### `apps/web/src/components/CorrWindow.tsx:434` (uniformite)
- **Constat :** Les bascules Pearson/Spearman et 30/90/180j utilisent l'état actif `bg-surface text-text` dans un conteneur pill `bg-bg p-0.5`, alors que le standard §2 et toutes les autres fenêtres (Options, Dom, Onglets de ui.tsx) consacrent actif = `bg-bg text-text` : le même contrôle segmenté a deux apparences selon la fenêtre.
- **Preuve :** L434 et L449 `methode === m ? "bg-surface text-text" : "text-text-dim hover:text-text"` vs OptionsWindow:527 `vue === v ? "bg-bg text-text" : …` et spec §2 « Bascule active : bg-bg text-text ».
- **Reco :** Aligner sur le pattern segmenté d'OptionsWindow (`border border-border` + actif `bg-bg text-text`), ou promouvoir un composant `Segmente` dans ui.tsx utilisé par CORR et OMON (5 groupes segmentés recopiés inline dans OptionsWindow, 2 dans CorrWindow).

#### `apps/web/src/components/CorrWindow.tsx:418` (uniformite)
- **Constat :** Deux fenêtres récentes préfixent le titre d'en-tête par leur mnémonique (« CORR · Corrélations », « EQS · Screener ») alors que les sept autres fenêtres du groupe utilisent un titre nu (« Options », « Produits dérivés », « Volatilité », « Vue marché », « Carnet d'ordres »…).
- **Preuve :** CorrWindow:418 `titre="CORR · Corrélations"` et ScreenerWindow:277 `titre="EQS · Screener"` vs OptionsWindow:516 `titre="Options"`, DomWindow:514 `titre="Carnet d'ordres"`.
- **Reco :** Retirer le mnémonique du titre (il vit dans la palette ⌘K) : `titre="Corrélations"`, `titre="Screener"` — ou, si on veut le mnémonique partout, l'ajouter via un prop dédié d'EnTeteFenetre pour les 9 fenêtres d'un coup.

#### `apps/web/src/components/MarketMapWindow.tsx:386` (uniformite)
- **Constat :** MarketMapWindow recopie le markup d'en-tête à la main au lieu d'utiliser EnTeteFenetre, avec de petites dérives (sous-titre en `<div class="mt-1">` au lieu du `<p class="mt-0.5">` du standard) : c'est la seule des 9 fenêtres à ne pas passer par la primitive.
- **Preuve :** L386-389 `<header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3"> … <h2 …>Vue marché</h2> <div className="mt-1 flex flex-wrap …">` — EnTeteFenetre accepte pourtant un `sousTitre: ReactNode`.
- **Reco :** Remplacer le header manuel par `<EnTeteFenetre titre="Vue marché" sousTitre={<barre de métriques>}/>` — le contenu riche (Cap., dominance, F&G, fraîcheur) passe tel quel dans sousTitre.

#### `apps/web/src/components/VolWindow.tsx:370` (hierarchie)
- **Constat :** Les chiffres clés de la fenêtre VOL (RV30, DVOL, VRP, z-score) sont relégués dans une ligne unique de l'en-tête en text-[11px] text-text-dim, tronquée à 340px : la donnée la plus importante de la fenêtre est la moins visible et peut être coupée (le z-score disparaît en premier), alors que le standard offre les tuiles Metric utilisées par OMON/DERIV.
- **Preuve :** L370 `<div className="max-w-[340px] truncate text-right text-[11px] tabular-nums text-text-dim">{synthese}</div>` — synthese = `RV30 48.2 % · DVOL 62.3 % · VRP 14.1 pts · z-score RV 1.20`.
- **Reco :** Sortir la synthèse de l'en-tête et la rendre en grille de 4 `<Metric>` (comme OptionsWindow:673) au-dessus du canvas — le VRP mérite en plus une couleur up/down (IV>RV vs IV<RV).

#### `apps/web/src/components/TermStructureWindow.tsx:128` (uniformite)
- **Constat :** Le basis annualisé de TERM est affiché « +5.2 %/an » (signe « + » ajouté à la main devant formatPourcentage, espace avant %) alors que l'APR de FUNDX — même famille de donnée, un taux annualisé signé — est affiché « 12.34 % » sans signe : deux conventions pour des taux p.a. comparables, et un mélange signe-manuel/formatter qui contourne formatPct.
- **Preuve :** L128 `const pct = `${moy >= 0 ? "+" : ""}${formatPourcentage(moy * 100, 1)}/an`;` vs FundingMatrixWindow:86 `{formatDec(v.apr, 2)} %`.
- **Reco :** Utiliser `formatPct(moy * 100, 1)` + suffixe «/an » dans phraseRegime, et signer aussi l'APR de FUNDX — un taux annualisé signé suit la convention anglo signée du standard.

#### `apps/web/src/components/DomWindow.tsx:519` (uniformite)
- **Constat :** DomWindow recopie une rangée d'onglets à la main (avec `uppercase tracking-wide` en plus) au lieu de la primitive Onglets utilisée par MarketMapWindow : les onglets DOM (LADDER/DEPTH/TAPE en capitales) et MAP (Carte/Secteurs en minuscules) n'ont pas le même rendu.
- **Preuve :** L519-531 `<div className="flex items-center gap-1 border-b border-border px-3 py-1.5"> … text-[11px] uppercase tracking-wide …` vs MarketMapWindow:424 `<Onglets options={[…]} actif={tab} onChange={setTab} />`.
- **Reco :** Remplacer la rangée manuelle par `<Onglets options={[{id:"ladder",label:"Ladder"},…]}>` ; si les capitales sont voulues, ajouter l'option à la primitive plutôt que de dupliquer le markup.

### Sévérité basse (9)

#### `apps/web/src/components/VolWindow.tsx:156` (lisibilite)
- **Constat :** Les bandes du cône concatènent un suffixe alpha hex au token brut (`tk.accent + alpha`) : canvasTokens documente que les valeurs peuvent être « hex ou rgb selon le thème » — un futur thème défini en rgb()/oklch produirait une couleur invalide et des bandes p5-p95/p25-p75 invisibles, sans erreur.
- **Preuve :** L156 `ctx.fillStyle = tk.accent + alpha;` (appelé L159-160 avec "1f"/"3a") ; canvasTokens.ts:17 « valeurs brutes trimées (hex ou rgb selon le thème) ».
- **Reco :** Composer l'alpha de façon robuste comme Dom/MarketMap : parser en RVB (hexToRgb existe déjà en 2 copies) et émettre `rgba(r,g,b,0.12)` — ou mieux, mutualiser hexToRgb/rgba dans canvasTokens.ts (3ᵉ copie dans CorrWindow.hexRgb).

#### `apps/web/src/components/MarketMapWindow.tsx:412` (uniformite)
- **Constat :** L'avertissement « cache périmé » utilise la classe palette brute `text-amber-500` au lieu d'un token de thème, alors que la spec proscrit hex/palette brute hors tokens (la teinte ambre ne se réinterprète pas par thème : illisible potentiel sur « matrix » ou « cute »).
- **Preuve :** L412 `<span className={overview.stale ? "text-amber-500" : "text-text-dim"}>`.
- **Reco :** Introduire un token sémantique `--warn` (déjà nécessité par TONS_FIABILITE « partiel » de ui.tsx qui a le même défaut) défini par thème, et utiliser `text-warn`.

#### `apps/web/src/components/OptionsWindow.tsx:678` (uniformite)
- **Constat :** Plusieurs valeurs absentes sont des littéraux "—" et des toFixed inline au lieu de VALEUR_ABSENTE/formatDec de lib/format : petits helpers locaux réintroduits depuis le lot d'uniformisation.
- **Preuve :** OptionsWindow:678 `pcRatio.toFixed(2) : "—"`, L103 formatUsdExact retourne "—" littéral, L650/681/703 "—" en JSX ; ScreenerWindow:511/514 `"—" : …` et `longShortRatio.toFixed(2)`.
- **Reco :** Importer VALEUR_ABSENTE et utiliser `formatDec(pcRatio, 2)` / `formatDec(r.longShortRatio, 2)` — les formatters gèrent déjà null/NaN, la plupart des ternaires disparaissent.

#### `apps/web/src/components/CorrWindow.tsx:461` (uniformite)
- **Constat :** Les boutons secondaires recopient à la main les classes de BTN_SECONDAIRE (constante créée par le lot d'uniformisation, non importée par les 9 fenêtres) avec de micro-dérives (text-[11px] omis ici, px-2.5/px-3 ailleurs).
- **Preuve :** CorrWindow:461 `className="rounded border border-border bg-bg px-2 py-1 text-text-dim transition hover:text-text"` (≡ BTN_SECONDAIRE sans text-[11px]) ; ScreenerWindow:289 et 333 recopies équivalentes.
- **Reco :** Importer `BTN_SECONDAIRE` de ./ui pour « ↻ Recalculer », les presets et « Enregistrer » — c'est exactement son cas d'usage documenté (« recalculer, exporter, choisir… »).

#### `apps/web/src/components/FundingMatrixWindow.tsx:96` (uniformite)
- **Constat :** La NoteSource de FUNDX n'indique ni la source ni la cadence, contrairement au format consacré (« Données X, ~1 min. ») suivi par Options, TERM et MAP — et la fenêtre n'a aucune ligne de fraîcheur alors qu'elle rafraîchit toutes les 60 s.
- **Preuve :** L96-98 `<NoteSource>APR = taux × (24 / intervalle) × 365. Binance/Bybit/OKX règlent /8 h, Hyperliquid /1 h.</NoteSource>` — pas de « Données …, ~1 min. » ni d'indicateur maj.
- **Reco :** Compléter : « … Données Binance + Bybit + OKX + Hyperliquid, ~1 min. » et ajouter la ligne de fraîcheur standard dans le sous-titre ou au-dessus de la table.

#### `apps/web/src/components/FundingMatrixWindow.tsx:74` (lisibilite)
- **Constat :** L'en-tête de colonne rend un double espace : « Funding /  intervalle » (littéral « Funding / » suivi d'un `{" "}` JSX redondant).
- **Preuve :** L74 `<th className="pb-2 text-right font-medium">Funding / {" "}intervalle</th>`.
- **Reco :** Écrire simplement `Funding / intervalle`.

#### `apps/web/src/components/DerivativesWindow.tsx:86` (uniformite)
- **Constat :** Dans la même fenêtre, la part longue du ratio L/S est affichée avec 0 décimale pour le sentiment Binance (« L 65% ») mais 1 décimale pour l'agrégé Coinalyze (« L 65.0% / S 35.0% »).
- **Preuve :** L86 `L ${(p.longAccount * 100).toFixed(0)}%` vs L524 `L ${ls.longAccount.toFixed(1)}% / S ${ls.shortAccount.toFixed(1)}%`.
- **Reco :** Harmoniser à 1 décimale (ou 0) des deux côtés — idéalement via `formatPct(x, 1, {signe:false})`.

#### `apps/web/src/components/ScreenerWindow.tsx:460` (lisibilite)
- **Constat :** L'en-tête de la dernière colonne de résultats est « Wl » — abréviation cryptique (watchlist) qu'aucune autre fenêtre n'emploie, sans title/aria pour l'expliquer.
- **Preuve :** L460 `<span className="text-right text-[10px] uppercase tracking-wide text-text-dim">Wl</span>`.
- **Reco :** Remplacer par « + » avec `title="Ajouter à la watchlist"` (l'action de la colonne est déjà un bouton ＋), ou par « Watchlist » abrégé propre « WL » avec title.

#### `apps/web/src/components/MarketMapWindow.tsx:443` (uniformite)
- **Constat :** L'état de chargement de l'onglet Carte est un div ad hoc (« Chargement… » centré maison) au lieu de la primitive Chargement, et la dominance BTC/ETH utilise `toFixed(1)%` inline au lieu d'un formatter partagé.
- **Preuve :** L443 `{loading ? "Chargement…" : "Carte indisponible."}` dans un div local ; L399 `${g.btcDominance.toFixed(1)}%`.
- **Reco :** Utiliser `<Chargement/>` (quitte à le wrapper pour le centrage plein-hauteur) et `formatPct(g.btcDominance, 1, {signe:false})` ou formatPourcentage selon la convention retenue pour les niveaux.

## Lentille : macro-onchain-fund

### Sévérité haute (1)

#### `apps/web/src/components/GlobeDetailPanel.tsx:44` (uniformite) · **verdict : REFUTE**
- **Constat :** L'URL d'un événement GDELT (donnée externe non fiable, transitée par le daemon) est posée directement en href, sans le garde-fou urlHttpSure que FundWindow et NewsWindow appliquent systématiquement (convention documentée : « dupliqué ici par convention »). Une valeur javascript: deviendrait un lien cliquable.
- **Preuve :** <a href={evt.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">source ↗</a> — comparer FundWindow.tsx:101 urlHttpSure() et NewsWindow.tsx:45 (même commentaire de sécurité).
- **Reco :** Dupliquer le helper pur urlHttpSure (pattern NewsWindow) dans globeDetail.util.ts, ne rendre le lien que si le schéma est http/https, sinon omettre le lien.
- **Note de contre-expertise :** Le code cité existe bien (GlobeDetailPanel.tsx:44 rend href={evt.url} sans appel local à urlHttpSure), mais le scénario d'attaque décrit est impossible : l'URL est déjà assainie en amont, à la frontière de parsing des données du daemon. Dans apps/web/src/data/globe/gdelt.ts:21-23, le helper urlSure() ne retient une url que si elle commence par http:// ou https:// (commentaire explicite : « défense en profondeur XSS, cf. revue T5 »), et il est appliqué à gdelt.ts:70 (url: urlSure(e.url)) dans parseZone(), l'unique constructeur d'EvenementDetail. GlobeWindow.tsx:351 alimente le prop `evenements` exclusivement via chargerZoneEvenements() → parseZone(). Une valeur javascript: renvoyée par le daemon deviendrait donc null et le lien ne serait pas rendu du tout (garde evt.url !== null à la ligne 43). Le finding affirme l'absence de garde-fou ; il existe, simplement placé dans la couche data plutôt que dans le composant (à la différence de NewsWindow/FundWindow/TickerBand qui reçoivent des strings brutes et filtrent au rendu). Aucune vulnérabilité, sévérité « haute » injustifiée — au mieux une remarque cosmétique d'uniformité sur l'emplacement du garde-fou, ce qui n'est pas le constat formulé.

### Sévérité moyenne (8)

#### `apps/web/src/components/MacroRatesWindow.tsx:297` (uniformite)
- **Constat :** La bascule Tableau/Courbe (l.297) et les chips de séries de la courbe (l.330) utilisent « bg-surface » pour l'état actif, alors que le corps des fenêtres flottantes est en bg-surface (FloatingWindow.tsx:223) : le fond actif est invisible. Le standard §2 et la primitive Onglets consacrent explicitement « actif bg-bg » pour cette raison (JSDoc d'Onglets : « un pill bg-surface y serait invisible »).
- **Preuve :** vue === v.id ? "bg-surface text-text" : "text-text-dim hover:text-text" (l.296-297) et actif ? "bg-surface text-text" (l.330).
- **Reco :** Remplacer bg-surface par bg-bg sur les deux états actifs (ou réutiliser le style de bascule standard §2).

#### `apps/web/src/components/OnchainWindow.tsx:520` (uniformite)
- **Constat :** La bascule d'actif ETF (BTC/ETH/SOL) marque l'onglet actif en « bg-surface », invisible sur le corps bg-surface de la fenêtre — divergence du standard §2 (actif = bg-bg) ; seule la teinte du texte distingue l'actif.
- **Preuve :** actifEtf === a ? "bg-surface text-text" : "text-text-dim hover:text-text" (l.519-521).
- **Reco :** Passer l'état actif en bg-bg text-text, aligné sur la primitive Onglets et le standard §2.

#### `apps/web/src/components/NewsWindow.tsx:281` (uniformite)
- **Constat :** Le bouton-filtre « #SYMBOLE » utilise « bg-surface » pour l'état pressé : sur le corps bg-surface de FloatingWindow, l'état actif du filtre est invisible (seul le passage text-dim→text le signale). Standard §2 : actif = bg-bg.
- **Preuve :** filtreSymbole ? "bg-surface text-text" : "text-text-dim hover:text-text" (l.280-282, avec aria-pressed correct).
- **Reco :** Remplacer bg-surface par bg-bg pour l'état actif.

#### `apps/web/src/components/StablecoinsWindow.tsx:739` (uniformite)
- **Constat :** Fenêtre postérieure au lot : le bloc d'erreur embarque un bouton « Réessayer », alors que le standard §2 consacre une erreur textuelle « sans retry » (aucune autre fenêtre du périmètre n'en a — RATE/COT/ECO passent par le bouton ⟳ d'en-tête).
- **Preuve :** <ErreurBloc>Impossible de charger… <button className={BTN_SECONDAIRE} onClick={() => setEssai(n+1)}>Réessayer</button></ErreurBloc> (l.737-742) vs spec §2 : « Erreur : … (textuel, pas de retry) ».
- **Reco :** Retirer le bouton du bloc d'erreur et offrir le rechargement via un bouton ⟳ dans EnTeteFenetre (actions), comme MacroRatesWindow.tsx:591.

#### `apps/web/src/components/StablecoinsWindow.tsx:725` (uniformite)
- **Constat :** Les fenêtres postérieures au lot n'appliquent pas la convention de titre interne « MNEMO · Libellé » : « Stablecoins » ici, « Globe » (GlobeWindow.tsx:466), « On-chain » (OnchainWindow.tsx:350), alors que ECO/RATE/COT/FUND/NEWS/SEAG titrent « ECO · Calendrier », « RATE · Taux & Réserves », « COT · CFTC », etc.
- **Preuve :** <EnTeteFenetre titre="Stablecoins" …/> alors que le mnémonique STBL existe (commands/windowPanels.ts:188) ; idem GLOBE (store/globe-ui.ts:71) et CHAIN (store/onchain.ts:103).
- **Reco :** Uniformiser : « STBL · Stablecoins », « GLOBE · Géopolitique », « CHAIN · On-chain ».

#### `apps/web/src/components/CourbeTaux.tsx:63` (lisibilite)
- **Constat :** ctx.font = "10px var(--font-display, monospace)" : le contexte canvas 2D ne résout pas var() — l'affectation est silencieusement ignorée et le texte retombe sur « 10px sans-serif » par défaut. La police du thème et la taille demandée ne sont jamais appliquées. Même défaut dans SeasonalityWindow.tsx:120 et :176 (11px demandé, ignoré → étiquettes plus petites que prévu).
- **Preuve :** ctx.font = "10px var(--font-display, monospace)"; — un canvas ne voit pas les custom properties (raison d'être de canvasTokens.ts, qui ne couvre ici que les couleurs).
- **Reco :** Résoudre la famille via lireTokenCanvas("--font-display", "monospace") et composer ctx.font = `10px ${famille}` (idem SEAG en 11px).

#### `apps/web/src/components/GlobeWindow.tsx:81` (uniformite)
- **Constat :** lireTokensGlobe substitue --serie-5 à --serie-4 quand data-theme === "dark", dans le composant : la réinterprétation des couleurs par thème est le rôle des tokens d'index.css (spec §2 : « réinterprétées par thème »), pas d'une condition JS. Un futur thème sombre ou un ajustement de --serie-4 dark ne sera pas suivi, et le rendu ne correspond plus au token affiché ailleurs.
- **Preuve :** const themeSombre = document.documentElement.getAttribute("data-theme") === "dark"; … serie4: themeSombre ? t["--serie-5"] : t["--serie-4"] (l.81-89, justifié par le finding #41).
- **Reco :** Corriger la valeur de --serie-4 dans le thème dark d'index.css (ou introduire un token dédié, ex. --globe-coercition) et supprimer la condition JS.

#### `apps/web/src/components/StablecoinsWindow.tsx:280` (lisibilite)
- **Constat :** Le chart Impression (ligne de supply + barres mint/burn, réutilisé par Chaînes et le drill-down émetteur) n'a ni graduation d'axe Y, ni étiquette de valeur, ni repère temporel : l'ampleur de la supply et l'échelle des barres sont indevinables, contrairement à CourbeTaux qui trace grille + graduations Y.
- **Preuve :** dessinerImpression (l.280-339) ne fait aucun fillText — seuls strokeRect (cadre) et la ligne zéro sont dessinés.
- **Reco :** Ajouter des graduations Y (formatUsd) sur la moitié supply, l'échelle max des barres, et 2-3 repères de dates (formatDateCourte), pattern grille de CourbeTaux.

### Sévérité basse (8)

#### `apps/web/src/components/StablecoinsWindow.tsx:703` (ergonomie)
- **Constat :** Aucun rafraîchissement possible fenêtre ouverte : le fetch ne part qu'au montage (deps [essai], « Réessayer » réservé à l'état erreur), sans poll ni bouton ⟳ d'en-tête — alors que la NoteSource annonce « rafraîchies ~5 min » et que RATE/COT/ECO offrent tous un ⟳.
- **Preuve :** useEffect(…, [essai]) (l.703-721) ; EnTeteFenetre sans prop actions (l.725) ; NoteSource « rafraîchies ~5 min » (l.209).
- **Reco :** Ajouter le bouton ⟳ standard dans actions d'EnTeteFenetre (pattern MacroRatesWindow.tsx:590-599), branché sur setEssai.

#### `apps/web/src/components/StablecoinsWindow.tsx:368` (hierarchie)
- **Constat :** Le sélecteur de période 30j/90j/1a/Tout réutilise la primitive Onglets — conçue pour la rangée d'onglets de fenêtre (border-b pleine largeur) — au milieu du corps : deux rangées d'onglets visuellement identiques s'empilent (Vue d'ensemble/Impression/… puis 30j/90j/…), hiérarchie ambiguë. RATE utilise pour ce rôle des pills discrets alignés à droite.
- **Preuve :** <Onglets options={PERIODES.map(…)} actif={periodeId} onChange={setPeriodeId} /> (l.368-372) rendu sous l'Onglets de fenêtre (l.726).
- **Reco :** Remplacer par la bascule standard §2 (pills bg-bg actif, alignés à droite au-dessus du canvas), comme VUES_RENDEMENTS de MacroRatesWindow.

#### `apps/web/src/components/GlobeWindow.tsx:492` (lisibilite)
- **Constat :** Dans la barre de couches (qui sert de légende), la pastille « Avions » n'a pas de couleur alors que les avions sont dessinés en --serie-2 (globeRender.ts:572) ; Chokepoints (serie-3), Événements/Conflits/Ukraine (down) portent la leur — la correspondance couleur↔couche est incomplète.
- **Preuve :** <span>●</span> Avions (l.492) sans classe text-serie-2, vs <span className="text-serie-3">●</span> Chokepoints (l.481).
- **Reco :** Ajouter className="text-serie-2" à la pastille Avions.

#### `apps/web/src/components/GlobeWindow.tsx:583` (uniformite)
- **Constat :** La date PortWatch est affichée brute (« dernier point 2026-07-11 », format ISO source) dans la note de fraîcheur, alors que le standard impose les dates en fr-FR ; idem globeDetail.util.ts:30 (c.date brut dans le sous-titre chokepoint).
- **Preuve :** `(dernier point ${derniereDatePortWatch})` où derniereDatePortWatch est la chaîne date de la source (Chokepoint.date).
- **Reco :** Parser la date et passer par formatDateComplete (pattern formatDateSource de MacroRatesWindow.tsx:107).

#### `apps/web/src/components/EcoWindow.tsx:233` (uniformite)
- **Constat :** États erreur et chargement ad hoc au lieu des primitives : erreur en « border-b border-down/40 » (vs ErreurBloc rounded-md du standard) et « Chargement… » centré recodé localement (vs Chargement). Même paire ad hoc dans CotWindow.tsx:172-178.
- **Preuve :** <div className="border-b border-down/40 px-3 py-2 text-[11px] text-down">{error}</div> (l.233-234) et <div className="px-3 py-6 text-center text-[11px] text-text-dim"> (l.237).
- **Reco :** Réutiliser ErreurBloc (dans un wrapper px-3 py-2) et Chargement, comme SEAG/STBL/RATE.

#### `apps/web/src/components/MacroRatesWindow.tsx:496` (uniformite)
- **Constat :** La note de source de VueOr recopie les classes de NoteSource en dur alors que la primitive est utilisée deux fois ailleurs dans le même fichier ; même copie manuelle dans OnchainWindow.tsx:487 et CotWindow.tsx:198.
- **Preuve :** <p className="pt-1 text-[10px] leading-snug text-text-dim">Source IMF SDMX 3.0 (IRFCL)…</p> (l.496-499) vs <NoteSource> (l.421, l.434).
- **Reco :** Remplacer ces <p> par la primitive NoteSource.

#### `apps/web/src/components/StablecoinsWindow.tsx:254` (uniformite)
- **Constat :** Le prix est formaté par « e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4) » recopié quatre fois (l.254, 547, 579, 662) alors que lib/format expose formatDec(v, 4) qui gère null/non-fini exactement pour ce cas.
- **Preuve :** {e.prix === null ? VALEUR_ABSENTE : e.prix.toFixed(4)} (l.253-255, répété l.546-548, l.578-580, l.661-663).
- **Reco :** Remplacer les quatre occurrences par formatDec(e.prix, 4).

#### `apps/web/src/components/NewsWindow.tsx:80` (uniformite)
- **Constat :** Hex en dur #ec4899 pour le badge GDELT, justifié par l'exception « couleurs de MARQUE » — mais GDELT n'a pas de couleur de marque : c'est un rose de palette arbitraire ajouté côté composant, qui ignore les 5 thèmes (les couleurs des flux RSS viennent, elles, de NEWS_FEEDS côté data).
- **Preuve :** gdelt: { label: "GDELT", color: "#ec4899" } (l.80), rendu en style inline dans BadgeSource (l.99).
- **Reco :** Utiliser un token (var(--serie-4)) pour GDELT, ou déplacer la couleur dans NEWS_FEEDS avec les autres si l'exception marque est maintenue.

## Lentille : operateur

### Sévérité haute (2)

#### `apps/web/src/components/LiquidationsWindow.tsx:956` (hierarchie) · **verdict : CONFIRME**
- **Constat :** La rangée d'onglets Live/Historique est rendue AU-DESSUS de l'EnTeteFenetre, et l'en-tête (titre « Liquidations ») est dupliqué à l'intérieur de chaque onglet (lignes 544 et 834). C'est l'inverse de la convention consacrée : toutes les autres fenêtres à onglets rendent l'en-tête d'abord (StablecoinsWindow.tsx:725-726, FundWindow.tsx:370-371).
- **Preuve :** <Onglets options={ONGLETS} actif={onglet} onChange={setOnglet} />\n{onglet === "live" ? <ContenuLive /> : <ContenuHistorique />} — puis <EnTeteFenetre titre="Liquidations" …/> à l'intérieur de ContenuLive (l.544) et ContenuHistorique (l.834)
- **Reco :** Remonter un EnTeteFenetre unique au niveau de LiquidationsWindow (sous-titre variable selon l'onglet), puis <Onglets> en dessous, comme StablecoinsWindow. Les actions spécifiques (SelecteurFenetreHisto) passent dans `actions` de cet en-tête unique.
- **Note de contre-expertise :** Vérifié dans LiquidationsWindow.tsx : l.956 rend <Onglets> en premier puis le contenu d'onglet ; ContenuLive (l.544) et ContenuHistorique (l.834) rendent chacun leur propre <EnTeteFenetre titre="Liquidations"> sous les onglets — titre dupliqué et hiérarchie inversée. Les contre-exemples cités sont exacts : StablecoinsWindow.tsx:725-726 rend EnTeteFenetre puis Onglets, et FundWindow.tsx rend EnTeteFenetre (l.305) avant Onglets (l.371). Seule nuance : sous-titre et actions diffèrent par onglet (le live n'a pas d'actions dans l'en-tête, l'historique a SelecteurFenetreHisto), ce que la reco anticipe déjà.

#### `apps/web/src/components/ui.tsx:129` (uniformite) · **verdict : CONFIRME**
- **Constat :** La primitive partagée MenuDeroulant est stylée en couleurs neutral en dur (border-neutral-700, bg-neutral-900, text-neutral-100/500), alors que l'en-tête du module ui.tsx promet « Couleurs exclusivement via les tokens sémantiques » et que le standard §2 interdit les couleurs hors tokens. Sur le thème clair « cute » (index.css : --bg #fff5fb), tout réemploi de la primitive hors Toolbar produira un menu sombre figé.
- **Preuve :** className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 hover:border-neutral-500" (déclencheur) ; idem panneau l.139
- **Reco :** Passer le déclencheur et le panneau en tokens (border-border, bg-surface, text-text, text-text-dim), comme FloatingWindow.tsx:223. Si la Toolbar doit rester en chrome neutre, lui passer une classe via prop plutôt que figer les neutrals dans la primitive.
- **Note de contre-expertise :** Vérifié dans ui.tsx : l.129 le déclencheur de MenuDeroulant est bien en border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500, l.132 text-neutral-500, l.139 le panneau reprend border-neutral-700 bg-neutral-900. L'en-tête du module (l.10-11) promet « Couleurs exclusivement via les tokens sémantiques » — contradiction interne avérée dans une primitive partagée. Le thème « cute » est bien clair (index.css:223-224, --bg #fff5fb) et FloatingWindow.tsx:223 utilise bien les tokens. Précision factuelle : MenuDeroulant n'est aujourd'hui consommé que par Toolbar.tsx (FloatingWindow.tsx:53 n'est qu'un commentaire), donc l'impact visuel est latent — mais le finding le formule déjà ainsi (« tout réemploi hors Toolbar ») et le constat est exact tel que décrit.

### Sévérité moyenne (10)

#### `apps/web/src/components/LiquidationsWindow.tsx:518` (hierarchie)
- **Constat :** Dans l'onglet Live, le sélecteur 5m/1h/24h ne pilote que les stats et l'histogramme ; le feed en dessous affiche toujours les 60 derniers événements du buffer, toutes fenêtres confondues, sans aucun libellé à l'écran. Les Metric « Longs liquidés (5m) » côtoient un feed pouvant remonter à 24 h — la relation stats/feed n'est expliquée que dans la NoteSource, en bas de zone scrollable.
- **Preuve :** const feed = grouperCascades(reels.slice(-MAX_FEED).reverse()); // « indépendant de la fenêtre choisie » (commentaire l.516) alors que stats = statsLiquidations(filtres) est fenêtré
- **Reco :** Soit filtrer le feed sur la fenêtre choisie, soit ajouter un sous-titre visible au-dessus du feed (« Dernières liquidations — indépendant de la fenêtre ») pour matérialiser la frontière stats fenêtrées / feed brut.

#### `apps/web/src/components/ReplayWindow.tsx:69` (uniformite)
- **Constat :** L'état « daemon absent » a trois présentations divergentes selon la fenêtre : REPLAY affiche une boîte ambre custom hors tokens (border-amber-500/40 bg-amber-500/10 text-amber-500), LIQ affiche <Vide> + Badge neutre « daemon absent » + « npm run daemon » (LiquidationsWindow.tsx:844-849), et les Réglages un <Vide> simple (SettingsPanel.tsx:252). Wording et visuel différents pour la même situation.
- **Preuve :** <div className="m-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">Le replay nécessite le daemon axiomd (port 8787)…
- **Reco :** Consacrer un pattern unique (ex. <Vide> + <Badge ton="neutre">daemon absent</Badge> + phrase standard mentionnant la commande de démarrage) et l'appliquer aux trois fenêtres ; supprimer les classes amber-* au profit de tokens.

#### `apps/web/src/components/HealthPanel.tsx:31` (synthese)
- **Constat :** Il manque un token sémantique « warn » : le rôle avertissement est rendu par amber-500 en dur dans au moins 5 fichiers (HealthPanel.tsx:31-32/139, ReplayWindow.tsx:69, ui.tsx:322 TONS_FIABILITE.partiel, SessionStrip.tsx:111, MarketMapWindow.tsx:412) plus bg-neutral-600 pour « closed » (l.35). L'en-tête même de HealthPanel affirme « couleurs via tokens de thème uniquement (aucun hex en dur) » — contredit par le code, et l'ambre ne se réinterprète pas par thème (matrix, cute).
- **Preuve :** stale: "bg-amber-500", reconnecting: "bg-amber-500", … closed: "bg-neutral-600" — alors que le doc du fichier (l.19-20) promet tokens uniquement
- **Reco :** Ajouter un token --warn (et éventuellement --muted) par thème dans index.css (comme --serie-1…6 du lot), puis migrer HealthPanel, ReplayWindow, ui.tsx (BadgeFiabilite), SessionStrip et MarketMapWindow. Mettre à jour HealthPanel.test.ts qui fige ces classes.

#### `apps/web/src/components/BacktestWindow.tsx:335` (uniformite)
- **Constat :** L'aire de drawdown concatène un alpha hexadécimal à la valeur d'un token (`colDown + "33"`), alors que canvasTokens.ts documente que les tokens sont « hex ou rgb selon le thème ». Si un thème déclare --down en rgb()/hsl(), le fillStyle devient invalide (silencieusement ignoré). Les autres canvas du repo utilisent ctx.globalAlpha (StablecoinsWindow, CourbeTaux, TermStructureWindow, CorrWindow).
- **Preuve :** ctx.fillStyle = colDown + "33"; // aire semi-transparente — seul cas de ce pattern dans src/ (grep)
- **Reco :** Remplacer par ctx.globalAlpha = 0.2 autour du fill (puis restaurer 1), aligné sur le pattern des autres canvas.

#### `apps/web/src/components/BacktestWindow.tsx:492` (uniformite)
- **Constat :** Des pourcentages sont reformés à la main au lieu des helpers de lib/format, réintroduisant exactement la duplication que le lot du 9/07 a éliminée, avec des styles divergents : `toFixed(1)%` collé (BT l.492/499/501), `toFixed(0)%` (PortfolioWindow.tsx:578) et `toFixed(1)} %` avec espace (ReplayWindow.tsx:225) — mélange « % » collé vs « % » espacé dans la même famille d'écrans.
- **Preuve :** value={`${s.winRatePct.toFixed(1)}%`} … value={`${s.maxDrawdownPct.toFixed(1)}%`} … value={`${s.expositionPct.toFixed(0)}%`} ; ReplayWindow : {(s.progression * 100).toFixed(1)} %
- **Reco :** Utiliser formatPct(x, n, { signe: false }) pour les taux collés (win rate, drawdown, exposition, progression) ou formatPourcentage pour les « niveaux », et supprimer les toFixed manuels.

#### `apps/web/src/components/PortfolioWindow.tsx:453` (ergonomie)
- **Constat :** Les patterns de suppression destructive divergent d'une fenêtre à l'autre : PortfolioWindow supprime une position OUVERTE d'un seul clic sur ✕ (adjacent au bouton « Clôturer », sans confirmation), AlertsPanel supprime aussi sans confirmation (l.223), NotesWindow passe par window.confirm natif (NotesWindow.tsx:108), et les Réglages utilisent une confirmation en deux temps (SettingsPanel.tsx:218-232). Quatre comportements pour la même action.
- **Preuve :** onClick={() => portfolioStore.getState().supprimer(p.id)} … aria-label={`Supprimer ${p.symbole}`} — aucun confirm, position ouverte perdue en un clic
- **Reco :** Consacrer le pattern « armement 2 temps » des Réglages (1er clic arme + Badge, 2e clic supprime) pour toute destruction non triviale (position, note, alerte), et retirer window.confirm de NotesWindow.

#### `apps/web/src/components/PortfolioWindow.tsx:170` (ergonomie)
- **Constat :** Le formulaire d'ajout de position ignore silencieusement une saisie invalide : cliquer « Ajouter » avec taille/prix vides ou invalides ne fait rien, sans aucun feedback. Même défaut dans AlertsPanel.soumettre (returns muets l.113/117/121/137/147).
- **Preuve :** return; // saisie invalide : on ignore (dégradation silencieuse)
- **Reco :** Désactiver le bouton (disabled + opacity-40) tant que la saisie est invalide, comme le fait déjà BacktestWindow pour « Enregistrer » (presetName.trim().length === 0), ou afficher un message inline text-down.

#### `apps/web/src/components/PortfolioWindow.tsx:276` (uniformite)
- **Constat :** PortfolioWindow n'importe pas BTN_SECONDAIRE et redéfinit des variantes ad hoc de boutons secondaires qui divergent du standard §2 : bg-surface au lieu de bg-bg, px-2 py-0.5 text-[10px] au lieu de px-2 py-1 text-[11px], hover:text-accent au lieu de hover:text-text (l.276, 285, 361, 384, 446, 479, 560).
- **Preuve :** className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text-dim transition hover:text-accent" (Import CSV) vs BTN_SECONDAIRE = "rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text"
- **Reco :** Remplacer ces classes par la constante BTN_SECONDAIRE de ui.tsx (déjà utilisée par BriefWindow, BacktestWindow, SettingsPanel) ; garder au plus une variante compacte si la densité l'exige, mais partagée.

#### `apps/web/src/components/BriefWindow.tsx:339` (ergonomie)
- **Constat :** Le clic sur un trade clos de la review navigue en dur vers exchange:"binance", alors que Position.source existe précisément « pour voir sur le chart » (store/portfolio.ts:42) et que PortfolioWindow restaure p.source (l.220-221). Un trade clôturé sur un autre exchange ouvre le mauvais marché ; TradeClosBrief (data/brief.ts:106) perd le champ source.
- **Preuve :** onClick={() => navigateTo({ symbol: t.symbole, exchange: "binance", source: "brief" })}
- **Reco :** Propager `source: ExchangeId` dans TradeClosBrief (assemblerSession) et l'utiliser dans navigateTo, à l'identique de voirSurChart de PortfolioWindow.

#### `apps/web/src/components/MacroPanel.tsx:128` (uniformite)
- **Constat :** Les cases à cocher des overlays macro sont teintées `accent-emerald-500` en dur (l.128 et 298) : le vert émeraude reste figé sur les 5 thèmes (rose « cute », vert « matrix », etc.), alors que ReplayWindow utilise déjà `accent-accent` pour son slider (l.221).
- **Preuve :** className="h-3 w-3 accent-emerald-500"
- **Reco :** Remplacer les deux occurrences par `accent-accent` (token du thème).

### Sévérité basse (7)

#### `apps/web/src/components/BacktestWindow.tsx:692` (uniformite)
- **Constat :** Registre FR incohérent : ce message tutoie (« Clique « Charger 2 ans 1d » ») alors que tout le reste de l'UI vouvoie (SettingsPanel:400 « Saisissez », ReplayWindow:71 « Démarrez-le puis rouvrez », PortfolioWindow:407 « Ajoutez-en une », NotesWindow:200 « Créez-en une »).
- **Preuve :** run possible dès {MIN_BOUGIES}). Clique « Charger 2 ans 1d » pour précharger ~730
- **Reco :** « Cliquez « Charger 2 ans 1d »… » pour aligner sur le vouvoiement dominant.

#### `apps/web/src/components/LiquidationsWindow.tsx:651` (lisibilite)
- **Constat :** La NoteSource de l'onglet Live est un paragraphe de ~6 lignes mêlant source, glossaire (« Long = position longue fermée de force ») et mode d'emploi (cascades ×N, clic), loin du format standard une ligne (« Données X, ~1 min. »). En text-[10px], ce bloc est peu lisible et noie l'information de source.
- **Preuve :** <NoteSource>Flux de liquidations Bybit (canal allLiquidation) et OKX (canal liquidation-orders) en direct, complétés par l'historique local… Cliquer une liquidation la montre sur le graphe (recentrage + flash de la bande).</NoteSource>
- **Reco :** Réduire la NoteSource à la source/cadence (« Flux Bybit + OKX en direct · même source que la heatmap. ») et déplacer le mode d'emploi vers les tooltips déjà présents (title des lignes et des groupes).

#### `apps/web/src/components/LiquidationsWindow.tsx:763` (ergonomie)
- **Constat :** Incohérence d'affordance dans la même fenêtre : LigneTop (top 10 Historique) reprend exactement les codes visuels de LigneFeed (barre de magnitude, gras, badges) mais n'est pas cliquable, alors que toutes les lignes du feed Live naviguent vers le graphe (voirSurGraphe). L'utilisateur s'attend au même geste.
- **Preuve :** return (<div className="relative border-b border-border/40"> … ) — div simple, sans onClick ni title, vs LigneFeed: <button … onClick={() => voirSurGraphe(ev)} title="Voir sur le graphe">
- **Reco :** Rendre LigneTop cliquable avec voirSurGraphe (les timestamps ≤30 j sont atteignables via scrollToTimestamp), ou expliciter visuellement la non-interactivité (pas de hover:bg-bg).

#### `apps/web/src/components/LiquidationsWindow.tsx:837` (uniformite)
- **Constat :** Placement incohérent du même contrôle entre les deux onglets : en Live, le sélecteur de fenêtre est sur une rangée dédiée sous l'en-tête (l.551-556) ; en Historique, SelecteurFenetreHisto est dans `actions` de l'en-tête. Le repère spatial change quand on bascule d'onglet.
- **Preuve :** actions={<SelecteurFenetreHisto fenetre={fenetre} onChange={setFenetre} />} (Historique) vs <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-2"><SelecteurFenetre …/> (Live)
- **Reco :** Uniformiser : même emplacement pour les deux sélecteurs de fenêtre (rangée de contrôles sous l'en-tête, l'Historique n'ayant qu'un contrôle peut aussi y vivre) — se règle naturellement avec la fusion de l'en-tête (finding sur l.956).

#### `apps/web/src/components/BacktestWindow.tsx:477` (synthese)
- **Constat :** La tuile « libellé au-dessus / valeur en dessous » est re-bricolée localement dans au moins deux fenêtres post-lot : StatCard ici (l.477-485) et les trois totaux de PortfolioWindow (l.294-305), avec le même markup (text-[10px] uppercase tracking-wider text-text-dim + tabular-nums text-sm font-medium). La primitive Metric de ui.tsx ne couvre que la variante inline.
- **Preuve :** function StatCard({ label, value, ton }… <div className="rounded-md border border-border bg-bg px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-text-dim">…
- **Reco :** Ajouter une variante empilée à Metric (prop `empile` ou primitive MetricCarte dans ui.tsx) et migrer StatCard + les totaux du portefeuille.

#### `apps/web/src/components/SettingsPanel.tsx:381` (lisibilite)
- **Constat :** Le sous-titre du panneau Réglages (« Clés API et apparence ») est périmé : le panneau contient désormais aussi les sections Aide (Onboarding) et Sauvegardes (snapshots daemon, ajoutées par la feature SAVE).
- **Preuve :** <p className="text-[11px] text-text-dim">Clés API et apparence</p> — alors que le corps rend « Aide » (l.483) et <SauvegardesSection/> (l.505)
- **Reco :** Mettre à jour le sous-titre, ex. « Clés API, apparence, sauvegardes ».

#### `apps/web/src/components/AlertsPanel.tsx:65` (uniformite)
- **Constat :** L'état « déclenchée » d'une alerte est coloré avec `text-serie-3`, un token de SÉRIE non sémantique (réservé par le standard §2 aux couleurs de séries de graphes, réinterprétées librement par thème) : sur matrix, serie-3 (#7cfc00) est quasi identique à up, brouillant la distinction armée/déclenchée.
- **Preuve :** if (arme) return { texte: "armée", classe: "text-up" }; return { texte: "déclenchée", classe: "text-serie-3" };
- **Reco :** Utiliser un token sémantique (text-accent, ou le futur token --warn du finding HealthPanel) pour l'état déclenché.

## Lentille : chrome-shell

### Sévérité haute (2)

#### `apps/web/src/components/ui.tsx:181` (uniformite) · **verdict : CONFIRME**
- **Constat :** Les modificateurs d'opacité Tailwind sur les tokens de thème ne génèrent AUCUNE règle CSS : les couleurs sont déclarées en chaînes `var(--…)` sans `<alpha-value>` dans tailwind.config.js, donc Tailwind v3 n'émet pas les variantes `/NN`. Toutes les classes `border-down/40`, `border-up/50`, `bg-accent/10..30`, `bg-surface/80..85`, `border-accent/50..60` (15+ fichiers, dont ErreurBloc et BadgeFiabilite du module standard, OnboardingOverlay, SnapOverlay, ChartInstance) sont des no-op. Les bordures retombent sur le défaut preflight #e5e7eb (gris clair) — l'ErreurBloc consacré par le standard §2 n'a jamais sa bordure rouge adoucie.
- **Preuve :** ui.tsx:181 `border border-down/40` ; le CSS buildé du jour (apps/web/dist/assets/index-Cjk8Lmih.css, 2026-07-16) ne contient aucune règle `down\/40`, `accent\/15`, `surface\/80` (grep = 0 occurrence), seuls `bg-black/60|70` existent ; preflight : `border-color:#e5e7eb`. Taskbar.tsx:26-27 documente déjà le problème (« PAS de slash /60 sur un token de thème — non fiable »).
- **Reco :** Déclarer les tokens avec support alpha dans tailwind.config.js (ex. `down: "rgb(var(--down-rgb) / <alpha-value>)"` + variables `--down-rgb` par thème), ou bannir les slashes sur tokens (règle lint) et introduire des tokens dérivés (`--down-soft`, `--surface-glass`) utilisés en classes pleines. Mettre à jour le standard §2 qui consacre `border-down/40`.
- **Note de contre-expertise :** Vérifié de bout en bout. tailwind.config.js déclare tous les tokens en chaînes `var(--…)` sans `<alpha-value>` (Tailwind ^3.4.13) ; ui.tsx:181 contient bien `border border-down/40` (ErreurBloc). Le CSS buildé dist/assets/index-Cjk8Lmih.css (16 juil., 33 Ko) contient 0 règle pour down\/40, accent\/15, surface\/80 alors que 17 fichiers src utilisent ces modificateurs ; seuls bg-black\/60|70 (palette native) sont émis ; le preflight `border-color:#e5e7eb` est présent, donc les bordures retombent sur le gris clair. Preuves annexes exactes : BadgeFiabilite (ui.tsx:321-324) utilise border-up/50, border-down/50 et border-amber-500/50 (amber-500 étant lui-même remappé sur var(--ui-amber), donc cassé aussi) ; le standard docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md:27 consacre bien `border border-down/40` ; Taskbar.tsx:26-27 documente déjà la non-fiabilité du slash. Bug réel, systémique, exactement tel que décrit.

#### `apps/web/src/components/CommandPalette.tsx:263` (ergonomie) · **verdict : CONFIRME**
- **Constat :** La ligne sélectionnée au clavier dans la palette ⌘K n'a aucun surlignage visible : sa seule classe d'état est `bg-accent/15`, qui n'existe pas dans le CSS généré (cf. finding tokens/alpha). L'utilisateur navigue avec ↑/↓ à l'aveugle avant de valider avec ⏎.
- **Preuve :** `i === indexSel ? "bg-accent/15" : "hover:bg-bg"` (CommandPalette.tsx:263) ; aucune règle `.bg-accent\/15` dans apps/web/dist/assets/index-Cjk8Lmih.css.
- **Reco :** Remplacer par une classe fonctionnelle existante (ex. `bg-bg` + bordure gauche `border-l-2 border-accent`, pattern déjà utilisé par la Watchlist ligne sélectionnée), ou corriger le support alpha des tokens. Ajouter au passage role="listbox"/"option" + aria-activedescendant sur la liste.
- **Note de contre-expertise :** Vérifié : CommandPalette.tsx:263 contient exactement `i === indexSel ? "bg-accent/15" : "hover:bg-bg"`, seule différenciation visuelle de la ligne sélectionnée, et aucune règle `.bg-accent\/15` n'existe dans dist/assets/index-Cjk8Lmih.css (grep = 0) — la classe est un no-op, la ligne sélectionnée n'a aucun surlignage. Seule nuance mineure (n'invalide pas la sévérité) : le pied de palette affiche l'aperçu de la commande sélectionnée (ligne 280, ~67 commandes définissent un `apercu`), donc la navigation ↑/↓ a un léger retour textuel indirect ; mais l'affordance principale — le surlignage de ligne — est bien absente, au fichier:ligne exacts cités.

### Sévérité moyenne (6)

#### `apps/web/src/components/SymbolBanner.tsx:189` (lisibilite)
- **Constat :** Le bandeau prix/H-L/volume superposé au chart est censé avoir un fond semi-opaque (`bg-surface/80`), mais cette classe n'est pas générée : le bandeau est transparent (seul le backdrop-blur agit), le texte 12px se lit par-dessus les bougies et le quadrillage. Même défaut sur l'indice plein écran (App.tsx:280 `bg-surface/80`) et la barre flottante de ChartGrid (ChartGrid.tsx:142 `bg-surface/85`).
- **Preuve :** SymbolBanner.tsx:189 `rounded border border-border bg-surface/80 … backdrop-blur-sm` ; grep `surface\/80` dans le CSS buildé = 0 occurrence.
- **Reco :** Fond garanti : `bg-surface` plein, ou `style={{ background: "color-mix(in srgb, var(--surface) 80%, transparent)" }}`, ou tokens avec `<alpha-value>` (cf. finding racine).

#### `apps/web/src/components/Toolbar.tsx:634` (uniformite)
- **Constat :** Deux couleurs Tailwind brutes non remappées par thème introduites après le standard : le toggle « Liq » actif en `bg-violet-500` (commit dc452e0) et le mnémonique des Playbooks en `text-sky-400` (lot menus). Contrairement à emerald/cyan/amber (mappées sur --ui-* par thème dans tailwind.config.js:59-68), violet et sky gardent leur hex Tailwind sur les 5 thèmes — criard sur « cute » (clair) et hors palette sur bloomberg/matrix. Le standard §2 impose tokens ou --serie-1…6 pour ces cas.
- **Preuve :** Toolbar.tsx:634 `? "bg-violet-500 text-accent-ink"` et Toolbar.tsx:249 `text-sky-400` ; tailwind.config.js ne mappe ni violet ni sky ; `git merge-base --is-ancestor 3ce9b83 dc452e0` confirme la postériorité au standard.
- **Reco :** Ajouter `--ui-violet` (et une teinte pour les mnémoniques Playbooks) réinterprétés par thème dans index.css + tailwind.config.js, ou réutiliser `text-serie-2`/`bg-serie-2` déjà thémés.

#### `apps/web/src/components/Toolbar.tsx:464` (uniformite)
- **Constat :** Les quatre bandeaux de chrome empilés n'ont ni le même fond ni le même vocabulaire : la Toolbar est en rampe neutre (`border-neutral-800 bg-neutral-950` = --bg) alors que SessionStrip, TickerBand et la Taskbar récente sont en tokens sémantiques (`border-border bg-surface`). Sur dark, la Toolbar (#0a0a0a) est plus sombre que les trois autres barres (#171717). Les boutons divergent aussi : pastilles Taskbar `rounded border border-border bg-bg text-[11px]` vs boutons Toolbar `bg-neutral-800 text-xs` sans bordure.
- **Preuve :** Toolbar.tsx:464 `border-b border-neutral-800 bg-neutral-950` vs Taskbar.tsx:53 `border-t border-border bg-surface` et SessionStrip.tsx:124 `border-b border-border bg-surface`.
- **Reco :** Migrer le conteneur Toolbar sur `border-border bg-surface` et rapprocher le style de ses boutons du bouton standard (BTN_SECONDAIRE / pastilles Taskbar) pour un chrome vertical homogène.

#### `apps/web/src/components/Watchlist.tsx:340` (ergonomie)
- **Constat :** Le menu ⚙ des colonnes est un dropdown ad hoc qui ignore la primitive MenuDeroulant consacrée : pas de fermeture sur Échap (seulement clic extérieur, effet lignes 295-302), pas de role="menu"/menuitem, pas de navigation ↑/↓, pas de retour de focus au déclencheur. Divergence de comportement avec les menus Fonctions/Playbooks/Workspaces de la Toolbar migrés au même lot (commit 244f1bd).
- **Preuve :** Watchlist.tsx:341-375 (`<div ref={menuRef} className="relative">` + useEffect 295-302 qui n'écoute que `mousedown`) ; aucun `Escape` ni `role` dans le bloc.
- **Reco :** Remplacer par `<MenuDeroulant align="right" declencheur="⚙">` avec les checkboxes en items (role="menuitem"), comme les menus Toolbar — Échap, clic extérieur et roving offerts gratuitement.

#### `apps/web/src/components/PairSearch.tsx:218` (ergonomie)
- **Constat :** La liste de résultats de recherche de paires n'a aucune navigation clavier : ↓/↑ ne descendent pas dans les résultats, Entrée prend silencieusement le premier match sans indication visuelle de ce qui sera choisi, et aucun attribut ARIA (aria-expanded, role listbox/option) n'expose l'état. Divergence avec la CommandPalette (index sélectionné + ↑/↓) et MenuDeroulant (roving).
- **Preuve :** PairSearch.tsx:188-192 `if (e.key === "Enter") choose(matches[0] ?? query)` — seules touches gérées : Enter/Escape ; liste `<ul>` (l.218) sans role ni gestion de sélection.
- **Reco :** Ajouter un index de sélection (↑/↓ + surbrillance de la ligne, Entrée = ligne sélectionnée) et role="listbox"/"option" + aria-expanded sur l'input, en s'alignant sur le pattern CommandPalette.

#### `apps/web/src/components/Taskbar.tsx:97` (ergonomie)
- **Constat :** Actions révélées uniquement au survol souris, incohérentes entre elles et inaccessibles au clavier : le ✕ de fermeture des pastilles Taskbar est en `hidden group-hover:flex` (display:none → jamais focalisable), tandis que les ▲/▼/× de la Watchlist sont en `opacity-0 group-hover:opacity-100` (focalisables mais invisibles au focus clavier, le ring entoure un glyphe transparent).
- **Preuve :** Taskbar.tsx:97 `…hidden h-4 w-4 … group-hover:flex` ; Watchlist.tsx:483 `flex w-3 shrink-0 flex-col opacity-0 transition group-hover:opacity-100` (idem :540 pour ×).
- **Reco :** Uniformiser sur le pattern révélable ET focalisable : `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` (+ `group-focus-within:opacity-100`), et l'appliquer aux deux composants ; supprimer le `hidden` de la Taskbar.

### Sévérité basse (4)

#### `apps/web/src/components/DrawingToolbar.tsx:278` (ergonomie)
- **Constat :** Le panneau « Réglages Fibonacci » ne se ferme pas sur Échap, contrairement à toutes les autres surfaces flottantes du chrome (MenuDeroulant, palette ⌘K, onboarding, menu couleur de FloatingWindow) : seuls le clic sur le fond z-40 et le ✕ ferment.
- **Preuve :** FibSettingsPanel (DrawingToolbar.tsx:244-365) : aucun listener `keydown`/`Escape` ; fermeture uniquement via `<div onClick={onClose} className="fixed inset-0 z-40" />` (l.278) et le bouton ✕ (l.298-305).
- **Reco :** Ajouter un useEffect keydown Escape → onClose (avec retour de focus au bouton Réglages Fibo), comme dans MenuDeroulant (ui.tsx:93-98).

#### `apps/web/src/components/SnapOverlay.tsx:15` (uniformite)
- **Constat :** Échelle de z-index du chrome hétérogène et non documentée : SnapOverlay saute à z-[9999] alors que tout le reste vit dans une bande cohérente (fenêtres 1–39, menus/toasts/settings 50, palette 60, onboarding 70). Par ailleurs les Toasts (z-50) passent SOUS le backdrop de la palette (z-60) et de l'onboarding (z-70) : un feedback poussé pendant leur affichage est assombri/illisible. L'aperçu snap lui-même a perdu son remplissage (`bg-accent/20` non généré, cf. finding alpha).
- **Preuve :** SnapOverlay.tsx:15 `z-[9999] … border-accent bg-accent/20` vs CommandPalette.tsx:194 `z-[60]`, OnboardingOverlay.tsx:104 `z-[70]`, Toasts.tsx:20 `z-50`, windowManager.ts:122-123 `WINDOW_Z_MIN=1 / WINDOW_Z_MAX=39`.
- **Reco :** Consacrer une échelle unique en constantes partagées (ex. Z_FENETRES 1-39, Z_MENUS 50, Z_SNAP 55, Z_PALETTE 60, Z_ONBOARDING 70, Z_TOASTS 80) et ramener SnapOverlay dans la bande ; remonter les Toasts au-dessus des modales.

#### `apps/web/src/components/ui.tsx:129` (uniformite)
- **Constat :** MenuDeroulant — primitive ajoutée au module standard après le lot d'uniformisation — est stylée en rampe neutre (`border-neutral-700 bg-neutral-900 text-neutral-100/500`) alors que l'en-tête du fichier promet « Couleurs exclusivement via les tokens sémantiques » et que toutes les autres primitives (EnTeteFenetre, Vide, Badge…) utilisent border-border/bg-bg/text-text. Deux vocabulaires cohabitent dans le fichier de référence, ce que les prochains contributeurs recopieront.
- **Preuve :** ui.tsx:129 `border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100` et :139 `border-neutral-700 bg-neutral-900` vs doc du module l.10-11 « Couleurs exclusivement via les tokens sémantiques » ; items des menus consommateurs aussi en neutral (Toolbar.tsx:207, 311).
- **Reco :** Migrer MenuDeroulant (déclencheur + panneau + itemClass des consommateurs) sur border-border/bg-surface/text-text/text-text-dim — rendu identique sur dark (la rampe neutre y égale les tokens) et fichier standard redevenu exemplaire.

#### `apps/web/src/App.tsx:257` (ergonomie)
- **Constat :** Le bouton ⚙ « Ouvrir les réglages » de la colonne droite a un feedback hover invisible : `hover:bg-surface` dans un `<aside>` déjà en `bg-surface` — seul le changement de couleur du glyphe subsiste, contrairement aux autres boutons du chrome qui utilisent `hover:bg-bg` sur fond surface (FloatingWindow —/▢/✕, DrawingToolbar).
- **Preuve :** App.tsx:257 `className="rounded p-1 text-text-dim transition hover:bg-surface hover:text-text"` dans l'aside :247 `bg-surface`.
- **Reco :** Remplacer par `hover:bg-bg` (pattern des boutons d'en-tête de FloatingWindow.tsx:274).

## Lentille : chart-indicateurs

### Sévérité haute (4)

#### `apps/web/src/chart/indicators.ts:97` (uniformite) · **verdict : CONFIRME**
- **Constat :** Les figures des ~98 indicateurs du catalogue sont enregistrées sans `styles` : toutes les courbes (EMA, RSI, MACD…) prennent la palette par défaut de klinecharts, identique sur les 5 thèmes, au lieu des tokens --serie-1…6 du standard.
- **Preuve :** indicators.ts:91-97 `return { key: o.key, title: `${o.name}: `, type: "line" };` (aucun styles) ; palette par défaut vérifiée dans klinecharts@9.8.12 dist/index.esm.js:359 `var lines = ['#FF9600', '#935EBD', blue, '#E11D74', '#01C5C4']` ; aucun usage de --serie-* dans apps/web/src/chart/ (grep vide).
- **Reco :** Dans `ensureRegistered`, attribuer à chaque output un callback `styles: () => ({ color: lireTokenCanvas(`--serie-${(i % 6) + 1}`, repli) })` (pattern prouvé thème-aware dans orderflow.ts:154). Les 98 indicateurs suivent alors le thème sans re-registration.
- **Note de contre-expertise :** indicators.ts:91-97 : les figures sont bien retournées sans `styles` (line/bar/circle nus). Palette par défaut vérifiée dans apps/web/node_modules/klinecharts@9.8.12 dist/index.esm.js:359 (`var lines = ['#FF9600', '#935EBD', blue, '#E11D74', '#01C5C4']`). Aucun `--serie` ni `lireTokenCanvas` dans chart/indicators.ts (grep vide), et `applyChartTheme` (ChartInstance.tsx:173-233) ne définit jamais les couleurs de lignes d'indicateurs — donc palette identique sur tous les thèmes, confirmé. Seule correction factuelle : le catalogue compte ~148 indicateurs (packages/indicators/src/registry.ts:174+), pas ~98 — l'impact est donc plus large que décrit, pas moindre. Le pattern de la reco (callback styles) est prouvé par orderflow.ts:154.

#### `apps/web/src/lib/canvasTokens.ts:20` (synthese) · **verdict : PLAUSIBLE**
- **Constat :** Divergence systémique : depuis le lot du 9/07, TOUTES les nouvelles couleurs de série côté chart sont des hex en dur — indicators.ts (défaut lib), derivatives.ts (#22d3ee/#f59e0b), macro.ts (3 hex), revenue.ts (#eab308), ecoMarkers.ts (#f59e0b), store/compare.ts (5 hex). La fondation canvasTokens/--serie-1…6 n'est consommée dans chart/ que par tradeMarkers.ts.
- **Preuve :** grep '--serie' apps/web/src/chart/ → 0 résultat ; grep 'lireTokenCanvas' chart/ → uniquement tradeMarkers.ts:45 ; 6 fichiers avec constantes hex de série listés ci-dessus.
- **Reco :** Ajouter à canvasTokens.ts un helper `serieCanvas(i, repli)` lisant `--serie-N`, et migrer les 6 fichiers dessus (une passe mécanique, chaque couleur est déjà une constante nommée). Ajouter un test de non-régression interdisant les hex de série dans chart/ (miroir du garde-fou thèmes).
- **Note de contre-expertise :** Les faits grep sont exacts : 0 usage de `--serie` dans apps/web/src/chart/ ; `lireTokenCanvas` consommé dans chart/ uniquement par tradeMarkers.ts (import ligne 45, usages 334-336) ; hex de série confirmés dans derivatives.ts (#22d3ee/#f59e0b), macro.ts:44-46 (3 hex), revenue.ts:31 (#eab308), ecoMarkers.ts:31 (#f59e0b), store/compare.ts:22+29 (5 hex). MAIS le récit causal est faux : git montre que canvasTokens.ts et les tokens --serie-1…6 datent du 11/07 (commit 45a7b2e), alors que les 6 fichiers cités ont tous été créés AVANT (27/06 au 02/07). Ce ne sont pas « toutes les NOUVELLES couleurs depuis le lot du 9/07 » qui divergent — c'est du code antérieur jamais migré vers la fondation. Dette de migration réelle (la reco reste valable), mais pas la divergence systémique continue décrite.

#### `apps/web/src/chart/derivatives.ts:146` (lisibilite) · **verdict : CONFIRME**
- **Constat :** Le pane OI (notionnel USD, ordres de grandeur en milliards) est enregistré sans `precision` ni `shouldFormatBigNumber` : axe et légende affichent le symptôme exact de l'audit #9 (« 1,100,000,000.0000 ») que revenue.ts a corrigé pour lui seul. Même défaut pour macro.ts (cap crypto ~10^12).
- **Preuve :** derivatives.ts:146-152 `registerIndicator({ name: OI_NAME, … figures, calc })` — aucun champ precision/shouldFormatBigNumber ; contraste avec revenue.ts:62-65 « 0 décimale + notation compacte (441K, 1.1B) … au lieu de “1,100,000,000.0000” (audit #9) » ; macro.ts:97-116 idem sans precision.
- **Reco :** Ajouter `precision: 0, shouldFormatBigNumber: true` à l'indicateur OI (derivatives.ts) et à AXIOM_MACRO (macro.ts), comme revenue.ts. Garder le funding en précision 4 (convention du standard).
- **Note de contre-expertise :** derivatives.ts:146-152 : `registerIndicator({ name: OI_NAME, shortName: 'OI ($)', series, figures, calc })` sans `precision` ni `shouldFormatBigNumber` (idem funding, 153-159). L'OI est en notionnel USD (`p.oiUsd`, ligne 235) donc ordres de grandeur en milliards ; défaut klinecharts = précision 4 (documenté dans indicators.ts:104-105). Contraste exact avec revenue.ts:62-65 qui porte `precision: 0, shouldFormatBigNumber: true` avec le commentaire cité mot pour mot (« au lieu de « 1,100,000,000.0000 » (audit #9) »). macro.ts:97-116 enregistre AXIOM_MACRO sans precision alors que cryptoTotal ~10^12 et M2 scale 1e9. `shouldFormatBigNumber` bien supporté par l'API (klinecharts dist/index.d.ts:1064).

#### `apps/web/src/chart/derivatives.ts:35` (uniformite) · **verdict : CONFIRME**
- **Constat :** OI_COLOR (#22d3ee) et FUNDING_COLOR (#f59e0b) sont figés en dur avec une justification erronée (« figée à l'enregistrement… pas de re-résolution au changement de thème ») : orderflow.ts prouve dans le même dossier qu'un callback `figure.styles` est réévalué au rendu et peut lire les tokens.
- **Preuve :** derivatives.ts:31-40 `export const OI_COLOR = "#22d3ee"; // … (exception théméité assumée)` vs orderflow.ts:154 `styles: () => ({ color: readToken("--up") || "#10b981" })` (thème-aware, même version klinecharts).
- **Reco :** Remplacer par `styles: () => ({ color: lireTokenCanvas("--serie-5", "#22d3ee"), size: 1.5 })` (et --serie-3 pour le funding) ; côté DerivativesWindow, garder le lien bouton↔courbe via la classe `text-serie-5` au lieu de la constante exportée.
- **Note de contre-expertise :** derivatives.ts:31-40 : OI_COLOR (#22d3ee, ligne 35) et FUNDING_COLOR (#f59e0b, ligne 40) figés, avec le commentaire justificatif « figée à l'enregistrement de l'indicateur (KLineChart enregistre les figures une fois, à l'import — pas de re-résolution au changement de thème) ». Cette justification est démontrée fausse par le repo lui-même : derivatives.ts utilise DÉJÀ un callback `styles: () => ({ color, size: 1.5 })` (ligne 130) — il capture juste une constante au lieu de lire un token — et orderflow.ts:154-155, même dossier, même klinecharts 9.8.12, fait `styles: () => ({ color: readToken("--up") || "#10b981" })` avec le commentaire « Lus au rendu → thème-aware ». La « exception théméité assumée » repose donc sur une prémisse technique erronée ; #22d3ee correspond d'ailleurs à --serie-5 du thème par défaut (index.css:91), rendant la migration triviale.

### Sévérité moyenne (9)

#### `apps/web/src/chart/macro.ts:45` (uniformite)
- **Constat :** Les 3 séries macro sont en hex figés, et la série non sémantique « Stablecoins » réutilise #10b981, exactement la teinte sémantique --up du thème dark : sur le chart, une courbe verte non directionnelle se lit comme un signal haussier ; sur les autres thèmes, rien ne suit.
- **Preuve :** macro.ts:44-46 `color: "#38bdf8"`, `color: "#10b981"`, `color: "#eab308"` — comparer index.css :87-92 où #10b981 n'apparaît que comme up/vert sémantique.
- **Reco :** Passer les 3 séries sur `styles: () => ({ color: lireTokenCanvas("--serie-N", repli) })` avec des N distincts, en évitant toute teinte confondable avec --up/--down.

#### `apps/web/src/store/compare.ts:22` (uniformite)
- **Constat :** La palette de comparaison (COMPARE_PALETTE, 4 hex + MAIN_COLOR #94a3b8) est le cas d'école visé par --serie-1…6 : couleurs multi-séries non sémantiques figées, non réinterprétées par thème (sur bloomberg, l'ambre #f59e0b du comparé 1 se confond avec l'identité ambre du thème).
- **Preuve :** store/compare.ts:22 `export const COMPARE_PALETTE = ["#f59e0b", "#3b82f6", "#a855f7", "#ec4899"]` et :29 `export const MAIN_COLOR = "#94a3b8"` ; consommés tels quels par chart/compare.ts:246 (`slots.push({ color: MAIN_COLOR, … })`).
- **Reco :** Stocker des identifiants de série (« serie-1 »…« serie-4 » + « text-dim » pour le principal) et résoudre en couleur au rendu via le callback styles de compare.ts (déjà dynamique, compare.ts:102-106) — la légende latérale DOM utilise les classes text-serie-N.

#### `apps/web/src/chart/volumeRangeOverlay.ts:234` (hierarchie)
- **Constat :** Les barres buy/sell du VPFR sont des polygones remplis à opacité pleine (jusqu'à 300 px de large) posés sur le pane prix : elles masquent totalement les bougies dans la plage, alors que le VPVR équivalent atténue à 0.55 — la hiérarchie prix > overlay est inversée.
- **Preuve :** volumeRangeOverlay.ts:234 et :247 `styles: { style: "fill", color: down }` / `color: up` (aucun alpha) vs volumeProfile.ts:354 `ctx.globalAlpha = 0.55` pour le même rendu.
- **Reco :** Composer les remplissages avec un alpha ~0.45-0.55 (couleur rgba dérivée du token via parse, ou 8 digits hex si le thème fournit de l'hex), aligné sur le VPVR.

#### `apps/web/src/chart/orderflow.ts:110` (uniformite)
- **Constat :** Incohérence intra-fichier : la ligne CVD est enregistrée sans styles (couleur par défaut klinecharts #FF9600, non thémée) alors que le pane jumeau CVD S/P, 40 lignes plus bas, lit correctement --up/--accent au rendu.
- **Preuve :** orderflow.ts:110 `figures: [{ key: "cvd", title: "CVD: ", type: "line" }]` vs orderflow.ts:154-155 `styles: () => ({ color: readToken("--up") || "#10b981" })`.
- **Reco :** Donner au CVD le même callback styles (par ex. --serie-1 ou --accent) que CVD S/P.

#### `apps/web/src/chart/ecoMarkers.ts:31` (uniformite)
- **Constat :** ECO_COLOR (#f59e0b) est figé : les lignes verticales pleine hauteur + labels des événements éco restent ambre sur les 5 thèmes, alors que le rendu passe par createPointFigures (rappelé au redraw) et que extendData.color existe déjà — le canal thème est en place mais alimenté par une constante.
- **Preuve :** ecoMarkers.ts:31 `const ECO_COLOR = "#f59e0b";` puis :113 `color: ECO_COLOR` dans extendData ; contraste tradeMarkers.ts:334-336 qui résout les tokens au redraw via lireTokenCanvas.
- **Reco :** Résoudre la couleur dans redraw() via `lireTokenCanvas("--serie-3", "#f59e0b")` (mimique tradeMarkers) et s'abonner à themeStore pour rejouer au changement de thème.

#### `apps/web/src/chart/liquidationHeat.ts:465` (lisibilite)
- **Constat :** La teinte des niveaux ESTIMÉS (ORANGE_EST, garde-fou visuel « distinct de la heatmap réelle ») est figée alors que la rampe de la heatmap est theme-aware (rampePourTheme) : sur le thème bloomberg (rampe ambre), l'orange EST se confond avec les cellules réelles et le garde-fou de distinction s'effondre.
- **Preuve :** liquidationHeat.ts:464-465 `/** Teinte orange des niveaux ESTIMÉS (distincte du viridis…) */ const ORANGE_EST = "245,158,11";` vs :804 `rampe: rampePourTheme(themeStore.getState().theme, fondClair)` (la rampe, elle, suit le thème).
- **Reco :** Faire choisir la teinte EST par thème au même endroit que la rampe (rampePourTheme renvoie déjà un choix par thème), ou la dériver d'un token dédié, en garantissant un contraste teinte-EST/rampe par thème.

#### `apps/web/src/chart/orderflow.ts:87` (uniformite)
- **Constat :** La fondation lib/canvasTokens (§3.3 du standard, censée consolider les lecteurs de tokens) est re-dupliquée localement dans 6 fichiers chart/ (readToken/cssVar identiques), avec des replis divergents pour le même token (--up ⇒ #10b981, #2dc08e ou #34d399 selon le fichier).
- **Preuve :** Définitions locales : orderflow.ts:87, volumeProfile.ts:160, liquidationHeat.ts:504, ChartInstance.tsx:168, fibonacci.ts:145, volumeRangeOverlay.ts:74 ; replis --up : orderflow.ts:690 "#10b981" vs volumeRangeOverlay.ts:179 "#2dc08e" vs tradeMarkers.ts:334 "#34d399".
- **Reco :** Remplacer les 6 helpers locaux par lireTokenCanvas/lireTokensCanvas et centraliser les replis (constantes exportées par canvasTokens) pour un rendu de dégradation identique partout.

#### `apps/web/src/components/IndicatorMenu.tsx:298` (ergonomie)
- **Constat :** Pour un catalogue de ~98 indicateurs, le menu offre recherche + catégories repliables mais : le champ de recherche n'a pas d'autoFocus à l'ouverture, aucune navigation clavier (flèches/Entrée/Échap), pas de favoris ni de « récents », et la recherche ne matche que name/id/catégorie (aucun mot-clé/alias — « bandes » ne trouve pas BOLL).
- **Preuve :** IndicatorMenu.tsx:298-304 `<input type="text" value={query} …>` sans autoFocus ni onKeyDown ; :185-190 filtre limité à `d.name`/`d.id`/catégorie ; aucun état favoris/récents dans le composant ni dans store/indicators.
- **Reco :** Ajouter autoFocus + Échap pour fermer, navigation flèches/Entrée sur les résultats, une section « Récents » (5 derniers add, persistée) et un champ `keywords` dans IndicatorDef exploité par le filtre.

#### `apps/web/src/chart/ChartInstance.tsx:843` (hierarchie)
- **Constat :** Quand footprint (orderflow) et heatmap liquidations sont actifs ensemble, les deux canvases peignent les mêmes cellules bougie×prix (footprint empilé au-dessus, alphas cumulés ~0.15-0.7 chacun) : aucune garde n'existe pour cette combinaison (ni modulation d'opacité, ni exclusivité, ni avertissement), contrairement au couple heatmap+VP qui a son décalage d'ancre dédié.
- **Preuve :** ChartInstance.tsx:841-843 ordre DOM vpCanvas → liqCanvas → canvas(footprint) ; orderflow.ts:805 `const alpha = 0.12 + 0.5 * intensity` sur les mêmes zones que liquidationHeat.ts:1108 `alpha = 0.15 + 0.4 * t` ; garde existante uniquement pour VP : liquidationHeat.ts:920-921 `xAncre = xRight - (vpActif ? width * VP_WIDTH_FRAC : 0)`.
- **Reco :** Au minimum, réduire l'alpha de la heatmap (facteur ~0.5) quand orderflowStore.enabled et le slot est focus (même pattern d'abonnement croisé que volumeProfileStore dans liquidationHeat), ou griser la bascule LIQMARK quand le footprint est actif.

### Sévérité basse (3)

#### `apps/web/src/chart/macro.ts:44` (lisibilite)
- **Constat :** Les titres de légende des panes ne suivent aucune convention d'unité : « OI $: », « Funding %: », « Revenus $/j: » affichent l'unité, mais « Cap crypto: », « Stablecoins: », « M2: », « CVD: » (valeurs USD ou volume) n'en affichent aucune — deux panes USD côte à côte se lisent différemment.
- **Preuve :** macro.ts:44-46 `title: "Cap crypto: "` (USD, sans unité) vs derivatives.ts:150 `"OI $: "` et revenue.ts:52 `"Revenus $/j: "`.
- **Reco :** Fixer une convention (unité entre parenthèses dans le shortName du pane, titres de figure sans unité, ou l'inverse) et l'appliquer aux 7 panes hors-catalogue (OI, Funding, Revenus, Macro×3, CVD, CVD S/P, Comp).

#### `apps/web/src/chart/volumeProfile.ts:327` (uniformite)
- **Constat :** Deux gris « slate » sont codés en dur : le voile Value Area du VPVR et le fond du cadre VPFR — teintes pensées pour fond sombre, quasi invisibles ou inadaptées sur le thème clair (cute), alors que tout le reste du fichier lit les tokens.
- **Preuve :** volumeProfile.ts:327 `ctx.fillStyle = "rgba(148,163,184,0.06)";` et volumeRangeOverlay.ts:199 `styles: { style: "fill", color: "rgba(148,163,184,0.03)" }`.
- **Reco :** Dériver ces voiles de --text-dim (parse RVB + alpha, helper parseCssColor déjà écrit dans liquidationHeat.ts:240) au lieu du slate-400 figé.

#### `apps/web/src/chart/paneHeaders.tsx:114` (ergonomie)
- **Constat :** Le réordonnancement des panes d'indicateurs n'existe que par drag pointeur sur la poignée ⠿ (pointerdown) : aucune alternative clavier ni action équivalente dans le menu Indicateurs, où la section « Actifs » n'offre pas de monter/descendre.
- **Preuve :** paneHeaders.tsx:112-114 `poignee.setAttribute("aria-hidden", "true"); poignee.addEventListener("pointerdown", …)` — seul chemin vers indicatorsStore.reorder ; IndicatorMenu.tsx:246-281 ne propose que dupliquer/éditer/retirer.
- **Reco :** Ajouter des boutons ↑/↓ (appelant indicatorsStore.reorder) sur les lignes de la section « Actifs » du menu Indicateurs — chemin accessible et découvrable.

## Lentille : formatage-tokens

### Sévérité haute (2)

#### `apps/web/src/chart/liquidationHeat.ts:465` (lisibilite) · **verdict : CONFIRME**
- **Constat :** La couche des niveaux de liquidation ESTIMÉS est peinte dans un orange en dur identique sur les 5 thèmes, alors que le standard §2 impose des couleurs canvas lues depuis les tokens. Sa promesse documentée (« distincte du viridis de la heatmap réelle ») est fausse sur Bloomberg : la rampe réelle y est ambre ([230,170,0]→[255,196,0], l. 289-295), quasi identique à #f59e0b — les niveaux EST deviennent indiscernables des cellules chaudes.
- **Preuve :** const ORANGE_EST = "245,158,11"; // #f59e0b (rgb) — puis ctx.fillStyle = `rgba(${ORANGE_EST},0.95)` (l. 1624, 1661), sans readToken, alors que up/down/text sont bien lus par frame (l. 794-803)
- **Reco :** Étendre le mécanisme rampePourTheme (l. 316) d'une « teinte EST » par thème choisie pour contraster avec la rampe (Bloomberg → bleu/blanc, Matrix → orange, viridis → orange actuel), résolue 1×/frame dans Tokens comme upRgb/downRgb, avec repli RVB.
- **Note de contre-expertise :** Tout est exact. liquidationHeat.ts:465 définit ORANGE_EST = "245,158,11" (#f59e0b) avec le commentaire « distincte du viridis de la heatmap réelle », et cette couleur est peinte en dur aux l. 1333, 1624 et 1661 sans lecture de token — alors que le même contrôleur lit up/down/text/etc. via readToken une fois par frame (l. 794-808) et choisit déjà sa rampe par thème via rampePourTheme (l. 316-327, 5 thèmes : bloomberg/matrix/dark/aurora/cute). Le standard §2 (docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md) impose bien « Canvas/SVG : couleurs lues depuis les tokens CSS (…), jamais d'hex en dur ». Sur Bloomberg, RAMPE_BLOOMBERG (l. 289-295) culmine à [230,170,0]→[255,196,0], teintes ambre quasi identiques à #f59e0b (hues ~46° vs ~38°) : à alpha 0.95, les niveaux EST sont effectivement indiscernables des cellules chaudes, et la promesse du commentaire est fausse sur ce thème. Sévérité haute justifiée : perte de la distinction réel/estimé, qui est un garde-fou documenté (« APPROXIMATION », l. 1326-1327).

#### `apps/web/src/data/brief.ts:292` (uniformite) · **verdict : CONFIRME**
- **Constat :** Le lot BRIEF (post-3ce9b83) réintroduit exactement l'anti-pattern que le lot d'uniformisation a éliminé : fmtFunding et fmtUsdSigne sont dupliqués VERBATIM (mêmes corps, mêmes JSDoc) entre data/brief.ts:292-302 et components/BriefWindow.tsx:112-119. C'est en outre la 3e implémentation du formatage funding (DerivativesWindow.tsx:77 formatFunding fait la même chose), un cas explicitement cité par le standard (« 4 déc. pour le funding »).
- **Preuve :** data/brief.ts:293 « function fmtFunding(rate: number | null): string { return rate === null ? VALEUR_ABSENTE : formatPct(rate * 100, 4); } » — copie caractère pour caractère dans BriefWindow.tsx:112-114, idem fmtUsdSigne (297-300 vs 117-119)
- **Reco :** Promouvoir formatFunding(rate) et formatUsdSigne(v) dans lib/format.ts (+ tests), les importer dans data/brief.ts, BriefWindow.tsx et DerivativesWindow.tsx ; supprimer les 3 copies locales.
- **Note de contre-expertise :** Duplication verbatim vérifiée : fmtFunding (data/brief.ts:291-294 vs BriefWindow.tsx:111-114) et fmtUsdSigne (brief.ts:296-300 vs BriefWindow.tsx:116-120) sont identiques caractère pour caractère, JSDoc compris. DerivativesWindow.tsx:78-81 contient formatFunding, 3e implémentation du même formatage (formatPct(rate*100, 4), seule la signature diffère : undefined vs null). git merge-base confirme que brief.ts (ba86987/2849ba2) est postérieur au lot d'uniformisation 3ce9b83 (« uniformisation des 34 fenêtres/panneaux »), et le standard §2 de la spec 2026-07-09 cite explicitement « 4 pour le funding » comme convention consacrée. lib/format.ts n'expose que formatUsd/formatPct (pas de formatteur funding partagé), donc la reco de promotion est applicable telle quelle. Le risque concret est réel : une divergence future entre l'export markdown du brief et l'affichage fenêtre. Seule nuance mineure : la preuve cite brief.ts:293 pour une fonction qui commence l. 292, et DerivativesWindow.tsx:77 est la ligne de JSDoc (fonction l. 78) — imprécisions d'une ligne qui ne changent rien au constat.

### Sévérité moyenne (4)

#### `apps/web/src/lib/navigation.ts:126` (uniformite)
- **Constat :** Le marqueur de navigation panneau→chart (commit 7507755 du 13/07, postérieur au lot) fige un cyan en dur pour son overlay, sur tous les thèmes — il jure sur Bloomberg (tout ambre) et Matrix (tout vert). Le code frère du même cycle (chart/tradeMarkers.ts:334-336) lit correctement les tokens via lireTokenCanvas.
- **Preuve :** « /** Accent cyan : se distingue de l'ambre ECO et des triangles trade. */ const NAV_COLOR = "#38bdf8"; » — jamais relu depuis les tokens au rendu
- **Reco :** Remplacer NAV_COLOR par une lecture au moment du dessin : lireTokenCanvas("--serie-5", "#38bdf8") (cyan en dark, réinterprété par thème), comme tradeMarkers.ts.

#### `apps/web/src/components/TickerBand.tsx:104` (synthese)
- **Constat :** TickerBand (nouveau, commit ec003f0) duplique intégralement la construction META_SOURCE de NewsWindow.tsx:75-81, y compris l'entrée spéciale gdelt et son hex #ec4899 : deux copies du même mapping label/couleur par source, qui divergeront à la prochaine source ajoutée.
- **Preuve :** TickerBand.tsx:104-110 « const META_SOURCE: Record<NewsSourceId, …> = { ...(Object.fromEntries(NEWS_FEEDS.map(…))), gdelt: { label: "GDELT", color: "#ec4899" } } » — identique à NewsWindow.tsx:75-81, JSDoc comprise
- **Reco :** Hisser META_SOURCE (avec l'entrée gdelt) dans data/news.ts à côté de NEWS_FEEDS et l'importer dans NewsWindow et TickerBand.

#### `apps/web/src/chart/priceAlertMenu.ts:66` (uniformite)
- **Constat :** Le menu clic-droit d'alerte prix (commit 913a0de du 13/07) réintroduit un formateur de prix adaptatif local — la famille « prix adaptatif ×6 » que le lot a précisément consolidée dans lib/format.formatPrice. Les règles diffèrent subtilement de formatPrice (maximumFractionDigits vs décimales fixes) : deux affichages de prix incohérents dans l'app.
- **Preuve :** « export function formaterNiveauCourt(niveau: number): string { … if (abs >= 1000) return niveau.toLocaleString("en-US", { maximumFractionDigits: 2 }); … } » — même intention que formatPrice (lib/format.ts:29)
- **Reco :** Utiliser formatPrice de lib/format ; si la variante « décimales max non forcées » est vraiment voulue, la promouvoir dans lib/format.ts avec test plutôt que la garder locale.

#### `apps/web/src/components/Taskbar.tsx:58` (uniformite)
- **Constat :** Les boutons « Tout restaurer » et « Mosaïque » de la nouvelle taskbar redéclarent inline le style du bouton secondaire au lieu d'importer BTN_SECONDAIRE (ui.tsx:21-22), en divergeant : ajout de font-medium et absence de transition — les deux boutons ne matchent plus le standard §2.
- **Preuve :** l. 58 et 66 : className="rounded border border-border bg-bg px-2 py-1 text-[11px] font-medium text-text-dim hover:text-text" vs BTN_SECONDAIRE = "rounded border border-border bg-bg px-2 py-1 text-[11px] text-text-dim transition hover:text-text"
- **Reco :** Importer BTN_SECONDAIRE depuis ./ui et l'appliquer aux deux boutons (supprimer font-medium ou, s'il est voulu, l'ajouter au token partagé).

### Sévérité basse (4)

#### `apps/web/src/components/StablecoinsWindow.tsx:78` (uniformite)
- **Constat :** fmtDeltaUsd est une 3e variante locale du « montant USD signé » (avec fmtUsdSigne ×2 du lot BRIEF) : même besoin, trois implémentations depuis le 9 juillet.
- **Preuve :** « function fmtDeltaUsd(v: number | null): string { … return `${v >= 0 ? "+" : "−"}${formatUsd(Math.abs(v))}`; } » — sémantique de fmtUsdSigne (BriefWindow.tsx:117, data/brief.ts:297)
- **Reco :** Une fois formatUsdSigne promu dans lib/format (cf. finding data/brief.ts), remplacer fmtDeltaUsd par cet import (les nulls restant gérés par VALEUR_ABSENTE).

#### `apps/web/src/components/StablecoinsWindow.tsx:137` (uniformite)
- **Constat :** Le canvas treemap formate la part en % à la main (toFixed(1) + « % » espacé) alors que formatPourcentage — qui produit exactement ce format et gère les valeurs non finies — est déjà importé ligne 44 et utilisé partout ailleurs dans la fenêtre (l. 202, 248, 468).
- **Preuve :** ctx.fillText(`${t.item.partPct.toFixed(1)} %`, x + 5, y + 24, w - 10);
- **Reco :** Remplacer par ctx.fillText(formatPourcentage(t.item.partPct, 1), …).

#### `apps/web/src/components/Toasts.tsx:20` (ergonomie)
- **Constat :** Les toasts sont ancrés en fixed bottom-4 right-4 z-50, mais la nouvelle Taskbar vit désormais dans le flux tout en bas d'App (App.tsx:276) : chaque toast recouvre les pastilles de droite de la taskbar pendant 2,5 s, précisément après des actions (mosaïque, workspace) où l'utilisateur regarde la taskbar.
- **Preuve :** Toasts.tsx:20 « fixed bottom-4 right-4 z-50 » + App.tsx:273-276 (Taskbar dernier enfant du flex-col racine)
- **Reco :** Décaler l'ancre des toasts au-dessus de la taskbar quand elle est rendue (ex. bottom calé sur sa hauteur, ou conteneur toasts placé dans le flex-col juste avant la Taskbar).

#### `apps/web/src/components/Taskbar.tsx:86` (uniformite)
- **Constat :** La pastille de couleur de groupe injecte en inline style un hex de GROUP_PALETTE = COMPARE_PALETTE (store/compare.ts:22, hex fixes #f59e0b/#3b82f6/#a855f7/#ec4899). La palette prédate le standard, mais la nouvelle taskbar (et FloatingWindow.tsx:242) la propage au lieu des tokens --serie-1…6 créés exactement pour ces couleurs non sémantiques réinterprétées par thème.
- **Preuve :** style={{ backgroundColor: w.groupColor }} avec GROUP_PALETTE: readonly string[] = COMPARE_PALETTE (windowManager.ts:23) = ["#f59e0b", "#3b82f6", "#a855f7", "#ec4899"]
- **Reco :** Faire porter par groupColor des références de token (« var(--serie-3) », …) ou un index de série résolu en var(--serie-N) à l'affichage dans Taskbar et FloatingWindow ; adapter le picker de compare si partagé.

## Lentille : ergonomie-flux

### Sévérité haute (3)

#### `apps/web/src/store/derivatives-chart.ts:49` (ergonomie) · **verdict : CONFIRME**
- **Constat :** Collision de mnémonique : « FUND » désigne à la fois le sous-pane funding du chart (action:deriv-funding-pane) et la fenêtre Fiche société (panneau:fund dans windowPanels.ts:158). Taper FUND dans ⌘K donne deux commandes à égalité de bonus startsWith, pour deux effets sans aucun rapport.
- **Preuve :** derivatives-chart.ts:49 `mnemonique: "FUND", libelle: "Funding rate (sous-pane)…"` vs windowPanels.ts:158 `mnemonique: "FUND", libelle: "Fiche société (FUND)"` ; registry.ts:259-261 accorde +30 aux deux (startsWith).
- **Reco :** Renommer l'un des deux mnémoniques (ex. sous-pane → « FUNDP » ou « FR », en gardant « funding » dans motsCles), et ajouter un test dans registry.test.ts qui interdit les mnémoniques dupliqués dans le registre complet.
- **Note de contre-expertise :** Collision réelle et active. derivatives-chart.ts:49 déclare mnemonique "FUND" (id action:deriv-funding-pane, toggle du sous-pane funding) et windowPanels.ts:157 déclare aussi "FUND" (id panneau:fund, Fiche société). Les deux lots sont enregistrés ensemble dans App.tsx (lignes 106 et 120 via enregistrerCommandes) ; la déduplication d'enregistrerCommandes se fait par id, donc les deux coexistent dans le registre. registry.ts:259-261 accorde bien +30 à tout mnémonique qui startsWith la requête : taper FUND dans ⌘K remonte les deux commandes avec le même bonus, pour deux effets sans rapport. Détail mineur : le mnémonique est à windowPanels.ts:157 (le :158 cité est le libellé). Aggravant non relevé par l'audit : FundWindow.tsx:65 déclare un TROISIÈME "FUND" (même id panneau:fund, dédupliqué par id mais avec une action différente — toggleFund via fundUiStore — donc laquelle gagne dépend de l'ordre de chargement du chunk lazy).

#### `apps/web/src/store/workspaces.ts:97` (ergonomie) · **verdict : CONFIRME**
- **Constat :** Comportement divergent d'un workspace avant/après reload : la doc (lignes 65-67) promet une géométrie « toujours appliquée FERMÉE », mais le snapshot capture les fenêtres brutes (open:true, minimized inclus) et apply() les passe à setAll() sans validation. En session, appliquer un preset rouvre donc les fenêtres ; après reload, validateWindowGeometry force open:false et le même preset n'en rouvre aucune.
- **Preuve :** workspaces.ts:97 `windowGeometry: windowManagerStore.getState().windows` (non filtré) ; :117 `windowManagerStore.getState().setAll(c.windowGeometry)` ; la validation open:false (:156-158) n'est appelée que depuis lireInitial() (:239).
- **Reco :** Choisir UNE sémantique et l'appliquer aux deux chemins : soit passer le snapshot par validateWindowGeometry dans saveAs()/apply() (fenêtres toujours fermées), soit — préférable pour un terminal — persister open/minimized dans le workspace et les restaurer aussi après reload.
- **Note de contre-expertise :** Divergence vérifiée ligne à ligne. La doc de WorkspaceContent.windowGeometry (workspaces.ts:65-67) promet une géométrie « toujours appliquée FERMÉE ». Or snapshot() capture windowManagerStore.getState().windows brut (:97, open/minimized inclus) et applyContent() le passe tel quel à setAll (:117) ; setAll (windowManager.ts:654-659) ne touche ni open ni minimized (il ne fait que normaliser les z). validateWindowGeometry, qui force open:false et minimized:false (:156-167), n'est appelée que par validateContent (:211), elle-même appelée uniquement depuis lireInitial (:239), c'est-à-dire à l'hydratation localStorage. Conséquence exacte comme décrite : en session, appliquer un preset sauvegardé fenêtres ouvertes les rouvre (contredit la doc) ; après reload, le même preset validé n'en rouvre aucune. Comportement non déterministe du point de vue utilisateur, sévérité haute justifiée pour un système de presets.

#### `apps/web/src/commands/hotkeys.ts:54` (ergonomie) · **verdict : CONFIRME**
- **Constat :** La table d'aide (touche « ? »), seule surface de découvrabilité exhaustive des mnémoniques, est périmée depuis les lots récents : il manque LIQ, STBL, FUNDX, LIQMARK, LIQMODE, LIQEST, WMIN/WALL/WTILE/WCASC/WCLOSE, WS/BACKUP/RESTORE ; et la ligne « ⌘K → PLAY* » omet PLAY-FADE et PLAY-LIQ pourtant existants. De plus, tout est entassé dans une seule chaîne de ~340 caractères rendue sur une seule ligne d'aide.
- **Preuve :** hotkeys.ts:54 liste « DES ECO NEWS … BRIEF GLOBE » sans LIQ/STBL/FUNDX (présents dans windowPanels.ts:237/188/212) ni WMIN…WCLOSE (:258-299) ; hotkeys.ts:56 « (scalp, funding, CVD S/P, FOMC, risk-off, options) » alors que playbooks.ts:179/215 définissent PLAY-FADE et PLAY-LIQ.
- **Reco :** Dériver la liste des mnémoniques de l'aide depuis le registre réel (construireRegistre() + commandes externes) au lieu d'une chaîne maintenue à la main, et rendre l'aide en plusieurs lignes groupées par catégorie. Un test peut figer que chaque mnémonique du registre apparaît dans l'aide.
- **Note de contre-expertise :** Le constat principal est exact : la chaîne unique de hotkeys.ts:54 (~340 caractères, une seule entrée d'aide) omet des mnémoniques réellement enregistrés dans la palette — LIQ (windowPanels.ts:235), STBL (:188), FUNDX (:212), WMIN/WALL/WTILE/WCASC/WCLOSE (:258-294, tous dans windowPanelCommands enregistré App.tsx:120), LIQMARK (liquidationMarkers.ts:564), LIQMODE (liquidationHeat.ts:1678), LIQEST (liquidationEstimates.ts:279), et WS/BACKUP/RESTORE (Toolbar.tsx:103-121, enregistrés :100). La table d'aide est donc bien périmée vis-à-vis des lots récents. CAVEAT sur la sous-affirmation PLAY : elle est en partie fausse. PLAY-FADE et PLAY-LIQ figurent explicitement dans la liste de la ligne 54 (« …PLAY-FADE PLAY-CVD…PLAY-LIQ… ») ; seule la parenthèse résumée de la ligne 56 « (scalp, funding, CVD S/P, FOMC, risk-off, options) » est incomplète, et encore : « funding » y désigne vraisemblablement le playbook Fade funding (PLAY-FADE, playbooks.ts:177-182). Il n'y manque réellement que « liquidations » (PLAY-LIQ). Le défaut de fond (aide maintenue à la main, désynchronisée du registre) et la reco (dériver l'aide de construireRegistre + commandes externes) restent valides.

### Sévérité moyenne (8)

#### `apps/web/src/commands/hotkeys.ts:171` (ergonomie)
- **Constat :** Les raccourcis timeframes « 1 – 9 » testent e.key, donc sur un clavier AZERTY (l'app est en français) la rangée de chiffres produit « & é " ' ( - è _ ç » sans Shift : les raccourcis documentés ne fonctionnent qu'avec Shift enfoncé, sans que l'aide ne le mentionne.
- **Preuve :** hotkeys.ts:171 `if (e.key >= "1" && e.key <= "9")` ; aide :58 « 1 – 9 · Timeframes rapides » sans mention de Shift.
- **Reco :** Matcher sur e.code (« Digit1 »…« Digit9 »), indépendant de la disposition clavier, en conservant l'exclusion des champs éditables et des modificateurs meta/ctrl/alt.

#### `apps/web/src/commands/registry.ts:343` (ergonomie)
- **Constat :** Les commandes timeframe génèrent leur mnémonique par tf.toUpperCase() : « 1m » (minute) et « 1M » (mois) partagent donc le mnémonique « 1M » — deux lignes visuellement quasi identiques dans la palette. Pire, la convention de navigation (1M=minute, 1MO=mois, ALIAS_TF:100-105) contredit la Toolbar et ces mêmes commandes où 1M=mois : la chaîne « 1M » change de sens selon l'endroit.
- **Preuve :** registry.ts:320 TF_COMMANDES contient « 1m » ET « 1M » ; :343 `mnemonique: tf.toUpperCase()` → deux commandes « 1M » ; :102-105 `"1M": "1m" … "1MO": "1M"`.
- **Reco :** Aligner les mnémoniques des commandes TF sur la convention de saisie (1M/1MO), c'est-à-dire mnemonique « 1MO »/« 3MO »… pour les mois, et documenter la convention dans le placeholder de la palette ou l'aide.

#### `apps/web/src/store/windowManager.ts:553` (ergonomie)
- **Constat :** toggleWindow (utilisé par toutes les commandes ⌘K des fenêtres) ferme une fenêtre ouverte-mais-minimisée au lieu de la restaurer : l'opérateur qui tape ⌘K LIQ pour faire revenir sa fenêtre réduite la voit disparaître de la taskbar. Le modèle mental « ⌘K MNEMO = montrer la fenêtre » est cassé pour l'état minimisé.
- **Preuve :** windowManager.ts:553-557 `const isOpen = get().windows[id]?.open ?? false; if (isOpen) get().closeWindow(id);` — aucun test de `minimized`, alors que openWindow (:516) restaure bien `minimized: false`.
- **Reco :** Dans toggleWindow, traiter l'état ouvert+minimisé comme « pas visible » : le restaurer (openWindow/restoreWindow) au lieu de le fermer ; ne fermer que si open && !minimized.

#### `apps/web/src/components/Taskbar.tsx:53` (ergonomie)
- **Constat :** La taskbar est une ligne flex sans wrap ni overflow-x : avec ~8 fenêtres ouvertes ou plus (le registre en compte 24, et WTILE encourage à en ouvrir beaucoup), les pastilles excédentaires débordent à droite du viewport (racine en overflow-hidden) et deviennent inaccessibles — impossible de restaurer/fermer ces fenêtres depuis la taskbar.
- **Preuve :** Taskbar.tsx:53 `<div className="flex shrink-0 gap-1 border-t border-border bg-surface px-2 py-1">` (ni flex-wrap ni overflow-x-auto) ; pastille ≈150-200px (`max-w-[140px] truncate` + mnémonique) × 24 fenêtres possibles ; App.tsx:226 racine `overflow-hidden`.
- **Reco :** Ajouter `overflow-x-auto` (ou `flex-wrap`) au conteneur, et/ou basculer sur des pastilles mnémonique-seul au-delà d'un seuil de fenêtres.

#### `apps/web/src/store/windowManager.ts:522` (ergonomie)
- **Constat :** À la première ouverture d'une fenêtre, la taille par défaut du registre n'est pas plafonnée au workspace : sur un écran étroit (laptop : ~980px utiles après sidebar 240px + barre de dessin), MAP (1100px) ou STBL (860px) débordent du bord droit, poignées de resize hors d'atteinte. La branche « fenêtre existante » clampe (lignes 503-504), la branche « création » non ; reclampAll ne se déclenche que sur changement de workspace.
- **Preuve :** windowManager.ts:522-526 `const width = entry?.defaultWidth ?? 480; … cascadePosition(openCount, state.workspace, width, height)` — aucun appel à clampSize, contrairement à :503 `clampSize(existing.width, …, state.workspace)` ; registre :54 marketMap defaultWidth 1100.
- **Reco :** Appliquer clampSize(width, height, MIN_WIDTH, MIN_HEIGHT, state.workspace) sur les dimensions par défaut avant cascadePosition dans la branche de création.

#### `apps/web/src/commands/hotkeys.ts:183` (ergonomie)
- **Constat :** Les touches O, L, R sont des no-op silencieux quand la source active ne les supporte pas (O hors flux de trades, L sur tradfi/synthétique, R sur tradfi) : aucun feedback, alors que la Toolbar, elle, grise les mêmes boutons avec une infobulle explicative. L'opérateur doit mémoriser la matrice source×fonction pour comprendre pourquoi « rien ne se passe ».
- **Preuve :** hotkeys.ts:184-188 `if (SOURCES_FLUX_TRADES.has(…)) { orderflowStore…toggle(); }` (sinon rien) ; :193-199 idem pour « l » ; à comparer avec Toolbar.tsx:576-578 `disabled={noTradeStream} title="Indisponible sur cette source…"`.
- **Reco :** Dans les branches non supportées, pousser un toast reprenant le message des infobulles Toolbar (« Indisponible sur cette source (aucun flux de trades) »), via pousserToast déjà utilisé ailleurs.

#### `apps/web/src/store/persist.ts:234` (ergonomie)
- **Constat :** Au reload, la géométrie des fenêtres survit mais jamais leur état ouvert : toutes reviennent fermées, et comme les workspaces forcent aussi open:false après reload, il n'existe AUCUN mécanisme pour retrouver son plan de travail (ex. LIQ+DES+NEWS ouvertes) d'une session à l'autre — tout doit être rouvert à la main chaque matin.
- **Preuve :** persist.ts:234 `open: false, // toujours restauré FERMÉ (évite 14 fenêtres à l'écran au démarrage)` ; workspaces.ts:158 `open: false` dans validateWindowGeometry.
- **Reco :** Restaurer les fenêtres précédemment ouvertes en état MINIMISÉ (pastilles taskbar, écran vide au boot — le souci que le commentaire veut éviter disparaît), ou au minimum offrir la restauration d'ouverture via les workspaces.

#### `apps/web/src/components/Toolbar.tsx:634` (uniformite)
- **Constat :** Deux couleurs Tailwind brutes échappent au remapping thème : `bg-violet-500` (état actif du bouton Liq, nouveau depuis le lot heatmap) et `text-sky-400` (mnémoniques du menu Playbooks). Contrairement à neutral/emerald/cyan/amber, violet et sky ne sont PAS repointés sur des variables dans tailwind.config.js : ces éléments gardent la même couleur sur les 5 thèmes (lisibilité non garantie sur cute/bloomberg), en violation du standard §2 (« jamais d'hex en dur », composants en var(--…)).
- **Preuve :** Toolbar.tsx:634 `? "bg-violet-500 text-accent-ink"` et :249 `text-sky-400` ; tailwind.config.js:44-68 remappe uniquement neutral{100-950}, emerald{400,500}, cyan{500}, amber{500} — aucun violet ni sky.
- **Reco :** Ajouter `--ui-violet` et `--ui-sky` aux 5 thèmes et les remapper dans tailwind.config.js comme cyan/amber, ou réutiliser un accent déjà tokenisé pour l'état actif de Liq et les mnémoniques Playbooks.

### Sévérité basse (3)

#### `apps/web/src/components/Toolbar.tsx:174` (ergonomie)
- **Constat :** Le menu « Fonctions » est une liste plate de 24 entrées dans l'ordre d'insertion historique du registre (dérivés d'abord, puis lots successifs) : ni tri alphabétique, ni groupement thématique (dérivés / macro / actions / gestion). À cette taille, l'opérateur doit scanner toute la liste pour reconnaître une entrée.
- **Preuve :** Toolbar.tsx:174-184 `FONCTIONS: … = menuWindows().flatMap(…)` sans tri ; windowManager.ts:46-71 WINDOW_REGISTRY ordonné par lot de livraison (liquidations en 3e, stablecoins en dernier).
- **Reco :** Grouper le menu par domaine (séparateurs + intertitres : Dérivés, Macro/éco, Actions, Outils) ou a minima trier par mnémonique, en dérivant le groupe d'un champ `groupe` ajouté au registre.

#### `apps/web/src/commands/windowPanels.ts:41` (ergonomie)
- **Constat :** L'alias IMAP est une commande à part entière : en parcourant la palette (requête vide), deux entrées au libellé identique « Vue marché (treemap) » apparaissent (MAP et IMAP), alors que « imap » figure déjà dans les motsCles de MAP — l'alias est donc redondant ET crée un doublon visible.
- **Preuve :** windowPanels.ts:41-48 `id: "panneau:vue-marche-imap", mnemonique: "IMAP", libelle: "Vue marché (treemap)"` ; :36 motsCles de MAP contient déjà `"imap"`.
- **Reco :** Supprimer la commande panneau:vue-marche-imap (le mot-clé « imap » de MAP suffit pour la frappe fuzzy) ; si le bonus startsWith sur mnémonique est voulu pour IMAP, l'obtenir via un champ « alias » du type Commande plutôt qu'une commande dupliquée.

#### `apps/web/src/store/windowManager.ts:4` (uniformite)
- **Constat :** Trois compteurs de fenêtres contradictoires et tous périmés dans les docs de tête de fichier : « 22 fenêtres » (windowManager.ts), « 15 fenêtres » (FloatingWindow.tsx:3), « 14 fenêtres » (persist.ts:234), alors que WINDOW_REGISTRY en compte 24 — la spec du lot demandait pourtant la mise à jour des « commentaires-compteurs » (§6).
- **Preuve :** windowManager.ts:4 « des 22 fenêtres Bloomberg » vs 24 entrées dans WINDOW_REGISTRY (:46-71) ; FloatingWindow.tsx:3 « chacune des 15 fenêtres » ; persist.ts:234 « évite 14 fenêtres ».
- **Reco :** Remplacer les nombres en dur par une formulation sans compteur (« des fenêtres du registre ») ou par WINDOW_REGISTRY.length dans les messages, pour supprimer la classe d'erreur.

## Lentille : hierarchie-synthese

### Sévérité haute (4)

#### `apps/web/src/components/BriefWindow.tsx:313` (synthese) · **verdict : CONFIRME**
- **Constat :** BRIEF est la fenêtre de synthèse du terminal mais n'a aucune synthèse chapeau : l'opérateur doit scanner 7 sections (session, watchlist, dérivés, ETF, éco, news, DVOL) pour répondre à LA question « quel est l'état du marché ce matin ? ».
- **Preuve :** Le corps enchaîne directement les sections détaillées (`<section>Session · review</section>` en premier, ligne 315) sans aucun bloc de lecture agrégée ; F&G, DVOL, funding et variations overnight sont dispersés en bas de page.
- **Reco :** Ajouter en tête un bandeau de 3-4 Metric interprétés : direction overnight (moyenne pondérée watchlist ou BTC/ETH), régime funding (neutre/chaud/froid selon seuil), F&G avec classification, DVOL avec Δ vs veille. Une ligne de texte générée (« Nuit haussière, funding neutre, vol basse ») répondrait à la question en 2 secondes — toutes les données sont déjà chargées dans les sections.
- **Note de contre-expertise :** Vérifié dans apps/web/src/components/BriefWindow.tsx : la ligne 313 est bien l'ouverture du corps scrollable et la ligne 315 enchaîne directement sur la première section détaillée (<section> « Session · review »). Aucun bloc de synthèse agrégée n'existe : les 7 sections (session l.315, watchlist l.430, dérivés l.462, ETF l.508, éco l.531, news+F&G l.570, DVOL l.613) se suivent sans lecture chapeau. F&G n'apparaît qu'en Badge dans la section Actualités (l.573-578), DVOL en dernière section (l.613-627), le funding est enfoui dans les cartes Dérivés (l.486-499) et les variations overnight dans le tableau watchlist (l.449-451). Toutes les données nécessaires à un bandeau de synthèse sont effectivement déjà chargées au montage (Promise.allSettled l.206-222). Le constat, la preuve et la localisation sont exacts.

#### `apps/web/src/components/OnchainWindow.tsx:458` (hierarchie) · **verdict : CONFIRME**
- **Constat :** MVRV Z-Score, SOPR et NUPL sont affichés en valeur brute à 4 décimales sans zone interprétée, alors que ce sont précisément les métriques on-chain dont la lecture canonique passe par des seuils (SOPR pivot 1.0, NUPL euphorie/capitulation, MVRV-Z surchauffe > ~7).
- **Preuve :** `valeur={formatDec(r?.serie.dernier?.value, def.id === "mvrv" ? 2 : 4)}` — aucun Badge de zone, aucune couleur de seuil, couleur fixe `--serie-4` identique pour les 3 métriques.
- **Reco :** Ajouter par métrique un Badge de zone (ex. SOPR : « profit » ≥ 1 / « capitulation » < 1 ; NUPL : croyance/euphorie/peur ; MVRV-Z : froid/neutre/surchauffe) et teinter la valeur selon la zone. Les seuils sont statiques et documentables dans la NoteSource, comme le fait déjà VuePegs de StablecoinsWindow (stable < 25 bps · tension < 100 · depeg ≥ 100).
- **Note de contre-expertise :** Vérifié dans apps/web/src/components/OnchainWindow.tsx : la ligne 458 contient mot pour mot `valeur={formatDec(r?.serie.dernier?.value, def.id === "mvrv" ? 2 : 4)}` et la ligne 461 fixe `color="--serie-4"` pour toutes les métriques BGeometrics. BG_METRIQUES (data/onchain/bgeometrics.ts l.72-78) contient bien MVRV, SOPR, NUPL (plus Puell et Reserve Risk, également concernés — le constat est même sous-estimé). Aucun Badge de zone ni couleur de seuil dans la fenêtre : le seul badge présent est BadgeFiabilite (fiabilité de source, l.214/547/603), pas une interprétation de valeur. SOPR affiché à 4 décimales sans référence au pivot 1.0, NUPL sans zones, MVRV-Z sans seuil de surchauffe. Constat, preuve et fichier:ligne exacts.

#### `apps/web/src/components/DerivativesWindow.tsx:488` (hierarchie) · **verdict : CONFIRME**
- **Constat :** Le funding est affiché en % brut par intervalle (« +0.0100% ») avec une couleur de signe seulement : aucun référentiel ne dit si le niveau est extrême. Le sparkline 2 h ne montre que la microtendance, pas la position dans la distribution historique.
- **Preuve :** `value={formatFunding(funding?.rate)}` + couleur binaire `funding.rate >= 0 ? "var(--up)" : "var(--down)"` — pas d'APR, pas de percentile, alors que FundingMatrixWindow normalise déjà en APR et que fetchFundingRateHistory est déjà appelé (ligne 313).
- **Reco :** Afficher à côté du taux : l'APR annualisé (réutiliser la convention de data/fundingCrossExchange.ts) et un percentile/z-score sur l'historique déjà fetché (allonger SPARK_WINDOW_MS à 7-30 j pour le calcul). Colorer selon un seuil d'extrême (ex. |APR| > 30 %) plutôt que selon le simple signe — un funding de +0.01 % est neutre, pas « up ».
- **Note de contre-expertise :** Vérifié dans apps/web/src/components/DerivativesWindow.tsx : ligne 488 `value={formatFunding(funding?.rate)}` exacte, couleur binaire sur le signe lignes 491-497 (`funding.rate >= 0 ? "var(--up)" : "var(--down)"`), sans aucun référentiel de niveau. fetchFundingRateHistory est bien appelé ligne 313 avec SPARK_WINDOW_MS = 2 h (l.68, « 2 h à 5 min ≈ 24 points ») — l'historique existe donc déjà mais ne sert qu'à une microtendance. La comparaison est fondée : data/fundingCrossExchange.ts normalise en APR (`annualiserFunding`, l.30-31, champ `apr` l.26) et FundingMatrixWindow l'affiche (« funding annualisé (APR) », l.56, colonne APR l.75). Le funding prédit (l.499-512) souffre du même codage binaire par signe. Tout est exact.

#### `apps/web/src/components/BriefWindow.tsx:640` (synthese) · **verdict : PLAUSIBLE**
- **Constat :** Aucune synthèse transversale « régime » n'existe dans le terminal alors que toutes les briques sont branchées (funding, ΔOI, F&G, DVOL, liquidations, impression stablecoins, flux ETF) — chaque fenêtre expose ses chiffres, personne ne compose le signal. REGIME a été écarté du lot du 9 juillet pour dépendance à un historique long, mais un score composite instantané n'en dépend pas.
- **Preuve :** Spec 2026-07-09 §5 : « Écartés pour ce lot […] REGIME » ; BriefWindow assemble déjà fetchDerivsBrief + fetchFearGreed + fetchDvolBrief + fetchEtfBrief dans un même Promise.allSettled (lignes 206-220) sans jamais les croiser.
- **Reco :** Concevoir un module pur `data/regime.ts` (testable) qui note chaque composant sur une échelle -2..+2 (funding, F&G, DVOL vs seuils, ΔOI, flux ETF) et produit un score + libellé (« risk-on tendu », « neutre », « capitulation »). L'afficher en tête de BRIEF et éventuellement en pastille Taskbar. C'est LA synthèse manquante que cet audit doit nourrir.
- **Note de contre-expertise :** Le fond est réel et vérifié : aucun module regime n'existe (aucun fichier ni occurrence « regime » dans apps/web/src/, pas de data/regime.ts) ; la spec docs/superpowers/specs/2026-07-09-uniformisation-ui-features-design.md l.78 dit bien « Écartés pour ce lot (documentés comme suites) : ALRT v2, REGIME, HIST (dépendent d'un historique [long]) » ; et BriefWindow assemble fetchDerivsBrief, fetchEtfBrief, fetchFearGreed et fetchDvolBrief dans un même Promise.allSettled (lignes 206-222, la fourchette 206-220 citée est correcte) sans jamais croiser les signaux. MAIS la localisation « ligne 640 » est fausse : BriefWindow.tsx fait 631 lignes — la ligne citée n'existe pas. Finding réel mais mal localisé (il décrit d'ailleurs une absence transversale au terminal plus qu'un défaut à une ligne précise), donc PLAUSIBLE plutôt que CONFIRME au sens strict fichier:ligne.

### Sévérité moyenne (9)

#### `apps/web/src/components/DerivativesWindow.tsx:624` (synthese)
- **Constat :** L'Open Interest apparaît deux fois dans la même fenêtre (Metric Coinalyze en haut, Metric « Open Interest » Binance fapi dans la section Sentiment perp) sans réconciliation ni explication de l'écart — deux chiffres proches mais différents pour le même concept.
- **Preuve :** Ligne 480 : `<Metric label="Open Interest" value={formatUsd(oi?.oiUsd)} sourceId="coinalyze:oi" />` puis ligne 624 : `<Metric label="Open Interest" value={formatUsd(binOi.at(-1)?.oiUsd)} color={OI_COLOR} />` — même libellé exact, sources différentes, aucun badge sur le second.
- **Reco :** Soit supprimer le doublon Binance (garder la sparkline OI Binance comme repli quand la clé Coinalyze manque), soit renommer « OI Binance fapi » avec badge de fiabilité et afficher l'écart vs Coinalyze. Idéalement : un seul chiffre OI + ΔOI 24 h en % (le delta est plus signifiant que le niveau, comme le fait déjà BriefWindow).

#### `apps/web/src/components/DerivativesWindow.tsx:605` (synthese)
- **Constat :** La section Sentiment perp affiche 4 ratios bruts (Comptes globaux L/S, Top traders L/S, Taker achat/vente, OI) plus le « Long/Short agrégé » Coinalyze au-dessus : 5 lectures de positionnement que l'opérateur doit croiser mentalement pour répondre à « le marché est-il crowded long ? ».
- **Preuve :** Lignes 520-530 et 605-629 : cinq Metric successifs à ratios 2 décimales, aucun agrégat ; la divergence retail (globaux) vs top traders — le signal le plus utile — n'est jamais calculée.
- **Reco :** Ajouter une ligne de lecture : écart « top traders − comptes globaux » (divergence smart money) et un badge de positionnement (« crowded long » si globaux > seuil ET taker > 1, etc.). Réordonner : le composite d'abord, les 4 ratios en détail dessous.

#### `apps/web/src/components/LiquidationsWindow.tsx:565` (synthese)
- **Constat :** Les totaux « Longs/Shorts liquidés (1h) » sont des montants bruts sans référentiel : impossible de savoir si $8M/h est calme ou une cascade, alors que l'onglet Historique dispose de 30 j de données daemon qui permettraient une comparaison.
- **Preuve :** `<Metric label={`Longs liquidés (${fenetre})`} value={formatUsd(stats.longUsd)} …/>` — aucun ratio vs moyenne, ni percentile, alors que `liquidationsGet` (ligne 707) peut lire 30 j et que le cache module-level existe déjà.
- **Reco :** Calculer côté onglet Live un référentiel « ×N vs moyenne horaire 30 j » (une lecture daemon en tâche de fond, mise en cache 1 h) et l'afficher en sous-texte du Metric, avec teinte d'alerte au-delà d'un multiple (ex. ×3). C'est le passage du chiffre brut au signal pour la fenêtre la plus événementielle du terminal.

#### `apps/web/src/components/FundingMatrixWindow.tsx:60` (hierarchie)
- **Constat :** L'écart de funding cross-exchange — le signal déclaré de la fenêtre (« l'écart CEX vs DEX est le signal », doc de tête ligne 4-5) — est affiché en texte neutre dans le sous-titre, sans seuil ni couleur, et la table ne marque pas quelle venue diverge.
- **Preuve :** `<span className="font-semibold text-text">{formatDec(spread, 2)} %</span>` — text-text quel que soit le niveau ; les lignes de la table sont visuellement équivalentes.
- **Reco :** Colorer l'écart selon un seuil (ex. neutre < 5 pts APR, tension ≥ 15) via Badge, et surligner dans la table la venue min et max (celles qui définissent le spread). Ajouter une ligne de repère « neutre ≈ 10.95 % APR (0.01 %/8 h) » dans la NoteSource pour donner le référentiel.

#### `apps/web/src/components/VolWindow.tsx:370` (hierarchie)
- **Constat :** La seule lecture interprétée de la fenêtre (RV30 · DVOL · VRP · z-score RV) est reléguée dans `actions` de l'en-tête en 11px text-dim tronquable, alors que le canvas au-dessous n'est que le support. La hiérarchie est inversée : le signal est le moins visible.
- **Preuve :** `<div className="max-w-[340px] truncate text-right text-[11px] tabular-nums text-text-dim">{synthese}</div>` — VRP et z-score, pourtant seuils naturels (VRP < 0 = vol sous-pricée, |z| > 2 = extrême), sont en gris uniforme et coupés si la fenêtre est étroite.
- **Reco :** Promouvoir la synthèse en rangée de 4 Metric au-dessus du canvas : VRP coloré (up si positif, down si négatif), z-score avec badge « extrême » au-delà de ±2, RV30 et DVOL neutres. Supprimer le truncate — c'est le contenu principal, pas une décoration d'en-tête.

#### `apps/web/src/components/StablecoinsWindow.tsx:203` (hierarchie)
- **Constat :** Les Δ 24 h / 7 j / 30 j de la Vue d'ensemble sont en USD absolu uniquement (« +$1.2B ») sans normalisation en % de la supply : impossible de juger si l'impression accélère sans faire la division de tête, et sans comparaison entre les trois horizons.
- **Preuve :** `<Metric label="Δ 24 h" value={fmtDeltaUsd(d24h)} couleur={couleurDelta(d24h)} />` — fmtDeltaUsd ne rend que le montant ; la grille grid-cols-2 laisse d'ailleurs le 5e Metric orphelin.
- **Reco :** Ajouter le % de supply en sous-texte de chaque Δ (`+$1.2B · +0.48 %`) et une mini-sparkline 30 j (l'historique est déjà chargé pour l'onglet Impression). Passer la grille en 3 colonnes (Supply/Dominance/Δ24h · Δ7j/Δ30j/pegs) pour une rangée signal cohérente.

#### `apps/web/src/components/StablecoinsWindow.tsx:199` (synthese)
- **Constat :** Un depeg en cours — l'événement le plus critique du domaine — est invisible depuis l'onglet par défaut « Vue d'ensemble » : l'état des pegs n'est calculé que dans l'onglet Pegs, que l'opérateur n'ouvre pas s'il ne soupçonne rien.
- **Preuve :** VueEnsemble (lignes 182-212) n'importe ni `ecartPegBps` ni `etatPeg` ; seul VuePegs (ligne 505) les utilise, avec des seuils déjà définis (stable/tension/depeg).
- **Reco :** Remonter dans la Vue d'ensemble un Metric « Pegs » synthétique (« 24 stables · 1 tension · 0 depeg ») calculé avec les mêmes pures de stablecoinsWindow.util, badge down si un depeg existe, cliquable vers l'onglet Pegs. Coût quasi nul : les émetteurs sont déjà en mémoire.

#### `apps/web/src/components/BriefWindow.tsx:488` (hierarchie)
- **Constat :** Dans les cartes Dérivés du BRIEF, le ΔOI 24 h est coloré up/down mais le funding (actuel et prédit) reste en text-text neutre à 4 décimales : les deux chiffres du même bloc n'ont pas le même niveau de lecture, et le funding — pourtant l'input de régime — reste un chiffre brut.
- **Preuve :** `funding <span className="tabular-nums text-text">{fmtFunding(d.fundingActuel)}</span>` vs ligne 482 `style={{ color: couleurVariation(d.deltaOiPct) }}` sur le ΔOI.
- **Reco :** Appliquer au funding la même logique de lecture que la reco DerivativesWindow : teinte selon seuil d'extrême (pas selon signe), ou a minima un Badge « funding chaud/froid » quand |taux| dépasse un seuil (ex. 3× le taux de base 0.01 %). Mettre en gras l'écart actuel→prédit s'il change de signe (retournement imminent).

#### `apps/web/src/components/ScreenerWindow.tsx:513` (hierarchie)
- **Constat :** La table de résultats du screener affiche funding (4 déc., coloré par signe), Δ OI et L/S (2 déc., gris) sans aucune mise en évidence des extrêmes : la question de la fenêtre est « quels symboles sortent du lot », mais toutes les lignes se valent visuellement une fois le filtre passé.
- **Preuve :** `<span className="text-right tabular-nums text-text-dim">{r.longShortRatio === undefined ? "—" : r.longShortRatio.toFixed(2)}</span>` — L/S toujours en text-dim ; funding coloré up dès ≥ 0 (ligne 495), donc quasi toutes les lignes sont vertes.
- **Reco :** Ajouter une barre de magnitude relative en fond de cellule (pattern LigneFeed de LiquidationsWindow, opacity-15) sur Δ24h, funding et ΔOI, normalisée sur le run courant ; réserver la couleur du funding aux extrêmes (percentile du run) plutôt qu'au signe. Mettre en gras la ligne du max de chaque colonne triée.

### Sévérité basse (4)

#### `apps/web/src/components/BriefWindow.tsx:573` (hierarchie)
- **Constat :** Le Fear & Greed — indicateur de sentiment global — est rendu comme un petit badge dans l'en-tête de la section « Actualités », sans rapport thématique, et le DVOL est en dernière section : les deux indicateurs de régime sont aux emplacements les moins visibles du BRIEF.
- **Preuve :** `{fearGreed.statut === "ready" && … <Badge ton="accent">F&G {fearGreed.data.value}…</Badge>}` dans le header du bloc Actualités ; section « Volatilité · DVOL » en position 6 (ligne 613) avec deux valeurs brutes sans Δ.
- **Reco :** Déplacer F&G et DVOL dans le bandeau de synthèse chapeau (cf. finding BRIEF haute) ; pour DVOL, afficher le Δ vs veille (fetchDvolBrief peut retourner la valeur J-1) et une teinte selon variation.

#### `apps/web/src/components/OnchainWindow.tsx:527` (synthese)
- **Constat :** La section Flux ETF n'affiche que le cumul du dernier jour par émetteur, sans historique ni cumul hebdo : un flux de -$200M ne se lit pas sans la série des jours précédents. La même donnée SoSoValue est aussi affichée dans BriefWindow (section « Flux ETF · veille ») sous une autre forme, sans que l'une renvoie à l'autre.
- **Preuve :** `{etf.parEmetteur.map((e) => … {formatUsd(e.flux)})}` + `Cumul {etf.jour}` — un seul jour ; BriefWindow.tsx lignes 508-528 refait la même lecture agrégée par actif.
- **Reco :** Ajouter dans OnchainWindow une sparkline des flux quotidiens (10-20 derniers jours, l'API SoSoValue les renvoie) et un cumul 7 j ; c'est le référentiel minimal pour juger un flux du jour. Garder BRIEF comme simple relais (total par actif) — la redondance est acceptable si la fenêtre détaillée porte le contexte.

#### `apps/web/src/components/SymbolBanner.tsx:199` (hierarchie)
- **Constat :** Le bandeau affiche H et L 24 h en chiffres bruts : la position du prix courant dans le range — l'information réellement utile (près du haut ? du bas ?) — demande un calcul mental à chaque lecture.
- **Preuve :** `H <span ref={highRef} …>—</span>` / `L <span ref={lowRef} …>—</span>` — deux nombres, aucune représentation de la position relative.
- **Reco :** Ajouter une micro-jauge (barre 40 px, position du close entre low et high, écrite impérativement via ref comme le reste — le contrat de perf est compatible avec un style.left). Les chiffres H/L peuvent passer en title/tooltip pour alléger le bandeau.

#### `apps/web/src/components/TickerBand.tsx:145` (hierarchie)
- **Constat :** Toutes les headlines défilent au même niveau visuel : aucune distinction entre une brève de routine et un titre à fort impact marché — le bandeau, permanent à l'écran, n'exploite pas sa position pour hiérarchiser.
- **Preuve :** `<span className="whitespace-nowrap text-[11px] text-text">{item.title}</span>` — style unique pour tous les items ; seule la couleur de badge distingue la source, pas l'importance.
- **Reco :** Introduire une notion d'importance côté data/news (mots-clés type « Fed », « SEC », « hack », « ETF approval », ou champ impact des flux qui le portent) et la refléter par un traitement discret (titre en font-medium ou puce colorée) — sans re-render haute fréquence, le style se décide au render du cycle 3 min.

---

# Candidats features (22)

## Direction : aide-decision

### REGIME — effort M
- **Pitch :** Score d'état de régime de marché (risk-on / neutre / risk-off, tendance / range) affiché en permanence dans le chrome et détaillé dans une mini-fenêtre : composite pondéré de funding BTC/ETH, ΔOI 24h, DVOL, Fear & Greed, dominance BTC, momentum de la capitalisation totale et de la supply stablecoins. L'opérateur sait en un coup d'œil dans quel environnement il trade avant de choisir un playbook.
- **Valeur différenciante :** TradingView n'a aucun composite crypto-natif ; CoinGlass affiche chaque métrique isolément sans synthèse. Ici le score est calculé localement sur des sources déjà payées/gratuites, historisé dans le daemon, et peut piloter les playbooks existants (data/playbooks.ts : « risk-off » devient déclenchable par le régime).
- **Données déjà branchées :** Funding + prédit : data/coinalyze.ts (fetchFundingRate/fetchPredictedFundingRate, déjà utilisés par brief.ts:507-525) ; ΔOI 24h : data/binanceFutures.ts fetchOpenInterestHist + deltaOiPct pur (brief.ts:166-172) ; DVOL : data/deribit.ts fetchDvol ; Fear & Greed + dominance + Δmcap : data/marketOverview.ts (MarketGlobal, parseGlobal) ; série mcap historisée localement : store/macroHistory.ts (1500 pts, poller central 5 min) ; supply stablecoins journalière : data/macro/stablecoins.ts (DefiLlama) ; historisation du score : daemon cache candles.ts (POST /candles/:source/:symbole/:tf, générique, déjà consommé par data/backtestData.ts) — la contrainte « historique long » de la spec 2026-07-09 §5 est levée.
- **Fichiers concernés :** `apps/web/src/data/marketOverview.ts`, `apps/web/src/data/coinalyze.ts`, `apps/web/src/data/binanceFutures.ts`, `apps/web/src/data/deribit.ts`, `apps/web/src/store/macroHistory.ts`, `apps/web/src/data/macro/stablecoins.ts`, `apps/daemon/src/candles.ts`, `apps/web/src/data/playbooks.ts`
- **Risques :** Calibration des pondérations/seuils arbitraire au départ (assumer et afficher les composantes, pas seulement le score) ; l'historique OI Binance fapi est plafonné ~30 j ; risque de faux confort si le score est présenté comme prédictif — le libeller « état », jamais « signal ».

### PULSE — effort M
- **Pitch :** Heads-up display des anomalies du moment : une bande dense (pattern SessionStrip) listant, priorisées par sévérité, les 3-5 choses anormales MAINTENANT — funding en z-score extrême, cascade de liquidations en cours ($/min vs baseline), divergence CVD spot/perp active, écart d'APR CEX/DEX, depeg stablecoin, source de données dégradée. Clic = ouvre la fenêtre concernée (bus navigateTo existant).
- **Valeur différenciante :** C'est exactement le « quoi regarder maintenant » : aucun concurrent n'agrège ces signaux hétérogènes en une file priorisée ; CoinGlass oblige à ouvrir 5 pages. Toutes les détections existent déjà sous forme de calculs, il ne manque que la surface d'agrégation.
- **Données déjà branchées :** z-score funding : apps/daemon/src/marketFeed.ts (zScoreFunding, FENETRE_Z_FUNDING=30) et chargerHistoriqueFunding ; $/min liquidations : apps/daemon/src/alerts.ts sommeLiqUsdParMin (SQL sur table liquidations) ; divergence CVD : store/cvd-divergence.ts (bySymbol, déjà branché au runtime d'alertes) ; APR cross-exchange : data/fundingCrossExchange.ts (annualiserFunding, 4 venues) ; état des pegs : components/stablecoinsWindow.util.ts (classerEcartPeg, seuils 25/100 bps) ; santé sources : store/health.ts ; surfaces de référence : components/SessionStrip.tsx et TickerBand.tsx (contrat perf sans re-render par tick).
- **Fichiers concernés :** `apps/web/src/components/SessionStrip.tsx`, `apps/daemon/src/marketFeed.ts`, `apps/daemon/src/alerts.ts`, `apps/web/src/store/cvd-divergence.ts`, `apps/web/src/data/fundingCrossExchange.ts`, `apps/web/src/components/stablecoinsWindow.util.ts`, `apps/web/src/store/health.ts`
- **Risques :** Budget requêtes : les détections front doivent réutiliser les pollers existants (pas de nouvelle boucle par signal) ; hiérarchisation des sévérités à définir explicitement sinon le HUD devient un second ticker bruyant ; respect strict du contrat perf (écritures DOM impératives, pas de state React haute fréquence).

### XSTAT — effort S
- **Pitch :** Référentiel historique des extrêmes : chaque métrique clé (funding, ΔOI, $/min liquidé, DVOL) est affichée avec son rang percentile sur 30 j — « funding BTC 0,0812 % = p97 / 30 j » — sous forme de Badge dans DES, LIQ et BRIEF. Transforme des chiffres bruts en jugement immédiat : est-ce vraiment extrême ou juste élevé ?
- **Valeur différenciante :** CoinGlass montre les valeurs mais jamais leur rang dans la distribution récente ; c'est le référentiel local (SQLite du daemon, propre à l'opérateur, gratuit) qui rend le chiffre interprétable. Le calcul de percentile est trivial et pur (testable), le stockage existe déjà.
- **Données déjà branchées :** Liquidations 30 j déjà accumulées en continu : apps/daemon/src/liqFeed.ts (rétention 30 j, purge quotidienne, symboles = KV liq/symboles ∪ alertes actives) + GET /liquidations/:symbole?depuis&jusqua (apps/daemon/src/liquidations.ts:174-212, déjà consommé par l'onglet Historique de LiquidationsWindow.tsx:665+ via liquidationsGet de data/daemon.ts) ; historique funding : marketFeed.ts FUNDING_RATE_HIST_URL (fapi /fundingRate) et data/coinalyze.ts *-history ; accumulation longue durée des séries funding/OI : cache générique apps/daemon/src/candles.ts (candlesPush déjà exposé dans data/daemon.ts:387).
- **Fichiers concernés :** `apps/daemon/src/liquidations.ts`, `apps/daemon/src/liqFeed.ts`, `apps/daemon/src/candles.ts`, `apps/web/src/data/daemon.ts`, `apps/web/src/components/DerivativesWindow.tsx`, `apps/web/src/components/LiquidationsWindow.tsx`, `apps/web/src/components/ui.tsx`
- **Risques :** Le référentiel n'est fiable qu'après quelques semaines d'accumulation (afficher honnêtement la profondeur réelle : « p97 sur 12 j de données ») ; daemon absent → badge simplement masqué (dégradation déjà pattern LiquidationsWindow) ; percentile sur 30 j seulement, à ne pas confondre avec un extrême historique multi-années.

### ALRT2 — effort M
- **Pitch :** Alertes composées contextuelles : combiner en ET les 7 conditions existantes du moteur pur — ex. « funding-extreme ET liq-cascade sur BTCUSDT » ou « prix-croise ET cvd-spot-perp-div » — pour ne notifier que les confluences, celles qui méritent d'interrompre l'opérateur. Évaluées onglet fermé par le daemon comme aujourd'hui.
- **Valeur différenciante :** TradingView ne connaît ni funding, ni liquidations, ni CVD spot/perp ; CoinGlass n'a pas d'alertes composées. La confluence est le vrai filtre anti-bruit d'un mono-utilisateur : moins de notifications, chacune actionnable. La spec 2026-07-09 §5 l'avait écartée « faute d'historique » — l'historique (z-score funding, table liquidations 30 j) est maintenant en place.
- **Données déjà branchées :** Moteur pur et partagé : packages/alerts/src/engine.ts (7 types : prix-croise, variation-pct, indicateur-seuil/croisement, funding-extreme, cvd-spot-perp-div, liq-cascade) + describe.ts (libellés FR) ; évaluation onglet fermé + journal SQLite + anti-doublon heartbeat : apps/daemon/src/alerts.ts (evaluerEtPersister, alertes_journal) ; contexte funding z-score et liq $/min déjà injectés (alerts.ts:373-434) ; dual-write des defs via KV (store/alerts.ts → kv.ts).
- **Fichiers concernés :** `packages/alerts/src/types.ts`, `packages/alerts/src/engine.ts`, `packages/alerts/src/describe.ts`, `apps/daemon/src/alerts.ts`, `apps/web/src/store/alerts.ts`, `apps/web/src/components/AlertsPanel.tsx`, `apps/web/src/alerts/runtime.ts`
- **Risques :** Sémantique du ré-armement d'une composée (les deux branches doivent-elles se ré-armer ensemble ?) à spécifier avant de coder ; fenêtre de coïncidence temporelle entre conditions évaluées sur des ticks différents (prix ~1 s, funding ~60 s, liq ~10 s) ; migration du schéma AlertDef dans le KV (protégée par SAVE/kv_snapshots, désormais en place).

### BRIEF+ — effort S
- **Pitch :** Couche de lecture interprétée en tête du BRIEF : 2-4 « points d'attention » générés par des règles déterministes pures sur les données déjà assemblées — « Funding BTC en p95 + ΔOI +6 % : positionnement long tendu », « 3e jour consécutif de sorties ETF ETH », « CPI dans 2 h ». Le reste du brief devient la pièce justificative de ces lectures.
- **Valeur différenciante :** C'est l'étape qui manque entre le snapshot (déjà livré) et l'aide à la décision : personne d'autre ne croise ETF + funding + OI + calendrier dans une phrase. 100 % règles à seuils testables, zéro LLM (direction écartée), et l'export markdown vers NOTES en profite gratuitement.
- **Données déjà branchées :** Toutes les sections existent dans data/brief.ts : DonneesBrief (session, watchlist, derivs avec funding/prédit/ΔOI, etf, eco, news, fearGreed, dvol — brief.ts:148-158), fetchers dégradables par section (Promise.allSettled), briefEnMarkdown pur ; il suffit d'ajouter des fonctions pures lectures(d: DonneesBrief): Lecture[] au même endroit et de les rendre dans components/BriefWindow.tsx ; percentiles éventuels fournis par XSTAT (daemon).
- **Fichiers concernés :** `apps/web/src/data/brief.ts`, `apps/web/src/data/brief.test.ts`, `apps/web/src/components/BriefWindow.tsx`
- **Risques :** Le ton doit rester factuel-conditionnel (« positionnement tendu »), jamais prescriptif (« short ») — c'est un terminal, pas un conseiller ; règles à seuils fixes moins pertinentes sans référentiel historique → livrer idéalement après ou avec XSTAT ; inflation de règles ad hoc à borner (liste fermée, testée).

### SQZ — effort S
- **Pitch :** Preset « anomalies » du screener : une vue triée par un score de tension composite (funding extrême × ΔOI × ratio L/S divergent retail vs top traders) qui répond à « où est le squeeze potentiel là, tout de suite ? » au lieu d'exiger de composer soi-même 6 filtres.
- **Valeur différenciante :** Le croisement foule retail (globalLongShortAccountRatio) contre top traders (topLongShortPositionRatio) est disponible gratuitement chez Binance mais présenté nulle part comme un différentiel exploitable ; CoinGlass le montre par symbole, jamais en screener trié.
- **Données déjà branchées :** Univers + funding fusionné premiumIndex : data/screener.ts (1 req ticker/24hr + 1 req premiumIndex, filtres de base déjà en place) ; enrichissement OI Δ% et L/S sur les 20 plus liquides : SCREENER_POSITION_CAP (screener.ts:38-43) via data/positioning.ts (fetchLsAccountRatio / fetchLsTopTraderRatio / fetchTakerRatio, 500 pts 1h) ; store et fenêtre existants : store/screener.ts, components/ScreenerWindow.tsx.
- **Fichiers concernés :** `apps/web/src/data/screener.ts`, `apps/web/src/data/positioning.ts`, `apps/web/src/store/screener.ts`, `apps/web/src/components/ScreenerWindow.tsx`
- **Risques :** Couverture honnête : le positionnement est plafonné aux 20 plus liquides (2 req/symbole) — le score n'est calculable que sur cet échantillon, l'afficher clairement (pattern « note de couverture » déjà en place) ; pondération du score composite arbitraire → exposer les composantes dans la ligne.

### EVGARD — effort S
- **Pitch :** Garde d'événement : croise le calendrier éco fort impact avec l'état de l'opérateur (positions ouvertes du portefeuille, alertes actives) pour afficher une bannière contextuelle « CPI US dans 42 min — 2 positions BTC ouvertes » et proposer en 1 clic le playbook FOMC existant. L'alerte devient contextuelle : elle ne sonne que si l'événement vous concerne.
- **Valeur différenciante :** TradingView affiche le calendrier mais ne sait pas ce que vous détenez ; ici le croisement événement × exposition est local et instantané. Réutilise le playbook « FOMC » déjà livré (data/playbooks.ts) comme action de mitigation à un clic.
- **Données déjà branchées :** Calendrier fusionné ForexFactory/FRED/FOMC avec impact et timeApprox : data/eco.ts (chargerEvenementsEco, dégradation gracieuse) + filtre pur evenementsDuJour (data/brief.ts:178-195) ; positions ouvertes : store/portfolio.ts (statut, symbole, direction — déjà lu par SessionStrip.tsx pour le P&L jour) ; toasts/notifications : components/Toasts.tsx et le runtime alerts/runtime.ts ; playbook cible : data/playbooks.ts.
- **Fichiers concernés :** `apps/web/src/data/eco.ts`, `apps/web/src/data/brief.ts`, `apps/web/src/store/portfolio.ts`, `apps/web/src/components/SessionStrip.tsx`, `apps/web/src/data/playbooks.ts`, `apps/web/src/alerts/runtime.ts`
- **Risques :** Heures approximées (timeApprox FRED/FOMC) → le compte à rebours doit afficher « ~ » et une marge, jamais une précision fausse ; mapping symbole↔sensibilité événement gardé trivial en v1 (tout événement US fort impact concerne toute position crypto) sous peine de sur-ingénierie ; évaluation front uniquement (onglet ouvert) en v1, le daemon n'a pas le calendrier.

## Direction : orderflow

### ABSORB — effort M
- **Pitch :** Détection d'absorption et d'exhaustion sur le footprint : un niveau qui encaisse un volume agressif anormal sans que le prix traverse (absorption), ou une bougie à delta extrême qui clôture sans extension (exhaustion). Badges dessinés directement sur les cellules du footprint existant, avec le niveau de prix marqué tant qu'il n'est pas retesté.
- **Valeur différenciante :** TradingView n'a pas de footprint natif ; les outils qui en ont (Exocharts, ATAS) sont payants et ne détectent l'absorption qu'en règle propriétaire opaque. Ici la règle est un calcul TS pur, testable, documenté en français, sur les mêmes cellules buy/sell déjà bucketisées.
- **Données déjà branchées :** Buffer footprint tick-par-tick déjà accumulé (Map<candleTime, Map<bucket, FpCell>>, borné à MAX_FOOTPRINT_CANDLES=120) dans apps/web/src/chart/orderflow.ts:59-66 ; buildFootprintBar (POC/VA/delta) dans apps/web/src/chart/orderflow.calc.ts:84-138 ; le pattern détection pure + flags indexés sur rows existe déjà avec detectImbalances/markRuns dans apps/web/src/chart/footprintAnalytics.ts:46-119 — ABSORB est un troisième détecteur dans le même fichier, rendu par le même contrôleur canvas.
- **Fichiers concernés :** `apps/web/src/chart/footprintAnalytics.ts`, `apps/web/src/chart/footprintAnalytics.test.ts`, `apps/web/src/chart/orderflow.ts`, `apps/web/src/chart/orderflow.calc.ts`, `apps/web/src/components/FootprintSettingsPanel.tsx`
- **Risques :** Le footprint est live-only (accumulation depuis la souscription, aucun historique tick) : le détecteur n'a de contexte qu'après quelques bougies. Seuils (volume anormal, wick max) à calibrer par magnitude de symbole — prévoir des réglages dans FootprintSettingsPanel comme ratioPct/minVol. Densité visuelle : le footprint porte déjà imbalances+stacked+divergences, risque de surcharge si les badges ne sont pas hiérarchisés.

### SWEEP — effort M
- **Pitch :** Détection de big prints et de sweeps de liquidité : rafales d'aggTrades du même côté en <500 ms dont le notionnel dépasse un percentile glissant, croisées avec le carnet local pour confirmer que plusieurs niveaux ont été consommés. Marqueurs sur le chart + ligne surlignée dans la TAPE, avec taille cumulée et niveaux balayés.
- **Valeur différenciante :** TradingView n'a ni tape ni carnet ; les screeners de whale trades publics sont cross-market et non contextualisés. Ici le sweep est corrélé au carnet LOCAL reconstruit (procédure officielle Binance déjà implémentée) : on sait quels murs ont été mangés, pas juste qu'un gros trade est passé.
- **Données déjà branchées :** TAPE avec seuil gros trades déjà en place (SEUILS_GROS_TRADE, TAPE_MAX=200) dans apps/web/src/components/DomWindow.tsx:8-9,47 via binanceAdapter.subscribeTrades ; carnet local synchronisé (coudre/appliquerDiffLive, pur et testé) dans apps/web/src/data/depth.ts:89-128 ; flux perp dispo via subscribePerpAggTrades (apps/web/src/data/binanceFutures.ts:281) ; le pattern marqueurs chart existe dans apps/web/src/chart/tradeMarkers.ts.
- **Fichiers concernés :** `apps/web/src/components/DomWindow.tsx`, `apps/web/src/data/depth.ts`, `apps/web/src/data/binance.ts`, `apps/web/src/chart/tradeMarkers.ts`, `apps/web/src/data/binanceFutures.ts`
- **Risques :** Budget WS : DomWindow assume UNE connexion à la fois (depth OU trades, cf. en-tête DomWindow.tsx:14-15) — corréler trades+carnet exige les deux simultanément, il faut assouplir ce budget explicitement. aggTrade agrège déjà côté Binance : la fenêtre de regroupement doit être testée pour ne pas sur-fusionner. Percentile glissant = état accumulé, à borner en mémoire comme le buffer footprint.

### WALLS — effort L
- **Pitch :** Murs de liquidité persistés dans le temps : historiser les murs détectés dans le ladder (apparition, déplacement, retrait avant contact = spoof probable, consommation) et les peindre en heatmap de liquidité passive sur le chart, à la Bookmap. L'opérateur voit si le mur sous le prix est stable depuis 20 min ou vient d'apparaître.
- **Valeur différenciante :** La détection actuelle est un instantané jetable à chaque frame ; Bookmap facture cette vue et CoinGlass ne l'a qu'en agrégé propriétaire. La grille bougie×bucket, l'échelle log1p et le contrôleur canvas synchronisé viewport existent déjà pour les liquidations — c'est la même machinerie appliquée au carnet.
- **Données déjà branchées :** Détection de murs déjà codée mais volatile : WALL_FACTOR=4 × médiane visible dans apps/web/src/components/DomWindow.tsx:43 et le test `const mur = med > 0 && r.qte >= seuilMur` à DomWindow.tsx:234 ; carnet live ~10/s via souscrireDepth (apps/web/src/data/depth.ts:263) ; agrégation par pas de prix (agregerNiveaux, pasArrondi) depth.ts:137-175 ; moteur de grille 2D bougie×bucket + rendu réutilisable dans apps/web/src/chart/liquidationHeat.ts (construireGrille, LiqCell).
- **Fichiers concernés :** `apps/web/src/data/depth.ts`, `apps/web/src/components/DomWindow.tsx`, `apps/web/src/chart/liquidationHeat.ts`, `apps/web/src/chart/liquidationMarkers.ts`
- **Risques :** Snapshot limité à 1000 niveaux (SNAPSHOT_LIMIT, depth.ts:214) et spot Binance uniquement — les murs perp sont invisibles. Échantillonner le carnet à intervalle régulier crée un état mémoire conséquent à borner strictement. La qualification « spoof » est une inférence (pas de L3, on ne voit pas les ordres individuels) : l'étiqueter honnêtement (« retiré avant contact »), comme le fait « EST. » pour liquidationEstimates.

### CVDX — effort S
- **Pitch :** Croisements CVD spot/perp signalés et alertables : en plus des divergences déjà détectées, marquer les points où les deux courbes rebasées se croisent (le perp prend/perd le leadership), avec badge horodaté sur le pane CVD_SP et alerte optionnelle. Petit historique des derniers événements dans la fenêtre.
- **Valeur différenciante :** TradingView n'a même pas de CVD perp vs spot natif sur crypto ; ici les deux séries rebasées à l'origine commune existent déjà à l'écran, il ne manque que la détection du croisement — un signal leadership spot/perp qu'aucun outil grand public ne matérialise.
- **Données déjà branchées :** Séries prêtes : buildCvdSpotPerpBuckets (rebase à origine commune) dans apps/web/src/chart/orderflow.calc.ts:49-77 ; détecteur pur existant à étendre dans apps/web/src/chart/cvdSpotPerp.ts:55-91 (detectCvdDivergences, pattern médiane anti-bruit réutilisable pour filtrer les micro-croisements) ; pane dédié CVD_SP_PANE_ID et flux perp câblés dans apps/web/src/chart/orderflow.ts:53-58 ; store de publication apps/web/src/store/cvd-divergence.ts ; runtime d'alertes apps/web/src/alerts/runtime.ts.
- **Fichiers concernés :** `apps/web/src/chart/cvdSpotPerp.ts`, `apps/web/src/chart/cvdSpotPerp.test.ts`, `apps/web/src/chart/orderflow.ts`, `apps/web/src/store/cvd-divergence.ts`, `apps/web/src/alerts/runtime.ts`
- **Risques :** Le CVD perp ne démarre qu'à la souscription WS (commentaire orderflow.calc.ts:40-47) : les premiers croisements après ouverture sont des artefacts de rebase — imposer un warm-up (≥ lookback bougies) avant de signaler. Croisements fréquents en range : le filtre médiane est indispensable sous peine de spam.

### CASCADE+ — effort M
- **Pitch :** Détection de cascades de liquidations enrichie : scorer chaque cascade (notionnel, vitesse, accélération, mix Bybit/OKX, bascule long→short) et la situer dans la distribution historique 30 j du daemon (« cascade top 5 % du mois »). Les cascades majeures passées deviennent des zones annotées sur le chart.
- **Valeur différenciante :** CoinGlass montre des totaux de liquidations, jamais la structure d'une cascade ni son rang percentile personnel : la table SQLite locale (rétention 30 j, multi-venue, alimentée en continu par le daemon) est une donnée que ni TradingView ni les sites publics ne peuvent recouper avec le chart de l'opérateur.
- **Données déjà branchées :** Groupement de cascades déjà pur et testé : grouperCascades (écart 2 s, même côté) dans apps/web/src/components/liquidationsWindow.util.ts:149 et usdParMinute:201 ; flux live fusionné Bybit+OKX apps/web/src/data/liquidations.ts:378-385 ; historique persistant : table liquidations(symbole,venue,t,side,price,qty,usd) dans apps/daemon/src/liquidations.ts:38-50, ingestion continue apps/daemon/src/liqFeed.ts, client GET avec depuis/jusqua dans apps/web/src/data/daemon.ts:416-434 ; rendu zones via liqEventsStore/liquidationHeat.ts.
- **Fichiers concernés :** `apps/web/src/components/liquidationsWindow.util.ts`, `apps/web/src/components/LiquidationsWindow.tsx`, `apps/web/src/data/daemon.ts`, `apps/daemon/src/liquidations.ts`, `apps/web/src/chart/liquidationHeat.ts`
- **Risques :** Historique daemon limité aux symboles surveillés (KV liq/symboles, défaut BTC/ETH/SOL — liqFeed.ts SYMBOLES_DEFAUT) : percentiles indisponibles ailleurs, dégrader honnêtement. Bybit/OKX seulement (Binance forceOrder géo-bloqué, cf. liquidations.ts:8-12) : le notionnel absolu est sous-compté, les percentiles restent valides car auto-référencés. GET plafonné à 100 000 lignes (LIMITE_MAX) : agréger côté requête si la fenêtre grossit.

### COMPOSITE — effort M
- **Pitch :** Profils de volume composites fixes : profils par session (Asie/Europe/US), journaliers et hebdomadaires empilés, avec suivi des naked POCs (POC jamais retestés) tracés comme lignes magnétiques sur le chart jusqu'à leur premier retest.
- **Valeur différenciante :** TradingView réserve les Fixed Range/Session Profiles aux abonnements supérieurs, et aucun outil ne trace automatiquement les naked POCs multi-jours sur crypto. Ici le calcul est gratuit et multi-source car il ne dépend que des bougies OHLCV déjà en mémoire, pas du flux tick.
- **Données déjà branchées :** computeVolumeProfile (bins, POC, Value Area 70 %, split buy/sell via buyVolume/sellVolume) dans apps/web/src/chart/volumeProfile.ts:57+, alimenté par marketStore (multi-source, cf. en-tête volumeProfile.ts:7-10) ; mécanique de consommation d'un niveau par traversée de bougie déjà écrite et testée : premiereTraversee dans apps/web/src/chart/liquidationEstimates.ts:64-75 (directement transposable aux naked POCs) ; rendu lignes horizontales par le contrôleur liquidationHeat.ts (couche niveaux estimés).
- **Fichiers concernés :** `apps/web/src/chart/volumeProfile.ts`, `apps/web/src/chart/volumeProfile.test.ts`, `apps/web/src/store/volumeProfile.ts`, `apps/web/src/chart/liquidationEstimates.ts`, `apps/web/src/store/market.ts`
- **Risques :** Le VP répartit le volume uniformément sur [low, high] (approximation assumée, volumeProfile.ts:9-10) : un POC composite hérite de cette imprécision — l'assumer dans l'UI. Les frontières de session dépendent du fuseau : réutiliser la convention de SessionStrip.tsx pour ne pas créer deux définitions divergentes des sessions. Profondeur d'historique bornée par ce que marketStore a chargé.

### DELTAMAP — effort S
- **Pitch :** Profil de delta par niveau de prix (delta map) : agréger le buffer footprint sur l'axe prix pour afficher, en histogramme latéral signé, où l'agression nette acheteuse/vendeuse s'est concentrée depuis l'ouverture de la session tick. Révèle les prix où les acheteurs agressifs ont été absorbés (gros volume, delta ~0).
- **Valeur différenciante :** C'est la donnée que le volume profile classique écrase : TradingView n'a pas de profil signé par agresseur, et les cellules buy/sell au tick sont déjà accumulées dans le repo — aucun autre flux à ouvrir, c'est une seconde projection du même buffer.
- **Données déjà branchées :** Cellules buy/sell par bucket de prix déjà accumulées en O(1) par trade dans apps/web/src/chart/orderflow.ts (Map<candleTime, Map<bucket, FpCell>>, FpCell dans apps/web/src/chart/orderflow.calc.ts:13-16) ; tickSize/bucketing déjà résolus (fetchSymbolInfo + fallbackTick orderflow.calc.ts:141-146) ; gabarit de rendu latéral prêt : histogramme ancré au bord droit, MAX_WIDTH_FRAC, sync viewport dans apps/web/src/chart/volumeProfile.ts:24-27 ; tokens canvas via apps/web/src/lib/canvasTokens.ts.
- **Fichiers concernés :** `apps/web/src/chart/orderflow.ts`, `apps/web/src/chart/orderflow.calc.ts`, `apps/web/src/chart/volumeProfile.ts`, `apps/web/src/lib/canvasTokens.ts`
- **Risques :** Portée limitée à la session tick (buffer live-only, évincé au-delà de 120 bougies — MAX_FOOTPRINT_CANDLES, orderflow.ts:62) : soit assumer « depuis souscription », soit allonger la borne mémoire pour ce mode. Cohabitation visuelle avec le VPVR au même bord droit : prévoir exclusivité ou décalage.

## Direction : confort-operateur

### JRNL-CHART — effort S
- **Pitch :** Boucler le journal sur le chart : clic droit sur le graphe → « Noter ici » (prix + timestamp capturés, brouillon prérempli), et clic sur un marqueur MARKS (entrée/clôture/note) → ouvre la note ou le trade correspondant dans NOTES/PORT. L'opérateur annote et relit ses décisions sans jamais quitter le graphe.
- **Valeur différenciante :** TradingView a des notes de chart mais déconnectées du portefeuille ; CoinGlass n'a aucun journal. Ici notes ET trades locaux vivent déjà sur la même bougie (MARKS) — il ne manque que l'aller-retour clic ↔ donnée, impossible chez eux car ils ne détiennent pas le journal de l'opérateur.
- **Données déjà branchées :** chart/tradeMarkers.ts dessine déjà entrées/clôtures/notes ancrées (« NOTE ancrée : pastille + court aperçu du texte au prix capturé », l.11) ; chart/priceAlertMenu.ts a déjà le menu contextuel clic-droit branché sur le pane prix (convertFromPixel → prix) ; store/notes.ts expose déjà le brouillon prérempli `proposerNote(b: BrouillonNote)` (l.232-235) prévu exactement pour ce seed.
- **Fichiers concernés :** `apps/web/src/chart/priceAlertMenu.ts`, `apps/web/src/chart/tradeMarkers.ts`, `apps/web/src/store/notes.ts`, `apps/web/src/components/NotesWindow.tsx`
- **Risques :** Fusionner le menu clic-droit alerte existant avec l'entrée « Noter ici » (un seul menu, pas deux) ; hit-testing des overlays KLineChart pour le clic sur marqueur (onClick d'overlay à valider, sinon repli : liste « voir sur le chart » déjà existante côté Notes).

### REVUE-REPLAY — effort M
- **Pitch :** Rejouer ses trades : bouton « Revoir » sur chaque trade clos (PortfolioWindow et section review du BRIEF) qui télécharge le jour concerné via le daemon et lance le replay avec seek direct au timestamp d'entrée. La revue de session passe de « lire un PnL » à « revoir le film de sa décision ».
- **Valeur différenciante :** Le Bar Replay TradingView est payant et ignore totalement vos trades (il ne sait pas où vous êtes entré) ; CoinGlass n'a pas de replay. Ici le moteur de replay ET les timestamps d'entrée/sortie sont locaux — le lien trade→replay est un simple câblage.
- **Données déjà branchées :** store/replay.ts a déjà `seek(t)` (l.387, recrée le moteur au curseur cible) et `start()` ; data/replayFeed.ts gère téléchargement + jours stockés (demanderTelechargement, listerJours, statutTelechargement) ; store/portfolio.ts porte dateEntree/dateSortie sur chaque Position ; data/brief.ts assemble déjà les trades clos du jour (assemblerSession).
- **Fichiers concernés :** `apps/web/src/components/PortfolioWindow.tsx`, `apps/web/src/components/BriefWindow.tsx`, `apps/web/src/store/replay.ts`, `apps/web/src/data/replayFeed.ts`
- **Risques :** Replay limité aux 7 derniers jours (jourDecale, sélecteur replay.ts) et à Binance — les trades plus anciens ou d'autres sources doivent afficher un état « non rejouable » propre ; téléchargement asynchrone du dump (UX d'attente à soigner, poll 1,5 s déjà en place).

### TIMELINE — effort M
- **Pitch :** Historique unifié de la journée : une fenêtre (ou un onglet du BRIEF) qui fusionne chronologiquement alertes déclenchées, notes, ouvertures/clôtures de trades et événements éco passés. Clic sur une entrée → centre le chart sur le timestamp (ou seek le replay). Répond à « qu'est-ce qui s'est passé pendant que je n'étais pas devant l'écran ? » en 5 secondes.
- **Valeur différenciante :** Aucun terminal grand public ne peut croiser VOS alertes, VOS notes et VOS trades avec le calendrier éco sur une seule frise : ces quatre flux n'existent ensemble que dans les stores locaux d'AXIOM. C'est l'agrégat mono-opérateur par excellence.
- **Données déjà branchées :** store/alerts.ts `journal: Declenchement[]` (plus récent en tête, borné à 100) ; store/notes.ts (notes horodatées avec prix) ; store/portfolio.ts (positions avec dateEntree/dateSortie) ; data/eco.ts chargerEvenementsEco (déjà consommé par data/brief.ts pour les « éco passés ») ; le BRIEF affiche déjà ces sections séparément (BriefWindow.tsx l.314+) — il manque la fusion chronologique et le saut chart.
- **Fichiers concernés :** `apps/web/src/components/BriefWindow.tsx`, `apps/web/src/data/brief.ts`, `apps/web/src/store/alerts.ts`, `apps/web/src/chart/ecoMarkers.ts`
- **Risques :** Journal d'alertes borné à MAX_JOURNAL=100 (une journée chargée peut évincer le matin) ; « centrer le chart sur un timestamp » dépend de l'API KLineChart (scrollToTimestamp) et du TF affiché — prévoir un repli « ouvrir le replay à cet instant ».

### CHECK — effort M
- **Pitch :** Checklist pré-trade greffée aux playbooks : chaque playbook (PLAY-SCALP, PLAY-FADE, PLAY-CVD…) déclare 3-5 critères à cocher (funding crowded ? divergence CVD confirmée ? niveau VP proche ?) affichés dans un petit panneau après l'apply. L'ouverture d'une position depuis PORT rappelle la checklist non cochée (soft, jamais bloquant).
- **Valeur différenciante :** TradingView/CoinGlass fournissent des données, jamais de discipline d'exécution : une checklist n'a de valeur que reliée au scénario ET à la saisie de position — les deux sont locaux ici (playbooks store-driven + portefeuille manuel).
- **Données déjà branchées :** data/playbooks.ts a déjà le catalogue déclaratif (id/nom/description/apply, l.168+) et un précédent de garde-fou métier : applyCvdEdge seed une alerte idempotente (l.109-123) ; store/portfolio.ts `ouvrir()` est le point d'accroche du rappel ; ui.tsx (Badge, EnTeteFenetre) et le pattern de persistance localStorage `axiom:*` (store/alerts.ts) couvrent l'UI et l'état coché.
- **Fichiers concernés :** `apps/web/src/data/playbooks.ts`, `apps/web/src/store/portfolio.ts`, `apps/web/src/components/PortfolioWindow.tsx`, `apps/web/src/components/ui.tsx`
- **Risques :** Friction si le rappel devient bloquant — rester informatif (toast/badge) ; le contenu des checklists doit rester éditable simplement sinon il vieillira mal (v1 : critères figés par playbook, édition = lot ultérieur).

### FOCUS — effort S
- **Pitch :** Mode focus : une touche/commande qui minimise toutes les fenêtres sauf celle focalisée (ou son groupe couleur), passe le graphe en plein écran et coupe les toasts non critiques (les alertes passent toujours). Sortie = restauration exacte de l'état d'avant. Pour les minutes autour d'une exécution ou d'un chiffre macro.
- **Valeur différenciante :** C'est un confort de gestion de fenêtres propre au modèle multi-fenêtres flottantes d'AXIOM (22 fenêtres, taskbar) — TradingView mono-layout n'a pas ce problème donc pas cette solution ; ici tout le socle (minimize, groupes, plein écran) existe déjà.
- **Données déjà branchées :** commands/hotkeys.ts a déjà fullscreenStore + touche F (l.64) ; store/windowManager.ts a minimized, groupColor (l.134, diffusion symbole par groupe l.368), restoreAll/toggleFocusMinimize/preSnapGeometry (précédent de mémorisation d'un pré-état) ; store/toasts.ts pour le filtrage ; Taskbar.tsx affiche déjà l'état minimisé (etatPastille).
- **Fichiers concernés :** `apps/web/src/commands/hotkeys.ts`, `apps/web/src/store/windowManager.ts`, `apps/web/src/store/toasts.ts`, `apps/web/src/components/Taskbar.tsx`
- **Risques :** Définir « toast critique » (déclenchements d'alertes doivent toujours passer) ; restauration fidèle si l'utilisateur ouvre/ferme des fenêtres pendant le focus (mémoriser un instantané façon preSnapGeometry et le réconcilier à la sortie).

### WS-KEYS — effort S
- **Pitch :** Bascule workspace au clavier : Alt+1…Alt+9 applique le n-ième preset (ordre du sélecteur Toolbar) et Alt+0 revient au « Défaut », plus une entrée palette WS <nom>. Changer de contexte de travail devient un geste d'une demi-seconde au lieu d'un aller-retour souris dans le menu.
- **Valeur différenciante :** Les layouts TradingView se changent à la souris via un menu ; ici le store applique le preset à chaud sans reload (setters), donc la bascule clavier est quasi instantanée — un vrai réflexe terminal Bloomberg.
- **Données déjà branchées :** store/workspaces.ts `apply(id)` (no-op si déjà courant, fige le Défaut en le quittant, l.321-330) ; commands/hotkeys.ts est l'écouteur keydown UNIQUE avec la table RACCOURCIS_AIDE auto-documentée (raccourciPour relit la table, l.95) ; Toolbar.tsx a déjà le sélecteur de workspaces (l.301) et les commandes workspace:enregistrer/exporter/importer.
- **Fichiers concernés :** `apps/web/src/commands/hotkeys.ts`, `apps/web/src/store/workspaces.ts`, `apps/web/src/components/Toolbar.tsx`
- **Risques :** ⌘1…9 est pris par les onglets navigateur (app Vite servie en web) et les chiffres nus par les timeframes — choisir Alt/⇧+chiffre et le documenter dans RACCOURCIS_AIDE ; l'ordre des presets doit être stable et visible (numéroter le menu Toolbar).

### WS-CTX — effort M
- **Pitch :** Workspaces contextuels : au chargement (et aux bascules de session Asie/Londres/NY), un toast discret propose le workspace ou playbook pertinent — « FOMC à 20h00 : passer en PLAY-FOMC ? », « Ouverture NY : workspace Scalp ? ». Jamais d'application automatique, toujours un clic d'acceptation.
- **Valeur différenciante :** TradingView ne sait pas croiser calendrier éco + heure de session + VOS presets nommés ; c'est une couche d'orchestration au-dessus de données et d'agencements qui n'existent ensemble que localement.
- **Données déjà branchées :** store/workspaces.ts apply() (bascule à chaud) ; data/playbooks.ts (PLAY-FOMC déjà défini avec ECO+RATE+NEWS+overlays) ; data/eco.ts chargerEvenementsEco (importance/horaire, déjà consommé par brief.ts et ecoMarkers.ts) ; store/toasts.ts pour la proposition non intrusive ; SessionStrip.tsx comme point d'ancrage visuel de la session.
- **Fichiers concernés :** `apps/web/src/store/workspaces.ts`, `apps/web/src/data/eco.ts`, `apps/web/src/store/toasts.ts`, `apps/web/src/data/playbooks.ts`, `apps/web/src/App.tsx`
- **Risques :** L'automatisme intrusif est le piège : ne jamais écraser la vue sans confirmation (le workspace « Défaut » protège déjà la session libre, mais une bascule acceptée par mégarde reste pénible) ; heuristique de sessions (UTC vs locale, DST) à tester en pur ; besoin d'un réglage on/off.

### SNAP — effort S
- **Pitch :** Point de restauration 1-clic : commande palette « SNAP » qui déclenche immédiatement un snapshot KV daemon (POST /kv/snapshots, déjà exposé) avec toast de confirmation horodaté. Réflexe avant un import de sauvegarde, un gros ménage de notes/alertes ou une expérimentation de workspace.
- **Valeur différenciante :** Sauvegarde versionnée de l'état complet de SON terminal (portefeuille, journal, dessins, workspaces) : hors sujet pour TradingView/CoinGlass qui hébergent vos données chez eux sans point-dans-le-temps utilisateur.
- **Données déjà branchées :** apps/daemon/src/snapshots.ts expose déjà `POST /kv/snapshots → snapshot immédiat { id, ts, taille }` (doc de tête, l.25-27) avec rétention 30 j et restauration dans SettingsPanel ; data/daemon.ts est le client HTTP (daemonPret/kvPut) ; commands/registry.ts a le pattern de commande « action » (EXPORT, CLR).
- **Fichiers concernés :** `apps/web/src/data/daemon.ts`, `apps/web/src/commands/registry.ts`, `apps/web/src/components/SettingsPanel.tsx`, `apps/daemon/src/snapshots.ts`
- **Risques :** Daemon absent : dégrader en toast d'erreur douce (pattern « 100 % dégradé si le daemon est absent » de replay.ts) ; le snapshot ne couvre que ce qui est miroité au KV — les clés localStorage non synchronisées (historique palette…) restent hors filet, à dire honnêtement dans le toast/Réglages.
