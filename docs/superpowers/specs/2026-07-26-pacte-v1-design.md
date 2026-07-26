# PACTE V1 — contrôleur local de contrats

Date : 2026-07-26 · Origine : sélection par l’utilisateur de l’idée PACTE,
puis délégation explicite de la réalisation complète pendant son absence.

## 1. Objectif

PACTE aide un foyer à vérifier qu’un fournisseur respecte ses engagements.
L’application rapproche les conditions d’un contrat et les transactions
associées, rend chaque anomalie explicable, puis prépare un dossier de
réclamation que l’utilisateur reste seul à décider d’envoyer.

La V1 doit être une application web autonome, démontrable sans compte ni clé
API, et suffisamment fonctionnelle pour tester le parcours complet :

1. enregistrer ou importer un contrat ;
2. importer des transactions ;
3. détecter des écarts factuels ;
4. examiner les preuves ;
5. ouvrir et suivre un dossier ;
6. générer et exporter une lettre de réclamation.

PACTE n’est ni un cabinet juridique, ni un service bancaire, ni un agent qui
agit sans consentement. Chaque résultat est présenté comme un contrôle
automatique à confirmer.

## 2. Approches considérées

### A — SaaS connecté aux banques et aux boîtes mail

Cette approche apporterait une automatisation maximale, mais impose dès le
premier jour authentification, backend, gestion de secrets, agrégation
bancaire réglementée, fournisseurs d’e-mail et obligations de sécurité. Elle
est écartée tant que la valeur du moteur de contrôle n’est pas validée.

### B — prototype visuel uniquement

Une maquette permettrait de tester le positionnement, mais pas la promesse
centrale « contrat contre exécution ». Elle est insuffisante pour la demande.

### C — application locale fonctionnelle (retenue)

Les données restent dans le navigateur. Le produit accepte les informations
manuelles et des imports simples, exécute de vraies règles déterministes et
produit un dossier utilisable. Cette solution maximise la valeur testable
sans créer prématurément une infrastructure réglementée.

## 3. Périmètre fonctionnel

### 3.1 Tableau de bord

- total mensuel suivi, montant potentiellement récupérable, contrats actifs ;
- score de contrôle du foyer calculé à partir des alertes et des échéances ;
- file des anomalies prioritaires ;
- échéances à venir et derniers contrats surveillés ;
- jeu de démonstration réaliste chargé au premier lancement.

### 3.2 Coffre de contrats

Un contrat contient : fournisseur, catégorie, référence, montant et fréquence,
date de début, prochaine échéance, préavis, statut, date de résiliation,
remboursement attendu, alias marchands et notes/texte source.

La création se fait soit par formulaire, soit par import d’un fichier texte,
e-mail ou PDF. L’extraction PDF est explicitement « meilleure tentative » :
la V1 extrait les chaînes textuelles accessibles et demande toujours une
confirmation humaine. Aucun champ extrait n’est considéré comme certain.

### 3.3 Transactions

- ajout manuel ;
- import CSV avec reconnaissance flexible des colonnes date, libellé, montant
  et devise ;
- aperçu et validation avant ajout ;
- rattachement automatique à un contrat par alias normalisé, modifiable
  manuellement ;
- déduplication par empreinte date/libellé/montant.

Les montants positifs représentent un débit et les montants négatifs un crédit
ou remboursement, convention affichée dans l’interface.

### 3.4 Moteur de contrôle

Le moteur pur reçoit contrats et transactions et retourne des anomalies avec
faits, niveau de confiance, sévérité et montant récupérable estimé.

Règles V1 :

1. **Double débit** — deux débits de même fournisseur et même montant dans une
   fenêtre de sept jours.
2. **Hausse non expliquée** — débit rattaché supérieur de plus de 2 % au prix
   contractuel confirmé.
3. **Débit après résiliation** — débit postérieur à la date de résiliation.
4. **Remboursement manquant** — remboursement attendu arrivé à échéance sans
   crédit correspondant dans la tolérance de 2 %.
5. **Échéance proche** — préavis à exercer dans les trente prochains jours ;
   c’est une vigilance, pas une somme récupérable.

Chaque anomalie possède une clé stable afin qu’un dossier classé ne soit pas
recréé à chaque analyse.

### 3.5 Dossiers et réclamations

- conversion d’une anomalie en dossier ;
- états : à examiner, prêt, envoyé, réponse reçue, résolu, abandonné ;
- chronologie d’actions et notes ;
- lettre française générée à partir des seuls faits sélectionnés ;
- copie presse-papiers, impression navigateur et export texte ;
- aucun envoi automatique dans la V1.

Le modèle de lettre reste factuel : il cite le contrat, la transaction et la
demande, sans inventer d’article de loi. Une mention permanente rappelle de
vérifier les informations et les délais applicables dans sa juridiction.

### 3.6 Confidentialité et portabilité

- persistance `localStorage` sous une clé versionnée ;
- aucune donnée transmise à un serveur ;
- export JSON complet et import de sauvegarde avec validation de schéma ;
- remise à zéro explicite avec confirmation ;
- les fichiers bruts ne sont pas conservés : seuls leur nom, leur type et le
  texte utile validé restent dans le coffre.

Cette V1 locale n’affirme pas chiffrer le stockage du navigateur. Une version
multi-appareil devra ajouter authentification, chiffrement applicatif et
journal d’accès avant toute synchronisation.

## 4. Architecture

Nouvelle application isolée dans `apps/pacte` :

```text
apps/pacte/
  src/
    domain/       types, normalisation, extraction, contrôles, réclamations
    infra/        persistance et fichiers
    data/         jeu de démonstration
    components/   composants UI spécialisés
    App.tsx       navigation et orchestration
    index.css     identité visuelle et responsive
```

Le domaine ne dépend ni de React ni du navigateur, sauf les adaptateurs
d’import/export rangés dans `infra`. L’état applicatif est centralisé dans un
hook léger, sauvegardé après chaque mutation. Aucune dépendance runtime
nouvelle n’est nécessaire : React, Vite, TypeScript et Vitest sont déjà
présents dans le monorepo.

## 5. Direction visuelle

PACTE adopte une esthétique de « dossier de confiance » plutôt qu’un tableau
de bord fintech générique : fond ivoire, encre bleu-noir, accent vermillon,
titres éditoriaux, lignes fines et grands nombres sobres. Les alertes emploient
à la fois couleur, libellé et forme ; aucune information ne dépend uniquement
de la couleur.

La navigation latérale devient une barre compacte sur petit écran. Les
modales possèdent titre explicite, fermeture clavier et focus visible. Les
animations sont limitées aux changements d’état et respectent
`prefers-reduced-motion`.

## 6. Flux de données

```text
Saisie / import
      ↓
normalisation et confirmation
      ↓
contrats + transactions persistés localement
      ↓
moteur de contrôle pur
      ↓
anomalies explicables
      ↓ validation utilisateur
dossier + lettre + export
```

Le moteur est recalculé à partir de l’état source après chaque mutation. Les
dossiers conservent un instantané des preuves pour que leur contenu ne change
pas silencieusement si le contrat est ensuite modifié.

## 7. Gestion des erreurs

- import illisible : message actionnable, aucune écriture partielle ;
- ligne CSV invalide : ligne ignorée et comptabilisée dans le récapitulatif ;
- date ou montant ambigu : champ laissé à confirmer ;
- stockage corrompu : proposition d’exporter la valeur brute puis retour au
  jeu de démonstration, jamais effacement silencieux ;
- API absente : sans objet dans la V1, l’interface reste entièrement locale ;
- erreur React inattendue : écran de récupération avec rechargement et export
  des données si le stockage demeure lisible.

## 8. Tests et critères d’acceptation

Tests unitaires Vitest :

- normalisation des fournisseurs et association contrat/transaction ;
- quatre anomalies financières, échéance, tolérances et non-régression ;
- import CSV avec formats français et internationaux ;
- extraction heuristique des faits contractuels ;
- génération de lettre sans faits inventés ;
- migration/validation des données persistées.

Critères de livraison :

- `pnpm --filter @pacte/web typecheck` passe ;
- `pnpm --filter @pacte/web test` passe ;
- `pnpm --filter @pacte/web build` passe ;
- le jeu de démonstration permet d’ouvrir une anomalie, créer un dossier,
  changer son statut et exporter sa lettre ;
- ajout d’un contrat et import CSV fonctionnent après rechargement ;
- l’interface reste utilisable à 360 px de large et au clavier.

## 9. Hors périmètre explicite

- connexion bancaire PSD2/Open Banking ;
- OAuth Gmail/Outlook ;
- OCR serveur ou modèle de langage distant ;
- conseil juridique personnalisé ;
- envoi de recommandé ou négociation autonome ;
- comptes, abonnement payant et synchronisation multi-appareil ;
- application mobile native.

Ces capacités ne deviennent pertinentes qu’après validation de trois mesures :
taux d’anomalies confirmées, montant récupéré et proportion de dossiers menés
à résolution.
