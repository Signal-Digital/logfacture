# Modèles de documents

Signal Desk propose trois façons d'utiliser votre propre design de devis et de facture.

| Méthode | Fidélité | Pagination | Prérequis |
|---|---|---|---|
| **Fond PDF + éditeur visuel** (recommandé) | Exacte : le PDF est intégré tel quel comme fond (logo, couleurs, textes statiques, bordures, formes, pieds de page) | Automatique, gérée par Signal Desk | Aucun |
| **Fond image PNG/JPEG** + éditeur | Exacte (image étirée en A4) | Automatique | Image au ratio A4 |
| **Modèle Word (DOCX)** | Structure Word conservée, champs remplacés | Gérée par Word / LibreOffice | LibreOffice (gratuit) ou Word pour obtenir un PDF |
| **Modèle visuel** (fourni ou créé) | — | Automatique | Aucun |

## Importer un modèle PDF

1. Exportez votre maquette en PDF (Canva, Word, Illustrator…). Idéalement : page 1 = première page du document, page 2 = fond des pages suivantes (facultatif). Laissez vides les zones où apparaîtront le client, le tableau et les totaux.
2. Modèles de documents → **Importer un modèle**.
3. L'éditeur s'ouvre : déplacez les champs (nom du client, numéro, dates…) et la **zone du tableau** pour qu'ils tombent dans les espaces prévus.
4. Vérifiez avec **Aperçu** et **Aperçu long** (60 lignes) puis enregistrez.
5. Définissez-le par défaut pour les devis et/ou factures (menu « … » du modèle) ou choisissez-le par document.

## L'éditeur visuel

- **Ajouter** : zone de texte, logo (des paramètres), image importée, rectangle, ligne, bloc des totaux, zone de signature.
- **Champs dynamiques** : cliquez sur un champ pour l'insérer dans le texte sélectionné (ou créer une zone). Une ligne dont les champs sont vides disparaît avec son libellé (ex. « Échéance : … » sur un devis).
- **Déplacer / redimensionner** à la souris ; flèches du clavier (Maj = ×10) ; `Suppr` pour supprimer ; `Ctrl+Z` / `Ctrl+Y` annuler / rétablir ; `Ctrl+S` enregistrer ; zoom.
- **Propriétés** (panneau de droite) : position et taille en millimètres, police (taille, graisse, couleur, alignement, interligne, première ligne en gras), fond, bordure, arrondi, marges, pages d'affichage (toutes, première, suivantes, dernière), types de documents concernés (devis, facture, acompte, solde, avoir), affichage selon la présence d'un logo.
- **1re page / Pages suivantes** : bascule de l'affichage pour placer les en-têtes de continuation et la zone du tableau des pages suivantes.
- **Placement « après le tableau »** : les blocs totaux, conditions, mentions légales, coordonnées bancaires et signature sont empilés à la suite du tableau, dans l'ordre défini (onglet « Éléments »), sans jamais chevaucher, sur une nouvelle page si nécessaire.

## Pagination

- Le tableau des lignes se répète sur autant de pages que nécessaire.
- L'en-tête du tableau est répété (désactivable).
- Une ligne n'est jamais coupée entre deux pages ; seule une ligne plus haute qu'une page entière (description de plusieurs pages) est découpée proprement.
- Les éléments « toutes les pages » (pied de page, numéro de page « Page X / Y ») sont présents sur chaque page.
- Les totaux, mentions et la signature sont placés après la dernière ligne.
- Testé automatiquement avec 1, 45, 60 et 100 lignes, des désignations longues et une ligne géante.

## Champs disponibles

Voir l'onglet « Champs dynamiques » de la page Modèles. Principaux : `{{entreprise.nom}}`, `{{entreprise.denomination}}`, `{{entreprise.adresse}}`, `{{entreprise.siret}}`, `{{entreprise.email}}`, `{{entreprise.tva_intra}}`, `{{client.nom}}`, `{{client.adresse}}`, `{{client.email}}`, `{{client.siren}}`, `{{document.type}}`, `{{document.numero}}`, `{{document.date}}`, `{{document.date_echeance}}`, `{{document.date_validite}}`, `{{document.objet}}`, `{{document.conditions}}`, `{{document.conditions_paiement}}`, `{{document.mentions_legales}}`, `{{totaux.total_ht}}`, `{{totaux.total_tva}}`, `{{totaux.total_ttc}}`, `{{totaux.acompte}}`, `{{paiement.iban}}`, `{{paiement.bic}}`, `{{pagination.page}}`, `{{pagination.total}}`.

## Modèles Word (DOCX)

1. Dans Word, écrivez les champs entre doubles accolades : `{{client.nom}}`, `{{document.numero}}`… (Word peut découper un champ en plusieurs morceaux de mise en forme : c'est géré.)
2. Pour les lignes, créez un tableau dont la 2e ligne contient dans sa 1re cellule `{{#lignes}}{{designation}}` et dans sa dernière `{{total_ht}}{{/lignes}}` ; les autres cellules : `{{quantite}}`, `{{unite}}`, `{{prix_unitaire}}`, `{{remise}}`, `{{tva}}`, `{{total_ttc}}`, `{{description}}`. Cette ligne est répétée pour chaque prestation.
3. Ventilation de TVA : `{{#tva}}{{taux}} : {{montant}} sur {{base}}{{/tva}}`. Mentions légales : `{{#mentions}}{{texte}}{{/mentions}}`.
4. Pagination : dans Word, sur la ligne d'en-tête du tableau, cochez « Répéter en tant que ligne d'en-tête » ; sur les lignes, décochez « Autoriser le fractionnement des lignes sur plusieurs pages ».
5. Importez le fichier : Signal Desk liste les champs reconnus (et signale en rouge ceux qui ne le sont pas).

**Limites testées et assumées** : la conversion DOCX → PDF est réalisée par LibreOffice (testée) ou Microsoft Word (via automatisation Windows, non testée dans l'environnement de développement Linux). Le rendu dépend du convertisseur et des polices installées. Sans convertisseur, la génération PDF est refusée avec un message explicite ; préférez alors un fond PDF + éditeur visuel, qui donne le même résultat visuel sans dépendance.

## Polices

Les PDF utilisent Liberation Sans (métriques identiques à Arial, licence libre), intégrée en sous-ensemble pour des fichiers légers (35 à 80 Ko). Les textes statiques d'un fond PDF importé gardent leurs polices d'origine.
