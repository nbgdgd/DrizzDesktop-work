// Things drawn with the pet: hats and other accessories (level rewards and
// holidays), headphones while music plays, an umbrella in the rain, a
// flashlight at night, the item it carries, and small objects on the floor
// (gifts, its stash, notes). All procedural Phaser graphics — no extra art.
import Phaser from "phaser";
import type { Rect } from "./model";
export interface Accessory {
  id: string;
  name: string;
  /** Level that unlocks it (0 = only through events). */
  level: number;
}
export const accessories: Accessory[] = [
  { id: "", name: "Ничего", level: 0 },
  { id: "cap", name: "Кепка", level: 3 },
  { id: "bow", name: "Бантик", level: 5 },
  { id: "tophat", name: "Цилиндр", level: 8 },
  { id: "crown", name: "Корона", level: 12 },
  { id: "halo", name: "Нимб", level: 16 },
  { id: "aura", name: "Аура", level: 20 },
  { id: "party", name: "Праздничный колпак", level: 0 },
  { id: "santa", name: "Новогодняя шапка", level: 0 },
  { id: "pumpkin", name: "Тыква", level: 0 },
];
export const accessoryUnlocked = (id: string, lvl: number, owned: Record<string, number>) => {
  const a = accessories.find((x) => x.id === id);
  if (!a) return false;
  return a.id === "" || (a.level > 0 && lvl >= a.level) || (owned["wear:" + id] ?? 0) > 0;
};
export interface FloorItem {
  id: number;
  kind: "coin" | "sticker" | "snack" | "note" | "stash";
  /** Desktop px, on the floor. */
  x: number;
  y: number;
  vx: number;
  label?: string;
  born: number;
}
const PAPER = 0xf1e6c8;
export class Props {
  private g: Phaser.GameObjects.Graphics;
  private back: Phaser.GameObjects.Graphics;
  private carried?: Phaser.GameObjects.Image;
  private noteText: Phaser.GameObjects.Text;
  private icons = new Map<number, Phaser.GameObjects.Image>();
  items: FloorItem[] = [];
  private nextId = 1;
  constructor(private scene: Phaser.Scene) {
    // Behind the pet: aura, flashlight beam. In front: hats, umbrella.
    this.back = scene.add.graphics().setDepth(-1);
    this.g = scene.add.graphics().setDepth(5);
    this.noteText = scene.add
      .text(0, 0, "", {
        fontFamily: "Segoe Print, Comic Sans MS, Segoe UI, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
        color: "#2b2620",
        align: "center",
        wordWrap: { width: 96 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(6)
      .setVisible(false);
  }
  setDpr(dpr: number) {
    this.noteText.setResolution(dpr);
    this.noteText.frame.source.resolution = dpr;
  }
  drop(kind: FloorItem["kind"], x: number, y: number, now: number, label?: string): FloorItem {
    const it = { id: this.nextId++, kind, x, y, vx: 0, label, born: now };
    this.items.push(it);
    if (this.items.length > 6) this.remove(this.items[0].id);
    return it;
  }
  remove(id: number) {
    this.items = this.items.filter((i) => i.id !== id);
    this.icons.get(id)?.destroy();
    this.icons.delete(id);
  }
  /** The pet walks into small things on the floor and pushes them along. */
  kick(petX: number, petVx: number, petY: number, k: number) {
    for (const it of this.items) {
      if (it.kind === "note" || Math.abs(it.y - petY) > 6 * k) continue;
      if (Math.abs(it.x - petX) < 26 * k && Math.abs(petVx) > 20 * k && Math.sign(it.x - petX) === Math.sign(petVx))
        it.vx = petVx * 1.6;
    }
  }
  step(dt: number, k: number) {
    for (const it of this.items) {
      if (!it.vx) continue;
      it.x += it.vx * dt;
      it.vx *= Math.pow(0.08, dt);
      if (Math.abs(it.vx) < 4 * k) it.vx = 0;
    }
  }
  /** Floor item under a desktop point (click on a note or a gift). */
  hit(x: number, y: number, k: number): FloorItem | undefined {
    return this.items.find((it) => Math.abs(it.x - x) < 22 * k && y < it.y + 6 * k && y > it.y - (it.kind === "note" ? 46 : 26) * k);
  }
  /**
   * Draws everything for this frame. `head` is the top of the head on the
   * canvas, `angle` the body tilt, `z` logical px per frame px.
   */
  draw(o: {
    head: { x: number; y: number } | null;
    angle: number;
    z: number;
    wear: string;
    headphones: boolean;
    umbrella: boolean;
    flashlight: number;
    carry: string;
    feet: { x: number; y: number };
    toCanvas: (x: number, y: number) => { x: number; y: number };
    now: number;
    visible: boolean;
  }): Rect[] {
    const g = this.g,
      back = this.back;
    g.clear();
    back.clear();
    const rects: Rect[] = [];
    const { head, z } = o;
    const add = (x: number, y: number, w: number, h: number) =>
      rects.push({ left: Math.floor(x), top: Math.floor(y), right: Math.ceil(x + w), bottom: Math.ceil(y + h) });
    // Floor items first (they stay where they are when the pet moves on).
    this.noteText.setVisible(false);
    for (const it of this.items) {
      const c = o.toCanvas(it.x, it.y);
      if (c.x < -30 || c.x > 390 || c.y < -30 || c.y > 370) {
        this.icons.get(it.id)?.setVisible(false);
        continue;
      }
      if (it.kind === "note") {
        const w = 100,
          h = 44;
        g.fillStyle(0x000000, 0.18).fillRect(c.x - w / 2 + 3, c.y - h + 3, w, h);
        g.fillStyle(PAPER, 1).lineStyle(1.5, 0x5b4630, 1);
        g.fillRect(c.x - w / 2, c.y - h, w, h).strokeRect(c.x - w / 2, c.y - h, w, h);
        g.fillStyle(0xd94c4c, 1).fillCircle(c.x, c.y - h + 4, 3);
        this.noteText.setText(it.label ?? "").setPosition(c.x, c.y - h / 2 + 2).setVisible(true);
        add(c.x - w / 2 - 2, c.y - h - 2, w + 6, h + 6);
      } else {
        const s = 11;
        if (it.kind === "coin" || it.kind === "stash") {
          g.fillStyle(0xd9a520, 1).fillCircle(c.x, c.y - s, s);
          g.fillStyle(0xffd75e, 1).fillCircle(c.x - 1, c.y - s - 1, s - 3);
          g.lineStyle(2, 0xb07f10, 1).strokeCircle(c.x, c.y - s, s);
        } else if (it.kind === "sticker") this.starShape(g, c.x, c.y - s, s, 0xff7ab8);
        else if (it.kind === "snack") {
          const key = "shop-" + (it.label ?? "candy");
          if (this.scene.textures.exists(key)) {
            let img = this.icons.get(it.id);
            if (!img) {
              img = this.scene.add.image(0, 0, key).setDepth(6);
              this.icons.set(it.id, img);
            }
            img.setVisible(true).setDisplaySize(26, 26).setPosition(c.x, c.y - 13);
          } else this.starShape(g, c.x, c.y - s, s, 0xffe27a);
        }
        add(c.x - s - 3, c.y - 2 * s - 3, 2 * s + 6, 2 * s + 6);
      }
    }
    if (!o.visible || !head) {
      this.carried?.setVisible(false);
      return rects;
    }
    // Aura and halo glow behind everything.
    if (o.wear === "aura") {
      const pulse = 0.5 + 0.5 * Math.sin(o.now / 400);
      back.fillStyle(0xb4e62e, 0.1 + 0.08 * pulse).fillCircle(o.feet.x, o.feet.y - 90 * z, 105 * z);
      back.fillStyle(0xb4e62e, 0.06 + 0.05 * pulse).fillCircle(o.feet.x, o.feet.y - 90 * z, 125 * z);
      add(o.feet.x - 127 * z, o.feet.y - 217 * z, 254 * z, 254 * z);
    }
    // Night: a flashlight beam in the walking direction.
    if (o.flashlight) {
      const dir = o.flashlight;
      const x0 = o.feet.x + dir * 20 * z,
        y0 = o.feet.y - 60 * z;
      back.fillStyle(0xfff3b0, 0.18);
      back.fillTriangle(x0, y0, x0 + dir * 150, y0 - 40, x0 + dir * 150, y0 + 55);
      g.fillStyle(0x333333, 1).fillRect(x0 - 5, y0 - 3, 10, 6);
      const lo = Math.min(x0, x0 + dir * 150);
      add(lo, y0 - 42, 152, 100);
    }
    // Hat on the head, turned with the body.
    const hat = (x: number, y: number) => {
      const r = o.angle;
      const rot = (dx: number, dy: number) => ({
        x: x + dx * Math.cos(r) - dy * Math.sin(r),
        y: y + dx * Math.sin(r) + dy * Math.cos(r),
      });
      const poly = (pts: [number, number][], color: number, alpha = 1) =>
        g.fillStyle(color, alpha).fillPoints(pts.map(([a, b]) => rot(a * z * 3, b * z * 3)), true);
      switch (o.wear) {
        case "cap":
          poly([[-9, 0], [9, 0], [8, -6], [0, -9], [-8, -6]], 0x2d6cdf);
          poly([[4, 0], [16, 1], [16, -1], [6, -2]], 0x1f4fa8);
          break;
        case "bow":
          poly([[0, -2], [-9, -8], [-9, 4]], 0xff5d8f);
          poly([[0, -2], [9, -8], [9, 4]], 0xff5d8f);
          g.fillStyle(0xd13e6e, 1).fillCircle(rot(0, -6).x, rot(0, -6).y, 2.2 * z * 3);
          break;
        case "tophat":
          poly([[-11, 0], [11, 0], [11, -2], [-11, -2]], 0x1a1a1f);
          poly([[-7, -2], [7, -2], [7, -15], [-7, -15]], 0x1a1a1f);
          poly([[-7, -4], [7, -4], [7, -6], [-7, -6]], 0xb4323c);
          break;
        case "crown":
          poly([[-9, 0], [9, 0], [10, -9], [5, -4], [0, -11], [-5, -4], [-10, -9]], 0xf5c542);
          g.fillStyle(0xe0344a, 1).fillCircle(rot(0, -4).x, rot(0, -4).y, 1.5 * z * 3);
          break;
        case "party":
          poly([[-7, 0], [7, 0], [0, -16]], 0x8a5cf6);
          poly([[-4, -6], [4, -6], [2, -10], [-2, -10]], 0xffe27a);
          g.fillStyle(0xff5d8f, 1).fillCircle(rot(0, -16).x, rot(0, -16).y, 2 * z * 3);
          break;
        case "santa":
          poly([[-10, 0], [10, 0], [6, -9], [14, -4], [0, -14], [-8, -8]], 0xd6282f);
          poly([[-11, 1], [11, 1], [11, -3], [-11, -3]], 0xf5f5f5);
          g.fillStyle(0xf5f5f5, 1).fillCircle(rot(14, -4).x, rot(14, -4).y, 2.4 * z * 3);
          break;
        case "pumpkin":
          g.fillStyle(0xf28a1a, 1).fillEllipse(rot(0, -5).x, rot(0, -5).y, 22 * z * 3, 13 * z * 3);
          poly([[-1, -11], [1, -11], [2, -15], [0, -15]], 0x3c7a2b);
          break;
        case "halo":
          g.lineStyle(2.5 * z * 3, 0xffe27a, 0.9).strokeEllipse(rot(0, -9).x, rot(0, -9).y, 20 * z * 3, 6 * z * 3);
          break;
      }
    };
    if (o.wear && o.wear !== "aura") {
      hat(head.x, head.y + 2 * z * 3);
      add(head.x - 55 * z, head.y - 60 * z, 110 * z, 66 * z);
    }
    // Headphones while music plays: a band over the head and two cups.
    if (o.headphones && !["tophat", "crown", "santa", "pumpkin"].includes(o.wear)) {
      const w = 24 * z * 3;
      g.lineStyle(2.5 * z * 3, 0x2b2d33, 1).beginPath();
      g.arc(head.x, head.y + 16 * z * 3, w, Math.PI * 1.1, Math.PI * 1.9, false).strokePath();
      g.fillStyle(0xb4e62e, 1).fillRoundedRect(head.x - w - 3 * z * 3, head.y + 8 * z * 3, 7 * z * 3, 11 * z * 3, 3);
      g.fillRoundedRect(head.x + w - 4 * z * 3, head.y + 8 * z * 3, 7 * z * 3, 11 * z * 3, 3);
      add(head.x - w - 12 * z, head.y - 8 * z, 2 * w + 24 * z, 70 * z);
    }
    // Umbrella in the rain: a canopy on a stick over the head.
    if (o.umbrella) {
      const cx = head.x + 8 * z * 3,
        cy = head.y - 22 * z * 3,
        r = 30 * z * 3;
      g.lineStyle(2, 0x5a4a3a, 1).lineBetween(cx, cy, cx, head.y + 30 * z * 3);
      g.fillStyle(0x2d6cdf, 1).slice(cx, cy, r, Math.PI, 0, false).fillPath();
      g.fillStyle(0x1f4fa8, 1);
      for (let i = 0; i < 3; i++) g.fillCircle(cx - r + r / 3 + (i * 2 * r) / 3, cy, r / 3);
      add(cx - r - 4, cy - r - 4, 2 * r + 8, r + 10);
    }
    // What it carries (a stolen coin, a gift), held above the head.
    if (o.carry) {
      const key = o.carry.startsWith("shop-") ? o.carry : "";
      if (key && this.scene.textures.exists(key)) {
        if (!this.carried) this.carried = this.scene.add.image(0, 0, key).setDepth(7);
        this.carried.setTexture(key).setVisible(true).setDisplaySize(24, 24).setPosition(head.x, head.y - 14);
      } else {
        this.carried?.setVisible(false);
        g.fillStyle(0xd9a520, 1).fillCircle(head.x, head.y - 12, 9);
        g.fillStyle(0xffd75e, 1).fillCircle(head.x - 1, head.y - 13, 6);
      }
      add(head.x - 16, head.y - 30, 32, 32);
    } else this.carried?.setVisible(false);
    return rects;
  }
  private starShape(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number) {
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    g.fillStyle(color, 1).fillPoints(pts, true);
  }
}
