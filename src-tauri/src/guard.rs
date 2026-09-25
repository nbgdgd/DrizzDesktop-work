// Ear guard (ideas from EarGuard-style volume spike protectors): a hard
// volume ceiling while headphones are on, checked every 15 ms, so a spike
// (an app or a DAC jumping to 100 %) is cut back almost at once; and a safe
// volume applied when headphones are plugged in or the PC wakes from sleep.
// Works on the default output's master volume, i.e. the Windows slider.
// Settings (percent): earsGuard, earsCeiling, earsSafe, earsDevice; at night
// (from lateHour to 6:00) the ceiling drops to earsNightCeiling (earsNight).
use crate::{env, storage::{enabled, State}};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::Manager;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::System::Com::CLSCTX_ALL;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardEvent {
    /// "clamp" (a spike was cut), "plug" (headphones in), "wake" (after sleep),
    /// "spike" (a loud moment in the content was ducked, tap.rs).
    pub kind: &'static str,
    /// Volume before and after, percent.
    pub from: u32,
    pub to: u32,
}

#[derive(Clone, Copy, PartialEq)]
struct Config {
    on: bool,
    ceiling: f32,
    safe: f32,
    always: bool,
    /// Lower ceiling at night, 0 = off; the hour night starts.
    night: f32,
    late: u16,
}
fn config(s: &Value) -> Config {
    let pct = |k: &str, d: f64| (s.get(k).and_then(Value::as_f64).unwrap_or(d).clamp(0., 100.) / 100.) as f32;
    Config {
        on: enabled(s, "ears", true) && enabled(s, "earsGuard", false),
        ceiling: pct("earsCeiling", 60.).max(0.05),
        safe: pct("earsSafe", 20.),
        always: s.get("earsDevice").and_then(Value::as_str) == Some("always"),
        night: if enabled(s, "earsNight", true) { pct("earsNightCeiling", 40.).max(0.05) } else { 0. },
        late: s.get("lateHour").and_then(Value::as_u64).unwrap_or(23).min(23) as u16,
    }
}
/// Night from `late` to 6 in the morning.
pub fn is_night(hour: u16, late: u16) -> bool {
    hour >= late || hour < 6
}
fn local_hour() -> u16 {
    let mut t = unsafe { std::mem::zeroed::<windows_sys::Win32::Foundation::SYSTEMTIME>() };
    unsafe { windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut t) };
    t.wHour
}
/// The ceiling in force now and whether it is the night one.
fn ceiling(c: &Config, hour: u16) -> (f32, bool) {
    if c.night > 0. && c.night < c.ceiling && is_night(hour, c.late) {
        (c.night, true)
    } else {
        (c.ceiling, false)
    }
}

struct Device {
    id: String,
    volume: IAudioEndpointVolume,
    headphones: bool,
}
fn open() -> Option<Device> {
    let d = env::default_device()?;
    let volume: IAudioEndpointVolume = unsafe { d.Activate(CLSCTX_ALL, None).ok()? };
    Some(Device { id: env::device_id(&d), headphones: env::ears_device(&d).1, volume })
}
fn level(v: &IAudioEndpointVolume) -> Option<f32> {
    unsafe { v.GetMasterVolumeLevelScalar().ok() }
}
fn set(v: &IAudioEndpointVolume, x: f32) {
    unsafe {
        let _ = v.SetMasterVolumeLevelScalar(x, std::ptr::null());
    }
}
fn pct(x: f32) -> u32 {
    (x * 100.).round() as u32
}

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        env::init();
        let mut dev: Option<Device> = None;
        let mut cfg: Option<Config> = None;
        let mut checked = Instant::now() - Duration::from_secs(10);
        let mut tick = Instant::now();
        let mut last_note = Instant::now() - Duration::from_secs(60);
        let mut first = true;
        let mut hour = local_hour();
        while !app.state::<State>().stop.load(Ordering::Relaxed) {
            // Off (or no headphones to guard): look at the settings once a
            // second instead of waking 66 times a second for nothing.
            let idle = !cfg.is_some_and(|c| c.on) || !dev.as_ref().is_some_and(|d| d.headphones || cfg.is_some_and(|c| c.always));
            std::thread::sleep(Duration::from_millis(if idle { 1000 } else { 15 }));
            // A long gap between two ticks = the PC was asleep.
            let woke = tick.elapsed() > Duration::from_secs(8);
            tick = Instant::now();
            // Settings and the device once a second (enumeration is not free).
            if checked.elapsed() >= Duration::from_secs(1) || woke {
                checked = Instant::now();
                hour = local_hour();
                let s = app.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
                let c = config(&s);
                cfg = Some(c);
                if !c.on {
                    dev = None;
                    first = true;
                    continue;
                }
                let before = dev.as_ref().map(|d| (d.id.clone(), d.headphones));
                dev = open();
                let now_on = dev.as_ref().is_some_and(|d| d.headphones);
                let plugged = !first && now_on && before.as_ref().map_or(true, |(id, hp)| !hp || dev.as_ref().is_some_and(|d| &d.id != id));
                first = false;
                if let (Some(d), true) = (dev.as_ref(), (plugged || woke) && (now_on || c.always) && c.safe > 0.) {
                    if let Some(x) = level(&d.volume) {
                        if x > c.safe + 0.005 {
                            set(&d.volume, c.safe);
                            notify(&app, GuardEvent { kind: if woke { "wake" } else { "plug" }, from: pct(x), to: pct(c.safe) });
                        }
                    }
                }
            }
            let (Some(c), Some(d)) = (cfg, dev.as_ref()) else { continue };
            if !c.on || !(d.headphones || c.always) {
                continue;
            }
            let Some(x) = level(&d.volume) else {
                dev = None;
                continue;
            };
            let (top, night) = ceiling(&c, hour);
            if x > top + 0.005 {
                set(&d.volume, top);
                // One line per burst, not one per tick while an app keeps pushing.
                if last_note.elapsed() > Duration::from_secs(4) {
                    last_note = Instant::now();
                    notify(&app, GuardEvent { kind: if night { "night" } else { "clamp" }, from: pct(x), to: pct(top) });
                }
            }
        }
    });
}
fn notify(app: &tauri::AppHandle, e: GuardEvent) {
    if let Some(w) = app.get_window("pet") {
        let _ = w.emit("ear-guard", e);
    }
}

/// The "check" button: pushes the volume 2 % over the ceiling and reports
/// whether and how fast the guard pulled it back (milliseconds).
#[tauri::command]
pub fn ear_guard_test(state: tauri::State<State>) -> Result<u32, String> {
    let c = config(&state.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings);
    if !c.on {
        return Err("off".into());
    }
    env::init();
    let d = open().ok_or("No audio output")?;
    if !(d.headphones || c.always) {
        return Err("no headphones".into());
    }
    let before = level(&d.volume).unwrap_or(c.ceiling).min(c.ceiling);
    let t = Instant::now();
    set(&d.volume, (c.ceiling + 0.02).min(1.));
    while t.elapsed() < Duration::from_millis(600) {
        std::thread::sleep(Duration::from_millis(2));
        if level(&d.volume).is_some_and(|x| x <= c.ceiling + 0.005) {
            let ms = t.elapsed().as_millis() as u32;
            set(&d.volume, before);
            return Ok(ms.max(1));
        }
    }
    set(&d.volume, before);
    Err("not clamped".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn night_ceiling_from_late_hour_to_six() {
        let c = config(&serde_json::json!({ "earsGuard": true, "earsCeiling": 70, "earsNightCeiling": 40, "lateHour": 23 }));
        assert_eq!(ceiling(&c, 22), (0.7, false));
        assert_eq!(ceiling(&c, 23), (0.4, true));
        assert_eq!(ceiling(&c, 3), (0.4, true));
        assert_eq!(ceiling(&c, 6), (0.7, false));
        // Off, or a night ceiling above the day one: the day one.
        let off = config(&serde_json::json!({ "earsGuard": true, "earsCeiling": 70, "earsNight": false }));
        assert_eq!(ceiling(&off, 1), (0.7, false));
        let high = config(&serde_json::json!({ "earsGuard": true, "earsCeiling": 30, "earsNightCeiling": 40 }));
        assert_eq!(ceiling(&high, 1), (0.3, false));
    }
}
