import {
  type Car,
  type SurfaceSpec,
  type SpeedBand,
  forcesAtSpeed,
  msToKmh,
  TRACK_RADIUS_M,
} from "./physics";

export interface TrackLayout {
  cx: number;
  cy: number;
  /** Horizontal radius of mid-lane ellipse (px). */
  a: number;
  /** Vertical radius of mid-lane ellipse (px). */
  b: number;
  /** Road half-width in px at mid (screen). */
  halfW: number;
  /** Bank rise scale: outer edge lifted by bankSin * bankRise. */
  bankRise: number;
  width: number;
  height: number;
}

export interface PaintInput {
  layout: TrackLayout;
  thetaRad: number;
  surface: SurfaceSpec;
  band: SpeedBand;
  cars: Car[];
  primarySpeed: number;
  time: number;
  toast: { text: string; life: number; kind: "fast" | "slow" } | null;
  /** 0–1 animated bank for smooth visual tilt. */
  visualBank: number;
}

const TRAIL_MAX = 28;
let ARROW_FONT_PX = 12;

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(cssW));
  const height = Math.max(1, Math.floor(cssH));
  const nextW = Math.floor(width * dpr);
  const nextH = Math.floor(height * dpr);
  // Setting canvas.width/height clears the buffer — only touch when size changes.
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

/** Vertical budget above the mid-lane ellipse (in halfW units) at max bank. */
const TOP_EXTENT_H = 2.8;
/** Vertical budget below the mid-lane ellipse (in halfW units). */
const BOTTOM_EXTENT_H = 0.75;

export function makeLayout(width: number, height: number, thetaRad: number): TrackLayout {
  const narrow = width < 640;
  const inset = insetGeomWH(width, height);
  let left: number;
  let right: number;
  let top: number;
  let bottom: number;
  if (narrow) {
    // Phones: panel + HUD sit on top, the track gets the whole width underneath.
    left = 8;
    right = width - 8;
    top = Math.max(inset.y + inset.panelH, 104) + 22;
    bottom = height - 8;
  } else {
    left = 14;
    right = inset.x - 14;
    top = 12;
    bottom = height - 12;
  }
  const regionW = Math.max(120, right - left);
  const regionH = Math.max(120, bottom - top);
  const halfW = Math.max(16, Math.min(44, Math.min(regionW, regionH) * 0.088));
  let b = (regionH - (TOP_EXTENT_H + BOTTOM_EXTENT_H) * halfW - 12) / 2;
  b = Math.max(40, b);
  let a = regionW / 2 - halfW * 1.3;
  a = Math.max(60, Math.min(a, b * 2.0));
  b = Math.min(b, a * 0.62);
  const cx = left + regionW / 2;
  const used = 2 * b + (TOP_EXTENT_H + BOTTOM_EXTENT_H) * halfW + 12;
  const cy = top + (regionH - used) / 2 + b + TOP_EXTENT_H * halfW;
  const bankRise = halfW * 2.4 * Math.sin(thetaRad);
  return { cx, cy, a, b, halfW, bankRise, width, height };
}

/** Mid-lane world (screen) point + outward normal in screen space. */
export function lanePoint(
  layout: TrackLayout,
  phi: number,
  lateral: number,
  bankRise: number,
): { x: number; y: number; tx: number; ty: number; nx: number; ny: number } {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const mx = layout.cx + layout.a * c;
  const my = layout.cy + layout.b * s;
  // Outward normal of the ellipse (approx).
  const nx0 = layout.b * c;
  const ny0 = layout.a * s;
  const nlen = Math.hypot(nx0, ny0) || 1;
  const nx = nx0 / nlen;
  const ny = ny0 / nlen;
  // Tangent (direction of travel).
  const tx0 = -layout.a * s;
  const ty0 = layout.b * c;
  const tlen = Math.hypot(tx0, ty0) || 1;
  const tx = tx0 / tlen;
  const ty = ty0 / tlen;
  // Lateral: +outer. Outer edge is also lifted (bank visual).
  const lift = Math.max(0, lateral) * bankRise;
  const x = mx + nx * lateral * layout.halfW;
  const y = my + ny * lateral * layout.halfW * 0.55 - lift;
  return { x, y, tx, ty, nx, ny };
}

function ellipseRibbon(
  ctx: CanvasRenderingContext2D,
  layout: TrackLayout,
  bankRise: number,
  innerScale: number,
  outerScale: number,
): void {
  const steps = 96;
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    const p = lanePoint(layout, phi, outerScale, bankRise);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const phi = (i / steps) * Math.PI * 2;
    const p = lanePoint(layout, phi, -innerScale, bankRise);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const g = ctx.createRadialGradient(w * 0.35, h * 0.2, 20, w * 0.5, h * 0.55, Math.max(w, h) * 0.75);
  g.addColorStop(0, "#1a2430");
  g.addColorStop(0.45, "#0c1218");
  g.addColorStop(1, "#06090d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Soft stadium flood lights
  ctx.save();
  for (let i = 0; i < 5; i += 1) {
    const lx = w * (0.12 + i * 0.19);
    const ly = h * 0.08;
    const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly + h * 0.35, h * 0.55);
    glow.addColorStop(0, "rgba(255, 200, 120, 0.07)");
    glow.addColorStop(1, "rgba(255, 200, 120, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
  // Distant hills
  ctx.fillStyle = "#0a1016";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  for (let x = 0; x <= w; x += 40) {
    const y = h * 0.68 + Math.sin(x * 0.01 + t * 0.05) * 8 + Math.sin(x * 0.03) * 14;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  ctx.restore();
}

function paintTrack(
  ctx: CanvasRenderingContext2D,
  layout: TrackLayout,
  surface: SurfaceSpec,
  bankRise: number,
  time: number,
): void {
  // Shadow under track
  ctx.save();
  ctx.translate(6, 10);
  ellipseRibbon(ctx, layout, bankRise * 0.4, 1.05, 1.05);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.restore();

  // Outer wall / kerb
  ellipseRibbon(ctx, layout, bankRise, 1.02, 1.22);
  ctx.fillStyle = "#c45a3a";
  ctx.fill();

  // Main asphalt
  ellipseRibbon(ctx, layout, bankRise, 1.0, 1.0);
  const asphalt = ctx.createLinearGradient(
    layout.cx - layout.a,
    layout.cy - layout.b,
    layout.cx + layout.a,
    layout.cy + layout.b,
  );
  asphalt.addColorStop(0, surface.road);
  asphalt.addColorStop(0.5, "#1a1e24");
  asphalt.addColorStop(1, surface.road);
  ctx.fillStyle = asphalt;
  ctx.fill();

  // Surface sheen
  ellipseRibbon(ctx, layout, bankRise, 0.92, 0.92);
  ctx.fillStyle = surface.sheen;
  ctx.fill();

  // Lane dashed mid-line
  ctx.save();
  ctx.strokeStyle = surface.line;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 14]);
  ctx.lineDashOffset = -time * 40;
  ctx.beginPath();
  const steps = 80;
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    const p = lanePoint(layout, phi, 0, bankRise);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();

  // Inner red/white kerb band (no clip — avoids intermittent jagged fills)
  const kerbN = 48;
  for (let i = 0; i < kerbN; i += 1) {
    const phi0 = (i / kerbN) * Math.PI * 2;
    const phi1 = ((i + 1) / kerbN) * Math.PI * 2;
    ctx.beginPath();
    const a = lanePoint(layout, phi0, -1.02, bankRise * 0.25);
    const b = lanePoint(layout, phi1, -1.02, bankRise * 0.25);
    const c = lanePoint(layout, phi1, -1.2, bankRise * 0.18);
    const d = lanePoint(layout, phi0, -1.2, bankRise * 0.18);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? "#e85a4a" : "#f2f2f2";
    ctx.fill();
  }
}

const FLY_VIS_S = 1.1;

function paintCar(
  ctx: CanvasRenderingContext2D,
  car: Car,
  layout: TrackLayout,
  bankRise: number,
): void {
  const s = layout.halfW / 22;
  // Trail
  if (car.trail.length > 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < car.trail.length; i += 1) {
      const a = car.trail[i - 1]!;
      const b = car.trail[i]!;
      ctx.strokeStyle = `${car.color}${Math.floor(a.a * 200)
        .toString(16)
        .padStart(2, "0")}`;
      ctx.lineWidth = 5 * s * a.a;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Skids
  for (const sk of car.skids) {
    ctx.fillStyle = `rgba(20, 20, 20, ${sk.life * 0.75})`;
    ctx.beginPath();
    ctx.ellipse(sk.x, sk.y, 5 * s, 2.4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Puffs
  for (const p of car.puffs) {
    ctx.fillStyle = `rgba(225, 225, 235, ${p.life * 0.6})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * s * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (car.status === "respawning") return;

  const p = lanePoint(layout, car.phi, car.lateral, bankRise);
  let ang = Math.atan2(p.ty, p.tx);
  let scale = 1;
  let alpha = 1;
  if (car.status === "flying") {
    const k = Math.min(1, car.statusT / FLY_VIS_S);
    ang += car.statusT * 9;
    scale = 1 + k * 0.9;
    alpha = 1 - k * 0.75;
  } else if (car.status === "sliding") {
    const k = Math.min(1, car.statusT / FLY_VIS_S);
    ang -= car.statusT * 5;
    alpha = 1 - k * 0.6;
  }

  const len = 30 * s * scale;
  const wid = 15 * s * scale;
  // Lift a flying car off the track a bit so it reads as airborne.
  const lift = car.status === "flying" ? Math.sin(Math.min(1, car.statusT / FLY_VIS_S) * Math.PI) * 26 * s : 0;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Danger halo when over the limit
  if (car.status === "too_fast" || car.status === "too_slow") {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
    ctx.strokeStyle = car.status === "too_fast" ? `rgba(251, 113, 133, ${0.45 + pulse * 0.45})` : `rgba(96, 165, 250, ${0.45 + pulse * 0.45})`;
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, len * 0.8, len * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.translate(p.x, p.y - lift);
  ctx.rotate(ang);

  // Ground shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.ellipse(2 * s, 3 * s + lift * 0.4, len * 0.55, wid * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wheels
  ctx.fillStyle = "#0b0d10";
  const ww = len * 0.2;
  const wh = wid * 0.24;
  for (const wx of [len * 0.28, -len * 0.3]) {
    for (const wy of [-wid * 0.5, wid * 0.5 - wh]) {
      ctx.fillRect(wx - ww / 2, wy, ww, wh);
    }
  }

  // Body (glow + outline)
  ctx.shadowColor = car.color;
  ctx.shadowBlur = 14 * s;
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.moveTo(len * 0.52, 0);
  ctx.quadraticCurveTo(len * 0.42, -wid * 0.36, len * 0.12, -wid * 0.36);
  ctx.lineTo(-len * 0.42, -wid * 0.36);
  ctx.lineTo(-len * 0.42, wid * 0.36);
  ctx.lineTo(len * 0.12, wid * 0.36);
  ctx.quadraticCurveTo(len * 0.42, wid * 0.36, len * 0.52, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  // Rear wing
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(-len * 0.5, -wid * 0.48, len * 0.09, wid * 0.96);

  // Racing stripe
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(-len * 0.4, -wid * 0.07, len * 0.85, wid * 0.14);

  // Cockpit
  ctx.fillStyle = "rgba(10, 14, 20, 0.85)";
  ctx.beginPath();
  ctx.ellipse(-len * 0.05, 0, len * 0.14, wid * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Headlights
  ctx.fillStyle = "#fff6d0";
  ctx.beginPath();
  ctx.arc(len * 0.44, -wid * 0.16, 1.8 * s, 0, Math.PI * 2);
  ctx.arc(len * 0.44, wid * 0.16, 1.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Name tag (screen-aligned)
  if (car.label && car.status !== "flying" && car.status !== "sliding") {
    ctx.save();
    const fs = Math.max(10, Math.round(11 * Math.min(1.2, s)));
    ctx.font = `700 ${fs}px 'Manrope', sans-serif`;
    const tw = ctx.measureText(car.label).width + 10;
    const th = fs + 6;
    const tx = p.x - tw / 2;
    const ty = p.y - len * 0.55 - th - 4;
    roundRectPath(ctx, tx, ty, tw, th, th / 2);
    ctx.fillStyle = "rgba(6, 10, 14, 0.8)";
    ctx.fill();
    ctx.strokeStyle = car.color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = car.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(car.label, p.x, ty + th / 2 + 0.5);
    ctx.restore();
  }
}

function paintForceArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  color: string,
  label: string,
  labelSide: "left" | "right" | "above" | "below",
): void {
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = x0 + dx;
  const y1 = y0 + dy;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // Arrow head
  const ah = 9;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * ah - uy * ah * 0.55, y1 - uy * ah + ux * ah * 0.55);
  ctx.lineTo(x1 - ux * ah + uy * ah * 0.55, y1 - uy * ah - ux * ah * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.font = `600 ${ARROW_FONT_PX}px 'Manrope', sans-serif`;
  ctx.textBaseline = "middle";
  void labelSide;
  const gap = 6;
  let lx = x1 + ux * gap;
  let ly = y1 + uy * (gap + ARROW_FONT_PX * 0.6);
  if (Math.abs(ux) > 0.35) {
    ctx.textAlign = ux > 0 ? "left" : "right";
  } else {
    ctx.textAlign = "center";
  }
  // Keep the label off the shaft for mostly-vertical arrows
  if (Math.abs(ux) <= 0.35) {
    ly = y1 + Math.sign(uy || 1) * (ARROW_FONT_PX * 0.9);
    lx = x1;
  }
  // Halo for readability
  ctx.strokeStyle = "rgba(6, 10, 14, 0.85)";
  ctx.lineWidth = 3;
  ctx.strokeText(label, lx, ly);
  ctx.fillStyle = color;
  ctx.fillText(label, lx, ly);
  ctx.restore();
}

function insetGeomWH(width: number, height: number): { x: number; y: number; panelW: number; panelH: number } {
  const narrow = width < 640;
  const panelW = narrow
    ? Math.min(180, width * 0.48)
    : width >= 900
      ? Math.min(300, width * 0.26)
      : Math.min(230, width * 0.36);
  const panelH = narrow ? Math.min(150, height * 0.32) : Math.min(230, height * 0.5);
  const x = width - panelW - 10;
  const y = narrow ? 8 : 12;
  return { x, y, panelW, panelH };
}

function insetGeom(layout: TrackLayout): { x: number; y: number; panelW: number; panelH: number } {
  return insetGeomWH(layout.width, layout.height);
}

function paintInset(
  ctx: CanvasRenderingContext2D,
  layout: TrackLayout,
  thetaRad: number,
  surface: SurfaceSpec,
  speed: number,
  band: SpeedBand,
): void {
  const { x, y, panelW, panelH } = insetGeom(layout);

  // Panel
  ctx.save();
  roundRectPath(ctx, x, y, panelW, panelH, 12);
  ctx.fillStyle = "rgba(8, 14, 20, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 180, 100, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(230, 236, 242, 0.9)";
  const narrowPanel = panelW < 200;
  ARROW_FONT_PX = narrowPanel ? 11 : 13;
  ctx.font = `600 ${narrowPanel ? 11 : 12}px 'Manrope', sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Cross-section", x + 12, y + 10);

  // Road cross-section
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);
  // Keep the slab clear of the title and the safe-band text at steep angles.
  const roadLen = Math.min(panelW * 0.66, (2 * (panelH * 0.4 - 24)) / Math.max(sin, 0.05));
  const ox = x + panelW * 0.5;
  const oy = y + panelH * 0.58;
  // Banked road: from inner (left/low) to outer (right/high)
  const ix = ox - (roadLen / 2) * cos;
  const iy = oy + (roadLen / 2) * sin;
  const ox2 = ox + (roadLen / 2) * cos;
  const oy2 = oy - (roadLen / 2) * sin;

  // Ground reference
  ctx.strokeStyle = "rgba(140, 160, 180, 0.35)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x + 16, oy + 28);
  ctx.lineTo(x + panelW - 16, oy + 28);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road slab
  const thick = narrowPanel ? 9 : 12;
  ctx.beginPath();
  ctx.moveTo(ix + sin * thick * 0.2, iy + cos * thick * 0.2);
  ctx.lineTo(ox2 + sin * thick * 0.2, oy2 + cos * thick * 0.2);
  ctx.lineTo(ox2 - sin * thick, oy2 - cos * thick);
  ctx.lineTo(ix - sin * thick, iy - cos * thick);
  ctx.closePath();
  ctx.fillStyle = surface.road;
  ctx.fill();
  ctx.strokeStyle = surface.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Sheen on road face
  ctx.fillStyle = surface.sheen;
  ctx.fill();

  // Car on mid-road
  const carH = narrowPanel ? 8 : 11;
  const carW = narrowPanel ? 18 : 26;
  const carX = ox - sin * (thick + carH / 2);
  const carY = oy - cos * (thick + carH / 2);
  ctx.save();
  ctx.translate(carX, carY);
  ctx.rotate(-thetaRad);
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(-carW * 0.42, carH * 0.25, carW * 0.26, carH * 0.35);
  ctx.fillRect(carW * 0.16, carH * 0.25, carW * 0.26, carH * 0.35);
  ctx.fillStyle = "#ff6b3d";
  roundRectPath(ctx, -carW / 2, -carH / 2, carW, carH * 0.85, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(10,14,20,0.75)";
  ctx.fillRect(-carW * 0.18, -carH * 0.42, carW * 0.36, carH * 0.4);
  ctx.restore();

  // Force arrows from car center
  const f = forcesAtSpeed(thetaRad, surface.mu, speed);
  const maxArrow = Math.min(panelW * 0.28, panelH * 0.27);
  const scale = maxArrow / Math.max(f.weight, f.centripetal, f.normal, 1);

  // Weight mg — straight down
  paintForceArrow(ctx, carX, carY, 0, f.weight * scale, "#f0a060", "mg", "below");

  // Normal N — perpendicular out of road (up the normal)
  const nLen = f.normal * scale;
  paintForceArrow(
    ctx,
    carX,
    carY,
    -sin * nLen,
    -cos * nLen,
    "#5eead4",
    "N",
    thetaRad > 0.4 ? "left" : "above",
  );

  // Friction f — along the bank (signed: + up bank = toward outer / up-slope)
  const fLen = f.friction * scale;
  if (fLen >= 10) {
    const sign = Math.sign(f.frictionSigned) || 1;
    // Up the bank direction in screen: toward outer = (cos, -sin)
    paintForceArrow(
      ctx,
      carX,
      carY,
      cos * fLen * sign,
      -sin * fLen * sign,
      "#fbbf24",
      "f",
      sign > 0 ? "right" : "left",
    );
  }

  // Needed centripetal — horizontal toward center (left in our inset: center is downslope/inward)
  // Inset: left = inner = toward track center for a right-turning bank schematic
  const cLen = f.centripetal * scale;
  paintForceArrow(ctx, carX, carY, -cLen, 0, "#fb7185", "mv²/r", "left");

  // Angle label
  ctx.fillStyle = "rgba(200, 210, 220, 0.75)";
  ctx.font = `500 ${narrowPanel ? 10 : 12}px 'IBM Plex Mono', monospace`;
  ctx.textAlign = "right";
  ctx.fillText(`θ = ${((thetaRad * 180) / Math.PI).toFixed(0)}°`, x + panelW - 12, y + 12);

  // Band chip
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(94, 234, 212, 0.9)";
  const vmin = Number.isFinite(band.vMin) ? Math.round(msToKmh(band.vMin)) : 0;
  const vmax = Number.isFinite(band.vMax) ? Math.round(msToKmh(band.vMax)) : 999;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`safe ${vmin}–${vmax} km/h`, x + 12, y + panelH - 10);
  ctx.restore();
}

function paintGauge(
  ctx: CanvasRenderingContext2D,
  layout: TrackLayout,
  speed: number,
  band: SpeedBand,
): void {
  const inset = insetGeom(layout);
  if (layout.width < 640) return;
  const size = layout.width >= 900 ? 124 : 100;
  const gx = inset.x + inset.panelW / 2;
  const gy = inset.y + inset.panelH + 14 + size / 2;

  // Only draw if it fits
  if (gy + size / 2 > layout.height - 8) return;

  const r = size / 2 - 6;
  ctx.save();
  ctx.translate(gx, gy);

  // Background disc
  ctx.beginPath();
  ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 14, 20, 0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 180, 100, 0.28)";
  ctx.stroke();

  const vmaxDisplay = Number.isFinite(band.vMax)
    ? Math.max(band.vMax * 1.15, speed * 1.05, TRACK_RADIUS_M)
    : Math.max(80, speed * 1.2);
  const toAngle = (v: number) => Math.PI * 0.75 + (Math.min(v, vmaxDisplay) / vmaxDisplay) * Math.PI * 1.5;

  // Red zones
  ctx.lineWidth = 8;
  ctx.lineCap = "butt";
  ctx.strokeStyle = "rgba(251, 113, 133, 0.35)";
  ctx.beginPath();
  ctx.arc(0, 0, r - 4, toAngle(0), toAngle(band.vMin));
  ctx.stroke();
  if (Number.isFinite(band.vMax)) {
    ctx.beginPath();
    ctx.arc(0, 0, r - 4, toAngle(band.vMax), toAngle(vmaxDisplay));
    ctx.stroke();
  }

  // Green safe band
  ctx.strokeStyle = "rgba(52, 211, 153, 0.85)";
  ctx.beginPath();
  const gEnd = Number.isFinite(band.vMax) ? band.vMax : vmaxDisplay;
  ctx.arc(0, 0, r - 4, toAngle(band.vMin), toAngle(gEnd));
  ctx.stroke();

  // Needle
  const ang = toAngle(speed);
  ctx.strokeStyle = "#ffe0a0";
  ctx.fillStyle = "#ffe0a0";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(ang) * (r - 13), Math.sin(ang) * (r - 13));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(230, 236, 242, 0.9)";
  ctx.font = "600 15px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(msToKmh(speed))}`, 0, r * 0.62);
  ctx.font = "500 9px 'Manrope', sans-serif";
  ctx.fillStyle = "rgba(160, 180, 200, 0.85)";
  ctx.fillText("km/h", 0, r * 0.62 + 14);

  ctx.restore();
}

function paintToast(
  ctx: CanvasRenderingContext2D,
  layout: TrackLayout,
  toast: { text: string; life: number; kind: "fast" | "slow" },
): void {
  const alpha = Math.min(1, toast.life * 2);
  const w = 160;
  const h = 36;
  const x = layout.cx - w / 2;
  const y = Math.max(8, layout.cy - layout.b - layout.halfW * 2.2 - 40);
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.fillStyle = toast.kind === "fast" ? "rgba(180, 40, 50, 0.92)" : "rgba(30, 90, 140, 0.92)";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 14px 'Manrope', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(toast.text, x + w / 2, y + h / 2);
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function pushTrail(car: Car, layout: TrackLayout, bankRise: number): void {
  if (car.status === "respawning") return;
  const p = lanePoint(layout, car.phi, car.lateral, bankRise);
  car.trail.push({ x: p.x, y: p.y, a: 1 });
  if (car.trail.length > TRAIL_MAX) car.trail.shift();
  for (const t of car.trail) t.a *= 0.92;
}

export function paintScene(canvas: HTMLCanvasElement, input: PaintInput): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { layout, surface, band, cars, primarySpeed, time, toast, visualBank } = input;
  const bankRise = layout.halfW * 2.4 * Math.sin(visualBank);

  paintBackdrop(ctx, layout.width, layout.height, time);
  paintTrack(ctx, layout, surface, bankRise, time);

  for (const car of cars) {
    paintCar(ctx, car, layout, bankRise);
  }

  // On narrow screens, inset overlays bottom-right of track; gauge below if space.
  paintInset(ctx, layout, input.thetaRad, surface, primarySpeed, band);
  paintGauge(ctx, layout, primarySpeed, band);

  if (toast && toast.life > 0) {
    paintToast(ctx, layout, toast);
  }
}
