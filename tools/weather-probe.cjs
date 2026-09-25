// Live check of the weather: city search (Open-Meteo geocoding), the reading
// for that place, the pet's report line with place and temperature, and a
// change line (rain started) when the sky changes. Needs the internet.
// Usage: node tools/weather-probe.cjs [--exe PATH] [--city Москва]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const exe = path.resolve(opt("--exe", "src-tauri/target/release/Drizz Desktop.exe"));
const city = opt("--city", "Москва");
const qa = path.join(__dirname, "qa-weather-" + Date.now());
fs.mkdirSync(path.join(qa, "DrizzDesktop"), { recursive: true });
fs.writeFileSync(path.join(qa, "DrizzDesktop", "state.json"), JSON.stringify({ settings: { nightSleep: false, lang: "ru" }, memory: { cardShown: true }, token: "t", hasKey: false }));
const port = 9981 + Math.floor(Math.random() * 15);
const app = cp.spawn(exe, ["--background", "--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
(async () => {
  const out = {};
  try {
    let pet;
    for (let i = 0; i < 40 && !pet; i++) {
      try { pet = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page" && !p.url.includes("panel=")); } catch {}
      if (!pet) await delay(500);
    }
    const ws = new WebSocket(pet.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) (pend.get(d.id)(d), pend.delete(d.id)); };
    const js = (e) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: e, returnByValue: true, awaitPromise: true } })); });
    const ipc = (cmd, extra = {}) => js(`new Promise((resolve) => { const ok = Math.floor(Math.random()*1e9), err = ok+1; window["_"+ok] = (r) => resolve(JSON.stringify(r ?? null)); window["_"+err] = (e) => resolve("ERR " + e); window.__TAURI_IPC__({ cmd: ${JSON.stringify(cmd)}, callback: ok, error: err, ...${JSON.stringify(extra)} }); })`);
    await delay(6000);
    const found = JSON.parse(await ipc("weather_search", { query: city }));
    out.search = (found || []).slice(0, 3).map((p) => [p.name, p.country ?? p.admin ?? "", p.lat ?? p.latitude, p.lon ?? p.longitude]);
    const first = found?.[0];
    if (!first) throw new Error("nothing found for " + city);
    const lat = first.lat ?? first.latitude, lon = first.lon ?? first.longitude;
    const place = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
    out.reading = JSON.parse(await ipc("weather", { place }));
    // Something is being said right now (a click line): the report must wait, not vanish.
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.brain.status(Date.now()); })()`);
    const store = JSON.parse(await ipc("load_store"));
    await ipc("save_settings", { settings: { ...store.settings, weather: true, weatherPlace: place, weatherName: first.name } });
    const lines = [];
    for (let i = 0; i < 40; i++) {
      const t = await js(`(() => { const s = window.__PET_SCENE__; return s.brain.bubble ? s.brain.bubble.text : ""; })()`);
      if (t && !lines.includes(t)) lines.push(t);
      if (lines.some((l) => l.includes(first.name))) break;
      await delay(500);
    }
    out.lines = lines;
    out.cloud = await js(`(() => { const s = window.__PET_SCENE__; return s.weather ? { sky: s.weather.sky, temp: s.weather.temp } : null; })()`);
    // Pretend the last reading was clear: the next one decides whether to report a change.
    await js(`(() => { const s = window.__PET_SCENE__; s.weather = { ...s.weather, sky: "clear", at: Date.now() - 3600000 }; s.nextWeather = 0; s.brain.bubble = undefined; s.brain.reaction = undefined; })()`);
    await delay(4000);
    out.afterChange = await js(`(() => { const s = window.__PET_SCENE__; return { said: s.brain.bubble ? s.brain.bubble.text : "", reaction: s.brain.reaction ? s.brain.reaction.event : "" }; })()`);
    out.report = out.lines.some((l) => l.includes(first.name) && /-?\d+\s*°/.test(l));
    console.log(JSON.stringify(out, null, 1));
    await ipc("exit_app");
  } catch (e) {
    console.error("probe failed:", e, JSON.stringify(out));
  } finally {
    await delay(1500);
    if (app.exitCode === null) app.kill();
    process.exit();
  }
})();
