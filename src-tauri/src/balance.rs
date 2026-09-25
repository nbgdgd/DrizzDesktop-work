// Left/right balance and "ear rest", done in software: every app's audio
// session on the default output gets per-channel gains through
// IChannelAudioVolume (the Windows mixer applies them before the driver).
//
// The first version changed the endpoint's channel volumes instead. Many
// drivers (Bluetooth, USB headsets, FxSound-style virtual devices) keep one
// hardware level for both channels, so "left down" pulled the whole sound
// down or muted it. Session gains work on any device, leave the Windows
// volume slider and the ear guard alone, and are undone on exit - and after
// a crash, on the next start (marker file).
use crate::{env, storage};
use std::sync::Mutex;
use std::time::Duration;
use windows::core::Interface;
use windows::Win32::Media::Audio::{IAudioSessionManager2, IChannelAudioVolume};
use windows::Win32::System::Com::CLSCTX_ALL;

/// Wanted gains (left, right), 0..1.
static GAINS: Mutex<(f32, f32)> = Mutex::new((1., 1.));
/// What the sessions were last set to, so neutral is applied once, not forever.
static APPLIED: Mutex<(f32, f32)> = Mutex::new((1., 1.));

/// Apps whose channel gains were changed, by session identifier (stable
/// across runs: device + app). Windows remembers per-app channel volumes, so
/// an app that was closed while the balance was on came back lopsided the
/// next time it played, long after the balance was turned off (found live:
/// a killed pet's own voice restarted at 40 % on the left). Such an app is
/// put back to full the moment it shows up again, even days later; the list
/// is kept in balance.touched, one identifier per line.
static TOUCHED: Mutex<Option<std::collections::HashSet<String>>> = Mutex::new(None);
fn touched_file() -> std::path::PathBuf {
    storage::root().join("balance.touched")
}
fn with_touched<R>(f: impl FnOnce(&mut std::collections::HashSet<String>) -> R) -> R {
    let mut guard = TOUCHED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let set = guard.get_or_insert_with(|| {
        std::fs::read_to_string(touched_file())
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect()
    });
    f(set)
}
fn save_touched() {
    with_touched(|t| {
        if t.is_empty() {
            let _ = std::fs::remove_file(touched_file());
        } else {
            let _ = std::fs::create_dir_all(storage::root());
            let _ = std::fs::write(touched_file(), t.iter().cloned().collect::<Vec<_>>().join("\n"));
        }
    });
}
fn session_id(control: &windows::Win32::Media::Audio::IAudioSessionControl) -> String {
    unsafe {
        control
            .cast::<windows::Win32::Media::Audio::IAudioSessionControl2>()
            .ok()
            .and_then(|c| c.GetSessionIdentifier().ok())
            .map(|p| {
                let s = p.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                s
            })
            .unwrap_or_default()
    }
}
fn marker() -> std::path::PathBuf {
    storage::root().join("balance.sessions")
}
fn neutral(g: (f32, f32)) -> bool {
    (g.0 - 1.).abs() < 0.005 && (g.1 - 1.).abs() < 0.005
}
/// Gain for channel `k` of `n` (WAVEFORMATEXTENSIBLE order: FL FR FC LFE BL
/// BR SL SR...): left-side channels get `l`, right-side `r`, centre and LFE
/// the mean.
pub fn channel_gain(k: u32, n: u32, l: f32, r: f32) -> f32 {
    if n < 2 {
        return (l + r) / 2.;
    }
    match k {
        0 | 4 | 6 => l,
        1 | 5 | 7 => r,
        _ => (l + r) / 2.,
    }
}
/// Sets every session on the default output; returns how many took it.
fn apply(g: (f32, f32)) -> Result<usize, String> {
    env::init();
    let device = env::default_device().ok_or("No audio output")?;
    let mut done = 0;
    let mut changed = false;
    let full = neutral(g);
    unsafe {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let sessions = manager.GetSessionEnumerator().map_err(|e| e.to_string())?;
        for i in 0..sessions.GetCount().unwrap_or(0) {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(channels) = control.cast::<IChannelAudioVolume>() else { continue };
            let n = channels.GetChannelCount().unwrap_or(0);
            let mut ok = true;
            for k in 0..n {
                let want = channel_gain(k, n, g.0, g.1).clamp(0., 1.);
                if channels.GetChannelVolume(k).map_or(true, |v| (v - want).abs() > 0.005) {
                    ok &= channels.SetChannelVolume(k, want, std::ptr::null()).is_ok();
                }
            }
            let id = session_id(&control);
            if !id.is_empty() {
                // Remember what was bent; forget it once it is straight again.
                changed |= with_touched(|t| if full { ok && t.remove(&id) } else { t.insert(id) });
            }
            done += 1;
        }
    }
    if changed {
        save_touched();
    }
    Ok(done)
}
/// A process that has exited (its session lingers in the mixer for a while).
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    if pid == 0 {
        return true;
    }
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code) != 0 && code == STILL_ACTIVE as u32;
        CloseHandle(h);
        ok
    }
}
/// For probes: the channel volumes of every session of a running process on
/// the default output (a killed pet's own session is not the user's sound).
pub fn sessions() -> Result<Vec<(u32, Vec<f32>)>, String> {
    env::init();
    let device = env::default_device().ok_or("No audio output")?;
    let mut out = vec![];
    unsafe {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let sessions = manager.GetSessionEnumerator().map_err(|e| e.to_string())?;
        for i in 0..sessions.GetCount().unwrap_or(0) {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(channels) = control.cast::<IChannelAudioVolume>() else { continue };
            let pid = control.cast::<windows::Win32::Media::Audio::IAudioSessionControl2>().ok().and_then(|c| c.GetProcessId().ok()).unwrap_or(0);
            if !alive(pid) {
                continue;
            }
            let n = channels.GetChannelCount().unwrap_or(0);
            out.push((pid, (0..n).map(|k| channels.GetChannelVolume(k).unwrap_or(-1.)).collect()));
        }
    }
    Ok(out)
}
/// The command: remember the gains and apply them right away.
pub fn set(left: f32, right: f32) -> Result<(), String> {
    let g = (left.clamp(0., 1.), right.clamp(0., 1.));
    *GAINS.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = g;
    if neutral(g) {
        let _ = std::fs::remove_file(marker());
    } else {
        let _ = std::fs::create_dir_all(storage::root());
        let _ = std::fs::write(marker(), format!("{} {}", g.0, g.1));
    }
    apply(g)?;
    *APPLIED.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = g;
    Ok(())
}
/// Exit (or a leftover marker at start): every session back to full.
pub fn reset() {
    let _ = apply((1., 1.));
    *GAINS.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = (1., 1.);
    *APPLIED.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = (1., 1.);
    let _ = std::fs::remove_file(marker());
}
/// Start: a marker means the last run died with a balance on.
pub fn restore_stale() {
    if marker().exists() {
        reset();
    }
}
/// Our own processes: this one and its WebView2 children (the sound comes
/// from a WebView2 renderer, not from the pet's exe).
fn own_pids() -> Vec<u32> {
    let me = std::process::id();
    let mut parent = std::collections::HashMap::new();
    unsafe {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return vec![me];
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                parent.insert(e.th32ProcessID, e.th32ParentProcessID);
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    parent
        .keys()
        .copied()
        .filter(|&pid| {
            let mut p = pid;
            for _ in 0..6 {
                if p == me {
                    return true;
                }
                match parent.get(&p) {
                    Some(&q) if q != p && q != 0 => p = q,
                    _ => return false,
                }
            }
            false
        })
        .collect()
}
/// The Windows volume mixer lists the pet's sound as "Microsoft Edge
/// WebView2" (the process that plays it), so users looked for "Drizz", found
/// nothing and thought it was silent. Name those sessions after the pet and
/// give them its icon.
fn label_own_sessions(pids: &[u32]) {
    use windows::core::HSTRING;
    use windows::Win32::Media::Audio::IAudioSessionControl2;
    let Some(device) = env::default_device() else { return };
    let icon = std::env::current_exe().map(|p| format!("{},0", p.display())).unwrap_or_default();
    unsafe {
        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { return };
        let Ok(sessions) = manager.GetSessionEnumerator() else { return };
        for i in 0..sessions.GetCount().unwrap_or(0) {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(c2) = control.cast::<IAudioSessionControl2>() else { continue };
            if !pids.contains(&c2.GetProcessId().unwrap_or(0)) {
                continue;
            }
            let named = control.GetDisplayName().ok().and_then(|p| p.to_string().ok()).unwrap_or_default();
            if named != "Drizz Desktop" {
                let _ = control.SetDisplayName(&HSTRING::from("Drizz Desktop"), std::ptr::null());
                if !icon.is_empty() {
                    let _ = control.SetIconPath(&HSTRING::from(icon.as_str()), std::ptr::null());
                }
            }
        }
    }
}
/// New apps (a browser tab starting to play, a game) open new sessions:
/// while a balance is on, look for them once a second. The pet's own
/// sessions get its name in the mixer.
pub fn start(stop: impl Fn() -> bool + Send + 'static) {
    std::thread::spawn(move || {
        env::init();
        let mut pids = vec![];
        let mut tick = 0u32;
        while !stop() {
            std::thread::sleep(Duration::from_secs(1));
            // WebView2 renderers come and go: the tree is re-read every 10 s.
            if tick % 10 == 0 {
                pids = own_pids();
            }
            tick = tick.wrapping_add(1);
            label_own_sessions(&pids);
            let g = *GAINS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let applied = *APPLIED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            // Also while some app bent earlier has not been seen straight yet.
            if !neutral(g) || !neutral(applied) || with_touched(|t| !t.is_empty()) {
                if apply(g).is_ok() {
                    *APPLIED.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = g;
                }
            }
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_channels_to_ears() {
        assert_eq!(channel_gain(0, 2, 0.3, 1.), 0.3);
        assert_eq!(channel_gain(1, 2, 0.3, 1.), 1.);
        // 5.1: FL FR FC LFE BL BR
        assert_eq!(channel_gain(2, 6, 0.4, 1.), 0.7);
        assert_eq!(channel_gain(4, 6, 0.4, 1.), 0.4);
        assert_eq!(channel_gain(5, 6, 0.4, 1.), 1.);
        assert_eq!(channel_gain(0, 1, 0.4, 1.), 0.7);
        assert!(neutral((1., 0.999)));
        assert!(!neutral((0.5, 1.)));
    }
}
#[cfg(test)]
mod probe_sessions {
    #[test]
    #[ignore]
    fn print_sessions() {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::System::Com::CLSCTX_ALL;
        crate::env::init();
        let d = crate::env::default_device().expect("device");
        let (ears, hp) = crate::env::ears_device(&d);
        unsafe {
            let v: IAudioEndpointVolume = d.Activate(CLSCTX_ALL, None).expect("vol");
            println!("default={:?} endpoint_channels={:?} headphones={} behind={:?}", crate::env::device_names(&d), v.GetChannelCount(), hp, ears.as_ref().map(crate::env::device_names));
        }
        println!("sessions={:?}", super::sessions());
    }
}
#[cfg(test)]
mod probe_pan {
    /// Live: measures the left/right peaks on the default output while the
    /// sessions are neutral and while the left ear is turned down. Needs
    /// something playing. Changes the sound for about a second.
    #[test]
    #[ignore]
    fn balance_really_pans() {
        use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
        use windows::Win32::System::Com::CLSCTX_ALL;
        crate::env::init();
        let d = crate::env::default_device().expect("device");
        let meter: IAudioMeterInformation = unsafe { d.Activate(CLSCTX_ALL, None).expect("meter") };
        let measure = || {
            let (mut l, mut r) = (0f32, 0f32);
            for _ in 0..50 {
                let mut p = [0f32; 2];
                unsafe {
                    let _ = meter.GetChannelsPeakValues(&mut p);
                }
                l += p[0];
                r += p[1];
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            (l / 50., r / 50.)
        };
        let before = measure();
        super::apply((0.15, 1.)).expect("apply");
        std::thread::sleep(std::time::Duration::from_millis(150));
        let panned = measure();
        super::apply((1., 1.)).expect("reset");
        let after = measure();
        println!("before L/R {:.3}/{:.3}  panned L/R {:.3}/{:.3}  after L/R {:.3}/{:.3}", before.0, before.1, panned.0, panned.1, after.0, after.1);
        println!("left share before {:.2} panned {:.2}", before.0 / (before.0 + before.1).max(1e-6), panned.0 / (panned.0 + panned.1).max(1e-6));
    }
}
#[cfg(test)]
mod probe_meter {
    /// Live: peak level of every app's audio session on the default output,
    /// sampled for PROBE_SECS (default 8) seconds; prints the loudest peak
    /// per process. Used to prove the pet makes sound.
    #[test]
    #[ignore]
    fn session_peaks() {
        use std::collections::HashMap;
        use windows::core::Interface;
        use windows::Win32::Media::Audio::{Endpoints::IAudioMeterInformation, IAudioSessionControl2, IAudioSessionManager2};
        use windows::Win32::System::Com::CLSCTX_ALL;
        crate::env::init();
        let secs: u64 = std::env::var("PROBE_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
        let d = crate::env::default_device().expect("device");
        let mut best: HashMap<u32, f32> = HashMap::new();
        let mut names: HashMap<u32, String> = HashMap::new();
        let t = std::time::Instant::now();
        while t.elapsed().as_secs() < secs {
            unsafe {
                let m: IAudioSessionManager2 = d.Activate(CLSCTX_ALL, None).expect("manager");
                let list = m.GetSessionEnumerator().expect("list");
                for i in 0..list.GetCount().unwrap_or(0) {
                    let Ok(c) = list.GetSession(i) else { continue };
                    let Ok(c2) = c.cast::<IAudioSessionControl2>() else { continue };
                    let pid = c2.GetProcessId().unwrap_or(0);
                    let Ok(meter) = c.cast::<IAudioMeterInformation>() else { continue };
                    let p = meter.GetPeakValue().unwrap_or(0.);
                    names.insert(pid, c.GetDisplayName().ok().and_then(|n| n.to_string().ok()).unwrap_or_default());
                    let e = best.entry(pid).or_insert(0.);
                    *e = e.max(p);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        for (pid, p) in best {
            println!("pid {pid} peak {p:.4} name {:?}", names.get(&pid).cloned().unwrap_or_default());
        }
    }
}
#[cfg(test)]
mod probe_rename {
    /// Live: tries to name the session of PROBE_PID in the Windows mixer.
    #[test]
    #[ignore]
    fn rename_session() {
        use windows::core::{Interface, HSTRING};
        use windows::Win32::Media::Audio::{IAudioSessionControl2, IAudioSessionManager2};
        use windows::Win32::System::Com::CLSCTX_ALL;
        crate::env::init();
        let want: u32 = std::env::var("PROBE_PID").unwrap().parse().unwrap();
        let d = crate::env::default_device().expect("device");
        unsafe {
            let m: IAudioSessionManager2 = d.Activate(CLSCTX_ALL, None).expect("manager");
            let list = m.GetSessionEnumerator().expect("list");
            for i in 0..list.GetCount().unwrap_or(0) {
                let Ok(c) = list.GetSession(i) else { continue };
                let Ok(c2) = c.cast::<IAudioSessionControl2>() else { continue };
                if c2.GetProcessId().unwrap_or(0) != want { continue }
                let before = c.GetDisplayName().map(|p| p.to_string().unwrap_or_default());
                let r = c.SetDisplayName(&HSTRING::from("Drizz Desktop"), std::ptr::null());
                let after = c.GetDisplayName().map(|p| p.to_string().unwrap_or_default());
                println!("before {before:?} set {r:?} after {after:?}");
            }
        }
    }
}
#[cfg(test)]
mod probe_list {
    /// Live: every session on the default output with pid, state and gains.
    #[test]
    #[ignore]
    fn list_sessions() {
        use windows::core::Interface;
        use windows::Win32::Media::Audio::{IAudioSessionControl2, IAudioSessionManager2, IChannelAudioVolume};
        use windows::Win32::System::Com::CLSCTX_ALL;
        crate::env::init();
        let d = crate::env::default_device().expect("device");
        unsafe {
            let m: IAudioSessionManager2 = d.Activate(CLSCTX_ALL, None).expect("manager");
            let list = m.GetSessionEnumerator().expect("list");
            for i in 0..list.GetCount().unwrap_or(0) {
                let Ok(c) = list.GetSession(i) else { continue };
                let c2: IAudioSessionControl2 = c.cast().expect("c2");
                let ch: IChannelAudioVolume = c.cast().expect("ch");
                let n = ch.GetChannelCount().unwrap_or(0);
                let v: Vec<f32> = (0..n).map(|k| ch.GetChannelVolume(k).unwrap_or(-1.)).collect();
                println!("pid {} state {:?} name {:?} gains {:?}", c2.GetProcessId().unwrap_or(0), c.GetState().map(|s| s.0), c.GetDisplayName().ok().and_then(|n| n.to_string().ok()), v);
            }
        }
    }
}
