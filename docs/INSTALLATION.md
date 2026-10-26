# Guide d'installation

## 1. Installer l'application (utilisateur)

1. Récupérez l'installateur :
   - soit l'artefact **SignalDesk-Windows** de la dernière exécution réussie du workflow GitHub Actions « Windows — tests et installateur » (onglet *Actions* du dépôt) ;
   - soit compilez-le vous-même (section 2).
2. Lancez `Signal Desk_0.1.0_x64-setup.exe` (installation pour l'utilisateur courant, sans droits administrateur) ou le fichier `.msi`.
3. Windows SmartScreen peut afficher un avertissement car l'installateur n'est pas signé par un certificat de signature de code (payant). Cliquez sur « Informations complémentaires » puis « Exécuter quand même ».
4. WebView2 est déjà présent sur Windows 10 (à jour) et 11. Sinon, l'installateur NSIS le télécharge depuis Microsoft (seule connexion réseau, au moment de l'installation).

Au premier lancement :
- ouvrez **Paramètres → Entreprise** et complétez l'adresse professionnelle ;
- ouvrez **Paramètres → TVA** et indiquez votre régime (franchise en base ou assujetti) — il n'est jamais supposé ;
- ajoutez votre IBAN (**Paramètres → Paiement**) et votre logo ;
- choisissez le dossier de sauvegarde (**Paramètres → Sauvegardes**), idéalement un disque externe.

### Emplacement des données

`%APPDATA%\fr.signaldigital.signaldesk\`
- `signal-desk.sqlite` : la base de données
- `files\` : documents émis, devis signés, signatures, modèles importés, pièces jointes, logo
- `sauvegardes-auto\` : sauvegardes de sécurité créées avant une restauration
- `anciennes-donnees\` : données remplacées lors d'une restauration (jamais supprimées)

La désinstallation ne supprime pas ce dossier.

### Optionnel : modèles Word (DOCX)

Pour convertir les modèles Word en PDF, installez **LibreOffice** (gratuit, https://www.libreoffice.org) ou utilisez Microsoft Word s'il est déjà installé. Signal Desk les détecte automatiquement. Sans convertisseur, les modèles visuels (y compris à partir de votre PDF) fonctionnent entièrement.

## 2. Compiler l'installateur sous Windows

Prérequis (une seule fois) :
1. **Node.js 22 LTS** : https://nodejs.org
2. **Rust** : https://rustup.rs (toolchain `stable-x86_64-pc-windows-msvc`)
3. **Microsoft C++ Build Tools** : https://visualstudio.microsoft.com/visual-cpp-build-tools/ (charge de travail « Développement Desktop en C++ »)
4. **Git** pour récupérer le code

Puis, dans PowerShell, à la racine du projet :

```powershell
npm ci
npm test
cd src-tauri; cargo test --release; cd ..
npx tauri build
```

ou simplement :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
```

Résultat :
- `src-tauri\target\release\bundle\nsis\Signal Desk_0.1.0_x64-setup.exe`
- `src-tauri\target\release\bundle\msi\Signal Desk_0.1.0_x64_fr-FR.msi`

## 3. Lancer en développement

```powershell
scripts\dev.cmd
```

(équivaut à `npm ci` puis `npx tauri dev` : interface rechargée à chaud, base de développement dans le même dossier de données que l'application installée — utilisez une sauvegarde avant d'expérimenter.)

Mode navigateur (démonstration de l'interface uniquement, données en mémoire non conservées) : `npm run dev` puis http://localhost:1420.

## 4. Tests

| Commande | Portée |
|---|---|
| `npm test` | 76 tests : calculs, CRM, pipeline, devis, factures, avoirs, paiements, numérotation, PDF multipages, modèles importés, DOCX, signatures, sécurité, contrats, rapports |
| `cd src-tauri && cargo test` | 11 tests : SQLite paramétré, transactions, persistance, chemins de fichiers, sauvegarde / vérification / restauration, chiffrement, détection d'altération |
| `npm run typecheck` | Vérification TypeScript stricte |

Le test de conversion DOCX → PDF s'exécute réellement si LibreOffice est installé (sinon seul le message d'absence est vérifié).
