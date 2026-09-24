use crate::{
    env, native,
    storage::{enabled, State},
    usage,
};
use serde::Serialize;
use std::{
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
#[derive(Clone, Default, Serialize)]
pub struct Media {
    pub playing: bool,
    pub available: bool,
    pub track: String,
    pub position: f64,
}
#[derive(Clone, Serialize)]
struct Snapshot {
    now: u64,
    idle: u64,
    app: String,
    fullscreen: bool,
    foreground: isize,
    windows: Vec<native::Surface>,
    monitors: Vec<native::Monitor>,
    media: Media,
    cpu: Option<f64>,
    online: Option<bool>,
    battery: Option<u8>,
    plugged: bool,
    controller: bool,
    locked: bool,
    desktop: bool,
    input: native::Input,
    /// Cursor twitches that were filtered out as jitter (cumulative).
    jitter: u64,
    gpu: Option<f64>,
    usage: usage::Today,
    env: env::Desktop,
}
pub fn start(app: tauri::AppHandle, on_hotkey: Box<dyn Fn(i32) + Send>) {
    native::hook_thread(app.clone(), on_hotkey);
    let media = Arc::new(Mutex::new(Media::default()));
    let m = media.clone();
    let a = app.clone();
    std::thread::spawn(move || {
        use windows::Media::Control::*;
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .and_then(|a| a.get())
            .ok();
        while !a.state::<State>().stop.load(Ordering::Relaxed) {
            let allow = enabled(
                &a.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings,
                "observeMedia",
                true,
            );
            let mut data = Media::default();
            if allow {
                if let Some(ref manager) = manager {
                    if let Ok(session) = manager.GetCurrentSession() {
                        data.available = true;
                        data.playing = session
                            .GetPlaybackInfo()
                            .and_then(|p| p.PlaybackStatus())
                            .map(|s| {
                                s==GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                            })
                            .unwrap_or(false);
                        data.position = session
                            .GetTimelineProperties()
                            .and_then(|p| p.Position())
                            .map(|p| p.Duration as f64 / 10_000_000.)
                            .unwrap_or(0.);
                        if let Ok(props) =
                            session.TryGetMediaPropertiesAsync().and_then(|a| a.get())
                        {
                            let title = props.Title().map(|t| t.to_string()).unwrap_or_default();
                            let artist = props.Artist().map(|t| t.to_string()).unwrap_or_default();
                            let source = session
                                .SourceAppUserModelId()
                                .map(|s| s.to_string())
                                .unwrap_or_default();
                            if !title.is_empty() {
                                // Only a process-local identity, never media title text in telemetry or persistence.
                                use std::hash::{Hash, Hasher};
                                let mut h = std::collections::hash_map::DefaultHasher::new();
                                (source, title, artist).hash(&mut h);
                                data.track = format!("{:x}", h.finish());
                            }
                        }
                    }
                }
            }
            *m.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = data;
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    std::thread::spawn(move || {
        // Volume and the peak meter are COM; this thread owns them.
        env::init();
        let mut desktop = env::Desktop::default();
        let mut last_env = Instant::now() - Duration::from_secs(5);
        let mut last = Instant::now() - Duration::from_secs(5);
        let mut ticks = native::cpu_ticks();
        let mut packets = [0u32; 4];
        let mut last_controller = Instant::now() - Duration::from_secs(120);
        let mut last_usage = Instant::now();
        while !app.state::<State>().stop.load(Ordering::Relaxed) {
            let state = app.state::<State>();
            if let Some(pet) = app.get_window("pet") {
                if state.visible.load(Ordering::Relaxed) {
                    let motion = native::motion(state.support.load(Ordering::Relaxed));
                    let _ = pet.emit("motion", motion);
                }
                let dirty = native::dirty();
                if last.elapsed() >= Duration::from_secs(1)
                    || (dirty && last.elapsed() >= Duration::from_millis(250))
                {
                    let s = state.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
                    let monitors = native::monitors();
                    let fg = native::foreground(enabled(&s, "observeApps", true), &monitors);
                    native::INPUT_ENABLED.store(enabled(&s, "observeInput", true), Ordering::Relaxed);
                    // Idle time ignores cursor jitter and injected "mouse
                    // jiggler" moves when the input hooks are running.
                    let idle_ms = if enabled(&s, "observeIdle", true) {
                        native::filtered_idle().unwrap_or_else(native::idle)
                    } else {
                        0
                    };
                    let locked = native::session_locked();
                    let today = usage::today();
                    // Whole seconds since the previous accounting step, capped so
                    // a resume after sleep does not credit hours to one program.
                    let step = last_usage.elapsed().as_secs().min(5);
                    if step > 0 {
                        last_usage = Instant::now();
                        usage::flush_if_stale();
                        if enabled(&s, "trackUsage", true) && idle_ms < 60_000 && !locked && !fg.app.is_empty() {
                            usage::record(&fg.app, step, &today);
                        }
                    }
                    // Desktop state (volume, clipboard, theme, pressure) is
                    // cheap but not free: twice a second is plenty.
                    if last_env.elapsed() >= Duration::from_millis(450) {
                        last_env = Instant::now();
                        desktop = if enabled(&s, "observeDesktop", true) {
                            env::sample(enabled(&s, "observeSound", true) || enabled(&s, "ears", true))
                        } else {
                            env::Desktop::default()
                        };
                    }
                    let system = enabled(&s, "observeSystem", true);
                    let (battery, plugged) = if system {
                        native::power()
                    } else {
                        (None, false)
                    };
                    let current = if system { native::cpu_ticks() } else { None };
                    let cpu = match (ticks, current) {
                        (Some((i, t)), Some((ii, tt))) if tt > t => {
                            Some((1. - ((ii - i) as f64 / (tt - t) as f64)) * 100.)
                        }
                        _ => None,
                    };
                    ticks = current;
                    let online = if system {
                        windows::Networking::Connectivity::NetworkInformation::GetInternetConnectionProfile().and_then(|p|p.GetNetworkConnectivityLevel()).ok().map(|s|s==windows::Networking::Connectivity::NetworkConnectivityLevel::InternetAccess)
                    } else {
                        None
                    };
                    if enabled(&s, "observeIdle", true) && native::controller_active(&mut packets) {
                        last_controller = Instant::now();
                    }
                    let data = Snapshot {
                        now: SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64,
                        idle: idle_ms,
                        app: fg.app,
                        fullscreen: fg.fullscreen,
                        foreground: fg.id,
                        desktop: fg.desktop,
                        windows: if enabled(&s, "perch", true) {
                            native::windows()
                        } else {
                            vec![]
                        },
                        monitors,
                        media: media.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
                        cpu,
                        online,
                        battery,
                        plugged,
                        controller: last_controller.elapsed() < Duration::from_secs(60),
                        locked,
                        input: native::input_counters(),
                        jitter: native::jitter_count(),
                        gpu: crate::load::current().gpu,
                        usage: usage::today_top(&today, 5),
                        env: desktop,
                    };
                    let _ = pet.emit("snapshot", data);
                    last = Instant::now();
                }
            }
            std::thread::sleep(Duration::from_millis(
                if state.visible.load(Ordering::Relaxed) {
                    33
                } else {
                    1000
                },
            ));
        }
    });
}
