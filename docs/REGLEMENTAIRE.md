# Points réglementaires (France) — à faire vérifier

Ce document résume les règles prises en compte. **Il ne remplace pas l'avis d'un expert-comptable ou de l'administration fiscale.**

## Configuration fournie et non supposée

- Préconfiguré : nom commercial Signal Digital, micro-entreprise, dirigeant Giovani Zunino, SIRET 94478489100011 (clé de contrôle vérifiée), SIREN 944784891, email contact@qarvo-digital.fr.
- **Non supposé** (à saisir) : adresse professionnelle, **régime de TVA**, n° de TVA intracommunautaire, code APE, IBAN. Sans adresse ni régime de TVA, l'émission de devis et de factures est bloquée.
- La mention « EI » est ajoutée à la dénomination (obligation des entrepreneurs individuels depuis 2022) ; désactivable.

## Mentions contrôlées ou ajoutées sur les factures

Numéro unique et chronologique ; date d'émission ; date de prestation si renseignée ; identité, adresse, SIRET du vendeur ; n° de TVA si assujetti ; nom et adresse du client (obligatoires pour émettre) ; désignation, quantité, prix unitaire HT, remises, taux et montants de TVA par taux, totaux HT/TVA/TTC ; date d'échéance ; conditions de paiement ; taux des pénalités de retard ; indemnité forfaitaire de 40 € (clients professionnels) ; conditions d'escompte ; « TVA non applicable, art. 293 B du CGI » en franchise ; référence de la facture rectifiée sur un avoir. Mentions complémentaires configurables (assurance professionnelle, médiation pour les particuliers…).

## TVA

- Franchise en base : toutes les lignes doivent être à 0 % (contrôlé), mention ajoutée, total « Net à payer ».
- Assujetti : plusieurs taux (20 %, 10 %, 5,5 %, 2,1 %, 0 %, personnalisables) ; calcul par taux sur la somme des bases (arrondi au centime) ; avertissement si une ligne est à 0 % (exonération à justifier) ; option pour la TVA sur les débits.
- Le passage de la franchise au régime normal (dépassement de seuil) est à surveiller par vous : Signal Desk ne calcule pas les seuils.

## Numérotation et rectification

- Séquence continue par série (factures/acomptes/soldes ; avoirs), attribuée à l'émission dans une transaction ; contrôle de l'ordre chronologique des dates ; pas de date future.
- Factures émises ni modifiables, ni supprimables, ni renumérotables (contrôle en base). Rectification **par avoir** uniquement.

## Facturation électronique (réforme)

- Calendrier prévu (à vérifier, il a déjà évolué) : **réception** obligatoire pour toutes les entreprises depuis le **1er septembre 2026** ; **émission** obligatoire au **1er septembre 2027** pour les PME et micro-entreprises, via une **plateforme agréée** ; e-reporting pour les opérations non concernées (B2C, international).
- **Un PDF classique ne sera pas une facture électronique** au sens de la réforme. Formats attendus : Factur-X, UBL ou CII.
- Préparation dans Signal Desk : export XML **CII (norme EN 16931)** par facture (Actions → Exporter le XML). Il n'est **pas validé** par les outils officiels, et ne constitue pas un Factur-X complet (qui exige un PDF/A-3 embarquant ce XML). Les données nécessaires (SIREN client, date de prestation, catégories de TVA) sont déjà collectées ; le SIREN client manquant est signalé.
- À prévoir : choix d'une plateforme agréée et intégration (API) ou dépôt manuel des fichiers.

## Encaissements, déclarations

- Les micro-entrepreneurs déclarent en principe le chiffre d'affaires **encaissé** : utilisez la page Paiements (export CSV) comme base du livre des recettes. Le registre des achats n'est pas géré par Signal Desk.
- Espèces : plafonds légaux (à vérifier selon le client) — rappel affiché lors de la saisie.

## Conservation et archivage

- Factures et pièces : 10 ans (Code de commerce), 6 ans (contrôle fiscal). Signal Desk conserve les PDF, empreintes et journaux, mais le stockage local **n'est pas un archivage électronique certifié** (NF Z42-013 / NF 461). Faites des sauvegardes régulières sur plusieurs supports.

## Logiciel de caisse

L'obligation de certification des logiciels de caisse (loi antifraude TVA) vise l'enregistrement de paiements de clients particuliers non assujettis. Signal Desk n'est pas certifié : vérifiez votre situation si vous encaissez des particuliers.
