// Headless preview runs (no Windows needed): opens the pet page in Chromium,
// drives the director through scenarios via window.__PET_SCENE__ and saves a
// screenshot of each. Usage: node tools/preview-scenes.cjs [outDir] [baseUrl]
// Needs Playwright in NODE_PATH and a running `npm run dev`.
const { chromium } = require("playwright");
const out = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:1420/";
const scenarios = [
  ["idle", "() => {}"],
  ["click", "(s) => { s.brain.click(Date.now()); }"],
  ["mumble", "(s) => { s.brain.reset('mumble'); s.brain.event('mumble', Date.now(), true); s.brain.bubble.kind = 'mumble'; }"],
  ["sign", "(s) => { s.brain.reset('remember'); s.brain.remember(Date.now()); }"],
  ["dizzy", "(s) => { s.fx.starsUntil = Date.now() + 5000; s.force('dizzy', 5000); s.brain.reset('dizzy'); s.brain.event('dizzy', Date.now(), true); }"],
  ["hungry", "(s) => { s.brain.game = { ...s.brain.game, food: 10 }; s.brain.reset('hungry'); s.brain['needs']('hungry', Date.now()); }"],
  ["swat", "(s) => { s.force('swat', 3000); s.brain.reset('cursorSwat'); s.brain.event('cursorSwat', Date.now(), true); }"],
  ["lecture", "(s) => { s.store.settings.pet = 'claude'; s.changePet(); s.force('judge', 4000); s.brain.reset('cursorLecture'); s.brain.event('cursorLecture', Date.now(), true); }"],
  ["gift", "(s) => { s.brain.game.likability = 1000; s.antics['bringGift'](s.host()); }"],
  ["wear", "(s) => { s.brain.life.wear = 'crown'; s.force('dance', 4000); }"],
  ["party", "(s) => { s.brain.life.wear = 'party'; s.snapshot = { media: { playing: true } }; s.force('dance', 4000); }"],
  ["note", "(s) => { s.antics.away = null; s.props.drop('note', s.world.x + 60, s.world.y, Date.now(), 'Ушёл за пивом.'); }"],
  ["game", "(s) => { s.startGame('rps'); }"],
  ["sulk", "(s) => { s.brain.sulkUntil = Date.now() + 60000; s.brain.reset('sulk'); s.brain.event('sulk', Date.now(), true); }"],
];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 360, height: 340 }, deviceScaleFactor: 1.25 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => window.__PET_SCENE__ && window.__PET_SCENE__.ready, null, { timeout: 15000 });
  await page.evaluate(() => { const s = window.__PET_SCENE__; s.hideCard && s.hideCard(); s.brain.bubble = undefined; });
  for (const [name, fn] of scenarios) {
    await page.evaluate(`(${fn})(window.__PET_SCENE__)`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.evaluate(() => { const s = window.__PET_SCENE__; s.brain.bubble = undefined; s.brain.reaction = undefined; s.forced = null; });
  }
  console.log(JSON.stringify({ errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
