import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { command, native } from "./bridge";
// Nunito (SIL OFL 1.1): the rounded cartoon face of the balloon, card and panel.
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/600-italic.css";
// Two windows, two chunks: the pet never loads the panel (Radix Themes,
// icons), the panel never loads Phaser.
const Panel = lazy(() => import("./panel/Panel"));
const Pet = lazy(() => import("./PhaserWrapper").then((m) => ({ default: m.PhaserWrapper })));
const panel = new URLSearchParams(location.search).get("panel");
// Uncaught errors go to crash.log (Rust side); nothing leaves the machine.
if (native) {
  const report = (what: string) => void command("crash_log", { line: what.slice(0, 3000) }).catch(() => {});
  window.addEventListener("error", (e) => report(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno} ${e.error?.stack ?? ""}`));
  window.addEventListener("unhandledrejection", (e) => report(`unhandled rejection: ${e.reason?.stack ?? String(e.reason)}`));
}
document.body.className = panel ? "panel" : "overlay";
createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}>{panel ? <Panel initialTab={panel} /> : <Pet />}</Suspense>,
);
