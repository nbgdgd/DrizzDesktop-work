// Particles and glyphs around the pet: dust on landing, hearts when petted,
// "z" while asleep, stars when dizzy. Positions are desktop pixels; the
// scene passes a converter to canvas coordinates each frame. Everything is
// pooled so a long session does not create objects per reaction.
import Phaser from "phaser";
import type { Rect } from "./model";
export interface Particle {
  kind: "dust" | "glyph";
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  r: number;
  glyph?: Phaser.GameObjects.Text;
}
export class Effects {
  parts: Particle[] = [];
  private glyphs: Phaser.GameObjects.Text[] = [];
  private fx: Phaser.GameObjects.Graphics;
  /** Dizzy stars circle the head until this time. */
  starsUntil = 0;
  /** Punches that landed on the cursor (desktop px). */
  private hits: { x: number; y: number; born: number; word: string; dir: number }[] = [];
  private hitText: Phaser.GameObjects.Text | null = null;
  hit(x: number, y: number, dir: number, dpr: number) {
    const words = ["БАХ!", "ТЫЩ!", "БУМ!", "ХРЯСЬ!", "НА!"];
    this.hits.push({ x, y, born: Date.now(), word: words[Math.floor(Math.random() * words.length)], dir });
    if (this.hits.length > 3) this.hits.shift();
    if (!this.hitText) {
      this.hitText = this.scene.add
        .text(0, 0, "", {
          fontFamily: "Impact, Arial Black, Segoe UI, sans-serif",
          fontSize: "22px",
          color: "#ffe27a",
          stroke: "#1a1206",
          strokeThickness: 4,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(30);
    }
    this.hitText.setResolution(dpr);
    this.hitText.frame.source.resolution = dpr;
  }
  /** Cracks punched into "the glass" by the drunk pet (desktop px). */
  private cracks: { x: number; y: number; born: number; life: number; rays: { x: number; y: number }[][] }[] = [];
  crack(x: number, y: number) {
    const rays: { x: number; y: number }[][] = [];
    const n = 7 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const len = 26 + Math.random() * 38;
      const pts = [{ x: 0, y: 0 }];
      for (let j = 1; j <= 3; j++) {
        const r = (len * j) / 3;
        const b = a + (Math.random() - 0.5) * 0.45;
        pts.push({ x: Math.cos(b) * r, y: Math.sin(b) * r });
      }
      rays.push(pts);
    }
    this.cracks.push({ x, y, born: Date.now(), life: 6500, rays });
    if (this.cracks.length > 4) this.cracks.shift();
    // A few glass shards.
    for (let i = 0; i < 7; i++)
      this.parts.push({
        kind: "dust",
        x,
        y,
        vx: (Math.random() - 0.5) * 320,
        vy: -(40 + Math.random() * 160),
        born: Date.now(),
        life: 500 + Math.random() * 300,
        r: 1.5 + Math.random() * 1.5,
      });
  }
  constructor(private scene: Phaser.Scene) {
    this.fx = scene.add.graphics().setDepth(20);
  }
  dust(x: number, y: number, k: number, n: number, big: boolean) {
    for (let i = 0; i < n; i++)
      this.parts.push({
        kind: "dust",
        x: x + (Math.random() - 0.5) * 30 * k,
        y: y - 3 * k,
        vx: (Math.random() - 0.5) * (big ? 260 : 140) * k,
        vy: -(20 + Math.random() * (big ? 90 : 45)) * k,
        born: Date.now(),
        life: 420 + Math.random() * 220,
        r: (big ? 4 : 3) + Math.random() * 2.5,
      });
  }
  /**
   * A glyph that rides with the pet: `dx` is a fraction of the body width,
   * the start is at head height.
   */
  glyph(ch: string, color: string, size: number, k: number, dpr: number, dx = 0, life = 1300) {
    if (this.parts.length > 30) return;
    let g = this.glyphs.find((t) => !t.visible);
    if (!g) {
      if (this.glyphs.length >= 14) return;
      g = this.scene.add.text(0, 0, "", {
        fontFamily: "Segoe UI Symbol, Segoe UI Emoji, Segoe UI, sans-serif",
        fontSize: "21px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#101114",
        strokeThickness: 2,
      });
      g.setOrigin(0.5, 1).setDepth(25);
      this.glyphs.push(g);
    }
    g.setText(ch).setColor(color).setVisible(true).setAlpha(1);
    g.setResolution(dpr);
    g.frame.source.resolution = dpr;
    this.parts.push({
      kind: "glyph",
      x: dx * size + (Math.random() - 0.5) * 16 * k,
      y: -size * 0.9,
      vx: (Math.random() - 0.5) * 30 * k,
      vy: -45 * k,
      born: Date.now(),
      life,
      r: 0,
      glyph: g,
    });
  }
  /**
   * Moves and draws everything. `toCanvas` converts desktop px to canvas px;
   * glyph offsets are relative to the pet's feet (`petX`, `petY`).
   */
  draw(
    now: number,
    k: number,
    petX: number,
    petY: number,
    toCanvas: (x: number, y: number) => { x: number; y: number },
    head: { x: number; y: number } | null,
    zoom: number,
  ) {
    this.fx.clear();
    const dt = 1 / 30;
    this.parts = this.parts.filter((p) => {
      const age = now - p.born;
      if (age >= p.life) {
        p.glyph?.setVisible(false);
        return false;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "dust") {
        p.vx *= 0.9;
        p.vy += 40 * k * dt;
      }
      const c = p.kind === "glyph" ? toCanvas(petX + p.x, petY + p.y) : toCanvas(p.x, p.y);
      const fade = 1 - age / p.life;
      if (p.kind === "dust") {
        this.fx.fillStyle(0xe8e1d4, 0.8 * fade);
        this.fx.fillCircle(c.x, c.y, p.r * (0.7 + 0.5 * (1 - fade)));
      } else p.glyph?.setPosition(c.x, c.y).setAlpha(Math.min(1, fade * 2.5));
      return true;
    });
    this.hits = this.hits.filter((h) => now - h.born < 650);
    let word: { x: number; y: number; text: string; a: number; s: number } | null = null;
    for (const h of this.hits) {
      const o = toCanvas(h.x, h.y);
      const age = now - h.born;
      const p = age / 650;
      if (age < 160) {
        // White flash + ring.
        this.fx.fillStyle(0xffffff, 0.85 * (1 - age / 160)).fillCircle(o.x, o.y, (6 + age / 12) * zoom);
      }
      this.fx.lineStyle(2.4 * zoom, 0xffe27a, Math.max(0, 1 - p * 1.4));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        const r0 = (9 + p * 26) * zoom,
          r1 = r0 + (10 - p * 6) * zoom;
        this.fx.beginPath();
        this.fx.moveTo(o.x + Math.cos(a) * r0, o.y + Math.sin(a) * r0);
        this.fx.lineTo(o.x + Math.cos(a) * r1, o.y + Math.sin(a) * r1);
        this.fx.strokePath();
      }
      word = { x: o.x + h.dir * 18 * zoom, y: o.y - (22 + p * 14) * zoom, text: h.word, a: Math.min(1, 3 * (1 - p)), s: age < 90 ? 1.35 - age / 300 : 1 };
    }
    if (this.hitText) {
      if (word) this.hitText.setText(word.text).setPosition(word.x, word.y).setAlpha(word.a).setScale(word.s).setVisible(true);
      else this.hitText.setVisible(false);
    }
    this.cracks = this.cracks.filter((c) => now - c.born < c.life);
    for (const c of this.cracks) {
      const o = toCanvas(c.x, c.y);
      const fade = Math.min(1, 2.5 * (1 - (now - c.born) / c.life));
      for (const [col, w, off] of [[0x000000, 3, 1], [0xf4fbff, 1.6, 0]] as const) {
        this.fx.lineStyle(w * Math.max(0.7, zoom * 0.8), col, (col ? 0.95 : 0.45) * fade);
        for (const ray of c.rays) {
          this.fx.beginPath();
          this.fx.moveTo(o.x + off, o.y + off);
          for (const p of ray.slice(1)) this.fx.lineTo(o.x + p.x * zoom + off, o.y + p.y * zoom + off);
          this.fx.strokePath();
        }
      }
      this.fx.fillStyle(0xf4fbff, 0.8 * fade).fillCircle(o.x, o.y, 3 * zoom);
    }
    // Dizzy: three little stars circling above the head.
    if (head && now < this.starsUntil) {
      const t = now / 260;
      for (let i = 0; i < 3; i++) {
        const a = t + (i * Math.PI * 2) / 3;
        const x = head.x + Math.cos(a) * 16 * zoom,
          y = head.y - 6 * zoom + Math.sin(a) * 5 * zoom;
        this.star(x, y, 4.5 * zoom, Math.sin(a) > 0 ? 1 : 0.55);
      }
    }
  }
  private star(x: number, y: number, r: number, alpha: number) {
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    this.fx.fillStyle(0xffe27a, alpha).fillPoints(pts, true);
  }
  /** Region rectangles for everything on screen (so it is not clipped). */
  rects(toCanvas: (x: number, y: number) => { x: number; y: number }, petX: number, petY: number, head: { x: number; y: number } | null, now: number, zoom: number): Rect[] {
    const out: Rect[] = [];
    for (const p of this.parts) {
      const c = p.kind === "glyph" ? toCanvas(petX + p.x, petY + p.y) : toCanvas(p.x, p.y);
      const r = p.kind === "dust" ? p.r + 2 : 14;
      out.push({
        left: Math.floor(c.x - r),
        top: Math.floor(c.y - r - (p.kind === "glyph" ? 6 : 0)),
        right: Math.ceil(c.x + r),
        bottom: Math.ceil(c.y + r),
      });
    }
    for (const h of this.hits) {
      const o = toCanvas(h.x, h.y);
      out.push({ left: Math.floor(o.x - 60 * zoom), top: Math.floor(o.y - 60 * zoom), right: Math.ceil(o.x + 60 * zoom), bottom: Math.ceil(o.y + 40 * zoom) });
    }
    for (const c of this.cracks) {
      const o = toCanvas(c.x, c.y);
      const r = 70 * zoom;
      out.push({ left: Math.floor(o.x - r), top: Math.floor(o.y - r), right: Math.ceil(o.x + r), bottom: Math.ceil(o.y + r) });
    }
    if (head && now < this.starsUntil)
      out.push({
        left: Math.floor(head.x - 24 * zoom),
        top: Math.floor(head.y - 18 * zoom),
        right: Math.ceil(head.x + 24 * zoom),
        bottom: Math.ceil(head.y + 4 * zoom),
      });
    return out;
  }
  get busy() {
    return this.parts.length > 0 || this.cracks.length > 0 || this.hits.length > 0;
  }
}
