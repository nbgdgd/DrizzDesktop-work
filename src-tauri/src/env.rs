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
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
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
}

thread_local! {
    static AUDIO: RefCell<Option<Audio>> = const { RefCell::new(None) };
}
struct Audio {
    volume: IAudioEndpointVolume,
    meter: IAudioMeterInformation,
}

/// COM for this thread; call once before [`sample`].
pub fn init() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn open_audio() -> Option<Audio> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device: IMMDevice = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        Some(Audio {
            volume: device.Activate(CLSCTX_ALL, None).ok()?,
            meter: device.Activate(CLSCTX_ALL, None).ok()?,
        })
    }
}

/// Volume 0..100 (-1 unknown), muted, and whether sound is playing.
fn audio() -> (i32, bool, bool) {
    AUDIO.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = open_audio();
        }
        let Some(a) = slot.as_ref() else {
            return (-1, false, false);
        };
        let level = unsafe { a.volume.GetMasterVolumeLevelScalar() };
        let muted = unsafe { a.volume.GetMute() };
        let peak = unsafe { a.meter.GetPeakValue() };
        match (level, muted, peak) {
            (Ok(level), Ok(muted), Ok(peak)) => (
                (level * 100.).round() as i32,
                muted.as_bool(),
                peak > 0.002 && !muted.as_bool(),
            ),
            _ => {
                // The default endpoint changed (headphones in or out): drop it
                // and pick the new one up on the next sample.
                *slot = None;
                (-1, false, false)
            }
        }
    })
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
    let (volume, muted, playing) = if audio_allowed {
        audio()
    } else {
        (-1, false, false)
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
    }
}
