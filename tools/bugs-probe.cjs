// Live check of the two reported bugs on the real multi-monitor desktop:
//  1. the pet must walk across the seam to the other monitor instead of
//     bumping into it (primary <-> secondary, negative coordinates included);
//  2. while dragged and shaken the body must swing (Movement.swing != 0) and
//     the drawn sprite must rotate with it.
// Uses a real mouse drag (SendInput) for 2, so run it without touching the PC.
// Usage: node tools/bugs-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exeArg = args.indexOf("--exe");
const exe = path.resolve(exeArg >= 0 ? args[exeArg + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-bugs-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9521 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
});
const shot = (name) =>
  cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", `tools\\bugs-${name}.png`], { encoding: "utf8", windowsHide: true });
// Real mouse via a tiny PowerShell helper: move to (x,y), press, path, release.
const mouse = (script) =>
  new Promise((resolve) => { const c = cp.spawn("powershell", ["-NoProfile", "-Command", `
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class M { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); }
'@
[M]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
${script}`], { windowsHide: true }); c.on("exit", resolve); });
(async () => {
  let ws;
  try {
    let pet;
    for (let i = 0; i < 40 && !pet; i++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        pet = pages.find((p) => p.type === "page" && !p.url.includes("panel=") && p.url !== "about:blank");
      } catch {}
      if (!pet) await delay(500);
    }
    if (!pet) throw Error("No pet page via CDP");
    ws = new WebSocket(pet.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await delay(9000);
    const out = {};
    const mons = await js(`window.__PET_SCENE__.monitors.map(m => ({ id: m.id, b: m.bounds, w: m.work, primary: m.primary }))`);
    out.monitors = mons.map((m) => `${m.id} ${m.b.left},${m.b.top}-${m.b.right},${m.b.bottom}${m.primary ? " primary" : ""}`);
    const other = mons.find((m) => !m.primary);
    const primary = mons.find((m) => m.primary);
    // ---- 1. walk across the seam
    if (other) {
      const towardLeft = other.b.right <= primary.b.left;
      const startX = towardLeft ? primary.w.left + 120 : primary.w.right - 120;
      const goal = towardLeft ? other.w.right - 400 : other.w.left + 400;
      await js(`(() => { const s = window.__PET_SCENE__, w = s.world; s.nextActivity = Date.now() + 120000;
        w.x = ${startX}; w.y = ${primary.w.bottom}; w.support = null; w.vx = w.vy = 0; w.air = false; w.go(${goal}); })()`);
      const trail = [];
      for (let i = 0; i < 70; i++) {
        const st = await js(`(() => { const w = window.__PET_SCENE__.world; return { x: Math.round(w.x), y: Math.round(w.y), target: w.target, air: w.air }; })()`);
        trail.push(st);
        if (st.target === null && i > 5) break;
        if (i === 25) shot("seam");
        await delay(200);
      }
      const last = trail[trail.length - 1];
      const onOther = last.x >= other.b.left && last.x < other.b.right;
      out.seam = { from: startX, goal, end: last, reachedOtherMonitor: onOther, minX: Math.min(...trail.map((t) => t.x)), maxX: Math.max(...trail.map((t) => t.x)) };
      // bring it home for the drag test
      await js(`(() => { const s = window.__PET_SCENE__, m = s.monitors.find(m => m.primary); s.world.placeOn(m, s.monitors, s.store.settings.size); })()`);
      await delay(1500);
    }
    // ---- 2. real drag + shake
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.nextActivity = Date.now() + 120000; s.world.target = null; })()`);
    await delay(800);
    const p = await js(`(() => { const s = window.__PET_SCENE__, w = s.world; return { x: Math.round(w.x), y: Math.round(w.y), size: Math.round(s.store.settings.size * w.scale) }; })()`);
    const gx = p.x, gy = p.y - Math.round(p.size * 0.45);
    // Sample the swing from the page while the mouse script runs.
    let sampling = true;
    const swings = [];
    (async () => {
      while (sampling) {
        const v = await js(`(() => { const s = window.__PET_SCENE__; return { d: s.world.dragging, sw: +s.world.swing.toFixed(3), rot: +(s.actor.rotation || 0).toFixed(3) }; })()`).catch(() => null);
        if (v) swings.push(v);
        await delay(40);
      }
    })();
    const moves = [];
    for (let i = 0; i < 24; i++) moves.push(`[M]::SetCursorPos(${gx + (i % 2 ? 260 : -260)}, ${gy - 200}); Start-Sleep -Milliseconds 90`);
    // Approach slowly: a fast cursor near the pet makes it dodge.
    const approach = [];
    for (let i = 20; i >= 0; i--) approach.push(`[M]::SetCursorPos(${gx - i * 12}, ${gy - i * 8}); Start-Sleep -Milliseconds 45`);
    await mouse(`${approach.join("\n")}
[M]::SetCursorPos(${gx}, ${gy}); Start-Sleep -Milliseconds 200
[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 150
[M]::SetCursorPos(${gx}, ${gy - 200}); Start-Sleep -Milliseconds 200
${moves.slice(0, 12).join("\n")}
`);
    shot("drag");
    await mouse(`${moves.slice(12).join("\n")}
[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);
    await delay(1200);
    sampling = false;
    await delay(100);
    const held = swings.filter((s) => s.d);
    out.drag = {
      samplesWhileHeld: held.length,
      maxSwing: Math.max(0, ...held.map((s) => Math.abs(s.sw))),
      maxSpriteRotation: Math.max(0, ...held.map((s) => Math.abs(s.rot))),
      signChanges: held.reduce((n, s, i) => n + (i && Math.sign(s.sw) !== Math.sign(held[i - 1].sw) && s.sw !== 0 ? 1 : 0), 0),
    };
    out.afterDrag = await js(`(() => { const s = window.__PET_SCENE__; return { text: (s.brain.bubble || {}).text, ev: (s.brain.reaction || {}).event }; })()`);
    console.log(JSON.stringify(out, null, 1));
    await js(`new Promise(r => { const ok = Math.floor(Math.random()*1e9); window["_"+ok] = r; window["_"+(ok+1)] = r; window.__TAURI_IPC__({ cmd: "exit_app", callback: ok, error: ok+1 }); })`).catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch {}
    await mouse(`[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);
    await delay(800);
    if (app.exitCode === null) app.kill();
  }
})();
