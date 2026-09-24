// Temperaments: the five pets share one vocabulary (dialogue.ts) but not one
// way of behaving. Everything here is a number or a style the scene and the
// director read; no per-pet phrase banks except where a behaviour needs its
// own words (Claude's lecture before it hits the cursor).
export type Chase =
  /** Follows the cursor around, hits it a couple of times. */
  | "stalk"
  /** Runs after it at full speed and keeps hitting. */
  | "aggressive"
  /** Reads a moral first, then one careful swat. */
  | "lecture"
  /** One limp poke and walks away. */
  | "lazy"
  /** Tries hard, misses, slips. */
  | "clumsy";
export interface Temper {
  id: string;
  /** One line for the panel. */
  trait: string;
  chase: Chase;
  /** Grudge gained from throws/pokes is multiplied by this. */
  revenge: number;
  /** Grudge fades this many times faster than the base rate. */
  forgive: number;
  /** Grudge at which the pet goes after the cursor. */
  huntAt: number;
  /** Most swats in one revenge. */
  swats: number;
  /** Walk/run speed multiplier while hunting. */
  hurry: number;
  /** Chance that a swat or a pounce misses and the pet slips. */
  miss: number;
  /** How far one swat pushes the cursor, logical px. */
  push: number;
  /** Gets jealous of programs you spend hours in. */
  jealous: boolean;
  /** Talks to itself this many times as often as the base rate. */
  mumble: number;
  /** Idle wandering pace (1 = balanced). */
  pace: number;
  /** Voice: base pitch in Hz and oscillator shape for the babble. */
  pitch: number;
  wave: OscillatorType;
}
export const tempers: Record<string, Temper> = {
  drizz: {
    id: "drizz",
    trait: "Наглый. Преследует курсор и бьёт его, если обидели.",
    chase: "stalk",
    revenge: 1,
    forgive: 1,
    huntAt: 35,
    swats: 2,
    hurry: 1.8,
    miss: 0.15,
    push: 70,
    jealous: false,
    mumble: 1,
    pace: 1,
    pitch: 330,
    wave: "square",
  },
  claude: {
    id: "claude",
    trait: "Ворчливый философ. Сначала читает мораль, потом всё-таки бьёт.",
    chase: "lecture",
    revenge: 0.8,
    forgive: 0.7,
    huntAt: 45,
    swats: 1,
    hurry: 1.2,
    miss: 0.1,
    push: 60,
    jealous: false,
    mumble: 1.4,
    pace: 1.6,
    pitch: 210,
    wave: "triangle",
  },
  nezukocoder: {
    id: "nezukocoder",
    trait: "Энергичная и ревнивая. Агрессивно гоняется за курсором.",
    chase: "aggressive",
    revenge: 1.25,
    forgive: 1.5,
    huntAt: 28,
    swats: 4,
    hurry: 2.6,
    miss: 0.2,
    push: 90,
    jealous: true,
    mumble: 1.2,
    pace: 0.55,
    pitch: 520,
    wave: "sine",
  },
  eigenblob: {
    id: "eigenblob",
    trait: "Немного туповатый. Промахивается, поскальзывается, быстро забывает обиды.",
    chase: "clumsy",
    revenge: 1,
    forgive: 2,
    huntAt: 35,
    swats: 3,
    hurry: 1.6,
    miss: 0.55,
    push: 55,
    jealous: false,
    mumble: 1.1,
    pace: 1,
    pitch: 260,
    wave: "sine",
  },
  "aqua-wisp": {
    id: "aqua-wisp",
    trait: "Меланхолик. Вяло тыкает курсор и уходит вздыхать.",
    chase: "lazy",
    revenge: 0.6,
    forgive: 1,
    huntAt: 50,
    swats: 1,
    hurry: 0.8,
    miss: 0.25,
    push: 30,
    jealous: false,
    mumble: 1.6,
    pace: 1.6,
    pitch: 390,
    wave: "triangle",
  },
};
export const temper = (pet: string): Temper => tempers[pet] ?? tempers.drizz;
