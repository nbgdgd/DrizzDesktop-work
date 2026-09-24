// Live checks on the demo desktop: work status panel, right-click card,
// jumping onto a window, hitting a cursor above the head, inspecting a
// clicked spot. Prints what happened and saves one frame per check.
// Usage: npm run dev; NODE_PATH=$(npm root -g) node tools/demo/check.cjs <outDir>
const { chromium } = require("playwright");
const out = process.argv[2] || "check-out";
const base = process.argv[3] || "http://127.0.0.1:1420/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "tools/demo/desktop.html");
  await page.evaluate(() => localStorage.setItem("drizz-preview", JSON.stringify({ settings: { pet: "drizz", size: 110 }, memory: { cardShown: true }, token: "", hasKey: false })));
  await page.reload();
  await page.waitForFunction(() => window.demo?.scene()?.ready, null, { timeout: 20000 });
  const js = (fn, a) => page.evaluate(fn, a);
  const res = {};
  const reset = () =>
    js(() => {
      const s = window.demo.scene();
      s.brain.bubble = undefined;
      s.brain.reaction = undefined;
      s.forced = null;
      s.play.cancel();
      s.brain.game = { ...s.brain.game, job: null, grudge: 0 };
      s.brain.life.achievements = new Proxy({}, { get: () => 1 });
      s.world.support = null;
      s.world.x = 640;
      s.world.y = 672;
      s.world.target = null;
    });
  await reset();
  // 1. Work: status panel, then an alert on top of it.
  await js(() => window.demo.scene().work("flyers"));
  await wait(9000);
  res.work = await js(() => ({ job: window.demo.scene().brain.game.job?.id ?? "", bubble: window.demo.scene().brain.bubble?.text ?? "" }));
  await page.screenshot({ path: `${out}/1-work.png` });
  await js(() => {
    const s = window.demo.scene();
    s.brain.event("chatter", Date.now());
    s.brain.event("traceAlert", Date.now(), true, "Тревога! Кто-то дёрнул PowerShell со скрытым окном.");
  });
  await wait(2500);
  res.workAlert = await js(() => ({ text: window.demo.scene().brain.bubble?.text ?? "", shown: window.demo.scene().balloon.shown }));
  await page.screenshot({ path: `${out}/2-work-alert.png` });
  await js(() => (window.demo.scene().brain.bubble = undefined));
  await js(() => window.demo.scene().quick.toggle(Date.now()));
  await wait(600);
  await page.screenshot({ path: `${out}/2b-work-card.png` });
  await js(() => window.demo.scene().quick.close());
  await reset();
  // 2. Right-click card.
  await js(() => window.demo.scene().quick.toggle(Date.now()));
  await wait(600);
  res.card = await js(() => window.demo.scene().quick.open);
  await page.screenshot({ path: `${out}/3-card.png` });
  await js(() => window.demo.scene().quick.close());
  await reset();
  // 3. A window within a jump: it hops on.
  const win = await js(() => window.demo.openWindow({ x: 420, y: 420, w: 560, h: 200, title: "Заметки", app: "notepad.exe", body: "купить хлеб" }));
  await wait(1200);
  await js(() => {
    const s = window.demo.scene();
    const t = s.hopTarget();
    s.brain.wantHop = t ? { ...t, until: Date.now() + 12000 } : null;
  });
  for (let i = 0; i < 16 && !(await js(() => !!window.demo.scene().world.support)); i++) await wait(500);
  res.hop = await js(() => ({ support: window.demo.scene().world.support?.id ?? 0, y: Math.round(window.demo.scene().world.y) }));
  await page.screenshot({ path: `${out}/4-hop.png` });
  await js((id) => window.demo.closeWindow(id), win);
  await reset();
  await wait(1500);
  // 4. Offended, cursor hanging above its head: it must jump and hit.
  await js(() => {
    const s = window.demo.scene();
    s.brain.game = { ...s.brain.game, grudge: 80 };
    s.brain.threw(Date.now());
    s.brain.bubble = undefined;
    window.demo.cur.x = 700;
    window.demo.cur.y = 672 - 230;
  });
  const states = new Set();
  let hits = 0;
  for (let i = 0; i < 40; i++) {
    const st = await js(() => ({ play: window.demo.scene().play.state, hits: window.demo.scene().fx.hits?.length ?? 0 }));
    states.add(st.play);
    if (st.hits) hits++;
    if (i === 12) await page.screenshot({ path: `${out}/5-hunt.png` });
    await wait(250);
  }
  res.hunt = { states: [...states], hitFrames: hits, swats: await js(() => window.demo.scene().brain.life.counts.pounce ?? 0) };
  await reset();
  // 5. "I want to see too": walk to the click spot and do something there.
  await js(() => {
    const s = window.demo.scene();
    s.brain.wantGo = 1000;
    s.brain.wantInspect = { x: 1000, y: 650, until: Date.now() + 30000 };
  });
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const e = await js(() => window.demo.scene().brain.reaction?.event ?? "");
    if (e) seen.add(e);
    if (seen.has("inspect") || seen.has("inspectHit")) break;
    await wait(250);
  }
  res.inspect = [...seen];
  await page.screenshot({ path: `${out}/6-inspect.png` });
  console.log(JSON.stringify({ res, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
