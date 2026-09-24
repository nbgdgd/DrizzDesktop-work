import { command, native } from "./bridge";
// Opt-in diagnostics: one line per *change* of a keyed value, never per frame.
// Written to %LOCALAPPDATA%\DrizzDesktop\diagnostic.log by the Rust side when
// the "diagnostics" setting or the --diag flag is on; console.info in preview.
export class Diag {
  enabled = false;
  private last = new Map<string, string>();
  private time = new Map<string, number>();
  async refresh() {
    try {
      this.enabled = native
        ? await command<boolean>("diag_enabled")
        : new URLSearchParams(location.search).has("diag");
    } catch {
      this.enabled = false;
    }
  }
  log(key: string, message: string, minIntervalMs = 0) {
    if (!this.enabled) return;
    const now = Date.now();
    if (this.last.get(key) === message) return;
    if (minIntervalMs && now - (this.time.get(key) ?? 0) < minIntervalMs)
      return;
    this.last.set(key, message);
    this.time.set(key, now);
    const line = `${key}: ${message}`;
    if (native) void command("diag_log", { line }).catch(() => {});
    else console.info("[diag]", line);
  }
}
