// Live run of every mini-game on the real build, through the same path as
// the panel buttons (pet-command). Real mouse clicks on the pet for the
// clicker and a real moving cursor for "catch". Reports each round.
// Usage: node tools/games-probe.cjs [--exe PATH]
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const exe = path.resolve(args.includes("--exe") ? args[args.indexOf("--exe") + 1] : "src-tauri/target/release/Drizz Desktop.exe");
const qa = path.join(__dirname, "qa-games-" + Date.now());
fs.mkdirSync(path.join(qa, "DrizzDesktop"), { recursive: true });
fs.writeFileSync(path.join(qa, "DrizzDesktop", "state.json"), JSON.stringify({ settings: { nightSleep: false, pet: "aqua-wisp" }, memory: { cardShown: true }, token: "t", hasKey: false }));
const port = 9871 + Math.floor(Math.random() * 40);
const app = cp.spawn(exe, ["--background", "--diag"], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: qa, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` } });
const mouse = (script) =>
  new Promise((resolve) => {
    const c = cp.spawn("powershell", ["-NoProfile", "-Command", `
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class M { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); }
'@
[M]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
${script}`], { windowsHide: true });
    c.on("exit", resolve);
  });
(async () => {
  const out = {};
  try {
    let pet;
    for (let i = 0; i < 40 && !pet; i++) {
      try { pet = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page" && !p.url.includes("panel=")); } catch {}
      if (!pet) await delay(500);
    }
    const ws = new WebSocket(pet.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) (pend.get(d.id)(d), pend.delete(d.id)); };
    const js = (e) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result?.result?.value ?? d.result?.exceptionDetails?.exception?.description)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: e, returnByValue: true, awaitPromise: true } })); });
    const state = () => js(`(() => { const s = window.__PET_SCENE__, b = s.brain.bubble; return { round: s.games.round && { kind: s.games.round.kind, score: s.games.round.score }, text: b ? b.text : "", sub: b ? b.sub || "" : "", buttons: b && b.actions ? b.actions.map(a => a.label + "=" + a.id) : [], money: s.brain.game.money, play: s.play.state, act: s.lastAction, base: s.brain.base }; })()`);
    const cmd = (c) => js(`window.__PET_SCENE__.onCommand(${JSON.stringify(c)})`);
    // Every game starts from sleep: the pet must get up and play.
    const quiet = () => js(`(() => { const s = window.__PET_SCENE__; s.brain.base = "sleep"; s.brain.bubble = undefined; s.brain.reaction = undefined; s.nextActivity = Date.now() + 600000; s.world.target = null; })()`);
    await delay(7000);
    // ---- rock-paper-scissors, three times
    const rps = [];
    for (const pick of ["rock", "scissors", "paper"]) {
      await quiet();
      await cmd({ game: "rps" });
      await delay(600);
      const q = await state();
      await delay(500); // the balloon ignores clicks for 450 ms after it changes
      await js(`window.__PET_SCENE__.act("game:${pick}")`);
      await delay(300);
      const a = await state();
      rps.push({ question: q.text, buttons: q.buttons, answer: a.text, result: a.sub, roundLeft: !!a.round });
      await delay(1200);
    }
    out.rps = rps;
    // ---- which hand, 4 times
    const hand = [];
    for (let i = 0; i < 4; i++) {
      await quiet();
      await cmd({ game: "hand" });
      await delay(1100);
      const q = await state();
      await js(`window.__PET_SCENE__.act("game:${i % 2 ? "right" : "left"}")`);
      await delay(300);
      const a = await state();
      hand.push({ question: q.text, buttons: q.buttons.length, answer: a.text, result: a.sub, roundLeft: !!a.round });
      await delay(1200);
    }
    out.hand = hand;
    // ---- clicker: 20 real clicks on the pet in 10 s
    await quiet();
    await cmd({ game: "clicker" });
    await delay(500);
    const p = await js(`(() => { const s = window.__PET_SCENE__, w = s.world; return { x: Math.round(w.x), y: Math.round(w.y - s.sizePx() * 0.45) }; })()`);
    const clicks = [];
    for (let i = 0; i < 20; i++) clicks.push("[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 260");
    const clickActs = new Set();
    let clicking = true;
    (async () => { while (clicking) { const s = await state(); clickActs.add(s.act + "/" + s.base); await delay(100); } })();
    await mouse(`[M]::SetCursorPos(${p.x}, ${p.y}); Start-Sleep -Milliseconds 200\n${clicks.join("\n")}`);
    clicking = false;
    const mid = await state();
    let endClick = await state();
    for (let i = 0; i < 60 && !endClick.sub; i++) { await delay(250); endClick = await state(); }
    out.clicker = { acts: [...clickActs], scoreDuringRound: mid.round?.score, afterText: endClick.text, result: endClick.sub, roundLeft: !!endClick.round, petMovedDuring: null };
    // ---- catch the cursor: the cursor circles near the pet for 20 s
    await quiet();
    await cmd({ game: "catch" });
    const q = await js(`(() => { const s = window.__PET_SCENE__, w = s.world; return { x: Math.round(w.x), y: Math.round(w.y) }; })()`);
    const moves = [];
    for (let i = 0; i < 180; i++) {
      const a = i / 9;
      moves.push(`[M]::SetCursorPos(${q.x} + [int](${Math.round(Math.cos(a) * 260)}), ${q.y - 70} + [int](${Math.round(Math.sin(a) * 40)})); Start-Sleep -Milliseconds 110`);
    }
    const states = new Set();
    let sampling = true;
    (async () => { while (sampling) { const s = await state(); states.add(s.play + ":" + s.act); await delay(150); } })();
    await mouse(moves.join("\n"));
    let endCatch = await state();
    for (let i = 0; i < 40 && !endCatch.sub; i++) { await delay(250); endCatch = await state(); }
    sampling = false;
    out.catch = { playStates: [...states], afterText: endCatch.text, result: endCatch.sub, roundLeft: !!endCatch.round };
    console.log(JSON.stringify(out, null, 1));
    await js(`window.__TAURI_IPC__({ cmd: "exit_app", callback: 1, error: 2 })`).catch(() => {});
  } catch (e) {
    console.error("probe failed:", e);
  } finally {
    await delay(1500);
    if (app.exitCode === null) app.kill();
    process.exit();
  }
})();
