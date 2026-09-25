// Checks the Windows-event side end to end on the real build: starts the app
// with an isolated profile and a WebView2 debugging port, reads the snapshots
// the Rust side emits, drives a few desktop changes (volume, mute, clipboard,
// Caps Lock, a new window) and reports which reactions the pet produced.
// Usage: node tools/env-probe.cjs
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (script) =>
  cp.execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
const argv = process.argv.slice(2);
const exe = path.resolve(argv.includes("--exe") ? argv[argv.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
// The user's clipboard text is put back afterwards; PrintScreen (which opens
// the Snipping Tool on Windows 11) only with --screenshot.
const clipBefore = (() => {
  try {
    return ps("Get-Clipboard -Raw");
  } catch {
    return null;
  }
})();
// Only the Explorer window this probe opens is closed, never the user's own.
const explorerBefore = ps("(New-Object -ComObject Shell.Application).Windows() | % { $_.HWND }").split(/\r?\n/).filter(Boolean);
const qa = path.join(__dirname, "qa-env-" + Date.now());
fs.mkdirSync(qa, { recursive: true });
const port = 9331 + Math.floor(Math.random() * 50);
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
    // The scene needs a moment to boot before its director can be hooked.
    await delay(4000);
    const evalJs = async (expr) =>
      (
        await send("Runtime.evaluate", {
          expression: expr,
          returnByValue: true,
          awaitPromise: true,
        })
      ).result?.result?.value;
    // Record every snapshot's desktop block and every reaction that fires.
    await evalJs(`(() => {
      window.__env = [];
      window.__events = [];
      const s = window.__PET_SCENE__;
      if (s && s.brain) {
        const orig = s.brain.event.bind(s.brain);
        s.brain.event = (name, now, direct, text, vars) => {
          const ok = orig(name, now, direct, text, vars);
          if (ok) window.__events.push(name + (s.brain.bubble ? " :: " + s.brain.bubble.text : ""));
          return ok;
        };
      }
      return !!(s && s.brain);
    })()`).then((hooked) => console.log("scene hooked:", hooked));
    await delay(3500);
    console.log(
      "env sample:",
      await evalJs("JSON.stringify(window.__PET_SCENE__ && window.__PET_SCENE__.snapshot && window.__PET_SCENE__.snapshot.env)"),
    );
    const steps = [
      ["volume down", "$s=New-Object -ComObject WScript.Shell; 1..8 | %{ $s.SendKeys([char]174); Start-Sleep -Milliseconds 60 }"],
      ["volume up", "$s=New-Object -ComObject WScript.Shell; 1..8 | %{ $s.SendKeys([char]175); Start-Sleep -Milliseconds 60 }"],
      ["clipboard", "Set-Clipboard -Value ('probe ' + (Get-Random))"],
      ["mute", "$s=New-Object -ComObject WScript.Shell; $s.SendKeys([char]173)"],
      ["unmute", "$s=New-Object -ComObject WScript.Shell; $s.SendKeys([char]173)"],
      ["caps lock", "$s=New-Object -ComObject WScript.Shell; $s.SendKeys('{CAPSLOCK}')"],
      ["caps off", "$s=New-Object -ComObject WScript.Shell; $s.SendKeys('{CAPSLOCK}')"],
      ...(argv.includes("--screenshot") ? [] : [["(screenshot skipped, pass --screenshot)", ""]]),
      [argv.includes("--screenshot") ? "screenshot" : "", "Add-Type -Name K -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, int e);'; [W.K]::keybd_event(0x2C,0,0,0); [W.K]::keybd_event(0x2C,0,2,0)"],
      ["new window", "Start-Process explorer.exe -ArgumentList 'C:\' ; Start-Sleep -Seconds 3"],
      ["close window", `$keep = @(${explorerBefore.map((h) => "'" + h + "'").join(",") || "''"}); (New-Object -ComObject Shell.Application).Windows() | ?{ $keep -notcontains [string]$_.HWND } | %{ $_.Quit() }`],
    ];
    for (const [name, script] of steps) {
      if (!name || !script) continue;
      try {
        ps(script);
      } catch (e) {
        console.log(`${name}: could not drive (${String(e.message).split("\n")[0]})`);
      }
      await delay(2600);
      console.log(
        `${name} ->`,
        await evalJs("JSON.stringify(window.__PET_SCENE__ && window.__PET_SCENE__.snapshot && window.__PET_SCENE__.snapshot.env)"),
      );
    }
    console.log(
      "reactions:\n" +
        (await evalJs("window.__events.join('\\n')")),
    );
  } catch (e) {
    console.error("FAIL", e.message);
    process.exitCode = 1;
  } finally {
    if (clipBefore !== null) {
      try {
        fs.writeFileSync(path.join(qa, "clip.txt"), clipBefore.replace(/\r?\n$/, ""), "utf8");
        ps(`Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 '${path.join(qa, "clip.txt")}')`);
      } catch {}
    }
    if (ws) ws.close();
    try {
      cp.execFileSync("taskkill", ["/pid", String(app.pid), "/t", "/f"], {
        windowsHide: true,
      });
    } catch {}
  }
})();
