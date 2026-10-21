/** Track radius (m) — mid-lane of the banked curve. */
export const TRACK_RADIUS_M = 80;

/** Standard gravity (m/s²). */
export const G = 9.81;

/** Bank angle limits (degrees). */
export const BANK_DEG_MIN = 5;
export const BANK_DEG_MAX = 45;
export const BANK_DEG_DEFAULT = 28;

/** Throttle speed limits shown on the slider (km/h). */
export const SPEED_KMH_MIN = 20;
export const SPEED_KMH_MAX = 220;
export const SPEED_KMH_DEFAULT = 95;

export type SurfaceId = "dry" | "wet" | "ice";

export interface SurfaceSpec {
  id: SurfaceId;
  label: string;
  mu: number;
  /** Road asphalt tint (CSS / canvas). */
  road: string;
  sheen: string;
  line: string;
}

export const SURFACES: Record<SurfaceId, SurfaceSpec> = {
  dry: {
    id: "dry",
    label: "Dry",
    mu: 0.9,
    road: "#2a3038",
    sheen: "rgba(255, 210, 140, 0.08)",
    line: "#e8c070",
  },
  wet: {
    id: "wet",
    label: "Wet",
    mu: 0.5,
    road: "#1c2834",
    sheen: "rgba(140, 200, 230, 0.22)",
    line: "#9ec8e0",
  },
  ice: {
    id: "ice",
    label: "Ice",
    mu: 0.1,
    road: "#4a6578",
    sheen: "rgba(210, 235, 255, 0.55)",
    line: "#e8f6ff",
  },
};

export interface SpeedBand {
  vMin: number;
  vMax: number;
  /** Ideal speed when μ = 0 (may be NaN if θ ≈ 0). */
  vIdeal: number;
  /** Denominator for v_max went non-positive — bank too steep for friction. */
  vmaxUndefined: boolean;
}

/**
 * Safe speed band on a banked curve (m/s).
 * Friction down the bank → v_max; friction up the bank → v_min.
 */
export function speedBand(thetaRad: number, mu: number, r = TRACK_RADIUS_M, g = G): SpeedBand {
  const s = Math.sin(thetaRad);
  const c = Math.cos(thetaRad);
  const rg = r * g;

  const maxNum = s + mu * c;
  const maxDen = c - mu * s;
  let vMax = Number.POSITIVE_INFINITY;
  let vmaxUndefined = false;
  if (maxDen <= 1e-9) {
    vmaxUndefined = true;
    vMax = Number.POSITIVE_INFINITY;
  } else if (maxNum <= 0) {
    vMax = 0;
  } else {
    vMax = Math.sqrt((rg * maxNum) / maxDen);
  }

  const minNum = s - mu * c;
  const minDen = c + mu * s;
  let vMin = 0;
  if (minNum <= 0 || minDen <= 1e-9) {
    vMin = 0;
  } else {
    vMin = Math.sqrt((rg * minNum) / minDen);
  }

  let vIdeal = 0;
  if (Math.abs(c) > 1e-9 && s > 0) {
    vIdeal = Math.sqrt(rg * (s / c));
  }

  return { vMin, vMax, vIdeal, vmaxUndefined };
}

export function msToKmh(v: number): number {
  return v * 3.6;
}

export function kmhToMs(v: number): number {
  return v / 3.6;
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function formatKmh(vMs: number): string {
  if (!Number.isFinite(vMs)) return "∞";
  return `${Math.round(msToKmh(vMs))}`;
}

/**
 * Forces on a car of mass m (kg) at speed v (m/s) on bank θ with μ.
 * Lateral friction saturates at ±μ N; sign: + = up the bank (toward outer).
 * Returns magnitudes for drawing; frictionSigned is signed along the bank.
 */
export function forcesAtSpeed(
  thetaRad: number,
  mu: number,
  v: number,
  m = 1200,
  r = TRACK_RADIUS_M,
  g = G,
): {
  weight: number;
  normal: number;
  friction: number;
  frictionSigned: number;
  centripetal: number;
  /** Required friction along bank to stay on circle (before clamp). */
  frictionNeeded: number;
} {
  const s = Math.sin(thetaRad);
  const c = Math.cos(thetaRad);
  const weight = m * g;
  const centripetal = (m * v * v) / r;

  // Resolve N and f from:
  //   N cosθ − f sinθ = mg
  //   N sinθ + f cosθ = mv²/r
  // → N = mg cosθ + (mv²/r) sinθ
  // → f = (mv²/r) cosθ − mg sinθ   (+ = up the bank)
  const normal = weight * c + centripetal * s;
  const frictionNeeded = centripetal * c - weight * s;
  const fMax = mu * Math.max(0, normal);
  const frictionSigned = clamp(frictionNeeded, -fMax, fMax);

  return {
    weight,
    normal: Math.max(0, normal),
    friction: Math.abs(frictionSigned),
    frictionSigned,
    centripetal,
    frictionNeeded,
  };
}

export type CarStatus = "ok" | "too_fast" | "too_slow" | "flying" | "sliding" | "respawning";

export interface Car {
  id: number;
  /** Angle around the oval (radians). */
  phi: number;
  /** Desired / commanded speed (m/s). */
  targetSpeed: number;
  /** Current tangential speed (m/s). */
  speed: number;
  /** Lateral offset on the bank: 0 = mid-lane, +1 = outer lip, −1 = inner. */
  lateral: number;
  /** Visual trail of recent world positions. */
  trail: { x: number; y: number; a: number }[];
  color: string;
  status: CarStatus;
  /** Seconds in current abnormal status. */
  statusT: number;
  /** Skid mark particles. */
  skids: { x: number; y: number; vx: number; vy: number; life: number }[];
  /** Smoke / puff particles. */
  puffs: { x: number; y: number; vx: number; vy: number; life: number; r: number }[];
  /** Flying off velocity (world). */
  flyVx: number;
  flyVy: number;
  label: string;
}

const CAR_COLORS = ["#ff6b3d", "#5eead4", "#fbbf24", "#38bdf8", "#34d399"];

let nextCarId = 1;

export function makeCar(opts: {
  speedMs: number;
  phi?: number;
  color?: string;
  label?: string;
}): Car {
  const id = nextCarId++;
  return {
    id,
    phi: opts.phi ?? Math.random() * Math.PI * 2,
    targetSpeed: opts.speedMs,
    speed: opts.speedMs,
    lateral: 0,
    trail: [],
    color: opts.color ?? CAR_COLORS[id % CAR_COLORS.length]!,
    status: "ok",
    statusT: 0,
    skids: [],
    puffs: [],
    flyVx: 0,
    flyVy: 0,
    label: opts.label ?? `Car ${id}`,
  };
}

export function resetCar(car: Car, speedMs: number, phi?: number): void {
  car.phi = phi ?? Math.random() * Math.PI * 2;
  car.targetSpeed = speedMs;
  car.speed = speedMs;
  car.lateral = 0;
  car.trail.length = 0;
  car.status = "ok";
  car.statusT = 0;
  car.skids.length = 0;
  car.puffs.length = 0;
  car.flyVx = 0;
  car.flyVy = 0;
}
