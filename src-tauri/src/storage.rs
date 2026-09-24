use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};

#[derive(Clone, Serialize, Deserialize)]
pub struct Store {
    pub settings: Value,
    pub memory: Value,
    #[serde(default = "empty_object")]
    pub game: Value,
    pub token: String,
    #[serde(default, rename = "hasKey")]
    pub has_key: bool,
}
pub struct State {
    pub store: Mutex<Store>,
    pub support: std::sync::atomic::AtomicIsize,
    pub hidden: std::sync::atomic::AtomicBool,
    pub visible: std::sync::atomic::AtomicBool,
    pub stop: std::sync::atomic::AtomicBool,
}
fn empty_object() -> Value {
    json!({})
}
/// Where state, usage and the diagnostic log live.
///
/// Portable mode: a file or folder named `portable` next to the executable
/// (or `--portable` on the command line) moves everything into `data` beside
/// the EXE, so the whole thing can live on a stick and leave nothing behind.
pub fn root() -> PathBuf {
    if let Some(dir) = portable_root() {
        return dir;
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("DrizzDesktop")
}
fn portable_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let asked = std::env::args().any(|a| a == "--portable")
        || dir.join("portable").exists()
        || dir.join("portable.txt").exists();
    if !asked {
        return None;
    }
    let data = dir.join("data");
    // A read-only location (an installer directory, a locked stick) must not
    // take the whole app down: fall back to the normal per-user folder.
    fs::create_dir_all(&data).ok()?;
    Some(data)
}
/// Tolerant parse: a file written by an older version, with a missing key or
/// a mangled string, keeps every field that is still readable instead of
/// being replaced by defaults. Only a completely unreadable file is skipped.
fn parse_store(bytes: &[u8]) -> Option<Store> {
    let text = String::from_utf8_lossy(bytes);
    let v: Value = serde_json::from_str(&text).ok()?;
    let obj = v.as_object()?;
    let field = |k: &str| obj.get(k).filter(|x| x.is_object()).cloned().unwrap_or(json!({}));
    Some(Store {
        settings: field("settings"),
        memory: field("memory"),
        game: field("game"),
        token: obj
            .get("token")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty() && t.len() <= 128)
            .map(str::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        has_key: false,
    })
}
pub fn load() -> Store {
    let path = root().join("state.json");
    let backup = root().join("state.backup.json");
    let primary = fs::read(&path).ok();
    let mut s = primary
        .as_deref()
        .and_then(parse_store)
        .or_else(|| fs::read(&backup).ok().as_deref().and_then(parse_store))
        .unwrap_or_else(|| {
            // Keep the unreadable file for manual recovery before it is replaced.
            if primary.is_some() {
                let _ = fs::copy(&path, root().join("state.corrupt.json"));
            }
            Store {
                settings: json!({}),
                memory: json!({}),
                game: json!({}),
                token: uuid::Uuid::new_v4().to_string(),
                has_key: false,
            }
        });
    s.has_key = root().join("credential.bin").exists();
    s
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_readable_fields_of_an_old_or_partial_file() {
        let s = parse_store(br#"{"settings":{"pet":"claude","size":140},"memory":{"facts":["a"]},"token":"t1"}"#).unwrap();
        assert_eq!(s.settings["pet"], "claude");
        assert_eq!(s.memory["facts"][0], "a");
        assert_eq!(s.token, "t1");
        let s = parse_store(br#"{"settings":{"pet":"drizz"}}"#).unwrap();
        assert_eq!(s.settings["pet"], "drizz");
        assert!(s.memory.is_object());
        assert!(!s.token.is_empty());
        let mut mangled = br#"{"settings":{"pet":"drizz"},"memory":{"address":"XX"}}"#.to_vec();
        let at = mangled.iter().position(|b| *b == b'X').unwrap();
        mangled[at] = 0xff;
        mangled[at + 1] = 0xfe;
        let s = parse_store(&mangled).unwrap();
        assert_eq!(s.settings["pet"], "drizz");
        assert!(parse_store(b"not json").is_none());
        assert!(parse_store(b"[1,2]").is_none());
    }
}
pub fn persist(s: &Store) -> Result<(), String> {
    fs::create_dir_all(root()).map_err(|e| e.to_string())?;
    let path = root().join("state.json");
    let tmp = root().join("state.next.json");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // A deleted personal fact must not survive in the recovery copy.
    fs::copy(&tmp, root().join("state.backup.json")).map_err(|e| e.to_string())?;
    unsafe {
        use windows_sys::Win32::Storage::FileSystem::*;
        if MoveFileExW(
            wide(&tmp).as_ptr(),
            wide(&path).as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
fn wide(p: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    p.as_os_str().encode_wide().chain(Some(0)).collect()
}
pub fn enabled(v: &Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(default)
}
pub fn autostart(enable: bool) -> Result<(), String> {
    use winreg::{enums::*, RegKey};
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_SET_VALUE,
        )
        .map_err(|e| e.to_string())?;
    if enable {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(
            "DrizzDesktop",
            &format!("\"{}\" --background", exe.display()),
        )
        .map_err(|e| e.to_string())?
    } else {
        match key.delete_value("DrizzDesktop") {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

pub fn key_write(key: &str) -> Result<(), String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    fs::create_dir_all(root()).map_err(|e| e.to_string())?;
    if key.is_empty() {
        if root().join("credential.bin").exists() {
            fs::remove_file(root().join("credential.bin")).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let bytes = key.as_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    unsafe {
        if CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        ) == 0
        {
            return Err("Windows не смог защитить ключ".into());
        }
        let result = fs::write(
            root().join("credential.bin"),
            std::slice::from_raw_parts(output.pbData, output.cbData as usize),
        )
        .map_err(|e| e.to_string());
        LocalFree(output.pbData as _);
        result
    }
}
pub fn key_read() -> Result<String, String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let mut bytes = fs::read(root().join("credential.bin")).map_err(|_| "Ключ не задан")?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_mut_ptr(),
    };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    unsafe {
        if CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        ) == 0
        {
            return Err("Не удалось прочитать ключ этого пользователя Windows".into());
        }
        let result = String::from_utf8(
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec(),
        )
        .map_err(|_| "Повреждён ключ".to_string());
        LocalFree(output.pbData as _);
        result
    }
}

// Opt-in diagnostic log (settings "diagnostics" or the --diag flag).
// Appends one line per call and rotates at 1 MB so it never grows unbounded.
static DIAG_FLAG: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn diag_flag(on: bool) {
    DIAG_FLAG.store(on, std::sync::atomic::Ordering::Relaxed);
}
pub fn diag_enabled(settings: &Value) -> bool {
    DIAG_FLAG.load(std::sync::atomic::Ordering::Relaxed) || enabled(settings, "diagnostics", false)
}
pub fn diag_path() -> PathBuf {
    root().join("diagnostic.log")
}
pub fn diag(source: &str, line: &str) {
    use std::io::Write;
    let path = diag_path();
    if fs::create_dir_all(root()).is_err() {
        return;
    }
    if fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = fs::rename(&path, root().join("diagnostic.1.log"));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let stamp = {
        // Local wall-clock time without an extra dependency: use the Win32 conversion.
        let mut st: windows_sys::Win32::Foundation::SYSTEMTIME = unsafe { std::mem::zeroed() };
        unsafe { windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut st) };
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
            st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, now.subsec_millis()
        )
    };
    // One formatted buffer and one write under a lock: several threads log
    // (main, hook, observer) and partial lines must not interleave.
    static WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let text = format!("{stamp} [{source}] {}
", line.chars().take(2000).collect::<String>());
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(text.as_bytes());
    }
}
