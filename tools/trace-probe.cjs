// End-to-end check of process tracing and load spikes on the real build.
// Starts the release EXE with an isolated profile and a WebView2 debugging
// port, then uses Python as an untrusted "launcher" to:
//   1. open a visible console (cmd) — the pet must name python as the origin;
//   2. start a hidden PowerShell with an encoded command (it only sleeps) —
//      must be flagged suspicious and announced;
//   3. burn every CPU core for ~14 s — a CPU spike with python as culprit.
// Every bubble the pet shows is recorded, and the trace journal is dumped.
//   4. add a harmless test value to HKCU\...\Run — the pet must ask whether
//      to remove it, with buttons; "Убрать" (via the scene's own handler)
//      must delete it into quarantine, restore must put it back; the value
//      is deleted at the end in any case;
//   5. activity (--sleep): short idle/sleep thresholds, injected mouse
//      "jiggles" must not wake the pet, one injected key press must.
// Usage: node tools/trace-probe.cjs [--exe PATH] [--skip-cpu] [--sleep]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exeArg = args.indexOf("--exe");
const exe = path.resolve(exeArg >= 0 ? args[exeArg + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-trace-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9431 + Math.floor(Math.random() * 50);
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: {
    ...process.env,
    LOCALAPPDATA: qa,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  },
});
const py = (code, opts = {}) =>
  cp.spawn("python", ["-c", code], { stdio: "ignore", windowsHide: true, ...opts });
(async () => {
  let ws;
  const bubbles = [];
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
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id;
        pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const evalJs = async (expression) =>
      (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const invoke = (cmd, extra = {}) =>
      evalJs(`new Promise((resolve, reject) => {
        const ok = Math.floor(Math.random() * 0x3fffffff), err = ok + 1;
        window["_" + ok] = (r) => { delete window["_" + ok]; delete window["_" + err]; resolve(JSON.stringify(r ?? null)); };
        window["_" + err] = (e) => { delete window["_" + ok]; delete window["_" + err]; reject(String(e)); };
        window.__TAURI_IPC__({ cmd: ${JSON.stringify(cmd)}, callback: ok, error: err, ...${JSON.stringify(extra)} });
      })`);
    let watching = true;
    (async () => {
      let last = "";
      while (watching) {
        const b = await evalJs(`(() => { const s = window.__PET_SCENE__; const b = s && s.brain && s.brain.bubble; return b ? b.text : ""; })()`).catch(() => "");
        if (b && b !== last) bubbles.push({ at: new Date().toISOString().slice(11, 19), text: b });
        last = b || last;
        await delay(250);
      }
    })();
    // Let the greeting pass and the load baseline settle.
    await delay(12000);
    // Clear the greeting bubble so the next lines are not blocked.
    await evalJs(`(() => { const s = window.__PET_SCENE__; if (s) { s.brain.bubble = undefined; s.brain.reaction = undefined; } })()`);

    console.log("step 1: visible console from python");
    py("import subprocess,time;subprocess.Popen('cmd /c timeout /t 4 >nul', creationflags=subprocess.CREATE_NEW_CONSOLE);time.sleep(6)");
    await delay(7000);

    console.log("step 2: hidden encoded PowerShell from python");
    const enc = Buffer.from("Start-Sleep -Seconds 3", "utf16le").toString("base64");
    py(`import subprocess,time;subprocess.Popen(['powershell','-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${enc}'], creationflags=0x08000000);time.sleep(5)`);
    await delay(7000);

    if (!args.includes("--skip-cpu")) {
      console.log("step 3: CPU burn from python (~14 s)");
      cp.spawn("python", [path.join(__dirname, "burn.py"), "14"], { stdio: "ignore", windowsHide: true });
      await delay(22000);
    }
    // ---- 4. autostart
    const reg = (...a) => cp.spawnSync("reg.exe", a, { encoding: "utf8", windowsHide: true });
    const RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const autorun = {};
    console.log("step 4: test value in HKCU Run");
    await evalJs(`(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; })()`);
    try {
      reg("add", RUN, "/v", "TracePetTest", "/t", "REG_SZ", "/d", "C:\\Windows\\System32\\notepad.exe /tracepet-test", "/f");
      let bubble = null;
      for (let i = 0; i < 40 && !bubble; i++) {
        await delay(250);
        bubble = await evalJs(`(() => { const b = window.__PET_SCENE__.brain.bubble; return b && b.actions && b.actions.some(a => a.id.startsWith("autorun-")) ? { text: b.text, actions: b.actions } : null; })()`);
      }
      autorun.asked = !!bubble;
      autorun.buttons = bubble ? bubble.actions.map((a) => a.label) : [];
      await delay(600);
      const shot = cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "desktop-shot.ps1"), "-AppPid", String(app.pid), "-Out", "tools\\probe-autorun.png"], { encoding: "utf8", windowsHide: true });
      autorun.screenshot = /Screenshot/.test(shot.stdout);
      const removeId = bubble?.actions.find((a) => a.id.startsWith("autorun-remove:"))?.id;
      if (removeId) {
        await evalJs(`window.__PET_SCENE__.act(${JSON.stringify(removeId)})`);
        await delay(1500);
      }
      autorun.removedFromRegistry = reg("query", RUN, "/v", "TracePetTest").status !== 0;
      const view = JSON.parse((await invoke("autorun_view")) || "null");
      autorun.inQuarantine = !!view?.quarantine.some((q) => q.entry.name === "TracePetTest");
      autorun.afterRemoveBubble = await evalJs(`(window.__PET_SCENE__.brain.bubble || {}).text || ""`);
      await invoke("autorun_restore", { id: "hkcu-run|TracePetTest" });
      autorun.restored = reg("query", RUN, "/v", "TracePetTest").status === 0;
    } finally {
      reg("delete", RUN, "/v", "TracePetTest", "/f");
      autorun.cleanedUp = reg("query", RUN, "/v", "TracePetTest").status !== 0;
    }
    // ---- 5. activity
    const activity = {};
    if (args.includes("--sleep")) {
      console.log("step 5: activity — short thresholds, jiggles, then a key (~2.5 min, do not touch the PC)");
      const store = JSON.parse(await invoke("load_store"));
      await invoke("save_settings", { settings: { ...store.settings, idleMinutes: 1, sleepMinutes: 2, commentMinutes: 1 } });
      const jiggle = () => cp.spawnSync("python", ["-c", "import ctypes,time\nfor i in range(30):\n ctypes.windll.user32.mouse_event(1, 3 if i%2 else -3, 0, 0, 0); time.sleep(0.03)"], { windowsHide: true });
      const state = () => evalJs(`(() => { const b = window.__PET_SCENE__.brain; return { base: b.base, idle: b.last ? b.last.idle : -1, jitter: b.last ? b.last.jitter : -1 }; })()`);
      const start = Date.now();
      let slept = null;
      while (Date.now() - start < 170000) {
        jiggle();
        await delay(8000);
        const st = await state();
        if (st.base === "sleep" && !slept) slept = { afterSec: Math.round((Date.now() - start) / 1000), ...st };
        if (slept && Date.now() - start > slept.afterSec * 1000 + 15000) break;
      }
      activity.slept = slept;
      activity.stillAsleepAfterJiggles = slept ? (await state()).base === "sleep" : false;
      cp.spawnSync("python", ["-c", "import ctypes;u=ctypes.windll.user32;u.keybd_event(0x10,0,0,0);u.keybd_event(0x10,0,2,0)"], { windowsHide: true });
      await delay(2500);
      activity.afterKey = await state();
      activity.wokeUp = activity.afterKey.base !== "sleep";
      activity.bubbles = bubbles.slice(-4).map((b) => b.text);
    }
    watching = false;
    await delay(400);
    const view = JSON.parse((await invoke("trace_view")) || "null");
    const mine = (view?.events ?? []).filter((e) => e.origin?.name === "python.exe" || e.chain.includes("python.exe"));
    console.log("\n--- pet bubbles ---");
    for (const b of bubbles) console.log(b.at, b.text);
    console.log("\n--- trace journal (python-originated) ---");
    for (const e of mine)
      console.log(`${e.child.name} <- ${e.chain.join(" <- ")} | origin ${e.origin?.name} ${e.origin?.location} signed=${e.origin?.signed} | visible=${e.visible} flash=${e.flash} | ${e.verdict} score ${e.score} [${e.flags.join(", ")}] x${e.repeat}`);
    console.log("\n--- load ---");
    console.log(JSON.stringify(view?.load));
    const log = path.join(qa, "DrizzDesktop", "diagnostic.log");
    if (fs.existsSync(log)) {
      console.log("\n--- diagnostic (trace/load/spike) ---");
      for (const l of fs.readFileSync(log, "utf8").split(/\r?\n/)) if (/\[(trace|load)\]|spike|hooks|trace:/.test(l)) console.log(l.slice(11));
    }
    const checks = {
      visibleConsoleNamed: bubbles.some((b) => /python/i.test(b.text)) && mine.some((e) => e.child.name === "cmd.exe" && e.visible),
      hiddenEncodedFlagged: mine.some((e) => e.child.name === "powershell.exe" && e.verdict === "suspicious" && e.flags.includes("encoded") && !e.visible),
      alertSpoken: bubbles.some((b) => /закодированная команда|скрытое окно/.test(b.text)),
      cpuSpike: args.includes("--skip-cpu") ? "skipped" : bubbles.some((b) => /Проц|Процессор/.test(b.text) && /python/i.test(b.text)),
    };
    console.log("\nautorun:", JSON.stringify(autorun, null, 1));
    if (args.includes("--sleep")) console.log("\nactivity:", JSON.stringify(activity, null, 1));
    console.log("\nchecks:", JSON.stringify(checks));
    await invoke("exit_app").catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
    process.exitCode = 1;
  } finally {
    try {
      ws?.close();
    } catch {}
    await delay(800);
    if (app.exitCode === null) app.kill();
  }
})();
