// Progression check on the real build with a fresh profile: the first-run
// card, the click status line, sounds, buying an upgrade and starting a shift.
// Usage: node tools/game-probe.cjs
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = path.resolve("src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-game-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9411 + Math.floor(Math.random() * 50);
const app = cp.spawn(exe, ["--background", "--diag"], {
  windowsHide: true,
  env: {
    ...process.env,
    LOCALAPPDATA: qa,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --autoplay-policy=no-user-gesture-required`,
  },
});
(async () => {
  let ws;
  try {
    let pet;
    for (let i = 0; i < 40; i++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        pet = pages.find(
          (p) =>
            p.type === "page" &&
            !p.url.includes("panel=") &&
            p.url !== "about:blank",
        );
        if (pet) break;
      } catch {}
      await delay(500);
    }
    if (!pet) throw Error("No pet page via CDP");
    ws = new WebSocket(pet.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
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
    await send("Runtime.enable");
    const evalJs = async (expr) =>
      (
        await send("Runtime.evaluate", {
          expression: expr,
          returnByValue: true,
          awaitPromise: true,
        })
      ).result?.result?.value;
    const invoke = (cmd, extra = {}) =>
      evalJs(`new Promise((resolve, reject) => {
        const ok = Math.floor(Math.random() * 0x3fffffff), err = ok + 1;
        window["_" + ok] = (r) => { delete window["_" + ok]; delete window["_" + err]; resolve(JSON.stringify(r ?? null)); };
        window["_" + err] = (e) => { delete window["_" + ok]; delete window["_" + err]; resolve("ERR " + String(e)); };
        window.__TAURI_IPC__({ cmd: ${JSON.stringify(cmd)}, callback: ok, error: err, ...${JSON.stringify(extra)} });
      })`);
    // Count sound playback attempts.
    await evalJs(`(() => {
      window.__sfx = [];
      const orig = HTMLAudioElement.prototype.play;
      HTMLAudioElement.prototype.play = function () {
        window.__sfx.push((this.currentSrc || this.src || "").split("/").pop());
        return orig.apply(this, arguments);
      };
      return true;
    })()`);
    await delay(3500);
    console.log(
      "first-run card:",
      await evalJs(
        "JSON.stringify({card: !!window.__PET_SCENE__.card, text: window.__PET_SCENE__.card ? window.__PET_SCENE__.card.list.filter(o=>o.text).map(o=>o.text) : null, saved: window.__PET_SCENE__.store.memory.cardShown})",
      ),
    );
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot.result?.data) {
      const out = path.join(__dirname, "probe-card.png");
      fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
      console.log("screenshot:", out);
    }
    // Click status: what a left click on the pet puts in the balloon.
    console.log(
      "status line:",
      await evalJs(
        "(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.status(Date.now()); return s.brain.bubble && s.brain.bubble.text; })()",
      ),
    );
    // Upgrade and shift through the same commands the panel uses.
    console.log("buy_upgrade:", await invoke("buy_upgrade", { id: "stomach" }));
    await delay(900);
    console.log(
      "after upgrade:",
      await evalJs(
        "JSON.stringify({skills: window.__PET_SCENE__.brain.game.skills, money: Math.round(window.__PET_SCENE__.brain.game.money), bubble: window.__PET_SCENE__.brain.bubble && window.__PET_SCENE__.brain.bubble.text})",
      ),
    );
    console.log("start_job:", await invoke("start_job", { id: "flyers" }));
    await delay(900);
    console.log(
      "after job:",
      await evalJs(
        "JSON.stringify({job: window.__PET_SCENE__.brain.game.job, bubble: window.__PET_SCENE__.brain.bubble && window.__PET_SCENE__.brain.bubble.text, base: window.__PET_SCENE__.brain.base})",
      ),
    );
    // Finish the shift early and check the payout.
    console.log(
      "payout:",
      await evalJs(
        "(() => { const s = window.__PET_SCENE__; s.brain.game.job.endsAt = Date.now() - 10; const paid = s.brain.workPayout(Date.now()); return JSON.stringify({paid, money: Math.round(s.brain.game.money), jobsDone: s.brain.game.jobsDone, bubble: s.brain.bubble && s.brain.bubble.text}); })()",
      ),
    );
    await delay(600);
    console.log("sounds played:", await evalJs("JSON.stringify(window.__sfx)"));
    console.log(
      "panel tabs:",
      await invoke("open_panel", { tab: "work" }),
      await invoke("open_panel", { tab: "skills" }),
    );
  } catch (e) {
    console.error("FAIL", e.message);
    process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    try {
      cp.execFileSync("taskkill", ["/pid", String(app.pid), "/t", "/f"], {
        windowsHide: true,
      });
    } catch {}
  }
})();
