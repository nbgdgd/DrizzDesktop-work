// Live check of ear-care balance safety: the pet shifts the left/right
// balance, gets killed (no clean exit), and the next start must put the
// balance back. Since 0.3 the balance lives in the mixer (every app's
// session, balance.rs), not in the device: the device channels (env.left /
// env.right) must stay as they were, and the sessions (balance_sessions)
// must show left < right while shifted and 1/1 after the restart.
// Play something (music, a video) while it runs: a session only exists for
// an app that makes sound.
// Usage: node tools/balance-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exe = path.resolve(args.includes("--exe") ? args[args.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-balance-" + Date.now());
const dir = path.join(qa, "DrizzDesktop");
fs.mkdirSync(dir, { recursive: true });
const state = (balance) =>
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ settings: { balance, ears: true, earsDevice: "always", lang: "ru" }, memory: { cardShown: true }, token: "t", hasKey: false }));
async function launch() {
  const port = 9751 + Math.floor(Math.random() * 40);
  const app = cp.spawn(exe, ["--background", "--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
  let pet;
  for (let i = 0; i < 40 && !pet; i++) {
    try {
      pet = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page" && !p.url.includes("panel="));
    } catch {}
    if (!pet) await delay(500);
  }
  const ws = new WebSocket(pet.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) (pend.get(d.id)(d), pend.delete(d.id)); };
  const js = (e) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: e, returnByValue: true, awaitPromise: true } })); });
  const ears = async () => {
    for (let i = 0; i < 30; i++) {
      const v = await js(`(() => { const e = window.__PET_SCENE__?.snapshot?.env; return e ? { left: +e.left.toFixed(2), right: +e.right.toFixed(2), db: +e.db.toFixed(2), headphones: e.headphones } : null; })()`);
      if (v) return v;
      await delay(300);
    }
    return null;
  };
  const sessions = () =>
    js(`new Promise(r => { const ok = Math.floor(Math.random()*1e9); window["_"+ok] = r; window["_"+(ok+1)] = () => r(null); window.__TAURI_IPC__({ cmd: "balance_sessions", callback: ok, error: ok+1 }); })`);
  return { app, js, ws, ears, sessions };
}
const kill = (pid) => cp.spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
(async () => {
  let run;
  try {
    state(0);
    run = await launch();
    await delay(4000);
    const baseline = await run.ears();
    // Balance to the right: the left ear gets quieter.
    await run.js(`new Promise(r => { const st = window.__PET_SCENE__.store; const ok = Math.floor(Math.random()*1e9); window["_"+ok] = r; window["_"+(ok+1)] = r; window.__TAURI_IPC__({ cmd: "save_settings", callback: ok, error: ok+1, settings: { ...st.settings, balance: 60 } }); })`);
    await delay(3000);
    const shifted = await run.ears();
    const mixerShifted = await run.sessions();
    const fileAfterShift = fs.existsSync(path.join(dir, "balance.sessions"));
    kill(run.app.pid);
    run.ws.close();
    await delay(1500);
    const afterKill = "not readable while the pet is down";
    state(0);
    run = await launch();
    await delay(4000);
    const restored = await run.ears();
    const mixerRestored = await run.sessions();
    const fileAfterRestart = fs.existsSync(path.join(dir, "balance.sessions"));
    const same = (a, b) => !!a && !!b && Math.abs(a.left - b.left) < 0.3 && Math.abs(a.right - b.right) < 0.3;
    const leftDown = (mixerShifted ?? []).some((ch) => ch.length >= 2 && ch[0] < ch[1] - 0.2);
    const allFull = (mixerRestored ?? []).every((ch) => ch.every((v) => v > 0.99));
    console.log(JSON.stringify({ baseline, shifted, mixerShifted, fileAfterShift, afterKill, restored, mixerRestored, fileAfterRestart,
      deviceUntouched: same(baseline, shifted), leftDown, allFull,
      ok: same(baseline, shifted) && same(baseline, restored) && leftDown && allFull && fileAfterShift && !fileAfterRestart }, null, 1));
    await run.js(`window.__TAURI_IPC__({ cmd: "exit_app", callback: 1, error: 2 })`).catch(() => {});
    await delay(1500);
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    if (run && run.app.exitCode === null) kill(run.app.pid);
    process.exit();
  }
})();
