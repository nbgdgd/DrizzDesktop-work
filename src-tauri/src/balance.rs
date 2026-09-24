// Left/right balance and "ear rest", done in software: every app's audio
// session on the default output gets per-channel gains through
// IChannelAudioVolume (the Windows mixer applies them before the driver).
//
// The first version changed the endpoint's channel volumes instead. Many
// drivers (Bluetooth, USB headsets, FxSound-style virtual devices) keep one
// hardware level for both channels, so "left down" pulled the whole sound
// down or muted it. Session gains work on any device, leave the Windows
// volume slider and the ear guard alone, and are undone on exit — and after
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

fn marker() -> std::path::PathBuf {
    storage::root().join("balance.sessions")
}
fn neutral(g: (f32, f32)) -> bool {
    (g.0 - 1.).abs() < 0.005 && (g.1 - 1.).abs() < 0.005
}
/// Gain for channel `k` of `n` (WAVEFORMATEXTENSIBLE order: FL FR FC LFE BL
/// BR SL SR…): left-side channels get `l`, right-side `r`, centre and LFE
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
    unsafe {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let sessions = manager.GetSessionEnumerator().map_err(|e| e.to_string())?;
        for i in 0..sessions.GetCount().unwrap_or(0) {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(channels) = control.cast::<IChannelAudioVolume>() else { continue };
            let n = channels.GetChannelCount().unwrap_or(0);
            for k in 0..n {
                let want = channel_gain(k, n, g.0, g.1).clamp(0., 1.);
                if channels.GetChannelVolume(k).map_or(true, |v| (v - want).abs() > 0.005) {
                    let _ = channels.SetChannelVolume(k, want, std::ptr::null());
                }
            }
            done += 1;
        }
    }
    Ok(done)
}
/// For probes: the channel volumes of every session on the default output.
pub fn sessions() -> Result<Vec<Vec<f32>>, String> {
    env::init();
    let device = env::default_device().ok_or("No audio output")?;
    let mut out = vec![];
    unsafe {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let sessions = manager.GetSessionEnumerator().map_err(|e| e.to_string())?;
        for i in 0..sessions.GetCount().unwrap_or(0) {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(channels) = control.cast::<IChannelAudioVolume>() else { continue };
            let n = channels.GetChannelCount().unwrap_or(0);
            out.push((0..n).map(|k| channels.GetChannelVolume(k).unwrap_or(-1.)).collect());
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
/// New apps (a browser tab starting to play, a game) open new sessions:
/// while a balance is on, look for them once a second.
pub fn start(stop: impl Fn() -> bool + Send + 'static) {
    std::thread::spawn(move || {
        env::init();
        while !stop() {
            std::thread::sleep(Duration::from_secs(1));
            let g = *GAINS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let applied = *APPLIED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if !neutral(g) || !neutral(applied) {
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
