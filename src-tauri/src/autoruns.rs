// Autostart watcher: Run / RunOnce registry keys and the Startup folders.
//
// The first run takes a silent baseline. Afterwards every new or rewritten
// entry is reported to the pet, which asks whether to remove it. Nothing is
// ever removed without that click. Removal is reversible: the value (or the
// Startup shortcut) is copied to %LOCALAPPDATA%\DrizzDesktop\quarantine
// first, and "Вернуть" puts it back. Machine-wide entries (HKLM, common
// Startup) need administrator rights; for those Windows shows its own UAC
// prompt and reg.exe does the change - the pet itself never runs elevated.
use crate::{storage, trace};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Mutex},
    time::Duration,
};
use tauri::Manager;
use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, KEY_WOW64_32KEY, KEY_WOW64_64KEY, REG_EXPAND_SZ, REG_SZ},
    RegKey,
};

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// scope|name - stable identity of the entry.
    pub id: String,
    /// hkcu-run | hkcu-runonce | hklm-run | hklm-runonce | hklm32-run | startup-user | startup-common
    pub scope: String,
    pub name: String,
    /// Registry data or the shortcut/file path.
    pub command: String,
    /// Executable the entry starts (best effort).
    pub target: String,
    pub location: String,
    pub signed: Option<bool>,
    /// Can be removed without administrator rights.
    pub user: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quarantined {
    pub entry: Entry,
    pub removed: u64,
    /// "sz" | "expand" for registry values; stored copy for files.
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub file: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    baseline: HashMap<String, String>,
    #[serde(default)]
    quarantine: Vec<Quarantined>,
    #[serde(default)]
    kept: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub kind: String,
    pub entry: Entry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub entries: Vec<Entry>,
    pub quarantine: Vec<Quarantined>,
    pub pending: Vec<String>,
}

static STATE: Mutex<Option<Saved>> = Mutex::new(None);
static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUNONCE: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";

fn file() -> PathBuf {
    storage::root().join("autoruns.json")
}
fn quarantine_dir() -> PathBuf {
    storage::root().join("quarantine")
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn expand(s: &str) -> String {
    use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
    let w: Vec<u16> = s.encode_utf16().chain(Some(0)).collect();
    let mut buf = vec![0u16; 2048];
    let n = unsafe { ExpandEnvironmentStringsW(w.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
    if n == 0 || n as usize > buf.len() {
        return s.to_string();
    }
    String::from_utf16_lossy(&buf[..n as usize - 1])
}

/// Executable path from a Run command line: quoted path, or everything up to
/// the first ".exe", or the first token.
pub fn target_of(command: &str) -> String {
    let c = expand(command.trim());
    if let Some(rest) = c.strip_prefix('"') {
        return rest.split('"').next().unwrap_or("").to_string();
    }
    let lower = c.to_lowercase();
    if let Some(i) = lower.find(".exe") {
        return c[..i + 4].to_string();
    }
    c.split_whitespace().next().unwrap_or("").to_string()
}

fn describe(scope: &str, name: &str, command: &str, user: bool, cache: &mut HashMap<String, Option<bool>>) -> Entry {
    let target = if scope.starts_with("startup") { command.to_string() } else { target_of(command) };
    let is_link = target.to_lowercase().ends_with(".lnk");
    Entry {
        id: format!("{scope}|{name}"),
        scope: scope.to_string(),
        name: name.to_string(),
        command: command.to_string(),
        location: trace::location_of(&target).to_string(),
        signed: if is_link { None } else { trace::signed(&target, cache) },
        target,
        user,
    }
}

fn registry(scope: &str) -> Option<(RegKey, &'static str, u32)> {
    Some(match scope {
        "hkcu-run" => (RegKey::predef(HKEY_CURRENT_USER), RUN, KEY_WOW64_64KEY),
        "hkcu-runonce" => (RegKey::predef(HKEY_CURRENT_USER), RUNONCE, KEY_WOW64_64KEY),
        "hklm-run" => (RegKey::predef(HKEY_LOCAL_MACHINE), RUN, KEY_WOW64_64KEY),
        "hklm-runonce" => (RegKey::predef(HKEY_LOCAL_MACHINE), RUNONCE, KEY_WOW64_64KEY),
        "hklm32-run" => (RegKey::predef(HKEY_LOCAL_MACHINE), RUN, KEY_WOW64_32KEY),
        _ => return None,
    })
}
const SCOPES: [&str; 5] = ["hkcu-run", "hkcu-runonce", "hklm-run", "hklm-runonce", "hklm32-run"];

fn startup_dirs() -> Vec<(&'static str, PathBuf)> {
    let mut v = vec![];
    if let Some(a) = std::env::var_os("APPDATA") {
        v.push(("startup-user", PathBuf::from(a).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup")));
    }
    if let Some(p) = std::env::var_os("ProgramData") {
        v.push(("startup-common", PathBuf::from(p).join("Microsoft\\Windows\\Start Menu\\Programs\\StartUp")));
    }
    v
}

pub fn scan(cache: &mut HashMap<String, Option<bool>>) -> Vec<Entry> {
    let mut out = vec![];
    for scope in SCOPES {
        let Some((root, path, view)) = registry(scope) else { continue };
        let Ok(key) = root.open_subkey_with_flags(path, KEY_READ | view) else { continue };
        for (name, value) in key.enum_values().flatten() {
            if name.is_empty() {
                continue;
            }
            let data = value.to_string();
            out.push(describe(scope, &name, &data, scope.starts_with("hkcu"), cache));
        }
    }
    for (scope, dir) in startup_dirs() {
        let Ok(items) = std::fs::read_dir(&dir) else { continue };
        for item in items.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if name.eq_ignore_ascii_case("desktop.ini") || !item.path().is_file() {
                continue;
            }
            out.push(describe(scope, &name, &item.path().to_string_lossy(), scope == "startup-user", cache));
        }
    }
    out
}

/// New or changed entries compared with the baseline (pure; unit-tested).
pub fn diff(baseline: &HashMap<String, String>, now: &[Entry]) -> Vec<Change> {
    now.iter()
        .filter_map(|e| match baseline.get(&e.id) {
            None => Some(Change { kind: "added".into(), entry: e.clone() }),
            Some(c) if c != &e.command => Some(Change { kind: "changed".into(), entry: e.clone() }),
            _ => None,
        })
        .collect()
}

fn load() -> Option<Saved> {
    std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}
fn save(s: &Saved) {
    let _ = std::fs::create_dir_all(storage::root());
    if let Ok(b) = serde_json::to_vec_pretty(s) {
        let tmp = storage::root().join("autoruns.next.json");
        if std::fs::write(&tmp, b).is_ok() {
            let _ = std::fs::rename(tmp, file());
        }
    }
}

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut cache = HashMap::new();
        loop {
            let st = app.state::<storage::State>();
            if st.stop.load(Ordering::Relaxed) {
                break;
            }
            let settings = st.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
            if storage::enabled(&settings, "watchAutoruns", true) {
                let entries = scan(&mut cache);
                let mut guard = STATE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                if guard.is_none() {
                    *guard = Some(load().unwrap_or_else(|| Saved {
                        // First launch ever: everything present is the baseline.
                        baseline: entries.iter().map(|e| (e.id.clone(), e.command.clone())).collect(),
                        ..Default::default()
                    }));
                    save(guard.as_ref().unwrap());
                }
                let saved = guard.as_mut().unwrap();
                let changes = diff(&saved.baseline, &entries);
                if !changes.is_empty() {
                    for c in &changes {
                        saved.baseline.insert(c.entry.id.clone(), c.entry.command.clone());
                        if storage::diag_enabled(&settings) {
                            storage::diag("autorun", &format!("{} {} -> {}", c.kind, c.entry.id, c.entry.command));
                        }
                    }
                    // Entries that disappeared leave the baseline too, so a
                    // re-added one is reported again.
                    saved.baseline.retain(|id, _| entries.iter().any(|e| &e.id == id));
                    save(saved);
                    drop(guard);
                    let mut pending = PENDING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    for c in changes {
                        if !pending.contains(&c.entry.id) {
                            pending.push(c.entry.id.clone());
                        }
                        let _ = app.emit_all("autorun", c);
                    }
                } else {
                    let before = saved.baseline.len();
                    saved.baseline.retain(|id, _| entries.iter().any(|e| &e.id == id));
                    if saved.baseline.len() != before {
                        save(saved);
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

pub fn view() -> View {
    let mut cache = HashMap::new();
    let q = STATE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref().map(|s| s.quarantine.clone()).unwrap_or_default();
    View {
        entries: scan(&mut cache),
        quarantine: q,
        pending: PENDING.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
    }
}

pub fn keep(id: &str) {
    PENDING.lock().unwrap_or_else(std::sync::PoisonError::into_inner).retain(|p| p != id);
    if let Some(s) = STATE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut() {
        if !s.kept.iter().any(|k| k == id) {
            s.kept.push(id.to_string());
        }
        save(s);
    }
}

/// Runs reg.exe elevated (Windows shows the UAC prompt) and waits for it.
fn elevated_reg(args: &str) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{GetExitCodeProcess, WaitForSingleObject},
        UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
        UI::WindowsAndMessaging::SW_HIDE,
    };
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();
    let file: Vec<u16> = "reg.exe\0".encode_utf16().collect();
    let params: Vec<u16> = args.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut info) == 0 {
            return Err("Отменено: без прав администратора эту запись не убрать".into());
        }
        WaitForSingleObject(info.hProcess, 30_000);
        let mut code = 1u32;
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        if code == 0 { Ok(()) } else { Err(format!("reg.exe: {code}")) }
    }
}

fn reg_path(scope: &str) -> Option<(&'static str, &'static str)> {
    Some(match scope {
        "hklm-run" => ("HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/reg:64"),
        "hklm-runonce" => ("HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce", "/reg:64"),
        "hklm32-run" => ("HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/reg:32"),
        _ => return None,
    })
}
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\\\""))
}

pub fn remove(id: &str) -> Result<Entry, String> {
    let mut cache = HashMap::new();
    let entry = scan(&mut cache)
        .into_iter()
        .find(|e| e.id == id)
        .ok_or("Такой записи в автозапуске уже нет")?;
    let mut q = Quarantined { entry: entry.clone(), removed: now_ms(), kind: String::new(), file: String::new() };
    if let Some((root, path, view)) = registry(&entry.scope) {
        let key = root
            .open_subkey_with_flags(path, KEY_READ | view)
            .map_err(|e| e.to_string())?;
        let raw = key.get_raw_value(&entry.name).map_err(|e| e.to_string())?;
        q.kind = match raw.vtype {
            REG_SZ => "sz",
            REG_EXPAND_SZ => "expand",
            _ => return Err("Необычный тип значения - удалите вручную в regedit".into()),
        }
        .into();
        if entry.user {
            let w = root
                .open_subkey_with_flags(path, KEY_SET_VALUE | view)
                .map_err(|e| e.to_string())?;
            w.delete_value(&entry.name).map_err(|e| e.to_string())?;
        } else {
            let (p, v) = reg_path(&entry.scope).ok_or("unknown scope")?;
            elevated_reg(&format!("delete {} /v {} /f {v}", quote(p), quote(&entry.name)))?;
        }
    } else {
        let src = PathBuf::from(&entry.command);
        std::fs::create_dir_all(quarantine_dir()).map_err(|e| e.to_string())?;
        let dst = quarantine_dir().join(format!("{}-{}", now_ms(), entry.name));
        if std::fs::rename(&src, &dst).is_err() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
            if std::fs::remove_file(&src).is_err() {
                let _ = std::fs::remove_file(&dst);
                return Err("Нет прав убрать файл из общей папки автозагрузки".into());
            }
        }
        q.file = dst.to_string_lossy().to_string();
    }
    PENDING.lock().unwrap_or_else(std::sync::PoisonError::into_inner).retain(|p| p != id);
    if let Some(s) = STATE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut() {
        s.baseline.remove(id);
        s.quarantine.retain(|x| x.entry.id != id);
        s.quarantine.push(q);
        save(s);
    }
    Ok(entry)
}

pub fn restore(id: &str) -> Result<(), String> {
    let q = STATE
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.quarantine.iter().find(|x| x.entry.id == id).cloned())
        .ok_or("В карантине такого нет")?;
    let e = &q.entry;
    if let Some((root, path, view)) = registry(&e.scope) {
        if e.user {
            let (k, _) = root
                .create_subkey_with_flags(path, KEY_SET_VALUE | view)
                .map_err(|x| x.to_string())?;
            if q.kind == "expand" {
                k.set_raw_value(
                    &e.name,
                    &winreg::RegValue {
                        bytes: e.command.encode_utf16().chain(Some(0)).flat_map(|c| c.to_le_bytes()).collect(),
                        vtype: REG_EXPAND_SZ,
                    },
                )
            } else {
                k.set_value(&e.name, &e.command)
            }
            .map_err(|x| x.to_string())?;
        } else {
            let (p, v) = reg_path(&e.scope).ok_or("unknown scope")?;
            let t = if q.kind == "expand" { "REG_EXPAND_SZ" } else { "REG_SZ" };
            elevated_reg(&format!("add {} /v {} /t {t} /d {} /f {v}", quote(p), quote(&e.name), quote(&e.command)))?;
        }
    } else {
        let back = Path::new(&e.command);
        if back.exists() {
            return Err("На старом месте уже есть файл с таким именем".into());
        }
        std::fs::rename(&q.file, back)
            .or_else(|_| std::fs::copy(&q.file, back).map(|_| ()).and_then(|_| std::fs::remove_file(&q.file)))
            .map_err(|x| x.to_string())?;
    }
    if let Some(s) = STATE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_mut() {
        s.quarantine.retain(|x| x.entry.id != id);
        // Restored on purpose: accept it silently.
        s.baseline.insert(e.id.clone(), e.command.clone());
        save(s);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(id: &str, command: &str) -> Entry {
        Entry {
            id: id.into(),
            scope: "hkcu-run".into(),
            name: id.into(),
            command: command.into(),
            target: String::new(),
            location: "other".into(),
            signed: None,
            user: true,
        }
    }
    #[test]
    fn targets() {
        assert_eq!(target_of("\"C:\\Program Files\\A B\\a.exe\" --min"), "C:\\Program Files\\A B\\a.exe");
        assert_eq!(target_of("C:\\Tools\\x.EXE /s"), "C:\\Tools\\x.EXE");
        assert!(target_of("%SystemRoot%\\system32\\cmd.exe /c x").to_lowercase().ends_with("\\system32\\cmd.exe"));
        assert!(!target_of("%SystemRoot%\\x.exe").contains('%'));
    }
    #[test]
    fn diffs() {
        let base: HashMap<String, String> = [("a".to_string(), "1".to_string()), ("b".to_string(), "2".to_string())].into();
        let now = vec![entry("a", "1"), entry("b", "3"), entry("c", "4")];
        let d = diff(&base, &now);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].kind.as_str(), d[0].entry.id.as_str()), ("changed", "b"));
        assert_eq!((d[1].kind.as_str(), d[1].entry.id.as_str()), ("added", "c"));
    }
}
