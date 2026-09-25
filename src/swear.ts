// English lines are written the way the pet talks with swearing on; unless
// the user turns swearing on for English, `cleanEn` softens them. Russian
// lines are left as they are.
const rules: [RegExp, string][] = [
  [/\bwhat the fuck\b/gi, "what the heck"],
  [/\bfor fuck's sake\b/gi, "for goodness' sake"],
  [/\bfuck knows\b/gi, "who knows"],
  [/\bfuck yeah\b/gi, "heck yeah"],
  [/\bfuck off\b/gi, "back off"],
  [/\bfuck it\b/gi, "forget it"],
  [/\bthe fuck\b/gi, "the heck"],
  [/\bfucking\s+(great|tragic|obsessed|hungry|suspicious|explode)/gi, "totally $1"],
  [/\bhappy fucking birthday\b/gi, "happy birthday"],
  [/\bgood fucking morning\b/gi, "good morning"],
  [/\bthe fucking thing\b/gi, "the whole thing"],
  [/\bthe damn thing\b/gi, "the thing"],
  [/\blet's fucking go\b/gi, "let's go"],
  [/\bgonna fucking hit\b/gi, "gonna hit"],
  [/\bfucking\b/gi, "freaking"],
  [/\bfucker\b/gi, "sucker"],
  [/\bfucked\b/gi, "done for"],
  [/\bfuck\b/gi, "heck"],
  [/\bholy shit\b/gi, "holy moly"],
  [/\blike shit\b/gi, "awful"],
  [/\bbullshit\b/gi, "nonsense"],
  [/\bshitty\b/gi, "crummy"],
  [/\bdon't give a shit\b/gi, "don't care"],
  [/\bshit yourself\b/gi, "panic"],
  [/\bshit(?=!)/gi, "shoot"],
  [/\bshit\b/gi, "stuff"],
  [/\bpiss off\b/gi, "buzz off"],
  [/\bpissed away\b/gi, "spent"],
  [/\bbroke-ass\b/gi, "penny-pincher"],
  [/\bmy ass\b/gi, "my butt"],
  [/\byour ass\b/gi, "your legs"],
  [/\bcrap\b/gi, "junk"],
  [/\bporn\b/gi, "memes"],
  [/\bscumbag\b/gi, "meanie"],
  [/\bbastard\b/gi, "rascal"],
  [/\blike hell\b/gi, "no way"],
  [/\bas hell\b/gi, "as anything"],
  [/\bthe hell\b/gi, "the heck"],
  [/\bto hell\b/gi, "downhill"],
  [/\bhell\b/gi, "heck"],
  [/\bdamn you\b/gi, "come on"],
  // Name-calling tacked on at the end of a sentence just goes.
  [/,\s*(bitch|damn it|dumbass|asshole|you little dumbass)(?=[.!?...,]|$)/gi, ""],
  [/\bdamn it\b/gi, "darn it"],
  [/\bdamn\b/gi, "darn"],
  [/\bthat kind of asshole\b/gi, "that kind of guy"],
  [/\bbitch\b/gi, "pal"],
  [/\byou little dumbass\b/gi, "you goofball"],
  [/\bdumbass\b/gi, "goofball"],
  [/\basshole\b/gi, "jerk"],
];
/** Swear words that must not survive `cleanEn`. */
export const EN_SWEAR = /\b(fuck\w*|shit\w*|bitch\w*|damn\w*|ass|asshole|dumbass|bastard|piss\w*|hell|crap|porn|scumbag)\b/i;
const capital = (s: string, like: string) =>
  like[0] && like[0] === like[0].toUpperCase() && like[0] !== like[0].toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export function cleanEn(text: string): string {
  let t = text;
  for (const [re, to] of rules)
    t = t.replace(re, (m, ...g) => {
      const out = to.replace(/\$(\d)/g, (_, i) => String(g[Number(i) - 1] ?? ""));
      return capital(out, m);
    });
  // "Thanks." after dropping ", bitch"; a sentence may now start lowercase.
  t = t.replace(/\s+([.!?,...])/g, "$1").replace(/ {2,}/g, " ").replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return t.trim();
}
