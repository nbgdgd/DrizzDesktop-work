// Live check of the 0.2 additions on the real desktop:
//  - first run (empty profile) opens the welcome page;
//  - right click card (level, money, needs, buttons) is drawn and clickable;
//  - a work shift shows the status panel above the pet;
//  - English mode: lines and the tray come in English.
// Screenshots: tools/feat-*.png.  Usage: node tools/features-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exe = path.resolve(args.includes("--exe") ? args[args.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-feat-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9791 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
const shot = (name) =>
  cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", `tools\\feat-${name}.png`], { windowsHide: true });
(async () => {
  const out = {};
  try {
    let pages = [];
    let pet;
    for (let i = 0; i < 40 && !pet; i++) {
      try {
        pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        pet = pages.find((p) => p.type === "page" && !p.url.includes("panel=") && p.url !== "about:blank");
      } catch {}
      if (!pet) await delay(500);
    }
    await delay(3000);
    pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    out.firstRunPanel = pages.filter((p) => p.url.includes("panel=")).map((p) => p.url.split("panel=")[1]);
    const ws = new WebSocket(pet.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) (pend.get(d.id)(d), pend.delete(d.id)); };
    const js = (e) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: e, returnByValue: true, awaitPromise: true } })); });
    const ipc = (cmd, extra = {}) => js(`new Promise((resolve, reject) => { const ok = Math.floor(Math.random()*1e9), err = ok+1; window["_"+ok] = (r) => resolve(JSON.stringify(r ?? null)); window["_"+err] = (e) => resolve("ERR " + e); window.__TAURI_IPC__({ cmd: ${JSON.stringify(cmd)}, callback: ok, error: err, ...${JSON.stringify(extra)} }); })`);
    await delay(4000);
    // Right click card.
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.nextActivity = Date.now() + 60000; s.world.target = null; s.quick.toggle(Date.now()); })()`);
    await delay(700);
    out.card = await js(`(() => { const s = window.__PET_SCENE__; return { open: s.quick.open }; })()`);
    shot("card");
    await js(`window.__PET_SCENE__.quick.close()`);
    // Work shift + status panel.
    const r = await js(`(() => { const s = window.__PET_SCENE__; s.work("flyers"); return { job: s.brain.game.job && s.brain.game.job.id, bubble: (s.brain.bubble || {}).text || "" }; })()`);
    out.work = r;
    await delay(1500);
    shot("work");
    // English.
    const store = JSON.parse(await ipc("load_store"));
    await ipc("save_settings", { settings: { ...store.settings, lang: "en" } });
    await delay(800);
    await js(`(() => { const s = window.__PET_SCENE__; s.brain.game = { ...s.brain.game, job: null }; s.brain.bubble = undefined; s.brain.reaction = undefined; s.brain.event("click", Date.now(), true); })()`);
    await delay(1200);
    out.english = await js(`(() => { const s = window.__PET_SCENE__; return (s.brain.bubble || {}).text || ""; })()`);
    shot("english");
    const diag = path.join(qa, "DrizzDesktop", "diagnostic.log");
    out.errors = fs.existsSync(diag) ? fs.readFileSync(diag, "utf8").split(/\r?\n/).filter((l) => /error|exception|failed/i.test(l)).slice(0, 5) : [];
    console.log(JSON.stringify(out, null, 1));
    await ipc("exit_app");
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    await delay(1500);
    if (app.exitCode === null) app.kill();
    process.exit();
  }
})();
