//! Things the pet does on request only: nudging the cursor after a swat,
//! cleaning old files out of %TEMP% after the user said yes, and fetching
//! the weather when the user switched it on and gave coordinates.
use serde::Serialize;
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime},
};
use windows_sys::Win32::UI::{
    Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON},
    WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, SetCursorPos, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    },
};
static LAST_NUDGE: AtomicU64 = AtomicU64::new(0);
fn millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
/// Moves the cursor by (dx, dy) in six small steps (~90 ms), like a push.
/// Never while a mouse button is held, never more than 220 px, at most once
/// every 400 ms, always inside the virtual screen.
pub fn nudge(dx: i32, dy: i32) -> Result<(), String> {
    if dx.abs() > 220 || dy.abs() > 220 {
        return Err("too far".into());
    }
    let now = millis();
    if now.saturating_sub(LAST_NUDGE.load(Ordering::Relaxed)) < 400 {
        return Ok(());
    }
    LAST_NUDGE.store(now, Ordering::Relaxed);
    unsafe {
        let held = |vk: u16| (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0;
        if held(VK_LBUTTON) || held(VK_RBUTTON) {
            return Ok(());
        }
    }
    std::thread::spawn(move || unsafe {
        let (vx, vy) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
        let (vw, vh) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
        let mut p = std::mem::zeroed();
        if GetCursorPos(&mut p) == 0 {
            return;
        }
        let (x0, y0) = (p.x, p.y);
        // A punch: 80 % of the way in two quick frames, the rest, then a
        // short recoil back (15 %) — the cursor visibly "takes" the hit.
        const CURVE: [f64; 6] = [0.55, 0.85, 1.0, 1.0, 0.9, 0.85];
        for (i, t) in CURVE.iter().copied().enumerate() {
            let _ = i;
            let x = (x0 as f64 + dx as f64 * t).round() as i32;
            let y = (y0 as f64 + dy as f64 * t).round() as i32;
            // The user grabbed the mouse meanwhile: stop fighting them.
            if (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0 {
                return;
            }
            SetCursorPos(x.clamp(vx, vx + vw - 1), y.clamp(vy, vy + vh - 1));
            std::thread::sleep(Duration::from_millis(if t >= 1.0 { 30 } else { 12 }));
        }
    });
    Ok(())
}
#[derive(Serialize, Default)]
pub struct TempSize {
    pub bytes: u64,
    pub files: u64,
}
/// Files in %TEMP% older than a week (the Disk Cleanup default): safe to offer for cleaning.
fn walk(dir: &Path, depth: u32, cutoff: SystemTime, delete: bool, out: &mut TempSize, budget: &mut u32) {
    if depth > 8 || *budget == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let path = e.path();
        // Never follow links or junctions out of the temp folder.
        let Ok(meta) = fs::symlink_metadata(&path) else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            walk(&path, depth + 1, cutoff, delete, out, budget);
            if delete {
                // Only removes it if it became empty.
                let _ = fs::remove_dir(&path);
            }
            continue;
        }
        let old = meta.modified().map(|m| m < cutoff).unwrap_or(false);
        if !old {
            continue;
        }
        if delete {
            // Files in use stay; that is fine.
            if fs::remove_file(&path).is_ok() {
                out.bytes += meta.len();
                out.files += 1;
            }
        } else {
            out.bytes += meta.len();
            out.files += 1;
        }
    }
}
pub fn temp(delete: bool) -> TempSize {
    let dir = std::env::temp_dir();
    let cutoff = SystemTime::now() - Duration::from_secs(7 * 24 * 3600);
    let mut out = TempSize::default();
    let mut budget = 200_000u32;
    walk(&dir, 0, cutoff, delete, &mut out, &mut budget);
    out
}
#[derive(Serialize)]
pub struct Weather {
    pub code: i64,
    pub temp: f64,
}
/// Current weather from Open-Meteo (free, no key) for "lat,lon".
pub async fn weather(place: &str) -> Result<Weather, String> {
    let mut parts = place.split(',').map(|s| s.trim().parse::<f64>());
    let (Some(Ok(lat)), Some(Ok(lon))) = (parts.next(), parts.next()) else {
        return Err("Координаты в виде «55.75,37.62»".into());
    };
    if !(-90. ..=90.).contains(&lat) || !(-180. ..=180.).contains(&lon) {
        return Err("Координаты вне диапазона".into());
    }
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat:.3}&longitude={lon:.3}&current=temperature_2m,weather_code"
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let v: serde_json::Value = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Сеть недоступна")?
        .json()
        .await
        .map_err(|_| "Некорректный ответ")?;
    Ok(Weather {
        code: v.pointer("/current/weather_code").and_then(|x| x.as_i64()).unwrap_or(0),
        temp: v.pointer("/current/temperature_2m").and_then(|x| x.as_f64()).unwrap_or(15.),
    })
}

// ---------------------------------------------------------------- drunk pet
// What the drunk pet does to a real window, only when the user allowed it
// in the settings: shake it (it ends where it started), shove it a little
// (stays on its monitor), minimise it, or — separate opt-in — ask it to close
// (WM_CLOSE, so the program can still ask "save changes?").
// Never the taskbar, the desktop, our own windows, tool windows, full-screen
// windows (games) or anything not visible.
pub fn window_act(id: isize, kind: &str, dx: i32) -> Result<String, String> {
    use windows_sys::Win32::{
        Foundation::{HWND, RECT},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        System::Threading::GetCurrentProcessId,
        UI::WindowsAndMessaging::{
            GetClassNameW, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
            IsWindow, IsWindowVisible, IsZoomed, PostMessageW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
            SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SW_MINIMIZE, WM_CLOSE, WS_EX_TOOLWINDOW,
        },
    };
    let hwnd = id as HWND;
    unsafe {
        if hwnd.is_null() || IsWindow(hwnd) == 0 || IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return Err("no such window".into());
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == GetCurrentProcessId() {
            return Err("own window".into());
        }
        if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW as isize != 0 {
            return Err("tool window".into());
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), 64);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        if ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow"].contains(&class.as_str()) {
            return Err("shell window".into());
        }
        let mut r: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut r);
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        GetMonitorInfoW(mon, &mut mi);
        let m = mi.rcMonitor;
        if r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom {
            return Err("full screen".into());
        }
        let maximized = IsZoomed(hwnd) != 0;
        let flags = SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE;
        match kind {
            "shake" if !maximized => {
                let (x0, y0) = (r.left, r.top);
                let h = hwnd as isize;
                std::thread::spawn(move || {
                    let hwnd = h as HWND;
                    for i in 0..10 {
                        let d = if i % 2 == 0 { 9 } else { -9 } * (10 - i) / 10;
                        SetWindowPos(hwnd, std::ptr::null_mut(), x0 + d, y0 + d.abs() / 3, 0, 0, flags);
                        std::thread::sleep(Duration::from_millis(35));
                    }
                    SetWindowPos(hwnd, std::ptr::null_mut(), x0, y0, 0, 0, flags);
                });
                Ok("shake".into())
            }
            "shove" if !maximized => {
                let dx = dx.clamp(-160, 160);
                let w = mi.rcWork;
                // Keep at least a third of the window on the work area.
                let min_x = w.left - (r.right - r.left) * 2 / 3;
                let max_x = w.right - (r.right - r.left) / 3;
                let target = (r.left + dx).clamp(min_x, max_x);
                let (x0, y0) = (r.left, r.top);
                let h = hwnd as isize;
                std::thread::spawn(move || {
                    let hwnd = h as HWND;
                    for i in 1..=8 {
                        let t = 1. - (1. - i as f64 / 8.).powi(2);
                        let x = x0 + ((target - x0) as f64 * t).round() as i32;
                        SetWindowPos(hwnd, std::ptr::null_mut(), x, y0, 0, 0, flags);
                        std::thread::sleep(Duration::from_millis(16));
                    }
                });
                Ok("shove".into())
            }
            "shake" | "shove" => {
                // Maximised: cannot be moved without un-maximising it. Only
                // the crack on the "glass" for now; a later punch may still
                // knock it down (minimize).
                Err("maximized".into())
            }
            "minimize" => {
                ShowWindow(hwnd, SW_MINIMIZE);
                Ok("minimize".into())
            }
            "close" => {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
                Ok("close".into())
            }
            _ => Err("unknown action".into()),
        }
    }
}
