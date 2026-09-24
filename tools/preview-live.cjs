// Live preview run with a real mouse in Chromium: drag and throw the pet,
// then let it hunt the cursor. Prints what happened and saves frames.
// Usage: node tools/preview-live.cjs [outDir] [baseUrl]   (needs `npm run dev`)
const { chromium } = require("playwright");
const out = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:1420/";
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 360, height: 340 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => window.__PET_SCENE__ && window.__PET_SCENE__.ready, null, { timeout: 15000 });
  const state = () =>
    page.evaluate(() => {
      const s = window.__PET_SCENE__;
      return {
        action: s.lastAction,
        reaction: s.brain.reaction?.event ?? "",
        text: s.brain.bubble?.text ?? "",
        play: s.play.state,
        x: Math.round(s.world.x),
        y: Math.round(s.world.y),
        swing: +s.world.swing.toFixed(2),
        grudge: Math.round(s.brain.game.grudge),
        throws: s.brain.life.counts.throw ?? 0,
      };
    });
  await page.evaluate(() => {
    const s = window.__PET_SCENE__;
    s.hideCard();
    s.brain.bubble = undefined;
  });
  await page.waitForTimeout(500);
  // Where the pet is on the canvas.
  const at = await page.evaluate(() => {
    const p = window.__PET_SCENE__.debugPlacement;
    return { x: p.x, y: p.y - 30 };
  });
  const log = [];
  // 1. Pick it up, swing it left and right, throw it up and to the left.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(at.x - i * 12, at.y - i * 8, { steps: 2 });
    await page.waitForTimeout(30);
  }
  log.push(["held", await state()]);
  await page.screenshot({ path: `${out}/live-1-held.png` });
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(at.x - 120 + (i % 2 ? 60 : -60), at.y - 80, { steps: 1 });
    await page.waitForTimeout(30);
  }
  log.push(["shaken", await state()]);
  await page.screenshot({ path: `${out}/live-2-shaken.png` });
  await page.mouse.move(at.x - 40, at.y - 150, { steps: 1 });
  await page.waitForTimeout(16);
  await page.mouse.up();
  await page.waitForTimeout(3500);
  log.push(["after throw", await state()]);
  await page.screenshot({ path: `${out}/live-3-landed.png` });
  await page.waitForTimeout(3000);
  log.push(["stare/sign", await state()]);
  await page.screenshot({ path: `${out}/live-4-sign.png` });
  // 2. Offended: the cursor sits on the floor to the right; it comes for it.
  await page.evaluate(() => {
    const s = window.__PET_SCENE__;
    s.brain.game = { ...s.brain.game, grudge: 80 };
    s.brain.threw(Date.now());
    s.brain.bubble = undefined;
    s.brain.reaction = undefined;
    s.world.x = 450;
    s.world.y = 720;
  });
  await page.waitForTimeout(300);
  const floor = await page.evaluate(() => window.__PET_SCENE__.debugPlacement);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(Math.min(350, floor.x + 110), floor.y - 12);
    await page.waitForTimeout(100);
    const st = await state();
    seen.add(st.play + "/" + st.reaction);
    if (i === 30) await page.screenshot({ path: `${out}/live-5-hunt.png` });
  }
  log.push(["hunt states", [...seen].join(" ")]);
  console.log(JSON.stringify({ log, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
