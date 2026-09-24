// Panel state: the persisted store (read-only mirror of what the pet owns),
// the settings draft that "Сохранить" writes, memory edits, and one line of
// status/error for the footer.
import { useEffect, useRef, useState } from "react";
import { command, on } from "../bridge";
import {
  cleanMemory,
  cleanSettings,
  defaults,
  emptyMemory,
  Memory,
  Monitor,
  Settings,
  Store,
} from "../model";
import { cleanGame, newGame } from "../game";
export function usePanel() {
  const [store, setStore] = useState<Store>({
    settings: defaults,
    memory: emptyMemory,
    game: newGame(0),
    token: "",
    hasKey: false,
  });
  const [draft, setDraft] = useState<Settings>(defaults);
  const [memory, setMemory] = useState<Memory>(emptyMemory);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState("");
  const [tabEvent, setTabEvent] = useState("");
  const latest = useRef<Memory>(emptyMemory);
  const accept = (s: Store) => {
    const m = cleanMemory(s.memory);
    latest.current = m;
    setStore({ ...s, settings: cleanSettings(s.settings), memory: m, game: cleanGame(s.game, Date.now()) });
  };
  useEffect(() => {
    let gone = false;
    const offs: (() => void)[] = [];
    void command<Store>("load_store")
      .then((s) => {
        if (gone) return;
        accept(s);
        setMemory(cleanMemory(s.memory));
        setDraft(cleanSettings(s.settings));
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
    void command<Monitor[]>("monitors").then((m) => !gone && setMonitors(m ?? []));
    for (const [name, fn] of [
      ["store", accept],
      ["tab", (v: string) => setTabEvent(v + "|" + Date.now())],
      ["integration-status", (v: string) => setIntegrationStatus(v)],
    ] as [string, (v: never) => void][]) {
      void on(name, fn).then((off) => (gone ? off() : offs.push(off)));
    }
    return () => {
      gone = true;
      offs.forEach((f) => f());
    };
  }, []);
  const persisted = JSON.stringify(store.settings);
  useEffect(() => setDraft(store.settings), [persisted]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((s) => ({ ...s, [k]: v }));
    setStatus("");
  };
  const dirty = JSON.stringify(draft) !== persisted;
  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const settings = cleanSettings(draft);
      await command("save_settings", { settings });
      setDraft(settings);
      setStatus("Сохранено");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  /** Saves user-owned memory; `reset` makes the pet take it wholesale. */
  const saveMemory = async (patch: Partial<Memory>, reset = false) => {
    try {
      const next = cleanMemory({
        ...latest.current,
        ...patch,
        epoch: reset ? latest.current.epoch + 1 : latest.current.epoch,
      });
      await command("save_memory", { memory: next });
      latest.current = next;
      setMemory(next);
      setStatus("Память сохранена");
    } catch (e) {
      setError(String(e));
    }
  };
  const run = (p: Promise<unknown>, ok?: string) => {
    setError("");
    void p.then(() => ok && setStatus(ok)).catch((e) => setError(String(e)));
  };
  return {
    store,
    draft,
    set,
    dirty,
    save,
    saving,
    memory,
    setMemory,
    latest,
    saveMemory,
    monitors,
    loaded,
    status,
    setStatus,
    error,
    setError,
    integrationStatus,
    tabEvent,
    run,
  };
}
export type PanelState = ReturnType<typeof usePanel>;
