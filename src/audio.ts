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

/**
 * Pet volume slider (0..100) to amplitude, by ear rather than linearly:
 * with a straight line the bottom of the slider was all but silent (15 %
 * sounded like nothing next to other programs). An exponent under one lifts
 * the low end: 15 % = -10 dB, 50 % = -3.6 dB, 100 % = 0 dB; 0 is silence.
 */
export function perceived(percent: number): number {
  const v = Math.max(0, Math.min(100, percent)) / 100;
  return v <= 0 ? 0 : Math.pow(v, 0.6);
}
