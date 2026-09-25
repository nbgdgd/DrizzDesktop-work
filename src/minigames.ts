// Mini-games played through the speech balloon: rock-paper-scissors, "which
// hand", a ten-second clicker and "catch the cursor" (the chase itself runs
// in cursorplay.ts). Pure state; the scene shows the prompts and buttons.
import type { BubbleAction } from "./director";
import { money, tx } from "./i18n";
export type GameKind = "rps" | "hand" | "clicker" | "catch";
/** Shown translated: `tx(gameNames[kind])`. */
export const gameNames: Record<GameKind, string> = {
  rps: "Камень, ножницы, бумага",
  hand: "В какой руке?",
  clicker: "Кликер: 10 секунд",
  catch: "Поймай курсор",
};
export interface Round {
  kind: GameKind;
  since: number;
  until: number;
  score: number;
  /** Hand game: where the coin is. */
  coin?: "left" | "right";
}
export interface Outcome {
  event: "gameWin" | "gameLose" | "gameDraw";
  text: string;
  /** Money for the player. */
  prize: number;
  /** Mood change for the pet. */
  feeling: number;
}
const rpsNames = { rock: "камень", scissors: "ножницы", paper: "бумага" } as const;
type Rps = keyof typeof rpsNames;
const beats: Record<Rps, Rps> = { rock: "scissors", scissors: "paper", paper: "rock" };
export class MiniGames {
  round: Round | null = null;
  start(kind: GameKind, now: number, random: () => number): { text: string; actions: BubbleAction[]; ms: number } {
    const ms = kind === "clicker" ? 10000 : kind === "catch" ? 20000 : 30000;
    this.round = { kind, since: now, until: now + ms, score: 0 };
    if (kind === "rps")
      return {
        text: tx("Камень, ножницы, бумага! Выбирай."),
        actions: [
          { id: "game:rock", label: tx("Камень") },
          { id: "game:scissors", label: tx("Ножницы") },
          { id: "game:paper", label: tx("Бумага") },
        ],
        ms,
      };
    if (kind === "hand") {
      this.round.coin = random() < 0.5 ? "left" : "right";
      return {
        text: tx("Спрятал монетку. В какой лапе?"),
        actions: [
          { id: "game:left", label: tx("В левой") },
          { id: "game:right", label: tx("В правой") },
        ],
        ms,
      };
    }
    if (kind === "clicker") return { text: tx("Кликай по мне! Десять секунд, поехали!"), actions: [], ms };
    return { text: tx("Сейчас я поймаю твой курсор. Двадцать секунд. Убегай!"), actions: [], ms };
  }
  /** A balloon button was pressed during a round. */
  answer(id: string, random: () => number): Outcome | null {
    const r = this.round;
    if (!r) return null;
    if (r.kind === "rps" && id in rpsNames) {
      const you = id as Rps;
      const me = (["rock", "scissors", "paper"] as Rps[])[Math.floor(random() * 3)];
      this.round = null;
      const said = tx("Ты - {you}, я - {me}.", { you: tx(rpsNames[you]), me: tx(rpsNames[me]) });
      if (you === me) return { event: "gameDraw", text: said, prize: 0, feeling: 1 };
      if (beats[you] === me) return { event: "gameWin", text: said, prize: 4, feeling: 2 };
      return { event: "gameLose", text: said, prize: 0, feeling: 5 };
    }
    if (r.kind === "hand" && (id === "left" || id === "right")) {
      const coin = r.coin ?? "left";
      this.round = null;
      const said = tx(coin === "left" ? "Монетка была в левой." : "Монетка была в правой.");
      return id === coin
        ? { event: "gameWin", text: said, prize: 6, feeling: 2 }
        : { event: "gameLose", text: said, prize: 0, feeling: 4 };
    }
    return null;
  }
  /** Click on the pet during the clicker round. */
  click(now: number): boolean {
    if (this.round?.kind !== "clicker" || now > this.round.until) return false;
    this.round.score++;
    return true;
  }
  /** The pet caught the cursor during "catch". */
  caught() {
    if (this.round?.kind === "catch") this.round.score++;
  }
  /** Timed rounds end here. */
  tick(now: number): Outcome | null {
    const r = this.round;
    if (!r || now < r.until) return null;
    this.round = null;
    if (r.kind === "clicker") {
      const prize = Math.min(20, Math.floor(r.score / 2));
      return {
        // Every click pays, so ten or more is a win; "draw" lines ask for a replay.
        event: r.score >= 10 ? "gameWin" : "gameLose",
        text: tx("{n} кликов за 10 секунд. {prize} твои.", { n: r.score, prize: money(prize) }),
        prize,
        feeling: 3,
      };
    }
    if (r.kind === "catch")
      return r.score >= 3
        ? { event: "gameLose", text: tx("Поймал тебя {n} раз. Я чемпион.", { n: r.score }), prize: 0, feeling: 6 }
        : { event: "gameWin", text: tx("Поймал всего {n}. Ты вёрткий.", { n: r.score }), prize: 8, feeling: 2 };
    return { event: "gameDraw", text: tx("Не дождался ответа. Ну и ладно."), prize: 0, feeling: -1 };
  }
}
