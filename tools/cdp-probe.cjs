// Diagnostic probe: launches the release EXE with an isolated profile and a
// local WebView2 debugging port, then reports console output, page errors,
// the Phaser texture state and a screenshot of the pet page.
// Usage: node tools/cdp-probe.cjs [--keep-profile DIR] [--exe PATH] [--wait MS]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const exe = path.resolve(
  opt("--exe", "src-tauri/target/release/Drizz Desktop.exe"),
);
const profile = opt("--keep-profile", path.join(__dirname, "qa-" + Date.now()));
const waitMs = +opt("--wait", "6000");
const port = 9224 + Math.floor(Math.random() * 100);
fs.mkdirSync(profile, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: {
    ...process.env,
    LOCALAPPDATA: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  },
});
app.on("exit", (c) => console.log("app exited", c));
let ws;
(async () => {
  let pages = [];
  for (let i = 0; i < 40; i++) {
    try {
      pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pet = pages.find(
        (p) => p.type === "page" && !p.url.includes("panel=") && p.url !== "about:blank",
      );
      if (pet) {
        pages = [pet];
        break;
      }
    } catch {}
    await delay(500);
  }
  const pet = pages[0];
  if (!pet) throw Error("No pet page via CDP");
  console.log("pet page:", pet.url);
  ws = new WebSocket(pet.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else if (d.method === "Runtime.consoleAPICalled") {
      logs.push(
        `[console.${d.params.type}] ` +
          d.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
      );
    } else if (d.method === "Runtime.exceptionThrown") {
      logs.push("[exception] " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
    } else if (d.method === "Log.entryAdded") {
      logs.push(`[log.${d.params.entry.level}] ${d.params.entry.text} ${d.params.entry.url ?? ""}`);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await delay(waitMs);
  const evalJs = async (expr) =>
    (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result;
  const state = await evalJs(`(() => {
    const c = document.querySelector('canvas');
    const d = window.__drizzDiag;
    return JSON.stringify({
      dpr: devicePixelRatio,
      inner: [innerWidth, innerHeight],
      canvas: c ? [c.width, c.height, c.clientWidth, c.clientHeight] : null,
      diag: d ? d() : null,
      body: document.body.className,
    });
  })()`);
  console.log("state:", state.result?.value ?? JSON.stringify(state));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot.result?.data) {
    const out = path.join(__dirname, "probe-pet.png");
    fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
    console.log("screenshot:", out);
  }
  // Tauri IPC from the page (same mechanism native-smoke.cjs used).
  const invoke = (cmd, extra = {}) =>
    evalJs(`new Promise((resolve, reject) => {
      const ok = Math.floor(Math.random() * 0x3fffffff), err = ok + 1;
      window["_" + ok] = (r) => { delete window["_" + ok]; delete window["_" + err]; resolve(JSON.stringify(r ?? null)); };
      window["_" + err] = (e) => { delete window["_" + ok]; delete window["_" + err]; reject(String(e)); };
      window.__TAURI_IPC__({ cmd: ${JSON.stringify(cmd)}, callback: ok, error: err, ...${JSON.stringify(extra)} });
    })`);
  if (args.includes("--panel")) {
    console.log("open_panel:", JSON.stringify(await invoke("open_panel", { tab: "settings" })));
    await delay(2500);
    const all = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    console.log("pages after open_panel:", all.filter((p) => p.type === "page").map((p) => p.url).join(" | "));
  }
  if (args.includes("--recenter")) {
    console.log("recenter_pet:", JSON.stringify(await invoke("recenter_pet")));
    await delay(1500);
  }
  if (args.includes("--exit")) {
    await invoke("exit_app").catch(() => {});
    await delay(1500);
    console.log("exit_app -> process exited:", app.exitCode !== null, "code", app.exitCode);
  }
  console.log("--- logs ---");
  for (const l of logs) console.log(l);
  console.log("--- end logs ---");
  try {
    fs.readdirSync(path.join(profile, "DrizzDesktop")).forEach((f) => console.log("profile file:", f));
    const log = path.join(profile, "DrizzDesktop", "diagnostic.log");
    if (fs.existsSync(log)) console.log(fs.readFileSync(log, "utf8"));
  } catch {}
})()
  .catch((e) => {
    console.error("probe failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      ws?.close();
    } catch {}
    if (app.exitCode === null) app.kill();
    await delay(300);
    if (app.exitCode === null) try { cp.execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  });
