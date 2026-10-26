# Architecture

```
src-tauri/            Cœur natif (Rust, Tauri 2)
  src/db.rs           Connexion SQLite unique (WAL, synchronous=FULL, foreign_keys), requêtes paramétrées
  src/files.rs        Fichiers confinés au dossier de données, écriture atomique
  src/backup.rs       Sauvegardes .sdbak (ZIP + manifeste SHA-256, AES-256-GCM), vérification, restauration
  src/convert.rs      DOCX → PDF via LibreOffice ou Word (si installés)
  src/lib.rs          Commandes exposées à l'interface
src/
  lib/db/             Interface Db (file d'attente + transactions), pilotes Tauri et node:sqlite, migrations
  lib/money.ts        Calculs en centimes (BigInt), TVA par taux, remises, acomptes, répartition exacte
  lib/format.ts       Formats français (€, dates)
  domain/             Logique métier testée (entreprises, pipeline, activités, catalogue, projets,
                      devis, factures, contrats, documents, modèles, signatures, rapports, sécurité…)
  pdf/                Moteur PDF (pdf-lib) : mise en page, pagination, fonds importés, DOCX, signature
  platform/           Tauri (natif) ou navigateur (démonstration, sql.js en mémoire)
  ui/                 Interface React : composants, pages, éditeur de modèles
tests/                Tests Vitest (même schéma SQLite que l'application, via node:sqlite)
```

## Principes

- **Une seule base, une seule logique** : les services métier (`src/domain`) prennent une interface `Db`. Dans l'application, elle appelle la connexion SQLite native (Rust) ; dans les tests, `node:sqlite`. Le schéma et les migrations sont identiques.
- **Sérialisation** : toutes les requêtes passent par une file d'attente ; une transaction (`BEGIN IMMEDIATE`) ne peut être entrelacée avec une autre opération.
- **Montants** : centimes entiers, taux en points de base, quantités en millièmes ; produits calculés en BigInt ; arrondi au centime, demi s'éloignant de zéro.
- **Instantanés** : chaque document émis fige vendeur, client, lignes et totaux (JSON) ; le PDF définitif est généré une seule fois et son empreinte enregistrée.
- **Défense en profondeur** : les règles d'immutabilité sont dans le code métier **et** dans des déclencheurs SQLite.
- **Migrations** : versionnées (`schema_migrations`), exécutées au démarrage dans une transaction ; une migration publiée n'est jamais modifiée.

## Évolutions préparées

- Factur-X : `src/domain/facturx.ts` (XML CII EN 16931) ; reste à produire le PDF/A-3 et à intégrer une plateforme agréée.
- Signature à distance : `signature_requests.channel = 'distance'`.
- SMTP : paramètres prévus (`email.smtp_*`), envoi non implémenté.
