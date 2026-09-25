// Visual check while walking, on a copy of the user's profile (same pet,
// worn items and settings): captures the pet window from the screen several
// times while it walks and reports what is drawn on top of the sprite.
// Usage: node tools/dot-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exe = path.resolve(args.includes("--exe") ? args[args.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-dot-" + Date.now());
fs.mkdirSync(path.join(qa, "DrizzDesktop"), { recursive: true });
const src = path.join(process.env.LOCALAPPDATA, "DrizzDesktop");
for (const f of ["state.json"]) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(qa, "DrizzDesktop", f));
// --awake: no night sleep, so the night walk can be seen.
if (args.includes("--awake")) { const p = path.join(qa, "DrizzDesktop", "state.json"), st = JSON.parse(fs.readFileSync(p, "utf8")); st.settings = { ...st.settings, nightSleep: false }; fs.writeFileSync(p, JSON.stringify(st)); }
const port = 9831 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background", "--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
const shot = (name) =>
  cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", `tools\\dot-${name}.png`], { windowsHide: true });
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
    await delay(7000);
    const info = await js(`(() => { const s = window.__PET_SCENE__; const kids = s.children.list.filter(o => o.visible && o !== s.actor).map(o => ({ type: o.type, depth: o.depth, x: Math.round(o.x || 0), y: Math.round(o.y || 0), text: o.text || "" })); return { pet: s.store.settings.pet, wear: s.brain.life.wear, kids: kids.slice(0, 40), rects: JSON.parse(s.lastPose || "{}").rects?.length }; })()`);
    console.log(JSON.stringify(info));
    const m = await js(`(() => { const s = window.__PET_SCENE__, w = s.world, m = s.monitors.find(m => w.x >= m.bounds.left && w.x < m.bounds.right); return { l: m.work.left, r: m.work.right }; })()`);
    await js(`(() => { const s = window.__PET_SCENE__; s.nextActivity = Date.now() + 60000; s.brain.bubble = undefined; s.world.go(${m.l + 600}); })()`);
    for (let i = 0; i < 6; i++) { await delay(700); shot("walk" + i); }
    await js(`window.__TAURI_IPC__({ cmd: "exit_app", callback: 1, error: 2 })`).catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
  } finally {
    await delay(1500);
    if (app.exitCode === null) app.kill();
    process.exit();
  }
})();
