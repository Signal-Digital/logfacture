# Signal Desk

Logiciel de bureau tout-en-un pour **Signal Digital** : CRM, prospection, pipeline, activités et relances, devis, factures et avoirs, paiements, signatures électroniques, projets, contrats récurrents, documents, rapports et sauvegardes.

- **100 % local** : base SQLite et fichiers sur votre PC, aucun compte, aucun abonnement, aucune télémétrie.
- **Windows 10/11** : application Tauri (WebView2), installateur NSIS ou MSI.
- **Interface en français**, euros et dates au format français.

## Documentation

| Document | Contenu |
|---|---|
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Installation, compilation, lancement en développement |
| [docs/GUIDE-UTILISATEUR.md](docs/GUIDE-UTILISATEUR.md) | Utilisation au quotidien, du prospect au paiement |
| [docs/MODELES.md](docs/MODELES.md) | Modèles de documents : import PDF / DOCX / image, éditeur visuel, champs, pagination |
| [docs/SIGNATURES.md](docs/SIGNATURES.md) | Signature électronique locale, preuves, limites eIDAS, signature à distance |
| [docs/SAUVEGARDES.md](docs/SAUVEGARDES.md) | Sauvegardes, chiffrement, vérification, restauration |
| [docs/SECURITE.md](docs/SECURITE.md) | Mot de passe, verrouillage, limites de sécurité d'une application locale |
| [docs/REGLEMENTAIRE.md](docs/REGLEMENTAIRE.md) | Points réglementaires (facturation, TVA, facturation électronique) à faire vérifier |
| [docs/RAPPORT.md](docs/RAPPORT.md) | Fonctionnalités terminées, tests, limites restantes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture technique et organisation du code |
| [docs/SUIVI.md](docs/SUIVI.md) | Suivi des phases et décisions |

## Démarrage rapide (développement)

```bash
npm ci
npm test                 # tests de la logique métier, des PDF et des signatures
cd src-tauri && cargo test && cd ..   # tests Rust (base, fichiers, sauvegardes)
npx tauri dev            # lance l'application
```

Sous Windows : `scripts\dev.cmd` (développement) ou `scripts\build-windows.ps1` (installateur).
Un installateur est aussi produit automatiquement par GitHub Actions (`.github/workflows/windows.yml`, artefact « SignalDesk-Windows »).
