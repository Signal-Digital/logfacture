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

- [x] Phase 1 — Environnement, architecture, socle Tauri/React, cœur Rust (SQLite, fichiers, sauvegardes, conversion DOCX) — 11 tests Rust
- [x] Phase 2 — Schéma, migrations, déclencheurs de protection, paramètres
- [x] Phase 3 — Entreprises/prospects/clients, contacts, doublons, fusion, CSV, pipeline
- [x] Phase 4 — Activités, tâches, relances, rappels
- [x] Phase 5 — Catalogue, projets, modèles de projet
- [x] Phase 6 — Devis (versions, verrouillage), factures, acomptes, soldes, avoirs, paiements, numérotation
- [~] Phase 7 — Moteur PDF (pagination, fonds importés) fait ; éditeur visuel et import DOCX : en cours
- [ ] Phase 8 — Signatures, suivi des paiements (interface)
- [~] Phase 9 — Contrats récurrents, rapports, emails : logique faite ; interface à faire
- [ ] Phase 10 — Sauvegardes (interface), sécurité (mot de passe, verrouillage)
- [ ] Phase 11 — Tests de bout en bout
- [ ] Phase 12 — Compilation, installateur, documentation

## Journal

- Inter testée pour les PDF : le sous-ensemble produit par pdf-lib perd des glyphes (vérifié par rendu `pdftoppm`). Remplacée par Liberation Sans : PDF de 35 à 80 Ko au lieu de 850 Ko.
