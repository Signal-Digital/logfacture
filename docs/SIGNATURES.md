# Signature électronique

## Fonctionnement (signature locale)

1. Le devis est **finalisé** : une version figée est enregistrée (contenu JSON + empreinte SHA-256) et son PDF définitif est généré (empreinte SHA-256 enregistrée).
2. « **Faire signer** » crée une demande de signature (jeton aléatoire de 192 bits) liée à **cette version précise** et ouvre une **fenêtre séparée**. Cette fenêtre ne peut afficher que l'écran de signature : aucune navigation vers le reste du CRM.
3. Le signataire consulte le PDF, saisit son nom (et facultativement sa fonction, son email), **recopie la mention « Bon pour accord »**, **signe** (souris, stylet avec pression, doigt) et **coche le consentement explicite**.
4. À la validation, Signal Desk :
   - recalcule l'empreinte du PDF original et refuse de signer s'il a été modifié ;
   - vérifie la cohérence du contenu figé ;
   - enregistre l'image de signature (et son empreinte) ;
   - génère un **nouveau PDF signé** : la signature est apposée dans la zone prévue par le modèle et une page **« Certificat de signature électronique »** est ajoutée (document, version, identifiant, émetteur, client, montant, signataire, date et heure locale et UTC, mention, texte de consentement, méthode, empreintes SHA-256 de l'original, du contenu et de la signature, journal des événements, portée juridique) ;
   - conserve **l'original et la version signée** dans la bibliothèque, tous deux verrouillés ;
   - inscrit les événements (demande, consultation, consentement, signature, PDF signé) dans un **journal non modifiable** ;
   - passe le devis à « Accepté » (version acceptée enregistrée) et convertit le prospect en client.

## Protections

- Signatures, journal de signature, versions de devis et documents verrouillés sont protégés par des **déclencheurs SQLite** : aucune modification ni suppression, même par erreur de programmation.
- Une **nouvelle version** du devis annule les demandes de signature ouvertes ; une signature reste toujours liée à la version signée.
- Un jeton ne peut servir qu'une fois ; une demande expire avec la validité du devis.
- **Vérifier l'intégrité** (onglet Signatures du devis) recalcule toutes les empreintes.
- Documents → **Vérifier un PDF** indique si un fichier reçu correspond exactement à un document émis.

## Portée juridique (à lire)

Il s'agit d'une **signature électronique simple** au sens du règlement (UE) n° 910/2014 (eIDAS). Une signature dessinée et une empreinte SHA-256 **ne constituent pas, à elles seules, une signature électronique avancée ou qualifiée** : l'identité du signataire n'est pas vérifiée par un prestataire de confiance, aucun certificat qualifié n'est utilisé, et la signature est réalisée sur votre poste. Sa valeur probante est appréciée par le juge au regard de l'ensemble des éléments (articles 1366 et 1367 du Code civil). Pour des enjeux importants, recourez à un prestataire de signature (voir ci-dessous) et faites valider votre pratique par un juriste.

## Signature à distance (non activée)

La signature à distance n'est **pas** activée : Signal Desk n'ouvre aucun port et n'expose jamais la base SQLite. L'architecture la prépare (table `signature_requests` avec un champ `channel = 'distance'`, jetons, journal, vérification d'empreinte). Options possibles :

| Option | Principe | Exigences | Coût indicatif |
|---|---|---|---|
| Prestataire de signature (Yousign, Docusign, Universign…) | Envoi du PDF figé via leur API, retour du PDF signé et du fichier de preuve | Compte et clé API, connexion Internet, intégration à développer | Abonnement ou prix par signature (variable selon l'offre) |
| Mini-serveur dédié | Page de signature hébergée recevant uniquement le PDF à signer, synchronisée avec Signal Desk | Hébergement HTTPS, nom de domaine, sécurisation, maintenance | Hébergement de quelques euros par mois + temps de mise en œuvre |
| Tunnel sécurisé temporaire | Exposition ponctuelle de l'écran de signature via un tunnel | Outil de tunnel, sécurité à auditer | Souvent gratuit mais déconseillé pour des données clients |

En attendant : envoyez le PDF du devis par email ; enregistrez l'acceptation reçue (« Marquer comme accepté » avec la preuve) ou faites signer sur place.
