// CPU and GPU load with spike detection and a culprit.
//
// CPU comes from GetSystemTimes, GPU from the "GPU Engine" performance
// counters (Windows 10 1709+, the same source Task Manager uses): per engine
// the utilisation of all processes is summed, the busiest engine is the GPU
// load, and the process with the largest share on it is the culprit.
// A spike is a sudden rise over the recent baseline, not merely "high":
// average of the last 5 s ≥ 70 % and at least 30 points above a slow
// baseline, held for 3 s. The culprit for CPU is measured only then, by
// sampling per-process CPU time twice one second apart.
use crate::{
    native,
    storage::{self, enabled, State},
};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    mem::size_of,
    ptr::null,
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::Performance::*,
    System::SystemInformation::{GetSystemInfo, SYSTEM_INFO},
    System::Threading::{
        GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

#[derive(Clone, Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Culprit {
    pub pid: u32,
    pub name: String,
    pub path: String,
    pub pct: f64,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoadState {
    pub cpu: Option<f64>,
    pub gpu: Option<f64>,
    pub cpu_base: Option<f64>,
    pub gpu_base: Option<f64>,
    pub gpu_available: bool,
    pub gpu_top: Option<Culprit>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spike {
    pub kind: String,
    pub value: f64,
    pub base: f64,
    pub top: Vec<Culprit>,
}

static CURRENT: Mutex<Option<LoadState>> = Mutex::new(None);

pub fn current() -> LoadState {
    CURRENT.lock().ok().and_then(|c| c.clone()).unwrap_or_default()
}

/// Spike detector for one metric. Pure, so it is unit-tested.
pub struct Detector {
    recent: VecDeque<f64>,
    pub base: Option<f64>,
    above: u32,
    armed: bool,
    samples: u32,
    last: Option<Instant>,
}
impl Detector {
    pub fn new() -> Self {
        Self { recent: VecDeque::new(), base: None, above: 0, armed: true, samples: 0, last: None }
    }
    pub fn fast(&self) -> Option<f64> {
        (!self.recent.is_empty()).then(|| self.recent.iter().sum::<f64>() / self.recent.len() as f64)
    }
    /// Feed one sample per second; returns Some(value, base) on a spike.
    pub fn push(&mut self, v: f64, cooldown: Duration) -> Option<(f64, f64)> {
        self.recent.push_back(v);
        while self.recent.len() > 5 {
            self.recent.pop_front();
        }
        let fast = self.fast()?;
        let base = *self.base.get_or_insert(v);
        self.samples = self.samples.saturating_add(1);
        // Warm-up: the first 10 s are averaged, so the load of our own start
        // does not become the baseline. Afterwards the baseline drops quickly
        // (≈ 30 s), rises slowly (≈ 90 s) and barely moves during a spike, so
        // a long render is reported once, not as "the new normal".
        let alpha = if self.samples <= 10 {
            1. / self.samples as f64
        } else if v < base {
            1. / 30.
        } else if fast > base + 20. {
            1. / 400.
        } else {
            1. / 90.
        };
        self.base = Some(base + (v - base) * alpha);
        if !self.armed && fast < base + 15. && fast < 60. {
            self.armed = true;
        }
        if fast >= 70. && fast - base >= 30. && self.recent.len() >= 5 {
            self.above += 1;
        } else {
            self.above = 0;
        }
        if self.armed
            && self.above >= 3
            && self.last.map_or(true, |t| t.elapsed() >= cooldown)
        {
            self.armed = false;
            self.last = Some(Instant::now());
            return Some((fast, base));
        }
        None
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

struct Gpu {
    query: isize,
    counter: isize,
}
impl Gpu {
    fn open() -> Option<Self> {
        unsafe {
            let mut query = 0;
            if PdhOpenQueryW(null(), 0, &mut query) != 0 {
                return None;
            }
            let mut counter = 0;
            let path = wide("\\GPU Engine(*)\\Utilization Percentage");
            if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
                PdhCloseQuery(query);
                return None;
            }
            PdhCollectQueryData(query);
            Some(Self { query, counter })
        }
    }
    /// (busiest engine %, pid with the largest share on that engine)
    fn sample(&self) -> Option<(f64, Option<(u32, f64)>)> {
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            let mut size = 0u32;
            let mut count = 0u32;
            let r = PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, std::ptr::null_mut());
            if r != PDH_MORE_DATA || size == 0 {
                return Some((0., None));
            }
            let mut buf = vec![0u64; (size as usize + 7) / 8];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, items) != 0 {
                return None;
            }
            let mut engines: HashMap<String, f64> = HashMap::new();
            let mut per: HashMap<(String, u32), f64> = HashMap::new();
            for i in 0..count as usize {
                let item = &*items.add(i);
                if item.FmtValue.CStatus != 0 {
                    continue;
                }
                let v = item.FmtValue.Anonymous.doubleValue;
                let mut n = 0;
                while *item.szName.add(n) != 0 {
                    n += 1;
                }
                let name = String::from_utf16_lossy(std::slice::from_raw_parts(item.szName, n));
                let (pid, engine) = parse_instance(&name);
                *engines.entry(engine.clone()).or_default() += v;
                *per.entry((engine, pid)).or_default() += v;
            }
            let Some((engine, total)) = engines.into_iter().max_by(|a, b| a.1.total_cmp(&b.1)) else {
                return Some((0., None));
            };
            let top = per
                .into_iter()
                .filter(|((e, _), _)| *e == engine)
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .map(|((_, pid), v)| (pid, v));
            Some((total.min(100.), top))
        }
    }
}
impl Drop for Gpu {
    fn drop(&mut self) {
        unsafe {
            PdhCloseQuery(self.query);
        }
    }
}

/// "pid_1234_luid_0x0_0x1_phys_0_eng_3_engtype_3D" → (1234, "luid_0x0_0x1_phys_0_eng_3")
pub fn parse_instance(name: &str) -> (u32, String) {
    let pid = name
        .strip_prefix("pid_")
        .and_then(|r| r.split('_').next())
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    let engine = name
        .find("luid_")
        .map(|i| &name[i..])
        .map(|s| s.split("_engtype").next().unwrap_or(s).to_string())
        .unwrap_or_default();
    (pid, engine)
}

fn proc_path(pid: u32) -> String {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let s = if QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::new()
        };
        CloseHandle(h);
        s
    }
}

fn culprit(pid: u32, pct: f64) -> Culprit {
    let path = proc_path(pid);
    let name = path.rsplit('\\').next().unwrap_or("").to_lowercase();
    Culprit { pid, name, path, pct: (pct * 10.).round() / 10. }
}

fn cpu_times() -> HashMap<u32, u64> {
    let mut out = HashMap::new();
    unsafe {
        use windows_sys::Win32::System::Diagnostics::ToolHelp::*;
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                let pid = e.th32ProcessID;
                if pid > 4 {
                    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if !h.is_null() {
                        let mut c: FILETIME = std::mem::zeroed();
                        let (mut x, mut k, mut u) = (c, c, c);
                        if GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) != 0 {
                            let t = |f: FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
                            out.insert(pid, t(k) + t(u));
                        }
                        CloseHandle(h);
                    }
                }
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

/// Top CPU consumers over one second, percent of the whole machine.
fn cpu_culprits() -> Vec<Culprit> {
    let cores = unsafe {
        let mut si: SYSTEM_INFO = std::mem::zeroed();
        GetSystemInfo(&mut si);
        si.dwNumberOfProcessors.max(1) as f64
    };
    let a = cpu_times();
    let start = Instant::now();
    std::thread::sleep(Duration::from_millis(1000));
    let b = cpu_times();
    let wall = start.elapsed().as_nanos() as f64 / 100.;
    let mut top: Vec<(u32, f64)> = b
        .iter()
        .filter_map(|(pid, t)| a.get(pid).map(|s| (*pid, t.saturating_sub(*s) as f64 / wall / cores * 100.)))
        .filter(|(_, p)| *p >= 0.5)
        .collect();
    top.sort_by(|x, y| y.1.total_cmp(&x.1));
    // Worker pools (browsers, compilers, Python multiprocessing) are one
    // program to the user: sum by executable, keep the busiest PID for the path.
    let mut by_name: Vec<Culprit> = vec![];
    for (pid, p) in top {
        let c = culprit(pid, p);
        match by_name.iter_mut().find(|x| x.name == c.name) {
            Some(x) => x.pct = ((x.pct + c.pct) * 10.).round() / 10.,
            None => by_name.push(c),
        }
    }
    by_name.sort_by(|x, y| y.pct.total_cmp(&x.pct));
    by_name.truncate(3);
    by_name
}

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut ticks = native::cpu_ticks();
        let mut cpu = Detector::new();
        let mut gpu_det = Detector::new();
        let mut gpu: Option<Gpu> = None;
        let mut gpu_tried = false;
        while !app.state::<State>().stop.load(Ordering::Relaxed) {
            let settings = app.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings.clone();
            let system = enabled(&settings, "observeSystem", true);
            if !system {
                *CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }
            let cooldown = Duration::from_secs(300);
            let current = native::cpu_ticks();
            let mut state = LoadState::default();
            if let (Some((i, t)), Some((ii, tt))) = (ticks, current) {
                if tt > t {
                    let v = ((1. - (ii - i) as f64 / (tt - t) as f64) * 100.).clamp(0., 100.);
                    state.cpu = Some(v);
                    if let Some((value, base)) = cpu.push(v, cooldown) {
                        let top = cpu_culprits();
                        emit(&app, &settings, Spike { kind: "cpu".into(), value, base, top });
                    }
                }
            }
            ticks = current;
            state.cpu_base = cpu.base;
            if enabled(&settings, "observeGpu", true) {
                if gpu.is_none() && !gpu_tried {
                    gpu_tried = true;
                    gpu = Gpu::open();
                }
                if let Some(g) = &gpu {
                    if let Some((v, top)) = g.sample() {
                        state.gpu = Some(v);
                        state.gpu_available = true;
                        state.gpu_top = top.filter(|t| t.0 != 0 && t.1 >= 5.).map(|(pid, p)| culprit(pid, p));
                        if let Some((value, base)) = gpu_det.push(v, cooldown) {
                            let top = state.gpu_top.clone().into_iter().collect();
                            emit(&app, &settings, Spike { kind: "gpu".into(), value, base, top });
                        }
                    }
                }
                state.gpu_base = gpu_det.base;
            } else {
                gpu = None;
                gpu_tried = false;
            }
            *CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(state);
            std::thread::sleep(Duration::from_millis(1000));
        }
    });
}

fn emit(app: &tauri::AppHandle, settings: &serde_json::Value, spike: Spike) {
    if storage::diag_enabled(settings) {
        storage::diag(
            "load",
            &format!(
                "{} spike {:.0}% over base {:.0}%: {}",
                spike.kind,
                spike.value,
                spike.base,
                spike.top.iter().map(|c| format!("{} {:.0}%", c.name, c.pct)).collect::<Vec<_>>().join(", ")
            ),
        );
    }
    let _ = app.emit_all("load-spike", spike);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_sudden_rise_once() {
        let mut d = Detector::new();
        let cd = Duration::from_secs(300);
        for _ in 0..120 {
            assert!(d.push(12., cd).is_none());
        }
        let mut fired = 0;
        for _ in 0..60 {
            if d.push(95., cd).is_some() {
                fired += 1;
            }
        }
        assert_eq!(fired, 1, "a long burst is reported once");
    }
    #[test]
    fn ignores_steady_high_and_blips() {
        let mut d = Detector::new();
        let cd = Duration::from_secs(0);
        for _ in 0..200 {
            assert!(d.push(80., cd).is_none(), "already high is not a spike");
        }
        let mut d = Detector::new();
        for _ in 0..60 {
            d.push(10., cd);
        }
        assert!(d.push(100., cd).is_none());
        assert!(d.push(10., cd).is_none());
        for _ in 0..10 {
            assert!(d.push(10., cd).is_none(), "one-second blip is ignored");
        }
    }
    #[test]
    fn parses_gpu_instances() {
        let (pid, e) = parse_instance("pid_1234_luid_0x00000000_0x0000C0E3_phys_0_eng_3_engtype_3D");
        assert_eq!(pid, 1234);
        assert_eq!(e, "luid_0x00000000_0x0000C0E3_phys_0_eng_3");
    }
}
#[cfg(test)]
mod busy_machine {
    use super::*;
    #[test]
    fn spike_on_already_busy_machine() {
        let mut d = Detector::new();
        let cd = Duration::from_secs(300);
        d.push(100., cd);
        for i in 0..55 {
            assert!(d.push(if i % 3 == 0 { 60. } else { 40. }, cd).is_none());
        }
        let fired = (0..14).filter(|_| d.push(100., cd).is_some()).count();
        println!("base {:?}", d.base);
        assert_eq!(fired, 1);
    }
}
