# PACTE V1

PACTE est un contrôleur local de contrats pour un foyer. L’application rapproche
les engagements enregistrés et les mouvements importés, explique les écarts
détectés, puis prépare un dossier et une lettre de réclamation que l’utilisateur
reste seul à décider d’envoyer.

La V1 fonctionne sans compte, sans clé API et sans backend applicatif. Le serveur
Vite sert uniquement les fichiers de l’interface pendant le développement.

## Prérequis et installation

- Node.js 20 ou version ultérieure ;
- pnpm 9 (la version du dépôt est déclarée dans le `package.json` racine).

Depuis la racine du monorepo :

```bash
pnpm install
pnpm --filter @pacte/web exec playwright install chromium
pnpm --filter @pacte/web dev
```

La deuxième commande installe le binaire Chromium nécessaire à `test:e2e` ;
`pnpm install` seul installe le runner Playwright, pas son navigateur. Sur un
runner Linux ou en CI, installez aussi les bibliothèques système :

```bash
pnpm --filter @pacte/web exec playwright install --with-deps chromium
```

Vite affiche l’adresse locale à ouvrir, généralement
`http://localhost:5173`. Aucune variable d’environnement n’est nécessaire.

## Parcours de démonstration en cinq étapes

1. Ouvrir **Données**, puis **Restaurer la démonstration** pour repartir du jeu
   Helvetia Protect, Alpine Mobile et Studio Forme.
2. Revenir à la **Vue d’ensemble** et choisir la priorité
   **Double débit possible — Helvetia Protect**.
3. Vérifier l’explication et les deux mouvements consignés, puis choisir
   **Ouvrir un dossier**.
4. Dans **Dossiers**, relire les preuves figées, modifier le statut, la note ou
   la lettre, puis enregistrer les modifications.
5. Copier, télécharger en `.txt` ou imprimer la lettre après avoir contrôlé
   chaque date, montant, pièce et délai applicable.

## Fonctionnalités de la V1

- tableau de bord du foyer, contrats récents, engagements mensuels et montants
  récupérables séparés en CHF et EUR ;
- création manuelle de contrats, avec résiliation, remboursement attendu et
  provenance du document, puis préremplissage local depuis un texte, e-mail ou
  PDF ;
- ajout manuel de mouvements et import CSV avec aperçu, association proposée à
  un contrat et correction possible avant ou après écriture ;
- détection déterministe des doubles débits, hausses de prix, débits après
  résiliation, remboursements manquants et échéances proches ;
- ouverture d’un dossier avec instantané immuable des preuves ;
- suivi du statut, notes et lettre factuelle éditable ;
- export texte, copie presse-papiers et impression de la lettre ;
- sauvegarde JSON complète, import validé, récupération d'un stockage corrompu
  et remise à un état connu.

## Format CSV accepté

Le séparateur est détecté parmi le point-virgule, la virgule et la tabulation.
La première ligne non vide doit contenir les en-têtes. Les accents, espaces et
variantes de casse des noms de colonnes sont normalisés.

Colonnes reconnues :

| Donnée | En-têtes acceptés |
|---|---|
| Date, obligatoire | `date`, `dateoperation`, `datevaleur`, `operationdate`, `transactiondate` |
| Libellé, obligatoire | `libelle`, `description`, `label`, `intitule`, `merchant`, `details` |
| Montant | `montant`, `amount`, `somme`, `total` |
| Débit / crédit, alternative au montant | `debit`, `debits`, `credit`, `credits` |
| Devise, facultative | `devise`, `currency`, `monnaie` |

Exemple français :

```csv
date;libelle;montant;devise
08.07.2026;PRLV HELVETIA PROTECT;89,90;CHF
10.07.2026;PRLV HELVETIA PROTECT;89,90;CHF
18.07.2026;REMBOURSEMENT HELVETIA;-89,90;CHF
```

Les dates peuvent être écrites `AAAA-MM-JJ`, `JJ.MM.AAAA`, `JJ/MM/AAAA` ou
`JJ-MM-AAAA`. Les montants acceptent la virgule ou le point décimal, les
séparateurs de milliers usuels, un signe ou des parenthèses pour les valeurs
négatives. Avec des colonnes séparées, un débit devient positif et un crédit
devient négatif. Les seules devises métier de la V1 sont CHF et EUR ; une devise
absente ou inconnue reprend la devise du foyer.

PACTE montre un aperçu avant confirmation. Une ligne invalide ou un doublon du
fichier est ignoré et comptabilisé. Les doublons déjà présents dans le journal
sont aussi écartés lors de l’écriture, même si leur identifiant ou leur date
d'import technique diffère : la comparaison repose sur la date, le libellé
normalisé, le montant et la devise. Une association à un contrat peut être
proposée d'après le libellé ; elle reste visible et modifiable dans l'aperçu.

Les dates métier sont limitées aux années 1900 à 2200, les montants à une valeur
absolue maximale de 1 000 000 000 et les préavis à 3 650 jours. Une ligne CSV
hors limites est isolée sans empêcher l'import des autres lignes valides.

## Import de contrats et limites PDF

Le formulaire **Nouveau contrat** peut lire localement un fichier texte, un
e-mail `.eml` exporté sous forme textuelle ou un PDF contenant des chaînes accessibles.
Le préremplissage ne recherche que quelques indices, notamment un montant, une
devise et un préavis. Il ne remplace jamais la validation du formulaire.

La lecture PDF est une meilleure tentative : la V1 ne contient ni OCR, ni moteur
PDF complet. Un document scanné, protégé, compressé d’une manière non reconnue ou
sans texte accessible peut ne rien produire. Dans ce cas, PACTE demande une
saisie manuelle. Le nom et le type MIME du document sont conservés avec le
contrat pour en rappeler la provenance ; le fichier binaire brut ne l'est pas.

## Confidentialité, stockage et sauvegardes

L’état est enregistré dans le `localStorage` du navigateur sous la clé
versionnée `pacte:v1`. Les imports, analyses et générations de lettre sont
effectués sur l’appareil ; PACTE n’envoie aucune donnée à un service distant.

Ce stockage local n’est **pas chiffré**. Toute personne ayant accès au profil du
navigateur peut potentiellement lire les données. Une suppression des données
du site ou un changement de profil peut effacer le coffre : utilisez
**Données → Exporter la sauvegarde** pour conserver régulièrement le JSON dans
un emplacement de confiance.

L’import JSON valide entièrement le schéma avant de proposer le remplacement.
Une sauvegarde illisible ou incompatible ne modifie pas le coffre. Les actions
**Restaurer la démonstration** et **Créer un coffre vide** demandent aussi une
confirmation explicite.

Si la valeur `pacte:v1` est corrompue, l'application bloque l'interface normale
afin de ne pas écraser silencieusement les données. L'écran de récupération
permet d'abord d'exporter la valeur brute, puis de restaurer la démonstration
après confirmation. La même exportation brute reste disponible lorsqu'une
erreur d'affichage inattendue est interceptée.

## Limites et responsabilité

PACTE réalise des contrôles automatiques à confirmer. Il ne fournit aucun
conseil juridique, ne connaît pas les règles propres à votre juridiction et
n’envoie aucune réclamation. La lettre n’invente pas de fondement légal : elle
reprend uniquement les faits sélectionnés. Vérifiez toujours les montants, les
dates, les pièces, l’identité du destinataire et les délais avant tout envoi.

La V1 ne propose pas de connexion bancaire, de lecture de boîte mail, de compte,
de synchronisation multi-appareil, de chiffrement applicatif ou d’envoi postal.

## Tests et build

Depuis la racine du dépôt :

```bash
pnpm --filter @pacte/web typecheck
pnpm --filter @pacte/web test
pnpm --filter @pacte/web build
pnpm --filter @pacte/web test:e2e
```

Les tests unitaires Vitest ne collectent que `src/**/*.test.{ts,tsx}` ; les
scénarios Playwright de `e2e/smoke.spec.ts` restent donc séparés. Le gate E2E
démarre l’application sur `127.0.0.1:4174` et vérifie Chromium en desktop
1440×900 ainsi qu’en mobile 390×844.
