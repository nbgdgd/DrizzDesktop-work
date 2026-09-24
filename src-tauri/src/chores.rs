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
        for i in 1..=6 {
            // Ease-out: most of the push in the first steps.
            let t = 1. - (1. - i as f64 / 6.).powi(2);
            let x = (x0 as f64 + dx as f64 * t).round() as i32;
            let y = (y0 as f64 + dy as f64 * t).round() as i32;
            // The user grabbed the mouse meanwhile: stop fighting them.
            if (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0 {
                return;
            }
            SetCursorPos(x.clamp(vx, vx + vw - 1), y.clamp(vy, vy + vh - 1));
            std::thread::sleep(Duration::from_millis(15));
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
