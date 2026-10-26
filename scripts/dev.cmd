@echo off
REM Lance Signal Desk en mode développement (rechargement à chaud).
REM Prérequis : Node.js 22+, Rust (rustup), Microsoft C++ Build Tools, WebView2.
cd /d "%~dp0\.."
if not exist node_modules (
  echo Installation des dépendances...
  call npm ci || exit /b 1
)
call npx tauri dev
