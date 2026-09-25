// The audio tap: WASAPI loopback of the default output, i.e. what is really
// playing (every app plus the mixer gains, before the Windows volume slider).
// Runs only while something plays and only when a feature needs it.
//  * Honest dose: A-weighted level per channel over the last 2 s, read by
//    env::sample (tapLeft/tapRight); ears.ts adds the device level and the
//    headphones' maximum instead of guessing from the slider.
//  * Spike ducking (earsSpike): a sudden jump of 10+ dB over the last 10 s
//    of sound lowers the Windows volume for ~2.5 s, then puts it back if
//    nobody touched it (dsp::Spike).
//  * Music for the pet (musicViz): eight bands, tempo and the last beat,
//    ~12 times a second as "audio-tap" to the pet window.
use crate::{dsp, env, storage::{enabled, State}};
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use windows::Win32::Media::Audio::{
    Endpoints::{IAudioEndpointVolume, IAudioMeterInformation},
    IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoTaskMemFree, CLSCTX_ALL};

/// Last 2 s of A-weighted energy per channel, one entry per 10 ms hop.
struct Level {
    hops: VecDeque<(f64, f64)>,
    at: Option<Instant>,
}
static LEVEL: Mutex<Level> = Mutex::new(Level { hops: VecDeque::new(), at: None });

/// Level of what plays, dB relative to a full-scale sine (0 = the loudest
/// clean tone), per channel; None when the tap is not running.
pub fn level() -> Option<(f32, f32)> {
    let l = LEVEL.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if !l.at.is_some_and(|t| t.elapsed() < Duration::from_millis(600)) || l.hops.is_empty() {
        return None;
    }
    let n = l.hops.len() as f64;
    let (a, b) = l.hops.iter().fold((0., 0.), |(a, b), (x, y)| (a + x, b + y));
    Some((dsp::db(a / n) + 3., dsp::db(b / n) + 3.))
}
fn record(l: f64, r: f64) {
    let mut s = LEVEL.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if s.hops.len() >= 200 {
        s.hops.pop_front();
    }
    s.hops.push_back((l, r));
    s.at = Some(Instant::now());
}
fn forget() {
    let mut s = LEVEL.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    s.hops.clear();
    s.at = None;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Music {
    /// 0..1 per band, bass first.
    pub bands: [f32; 8],
    /// dB of the louder channel, as in `level`.
    pub level: f32,
    pub bpm: f32,
    /// Beat period and time since the last beat, ms; confidence 0..1.
    pub period: f32,
    pub beat: f32,
    pub confidence: f32,
}

#[derive(Clone, Copy, PartialEq)]
struct Config {
    dose: bool,
    spike: bool,
    viz: bool,
    always: bool,
    max: f32,
}
fn config(s: &Value) -> Config {
    let ears = enabled(s, "ears", true);
    Config {
        dose: ears,
        spike: ears && enabled(s, "earsSpike", true),
        viz: enabled(s, "musicViz", true),
        always: s.get("earsDevice").and_then(Value::as_str) == Some("always"),
        max: s.get("earsMax").and_then(Value::as_f64).unwrap_or(100.).clamp(85., 120.) as f32,
    }
}

enum Sample {
    F32,
    I16,
    I32,
    I24,
}
struct Capture {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    channels: usize,
    kind: Sample,
    rate: f32,
    id: String,
    /// The Windows slider of the default output (ducking) and the levels at
    /// the ears (a virtual output in front of real headphones adds up).
    volume: IAudioEndpointVolume,
    ears: Option<IAudioEndpointVolume>,
    headphones: bool,
}
impl Drop for Capture {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}
fn open() -> Option<Capture> {
    unsafe {
        let device = env::default_device()?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).ok()?;
        let format = client.GetMixFormat().ok()?;
        let f: WAVEFORMATEX = std::ptr::read_unaligned(format);
        let sub = if f.wFormatTag == 0xFFFE && f.cbSize >= 22 {
            let x: WAVEFORMATEXTENSIBLE = std::ptr::read_unaligned(format as *const WAVEFORMATEXTENSIBLE);
            x.SubFormat.data1 as u16
        } else {
            f.wFormatTag
        };
        let kind = match (sub, f.wBitsPerSample) {
            (3, 32) => Some(Sample::F32),
            (1, 16) => Some(Sample::I16),
            (1, 24) => Some(Sample::I24),
            (1, 32) => Some(Sample::I32),
            _ => None,
        };
        // 200 ms buffer, read every 10 ms.
        let ok = kind.is_some() && client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, format, None).is_ok();
        CoTaskMemFree(Some(format as *const _));
        if !ok {
            return None;
        }
        let capture: IAudioCaptureClient = client.GetService().ok()?;
        client.Start().ok()?;
        let (ears, headphones) = env::ears_device(&device);
        Some(Capture {
            client,
            capture,
            channels: f.nChannels.max(1) as usize,
            kind: kind?,
            rate: f.nSamplesPerSec as f32,
            id: env::device_id(&device),
            volume: device.Activate(CLSCTX_ALL, None).ok()?,
            ears: ears.and_then(|d| d.Activate(CLSCTX_ALL, None).ok()),
            headphones,
        })
    }
}
/// Levels at the ears in dB of the device (0 = full): (left, right).
fn device_db(c: &Capture) -> (f32, f32) {
    let (_, mut l, mut r) = env::ear_levels(&c.volume);
    if let Some(e) = &c.ears {
        let (_, el, er) = env::ear_levels(e);
        l += el;
        r += er;
    }
    (l, r)
}
fn peak() -> f32 {
    unsafe {
        env::default_device()
            .and_then(|d| d.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None).ok())
            .and_then(|m| m.GetPeakValue().ok())
            .unwrap_or(0.)
    }
}
unsafe fn frame(data: *const u8, kind: &Sample, channels: usize, i: usize) -> (f32, f32) {
    let at = |ch: usize| -> f32 {
        let k = i * channels + ch;
        match kind {
            Sample::F32 => std::ptr::read_unaligned((data as *const f32).add(k)),
            Sample::I16 => std::ptr::read_unaligned((data as *const i16).add(k)) as f32 / 32768.,
            Sample::I32 => std::ptr::read_unaligned((data as *const i32).add(k)) as f32 / 2147483648.,
            Sample::I24 => {
                let p = data.add(k * 3);
                let v = (*p as i32) | ((*p.add(1) as i32) << 8) | ((*p.add(2) as i8 as i32) << 16);
                v as f32 / 8388608.
            }
        }
    };
    if channels == 1 {
        let m = at(0);
        (m, m)
    } else {
        (at(0), at(1))
    }
}

struct Duck {
    /// The slider before and what we set.
    before: f32,
    set: f32,
    at: Instant,
}

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        env::init();
        let stop = || app.state::<State>().stop.load(Ordering::Relaxed);
        let settings = || app.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
        let mut cap: Option<Capture> = None;
        let mut an: Option<dsp::Analyzer> = None;
        let mut spike = dsp::Spike::new();
        let mut duck: Option<Duck> = None;
        let mut cfg = config(&settings());
        let mut checked = Instant::now();
        let mut quiet_since: Option<Instant> = None;
        let mut ears_db = (0f32, 0f32);
        let mut hop_count = 0usize;
        let mut last_note = Instant::now() - Duration::from_secs(60);
        while !stop() {
            if checked.elapsed() >= Duration::from_secs(1) {
                checked = Instant::now();
                cfg = config(&settings());
                // Output changed (headphones in or out): start over on the new one.
                if cap.as_ref().is_some_and(|c| env::default_device().map_or(true, |d| env::device_id(&d) != c.id)) {
                    cap = None;
                }
                if let Some(c) = &cap {
                    ears_db = device_db(c);
                }
            }
            let wanted = cfg.dose || cfg.viz || cfg.spike;
            if cap.is_none() {
                // Nothing to do, or nothing playing: look again in a moment.
                if !wanted || peak() < 0.002 {
                    forget();
                    std::thread::sleep(Duration::from_millis(if wanted { 300 } else { 1000 }));
                    continue;
                }
                cap = open();
                an = None;
                spike = dsp::Spike::new();
                quiet_since = None;
                if cap.is_none() {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
                ears_db = device_db(cap.as_ref().unwrap());
            }
            std::thread::sleep(Duration::from_millis(10));
            let c = cap.as_ref().unwrap();
            if an.as_ref().map_or(true, |a| a.rate() != c.rate) {
                an = Some(dsp::Analyzer::new(c.rate));
            }
            let a = an.as_mut().unwrap();
            let mut loud = false;
            let mut failed = false;
            let mut cut: Option<f32> = None;
            let mut music: Option<Music> = None;
            unsafe {
                loop {
                    let size = match c.capture.GetNextPacketSize() {
                        Ok(n) => n,
                        Err(_) => {
                            failed = true;
                            break;
                        }
                    };
                    if size == 0 {
                        break;
                    }
                    let (mut data, mut frames, mut flags) = (std::ptr::null_mut::<u8>(), 0u32, 0u32);
                    if c.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                        failed = true;
                        break;
                    }
                    let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                    for i in 0..frames as usize {
                        let (l, r) = if silent { (0., 0.) } else { frame(data, &c.kind, c.channels, i) };
                        loud |= l.abs() > 0.0005 || r.abs() > 0.0005;
                        a.push(l, r, &mut |an, h| {
                            record(h.left, h.right);
                            hop_count += 1;
                            // Level at the louder ear, dBA.
                            let content = dsp::db(h.left.max(h.right)) + 3.;
                            let ear = cfg.max + ears_db.0.max(ears_db.1) + content;
                            if cfg.spike && (c.headphones || cfg.always) {
                                if let Some(x) = spike.step(ear) {
                                    cut = Some(x);
                                }
                            }
                            if cfg.viz && hop_count % 8 == 0 {
                                music = Some(Music {
                                    bands: an.bars,
                                    level: content,
                                    bpm: an.bpm(),
                                    period: an.period_ms(),
                                    beat: an.beat_age as f32 * 1000. / dsp::HOP_RATE as f32,
                                    confidence: an.confidence,
                                });
                            }
                        });
                    }
                    let _ = c.capture.ReleaseBuffer(frames);
                }
            }
            if failed {
                cap = None;
                continue;
            }
            if let Some(x) = cut {
                if duck.is_none() {
                    unsafe {
                        if let (Ok(before), Ok(db)) = (c.volume.GetMasterVolumeLevelScalar(), c.volume.GetMasterVolumeLevel()) {
                            let (min, _, _) = {
                                let (mut lo, mut hi, mut step) = (0f32, 0f32, 0f32);
                                let _ = c.volume.GetVolumeRange(&mut lo, &mut hi, &mut step);
                                (lo, hi, step)
                            };
                            let _ = c.volume.SetMasterVolumeLevel((db - x).max(min), std::ptr::null());
                            let set = c.volume.GetMasterVolumeLevelScalar().unwrap_or(before);
                            duck = Some(Duck { before, set, at: Instant::now() });
                            if last_note.elapsed() > Duration::from_secs(30) {
                                last_note = Instant::now();
                                if let Some(w) = app.get_window("pet") {
                                    let _ = w.emit("ear-guard", crate::guard::GuardEvent { kind: "spike", from: (before * 100.).round() as u32, to: (set * 100.).round() as u32 });
                                }
                            }
                        }
                    }
                }
            }
            // The duck is over (or the sound stopped, and with it the hops
            // that count it down): put the slider back unless someone moved it.
            if duck.as_ref().is_some_and(|d| spike.hold == 0 || (!loud && d.at.elapsed() > Duration::from_secs(3)) || d.at.elapsed() > Duration::from_secs(10)) {
                spike.hold = 0;
                if let Some(d) = duck.take() {
                    unsafe {
                        if c.volume.GetMasterVolumeLevelScalar().is_ok_and(|now| (now - d.set).abs() < 0.015) {
                            let _ = c.volume.SetMasterVolumeLevelScalar(d.before, std::ptr::null());
                        }
                    }
                }
            }
            if let Some(m) = music {
                if let Some(w) = app.get_window("pet") {
                    let _ = w.emit("audio-tap", m);
                }
            }
            // Three seconds of nothing: let the device sleep, poll the meter instead.
            if loud {
                quiet_since = None;
            }
            let silent = !loud && quiet_since.get_or_insert_with(Instant::now).elapsed() > Duration::from_secs(3);
            if (silent || !wanted) && duck.is_none() {
                cap = None;
                forget();
                if cfg.viz {
                    if let Some(w) = app.get_window("pet") {
                        let _ = w.emit("audio-tap", Music { bands: [0.; 8], level: -120., bpm: 0., period: 0., beat: 0., confidence: 0. });
                    }
                }
            }
        }
        // Quitting in the middle of a duck: give the volume back.
        if let (Some(c), Some(d)) = (cap.as_ref(), duck) {
            unsafe {
                let _ = c.volume.SetMasterVolumeLevelScalar(d.before, std::ptr::null());
            }
        }
    });
}
