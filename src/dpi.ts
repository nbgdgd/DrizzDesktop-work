// Logical overlay size (CSS pixels) versus the physical canvas backing store.
// Windows scaling is handled by WebView2 (devicePixelRatio); the manual pet
// size setting is applied on top of it in logical units. Nothing here should
// be multiplied by the monitor scale a second time.
export const BASE_WIDTH = 360;
export const BASE_HEIGHT = 340;
export function canvasSize(dpr: number) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    width: Math.max(1, Math.round(BASE_WIDTH * ratio)),
    height: Math.max(1, Math.round(BASE_HEIGHT * ratio)),
  };
}
// Phaser ScaleManager zoom that maps the backing store back to 360×340 CSS px.
export function canvasZoom(dpr: number) {
  return BASE_WIDTH / canvasSize(dpr).width;
}
