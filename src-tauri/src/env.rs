// Desktop state the pet reacts to beyond apps and input: speaker volume and
// whether anything is actually making a sound, clipboard activity, Caps Lock,
// the light/dark theme, memory and disk pressure, and how many top-level
// windows are open. Everything here is a number or a flag — no window titles,
// no clipboard contents, nothing that could carry text off the machine.
use serde::Serialize;
use std::cell::RefCell;
use windows::Win32::Media::Audio::{
    eConsole, eRender,
    Endpoints::{IAudioEndpointVolume, IAudioMeterInformation},
    Headphones, Headset, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    PKEY_AudioEndpoint_FormFactor, DEVICE_STATE_ACTIVE,
};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
use windows::core::GUID;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, MAX_PATH, TRUE};
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows_sys::Win32::System::SystemInformation::{
    GetSystemDirectoryW, GlobalMemoryStatusEx, MEMORYSTATUSEX,
};
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, IsWindowVisible, GWL_EXSTYLE,
    GW_OWNER, WS_EX_TOOLWINDOW,
};

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Desktop {
    /// Master output volume, 0..100; -1 when the endpoint could not be read.
    pub volume: i32,
    pub muted: bool,
    /// Something is coming out of the speakers right now (peak meter).
    pub audio: bool,
    /// Clipboard sequence number: it changes on every copy, the content never leaves Windows.
    pub clipboard: u32,
    pub caps: bool,
    pub dark: bool,
    /// Physical memory in use, percent.
    pub memory: u8,
    /// Free space on the system drive, percent.
    pub disk: u8,
    /// Visible top-level windows, i.e. roughly "open programs".
    pub windows: u32,
    /// Bitmask of drive letters (GetLogicalDrives): a new bit = a drive plugged in.
    pub drives: u32,
    /// Windows "Mono audio" (Accessibility): both channels are mixed into one
    /// after every app, so no balance can reach a single ear.
    pub mono: bool,
    /// The default output is headphones or a headset (endpoint form factor).
    pub headphones: bool,
    /// Master and per-ear levels in dB (0 = full, negative = attenuated);
    /// -100 when unknown. Mono devices report the same value for both ears.
    pub db: f32,
    pub left: f32,
    pub right: f32,
}

thread_local! {
    static AUDIO: RefCell<Option<Audio>> = const { RefCell::new(None) };
}
struct Audio {
    /// The default output: the volume slider, mute and the peak meter.
    volume: IAudioEndpointVolume,
    meter: IAudioMeterInformation,
    /// The device at the ears when it is not the default (a virtual output
    /// such as FxSound or Voicemeeter sitting in front of real headphones).
    ears: Option<IAudioEndpointVolume>,
    headphones: bool,
    /// Default endpoint id and the time the choice was made: re-checked every
    /// few seconds, because plugging headphones in often leaves the old
    /// endpoint perfectly valid (or the default is a virtual device at all).
    id: String,
    at: std::time::Instant,
}
/// What the ear care needs from one sample: the device kind and the levels.
#[derive(Clone, Copy)]
struct Ears {
    headphones: bool,
    db: f32,
    left: f32,
    right: f32,
}
const NO_EARS: Ears = Ears { headphones: false, db: -100., left: -100., right: -100. };

/// COM for this thread; call once before [`sample`].
pub fn init() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

pub(crate) fn default_device() -> Option<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()
    }
}

/// Headphones or a headset by the endpoint's form factor. Bluetooth
/// headphones usually report one of the two as well.
fn is_headphones(device: &IMMDevice) -> bool {
    unsafe {
        let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
            return false;
        };
        let Ok(value) = store.GetValue(&PKEY_AudioEndpoint_FormFactor) else {
            return false;
        };
        let kind = u32::try_from(&value).unwrap_or(0) as i32;
        kind == Headphones.0 || kind == Headset.0
    }
}

fn form_factor(device: &IMMDevice) -> i32 {
    unsafe {
        let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
            return 0;
        };
        let Ok(value) = store.GetValue(&PKEY_AudioEndpoint_FormFactor) else {
            return 0;
        };
        u32::try_from(&value).unwrap_or(0) as i32
    }
}

/// Endpoint name plus its adapter name ("Speakers (FxSound Audio Enhancer)").
pub(crate) fn device_names(device: &IMMDevice) -> String {
    // PKEY_Device_FriendlyName and PKEY_DeviceInterface_FriendlyName.
    const KEYS: [PROPERTYKEY; 2] = [
        PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 },
        PROPERTYKEY { fmtid: GUID::from_u128(0x026e516e_b814_414b_83cd_856d6fef4822), pid: 2 },
    ];
    unsafe {
        let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
            return String::new();
        };
        KEYS.iter()
            .filter_map(|k| store.GetValue(k).ok().map(|v| v.to_string()))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Software outputs that pass the sound on to a real device.
fn is_virtual(device: &IMMDevice) -> bool {
    let n = device_names(device).to_lowercase();
    ["fxsound", "voicemeeter", "vb-audio", "virtual", "cable", "sonar", "equalizer apo", "boom3d", "nahimic mirroring"]
        .iter()
        .any(|v| n.contains(v))
}

/// When the default output is a virtual device, the real headphones behind
/// it: an active, non-virtual headphone endpoint (a Bluetooth hands-free
/// headset only if there is nothing better).
fn headphones_behind() -> Option<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let list = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).ok()?;
        let mut headset = None;
        for i in 0..list.GetCount().ok()? {
            let Ok(d) = list.Item(i) else { continue };
            if is_virtual(&d) {
                continue;
            }
            match form_factor(&d) {
                k if k == Headphones.0 => return Some(d),
                k if k == Headset.0 && headset.is_none() => headset = Some(d),
                _ => {}
            }
        }
        headset
    }
}

pub(crate) fn device_id(device: &IMMDevice) -> String {
    unsafe {
        device
            .GetId()
            .ok()
            .map(|p| {
                let s = p.to_string().unwrap_or_default();
                windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
                s
            })
            .unwrap_or_default()
    }
}

/// The device the user actually hears and whether it is headphones.
pub(crate) fn ears_device(default: &IMMDevice) -> (Option<IMMDevice>, bool) {
    if is_headphones(default) {
        return (None, true);
    }
    if is_virtual(default) {
        if let Some(d) = headphones_behind() {
            return (Some(d), true);
        }
    }
    (None, false)
}

fn open_audio() -> Option<Audio> {
    unsafe {
        let device = default_device()?;
        let (ears, headphones) = ears_device(&device);
        Some(Audio {
            volume: device.Activate(CLSCTX_ALL, None).ok()?,
            meter: device.Activate(CLSCTX_ALL, None).ok()?,
            ears: ears.and_then(|d| d.Activate(CLSCTX_ALL, None).ok()),
            headphones,
            id: device_id(&device),
            at: std::time::Instant::now(),
        })
    }
}

fn ear_levels(volume: &IAudioEndpointVolume) -> (f32, f32, f32) {
    unsafe {
        let db = volume.GetMasterVolumeLevel().unwrap_or(-100.);
        let channels = volume.GetChannelCount().unwrap_or(0);
        if channels < 2 {
            return (db, db, db);
        }
        let left = volume.GetChannelVolumeLevel(0).unwrap_or(db);
        let right = volume.GetChannelVolumeLevel(1).unwrap_or(db);
        (db, left, right)
    }
}

/// Volume 0..100 (-1 unknown), muted, whether sound is playing, and the ear levels.
fn audio() -> (i32, bool, bool, Ears) {
    AUDIO.with(|cell| {
        let mut slot = cell.borrow_mut();
        // Every 3 s: did the default output change, or did headphones
        // appear behind a virtual one?
        let stale = slot.as_ref().is_some_and(|a| {
            a.at.elapsed().as_secs() >= 3
                && default_device().map_or(true, |d| device_id(&d) != a.id || ears_device(&d).1 != a.headphones)
        });
        if stale {
            *slot = None;
        } else if let Some(a) = slot.as_mut() {
            if a.at.elapsed().as_secs() >= 3 {
                a.at = std::time::Instant::now();
            }
        }
        if slot.is_none() {
            *slot = open_audio();
        }
        let Some(a) = slot.as_ref() else {
            return (-1, false, false, NO_EARS);
        };
        let level = unsafe { a.volume.GetMasterVolumeLevelScalar() };
        let muted = unsafe { a.volume.GetMute() };
        let peak = unsafe { a.meter.GetPeakValue() };
        match (level, muted, peak) {
            (Ok(level), Ok(muted), Ok(peak)) => {
                let (mut db, mut left, mut right) = ear_levels(&a.volume);
                // Behind a virtual output both volumes count (dB add up) and
                // the ears are the real device's channels.
                if let Some(e) = &a.ears {
                    let (edb, el, er) = ear_levels(e);
                    (left, right) = (db + el, db + er);
                    db += edb;
                }
                (
                    (level * 100.).round() as i32,
                    muted.as_bool(),
                    peak > 0.002 && !muted.as_bool(),
                    Ears { headphones: a.headphones, db, left, right },
                )
            }
            _ => {
                // The default endpoint changed (headphones in or out): drop it
                // and pick the new one up on the next sample.
                *slot = None;
                (-1, false, false, NO_EARS)
            }
        }
    })
}

/// Per-ear gains (0..1, the louder ear at 1) applied to the default output:
/// the channels keep the current master level and only their ratio changes,
/// so Windows' own volume slider keeps working. Returns the gains that were
/// there before, for putting them back.
pub fn set_balance(left: f32, right: f32) -> Result<(f32, f32), String> {
    init();
    let default = default_device().ok_or("No audio output")?;
    // The balance goes where the ears are (the headphones behind FxSound etc.).
    let device = ears_device(&default).0.unwrap_or(default);
    unsafe {
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        if volume.GetChannelCount().unwrap_or(0) < 2 {
            return Err("Mono output".into());
        }
        let l0 = volume.GetChannelVolumeLevelScalar(0).map_err(|e| e.to_string())?;
        let r0 = volume.GetChannelVolumeLevelScalar(1).map_err(|e| e.to_string())?;
        let master = l0.max(r0).max(0.01);
        let (l, r) = (left.clamp(0., 1.), right.clamp(0., 1.));
        volume.SetChannelVolumeLevelScalar(0, master * l, std::ptr::null()).map_err(|e| e.to_string())?;
        volume.SetChannelVolumeLevelScalar(1, master * r, std::ptr::null()).map_err(|e| e.to_string())?;
        Ok((l0 / master, r0 / master))
    }
}

/// Master volume 0..1 on the default output (the "make it safe" button).
pub fn set_volume(level: f32) -> Result<(), String> {
    init();
    let device = default_device().ok_or("No audio output")?;
    unsafe {
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        volume.SetMasterVolumeLevelScalar(level.clamp(0., 1.), std::ptr::null()).map_err(|e| e.to_string())
    }
}

fn registry_dword(path: &str, name: &str) -> Option<u32> {
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (path, name) = (wide(path), wide(name));
    let mut value = 0u32;
    let mut size = 4u32;
    let ok = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            path.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut value as *mut u32 as *mut _,
            &mut size,
        )
    };
    (ok == 0).then_some(value)
}

fn memory_load() -> u8 {
    unsafe {
        let mut s: MEMORYSTATUSEX = std::mem::zeroed();
        s.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut s) == 0 {
            0
        } else {
            s.dwMemoryLoad.min(100) as u8
        }
    }
}

fn disk_free() -> u8 {
    unsafe {
        let mut root = [0u16; MAX_PATH as usize];
        let n = GetSystemDirectoryW(root.as_mut_ptr(), MAX_PATH);
        if n < 3 {
            return 0;
        }
        // "C:\" only: the drive Windows itself lives on.
        root[3] = 0;
        let (mut free, mut total, mut total_free) = (0u64, 0u64, 0u64);
        if GetDiskFreeSpaceExW(root.as_ptr(), &mut free, &mut total, &mut total_free) == 0
            || total == 0
        {
            return 0;
        }
        ((total_free as f64 / total as f64) * 100.).round() as u8
    }
}

unsafe extern "system" fn count_window(w: HWND, data: LPARAM) -> BOOL {
    // What a person would call an open program: visible, titled, not a tool
    // window and not owned by another window.
    if IsWindowVisible(w) != 0
        && GetWindow(w, GW_OWNER).is_null()
        && GetWindowTextLengthW(w) > 0
        && GetWindowLongW(w, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW == 0
    {
        *(data as *mut u32) += 1;
    }
    TRUE
}

fn window_count() -> u32 {
    let mut n = 0u32;
    unsafe {
        EnumWindows(Some(count_window), &mut n as *mut u32 as LPARAM);
    }
    n
}

pub fn sample(audio_allowed: bool) -> Desktop {
    let (volume, muted, playing, ears) = if audio_allowed {
        audio()
    } else {
        (-1, false, false, NO_EARS)
    };
    Desktop {
        volume,
        muted,
        audio: playing,
        clipboard: unsafe { GetClipboardSequenceNumber() },
        caps: unsafe { GetKeyState(VK_CAPITAL as i32) } & 1 != 0,
        dark: registry_dword(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
            "AppsUseLightTheme",
        )
        .map(|v| v == 0)
        .unwrap_or(false),
        memory: memory_load(),
        disk: disk_free(),
        windows: window_count(),
        drives: unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() },
        mono: registry_dword("Software\\Microsoft\\Multimedia\\Audio", "AccessibilityMonoMixState") == Some(1),
        headphones: ears.headphones,
        db: ears.db,
        left: ears.left,
        right: ears.right,
    }
}
#[cfg(test)]
mod probe_channels {
    #[test]
    #[ignore]
    fn print_default_output_channels() {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::System::Com::CLSCTX_ALL;
        super::init();
        let device = super::default_device().expect("device");
        unsafe {
            let v: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).expect("volume");
            println!("channels={:?} master_db={:?} headphones={}", v.GetChannelCount(), v.GetMasterVolumeLevel(), super::is_headphones(&device));
            let (ears, headphones) = super::ears_device(&device);
            println!("default={:?} virtual={} ears={:?} headphones={}", super::device_names(&device), super::is_virtual(&device), ears.as_ref().map(super::device_names), headphones);
            if let Some(e) = ears {
                let v: IAudioEndpointVolume = e.Activate(CLSCTX_ALL, None).expect("volume");
                println!("ears channels={:?} db={:?}", v.GetChannelCount(), v.GetMasterVolumeLevel());
            }
        }
    }
}
