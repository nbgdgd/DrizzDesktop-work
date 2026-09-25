// Signal processing for the audio tap (tap.rs), no Windows in here:
// A-weighted level per channel (the dose), eight bands for the equalizer,
// an onset envelope with the tempo and the time of the last beat (dancing),
// and the spike detector (a sudden jump in loudness gets ducked).
// Works in hops of 10 ms. Tested with plain `rustc --test src/dsp.rs`.
use std::collections::VecDeque;
use std::f32::consts::PI;

/// Band centres, Hz: bass to air.
pub const BANDS: [f32; 8] = [60., 130., 280., 600., 1300., 2800., 6000., 12000.];
/// Hops per second.
pub const HOP_RATE: usize = 100;
/// Onset history for the tempo: 6 s.
const ONSETS: usize = 600;

#[derive(Clone, Copy, Default)]
struct OnePole {
    b0: f32,
    b1: f32,
    a1: f32,
    x1: f32,
    y1: f32,
}
impl OnePole {
    fn warp(fc: f32, fs: f32) -> (f32, f32) {
        let k = 2. * fs;
        (k, k * (PI * fc.min(fs * 0.45) / fs).tan())
    }
    fn highpass(fc: f32, fs: f32) -> Self {
        let (k, w) = Self::warp(fc, fs);
        OnePole { b0: k / (k + w), b1: -k / (k + w), a1: (w - k) / (k + w), ..Default::default() }
    }
    fn lowpass(fc: f32, fs: f32) -> Self {
        let (k, w) = Self::warp(fc, fs);
        OnePole { b0: w / (k + w), b1: w / (k + w), a1: (w - k) / (k + w), ..Default::default() }
    }
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 - self.a1 * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }
    /// |H| at `f` Hz.
    fn gain(&self, f: f32, fs: f32) -> f32 {
        let w = 2. * PI * f / fs;
        let (c, s) = (w.cos(), -w.sin());
        let num = ((self.b0 + self.b1 * c).powi(2) + (self.b1 * s).powi(2)).sqrt();
        let den = ((1. + self.a1 * c).powi(2) + (self.a1 * s).powi(2)).sqrt();
        num / den
    }
}

/// IEC 61672 A-weighting: four zeros at 0 Hz, poles at 20.6 (x2), 107.7,
/// 737.9 and 12194 Hz (x2), normalised to 0 dB at 1 kHz.
#[derive(Clone)]
pub struct AWeight {
    stages: [OnePole; 6],
    norm: f32,
}
impl AWeight {
    pub fn new(fs: f32) -> Self {
        let stages = [
            OnePole::highpass(20.6, fs),
            OnePole::highpass(20.6, fs),
            OnePole::highpass(107.7, fs),
            OnePole::highpass(737.9, fs),
            OnePole::lowpass(12194., fs),
            OnePole::lowpass(12194., fs),
        ];
        let g: f32 = stages.iter().map(|s| s.gain(1000., fs)).product();
        AWeight { stages, norm: 1. / g.max(1e-9) }
    }
    pub fn run(&mut self, x: f32) -> f32 {
        let mut y = x;
        for s in &mut self.stages {
            y = s.run(y);
        }
        y * self.norm
    }
}

/// RBJ band-pass with 0 dB at the centre, about an octave wide.
#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}
impl Biquad {
    fn bandpass(fc: f32, fs: f32, q: f32) -> Self {
        let w = 2. * PI * fc.min(fs * 0.45) / fs;
        let alpha = w.sin() / (2. * q);
        let a0 = 1. + alpha;
        Biquad { b0: alpha / a0, b2: -alpha / a0, a1: -2. * w.cos() / a0, a2: (1. - alpha) / a0, ..Default::default() }
    }
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

pub fn db(energy: f64) -> f32 {
    if energy <= 1e-12 {
        -120.
    } else {
        (10. * energy.log10()) as f32
    }
}

/// What one hop of 10 ms gave.
#[derive(Clone, Copy, Default, Debug)]
pub struct Hop {
    /// A-weighted mean square per channel (1.0 = full-scale square wave;
    /// a full-scale sine is 0.5, i.e. -3 dB).
    pub left: f64,
    pub right: f64,
    /// Band levels, dB of mean square.
    pub bands: [f32; 8],
}

pub struct Analyzer {
    fs: f32,
    per_hop: usize,
    a_left: AWeight,
    a_right: AWeight,
    bands: [Biquad; 8],
    n: usize,
    sum_l: f64,
    sum_r: f64,
    band_sum: [f64; 8],
    /// Log band energy of the previous hop, for the onset (spectral flux).
    prev: [f32; 8],
    pub onsets: VecDeque<f32>,
    /// Beat period in hops (smoothed) and how sure we are, 0..1.
    pub period: f32,
    pub confidence: f32,
    /// Hops since the last beat when the tempo was last estimated.
    pub beat_age: usize,
    since_tempo: usize,
    /// Equalizer: automatic gain so quiet music moves the bars too.
    peak_db: f32,
    pub bars: [f32; 8],
}
impl Analyzer {
    pub fn new(fs: f32) -> Self {
        Analyzer {
            fs,
            per_hop: (fs as usize / HOP_RATE).max(1),
            a_left: AWeight::new(fs),
            a_right: AWeight::new(fs),
            bands: BANDS.map(|f| Biquad::bandpass(f, fs, 1.4)),
            n: 0,
            sum_l: 0.,
            sum_r: 0.,
            band_sum: [0.; 8],
            prev: [-120.; 8],
            onsets: VecDeque::with_capacity(ONSETS),
            period: 0.,
            confidence: 0.,
            beat_age: 0,
            since_tempo: 0,
            peak_db: -30.,
            bars: [0.; 8],
        }
    }
    pub fn rate(&self) -> f32 {
        self.fs
    }
    /// One stereo frame; calls `hop` every 10 ms.
    pub fn push(&mut self, l: f32, r: f32, hop: &mut impl FnMut(&Self, Hop)) {
        let al = self.a_left.run(l) as f64;
        let ar = self.a_right.run(r) as f64;
        self.sum_l += al * al;
        self.sum_r += ar * ar;
        let m = (l + r) * 0.5;
        for (i, b) in self.bands.iter_mut().enumerate() {
            let y = b.run(m) as f64;
            self.band_sum[i] += y * y;
        }
        self.n += 1;
        if self.n >= self.per_hop {
            let n = self.n as f64;
            let h = Hop { left: self.sum_l / n, right: self.sum_r / n, bands: self.band_sum.map(|e| db(e / n)) };
            self.n = 0;
            self.sum_l = 0.;
            self.sum_r = 0.;
            self.band_sum = [0.; 8];
            self.step(&h);
            hop(self, h);
        }
    }
    fn step(&mut self, h: &Hop) {
        // Onset: how much the bands rose since the last hop, bass counted double.
        let mut flux = 0.;
        for i in 0..8 {
            let up = (h.bands[i].max(-80.) - self.prev[i].max(-80.)).max(0.);
            flux += if i < 2 { up * 2. } else { up };
            self.prev[i] = h.bands[i];
        }
        if self.onsets.len() == ONSETS {
            self.onsets.pop_front();
        }
        self.onsets.push_back(flux);
        self.beat_age += 1;
        self.since_tempo += 1;
        if self.since_tempo >= HOP_RATE / 2 && self.onsets.len() >= 300 {
            self.since_tempo = 0;
            self.tempo();
        }
        // Bars: level against a slowly falling peak, 36 dB of range.
        let top = h.bands.iter().cloned().fold(-120., f32::max);
        self.peak_db = if top > self.peak_db { top } else { (self.peak_db - 0.02).max(-60.) };
        for i in 0..8 {
            let v = ((h.bands[i] - (self.peak_db - 36.)) / 36.).clamp(0., 1.);
            // Fast up, slow down.
            self.bars[i] = if v > self.bars[i] { v } else { self.bars[i] * 0.85 + v * 0.15 };
        }
    }
    /// Autocorrelation of the onset envelope over 67..200 BPM with a soft
    /// preference for ~120, then the phase that lines the most onsets up.
    fn tempo(&mut self) {
        let x: Vec<f32> = self.onsets.iter().cloned().collect();
        let mean = x.iter().sum::<f32>() / x.len() as f32;
        let d: Vec<f32> = x.iter().map(|v| v - mean).collect();
        let ac = |lag: usize| -> f32 { (lag..d.len()).map(|i| d[i] * d[i - lag]).sum() };
        let zero = ac(0);
        if zero <= 1e-6 {
            self.confidence = 0.;
            return;
        }
        let (mut best, mut best_lag) = (0f32, 0usize);
        for lag in 30..=90 {
            let w = (-0.5 * ((lag as f32 / 50.).log2() / 0.9).powi(2)).exp();
            let v = ac(lag) * w;
            if v > best {
                best = v;
                best_lag = lag;
            }
        }
        if best_lag == 0 {
            self.confidence = 0.;
            return;
        }
        // Parabolic peak for a fractional period.
        let (a, b, c) = (ac(best_lag - 1), ac(best_lag), ac(best_lag + 1));
        let shift = if a - 2. * b + c < 0. { 0.5 * (a - c) / (a - 2. * b + c) } else { 0. };
        let lag = best_lag as f32 + shift.clamp(-0.5, 0.5);
        let conf = (ac(best_lag) / zero).clamp(0., 1.);
        self.period = if self.period > 0. && (lag / self.period - 1.).abs() < 0.06 { self.period * 0.7 + lag * 0.3 } else { lag };
        self.confidence = self.confidence * 0.5 + conf * 0.5;
        // Phase: the offset from the end that the onsets agree on.
        let p = self.period;
        let (mut best_sum, mut best_o) = (-1f32, 0usize);
        for o in 0..(p.ceil() as usize) {
            let mut s = 0.;
            let mut k = 0.;
            while (o as f32 + k * p) < (x.len() - 1) as f32 {
                let i = x.len() - 1 - (o as f32 + k * p).round() as usize;
                s += x[i] * 0.9f32.powf(k);
                k += 1.;
            }
            if s > best_sum {
                best_sum = s;
                best_o = o;
            }
        }
        self.beat_age = best_o;
    }
    pub fn bpm(&self) -> f32 {
        if self.period > 0. {
            60. * HOP_RATE as f32 / self.period
        } else {
            0.
        }
    }
    pub fn period_ms(&self) -> f32 {
        self.period * 1000. / HOP_RATE as f32
    }
}

/// Sudden loudness jumps in the content (a scream in a video, an ad twice as
/// loud as the music). Works on the estimated level at the ear, dBA.
pub struct Spike {
    /// Energy of the last 10 s of sounding hops.
    history: VecDeque<f64>,
    fast: VecDeque<f64>,
    /// Hops left of the current duck.
    pub hold: usize,
}
pub const SPIKE_JUMP: f32 = 10.;
pub const SPIKE_MIN: f32 = 80.;
pub const SPIKE_ALWAYS: f32 = 95.;
impl Default for Spike {
    fn default() -> Self {
        Self::new()
    }
}
impl Spike {
    pub fn new() -> Self {
        Spike { history: VecDeque::with_capacity(1000), fast: VecDeque::with_capacity(10), hold: 0 }
    }
    /// Level over the last 100 ms.
    pub fn fast(&self) -> f32 {
        if self.fast.is_empty() {
            -120.
        } else {
            db(self.fast.iter().sum::<f64>() / self.fast.len() as f64)
        }
    }
    /// Average of the last 10 s of sound, None until 3 s were heard.
    pub fn average(&self) -> Option<f32> {
        (self.history.len() >= 300).then(|| db(self.history.iter().sum::<f64>() / self.history.len() as f64))
    }
    /// One hop at `ear` dBA. Returns the cut, dB, when a duck should start.
    pub fn step(&mut self, ear: f32) -> Option<f32> {
        let e = 10f64.powf(ear as f64 / 10.);
        if self.fast.len() == 10 {
            self.fast.pop_front();
        }
        self.fast.push_back(e);
        let fast = self.fast();
        if self.hold > 0 {
            self.hold -= 1;
            // Still loud at the end: hold a little longer.
            if self.hold == 0 && self.average().is_some_and(|a| fast >= a + SPIKE_JUMP * 0.7) {
                self.hold = HOP_RATE / 2;
            }
            return None;
        }
        let avg = self.average();
        let hit = match avg {
            Some(a) => (fast >= a + SPIKE_JUMP && fast >= SPIKE_MIN) || fast >= SPIKE_ALWAYS,
            None => fast >= SPIKE_ALWAYS - 5.,
        };
        // Silence does not drag the average down: only hops with sound count.
        if ear > 40. && !hit {
            if self.history.len() == 1000 {
                self.history.pop_front();
            }
            self.history.push_back(e);
        }
        if !hit {
            return None;
        }
        self.hold = 2 * HOP_RATE + HOP_RATE / 2;
        let target = avg.map_or(80., |a| (a + 3.).max(70.));
        Some((ear.max(fast) - target).clamp(6., 20.))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const FS: f32 = 48000.;
    fn sine(f: f32, amp: f32, n: usize, from: usize) -> impl Iterator<Item = f32> {
        (from..from + n).map(move |i| amp * (2. * PI * f * i as f32 / FS).sin())
    }
    fn level_of(f: f32) -> f32 {
        let mut a = AWeight::new(FS);
        let mut e = 0f64;
        let n = 48000;
        for (i, x) in sine(f, 1., n, 0).enumerate() {
            let y = a.run(x) as f64;
            if i > n / 2 {
                e += y * y;
            }
        }
        db(e / (n / 2 - 1) as f64) + 3.
    }
    #[test]
    fn a_weighting_matches_the_standard() {
        // IEC 61672: 0 dB at 1 kHz, -19.1 at 100 Hz, -8.6 at 250, +1.2 at 2k, -2.5 at 8k.
        for (f, want) in [(1000., 0.), (100., -19.1), (250., -8.6), (2000., 1.2), (8000., -1.1)] {
            let got = level_of(f);
            assert!((got - want).abs() < 1.0, "{f} Hz: {got} dB, want {want}");
        }
    }
    #[test]
    fn full_scale_sine_is_minus_3() {
        let mut an = Analyzer::new(FS);
        let mut hops = vec![];
        for x in sine(1000., 1., 48000, 0) {
            an.push(x, x * 0.5, &mut |_, h| hops.push(h));
        }
        let h = hops.last().unwrap();
        assert!((db(h.left) + 3.).abs() < 0.3, "{}", db(h.left));
        assert!((db(h.right) + 9.).abs() < 0.3, "{}", db(h.right));
        assert_eq!(hops.len(), 100);
    }
    #[test]
    fn bands_follow_the_tone() {
        let mut an = Analyzer::new(FS);
        let mut last = Hop::default();
        for x in sine(600., 0.5, 24000, 0) {
            an.push(x, x, &mut |_, h| last = h);
        }
        let top = (0..8).max_by(|&a, &b| last.bands[a].total_cmp(&last.bands[b])).unwrap();
        assert_eq!(BANDS[top], 600.);
        assert!(an.bars[3] > 0.9 && an.bars[0] < 0.5, "{:?}", an.bars);
    }
    /// A kick every 500 ms (120 BPM) with a 100 Hz thump.
    #[test]
    fn finds_the_tempo_and_the_beat() {
        for bpm in [96., 120., 140.] {
            let mut an = Analyzer::new(FS);
            let period = (60. / bpm * FS) as usize;
            let total = FS as usize * 8;
            let mut last_kick = 0;
            for i in 0..total {
                let t = i % period;
                if t == 0 {
                    last_kick = i;
                }
                let env = (-(t as f32) / 2400.).exp();
                let x = 0.8 * env * (2. * PI * 100. * t as f32 / FS).sin() + 0.02 * ((i * 7919 % 1000) as f32 / 1000. - 0.5);
                an.push(x, x, &mut |_, _| {});
            }
            assert!((an.bpm() - bpm).abs() < 3., "{bpm}: got {}", an.bpm());
            assert!(an.confidence > 0.3, "{bpm}: confidence {}", an.confidence);
            // Beat age as of the last estimate, compared in hops with slack.
            let since_estimate = an.since_tempo;
            let age_now = an.beat_age as i64;
            let true_age = ((total - last_kick) / (FS as usize / HOP_RATE)) as i64;
            let per = an.period as i64;
            let diff = (age_now - true_age).rem_euclid(per);
            assert!(diff <= 3 || diff >= per - 3, "{bpm}: beat age {age_now} vs {true_age} (period {per}, {since_estimate} hops since)");
        }
    }
    #[test]
    fn silence_has_no_tempo() {
        let mut an = Analyzer::new(FS);
        for _ in 0..48000 * 5 {
            an.push(0., 0., &mut |_, _| {});
        }
        assert_eq!(an.confidence, 0.);
    }
    #[test]
    fn spike_ducks_a_jump_not_steady_loud_music() {
        let mut s = Spike::new();
        // 20 s of steady 78 dBA: never ducked.
        for _ in 0..2000 {
            assert_eq!(s.step(78.), None);
        }
        // A 92 dBA scream: ducked by about 11 dB, once, for 2.5 s.
        let mut cuts = vec![];
        for _ in 0..300 {
            if let Some(c) = s.step(92.) {
                cuts.push(c);
            }
        }
        assert_eq!(cuts.len(), 1, "{cuts:?}");
        assert!((cuts[0] - 11.).abs() < 1.5, "{cuts:?}");
        // Quiet film after silence: a door slam at 85 is not a spike (no average yet, under 90).
        let mut q = Spike::new();
        for _ in 0..500 {
            q.step(-120.);
        }
        assert!((0..50).all(|_| q.step(85.).is_none()));
        // But 97 dBA out of silence is.
        let mut z = Spike::new();
        assert!((0..20).any(|_| z.step(97.).is_some()));
    }
    #[test]
    fn soft_music_rising_slowly_is_not_a_spike() {
        let mut s = Spike::new();
        let mut hits = 0;
        for i in 0..6000 {
            // 60 dBA to 84 dBA over a minute.
            if s.step(60. + 24. * i as f32 / 6000.).is_some() {
                hits += 1;
            }
        }
        assert_eq!(hits, 0);
    }
}
