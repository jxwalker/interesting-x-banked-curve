import "./styles.css";
import {
  BANK_DEG_DEFAULT,
  BANK_DEG_MAX,
  BANK_DEG_MIN,
  SPEED_KMH_DEFAULT,
  SPEED_KMH_MAX,
  SPEED_KMH_MIN,
  SURFACES,
  type Car,
  type SurfaceId,
  clamp,
  degToRad,
  formatKmh,
  kmhToMs,
  makeCar,
  msToKmh,
  resetCar,
  speedBand,
} from "./physics";
import {
  makeLayout,
  paintScene,
  pushTrail,
  resizeCanvas,
  lanePoint,
  type TrackLayout,
} from "./viz";

const READOUT_MS = 80;
const RESPAWN_S = 1.55;
const FLY_S = 1.1;
/** Map physical m/s to oval angular speed so a lap feels snappy (~6–10 s). */
const TRACK_OMEGA_SCALE = 55;

interface AppState {
  bankDeg: number;
  visualBank: number;
  surface: SurfaceId;
  speedKmh: number;
  width: number;
  height: number;
  toast: { text: string; life: number; kind: "fast" | "slow" } | null;
}

function mustEl<T extends HTMLElement>(
  root: HTMLElement,
  selector: string,
  ctor: new () => T,
): T {
  const el = root.querySelector(selector);
  if (!(el instanceof ctor)) {
    throw new Error(`Missing or wrong element: ${selector}`);
  }
  return el;
}

function isRecordMode(): boolean {
  return new URLSearchParams(window.location.search).has("record");
}

function setText(el: HTMLElement, next: string): void {
  if (el.textContent !== next) el.textContent = next;
}

function mount(): void {
  const appRoot = document.getElementById("app");
  if (!(appRoot instanceof HTMLElement)) {
    throw new Error("Missing #app");
  }
  const root = appRoot;
  const recordMode = isRecordMode();

  const state: AppState = {
    bankDeg: BANK_DEG_DEFAULT,
    visualBank: degToRad(BANK_DEG_DEFAULT),
    surface: "dry",
    speedKmh: SPEED_KMH_DEFAULT,
    width: 800,
    height: 480,
    toast: null,
  };

  const cars: Car[] = [
    makeCar({
      speedMs: kmhToMs(state.speedKmh),
      phi: -0.4,
      color: "#ff6b3d",
      label: "You",
    }),
  ];

  let layout: TrackLayout = makeLayout(800, 480, state.visualBank);

  root.innerHTML = `
    <div class="grain" aria-hidden="true"></div>
    <div class="wash" aria-hidden="true"></div>

    <header class="hero">
      <p class="brand">Interesting X</p>
      <h1 class="title">Banked race track</h1>
    </header>

    <p class="hint" id="hint">
      <span class="hint-dot" aria-hidden="true"></span>
      <span>Tilt the track, change the road, then floor it: stay in the green band or fly off.</span>
    </p>

    <aside class="explainer${recordMode ? " record-hide" : ""}" id="explainer" data-open="false">
      <button
        type="button"
        class="explainer-toggle"
        id="explainer-toggle"
        aria-expanded="false"
        aria-controls="explainer-body"
      >
        <span class="explainer-toggle-label">What am I looking at?</span>
        <span class="explainer-chevron" aria-hidden="true"></span>
      </button>
      <div class="explainer-body" id="explainer-body">
        <p>
          Highway ramps and race tracks are tilted on purpose. At the fastest safe speed,
          weight <em>mg</em>, the normal force <em>N</em>, and friction
          <em>f = μ<sub>s</sub> N</em> (down the slope) add up to exactly
          <em>mv²/r</em> toward the centre. Too fast and you climb off the top; too slow
          on ice and you slide down inside.
        </p>
        <p>
          Inspired by
          <a href="https://x.com/matheorems/status/2106670916448956516" target="_blank" rel="noreferrer">@matheorems</a>.
        </p>
      </div>
    </aside>

    <section class="stage" aria-label="Banked race track" id="stage">
      <canvas id="track-canvas" role="img" aria-label="Animated banked oval with racing cars"></canvas>
      <div class="hud" aria-live="polite">
        <div class="hud-chip">
          <span class="hud-k">v<sub>min</sub></span>
          <span class="hud-v" id="stat-vmin">0</span>
          <span class="hud-u">km/h</span>
        </div>
        <div class="hud-chip hud-accent">
          <span class="hud-k">speed</span>
          <span class="hud-v" id="stat-speed">0</span>
          <span class="hud-u">km/h</span>
        </div>
        <div class="hud-chip">
          <span class="hud-k">v<sub>max</sub></span>
          <span class="hud-v" id="stat-vmax">0</span>
          <span class="hud-u">km/h</span>
        </div>
        <div class="hud-chip hud-mu">
          <span class="hud-k">μ<sub>s</sub></span>
          <span class="hud-v" id="stat-mu">0.9</span>
        </div>
      </div>
    </section>

    <section class="controls" aria-label="Track controls">
      <div class="surfaces" role="group" aria-label="Road surface">
        <button type="button" class="surface active" id="surface-dry" data-surface="dry" aria-pressed="true">Dry</button>
        <button type="button" class="surface" id="surface-wet" data-surface="wet" aria-pressed="false">Wet</button>
        <button type="button" class="surface" id="surface-ice" data-surface="ice" aria-pressed="false">Ice</button>
      </div>

      <div class="sliders">
        <div class="field">
          <label for="param-bank">Bank angle</label>
          <input
            id="param-bank"
            type="range"
            min="${BANK_DEG_MIN}"
            max="${BANK_DEG_MAX}"
            step="1"
            value="${state.bankDeg}"
          />
          <div class="range-meta">
            <span>flat</span>
            <span class="val" id="bank-val">${state.bankDeg}°</span>
            <span>steep</span>
          </div>
        </div>
        <div class="field">
          <label for="param-speed">Throttle</label>
          <input
            id="param-speed"
            type="range"
            min="${SPEED_KMH_MIN}"
            max="${SPEED_KMH_MAX}"
            step="1"
            value="${state.speedKmh}"
          />
          <div class="range-meta">
            <span>crawl</span>
            <span class="val" id="speed-val">${state.speedKmh} km/h</span>
            <span>floor it</span>
          </div>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn warm" id="btn-race">Race</button>
        <button type="button" class="btn" id="btn-reset">Reset</button>
      </div>
    </section>

    <p class="caption">
      r = 80 m · g = 9.81 · v<sub>max</sub> = √[rg(sinθ+μcosθ)/(cosθ−μsinθ)] ·
      v<sub>min</sub> with friction up the bank.
    </p>

    <footer class="foot">
      <span>apps/banked-curve</span>
      <span aria-hidden="true">·</span>
      <span>canvas 2D · no network</span>
    </footer>
  `;

  const stage = mustEl(root, "#stage", HTMLElement);
  const canvas = mustEl(root, "#track-canvas", HTMLCanvasElement);
  const paramBank = mustEl(root, "#param-bank", HTMLInputElement);
  const paramSpeed = mustEl(root, "#param-speed", HTMLInputElement);
  const bankVal = mustEl(root, "#bank-val", HTMLElement);
  const speedVal = mustEl(root, "#speed-val", HTMLElement);
  const statVmin = mustEl(root, "#stat-vmin", HTMLElement);
  const statVmax = mustEl(root, "#stat-vmax", HTMLElement);
  const statSpeed = mustEl(root, "#stat-speed", HTMLElement);
  const statMu = mustEl(root, "#stat-mu", HTMLElement);
  const btnRace = mustEl(root, "#btn-race", HTMLButtonElement);
  const btnReset = mustEl(root, "#btn-reset", HTMLButtonElement);
  const explainer = mustEl(root, "#explainer", HTMLElement);
  const explainerToggle = mustEl(root, "#explainer-toggle", HTMLButtonElement);

  let lastReadout = 0;
  let lastTs = 0;
  let raf = 0;
  let time = 0;

  function bandNow() {
    return speedBand(degToRad(state.bankDeg), SURFACES[state.surface].mu);
  }

  function syncSurfaces(): void {
    for (const id of Object.keys(SURFACES) as SurfaceId[]) {
      const btn = root.querySelector(`#surface-${id}`);
      if (!(btn instanceof HTMLButtonElement)) continue;
      const on = state.surface === id;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.dataset.surface = id;
    }
    stage.dataset.surface = state.surface;
  }

  function syncPrimarySpeed(): void {
    const primary = cars[0];
    if (!primary) return;
    if (primary.status === "ok" || primary.status === "too_fast" || primary.status === "too_slow") {
      primary.targetSpeed = kmhToMs(state.speedKmh);
    }
  }

  function showToast(text: string, kind: "fast" | "slow"): void {
    state.toast = { text, life: 1.8, kind };
  }

  function spawnPuff(car: Car, layoutNow: TrackLayout, count: number): void {
    const bankRise = layoutNow.halfW * 2.4 * Math.sin(state.visualBank);
    const p = lanePoint(layoutNow, car.phi, car.lateral, bankRise);
    for (let i = 0; i < count; i += 1) {
      car.puffs.push({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 80,
        vy: -20 - Math.random() * 60,
        life: 0.7 + Math.random() * 0.5,
        r: 3 + Math.random() * 6,
      });
      car.skids.push({
        x: p.x + (Math.random() - 0.5) * 8,
        y: p.y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 6,
        life: 1.2,
      });
    }
  }

  function updateCar(car: Car, dt: number, isPrimary: boolean): void {
    const band = bandNow();
    const bankRise = layout.halfW * 2.4 * Math.sin(state.visualBank);

    // Particles
    for (const p of car.puffs) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 40 * dt;
      p.life -= dt;
      p.r *= 1 + 0.4 * dt;
    }
    car.puffs = car.puffs.filter((p) => p.life > 0);
    for (const s of car.skids) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 0.55;
    }
    car.skids = car.skids.filter((s) => s.life > 0);

    if (car.status === "flying") {
      car.statusT += dt;
      car.phi += (car.speed / 80) * dt * 0.35;
      car.lateral += 1.8 * dt;
      const p = lanePoint(layout, car.phi, clamp(car.lateral, -1.2, 2.5), bankRise);
      // Visual fly: also drift outward via stored velocity baked into lateral
      void p;
      car.flyVx += 40 * dt;
      if (car.statusT > FLY_S) {
        car.status = "respawning";
        car.statusT = 0;
      }
      pushTrail(car, layout, bankRise);
      return;
    }

    if (car.status === "sliding") {
      car.statusT += dt;
      car.lateral -= 1.4 * dt;
      car.phi += (Math.max(8, car.speed) / TRACK_OMEGA_SCALE) * dt;
      if (car.statusT > FLY_S) {
        car.status = "respawning";
        car.statusT = 0;
      }
      pushTrail(car, layout, bankRise);
      return;
    }

    if (car.status === "respawning") {
      car.statusT += dt;
      if (car.statusT > RESPAWN_S) {
        const spd = isPrimary ? kmhToMs(state.speedKmh) : car.targetSpeed;
        // Respawn at a safe mid-band speed for non-primary race cars if they crashed
        const b = bandNow();
        let spawnSpeed = spd;
        if (!isPrimary && Number.isFinite(b.vMax)) {
          spawnSpeed = clamp(spd, b.vMin + 2, b.vMax * 0.85);
        } else if (isPrimary) {
          // Keep player's throttle but clamp into band so they can recover
          const mid =
            Number.isFinite(b.vMax) && b.vMax > b.vMin
              ? (b.vMin + Math.min(b.vMax, kmhToMs(SPEED_KMH_MAX))) * 0.5
              : Math.max(b.vMin + 5, kmhToMs(90));
          spawnSpeed = mid;
          state.speedKmh = Math.round(msToKmh(spawnSpeed));
          paramSpeed.value = String(state.speedKmh);
          setText(speedVal, `${state.speedKmh} km/h`);
        }
        resetCar(car, spawnSpeed, Math.random() * Math.PI * 2);
      }
      return;
    }

    // Accelerate toward target
    const accel = 28;
    if (car.speed < car.targetSpeed) {
      car.speed = Math.min(car.targetSpeed, car.speed + accel * dt);
    } else if (car.speed > car.targetSpeed) {
      car.speed = Math.max(car.targetSpeed, car.speed - accel * 1.2 * dt);
    }

    // Angular advance: v = ω r → Δφ = v/r * dt (r in metres mapped to oval)
    car.phi += (car.speed / TRACK_OMEGA_SCALE) * dt;

    // Stability check
    const v = car.speed;
    const over =
      Number.isFinite(band.vMax) && v > band.vMax + 0.8;
    const under = v < band.vMin - 0.5 && band.vMin > 1.5;

    if (over) {
      car.lateral = Math.min(1.35, car.lateral + dt * 1.1);
      if (car.lateral > 1.05) {
        car.status = "flying";
        car.statusT = 0;
        car.flyVx = 60;
        car.flyVy = -40;
        spawnPuff(car, layout, 10);
        if (isPrimary) showToast("Too fast!", "fast");
      } else {
        car.status = "too_fast";
      }
    } else if (under) {
      car.lateral = Math.max(-1.35, car.lateral - dt * 1.0);
      if (car.lateral < -1.05) {
        car.status = "sliding";
        car.statusT = 0;
        spawnPuff(car, layout, 6);
        if (isPrimary) showToast("Too slow!", "slow");
      } else {
        car.status = "too_slow";
      }
    } else {
      // Ease back to mid-lane
      car.lateral *= Math.exp(-3.5 * dt);
      if (Math.abs(car.lateral) < 0.02) car.lateral = 0;
      car.status = "ok";
    }

    pushTrail(car, layout, bankRise);
  }

  function updateReadouts(now: number, force: boolean): void {
    if (!force && now - lastReadout < READOUT_MS) return;
    lastReadout = now;
    const band = bandNow();
    const primary = cars[0];
    const v = primary && primary.status !== "respawning" ? primary.speed : kmhToMs(state.speedKmh);
    setText(statVmin, formatKmh(band.vMin));
    setText(statVmax, band.vmaxUndefined ? "∞" : formatKmh(band.vMax));
    setText(statSpeed, formatKmh(v));
    setText(statMu, SURFACES[state.surface].mu.toFixed(1));

    // Colour speed chip by band
    const chip = statSpeed.parentElement;
    if (chip) {
      chip.classList.toggle("hud-danger", v > band.vMax || v < band.vMin);
      chip.classList.toggle("hud-ok", v >= band.vMin && v <= band.vMax);
    }
  }

  function layoutStage(): void {
    const rect = stage.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(200, rect.height);
    if (Math.abs(cssW - state.width) < 0.5 && Math.abs(cssH - state.height) < 0.5) {
      return;
    }
    const sized = resizeCanvas(canvas, cssW, cssH);
    state.width = sized.width;
    state.height = sized.height;
    layout = makeLayout(state.width, state.height, state.visualBank);
  }

  function tick(ts: number): void {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.033, (ts - lastTs) / 1000);
    lastTs = ts;
    time += dt;

    // Smooth visual bank toward control
    const targetBank = degToRad(state.bankDeg);
    state.visualBank += (targetBank - state.visualBank) * Math.min(1, dt * 8);
    layout = makeLayout(state.width, state.height, state.visualBank);

    for (let i = 0; i < cars.length; i += 1) {
      updateCar(cars[i]!, dt, i === 0);
    }

    // Cull extra race cars after they finish respawn once? keep them racing
    if (state.toast) {
      state.toast.life -= dt;
      if (state.toast.life <= 0) state.toast = null;
    }

    const primary = cars[0]!;
    paintScene(canvas, {
      layout,
      thetaRad: state.visualBank,
      surface: SURFACES[state.surface],
      band: bandNow(),
      cars,
      primarySpeed: primary.status === "respawning" ? kmhToMs(state.speedKmh) : primary.speed,
      time,
      toast: state.toast,
      visualBank: state.visualBank,
    });
    updateReadouts(ts, false);
    raf = requestAnimationFrame(tick);
  }

  // Surface buttons
  for (const id of Object.keys(SURFACES) as SurfaceId[]) {
    const btn = mustEl(root, `#surface-${id}`, HTMLButtonElement);
    btn.addEventListener("click", () => {
      state.surface = id;
      syncSurfaces();
      updateReadouts(performance.now(), true);
    });
  }

  paramBank.addEventListener("input", () => {
    state.bankDeg = Number(paramBank.value);
    setText(bankVal, `${state.bankDeg}°`);
    updateReadouts(performance.now(), true);
  });

  paramSpeed.addEventListener("input", () => {
    state.speedKmh = Number(paramSpeed.value);
    setText(speedVal, `${state.speedKmh} km/h`);
    syncPrimarySpeed();
    updateReadouts(performance.now(), true);
  });

  btnRace.addEventListener("click", () => {
    const band = bandNow();
    const vmax = Number.isFinite(band.vMax) ? band.vMax : kmhToMs(180);
    const vmin = band.vMin;
    // Three cars: slow (may slide on ice), mid (survive), fast (flies off)
    const speeds = [
      Math.max(kmhToMs(35), vmin * 0.55),
      clamp((vmin + vmax) * 0.55, kmhToMs(50), vmax * 0.9),
      vmax * 1.35 + kmhToMs(25),
    ];
    // Keep primary; replace extras
    cars.splice(1);
    cars.push(
      makeCar({ speedMs: speeds[0]!, phi: 1.2, color: "#38bdf8", label: "Slow" }),
      makeCar({ speedMs: speeds[1]!, phi: 2.8, color: "#5eead4", label: "Safe" }),
      makeCar({ speedMs: speeds[2]!, phi: 4.5, color: "#fbbf24", label: "Hot" }),
    );
    // Nudge primary into a visible race too
    if (cars[0]) {
      cars[0].phi = -0.2;
      cars[0].status = "ok";
      cars[0].lateral = 0;
    }
  });

  btnReset.addEventListener("click", () => {
    cars.splice(1);
    state.bankDeg = BANK_DEG_DEFAULT;
    state.surface = "dry";
    state.speedKmh = SPEED_KMH_DEFAULT;
    paramBank.value = String(state.bankDeg);
    paramSpeed.value = String(state.speedKmh);
    setText(bankVal, `${state.bankDeg}°`);
    setText(speedVal, `${state.speedKmh} km/h`);
    syncSurfaces();
    if (cars[0]) {
      resetCar(cars[0], kmhToMs(state.speedKmh), -0.4);
      cars[0].color = "#ff6b3d";
    }
    state.toast = null;
    updateReadouts(performance.now(), true);
  });

  explainerToggle.addEventListener("click", () => {
    const open = explainer.dataset.open !== "true";
    explainer.dataset.open = open ? "true" : "false";
    explainerToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  const ro = new ResizeObserver(() => layoutStage());
  ro.observe(stage);

  syncSurfaces();
  layoutStage();
  updateReadouts(performance.now(), true);
  raf = requestAnimationFrame(tick);

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
    { once: true },
  );
}

mount();
