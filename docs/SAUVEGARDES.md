# Sauvegardes et restauration

## Contenu d'une sauvegarde

Fichier `.sdbak` (archive ZIP) contenant :
- `db/signal-desk.sqlite` : instantané **cohérent** de la base, obtenu par `VACUUM INTO` (même si l'application est en cours d'utilisation) ;
- `files/…` : documents émis, devis signés, images de signature, modèles importés, pièces jointes, logo ;
- `manifest.json` : date, version de l'application et du schéma, **empreinte SHA-256 et taille de chaque fichier**.

Option **chiffrée** : l'archive entière est chiffrée en AES-256-GCM avec une clé dérivée de votre phrase de passe (PBKDF2-HMAC-SHA256, 600 000 itérations, sel aléatoire). La phrase de passe n'est jamais enregistrée : **sans elle, la sauvegarde est irrécupérable**.

## Créer une sauvegarde

Paramètres → Sauvegardes :
- **Sauvegarder maintenant** (un clic) ou **Sauvegarde chiffrée…** ;
- choix du **dossier de destination** (disque externe recommandé) ;
- une sauvegarde existante n'est **jamais écrasée** (nom horodaté, création exclusive) ;
- **sauvegarde automatique** configurable (6 h, quotidienne, 3 jours, hebdomadaire), exécutée lorsque l'application est ouverte. Les sauvegardes automatiques ne sont pas chiffrées (la phrase de passe n'étant pas stockée) : placez-les dans un emplacement protégé, et faites régulièrement une sauvegarde chiffrée manuelle si elles quittent votre PC.

## Vérifier (test de restauration)

« **Tester** » réalise, sans toucher aux données en service : déchiffrement, contrôle de toutes les empreintes SHA-256, extraction temporaire de la base, `PRAGMA integrity_check`, comptage des enregistrements (entreprises, devis, factures, paiements, documents, signatures). Toute altération (même d'un seul octet) est détectée.

## Restaurer

1. « Restaurer » sur une sauvegarde de la liste, ou « Restaurer depuis un fichier… ».
2. La sauvegarde est d'abord entièrement vérifiée ; en cas d'anomalie, rien n'est modifié.
3. Après confirmation :
   - une **sauvegarde de sécurité** de l'état actuel est créée dans `sauvegardes-auto` ;
   - les données actuelles sont **déplacées** (jamais supprimées) dans `anciennes-donnees\<date>` ;
   - les données de la sauvegarde sont mises en place, la base est rouverte, l'application se recharge.

## Bonnes pratiques

- Règle 3-2-1 : 3 copies, sur 2 supports différents, dont 1 hors du bureau.
- Testez une restauration de temps en temps (« Tester »).
- Le stockage local n'est **pas un archivage certifié** à valeur probante. Les obligations de conservation (factures : 10 ans au titre du Code de commerce) restent de votre responsabilité.

Tests automatisés couvrant ce module : `src-tauri/src/backup.rs` (cycle complet sauvegarde → modification → restauration, non-écrasement, chiffrement, mauvaise phrase de passe, altération d'un octet, altération d'un fichier non chiffré) et test d'intégration de l'application réelle (sauvegarde chiffrée, vérification, restauration avec sauvegarde de sécurité).
