# Compile Signal Desk et produit les installateurs Windows (NSIS .exe et MSI).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host '1/5 Vérification des outils...'
node --version; if ($LASTEXITCODE) { throw 'Node.js 22+ est requis (https://nodejs.org)' }
cargo --version; if ($LASTEXITCODE) { throw 'Rust est requis (https://rustup.rs)' }

Write-Host '2/5 Installation des dépendances...'
npm ci

Write-Host '3/5 Tests automatisés...'
npm run typecheck
npm test
Push-Location src-tauri; cargo test --release; Pop-Location

Write-Host '4/5 Compilation de l''application et des installateurs...'
npx tauri build

Write-Host '5/5 Terminé. Installateurs :'
Get-ChildItem src-tauri\target\release\bundle\nsis\*.exe, src-tauri\target\release\bundle\msi\*.msi | ForEach-Object { Write-Host "  $($_.FullName)" }
