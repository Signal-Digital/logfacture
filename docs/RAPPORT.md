# Rapport : fonctionnalités terminées et limites restantes

État au 26 octobre 2026 — version 0.1.0.

## Vérifications réalisées

| Vérification | Résultat |
|---|---|
| Tests TypeScript (Vitest, 6 suites) | **76/76** réussis — calculs, CRM, pipeline, activités, devis, factures, acomptes, soldes, avoirs, paiements, numérotation, immutabilité, PDF (1, 45, 100 lignes, ligne géante), modèles PDF/image/DOCX, signatures, sécurité, contrats, rapports, emails, Factur-X |
| Tests Rust (cargo) | **11/11** réussis — SQLite paramétré, transactions, persistance après réouverture, confinement des chemins, sauvegarde/vérification/restauration, chiffrement, détection d'altération |
| Parcours complet dans l'interface (Playwright) | Paramètres → prospect → devis (catalogue) → finalisation → signature dessinée → acceptation → facture → émission → paiement partiel → pipeline (glisser-déposer) → éditeur de modèles → rapports : **13/13 étapes, 0 erreur console** |
| Application de bureau réelle (Tauri pilotée par WebDriver, Linux) | Commandes natives, base SQLite sur disque, déclencheurs, rollback, PDF stockés, signature et vérification, sauvegarde chiffrée, mauvaise phrase refusée, test d'intégrité, restauration avec sauvegarde de sécurité, conversion DOCX→PDF via LibreOffice : **tout réussi** |
| Rendu PDF | Contrôlé visuellement (rastérisation) : devis, factures multi-TVA, multipages, fond PDF importé, logo, PDF signé + certificat, DOCX converti |
| Windows (GitHub Actions, windows-latest) | **Réussi** : typage, 76 tests TypeScript, 11 tests Rust (release) et compilation des installateurs NSIS + MSI (artefact « SignalDesk-Windows », 11,6 Mo, exécution n° 1 du workflow) |

## Fonctionnalités opérationnelles

- **Tableau de bord** : prospects, nouveaux prospects, relances du jour / en retard, opportunités, pipeline total et pondéré, devis envoyés/acceptés, taux de conversion, facturé HT/TTC, encaissé, impayés, retards, projets, tâches en retard, contrats actifs et revenu mensuel ; filtres mois / trimestre / année / 12 mois / période personnalisée ; graphique facturé vs encaissé.
- **CRM** : fiches entreprises (prospect → client → ancien client, sans duplication), tous les champs demandés, contacts multiples, archivage, recherche, filtres, import/export CSV (association des colonnes, neutralisation des formules), détection de doublons (nom, email, domaine, téléphone, site, SIRET), fusion avec conservation de l'historique, chronologie, synthèse financière (facturé, encaissé, solde dû).
- **Pipeline** : Kanban glisser-déposer, 12 étapes par défaut configurables (ajout, ordre, probabilité, couleur, type), opportunités complètes ; « Client gagné » → confirmation → client + projet (avec modèle de tâches) ; motif de perte.
- **Activités** : 8 types, priorité, statut, échéance, rappel local (notification Windows), vues aujourd'hui / retard / à venir / calendrier hebdomadaire / terminées, report à demain, création depuis une fiche.
- **Catalogue** : prestations (exemples fournis), catégories, unité, TVA, durée, récurrence, archivage, duplication ; insertion en un clic ; aucun effet rétroactif.
- **Devis** : brouillons à enregistrement automatique, numérotation configurable, lignes illimitées (sections, textes), remises ligne et globale, TVA multiples, acompte, conditions, notes internes, pièces jointes, aperçu, PDF, impression, duplication, email (copie / messagerie), historique, archivage, 7 statuts, expiration automatique, versions figées (SHA-256), verrouillage en base.
- **Signature** : écran séparé et isolé, tracé souris/stylet/doigt, nom, qualité, mention recopiée, consentement, horodatage, liaison à la version exacte, contrôle d'empreinte, PDF signé + certificat, original conservé, journal immuable, vérification d'intégrité.
- **Facturation** : factures ponctuelles, depuis devis (totale, acompte, solde avec déduction par taux de TVA), récurrentes, avoirs totaux/partiels ; numérotation chronologique sans doublon ni trou à l'émission ; contrôles réglementaires avant émission ; mentions automatiques ; instantanés figés ; PDF définitif unique ; immutabilité en base ; recherche, archivage, duplication ; export XML CII (préparation Factur-X).
- **Paiements** : paiements multiples, refus du trop-perçu, solde, retard en jours, suppression motivée et journalisée, moyens configurables, balance âgée, relances (avant échéance, première, finale) prévisualisées et journalisées, export CSV.
- **Projets** : statuts configurables, modèles de tâches, échéances, montant, devis/factures liés, fichiers, historique, création depuis devis accepté ou opportunité gagnée.
- **Contrats récurrents** : périodicités, dates de début / renouvellement / fin, résiliation, statut, revenu mensuel et annuel, préparation des factures sans doublon (contrainte d'unicité), émission automatique uniquement si doublement activée.
- **Modèles** : 2 modèles fournis, import PDF / PNG / JPEG / DOCX, éditeur visuel complet (cf. MODELES.md), modèles par défaut, duplication, aperçus court et long, 11 modèles d'emails modifiables.
- **Documents** : bibliothèque par année / client / projet / type, aperçu PDF, versions, export, impression, ouverture du dossier Windows, vérification d'intégrité, vérification d'un PDF externe.
- **Rapports** : facturé, encaissé, impayés, retards, devis, conversion, pipeline, pondéré, récurrent, projets, prestations les plus vendues, journal des factures ; exports CSV.
- **Sauvegardes** : manuelles, automatiques, chiffrées, historique, vérification, restauration guidée sans perte.
- **Sécurité** : mot de passe haché, verrouillage manuel et automatique, journal, fichiers confinés, CSP.
- **Ergonomie** : recherche globale, création rapide et raccourcis, thèmes clair/sombre, états vides, confirmations, avertissement de modifications non enregistrées, messages d'erreur compréhensibles.

## Limites restantes (honnêtes)

1. **Installateur** : produit par GitHub Actions sur Windows ; non signé (avertissement SmartScreen possible). L'application n'a pas pu être lancée manuellement sur un poste Windows physique depuis l'environnement de développement (Linux) : les tests Windows automatisés couvrent la logique, l'interface a été testée dans Chromium et l'application native sous Linux (WebKitGTK).
2. **Emails** : pas d'envoi SMTP intégré (copie du texte ou ouverture dans la messagerie, sans pièce jointe automatique — le PDF est à joindre manuellement).
3. **DOCX** : conversion PDF dépendante de LibreOffice (testé) ou Word (automatisation COM, non testée faute de Word dans l'environnement). Pagination des modèles Word gérée par le traitement de texte.
4. **Factur-X** : XML CII généré mais non validé officiellement ; pas de PDF/A-3 ; pas de connexion à une plateforme agréée.
5. **Signature à distance** : non activée (architecture prête, cf. SIGNATURES.md) ; signature locale = signature électronique simple.
6. **Base non chiffrée sur disque** : utiliser BitLocker (cf. SECURITE.md).
7. **Rappels et automatisations** : uniquement lorsque l'application est ouverte (pas de service Windows en arrière-plan).
8. **Champs de date** : affichés selon la langue de Windows (format français sur un Windows en français).
9. **Remise globale + rapports « prestations les plus vendues »** : classement calculé avant remise globale (indiqué dans le rapport).
10. Pas de gestion des achats/dépenses, ni de multi-utilisateurs, ni de multi-devises (hors périmètre demandé).

## Pistes d'évolution

SMTP (avec stockage du mot de passe dans le Gestionnaire d'identification Windows), Factur-X complet et plateforme agréée, signature via prestataire (API), service de rappels en arrière-plan, signature de code de l'installateur, mises à jour automatiques (plugin Tauri updater, serveur requis).
