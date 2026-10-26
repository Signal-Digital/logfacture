# Suivi du projet Signal Desk

Fichier de suivi des phases, des décisions et de l'état d'avancement.
Mis à jour à chaque étape pour permettre de reprendre le développement sans perte de contexte.

## Décisions d'architecture

| Sujet | Décision | Raison |
|---|---|---|
| Application desktop | Tauri 2 (Rust) + React 18 + TypeScript + Vite | Installateur Windows léger (WebView2), pas de Chromium embarqué, accès fichiers maîtrisé |
| Base de données | SQLite (rusqlite, `bundled`), mode WAL, `synchronous=FULL` | Locale, fiable, un seul fichier, sauvegarde cohérente via `VACUUM INTO` |
| Logique métier | TypeScript (`src/domain`), interface `Db` unique | Même code testé en Node (`node:sqlite`) et exécuté dans l'application (pilote Rust) |
| Montants | Centimes entiers, taux en points de base, quantités en millièmes, BigInt pour les produits | Aucune erreur d'arrondi des flottants |
| Immutabilité | Déclencheurs SQLite (factures émises, versions de devis, signatures, journal) | Protection même si un bug applicatif tentait une modification |
| PDF | pdf-lib + fontkit, police Liberation Sans (OFL) en sous-ensemble | Génération 100 % locale ; Inter abandonnée : glyphes perdus lors du sous-ensemble |
| Fonds importés | PDF intégré page par page (`embedPdf`), PNG/JPEG en image pleine page | Conserve logo, couleurs, formes, textes statiques du modèle d'origine |
| DOCX | Remplissage par docxtemplater ; conversion PDF par LibreOffice (gratuit) ou Word si installés | Aucune bibliothèque libre ne convertit fidèlement un DOCX en PDF seule |
| Sauvegardes | Archive `.sdbak` (ZIP + manifeste SHA-256), chiffrement AES-256-GCM optionnel (PBKDF2 600 000 it.) | Vérifiable, restaurable, jamais d'écrasement |
| Fichiers | Confinés au dossier de données, chemins relatifs validés côté Rust | Pas d'écriture arbitraire sur le disque depuis l'interface |

## Phases

- [x] Phase 1 — Environnement, architecture, socle Tauri/React, cœur Rust
- [x] Phase 2 — Schéma, migrations, déclencheurs de protection, paramètres
- [x] Phase 3 — Entreprises/prospects/clients, contacts, doublons, fusion, CSV, pipeline Kanban
- [x] Phase 4 — Activités, tâches, relances, rappels locaux, calendrier
- [x] Phase 5 — Catalogue, projets, modèles de projet
- [x] Phase 6 — Devis (versions, verrouillage), factures, acomptes, soldes, avoirs, paiements, numérotation
- [x] Phase 7 — Moteur PDF paginé, import PDF/image/DOCX, éditeur visuel
- [x] Phase 8 — Signatures (écran isolé, certificat), suivi des paiements, relances
- [x] Phase 9 — Contrats récurrents, rapports, emails
- [x] Phase 10 — Sauvegardes (chiffrées, vérifiées, restaurables), mot de passe, verrouillage
- [x] Phase 11 — 76 tests TS + 11 tests Rust, parcours UI Playwright, test natif Tauri/WebDriver
- [x] Phase 12 — Workflow d'installateur Windows, documentation

## Reprise du développement

Voir docs/RAPPORT.md (limites restantes et pistes). Commandes : `npm test`, `cargo test` (src-tauri), `npx tauri dev`.

## Journal

- Inter testée pour les PDF : le sous-ensemble produit par pdf-lib perd des glyphes (vérifié par rendu `pdftoppm`). Remplacée par Liberation Sans : PDF de 35 à 80 Ko au lieu de 850 Ko.
- Mode navigateur (sql.js en mémoire) conservé pour tester l'interface sans Windows ; signature ouverte dans le même onglet dans ce mode.
- Fenêtre de signature Tauri : routeur restreint à l'écran de signature (isolation du CRM).
- Test natif : binaire `cargo build` (devUrl) piloté par tauri-driver + WebKitWebDriver sous Xvfb.
