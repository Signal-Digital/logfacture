//! Sauvegardes et restauration.
//!
//! Format `.sdbak` : archive ZIP contenant
//!   - `manifest.json` (version, date, empreintes SHA-256 de chaque fichier),
//!   - `db/signal-desk.sqlite` (instantané cohérent obtenu par `VACUUM INTO`),
//!   - `files/...` (documents, modèles, signatures, pièces jointes).
//!
//! Option de chiffrement : l'archive complète est chiffrée en AES-256-GCM avec
//! une clé dérivée de la phrase de passe (PBKDF2-HMAC-SHA256, 600 000 itérations).
//! En-tête : `SDBAKENC1` + sel (16 octets) + nonce (12 octets) + données chiffrées.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

pub const ENC_MAGIC: &[u8] = b"SDBAKENC1";
pub const PBKDF2_ITERATIONS: u32 = 600_000;
pub const DB_ENTRY: &str = "db/signal-desk.sqlite";
pub const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Manifest {
    pub format_version: u32,
    pub app: String,
    pub app_version: String,
    pub created_at: String,
    pub schema_version: i64,
    pub files: BTreeMap<String, FileEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileEntry {
    pub sha256: String,
    pub size: u64,
}

#[derive(Serialize, Debug, Clone)]
pub struct BackupInfo {
    pub path: String,
    pub size: u64,
    pub created_at: String,
    pub encrypted: bool,
    pub file_count: usize,
    pub sha256: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct VerifyReport {
    pub ok: bool,
    pub encrypted: bool,
    pub created_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub file_count: usize,
    pub integrity_check: String,
    pub table_counts: BTreeMap<String, i64>,
    pub errors: Vec<String>,
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

pub fn encrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);
    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ct = cipher.encrypt(Nonce::from_slice(&nonce), data).map_err(|_| "Échec du chiffrement".to_string())?;
    let mut out = Vec::with_capacity(ENC_MAGIC.len() + 28 + ct.len());
    out.extend_from_slice(ENC_MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn is_encrypted(data: &[u8]) -> bool {
    data.starts_with(ENC_MAGIC)
}

pub fn decrypt(data: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    if !is_encrypted(data) || data.len() < ENC_MAGIC.len() + 28 {
        return Err("Ce fichier n'est pas une sauvegarde chiffrée valide".into());
    }
    let salt = &data[ENC_MAGIC.len()..ENC_MAGIC.len() + 16];
    let nonce = &data[ENC_MAGIC.len() + 16..ENC_MAGIC.len() + 28];
    let ct = &data[ENC_MAGIC.len() + 28..];
    let key = derive_key(passphrase, salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "Phrase de passe incorrecte ou sauvegarde altérée".to_string())
}

fn collect_files(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(|e| e.to_string())?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.path());
    for entry in entries {
        let p = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            collect_files(&p, base, out)?;
        } else if ft.is_file() {
            if p.extension().and_then(|e| e.to_str()) == Some("tmp") {
                continue;
            }
            out.push(p.strip_prefix(base).map_err(|e| e.to_string())?.to_path_buf());
        }
    }
    Ok(())
}

fn rel_to_entry(p: &Path) -> String {
    p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

/// Crée l'archive de sauvegarde en mémoire.
///
/// `conn` : connexion ouverte (l'instantané est pris via `VACUUM INTO`, ce qui
/// garantit une copie cohérente même si le WAL contient des pages récentes).
pub fn build_archive(conn: &Connection, data_dir: &Path, app_version: &str, tmp_dir: &Path) -> Result<(Vec<u8>, Manifest), String> {
    std::fs::create_dir_all(tmp_dir).map_err(|e| e.to_string())?;
    let snapshot = tmp_dir.join(format!("snapshot-{}.sqlite", chrono::Local::now().format("%Y%m%d%H%M%S%f")));
    if snapshot.exists() {
        std::fs::remove_file(&snapshot).map_err(|e| e.to_string())?;
    }
    conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])
        .map_err(|e| format!("Instantané de la base impossible : {e}"))?;
    let db_bytes = std::fs::read(&snapshot).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&snapshot);

    let schema_version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .unwrap_or(0);

    let mut manifest = Manifest {
        format_version: FORMAT_VERSION,
        app: "Signal Desk".into(),
        app_version: app_version.into(),
        created_at: chrono::Local::now().to_rfc3339(),
        schema_version,
        files: BTreeMap::new(),
    };

    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);

        zip.start_file(DB_ENTRY, opts).map_err(|e| e.to_string())?;
        zip.write_all(&db_bytes).map_err(|e| e.to_string())?;
        manifest.files.insert(DB_ENTRY.into(), FileEntry { sha256: sha256_hex(&db_bytes), size: db_bytes.len() as u64 });

        let files_root = data_dir.join(crate::files::FILES_DIR);
        let mut rels = Vec::new();
        collect_files(&files_root, &files_root, &mut rels)?;
        for rel in rels {
            let bytes = std::fs::read(files_root.join(&rel)).map_err(|e| e.to_string())?;
            let name = format!("files/{}", rel_to_entry(&rel));
            zip.start_file(name.as_str(), opts).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
            manifest.files.insert(name, FileEntry { sha256: sha256_hex(&bytes), size: bytes.len() as u64 });
        }

        zip.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
        zip.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok((buf.into_inner(), manifest))
}

/// Crée une sauvegarde dans `dest_dir`. N'écrase jamais un fichier existant.
pub fn create_backup(
    conn: &Connection,
    data_dir: &Path,
    dest_dir: &Path,
    passphrase: Option<&str>,
    app_version: &str,
    label: &str,
) -> Result<BackupInfo, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Dossier de destination inaccessible : {e}"))?;
    let (archive, manifest) = build_archive(conn, data_dir, app_version, &data_dir.join("tmp"))?;
    let data = match passphrase {
        Some(p) if !p.is_empty() => encrypt(&archive, p)?,
        _ => archive,
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let label = crate::files::sanitize_file_name(label);
    let mut path = dest_dir.join(format!("SignalDesk_{label}_{stamp}.sdbak"));
    let mut n = 1;
    while path.exists() {
        path = dest_dir.join(format!("SignalDesk_{label}_{stamp}_{n}.sdbak"));
        n += 1;
    }
    // create_new : échoue si le fichier existe (jamais d'écrasement).
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("Création du fichier de sauvegarde impossible : {e}"))?;
    f.write_all(&data).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    Ok(BackupInfo {
        path: path.to_string_lossy().into_owned(),
        size: data.len() as u64,
        created_at: manifest.created_at,
        encrypted: passphrase.map(|p| !p.is_empty()).unwrap_or(false),
        file_count: manifest.files.len(),
        sha256: sha256_hex(&data),
    })
}

/// Lit une archive (déchiffre si nécessaire) et vérifie toutes les empreintes.
/// Retourne le manifeste et le contenu des fichiers.
pub fn open_archive(raw: &[u8], passphrase: Option<&str>) -> Result<(Manifest, BTreeMap<String, Vec<u8>>), String> {
    let data = if is_encrypted(raw) {
        match passphrase {
            Some(p) if !p.is_empty() => decrypt(raw, p)?,
            _ => return Err("Cette sauvegarde est chiffrée : la phrase de passe est requise".into()),
        }
    } else {
        raw.to_vec()
    };
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("Archive illisible : {e}"))?;
    let mut contents = BTreeMap::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name().to_string();
        if name.contains("..") || name.starts_with('/') || name.contains('\\') {
            return Err(format!("Entrée d'archive suspecte : {name}"));
        }
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        contents.insert(name, bytes);
    }
    let manifest_bytes = contents.remove("manifest.json").ok_or("Manifeste absent : ce n'est pas une sauvegarde Signal Desk")?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|e| format!("Manifeste invalide : {e}"))?;
    if manifest.format_version > FORMAT_VERSION {
        return Err("Sauvegarde créée par une version plus récente de Signal Desk".into());
    }
    for (name, entry) in &manifest.files {
        let bytes = contents.get(name).ok_or_else(|| format!("Fichier manquant dans l'archive : {name}"))?;
        if sha256_hex(bytes) != entry.sha256 {
            return Err(format!("Empreinte SHA-256 incorrecte pour {name} : sauvegarde altérée"));
        }
    }
    if contents.len() != manifest.files.len() {
        return Err("L'archive contient des fichiers non déclarés dans le manifeste".into());
    }
    if !contents.contains_key(DB_ENTRY) {
        return Err("Base de données absente de la sauvegarde".into());
    }
    Ok((manifest, contents))
}

/// Vérification complète sans toucher aux données en service :
/// déchiffrement, empreintes, extraction temporaire et `PRAGMA integrity_check`.
pub fn verify_backup(path: &Path, passphrase: Option<&str>, tmp_dir: &Path) -> VerifyReport {
    let mut report = VerifyReport {
        ok: false,
        encrypted: false,
        created_at: String::new(),
        app_version: String::new(),
        schema_version: 0,
        file_count: 0,
        integrity_check: String::new(),
        table_counts: BTreeMap::new(),
        errors: vec![],
    };
    let raw = match std::fs::read(path) {
        Ok(r) => r,
        Err(e) => {
            report.errors.push(format!("Lecture impossible : {e}"));
            return report;
        }
    };
    report.encrypted = is_encrypted(&raw);
    let (manifest, contents) = match open_archive(&raw, passphrase) {
        Ok(x) => x,
        Err(e) => {
            report.errors.push(e);
            return report;
        }
    };
    report.created_at = manifest.created_at.clone();
    report.app_version = manifest.app_version.clone();
    report.schema_version = manifest.schema_version;
    report.file_count = manifest.files.len();
    let _ = std::fs::create_dir_all(tmp_dir);
    let test_db = tmp_dir.join(format!("verify-{}.sqlite", chrono::Local::now().format("%Y%m%d%H%M%S%f")));
    if let Err(e) = std::fs::write(&test_db, &contents[DB_ENTRY]) {
        report.errors.push(e.to_string());
        return report;
    }
    match Connection::open(&test_db) {
        Ok(conn) => {
            report.integrity_check = conn
                .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                .unwrap_or_else(|e| e.to_string());
            if report.integrity_check != "ok" {
                report.errors.push(format!("Contrôle d'intégrité SQLite : {}", report.integrity_check));
            }
            for table in ["companies", "contacts", "quotes", "invoices", "payments", "documents", "signatures"] {
                let sql = format!("SELECT COUNT(*) FROM {table}");
                if let Ok(n) = conn.query_row(&sql, [], |r| r.get::<_, i64>(0)) {
                    report.table_counts.insert(table.into(), n);
                }
            }
        }
        Err(e) => report.errors.push(format!("Base illisible : {e}")),
    }
    let _ = std::fs::remove_file(&test_db);
    report.ok = report.errors.is_empty();
    report
}

/// Restaure une sauvegarde dans `data_dir`.
///
/// La connexion doit être fermée par l'appelant. Les données actuelles ne sont
/// pas supprimées : elles sont déplacées dans `data_dir/anciennes-donnees/<date>`.
/// Retourne le chemin du dossier contenant les anciennes données.
pub fn restore_backup(path: &Path, passphrase: Option<&str>, data_dir: &Path, db_file_name: &str) -> Result<PathBuf, String> {
    let raw = std::fs::read(path).map_err(|e| format!("Lecture impossible : {e}"))?;
    let (_manifest, contents) = open_archive(&raw, passphrase)?;

    // 1. Extraction complète dans un dossier de préparation.
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let staging = data_dir.join(format!("restauration-{stamp}"));
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    for (name, bytes) in &contents {
        let target = if name == DB_ENTRY {
            staging.join(db_file_name)
        } else if let Some(rest) = name.strip_prefix("files/") {
            crate::files::safe_join(&staging.join(crate::files::FILES_DIR), rest)?
        } else {
            continue;
        };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    // 2. Contrôle d'intégrité de la base extraite.
    {
        let conn = Connection::open(staging.join(db_file_name)).map_err(|e| e.to_string())?;
        let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if check != "ok" {
            return Err(format!("Base restaurée corrompue : {check}"));
        }
    }
    // 3. Mise de côté des données actuelles (jamais supprimées).
    let previous = data_dir.join("anciennes-donnees").join(&stamp);
    std::fs::create_dir_all(&previous).map_err(|e| e.to_string())?;
    for suffix in ["", "-wal", "-shm"] {
        let f = data_dir.join(format!("{db_file_name}{suffix}"));
        if f.exists() {
            std::fs::rename(&f, previous.join(format!("{db_file_name}{suffix}"))).map_err(|e| e.to_string())?;
        }
    }
    let files_dir = data_dir.join(crate::files::FILES_DIR);
    if files_dir.exists() {
        std::fs::rename(&files_dir, previous.join(crate::files::FILES_DIR)).map_err(|e| e.to_string())?;
    }
    // 4. Mise en place des données restaurées.
    std::fs::rename(staging.join(db_file_name), data_dir.join(db_file_name)).map_err(|e| e.to_string())?;
    let staged_files = staging.join(crate::files::FILES_DIR);
    if staged_files.exists() {
        std::fs::rename(&staged_files, &files_dir).map_err(|e| e.to_string())?;
    } else {
        std::fs::create_dir_all(&files_dir).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_dir_all(&staging);
    Ok(previous)
}

#[derive(Serialize, Debug, Clone)]
pub struct BackupListItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: String,
    pub encrypted: bool,
}

pub fn list_backups(dir: &Path) -> Result<Vec<BackupListItem>, String> {
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("sdbak") {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let mut head = [0u8; 9];
        let encrypted = std::fs::File::open(&p).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == ENC_MAGIC;
        let modified: chrono::DateTime<chrono::Local> = meta.modified().map(Into::into).unwrap_or_else(|_| chrono::Local::now());
        out.push(BackupListItem {
            path: p.to_string_lossy().into_owned(),
            name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            size: meta.len(),
            modified: modified.to_rfc3339(),
            encrypted,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use serde_json::json;

    fn setup(dir: &Path) -> Database {
        let db = Database::open(dir.join("signal-desk.sqlite")).unwrap();
        db.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES (3);
             CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE invoices (id INTEGER PRIMARY KEY, number TEXT);",
        )
        .unwrap();
        db.execute("INSERT INTO companies (name) VALUES (?)", &[json!("Boulangerie Martin")]).unwrap();
        db.execute("INSERT INTO invoices (number) VALUES (?)", &[json!("F-2026-0001")]).unwrap();
        crate::files::write_file(&dir.join("files"), "documents/2026/F-2026-0001.pdf", b"%PDF-1.7 test").unwrap();
        crate::files::write_file(&dir.join("files"), "signatures/sig-1.png", b"PNGDATA").unwrap();
        db
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let enc = encrypt(b"secret data", "phrase").unwrap();
        assert!(is_encrypted(&enc));
        assert_eq!(decrypt(&enc, "phrase").unwrap(), b"secret data");
        assert!(decrypt(&enc, "mauvaise").is_err());
    }

    #[test]
    fn backup_verify_restore_full_cycle() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let mut db = setup(&data);
        let dest = dir.path().join("externe");
        let info = create_backup(db.conn().unwrap(), &data, &dest, None, "0.1.0", "manuelle").unwrap();
        assert!(!info.encrypted);
        assert_eq!(info.file_count, 3);

        // Deuxième sauvegarde immédiate : jamais d'écrasement.
        let info2 = create_backup(db.conn().unwrap(), &data, &dest, None, "0.1.0", "manuelle").unwrap();
        assert_ne!(info.path, info2.path);
        assert_eq!(list_backups(&dest).unwrap().len(), 2);

        let report = verify_backup(Path::new(&info.path), None, &data.join("tmp"));
        assert!(report.ok, "{:?}", report.errors);
        assert_eq!(report.integrity_check, "ok");
        assert_eq!(report.table_counts["companies"], 1);
        assert_eq!(report.schema_version, 3);

        // Modification après sauvegarde, puis restauration.
        db.execute("INSERT INTO companies (name) VALUES (?)", &[json!("Ajout après sauvegarde")]).unwrap();
        crate::files::write_file(&data.join("files"), "documents/nouveau.pdf", b"new").unwrap();
        db.close().unwrap();
        let previous = restore_backup(Path::new(&info.path), None, &data, "signal-desk.sqlite").unwrap();
        db.reopen().unwrap();
        let rows = db.select("SELECT name FROM companies", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], json!("Boulangerie Martin"));
        assert_eq!(crate::files::read_file(&data.join("files"), "documents/2026/F-2026-0001.pdf").unwrap(), b"%PDF-1.7 test");
        assert!(!data.join("files/documents/nouveau.pdf").exists());
        // Les anciennes données sont conservées, pas supprimées.
        assert!(previous.join("files/documents/nouveau.pdf").exists());
        assert!(previous.join("signal-desk.sqlite").exists());
    }

    #[test]
    fn encrypted_backup_requires_passphrase_and_detects_tampering() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let db = setup(&data);
        let dest = dir.path().join("bk");
        let info = create_backup(db.conn().unwrap(), &data, &dest, Some("correct horse"), "0.1.0", "auto").unwrap();
        assert!(info.encrypted);
        let tmp = data.join("tmp");
        assert!(!verify_backup(Path::new(&info.path), None, &tmp).ok);
        assert!(!verify_backup(Path::new(&info.path), Some("faux"), &tmp).ok);
        assert!(verify_backup(Path::new(&info.path), Some("correct horse"), &tmp).ok);
        // Altération d'un octet
        let mut raw = std::fs::read(&info.path).unwrap();
        let n = raw.len();
        raw[n - 5] ^= 0xff;
        let tampered = dest.join("altere.sdbak");
        std::fs::write(&tampered, raw).unwrap();
        assert!(!verify_backup(&tampered, Some("correct horse"), &tmp).ok);
    }

    #[test]
    fn unencrypted_tampering_detected_by_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let db = setup(&data);
        let (archive, _) = build_archive(db.conn().unwrap(), &data, "0.1.0", &data.join("tmp")).unwrap();
        // Reconstruit une archive en remplaçant un fichier sans mettre à jour le manifeste.
        let mut zin = zip::ZipArchive::new(Cursor::new(archive)).unwrap();
        let mut out = Cursor::new(Vec::new());
        {
            let mut zout = zip::ZipWriter::new(&mut out);
            for i in 0..zin.len() {
                let mut f = zin.by_index(i).unwrap();
                let name = f.name().to_string();
                let mut b = Vec::new();
                f.read_to_end(&mut b).unwrap();
                if name == "files/signatures/sig-1.png" {
                    b = b"FALSIFIE".to_vec();
                }
                zout.start_file(name.as_str(), zip::write::SimpleFileOptions::default()).unwrap();
                zout.write_all(&b).unwrap();
            }
            zout.finish().unwrap();
        }
        let err = open_archive(&out.into_inner(), None).unwrap_err();
        assert!(err.contains("SHA-256"), "{err}");
    }
}
