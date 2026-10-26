//! Accès SQLite local.
//!
//! Une seule connexion, protégée par un mutex : l'application est mono-utilisateur
//! et toutes les opérations passent par ce point unique. Les requêtes sont
//! toujours paramétrées (aucune concaténation de valeurs dans le SQL).

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde_json::{Map, Number, Value as Json};
use std::path::{Path, PathBuf};

pub struct Database {
    pub path: PathBuf,
    conn: Option<Connection>,
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct ExecResult {
    pub changes: usize,
    pub last_insert_id: i64,
}

pub fn open_connection(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Impossible d'ouvrir la base de données : {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn json_to_value(v: &Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                return Err("Nombre non représentable".into());
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(_) | Json::Object(_) => Value::Text(v.to_string()),
    })
}

fn value_to_json(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            use base64::Engine;
            Json::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = open_connection(&path)?;
        Ok(Self { path, conn: Some(conn) })
    }

    pub fn conn(&self) -> Result<&Connection, String> {
        self.conn.as_ref().ok_or_else(|| "La base de données est fermée (restauration en cours ?)".to_string())
    }

    /// Ferme la connexion (checkpoint WAL inclus) — utilisé avant une restauration.
    pub fn close(&mut self) -> Result<(), String> {
        if let Some(conn) = self.conn.take() {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            conn.close().map_err(|(_, e)| e.to_string())?;
        }
        Ok(())
    }

    pub fn reopen(&mut self) -> Result<(), String> {
        self.close()?;
        self.conn = Some(open_connection(&self.path)?);
        Ok(())
    }

    pub fn select(&self, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
        let conn = self.conn()?;
        let values = params.iter().map(json_to_value).collect::<Result<Vec<_>, _>>()?;
        let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params_from_iter(values.iter())).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut map = Map::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                let v = row.get_ref(i).map_err(|e| e.to_string())?;
                map.insert(name.clone(), value_to_json(v));
            }
            out.push(map);
        }
        Ok(out)
    }

    pub fn execute(&self, sql: &str, params: &[Json]) -> Result<ExecResult, String> {
        let conn = self.conn()?;
        let values = params.iter().map(json_to_value).collect::<Result<Vec<_>, _>>()?;
        let mut stmt = conn.prepare_cached(sql).map_err(|e| e.to_string())?;
        let changes = stmt.execute(params_from_iter(values.iter())).map_err(|e| e.to_string())?;
        Ok(ExecResult { changes, last_insert_id: conn.last_insert_rowid() })
    }

    /// Exécute un script SQL complet (migrations). Pas de paramètres.
    pub fn execute_batch(&self, sql: &str) -> Result<(), String> {
        self.conn()?.execute_batch(sql).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn select_and_execute_with_parameters() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("t.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, amount INTEGER, rate REAL);").unwrap();
        let r = db
            .execute("INSERT INTO t (name, amount, rate) VALUES (?, ?, ?)", &[json!("Robert'); DROP TABLE t;--"), json!(12345), json!(0.2)])
            .unwrap();
        assert_eq!(r.changes, 1);
        assert_eq!(r.last_insert_id, 1);
        let rows = db.select("SELECT * FROM t WHERE amount = ?", &[json!(12345)]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], json!("Robert'); DROP TABLE t;--"));
        assert_eq!(rows[0]["rate"], json!(0.2));
    }

    #[test]
    fn transactions_rollback() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("t.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);").unwrap();
        db.execute_batch("BEGIN IMMEDIATE").unwrap();
        db.execute("INSERT INTO t (v) VALUES (?)", &[json!("a")]).unwrap();
        db.execute_batch("ROLLBACK").unwrap();
        assert!(db.select("SELECT * FROM t", &[]).unwrap().is_empty());
    }

    #[test]
    fn data_persists_after_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.sqlite");
        {
            let db = Database::open(path.clone()).unwrap();
            db.execute_batch("CREATE TABLE t (v TEXT);").unwrap();
            db.execute("INSERT INTO t VALUES (?)", &[json!("persisté")]).unwrap();
        }
        let mut db = Database::open(path).unwrap();
        db.reopen().unwrap();
        let rows = db.select("SELECT v FROM t", &[]).unwrap();
        assert_eq!(rows[0]["v"], json!("persisté"));
    }
}
