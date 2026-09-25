// One sound bus for the whole pet: a single AudioContext (one entry in the
// Windows mixer, named "Drizz Desktop" by balance.rs), a make-up gain and a
// limiter in front of the speakers.
//
// Measured on a real PC (tools/sound-probe.cjs): at the default 55 % the
// pet peaked at ~0.15 while a video next to it peaked at ~0.8, so users with
// something playing heard nothing at all. BOOST brings the pet up to the
// level of ordinary media; the limiter keeps several sounds at once from
// clipping.
export const BOOST = 3.5;
let ctx: AudioContext | undefined;
let input: GainNode | undefined;
export function bus(): { ctx: AudioContext; input: AudioNode } | undefined {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      ctx = new C();
      const boost = ctx.createGain();
      boost.gain.value = BOOST;
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -4;
      limit.knee.value = 2;
      limit.ratio.value = 20;
      limit.attack.value = 0.003;
      limit.release.value = 0.12;
      boost.connect(limit).connect(ctx.destination);
      input = boost;
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, input: input! };
  } catch {
    return undefined;
  }
}
