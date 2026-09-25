// Headphones as a thing, not a flag: which ones are on (by name), their
// Bluetooth battery, pausing the player when they come off (the sound would
// go on out of the speakers), and per-headphone profiles: settings saved
// for one pair ("soundcore Space 2": ceiling 50 %, balance, max level) are
// put back by themselves when that pair is the output again.
// Settings: earsPause (default on), earsProfiles { name: { earsCeiling,
// earsSafe, earsMax, balance } }.
use crate::{env, storage::{self, enabled, State}};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDevicePropertyW, DIGCF_ALLCLASSES,
    DIGCF_PRESENT, SP_DEVINFO_DATA,
};
use windows_sys::Win32::Devices::Properties::{DEVPROPKEY, DEVPROP_TYPE_BYTE, DEVPROP_TYPE_STRING};

#[derive(Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Headset {
    /// The output as people call it: "soundcore Space 2" (the part in
    /// brackets of "Headphones (soundcore Space 2)"); "" when unknown.
    pub name: String,
    pub headphones: bool,
    /// Bluetooth battery, percent; -1 when the headphones do not report it.
    pub battery: i32,
}
static CURRENT: Mutex<Option<Headset>> = Mutex::new(None);

#[tauri::command]
pub fn headset() -> Headset {
    CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone().unwrap_or(Headset { battery: -1, ..Default::default() })
}

/// "Headphones (soundcore Space 2)" -> "soundcore Space 2".
pub fn short_name(endpoint: &str) -> String {
    let t = endpoint.trim();
    match (t.find('('), t.rfind(')')) {
        (Some(a), Some(b)) if b > a + 1 => t[a + 1..b].trim().to_string(),
        _ => t.to_string(),
    }
}
/// Device names match loosely: case, spaces, "Hands-Free" and "Stereo" suffixes.
pub fn same_device(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.to_lowercase()
            .replace("hands-free", "")
            .replace("stereo", "")
            .replace(" ag audio", "")
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
    };
    let (a, b) = (norm(a), norm(b));
    a.len() >= 3 && b.len() >= 3 && (a.contains(&b) || b.contains(&a))
}

const FRIENDLY: DEVPROPKEY = DEVPROPKEY {
    fmtid: windows_sys::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};
/// DEVPKEY_Bluetooth_Battery: what the Settings app shows next to the device.
const BATTERY: DEVPROPKEY = DEVPROPKEY {
    fmtid: windows_sys::core::GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5),
    pid: 2,
};
/// Every present device that reports a battery: (name, percent).
fn batteries() -> Vec<(String, i32)> {
    let mut out = vec![];
    unsafe {
        let set = SetupDiGetClassDevsW(std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), DIGCF_PRESENT | DIGCF_ALLCLASSES);
        if set == -1 {
            return out;
        }
        let mut i = 0;
        loop {
            let mut info: SP_DEVINFO_DATA = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SP_DEVINFO_DATA>() as u32;
            if SetupDiEnumDeviceInfo(set, i, &mut info) == 0 || i > 4000 {
                break;
            }
            i += 1;
            let (mut kind, mut level, mut size) = (0u32, 0u8, 0u32);
            if SetupDiGetDevicePropertyW(set, &info, &BATTERY, &mut kind, &mut level, 1, &mut size, 0) == 0 || kind != DEVPROP_TYPE_BYTE {
                continue;
            }
            let mut name = [0u16; 256];
            let got = SetupDiGetDevicePropertyW(set, &info, &FRIENDLY, &mut kind, name.as_mut_ptr() as *mut u8, 512, &mut size, 0) != 0
                && kind == DEVPROP_TYPE_STRING;
            let len = name.iter().position(|&c| c == 0).unwrap_or(0);
            out.push((if got { String::from_utf16_lossy(&name[..len]) } else { String::new() }, level.min(100) as i32));
        }
        SetupDiDestroyDeviceInfoList(set);
    }
    out
}
/// Battery of the headphones called `name`; with one battery device only, that one.
fn battery_of(name: &str, list: &[(String, i32)]) -> i32 {
    list.iter()
        .find(|(n, _)| same_device(n, name))
        .map(|(_, b)| *b)
        .or_else(|| (list.len() == 1).then(|| list[0].1))
        .unwrap_or(-1)
}

fn current() -> Headset {
    let Some(d) = env::default_device() else {
        return Headset { battery: -1, ..Default::default() };
    };
    let (ears, headphones) = env::ears_device(&d);
    let names = env::endpoint_name(ears.as_ref().unwrap_or(&d));
    Headset { name: short_name(&names), headphones, battery: -1 }
}

/// Pause whatever player is playing (Media keys API, the same the volume
/// flyout uses). Returns whether something was paused.
fn pause_players() -> bool {
    use windows::Media::Control::*;
    let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().and_then(|a| a.get()) else {
        return false;
    };
    let Ok(sessions) = manager.GetSessions() else { return false };
    let mut paused = false;
    for s in sessions {
        let playing = s
            .GetPlaybackInfo()
            .and_then(|p| p.PlaybackStatus())
            .is_ok_and(|x| x == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing);
        if playing && s.TryPauseAsync().and_then(|a| a.get()).unwrap_or(false) {
            paused = true;
        }
    }
    paused
}

/// The profile saved for these headphones, if any.
fn profile<'a>(s: &'a Value, name: &str) -> Option<&'a serde_json::Map<String, Value>> {
    s.get("earsProfiles")?.as_object()?.iter().find(|(k, _)| same_device(k, name)).and_then(|(_, v)| v.as_object())
}
/// Settings with the profile's values in; None when nothing changes.
pub fn apply_profile(s: &Value, name: &str) -> Option<Value> {
    let p = profile(s, name)?;
    let mut out = s.clone();
    let o = out.as_object_mut()?;
    let mut changed = false;
    for k in ["earsCeiling", "earsSafe", "earsMax", "balance"] {
        if let Some(v) = p.get(k).filter(|v| v.is_number()) {
            if o.get(k) != Some(v) {
                o.insert(k.into(), v.clone());
                changed = true;
            }
        }
    }
    changed.then_some(out)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeadsetEvent {
    /// "unplug" (paused the player), "profile" (settings of these headphones applied).
    kind: &'static str,
    name: String,
}

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        env::init();
        let state = || app.state::<State>();
        let mut last: Option<Headset> = None;
        let mut battery_at = Instant::now() - Duration::from_secs(3600);
        let mut battery_list: Vec<(String, i32)> = vec![];
        while !state().stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(2));
            let s = state().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
            if !enabled(&s, "ears", true) {
                last = None;
                continue;
            }
            let mut now = current();
            let switched = last.as_ref().map_or(true, |l| l.name != now.name || l.headphones != now.headphones);
            if now.headphones && (switched || battery_at.elapsed() >= Duration::from_secs(60)) {
                battery_at = Instant::now();
                battery_list = batteries();
            }
            now.battery = if now.headphones { battery_of(&now.name, &battery_list) } else { -1 };
            if let Some(prev) = &last {
                // Headphones came off with sound playing: it would go on out
                // of the speakers, so pause the player.
                if prev.headphones && !now.headphones && enabled(&s, "earsPause", true) && pause_players() {
                    if let Some(w) = app.get_window("pet") {
                        let _ = w.emit("headset-event", HeadsetEvent { kind: "unplug", name: prev.name.clone() });
                    }
                }
                // Other headphones on: their own settings.
                if now.headphones && switched {
                    if let Some(updated) = apply_profile(&s, &now.name) {
                        let st = state();
                        let mut store = st.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                        let mut next = store.clone();
                        next.settings = updated;
                        if storage::persist(&next).is_ok() {
                            *store = next.clone();
                            drop(store);
                            let _ = app.emit_all("store", next);
                            if let Some(w) = app.get_window("pet") {
                                let _ = w.emit("headset-event", HeadsetEvent { kind: "profile", name: now.name.clone() });
                            }
                        }
                    }
                }
            }
            if last.as_ref() != Some(&now) {
                *CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(now.clone());
                let _ = app.emit_all("headset", now.clone());
            }
            last = Some(now);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn names() {
        assert_eq!(short_name("Headphones (soundcore Space 2)"), "soundcore Space 2");
        assert_eq!(short_name("Наушники (2- Realtek(R) Audio)"), "2- Realtek(R) Audio");
        assert_eq!(short_name("Speakers"), "Speakers");
        assert!(same_device("soundcore Space 2 Hands-Free AG Audio", "soundcore Space 2"));
        assert!(same_device("WH-1000XM4", "wh-1000xm4 Stereo"));
        assert!(!same_device("AirPods Pro", "soundcore Space 2"));
        assert!(!same_device("", "x"));
    }
    #[test]
    fn battery_by_name_or_the_only_one() {
        let list = vec![("soundcore Space 2".to_string(), 15), ("Mouse".to_string(), 80)];
        assert_eq!(battery_of("soundcore Space 2", &list), 15);
        assert_eq!(battery_of("AirPods", &list), -1);
        assert_eq!(battery_of("AirPods", &list[..1]), 15);
    }
    #[test]
    fn profile_applies_only_what_differs() {
        let s = json!({ "earsCeiling": 60, "balance": 0, "earsProfiles": { "soundcore Space 2": { "earsCeiling": 45, "balance": -10 } } });
        let out = apply_profile(&s, "soundcore Space 2").unwrap();
        assert_eq!(out["earsCeiling"], 45);
        assert_eq!(out["balance"], -10);
        assert!(apply_profile(&out, "soundcore Space 2").is_none());
        assert!(apply_profile(&s, "AirPods").is_none());
    }
}
