# Sécurité

## Mesures en place

| Mesure | Détail |
|---|---|
| Requêtes SQL paramétrées | Toutes les valeurs passent en paramètres (`?`) ; aucun texte saisi n'est concaténé dans le SQL. Testé avec des tentatives d'injection. |
| Validation des entrées | Contrôles côté métier (emails, SIRET/SIREN avec clé de Luhn, IBAN modulo 97, montants entiers, taux, dates). |
| Fichiers confinés | L'interface ne peut lire/écrire que sous le dossier `files` : chemins relatifs validés en Rust (pas de `..`, pas de chemin absolu, pas de caractère réservé Windows), écriture atomique. |
| Intégrité métier | Déclencheurs SQLite : factures émises, lignes, versions de devis, signatures, journal et documents verrouillés ne peuvent être ni modifiés ni supprimés. |
| Transactions | Numérotation, émission, paiements, signatures, fusions : tout-ou-rien. |
| Journal | Opérations sensibles (émission, paiements et suppressions de paiement, signatures, restaurations, mot de passe, échecs de déverrouillage) inscrites dans un journal en insertion seule. |
| Mot de passe | Empreinte PBKDF2-SHA256 (310 000 itérations, sel aléatoire), comparaison à temps constant, délai croissant après 3 échecs. Jamais stocké en clair. |
| Verrouillage | Manuel (`Ctrl+L`) ou automatique après inactivité. |
| Sauvegardes chiffrées | AES-256-GCM, PBKDF2 600 000 itérations ; altération détectée. |
| Politique de contenu (CSP) | La fenêtre n'exécute que le code de l'application ; aucune ressource distante. |
| Erreurs | Messages compréhensibles, sans pile technique ni données sensibles. |
| Confidentialité | Aucune télémétrie, aucun compte, aucun appel réseau. Seules les actions que vous déclenchez ouvrent une application externe (messagerie, navigateur, visionneuse PDF). |

## Limites (à connaître)

- Le mot de passe applicatif **protège l'accès à l'interface**, pas les fichiers : la base SQLite et les documents ne sont **pas chiffrés sur le disque**. Une personne disposant de votre session Windows, d'un compte administrateur ou d'un accès physique au disque peut les lire.
- Un mot de passe applicatif **ne protège pas contre un administrateur Windows** disposant d'un accès complet au poste.
- **Recommandations** : activez BitLocker (chiffrement du disque), un mot de passe de session Windows robuste, le verrouillage automatique de Windows, et des sauvegardes chiffrées hors du poste.
- Les secrets (phrase de passe de sauvegarde) ne sont pas conservés. L'envoi SMTP, qui nécessiterait de stocker un mot de passe, n'est pas inclus.
- L'installateur n'est pas signé (certificat de signature de code payant) : SmartScreen peut afficher un avertissement.
