// Live check of the spike guard (guard.rs) on the real default output, in an
// isolated profile. The ceiling is put just above the current volume, so the
// user's sound is not turned down; the test spike is +2 % for a few ms.
// Then a real spike (+6 %) is set from outside and must be cut, and the pet
// must say the "earsGuardClamp" line. The volume is put back at the end.
// Usage: node tools/guard-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exe = path.resolve(args.includes("--exe") ? args[args.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-guard-" + Date.now());
fs.mkdirSync(path.join(qa, "DrizzDesktop"), { recursive: true });
const port = 9911 + Math.floor(Math.random() * 40);
(async () => {
  let app;
  try {
    // Start once without the guard to read the current volume.
    fs.writeFileSync(path.join(qa, "DrizzDesktop", "state.json"), JSON.stringify({ settings: { earsGuard: false, lang: "ru" }, memory: { cardShown: true }, token: "t", hasKey: false }));
    app = cp.spawn(exe, ["--background", "--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
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
    let env = null;
    for (let i = 0; i < 30 && !env; i++) { env = await js(`(() => { const e = window.__PET_SCENE__?.snapshot?.env; return e && e.volume >= 0 ? { volume: e.volume, headphones: e.headphones } : null; })()`); if (!env) await delay(300); }
    const before = env.volume;
    const ceiling = Math.min(95, Math.max(10, Math.ceil((before + 1) / 5) * 5));
    const store = JSON.parse(await ipc("load_store"));
    await ipc("save_settings", { settings: { ...store.settings, earsGuard: true, earsCeiling: ceiling, earsSafe: 0 } });
    await delay(1500);
    const test = await ipc("ear_guard_test");
    await delay(400);
    const testLine = await js(`(() => { const b = window.__PET_SCENE__.brain.bubble; return b ? b.text : ""; })()`);
    // A spike from outside: the pet's own set_volume, 6 % over the ceiling.
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; })()`);
    await ipc("set_volume", { level: Math.min(1, (ceiling + 6) / 100) });
    await delay(2600);
    const after = await js(`(() => { const s = window.__PET_SCENE__; return { volume: s.snapshot.env.volume, line: s.brain.bubble ? s.brain.bubble.text : "" }; })()`);
    await ipc("save_settings", { settings: { ...store.settings, earsGuard: false } });
    await delay(1200);
    await ipc("set_volume", { level: before / 100 });
    await delay(2600);
    const restored = await js(`window.__PET_SCENE__.snapshot.env.volume`);
    console.log(JSON.stringify({ headphones: env.headphones, before, ceiling, test, testLine, afterSpike: after, restored, ok: test.startsWith("ERR") ? false : after.volume <= ceiling && restored === before }, null, 1));
    await ipc("exit_app");
  } catch (e) {
    console.error("probe failed:", e);
  } finally {
    await delay(1500);
    if (app && app.exitCode === null) app.kill();
    process.exit();
  }
})();
