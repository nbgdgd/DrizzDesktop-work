// The speech balloon above (or below) the pet, in canvas coordinates:
// a spoken line with an optional status line under it and up to three
// buttons; a muttered line in a small grey thought cloud; or a placard the
// pet holds up ("Я это запомнил."). Returns the rectangle it covers so the
// window region includes it.
import Phaser from "phaser";
import type { Bubble, BubbleAction } from "./director";
import type { Rect } from "./model";
const FONT = "Segoe UI, sans-serif";
const HAND = "Segoe Print, Comic Sans MS, Segoe UI, sans-serif";
export class Balloon {
  private g: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  buttons: Phaser.GameObjects.Text[] = [];
  private dpr = 1;
  private shown = "";
  /** When the current text first appeared (buttons ignore clicks right after). */
  since = 0;
  constructor(scene: Phaser.Scene, onButton: (i: number) => void, onClose: () => void) {
    this.g = scene.add.graphics().setDepth(30);
    this.label = scene.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#e9e9eb",
        wordWrap: { width: 258 },
        lineSpacing: 4,
      })
      .setDepth(31)
      .setInteractive();
    this.label.on("pointerdown", onClose);
    this.sub = scene.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#9aa0a8",
        wordWrap: { width: 258 },
      })
      .setDepth(31);
    for (let i = 0; i < 3; i++) {
      const b = scene.add
        .text(0, 0, "", {
          fontFamily: FONT,
          fontSize: "13px",
          color: "#b4e62e",
          backgroundColor: "#26282d",
          padding: { x: 8, y: 4 },
        })
        .setDepth(32)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });
      b.on("pointerdown", () => onButton(i));
      this.buttons.push(b);
    }
  }
  setDpr(dpr: number) {
    this.dpr = dpr;
    for (const t of [this.label, this.sub, ...this.buttons]) {
      t.setResolution(dpr);
      t.frame.source.resolution = dpr;
    }
  }
  /**
   * Draws the balloon for `b` (or hides it). `anchorX/anchorY` is the pet's
   * feet, `top` the top of its head; `below` puts the balloon under the pet
   * when there is no room above. Returns the covered rectangle.
   */
  render(
    b: { text: string; sub?: string; kind?: Bubble["kind"]; actions?: BubbleAction[] } | null,
    now: number,
    anchorX: number,
    headY: number,
    anchorY: number,
    below: boolean,
    accent: number,
  ): Rect | null {
    const text = b?.text ?? "";
    const key = text + "|" + (b?.sub ?? "") + "|" + (b?.kind ?? "");
    if (key !== this.shown) {
      this.shown = key;
      this.since = now;
    }
    this.g.clear();
    const visible = !!text;
    this.label.setVisible(visible);
    this.sub.setVisible(visible && !!b?.sub && b.kind !== "sign");
    const actions = visible ? (b?.actions ?? []) : [];
    this.buttons.forEach((btn, i) => {
      const a = actions[i];
      btn.setVisible(!!a);
      if (a && btn.text !== a.label) {
        btn.setText(a.label);
        btn.setResolution(this.dpr);
        btn.frame.source.resolution = this.dpr;
      }
    });
    if (!visible) return null;
    const kind = b?.kind ?? "say";
    if (kind === "sign") return this.sign(text, anchorX, headY);
    const mumble = kind === "mumble";
    this.label
      .setFontFamily(FONT)
      .setFontSize(mumble ? 12 : 14)
      .setFontStyle(mumble ? "italic" : "normal")
      .setColor(mumble ? "#b9bcc4" : "#e9e9eb")
      .setWordWrapWidth(mumble ? 200 : 258)
      .setText(text);
    // Size for the full line first, then show only what has been "typed".
    const fullW = this.label.width,
      fullH = this.label.height;
    const perChar = Math.max(18, Math.min(45, 1800 / Math.max(1, text.length)));
    const typed = Math.min(text.length, Math.floor((now - this.since) / perChar) + 1);
    if (typed < text.length) this.label.setText(text.slice(0, typed));
    this.sub.setText(b?.sub ?? "");
    const subH = this.sub.visible ? this.sub.height + 4 : 0;
    const row = actions.length ? 32 : 0;
    const width = mumble ? Math.min(226, fullW + 26) : 290;
    const height = fullH + 26 + subH + row;
    const left = mumble ? Math.max(8, Math.min(352 - width, anchorX - width / 2)) : 35;
    const bottom = below ? anchorY + 18 + height : Math.max(height + 8, headY - 12);
    this.label.setPosition(left + 13, bottom - height + 13);
    this.sub.setPosition(left + 13, bottom - height + 13 + fullH + 4);
    let bx = left + 13;
    for (const btn of this.buttons) {
      if (!btn.visible) continue;
      btn.setPosition(bx, bottom - row - 6);
      bx += btn.width + 8;
    }
    const tail = Math.max(left + 13, Math.min(left + width - 17, anchorX));
    if (mumble) {
      // A thought cloud: soft box and two little bubbles toward the head.
      this.g.fillStyle(0x191a1d, 0.72).lineStyle(1, 0x3a3d44, 0.8);
      this.g.fillRoundedRect(left, bottom - height, width, height, 14).strokeRoundedRect(left, bottom - height, width, height, 14);
      const dir = below ? -1 : 1;
      const y0 = below ? bottom - height : bottom;
      this.g.fillCircle(tail, y0 + dir * 7, 4).fillCircle(tail + 4, y0 + dir * 15, 2.5);
    } else {
      this.g.fillStyle(0x191a1d, 0.97).lineStyle(1, accent, 0.55);
      this.g
        .fillRoundedRect(left, bottom - height, width, height, 11)
        .strokeRoundedRect(left, bottom - height, width, height, 11);
      if (below) this.g.fillTriangle(tail - 5, bottom - height, tail + 5, bottom - height, tail, bottom - height - 7);
      else this.g.fillTriangle(tail - 5, bottom, tail + 5, bottom, tail, bottom + 7);
    }
    return {
      left: Math.floor(left - 2),
      top: Math.floor(bottom - height - (below ? 10 : 2)),
      right: Math.ceil(left + width + 2),
      bottom: Math.ceil(bottom + (below ? 2 : 10)),
    };
  }
  /** A cardboard placard on a stick, held above the head. */
  private sign(text: string, anchorX: number, headY: number): Rect {
    this.label
      .setFontFamily(HAND)
      .setFontSize(15)
      .setFontStyle("bold")
      .setColor("#2b2620")
      .setWordWrapWidth(170)
      .setText(text);
    const w = Math.max(90, this.label.width + 28),
      h = this.label.height + 22;
    const cx = Math.max(w / 2 + 6, Math.min(354 - w / 2, anchorX));
    const top = Math.max(6, headY - h - 34);
    this.g.lineStyle(4, 0x7a5a36, 1).lineBetween(cx, top + h, cx, headY - 2);
    this.g.fillStyle(0xf1e6c8, 1).lineStyle(2, 0x5b4630, 1);
    this.g.fillRect(cx - w / 2, top, w, h).strokeRect(cx - w / 2, top, w, h);
    this.label.setPosition(cx - this.label.width / 2, top + 11);
    return {
      left: Math.floor(cx - w / 2 - 2),
      top: Math.floor(top - 2),
      right: Math.ceil(cx + w / 2 + 2),
      bottom: Math.ceil(headY),
    };
  }
}
