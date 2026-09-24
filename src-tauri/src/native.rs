use serde::{Deserialize, Serialize};
use std::{
    mem::size_of,
    ptr::{null, null_mut},
    sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU64, Ordering},
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::{
    Foundation::*,
    Graphics::{Dwm::*, Gdi::*},
    System::{Power::*, SystemInformation::*, Threading::*},
    UI::{Accessibility::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

#[derive(Clone, Copy, Default, Serialize, Deserialize, Debug)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}
impl From<RECT> for Rect {
    fn from(r: RECT) -> Self {
        Self {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Monitor {
    pub id: String,
    pub bounds: Rect,
    pub work: Rect,
    pub scale: f64,
    pub primary: bool,
}
#[derive(Clone, Serialize)]
pub struct Surface {
    pub id: isize,
    pub rect: Rect,
}
#[derive(Clone, Serialize)]
pub struct Foreground {
    pub id: isize,
    pub app: String,
    pub fullscreen: bool,
    pub desktop: bool,
}
#[derive(Clone, Serialize)]
pub struct Motion {
    pub x: i32,
    pub y: i32,
    pub down: bool,
    pub support: Option<Surface>,
}
static DIRTY: AtomicBool = AtomicBool::new(true);
// Global input counters fed by the low-level hooks below. Only counts and the
// last click point are kept: no virtual-key codes, no window titles.
static CLICKS: AtomicU64 = AtomicU64::new(0);
static RIGHT_CLICKS: AtomicU64 = AtomicU64::new(0);
static WHEEL: AtomicU64 = AtomicU64::new(0);
static KEYS: AtomicU64 = AtomicU64::new(0);
// PrintScreen presses only: the one key whose meaning ("a screenshot was
// taken") is worth a reaction. No other key code is ever looked at.
static SHOTS: AtomicU64 = AtomicU64::new(0);
static LAST_X: AtomicI32 = AtomicI32::new(0);
static LAST_Y: AtomicI32 = AtomicI32::new(0);
static LAST_T: AtomicU64 = AtomicU64::new(0);
static OWN_PID: AtomicU32 = AtomicU32::new(0);
pub static INPUT_ENABLED: AtomicBool = AtomicBool::new(true);
// Cursor jitter filter. A move counts as real activity only when, within one
// second, the pointer travelled ≥ 30 px along a path of ≥ 3 events and ended
// ≥ 15 px from where that second started. Sensor noise, a bumped desk or a
// single glitch jump stay below that; software "mouse jigglers" (injected
// input) are ignored entirely. Keys, clicks and the wheel are always real.
static MOVE_START_T: AtomicU64 = AtomicU64::new(0);
static MOVE_START_X: AtomicI32 = AtomicI32::new(0);
static MOVE_START_Y: AtomicI32 = AtomicI32::new(0);
static MOVE_PREV_X: AtomicI32 = AtomicI32::new(0);
static MOVE_PREV_Y: AtomicI32 = AtomicI32::new(0);
static MOVE_PATH: AtomicU64 = AtomicU64::new(0);
static MOVE_COUNT: AtomicU32 = AtomicU32::new(0);
static MOVE_REAL: AtomicBool = AtomicBool::new(false);
static JITTER: AtomicU64 = AtomicU64::new(0);
static LAST_REAL: AtomicU64 = AtomicU64::new(0);
static HOOKS_OK: AtomicBool = AtomicBool::new(false);
/// Pure form of the jitter rule, for tests.
pub fn real_motion(path: u64, count: u32, net: f64) -> bool {
    path >= 30 && count >= 3 && net >= 15.
}
fn mark_real() {
    LAST_REAL.store(unsafe { GetTickCount64() }, Ordering::Relaxed);
}
/// Milliseconds since the last real input (filtered), or None when the
/// low-level hooks are not running and GetLastInputInfo must be used.
pub fn filtered_idle() -> Option<u64> {
    if !HOOKS_OK.load(Ordering::Relaxed) || !INPUT_ENABLED.load(Ordering::Relaxed) {
        return None;
    }
    let last = LAST_REAL.load(Ordering::Relaxed);
    Some(unsafe { GetTickCount64() }.saturating_sub(last))
}
pub fn jitter_count() -> u64 {
    JITTER.load(Ordering::Relaxed)
}
unsafe fn on_move(x: i32, y: i32, injected: bool) {
    if injected {
        return;
    }
    let now = GetTickCount64();
    if now.saturating_sub(MOVE_START_T.load(Ordering::Relaxed)) > 1000 {
        // Close the previous one-second window: movement that never became
        // real was jitter.
        if MOVE_COUNT.load(Ordering::Relaxed) > 0 && !MOVE_REAL.load(Ordering::Relaxed) {
            JITTER.fetch_add(1, Ordering::Relaxed);
        }
        MOVE_START_T.store(now, Ordering::Relaxed);
        MOVE_START_X.store(x, Ordering::Relaxed);
        MOVE_START_Y.store(y, Ordering::Relaxed);
        MOVE_PREV_X.store(x, Ordering::Relaxed);
        MOVE_PREV_Y.store(y, Ordering::Relaxed);
        MOVE_PATH.store(0, Ordering::Relaxed);
        MOVE_COUNT.store(0, Ordering::Relaxed);
        MOVE_REAL.store(false, Ordering::Relaxed);
        return;
    }
    let dx = (x - MOVE_PREV_X.load(Ordering::Relaxed)) as f64;
    let dy = (y - MOVE_PREV_Y.load(Ordering::Relaxed)) as f64;
    MOVE_PREV_X.store(x, Ordering::Relaxed);
    MOVE_PREV_Y.store(y, Ordering::Relaxed);
    let path = MOVE_PATH.fetch_add(dx.hypot(dy) as u64, Ordering::Relaxed) + dx.hypot(dy) as u64;
    let count = MOVE_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    let net = ((x - MOVE_START_X.load(Ordering::Relaxed)) as f64)
        .hypot((y - MOVE_START_Y.load(Ordering::Relaxed)) as f64);
    if real_motion(path, count, net) {
        MOVE_REAL.store(true, Ordering::Relaxed);
        mark_real();
    }
}
#[derive(Clone, Copy, Serialize)]
pub struct Click {
    pub x: i32,
    pub y: i32,
    pub t: u64,
}
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub clicks: u64,
    pub right_clicks: u64,
    pub wheel: u64,
    pub keys: u64,
    pub shots: u64,
    pub last_click: Option<Click>,
}
pub fn input_counters() -> Input {
    let t = LAST_T.load(Ordering::Relaxed);
    Input {
        clicks: CLICKS.load(Ordering::Relaxed),
        right_clicks: RIGHT_CLICKS.load(Ordering::Relaxed),
        wheel: WHEEL.load(Ordering::Relaxed),
        keys: KEYS.load(Ordering::Relaxed),
        shots: SHOTS.load(Ordering::Relaxed),
        last_click: (t > 0).then(|| Click {
            x: LAST_X.load(Ordering::Relaxed),
            y: LAST_Y.load(Ordering::Relaxed),
            t,
        }),
    }
}
unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && INPUT_ENABLED.load(Ordering::Relaxed) {
        let msg = wparam as u32;
        let info = &*(lparam as *const MSLLHOOKSTRUCT);
        if msg == WM_MOUSEMOVE {
            on_move(info.pt.x, info.pt.y, info.flags & LLMHF_INJECTED != 0);
        } else if info.flags & LLMHF_INJECTED == 0 {
            mark_real();
        }
        if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN {
            let info = &*(lparam as *const MSLLHOOKSTRUCT);
            let mut pid = 0u32;
            GetWindowThreadProcessId(WindowFromPoint(info.pt), &mut pid);
            if pid != OWN_PID.load(Ordering::Relaxed) {
                if msg == WM_LBUTTONDOWN {
                    CLICKS.fetch_add(1, Ordering::Relaxed);
                } else {
                    RIGHT_CLICKS.fetch_add(1, Ordering::Relaxed);
                }
                LAST_X.store(info.pt.x, Ordering::Relaxed);
                LAST_Y.store(info.pt.y, Ordering::Relaxed);
                LAST_T.store(GetTickCount64(), Ordering::Relaxed);
            }
        } else if msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL {
            WHEEL.fetch_add(1, Ordering::Relaxed);
        }
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}
unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && INPUT_ENABLED.load(Ordering::Relaxed) {
        let msg = wparam as u32;
        if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
            KEYS.fetch_add(1, Ordering::Relaxed);
            mark_real();
        }
        // PrintScreen reports only a key-up on most keyboards, but some
        // drivers (and SendKeys) send a key-down instead, so accept either;
        // the reaction has its own cooldown.
        if (msg == WM_KEYUP || msg == WM_KEYDOWN)
            && (*(lparam as *const KBDLLHOOKSTRUCT)).vkCode == VK_SNAPSHOT as u32
        {
            SHOTS.fetch_add(1, Ordering::Relaxed);
        }
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}
// The process is Per-Monitor V2 DPI aware through the application manifest
// (see build.rs), so every Win32 coordinate below is a physical pixel on all
// threads. No per-thread DPI context switching is needed.
pub unsafe fn configure(hwnd: HWND) {
    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    SetWindowLongPtrW(
        hwnd,
        GWL_EXSTYLE,
        style | WS_EX_NOACTIVATE as isize | WS_EX_TOOLWINDOW as isize,
    );
    SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
    );
}
/// Applies the overlay window rect and pixel region. `scale` is the WebView's
/// devicePixelRatio: logical canvas pixels × scale = physical window pixels.
/// Returns the DPI scale Windows actually assigned to the window after the
/// move, so the caller can detect a mismatch on mixed-DPI monitor edges.
pub unsafe fn pose(hwnd: HWND, x: i32, y: i32, scale: f64, rects: &[Rect]) -> f64 {
    let region = CreateRectRgn(0, 0, 0, 0);
    for r in rects.iter().take(300) {
        let p = CreateRectRgn(
            (r.left as f64 * scale).floor() as i32,
            (r.top as f64 * scale).floor() as i32,
            (r.right as f64 * scale).ceil() as i32,
            (r.bottom as f64 * scale).ceil() as i32,
        );
        CombineRgn(region, region, p, RGN_OR);
        DeleteObject(p as _);
    }
    if SetWindowRgn(hwnd, region, 1) == 0 {
        DeleteObject(region as _);
    }
    SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        x,
        y,
        (360. * scale).round() as i32,
        (340. * scale).round() as i32,
        SWP_NOACTIVATE | SWP_NOOWNERZORDER,
    );
    window_scale(hwnd)
}
/// DPI scale of the monitor Windows currently associates with the window.
pub unsafe fn window_scale(hwnd: HWND) -> f64 {
    let dpi = windows_sys::Win32::UI::HiDpi::GetDpiForWindow(hwnd);
    if dpi == 0 { 1. } else { dpi as f64 / 96. }
}
pub unsafe fn show(hwnd: HWND, yes: bool) {
    ShowWindow(hwnd, if yes { SW_SHOWNOACTIVATE } else { SW_HIDE });
}
pub fn monitors() -> Vec<Monitor> {
    unsafe extern "system" fn callback(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let list = &mut *(data as *mut Vec<Monitor>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(m, &mut info.monitorInfo) != 0 {
            let n = info
                .szDevice
                .iter()
                .position(|v| *v == 0)
                .unwrap_or(info.szDevice.len());
            let mut x = 96;
            let mut y = 96;
            let _ = windows_sys::Win32::UI::HiDpi::GetDpiForMonitor(m, 0, &mut x, &mut y);
            list.push(Monitor {
                id: String::from_utf16_lossy(&info.szDevice[..n]),
                bounds: info.monitorInfo.rcMonitor.into(),
                work: info.monitorInfo.rcWork.into(),
                scale: x as f64 / 96.,
                primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        1
    }
    let mut list = vec![];
    unsafe {
        EnumDisplayMonitors(
            null_mut(),
            null(),
            Some(callback),
            &mut list as *mut _ as isize,
        );
    }
    list
}
pub fn surface(hwnd: HWND) -> Option<Surface> {
    unsafe {
        if hwnd.is_null()
            || IsWindow(hwnd) == 0
            || IsWindowVisible(hwnd) == 0
            || IsIconic(hwnd) != 0
        {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == GetCurrentProcessId() {
            return None;
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED as u32, &mut cloaked as *mut _ as _, 4);
        if cloaked != 0 {
            return None;
        }
        let mut r: RECT = std::mem::zeroed();
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut r as *mut _ as _,
            size_of::<RECT>() as u32,
        ) < 0
        {
            GetWindowRect(hwnd, &mut r);
        }
        if r.right - r.left < 160 || r.bottom - r.top < 80 {
            return None;
        }
        Some(Surface {
            id: hwnd as isize,
            rect: r.into(),
        })
    }
}
pub fn windows() -> Vec<Surface> {
    unsafe extern "system" fn each(w: HWND, data: LPARAM) -> BOOL {
        let v = &mut *(data as *mut Vec<Surface>);
        if v.len() >= 32 {
            return 0;
        }
        let st = GetWindowLongPtrW(w, GWL_EXSTYLE);
        if st & WS_EX_TOOLWINDOW as isize == 0 {
            if let Some(s) = surface(w) {
                v.push(s)
            }
        }
        1
    }
    let mut v = vec![];
    unsafe {
        EnumWindows(Some(each), &mut v as *mut _ as isize);
    }
    v
}
pub fn foreground(include_name: bool, monitors: &[Monitor]) -> Foreground {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut class = [0u16; 128];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), 128);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        let desktop = class == "Progman" || class == "WorkerW" || class == "Shell_TrayWnd";
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut app = String::new();
        if include_name && pid != GetCurrentProcessId() {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut buffer = [0u16; 1024];
                let mut len = buffer.len() as u32;
                if QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut len) != 0 {
                    app = String::from_utf16_lossy(&buffer[..len as usize])
                        .rsplit('\\')
                        .next()
                        .unwrap_or("")
                        .to_lowercase();
                }
                CloseHandle(process);
            }
        }
        let fullscreen = !desktop
            && surface(hwnd)
                .map(|s| {
                    monitors.iter().any(|m| {
                        s.rect.left <= m.bounds.left + 2
                            && s.rect.top <= m.bounds.top + 2
                            && s.rect.right >= m.bounds.right - 2
                            && s.rect.bottom >= m.bounds.bottom - 2
                    })
                })
                .unwrap_or(false);
        Foreground {
            id: hwnd as isize,
            app,
            fullscreen,
            desktop,
        }
    }
}
pub fn idle() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info) == 0 {
            return 0;
        }
        (GetTickCount().wrapping_sub(info.dwTime)) as u64
    }
}
pub fn motion(support: isize) -> Motion {
    unsafe {
        let mut p: POINT = std::mem::zeroed();
        GetCursorPos(&mut p);
        Motion {
            x: p.x,
            y: p.y,
            down: (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0,
            support: surface(support as HWND),
        }
    }
}
pub fn power() -> (Option<u8>, bool) {
    unsafe {
        let mut s: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut s) == 0
            || s.BatteryFlag == 255
            || s.BatteryFlag & 128 != 0
            || s.BatteryLifePercent > 100
        {
            return (None, false);
        }
        (Some(s.BatteryLifePercent), s.ACLineStatus == 1)
    }
}
pub fn cpu_ticks() -> Option<(u64, u64)> {
    unsafe {
        let (mut idle, mut kernel, mut user): (FILETIME, FILETIME, FILETIME) = std::mem::zeroed();
        if GetSystemTimes(&mut idle, &mut kernel, &mut user) == 0 {
            return None;
        }
        let t = |v: FILETIME| ((v.dwHighDateTime as u64) << 32) | v.dwLowDateTime as u64;
        Some((t(idle), t(kernel) + t(user)))
    }
}
pub fn controller_active(last: &mut [u32; 4]) -> bool {
    use windows_sys::Win32::UI::Input::XboxController::*;
    let mut active = false;
    for i in 0..4 {
        let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
        if unsafe { XInputGetState(i as u32, &mut state) } == 0 {
            if state.dwPacketNumber != last[i] {
                active = true;
                last[i] = state.dwPacketNumber
            }
        }
    }
    active
}
pub fn session_locked() -> bool {
    unsafe {
        use windows_sys::Win32::System::StationsAndDesktops::*;
        let d = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
        if d.is_null() {
            true
        } else {
            CloseDesktop(d);
            false
        }
    }
}
unsafe extern "system" fn win_event(
    _: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    obj: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    if obj == 0 {
        DIRTY.store(true, Ordering::Relaxed)
    }
    // A classic console window appeared: resolve who owns it right now,
    // before a short-lived process disappears.
    if event == EVENT_OBJECT_SHOW && obj == 0 && child == 0 && !hwnd.is_null() {
        let mut class = [0u16; 32];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), 32);
        if n > 0 && String::from_utf16_lossy(&class[..n as usize]) == "ConsoleWindowClass" {
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid != 0 {
                crate::trace::console_shown(pid);
            }
        }
    }
}
/// Global hotkeys, registered on the hook thread with explicit ids so the
/// result is deterministic and reported. A chord owned by another program
/// simply stays unavailable (the tray offers the same actions).
pub const HOTKEY_SUMMON: i32 = 1;
pub const HOTKEY_CHAT: i32 = 2;
pub fn hook_thread(app: tauri::AppHandle, on_hotkey: Box<dyn Fn(i32) + Send>) {
    std::thread::spawn(move || unsafe {
        use tauri::Manager;
        let chords = [
            (HOTKEY_SUMMON, "Ctrl+Alt+D", 0x44u32),
            (HOTKEY_CHAT, "Ctrl+Alt+C", 0x43u32),
        ];
        let mut report = vec![];
        for (id, name, vk) in chords {
            let ok = RegisterHotKey(null_mut(), id, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, vk) != 0;
            report.push(format!("{name} {}", if ok { "registered" } else { "unavailable (taken by another program)" }));
        }
        {
            let state = app.state::<crate::storage::State>();
            if crate::storage::diag_enabled(&state.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings) {
                crate::storage::diag("rs", &format!("hotkeys: {}", report.join("; ")));
            }
        }
        let hooks = [
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_MINIMIZESTART,
            EVENT_SYSTEM_MINIMIZEEND,
            EVENT_OBJECT_LOCATIONCHANGE,
            EVENT_OBJECT_DESTROY,
            EVENT_OBJECT_SHOW,
        ]
        .map(|event| {
            SetWinEventHook(
                event,
                event,
                null_mut(),
                Some(win_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        });
        OWN_PID.store(GetCurrentProcessId(), Ordering::Relaxed);
        let module = GetModuleHandleW(null());
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), module, 0);
        let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), module, 0);
        mark_real();
        HOOKS_OK.store(!mouse.is_null() && !keyboard.is_null(), Ordering::Relaxed);
        {
            let state = app.state::<crate::storage::State>();
            if crate::storage::diag_enabled(&state.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings) {
                crate::storage::diag(
                    "rs",
                    &format!(
                        "input hooks: mouse {} keyboard {}",
                        if mouse.is_null() { "failed" } else { "ok" },
                        if keyboard.is_null() { "failed" } else { "ok" }
                    ),
                );
            }
        }
        let mut msg: MSG = std::mem::zeroed();
        while !app
            .state::<crate::storage::State>()
            .stop
            .load(Ordering::Relaxed)
        {
            while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_HOTKEY {
                    on_hotkey(msg.wParam as i32);
                    continue;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            MsgWaitForMultipleObjectsEx(0, null(), 250, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }
        for hook in hooks {
            if !hook.is_null() {
                UnhookWinEvent(hook);
            }
        }
        HOOKS_OK.store(false, Ordering::Relaxed);
        for hook in [mouse, keyboard] {
            if !hook.is_null() {
                UnhookWindowsHookEx(hook);
            }
        }
        for (id, _, _) in chords {
            UnregisterHotKey(null_mut(), id);
        }
    });
}
pub fn dirty() -> bool {
    DIRTY.swap(false, Ordering::Relaxed)
}
#[cfg(test)]
mod jitter_tests {
    use super::real_motion;
    #[test]
    fn jitter_is_not_activity() {
        // Sensor noise: many tiny back-and-forth moves.
        assert!(!real_motion(20, 12, 2.));
        // A bumped desk: one jump.
        assert!(!real_motion(40, 1, 40.));
        // Shaking in place: long path, no net movement.
        assert!(!real_motion(120, 20, 6.));
        // A real hand move.
        assert!(real_motion(140, 9, 110.));
    }
}
