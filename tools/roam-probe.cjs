// Live check: with a fresh profile the pet must not start in the tray corner
// and must not keep walking into the screen edges. Records the pet's x for
// N seconds of free life and reports the share of time near an edge.
// Usage: node tools/roam-probe.cjs [--exe PATH] [--seconds 90]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const exe = path.resolve(opt("--exe", "src-tauri/target/release/Drizz Desktop.exe"));
const seconds = +opt("--seconds", "90");
const qa = path.join(__dirname, "qa-roam-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9661 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background"], {
  windowsHide: true,
  env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` },
});
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
    let first = null;
    for (let i = 0; i < 40 && !first; i++) {
      first = await js(`(() => { const s = window.__PET_SCENE__; if (!s || !s.world.initialized) return null; const w = s.world, m = s.monitors.find(m => w.x >= m.bounds.left && w.x < m.bounds.right); return { x: Math.round(w.x), l: m.work.left, r: m.work.right }; })()`).catch(() => null);
      if (!first) await delay(250);
    }
    const xs = [];
    let edgeMs = 0, lastEdge = false;
    for (let t = 0; t < seconds * 1000; t += 500) {
      const st = await js(`(() => { const w = window.__PET_SCENE__.world, m = window.__PET_SCENE__.monitors.find(m => w.x >= m.bounds.left && w.x < m.bounds.right); return { x: w.x, l: m.work.left, r: m.work.right }; })()`);
      const near = st.x - st.l < 150 || st.r - st.x < 150;
      if (near) edgeMs += 500;
      xs.push(Math.round(st.x));
      await delay(500);
    }
    const span = first.r - first.l;
    console.log(JSON.stringify({
      startX: first.x,
      startFromRightEdge: first.r - first.x,
      startShareAcross: +((first.x - first.l) / span).toFixed(2),
      nearEdgePct: Math.round((100 * edgeMs) / (seconds * 1000)),
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      work: [first.l, first.r],
    }));
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
