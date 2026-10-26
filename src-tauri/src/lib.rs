//! Signal Desk — cœur natif (Tauri).
//!
//! Expose à l'interface un ensemble restreint de commandes : accès SQLite
//! paramétré, fichiers confinés au dossier de données, sauvegardes et
//! conversion DOCX. Aucune donnée n'est envoyée sur le réseau par ce module.

pub mod backup;
pub mod convert;
pub mod db;
pub mod files;

use base64::Engine;
use serde_json::{Map, Value as Json};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub const DB_FILE: &str = "signal-desk.sqlite";

pub struct AppState {
    pub db: Mutex<db::Database>,
    pub data_dir: PathBuf,
}

impl AppState {
    fn files_root(&self) -> PathBuf {
        self.data_dir.join(files::FILES_DIR)
    }
}

type CmdResult<T> = Result<T, String>;

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

#[derive(serde::Serialize)]
struct AppInfo {
    data_dir: String,
    files_dir: String,
    db_path: String,
    default_backup_dir: String,
    version: String,
    os: String,
}

#[tauri::command]
fn app_info(state: tauri::State<AppState>, app: tauri::AppHandle) -> AppInfo {
    let default_backup_dir = app
        .path()
        .document_dir()
        .map(|d| d.join("Signal Desk").join("Sauvegardes"))
        .unwrap_or_else(|_| state.data_dir.join("sauvegardes"));
    AppInfo {
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        files_dir: state.files_root().to_string_lossy().into_owned(),
        db_path: state.data_dir.join(DB_FILE).to_string_lossy().into_owned(),
        default_backup_dir: default_backup_dir.to_string_lossy().into_owned(),
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
    }
}

#[tauri::command]
fn db_select(state: tauri::State<AppState>, sql: String, params: Vec<Json>) -> CmdResult<Vec<Map<String, Json>>> {
    state.db.lock().map_err(|e| e.to_string())?.select(&sql, &params)
}

#[tauri::command]
fn db_execute(state: tauri::State<AppState>, sql: String, params: Vec<Json>) -> CmdResult<db::ExecResult> {
    state.db.lock().map_err(|e| e.to_string())?.execute(&sql, &params)
}

#[tauri::command]
fn db_batch(state: tauri::State<AppState>, sql: String) -> CmdResult<()> {
    state.db.lock().map_err(|e| e.to_string())?.execute_batch(&sql)
}

#[tauri::command]
fn file_write(state: tauri::State<AppState>, rel: String, data_b64: String) -> CmdResult<u64> {
    let data = b64().decode(data_b64).map_err(|e| e.to_string())?;
    files::write_file(&state.files_root(), &rel, &data)
}

#[tauri::command]
fn file_read(state: tauri::State<AppState>, rel: String) -> CmdResult<String> {
    Ok(b64().encode(files::read_file(&state.files_root(), &rel)?))
}

#[tauri::command]
fn file_exists(state: tauri::State<AppState>, rel: String) -> CmdResult<bool> {
    Ok(files::safe_join(&state.files_root(), &rel)?.exists())
}

#[tauri::command]
fn file_abs_path(state: tauri::State<AppState>, rel: String) -> CmdResult<String> {
    Ok(files::safe_join(&state.files_root(), &rel)?.to_string_lossy().into_owned())
}

/// Supprime un fichier géré. L'interface ne l'utilise que pour des fichiers
/// temporaires ou non rattachés à un document émis.
#[tauri::command]
fn file_delete(state: tauri::State<AppState>, rel: String) -> CmdResult<()> {
    let p = files::safe_join(&state.files_root(), &rel)?;
    if p.is_file() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lit un fichier choisi par l'utilisateur via la boîte de dialogue système.
#[tauri::command]
fn external_read(path: String) -> CmdResult<String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Fichier inaccessible : {e}"))?;
    if meta.len() > 200 * 1024 * 1024 {
        return Err("Fichier trop volumineux (200 Mo maximum)".into());
    }
    Ok(b64().encode(std::fs::read(&path).map_err(|e| e.to_string())?))
}

/// Écrit un fichier à l'emplacement choisi par l'utilisateur (boîte « Enregistrer sous »,
/// qui demande elle-même confirmation avant de remplacer un fichier existant).
#[tauri::command]
fn external_write(path: String, data_b64: String) -> CmdResult<()> {
    let data = b64().decode(data_b64).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| format!("Enregistrement impossible : {e}"))
}

#[tauri::command]
fn backup_create(
    state: tauri::State<AppState>,
    dest_dir: String,
    passphrase: Option<String>,
    label: String,
) -> CmdResult<backup::BackupInfo> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    backup::create_backup(db.conn()?, &state.data_dir, Path::new(&dest_dir), passphrase.as_deref(), env!("CARGO_PKG_VERSION"), &label)
}

#[tauri::command]
fn backup_verify(state: tauri::State<AppState>, path: String, passphrase: Option<String>) -> backup::VerifyReport {
    backup::verify_backup(Path::new(&path), passphrase.as_deref(), &state.data_dir.join("tmp"))
}

#[tauri::command]
fn backup_list(dir: String) -> CmdResult<Vec<backup::BackupListItem>> {
    backup::list_backups(Path::new(&dir))
}

#[derive(serde::Serialize)]
struct RestoreResult {
    safety_backup: String,
    previous_data_dir: String,
}

#[tauri::command]
fn backup_restore(state: tauri::State<AppState>, path: String, passphrase: Option<String>) -> CmdResult<RestoreResult> {
    // Vérification préalable complète, avant toute modification.
    let report = backup::verify_backup(Path::new(&path), passphrase.as_deref(), &state.data_dir.join("tmp"));
    if !report.ok {
        return Err(format!("Sauvegarde invalide : {}", report.errors.join(" ; ")));
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    // Sauvegarde de sécurité de l'état actuel.
    let safety = backup::create_backup(
        db.conn()?,
        &state.data_dir,
        &state.data_dir.join("sauvegardes-auto"),
        None,
        env!("CARGO_PKG_VERSION"),
        "avant-restauration",
    )?;
    db.close()?;
    let result = backup::restore_backup(Path::new(&path), passphrase.as_deref(), &state.data_dir, DB_FILE);
    let reopen = db.reopen();
    let previous = result?;
    reopen?;
    Ok(RestoreResult { safety_backup: safety.path, previous_data_dir: previous.to_string_lossy().into_owned() })
}

#[tauri::command]
fn converters_detect() -> convert::ConverterInfo {
    convert::detect()
}

#[tauri::command]
async fn docx_to_pdf(state: tauri::State<'_, AppState>, docx_b64: String) -> CmdResult<String> {
    let data = b64().decode(docx_b64).map_err(|e| e.to_string())?;
    let work = state.data_dir.join("tmp").join(format!("conv-{}", chrono::Local::now().format("%Y%m%d%H%M%S%f")));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let input = work.join("document.docx");
    std::fs::write(&input, data).map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let r = convert::docx_to_pdf(&input, &work);
        let _ = std::fs::remove_dir_all(&work);
        r
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(b64().encode(result?))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("dossier de données introuvable");
            std::fs::create_dir_all(data_dir.join(files::FILES_DIR))?;
            let database = db::Database::open(data_dir.join(DB_FILE)).map_err(std::io::Error::other)?;
            app.manage(AppState { db: Mutex::new(database), data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            db_select,
            db_execute,
            db_batch,
            file_write,
            file_read,
            file_exists,
            file_abs_path,
            file_delete,
            external_read,
            external_write,
            backup_create,
            backup_verify,
            backup_list,
            backup_restore,
            converters_detect,
            docx_to_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Signal Desk");
}
