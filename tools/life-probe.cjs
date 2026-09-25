// Visual check of body language on the real desktop: throws the pet into
// the screen edge, strokes it (petting), tickles it, puts it to sleep, and
// captures the pet window from the screen at each moment.
// Usage: node tools/life-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exeArg = args.indexOf("--exe");
const exe = path.resolve(exeArg >= 0 ? args[exeArg + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-life-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9481 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
});
const shot = (name) =>
  cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", `tools\\life-${name}.png`], { encoding: "utf8", windowsHide: true });
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
    const out = {};
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; })()`);
    // 1. throw: simulated fling toward the right edge (same code path as a drag release)
    const w = await js(`(() => { const s = window.__PET_SCENE__, w = s.world; const m = s.monitors.find(m => w.x >= m.bounds.left && w.x < m.bounds.right); return { x: w.x, y: w.y, right: m.work.right }; })()`);
    await js(`(() => { const s = window.__PET_SCENE__, w = s.world, t = Date.now();
      s.draggingSince = t; s.dragSeenDown = true;
      w.begin(${w.x}, ${w.y - 40}, t);
      w.x = ${w.right - 400}; w.y = ${w.y - 500};
      w.drag(${w.right - 350}, ${w.y - 540}, t + 30);
      w.drag(${w.right - 200}, ${w.y - 700}, t + 60);
      s.release("probe"); })()`);
    const seen = new Set();
    let squashShot = false;
    for (let i = 0; i < 60; i++) {
      const st = await js(`(() => { const s = window.__PET_SCENE__; return { kx: s.kx, ky: s.ky, parts: s.fx.parts.length, ev: (s.brain.reaction||{}).event || "", text: (s.brain.bubble||{}).text || "" }; })()`);
      if (st.ev) seen.add(st.ev);
      if (st.text) seen.add("text:" + st.text);
      if (!squashShot && (st.kx !== 1 || st.parts > 2)) { squashShot = true; out.squash = { kx: st.kx, ky: st.ky, parts: st.parts }; shot("throw"); }
      await delay(80);
    }
    out.throw = [...seen];
    out.grudge = await js(`window.__PET_SCENE__.brain.game.grudge`);
    // 2. petting: slow strokes over the pet
    await delay(1500);
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; })()`);
    const p = await js(`(() => { const s = window.__PET_SCENE__; return { x: s.world.x, y: s.world.y, size: s.store.settings.size * s.world.scale }; })()`);
    // The real cursor stream would reset the synthetic "hand": mute it.
    await js(`(() => { const s = window.__PET_SCENE__; window.__touch = s.touchCheck.bind(s); s.touchCheck = () => {}; s.dodgeCheck = () => {}; })()`);
    // Keep the pet still while the "hand" strokes it.
    await js(`(() => { const s = window.__PET_SCENE__; s.world.target = null; s.world.vx = 0; s.nextActivity = Date.now() + 60000; })()`);
    for (let i = 0; i < 40; i++) {
      await js(`(() => { const s = window.__PET_SCENE__, w = s.world, size = s.store.settings.size * w.scale;
        window.__touch({ x: Math.round(w.x - size * 0.25 + (${i} % 10) * size * 0.05), y: Math.round(w.y - size * 0.6), down: false, support: null }); })()`);
      if (i === 30) shot("pet");
      await delay(60);
    }
    out.pet = await js(`(() => { const s = window.__PET_SCENE__; return { ev: (s.brain.reaction||{}).event, text: (s.brain.bubble||{}).text, hearts: s.fx.parts.filter(p => p.glyph && p.glyph.text === "♥").length, grudge: s.brain.game.grudge, likability: s.brain.game.likability, mood: s.brain.mood(Date.now()) }; })()`);
    // 3. tickle: fast wiggle
    await delay(9500);
    await js(`(() => { const s = window.__PET_SCENE__; s.strokes = []; })()`);
    for (let i = 0; i < 16; i++) {
      await js(`(() => { const s = window.__PET_SCENE__, w = s.world, size = s.store.settings.size * w.scale;
        window.__touch({ x: Math.round(w.x + (${i} % 2 ? 1 : -1) * size * 0.3), y: Math.round(w.y - size * 0.5), down: false, support: null }); })()`);
      await delay(30);
    }
    out.tickle = await js(`(() => { const s = window.__PET_SCENE__; return { ev: (s.brain.reaction||{}).event, text: (s.brain.bubble||{}).text }; })()`);
    await delay(600);
    shot("tickle");
    // 4. sleep: force the base state and wait for a "z"
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.brain.action = () => "sleep"; s.lastZ = 0; })()`);
    await delay(1400);
    shot("sleep");
    out.sleep = await js(`(() => { const s = window.__PET_SCENE__; return { zs: s.fx.parts.filter(p => p.glyph && p.glyph.text === "z").length }; })()`);
    console.log(JSON.stringify(out, null, 1));
    const log = path.join(qa, "DrizzDesktop", "diagnostic.log");
    await js(`new Promise(r => { const ok = Math.floor(Math.random()*1e9); window["_"+ok] = r; window["_"+(ok+1)] = r; window.__TAURI_IPC__({ cmd: "exit_app", callback: ok, error: ok+1 }); })`).catch(() => {});
    if (fs.existsSync(log)) for (const l of fs.readFileSync(log, "utf8").split(/\r?\n/)) if (/pose-error|exception/i.test(l)) console.log(l);
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch {}
    await delay(800);
    if (app.exitCode === null) app.kill();
  }
})();
