import { invoke } from "@tauri-apps/api/tauri";
import { emit, listen } from "@tauri-apps/api/event";
import { defaults, emptyMemory, Store } from "./model";
import { newGame } from "./game";
export const native = !!(window as unknown as { __TAURI_IPC__?: unknown })
  .__TAURI_IPC__;
/**
 * Demo desktop (tools/demo/desktop.html): the pet page runs in an iframe and
 * the host page plays the part of Windows - it moves the overlay, owns a
 * drawn cursor and a few fake windows. Only used for promo recordings.
 */
type DemoHost = ((cmd: string, args: Record<string, unknown>) => unknown) & {
  monitors?: unknown;
};
export const demoHost: DemoHost | undefined = (() => {
  try {
    return !native && window.parent !== window
      ? ((window.parent as unknown as { demoHost?: DemoHost }).demoHost ?? undefined)
      : undefined;
  } catch {
    return undefined;
  }
})();
export const demo = !!demoHost;
const previewStore = (): Store => {
  try {
    return (
      JSON.parse(localStorage.getItem("drizz-preview") || "null") || {
        settings: defaults,
        memory: emptyMemory,
        game: newGame(Date.now()),
        token: "Preview only",
        hasKey: false,
      }
    );
  } catch {
    return {
      settings: defaults,
      memory: emptyMemory,
      game: newGame(Date.now()),
      token: "Preview only",
      hasKey: false,
    };
  }
};
export async function command<T = void>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (native) return invoke<T>(cmd, args);
  if (demoHost && ["pose", "nudge_cursor", "window_act", "autorun_remove", "autorun_keep", "set_balance", "set_volume"].includes(cmd))
    return demoHost(cmd, args) as T;
  if (cmd === "load_store") return previewStore() as T;
  if (cmd === "usage_stats")
    return { today: [], week: [], month: [], all: [] } as T;
  if (cmd === "temp_scan") return { bytes: 734003200, files: 5120 } as T;
  if (cmd === "temp_clean") return { bytes: 681574400, files: 4870 } as T;
  if (cmd === "weather") return null as T;
  if (cmd === "weather_search")
    return [{ name: String(args.query), region: "Preview", country: "-", lat: 55.789, lon: 49.122 }] as T;
  if (cmd === "trace_view")
    return {
      events: [],
      load: { cpu: 12, gpu: 4, cpuBase: 9, gpuBase: 3, gpuAvailable: true, gpuTop: null },
      enabled: true,
    } as T;
  if (cmd === "autorun_view") return { entries: [], quarantine: [], pending: [] } as T;
  if (cmd === "monitors") return [] as T;
  if (cmd === "headset") return { name: "soundcore Space 2", headphones: true, battery: 18 } as T;
  if (cmd === "buy_item") {
    window.dispatchEvent(new CustomEvent("buy", { detail: args.id }));
    return undefined as T;
  }
  if (cmd === "buy_upgrade") {
    window.dispatchEvent(new CustomEvent("upgrade", { detail: args.id }));
    return undefined as T;
  }
  if (cmd === "start_job") {
    window.dispatchEvent(new CustomEvent("job", { detail: args.id }));
    return undefined as T;
  }
  if (cmd === "save_game") {
    const s = previewStore();
    s.game = args.game as Store["game"];
    localStorage.setItem("drizz-preview", JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("store", { detail: s }));
    return undefined as T;
  }
  if (
    cmd === "save_settings" ||
    cmd === "save_memory" ||
    cmd === "save_pet_memory"
  ) {
    const s = previewStore();
    if (cmd === "save_settings")
      s.settings = args.settings as Store["settings"];
    else if (cmd === "save_pet_memory") {
      const m = args.memory as Store["memory"];
      s.memory = {
        ...s.memory,
        position: m.position,
        recent: m.recent,
        lastGreeting: m.lastGreeting,
        cardShown: m.cardShown,
      };
    } else s.memory = args.memory as Store["memory"];
    localStorage.setItem("drizz-preview", JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("store", { detail: s }));
  }
  return undefined as T;
}
/** Broadcast to every window (panel <-> pet), no Rust round trip. */
export async function emitAll(name: string, payload?: unknown) {
  if (native) return emit(name, payload);
  window.dispatchEvent(new CustomEvent(name, { detail: payload }));
}
export async function on<T>(
  name: string,
  callback: (data: T) => void,
): Promise<() => void> {
  if (native) return listen<T>(name, (e) => callback(e.payload));
  const f = (e: Event) => callback((e as CustomEvent).detail);
  window.addEventListener(name, f);
  return () => window.removeEventListener(name, f);
}
