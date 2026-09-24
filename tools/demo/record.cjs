// Records the promo video on the demo desktop (tools/demo/desktop.html):
// throw, cursor beating, energy drink, beer brawl, a suspicious console and
// an autostart entry, then an end card. Everything the pet does is its real
// code; only Windows is played by the page.
// Usage: npm run dev, then
//   NODE_PATH=$(npm root -g) node tools/demo/record.cjs <outDir> [baseUrl] [url-on-card]
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const out = path.resolve(process.argv[2] || "demo-out");
const base = process.argv[3] || "http://127.0.0.1:1420/";
const url = process.argv[4] || "github.com/nbgdgd/DrizzDesktop-work";
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const log = [];
  await page.goto(base + "tools/demo/desktop.html");
  // The preview keeps its store in localStorage (same origin as the iframe):
  // Drizz, a bigger pet for a 720p frame, first-run card already seen.
  await page.evaluate(() => {
    localStorage.setItem(
      "drizz-preview",
      JSON.stringify({ settings: { pet: "drizz", size: 120 }, memory: { cardShown: true }, token: "", hasKey: false }),
    );
  });
  await page.reload();
  await page.waitForFunction(() => window.demo?.scene()?.ready, null, { timeout: 20000 });
  const js = (fn, arg) => page.evaluate(fn, arg);
  const bubble = () => js(() => window.demo.scene().brain.bubble?.text ?? "");
  const note = async (tag) => log.push([tag, await bubble()]);
  // Drizz, a clean slate, no first-run card.
  await js(() => {
    const s = window.demo.scene();
    s.hideCard?.();
    s.store.settings.pet = "drizz";
    s.brain.updateSettings(s.store.settings);
    s.changePet();
    // Achievements would talk over the scenes: mark them as already had.
    s.brain.life.achievements = new Proxy({}, { get: () => 1 });
    s.world.x = 820;
    s.world.y = 672;
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
  });
  const cap = (t, s) => js(([t, s]) => window.demo.caption(t, s), [t, s]);
  const move = (x, y, ms, down, ease) => js((a) => window.demo.move(...a), [x, y, ms, down, ease]);
  const pet = () => js(() => window.demo.petAt());
  const say = (event, text) =>
    js(([e, t]) => {
      const s = window.demo.scene();
      s.brain.reset(e);
      s.brain.event(e, Date.now(), true, t);
    }, [event, text]);

  // ---- 0. Hello
  await cap("Drizz <em>Desktop</em>", "Питомец, который живёт у вас на рабочем столе");
  await move(1040, 420, 600);
  await say("hello");
  await wait(3200);

  // ---- 1. Grab, swing, shake, throw
  await cap("Схватили — <em>висит и дрыгает лапами</em>", "Раскачивается за курсором как маятник");
  // Already a little offended: after this throw it will hold up its sign.
  await js(() => {
    const s = window.demo.scene();
    s.brain.game = { ...s.brain.game, grudge: 25 };
  });
  let p = await pet();
  await move(p.x, p.y - p.size * 0.75, 700);
  await js(() => {
    const s = window.demo.scene(), c = window.demo.cur, now = Date.now();
    window.demo.press(true);
    s.brain.bubble = undefined;
    s.brain.wake(now);
    s.pickedFrom = null;
    s.pickedGoal = null;
    s.world.begin(c.x, c.y, now, 0);
    s.play.cancel();
    s.forced = null;
    s.dragSeenDown = false;
    s.dragAnnounced = false;
    s.pressAt = { x: c.x, y: c.y };
    s.draggingSince = now;
  });
  await move(700, 330, 900, true);
  await move(900, 300, 700, true);
  await move(620, 320, 800, true);
  await wait(500);
  await cap("Потрясли — <em>кружится голова</em>");
  for (let i = 0; i < 10; i++) await move(620 + (i % 2 ? 90 : -90), 320, 110, true, "linear");
  await note("shaken");
  await cap("Бросок!", "Кувыркается в полёте, отскакивает, приземляется");
  await move(520, 360, 350, true);
  await move(980, 180, 180, true, "in");
  await js(() => window.demo.press(false));
  await wait(3200);
  await note("landed");
  await cap("…и <em>запоминает</em>", "Молча смотрит, потом достаёт табличку");
  await wait(4200);
  await note("sign");

  // ---- 2. Revenge on the cursor
  await cap("Обидели? <em>Он бьёт курсор</em>", "Подходит, бьёт лапой — курсор отлетает по-настоящему");
  await js(() => {
    const s = window.demo.scene();
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
    s.brain.game = { ...s.brain.game, grudge: 85 };
    s.brain.threw(Date.now());
    s.brain.bubble = undefined;
  });
  // The user keeps teasing: the cursor comes back next to the pet.
  for (let i = 0; i < 6; i++) {
    p = await pet();
    const side = p.x > 900 ? -1 : 1;
    await move(p.x + side * (140 + (i % 2) * 60), p.y - p.size * 0.35, 600);
    await wait(1700);
  }
  await note("revenge");

  // ---- 3. Energy drink, dragged from the shop onto the pet
  await cap("Энергетик — <em>носится как угорелый</em>", "Еду можно просто перетащить на питомца");
  await js(() => {
    const s = window.demo.scene();
    s.play.cancel();
    s.brain.game = { ...s.brain.game, grudge: 0 };
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
    window.demo.cur.x = 1230;
    window.demo.cur.y = 110;
    window.demo.carry("/shop/energy.png");
    window.demo.emit("carry", { id: "energy" });
    window.demo.press(true);
  });
  p = await pet();
  await move(p.x, p.y - p.size * 0.6, 1300, true);
  await js(() => {
    window.demo.press(false);
    window.demo.carry("");
  });
  await move(1150, 250, 700);
  await wait(9000);
  await note("energy");
  await js(() => window.demo.scene().buzz.cancel());

  // ---- 4. Beer: a drunk brawler that punches the window behind it
  const browserWin = await js(() =>
    window.demo.openWindow({
      x: 90,
      y: 140,
      w: 1100,
      h: 530,
      title: "Рабочий отчёт — Браузер",
      app: "chrome.exe",
      body: "<b style='font-size:20px;color:#e6ebf5'>Квартальный отчёт</b><br><br>Выручка ▲ 12%<br>Расходы ▼ 3%<br><br>Не забыть: отправить до пятницы.",
    }),
  );
  await cap("Пиво — <em>становится драчуном</em>", "Шатается, икает, лупит курсор и окна перед собой");
  await js(() => {
    const s = window.demo.scene();
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
    s.world.support = null;
    s.world.x = 640;
    window.demo.cur.x = 1230;
    window.demo.cur.y = 110;
    window.demo.carry("/shop/beer.png");
    window.demo.emit("carry", { id: "beer" });
    window.demo.press(true);
  });
  p = await pet();
  await move(p.x, p.y - p.size * 0.6, 1200, true);
  await js(() => {
    window.demo.press(false);
    window.demo.carry("");
  });
  for (let i = 0; i < 7; i++) {
    p = await pet();
    const side = p.x > 900 ? -1 : 1;
    await move(p.x + side * 150, p.y - p.size * 0.35, 700);
    await wait(1600);
  }
  await note("beer");
  await js((id) => {
    window.demo.scene().buzz.cancel();
    window.demo.closeWindow(id);
  }, browserWin);

  // ---- 5. A console pops up out of nowhere
  await cap("Вылезла консоль? <em>Он скажет, кто её запустил</em>", "Следит за cmd, PowerShell и скриптами — ничего не блокирует");
  await js(() => {
    const s = window.demo.scene();
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
    s.world.x = 900;
  });
  await move(1100, 300, 500);
  const cmd = await js(() =>
    window.demo.openWindow({ kind: "cmd", x: 170, y: 90, w: 600, h: 300, title: "C:\\Windows\\System32\\cmd.exe", app: "cmd.exe" }),
  );
  await js((id) => window.demo.typeInto(id, "Microsoft Windows [Version 10.0.26200]\n\nC:\\Users\\user\\AppData\\Local\\Temp> powershell -w hidden -enc SQBFAFgAIAAoAE4A...\n", 18), cmd);
  await wait(1500);
  await js(() => {
    const now = Date.now();
    window.demo.emit("trace", {
      id: 1,
      time: now,
      first: now,
      kind: "console",
      child: { pid: 4412, name: "powershell.exe", path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", location: "system", signed: true, role: "" },
      origin: { pid: 3120, name: "update_helper.exe", path: "C:\\Users\\user\\AppData\\Local\\Temp\\update_helper.exe", location: "temp", signed: false, role: "" },
      chain: ["powershell.exe", "cmd.exe", "update_helper.exe", "explorer.exe"],
      visible: true,
      flash: false,
      flags: ["hidden", "encoded", "temp-origin"],
      score: 7,
      verdict: "suspicious",
      trusted: false,
      repeat: 1,
      speak: "alert",
    });
  });
  await wait(7500);
  await note("trace");
  await js((id) => window.demo.closeWindow(id), cmd);

  // ---- 6. Autostart
  await cap("Кто-то прописался в автозагрузку?", "Спросит, убрать ли — и уберёт в карантин одной кнопкой");
  await js(() => {
    const s = window.demo.scene();
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
    window.demo.autorunName = "WinUpdater";
    window.demo.emit("autorun", {
      kind: "added",
      entry: {
        id: "hkcu-run:WinUpdater",
        scope: "hkcu-run",
        name: "WinUpdater",
        command: "C:\\Users\\user\\AppData\\Local\\Temp\\wupd.exe /silent",
        target: "C:\\Users\\user\\AppData\\Local\\Temp\\wupd.exe",
        location: "temp",
        signed: false,
        user: true,
      },
    });
  });
  await wait(3500);
  await note("autorun");
  // Point at "Убрать" in the balloon and press it.
  const btn = await js(() => {
    const s = window.demo.scene();
    const b = s.balloon.buttons[0];
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(document.getElementById("pet").style.transform) || [0, 0, 0];
    return { x: +m[1] + b.x + b.width / 2, y: +m[2] + b.y + b.height / 2 };
  });
  await move(btn.x, btn.y, 900);
  await wait(300);
  await js(() => window.demo.scene().act("autorun-remove:hkcu-run:WinUpdater"));
  await wait(3500);
  await note("removed");

  // ---- 7. End card
  await cap("");
  await js((u) => window.demo.card(u), url);
  await wait(5000);
  const video = page.video();
  await ctx.close();
  const file = await video.path();
  const final = path.join(out, "drizz-desktop-promo.webm");
  fs.renameSync(file, final);
  console.log(JSON.stringify({ video: final, log, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
