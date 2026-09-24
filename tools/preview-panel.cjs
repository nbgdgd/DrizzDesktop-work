// Screenshots of every panel page in the browser preview (no Windows).
// Usage: node tools/preview-panel.cjs [outDir] [baseUrl]   (needs `npm run dev`)
const { chromium } = require("playwright");
const out = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:1420/";
const tabs = ["status", "shop", "games", "collection", "skills", "work", "chat", "memory", "stats", "trace", "settings", "privacy"];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  for (const tab of tabs) {
    await page.goto(`${base}?panel=${tab}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/panel-${tab}.png` });
  }
  console.log(JSON.stringify({ errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
