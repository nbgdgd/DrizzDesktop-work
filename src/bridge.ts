import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { defaults, emptyMemory, Store } from "./model";
import { newGame } from "./game";
export const native = !!(window as unknown as { __TAURI_IPC__?: unknown })
  .__TAURI_IPC__;
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
  if (cmd === "load_store") return previewStore() as T;
  if (cmd === "usage_stats")
    return { today: [], week: [], month: [], all: [] } as T;
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
export async function on<T>(
  name: string,
  callback: (data: T) => void,
): Promise<() => void> {
  if (native) return listen<T>(name, (e) => callback(e.payload));
  const f = (e: Event) => callback((e as CustomEvent).detail);
  window.addEventListener(name, f);
  return () => window.removeEventListener(name, f);
}
