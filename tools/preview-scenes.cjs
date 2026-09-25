// Headless preview runs (no Windows needed): opens the pet page in Chromium,
// drives the director through scenarios via window.__PET_SCENE__ and saves a
// screenshot of each. Usage: node tools/preview-scenes.cjs [outDir] [baseUrl]
// Needs Playwright in NODE_PATH and a running `npm run dev`.
const { chromium } = require("playwright");
const out = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:1420/";
// Each entry: [name, setup run in the page, ms to wait before the shot].
const drag = (dx, shake) => `async (s) => {
  const x0 = s.world.x, y0 = s.world.y - 40;
  s.onMotion({ x: x0, y: y0, down: true, support: null });
  s.world.begin(x0, y0, Date.now());
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 33));
    const x = ${shake} ? x0 + (i % 2 ? 70 : -70) : x0 + i * ${dx};
    s.onMotion({ x, y: y0 - i * 3, down: true, support: null });
  }
}`;
// Music from the audio tap: bands and a 120 BPM beat, ~12 messages a second.
const feed = (edge) => `(s) => {
  s.store.settings.musicViz = true;
  ${edge} && (s.world.support = { id: 1, rect: { left: s.world.x - 140, top: s.world.y, right: s.world.x + 50, bottom: s.world.y + 300 } });
  const t0 = Date.now();
  clearInterval(window.__feed);
  window.__feed = setInterval(() => {
    const t = Date.now() - t0;
    const k = Math.max(0, 1 - (t % 500) / 350);
    s.groove.feed({ bands: [0.95 * k + 0.1, 0.8 * k + 0.1, 0.55, 0.62, 0.48, 0.4, 0.3, 0.22].map((v, i) => Math.min(1, v * (0.85 + 0.15 * Math.sin(t / 90 + i)))), level: -14, bpm: 120, period: 500, beat: t % 500, confidence: 0.7 }, Date.now());
  }, 80);
}`;
const scenarios = [
  ["01-idle", "() => {}", 600],
  ["02-click-status", "(s) => { s.brain.click(Date.now()); }", 700],
  ["03-drag-swing", drag(18, false), 60],
  ["04-shaken", drag(0, true), 60],
  ["05-dizzy", "(s) => { s.fx.starsUntil = Date.now() + 5000; s.force('dizzy', 5000); s.brain.reset('dizzy'); s.brain.event('dizzy', Date.now(), true); }", 700],
  ["06-mumble", "(s) => { s.brain.reset('mumble'); s.brain.event('mumble', Date.now(), true); s.brain.bubble.kind = 'mumble'; }", 700],
  ["07-remember-sign", "(s) => { s.brain.reset('remember'); s.brain.remember(Date.now()); }", 700],
  ["08-hungry-buttons", "(s) => { s.brain.game = { ...s.brain.game, food: 10 }; s.brain.dialogue.last = -Infinity; s.brain.reset('hungry'); s.brain['needs']('hungry', Date.now()); }", 700],
  ["09-swat", "(s) => { s.force('swat', 3000); s.brain.reset('cursorSwat'); s.brain.event('cursorSwat', Date.now(), true); }", 200],
  ["10-claude-lecture", "(s) => { s.store.settings.pet = 'claude'; s.changePet(); s.force('judge', 4000); s.brain.reset('cursorLecture'); s.brain.event('cursorLecture', Date.now(), true); }", 700],
  ["11-sulk", "(s) => { s.brain.sulkUntil = Date.now() + 60000; s.brain.reset('sulk'); s.brain.event('sulk', Date.now(), true); }", 700],
  ["12-gift", "(s) => { s.brain.game.likability = 1000; s.antics['bringGift'](s.host()); }", 700],
  ["13-crown-dance", "(s) => { s.brain.life.wear = 'crown'; s.force('dance', 4000); }", 500],
  ["14-music-party", "(s) => { s.brain.life.wear = 'party'; s.snapshot = { ...(s.snapshot || {}), windows: [], media: { playing: true } }; s.force('dance', 4000); }", 500],
  ["15-note", "(s) => { s.props.drop('note', s.world.x - 120, s.world.y, Date.now(), 'Ушёл за пивом.'); }", 500],
  ["16-rps", "(s) => { s.startGame('rps'); }", 700],
  ["17-eat", "(s) => { s.buy('pizza'); }", 600],
  ["18-nezuko-rain", "(s) => { s.store.settings.pet = 'nezukocoder'; s.changePet(); s.weather = { kind: 'rain', at: Date.now() }; }", 600],
  ["19-eigenblob-miss", "(s) => { s.store.settings.pet = 'eigenblob'; s.changePet(); s.force('pained', 3000); s.brain.reset('cursorMiss'); s.brain.event('cursorMiss', Date.now(), true); }", 600],
  ["20-aqua-sigh", "(s) => { s.store.settings.pet = 'aqua-wisp'; s.changePet(); s.force('sigh', 3000); s.brain.reset('cursorLazy'); s.brain.event('cursorLazy', Date.now(), true); }", 600],
  ["21-equalizer", feed(false), 900],
  ["22-equalizer-window-edge", feed(true), 900],
  ["23-focus", "(s) => { s.brain.startFocus(Date.now() - 9 * 60000); }", 900],
  ["24-focus-break", "(s) => { s.brain.startFocus(Date.now() - 26 * 60000); s.brain.focus.until = Date.now() - 1; s.heartbeat(); }", 900],
];
const reset = `(s) => {
  if (s.world.dragging) s.world.release(Date.now());
  s.brain.bubble = undefined; s.brain.reaction = undefined; s.forced = null; s.brain.sulkUntil = 0;
  clearInterval(window.__feed); s.world.support = null; s.groove.shown = 0; s.groove.bars.fill(0); s.brain.focus = { phase: '', until: 0, round: 0, since: 0 };
  s.brain.life.wear = ''; s.weather = null; if (s.snapshot) s.snapshot = { ...s.snapshot, media: { playing: false } }; s.fx.starsUntil = 0; s.antics.carry = '';
  for (const it of [...s.props.items]) s.props.remove(it.id);
  if (s.store.settings.pet !== 'drizz') { s.store.settings.pet = 'drizz'; s.changePet(); }
  s.world.x = 640; s.world.y = 720; s.world.air = false; s.world.swing = 0; s.world.vx = s.world.vy = 0; s.world.target = null;
}`;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 360, height: 340 }, deviceScaleFactor: 1.25 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base);
  await page.waitForFunction(() => window.__PET_SCENE__ && window.__PET_SCENE__.ready, null, { timeout: 15000 });
  await page.evaluate(() => { const s = window.__PET_SCENE__; s.hideCard && s.hideCard(); s.brain.bubble = undefined; });
  for (const [name, fn, wait] of scenarios) {
    await page.evaluate(`(${reset})(window.__PET_SCENE__)`);
    await page.waitForTimeout(250);
    await page.evaluate(`(${fn})(window.__PET_SCENE__)`);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  console.log(JSON.stringify({ errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
