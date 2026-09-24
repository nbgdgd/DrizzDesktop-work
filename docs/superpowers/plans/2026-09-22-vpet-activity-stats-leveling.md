# VPet-style Activity, Usage Stats and Leveling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pet react to global mouse/keyboard input, wander and talk far more often, record per-app foreground time, and add a VPet-style progression (exp/level/mood/stamina/food/drink/likability/money + shop).

**Architecture:** Rust (`native.rs`) installs low-level hooks that only bump atomic counters; `observe.rs` ships the counters plus today's top apps in the 1 s `snapshot`; a new `usage.rs` accumulates per-app seconds to `usage.json`. In the WebView, `Director` derives input events from counter deltas, a new pure `game.ts` module holds the VPet formulas and per-minute tick, `PetScene` drives the tick and owns the persisted `game` state, and `SettingsPanel` gets three tabs (Статистика / Статус / Магазин) that read the store and send `buy` requests to the pet through a Tauri command + event.

**Tech Stack:** Tauri 1.8, Rust `windows-sys 0.59`, React 18, Phaser 3.90, Vitest 3.

## Global Constraints

- Project has no git; "commit" steps are replaced by running `npm test` and `npm run build` (tsc + vite) and `cargo check` in `src-tauri`.
- `cargo` is not on PATH in Git Bash: `export PATH="$HOME/.cargo/bin:$PATH"`.
- Keyboard hook stores **no** virtual-key codes; only counts of `WM_KEYDOWN`.
- Phrase style for Drizz: rude, profanity allowed (project rule "Мат не цензурируется"). Gentle pets (`claude`, `aqua-wisp`) keep the `gentle` bank fallback.
- Food icons come from `LorisYounger/VPet` `VPet-Simulator.Windows/mod/0000_core/image/food/`; attribution + link `https://github.com/LorisYounger/VPet` in `THIRD_PARTY.md` and on the Shop tab.
- All user-facing text in Russian.

## File map

| File | Responsibility |
|---|---|
| `src-tauri/src/native.rs` | + `input_counters()`, LL hooks installed in `hook_thread` |
| `src-tauri/src/usage.rs` (new) | per-app seconds, `usage.json`, `stats()` aggregation, 90-day trim |
| `src-tauri/src/observe.rs` | snapshot gains `input` and `usage` |
| `src-tauri/src/storage.rs` | `Store.game: Value` |
| `src-tauri/src/main.rs` | commands `save_game`, `buy_item`, `usage_stats`, `usage_clear`; `usage::flush` on exit |
| `src/model.ts` | `Snapshot.input/usage`, `Settings.observeInput/trackUsage`, `Store.game`, `Game` type, `cleanGame` |
| `src/game.ts` (new) | VPet formulas, `tick`, `eat`, `mode`, shop catalogue |
| `src/apps.ts` (new) | exe → friendly name, `formatDuration` |
| `src/dialogue.ts` | banks: expanded + new; `ambient` set; gating change |
| `src/director.ts` | input events, `chatter`, `stats`, `statsDay`, need events, `levelUp`, game hooks |
| `src/PetScene.ts` | faster wander, chatter timer, game tick + save, `buy` listener |
| `src/SettingsPanel.tsx` | tabs Статистика / Статус / Магазин; privacy toggles |
| `src/style.css` | bars, shop grid |
| `public/shop/*.png` | VPet food icons |
| `THIRD_PARTY.md`, `README.md` | attribution, feature notes |
| tests: `src/game.test.ts`, `src/behavior.test.ts`, `src/apps.test.ts`, Rust unit tests in `usage.rs` |

---

### Task 1: Global input counters (Rust)

**Files:** Modify `src-tauri/src/native.rs`, `src-tauri/src/observe.rs`, `src-tauri/Cargo.toml` (no new feature needed: `Win32_UI_WindowsAndMessaging` already covers `SetWindowsHookExW`).

**Produces:**
```rust
#[derive(Clone, Serialize, Default)]
pub struct Input { pub clicks: u64, pub right_clicks: u64, pub wheel: u64, pub keys: u64, pub last_click: Option<(i32, i32, u64)> }
pub fn input_counters() -> Input;            // native.rs
pub static INPUT_ENABLED: AtomicBool;        // set from observe loop = settings.observeInput
```
Snapshot JSON: `input: { clicks, rightClicks, wheel, keys, lastClick: { x, y, t } | null }` (serde `rename_all = "camelCase"` on Input, `last_click` as struct `{x,y,t}`).

Steps:
- [ ] Add statics `CLICKS, RIGHT, WHEEL, KEYS: AtomicU64`, `LAST_X, LAST_Y: AtomicI32`, `LAST_T: AtomicU64`, `INPUT_ENABLED: AtomicBool(true)`, `OWN_PID: AtomicU32`.
- [ ] `unsafe extern "system" fn mouse_hook(code, wparam, lparam) -> LRESULT`: if `code >= 0 && INPUT_ENABLED`: on `WM_LBUTTONDOWN`/`WM_RBUTTONDOWN` read `MSLLHOOKSTRUCT.pt`, skip when `WindowFromPoint(pt)` belongs to `OWN_PID` (`GetWindowThreadProcessId`); bump counters, store point + `GetTickCount64()`. `WM_MOUSEWHEEL` → `WHEEL += 1`. Always `CallNextHookEx`.
- [ ] `keyboard_hook`: `WM_KEYDOWN`/`WM_SYSKEYDOWN` → `KEYS += 1`. No vkCode read.
- [ ] In `hook_thread` after WinEvent hooks: `SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), GetModuleHandleW(null()), 0)` and same for `WH_KEYBOARD_LL`; log `input hooks: mouse ok/failed keyboard ok/failed` to diag; `UnhookWindowsHookEx` at loop end.
- [ ] `observe.rs`: set `INPUT_ENABLED` from `enabled(&s,"observeInput",true)` each snapshot; add `input: native::input_counters()` to `Snapshot`.
- [ ] `cargo check` passes.

### Task 2: Usage accumulator (Rust)

**Files:** Create `src-tauri/src/usage.rs`; modify `observe.rs`, `main.rs`, `storage.rs`.

**Produces:**
```rust
pub struct Usage { days: BTreeMap<String, BTreeMap<String, u64>>, dirty: bool, last_flush: Instant }
pub static USAGE: Mutex<Option<Usage>>;
pub fn record(app: &str, seconds: u64, today: &str);   // called from observe loop
pub fn flush();                                          // write usage.json if dirty
pub fn today_top(n: usize) -> Vec<Entry>;                // Entry { app: String, seconds: u64 }
pub fn stats() -> Stats;  // Stats { today, week, month, all: Vec<Entry> } sorted desc
pub fn clear();
```
Commands in `main.rs`: `usage_stats() -> usage::Stats`, `usage_clear()`.

Steps:
- [ ] Test (Rust `#[cfg(test)]`): `record` twice sums; `trim` drops dates older than 90 days; `parse` of `b"{bad"` returns empty map.
- [ ] Implement load (rename bad file to `usage.bad.json`), `record`, `flush` (every 60 s or when forced), `trim`, `stats` (week = last 7 dates incl. today, month = 30, all = everything).
- [ ] `observe.rs`: when `enabled(&s,"trackUsage",true) && idle < 60_000 && !locked && !app.is_empty()` → `usage::record(&fg.app, elapsed_secs, &today)`; `elapsed_secs` = whole seconds since last record (cap 5). Add `usage: usage::today_top(5)` to Snapshot as `{ today: [...] }`.
- [ ] `main.rs`: register commands; call `usage::flush()` in `RunEvent::Exit`.
- [ ] `cargo test` and `cargo check` pass.

### Task 3: Store gains `game`

**Files:** `storage.rs` (`Store.game: Value` with `#[serde(default)]`, parse_store field("game")), `main.rs` (`save_game(window, app, state, game: Value)` restricted to `pet` window, emits `store`; `buy_item(app, id: String)` emits `buy` with the id to the `pet` window), `bridge.ts` preview fallbacks for `save_game`, `usage_stats` (`{today:[],week:[],month:[],all:[]}`), `buy_item` (dispatch `buy` CustomEvent).

- [ ] `cargo check`, `npm run build`.

### Task 4: `game.ts` — VPet formulas

**Files:** Create `src/game.ts`, `src/game.test.ts`; modify `src/model.ts` (types + `cleanGame` + `Store.game`).

**Produces:**
```ts
export interface Game { exp:number; money:number; strength:number; food:number; drink:number; feeling:number; health:number; likability:number; storeStrength:number; storeFood:number; storeDrink:number; lastTick:number }
export const newGame = (now:number): Game
export const level = (exp:number) => exp < 0 ? 1 : Math.floor(Math.sqrt(exp)/10)+1
export const levelUpNeed = (lvl:number) => (lvl*10)**2
export const likabilityMax = (lvl:number) => 90 + lvl*10
export type Mode = "happy"|"normal"|"poor"|"ill"
export function mode(g:Game): Mode              // VPet CalMode
export interface TickEnv { present:boolean; resting:boolean; music:boolean }
export function tick(g:Game, minutes:number, env:TickEnv): Game   // pure, minutes ≤ 480
export function interact(g:Game, kind:"click"|"poke"|"drag"|"summon"|"win"): Game
export interface Item { id:string; name:string; kind:"drink"|"snack"|"meal"|"functional"|"drug"; price:number; exp:number; strength:number; food:number; drink:number; health:number; feeling:number; icon:string; desc:string }
export const items: Item[]                      // ~24 ported from VPet food.lps
export function eat(g:Game, item:Item): Game | null   // null when money < price
```
`cleanGame(raw)` in model.ts: numbers clamped (`strength/food/drink/feeling/health` 0..100, `likability` 0..likabilityMax, `money ≥ 0`, `exp ≥ 0`), missing → `newGame(Date.now())`.

Tests: level(0)=1, level(100)=2, level(400)=3; tick 1 min present feeling 60 → exp+1, feeling 59.85, food 99.6, drink 99.4, strength 99.7, money +1.65 (level 1); feeling 80 → exp +3 health +1; feeling 95 → likability +1; absent → no exp/money, decay ×0.25; resting → strength +2; food 0 → health −1; storeTake moves 1/10; `eat` deducts price, applies half, stores half; `eat` returns null when broke; `mode` cases; `cleanGame({})` valid.

- [ ] Write tests → fail → implement → pass.

### Task 5: `apps.ts` friendly names + duration

**Files:** Create `src/apps.ts`, `src/apps.test.ts`.
```ts
export function appName(exe:string): string     // "chrome.exe" → "Chrome", unknown "foo.exe" → "foo"
export function formatDuration(seconds:number): string  // 45 → "меньше минуты", 2400 → "40 мин", 8100 → "2 ч 15 мин"
```
~30 entries: chrome, msedge, firefox, opera, brave, code, devenv, idea64, rider64, godot, blender, discord, telegram, explorer, steam, vlc, mpv, potplayer, aniblaze, spotify, obs64, photoshop, figma, notepad, notepad++, cmd, powershell, windowsterminal, excel, winword, wallpaper32, claude.

- [ ] Tests → implement → pass.

### Task 6: Dialogue banks + gating

**Files:** `src/dialogue.ts`, `src/behavior.test.ts`.

- [ ] Add `export const ambient = new Set(["chatter","idle","night","long","cursor","stats","statsDay","hungry","thirsty","tired","sad","happy","sick"])`.
- [ ] `Dialogue.choose`: keep `comments`/`dnd`/`quiet` checks; the `commentMinutes` gate applies only when `ambient.has(event)`; non-ambient non-direct events use a 20 s anti-spam (`now - this.last < 20000`).
- [ ] Support `{app}`/`{time}` templating: `choose(event, s, now, direct=false, vars?: Record<string,string>)` replaces placeholders.
- [ ] Extend every existing bank by 4–8 lines; add banks: `typing`, `typingLong`, `afterBurst`, `clicking`, `scrolling`, `rightClick`, `curious`, `chatter` (≥ 60), `stats`, `statsDay`, `levelUp` (with `{level}`), `hungry`, `thirsty`, `tired`, `sad`, `happy`, `sick`, `fed` (with `{item}`), `broke`. Gentle bank gets 2 lines each for `chatter`, `typing`, `stats`, `levelUp`, `fed`.
- [ ] `defaults.commentMinutes` 7 → 3 in model.ts.
- [ ] Tests: ambient event blocked within commentMinutes; `typing` allowed 30 s after another phrase; template substitution.

### Task 7: Director — input, chatter, stats, needs, level

**Files:** `src/director.ts`, `src/behavior.test.ts`.

**Consumes:** `Snapshot.input`, `Snapshot.usage`, `Game` from `game.ts`.

- [ ] Rules: `typing look 40 240000`, `typingLong look 40 900000`, `afterBurst wave 35 360000`, `clicking look 40 180000`, `scrolling look 35 240000`, `rightClick look 30 300000`, `glance look 10 8000 1200`, `curious look 45 120000 2500`, `chatter idle 15 60000 2500`, `stats look 30 3600000`, `statsDay wave 40 43200000`, `levelUp celebrate 85 5000 2600`, `hungry rest 40 1200000`, `thirsty rest 40 1200000`, `tired rest 35 1200000`, `sad rest 35 1800000`, `happy jump 25 1800000`, `sick rest 50 1800000`, `fed wave 90 1000`, `broke look 90 1000`.
- [ ] `observe(n)`: keep `prevInput`; deltas → sliding arrays `keyTimes`, `clickTimes`, `wheelTimes` (push `now` per unit delta, capped 200); windows per spec. `typingLong`: `typingSince` set when keys/10 s ≥ 10, cleared when 20 s without keys; fire at 3 min. `afterBurst`: burst flagged when `typing` fired; after 45 s no keys, 30 % chance. `rightClick` 15 %. `glance` 25 % on any new click. `curious`: `lastClick` newer than previous and distance from pet (`this.petX/petY`, set by scene via `brain.position(x,y)`) > 900 px → 20 % → set `this.wantGo = x` (scene consumes).
- [ ] `stats`: `nextStats` = now + 90–150 min; fire with vars `{app: appName(top.app), time: formatDuration(top.seconds)}` when `usage.today[0].seconds ≥ 900`. `statsDay`: hour ≥ 21 and not yet today.
- [ ] `chatter`: `nextChatter` = now + commentMinutes×60000×(0.6–1.3), only when `idle < 120000` and not hidden.
- [ ] Game hooks: `game: Game` field, `syncGame(g)`; `click()` → `interact("click")` (max 3/min), poke → `poke`, drag → `drag`, summon → `summon`, integration success kinds → `win`; `applyTick(now, env)` runs `tick` for whole minutes since `lastTick` (cap 480), detects level change → `levelUp` with `{level}`; need events by thresholds; returns `changed` boolean.
- [ ] Mode effects: `wanderFactor()` → ill/poor 2, happy 0.7, else 1; `strength < 20` → base becomes `rest`.
- [ ] Tests for each event with a fake snapshot sequence.

### Task 8: PetScene — wander, chatter, game tick, buy

**Files:** `src/PetScene.ts`.

- [ ] Wander wait: calm 25000 / balanced 9000 / active 4000; `× wanderFactor × max(0.6, 1/(1+0.03×level))`; distance ±450; walk probability `r > 0.55 − curiosity×0.3`; idle actions: `r<0.4 look`, `<0.6 sit`, `<0.75 rest`, `<0.85 jump`, else `celebrate` if feeling ≥ 75 else `look`. Add `"jump"|"celebrate"` to `idleAction` type; jump triggers `world.jump()`.
- [ ] Consume `brain.wantGo` → `world.go(x)`, reset.
- [ ] Every frame: `brain.position(world.x, world.y)`; call `brain.chatter(now)`; once per 60 s call `brain.applyTick(now, {present: idle<300000, resting: action∈{sleep,rest}, music})`; when it returns true → `command("save_game",{game})` (throttled 60 s, forced on level change).
- [ ] `subscribe("buy", id)` → `eat(game, item)`; null → `brain.event("broke", now, true)`; else set game, `fed` event with `{item}`, save.
- [ ] Load `store.game` via `cleanGame` in `bootPet` and on `store` events (only if `lastTick` newer than local — pet is owner, so ignore incoming `game` except at boot).

### Task 9: Shop assets + attribution

**Files:** `public/shop/*.png`, `THIRD_PARTY.md`, `README.md`.

- [ ] Download 24 icons matching `items[].icon` from `https://raw.githubusercontent.com/LorisYounger/VPet/main/VPet-Simulator.Windows/mod/0000_core/image/food/<name>.png` into `public/shop/`.
- [ ] `THIRD_PARTY.md`: section «Иконки магазина — VPet (LorisYounger), Apache-2.0, условия использования графики: некоммерческое использование с указанием источника, https://github.com/LorisYounger/VPet».
- [ ] README: short section on new tabs, input hooks (counts only), `usage.json` location, `observeInput`/`trackUsage`.

### Task 10: Settings panel tabs

**Files:** `src/SettingsPanel.tsx`, `src/style.css`, `src/model.ts` (settings fields).

- [ ] Privacy tab: toggles `observeInput` («Клики и печать в других программах — только счётчики, без клавиш») and `trackUsage` («Учёт времени по программам»).
- [ ] Tab «Статистика»: period buttons today/7d/30d/all, `command("usage_stats")` on open and every 30 s; rows with `appName`, `formatDuration`, bar width = share; «Очистить» → `usage_clear`.
- [ ] Tab «Статус»: level + exp bar (`exp − (level−1)²×100` of `levelUpNeed − (level−1)²×100`… use `expIntoLevel = exp − ((level−1)*10)**2`, `expForLevel = (level*10)**2 − ((level−1)*10)**2`), money, bars feeling/strength/food/drink/likability (max likabilityMax), mode label («Счастлив» / «Обычный» / «Не в духе» / «Болеет»).
- [ ] Tab «Магазин»: grid of `items` with icon, name, price, short effect line; button «Купить» → `command("buy_item",{id})`; disabled when money < price. Footer attribution link.
- [ ] `npm run build` clean.

### Task 11: Verification

- [ ] `npm test` all green; `npm run build`; `cd src-tauri && cargo test && cargo check`.
- [ ] `npm run package`; run the EXE with `--diag`; click in a browser, type a burst, scroll; confirm `diagnostic.log` shows `input hooks: mouse ok keyboard ok` and `state` lines with `typing`/`clicking`; open panel tabs.
- [ ] Zip fixed sources to `DrizzDesktop-work\DrizzDesktop-source-0.1.0-2026-09-22-vpet.zip` (exclude `node_modules`, `src-tauri/target`, `dist`).
