import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { PetScene } from "./PetScene";
import { canvasSize, canvasZoom } from "./dpi";
// Reuses WindowPet's React-owned transparent Phaser canvas lifecycle.
// The backing store follows devicePixelRatio so the sprite stays crisp at
// 125–300 % Windows scaling; the CSS size stays 360×340 (see dpi.ts).
export function PhaserWrapper() {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
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
    return () => game.destroy(true);
  }, []);
  return <div ref={parent} className="pet-canvas" />;
}
