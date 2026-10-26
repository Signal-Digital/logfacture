//! Gestion sécurisée des fichiers de l'application.
//!
//! Tous les fichiers gérés (documents, modèles, signatures, pièces jointes)
//! sont stockés sous `<données>/files`. Les chemins reçus de l'interface sont
//! relatifs et validés : pas de chemin absolu, pas de `..`, pas de caractères
//! réservés Windows. Cela empêche l'interface d'écrire hors du dossier prévu.

use std::path::{Component, Path, PathBuf};

pub const FILES_DIR: &str = "files";

pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.len() > 400 {
        return Err("Chemin de fichier invalide".into());
    }
    let p = Path::new(&rel);
    let mut out = root.to_path_buf();
    for comp in p.components() {
        match comp {
            Component::Normal(s) => {
                let s = s.to_str().ok_or("Chemin non UTF-8")?;
                if s.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || (c as u32) < 32) {
                    return Err(format!("Nom de fichier invalide : {s}"));
                }
                if s.ends_with('.') || s.ends_with(' ') {
                    return Err(format!("Nom de fichier invalide : {s}"));
                }
                out.push(s);
            }
            _ => return Err("Chemin de fichier non autorisé".into()),
        }
    }
    Ok(out)
}

/// Nettoie un nom de fichier fourni par l'utilisateur.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || (c as u32) < 32 { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if trimmed.is_empty() { "fichier".into() } else { trimmed.chars().take(150).collect() }
}

pub fn write_file(root: &Path, rel: &str, data: &[u8]) -> Result<u64, String> {
    let path = safe_join(root, rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Écriture atomique : fichier temporaire puis renommage.
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    std::fs::write(&tmp, data).map_err(|e| format!("Écriture impossible : {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(data.len() as u64)
}

pub fn read_file(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let path = safe_join(root, rel)?;
    std::fs::read(&path).map_err(|e| format!("Lecture impossible ({rel}) : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let root = Path::new("/data/files");
        assert!(safe_join(root, "../secret").is_err());
        assert!(safe_join(root, "a/../../b").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, "C:/Windows/x").is_err());
        assert!(safe_join(root, "a\\..\\b").is_err());
        assert!(safe_join(root, "").is_err());
        assert_eq!(safe_join(root, "documents/2026/F-1.pdf").unwrap(), PathBuf::from("/data/files/documents/2026/F-1.pdf"));
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("Devis: client/test?.pdf"), "Devis_ client_test_.pdf");
        assert_eq!(sanitize_file_name("  ..."), "fichier");
    }

    #[test]
    fn writes_and_reads_atomically() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "a/b/c.txt", b"bonjour").unwrap();
        assert_eq!(read_file(dir.path(), "a/b/c.txt").unwrap(), b"bonjour");
        write_file(dir.path(), "a/b/c.txt", b"remplace").unwrap();
        assert_eq!(read_file(dir.path(), "a/b/c.txt").unwrap(), b"remplace");
    }
}
