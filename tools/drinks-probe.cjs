// Live check of drinks on the real desktop.
//  1. Energy drink: the pet must sprint around (distance, top speed, jumps).
//  2. Beer: a test window (our own WinForms form, never a user window) is
//     opened behind the pet; punches must crack the "glass", shake/shove/
//     minimise that window, and the pet must go after the cursor.
// Usage: node tools/drinks-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exeArg = args.indexOf("--exe");
const exe = path.resolve(exeArg >= 0 ? args[exeArg + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-drinks-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9571 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
});
const shot = (name) =>
  cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", `tools\\drinks-${name}.png`], { encoding: "utf8", windowsHide: true });
(async () => {
  let ws, form;
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
    const bubbles = [];
    let watching = true;
    (async () => {
      let last = "";
      while (watching) {
        const b = await js(`((window.__PET_SCENE__ || {}).brain || {}).bubble?.text || ""`).catch(() => "");
        if (b && b !== last) bubbles.push(b);
        last = b || last;
        await delay(250);
      }
    })();
    await delay(9000);
    const out = {};
    // ---- 1. energy
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.buy("energy", true); })()`);
    const trail = [];
    for (let i = 0; i < 100; i++) {
      trail.push(await js(`(() => { const w = window.__PET_SCENE__.world; return { x: w.x, y: w.y, air: w.air, t: Date.now() }; })()`));
      if (i === 60) shot("energy");
      await delay(250);
    }
    let dist = 0, top = 0, jumps = 0;
    for (let i = 1; i < trail.length; i++) {
      const d = Math.abs(trail[i].x - trail[i - 1].x);
      dist += d;
      top = Math.max(top, (d / (trail[i].t - trail[i - 1].t)) * 1000);
      if (trail[i].air && !trail[i - 1].air) jumps++;
    }
    out.energy = { seconds: 25, distancePx: Math.round(dist), topSpeedPxS: Math.round(top), jumps, buzz: await js(`window.__PET_SCENE__.buzz.kind`) };
    // Skip the rest of the energy + crash for the beer test.
    await js(`window.__PET_SCENE__.buzz.cancel()`);
    await delay(1500);
    // ---- 2. beer with a test window behind the pet
    const p = await js(`(() => { const s = window.__PET_SCENE__, w = s.world, m = s.monitors.find(m => w.x >= m.bounds.left && w.x < m.bounds.right); return { x: Math.round(w.x), y: Math.round(w.y), size: Math.round(s.sizePx()), left: m.work.left, right: m.work.right }; })()`);
    const log = path.join(qa, "form.log");
    form = cp.spawn("powershell", ["-NoProfile", "-Command", `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class D { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); }
'@
[D]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$f = New-Object Windows.Forms.Form; $f.Text = 'TracePet drinks test'; $f.StartPosition = 'Manual'; $f.AutoScaleMode = 'None'
$f.BackColor = [Drawing.Color]::FromArgb(40,44,52); $f.TopMost = $true
$f.Bounds = New-Object Drawing.Rectangle(${p.left + 40}, ${p.y - 560}, ${p.right - p.left - 80}, 545)
$f.Show()
$end = [DateTime]::UtcNow.AddSeconds(75)
while ([DateTime]::UtcNow -lt $end -and -not $f.IsDisposed) {
  [Windows.Forms.Application]::DoEvents()
  Add-Content -Path '${log.replace(/\\/g, "\\\\")}' -Value ("{0} {1} {2}" -f $f.Left, $f.Top, $f.WindowState)
  Start-Sleep -Milliseconds 100
}
if (-not $f.IsDisposed) { $f.Close() }`], { windowsHide: true });
    await delay(2500);
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.world.x = ${p.x}; s.world.target = null; s.buy("beer", true); })()`);
    let crackShot = false, hitShot = false, hitsSeen = 0;
    const huntStates = new Set();
    for (let i = 0; i < 200; i++) {
      const st = await js(`(() => { const s = window.__PET_SCENE__; return { play: s.play.state, smashes: s.buzz.smashes, cracks: s.fx.cracks.length, hits: s.fx.hits.length }; })()`);
      if (st.hits) { hitsSeen++; if (!hitShot) { hitShot = true; shot("cursor-hit"); } }
      huntStates.add(st.play);
      if (st.cracks && !crackShot) { crackShot = true; await delay(150); shot("beer-crack"); }
      if (st.smashes >= 4 && hitsSeen > 3) break;
      await delay(300);
    }
    await delay(2500);
    const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split(/\r?\n/) : [];
    const pos = lines.map((l) => l.split(" "));
    const xs = pos.map((p) => +p[0]);
    out.beer = {
      smashes: await js(`window.__PET_SCENE__.buzz.smashes`),
      cursorHitSamples: hitsSeen,
      playStates: [...huntStates],
      formSamples: lines.length,
      formMoved: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
      formWindowStates: [...new Set(pos.map((p) => p[2]))],
    };
    const diag = path.join(qa, "DrizzDesktop", "diagnostic.log");
    out.windowActs = fs.existsSync(diag) ? fs.readFileSync(diag, "utf8").split(/\r?\n/).filter((l) => /window_act|smash/.test(l)).map((l) => l.slice(24)) : [];
    watching = false;
    out.bubbles = bubbles;
    console.log(JSON.stringify(out, null, 1));
    await js(`new Promise(r => { const ok = Math.floor(Math.random()*1e9); window["_"+ok] = r; window["_"+(ok+1)] = r; window.__TAURI_IPC__({ cmd: "exit_app", callback: ok, error: ok+1 }); })`).catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch {}
    if (form && form.exitCode === null) form.kill();
    await delay(800);
    if (app.exitCode === null) app.kill();
  }
})();
