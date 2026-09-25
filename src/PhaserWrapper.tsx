import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { PetScene } from "./PetScene";
import { canvasSize, canvasZoom } from "./dpi";
// Reuses WindowPet's React-owned transparent Phaser canvas lifecycle.
// The backing store follows devicePixelRatio so the sprite stays crisp at
// 125-300 % Windows scaling; the CSS size stays 360×340 (see dpi.ts).
export function PhaserWrapper() {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Canvas text does not redraw when a web font arrives, so the game waits
    // for Nunito (at most 1.5 s, then falls back to Segoe UI).
    let game: Phaser.Game | null = null,
      gone = false;
    const faces = ["600 14px Nunito", "700 11px Nunito", "800 12px Nunito", "italic 600 12px Nunito"].map((f) => document.fonts.load(f, "Аб"));
    void Promise.race([Promise.all(faces), new Promise((r) => setTimeout(r, 1500))])
      .catch(() => {})
      .then(() => {
        if (!gone) game = start();
      });
    return () => {
      gone = true;
      game?.destroy(true);
    };
  }, []);
  function start() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvasSize(dpr);
    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: parent.current!,
      width,
      height,
      scale: { mode: Phaser.Scale.NONE, zoom: canvasZoom(dpr) },
      transparent: true,
      pixelArt: false,
      banner: false,
      fps: { target: 30, forceSetTimeOut: true },
      scene: PetScene,
      audio: { noAudio: true },
      // Images are loaded as <img> elements: no XHR/blob step, so only
      // img-src of the CSP matters and a failure surfaces as a load error.
      loader: { imageLoadType: "HTMLImageElement" },
    });
    return game;
  }
  return <div ref={parent} className="pet-canvas" />;
}
