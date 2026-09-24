//! Foreground time per program. Seconds are accumulated per calendar day and
//! executable name only; no window titles. Written to `usage.json` next to
//! `state.json` at most once a minute and on exit.
use crate::storage::root;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    sync::Mutex,
    time::{Duration, Instant},
};

pub type Days = BTreeMap<String, BTreeMap<String, u64>>;
const KEEP_DAYS: usize = 90;

pub struct Usage {
    pub days: Days,
    dirty: bool,
    last_flush: Instant,
}
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct Entry {
    pub app: String,
    pub seconds: u64,
}
#[derive(Clone, Serialize, Default)]
pub struct Stats {
    pub today: Vec<Entry>,
    pub week: Vec<Entry>,
    pub month: Vec<Entry>,
    pub all: Vec<Entry>,
}
#[derive(Clone, Serialize, Default)]
pub struct Today {
    pub today: Vec<Entry>,
}

static USAGE: Mutex<Option<Usage>> = Mutex::new(None);

fn path() -> std::path::PathBuf {
    root().join("usage.json")
}
pub fn parse(bytes: &[u8]) -> Days {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|v| v.get("days").cloned())
        .and_then(|d| serde_json::from_value::<Days>(d).ok())
        .unwrap_or_default()
}
fn load() -> Usage {
    let file = path();
    let days = match fs::read(&file) {
        Ok(bytes) => {
            let parsed = parse(&bytes);
            if parsed.is_empty() && !bytes.is_empty() {
                let _ = fs::rename(&file, root().join("usage.bad.json"));
            }
            parsed
        }
        Err(_) => Days::new(),
    };
    Usage {
        days,
        dirty: false,
        last_flush: Instant::now(),
    }
}
fn with<T>(f: impl FnOnce(&mut Usage) -> T) -> T {
    let mut guard = USAGE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(load());
    }
    f(guard.as_mut().unwrap())
}
pub fn trim(days: &mut Days) {
    while days.len() > KEEP_DAYS {
        let first = days.keys().next().cloned().unwrap();
        days.remove(&first);
    }
}
pub fn add(days: &mut Days, today: &str, app: &str, seconds: u64) {
    if app.is_empty() || seconds == 0 {
        return;
    }
    *days
        .entry(today.to_owned())
        .or_default()
        .entry(app.to_owned())
        .or_default() += seconds;
    trim(days);
}
pub fn record(app: &str, seconds: u64, today: &str) {
    with(|u| {
        add(&mut u.days, today, app, seconds);
        u.dirty = true;
        if u.last_flush.elapsed() >= Duration::from_secs(60) {
            write(u);
        }
    });
}
fn write(u: &mut Usage) {
    if !u.dirty {
        return;
    }
    let _ = fs::create_dir_all(root());
    let text = serde_json::json!({ "days": u.days }).to_string();
    if fs::write(path(), text).is_ok() {
        u.dirty = false;
    }
    u.last_flush = Instant::now();
}
/// Periodic flush from the observe loop so the last minute of a session is
/// not lost when the user walks away before the next record.
pub fn flush_if_stale() {
    if let Some(u) = USAGE.lock().unwrap().as_mut() {
        if u.dirty && u.last_flush.elapsed() >= Duration::from_secs(60) {
            write(u);
        }
    }
}
pub fn flush() {
    if let Some(u) = USAGE.lock().unwrap().as_mut() {
        write(u);
    }
}
pub fn sum(days: &Days, keys: impl Iterator<Item = String>) -> Vec<Entry> {
    let mut totals: BTreeMap<String, u64> = BTreeMap::new();
    for k in keys {
        if let Some(day) = days.get(&k) {
            for (app, s) in day {
                *totals.entry(app.clone()).or_default() += s;
            }
        }
    }
    let mut v: Vec<Entry> = totals
        .into_iter()
        .map(|(app, seconds)| Entry { app, seconds })
        .collect();
    v.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(a.app.cmp(&b.app)));
    v
}
// Proleptic Gregorian day count (Howard Hinnant's civil algorithms) so a
// "last N days" window is calendar based without a date crate.
fn day_number(date: &str) -> Option<i64> {
    let mut it = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (it.next()??, it.next()??, it.next()??);
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}
pub fn aggregate(days: &Days, today: &str) -> Stats {
    let now = day_number(today).unwrap_or(0);
    let window = |n: i64| {
        days.keys()
            .filter(|k| {
                day_number(k).map_or(false, |d| d <= now && d > now - n)
            })
            .cloned()
            .collect::<Vec<_>>()
    };
    Stats {
        today: sum(days, std::iter::once(today.to_owned())),
        week: sum(days, window(7).into_iter()),
        month: sum(days, window(30).into_iter()),
        all: sum(days, days.keys().cloned()),
    }
}
pub fn stats(today: &str) -> Stats {
    with(|u| aggregate(&u.days, today))
}
pub fn today_top(today: &str, n: usize) -> Today {
    with(|u| Today {
        today: sum(&u.days, std::iter::once(today.to_owned()))
            .into_iter()
            .take(n)
            .collect(),
    })
}
pub fn clear() {
    with(|u| {
        u.days.clear();
        u.dirty = true;
        write(u);
    });
}
/// Local calendar date `YYYY-MM-DD` for keying days; uses the Win32 local
/// time so the boundary matches the user's clock, not UTC.
pub fn today() -> String {
    unsafe {
        let mut t: windows_sys::Win32::Foundation::SYSTEMTIME = std::mem::zeroed();
        windows_sys::Win32::System::SystemInformation::GetLocalTime(&mut t);
        format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn record_sums_seconds_for_the_same_app_and_day() {
        let mut d = Days::new();
        add(&mut d, "2026-09-22", "chrome.exe", 3);
        add(&mut d, "2026-09-22", "chrome.exe", 4);
        add(&mut d, "2026-09-22", "code.exe", 1);
        let s = aggregate(&d, "2026-09-22");
        assert_eq!(s.today[0], Entry { app: "chrome.exe".into(), seconds: 7 });
        assert_eq!(s.today[1].seconds, 1);
    }
    #[test]
    fn trim_keeps_only_the_newest_ninety_days() {
        let mut d = Days::new();
        for i in 0..100 {
            add(&mut d, &format!("2026-01-{:03}", i), "a.exe", 1);
        }
        assert_eq!(d.len(), 90);
        assert!(d.contains_key("2026-01-099"));
        assert!(!d.contains_key("2026-01-009"));
    }
    #[test]
    fn periods_only_count_days_up_to_today() {
        let mut d = Days::new();
        add(&mut d, "2026-09-10", "a.exe", 10);
        add(&mut d, "2026-09-20", "a.exe", 20);
        add(&mut d, "2026-09-22", "b.exe", 5);
        let s = aggregate(&d, "2026-09-22");
        assert_eq!(s.week.iter().find(|e| e.app == "a.exe").unwrap().seconds, 20);
        assert_eq!(s.month.iter().find(|e| e.app == "a.exe").unwrap().seconds, 30);
        assert_eq!(s.all.len(), 2);
        assert_eq!(s.today.len(), 1);
        assert_eq!(day_number("2026-09-22").unwrap() - day_number("2026-09-10").unwrap(), 12);
        assert_eq!(day_number("2026-03-01").unwrap() - day_number("2026-02-28").unwrap(), 1);
    }
    #[test]
    fn broken_file_yields_empty_map() {
        assert!(parse(b"{bad").is_empty());
        assert!(parse(b"{\"days\":{\"2026-09-22\":{\"a.exe\":\"x\"}}}").is_empty());
    }
}
