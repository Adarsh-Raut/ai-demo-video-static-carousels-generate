// Compose: turn spec + voiceover + recording into a HyperFrames project.
//
// Each scene is a sub-composition:
//   ground   brand gradient with slow-drifting light orbs, continuous across scenes
//   shot     seam transitions (3D tilt, whip, zoom, blur swap), each scene enters differently
//   stage    the camera: eased punch-ins on interactions, pans between nearby targets
//   window   the 2x recording in a browser frame, swung in in 3D on its first appearance
//   spots    spotlights that dim everything but the element being used
//   cursor   a drawn cursor gliding along the same curve the real pointer took
//   callouts short bubbles pointing at elements, placed in screen space after the camera
//   label    lower-third title, word by word
// Motion blur is on for the whole film. Every timing comes from the frame-exact recording.
// The output is plain editable HTML: polish it in HyperFrames Studio afterwards.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Grid } from "./beats.ts";
import {
  type Box,
  FPS,
  introLength,
  outroLength,
  type PointerEvent,
  type Recording,
  readTime,
  TYPE_DELAY,
  TYPE_FRAMES,
  VO_LEAD,
} from "./record.ts";
import { BUNDLED_FONTS } from "./scout.ts";
import type { Spec } from "./spec.ts";
import { esc, GSAP, musicTag, musicVolume, resolveMusic, Sfx } from "./media.ts";
import { round, workDir } from "./util.ts";
import type { VoiceManifest } from "./voice.ts";

const W = 1920;
const H = 1080;
const BAR = 44; // fake browser title bar
const ZOOM = { click: 1.45, type: 1.5, hover: 1.3 };
const PERSPECTIVE = 1800;

type Seam = "tilt" | "whip" | "zoom" | "blur";
const SEAMS: Seam[] = ["whip", "zoom", "tilt", "blur"];
// How scene i of n enters and leaves. The old shot leaves in the last ~0.3 s before the cut,
// the new one enters on the cut (the beat), over the same continuous ground.
export const seamsFor = (i: number, n: number): { enter: Seam; exit: Seam } => ({
  enter: i === 0 ? "tilt" : SEAMS[(i - 1) % SEAMS.length],
  exit: i === n - 1 ? "zoom" : SEAMS[i % SEAMS.length],
});

type Slot = { id: string; start: number; duration: number };

export function compose(spec: Spec, specDir: string, vo: VoiceManifest, rec: Recording, grid: Grid) {
  const { project } = workDir(spec.id);
  mkdirSync(join(project, "compositions"), { recursive: true });
  const brand = { ...spec.brand, font: BUNDLED_FONTS.includes(spec.brand.font) ? spec.brand.font : "Inter" };

  // Root timeline layout: intro → scenes (recorded lengths) → outro. The recorder ran every
  // scene on to a bar line, so each slot boundary is a cut on the music.
  const slots: Slot[] = [];
  let t = 0;
  const push = (id: string, duration: number) => {
    slots.push({ id, start: round(t), duration: round(duration) });
    t += duration;
  };
  push("intro", rec.intro ?? introLength(vo, grid));
  for (const s of rec.scenes) push(s.id, s.duration);
  push("outro", outroLength(t, vo, grid));
  const total = round(t);

  const win = windowGeometry(rec.viewport);
  const ctx = { spec, brand, win, rec, grid };
  writeFileSync(join(project, "compositions", "intro.html"), introHtml(ctx, slots[0]));
  let pointer = { x: W / 2, y: H * 0.62 };
  const typing: { at: number; duration: number }[] = [];
  rec.scenes.forEach((scene, i) => {
    const s = spec.scenes.find((x) => x.id === scene.id)!;
    const slot = slots[i + 1];
    const { enter, exit } = seamsFor(i, rec.scenes.length);
    const out = sceneHtml(ctx, { scene, slot, title: s.title, enter, exit, pointer });
    pointer = out.lastPointer;
    typing.push(...out.typing.map((x) => ({ at: slot.start + x.at, duration: x.duration })));
    writeFileSync(join(project, "compositions", `${scene.id}.html`), out.html);
  });
  writeFileSync(join(project, "compositions", "outro.html"), outroHtml(ctx, slots.at(-1)!));

  const audio = audioTags(spec, specDir, vo, rec, slots, total, project, typing, grid);
  writeFileSync(join(project, "index.html"), indexHtml(spec, slots, total, audio));
  writeFileSync(
    join(project, "hyperframes.json"),
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
        media: { autoProxy: true },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(project, "meta.json"), JSON.stringify({ id: spec.id, name: spec.brand.name || spec.id }, null, 2));
  console.log(`compose  ${slots.length} scenes, ${total}s → ${project}`);
  return { project, total };
}

type Ctx = { spec: Spec; brand: Spec["brand"]; win: Win; rec: Recording; grid: Grid };

// ---------- geometry ----------

type Win = { x: number; y: number; w: number; h: number; k: number };
type Cam = { scale: number; x: number; y: number };
const IDENTITY: Cam = { scale: 1, x: 0, y: 0 };

function windowGeometry(vp: { width: number; height: number }): Win {
  let vh = H * 0.84 - BAR;
  let w = (vh * vp.width) / vp.height;
  if (w > W * 0.84) {
    w = W * 0.84;
    vh = (w * vp.height) / vp.width;
  }
  const h = vh + BAR;
  return { x: round((W - w) / 2, 1), y: round((H - h) / 2, 1), w: round(w, 1), h: round(h, 1), k: w / vp.width };
}

const toStage = (win: Win, p: { x: number; y: number }) => ({
  x: round(win.x + p.x * win.k, 1),
  y: round(win.y + BAR + p.y * win.k, 1),
});
const boxToStage = (win: Win, b: Box, pad = 0) => ({
  x: round(win.x + b.x * win.k - pad, 1),
  y: round(win.y + BAR + b.y * win.k - pad, 1),
  w: round(b.width * win.k + pad * 2, 1),
  h: round(b.height * win.k + pad * 2, 1),
});

// SVG path for a rounded rectangle (drawn counter to the frame, so evenodd cuts a hole).
function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const f = (n: number) => round(n, 1);
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

// Camera transform (origin 0 0) that centres a stage point at scale s. Once zoomed far
// enough for the window to fill the frame, it never shows past the window's edges;
// otherwise the whole window stays in frame.
function aim(win: Win, p: { x: number; y: number }, s: number): Cam {
  const axis = (target: number, size: number, lo: number, len: number) => {
    const want = size / 2 - s * target;
    // Too small to fill: keep the whole window in frame instead of cutting one edge.
    const [min, max] = s * len >= size ? [size - s * (lo + len), -s * lo] : [-s * lo, size - s * (lo + len)];
    return round(Math.min(max, Math.max(min, want)), 1);
  };
  return { scale: s, x: axis(p.x, W, win.x, win.w), y: axis(p.y, H, win.y, win.h) };
}

// ---------- interactions: one "beat" per pointer target ----------

type Beat = {
  move: PointerEvent; // cursor starts travelling
  act: PointerEvent; // the click / type / hover itself
  actT: number; // when the UI has reacted (typing finished)
  endT: number; // when attention can leave this element
  zoom: number;
  spotlight: boolean;
  callout?: string;
};

function beats(evs: PointerEvent[], D: number): Beat[] {
  const out: Beat[] = [];
  evs.forEach((e, i) => {
    if (e.kind !== "move") return;
    const act = evs[i + 1];
    if (!act || !["click", "type", "hover"].includes(act.kind)) return;
    const kind = act.kind as "click" | "type" | "hover";
    const typed = kind === "type" ? TYPE_DELAY + ((act.chars ?? 0) * TYPE_FRAMES) / FPS : 0;
    const nextMove = evs.slice(i + 2).find((x) => x.kind === "move" || x.kind === "scroll");
    const limit = (nextMove?.t ?? D - 0.9) - 0.05;
    const actT = act.t + typed;
    // Long enough for the UI to react and for any callout to be read, never into the next beat.
    const want = Math.max(actT + (kind === "hover" ? 1.6 : 1.4), calloutIn(e, act) + readTime(e.callout));
    const endT = Math.max(Math.min(limit, want), Math.min(actT + 0.9, D - 0.6));
    out.push({
      move: e,
      act,
      actT,
      endT: round(endT),
      zoom: e.zoom ?? ZOOM[kind],
      spotlight: e.spotlight ?? (kind !== "hover" || !!e.callout),
      callout: e.callout,
    });
  });
  return out;
}

// A callout appears once the cursor has arrived (and the camera has mostly settled).
const calloutIn = (move: PointerEvent, act: PointerEvent) => round(Math.max(act.t, move.t + 0.8));

type CamKey = { t: number; dur: number; to: Cam };

// Punch in as the cursor travels, hold while the UI reacts, then pan straight to the next
// target if it comes soon, else ease back out. Scrolls always happen zoomed out.
function cameraPlan(bs: Beat[], evs: PointerEvent[], win: Win, D: number): CamKey[] {
  const keys: CamKey[] = [];
  let zoomed = false;
  let busy = 0;
  bs.forEach((b, n) => {
    if (b.zoom <= 1.01) return;
    const start = Math.max(busy, b.move.t - 0.1);
    keys.push({ t: round(start), dur: 0.85, to: aim(win, toStage(win, b.act), b.zoom) });
    busy = start + 0.85;
    zoomed = true;
    const next = bs.slice(n + 1).find((x) => x.zoom > 1.01);
    const scrollBetween = evs.some((x) => x.kind === "scroll" && x.t > b.act.t && x.t < (next?.move.t ?? D));
    if (!next || next.move.t - b.endT > 0.6 || scrollBetween) {
      const outAt = Math.min(Math.max(busy, b.endT), D - 1.2);
      keys.push({ t: round(outAt), dur: 0.9, to: IDENTITY });
      busy = outAt + 0.9;
      zoomed = false;
    }
  });
  if (zoomed) keys.push({ t: round(Math.max(busy, D - 1.1)), dur: 0.8, to: IDENTITY });
  return keys;
}

const camAt = (keys: CamKey[], t: number) => keys.filter((k) => k.t <= t).at(-1)?.to ?? IDENTITY;

// ---------- scenes ----------

function sceneHtml(
  ctx: Ctx,
  o: {
    scene: Recording["scenes"][number];
    slot: Slot;
    title?: string;
    enter: Seam;
    exit: Seam;
    pointer: { x: number; y: number };
  },
) {
  const { win, rec } = ctx;
  const id = o.scene.id;
  const D = o.scene.duration;
  const evs = o.scene.events;
  const tw: string[] = [];
  const extra: string[] = []; // stage children (move with the camera)
  const overlay: string[] = []; // screen-space children

  tw.push(...groundTweens(id, o.slot));
  tw.push(...seamIn(id, o.enter), ...seamOut(id, o.exit, D));

  // Cursor: starts where the last scene left it, glides on the recorder's curve, presses on click.
  let cur = o.pointer;
  tw.push(`tl.set("#${id}-cursor", { x: ${cur.x}, y: ${cur.y} }, 0);`);
  for (const e of evs) {
    if (e.kind === "move") {
      const p = toStage(win, e);
      tw.push(`tl.to("#${id}-cursor", { x: ${p.x}, y: ${p.y}, duration: ${e.dur ?? 0.75}, ease: "power2.inOut" }, ${e.t});`);
      cur = p;
    } else if (e.kind === "click" || e.kind === "type") {
      tw.push(
        `tl.to("#${id}-cursor-art", { scale: 0.8, duration: 0.07, ease: "power2.out" }, ${e.t});`,
        `tl.to("#${id}-cursor-art", { scale: 1, duration: 0.18, ease: "power2.out" }, ${round(e.t + 0.07)});`,
      );
    }
  }

  const bs = beats(evs, D);
  const keys = cameraPlan(bs, evs, win, D);
  tw.push(`tl.set("#${id}-stage", { x: 0, y: 0, scale: 1 }, 0);`);
  for (const k of keys) tw.push(`tl.to("#${id}-stage", { ...${JSON.stringify(k.to)}, duration: ${k.dur}, ease: "power2.inOut" }, ${k.t});`);

  bs.forEach((b, n) => {
    const box = b.act.box ?? b.move.box;
    if (!box) return;
    // Spotlight: the rest of the frame dims through a rounded hole, and a ring settles on the
    // element. The dim is a full-frame SVG (a huge box-shadow gets clipped by motion blur).
    if (b.spotlight) {
      const r = boxToStage(win, box, 10);
      const sIn = round(b.move.t + 0.3);
      const sOut = round(b.endT);
      const hole = roundedRect(r.x, r.y, r.w, r.h, 14);
      extra.push(
        `<div id="${id}-spot${n}" class="clip spot-host" data-start="${sIn}" data-duration="${round(sOut - sIn + 0.4)}" data-layout-ignore data-motion-blur="off">` +
          `<svg id="${id}-spot${n}-dim" class="spot-dim" viewBox="0 0 ${W} ${H}"><path fill-rule="evenodd" d="M0 0H${W}V${H}H0Z ${hole}"/></svg>` +
          `<div id="${id}-spot${n}-ring" class="spot-ring" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div></div>`,
      );
      tw.push(
        `tl.fromTo("#${id}-spot${n}-dim", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, ${sIn});`,
        `tl.fromTo("#${id}-spot${n}-ring", { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.45, ease: "expo.out" }, ${sIn});`,
        `tl.to("#${id}-spot${n}-dim, #${id}-spot${n}-ring", { opacity: 0, duration: 0.35, ease: "power2.in" }, ${sOut});`,
      );
    }
    // Callout: placed in screen space where the element sits once the camera has settled.
    if (b.callout) {
      const cIn = calloutIn(b.move, b.act);
      const cOut = round(b.endT);
      const cam = camAt(keys, cIn);
      const r = boxToStage(win, box);
      const sx = (x: number) => cam.scale * x + cam.x;
      const sy = (y: number) => cam.scale * y + cam.y;
      const cx = Math.min(W - 280, Math.max(280, sx(r.x + r.w / 2)));
      const top = sy(r.y);
      const bottom = sy(r.y + r.h);
      const above = top > 220;
      const y = above ? top - 22 : bottom + 22;
      overlay.push(
        `<div id="${id}-callout${n}" class="clip callout-host ${above ? "above" : "below"}" data-start="${cIn}" data-duration="${round(cOut - cIn + 0.3)}" style="left:${round(cx)}px;top:${round(y)}px"><div id="${id}-callout${n}-in" class="callout"><span class="callout-dot"></span>${esc(b.callout)}</div></div>`,
      );
      tw.push(
        `tl.fromTo("#${id}-callout${n}-in", { opacity: 0, y: ${above ? 14 : -14}, scale: 0.94, filter: "blur(6px)" }, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "expo.out" }, ${cIn});`,
        `tl.to("#${id}-callout${n}-in", { opacity: 0, filter: "blur(6px)", duration: 0.22, ease: "power2.in" }, ${cOut});`,
      );
    }
  });

  // Lower-third label, per-word blur in, held still, then out.
  if (o.title) {
    const words = o.title.split(/\s+/);
    overlay.push(
      `<div id="${id}-label" class="clip label" data-start="0.45" data-duration="${round(Math.max(1, D - 1.2))}">${words
        .map((w, i) => `<span id="${id}-w${i}" class="word">${esc(w)}</span>`)
        .join(" ")}</div>`,
    );
    tw.push(`tl.fromTo("#${id}-label", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, 0.45);`);
    words.forEach((_, i) => {
      tw.push(
        `tl.fromTo("#${id}-w${i}", { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.14, ease: "power4.out" }, ${round(0.55 + i * 0.067)});`,
      );
    });
    tw.push(`tl.to("#${id}-label", { opacity: 0, filter: "blur(6px)", duration: 0.18, ease: "power2.in" }, ${round(D - 1.0)});`);
  }

  const typing = bs
    .filter((b) => b.act.kind === "type" && b.act.chars)
    .map((b) => ({ at: round(b.act.t + TYPE_DELAY), duration: round(((b.act.chars ?? 0) * TYPE_FRAMES) / FPS) }));

  const html = `<template>
  <style>
    ${baseStyles(ctx.brand)}
    #${id}-shot { position: absolute; inset: 0; }
    #${id}-stage { position: absolute; inset: 0; transform-origin: 0 0; }
    #${id}-window { position: absolute; left: ${win.x}px; top: ${win.y}px; width: ${win.w}px; height: ${win.h}px; }
    #${id}-glow { position: absolute; left: ${win.x}px; top: ${win.y}px; width: ${win.w}px; height: ${win.h}px; }
    #${id}-video { position: absolute; left: 0; top: ${BAR}px; width: ${win.w}px; height: ${round(win.h - BAR, 1)}px; object-fit: cover; }
  </style>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    ${groundHtml(id)}
    <div id="${id}-shot">
      <div id="${id}-stage">
        <div id="${id}-glow" class="glow" data-layout-ignore></div>
        <div id="${id}-window" class="window">
          ${titleBar(ctx.spec.url, ctx.spec.chrome)}
          <video id="${id}-video" class="clip" data-start="0" data-duration="${D}" data-media-start="${o.scene.start}" data-track-index="0" src="${rec.video}" muted playsinline></video>
        </div>
        ${extra.join("\n        ")}
        <div id="${id}-cursor" class="cursor" data-layout-ignore>${cursorSvg(`${id}-cursor-art`)}</div>
      </div>
    </div>
    ${overlay.join("\n    ")}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${tw.join("\n    ")}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
  return { html, lastPointer: cur, typing };
}

// Entrances and exits. The 3D ones move the window (in perspective); the others the shot.
function seamIn(id: string, kind: Seam): string[] {
  const shot = `#${id}-shot`;
  const win = `#${id}-window`;
  switch (kind) {
    case "tilt":
      return [
        `tl.fromTo("${shot}", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0);`,
        `tl.fromTo("${win}, #${id}-glow", { transformPerspective: ${PERSPECTIVE}, rotationX: 24, rotationY: -16, y: 120, scale: 0.84 }, { rotationX: 0, rotationY: 0, y: 0, scale: 1, duration: 1.1, ease: "expo.out" }, 0);`,
      ];
    case "whip":
      return [`tl.fromTo("${shot}", { x: 260, opacity: 0, filter: "blur(20px)" }, { x: 0, opacity: 1, filter: "blur(0px)", duration: 0.45, ease: "expo.out" }, 0);`];
    case "blur":
      return [`tl.fromTo("${shot}", { opacity: 0, scale: 1.02, filter: "blur(8px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.3, ease: "power3.out" }, 0);`];
    case "zoom":
      return [`tl.fromTo("${shot}", { opacity: 0, scale: 1.14, filter: "blur(14px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.6, ease: "expo.out" }, 0);`];
  }
}

function seamOut(id: string, kind: Seam, D: number): string[] {
  const shot = `#${id}-shot`;
  const win = `#${id}-window`;
  switch (kind) {
    case "tilt":
      return [
        `tl.to("${win}, #${id}-glow", { transformPerspective: ${PERSPECTIVE}, rotationY: 22, rotationX: -6, x: -140, scale: 0.9, duration: 0.38, ease: "power3.in" }, ${round(D - 0.4)});`,
        `tl.to("${shot}", { opacity: 0, duration: 0.2, ease: "power2.in" }, ${round(D - 0.22)});`,
      ];
    case "whip":
      return [`tl.to("${shot}", { x: -260, opacity: 0, filter: "blur(18px)", duration: 0.26, ease: "power3.in" }, ${round(D - 0.28)});`];
    case "blur":
      return [`tl.to("${shot}", { opacity: 0, filter: "blur(8px)", duration: 0.18, ease: "power2.in" }, ${round(D - 0.2)});`];
    case "zoom":
      return [`tl.to("${shot}", { opacity: 0, scale: 0.93, filter: "blur(10px)", duration: 0.32, ease: "power3.in" }, ${round(D - 0.34)});`];
  }
}

// ---------- the ground: gradient + light orbs drifting at constant speed ----------
// Orb positions are a function of film time, so they flow through every seam unbroken.

const ORBS = [
  { cx: 380, cy: 220, r: 520, vx: 9, vy: 5, a: "66" },
  { cx: 1560, cy: 900, r: 620, vx: -7, vy: -4, a: "44" },
  { cx: 1200, cy: 140, r: 380, vx: -5, vy: 6, a: "33" },
];
const orbAt = (o: (typeof ORBS)[number], t: number) => ({ x: round(o.vx * t, 1), y: round(o.vy * t, 1) });

function groundHtml(id: string) {
  return `<div id="${id}-ground" class="ground" data-layout-ignore>${ORBS.map(
    (_, i) => `<div id="${id}-orb${i}" class="orb orb${i}"></div>`,
  ).join("")}<div class="vignette"></div></div>`;
}

function groundTweens(id: string, slot: Slot) {
  return ORBS.map((o, i) => {
    const a = orbAt(o, slot.start);
    const b = orbAt(o, slot.start + slot.duration);
    return `tl.fromTo("#${id}-orb${i}", { x: ${a.x}, y: ${a.y} }, { x: ${b.x}, y: ${b.y}, duration: ${slot.duration}, ease: "none" }, 0);`;
  });
}

// ---------- title cards ----------

function introHtml(ctx: Ctx, slot: Slot) {
  const { spec, grid } = ctx;
  const D = slot.duration;
  const words = spec.intro.headline.split(/\s+/);
  const last = words.length - 1;
  // One word per beat (half-beats for a long headline), so the title lands with the music.
  const beats = grid.within(0, D);
  const halves = beats.flatMap((b, i) => [b, round((b + (beats[i + 1] ?? b + grid.beat)) / 2)]);
  const steps = words.length * grid.beat <= D * 0.45 ? beats : halves;
  const wordAt = (i: number) => steps[i] ?? round(i * 0.12);
  const after = wordAt(last) + 0.25;
  const tw = [
    ...groundTweens("intro", slot),
    `tl.set("#intro-brand", { opacity: 0.75 }, 0);`,
    // Words sit dim at frame 0 (the thumbnail is never empty), then light up one by one;
    // the last word lands in the accent colour.
    ...words.map(
      (_, i) =>
        `tl.fromTo("#intro-w${i}", { opacity: 0.16, y: 14, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.3, ease: "power3.out" }, ${wordAt(i)});`,
    ),
    `tl.fromTo("#intro-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "expo.out" }, ${round(after)});`,
    spec.intro.sub
      ? `tl.fromTo("#intro-sub", { opacity: 0, filter: "blur(6px)" }, { opacity: 0.85, filter: "blur(0px)", duration: 0.3, ease: "power3.out" }, ${round(grid.beatAfter(after + 0.1))});`
      : "",
    // A slow push-in keeps a long voiced intro from sitting dead still.
    `tl.fromTo("#intro-headline", { scale: 0.98 }, { scale: 1.04, duration: ${round(D)}, ease: "none" }, 0);`,
    `tl.to("#intro-card", { opacity: 0, scale: 1.1, filter: "blur(12px)", duration: 0.34, ease: "power3.in" }, ${round(D - 0.36)});`,
  ];
  return card(ctx, "intro", D, `
      <div id="intro-brand" class="brand">${esc(spec.brand.name)}</div>
      <h1 id="intro-headline" class="headline">${words
        .map((w, i) => `<span id="intro-w${i}" class="word${i === last ? " accent" : ""}">${esc(w)}</span>`)
        .join(" ")}</h1>
      <div id="intro-rule" class="rule"></div>
      ${spec.intro.sub ? `<p id="intro-sub" class="sub">${esc(spec.intro.sub)}</p>` : ""}`, tw);
}

function outroHtml(ctx: Ctx, slot: Slot) {
  const { spec, grid } = ctx;
  const D = slot.duration;
  const b = grid.within(slot.start, slot.start + D); // beats from the outro's first frame
  const on = (i: number, fallback: number) => b[i] ?? fallback;
  const host = spec.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return card(ctx, "outro", D, `
      <h1 id="outro-headline" class="headline">${esc(spec.outro.headline)}</h1>
      ${spec.outro.cta ? `<div id="outro-cta" class="cta"><span id="outro-cta-shine" class="shine" data-layout-ignore></span>${esc(spec.outro.cta)}</div>` : ""}
      <div id="outro-url" class="url">${esc(host.startsWith("file:") ? spec.brand.name : host)}</div>`, [
    ...groundTweens("outro", slot),
    `tl.fromTo("#outro-headline", { opacity: 0, y: 24, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "expo.out" }, 0.05);`,
    spec.outro.cta ? `tl.fromTo("#outro-cta", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.6)" }, ${on(1, 0.75)});` : "",
    spec.outro.cta ? `tl.fromTo("#outro-cta-shine", { x: -260 }, { x: 520, duration: 0.9, ease: "power2.inOut" }, ${on(2, 1.25)});` : "",
    `tl.fromTo("#outro-headline", { scale: 0.98 }, { scale: 1.04, duration: ${round(D)}, ease: "none" }, 0);`,
    `tl.fromTo("#outro-url", { opacity: 0 }, { opacity: 0.7, duration: 0.4, ease: "power2.out" }, ${on(2, 1.05)});`,
  ]);
}

function card(ctx: Ctx, id: string, D: number, body: string, tweens: string[]) {
  return `<template>
  <style>
    ${baseStyles(ctx.brand)}
    #${id}-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; text-align: center; }
  </style>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    ${groundHtml(id)}
    <div id="${id}-card" class="clip" data-start="0" data-duration="${D}">${body}
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${tweens.filter(Boolean).join("\n    ")}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

// ---------- shared look ----------

// The accent, lightened toward white until it reads on the ground (WCAG 4.5:1).
function readableOn(accent: string, ground: string) {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c: number[]) =>
    c.map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const g = lum(rgb(ground));
  const a = rgb(accent);
  for (let t = 0; t <= 1; t += 0.05) {
    const c = a.map((v) => Math.round(v + (255 - v) * t));
    if ((lum(c) + 0.05) / (g + 0.05) >= 4.5) return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  return "#ffffff";
}

function baseStyles(brand: Spec["brand"]) {
  const { accent, ground, ink, font } = brand;
  return `#root { position: absolute; inset: 0; overflow: hidden; font-family: "${font}", sans-serif; color: ${ink}; }
    .ground { position: absolute; inset: 0; overflow: hidden; background: linear-gradient(160deg, ${ground} 0%, color-mix(in srgb, ${ground} 82%, ${accent}) 100%); }
    .orb { position: absolute; border-radius: 50%; }
    ${ORBS.map((o, i) => `.orb${i} { left: ${o.cx - o.r}px; top: ${o.cy - o.r}px; width: ${o.r * 2}px; height: ${o.r * 2}px; background: radial-gradient(circle, ${accent}${o.a} 0%, transparent 68%); }`).join("\n    ")}
    .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.45) 100%); }
    .glow { border-radius: 24px; box-shadow: 0 0 140px 10px ${accent}40; }
    .window { border-radius: 16px; overflow: hidden; background: #fff;
      box-shadow: 0 50px 120px -20px rgba(0,0,0,.6), 0 18px 40px -10px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.1); }
    .bar { position: absolute; left: 0; top: 0; right: 0; height: ${BAR}px; background: #f3f3f6; border-bottom: 1px solid #e3e3ea; display: flex; align-items: center; gap: 8px; padding: 0 18px; }
    .bar.dark { background: #1c1c21; border-bottom-color: #2c2c33; }
    .bar.dark .addr { background: #2a2a31; color: #aaa; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .addr { margin-left: 18px; flex: 1; max-width: 560px; height: 26px; border-radius: 8px; background: #fff; color: #555; font: 14px/26px Inter, sans-serif; padding: 0 12px; white-space: nowrap; overflow: hidden; }
    .cursor { position: absolute; left: 0; top: 0; width: 34px; height: 34px; z-index: 30; }
    .cursor svg { width: 34px; height: 34px; transform-origin: 4px 4px; filter: drop-shadow(0 4px 8px rgba(0,0,0,.35)); }
    .spot-host { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 20; pointer-events: none; }
    .spot-dim { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; fill: rgba(6,6,14,.45); }
    .spot-ring { position: absolute; border-radius: 14px; box-shadow: 0 0 0 3px ${accent}, 0 0 28px 6px ${accent}66; }
    .callout-host { position: absolute; z-index: 40; width: 0; height: 0; }
    .callout { position: absolute; left: 0; white-space: nowrap; display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-radius: 14px;
      background: #fff; color: #111; font-size: 30px; font-weight: 700; letter-spacing: -0.01em; box-shadow: 0 18px 44px rgba(0,0,0,.35); translate: -50% 0; }
    .callout-host.above .callout { bottom: 0; }
    .callout-host.below .callout { top: 0; }
    .callout::after { content: ""; position: absolute; left: 50%; width: 16px; height: 16px; background: #fff; translate: -50% 0; rotate: 45deg; }
    .callout-host.above .callout::after { bottom: -7px; }
    .callout-host.below .callout::after { top: -7px; }
    .callout-dot { width: 12px; height: 12px; border-radius: 50%; background: ${accent}; flex: none; }
    .label { position: absolute; left: 120px; bottom: 80px; z-index: 50; padding: 16px 26px; border-radius: 14px;
      background: ${ground}e8; border: 1px solid ${accent}88; font-size: 40px; font-weight: 700; letter-spacing: -0.01em; }
    .word { display: inline-block; }
    .accent { color: ${readableOn(accent, ground)}; }
    .brand { font-size: 32px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .headline { font-size: 104px; font-weight: 900; letter-spacing: -0.04em; line-height: 1.02; max-width: 1560px; margin: 0; }
    .rule { width: 160px; height: 4px; border-radius: 2px; background: ${accent}; transform-origin: 50% 50%; }
    .sub { font-size: 40px; max-width: 1200px; margin: 0; }
    .cta { position: relative; overflow: hidden; font-size: 40px; font-weight: 700; padding: 22px 48px; border-radius: 999px; background: ${accent}; color: #fff; box-shadow: 0 20px 50px ${accent}55; }
    .shine { position: absolute; top: -20%; left: 0; width: 120px; height: 140%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent); rotate: 12deg; }
    .url { font-size: 30px; }`;
}

function titleBar(url: string, chrome: "light" | "dark") {
  const addr = url.startsWith("file:") ? basename(url) : url.replace(/^https?:\/\//, "");
  return `<div class="bar ${chrome}" data-layout-ignore><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="addr">${esc(addr)}</span></div>`;
}

function cursorSvg(id: string) {
  return `<svg id="${id}" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

// ---------- root + audio ----------

function audioTags(
  spec: Spec,
  specDir: string,
  vo: VoiceManifest,
  rec: Recording,
  slots: Slot[],
  total: number,
  project: string,
  typing: { at: number; duration: number }[],
  grid: Grid,
) {
  const tags: string[] = [];
  for (const slot of slots) {
    const v = vo[slot.id];
    if (v) tags.push(`<audio id="vo-${slot.id}" data-start="${round(slot.start + VO_LEAD)}" data-duration="${v.duration}" data-track-index="10" data-volume="1" src="${v.file}"></audio>`);
  }

  const music = resolveMusic(spec.music, specDir);
  if (music) tags.push(musicTag(music, project, { total, volume: musicVolume(spec.musicVolume, spec.narration), mediaStart: grid.mediaStart }));

  const sfx = new Sfx(project);
  const place = sfx.place.bind(sfx);
  for (const slot of slots.slice(1)) place("whoosh", slot.start, 0.5);
  for (const scene of rec.scenes) {
    const slot = slots.find((s) => s.id === scene.id)!;
    for (const e of scene.events) if (e.kind === "click" || e.kind === "type") place("click", slot.start + e.t, 0.7);
    for (const b of beats(scene.events, scene.duration)) if (b.callout) place("pop", slot.start + calloutIn(b.move, b.act), 0.35);
  }
  for (const t of typing) place("typing", t.at, 0.45, t.duration);
  return [...tags, ...sfx.tags];
}

function indexHtml(spec: Spec, slots: Slot[], total: number, audio: string[]) {
  const hosts = slots
    .map(
      (s, i) =>
        `<div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.duration}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:${i + 1}"></div>`,
    )
    .join("\n      ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="${GSAP}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${spec.brand.ground}; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-fps="30" data-width="${W}" data-height="${H}" data-motion-blur="on">
      ${hosts}
      ${audio.join("\n      ")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

