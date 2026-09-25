// Live check that the pet is actually heard: starts the build in an isolated
// profile, makes it talk and click several times, and meanwhile reads the
// peak level of every app's audio session in the Windows mixer (the ignored
// Rust test balance::probe_meter::session_peaks). The pet's WebView2 audio
// process must show a peak well above silence.
// Usage: node tools/sound-probe.cjs [--exe PATH] [--volume 15]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const exe = path.resolve(opt("--exe", "src-tauri/target/release/Drizz Desktop.exe"));
const volume = Number(opt("--volume", "55"));
// --only babble|sfx|act: one kind of sound, to see which one is quiet.
const only = opt("--only", "all");
const qa = path.join(__dirname, "qa-sound-" + Date.now());
fs.mkdirSync(path.join(qa, "DrizzDesktop"), { recursive: true });
fs.writeFileSync(path.join(qa, "DrizzDesktop", "state.json"), JSON.stringify({ settings: { sounds: true, soundVolume: volume, voice: true, nightSleep: false, lang: "ru" }, memory: { cardShown: true }, token: "t", hasKey: false }));
const port = 9951 + Math.floor(Math.random() * 30);
// main.rs only adds the autoplay switch when this variable is unset, so the
// probe passes it itself (as the real start does).
const app = cp.spawn(exe, ["--background"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--autoplay-policy=no-user-gesture-required --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
(async () => {
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
    await delay(5000);
    const meter = cp.spawn("cargo", ["test", "--release", "session_peaks", "--", "--ignored", "--nocapture"], { cwd: path.join(__dirname, "..", "src-tauri"), env: { ...process.env, PROBE_SECS: "9" } });
    let out = "";
    meter.stdout.on("data", (d) => (out += d));
    await delay(1500);
    const states = [];
    for (let i = 0; i < 6; i++) {
      states.push(await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.brain.reset("click"); s.brain.dialogue.last = 0; const only = ${JSON.stringify(only)}; if (only === "all" || only === "babble") s.brain.event("click", Date.now(), true); if (only === "babble") s.voice.say("Ну привет, долбоёб, как дела", s.brain.temper.pitch, s.brain.temper.wave); if (only === "all" || only === "sfx") s.sfx.play("click", 0); if (only === "all" || only === "act") s.voice.act("jump", 0); return { line: s.brain.bubble && s.brain.bubble.text, ctx: s.voice.ctx ? s.voice.ctx.state : "none", sfx: s.sfx.enabled, vol: s.sfx.volume }; })()`));
      await delay(1000);
    }
    await new Promise((r) => meter.on("exit", r));
    // Which pids belong to the pet (its WebView2 processes are its children).
    const tree = cp.execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | ? { $_.ParentProcessId -eq ${app.pid} -or $_.ProcessId -eq ${app.pid} } | % { $_.ProcessId; Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $_.ProcessId) | % { $_.ProcessId } }`], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map(Number);
    const peaks = [...out.matchAll(/pid (\d+) peak ([\d.]+)/g)].map((m) => ({ pid: +m[1], peak: +m[2], pet: tree.includes(+m[1]) }));
    const petPeak = Math.max(0, ...peaks.filter((p) => p.pet).map((p) => p.peak));
    console.log(JSON.stringify({ volume, only, states: states.slice(0, 2), peaks, petPeak, heard: petPeak > 0.003 }, null, 1));
    await js(`window.__TAURI_IPC__({ cmd: "exit_app", callback: 1, error: 2 })`).catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
  } finally {
    await delay(1500);
    if (app.exitCode === null) app.kill();
    process.exit();
  }
})();
