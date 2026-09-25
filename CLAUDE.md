# Drizz Desktop

Desktop pet for Windows 10/11 x64: Tauri 1 (Rust) + React 18 + Phaser 3 (Canvas renderer). Russian and English (`settings.lang`). Russian lines swear on purpose — keep that tone, no slurs; English lines are written the same way and softened by `cleanEn` unless `settings.swear` is on.

## Commands
- `npx tsc --noEmit` — typecheck (run after every change)
- `npm test` — vitest, all of `src/*.test.ts` (~200 tests, 4 s; `soak.test.ts` simulates a day)
- `npx vitest run src/scenarios.test.ts` — behaviour scenarios (cursor games, memory, time, antics)
- `npm run build` — tsc + vite; required before any cargo command (`generate_context!` reads `dist/`)
- Rust on Linux: `cargo check --tests --target x86_64-pc-windows-gnu` in `src-tauri/` (needs `mingw-w64`, the target, and a local `src-tauri/icons/icon.png` converted from `icon.ico`; do not commit it). Real Windows is needed for `cargo test` / `npm run package`.
- Preview without Windows: `npm run dev` (port 1420), then `NODE_PATH=$(npm root -g) node tools/preview-scenes.cjs <dir>` (pet), `tools/preview-panel.cjs` (panel pages), `tools/preview-live.cjs` (real mouse: drag, throw, hunt). Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

## Where things live
- `director.ts` — reactions, rules (priority/cooldown/duration), mood, daily flags, memory hooks. `dialogue.ts` + `lines.ts` — phrase banks (`event`, `event@mood`, `event~stage`).
- `movement.ts` — physics, multi-monitor seams (`neighbor`/`span`), drag pendulum, climbing. `cursorplay.ts` — cursor games per temper. `antics.ts` — long behaviours (sulk, notes, gifts, hiding). `character.ts` — tempers.
- `game.ts` + `chronicle.ts` — progression and long-term memory (`Game.life`); `PetScene.ts` wires it all and renders (`pose.ts`, `effects.ts`, `balloon.ts`, `props.ts`).
- `src/panel/` — settings window (Radix Themes + Lucide), `pages/Welcome.tsx` first run, `pages/Ears.tsx` ear care. Rust: `main.rs` commands, `native.rs` Win32, `chores.rs` cursor nudge / temp / weather, `env.rs` sound (headphones, per-channel dB), `balance.rs` per-app balance in the mixer, `guard.rs` volume ceiling, `tap.rs` WASAPI loopback (real level for the dose, spike ducking, bands/beat as `audio-tap`) with pure `dsp.rs` (test it with `rustc --edition 2021 --test src-tauri/src/dsp.rs`). `music.ts` beat clock + `eq.ts` equalizer at the feet.
- `i18n.ts` + `i18n.en.ts` — `tx("русский текст", vars)` looked up by the Russian text; `lines.en.ts` — English banks; `swear.ts` — `cleanEn`. `ears.ts` — weekly sound dose per ear (WHO/ITU H.870), breaks, ear rest. `weather.ts` — WMO codes → sky and change lines; `places.ts` — countries; `credits.ts` — who made what (About page, pet pickers). `audio.ts` — the one sound bus (make-up gain + limiter) used by `sound.ts` and `voice.ts`; `balance.rs` also names the pet's sessions "Drizz Desktop" in the Windows mixer and heals apps it left lopsided. `docs/RELEASE.md` — release checklist.

## Rules that are easy to break
- The pet window owns game state; the panel only sends ids/commands (`buy_item`, `emitAll("pet-command")`). Pet-owned memory keys are whitelisted in `save_pet_memory`.
- Coordinates: desktop/physics in physical px, canvas in logical px (`dpr`). Anything drawn must also be added to the window region rects, or Win32 clips it.
- Phaser runs in Canvas mode: no tint, no shaders.
- JS `\b` is ASCII-only — never use it after Cyrillic words (see `commands.ts`).
- New lines must not use variables the event does not pass (`linevars.test.ts` checks every call site; `Dialogue.choose` skips a line whose variable is missing). Money goes in as `money(n)`, never "{n} ₽" / "${n}" in the text.
- News the user must not miss (pay, level, achievement, ear care, weather change) is in `MUST_SAY` (director.ts): if the balloon is busy it waits in `pending` instead of being lost. `event()` returning true does not mean a line was shown.
- Every new phrase bank needs an English twin in `lines.en.ts` with the same variables; every new UI string goes through `tx()` with an entry in `i18n.en.ts` (`i18n.test.ts`, `ears.test.ts` check both). Never call `tx()` at module level — the language is set later; translate data tables at display time (`tx(item.name)`).
- Every new timer-driven behaviour goes through `Director.heartbeat` or `Antics.later`, not per-frame `setTimeout`.

## Compaction
When compacting, keep: the list of modified files, failing test names, and the exact verification commands.
