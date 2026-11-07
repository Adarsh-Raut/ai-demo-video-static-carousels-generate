// Motion video: spec → a 1920×1080 HyperFrames project of redrawn, animated UI.
//
// Every scene is a whole number of bars, so every cut is on a bar line. Inside a scene,
// entrances, clicks, counters and drops land on beats. Scenes are joined by the flood: an
// accent dot appears in the old scene, swells over the frame just before the bar line, and
// on the bar line a hole opens from the centre to reveal the new scene, which arrives
// sharpening out of a blur. Motion blur is on for the whole film.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Grid } from "../beats.ts";
import { esc, GSAP, musicTag, Sfx } from "../media.ts";
import { photoUrl } from "../social/listing.ts";
import { round, workDir, writeJson } from "../util.ts";
import type { MotionScene, MotionSpec } from "./spec.ts";

const W = 1920;
const H = 1080;
const X0 = 150; // left margin
const X1 = W - 150; // right margin

export type Slot = { scene: MotionScene; start: number; duration: number; beats: number[] };

// Scene k starts on bar line sum(bars before k).
export function motionSlots(spec: MotionSpec, grid: Grid): Slot[] {
  let bar = 0;
  return spec.scenes.map((scene, i) => {
    const start = grid.bars[bar];
    bar += scene.bars;
    // The end card holds a little past its last bar line while the music fades.
    const end = grid.bars[bar] + (i === spec.scenes.length - 1 ? spec.tail : 0);
    return { scene, start, duration: round(end - start), beats: grid.within(start, end) };
  });
}

// ---------- assets ----------

export async function prepareMotionAssets(spec: MotionSpec, specDir: string, { force = false } = {}) {
  const { project } = workDir(spec.id);
  mkdirSync(join(project, "assets", "photos"), { recursive: true });
  const photos = spec.scenes.flatMap((s) => (s.kind === "search" ? s.cards.map((c) => c.photo) : []));
  for (const [i, src] of photos.entries()) {
    const dest = join(project, "assets", "photos", `c${i}.jpg`);
    if (!force && existsSync(dest)) continue;
    if (/^https?:/.test(src)) {
      const res = await fetch(photoUrl(src, 900));
      if (!res.ok) throw new Error(`photo ${src}: HTTP ${res.status}`);
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    } else copyFileSync(resolve(specDir, src), dest);
  }
  if (spec.brand.logo) {
    const dest = join(project, "assets", "logo.png");
    if (force || !existsSync(dest)) {
      if (/^https?:/.test(spec.brand.logo)) {
        const res = await fetch(spec.brand.logo);
        if (!res.ok) throw new Error(`logo: HTTP ${res.status}`);
        writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      } else copyFileSync(resolve(specDir, spec.brand.logo), dest);
    }
  }
}

// ---------- compose ----------

type Cue = (kind: "click" | "whoosh" | "typing" | "pop" | "impact" | "sparkle", at: number, volume: number, duration?: number) => void;
type Ctx = { spec: MotionSpec; slot: Slot; cue: Cue; photo: (n: number) => string };

export function composeMotion(spec: MotionSpec, music: string | null, grid: Grid) {
  const { project } = workDir(spec.id);
  mkdirSync(join(project, "compositions"), { recursive: true });
  const slots = motionSlots(spec, grid);
  const total = round(slots.at(-1)!.start + slots.at(-1)!.duration);
  const sfx = new Sfx(project);
  let photoN = 0;
  slots.forEach((slot) => {
    const first = photoN;
    if (slot.scene.kind === "search") photoN += slot.scene.cards.length;
    const ctx: Ctx = {
      spec,
      slot,
      cue: (kind, at, volume, duration) =>
        spec.sfx && sfx.place(kind, slot.start + at, volume, duration ?? (kind === "pop" ? round(grid.beat - 0.04) : kind === "impact" ? round(grid.beat * 2 - 0.05) : undefined)),
      photo: (n) => `assets/photos/c${first + n}.jpg`,
    };
    writeFileSync(join(project, "compositions", `${slot.scene.id}.html`), sceneHtml(ctx));
  });
  // The flood between scenes, and a soft whoosh on each bar line it opens on.
  writeFileSync(join(project, "compositions", "flood.html"), floodHtml(spec, slots, total));
  if (spec.sfx) slots.slice(1).forEach((s) => sfx.place("whoosh", s.start, 0.22));

  const audio = music ? [musicTag(music, project, { total, volume: spec.musicVolume, mediaStart: grid.mediaStart, fadeOut: 2 })] : [];
  writeFileSync(join(project, "index.html"), indexHtml(spec, slots, total, [...audio, ...sfx.tags]));
  writeJson(join(project, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  });
  writeJson(join(project, "meta.json"), { id: spec.id, name: `${spec.brand.name} motion` });
  console.log(`compose  ${slots.length} scenes, ${total}s, ${round(grid.bpm, 1)} BPM → ${project}`);
  return { project, total, slots };
}

// ---------- scenes ----------

type Parts = { html: string[]; tw: string[] };

function sceneHtml(ctx: Ctx) {
  const { scene, duration: D } = ctx.slot;
  const p: Parts = { html: [], tw: [] };
  const builders: Record<MotionScene["kind"], (ctx: Ctx, p: Parts) => void> = { lines, logo, search, value, bid, checks, flood, end };
  builders[scene.kind](ctx, p);
  const bg = scene.kind === "flood" ? ctx.spec.brand.accent : ctx.spec.brand.paper;
  return `<template>
  <style>
    ${styles(ctx.spec)}
    #root { background: ${bg}; }
  </style>
  <div id="root" data-composition-id="${scene.id}" data-width="${W}" data-height="${H}">
    <div id="${scene.id}-stage" class="stage" data-layout-allow-overflow>
    ${p.html.join("\n    ")}
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    // A slow push-in keeps every hold alive.
    tl.fromTo("#${scene.id}-stage", { scale: 1 }, { scale: 1.025, duration: ${D}, ease: "none" }, 0);
    ${p.tw.filter(Boolean).join("\n    ")}
    window.__timelines["${scene.id}"] = tl;
  </script>
</template>
`;
}

// The house entrance: up from a blur, settling fast.
const enter = (sel: string, at: number, o: { y?: number; blur?: number; scale?: number; dur?: number } = {}) =>
  `tl.fromTo("${sel}", { y: ${o.y ?? 36}, opacity: 0, scale: ${o.scale ?? 1}, filter: "blur(${o.blur ?? 12}px)" }, { y: 0, opacity: 1, scale: 1, filter: "blur(0px)", duration: ${o.dur ?? 0.38}, ease: "power3.out" }, ${round(at)});`;

const beatAt = (b: number[], i: number, fallback: number) => b[i] ?? fallback;
const fit = (text: string, width: number, max: number, k = 0.52) => Math.round(Math.min(max, width / Math.max(1, text.length * k)));

function lines({ slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "lines" }>;
  const b = slot.beats;
  s.lines.forEach((line, i) => {
    const id = `${s.id}-l${i}`;
    const at = beatAt(b, i, i * 0.5);
    const next = i < s.lines.length - 1 ? beatAt(b, i + 1, (i + 1) * 0.5) : undefined;
    p.html.push(`<div id="${id}" class="center big" style="font-size:${fit(line, 1500, 150)}px">${esc(line)}</div>`);
    // The film's first line is already up at frame 0: it is the thumbnail.
    p.tw.push(slot.start === 0 && i === 0 ? "" : enter(`#${id}`, at, { y: 24, blur: 10, dur: 0.24 }));
    if (next !== undefined) p.tw.push(`tl.set("#${id}", { opacity: 0 }, ${round(next)});`);
    cue("pop", at, 0.18);
  });
}

function logo({ spec, slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "logo" }>;
  const b = slot.beats;
  p.html.push(
    spec.brand.logo
      ? `<img id="${s.id}-logo" class="logo" src="assets/logo.png" alt="${esc(spec.brand.name)}">`
      : `<div id="${s.id}-logo" class="logo wordmark">${esc(spec.brand.name)}</div>`,
  );
  p.tw.push(enter(`#${s.id}-logo`, 0.02, { y: 0, scale: 0.9, blur: 16, dur: 0.5 }));
  cue("sparkle", 0.02, 0.3);
  if (s.tagline) {
    p.html.push(`<div id="${s.id}-tag" class="tagline">${esc(s.tagline)}</div>`);
    p.tw.push(enter(`#${s.id}-tag`, beatAt(b, 1, 0.6), { y: 16, blur: 8 }));
  }
}

function headline(id: string, text: string, style: string, p: Parts, at = 0.04) {
  p.html.push(`<div id="${id}-head" class="head" style="${style}">${esc(text)}</div>`);
  p.tw.push(enter(`#${id}-head`, at));
}

function search({ slot, cue, photo }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "search" }>;
  const b = slot.beats;
  const id = s.id;
  headline(id, s.headline, `left:${X0}px; top:300px; font-size:${fit(s.headline, 520, 190)}px`, p);
  // The search bar (the site's own: placeholder, magnifier), typing the query.
  const bar = { x: 700, y: 236, w: X1 - 700 };
  const typeFrom = beatAt(b, 1, 0.5);
  const step = 1 / 20; // 20 characters a second
  const chars = [...s.query];
  p.html.push(`<div id="${id}-bar" class="sbar" style="left:${bar.x}px; top:${bar.y}px; width:${bar.w}px">
      <span id="${id}-ph" class="ph" data-layout-ignore>Describe your ideal home, or enter a city or zip</span>
      <span class="typed" data-layout-ignore>${chars.map((c, i) => `<span id="${id}-c${i}" class="ch">${c === " " ? "&nbsp;" : esc(c)}</span>`).join("")}<span id="${id}-caret" class="caret"></span></span>
      ${MAGNIFIER}
    </div>`);
  p.tw.push(enter(`#${id}-bar`, 0.1, { y: 24, blur: 8 }));
  p.tw.push(`tl.set("#${id}-ph", { opacity: 0 }, ${round(typeFrom)});`);
  chars.forEach((_, i) => p.tw.push(`tl.set("#${id}-c${i}", { display: "inline" }, ${round(typeFrom + i * step)});`));
  const typed = typeFrom + chars.length * step;
  cue("typing", typeFrom, 0.35, round(chars.length * step));
  // Enter on the next beat, then one card per beat.
  const go = slot.beats.find((t) => t >= typed + 0.05) ?? typed + 0.2;
  p.tw.push(`tl.to("#${id}-bar", { scale: 0.985, duration: 0.07, ease: "power2.out", yoyo: true, repeat: 1 }, ${round(go)});`);
  cue("click", go, 0.4);
  const cw = Math.round((bar.w - 2 * 40) / 3);
  s.cards.forEach((c, i) => {
    const at = slot.beats.find((t) => t >= go + i * (b[1] ?? 0.5) - 0.02) ?? go + i * 0.5; // first card on the Enter beat
    p.html.push(`<div id="${id}-k${i}" class="card" style="left:${bar.x + i * (cw + 40)}px; top:410px; width:${cw}px; height:440px">
      <img src="${photo(i)}" alt=""><div class="shade"></div>
      <div class="meta" data-layout-ignore><div class="place" style="font-size:${fit(c.place, cw - 48, 34, 0.56)}px">${esc(c.place)}</div><div class="facts" style="font-size:${fit(c.facts, cw - 48, 24, 0.5)}px">${esc(c.facts)}</div>
      <div class="price"><small>${esc(c.label)}</small> ${esc(c.price)}</div></div></div>`);
    p.tw.push(`tl.fromTo("#${id}-k${i}", { y: -70, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.42, ease: "back.out(1.7)" }, ${round(at - 0.06)});`);
    cue("pop", at, 0.3);
  });
}

function value({ spec, slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "value" }>;
  const b = slot.beats;
  const id = s.id;
  const ratio = s.price / s.estimate;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  headline(id, s.headline, `left:${X0}px; top:200px; font-size:190px`, p);
  // The number top right rolls from the estimate down to the starting bid.
  p.html.push(`<div id="${id}-num" class="num" style="right:${W - X1}px; top:200px">${money(s.estimate)}</div>`);
  p.tw.push(enter(`#${id}-num`, 0.1));
  const bar = { x: X0, y: 520, w: X1 - X0, h: 200 };
  const dragFrom = beatAt(b, 1, 0.6);
  const dragTo = beatAt(b, 3, dragFrom + 1.1);
  p.html.push(`<div id="${id}-bar" class="vbar" style="left:${bar.x}px; top:${bar.y}px; width:${bar.w}px; height:${bar.h}px">
      <div id="${id}-fill" class="vfill"></div>
      <div id="${id}-flab" class="vlab" style="left:36px; color:#fff"><b>${esc(s.priceLabel)}</b><span>${money(s.price)}</span></div>
    </div>
    <div id="${id}-rest" class="vlab right" style="right:${W - X1}px; top:${bar.y + bar.h + 34}px; bottom:auto"><b>${esc(s.estimateLabel)}</b><span>${money(s.estimate)}</span></div>
    <div id="${id}-handle" class="handle" style="left:${bar.x + bar.w - 14}px; top:${bar.y + 40}px"></div>
    <div id="${id}-cursor" class="cursor" style="left:${bar.x + bar.w}px; top:${bar.y + 100}px">${CURSOR}</div>
    <div id="${id}-badge" class="badge" style="right:${round(W - (bar.x + bar.w * ratio))}px; top:${bar.y + bar.h + 34}px">${esc(s.badge)}</div>`);
  p.tw.push(enter(`#${id}-bar`, 0.12, { y: 30, blur: 8 }));
  p.tw.push(`tl.fromTo("#${id}-cursor", { x: 120, y: 160, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: "power2.out" }, ${round(dragFrom - 0.45)});`);
  p.tw.push(`tl.fromTo("#${id}-handle", { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${round(dragFrom - 0.3)});`);
  // Drag: the fill, handle and cursor move together; the number and label roll with them.
  const dx = round(-bar.w * (1 - ratio));
  const dur = round(dragTo - dragFrom);
  p.tw.push(
    `tl.fromTo("#${id}-fill", { scaleX: 1 }, { scaleX: ${round(ratio, 4)}, duration: ${dur}, ease: "power2.inOut" }, ${round(dragFrom)});`,
    `tl.to("#${id}-handle, #${id}-cursor", { x: ${dx}, duration: ${dur}, ease: "power2.inOut" }, ${round(dragFrom)});`,
    `const ${camel(id)}V = { v: ${s.estimate} };`,
    `tl.to(${camel(id)}V, { v: ${s.price}, duration: ${dur}, ease: "power2.inOut", onUpdate: () => { document.querySelector("#${id}-num").textContent = "$" + Math.round(${camel(id)}V.v).toLocaleString("en-US"); } }, ${round(dragFrom)});`,
    // The labels only appear once the bar has settled, so they never state a wrong figure.
    `tl.fromTo("#${id}-flab, #${id}-rest", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.06 }, ${round(dragTo)});`,
    `tl.fromTo("#${id}-badge", { scale: 0.5, opacity: 0, rotation: -6 }, { scale: 1, opacity: 1, rotation: -2, duration: 0.45, ease: "back.out(2.2)" }, ${round(dragTo - 0.05)});`,
    `tl.to("#${id}-cursor", { opacity: 0, duration: 0.3 }, ${round(dragTo + 0.4)});`,
  );
  cue("click", dragFrom, 0.3);
  cue("impact", dragTo, 0.4);
  void spec;
}

function bid({ slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "bid" }>;
  const b = slot.beats;
  const id = s.id;
  const D = slot.duration;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  headline(id, s.headline, `left:0; right:0; text-align:center; top:120px; font-size:190px`, p);
  p.html.push(`<div id="${id}-lab" class="center-line muted" style="top:400px; font-size:40px">${esc(s.label)}</div>
    <div id="${id}-now" class="center-line num ink" style="top:450px">${money(s.from)}</div>
    <div id="${id}-ends" class="center-line muted" style="top:640px; font-size:38px">Ends in <span id="${id}-clock" class="mono">${clock(s.ends)}</span></div>
    <div id="${id}-btn" class="button" style="left:${W / 2 - 200}px; top:750px">${esc(s.button)}</div>
    <div id="${id}-cursor" class="cursor" style="left:${W / 2 + 120}px; top:800px">${CURSOR}</div>
    <div id="${id}-toast" class="toast" style="left:${W - 150 - 460}px; top:96px"><span class="tick">✓</span>${esc(s.toast)}</div>`);
  p.tw.push(enter(`#${id}-lab`, beatAt(b, 1, 0.5) - 0.3, { y: 12, blur: 6 }), enter(`#${id}-now`, beatAt(b, 1, 0.5) - 0.24), enter(`#${id}-ends`, beatAt(b, 1, 0.5)), enter(`#${id}-btn`, beatAt(b, 2, 1), { y: 20, blur: 8 }));
  // Countdown, one tick a second.
  p.tw.push(`const ${camel(id)}C = { s: ${s.ends} };`, `tl.to(${camel(id)}C, { s: ${s.ends - Math.floor(D)}, duration: ${round(D)}, ease: "none", onUpdate: () => { const v = Math.ceil(${camel(id)}C.s); document.querySelector("#${id}-clock").textContent = String(Math.floor(v / 3600)).padStart(2, "0") + ":" + String(Math.floor(v % 3600 / 60)).padStart(2, "0") + ":" + String(v % 60).padStart(2, "0"); } }, 0);`);
  // The cursor glides to the button and presses it on a beat; the bid rolls up; the toast lands.
  const press = beatAt(b, 4, 2);
  p.tw.push(
    `tl.fromTo("#${id}-cursor", { x: 260, y: 200, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.55, ease: "power2.out" }, ${round(press - 0.65)});`,
    `tl.to("#${id}-btn", { scale: 0.93, duration: 0.07, ease: "power2.out" }, ${round(press)});`,
    `tl.to("#${id}-btn", { scale: 1, duration: 0.3, ease: "back.out(3)" }, ${round(press + 0.07)});`,
    `tl.to("#${id}-cursor", { scale: 0.85, duration: 0.07, yoyo: true, repeat: 1 }, ${round(press)});`,
    `const ${camel(id)}B = { v: ${s.from} };`,
    `tl.to(${camel(id)}B, { v: ${s.to}, duration: 0.45, ease: "power3.out", onUpdate: () => { document.querySelector("#${id}-now").textContent = "$" + Math.round(${camel(id)}B.v).toLocaleString("en-US"); } }, ${round(press + 0.05)});`,
    `tl.fromTo("#${id}-now", { color: "#111827" }, { color: "#0c4bea", duration: 0.2 }, ${round(press + 0.05)});`,
    `tl.fromTo("#${id}-toast", { y: -40, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.42, ease: "back.out(1.8)" }, ${round(beatAt(b, 6, press + 0.9) - 0.05)});`,
  );
  cue("click", press, 0.55);
  cue("pop", beatAt(b, 6, press + 0.9), 0.35);
}

function checks({ spec, slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "checks" }>;
  const b = slot.beats;
  const id = s.id;
  headline(id, s.headline, `left:0; right:0; text-align:center; top:200px; font-size:${fit(s.headline, 1600, 130)}px`, p);
  s.items.forEach((item, i) => {
    const at = beatAt(b, i + 1, 0.5 + i * 0.5);
    p.html.push(`<div id="${id}-i${i}" class="row" style="top:${440 + i * 120}px"><span class="dot" style="background:${spec.brand.accent}">✓</span>${esc(item)}</div>`);
    p.tw.push(enter(`#${id}-i${i}`, at - 0.04, { y: 20, blur: 8, dur: 0.32 }));
    cue("pop", at, 0.28);
  });
}

function flood({ slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "flood" }>;
  const b = slot.beats;
  const every = Math.max(1, Math.floor(b.length / s.words.length));
  s.words.forEach((w, i) => {
    const id = `${s.id}-w${i}`;
    const at = beatAt(b, i * every, i * 0.8);
    const next = i < s.words.length - 1 ? beatAt(b, (i + 1) * every, (i + 1) * 0.8) : undefined;
    p.html.push(`<div id="${id}" class="center big" style="color:#fff; font-size:${fit(w, 1600, 280)}px">${esc(w)}</div>`);
    p.tw.push(enter(`#${id}`, at + 0.02, { y: 30, blur: 14, dur: 0.3, scale: 1.06 }));
    if (next !== undefined) p.tw.push(`tl.set("#${id}", { opacity: 0 }, ${round(next)});`);
    cue("impact", at + 0.02, 0.3);
  });
}

function end({ spec, slot, cue }: Ctx, p: Parts) {
  const s = slot.scene as Extract<MotionScene, { kind: "end" }>;
  const b = slot.beats;
  const id = s.id;
  if (spec.brand.logo) {
    p.html.push(`<img id="${id}-logo" class="endlogo" src="assets/logo.png" alt="${esc(spec.brand.name)}">`);
    p.tw.push(enter(`#${id}-logo`, 0.02, { y: 0, scale: 0.9, blur: 12, dur: 0.45 }));
  }
  p.html.push(`<div id="${id}-head" class="center-line ink" style="top:430px; font-size:190px; font-weight:500; letter-spacing:-.05em">${esc(s.headline)}</div>
    <div id="${id}-url" class="center-line muted" style="top:680px; font-size:44px">${esc(s.url)}</div>
    ${s.sub ? `<div id="${id}-sub" class="center-line muted" style="top:745px; font-size:30px; opacity:.8">${esc(s.sub)}</div>` : ""}`);
  // Headline on the downbeat (out of the flood), then URL and small print a beat apart.
  p.tw.push(enter(`#${id}-head`, 0.06), enter(`#${id}-url`, beatAt(b, 1, 0.5), { y: 12, blur: 6 }));
  if (s.sub) p.tw.push(enter(`#${id}-sub`, beatAt(b, 2, 1), { y: 10, blur: 6 }));
  cue("sparkle", 0.06, 0.35);
}

// ---------- the flood transition ----------

// One element per cut: an accent dot appears in the old scene a beat early, swells over the
// whole frame in the last ~0.16 s, and on the bar line the accent layer opens from the centre
// (a growing circular hole, drawn as an even-odd clip path) to reveal the new scene.
function floodHtml(spec: MotionSpec, slots: Slot[], total: number) {
  const accent = spec.brand.accent;
  const html: string[] = [];
  const tw: string[] = [];
  const R = Math.ceil(Math.hypot(W, H) / 2) + 40;
  slots.slice(1).forEach((slot, k) => {
    const prev = slots[k];
    const cut = slot.start;
    const beat = prev.beats.length > 1 ? prev.beats[1] - prev.beats[0] : 0.5;
    const appear = round(cut - beat);
    const intoFlood = slot.scene.kind === "flood"; // the new scene is accent already: no hole
    const fromFlood = prev.scene.kind === "flood"; // the old scene is accent already: no dot
    const dot = DOT_AT[prev.scene.kind] ?? { x: W / 2, y: H / 2 };
    const end = round(cut + (intoFlood ? 0.05 : 0.42));
    html.push(`<div id="fl${k}" class="clip fl" data-start="${appear}" data-duration="${round(end - appear)}" data-layout-ignore data-layout-allow-overflow>
      ${fromFlood ? "" : `<div id="fl${k}-dot" class="fdot" style="left:${dot.x - 30}px; top:${dot.y - 30}px; background:${accent}"></div>`}
      ${intoFlood ? "" : `<div id="fl${k}-hole" class="fhole" style="background:${accent}"></div>`}
    </div>`);
    const local = (t: number) => round(t - appear);
    if (!fromFlood) {
      const cover = round((Math.hypot(Math.max(dot.x, W - dot.x), Math.max(dot.y, H - dot.y)) + 20) / 30, 2);
      tw.push(
        `tl.fromTo("#fl${k}-dot", { scale: 0 }, { scale: 1, duration: 0.18, ease: "back.out(2.5)" }, ${round(appear)});`,
        `tl.to("#fl${k}-dot", { scale: ${cover}, duration: 0.17, ease: "power2.in" }, ${round(cut - 0.17)});`,
        intoFlood ? "" : `tl.set("#fl${k}-dot", { opacity: 0 }, ${round(cut)});`,
      );
    }
    if (!intoFlood) {
      tw.push(
        `tl.set("#fl${k}-hole", { opacity: 1 }, ${round(cut - 0.001)});`,
        `const fl${k} = { r: 0 };`,
        `tl.to(fl${k}, { r: ${R}, duration: 0.4, ease: "power3.out", onUpdate: () => hole("#fl${k}-hole", fl${k}.r) }, ${round(cut)});`,
      );
    }
    void local;
  });
  return `<template>
  <style>
    #root { position: absolute; inset: 0; pointer-events: none; }
    .fl { position: absolute; inset: 0; overflow: hidden; }
    .fdot { position: absolute; width: 60px; height: 60px; border-radius: 50%; }
    .fhole { position: absolute; inset: 0; opacity: 0; }
  </style>
  <div id="root" data-composition-id="flood" data-width="${W}" data-height="${H}">
    ${html.join("\n    ")}
  </div>
  <script>
    // The accent layer with a circular hole of radius r in the middle.
    function hole(sel, r) {
      const el = document.querySelector(sel);
      const cx = ${W / 2}, cy = ${H / 2};
      el.style.clipPath = r <= 0 ? "none" : 'path(evenodd, "M0 0H${W}V${H}H0Z M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0Z")';
    }
    const tl = gsap.timeline({ paused: true });
    ${tw.filter(Boolean).join("\n    ")}
    tl.set({}, {}, ${total});
    window.__timelines["flood"] = tl;
  </script>
</template>
`;
}

// Where the dot appears in each kind of scene: somewhere empty, near what just happened.
const DOT_AT: Partial<Record<MotionScene["kind"], { x: number; y: number }>> = {
  lines: { x: W / 2, y: 760 },
  logo: { x: W / 2, y: 820 },
  search: { x: 430, y: 760 },
  value: { x: 460, y: 620 },
  bid: { x: W / 2, y: 960 },
  checks: { x: W / 2, y: 900 },
};

// ---------- look ----------

const clock = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, "0")).join(":");
const camel = (s: string) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/^\d/, "_$&");

const CURSOR = `<svg viewBox="0 0 24 24" width="46" height="46"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.7 L11.7 14.2 L18 14.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const MAGNIFIER = `<svg class="mag" viewBox="0 0 256 256" fill="#111827"><path d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"/></svg>`;

function styles(spec: MotionSpec) {
  const { accent, ink, muted, font } = spec.brand;
  return `#root { position: absolute; inset: 0; overflow: hidden; font-family: "${font}", sans-serif; color: ${ink}; }
    .stage { position: absolute; inset: 0; }
    .big, .head { font-weight: 500; letter-spacing: -.05em; line-height: 1; white-space: nowrap; }
    .center { position: absolute; left: 0; right: 0; top: 50%; translate: 0 -55%; text-align: center; }
    .center-line { position: absolute; left: 0; right: 0; text-align: center; white-space: nowrap; }
    .head { position: absolute; }
    .muted { color: ${muted}; }
    .ink { color: ${ink}; }
    .num { position: absolute; font-size: 170px; font-weight: 500; letter-spacing: -.05em; line-height: 1; color: ${accent}; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .center-line.num { position: absolute; color: ${ink}; }
    .mono { font-variant-numeric: tabular-nums; color: ${ink}; font-weight: 600; }
    .logo { position: absolute; left: ${W / 2 - 340}px; top: 360px; width: 680px; }
    .wordmark { font-size: 200px; font-weight: 600; text-align: center; }
    .tagline { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font-size: 46px; color: ${muted}; }
    .endlogo { position: absolute; left: ${W / 2 - 160}px; top: 300px; width: 320px; }
    .sbar { position: absolute; height: 110px; border-radius: 16px; background: #fff; box-shadow: 0 0 0 2px #dfe3ea, 0 18px 50px rgba(17,24,39,.08);
      display: flex; align-items: center; padding: 0 40px; font-size: 40px; }
    .ph { position: absolute; left: 40px; color: #4b5563; white-space: nowrap; }
    .typed { white-space: nowrap; }
    .ch { display: none; }
    .caret { display: inline-block; width: 3px; height: 46px; background: ${accent}; margin-left: 3px; vertical-align: -8px; }
    .mag { position: absolute; right: 34px; top: 34px; width: 42px; height: 42px; }
    .card { position: absolute; border-radius: 22px; overflow: hidden; background: #1f2937; box-shadow: 0 28px 60px rgba(17,24,39,.18); }
    .card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,.86) 100%); }
    .meta { position: absolute; left: 26px; right: 18px; bottom: 24px; color: #fff; white-space: nowrap; }
    .place { font-size: 34px; font-weight: 600; letter-spacing: -.01em; }
    .facts { font-size: 24px; opacity: .9; margin-top: 4px; }
    .price { font-size: 38px; font-weight: 700; margin-top: 10px; }
    .price small { font-size: 22px; font-weight: 500; opacity: .85; }
    .vbar { position: absolute; border-radius: 30px; background: #e9ebf0; overflow: hidden; }
    .vfill { position: absolute; inset: 0; background: ${accent}; transform-origin: 0 50%; }
    .vlab { position: absolute; bottom: 30px; display: flex; flex-direction: column; gap: 6px; font-size: 32px; white-space: nowrap; }
    .vlab b { font-weight: 600; font-size: 36px; }
    .vlab.right { text-align: right; color: ${ink}; }
    .handle { position: absolute; width: 28px; height: 120px; border-radius: 14px; background: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    .cursor { position: absolute; z-index: 30; transform-origin: 6px 6px; }
    .badge { position: absolute; padding: 18px 32px; border-radius: 18px; background: #ffd43b; color: #111827; font-size: 44px; font-weight: 700; white-space: nowrap; box-shadow: 0 16px 40px rgba(0,0,0,.15); }
    .button { position: absolute; width: 400px; height: 120px; border-radius: 22px; background: ${ink}; color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 46px; font-weight: 600; }
    .toast { position: absolute; width: 460px; padding: 26px 32px; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px #e5e7eb, 0 24px 60px rgba(17,24,39,.14);
      display: flex; align-items: center; gap: 18px; font-size: 40px; font-weight: 600; white-space: nowrap; }
    .tick { width: 54px; height: 54px; border-radius: 50%; background: #16a34a; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32px; }
    .row { position: absolute; left: 560px; display: flex; align-items: center; gap: 28px; font-size: 60px; font-weight: 500; letter-spacing: -.03em; white-space: nowrap; }
    .dot { width: 64px; height: 64px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 36px; flex: none; }`;
}

function indexHtml(spec: MotionSpec, slots: Slot[], total: number, audio: string[]) {
  const hosts = slots
    .map(
      (s, i) =>
        `<div id="${s.scene.id}" data-composition-id="${s.scene.id}" data-composition-src="compositions/${s.scene.id}.html" data-start="${s.start}" data-duration="${s.duration}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:${i + 1}"></div>`,
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
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${spec.brand.paper}; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-fps="30" data-width="${W}" data-height="${H}" data-motion-blur="on">
      ${hosts}
      <div id="flood" data-composition-id="flood" data-composition-src="compositions/flood.html" data-start="0" data-duration="${total}" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:${slots.length + 5}"></div>
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
