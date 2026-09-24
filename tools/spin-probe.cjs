// Live check: a hard throw sends the pet tumbling; the drawn sprite must stay
// inside the 360x340 overlay canvas for the whole flight (it used to rotate
// around the feet and vanish below the window when upside down).
// Usage: node tools/spin-probe.cjs [--exe PATH] [--pet aqua-wisp]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const exe = path.resolve(opt("--exe", "src-tauri/target/release/Drizz Desktop.exe"));
const petId = opt("--pet", "aqua-wisp");
const qa = path.join(__dirname, "qa-spin-" + Date.now());
fs.mkdirSync(path.join(qa, "DrizzDesktop"), { recursive: true });
fs.writeFileSync(path.join(qa, "DrizzDesktop", "state.json"), JSON.stringify({ settings: { pet: petId }, memory: {}, token: "t", hasKey: false }));
const port = 9611 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
});
const shot = (name) =>
  cp.spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", `tools\\spin-${name}.png`], { windowsHide: true });
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
    await delay(8000);
    const results = [];
    for (let round = 0; round < 3; round++) {
      const w = await js(`(() => { const s = window.__PET_SCENE__, w = s.world; const m = s.monitors.find(m => w.x >= m.bounds.left && w.x < m.bounds.right); return { x: w.x, y: w.y, l: m.work.left, r: m.work.right }; })()`);
      const dir = round % 2 ? -1 : 1;
      const sx = dir > 0 ? w.l + 500 : w.r - 500;
      // A hard fling up and sideways (same path as a real drag release).
      await js(`(() => { const s = window.__PET_SCENE__, w = s.world, t = Date.now();
        s.draggingSince = t; s.dragSeenDown = true;
        w.begin(${w.x}, ${w.y - 40}, t);
        w.x = ${sx}; w.y = ${w.y - 200};
        w.drag(${sx + dir * 60}, ${w.y - 260}, t + 20);
        w.drag(${sx + dir * 160}, ${w.y - 360}, t + 40);
        s.release("probe"); })()`);
      let maxAngle = 0, outside = 0, samples = 0, shotTaken = false; const sides = [];
      for (let i = 0; i < 80; i++) {
        const st = await js(`(() => { const s = window.__PET_SCENE__; const b = s.bodyBox || { left: 0, top: 0, right: 0, bottom: 0 }; return { air: s.world.air, a: s.world.swing, l: b.left, t: b.top, r: b.right, btm: b.bottom, vis: s.actor.visible, wx: s.world.x, wy: s.world.y, ax: s.layout.anchorX, ay: s.layout.anchorY }; })()`);
        if (!st.air && i > 5) break;
        samples++;
        maxAngle = Math.max(maxAngle, Math.abs(st.a));
        // Opaque pixels (the window region sent to Win32) vs the 360x340 canvas.
        if (st.l < -4 || st.t < -4 || st.r > 364 || st.btm > 344) { outside++; if (sides.length < 6) sides.push({ l: Math.round(st.l), t: Math.round(st.t), r: Math.round(st.r), b: Math.round(st.btm), wx: Math.round(st.wx), wy: Math.round(st.wy), ax: Math.round(st.ax), ay: Math.round(st.ay) }); }
        if (!shotTaken && Math.abs(Math.sin(st.a)) < 0.3 && Math.cos(st.a) < -0.7) { shotTaken = true; shot(`upside-down-${round}`); }
        await delay(30);
      }
      results.push({ round, samples, turns: +(maxAngle / (2 * Math.PI)).toFixed(2), framesOutsideCanvas: outside, sides });
      await delay(3500);
    }
    console.log(JSON.stringify({ pet: petId, results }, null, 1));
    await js(`new Promise(r => { const ok = Math.floor(Math.random()*1e9); window["_"+ok] = r; window["_"+(ok+1)] = r; window.__TAURI_IPC__({ cmd: "exit_app", callback: ok, error: ok+1 }); })`).catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch {}
    await delay(1500);
    if (app.exitCode === null) app.kill();
  }
})();
