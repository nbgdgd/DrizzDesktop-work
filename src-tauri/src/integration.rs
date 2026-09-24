use crate::storage::{enabled, State};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::Manager;
#[derive(Clone, Deserialize, Serialize)]
pub struct Event {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub title: String,
}
const KINDS: [&str; 5] = [
    "build-success",
    "build-failed",
    "render-done",
    "download-done",
    "episode-ended",
];
pub fn validate(e: &Event) -> bool {
    !e.id.is_empty()
        && e.id.len() <= 128
        && e.title.chars().count() <= 140
        && KINDS.contains(&e.kind.as_str())
}
fn receive(stream: &mut TcpStream, token: &str) -> Result<Event, ()> {
    // On Windows a socket accepted from a non-blocking listener is itself
    // non-blocking: without this the first read fails with WouldBlock
    // whenever the request has not fully arrived yet, and the client gets 400.
    stream.set_nonblocking(false).map_err(|_| ())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| ())?;
    let mut data = vec![];
    let split = loop {
        let mut b = [0; 512];
        let n = stream.read(&mut b).map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        data.extend_from_slice(&b[..n]);
        if data.len() > 8192 {
            return Err(());
        }
        if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
    };
    let header = std::str::from_utf8(&data[..split]).map_err(|_| ())?;
    if !header.starts_with("POST /event HTTP/1.") {
        return Err(());
    }
    let fields: HashMap<_, _> = header
        .lines()
        .skip(1)
        .filter_map(|s| s.split_once(':'))
        .map(|(k, v)| (k.to_lowercase(), v.trim().to_owned()))
        .collect();
    if fields.get("authorization") != Some(&format!("Bearer {token}"))
        || fields.contains_key("origin")
        || fields.contains_key("transfer-encoding")
    {
        return Err(());
    }
    let len = fields
        .get("content-length")
        .ok_or(())?
        .parse::<usize>()
        .map_err(|_| ())?;
    if len > 2048 {
        return Err(());
    }
    while data.len() < split + len {
        let mut b = [0; 512];
        let n = stream.read(&mut b).map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        data.extend_from_slice(&b[..n]);
    }
    let e: Event = serde_json::from_slice(&data[split..split + len]).map_err(|_| ())?;
    if validate(&e) {
        Ok(e)
    } else {
        Err(())
    }
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut listener: Option<TcpListener> = None;
        let mut recent: HashMap<String, Instant> = HashMap::new();
        while !app.state::<State>().stop.load(Ordering::Relaxed) {
            let store = app.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
            if !enabled(&store.settings, "integration", false) {
                listener = None;
            } else {
                if listener.is_none() {
                    match TcpListener::bind("127.0.0.1:49753") {
                        Ok(l) => {
                            let _ = l.set_nonblocking(true);
                            listener = Some(l);
                            let _ = app.emit_all("integration-status", "ready");
                        }
                        Err(_) => {
                            let _ = app.emit_all("integration-status", "busy");
                            std::thread::sleep(Duration::from_secs(3));
                        }
                    }
                }
                if let Some(ref l) = listener {
                    if let Ok((mut stream, _)) = l.accept() {
                        let event = receive(&mut stream, &store.token);
                        let reply = if let Ok(e) = event {
                            recent.retain(|_, t| t.elapsed() < Duration::from_secs(600));
                            if !recent.contains_key(&e.id)
                                && enabled(
                                    &app.state::<State>().store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).settings,
                                    "integration",
                                    false,
                                )
                            {
                                recent.insert(e.id.clone(), Instant::now());
                                if recent.len() > 512 {
                                    recent.clear();
                                    recent.insert(e.id.clone(), Instant::now());
                                }
                                if let Some(pet) = app.get_window("pet") {
                                    let _ = pet.emit("integration-event", e);
                                }
                            }
                            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        } else {
                            "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        };
                        let _ = stream.write_all(reply.as_bytes());
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restrict_events() {
        assert!(validate(&Event {
            id: "1".into(),
            kind: "episode-ended".into(),
            title: "Series 1".into()
        }));
        assert!(!validate(&Event {
            id: "1".into(),
            kind: "run-command".into(),
            title: "".into()
        }));
        assert!(!validate(&Event {
            id: "".into(),
            kind: "build-success".into(),
            title: "".into()
        }));
    }
}
