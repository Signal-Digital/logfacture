//! Conversion DOCX → PDF.
//!
//! Aucune bibliothèque libre ne permet une conversion fidèle d'un document Word
//! en PDF sans moteur de mise en page complet. Signal Desk utilise donc, s'il
//! est présent sur le poste :
//!   1. LibreOffice (gratuit) en mode `--headless` ;
//!   2. à défaut, sous Windows, Microsoft Word via automatisation COM.
//! Si aucun des deux n'est disponible, le DOCX rempli reste exportable tel quel.

use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(serde::Serialize, Debug, Clone)]
pub struct ConverterInfo {
    pub libreoffice: Option<String>,
    pub word: bool,
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn find_libreoffice() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = std::env::var("SIGNAL_DESK_SOFFICE") {
        candidates.push(PathBuf::from(p));
    }
    if cfg!(windows) {
        for base in [std::env::var("ProgramFiles").ok(), std::env::var("ProgramFiles(x86)").ok()].into_iter().flatten() {
            candidates.push(Path::new(&base).join("LibreOffice").join("program").join("soffice.exe"));
        }
        candidates.push(PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"));
    } else {
        candidates.push(PathBuf::from("/usr/bin/soffice"));
        candidates.push(PathBuf::from("/usr/bin/libreoffice"));
        candidates.push(PathBuf::from("/usr/local/bin/soffice"));
        candidates.push(PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice"));
    }
    candidates.into_iter().find(|p| p.exists())
}

#[cfg(windows)]
fn word_available() -> bool {
    let out = hidden(Command::new("powershell").args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "if (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\Word.Application' -ErrorAction SilentlyContinue) { 'yes' }",
    ]))
    .output();
    matches!(out, Ok(o) if String::from_utf8_lossy(&o.stdout).contains("yes"))
}

#[cfg(not(windows))]
fn word_available() -> bool {
    false
}

pub fn detect() -> ConverterInfo {
    ConverterInfo { libreoffice: find_libreoffice().map(|p| p.to_string_lossy().into_owned()), word: word_available() }
}

fn convert_with_libreoffice(soffice: &Path, input: &Path, out_dir: &Path, profile_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let profile_url = format!("file:///{}", profile_dir.to_string_lossy().replace('\\', "/").trim_start_matches('/'));
    let output = hidden(
        Command::new(soffice)
            .arg(format!("-env:UserInstallation={profile_url}"))
            .args(["--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir"])
            .arg(out_dir)
            .arg(input),
    )
    .output()
    .map_err(|e| format!("LibreOffice n'a pas pu être lancé : {e}"))?;
    let stem = input.file_stem().ok_or("Nom de fichier invalide")?;
    let pdf = out_dir.join(format!("{}.pdf", stem.to_string_lossy()));
    if pdf.exists() {
        Ok(pdf)
    } else {
        Err(format!(
            "Conversion LibreOffice échouée : {}",
            String::from_utf8_lossy(&output.stderr).chars().take(400).collect::<String>()
        ))
    }
}

#[cfg(windows)]
fn convert_with_word(input: &Path, output_pdf: &Path) -> Result<PathBuf, String> {
    // Les chemins sont passés par variables d'environnement : aucune interpolation
    // dans le script PowerShell (pas d'injection possible).
    let script = "$ErrorActionPreference='Stop'; $w = New-Object -ComObject Word.Application; $w.Visible = $false; \
        try { $d = $w.Documents.Open($env:SD_IN, $false, $true); $d.ExportAsFixedFormat($env:SD_OUT, 17); $d.Close($false) } \
        finally { $w.Quit() }";
    let out = hidden(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", script]))
        .env("SD_IN", input)
        .env("SD_OUT", output_pdf)
        .output()
        .map_err(|e| format!("PowerShell indisponible : {e}"))?;
    if output_pdf.exists() {
        Ok(output_pdf.to_path_buf())
    } else {
        Err(format!("Conversion Word échouée : {}", String::from_utf8_lossy(&out.stderr).chars().take(400).collect::<String>()))
    }
}

#[cfg(not(windows))]
fn convert_with_word(_input: &Path, _output_pdf: &Path) -> Result<PathBuf, String> {
    Err("Microsoft Word n'est utilisable que sous Windows".into())
}

/// Convertit `input` (DOCX) en PDF dans `work_dir`. Retourne les octets du PDF.
pub fn docx_to_pdf(input: &Path, work_dir: &Path) -> Result<Vec<u8>, String> {
    let mut errors = Vec::new();
    if let Some(soffice) = find_libreoffice() {
        match convert_with_libreoffice(&soffice, input, &work_dir.join("out"), &work_dir.join("lo-profile")) {
            Ok(pdf) => return std::fs::read(pdf).map_err(|e| e.to_string()),
            Err(e) => errors.push(e),
        }
    }
    if cfg!(windows) && word_available() {
        let out = work_dir.join("word-out.pdf");
        match convert_with_word(input, &out) {
            Ok(pdf) => return std::fs::read(pdf).map_err(|e| e.to_string()),
            Err(e) => errors.push(e),
        }
    }
    if errors.is_empty() {
        Err("Aucun convertisseur DOCX → PDF trouvé. Installez LibreOffice (gratuit) ou Microsoft Word, \
             ou exportez le document Word rempli puis convertissez-le manuellement."
            .into())
    } else {
        Err(errors.join(" | "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_does_not_panic() {
        let info = detect();
        // Information seulement : la présence dépend du poste.
        println!("Convertisseurs détectés : {info:?}");
    }
}
