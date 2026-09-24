import React from "react";
import { createRoot } from "react-dom/client";
import { PhaserWrapper } from "./PhaserWrapper";
import { SettingsPanel } from "./SettingsPanel";
import "./style.css";
const panel = new URLSearchParams(location.search).get("panel");
document.body.className = panel ? "panel" : "overlay";
createRoot(document.getElementById("root")!).render(
  panel ? <SettingsPanel initialTab={panel} /> : <PhaserWrapper />,
);
