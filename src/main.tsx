import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
// Two windows, two chunks: the pet never loads the panel (Radix Themes,
// icons), the panel never loads Phaser.
const Panel = lazy(() => import("./panel/Panel"));
const Pet = lazy(() => import("./PhaserWrapper").then((m) => ({ default: m.PhaserWrapper })));
const panel = new URLSearchParams(location.search).get("panel");
document.body.className = panel ? "panel" : "overlay";
createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}>{panel ? <Panel initialTab={panel} /> : <Pet />}</Suspense>,
);
