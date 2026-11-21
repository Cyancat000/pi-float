use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{Manager, WebviewWindow};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pid: u32,
    cwd: String,
    session_id: String,
    port: u16,
    started_at: String,
    token: String,
}

fn read_registry(path: &Path) -> io::Result<Vec<Terminal>> {
    match fs::read(path) {
        Ok(data) => {
            let rows: Vec<serde_json::Value> = serde_json::from_slice(&data)?;
            Ok(rows
                .into_iter()
                .filter_map(|row| serde_json::from_value::<Terminal>(row).ok())
                .filter(|row| {
                    row.pid != 0
                        && row.port != 0
                        && row.token.len() == 64
                        && row
                            .token
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
                .collect())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn prune(rows: &mut Vec<Terminal>) -> bool {
    if rows.is_empty() {
        return false;
    }
    let pids: Vec<_> = rows.iter().map(|row| Pid::from_u32(row.pid)).collect();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    let len = rows.len();
    rows.retain(|row| {
        system
            .process(Pid::from_u32(row.pid))
            .is_some_and(|process| process.status() != sysinfo::ProcessStatus::Zombie)
    });
    rows.len() != len
}

struct RegistryLock(PathBuf);
impl Drop for RegistryLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}

fn lock_registry(path: PathBuf) -> Option<RegistryLock> {
    let acquire = || fs::create_dir(&path).is_ok();
    if acquire() {
        return Some(RegistryLock(path));
    }
    let old = fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age > Duration::from_secs(30));
    if old && fs::remove_dir(&path).is_ok() && acquire() {
        Some(RegistryLock(path))
    } else {
        None
    }
}

fn terminals(dir: &Path) -> io::Result<Vec<Terminal>> {
    let path = dir.join("sessions.json");
    let mut rows = read_registry(&path)?;
    if !prune(&mut rows) {
        return Ok(rows);
    }
    // Re-read under the same lock as the extension so a concurrently starting Pi isn't lost.
    let Some(_lock) = lock_registry(dir.join("sessions.lock")) else {
        return Ok(rows);
    };
    rows = read_registry(&path)?;
    if prune(&mut rows) {
        let temp = dir.join(format!("desktop-{}.tmp", std::process::id()));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            serde_json::to_writer_pretty(&mut file, &rows)?;
            file.write_all(b"\n")?;
            drop(file);
            fs::rename(&temp, &path)
        })();
        let _ = fs::remove_file(&temp);
        result?;
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_dead_pids_without_losing_live_entries() {
        let dir =
            std::env::temp_dir().join(format!("pi-float-registry-test-{}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        let entry = |pid, port| Terminal {
            pid,
            port,
            cwd: "workspace".into(),
            session_id: "test-id".into(),
            started_at: "2026-01-01T00:00:00Z".into(),
            token: "a".repeat(64),
        };
        let path = dir.join("sessions.json");
        fs::write(
            &path,
            serde_json::to_vec(&[entry(std::process::id(), 8000), entry(u32::MAX, 8001)]).unwrap(),
        )
        .unwrap();
        let listed = terminals(&dir);
        let saved = read_registry(&path);
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(
            listed
                .unwrap()
                .iter()
                .map(|row| row.port)
                .collect::<Vec<_>>(),
            [8000]
        );
        assert_eq!(
            saved
                .unwrap()
                .iter()
                .map(|row| row.port)
                .collect::<Vec<_>>(),
            [8000]
        );
    }
}

#[tauri::command]
pub async fn terminal_sessions(window: WebviewWindow) -> Result<Vec<Terminal>, String> {
    if window.label() != "main" {
        return Err("仅主窗可发现终端会话".to_owned());
    }
    let dir = window
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".pi-float");
    tauri::async_runtime::spawn_blocking(move || terminals(&dir))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}
