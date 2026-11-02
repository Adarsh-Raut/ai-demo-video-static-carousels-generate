// Recording, frame-perfect: the page's clock is frozen (Playwright's fake clock covers
// timers, requestAnimationFrame, Date and performance), CSS animations and <video>s are
// stepped by hand, and every frame is a 2x screenshot taken after advancing exactly 1/30 s.
// Pointer moves, typing and scrolling are interpolated per frame by us, so the drawn cursor,
// camera, spotlights and callouts in compose line up with the footage to the frame.
//
// One continuous session (logins, state and scroll carry across scenes). Actions that fail
// on a live site (selector gone, element hidden) are logged and skipped, never fatal.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import type { Action, Spec } from "./spec.ts";
import { round, run, workDir, writeJson } from "./util.ts";
import type { VoiceManifest } from "./voice.ts";

export const FPS = 30;
const DT = 1000 / FPS;
// Seconds of air around each scene's narration.
export const VO_LEAD = 0.5;
export const VO_TAIL = 0.7;
const MIN_SCENE = 3.5;
const MOVE_TIME = 0.75; // cursor travel to a target
const SCALE = 2; // device scale factor: footage stays sharp when the camera punches in
const ACTION_TIMEOUT = 6000;

export type Box = { x: number; y: number; width: number; height: number };
export type PointerEvent = {
  t: number; // seconds into the scene
  kind: "move" | "click" | "type" | "hover" | "scroll";
  x: number; // CSS px in the viewport
  y: number;
  box?: Box;
  dur?: number;
  zoom?: number;
  callout?: string;
  spotlight?: boolean;
  chars?: number; // type: characters typed, starting TYPE_DELAY after the click, one per TYPE_FRAMES
};
export const TYPE_DELAY = 2 / FPS + 0.25;
// How long a callout must stay up to be read: 0.5 s + 0.3 s a word.
export const readTime = (text?: string) => (text ? 0.5 + 0.3 * text.trim().split(/\s+/).length : 0);
export const TYPE_FRAMES = 2;

export type SceneTiming = { id: string; start: number; duration: number; events: PointerEvent[] };
export type Recording = {
  video: string;
  viewport: { width: number; height: number };
  scenes: SceneTiming[];
};

export function plannedDuration(id: string, vo: VoiceManifest) {
  const d = vo[id]?.duration;
  return d ? Math.max(MIN_SCENE, VO_LEAD + d + VO_TAIL) : MIN_SCENE;
}

// Cubic in-out: the same curve compose gives the drawn cursor (GSAP "power2.inOut").
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

class Director {
  frame = 0;
  pointer: { x: number; y: number };
  private warned = new Set<string>();
  constructor(
    readonly page: Page,
    readonly framesDir: string,
    viewport: { width: number; height: number },
  ) {
    this.pointer = { x: viewport.width / 2, y: viewport.height / 2 };
  }

  get t() {
    return this.frame / FPS;
  }

  // Advance the page exactly one frame and capture it.
  async tick() {
    await this.page.clock.runFor(DT);
    await this.page.evaluate(STEP_ANIMATIONS, DT);
    await this.page.screenshot({
      path: join(this.framesDir, `f${String(this.frame).padStart(6, "0")}.jpg`),
      type: "jpeg",
      quality: 92,
      caret: "initial",
    });
    this.frame++;
  }

  async hold(seconds: number) {
    const n = Math.round(seconds * FPS);
    for (let i = 0; i < n; i++) await this.tick();
  }

  async moveTo(to: { x: number; y: number }, seconds = MOVE_TIME) {
    const from = { ...this.pointer };
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= n; i++) {
      const k = easeInOut(i / n);
      await this.page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      await this.tick();
    }
    this.pointer = to;
  }

  async scrollTo(y: number, seconds: number) {
    const from = await this.page.evaluate("window.scrollY") as number;
    const max = (await this.page.evaluate("document.documentElement.scrollHeight - innerHeight")) as number;
    const to = Math.max(0, Math.min(y, max));
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= n; i++) {
      const top = from + (to - from) * easeInOut(i / n);
      await this.page.evaluate(`window.scrollTo({ top: ${top}, behavior: "instant" })`);
      await this.tick();
    }
  }

  warn(msg: string) {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    console.warn(`  ! ${msg}`);
  }
}

// Runs in the page each frame: pause every CSS animation/transition and Web Animation and
// move it forward by one frame; same for <video>. Newly started ones are caught next frame.
const STEP_ANIMATIONS = `(dt) => {
  for (const a of document.getAnimations()) {
    if (a.playState === "finished") continue;
    if (a.playState !== "paused") a.pause();
    a.currentTime = (a.currentTime ?? 0) + dt;
  }
  for (const v of document.querySelectorAll("video")) {
    if (!v.paused) v.pause();
    if (v.readyState >= 2) v.currentTime = Math.min(v.duration || Infinity, v.currentTime + dt / 1000);
  }
}`;

export async function record(spec: Spec, vo: VoiceManifest): Promise<Recording> {
  const { dir, project } = workDir(spec.id);
  const framesDir = join(dir, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(join(project, "assets", "rec"), { recursive: true });

  const { width, height } = spec.viewport;
  const browser = await chromium.launch();
  try {
    const page = await openSite(browser, spec);
    const d = new Director(page, framesDir, spec.viewport);
    await page.mouse.move(d.pointer.x, d.pointer.y);

    const scenes: SceneTiming[] = [];
    for (const scene of spec.scenes) {
      const startFrame = d.frame;
      const events: PointerEvent[] = [];
      const at = () => round((d.frame - startFrame) / FPS);
      await d.hold(VO_LEAD);
      for (const action of scene.actions) {
        try {
          await perform(d, spec, action, events, at);
        } catch (err) {
          d.warn(`${scene.id}: skipped ${action.type}${"selector" in action ? ` ${action.selector}` : ""} (${(err as Error).message.split("\n")[0]})`);
        }
      }
      // Keep enough tail for a final callout to finish before the exit transition.
      const last = scene.actions.at(-1);
      const tail = last && "callout" in last && last.callout ? 0.9 : 0;
      const remaining = plannedDuration(scene.id, vo) - (d.frame - startFrame) / FPS;
      await d.hold(Math.max(remaining, tail));
      const timing = { id: scene.id, start: round(startFrame / FPS), duration: round((d.frame - startFrame) / FPS), events };
      scenes.push(timing);
      console.log(`rec  ${scene.id}  ${timing.duration}s  ${events.length} events  (${d.frame} frames)`);
    }
    await d.hold(0.3);

    const video = "assets/rec/session.mp4";
    run("ffmpeg", [
      "-y", "-v", "error", "-framerate", String(FPS), "-i", join(framesDir, "f%06d.jpg"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p",
      "-g", "15", "-movflags", "+faststart", join(project, video),
    ]);
    const rec: Recording = { video, viewport: { width, height }, scenes };
    writeJson(join(dir, "recording.json"), rec);
    return rec;
  } finally {
    await browser.close();
  }
}

// Load the site in real time (network and boot scripts need it), clear consent banners and
// clutter, then freeze its clock for frame stepping.
export async function openSite(browser: Browser, spec: Spec) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    deviceScaleFactor: SCALE,
    reducedMotion: "no-preference",
    locale: "en-US",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT);
  await page.clock.install();
  await gotoSettled(page, spec.url);
  await prepare(page, spec);
  await freeze(page);
  return page;
}

// Pause the page clock a moment ahead of its current time (pausing "now" can already be
// in the past by the time the call lands).
const freeze = async (page: Page) => page.clock.pauseAt(((await page.evaluate("Date.now()")) as number) + 250);

async function gotoSettled(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  // Trigger lazy-loaded images and scroll-in content, then return to the top.
  // Tolerate a client-side redirect or re-render mid-scroll ("context destroyed").
  await page.evaluate(`(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  })()`).catch(() => page.waitForLoadState("domcontentloaded"));
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate("document.fonts && document.fonts.ready").catch(() => {});
  await page.waitForTimeout(600);
}

// Consent banners: click the most privacy-preserving choice when one is offered, else hide
// the banner. Plus anything the spec lists under `hide` (chat widgets, promo bars).
const REJECT_TEXT = [
  "Reject all", "Reject All", "Reject", "Decline", "Decline all", "Only necessary", "Necessary only",
  "Use necessary cookies only", "Allow essential cookies only", "Essential only", "Refuse all", "Deny",
];
const CONSENT_SELECTORS = [
  "#onetrust-banner-sdk", "#onetrust-consent-sdk", "#CybotCookiebotDialog", ".cky-consent-container",
  "#usercentrics-root", ".qc-cmp2-container", "#truste-consent-track", ".cc-window", ".cookie-banner",
  "[id*='cookie-banner' i]", "[class*='cookie-banner' i]", "[id*='consent-banner' i]", "[aria-label*='cookie' i][role='dialog']",
  "[aria-label*='cookie' i][role='region']", "[class*='cookie-notice' i]", "[id*='cookie-notice' i]",
  "#intercom-container", ".intercom-lightweight-app", "#hubspot-messages-iframe-container", "iframe[title*='chat' i]",
  "#crisp-chatbox", ".drift-frame-controller",
];

async function prepare(page: Page, spec: Spec) {
  for (const text of REJECT_TEXT) {
    const btn = page.getByRole("button", { name: text, exact: true }).first();
    if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
  const hide = [...CONSENT_SELECTORS, ...spec.hide].join(",\n");
  await page.addStyleTag({ content: `${hide} { display: none !important; }\nhtml { scroll-behavior: auto !important; }` });
}

async function perform(d: Director, spec: Spec, action: Action, events: PointerEvent[], at: () => number) {
  const page = d.page;
  switch (action.type) {
    case "goto": {
      // Navigation runs in real time; the cut hides it.
      await page.clock.resume();
      await gotoSettled(page, action.url);
      await prepare(page, spec);
      await freeze(page);
      await d.tick();
      return;
    }
    case "wait":
      await d.hold(action.seconds);
      return;
    case "scroll":
    case "scrollTo": {
      let y = action.type === "scroll" ? ((await page.evaluate("window.scrollY")) as number) + action.y : 0;
      if (action.type === "scrollTo") {
        const box = await page.locator(action.selector).first().boundingBox();
        if (!box) throw new Error("not visible");
        y = ((await page.evaluate("window.scrollY")) as number) + box.y - spec.viewport.height * action.offset;
      }
      events.push({ t: at(), kind: "scroll", x: d.pointer.x, y: d.pointer.y, dur: action.duration });
      await d.scrollTo(y, action.duration);
      return;
    }
    case "hover":
    case "click":
    case "type": {
      const el = page.locator(action.selector).first();
      await el.waitFor({ state: "visible" });
      const box = await targetBox(d, el, spec.viewport.height, events, at);
      const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const base = { box, zoom: action.zoom, callout: action.callout, spotlight: action.spotlight };
      events.push({ t: at(), kind: "move", x: to.x, y: to.y, dur: MOVE_TIME, ...base });
      await d.moveTo(to);
      const read = readTime(action.callout) + 0.3;
      if (action.type === "hover") {
        events.push({ t: at(), kind: "hover", x: to.x, y: to.y, ...base });
        await d.hold(Math.max(action.hold, read));
        return;
      }
      events.push({ t: at(), kind: action.type, x: to.x, y: to.y, ...base, chars: action.type === "type" ? action.text.length : undefined });
      await page.mouse.down();
      await d.tick();
      await d.tick();
      await page.mouse.up();
      if (action.type === "type") {
        await d.hold(0.25);
        for (const ch of action.text) {
          await page.keyboard.type(ch);
          for (let f = 0; f < TYPE_FRAMES; f++) await d.tick(); // ~15 characters a second
        }
      }
      await d.hold(Math.max(action.type === "type" ? 0.6 : 0.8, read - 0.1));
      return;
    }
  }
}

// Bring the element into view with an eased scroll (not a jump) if it is off-screen.
async function targetBox(d: Director, el: ReturnType<Page["locator"]>, vh: number, events: PointerEvent[], at: () => number): Promise<Box> {
  let box = await el.boundingBox();
  if (!box) throw new Error("no box");
  if (box.y < 60 || box.y + box.height > vh - 60) {
    const y = ((await d.page.evaluate("window.scrollY")) as number) + box.y - vh * 0.35;
    events.push({ t: at(), kind: "scroll", x: d.pointer.x, y: d.pointer.y, dur: 0.9 });
    await d.scrollTo(y, 0.9);
    box = (await el.boundingBox())!;
  }
  return box;
}
