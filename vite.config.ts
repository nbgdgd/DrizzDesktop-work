import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// WindowPet's fixed-port Vite / Tauri pipeline; the upstream copy is in upstream/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "chrome105" },
  envPrefix: ["VITE_", "TAURI_"],
});
