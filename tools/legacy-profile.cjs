// Writes a "previous version" settings profile for upgrade testing:
// position on a monitor that no longer exists, preferred monitor id that is
// gone, no `diagnostics` key, explicit facts and a token that must survive.
// Usage: node tools/legacy-profile.cjs <profileDir>
const fs = require("node:fs");
const path = require("node:path");
const dir = path.join(process.argv[2], "DrizzDesktop");
fs.mkdirSync(dir, { recursive: true });
const state = {
  settings: {
    pet: "nezukocoder",
    mode: "normal",
    size: 140,
    activity: "active",
    walk: true,
    perch: true,
    pinned: false,
    monitor: "\\\\.\\DISPLAY9",
    comments: true,
    commentMinutes: 5,
  },
  memory: {
    address: "Тест",
    facts: ["люблю кооперативные игры"],
    recent: ["Я рядом, сука. Обустраиваюсь."],
    lastGreeting: "2026-09-20",
    favorite: null,
    position: { x: 9000, y: -5000 },
  },
  token: "old-token-keep-me",
  hasKey: false,
};
fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
console.log("legacy profile written to", dir);
