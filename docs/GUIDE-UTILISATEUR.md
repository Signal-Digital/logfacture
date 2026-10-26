# Guide utilisateur

## Prise en main

- **Barre latérale** : toutes les sections (Tableau de bord, Prospects, Entreprises et contacts, Pipeline, Activités et relances, Clients, Devis, Factures et avoirs, Paiements, Catalogue, Projets, Contrats, Documents, Modèles, Rapports, Paramètres).
- **Recherche globale** : `Ctrl+K` (entreprises, contacts, devis, factures, projets, documents, prestations, opportunités).
- **Bouton « Créer »** et raccourcis : `Ctrl+Alt+P` prospect, `Ctrl+Alt+D` devis, `Ctrl+Alt+F` facture, `Ctrl+Alt+A` activité.
- **Cloche** : notifications calculées (relances en retard, factures échues, devis qui expirent, factures récurrentes à préparer, sauvegarde ancienne, configuration incomplète).
- **Thème** clair / sombre : icône lune/soleil, ou Paramètres → Apparence.

## Le parcours complet, du prospect au paiement

1. **Créer le prospect** : Créer → Prospect. Saisissez l'entreprise, le contact, le site, l'URL Google Business Profile, la source, le potentiel. Les **doublons potentiels** (nom, email, domaine, téléphone, site, SIRET) sont signalés pendant la saisie.
2. **Suivre les échanges** : sur la fiche, « Relance » planifie une action datée (rappel Windows possible) ; « Créer → Note » consigne un appel ou un échange. Tout apparaît dans la **chronologie** de la fiche. La prochaine action de la fiche se met à jour automatiquement.
3. **Opportunité** : Créer → Opportunité (montant, probabilité, date de clôture). Dans le **Pipeline**, faites glisser la carte d'une étape à l'autre.
4. **Devis** : depuis la fiche, Créer → Devis. Les coordonnées sont reprises automatiquement. Ajoutez des prestations du **catalogue** en un clic ou des lignes libres, sections et textes, sans limite de nombre. Le brouillon s'enregistre automatiquement.
5. **Finaliser** : « Finaliser » fige le devis (version, empreinte SHA-256, PDF définitif). Pour toute modification ultérieure : Actions → **Nouvelle version** (l'ancienne est conservée).
6. **Signature** : « Faire signer » ouvre une fenêtre séparée réservée au document. Le client saisit son nom, recopie « Bon pour accord », signe au doigt / stylet / souris et coche le consentement. Le devis passe à **Accepté**, le prospect devient **client** (même fiche) et Signal Desk propose de créer le **projet**.
7. **Facturer** : sur le devis accepté, « Facturer » : facture totale, facture d'acompte (% ou montant) ou facture de solde (acomptes déduits automatiquement par taux de TVA). Vérifiez le brouillon puis **Émettre** : le numéro définitif est attribué à ce moment.
8. **Paiements** : « Enregistrer un paiement » (plusieurs paiements possibles). Le solde restant dû et le statut (partiellement payée, payée, en retard) se mettent à jour.
9. **Relances** : « Relancer » prépare le rappel avant échéance, la première relance ou la relance finale, à copier ou ouvrir dans votre messagerie.
10. **Tableau de bord et rapports** : facturé, encaissé, restant dû et prévisionnel sont toujours présentés séparément.

## Points clés

- **Une facture émise ne se modifie pas et ne se supprime pas** : utilisez Actions → **Créer un avoir** (total ou partiel). Un avoir total passe la facture en « Annulée (avoir) ».
- Un **brouillon de facture** n'a pas de numéro : le supprimer ne crée pas de trou dans la numérotation.
- Les **coordonnées** du client et de votre entreprise sont **figées** dans chaque document émis.
- Le **catalogue** n'est jamais modifié par un devis, et inversement.
- **Archiver** une fiche la masque des listes sans rien supprimer.
- **Fusionner** deux fiches : Entreprises → Doublons. Tout l'historique est rattaché à la fiche conservée.
- **Import / export CSV** : Prospects → Importer CSV (association des colonnes, doublons ignorés par défaut) ; Exporter CSV (séparateur « ; », compatible Excel).

## Projets et contrats

- **Projets** : statuts configurables, tâches avec échéances, fichiers, devis et factures liés. Les **modèles de projet** (Paramètres → Projets) créent automatiquement la liste de tâches.
- **Contrats récurrents** : montant, périodicité, dates. Les factures de chaque période sont **préparées en brouillon** (jamais en double). L'émission automatique n'a lieu que si elle est activée dans Paramètres → Automatisations **et** sur le contrat.

## Documents

Tous les PDF émis (devis, devis signés, factures, avoirs) sont classés par année, client, projet et type, avec leur empreinte. « Vérifier un PDF » indique si un fichier reçu est identique à un document émis par Signal Desk. « Ouvrir / imprimer » ouvre le PDF dans votre visionneuse (puis `Ctrl+P`).
