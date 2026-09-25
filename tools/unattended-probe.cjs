// Unattended live check (Windows): start it, do not touch the PC for about
// five minutes. Isolated profile (LOCALAPPDATA in tools/qa-unattended-*),
// your settings and volume are put back at the end.
//
//  1. Frame rate: reads the pet's actual fps for 10 s (should be ~30, was 15-21).
//  2. "Sleep": the whole app is frozen for 12 s (NtSuspendProcess), like a
//     laptop lid; the ear guard must notice the gap, set the safe volume and
//     the pet must say so. Needs earsDevice "always" so no headphones are
//     required; the safe volume is just below yours and is undone after.
//  3. Mixer balance: shifts the balance, checks an app's session (play
//     something: music or a video) and the device itself are as expected.
//  4. Real mouse across monitors (only with 2+ monitors): grabs the pet with
//     the real cursor, drags it to the other monitor, releases, checks the
//     pet is on that monitor and standing.
//  5. Uninstall reset: runs "--reset-audio" like the uninstaller does and
//     checks every session is back to 1/1.
// Balance sessions come back as [pid, [left, right, ...]].
// Usage: node tools/unattended-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exe = path.resolve(args.includes("--exe") ? args[args.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-unattended-" + Date.now());
const dir = path.join(qa, "DrizzDesktop");
fs.mkdirSync(dir, { recursive: true });
const report = {};
const ps = (script) => cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true });
const SUSPEND = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class S{[DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr h);[DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr h);}';`;
const freeze = (pid, seconds) => {
  // The pet and its WebView2 children: every process in the tree.
  const r = ps(`${SUSPEND}
  $ids = @(${pid}) + @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | ForEach-Object { $_.ProcessId });
  $ps = $ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue };
  $ps | ForEach-Object { [void][S]::NtSuspendProcess($_.Handle) };
  Start-Sleep -Seconds ${seconds};
  $ps | ForEach-Object { [void][S]::NtResumeProcess($_.Handle) };
  "frozen " + $ps.Count`);
  return r.stdout.trim() || r.stderr.trim();
};
async function launch() {
  const port = 9601 + Math.floor(Math.random() * 60);
  const app = cp.spawn(exe, ["--background", "--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
  let pet;
  for (let i = 0; i < 60 && !pet; i++) {
    try {
      pet = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page" && !p.url.includes("panel="));
    } catch {}
    if (!pet) await delay(500);
  }
  const ws = new WebSocket(pet.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pend.has(d.id)) (pend.get(d.id)(d), pend.delete(d.id));
  };
  const js = (e) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, (d) => r(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description));
      ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: e, returnByValue: true, awaitPromise: true } }));
    });
  const ipc = async (cmd, extra = {}) =>
    JSON.parse(
      await js(
        `new Promise((resolve) => { const ok = Math.floor(Math.random()*1e9), err = ok+1; window["_"+ok] = (r) => resolve(JSON.stringify(r ?? null)); window["_"+err] = (e) => resolve(JSON.stringify("ERR " + e)); window.__TAURI_IPC__({ cmd: ${JSON.stringify(cmd)}, callback: ok, error: err, ...${JSON.stringify(extra)} }); })`,
      ),
    );
  return { app, ws, js, ipc };
}
(async () => {
  let run;
  let volumeBefore = null;
  try {
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ settings: { lang: "ru", earsGuard: false, earsDevice: "always" }, memory: { cardShown: true }, token: "t", hasKey: false }));
    run = await launch();
    await delay(5000);
    // Record every line the pet says from now on.
    await run.js(`(() => { const s = window.__PET_SCENE__; window.__said = []; const ev = s.brain.event.bind(s.brain); s.brain.event = (n, ...a) => { const r = ev(n, ...a); if (r) window.__said.push(n); return r; }; return true; })()`);
    // 1. Frame rate.
    const fps = [];
    for (let i = 0; i < 10; i++) {
      fps.push(await run.js(`Math.round(window.__PET_SCENE__.game.loop.actualFps)`));
      await delay(1000);
    }
    report.fps = { samples: fps, ok: fps.slice(3).every((f) => f >= 26) };
    // 2. "Sleep" with the ear guard on.
    const env = await run.js(`(() => { const e = window.__PET_SCENE__.snapshot.env; return { volume: e.volume, headphones: e.headphones }; })()`);
    volumeBefore = env.volume;
    const safe = Math.min(60, Math.max(5, volumeBefore - 10));
    const store = await run.ipc("load_store");
    await run.ipc("save_settings", { settings: { ...store.settings, earsGuard: true, earsCeiling: 95, earsSafe: safe, earsDevice: "always" } });
    await delay(2500);
    const frozen = freeze(run.app.pid, 12);
    await delay(4000);
    const afterWake = await run.js(`(() => ({ volume: window.__PET_SCENE__.snapshot.env.volume, said: window.__said.slice() }))()`);
    report.sleep = { volumeBefore, safe, frozen, after: afterWake, ok: Math.abs(afterWake.volume - safe) <= 1 && afterWake.said.includes("earsGuardWake") };
    await run.ipc("save_settings", { settings: { ...store.settings, earsGuard: false } });
    await delay(1200);
    await run.ipc("set_volume", { level: volumeBefore / 100 });
    // 3. Mixer balance.
    const device0 = await run.js(`(() => { const e = window.__PET_SCENE__.snapshot.env; return { left: e.left, right: e.right }; })()`);
    await run.ipc("set_balance", { left: 0.4, right: 1 });
    await delay(1500);
    const sessions = await run.ipc("balance_sessions");
    const device1 = await run.js(`(() => { const e = window.__PET_SCENE__.snapshot.env; return { left: e.left, right: e.right }; })()`);
    report.balance = {
      sessions,
      deviceBefore: device0,
      deviceAfter: device1,
      ok: Array.isArray(sessions) && sessions.some(([, c]) => c.length >= 2 && c[0] < 0.5 && c[1] > 0.95) && Math.abs(device0.left - device1.left) < 0.3,
      note: Array.isArray(sessions) && sessions.length === 0 ? "nothing was playing: start music or a video and run again" : undefined,
    };
    // 4. Real mouse across monitors.
    const mons = await run.js(`window.__PET_SCENE__.monitors.map((m) => m.bounds)`);
    if (mons && mons.length >= 2) {
      const pos = await run.js(`(() => { const s = window.__PET_SCENE__; return { x: Math.round(s.world.x), y: Math.round(s.world.y), size: Math.round(s.sizePx()) }; })()`);
      const here = mons.find((b) => pos.x >= b.left && pos.x < b.right) ?? mons[0];
      const there = mons.find((b) => b !== here);
      const tx = Math.round((there.left + there.right) / 2),
        ty = Math.round(there.top + (there.bottom - there.top) * 0.4);
      const drag = ps(`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}';
      [M]::SetCursorPos(${pos.x}, ${pos.y - Math.round(pos.size * 0.4)}); Start-Sleep -Milliseconds 300;
      [M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 250;
      for ($i = 1; $i -le 40; $i++) { $t = $i / 40; [M]::SetCursorPos([int](${pos.x} + (${tx} - ${pos.x}) * $t), [int](${pos.y - Math.round(pos.size * 0.4)} + (${ty} - ${pos.y - Math.round(pos.size * 0.4)}) * $t)); Start-Sleep -Milliseconds 25 };
      Start-Sleep -Milliseconds 300; [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); "dragged"`);
      await delay(4000);
      const end = await run.js(`(() => { const s = window.__PET_SCENE__; return { x: Math.round(s.world.x), y: Math.round(s.world.y), dragging: s.world.dragging }; })()`);
      report.monitors = { from: here, to: there, drag: drag.stdout.trim(), end, ok: end.x >= there.left && end.x < there.right && !end.dragging };
    } else report.monitors = { skipped: "one monitor" };
    // 5. The uninstaller's reset.
    await run.ipc("set_balance", { left: 0.4, right: 1 });
    await delay(1000);
    await run.ipc("exit_app");
    await delay(2500);
    // Crash-like leftover: write the marker, then run what the uninstaller runs.
    fs.writeFileSync(path.join(dir, "balance.sessions"), "0.4 1");
    const reset = cp.spawnSync(exe, ["--reset-audio"], { env: { ...process.env, LOCALAPPDATA: qa }, timeout: 15000 });
    run = await launch();
    await delay(3000);
    const after = await run.ipc("balance_sessions");
    report.uninstall = { exit: reset.status, marker: fs.existsSync(path.join(dir, "balance.sessions")), sessions: after, ok: reset.status === 0 && Array.isArray(after) && after.every(([, c]) => c.every((v) => v > 0.99)) };
    await run.ipc("exit_app");
    await delay(1500);
  } catch (e) {
    report.error = String(e && e.stack ? e.stack : e);
  } finally {
    if (run && run.app.exitCode === null) run.app.kill();
    report.ok = ["fps", "sleep", "balance", "uninstall"].every((k) => report[k]?.ok) && (report.monitors?.ok ?? true);
    console.log(JSON.stringify(report, null, 1));
    if (volumeBefore !== null) console.log("volume at the start was", volumeBefore, "% - check it is the same now");
    process.exit(report.ok ? 0 : 1);
  }
})();
