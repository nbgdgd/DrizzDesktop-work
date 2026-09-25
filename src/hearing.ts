// A rough hearing check for the "Уши" page: pulsed tones at five
// frequencies, one ear at a time, getting louder in 5 dB steps until
// "I hear it". Only the difference between the ears means anything (the
// absolute level depends on the headphones and the Windows volume), so the
// result is a pointer for the balance, not a diagnosis. Pure; the page plays
// the tones with WebAudio.
export const FREQS = [500, 1000, 2000, 4000, 8000];
/** Start, step and the loudest step, dB against full scale. */
export const START_DB = -75;
export const STEP_DB = 5;
export const MAX_DB = -15;
/** Differences under this are normal for consumer headphones and a noisy room. */
export const UNEVEN_DB = 6;
export type Ear = "l" | "r";
export interface Tone {
  ear: Ear;
  freq: number;
}
/** Threshold per tone: the first level heard, null if not heard at MAX_DB. */
export type Results = Record<string, number | null>;
export const key = (t: Tone) => `${t.ear}${t.freq}`;
/** Frequencies in turn, both ears for each. */
export const plan = (): Tone[] => FREQS.flatMap((freq) => [{ ear: "l" as Ear, freq }, { ear: "r" as Ear, freq }]);
/** Linear gain for a level in dB. */
export const gainOf = (db: number) => 10 ** (db / 20);
export interface Verdict {
  /** Left threshold minus right, dB, averaged: > 0 = the left ear hears worse. */
  diff: number;
  worse: Ear | "";
  /** Frequencies where one ear needed 10+ dB more. */
  gaps: number[];
  /** Tones heard by neither ear up to the loudest step. */
  unheard: number[];
  /** Balance to suggest (settings.balance), 0 = leave it. */
  balance: number;
}
export function verdict(r: Results): Verdict {
  const diffs: number[] = [];
  const gaps: number[] = [];
  const unheard: number[] = [];
  for (const f of FREQS) {
    const l = r[`l${f}`],
      rr = r[`r${f}`];
    if (l === undefined || rr === undefined) continue;
    if (l === null && rr === null) {
      unheard.push(f);
      continue;
    }
    // Not heard at all counts as one step past the loudest.
    const d = (l ?? MAX_DB + STEP_DB) - (rr ?? MAX_DB + STEP_DB);
    diffs.push(d);
    if (Math.abs(d) >= 10) gaps.push(f);
  }
  const diff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  const worse: Ear | "" = Math.abs(diff) < UNEVEN_DB ? "" : diff > 0 ? "l" : "r";
  // Make the better ear quieter by half the difference, at most 40 %:
  // enough to even things out, not enough to hide a real problem.
  const cut = worse ? Math.min(40, Math.round((1 - gainOf(-Math.abs(diff) / 2)) * 100)) : 0;
  return { diff: Math.round(diff * 10) / 10, worse, gaps, unheard, balance: worse === "l" ? -cut : cut };
}
